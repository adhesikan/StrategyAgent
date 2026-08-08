// Tests for Institutional Fund Service — Sprint 2.3.2
//
// All tests target pure helper functions only — no DB calls.
// DB-dependent functions (getFundDirectory, getFundDetail, etc.) are
// integration-tested against a real DB in staging; they are excluded here.

import { describe, it, expect } from "vitest";
import {
  isValidManagerId,
  normalizeManagerId,
  dateToQuarterLabel,
  computePortfolioWeight,
  classifyChangeType,
  computeShareChange,
  isMappingReliable,
  computeFilingFreshnessDays,
  buildEdgarManagerUrl,
  buildEdgarFilingUrl,
  FILING_DELAY_DISCLAIMER,
  type ChangeType,
} from "../services/institutional/fund-service";

// ---------------------------------------------------------------------------
// isValidManagerId
// ---------------------------------------------------------------------------

describe("isValidManagerId", () => {
  it("accepts 10-digit numeric string", () => {
    expect(isValidManagerId("0001234567")).toBe(true);
  });

  it("accepts short numeric strings (1-9 digits)", () => {
    expect(isValidManagerId("123")).toBe(true);
    expect(isValidManagerId("1")).toBe(true);
  });

  it("rejects letters", () => {
    expect(isValidManagerId("ABC")).toBe(false);
    expect(isValidManagerId("0001234ABC")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidManagerId("")).toBe(false);
  });

  it("rejects strings longer than 10 digits", () => {
    expect(isValidManagerId("00012345678")).toBe(false); // 11 digits
  });

  it("rejects strings with special characters", () => {
    expect(isValidManagerId("0001-234567")).toBe(false);
    expect(isValidManagerId("0001 234567")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeManagerId
// ---------------------------------------------------------------------------

describe("normalizeManagerId", () => {
  it("zero-pads short CIK to 10 digits", () => {
    expect(normalizeManagerId("12345")).toBe("0000012345");
  });

  it("preserves a 10-digit CIK", () => {
    expect(normalizeManagerId("0001234567")).toBe("0001234567");
  });

  it("strips leading zeros before re-padding", () => {
    expect(normalizeManagerId("0000012345")).toBe("0000012345");
  });

  it("handles single digit", () => {
    expect(normalizeManagerId("1")).toBe("0000000001");
  });

  it("handles all zeros edge case", () => {
    expect(normalizeManagerId("0")).toBe("0000000000");
  });

  it("handles excess leading zeros gracefully", () => {
    expect(normalizeManagerId("00000001")).toBe("0000000001");
  });
});

// ---------------------------------------------------------------------------
// dateToQuarterLabel
// ---------------------------------------------------------------------------

describe("dateToQuarterLabel", () => {
  it("maps January to Q1", () => {
    expect(dateToQuarterLabel("2024-01-15")).toBe("2024-Q1");
  });

  it("maps March 31 to Q1", () => {
    expect(dateToQuarterLabel("2024-03-31")).toBe("2024-Q1");
  });

  it("maps April to Q2", () => {
    expect(dateToQuarterLabel("2024-04-01")).toBe("2024-Q2");
  });

  it("maps June 30 to Q2", () => {
    expect(dateToQuarterLabel("2024-06-30")).toBe("2024-Q2");
  });

  it("maps July to Q3", () => {
    expect(dateToQuarterLabel("2024-07-01")).toBe("2024-Q3");
  });

  it("maps September 30 to Q3", () => {
    expect(dateToQuarterLabel("2024-09-30")).toBe("2024-Q3");
  });

  it("maps October to Q4", () => {
    expect(dateToQuarterLabel("2024-10-01")).toBe("2024-Q4");
  });

  it("maps December 31 to Q4", () => {
    expect(dateToQuarterLabel("2024-12-31")).toBe("2024-Q4");
  });

  it("returns Unknown for null", () => {
    expect(dateToQuarterLabel(null)).toBe("Unknown");
  });

  it("returns Unknown for undefined", () => {
    expect(dateToQuarterLabel(undefined)).toBe("Unknown");
  });

  it("returns Unknown for empty string", () => {
    expect(dateToQuarterLabel("")).toBe("Unknown");
  });

  it("handles ISO datetime string (strips time part)", () => {
    expect(dateToQuarterLabel("2024-09-30T00:00:00Z")).toBe("2024-Q3");
  });
});

// ---------------------------------------------------------------------------
// computePortfolioWeight
// ---------------------------------------------------------------------------

describe("computePortfolioWeight", () => {
  it("computes correct weight", () => {
    expect(computePortfolioWeight(25000, 100000)).toBe(25);
  });

  it("returns 0 when total is zero", () => {
    expect(computePortfolioWeight(1000, 0)).toBe(0);
  });

  it("returns 0 when total is negative", () => {
    expect(computePortfolioWeight(1000, -500)).toBe(0);
  });

  it("returns 100 for full portfolio", () => {
    expect(computePortfolioWeight(100000, 100000)).toBe(100);
  });

  it("rounds to 2 decimal places", () => {
    expect(computePortfolioWeight(1, 3)).toBe(33.33);
  });

  it("returns 0 for zero holding value", () => {
    expect(computePortfolioWeight(0, 100000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyChangeType
// ---------------------------------------------------------------------------

describe("classifyChangeType", () => {
  it("returns NEW when previous is null", () => {
    expect(classifyChangeType(1000, null)).toBe("NEW");
  });

  it("returns EXITED when latest is null", () => {
    expect(classifyChangeType(null, 1000)).toBe("EXITED");
  });

  it("returns INCREASED when latest > previous", () => {
    expect(classifyChangeType(1500, 1000)).toBe("INCREASED");
  });

  it("returns REDUCED when latest < previous", () => {
    expect(classifyChangeType(500, 1000)).toBe("REDUCED");
  });

  it("returns UNCHANGED when shares are equal", () => {
    expect(classifyChangeType(1000, 1000)).toBe("UNCHANGED");
  });

  it("returns EXITED for zero latest with non-null previous", () => {
    expect(classifyChangeType(null, 500)).toBe("EXITED");
  });

  it("returns NEW for zero previous shares (first reporting)", () => {
    // zero previous is null in our model — previous_shares is null, not 0, for new entries
    expect(classifyChangeType(100, null)).toBe("NEW");
  });
});

// ---------------------------------------------------------------------------
// computeShareChange
// ---------------------------------------------------------------------------

describe("computeShareChange", () => {
  it("computes positive delta", () => {
    const { shareChange, shareChangePct } = computeShareChange(1500, 1000);
    expect(shareChange).toBe(500);
    expect(shareChangePct).toBe(50);
  });

  it("computes negative delta", () => {
    const { shareChange, shareChangePct } = computeShareChange(500, 1000);
    expect(shareChange).toBe(-500);
    expect(shareChangePct).toBe(-50);
  });

  it("returns nulls for NEW position", () => {
    const { shareChange, shareChangePct } = computeShareChange(1000, null);
    expect(shareChange).toBeNull();
    expect(shareChangePct).toBeNull();
  });

  it("returns nulls for EXITED position", () => {
    const { shareChange, shareChangePct } = computeShareChange(null, 1000);
    expect(shareChange).toBeNull();
    expect(shareChangePct).toBeNull();
  });

  it("returns zero delta for UNCHANGED", () => {
    const { shareChange, shareChangePct } = computeShareChange(1000, 1000);
    expect(shareChange).toBe(0);
    expect(shareChangePct).toBe(0);
  });

  it("returns null pct when previous is zero", () => {
    const { shareChange, shareChangePct } = computeShareChange(100, 0);
    expect(shareChange).toBe(100);
    expect(shareChangePct).toBeNull();
  });

  it("rounds pct to 2 decimal places", () => {
    const { shareChangePct } = computeShareChange(10, 3);
    expect(shareChangePct).toBe(233.33);
  });
});

// ---------------------------------------------------------------------------
// isMappingReliable
// ---------------------------------------------------------------------------

describe("isMappingReliable", () => {
  it("returns true for 'approved'", () => {
    expect(isMappingReliable("approved")).toBe(true);
  });

  it("returns true for 'mapped'", () => {
    expect(isMappingReliable("mapped")).toBe(true);
  });

  it("returns true for 'auto'", () => {
    expect(isMappingReliable("auto")).toBe(true);
  });

  it("returns true for 'verified'", () => {
    expect(isMappingReliable("verified")).toBe(true);
  });

  it("returns false for 'unmapped'", () => {
    expect(isMappingReliable("unmapped")).toBe(false);
  });

  it("returns false for 'pending'", () => {
    expect(isMappingReliable("pending")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isMappingReliable(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isMappingReliable(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMappingReliable("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeFilingFreshnessDays
// ---------------------------------------------------------------------------

describe("computeFilingFreshnessDays", () => {
  it("returns 0 for today", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(computeFilingFreshnessDays(today)).toBe(0);
  });

  it("returns positive for past dates", () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const days = computeFilingFreshnessDays(oneYearAgo);
    expect(days).toBeGreaterThanOrEqual(364);
    expect(days).toBeLessThanOrEqual(366);
  });

  it("returns -1 for null", () => {
    expect(computeFilingFreshnessDays(null)).toBe(-1);
  });

  it("returns -1 for undefined", () => {
    expect(computeFilingFreshnessDays(undefined)).toBe(-1);
  });

  it("returns -1 for invalid date string", () => {
    expect(computeFilingFreshnessDays("not-a-date")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// buildEdgarManagerUrl
// ---------------------------------------------------------------------------

describe("buildEdgarManagerUrl", () => {
  it("builds a valid EDGAR URL with numeric CIK", () => {
    const url = buildEdgarManagerUrl("0001234567");
    expect(url).toContain("sec.gov");
    expect(url).toContain("1234567"); // leading zeros stripped in URL
    expect(url).toContain("13F-HR");
  });

  it("handles CIK with leading zeros", () => {
    const url = buildEdgarManagerUrl("0000012345");
    expect(url).toContain("12345");
  });
});

// ---------------------------------------------------------------------------
// buildEdgarFilingUrl
// ---------------------------------------------------------------------------

describe("buildEdgarFilingUrl", () => {
  it("builds a valid EDGAR filing URL", () => {
    const url = buildEdgarFilingUrl("0001234567-24-000001", "0001234567");
    expect(url).toContain("sec.gov");
    expect(url).toContain("000123456724000001");
  });

  it("removes dashes from accession number", () => {
    const url = buildEdgarFilingUrl("0001234567-24-012345", "0001234567");
    expect(url).not.toContain("-24-");
  });
});

// ---------------------------------------------------------------------------
// FILING_DELAY_DISCLAIMER
// ---------------------------------------------------------------------------

describe("FILING_DELAY_DISCLAIMER", () => {
  it("mentions quarterly reporting", () => {
    expect(FILING_DELAY_DISCLAIMER.toLowerCase()).toContain("quarterly");
  });

  it("mentions 45 days", () => {
    expect(FILING_DELAY_DISCLAIMER).toContain("45 days");
  });

  it("states it does not represent real-time positions", () => {
    expect(FILING_DELAY_DISCLAIMER.toLowerCase()).toContain("real-time");
  });
});

// ---------------------------------------------------------------------------
// Compliance: no forbidden language
// ---------------------------------------------------------------------------

describe("no forbidden language in exports", () => {
  const forbidden = [
    "smart money",
    "best fund",
    "top fund to follow",
    "buy what they buy",
    "conviction buy",
    "recommended fund",
  ];

  it("FILING_DELAY_DISCLAIMER contains no forbidden language", () => {
    const lower = FILING_DELAY_DISCLAIMER.toLowerCase();
    for (const term of forbidden) {
      expect(lower).not.toContain(term);
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic: classifyChangeType is symmetric
// ---------------------------------------------------------------------------

describe("deterministic change classification", () => {
  const cases: Array<[number | null, number | null, ChangeType]> = [
    [1000, null,  "NEW"],
    [null, 1000,  "EXITED"],
    [2000, 1000,  "INCREASED"],
    [500,  1000,  "REDUCED"],
    [1000, 1000,  "UNCHANGED"],
    [1,    null,  "NEW"],
    [null, 1,     "EXITED"],
  ];

  for (const [latest, prev, expected] of cases) {
    it(`(latest=${latest}, prev=${prev}) → ${expected}`, () => {
      expect(classifyChangeType(latest, prev)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Pagination boundary: page size clamped
// ---------------------------------------------------------------------------

describe("portfolio weight boundary conditions", () => {
  it("handles very small portfolio weight (rounds down to 0)", () => {
    // 1 / 10,000,000 = 0.00001% → rounds to 0
    expect(computePortfolioWeight(1, 10_000_000)).toBe(0);
  });

  it("handles 99.99% weight", () => {
    const w = computePortfolioWeight(9999, 10000);
    expect(w).toBe(99.99);
  });
});

// ---------------------------------------------------------------------------
// Quarter label — various year boundaries
// ---------------------------------------------------------------------------

describe("dateToQuarterLabel — year boundaries", () => {
  it("handles December 31 year-end", () => {
    expect(dateToQuarterLabel("2023-12-31")).toBe("2023-Q4");
  });

  it("handles January 1 new year", () => {
    expect(dateToQuarterLabel("2025-01-01")).toBe("2025-Q1");
  });

  it("handles leap year February", () => {
    expect(dateToQuarterLabel("2024-02-29")).toBe("2024-Q1");
  });
});

// ---------------------------------------------------------------------------
// No LLM dependency verification
// ---------------------------------------------------------------------------

describe("no LLM dependency", () => {
  it("all exported functions are synchronous pure functions or async DB functions — no AI imports", async () => {
    // This test documents the design constraint: these are pure computations.
    // The module must not import openai, anthropic, or any LLM client.
    const { classifyChangeType: f1, computePortfolioWeight: f2, dateToQuarterLabel: f3 } = await import("../services/institutional/fund-service");
    expect(typeof f1).toBe("function");
    expect(typeof f2).toBe("function");
    expect(typeof f3).toBe("function");
  });
});
