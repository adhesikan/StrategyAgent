/**
 * Research Workspace Service — Sprint 2.5.2
 *
 * Assembles rich research context from:
 *   • Opportunity Intelligence Engine (Sprint 2.5.0)
 *   • Research Collections (Sprint 2.5.1)
 *   • Sector Intelligence snapshots
 *   • Theme Intelligence snapshots
 *   • Market Intelligence briefing
 *
 * Context is assembled deterministically — AI is forbidden from inventing
 * opportunities, scores, or institutional positions. It explains evidence only.
 *
 * COMPLIANCE: never uses "recommendation", "buy", "sell", "target price".
 */

import type { CanonicalOpportunity } from "../../shared/opportunity-intelligence-types";
import type {
  ResearchMode,
  ContextScope,
  EvidencePanel,
  EvidenceItem,
  FollowUpAction,
  ResearchDiagnostics,
  WorkspaceAIResponse,
} from "../../shared/research-workspace-types";
import { CONTEXT_SCOPE_LABELS, SYSTEM_SCOPE_KEYS } from "../../shared/research-workspace-types";
import { getOpportunityIntelligence, filterOpportunities, sortOpportunities } from "./opportunity-intelligence-service";
import { listCollections, getCollectionDetail } from "./collection-service";
import { getLatestSectorSnapshots, getLatestThemeSnapshots } from "./intelligence-snapshot-store";

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
// Context assembly
// ---------------------------------------------------------------------------

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
    // Load all followed/favorited collections for the user
    const colls = await listCollections(userId, { followedOnly: true }).catch(() => []);
    for (const c of colls) {
      collectionNames.push(c.name);
    }
    const followedSymbols = new Set<string>();
    for (const c of colls) {
      const detail = await getCollectionDetail(c.id, userId).catch(() => null);
      if (detail) {
        for (const o of detail.opportunities) followedSymbols.add(o.symbol);
      }
    }
    contextOpps = contextOpps.filter(o => followedSymbols.has(o.symbol));
  } else if (scope !== "entire_market" && scope !== "future_portfolio" && SYSTEM_SCOPE_KEYS.includes(scope as any)) {
    // System collection scope — filter by theme or opportunityType or sector matching scope
    contextOpps = filterByScope(allOpps, scope);
    collectionNames.push(CONTEXT_SCOPE_LABELS[scope] ?? scope);
  }

  // --- Mode-specific sorting ---
  if (mode === "institutional") {
    contextOpps = sortOpportunities(contextOpps, { field: "institutionalScore", direction: "desc" });
  } else if (mode === "market") {
    contextOpps = sortOpportunities(contextOpps, { field: "researchScore", direction: "desc" });
  } else {
    contextOpps = sortOpportunities(contextOpps, { field: "researchScore", direction: "desc" });
  }

  // --- Ticker-scoped subset ---
  const upperTickers = tickers.map(t => t.toUpperCase());
  const tickerOpportunities = upperTickers.length > 0
    ? allOpps.filter(o => upperTickers.includes(o.symbol))
    : [];

  // Top sectors/themes
  const topSectors = [...sectors]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.sector);

  const topThemes = [...themes]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(t => t.themeName);

  // Data freshness
  const newestOpp = contextOpps[0];
  const freshnessDate = newestOpp?.lastUpdated ?? (sectors[0]?.generatedAt ?? "unavailable");
  const dataFreshness = freshnessDate !== "unavailable"
    ? `Last updated: ${new Date(freshnessDate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "Data freshness unavailable";

  return {
    mode,
    scope,
    scopeLabel: CONTEXT_SCOPE_LABELS[scope] ?? scope,
    opportunities: contextOpps.slice(0, 50),   // cap at 50 for prompt size
    totalCandidates: contextOpps.length,
    sectors: sectors as StoredSectorSummary[],
    themes:  themes as StoredThemeSummary[],
    topSectors,
    topThemes,
    collectionNames,
    tickers: upperTickers,
    tickerOpportunities,
    dataFreshness,
    hasOpportunities: contextOpps.length > 0,
  };
}

function filterByScope(opps: CanonicalOpportunity[], scope: ContextScope): CanonicalOpportunity[] {
  const scopeKey = scope as string;

  // Theme-based scopes
  const themeMap: Record<string, string> = {
    "ai-infrastructure": "AI Infrastructure",
    "semiconductors":    "Semiconductors",
    "memory":            "Memory",
    "networking":        "Networking",
    "cybersecurity":     "Cybersecurity",
    "cloud":             "Cloud",
  };
  if (themeMap[scopeKey]) {
    const theme = themeMap[scopeKey];
    return opps.filter(o => o.themes?.includes(theme));
  }

  // Sector-based scopes
  const sectorMap: Record<string, string> = {
    "energy":        "Energy",
    "healthcare":    "Healthcare",
    "financials":    "Financial Services",
    "consumer":      "Consumer Cyclical",
    "industrials":   "Industrials",
  };
  if (sectorMap[scopeKey]) {
    const sector = sectorMap[scopeKey];
    return opps.filter(o => o.sector === sector);
  }

  // opportunityType-based scopes
  const typeMap: Record<string, string[]> = {
    "dividend":               ["dividend"],
    "income":                 ["income_growth", "covered_call_candidate", "cash_secured_put"],
    "growth":                 ["growth"],
    "momentum":               ["momentum", "breakout_candidate", "vcp_setup"],
    "value":                  ["value"],
    "etf":                    ["etf"],
    "long-term-investments":  ["long_term_hold"],
    "swing-trading":          ["swing_trade", "vcp_setup", "breakout_candidate"],
    "covered-calls":          ["covered_call_candidate"],
    "cash-secured-puts":      ["cash_secured_put"],
  };
  if (typeMap[scopeKey]) {
    const types = new Set(typeMap[scopeKey]);
    return opps.filter(o => o.opportunityType && types.has(o.opportunityType));
  }

  // Dynamic / ranking-based scopes
  if (scopeKey === "market-leaders") {
    return sortOpportunities(opps, { field: "researchScore", direction: "desc" }).slice(0, 25);
  }
  if (scopeKey === "recently-improved") {
    return sortOpportunities(opps, { field: "lastUpdated", direction: "desc" }).slice(0, 25);
  }
  if (scopeKey === "institutional-activity") {
    return sortOpportunities(opps, { field: "institutionalScore", direction: "desc" }).slice(0, 25);
  }
  if (scopeKey === "new-opportunities") {
    return sortOpportunities(opps, { field: "lastUpdated", direction: "desc" }).slice(0, 20);
  }

  return opps;
}

// ---------------------------------------------------------------------------
// System prompt builder (mode-specific)
// ---------------------------------------------------------------------------

export function buildResearchSystemPrompt(mode: ResearchMode, ctx: AssembledContext): string {
  const base = `You are VCP Trader AI's Research Assistant. You are a deterministic research engine — not an advisor.

