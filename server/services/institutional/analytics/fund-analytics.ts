/**
 * Manager-level Form 13F portfolio X-ray analytics.
 *
 * This module owns pure portfolio calculations. The concrete repository
 * selects persisted effective filings; this service never calls the SEC and
 * never turns reported quarter-over-quarter changes into trade labels.
 */

import {
  classifySecurityPositionType,
  type InstitutionalSecurityPositionType,
} from "../security-position";
import { fundPortfolioXRayRepository } from "./fund-analytics-repository";
import type {
  FundPortfolioSourceSnapshot,
  FundPortfolioXRayRepository,
} from "./repository";
import type {
  AnalyticsDataQuality,
  EnrichedInstitutionalHolding,
  FundPortfolioAllocation,
  FundPortfolioClassificationCoverage,
  FundPortfolioMappingCoverage,
  FundPortfolioPositionAnalytics,
  FundPortfolioXRayAnalytics,
  FundPortfolioXRayOptions,
  FundPortfolioXRayQuarterSelector,
  InstitutionalChangeType,
  InstitutionalQuarter,
  ModelVersion,
  FundPortfolioAnalytics,
  FundPortfolioQuery,
} from "./types";
import { createInstitutionalQuarter } from "./types";

export interface FundAnalyticsService {
  getPortfolioAnalytics(
    query: FundPortfolioQuery,
  ): Promise<FundPortfolioAnalytics | null>;
}

/** Attach the calculation version without inventing unavailable source data. */
export function createFundPortfolioAnalytics(
  snapshot: FundPortfolioSourceSnapshot,
  modelVersion: ModelVersion,
): FundPortfolioAnalytics {
  return { ...snapshot, modelVersion };
}

export interface FundPortfolioXRayCalculationInput {
  managerId: string;
  managerName: string | null;
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
}

export interface FundPortfolioXRayService {
  getFundPortfolioAnalytics(
    managerId: string,
    quarter?: FundPortfolioXRayQuarterSelector,
    options?: FundPortfolioXRayOptions,
  ): Promise<FundPortfolioXRayAnalytics | null>;
}

export const FUND_PORTFOLIO_XRAY_MODEL_VERSION: ModelVersion = {
  name: "fund-portfolio-xray",
  version: "1.0.0",
};

interface PositionAccumulator {
  cusip: string;
  issuerName: string;
  reportedShares: number | null;
  reportedValue: number | null;
  metadata: EnrichedInstitutionalHolding["metadata"];
  themes: Map<string, { themeId: string; name: string }>;
  mappingResolution: EnrichedInstitutionalHolding["mappingResolution"];
  classificationStatus: EnrichedInstitutionalHolding["classificationStatus"];
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.length === 0) return 0;
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function reportedWeight(
  value: number | null,
  total: number | null,
): number | null {
  if (value === null || total === null) return null;
  if (total <= 0) return total === 0 ? 0 : null;
  return roundPercent((value / total) * 100);
}

function comparePositions(
  left: { reportedValue: number | null; name: string; cusip: string },
  right: { reportedValue: number | null; name: string; cusip: string },
): number {
  if (left.reportedValue === null && right.reportedValue !== null) return 1;
  if (left.reportedValue !== null && right.reportedValue === null) return -1;
  if (left.reportedValue !== null && right.reportedValue !== null) {
    const value = right.reportedValue - left.reportedValue;
    if (value !== 0) return value;
  }
  const name = left.name.localeCompare(right.name);
  return name !== 0 ? name : left.cusip.localeCompare(right.cusip);
}

function compareAllocations(
  left: FundPortfolioAllocation,
  right: FundPortfolioAllocation,
): number {
  if (left.portfolioWeight === null && right.portfolioWeight !== null) return 1;
  if (left.portfolioWeight !== null && right.portfolioWeight === null) return -1;
  if (left.portfolioWeight !== null && right.portfolioWeight !== null) {
    const weight = right.portfolioWeight - left.portfolioWeight;
    if (weight !== 0) return weight;
  }
  return left.name.localeCompare(right.name);
}

