// Tests for the MCP-backed deterministic opportunity orchestration (Sprint 2).
// Run: npx vitest run --root . server/routes/opportunity-search-mcp.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseMaxRisk,
  strategyFilterFor,
  runMcpOpportunitySearch,
  toMcpOpportunityCard,
  buildMcpOpportunityAnswer,
  mcpOpportunityConfidence,
  type McpSetup,
  type McpCandidate,
  type McpSearchDeps,
} from "./opportunity-search-mcp";
import { classifyOpportunitySearch, shouldRouteOpportunitySearch } from "./opportunity-search";

function setup(symbol: string, strategy: string, score: number, status = "ready"): McpSetup {
  return {
    symbol,
    strategy,
    strategyDisplayName: strategy.replace(/_/g, " "),
    direction: "bullish",
    score,
    status,
    timeframe: "1day",
    trigger: { price: 100, basis: "structure_level" },
    invalidation: { price: 92, basis: "invalidation_level" },
    technicalObjective: { price: 115, basis: "measured_move" },
    currentPrice: 98,
    reasons: [`${strategy} setup`],
    warnings: [],
    detectedAt: "2026-08-03T13:00:00.000Z",
    source: "vcp_trader",
  };
}

function stockCandidate(symbol: string, riskPerShare = 8): McpCandidate {
  return {
    symbol,
    verdict: "STOCK",
    direction: "bullish",
    stockCandidate: {
      trigger: { price: 100, basis: "structure_level" },
      riskPlan: { suggestedStopZone: { low: 100 - riskPerShare, high: 100 - riskPerShare / 2, basis: "ATR" }, riskPerShare },
      technicalObjective: { price: 115, basis: "measured_move" },
    },
    earningsRisk: { status: "clear", nextEarningsDate: null, daysUntilEarnings: null },
  };
}

function deps(overrides: Partial<McpSearchDeps> & { setups?: McpSetup[]; candidates?: Record<string, McpCandidate | Error> }): McpSearchDeps {
  const setups = overrides.setups ?? [];
  const candidates = overrides.candidates ?? {};
  return {
    scanOpportunities: overrides.scanOpportunities ?? (async () => ({ opportunities: setups, count: setups.length, generatedAt: "2026-08-03T13:00:00.000Z" })),
    buildTradeCandidate:
      overrides.buildTradeCandidate ??
      (async (symbol: string) => {
        const c = candidates[symbol];
        if (c instanceof Error) throw c;
        return c ?? stockCandidate(symbol);
      }),
    calculatePositionRisk:
      overrides.calculatePositionRisk ??
      (async (a) => ({
        symbol: a.symbol,
        riskPerShare: a.entryPrice - a.stopPrice,
        suggestedMaxShares: a.maxRiskDollars ? Math.floor(a.maxRiskDollars / (a.entryPrice - a.stopPrice)) : null,
        maxRiskDollars: a.maxRiskDollars ?? null,
        warnings: [],
      })),
    brokerConnected: overrides.brokerConnected ?? false,
    now: new Date("2026-08-03T14:00:00Z"),
  };
}

describe("parseMaxRisk", () => {
  it("parses 'under $X maximum risk' phrasings", () => {
    expect(parseMaxRisk("Find trades under $500 maximum risk")).toBe(500);
    expect(parseMaxRisk("find trades under $1,250 max risk")).toBe(1250);
    expect(parseMaxRisk("show setups under 300 risk")).toBe(300);
    expect(parseMaxRisk("find trades risking $750")).toBe(750);
    expect(parseMaxRisk("max risk $200 please")).toBe(200);
  });
  it("returns null when no budget given", () => {
    expect(parseMaxRisk("Find high-quality trade opportunities")).toBeNull();
    expect(parseMaxRisk("What should I trade today?")).toBeNull();
  });
});

