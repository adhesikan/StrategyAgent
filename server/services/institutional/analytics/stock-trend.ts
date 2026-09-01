/**
 * Deterministic multi-quarter institutional positioning trend engine.
 *
 * All classification thresholds live in INSTITUTIONAL_TREND_MODEL_CONFIG.
 * Reported value is returned for context only; classification uses reported
 * shares, manager breadth, and filing activity rather than market value.
 */

import {
  classifySecurityPositionType,
  type InstitutionalSecurityPositionType,
} from "../security-position";
import { stockInstitutionalTrendRepository } from "./stock-trend-repository";
import {
  resolveCanonicalInstitutionalSecurityContext,
  type CanonicalInstitutionalSecurityContext,
} from "../canonical-institutional-security-context";
import type {
  CanonicalInstitutionalQuarterAggregate,
  StockInstitutionalTrendQuarterSource,
  StockInstitutionalTrendRepository,
} from "./repository";
import type {
  AnalyticsDataQuality,
  EnrichedInstitutionalHolding,
  InstitutionalQuarter,
  ModelVersion,
  StockInstitutionalTrendClassification,
  StockInstitutionalTrendOptions,
  StockInstitutionalTrendQuarter,
  StockInstitutionalTrendResult,
} from "./types";

export const INSTITUTIONAL_TREND_MODEL_CONFIG = {
  id: "institutional_trend_v1",
  version: "1.0.0",
  maxHistoryQuarters: 8,
  minimumComparableQuarters: 1,
  stableBalanceAbsMax: 0.2,
  accumulationBalanceMin: 0.25,
  distributionBalanceMax: -0.25,
  accelerationBalanceDelta: 0.2,
} as const;

export const INSTITUTIONAL_TREND_MODEL_VERSION: ModelVersion = {
  name: INSTITUTIONAL_TREND_MODEL_CONFIG.id,
  version: INSTITUTIONAL_TREND_MODEL_CONFIG.version,
};

export interface StockInstitutionalTrendCalculationInput {
  symbol: string;
  quarters: StockInstitutionalTrendQuarterSource[];
  positionType?: InstitutionalSecurityPositionType;
}

interface ManagerPosition {
  managerId: string;
  shares: number | null;
  value: number | null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.length === 0) return 0;
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function matchesPositionType(
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
  const result = new Map<string, ManagerPosition>();
  for (const holding of holdings) {
    if (!matchesPositionType(holding, positionType)) continue;
    if (!isRequestedSymbol(holding, symbol)) continue;
    if (holding.reportedShares === null || holding.reportedShares <= 0) continue;
    const existing = result.get(holding.filerCik);
    if (!existing) {
      result.set(holding.filerCik, {
        managerId: holding.filerCik,
        shares: holding.reportedShares,
        value: holding.reportedValueDollars,
      });
      continue;
    }
    existing.shares = sumNullable([existing.shares, holding.reportedShares]);
    existing.value = sumNullable([
      existing.value,
      holding.reportedValueDollars,
    ]);
  }
  return result;
}

function changesForQuarter(
  current: Map<string, ManagerPosition>,
  previous: Map<string, ManagerPosition>,
  comparableManagerIds: string[],
  hasComparison: boolean,
) {
  if (!hasComparison) {
    return {
      newlyReportedHolderCount: 0,
      increasedReportedHolderCount: 0,
      reducedReportedHolderCount: 0,
      noLongerReportedHolderCount: 0,
      unchangedReportedHolderCount: 0,
      comparablePositionCount: null,
    };
  }
  const comparable = new Set(comparableManagerIds);
  const keys = new Set([
    ...Array.from(current.keys()),
    ...Array.from(previous.keys()),
  ]);
  let newlyReportedHolderCount = 0;
  let increasedReportedHolderCount = 0;
  let reducedReportedHolderCount = 0;
  let noLongerReportedHolderCount = 0;
  let unchangedReportedHolderCount = 0;
  for (const key of Array.from(keys).sort()) {
    const now = current.get(key);
    const before = previous.get(key);
    const managerId = now?.managerId ?? before?.managerId;
    if (!managerId || !comparable.has(managerId)) continue;
    if (now && !before) newlyReportedHolderCount++;
    else if (!now && before) noLongerReportedHolderCount++;
    else if (now && before && now.shares !== null && before.shares !== null) {
      if (now.shares > before.shares) increasedReportedHolderCount++;
      else if (now.shares < before.shares) reducedReportedHolderCount++;
      else unchangedReportedHolderCount++;
    }
  }
  return {
    newlyReportedHolderCount,
    increasedReportedHolderCount,
    reducedReportedHolderCount,
    noLongerReportedHolderCount,
    unchangedReportedHolderCount,
    comparablePositionCount: Array.from(keys).filter((key) => {
      const position = current.get(key) ?? previous.get(key);
      return position ? comparable.has(position.managerId) : false;
    }).length,
  };
}

