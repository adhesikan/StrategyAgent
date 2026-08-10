/**
 * Research Workspace Service — Sprint 2.6.4
 *
 * Assembles rich research context from:
 *   • Opportunity Intelligence Engine (Sprint 2.5.0)
 *   • Research Collections (Sprint 2.5.1)
 *   • Sector Intelligence snapshots
 *   • Theme Intelligence snapshots
 *   • Research Monitor (Sprint 2.5.4)
 *   • Research Reports (Sprint 2.5.5)
 *
 * Context is assembled deterministically — AI is forbidden from inventing
 * opportunities, scores, or institutional positions. It explains evidence only.
 *
 * COMPLIANCE: never uses "recommendation", "buy", "sell", "target price".
 */

import type { CanonicalOpportunity, OpportunitySortOptions } from "../../shared/opportunity-intelligence-types";
import type {
  ResearchMode,
  ContextScope,
  ResearchContext,
  ResearchContextType,
  EvidencePanel,
  EvidenceItem,
  FollowUpAction,
  ResearchDiagnostics,
  WorkspaceAIResponse,
} from "../../shared/research-workspace-types";
import { CONTEXT_SCOPE_LABELS, SYSTEM_SCOPE_KEYS } from "../../shared/research-workspace-types";
import { getOpportunityIntelligence, sortOpportunities } from "./opportunity-intelligence-service";
import { listCollections, getCollectionDetail } from "./collection-service";
import {
  getLatestSectorSnapshots,
  getLatestThemeSnapshots,
  getLatestSectorDetail,
  getLatestThemeDetail,
} from "./intelligence-snapshot-store";

// ---------------------------------------------------------------------------
// Assembled research context passed to AI prompt builder
// ---------------------------------------------------------------------------

export interface AssembledContext {
  mode:              ResearchMode;
  scope:             ContextScope;
  scopeLabel:        string;
  opportunities:     CanonicalOpportunity[];
  totalCandidates:   number;
  sectors:           StoredSectorSummary[];
  themes:            StoredThemeSummary[];
  topSectors:        string[];
  topThemes:         string[];
  collectionNames:   string[];
  tickers:           string[];
  /** Ticker-scoped opportunities (subset) */
  tickerOpportunities: CanonicalOpportunity[];
  dataFreshness:     string;
  hasOpportunities:  boolean;
}

interface StoredSectorSummary {
  sector: string;
  score: number;
  label: string;
  generatedAt: string;
  metrics: Record<string, unknown>;
  topSymbols: unknown[];
  changes: Record<string, unknown>;
}

