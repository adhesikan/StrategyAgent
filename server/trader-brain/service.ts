// TraderBrain Core — Service.
//
// TraderBrainService.execute() is the single public entry point.
// It assembles TrustedContext-wired deps, classifies intent, normalizes the
// request, builds a tool plan, executes it, and composes the result.
//
// Integration: currently called in shadow mode alongside the existing ask.ts
// path. The `traderBrain` field is added to the AskResponse when
// TRADER_BRAIN_ENABLED includes the matched intent. No existing fields are
// removed or altered.
//
// Feature flag: TRADER_BRAIN_ENABLED env var (see isBrainEnabled below).

import type {
  TraderBrainRequest,
  TrustedContext,
  TraderBrainResult,
  TraderBrainResponseField,
  TraderBrainIntent,
} from "./types";
import { classifyBrainIntent } from "./intent-classifier";
import { normalizeBrainRequest } from "./request-normalizer";
import { buildToolPlan } from "./planner";
import { executeToolPlan, type BrainExecutorDeps } from "./executor";
import {
  composeBrainResult,
  buildFallbackResult,
  projectToResponseField,
} from "./composer";
import {
  logBrainRequest,
  logBrainPlan,
  logBrainComplete,
  logBrainFailure,
} from "./observability";

// ---------------------------------------------------------------------------
// Authoritative intents — Brain is the primary engine for these (Sprint 5.1).
// Legacy callOpenAi becomes the fallback on any Brain failure.
// ---------------------------------------------------------------------------

export const BRAIN_AUTHORITATIVE_INTENTS = new Set<TraderBrainIntent>([
  "RANK_MARKET_TRADES",
  "PLAN_PORTFOLIO_TRADE",
  "RECOMMEND_SYMBOL_TRADE",
  "COMBINED_ANALYSIS_RECOMMENDATION",
  "EDUCATION_PLUS_ACTION",
]);

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Returns true when the TraderBrain is enabled for the given intent.
 *
 * Env var: TRADER_BRAIN_ENABLED
 *   "false" or unset → disabled for all intents (shadow mode off)
 *   "all"            → enabled for all intents
 *   "shadow"         → enabled for all (shadow projection only, no replacement)
 *   Comma list       → enabled for listed intents only
 *     e.g. "COMBINED_ANALYSIS_RECOMMENDATION,RECOMMEND_SYMBOL_TRADE"
 */
export function isBrainEnabled(intent: TraderBrainIntent): boolean {
  const flag = (process.env.TRADER_BRAIN_ENABLED ?? "false").trim().toLowerCase();
  if (flag === "false" || flag === "" || flag === "0") return false;
  if (flag === "all" || flag === "shadow") return true;
  return flag.split(",").map((s) => s.trim().toUpperCase()).includes(intent);
}

// ---------------------------------------------------------------------------
// Dep wiring — connects existing orchestration modules to executor callbacks
// ---------------------------------------------------------------------------

/**
 * Builds the BrainExecutorDeps by wiring existing orchestration functions.
 * All token injection happens here — deps receive tokens from TrustedContext,
 * not from plan arguments.
 */
export async function buildDeps(ctx: TrustedContext): Promise<BrainExecutorDeps> {
  const [
    { runMultiStrategyAnalysis }  ,
    { runStrategyRecommendation } ,
    { runRankedTradeSearch }      ,
    { runPortfolioTradePlan }     ,
    mcpTools                      ,
  ] = await Promise.all([
    import("../mcp/multi-strategy-analysis"),
    import("../mcp/strategy-recommendation"),
    import("../routes/ranked-trade-search"),
    import("../routes/portfolio-trade-plan"),
    import("../mcp/tools"),
  ]);

  const { scanStrategy, buildTradeCandidate } = mcpTools;

  return {
    async runAnalysis(symbol) {
      return runMultiStrategyAnalysis(symbol, {
        scanStrategy: (sym, strategy, tf) => scanStrategy(sym, strategy, tf),
        buildTradeCandidate: (sym, strategy) => buildTradeCandidate(sym, strategy),
      });
    },

    async runRecommendation(goal, _portfolioToken, optionsToken) {
      // NOTE: The existing StrategyRecommendationDeps contract does not currently
      // accept portfolioContextToken (recommendation path uses options-context
      // only). _portfolioToken is accepted by the BrainExecutorDeps interface
      // for future wiring — silently unused here.
      const { recommendTradeStrategy } = mcpTools;
      return runStrategyRecommendation(goal, {
        recommend: (args) => recommendTradeStrategy(args),
        optionsContextToken: optionsToken,
      });
    },

    async runRanked(goal, portfolioToken) {
      const { rankMarketTradeCandidates } = mcpTools;
      // RankedTradeSearchDeps.rank receives RankMarketTradeCandidatesArgs;
      // portfolioContextToken is injected into the args, not the deps.
      return runRankedTradeSearch(goal, {
        rank: (args) => rankMarketTradeCandidates({
          ...args,
          ...(portfolioToken ? { portfolioContextToken: portfolioToken } : {}),
        }),
      });
    },

    async runPortfolioPlan(goal, portfolioToken, optionsToken) {
      const { planPortfolioTrade } = mcpTools;
      // Both context tokens are injected into PlanPortfolioTradeArgs, not deps.
      return runPortfolioTradePlan(goal, {
        planPortfolioTrade: (args) =>
          planPortfolioTrade({
            ...args,
            ...(portfolioToken ? { portfolioContextToken: portfolioToken } : {}),
            ...(optionsToken   ? { optionsContextToken: optionsToken }    : {}),
          }),
      });
    },

    // OpenAI is intentionally not wired in Phase 0 (shadow mode).
    // Wire it in Phase 1 once the deterministic path is validated.
    runOpenAi: undefined,
  };
}

