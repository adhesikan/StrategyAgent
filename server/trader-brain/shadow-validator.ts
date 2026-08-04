// TraderBrain — Shadow Validation Engine.
//
// Compares Brain output against legacy ask.ts output along 8 structural
// dimensions. Pure function — no I/O, no MCP calls, no OpenAI calls.
// Never logs full payloads, user IDs, or credential material.
//
// Comparison verdicts:
//   MATCH               — Both systems agree on this dimension.
//   EXPECTED_DIFFERENCE — Difference is explainable by design (finer-grained
//                         intents, Phase-0 token gap, tool-level abstraction).
//   MISMATCH            — Unexpected disagreement that blocks migration.
//
// Mismatch categories (per dimension):
//   INTENT_MISMATCH         — Brain picked an incompatible intent bucket.
//   ARGUMENT_MISMATCH       — Symbol / count / risk params disagree.
//   TOOL_PLAN_MISMATCH      — Brain selected different primary tools.
//   VERDICT_MISMATCH        — Recommendation / ranked verdicts diverge.
//   COUNT_MISMATCH          — Candidate count is materially different.
//   DATA_QUALITY_MISMATCH   — Simulated/estimated state differs.
//   CTA_MISMATCH            — CTA gate eligibility diverges.
//   FAILURE_POLICY_MISMATCH — One side reports failure, other does not.

import type {
  TraderBrainIntent,
  BrainExecutionStatus,
  BrainToolId,
  TraderBrainResult,
  ToolEvidence,
} from "./types";

// ---------------------------------------------------------------------------
// Public snapshot types
// ---------------------------------------------------------------------------

/** Legacy intent vocabulary from ask.ts classifyIntent(). */
export type LegacyIntent =
  | "best-trade"
  | "income"
  | "growth"
  | "news"
  | "trade-idea"
  | "general";

/** Which MCP / deterministic branch ran in the legacy ask.ts path. */
export type LegacyToolBranch =
  | "recommendation"        // strategyRecommendation only
  | "combined"              // multiStrategyAnalysis + strategyRecommendation
  | "multi_strategy"        // multiStrategyAnalysis only
  | "vcp"                   // vcpAnalysis (legacy)
  | "ranked_trade_search"   // runRankedTradeSearch early-return branch
  | "portfolio_trade_plan"  // runPortfolioTradePlan early-return branch
  | "openai_only";          // no deterministic data used

/**
 * Lightweight snapshot of the legacy ask.ts response.
 * Never contains full payloads — only the scalar fields needed for comparison.
 * Extracted in ask.ts before res.json(); passed to the comparator.
 */
export interface LegacyAskSnapshot {
  /** From classifyIntent(question) */
  legacyIntent: LegacyIntent;
  /** From extractTickers(question) */
  tickers: string[];
  /** Which deterministic branch ran */
  toolBranch: LegacyToolBranch;
  /** Primary symbol (tickers[0] when single-symbol intent) */
  symbol?: string;
  /** strategyRecommendation?.recommendations[0]?.overallVerdict */
  verdict?: string;
  /** rankedTradeSearch?.qualifiedCount */
  qualifiedCount?: number;
  /** rankedTradeSearch?.candidates.length + watchCandidates.length */
  totalCandidateCount?: number;
  /** answer.warnings.length + answer.limitations?.length (approx) */
  warningCount: number;
  /** True when VCP/scan data was simulated or quality-flagged */
  hasDataQualityFlag: boolean;
  /** True when a known failure was surfaced (recommendationFailed / vcpScanFailed) */
  hasFailure: boolean;
  failureKind?: "recommendation" | "vcp" | "ranked" | "portfolio";
  /** Legacy confidence field */
  confidence?: "low" | "medium" | "high";
}

/**
 * Lightweight snapshot of the TraderBrain result.
 * Extracted via extractBrainSnapshot() — never contains full evidence payloads.
 */
export interface BrainValidationSnapshot {
  intent: TraderBrainIntent;
  /** Non-openai tools selected in the plan (in execution order) */
  primaryTools: BrainToolId[];
  /** True when an openai_explanation step was in the plan */
  openAiPlanned: boolean;
  symbol?: string;
  direction?: string;
  numberOfIdeas?: number;
  maxRiskDollars?: number;
  /** First non-null verdict from evidence (recommendation or ranked) */
  verdict?: string;
  qualifiedCount?: number;
  totalCandidateCount?: number;
  warningCount: number;
  dataQuality: {
    estimated: boolean;
    simulated: boolean;
    partial: boolean;
    stale: boolean;
  };
  /** Gate values from nextActions */
  ctaGates: string[];
  status: BrainExecutionStatus;
  hasFailure: boolean;
}

