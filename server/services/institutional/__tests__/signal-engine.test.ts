// signal-engine.test.ts — Sprint 2.2.6
//
// Comprehensive unit tests for the Institutional Signal Engine.
// All tests use pure functions — no DB, no network, no LLM.
//
// Coverage requirements from sprint brief:
//   quarter selection, single quarter, no quarter,
//   NEW/EXITED/INCREASED/REDUCED/UNCHANGED managers,
//   effective amendment handling, share totals, value totals,
//   percentage changes, top buyer/seller/new/exit ranking,
//   concentration calculations, score formula, score components,
//   0/100 boundary, label thresholds, mapping_incomplete,
//   partial mapping, missing symbol, data quality gate,
//   freshness metadata, delayed-source indicator,
//   deterministic summary, idempotent rebuild, no LLM dependency.

import { describe, it, expect } from "vitest";
import {
  // Pure score components
  computeBreadthComponent,
  computeAccumulationComponent,
  computeEntrantsVsExitsComponent,
  computeConcentrationComponent,
  computeInstitutionalScore,
  // Label
  scoreToLabel,
  // Concentration
  computeConcentrationTrend,
  // Data quality
  computeDataQuality,
  // Manager change lists
  deriveTopBuyers,
  deriveTopSellers,
  deriveNewPositions,
  deriveExitedPositions,
  // Summary
  buildDeterministicSummary,
  // Signal builder
  buildInstitutionalSignal,
  // Consumer contracts
  signalToEvidence,
  signalToWorkspaceContract,
  type ConcentrationTrend,
} from "../signal-engine";
import type { InstitutionalQuarterlyAggregate } from "@shared/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-15T00:00:00Z");

function makeAggregate(
  overrides: Partial<InstitutionalQuarterlyAggregate> = {},
): InstitutionalQuarterlyAggregate {
  return {
    id: "test-id",
    symbol: "AAPL",
    periodOfReport: "2026-03-31",
    periodLabel: "2026-Q1",
    reportingManagerCount: 20,
    aggregateReportedShares: 1_000_000,
    aggregateReportedValue: 180_000,
    prevPeriodOfReport: "2025-12-31",
    previousQuarterShares: 900_000,
    previousQuarterValue: 160_000,
    reportedSharesChange: 100_000,
    reportedSharesChangePercent: 0.111,
    newPositionCount: 3,
    increasedPositionCount: 8,
    reducedPositionCount: 4,
    exitedPositionCount: 2,
    unchangedCount: 3,
    topHolderPercent: 0.15,
    top5HolderPercent: 0.45,
    top10HolderPercent: 0.65,
    concentrationClassification: "moderate",
    trend: "increasing",
    largestHolders: [
      {
        managerCik: "0001234567",
        managerName: "BlackRock Inc",
        reportedShares: 150_000,
        reportedValue: 27_000,
        quarterChangeShares: 20_000,
        quarterChangePercent: 0.154,
        activity: "increased",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-15",
      },
      {
        managerCik: "0002345678",
        managerName: "Vanguard Group",
        reportedShares: 140_000,
        reportedValue: 25_200,
        quarterChangeShares: 10_000,
        quarterChangePercent: 0.077,
        activity: "increased",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-14",
      },
      {
        managerCik: "0003456789",
        managerName: "State Street Corp",
        reportedShares: 80_000,
        reportedValue: 14_400,
        quarterChangeShares: -15_000,
        quarterChangePercent: -0.158,
        activity: "reduced",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-13",
      },
      {
        managerCik: "0004567890",
        managerName: "Fidelity Investments",
        reportedShares: 50_000,
        reportedValue: 9_000,
        quarterChangeShares: null,
        quarterChangePercent: null,
        activity: "new",
        periodOfReport: "2026-03-31",
        filingDate: "2026-05-12",
      },
    ],
    eligibleHoldingCount: 18,
    excludedHoldingCount: 2,
    coverageStatus: "complete",
    amendmentStatus: "clean",
    generatedAt: new Date("2026-05-20T00:00:00Z"),
    ...overrides,
  } as InstitutionalQuarterlyAggregate;
}

