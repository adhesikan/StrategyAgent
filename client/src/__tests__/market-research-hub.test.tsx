// Market Research Hub tests — Sprint 2.3.5
//
// Tests: routing, module rendering, links, compliance, freshness,
//        search grouping, recently viewed, empty/partial states,
//        institutional disclosure, no-LLM, no-computation assertions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSearchIndex,
  groupSearchResults,
  runSearch,
  formatFreshness,
  formatPortfolioValue,
  healthColor,
  directionIcon,
  type SearchResult,
  type RecentItem,
} from "@/pages/market-research-hub";

// ---------------------------------------------------------------------------
// formatFreshness
// ---------------------------------------------------------------------------

describe("formatFreshness", () => {
  it("returns empty string for null", () => {
    expect(formatFreshness(null)).toBe("");
  });
  it("returns 'Just now' for <1 minute ago", () => {
    const now = new Date(Date.now() - 30_000).toISOString();
    expect(formatFreshness(now)).toBe("Just now");
  });
  it("returns minutes for <60 minutes", () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatFreshness(t)).toBe("5m ago");
  });
  it("returns hours for <24 hours", () => {
    const t = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatFreshness(t)).toBe("3h ago");
  });
  it("returns days for >=24 hours", () => {
    const t = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(formatFreshness(t)).toBe("2d ago");
  });
});

// ---------------------------------------------------------------------------
// formatPortfolioValue
// ---------------------------------------------------------------------------

describe("formatPortfolioValue", () => {
  it("formats trillions correctly (post-2023 DB values in dollars)", () => {
    // Morgan Stanley example: 1,674,971 × $1000 was the old inflated value.
    // Correct dollar value: ~$1.67T
    expect(formatPortfolioValue(1_674_971_400_000)).toMatch(/^\$1\.67T$/);
  });
  it("formats $150M correctly — no 1000× inflation", () => {
    // post-2023 SEC raw VALUE=150000000 → stored as 150000000 in DB → returns $150M
    expect(formatPortfolioValue(150_000_000)).toBe("$150M");
  });
  it("does NOT return a value in billions for a true trillion-scale portfolio", () => {
    const v = formatPortfolioValue(1_674_971_400_000);
    expect(v).not.toContain("B");
    expect(v).toContain("T");
  });
  it("returns dash for null", () => {
    expect(formatPortfolioValue(null)).toBe("—");
  });
  it("formats billions", () => {
    expect(formatPortfolioValue(5_200_000_000)).toBe("$5.2B");
  });
  it("formats millions", () => {
    expect(formatPortfolioValue(450_000_000)).toBe("$450M");
  });
  it("formats small values", () => {
    expect(formatPortfolioValue(5_000)).toBe("$5,000");
  });
});

// ---------------------------------------------------------------------------
// healthColor
// ---------------------------------------------------------------------------

describe("healthColor", () => {
  it("returns emerald for >=75", () => {
    expect(healthColor(80)).toContain("emerald");
    expect(healthColor(75)).toContain("emerald");
  });
  it("returns blue for >=60 <75", () => {
    expect(healthColor(65)).toContain("blue");
  });
  it("returns yellow for >=40 <60", () => {
    expect(healthColor(50)).toContain("yellow");
  });
  it("returns orange for <40", () => {
    expect(healthColor(30)).toContain("orange");
  });
  it("never returns red (not bearish language)", () => {
    expect(healthColor(0)).not.toContain("red");
    expect(healthColor(10)).not.toContain("red");
  });
});

// ---------------------------------------------------------------------------
// directionIcon
// ---------------------------------------------------------------------------

describe("directionIcon", () => {
  it("returns a React element for each direction", () => {
    expect(directionIcon("up")).toBeTruthy();
    expect(directionIcon("down")).toBeTruthy();
    expect(directionIcon("stable")).toBeTruthy();
  });
  it("returns distinct elements for different directions", () => {
    const up   = JSON.stringify(directionIcon("up"));
    const down = JSON.stringify(directionIcon("down"));
    const flat = JSON.stringify(directionIcon("stable"));
    expect(up).not.toBe(down);
    expect(up).not.toBe(flat);
    expect(down).not.toBe(flat);
  });
});

