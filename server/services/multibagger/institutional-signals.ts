import { scoreStockInstitutionalAccumulation } from "../institutional/analytics";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendClassification,
  StockInstitutionalTrendResult,
} from "../institutional/analytics/types";
import type {
  InstitutionalDiscoveryEvidence,
  InstitutionalDiscoveryReason,
  InstitutionalDiscoveryScore,
  InstitutionalDiscoverySignalInputs,
  InstitutionalDiscoveryStage,
  MultibaggerDiscoveryInput,
  VerifiedSpecialistManagerParticipation,
} from "./types";
import { MULTIBAGGER_MODEL_VERSION } from "./types";
import {
  clampScore,
  isFiniteNumberInRange,
  scoreAvailability,
} from "./scoring";

export const INSTITUTIONAL_DISCOVERY_MODEL = {
  modelVersion: MULTIBAGGER_MODEL_VERSION,
  minimumAvailableWeight: 0.65,
  minimumCoveragePercent: 90,
  matureOrCrowdedPenalty: 12,
  stageThresholds: {
    earlyDiscoveryMaximumHolders: 12,
    broadConsensusMinimumHolders: 40,
    matureOrCrowdedMinimumHolders: 80,
  },
  weights: {
    institutionalAccumulationScore: 0.25,
    institutionalTrend: 0.15,
    reportedHolderGrowth: 0.15,
    newManagerBreadth: 0.10,
    aggregateReportedShareTrend: 0.15,
    multiQuarterPersistence: 0.15,
    specialistManagerParticipation: 0.05,
  },
} as const;

type InstitutionalSignalKey = keyof typeof INSTITUTIONAL_DISCOVERY_MODEL.weights;

function percentOf(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    !isFiniteNumberInRange(numerator, Number.NEGATIVE_INFINITY) ||
    !isFiniteNumberInRange(denominator, Number.MIN_VALUE)
  ) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function latestComparableQuarter(
  analytics: StockInstitutionalAnalytics,
  trend: StockInstitutionalTrendResult | null | undefined,
) {
  return trend?.quarters.find(
    (quarter) => quarter.quarter.label === analytics.quarter.label,
  ) ?? null;
}

function hasEligibleCoverage(
  status: "complete" | "partial" | "insufficient" | "unavailable",
  coveragePercent: number | null,
): boolean {
  return (
    status === "complete" &&
    isFiniteNumberInRange(
      coveragePercent,
      INSTITUTIONAL_DISCOVERY_MODEL.minimumCoveragePercent,
      100,
    )
  );
}

export function isInstitutionalAnalyticsEligible(
  analytics: StockInstitutionalAnalytics | null | undefined,
): analytics is StockInstitutionalAnalytics {
  return (
    analytics != null &&
    hasEligibleCoverage(
      analytics.dataQuality.status,
      analytics.dataQuality.coveragePercent,
    ) &&
    isFiniteNumberInRange(
      analytics.mappingCoverage.coveragePercent,
      INSTITUTIONAL_DISCOVERY_MODEL.minimumCoveragePercent,
      100,
    )
  );
}

function isInstitutionalTrendEligible(
  trend: StockInstitutionalTrendResult | null | undefined,
): trend is StockInstitutionalTrendResult {
  return (
    trend != null &&
    hasEligibleCoverage(
      trend.dataQuality.status,
      trend.dataQuality.coveragePercent,
    )
  );
}

export function deriveInstitutionalDiscoveryStage(
  reportedHolderCount: number | null,
): InstitutionalDiscoveryStage | null {
  if (!isFiniteNumberInRange(reportedHolderCount, 0)) return null;
  if (
    reportedHolderCount >=
    INSTITUTIONAL_DISCOVERY_MODEL.stageThresholds.matureOrCrowdedMinimumHolders
  ) {
    return "MATURE_OR_CROWDED";
  }
  if (
    reportedHolderCount >=
    INSTITUTIONAL_DISCOVERY_MODEL.stageThresholds.broadConsensusMinimumHolders
  ) {
    return "BROAD_CONSENSUS";
  }
  if (
    reportedHolderCount <=
    INSTITUTIONAL_DISCOVERY_MODEL.stageThresholds.earlyDiscoveryMaximumHolders
  ) {
    return "EARLY_DISCOVERY";
  }
  return "EXPANDING_PARTICIPATION";
}

