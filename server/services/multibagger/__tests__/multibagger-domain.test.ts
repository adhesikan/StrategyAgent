import { describe, expect, it, vi } from "vitest";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../../institutional/analytics/types";
import { computeMultibaggerDiscovery } from "../engine";
import { computeFundamentalQualityScore } from "../fundamental-signals";
import { computeGrowthScore } from "../growth-signals";
import { computeInstitutionalDiscoveryScore } from "../institutional-signals";
import { createMultibaggerDiscoveryRepository } from "../repository";
import { computeRiskScore } from "../risk-signals";
import { computeHundredXOptionalityProfile } from "../scoring";
import {
  MULTIBAGGER_MODEL_VERSION,
  MULTIBAGGER_PROFILES,
} from "../types";
import { computeValuationScore } from "../valuation-signals";

const quarter = {
  year: 2026,
  quarter: 1,
  label: "2026-Q1",
  periodEndDate: "2026-03-31",
} as const;

function analytics(
  overrides: Partial<StockInstitutionalAnalytics> = {},
): StockInstitutionalAnalytics {
  return {
    symbol: "TEST",
    quarter,
    dataAsOf: "2026-03-31",
    reportingManagerCount: 12,
    reportedHolderCount: 12,
    previousReportedHolderCount: 8,
    holderCountChange: 4,
    newlyReportedHolderCount: 4,
    increasedReportedHolderCount: 5,
    unchangedReportedHolderCount: 1,
    reducedReportedHolderCount: 1,
    noLongerReportedHolderCount: 1,
    aggregateReportedShares: 2_000_000,
    previousAggregateReportedShares: 1_000_000,
    aggregateReportedShareChange: 1_000_000,
    aggregateReportedShareChangePct: 100,
    aggregateReportedValueDollars: 100_000_000,
    averagePortfolioWeight: 1,
    medianPortfolioWeight: 0.5,
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
      new: 4,
      increased: 5,
      unchanged: 1,
      reduced: 1,
      exited: 1,
    },
    breadth: null,
    trend: null,
    dataQuality: { status: "complete", coveragePercent: 100, warnings: [] },
    modelVersion: { name: "institutional", version: "1" },
    ...overrides,
  };
}

function trend(
  classification: StockInstitutionalTrendResult["classification"] =
    "ACCELERATING_ACCUMULATION",
): StockInstitutionalTrendResult {
  return {
    symbol: "TEST",
    quarters: [
      {
        quarter,
        reportedHolderCount: 12,
        newlyReportedHolderCount: 4,
        increasedReportedHolderCount: 5,
        reducedReportedHolderCount: 1,
        noLongerReportedHolderCount: 1,
        aggregateReportedShares: 2_000_000,
        aggregateReportedValue: 100_000_000,
        breadthChange: 4,
        shareTrend: 100,
        persistence: 10,
        increaseReductionBalance:
          classification === "ACCELERATING_DISTRIBUTION" ||
          classification === "DISTRIBUTION"
            ? -0.8
            : 0.8,
        hasComparablePriorQuarter: true,
      },
    ],
    classification,
    dataQuality: { status: "complete", coveragePercent: 100, warnings: [] },
    modelVersion: { name: "institutional-trend", version: "1" },
  };
}

function completeInput(marketCapDollars = 800_000_000) {
  return {
    symbol: "test",
    institutionalAnalytics: analytics(),
    institutionalTrend: trend(),
    growth: {
      revenueGrowthYoYPercent: 45,
      revenueCagr3yPercent: 35,
      epsGrowthYoYPercent: 30,
      freeCashFlowGrowthYoYPercent: 25,
    },
    fundamental: {
      grossMarginPercent: 75,
      operatingMarginPercent: 25,
      freeCashFlowMarginPercent: 20,
      returnOnInvestedCapitalPercent: 25,
      debtToEquity: 0.2,
      earningsStabilityPercent: 85,
    },
    valuation: {
      marketCapDollars,
      revenueDollars: 200_000_000,
      enterpriseValueDollars: marketCapDollars,
      forwardPriceToEarnings: 25,
      priceToSales: 4,
      enterpriseValueToRevenue: 4,
    },
    runway: {
      marketCapDollars,
      addressableMarketDollars: 100_000_000_000,
      addressableMarketReliable: true,
      annualRevenueDollars: 200_000_000,
      revenueGrowthPercent: 45,
      cashAndEquivalentsDollars: 300_000_000,
      annualCashBurnDollars: 50_000_000,
      yearsToProfitability: 2,
    },
    risk: {
      annualizedVolatilityPercent: 25,
      maxDrawdownPercent: 20,
      debtToEquity: 0.2,
      customerConcentrationPercent: 15,
      regulatoryRisk: "low" as const,
    },
  };
}