function mergeMetadata(
  current: EnrichedInstitutionalHolding["metadata"],
  incoming: EnrichedInstitutionalHolding["metadata"],
): EnrichedInstitutionalHolding["metadata"] {
  if (!current) return incoming;
  if (!incoming) return current;
  return {
    symbol: current.symbol,
    companyName: current.companyName ?? incoming.companyName,
    sector: current.sector ?? incoming.sector,
    industry: current.industry ?? incoming.industry,
    subIndustry: current.subIndustry ?? incoming.subIndustry,
    marketCap: current.marketCap ?? incoming.marketCap,
    exchange: current.exchange ?? incoming.exchange,
    country: current.country ?? incoming.country,
    assetType: current.assetType ?? incoming.assetType,
  };
}

function mergeMappingResolution(
  current: PositionAccumulator["mappingResolution"],
  incoming: EnrichedInstitutionalHolding["mappingResolution"],
): PositionAccumulator["mappingResolution"] {
  if (current === "ambiguous" || incoming === "ambiguous") return "ambiguous";
  if (current === "reliably_mapped" || incoming === "reliably_mapped") {
    return "reliably_mapped";
  }
  return "unmapped";
}

function mergeClassificationStatus(
  current: PositionAccumulator["classificationStatus"],
  incoming: EnrichedInstitutionalHolding["classificationStatus"],
): PositionAccumulator["classificationStatus"] {
  return current === "classified" || incoming === "classified"
    ? "classified"
    : "unclassified";
}

function matchesPositionType(
  holding: EnrichedInstitutionalHolding,
  positionType: InstitutionalSecurityPositionType,
): boolean {
  let classifiedType: InstitutionalSecurityPositionType;
  try {
    classifiedType = classifySecurityPositionType(holding.putCall);
  } catch {
    return false;
  }
  if (classifiedType !== positionType) return false;
  // Principal rows are not equity positions even when put_call is empty.
  if (
    positionType === "COMMON_EQUITY" &&
    holding.sharesPrnType?.trim().toUpperCase() === "PRN"
  ) {
    return false;
  }
  return true;
}

function aggregatePositions(
  holdings: EnrichedInstitutionalHolding[],
  positionType: InstitutionalSecurityPositionType,
): PositionAccumulator[] {
  const positions = new Map<string, PositionAccumulator>();
  for (const holding of holdings) {
    if (!matchesPositionType(holding, positionType)) continue;
    const existing = positions.get(holding.cusip);
    if (!existing) {
      const themes = new Map<string, { themeId: string; name: string }>();
      for (const theme of holding.themes) {
        themes.set(theme.themeId, { themeId: theme.themeId, name: theme.themeName });
      }
      positions.set(holding.cusip, {
        cusip: holding.cusip,
        issuerName: holding.issuerName,
        reportedShares: holding.reportedShares,
        reportedValue: holding.reportedValueDollars,
        metadata: holding.metadata,
        themes,
        mappingResolution: holding.mappingResolution,
        classificationStatus: holding.classificationStatus,
      });
      continue;
    }
    existing.reportedShares = sumNullable([
      existing.reportedShares,
      holding.reportedShares,
    ]);
    existing.reportedValue = sumNullable([
      existing.reportedValue,
      holding.reportedValueDollars,
    ]);
    existing.metadata = mergeMetadata(existing.metadata, holding.metadata);
    existing.mappingResolution = mergeMappingResolution(
      existing.mappingResolution,
      holding.mappingResolution,
    );
    existing.classificationStatus = mergeClassificationStatus(
      existing.classificationStatus,
      holding.classificationStatus,
    );
    for (const theme of holding.themes) {
      existing.themes.set(theme.themeId, {
        themeId: theme.themeId,
        name: theme.themeName,
      });
    }
  }
  const aggregated = Array.from(positions.values());
  for (const position of aggregated) {
    if (position.mappingResolution !== "reliably_mapped") {
      position.metadata = null;
      position.themes.clear();
      position.classificationStatus = "unclassified";
    }
  }
  return aggregated;
}

