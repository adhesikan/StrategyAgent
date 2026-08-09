// Market Research Command Center Routes — Sprint 2.5.3
//
// GET /api/command-center/daily   — aggregated daily snapshot (auth required)
// GET /api/command-center/health  — lightweight health for platform dashboard
//
// Design rules:
//   - Never recomputes anything. Reads only from precomputed stores.
//   - All sub-fetches run in parallel via Promise.all.
//   - Each section degrades independently; a missing section never blocks others.
//   - No secrets, tokens, or connection strings in responses.
//
// Consumes:
//   getLatestRanking()                — Opportunity Ranking Engine
//   getLatestSectorSnapshots()        — Intelligence Snapshot Store
//   getLatestThemeSnapshots()         — Intelligence Snapshot Store
//   buildChangeIntelligenceReport()   — Opportunity Change Engine
//   listCollections()                 — Collection Service
//   workspaceConversations table      — Research Workspace (DB)
//   institutional_symbol_signals      — Institutional Intelligence (DB)

import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { desc, inArray } from "drizzle-orm";
import { getLatestRanking } from "../services/opportunity-ranking-engine";
import {
  getLatestSectorSnapshots,
  getLatestThemeSnapshots,
} from "../services/intelligence-snapshot-store";
import {
  buildChangeIntelligenceReport,
  type SymbolHistoryRow,
} from "../services/opportunity-change-engine";
import { listCollections } from "../services/collection-service";
import { opportunityHistory, workspaceConversations } from "@shared/schema";
import type {
  CommandCenterDailySnapshot,
  CommandCenterHealthSnapshot,
  MarketOverviewSection,
  OpportunityChangesSection,
  ThemeChangesSection,
  SectorChangesSection,
  InstitutionalChangesSection,
  CollectionChangesSection,
  MyCollectionsSection,
  AiResearchSummarySection,
  ResearchTimelineSection,
  ThemeSummaryItem,
  SectorSummaryItem,
  OpportunityChangeItem,
  CollectionChangeSummary,
  RelatedResearchLink,
  ConfidenceLevel,
  MyWatchChangesSection,
  LatestReportSection,
} from "@shared/command-center-types";
import { buildMyWatchChangesSection } from "../services/research-monitor-service";
import { buildLatestReportSection } from "../services/research-report-service";
import type { CollectionSummary } from "@shared/collection-types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z]{1,10}$/;

/** Fetch last 2 history rows per symbol — mirrors the changes-explained route. */
async function fetchBatchHistory(
  symbols: string[],
): Promise<Map<string, SymbolHistoryRow[]>> {
  if (symbols.length === 0) return new Map();
  const upper = symbols.map(s => s.toUpperCase()).filter(s => SYMBOL_RE.test(s));
  if (upper.length === 0) return new Map();

  const rows = await db
    .select()
    .from(opportunityHistory)
    .where(inArray(opportunityHistory.symbol, upper))
    .orderBy(desc(opportunityHistory.scanTime))
    .limit(upper.length * 3);

  const map = new Map<string, SymbolHistoryRow[]>();
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    if (!map.has(sym)) map.set(sym, []);
    const bucket = map.get(sym)!;
    if (bucket.length < 2) {
      bucket.push({
        symbol: sym,
        score: parseFloat(String(r.score ?? "0")),
        rank: r.rank,
        qualificationStatus: r.qualificationStatus,
        lifecycleState: r.lifecycleState,
        strategy: r.strategy,
        marketRegime: r.marketRegime,
        scanTime: r.scanTime.toISOString(),
      });
    }
  }
  return map;
}

/** Find symbols in last 48h that are no longer in the current ranking. */
async function fetchRecentlyRemovedSymbols(
  currentSymbols: Set<string>,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await db
    .select({ symbol: opportunityHistory.symbol })
    .from(opportunityHistory)
    .where(
      sql`${opportunityHistory.qualificationStatus} = 'QUALIFIED'
       AND ${opportunityHistory.scanTime} >= ${cutoff.toISOString()}`,
    )
    .orderBy(desc(opportunityHistory.scanTime));

  const seen = new Set<string>();
  const removed: string[] = [];
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    if (!currentSymbols.has(sym) && !seen.has(sym)) {
      seen.add(sym);
      removed.push(sym);
    }
  }
  return removed.slice(0, 20);
}

