/**
 * Cross-fund institutional activity rankings.
 *
 * This module intentionally reports breadth and filing-derived share changes,
 * not scores, recommendations, exact transactions, or total ownership.
 */

import {
  classifySecurityPositionType,
  type InstitutionalSecurityPositionType,
} from "../security-position";
import {
  crossFundInstitutionalRepository,
} from "./cross-fund-analytics-repository";
import type {
  CrossFundInstitutionalRepository,
} from "./repository";
import type {
  AnalyticsDataQuality,
  EnrichedInstitutionalHolding,
  InstitutionalActivityRankingItem,
  InstitutionalActivityRankingMode,
  InstitutionalActivityRankingOptions,
  InstitutionalActivityRankingResult,
  InstitutionalActivityRankingSort,
  InstitutionalQuarter,
  ModelVersion,
} from "./types";

export const CROSS_FUND_ACTIVITY_MODEL_VERSION: ModelVersion = {
  name: "cross-fund-institutional-activity",
  version: "1.0.0",
};

interface ManagerPosition {
  managerId: string;
  managerName: string;
  cusips: Set<string>;
  shares: number;
  value: number | null;
}

interface SymbolBucket {
  symbol: string;
  current: Map<string, ManagerPosition>;
  previous: Map<string, ManagerPosition>;
  metadata: Array<{
    companyName: string | null;
    sector: string | null;
    industry: string | null;
    marketCap: number | null;
  }>;
  themes: Map<string, string>;
  cusips: Set<string>;
}

export interface CrossFundActivityCalculationInput {
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  dataAsOf: string | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  currentFilingManagerIds: string[];
  comparableManagerIds: string[];
}

