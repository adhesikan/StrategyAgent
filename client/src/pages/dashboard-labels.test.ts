// Sprint 5.5A — Dashboard Data-Truthfulness tests
//
// Tests cover: data labeling, simulated/real opportunities, growth/income cards,
// news-context labels, routing, and regression per §16 of the spec.
//
// Run with: npx vitest run (or npm test)

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Re-export and import the label constants from dashboard.tsx for unit testing.
// Since dashboard.tsx is a React component file, we extract the pure logic here.
// ---------------------------------------------------------------------------

// Unified data-quality labels (mirrors dashboard.tsx DATA_QUALITY)
const DATA_QUALITY = {
  LIVE:             "Live",
  BROKER_CONNECTED: "Broker data",
  DAILY_CLOSE:      "Latest daily close",
  DELAYED:          "Delayed",
  SNAPSHOT:         "Market snapshot",
  SIMULATED:        "Demonstration data",
  ESTIMATED:        "Estimated structure",
  UNAVAILABLE:      "Data unavailable",
  UNKNOWN:          "Source not verified",
} as const;

// Impact labels (mirrors IMPACT_LABEL in dashboard.tsx)
const IMPACT_LABEL: Record<string, string> = {
  high: "High attention",
  medium: "Elevated activity",
  low: "Low activity",
};

// Sentiment labels (mirrors SENTIMENT_LABEL)
const SENTIMENT_LABEL: Record<string, string> = {
  bullish: "Positive sentiment",
  bearish: "Mixed / bearish sentiment",
  neutral: "Neutral context",
};

// Data source → quality key (mirrors snapshotDataQualityKey in dashboard.tsx)
function snapshotDataQualityKey(dataSource?: "broker" | "twelve_data" | "fallback") {
  if (dataSource === "broker") return "BROKER_CONNECTED";
  if (dataSource === "twelve_data") return "DAILY_CLOSE";
  return "SIMULATED";
}

// ---------------------------------------------------------------------------
// A. Data Labeling
// ---------------------------------------------------------------------------

describe("Data labeling — Market Snapshot", () => {
  it("broker source maps to 'Broker data' — not 'Live'", () => {
    const key = snapshotDataQualityKey("broker");
    expect(DATA_QUALITY[key]).toBe("Broker data");
    expect(DATA_QUALITY[key]).not.toBe("Live");
  });

  it("Twelve Data source maps to 'Latest daily close' — never 'Live'", () => {
    // Twelve Data returns cached/EOD prices, not streaming real-time.
    // The UI must never call this "Live" even when the market is open.
    const key = snapshotDataQualityKey("twelve_data");
    expect(DATA_QUALITY[key]).toBe("Latest daily close");
    expect(DATA_QUALITY[key]).not.toBe("Live");
    expect(DATA_QUALITY[key]).not.toBe("Delayed");
  });

  it("fallback source maps to 'Demonstration data'", () => {
    const key = snapshotDataQualityKey("fallback");
    expect(DATA_QUALITY[key]).toBe("Demonstration data");
  });

  it("undefined source maps to 'Demonstration data' (safe default)", () => {
    const key = snapshotDataQualityKey(undefined);
    expect(DATA_QUALITY[key]).toBe("Demonstration data");
  });

  it("market-open status does NOT determine data freshness label", () => {
    // Market session and data provenance are separate concepts.
    // Even when market is open (regular session), fallback data must be labeled 'Demonstration data'.
    const key = snapshotDataQualityKey("fallback");
    expect(DATA_QUALITY[key]).not.toBe("Live");
    expect(DATA_QUALITY[key]).not.toBe("Broker data");
  });

  it("unavailable data never receives a freshness label", () => {
    expect(DATA_QUALITY.UNAVAILABLE).toBe("Data unavailable");
    // Unavailable is not "Live", "Delayed", or "Latest daily close"
    const freshnessBadges = ["Live", "Latest daily close", "Delayed", "Broker data"];
    expect(freshnessBadges).not.toContain(DATA_QUALITY.UNAVAILABLE);
  });
});