function relatedLinks(paths: Array<{ label: string; path: string }>): RelatedResearchLink[] {
  return paths;
}

function marketHealthLabel(health: number | null): "Strong" | "Moderate" | "Weak" | "Unknown" {
  if (health == null) return "Unknown";
  if (health >= 70) return "Strong";
  if (health >= 45) return "Moderate";
  return "Weak";
}

function directionOf(delta: number | null): "up" | "down" | "stable" {
  if (delta == null) return "stable";
  if (delta >= 3)  return "up";
  if (delta <= -3) return "down";
  return "stable";
}

function scoreToHealth(sectors: any[], themes: any[]): number | null {
  const sScores = sectors.slice(0, 5).map((s: any) => s.score).filter(Boolean) as number[];
  const tScores = themes.slice(0, 5).map((t: any) => t.score).filter(Boolean) as number[];
  if (sScores.length === 0 && tScores.length === 0) return null;
  const combined = [...sScores, ...tScores];
  return Math.round(combined.reduce((a, b) => a + b, 0) / combined.length);
}

function toThemeSummary(t: any): ThemeSummaryItem {
  const delta = (t.changes as Record<string, unknown>)?.scoreDelta as number | null ?? null;
  const tops = ((t.topSymbols as Array<{ symbol: string }>) ?? []).map((x: { symbol: string }) => x.symbol).slice(0, 4);
  return {
    themeId:    t.themeId,
    themeName:  t.themeName,
    score:      t.score ?? 0,
    direction:  directionOf(delta),
    scoreDelta: delta,
    topSymbols: tops,
    relatedResearch: relatedLinks([
      { label: `${t.themeName} Research`, path: `/intelligence/themes/${t.themeId}` },
      { label: "AI Workspace", path: `/research-workspace?scope=${t.themeId}` },
    ]),
  };
}

function toSectorSummary(s: any): SectorSummaryItem {
  const delta = (s.changes as Record<string, unknown>)?.scoreDelta as number | null ?? null;
  const tops  = ((s.topSymbols as Array<{ symbol: string }>) ?? []).map((x: { symbol: string }) => x.symbol).slice(0, 4);
  const sectorSlug = encodeURIComponent(s.sector ?? "");
  return {
    sector:     s.sector ?? "Unknown",
    label:      s.label  ?? s.sector ?? "Unknown",
    score:      s.score  ?? 0,
    direction:  directionOf(delta),
    scoreDelta: delta,
    topSymbols: tops,
    relatedResearch: relatedLinks([
      { label: `${s.label ?? s.sector} Sector`, path: `/intelligence/sectors/${sectorSlug}` },
      { label: "AI Workspace", path: `/research-workspace?scope=${s.sector?.toLowerCase()}` },
    ]),
  };
}