// ---------------------------------------------------------------------------
// Comparison output types
// ---------------------------------------------------------------------------

export type ShadowVerdict = "MATCH" | "EXPECTED_DIFFERENCE" | "MISMATCH";

export type MismatchCategory =
  | "INTENT_MISMATCH"
  | "ARGUMENT_MISMATCH"
  | "TOOL_PLAN_MISMATCH"
  | "VERDICT_MISMATCH"
  | "COUNT_MISMATCH"
  | "DATA_QUALITY_MISMATCH"
  | "CTA_MISMATCH"
  | "FAILURE_POLICY_MISMATCH";

export interface DimensionResult {
  dimension: string;
  verdict: ShadowVerdict;
  category?: MismatchCategory;
  /** Safe scalar summary — never a full payload. */
  brainValue: string | number | boolean | string[] | null | undefined;
  legacyValue: string | number | boolean | string[] | null | undefined;
  note?: string;
}

export interface ShadowValidationResult {
  requestId: string;
  overallVerdict: ShadowVerdict;
  mismatchCategories: MismatchCategory[];
  dimensions: DimensionResult[];
  /** True when no blocking mismatches prevent production migration. */
  migratable: boolean;
  /** Human-readable reasons that block migration. */
  blockers: string[];
}

// ---------------------------------------------------------------------------
// extractBrainSnapshot — derives a safe snapshot from TraderBrainResult
// ---------------------------------------------------------------------------

export function extractBrainSnapshot(result: TraderBrainResult): BrainValidationSnapshot {
  const primaryTools = result.evidence
    .filter((e) => e.tool !== "openai_explanation")
    .map((e) => e.tool);

  const openAiPlanned = result.evidence.some((e) => e.tool === "openai_explanation");

  // Verdict: recommendation first, then ranked first candidate
  let verdict: string | undefined;
  let qualifiedCount: number | undefined;
  let totalCandidateCount: number | undefined;

  const rec = result.sections.recommendation;
  if (rec?.recommendations?.[0]?.overallVerdict) {
    verdict = String(rec.recommendations[0].overallVerdict);
  }

  const ranked = result.sections.rankedSearch;
  if (ranked) {
    qualifiedCount = ranked.qualifiedCount;
    totalCandidateCount = ranked.candidates.length + ranked.watchCandidates.length;
    if (!verdict && ranked.candidates[0]) {
      verdict = (ranked.candidates[0] as Record<string, unknown>).verdict as string | undefined;
    }
  }

  // Portfolio plan
  const pp = result.sections.portfolioTradePlan;
  if (pp) {
    qualifiedCount = pp.qualifiedCandidates.length;
    totalCandidateCount = pp.qualifiedCandidates.length;
    if (!verdict) {
      verdict = pp.feasibility.feasible ? "FEASIBLE" : "NOT_FEASIBLE";
    }
  }

  // Aggregate data quality across all evidence
  const dq = aggregateDataQuality(result.evidence);

  return {
    intent: result.intent,
    primaryTools,
    openAiPlanned,
    symbol: result.normalizedRequest.symbol,
    direction: result.normalizedRequest.direction,
    numberOfIdeas: result.normalizedRequest.numberOfIdeas,
    maxRiskDollars: result.normalizedRequest.maxRiskDollars,
    verdict,
    qualifiedCount,
    totalCandidateCount,
    warningCount: result.warnings.length,
    dataQuality: dq,
    ctaGates: result.nextActions
      .map((a) => a.gate ?? "always")
      .filter((g) => g !== undefined),
    status: result.status,
    hasFailure: result.status === "unavailable" || result.status === "error",
  };
}

function aggregateDataQuality(evidence: ToolEvidence[]): BrainValidationSnapshot["dataQuality"] {
  let estimated = false, simulated = false, partial = false, stale = false;
  for (const ev of evidence) {
    if (ev.dataQuality.estimated) estimated = true;
    if (ev.dataQuality.simulated) simulated = true;
    if (ev.dataQuality.partial) partial = true;
    if (ev.dataQuality.stale) stale = true;
  }
  return { estimated, simulated, partial, stale };
}

