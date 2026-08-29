/**
 * Stock-level institutional analytics across tracked Form 13F managers.
 *
 * The calculations describe persisted reported holdings only. They do not
 * infer exact trading activity or total institutional ownership of a company.
 */

import {
  classifySecurityPositionType,
  type InstitutionalSecurityPositionType,
} from "../security-position";
import { stockInstitutionalRepository } from "./stock-analytics-repository";
import type {
  StockInstitutionalAnalyticsSource,
  StockInstitutionalRepository,
} from "./repository";
import type {
  AnalyticsDataQuality,
  EnrichedInstitutionalHolding,
  InstitutionalBreadth,
  InstitutionalChangeType,
  InstitutionalTrend,
  ModelVersion,
  StockAnalyticsQuery,
  StockInstitutionalAnalytics,
  StockInstitutionalAnalyticsOptions,
  StockInstitutionalHolder,
  StockInstitutionalMappingCoverage,
} from "./types";
import type { StockInstitutionalSourceSnapshot as LegacyStockInstitutionalSourceSnapshot } from "./repository";
import type { FundPortfolioXRayQuarterSelector } from "./types";

export interface StockAnalyticsService {
  getStockAnalytics(
    query: StockAnalyticsQuery,
  ): Promise<StockInstitutionalAnalytics | null>;
}

/** Attach the calculation version without inventing unavailable source data. */
export function createStockInstitutionalAnalytics(
  snapshot: LegacyStockInstitutionalSourceSnapshot,
  modelVersion: ModelVersion,
): StockInstitutionalAnalytics {
  return { ...snapshot, modelVersion };
}

export interface StockInstitutionalAnalyticsCalculationInput {
  symbol: string;
  quarter: StockInstitutionalAnalyticsSource["quarter"];
  previousQuarter: StockInstitutionalAnalyticsSource["previousQuarter"];
  dataAsOf: string | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  managerPortfolioValues: Record<string, number | null>;
  currentFilingManagerIds: string[];
  comparableManagerIds: string[];
}

export interface StockInstitutionalService {
  getStockInstitutionalAnalytics(
    symbol: string,
    quarter?: FundPortfolioXRayQuarterSelector,
    options?: StockInstitutionalAnalyticsOptions,
  ): Promise<StockInstitutionalAnalytics | null>;
}

export const STOCK_INSTITUTIONAL_MODEL_VERSION: ModelVersion = {
  name: "stock-institutional-analytics",
  version: "1.0.0",
};

