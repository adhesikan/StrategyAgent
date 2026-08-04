// TraderBrain Core — Executor.
//
// Executes a ToolPlan step-by-step, respecting dependency order.
// Independent steps at the same dependency depth run concurrently (bounded).
//
// Security invariants:
//   - Only tools from the declared ToolPlan may execute (no dynamic tool
//     selection, no model-driven tool selection).
//   - Tokens from TrustedContext are injected per step.trustedContextScopes;
//     they are never stored in plan arguments or evidence envelopes.
//   - Required step failure → remaining steps are skipped; abort path.
//   - Optional step failure → evidence captured; execution continues.
//   - Complete tool payloads are never logged.

import type {
  ToolPlan,
  ToolPlanStep,
  ToolEvidence,
  TrustedContext,
  BrainToolId,
} from "./types";
import {
  wrapSuccess,
  wrapFailure,
  wrapSkipped,
} from "./evidence";
import { TIMEOUT_MS } from "./planner";
import { logBrainStep } from "./observability";

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

import type { TradeGoal, StrategyRecommendation } from "../mcp/strategy-recommendation";
import type { RankedTradeSearch } from "../routes/ranked-trade-search";
import type {
  PortfolioTradePlanGoal,
  PortfolioTradePlan,
} from "../routes/portfolio-trade-plan";
import type { MultiStrategyAnalysis } from "../mcp/multi-strategy-analysis";

export interface BrainExecutorDeps {
  /**
   * Calls runMultiStrategyAnalysis for ANALYZE_SYMBOL /
   * COMBINED_ANALYSIS_RECOMMENDATION. Injected by service.ts from the
   * existing orchestration.
   */
  runAnalysis: (symbol: string) => Promise<MultiStrategyAnalysis>;

  /**
   * Calls runStrategyRecommendation for RECOMMEND_SYMBOL_TRADE /
   * COMBINED_ANALYSIS_RECOMMENDATION. Receives the opaque portfolioToken
   * and optionsToken from TrustedContext (injected here, not from plan args).
   */
  runRecommendation: (
    goal: TradeGoal,
    portfolioToken: string | undefined,
    optionsToken: string | undefined,
  ) => Promise<StrategyRecommendation>;

  /**
   * Calls runRankedTradeSearch for RANK_MARKET_TRADES.
   * Receives the opaque portfolioToken for connected users.
   */
  runRanked: (
    goal: TradeGoal,
    portfolioToken: string | undefined,
  ) => Promise<RankedTradeSearch>;

  /**
   * Calls runPortfolioTradePlan for PLAN_PORTFOLIO_TRADE.
   * Receives both context tokens.
   */
  runPortfolioPlan: (
    goal: PortfolioTradePlanGoal,
    portfolioToken: string | undefined,
    optionsToken: string | undefined,
  ) => Promise<PortfolioTradePlan>;

