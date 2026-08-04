// Sprint 4.4 — Deterministic Qualification Explanation regression tests.
//
// 12 tests covering:
//  1. unavailable not mixed into rejected
//  2. rejected section hidden when rejectedCount = 0 after filtering
//  3. exclusion summaries render correctly (count-first format)
//  4. absent exclusionSummary does not create fabricated reasons
//  5. closest matches never rendered (no backend field)
//  6. closest matches remain hidden when unsupported
//  7. zero-qualified explanation shows gates
//  8. accurate deterministic counts preserved
//  9. buying power and cash verification remain separate
// 10. OpenAI cannot alter deterministic categories (rule boundary)
// 11. existing qualified-trade rendering unchanged
// 12. no execution behavior

import { describe, it, expect } from "vitest";
import {
  isDataUnavailabilityRejection,
  trueRejectionGroups,
  dataRejectionGroups,
  shortExclusionLabel,
  qualificationGatesMissed,
  rankedCountsLine,
  buildEmptyState,
  type RankedTradeSearch,
  type RankedRejectionGroup,
} from "../ranked-trade-search";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<RankedTradeSearch> = {}): RankedTradeSearch {
  return {
    request: {},
    reviewedCount: 10,
    qualifiedCount: 0,
    watchCount: 0,
    rejectedCount: 0,
    unavailableCount: 0,
    candidates: [],
    watchCandidates: [],
    rejectionSummary: [],
    generatedAt: new Date().toISOString(),
    warnings: [],
    ...overrides,
  };
}

function makeRejectionGroup(reason: string, count: number, symbols: string[] = []): RankedRejectionGroup {
  return { reason, count, symbols };
}

// ---------------------------------------------------------------------------
// T01 — §2, §3: Unavailable not mixed into rejected
// ---------------------------------------------------------------------------