export interface CrossFundActivityRankingService {
  getRanking(
    mode: InstitutionalActivityRankingMode,
    options?: InstitutionalActivityRankingOptions,
  ): Promise<InstitutionalActivityRankingResult | null>;
  getInstitutionalAccumulationRanking(
    options?: InstitutionalActivityRankingOptions,
  ): Promise<InstitutionalActivityRankingResult | null>;
  getInstitutionalReductionRanking(
    options?: InstitutionalActivityRankingOptions,
  ): Promise<InstitutionalActivityRankingResult | null>;
  getNewlyReportedRanking(
    options?: InstitutionalActivityRankingOptions,
  ): Promise<InstitutionalActivityRankingResult | null>;
  getNoLongerReportedRanking(
    options?: InstitutionalActivityRankingOptions,
  ): Promise<InstitutionalActivityRankingResult | null>;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function eligibleForPositionType(
  holding: EnrichedInstitutionalHolding,
  positionType: InstitutionalSecurityPositionType,
): boolean {
  try {
    if (classifySecurityPositionType(holding.putCall) !== positionType) {
      return false;
    }
  } catch {
    return false;
  }
  return !(
    positionType === "COMMON_EQUITY" &&
    holding.sharesPrnType?.trim().toUpperCase() === "PRN"
  );
}

function resolvedSymbol(
  holding: EnrichedInstitutionalHolding,
): string | null {
  if (holding.mappingResolution !== "reliably_mapped") return null;
  const symbol = holding.metadata?.symbol.trim().toUpperCase();
  return symbol || null;
}

function metadataSortKey(metadata: SymbolBucket["metadata"][number]): string {
  return [
    metadata.companyName ?? "",
    metadata.sector ?? "",
    metadata.industry ?? "",
    metadata.marketCap ?? "",
  ].join("\u0000");
}

function addHolding(
  buckets: Map<string, SymbolBucket>,
  holding: EnrichedInstitutionalHolding,
  side: "current" | "previous",
  positionType: InstitutionalSecurityPositionType,
): void {
  if (!eligibleForPositionType(holding, positionType)) return;
  const symbol = resolvedSymbol(holding);
  if (!symbol || holding.reportedShares === null || holding.reportedShares <= 0) {
    return;
  }
  const bucket: SymbolBucket = buckets.get(symbol) ?? {
    symbol,
    current: new Map(),
    previous: new Map(),
    metadata: [],
    themes: new Map(),
    cusips: new Set(),
  };
  buckets.set(symbol, bucket);
  bucket.cusips.add(holding.cusip);
  if (holding.metadata) {
    bucket.metadata.push({
      companyName: holding.metadata.companyName,
      sector: holding.metadata.sector,
      industry: holding.metadata.industry,
      marketCap: holding.metadata.marketCap,
    });
  }
  for (const theme of holding.themes) {
    bucket.themes.set(theme.themeId.toUpperCase(), theme.themeName);
    bucket.themes.set(theme.themeName.trim().toUpperCase(), theme.themeName);
  }
  const positions = bucket[side];
  const existing = positions.get(holding.filerCik);
  if (!existing) {
    positions.set(holding.filerCik, {
      managerId: holding.filerCik,
      managerName: holding.filerName,
      cusips: new Set([holding.cusip]),
      shares: holding.reportedShares,
      value: holding.reportedValueDollars,
    });
    return;
  }
  existing.cusips.add(holding.cusip);
  existing.shares += holding.reportedShares;
  existing.value = sumNullable([existing.value, holding.reportedValueDollars]);
}

function chooseMetadata(
  bucket: SymbolBucket,
): SymbolBucket["metadata"][number] {
  return bucket.metadata
    .slice()
    .sort((left, right) =>
      metadataSortKey(left).localeCompare(metadataSortKey(right)),
    )[0] ?? {
    companyName: null,
    sector: null,
    industry: null,
    marketCap: null,
  };
}

function classifyCounts(
  current: Map<string, ManagerPosition>,
  previous: Map<string, ManagerPosition>,
  comparable: Set<string>,
): {
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  unchangedReportedHolderCount: number;
  positiveShareActivity: number;
  negativeShareActivity: number;
} {
  let newlyReportedHolderCount = 0;
  let increasedReportedHolderCount = 0;
  let reducedReportedHolderCount = 0;
  let noLongerReportedHolderCount = 0;
  let unchangedReportedHolderCount = 0;
  let positiveShareActivity = 0;
  let negativeShareActivity = 0;
  const managerIds = new Set([
    ...Array.from(current.keys()),
    ...Array.from(previous.keys()),
  ]);
  for (const managerId of Array.from(managerIds).sort()) {
    if (!comparable.has(managerId)) continue;
    const now = current.get(managerId);
    const before = previous.get(managerId);
    if (now && !before) {
      newlyReportedHolderCount++;
      positiveShareActivity += now.shares;
    } else if (!now && before) {
      noLongerReportedHolderCount++;
      negativeShareActivity += before.shares;
    } else if (now && before) {
      const change = now.shares - before.shares;
      if (change > 0) {
        increasedReportedHolderCount++;
        positiveShareActivity += change;
      } else if (change < 0) {
        reducedReportedHolderCount++;
        negativeShareActivity += Math.abs(change);
      } else {
        unchangedReportedHolderCount++;
      }
    }
  }
  return {
    newlyReportedHolderCount,
    increasedReportedHolderCount,
    reducedReportedHolderCount,
    noLongerReportedHolderCount,
    unchangedReportedHolderCount,
    positiveShareActivity,
    negativeShareActivity,
  };
}

function itemFromBucket(
  bucket: SymbolBucket,
  input: CrossFundActivityCalculationInput,
): InstitutionalActivityRankingItem {
  const metadata = chooseMetadata(bucket);
  const comparable = new Set(input.comparableManagerIds);
  const currentHolderCount = bucket.current.size;
  const previousHolderCount = input.previousQuarter
    ? bucket.previous.size
    : null;
  const comparisonComplete =
    input.previousQuarter !== null &&
    Array.from(bucket.current.keys()).every((managerId) =>
      comparable.has(managerId),
    );
  const counts = classifyCounts(bucket.current, bucket.previous, comparable);
  const aggregateReportedShares =
    bucket.current.size === 0
      ? 0
      : sumNullable(
          Array.from(bucket.current.values()).map((position) => position.shares),
        );
  const previousAggregateReportedShares = input.previousQuarter
    ? bucket.previous.size === 0
      ? 0
      : sumNullable(
          Array.from(bucket.previous.values()).map((position) => position.shares),
        )
    : null;
  const aggregateReportedShareChange =
    comparisonComplete &&
    aggregateReportedShares !== null &&
    previousAggregateReportedShares !== null
      ? aggregateReportedShares - previousAggregateReportedShares
      : null;
  const aggregateReportedShareChangePct =
    aggregateReportedShareChange !== null &&
    previousAggregateReportedShares !== null &&
    previousAggregateReportedShares > 0
      ? round(
          (aggregateReportedShareChange / previousAggregateReportedShares) * 100,
        )
      : null;
  const netHolderIncrease = comparisonComplete
    ? counts.newlyReportedHolderCount +
      counts.increasedReportedHolderCount -
      counts.reducedReportedHolderCount -
      counts.noLongerReportedHolderCount
    : null;
  return {
    symbol: bucket.symbol,
    companyName: metadata.companyName,
    sector: metadata.sector,
    industry: metadata.industry,
    marketCap: metadata.marketCap,
    currentReportedHolderCount: currentHolderCount,
    previousReportedHolderCount: previousHolderCount,
    holderCountChange:
      comparisonComplete && previousHolderCount !== null
        ? currentHolderCount - previousHolderCount
        : null,
    newlyReportedHolderCount: counts.newlyReportedHolderCount,
    increasedReportedHolderCount: counts.increasedReportedHolderCount,
    reducedReportedHolderCount: counts.reducedReportedHolderCount,
    noLongerReportedHolderCount: counts.noLongerReportedHolderCount,
    unchangedReportedHolderCount: counts.unchangedReportedHolderCount,
    netHolderIncrease,
    aggregateReportedShares,
    previousAggregateReportedShares,
    aggregateReportedShareChange,
    aggregateReportedShareChangePct,
    aggregateReportedValue:
      bucket.current.size === 0
        ? 0
        : sumNullable(
            Array.from(bucket.current.values()).map(
              (position) => position.value,
            ),
          ),
    increaseToReductionRatio:
      comparisonComplete && counts.negativeShareActivity > 0
        ? round(
            counts.positiveShareActivity / counts.negativeShareActivity,
          )
        : null,
    cusips: Array.from(bucket.cusips).sort(),
  };
}

function modeMatches(
  item: InstitutionalActivityRankingItem,
  mode: InstitutionalActivityRankingMode,
): boolean {
  switch (mode) {
    case "ACCUMULATION":
      return (
        item.newlyReportedHolderCount + item.increasedReportedHolderCount > 0 ||
        (item.aggregateReportedShareChange ?? 0) > 0
      );
    case "REDUCTION":
      return (
        item.reducedReportedHolderCount + item.noLongerReportedHolderCount > 0 ||
        (item.aggregateReportedShareChange ?? 0) < 0
      );
    case "NEWLY_REPORTED":
      return item.newlyReportedHolderCount > 0;
    case "NO_LONGER_REPORTED":
      return item.noLongerReportedHolderCount > 0;
  }
}

function activityManagerCount(
  item: InstitutionalActivityRankingItem,
  mode: InstitutionalActivityRankingMode,
): number {
  switch (mode) {
    case "ACCUMULATION":
      return (
        item.newlyReportedHolderCount + item.increasedReportedHolderCount
      );
    case "REDUCTION":
      return (
        item.reducedReportedHolderCount + item.noLongerReportedHolderCount
      );
    case "NEWLY_REPORTED":
      return item.newlyReportedHolderCount;
    case "NO_LONGER_REPORTED":
      return item.noLongerReportedHolderCount;
  }
}

function defaultSort(
  mode: InstitutionalActivityRankingMode,
): InstitutionalActivityRankingSort {
  switch (mode) {
    case "NEWLY_REPORTED":
      return "newHolderCount";
    case "NO_LONGER_REPORTED":
      return "aggregateShareIncrease";
    default:
      return "aggregateShareIncrease";
  }
}

function metricValue(
  item: InstitutionalActivityRankingItem,
  sortBy: InstitutionalActivityRankingSort,
): number | null {
  switch (sortBy) {
    case "netHolderIncrease":
      return item.netHolderIncrease;
    case "newHolderCount":
      return item.newlyReportedHolderCount;
    case "increasedHolderCount":
      return item.increasedReportedHolderCount;
    case "aggregateShareIncreasePct":
      return item.aggregateReportedShareChangePct;
    case "aggregateShareIncrease":
      return item.aggregateReportedShareChange;
    case "reportedValue":
      return item.aggregateReportedValue;
  }
}

function defaultDirection(
  mode: InstitutionalActivityRankingMode,
  sortBy: InstitutionalActivityRankingSort,
): "asc" | "desc" {
  if (
    (mode === "REDUCTION" || mode === "NO_LONGER_REPORTED") &&
    (sortBy === "netHolderIncrease" ||
      sortBy === "aggregateShareIncreasePct" ||
      sortBy === "aggregateShareIncrease")
  ) {
    return "asc";
  }
  return "desc";
}

function sortItems(
  items: InstitutionalActivityRankingItem[],
  sortBy: InstitutionalActivityRankingSort,
  direction: "asc" | "desc",
): InstitutionalActivityRankingItem[] {
  return items.slice().sort((left, right) => {
    const leftValue = metricValue(left, sortBy);
    const rightValue = metricValue(right, sortBy);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      const result = leftValue - rightValue;
      return direction === "asc" ? result : -result;
    }
    return (
      left.symbol.localeCompare(right.symbol) ||
      (left.companyName ?? "").localeCompare(right.companyName ?? "")
    );
  });
}