describe("intent routing (unchanged prompts still classify)", () => {
  it("routes the spec prompt set", () => {
    for (const q of [
      "Find Trades",
      "Find high-quality trade opportunities",
      "Find bullish setups",
      "Find bearish setups",
      "Find VCP setups",
      "Find momentum breakout setups",
      "Find trades under $500 maximum risk",
      "What should I trade today?",
    ]) {
      expect(shouldRouteOpportunitySearch(q), q).not.toBeNull();
    }
    expect(classifyOpportunitySearch("Generate Income")).toBe("income");
  });
  it("non-opportunity prompts stay unrouted (Analyze path untouched)", () => {
    expect(shouldRouteOpportunitySearch("Analyze MU")).toBeNull();
    expect(shouldRouteOpportunitySearch("What is a VCP?")).toBeNull();
    expect(shouldRouteOpportunitySearch("covered call on NVDA")).toBeNull();
    expect(shouldRouteOpportunitySearch("How is the market today?")).toBeNull();
  });
  it("derives strategy filters deterministically", () => {
    expect(strategyFilterFor("Find VCP setups", "vcp")).toEqual(["vcp"]);
    expect(strategyFilterFor("Find momentum breakout setups", "trade")).toEqual(["momentum_breakout"]);
    expect(strategyFilterFor("Find trades", "trade")).toBeUndefined();
  });
});

describe("runMcpOpportunitySearch", () => {
  it("retrieves multi-strategy opportunities and preserves MCP ranking", async () => {
    const setups = [setup("NVDA", "momentum_breakout", 92), setup("NVDA", "vcp", 88), setup("MU", "volume_surge", 85)];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups }));
    expect(r.source).toBe("mcp");
    expect(r.opportunities.map((o) => `${o.setup.symbol}:${o.setup.strategy}`)).toEqual([
      "NVDA:momentum_breakout",
      "NVDA:vcp",
      "MU:volume_surge",
    ]);
    expect(r.opportunities.map((o) => o.rank)).toEqual([1, 2, 3]);
    // duplicate symbol with multiple strategies preserved
    expect(r.opportunities.filter((o) => o.setup.symbol === "NVDA")).toHaveLength(2);
  });

  it("builds candidates only for scanned symbols — never fabricates", async () => {
    const setups = [setup("AAPL", "vcp", 80)];
    const built: string[] = [];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({
        setups,
        buildTradeCandidate: async (s: string) => {
          built.push(s);
          return stockCandidate(s);
        },
      }),
    );
    expect(built).toEqual(["AAPL"]);
    expect(r.opportunities.map((o) => o.setup.symbol)).toEqual(["AAPL"]);
  });

  it("caps candidate building at the top 5", async () => {
    const setups = Array.from({ length: 9 }, (_, i) => setup(`S${i}`, "vcp", 90 - i));
    const built: string[] = [];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({ setups, buildTradeCandidate: async (s: string) => (built.push(s), stockCandidate(s)) }),
    );
    expect(built).toHaveLength(5);
    expect(r.opportunities).toHaveLength(5);
  });

  it("keeps NO_TRADE verdicts as honest, displayable results", async () => {
    const setups = [setup("TSLA", "vcp", 70)];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({ setups, candidates: { TSLA: { verdict: "NO_TRADE", noTradeReasons: ["Earnings in 2 days"] } } }),
    );
    expect(r.opportunities).toHaveLength(1);
    const card = toMcpOpportunityCard(r.opportunities[0], false);
    expect(card.verdict).toBe("NO_TRADE");
    expect(card.candidateState).toBe("no_trade");
    expect(card.warnings).toContain("Earnings in 2 days");
  });

  it("degrades per-item on build_trade_candidate failure (candidate null)", async () => {
    const setups = [setup("A", "vcp", 90), setup("B", "vcp", 85)];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({ setups, candidates: { A: stockCandidate("A"), B: new Error("boom") } }),
    );
    expect(r.opportunities[0].candidate).not.toBeNull();
    expect(r.opportunities[1].candidate).toBeNull();
    const card = toMcpOpportunityCard(r.opportunities[1], false);
    expect(card.verdict).toBeNull();
    expect(card.candidateState).toBeNull();
  });

  it("throws on scan failure so the caller can fall back (never fabricates)", async () => {
    await expect(
      runMcpOpportunitySearch("trade", "Find trades", deps({ scanOpportunities: async () => { throw new Error("MCP down"); } })),
    ).rejects.toThrow("MCP down");
  });

  it("attaches risk estimates when the user gives a budget", async () => {
    const setups = [setup("NVDA", "vcp", 90)];
    const r = await runMcpOpportunitySearch("trade", "Find trades under $500 maximum risk", deps({ setups }));
    expect(r.maxRiskDollars).toBe(500);
    const est = r.opportunities[0].riskEstimate!;
    expect(est.maxRiskDollars).toBe(500);
    expect(est.suggestedMaxShares).toBe(Math.floor(500 / 8)); // stop zone low 92 vs entry 100
  });

  it("max-risk filtering excludes candidates the budget cannot size", async () => {
    const setups = [setup("HI", "vcp", 95), setup("OK", "vcp", 90)];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades under $5 maximum risk",
      deps({ setups, candidates: { HI: stockCandidate("HI", 50), OK: stockCandidate("OK", 3) } }),
    );
    expect(r.opportunities.map((o) => o.setup.symbol)).toEqual(["OK"]);
    expect(r.opportunities[0].rank).toBe(1); // re-ranked after exclusion
    expect(r.excludedByRisk).toBe(1);
  });

  it("no budget → no risk calls", async () => {
    let riskCalls = 0;
    const setups = [setup("NVDA", "vcp", 90)];
    await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({ setups, calculatePositionRisk: async () => (riskCalls++, {}) }),
    );
    expect(riskCalls).toBe(0);
  });

  it("bearish searches never repurpose bullish results", async () => {
    const setups = [setup("NVDA", "vcp", 90)]; // direction bullish
    const r = await runMcpOpportunitySearch("bearish", "Find bearish setups", deps({ setups }));
    expect(r.opportunities).toHaveLength(0);
  });
});

