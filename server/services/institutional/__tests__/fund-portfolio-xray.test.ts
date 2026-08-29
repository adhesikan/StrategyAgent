import { describe, expect, it } from "vitest";
import {
  computeFundPortfolioXRay,
  getFundPortfolioAnalytics,
  selectEffectiveFundFilings,
  type EffectiveFundFilingCandidate,
  type EnrichedInstitutionalHolding,
  type FundPortfolioXRayCalculationInput,
  type FundPortfolioXRayRepository,
  type InstitutionalSecurityMetadata,
  type InstitutionalThemeMembership,
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

const metadataBySymbol: Record<string, InstitutionalSecurityMetadata> = {
  A: {
    symbol: "A",
    companyName: "Alpha Semiconductor",
    sector: "Technology",
    industry: "Semiconductors",
    subIndustry: null,
    marketCap: 100,
    exchange: "NYSE",
    country: "United States",
    assetType: "common_stock",
  },
  B: {
    symbol: "B",
    companyName: "Beta Cloud",
    sector: "Technology",
    industry: "Software",
    subIndustry: null,
    marketCap: 100,
    exchange: "NASDAQ",
    country: "United States",
    assetType: "common_stock",
  },
  C: {
    symbol: "C",
    companyName: "Care Biotech",
    sector: "Healthcare",
    industry: "Biotechnology",
    subIndustry: null,
    marketCap: 100,
    exchange: "NASDAQ",
    country: "United States",
    assetType: "common_stock",
  },
  D: {
    symbol: "D",
    companyName: "Delta Retail",
    sector: "Consumer",
    industry: "Retail",
    subIndustry: null,
    marketCap: 100,
    exchange: "NYSE",
    country: "United States",
    assetType: "common_stock",
  },
  G: {
    symbol: "G",
    companyName: "Gamma Financial",
    sector: "Financials",
    industry: "Banks",
    subIndustry: null,
    marketCap: 100,
    exchange: "NYSE",
    country: "United States",
    assetType: "common_stock",
  },
};

const themes: Record<string, InstitutionalThemeMembership> = {
  ai: {
    themeId: "ai",
    themeName: "Artificial Intelligence",
    description: null,
    classificationMethod: "curated",
  },
  chips: {
    themeId: "chips",
    themeName: "Semiconductors",
    description: null,
    classificationMethod: "curated",
  },
  biotech: {
    themeId: "biotech",
    themeName: "Biotechnology",
    description: null,
    classificationMethod: "curated",
  },
};

function holding(
  symbol: string | null,
  cusip: string,
  reportedValueDollars: number,
  reportedShares: number,
  overrides: Partial<EnrichedInstitutionalHolding> = {},
): EnrichedInstitutionalHolding {
  const metadata = symbol ? metadataBySymbol[symbol] : null;
  return {
    holdingId: `${overrides.periodOfReport ?? QUARTER.periodEndDate}-${cusip}-${overrides.putCall ?? "equity"}`,
    accessionNumber: "current-accession",
    filerCik: "0000000001",
    filerName: "Fixture Manager",
    issuerName: metadata?.companyName ?? `Unclassified ${cusip}`,
    cusip,
    periodOfReport: QUARTER.periodEndDate,
    reportedValueDollars,
    reportedShares,
    sharesPrnType: "SH",
    securityPositionType: overrides.putCall ? String(overrides.putCall).toUpperCase() : "COMMON_EQUITY",
    putCall: null,
    mappingResolution: symbol ? "reliably_mapped" : "unmapped",
    metadataResolution: symbol ? "canonical" : "unavailable",
    classificationStatus: symbol ? "classified" : "unclassified",
    unclassifiedReason: symbol ? null : "unmapped",
    metadata,
    themes: [],
    ...overrides,
  };
}

function currentHoldings(): EnrichedInstitutionalHolding[] {
  return [
    holding("A", "000000001", 30, 300, { themes: [themes.ai, themes.chips] }),
    holding("B", "000000002", 25, 250, { themes: [themes.ai] }),
    holding("C", "000000003", 20, 200, { themes: [themes.biotech] }),
    holding("D", "000000004", 10, 100),
    holding(null, "000000005", 10, 100),
    holding(null, "000000006", 5, 50, {
      mappingResolution: "ambiguous",
      unclassifiedReason: "ambiguous",
    }),
    holding("A", "000000001", 999, 999, {
      holdingId: "put-row",
      putCall: "Put",
      securityPositionType: "PUT",
    }),
    holding("B", "000000009", 500, 500, {
      holdingId: "principal-row",
      sharesPrnType: "PRN",
    }),
  ];
}

function previousHoldings(): EnrichedInstitutionalHolding[] {
  const previous = (item: EnrichedInstitutionalHolding) => ({
    ...item,
    accessionNumber: "previous-accession",
    periodOfReport: PREVIOUS_QUARTER.periodEndDate,
  });
  return [
    previous(holding("A", "000000001", 20, 200, { themes: [themes.ai, themes.chips] })),
    previous(holding("B", "000000002", 30, 300, { themes: [themes.ai] })),
    previous(holding("C", "000000003", 20, 200, { themes: [themes.biotech] })),
    previous(holding(null, "000000005", 10, 100)),
    previous(holding(null, "000000006", 10, 100, {
      mappingResolution: "ambiguous",
      unclassifiedReason: "ambiguous",
    })),
    previous(holding("G", "000000007", 10, 100)),
    previous(holding("A", "000000001", 777, 777, {
      holdingId: "previous-put-row",
      putCall: "Put",
      securityPositionType: "PUT",
    })),
  ];
}

function input(): FundPortfolioXRayCalculationInput {
  return {
    managerId: "0000000001",
    managerName: "Fixture Manager",
    quarter: QUARTER,
    previousQuarter: PREVIOUS_QUARTER,
    currentHoldings: currentHoldings(),
    previousHoldings: previousHoldings(),
  };
}

describe("fund portfolio X-ray analytics", () => {
  it("computes reported totals, concentration, sector weights, and coverage", () => {
    const result = computeFundPortfolioXRay(input());

    expect(result.reportedPortfolioValue).toBe(100);
    expect(result.reportedPositionCount).toBe(6);
    expect(result.top5Weight).toBe(95);
    expect(result.top10Weight).toBe(100);
    expect(result.top20Weight).toBe(100);
    expect(result.sectorAllocation).toEqual([
      { name: "Technology", reportedValue: 55, portfolioWeight: 55, positionCount: 2 },
      { name: "Healthcare", reportedValue: 20, portfolioWeight: 20, positionCount: 1 },
      { name: "Consumer", reportedValue: 10, portfolioWeight: 10, positionCount: 1 },
    ]);
    expect(result.industryAllocation.map((allocation) => allocation.name)).toEqual([
      "Semiconductors",
      "Software",
      "Biotechnology",
      "Retail",
    ]);
    expect(result.mappingCoverage).toEqual({
      totalPositionCount: 6,
      mappedPositionCount: 4,
      unmappedPositionCount: 1,
      ambiguousPositionCount: 1,
      coveragePercent: 66.67,
    });
    expect(result.classificationCoverage).toMatchObject({
      totalPositionCount: 6,
      classifiedPositionCount: 4,
      unclassifiedPositionCount: 2,
      coveragePercent: 66.67,
    });
  });

  it("treats theme allocation as overlapping exposure that may exceed 100%", () => {
    const result = computeFundPortfolioXRay(input());

    expect(result.themeAllocation).toEqual([
      {
        name: "Artificial Intelligence",
        themeId: "ai",
        reportedValue: 55,
        portfolioWeight: 55,
        positionCount: 2,
      },
      {
        name: "Semiconductors",
        themeId: "chips",
        reportedValue: 30,
        portfolioWeight: 30,
        positionCount: 1,
      },
      {
        name: "Biotechnology",
        themeId: "biotech",
        reportedValue: 20,
        portfolioWeight: 20,
        positionCount: 1,
      },
    ]);
    expect(
      result.themeAllocation.reduce(
        (sum, allocation) => sum + (allocation.portfolioWeight ?? 0),
        0,
      ),
    ).toBe(105);
  });

  it("classifies reported quarter changes without transaction labels", () => {
    const result = computeFundPortfolioXRay(input());

    expect(result.newlyReportedCount).toBe(1);
    expect(result.increasedReportedCount).toBe(1);
    expect(result.reducedReportedCount).toBe(2);
    expect(result.noLongerReportedCount).toBe(1);
    expect(result.largestReportedShareIncreases[0]).toMatchObject({
      symbol: "A",
      reportedShareChange: 100,
      changeType: "INCREASED",
    });
    expect(result.largestReportedShareReductions[0]).toMatchObject({
      symbol: "G",
      reportedShareChange: -100,
      changeType: "EXITED",
    });
    expect(result.largestWeightIncreases.map((position) => position.symbol)).toEqual([
      "A",
      "D",
    ]);
    expect(result.largestWeightDecreases.map((position) => position.symbol)).toEqual([
      "G",
      "B",
      null,
    ]);
    expect(JSON.stringify(result)).not.toMatch(/\b(buy|sell|bought|sold)\b/i);
  });

  it("excludes options and PRN rows by default and permits explicit option analysis", () => {
    const equity = computeFundPortfolioXRay(input());
    const puts = computeFundPortfolioXRay(input(), { positionType: "PUT" });

    expect(equity.reportedPortfolioValue).toBe(100);
    expect(equity.largestPortfolioWeights.some((position) => position.reportedValue === 999))
      .toBe(false);
    expect(puts.reportedPositionCount).toBe(1);
    expect(puts.reportedPortfolioValue).toBe(999);
    expect(puts.positionType).toBe("PUT");
  });

  it("uses deterministic top-N ordering and bounds largest lists", () => {
    const result = computeFundPortfolioXRay(input(), { topN: 2 });

    expect(result.largestPortfolioWeights.map((position) => position.symbol)).toEqual(["A", "B"]);
    expect(result.largestPortfolioWeights).toHaveLength(2);
    expect(result.largestWeightDecreases).toHaveLength(2);
  });

  it("selects only authoritative effective filings for latest and exact quarters", () => {
    const rows: EffectiveFundFilingCandidate[] = [
      {
        accessionNumber: "q2-original",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-01",
        isEffective: false,
      },
      {
        accessionNumber: "q2-amendment",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-10",
        isEffective: true,
      },
      {
        accessionNumber: "q1",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-10",
        isEffective: true,
      },
      {
        accessionNumber: "q4",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2025-12-31",
        filingDate: "2026-02-10",
        isEffective: true,
      },
    ];

    expect(selectEffectiveFundFilings(rows, "latest")).toMatchObject({
      current: { accessionNumber: "q2-amendment" },
      previous: { accessionNumber: "q1" },
    });
    expect(selectEffectiveFundFilings(rows, "2026-Q1")).toMatchObject({
      current: { accessionNumber: "q1" },
      previous: { accessionNumber: "q4" },
    });
  });

  it("does not compare non-adjacent effective filings as quarter-over-quarter", () => {
    const rows: EffectiveFundFilingCandidate[] = [
      {
        accessionNumber: "q2",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-10",
        isEffective: true,
      },
      {
        accessionNumber: "q4",
        managerId: "0000000001",
        managerName: "Fixture Manager",
        periodOfReport: "2025-12-31",
        filingDate: "2026-02-10",
        isEffective: true,
      },
    ];

    expect(selectEffectiveFundFilings(rows, "latest")).toMatchObject({
      current: { accessionNumber: "q2" },
      previous: null,
    });
  });

  it("rounds top-N concentration only after summing reported values", () => {
    const equalPositions = Array.from({ length: 6 }, (_, index) =>
      holding(null, `10000000${index}`, 1, 1),
    );
    const result = computeFundPortfolioXRay({
      ...input(),
      previousQuarter: null,
      currentHoldings: equalPositions,
      previousHoldings: [],
    });

    expect(result.top5Weight).toBe(83.33);
    expect(result.top10Weight).toBe(100);
  });

  it("uses CUSIP as the final deterministic tie-breaker for change lists", () => {
    const tiedPrevious = [
      holding(null, "200000002", 1, 100, {
        issuerName: "Same Name",
        periodOfReport: PREVIOUS_QUARTER.periodEndDate,
      }),
      holding(null, "200000001", 1, 100, {
        issuerName: "Same Name",
        periodOfReport: PREVIOUS_QUARTER.periodEndDate,
      }),
    ];
    const result = computeFundPortfolioXRay({
      ...input(),
      currentHoldings: [],
      previousHoldings: tiedPrevious,
    });

    expect(
      result.largestReportedShareReductions.map((position) => position.cusip),
    ).toEqual(["200000001", "200000002"]);
    expect(
      result.largestWeightDecreases.map((position) => position.cusip),
    ).toEqual(["200000001", "200000002"]);
  });

  it("exposes the positional service with latest/common-equity defaults", async () => {
    let observedQuery: Parameters<FundPortfolioXRayRepository["getFundPortfolioSource"]>[0] | null =
      null;
    const repository: FundPortfolioXRayRepository = {
      async getFundPortfolioSource(query) {
        observedQuery = query;
        return {
          managerId: "0000000001",
          managerName: "Fixture Manager",
          currentFiling: {
            accessionNumber: "current-accession",
            managerId: "0000000001",
            managerName: "Fixture Manager",
            periodOfReport: QUARTER.periodEndDate,
            filingDate: "2026-08-10",
            isEffective: true,
          },
          currentHoldings: currentHoldings(),
          previousFiling: null,
          previousHoldings: [],
        };
      },
    };

    const result = await getFundPortfolioAnalytics(
      "1",
      "latest",
      {},
      repository,
    );

    expect(observedQuery).toMatchObject({
      managerId: "1",
      quarter: "latest",
      options: { positionType: "COMMON_EQUITY" },
    });
    expect(result?.positionType).toBe("COMMON_EQUITY");
    expect(result?.quarter.label).toBe("2026-Q2");
    expect(result?.newlyReportedCount).toBe(0);
  });
});