describe("multibagger discovery dimensions", () => {
  it("marks unsupported and missing signals unavailable instead of inventing scores", () => {
    const result = computeMultibaggerDiscovery({ symbol: "NONE" });
    for (const dimension of Object.values(result.dimensions)) {
      expect(dimension.score).toBeNull();
      expect(dimension.availability).toBe("unavailable");
    }
    expect(result.overall.score).toBeNull();
    expect(result.overall.confidence).toBe("unavailable");
    expect(result.limitations.some((item) => item.includes("Unavailable input"))).toBe(true);
  });

  it("computes bounded, deterministic growth and fundamental scores", () => {
    const growthInput = {
      revenueGrowthYoYPercent: 30,
      revenueCagr3yPercent: 20,
    };
    const first = computeGrowthScore(growthInput);
    const second = computeGrowthScore(growthInput);
    expect(first).toEqual(second);
    expect(first.score).toBeGreaterThan(50);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.availability).toBe("partial");

    const fundamental = computeFundamentalQualityScore({
      grossMarginPercent: 80,
      operatingMarginPercent: 30,
      debtToEquity: 0.1,
    });
    expect(fundamental.score).toBeGreaterThan(60);
    expect(fundamental.modelVersion).toBe(MULTIBAGGER_MODEL_VERSION);
  });

  it("uses existing institutional analytics and multi-quarter trend evidence", () => {
    const positive = computeInstitutionalDiscoveryScore({
      institutionalAnalytics: analytics(),
      institutionalTrend: trend("ACCELERATING_ACCUMULATION"),
    });
    const negative = computeInstitutionalDiscoveryScore({
      institutionalAnalytics: analytics({
        aggregateReportedShareChangePct: -30,
        newlyReportedHolderCount: 0,
        increasedReportedHolderCount: 1,
        reducedReportedHolderCount: 5,
        noLongerReportedHolderCount: 4,
      }),
      institutionalTrend: trend("ACCELERATING_DISTRIBUTION"),
    });
    expect(positive.score).toBeGreaterThan(negative.score!);
    expect(positive.evidence.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "institutionalAccumulationScore",
        "institutionalTrend",
        "reportedHolderGrowth",
        "newManagerBreadth",
        "aggregateReportedShareTrend",
        "multiQuarterPersistence",
      ]),
    );
  });

  it("keeps valuation and risk-quality semantics explicit and bounded", () => {
    const attractive = computeValuationScore({
      priceToSales: 3,
      forwardPriceToEarnings: 15,
    });
    const expensive = computeValuationScore({
      priceToSales: 50,
      forwardPriceToEarnings: 80,
    });
    expect(attractive.score).toBeGreaterThan(expensive.score!);

    const lowerRisk = computeRiskScore({
      annualizedVolatilityPercent: 15,
      maxDrawdownPercent: 10,
      debtToEquity: 0.1,
      customerConcentrationPercent: 10,
      regulatoryRisk: "low",
    });
    const higherRisk = computeRiskScore({
      annualizedVolatilityPercent: 60,
      maxDrawdownPercent: 60,
      debtToEquity: 3,
      customerConcentrationPercent: 90,
      regulatoryRisk: "high",
    });
    expect(lowerRisk.score).toBeGreaterThan(higherRisk.score!);
  });

  it("marks malformed and out-of-domain provider values unavailable", () => {
    expect(computeGrowthScore({
      revenueGrowthYoYPercent: Number.NaN,
      revenueCagr3yPercent: -101,
    }).score).toBeNull();
    expect(computeFundamentalQualityScore({
      debtToEquity: -1,
      earningsStabilityPercent: 101,
    }).score).toBeNull();
    expect(computeRiskScore({
      annualizedVolatilityPercent: -1,
      maxDrawdownPercent: 101,
      customerConcentrationPercent: -5,
    }).score).toBeNull();
    const institutional = computeInstitutionalDiscoveryScore({
      institutionalAnalytics: analytics({
        aggregateReportedShareChangePct: Number.NaN,
        newlyReportedHolderCount: -1,
      }),
      institutionalTrend: {
        ...trend("INSUFFICIENT_DATA"),
        dataQuality: { status: "insufficient", coveragePercent: 10, warnings: [] },
      },
    });
    expect(institutional.score).toBeNull();
    expect(institutional.availability).toBe("unavailable");
  });

  it("uses derived valuation multiples only as fallbacks", () => {
    const direct = computeValuationScore({
      marketCapDollars: 1_000,
      revenueDollars: 100,
      enterpriseValueDollars: 900,
      forwardPriceToEarnings: 20,
      priceToSales: 10,
      enterpriseValueToRevenue: 9,
    });
    expect(direct.evidence.map((item) => item.key)).toEqual([
      "forwardPriceToEarnings",
      "priceToSales",
      "enterpriseValueToRevenue",
    ]);

    const derived = computeValuationScore({
      marketCapDollars: 1_000,
      revenueDollars: 100,
      enterpriseValueDollars: 900,
    });
    expect(derived.evidence.map((item) => item.key)).toEqual([
      "derivedPriceToSales",
      "derivedEnterpriseValueToRevenue",
    ]);
  });
});

