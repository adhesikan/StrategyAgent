// Sprint 4.2 — Portfolio Fit display helper tests.
// Pure-function tests — no React, no DOM, no server calls.
//
// Covers: portfolioFitRows, isBrokerConnected, hasExistingPosition,
//         concentrationSummary, portfolioFitState,
//         CONCENTRATION_LEVEL_CLASS, SUFFICIENCY_CLASS, SUFFICIENCY_LABEL.

import { describe, it, expect } from "vitest";
import {
  CONCENTRATION_LEVEL_CLASS,
  concentrationSummary,
  hasExistingPosition,
  isBrokerConnected,
  portfolioFitRows,
  portfolioFitState,
  SUFFICIENCY_CLASS,
  SUFFICIENCY_LABEL,
  type PortfolioFitRow,
} from "./portfolio-fit-display";
import type { SafePortfolioAwareness } from "./portfolio-awareness";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAwareness(
  overrides: Partial<SafePortfolioAwareness> = {},
): SafePortfolioAwareness {
  return {
    contextFreshness: new Date("2026-08-04T15:00:00Z").toISOString(),
    ...overrides,
  };
}

function rowByTestId(rows: PortfolioFitRow[], testId: string) {
  return rows.find((r) => r.testId === testId);
}

// ---------------------------------------------------------------------------
// isBrokerConnected
// ---------------------------------------------------------------------------

