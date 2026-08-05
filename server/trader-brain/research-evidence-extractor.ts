// Research Evidence Extractor — Sprint 5.4C
//
// Maps a completed TraderBrainResult to a ResearchEvidenceRecord for the
// matching domain. This is the trusted server-side extraction step — no client
// input touches the evidence content.
//
// Domain mapping:
//   ANALYZE_SYMBOL                  → SYMBOL_ANALYSIS
//   RECOMMEND_SYMBOL_TRADE          → TRADE_RESEARCH
//   RANK_MARKET_TRADES              → MARKET_OPPORTUNITY_SEARCH
//   PLAN_PORTFOLIO_TRADE            → PORTFOLIO_GOAL_RESEARCH
//   COMBINED_ANALYSIS_RECOMMENDATION→ SYMBOL_ANALYSIS (analysis) or TRADE_RESEARCH (recommendation)
//   EDUCATION_PLUS_ACTION           → no evidence (education-only)
//   EXPLAIN_CONCEPT / MARKET_RESEARCH → no evidence
//
// When portfolioIntelligence is present: PORTFOLIO_IMPACT domain.
//
// Returns null when the result cannot produce a save handle (spec §10).

import type { TraderBrainResult, TraderBrainIntent } from "./types";
import type { ResearchEvidenceRecord, ResearchDomain } from "../services/research-save-handle";
import type { PortfolioIntelligence } from "./portfolio-intelligence-engine";

// ---------------------------------------------------------------------------
// Intents that never produce evidence
// ---------------------------------------------------------------------------

const NO_EVIDENCE_INTENTS = new Set<TraderBrainIntent>([
  "EXPLAIN_CONCEPT",
  "MARKET_RESEARCH",
  "EDUCATION_PLUS_ACTION",
  "UNKNOWN",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 50);
}

function extractSourceTools(result: TraderBrainResult): string[] {
  const tools = new Set<string>();
  for (const ev of (result.evidence ?? [])) {
    if (ev.tool) tools.add(String(ev.tool));
  }
  return [...tools].slice(0, 20);
}

function extractSourceTimestamps(result: TraderBrainResult): string[] {
  const timestamps: string[] = [];
  for (const ev of (result.evidence ?? [])) {
    if (ev.generatedAt && typeof ev.generatedAt === "string") {
      timestamps.push(ev.generatedAt);
    }
  }
  if (timestamps.length === 0) timestamps.push(result.generatedAt ?? new Date().toISOString());
  return [...new Set(timestamps)].slice(0, 20);
}

function extractDataQuality(result: TraderBrainResult): ResearchEvidenceRecord["dataQuality"] {
  let estimated = false;
  let simulated = false;
  let partial = false;
  let stale = false;
  for (const ev of (result.evidence ?? [])) {
    if (ev.dataQuality?.estimated) estimated = true;
    if (ev.dataQuality?.simulated) simulated = true;
    if (ev.dataQuality?.partial) partial = true;
    if (ev.dataQuality?.stale) stale = true;
  }
  const dq: ResearchEvidenceRecord["dataQuality"] = {};
  if (estimated) dq.estimated = true;
  if (simulated) dq.simulated = true;
  if (partial) dq.partial = true;
  if (stale) dq.stale = true;
  return dq;
}

function normalizedRequestSummary(result: TraderBrainResult): string {
  const req = result.normalizedRequest;
  if (!req) return result.headline?.slice(0, 500) ?? "Research request";
  const parts: string[] = [];
  if (req.intent) parts.push(req.intent);
  if (req.symbol) parts.push(req.symbol);
  else if (req.tickers?.length) parts.push(req.tickers.slice(0, 5).join(", "));
  if (req.direction) parts.push(req.direction);
  if (req.maxRiskDollars) parts.push(`maxRisk $${req.maxRiskDollars}`);
  const base = parts.join(" · ");
  // Append first 100 chars of raw prompt for context
  const raw = req.rawPrompt?.slice(0, 100) ?? "";
  return [base, raw].filter(Boolean).join(" — ").slice(0, 500);
}

// ---------------------------------------------------------------------------
// Domain-specific extractors
// ---------------------------------------------------------------------------

function extractSymbolAnalysis(result: TraderBrainResult): ResearchEvidenceRecord | null {
  const analysis = result.sections?.analysis;
  if (!analysis) return null;

  // Strip forbidden fields from the snapshot
  const snapshot: Record<string, unknown> = {};
  if ("pattern" in analysis) snapshot.vcpAnalysis = analysis;
  else snapshot.multiStrategyAnalysis = analysis;

  const req = result.normalizedRequest;
  return {
    schemaVersion: "1.0",
    domain: "SYMBOL_ANALYSIS",
    requestId: result.requestId,
    symbol: req?.symbol ?? req?.tickers?.[0],
    symbols: req?.tickers ?? [],
    normalizedRequestSummary: normalizedRequestSummary(result),
    verdict: result.headline.slice(0, 500),
    confidence: result.confidence,
    dataQuality: extractDataQuality(result),
    reasons: safeStrArray(result.sections?.analysis && "reasons" in result.sections.analysis
      ? (result.sections.analysis as Record<string, unknown>).reasons
      : []),
    warnings: safeStrArray(result.warnings),
    watchConditions: [],
    sourceTools: extractSourceTools(result),
    sourceTimestamps: extractSourceTimestamps(result),
    limitations: safeStrArray(result.limitations),
    domainSnapshot: snapshot,
    generatedAt: result.generatedAt,
  };
}

