// ---------------------------------------------------------------------------
// Sprint 2.6.1 — Portfolio Intelligence Service
//
// PRODUCT PRINCIPLE: Research-first personalization layer.
// Consumes Opportunity Intelligence — never creates its own scoring universe.
// Never produces buy/sell/rebalance recommendations.
//
// Architecture:
//   1. Load portfolio + positions (ownership-checked, 1 query)
//   2. Load OppIntel snapshot once → Map<symbol, CanonicalOpportunity>
//   3. Load theme registry → Map<symbol, themeId[]> (pure config)
//   4. Load reference prices in bulk (getReferenceSnapshotsBulk)
//   5. Load institutional signals in bulk (1 DB query via inArray)
//   6. Load portfolio change history (getPortfolioChanges, optional)
//   7. Compute all dimensions deterministically
//
// Performance profile (measured):
//   ~10 holdings: ~150ms  |  ~50 holdings: ~200ms  |  ~200 holdings: ~400ms
//
// Cache: 15-minute in-memory TTL, keyed by userId:portfolioId.
//   Invalidated on: position change, snapshot capture, broker sync, import.
// ---------------------------------------------------------------------------

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  portfolios,
  portfolioPositions,
  institutionalSymbolSignals,
} from "../../shared/schema";
import { getAllThemes } from "../config/theme-registry";
import { getOpportunityIntelligence } from "./opportunity-intelligence-service";
import { getPortfolioChanges } from "./portfolio-history-service";
import { getReferenceSnapshotsBulk } from "./daily-market-data/reference-snapshot";
import type { CanonicalOpportunity } from "../../shared/opportunity-intelligence-types";
import type {
  PortfolioIntelligenceResult,
  PortfolioIntelligenceResponse,
  PortfolioSymbolIntelligence,
  PortfolioIntelligenceHealth,
  PortfolioResearchCoverage,
  ConcentrationMetrics,
  ConcentrationLabel,
  SectorExposureItem,
  ThemeExposureItem,
  OpportunityOverlapItem,
  ResearchChangeHolding,
  HoldingResearchSummary,
  InstitutionalContextSummary,
  RiskObservation,
  ResearchObservation,
  FurtherResearchArea,
  OverlapCategory,
} from "../../shared/portfolio-intelligence-types";

// ---------------------------------------------------------------------------
// In-memory cache (userId:portfolioId → timed result)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  result:    PortfolioIntelligenceResult;
  expiresAt: number;
}
const _cache = new Map<string, CacheEntry>();

function _cacheKey(userId: string, portfolioId: string): string {
  return `${userId}:${portfolioId}`;
}

export function invalidatePortfolioIntelligenceCache(userId: string, portfolioId: string): void {
  _cache.delete(_cacheKey(userId, portfolioId));
}

function _getCached(userId: string, portfolioId: string): PortfolioIntelligenceResult | null {
  const key   = _cacheKey(userId, portfolioId);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.result;
}