interface ManagerPosition {
  managerId: string;
  managerName: string;
  issuerName: string;
  cusips: Set<string>;
  reportedShares: number | null;
  reportedValue: number | null;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function matchesPositionType(
  holding: EnrichedInstitutionalHolding,
  positionType: InstitutionalSecurityPositionType,
): boolean {
  let classified: InstitutionalSecurityPositionType;
  try {
    classified = classifySecurityPositionType(holding.putCall);
  } catch {
    return false;
  }
  if (classified !== positionType) return false;
  return !(
    positionType === "COMMON_EQUITY" &&
    holding.sharesPrnType?.trim().toUpperCase() === "PRN"
  );
}

function isRequestedSymbol(
  holding: EnrichedInstitutionalHolding,
  symbol: string,
): boolean {
  return (
    holding.mappingResolution === "reliably_mapped" &&
    holding.metadata?.symbol.trim().toUpperCase() === symbol
  );
}

function aggregateByManager(
  holdings: EnrichedInstitutionalHolding[],
  symbol: string,
  positionType: InstitutionalSecurityPositionType,
): Map<string, ManagerPosition> {
  const positions = new Map<string, ManagerPosition>();
  for (const holding of holdings) {
    if (!matchesPositionType(holding, positionType)) continue;
    if (!isRequestedSymbol(holding, symbol)) continue;
    if (holding.reportedShares === null || holding.reportedShares <= 0) continue;
    const current = positions.get(holding.filerCik);
    if (!current) {
      positions.set(holding.filerCik, {
        managerId: holding.filerCik,
        managerName: holding.filerName,
        issuerName: holding.issuerName,
        cusips: new Set([holding.cusip]),
        reportedShares: holding.reportedShares,
        reportedValue: holding.reportedValueDollars,
      });
      continue;
    }
    current.cusips.add(holding.cusip);
    current.reportedShares = sumNullable([
      current.reportedShares,
      holding.reportedShares,
    ]);
    current.reportedValue = sumNullable([
      current.reportedValue,
      holding.reportedValueDollars,
    ]);
  }
  return positions;
}

function classifyChange(
  current: ManagerPosition | undefined,
  previous: ManagerPosition | undefined,
  comparable: boolean,
): InstitutionalChangeType | null {
  if (!comparable) return null;
  if (current && !previous) return "NEW";
  if (!current && previous) return "EXITED";
  if (!current || !previous) return null;
  if (current.reportedShares === null || previous.reportedShares === null) {
    return null;
  }
  if (current.reportedShares > previous.reportedShares) return "INCREASED";
  if (current.reportedShares < previous.reportedShares) return "REDUCED";
  return "UNCHANGED";
}

function portfolioWeight(
  reportedValue: number | null,
  portfolioValue: number | null | undefined,
): number | null {
  if (
    reportedValue === null ||
    portfolioValue === null ||
    portfolioValue === undefined ||
    portfolioValue <= 0
  ) {
    return null;
  }
  return roundPercent((reportedValue / portfolioValue) * 100);
}

function toHolder(
  symbol: string,
  current: ManagerPosition | undefined,
  previous: ManagerPosition | undefined,
  comparable: boolean,
  managerPortfolioValue: number | null | undefined,
): StockInstitutionalHolder {
  const source = current ?? previous!;
  const changeType = classifyChange(current, previous, comparable);
  const currentShares = current?.reportedShares ?? null;
  const previousShares = previous?.reportedShares ?? null;
  const shareChange =
    changeType === "NEW" || changeType === null
      ? current && previous &&
        current.reportedShares !== null &&
        previous.reportedShares !== null
        ? current.reportedShares - previous.reportedShares
        : null
      : changeType === "EXITED"
        ? previousShares === null
          ? null
          : -previousShares
        : currentShares !== null && previousShares !== null
          ? currentShares - previousShares
          : null;
  const shareChangePct =
    shareChange !== null && previousShares !== null && previousShares > 0
      ? roundPercent((shareChange / previousShares) * 100)
      : null;
  const cusips = Array.from(
    new Set([
      ...Array.from(current?.cusips ?? []),
      ...Array.from(previous?.cusips ?? []),
    ]),
  ).sort();
  return {
    managerId: source.managerId,
    managerName: source.managerName,
    cusip: cusips.length === 1 ? cusips[0] : null,
    cusips,
    symbol,
    issuerName: source.issuerName,
    reportedShares: currentShares,
    previousReportedShares: previousShares,
    reportedShareChange: shareChange,
    reportedShareChangePct: shareChangePct,
    reportedValueDollars: current?.reportedValue ?? null,
    portfolioWeight: current
      ? portfolioWeight(current.reportedValue, managerPortfolioValue)
      : null,
    changeType,
  };
}

function compareNullableDescending(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  return left !== null && right !== null ? right - left : 0;
}

function tieBreakHolders(
  left: StockInstitutionalHolder,
  right: StockInstitutionalHolder,
): number {
  return (
    left.managerName.localeCompare(right.managerName) ||
    left.managerId.localeCompare(right.managerId) ||
    (left.cusip ?? "").localeCompare(right.cusip ?? "")
  );
}

function sortByReportedValue(
  holders: StockInstitutionalHolder[],
): StockInstitutionalHolder[] {
  return holders.slice().sort(
    (left, right) =>
      compareNullableDescending(
        left.reportedValueDollars,
        right.reportedValueDollars,
      ) || tieBreakHolders(left, right),
  );
}

function sortByShareIncrease(
  holders: StockInstitutionalHolder[],
): StockInstitutionalHolder[] {
  return holders.slice().sort(
    (left, right) =>
      compareNullableDescending(
        left.reportedShareChange,
        right.reportedShareChange,
      ) || tieBreakHolders(left, right),
  );
}

function sortByShareReduction(
  holders: StockInstitutionalHolder[],
): StockInstitutionalHolder[] {
  return holders.slice().sort((left, right) => {
    const leftChange = left.reportedShareChange;
    const rightChange = right.reportedShareChange;
    if (leftChange === null && rightChange !== null) return 1;
    if (leftChange !== null && rightChange === null) return -1;
    if (leftChange !== null && rightChange !== null) {
      const change = leftChange - rightChange;
      if (change !== 0) return change;
    }
    return tieBreakHolders(left, right);
  });
}

function buildMappingCoverage(
  holdings: EnrichedInstitutionalHolding[],
  symbol: string,
  positionType: InstitutionalSecurityPositionType,
): StockInstitutionalMappingCoverage {
  const candidates = holdings.filter((holding) =>
    matchesPositionType(holding, positionType),
  );
  const reliablyMappedHoldingCount = candidates.filter((holding) =>
    isRequestedSymbol(holding, symbol),
  ).length;
  const ambiguousHoldingCount = candidates.filter(
    (holding) => holding.mappingResolution === "ambiguous",
  ).length;
  const unmappedHoldingCount =
    candidates.length - reliablyMappedHoldingCount - ambiguousHoldingCount;
  return {
    candidateHoldingCount: candidates.length,
    reliablyMappedHoldingCount,
    unmappedHoldingCount,
    ambiguousHoldingCount,
    classificationUnavailableHoldingCount: candidates.filter(
      (holding) =>
        isRequestedSymbol(holding, symbol) &&
        holding.classificationStatus === "unclassified",
    ).length,
    coveragePercent:
      candidates.length === 0
        ? 0
        : roundPercent(
            (reliablyMappedHoldingCount / candidates.length) * 100,
          ),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return roundPercent(value);
}

function buildBreadth(
  changes: StockInstitutionalHolder[],
): InstitutionalBreadth | null {
  if (changes.length === 0) return null;
  const increased = changes.filter(
    (holder) => holder.changeType === "INCREASED",
  ).length;
  const reduced = changes.filter(
    (holder) => holder.changeType === "REDUCED",
  ).length;
  const newlyReported = changes.filter(
    (holder) => holder.changeType === "NEW",
  ).length;
  const exited = changes.filter(
    (holder) => holder.changeType === "EXITED",
  ).length;
  const directional = increased + reduced + newlyReported + exited;
  const breadthRatio =
    directional === 0
      ? 0
      : roundPercent(
          ((increased + newlyReported - reduced - exited) / directional) * 100,
        ) / 100;
  return {
    scope: "managers",
    totalEntityCount: changes.length,
    increasingEntityCount: increased,
    decreasingEntityCount: reduced,
    newEntityCount: newlyReported,
    exitedEntityCount: exited,
    breadthRatio,
    direction:
      breadthRatio > 0
        ? "broadening"
        : breadthRatio < 0
          ? "narrowing"
          : "balanced",
  };
}

function buildTrend(
  input: StockInstitutionalAnalyticsCalculationInput,
  shareChange: number | null,
  changes: StockInstitutionalHolder[],
): InstitutionalTrend | null {
  if (!input.previousQuarter) return null;
  return {
    direction:
      shareChange === null
        ? "insufficient_data"
        : shareChange > 0
          ? "accumulating"
          : shareChange < 0
            ? "distributing"
            : "stable",
    currentQuarter: input.quarter,
    comparisonQuarter: input.previousQuarter,
    observations: changes.length,
    confidence:
      shareChange === null
        ? "insufficient"
        : changes.length >= 10
          ? "high"
          : changes.length >= 5
            ? "moderate"
            : "limited",
  };
}

function buildDataQuality(
  mappingCoverage: StockInstitutionalMappingCoverage,
  input: StockInstitutionalAnalyticsCalculationInput,
  comparisonComplete: boolean,
): AnalyticsDataQuality {
  const warnings = [
    "Form 13F holdings are delayed and represent tracked reported positions only, not total institutional ownership.",
    "Quarter-over-quarter differences are reported filing comparisons, not exact trading activity.",
  ];
  if (mappingCoverage.coveragePercent < 100) {
    warnings.push(
      "Some symbol candidates could not be mapped reliably and were excluded from holder totals.",
    );
  }
  if (!input.previousQuarter) {
    warnings.push("No adjacent effective prior quarter is available for comparison.");
  } else if (!comparisonComplete) {
    warnings.push(
      "At least one current holder lacks an adjacent prior-quarter filing; aggregate change metrics are unavailable.",
    );
  }
  return {
    status:
      mappingCoverage.reliablyMappedHoldingCount === 0
        ? "insufficient"
        : mappingCoverage.coveragePercent === 100 && comparisonComplete
          ? "complete"
          : "partial",
    coveragePercent: mappingCoverage.coveragePercent,
    warnings,
  };
}

/**
 * Pure stock-level calculation. Current totals include all reliably mapped
 * current holders. Change metrics are emitted only for managers with equivalent
 * adjacent effective filing periods.
 */
export function computeStockInstitutionalAnalytics(
  input: StockInstitutionalAnalyticsCalculationInput,
  options: StockInstitutionalAnalyticsOptions = {},
): StockInstitutionalAnalytics {
  const symbol = input.symbol.trim().toUpperCase();
  const positionType = options.positionType ?? "COMMON_EQUITY";
  const topN = Math.max(1, Math.min(100, Math.floor(options.topN ?? 20)));
  const comparable = new Set(input.comparableManagerIds);
  const currentByManager = aggregateByManager(
    input.currentHoldings,
    symbol,
    positionType,
  );
  const previousByManager = aggregateByManager(
    input.previousHoldings,
    symbol,
    positionType,
  );
  const allManagerIds = new Set([
    ...Array.from(currentByManager.keys()),
    ...Array.from(previousByManager.keys()),
  ]);
  const holders = Array.from(allManagerIds).map((managerId) =>
    toHolder(
      symbol,
      currentByManager.get(managerId),
      previousByManager.get(managerId),
      comparable.has(managerId),
      input.managerPortfolioValues[managerId],
    ),
  );
  const currentHolders = holders.filter((holder) =>
    currentByManager.has(holder.managerId),
  );
  const changes = holders.filter((holder) => holder.changeType !== null);
  const comparisonComplete =
    input.previousQuarter !== null &&
    currentHolders.every((holder) => comparable.has(holder.managerId));

  const aggregateReportedShares = sumNullable(
    Array.from(currentByManager.values()).map(
      (position) => position.reportedShares,
    ),
  );
  const previousAggregateReportedShares = input.previousQuarter
    ? sumNullable(
        Array.from(previousByManager.values()).map(
          (position) => position.reportedShares,
        ),
      )
    : null;
  const aggregateReportedShareChange =
    comparisonComplete &&
    previousAggregateReportedShares !== null &&
    aggregateReportedShares !== null
      ? aggregateReportedShares - previousAggregateReportedShares
      : null;
  const aggregateReportedShareChangePct =
    aggregateReportedShareChange !== null &&
    previousAggregateReportedShares !== null &&
    previousAggregateReportedShares > 0
      ? roundPercent(
          (aggregateReportedShareChange / previousAggregateReportedShares) *
            100,
        )
      : null;
  const aggregateReportedValue = sumNullable(
    Array.from(currentByManager.values()).map(
      (position) => position.reportedValue,
    ),
  );
  const weights = currentHolders
    .map((holder) => holder.portfolioWeight)
    .filter((weight): weight is number => weight !== null);
  const mappingCoverage = buildMappingCoverage(
    input.currentHoldings,
    symbol,
    positionType,
  );
  const previousReportedHolderCount = input.previousQuarter
    ? previousByManager.size
    : null;
  const holderCountChange =
    comparisonComplete && previousReportedHolderCount !== null
      ? currentByManager.size - previousReportedHolderCount
      : null;
  const newlyReportedHolderCount = changes.filter(
    (holder) => holder.changeType === "NEW",
  ).length;
  const increasedReportedHolderCount = changes.filter(
    (holder) => holder.changeType === "INCREASED",
  ).length;
  const unchangedReportedHolderCount = changes.filter(
    (holder) => holder.changeType === "UNCHANGED",
  ).length;
  const reducedReportedHolderCount = changes.filter(
    (holder) => holder.changeType === "REDUCED",
  ).length;
  const noLongerReportedHolderCount = changes.filter(
    (holder) => holder.changeType === "EXITED",
  ).length;
  const breadth = buildBreadth(changes);

  return {
    symbol,
    quarter: input.quarter,
    dataAsOf: input.dataAsOf,
    reportingManagerCount: currentByManager.size,
    reportedHolderCount: currentByManager.size,
    previousReportedHolderCount,
    holderCountChange,
    newlyReportedHolderCount,
    increasedReportedHolderCount,
    unchangedReportedHolderCount,
    reducedReportedHolderCount,
    noLongerReportedHolderCount,
    aggregateReportedShares,
    previousAggregateReportedShares,
    aggregateReportedShareChange,
    aggregateReportedShareChangePct,
    aggregateReportedValueDollars: aggregateReportedValue,
    averagePortfolioWeight: average(weights),
    medianPortfolioWeight: median(weights),
    topReportedHolders: sortByReportedValue(currentHolders).slice(0, topN),
    largestNewlyReportedPositions: sortByReportedValue(
      changes.filter((holder) => holder.changeType === "NEW"),
    ).slice(0, topN),
    largestReportedShareIncreases: sortByShareIncrease(
      changes.filter((holder) => holder.changeType === "INCREASED"),
    ).slice(0, topN),
    largestReportedShareReductions: sortByShareReduction(
      changes.filter((holder) => holder.changeType === "REDUCED"),
    ).slice(0, topN),
    noLongerReportedPositions: previousByManager.size
      ? changes
          .filter((holder) => holder.changeType === "EXITED")
          .sort(
            (left, right) =>
              compareNullableDescending(
                left.previousReportedShares,
                right.previousReportedShares,
              ) || tieBreakHolders(left, right),
          )
          .slice(0, topN)
      : [],
    mappingCoverage,
    managerChangeCounts: {
      new: newlyReportedHolderCount,
      increased: increasedReportedHolderCount,
      unchanged: unchangedReportedHolderCount,
      reduced: reducedReportedHolderCount,
      exited: noLongerReportedHolderCount,
    },
    breadth,
    trend: buildTrend(
      input,
      aggregateReportedShareChange,
      changes,
    ),
    dataQuality: buildDataQuality(
      mappingCoverage,
      input,
      comparisonComplete,
    ),
    modelVersion: STOCK_INSTITUTIONAL_MODEL_VERSION,
  };
}

function normalizeSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

export async function getStockInstitutionalAnalytics(
  symbol: string,
  quarter: FundPortfolioXRayQuarterSelector = "latest",
  options: StockInstitutionalAnalyticsOptions = {},
  repository: StockInstitutionalRepository = stockInstitutionalRepository,
): Promise<StockInstitutionalAnalytics | null> {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return null;
  const normalizedOptions: StockInstitutionalAnalyticsOptions = {
    ...options,
    positionType: options.positionType ?? "COMMON_EQUITY",
  };
  const source = await repository.getStockInstitutionalSource({
    symbol: normalizedSymbol,
    quarter,
    options: normalizedOptions,
  });
  if (!source) return null;
  return computeStockInstitutionalAnalytics(source, normalizedOptions);
}