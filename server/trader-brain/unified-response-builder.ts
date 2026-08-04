// TraderBrain — Unified Response Builder (Sprint 5.1).
//
// Translates a TraderBrainResult into the HTTP response shape expected by the
// existing frontend for every authoritative trade intent.
//
// Contract:
//   - Deterministic sections are never altered.
//   - OpenAI prose is additive and always optional.
//   - Response shape matches the pre-Brain legacy shape exactly so the
//     frontend requires no changes.
//   - All builders throw when the required deterministic section is absent —
//     callers catch and fall back to callOpenAi.
//
// Supported intents:
//   RANK_MARKET_TRADES            → buildRankedBrainResponse()
//   PLAN_PORTFOLIO_TRADE          → buildPortfolioBrainResponse()
//   RECOMMEND_SYMBOL_TRADE        → buildRecommendBrainAnswer()
//   COMBINED_ANALYSIS_RECOMMENDATION → re-uses combined-response-builder
//   EDUCATION_PLUS_ACTION         → buildEducationPlusBrainAnswer()

import type { TraderBrainResult } from "./types";
import type { RankedTradeSearch } from "../routes/ranked-trade-search";
import type { PortfolioTradePlan } from "../routes/portfolio-trade-plan";
import type { StrategyRecommendation } from "../mcp/strategy-recommendation";
import type { TradeGoal } from "../mcp/strategy-recommendation";
import type { PortfolioTradePlanGoal } from "../routes/portfolio-trade-plan";
import type { SafePortfolioAwareness } from "../routes/internal-portfolio";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Minimal AskAnswer-compatible shape returned to ask.ts. */
export interface BrainAskAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
  multiStrategyAnalysis?: unknown;
  strategyRecommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
}

/** Full HTTP response body for RANK intent. Spread into res.json(). */
export interface RankedBrainResponse extends BrainAskAnswer {
  intent: "ranked-trade-search";
  tickers: string[];
  rankedTradeSearch: RankedTradeSearch;
  rankedSearchSource: string;
  suggestions: unknown[];
  source: "openai" | "rule_based";
}

/** Full HTTP response body for PORTFOLIO intent. Spread into res.json(). */
export interface PortfolioBrainResponse extends BrainAskAnswer {
  intent: "portfolio-trade-plan";
  tickers: string[];
  portfolioTradePlan: PortfolioTradePlan;
  suggestions: unknown[];
  source: "openai" | "rule_based";
}

// ---------------------------------------------------------------------------
// Section extractors (strict — throw when required section absent)
// ---------------------------------------------------------------------------

function requireRanked(result: TraderBrainResult): RankedTradeSearch {
  const s = result.sections?.rankedSearch;
  if (!s || typeof s !== "object") {
    throw Object.assign(
      new Error("Brain RANK result missing rankedSearch section"),
      { code: "BRAIN_MISSING_RANKED_SECTION" },
    );
  }
  const rs = s as RankedTradeSearch;
  if (!Array.isArray(rs.candidates)) {
    throw Object.assign(
      new Error("Brain RANK result rankedSearch.candidates is not an array"),
      { code: "BRAIN_INVALID_RANKED_SECTION" },
    );
  }
  return rs;
}

function requirePortfolio(result: TraderBrainResult): PortfolioTradePlan {
  const s = result.sections?.portfolioTradePlan;
  if (!s || typeof s !== "object") {
    throw Object.assign(
      new Error("Brain PORTFOLIO result missing portfolioTradePlan section"),
      { code: "BRAIN_MISSING_PORTFOLIO_SECTION" },
    );
  }
  return s as PortfolioTradePlan;
}

function getRecommendation(result: TraderBrainResult): StrategyRecommendation | null {
  const s = result.sections?.recommendation;
  if (!s || typeof s !== "object") return null;
  const r = s as StrategyRecommendation;
  return Array.isArray(r.recommendations) ? r : null;
}

// ---------------------------------------------------------------------------
// Goal reconstruction from NormalizedBrainRequest
// (required by deterministic answer builders in ranked/portfolio modules)
// ---------------------------------------------------------------------------

function toTradeGoal(result: TraderBrainResult): TradeGoal {
  const req = result.normalizedRequest ?? {};
  const goal: TradeGoal = {};
  if (req.direction) goal.direction = req.direction;
  if (req.instrumentPreference) goal.instrumentPreference = req.instrumentPreference;
  if (req.objective) goal.objective = req.objective;
  if (req.requestedStrategy) goal.requestedStrategy = req.requestedStrategy;
  if (typeof req.maxRiskDollars === "number") goal.maxRiskDollars = req.maxRiskDollars;
  if (typeof req.maxRiskPercent === "number") goal.maxRiskPercent = req.maxRiskPercent;
  if (typeof req.numberOfIdeas === "number") goal.numberOfIdeas = req.numberOfIdeas;
  return goal;
}

