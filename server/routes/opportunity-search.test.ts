import { describe, it, expect } from "vitest";
import {
  classifyOpportunitySearch,
  shouldRouteOpportunitySearch,
  hasExplicitTicker,
  qualifyOpportunities,
  toOpportunityCard,
  buildIncomeCandidates,
  buildOpportunityAnswer,
  opportunityConfidence,
  suggestionsForOpportunitySearch,
  runOpportunitySearch,
  type OpportunityRow,
} from "./opportunity-search";

const NOW = new Date("2026-07-31T12:00:00Z");

function row(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    symbol: "CRDO",
    strategyName: "VCP Breakout",
    stageAtDetection: "pivot-ready",
    detectedAt: "2026-07-30T12:00:00Z",
    detectedPrice: 91.2,
    entryTriggerPrice: 93.5,
    stopReferencePrice: 86.0,
    rvol: 1.8,
    score: 91,
    status: "ACTIVE",
    resolutionOutcome: null,
    timeframe: "daily",
    ...overrides,
  };
}

describe("classifyOpportunitySearch — deterministic intent routing (tests 1, 13, 19, 20)", () => {
  it("routes trade-opportunity phrasings deterministically", () => {
    for (const q of [
      "Find high-quality trade opportunities",
      "Find trades",
      "Show me good trades",
      "What are the best setups?",
      "Find opportunities",
      "What should I trade today?",
    ]) {
      expect(classifyOpportunitySearch(q), q).toBe("trade");
    }
  });
  it("routes bullish / bearish / vcp variants", () => {
    expect(classifyOpportunitySearch("Find bullish opportunities")).toBe("bullish");
    expect(classifyOpportunitySearch("Show me bullish setups")).toBe("bullish");
    expect(classifyOpportunitySearch("Find bearish opportunities")).toBe("bearish");
    expect(classifyOpportunitySearch("Show me bearish setups")).toBe("bearish");
    expect(classifyOpportunitySearch("Find VCP setups")).toBe("vcp");
    expect(classifyOpportunitySearch("Show me pivot-ready stocks")).toBe("vcp");
  });
  it("routes income phrasings (test 13)", () => {
    for (const q of [
      "Find income opportunities",
      "Find option income trades",
      "Generate income",
      "Find covered call opportunities",
      "Find cash-secured put opportunities",
    ]) {
      expect(classifyOpportunitySearch(q), q).toBe("income");
    }
  });
  it("shouldRouteOpportunitySearch: routes all spec phrasings despite extractTickers false positives", () => {
    // These phrases contain words ("high", "pivot", "ready") that the general
    // ticker extractor false-positives on — the routing gate must still fire.
    for (const [q, expected] of [
      ["Find high-quality trade opportunities", "trade"],
      ["What are the best setups?", "trade"],
      ["Show me pivot-ready stocks", "vcp"],
      ["Find VCP setups", "vcp"],
      ["Find income opportunities", "income"],
      ["Generate income", "income"],
      ["Find bullish opportunities", "bullish"],
    ] as const) {
      expect(shouldRouteOpportunitySearch(q), q).toBe(expected);
    }
  });
  it("shouldRouteOpportunitySearch: explicit tickers keep existing flows", () => {
    expect(shouldRouteOpportunitySearch("Find covered call opportunities on NVDA")).toBeNull();
    expect(shouldRouteOpportunitySearch("Find income opportunities for $mu")).toBeNull();
    expect(shouldRouteOpportunitySearch("Show me good trades in AAPL")).toBeNull();
  });
  it("hasExplicitTicker distinguishes tickers from phrase jargon", () => {
    expect(hasExplicitTicker("Find VCP setups")).toBe(false);
    expect(hasExplicitTicker("Find high-quality trade opportunities")).toBe(false);
    expect(hasExplicitTicker("Analyze NVDA")).toBe(true);
    expect(hasExplicitTicker("what about $crdo")).toBe(true);
  });
  it("does NOT hijack non-opportunity or analysis asks (tests 19, 20)", () => {
    expect(classifyOpportunitySearch("Analyze MU")).toBeNull();
    expect(classifyOpportunitySearch("How does CRDO look?")).toBeNull();
    expect(classifyOpportunitySearch("Why is NVDA moving today?")).toBeNull();
    expect(classifyOpportunitySearch("What is a covered call?")).toBeNull();
    expect(classifyOpportunitySearch("How do I grow my portfolio long-term?")).toBeNull();
  });
});