CORE RULES:
- You may only explain evidence supplied in the CONTEXT below. Never invent opportunities, scores, prices, or institutional positions.
- You NEVER recommend buying, selling, or taking any specific position.
- Use language: "research candidate", "investment candidate", "qualified opportunity", "evidence", "research score". NEVER: "recommendation", "buy", "sell", "target price".
- Structure EVERY response as valid JSON matching the WorkspaceAIResponse schema.
- Always populate: headline, answer, keyPoints (3-5), riskNote, confidence, evidencePanel, followUpActions (2-4), referencedTickers.
- If the context has no qualifying candidates, populate the diagnostics field with honest empty-state information.
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
- Be explicit about what evidence exists vs. what is unavailable.`,

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
- Never declare a winner — surface evidence for the user to evaluate.`,
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
      institutionalSignals: o.evidence?.filter(e => e.category === "institutional") ?? [],
    }));
  } else if (ctx.mode === "comparison") {
    // For comparison: show all ticker data + top 5 from scope for context
    contextSummary.comparisonCandidates = [
      ...ctx.tickerOpportunities.map(serializeOpportunity),
      ...ctx.opportunities.slice(0, 5).filter(o => !ctx.tickers.includes(o.symbol)).map(serializeOpportunity),
    ];
  } else {
    // opportunity, company, collection, default
    contextSummary.topCandidatesInScope = ctx.opportunities.slice(0, 15).map(serializeOpportunity);
    contextSummary.totalInScope = ctx.totalCandidates;
    if (ctx.collectionNames.length > 0) {
      contextSummary.collectionsSearched = ctx.collectionNames;
    }
  }

  // Diagnostics when empty
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
    evidenceSummary: (o.evidence ?? []).slice(0, 4).map(e => ({
      label:    e.label,
      value:    e.value,
      strength: e.strength,
      category: e.category,
    })),
    riskFactors:        o.riskFactors?.slice(0, 3) ?? [],
    thesisInvalidators: o.thesisInvalidators?.slice(0, 2) ?? [],
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
      action:      { type: "navigate", path: `/opportunity/${topOpps[0]?.symbol ?? ""}` },
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
      action:      { type: "set_scope", scope: "entire_market" },
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
      riskFactors:           topOpps.flatMap(o => o.riskFactors?.slice(0, 1) ?? []),
      thesisInvalidators:    topOpps.flatMap(o => o.thesisInvalidators?.slice(0, 1) ?? []),
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
    // Strip markdown code fences if present
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
    // Parse failure → return rule-based fallback
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
    return {
      label:       String(i.label ?? ""),
      description: String(i.description ?? ""),
      action:      (i.action ?? { type: "ask", question: "" }) as FollowUpAction["action"],
    };
  }).filter((x): x is FollowUpAction => x !== null && x.label.length > 0);
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export interface WorkspaceHealthSnapshot {
  conversationCount:    number;
  pinnedConversations:  number;
  contextAssemblyOk:   boolean;
  openAiConfigured:     boolean;
}

export async function getWorkspaceHealth(): Promise<WorkspaceHealthSnapshot> {
  try {
    const { db } = await import("../db");
    const { workspaceConversations } = await import("../../shared/schema");
    const { count } = await import("drizzle-orm");

    const [total, pinned, oppResult] = await Promise.all([
      db.select({ cnt: count() }).from(workspaceConversations),
      db.select({ cnt: count() }).from(workspaceConversations)
        .where((await import("drizzle-orm")).eq(workspaceConversations.isPinned, true)),
      getOpportunityIntelligence().catch(() => null),
    ]);

    return {
      conversationCount:   Number(total[0]?.cnt ?? 0),
      pinnedConversations: Number(pinned[0]?.cnt ?? 0),
      contextAssemblyOk:   oppResult !== null,
      openAiConfigured:    !!process.env.OPENAI_API_KEY,
    };
  } catch {
    return {
      conversationCount:   0,
      pinnedConversations: 0,
      contextAssemblyOk:   false,
      openAiConfigured:    false,
    };
  }
}
