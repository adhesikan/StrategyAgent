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
// Canonical trigger (§2 — resolved across both deterministic sections)
// ---------------------------------------------------------------------------

/**
 * One canonical entry trigger resolved with strict precedence.
 * Never silently borrows from an unrelated strategy or direction.
 *
 * Precedence:
 *   1. recommendation.tradeCandidate trigger (any of trigger/entryTrigger/entry/entryPrice)
 *   2. recommendation.setup trigger
 *   3. analysis.primarySetup.setup.trigger (same symbol only)
 *   4. null
 */
export interface CanonicalTrigger {
  price: number;
  basis: string;
  source: "recommendation_candidate" | "recommendation_setup" | "analysis_primary";
  strategy: string;
}

// ---------------------------------------------------------------------------
// Actionability model (§3 — separates four distinct states)
// ---------------------------------------------------------------------------

export interface CombinedActionability {
  /** Underlying stock setup qualifies (analysis TRADE_CANDIDATE or compatible verdict). */
  underlyingSetupActionable: boolean;
  /** Options strategy is estimated — no live chain exists. */
  optionsStructureEstimated: boolean;
  /** Options contract is live — live chain available. */
  optionsContractLive: boolean;
  /**
   * A real trade ticket could be placed — requires LIVE_OPTIONS + non-stale data.
   * ESTIMATED_OPTIONS and STOCK do NOT set this true.
   */
  tradeTicketReady: boolean;
  /**
   * True when analysis.dataQuality.fresh === false (setup older than 10-day window).
   * When true: suppress "Trade Ready"/"actionable now"; show revalidation warning.
   */
  stalenessRequired: boolean;
  /**
   * True when the contract cost can be verified (live chain present).
   * False for ESTIMATED_OPTIONS — buying-power sufficiency cannot imply affordability.
   */
  cashRequirementVerified: boolean;
}

// ---------------------------------------------------------------------------
// Output shape (structurally compatible with ask.ts AskAnswer)
// ---------------------------------------------------------------------------

export interface CombinedAskAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  /** Page-level confidence — always from the recommendation engine, not the analysis. */
  confidence: "low" | "medium" | "high";
  /**
   * Separately labeled analysis confidence — only set when both sections succeeded.
   * Never merged into or shown as the same badge as `confidence`.
   */
  analysisConfidence?: "low" | "medium" | "high";
  /** Resolved canonical trigger — shared between analysis and recommendation display. */
  canonicalTrigger?: CanonicalTrigger | null;
  /** Actionability state — drives all "Trade Ready" / "Estimated" / "Revalidation" labels. */
  actionability?: CombinedActionability;
  multiStrategyAnalysis?: MultiStrategyAnalysis;
  strategyRecommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
}

// ---------------------------------------------------------------------------
// Canonical trigger resolver (§2)
// ---------------------------------------------------------------------------

function tryExtractPrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (v && typeof v === "object") {
    const pl = v as Record<string, unknown>;
    if (typeof pl.price === "number" && Number.isFinite(pl.price) && pl.price > 0) return pl.price;
  }
  return null;
}

function plBasis(v: unknown, fallback: string): string {
  if (v && typeof v === "object") {
    const pl = v as Record<string, unknown>;
    if (typeof pl.basis === "string" && pl.basis.trim()) return pl.basis.trim();
  }
  return fallback;
}

/**
 * Resolves the canonical entry trigger with strict precedence.
 * Never borrows from an unrelated symbol or direction.
 */
