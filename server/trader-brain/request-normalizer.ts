// TraderBrain Core — Request Normalizer.
//
// Produces one NormalizedBrainRequest from a raw question + extracted tickers
// + classified intent. Reuses existing parsers — never reimplements them.
//
// Invariants:
//   - Deterministic: same inputs → same output.
//   - No I/O. Pure function.
//   - Only fields that were deterministically parsed are set (no defaults,
//     no fabricated values).
//   - Never sets credential, token, or balance fields.

import type {
  NormalizedBrainRequest,
  BrainPortfolioConstraints,
  TraderBrainIntent,
} from "./types";
import {
  normalizeTradeGoal,
} from "../mcp/strategy-recommendation";
import {
  classifyPortfolioTradePlan,
} from "../routes/portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Universe hint detection (mirrors detectUniverseHint in ask.ts)
// ---------------------------------------------------------------------------

function detectUniverseHint(
  lower: string,
): string | undefined {
  if (/\bwatchlist\b/.test(lower)) return "watchlist";
  if (/\bs\s*&?\s*p\s*-?\s*100\b|\bsp[\s-]?100\b|\boex\b/.test(lower)) return "sp_100";
  if (/\bs\s*&?\s*p\s*-?\s*500\b|\bsp[\s-]?500\b/.test(lower)) return "sp_500";
  if (/\bnasdaq[\s-]?100\b|\bndx\b|\bqqq\b/.test(lower)) return "nasdaq_100";
  if (/\bhigh[\s-]?volume\b|\bmost active\b|\btop volume\b/.test(lower)) return "high_volume";
  if (/\boptions?[\s-]?liquid\b|\bliquid options?\b/.test(lower)) return "options_liquid";
  if (/\bdow\s*30\b|\bdjia\b|\bblue[\s-]?chips?\b/.test(lower)) return "large_cap";
  return undefined;
}

// ---------------------------------------------------------------------------
// Education topic extraction (for EXPLAIN_CONCEPT)
// ---------------------------------------------------------------------------

function extractEducationTopic(question: string): string | undefined {
  // Strip common question phrasing and return the core concept.
  const stripped = question
    .replace(/^(how\s+does|how\s+do\s+i|what\s+is\s+(a\s+|an\s+|the\s+)?|what\s+are\s+|explain\s+(to\s+me\s+)?|define\s+(a\s+|an\s+|the\s+)?|tell\s+me\s+about\s+|teach\s+me\s+(about\s+)?)/i, "")
    .replace(/\?$/, "")
    .trim();
  return stripped.length > 0 ? stripped : undefined;
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

/**
 * Produces a NormalizedBrainRequest from validated inputs.
 *
 * @param intent   - from classifyBrainIntent()
 * @param question - raw user question
 * @param tickers  - validated tickers from extractTickers()
 */
export function normalizeBrainRequest(
  intent: TraderBrainIntent,
  question: string,
  tickers: string[],
): NormalizedBrainRequest {
  const lower = question.toLowerCase();

  const base: NormalizedBrainRequest = {
    rawPrompt: question,
    intent,
    tickers,
  };

  // ------------------------------------------------------------------
  // Symbol (single-symbol intents)
  // ------------------------------------------------------------------
  if (
    intent === "ANALYZE_SYMBOL" ||
    intent === "RECOMMEND_SYMBOL_TRADE" ||
    intent === "COMBINED_ANALYSIS_RECOMMENDATION"
  ) {
    base.symbol = tickers[0]; // tickers are already validated by extractTickers()
  }

  // ------------------------------------------------------------------
  // Portfolio constraints (PLAN_PORTFOLIO_TRADE)
  // ------------------------------------------------------------------
  if (intent === "PLAN_PORTFOLIO_TRADE") {
    try {
      const ptpGoal = classifyPortfolioTradePlan(question, tickers);
      if (ptpGoal) {
        const constraints: BrainPortfolioConstraints = {
          kind: ptpGoal.kind,
        };
        if (typeof ptpGoal.maxRiskDollars === "number")
          constraints.maxRiskDollars = ptpGoal.maxRiskDollars;
        if (typeof ptpGoal.maxRiskPercent === "number")
          constraints.maxRiskPercent = ptpGoal.maxRiskPercent;
        if (ptpGoal.excludeSectors?.length)
          constraints.excludeSectors = ptpGoal.excludeSectors;
        if (ptpGoal.requireExistingPosition)
          constraints.requireExistingPosition = true;
        if (ptpGoal.objective)
          constraints.objective = ptpGoal.objective;
        base.portfolioConstraints = constraints;
        // Also copy top-level risk fields for composable use
        if (constraints.maxRiskDollars != null)
          base.maxRiskDollars = constraints.maxRiskDollars;
        if (constraints.maxRiskPercent != null)
          base.maxRiskPercent = constraints.maxRiskPercent;
      }
    } catch {
      // normalizer failure → leave portfolioConstraints undefined (honest)
    }
  }

  // ------------------------------------------------------------------
  // Trade goal fields (RECOMMEND, RANK, COMBINED, EDUCATION_PLUS_ACTION)
  // ------------------------------------------------------------------
  if (
    intent === "RECOMMEND_SYMBOL_TRADE" ||
    intent === "RANK_MARKET_TRADES" ||
    intent === "COMBINED_ANALYSIS_RECOMMENDATION" ||
    intent === "EDUCATION_PLUS_ACTION"
  ) {
    try {
      const goal = normalizeTradeGoal(question, tickers);
      // Only copy fields that were actually parsed (not undefined)
      if (goal.direction) base.direction = goal.direction;
      if (goal.instrumentPreference) base.instrumentPreference = goal.instrumentPreference;
      if (goal.objective) base.objective = goal.objective;
      if (goal.requestedStrategy) base.requestedStrategy = goal.requestedStrategy;
      if (typeof goal.maxRiskDollars === "number") base.maxRiskDollars = goal.maxRiskDollars;
      if (typeof goal.maxRiskPercent === "number") base.maxRiskPercent = goal.maxRiskPercent;
      if (typeof goal.numberOfIdeas === "number") base.numberOfIdeas = goal.numberOfIdeas;
      if (typeof goal.targetDTE === "number") base.timeframe = `${goal.targetDTE}DTE`;
    } catch {
      // normalization unavailable → leave fields unset (honest)
    }
  }

  // ------------------------------------------------------------------
  // Universe hint (RANK_MARKET_TRADES)
  // ------------------------------------------------------------------
  if (intent === "RANK_MARKET_TRADES") {
    const hint = detectUniverseHint(lower);
    if (hint) base.universeHint = hint;
  }

  // ------------------------------------------------------------------
  // Education topic (EXPLAIN_CONCEPT, EDUCATION_PLUS_ACTION)
  // ------------------------------------------------------------------
  if (intent === "EXPLAIN_CONCEPT" || intent === "EDUCATION_PLUS_ACTION") {
    const topic = extractEducationTopic(question);
    if (topic) base.educationTopic = topic;
  }

  return base;
}
