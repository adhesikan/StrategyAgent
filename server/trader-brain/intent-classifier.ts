// TraderBrain Core — Intent Classifier.
//
// Centralizes the existing deterministic classifiers into a single closed
// TraderBrainIntent. Reuses the existing parsers — never reimplements their
// logic. Priority order mirrors the existing ask.ts branch order so behavior
// is consistent during the shadow-mode migration.
//
// Invariants:
//   - Deterministic: same input always produces the same intent.
//   - No I/O. Pure function.
//   - All false-ticker protections preserved (delegated to existing functions).

import type { TraderBrainIntent } from "./types";

// ---------------------------------------------------------------------------
// Lazy imports — these modules are large; import only when classifier runs.
// All imports are from modules that are already tested and stable.
// ---------------------------------------------------------------------------

import {
  classifyTradeRequest,
} from "../mcp/strategy-recommendation";
import {
  classifyPortfolioTradePlan,
} from "../routes/portfolio-trade-plan";
import {
  classifyRankedTradeSearch,
} from "../routes/ranked-trade-search";
import {
  isStockAnalysisAsk,
} from "../mcp/analysis-scan";

// ---------------------------------------------------------------------------
// Education pattern (mirrors the one in portfolio-trade-plan.ts)
// Used here to gate EXPLAIN_CONCEPT before falling through to UNKNOWN.
// ---------------------------------------------------------------------------

const EXPLAIN_CONCEPT_RE =
  /\b(how\s+does|how\s+do\s+i|what\s+is\s+(a\s+|an\s+|the\s+)?|what\s+are\s+|explain(\s+to\s+me)?|define(\s+a\s+|an\s+|the\s+)?|tell\s+me\s+about|teach\s+me|why\s+do\s+traders?|when\s+should\s+i\s+use)\b/i;

// ---------------------------------------------------------------------------
// Market-research pattern (news, macro, catalysts — no trade action)
// ---------------------------------------------------------------------------

