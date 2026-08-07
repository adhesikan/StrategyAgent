/**
 * Sprint 2.2.8 — Pure-function tests for opportunity-ranking-helpers.ts
 *
 * No DOM or React required. All functions are deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  getScoreColorClass,
  getScoreBarClass,
  formatRelativeTime,
  getCategoryLabel,
  getCategoryBadgeClass,
  getChangeDisplay,
  getChangeBadgeClass,
  getConfidenceBadgeClass,
} from "../opportunity-ranking-helpers";

// ---------------------------------------------------------------------------
// getScoreColorClass
// ---------------------------------------------------------------------------

describe("getScoreColorClass", () => {
  it("returns emerald for scores ≥ 80", () => {
    expect(getScoreColorClass(80)).toBe("text-emerald-400");
    expect(getScoreColorClass(95)).toBe("text-emerald-400");
    expect(getScoreColorClass(100)).toBe("text-emerald-400");
  });

  it("returns sky for scores in [60, 79]", () => {
    expect(getScoreColorClass(60)).toBe("text-sky-400");
    expect(getScoreColorClass(70)).toBe("text-sky-400");
    expect(getScoreColorClass(79)).toBe("text-sky-400");
  });

  it("returns amber for scores in [40, 59]", () => {
    expect(getScoreColorClass(40)).toBe("text-amber-400");
    expect(getScoreColorClass(50)).toBe("text-amber-400");
    expect(getScoreColorClass(59)).toBe("text-amber-400");
  });

  it("returns rose for scores below 40", () => {
    expect(getScoreColorClass(0)).toBe("text-rose-400");
    expect(getScoreColorClass(20)).toBe("text-rose-400");
    expect(getScoreColorClass(39)).toBe("text-rose-400");
  });

  it("uses strict ≥ 80 boundary (79 is sky, 80 is emerald)", () => {
    expect(getScoreColorClass(79)).toBe("text-sky-400");
    expect(getScoreColorClass(80)).toBe("text-emerald-400");
  });

  it("uses strict ≥ 60 boundary (59 is amber, 60 is sky)", () => {
    expect(getScoreColorClass(59)).toBe("text-amber-400");
    expect(getScoreColorClass(60)).toBe("text-sky-400");
  });

  it("uses strict ≥ 40 boundary (39 is rose, 40 is amber)", () => {
    expect(getScoreColorClass(39)).toBe("text-rose-400");
    expect(getScoreColorClass(40)).toBe("text-amber-400");
  });
});

// ---------------------------------------------------------------------------
// getScoreBarClass
// ---------------------------------------------------------------------------

describe("getScoreBarClass", () => {
  it("returns emerald bg for ≥ 80", () => {
    expect(getScoreBarClass(80)).toBe("bg-emerald-500");
    expect(getScoreBarClass(100)).toBe("bg-emerald-500");
  });

  it("returns sky bg for [60, 79]", () => {
    expect(getScoreBarClass(60)).toBe("bg-sky-500");
    expect(getScoreBarClass(79)).toBe("bg-sky-500");
  });

  it("returns amber bg for [40, 59]", () => {
    expect(getScoreBarClass(40)).toBe("bg-amber-500");
    expect(getScoreBarClass(59)).toBe("bg-amber-500");
  });

  it("returns rose bg for < 40", () => {
    expect(getScoreBarClass(0)).toBe("bg-rose-500");
    expect(getScoreBarClass(39)).toBe("bg-rose-500");
  });

  it("color classes are different from getScoreColorClass (text vs bg)", () => {
    // Ensure text- and bg- variants are not confused
    expect(getScoreBarClass(90)).not.toContain("text-");
    expect(getScoreColorClass(90)).not.toContain("bg-");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const base = new Date("2026-08-07T10:00:00.000Z");

  it('returns "just now" for times under 30 seconds ago', () => {
    const dateStr = new Date(base.getTime() - 10_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("just now");
  });

  it('returns "just now" for future dates (clock skew)', () => {
    const dateStr = new Date(base.getTime() + 5_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("just now");
  });

  it('returns "1 minute ago" for exactly 60 seconds', () => {
    const dateStr = new Date(base.getTime() - 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 minute ago");
  });

  it('uses singular "1 minute ago" not "1 minutes ago"', () => {
    const dateStr = new Date(base.getTime() - 75_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 minute ago");
  });

  it("returns minutes for values under 60 minutes", () => {
    const dateStr = new Date(base.getTime() - 4 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("4 minutes ago");
  });

  it("returns 59 minutes for 59-minute-old timestamp", () => {
    const dateStr = new Date(base.getTime() - 59 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("59 minutes ago");
  });

  it('returns "1 hour ago" at exactly 60 minutes', () => {
    const dateStr = new Date(base.getTime() - 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 hour ago");
  });

  it('uses singular "1 hour ago"', () => {
    const dateStr = new Date(base.getTime() - 90 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 hour ago");
  });

  it("returns hours for values under 24 hours", () => {
    const dateStr = new Date(base.getTime() - 6 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("6 hours ago");
  });

  it("returns 23 hours for 23-hour-old timestamp", () => {
    const dateStr = new Date(base.getTime() - 23 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("23 hours ago");
  });

  it('returns "1 day ago" at exactly 24 hours', () => {
    const dateStr = new Date(base.getTime() - 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 day ago");
  });

  it('uses singular "1 day ago"', () => {
    const dateStr = new Date(base.getTime() - 36 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("1 day ago");
  });

  it("returns plural days for 2+ days", () => {
    const dateStr = new Date(base.getTime() - 3 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(dateStr, base)).toBe("3 days ago");
  });

  it("default now parameter uses real clock (smoke test)", () => {
    const dateStr = new Date(Date.now() - 5 * 60_000).toISOString();
    const result = formatRelativeTime(dateStr);
    expect(result).toContain("minutes ago");
  });
});

// ---------------------------------------------------------------------------
// getCategoryLabel
// ---------------------------------------------------------------------------

describe("getCategoryLabel", () => {
  it("maps Top Growth to Growth", () => {
    expect(getCategoryLabel("Top Growth")).toBe("Growth");
  });

  it("maps Income to Income", () => {
    expect(getCategoryLabel("Income")).toBe("Income");
  });

  it("maps Watch to Watch", () => {
    expect(getCategoryLabel("Watch")).toBe("Watch");
  });

  it("maps Avoid to Avoid", () => {
    expect(getCategoryLabel("Avoid")).toBe("Avoid");
  });

  it("returns the raw string for unknown categories (fallback)", () => {
    expect(getCategoryLabel("Unknown" as any)).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// getCategoryBadgeClass
// ---------------------------------------------------------------------------

describe("getCategoryBadgeClass", () => {
  it("returns emerald class for Top Growth", () => {
    const cls = getCategoryBadgeClass("Top Growth");
    expect(cls).toContain("emerald");
  });

  it("returns sky class for Income", () => {
    const cls = getCategoryBadgeClass("Income");
    expect(cls).toContain("sky");
  });

  it("returns amber class for Watch", () => {
    const cls = getCategoryBadgeClass("Watch");
    expect(cls).toContain("amber");
  });

  it("returns rose class for Avoid", () => {
    const cls = getCategoryBadgeClass("Avoid");
    expect(cls).toContain("rose");
  });

  it("returns a fallback class for unknown categories", () => {
    const cls = getCategoryBadgeClass("Unknown" as any);
    expect(typeof cls).toBe("string");
    expect(cls.length).toBeGreaterThan(0);
  });

  it("all known categories produce distinct classes", () => {
    const classes = [
      getCategoryBadgeClass("Top Growth"),
      getCategoryBadgeClass("Income"),
      getCategoryBadgeClass("Watch"),
      getCategoryBadgeClass("Avoid"),
    ];
    const unique = new Set(classes);
    expect(unique.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// getChangeDisplay
// ---------------------------------------------------------------------------

describe("getChangeDisplay", () => {
  it("returns star symbol for new", () => {
    expect(getChangeDisplay("new").symbol).toBe("★");
    expect(getChangeDisplay("new").label).toBe("New");
  });

  it("returns up-arrow for upgraded", () => {
    expect(getChangeDisplay("upgraded").symbol).toBe("↑");
    expect(getChangeDisplay("upgraded").label).toBe("Upgraded");
  });

  it("returns down-arrow for downgraded", () => {
    expect(getChangeDisplay("downgraded").symbol).toBe("↓");
    expect(getChangeDisplay("downgraded").label).toBe("Downgraded");
  });

  it("returns right-arrow for moved", () => {
    expect(getChangeDisplay("moved").symbol).toBe("→");
    expect(getChangeDisplay("moved").label).toBe("Moved");
  });

  it("returns bullet + direction string for unknown direction", () => {
    const { symbol, label } = getChangeDisplay("transferred" as any);
    expect(symbol).toBe("•");
    expect(label).toBe("transferred");
  });
});

// ---------------------------------------------------------------------------
// getChangeBadgeClass
// ---------------------------------------------------------------------------

describe("getChangeBadgeClass", () => {
  it("returns emerald class for new", () => {
    expect(getChangeBadgeClass("new")).toContain("emerald");
  });

  it("returns sky class for upgraded", () => {
    expect(getChangeBadgeClass("upgraded")).toContain("sky");
  });

  it("returns rose class for downgraded", () => {
    expect(getChangeBadgeClass("downgraded")).toContain("rose");
  });

  it("returns amber class for moved", () => {
    expect(getChangeBadgeClass("moved")).toContain("amber");
  });

  it("all four directions produce distinct classes", () => {
    const classes = [
      getChangeBadgeClass("new"),
      getChangeBadgeClass("upgraded"),
      getChangeBadgeClass("downgraded"),
      getChangeBadgeClass("moved"),
    ];
    const unique = new Set(classes);
    expect(unique.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// getConfidenceBadgeClass
// ---------------------------------------------------------------------------

describe("getConfidenceBadgeClass", () => {
  it("returns emerald class for high confidence", () => {
    expect(getConfidenceBadgeClass("high")).toContain("emerald");
  });

  it("returns amber class for medium confidence", () => {
    expect(getConfidenceBadgeClass("medium")).toContain("amber");
  });

  it("returns rose class for low confidence", () => {
    expect(getConfidenceBadgeClass("low")).toContain("rose");
  });

  it("all three confidence levels produce distinct classes", () => {
    const classes = [
      getConfidenceBadgeClass("high"),
      getConfidenceBadgeClass("medium"),
      getConfidenceBadgeClass("low"),
    ];
    const unique = new Set(classes);
    expect(unique.size).toBe(3);
  });

  it("returns a fallback string for unknown confidence level", () => {
    const cls = getConfidenceBadgeClass("unknown");
    expect(typeof cls).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: no hardcoded tickers anywhere in helpers
// ---------------------------------------------------------------------------

describe("No hardcoded tickers in helpers module", () => {
  const KNOWN_TICKERS = ["NVDA", "AAPL", "MSFT", "AMZN", "TSLA", "AMD", "META", "GOOG"];
  const helperFnSource = [
    getScoreColorClass.toString(),
    getScoreBarClass.toString(),
    formatRelativeTime.toString(),
    getCategoryLabel.toString(),
    getCategoryBadgeClass.toString(),
    getChangeDisplay.toString(),
    getChangeBadgeClass.toString(),
    getConfidenceBadgeClass.toString(),
  ].join("\n");

  KNOWN_TICKERS.forEach((ticker) => {
    it(`does not hardcode ticker ${ticker}`, () => {
      expect(helperFnSource).not.toContain(ticker);
    });
  });
});

// ---------------------------------------------------------------------------
// Score colour consistency: bar and text use same threshold
// ---------------------------------------------------------------------------

describe("Score colour consistency between bar and text helpers", () => {
  const testPoints = [0, 20, 39, 40, 59, 60, 79, 80, 95, 100];

  testPoints.forEach((score) => {
    it(`score ${score}: text and bar classes share same colour family`, () => {
      const textClass = getScoreColorClass(score);
      const barClass = getScoreBarClass(score);
      // Extract colour name (emerald, sky, amber, rose)
      const textColor = textClass.replace("text-", "").split("-")[0];
      const barColor = barClass.replace("bg-", "").split("-")[0];
      expect(textColor).toBe(barColor);
    });
  });
});
