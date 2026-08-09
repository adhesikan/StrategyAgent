// ---------------------------------------------------------------------------
// Sprint 2.6.2 — Portfolio Analytics Types
//
// Canonical reusable types for Portfolio Analytics.
//
// ARCHITECTURE CONTRACT:
//   All values sourced from:
//     - portfolio_snapshots / portfolio_position_snapshots (existing tables)
//     - Portfolio Intelligence result (Sprint 2.6.1)
//     - Opportunity Intelligence snapshot (Sprint 2.5.0)
//
// COMPLIANCE:
//   Never: "Return", "Alpha", "Performance", "CAGR", "Sharpe", "Outperformance"
//   Always: "Portfolio Value Change", "Unrealized Gain/Loss", "Exposure Change"
//
// REUSABILITY:
//   PortfolioAnalyticsResult is designed for consumption by:
//     - Portfolio Analytics UI (Sprint 2.6.2)
//     - Research Reports (future)
//     - AI Research Workspace portfolio context (future)
//     - Trade Planning context (future)
//     - RIA Edition reporting (future)
// ---------------------------------------------------------------------------

export type AnalyticsPeriod = "7D" | "30D" | "90D" | "YTD" | "1Y" | "ALL";

// ---------------------------------------------------------------------------
// Portfolio Value History
// ---------------------------------------------------------------------------

/** One point in the portfolio value history chart. */
export interface ValueHistoryPoint {
  /** ISO date (YYYY-MM-DD from snapshot_date) */
  snapshotDate:    string;
  /** ISO timestamp of capture */
  capturedAt:      string;
  /** Total portfolio market value at capture. null if reference prices unavailable. */
  marketValue:     number | null;
  /** Total cost basis at capture. null if cost data unavailable. */
  costBasis:       number | null;
  /** Position count at this point in time */
  positionCount:   number;
  /** Source that triggered this snapshot */
  sourceType:      string;
}

/** Aggregate summary of value movement over the requested period. */
export interface ValueChangeSummary {
  /** Starting market value in the period (first snapshot). null if unavailable. */
  startingValue:         number | null;
  /** Ending market value in the period (latest snapshot). null if unavailable. */
  endingValue:           number | null;
  /** Absolute change: endingValue − startingValue. null if either is null. */
  absoluteChange:        number | null;
  /**
   * Percentage change. null if starting value is null or zero.
   * IMPORTANT DISCLOSURE: This reflects the combined effect of market movement
   * AND changes in holdings. It is NOT an investment return unless flows are
   * separately accounted for.
   */
  percentChange:         number | null;
  /** Number of snapshots in the period */
  snapshotCount:         number;
  /** First snapshot timestamp in the period */
  periodStart:           string | null;
  /** Last snapshot timestamp in the period */
  periodEnd:             string | null;
}

// ---------------------------------------------------------------------------
// Cost Basis Summary
// ---------------------------------------------------------------------------

/** Cost basis vs current market value, with partial-coverage disclosure. */
export interface CostBasisSummary {
  /** Current total market value (latest snapshot). null if unavailable. */
  currentMarketValue:    number | null;
  /** Total cost basis for positions that have cost data. null if none available. */
  totalCostBasis:        number | null;
  /** Unrealized gain/loss (currentMarketValue − totalCostBasis). */
  unrealizedGainLoss:    number | null;
  /** Unrealized gain/loss as a percent of cost basis. null if basis is null or zero. */
  unrealizedGainLossPct: number | null;
  /** Number of positions with cost basis data */
  positionsWithCostBasis: number;
  /** Total positions */
  totalPositions:        number;
  /** Fraction of positions with cost basis. 0–1. */
  coveragePercent:       number;
  /**
   * True if cost basis data is partial (not all positions have basis).
   * When true, the UI must show a partial-data disclosure.
   */
  isPartial:             boolean;
}

// ---------------------------------------------------------------------------
// Position Allocation
// ---------------------------------------------------------------------------

