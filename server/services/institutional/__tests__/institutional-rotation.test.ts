import { describe, expect, it } from "vitest";
import {
  computeInstitutionalRotation,
  getSectorRotation,
  type CrossFundInstitutionalRepository,
  type EnrichedInstitutionalHolding,
  type RotationCalculationInput,
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

interface HoldingDefinition {
  symbol: string;
  managerId: string;
  shares: number;
  value: number;
  sector: string;
  industry: string;
  themes?: Array<{ id: string; name: string }>;
}

function holding(
  definition: HoldingDefinition,
  overrides: Partial<EnrichedInstitutionalHolding> = {},
): EnrichedInstitutionalHolding {
  const {
    symbol,
    managerId,
    shares,
    value,
    sector,
    industry,
    themes = [],
  } = definition;
  return {
    holdingId: `${managerId}-${symbol}-${overrides.putCall ?? "E"}`,
    accessionNumber: `${managerId}-current`,
    filerCik: managerId,
    filerName: `Manager ${managerId}`,
    issuerName: `${symbol} Corporation`,
    cusip: symbol.padEnd(9, "0").slice(0, 9),
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
      companyName: `${symbol} Corporation`,
      sector,
      industry,
      subIndustry: null,
      marketCap: 1_000,
      exchange: "NYSE",
      country: "United States",
      assetType: "common_stock",
    },
    themes: themes.map((theme) => ({
      themeId: theme.id,
      themeName: theme.name,
      relevance: "primary",
    })),
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

const AI = { id: "ai", name: "Artificial Intelligence" };
const CLOUD = { id: "cloud", name: "Cloud Computing" };
const HEALTH = { id: "health", name: "Health Innovation" };
const ENERGY = { id: "energy", name: "Energy Transition" };

function baseInput(): RotationCalculationInput {
  const currentHoldings = [
    holding({
      symbol: "AAPL",
      managerId: "M1",
      shares: 150,
      value: 300,
      sector: "Technology",
      industry: "Software",
      themes: [AI, CLOUD],
    }),
    holding({
      symbol: "AAPL",
      managerId: "M2",
      shares: 50,
      value: 100,
      sector: "Technology",
      industry: "Software",
      themes: [AI, CLOUD],
    }),
    holding({
      symbol: "MSFT",
      managerId: "M1",
      shares: 80,
      value: 240,
      sector: "Technology",
      industry: "Software",
      themes: [AI],
    }),
    holding({
      symbol: "JNJ",
      managerId: "M3",
      shares: 100,
      value: 500,
      sector: "Health Care",
      industry: "Pharmaceuticals",
      themes: [HEALTH],
    }),
    holding(
      {
        symbol: "UNKNOWN",
        managerId: "M1",
        shares: 1_000,
        value: 1_000,
        sector: "Technology",
        industry: "Software",
      },
      {
        mappingResolution: "unmapped",
        metadataResolution: "unavailable",
        classificationStatus: "unclassified",
        unclassifiedReason: "unmapped",
      },
    ),
    holding(
      {
        symbol: "PUTX",
        managerId: "M1",
        shares: 999,
        value: 999,
        sector: "Technology",
        industry: "Software",
      },
      { putCall: "PUT", securityPositionType: "PUT" },
    ),
    holding(
      {
        symbol: "PRNX",
        managerId: "M1",
        shares: 888,
        value: 888,
        sector: "Technology",
        industry: "Software",
      },
      { sharesPrnType: "PRN" },
    ),
  ];
  const previousHoldings = [
    previous(
      holding({
        symbol: "AAPL",
        managerId: "M1",
        shares: 100,
        value: 150,
        sector: "Technology",
        industry: "Software",
        themes: [AI, CLOUD],
      }),
    ),
    previous(
      holding({
        symbol: "MSFT",
        managerId: "M1",
        shares: 100,
        value: 200,
        sector: "Technology",
        industry: "Software",
        themes: [AI],
      }),
    ),
    previous(
      holding({
        symbol: "JNJ",
        managerId: "M3",
        shares: 100,
        value: 450,
        sector: "Health Care",
        industry: "Pharmaceuticals",
        themes: [HEALTH],
      }),
    ),
    previous(
      holding({
        symbol: "EXIT",
        managerId: "M4",
        shares: 60,
        value: 120,
        sector: "Energy",
        industry: "Oil & Gas",
        themes: [ENERGY],
      }),
    ),
    previous(
      holding(
        {
          symbol: "PUTX",
          managerId: "M1",
          shares: 500,
          value: 500,
          sector: "Technology",
          industry: "Software",
        },
        { putCall: "PUT", securityPositionType: "PUT" },
      ),
    ),
  ];
  return {
    quarter: QUARTER,
    previousQuarter: PREVIOUS_QUARTER,
    currentHoldings,
    previousHoldings,
    comparableManagerIds: ["M1", "M2", "M3", "M4"],
  };
}

describe("institutional classification rotation", () => {
  it("calculates sector exposure, breadth, and reported-share activity separately", () => {
    const result = computeInstitutionalRotation("SECTOR", baseInput());
    expect(result.classifications.map((row) => row.classification)).toEqual([
      "Energy",
      "Health Care",
      "Technology",
    ]);
    const technology = result.classifications.find(
      (row) => row.classification === "Technology",
    )!;
    expect(technology).toMatchObject({
      quarter: QUARTER,
      currentReportedValue: 640,
      previousReportedValue: 350,
      reportedValueChange: 290,
      reportedValueChangePct: 82.86,
      currentReportedShares: 280,
      managerCount: 2,
      previousManagerCount: 1,
      managerCountChange: 1,
      newlyReportedPositionCount: 1,
      increasedReportedPositionCount: 1,
      reducedReportedPositionCount: 1,
      noLongerReportedPositionCount: 0,
    });
    // MSFT's reported value rose from 200 to 240 while shares fell from 100
    // to 80, proving value movement is not used as the activity classifier.
    expect(technology.reportedValueChange).toBeGreaterThan(0);
    expect(technology.reducedReportedPositionCount).toBe(1);
    expect(result.dataQuality.warnings[0]).toContain(
      "may change because of security price movements",
    );
  });

  it("calculates industry movement and includes prior-only exits", () => {
    const result = computeInstitutionalRotation("INDUSTRY", baseInput());
    const software = result.classifications.find(
      (row) => row.classification === "Software",
    )!;
    const oil = result.classifications.find(
      (row) => row.classification === "Oil & Gas",
    )!;
    expect(software).toMatchObject({
      currentReportedValue: 640,
      previousReportedValue: 350,
      newlyReportedPositionCount: 1,
      increasedReportedPositionCount: 1,
      reducedReportedPositionCount: 1,
    });
    expect(oil).toMatchObject({
      currentReportedValue: 0,
      previousReportedValue: 120,
      reportedValueChange: -120,
      reportedValueChangePct: -100,
      currentReportedShares: 0,
      managerCount: 0,
      previousManagerCount: 1,
      managerCountChange: -1,
      noLongerReportedPositionCount: 1,
    });
  });

  it("expands overlapping themes non-exclusively", () => {
    const result = computeInstitutionalRotation("THEME", baseInput());
    const ai = result.classifications.find(
      (row) => row.classificationId === "ai",
    )!;
    const cloud = result.classifications.find(
      (row) => row.classificationId === "cloud",
    )!;
    expect(ai).toMatchObject({
      classification: "Artificial Intelligence",
      currentReportedValue: 640,
      previousReportedValue: 350,
      currentReportedShares: 280,
    });
    expect(cloud).toMatchObject({
      classification: "Cloud Computing",
      currentReportedValue: 400,
      previousReportedValue: 150,
      currentReportedShares: 200,
    });
    expect(ai.currentReportedValue! + cloud.currentReportedValue!).toBeGreaterThan(
      640,
    );
  });

  it("excludes unmapped securities and reports partial mapping coverage", () => {
    const result = computeInstitutionalRotation("SECTOR", baseInput());
    const technology = result.classifications.find(
      (row) => row.classification === "Technology",
    )!;
    expect(technology.currentReportedValue).toBe(640);
    expect(
      result.classifications.some(
        (row) => row.currentReportedValue === 1_000,
      ),
    ).toBe(false);
    expect(result.dataQuality).toMatchObject({
      status: "partial",
      coveragePercent: 88.89,
    });
  });

  it("fails comparison fields closed when the adjacent prior quarter is missing", () => {
    const current = baseInput().currentHoldings.slice(0, 1);
    const result = computeInstitutionalRotation("SECTOR", {
      quarter: QUARTER,
      previousQuarter: null,
      currentHoldings: current,
      previousHoldings: [],
      comparableManagerIds: [],
    });
    expect(result.classifications[0]).toMatchObject({
      classification: "Technology",
      currentReportedValue: 300,
      previousReportedValue: null,
      reportedValueChange: null,
      reportedValueChangePct: null,
      previousManagerCount: null,
      managerCountChange: null,
      newlyReportedPositionCount: 0,
      increasedReportedPositionCount: 0,
      reducedReportedPositionCount: 0,
      noLongerReportedPositionCount: 0,
    });
    expect(result.dataQuality.status).toBe("partial");
  });

  it("excludes options and PRN rows by default and keeps option shares non-aggregated", () => {
    const common = computeInstitutionalRotation("SECTOR", baseInput());
    const technology = common.classifications.find(
      (row) => row.classification === "Technology",
    )!;
    expect(technology.currentReportedValue).toBe(640);

    const puts = computeInstitutionalRotation("SECTOR", baseInput(), {
      positionType: "PUT",
    });
    expect(puts.classifications).toEqual([
      expect.objectContaining({
        classification: "Technology",
        currentReportedValue: 999,
        previousReportedValue: 500,
        currentReportedShares: null,
        increasedReportedPositionCount: 1,
      }),
    ]);
  });

  it("supports requested-quarter loading through each reusable service boundary", async () => {
    const source = {
      ...baseInput(),
      dataAsOf: QUARTER.periodEndDate,
      currentFilingManagerIds: ["M1", "M2", "M3", "M4"],
    };
    const calls: unknown[] = [];
    const repository: CrossFundInstitutionalRepository = {
      async getCrossFundInstitutionalSource(query) {
        calls.push(query);
        return source;
      },
    };
    const result = await getSectorRotation(
      { quarter: "2026-Q2" },
      repository,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ quarter: "2026-Q2" });
    expect(result?.quarter).toEqual(QUARTER);
  });
});