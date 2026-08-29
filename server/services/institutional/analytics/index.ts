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
  InstitutionalActivityRankingItem,
  InstitutionalActivityRankingMode,
  InstitutionalActivityRankingOptions,
  InstitutionalActivityRankingResult,
  InstitutionalActivityRankingSort,
  InstitutionalRotationClassification,
  InstitutionalRotationKind,
  InstitutionalRotationOptions,
  InstitutionalRotationResult,
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
  StockInstitutionalAnalyticsOptions,
  StockInstitutionalHolder,
  StockInstitutionalMappingCoverage,
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
  CrossFundInstitutionalAnalyticsSource,
  CrossFundInstitutionalRepository,
  CrossFundInstitutionalRepositoryQuery,
  FundPortfolioXRayRepository,
  FundPortfolioXRayRepositoryQuery,
  FundPortfolioXRaySource,
  StockInstitutionalAnalyticsSource,
  StockInstitutionalRepository,
  StockInstitutionalRepositoryQuery,
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
export {
  createStockInstitutionalAnalytics,
  computeStockInstitutionalAnalytics,
  getStockInstitutionalAnalytics,
} from "./stock-analytics";
export type {
  StockInstitutionalAnalyticsCalculationInput,
  StockInstitutionalService,
} from "./stock-analytics";
export {
  loadManagerPortfolioValues,
  loadAllStockInstitutionalHoldings,
  selectEffectiveStockFilings,
  stockInstitutionalRepository,
} from "./stock-analytics-repository";
export {
  computeCrossFundActivityRanking,
  crossFundActivityRankingService,
  getInstitutionalActivityRanking,
  getInstitutionalAccumulationRanking,
  getInstitutionalReductionRanking,
  getNewlyReportedRanking,
  getNoLongerReportedRanking,
} from "./cross-fund-analytics";
export {
  computeInstitutionalRotation,
  getIndustryRotation,
  getSectorRotation,
  getThemeRotation,
  institutionalRotationService,
} from "./rotation-analytics";
export type {
  CrossFundActivityCalculationInput,
  CrossFundActivityRankingService,
} from "./cross-fund-analytics";
export type {
  InstitutionalRotationService,
  RotationCalculationInput,
} from "./rotation-analytics";
export { crossFundInstitutionalRepository } from "./cross-fund-analytics-repository";
export type {
  EffectiveStockFilingCandidate,
  EffectiveStockFilingSelection,
} from "./stock-analytics-repository";
export type { MarketAnalyticsService } from "./market-analytics";
export { createMarketInstitutionalAnalytics } from "./market-analytics";
export type { SectorAnalyticsService } from "./sector-analytics";
export { createSectorInstitutionalAnalytics } from "./sector-analytics";
export type { TrendAnalyticsService } from "./trend-analytics";
export { createInstitutionalTrend } from "./trend-analytics";
export type { CohortAnalyticsService } from "./cohort-analytics";
export { createCohortInstitutionalAnalytics } from "./cohort-analytics";
export type { InstitutionalScoringService } from "./scoring";