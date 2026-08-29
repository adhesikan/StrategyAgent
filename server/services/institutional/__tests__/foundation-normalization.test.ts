import { describe, expect, it } from "vitest";
import {
  normalizeQuarter,
  parseQuarterIdentifier,
  periodEndDateToQuarter,
  quarterToPeriodEndDate,
} from "../quarter-utils";
import {
  classifySecurityPositionType,
  isCommonEquityPosition,
} from "../security-position";
import {
  computeQuarterlyAggregate,
  type AggregationInput,
  type EligibleHolding,
} from "../aggregation-engine";

function holding(
  filerCik: string,
  reportedValue: number,
): EligibleHolding {
  return {
    filerCik,
    filerName: `Manager ${filerCik}`,
    reportedShares: 100,
    reportedValue,
    putCall: null,
    sharesPrnType: "SH",
    mappingStatus: "exact",
    periodOfReport: "2026-03-31",
    filingDate: "2026-05-01",
    accessionNumber: `accession-${filerCik}`,
  };
}

describe("institutional reported-value unit contract", () => {
  it("keeps representative portfolio totals in canonical dollars", () => {
    const input: AggregationInput = {
      symbol: "AAPL",
      periodOfReport: "2026-03-31",
      currentHoldings: [
        holding("1", 1_250_000),
        holding("2", 750_000),
      ],
      previousHoldings: [],
      prevPeriodOfReport: null,
      hasAmendments: false,
      hasPendingAmendments: false,
    };

    const result = computeQuarterlyAggregate(input);
    expect(result.aggregateReportedValue).toBe(2_000_000);
    expect(result.aggregateReportedValue).not.toBe(2_000_000_000);
    expect(result.largestHolders.map((row) => row.reportedValue)).toEqual([
      1_250_000,
      750_000,
    ]);
  });
});

describe("institutional quarter normalization", () => {
  it.each([
    ["2026-Q1", "2026-03-31"],
    ["2026-Q2", "2026-06-30"],
    ["2026-Q3", "2026-09-30"],
    ["2026-Q4", "2026-12-31"],
  ])("parses %s", (identifier, periodEndDate) => {
    expect(parseQuarterIdentifier(identifier)).toEqual({
      kind: "quarter",
      identifier,
      year: 2026,
      quarter: Number(identifier.at(-1)),
      periodEndDate,
    });
  });

  it("normalizes latest case-insensitively", () => {
    expect(parseQuarterIdentifier(" LATEST ")).toEqual({
      kind: "latest",
      identifier: "latest",
      periodEndDate: null,
    });
    expect(normalizeQuarter("LATEST")).toBe("latest");
    expect(quarterToPeriodEndDate("latest")).toBeNull();
  });

  it("converts quarter labels to period-end dates", () => {
    expect(quarterToPeriodEndDate("2026-Q2")).toBe("2026-06-30");
  });

  it("keeps legacy database dates backward compatible", () => {
    expect(normalizeQuarter("2026-09-30")).toBe("2026-Q3");
    expect(quarterToPeriodEndDate("2026-09-30")).toBe("2026-09-30");
    expect(periodEndDateToQuarter("2026-09-30")).toBe("2026-Q3");
  });

  it.each([
    "",
    "2026-Q0",
    "2026-Q5",
    "2026Q1",
    "26-Q1",
    "2026-02-28",
    "not-a-quarter",
  ])("rejects invalid quarter value %j", (value) => {
    expect(parseQuarterIdentifier(value)).toBeNull();
    expect(normalizeQuarter(value)).toBeNull();
  });
});

describe("institutional security-position classification", () => {
  it("classifies common equity", () => {
    expect(classifySecurityPositionType(null)).toBe("COMMON_EQUITY");
    expect(classifySecurityPositionType("")).toBe("COMMON_EQUITY");
    expect(isCommonEquityPosition(null)).toBe(true);
  });

  it("classifies puts without merging them into common equity", () => {
    expect(classifySecurityPositionType("Put")).toBe("PUT");
    expect(classifySecurityPositionType("P")).toBe("PUT");
    expect(isCommonEquityPosition("Put")).toBe(false);
  });

  it("classifies calls without merging them into common equity", () => {
    expect(classifySecurityPositionType("Call")).toBe("CALL");
    expect(classifySecurityPositionType("C")).toBe("CALL");
    expect(isCommonEquityPosition("Call")).toBe(false);
  });

  it("fails closed for unsupported non-empty put_call values", () => {
    expect(() => classifySecurityPositionType("unknown")).toThrow(RangeError);
  });
});