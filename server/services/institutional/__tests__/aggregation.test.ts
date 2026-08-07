// Tests D + E + F: Aggregation, trend, and evidence alignment — Sprint 2.2.5.

import { describe, it, expect } from "vitest";
import {
  computeQuarterlyAggregate,
  isEligibleForAggregate,
  classifyConcentration,
  classifyCoverage,
  derivePeriodLabel,
  type EligibleHolding,
  type AggregationInput,
} from "../aggregation-engine";
import { classifyTrend } from "../trend-classifier";
import { computeEvidenceAlignment } from "../evidence-alignment";
import type { AggregationResult } from "../aggregation-engine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHolding(overrides: Partial<EligibleHolding> = {}): EligibleHolding {
  return {
    filerCik: "0001364742",
    filerName: "BLACKROCK INC",
    reportedShares: 1_000_000,
    reportedValue: 5_000_000,
    putCall: null,
    sharesPrnType: "SH",
    mappingStatus: "exact",
    periodOfReport: "2024-03-31",
    filingDate: "2024-05-14",
    accessionNumber: "000136474224000001",
    ...overrides,
  };
}

function makeInput(overrides: Partial<AggregationInput> = {}): AggregationInput {
  return {
    symbol: "AAPL",
    periodOfReport: "2024-03-31",
    currentHoldings: [],
    previousHoldings: [],
    prevPeriodOfReport: "2023-12-31",
    hasAmendments: false,
    hasPendingAmendments: false,
    ...overrides,
  };
}