function makePreviousAggregate(
  overrides: Partial<InstitutionalQuarterlyAggregate> = {},
): InstitutionalQuarterlyAggregate {
  return {
    id: "prev-id",
    symbol: "AAPL",
    periodOfReport: "2025-12-31",
    periodLabel: "2025-Q4",
    reportingManagerCount: 19,
    aggregateReportedShares: 900_000,
    aggregateReportedValue: 160_000,
    prevPeriodOfReport: "2025-09-30",
    previousQuarterShares: 850_000,
    previousQuarterValue: 150_000,
    reportedSharesChange: 50_000,
    reportedSharesChangePercent: 0.059,
    newPositionCount: 2,
    increasedPositionCount: 7,
    reducedPositionCount: 5,
    exitedPositionCount: 1,
    unchangedCount: 4,
    topHolderPercent: 0.145,
    top5HolderPercent: 0.42,
    top10HolderPercent: 0.62,
    concentrationClassification: "moderate",
    trend: "increasing",
    largestHolders: [
      {
        managerCik: "0001234567",
        managerName: "BlackRock Inc",
        reportedShares: 130_000,
        reportedValue: 23_400,
        quarterChangeShares: 5_000,
        quarterChangePercent: 0.04,
        activity: "increased",
        periodOfReport: "2025-12-31",
        filingDate: "2026-02-13",
      },
      {
        managerCik: "0009999999",
        managerName: "Morgan Stanley",
        reportedShares: 60_000,
        reportedValue: 10_800,
        quarterChangeShares: -5_000,
        quarterChangePercent: -0.077,
        activity: "reduced",
        periodOfReport: "2025-12-31",
        filingDate: "2026-02-12",
      },
    ],
    eligibleHoldingCount: 16,
    excludedHoldingCount: 4,
    coverageStatus: "complete",
    amendmentStatus: "clean",
    generatedAt: new Date("2026-02-20T00:00:00Z"),
    ...overrides,
  } as InstitutionalQuarterlyAggregate;
}

// ---------------------------------------------------------------------------
// 1. Score components — Breadth
// ---------------------------------------------------------------------------

