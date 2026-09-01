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

export type StockViewPostIdentityZeroStage =
  | "CURRENT_PERIOD"
  | "EFFECTIVE_FILINGS"
  | "HOLDINGS_BY_CUSIP"
  | "ELIGIBLE_HOLDINGS"
  | "AGGREGATE_LOOKUP"
  | "SIGNAL_LOOKUP"
  | "HOLDER_DETAILS"
  | "AVAILABILITY_CLASSIFIER"
  | "OTHER";

/**
 * Server-only counters used to trace a valid canonical symbol through the
 * Stock View repository. These never cross the API response boundary.
 */
export interface StockViewPostIdentityDiagnostics {
  symbol: string;
  canonicalCusipCount: number;
  canonicalCusipsBoundedCount: number;
  currentPeriodSelected: number;
  effectiveFilingsSelected: number;
  holdingRowsByCanonicalCusips: number;
  eligibleHoldingRows: number;
  aggregateRows: number;
  signalRows: number | null;
  holderDetailRows: number;
  finalAvailability: string | null;
  firstPostIdentityZeroStage: StockViewPostIdentityZeroStage | null;
}

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
  /** EDGAR acceptance timestamp used to rank competing effective filings. */
  acceptedAt?: string | null;
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
  /** Candidate CUSIPs discovered from target-specific identity evidence, including unresolved evidence. */
  candidateCusips?: string[];
  /** True only when reviewed/exact evidence reliably identifies the requested symbol. */
  hasReliableSecurityIdentity?: boolean;
  /** True when any source associates a candidate CUSIP with the target, even if it remains unresolved. */
  hasTargetSpecificCandidateEvidence?: boolean;
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
  /** Server-only trace counters; omitted from the public analytics result. */
  stockViewDiagnostics?: StockViewPostIdentityDiagnostics;
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