function makeAggregate(overrides: Partial<AggregationResult> = {}): AggregationResult {
  return {
    symbol: "AAPL",
    periodOfReport: "2024-03-31",
    periodLabel: "2024-Q1",
    reportingManagerCount: 5,
    aggregateReportedShares: 10_000_000,
    aggregateReportedValue: 50_000_000,
    prevPeriodOfReport: "2023-12-31",
    previousQuarterShares: 9_000_000,
    previousQuarterValue: 45_000_000,
    reportedSharesChange: 1_000_000,
    reportedSharesChangePercent: 0.111,
    newPositionCount: 2,
    increasedPositionCount: 3,
    reducedPositionCount: 1,
    exitedPositionCount: 0,
    unchangedCount: 0,
    topHolderPercent: 0.30,
    top5HolderPercent: 0.65,
    top10HolderPercent: 0.85,
    concentrationClassification: "high",
    largestHolders: [],
    eligibleHoldingCount: 5,
    excludedHoldingCount: 2,
    coverageStatus: "complete",
    amendmentStatus: "clean",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section D — Aggregation tests
// ---------------------------------------------------------------------------

describe("D — Quarterly aggregation", () => {
  it("D1 — manager count from eligible common-stock holders", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000 }),
        makeHolding({ filerCik: "CIK2", reportedShares: 2_000_000 }),
        makeHolding({ filerCik: "CIK3", reportedShares: 500_000 }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.reportingManagerCount).toBe(3);
  });

  it("D2 — aggregate shares is sum of eligible SH holdings", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000 }),
        makeHolding({ filerCik: "CIK2", reportedShares: 2_000_000 }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.aggregateReportedShares).toBe(3_000_000);
  });

  it("D3 — put/call rows excluded from aggregate shares", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, putCall: null }),
        makeHolding({ filerCik: "CIK2", reportedShares: 500_000, putCall: "Put" }),    // excluded
        makeHolding({ filerCik: "CIK3", reportedShares: 250_000, putCall: "Call" }),  // excluded
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    // Only CIK1 eligible; CIK2 and CIK3 excluded
    expect(agg.reportingManagerCount).toBe(1);
    expect(agg.aggregateReportedShares).toBe(1_000_000);
  });

  it("D4 — PRN rows excluded from aggregate", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, sharesPrnType: "SH" }),
        makeHolding({ filerCik: "CIK2", reportedShares: 2_000_000, sharesPrnType: "PRN" }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.reportingManagerCount).toBe(1);
    expect(agg.aggregateReportedShares).toBe(1_000_000);
  });

  it("D5 — unmapped holdings excluded in production mode", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", mappingStatus: "exact" }),
        makeHolding({ filerCik: "CIK2", mappingStatus: "unmapped" }),
        makeHolding({ filerCik: "CIK3", mappingStatus: "probable" }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    // Only exact is eligible in production mode
    expect(agg.reportingManagerCount).toBe(1);
  });

  it("D6 — QoQ share change computed correctly", () => {
    const input = makeInput({
      currentHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_100_000 })],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, periodOfReport: "2023-12-31" })],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.reportedSharesChange).toBe(100_000);
    expect(agg.reportedSharesChangePercent).toBeCloseTo(0.1, 3);
  });

  it("D7 — new position: filer in current, not in previous", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 500_000 }),  // new
        makeHolding({ filerCik: "CIK2", reportedShares: 1_000_000 }),  // increased
      ],
      previousHoldings: [
        makeHolding({ filerCik: "CIK2", reportedShares: 800_000, periodOfReport: "2023-12-31" }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.newPositionCount).toBe(1);
    expect(agg.increasedPositionCount).toBe(1);
  });

  it("D8 — increased position: filer shares increased quarter over quarter", () => {
    const input = makeInput({
      currentHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 2_000_000 })],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, periodOfReport: "2023-12-31" })],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.increasedPositionCount).toBe(1);
    expect(agg.newPositionCount).toBe(0);
  });

  it("D9 — reduced position", () => {
    const input = makeInput({
      currentHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 500_000 })],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, periodOfReport: "2023-12-31" })],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.reducedPositionCount).toBe(1);
  });

  it("D10 — exit: filer in previous, not in current", () => {
    const input = makeInput({
      currentHoldings: [],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, periodOfReport: "2023-12-31" })],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.exitedPositionCount).toBe(1);
  });

  it("D11 — exit not counted when no prior quarter", () => {
    const input = makeInput({
      currentHoldings: [],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000, periodOfReport: "2023-12-31" })],
      prevPeriodOfReport: null,  // no prior quarter reference
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.exitedPositionCount).toBe(0);
  });

  it("D12 — zero denominator for percent change when previous is zero", () => {
    const input = makeInput({
      currentHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 1_000_000 })],
      previousHoldings: [makeHolding({ filerCik: "CIK1", reportedShares: 0, periodOfReport: "2023-12-31" })],
    });
    // Previous manager with 0 shares is excluded (not eligible)
    const agg = computeQuarterlyAggregate(input);
    // 0 shares in previous → not included in byFiler map → QoQ not computable
    expect(agg.reportedSharesChangePercent).toBeNull();
  });

  it("D13 — missing prior quarter → null previous shares", () => {
    const input = makeInput({
      currentHoldings: [makeHolding({ filerCik: "CIK1" })],
      previousHoldings: [],
      prevPeriodOfReport: null,
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.previousQuarterShares).toBeNull();
    expect(agg.reportedSharesChange).toBeNull();
    expect(agg.reportedSharesChangePercent).toBeNull();
  });

  it("D14 — top holder concentration computed correctly", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", reportedShares: 6_000_000 }),
        makeHolding({ filerCik: "CIK2", reportedShares: 3_000_000 }),
        makeHolding({ filerCik: "CIK3", reportedShares: 1_000_000 }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    // Total = 10M; top holder CIK1 = 6M → 60%
    expect(agg.topHolderPercent).toBeCloseTo(0.6, 3);
    // Top 2 = 9M → 90%
    // Top 5 = all 10M → 100%
    expect(agg.top5HolderPercent).toBeCloseTo(1.0, 3);
    expect(agg.top10HolderPercent).toBeCloseTo(1.0, 3);
  });

  it("D15 — concentration null when no eligible holdings", () => {
    const input = makeInput({ currentHoldings: [] });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.topHolderPercent).toBeNull();
    expect(agg.top5HolderPercent).toBeNull();
    expect(agg.top10HolderPercent).toBeNull();
  });

  it("D16 — eligibleHoldingCount counts only production-eligible rows", () => {
    const input = makeInput({
      currentHoldings: [
        makeHolding({ filerCik: "CIK1", mappingStatus: "exact" }),
        makeHolding({ filerCik: "CIK2", mappingStatus: "reviewed" }),
        makeHolding({ filerCik: "CIK3", mappingStatus: "unmapped" }),
        makeHolding({ filerCik: "CIK4", putCall: "Put" }),
      ],
    });
    const agg = computeQuarterlyAggregate(input);
    expect(agg.eligibleHoldingCount).toBe(2); // only exact + reviewed
  });
});

// ---------------------------------------------------------------------------
// Section D — Helper tests
// ---------------------------------------------------------------------------