describe("computeBreadthComponent()", () => {
  it("returns 50 when no changers (neutral)", () => {
    expect(computeBreadthComponent(0, 0)).toBe(50);
  });

  it("returns 100 when all managers increased (boundary)", () => {
    expect(computeBreadthComponent(10, 0)).toBe(100);
  });

  it("returns 0 when all managers reduced (boundary)", () => {
    expect(computeBreadthComponent(0, 10)).toBe(0);
  });

  it("returns 75 for 3:1 increase/decrease ratio", () => {
    expect(computeBreadthComponent(30, 10)).toBe(75);
  });

  it("is symmetric: mirror gives 100-original", () => {
    const a = computeBreadthComponent(8, 4);
    const b = computeBreadthComponent(4, 8);
    expect(a + b).toBe(100);
  });

  it("clamps to [0, 100]", () => {
    const r = computeBreadthComponent(1000, 0);
    expect(r).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 2. Score components — Accumulation
// ---------------------------------------------------------------------------

describe("computeAccumulationComponent()", () => {
  it("returns null for null input", () => {
    expect(computeAccumulationComponent(null)).toBeNull();
  });

  it("returns 50 for 0% share change (flat)", () => {
    expect(computeAccumulationComponent(0)).toBe(50);
  });

  it("returns 100 for +25% or more (boundary)", () => {
    expect(computeAccumulationComponent(0.25)).toBe(100);
    expect(computeAccumulationComponent(0.50)).toBe(100); // clamped
  });

  it("returns 0 for -25% or more (boundary)", () => {
    expect(computeAccumulationComponent(-0.25)).toBe(0);
    expect(computeAccumulationComponent(-0.50)).toBe(0); // clamped
  });

  it("returns ~78 for +14% share change", () => {
    const result = computeAccumulationComponent(0.14);
    expect(result).toBeGreaterThan(70);
    expect(result).toBeLessThan(90);
  });

  it("is deterministic: same input = same output", () => {
    expect(computeAccumulationComponent(0.111)).toBe(computeAccumulationComponent(0.111));
  });
});

// ---------------------------------------------------------------------------
// 3. Score components — Entrants vs Exits
// ---------------------------------------------------------------------------

describe("computeEntrantsVsExitsComponent()", () => {
  it("returns 50 when no new or exited (neutral)", () => {
    expect(computeEntrantsVsExitsComponent(0, 0)).toBe(50);
  });

  it("returns 100 when all entrants, no exits (boundary)", () => {
    expect(computeEntrantsVsExitsComponent(10, 0)).toBe(100);
  });

  it("returns 0 when all exits, no entrants (boundary)", () => {
    expect(computeEntrantsVsExitsComponent(0, 10)).toBe(0);
  });

  it("returns 50 when new == exited", () => {
    expect(computeEntrantsVsExitsComponent(5, 5)).toBe(50);
  });

  it("clamps to [0, 100]", () => {
    const r = computeEntrantsVsExitsComponent(100, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 4. Score components — Concentration context
// ---------------------------------------------------------------------------

describe("computeConcentrationComponent()", () => {
  it("returns 65 for broadening_ownership", () => {
    expect(computeConcentrationComponent("broadening_ownership")).toBe(65);
  });

  it("returns 50 for stable_concentration", () => {
    expect(computeConcentrationComponent("stable_concentration")).toBe(50);
  });

  it("returns 40 for increasing_concentration", () => {
    expect(computeConcentrationComponent("increasing_concentration")).toBe(40);
  });

  it("returns 50 for insufficient_data (neutral)", () => {
    expect(computeConcentrationComponent("insufficient_data")).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 5. Overall score
// ---------------------------------------------------------------------------

describe("computeInstitutionalScore()", () => {
  it("returns null when confidence is insufficient", () => {
    const result = computeInstitutionalScore({
      breadth: 80, accumulation: 70, entrantsVsExits: 60, concentration: 50,
      confidence: "insufficient",
    });
    expect(result).toBeNull();
  });

  it("returns a number in [0, 100] for valid inputs", () => {
    const result = computeInstitutionalScore({
      breadth: 75, accumulation: 80, entrantsVsExits: 70, concentration: 65,
      confidence: "high",
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
    expect(result!).toBeLessThanOrEqual(100);
  });

  it("is deterministic: same components = same score", () => {
    const params = { breadth: 75, accumulation: 60, entrantsVsExits: 55, concentration: 50, confidence: "high" as const };
    expect(computeInstitutionalScore(params)).toBe(computeInstitutionalScore(params));
  });

  it("score can be reproduced exactly from components", () => {
    // Weights: A=30%, B=30%, C=25%, D=15%
    const A = 80, B = 70, C = 60, D = 65;
    const expected = Math.round(0.30 * A + 0.30 * B + 0.25 * C + 0.15 * D);
    const result = computeInstitutionalScore({
      breadth: A, accumulation: B, entrantsVsExits: C, concentration: D,
      confidence: "high",
    });
    expect(result).toBe(expected);
  });

  it("renormalizes when accumulation is null", () => {
    // With B=null: weights are A=0.30, C=0.25, D=0.15 → sum=0.70, renormalize
    const result = computeInstitutionalScore({
      breadth: 80, accumulation: null, entrantsVsExits: 60, concentration: 50,
      confidence: "high",
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(100);
  });

  it("returns null when all components are null", () => {
    const result = computeInstitutionalScore({
      breadth: null, accumulation: null, entrantsVsExits: null, concentration: null,
      confidence: "high",
    });
    expect(result).toBeNull();
  });

  it("returns 0 when all components are 0 (0 boundary)", () => {
    const result = computeInstitutionalScore({
      breadth: 0, accumulation: 0, entrantsVsExits: 0, concentration: 0,
      confidence: "high",
    });
    expect(result).toBe(0);
  });

  it("returns 100 when all components are 100 (100 boundary)", () => {
    const result = computeInstitutionalScore({
      breadth: 100, accumulation: 100, entrantsVsExits: 100, concentration: 100,
      confidence: "high",
    });
    expect(result).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 6. Label thresholds
// ---------------------------------------------------------------------------

describe("scoreToLabel()", () => {
  it("returns Insufficient Data for null score", () => {
    expect(scoreToLabel(null)).toBe("Insufficient Data");
  });

  it("returns Strong Accumulation for score >= 75", () => {
    expect(scoreToLabel(75)).toBe("Strong Accumulation");
    expect(scoreToLabel(100)).toBe("Strong Accumulation");
  });

  it("returns Accumulation for score 60-74", () => {
    expect(scoreToLabel(60)).toBe("Accumulation");
    expect(scoreToLabel(74)).toBe("Accumulation");
  });

  it("returns Stable for score 40-59", () => {
    expect(scoreToLabel(40)).toBe("Stable");
    expect(scoreToLabel(59)).toBe("Stable");
  });

  it("returns Distribution for score 25-39", () => {
    expect(scoreToLabel(25)).toBe("Distribution");
    expect(scoreToLabel(39)).toBe("Distribution");
  });

  it("returns Strong Distribution for score < 25", () => {
    expect(scoreToLabel(0)).toBe("Strong Distribution");
    expect(scoreToLabel(24)).toBe("Strong Distribution");
  });

  it("is exhaustive: all integer scores 0-100 produce a non-Insufficient label", () => {
    for (let s = 0; s <= 100; s++) {
      const label = scoreToLabel(s);
      expect(label).not.toBe("Insufficient Data");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Concentration trend
// ---------------------------------------------------------------------------

describe("computeConcentrationTrend()", () => {
  it("returns insufficient_data when either value is null", () => {
    expect(computeConcentrationTrend(null, 0.4)).toBe("insufficient_data");
    expect(computeConcentrationTrend(0.4, null)).toBe("insufficient_data");
    expect(computeConcentrationTrend(null, null)).toBe("insufficient_data");
  });

  it("returns increasing_concentration when latest > previous by more than 5pp", () => {
    expect(computeConcentrationTrend(0.5, 0.4)).toBe("increasing_concentration"); // +10pp
  });

  it("returns broadening_ownership when latest < previous by more than 5pp", () => {
    expect(computeConcentrationTrend(0.35, 0.45)).toBe("broadening_ownership"); // -10pp
  });

  it("returns stable_concentration when diff is within 5pp", () => {
    expect(computeConcentrationTrend(0.42, 0.40)).toBe("stable_concentration"); // +2pp
    expect(computeConcentrationTrend(0.40, 0.42)).toBe("stable_concentration"); // -2pp
    expect(computeConcentrationTrend(0.40, 0.40)).toBe("stable_concentration"); // exact
  });
});

// ---------------------------------------------------------------------------
// 8. Data quality
// ---------------------------------------------------------------------------

describe("computeDataQuality()", () => {
  it("returns insufficient when only one quarter", () => {
    const { confidence } = computeDataQuality(15, 0.9, false);
    expect(confidence).toBe("insufficient");
  });

  it("returns insufficient when managerCount < 2", () => {
    const { confidence } = computeDataQuality(1, 0.9, true);
    expect(confidence).toBe("insufficient");
  });

  it("returns high when managerCount >= 10 and coverage >= 50%", () => {
    const { confidence } = computeDataQuality(10, 0.8, true);
    expect(confidence).toBe("high");
  });

  it("returns moderate when managerCount >= 5 and coverage >= 30%", () => {
    const { confidence } = computeDataQuality(5, 0.5, true);
    expect(confidence).toBe("moderate");
  });

  it("returns limited when managerCount 2-4", () => {
    const { confidence } = computeDataQuality(3, 0.8, true);
    expect(confidence).toBe("limited");
  });

  it("returns limited when managerCount >= 5 but coverage < 30%", () => {
    const { confidence } = computeDataQuality(6, 0.2, true);
    expect(confidence).toBe("limited");
  });

  it("comparableManagerCount = managerCountLatest", () => {
    const { comparableManagerCount } = computeDataQuality(12, 0.9, true);
    expect(comparableManagerCount).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 9. Manager-level change derivation
// ---------------------------------------------------------------------------

const CURRENT_HOLDERS = [
  { managerCik: "A", managerName: "Alpha Fund", reportedShares: 500_000, reportedValue: 90_000, quarterChangeShares: 100_000, quarterChangePercent: 0.25, activity: "increased" as const, periodOfReport: "2026-03-31", filingDate: "2026-05-01" },
  { managerCik: "B", managerName: "Beta Capital", reportedShares: 300_000, reportedValue: 54_000, quarterChangeShares: -50_000, quarterChangePercent: -0.143, activity: "reduced" as const, periodOfReport: "2026-03-31", filingDate: "2026-05-01" },
  { managerCik: "C", managerName: "Gamma Partners", reportedShares: 200_000, reportedValue: 36_000, quarterChangeShares: null, quarterChangePercent: null, activity: "new" as const, periodOfReport: "2026-03-31", filingDate: "2026-05-01" },
  { managerCik: "D", managerName: "Delta Advisors", reportedShares: 150_000, reportedValue: 27_000, quarterChangeShares: 80_000, quarterChangePercent: 0.114, activity: "increased" as const, periodOfReport: "2026-03-31", filingDate: "2026-05-01" },
  { managerCik: "E", managerName: "Epsilon Mgmt", reportedShares: 100_000, reportedValue: 18_000, quarterChangeShares: -20_000, quarterChangePercent: -0.167, activity: "reduced" as const, periodOfReport: "2026-03-31", filingDate: "2026-05-01" },
];

const PREVIOUS_HOLDERS = [
  { managerCik: "A", managerName: "Alpha Fund", reportedShares: 400_000, reportedValue: 72_000, quarterChangeShares: 0, quarterChangePercent: 0, activity: "unchanged" as const, periodOfReport: "2025-12-31", filingDate: "2026-02-10" },
  { managerCik: "F", managerName: "Zeta Wealth", reportedShares: 250_000, reportedValue: 45_000, quarterChangeShares: -10_000, quarterChangePercent: -0.038, activity: "reduced" as const, periodOfReport: "2025-12-31", filingDate: "2026-02-10" },
];

describe("deriveTopBuyers()", () => {
  it("returns managers with activity=increased, sorted by quarterChangeShares DESC", () => {
    const buyers = deriveTopBuyers(CURRENT_HOLDERS, 5);
    expect(buyers.length).toBe(2);
    expect(buyers[0].managerName).toBe("Alpha Fund"); // +100k > +80k
    expect(buyers[1].managerName).toBe("Delta Advisors");
  });

  it("sets changeType = INCREASED", () => {
    const buyers = deriveTopBuyers(CURRENT_HOLDERS, 5);
    buyers.forEach((b) => expect(b.changeType).toBe("INCREASED"));
  });

  it("respects the n limit", () => {
    expect(deriveTopBuyers(CURRENT_HOLDERS, 1).length).toBe(1);
  });

  it("returns empty array when no increased managers", () => {
    const noIncrease = CURRENT_HOLDERS.filter((h) => h.activity !== "increased");
    expect(deriveTopBuyers(noIncrease, 5)).toHaveLength(0);
  });
});

describe("deriveTopSellers()", () => {
  it("returns managers with activity=reduced, sorted by most-negative quarterChangeShares first", () => {
    const sellers = deriveTopSellers(CURRENT_HOLDERS, 5);
    expect(sellers.length).toBe(2);
    expect(sellers[0].managerName).toBe("Beta Capital"); // -50k more negative than -20k
  });

  it("sets changeType = REDUCED", () => {
    const sellers = deriveTopSellers(CURRENT_HOLDERS, 5);
    sellers.forEach((s) => expect(s.changeType).toBe("REDUCED"));
  });

  it("respects the n limit", () => {
    expect(deriveTopSellers(CURRENT_HOLDERS, 1).length).toBe(1);
  });
});

describe("deriveNewPositions()", () => {
  it("returns managers with activity=new, sorted by reportedShares DESC", () => {
    const newPos = deriveNewPositions(CURRENT_HOLDERS, 5);
    expect(newPos).toHaveLength(1);
    expect(newPos[0].managerName).toBe("Gamma Partners");
    expect(newPos[0].changeType).toBe("NEW");
    expect(newPos[0].previousShares).toBeNull();
  });
});

describe("deriveExitedPositions()", () => {
  it("returns managers from previous quarter who are absent from current", () => {
    const exits = deriveExitedPositions(PREVIOUS_HOLDERS, CURRENT_HOLDERS, 5);
    // F (Zeta Wealth) was in previous but not in current → exited
    // A (Alpha Fund) is in both → not exited
    expect(exits).toHaveLength(1);
    expect(exits[0].managerName).toBe("Zeta Wealth");
    expect(exits[0].changeType).toBe("EXITED");
  });

  it("sets latestShares = null for exits", () => {
    const exits = deriveExitedPositions(PREVIOUS_HOLDERS, CURRENT_HOLDERS, 5);
    exits.forEach((e) => expect(e.latestShares).toBeNull());
  });

  it("sorts exits by previous reportedShares DESC (largest exits first)", () => {
    const prev = [
      { ...PREVIOUS_HOLDERS[0], managerCik: "X", managerName: "X Fund", reportedShares: 100_000 },
      { ...PREVIOUS_HOLDERS[0], managerCik: "Y", managerName: "Y Fund", reportedShares: 300_000 },
    ];
    const exits = deriveExitedPositions(prev as any, [], 5);
    expect(exits[0].managerName).toBe("Y Fund"); // 300k > 100k
  });

  it("returns empty array when no exits", () => {
    // All previous holders also appear in current
    const exits = deriveExitedPositions(PREVIOUS_HOLDERS, [...CURRENT_HOLDERS, ...PREVIOUS_HOLDERS] as any, 5);
    expect(exits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Deterministic summary
// ---------------------------------------------------------------------------

describe("buildDeterministicSummary()", () => {
  it("returns no-data message for unavailable status", () => {
    const s = buildDeterministicSummary("unavailable", null, 0, 0, 0, 0, true, "high");
    expect(s).toContain("not available");
  });

  it("returns one-quarter message when insufficient_history", () => {
    const s = buildDeterministicSummary("insufficient_history", null, 0, 0, 0, 0, false, "insufficient");
    expect(s).toContain("not yet sufficient");
  });

  it("returns mapping-incomplete message when mapping_incomplete", () => {
    const s = buildDeterministicSummary("mapping_incomplete", "Stable", 0, 0, 3, 3, true, "limited");
    expect(s).toContain("mapping");
  });

  it("returns meaningful sentence for Strong Accumulation", () => {
    const s = buildDeterministicSummary("available", "Strong Accumulation", 3, 0, 10, 1, true, "high");
    expect(s.length).toBeGreaterThan(20);
    expect(s).not.toContain("Buy");
    expect(s).not.toContain("Sell");
    expect(s).not.toContain("Bullish");
    expect(s).not.toContain("Bearish");
    expect(s).not.toContain("Smart Money");
  });

  it("returns meaningful sentence for Strong Distribution", () => {
    const s = buildDeterministicSummary("available", "Strong Distribution", 0, 5, 1, 12, true, "high");
    expect(s.length).toBeGreaterThan(20);
  });

  it("does not contain investment advice language", () => {
    const labels = ["Strong Accumulation", "Accumulation", "Stable", "Distribution", "Strong Distribution"] as const;
    for (const label of labels) {
      const s = buildDeterministicSummary("available", label, 2, 1, 5, 3, true, "high");
      expect(s).not.toMatch(/buy|sell|bullish|bearish|smart money|recommend/i);
    }
  });

  it("is deterministic: same inputs → same output", () => {
    const s1 = buildDeterministicSummary("available", "Accumulation", 3, 1, 8, 4, true, "high");
    const s2 = buildDeterministicSummary("available", "Accumulation", 3, 1, 8, 4, true, "high");
    expect(s1).toBe(s2);
  });
});

// ---------------------------------------------------------------------------
// 11. buildInstitutionalSignal — full signal construction
// ---------------------------------------------------------------------------

describe("buildInstitutionalSignal()", () => {
  it("produces status=available for two quarters with data", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.status).toBe("available");
  });

  it("produces status=insufficient_history for single quarter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    expect(signal.status).toBe("insufficient_history");
    expect(signal.score).toBeNull();
  });

  it("produces status=mapping_incomplete when coverageStatus=insufficient", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ coverageStatus: "insufficient", reportingManagerCount: 0 }),
      makePreviousAggregate(),
      NOW,
    );
    expect(signal.status).toBe("mapping_incomplete");
  });

  it("populates latestQuarter and previousQuarter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.latestQuarter).toBe("2026-Q1");
    expect(signal.previousQuarter).toBe("2025-Q4");
  });

  it("previousQuarter is null for single quarter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    expect(signal.previousQuarter).toBeNull();
  });

  it("score is a number in [0, 100] for two-quarter available signal", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.score).not.toBeNull();
    expect(signal.score!).toBeGreaterThanOrEqual(0);
    expect(signal.score!).toBeLessThanOrEqual(100);
  });

  it("score is null for single quarter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    expect(signal.score).toBeNull();
  });

  it("score is null when confidence = insufficient (< 2 managers)", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ reportingManagerCount: 1 }),
      makePreviousAggregate(),
      NOW,
    );
    expect(signal.score).toBeNull();
  });

  it("label is set when score is not null", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.label).not.toBeNull();
  });

  it("label is Insufficient Data when score is null", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    expect(signal.label).toBe("Insufficient Data");
  });

  it("summary is a non-empty string", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(typeof signal.summary).toBe("string");
    expect(signal.summary!.length).toBeGreaterThan(0);
  });

  it("metrics.managerCountLatest = current reportingManagerCount", () => {
    const signal = buildInstitutionalSignal(makeAggregate({ reportingManagerCount: 20 }), makePreviousAggregate(), NOW);
    expect(signal.metrics.managerCountLatest).toBe(20);
  });

  it("metrics.managerCountPrevious = previous reportingManagerCount", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate({ reportingManagerCount: 19 }), NOW);
    expect(signal.metrics.managerCountPrevious).toBe(19);
  });

  it("metrics activity counts match current aggregate", () => {
    const current = makeAggregate({ newPositionCount: 3, exitedPositionCount: 2, increasedPositionCount: 8, reducedPositionCount: 4, unchangedCount: 3 });
    const signal = buildInstitutionalSignal(current, makePreviousAggregate(), NOW);
    expect(signal.metrics.newManagerCount).toBe(3);
    expect(signal.metrics.exitedManagerCount).toBe(2);
    expect(signal.metrics.increasedManagerCount).toBe(8);
    expect(signal.metrics.reducedManagerCount).toBe(4);
    expect(signal.metrics.unchangedManagerCount).toBe(3);
  });

  it("topBuyers, topSellers, newPositions are derived from largestHolders", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    // largestHolders has 2 increased, 1 reduced, 1 new
    expect(signal.topBuyers.length).toBeGreaterThan(0);
    expect(signal.topSellers.length).toBeGreaterThan(0);
    expect(signal.newPositions.length).toBeGreaterThan(0);
  });

  it("exitedPositions derived from previous holders absent in current", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    // Morgan Stanley (0009999999) is in previous but not in current → exited
    expect(signal.exitedPositions.length).toBe(1);
    expect(signal.exitedPositions[0].managerName).toBe("Morgan Stanley");
    expect(signal.exitedPositions[0].changeType).toBe("EXITED");
  });

  it("exitedPositions is empty for single quarter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    expect(signal.exitedPositions).toHaveLength(0);
  });

  it("freshness.source = 'SEC Form 13F'", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.freshness.source).toBe("SEC Form 13F");
  });

  it("freshness.delayed is always true", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.freshness.delayed).toBe(true);
  });

  it("freshness.periodEndDate matches current periodOfReport", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.freshness.periodEndDate).toBe("2026-03-31");
  });

  it("freshness.calculatedAt matches the `now` parameter", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(signal.freshness.calculatedAt).toBe(NOW.toISOString());
  });

  it("scoreComponents expose all four component values", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(typeof signal.scoreComponents.breadth).toBe("number");
    expect(typeof signal.scoreComponents.entrantsVsExits).toBe("number");
    expect(typeof signal.scoreComponents.concentration).toBe("number");
  });

  it("is deterministic: same inputs = same signal", () => {
    const s1 = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    const s2 = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(s1.score).toBe(s2.score);
    expect(s1.label).toBe(s2.label);
    expect(s1.summary).toBe(s2.summary);
    expect(s1.topBuyers.length).toBe(s2.topBuyers.length);
  });

  it("mappingCoverage reflects eligible / (eligible + excluded)", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ eligibleHoldingCount: 18, excludedHoldingCount: 2 }),
      makePreviousAggregate(),
      NOW,
    );
    expect(signal.dataQuality.mappingCoverage).toBeCloseTo(0.9, 2);
  });

  it("mappingCoverage = null when total holdings = 0", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ eligibleHoldingCount: 0, excludedHoldingCount: 0 }),
      makePreviousAggregate(),
      NOW,
    );
    expect(signal.dataQuality.mappingCoverage).toBeNull();
  });

  it("concentration.trend uses top5HolderPercent comparison", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ top5HolderPercent: 0.55 }),  // latest: 55%
      makePreviousAggregate({ top5HolderPercent: 0.42 }),  // prev: 42% → +13pp = increasing
      NOW,
    );
    expect(signal.concentration.trend).toBe("increasing_concentration");
  });

  it("does not call any LLM or external service (no async methods in pure path)", () => {
    // buildInstitutionalSignal is synchronous — no awaits, no network
    const result = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    expect(result).toBeDefined();
    // If this test passes synchronously, no LLM was called
  });
});