function extractTradeResearch(result: TraderBrainResult): ResearchEvidenceRecord | null {
  const rec = result.sections?.recommendation;
  if (!rec) return null;

  const req = result.normalizedRequest;
  // Scrub the recommendation snapshot of any sensitive-looking keys
  const snapshot: Record<string, unknown> = { recommendation: rec };

  // Extract strategy info from first recommendation
  const firstRec = Array.isArray((rec as Record<string, unknown>).recommendations)
    ? ((rec as Record<string, unknown>).recommendations as Record<string, unknown>[])[0]
    : undefined;

  return {
    schemaVersion: "1.0",
    domain: "TRADE_RESEARCH",
    requestId: result.requestId,
    symbol: req?.symbol ?? req?.tickers?.[0],
    symbols: req?.tickers ?? [],
    normalizedRequestSummary: normalizedRequestSummary(result),
    verdict: result.headline.slice(0, 500),
    strategy: firstRec?.strategy as string | undefined,
    strategyDisplayName: firstRec?.strategyDisplayName as string | undefined,
    direction: req?.direction,
    instrument: firstRec?.instrument as string | undefined,
    confidence: result.confidence,
    dataQuality: extractDataQuality(result),
    reasons: safeStrArray((rec as Record<string, unknown>).reasons ?? []),
    warnings: safeStrArray(result.warnings),
    watchConditions: safeStrArray((rec as Record<string, unknown>).watchConditions ?? []),
    sourceTools: extractSourceTools(result),
    sourceTimestamps: extractSourceTimestamps(result),
    limitations: safeStrArray(result.limitations),
    domainSnapshot: snapshot,
    generatedAt: result.generatedAt,
  };
}

function extractMarketOpportunitySearch(result: TraderBrainResult): ResearchEvidenceRecord | null {
  const ranked = result.sections?.rankedSearch;
  if (!ranked) return null;

  const req = result.normalizedRequest;
  // Safe candidate summary — strip anything that could embed credentials
  const candidates = ((ranked as Record<string, unknown>).candidates as unknown[] ?? [])
    .slice(0, 20)
    .map((c) => {
      const cd = c as Record<string, unknown>;
      return {
        symbol: cd.symbol,
        strategy: cd.strategy,
        direction: cd.direction,
        confidence: cd.confidence,
        maxRisk: cd.maxRisk,
      };
    });

  return {
    schemaVersion: "1.0",
    domain: "MARKET_OPPORTUNITY_SEARCH",
    requestId: result.requestId,
    symbols: candidates.map((c) => String(c.symbol ?? "")).filter(Boolean).slice(0, 20),
    normalizedRequestSummary: normalizedRequestSummary(result),
    verdict: result.headline.slice(0, 500),
    direction: req?.direction,
    confidence: result.confidence,
    dataQuality: extractDataQuality(result),
    reasons: [],
    warnings: safeStrArray(result.warnings),
    watchConditions: [],
    sourceTools: extractSourceTools(result),
    sourceTimestamps: extractSourceTimestamps(result),
    limitations: safeStrArray(result.limitations),
    domainSnapshot: {
      rankedSearch: {
        candidates,
        excludedCount: (ranked as Record<string, unknown>).excludedCount,
        groupedCandidateCount: (ranked as Record<string, unknown>).groupedCandidateCount,
        maxRiskDollars: (ranked as Record<string, unknown>).maxRiskDollars,
      },
    },
    generatedAt: result.generatedAt,
  };
}

function extractPortfolioGoalResearch(result: TraderBrainResult): ResearchEvidenceRecord | null {
  const plan = result.sections?.portfolioTradePlan;
  if (!plan) return null;

  const req = result.normalizedRequest;
  const p = plan as Record<string, unknown>;

  return {
    schemaVersion: "1.0",
    domain: "PORTFOLIO_GOAL_RESEARCH",
    requestId: result.requestId,
    symbols: safeStrArray(
      (p.qualifiedCandidates as unknown[] ?? []).map((c) => (c as Record<string, unknown>).symbol).filter(Boolean)
    ),
    normalizedRequestSummary: normalizedRequestSummary(result),
    verdict: result.headline.slice(0, 500),
    direction: req?.direction,
    confidence: result.confidence,
    dataQuality: extractDataQuality(result),
    reasons: safeStrArray(p.whySelected ?? []),
    warnings: safeStrArray(p.warnings ?? result.warnings),
    watchConditions: [],
    sourceTools: extractSourceTools(result),
    sourceTimestamps: extractSourceTimestamps(result),
    limitations: safeStrArray(result.limitations),
    domainSnapshot: {
      portfolioTradePlan: {
        feasibility: p.feasibility,
        portfolioConstraints: p.portfolioConstraints,
        qualifiedCandidates: ((p.qualifiedCandidates as unknown[] ?? []).slice(0, 10).map((c) => {
          const cd = c as Record<string, unknown>;
          return { symbol: cd.symbol, strategy: cd.strategy, direction: cd.direction, maxRiskDollars: cd.maxRiskDollars };
        })),
        portfolioImpact: p.portfolioImpact,
        warnings: p.warnings,
      },
    },
    generatedAt: result.generatedAt,
  };
}

