import { describe, expect, it } from "vitest";
import {
  computeInstitutionalAccumulationScore,
  INSTITUTIONAL_ACCUMULATION_MODEL,
  scoreInstitutionalAccumulationComponent,
  scoreStockInstitutionalAccumulation,
  type InstitutionalAccumulationScoreInput,
  type InstitutionalQuarter,
  type StockInstitutionalAnalytics,
  type StockInstitutionalTrendResult,
} from "../analytics";

const QUARTER: InstitutionalQuarter = {
  year: 2026,
  quarter: 2,
  label: "2026-Q2",
  periodEndDate: "2026-06-30",
};

const COMPLETE_QUALITY = {
  status: "complete" as const,
  coveragePercent: 100,
  warnings: [],
};

function scoreInput(
  overrides: Partial<InstitutionalAccumulationScoreInput> = {},
): InstitutionalAccumulationScoreInput {
  return {
    breadthChangePct: 0,
    aggregateReportedShareChangePct: 0,
    newlyReportedManagerBreadthPct: 12.5,
    increaseReductionBalance: 0,
    multiQuarterPersistencePct: 50,
    portfolioWeightChangePctPoints: 0,
    dataQuarter: QUARTER,
    dataAsOf: QUARTER.periodEndDate,
    dataQuality: COMPLETE_QUALITY,
    ...overrides,
  };
}

describe("institutional_accumulation_v1 component transforms", () => {
  it.each([
    ["breadthChange", -25, 0],
    ["breadthChange", 0, 50],
    ["breadthChange", 25, 100],
    ["breadthChange", 100, 100],
    ["reportedShareChange", -50, 0],
    ["reportedShareChange", 0, 50],
    ["reportedShareChange", 50, 100],
    ["reportedShareChange", -100, 0],
    ["newManagerBreadth", 0, 0],
    ["newManagerBreadth", 12.5, 50],
    ["newManagerBreadth", 25, 100],
    ["newManagerBreadth", 100, 100],
    ["increaseReductionBalance", -1, 0],
    ["increaseReductionBalance", 0, 50],
    ["increaseReductionBalance", 1, 100],
    ["increaseReductionBalance", 2, 100],
    ["multiQuarterPersistence", 0, 0],
    ["multiQuarterPersistence", 50, 50],
    ["multiQuarterPersistence", 100, 100],
    ["multiQuarterPersistence", -1, 0],
    ["portfolioWeightChange", -2, 0],
    ["portfolioWeightChange", 0, 50],
    ["portfolioWeightChange", 2, 100],
    ["portfolioWeightChange", 20, 100],
  ] as const)(
    "%s maps raw boundary %s to %s",
    (component, rawValue, expected) => {
      expect(
        scoreInstitutionalAccumulationComponent(component, rawValue),
      ).toBe(expected);
    },
  );

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns null for unavailable raw value %s",
    (value) => {
      expect(
        scoreInstitutionalAccumulationComponent("breadthChange", value),
      ).toBeNull();
    },
  );
});