function buildQuarter(
  source: StockInstitutionalTrendQuarterSource,
  symbol: string,
  positionType: InstitutionalSecurityPositionType,
): StockInstitutionalTrendQuarter {
  const current = aggregateByManager(
    source.currentHoldings,
    symbol,
    positionType,
  );
  const previous = aggregateByManager(
    source.previousHoldings,
    symbol,
    positionType,
  );
  const hasComparison = source.previousQuarter !== null;
  const changes = changesForQuarter(
    current,
    previous,
    source.comparableManagerIds,
    hasComparison,
  );
  const aggregateReportedShares = sumNullable(
    Array.from(current.values()).map((position) => position.shares),
  );
  const previousAggregateReportedShares = hasComparison
    ? sumNullable(
        Array.from(previous.values()).map((position) => position.shares),
      )
    : null;
  const shareChange =
    hasComparison &&
    aggregateReportedShares !== null &&
    previousAggregateReportedShares !== null
      ? aggregateReportedShares - previousAggregateReportedShares
      : null;
  const shareTrend =
    shareChange !== null &&
    previousAggregateReportedShares !== null &&
    previousAggregateReportedShares > 0
      ? round((shareChange / previousAggregateReportedShares) * 100)
      : null;
  const directionalCount =
    changes.newlyReportedHolderCount +
    changes.increasedReportedHolderCount +
    changes.reducedReportedHolderCount +
    changes.noLongerReportedHolderCount;
  const increaseReductionBalance =
    !hasComparison || changes.comparablePositionCount === 0
      ? null
      : directionalCount === 0
        ? 0
        : round(
            (changes.newlyReportedHolderCount +
              changes.increasedReportedHolderCount -
              changes.reducedReportedHolderCount -
              changes.noLongerReportedHolderCount) /
              directionalCount,
          );
  const persistence =
    !hasComparison || changes.comparablePositionCount === 0
      ? null
      : round(
          (changes.unchangedReportedHolderCount /
            (changes.comparablePositionCount ?? 1)) *
            100,
        );
  const comparisonComplete =
    hasComparison &&
    Array.from(current.values()).every((position) =>
      source.comparableManagerIds.includes(position.managerId),
    );
  return {
    quarter: source.quarter,
    reportedHolderCount: current.size,
    newlyReportedHolderCount: changes.newlyReportedHolderCount,
    increasedReportedHolderCount: changes.increasedReportedHolderCount,
    reducedReportedHolderCount: changes.reducedReportedHolderCount,
    noLongerReportedHolderCount: changes.noLongerReportedHolderCount,
    aggregateReportedShares,
    aggregateReportedValue: sumNullable(
      Array.from(current.values()).map((position) => position.value),
    ),
    breadthChange:
      comparisonComplete && hasComparison
        ? current.size - previous.size
        : null,
    shareTrend: comparisonComplete ? shareTrend : null,
    persistence: comparisonComplete ? persistence : null,
    increaseReductionBalance: comparisonComplete
      ? increaseReductionBalance
      : null,
    hasComparablePriorQuarter: comparisonComplete,
  };
}