function toPortfolioGoal(result: TraderBrainResult): PortfolioTradePlanGoal {
  const pc = result.normalizedRequest?.portfolioConstraints;
  return {
    kind: pc?.kind ?? "dollar_risk",
    ...(pc?.maxRiskDollars != null && { maxRiskDollars: pc.maxRiskDollars }),
    ...(pc?.maxRiskPercent != null && { maxRiskPercent: pc.maxRiskPercent }),
    ...(pc?.excludeSectors?.length && { excludeSectors: pc.excludeSectors }),
    ...(pc?.requireExistingPosition && { requireExistingPosition: true }),
    ...(pc?.objective && { objective: pc.objective }),
  };
}

// ---------------------------------------------------------------------------
// RANK_MARKET_TRADES
// ---------------------------------------------------------------------------

/**
 * Builds the HTTP response body for a Brain RANK_MARKET_TRADES result.
 * `openAiAnswer` is the prose AskAnswer from callOpenAi (or null if skipped).
 * The deterministic headline + confidence always override any OpenAI values.
 *
 * Throws when the ranked section is absent (caller falls back to legacy).
 */
export async function buildRankedBrainResponse(
  result: TraderBrainResult,
  openAiAnswer: BrainAskAnswer | null,
  pfAwareness: SafePortfolioAwareness | null,
): Promise<RankedBrainResponse> {
  const search = requireRanked(result);
  const goal = toTradeGoal(result);

  const [rts] = await Promise.all([
    import("../routes/ranked-trade-search"),
  ]);

  const deterministic = rts.buildRankedTradeSearchAnswer(search, goal);
  const suggestions = rts.rankedTradeSearchSuggestions(search);

  const rankedSearchSource =
    search.candidates.length === 0 && search.watchCandidates.length === 0
      ? "RANKED_MCP_EMPTY"
      : "RANKED_MCP_SUCCESS";

  const base = openAiAnswer ?? (deterministic as BrainAskAnswer);

  return {
    ...base,
    // Deterministic fields always override OpenAI narrative
    headline: deterministic.headline,
    confidence: deterministic.confidence,
    intent: "ranked-trade-search",
    tickers: [],
    rankedTradeSearch: search,
    rankedSearchSource,
    suggestions,
    source: openAiAnswer ? "openai" : "rule_based",
    ...(pfAwareness ? { portfolioAwareness: pfAwareness } : {}),
  } as RankedBrainResponse;
}

// ---------------------------------------------------------------------------
// PLAN_PORTFOLIO_TRADE
// ---------------------------------------------------------------------------

/**
 * Builds the HTTP response body for a Brain PLAN_PORTFOLIO_TRADE result.
 * `openAiAnswer` is the prose AskAnswer from callOpenAi (or null if skipped).
 *
 * Throws when the portfolio section is absent (caller falls back to legacy).
 */
export async function buildPortfolioBrainResponse(
  result: TraderBrainResult,
  openAiAnswer: BrainAskAnswer | null,
  pfAwareness: SafePortfolioAwareness | null,
): Promise<PortfolioBrainResponse> {
  const plan = requirePortfolio(result);
  const goal = toPortfolioGoal(result);

  const ptp = await import("../routes/portfolio-trade-plan");
  const deterministic = ptp.buildPortfolioTradePlanAnswer(plan, goal);
  const suggestions = ptp.portfolioTradePlanSuggestions(plan);

  const base = openAiAnswer ?? (deterministic as BrainAskAnswer);

  return {
    ...base,
    headline: deterministic.headline,
    confidence: deterministic.confidence,
    intent: "portfolio-trade-plan",
    tickers: [],
    portfolioTradePlan: plan,
    suggestions,
    source: openAiAnswer ? "openai" : "rule_based",
    ...(pfAwareness ? { portfolioAwareness: pfAwareness } : {}),
  } as PortfolioBrainResponse;
}

// ---------------------------------------------------------------------------
// RECOMMEND_SYMBOL_TRADE
// ---------------------------------------------------------------------------

/**
 * Builds an AskAnswer for RECOMMEND_SYMBOL_TRADE.
 * Delegates to buildCombinedAskAnswer Case 3 (recommendation only) so the
 * combined builder's precedence rules are preserved.
 *
 * Throws when the recommendation section is absent.
 */
export async function buildRecommendBrainAnswer(
  result: TraderBrainResult,
  openAiExplanation: string | null,
): Promise<BrainAskAnswer> {
  const rec = getRecommendation(result);
  if (!rec) {
    throw Object.assign(
      new Error("Brain RECOMMEND result missing recommendation section"),
      { code: "BRAIN_MISSING_RECOMMEND_SECTION" },
    );
  }

  // Reuse the combined builder — it handles recommendation-only gracefully
  // (Case 3: analysis null, recommendation present).
  const { buildCombinedAskAnswer } = await import("./combined-response-builder");
  return buildCombinedAskAnswer(result, openAiExplanation) as Promise<BrainAskAnswer>;
}

// ---------------------------------------------------------------------------
// EDUCATION_PLUS_ACTION
// ---------------------------------------------------------------------------

/**
 * Builds an AskAnswer for EDUCATION_PLUS_ACTION.
 * Uses OpenAI prose as the primary answer; falls back to a deterministic
 * summary from whichever section (ranked or recommendation) Brain produced.
 */
