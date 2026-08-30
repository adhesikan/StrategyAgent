import { describe, expect, it } from "vitest";
import {
  computeStockInstitutionalAnalytics,
  getStockInstitutionalAnalytics,
  loadAllStockInstitutionalHoldings,
  selectEffectiveStockFilings,
  type EffectiveStockFilingCandidate,
  type EnrichedInstitutionalHolding,
  type StockInstitutionalAnalyticsCalculationInput,
  type StockInstitutionalRepository,
} from "../analytics";

const QUARTER = {
  year: 2026,
  quarter: 2 as const,
  label: "2026-Q2" as const,
  periodEndDate: "2026-06-30",
};
const PREVIOUS_QUARTER = {
  year: 2026,
  quarter: 1 as const,
  label: "2026-Q1" as const,
  periodEndDate: "2026-03-31",
};

function holding(
  managerId: string,
  managerName: string,
  cusip: string,
  shares: number,
  value: number,
  overrides: Partial<EnrichedInstitutionalHolding> = {},
): EnrichedInstitutionalHolding {
  return {
    holdingId: `${managerId}-${cusip}-${overrides.putCall ?? "equity"}`,
    accessionNumber: `${managerId}-current`,
    filerCik: managerId,
    filerName: managerName,
    issuerName: "Example Corporation",
    cusip,
    periodOfReport: QUARTER.periodEndDate,
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
      companyName: "Example Corporation",
      sector: "Technology",
      industry: "Software",
      subIndustry: null,
      marketCap: 1_000_000,
      exchange: "NYSE",
      country: "United States",
      assetType: "common_stock",
    },
    themes: [],
    ...overrides,
  };
}

function previous(
  item: EnrichedInstitutionalHolding,
): EnrichedInstitutionalHolding {
  return {
    ...item,
    holdingId: `${item.holdingId}-previous`,
    accessionNumber: `${item.filerCik}-previous`,
    periodOfReport: PREVIOUS_QUARTER.periodEndDate,
  };
}

function baseInput(): StockInstitutionalAnalyticsCalculationInput {
  const currentHoldings = [
    holding("0000000001", "Alpha Manager", "111111111", 150, 150),
    holding("0000000002", "Beta Manager", "111111111", 80, 80),
    holding("0000000003", "Gamma Manager", "111111111", 70, 70),
    holding("0000000004", "Delta Manager", "111111111", 60, 60),
    holding("0000000099", "Option Manager", "111111111", 999, 999, {
      putCall: "Put",
      securityPositionType: "PUT",
    }),
    holding("0000000098", "Principal Manager", "111111111", 500, 500, {
      sharesPrnType: "PRN",
    }),
  ];
  const previousHoldings = [
    previous(holding("0000000001", "Alpha Manager", "111111111", 100, 100)),
    previous(holding("0000000002", "Beta Manager", "111111111", 100, 100)),
    previous(holding("0000000003", "Gamma Manager", "111111111", 70, 70)),
    previous(holding("0000000005", "Epsilon Manager", "111111111", 40, 40)),
    previous(
      holding("0000000099", "Option Manager", "111111111", 500, 500, {
        putCall: "Put",
        securityPositionType: "PUT",
      }),
    ),
  ];
  return {
    symbol: "XYZ",
    quarter: QUARTER,
    previousQuarter: PREVIOUS_QUARTER,
    dataAsOf: QUARTER.periodEndDate,
    currentHoldings,
    previousHoldings,
    managerPortfolioValues: {
      "0000000001": 1_000,
      "0000000002": 1_000,
      "0000000003": 1_000,
      "0000000004": 1_000,
      "0000000098": 1_000,
      "0000000099": 2_000,
    },
    currentFilingManagerIds: [
      "0000000001",
      "0000000002",
      "0000000003",
      "0000000004",
      "0000000098",
      "0000000099",
    ],
    comparableManagerIds: [
      "0000000001",
      "0000000002",
      "0000000003",
      "0000000004",
      "0000000005",
      "0000000098",
      "0000000099",
    ],
  };
}