describe("isBrokerConnected", () => {
  it("returns false when awareness is undefined", () => {
    expect(isBrokerConnected(undefined)).toBe(false);
  });

  it("returns false when awareness is null", () => {
    expect(isBrokerConnected(null)).toBe(false);
  });

  it("returns true when awareness is an object (even minimal)", () => {
    expect(isBrokerConnected(makeAwareness())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasExistingPosition
// ---------------------------------------------------------------------------

describe("hasExistingPosition", () => {
  it("false when awareness is null", () => {
    expect(hasExistingPosition(null)).toBe(false);
  });

  it("false when no position fields present", () => {
    expect(hasExistingPosition(makeAwareness())).toBe(false);
  });

  it("true when existingPosition is set", () => {
    expect(
      hasExistingPosition(makeAwareness({ existingPosition: { shares: 100, unrealizedPnl: 250 } })),
    ).toBe(true);
  });

  it("true when verifiedShares > 0", () => {
    expect(hasExistingPosition(makeAwareness({ verifiedShares: 50 }))).toBe(true);
  });

  it("false when verifiedShares is 0", () => {
    expect(hasExistingPosition(makeAwareness({ verifiedShares: 0 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// concentrationSummary
// ---------------------------------------------------------------------------

describe("concentrationSummary", () => {
  it("returns null when awareness is null", () => {
    expect(concentrationSummary(null)).toBeNull();
  });

  it("returns null when no concentrationWarning", () => {
    expect(concentrationSummary(makeAwareness())).toBeNull();
  });

  it("normal level — no risk qualifier", () => {
    const summary = concentrationSummary(
      makeAwareness({ concentrationWarning: { pct: 5.0, level: "normal" } }),
    );
    expect(summary).toBe("5% portfolio allocation");
  });

  it("elevated level — includes 'elevated' qualifier", () => {
    const summary = concentrationSummary(
      makeAwareness({ concentrationWarning: { pct: 14.2, level: "elevated" } }),
    );
    expect(summary).toBe("14.2% portfolio allocation — elevated");
  });

  it("high level — includes 'high' qualifier", () => {
    const summary = concentrationSummary(
      makeAwareness({ concentrationWarning: { pct: 21.0, level: "high" } }),
    );
    expect(summary).toBe("21% portfolio allocation — high");
  });
});

// ---------------------------------------------------------------------------
// CONCENTRATION_LEVEL_CLASS
// ---------------------------------------------------------------------------

describe("CONCENTRATION_LEVEL_CLASS", () => {
  it("normal uses emerald", () => {
    expect(CONCENTRATION_LEVEL_CLASS.normal).toContain("emerald");
  });

  it("elevated uses amber", () => {
    expect(CONCENTRATION_LEVEL_CLASS.elevated).toContain("amber");
  });

  it("high uses red", () => {
    expect(CONCENTRATION_LEVEL_CLASS.high).toContain("red");
  });
});

// ---------------------------------------------------------------------------
// SUFFICIENCY_LABEL and SUFFICIENCY_CLASS
// ---------------------------------------------------------------------------

describe("SUFFICIENCY_LABEL", () => {
  it("verified → 'Verified'", () => expect(SUFFICIENCY_LABEL.verified).toBe("Verified"));
  it("sufficient → 'Sufficient'", () => expect(SUFFICIENCY_LABEL.sufficient).toBe("Sufficient"));
  it("not_verified → 'Not verified'", () => expect(SUFFICIENCY_LABEL.not_verified).toBe("Not verified"));
  it("insufficient → 'Insufficient'", () => expect(SUFFICIENCY_LABEL.insufficient).toBe("Insufficient"));
  it("unknown → 'Unknown'", () => expect(SUFFICIENCY_LABEL.unknown).toBe("Unknown"));
});

describe("SUFFICIENCY_CLASS", () => {
  it("verified uses emerald", () => expect(SUFFICIENCY_CLASS.verified).toContain("emerald"));
  it("sufficient uses emerald", () => expect(SUFFICIENCY_CLASS.sufficient).toContain("emerald"));
  it("not_verified uses amber", () => expect(SUFFICIENCY_CLASS.not_verified).toContain("amber"));
  it("insufficient uses red", () => expect(SUFFICIENCY_CLASS.insufficient).toContain("red"));
  it("unknown uses muted", () => expect(SUFFICIENCY_CLASS.unknown).toContain("muted"));
});

// ---------------------------------------------------------------------------
// portfolioFitRows — null / undefined awareness
// ---------------------------------------------------------------------------

describe("portfolioFitRows — null/undefined awareness", () => {
  it("returns empty array when awareness is undefined", () => {
    expect(portfolioFitRows(undefined)).toEqual([]);
  });

  it("returns empty array when awareness is null", () => {
    expect(portfolioFitRows(null)).toEqual([]);
  });

  it("returns empty array when awareness has no meaningful fields", () => {
    expect(portfolioFitRows(makeAwareness())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Existing Position row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Existing Position", () => {
  it("shows existing position when existingPosition is set", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingPosition: { shares: 200, unrealizedPnl: 0 } }),
    );
    const row = rowByTestId(rows, "row-pf-existing-position");
    expect(row).toBeDefined();
    expect(row!.label).toBe("Existing Position");
    expect(row!.value).toContain("200");
    expect(row!.value).toContain("shares");
  });

  it("includes P&L in value when unrealizedPnl is non-zero positive", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingPosition: { shares: 100, unrealizedPnl: 500 } }),
    );
    const row = rowByTestId(rows, "row-pf-existing-position");
    expect(row!.value).toContain("+");
    expect(row!.value).toContain("P&L");
  });

  it("includes P&L in value when unrealizedPnl is non-zero negative", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingPosition: { shares: 100, unrealizedPnl: -200 } }),
    );
    const row = rowByTestId(rows, "row-pf-existing-position");
    expect(row!.value).toContain("P&L");
    expect(row!.value).not.toContain("+"); // negative — no leading +
  });

  it("omits P&L suffix when unrealizedPnl is exactly 0", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingPosition: { shares: 100, unrealizedPnl: 0 } }),
    );
    const row = rowByTestId(rows, "row-pf-existing-position");
    expect(row!.value).not.toContain("P&L");
  });

  it("isAlert is true for existing position row", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingPosition: { shares: 100, unrealizedPnl: 0 } }),
    );
    expect(rowByTestId(rows, "row-pf-existing-position")!.isAlert).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Current Shares row (verifiedShares fallback)
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Current Shares", () => {
  it("shows verifiedShares when existingPosition is absent", () => {
    const rows = portfolioFitRows(makeAwareness({ verifiedShares: 50 }));
    const row = rowByTestId(rows, "row-pf-verified-shares");
    expect(row).toBeDefined();
    expect(row!.value).toContain("50");
  });

  it("does NOT show verifiedShares row when existingPosition is already shown (deduplication)", () => {
    const rows = portfolioFitRows(
      makeAwareness({
        existingPosition: { shares: 200, unrealizedPnl: 0 },
        verifiedShares: 200,
      }),
    );
    expect(rowByTestId(rows, "row-pf-verified-shares")).toBeUndefined();
    expect(rowByTestId(rows, "row-pf-existing-position")).toBeDefined();
  });

  it("does NOT show verifiedShares row when verifiedShares is 0", () => {
    const rows = portfolioFitRows(makeAwareness({ verifiedShares: 0 }));
    expect(rowByTestId(rows, "row-pf-verified-shares")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Portfolio Concentration row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Portfolio Concentration", () => {
  it("shows concentration when concentrationWarning is set", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 8.5, level: "normal" } }),
    );
    const row = rowByTestId(rows, "row-pf-concentration");
    expect(row).toBeDefined();
    expect(row!.value).toBe("8.5%");
    expect(row!.label).toBe("Portfolio Concentration");
  });

  it("badgeClass is emerald for normal level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 5.0, level: "normal" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.badgeClass).toContain("emerald");
  });

  it("badgeClass is amber for elevated level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 14.0, level: "elevated" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.badgeClass).toContain("amber");
  });

  it("badgeClass is red for high level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 22.0, level: "high" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.badgeClass).toContain("red");
  });

  it("isAlert is false for normal level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 3.0, level: "normal" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.isAlert).toBe(false);
  });

  it("isAlert is true for elevated level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 15.0, level: "elevated" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.isAlert).toBe(true);
  });

  it("isAlert is true for high level", () => {
    const rows = portfolioFitRows(
      makeAwareness({ concentrationWarning: { pct: 25.0, level: "high" } }),
    );
    expect(rowByTestId(rows, "row-pf-concentration")!.isAlert).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Buying Power row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Buying Power", () => {
  it("shows buying power when buyingPowerSufficiency is 'sufficient'", () => {
    const rows = portfolioFitRows(
      makeAwareness({ buyingPowerSufficiency: "sufficient" }),
    );
    const row = rowByTestId(rows, "row-pf-buying-power");
    expect(row).toBeDefined();
    expect(row!.value).toBe("Sufficient");
    expect(row!.isAlert).toBe(false);
  });

  it("shows buying power when buyingPowerSufficiency is 'insufficient'", () => {
    const rows = portfolioFitRows(
      makeAwareness({ buyingPowerSufficiency: "insufficient" }),
    );
    const row = rowByTestId(rows, "row-pf-buying-power");
    expect(row!.value).toBe("Insufficient");
    expect(row!.isAlert).toBe(true);
  });

  it("shows 'Unknown' honestly when buyingPowerSufficiency is 'unknown' — no fabrication", () => {
    const rows = portfolioFitRows(
      makeAwareness({ buyingPowerSufficiency: "unknown" }),
    );
    const row = rowByTestId(rows, "row-pf-buying-power");
    expect(row).toBeDefined();
    expect(row!.value).toBe("Unknown");
  });

  it("omits buying power row when buyingPowerSufficiency is undefined", () => {
    expect(rowByTestId(portfolioFitRows(makeAwareness()), "row-pf-buying-power")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Cash Available row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Cash Available", () => {
  it("shows 'Verified' when cashSufficiency is 'verified'", () => {
    const rows = portfolioFitRows(makeAwareness({ cashSufficiency: "verified" }));
    expect(rowByTestId(rows, "row-pf-cash")!.value).toBe("Verified");
  });

  it("shows 'Not verified' honestly", () => {
    const rows = portfolioFitRows(makeAwareness({ cashSufficiency: "not_verified" }));
    expect(rowByTestId(rows, "row-pf-cash")!.value).toBe("Not verified");
  });

  it("shows 'Insufficient' and marks isAlert", () => {
    const rows = portfolioFitRows(makeAwareness({ cashSufficiency: "insufficient" }));
    const row = rowByTestId(rows, "row-pf-cash");
    expect(row!.value).toBe("Insufficient");
    expect(row!.isAlert).toBe(true);
  });

  it("shows 'Unknown' honestly — not fabricated", () => {
    const rows = portfolioFitRows(makeAwareness({ cashSufficiency: "unknown" }));
    expect(rowByTestId(rows, "row-pf-cash")!.value).toBe("Unknown");
  });

  it("omits cash row when cashSufficiency is undefined", () => {
    expect(rowByTestId(portfolioFitRows(makeAwareness()), "row-pf-cash")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Existing Options row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Existing Options", () => {
  it("shows existing options when existingOptionExposure is a string", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingOptionExposure: "Covered call — 190 strike" }),
    );
    const row = rowByTestId(rows, "row-pf-options");
    expect(row).toBeDefined();
    expect(row!.value).toBe("Covered call — 190 strike");
  });

  it("shows 'None detected' when existingOptionExposure is explicitly null", () => {
    const rows = portfolioFitRows(
      makeAwareness({ existingOptionExposure: null }),
    );
    const row = rowByTestId(rows, "row-pf-options");
    expect(row).toBeDefined();
    expect(row!.value).toBe("None detected");
  });

  it("omits options row entirely when existingOptionExposure is undefined", () => {
    const rows = portfolioFitRows(makeAwareness());
    expect(rowByTestId(rows, "row-pf-options")).toBeUndefined();
  });

  it("valueClass is muted when 'None detected'", () => {
    const rows = portfolioFitRows(makeAwareness({ existingOptionExposure: null }));
    expect(rowByTestId(rows, "row-pf-options")!.valueClass).toContain("muted");
  });

  it("valueClass is font-medium when options string is present", () => {
    const rows = portfolioFitRows(makeAwareness({ existingOptionExposure: "Long put" }));
    expect(rowByTestId(rows, "row-pf-options")!.valueClass).toContain("font-medium");
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Suggested Position Size
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Suggested Position Size", () => {
  it("shows suggested size when suggestedQuantity is provided", () => {
    const rows = portfolioFitRows(makeAwareness(), 150);
    const row = rowByTestId(rows, "row-pf-suggested-size");
    expect(row).toBeDefined();
    expect(row!.value).toContain("150");
    expect(row!.value).toContain("shares");
  });

  it("omits size row when suggestedQuantity is undefined", () => {
    expect(rowByTestId(portfolioFitRows(makeAwareness()), "row-pf-suggested-size")).toBeUndefined();
  });

  it("isAlert is false for suggested size row", () => {
    const row = rowByTestId(portfolioFitRows(makeAwareness(), 100), "row-pf-suggested-size");
    expect(row!.isAlert).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — Adjustment Reason row
// ---------------------------------------------------------------------------

describe("portfolioFitRows — Adjustment Reason", () => {
  it("shows adjustment reason when sizingAdjustment is a string", () => {
    const rows = portfolioFitRows(
      makeAwareness({ sizingAdjustment: "Suggested size reduced due to existing 200-share position" }),
    );
    const row = rowByTestId(rows, "row-pf-adjustment-reason");
    expect(row).toBeDefined();
    expect(row!.value).toContain("reduced");
    expect(row!.isAlert).toBe(true);
  });

  it("omits adjustment row when sizingAdjustment is null", () => {
    const rows = portfolioFitRows(makeAwareness({ sizingAdjustment: null }));
    expect(rowByTestId(rows, "row-pf-adjustment-reason")).toBeUndefined();
  });

  it("omits adjustment row when sizingAdjustment is undefined", () => {
    expect(rowByTestId(portfolioFitRows(makeAwareness()), "row-pf-adjustment-reason")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — row ordering
// ---------------------------------------------------------------------------

describe("portfolioFitRows — ordering", () => {
  it("Existing Position appears before Concentration", () => {
    const rows = portfolioFitRows(
      makeAwareness({
        existingPosition: { shares: 100, unrealizedPnl: 0 },
        concentrationWarning: { pct: 12.0, level: "elevated" },
      }),
    );
    const posIdx = rows.findIndex((r) => r.testId === "row-pf-existing-position");
    const concIdx = rows.findIndex((r) => r.testId === "row-pf-concentration");
    expect(posIdx).toBeLessThan(concIdx);
  });

  it("Buying Power appears before Cash Available", () => {
    const rows = portfolioFitRows(
      makeAwareness({
        buyingPowerSufficiency: "sufficient",
        cashSufficiency: "verified",
      }),
    );
    const bpIdx = rows.findIndex((r) => r.testId === "row-pf-buying-power");
    const cashIdx = rows.findIndex((r) => r.testId === "row-pf-cash");
    expect(bpIdx).toBeLessThan(cashIdx);
  });

  it("Suggested Position Size appears before Adjustment Reason", () => {
    const rows = portfolioFitRows(
      makeAwareness({ sizingAdjustment: "Size reduced due to position" }),
      200,
    );
    const sizeIdx = rows.findIndex((r) => r.testId === "row-pf-suggested-size");
    const adjIdx = rows.findIndex((r) => r.testId === "row-pf-adjustment-reason");
    expect(sizeIdx).toBeLessThan(adjIdx);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitRows — full example (spec scenario)
// ---------------------------------------------------------------------------

describe("portfolioFitRows — full spec scenario", () => {
  it("scenario: already own 200 shares, size reduced, buying power sufficient", () => {
    const rows = portfolioFitRows(
      makeAwareness({
        existingPosition: { shares: 200, unrealizedPnl: 1200 },
        verifiedShares: 200,
        duplicateExposure: true,
        concentrationWarning: { pct: 15.0, level: "elevated" },
        buyingPowerSufficiency: "sufficient",
        cashSufficiency: "verified",
        existingOptionExposure: null,
        sizingAdjustment: "Suggested size reduced due to existing 200-share position",
      }),
      100,
    );

    // Verify key rows are present
    expect(rowByTestId(rows, "row-pf-existing-position")).toBeDefined();
    expect(rowByTestId(rows, "row-pf-concentration")).toBeDefined();
    expect(rowByTestId(rows, "row-pf-buying-power")).toBeDefined();
    expect(rowByTestId(rows, "row-pf-cash")).toBeDefined();
    expect(rowByTestId(rows, "row-pf-options")).toBeDefined(); // null → "None detected"
    expect(rowByTestId(rows, "row-pf-suggested-size")).toBeDefined();
    expect(rowByTestId(rows, "row-pf-adjustment-reason")).toBeDefined();

    // Verify values
    expect(rowByTestId(rows, "row-pf-existing-position")!.value).toContain("200");
    expect(rowByTestId(rows, "row-pf-concentration")!.value).toBe("15%");
    expect(rowByTestId(rows, "row-pf-buying-power")!.value).toBe("Sufficient");
    expect(rowByTestId(rows, "row-pf-options")!.value).toBe("None detected");
    expect(rowByTestId(rows, "row-pf-adjustment-reason")!.value).toContain("reduced");

    // Verify alerts
    expect(rowByTestId(rows, "row-pf-existing-position")!.isAlert).toBe(true);
    expect(rowByTestId(rows, "row-pf-concentration")!.isAlert).toBe(true); // elevated
    expect(rowByTestId(rows, "row-pf-buying-power")!.isAlert).toBe(false); // sufficient
    expect(rowByTestId(rows, "row-pf-adjustment-reason")!.isAlert).toBe(true);
  });

  it("scenario: no brokerage connected → empty rows", () => {
    expect(portfolioFitRows(null)).toEqual([]);
    expect(portfolioFitRows(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// portfolioFitState
// ---------------------------------------------------------------------------

describe("portfolioFitState", () => {
  it("'hidden' when awareness is undefined", () => {
    expect(portfolioFitState(undefined)).toBe("hidden");
  });

  it("'disconnected' when awareness is null", () => {
    expect(portfolioFitState(null)).toBe("disconnected");
  });

  it("'no-position' when awareness is present but has no meaningful rows", () => {
    expect(portfolioFitState(makeAwareness())).toBe("no-position");
  });

  it("'show' when there is at least one row", () => {
    expect(
      portfolioFitState(makeAwareness({ buyingPowerSufficiency: "sufficient" })),
    ).toBe("show");
  });

  it("'show' when suggestedQuantity is provided (even with empty awareness)", () => {
    expect(portfolioFitState(makeAwareness(), 100)).toBe("show");
  });
});

// ---------------------------------------------------------------------------
// No fabrication / honest unknowns — regression guard
// ---------------------------------------------------------------------------

describe("no fabrication / honest unknowns", () => {
  it("never returns a row with an empty value", () => {
    const rows = portfolioFitRows(
      makeAwareness({
        existingPosition: { shares: 100, unrealizedPnl: 0 },
        concentrationWarning: { pct: 10.0, level: "elevated" },
        buyingPowerSufficiency: "unknown",
        cashSufficiency: "not_verified",
        existingOptionExposure: null,
        sizingAdjustment: "Size adjusted",
      }),
      50,
    );
    for (const row of rows) {
      expect(row.value.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows 'Unknown' for unknown buying power — not blank", () => {
    const rows = portfolioFitRows(makeAwareness({ buyingPowerSufficiency: "unknown" }));
    expect(rowByTestId(rows, "row-pf-buying-power")!.value).toBe("Unknown");
    expect(rowByTestId(rows, "row-pf-buying-power")!.value).not.toBe("—");
  });

  it("shows 'Unknown' for unknown cash sufficiency — not blank", () => {
    const rows = portfolioFitRows(makeAwareness({ cashSufficiency: "unknown" }));
    expect(rowByTestId(rows, "row-pf-cash")!.value).toBe("Unknown");
  });

  it("'None detected' is only shown when existingOptionExposure is explicitly null, not when absent", () => {
    // absent (undefined) → no row
    expect(rowByTestId(portfolioFitRows(makeAwareness()), "row-pf-options")).toBeUndefined();
    // explicit null → row with 'None detected'
    const rows = portfolioFitRows(makeAwareness({ existingOptionExposure: null }));
    expect(rowByTestId(rows, "row-pf-options")!.value).toBe("None detected");
  });
});
