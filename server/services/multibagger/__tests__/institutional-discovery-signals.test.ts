import { describe, expect, it, vi } from "vitest";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../../institutional/analytics/types";
import { computeMultibaggerDiscovery } from "../engine";
import {
  buildInstitutionalDiscoverySignalInputs,
  computeInstitutionalDiscoveryScore,
  deriveInstitutionalDiscoveryStage,
  INSTITUTIONAL_DISCOVERY_MODEL,
} from "../institutional-signals";
import {
  createMultibaggerDiscoveryRepository,
  deriveVerifiedSpecialistManagerParticipation,
} from "../repository";
import type {
  InstitutionalDiscoverySignalInputs,
  VerifiedSpecialistManagerParticipation,
} from "../types";

const quarter = {
  year: 2026,
  quarter: 1 as const,
  label: "2026-Q1" as const,
  periodEndDate: "2026-03-31",
};

function stockAnalytics(
  overrides: Partial<StockInstitutionalAnalytics> = {},
): StockInstitutionalAnalytics {
  return {
    symbol: "DISC",
    quarter,
    dataAsOf: "2026-03-31",
    reportingManagerCount: 20,
    reportedHolderCount: 10,
    previousReportedHolderCount: 5,
    holderCountChange: 5,
    newlyReportedHolderCount: 3,
    increasedReportedHolderCount: 5,
    unchangedReportedHolderCount: 1,
    reducedReportedHolderCount: 1,
    noLongerReportedHolderCount: 0,
    aggregateReportedShares: 2_000_000,
    previousAggregateReportedShares: 1_000_000,
    aggregateReportedShareChange: 1_000_000,
    aggregateReportedShareChangePct: 100,
    aggregateReportedValueDollars: 50_000_000,
    averagePortfolioWeight: 0.5,
    medianPortfolioWeight: 0.3,
    topReportedHolders: [],
    largestNewlyReportedPositions: [],
    largestReportedShareIncreases: [],
    largestReportedShareReductions: [],
    noLongerReportedPositions: [],
    mappingCoverage: {
      candidateHoldingCount: 10,
      reliablyMappedHoldingCount: 10,
      unmappedHoldingCount: 0,
      ambiguousHoldingCount: 0,
      classificationUnavailableHoldingCount: 0,
      coveragePercent: 100,
    },
    managerChangeCounts: {
      new: 3,
      increased: 5,
      unchanged: 1,
      reduced: 1,
      exited: 0,
    },
    breadth: null,
    trend: null,
    dataQuality: { status: "complete", coveragePercent: 100, warnings: [] },
    modelVersion: { name: "stock-institutional-analytics", version: "1.0.0" },
    ...overrides,
  };
}

function trendResult(
  classification: StockInstitutionalTrendResult["classification"] =
    "ACCELERATING_ACCUMULATION",
): StockInstitutionalTrendResult {
  return {
    symbol: "DISC",
    quarters: [
      {
        quarter: {
          year: 2025,
          quarter: 4,
          label: "2025-Q4",
          periodEndDate: "2025-12-31",
        },
        reportedHolderCount: 5,
        newlyReportedHolderCount: 1,
        increasedReportedHolderCount: 2,
        reducedReportedHolderCount: 0,
        noLongerReportedHolderCount: 0,
        aggregateReportedShares: 1_000_000,
        aggregateReportedValue: 20_000_000,
        breadthChange: 1,
        shareTrend: 25,
        persistence: 40,
        increaseReductionBalance: 1,
        hasComparablePriorQuarter: true,
      },
      {
        quarter,
        reportedHolderCount: 10,
        newlyReportedHolderCount: 3,
        increasedReportedHolderCount: 5,
        reducedReportedHolderCount: 1,
        noLongerReportedHolderCount: 0,
        aggregateReportedShares: 2_000_000,
        aggregateReportedValue: 50_000_000,
        breadthChange: 5,
        shareTrend: 100,
        persistence: 10,
        increaseReductionBalance: 0.78,
        hasComparablePriorQuarter: true,
      },
    ],
    classification,
    dataQuality: { status: "complete", coveragePercent: 100, warnings: [] },
    modelVersion: { name: "institutional_trend_v1", version: "1.0.0" },
  };
}