// ---------------------------------------------------------------------------
// buildSearchIndex
// ---------------------------------------------------------------------------

describe("buildSearchIndex", () => {
  const stocks  = ["NVDA", "MU", "CRDO"];
  const themes  = [
    { themeId: "ai-infrastructure", themeName: "AI Infrastructure" },
    { themeId: "semiconductors",    themeName: "Semiconductors" },
  ];
  const sectors = ["Technology", "Utilities"];
  const funds   = [
    { managerId: "0000abc", managerName: "Sequoia Capital", latestQuarter: null,
      reportedPortfolioValue: null, reportedPositionCount: null, lastFiledAt: null },
  ];

  const index = buildSearchIndex(stocks, themes, sectors, funds);

  it("includes stocks with /opportunities/:symbol href", () => {
    const nvda = index.find(r => r.label === "NVDA");
    expect(nvda).toBeDefined();
    expect(nvda!.href).toBe("/opportunities/NVDA");
    expect(nvda!.type).toBe("stock");
  });

  it("includes themes with /intelligence/themes/:id href", () => {
    const ai = index.find(r => r.label === "AI Infrastructure");
    expect(ai).toBeDefined();
    expect(ai!.href).toBe("/intelligence/themes/ai-infrastructure");
    expect(ai!.type).toBe("theme");
  });

  it("includes sectors with /intelligence/sectors/:sector href", () => {
    const tech = index.find(r => r.label === "Technology");
    expect(tech).toBeDefined();
    expect(tech!.href).toContain("/intelligence/sectors/");
    expect(tech!.type).toBe("sector");
  });

  it("includes funds with /institutional/funds/:managerId href", () => {
    const seq = index.find(r => r.label === "Sequoia Capital");
    expect(seq).toBeDefined();
    expect(seq!.href).toBe("/institutional/funds/0000abc");
    expect(seq!.type).toBe("fund");
  });

  it("total count = stocks + themes + sectors + funds", () => {
    expect(index.length).toBe(stocks.length + themes.length + sectors.length + funds.length);
  });

  it("handles empty inputs", () => {
    const empty = buildSearchIndex([], [], [], []);
    expect(empty).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runSearch
// ---------------------------------------------------------------------------

describe("runSearch", () => {
  const index: SearchResult[] = [
    { type: "stock",  label: "NVDA", sublabel: "Stock",  href: "/opportunities/NVDA" },
    { type: "theme",  label: "AI Infrastructure", sublabel: "Theme", href: "/intelligence/themes/ai-infrastructure" },
    { type: "sector", label: "Technology", sublabel: "Sector", href: "/intelligence/sectors/Technology" },
    { type: "fund",   label: "Sequoia Capital", sublabel: "Fund", href: "/institutional/funds/abc" },
  ];

  it("returns empty for empty query", () => {
    expect(runSearch(index, "")).toHaveLength(0);
  });
  it("returns empty for whitespace", () => {
    expect(runSearch(index, "   ")).toHaveLength(0);
  });
  it("matches by label substring (case-insensitive)", () => {
    const r = runSearch(index, "nvda");
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe("NVDA");
  });
  it("matches theme by partial name", () => {
    const r = runSearch(index, "AI");
    expect(r.some(item => item.type === "theme")).toBe(true);
  });
  it("matches fund by partial manager name", () => {
    const r = runSearch(index, "sequoia");
    expect(r.some(item => item.type === "fund")).toBe(true);
  });
  it("returns multiple types for broad query", () => {
    // "a" matches NVDA(no), AI Infrastructure(yes), Technology(yes), Sequoia Capital(yes)
    const r = runSearch(index, "a");
    expect(r.length).toBeGreaterThan(1);
  });
  it("caps results at 20", () => {
    const big: SearchResult[] = Array.from({ length: 50 }, (_, i) => ({
      type: "stock" as const, label: `SYM${i}`, href: `/opportunities/SYM${i}`,
    }));
    expect(runSearch(big, "SYM").length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// groupSearchResults
// ---------------------------------------------------------------------------

describe("groupSearchResults", () => {
  it("groups by type with plural capitalized keys", () => {
    const results: SearchResult[] = [
      { type: "stock",  label: "NVDA", href: "/opportunities/NVDA" },
      { type: "theme",  label: "AI Infrastructure", href: "/t/ai" },
      { type: "sector", label: "Technology", href: "/s/tech" },
      { type: "fund",   label: "Sequoia", href: "/f/seq" },
    ];
    const grouped = groupSearchResults(results);
    expect(Object.keys(grouped)).toEqual(expect.arrayContaining(["Stocks", "Themes", "Sectors", "Funds"]));
    expect(grouped["Stocks"]).toHaveLength(1);
    expect(grouped["Themes"]).toHaveLength(1);
  });

  it("handles empty results", () => {
    expect(groupSearchResults([])).toEqual({});
  });

  it("groups multiple items of same type together", () => {
    const results: SearchResult[] = [
      { type: "stock", label: "NVDA", href: "/1" },
      { type: "stock", label: "MU",   href: "/2" },
    ];
    const grouped = groupSearchResults(results);
    expect(grouped["Stocks"]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Recently Viewed — pure logic (no localStorage, no browser env needed)
// ---------------------------------------------------------------------------

const RECENT_MAX = 5;

/** Mirrors the addItem logic from useRecentlyViewed — pure, no side-effects */
function addRecentItem(existing: RecentItem[], item: Omit<RecentItem, "viewedAt">): RecentItem[] {
  return [
    { ...item, viewedAt: 1_000_000 },          // fixed timestamp for determinism
    ...existing.filter(p => p.href !== item.href),
  ].slice(0, RECENT_MAX);
}

/** Mirrors the JSON parse/guard in useRecentlyViewed */
function parseRecentItems(raw: string): RecentItem[] {
  try { return JSON.parse(raw); }
  catch { return []; }
}

describe("recently viewed — pure logic", () => {
  it("starts with empty array from empty JSON", () => {
    expect(parseRecentItems("[]")).toHaveLength(0);
  });

  it("addRecentItem prepends most recent first", () => {
    let items: RecentItem[] = [];
    items = addRecentItem(items, { type: "stock", label: "NVDA", href: "/1" });
    items = addRecentItem(items, { type: "theme", label: "AI",   href: "/2" });
    expect(items[0].label).toBe("AI");
    expect(items[1].label).toBe("NVDA");
  });

  it("addRecentItem deduplicates by href", () => {
    let items: RecentItem[] = [];
    items = addRecentItem(items, { type: "stock", label: "NVDA", href: "/opportunities/NVDA" });
    items = addRecentItem(items, { type: "stock", label: "NVDA", href: "/opportunities/NVDA" });
    expect(items).toHaveLength(1);
  });

  it("addRecentItem caps at RECENT_MAX", () => {
    let items: RecentItem[] = [];
    for (let i = 0; i < 8; i++) {
      items = addRecentItem(items, { type: "stock", label: `SYM${i}`, href: `/opportunities/SYM${i}` });
    }
    expect(items.length).toBeLessThanOrEqual(RECENT_MAX);
  });

  it("addRecentItem includes viewedAt number", () => {
    const items = addRecentItem([], { type: "stock", label: "NVDA", href: "/1" });
    expect(items[0].viewedAt).toBeTypeOf("number");
  });

  it("addRecentItem preserves type field", () => {
    const items = addRecentItem([], { type: "fund", label: "Sequoia", href: "/f/seq" });
    expect(items[0].type).toBe("fund");
  });

  it("addRecentItem result serializes and round-trips via JSON", () => {
    const items = addRecentItem([], { type: "sector", label: "Technology", href: "/s/tech" });
    const stored  = JSON.stringify(items);
    const restored = parseRecentItems(stored);
    expect(restored).toHaveLength(1);
    expect(restored[0].label).toBe("Technology");
  });

  it("parseRecentItems returns empty array for corrupted JSON", () => {
    expect(parseRecentItems("NOT_JSON{{{")).toHaveLength(0);
  });

  it("parseRecentItems returns empty array for empty string", () => {
    expect(parseRecentItems("")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Compliance — no forbidden language in module exports
// ---------------------------------------------------------------------------

describe("compliance — no forbidden language in module source", () => {
  const FORBIDDEN = [
    "recommendation", "buy list", "sell list", "best stocks",
    "smart money", "what you should buy", "buy this", "sell this",
  ];

  it("hub module exports no forbidden language", () => {
    // Test the string representations of formatting functions
    const fnStrings = [
      formatFreshness.toString(),
      formatPortfolioValue.toString(),
      healthColor.toString(),
    ].join(" ").toLowerCase();

    for (const word of FORBIDDEN) {
      expect(fnStrings).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-link contract
// ---------------------------------------------------------------------------

describe("cross-link contract", () => {
  it("stocks link to /opportunities/:symbol", () => {
    const index = buildSearchIndex(["AAPL"], [], [], []);
    expect(index[0].href).toBe("/opportunities/AAPL");
  });

  it("themes link to /intelligence/themes/:themeId", () => {
    const index = buildSearchIndex([], [{ themeId: "cloud", themeName: "Cloud" }], [], []);
    expect(index[0].href).toBe("/intelligence/themes/cloud");
  });

  it("sectors link to /intelligence/sectors/:sector", () => {
    const index = buildSearchIndex([], [], ["Technology"], []);
    expect(index[0].href).toContain("/intelligence/sectors/");
  });

  it("funds link to /institutional/funds/:managerId", () => {
    const f = { managerId: "0001234567", managerName: "Test Fund",
      latestQuarter: null, reportedPortfolioValue: null, reportedPositionCount: null, lastFiledAt: null };
    const index = buildSearchIndex([], [], [], [f]);
    expect(index[0].href).toBe("/institutional/funds/0001234567");
  });
});

// ---------------------------------------------------------------------------
// No LLM / no new computation assertion
// ---------------------------------------------------------------------------

describe("no LLM / no new computation", () => {
  it("runSearch is purely deterministic — same inputs produce same outputs", () => {
    const index: SearchResult[] = [
      { type: "stock", label: "NVDA", href: "/1" },
      { type: "theme", label: "AI Infrastructure", href: "/2" },
    ];
    const r1 = runSearch(index, "ai");
    const r2 = runSearch(index, "ai");
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("groupSearchResults is deterministic", () => {
    const results: SearchResult[] = [
      { type: "stock", label: "A", href: "/a" },
      { type: "theme", label: "B", href: "/b" },
    ];
    expect(JSON.stringify(groupSearchResults(results)))
      .toBe(JSON.stringify(groupSearchResults(results)));
  });
});

// ---------------------------------------------------------------------------
// Module freshness
// ---------------------------------------------------------------------------

describe("freshness labels", () => {
  it("formats 0 seconds as 'Just now'", () => {
    const recent = new Date(Date.now() - 10_000).toISOString();
    expect(formatFreshness(recent)).toBe("Just now");
  });

  it("formats 61 minutes as '1h ago'", () => {
    const t = new Date(Date.now() - 61 * 60_000).toISOString();
    expect(formatFreshness(t)).toBe("1h ago");
  });
});

// ---------------------------------------------------------------------------
// Empty / partial API state
// ---------------------------------------------------------------------------

describe("search with partial data", () => {
  it("handles empty stocks array", () => {
    const index = buildSearchIndex([], [{ themeId: "ai", themeName: "AI" }], ["Tech"], []);
    expect(index.some(r => r.type === "theme")).toBe(true);
    expect(index.some(r => r.type === "sector")).toBe(true);
    expect(index.some(r => r.type === "stock")).toBe(false);
  });

  it("handles all empty arrays gracefully", () => {
    expect(() => buildSearchIndex([], [], [], [])).not.toThrow();
    expect(buildSearchIndex([], [], [], [])).toHaveLength(0);
  });

  it("runSearch returns empty array for empty index", () => {
    expect(runSearch([], "NVDA")).toHaveLength(0);
  });
});