describe("D — Helper functions", () => {
  it("D17 — isEligibleForAggregate: put/call excluded", () => {
    expect(isEligibleForAggregate(makeHolding({ putCall: "Put" }))).toBe(false);
    expect(isEligibleForAggregate(makeHolding({ putCall: "Call" }))).toBe(false);
  });

  it("D18 — isEligibleForAggregate: PRN excluded", () => {
    expect(isEligibleForAggregate(makeHolding({ sharesPrnType: "PRN" }))).toBe(false);
  });

  it("D19 — isEligibleForAggregate: zero shares excluded", () => {
    expect(isEligibleForAggregate(makeHolding({ reportedShares: 0 }))).toBe(false);
  });

  it("D20 — isEligibleForAggregate: unmapped excluded in production mode", () => {
    expect(isEligibleForAggregate(makeHolding({ mappingStatus: "unmapped" }), true)).toBe(false);
    expect(isEligibleForAggregate(makeHolding({ mappingStatus: "probable" }), true)).toBe(false);
  });

  it("D21 — isEligibleForAggregate: exact and reviewed included", () => {
    expect(isEligibleForAggregate(makeHolding({ mappingStatus: "exact" }))).toBe(true);
    expect(isEligibleForAggregate(makeHolding({ mappingStatus: "reviewed" }))).toBe(true);
  });

  it("D22 — classifyConcentration: low < 40%", () => {
    expect(classifyConcentration(0.39)).toBe("low");
  });

  it("D23 — classifyConcentration: moderate 40-70%", () => {
    expect(classifyConcentration(0.50)).toBe("moderate");
  });

  it("D24 — classifyConcentration: high > 70%", () => {
    expect(classifyConcentration(0.71)).toBe("high");
  });

  it("D25 — classifyConcentration: null → unavailable", () => {
    expect(classifyConcentration(null)).toBe("unavailable");
  });

  it("D26 — derivePeriodLabel: Q1 ends March", () => {
    expect(derivePeriodLabel("2024-03-31")).toBe("2024-Q1");
  });

  it("D27 — derivePeriodLabel: Q2 ends June", () => {
    expect(derivePeriodLabel("2024-06-30")).toBe("2024-Q2");
  });

  it("D28 — derivePeriodLabel: Q4 ends December", () => {
    expect(derivePeriodLabel("2023-12-31")).toBe("2023-Q4");
  });

  it("D29 — classifyCoverage: complete when ≥50% eligible", () => {
    expect(classifyCoverage(5, 8)).toBe("complete");
  });

  it("D30 — classifyCoverage: partial when eligible > 0 but < 50%", () => {
    expect(classifyCoverage(2, 10)).toBe("partial");
  });

  it("D31 — classifyCoverage: insufficient when no eligible", () => {
    expect(classifyCoverage(0, 5)).toBe("insufficient");
  });
});

// ---------------------------------------------------------------------------
// Section E — Trend classification
// ---------------------------------------------------------------------------