const specialistParticipation: VerifiedSpecialistManagerParticipation = {
  verified: true,
  cohorts: ["technology_specialist"],
  verifiedManagerUniverseCount: 5,
  participatingManagerCount: 2,
  participationPercent: 40,
};

function signals(
  overrides: Partial<InstitutionalDiscoverySignalInputs> = {},
): InstitutionalDiscoverySignalInputs {
  return {
    institutionalAccumulationScore: 90,
    institutionalTrend: "ACCELERATING_ACCUMULATION",
    reportedHolderGrowth: 20,
    newManagerBreadth: 15,
    aggregateReportedShareTrend: 30,
    multiQuarterPersistence: 75,
    specialistManagerParticipation: null,
    institutionalDiscoveryStage: "EARLY_DISCOVERY",
    reportedHolderCount: 10,
    accumulationModelVersion: "institutional_accumulation_v1",
    context: {
      scope: "TRACKED_REPORTED_13F_MANAGERS",
      delayedReporting: true,
      eligible: true,
      dataQuarter: "2026-Q1",
      dataAsOf: "2026-03-31",
      analyticsStatus: "complete",
      trendStatus: "complete",
      mappingCoveragePercent: 100,
      trendCoveragePercent: 100,
      reportingManagerCount: 20,
      warnings: [
        "Form 13F data is delayed and covers reported positions for tracked managers only.",
      ],
    },
    ...overrides,
  };
}

describe("institutional discovery signal assembly", () => {
  it("reuses institutional_accumulation_v1 and exposes every requested input", () => {
    const result = buildInstitutionalDiscoverySignalInputs({
      institutionalAnalytics: stockAnalytics(),
      institutionalTrend: trendResult(),
      specialistManagerParticipation: specialistParticipation,
    });
    expect(result.institutionalAccumulationScore).toBeGreaterThan(80);
    expect(result.accumulationModelVersion).toBe(
      "institutional_accumulation_v1",
    );
    expect(result.institutionalTrend).toBe("ACCELERATING_ACCUMULATION");
    expect(result.reportedHolderGrowth).toBe(100);
    expect(result.newManagerBreadth).toBe(60);
    expect(result.aggregateReportedShareTrend).toBe(100);
    expect(result.multiQuarterPersistence).toBe(100);
    expect(result.specialistManagerParticipation).toEqual(
      specialistParticipation,
    );
    expect(result.institutionalDiscoveryStage).toBe("EARLY_DISCOVERY");
    expect(result.context).toMatchObject({
      scope: "TRACKED_REPORTED_13F_MANAGERS",
      delayedReporting: true,
      eligible: true,
      dataQuarter: "2026-Q1",
      mappingCoveragePercent: 100,
    });
  });

  it.each(["partial", "insufficient"] as const)(
    "marks %s institutional analytics unavailable",
    (status) => {
    const result = buildInstitutionalDiscoverySignalInputs({
      institutionalAnalytics: stockAnalytics({
        dataQuality: {
          status,
          coveragePercent: status === "partial" ? 89 : 20,
          warnings: ["coverage"],
        },
      }),
      institutionalTrend: {
        ...trendResult(),
        dataQuality: {
          status,
          coveragePercent: status === "partial" ? 89 : 20,
          warnings: ["coverage"],
        },
      },
    });
    expect(result.institutionalAccumulationScore).toBeNull();
    expect(result.institutionalTrend).toBeNull();
    expect(result.reportedHolderGrowth).toBeNull();
    expect(result.institutionalDiscoveryStage).toBeNull();
    expect(result.context.eligible).toBe(false);
    expect(result.context.warnings).toContain("coverage");
  });
});

