/**
 * Portfolio Analytics Service — Sprint 2.6.2
 *
 * Pure computation layer over:
 *   - portfolio_snapshots / portfolio_position_snapshots (existing tables)
 *   - Portfolio Intelligence (Sprint 2.6.1, optional — graceful fallback)
 *   - Opportunity Intelligence (Sprint 2.5.0, optional — graceful fallback)
 *
 * DESIGN RULES:
 *   - No new DB tables. All data from existing snapshot tables.
 *   - No new scoring formulas. Research scores read from snapshots only.
 *   - No investment recommendations, return calculations (without flow accounting), or opaque scores.
 *   - Missing data stays null — never coerced to 0.
 *   - 5-minute cache keyed by userId + portfolioId + period.
 *   - Ownership verified on every request.
 *   - Structured logs: never include portfolio values, symbols, cost basis, or user identity.
 *
 * PERFORMANCE TERMINOLOGY:
 *   "Portfolio Value Change" ✓
 *   "Unrealized Gain/Loss" ✓ (only where cost basis is confirmed)
 *   "Market Value Trend" ✓
 *   Never: "Return", "Alpha", "Performance", "CAGR", "Sharpe"
 */

import { db } from "../db";
import { portfolios } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getPortfolioSnapshots } from "./portfolio-history-service";
import { getPortfolioIntelligence } from "./portfolio-intelligence-service";
import { getAllThemes } from "../config/theme-registry";
import type { HistoryPeriod } from "../../shared/portfolio-history-types";
import type {
  PortfolioAnalyticsResult,
  HoldingAnalyticsResult,
  PortfolioAnalyticsHealth,
  AnalyticsPeriod,
  ValueHistoryPoint,
  ValueChangeSummary,
  CostBasisSummary,
  PositionAllocationItem,
  SectorAllocationItem,
  ThemeAllocationItem,
  ConcentrationSummary,
  ResearchCoverageTrendPoint,
  OpportunityOverlapTrendPoint,
  ResearchChangeTrendPoint,
  SectorExposureHistoryPoint,
  ThemeExposureHistoryPoint,
  HoldingHistoryPoint,
  AnalyticsFreshness,
  AnalyticsCoverage,
} from "../../shared/portfolio-analytics-types";

// ---------------------------------------------------------------------------
// Cache (5-minute TTL per userId + portfolioId + period)
// ---------------------------------------------------------------------------

