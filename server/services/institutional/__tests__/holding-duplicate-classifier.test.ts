import { describe, expect, it } from "vitest";
import {
  CANONICAL_SOURCE_HOLDING_IDENTITY,
  CURRENT_HOLDING_DUPLICATE_KEY,
  classifyStoredDuplicateGroup,
  type StoredHoldingMaterial,
} from "../holding-duplicate-classifier";
import { computeQuarterlyAggregate, type EligibleHolding } from "../aggregation-engine";

function stored(overrides: Partial<StoredHoldingMaterial> = {}): StoredHoldingMaterial {
  return {
    accessionNumber: "0001000000-26-000001",
    cusip: "037833100",
    classTitle: "COM",
    putCall: null,
    issuerName: "APPLE INC",
    figi: null,
    reportedValue: 1000,
    reportedShares: 100,
    sharesPrnType: "SH",
    investmentDiscretion: "SOLE",
    otherManager: null,
    votingSole: 100,
    votingShared: 0,
    votingNone: 0,
    filerCik: "1000000",
    periodOfReport: "2026-03-31",
    filingDate: "2026-05-15",
    ...overrides,
  };
}

function eligible(overrides: Partial<EligibleHolding> = {}): EligibleHolding {
  return {
    filerCik: "1000000",
    filerName: "MANAGER",
    reportedShares: 100,
    reportedValue: 1000,
    putCall: null,
    sharesPrnType: "SH",
    mappingStatus: "reviewed",
    periodOfReport: "2026-03-31",
    filingDate: "2026-05-15",
    accessionNumber: "0001000000-26-000001",
    ...overrides,
  };
}

describe("institutional holding duplicate identity", () => {
  it("documents the coarse stored key and the missing SEC source-row key", () => {
    expect(CURRENT_HOLDING_DUPLICATE_KEY).toEqual([
      "accessionNumber",
      "cusip",
      "classTitle",
      "putCall",
    ]);
    expect(CANONICAL_SOURCE_HOLDING_IDENTITY).toEqual([
      "accessionNumber",
      "infoTableSk",
    ]);
  });

  it("distinguishes exact material repeats from legitimate discretion and voting splits", () => {
    expect(classifyStoredDuplicateGroup([stored(), stored()])).toBe(
      "IDENTICAL_STORED_MATERIAL_SOURCE_IDENTITY_UNRESOLVED",
    );
    expect(classifyStoredDuplicateGroup([
      stored(),
      stored({ investmentDiscretion: "SHARED" }),
    ])).toBe("MATERIALLY_DISTINCT_INVESTMENT_DISCRETION");
    expect(classifyStoredDuplicateGroup([
      stored(),
      stored({ votingSole: 0, votingShared: 100 }),
    ])).toBe("MATERIALLY_DISTINCT_VOTING_AUTHORITY");
  });

  it("does not classify common stock and PUT/CALL lines as one duplicate group", () => {
    expect(classifyStoredDuplicateGroup([stored(), stored({ putCall: "Put" })])).toBeNull();
    expect(classifyStoredDuplicateGroup([stored(), stored({ putCall: "Call" })])).toBeNull();
  });

  it("distinguishes share and principal lines and multi-dimension differences", () => {
    expect(classifyStoredDuplicateGroup([
      stored(),
      stored({ sharesPrnType: "PRN" }),
    ])).toBe("MATERIALLY_DISTINCT_SHARE_PRN_TYPE");
    expect(classifyStoredDuplicateGroup([
      stored(),
      stored({ investmentDiscretion: "SHARED", otherManager: "02" }),
    ])).toBe("MULTIPLE_MATERIAL_DIFFERENCES");
  });

  it("shows aggregate behavior: PUT/CALL and PRN are excluded but repeated common rows sum", () => {
    const result = computeQuarterlyAggregate({
      symbol: "AAPL",
      periodOfReport: "2026-03-31",
      currentHoldings: [
        eligible(),
        eligible(),
        eligible({ putCall: "Put", reportedShares: 500 }),
        eligible({ putCall: "Call", reportedShares: 600 }),
        eligible({ sharesPrnType: "PRN", reportedShares: 700 }),
      ],
      previousHoldings: [],
      prevPeriodOfReport: null,
      hasAmendments: false,
      hasPendingAmendments: false,
    });
    expect(result.aggregateReportedShares).toBe(200);
    expect(result.reportingManagerCount).toBe(1);
    expect(result.excludedHoldingCount).toBe(3);
  });
});