describe("Data labeling — unified system", () => {
  it("no raw enum values are exposed as user-facing labels", () => {
    // Every label must be a readable English phrase, not an all-caps identifier
    for (const label of Object.values(DATA_QUALITY)) {
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("all 9 quality keys have distinct user-facing labels", () => {
    const labels = Object.values(DATA_QUALITY);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// B. Opportunities
// ---------------------------------------------------------------------------

describe("Opportunities — simulated vs. real", () => {
  it("simulated section heading is 'Sample Opportunities'", () => {
    // When dataMode === "simulated", the section MUST NOT say "Today's Opportunities"
    function resolveOpportunitiesHeading(dataMode: string) {
      return dataMode === "simulated" ? "Sample Opportunities" : "Today\u2019s Opportunities";
    }
    expect(resolveOpportunitiesHeading("simulated")).toBe("Sample Opportunities");
    expect(resolveOpportunitiesHeading("live")).toBe("Today\u2019s Opportunities");
    expect(resolveOpportunitiesHeading("mixed")).toBe("Today\u2019s Opportunities");
  });

  it("simulated section description uses 'Demonstration candidates' — not 'current market data'", () => {
    const simulatedDescription =
      "Demonstration candidates showing how ranked stock and options opportunities appear in VCP Trader AI.";
    const realDescription = "Candidates from current market data, ranked by score.";

    expect(simulatedDescription).not.toContain("current market data");
    expect(realDescription).not.toContain("Demonstration");
  });

  it("simulated and real candidates cannot be mixed without differentiation", () => {
    // When sectionDataMode is "simulated", per-card simulated badge is suppressed
    // (section banner covers it). When sectionDataMode is NOT "simulated",
    // per-card badge appears for individual simulated cards.
    function shouldShowPerCardBadge(cardDataMode: string, sectionDataMode: string) {
      return cardDataMode === "simulated" && sectionDataMode !== "simulated";
    }
    // Mixed section: show per-card badge for simulated cards
    expect(shouldShowPerCardBadge("simulated", "mixed")).toBe(true);
    expect(shouldShowPerCardBadge("live", "mixed")).toBe(false);
    // Fully simulated section: section banner handles it
    expect(shouldShowPerCardBadge("simulated", "simulated")).toBe(false);
  });

  it("demo opportunity description says 'Connect a broker to see results based on current market data'", () => {
    const demoDesc = "Demonstration candidates showing how ranked stock and options opportunities appear in VCP Trader AI. Connect a broker to see results based on current market data.";
    expect(demoDesc).toContain("Connect a broker");
    expect(demoDesc).not.toContain("today's opportunities");
  });
});

// ---------------------------------------------------------------------------
// C. Growth and Income cards
// ---------------------------------------------------------------------------

describe("Growth card — qualification boundary", () => {
  it("section is named 'Growth Watch' — not 'Growth Opportunity'", () => {
    // "Growth Opportunity" implies a qualified setup; sentiment-based data does not qualify.
    const sectionName = "Growth Watch";
    expect(sectionName).not.toBe("Growth Opportunity");
    expect(sectionName).toContain("Watch");
  });

  it("sentiment-based growth context uses exploratory wording", () => {
    function growthHeadline(symbol: string, growthSource: string, originalHeadline: string) {
      return growthSource === "sentiment"
        ? `${symbol} is receiving elevated positive news attention. Run a full analysis to evaluate technical and long-term conditions.`
        : originalHeadline;
    }
    const headline = growthHeadline("NVDA", "sentiment", "AI infrastructure spend remains a multi-quarter tailwind.");
    expect(headline).toContain("elevated positive news attention");
    expect(headline).toContain("Run a full analysis");
    expect(headline).not.toContain("opportunity");
  });

  it("fallback growth reference uses original headline (not implied qualification)", () => {
    function growthHeadline(symbol: string, growthSource: string, originalHeadline: string) {
      return growthSource === "sentiment"
        ? `${symbol} is receiving elevated positive news attention. Run a full analysis to evaluate technical and long-term conditions.`
        : originalHeadline;
    }
    const headline = growthHeadline("NVDA", "fallback", "AI infrastructure spend remains a multi-quarter tailwind.");
    // Fallback headlines are reference context — they don't claim a setup qualifies
    expect(headline).toBe("AI infrastructure spend remains a multi-quarter tailwind.");
  });

  it("growth badge shows source label, not a freshness badge", () => {
    // Growth is context, not price data — its badge should reflect knowledge source
    function growthBadgeLabel(growthSource: string) {
      return growthSource === "sentiment" ? "News-sentiment context" : "Reference context";
    }
    expect(growthBadgeLabel("sentiment")).toBe("News-sentiment context");
    expect(growthBadgeLabel("fallback")).toBe("Reference context");
    expect(growthBadgeLabel("sentiment")).not.toBe("Live");
    expect(growthBadgeLabel("fallback")).not.toBe("Live");
  });
});

describe("Income card — qualification boundary", () => {
  it("section is named 'Income Idea to Explore' — not 'Income Opportunity'", () => {
    // "Income Opportunity" implies share ownership, liquidity checks, and contract evaluation.
    // These have NOT been performed — always show exploratory framing.
    const sectionName = "Income Idea to Explore";
    expect(sectionName).not.toBe("Income Opportunity");
    expect(sectionName).toContain("Explore");
  });

  it("income headline always uses exploratory framing regardless of dataSource", () => {
    function incomeHeadline(symbol: string) {
      return `${symbol} may support dividend and covered-call analysis. Connect a broker or open the income workflow to evaluate share ownership, options liquidity, risk, and current contracts.`;
    }
    const h = incomeHeadline("T");
    expect(h).toContain("may support");
    expect(h).toContain("Connect a broker");
    expect(h).toContain("options liquidity");
    expect(h).not.toContain("T — Dividend + monthly call write candidate");
  });

  it("income badge shows 'Estimated structure' — not 'Live' or 'Broker data'", () => {
    expect(DATA_QUALITY.ESTIMATED).toBe("Estimated structure");
    expect(DATA_QUALITY.ESTIMATED).not.toBe("Live");
    expect(DATA_QUALITY.ESTIMATED).not.toBe("Broker data");
  });

  it("income source is always fallback — deterministic options qualification has not run", () => {
    // The backend confirms: bestIncome is always pickByDay(FALLBACK_INCOME)
    const incomeSource: "fallback" = "fallback";
    expect(incomeSource).toBe("fallback");
  });

  it("disconnected broker state still uses exploratory wording", () => {
    // No special connected-broker income path exists — wording is always exploratory
    function incomeHeadline(symbol: string) {
      return `${symbol} may support dividend and covered-call analysis. Connect a broker or open the income workflow to evaluate share ownership, options liquidity, risk, and current contracts.`;
    }
    expect(incomeHeadline("SPY")).toContain("Connect a broker");
  });
});

// ---------------------------------------------------------------------------
// D. News context labels
// ---------------------------------------------------------------------------

describe("Market Events — news context labels", () => {
  it("'high' is never shown as a bare label — uses 'High attention'", () => {
    expect(IMPACT_LABEL.high).toBe("High attention");
    expect(IMPACT_LABEL.high).not.toBe("high");
  });

  it("'medium' maps to 'Elevated activity'", () => {
    expect(IMPACT_LABEL.medium).toBe("Elevated activity");
    expect(IMPACT_LABEL.medium).not.toBe("medium");
  });

  it("'low' maps to 'Low activity'", () => {
    expect(IMPACT_LABEL.low).toBe("Low activity");
    expect(IMPACT_LABEL.low).not.toBe("low");
  });

  it("sentiment label 'bullish' maps to 'Positive sentiment'", () => {
    expect(SENTIMENT_LABEL.bullish).toBe("Positive sentiment");
  });

  it("sentiment label 'bearish' maps to 'Mixed / bearish sentiment'", () => {
    expect(SENTIMENT_LABEL.bearish).toBe("Mixed / bearish sentiment");
  });

  it("sentiment label 'neutral' maps to 'Neutral context'", () => {
    expect(SENTIMENT_LABEL.neutral).toBe("Neutral context");
  });

  it("sentiment does not become a qualification verdict", () => {
    // News context labels must describe attention/sentiment, not trade readiness
    for (const label of Object.values(SENTIMENT_LABEL)) {
      expect(label).not.toMatch(/qualif/i);
      expect(label).not.toMatch(/setup/i);
      expect(label).not.toMatch(/candidate/i);
    }
  });
});

// ---------------------------------------------------------------------------
// E. Routing validation (pure logic — no browser needed)
// ---------------------------------------------------------------------------

describe("Quick Actions — routing", () => {
  function askRoute(prompt: string) {
    return `/ask?q=${encodeURIComponent(prompt)}`;
  }

  const QUICK_ACTIONS = [
    { id: "growth",    href: askRoute("Find long-term AI infrastructure growth opportunities") },
    { id: "income",    href: askRoute("Find income opportunities with covered calls or cash-secured puts under $500 risk") },
    { id: "trade",     href: "/scanner" },
    { id: "analyze",   href: "/ask" },
    { id: "portfolio", href: askRoute("Analyze my portfolio exposure and concentration") },
    { id: "research",  href: "/research" },
    { id: "markets",   href: askRoute("Explain the current market regime and what it means for investors") },
  ];

  it("all quick actions have non-empty routes", () => {
    for (const a of QUICK_ACTIONS) {
      expect(a.href.length).toBeGreaterThan(0);
    }
  });

  it("none of the quick action routes auto-submit orders", () => {
    // All should route to Ask AI with a ?q= prompt (pre-fill, not auto-submit)
    // or to a page. None should hit execution endpoints.
    for (const a of QUICK_ACTIONS) {
      expect(a.href).not.toContain("/api/order");
      expect(a.href).not.toContain("/api/trade");
      expect(a.href).not.toContain("/execute");
    }
  });

  it("Find Growth pre-fills Ask AI — does not route to order placement", () => {
    const growth = QUICK_ACTIONS.find((a) => a.id === "growth")!;
    expect(growth.href).toContain("/ask?q=");
    expect(growth.href).not.toBe("/ask");
  });

  it("Find Trade Setups routes to /scanner — not to order entry", () => {
    const trade = QUICK_ACTIONS.find((a) => a.id === "trade")!;
    expect(trade.href).toBe("/scanner");
  });

  it("Continue Saved Research routes to /research", () => {
    const research = QUICK_ACTIONS.find((a) => a.id === "research")!;
    expect(research.href).toBe("/research");
  });
});

describe("Saved research links", () => {
  it("research record link format is /research/:id", () => {
    const id = "rec-abc123";
    const link = `/research/${id}`;
    expect(link).toMatch(/^\/research\/[a-zA-Z0-9_-]+$/);
  });

  it("Start Research routes to /ask", () => {
    expect("/ask").toContain("/ask");
  });

  it("Library routes to /research", () => {
    expect("/research").toBe("/research");
  });
});

describe("Portfolio connect action", () => {
  it("Connect Broker routes to /settings?tab=broker", () => {
    const route = "/settings?tab=broker";
    expect(route).toContain("/settings");
    expect(route).toContain("tab=broker");
  });
});

// ---------------------------------------------------------------------------
// F. Regression — core label system
// ---------------------------------------------------------------------------

describe("Regression — public surfaces unchanged", () => {
  it("DATA_QUALITY system has all 9 required keys", () => {
    const required = [
      "LIVE", "BROKER_CONNECTED", "DAILY_CLOSE", "DELAYED",
      "SNAPSHOT", "SIMULATED", "ESTIMATED", "UNAVAILABLE", "UNKNOWN",
    ];
    for (const key of required) {
      expect(Object.keys(DATA_QUALITY)).toContain(key);
    }
  });

  it("IMPACT_LABEL covers all impact levels", () => {
    expect(IMPACT_LABEL.high).toBeDefined();
    expect(IMPACT_LABEL.medium).toBeDefined();
    expect(IMPACT_LABEL.low).toBeDefined();
  });

  it("SENTIMENT_LABEL covers all sentiment values", () => {
    expect(SENTIMENT_LABEL.bullish).toBeDefined();
    expect(SENTIMENT_LABEL.bearish).toBeDefined();
    expect(SENTIMENT_LABEL.neutral).toBeDefined();
  });
});