function totalReportedValue(positions: PositionAccumulator[]): number | null {
  if (positions.length === 0) return 0;
  return sumNullable(positions.map((position) => position.reportedValue));
}

function positiveShares(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && value > 0;
}

function classifyReportedChange(
  current: PositionAccumulator | undefined,
  previous: PositionAccumulator | undefined,
): InstitutionalChangeType | null {
  if (!current && !previous) return null;
  const currentShares = current?.reportedShares ?? null;
  const previousShares = previous?.reportedShares ?? null;
  if (positiveShares(currentShares) && !positiveShares(previousShares)) return "NEW";
  if (!positiveShares(currentShares) && positiveShares(previousShares)) return "EXITED";
  if (!positiveShares(currentShares) || !positiveShares(previousShares)) return null;
  if (currentShares! > previousShares!) return "INCREASED";
  if (currentShares! < previousShares!) return "REDUCED";
  return "UNCHANGED";
}

function buildPositionAnalytics(
  current: PositionAccumulator | undefined,
  previous: PositionAccumulator | undefined,
  previousLoaded: boolean,
  currentTotal: number | null,
  previousTotal: number | null,
): FundPortfolioPositionAnalytics {
  const source = current ?? previous!;
  const changeType = previousLoaded
    ? classifyReportedChange(current, previous)
    : null;
  const currentValue = current ? current.reportedValue : 0;
  const currentShares = current ? current.reportedShares : 0;
  const previousShares = previous?.reportedShares ?? null;
  const currentWeight = current
    ? reportedWeight(currentValue, currentTotal)
    : 0;
  const previousWeight = !previousLoaded
    ? null
    : previous
      ? reportedWeight(previous.reportedValue, previousTotal)
      : 0;
  const shareChange =
    changeType === "NEW" || changeType === null
      ? changeType === "NEW"
        ? null
        : current && previous && current.reportedShares !== null && previous.reportedShares !== null
          ? current.reportedShares - previous.reportedShares
          : null
      : (currentShares ?? 0) - (previousShares ?? 0);
  const weightChange =
    previousLoaded && currentWeight !== null && previousWeight !== null
      ? roundPercent(currentWeight - previousWeight)
      : null;
  const themes = Array.from(source.themes.values()).sort((a, b) =>
    a.name.localeCompare(b.name) || a.themeId.localeCompare(b.themeId),
  );

  return {
    cusip: source.cusip,
    symbol: source.metadata?.symbol ?? null,
    name: source.metadata?.companyName ?? source.issuerName,
    issuerName: source.issuerName,
    reportedShares: currentShares,
    reportedValue: currentValue,
    portfolioWeight: currentWeight,
    previousReportedShares: previousShares,
    reportedShareChange: shareChange,
    previousPortfolioWeight: previousWeight,
    portfolioWeightChange: weightChange,
    changeType,
    sector: source.metadata?.sector ?? null,
    industry: source.metadata?.industry ?? null,
    themeIds: themes.map((theme) => theme.themeId),
    themes,
  };
}

function allocationRows(
  groups: Map<string, {
    name: string;
    sector?: string | null;
    themeId?: string;
    values: Array<number | null>;
    positionCount: number;
  }>,
  total: number | null,
): FundPortfolioAllocation[] {
  return Array.from(groups.values())
    .map((group) => {
      const reportedValue = sumNullable(group.values);
      return {
        name: group.name,
        reportedValue,
        portfolioWeight: reportedWeight(reportedValue, total),
        positionCount: group.positionCount,
        ...(group.sector === undefined ? {} : { sector: group.sector }),
        ...(group.themeId === undefined ? {} : { themeId: group.themeId }),
      };
    })
    .sort(compareAllocations);
}

