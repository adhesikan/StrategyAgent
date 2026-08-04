// TraderBrain — Combined Analysis-Recommendation Response Builder.
//
// Pure functions that translate a TraderBrainResult (COMBINED intent) into
// the backward-compatible AskAnswer shape expected by ask.ts and existing
// frontend clients.
//
// Handles 4 partial-failure cases without fabricating trades or blending
// scanner scores with recommendation verdicts:
//
//   1. Both succeeded      → headline + confidence from recommendation;
//                            full analysis + recommendation sections present.
//   2. Analysis OK, rec ✗ → analysis section present; recommendationFailed=true.
//   3. Rec OK, analysis ✗ → recommendation present; analysis limitation disclosed.
//   4. Both failed         → honest unavailable; no invented trades.
//
// OpenAI explanation is always optional — all deterministic sections survive
// OpenAI failure. The caller in ask.ts handles the OpenAI call and passes
// the prose string here.

import type { TraderBrainResult } from "./types";
import type { MultiStrategyAnalysis, MultiStrategySetupEntry } from "../mcp/multi-strategy-analysis";
import type { StrategyRecommendation } from "../mcp/strategy-recommendation";

// ---------------------------------------------------------------------------
// Output shape (structurally compatible with ask.ts AskAnswer)
// ---------------------------------------------------------------------------

export interface CombinedAskAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
  multiStrategyAnalysis?: MultiStrategyAnalysis;
  strategyRecommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
}

// ---------------------------------------------------------------------------
// Section accessors — extract typed data from brain result sections
// ---------------------------------------------------------------------------

function getAnalysis(result: TraderBrainResult): MultiStrategyAnalysis | null {
  const s = result.sections?.analysis;
  if (!s || typeof s !== "object") return null;
  // MultiStrategyAnalysis must have symbol + overallVerdict
  const a = s as MultiStrategyAnalysis;
  if (typeof a.symbol !== "string" || !a.symbol) return null;
  if (typeof a.overallVerdict !== "string") return null;
  return a;
}

function getRecommendation(result: TraderBrainResult): StrategyRecommendation | null {
  const s = result.sections?.recommendation;
  if (!s || typeof s !== "object") return null;
  const r = s as StrategyRecommendation;
  if (!Array.isArray(r.recommendations)) return null;
  return r;
}

// ---------------------------------------------------------------------------
// Helpers — pulled from the same helpers used by callOpenAi for consistency
// ---------------------------------------------------------------------------

async function recHeadline(rec: StrategyRecommendation): Promise<string> {
  try {
    const { recommendationHeadline } = await import("../mcp/strategy-recommendation");
    return recommendationHeadline(rec);
  } catch {
    return "Combined analysis and recommendation complete.";
  }
}

async function recKeyPoints(rec: StrategyRecommendation): Promise<string[]> {
  try {
    const { recommendationKeyPoints } = await import("../mcp/strategy-recommendation");
    return recommendationKeyPoints(rec);
  } catch {
    return [];
  }
}

async function recRiskNote(rec: StrategyRecommendation): Promise<string> {
  try {
    const { recommendationRiskNote } = await import("../mcp/strategy-recommendation");
    return recommendationRiskNote(rec);
  } catch {
    return RISK_NOTE_DEFAULT;
  }
}

async function recConfidence(rec: StrategyRecommendation): Promise<"low" | "medium" | "high"> {
  try {
    const { recommendationConfidence } = await import("../mcp/strategy-recommendation");
    return recommendationConfidence(rec);
  } catch {
    return "medium";
  }
}

async function analysisConfidence(analysis: MultiStrategyAnalysis): Promise<"low" | "medium" | "high"> {
  try {
    const { multiStrategyConfidence } = await import("../mcp/multi-strategy-analysis");
    return multiStrategyConfidence(analysis);
  } catch {
    return "medium";
  }
}

async function recFallbackAnswer(rec: StrategyRecommendation): Promise<string> {
  try {
    const { buildRecommendationFallbackAnswer } = await import("../mcp/strategy-recommendation");
    return buildRecommendationFallbackAnswer(rec).answer;
  } catch {
    return "See the recommendation section for details.";
  }
}

async function analysisFallbackAnswer(analysis: MultiStrategyAnalysis): Promise<string> {
  try {
    const { buildMultiStrategyFallbackAnswer } = await import("../mcp/multi-strategy-analysis");
    return buildMultiStrategyFallbackAnswer(analysis).answer;
  } catch {
    return "See the analysis section for details.";
  }
}

const RISK_NOTE_DEFAULT =
  "AI-generated analysis — not investment advice. Verify with your own plan before trading.";

// ---------------------------------------------------------------------------
// Main builder — async to call recommendation/analysis helpers
// ---------------------------------------------------------------------------