export function resolveCanonicalTrigger(
  analysis: MultiStrategyAnalysis | null,
  recommendation: StrategyRecommendation | null,
): CanonicalTrigger | null {
  if (recommendation?.recommendations.length) {
    const idea = recommendation.recommendations[0];
    const cand = ((idea.tradeCandidate ?? {}) as Record<string, unknown>);
    const recStrategy =
      typeof idea.recommendedStrategy === "string" ? idea.recommendedStrategy : "unknown";

    // Priority 1: recommendation tradeCandidate trigger
    for (const field of [cand.trigger, cand.entryTrigger, cand.entry, cand.entryPrice]) {
      const price = tryExtractPrice(field);
      if (price !== null) {
        return { price, basis: plBasis(field, "recommendation candidate"), source: "recommendation_candidate", strategy: recStrategy };
      }
    }

    // Priority 2: recommendation setup trigger
    const setup = ((idea.setup ?? {}) as Record<string, unknown>);
    const setupTrigger = setup.trigger;
    const setupPrice = tryExtractPrice(setupTrigger);
    if (setupPrice !== null) {
      return { price: setupPrice, basis: plBasis(setupTrigger, "recommendation setup"), source: "recommendation_setup", strategy: recStrategy };
    }
  }

  // Priority 3: analysis primary setup trigger (same symbol, compatible)
  if (analysis?.primarySetup) {
    const setup = (analysis.primarySetup.setup as unknown as Record<string, unknown>);
    const setupSymbol = typeof setup.symbol === "string" ? setup.symbol.toUpperCase() : null;
    const analysisSymbol = analysis.symbol.toUpperCase();
    // Only borrow when same symbol or setup has no symbol info to contradict
    if (!setupSymbol || setupSymbol === analysisSymbol) {
      const trigger = (setup.trigger as Record<string, unknown> | null | undefined);
      if (trigger && typeof trigger.price === "number" && Number.isFinite(trigger.price) && trigger.price > 0) {
        return {
          price: trigger.price,
          basis: typeof trigger.basis === "string" ? trigger.basis : "analysis primary setup",
          source: "analysis_primary",
          strategy: typeof setup.strategy === "string" ? setup.strategy : "unknown",
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Actionability model (§3)
// ---------------------------------------------------------------------------

/**
 * Computes the four-state actionability model for a combined result.
 * Separates underlying-setup readiness from options-chain availability.
 * Staleness gates all actionability claims.
 */
export function computeActionability(
  analysis: MultiStrategyAnalysis | null,
  recommendation: StrategyRecommendation | null,
): CombinedActionability {
  const idea = recommendation?.recommendations?.[0];
  const verdict = idea?.overallVerdict as string | undefined;

  const underlyingSetupActionable =
    verdict === "STOCK" ||
    verdict === "LIVE_OPTIONS" ||
    verdict === "ESTIMATED_OPTIONS";

  const optionsStructureEstimated = verdict === "ESTIMATED_OPTIONS";
  const optionsContractLive = verdict === "LIVE_OPTIONS";

  // Staleness: analysis.dataQuality.fresh === false → setup older than 10-day window.
  const fresh = (analysis?.dataQuality as Record<string, unknown> | undefined)?.fresh;
  const stalenessRequired = fresh === false;

  // TRADE_TICKET_READY: only LIVE_OPTIONS with non-stale data.
  // ESTIMATED_OPTIONS is never ticket-ready (no live contract to price).
  const tradeTicketReady = optionsContractLive && !stalenessRequired;

  // Cash requirement unverified when ESTIMATED_OPTIONS (no live chain = no contract cost).
  const cashRequirementVerified = !optionsStructureEstimated;

  return {
    underlyingSetupActionable,
    optionsStructureEstimated,
    optionsContractLive,
    tradeTicketReady,
    stalenessRequired,
    cashRequirementVerified,
  };
}

// ---------------------------------------------------------------------------
// Combined headline builder (§9)
// ---------------------------------------------------------------------------

/**
 * Generates the headline using the precedence defined in §9.
 * Staleness overrides actionability — a stale setup must never appear ready.
 */
function buildCombinedHeadline(
  symbol: string,
  recommendation: StrategyRecommendation | null,
  analysis: MultiStrategyAnalysis | null,
  actionability: CombinedActionability,
): string {
  const idea = recommendation?.recommendations?.[0];
  const verdict = idea?.overallVerdict as string | undefined;
  const recStrat = typeof idea?.recommendedStrategy === "string" ? ` (${idea.recommendedStrategy})` : "";

  if (actionability.stalenessRequired) {
    return `${symbol} has a setup that requires fresh confirmation before action`;
  }
  if (verdict === "LIVE_OPTIONS" && actionability.optionsContractLive) {
    return `${symbol}: live options trade candidate identified`;
  }
  if (verdict === "STOCK" && actionability.underlyingSetupActionable) {
    return `${symbol}: stock trade candidate identified${recStrat}`;
  }
  if (verdict === "ESTIMATED_OPTIONS" && actionability.underlyingSetupActionable) {
    return `${symbol} has a qualified setup; options implementation remains estimated`;
  }
  if (verdict === "WATCH" || analysis?.overallVerdict === "WATCH") {
    return `${symbol} is worth watching but not yet actionable`;
  }
  if (verdict === "NO_TRADE") {
    return `No qualifying trade found for ${symbol}`;
  }
  if (analysis?.overallVerdict === "TRADE_CANDIDATE") {
    return `${symbol} analysis: setup qualifies`;
  }
  return `${symbol}: combined analysis and recommendation complete`;
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
    // Resolve canonical trigger and actionability before headline
    const canonicalTrigger = resolveCanonicalTrigger(analysis, recommendation);
    const actionability = computeActionability(analysis, recommendation);

    // §9 headline: freshness/verdict/options state drives the wording
    const headline = buildCombinedHeadline(analysis.symbol, recommendation, analysis, actionability);

    const [kp, riskNote, confidence, aConf] = await Promise.all([
      recKeyPoints(recommendation),
      recRiskNote(recommendation),
      recConfidence(recommendation),
      analysisConfidence(analysis),
    ]);

    // Key points: recommendation facts lead (up to 2), then analysis summary
    // fills remaining slots. Prepend actionability warnings so they are always
    // visible even when OpenAI is the answer text. Keep sections distinct.
    const allSetups: import("../mcp/multi-strategy-analysis").MultiStrategySetupEntry[] =
      [analysis.primarySetup, ...(analysis.supportingSetups ?? [])]
        .filter((s): s is import("../mcp/multi-strategy-analysis").MultiStrategySetupEntry =>
          s != null && typeof s === "object",
        );
    const analysisPoints = allSetups.slice(0, 3).map((s) => {
      const strat = (s.setup as any)?.strategy ?? "strategy";
      const check = s.candidateCheck;
      return check ? `${strat}: ${check.status}` : `${strat}: checked`;
    });
    const analysisPoints2 = analysisPoints.length > 0
      ? analysisPoints
      : [`Strategies matched: ${analysis.strategiesMatched}/${analysis.strategiesChecked}`];

    // §3 actionability warnings — prepended so they appear even if kp is short
    const actionabilityPoints: string[] = [];
    if (actionability.stalenessRequired) {
      actionabilityPoints.push("Setup data is older than the freshness window — revalidation required before action");
    }
    if (actionability.optionsStructureEstimated) {
      actionabilityPoints.push("Options strategy is estimated — no live contract has been selected");
    }
    if (!actionability.cashRequirementVerified) {
      actionabilityPoints.push("Contract cost unverified — connect a live options provider to price the trade");
    }

    const merged = Array.from(
      new Set([...actionabilityPoints, ...kp.slice(0, 2), ...analysisPoints2]),
    ).slice(0, 5);

    const answer =
      typeof openAiExplanation === "string" && openAiExplanation.length > 0
        ? openAiExplanation
        : await recFallbackAnswer(recommendation);

    return {
      headline,
      answer,
      keyPoints: merged.length > 0 ? merged : kp,
      riskNote,
      // §4 confidence ownership: page-level = recommendation; analysis labeled separately
      confidence,
      analysisConfidence: aConf,
      canonicalTrigger,
      actionability,
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
    "",
    "STRATEGY EVIDENCE RULES:",
    "- Use exact strategy evidence categories from the user content: READY (confirmed), WATCH (forming), REJECTED (does not qualify), SUPPORTING (contextual), ALTERNATIVE.",
    "- NEVER say 'all strategies matched positively' unless every listed strategy has READY status. Report the actual distribution.",
    "- ESTIMATED_OPTIONS means the underlying setup qualifies but options remain estimated — do NOT imply the trade is ticket-ready or fully priced.",
    "- If the data is stale (freshness window exceeded), write 'requires revalidation before action' — NOT 'actionable now'.",
    "- If the canonical trigger comes from the analysis (not the recommendation), label it as the analysis trigger — do not present it as the recommendation's own level.",
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
    const fresh = (analysis.dataQuality as Record<string, unknown> | undefined)?.fresh;
    const freshnessNote = fresh === false ? " [STALE — older than freshness window; requires revalidation]"
      : fresh === true ? " [fresh]"
      : " [freshness unknown]";

    lines.push(`ANALYSIS — ${sym}${freshnessNote}:`);
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
    // §5 strategy evidence — per-strategy breakdown from evaluations[]
    // Grouped into READY/WATCH/REJECTED/SUPPORTING/ALTERNATIVE
    const evidence = recommendation.recommendationEvidence;
    if (evidence?.evaluations && evidence.evaluations.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const ev of evidence.evaluations) {
        (grouped[ev.status] ??= []).push(ev.strategy);
      }
      lines.push("STRATEGY EVIDENCE (per-strategy breakdown):");
      for (const [status, strategies] of Object.entries(grouped)) {
        lines.push(`  ${status}: ${strategies.join(", ")} (${strategies.length})`);
      }
      lines.push(`  Total evaluated: ${evidence.summary.strategiesEvaluated ?? "n/a"}, actionable: ${evidence.summary.ideasActionable}, watch: ${evidence.summary.ideasWatch}`);
      lines.push("");
    }

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

    // §2 canonical trigger — resolved with precedence
    const canonicalTrigger = resolveCanonicalTrigger(analysis, recommendation);
    if (canonicalTrigger) {
      lines.push(`CANONICAL TRIGGER: $${canonicalTrigger.price} (${canonicalTrigger.basis}) — sourced from ${canonicalTrigger.source.replace(/_/g, " ")}, strategy: ${canonicalTrigger.strategy}`);
      lines.push("");
    } else {
      lines.push("CANONICAL TRIGGER: none resolved — no valid price level in either section");
      lines.push("");
    }
  } else {
    lines.push("RECOMMENDATION: temporarily unavailable");
    lines.push("");
  }

  lines.push("Please write a concise plain-English explanation connecting the above. No invented numbers. Use the strategy evidence categories exactly.");

  return lines.join("\n");
}