// ---------------------------------------------------------------------------
// Intent compatibility map
// ---------------------------------------------------------------------------

/**
 * Maps each legacy intent to the Brain intents that are considered compatible.
 * MATCH uses the "canonical" set; presence in "acceptable" yields EXPECTED_DIFFERENCE.
 */
const INTENT_CANONICAL: Record<LegacyIntent, TraderBrainIntent[]> = {
  "best-trade":  ["RANK_MARKET_TRADES"],
  "income":      ["RECOMMEND_SYMBOL_TRADE", "RANK_MARKET_TRADES"],
  "growth":      ["RECOMMEND_SYMBOL_TRADE", "RANK_MARKET_TRADES"],
  "news":        ["MARKET_RESEARCH"],
  "trade-idea":  ["RECOMMEND_SYMBOL_TRADE", "COMBINED_ANALYSIS_RECOMMENDATION"],
  "general":     ["EXPLAIN_CONCEPT", "ANALYZE_SYMBOL", "UNKNOWN", "MARKET_RESEARCH"],
};

const INTENT_ACCEPTABLE: Record<LegacyIntent, TraderBrainIntent[]> = {
  "best-trade":  ["RECOMMEND_SYMBOL_TRADE", "PLAN_PORTFOLIO_TRADE"],
  "income":      ["PLAN_PORTFOLIO_TRADE", "EDUCATION_PLUS_ACTION"],
  "growth":      ["COMBINED_ANALYSIS_RECOMMENDATION", "PLAN_PORTFOLIO_TRADE"],
  "news":        ["ANALYZE_SYMBOL"],
  "trade-idea":  ["RANK_MARKET_TRADES", "PLAN_PORTFOLIO_TRADE", "ANALYZE_SYMBOL", "EDUCATION_PLUS_ACTION"],
  "general":     ["EDUCATION_PLUS_ACTION"],
};

// ---------------------------------------------------------------------------
// Tool branch compatibility map
// ---------------------------------------------------------------------------

/** Primary (non-openai) tools expected for each legacy tool branch. */
const BRANCH_CANONICAL_TOOLS: Record<LegacyToolBranch, BrainToolId[]> = {
  "recommendation":      ["recommend_trade_strategy"],
  "combined":            ["multi_strategy_analysis", "recommend_trade_strategy"],
  "multi_strategy":      ["multi_strategy_analysis"],
  "vcp":                 ["multi_strategy_analysis"],  // Brain replaces VCP-only with multi-strategy
  "ranked_trade_search": ["rank_market_trade_candidates"],
  "portfolio_trade_plan":["plan_portfolio_trade"],
  "openai_only":         [],
};

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function compareIntent(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  const canonical = INTENT_CANONICAL[legacy.legacyIntent] ?? [];
  const acceptable = INTENT_ACCEPTABLE[legacy.legacyIntent] ?? [];

  if (canonical.includes(brain.intent)) {
    return {
      dimension: "intent",
      verdict: "MATCH",
      brainValue: brain.intent,
      legacyValue: legacy.legacyIntent,
    };
  }
  if (acceptable.includes(brain.intent)) {
    return {
      dimension: "intent",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: brain.intent,
      legacyValue: legacy.legacyIntent,
      note: "Brain uses finer-grained intent classification",
    };
  }
  return {
    dimension: "intent",
    verdict: "MISMATCH",
    category: "INTENT_MISMATCH",
    brainValue: brain.intent,
    legacyValue: legacy.legacyIntent,
    note: `Brain intent not compatible with legacy "${legacy.legacyIntent}"`,
  };
}

