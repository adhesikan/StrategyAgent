// TraderBrain Core — Deterministic Planner.
//
// Produces a ToolPlan from a NormalizedBrainRequest. Pure function — no I/O,
// no MCP calls, no OpenAI calls. Same input always produces the same plan.
//
// Invariants:
//   - No tool appears twice in a plan.
//   - dependsOn forms an acyclic graph (enforced structurally — each step
//     only references IDs of earlier steps).
//   - Arguments never contain userId, accountId, broker tokens, or credentials.
//   - OpenAI is never used to select tools.

import type {
  ToolPlan,
  ToolPlanStep,
  NormalizedBrainRequest,
  TraderBrainIntent,
  ResponsePolicy,
} from "./types";

// ---------------------------------------------------------------------------
// Timeout budgets (ms) referenced by BrainExecutor
// ---------------------------------------------------------------------------

export const TIMEOUT_MS: Record<"fast" | "standard" | "extended", number> = {
  fast:     5_000,
  standard: 15_000,
  extended: 45_000,
};

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

function multiStrategyStep(symbol: string): ToolPlanStep {
  return {
    id: "analysis",
    tool: "multi_strategy_analysis",
    arguments: { symbol },
    dependsOn: [],
    required: true,
    timeoutClass: "extended",
    trustedContextScopes: ["NONE"],
    failurePolicy: "abort_request",
  };
}

function recommendStep(req: NormalizedBrainRequest, dependsOn: string[] = []): ToolPlanStep {
  const args: Record<string, unknown> = {};
  if (req.symbol) args.symbol = req.symbol;
  if (req.direction) args.direction = req.direction;
  if (req.instrumentPreference) args.instrumentPreference = req.instrumentPreference;
  if (req.objective) args.objective = req.objective;
  if (req.requestedStrategy) args.requestedStrategy = req.requestedStrategy;
  if (typeof req.maxRiskDollars === "number") args.maxRiskDollars = req.maxRiskDollars;
  if (typeof req.maxRiskPercent === "number") args.maxRiskPercent = req.maxRiskPercent;
  return {
    id: "recommend",
    tool: "recommend_trade_strategy",
    arguments: args,
    dependsOn,
    required: true,
    timeoutClass: "extended",
    trustedContextScopes: ["PORTFOLIO_CONTEXT", "OPTIONS_CONTEXT"],
    failurePolicy: "abort_request",
  };
}

function rankStep(req: NormalizedBrainRequest): ToolPlanStep {
  const args: Record<string, unknown> = {};
  if (req.direction) args.direction = req.direction;
  if (req.instrumentPreference) args.instrumentPreference = req.instrumentPreference;
  if (req.objective) args.objective = req.objective;
  if (req.requestedStrategy) args.requestedStrategy = req.requestedStrategy;
  if (typeof req.maxRiskDollars === "number") args.maxRiskDollars = req.maxRiskDollars;
  if (typeof req.maxRiskPercent === "number") args.maxRiskPercent = req.maxRiskPercent;
  if (typeof req.numberOfIdeas === "number") args.numberOfIdeas = req.numberOfIdeas;
  if (req.universeHint) args.universeHint = req.universeHint;
  return {
    id: "rank",
    tool: "rank_market_trade_candidates",
    arguments: args,
    dependsOn: [],
    required: true,
    timeoutClass: "extended",
    trustedContextScopes: ["PORTFOLIO_CONTEXT"],
    failurePolicy: "abort_request",
  };
}

function portfolioTradeStep(req: NormalizedBrainRequest): ToolPlanStep {
  const pc = req.portfolioConstraints;
  const args: Record<string, unknown> = {};
  if (pc?.maxRiskDollars != null) args.maxRiskDollars = pc.maxRiskDollars;
  if (pc?.maxRiskPercent != null) args.maxRiskPercent = pc.maxRiskPercent;
  if (pc?.excludeSectors?.length) args.excludeSectors = pc.excludeSectors;
  if (pc?.requireExistingPosition) args.requireExistingPosition = true;
  if (pc?.objective) args.objective = pc.objective;
  if (req.direction) args.direction = req.direction;
  if (req.instrumentPreference) args.instrumentPreference = req.instrumentPreference;
  if (typeof req.numberOfIdeas === "number") args.numberOfIdeas = req.numberOfIdeas;
  return {
    id: "portfolio_plan",
    tool: "plan_portfolio_trade",
    arguments: args,
    dependsOn: [],
    required: true,
    timeoutClass: "extended",
    trustedContextScopes: ["PORTFOLIO_CONTEXT", "OPTIONS_CONTEXT"],
    failurePolicy: "degrade_to_market_only",
  };
}

function openAiStep(role: "explanation" | "prose" | "education", dependsOn: string[]): ToolPlanStep {
  return {
    id: "openai",
    tool: "openai_explanation",
    arguments: { role },
    dependsOn,
    required: false,
    timeoutClass: "standard",
    trustedContextScopes: ["NONE"],
    failurePolicy: "use_rule_based_fallback",
  };
}

// ---------------------------------------------------------------------------
// Per-intent plan constructors
// ---------------------------------------------------------------------------

function planAnalyzeSymbol(req: NormalizedBrainRequest): ToolPlan {
  const symbol = req.symbol ?? req.tickers[0] ?? "";
  const steps: ToolPlanStep[] = [
    multiStrategyStep(symbol),
    openAiStep("explanation", ["analysis"]),
  ];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "explanation", ctaSource: "stage" },
  };
}

function planRecommendSymbolTrade(req: NormalizedBrainRequest): ToolPlan {
  const steps: ToolPlanStep[] = [
    recommendStep(req),
    openAiStep("explanation", ["recommend"]),
  ];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "explanation", ctaSource: "verdict" },
  };
}