export function buildInstitutionalDiscoverySignalInputs(input: {
  institutionalAnalytics?: StockInstitutionalAnalytics | null;
  institutionalTrend?: StockInstitutionalTrendResult | null;
  specialistManagerParticipation?: VerifiedSpecialistManagerParticipation | null;
}): InstitutionalDiscoverySignalInputs {
  const analytics = input.institutionalAnalytics;
  const trend = input.institutionalTrend;
  const analyticsUsable = isInstitutionalAnalyticsEligible(analytics);
  const trendUsable = isInstitutionalTrendEligible(trend);
  const accumulation = analyticsUsable
    ? scoreStockInstitutionalAccumulation(
        analytics,
        trendUsable ? trend : null,
      )
    : null;
  const currentTrendQuarter =
    analyticsUsable && trendUsable
      ? latestComparableQuarter(analytics, trend)
      : null;
  const comparableTrendQuarters = trendUsable
    ? trend.quarters.filter(
        (quarter) => quarter.increaseReductionBalance !== null,
      )
    : [];
  const positiveQuarterCount = comparableTrendQuarters.filter(
    (quarter) => (quarter.increaseReductionBalance ?? 0) > 0,
  ).length;
  const reportedHolderCount =
    analyticsUsable &&
    isFiniteNumberInRange(analytics.reportedHolderCount, 0)
      ? analytics.reportedHolderCount
      : null;
  const warnings = Array.from(
    new Set([
      ...(analytics?.dataQuality.warnings ?? []),
      ...(trend?.dataQuality.warnings ?? []),
      "Form 13F data is delayed and covers reported positions for tracked managers only.",
      "Discovery stages do not represent total institutional ownership.",
    ]),
  );
  return {
    institutionalAccumulationScore: accumulation?.score ?? null,
    institutionalTrend:
      trendUsable && trend.classification !== "INSUFFICIENT_DATA"
        ? trend.classification
        : null,
    reportedHolderGrowth: analyticsUsable
      ? percentOf(
          analytics.holderCountChange,
          analytics.previousReportedHolderCount,
        )
      : null,
    newManagerBreadth: analyticsUsable
      ? percentOf(
          analytics.newlyReportedHolderCount,
          analytics.previousReportedHolderCount,
        )
      : null,
    aggregateReportedShareTrend:
      analyticsUsable &&
      isFiniteNumberInRange(
        analytics.aggregateReportedShareChangePct,
        Number.NEGATIVE_INFINITY,
      )
        ? analytics.aggregateReportedShareChangePct
        : currentTrendQuarter?.shareTrend ?? null,
    multiQuarterPersistence:
      comparableTrendQuarters.length > 0
        ? (positiveQuarterCount / comparableTrendQuarters.length) * 100
        : null,
    specialistManagerParticipation:
      input.specialistManagerParticipation?.verified === true
        ? input.specialistManagerParticipation
        : null,
    institutionalDiscoveryStage:
      deriveInstitutionalDiscoveryStage(reportedHolderCount),
    reportedHolderCount,
    accumulationModelVersion: accumulation?.modelVersion ?? null,
    context: {
      scope: "TRACKED_REPORTED_13F_MANAGERS",
      delayedReporting: true,
      eligible: analyticsUsable && trendUsable,
      dataQuarter: analytics?.quarter.label ?? null,
      dataAsOf: analytics?.dataAsOf ?? null,
      analyticsStatus: analytics?.dataQuality.status ?? "unavailable",
      trendStatus: trend?.dataQuality.status ?? null,
      mappingCoveragePercent:
        analytics?.mappingCoverage.coveragePercent ?? null,
      trendCoveragePercent: trend?.dataQuality.coveragePercent ?? null,
      reportingManagerCount:
        analytics &&
        isFiniteNumberInRange(analytics.reportingManagerCount, 0)
          ? analytics.reportingManagerCount
          : null,
      warnings,
    },
  };
}

function directionalScore(value: number, saturation: number): number {
  const bounded = Math.max(-saturation, Math.min(saturation, value));
  return clampScore(50 + (bounded / saturation) * 50);
}

function trendScore(
  trend: StockInstitutionalTrendClassification | null,
): number | null {
  if (!trend || trend === "INSUFFICIENT_DATA") return null;
  return {
    ACCELERATING_ACCUMULATION: 100,
    ACCUMULATION: 85,
    STABLE: 50,
    DISTRIBUTION: 20,
    ACCELERATING_DISTRIBUTION: 0,
  }[trend];
}