describe("cards and answers", () => {
  it("cards carry rank, levels, verdict and raw setup/candidate", async () => {
    const setups = [setup("NVDA", "momentum_breakout", 92)];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups }));
    const card = toMcpOpportunityCard(r.opportunities[0], false);
    expect(card.rank).toBe(1);
    expect(card.symbol).toBe("NVDA");
    expect(card.trigger).toBe(100);
    expect(card.invalidation?.price).toBe(92);
    expect(card.technicalObjective?.price).toBe(115);
    expect(card.status).toBe("ready");
    expect(card.verdict).toBe("STOCK");
    expect(card.setup.symbol).toBe("NVDA");
    expect(card.candidate?.verdict).toBe("STOCK");
  });

  it("zero results use the spec sentence, never educational prose", () => {
    const a = buildMcpOpportunityAnswer({
      intent: "trade", source: "mcp", generatedAt: "x", brokerConnected: false, maxRiskDollars: null, opportunities: [],
    });
    expect(a.headline).toBe("No high-quality setups currently meet your criteria.");
    expect(a.answer).toContain("No high-quality setups currently meet your criteria.");
    expect(a.answer).not.toMatch(/consider dividend|research stocks|look for companies/i);
  });

  it("answer lines include verdict, levels and risk sizing", async () => {
    const setups = [setup("NVDA", "vcp", 90)];
    const r = await runMcpOpportunitySearch("trade", "Find trades under $500 maximum risk", deps({ setups }));
    const a = buildMcpOpportunityAnswer(r);
    expect(a.answer).toContain("Verdict: STOCK");
    expect(a.answer).toContain("Entry trigger: $100.00");
    expect(a.answer).toContain("Invalidation: $92.00");
    expect(a.answer).toContain("Objective: $115.00");
    expect(a.answer).toMatch(/\$500\.00 budget/);
  });

  it("confidence is deterministic: completeness only", async () => {
    const setups = [setup("A", "vcp", 90), setup("B", "vcp", 85), setup("C", "vcp", 80)];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups }));
    expect(mcpOpportunityConfidence(r)).toBe("high");
    expect(mcpOpportunityConfidence({ ...r, opportunities: [] })).toBe("low");
  });
});

describe("safety boundaries", () => {
  it("module has no execution or broker-order code paths", () => {
    const src = readFileSync(new URL("./opportunity-search-mcp.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/placeBrokerOrder|place-equity|place-option|submitOrder|placeOrder/);
    expect(src).not.toMatch(/from ["']\.\.\/broker/);
  });
  it("only reads allowlisted read-only MCP tools via injected deps", () => {
    const src = readFileSync(new URL("./opportunity-search-mcp.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/mcpClient|callTool\(/);
  });
});