describe("multibagger discovery profiles", () => {
  it("returns every requested profile and versions every model output", () => {
    const result = computeMultibaggerDiscovery(completeInput());
    expect(result.symbol).toBe("TEST");
    expect(Object.keys(result.profiles)).toEqual([...MULTIBAGGER_PROFILES]);
    expect(result.availableDimensionCount).toBe(7);
    expect(result.modelVersion).toBe("multibagger_v1");
    expect(result.overall.modelVersion).toBe("multibagger_v1");
    for (const dimension of Object.values(result.dimensions)) {
      expect(dimension.modelVersion).toBe("multibagger_v1");
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(100);
    }
    for (const profile of Object.values(result.profiles)) {
      expect(profile.modelVersion).toBe("multibagger_v1");
    }
    expect(result.disclaimer).toContain("not a prediction");
  });

  it("does not derive the 100x profile from a higher overall-score threshold", () => {
    const result = computeMultibaggerDiscovery(completeInput());
    const hundredX = result.profiles.HUNDRED_X_OPTIONALITY;
    expect(hundredX.score).not.toBeNull();
    expect(hundredX.rationale).toContain("not derived from the overall score");
    expect(hundredX.evidence.map((item) => item.key)).toEqual([
      "startingMarketCapitalization",
      "economicRunway",
    ]);
    expect(hundredX.score).not.toBe(result.overall.score);
  });

  it("requires starting market capitalization and economic runway for 100x optionality", () => {
    const missingRunway = computeHundredXOptionalityProfile({
      marketCapDollars: 500_000_000,
    });
    expect(missingRunway.score).toBeNull();
    expect(missingRunway.eligible).toBe(false);
    expect(missingRunway.rationale).toContain("requires both");
  });

  it("scores starting capitalization separately from economic runway", () => {
    const small = computeHundredXOptionalityProfile({
      marketCapDollars: 500_000_000,
      addressableMarketDollars: 100_000_000_000,
    });
    const large = computeHundredXOptionalityProfile({
      marketCapDollars: 200_000_000_000,
      addressableMarketDollars: 100_000_000_000,
    });
    expect(small.evidence[0].value).toBeGreaterThan(large.evidence[0].value as number);
    expect(small.score).toBeGreaterThan(large.score!);
  });

  it("renormalizes overall weights across available dimensions without neutral fallbacks", () => {
    const result = computeMultibaggerDiscovery({
      symbol: "ONLY",
      growth: { revenueGrowthYoYPercent: 30 },
    });
    expect(result.availableDimensionCount).toBe(1);
    expect(result.overall.score).toBe(result.dimensions.growth.score);
    expect(result.dimensions.fundamental.score).toBeNull();
  });
});

describe("multibagger repository boundary", () => {
  it("loads institutional services and isolates unavailable or failed optional providers", async () => {
    const getInstitutionalAnalytics = vi.fn(async () => analytics());
    const getInstitutionalTrend = vi.fn(async () => trend());
    const getGrowthSignals = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const getValuationSignals = vi.fn(async () => ({
      priceToSales: 5,
    }));
    const repository = createMultibaggerDiscoveryRepository({
      getInstitutionalAnalytics,
      getInstitutionalTrend,
      getSpecialistManagerParticipation: async () => null,
      getGrowthSignals,
      getValuationSignals,
    });
    const loaded = await repository.load("TEST");
    expect(getInstitutionalAnalytics).toHaveBeenCalledWith("TEST");
    expect(getInstitutionalTrend).toHaveBeenCalledWith("TEST");
    expect(loaded.institutionalAnalytics?.symbol).toBe("TEST");
    expect(loaded.growth).toBeNull();
    expect(loaded.valuation).toEqual({ priceToSales: 5 });
    expect(loaded.fundamental).toBeNull();
    const result = computeMultibaggerDiscovery(loaded);
    expect(result.dimensions.growth.availability).toBe("unavailable");
    expect(result.limitations).toContain(
      "Unavailable input — growth: revenueGrowthYoYPercent.",
    );
  });
});