function compareArguments(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  const issues: string[] = [];

  // Symbol: only compare when both sides had a single-symbol intent
  if (legacy.symbol && brain.symbol) {
    if (legacy.symbol.toUpperCase() !== brain.symbol.toUpperCase()) {
      issues.push(`symbol: brain="${brain.symbol}" legacy="${legacy.symbol}"`);
    }
  }
  // Symbol present in legacy but brain missed it
  if (legacy.symbol && !brain.symbol &&
    (brain.intent === "RECOMMEND_SYMBOL_TRADE" || brain.intent === "COMBINED_ANALYSIS_RECOMMENDATION" || brain.intent === "ANALYZE_SYMBOL")
  ) {
    issues.push(`brain missing symbol="${legacy.symbol}"`);
  }

  if (issues.length > 0) {
    return {
      dimension: "arguments",
      verdict: "MISMATCH",
      category: "ARGUMENT_MISMATCH",
      brainValue: brain.symbol ?? null,
      legacyValue: legacy.symbol ?? null,
      note: issues.join("; "),
    };
  }

  // Warn when both have risk but they differ — EXPECTED_DIFFERENCE not MISMATCH
  // (normalizers parse independently; minor differences in risk extraction are expected)
  if (typeof brain.maxRiskDollars === "number" && legacy.toolBranch !== "portfolio_trade_plan") {
    return {
      dimension: "arguments",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: `maxRiskDollars=${brain.maxRiskDollars}`,
      legacyValue: legacy.toolBranch,
      note: "Brain normalized risk constraint; legacy handled via early-return branch",
    };
  }

  return {
    dimension: "arguments",
    verdict: "MATCH",
    brainValue: brain.symbol ?? null,
    legacyValue: legacy.symbol ?? null,
  };
}

function compareToolPlan(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  const expectedTools = BRANCH_CANONICAL_TOOLS[legacy.toolBranch] ?? [];

  // openai_only: brain should have either openai or an honest unavailable
  if (legacy.toolBranch === "openai_only") {
    const onlyOpenAi = brain.primaryTools.length === 0;
    if (onlyOpenAi || brain.intent === "EXPLAIN_CONCEPT" || brain.intent === "MARKET_RESEARCH" || brain.intent === "UNKNOWN") {
      return {
        dimension: "tool_plan",
        verdict: "MATCH",
        brainValue: brain.primaryTools,
        legacyValue: legacy.toolBranch,
      };
    }
    return {
      dimension: "tool_plan",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: brain.primaryTools,
      legacyValue: legacy.toolBranch,
      note: "Brain adds deterministic MCP tools where legacy used OpenAI only",
    };
  }

  // Check exact tool match
  const brainHasAll = expectedTools.every((t) => brain.primaryTools.includes(t));
  const legacyHasAll = brain.primaryTools
    .filter((t) => t !== "openai_explanation")
    .every((t) => expectedTools.includes(t));

  if (brainHasAll && legacyHasAll) {
    return {
      dimension: "tool_plan",
      verdict: "MATCH",
      brainValue: brain.primaryTools,
      legacyValue: expectedTools,
    };
  }

  // Brain is a superset (e.g., combined vs recommendation-only) → expected
  if (brainHasAll && !legacyHasAll) {
    return {
      dimension: "tool_plan",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: brain.primaryTools,
      legacyValue: expectedTools,
      note: "Brain uses a richer tool plan (superset of legacy tools)",
    };
  }

  // Brain substitutes multi_strategy for vcp → expected
  if (
    legacy.toolBranch === "vcp" &&
    brain.primaryTools.includes("multi_strategy_analysis")
  ) {
    return {
      dimension: "tool_plan",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: brain.primaryTools,
      legacyValue: expectedTools,
      note: "Brain replaces VCP-only scan with multi-strategy analysis (superset)",
    };
  }

  return {
    dimension: "tool_plan",
    verdict: "MISMATCH",
    category: "TOOL_PLAN_MISMATCH",
    brainValue: brain.primaryTools,
    legacyValue: expectedTools,
    note: `Expected [${expectedTools.join(",")}], got [${brain.primaryTools.join(",")}]`,
  };
}

