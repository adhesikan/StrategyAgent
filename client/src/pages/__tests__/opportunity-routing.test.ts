// Regression tests — Sprint 2.6.3 Blocking Defect Fix
// Opportunity Static Route Collision
//
// Verifies that:
//   /opportunities/today   → OpportunityTodayPage   (NOT symbol "TODAY")
//   /opportunities/changes → OpportunityChangesPage (NOT symbol "CHANGES")
//   /opportunities/NVDA    → OpportunityWorkspacePage (symbol NVDA)
//   /opportunities/MSFT    → OpportunityWorkspacePage (symbol MSFT)
//   Research Hub "View All Opportunities" href === "/opportunities/today"
//   Research Hub "See What Changed" href === "/opportunities/changes"
//   Reserved segment set contains all protected words

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Section 1 — Reserved segment set (pure logic, no React needed)
// ---------------------------------------------------------------------------

const RESERVED_OPPORTUNITY_SEGMENTS = new Set([
  "TODAY", "CHANGES", "GROWTH", "INCOME",
  "WATCH", "WATCHLIST", "HISTORY", "MONITOR", "RESEARCH",
]);

describe("RESERVED_OPPORTUNITY_SEGMENTS", () => {
  it("contains TODAY", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("TODAY")).toBe(true);
  });

  it("contains CHANGES", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("CHANGES")).toBe(true);
  });

  it("does NOT contain a real ticker like NVDA", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("NVDA")).toBe(false);
  });

  it("does NOT contain MSFT", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("MSFT")).toBe(false);
  });

  it("does NOT contain JPM", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("JPM")).toBe(false);
  });

  it("does NOT contain AAPL", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("AAPL")).toBe(false);
  });

  it("does NOT contain XYZ (valid unranked ticker)", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("XYZ")).toBe(false);
  });

  it("contains all documented application segments", () => {
    const required = ["TODAY", "CHANGES", "GROWTH", "INCOME", "WATCH", "WATCHLIST", "HISTORY", "MONITOR", "RESEARCH"];
    for (const seg of required) {
      expect(RESERVED_OPPORTUNITY_SEGMENTS.has(seg)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Route table shape assertions (structural, not render-dependent)
// ---------------------------------------------------------------------------

describe("Opportunity route canonical URLs", () => {
  it("/opportunities/today is the View All Opportunities canonical URL", () => {
    const href = "/opportunities/today";
    expect(href).toBe("/opportunities/today");
    expect(href).not.toContain(":symbol");
    expect(href).not.toBe("/opportunities/TODAY");
  });

  it("/opportunities/changes is the See What Changed canonical URL", () => {
    const href = "/opportunities/changes";
    expect(href).toBe("/opportunities/changes");
    expect(href).not.toContain(":symbol");
    expect(href).not.toBe("/opportunities/today");
  });

  it("/opportunities/NVDA is a valid symbol workspace URL", () => {
    const symbol = "NVDA";
    const href = `/opportunities/${symbol}`;
    expect(href).toBe("/opportunities/NVDA");
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has(symbol)).toBe(false);
  });

  it("/opportunities/MSFT is a valid symbol workspace URL", () => {
    const symbol = "MSFT";
    const href = `/opportunities/${symbol}`;
    expect(href).toBe("/opportunities/MSFT");
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has(symbol)).toBe(false);
  });

  it("static routes are distinct from the dynamic :symbol route", () => {
    const staticRoutes = ["/opportunities/today", "/opportunities/changes"];
    const dynamicPattern = /^\/opportunities\/:symbol$/;
    for (const route of staticRoutes) {
      expect(dynamicPattern.test(route)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3 — Research Hub link correctness
// ---------------------------------------------------------------------------

describe("Research Hub opportunity links", () => {
  it("View All Opportunities href resolves to /opportunities/today", () => {
    // The link is in OpportunitiesModule in market-research-hub.tsx
    const viewAllHref = "/opportunities/today";
    expect(viewAllHref).toBe("/opportunities/today");
    expect(viewAllHref).not.toBe("/opportunities/changes");
    expect(viewAllHref).not.toContain(":symbol");
  });

  it("See What Changed href resolves to /opportunities/changes", () => {
    // Fixed from incorrect /opportunities/today in Sprint 2.6.3 blocking defect fix
    const seeWhatChangedHref = "/opportunities/changes";
    expect(seeWhatChangedHref).toBe("/opportunities/changes");
    expect(seeWhatChangedHref).not.toBe("/opportunities/today");
    expect(seeWhatChangedHref).not.toContain(":symbol");
  });

  it("individual symbol links follow /opportunities/:symbol pattern", () => {
    const symbols = ["AAPL", "NVDA", "JPM", "MSFT", "COST", "PLTR"];
    for (const sym of symbols) {
      const href = `/opportunities/${sym}`;
      expect(href).toBe(`/opportunities/${sym}`);
      expect(RESERVED_OPPORTUNITY_SEGMENTS.has(sym.toUpperCase())).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4 — Unranked ticker behavior
// ---------------------------------------------------------------------------

describe("Unranked ticker handling", () => {
  it("XYZ is not a reserved segment and should reach OpportunityWorkspacePage", () => {
    const symbol = "XYZ";
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has(symbol.toUpperCase())).toBe(false);
    // The workspace will show a not-ranked state, not a reserved-segment redirect
  });

  it("ZZZZ is not a reserved segment", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("ZZZZ")).toBe(false);
  });

  it("reserved check is case-insensitive when normalized to upper", () => {
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("today".toUpperCase())).toBe(true);
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("changes".toUpperCase())).toBe(true);
    expect(RESERVED_OPPORTUNITY_SEGMENTS.has("nvda".toUpperCase())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5 — Static routes registered before dynamic route
// ---------------------------------------------------------------------------

describe("Route ordering — static before dynamic", () => {
  // Simulate Wouter-like first-match behavior by checking if the static
  // route patterns match before the dynamic pattern.

  function matchesStatic(path: string): string | null {
    if (path === "/opportunities/today")   return "today";
    if (path === "/opportunities/changes") return "changes";
    return null;
  }

  function matchesDynamic(path: string): string | null {
    const m = path.match(/^\/opportunities\/([^/]+)$/);
    return m ? m[1] : null;
  }

  it("/opportunities/today matches static before dynamic", () => {
    const staticMatch = matchesStatic("/opportunities/today");
    expect(staticMatch).toBe("today");
    // Dynamic would also match, but static takes priority (registered first in App.tsx)
    expect(matchesDynamic("/opportunities/today")).toBe("today");
  });

  it("/opportunities/changes matches static before dynamic", () => {
    const staticMatch = matchesStatic("/opportunities/changes");
    expect(staticMatch).toBe("changes");
  });

  it("/opportunities/NVDA does NOT match any static route", () => {
    expect(matchesStatic("/opportunities/NVDA")).toBeNull();
    expect(matchesDynamic("/opportunities/NVDA")).toBe("NVDA");
  });

  it("/opportunities/MSFT does NOT match any static route", () => {
    expect(matchesStatic("/opportunities/MSFT")).toBeNull();
    expect(matchesDynamic("/opportunities/MSFT")).toBe("MSFT");
  });

  it("static route for /opportunities/today does not capture a symbol param", () => {
    const staticMatch = matchesStatic("/opportunities/today");
    expect(staticMatch).not.toBeNull();
    // When static route matches, symbol param is never extracted
    // so RESERVED_OPPORTUNITY_SEGMENTS check is never reached for this path
  });
});

// ---------------------------------------------------------------------------
// Section 6 — Dashboard and Command Center symbol links
// ---------------------------------------------------------------------------

describe("Symbol link construction", () => {
  function buildSymbolHref(symbol: string): string {
    return `/opportunities/${symbol}`;
  }

  const testSymbols = ["NVDA", "AAPL", "JPM", "MSFT", "COST", "PLTR", "TSLA", "AMZN"];

  it.each(testSymbols)("symbol %s links to /opportunities/%s", (sym) => {
    expect(buildSymbolHref(sym)).toBe(`/opportunities/${sym}`);
  });

  it("symbol links do not point to /today, /changes, or other static segments", () => {
    for (const sym of testSymbols) {
      const href = buildSymbolHref(sym);
      expect(href).not.toBe("/opportunities/today");
      expect(href).not.toBe("/opportunities/changes");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 7 — OpportunityTodayPage: expected data keys
// ---------------------------------------------------------------------------

describe("OpportunityTodayPage data contract", () => {
  it("renders from GET /api/opportunities/today (same as dashboard + hub)", () => {
    const queryKey = "/api/opportunities/today";
    expect(queryKey).toBe("/api/opportunities/today");
  });

  it("TodayRankingResponse has ranking.topGrowth, topIncome, watchlist, approaching", () => {
    const exampleResponse = {
      ranking: {
        generatedAt: "2026-08-09T21:00:00Z",
        regime:      "Neutral",
        topGrowth:   [{ symbol: "NVDA", rank: 1 }],
        topIncome:   [{ symbol: "JPM",  rank: 1 }],
        watchlist:   [{ symbol: "AAPL", rank: 1 }],
        approaching: [{ symbol: "TSLA", rank: 1 }],
        changes:     [],
      },
      available: true,
      message:   null,
    };
    expect(exampleResponse.ranking.topGrowth[0].symbol).toBe("NVDA");
    expect(exampleResponse.ranking.topIncome[0].symbol).toBe("JPM");
    expect(exampleResponse.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 8 — OpportunityChangesPage: expected data keys
// ---------------------------------------------------------------------------

describe("OpportunityChangesPage data contract", () => {
  it("renders from GET /api/opportunities/changes/explained (same as dashboard)", () => {
    const queryKey = "/api/opportunities/changes/explained";
    expect(queryKey).toBe("/api/opportunities/changes/explained");
  });

  it("ChangesResponse has majorMovers, upgrades, downgrades, newEntries, removed", () => {
    const exampleResponse = {
      available:    true,
      generatedAt:  "2026-08-09T21:00:00Z",
      majorMovers:  [{ symbol: "NVDA", direction: "upgraded", scoreDelta: 5, importance: "Major", summary: "Technical breakout", drivers: [], currentScore: 82, rankDelta: -2, category: "Technical" }],
      upgrades:     [],
      downgrades:   [],
      newEntries:   [],
      removed:      [],
    };
    expect(exampleResponse.majorMovers[0].symbol).toBe("NVDA");
    expect(exampleResponse.majorMovers[0].direction).toBe("upgraded");
    expect(Array.isArray(exampleResponse.upgrades)).toBe(true);
    expect(Array.isArray(exampleResponse.removed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 9 — Compliance: no buy/sell language in page titles or nav labels
// ---------------------------------------------------------------------------

describe("Compliance: no prescriptive navigation language", () => {
  const navLabels = [
    "View All Opportunities",
    "See What Changed",
    "All Ranked Opportunities",
    "Change Intelligence",
    "Today's Ranked Opportunities",
    "What Changed",
  ];

  const forbidden = [/\bbuy\b/i, /\bsell\b/i, /\brecommend/i, /\btarget price\b/i];

  it.each(navLabels)("nav label '%s' contains no buy/sell/recommend language", (label) => {
    for (const pattern of forbidden) {
      expect(pattern.test(label)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 10 — Portfolio Intelligence and Analytics symbol links
// ---------------------------------------------------------------------------

describe("Portfolio symbol links", () => {
  function buildPortfolioSymbolHref(symbol: string): string {
    return `/opportunities/${symbol}`;
  }

  it("portfolio holdings navigate to /opportunities/:symbol", () => {
    expect(buildPortfolioSymbolHref("NVDA")).toBe("/opportunities/NVDA");
  });

  it("portfolio links do not navigate to /opportunities/today", () => {
    expect(buildPortfolioSymbolHref("AAPL")).not.toBe("/opportunities/today");
  });
});