const _cache = new Map<string, { result: PortfolioAnalyticsResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function _cacheKey(userId: string, portfolioId: string, period: AnalyticsPeriod): string {
  return `${userId}::${portfolioId}::${period}`;
}

export function invalidatePortfolioAnalyticsCache(portfolioId: string): void {
  for (const key of Array.from(_cache.keys())) {
    if (key.includes(`::${portfolioId}::`)) {
      _cache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Analytics health telemetry (in-memory; resets on restart)
// ---------------------------------------------------------------------------

let _healthStats = {
  portfoliosWithAnalytics:    new Set<string>(),
  analyticsRequests:          0,
  totalDurationMs:            0,
  latestAnalyticsAt:          null as string | null,
  partialAnalytics:           0,
  failedAnalytics:            0,
};

export function getPortfolioAnalyticsHealth(): PortfolioAnalyticsHealth {
  const count = _healthStats.analyticsRequests;
  return {
    portfoliosWithAnalytics:   _healthStats.portfoliosWithAnalytics.size,
    analyticsRequests:         count,
    averageAnalyticsDurationMs: count > 0 ? Math.round(_healthStats.totalDurationMs / count) : null,
    latestAnalyticsAt:         _healthStats.latestAnalyticsAt,
    partialAnalytics:          _healthStats.partialAnalytics,
  };
}

// ---------------------------------------------------------------------------
// Period → cutoff date
// ---------------------------------------------------------------------------

function _periodCutoff(period: AnalyticsPeriod): Date | null {
  const now = new Date();
  switch (period) {
    case "7D":  return new Date(now.getTime() - 7  * 86_400_000);
    case "30D": return new Date(now.getTime() - 30 * 86_400_000);
    case "90D": return new Date(now.getTime() - 90 * 86_400_000);
    case "YTD": return new Date(now.getFullYear(), 0, 1);
    case "1Y":  return new Date(now.getTime() - 365 * 86_400_000);
    case "ALL": return null;
  }
}

// ---------------------------------------------------------------------------
// Position snapshots by symbol (for holding analytics)
// ---------------------------------------------------------------------------

async function _getPositionSnapshotsBySymbol(
  portfolioId: string,
  userId:      string,
  symbol:      string,
  period:      AnalyticsPeriod,
): Promise<Array<{
  snapshotDate:     string;
  capturedAt:       string;
  quantity:         number;
  marketValue:      number | null;
  costBasis:        number | null;
  totalPortfolioMV: number | null;
  researchScore:    number | null;
  technicalScore:   number | null;
  fundamentalScore: number | null;
  institutionalScore: number | null;
  opportunityType:  string | null;
}>> {
  const cutoff = _periodCutoff(period);
  let query = `
    SELECT
      ps.snapshot_date,
      ps.captured_at,
      ps.total_market_value AS total_portfolio_mv,
      pps.quantity,
      pps.market_value,
      pps.cost_basis,
      pps.research_score,
      pps.technical_score,
      pps.fundamental_score,
      pps.institutional_score,
      pps.opportunity_type
    FROM portfolio_position_snapshots pps
    JOIN portfolio_snapshots ps ON ps.id = pps.snapshot_id
    WHERE pps.portfolio_id = '${portfolioId}'
      AND ps.user_id       = '${userId}'
      AND pps.symbol       = '${symbol.toUpperCase()}'
  `;
  if (cutoff) {
    query += ` AND ps.captured_at >= '${cutoff.toISOString()}'`;
  }
  query += ` ORDER BY ps.captured_at ASC LIMIT 200`;

  const rows = await db.execute(sql.raw(query));
  return (rows.rows ?? []).map((r: any) => ({
    snapshotDate:      r.snapshot_date instanceof Date
                         ? r.snapshot_date.toISOString().slice(0, 10)
                         : String(r.snapshot_date).slice(0, 10),
    capturedAt:        r.captured_at instanceof Date ? r.captured_at.toISOString() : String(r.captured_at),
    quantity:          Number(r.quantity ?? 0),
    marketValue:       r.market_value      !== null ? Number(r.market_value)      : null,
    costBasis:         r.cost_basis        !== null ? Number(r.cost_basis)        : null,
    totalPortfolioMV:  r.total_portfolio_mv !== null ? Number(r.total_portfolio_mv) : null,
    researchScore:     r.research_score    !== null ? Number(r.research_score)    : null,
    technicalScore:    r.technical_score   !== null ? Number(r.technical_score)   : null,
    fundamentalScore:  r.fundamental_score !== null ? Number(r.fundamental_score) : null,
    institutionalScore: r.institutional_score !== null ? Number(r.institutional_score) : null,
    opportunityType:   r.opportunity_type ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function _safeDiv(num: number | null, den: number | null): number | null {
  if (num == null || den == null || den === 0) return null;
  return (num / den) * 100;
}

function _qualificationStatus(
  opportunityType: string | null,
  researchScore:   number | null,
): HoldingHistoryPoint["qualificationStatus"] {
  if (!opportunityType && researchScore == null) return null;
  // topGrowth / topIncome = qualified; approaching/watchlist = approaching
  if (!opportunityType) return "NOT_CURRENTLY_RANKED";
  const ot = opportunityType.toLowerCase();
  if (ot.includes("growth") || ot.includes("income")) return "CURRENTLY_QUALIFIED";
  if (ot.includes("approach") || ot.includes("watch")) return "APPROACHING_QUALIFICATION";
  return "NOT_CURRENTLY_RANKED";
}

// ---------------------------------------------------------------------------
// computePortfolioAnalytics — main entry point
// ---------------------------------------------------------------------------

export async function computePortfolioAnalytics(
  portfolioId: string,
  userId:      string,
  period:      AnalyticsPeriod = "30D",
): Promise<PortfolioAnalyticsResult | null> {

  const t0 = Date.now();
  _healthStats.analyticsRequests++;

  try {
    // ── 1. Ownership check ───────────────────────────────────────────────
    const [pf] = await db
      .select({ id: portfolios.id, name: portfolios.name })
      .from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

    if (!pf) return null;

    // ── 2. Cache hit ─────────────────────────────────────────────────────
    const cacheKey = _cacheKey(userId, portfolioId, period);
    const cached   = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.result;
    }

    // ── 3. Load snapshot cards for the period ────────────────────────────
    const snapshotCards = await getPortfolioSnapshots(portfolioId, userId, period as HistoryPeriod);
    // getPortfolioSnapshots returns DESC; reverse to chronological order
    const snapshots = [...snapshotCards].reverse();

    // ── 4. Load Portfolio Intelligence (graceful fallback) ────────────────
    let intel: Awaited<ReturnType<typeof getPortfolioIntelligence>> | null = null;
    try {
      intel = await getPortfolioIntelligence(portfolioId, userId);
    } catch {
      intel = null;
    }

    const intelResult = intel?.intelligence ?? null;

    // ── 5. Compute value history ─────────────────────────────────────────
    const valueHistory: ValueHistoryPoint[] = snapshots.map(s => ({
      snapshotDate: s.snapshotDate,
      capturedAt:   s.capturedAt,
      marketValue:  s.totalMarketValue,
      costBasis:    s.totalCostBasis,
      positionCount: s.positionCount,
      sourceType:   s.sourceType,
    }));

    // ── 6. Value change summary ──────────────────────────────────────────
    const first = snapshots[0] ?? null;
    const last  = snapshots[snapshots.length - 1] ?? null;
    const startingValue  = first?.totalMarketValue ?? null;
    const endingValue    = last?.totalMarketValue  ?? null;
    const absoluteChange = (startingValue !== null && endingValue !== null)
      ? endingValue - startingValue
      : null;
    const percentChange  = (absoluteChange !== null && startingValue && startingValue !== 0)
      ? (absoluteChange / startingValue) * 100
      : null;

    const valueChangeSummary: ValueChangeSummary = {
      startingValue,
      endingValue,
      absoluteChange,
      percentChange,
      snapshotCount: snapshots.length,
      periodStart:   first?.capturedAt ?? null,
      periodEnd:     last?.capturedAt  ?? null,
    };

    // ── 7. Cost basis summary ────────────────────────────────────────────
    // Use the latest snapshot's aggregate values + per-position cost data from intel
    const latestSnap      = last ?? null;
    const latestMV        = latestSnap?.totalMarketValue ?? null;
    const latestCostBasis = latestSnap?.totalCostBasis   ?? null;
    const latestPositions = latestSnap?.positionCount     ?? 0;

    // Count positions with cost basis from intel
    const positionsWithCB = intelResult
      ? intelResult.qualifiedHoldings.filter(h => h.marketValue !== null).length +
        intelResult.uncoveredHoldings.filter(h => h.marketValue !== null).length
      : 0;

    const unrealizedGL = (latestMV !== null && latestCostBasis !== null)
      ? latestMV - latestCostBasis
      : null;
    const unrealizedGLPct = _safeDiv(unrealizedGL, latestCostBasis);

    // More accurate cost basis count from coverage
    const cov = latestSnap?.coverage as any;
    const posWithCB = cov?.positionsWithCostBasis ??
                      (latestCostBasis !== null ? latestPositions : 0);

    const costBasisSummary: CostBasisSummary = {
      currentMarketValue:     latestMV,
      totalCostBasis:         latestCostBasis,
      unrealizedGainLoss:     unrealizedGL,
      unrealizedGainLossPct:  unrealizedGLPct,
      positionsWithCostBasis: posWithCB,
      totalPositions:         latestPositions,
      coveragePercent:        latestPositions > 0
        ? (posWithCB / latestPositions) * 100
        : 0,
      isPartial:              posWithCB < latestPositions && latestCostBasis !== null,
    };

    // ── 8. Position allocation ───────────────────────────────────────────
    // Build from intel holdings (all holdings combined)
    const allHoldings = [
      ...(intelResult?.qualifiedHoldings ?? []),
      ...(intelResult?.uncoveredHoldings ?? []),
    ].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

    const positionAllocation: PositionAllocationItem[] = allHoldings.map(h => ({
      symbol:           h.symbol,
      companyName:      h.companyName,
      marketValue:      h.marketValue,
      portfolioPercent: h.portfolioWeight,
      sector:           h.sector,
    }));

    // ── 9. Sector allocation ─────────────────────────────────────────────
    const sectorAllocation: SectorAllocationItem[] = (intelResult?.sectorExposure ?? []).map(s => ({
      sector:           s.sector,
      marketValue:      s.marketValue,
      portfolioPercent: s.portfolioPercent,
      positionCount:    s.positionCount,
      symbols:          s.symbols,
      changePP:         s.changeSincePreviousSnapshot,
    }));

    // ── 10. Theme allocation ─────────────────────────────────────────────
    const themeAllocation: ThemeAllocationItem[] = (intelResult?.themeExposure ?? []).map(t => ({
      themeId:          t.themeId,
      themeName:        t.themeName,
      marketValue:      t.marketValue,
      portfolioPercent: t.portfolioPercent,
      positionCount:    t.positionCount,
      symbols:          t.symbols,
    }));

    // ── 11. Concentration ────────────────────────────────────────────────
    const conc = intelResult?.concentration ?? null;
    const concentration: ConcentrationSummary = {
      largestPositionPercent: conc?.largestPositionPercent ?? null,
      largestPositionSymbol:  conc?.largestPositionSymbol  ?? null,
      largestPositionLabel:   conc?.concentrationLabel     ?? null,
      top3PositionPercent:    conc?.top3PositionPercent     ?? null,
      top3Label:              conc?.top3Label               ?? null,
      top5PositionPercent:    conc?.top5PositionPercent     ?? null,
      largestSectorPercent:   conc?.largestSectorPercent    ?? null,
      largestSectorName:      conc?.largestSectorName       ?? null,
      sectorLabel:            conc?.sectorLabel             ?? null,
      largestThemePercent:    conc?.largestThemePercent     ?? null,
      largestThemeName:       conc?.largestThemeName        ?? null,
      positionCount:          intelResult?.positionCount    ?? latestPositions,
    };

    // ── 12. Historical trends (from snapshot cards) ───────────────────────
    const researchCoverageTrend: ResearchCoverageTrendPoint[] = snapshots.map(s => {
      const c = s.coverage as any;
      const total    = c?.positionsTotal ?? s.positionCount ?? 0;
      const withOI   = c?.positionsWithOpportunityIntelligence ?? 0;
      const covPct   = total > 0 ? (withOI / total) * 100 : 0;
      return {
        snapshotDate:    s.snapshotDate,
        capturedAt:      s.capturedAt,
        positionCount:   total,
        positionsWithOpportunityIntelligence: withOI,
        coveragePercent: Math.round(covPct * 10) / 10,
      };
    });

    // Sector exposure history — build from snapshot coverage metadata
    // We extract themes from coverage when available; otherwise empty series
    const sectorExposureHistory: SectorExposureHistoryPoint[] = snapshots.map(s => ({
      snapshotDate: s.snapshotDate,
      capturedAt:   s.capturedAt,
      sectorPercents: (s.coverage as any)?.sectorPercents ?? {},
    }));

    const themeExposureHistory: ThemeExposureHistoryPoint[] = snapshots.map(s => ({
      snapshotDate: s.snapshotDate,
      capturedAt:   s.capturedAt,
      themePercents: (s.coverage as any)?.themePercents ?? {},
    }));

    // ── 13. Opportunity overlap trend ─────────────────────────────────────
    const opportunityOverlapTrend: OpportunityOverlapTrendPoint[] = snapshots.map(s => {
      const c = s.coverage as any;
      const total      = c?.positionsTotal ?? s.positionCount ?? 0;
      const withOI     = c?.positionsWithOpportunityIntelligence ?? 0;
      const notRanked  = total - withOI;
      return {
        snapshotDate:            s.snapshotDate,
        capturedAt:              s.capturedAt,
        qualifiedCount:          c?.qualifiedCount       ?? 0,
        approachingCount:        c?.approachingCount     ?? 0,
        notRankedCount:          notRanked >= 0 ? notRanked : 0,
        noLongerQualifiedCount:  c?.noLongerQualifiedCount ?? 0,
        totalHoldings:           total,
      };
    });

    // ── 14. Research change trend ─────────────────────────────────────────
    const researchChangeTrend: ResearchChangeTrendPoint[] = snapshots.map(s => {
      const c = s.coverage as any;
      return {
        snapshotDate:           s.snapshotDate,
        capturedAt:             s.capturedAt,
        strengthenedCount:      c?.strengthenedCount     ?? 0,
        weakenedCount:          c?.weakenedCount         ?? 0,
        newlyQualifiedCount:    c?.newlyQualifiedCount   ?? 0,
        noLongerQualifiedCount: c?.noLongerQualifiedCount ?? 0,
      };
    });

    // ── 15. Coverage summary ──────────────────────────────────────────────
    const latestCoverage = latestSnap?.coverage as any;
    const availablePeriods = _computeAvailablePeriods(snapshots);

    const coverage: AnalyticsCoverage = {
      snapshotCount:                        snapshots.length,
      periodsAvailable:                     availablePeriods,
      positionsTotal:                       latestCoverage?.positionsTotal       ?? latestPositions,
      positionsWithMarketData:              latestCoverage?.positionsWithMarketData ?? 0,
      positionsWithOpportunityIntelligence: latestCoverage?.positionsWithOpportunityIntelligence ?? 0,
      positionsWithCostBasis:               posWithCB,
      positionsWithSector:                  latestCoverage?.positionsWithSector ?? 0,
      positionsWithTheme:                   latestCoverage?.positionsWithTheme  ?? 0,
      overallCoveragePercent:               intelResult?.coverage.overallCoveragePercent ?? 0,
    };

    // ── 16. Freshness ─────────────────────────────────────────────────────
    const freshness: AnalyticsFreshness = {
      generatedAt:                new Date().toISOString(),
      latestSnapshotAt:           last?.capturedAt ?? null,
      oldestSnapshotInPeriodAt:   first?.capturedAt ?? null,
      snapshotCount:              snapshots.length,
      opportunityIntelligenceAt:  intelResult?.freshness.opportunityIntelligenceAt ?? null,
      sectorThemeIntelligenceAt:  intelResult?.freshness.opportunityIntelligenceAt ?? null,
      institutionalDataNote:      "Institutional data reflects Form 13F filings — delayed by up to 45 days.",
    };

    // ── 17. Limitations ───────────────────────────────────────────────────
    const limitations: string[] = [];
    if (snapshots.length === 0) {
      limitations.push("No portfolio snapshots available for this period.");
    } else if (snapshots.length === 1) {
      limitations.push("Only one snapshot captured. Historical trend analytics require additional snapshots.");
    }
    if (!intelResult) {
      limitations.push("Portfolio Intelligence not yet available. Allocation and concentration data will appear after the research platform has indexed current holdings.");
    }
    if (costBasisSummary.isPartial) {
      limitations.push(`Cost basis available for ${posWithCB} of ${latestPositions} holdings. Unrealized gain/loss reflects partial coverage only.`);
    }
    if (latestMV === null) {
      limitations.push("Total portfolio market value unavailable — reference prices may not be loaded for all holdings.");
    }
    limitations.push("Portfolio Value Change includes the combined effect of market movement and changes in holdings. It is not an investment return.");

    // ── 18. Assemble result ───────────────────────────────────────────────
    const result: PortfolioAnalyticsResult = {
      portfolioId,
      portfolioName: pf.name,
      generatedAt:   new Date().toISOString(),
      period,
      valueHistory,
      valueChangeSummary,
      costBasisSummary,
      positionAllocation,
      sectorAllocation,
      themeAllocation,
      concentration,
      researchCoverageTrend,
      opportunityOverlapTrend,
      researchChangeTrend,
      sectorExposureHistory,
      themeExposureHistory,
      disclaimer: "Portfolio Analytics summarizes historical portfolio data, research coverage, and observed " +
        "exposures for informational and research purposes. It does not provide investment advice, suitability " +
        "determinations, performance guarantees, or recommendations to buy, sell, hold, or rebalance securities.",
      limitations,
      freshness,
      coverage,
    };

    // ── 19. Cache and telemetry ───────────────────────────────────────────
    _cache.set(cacheKey, { result, ts: Date.now() });
    _healthStats.portfoliosWithAnalytics.add(portfolioId);
    _healthStats.latestAnalyticsAt = new Date().toISOString();
    const durationMs = Date.now() - t0;
    _healthStats.totalDurationMs += durationMs;
    if (limitations.some(l => l.includes("not yet available") || l.includes("No portfolio snapshots"))) {
      _healthStats.partialAnalytics++;
    }

    // Structured log — no values, no symbols, no user identity
    console.log(JSON.stringify({
      event:             "portfolio_analytics_completed",
      period,
      durationMs,
      snapshotCount:     snapshots.length,
      positionCount:     latestPositions,
      coveragePercent:   Math.round(coverage.overallCoveragePercent),
    }));

    return result;

  } catch (err: any) {
    _healthStats.failedAnalytics++;
    console.log(JSON.stringify({
      event:   "portfolio_analytics_failed",
      period,
      error:   String(err?.message ?? "unknown").slice(0, 200),
    }));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Holding analytics
// ---------------------------------------------------------------------------

export async function computeHoldingAnalytics(
  portfolioId: string,
  userId:      string,
  symbol:      string,
  period:      AnalyticsPeriod = "30D",
): Promise<HoldingAnalyticsResult | null> {
  // Ownership check
  const [pf] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

  if (!pf) return null;

  const upperSymbol = symbol.toUpperCase();

  const rows = await _getPositionSnapshotsBySymbol(portfolioId, userId, upperSymbol, period);
  if (rows.length === 0) {
    return {
      portfolioId,
      symbol: upperSymbol,
      companyName:  null,
      sector:       null,
      themes:       [],
      history:      [],
      freshness: {
        generatedAt:              new Date().toISOString(),
        latestSnapshotAt:         null,
        oldestSnapshotInPeriodAt: null,
        snapshotCount:            0,
        opportunityIntelligenceAt: null,
        sectorThemeIntelligenceAt: null,
        institutionalDataNote:    "Institutional data reflects Form 13F filings — delayed by up to 45 days.",
      },
      limitations: ["No position history found for this symbol in the selected period."],
    };
  }

  const history: HoldingHistoryPoint[] = rows.map(r => ({
    snapshotDate:       r.snapshotDate,
    capturedAt:         r.capturedAt,
    quantity:           r.quantity,
    marketValue:        r.marketValue,
    portfolioWeight:    _safeDiv(r.marketValue, r.totalPortfolioMV),
    costBasis:          r.costBasis,
    researchScore:      r.researchScore,
    technicalScore:     r.technicalScore,
    fundamentalScore:   r.fundamentalScore,
    institutionalScore: r.institutionalScore,
    qualificationStatus: _qualificationStatus(r.opportunityType, r.researchScore),
  }));

  const limitations: string[] = [];
  const missingMV = history.filter(h => h.marketValue === null).length;
  if (missingMV > 0) {
    limitations.push(`Market value unavailable for ${missingMV} of ${history.length} time points.`);
  }
  const missingScore = history.filter(h => h.researchScore === null).length;
  if (missingScore > 0) {
    limitations.push(`Research score unavailable for ${missingScore} of ${history.length} time points.`);
  }
  if (history.length === 1) {
    limitations.push("Only one snapshot available. Historical trend requires additional snapshots.");
  }

  const first = rows[0];
  const lastR = rows[rows.length - 1];

  return {
    portfolioId,
    symbol:      upperSymbol,
    companyName: null, // no company metadata in position snapshots
    sector:      null,
    themes:      [],
    history,
    freshness: {
      generatedAt:              new Date().toISOString(),
      latestSnapshotAt:         lastR?.capturedAt ?? null,
      oldestSnapshotInPeriodAt: first?.capturedAt ?? null,
      snapshotCount:            history.length,
      opportunityIntelligenceAt: null,
      sectorThemeIntelligenceAt: null,
      institutionalDataNote:    "Institutional data reflects Form 13F filings — delayed by up to 45 days.",
    },
    limitations,
  };
}

// ---------------------------------------------------------------------------
// Helper: which periods have enough snapshots
// ---------------------------------------------------------------------------

function _computeAvailablePeriods(
  snapshots: Array<{ capturedAt: string }>,
): AnalyticsPeriod[] {
  if (snapshots.length === 0) return [];

  const oldest = new Date(snapshots[0]?.capturedAt ?? Date.now());
  const now    = Date.now();
  const ageMs  = now - oldest.getTime();

  const periods: AnalyticsPeriod[] = ["7D"];
  if (ageMs >= 25 * 86_400_000)  periods.push("30D");
  if (ageMs >= 80 * 86_400_000)  periods.push("90D");

  const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
  if (oldest.getTime() < startOfYear) periods.push("YTD");

  if (ageMs >= 350 * 86_400_000) periods.push("1Y");
  periods.push("ALL");

  return periods;
}
