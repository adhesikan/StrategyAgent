import { describe, expect, it } from "vitest";
import {
  computeCrossFundActivityRanking,
  getInstitutionalAccumulationRanking,
  selectEffectiveStockFilings,
  type CrossFundActivityCalculationInput,
  type CrossFundInstitutionalRepository,
  type EnrichedInstitutionalHolding,
  type InstitutionalActivityRankingSort,
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

const SYMBOLS: Record<
  string,
  {
    cusip: string;
    company: string;
    sector: string;
    industry: string;
    marketCap: number;
    themeId?: string;
    themeName?: string;
  }
> = {
  AAA: {
    cusip: "000000001",
    company: "Alpha Software",
    sector: "Technology",
    industry: "Software",
    marketCap: 1_000,
    themeId: "ai",
    themeName: "Artificial Intelligence",
  },
  BBB: {
    cusip: "000000002",
    company: "Beta Bio",
    sector: "Health Care",
    industry: "Biotechnology",
    marketCap: 500,
    themeId: "health",
    themeName: "Health Innovation",
  },
  CCC: {
    cusip: "000000003",
    company: "Core Hardware",
    sector: "Technology",
    industry: "Hardware",
    marketCap: 2_000,
    themeId: "ai",
    themeName: "Artificial Intelligence",
  },
  DDD: {
    cusip: "000000004",
    company: "Delta Systems",
    sector: "Technology",
    industry: "Software",
    marketCap: 3_000,
  },
};

function holding(
  symbol: string,
  managerId: string,
  shares: number,
  value = shares,
  overrides: Partial<EnrichedInstitutionalHolding> = {},
): EnrichedInstitutionalHolding {
  const definition = SYMBOLS[symbol] ?? {
    cusip: symbol.padEnd(9, "0").slice(0, 9),
    company: `${symbol} Corporation`,
    sector: "Industrials",
    industry: "Machinery",
    marketCap: 1_000,
  };
  return {
    holdingId: `${managerId}-${symbol}-${definition.cusip}-${overrides.putCall ?? "E"}`,
    accessionNumber: `${managerId}-current`,
    filerCik: managerId,
    filerName: `Manager ${managerId}`,
    issuerName: definition.company,
    cusip: definition.cusip,
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
      symbol,
      companyName: definition.company,
      sector: definition.sector,
      industry: definition.industry,
      subIndustry: null,
      marketCap: definition.marketCap,
      exchange: "NYSE",
      country: "United States",
      assetType: "common_stock",
    },
    themes:
      definition.themeId && definition.themeName
        ? [
            {
              themeId: definition.themeId,
              themeName: definition.themeName,
              relevance: "primary",
            },
          ]
        : [],
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

function baseInput(): CrossFundActivityCalculationInput {
  const currentHoldings = [
    holding("AAA", "M1", 150),
    holding("AAA", "M2", 100),
    holding("AAA", "M3", 50),
    holding("BBB", "M1", 300),
    holding("BBB", "M2", 200),
    holding("CCC", "M1", 70),
    holding("CCC", "M2", 80),
  ];
  const previousHoldings = [
    previous(holding("AAA", "M1", 100)),
    previous(holding("AAA", "M2", 120)),
    previous(holding("AAA", "M4", 40)),
    previous(holding("BBB", "M1", 200)),
    previous(holding("BBB", "M5", 50)),
    previous(holding("CCC", "M1", 100)),
    previous(holding("CCC", "M2", 100)),
    previous(holding("DDD", "M1", 90)),
  ];
  return {
    quarter: QUARTER,
    previousQuarter: PREVIOUS_QUARTER,
    dataAsOf: QUARTER.periodEndDate,
    currentHoldings,
    previousHoldings,
    currentFilingManagerIds: ["M1", "M2", "M3", "M4", "M5"],
    comparableManagerIds: ["M1", "M2", "M3", "M4", "M5"],
  };
}

describe("cross-fund institutional activity rankings", () => {
  it("selects one effective filing per manager with the later amendment winning", () => {
    const selected = selectEffectiveStockFilings(
      [
        {
          accessionNumber: "M1-original",
          managerId: "M1",
          managerName: "Manager M1",
          periodOfReport: "2026-06-30",
          filingDate: "2026-08-01",
          isEffective: true,
        },
        {
          accessionNumber: "M1-amendment",
          managerId: "M1",
          managerName: "Manager M1",
          periodOfReport: "2026-06-30",
          filingDate: "2026-08-15",
          isEffective: true,
        },
        {
          accessionNumber: "M1-prior",
          managerId: "M1",
          managerName: "Manager M1",
          periodOfReport: "2026-03-31",
          filingDate: "2026-05-01",
          isEffective: true,
        },
      ],
      "2026-Q2",
    );
    expect(selected?.currentFilings.map((filing) => filing.accessionNumber)).toEqual([
      "M1-amendment",
    ]);
    expect(selected?.comparableManagerIds).toEqual(["M1"]);
  });

  it("computes accumulation breadth, filing changes, values, and a safe ratio", () => {
    const result = computeCrossFundActivityRanking(
      "ACCUMULATION",
      baseInput(),
    );
    expect(result.items.map((item) => item.symbol)).toEqual(["BBB", "AAA"]);
    expect(result.items[1]).toMatchObject({
      symbol: "AAA",
      companyName: "Alpha Software",
      currentReportedHolderCount: 3,
      previousReportedHolderCount: 3,
      holderCountChange: 0,
      newlyReportedHolderCount: 1,
      increasedReportedHolderCount: 1,
      reducedReportedHolderCount: 1,
      noLongerReportedHolderCount: 1,
      unchangedReportedHolderCount: 0,
      netHolderIncrease: 0,
      aggregateReportedShares: 300,
      previousAggregateReportedShares: 260,
      aggregateReportedShareChange: 40,
      aggregateReportedShareChangePct: 15.38,
      aggregateReportedValue: 300,
      increaseToReductionRatio: 1.67,
      cusips: ["000000001"],
    });
    expect(result).toMatchObject({
      totalCount: 2,
      trackedManagerCount: 5,
      comparableManagerCount: 5,
      sortBy: "aggregateShareIncrease",
      sortDirection: "desc",
    });
  });

  it("returns independent reduction, newly reported, and no-longer-reported views", () => {
    const input = baseInput();
    const reductions = computeCrossFundActivityRanking("REDUCTION", input);
    const newReports = computeCrossFundActivityRanking("NEWLY_REPORTED", input);
    const exits = computeCrossFundActivityRanking("NO_LONGER_REPORTED", input);

    expect(reductions.items.map((item) => item.symbol)).toEqual([
      "DDD",
      "CCC",
      "AAA",
      "BBB",
    ]);
    expect(newReports.items.map((item) => item.symbol)).toEqual(["AAA", "BBB"]);
    expect(exits.items.map((item) => item.symbol)).toEqual([
      "DDD",
      "AAA",
      "BBB",
    ]);
    expect(exits.items[0]).toMatchObject({
      currentReportedHolderCount: 0,
      previousReportedHolderCount: 1,
      aggregateReportedShares: 0,
      previousAggregateReportedShares: 90,
      aggregateReportedShareChange: -90,
      aggregateReportedShareChangePct: -100,
      aggregateReportedValue: 0,
      increaseToReductionRatio: 0,
    });
  });

  it.each([
    ["netHolderIncrease", "BBB"],
    ["newHolderCount", "AAA"],
    ["increasedHolderCount", "AAA"],
    ["aggregateShareIncreasePct", "BBB"],
    ["aggregateShareIncrease", "BBB"],
    ["reportedValue", "BBB"],
  ] as Array<[InstitutionalActivityRankingSort, string]>)(
    "supports deterministic %s sorting",
    (sortBy, expectedFirst) => {
      const result = computeCrossFundActivityRanking(
        "ACCUMULATION",
        baseInput(),
        { sortBy },
      );
      expect(result.items[0]?.symbol).toBe(expectedFirst);
    },
  );

  it("supports explicit ascending sort direction", () => {
    const result = computeCrossFundActivityRanking(
      "ACCUMULATION",
      baseInput(),
      { sortBy: "aggregateShareIncrease", sortDirection: "asc" },
    );
    expect(result.items.map((item) => item.symbol)).toEqual(["AAA", "BBB"]);
  });

  it("applies sector, industry, theme, market-cap, manager, and value filters", () => {
    const input = baseInput();
    const symbols = (options: Parameters<typeof computeCrossFundActivityRanking>[2]) =>
      computeCrossFundActivityRanking("ACCUMULATION", input, options).items.map(
        (item) => item.symbol,
      );
    expect(symbols({ sector: "technology" })).toEqual(["AAA"]);
    expect(symbols({ industry: "software" })).toEqual(["AAA"]);
    expect(symbols({ theme: "ARTIFICIAL INTELLIGENCE" })).toEqual(["AAA"]);
    expect(symbols({ theme: "ai" })).toEqual(["AAA"]);
    expect(symbols({ marketCapMin: 900, marketCapMax: 1_500 })).toEqual(["AAA"]);
    expect(symbols({ minManagers: 2 })).toEqual(["BBB", "AAA"]);
    expect(symbols({ minManagers: 3 })).toEqual([]);
    expect(symbols({ minReportedValue: 400 })).toEqual(["BBB"]);
  });

  it("keeps PUT and CALL activity independent and excludes PRN from common equity", () => {
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings: [
        holding("PUTX", "M1", 30, 30, {
          putCall: "PUT",
          securityPositionType: "PUT",
        }),
        holding("CALLX", "M1", 40, 40, {
          putCall: "CALL",
          securityPositionType: "CALL",
        }),
        holding("PRNX", "M1", 50, 50, { sharesPrnType: "PRN" }),
      ],
      previousHoldings: [
        previous(
          holding("PUTX", "M1", 10, 10, {
            putCall: "PUT",
            securityPositionType: "PUT",
          }),
        ),
        previous(
          holding("CALLX", "M1", 20, 20, {
            putCall: "CALL",
            securityPositionType: "CALL",
          }),
        ),
      ],
    };
    expect(
      computeCrossFundActivityRanking("ACCUMULATION", input).items,
    ).toEqual([]);
    expect(
      computeCrossFundActivityRanking("ACCUMULATION", input, {
        positionType: "PUT",
      }).items.map((item) => item.symbol),
    ).toEqual(["PUTX"]);
    expect(
      computeCrossFundActivityRanking("ACCUMULATION", input, {
        positionType: "CALL",
      }).items.map((item) => item.symbol),
    ).toEqual(["CALLX"]);
  });

  it("uses prior-side coverage for an exit-only selected position type", () => {
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings: [],
      previousHoldings: [
        previous(
          holding("PUTX", "M1", 30, 30, {
            putCall: "PUT",
            securityPositionType: "PUT",
          }),
        ),
      ],
      currentFilingManagerIds: ["M1"],
      comparableManagerIds: ["M1"],
    };
    const result = computeCrossFundActivityRanking(
      "NO_LONGER_REPORTED",
      input,
      { positionType: "PUT" },
    );
    expect(result.items.map((item) => item.symbol)).toEqual(["PUTX"]);
    expect(result.dataQuality).toMatchObject({
      status: "complete",
      coveragePercent: 100,
    });
  });

  it("does not classify managers without an adjacent prior filing", () => {
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings: [
        holding("AAA", "M1", 150),
        holding("AAA", "M6", 50),
      ],
      previousHoldings: [previous(holding("AAA", "M1", 100))],
      currentFilingManagerIds: ["M1", "M6"],
      comparableManagerIds: ["M1"],
    };
    const item = computeCrossFundActivityRanking(
      "ACCUMULATION",
      input,
    ).items[0]!;
    expect(item).toMatchObject({
      newlyReportedHolderCount: 0,
      increasedReportedHolderCount: 1,
      aggregateReportedShareChange: null,
      aggregateReportedShareChangePct: null,
      holderCountChange: null,
      netHolderIncrease: null,
      increaseToReductionRatio: null,
    });
    expect(
      computeCrossFundActivityRanking("NEWLY_REPORTED", input).items,
    ).toEqual([]);
    expect(
      computeCrossFundActivityRanking("ACCUMULATION", input).dataQuality.status,
    ).toBe("partial");
  });

  it("returns no comparative activity when the adjacent prior quarter is absent", () => {
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      previousQuarter: null,
      previousHoldings: [],
      currentHoldings: [holding("AAA", "M1", 100)],
      currentFilingManagerIds: ["M1"],
      comparableManagerIds: [],
    };
    const accumulation = computeCrossFundActivityRanking(
      "ACCUMULATION",
      input,
    );
    const newReports = computeCrossFundActivityRanking(
      "NEWLY_REPORTED",
      input,
    );
    expect(accumulation.items).toEqual([]);
    expect(newReports.items).toEqual([]);
    expect(accumulation.dataQuality).toMatchObject({
      status: "partial",
      coveragePercent: 100,
    });
    expect(accumulation.dataQuality.warnings).toContain(
      "No adjacent effective prior quarter is available for comparison.",
    );
  });

  it("returns null for an undefined reduction denominator and zero for no increases", () => {
    const newOnly: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings: [holding("NEWX", "M1", 100)],
      previousHoldings: [],
      currentFilingManagerIds: ["M1"],
      comparableManagerIds: ["M1"],
    };
    const newItem = computeCrossFundActivityRanking(
      "NEWLY_REPORTED",
      newOnly,
    ).items[0]!;
    expect(newItem.increaseToReductionRatio).toBeNull();
    const reducedItem = computeCrossFundActivityRanking(
      "REDUCTION",
      baseInput(),
    ).items.find((item) => item.symbol === "CCC")!;
    expect(reducedItem.increaseToReductionRatio).toBe(0);
  });

  it("aggregates multiple CUSIPs into one canonical symbol without guessing mappings", () => {
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings: [
        holding("AAA", "M1", 50),
        holding("AAA", "M1", 25, 25, {
          holdingId: "M1-AAA-second-class",
          cusip: "999999999",
        }),
        holding("GUESS", "M2", 100, 100, {
          mappingResolution: "ambiguous_mapping",
          metadataResolution: "unavailable",
        }),
      ],
      previousHoldings: [
        previous(holding("AAA", "M1", 40)),
        previous(
          holding("AAA", "M1", 10, 10, {
            holdingId: "M1-AAA-second-class-prior",
            cusip: "999999999",
          }),
        ),
      ],
      currentFilingManagerIds: ["M1", "M2"],
      comparableManagerIds: ["M1", "M2"],
    };
    const result = computeCrossFundActivityRanking("ACCUMULATION", input);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      symbol: "AAA",
      aggregateReportedShares: 75,
      previousAggregateReportedShares: 50,
      cusips: ["000000001", "999999999"],
    });
    expect(result.dataQuality).toMatchObject({
      status: "partial",
      coveragePercent: 80,
    });
  });

  it("uses stable symbol tie-breaks and paginates without silently truncating totals", () => {
    const currentHoldings = Array.from({ length: 120 }, (_, index) => {
      const symbol = `S${String(index).padStart(3, "0")}`;
      return holding(symbol, "M1", 10);
    });
    const input: CrossFundActivityCalculationInput = {
      ...baseInput(),
      currentHoldings,
      previousHoldings: [],
      currentFilingManagerIds: ["M1"],
      comparableManagerIds: ["M1"],
    };
    const first = computeCrossFundActivityRanking("NEWLY_REPORTED", input, {
      limit: 100,
    });
    const second = computeCrossFundActivityRanking("NEWLY_REPORTED", input, {
      limit: 100,
      offset: 100,
    });
    const beyond = computeCrossFundActivityRanking("NEWLY_REPORTED", input, {
      offset: 200,
    });
    expect(first.totalCount).toBe(120);
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.symbol).toBe("S000");
    expect(first.items[99]?.symbol).toBe("S099");
    expect(second.items).toHaveLength(20);
    expect(second.items[0]?.symbol).toBe("S100");
    expect(beyond.items).toEqual([]);
  });

  it("loads one bounded source per service request and preserves query options", async () => {
    const source = baseInput();
    const calls: unknown[] = [];
    const repository: CrossFundInstitutionalRepository = {
      async getCrossFundInstitutionalSource(query) {
        calls.push(query);
        return source;
      },
    };
    const result = await getInstitutionalAccumulationRanking(
      {
        quarter: "2026-Q2",
        positionType: "COMMON_EQUITY",
        limit: 1,
        offset: 1,
      },
      repository,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      quarter: "2026-Q2",
      options: {
        positionType: "COMMON_EQUITY",
        limit: 1,
        offset: 1,
      },
    });
    expect(result?.items).toHaveLength(1);
  });
});