function extractPortfolioImpact(
  result: TraderBrainResult,
  portfolioIntelligence: PortfolioIntelligence,
): ResearchEvidenceRecord | null {
  if (!portfolioIntelligence.hasPortfolioContext) return null;

  const req = result.normalizedRequest;
  return {
    schemaVersion: "1.0",
    domain: "PORTFOLIO_IMPACT",
    requestId: result.requestId,
    symbol: req?.symbol ?? req?.tickers?.[0],
    symbols: req?.tickers ?? [],
    normalizedRequestSummary: normalizedRequestSummary(result),
    verdict: result.headline.slice(0, 500),
    confidence: result.confidence,
    dataQuality: extractDataQuality(result),
    reasons: [],
    warnings: safeStrArray(result.warnings),
    watchConditions: [],
    sourceTools: extractSourceTools(result),
    sourceTimestamps: extractSourceTimestamps(result),
    limitations: [
      ...safeStrArray(result.limitations),
      ...safeStrArray(portfolioIntelligence.dataQuality.limitations),
    ].slice(0, 20),
    domainSnapshot: {
      portfolioIntelligence: {
        hasPortfolioContext: portfolioIntelligence.hasPortfolioContext,
        cashUtilization: portfolioIntelligence.cashUtilization,
        concentration: portfolioIntelligence.concentration,
        candidateImpact: portfolioIntelligence.candidateImpact.map((c) => ({
          symbol: c.symbol,
          strategy: c.strategy,
          existingHolding: c.existingHolding,
          duplicateExposure: c.duplicateExposure,
          concentrationBefore: c.concentrationBefore,
          concentrationAfterEstimate: c.concentrationAfterEstimate,
          concentrationLevel: c.concentrationLevel,
          // capitalEffect text (not raw amounts) is safe
          capitalEffect: c.capitalEffect,
          diversificationNote: c.diversificationNote,
        })),
        dataQuality: portfolioIntelligence.dataQuality,
      },
    },
    generatedAt: result.generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  evidence: ResearchEvidenceRecord;
  domain: ResearchDomain;
}

/**
 * Extract a ResearchEvidenceRecord from a TraderBrainResult.
 * Returns null when no save handle should be produced (spec §10).
 * Never throws — catches and returns null on any error.
 */
export function extractResearchEvidence(
  result: TraderBrainResult,
  portfolioIntelligence?: PortfolioIntelligence | null,
): ExtractionResult | null {
  try {
    if (!result || !result.sections) return null;
    if (result.status === "error" || result.status === "unavailable") return null;
    if (NO_EVIDENCE_INTENTS.has(result.intent)) return null;

    const intent = result.intent as TraderBrainIntent;

    // PORTFOLIO_IMPACT: available when portfolio intelligence was computed
    if (portfolioIntelligence?.hasPortfolioContext) {
      const piEvidence = extractPortfolioImpact(result, portfolioIntelligence);
      if (piEvidence) return { evidence: piEvidence, domain: "PORTFOLIO_IMPACT" };
    }

    switch (intent) {
      case "ANALYZE_SYMBOL": {
        const ev = extractSymbolAnalysis(result);
        return ev ? { evidence: ev, domain: "SYMBOL_ANALYSIS" } : null;
      }
      case "RECOMMEND_SYMBOL_TRADE": {
        const ev = extractTradeResearch(result);
        return ev ? { evidence: ev, domain: "TRADE_RESEARCH" } : null;
      }
      case "RANK_MARKET_TRADES": {
        const ev = extractMarketOpportunitySearch(result);
        return ev ? { evidence: ev, domain: "MARKET_OPPORTUNITY_SEARCH" } : null;
      }
      case "PLAN_PORTFOLIO_TRADE": {
        const ev = extractPortfolioGoalResearch(result);
        return ev ? { evidence: ev, domain: "PORTFOLIO_GOAL_RESEARCH" } : null;
      }
      case "COMBINED_ANALYSIS_RECOMMENDATION": {
        // Prefer symbol analysis if present, else trade research
        const symEv = extractSymbolAnalysis(result);
        if (symEv) return { evidence: symEv, domain: "SYMBOL_ANALYSIS" };
        const trEv = extractTradeResearch(result);
        return trEv ? { evidence: trEv, domain: "TRADE_RESEARCH" } : null;
      }
      default:
        return null;
    }
  } catch {
    // Never propagate extraction errors to the caller
    return null;
  }
}
