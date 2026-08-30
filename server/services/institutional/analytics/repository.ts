/**
 * Repository ports for Institutional Analytics.
 *
 * This module contains interfaces only. Implementations may use Drizzle and
 * PostgreSQL, but analytics services depend on these ports rather than on the
 * database directly.
 *
 * Dependency direction:
 *   route → domain service → InstitutionalAnalyticsRepository → database
 *
 * A repository returns source snapshots and persisted aggregates. It does not
 * own presentation formatting, route authorization, or React concerns.
 */

import type {
  CohortInstitutionalAnalytics,
  CohortAnalyticsQuery,
  FundPortfolioAnalytics,
  FundPortfolioQuery,
  InstitutionalTrend,
  MarketInstitutionalAnalytics,
  MarketAnalyticsQuery,
  SectorInstitutionalAnalytics,
  SectorAnalyticsQuery,
  StockInstitutionalAnalytics,
  StockAnalyticsQuery,
  TrendAnalyticsQuery,
  EnrichedInstitutionalHolding,
  EnrichedInstitutionalHoldingsQuery,
  FundPortfolioXRayQuarterSelector,
  FundPortfolioXRayOptions,
  InstitutionalMappingCoverage,
  InstitutionalQuarter,
  InstitutionalActivityRankingOptions,
  InstitutionalActivityRankingResult,
  StockInstitutionalTrendOptions,
  StockInstitutionalTrendResult,
  StockInstitutionalAnalyticsOptions,
} from "./types";

/**
 * Repository snapshots are normalized, persisted/precomputed source records.
 * They intentionally match the corresponding domain result except for the
 * model version, which is assigned by the domain service at calculation time.
 * Raw database rows must not cross this boundary.
 */
export type FundPortfolioSourceSnapshot =
  Omit<FundPortfolioAnalytics, "modelVersion">;
export type StockInstitutionalSourceSnapshot =
  Omit<StockInstitutionalAnalytics, "modelVersion">;
export type MarketInstitutionalSourceSnapshot =
  Omit<MarketInstitutionalAnalytics, "modelVersion">;
export type SectorInstitutionalSourceSnapshot =
  Omit<SectorInstitutionalAnalytics, "modelVersion">;
export type CohortInstitutionalSourceSnapshot =
  Omit<CohortInstitutionalAnalytics, "modelVersion">;
export type TrendInstitutionalSourceSnapshot = InstitutionalTrend;

export interface InstitutionalAnalyticsRepository {
  getFundPortfolioSnapshot(
    query: FundPortfolioQuery,
  ): Promise<FundPortfolioSourceSnapshot | null>;
  getStockInstitutionalSnapshot(
    query: StockAnalyticsQuery,
  ): Promise<StockInstitutionalSourceSnapshot | null>;
  getMarketSnapshot(
    query: MarketAnalyticsQuery,
  ): Promise<MarketInstitutionalSourceSnapshot | null>;
  getSectorSnapshot(
    query: SectorAnalyticsQuery,
  ): Promise<SectorInstitutionalSourceSnapshot | null>;
  getTrendSnapshot(
    query: TrendAnalyticsQuery,
  ): Promise<TrendInstitutionalSourceSnapshot | null>;
  getCohortSnapshot(
    query: CohortAnalyticsQuery,
  ): Promise<CohortInstitutionalSourceSnapshot | null>;
}

/** Data-access port for enriched holdings; implementations may use SQL or another store. */
export interface InstitutionalEnrichmentRepository {
  getEnrichedInstitutionalHoldings(
    query?: EnrichedInstitutionalHoldingsQuery,
  ): Promise<EnrichedInstitutionalHolding[]>;
  getInstitutionalMappingCoverage(
    query?: Omit<EnrichedInstitutionalHoldingsQuery, "limit" | "offset">,
  ): Promise<InstitutionalMappingCoverage>;
}

export interface EffectiveFundFiling {
  accessionNumber: string;
  managerId: string;
  managerName: string;
  periodOfReport: string;
  filingDate: string;
  isEffective: boolean;
}