interface StoredThemeSummary {
  themeId: string;
  themeName: string;
  score: number;
  label: string;
  generatedAt: string;
  metrics: Record<string, unknown>;
  topSymbols: unknown[];
  changes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Health metrics (Sprint 2.6.4 extended)
// ---------------------------------------------------------------------------

/** Per-request counters — reset on restart (in-memory only) */
const healthMetrics = {
  contextRequests:     0,
  contextRequestsOk:   0,
  askRequests:         0,
  askRequestsOk:       0,
  fallbackCount:       0,
  partialContextCount: 0,
  totalAIResponseMs:   0,
  aiResponseCount:     0,
};

export function recordContextRequest(ok: boolean): void {
  healthMetrics.contextRequests++;
  if (ok) healthMetrics.contextRequestsOk++;
}

export function recordAskRequest(ok: boolean, usedFallback: boolean, latencyMs?: number): void {
  healthMetrics.askRequests++;
  if (ok) healthMetrics.askRequestsOk++;
  if (usedFallback) healthMetrics.fallbackCount++;
  if (latencyMs !== undefined) {
    healthMetrics.totalAIResponseMs += latencyMs;
    healthMetrics.aiResponseCount++;
  }
}

export function recordPartialContext(): void {
  healthMetrics.partialContextCount++;
}

// ---------------------------------------------------------------------------
// Scope-based opportunity filter (manual — OpportunityFilterOptions has no scope)
// ---------------------------------------------------------------------------

function filterByScopeKey(opps: CanonicalOpportunity[], scope: ContextScope): CanonicalOpportunity[] {
  const THEME_SCOPE_MAP: Partial<Record<ContextScope, string[]>> = {
    "ai-infrastructure": ["AI Infrastructure", "Artificial Intelligence"],
    "semiconductors":    ["Semiconductors", "Chips"],
    "memory":            ["Memory"],
    "networking":        ["Networking"],
    "cybersecurity":     ["Cybersecurity"],
    "cloud":             ["Cloud Computing", "Cloud"],
    "energy":            ["Energy"],
    "healthcare":        ["Healthcare"],
    "financials":        ["Financials", "Finance"],
    "consumer":          ["Consumer", "Consumer Discretionary"],
    "industrials":       ["Industrials"],
  };

  const RISK_SCOPE_MAP: Partial<Record<ContextScope, string>> = {
    "dividend":    "low",
    "income":      "low",
    "value":       "low",
  };

  const TYPE_SCOPE_MAP: Partial<Record<ContextScope, string[]>> = {
    "swing-trading":        ["swing", "vcp", "breakout"],
    "covered-calls":        ["covered_call"],
    "cash-secured-puts":    ["cash_secured_put"],
  };

  // Theme-based filter
  const themeNames = THEME_SCOPE_MAP[scope];
  if (themeNames) {
    return opps.filter(o => o.themes.some(t => themeNames.some(tn => t.toLowerCase().includes(tn.toLowerCase()))));
  }

  // Risk-based filter
  const riskLevel = RISK_SCOPE_MAP[scope];
  if (riskLevel) {
    return opps.filter(o => o.riskLevel === riskLevel);
  }

  // Type-based filter
  const types = TYPE_SCOPE_MAP[scope];
  if (types) {
    return opps.filter(o => types.includes(o.opportunityType));
  }

  // Dynamic scopes
  if (scope === "market-leaders") {
    return opps.slice(0, 20);
  }
  if (scope === "recently-improved") {
    return opps.filter(o => o._sourceCategory === "approaching" || o.researchScore >= 60);
  }
  if (scope === "institutional-activity") {
    return opps.filter(o => o.institutionalScore >= 50).sort((a, b) => b.institutionalScore - a.institutionalScore);
  }
  if (scope === "new-opportunities") {
    return opps.filter(o => o._sourceCategory === "approaching");
  }
  if (scope === "growth") {
    return opps.filter(o => o.opportunityType === "growth" || o.researchScore >= 65);
  }
  if (scope === "momentum") {
    return opps.filter(o => o.technicalScore >= 65);
  }
  if (scope === "etf") {
    return opps.filter(o => o.opportunityType === "etf");
  }
  if (scope === "long-term-investments") {
    return opps.filter(o => o.timeHorizon === "long");
  }

  return opps;
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

const SORT_BY_RESEARCH: OpportunitySortOptions = { field: "researchScore", direction: "desc" };

export async function assembleResearchContext(
  userId: string,
  mode: ResearchMode,
  scope: ContextScope,
  tickers: string[] = [],
): Promise<AssembledContext> {
  const [oppResult, sectors, themes] = await Promise.all([
    getOpportunityIntelligence().catch(() => null),
    getLatestSectorSnapshots().catch(() => [] as StoredSectorSummary[]),
    getLatestThemeSnapshots().catch(() => [] as StoredThemeSummary[]),
  ]);

  const allOpps = oppResult?.opportunities ?? [];
  let contextOpps = [...allOpps];
  const collectionNames: string[] = [];

  // --- Scope filtering ---
  if (scope === "my_collections") {
    const colls = await listCollections(userId, { followedOnly: true }).catch(() => []);
    for (const c of colls) {
      collectionNames.push(c.name);
      const detail = await getCollectionDetail(c.id, userId).catch(() => null);
      if (detail?.symbols && detail.symbols.length > 0) {
        contextOpps = contextOpps.filter(o => detail.symbols.includes(o.symbol));
      }
    }
  } else if (SYSTEM_SCOPE_KEYS.includes(scope)) {
    contextOpps = filterByScopeKey(allOpps, scope);
  }

  // Apply ticker filter (intersection)
  const tickerOpportunities = tickers.length > 0
    ? allOpps.filter(o => tickers.includes(o.symbol))
    : [];

  // Sort by research score
  const sortedOpps = sortOpportunities(contextOpps, SORT_BY_RESEARCH);

  // Build top-N lists
  const topSectors = (sectors as StoredSectorSummary[])
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.sector);

  const topThemes = (themes as StoredThemeSummary[])
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(t => t.themeName);

  const dataFreshness = oppResult?.generatedAt
    ? `Snapshot from ${new Date(oppResult.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false })}`
    : "Freshness unavailable";

  return {
    mode,
    scope,
    scopeLabel:          CONTEXT_SCOPE_LABELS[scope] ?? scope,
    opportunities:       sortedOpps,
    totalCandidates:     sortedOpps.length,
    sectors:             sectors as StoredSectorSummary[],
    themes:              themes as StoredThemeSummary[],
    topSectors,
    topThemes,
    collectionNames,
    tickers,
    tickerOpportunities,
    dataFreshness,
    hasOpportunities:    sortedOpps.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Sprint 2.6.4 — Canonical ResearchContext assembly (for context endpoint)
// ---------------------------------------------------------------------------

export async function assembleCanonicalContext(
  userId: string,
  contextType: ResearchContextType,
  params: {
    symbol?:          string;
    symbols?:         string[];
    themeId?:         string;
    sector?:          string;
    collectionId?:    string;
    portfolioId?:     string;
    watchId?:         string;
    reportId?:        string;
    sourceRoute?:     string;
  },
): Promise<{ context: ResearchContext; limitations: string[] }> {
  const limitations: string[] = [];

  switch (contextType) {
    case "opportunity":
    case "company": {
      const symbol = params.symbol?.toUpperCase() ?? "";
      if (!symbol) limitations.push("No symbol provided");

      const oppResult = await getOpportunityIntelligence().catch(() => null);
      const opp = oppResult?.opportunities.find(o => o.symbol === symbol);
      if (symbol && !opp) {
        limitations.push(`${symbol} is not in the current ranked opportunity list`);
      }

      return {
        context: {
          contextType,
          label:        symbol ? `Researching: ${symbol}${opp?.companyName ? ` (${opp.companyName})` : ""}` : "Company Research",
          symbols:      symbol ? [symbol] : [],
          defaultMode:  contextType === "opportunity" ? "opportunity" : "company",
          defaultScope: "entire_market",
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "comparison": {
      const symbols = (params.symbols ?? (params.symbol ? [params.symbol] : [])).map(s => s.toUpperCase());
      if (symbols.length < 2) limitations.push("Comparison requires at least 2 symbols");
      const oppResult = await getOpportunityIntelligence().catch(() => null);
      const missing = symbols.filter(s => !oppResult?.opportunities.find(o => o.symbol === s));
      if (missing.length > 0) limitations.push(`${missing.join(", ")} not in current ranking`);

      return {
        context: {
          contextType:       "comparison",
          label:             `Comparing: ${symbols.join(" vs ")}`,
          symbols,
          defaultMode:       "comparison",
          defaultScope:      "entire_market",
          comparisonSymbols: symbols,
          sourceRoute:       params.sourceRoute,
        },
        limitations,
      };
    }

    case "theme": {
      const themeId = params.themeId ?? "";
      let themeName = themeId;
      if (themeId) {
        const detail = await getLatestThemeDetail(themeId).catch(() => null);
        if (detail) {
          themeName = detail.themeName;
        } else {
          limitations.push(`Theme "${themeId}" data not available`);
        }
      }

      return {
        context: {
          contextType:  "theme",
          contextId:    themeId,
          label:        themeId ? `Theme: ${themeName}` : "Theme Research",
          symbols:      [],
          defaultMode:  "theme",
          defaultScope: (themeId as ContextScope) in CONTEXT_SCOPE_LABELS ? themeId as ContextScope : "entire_market",
          themeId,
          themeName,
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "sector": {
      const sector = params.sector ?? "";
      if (sector) {
        const sectorDetail = await getLatestSectorDetail(sector).catch(() => null);
        if (!sectorDetail) limitations.push(`Sector "${sector}" data not available`);
      }

      return {
        context: {
          contextType:  "sector",
          label:        sector ? `Sector: ${sector}` : "Sector Research",
          symbols:      [],
          defaultMode:  "sector",
          defaultScope: "entire_market",
          sector,
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "institutional": {
      return {
        context: {
          contextType:  "institutional",
          label:        params.symbol ? `Institutional: ${params.symbol.toUpperCase()}` : "Institutional Research",
          symbols:      params.symbol ? [params.symbol.toUpperCase()] : [],
          defaultMode:  "institutional",
          defaultScope: "institutional-activity",
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "collection": {
      const collectionId = params.collectionId ?? "";
      let collectionName = "Collection";
      if (collectionId) {
        const detail = await getCollectionDetail(collectionId, userId).catch(() => null);
        if (detail) {
          collectionName = detail.name;
        } else {
          limitations.push("Collection not found or inaccessible");
        }
      }

      return {
        context: {
          contextType:   "collection",
          contextId:     collectionId,
          label:         `Collection: ${collectionName}`,
          symbols:       [],
          defaultMode:   "collection",
          defaultScope:  "my_collections",
          collectionId,
          collectionName,
          sourceRoute:   params.sourceRoute,
        },
        limitations,
      };
    }

    case "monitor": {
      const watchId = params.watchId ?? "";
      let watchLabel = "Research Monitor";
      if (watchId) {
        try {
          const { getWatchById } = await import("./research-monitor-service");
          const watch = await getWatchById(watchId, userId).catch(() => null);
          if (watch) {
            watchLabel = (watch as { name: string }).name;
          } else {
            limitations.push("Watch not found or inaccessible");
          }
        } catch {
          limitations.push("Monitor service unavailable");
        }
      }

      return {
        context: {
          contextType:  "monitor",
          contextId:    watchId,
          label:        `Monitor: ${watchLabel}`,
          symbols:      params.symbol ? [params.symbol.toUpperCase()] : [],
          defaultMode:  "company",
          defaultScope: "entire_market",
          watchId,
          watchLabel,
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "report": {
      const reportId = params.reportId ?? "";
      let reportTitle = "Research Report";
      if (reportId) {
        try {
          const { getReport } = await import("./research-report-service");
          const report = await getReport(reportId, userId).catch(() => null);
          if (report) {
            reportTitle = (report as { title: string }).title;
          } else {
            limitations.push("Report not found or inaccessible");
          }
        } catch {
          limitations.push("Report service unavailable");
        }
      }

      return {
        context: {
          contextType:  "report",
          contextId:    reportId,
          label:        `Report: ${reportTitle}`,
          symbols:      [],
          defaultMode:  "opportunity",
          defaultScope: "entire_market",
          reportId,
          reportTitle,
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }

    case "portfolio": {
      const portfolioId = params.portfolioId ?? "";
      let portfolioName = "My Portfolio";
      if (portfolioId) {
        try {
          // Load portfolio name from DB directly
          const { db } = await import("../db");
          const { portfolios } = await import("../../shared/schema");
          const { eq, and } = await import("drizzle-orm");
          const [row] = await db.select({ name: portfolios.name })
            .from(portfolios)
            .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
            .limit(1);
          if (row) {
            portfolioName = row.name;
          } else {
            limitations.push("Portfolio not found or inaccessible");
          }
        } catch {
          limitations.push("Portfolio service unavailable");
        }
      }

      return {
        context: {
          contextType:   "portfolio",
          contextId:     portfolioId,
          label:         `Portfolio: ${portfolioName}`,
          symbols:       [],
          defaultMode:   "company",
          defaultScope:  "entire_market",
          portfolioId,
          portfolioName,
          sourceRoute:   params.sourceRoute,
        },
        limitations,
      };
    }

    case "market":
    default: {
      return {
        context: {
          contextType:  "market",
          label:        "Market Intelligence",
          symbols:      [],
          defaultMode:  "market",
          defaultScope: "entire_market",
          sourceRoute:  params.sourceRoute,
        },
        limitations,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildResearchSystemPrompt(mode: ResearchMode, ctx: AssembledContext): string {
  const base = `You are VCP Trader AI's Research Assistant. You are a deterministic research engine — not an advisor.

CORE RULES:
- You may only explain evidence supplied in the CONTEXT below. Never invent opportunities, scores, prices, or institutional positions.
- You are a research engine, not an advisor. Never suggest or advise entering or exiting any position.
- Preferred terms: "research candidate", "investment candidate", "qualified opportunity", "evidence", "research score". Forbidden terms: any advise-to-act language including transaction verbs or price targets.
- Structure EVERY response as valid JSON matching the WorkspaceAIResponse schema.
- Always populate: headline, answer, keyPoints (3-5), riskNote, confidence, evidencePanel, followUpActions (2-4), referencedTickers.
- If the context has no qualifying candidates, populate the diagnostics field with honest empty-state information.
- In followUpActions, use "relax_filter" (with suggestedScope field) when the user should broaden their search scope.
- Data freshness: ${ctx.dataFreshness}.`;

  const modeRules: Record<ResearchMode, string> = {
    opportunity: `
MODE: Opportunity Research
- Focus on ranked research candidates and the evidence behind their qualification.
- Summarize the strongest candidates by research score. Explain what technical, fundamental, and institutional evidence qualifies each.
- Surface risk factors that could invalidate the thesis for each candidate.`,

    company: `
MODE: Company Research
- Focus on a specific ticker or company's research profile.
- Walk through all available evidence: technical pattern quality, fundamental health, institutional positioning, theme membership, and risk factors.
- Be explicit about what evidence exists vs. what is unavailable.
- When challenging a thesis, surface only evidence from the supplied context — never extrapolate.`,

    theme: `
MODE: Theme Research
- Focus on investment themes and the candidates driving them.
- Leading themes by score: ${ctx.topThemes.slice(0, 3).join(", ") || "unavailable"}.
- Explain theme dynamics: which themes are strengthening vs. weakening, and what candidates are driving each.`,

    sector: `
MODE: Sector Research
- Focus on sector-level intelligence.
- Leading sectors by score: ${ctx.topSectors.slice(0, 3).join(", ") || "unavailable"}.
- Explain which sectors show the strongest evidence and what candidates are driving sector strength.`,

    institutional: `
MODE: Institutional Research
- Focus on 13F institutional positioning signals.
- Explain accumulation patterns, concentration changes, and what institutional positioning implies about a candidate's conviction level.
- Institutional data is derived from SEC 13F filings — it reflects quarter-end positions, not real-time trades.`,

    market: `
MODE: Market Research
- Focus on overall market health, regime signals, and cross-asset context.
- Leading themes: ${ctx.topThemes.slice(0, 3).join(", ") || "unavailable"}.
- Leading sectors: ${ctx.topSectors.slice(0, 3).join(", ") || "unavailable"}.
- Summarize what the current regime means for research candidates.`,

    collection: `
MODE: Collection Research
- Focus on candidates within the selected scope: ${ctx.scopeLabel}.
- Explain what makes this collection's candidates distinctive and what evidence unifies them.
- Surface the strongest candidates in this collection by research score.`,

    comparison: `
MODE: Comparison Research
- Focus on comparing multiple candidates side by side.
- For each candidate: technical score, institutional score, risk level, themes, and key differentiators.
- Never declare a winner — surface evidence for the user to evaluate.
- If one candidate has notably stronger evidence in any dimension, state that clearly with the supporting data.`,
  };

  const responseSchema = `
RESPONSE FORMAT (strict JSON only — no markdown, no prose outside JSON):
{
  "headline": "string (≤120 chars)",
  "answer": "string (200-400 words, narrative explanation using only supplied evidence)",
  "keyPoints": ["string", "string", "string"],
  "riskNote": "string (1-2 sentences about research limitations and uncertainty)",
  "confidence": "low|medium|high",
  "evidencePanel": {
    "summary": "string",
    "supportingEvidence": [{"label":"string","value":"string","strength":"strong|moderate|weak","source":"string"}],
    "technicalEvidence": [{"label":"string","value":"string","strength":"strong|moderate|weak","source":"string"}],
    "fundamentalEvidence": [{"label":"string","value":"string","strength":"strong|moderate|weak","source":"string"}],
    "institutionalEvidence": [{"label":"string","value":"string","strength":"strong|moderate|weak","source":"string"}],
    "riskFactors": ["string"],
    "thesisInvalidators": ["string"],
    "researchSourcesUsed": ["string"]
  },
  "followUpActions": [
    {"label":"string","description":"string","action":{"type":"ask","question":"string","mode":"opportunity","scope":"entire_market"}}
  ],
  "referencedTickers": ["string"],
  "diagnostics": null
}`;

  return `${base}${modeRules[mode]}${responseSchema}`;
}

// ---------------------------------------------------------------------------
// User message builder — serializes context for the AI
// ---------------------------------------------------------------------------

export function buildResearchUserMessage(
  question: string,
  ctx: AssembledContext,
): string {
  const contextSummary: Record<string, unknown> = {
    question,
    researchMode:   ctx.mode,
    contextScope:   ctx.scopeLabel,
    dataFreshness:  ctx.dataFreshness,
  };

  if (ctx.tickers.length > 0) {
    contextSummary.requestedTickers = ctx.tickers;
    contextSummary.tickerData = ctx.tickerOpportunities.map(serializeOpportunity);
  }

  if (ctx.mode === "market" || ctx.mode === "theme") {
    contextSummary.leadingThemes = ctx.topThemes;
    contextSummary.leadingSectors = ctx.topSectors;
    contextSummary.totalRankedCandidates = ctx.totalCandidates;
  } else if (ctx.mode === "sector") {
    contextSummary.leadingSectors = ctx.topSectors;
    contextSummary.totalRankedCandidates = ctx.totalCandidates;
    contextSummary.topCandidatesInScope = ctx.opportunities.slice(0, 10).map(serializeOpportunity);
  } else if (ctx.mode === "institutional") {
    contextSummary.topByInstitutionalScore = ctx.opportunities.slice(0, 10).map(o => ({
      symbol: o.symbol,
      companyName: o.companyName,
      institutionalScore: o.institutionalScore,
      institutionalSignals: [...(o.primaryEvidence ?? []), ...(o.secondaryEvidence ?? [])]
        .filter(e => String(e.type) === "institutional"),
    }));
  } else if (ctx.mode === "comparison") {
    contextSummary.comparisonCandidates = [
      ...ctx.tickerOpportunities.map(serializeOpportunity),
      ...ctx.opportunities.slice(0, 5).filter(o => !ctx.tickers.includes(o.symbol)).map(serializeOpportunity),
    ];
  } else {
    contextSummary.topCandidatesInScope = ctx.opportunities.slice(0, 15).map(serializeOpportunity);
    contextSummary.totalInScope = ctx.totalCandidates;
    if (ctx.collectionNames.length > 0) {
      contextSummary.collectionsSearched = ctx.collectionNames;
    }
  }

  if (!ctx.hasOpportunities || ctx.opportunities.length === 0) {
    contextSummary.diagnostics = {
      universeSearched: `Entire ranked opportunity universe (${ctx.totalCandidates} candidates)`,
      collectionsSearched: ctx.collectionNames,
      filtersApplied: [ctx.scopeLabel !== "Entire Market" ? `Scope: ${ctx.scopeLabel}` : "No scope filter"],
      candidatesEvaluated: ctx.totalCandidates,
      note: "No qualifying candidates found in the current snapshot. Explain what the filters excluded and suggest relaxing scope.",
    };
  }

  return JSON.stringify(contextSummary);
}

function serializeOpportunity(o: CanonicalOpportunity): Record<string, unknown> {
  const allEvidence = [...(o.primaryEvidence ?? []), ...(o.secondaryEvidence ?? [])];
  return {
    symbol:             o.symbol,
    companyName:        o.companyName,
    sector:             o.sector,
    researchScore:      o.researchScore,
    technicalScore:     o.technicalScore,
    institutionalScore: o.institutionalScore,
    riskLevel:          o.riskLevel,
    opportunityType:    o.opportunityType,
    themes:             o.themes,
    evidenceSummary:    allEvidence.slice(0, 4).map(e => ({
      label:    e.label,
      value:    e.detail,
      strength: e.strength,
      category: e.type,
    })),
    riskFactors:        (o.riskFactors ?? []).slice(0, 3).map(r => r.label),
    thesisInvalidators: (o.invalidatesThesis ?? []).slice(0, 2).map(t => t.condition),
    lastUpdated:        o.lastUpdated,
  };
}

// ---------------------------------------------------------------------------
// Fallback rule-based response (when OpenAI unavailable)
// ---------------------------------------------------------------------------

export function buildRuleBasedWorkspaceResponse(
  question: string,
  ctx: AssembledContext,
  mode: ResearchMode,
  scope: ContextScope,
): WorkspaceAIResponse {
  const topOpps = ctx.opportunities.slice(0, 5);
  const hasData  = topOpps.length > 0;

  const headline = hasData
    ? `${ctx.scopeLabel}: ${topOpps.length > 1 ? `${ctx.totalCandidates} research candidates found` : topOpps[0].symbol + " profiled"}`
    : `No qualifying candidates in ${ctx.scopeLabel} right now`;

  const answer = hasData
    ? `The ${ctx.scopeLabel} scope contains ${ctx.totalCandidates} research candidate(s). The top candidates by research score are: ${topOpps.map(o => `${o.symbol} (score: ${o.researchScore})`).join(", ")}. Each has been qualified through deterministic technical, fundamental, and institutional analysis.`
    : `The current snapshot does not contain qualifying research candidates matching the ${ctx.scopeLabel} scope. This may mean no candidates in this scope have cleared all qualification thresholds in the most recent scanner cycle. Try broadening the scope to "Entire Market" or checking back after the next scanner run.`;

  const supportingEvidence: EvidenceItem[] = topOpps.map(o => ({
    label:    o.symbol,
    value:    `Research Score: ${o.researchScore} | Risk: ${o.riskLevel}`,
    strength: o.researchScore >= 70 ? "strong" : o.researchScore >= 50 ? "moderate" : "weak",
    source:   "Opportunity Intelligence Engine",
  }));

  const diagnostics: ResearchDiagnostics | undefined = !hasData ? {
    universeSearched:    `Opportunity Intelligence Engine (${ctx.totalCandidates} total candidates)`,
    collectionsSearched: ctx.collectionNames,
    filtersApplied:      [ctx.scopeLabel !== "Entire Market" ? `Scope: ${ctx.scopeLabel}` : "No scope filter"],
    candidatesEvaluated: ctx.totalCandidates,
    candidatesQualified: 0,
    rejectionReasons:    ["No candidates in current snapshot match this scope's criteria"],
    evidenceStrength:    "insufficient",
    dataFreshness:       ctx.dataFreshness,
  } : undefined;

  const followUpActions: FollowUpAction[] = hasData ? [
    {
      label:       "Explore Top Candidate",
      description: `View the full research profile for ${topOpps[0]?.symbol ?? "the top candidate"}`,
      action:      { type: "navigate", path: `/opportunities/${topOpps[0]?.symbol ?? ""}` },
    },
    {
      label:       "Expand to Entire Market",
      description: "Search across all ranked research candidates",
      action:      { type: "set_scope", scope: "entire_market" },
    },
  ] : [
    {
      label:       "Search Entire Market",
      description: "Broaden scope to all ranked research candidates",
      action:      { type: "relax_filter", filterName: "scope", suggestedScope: "entire_market" },
    },
    {
      label:       "Check Market Leaders",
      description: "View the top-ranked candidates by research score",
      action:      { type: "set_scope", scope: "market-leaders" },
    },
  ];

  return {
    headline,
    answer,
    keyPoints: hasData
      ? [
          `${ctx.totalCandidates} research candidate(s) in ${ctx.scopeLabel}`,
          `Top candidate: ${topOpps[0]?.symbol ?? "N/A"} with research score ${topOpps[0]?.researchScore ?? "N/A"}`,
          `Leading themes: ${ctx.topThemes.slice(0, 2).join(", ") || "Not available"}`,
        ]
      : [
          `No qualifying candidates in ${ctx.scopeLabel}`,
          `Total market candidates: ${ctx.totalCandidates}`,
          "Try broadening the scope or waiting for the next scanner cycle",
        ],
    riskNote: "This is deterministic research data, not investment advice. Qualification does not imply suitability for any particular investor.",
    confidence: hasData ? "medium" : "low",
    evidencePanel: {
      summary:               headline,
      supportingEvidence,
      technicalEvidence:     [],
      fundamentalEvidence:   [],
      institutionalEvidence: [],
      riskFactors:           topOpps.flatMap(o => (o.riskFactors ?? []).slice(0, 1).map(r => r.label)),
      thesisInvalidators:    topOpps.flatMap(o => (o.invalidatesThesis ?? []).slice(0, 1).map(t => t.condition)),
      researchSourcesUsed:   ["Opportunity Intelligence Engine", "Market Intelligence", ctx.dataFreshness],
    },
    followUpActions,
    diagnostics,
    referencedOpportunities: topOpps,
    referencedTickers:       topOpps.map(o => o.symbol),
    researchMode:            mode,
    contextScope:            scope,
    source:                  "rule_based",
    disclaimer:              "This analysis summarizes deterministic research generated from market data and predefined qualification rules. It is not personalized investment advice.",
  };
}

// ---------------------------------------------------------------------------
// Parse AI response into WorkspaceAIResponse
// ---------------------------------------------------------------------------

export function parseAIWorkspaceResponse(
  raw: string,
  mode: ResearchMode,
  scope: ContextScope,
  ctx: AssembledContext,
): WorkspaceAIResponse {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      headline:             String(parsed.headline ?? "Research analysis complete"),
      answer:               String(parsed.answer ?? ""),
      keyPoints:            Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
      riskNote:             String(parsed.riskNote ?? ""),
      confidence:           (["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium") as "low" | "medium" | "high",
      evidencePanel:        parseEvidencePanel(parsed.evidencePanel),
      followUpActions:      parseFollowUpActions(parsed.followUpActions ?? []),
      diagnostics:          parsed.diagnostics ?? undefined,
      referencedOpportunities: ctx.tickerOpportunities.length > 0 ? ctx.tickerOpportunities : ctx.opportunities.slice(0, 5),
      referencedTickers:    Array.isArray(parsed.referencedTickers) ? parsed.referencedTickers.map(String) : ctx.tickers,
      researchMode:         mode,
      contextScope:         scope,
      source:               "openai",
      disclaimer:           "This analysis summarizes deterministic research generated from market data and predefined qualification rules. It is not personalized investment advice.",
    };
  } catch {
    return buildRuleBasedWorkspaceResponse("", ctx, mode, scope);
  }
}

function parseEvidencePanel(raw: unknown): EvidencePanel {
  if (!raw || typeof raw !== "object") {
    return {
      summary: "", supportingEvidence: [], technicalEvidence: [],
      fundamentalEvidence: [], institutionalEvidence: [],
      riskFactors: [], thesisInvalidators: [], researchSourcesUsed: [],
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    summary:               String(r.summary ?? ""),
    supportingEvidence:    parseEvidenceItems(r.supportingEvidence),
    technicalEvidence:     parseEvidenceItems(r.technicalEvidence),
    fundamentalEvidence:   parseEvidenceItems(r.fundamentalEvidence),
    institutionalEvidence: parseEvidenceItems(r.institutionalEvidence),
    riskFactors:           Array.isArray(r.riskFactors) ? r.riskFactors.map(String) : [],
    thesisInvalidators:    Array.isArray(r.thesisInvalidators) ? r.thesisInvalidators.map(String) : [],
    researchSourcesUsed:   Array.isArray(r.researchSourcesUsed) ? r.researchSourcesUsed.map(String) : [],
  };
}

function parseEvidenceItems(raw: unknown): EvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (!item || typeof item !== "object") return null;
    const i = item as Record<string, unknown>;
    return {
      label:    String(i.label ?? ""),
      value:    String(i.value ?? ""),
      strength: (["strong", "moderate", "weak"].includes(i.strength as string) ? i.strength : "moderate") as EvidenceItem["strength"],
      source:   String(i.source ?? ""),
    };
  }).filter((x): x is EvidenceItem => x !== null);
}

function parseFollowUpActions(raw: unknown[]): FollowUpAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map(item => {
    if (!item || typeof item !== "object") return null;
    const i = item as Record<string, unknown>;
    const action = i.action as Record<string, unknown> | undefined;
    let parsedAction: FollowUpAction["action"];
    if (action?.type === "relax_filter") {
      parsedAction = {
        type: "relax_filter",
        filterName: String(action.filterName ?? "scope"),
        suggestedScope: action.suggestedScope as ContextScope | undefined,
      };
    } else {
      parsedAction = (action ?? { type: "ask", question: "" }) as FollowUpAction["action"];
    }
    return {
      label:       String(i.label ?? ""),
      description: String(i.description ?? ""),
      action:      parsedAction,
    };
  }).filter((x): x is FollowUpAction => x !== null && x.label.length > 0);
}

// ---------------------------------------------------------------------------
// Platform health (Sprint 2.6.4 extended)
// ---------------------------------------------------------------------------

export interface WorkspaceHealthSnapshot {
  conversationCount:       number;
  pinnedConversations:     number;
  contextAssemblyOk:       boolean;
  openAiConfigured:        boolean;
  contextRequests:         number;
  contextRequestsOk:       number;
  askRequests:             number;
  askRequestsOk:           number;
  fallbackCount:           number;
  partialContextCount:     number;
  averageAIResponseMs:     number;
}

export async function getWorkspaceHealth(): Promise<WorkspaceHealthSnapshot> {
  try {
    const { db } = await import("../db");
    const { workspaceConversations } = await import("../../shared/schema");
    const drizzle = await import("drizzle-orm");
    const { count, eq } = drizzle;

    const [total, pinned, oppResult] = await Promise.all([
      db.select({ cnt: count() }).from(workspaceConversations),
      db.select({ cnt: count() }).from(workspaceConversations)
        .where(eq(workspaceConversations.isPinned, true)),
      getOpportunityIntelligence().catch(() => null),
    ]);

    const avgMs = healthMetrics.aiResponseCount > 0
      ? Math.round(healthMetrics.totalAIResponseMs / healthMetrics.aiResponseCount)
      : 0;

    return {
      conversationCount:   Number(total[0]?.cnt ?? 0),
      pinnedConversations: Number(pinned[0]?.cnt ?? 0),
      contextAssemblyOk:   oppResult !== null,
      openAiConfigured:    !!process.env.OPENAI_API_KEY,
      contextRequests:     healthMetrics.contextRequests,
      contextRequestsOk:   healthMetrics.contextRequestsOk,
      askRequests:         healthMetrics.askRequests,
      askRequestsOk:       healthMetrics.askRequestsOk,
      fallbackCount:       healthMetrics.fallbackCount,
      partialContextCount: healthMetrics.partialContextCount,
      averageAIResponseMs: avgMs,
    };
  } catch {
    return {
      conversationCount:   0,
      pinnedConversations: 0,
      contextAssemblyOk:   false,
      openAiConfigured:    false,
      contextRequests:     healthMetrics.contextRequests,
      contextRequestsOk:   healthMetrics.contextRequestsOk,
      askRequests:         healthMetrics.askRequests,
      askRequestsOk:       healthMetrics.askRequestsOk,
      fallbackCount:       healthMetrics.fallbackCount,
      partialContextCount: healthMetrics.partialContextCount,
      averageAIResponseMs: 0,
    };
  }
}