describe("institutional_accumulation_v1 weighted score", () => {
  it("defines configured weights that total exactly one model unit", () => {
    const total = Object.values(
      INSTITUTIONAL_ACCUMULATION_MODEL.weights,
    ).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(INSTITUTIONAL_ACCUMULATION_MODEL.managerQualityWeighting).toBe(
      false,
    );
  });

  it("returns the 0 score boundary when every component is at its floor", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({
        breadthChangePct: -25,
        aggregateReportedShareChangePct: -50,
        newlyReportedManagerBreadthPct: 0,
        increaseReductionBalance: -1,
        multiQuarterPersistencePct: 0,
        portfolioWeightChangePctPoints: -2,
      }),
    );
    expect(result.score).toBe(0);
    expect(Object.values(result.componentScores)).toEqual([
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  it("returns the 100 score boundary when every component is at its ceiling", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({
        breadthChangePct: 25,
        aggregateReportedShareChangePct: 50,
        newlyReportedManagerBreadthPct: 25,
        increaseReductionBalance: 1,
        multiQuarterPersistencePct: 100,
        portfolioWeightChangePctPoints: 2,
      }),
    );
    expect(result.score).toBe(100);
    expect(Object.values(result.componentScores)).toEqual([
      100,
      100,
      100,
      100,
      100,
      100,
    ]);
  });

  it("reproduces the final score from component scores and effective weights", () => {
    const result = computeInstitutionalAccumulationScore(scoreInput());
    const reproduced = Object.values(result.components).reduce(
      (sum, component) =>
        sum + (component.weightedContribution ?? 0),
      0,
    );
    expect(result.score).toBe(50);
    expect(result.score).toBe(Math.round(reproduced));
    expect(
      Object.values(result.components).reduce(
        (sum, component) => sum + component.effectiveWeight,
        0,
      ),
    ).toBeCloseTo(1, 12);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("produces deeply identical output for identical input", () => {
    const input = scoreInput({
      breadthChangePct: 8.25,
      aggregateReportedShareChangePct: 17.75,
    });
    expect(computeInstitutionalAccumulationScore(input)).toEqual(
      computeInstitutionalAccumulationScore(input),
    );
  });

  it("renormalizes available weights when one optional component is missing", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({ portfolioWeightChangePctPoints: null }),
    );
    expect(result.score).toBe(50);
    expect(result.insufficientData).toBe(false);
    expect(result.insufficientDataFlags).toContain(
      "MISSING_PORTFOLIO_WEIGHT_CHANGE",
    );
    expect(result.components.portfolioWeightChange).toMatchObject({
      rawValue: null,
      score: null,
      effectiveWeight: 0,
      weightedContribution: null,
      available: false,
    });
    expect(
      Object.values(result.components).reduce(
        (sum, component) => sum + component.effectiveWeight,
        0,
      ),
    ).toBeCloseTo(1, 12);
  });

  it("returns null when available component weight is below the model minimum", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({
        newlyReportedManagerBreadthPct: null,
        increaseReductionBalance: null,
        multiQuarterPersistencePct: null,
        portfolioWeightChangePctPoints: null,
      }),
    );
    expect(result.score).toBeNull();
    expect(result.insufficientData).toBe(true);
    expect(result.insufficientDataFlags).toContain(
      "INSUFFICIENT_AVAILABLE_WEIGHT",
    );
  });

  it("returns null when data quality is insufficient despite complete components", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({
        dataQuality: {
          status: "insufficient",
          coveragePercent: 20,
          warnings: ["Insufficient mapping coverage."],
        },
      }),
    );
    expect(result.score).toBeNull();
    expect(result.insufficientDataFlags).toContain(
      "DATA_QUALITY_INSUFFICIENT",
    );
  });

  it("returns null without a data quarter", () => {
    const result = computeInstitutionalAccumulationScore(
      scoreInput({ dataQuarter: null }),
    );
    expect(result.score).toBeNull();
    expect(result.insufficientDataFlags).toContain("MISSING_DATA_QUARTER");
  });
});

function stockAnalytics(): StockInstitutionalAnalytics {
  return {
    symbol: "XYZ",
    quarter: QUARTER,
    dataAsOf: QUARTER.periodEndDate,
    reportingManagerCount: 12,
    reportedHolderCount: 12,
    previousReportedHolderCount: 10,
    holderCountChange: 2,
    newlyReportedHolderCount: 2,
    increasedReportedHolderCount: 5,
    unchangedReportedHolderCount: 3,
    reducedReportedHolderCount: 1,
    noLongerReportedHolderCount: 1,
    aggregateReportedShares: 1_300,
    previousAggregateReportedShares: 1_000,
    aggregateReportedShareChange: 300,
    aggregateReportedShareChangePct: 30,
    aggregateReportedValueDollars: 10_000,
    averagePortfolioWeight: 3,
    medianPortfolioWeight: 2,
    topReportedHolders: [],
    largestNewlyReportedPositions: [],
    largestReportedShareIncreases: [],
    largestReportedShareReductions: [],
    noLongerReportedPositions: [],
    mappingCoverage: {
      candidateHoldingCount: 12,
      reliablyMappedHoldingCount: 12,
      unmappedHoldingCount: 0,
      ambiguousHoldingCount: 0,
      classificationUnavailableHoldingCount: 0,
      coveragePercent: 100,
    },
    managerChangeCounts: {
      new: 2,
      increased: 5,
      unchanged: 3,
      reduced: 1,
      exited: 1,
    },
    breadth: null,
    trend: null,
    dataQuality: COMPLETE_QUALITY,
    modelVersion: { name: "stock-institutional-analytics", version: "1.0.0" },
  };
}