describe("institutional discovery stages", () => {
  it.each([
    [0, "EARLY_DISCOVERY"],
    [12, "EARLY_DISCOVERY"],
    [13, "EXPANDING_PARTICIPATION"],
    [39, "EXPANDING_PARTICIPATION"],
    [40, "BROAD_CONSENSUS"],
    [79, "BROAD_CONSENSUS"],
    [80, "MATURE_OR_CROWDED"],
    [200, "MATURE_OR_CROWDED"],
  ] as const)("classifies %i reported holders as %s", (holders, expected) => {
    expect(deriveInstitutionalDiscoveryStage(holders)).toBe(expected);
  });

  it("does not classify missing or invalid holder breadth", () => {
    expect(deriveInstitutionalDiscoveryStage(null)).toBeNull();
    expect(deriveInstitutionalDiscoveryStage(-1)).toBeNull();
    expect(deriveInstitutionalDiscoveryStage(Number.NaN)).toBeNull();
  });
});

describe("deterministic Institutional Discovery Score", () => {
  it("favors increasing, persistent, broadening participation", () => {
    const strong = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals(),
    });
    const weak = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        institutionalAccumulationScore: 20,
        institutionalTrend: "DISTRIBUTION",
        reportedHolderGrowth: -20,
        newManagerBreadth: 0,
        aggregateReportedShareTrend: -40,
        multiQuarterPersistence: 10,
      }),
    });
    expect(strong.score).toBeGreaterThan(80);
    expect(strong.score).toBeGreaterThan(weak.score!);
    expect(strong.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "PARTICIPATION_INCREASING",
        "REPORTED_SHARES_INCREASING",
        "PERSISTENT_PARTICIPATION",
        "BREADTH_EXPANDING",
      ]),
    );
    expect(weak.reasons.map((reason) => reason.code)).toContain(
      "PARTICIPATION_WEAKENING",
    );
  });

  it("applies a maturity/crowding caution rather than assuming more holders is always better", () => {
    const early = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        institutionalDiscoveryStage: "EARLY_DISCOVERY",
        reportedHolderCount: 10,
      }),
    });
    const crowded = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        institutionalDiscoveryStage: "MATURE_OR_CROWDED",
        reportedHolderCount: 100,
      }),
    });
    expect(crowded.score).toBe(
      early.score! - INSTITUTIONAL_DISCOVERY_MODEL.matureOrCrowdedPenalty,
    );
    expect(crowded.reasons).toContainEqual(
      expect.objectContaining({
        code: "MATURE_OR_CROWDED_CAUTION",
        direction: "caution",
      }),
    );
  });

  it("returns structured, weighted, deterministic evidence", () => {
    const first = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        specialistManagerParticipation: specialistParticipation,
      }),
    });
    const second = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        specialistManagerParticipation: specialistParticipation,
      }),
    });
    expect(first).toEqual(second);
    expect(first.evidence).toHaveLength(7);
    expect(first.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "institutionalAccumulationScore",
          rawValue: 90,
          normalizedScore: 90,
          source: "institutional_accumulation_v1",
          direction: "positive",
        }),
        expect.objectContaining({
          key: "specialistManagerParticipation",
          rawValue: 2,
          normalizedScore: 40,
          source: "verified_manager_cohort",
        }),
      ]),
    );
    expect(first.reasons.map((reason) => reason.code)).toContain(
      "VERIFIED_SPECIALIST_PARTICIPATION",
    );
  });

  it("does not fabricate a score below the minimum available evidence weight", () => {
    const result = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        institutionalAccumulationScore: null,
        institutionalTrend: null,
        reportedHolderGrowth: null,
        newManagerBreadth: null,
        aggregateReportedShareTrend: null,
        multiQuarterPersistence: 80,
        specialistManagerParticipation: null,
        accumulationModelVersion: null,
      }),
    });
    expect(result.score).toBeNull();
    expect(result.availability).toBe("unavailable");
  });

  it("marks malformed explicit signal values unavailable instead of returning NaN", () => {
    const result = computeInstitutionalDiscoveryScore({
      institutionalSignals: signals({
        institutionalAccumulationScore: Number.NaN,
        reportedHolderGrowth: Number.POSITIVE_INFINITY,
        newManagerBreadth: -1,
        aggregateReportedShareTrend: -101,
        multiQuarterPersistence: 101,
        specialistManagerParticipation: {
          verified: true,
          cohorts: ["technology_specialist"],
          verifiedManagerUniverseCount: 1,
          participatingManagerCount: 2,
          participationPercent: 200,
        },
      }),
    });
    expect(result.score).toBeNull();
    expect(result.evidence.filter((item) => item.available).map(
      (item) => item.key,
    )).toEqual(["institutionalTrend"]);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("exposes the requested top-level institutionalDiscovery object", () => {
    const result = computeMultibaggerDiscovery({
      symbol: "DISC",
      institutionalSignals: signals(),
    });
    expect(result.institutionalDiscovery).toBe(result.dimensions.institutional);
    expect(result.institutionalDiscovery).toMatchObject({
      score: expect.any(Number),
      stage: "EARLY_DISCOVERY",
      evidence: expect.any(Array),
      modelVersion: "multibagger_v1",
    });
  });
});

