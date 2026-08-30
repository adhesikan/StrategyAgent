import { describe, expect, it } from "vitest";
import {
  classifyStockInstitutionalTrend,
  computeStockInstitutionalTrend,
  getStockInstitutionalTrend,
  INSTITUTIONAL_TREND_MODEL_CONFIG,
  type EnrichedInstitutionalHolding,
  type InstitutionalQuarter,
  type StockInstitutionalTrendQuarter,
  type StockInstitutionalTrendQuarterSource,
  type StockInstitutionalTrendRepository,
} from "../analytics";

const Q1: InstitutionalQuarter = {
  year: 2026,
  quarter: 1,
  label: "2026-Q1",
  periodEndDate: "2026-03-31",
};
const Q2: InstitutionalQuarter = {
  year: 2026,
  quarter: 2,
  label: "2026-Q2",
  periodEndDate: "2026-06-30",
};
const Q3: InstitutionalQuarter = {
  year: 2026,
  quarter: 3,
  label: "2026-Q3",
  periodEndDate: "2026-09-30",
};

function holding(
  managerId: string,
  shares: number,
  value: number,
  period: InstitutionalQuarter,
  overrides: Partial<EnrichedInstitutionalHolding> = {},
): EnrichedInstitutionalHolding {
  return {
    holdingId: `${managerId}-${period.label}-${overrides.putCall ?? "E"}`,
    accessionNumber: `${managerId}-${period.label}`,
    filerCik: managerId,
    filerName: `Manager ${managerId}`,
    issuerName: "XYZ Corporation",
    cusip: "999999999",
    periodOfReport: period.periodEndDate,
    reportedValueDollars: value,
    reportedShares: shares,
    sharesPrnType: "SH",
    securityPositionType: overrides.putCall
      ? String(overrides.putCall).toUpperCase()
      : "COMMON_EQUITY",
    putCall: null,
    mappingResolution: "reliably_mapped",
    metadataResolution: "canonical",
    classificationStatus: "classified",
    unclassifiedReason: null,
    metadata: {
      symbol: "XYZ",
      companyName: "XYZ Corporation",
      sector: "Technology",
      industry: "Software",
      subIndustry: null,
      marketCap: 1_000,
      exchange: "NYSE",
      country: "United States",
      assetType: "common_stock",
    },
    themes: [],
    ...overrides,
  };
}

function source(
  quarter: InstitutionalQuarter,
  previousQuarter: InstitutionalQuarter | null,
  current: Array<[string, number, number]>,
  previous: Array<[string, number, number]>,
  comparableManagerIds?: string[],
  extras?: {
    current?: EnrichedInstitutionalHolding[];
    previous?: EnrichedInstitutionalHolding[];
  },
): StockInstitutionalTrendQuarterSource {
  const currentHoldings = current.map(([manager, shares, value]) =>
    holding(manager, shares, value, quarter),
  );
  const previousHoldings = previousQuarter
    ? previous.map(([manager, shares, value]) =>
        holding(manager, shares, value, previousQuarter),
      )
    : [];
  return {
    quarter,
    previousQuarter,
    currentHoldings: [...currentHoldings, ...(extras?.current ?? [])],
    previousHoldings: [...previousHoldings, ...(extras?.previous ?? [])],
    currentFilingManagerIds: Array.from(
      new Set(current.map(([manager]) => manager)),
    ),
    comparableManagerIds:
      comparableManagerIds ??
      Array.from(
        new Set([
          ...current.map(([manager]) => manager),
          ...previous.map(([manager]) => manager),
        ]),
      ),
  };
}

function metric(
  balance: number | null,
): StockInstitutionalTrendQuarter {
  return {
    quarter: Q2,
    reportedHolderCount: 1,
    newlyReportedHolderCount: 0,
    increasedReportedHolderCount: 0,
    reducedReportedHolderCount: 0,
    noLongerReportedHolderCount: 0,
    aggregateReportedShares: 100,
    aggregateReportedValue: 100,
    breadthChange: 0,
    shareTrend: 0,
    persistence: 100,
    increaseReductionBalance: balance,
    hasComparablePriorQuarter: balance !== null,
  };
}

