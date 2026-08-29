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