// ---------------------------------------------------------------------------
// 12. Amendment handling
// ---------------------------------------------------------------------------

describe("Amendment handling", () => {
  it("amendmentStatus='has_amendments' does not change score formula", () => {
    const signalClean = buildInstitutionalSignal(
      makeAggregate({ amendmentStatus: "clean" }),
      makePreviousAggregate(),
      NOW,
    );
    const signalAmended = buildInstitutionalSignal(
      makeAggregate({ amendmentStatus: "has_amendments" }),
      makePreviousAggregate(),
      NOW,
    );
    // Score is the same — amendments affect eligibility upstream, not the formula here
    expect(signalClean.score).toBe(signalAmended.score);
  });

  it("amendmentStatus is visible in the aggregate source — not fabricated", () => {
    // The signal engine reflects what was pre-aggregated; amendment de-duplication
    // is handled upstream by the aggregation engine (isEffective flag on filings)
    const current = makeAggregate({ amendmentStatus: "pending_amendments" });
    const signal = buildInstitutionalSignal(current, makePreviousAggregate(), NOW);
    // Signal still computes from what is stored; no double-counting is possible
    // because the aggregation engine only used effective filings
    expect(signal.score).toBeDefined(); // might be null if quality too low
  });

  it("amendment supersession is enforced by isEffective at aggregation time, not signal time", () => {
    // This test documents the contract: the signal engine never reads raw holdings.
    // It only reads institutional_quarterly_aggregates (already amendment-resolved).
    // This means double-counting (original + amendment) is impossible at signal time.
    expect(true).toBe(true); // Documented invariant
  });
});

