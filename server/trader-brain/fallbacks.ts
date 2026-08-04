// TraderBrain Core — Named fallback behaviors.
//
// Provides deterministic rule-based answers when MCP or OpenAI is unavailable.
// These are honest degraded results — never invented trades or recommendations.

import type { TraderBrainIntent } from "./types";

// ---------------------------------------------------------------------------
// Fallback answer shape (safe subset of what Composer produces)
// ---------------------------------------------------------------------------

export interface FallbackAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Rule-based answers (deterministic — no I/O, no model calls)
// ---------------------------------------------------------------------------

const DISCLAIMER =
  "All output is AI-generated educational analysis — not investment advice. Confirm everything with your own plan and broker before trading.";

export function ruleBasedFallback(
  intent: TraderBrainIntent,
  symbol?: string,
): FallbackAnswer {
  switch (intent) {
    case "ANALYZE_SYMBOL":
      return {
        headline: symbol
          ? `${symbol} analysis is temporarily unavailable.`
          : "Symbol analysis is temporarily unavailable.",
        answer:
          "The analysis engine is currently unavailable. Use the Trade Builder to review this setup manually, or try again in a moment.",
        keyPoints: ["Analysis engine temporarily unavailable", "Try again shortly"],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "RECOMMEND_SYMBOL_TRADE":
      return {
        headline: symbol
          ? `Trade recommendation for ${symbol} is temporarily unavailable.`
          : "Trade recommendation is temporarily unavailable.",
        answer:
          "The recommendation engine could not complete this request. No trade has been invented to fill the gap — please try again or use the Trade Builder to construct your own setup.",
        keyPoints: [
          "Recommendation engine temporarily unavailable",
          "No invented trade provided",
          "Use Trade Builder for manual setup",
        ],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "RANK_MARKET_TRADES":
      return {
        headline: "Ranked trade search is temporarily unavailable.",
        answer:
          "The market-wide ranking engine is unavailable right now. Try the Opportunity Radar for stored scan results, or rephrase your question and try again.",
        keyPoints: [
          "Ranking engine temporarily unavailable",
          "Opportunity Radar may have stored results",
        ],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "PLAN_PORTFOLIO_TRADE":
      return {
        headline: "Portfolio-constrained trade planning is temporarily unavailable.",
        answer:
          "The portfolio planning engine could not complete this request. Your portfolio context was not exposed and no trade has been invented. Try again in a moment.",
        keyPoints: [
          "Planning engine temporarily unavailable",
          "Portfolio data was not exposed",
          "No trade was fabricated",
        ],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "COMBINED_ANALYSIS_RECOMMENDATION":
      return {
        headline: "Combined analysis and recommendation is temporarily unavailable.",
        answer:
          "The analysis and recommendation engines are unavailable right now. Please try the Trade Builder or rephrase your question.",
        keyPoints: ["Analysis engine unavailable", "Recommendation engine unavailable"],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "EXPLAIN_CONCEPT":
      return {
        headline: "Here's a quick overview.",
        answer:
          "For detailed explanations of trading concepts, visit the Help section or rephrase your question and try again when the AI service is available.",
        keyPoints: [
          "Trade Builder for practical setup help",
          "Help section for concept explanations",
        ],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "EDUCATION_PLUS_ACTION":
      return {
        headline: "Here's where to start.",
        answer:
          "Use the Trade Builder to express a setup in plain English, the Opportunity Radar for ranked candidates, or Market Intel for news context. The AI explanation service will be available again shortly.",
        keyPoints: ["Trade Builder for custom setups", "Opportunity Radar for ranked ideas"],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "MARKET_RESEARCH":
      return {
        headline: "Market research is temporarily unavailable.",
        answer:
          "The AI research service is unavailable right now. Open Market Intel for live news and sentiment data.",
        keyPoints: ["Market Intel has live news and sentiment", "Try again shortly"],
        riskNote: DISCLAIMER,
        confidence: "low",
      };

    case "UNKNOWN":
    default:
      return {
        headline: "Here's where to look inside VCP Trader AI.",
        answer:
          "Use the Trade Builder to express a setup in plain English, the Opportunity Radar for ranked candidates, or Market Intel for news and sentiment.",
        keyPoints: [
          "Trade Builder for custom setups",
          "Opportunity Radar for ranked ideas",
          "Market Intel for news context",
        ],
        riskNote: DISCLAIMER,
        confidence: "low",
      };
  }
}

// ---------------------------------------------------------------------------
// Honest unavailability headline (used when required step fails)
// ---------------------------------------------------------------------------

export function unavailableHeadline(intent: TraderBrainIntent, symbol?: string): string {
  switch (intent) {
    case "RECOMMEND_SYMBOL_TRADE":
      return symbol
        ? `Trade recommendation for ${symbol} is temporarily unavailable.`
        : "Trade recommendation is temporarily unavailable.";
    case "RANK_MARKET_TRADES":
      return "Ranked trade search is temporarily unavailable.";
    case "PLAN_PORTFOLIO_TRADE":
      return "Portfolio trade planning is temporarily unavailable.";
    case "ANALYZE_SYMBOL":
      return symbol
        ? `${symbol} analysis is temporarily unavailable.`
        : "Symbol analysis is temporarily unavailable.";
    case "COMBINED_ANALYSIS_RECOMMENDATION":
      return "Analysis and recommendation are temporarily unavailable.";
    default:
      return "This feature is temporarily unavailable.";
  }
}