function buildCanonicalQuarter(
  aggregate: CanonicalInstitutionalQuarterAggregate,
): StockInstitutionalTrendQuarter {
  const hasComparison =
    aggregate.previousQuarter !== null &&
    aggregate.previousQuarterShares !== null;
  const directionalCount =
    aggregate.newPositionCount +
    aggregate.increasedPositionCount +
    aggregate.reducedPositionCount +
    aggregate.exitedPositionCount;
  const comparableCount = directionalCount + aggregate.unchangedCount;
  const increaseReductionBalance = !hasComparison
    ? null
    : directionalCount === 0
      ? 0
      : round(
          (aggregate.newPositionCount +
            aggregate.increasedPositionCount -
            aggregate.reducedPositionCount -
            aggregate.exitedPositionCount) /
            directionalCount,
        );
  return {
    quarter: aggregate.quarter,
    reportedHolderCount: aggregate.reportingManagerCount,
    newlyReportedHolderCount: aggregate.newPositionCount,
    increasedReportedHolderCount: aggregate.increasedPositionCount,
    reducedReportedHolderCount: aggregate.reducedPositionCount,
    noLongerReportedHolderCount: aggregate.exitedPositionCount,
    aggregateReportedShares: aggregate.aggregateReportedShares,
    aggregateReportedValue: aggregate.aggregateReportedValue,
    breadthChange:
      aggregate.previousReportingManagerCount === null
        ? null
        : aggregate.reportingManagerCount -
          aggregate.previousReportingManagerCount,
    shareTrend:
      aggregate.reportedSharesChangePercent === null
        ? null
        : round(aggregate.reportedSharesChangePercent * 100),
    persistence:
      !hasComparison || comparableCount === 0
        ? null
        : round((aggregate.unchangedCount / comparableCount) * 100),
    increaseReductionBalance,
    hasComparablePriorQuarter: hasComparison,
  };
}

function quarterSignal(
  quarter: StockInstitutionalTrendQuarter,
): "accumulation" | "distribution" | "stable" | null {
  const balance = quarter.increaseReductionBalance;
  if (balance === null) return null;
  if (
    balance >= INSTITUTIONAL_TREND_MODEL_CONFIG.accumulationBalanceMin
  ) {
    return "accumulation";
  }
  if (
    balance <= INSTITUTIONAL_TREND_MODEL_CONFIG.distributionBalanceMax
  ) {
    return "distribution";
  }
  if (
    Math.abs(balance) <= INSTITUTIONAL_TREND_MODEL_CONFIG.stableBalanceAbsMax
  ) {
    return "stable";
  }
  return "stable";
}

export function classifyStockInstitutionalTrend(
  quarters: StockInstitutionalTrendQuarter[],
): StockInstitutionalTrendClassification {
  const signals = quarters.map((quarter) => ({
    quarter,
    signal: quarterSignal(quarter),
  }));
  const comparableCount = signals.filter(
    (item) => item.signal !== null,
  ).length;
  if (
    comparableCount <
    INSTITUTIONAL_TREND_MODEL_CONFIG.minimumComparableQuarters
  ) {
    return "INSUFFICIENT_DATA";
  }
  const latest = signals[signals.length - 1];
  if (latest.signal === null) return "INSUFFICIENT_DATA";
  const prior = signals[signals.length - 2];
  if (latest.signal === "stable") return "STABLE";
  if (prior?.signal !== latest.signal) {
    return prior?.signal ? "STABLE" : latest.signal === "accumulation"
      ? "ACCUMULATION"
      : "DISTRIBUTION";
  }
  if (prior?.signal) {
    const latestBalance = latest.quarter.increaseReductionBalance;
    const priorBalance = prior.quarter.increaseReductionBalance;
    if (
      latestBalance !== null &&
      priorBalance !== null &&
      latest.signal === "accumulation" &&
      round(latestBalance - priorBalance) >=
        INSTITUTIONAL_TREND_MODEL_CONFIG.accelerationBalanceDelta
    ) {
      return "ACCELERATING_ACCUMULATION";
    }
    if (
      latestBalance !== null &&
      priorBalance !== null &&
      latest.signal === "distribution" &&
      round(latestBalance - priorBalance) <=
        -INSTITUTIONAL_TREND_MODEL_CONFIG.accelerationBalanceDelta
    ) {
      return "ACCELERATING_DISTRIBUTION";
    }
  }
  return latest.signal === "accumulation" ? "ACCUMULATION" : "DISTRIBUTION";
}

