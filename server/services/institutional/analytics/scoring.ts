/**
 * Versioned, deterministic institutional accumulation scoring.
 *
 * The score describes reported 13F accumulation evidence only. It is not a
 * prediction, manager-quality rating, recommendation, or measure of total
 * institutional ownership.
 */

import type {
  InstitutionalAccumulationComponentKey,
  InstitutionalAccumulationInsufficientDataFlag,
  InstitutionalAccumulationScoreComponent,
  InstitutionalAccumulationScoreInput,
  InstitutionalAccumulationScoreResult,
  InstitutionalScoreResult,
  StockAnalyticsQuery,
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "./types";

export const INSTITUTIONAL_ACCUMULATION_MODEL = {
  modelVersion: "institutional_accumulation_v1",
  minimumAvailableWeight: 0.7,
  weights: {
    breadthChange: 0.2,
    reportedShareChange: 0.25,
    newManagerBreadth: 0.15,
    increaseReductionBalance: 0.2,
    multiQuarterPersistence: 0.1,
    portfolioWeightChange: 0.1,
  },
  transforms: {
    /**
     * Symmetric saturation limits keep extreme filings from dominating the
     * model. The limits are model parameters, not empirical forecasts.
     */
    breadthChangePctSaturation: 25,
    reportedShareChangePctSaturation: 50,
    newManagerBreadthPctSaturation: 25,
    portfolioWeightChangePctPointSaturation: 2,
  },
  precision: {
    componentScoreDecimals: 0,
    finalScoreDecimals: 0,
  },
  managerQualityWeighting: false,
} as const;

const COMPONENT_KEYS: InstitutionalAccumulationComponentKey[] = [
  "breadthChange",
  "reportedShareChange",
  "newManagerBreadth",
  "increaseReductionBalance",
  "multiQuarterPersistence",
  "portfolioWeightChange",
];

const MISSING_FLAG_BY_COMPONENT: Record<
  InstitutionalAccumulationComponentKey,
  InstitutionalAccumulationInsufficientDataFlag
> = {
  breadthChange: "MISSING_BREADTH_CHANGE",
  reportedShareChange: "MISSING_REPORTED_SHARE_CHANGE",
  newManagerBreadth: "MISSING_NEW_MANAGER_BREADTH",
  increaseReductionBalance: "MISSING_INCREASE_REDUCTION_BALANCE",
  multiQuarterPersistence: "MISSING_MULTI_QUARTER_PERSISTENCE",
  portfolioWeightChange: "MISSING_PORTFOLIO_WEIGHT_CHANGE",
};

const EXPLANATION_BY_COMPONENT: Record<
  InstitutionalAccumulationComponentKey,
  string
> = {
  breadthChange:
    "Quarter-over-quarter reported-holder breadth change, normalized to the prior holder count.",
  reportedShareChange:
    "Quarter-over-quarter aggregate reported-share change; filing-time market value is not used.",
  newManagerBreadth:
    "Newly reported managers as a percentage of the prior reported-holder count.",
  increaseReductionBalance:
    "Net manager activity balance from -1 (all reductions/exits) to +1 (all increases/new positions).",
  multiQuarterPersistence:
    "Percentage of comparable quarters with a positive increase/reduction balance.",
  portfolioWeightChange:
    "Change in average reported portfolio weight, measured in percentage points.",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundInteger(value: number): number {
  return Math.round(value);
}

function directionalScore(value: number, saturation: number): number {
  return roundInteger(50 + (clamp(value, -saturation, saturation) / saturation) * 50);
}

/**
 * Transform one raw metric to a 0-100 component score using only the versioned
 * model configuration above.
 */
export function scoreInstitutionalAccumulationComponent(
  key: InstitutionalAccumulationComponentKey,
  rawValue: number | null,
): number | null {
  if (rawValue === null || !Number.isFinite(rawValue)) return null;
  const limits = INSTITUTIONAL_ACCUMULATION_MODEL.transforms;
  switch (key) {
    case "breadthChange":
      return directionalScore(rawValue, limits.breadthChangePctSaturation);
    case "reportedShareChange":
      return directionalScore(
        rawValue,
        limits.reportedShareChangePctSaturation,
      );
    case "newManagerBreadth":
      return roundInteger(
        (clamp(rawValue, 0, limits.newManagerBreadthPctSaturation) /
          limits.newManagerBreadthPctSaturation) *
          100,
      );
    case "increaseReductionBalance":
      return roundInteger(((clamp(rawValue, -1, 1) + 1) / 2) * 100);
    case "multiQuarterPersistence":
      return roundInteger(clamp(rawValue, 0, 100));
    case "portfolioWeightChange":
      return directionalScore(
        rawValue,
        limits.portfolioWeightChangePctPointSaturation,
      );
  }
}

function rawValues(
  input: InstitutionalAccumulationScoreInput,
): Record<InstitutionalAccumulationComponentKey, number | null> {
  return {
    breadthChange: input.breadthChangePct,
    reportedShareChange: input.aggregateReportedShareChangePct,
    newManagerBreadth: input.newlyReportedManagerBreadthPct,
    increaseReductionBalance: input.increaseReductionBalance,
    multiQuarterPersistence: input.multiQuarterPersistencePct,
    portfolioWeightChange: input.portfolioWeightChangePctPoints,
  };
}

export function computeInstitutionalAccumulationScore(
  input: InstitutionalAccumulationScoreInput,
): InstitutionalAccumulationScoreResult {
  const values = rawValues(input);
  const componentScores = Object.fromEntries(
    COMPONENT_KEYS.map((key) => [
      key,
      scoreInstitutionalAccumulationComponent(key, values[key]),
    ]),
  ) as Record<InstitutionalAccumulationComponentKey, number | null>;
  const availableWeight = COMPONENT_KEYS.reduce(
    (sum, key) =>
      sum +
      (componentScores[key] === null
        ? 0
        : INSTITUTIONAL_ACCUMULATION_MODEL.weights[key]),
    0,
  );
  const flags: InstitutionalAccumulationInsufficientDataFlag[] = [];
  if (!input.dataQuarter) flags.push("MISSING_DATA_QUARTER");
  if (
    input.dataQuality.status === "insufficient" ||
    input.dataQuality.status === "unavailable"
  ) {
    flags.push("DATA_QUALITY_INSUFFICIENT");
  }
  for (const key of COMPONENT_KEYS) {
    if (componentScores[key] === null) flags.push(MISSING_FLAG_BY_COMPONENT[key]);
  }
  if (
    availableWeight + Number.EPSILON <
    INSTITUTIONAL_ACCUMULATION_MODEL.minimumAvailableWeight
  ) {
    flags.push("INSUFFICIENT_AVAILABLE_WEIGHT");
  }
  const canScore =
    input.dataQuarter !== null &&
    !flags.includes("DATA_QUALITY_INSUFFICIENT") &&
    !flags.includes("INSUFFICIENT_AVAILABLE_WEIGHT");
  const components = Object.fromEntries(
    COMPONENT_KEYS.map((key) => {
      const score = componentScores[key];
      const configuredWeight = INSTITUTIONAL_ACCUMULATION_MODEL.weights[key];
      const effectiveWeight =
        score === null || availableWeight === 0
          ? 0
          : configuredWeight / availableWeight;
      const component: InstitutionalAccumulationScoreComponent = {
        rawValue: values[key],
        score,
        configuredWeight,
        effectiveWeight,
        weightedContribution:
          score === null ? null : score * effectiveWeight,
        available: score !== null,
        explanation: EXPLANATION_BY_COMPONENT[key],
      };
      return [key, component];
    }),
  ) as Record<
    InstitutionalAccumulationComponentKey,
    InstitutionalAccumulationScoreComponent
  >;
  const score = canScore
    ? roundInteger(
        COMPONENT_KEYS.reduce(
          (sum, key) => sum + (components[key].weightedContribution ?? 0),
          0,
        ),
      )
    : null;
  return {
    score,
    modelVersion: INSTITUTIONAL_ACCUMULATION_MODEL.modelVersion,
    components,
    componentScores,
    weights: { ...INSTITUTIONAL_ACCUMULATION_MODEL.weights },
    dataQuarter: input.dataQuarter,
    dataAsOf: input.dataAsOf,
    dataQuality: input.dataQuality,
    insufficientData: score === null,
    insufficientDataFlags: flags,
  };
}

function percentOf(
  numerator: number,
  denominator: number | null,
): number | null {
  if (denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

/**
 * Compose the score from already-computed private stock/trend analytics.
 * Portfolio-weight change remains explicit and optional because the current
 * stock snapshot does not carry a reliable prior-quarter weight denominator.
 */
export function scoreStockInstitutionalAccumulation(
  stock: StockInstitutionalAnalytics,
  trend: StockInstitutionalTrendResult | null,
  portfolioWeightChangePctPoints: number | null = null,
): InstitutionalAccumulationScoreResult {
  const latestTrendQuarter =
    trend?.quarters.find(
      (quarter) => quarter.quarter.label === stock.quarter.label,
    ) ?? null;
  const comparableTrendQuarters =
    trend?.quarters.filter(
      (quarter) => quarter.increaseReductionBalance !== null,
    ) ?? [];
  const positiveTrendQuarterCount = comparableTrendQuarters.filter(
    (quarter) => (quarter.increaseReductionBalance ?? 0) > 0,
  ).length;
  const combinedWarnings = Array.from(
    new Set([
      ...stock.dataQuality.warnings,
      ...(trend?.dataQuality.warnings ?? []),
      "The score describes delayed reported 13F activity and is not a prediction or recommendation.",
      "Manager-quality weighting is excluded from institutional_accumulation_v1.",
    ]),
  );
  const coverageValues = [
    stock.dataQuality.coveragePercent,
    trend?.dataQuality.coveragePercent ?? null,
  ].filter((value): value is number => value !== null);
  return computeInstitutionalAccumulationScore({
    breadthChangePct: percentOf(
      stock.holderCountChange ?? 0,
      stock.holderCountChange === null
        ? null
        : stock.previousReportedHolderCount,
    ),
    aggregateReportedShareChangePct:
      stock.aggregateReportedShareChangePct,
    newlyReportedManagerBreadthPct: percentOf(
      stock.newlyReportedHolderCount,
      stock.previousReportedHolderCount,
    ),
    increaseReductionBalance:
      latestTrendQuarter?.increaseReductionBalance ?? null,
    multiQuarterPersistencePct:
      comparableTrendQuarters.length === 0
        ? null
        : (positiveTrendQuarterCount / comparableTrendQuarters.length) * 100,
    portfolioWeightChangePctPoints,
    dataQuarter: stock.quarter,
    dataAsOf: stock.dataAsOf,
    dataQuality: {
      status:
        stock.dataQuality.status === "insufficient" ||
        trend?.dataQuality.status === "insufficient"
          ? "insufficient"
          : stock.dataQuality.status === "complete" &&
              trend?.dataQuality.status === "complete"
            ? "complete"
            : "partial",
      coveragePercent:
        coverageValues.length === 0
          ? null
          : Math.min(...coverageValues),
      warnings: combinedWarnings,
    },
  });
}

export interface InstitutionalScoringService {
  scoreStock(query: StockAnalyticsQuery): Promise<InstitutionalScoreResult>;
}