function matchesFilters(
  item: InstitutionalActivityRankingItem,
  mode: InstitutionalActivityRankingMode,
  options: InstitutionalActivityRankingOptions,
): boolean {
  const equals = (value: string | null, expected: string | undefined) =>
    expected === undefined ||
    (value !== null && value.trim().toUpperCase() === expected.trim().toUpperCase());
  if (!equals(item.sector, options.sector)) return false;
  if (!equals(item.industry, options.industry)) return false;
  if (
    options.marketCapMin !== undefined &&
    (item.marketCap === null || item.marketCap < options.marketCapMin)
  ) {
    return false;
  }
  if (
    options.marketCapMax !== undefined &&
    (item.marketCap === null || item.marketCap > options.marketCapMax)
  ) {
    return false;
  }
  if (
    options.minManagers !== undefined &&
    activityManagerCount(item, mode) < options.minManagers
  ) {
    return false;
  }
  if (
    options.minReportedValue !== undefined &&
    (item.aggregateReportedValue === null ||
      item.aggregateReportedValue < options.minReportedValue)
  ) {
    return false;
  }
  return true;
}

function buildDataQuality(
  input: CrossFundActivityCalculationInput,
  positionType: InstitutionalSecurityPositionType,
): AnalyticsDataQuality {
  const candidates = [
    ...input.currentHoldings,
    ...input.previousHoldings,
  ].filter((holding) => eligibleForPositionType(holding, positionType));
  const mapped = candidates.filter((holding) => resolvedSymbol(holding) !== null);
  const comparable = new Set(input.comparableManagerIds);
  const comparisonComplete =
    input.previousQuarter !== null &&
    input.currentHoldings
      .filter(
        (holding) =>
          eligibleForPositionType(holding, positionType) &&
          resolvedSymbol(holding) !== null,
      )
      .every((holding) => comparable.has(holding.filerCik));
  const coveragePercent =
    candidates.length === 0 ? 0 : round((mapped.length / candidates.length) * 100);
  const warnings = [
    "Metrics describe delayed positions reported by tracked Form 13F managers, not total institutional ownership.",
    "Quarter-over-quarter differences are filing comparisons, not exact trading activity.",
  ];
  if (!input.previousQuarter) {
    warnings.push("No adjacent effective prior quarter is available for comparison.");
  } else if (!comparisonComplete) {
    warnings.push(
      "At least one current reported holder lacks an adjacent prior-quarter filing; affected change metrics are unavailable.",
    );
  }
  if (coveragePercent < 100) {
    warnings.push(
      "Some eligible holdings were not reliably mapped and were excluded from symbol rankings.",
    );
  }
  return {
    status:
      mapped.length === 0
        ? "insufficient"
        : coveragePercent === 100 && comparisonComplete
          ? "complete"
          : "partial",
    coveragePercent,
    warnings,
  };
}