describe("stock institutional analytics", () => {
  it("computes holder counts, changes, aggregate shares, values, and weights", () => {
    const result = computeStockInstitutionalAnalytics(baseInput());

    expect(result).toMatchObject({
      symbol: "XYZ",
      quarter: QUARTER,
      dataAsOf: "2026-06-30",
      reportedHolderCount: 4,
      previousReportedHolderCount: 4,
      holderCountChange: 0,
      newlyReportedHolderCount: 1,
      increasedReportedHolderCount: 1,
      unchangedReportedHolderCount: 1,
      reducedReportedHolderCount: 1,
      noLongerReportedHolderCount: 1,
      aggregateReportedShares: 360,
      previousAggregateReportedShares: 310,
      aggregateReportedShareChange: 50,
      aggregateReportedShareChangePct: 16.13,
      aggregateReportedValueDollars: 360,
      averagePortfolioWeight: 9,
      medianPortfolioWeight: 7.5,
    });
    expect(result.topReportedHolders.map((holder) => holder.managerName)).toEqual([
      "Alpha Manager",
      "Beta Manager",
      "Gamma Manager",
      "Delta Manager",
    ]);
    expect(result.topReportedHolders[0]).toMatchObject({
      cusip: "111111111",
      cusips: ["111111111"],
      portfolioWeight: 15,
    });
    expect(JSON.stringify(result)).not.toMatch(/\b(buy|sell|bought|sold)\b/i);
    expect(result.dataQuality.warnings.join(" ")).toContain(
      "not total institutional ownership",
    );
  });

  it("returns deterministic new, increase, reduction, and exit lists", () => {
    const result = computeStockInstitutionalAnalytics(baseInput());

    expect(result.largestNewlyReportedPositions).toEqual([
      expect.objectContaining({
        managerName: "Delta Manager",
        changeType: "NEW",
      }),
    ]);
    expect(result.largestReportedShareIncreases).toEqual([
      expect.objectContaining({
        managerName: "Alpha Manager",
        reportedShareChange: 50,
        changeType: "INCREASED",
      }),
    ]);
    expect(result.largestReportedShareReductions).toEqual([
      expect.objectContaining({
        managerName: "Beta Manager",
        reportedShareChange: -20,
        changeType: "REDUCED",
      }),
    ]);
    expect(result.noLongerReportedPositions).toEqual([
      expect.objectContaining({
        managerName: "Epsilon Manager",
        reportedShares: null,
        previousReportedShares: 40,
        reportedShareChange: -40,
        changeType: "EXITED",
      }),
    ]);
  });

  it("excludes options and PRN rows by default and keeps options selectable", () => {
    const equity = computeStockInstitutionalAnalytics(baseInput());
    const puts = computeStockInstitutionalAnalytics(baseInput(), {
      positionType: "PUT",
    });

    expect(equity.reportedHolderCount).toBe(4);
    expect(equity.aggregateReportedShares).toBe(360);
    expect(puts.reportedHolderCount).toBe(1);
    expect(puts.aggregateReportedShares).toBe(999);
    expect(puts.previousAggregateReportedShares).toBe(500);
    expect(puts.aggregateReportedShareChange).toBe(499);
  });

  it("does not classify a holder when that manager lacks a previous filing", () => {
    const input = baseInput();
    input.currentHoldings.push(
      holding("0000000006", "No History Manager", "111111111", 50, 50),
    );
    input.currentFilingManagerIds.push("0000000006");
    input.managerPortfolioValues["0000000006"] = 1_000;
    const result = computeStockInstitutionalAnalytics(input);

    expect(result.reportedHolderCount).toBe(5);
    expect(result.newlyReportedHolderCount).toBe(1);
    expect(
      result.topReportedHolders.find(
        (holder) => holder.managerId === "0000000006",
      )?.changeType,
    ).toBeNull();
    expect(result.holderCountChange).toBeNull();
    expect(result.aggregateReportedShareChange).toBeNull();
    expect(result.aggregateReportedShareChangePct).toBeNull();
    expect(result.dataQuality.status).toBe("partial");
    expect(result.dataQuality.warnings.join(" ")).toContain(
      "lacks an adjacent prior-quarter filing",
    );
  });

  it("reports mapping coverage without promoting ambiguous candidates", () => {
    const input = baseInput();
    input.currentHoldings.push(
      holding("0000000007", "Ambiguous Manager", "222222222", 100, 100, {
        mappingResolution: "ambiguous",
        metadataResolution: "unavailable",
        classificationStatus: "unclassified",
        unclassifiedReason: "ambiguous",
        metadata: null,
      }),
    );
    const result = computeStockInstitutionalAnalytics(input);

    expect(result.mappingCoverage).toEqual({
      candidateHoldingCount: 5,
      reliablyMappedHoldingCount: 4,
      unmappedHoldingCount: 0,
      ambiguousHoldingCount: 1,
      classificationUnavailableHoldingCount: 0,
      coveragePercent: 80,
    });
    expect(result.reportedHolderCount).toBe(4);
  });

  it.each([
    ["AAPL-style zero-share row", 0],
    ["NVDA-style negative-share row", -25],
    ["MSFT-style null-share row", null],
  ])("excludes %s from common-equity mapping coverage", (_case, shares) => {
    const input = baseInput();
    input.currentHoldings.push(
      holding("0000000007", "Excluded Manager", "222222222", 100, 100, {
        reportedShares: shares,
      }),
    );

    const result = computeStockInstitutionalAnalytics(input);

    expect(result.mappingCoverage).toMatchObject({
      candidateHoldingCount: 4,
      reliablyMappedHoldingCount: 4,
      unmappedHoldingCount: 0,
      ambiguousHoldingCount: 0,
      coveragePercent: 100,
    });
    expect(result.reportedHolderCount).toBe(4);
  });

  it("keeps COST-style clean common-equity coverage at 100 percent", () => {
    const result = computeStockInstitutionalAnalytics(baseInput());

    expect(result.mappingCoverage).toMatchObject({
      candidateHoldingCount: 4,
      reliablyMappedHoldingCount: 4,
      coveragePercent: 100,
    });
  });

  it("does not let option or PRN rows alter common-equity mapping coverage", () => {
    const result = computeStockInstitutionalAnalytics(baseInput());

    expect(result.mappingCoverage.candidateHoldingCount).toBe(4);
    expect(result.mappingCoverage.reliablyMappedHoldingCount).toBe(4);
    expect(result.mappingCoverage.coveragePercent).toBe(100);
  });

  it("reduces coverage for an eligible unmapped common-equity row", () => {
    const input = baseInput();
    input.currentHoldings.push(
      holding("0000000007", "Unmapped Manager", "222222222", 100, 100, {
        mappingResolution: "unmapped",
        metadataResolution: "unavailable",
        classificationStatus: "unclassified",
        unclassifiedReason: "unmapped",
        metadata: null,
      }),
    );

    const result = computeStockInstitutionalAnalytics(input);

    expect(result.mappingCoverage).toMatchObject({
      candidateHoldingCount: 5,
      reliablyMappedHoldingCount: 4,
      unmappedHoldingCount: 1,
      ambiguousHoldingCount: 0,
      coveragePercent: 80,
    });
  });

  it("uses the persisted common-equity aggregate for summary totals and activity", () => {
    const input = baseInput();
    input.canonicalAggregate = {
      quarter: QUARTER,
      previousQuarter: PREVIOUS_QUARTER,
      previousReportingManagerCount: 12,
      reportingManagerCount: 10,
      aggregateReportedShares: 9_000,
      aggregateReportedValue: 129_610,
      previousQuarterShares: 10_000,
      previousQuarterValue: 120_000,
      reportedSharesChange: -1_000,
      reportedSharesChangePercent: -0.1,
      newPositionCount: 1,
      increasedPositionCount: 2,
      reducedPositionCount: 3,
      exitedPositionCount: 4,
      unchangedCount: 5,
      eligibleHoldingCount: 10,
      excludedHoldingCount: 2,
      coverageStatus: "insufficient",
    };

    const result = computeStockInstitutionalAnalytics(input);

    expect(result).toMatchObject({
      reportingManagerCount: 10,
      reportedHolderCount: 10,
      previousReportedHolderCount: 12,
      holderCountChange: -2,
      aggregateReportedShares: 9_000,
      previousAggregateReportedShares: 10_000,
      aggregateReportedShareChange: -1_000,
      aggregateReportedShareChangePct: -10,
      aggregateReportedValueDollars: 129_610,
      newlyReportedHolderCount: 1,
      increasedReportedHolderCount: 2,
      reducedReportedHolderCount: 3,
      noLongerReportedHolderCount: 4,
      unchangedReportedHolderCount: 5,
      managerChangeCounts: {
        new: 1,
        increased: 2,
        reduced: 3,
        exited: 4,
        unchanged: 5,
      },
    });
    expect(result.topReportedHolders).toHaveLength(4);

    input.canonicalAggregate = {
      ...input.canonicalAggregate,
      aggregateReportedShares: null,
      aggregateReportedValue: null,
      previousQuarterShares: null,
      reportedSharesChange: null,
      reportedSharesChangePercent: null,
    };
    const unavailableCanonicalTotals =
      computeStockInstitutionalAnalytics(input);
    expect(unavailableCanonicalTotals).toMatchObject({
      aggregateReportedShares: null,
      previousAggregateReportedShares: null,
      aggregateReportedShareChange: null,
      aggregateReportedShareChangePct: null,
      aggregateReportedValueDollars: null,
    });
  });

  it("does not apply the common-equity aggregate to option analytics", () => {
    const input = baseInput();
    input.canonicalAggregate = {
      quarter: QUARTER,
      previousQuarter: PREVIOUS_QUARTER,
      previousReportingManagerCount: 50,
      reportingManagerCount: 50,
      aggregateReportedShares: 50_000,
      aggregateReportedValue: 50_000,
      previousQuarterShares: 40_000,
      previousQuarterValue: 40_000,
      reportedSharesChange: 10_000,
      reportedSharesChangePercent: 0.25,
      newPositionCount: 10,
      increasedPositionCount: 10,
      reducedPositionCount: 10,
      exitedPositionCount: 10,
      unchangedCount: 10,
      eligibleHoldingCount: 50,
      excludedHoldingCount: 0,
      coverageStatus: "complete",
    };

    const result = computeStockInstitutionalAnalytics(input, {
      positionType: "PUT",
    });

    expect(result.aggregateReportedShares).toBe(999);
    expect(result.reportingManagerCount).toBe(1);
    expect(result.dataQuality.status).toBe("complete");
  });

  it("selects effective amendments once and keeps only comparable managers", () => {
    const rows: EffectiveStockFilingCandidate[] = [
      {
        accessionNumber: "m1-q2-original",
        managerId: "0000000001",
        managerName: "Alpha Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-01",
        // Defensive integrity case: if two rows are incorrectly left effective,
        // the later filing/accession is still selected once.
        isEffective: true,
      },
      {
        accessionNumber: "m1-q2-amended",
        managerId: "0000000001",
        managerName: "Alpha Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-10",
        isEffective: true,
      },
      {
        accessionNumber: "m1-q1",
        managerId: "0000000001",
        managerName: "Alpha Manager",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-10",
        isEffective: true,
      },
      {
        accessionNumber: "m2-q2",
        managerId: "0000000002",
        managerName: "Beta Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-11",
        isEffective: true,
      },
      {
        accessionNumber: "m3-q1-no-current",
        managerId: "0000000003",
        managerName: "Gamma Manager",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-11",
        isEffective: true,
      },
    ];

    const selected = selectEffectiveStockFilings(rows, "latest");

    expect(selected?.currentFilings.map((filing) => filing.accessionNumber)).toEqual([
      "m1-q2-amended",
      "m2-q2",
    ]);
    expect(selected?.previousFilings.map((filing) => filing.accessionNumber)).toEqual([
      "m1-q1",
    ]);
    expect(selected?.comparableManagerIds).toEqual(["0000000001"]);
  });

  it("paginates symbol holdings deterministically to exhaustion without a cap", async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      holding(
        `000000000${index + 1}`,
        `Manager ${index + 1}`,
        `30000000${index}`,
        index + 1,
        index + 1,
      ),
    );
    const offsets: number[] = [];
    const loaded = await loadAllStockInstitutionalHoldings(
      ["current-accession"],
      "XYZ",
      async (query) => {
        offsets.push(query.offset ?? 0);
        return rows.slice(
          query.offset ?? 0,
          (query.offset ?? 0) + (query.limit ?? 0),
        );
      },
      2,
    );

    expect(offsets).toEqual([0, 2, 4]);
    expect(loaded.map((row) => row.holdingId)).toEqual(
      rows.map((row) => row.holdingId),
    );
  });

  it("uses latest and common-equity defaults through the service boundary", async () => {
    let observed:
      | Parameters<StockInstitutionalRepository["getStockInstitutionalSource"]>[0]
      | null = null;
    const repository: StockInstitutionalRepository = {
      async getStockInstitutionalSource(query) {
        observed = query;
        return baseInput();
      },
    };

    const result = await getStockInstitutionalAnalytics(
      "xyz",
      "latest",
      {},
      repository,
    );

    expect(observed).toEqual({
      symbol: "XYZ",
      quarter: "latest",
      options: { positionType: "COMMON_EQUITY" },
    });
    expect(result?.symbol).toBe("XYZ");
  });
});