  /**
   * Optional: called when an openai_explanation step is reached.
   * Returns the generated prose, or null on failure.
   */
  runOpenAi?: (
    role: "explanation" | "prose" | "education",
    question: string,
    evidence: ToolEvidence[],
  ) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract safe error code from any thrown value. Never returns raw messages. */
function safeCode(err: unknown): string {
  if (!err || typeof err !== "object") return "BRAIN_UNKNOWN_ERROR";
  const e = err as Record<string, unknown>;
  if (typeof e.code === "string") return e.code;
  if (typeof e.safeErrorCode === "string") return e.safeErrorCode;
  const msg = typeof e.message === "string" ? e.message : "";
  if (/timeout/i.test(msg)) return "BRAIN_TOOL_TIMEOUT";
  if (/not allowed/i.test(msg)) return "MCP_TOOL_NOT_ALLOWED";
  if (/unavailable|ECONNREFUSED/i.test(msg)) return "MCP_UNAVAILABLE";
  return "BRAIN_EXECUTION_ERROR";
}

/** Build a TradeGoal from ToolPlanStep arguments (already sanitized). */
function argsToTradeGoal(args: Record<string, unknown>): TradeGoal {
  const goal: TradeGoal = {};
  if (typeof args.symbol === "string") goal.symbol = args.symbol;
  if (args.direction && ["bullish","bearish","neutral","either"].includes(String(args.direction)))
    goal.direction = args.direction as TradeGoal["direction"];
  if (args.instrumentPreference) goal.instrumentPreference = args.instrumentPreference as TradeGoal["instrumentPreference"];
  if (args.objective) goal.objective = args.objective as TradeGoal["objective"];
  if (args.requestedStrategy) goal.requestedStrategy = args.requestedStrategy as TradeGoal["requestedStrategy"];
  if (typeof args.maxRiskDollars === "number") goal.maxRiskDollars = args.maxRiskDollars;
  if (typeof args.maxRiskPercent === "number") goal.maxRiskPercent = args.maxRiskPercent;
  if (typeof args.numberOfIdeas === "number") goal.numberOfIdeas = args.numberOfIdeas;
  return goal;
}

/** Build a PortfolioTradePlanGoal from step arguments. */
function argsToPortfolioGoal(args: Record<string, unknown>): PortfolioTradePlanGoal {
  return {
    kind: (args.kind as PortfolioTradePlanGoal["kind"]) ?? "dollar_risk",
    ...(typeof args.maxRiskDollars === "number" && { maxRiskDollars: args.maxRiskDollars }),
    ...(typeof args.maxRiskPercent === "number" && { maxRiskPercent: args.maxRiskPercent }),
    ...(Array.isArray(args.excludeSectors) && { excludeSectors: args.excludeSectors as string[] }),
    ...(args.requireExistingPosition === true && { requireExistingPosition: true }),
    ...(args.objective && { objective: args.objective as PortfolioTradePlanGoal["objective"] }),
    ...(args.direction && { direction: args.direction as PortfolioTradePlanGoal["direction"] }),
  };
}

/** Run one step, returning its ToolEvidence. */
async function runStep(
  step: ToolPlanStep,
  ctx: TrustedContext,
  deps: BrainExecutorDeps,
  collectedEvidence: ToolEvidence[],
  requestId: string,
): Promise<ToolEvidence> {
  const start = Date.now();

  // --- Security: inject context tokens from TrustedContext, not plan args ---
  const wantsPortfolio = step.trustedContextScopes.includes("PORTFOLIO_CONTEXT");
  const wantsOptions   = step.trustedContextScopes.includes("OPTIONS_CONTEXT");
  const portfolioToken = wantsPortfolio ? ctx.portfolioToken : undefined;
  const optionsToken   = wantsOptions   ? ctx.optionsToken   : undefined;

  const timeoutMs = TIMEOUT_MS[step.timeoutClass];

  try {
    let data: unknown;

    switch (step.tool as BrainToolId) {
      // ----------------------------------------------------------------
      case "multi_strategy_analysis": {
        const symbol = String(step.arguments.symbol ?? "");
        if (!symbol) throw Object.assign(new Error("symbol required"), { code: "BRAIN_MISSING_SYMBOL" });
        const withTimeout = Promise.race([
          deps.runAnalysis(symbol),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "BRAIN_TOOL_TIMEOUT" })), timeoutMs),
          ),
        ]);
        data = await withTimeout;
        break;
      }

      // ----------------------------------------------------------------
      case "recommend_trade_strategy": {
        const goal = argsToTradeGoal(step.arguments);
        const withTimeout = Promise.race([
          deps.runRecommendation(goal, portfolioToken, optionsToken),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "BRAIN_TOOL_TIMEOUT" })), timeoutMs),
          ),
        ]);
        data = await withTimeout;
        break;
      }

      // ----------------------------------------------------------------
      case "rank_market_trade_candidates": {
        const goal = argsToTradeGoal(step.arguments);
        const withTimeout = Promise.race([
          deps.runRanked(goal, portfolioToken),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "BRAIN_TOOL_TIMEOUT" })), timeoutMs),
          ),
        ]);
        data = await withTimeout;
        break;
      }

      // ----------------------------------------------------------------
      case "plan_portfolio_trade": {
        const goal = argsToPortfolioGoal(step.arguments);
        const withTimeout = Promise.race([
          deps.runPortfolioPlan(goal, portfolioToken, optionsToken),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "BRAIN_TOOL_TIMEOUT" })), timeoutMs),
          ),
        ]);
        data = await withTimeout;
        break;
      }

      // ----------------------------------------------------------------
      case "openai_explanation": {
        if (!deps.runOpenAi) {
          data = null;
          break;
        }
        const role = (step.arguments.role ?? "explanation") as "explanation" | "prose" | "education";
        const question = step.arguments.question as string ?? "";
        const withTimeout = Promise.race([
          deps.runOpenAi(role, question, collectedEvidence),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "OPENAI_TIMEOUT" })), timeoutMs),
          ),
        ]);
        data = await withTimeout;
        break;
      }

      // ----------------------------------------------------------------
      default: {
        // Tool not yet wired in executor — treat as optional skip
        throw Object.assign(
          new Error(`Brain executor: tool "${step.tool}" not wired`),
          { code: "BRAIN_TOOL_NOT_WIRED" },
        );
      }
    }

    const ev = wrapSuccess(step.id, step.tool, data, Date.now() - start);
    logBrainStep(requestId, ev);
    return ev;
  } catch (err: unknown) {
    const code = safeCode(err);
    const ev = wrapFailure(step.id, step.tool, code, Date.now() - start);
    logBrainStep(requestId, ev);
    return ev;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Executes a ToolPlan step-by-step.
 *
 * - Steps with no dependencies run concurrently (up to MAX_CONCURRENCY).
 * - A required step failure marks remaining steps as skipped; returns early.
 * - Optional step failure is captured; execution continues.
 * - Context tokens are injected per trustedContextScopes; never stored in args.
 */
const MAX_CONCURRENCY = 3;

export async function executeToolPlan(
  plan: ToolPlan,
  ctx: TrustedContext,
  deps: BrainExecutorDeps,
  requestId: string,
): Promise<ToolEvidence[]> {
  const evidence: ToolEvidence[] = [];
  const completed = new Set<string>();
  const failed    = new Set<string>(); // failed OR skipped step IDs

  // Inject question into openai_explanation steps (not in plan args to keep
  // them credential-free; we add it here at execution time).
  const stepsWithQuestion = plan.steps.map((s) =>
    s.tool === "openai_explanation"
      ? { ...s, arguments: { ...s.arguments, question: plan.normalizedRequest.rawPrompt } }
      : s,
  );

  // Topological execution: iterate until all steps are resolved.
  let remaining = [...stepsWithQuestion];

  while (remaining.length > 0) {
    // Find steps whose dependencies are all satisfied.
    const ready = remaining.filter((s) =>
      s.dependsOn.every((dep) => completed.has(dep) || failed.has(dep)),
    );

    if (ready.length === 0) {
      // Circular dependency or all blocked — skip remainder
      for (const s of remaining) {
        const ev = wrapSkipped(s.id, s.tool, "blocked by earlier failure or unresolvable dependency");
        evidence.push(ev);
        logBrainStep(requestId, ev);
      }
      break;
    }

    // Check whether any ready required step was blocked (dependency failed)
    for (const s of ready) {
      const depFailed = s.dependsOn.some((dep) => failed.has(dep));
      if (depFailed) {
        const ev = wrapSkipped(s.id, s.tool, `dependency failed: ${s.dependsOn.filter((d) => failed.has(d)).join(", ")}`);
        evidence.push(ev);
        logBrainStep(requestId, ev);
        if (s.required) {
          // Required step cannot run → abort
          failed.add(s.id);
          const rest = remaining.filter((r) => !ready.includes(r));
          for (const r of rest) {
            const ev2 = wrapSkipped(r.id, r.tool, "aborted: earlier required step failed");
            evidence.push(ev2);
            logBrainStep(requestId, ev2);
          }
          return evidence;
        }
        failed.add(s.id);
      }
    }

    // Runnable steps (all deps satisfied, not blocked)
    const runnable = ready.filter((s) => !failed.has(s.id));
    remaining = remaining.filter((s) => !ready.includes(s));

    // Execute runnable steps with bounded concurrency
    for (let i = 0; i < runnable.length; i += MAX_CONCURRENCY) {
      const batch = runnable.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.all(
        batch.map((s) => runStep(s, ctx, deps, evidence, requestId)),
      );

      for (let j = 0; j < results.length; j++) {
        const ev = results[j];
        const step = batch[j];
        evidence.push(ev);

        if (ev.status === "failed") {
          failed.add(step.id);
          if (step.required) {
            // Required step failed → skip all remaining
            for (const r of remaining) {
              const ev2 = wrapSkipped(r.id, r.tool, "aborted: required step failed");
              evidence.push(ev2);
              logBrainStep(requestId, ev2);
            }
            return evidence;
          }
        } else {
          completed.add(step.id);
        }
      }
    }
  }

  return evidence;
}
