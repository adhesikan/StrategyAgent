// Sprint 4.1A — Ranked trade search presentation logic tests.
// Covers: empty states (A/B/C/D), rejection reason translation,
// actionable hints, and exclusion reason translation.
// These are pure-function tests — no React, no DOM, no server calls.

import { describe, it, expect } from "vitest";
import {
  actionableHint,
  buildEmptyState,
  translateExclusionReason,
  translateRejectionReason,
  type RankedTradeSearch,
} from "./ranked-trade-search";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<RankedTradeSearch> = {}): RankedTradeSearch {
  return {
    request: {},
    reviewedCount: 0,
    qualifiedCount: 0,
    watchCount: 0,
    rejectedCount: 0,
    unavailableCount: 0,
    excludedCount: 0,
    exclusionSummary: [],
    candidates: [],
    watchCandidates: [],
    rejectionSummary: [],
    generatedAt: "2026-08-04T00:00:00Z",
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildEmptyState — the four spec states
// ---------------------------------------------------------------------------

describe("buildEmptyState", () => {
  // State A — true zero
  it("returns no-results state when reviewedCount=0 and no rejections", () => {
    const state = buildEmptyState(makeSearch({ reviewedCount: 0 }), "RANKED_MCP_EMPTY");
    expect(state).not.toBeNull();
    expect(state!.icon).toBe("no-results");
    expect(state!.headline).toMatch(/no opportunities detected/i);
    expect(state!.cta.length).toBeGreaterThan(0);
  });

  // State B — setups reviewed, none qualify
  it("returns not-yet state when setups were reviewed but all rejected", () => {
    const state = buildEmptyState(
      makeSearch({ reviewedCount: 5, rejectedCount: 3, excludedCount: 2, qualifiedCount: 0 }),
      "RANKED_MCP_EMPTY",
    );
    expect(state).not.toBeNull();
    expect(state!.icon).toBe("not-yet");
    expect(state!.headline).toMatch(/reviewed.*none currently qualify/i);
    expect(state!.subtitle).toMatch(/confirmation checks/i);
    expect(state!.cta.some((c) => c.href === "/scanner")).toBe(true);
  });

  it("returns not-yet state when only watch candidates are present (no qualified)", () => {
    const search = makeSearch({
      reviewedCount: 3,
      watchCount: 2,
      qualifiedCount: 0,
      rejectedCount: 1,
      watchCandidates: [
        { symbol: "NVDA", watchConditions: ["Wait for trigger"] },
        { symbol: "AAPL", watchConditions: [] },
      ],
    });
    // watchCandidates.length > 0 → hasResults = true → buildEmptyState returns null
    const state = buildEmptyState(search, "RANKED_MCP_EMPTY");
    expect(state).toBeNull(); // not an empty state — watches render normally
  });

  // State C — market unavailable
  it("returns market-unavailable state when data could not be retrieved", () => {
    const state = buildEmptyState(
      makeSearch({ reviewedCount: 4, unavailableCount: 4, qualifiedCount: 0, rejectedCount: 0 }),
      "RANKED_MCP_EMPTY",
    );
    expect(state).not.toBeNull();
    expect(state!.icon).toBe("market-unavailable");
    expect(state!.headline).toMatch(/live market information could not be retrieved/i);
    expect(state!.subtitle).toMatch(/unavailable/i);
    expect(state!.cta.some((c) => c.label === "Retry")).toBe(true);
  });

  // State D — fallback
  it("returns fallback state for RANKED_MCP_FAILED_WITH_FALLBACK source", () => {
    const state = buildEmptyState(makeSearch(), "RANKED_MCP_FAILED_WITH_FALLBACK");
    expect(state).not.toBeNull();
    expect(state!.icon).toBe("fallback");
    expect(state!.headline).toMatch(/ranking temporarily unavailable/i);
    expect(state!.subtitle).toMatch(/standard opportunity search/i);
    expect(state!.cta.some((c) => c.label === "Retry")).toBe(true);
  });

  // No empty state when there are candidates
  it("returns null when search has qualified candidates", () => {
    const search = makeSearch({
      qualifiedCount: 1,
      candidates: [
        {
          rank: 1,
          symbol: "NVDA",
          whySelected: ["Strong VCP"],
          warnings: [],
        },
      ],
    });
    const state = buildEmptyState(search, "RANKED_MCP_SUCCESS");
    expect(state).toBeNull();
  });

  it("returns null when search payload is undefined", () => {
    const state = buildEmptyState(undefined, "RANKED_MCP_EMPTY");
    expect(state).toBeNull();
  });

  // CTAs are always present for every non-null state
  it("every non-null state has at least one CTA", () => {
    const states = [
      buildEmptyState(makeSearch({ reviewedCount: 0 }), "RANKED_MCP_EMPTY"),
      buildEmptyState(makeSearch({ reviewedCount: 3, rejectedCount: 3, qualifiedCount: 0 }), "RANKED_MCP_EMPTY"),
      buildEmptyState(makeSearch({ reviewedCount: 2, unavailableCount: 2, qualifiedCount: 0, rejectedCount: 0 }), "RANKED_MCP_EMPTY"),
      buildEmptyState(makeSearch(), "RANKED_MCP_FAILED_WITH_FALLBACK"),
    ];
    for (const s of states) {
      expect(s).not.toBeNull();
      expect(s!.cta.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// translateRejectionReason — no internal wording
// ---------------------------------------------------------------------------

describe("translateRejectionReason", () => {
  it("maps WAITING_FOR_TRIGGER to trader language", () => {
    expect(translateRejectionReason("WAITING_FOR_TRIGGER")).toBe("Trigger not yet reached");
  });

  it("maps EARNINGS_RISK to trader language", () => {
    expect(translateRejectionReason("EARNINGS_RISK")).toBe("Earnings event pending");
  });

  it("maps UNDERLYING_MARKET_DATA_UNAVAILABLE to safe language", () => {
    expect(translateRejectionReason("UNDERLYING_MARKET_DATA_UNAVAILABLE")).not.toMatch(/underlying/i);
    expect(translateRejectionReason("UNDERLYING_MARKET_DATA_UNAVAILABLE")).toMatch(/required market confirmation/i);
  });

  it("maps DATA_UNAVAILABLE to safe language (no internal wording)", () => {
    const result = translateRejectionReason("DATA_UNAVAILABLE");
    expect(result).not.toMatch(/underlying/i);
    expect(result).toMatch(/required market confirmation/i);
  });

  it("maps RISK_LIMIT_EXCEEDED correctly", () => {
    expect(translateRejectionReason("RISK_LIMIT_EXCEEDED")).toBe("Exceeds risk limit");
  });

  it("handles reason codes with per-symbol suffix (e.g. EARNINGS_RISK:NVDA)", () => {
    const result = translateRejectionReason("EARNINGS_RISK:NVDA");
    expect(result).toBe("Earnings event pending");
  });

  it("humanizes unknown codes without exposing raw snake_case", () => {
    const result = translateRejectionReason("CUSTOM_UNKNOWN_REASON");
    expect(result).not.toContain("_");
    expect(result).toBe("Custom Unknown Reason");
  });

  it("maps OPTIONS_DATA_UNAVAILABLE to safe language", () => {
    expect(translateRejectionReason("OPTIONS_DATA_UNAVAILABLE")).toBe("Options data unavailable");
  });

  it("maps MARKET_REGIME_UNAVAILABLE to safe language", () => {
    expect(translateRejectionReason("MARKET_REGIME_UNAVAILABLE")).toBe("Market regime unavailable");
  });

  it("maps DATA_FRESHNESS_INSUFFICIENT to safe language", () => {
    expect(translateRejectionReason("DATA_FRESHNESS_INSUFFICIENT")).toBe("Data freshness insufficient");
  });
});

// ---------------------------------------------------------------------------
// actionableHint — what would make it actionable
// ---------------------------------------------------------------------------

describe("actionableHint", () => {
  it("returns a trigger hint for WAITING_FOR_TRIGGER", () => {
    const hint = actionableHint("WAITING_FOR_TRIGGER");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/trigger/i);
  });

  it("returns an earnings hint for EARNINGS_RISK", () => {
    const hint = actionableHint("EARNINGS_RISK");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/earnings/i);
  });

  it("returns a risk-budget hint for RISK_LIMIT_EXCEEDED", () => {
    const hint = actionableHint("RISK_LIMIT_EXCEEDED");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/risk/i);
  });

  it("strips per-symbol suffix before matching (EARNINGS_RISK:NVDA)", () => {
    const hint = actionableHint("EARNINGS_RISK:NVDA");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/earnings/i);
  });

  it("returns null for completely unknown codes", () => {
    const hint = actionableHint("COMPLETELY_UNKNOWN_CODE_XYZ");
    expect(hint).toBeNull();
  });

  it("returns a broker/options hint for OPTIONS_DATA_UNAVAILABLE", () => {
    const hint = actionableHint("OPTIONS_DATA_UNAVAILABLE");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/options/i);
  });

  it("never returns an empty string (either a real hint or null)", () => {
    const codes = [
      "WAITING_FOR_TRIGGER",
      "EARNINGS_RISK",
      "RISK_LIMIT_EXCEEDED",
      "STALE_SETUP",
      "DATA_UNAVAILABLE",
      "DIRECTION_CONFLICT",
      "NO_VALID_SETUP",
    ];
    for (const code of codes) {
      const hint = actionableHint(code);
      expect(hint === null || hint.length > 0).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// translateExclusionReason — existing function, regression test
// ---------------------------------------------------------------------------

describe("translateExclusionReason", () => {
  it("translates NOT_ACTIONABLE_NO_TRIGGER", () => {
    expect(translateExclusionReason("NOT_ACTIONABLE_NO_TRIGGER")).toMatch(/trigger/i);
  });

  it("translates STALE", () => {
    expect(translateExclusionReason("STALE")).toMatch(/stale/i);
  });

  it("humanizes unknown codes without raw underscores", () => {
    const result = translateExclusionReason("UNKNOWN_CODE");
    expect(result).not.toContain("_");
  });
});

// ---------------------------------------------------------------------------
// Empty state headline coherence — no contradictory statements
// ---------------------------------------------------------------------------

describe("empty state consistency", () => {
  it("RANKED_MCP_FAILED_WITH_FALLBACK always returns fallback state regardless of search data", () => {
    const searchWithData = makeSearch({ reviewedCount: 10, qualifiedCount: 0, rejectedCount: 10 });
    const state = buildEmptyState(searchWithData, "RANKED_MCP_FAILED_WITH_FALLBACK");
    expect(state!.icon).toBe("fallback");
  });

  it("success source with no candidates returns a non-fallback state", () => {
    const state = buildEmptyState(makeSearch({ reviewedCount: 0 }), "RANKED_MCP_EMPTY");
    expect(state!.icon).not.toBe("fallback");
  });

  it("B state headline includes the total count", () => {
    const state = buildEmptyState(
      makeSearch({ reviewedCount: 5, rejectedCount: 3, excludedCount: 2, qualifiedCount: 0 }),
      "RANKED_MCP_EMPTY",
    );
    expect(state!.headline).toMatch(/5/);
  });
});
