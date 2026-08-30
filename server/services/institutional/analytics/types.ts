/**
 * Institutional Analytics domain vocabulary.
 *
 * This file is intentionally server-only and dependency-light. It describes
 * the stable language shared by future analytics services and their consumers;
 * it does not read the database and it does not contain UI-specific shapes.
 *
 * Dependency direction:
 *   routes/controllers → analytics domain services → repository port → database
 *
 * React components must consume completed domain results and must not calculate
 * institutional analytics themselves.
 */

import { parseQuarterIdentifier } from "../quarter-utils";
import type { SecurityPositionType } from "./security-types";
import type { InstitutionalManagerCohort } from "../manager-cohort-types";

export type { InstitutionalManagerCohort } from "../manager-cohort-types";

export const INSTITUTIONAL_ANALYTICS_LAYER = "institutional-analytics" as const;

export type InstitutionalQuarterNumber = 1 | 2 | 3 | 4;
export type InstitutionalQuarterLabel =
  `${number}-Q${InstitutionalQuarterNumber}`;

export interface InstitutionalQuarter {
  year: number;
  quarter: InstitutionalQuarterNumber;
  label: InstitutionalQuarterLabel;
  periodEndDate: string;
}

export type InstitutionalQuarterSelector = InstitutionalQuarter | "latest";

export type InstitutionalChangeType =
  | "NEW"
  | "INCREASED"
  | "UNCHANGED"
  | "REDUCED"
  | "EXITED";

export interface ModelVersion {
  name: string;
  version: string;
}

export interface AnalyticsDataQuality {
  status: "complete" | "partial" | "insufficient" | "unavailable";
  coveragePercent: number | null;
  warnings: string[];
}

export interface PortfolioPositionSummary {
  securityPositionType: SecurityPositionType;
  positionCount: number;
  reportedValueDollars: number | null;
  reportedShares: number | null;
}