function planRankMarketTrades(req: NormalizedBrainRequest): ToolPlan {
  const steps: ToolPlanStep[] = [rankStep(req)];
  // No OpenAI for ranked results — deterministic buckets are self-contained.
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: false, openAiRole: "none", ctaSource: "verdict" },
  };
}

function planPortfolioTrade(req: NormalizedBrainRequest): ToolPlan {
  const steps: ToolPlanStep[] = [
    portfolioTradeStep(req),
    openAiStep("explanation", ["portfolio_plan"]),
  ];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "explanation", ctaSource: "verdict" },
  };
}

function planCombinedAnalysisRecommendation(req: NormalizedBrainRequest): ToolPlan {
  const symbol = req.symbol ?? req.tickers[0] ?? "";
  // Analysis and recommendation run concurrently with no dependency between them.
  // Either step failing does not abort the other — partial results are preserved.
  // Failure policy for each: "skip_section" → the section is omitted + warned,
  // and the other section is still returned to the user.
  //
  // OpenAI depends on nothing (dependsOn: []) so it always runs and can explain
  // whichever sections succeeded. The composer builds the explanation using only
  // the sections that are present.
  const steps: ToolPlanStep[] = [
    {
      ...multiStrategyStep(symbol),
      required: false,
      failurePolicy: "skip_section" as const,
    },
    {
      ...recommendStep(req),        // no dependsOn — runs regardless of analysis
      required: false,
      failurePolicy: "skip_section" as const,
    },
    openAiStep("explanation", []),  // independent — always runs, sees all evidence
  ];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "explanation", ctaSource: "verdict" },
  };
}

function planExplainConcept(req: NormalizedBrainRequest): ToolPlan {
  const steps: ToolPlanStep[] = [
    // No MCP tools — education is OpenAI-only.
    openAiStep("education", []),
  ];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "education", ctaSource: "intent" },
  };
}

function planEducationPlusAction(req: NormalizedBrainRequest): ToolPlan {
  // Recommend first (for the action component), then OpenAI explains both.
  const steps: ToolPlanStep[] = [];
  if (req.symbol) {
    steps.push(recommendStep(req));
    steps.push(openAiStep("education", ["recommend"]));
  } else {
    steps.push(rankStep(req));
    steps.push(openAiStep("education", ["rank"]));
  }
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "education", ctaSource: "intent" },
  };
}

function planMarketResearch(req: NormalizedBrainRequest): ToolPlan {
  const steps: ToolPlanStep[] = [openAiStep("prose", [])];
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps,
    responsePolicy: { requiresOpenAi: true, openAiRole: "prose", ctaSource: "intent" },
  };
}

function planUnknown(req: NormalizedBrainRequest): ToolPlan {
  return {
    intent: req.intent,
    normalizedRequest: req,
    steps: [openAiStep("prose", [])],
    responsePolicy: {
      requiresOpenAi: true,
      openAiRole: "prose",
      ctaSource: "intent",
    },
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic ToolPlan for a NormalizedBrainRequest.
 *
 * Guarantees:
 *   - No tool appears twice.
 *   - No I/O performed.
 *   - Same input → same plan.
 *   - OpenAI step is always optional (required: false).
 *   - Plan arguments never contain credentials or tokens.
 */
export function buildToolPlan(req: NormalizedBrainRequest): ToolPlan {
  const intent: TraderBrainIntent = req.intent;
  switch (intent) {
    case "ANALYZE_SYMBOL":                    return planAnalyzeSymbol(req);
    case "RECOMMEND_SYMBOL_TRADE":            return planRecommendSymbolTrade(req);
    case "RANK_MARKET_TRADES":                return planRankMarketTrades(req);
    case "PLAN_PORTFOLIO_TRADE":              return planPortfolioTrade(req);
    case "COMBINED_ANALYSIS_RECOMMENDATION": return planCombinedAnalysisRecommendation(req);
    case "EXPLAIN_CONCEPT":                   return planExplainConcept(req);
    case "EDUCATION_PLUS_ACTION":             return planEducationPlusAction(req);
    case "MARKET_RESEARCH":                   return planMarketResearch(req);
    case "UNKNOWN":                           return planUnknown(req);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (used in tests)
// ---------------------------------------------------------------------------

/** Returns true when no tool ID appears more than once in the plan. */
export function planHasNoDuplicateTools(plan: ToolPlan): boolean {
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.tool)) return false;
    seen.add(step.tool);
  }
  return true;
}

/** Returns true when all dependsOn IDs reference earlier steps. */
export function planDepsAreValid(plan: ToolPlan): boolean {
  const defined = new Set<string>();
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!defined.has(dep)) return false;
    }
    defined.add(step.id);
  }
  return true;
}

/** Returns true when OpenAI step (if present) is always optional. */
export function openAiStepIsOptional(plan: ToolPlan): boolean {
  for (const step of plan.steps) {
    if (step.tool === "openai_explanation" && step.required) return false;
  }
  return true;
}

/** Returns argument keys that look like credentials. For security tests. */
export function findCredentialArgs(plan: ToolPlan): string[] {
  const SUSPICIOUS = [
    "token", "apikey", "api_key", "secret", "password", "credential",
    "userId", "user_id", "accountId", "account_id", "connectionId",
    "connection_id", "brokerId", "broker_token", "portfolioToken",
    "optionsToken", "auth", "bearer",
  ];
  const found: string[] = [];
  for (const step of plan.steps) {
    for (const key of Object.keys(step.arguments)) {
      if (SUSPICIOUS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        found.push(`${step.id}.${key}`);
      }
    }
  }
  return found;
}