/** One position in the allocation chart. */
export interface PositionAllocationItem {
  symbol:           string;
  /** Company name if available */
  companyName:      string | null;
  /** Current market value from latest snapshot. null if unavailable. */
  marketValue:      number | null;
  /** Portfolio weight as a percent. null if total value is null. */
  portfolioPercent: number | null;
  /** Sector classification. null if unknown. */
  sector:           string | null;
}

// ---------------------------------------------------------------------------
// Sector & Theme Allocation (from Portfolio Intelligence)
// ---------------------------------------------------------------------------

export interface SectorAllocationItem {
  sector:           string;
  marketValue:      number | null;
  portfolioPercent: number | null;
  positionCount:    number;
  symbols:          string[];
  /** Percentage-point change vs previous snapshot. null if only one snapshot. */
  changePP:         number | null;
}

export interface ThemeAllocationItem {
  themeId:          string;
  themeName:        string;
  marketValue:      number | null;
  portfolioPercent: number | null;
  positionCount:    number;
  symbols:          string[];
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

export interface ConcentrationSummary {
  largestPositionPercent:  number | null;
  largestPositionSymbol:   string | null;
  largestPositionLabel:    string | null; // "Low" | "Moderate" | "High"
  top3PositionPercent:     number | null;
  top3Label:               string | null;
  top5PositionPercent:     number | null;
  largestSectorPercent:    number | null;
  largestSectorName:       string | null;
  sectorLabel:             string | null;
  largestThemePercent:     number | null;
  largestThemeName:        string | null;
  positionCount:           number;
}

// ---------------------------------------------------------------------------
// Historical trend series
// ---------------------------------------------------------------------------

/** One time-point in the research coverage trend. */
export interface ResearchCoverageTrendPoint {
  snapshotDate:     string;   // YYYY-MM-DD
  capturedAt:       string;
  positionCount:    number;
  positionsWithOpportunityIntelligence: number;
  coveragePercent:  number;   // 0–100
}

/** One time-point in the opportunity overlap trend. */
export interface OpportunityOverlapTrendPoint {
  snapshotDate:         string;
  capturedAt:           string;
  qualifiedCount:       number;
  approachingCount:     number;
  notRankedCount:       number;
  noLongerQualifiedCount: number;
  totalHoldings:        number;
}

/** One time-point in the research change trend. */
export interface ResearchChangeTrendPoint {
  snapshotDate:         string;
  capturedAt:           string;
  strengthenedCount:    number;
  weakenedCount:        number;
  newlyQualifiedCount:  number;
  noLongerQualifiedCount: number;
}

// ---------------------------------------------------------------------------
// Sector & theme exposure history
// ---------------------------------------------------------------------------

/** One point in a sector exposure history series. */
export interface SectorExposureHistoryPoint {
  snapshotDate:          string;
  capturedAt:            string;
  /** Map of sector → portfolioPercent */
  sectorPercents:        Record<string, number>;
}

/** One point in a theme exposure history series. */
export interface ThemeExposureHistoryPoint {
  snapshotDate:          string;
  capturedAt:            string;
  /** Map of themeId → portfolioPercent */
  themePercents:         Record<string, number>;
}

// ---------------------------------------------------------------------------
// Holding Analytics
// ---------------------------------------------------------------------------

/** One time-point in a holding's analytics history. */
export interface HoldingHistoryPoint {
  snapshotDate:     string;
  capturedAt:       string;
  quantity:         number;
  marketValue:      number | null;
  portfolioWeight:  number | null;
  costBasis:        number | null;
  researchScore:    number | null;
  technicalScore:   number | null;
  fundamentalScore: number | null;
  institutionalScore: number | null;
  qualificationStatus: "CURRENTLY_QUALIFIED" | "APPROACHING_QUALIFICATION" | "NOT_CURRENTLY_RANKED" | null;
}

/** Analytics for a single holding over time. */
export interface HoldingAnalyticsResult {
  portfolioId:      string;
  symbol:           string;
  companyName:      string | null;
  sector:           string | null;
  themes:           string[];
  history:          HoldingHistoryPoint[];
  freshness:        AnalyticsFreshness;
  limitations:      string[];
}

// ---------------------------------------------------------------------------
// Analytics freshness & coverage
// ---------------------------------------------------------------------------

export interface AnalyticsFreshness {
  generatedAt:                  string;  // ISO
  latestSnapshotAt:             string | null;
  oldestSnapshotInPeriodAt:     string | null;
  snapshotCount:                number;
  opportunityIntelligenceAt:    string | null;
  sectorThemeIntelligenceAt:    string | null;
  institutionalDataNote:        string;
}

export interface AnalyticsCoverage {
  snapshotCount:                    number;
  periodsAvailable:                 AnalyticsPeriod[];
  positionsTotal:                   number;
  positionsWithMarketData:          number;
  positionsWithOpportunityIntelligence: number;
  positionsWithCostBasis:           number;
  positionsWithSector:              number;
  positionsWithTheme:               number;
  overallCoveragePercent:           number;
}

// ---------------------------------------------------------------------------
// Canonical result — the full analytics package
// ---------------------------------------------------------------------------

/**
 * PortfolioAnalyticsResult — the canonical reusable analytics result.
 *
 * Sourced from:
 *   - portfolio_snapshots + portfolio_position_snapshots (existing tables)
 *   - Portfolio Intelligence (Sprint 2.6.1)
 *   - Opportunity Intelligence (Sprint 2.5.0)
 *
 * Contains NO investment recommendations, return calculations (without
 * transaction accounting), or opaque scores.
 *
 * PERFORMANCE TERMINOLOGY RESTRICTIONS:
 *   percentChange is "Portfolio Value Change" not "Portfolio Return".
 *   unrealizedGainLoss is permissible where cost basis is available.
 *   All chart titles must use approved terminology (§17 of spec).
 */
export interface PortfolioAnalyticsResult {
  portfolioId:   string;
  portfolioName: string;
  generatedAt:   string;
  period:        AnalyticsPeriod;

