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
  reportingManagerCount: number;
  aggregateReportedShares: number | null;
  aggregateReportedValueDollars: number | null;
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

export interface InstitutionalAnalyticsQuery {
  quarter?: InstitutionalQuarterSelector;
}

export interface FundPortfolioQuery extends InstitutionalAnalyticsQuery {
  managerId: string;
}

export interface StockAnalyticsQuery extends InstitutionalAnalyticsQuery {
  symbol: string;
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
  cohortId: string;
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