const MARKET_RESEARCH_RE =
  /\b(why\s+(is|are|did|was)|what('s|\s+is)\s+happening|what\s+caused|news|catalyst|sentiment|moving|fed|fomc|cpi|jobs|earnings\s+(report|date|season)|macro|interest\s+rates?|inflation|economy)\b/i;

// ---------------------------------------------------------------------------
// Supplemental rank pattern — objective-based trade phrasings not caught by
// classifyTradeRequest / classifyRankedTradeSearch.  These map to
// RANK_MARKET_TRADES so the request normalizer can extract the objective
// (aggressive, conservative, income, growth, etc.) for downstream use.
// ---------------------------------------------------------------------------

const RANK_SUPPLEMENT_RE =
  /\b(aggressive|conservative|high[- ]conviction|growth|momentum|breakout|defined[- ]risk|retirement|dividend|bullish|bearish|income)\s+(trades?|plays?|setups?|ideas?|opportunit(?:y|ies)|positions?)\b|\b(trade|setup|opportunit(?:y|ies)|play|idea)\s+(for|with)\s+(retirement|income|growth|defined[- ]risk)\b|\b(recommend|suggest|find|show|get)\s+(me\s+)?(a\s+|an?\s+)?(stock|options?)\s+(trade|idea|setup|play)\b/i;

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Returns the TraderBrainIntent for a question + extracted tickers.
 *
 * Priority order (highest specificity first):
 *   1. PLAN_PORTFOLIO_TRADE    — dollar/pct/sector/holdings constraints
 *   2. RANK_MARKET_TRADES      — broad market-wide search, no validated symbol
 *   3. RECOMMEND_SYMBOL_TRADE  — single-symbol recommendation
 *   4. COMBINED_ANALYSIS_RECOMMENDATION — "Analyze X and recommend"
 *   5. EDUCATION_PLUS_ACTION   — "Explain X and find one"
 *   6. ANALYZE_SYMBOL          — symbol analysis (VCP / multi-strategy)
 *   7. EXPLAIN_CONCEPT         — pure education, no trade action
 *   8. MARKET_RESEARCH         — news, macro, catalyst research
 *   9. UNKNOWN                 — catch-all safe fallback
 *
 * @param question - raw user question (already trimmed)
 * @param tickers  - validated tickers from extractTickers() (false-ticker
 *                   protections already applied by the caller)
 */
export function classifyBrainIntent(
  question: string,
  tickers: string[],
): TraderBrainIntent {
  if (!question || typeof question !== "string") return "UNKNOWN";

  // ------------------------------------------------------------------
  // 1. PLAN_PORTFOLIO_TRADE — most specific; checked first.
  //    classifyPortfolioTradePlan already rejects educational questions.
  // ------------------------------------------------------------------
  try {
    const ptpGoal = classifyPortfolioTradePlan(question, tickers);
    if (ptpGoal) return "PLAN_PORTFOLIO_TRADE";
  } catch {
    // classification unavailable → continue
  }

  // ------------------------------------------------------------------
  // 2 + 3 + 4 + 5. classifyTradeRequest covers recommendation, combined,
  //                and education_plus_search intents.
  // ------------------------------------------------------------------
  try {
    const tradeIntent = classifyTradeRequest(question, tickers);
    if (tradeIntent) {
      switch (tradeIntent.kind) {
        case "combined":
          return "COMBINED_ANALYSIS_RECOMMENDATION";
        case "education_plus_search":
          return "EDUCATION_PLUS_ACTION";
        case "recommendation":
          // Symbol present → single-symbol recommendation.
          // No symbol → market-wide ranking.
          if (tradeIntent.goal.symbol) return "RECOMMEND_SYMBOL_TRADE";
          return "RANK_MARKET_TRADES";
      }
    }
  } catch {
    // continue
  }

  // ------------------------------------------------------------------
  // 6. RANK_MARKET_TRADES — supplemental broad-search phrasings that
  //    classifyTradeRequest may not catch but classifyRankedTradeSearch does.
  // ------------------------------------------------------------------
  try {
    const ranked = classifyRankedTradeSearch(question, tickers);
    if (ranked) return "RANK_MARKET_TRADES";
  } catch {
    // continue
  }

  // ------------------------------------------------------------------
  // 6.5 RANK_MARKET_TRADES — supplemental objective-based phrasings.
  //     Catches "aggressive trade", "conservative trade", "growth trade",
  //     "trade for retirement", "recommend a stock trade", etc. before
  //     falling through to ANALYZE_SYMBOL.
  // ------------------------------------------------------------------
  if (RANK_SUPPLEMENT_RE.test(question)) return "RANK_MARKET_TRADES";

  // ------------------------------------------------------------------
  // 7. ANALYZE_SYMBOL — ticker present + analysis phrasing.
  // ------------------------------------------------------------------
  if (tickers.length > 0) {
    try {
      if (isStockAnalysisAsk(question)) return "ANALYZE_SYMBOL";
    } catch {
      // continue — fall through to EXPLAIN_CONCEPT / MARKET_RESEARCH
    }
    // Ticker present but no specific intent matched → treat as analysis
    // (most symbol-specific questions benefit from multi-strategy context).
    return "ANALYZE_SYMBOL";
  }

  // ------------------------------------------------------------------
  // 8. MARKET_RESEARCH — news / macro / catalyst questions.
  //    Checked before EXPLAIN_CONCEPT because macro questions often start
  //    with "what is / why is" (e.g. "What is the Fed doing to the
  //    market?") which would otherwise match the education pattern.
  // ------------------------------------------------------------------
  if (MARKET_RESEARCH_RE.test(question)) return "MARKET_RESEARCH";

  // ------------------------------------------------------------------
  // 9. EXPLAIN_CONCEPT — education keywords, no ticker, no trade action.
  // ------------------------------------------------------------------
  if (EXPLAIN_CONCEPT_RE.test(question)) return "EXPLAIN_CONCEPT";

  // ------------------------------------------------------------------
  // 10. UNKNOWN — safe fallback.
  // ------------------------------------------------------------------
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Intent metadata helpers (used by planner and composer)
// ---------------------------------------------------------------------------

/** True when the intent requires at least one validated symbol. */
export function intentRequiresSymbol(intent: TraderBrainIntent): boolean {
  return (
    intent === "ANALYZE_SYMBOL" ||
    intent === "RECOMMEND_SYMBOL_TRADE" ||
    intent === "COMBINED_ANALYSIS_RECOMMENDATION"
  );
}

/** True when the intent benefits from portfolio-context token injection. */
export function intentWantsPortfolioContext(intent: TraderBrainIntent): boolean {
  return (
    intent === "PLAN_PORTFOLIO_TRADE" ||
    intent === "RANK_MARKET_TRADES" ||
    intent === "RECOMMEND_SYMBOL_TRADE" ||
    intent === "COMBINED_ANALYSIS_RECOMMENDATION"
  );
}

/** True when the intent may call MCP deterministic trading tools. */
export function intentUsesMcp(intent: TraderBrainIntent): boolean {
  return (
    intent !== "EXPLAIN_CONCEPT" &&
    intent !== "MARKET_RESEARCH" &&
    intent !== "UNKNOWN"
  );
}

/** True when OpenAI explanation is useful for this intent. */
export function intentWantsOpenAi(intent: TraderBrainIntent): boolean {
  // Always useful for education; conditionally useful for others.
  // RANK_MARKET_TRADES does not need prose — deterministic buckets are self-explanatory.
  return intent !== "RANK_MARKET_TRADES";
}