function compareVerdict(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  // Only compare when both sides had a verdict
  if (!brain.verdict && !legacy.verdict) {
    return {
      dimension: "verdict",
      verdict: "MATCH",
      brainValue: null,
      legacyValue: null,
      note: "Neither side produced a verdict",
    };
  }

  if (!brain.verdict && legacy.verdict) {
    // Phase 0: brain may not have executed MCP if status=unavailable
    if (brain.status === "unavailable" || brain.status === "error") {
      return {
        dimension: "verdict",
        verdict: "EXPECTED_DIFFERENCE",
        brainValue: `status=${brain.status}`,
        legacyValue: legacy.verdict,
        note: "Brain in unavailable/error state — no verdict produced",
      };
    }
    return {
      dimension: "verdict",
      verdict: "MISMATCH",
      category: "VERDICT_MISMATCH",
      brainValue: null,
      legacyValue: legacy.verdict,
      note: "Legacy produced verdict; Brain did not",
    };
  }

  if (brain.verdict && !legacy.verdict) {
    return {
      dimension: "verdict",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: brain.verdict,
      legacyValue: null,
      note: "Brain produced verdict; legacy path did not (normal for Phase 0 additive mode)",
    };
  }

  // Both have a verdict — normalize and compare
  const bv = String(brain.verdict).toUpperCase().trim();
  const lv = String(legacy.verdict).toUpperCase().trim();

  if (bv === lv) {
    return {
      dimension: "verdict",
      verdict: "MATCH",
      brainValue: bv,
      legacyValue: lv,
    };
  }

  // LIVE_OPTIONS / ESTIMATED_OPTIONS are functionally equivalent for CTA purposes
  const optionsEquiv = new Set(["LIVE_OPTIONS", "ESTIMATED_OPTIONS"]);
  if (optionsEquiv.has(bv) && optionsEquiv.has(lv)) {
    return {
      dimension: "verdict",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: bv,
      legacyValue: lv,
      note: "LIVE_OPTIONS / ESTIMATED_OPTIONS differ only in data source quality",
    };
  }

  return {
    dimension: "verdict",
    verdict: "MISMATCH",
    category: "VERDICT_MISMATCH",
    brainValue: bv,
    legacyValue: lv,
    note: `Verdict divergence: brain="${bv}" legacy="${lv}"`,
  };
}

function compareCount(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  // Only meaningful when both ran ranked/portfolio
  const hasBrainCount = brain.qualifiedCount !== undefined || brain.totalCandidateCount !== undefined;
  const hasLegacyCount = legacy.qualifiedCount !== undefined || legacy.totalCandidateCount !== undefined;

  if (!hasBrainCount && !hasLegacyCount) {
    return {
      dimension: "count",
      verdict: "MATCH",
      brainValue: null,
      legacyValue: null,
      note: "Count not applicable for this intent",
    };
  }

  if (!hasBrainCount && hasLegacyCount) {
    return {
      dimension: "count",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: null,
      legacyValue: legacy.qualifiedCount ?? legacy.totalCandidateCount ?? null,
      note: "Brain result did not produce count (likely Phase-0 execution path difference)",
    };
  }

  const bq = brain.qualifiedCount ?? 0;
  const lq = legacy.qualifiedCount ?? 0;

  if (bq === lq) {
    return {
      dimension: "count",
      verdict: "MATCH",
      brainValue: bq,
      legacyValue: lq,
    };
  }

  const diff = Math.abs(bq - lq);
  if (diff <= 2) {
    return {
      dimension: "count",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: bq,
      legacyValue: lq,
      note: `Minor count difference (±${diff}) — likely ordering/tie-breaking variance`,
    };
  }

  return {
    dimension: "count",
    verdict: "MISMATCH",
    category: "COUNT_MISMATCH",
    brainValue: bq,
    legacyValue: lq,
    note: `Qualified count diverges by ${diff}`,
  };
}

function compareDataQuality(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  const brainFlagged = brain.dataQuality.simulated || brain.dataQuality.estimated;
  const legacyFlagged = legacy.hasDataQualityFlag;

  if (brainFlagged === legacyFlagged) {
    return {
      dimension: "data_quality",
      verdict: "MATCH",
      brainValue: brainFlagged,
      legacyValue: legacyFlagged,
    };
  }

  // Brain flags quality; legacy did not — brain is being more conservative
  if (brainFlagged && !legacyFlagged) {
    return {
      dimension: "data_quality",
      verdict: "EXPECTED_DIFFERENCE",
      brainValue: `simulated=${brain.dataQuality.simulated} estimated=${brain.dataQuality.estimated}`,
      legacyValue: false,
      note: "Brain applies stricter data-quality accounting than legacy",
    };
  }

  return {
    dimension: "data_quality",
    verdict: "MISMATCH",
    category: "DATA_QUALITY_MISMATCH",
    brainValue: brainFlagged,
    legacyValue: legacyFlagged,
    note: "Legacy flagged data quality; Brain did not detect it",
  };
}