/**
 * Builds a backward-compatible CombinedAskAnswer from a COMBINED intent
 * TraderBrainResult and an optional OpenAI explanation string.
 *
 * Never blends scanner scores with recommendation verdicts.
 * Never fabricates trades when a section is unavailable.
 */
export async function buildCombinedAskAnswer(
  result: TraderBrainResult,
  openAiExplanation: string | null,
): Promise<CombinedAskAnswer> {
  const analysis      = getAnalysis(result);
  const recommendation = getRecommendation(result);

  // -------------------------------------------------------------------------
  // Case 1: Both succeeded
  // -------------------------------------------------------------------------
  if (analysis && recommendation) {
    const [headline, kp, riskNote, confidence] = await Promise.all([
      recHeadline(recommendation),
      recKeyPoints(recommendation),
      recRiskNote(recommendation),
      recConfidence(recommendation),
    ]);

    // Key points: recommendation facts lead (up to 2), then analysis summary
    // fills remaining slots. Keep sections visually distinct — never blend scores
    // with verdicts.
    const allSetups: import("../mcp/multi-strategy-analysis").MultiStrategySetupEntry[] =
      [analysis.primarySetup, ...(analysis.supportingSetups ?? [])]
        .filter((s): s is import("../mcp/multi-strategy-analysis").MultiStrategySetupEntry =>
          s != null && typeof s === "object",
        );
    const analysisPoints = allSetups.slice(0, 3).map((s) => {
      const strat = (s.setup as any)?.strategy ?? "strategy";
      const check = s.candidateCheck;
      return check
        ? `${strat}: ${check.status}`
        : `${strat}: checked`;
    });
    const analysisPoints2 = analysisPoints.length > 0
      ? analysisPoints
      : [`Strategies matched: ${analysis.strategiesMatched}/${analysis.strategiesChecked}`];

    const merged = Array.from(new Set([...kp.slice(0, 2), ...analysisPoints2])).slice(0, 5);

    const answer =
      typeof openAiExplanation === "string" && openAiExplanation.length > 0
        ? openAiExplanation
        : await recFallbackAnswer(recommendation);

    return {
      headline,
      answer,
      keyPoints: merged.length > 0 ? merged : kp,
      riskNote,
      confidence,
      multiStrategyAnalysis: analysis,
      strategyRecommendation: recommendation,
    };
  }

  // -------------------------------------------------------------------------
  // Case 2: Analysis succeeded, recommendation failed
  // -------------------------------------------------------------------------
  if (analysis && !recommendation) {
    const [confidence, analysisAnswer] = await Promise.all([
      analysisConfidence(analysis),
      openAiExplanation
        ? Promise.resolve(openAiExplanation)
        : analysisFallbackAnswer(analysis),
    ]);

    const symbol = result.normalizedRequest?.symbol ?? analysis.symbol ?? "this symbol";

    return {
      headline: `${symbol} analysis complete — trade recommendation unavailable`,
      answer:
        analysisAnswer +
        "\n\nTrade recommendation: The recommendation engine was temporarily unavailable. " +
        "The analysis above reflects scanner results only — no recommendation verdict was produced.",
      keyPoints: [
        `Overall verdict: ${analysis.overallVerdict}`,
        `Strategies matched: ${analysis.strategiesMatched}/${analysis.strategiesChecked}`,
        ...(analysis.primarySetup
          ? [`Primary setup: ${(analysis.primarySetup.setup as any)?.strategy ?? "n/a"}`]
          : []),
      ].slice(0, 5),
      riskNote: RISK_NOTE_DEFAULT,
      confidence,
      multiStrategyAnalysis: analysis,
      recommendationFailed: true,
    };
  }

  // -------------------------------------------------------------------------
  // Case 3: Recommendation succeeded, analysis failed
  // -------------------------------------------------------------------------
  if (!analysis && recommendation) {
    const [headline, kp, riskNote, confidence] = await Promise.all([
      recHeadline(recommendation),
      recKeyPoints(recommendation),
      recRiskNote(recommendation),
      recConfidence(recommendation),
    ]);

    const recAnswer = await (openAiExplanation
      ? Promise.resolve(openAiExplanation)
      : recFallbackAnswer(recommendation));

    return {
      headline,
      answer:
        recAnswer +
        "\n\nNote: Multi-strategy analysis was temporarily unavailable for this request. " +
        "The recommendation above is based on market context without the full scanner analysis.",
      keyPoints: kp,
      riskNote,
      confidence,
      strategyRecommendation: recommendation,
    };
  }

  // -------------------------------------------------------------------------
  // Case 4: Both failed
  // -------------------------------------------------------------------------
  const symbol = result.normalizedRequest?.symbol ?? result.normalizedRequest?.tickers?.[0] ?? "this symbol";
  return {
    headline: `${symbol} analysis and recommendation temporarily unavailable`,
    answer:
      "The multi-strategy scanner and recommendation engine were both temporarily unavailable " +
      "for this request. This is usually a transient issue — please try again in a moment. " +
      "No trade information has been fabricated.",
    keyPoints: [
      "Scanner unavailable — try again shortly",
      "Recommendation engine unavailable",
      "No invented trade data — all sections honest about availability",
    ],
    riskNote: RISK_NOTE_DEFAULT,
    confidence: "low" as const,
    recommendationFailed: true,
  };
}

