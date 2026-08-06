// Tests for Sprint 2.1.2 — Professional Research Trade Cards
//
// Covers: all exported pure functions across component files.
// No DOM rendering required — all tested logic is deterministic.

import { describe, it, expect } from "vitest";
import { deriveHoldingPeriod } from "./stock-trade-card";
import {
  shouldShowOptionsCard,
  deriveOptionsProbability,
  deriveOptionsExpirationTarget,
  deriveOptionsPaymentType,
  deriveOptionsMaxGain,
} from "./options-trade-card";
import {
  evidenceSignalLabel,
  evidenceSignalClass,
  evidenceSignalTextClass,
} from "./evidence-card";

// ---------------------------------------------------------------------------
// deriveHoldingPeriod
// ---------------------------------------------------------------------------

describe("deriveHoldingPeriod", () => {
  it("returns intraday for ORB strategy", () => {
    expect(deriveHoldingPeriod("ORB5")).toMatch(/intraday/i);
    expect(deriveHoldingPeriod("ORB15")).toMatch(/intraday/i);
  });

  it("returns intraday for INTRADAY strategy", () => {
    expect(deriveHoldingPeriod("INTRADAY_MOMENTUM")).toMatch(/intraday/i);
  });

  it("returns intraday for GAP_AND_GO", () => {
    expect(deriveHoldingPeriod("GAP_AND_GO")).toMatch(/intraday/i);
  });

  it("returns swing for VCP strategy", () => {
    expect(deriveHoldingPeriod("VCP")).toMatch(/swing/i);
  });

  it("returns swing for SWING strategy", () => {
    expect(deriveHoldingPeriod("SWING_TRADE")).toMatch(/swing/i);
  });

  it("returns swing for PULLBACK strategy", () => {
    expect(deriveHoldingPeriod("PULLBACK")).toMatch(/swing/i);
  });

  it("returns position for TREND strategy", () => {
    expect(deriveHoldingPeriod("TREND_FOLLOWING")).toMatch(/position/i);
  });

  it("returns swing as default for unknown strategy", () => {
    expect(deriveHoldingPeriod("UNKNOWN_XYZ")).toMatch(/swing/i);
  });

  it("returns fallback when strategy is undefined", () => {
    const result = deriveHoldingPeriod(undefined);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// shouldShowOptionsCard
// ---------------------------------------------------------------------------

describe("shouldShowOptionsCard", () => {
  it("returns false when both fields are absent", () => {
    expect(shouldShowOptionsCard({})).toBe(false);
  });

  it("returns false for stock instrument", () => {
    expect(shouldShowOptionsCard({ instrument: "STOCK" })).toBe(false);
  });

  it("returns false for empty structure", () => {
    expect(shouldShowOptionsCard({ structure: "" })).toBe(false);
  });

  it("returns true when instrument is 'options'", () => {
    expect(shouldShowOptionsCard({ instrument: "options" })).toBe(true);
  });

  it("returns true when instrument is 'OPTION'", () => {
    expect(shouldShowOptionsCard({ instrument: "OPTION" })).toBe(true);
  });

  it("returns true when structure contains 'call'", () => {
    expect(shouldShowOptionsCard({ structure: "Long Call" })).toBe(true);
  });

  it("returns true when structure contains 'put'", () => {
    expect(shouldShowOptionsCard({ structure: "Cash-Secured Put" })).toBe(true);
  });

  it("returns true when structure contains 'spread'", () => {
    expect(shouldShowOptionsCard({ structure: "Bull Call Spread" })).toBe(true);
  });

  it("returns true when structure contains 'covered'", () => {
    expect(shouldShowOptionsCard({ structure: "Covered Call" })).toBe(true);
  });

  it("returns false for 'Long Stock'", () => {
    expect(shouldShowOptionsCard({ structure: "Long Stock" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveOptionsProbability
// ---------------------------------------------------------------------------

describe("deriveOptionsProbability", () => {
  it("returns high range for high confidence", () => {
    const result = deriveOptionsProbability("high");
    expect(result).toContain("60");
    expect(result).toContain("70");
  });

  it("returns medium range for medium confidence", () => {
    const result = deriveOptionsProbability("medium");
    expect(result).toContain("40");
    expect(result).toContain("55");
  });

  it("returns low range for low confidence", () => {
    const result = deriveOptionsProbability("low");
    expect(result).toContain("25");
    expect(result).toContain("40");
  });

  it("returns broker verify for unknown confidence", () => {
    expect(deriveOptionsProbability(undefined)).toMatch(/broker/i);
    expect(deriveOptionsProbability("")).toMatch(/broker/i);
    expect(deriveOptionsProbability("very high")).toMatch(/broker/i);
  });

  it("is case-insensitive", () => {
    expect(deriveOptionsProbability("HIGH")).toContain("60");
    expect(deriveOptionsProbability("Medium")).toContain("40");
  });
});

// ---------------------------------------------------------------------------
// deriveOptionsExpirationTarget
// ---------------------------------------------------------------------------

describe("deriveOptionsExpirationTarget", () => {
  it("returns 0-1 DTE for ORB strategies", () => {
    expect(deriveOptionsExpirationTarget("ORB5")).toContain("0–1 DTE");
  });

  it("returns 0-1 DTE for GAP_AND_GO", () => {
    expect(deriveOptionsExpirationTarget("GAP_AND_GO")).toContain("0–1 DTE");
  });

  it("returns 21-45 DTE for VCP", () => {
    expect(deriveOptionsExpirationTarget("VCP")).toContain("21–45 DTE");
  });

  it("returns 21-45 DTE for SWING", () => {
    expect(deriveOptionsExpirationTarget("SWING_TRADE")).toContain("21–45 DTE");
  });

  it("returns 45-90 DTE for POSITION", () => {
    expect(deriveOptionsExpirationTarget("POSITION_TRADE")).toContain("45–90 DTE");
  });

  it("returns a default for unknown strategy", () => {
    const result = deriveOptionsExpirationTarget(undefined);
    expect(typeof result).toBe("string");
    expect(result).toContain("DTE");
  });
});

// ---------------------------------------------------------------------------
// deriveOptionsPaymentType
// ---------------------------------------------------------------------------

describe("deriveOptionsPaymentType", () => {
  it("returns credit for cash-secured put", () => {
    expect(deriveOptionsPaymentType("Cash-Secured Put")).toMatch(/credit/i);
  });

  it("returns credit for covered call", () => {
    expect(deriveOptionsPaymentType("Covered Call")).toMatch(/credit/i);
  });

  it("returns debit for long call", () => {
    expect(deriveOptionsPaymentType("Long Call")).toMatch(/debit/i);
  });

  it("returns debit for bull call spread", () => {
    expect(deriveOptionsPaymentType("Bull Call Spread")).toMatch(/debit/i);
  });

  it("returns broker verify for undefined", () => {
    expect(deriveOptionsPaymentType(undefined)).toMatch(/broker/i);
  });
});

// ---------------------------------------------------------------------------
// deriveOptionsMaxGain
// ---------------------------------------------------------------------------

describe("deriveOptionsMaxGain", () => {
  it("returns unlimited for long call", () => {
    expect(deriveOptionsMaxGain("Long Call")).toMatch(/unlimited/i);
  });

  it("returns unlimited for long put", () => {
    expect(deriveOptionsMaxGain("Long Put")).toMatch(/unlimited/i);
  });

  it("returns capped for bull call spread", () => {
    expect(deriveOptionsMaxGain("Bull Call Spread")).toMatch(/capped/i);
  });

  it("returns premium for cash-secured put", () => {
    expect(deriveOptionsMaxGain("Cash-Secured Put")).toMatch(/premium/i);
  });

  it("returns capped for iron condor", () => {
    expect(deriveOptionsMaxGain("Iron Condor")).toMatch(/capped/i);
  });

  it("returns broker verify for undefined", () => {
    expect(deriveOptionsMaxGain(undefined)).toMatch(/broker/i);
  });
});

// ---------------------------------------------------------------------------
// evidenceSignalLabel
// ---------------------------------------------------------------------------

describe("evidenceSignalLabel", () => {
  it("returns Unavailable for 0 stars", () => {
    expect(evidenceSignalLabel(0)).toBe("Unavailable");
  });

  it("returns Weak for 1 star", () => {
    expect(evidenceSignalLabel(1)).toBe("Weak");
  });

  it("returns Limited for 2 stars", () => {
    expect(evidenceSignalLabel(2)).toBe("Limited");
  });

  it("returns Moderate for 3 stars", () => {
    expect(evidenceSignalLabel(3)).toBe("Moderate");
  });

  it("returns Solid for 4 stars", () => {
    expect(evidenceSignalLabel(4)).toBe("Solid");
  });

  it("returns Strong for 5 stars", () => {
    expect(evidenceSignalLabel(5)).toBe("Strong");
  });

  it("returns a non-empty string for all valid star values", () => {
    for (let i = 0; i <= 5; i++) {
      expect(evidenceSignalLabel(i).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// evidenceSignalClass
// ---------------------------------------------------------------------------

describe("evidenceSignalClass", () => {
  it("returns a Tailwind class string for every star level", () => {
    for (let i = 0; i <= 5; i++) {
      const cls = evidenceSignalClass(i);
      expect(typeof cls).toBe("string");
      expect(cls).toContain("bg-");
    }
  });

  it("returns a neutral/muted class for 0 stars", () => {
    expect(evidenceSignalClass(0)).toMatch(/border|muted/);
  });

  it("returns emerald class for 4+ stars", () => {
    expect(evidenceSignalClass(4)).toContain("emerald");
    expect(evidenceSignalClass(5)).toContain("emerald");
  });

  it("returns sky class for 3 stars", () => {
    expect(evidenceSignalClass(3)).toContain("sky");
  });

  it("returns amber class for 2 stars", () => {
    expect(evidenceSignalClass(2)).toContain("amber");
  });

  it("returns rose class for 1 star", () => {
    expect(evidenceSignalClass(1)).toContain("rose");
  });
});

// ---------------------------------------------------------------------------
// evidenceSignalTextClass
// ---------------------------------------------------------------------------

describe("evidenceSignalTextClass", () => {
  it("returns a Tailwind text color for every star level", () => {
    for (let i = 0; i <= 5; i++) {
      const cls = evidenceSignalTextClass(i);
      expect(cls).toContain("text-");
    }
  });

  it("returns muted for 0 stars", () => {
    expect(evidenceSignalTextClass(0)).toMatch(/muted/);
  });

  it("returns emerald for 4+ stars", () => {
    expect(evidenceSignalTextClass(4)).toContain("emerald");
    expect(evidenceSignalTextClass(5)).toContain("emerald");
  });
});