export function computeCrossFundActivityRanking(
  mode: InstitutionalActivityRankingMode,
  input: CrossFundActivityCalculationInput,
  options: InstitutionalActivityRankingOptions = {},
): InstitutionalActivityRankingResult {
  const positionType = options.positionType ?? "COMMON_EQUITY";
  const buckets = new Map<string, SymbolBucket>();
  for (const holding of input.currentHoldings) {
    addHolding(buckets, holding, "current", positionType);
  }
  for (const holding of input.previousHoldings) {
    addHolding(buckets, holding, "previous", positionType);
  }

  const themeFilter = options.theme?.trim().toUpperCase();
  const comparable = new Set(input.comparableManagerIds);
  const items = Array.from(buckets.values())
    .filter((bucket) => {
      if (!themeFilter) return true;
      return Array.from(bucket.themes.keys()).some(
        (theme) => theme === themeFilter,
      );
    })
    .map((bucket) => itemFromBucket(bucket, input))
    .filter((item) => modeMatches(item, mode))
    .filter((item) => matchesFilters(item, mode, options));
  const sortBy = options.sortBy ?? defaultSort(mode);
  const sortDirection =
    options.sortDirection ?? defaultDirection(mode, sortBy);
  const sorted = sortItems(items, sortBy, sortDirection);
  const rawLimit = Math.floor(options.limit ?? 50);
  const limit = Math.max(1, Math.min(100, rawLimit));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  return {
    mode,
    quarter: input.quarter,
    previousQuarter: input.previousQuarter,
    sortBy,
    sortDirection,
    items: sorted.slice(offset, offset + limit),
    totalCount: sorted.length,
    limit,
    offset,
    trackedManagerCount: new Set(input.currentFilingManagerIds).size,
    comparableManagerCount: comparable.size,
    dataQuality: buildDataQuality(input, positionType),
    modelVersion: CROSS_FUND_ACTIVITY_MODEL_VERSION,
  };
}