export async function buildEducationPlusBrainAnswer(
  result: TraderBrainResult,
  openAiExplanation: string | null,
): Promise<BrainAskAnswer> {
  const rec = getRecommendation(result);
  const ranked = (() => {
    try { return requireRanked(result); } catch { return null; }
  })();

  const RISK_NOTE =
    "AI-generated educational analysis — not investment advice. Verify with your own plan before trading.";

  if (openAiExplanation) {
    // OpenAI prose is the authoritative answer; deterministic sections are
    // surfaced as structured data (strategyRecommendation / rankedTradeSearch)
    // for the frontend to render independently.
    return {
      headline: result.headline ?? "Education + trade context",
      answer: openAiExplanation,
      keyPoints: [],
      riskNote: RISK_NOTE,
      confidence: "medium",
      ...(rec ? { strategyRecommendation: rec } : {}),
    };
  }

  // Fallback: surface whatever section Brain produced
  if (rec) {
    const { buildCombinedAskAnswer } = await import("./combined-response-builder");
    return buildCombinedAskAnswer(result, null) as Promise<BrainAskAnswer>;
  }
  if (ranked) {
    const rts = await import("../routes/ranked-trade-search");
    const goal = toTradeGoal(result);
    const deterministic = rts.buildRankedTradeSearchAnswer(ranked, goal);
    return {
      ...deterministic,
      answer: `${deterministic.answer}\n\nNote: Education context was temporarily unavailable. The trade search result is shown above.`,
    } as BrainAskAnswer;
  }

  // Last resort
  return {
    headline: "Education and trade search",
    answer: "The trade search engine was temporarily unavailable. Please try again.",
    keyPoints: [],
    riskNote: RISK_NOTE,
    confidence: "low",
  };
}

// ---------------------------------------------------------------------------
// Prompt builder for Brain OpenAI calls (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Builds a focused OpenAI system + user prompt for a Brain result.
 * Returns null when there are no sections worth explaining.
 *
 * For RANK results: delegates explanation entirely to the caller's
 * callOpenAi({ rankedTradeSearch }) call — no separate prompt needed.
 * For RECOMMEND / COMBINED: uses the combined builder's prompts.
 * For PORTFOLIO: uses a compact portfolio explanation prompt.
 */
export async function buildBrainExplanationPrompt(
  result: TraderBrainResult,
  question: string,
): Promise<{ system: string; user: string } | null> {
  const intent = result.intent;

  if (intent === "RECOMMEND_SYMBOL_TRADE" || intent === "COMBINED_ANALYSIS_RECOMMENDATION") {
    const { buildCombinedSystemPrompt, buildCombinedUserContent } = await import("./combined-response-builder");
    const system = buildCombinedSystemPrompt(result);
    if (!system) return null;
    return { system, user: buildCombinedUserContent(result, question) };
  }

  if (intent === "PLAN_PORTFOLIO_TRADE") {
    const plan = (() => {
      try { return requirePortfolio(result); } catch { return null; }
    })();
    if (!plan) return null;

    const system = [
      "You are a concise trading analyst. The user asked for a portfolio-constrained trade plan.",
      "Deterministic data has already been computed — explain it in plain English.",
      "",
      "HARD RULES:",
      "- Never alter feasibility.feasible, qualifiedCandidates, or nextSteps.",
      "- A 'feasible: false' verdict is absolute — do NOT reframe or soften it.",
      "- Never invent entry/stop/target prices, risk amounts, or R/R ratios.",
      "- Keep explanation concise: feasibility → constraints → candidates → risk.",
      "- Do not call any tools.",
    ].join("\n");

    const feasible = plan.feasibility?.feasible ?? false;
    const candidateCount = plan.qualifiedCandidates?.length ?? 0;
    const user = [
      `User asked: "${question}"`,
      "",
      `PORTFOLIO PLAN RESULT:`,
      `  Feasible: ${feasible}`,
      `  Qualified candidates: ${candidateCount}`,
      ...(plan.feasibility?.reason ? [`  Feasibility reason: ${plan.feasibility.reason}`] : []),
      ...(candidateCount > 0 ? plan.qualifiedCandidates!.slice(0, 3).map((c) =>
        `  - ${(c as Record<string, unknown>).symbol ?? "?"}: ${(c as Record<string, unknown>).strategy ?? "?"}`
      ) : []),
      "",
      "Please write a concise plain-English explanation.",
    ].join("\n");

    return { system, user };
  }

  if (intent === "EDUCATION_PLUS_ACTION") {
    const rec = getRecommendation(result);
    const ranked = (() => {
      try { return requireRanked(result); } catch { return null; }
    })();
    if (!rec && !ranked) return null;

    const system = [
      "You are a concise trading educator. The user asked for both an educational explanation and a trade action.",
      "Deterministic trade data has been computed — explain and contextualize it.",
      "HARD RULES:",
      "- Never invent price levels, symbols, or trade recommendations.",
      "- Keep the educational context brief and focused on the user's question.",
      "- Keep the response under 300 words.",
    ].join("\n");

    const user = `User asked: "${question}"\n\nPlease provide a concise educational explanation connected to the trade context.`;
    return { system, user };
  }

  return null;
}