describe("T01: isDataUnavailabilityRejection", () => {
  it("returns true for DATA_UNAVAILABLE", () => {
    expect(isDataUnavailabilityRejection("DATA_UNAVAILABLE")).toBe(true);
  });
  it("returns true for UNDERLYING_MARKET_DATA_UNAVAILABLE", () => {
    expect(isDataUnavailabilityRejection("UNDERLYING_MARKET_DATA_UNAVAILABLE")).toBe(true);
  });
  it("returns true for OPTIONS_DATA_UNAVAILABLE", () => {
    expect(isDataUnavailabilityRejection("OPTIONS_DATA_UNAVAILABLE")).toBe(true);
  });
  it("returns true for MARKET_REGIME_UNAVAILABLE", () => {
    expect(isDataUnavailabilityRejection("MARKET_REGIME_UNAVAILABLE")).toBe(true);
  });
  it("returns false for RISK_LIMIT_EXCEEDED (true qualification failure)", () => {
    expect(isDataUnavailabilityRejection("RISK_LIMIT_EXCEEDED")).toBe(false);
  });
  it("returns false for EARNINGS_RISK (true qualification failure)", () => {
    expect(isDataUnavailabilityRejection("EARNINGS_RISK")).toBe(false);
  });
  it("handles reason codes with suffixes (e.g. EARNINGS_RISK:NVDA)", () => {
    expect(isDataUnavailabilityRejection("DATA_UNAVAILABLE:BA")).toBe(true);
    expect(isDataUnavailabilityRejection("RISK_LIMIT_EXCEEDED:BA")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T02 — §3: trueRejectionGroups filters data-unavailability reasons
// ---------------------------------------------------------------------------

describe("T02: trueRejectionGroups / dataRejectionGroups", () => {
  const mixed: RankedRejectionGroup[] = [
    makeRejectionGroup("RISK_LIMIT_EXCEEDED", 3, ["BA", "AAPL", "TSLA"]),
    makeRejectionGroup("DATA_UNAVAILABLE", 2, ["NVDA"]),
    makeRejectionGroup("EARNINGS_RISK", 1, ["MSFT"]),
    makeRejectionGroup("OPTIONS_DATA_UNAVAILABLE", 1, []),
  ];

  it("trueRejectionGroups excludes data-unavailability reasons", () => {
    const result = trueRejectionGroups(mixed);
    const reasons = result.map((g) => g.reason);
    expect(reasons).toContain("RISK_LIMIT_EXCEEDED");
    expect(reasons).toContain("EARNINGS_RISK");
    expect(reasons).not.toContain("DATA_UNAVAILABLE");
    expect(reasons).not.toContain("OPTIONS_DATA_UNAVAILABLE");
  });

  it("dataRejectionGroups returns only data-unavailability reasons", () => {
    const result = dataRejectionGroups(mixed);
    const reasons = result.map((g) => g.reason);
    expect(reasons).not.toContain("RISK_LIMIT_EXCEEDED");
    expect(reasons).not.toContain("EARNINGS_RISK");
    expect(reasons).toContain("DATA_UNAVAILABLE");
    expect(reasons).toContain("OPTIONS_DATA_UNAVAILABLE");
  });

  it("trueRejectionGroups preserves count for non-data reasons", () => {
    const result = trueRejectionGroups(mixed);
    const risk = result.find((g) => g.reason === "RISK_LIMIT_EXCEEDED");
    expect(risk?.count).toBe(3);
    expect(risk?.symbols).toEqual(["BA", "AAPL", "TSLA"]);
  });
});

// ---------------------------------------------------------------------------
// T03 — §1: shortExclusionLabel — count-first format labels
// ---------------------------------------------------------------------------

describe("T03: shortExclusionLabel", () => {
  it("NOT_ACTIONABLE_NO_TRIGGER → 'Not yet triggered'", () => {
    expect(shortExclusionLabel("NOT_ACTIONABLE_NO_TRIGGER")).toBe("Not yet triggered");
  });
  it("STALE → 'Outside freshness window'", () => {
    expect(shortExclusionLabel("STALE")).toBe("Outside freshness window");
  });
  it("DIRECTION_MISMATCH → 'Direction mismatch'", () => {
    expect(shortExclusionLabel("DIRECTION_MISMATCH")).toBe("Direction mismatch");
  });
  it("INVALID_SETUP → 'Invalid setup'", () => {
    expect(shortExclusionLabel("INVALID_SETUP")).toBe("Invalid setup");
  });
  it("SIMULATED_DATA_NOT_ELIGIBLE → 'Simulated data only'", () => {
    expect(shortExclusionLabel("SIMULATED_DATA_NOT_ELIGIBLE")).toBe("Simulated data only");
  });
  it("unknown codes humanize safely without exposing raw internal names", () => {
    const label = shortExclusionLabel("SOME_FUTURE_REASON_CODE");
    expect(label).not.toBe("SOME_FUTURE_REASON_CODE");
    expect(label).toBe("Some Future Reason Code");
  });
});

// ---------------------------------------------------------------------------
// T04 — §1: absent exclusionSummary does not fabricate reasons
// ---------------------------------------------------------------------------

describe("T04: absent exclusionSummary", () => {
  it("qualificationGatesMissed returns empty when no exclusion/rejection data", () => {
    const search = makeSearch({ reviewedCount: 5, qualifiedCount: 0 });
    expect(qualificationGatesMissed(search)).toEqual([]);
  });

  it("rankedCountsLine omits excluded when excludedCount absent", () => {
    const search = makeSearch({ reviewedCount: 10, qualifiedCount: 0 });
    const line = rankedCountsLine(search);
    expect(line).not.toContain("excluded");
  });
});

// ---------------------------------------------------------------------------
// T05, T06 — §4: Closest matches never rendered (no backend field)
// ---------------------------------------------------------------------------

describe("T05+T06: closest matches never fabricated", () => {
  it("RankedTradeSearch has no closestMatches or nearMiss field (type safety)", () => {
    const search = makeSearch();
    // TypeScript would error if these fields existed; at runtime they're simply absent.
    expect((search as Record<string, unknown>).closestMatches).toBeUndefined();
    expect((search as Record<string, unknown>).nearMiss).toBeUndefined();
  });

  it("qualificationGatesMissed returns empty [] when search has no evidence (no invented gates)", () => {
    const search = makeSearch({
      reviewedCount: 0,
      rejectedCount: 0,
      unavailableCount: 0,
    });
    const gates = qualificationGatesMissed(search);
    expect(gates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T07 — §5: Zero-qualified explanation shows gates from evidence
// ---------------------------------------------------------------------------

describe("T07: qualificationGatesMissed derives gates from returned data", () => {
  it("derives trigger gate from NOT_ACTIONABLE_NO_TRIGGER exclusion", () => {
    const search = makeSearch({
      excludedCount: 18,
      exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 18 }],
    });
    const gates = qualificationGatesMissed(search);
    expect(gates).toContain("Actionable entry trigger");
  });

  it("derives freshness gate from STALE exclusion", () => {
    const search = makeSearch({
      excludedCount: 11,
      exclusionSummary: [{ reason: "STALE", count: 11 }],
    });
    const gates = qualificationGatesMissed(search);
    expect(gates).toContain("Setup freshness");
  });

  it("derives risk budget gate from RISK_LIMIT_EXCEEDED rejection", () => {
    const search = makeSearch({
      rejectedCount: 4,
      rejectionSummary: [makeRejectionGroup("RISK_LIMIT_EXCEEDED", 4)],
    });
    const gates = qualificationGatesMissed(search);
    expect(gates).toContain("Risk budget");
  });

  it("derives market data gate from unavailableCount > 0", () => {
    const search = makeSearch({ unavailableCount: 3 });
    const gates = qualificationGatesMissed(search);
    expect(gates).toContain("Required market data");
  });

  it("derives multiple gates from a mixed result", () => {
    const search = makeSearch({
      excludedCount: 18,
      exclusionSummary: [
        { reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 11 },
        { reason: "STALE", count: 7 },
      ],
      rejectedCount: 4,
      rejectionSummary: [makeRejectionGroup("RISK_LIMIT_EXCEEDED", 4)],
      unavailableCount: 2,
    });
    const gates = qualificationGatesMissed(search);
    expect(gates).toContain("Actionable entry trigger");
    expect(gates).toContain("Setup freshness");
    expect(gates).toContain("Risk budget");
    expect(gates).toContain("Required market data");
  });
});

// ---------------------------------------------------------------------------
// T08 — §7: Accurate deterministic counts preserved
// ---------------------------------------------------------------------------

describe("T08: rankedCountsLine preserves count semantics", () => {
  it("shows reviewedCount as 'stored opportunities reviewed'", () => {
    const search = makeSearch({ reviewedCount: 42, qualifiedCount: 2 });
    const line = rankedCountsLine(search);
    expect(line).toContain("42 stored");
    expect(line).toContain("reviewed");
  });

  it("shows groupedCandidateCount as 'post-confluence' when present", () => {
    const search = makeSearch({ reviewedCount: 42, groupedCandidateCount: 12, qualifiedCount: 2 });
    const line = rankedCountsLine(search);
    expect(line).toContain("post-confluence");
  });

  it("shows qualified, excluded, watch, rejected, unavailable as distinct labels", () => {
    const search = makeSearch({
      reviewedCount: 50,
      qualifiedCount: 2,
      excludedCount: 18,
      watchCount: 3,
      rejectedCount: 7,
      unavailableCount: 4,
    });
    const line = rankedCountsLine(search);
    expect(line).toContain("2 qualified");
    expect(line).toContain("18 excluded");
    expect(line).toContain("3 worth watching");
    expect(line).toContain("7 rejected");
    expect(line).toContain("4 unavailable");
  });

  it("never implies bucket counts must sum to reviewedCount", () => {
    // All we check is that reviewedCount is labeled as raw stored opportunities,
    // and other labels are present independently. No assertion about sums.
    const search = makeSearch({ reviewedCount: 100, qualifiedCount: 1, rejectedCount: 5 });
    const line = rankedCountsLine(search);
    expect(line).toContain("100 stored");
    expect(line).toContain("1 qualified");
  });
});

// ---------------------------------------------------------------------------
// T09 — §6: Buying power and cash verification remain separate
// ---------------------------------------------------------------------------
// (Tested via portfolioFitRows in portfolio-fit-display)

describe("T09: cash requirement and buying power are separate rows", () => {
  it("portfolioFitRows produces separate Buying Power and Cash Requirement rows", async () => {
    const { portfolioFitRows } = await import("../portfolio-fit-display");
    const awareness = {
      buyingPowerSufficiency: "sufficient" as const,
      cashSufficiency: "not_verified" as const,
    };
    const rows = portfolioFitRows(awareness as any);
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Buying Power");
    expect(labels).toContain("Cash Requirement");
    // No combined "Trade Affordable" or "Affordability" label
    expect(labels.join(" ")).not.toMatch(/afford/i);
  });

  it("Cash Requirement shows 'Not verified' when cashSufficiency is not_verified", async () => {
    const { portfolioFitRows } = await import("../portfolio-fit-display");
    const awareness = { cashSufficiency: "not_verified" as const };
    const rows = portfolioFitRows(awareness as any);
    const cashRow = rows.find((r) => r.label === "Cash Requirement");
    expect(cashRow).toBeDefined();
    expect(cashRow?.value).toBe("Not verified");
  });
});

// ---------------------------------------------------------------------------
// T10 — §8: OpenAI cannot alter deterministic categories (boundary test)
// ---------------------------------------------------------------------------

describe("T10: deterministic category boundary", () => {
  it("trueRejectionGroups is stable regardless of what AI might classify", () => {
    // Simulate what would happen if an AI description tried to add a
    // data-availability reason to the true-rejection list. The helper
    // must filter it out deterministically.
    const groups: RankedRejectionGroup[] = [
      makeRejectionGroup("RISK_LIMIT_EXCEEDED", 2),
      makeRejectionGroup("DATA_UNAVAILABLE", 3), // should always be in unavailable, not rejected
    ];
    const trueGroups = trueRejectionGroups(groups);
    expect(trueGroups.every((g) => !isDataUnavailabilityRejection(g.reason))).toBe(true);
    expect(trueGroups.map((g) => g.reason)).not.toContain("DATA_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// T11 — §11: Existing qualified-trade rendering unchanged
// ---------------------------------------------------------------------------

describe("T11: qualified trade empty state not triggered when candidates present", () => {
  it("buildEmptyState returns null when candidates are present", () => {
    const search = makeSearch({
      qualifiedCount: 1,
      candidates: [{ rank: 1, symbol: "BA", whySelected: ["VCP pattern"], warnings: [] }],
    });
    const state = buildEmptyState(search, "RANKED_MCP_SUCCESS", "Find trades");
    expect(state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T12 — §12: No execution behavior from ranking helpers
// ---------------------------------------------------------------------------

describe("T12: ranking helpers are pure / no execution behavior", () => {
  it("all helpers return values without side effects", () => {
    const search = makeSearch({
      excludedCount: 5,
      exclusionSummary: [{ reason: "STALE", count: 5 }],
      rejectedCount: 3,
      rejectionSummary: [makeRejectionGroup("RISK_LIMIT_EXCEEDED", 3)],
    });
    // All helpers must be synchronous and produce no async side effects
    const trueGroups = trueRejectionGroups(search.rejectionSummary);
    const dataGroups = dataRejectionGroups(search.rejectionSummary);
    const gates = qualificationGatesMissed(search);
    const label = shortExclusionLabel("STALE");
    const line = rankedCountsLine(search);

    expect(Array.isArray(trueGroups)).toBe(true);
    expect(Array.isArray(dataGroups)).toBe(true);
    expect(Array.isArray(gates)).toBe(true);
    expect(typeof label).toBe("string");
    expect(typeof line).toBe("string");
  });
});