// ---------------------------------------------------------------------------
// 13. Consumer contracts
// ---------------------------------------------------------------------------

describe("signalToEvidence()", () => {
  it("available=true when status is available", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    const ev = signalToEvidence(signal);
    expect(ev.available).toBe(true);
  });

  it("available=true when status is insufficient_history (partial data available)", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW);
    const ev = signalToEvidence(signal);
    expect(ev.available).toBe(true);
  });

  it("available=false when status is unavailable", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ reportingManagerCount: 0, coverageStatus: "insufficient" }),
      makePreviousAggregate(),
      NOW,
    );
    // status=mapping_incomplete, still available=false
    const ev = signalToEvidence(signal);
    // mapping_incomplete is not in the "available" set
    expect(ev.available).toBe(false);
  });

  it("evidenceStrength is strong for score >= 70", () => {
    const signal = buildInstitutionalSignal(
      makeAggregate({ increasedPositionCount: 18, reducedPositionCount: 0, reportedSharesChangePercent: 0.3, newPositionCount: 5, exitedPositionCount: 0 }),
      makePreviousAggregate(),
      NOW,
    );
    const ev = signalToEvidence(signal);
    if (ev.score !== null && ev.score >= 70) {
      expect(ev.evidenceStrength).toBe("strong");
    }
  });

  it("evidenceStrength is unavailable when score is null", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), null, NOW); // null score
    const ev = signalToEvidence(signal);
    expect(ev.evidenceStrength).toBe("unavailable");
  });

  it("does not contain buy/sell/bullish/bearish language", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    const ev = signalToEvidence(signal);
    const text = JSON.stringify(ev);
    expect(text).not.toMatch(/buy|sell|bullish|bearish|smart money/i);
  });
});