function normalizedSignalScore(
  key: InstitutionalSignalKey,
  signals: InstitutionalDiscoverySignalInputs,
): { rawValue: number | string | null; score: number | null } {
  switch (key) {
    case "institutionalAccumulationScore": {
      const value = isFiniteNumberInRange(
        signals.institutionalAccumulationScore,
        0,
        100,
      )
        ? signals.institutionalAccumulationScore
        : null;
      return {
        rawValue: value,
        score: value,
      };
    }
    case "institutionalTrend":
      return {
        rawValue: signals.institutionalTrend,
        score: trendScore(signals.institutionalTrend),
      };
    case "reportedHolderGrowth": {
      const value = isFiniteNumberInRange(
        signals.reportedHolderGrowth,
        -100,
        10_000,
      )
        ? signals.reportedHolderGrowth
        : null;
      return {
        rawValue: value,
        score: value === null ? null : directionalScore(value, 25),
      };
    }
    case "newManagerBreadth": {
      const value = isFiniteNumberInRange(
        signals.newManagerBreadth,
        0,
        10_000,
      )
        ? signals.newManagerBreadth
        : null;
      return {
        rawValue: value,
        score: value === null
          ? null
          : clampScore((value / 25) * 100),
      };
    }
    case "aggregateReportedShareTrend": {
      const value = isFiniteNumberInRange(
        signals.aggregateReportedShareTrend,
        -100,
        10_000,
      )
        ? signals.aggregateReportedShareTrend
        : null;
      return {
        rawValue: value,
        score: value === null ? null : directionalScore(value, 50),
      };
    }
    case "multiQuarterPersistence": {
      const value = isFiniteNumberInRange(
        signals.multiQuarterPersistence,
        0,
        100,
      )
        ? signals.multiQuarterPersistence
        : null;
      return {
        rawValue: value,
        score: value === null ? null : clampScore(value),
      };
    }
    case "specialistManagerParticipation": {
      const participation = signals.specialistManagerParticipation;
      const valid =
        participation?.verified === true &&
        isFiniteNumberInRange(participation.verifiedManagerUniverseCount, 1) &&
        isFiniteNumberInRange(
          participation.participatingManagerCount,
          0,
          participation.verifiedManagerUniverseCount,
        ) &&
        isFiniteNumberInRange(participation.participationPercent, 0, 100);
      return {
        rawValue: valid ? participation.participatingManagerCount : null,
        score: valid ? clampScore(participation.participationPercent) : null,
      };
    }
  }
}

const SIGNAL_LABELS: Record<InstitutionalSignalKey, string> = {
  institutionalAccumulationScore: "Institutional accumulation score",
  institutionalTrend: "Institutional trend",
  reportedHolderGrowth: "Reported holder growth",
  newManagerBreadth: "New manager breadth",
  aggregateReportedShareTrend: "Aggregate reported share trend",
  multiQuarterPersistence: "Multi-quarter persistence",
  specialistManagerParticipation: "Verified specialist manager participation",
};

const SIGNAL_SOURCES: Record<
  InstitutionalSignalKey,
  InstitutionalDiscoveryEvidence["source"]
> = {
  institutionalAccumulationScore: "institutional_accumulation_v1",
  institutionalTrend: "institutional_trend_v1",
  reportedHolderGrowth: "stock_institutional_analytics",
  newManagerBreadth: "stock_institutional_analytics",
  aggregateReportedShareTrend: "stock_institutional_analytics",
  multiQuarterPersistence: "institutional_trend_v1",
  specialistManagerParticipation: "verified_manager_cohort",
};

function directionForScore(
  score: number | null,
): InstitutionalDiscoveryEvidence["direction"] {
  if (score === null) return "unavailable";
  if (score >= 65) return "positive";
  if (score <= 35) return "caution";
  return "neutral";
}