/**
 * Normalized persisted common-equity aggregate. This is the authoritative
 * source for stock summary and trend metrics; holder rows remain detail-only.
 */
export interface CanonicalInstitutionalQuarterAggregate {
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  previousReportingManagerCount: number | null;
  reportingManagerCount: number;
  aggregateReportedShares: number | null;
  aggregateReportedValue: number | null;
  previousQuarterShares: number | null;
  previousQuarterValue: number | null;
  reportedSharesChange: number | null;
  reportedSharesChangePercent: number | null;
  newPositionCount: number;
  increasedPositionCount: number;
  reducedPositionCount: number;
  exitedPositionCount: number;
  unchangedCount: number;
  eligibleHoldingCount: number;
  excludedHoldingCount: number;
  coverageStatus: "complete" | "partial" | "insufficient";
}

export interface FundPortfolioXRaySource {
  managerId: string;
  managerName: string;
  currentFiling: EffectiveFundFiling;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousFiling: EffectiveFundFiling | null;
  previousHoldings: EnrichedInstitutionalHolding[];
}

export interface FundPortfolioXRayRepositoryQuery {
  managerId: string;
  quarter: FundPortfolioXRayQuarterSelector;
  options: FundPortfolioXRayOptions;
}

/**
 * The X-ray service reads a selected effective filing and its immediately
 * preceding effective filing. Implementations must not fetch SEC data here.
 */
export interface FundPortfolioXRayRepository {
  getFundPortfolioSource(
    query: FundPortfolioXRayRepositoryQuery,
  ): Promise<FundPortfolioXRaySource | null>;
}

export interface StockInstitutionalAnalyticsSource {
  symbol: string;
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  dataAsOf: string | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  managerPortfolioValues: Record<string, number | null>;
  currentFilingManagerIds: string[];
  comparableManagerIds: string[];
  /** Present only for the unfiltered common-equity universe. */
  canonicalAggregate?: CanonicalInstitutionalQuarterAggregate | null;
}

export interface StockInstitutionalRepositoryQuery {
  symbol: string;
  quarter: FundPortfolioXRayQuarterSelector;
  options: StockInstitutionalAnalyticsOptions;
}

/**
 * Stock analytics reads persisted effective filings and enriched holdings only.
 * The repository may optimize the symbol lookup, but it must preserve CUSIPs
 * and must not fetch a filing from SEC at request time.
 */
export interface StockInstitutionalRepository {
  getStockInstitutionalSource(
    query: StockInstitutionalRepositoryQuery,
  ): Promise<StockInstitutionalAnalyticsSource | null>;
}

export interface CrossFundInstitutionalAnalyticsSource {
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  dataAsOf: string | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  currentFilingManagerIds: string[];
  comparableManagerIds: string[];
}

export interface CrossFundInstitutionalRepositoryQuery {
  quarter: FundPortfolioXRayQuarterSelector;
  options: InstitutionalActivityRankingOptions;
}

export interface CrossFundInstitutionalRepository {
  getCrossFundInstitutionalSource(
    query: CrossFundInstitutionalRepositoryQuery,
  ): Promise<CrossFundInstitutionalAnalyticsSource | null>;
}

export interface StockInstitutionalTrendQuarterSource {
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  currentFilingManagerIds: string[];
  comparableManagerIds: string[];
  /** Present only for the unfiltered common-equity universe. */
  canonicalAggregate?: CanonicalInstitutionalQuarterAggregate | null;
}

export interface StockInstitutionalTrendSource {
  symbol: string;
  quarters: StockInstitutionalTrendQuarterSource[];
}

export interface StockInstitutionalTrendRepositoryQuery {
  symbol: string;
  options: StockInstitutionalTrendOptions;
}

export interface StockInstitutionalTrendRepository {
  getStockInstitutionalTrendSource(
    query: StockInstitutionalTrendRepositoryQuery,
  ): Promise<StockInstitutionalTrendSource | null>;
}