function buildDataQuality(
  input: StockInstitutionalTrendCalculationInput,
  quarters: StockInstitutionalTrendQuarter[],
  useCanonicalAggregates: boolean,
): AnalyticsDataQuality {
  const canonicalAggregates = useCanonicalAggregates
    ? input.quarters
    .map((source) => source.canonicalAggregate ?? null)
    .filter(
      (
        aggregate,
      ): aggregate is CanonicalInstitutionalQuarterAggregate =>
        aggregate !== null,
    )
    : [];
  if (
    canonicalAggregates.length > 0 &&
    canonicalAggregates.length === input.quarters.length
  ) {
    const latest = quarters[quarters.length - 1];
    const complete = canonicalAggregates.every(
      (aggregate) => aggregate.coverageStatus === "complete",
    );
    const insufficient = canonicalAggregates.every(
      (aggregate) => aggregate.coverageStatus === "insufficient",
    );
    return {
      status: insufficient
        ? "insufficient"
        : complete && latest?.hasComparablePriorQuarter
          ? "complete"
          : "partial",
      coveragePercent: complete ? 100 : null,
      warnings: [
        "Form 13F holdings are delayed reported positions and do not establish total institutional ownership.",
        "Reported value changes are not buying or selling signals because security price changes affect filing-time value.",
        "Trend classifications use canonical persisted common-equity aggregates; no AI or LLM interpretation is used.",
      ],
    };
  }
  const candidates = input.quarters.flatMap((source) => [
    ...source.currentHoldings,
    ...source.previousHoldings,
  ]);
  const positionType = input.positionType ?? "COMMON_EQUITY";
  const eligible = candidates.filter((holding) =>
    matchesPositionType(holding, positionType),
  );
  const mapped = eligible.filter((holding) =>
    isRequestedSymbol(holding, input.symbol.trim().toUpperCase()),
  );
  const coveragePercent =
    eligible.length === 0 ? 0 : round((mapped.length / eligible.length) * 100);
  const warnings = [
    "Form 13F holdings are delayed reported positions and do not establish total institutional ownership.",
    "Reported value changes are not buying or selling signals because security price changes affect filing-time value.",
    "Trend classifications use reported shares, manager breadth, and filing activity only; no AI or LLM interpretation is used.",
  ];
  if (quarters.length < 2) {
    warnings.push("Fewer than two available quarters limits trend classification.");
  }
  if (coveragePercent < 100) {
    warnings.push(
      "Unmapped or ambiguous holdings were excluded from the stock trend.",
    );
  }
  return {
    status:
      mapped.length === 0
        ? "insufficient"
        : quarters.length < 2
          ? "partial"
          : quarters
                .slice(1)
                .some((quarter) => !quarter.hasComparablePriorQuarter)
            ? "partial"
            : coveragePercent === 100
            ? "complete"
            : "partial",
    coveragePercent,
    warnings,
  };
}

export function computeStockInstitutionalTrend(
  input: StockInstitutionalTrendCalculationInput,
): StockInstitutionalTrendResult {
  const positionType = input.positionType ?? "COMMON_EQUITY";
  const symbol = input.symbol.trim().toUpperCase();
  const quarters = input.quarters
    .slice()
    .sort((left, right) =>
      left.quarter.periodEndDate.localeCompare(right.quarter.periodEndDate),
    )
    .map((source) =>
      positionType === "COMMON_EQUITY" && source.canonicalAggregate
        ? buildCanonicalQuarter(source.canonicalAggregate)
        : buildQuarter(source, symbol, positionType),
    );
  return {
    symbol,
    quarters,
    classification: classifyStockInstitutionalTrend(quarters),
    dataQuality: buildDataQuality(
      input,
      quarters,
      positionType === "COMMON_EQUITY",
    ),
    modelVersion: INSTITUTIONAL_TREND_MODEL_VERSION,
  };
}

export async function getStockInstitutionalTrend(
  symbol: string,
  options: StockInstitutionalTrendOptions = {},
  repository: StockInstitutionalTrendRepository = stockInstitutionalTrendRepository,
  canonicalContext?: CanonicalInstitutionalSecurityContext | null,
): Promise<StockInstitutionalTrendResult | null> {
  const requestedHistory = options.historyQuarters;
  const historyQuarters =
    requestedHistory === undefined || !Number.isFinite(requestedHistory)
      ? INSTITUTIONAL_TREND_MODEL_CONFIG.maxHistoryQuarters
      : Math.max(
          1,
          Math.min(
            INSTITUTIONAL_TREND_MODEL_CONFIG.maxHistoryQuarters,
            Math.floor(requestedHistory),
          ),
        );
  const normalizedOptions = { ...options, historyQuarters };
  const resolvedContext =
    canonicalContext !== undefined
      ? canonicalContext
      : repository === stockInstitutionalTrendRepository
        ? await resolveCanonicalInstitutionalSecurityContext(symbol)
        : undefined;
  const source = await repository.getStockInstitutionalTrendSource({
    symbol,
    options: normalizedOptions,
    ...(resolvedContext !== undefined
      ? { canonicalContext: resolvedContext }
      : {}),
  });
  if (!source) return null;
  return computeStockInstitutionalTrend({
    symbol: source.symbol,
    quarters: source.quarters,
    positionType: normalizedOptions.positionType,
  });
}