function buildAllocations(
  positions: PositionAccumulator[],
  total: number | null,
): {
  sectorAllocation: FundPortfolioAllocation[];
  industryAllocation: FundPortfolioAllocation[];
  themeAllocation: FundPortfolioAllocation[];
} {
  const sectors = new Map<string, {
    name: string;
    values: Array<number | null>;
    positionCount: number;
  }>();
  const industries = new Map<string, {
    name: string;
    sector: string | null;
    values: Array<number | null>;
    positionCount: number;
  }>();
  const themes = new Map<string, {
    name: string;
    themeId: string;
    values: Array<number | null>;
    positionCount: number;
  }>();

  for (const position of positions) {
    // Metadata classification is deliberately fail-closed. Unclassified
    // holdings remain in the reported total but not in sector/industry buckets.
    if (
      position.classificationStatus === "classified" &&
      position.metadata?.sector
    ) {
      const group = sectors.get(position.metadata.sector) ?? {
        name: position.metadata.sector,
        values: [],
        positionCount: 0,
      };
      group.values.push(position.reportedValue);
      group.positionCount += 1;
      sectors.set(position.metadata.sector, group);
    }
    if (
      position.classificationStatus === "classified" &&
      position.metadata?.industry
    ) {
      const key = `${position.metadata.sector ?? ""}::${position.metadata.industry}`;
      const group = industries.get(key) ?? {
        name: position.metadata.industry,
        sector: position.metadata.sector ?? null,
        values: [],
        positionCount: 0,
      };
      group.values.push(position.reportedValue);
      group.positionCount += 1;
      industries.set(key, group);
    }
    if (position.mappingResolution === "reliably_mapped") {
      for (const theme of Array.from(position.themes.values())) {
        const group: {
          name: string;
          themeId: string;
          values: Array<number | null>;
          positionCount: number;
        } = themes.get(theme.themeId) ?? {
            name: theme.name,
            themeId: theme.themeId,
            values: [],
            positionCount: 0,
          };
        group.values.push(position.reportedValue);
        group.positionCount += 1;
        themes.set(theme.themeId, group);
      }
    }
  }

  return {
    sectorAllocation: allocationRows(sectors, total),
    industryAllocation: allocationRows(industries, total),
    themeAllocation: allocationRows(themes, total),
  };
}

function buildMappingCoverage(
  positions: PositionAccumulator[],
): FundPortfolioMappingCoverage {
  const totalPositionCount = positions.length;
  const mappedPositionCount = positions.filter(
    (position) => position.mappingResolution === "reliably_mapped",
  ).length;
  const ambiguousPositionCount = positions.filter(
    (position) => position.mappingResolution === "ambiguous",
  ).length;
  const unmappedPositionCount =
    totalPositionCount - mappedPositionCount - ambiguousPositionCount;
  return {
    totalPositionCount,
    mappedPositionCount,
    unmappedPositionCount,
    ambiguousPositionCount,
    coveragePercent:
      totalPositionCount === 0
        ? 0
        : roundPercent((mappedPositionCount / totalPositionCount) * 100),
  };
}

function buildClassificationCoverage(
  positions: PositionAccumulator[],
): FundPortfolioClassificationCoverage {
  const totalPositionCount = positions.length;
  const classifiedPositionCount = positions.filter(
    (position) => position.classificationStatus === "classified",
  ).length;
  return {
    totalPositionCount,
    classifiedPositionCount,
    unclassifiedPositionCount: totalPositionCount - classifiedPositionCount,
    coveragePercent:
      totalPositionCount === 0
        ? 0
        : roundPercent((classifiedPositionCount / totalPositionCount) * 100),
    sectorClassifiedPositionCount: positions.filter(
      (position) =>
        position.classificationStatus === "classified" &&
        position.metadata?.sector !== null &&
        position.metadata?.sector !== undefined,
    ).length,
    industryClassifiedPositionCount: positions.filter(
      (position) =>
        position.classificationStatus === "classified" &&
        position.metadata?.industry !== null &&
        position.metadata?.industry !== undefined,
    ).length,
    themeClassifiedPositionCount: positions.filter(
      (position) => position.themes.size > 0,
    ).length,
  };
}