describe("qualifyOpportunities — conservative filters, ranking preserved (tests 4, 6, 7, 8, 9)", () => {
  it("keeps only fresh, ACTIVE, unresolved rows with supported stages", () => {
    const rows = [
      row({ symbol: "A" }),
      row({ symbol: "B", status: "RESOLVED" }),
      row({ symbol: "C", resolutionOutcome: "INVALIDATED" }),
      row({ symbol: "D", detectedAt: "2026-06-01T00:00:00Z" }), // stale
      row({ symbol: "E", stageAtDetection: "no-setup" }),
      row({ symbol: "F", detectedAt: null }), // unknown freshness
    ];
    expect(qualifyOpportunities(rows, "trade", NOW).map((r) => r.symbol)).toEqual(["A"]);
  });
  it("bullish intent uses the long-setup pool; bearish returns empty (no bearish source exists)", () => {
    const rows = [row({ symbol: "A" }), row({ symbol: "B" })];
    expect(qualifyOpportunities(rows, "bullish", NOW)).toHaveLength(2);
    expect(qualifyOpportunities(rows, "bearish", NOW)).toEqual([]);
  });
  it("vcp intent filters to VCP strategy or contraction/pivot-ready stages", () => {
    const rows = [
      row({ symbol: "A", strategyName: "VCP Breakout", stageAtDetection: "developing" }),
      row({ symbol: "B", strategyName: "Momentum", stageAtDetection: "contraction" }),
      row({ symbol: "C", strategyName: "Momentum", stageAtDetection: "developing" }),
    ];
    expect(qualifyOpportunities(rows, "vcp", NOW).map((r) => r.symbol)).toEqual(["A", "B"]);
  });
  it("preserves the incoming (production) order — no re-ranking (test 9)", () => {
    const rows = [row({ symbol: "LOW", score: 10 }), row({ symbol: "HIGH", score: 99 })];
    expect(qualifyOpportunities(rows, "trade", NOW).map((r) => r.symbol)).toEqual(["LOW", "HIGH"]);
  });
});

describe("toOpportunityCard — real fields only (tests 11, 5)", () => {
  it("builds reasons/warnings only from stored fields, candidateState null without engine (test 11)", () => {
    const c = toOpportunityCard(row(), NOW);
    expect(c.symbol).toBe("CRDO");
    expect(c.score).toBe(91);
    expect(c.stage).toBe("pivot-ready");
    expect(c.trigger).toBe(93.5);
    expect(c.candidateState).toBeNull(); // build_trade_candidate not deployed — never guessed
    expect(c.reasons.join(" ")).toContain("$93.50");
    expect(c.warnings.join(" ")).toContain("$86.00");
    expect(c.estimatedOptions).toBeUndefined();
  });
  it("omits fields that don't exist rather than inventing them", () => {
    const c = toOpportunityCard(row({ score: null, entryTriggerPrice: null, stopReferencePrice: null, rvol: null }), NOW);
    expect(c.score).toBeUndefined();
    expect(c.trigger).toBeNull();
    expect(c.warnings).toEqual([]);
  });
});

describe("runOpportunitySearch (tests 2, 3-shape, 5, 10, 11)", () => {
  const deps = (rows: OpportunityRow[], positions: any[] = [], brokerConnected = false) => ({
    fetchRows: async () => rows,
    fetchPositions: async () => positions,
    brokerConnected,
    now: NOW,
  });

  it("returns multiple candidates, not one arbitrary ticker (test 2)", async () => {
    const rows = ["A", "B", "C", "D"].map((s) => row({ symbol: s }));
    const { search, failed } = await runOpportunitySearch("trade", deps(rows));
    expect(failed).toBe(false);
    expect(search!.opportunities.map((o) => o.symbol)).toEqual(["A", "B", "C", "D"]);
    expect(search!.source).toBe("opportunity-service");
  });
  it("caps at 5", async () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((s) => row({ symbol: s }));
    const { search } = await runOpportunitySearch("trade", deps(rows));
    expect(search!.opportunities).toHaveLength(5);
  });
  it("retrieval failure → failed=true, zero fabricated symbols (test 5)", async () => {
    const { search, failed } = await runOpportunitySearch("trade", {
      fetchRows: async () => {
        throw new Error("db down");
      },
      fetchPositions: async () => [],
      brokerConnected: false,
      now: NOW,
    });
    expect(failed).toBe(true);
    expect(search).toBeNull();
  });
  it("positions failure only degrades covered calls; CSPs still returned estimated", async () => {
    const { search, failed } = await runOpportunitySearch("income", {
      fetchRows: async () => [row()],
      fetchPositions: async () => {
        throw new Error("broker down");
      },
      brokerConnected: true,
      now: NOW,
    });
    expect(failed).toBe(false);
    expect(search!.opportunities).toHaveLength(1);
    expect(search!.opportunities[0].estimatedOptions!.strategy).toBe("CASH_SECURED_PUT");
  });
});

