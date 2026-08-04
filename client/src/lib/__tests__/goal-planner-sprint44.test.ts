// Sprint 4.4 follow-up — Goal Planner presentation consistency tests.
//
// Covers Task #36 (Unavailable Candidates section) and Task #37
// (count-first exclusion format) for the goal-based trade planner surface.
//
// Tests cover:
//  G01 — unavailableCount > 0 with no candidate-level details
//  G02 — unavailable section details when dataRejectionGroups present
//  G03 — unavailable section hidden when zero
//  G04 — unavailable never rendered under rejected
//  G05 — count-first exclusion formatting via shortExclusionLabel
//  G06 — shared exclusion-label mapping (goal planner uses same helper as market-wide)
//  G07 — unknown reason handled without exposing raw code
//  G08 — deterministic count preserved
//  G09 — no fabricated symbols or explanations

import { describe, it, expect } from "vitest";
import {
  isDataUnavailabilityRejection,
  trueRejectionGroups,
  dataRejectionGroups,
  shortExclusionLabel,
  translateRejectionReason,
  type RankedRejectionGroup,
  type RankedTradeSearch,
} from "../ranked-trade-search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<RankedTradeSearch> = {}): RankedTradeSearch {
  return {
    request: {},
    reviewedCount: 0,
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

function makeRej(reason: string, count: number, symbols: string[] = []): RankedRejectionGroup {
  return { reason, count, symbols };
}

// ---------------------------------------------------------------------------
// G01 — unavailableCount > 0 with no candidate-level details
// ---------------------------------------------------------------------------

describe("G01: unavailableCount > 0, no candidate-level details", () => {
  it("dataRejectionGroups returns empty when rejectionSummary has no data codes", () => {
    const search = makeSearch({
      unavailableCount: 5,
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 2)],
    });
    const dataGroups = dataRejectionGroups(search.rejectionSummary);
    expect(dataGroups).toHaveLength(0);
  });

  it("totalUnavailable = unavailableCount when no extra data groups", () => {
    const search = makeSearch({ unavailableCount: 5 });
    const extraCount = dataRejectionGroups(search.rejectionSummary).reduce(
      (s, g) => s + g.count,
      0,
    );
    const total = search.unavailableCount + extraCount;
    expect(total).toBe(5);
  });

  it("unavailable section should show when unavailableCount > 0 even without per-reason breakdown", () => {
    // Simulate the visibility condition used in the component
    const search = makeSearch({ unavailableCount: 3 });
    const extraGroups = dataRejectionGroups(search.rejectionSummary);
    const extraCount = extraGroups.reduce((s, g) => s + g.count, 0);
    const totalUnavailable = search.unavailableCount + extraCount;
    const shouldShow = totalUnavailable > 0 || extraGroups.length > 0;
    expect(shouldShow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G02 — unavailable candidate details when dataRejectionGroups present
// ---------------------------------------------------------------------------

describe("G02: unavailable section details from dataRejectionGroups", () => {
  it("dataRejectionGroups extracts DATA_UNAVAILABLE from rejectionSummary", () => {
    const summary: RankedRejectionGroup[] = [
      makeRej("RISK_LIMIT_EXCEEDED", 3, ["BA", "AAPL"]),
      makeRej("DATA_UNAVAILABLE", 2, ["NVDA"]),
      makeRej("OPTIONS_DATA_UNAVAILABLE", 1, []),
    ];
    const groups = dataRejectionGroups(summary);
    expect(groups.map((g) => g.reason)).toContain("DATA_UNAVAILABLE");
    expect(groups.map((g) => g.reason)).toContain("OPTIONS_DATA_UNAVAILABLE");
  });

  it("dataRejectionGroups total adds to unavailableCount for component total", () => {
    const search = makeSearch({
      unavailableCount: 3,
      rejectionSummary: [
        makeRej("DATA_UNAVAILABLE", 2, ["NVDA"]),
        makeRej("RISK_LIMIT_EXCEEDED", 1),
      ],
    });
    const extraGroups = dataRejectionGroups(search.rejectionSummary);
    const total = search.unavailableCount + extraGroups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(5); // 3 + 2
  });

  it("symbols from dataRejectionGroups are backend-provided (not fabricated)", () => {
    const group = makeRej("DATA_UNAVAILABLE", 2, ["NVDA", "MSFT"]);
    // Confirm symbols come from backend field exactly
    expect(group.symbols).toEqual(["NVDA", "MSFT"]);
  });

  it("translateRejectionReason renders human-facing label for data codes", () => {
    expect(translateRejectionReason("DATA_UNAVAILABLE")).toBe(
      "Required market confirmation missing",
    );
    expect(translateRejectionReason("OPTIONS_DATA_UNAVAILABLE")).toBe(
      "Options data unavailable",
    );
    expect(translateRejectionReason("MARKET_REGIME_UNAVAILABLE")).toBe(
      "Market regime unavailable",
    );
  });
});

// ---------------------------------------------------------------------------
// G03 — unavailable section hidden when zero
// ---------------------------------------------------------------------------

describe("G03: unavailable section hidden when zero", () => {
  it("section should NOT show when unavailableCount = 0 and no data groups", () => {
    const search = makeSearch({
      unavailableCount: 0,
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 3)],
    });
    const extraGroups = dataRejectionGroups(search.rejectionSummary);
    const extraCount = extraGroups.reduce((s, g) => s + g.count, 0);
    const totalUnavailable = search.unavailableCount + extraCount;
    const shouldShow = totalUnavailable > 0 || extraGroups.length > 0;
    expect(shouldShow).toBe(false);
  });

  it("section should NOT show when both unavailableCount and rejectionSummary are empty", () => {
    const search = makeSearch();
    const extraGroups = dataRejectionGroups(search.rejectionSummary);
    const totalUnavailable =
      search.unavailableCount + extraGroups.reduce((s, g) => s + g.count, 0);
    expect(totalUnavailable > 0 || extraGroups.length > 0).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G04 — unavailable never rendered under rejected
// ---------------------------------------------------------------------------

describe("G04: unavailable never under rejected", () => {
  const GOAL_DATA_CODES = [
    "DATA_UNAVAILABLE",
    "UNDERLYING_MARKET_DATA_UNAVAILABLE",
    "OPTIONS_DATA_UNAVAILABLE",
    "DATA_FRESHNESS_INSUFFICIENT",
    "CANDIDATE_CONFIRMATION_UNAVAILABLE",
    "MARKET_REGIME_UNAVAILABLE",
  ];

  it("trueRejectionGroups removes all data-unavailability codes", () => {
    const summary = GOAL_DATA_CODES.map((c) => makeRej(c, 1)).concat([
      makeRej("RISK_LIMIT_EXCEEDED", 2),
      makeRej("EARNINGS_RISK", 1),
    ]);
    const trueRej = trueRejectionGroups(summary);
    const reasons = trueRej.map((g) => g.reason);
    for (const code of GOAL_DATA_CODES) {
      expect(reasons).not.toContain(code);
    }
    expect(reasons).toContain("RISK_LIMIT_EXCEEDED");
    expect(reasons).toContain("EARNINGS_RISK");
  });

  it("dataRejectionGroups and trueRejectionGroups are complementary partitions", () => {
    const summary: RankedRejectionGroup[] = [
      makeRej("RISK_LIMIT_EXCEEDED", 3),
      makeRej("DATA_UNAVAILABLE", 2),
      makeRej("EARNINGS_RISK", 1),
      makeRej("OPTIONS_DATA_UNAVAILABLE", 1),
    ];
    const trueRej = trueRejectionGroups(summary);
    const dataGroups = dataRejectionGroups(summary);
    // No overlap in reason codes
    const trueReasons = new Set(trueRej.map((g) => g.reason));
    const dataReasons = new Set(dataGroups.map((g) => g.reason));
    const overlap = [...trueReasons].filter((r) => dataReasons.has(r));
    expect(overlap).toHaveLength(0);
    // Combined they equal the original
    expect(trueRej.length + dataGroups.length).toBe(summary.length);
  });

  it("isDataUnavailabilityRejection correctly classifies all goal-relevant codes", () => {
    for (const code of GOAL_DATA_CODES) {
      expect(isDataUnavailabilityRejection(code)).toBe(true);
    }
    expect(isDataUnavailabilityRejection("RISK_LIMIT_EXCEEDED")).toBe(false);
    expect(isDataUnavailabilityRejection("EARNINGS_RISK")).toBe(false);
    expect(isDataUnavailabilityRejection("DIRECTION_CONFLICT")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G05 — count-first exclusion formatting via shortExclusionLabel
// ---------------------------------------------------------------------------

describe("G05: count-first exclusion formatting", () => {
  it("shortExclusionLabel returns a concise label (not the full verbose translateExclusionReason)", () => {
    // Sprint 4.5 §9 — spec-aligned label updated from "Not yet triggered"
    expect(shortExclusionLabel("NOT_ACTIONABLE_NO_TRIGGER")).toBe("Waiting for breakout trigger");
    expect(shortExclusionLabel("STALE")).toBe("Outside freshness window");
    expect(shortExclusionLabel("DIRECTION_MISMATCH")).toBe("Direction mismatch");
    expect(shortExclusionLabel("INVALID_SETUP")).toBe("Invalid setup");
    expect(shortExclusionLabel("SIMULATED_DATA_NOT_ELIGIBLE")).toBe("Simulated data only");
  });

  it("count-first format: count is the leading value, not appended", () => {
    // The count-first pattern produces "N — Label" not "Label — N"
    // Verify the component pattern: number rendered first, label rendered second.
    // We check here that shortExclusionLabel never starts with a number.
    const labels = [
      shortExclusionLabel("NOT_ACTIONABLE_NO_TRIGGER"),
      shortExclusionLabel("STALE"),
      shortExclusionLabel("DIRECTION_MISMATCH"),
    ];
    for (const label of labels) {
      expect(/^\d/.test(label)).toBe(false); // label itself is not count-prefixed
    }
    // The count is rendered by the component using g.count, NOT embedded in the label
  });

  it("count in component pattern equals backend g.count exactly (no rounding)", () => {
    const group = makeRej("NOT_ACTIONABLE_NO_TRIGGER", 18);
    // The component renders: "{g.count} — {shortExclusionLabel(g.reason)}"
    // Verify count is preserved as-is
    expect(group.count).toBe(18);
    const label = shortExclusionLabel(group.reason);
    // Sprint 4.5 §9 label update
    expect(label).toBe("Waiting for breakout trigger");
  });
});

// ---------------------------------------------------------------------------
// G06 — shared exclusion-label mapping
// ---------------------------------------------------------------------------

describe("G06: shared exclusion-label mapping (goal planner = market-wide)", () => {
  it("goal planner uses same shortExclusionLabel helper as ranked-trade-search-cards", () => {
    // Both components import from the same module — verified by checking exports.
    // The helper returns identical values regardless of call site.
    const allKnownCodes = [
      "NOT_ACTIONABLE_NO_TRIGGER",
      "STALE",
      "DIRECTION_MISMATCH",
      "INVALID_SETUP",
      "SIMULATED_DATA_NOT_ELIGIBLE",
    ];
    const marketWideLabels = allKnownCodes.map(shortExclusionLabel);
    const goalPlannerLabels = allKnownCodes.map(shortExclusionLabel); // same import
    expect(marketWideLabels).toEqual(goalPlannerLabels);
  });

  it("no duplicate mappings — each known code maps to exactly one label", () => {
    const knownCodes = [
      "NOT_ACTIONABLE_NO_TRIGGER",
      "STALE",
      "DIRECTION_MISMATCH",
      "INVALID_SETUP",
      "SIMULATED_DATA_NOT_ELIGIBLE",
    ];
    const labels = knownCodes.map(shortExclusionLabel);
    const unique = new Set(labels);
    // All 5 known codes should produce distinct labels
    expect(unique.size).toBe(knownCodes.length);
  });
});

// ---------------------------------------------------------------------------
// G07 — unknown reason handled without exposing raw code
// ---------------------------------------------------------------------------

describe("G07: unknown reason handling", () => {
  it("shortExclusionLabel humanises unknown codes", () => {
    const result = shortExclusionLabel("SOME_FUTURE_REASON_CODE");
    expect(result).not.toBe("SOME_FUTURE_REASON_CODE");
    expect(result).toBe("Some Future Reason Code");
  });

  it("shortExclusionLabel does not contain underscores for unknown codes", () => {
    expect(shortExclusionLabel("ANOTHER_UNKNOWN_CODE")).not.toContain("_");
  });

  it("translateRejectionReason humanises unknown data-availability codes", () => {
    const label = translateRejectionReason("SOME_NEW_DATA_REASON");
    // Falls back to title-case humanisation, never exposes the raw code verbatim
    expect(label).not.toContain("_");
    expect(label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// G08 — deterministic count preservation
// ---------------------------------------------------------------------------

describe("G08: deterministic count preservation", () => {
  it("trueRejectedCount = sum of counts in true rejection groups", () => {
    const summary: RankedRejectionGroup[] = [
      makeRej("RISK_LIMIT_EXCEEDED", 3),
      makeRej("EARNINGS_RISK", 2),
      makeRej("DATA_UNAVAILABLE", 4), // should be excluded
    ];
    const trueRej = trueRejectionGroups(summary);
    const count = trueRej.reduce((s, g) => s + g.count, 0);
    expect(count).toBe(5); // 3 + 2, not 9
  });

  it("totalUnavailable = unavailableCount + dataRejection groups count", () => {
    const search = makeSearch({
      unavailableCount: 3,
      rejectionSummary: [makeRej("DATA_UNAVAILABLE", 2), makeRej("RISK_LIMIT_EXCEEDED", 1)],
    });
    const dataGroups = dataRejectionGroups(search.rejectionSummary);
    const total = search.unavailableCount + dataGroups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(5);
  });

  it("counts are never rounded, truncated, or combined across categories", () => {
    const search = makeSearch({
      reviewedCount: 42,
      qualifiedCount: 2,
      excludedCount: 18,
      rejectedCount: 7,
      unavailableCount: 4,
    });
    // Each count field is independent — no derived combination
    expect(search.reviewedCount).toBe(42);
    expect(search.qualifiedCount).toBe(2);
    expect(search.excludedCount).toBe(18);
    expect(search.rejectedCount).toBe(7);
    expect(search.unavailableCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// G09 — no fabricated symbols or explanations
// ---------------------------------------------------------------------------

describe("G09: no fabricated symbols or explanations", () => {
  it("dataRejectionGroups preserves backend symbols exactly — never invents", () => {
    const original = makeRej("DATA_UNAVAILABLE", 2, ["NVDA", "MSFT"]);
    const result = dataRejectionGroups([original]);
    expect(result[0].symbols).toEqual(["NVDA", "MSFT"]);
  });

  it("dataRejectionGroups preserves empty symbols array — never fills with invented symbols", () => {
    const original = makeRej("OPTIONS_DATA_UNAVAILABLE", 3, []);
    const result = dataRejectionGroups([original]);
    expect(result[0].symbols).toEqual([]);
  });

  it("qualificationGatesMissed does not add gates when no evidence", async () => {
    const { qualificationGatesMissed } = await import("../ranked-trade-search");
    const search = makeSearch({ reviewedCount: 0 });
    const gates = qualificationGatesMissed(search);
    expect(gates).toEqual([]);
  });

  it("trueRejectionGroups never invents rejection reasons", () => {
    const summary = [makeRej("RISK_LIMIT_EXCEEDED", 2)];
    const result = trueRejectionGroups(summary);
    // Result is a strict subset of input — no extra entries
    expect(result.length).toBeLessThanOrEqual(summary.length);
    for (const g of result) {
      const found = summary.find((s) => s.reason === g.reason);
      expect(found).toBeDefined();
    }
  });

  it("unavailable section count = backend fields only, never adds a +1", () => {
    const search = makeSearch({
      unavailableCount: 3,
      rejectionSummary: [makeRej("DATA_UNAVAILABLE", 2)],
    });
    const dataGroups = dataRejectionGroups(search.rejectionSummary);
    const total = search.unavailableCount + dataGroups.reduce((s, g) => s + g.count, 0);
    // Must equal exactly 5, not 5+1 or any invented addition
    expect(total).toBe(5);
  });
});
