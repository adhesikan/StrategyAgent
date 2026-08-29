import type {
  InstitutionalDiscoveryScore,
  MultibaggerDiscoveryInput,
  SignalEvidence,
} from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

export function computeInstitutionalDiscoveryScore(
  input: Pick<
    MultibaggerDiscoveryInput,
    "institutionalAnalytics" | "institutionalTrend"
  >,
): InstitutionalDiscoveryScore {
  const analytics = input.institutionalAnalytics;
  const trend = input.institutionalTrend;
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];

  const analyticsUsable =
    analytics != null &&
    analytics.dataQuality.status !== "insufficient" &&
    analytics.dataQuality.status !== "unavailable";
  const trendUsable =
    trend != null &&
    trend.dataQuality.status !== "insufficient" &&
    trend.dataQuality.status !== "unavailable";

  if (
    analyticsUsable &&
    isFiniteNumberInRange(
      analytics.aggregateReportedShareChangePct,
      Number.NEGATIVE_INFINITY,
    )
  ) {
    evidence.push({
      key: "aggregateReportedShareChangePct",
      label: "Aggregate reported share change",
      value: clampScore(50 + analytics.aggregateReportedShareChangePct * 2),
      available: true,
      explanation: "Normalizes quarter-over-quarter reported share change; it is not a price forecast.",
    });
  } else {
    unavailableSignals.push("aggregate reported share change");
  }

  if (
    analyticsUsable &&
    [
      analytics.newlyReportedHolderCount,
      analytics.increasedReportedHolderCount,
      analytics.reducedReportedHolderCount,
      analytics.noLongerReportedHolderCount,
    ].every((value) => isFiniteNumberInRange(value, 0))
  ) {
    const denominator =
      analytics.newlyReportedHolderCount +
      analytics.increasedReportedHolderCount +
      analytics.reducedReportedHolderCount +
      analytics.noLongerReportedHolderCount;
    if (denominator > 0) {
      const directionalBalance =
        (analytics.newlyReportedHolderCount +
          analytics.increasedReportedHolderCount -
          analytics.reducedReportedHolderCount -
          analytics.noLongerReportedHolderCount) /
        denominator;
      evidence.push({
        key: "directionalHolderBalance",
        label: "Directional holder balance",
        value: clampScore(50 + directionalBalance * 50),
        available: true,
        explanation: "Compares newly reported and increased holders with reduced and exited holders.",
      });
    } else {
      unavailableSignals.push("directional holder balance");
    }
  } else {
    unavailableSignals.push("institutional analytics");
  }

  const trendScores: Record<string, number> = {
    ACCELERATING_ACCUMULATION: 100,
    ACCUMULATION: 85,
    STABLE: 55,
    DISTRIBUTION: 25,
    ACCELERATING_DISTRIBUTION: 0,
  };
  if (
    trendUsable &&
    trend.classification !== "INSUFFICIENT_DATA" &&
    trend.classification in trendScores
  ) {
    evidence.push({
      key: "multiQuarterTrend",
      label: "Multi-quarter institutional trend",
      value: trendScores[trend.classification],
      available: true,
      explanation: `Trend classification is ${trend.classification}.`,
    });
  } else {
    unavailableSignals.push("multi-quarter institutional trend");
  }

  return buildDimensionScore("institutional", evidence, unavailableSignals);
}