function buildReasons(
  signals: InstitutionalDiscoverySignalInputs,
): InstitutionalDiscoveryReason[] {
  const reasons: InstitutionalDiscoveryReason[] = [];
  if ((signals.reportedHolderGrowth ?? 0) > 0) {
    reasons.push({
      code: "PARTICIPATION_INCREASING",
      direction: "positive",
      summary: "Reported holder participation increased versus the comparable quarter.",
      evidenceKeys: ["reportedHolderGrowth"],
    });
  }
  if ((signals.aggregateReportedShareTrend ?? 0) > 0) {
    reasons.push({
      code: "REPORTED_SHARES_INCREASING",
      direction: "positive",
      summary: "Aggregate reported share counts increased.",
      evidenceKeys: ["aggregateReportedShareTrend"],
    });
  }
  if ((signals.multiQuarterPersistence ?? 0) >= 60) {
    reasons.push({
      code: "PERSISTENT_PARTICIPATION",
      direction: "positive",
      summary: "Positive participation persisted across most comparable quarters.",
      evidenceKeys: ["multiQuarterPersistence"],
    });
  }
  if ((signals.newManagerBreadth ?? 0) > 0) {
    reasons.push({
      code: "BREADTH_EXPANDING",
      direction: "positive",
      summary: "Newly reported managers expanded institutional breadth.",
      evidenceKeys: ["newManagerBreadth"],
    });
  }
  if (
    (signals.specialistManagerParticipation?.participatingManagerCount ?? 0) > 0
  ) {
    reasons.push({
      code: "VERIFIED_SPECIALIST_PARTICIPATION",
      direction: "positive",
      summary: "At least one verified specialist manager reported a position.",
      evidenceKeys: ["specialistManagerParticipation"],
    });
  }
  if (
    (signals.reportedHolderGrowth ?? 0) < 0 ||
    (signals.aggregateReportedShareTrend ?? 0) < 0
  ) {
    reasons.push({
      code: "PARTICIPATION_WEAKENING",
      direction: "caution",
      summary: "One or more reported participation measures weakened.",
      evidenceKeys: [
        "reportedHolderGrowth",
        "aggregateReportedShareTrend",
      ],
    });
  }
  if (signals.institutionalDiscoveryStage === "MATURE_OR_CROWDED") {
    reasons.push({
      code: "MATURE_OR_CROWDED_CAUTION",
      direction: "caution",
      summary: "Broad participation among covered reported 13F managers can indicate maturity or crowding; additional reported participation is not automatically favorable.",
      evidenceKeys: ["institutionalDiscoveryStage", "reportedHolderCount"],
    });
  }
  return reasons;
}

export function computeInstitutionalDiscoveryScore(
  input: Pick<
    MultibaggerDiscoveryInput,
    | "institutionalAnalytics"
    | "institutionalTrend"
    | "institutionalSignals"
    | "specialistManagerParticipation"
  >,
): InstitutionalDiscoveryScore {
  const suppliedSignals = input.institutionalSignals ??
    buildInstitutionalDiscoverySignalInputs(input);
  const signals = suppliedSignals.context.eligible
    ? suppliedSignals
    : {
        ...suppliedSignals,
        institutionalDiscoveryStage: null,
      };
  const keys = Object.keys(
    INSTITUTIONAL_DISCOVERY_MODEL.weights,
  ) as InstitutionalSignalKey[];
  const scored = keys.map((key) => ({
    key,
    weight: INSTITUTIONAL_DISCOVERY_MODEL.weights[key],
    ...normalizedSignalScore(key, signals),
  }));
  const availableWeight = scored.reduce(
    (sum, item) => sum + (item.score === null ? 0 : item.weight),
    0,
  );
  const evidence: InstitutionalDiscoveryEvidence[] = scored.map((item) => {
    const effectiveWeight =
      item.score === null || availableWeight === 0
        ? 0
        : item.weight / availableWeight;
    return {
      key: item.key,
      label: SIGNAL_LABELS[item.key],
      value: item.score,
      rawValue: item.rawValue,
      normalizedScore: item.score,
      available: item.score !== null,
      configuredWeight: item.weight,
      effectiveWeight,
      weightedContribution:
        item.score === null ? null : item.score * effectiveWeight,
      direction: directionForScore(item.score),
      source: SIGNAL_SOURCES[item.key],
      explanation: `${SIGNAL_LABELS[item.key]} is normalized deterministically for ${MULTIBAGGER_MODEL_VERSION}.`,
    };
  });
  const unavailableSignals = evidence
    .filter((item) => !item.available)
    .map((item) => item.key);
  let score =
    signals.context.eligible &&
    availableWeight + Number.EPSILON >=
    INSTITUTIONAL_DISCOVERY_MODEL.minimumAvailableWeight
      ? clampScore(
          evidence.reduce(
            (sum, item) => sum + (item.weightedContribution ?? 0),
            0,
          ),
        )
      : null;
  if (
    score !== null &&
    signals.institutionalDiscoveryStage === "MATURE_OR_CROWDED"
  ) {
    score = clampScore(
      score - INSTITUTIONAL_DISCOVERY_MODEL.matureOrCrowdedPenalty,
    );
  }
  return {
    dimension: "institutional",
    score,
    availability: score === null
      ? "unavailable"
      : scoreAvailability(evidence, unavailableSignals),
    stage: signals.institutionalDiscoveryStage,
    signals,
    evidence,
    reasons: buildReasons(signals),
    unavailableSignals,
    modelVersion: MULTIBAGGER_MODEL_VERSION,
  };
}