function compareCta(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  // CTA eligibility: when legacy had a LIVE_OPTIONS/STOCK/ESTIMATED_OPTIONS verdict,
  // CTA should include a broker-gated trade ticket action.
  const legacyTradeReady =
    legacy.verdict === "LIVE_OPTIONS" ||
    legacy.verdict === "ESTIMATED_OPTIONS" ||
    legacy.verdict === "STOCK";

  const brainHasTradeReadyCta = brain.ctaGates.includes("verdict_trade_ready");

  if (legacyTradeReady && !brainHasTradeReadyCta) {
    // If brain produced no verdict (Phase 0 state), this is expected
    if (!brain.verdict || brain.status === "unavailable") {
      return {
        dimension: "cta",
        verdict: "EXPECTED_DIFFERENCE",
        brainValue: brain.ctaGates,
        legacyValue: legacy.verdict ?? null,
        note: "Brain CTA missing trade-ready gate — Phase-0 no-verdict path",
      };
    }
    return {
      dimension: "cta",
      verdict: "MISMATCH",
      category: "CTA_MISMATCH",
      brainValue: brain.ctaGates,
      legacyValue: legacy.verdict ?? null,
      note: "Legacy would show trade ticket; Brain CTA does not include verdict_trade_ready",
    };
  }

  if (!legacyTradeReady && brainHasTradeReadyCta) {
    return {
      dimension: "cta",
      verdict: "MISMATCH",
      category: "CTA_MISMATCH",
      brainValue: brain.ctaGates,
      legacyValue: legacy.verdict ?? null,
      note: "Brain offers trade-ready CTA when legacy would not",
    };
  }

  return {
    dimension: "cta",
    verdict: "MATCH",
    brainValue: brain.ctaGates,
    legacyValue: legacy.verdict ?? null,
  };
}

function compareFailurePolicy(brain: BrainValidationSnapshot, legacy: LegacyAskSnapshot): DimensionResult {
  if (brain.hasFailure === legacy.hasFailure) {
    return {
      dimension: "failure_policy",
      verdict: "MATCH",
      brainValue: brain.hasFailure,
      legacyValue: legacy.hasFailure,
    };
  }

  // Brain failed; legacy succeeded
  if (brain.hasFailure && !legacy.hasFailure) {
    // If brain was in Phase 0 (no tokens, no live data), some failures are expected
    if (brain.status === "unavailable") {
      return {
        dimension: "failure_policy",
        verdict: "EXPECTED_DIFFERENCE",
        brainValue: `status=${brain.status}`,
        legacyValue: "succeeded",
        note: "Brain returned unavailable (Phase-0 execution gap); legacy succeeded",
      };
    }
    return {
      dimension: "failure_policy",
      verdict: "MISMATCH",
      category: "FAILURE_POLICY_MISMATCH",
      brainValue: `status=${brain.status}`,
      legacyValue: "succeeded",
      note: "Brain reported error/unavailable; legacy path succeeded",
    };
  }

  // Legacy failed; brain succeeded
  return {
    dimension: "failure_policy",
    verdict: "EXPECTED_DIFFERENCE",
    brainValue: "succeeded",
    legacyValue: `failureKind=${legacy.failureKind ?? "unknown"}`,
    note: "Legacy path failed; Brain recovered — indicates improved resilience",
  };
}

// ---------------------------------------------------------------------------
// Main comparison function
// ---------------------------------------------------------------------------

/**
 * Compares a BrainValidationSnapshot against a LegacyAskSnapshot across all
 * 8 dimensions and returns a ShadowValidationResult.
 *
 * Pure function — no I/O, no logging. Call logShadowComparison() to emit.
 */