function trendResult(): StockInstitutionalTrendResult {
  return {
    symbol: "XYZ",
    quarters: [
      {
        quarter: {
          year: 2026,
          quarter: 1,
          label: "2026-Q1",
          periodEndDate: "2026-03-31",
        },
        reportedHolderCount: 10,
        newlyReportedHolderCount: 1,
        increasedReportedHolderCount: 4,
        reducedReportedHolderCount: 2,
        noLongerReportedHolderCount: 1,
        aggregateReportedShares: 1_000,
        aggregateReportedValue: 8_000,
        breadthChange: 1,
        shareTrend: 10,
        persistence: 40,
        increaseReductionBalance: 0.2,
        hasComparablePriorQuarter: true,
      },
      {
        quarter: QUARTER,
        reportedHolderCount: 12,
        newlyReportedHolderCount: 2,
        increasedReportedHolderCount: 5,
        reducedReportedHolderCount: 1,
        noLongerReportedHolderCount: 1,
        aggregateReportedShares: 1_300,
        aggregateReportedValue: 10_000,
        breadthChange: 2,
        shareTrend: 30,
        persistence: 30,
        increaseReductionBalance: 0.5,
        hasComparablePriorQuarter: true,
      },
    ],
    classification: "ACCELERATING_ACCUMULATION",
    dataQuality: COMPLETE_QUALITY,
    modelVersion: { name: "institutional_trend_v1", version: "1.0.0" },
  };
}

describe("stock institutional accumulation score composition", () => {
  it("derives transparent component inputs from stock and trend analytics", () => {
    const result = scoreStockInstitutionalAccumulation(
      stockAnalytics(),
      trendResult(),
      1,
    );
    expect(result).toMatchObject({
      score: 83,
      modelVersion: "institutional_accumulation_v1",
      dataQuarter: QUARTER,
      dataAsOf: QUARTER.periodEndDate,
      insufficientData: false,
      componentScores: {
        breadthChange: 90,
        reportedShareChange: 80,
        newManagerBreadth: 80,
        increaseReductionBalance: 75,
        multiQuarterPersistence: 100,
        portfolioWeightChange: 75,
      },
    });
    expect(result.components.breadthChange.rawValue).toBe(20);
    expect(result.components.newManagerBreadth.rawValue).toBe(20);
    expect(result.components.multiQuarterPersistence.rawValue).toBe(100);
    expect(Object.keys(result.components)).not.toContain("managerQuality");
    expect(result.dataQuality.warnings).toContain(
      "Manager-quality weighting is excluded from institutional_accumulation_v1.",
    );
  });

  it("marks trend-derived components unavailable when trend data is absent", () => {
    const result = scoreStockInstitutionalAccumulation(
      stockAnalytics(),
      null,
    );
    expect(result.score).toBeNull();
    expect(result.insufficientDataFlags).toEqual(
      expect.arrayContaining([
        "MISSING_INCREASE_REDUCTION_BALANCE",
        "MISSING_MULTI_QUARTER_PERSISTENCE",
        "MISSING_PORTFOLIO_WEIGHT_CHANGE",
        "INSUFFICIENT_AVAILABLE_WEIGHT",
      ]),
    );
  });
});