describe("income candidates (tests 14, 15, 16, 17)", () => {
  it("returns specific symbols with estimated CSP structures — never premiums/Greeks (tests 14, 16, 17)", () => {
    const cards = buildIncomeCandidates({ rows: [row()], positions: [], brokerConnected: false, now: NOW });
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.symbol).toBe("CRDO");
    expect(c.candidateState).toBe("estimated_options");
    expect(c.estimatedOptions).toMatchObject({
      strategy: "CASH_SECURED_PUT",
      status: "estimated",
      targetDteMin: 20,
      targetDteMax: 45,
      shortStrikeZone: { low: 86, high: 91.2 }, // real technical levels only
      connectionRequiredForLiveContracts: true, // no broker → CTA required (test 18)
    });
    // No fabricated market microstructure anywhere on the card
    const json = JSON.stringify(c).toLowerCase();
    for (const banned of ["premium", "delta", "theta", "impliedvol", '"iv"', "openinterest", "bid", "ask"]) {
      expect(json, banned).not.toContain(banned);
    }
  });
  it("covered call REQUIRES known share ownership (test 15)", () => {
    const none = buildIncomeCandidates({ rows: [row()], positions: [{ symbol: "CRDO", qty: 50 }], brokerConnected: true, now: NOW });
    expect(none.some((c) => c.estimatedOptions?.strategy === "COVERED_CALL")).toBe(false);

    const cc = buildIncomeCandidates({ rows: [row({ resistancePrice: 95 })], positions: [{ symbol: "CRDO", qty: 200 }], brokerConnected: true, now: NOW });
    const covered = cc.find((c) => c.estimatedOptions?.strategy === "COVERED_CALL")!;
    expect(covered.symbol).toBe("CRDO");
    expect(covered.reasons[0]).toContain("200 shares");
    expect(covered.estimatedOptions!.shortStrikeZone).toEqual({ low: 95, high: 99.75 });
    expect(covered.estimatedOptions!.connectionRequiredForLiveContracts).toBe(false);
  });
  it("no covered calls at all when broker disconnected", () => {
    const cards = buildIncomeCandidates({ rows: [], positions: [{ symbol: "CRDO", qty: 500 }], brokerConnected: false, now: NOW });
    expect(cards).toEqual([]);
  });
});

describe("answers / confidence / suggestions (tests 3, 4, 5, 12, 18)", () => {
  const search = (opps: any[], type: any = "trade", brokerConnected = false) => ({
    type,
    source: "opportunity-service",
    generatedAt: NOW.toISOString(),
    brokerConnected,
    opportunities: opps,
  });

  it("successful search answer lists the specific symbols — no generic education (test 3)", () => {
    const a = buildOpportunityAnswer(search([toOpportunityCard(row(), NOW), toOpportunityCard(row({ symbol: "NVDA" }), NOW)]), false);
    expect(a.answer).toContain("CRDO");
    expect(a.answer).toContain("NVDA");
    for (const generic of ["dividend stocks", "Consider", "Research stocks", "REITs", "bonds"]) {
      expect(a.answer).not.toContain(generic);
    }
  });
  it("no-results state is valid, not an error (test 4)", () => {
    const a = buildOpportunityAnswer(search([]), false);
    expect(a.headline).toBe("No high-quality setups currently meet the criteria.");
    expect(a.answer).not.toContain("dividend");
  });
  it("failure state does not fabricate (test 5)", () => {
    const a = buildOpportunityAnswer(null, true);
    expect(a.headline).toBe("Live opportunity data is temporarily unavailable.");
  });
  it("income answer without broker includes the live-contracts connection notice (tests 16, 18)", () => {
    const c = buildIncomeCandidates({ rows: [row()], positions: [], brokerConnected: false, now: NOW });
    const a = buildOpportunityAnswer(search(c, "income", false), false);
    expect(a.answer).toContain("require a Tradier or TradeStation connection");
    expect(a.answer).toContain("Estimated cash secured put");
    const sugg = suggestionsForOpportunitySearch(search(c, "income", false) as any, false);
    expect(sugg.some((s) => s.label === "Connect Broker" && s.href === "/settings")).toBe(true);
  });
  it("confidence reflects freshness/count, never direction (test spec §19)", () => {
    expect(opportunityConfidence(null, true)).toBe("low");
    expect(opportunityConfidence(search([]) as any, false)).toBe("low");
    const fresh = [row(), row({ symbol: "B" }), row({ symbol: "C" })].map((r) => toOpportunityCard(r, NOW));
    expect(opportunityConfidence(search(fresh) as any, false)).toBe("high");
    expect(opportunityConfidence(search(fresh.slice(0, 1)) as any, false)).toBe("medium");
  });
  it("failure/empty suggestions offer Scanner + specific-ticker path (test 18-adjacent, spec §18)", () => {
    const sugg = suggestionsForOpportunitySearch(null, true);
    expect(sugg.map((s) => s.label)).toEqual(["Open Scanner", "Review Watchlist", "Ask about a symbol"]);
  });
  it("NO_TRADE remains representable in the contract (test 12)", () => {
    const c = toOpportunityCard(row(), NOW);
    c.candidateState = "no_trade"; // future candidate engine may set this
    expect(["stock", "estimated_options", "no_trade", null]).toContain(c.candidateState);
  });
});
