// TraderBrain Core — Response Composer.
//
// Builds a TraderBrainResult from a ToolPlan + ToolEvidence[].
// Never changes deterministic domain content (verdicts, candidates, counts).
// OpenAI prose is additive only — structural sections are always independent.
//
// Backward-compatibility rule:
//   Existing AskResponse fields must never be removed during migration.
//   This module only ADDS the `traderBrain` shadow field.

import type {
  ToolPlan,
  ToolEvidence,
  TraderBrainResult,
  TraderBrainSections,
  TrustedContext,
  NextAction,
  BrainExecutionStatus,
  TraderBrainResponseField,
} from "./types";
import {
  aggregateWarnings,
  aggregateLimitations,
  deriveStatus,
} from "./evidence";
import { ruleBasedFallback, unavailableHeadline } from "./fallbacks";

import type { MultiStrategyAnalysis } from "../mcp/multi-strategy-analysis";
import type { StrategyRecommendation } from "../mcp/strategy-recommendation";
import type { RankedTradeSearch } from "../routes/ranked-trade-search";
import type { PortfolioTradePlan } from "../routes/portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Section extraction from evidence
// ---------------------------------------------------------------------------

function getEvidence(evidence: ToolEvidence[], stepId: string): ToolEvidence | undefined {
  return evidence.find((e) => e.stepId === stepId);
}