export function compareSnapshots(
  brain: BrainValidationSnapshot,
  legacy: LegacyAskSnapshot,
  requestId: string,
): ShadowValidationResult {
  const dimensions: DimensionResult[] = [
    compareIntent(brain, legacy),
    compareArguments(brain, legacy),
    compareToolPlan(brain, legacy),
    compareVerdict(brain, legacy),
    compareCount(brain, legacy),
    compareDataQuality(brain, legacy),
    compareCta(brain, legacy),
    compareFailurePolicy(brain, legacy),
  ];

  const mismatchCategories: MismatchCategory[] = dimensions
    .filter((d) => d.verdict === "MISMATCH" && d.category)
    .map((d) => d.category!);

  // Overall verdict: worst of all dimensions
  const hasAnyMismatch = dimensions.some((d) => d.verdict === "MISMATCH");
  const hasAnyExpected = dimensions.some((d) => d.verdict === "EXPECTED_DIFFERENCE");
  const overallVerdict: ShadowVerdict = hasAnyMismatch
    ? "MISMATCH"
    : hasAnyExpected
      ? "EXPECTED_DIFFERENCE"
      : "MATCH";

  // Migration blockers — categories that prevent safe migration
  const BLOCKING_CATEGORIES: MismatchCategory[] = [
    "INTENT_MISMATCH",
    "ARGUMENT_MISMATCH",
    "VERDICT_MISMATCH",
    "FAILURE_POLICY_MISMATCH",
  ];

  const blockers: string[] = dimensions
    .filter((d) => d.verdict === "MISMATCH" && d.category && BLOCKING_CATEGORIES.includes(d.category))
    .map((d) => d.note ?? d.category ?? "unknown");

  const migratable = blockers.length === 0 && overallVerdict !== "MISMATCH";

  return {
    requestId,
    overallVerdict,
    mismatchCategories,
    dimensions,
    migratable,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// extractLegacySnapshot — assembles LegacyAskSnapshot from ask.ts context
// ---------------------------------------------------------------------------

/**
 * Assembles a LegacyAskSnapshot from the fields available after the legacy
 * ask.ts callOpenAi() + deterministic steps complete.
 *
 * Call this in ask.ts before res.json() — only in the general path.
 * Pass only the scalar fields needed; never pass full payloads.
 */
export function extractLegacySnapshot(
  legacyIntent: string,
  tickers: string[],
  answer: {
    warnings?: string[];
    vcpScanFailed?: boolean;
    recommendationFailed?: boolean;
    vcpAnalysis?: unknown;
    multiStrategyAnalysis?: { dataQuality?: { realMarketData?: boolean } };
    strategyRecommendation?: {
      recommendations?: Array<{ overallVerdict?: string }>;
    };
  } | null,
): LegacyAskSnapshot {
  const intent = legacyIntent as LegacyIntent;
  const symbol = tickers[0] ?? undefined;
  const warnings = answer?.warnings ?? [];
  const hasFailure = !!(answer?.vcpScanFailed || answer?.recommendationFailed);
  const failureKind: LegacyAskSnapshot["failureKind"] =
    answer?.recommendationFailed ? "recommendation" :
    answer?.vcpScanFailed ? "vcp" : undefined;

  // Detect which tool branch ran
  let toolBranch: LegacyToolBranch = "openai_only";
  const hasRec = !!(answer?.strategyRecommendation?.recommendations?.length);
  const hasMsa = !!(answer?.multiStrategyAnalysis);
  const hasVcp = !!(answer?.vcpAnalysis);

  if (hasMsa && hasRec) toolBranch = "combined";
  else if (hasRec) toolBranch = "recommendation";
  else if (hasMsa) toolBranch = "multi_strategy";
  else if (hasVcp) toolBranch = "vcp";

  const verdict = answer?.strategyRecommendation?.recommendations?.[0]?.overallVerdict;
  const hasDataQualityFlag = !!(answer?.multiStrategyAnalysis?.dataQuality && !answer.multiStrategyAnalysis.dataQuality.realMarketData);

  return {
    legacyIntent: intent,
    tickers,
    toolBranch,
    symbol,
    verdict,
    warningCount: warnings.length,
    hasDataQualityFlag,
    hasFailure,
    failureKind,
  };
}

// ---------------------------------------------------------------------------
// Safe structured log — never logs full payloads
// ---------------------------------------------------------------------------

/**
 * Emits a structured JSON log line for the shadow comparison.
 * Never logs full evidence payloads, user IDs, tokens, or prices.
 */
export function logShadowComparison(result: ShadowValidationResult): void {
  const summary = {
    event: "BRAIN_SHADOW_COMPARISON",
    requestId: result.requestId,
    overallVerdict: result.overallVerdict,
    migratable: result.migratable,
    mismatchCategories: result.mismatchCategories,
    blockerCount: result.blockers.length,
    dimensionVerdicts: Object.fromEntries(
      result.dimensions.map((d) => [d.dimension, d.verdict]),
    ),
  };
  console.log(JSON.stringify(summary));
}
