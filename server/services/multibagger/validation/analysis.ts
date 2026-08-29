import type {
  ClassificationCohorts,
  GroupedValidationSummary,
  HistoricalSymbolEvaluation,
  HistoricalValidationRunResult,
  HoldingHorizonYears,
  ScoreDistribution,
  TopDecileOutcome,
} from "./types";

function outcomeFor(
  evaluation: HistoricalSymbolEvaluation,
  horizonYears: HoldingHorizonYears,
) {
  return evaluation.outcomes.find(
    (outcome) => outcome.horizonYears === horizonYears,
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

export function selectTopDecileOutcomes(
  result: HistoricalValidationRunResult,
  horizonYears: HoldingHorizonYears,
): TopDecileOutcome[] {
  const observable = result.evaluations
    .filter(
      (evaluation) => evaluation.overallScore !== null,
    )
    .sort(
      (left, right) =>
        (right.overallScore ?? -Infinity) -
          (left.overallScore ?? -Infinity) ||
        left.symbol.localeCompare(right.symbol),
    );
  const count = observable.length === 0
    ? 0
    : Math.max(1, Math.ceil(observable.length * 0.1));
  return observable.slice(0, count).map((evaluation) => {
    const outcome = outcomeFor(evaluation, horizonYears);
    return {
      symbol: evaluation.symbol,
      overallScore: evaluation.overallScore,
      outcomeStatus: outcome?.status ?? "unavailable",
      futureReturnPercent:
        outcome?.status === "available" ? outcome.futureReturnPercent : null,
      unavailableReason:
        outcome?.status === "unavailable"
          ? outcome.unavailableReason
          : outcome
            ? null
            : "HORIZON_NOT_EVALUATED",
      horizonYears,
    };
  });
}

export function classifyValidationCohorts(
  result: HistoricalValidationRunResult,
  options: {
    horizonYears: HoldingHorizonYears;
    scoreThreshold: number;
    outcomeThresholdPercent: number;
  },
): ClassificationCohorts {
  const cohorts: ClassificationCohorts = {
    falsePositives: [],
    falseNegatives: [],
    truePositives: [],
    trueNegatives: [],
    excludedUnavailable: [],
  };
  for (const evaluation of result.evaluations) {
    const outcome = outcomeFor(evaluation, options.horizonYears);
    if (
      evaluation.overallScore === null ||
      !outcome ||
      outcome.status !== "available"
    ) {
      cohorts.excludedUnavailable.push(evaluation.symbol);
      continue;
    }
    const scorePositive =
      evaluation.overallScore >= options.scoreThreshold;
    const outcomePositive =
      outcome.futureReturnPercent >= options.outcomeThresholdPercent;
    if (scorePositive && outcomePositive) {
      cohorts.truePositives.push(evaluation.symbol);
    } else if (scorePositive) {
      cohorts.falsePositives.push(evaluation.symbol);
    } else if (outcomePositive) {
      cohorts.falseNegatives.push(evaluation.symbol);
    } else {
      cohorts.trueNegatives.push(evaluation.symbol);
    }
  }
  return cohorts;
}

export function buildScoreDistribution(
  result: HistoricalValidationRunResult,
  bucketWidth = 10,
): ScoreDistribution {
  if (!Number.isInteger(bucketWidth) || bucketWidth < 1 || bucketWidth > 100) {
    throw new Error("bucketWidth must be an integer from 1 to 100.");
  }
  const buckets = Array.from(
    { length: Math.ceil(100 / bucketWidth) },
    (_, index) => ({
      minimumInclusive: index * bucketWidth,
      maximumBoundary: Math.min(100, (index + 1) * bucketWidth),
      maximumInclusive: index === Math.ceil(100 / bucketWidth) - 1,
      count: 0,
      symbols: [] as string[],
    }),
  );
  const unavailableSymbols: string[] = [];
  for (const evaluation of result.evaluations) {
    if (evaluation.overallScore === null) {
      unavailableSymbols.push(evaluation.symbol);
      continue;
    }
    const index = Math.min(
      buckets.length - 1,
      Math.floor(evaluation.overallScore / bucketWidth),
    );
    buckets[index].count += 1;
    buckets[index].symbols.push(evaluation.symbol);
  }
  return {
    buckets,
    unavailableCount: unavailableSymbols.length,
    unavailableSymbols,
  };
}

function groupSummaries(
  result: HistoricalValidationRunResult,
  horizonYears: HoldingHorizonYears,
  getGroup: (evaluation: HistoricalSymbolEvaluation) => string,
): GroupedValidationSummary[] {
  const groups = new Map<string, HistoricalSymbolEvaluation[]>();
  for (const evaluation of result.evaluations) {
    const group = getGroup(evaluation);
    groups.set(group, [...(groups.get(group) ?? []), evaluation]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, evaluations]) => {
      const scores = evaluations
        .map((evaluation) => evaluation.overallScore)
        .filter((score): score is number => score !== null);
      const returns = evaluations
        .map((evaluation) => outcomeFor(evaluation, horizonYears))
        .filter(
          (
            outcome,
          ): outcome is Extract<
            HistoricalSymbolEvaluation["outcomes"][number],
            { status: "available" }
          > => outcome?.status === "available",
        )
        .map((outcome) => outcome.futureReturnPercent);
      return {
        group,
        symbolCount: evaluations.length,
        scoredSymbolCount: scores.length,
        observableOutcomeCount: returns.length,
        averageScore: rounded(average(scores)),
        averageFutureReturnPercent: rounded(average(returns)),
        medianFutureReturnPercent: rounded(median(returns)),
      };
    });
}

export function groupByMarketCap(
  result: HistoricalValidationRunResult,
  horizonYears: HoldingHorizonYears,
): GroupedValidationSummary[] {
  return groupSummaries(
    result,
    horizonYears,
    (evaluation) => evaluation.metadata.marketCapGroup,
  );
}

export function groupBySector(
  result: HistoricalValidationRunResult,
  horizonYears: HoldingHorizonYears,
): GroupedValidationSummary[] {
  return groupSummaries(
    result,
    horizonYears,
    (evaluation) => evaluation.metadata.sector ?? "UNAVAILABLE",
  );
}

export function groupByInstitutionalDiscoveryStage(
  result: HistoricalValidationRunResult,
  horizonYears: HoldingHorizonYears,
): GroupedValidationSummary[] {
  return groupSummaries(
    result,
    horizonYears,
    (evaluation) =>
      evaluation.metadata.institutionalDiscoveryStage ?? "UNAVAILABLE",
  );
}