describe("institutional signal repository composition", () => {
  it("composes analytics, trend, accumulation, and verified specialist inputs", async () => {
    const getSpecialistManagerParticipation = vi.fn(
      async () => specialistParticipation,
    );
    const repository = createMultibaggerDiscoveryRepository({
      getInstitutionalAnalytics: async () => stockAnalytics(),
      getInstitutionalTrend: async () => trendResult(),
      getSpecialistManagerParticipation,
    });
    const loaded = await repository.load("DISC");
    expect(getSpecialistManagerParticipation).toHaveBeenCalledWith("DISC");
    expect(loaded.institutionalSignals).toMatchObject({
      institutionalAccumulationScore: expect.any(Number),
      institutionalTrend: "ACCELERATING_ACCUMULATION",
      institutionalDiscoveryStage: "EARLY_DISCOVERY",
      specialistManagerParticipation: specialistParticipation,
    });
  });

  const membership = (
    managerId: string,
    classificationMethod: "VERIFIED" | "MANUAL",
  ) => ({
    managerId,
    cohort: "technology_specialist" as const,
    classificationMethod,
    confidence: 100,
    status: "ACTIVE" as const,
    source: classificationMethod === "VERIFIED" ? "reviewed source" : null,
    notes: null,
    ruleId: null,
    lastReviewedAt: "2026-01-01T00:00:00.000Z",
  });

  it("counts only active verified specialist memberships", () => {
    const analytics = stockAnalytics({
      reportedHolderCount: 2,
      topReportedHolders: [
        { managerId: "verified" },
        { managerId: "manual" },
      ] as StockInstitutionalAnalytics["topReportedHolders"],
    });
    const result = deriveVerifiedSpecialistManagerParticipation([
      {
        cohort: "technology_specialist",
        memberships: [
          membership("verified", "VERIFIED"),
          membership("manual", "MANUAL"),
        ],
        analytics,
      },
    ]);
    expect(result).toMatchObject({
      verifiedManagerUniverseCount: 1,
      participatingManagerCount: 1,
      participationPercent: 100,
    });
  });

  it("rejects truncated or partial specialist analytics", () => {
    const truncated = stockAnalytics({
      reportedHolderCount: 2,
      topReportedHolders: [
        { managerId: "verified" },
      ] as StockInstitutionalAnalytics["topReportedHolders"],
    });
    const partial = stockAnalytics({
      reportedHolderCount: 1,
      topReportedHolders: [
        { managerId: "verified" },
      ] as StockInstitutionalAnalytics["topReportedHolders"],
      dataQuality: { status: "partial", coveragePercent: 89, warnings: [] },
    });
    for (const analytics of [truncated, partial]) {
      expect(deriveVerifiedSpecialistManagerParticipation([
        {
          cohort: "technology_specialist",
          memberships: [membership("verified", "VERIFIED")],
          analytics,
        },
      ])).toBeNull();
    }
  });

  it("returns unavailable when no verified specialist membership exists", () => {
    expect(deriveVerifiedSpecialistManagerParticipation([
      {
        cohort: "technology_specialist",
        memberships: [membership("manual", "MANUAL")],
        analytics: stockAnalytics(),
      },
    ])).toBeNull();
  });
});