describe("E — Trend classification", () => {
  it("E1 — increasing: aggregate shares up and more increasers than reducers", () => {
    const current = makeAggregate({
      reportedSharesChangePercent: 0.05,   // +5%
      newPositionCount: 3,
      increasedPositionCount: 5,
      reducedPositionCount: 1,
      exitedPositionCount: 0,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate({ periodOfReport: "2023-12-31" }));
    expect(result.trend).toBe("increasing");
  });

  it("E2 — stable: small shares change", () => {
    const current = makeAggregate({
      reportedSharesChangePercent: 0.005,  // +0.5%, within stable threshold
      newPositionCount: 1,
      increasedPositionCount: 1,
      reducedPositionCount: 1,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate({ periodOfReport: "2023-12-31" }));
    expect(result.trend).toBe("stable");
  });

  it("E3 — decreasing: shares down and more reducers than increasers", () => {
    const current = makeAggregate({
      reportedSharesChangePercent: -0.05,  // -5%
      newPositionCount: 0,
      increasedPositionCount: 1,
      reducedPositionCount: 6,
      exitedPositionCount: 2,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate({ periodOfReport: "2023-12-31" }));
    expect(result.trend).toBe("decreasing");
  });

  it("E4 — mixed: shares up but more reducers than increasers", () => {
    const current = makeAggregate({
      reportedSharesChangePercent: 0.05,   // +5%
      newPositionCount: 0,
      increasedPositionCount: 1,
      reducedPositionCount: 8,
      exitedPositionCount: 2,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate({ periodOfReport: "2023-12-31" }));
    expect(result.trend).toBe("mixed");
  });

  it("E5 — insufficient_history when no prior quarter", () => {
    const current = makeAggregate({ prevPeriodOfReport: null });
    const result = classifyTrend(current, null);
    expect(result.trend).toBe("insufficient_history");
  });

  it("E6 — unavailable when coverage insufficient", () => {
    const current = makeAggregate({
      coverageStatus: "insufficient",
      reportingManagerCount: 0,
    });
    const result = classifyTrend(current, makeAggregate());
    expect(result.trend).toBe("unavailable");
  });

  it("E7 — reasons array is non-empty for all non-unavailable states", () => {
    const current = makeAggregate({
      reportedSharesChangePercent: 0.05,
      newPositionCount: 3,
      increasedPositionCount: 4,
      reducedPositionCount: 1,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate());
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("E8 — partial coverage sets confidence to moderate", () => {
    const current = makeAggregate({
      coverageStatus: "partial",
      reportedSharesChangePercent: 0.05,
      newPositionCount: 3,
      increasedPositionCount: 3,
      reducedPositionCount: 0,
      prevPeriodOfReport: "2023-12-31",
    });
    const result = classifyTrend(current, makeAggregate());
    expect(result.confidenceLevel).toBe("moderate");
  });
});

// ---------------------------------------------------------------------------
// Section F — Evidence alignment + percentage safeguards
// ---------------------------------------------------------------------------

describe("F — Evidence alignment", () => {
  it("F1 — supports: shares increased, bulls dominant", () => {
    const agg = makeAggregate({
      reportedSharesChange: 1_000_000,
      reportedSharesChangePercent: 0.10,
      newPositionCount: 3,
      increasedPositionCount: 5,
      reducedPositionCount: 1,
      exitedPositionCount: 0,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = computeEvidenceAlignment(agg, "increasing");
    expect(result.state).toBe("supports");
  });

  it("F2 — weakens: shares decreased, bears dominant", () => {
    const agg = makeAggregate({
      reportedSharesChange: -1_000_000,
      reportedSharesChangePercent: -0.10,
      newPositionCount: 0,
      increasedPositionCount: 1,
      reducedPositionCount: 6,
      exitedPositionCount: 3,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = computeEvidenceAlignment(agg, "decreasing");
    expect(result.state).toBe("weakens");
  });

  it("F3 — neutral: mixed activity, moderate change", () => {
    const agg = makeAggregate({
      reportedSharesChange: 100_000,
      reportedSharesChangePercent: 0.01,
      newPositionCount: 2,
      increasedPositionCount: 2,
      reducedPositionCount: 2,
      exitedPositionCount: 1,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = computeEvidenceAlignment(agg, "stable");
    expect(result.state).toBe("neutral");
  });

  it("F4 — unavailable when aggregate is null", () => {
    const result = computeEvidenceAlignment(null, "unavailable");
    expect(result.state).toBe("unavailable");
  });

  it("F5 — unavailable when coverage insufficient", () => {
    const agg = makeAggregate({ coverageStatus: "insufficient", reportingManagerCount: 0 });
    const result = computeEvidenceAlignment(agg, "unavailable");
    expect(result.state).toBe("unavailable");
  });

  it("F6 — unavailable when only one quarter (no prior)", () => {
    const agg = makeAggregate({ prevPeriodOfReport: null });
    const result = computeEvidenceAlignment(agg, "insufficient_history");
    expect(result.state).toBe("unavailable");
  });

  it("F7 — unavailable when pending amendments", () => {
    const agg = makeAggregate({ amendmentStatus: "pending_amendments" });
    const result = computeEvidenceAlignment(agg, "stable");
    expect(result.state).toBe("unavailable");
  });

  it("F8 — reasons array contains meaningful text for all states", () => {
    const agg = makeAggregate({
      reportedSharesChange: 1_000_000,
      reportedSharesChangePercent: 0.10,
      newPositionCount: 4,
      increasedPositionCount: 4,
      reducedPositionCount: 0,
      exitedPositionCount: 0,
      coverageStatus: "complete",
      prevPeriodOfReport: "2023-12-31",
    });
    const result = computeEvidenceAlignment(agg, "increasing");
    expect(result.reasons.every((r) => r.length > 10)).toBe(true);
  });
});