function buildSections(plan: ToolPlan, evidence: ToolEvidence[]): TraderBrainSections {
  const sections: TraderBrainSections = {};

  for (const step of plan.steps) {
    const ev = getEvidence(evidence, step.id);
    if (!ev || ev.status === "skipped") continue;

    switch (step.tool) {
      case "multi_strategy_analysis":
        sections.analysis = ev.status !== "failed"
          ? (ev.data as MultiStrategyAnalysis)
          : null;
        break;

      case "recommend_trade_strategy":
        sections.recommendation = ev.status !== "failed"
          ? (ev.data as StrategyRecommendation)
          : null;
        break;

      case "rank_market_trade_candidates":
        sections.rankedSearch = ev.status !== "failed"
          ? (ev.data as RankedTradeSearch)
          : null;
        break;

      case "plan_portfolio_trade":
        sections.portfolioTradePlan = ev.status !== "failed"
          ? (ev.data as PortfolioTradePlan)
          : null;
        break;

      case "openai_explanation":
        if (ev.status !== "failed" && ev.data != null) {
          sections.openAiExplanation = typeof ev.data === "string" ? ev.data : undefined;
        }
        break;
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Headline derivation (deterministic — never model-generated for trade intents)
// ---------------------------------------------------------------------------

function deriveHeadline(
  plan: ToolPlan,
  sections: TraderBrainSections,
  status: BrainExecutionStatus,
): string {
  if (status === "unavailable" || status === "error") {
    return unavailableHeadline(plan.intent, plan.normalizedRequest.symbol);
  }

  // Ranked search
  if (sections.rankedSearch) {
    const rs = sections.rankedSearch;
    const n = rs.candidates.length + rs.watchCandidates.length;
    if (n === 0) return "No qualifying trade setups found for this search.";
    const q = rs.qualifiedCount;
    return q > 0
      ? `Found ${q} qualifying trade setup${q !== 1 ? "s" : ""} matching your criteria.`
      : "Trade setups were reviewed — none reached the qualification threshold.";
  }

  // Recommendation
  if (sections.recommendation) {
    const recs = sections.recommendation.recommendations;
    if (recs.length > 0) {
      const verdict = recs[0].overallVerdict;
      const strategy = recs[0].recommendedStrategy;
      if (verdict === "LIVE_OPTIONS" || verdict === "ESTIMATED_OPTIONS") {
        return strategy
          ? `Trade ready: ${strategy} on ${plan.normalizedRequest.symbol ?? "this symbol"}.`
          : "Trade ready — options strategy identified.";
      }
      if (verdict === "STOCK") {
        return `Stock setup identified for ${plan.normalizedRequest.symbol ?? "this symbol"}.`;
      }
      if (verdict === "WATCH") {
        return `${plan.normalizedRequest.symbol ?? "This setup"} is worth watching — not yet actionable.`;
      }
      return `No qualifying trade setup found for ${plan.normalizedRequest.symbol ?? "this symbol"}.`;
    }
  }

  // Portfolio plan
  if (sections.portfolioTradePlan) {
    const plan_ = sections.portfolioTradePlan;
    if (!plan_.feasibility.feasible) {
      return `No feasible trade found within the specified constraints.`;
    }
    const n = plan_.qualifiedCandidates.length;
    return n > 0
      ? `Found ${n} portfolio-compatible trade${n !== 1 ? "s" : ""} matching your constraints.`
      : "Portfolio plan generated — no candidates qualified under all constraints.";
  }

  // Analysis
  if (sections.analysis && "overallVerdict" in sections.analysis) {
    const msa = sections.analysis as MultiStrategyAnalysis;
    return msa.primarySetup
      ? `${msa.symbol} — primary setup: ${msa.primarySetup.strategy ?? "identified"}.`
      : `${msa.symbol} analysis complete — no primary setup qualified.`;
  }

  // OpenAI prose only
  if (sections.openAiExplanation) {
    const first = sections.openAiExplanation.split("\n")[0].replace(/^#+\s*/, "").trim();
    if (first.length > 10 && first.length < 150) return first;
  }

  return "Analysis complete.";
}

// ---------------------------------------------------------------------------
// Confidence derivation
// ---------------------------------------------------------------------------

function deriveConfidence(
  sections: TraderBrainSections,
  status: BrainExecutionStatus,
): "high" | "medium" | "low" | "none" {
  if (status === "unavailable" || status === "error") return "none";
  if (sections.recommendation?.recommendations?.[0]?.confidence != null) {
    const c = sections.recommendation.recommendations[0].confidence as number;
    if (c >= 0.7) return "high";
    if (c >= 0.4) return "medium";
    return "low";
  }
  if (sections.rankedSearch) {
    return sections.rankedSearch.qualifiedCount > 0 ? "medium" : "low";
  }
  if (sections.analysis && "dataQuality" in sections.analysis) {
    const dq = (sections.analysis as MultiStrategyAnalysis).dataQuality;
    if (dq.realMarketData && dq.fresh) return "high";
    if (dq.realMarketData) return "medium";
    return "low";
  }
  return "low";
}

// ---------------------------------------------------------------------------
// CTA derivation
// ---------------------------------------------------------------------------

function deriveCtas(plan: ToolPlan, sections: TraderBrainSections): NextAction[] {
  const symbol = plan.normalizedRequest.symbol;
  const actions: NextAction[] = [];

  if (sections.recommendation?.recommendations?.[0]) {
    const v = sections.recommendation.recommendations[0].overallVerdict;
    if (v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS" || v === "STOCK") {
      if (symbol) {
        actions.push({ label: `Build ticket for ${symbol}`, href: `/trade/${symbol}`, gate: "verdict_trade_ready" });
        actions.push({ label: `Open ${symbol} chart`, href: `/charts/${symbol}`, gate: "always" });
      }
    } else if (v === "WATCH") {
      if (symbol) {
        actions.push({ label: `Watch ${symbol}`, href: `/trade/${symbol}`, gate: "verdict_watch" });
      }
    }
    return actions;
  }

  if (sections.rankedSearch) {
    actions.push({ label: "See all opportunities", href: "/opportunity-radar", gate: "always" });
    actions.push({ label: "Open Trade Builder", href: "/trade-finder", gate: "always" });
    return actions;
  }

  if (sections.portfolioTradePlan) {
    actions.push({ label: "Open Trade Builder", href: "/trade-finder", gate: "always" });
    return actions;
  }

  if (symbol) {
    actions.push({ label: `Analyze ${symbol}`, href: `/ask?q=analyze+${symbol}`, gate: "always" });
  }
  actions.push({ label: "Open Trade Builder", href: "/trade-finder", gate: "always" });
  actions.push({ label: "See ranked opportunities", href: "/opportunity-radar", gate: "always" });
  return actions;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Composes a TraderBrainResult from a completed execution.
 * Deterministic sections are never altered by this function.
 * OpenAI prose is additive and optional.
 */
export function composeBrainResult(
  requestId: string,
  plan: ToolPlan,
  evidence: ToolEvidence[],
  _ctx: TrustedContext, // reserved for future use; never logged
): TraderBrainResult {
  const sections = buildSections(plan, evidence);
  const status = deriveStatus(evidence, plan);
  const headline = deriveHeadline(plan, sections, status);
  const confidence = deriveConfidence(sections, status);
  const warnings = aggregateWarnings(evidence);
  const limitations = aggregateLimitations(evidence);
  const nextActions = deriveCtas(plan, sections);

  const openAiEv = evidence.find((e) => e.stepId === "openai" && e.status !== "failed");
  const openAiUsed = Boolean(openAiEv && typeof sections.openAiExplanation === "string");

  return {
    requestId,
    intent: plan.intent,
    normalizedRequest: plan.normalizedRequest,
    status,
    headline,
    confidence,
    sections,
    evidence, // stripped before client send
    warnings,
    limitations,
    nextActions,
    generatedAt: new Date().toISOString(),
    openAiUsed,
    openAiRole: openAiUsed ? (plan.responsePolicy.openAiRole as "explanation" | "prose" | "education") : undefined,
  };
}

/**
 * Projects a TraderBrainResult to the additive `traderBrain` field added to
 * the existing AskResponse during shadow mode. Evidence is always stripped.
 * No tokens, account IDs, or sensitive data appear in this projection.
 */
export function projectToResponseField(result: TraderBrainResult): TraderBrainResponseField {
  return {
    intent: result.intent,
    status: result.status,
    // Strip evidence; strip portfolioFit fields that contain portfolio data.
    sections: {
      ...result.sections,
      // portfolioFit may contain buying-power sufficiency — safe to include as-is
      // (SafePortfolioAwareness contains no account IDs or raw balances by contract).
    },
    warnings: result.warnings,
    generatedAt: result.generatedAt,
  };
}

/**
 * Generates an honest fallback result when a non-recoverable error occurs
 * before the plan can be executed.
 */
export function buildFallbackResult(
  requestId: string,
  plan: ToolPlan,
  safeErrorCode: string,
): TraderBrainResult {
  const fallback = ruleBasedFallback(plan.intent, plan.normalizedRequest.symbol);
  return {
    requestId,
    intent: plan.intent,
    normalizedRequest: plan.normalizedRequest,
    status: "unavailable",
    headline: fallback.headline,
    confidence: "none",
    sections: {},
    evidence: [],
    warnings: [],
    limitations: [`Service temporarily unavailable (${safeErrorCode}). No data was fabricated.`],
    nextActions: [
      { label: "Open Trade Builder", href: "/trade-finder", gate: "always" },
      { label: "See opportunities", href: "/opportunity-radar", gate: "always" },
    ],
    generatedAt: new Date().toISOString(),
    openAiUsed: false,
  };
}