function buildDataQuality(
  positions: PositionAccumulator[],
  total: number | null,
  mappingCoverage: FundPortfolioMappingCoverage,
  classificationCoverage: FundPortfolioClassificationCoverage,
): AnalyticsDataQuality {
  const warnings: string[] = [];
  if (positions.some((position) => position.reportedValue === null)) {
    warnings.push("One or more reported position values are unavailable; weights may be null.");
  }
  if (mappingCoverage.unmappedPositionCount > 0) {
    warnings.push("Some reported holdings could not be reliably mapped to a symbol.");
  }
  if (mappingCoverage.ambiguousPositionCount > 0) {
    warnings.push("Some reported holdings have conflicting security mappings.");
  }
  if (classificationCoverage.unclassifiedPositionCount > 0) {
    warnings.push("Some reported holdings lack canonical classification metadata.");
  }
  return {
    status:
      positions.length === 0
        ? "insufficient"
        : mappingCoverage.coveragePercent === 100 &&
            classificationCoverage.coveragePercent === 100
          ? "complete"
          : "partial",
    coveragePercent:
      total === null ? null : mappingCoverage.coveragePercent,
    warnings,
  };
}

function sortByShareIncrease(
  positions: FundPortfolioPositionAnalytics[],
): FundPortfolioPositionAnalytics[] {
  return positions
    .filter((position) => (position.reportedShareChange ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.reportedShareChange ?? 0) - (a.reportedShareChange ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.cusip.localeCompare(b.cusip),
    );
}

function sortByShareReduction(
  positions: FundPortfolioPositionAnalytics[],
): FundPortfolioPositionAnalytics[] {
  return positions
    .filter((position) => (position.reportedShareChange ?? 0) < 0)
    .sort(
      (a, b) =>
        (a.reportedShareChange ?? 0) - (b.reportedShareChange ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.cusip.localeCompare(b.cusip),
    );
}

function sortByWeightChange(
  positions: FundPortfolioPositionAnalytics[],
  direction: "up" | "down",
): FundPortfolioPositionAnalytics[] {
  return positions
    .filter((position) =>
      direction === "up"
        ? (position.portfolioWeightChange ?? 0) > 0
        : (position.portfolioWeightChange ?? 0) < 0,
    )
    .sort((a, b) => {
      const aChange = a.portfolioWeightChange ?? 0;
      const bChange = b.portfolioWeightChange ?? 0;
      return direction === "up"
        ? bChange - aChange ||
            a.name.localeCompare(b.name) ||
            a.cusip.localeCompare(b.cusip)
        : aChange - bChange ||
            a.name.localeCompare(b.name) ||
            a.cusip.localeCompare(b.cusip);
    });
}

function limitResults(
  positions: FundPortfolioPositionAnalytics[],
  topN: number,
): FundPortfolioPositionAnalytics[] {
  return positions.slice(0, topN);
}

/**
 * Pure manager-level portfolio X-ray calculation.
 *
 * Allocation weights are percentages of the full reported portfolio value.
 * Theme exposure is intentionally overlapping: a security contributes its full
 * value to every theme membership, so theme percentages can exceed 100%.
 */
export function computeFundPortfolioXRay(
  input: FundPortfolioXRayCalculationInput,
  options: FundPortfolioXRayOptions = {},
): FundPortfolioXRayAnalytics {
  const positionType = options.positionType ?? "COMMON_EQUITY";
  const topN = Math.max(1, Math.min(100, Math.floor(options.topN ?? 20)));
  const current = aggregatePositions(input.currentHoldings, positionType);
  const previous = aggregatePositions(input.previousHoldings, positionType);
  const currentTotal = totalReportedValue(current);
  const previousTotal = totalReportedValue(previous);
  const previousLoaded = input.previousQuarter !== null;
  const previousByCusip = new Map(previous.map((position) => [position.cusip, position]));
  const currentByCusip = new Map(current.map((position) => [position.cusip, position]));
  const allCusips = previousLoaded
    ? new Set([
        ...Array.from(currentByCusip.keys()),
        ...Array.from(previousByCusip.keys()),
      ])
    : new Set(Array.from(currentByCusip.keys()));

  const positions = Array.from(allCusips).map((cusip) =>
    buildPositionAnalytics(
      currentByCusip.get(cusip),
      previousByCusip.get(cusip),
      previousLoaded,
      currentTotal,
      previousTotal,
    ),
  );
  const currentPositions = positions
    .filter((position) => currentByCusip.has(position.cusip))
    .sort(comparePositions);
  const changes = positions.filter((position) => position.changeType !== null);
  const mappingCoverage = buildMappingCoverage(current);
  const classificationCoverage = buildClassificationCoverage(current);
  const allocations = buildAllocations(current, currentTotal);
  const topNWeight = (n: number): number | null => {
    if (currentTotal === null) return null;
    if (currentTotal === 0) return 0;
    const selectedValue = currentPositions
      .slice(0, n)
      .reduce((sum, position) => sum + (position.reportedValue ?? 0), 0);
    return roundPercent((selectedValue / currentTotal) * 100);
  };
  const dataQuality = buildDataQuality(
    current,
    currentTotal,
    mappingCoverage,
    classificationCoverage,
  );

  return {
    managerId: input.managerId,
    managerName: input.managerName,
    quarter: input.quarter,
    positionType,
    reportedPortfolioValue: currentTotal,
    reportedPositionCount: current.length,
    top5Weight: topNWeight(5),
    top10Weight: topNWeight(10),
    top20Weight: topNWeight(20),
    ...allocations,
    newlyReportedCount: changes.filter((position) => position.changeType === "NEW").length,
    increasedReportedCount: changes.filter((position) => position.changeType === "INCREASED").length,
    reducedReportedCount: changes.filter((position) => position.changeType === "REDUCED").length,
    noLongerReportedCount: changes.filter((position) => position.changeType === "EXITED").length,
    largestPortfolioWeights: limitResults(currentPositions, topN),
    largestReportedShareIncreases: limitResults(sortByShareIncrease(changes), topN),
    largestReportedShareReductions: limitResults(sortByShareReduction(changes), topN),
    largestWeightIncreases: limitResults(sortByWeightChange(positions, "up"), topN),
    largestWeightDecreases: limitResults(sortByWeightChange(positions, "down"), topN),
    mappingCoverage,
    classificationCoverage,
    previousQuarter: input.previousQuarter,
    dataQuality,
    modelVersion: FUND_PORTFOLIO_XRAY_MODEL_VERSION,
  };
}

function normalizeQuarterSelector(
  quarter: FundPortfolioXRayQuarterSelector,
): FundPortfolioXRayQuarterSelector | null {
  if (typeof quarter === "object") return quarter;
  if (quarter === "latest") return quarter;
  return createInstitutionalQuarter(quarter) ? quarter : null;
}

/**
 * Concrete domain service entry point. The default repository reads only
 * persisted effective filings and enriched holdings.
 */
export async function getFundPortfolioAnalytics(
  managerId: string,
  quarter: FundPortfolioXRayQuarterSelector = "latest",
  options: FundPortfolioXRayOptions = {},
  repository: FundPortfolioXRayRepository = fundPortfolioXRayRepository,
): Promise<FundPortfolioXRayAnalytics | null> {
  const normalizedQuarter = normalizeQuarterSelector(quarter);
  if (!normalizedQuarter) return null;
  const normalizedOptions: FundPortfolioXRayOptions = {
    ...options,
    positionType: options.positionType ?? "COMMON_EQUITY",
  };
  const source = await repository.getFundPortfolioSource({
    managerId,
    quarter: normalizedQuarter,
    options: normalizedOptions,
  });
  if (!source) return null;
  const currentQuarter = createInstitutionalQuarter(source.currentFiling.periodOfReport);
  if (!currentQuarter) return null;
  const previousQuarter = source.previousFiling
    ? createInstitutionalQuarter(source.previousFiling.periodOfReport)
    : null;
  return computeFundPortfolioXRay(
    {
      managerId: source.managerId,
      managerName: source.managerName,
      quarter: currentQuarter,
      previousQuarter,
      currentHoldings: source.currentHoldings,
      previousHoldings: source.previousHoldings,
    },
    normalizedOptions,
  );
}