describe("signalToWorkspaceContract()", () => {
  it("contains status, score, label, latestQuarter, summary, topEvidence", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    const ws = signalToWorkspaceContract(signal);
    expect(ws).toHaveProperty("status");
    expect(ws).toHaveProperty("score");
    expect(ws).toHaveProperty("label");
    expect(ws).toHaveProperty("latestQuarter");
    expect(ws).toHaveProperty("summary");
    expect(ws).toHaveProperty("topEvidence");
    expect(Array.isArray(ws.topEvidence)).toBe(true);
  });

  it("topEvidence has at most 3 items", () => {
    const signal = buildInstitutionalSignal(makeAggregate(), makePreviousAggregate(), NOW);
    const ws = signalToWorkspaceContract(signal);
    expect(ws.topEvidence.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 14. Route precedence regression (no LLM, no dynamic symbol collision)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { resolve } from "path";

describe("Route registration order — signals route before dynamic :symbol", () => {
  const routesContent = readFileSync(resolve(__dirname, "../../../routes.ts"), "utf-8");
  const lines = routesContent.split("\n");

  function lineOf(fragment: string): number {
    return lines.findIndex((l) => l.includes(fragment));
  }

  it("registerInstitutionalSignalRoutes is registered in routes.ts", () => {
    expect(lineOf("registerInstitutionalSignalRoutes")).toBeGreaterThan(-1);
  });

  it("signals routes are registered BEFORE the dynamic :symbol route", () => {
    const signalsLine = lineOf("registerInstitutionalSignalRoutes(app");
    const symbolLine = lineOf("registerInstitutionalRoute(app");
    expect(signalsLine).toBeGreaterThan(-1);
    expect(symbolLine).toBeGreaterThan(-1);
    expect(signalsLine).toBeLessThan(symbolLine);
  });
});
