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
  FundPortfolioAnalytics,
  FundPortfolioQuery,
  IndustryAllocation,
  InstitutionalAnalyticsQuery,
  InstitutionalBreadth,
  InstitutionalChangeType,
  InstitutionalQuarter,
  InstitutionalQuarterLabel,
  InstitutionalQuarterNumber,
  InstitutionalQuarterSelector,
  InstitutionalScoreResult,
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
} from "./repository";

export type { FundAnalyticsService } from "./fund-analytics";
export { createFundPortfolioAnalytics } from "./fund-analytics";
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