function toCollectionSummary(c: CollectionSummary): CollectionChangeSummary {
  return {
    id:             c.id,
    name:           c.name,
    collectionType: c.collectionType,
    systemKey:      c.systemKey,
    opportunityCount: c.opportunityCount,
    topOpportunities: [],   // populated by collection detail when needed; kept lightweight here
    isFollowing: c.isFollowing,
    isFavorite:  c.isFavorite,
    isPinned:    c.isPinned,
    relatedResearch: relatedLinks([
      { label: c.name, path: `/research?collection=${c.id}` },
      { label: "AI Workspace", path: `/research-workspace?scope=my_collections` },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Section builders (all pure / error-isolated)
// ---------------------------------------------------------------------------

function buildMarketOverview(
  sectors: any[],
  themes: any[],
  regime: string | null,
  freshness: string | null,
): MarketOverviewSection {
  const sortedSectors = [...sectors].sort((a, b) => b.score - a.score);
  const sortedThemes  = [...themes].sort((a, b) => b.score - a.score);
  const health        = scoreToHealth(sortedSectors, sortedThemes);
  const label         = marketHealthLabel(health);

  const leadingThemes   = sortedThemes.slice(0, 5).map(toThemeSummary);
  const leadingSectors  = sortedSectors.slice(0, 5).map(toSectorSummary);
  const mostImprovedThemes = sortedThemes
    .filter(t => ((t.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) >= 3)
    .sort((a, b) =>
      ((b.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) -
      ((a.changes as Record<string, unknown>)?.scoreDelta as number ?? 0))
    .slice(0, 3)
    .map(toThemeSummary);
  const weakeningThemes = sortedThemes
    .filter(t => ((t.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) <= -3)
    .sort((a, b) =>
      ((a.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) -
      ((b.changes as Record<string, unknown>)?.scoreDelta as number ?? 0))
    .slice(0, 3)
    .map(toThemeSummary);

  const hasData = sectors.length > 0 || themes.length > 0;

  const whatsNew: string[] = [];
  if (mostImprovedThemes.length > 0) {
    whatsNew.push(`${mostImprovedThemes[0].themeName} momentum building (+${mostImprovedThemes[0].scoreDelta?.toFixed(1)} pts)`);
  }
  if (regime) whatsNew.push(`Market regime: ${regime}`);

  const whatsChanged: string[] = [];
  if (weakeningThemes.length > 0) {
    whatsChanged.push(`${weakeningThemes[0].themeName} showing weakness (${weakeningThemes[0].scoreDelta?.toFixed(1)} pts)`);
  }
  if (leadingSectors.length > 0) {
    whatsChanged.push(`${leadingSectors[0].label} leads sector rankings (score ${leadingSectors[0].score})`);
  }

  const evidence: string[] = [
    sectors.length > 0 ? `${sectors.length} sector snapshots analyzed` : null,
    themes.length  > 0 ? `${themes.length} theme snapshots analyzed`  : null,
    regime         ? `Regime signal: ${regime}`                         : null,
  ].filter(Boolean) as string[];

  const confidence: ConfidenceLevel = {
    level: hasData ? (health != null && health > 50 ? "high" : "medium") : "low",
    basis: hasData
      ? `${sectors.length} sectors and ${themes.length} themes in snapshot`
      : "Insufficient precomputed data",
  };

  return {
    regime,
    marketHealth: health,
    marketHealthLabel: label,
    leadingThemes,
    leadingSectors,
    mostImprovedThemes,
    weakeningThemes,
    whatsNew,
    whatsChanged,
    evidence,
    confidence,
    freshness,
    hasData,
    relatedResearch: relatedLinks([
      { label: "Intelligence Hub",  path: "/intelligence" },
      { label: "AI Workspace",      path: "/research-workspace?mode=market" },
      { label: "Research Hub",      path: "/research" },
    ]),
  };
}

async function buildOpportunityChanges(freshness: string | null): Promise<OpportunityChangesSection> {
  const NONE: OpportunityChangesSection = {
    available: false,
    majorMovers: [], upgrades: [], downgrades: [], newEntries: [], removed: [],
    totalChanged: 0,
    whatsNew: [], whatsChanged: [], evidence: [],
    confidence: { level: "low", basis: "Ranking not yet available" },
    freshness,
    relatedResearch: relatedLinks([
      { label: "Opportunity Workspace", path: "/opportunities" },
      { label: "AI Workspace", path: "/research-workspace?mode=opportunity" },
    ]),
  };

  const ranking = getLatestRanking();
  if (!ranking) return NONE;

  try {
    const currentSymbols = new Set<string>();
    for (const c of [
      ...ranking.topGrowth, ...ranking.topIncome,
      ...ranking.watchlist, ...ranking.approaching,
    ]) {
      currentSymbols.add(c.symbol.toUpperCase());
    }

    const [historyMap, removedSymbols] = await Promise.all([
      fetchBatchHistory(Array.from(currentSymbols)),
      fetchRecentlyRemovedSymbols(currentSymbols),
    ]);

    if (removedSymbols.length > 0) {
      const removedHistory = await fetchBatchHistory(removedSymbols);
      for (const [sym, rows] of Array.from(removedHistory.entries())) {
        if (!historyMap.has(sym)) historyMap.set(sym, rows);
      }
    }

    const report = buildChangeIntelligenceReport(
      Array.from(currentSymbols),
      historyMap,
      removedSymbols,
    );

    const toItem = (exp: any, changeType: OpportunityChangeItem["changeType"]): OpportunityChangeItem => ({
      symbol:        exp.symbol,
      companyName:   null,
      previousScore: exp.previousScore ?? null,
      currentScore:  exp.currentScore  ?? null,
      scoreDelta:    exp.previousScore != null && exp.currentScore != null
        ? exp.currentScore - exp.previousScore
        : null,
      changeType,
      importance:    exp.importance ?? "Minor",
      explanation:   exp.summary ?? "",
      drivers:       exp.drivers  ?? [],
      warnings:      exp.warnings ?? [],
      previousState: exp.previousState ?? null,
      currentState:  exp.currentState  ?? null,
      relatedResearch: relatedLinks([
        { label: `${exp.symbol} Research`, path: `/opportunities/${exp.symbol}` },
        { label: "AI Workspace",           path: `/research-workspace?mode=company&tickers=${exp.symbol}` },
      ]),
    });

    const majorMovers = report.majorMovers.map(e => toItem(e, "major_mover"));
    const upgrades    = report.upgrades.map(e    => toItem(e, "upgrade"));
    const downgrades  = report.downgrades.map(e  => toItem(e, "downgrade"));
    const newEntries  = report.newEntries.map(e  => toItem(e, "new"));
    const removed     = report.removed.map(e     => toItem(e, "removed"));

    const totalChanged = majorMovers.length + upgrades.length + downgrades.length + newEntries.length + removed.length;

    const whatsNew: string[] = [];
    if (newEntries.length > 0) whatsNew.push(`${newEntries.length} new candidate(s) entered the ranking`);
    if (upgrades.length  > 0) whatsNew.push(`${upgrades.length} candidate(s) scored higher vs previous scan`);

    const whatsChanged: string[] = [];
    if (majorMovers.length > 0) whatsChanged.push(`${majorMovers.length} major move(s) detected — review drivers`);
    if (downgrades.length  > 0) whatsChanged.push(`${downgrades.length} candidate(s) scored lower vs previous scan`);
    if (removed.length     > 0) whatsChanged.push(`${removed.length} symbol(s) left the qualified set`);

    const evidence: string[] = [
      `${currentSymbols.size} symbols in current ranking`,
      `Change analysis covers last 48-hour window`,
      `${totalChanged} total changes detected`,
    ];

    const confidence: ConfidenceLevel = {
      level: totalChanged > 0 ? "high" : "medium",
      basis: `${currentSymbols.size} ranked symbols, ${totalChanged} changes detected`,
    };

    return {
      available: true,
      majorMovers, upgrades, downgrades, newEntries, removed,
      totalChanged, whatsNew, whatsChanged, evidence, confidence,
      freshness,
      relatedResearch: relatedLinks([
        { label: "Opportunity Workspace", path: "/opportunities" },
        { label: "AI Workspace",          path: "/research-workspace?mode=opportunity" },
        { label: "Research Hub",          path: "/research" },
      ]),
    };
  } catch (err) {
    console.error("[command-center] opportunity changes failed:", (err as any)?.message);
    return NONE;
  }
}

function buildThemeChanges(themes: any[], freshness: string | null): ThemeChangesSection {
  const sorted = [...themes].sort((a, b) => b.score - a.score);
  const items  = sorted.map(toThemeSummary);

  const improving = items.filter(t => t.scoreDelta != null && t.scoreDelta >= 3);
  const weakening = items.filter(t => t.scoreDelta != null && t.scoreDelta <= -3);

  const whatsNew: string[] = improving.slice(0, 2).map(t =>
    `${t.themeName} improved by ${t.scoreDelta?.toFixed(1)} pts`);
  const whatsChanged: string[] = weakening.slice(0, 2).map(t =>
    `${t.themeName} weakened by ${Math.abs(t.scoreDelta!).toFixed(1)} pts`);

  const evidence: string[] = [
    `${themes.length} theme snapshots in analysis`,
    improving.length > 0 ? `${improving.length} improving theme(s)` : null,
    weakening.length > 0 ? `${weakening.length} weakening theme(s)` : null,
  ].filter(Boolean) as string[];

  return {
    themes: items,
    whatsNew,
    whatsChanged,
    evidence,
    confidence: {
      level: themes.length >= 5 ? "high" : themes.length > 0 ? "medium" : "low",
      basis: `${themes.length} theme snapshots`,
    },
    freshness,
    hasData: themes.length > 0,
    relatedResearch: relatedLinks([
      { label: "Intelligence Hub", path: "/intelligence" },
      { label: "AI Workspace",     path: "/research-workspace?mode=theme" },
    ]),
  };
}

function buildSectorChanges(sectors: any[], freshness: string | null): SectorChangesSection {
  const sorted = [...sectors].sort((a, b) => b.score - a.score);
  const items  = sorted.map(toSectorSummary);

  const improving = items.filter(s => s.scoreDelta != null && s.scoreDelta >= 3);
  const weakening = items.filter(s => s.scoreDelta != null && s.scoreDelta <= -3);

  const whatsNew: string[] = improving.slice(0, 2).map(s =>
    `${s.label} gained ${s.scoreDelta?.toFixed(1)} pts`);
  const whatsChanged: string[] = weakening.slice(0, 2).map(s =>
    `${s.label} lost ${Math.abs(s.scoreDelta!).toFixed(1)} pts`);

  if (items.length > 0 && whatsNew.length === 0) {
    whatsNew.push(`${items[0].label} leads all sectors (score ${items[0].score})`);
  }

  const evidence: string[] = [
    `${sectors.length} sector snapshots`,
    improving.length > 0 ? `${improving.length} improving sector(s)` : null,
    weakening.length > 0 ? `${weakening.length} weakening sector(s)` : null,
  ].filter(Boolean) as string[];

  return {
    sectors: items,
    whatsNew,
    whatsChanged,
    evidence,
    confidence: {
      level: sectors.length >= 3 ? "high" : sectors.length > 0 ? "medium" : "low",
      basis: `${sectors.length} sector snapshots`,
    },
    freshness,
    hasData: sectors.length > 0,
    relatedResearch: relatedLinks([
      { label: "Intelligence Hub", path: "/intelligence" },
      { label: "AI Workspace",     path: "/research-workspace?mode=sector" },
    ]),
  };
}

async function buildInstitutionalChanges(freshness: string | null): Promise<InstitutionalChangesSection> {
  const NONE: InstitutionalChangesSection = {
    available: false,
    recentSignals: [], whatsNew: [], whatsChanged: [], evidence: [],
    confidence: { level: "low", basis: "Institutional data not available" },
    freshness,
    relatedResearch: relatedLinks([
      { label: "Institutional Funds", path: "/institutional/funds" },
      { label: "AI Workspace",        path: "/research-workspace?mode=institutional" },
    ]),
  };

  const enabled = process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED !== "false";
  if (!enabled) return NONE;

  try {
    const rows = await db.execute<{
      symbol: string;
      signal_type: string;
      signal_strength: string | null;
      signal_detail: string | null;
      calculated_at: string | null;
    }>(sql`
      SELECT symbol, signal_type, signal_strength, signal_detail, calculated_at::text
      FROM institutional_symbol_signals
      ORDER BY calculated_at DESC NULLS LAST
      LIMIT 15
    `);

    if (rows.rows.length === 0) return NONE;

    const signals = rows.rows.map(r => ({
      symbol:       r.symbol,
      companyName:  null,
      signalType:   r.signal_type ?? "unknown",
      magnitude:    (r.signal_strength === "strong" ? "high" :
                     r.signal_strength === "moderate" ? "medium" : "low") as "high" | "medium" | "low",
      detail:       r.signal_detail ?? "Institutional positioning signal detected",
      calculatedAt: r.calculated_at ?? null,
      relatedResearch: relatedLinks([
        { label: `${r.symbol} Research`, path: `/opportunities/${r.symbol}` },
        { label: "Institutional Funds",  path: "/institutional/funds" },
      ]),
    }));

    const highMag = signals.filter(s => s.magnitude === "high");
    const whatsNew: string[] = highMag.slice(0, 2).map(s =>
      `${s.symbol}: ${s.signalType} — ${s.detail.slice(0, 80)}`);
    const whatsChanged: string[] = signals.length > highMag.length
      ? [`${signals.length - highMag.length} additional moderate/low signals detected`]
      : [];

    const evidence: string[] = [
      `${signals.length} institutional signals in view`,
      highMag.length > 0 ? `${highMag.length} high-magnitude signal(s)` : null,
    ].filter(Boolean) as string[];

    return {
      available: true,
      recentSignals: signals,
      whatsNew,
      whatsChanged,
      evidence,
      confidence: {
        level: signals.length >= 5 ? "high" : signals.length > 0 ? "medium" : "low",
        basis: `${signals.length} institutional signals`,
      },
      freshness,
      relatedResearch: relatedLinks([
        { label: "Institutional Funds", path: "/institutional/funds" },
        { label: "AI Workspace",        path: "/research-workspace?mode=institutional" },
      ]),
    };
  } catch (err) {
    console.error("[command-center] institutional failed:", (err as any)?.message);
    return NONE;
  }
}

async function buildCollectionSections(
  userId: string,
  freshness: string | null,
): Promise<{ collectionChanges: CollectionChangesSection; myCollections: MyCollectionsSection }> {
  const EMPTY_CHANGES: CollectionChangesSection = {
    collections: [], whatsNew: [], whatsChanged: [], evidence: [],
    confidence: { level: "low", basis: "No collection data" },
    freshness,
    relatedResearch: relatedLinks([{ label: "Research Hub", path: "/research" }]),
  };
  const EMPTY_MY: MyCollectionsSection = {
    pinned: [], favorites: [], followed: [], systemHighlights: [], total: 0,
    relatedResearch: relatedLinks([{ label: "Research Hub", path: "/research" }]),
  };

  try {
    const [allCollections, userCollections] = await Promise.all([
      listCollections(undefined, { collectionType: "system", excludeArchived: true }),
      listCollections(userId,    { excludeArchived: true }),
    ]);

    const topSystem  = allCollections
      .sort((a, b) => b.opportunityCount - a.opportunityCount)
      .slice(0, 10)
      .map(toCollectionSummary);

    const withOpps = topSystem.filter(c => c.opportunityCount > 0);
    const whatsNew: string[] = withOpps.slice(0, 2).map(c =>
      `${c.name}: ${c.opportunityCount} research candidate(s)`);
    const whatsChanged: string[] = [];
    if (topSystem.length > 0) {
      whatsChanged.push(`${topSystem.length} system collections active`);
    }

    const evidence: string[] = [
      `${allCollections.length} system collection(s)`,
      `${userCollections.length} user collection(s)`,
      `${withOpps.length} collection(s) with active candidates`,
    ];

    const collectionChanges: CollectionChangesSection = {
      collections: topSystem,
      whatsNew, whatsChanged, evidence,
      confidence: {
        level: allCollections.length >= 25 ? "high" : "medium",
        basis: `${allCollections.length} system collections seeded`,
      },
      freshness,
      relatedResearch: relatedLinks([
        { label: "Research Hub",    path: "/research" },
        { label: "AI Workspace",    path: "/research-workspace?scope=my_collections" },
      ]),
    };

    const pinned    = userCollections.filter(c => c.isPinned).map(toCollectionSummary);
    const favorites = userCollections.filter(c => c.isFavorite && !c.isPinned).map(toCollectionSummary);
    const followed  = userCollections.filter(c => c.isFollowing && !c.isFavorite && !c.isPinned).map(toCollectionSummary);
    const systemHighlights = allCollections
      .sort((a, b) => b.opportunityCount - a.opportunityCount)
      .slice(0, 5)
      .map(toCollectionSummary);

    const myCollections: MyCollectionsSection = {
      pinned, favorites, followed, systemHighlights,
      total: userCollections.length + allCollections.length,
      relatedResearch: relatedLinks([
        { label: "Research Hub", path: "/research" },
        { label: "AI Workspace", path: "/research-workspace?scope=my_collections" },
      ]),
    };

    return { collectionChanges, myCollections };
  } catch (err) {
    console.error("[command-center] collections failed:", (err as any)?.message);
    return { collectionChanges: EMPTY_CHANGES, myCollections: EMPTY_MY };
  }
}

async function buildAiResearchSummary(userId: string): Promise<AiResearchSummarySection> {
  const NONE: AiResearchSummarySection = {
    available: false,
    recentConversationCount: 0,
    pinnedConversationCount: 0,
    topModes: [],
    suggestedQueries: [
      {
        label: "What changed today?",
        description: "Market-wide intelligence summary",
        mode: "market",
        scope: "entire_market",
        promptText: "Summarize today's market intelligence. What are the key changes, leading themes, and areas of strength or concern?",
      },
      {
        label: "Strongest AI Infrastructure Candidates",
        description: "Top ranked in AI Infrastructure theme",
        mode: "collection",
        scope: "ai-infrastructure",
        promptText: "Which AI Infrastructure candidates have the strongest evidence today? Walk through technical signals and institutional positioning.",
      },
      {
        label: "Explain Institutional Activity",
        description: "What are institutions accumulating or distributing?",
        mode: "institutional",
        scope: "entire_market",
        promptText: "Explain recent institutional positioning signals. Which symbols show the most significant 13F evidence of accumulation or distribution?",
      },
    ],
    whatsNew: ["Research Workspace available for deep AI-assisted analysis"],
    evidence: [],
    confidence: { level: "low", basis: "No conversation history yet" },
    relatedResearch: relatedLinks([
      { label: "Research Workspace", path: "/research-workspace" },
      { label: "Research Hub",       path: "/research" },
    ]),
  };

  try {
    const rows = await db
      .select()
      .from(workspaceConversations)
      .where(sql`${workspaceConversations.userId} = ${userId}`)
      .orderBy(desc(workspaceConversations.lastMessageAt))
      .limit(20);

    const total  = rows.length;
    const pinned = rows.filter(r => r.isPinned).length;

    // Compute top modes
    const modeCounts: Record<string, number> = {};
    for (const r of rows) {
      const m = r.researchMode ?? "market";
      modeCounts[m] = (modeCounts[m] ?? 0) + 1;
    }
    const topModes = Object.entries(modeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([m]) => m);

    const whatsNew: string[] = [];
    if (total > 0) {
      whatsNew.push(`${total} saved research conversation(s) in your history`);
    }
    if (pinned > 0) {
      whatsNew.push(`${pinned} pinned conversation(s) saved for reference`);
    }

    const evidence: string[] = [
      `${total} total conversations`,
      topModes.length > 0 ? `Most used modes: ${topModes.join(", ")}` : null,
    ].filter(Boolean) as string[];

    return {
      available: true,
      recentConversationCount: total,
      pinnedConversationCount: pinned,
      topModes,
      suggestedQueries: NONE.suggestedQueries,
      whatsNew,
      evidence,
      confidence: {
        level: total > 5 ? "high" : total > 0 ? "medium" : "low",
        basis: `${total} conversations, ${pinned} pinned`,
      },
      relatedResearch: relatedLinks([
        { label: "Research Workspace", path: "/research-workspace" },
        { label: "Research Hub",       path: "/research" },
      ]),
    };
  } catch (err) {
    console.error("[command-center] ai-research-summary failed:", (err as any)?.message);
    return NONE;
  }
}

async function buildResearchTimeline(userId: string): Promise<ResearchTimelineSection> {
  const NONE: ResearchTimelineSection = {
    items: [], totalConversations: 0, available: false,
    relatedResearch: relatedLinks([{ label: "Research Workspace", path: "/research-workspace" }]),
  };

  try {
    const rows = await db
      .select()
      .from(workspaceConversations)
      .where(sql`${workspaceConversations.userId} = ${userId}`)
      .orderBy(desc(workspaceConversations.lastMessageAt))
      .limit(10);

    if (rows.length === 0) return NONE;

    const items = rows.map(r => ({
      id:            r.id,
      title:         r.title ?? "Untitled Conversation",
      researchMode:  r.researchMode ?? "market",
      contextScope:  r.contextScope ?? "entire_market",
      lastMessageAt: r.lastMessageAt?.toISOString() ?? r.createdAt?.toISOString() ?? new Date().toISOString(),
      isPinned:      r.isPinned ?? false,
      relatedResearch: relatedLinks([
        { label: "Continue Research", path: `/research-workspace?conversation=${r.id}` },
      ]),
    }));

    return {
      items,
      totalConversations: rows.length,
      available: true,
      relatedResearch: relatedLinks([
        { label: "Research Workspace", path: "/research-workspace" },
        { label: "Research Hub",       path: "/research" },
      ]),
    };
  } catch (err) {
    console.error("[command-center] timeline failed:", (err as any)?.message);
    return NONE;
  }
}

// ---------------------------------------------------------------------------
// In-memory health tracking (lightweight)
// ---------------------------------------------------------------------------

let _lastSnapshot: CommandCenterDailySnapshot | null = null;
let _lastSnapshotAt: string | null = null;

export function getCommandCenterHealth(): CommandCenterHealthSnapshot {
  return {
    lastGeneratedAt:             _lastSnapshotAt,
    sectionsAvailable:           _lastSnapshot ? countAvailableSections(_lastSnapshot) : 0,
    opportunityChangesAvailable: _lastSnapshot?.opportunityChanges.available ?? false,
    themeDataAvailable:          _lastSnapshot?.themeChanges.hasData ?? false,
    sectorDataAvailable:         _lastSnapshot?.sectorChanges.hasData ?? false,
    collectionsSeeded:           (_lastSnapshot?.collectionChanges.collections.length ?? 0) > 0,
    institutionalDataAvailable:  _lastSnapshot?.institutionalChanges.available ?? false,
  };
}

function countAvailableSections(snap: CommandCenterDailySnapshot): number {
  let count = 0;
  if (snap.marketOverview.hasData)               count++;
  if (snap.opportunityChanges.available)          count++;
  if (snap.themeChanges.hasData)                  count++;
  if (snap.sectorChanges.hasData)                 count++;
  if (snap.institutionalChanges.available)         count++;
  if (snap.collectionChanges.collections.length > 0) count++;
  if (snap.myCollections.total > 0)               count++;
  if (snap.aiResearchSummary.available)           count++;
  if (snap.researchTimeline.available)            count++;
  return count;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerCommandCenterRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/command-center/daily ─────────────────────────────────────────
  app.get("/api/command-center/daily", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session?.userId as string | undefined;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      // Parallel: sector + theme snapshots + ranking (sync) + opportunity changes
      const [sectors, themes] = await Promise.all([
        getLatestSectorSnapshots().catch(() => [] as any[]),
        getLatestThemeSnapshots().catch(() => [] as any[]),
      ]);

      const ranking   = getLatestRanking();
      const regime    = ranking?.regime ?? null;
      const freshness = ranking?.generatedAt ?? null;

      // All section builders in parallel
      const [
        opportunityChanges,
        institutionalChanges,
        collectionSections,
        aiResearchSummary,
        researchTimeline,
        myWatchChanges,
        latestReport,
      ] = await Promise.all([
        buildOpportunityChanges(freshness),
        buildInstitutionalChanges(freshness),
        buildCollectionSections(userId, freshness),
        buildAiResearchSummary(userId),
        buildResearchTimeline(userId),
        buildMyWatchChangesSection(userId).catch((): MyWatchChangesSection => ({
          available: false, watchCount: 0, activeWatchCount: 0,
          recentChanges: [], lastEvaluatedAt: null, feedSummary: null,
        })),
        buildLatestReportSection(userId).catch((): LatestReportSection => ({
          available: false, latestReport: null, recentReports: [],
          reportsToday: 0, lastGeneratedAt: null,
          generateShortcut: "/research-reports", viewAllShortcut: "/research-reports",
        })),
      ]);

      const marketOverview = buildMarketOverview(sectors, themes, regime, freshness);
      const themeChanges   = buildThemeChanges(themes, freshness);
      const sectorChanges  = buildSectorChanges(sectors, freshness);

      const snapshot: CommandCenterDailySnapshot = {
        generatedAt: new Date().toISOString(),
        marketOverview,
        opportunityChanges,
        themeChanges,
        sectorChanges,
        institutionalChanges,
        collectionChanges: collectionSections.collectionChanges,
        myCollections:     collectionSections.myCollections,
        aiResearchSummary,
        researchTimeline,
        myWatchChanges,
        latestReport,
      };

      // Update health state
      _lastSnapshot   = snapshot;
      _lastSnapshotAt = snapshot.generatedAt;

      res.json(snapshot);
    } catch (err: any) {
      console.error("[command-center] daily snapshot failed:", err?.message);
      res.status(500).json({ error: "Command center snapshot failed" });
    }
  });

  // ── GET /api/command-center/health ────────────────────────────────────────
  // Lightweight — no DB reads. Reads from in-memory state.
  app.get("/api/command-center/health", isAuthenticated, (_req: Request, res: Response) => {
    res.json(getCommandCenterHealth());
  });
}