// ---------------------------------------------------------------------------
// TraderBrainService
// ---------------------------------------------------------------------------

export class TraderBrainService {
  /**
   * Execute a TraderBrainRequest and return a TraderBrainResult.
   *
   * Invariants:
   *   - Never throws to the caller (returns error-status result instead).
   *   - Never fabricates a trade or recommendation.
   *   - Never includes tokens, account IDs, or broker credentials in result.
   *   - Evidence envelopes must be stripped before any client-facing projection.
   */
  async execute(
    req: TraderBrainRequest,
    ctx: TrustedContext,
  ): Promise<TraderBrainResult> {
    const start = Date.now();

    // 1. Classify intent
    const intent = classifyBrainIntent(req.question, ctx.tickers);

    // 2. Normalize
    const normalized = normalizeBrainRequest(intent, req.question, ctx.tickers);
    logBrainRequest(req.requestId, normalized);

    // 3. Plan
    const plan = buildToolPlan(normalized);
    logBrainPlan(req.requestId, plan);

    try {
      // 4. Wire deps
      const deps = await buildDeps(ctx);

      // 5. Execute
      const evidence = await executeToolPlan(plan, ctx, deps, req.requestId);

      // 6. Compose
      const result = composeBrainResult(req.requestId, plan, evidence, ctx);

      logBrainComplete(
        req.requestId,
        intent,
        result.status,
        Date.now() - start,
        Object.keys(result.sections).filter(
          (k) => result.sections[k as keyof typeof result.sections] != null,
        ),
        result.openAiUsed,
        result.warnings.length,
      );

      return result;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && typeof (err as Record<string, unknown>).code === "string"
          ? String((err as Record<string, unknown>).code)
          : "BRAIN_UNEXPECTED_ERROR";

      logBrainFailure(req.requestId, intent, code, Date.now() - start);
      return buildFallbackResult(req.requestId, plan, code);
    }
  }
}

// Singleton for use in ask.ts route handler
export const traderBrainService = new TraderBrainService();

// ---------------------------------------------------------------------------
// Convenience: run brain in shadow mode and return the additive field.
// Never throws. Returns undefined on any failure.
// ---------------------------------------------------------------------------

/**
 * Runs the TraderBrain for a question in shadow mode.
 * Returns a safe `traderBrain` response field if the intent is enabled,
 * or undefined if disabled or an unexpected error occurs.
 *
 * Does NOT alter the existing ask.ts response.
 */
export async function runBrainShadow(
  requestId: string,
  question: string,
  ctx: TrustedContext,
): Promise<TraderBrainResponseField | undefined> {
  try {
    const intent = classifyBrainIntent(question, ctx.tickers);
    if (!isBrainEnabled(intent)) return undefined;

    const result = await traderBrainService.execute({ requestId, question }, ctx);
    return projectToResponseField(result);
  } catch {
    return undefined;
  }
}

/**
 * Runs the TraderBrain for a question and returns both the client-safe field
 * AND the full internal result for shadow comparison.
 *
 * Used in the general ask.ts path when shadow validation is active.
 * Never throws. Returns `{ field: undefined, result: undefined }` on any failure.
 */
export async function runBrainShadowFull(
  requestId: string,
  question: string,
  ctx: TrustedContext,
): Promise<{ field: TraderBrainResponseField | undefined; result: TraderBrainResult | undefined }> {
  try {
    const intent = classifyBrainIntent(question, ctx.tickers);
    if (!isBrainEnabled(intent)) return { field: undefined, result: undefined };

    const result = await traderBrainService.execute({ requestId, question }, ctx);
    return { field: projectToResponseField(result), result };
  } catch {
    return { field: undefined, result: undefined };
  }
}
