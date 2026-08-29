/**
 * Public server-side entry point for the Institutional Analytics domain.
 *
 * Do not import this barrel from React. Route/controller code should compose
 * concrete services around these contracts; database adapters should implement
 * repository.ts separately.
 */

export { INSTITUTIONAL_ANALYTICS_LAYER, createInstitutionalQuarter } from "./types";
export type {
  AnalyticsDataQuality,
  CohortAnalyticsQuery,
  CohortInstitutionalAnalytics,
  EnrichedInstitutionalHolding,
  EnrichedInstitutionalHoldingsQuery,
  EnrichmentMetadataResolution,
  FundPortfolioAnalytics,
  FundPortfolioAllocation,
  FundPortfolioClassificationCoverage,
  FundPortfolioMappingCoverage,
  FundPortfolioPositionAnalytics,
  FundPortfolioQuery,
  FundPortfolioXRayAnalytics,
  FundPortfolioXRayOptions,
  FundPortfolioXRayQuery,
  FundPortfolioXRayQuarterSelector,
  IndustryAllocation,
  InstitutionalAnalyticsQuery,
  InstitutionalBreadth,
  InstitutionalChangeType,
  InstitutionalMappingCoverage,
  InstitutionalQuarter,
  InstitutionalQuarterLabel,
  InstitutionalQuarterNumber,
  InstitutionalQuarterSelector,
  InstitutionalScoreResult,
  InstitutionalSecurityMetadata,
  InstitutionalThemeMembership,
  InstitutionalTrend,
  MarketInstitutionalAnalytics,
  MarketAnalyticsQuery,
  ModelVersion,
  PortfolioPositionSummary,
  ScoreComponent,
  SectorAllocation,
  SectorAnalyticsQuery,
  SectorInstitutionalAnalytics,
  StockAnalyticsQuery,
  StockInstitutionalAnalytics,
  ThemeAllocation,
  TrendAnalyticsQuery,
} from "./types";

export {
  classifySecurityPositionType,
  isCommonEquityPosition,
} from "./security-types";
export type {
  InstitutionalSecurityPositionType,
  SecurityPositionType,
} from "./security-types";

export type {
  CohortInstitutionalSourceSnapshot,
  FundPortfolioSourceSnapshot,
  InstitutionalAnalyticsRepository,
  MarketInstitutionalSourceSnapshot,
  SectorInstitutionalSourceSnapshot,
  StockInstitutionalSourceSnapshot,
  TrendInstitutionalSourceSnapshot,
  InstitutionalEnrichmentRepository,
  EffectiveFundFiling,
  FundPortfolioXRayRepository,
  FundPortfolioXRayRepositoryQuery,
  FundPortfolioXRaySource,
} from "./repository";

export {
  buildEnrichedInstitutionalHolding,
  computeInstitutionalMappingCoverage,
  resolveReliableSecurityMapping,
} from "./security-enrichment";
export type {
  EnrichmentHoldingInput,
  ReliableMappingResolution,
  SecurityMappingEvidence,
} from "./security-enrichment";

export type { FundAnalyticsService } from "./fund-analytics";
export {
  computeFundPortfolioXRay,
  createFundPortfolioAnalytics,
  getFundPortfolioAnalytics,
} from "./fund-analytics";
export type {
  FundPortfolioXRayCalculationInput,
  FundPortfolioXRayService,
} from "./fund-analytics";
export {
  fundPortfolioXRayRepository,
  selectEffectiveFundFilings,
} from "./fund-analytics-repository";
export type { EffectiveFundFilingCandidate } from "./fund-analytics-repository";
export type { StockAnalyticsService } from "./stock-analytics";
export { createStockInstitutionalAnalytics } from "./stock-analytics";
export type { MarketAnalyticsService } from "./market-analytics";
export { createMarketInstitutionalAnalytics } from "./market-analytics";
export type { SectorAnalyticsService } from "./sector-analytics";
export { createSectorInstitutionalAnalytics } from "./sector-analytics";
export type { TrendAnalyticsService } from "./trend-analytics";
export { createInstitutionalTrend } from "./trend-analytics";
export type { CohortAnalyticsService } from "./cohort-analytics";
export { createCohortInstitutionalAnalytics } from "./cohort-analytics";
export type { InstitutionalScoringService } from "./scoring";