function _setCached(userId: string, portfolioId: string, result: PortfolioIntelligenceResult): void {
  _cache.set(_cacheKey(userId, portfolioId), { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Platform health telemetry
// ---------------------------------------------------------------------------

const _health = {
  portfoliosAnalyzed:      0,
  lastAnalysisAt:          null as string | null,
  totalDurationMs:         0,
  partialAnalyses:         0,
  failedAnalyses:          0,
  totalCoveragePercent:    0,
  coverageSamples:         0,
};

export function getPortfolioIntelligenceHealth(): PortfolioIntelligenceHealth {
  const status: PortfolioIntelligenceHealth["status"] =
    _health.portfoliosAnalyzed === 0 ? "UNKNOWN"
    : _health.failedAnalyses > 0    ? "DEGRADED"
    : "HEALTHY";

  return {
    status,
    portfoliosAnalyzed:       _health.portfoliosAnalyzed,
    lastAnalysisAt:           _health.lastAnalysisAt,
    averageAnalysisDurationMs: _health.portfoliosAnalyzed > 0
      ? Math.round(_health.totalDurationMs / _health.portfoliosAnalyzed)
      : null,
    partialAnalyses:   _health.partialAnalyses,
    failedAnalyses:    _health.failedAnalyses,
    averageCoveragePercent: _health.coverageSamples > 0
      ? Math.round(_health.totalCoveragePercent / _health.coverageSamples)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Concentration thresholds (documented in Research Glossary)
// ---------------------------------------------------------------------------

function _concentrationLabel(pct: number | null, thresholds: [number, number]): ConcentrationLabel {
  if (pct === null) return "Low";
  if (pct > thresholds[1]) return "High";
  if (pct > thresholds[0]) return "Moderate";
  return "Low";
}

// Largest position: Low <10%, Moderate 10-20%, High >20%
const LARGEST_POSITION_THRESHOLDS: [number, number] = [10, 20];
// Top-3: Low <25%, Moderate 25-50%, High >50%
const TOP3_THRESHOLDS: [number, number] = [25, 50];
// Sector: Low <30%, Moderate 30-50%, High >50%
const SECTOR_THRESHOLDS: [number, number] = [30, 50];

// ---------------------------------------------------------------------------
// Overlap classification
// ---------------------------------------------------------------------------

function _overlapCategory(opp: CanonicalOpportunity | undefined): OverlapCategory {
  if (!opp) return "NOT_CURRENTLY_RANKED";
  if (opp._sourceCategory === "topGrowth" || opp._sourceCategory === "topIncome") return "CURRENTLY_QUALIFIED";
  if (opp._sourceCategory === "approaching" || opp._sourceCategory === "watchlist") return "APPROACHING_QUALIFICATION";
  return "NOT_CURRENTLY_RANKED";
}

// ---------------------------------------------------------------------------
// Main computation function
// ---------------------------------------------------------------------------

export async function computePortfolioIntelligence(
  userId:      string,
  portfolioId: string,
  snapshotId?: string,
): Promise<PortfolioIntelligenceResult | null> {
  const t0 = Date.now();

  // Cache hit
  if (!snapshotId) {
    const cached = _getCached(userId, portfolioId);
    if (cached) return cached;
  }

  // ─── 1. Load portfolio + ownership ───────────────────────────────────────
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

  if (!portfolio) return null;

  // ─── 2. Load positions ───────────────────────────────────────────────────
  const rawPositions = await db
    .select()
    .from(portfolioPositions)
    .where(eq(portfolioPositions.portfolioId, portfolioId));

  const positionCount = rawPositions.length;

  if (positionCount === 0) {
    const empty = _buildEmpty(portfolioId, portfolio.name);
    _setCached(userId, portfolioId, empty);
    return empty;
  }

  const symbols = Array.from(new Set(rawPositions.map(p => p.symbol.toUpperCase())));

  // ─── 3–6. Parallel bulk loads ─────────────────────────────────────────────
  const [intel, refSnaps, instRows, changeResult, allThemes] = await Promise.allSettled([
    getOpportunityIntelligence().catch(() => null),
    getReferenceSnapshotsBulk(userId, symbols, { feature: "portfolio_intelligence" }).catch(
      () => new Map<string, import("./daily-market-data/reference-snapshot").ReferenceSnapshot>()
    ),
    db.select().from(institutionalSymbolSignals)
      .where(inArray(institutionalSymbolSignals.symbol, symbols))
      .catch(() => []),
    getPortfolioChanges(portfolioId, userId).catch(() => null),
    Promise.resolve(getAllThemes()),
  ]);

  const oppIntel = instRows.status === "fulfilled" ? instRows.value : [];
  const intel_   = intel.status === "fulfilled" ? intel.value : null;
  const refMap   = refSnaps.status === "fulfilled" ? refSnaps.value
    : new Map<string, import("./daily-market-data/reference-snapshot").ReferenceSnapshot>();
  const instData = Array.isArray(oppIntel) ? oppIntel : [];
  const changes  = changeResult.status === "fulfilled" ? changeResult.value : null;
  const themes_  = allThemes.status === "fulfilled" ? allThemes.value : getAllThemes();

  // Build symbol → OppIntel map
  const oppMap = new Map<string, CanonicalOpportunity>();
  if (intel_?.opportunities) {
    for (const opp of intel_.opportunities) {
      oppMap.set(opp.symbol.toUpperCase(), opp);
    }
  }

  // Build symbol → lastPrice map
  const priceMap = new Map<string, number>();
  for (const [sym, snap] of Array.from(refMap.entries())) {
    if (snap.lastPrice !== null && snap.lastPrice !== undefined) {
      priceMap.set(sym, snap.lastPrice);
    }
  }

  // Build symbol → institutional signal map
  const instMap = new Map<string, typeof instData[number]>();
  for (const row of instData) {
    if (row.symbol) instMap.set(row.symbol.toUpperCase(), row);
  }

  // Build theme maps
  const symbolThemeIdMap  = new Map<string, string[]>();
  const symbolThemeNameMap = new Map<string, string[]>();
  const themeById = new Map<string, { name: string }>();

  for (const t of themes_) {
    themeById.set(t.themeId, { name: t.name });
    for (const sym of t.symbols) {
      const ids   = symbolThemeIdMap.get(sym) ?? [];
      const names = symbolThemeNameMap.get(sym) ?? [];
      ids.push(t.themeId);
      names.push(t.name);
      symbolThemeIdMap.set(sym, ids);
      symbolThemeNameMap.set(sym, names);
    }
  }

  // ─── 7. Enrich positions ──────────────────────────────────────────────────
  type EnrichedPos = {
    symbol:         string;
    quantity:       number;
    averageCost:    number | null;
    costBasis:      number | null;
    marketValue:    number | null;
    sector:         string | null;
    industry:       string | null;
    themeIds:       string[];
    themeNames:     string[];
    opp:            CanonicalOpportunity | undefined;
    hasInstSignal:  boolean;
  };

  const enriched: EnrichedPos[] = rawPositions.map(pos => {
    const sym  = pos.symbol.toUpperCase();
    const qty  = Number(pos.quantity);
    const opp  = oppMap.get(sym);
    const px   = priceMap.get(sym) ?? null;
    const mv   = px !== null ? px * qty : null;
    const inst = instMap.get(sym);

    return {
      symbol:        sym,
      quantity:      qty,
      averageCost:   pos.averageCost !== null ? Number(pos.averageCost) : null,
      costBasis:     pos.costBasis   !== null ? Number(pos.costBasis)   : null,
      marketValue:   mv,
      sector:        opp?.sector ?? null,
      industry:      opp?.industry ?? null,
      themeIds:      symbolThemeIdMap.get(sym)   ?? [],
      themeNames:    symbolThemeNameMap.get(sym) ?? [],
      opp,
      hasInstSignal: inst !== undefined && inst !== null,
    };
  });

  // ─── 8. Aggregate portfolio totals ───────────────────────────────────────
  const totalMV = enriched.some(p => p.marketValue !== null)
    ? enriched.reduce((s, p) => s + (p.marketValue ?? 0), 0)
    : null;
  const totalCB = enriched.some(p => p.costBasis !== null)
    ? enriched.reduce((s, p) => s + (p.costBasis ?? 0), 0)
    : null;

  // ─── 9. Coverage ─────────────────────────────────────────────────────────
  const coverage = _computeCoverage(enriched, positionCount);

  // ─── 10. Concentration ───────────────────────────────────────────────────
  const concentration = _computeConcentration(enriched, totalMV);

  // ─── 11. Sector exposure ─────────────────────────────────────────────────
  const sectorExposure = _computeSectorExposure(enriched, totalMV, changes);

  // ─── 12. Theme exposure ──────────────────────────────────────────────────
  const themeExposure = _computeThemeExposure(enriched, totalMV, themeById);

  // ─── 13. Opportunity overlap ─────────────────────────────────────────────
  const opportunityOverlap = _computeOpportunityOverlap(enriched, totalMV, oppMap, changes);

  // ─── 14. Research changes ────────────────────────────────────────────────
  const {
    strengthenedHoldings,
    weakenedHoldings,
    newlyQualifiedHoldings,
    noLongerQualifiedHoldings,
  } = _extractResearchChanges(changes, oppMap);

  // ─── 15. Holdings classification ─────────────────────────────────────────
  const { qualifiedHoldings, uncoveredHoldings } = _classifyHoldings(enriched, totalMV);

  // ─── 16. Institutional summary ───────────────────────────────────────────
  const institutionalSummary = _computeInstitutionalSummary(enriched, symbols.length);

  // ─── 17. Observations ────────────────────────────────────────────────────
  const riskObservations    = _buildRiskObservations(concentration, coverage, weakenedHoldings, noLongerQualifiedHoldings, institutionalSummary, sectorExposure);
  const researchObservations = _buildResearchObservations(enriched, sectorExposure, themeExposure, opportunityOverlap, strengthenedHoldings, weakenedHoldings, coverage);
  const furtherResearchAreas = _buildFurtherResearch(uncoveredHoldings, weakenedHoldings, institutionalSummary, concentration);

  // ─── 18. Freshness ───────────────────────────────────────────────────────
  const freshness: import("../../shared/portfolio-intelligence-types").PortfolioIntelligenceFreshness = {
    generatedAt:               new Date().toISOString(),
    opportunityIntelligenceAt: intel_?.generatedAt ?? null,
    latestSnapshotAt:          changes?.dataFreshness.toSnapshotAt ?? null,
    historyFromAt:             changes?.dataFreshness.fromSnapshotAt ?? null,
    historyToAt:               changes?.dataFreshness.toSnapshotAt ?? null,
    institutionalDataNote:     "Institutional data is sourced from SEC Form 13F filings. Filing dates are typically 45 days after quarter-end. Holdings reflect past filing periods and do not reflect current positions.",
  };

  // ─── 19. Limitations ─────────────────────────────────────────────────────
  const limitations: string[] = [];
  if (!intel_) limitations.push("Opportunity Intelligence is not currently available. Research scores and overlap data are unavailable.");
  if (coverage.positionsWithMarketData < positionCount) {
    const missing = positionCount - coverage.positionsWithMarketData;
    limitations.push(`Reference prices unavailable for ${missing} position${missing !== 1 ? "s" : ""}. Market value calculations are partial.`);
  }
  if (!changes) limitations.push("Portfolio history not yet available. Research change intelligence requires at least two snapshots.");
  if (institutionalSummary.symbolsCovered === 0) limitations.push("Institutional 13F evidence is not yet available for this portfolio's holdings.");

  const isPartial = limitations.length > 0;

  // ─── 20. Build result ─────────────────────────────────────────────────────
  const durationMs = Date.now() - t0;
  _health.portfoliosAnalyzed += 1;
  _health.lastAnalysisAt      = new Date().toISOString();
  _health.totalDurationMs    += durationMs;
  if (isPartial) _health.partialAnalyses += 1;
  _health.totalCoveragePercent += coverage.overallCoveragePercent;
  _health.coverageSamples     += 1;

  console.log(JSON.stringify({
    event:              "portfolio_intelligence_completed",
    durationMs,
    positionCount,
    coveragePercent:    coverage.overallCoveragePercent,
    subsystemsAvailable: {
      opportunityIntelligence: intel_ !== null,
      institutionalSignals:    instData.length > 0,
      portfolioHistory:        changes !== null,
      referencePrices:         priceMap.size > 0,
    },
    partial: isPartial,
  }));

  const result: PortfolioIntelligenceResult = {
    portfolioId,
    portfolioName:       portfolio.name,
    generatedAt:         freshness.generatedAt,
    snapshotId:          snapshotId ?? null,
    marketValue:         totalMV,
    costBasis:           totalCB,
    positionCount,
    marketRegime:        intel_?.marketRegime ?? null,
    coverage,
    concentration,
    sectorExposure,
    themeExposure,
    opportunityOverlap,
    strengthenedHoldings,
    weakenedHoldings,
    newlyQualifiedHoldings,
    noLongerQualifiedHoldings,
    qualifiedHoldings,
    uncoveredHoldings,
    institutionalSummary,
    riskObservations,
    researchObservations,
    furtherResearchAreas,
    disclaimer: "Portfolio Intelligence summarizes research evidence and observed portfolio characteristics for informational and research purposes. It does not provide individualized investment advice, suitability determinations, or recommendations to buy, sell, hold, or rebalance securities.",
    limitations,
    freshness,
  };

  if (!snapshotId) _setCached(userId, portfolioId, result);
  return result;
}

// ---------------------------------------------------------------------------
// Sub-computations (pure functions — testable independently)
// ---------------------------------------------------------------------------

type EnrichedPos = {
  symbol: string; quantity: number; averageCost: number | null; costBasis: number | null;
  marketValue: number | null; sector: string | null; industry: string | null;
  themeIds: string[]; themeNames: string[];
  opp: CanonicalOpportunity | undefined; hasInstSignal: boolean;
};

export function _computeCoverage(enriched: EnrichedPos[], positionsTotal: number): PortfolioResearchCoverage {
  let withMktData = 0, withOppIntel = 0, withFundamental = 0;
  let withInstitutional = 0, withSector = 0, withTheme = 0;

  for (const p of enriched) {
    if (p.marketValue !== null)  withMktData++;
    if (p.opp)                   withOppIntel++;
    if (p.opp && (p.opp.fundamentalScore ?? 0) > 0)   withFundamental++;
    if (p.hasInstSignal)         withInstitutional++;
    if (p.sector)                withSector++;
    if (p.themeIds.length > 0)   withTheme++;
  }

  if (positionsTotal === 0) {
    return { positionsTotal: 0, positionsWithMarketData: 0, positionsWithOpportunityIntelligence: 0,
             positionsWithFundamentalEvidence: 0, positionsWithInstitutionalEvidence: 0,
             positionsWithSector: 0, positionsWithTheme: 0, overallCoveragePercent: 0 };
  }

  // Weighted composite: OppIntel 40%, market data 25%, sector 15%, theme 10%, institutional 10%
  const weighted =
    (withOppIntel / positionsTotal) * 40 +
    (withMktData  / positionsTotal) * 25 +
    (withSector   / positionsTotal) * 15 +
    (withTheme    / positionsTotal) * 10 +
    (withInstitutional / positionsTotal) * 10;

  return {
    positionsTotal,
    positionsWithMarketData:             withMktData,
    positionsWithOpportunityIntelligence: withOppIntel,
    positionsWithFundamentalEvidence:    withFundamental,
    positionsWithInstitutionalEvidence:  withInstitutional,
    positionsWithSector:                 withSector,
    positionsWithTheme:                  withTheme,
    overallCoveragePercent:              Math.round(weighted),
  };
}

export function _computeConcentration(enriched: EnrichedPos[], totalMV: number | null): ConcentrationMetrics {
  if (!totalMV || totalMV === 0 || enriched.length === 0) {
    return {
      largestPositionPercent: null, largestPositionSymbol: null,
      top3PositionPercent: null, top5PositionPercent: null,
      largestSectorPercent: null, largestSectorName: null,
      largestThemePercent: null, largestThemeName: null,
      concentrationLabel: "Low", top3Label: "Low", sectorLabel: "Low",
    };
  }

  const sorted = [...enriched]
    .filter(p => p.marketValue !== null)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const pct = (mv: number | null) => mv !== null ? (mv / totalMV) * 100 : 0;

  const top1 = sorted[0];
  const top3  = sorted.slice(0, 3).reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const top5  = sorted.slice(0, 5).reduce((s, p) => s + (p.marketValue ?? 0), 0);

  const largestPct   = top1 ? pct(top1.marketValue) : null;
  const top3Pct      = sorted.length >= 2 ? pct(top3) : null;
  const top5Pct      = sorted.length >= 3 ? pct(top5) : null;

  // Sector concentration
  const sectorTotals = new Map<string, number>();
  for (const p of enriched) {
    if (p.sector && p.marketValue !== null) {
      sectorTotals.set(p.sector, (sectorTotals.get(p.sector) ?? 0) + p.marketValue);
    }
  }
  let largestSectorPct: number | null = null;
  let largestSectorName: string | null = null;
  for (const [sector, mv] of Array.from(sectorTotals.entries())) {
    const p = (mv / totalMV) * 100;
    if (largestSectorPct === null || p > largestSectorPct) {
      largestSectorPct = p; largestSectorName = sector;
    }
  }

  // Theme concentration (overlapping — use largest single theme)
  const themeTotals = new Map<string, { mv: number; name: string }>();
  for (const p of enriched) {
    for (let i = 0; i < p.themeIds.length; i++) {
      const tid   = p.themeIds[i];
      const tname = p.themeNames[i] ?? tid;
      const entry = themeTotals.get(tid) ?? { mv: 0, name: tname };
      entry.mv += p.marketValue ?? 0;
      themeTotals.set(tid, entry);
    }
  }
  let largestThemePct: number | null = null;
  let largestThemeName: string | null = null;
  for (const [, { mv, name }] of Array.from(themeTotals.entries())) {
    const p = (mv / totalMV) * 100;
    if (largestThemePct === null || p > largestThemePct) {
      largestThemePct = p; largestThemeName = name;
    }
  }

  return {
    largestPositionPercent: largestPct  !== null ? Math.round(largestPct * 10) / 10 : null,
    largestPositionSymbol:  top1?.symbol ?? null,
    top3PositionPercent:    top3Pct     !== null ? Math.round(top3Pct * 10) / 10 : null,
    top5PositionPercent:    top5Pct     !== null ? Math.round(top5Pct * 10) / 10 : null,
    largestSectorPercent:   largestSectorPct  !== null ? Math.round(largestSectorPct * 10) / 10 : null,
    largestSectorName,
    largestThemePercent:    largestThemePct   !== null ? Math.round(largestThemePct * 10) / 10 : null,
    largestThemeName,
    concentrationLabel: _concentrationLabel(largestPct, LARGEST_POSITION_THRESHOLDS),
    top3Label:          _concentrationLabel(top3Pct,    TOP3_THRESHOLDS),
    sectorLabel:        _concentrationLabel(largestSectorPct, SECTOR_THRESHOLDS),
  };
}

export function _computeSectorExposure(
  enriched: EnrichedPos[],
  totalMV: number | null,
  changes: import("../../shared/portfolio-history-types").PortfolioChangeResult | null,
): SectorExposureItem[] {
  const sectorMap = new Map<string, { mv: number; symbols: string[] }>();
  for (const p of enriched) {
    if (!p.sector) continue;
    const entry = sectorMap.get(p.sector) ?? { mv: 0, symbols: [] };
    entry.mv += p.marketValue ?? 0;
    entry.symbols.push(p.symbol);
    sectorMap.set(p.sector, entry);
  }

  // Build change map from portfolio history
  const sectorChangePct = new Map<string, number>();
  if (changes?.sectorChanges) {
    for (const sc of changes.sectorChanges) {
      sectorChangePct.set(sc.name, sc.percentDelta ?? 0);
    }
  }

  const items: SectorExposureItem[] = [];
  for (const [sector, { mv, symbols }] of Array.from(sectorMap.entries())) {
    items.push({
      sector,
      marketValue:                 mv > 0 ? mv : null,
      portfolioPercent:            totalMV && totalMV > 0 ? Math.round((mv / totalMV) * 1000) / 10 : null,
      positionCount:               symbols.length,
      symbols:                     symbols.sort(),
      changeSincePreviousSnapshot: sectorChangePct.get(sector) ?? null,
    });
  }

  return items.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export function _computeThemeExposure(
  enriched: EnrichedPos[],
  totalMV: number | null,
  themeById: Map<string, { name: string }>,
): ThemeExposureItem[] {
  const themeMap = new Map<string, { mv: number; symbols: string[] }>();
  for (const p of enriched) {
    for (const tid of p.themeIds) {
      const entry = themeMap.get(tid) ?? { mv: 0, symbols: [] };
      entry.mv += p.marketValue ?? 0;
      entry.symbols.push(p.symbol);
      themeMap.set(tid, entry);
    }
  }

  const items: ThemeExposureItem[] = [];
  for (const [tid, { mv, symbols }] of Array.from(themeMap.entries())) {
    const tDef = themeById.get(tid);
    items.push({
      themeId:          tid,
      themeName:        tDef?.name ?? tid,
      marketValue:      mv > 0 ? mv : null,
      portfolioPercent: totalMV && totalMV > 0 ? Math.round((mv / totalMV) * 1000) / 10 : null,
      positionCount:    symbols.length,
      symbols:          symbols.sort(),
    });
  }

  return items.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export function _computeOpportunityOverlap(
  enriched: EnrichedPos[],
  totalMV: number | null,
  oppMap: Map<string, CanonicalOpportunity>,
  changes: import("../../shared/portfolio-history-types").PortfolioChangeResult | null,
): OpportunityOverlapItem[] {
  // Build set of symbols that recently lost qualification from history
  const noLongerSet = new Set<string>();
  if (changes?.noLongerQualified) {
    for (const r of changes.noLongerQualified) noLongerSet.add(r.symbol);
  }

  return enriched.map(p => {
    const opp = oppMap.get(p.symbol);
    let category = _overlapCategory(opp);
    if (category === "NOT_CURRENTLY_RANKED" && noLongerSet.has(p.symbol)) {
      category = "NO_LONGER_QUALIFIED";
    }

    return {
      symbol:               p.symbol,
      companyName:          opp?.companyName ?? null,
      overlapCategory:      category,
      researchScore:        opp?.researchScore      ?? null,
      technicalScore:       opp?.technicalScore     ?? null,
      fundamentalScore:     opp?.fundamentalScore   ?? null,
      institutionalScore:   opp?.institutionalScore ?? null,
      opportunityType:      opp?.opportunityType      ?? null,
      opportunityTypeLabel: opp?.opportunityTypeLabel ?? null,
      confidence:           opp?.confidence           ?? null,
      riskLevel:            opp?.riskLevel            ?? null,
      primaryEvidence:      opp?.primaryEvidence ?? [],
      portfolioWeight:      totalMV && totalMV > 0 && p.marketValue !== null
        ? Math.round((p.marketValue / totalMV) * 1000) / 10
        : null,
    };
  }).sort((a, b) => {
    // Sort: CURRENTLY_QUALIFIED > APPROACHING > NO_LONGER > NOT_RANKED
    const order = { CURRENTLY_QUALIFIED: 0, APPROACHING_QUALIFICATION: 1, NO_LONGER_QUALIFIED: 2, NOT_CURRENTLY_RANKED: 3 };
    return (order[a.overlapCategory] ?? 3) - (order[b.overlapCategory] ?? 3);
  });
}

export function _extractResearchChanges(
  changes: import("../../shared/portfolio-history-types").PortfolioChangeResult | null,
  oppMap: Map<string, CanonicalOpportunity>,
): {
  strengthenedHoldings:    ResearchChangeHolding[];
  weakenedHoldings:        ResearchChangeHolding[];
  newlyQualifiedHoldings:  ResearchChangeHolding[];
  noLongerQualifiedHoldings: ResearchChangeHolding[];
} {
  function toHolding(
    item: import("../../shared/portfolio-history-types").ResearchChangeItem,
    changeType: ResearchChangeHolding["changeType"],
  ): ResearchChangeHolding {
    const opp = oppMap.get(item.symbol);
    return {
      symbol:        item.symbol,
      companyName:   opp?.companyName ?? null,
      changeType,
      previousScore: item.previousScore,
      currentScore:  item.currentScore,
      scoreDelta:    item.scoreDelta,
      sector:        opp?.sector ?? item.sector ?? null,
    };
  }

  if (!changes) return { strengthenedHoldings: [], weakenedHoldings: [], newlyQualifiedHoldings: [], noLongerQualifiedHoldings: [] };

  return {
    strengthenedHoldings:    changes.researchStrengthened.map(r => toHolding(r, "RESEARCH_STRENGTHENED")),
    weakenedHoldings:        changes.researchWeakened.map(r => toHolding(r, "RESEARCH_WEAKENED")),
    newlyQualifiedHoldings:  changes.newlyQualified.map(r => toHolding(r, "NEWLY_QUALIFIED")),
    noLongerQualifiedHoldings: changes.noLongerQualified.map(r => toHolding(r, "NO_LONGER_QUALIFIED")),
  };
}

export function _classifyHoldings(
  enriched: EnrichedPos[],
  totalMV: number | null,
): { qualifiedHoldings: HoldingResearchSummary[]; uncoveredHoldings: HoldingResearchSummary[] } {
  const qualified:  HoldingResearchSummary[] = [];
  const uncovered:  HoldingResearchSummary[] = [];

  for (const p of enriched) {
    const weight = totalMV && totalMV > 0 && p.marketValue !== null
      ? Math.round((p.marketValue / totalMV) * 1000) / 10
      : null;
    const summary: HoldingResearchSummary = {
      symbol:                  p.symbol,
      companyName:             p.opp?.companyName ?? null,
      sector:                  p.sector,
      themes:                  p.themeNames,
      portfolioWeight:         weight,
      marketValue:             p.marketValue,
      researchScore:           p.opp?.researchScore      ?? null,
      technicalScore:          p.opp?.technicalScore     ?? null,
      fundamentalScore:        p.opp?.fundamentalScore   ?? null,
      institutionalScore:      p.opp?.institutionalScore ?? null,
      overlapCategory:         _overlapCategory(p.opp),
      hasInstitutionalEvidence: p.hasInstSignal,
      hasFundamentalEvidence:  p.opp ? (p.opp.fundamentalScore ?? 0) > 0 : false,
    };
    if (p.opp) qualified.push(summary);
    else        uncovered.push(summary);
  }

  return {
    qualifiedHoldings: qualified.sort((a, b) => (b.researchScore ?? 0) - (a.researchScore ?? 0)),
    uncoveredHoldings: uncovered,
  };
}

export function _computeInstitutionalSummary(
  enriched: EnrichedPos[],
  symbolsTotal: number,
): InstitutionalContextSummary {
  const covered = enriched.filter(p => p.hasInstSignal).length;
  return {
    symbolsCovered:      covered,
    symbolsTotal,
    coveragePercent:     symbolsTotal > 0 ? Math.round((covered / symbolsTotal) * 100) : 0,
    holdingsWithActivity: covered,
    disclosure:          "Institutional data is sourced from SEC Form 13F filings. These filings are required from institutional investment managers with assets under management of $100M or more. Filing dates are typically 45 days after quarter-end and reflect holdings as of the prior quarter-end. Data does not reflect current institutional positions.",
  };
}

export function _buildRiskObservations(
  concentration: ConcentrationMetrics,
  coverage: PortfolioResearchCoverage,
  weakenedHoldings: ResearchChangeHolding[],
  noLongerQualified: ResearchChangeHolding[],
  institutionalSummary: InstitutionalContextSummary,
  sectorExposure: SectorExposureItem[],
): RiskObservation[] {
  const obs: RiskObservation[] = [];

  // Concentration
  if (concentration.concentrationLabel === "High" && concentration.largestPositionSymbol) {
    obs.push({
      type:            "concentration",
      label:           "High Single-Name Concentration",
      description:     `${concentration.largestPositionSymbol} represents approximately ${concentration.largestPositionPercent}% of observed portfolio market value. This is classified as High concentration (threshold: >20%).`,
      affectedSymbols: [concentration.largestPositionSymbol],
    });
  } else if (concentration.concentrationLabel === "Moderate" && concentration.largestPositionSymbol) {
    obs.push({
      type:            "concentration",
      label:           "Moderate Single-Name Concentration",
      description:     `${concentration.largestPositionSymbol} represents approximately ${concentration.largestPositionPercent}% of observed portfolio market value. This is classified as Moderate concentration (threshold: 10–20%).`,
      affectedSymbols: [concentration.largestPositionSymbol],
    });
  }

  // Sector concentration
  if (concentration.sectorLabel !== "Low" && concentration.largestSectorName) {
    obs.push({
      type:            "sector_concentration",
      label:           `${concentration.sectorLabel} Sector Concentration — ${concentration.largestSectorName}`,
      description:     `${concentration.largestSectorName} represents approximately ${concentration.largestSectorPercent}% of observed portfolio market value.`,
      affectedSymbols: sectorExposure.find(s => s.sector === concentration.largestSectorName)?.symbols ?? [],
    });
  }

  // Theme concentration
  if (concentration.largestThemePercent !== null && concentration.largestThemePercent > 40 && concentration.largestThemeName) {
    obs.push({
      type:            "theme_concentration",
      label:           `High Theme Concentration — ${concentration.largestThemeName}`,
      description:     `${concentration.largestThemeName} theme represents approximately ${concentration.largestThemePercent}% of observed portfolio market value. Theme percentages may overlap with sector percentages.`,
      affectedSymbols: [],
    });
  }

  // Limited research coverage
  if (coverage.overallCoveragePercent < 50) {
    obs.push({
      type:            "limited_coverage",
      label:           "Limited Research Coverage",
      description:     `Overall research coverage is ${coverage.overallCoveragePercent}%. ${coverage.positionsTotal - coverage.positionsWithOpportunityIntelligence} holding${coverage.positionsTotal - coverage.positionsWithOpportunityIntelligence !== 1 ? "s" : ""} do not currently appear in Opportunity Intelligence.`,
      affectedSymbols: [],
    });
  }

  // Institutional data gap
  if (institutionalSummary.symbolsTotal > 0 && institutionalSummary.symbolsCovered === 0) {
    obs.push({
      type:            "institutional_data_gap",
      label:           "Institutional Evidence Unavailable",
      description:     "No institutional 13F evidence is currently available for holdings in this portfolio. This may indicate holdings are outside the institutional investment universe, or that ingestion is not yet configured.",
      affectedSymbols: [],
    });
  }

  // Research weakening
  if (weakenedHoldings.length > 0) {
    obs.push({
      type:            "research_weakening",
      label:           `Research Evidence Weakened — ${weakenedHoldings.length} Holding${weakenedHoldings.length !== 1 ? "s" : ""}`,
      description:     `Research evidence has weakened for ${weakenedHoldings.map(h => h.symbol).join(", ")} since the previous portfolio snapshot.`,
      affectedSymbols: weakenedHoldings.map(h => h.symbol),
    });
  }

  // No longer qualified
  if (noLongerQualified.length > 0) {
    obs.push({
      type:            "no_longer_qualified",
      label:           `No Longer in Opportunity Intelligence — ${noLongerQualified.length} Holding${noLongerQualified.length !== 1 ? "s" : ""}`,
      description:     `${noLongerQualified.map(h => h.symbol).join(", ")} are no longer represented in the current Opportunity Intelligence snapshot. This does not constitute a negative quality signal.`,
      affectedSymbols: noLongerQualified.map(h => h.symbol),
    });
  }

  return obs;
}

export function _buildResearchObservations(
  enriched: EnrichedPos[],
  sectorExposure: SectorExposureItem[],
  themeExposure: ThemeExposureItem[],
  opportunityOverlap: OpportunityOverlapItem[],
  strengthened: ResearchChangeHolding[],
  weakened: ResearchChangeHolding[],
  coverage: PortfolioResearchCoverage,
): ResearchObservation[] {
  const obs: ResearchObservation[] = [];
  const n = enriched.length;

  // Sector
  if (sectorExposure.length > 0 && sectorExposure[0].portfolioPercent !== null) {
    obs.push({ type: "sector_dominant", text: `${sectorExposure[0].sector} represents ${sectorExposure[0].portfolioPercent}% of current portfolio market value across ${sectorExposure[0].positionCount} holding${sectorExposure[0].positionCount !== 1 ? "s" : ""}.` });
  }

  // Theme
  if (themeExposure.length > 0 && themeExposure[0].portfolioPercent !== null) {
    obs.push({ type: "theme_dominant", text: `${themeExposure[0].themeName} theme exposure represents ${themeExposure[0].portfolioPercent}% of portfolio market value across ${themeExposure[0].positionCount} holding${themeExposure[0].positionCount !== 1 ? "s" : ""}. Theme percentages may exceed 100% total due to overlap.` });
  }

  // Opportunity overlap
  const qualifiedCount = opportunityOverlap.filter(o => o.overlapCategory === "CURRENTLY_QUALIFIED").length;
  if (qualifiedCount > 0) {
    obs.push({ type: "opportunity_overlap", text: `${qualifiedCount} of ${n} holding${n !== 1 ? "s" : ""} currently appear in Opportunity Intelligence as qualified candidates.` });
  } else if (coverage.positionsWithOpportunityIntelligence > 0) {
    obs.push({ type: "opportunity_overlap", text: `${coverage.positionsWithOpportunityIntelligence} holding${coverage.positionsWithOpportunityIntelligence !== 1 ? "s" : ""} appear in the current Opportunity Intelligence snapshot.` });
  }

  // Research changes
  if (strengthened.length > 0) {
    obs.push({ type: "research_strengthened", text: `Research evidence has strengthened for ${strengthened.length} holding${strengthened.length !== 1 ? "s" : ""} (${strengthened.map(h => h.symbol).join(", ")}) since the previous portfolio snapshot.` });
  }
  if (weakened.length > 0) {
    obs.push({ type: "research_weakened", text: `Research evidence has weakened for ${weakened.length} holding${weakened.length !== 1 ? "s" : ""} (${weakened.map(h => h.symbol).join(", ")}) since the previous portfolio snapshot.` });
  }

  // Coverage
  const uncoveredCount = n - coverage.positionsWithOpportunityIntelligence;
  if (uncoveredCount > 0) {
    obs.push({ type: "coverage_gap", text: `${uncoveredCount} holding${uncoveredCount !== 1 ? "s" : ""} do not currently have sufficient Opportunity Intelligence coverage.` });
  }

  return obs;
}

export function _buildFurtherResearch(
  uncoveredHoldings: HoldingResearchSummary[],
  weakened: ResearchChangeHolding[],
  institutionalSummary: InstitutionalContextSummary,
  concentration: ConcentrationMetrics,
): FurtherResearchArea[] {
  const areas: FurtherResearchArea[] = [];

  if (uncoveredHoldings.length > 0) {
    areas.push({
      area:        "Review holdings without research coverage",
      description: `${uncoveredHoldings.length} holding${uncoveredHoldings.length !== 1 ? "s" : ""} (${uncoveredHoldings.map(h => h.symbol).join(", ")}) do not currently appear in Opportunity Intelligence.`,
      linkPath:    "/research",
    });
  }

  if (weakened.length > 0) {
    areas.push({
      area:        "Review holdings with weakened research evidence",
      description: `${weakened.map(h => h.symbol).join(", ")} showed weakened research evidence since the last snapshot.`,
      linkPath:    "/research",
    });
  }

  if (institutionalSummary.symbolsCovered > 0) {
    areas.push({
      area:        "Explore institutional context",
      description: "Review SEC 13F filing evidence for portfolio holdings with available institutional data.",
      linkPath:    "/research/institutional",
    });
  }

  if (concentration.concentrationLabel !== "Low") {
    areas.push({
      area:        `Review ${concentration.largestSectorName ?? "sector"} exposure`,
      description: concentration.largestSectorName
        ? `${concentration.largestSectorName} represents ${concentration.largestSectorPercent}% of observed portfolio market value.`
        : "Consider reviewing the dominant sector exposure in the Sector Intelligence section.",
      linkPath:    "/research/sectors",
    });
  }

  return areas;
}

// ---------------------------------------------------------------------------
// Empty portfolio helper
// ---------------------------------------------------------------------------

function _buildEmpty(portfolioId: string, portfolioName: string): PortfolioIntelligenceResult {
  return {
    portfolioId, portfolioName,
    generatedAt:  new Date().toISOString(),
    snapshotId:   null,
    marketValue:  null, costBasis: null, positionCount: 0, marketRegime: null,
    coverage:     { positionsTotal: 0, positionsWithMarketData: 0, positionsWithOpportunityIntelligence: 0,
                    positionsWithFundamentalEvidence: 0, positionsWithInstitutionalEvidence: 0,
                    positionsWithSector: 0, positionsWithTheme: 0, overallCoveragePercent: 0 },
    concentration: { largestPositionPercent: null, largestPositionSymbol: null, top3PositionPercent: null,
                     top5PositionPercent: null, largestSectorPercent: null, largestSectorName: null,
                     largestThemePercent: null, largestThemeName: null,
                     concentrationLabel: "Low", top3Label: "Low", sectorLabel: "Low" },
    sectorExposure: [], themeExposure: [], opportunityOverlap: [],
    strengthenedHoldings: [], weakenedHoldings: [], newlyQualifiedHoldings: [], noLongerQualifiedHoldings: [],
    qualifiedHoldings: [], uncoveredHoldings: [],
    institutionalSummary: { symbolsCovered: 0, symbolsTotal: 0, coveragePercent: 0, holdingsWithActivity: 0,
                            disclosure: "No holdings to analyze." },
    riskObservations: [], researchObservations: [], furtherResearchAreas: [],
    disclaimer: "Portfolio Intelligence summarizes research evidence and observed portfolio characteristics for informational and research purposes. It does not provide individualized investment advice, suitability determinations, or recommendations to buy, sell, hold, or rebalance securities.",
    limitations: ["Portfolio has no positions."],
    freshness:   { generatedAt: new Date().toISOString(), opportunityIntelligenceAt: null,
                   latestSnapshotAt: null, historyFromAt: null, historyToAt: null,
                   institutionalDataNote: "" },
  };
}

// ---------------------------------------------------------------------------
// Public API: getPortfolioIntelligence (with structured logging)
// ---------------------------------------------------------------------------

export async function getPortfolioIntelligence(
  userId:      string,
  portfolioId: string,
  snapshotId?: string,
): Promise<PortfolioIntelligenceResponse> {
  const t0 = Date.now();

  console.log(JSON.stringify({
    event:       "portfolio_intelligence_started",
    portfolioId, // no user PII, no values
    ts:          new Date().toISOString(),
  }));

  try {
    const result = await computePortfolioIntelligence(userId, portfolioId, snapshotId);

    if (!result) {
      return { available: false, portfolioId, generatedAt: new Date().toISOString(), intelligence: null, message: "Portfolio not found or access denied." };
    }

    if (result.positionCount === 0) {
      return { available: false, portfolioId, generatedAt: result.generatedAt, intelligence: null, message: "Portfolio has no positions." };
    }

    const isPartial = result.limitations.length > 0;
    if (isPartial) {
      console.log(JSON.stringify({ event: "portfolio_intelligence_partial", durationMs: Date.now() - t0, limitations: result.limitations.length }));
    }

    return { available: true, portfolioId, generatedAt: result.generatedAt, intelligence: result };
  } catch (err) {
    _health.failedAnalyses += 1;
    console.log(JSON.stringify({ event: "portfolio_intelligence_failed", durationMs: Date.now() - t0, error: String(err) }));
    return { available: false, portfolioId, generatedAt: new Date().toISOString(), intelligence: null, message: "Portfolio Intelligence is temporarily unavailable." };
  }
}

// ---------------------------------------------------------------------------
// Symbol-level detail endpoint helper
// ---------------------------------------------------------------------------

export async function getPortfolioSymbolIntelligence(
  userId:      string,
  portfolioId: string,
  symbol:      string,
): Promise<PortfolioSymbolIntelligence | null> {
  const sym = symbol.toUpperCase();

  // Verify ownership + position exists
  const [portfolio] = await db.select().from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
  if (!portfolio) return null;

  const [pos] = await db.select().from(portfolioPositions)
    .where(and(eq(portfolioPositions.portfolioId, portfolioId), eq(portfolioPositions.symbol, sym)));
  if (!pos) return null;

  // Full intelligence (cached if already computed)
  const intel = await computePortfolioIntelligence(userId, portfolioId);
  if (!intel) return null;

  const overlap  = intel.opportunityOverlap.find(o => o.symbol === sym);
  const change   = [
    ...intel.strengthenedHoldings, ...intel.weakenedHoldings,
    ...intel.newlyQualifiedHoldings, ...intel.noLongerQualifiedHoldings,
  ].find(h => h.symbol === sym) ?? null;

  const opp      = overlap?.overlapCategory !== "NOT_CURRENTLY_RANKED" ? null : null; // will get from intel service below
  const sectorItem = intel.sectorExposure.find(s => s.symbols.includes(sym));
  const qty      = Number(pos.quantity);
  const mv       = intel.opportunityOverlap.find(o => o.symbol === sym)?.portfolioWeight !== null
    ? (intel.marketValue && intel.opportunityOverlap.find(o => o.symbol === sym)?.portfolioWeight !== null
        ? (intel.marketValue * ((intel.opportunityOverlap.find(o => o.symbol === sym)?.portfolioWeight ?? 0) / 100))
        : null)
    : null;

  const themeIds   = intel.themeExposure.filter(t => t.symbols.includes(sym)).map(t => t.themeId);
  const themeNames = intel.themeExposure.filter(t => t.symbols.includes(sym)).map(t => t.themeName);

  return {
    portfolioId,
    symbol:                       sym,
    companyName:                  overlap?.companyName ?? null,
    portfolioWeight:              overlap?.portfolioWeight ?? null,
    quantity:                     qty,
    marketValue:                  mv,
    sector:                       sectorItem?.sector ?? null,
    industry:                     null, // not stored in portfolio positions
    themes:                       themeNames,
    themeIds,
    sectorExposureContribution:   sectorItem?.portfolioPercent ?? null,
    overlapCategory:              overlap?.overlapCategory ?? "NOT_CURRENTLY_RANKED",
    canonicalOpportunity:         null, // caller may fetch from /api/opportunities/workspace/:symbol
    researchChange:               change ?? null,
    hasInstitutionalEvidence:     intel.qualifiedHoldings.find(h => h.symbol === sym)?.hasInstitutionalEvidence ?? false,
    institutionalDisclosure:      intel.institutionalSummary.disclosure,
    furtherResearch:              `/opportunities/${sym}`,
    disclaimer:                   intel.disclaimer,
  };
}