  // ── Value History ─────────────────────────────────────────────────────
  /** Historical value points for the value chart. Ordered oldest → newest. */
  valueHistory:      ValueHistoryPoint[];
  /** Summary of value movement over the period. */
  valueChangeSummary: ValueChangeSummary;

  // ── Cost Basis ────────────────────────────────────────────────────────
  costBasisSummary:  CostBasisSummary;

  // ── Current Allocation (from latest snapshot) ─────────────────────────
  /** Position allocation sorted by marketValue descending. */
  positionAllocation:  PositionAllocationItem[];
  /** Sector allocation from Portfolio Intelligence. May be empty if no intel. */
  sectorAllocation:    SectorAllocationItem[];
  /** Theme allocation from Portfolio Intelligence. May overlap — disclose. */
  themeAllocation:     ThemeAllocationItem[];

  // ── Concentration ─────────────────────────────────────────────────────
  concentration:       ConcentrationSummary;

  // ── Historical Trends ─────────────────────────────────────────────────
  researchCoverageTrend:   ResearchCoverageTrendPoint[];
  opportunityOverlapTrend: OpportunityOverlapTrendPoint[];
  researchChangeTrend:     ResearchChangeTrendPoint[];
  sectorExposureHistory:   SectorExposureHistoryPoint[];
  themeExposureHistory:    ThemeExposureHistoryPoint[];

  // ── Compliance & metadata ─────────────────────────────────────────────
  disclaimer:  string;
  limitations: string[];
  freshness:   AnalyticsFreshness;
  coverage:    AnalyticsCoverage;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface PortfolioAnalyticsResponse {
  available:   boolean;
  portfolioId: string;
  period:      AnalyticsPeriod;
  generatedAt: string;
  analytics:   PortfolioAnalyticsResult | null;
  message?:    string;
}

export interface HoldingAnalyticsResponse {
  available:   boolean;
  portfolioId: string;
  symbol:      string;
  generatedAt: string;
  analytics:   HoldingAnalyticsResult | null;
  message?:    string;
}

// ---------------------------------------------------------------------------
// Platform health extension
// ---------------------------------------------------------------------------

export interface PortfolioAnalyticsHealth {
  portfoliosWithAnalytics:  number;
  analyticsRequests:        number;
  averageAnalyticsDurationMs: number | null;
  latestAnalyticsAt:        string | null;
  partialAnalytics:         number;
}