// ---------------------------------------------------------------------------
// OpenAI prompt builders (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Builds the system prompt for a focused combined explanation call.
 * Returns null when there are no sections to explain.
 */
export function buildCombinedSystemPrompt(result: TraderBrainResult): string | null {
  const analysis      = getAnalysis(result);
  const recommendation = getRecommendation(result);
  if (!analysis && !recommendation) return null;

  const verdicts = recommendation?.recommendations
    .map((r) => r.overallVerdict)
    .filter(Boolean)
    .join(", ");

  const parts: string[] = [
    "You are a concise trading analyst. The user asked for both a multi-strategy analysis AND a trade recommendation for a specific symbol.",
    "Deterministic data has already been computed — your job is to write a plain-English explanation that connects the two sections.",
    "",
    "HARD RULES:",
    "- Never invent price levels, strikes, expiry dates, or contract details.",
    "- Never override, contradict, or modify the MCP-determined verdicts.",
    "- Never claim a trade was placed or that any order exists.",
    "- Do NOT blend scanner scores with recommendation verdicts in a misleading way.",
    "- Keep the explanation under 350 words.",
  ];

  if (recommendation && verdicts) {
    parts.push(`- The recommendation verdict(s) [${verdicts}] are the source of truth — your prose may explain them but may NOT contradict them.`);
  }

  if (analysis && !recommendation) {
    parts.push("- The trade recommendation was unavailable — acknowledge this honestly; do NOT invent a recommendation.");
  }

  if (!analysis && recommendation) {
    parts.push("- The multi-strategy analysis was unavailable — acknowledge this honestly; do NOT invent scanner scores.");
  }

  return parts.join("\n");
}

/**
 * Builds the user-facing content for the explanation call.
 * Includes only safe scalar summaries — never full payloads.
 */
export function buildCombinedUserContent(
  result: TraderBrainResult,
  question: string,
): string {
  const analysis      = getAnalysis(result);
  const recommendation = getRecommendation(result);

  const lines: string[] = [
    `User asked: "${question}"`,
    "",
  ];

  if (analysis) {
    const sym = analysis.symbol ?? "unknown";
    lines.push(`ANALYSIS — ${sym}:`);
    lines.push(`  Overall verdict: ${analysis.overallVerdict ?? "n/a"}`);
    lines.push(`  Strategies checked: ${analysis.strategiesChecked ?? "n/a"}, matched: ${analysis.strategiesMatched ?? "n/a"}`);
    if (analysis.primarySetup) {
      const pStrat = (analysis.primarySetup.setup as any)?.strategy ?? "n/a";
      const pCheck = analysis.primarySetup.candidateCheck;
      lines.push(`  Primary setup: ${pStrat} — ${pCheck?.status ?? "checked"}`);
    }
    const supporting = (analysis.supportingSetups ?? []).slice(0, 4);
    for (const s of supporting) {
      const strat = (s.setup as any)?.strategy ?? "n/a";
      lines.push(`  Supporting: ${strat} — ${s.candidateCheck?.status ?? "checked"}`);
    }
    lines.push("");
  } else {
    lines.push("ANALYSIS: temporarily unavailable");
    lines.push("");
  }

  if (recommendation) {
    const ideas = recommendation.recommendations.slice(0, 3).map((r) => {
      const parts = [r.recommendedStrategy ?? "unknown strategy"];
      if (r.overallVerdict) parts.push(`verdict: ${r.overallVerdict}`);
      if (r.warnings && r.warnings.length > 0) parts.push(`note: ${r.warnings[0]}`);
      return `  - ${parts.join(" | ")}`;
    });
    lines.push("RECOMMENDATION:");
    if (ideas.length > 0) lines.push(...ideas);
    else lines.push("  No actionable strategy returned.");
    lines.push("");
  } else {
    lines.push("RECOMMENDATION: temporarily unavailable");
    lines.push("");
  }

  lines.push("Please write a concise plain-English explanation connecting the above. No invented numbers.");

  return lines.join("\n");
}