export async function getInstitutionalActivityRanking(
  mode: InstitutionalActivityRankingMode,
  options: InstitutionalActivityRankingOptions = {},
  repository: CrossFundInstitutionalRepository = crossFundInstitutionalRepository,
): Promise<InstitutionalActivityRankingResult | null> {
  const source = await repository.getCrossFundInstitutionalSource({
    quarter: options.quarter ?? "latest",
    options,
  });
  if (!source) return null;
  return computeCrossFundActivityRanking(mode, source, options);
}

export const getInstitutionalAccumulationRanking = (
  options?: InstitutionalActivityRankingOptions,
  repository?: CrossFundInstitutionalRepository,
) =>
  getInstitutionalActivityRanking(
    "ACCUMULATION",
    options,
    repository ?? crossFundInstitutionalRepository,
  );

export const getInstitutionalReductionRanking = (
  options?: InstitutionalActivityRankingOptions,
  repository?: CrossFundInstitutionalRepository,
) =>
  getInstitutionalActivityRanking(
    "REDUCTION",
    options,
    repository ?? crossFundInstitutionalRepository,
  );

export const getNewlyReportedRanking = (
  options?: InstitutionalActivityRankingOptions,
  repository?: CrossFundInstitutionalRepository,
) =>
  getInstitutionalActivityRanking(
    "NEWLY_REPORTED",
    options,
    repository ?? crossFundInstitutionalRepository,
  );

export const getNoLongerReportedRanking = (
  options?: InstitutionalActivityRankingOptions,
  repository?: CrossFundInstitutionalRepository,
) =>
  getInstitutionalActivityRanking(
    "NO_LONGER_REPORTED",
    options,
    repository ?? crossFundInstitutionalRepository,
  );

export const crossFundActivityRankingService: CrossFundActivityRankingService = {
  getRanking: getInstitutionalActivityRanking,
  getInstitutionalAccumulationRanking,
  getInstitutionalReductionRanking,
  getNewlyReportedRanking,
  getNoLongerReportedRanking,
};