describe("multi-quarter stock institutional trend", () => {
  it("returns insufficient data when only one quarter is available", () => {
    const result = computeStockInstitutionalTrend({
      symbol: "xyz",
      quarters: [source(Q1, null, [["M1", 100, 200]], [])],
    });
    expect(result).toMatchObject({
      symbol: "XYZ",
      classification: "INSUFFICIENT_DATA",
      modelVersion: {
        name: "institutional_trend_v1",
        version: "1.0.0",
      },
    });
    expect(result.quarters[0]).toMatchObject({
      reportedHolderCount: 1,
      aggregateReportedShares: 100,
      aggregateReportedValue: 200,
      breadthChange: null,
      shareTrend: null,
      persistence: null,
      increaseReductionBalance: null,
      hasComparablePriorQuarter: false,
    });
  });

  it("classifies accumulation with two quarters", () => {
    const result = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [
        source(Q1, null, [["M1", 100, 100]], []),
        source(Q2, Q1, [["M1", 150, 180]], [["M1", 100, 100]], ["M1"]),
      ],
    });
    expect(result.classification).toBe("ACCUMULATION");
    expect(result.quarters[1]).toMatchObject({
      reportedHolderCount: 1,
      increasedReportedHolderCount: 1,
      aggregateReportedShares: 150,
      aggregateReportedValue: 180,
      breadthChange: 0,
      shareTrend: 50,
      persistence: 0,
      increaseReductionBalance: 1,
      hasComparablePriorQuarter: true,
    });
  });

  it("calculates breadth, shares, persistence, and balance independently", () => {
    const result = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [
        source(
          Q2,
          Q1,
          [
            ["M1", 150, 300],
            ["M2", 50, 100],
            ["M3", 80, 240],
            ["M5", 20, 20],
          ],
          [
            ["M1", 100, 150],
            ["M3", 100, 200],
            ["M4", 40, 80],
            ["M5", 20, 20],
          ],
          ["M1", "M2", "M3", "M4", "M5"],
        ),
      ],
    });
    expect(result.classification).toBe("STABLE");
    expect(result.quarters[0]).toMatchObject({
      reportedHolderCount: 4,
      newlyReportedHolderCount: 1,
      increasedReportedHolderCount: 1,
      reducedReportedHolderCount: 1,
      noLongerReportedHolderCount: 1,
      aggregateReportedShares: 300,
      aggregateReportedValue: 660,
      breadthChange: 0,
      shareTrend: 15.38,
      persistence: 20,
      increaseReductionBalance: 0,
    });
  });

  it("treats alternating accumulation and distribution as stable", () => {
    const result = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [
        source(Q2, Q1, [["M1", 150, 150]], [["M1", 100, 100]], ["M1"]),
        source(Q3, Q2, [["M1", 100, 130]], [["M1", 150, 150]], ["M1"]),
      ],
    });
    expect(result.classification).toBe("STABLE");
    expect(result.quarters.map((quarter) => quarter.increaseReductionBalance)).toEqual([
      1,
      -1,
    ]);
  });

  it("does not bridge a missing comparison when detecting acceleration", () => {
    expect(
      classifyStockInstitutionalTrend([
        metric(0.3),
        metric(null),
        metric(0.8),
      ]),
    ).toBe("ACCUMULATION");
  });

  it("uses reported shares rather than rising market value for direction", () => {
    const result = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [
        source(Q2, Q1, [["M1", 80, 240]], [["M1", 100, 200]], ["M1"]),
      ],
    });
    expect(result.quarters[0]).toMatchObject({
      reducedReportedHolderCount: 1,
      shareTrend: -20,
      aggregateReportedValue: 240,
      increaseReductionBalance: -1,
    });
    expect(result.classification).toBe("DISTRIBUTION");
  });

  it("uses canonical aggregate history even when no reconstructed holdings are present", () => {
    const q1 = source(Q1, null, [], []);
    q1.canonicalAggregate = {
      quarter: Q1,
      previousQuarter: {
        year: 2025,
        quarter: 4,
        label: "2025-Q4",
        periodEndDate: "2025-12-31",
      },
      previousReportingManagerCount: 12,
      reportingManagerCount: 10,
      aggregateReportedShares: 900,
      aggregateReportedValue: 129_610,
      previousQuarterShares: 1_000,
      previousQuarterValue: 130_000,
      reportedSharesChange: -100,
      reportedSharesChangePercent: -0.1,
      newPositionCount: 1,
      increasedPositionCount: 1,
      reducedPositionCount: 3,
      exitedPositionCount: 1,
      unchangedCount: 4,
      eligibleHoldingCount: 10,
      excludedHoldingCount: 0,
      coverageStatus: "complete",
    };

    const result = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [q1],
    });

    expect(result.classification).toBe("DISTRIBUTION");
    expect(result.dataQuality.status).toBe("complete");
    expect(result.quarters[0]).toMatchObject({
      reportedHolderCount: 10,
      aggregateReportedShares: 900,
      aggregateReportedValue: 129_610,
      breadthChange: -2,
      shareTrend: -10,
      increaseReductionBalance: -0.33,
      hasComparablePriorQuarter: true,
    });
  });

  it("classifies accelerating increases at the exact configured boundary", () => {
    expect(
      classifyStockInstitutionalTrend([metric(0.4), metric(0.6)]),
    ).toBe("ACCELERATING_ACCUMULATION");
    expect(
      classifyStockInstitutionalTrend([metric(0.4), metric(0.59)]),
    ).toBe("ACCUMULATION");
  });

  it("classifies accelerating reductions at the exact configured boundary", () => {
    expect(
      classifyStockInstitutionalTrend([metric(-0.4), metric(-0.6)]),
    ).toBe("ACCELERATING_DISTRIBUTION");
    expect(
      classifyStockInstitutionalTrend([metric(-0.4), metric(-0.59)]),
    ).toBe("DISTRIBUTION");
  });

  it.each([
    [null, "INSUFFICIENT_DATA"],
    [-0.2, "STABLE"],
    [-0.2499, "STABLE"],
    [-0.25, "DISTRIBUTION"],
    [0, "STABLE"],
    [0.2, "STABLE"],
    [0.2499, "STABLE"],
    [0.25, "ACCUMULATION"],
  ] as const)(
    "classifies increase/reduction balance %s at its deterministic boundary",
    (balance, expected) => {
      expect(classifyStockInstitutionalTrend([metric(balance)])).toBe(expected);
    },
  );

  it("excludes options and PRN rows from the default common-equity trend", () => {
    const putCurrent = holding("M2", 999, 999, Q2, {
      putCall: "PUT",
      securityPositionType: "PUT",
    });
    const putPrevious = holding("M2", 500, 500, Q1, {
      putCall: "PUT",
      securityPositionType: "PUT",
    });
    const prnCurrent = holding("M3", 888, 888, Q2, {
      sharesPrnType: "PRN",
    });
    const quarter = source(
      Q2,
      Q1,
      [["M1", 150, 150]],
      [["M1", 100, 100]],
      ["M1", "M2", "M3"],
      {
        current: [putCurrent, prnCurrent],
        previous: [putPrevious],
      },
    );
    const common = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [quarter],
    });
    expect(common.quarters[0]).toMatchObject({
      reportedHolderCount: 1,
      aggregateReportedShares: 150,
      aggregateReportedValue: 150,
    });

    quarter.canonicalAggregate = {
      quarter: Q2,
      previousQuarter: Q1,
      previousReportingManagerCount: null,
      reportingManagerCount: 0,
      aggregateReportedShares: null,
      aggregateReportedValue: null,
      previousQuarterShares: null,
      previousQuarterValue: null,
      reportedSharesChange: null,
      reportedSharesChangePercent: null,
      newPositionCount: 0,
      increasedPositionCount: 0,
      reducedPositionCount: 0,
      exitedPositionCount: 0,
      unchangedCount: 0,
      eligibleHoldingCount: 0,
      excludedHoldingCount: 1,
      coverageStatus: "insufficient",
    };
    const puts = computeStockInstitutionalTrend({
      symbol: "XYZ",
      quarters: [quarter],
      positionType: "PUT",
    });
    expect(puts.quarters[0]).toMatchObject({
      reportedHolderCount: 1,
      aggregateReportedShares: 999,
      aggregateReportedValue: 999,
      increasedReportedHolderCount: 1,
    });
    expect(puts.dataQuality.status).toBe("partial");
  });

  it("defaults service history to eight quarters and caps larger requests", async () => {
    const observed: number[] = [];
    const repository: StockInstitutionalTrendRepository = {
      async getStockInstitutionalTrendSource(query) {
        observed.push(query.options.historyQuarters ?? -1);
        return {
          symbol: query.symbol,
          quarters: [source(Q1, null, [["M1", 100, 100]], [])],
        };
      },
    };
    await getStockInstitutionalTrend("XYZ", {}, repository);
    await getStockInstitutionalTrend(
      "XYZ",
      { historyQuarters: 100 },
      repository,
    );
    expect(observed).toEqual([
      INSTITUTIONAL_TREND_MODEL_CONFIG.maxHistoryQuarters,
      INSTITUTIONAL_TREND_MODEL_CONFIG.maxHistoryQuarters,
    ]);
  });
});