export interface FundPortfolioAnalytics {
  managerId: string;
  managerName: string | null;
  quarter: InstitutionalQuarter;
  reportedPortfolioValueDollars: number | null;
  reportedPositionCount: number;
  positionsByType: PortfolioPositionSummary[];
  largestPositions: Array<{
    symbol: string | null;
    issuerName: string;
    reportedValueDollars: number | null;
    portfolioWeightPercent: number | null;
    /** Null when no comparable prior-quarter position was loaded. */
    changeType: InstitutionalChangeType | null;
  }>;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface SectorAllocation {
  sector: string;
  reportedValueDollars: number | null;
  portfolioWeightPercent: number | null;
  positionCount: number;
  managerCount: number;
  changeType: InstitutionalChangeType | null;
}

export interface IndustryAllocation {
  industry: string;
  sector: string | null;
  reportedValueDollars: number | null;
  portfolioWeightPercent: number | null;
  positionCount: number;
  managerCount: number;
  changeType: InstitutionalChangeType | null;
}

export interface ThemeAllocation {
  themeId: string;
  themeName: string;
  reportedValueDollars: number | null;
  portfolioWeightPercent: number | null;
  positionCount: number;
  managerCount: number;
  changeType: InstitutionalChangeType | null;
}

export interface StockInstitutionalAnalytics {
  symbol: string;
  quarter: InstitutionalQuarter;
  /** Quarter-end date represented by the reported holdings. */
  dataAsOf: string | null;
  reportingManagerCount: number;
  reportedHolderCount: number;
  previousReportedHolderCount: number | null;
  holderCountChange: number | null;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  unchangedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  aggregateReportedShares: number | null;
  previousAggregateReportedShares: number | null;
  aggregateReportedShareChange: number | null;
  aggregateReportedShareChangePct: number | null;
  aggregateReportedValueDollars: number | null;
  averagePortfolioWeight: number | null;
  medianPortfolioWeight: number | null;
  topReportedHolders: StockInstitutionalHolder[];
  largestNewlyReportedPositions: StockInstitutionalHolder[];
  largestReportedShareIncreases: StockInstitutionalHolder[];
  largestReportedShareReductions: StockInstitutionalHolder[];
  noLongerReportedPositions: StockInstitutionalHolder[];
  mappingCoverage: StockInstitutionalMappingCoverage;
  managerChangeCounts: {
    new: number;
    increased: number;
    unchanged: number;
    reduced: number;
    exited: number;
  };
  breadth: InstitutionalBreadth | null;
  trend: InstitutionalTrend | null;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface StockInstitutionalHolder {
  managerId: string;
  managerName: string;
  /** A holder can report multiple CUSIPs that resolve to this symbol. */
  cusip: string | null;
  cusips: string[];
  symbol: string;
  issuerName: string;
  reportedShares: number | null;
  previousReportedShares: number | null;
  reportedShareChange: number | null;
  reportedShareChangePct: number | null;
  reportedValueDollars: number | null;
  portfolioWeight: number | null;
  changeType: InstitutionalChangeType | null;
}

export interface StockInstitutionalMappingCoverage {
  candidateHoldingCount: number;
  reliablyMappedHoldingCount: number;
  unmappedHoldingCount: number;
  ambiguousHoldingCount: number;
  classificationUnavailableHoldingCount: number;
  coveragePercent: number;
}

export interface StockInstitutionalAnalyticsOptions {
  /** Defaults to COMMON_EQUITY. PUT and CALL remain separate. */
  positionType?: SecurityPositionType;
  /** Bounds each returned holder/change list. Defaults to 20. */
  topN?: number;
  /** Restrict effective filing managers to an active curated cohort. */
  cohort?: InstitutionalManagerCohort;
}

export interface InstitutionalBreadth {
  /** The entity counted by this breadth result. */
  scope: "managers" | "symbols";
  totalEntityCount: number;
  increasingEntityCount: number;
  decreasingEntityCount: number;
  newEntityCount: number;
  exitedEntityCount: number;
  breadthRatio: number | null;
  direction: "broadening" | "narrowing" | "balanced" | "unavailable";
}

export interface InstitutionalTrend {
  direction:
    | "accumulating"
    | "distributing"
    | "stable"
    | "broadening"
    | "narrowing"
    | "insufficient_data";
  currentQuarter: InstitutionalQuarter;
  comparisonQuarter: InstitutionalQuarter | null;
  observations: number;
  confidence: "high" | "moderate" | "limited" | "insufficient";
}

export interface ScoreComponent {
  key: string;
  label: string;
  value: number | null;
  weight: number;
  available: boolean;
  explanation: string | null;
}

export interface InstitutionalScoreResult {
  score: number | null;
  components: ScoreComponent[];
  status: "available" | "insufficient_data" | "unavailable";
  modelVersion: ModelVersion;
  limitations: string[];
}

export type InstitutionalAccumulationComponentKey =
  | "breadthChange"
  | "reportedShareChange"
  | "newManagerBreadth"
  | "increaseReductionBalance"
  | "multiQuarterPersistence"
  | "portfolioWeightChange";

export type InstitutionalAccumulationInsufficientDataFlag =
  | "MISSING_DATA_QUARTER"
  | "DATA_QUALITY_INSUFFICIENT"
  | "MISSING_BREADTH_CHANGE"
  | "MISSING_REPORTED_SHARE_CHANGE"
  | "MISSING_NEW_MANAGER_BREADTH"
  | "MISSING_INCREASE_REDUCTION_BALANCE"
  | "MISSING_MULTI_QUARTER_PERSISTENCE"
  | "MISSING_PORTFOLIO_WEIGHT_CHANGE"
  | "INSUFFICIENT_AVAILABLE_WEIGHT";

export interface InstitutionalAccumulationScoreComponent {
  rawValue: number | null;
  score: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  weightedContribution: number | null;
  available: boolean;
  explanation: string;
}

export interface InstitutionalAccumulationScoreInput {
  breadthChangePct: number | null;
  aggregateReportedShareChangePct: number | null;
  newlyReportedManagerBreadthPct: number | null;
  increaseReductionBalance: number | null;
  multiQuarterPersistencePct: number | null;
  portfolioWeightChangePctPoints: number | null;
  dataQuarter: InstitutionalQuarter | null;
  dataAsOf: string | null;
  dataQuality: AnalyticsDataQuality;
}

export interface InstitutionalAccumulationScoreResult {
  score: number | null;
  modelVersion: "institutional_accumulation_v1";
  components: Record<
    InstitutionalAccumulationComponentKey,
    InstitutionalAccumulationScoreComponent
  >;
  componentScores: Record<
    InstitutionalAccumulationComponentKey,
    number | null
  >;
  weights: Record<InstitutionalAccumulationComponentKey, number>;
  dataQuarter: InstitutionalQuarter | null;
  dataAsOf: string | null;
  dataQuality: AnalyticsDataQuality;
  insufficientData: boolean;
  insufficientDataFlags: InstitutionalAccumulationInsufficientDataFlag[];
}

export interface MarketInstitutionalAnalytics {
  quarter: InstitutionalQuarter;
  coveredSymbolCount: number;
  breadth: InstitutionalBreadth;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface SectorInstitutionalAnalytics {
  quarter: InstitutionalQuarter;
  sectors: SectorAllocation[];
  industries: IndustryAllocation[];
  themes: ThemeAllocation[];
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface CohortInstitutionalAnalytics {
  cohortId: string;
  quarter: InstitutionalQuarter;
  memberSymbolCount: number;
  aggregateReportedValueDollars: number | null;
  reportingManagerCount: number;
  breadth: InstitutionalBreadth | null;
  trend: InstitutionalTrend | null;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export type EnrichmentMappingResolution =
  | "reliably_mapped"
  | "unmapped"
  | "ambiguous";

export type EnrichmentClassificationStatus = "classified" | "unclassified";
export type EnrichmentMetadataResolution = "canonical" | "partial" | "unavailable";

export interface InstitutionalThemeMembership {
  themeId: string;
  themeName: string;
  description: string | null;
  classificationMethod: string;
}

export interface InstitutionalSecurityMetadata {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  subIndustry: string | null;
  marketCap: number | null;
  exchange: string | null;
  country: string | null;
  assetType: string | null;
}

export interface EnrichedInstitutionalHolding {
  holdingId: string;
  accessionNumber: string;
  filerCik: string;
  filerName: string;
  issuerName: string;
  cusip: string;
  periodOfReport: string;
  reportedValueDollars: number | null;
  reportedShares: number | null;
  /** SH = shares; PRN = principal amount and is not common equity. */
  sharesPrnType?: string | null;
  securityPositionType: string | null;
  putCall: string | null;
  mappingResolution: EnrichmentMappingResolution;
  metadataResolution: EnrichmentMetadataResolution;
  classificationStatus: EnrichmentClassificationStatus;
  /** Why a holding is not usable in symbol-based analytics, when applicable. */
  unclassifiedReason: "unmapped" | "ambiguous" | "metadata_unavailable" | null;
  metadata: InstitutionalSecurityMetadata | null;
  themes: InstitutionalThemeMembership[];
}

export type FundPortfolioXRayQuarterSelector =
  | InstitutionalQuarter
  | InstitutionalQuarterLabel
  | "latest";

export interface FundPortfolioXRayOptions {
  /** Defaults to COMMON_EQUITY. PUT and CALL remain independently selectable. */
  positionType?: SecurityPositionType;
  /** Bounds each returned largest-* list. Defaults to 20. */
  topN?: number;
}

export interface FundPortfolioAllocation {
  /** Sector, industry, or theme display name. */
  name: string;
  /** Canonical reported US dollars; null when any contributing value is unavailable. */
  reportedValue: number | null;
  /** Percentage of the reported portfolio value, not a fraction. */
  portfolioWeight: number | null;
  /** Distinct CUSIP positions contributing to this allocation. */
  positionCount: number;
  /** Present on industry allocations to preserve sector context. */
  sector?: string | null;
  /** Present on theme allocations to identify the normalized theme. */
  themeId?: string;
}

export interface FundPortfolioPositionAnalytics {
  cusip: string;
  symbol: string | null;
  name: string;
  issuerName: string;
  reportedShares: number | null;
  reportedValue: number | null;
  portfolioWeight: number | null;
  previousReportedShares: number | null;
  reportedShareChange: number | null;
  previousPortfolioWeight: number | null;
  portfolioWeightChange: number | null;
  changeType: InstitutionalChangeType | null;
  sector: string | null;
  industry: string | null;
  themeIds: string[];
  themes: Array<{ themeId: string; name: string }>;
}

export interface FundPortfolioMappingCoverage {
  totalPositionCount: number;
  mappedPositionCount: number;
  unmappedPositionCount: number;
  ambiguousPositionCount: number;
  coveragePercent: number;
}

export interface FundPortfolioClassificationCoverage {
  totalPositionCount: number;
  classifiedPositionCount: number;
  unclassifiedPositionCount: number;
  coveragePercent: number;
  sectorClassifiedPositionCount: number;
  industryClassifiedPositionCount: number;
  themeClassifiedPositionCount: number;
}

export interface FundPortfolioXRayAnalytics {
  managerId: string;
  managerName: string | null;
  quarter: InstitutionalQuarter;
  positionType: SecurityPositionType;
  reportedPortfolioValue: number | null;
  reportedPositionCount: number;
  top5Weight: number | null;
  top10Weight: number | null;
  top20Weight: number | null;
  sectorAllocation: FundPortfolioAllocation[];
  industryAllocation: FundPortfolioAllocation[];
  /**
   * Theme exposure is intentionally overlapping: one security can contribute
   * its full reported value to multiple themes, so theme weights may sum above
   * 100%. Sector and industry allocations are mutually exclusive buckets.
   */
  themeAllocation: FundPortfolioAllocation[];
  newlyReportedCount: number;
  increasedReportedCount: number;
  reducedReportedCount: number;
  noLongerReportedCount: number;
  largestPortfolioWeights: FundPortfolioPositionAnalytics[];
  largestReportedShareIncreases: FundPortfolioPositionAnalytics[];
  largestReportedShareReductions: FundPortfolioPositionAnalytics[];
  largestWeightIncreases: FundPortfolioPositionAnalytics[];
  largestWeightDecreases: FundPortfolioPositionAnalytics[];
  mappingCoverage: FundPortfolioMappingCoverage;
  classificationCoverage: FundPortfolioClassificationCoverage;
  previousQuarter: InstitutionalQuarter | null;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface FundPortfolioXRayQuery {
  managerId: string;
  quarter?: FundPortfolioXRayQuarterSelector;
  options?: FundPortfolioXRayOptions;
}

export interface EnrichedInstitutionalHoldingsQuery {
  accessionNumber?: string;
  accessionNumbers?: string[];
  cusips?: string[];
  periodOfReport?: string;
  periodOfReports?: string[];
  /** Restrict the SQL candidate set to evidence that may resolve to this symbol. */
  symbol?: string;
  limit?: number;
  offset?: number;
}

export interface InstitutionalMappingCoverage {
  totalHoldingCount: number;
  reliablyMappedHoldingCount: number;
  unmappedHoldingCount: number;
  ambiguousHoldingCount: number;
  unclassifiedHoldingCount: number;
  symbolCoveragePercent: number;
  sectorEnrichedHoldingCount: number;
  industryEnrichedHoldingCount: number;
  themeEnrichedHoldingCount: number;
  sectorCoveragePercent: number;
  industryCoveragePercent: number;
  themeCoveragePercent: number;
}

export interface InstitutionalAnalyticsQuery {
  quarter?: InstitutionalQuarterSelector;
}

export interface FundPortfolioQuery extends InstitutionalAnalyticsQuery {
  managerId: string;
}

export interface StockAnalyticsQuery extends InstitutionalAnalyticsQuery {
  symbol: string;
}

export type InstitutionalActivityRankingMode =
  | "ACCUMULATION"
  | "REDUCTION"
  | "NEWLY_REPORTED"
  | "NO_LONGER_REPORTED";

export type InstitutionalActivityRankingSort =
  | "netHolderIncrease"
  | "newHolderCount"
  | "increasedHolderCount"
  | "aggregateShareIncreasePct"
  | "aggregateShareIncrease"
  | "reportedValue";

export interface InstitutionalActivityRankingOptions {
  quarter?: FundPortfolioXRayQuarterSelector;
  sector?: string;
  industry?: string;
  theme?: string;
  marketCapMin?: number;
  marketCapMax?: number;
  /** Minimum managers in the selected activity category/categories. */
  minManagers?: number;
  minReportedValue?: number;
  positionType?: SecurityPositionType;
  sortBy?: InstitutionalActivityRankingSort;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
  /** Restrict effective filing managers to an active curated cohort. */
  cohort?: InstitutionalManagerCohort;
}

export interface InstitutionalActivityRankingItem {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  currentReportedHolderCount: number;
  previousReportedHolderCount: number | null;
  holderCountChange: number | null;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  unchangedReportedHolderCount: number;
  netHolderIncrease: number | null;
  aggregateReportedShares: number | null;
  previousAggregateReportedShares: number | null;
  aggregateReportedShareChange: number | null;
  aggregateReportedShareChangePct: number | null;
  aggregateReportedValue: number | null;
  increaseToReductionRatio: number | null;
  /** Distinct CUSIPs retained while aggregating this symbol. */
  cusips: string[];
}

export interface InstitutionalActivityRankingResult {
  mode: InstitutionalActivityRankingMode;
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  sortBy: InstitutionalActivityRankingSort;
  sortDirection: "asc" | "desc";
  items: InstitutionalActivityRankingItem[];
  totalCount: number;
  limit: number;
  offset: number;
  trackedManagerCount: number;
  comparableManagerCount: number;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export type InstitutionalRotationKind = "SECTOR" | "INDUSTRY" | "THEME";

export interface InstitutionalRotationOptions {
  quarter?: FundPortfolioXRayQuarterSelector;
  /** Defaults to COMMON_EQUITY; options remain independently selectable. */
  positionType?: SecurityPositionType;
  /** Restrict effective filing managers to an active curated cohort. */
  cohort?: InstitutionalManagerCohort;
}

export interface InstitutionalRotationClassification {
  quarter: InstitutionalQuarter;
  /** Sector, industry, or theme display name. */
  classification: string;
  /** Present for theme rows so callers can retain the canonical theme identity. */
  classificationId?: string;
  currentReportedValue: number | null;
  previousReportedValue: number | null;
  reportedValueChange: number | null;
  reportedValueChangePct: number | null;
  /** Null for option rows, where underlying-share aggregation is not meaningful. */
  currentReportedShares: number | null;
  managerCount: number;
  previousManagerCount: number | null;
  managerCountChange: number | null;
  newlyReportedPositionCount: number;
  increasedReportedPositionCount: number;
  reducedReportedPositionCount: number;
  noLongerReportedPositionCount: number;
}

export interface InstitutionalRotationResult {
  kind: InstitutionalRotationKind;
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  classifications: InstitutionalRotationClassification[];
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface StockInstitutionalTrendOptions {
  quarter?: FundPortfolioXRayQuarterSelector;
  /** Number of consecutive quarters to request; defaults to 8 and is capped at 8. */
  historyQuarters?: number;
  /** Defaults to COMMON_EQUITY; PUT and CALL remain separate. */
  positionType?: SecurityPositionType;
  /** Restrict effective filing managers to an active curated cohort. */
  cohort?: InstitutionalManagerCohort;
}

export interface StockInstitutionalTrendQuarter {
  quarter: InstitutionalQuarter;
  reportedHolderCount: number;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  aggregateReportedShares: number | null;
  aggregateReportedValue: number | null;
  /** Current holder count minus the comparable prior-quarter holder count. */
  breadthChange: number | null;
  /** Reported share change percentage; null when the prior share denominator is zero. */
  shareTrend: number | null;
  /** Unchanged comparable managers as a percentage of comparable managers. */
  persistence: number | null;
  /** (new + increased - reduced - exited) / all directional changes. */
  increaseReductionBalance: number | null;
  hasComparablePriorQuarter: boolean;
}

export type StockInstitutionalTrendClassification =
  | "ACCELERATING_ACCUMULATION"
  | "ACCUMULATION"
  | "STABLE"
  | "DISTRIBUTION"
  | "ACCELERATING_DISTRIBUTION"
  | "INSUFFICIENT_DATA";

export interface StockInstitutionalTrendResult {
  symbol: string;
  quarters: StockInstitutionalTrendQuarter[];
  classification: StockInstitutionalTrendClassification;
  dataQuality: AnalyticsDataQuality;
  modelVersion: ModelVersion;
}

export interface MarketAnalyticsQuery extends InstitutionalAnalyticsQuery {
  universe?: string;
}

export interface SectorAnalyticsQuery extends InstitutionalAnalyticsQuery {
  sector?: string;
}

export interface TrendAnalyticsQuery extends InstitutionalAnalyticsQuery {
  symbol?: string;
  managerId?: string;
}

export interface CohortAnalyticsQuery extends InstitutionalAnalyticsQuery {
  cohortId: InstitutionalManagerCohort;
}

/**
 * Convert a supported external/database quarter identifier to the domain
 * object. "latest" remains a selector and is intentionally not coerced to a
 * fabricated date.
 */
export function createInstitutionalQuarter(
  value: string | null | undefined,
): InstitutionalQuarter | null {
  const parsed = parseQuarterIdentifier(value);
  if (!parsed || parsed.kind === "latest") return null;
  return {
    year: parsed.year,
    quarter: parsed.quarter,
    label: parsed.identifier,
    periodEndDate: parsed.periodEndDate,
  };
}