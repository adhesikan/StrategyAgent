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
import { parseRequestedCount } from "./opportunity-search-mcp";
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
    ...(overrides.optionsContextToken ? { optionsContextToken: overrides.optionsContextToken } : {}),
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
    expect(a.headline).toBe("No qualifying setups currently meet the criteria.");
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

describe("options context pass-through (broker-connected live options)", () => {
  it("forwards the opaque context token to build_trade_candidate when supplied", async () => {
    const seen: Array<string | undefined> = [];
    const setups = [setup("NVDA", "vcp", 90)];
    await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({
        setups,
        buildTradeCandidate: async (s: string, _st: string, oct?: string) => (seen.push(oct), stockCandidate(s)),
        brokerConnected: true,
        optionsContextToken: "a".repeat(64),
      } as any),
    );
    expect(seen).toEqual(["a".repeat(64)]);
  });

  it("disconnected users pass no token — estimated-options mode", async () => {
    const seen: Array<string | undefined> = [];
    const setups = [setup("NVDA", "vcp", 90)];
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({ setups, buildTradeCandidate: async (s: string, _st: string, oct?: string) => (seen.push(oct), stockCandidate(s)) }),
    );
    expect(seen).toEqual([undefined]);
    expect(r.brokerConnected).toBe(false);
  });

  it("scrubs MCP echoes: a candidate/setup echoing the context token never reaches cards or the LLM payload", async () => {
    const token = "c".repeat(64);
    const echoedSetup = { ...setup("NVDA", "vcp", 90), optionsContextToken: token } as any;
    const r = await runMcpOpportunitySearch(
      "trade",
      "Find trades",
      deps({
        setups: [echoedSetup],
        buildTradeCandidate: async (s: string) =>
          ({ ...stockCandidate(s), optionsContextToken: token, debug: { requestArgs: { optionsContextToken: token, authorization: "Bearer xyz" } } } as any),
        optionsContextToken: token,
      } as any),
    );
    const card = toMcpOpportunityCard(r.opportunities[0], true);
    const serialized = JSON.stringify({ r, card, answer: buildMcpOpportunityAnswer(r) });
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("Bearer xyz");
    // legitimate fields survive the scrub
    expect(card.symbol).toBe("NVDA");
    expect(card.verdict).toBe("STOCK");
    expect(card.trigger).toBe(100);
  });

  it("the context token never appears in cards or answers", async () => {
    const token = "b".repeat(64);
    const setups = [setup("NVDA", "vcp", 90)];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups, optionsContextToken: token } as any));
    const card = toMcpOpportunityCard(r.opportunities[0], true);
    const answer = buildMcpOpportunityAnswer(r);
    expect(JSON.stringify({ r, card, answer })).not.toContain(token);
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

// ---------------------------------------------------------------------------
// Live options pipeline (get_options_chain → analyze_options →
// select_option_contracts → calculate_trade_risk)
// ---------------------------------------------------------------------------

function estimatedOptionsCandidate(symbol: string): McpCandidate {
  return {
    symbol,
    verdict: "ESTIMATED_OPTIONS",
    direction: "bullish",
    optionsCandidate: {
      strategy: "long_call",
      status: "estimated",
      targetDte: { min: 30, max: 45 },
      shortStrikeZone: null,
      longStrikeZone: { low: 100, high: 105, basis: "structure" },
      limitations: ["No live chain evaluated"],
      connectionRequiredForLiveContracts: true,
      liveContractDataAvailable: false,
    },
    earningsRisk: { status: "clear", nextEarningsDate: null, daysUntilEarnings: null },
  };
}

function liveOptionTools(overrides: Partial<McpSearchDeps> = {}): Partial<McpSearchDeps> {
  return {
    getOptionsChain: async () => ({ available: true, expirations: ["2026-09-18"] }),
    analyzeOptions: async () => ({
      ivRank: 32,
      liquidity: { quality: "good", notes: ["Penny-wide markets near the money"] },
      reasons: ["IV rank moderate — long premium reasonable"],
    }),
    selectOptionContracts: async () => ({
      expiration: "2026-09-18",
      dte: 46,
      legs: [
        {
          action: "buy", type: "call", strike: 105, expiration: "2026-09-18",
          bid: 4.1, ask: 4.3, delta: 0.48, theta: -0.05, iv: 0.34,
          volume: 1250, openInterest: 8900, optionSymbol: "NVDA260918C00105000",
        },
      ],
      netDebit: 4.2,
      maxLoss: 420,
      maxProfit: null,
      breakeven: [109.2],
      liquidity: { quality: "good" },
      reasons: ["Highest score among bullish candidates fitting the risk budget"],
    }),
    calculateTradeRisk: async () => ({
      maxLoss: 420,
      maxProfit: null,
      breakeven: [109.2],
      warnings: [],
    }),
    ...overrides,
  };
}

describe("live options pipeline", () => {
  const token = "t".repeat(64);

  async function run(question: string, toolOverrides: Partial<McpSearchDeps> = {}, extra: any = {}) {
    const setups = [setup("NVDA", "vcp", 90)];
    return runMcpOpportunitySearch(
      "bullish",
      question,
      {
        ...deps({
          setups,
          candidates: { NVDA: estimatedOptionsCandidate("NVDA") },
          brokerConnected: true,
          optionsContextToken: token,
          ...extra,
        } as any),
        ...liveOptionTools(toolOverrides),
      } as McpSearchDeps,
    );
  }

  it("full pipeline success produces a LIVE candidate with all contract fields", async () => {
    const r = await run("Find 3 bullish option trades under $500 maximum loss");
    const o = r.opportunities[0];
    expect(o.liveOption).not.toBeNull();
    const live = o.liveOption!;
    expect(live.status).toBe("live");
    expect(live.strategy).toBe("long_call");
    expect(live.expiration).toBe("2026-09-18");
    expect(live.dte).toBe(46);
    expect(live.legs).toHaveLength(1);
    expect(live.legs[0]).toMatchObject({
      action: "buy", type: "call", strike: 105, bid: 4.1, ask: 4.3,
      delta: 0.48, theta: -0.05, iv: 0.34, volume: 1250, openInterest: 8900,
    });
    expect(live.legs[0].mid).toBeCloseTo(4.2);
    expect(live.priceBasis).toBe("bid_ask");
    expect(live.netKind).toBe("debit");
    expect(Math.abs(live.estimatedNet)).toBeCloseTo(4.2);
    expect(live.maxLoss).toBe(420);
    expect(live.maxProfit).toBeNull();
    expect(live.breakeven).toEqual([109.2]);
    expect(live.liquidityQuality).toBe("good");
    expect(live.rankReasons.join(" ")).toContain("risk budget");
  });

  it("card is labeled live_options and never shows an estimated box for a live candidate", async () => {
    const r = await run("Find bullish option trades under $500 maximum risk");
    const card = toMcpOpportunityCard(r.opportunities[0], true);
    expect(card.candidateState).toBe("live_options");
    expect(card.liveOption).not.toBeNull();
    expect(card.estimatedOptions).toBeNull();
  });

  it("chain unavailable → estimated card only, never labeled live", async () => {
    const r = await run("Find bullish option trades", { getOptionsChain: async () => ({ available: false }) });
    const o = r.opportunities[0];
    expect(o.liveOption).toBeNull();
    const card = toMcpOpportunityCard(o, true);
    expect(card.candidateState).toBe("estimated_options");
    expect(card.estimatedOptions).toMatchObject({ status: "estimated", strategy: "long_call" });
    expect(card.estimatedOptions?.limitations?.length).toBeGreaterThan(0);
    expect(card.estimatedOptions?.riskStyle).toBe("defined-risk");
    expect(card.estimatedOptions?.longStrikeZone).toEqual({ low: 100, high: 105, basis: "structure" });
  });

  it("chain tool failure → estimated, not live", async () => {
    const r = await run("Find bullish option trades", { getOptionsChain: async () => { throw new Error("boom"); } });
    expect(r.opportunities[0].liveOption).toBeNull();
    expect(toMcpOpportunityCard(r.opportunities[0], true).candidateState).toBe("estimated_options");
  });

  it("selection failure or empty/invalid legs → estimated, not live", async () => {
    for (const sel of [
      async () => { throw new Error("no contracts"); },
      async () => ({ legs: [] }),
      async () => ({ expiration: "2026-09-18", legs: [{ action: "hold", type: "call", strike: 105 }] }),
      async () => ({ expiration: "2026-09-18", legs: [{ action: "buy", type: "call" }] }),
    ]) {
      const r = await run("Find bullish option trades", { selectOptionContracts: sel as any });
      expect(r.opportunities[0].liveOption).toBeNull();
    }
  });

  it("no options context token (disconnected) → never calls chain tools, stays estimated", async () => {
    let chainCalled = 0;
    const setups = [setup("NVDA", "vcp", 90)];
    const r = await runMcpOpportunitySearch("bullish", "Find bullish option trades", {
      ...deps({ setups, candidates: { NVDA: estimatedOptionsCandidate("NVDA") } } as any),
      ...liveOptionTools({ getOptionsChain: async () => (chainCalled++, { available: true }) }),
    } as McpSearchDeps);
    expect(chainCalled).toBe(0);
    expect(r.opportunities[0].liveOption).toBeNull();
  });

  it("analyze_options failure → NOT live (full pipeline required)", async () => {
    const r = await run("Find bullish option trades", { analyzeOptions: async () => { throw new Error("iv svc down"); } });
    expect(r.opportunities[0].liveOption).toBeNull();
    expect(toMcpOpportunityCard(r.opportunities[0], true).candidateState).toBe("estimated_options");
  });

  it("calculate_trade_risk failure → NOT live (full pipeline required)", async () => {
    const r = await run("Find bullish option trades", { calculateTradeRisk: async () => { throw new Error("risk svc down"); } });
    expect(r.opportunities[0].liveOption).toBeNull();
    expect(toMcpOpportunityCard(r.opportunities[0], true).candidateState).toBe("estimated_options");
  });

  it("any missing pipeline tool → NOT live, even when the rest succeed", async () => {
    for (const missing of ["getOptionsChain", "analyzeOptions", "selectOptionContracts", "calculateTradeRisk"] as const) {
      const tools = liveOptionTools();
      delete (tools as any)[missing];
      const setups = [setup("NVDA", "vcp", 90)];
      const r = await runMcpOpportunitySearch("bullish", "Find bullish option trades", {
        ...deps({ setups, candidates: { NVDA: estimatedOptionsCandidate("NVDA") }, brokerConnected: true, optionsContextToken: token } as any),
        ...tools,
      } as McpSearchDeps);
      expect(r.opportunities[0].liveOption, missing).toBeNull();
    }
  });

  it("legs without live premiums → NOT live, even with aggregate net figures", async () => {
    const r = await run("Find bullish option trades", {
      selectOptionContracts: async () => ({
        expiration: "2026-09-18", dte: 46,
        legs: [{ action: "buy", type: "call", strike: 105 }], // no bid/ask/mid
        netDebit: 4.2, maxLoss: 420, breakeven: [109.2],
      }),
    });
    expect(r.opportunities[0].liveOption).toBeNull();
  });

  it("strict budget: estimated options are excluded under a budgeted query (risk unverifiable)", async () => {
    const r = await run("Find bullish option trades under $500 maximum risk", {
      getOptionsChain: async () => ({ available: false }),
    });
    expect(r.opportunities).toHaveLength(0);
    expect(r.excludedByRisk).toBe(1);
  });

  it("missing max loss everywhere → NOT presented as live", async () => {
    const r = await run("Find bullish option trades", {
      selectOptionContracts: async () => ({
        expiration: "2026-09-18",
        legs: [{ action: "buy", type: "call", strike: 105, bid: 4.1, ask: 4.3 }],
      }),
      calculateTradeRisk: async () => ({}),
    });
    expect(r.opportunities[0].liveOption).toBeNull();
  });

  it("risk budget enforced: live candidates over max loss are excluded and disclosed", async () => {
    const r = await run("Find 3 bullish option trades under $300 maximum risk", {
      selectOptionContracts: async () => ({
        expiration: "2026-09-18", dte: 46,
        legs: [{ action: "buy", type: "call", strike: 105, bid: 4.1, ask: 4.3 }],
        netDebit: 4.2, maxLoss: 420, breakeven: [109.2],
      }),
      calculateTradeRisk: async () => ({ maxLoss: 420, breakeven: [109.2] }),
    });
    expect(r.maxRiskDollars).toBe(300);
    expect(r.opportunities).toHaveLength(0);
    expect(r.excludedByRisk).toBe(1);
  });

  it("risk budget satisfied: live candidate under the limit is surfaced", async () => {
    const r = await run("Find 3 bullish option trades under $500 maximum risk");
    expect(r.opportunities).toHaveLength(1);
    expect(r.opportunities[0].liveOption?.maxLoss).toBe(420);
    expect(r.excludedByRisk).toBeUndefined();
  });

  it("credit structures: net sign and kind are correct", async () => {
    const r = await run("Find bullish option trades", {
      selectOptionContracts: async () => ({
        expiration: "2026-09-18", dte: 46,
        legs: [
          { action: "sell", type: "put", strike: 95, bid: 2.4, ask: 2.6 },
          { action: "buy", type: "put", strike: 90, bid: 1.1, ask: 1.3 },
        ],
        netCredit: 1.3, maxLoss: 370, maxProfit: 130, breakeven: [93.7],
      }),
      calculateTradeRisk: async () => ({ maxLoss: 370, maxProfit: 130, breakeven: [93.7] }),
    });
    const live = r.opportunities[0].liveOption!;
    expect(live.netKind).toBe("credit");
    expect(live.estimatedNet).toBeCloseTo(1.3);
    expect(live.maxProfit).toBe(130);
    expect(live.legs).toHaveLength(2);
  });

  it("deterministic answer text includes the live line and never calls estimated structures live", async () => {
    const rLive = await run("Find bullish option trades under $500 maximum risk");
    const aLive = buildMcpOpportunityAnswer(rLive);
    expect(aLive.answer).toContain("LIVE long call");
    expect(aLive.answer).toContain("max loss $420.00");
    expect(aLive.answer).toContain("breakeven $109.20");

    const rEst = await run("Find bullish option trades", { getOptionsChain: async () => ({ available: false }) });
    const aEst = buildMcpOpportunityAnswer(rEst);
    expect(aEst.answer).toContain("estimated structure, not a live trade");
    expect(aEst.answer).not.toContain("LIVE ");
  });

  it("token echoes in chain/analysis/selection responses are scrubbed from all outputs", async () => {
    const r = await run("Find bullish option trades under $500 maximum risk", {
      getOptionsChain: async () => ({ available: true, optionsContextToken: token }),
      analyzeOptions: async () => ({ reasons: ["ok"], debug: { authorization: "Bearer leak" } }),
      selectOptionContracts: async () => ({
        expiration: "2026-09-18", dte: 46,
        legs: [{ action: "buy", type: "call", strike: 105, bid: 4.1, ask: 4.3 }],
        netDebit: 4.2, maxLoss: 420, breakeven: [109.2],
        optionsContextToken: token,
      }),
    });
    const card = toMcpOpportunityCard(r.opportunities[0], true);
    const serialized = JSON.stringify({ r, card, answer: buildMcpOpportunityAnswer(r) });
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("Bearer leak");
    expect(card.liveOption?.legs[0].strike).toBe(105);
  });

  it("NO_TRADE candidates never run the options pipeline", async () => {
    let called = 0;
    const setups = [setup("NVDA", "vcp", 90)];
    const noTrade: McpCandidate = { symbol: "NVDA", verdict: "NO_TRADE", noTradeReasons: ["regime risk-off"], optionsCandidate: { strategy: "long_call" } as any };
    const r = await runMcpOpportunitySearch("bullish", "Find bullish option trades", {
      ...deps({ setups, candidates: { NVDA: noTrade }, brokerConnected: true, optionsContextToken: token } as any),
      ...liveOptionTools({ getOptionsChain: async () => (called++, { available: true }) }),
    } as McpSearchDeps);
    expect(called).toBe(0);
    expect(r.opportunities[0].liveOption).toBeNull();
  });
});

describe("count enforcement, setup-vs-trade headlines, confidence quality (UAT fixes)", () => {
  const NO_TRADE: McpCandidate = { verdict: "NO_TRADE", noTradeReasons: ["regime risk-off"] };

  it("parses explicit counts from natural phrasings", () => {
    expect(parseRequestedCount("Find 3 bullish trades")).toBe(3);
    expect(parseRequestedCount("show 5 setups")).toBe(5);
    expect(parseRequestedCount("give me the top 2 opportunities")).toBe(2);
    expect(parseRequestedCount("find three bullish trades")).toBe(3);
    expect(parseRequestedCount("Find bullish trades")).toBeNull();
    expect(parseRequestedCount("Find trades under $500 maximum risk")).toBeNull();
  });

  it("explicit count 3 produces exactly 3 visible cards", async () => {
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85), setup("D", "vcp", 80), setup("E", "vcp", 75)];
    const r = await runMcpOpportunitySearch("bullish", "Find 3 bullish trades", deps({ setups }));
    expect(r.requestedCount).toBe(3);
    expect(r.opportunities).toHaveLength(3);
    expect(r.opportunities.map((o) => o.setup.symbol)).toEqual(["A", "B", "C"]);
  });

  it("count is reflected in the structured response and narrative", async () => {
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85), setup("D", "vcp", 80)];
    const r = await runMcpOpportunitySearch("bullish", "Find 3 bullish trades", deps({ setups }));
    const a = buildMcpOpportunityAnswer(r);
    expect(a.headline).toBe("Three bullish trade candidates identified.");
    expect(a.answer).toContain("Reviewed 3 scanner setups: 3 qualified as trade candidates");
    expect(a.answer).not.toContain("4.");
  });

  it("all NO_TRADE results use 'setups', never 'trade candidates'", async () => {
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85)];
    const r = await runMcpOpportunitySearch("bullish", "Find 3 bullish trades", deps({ setups, candidates: { A: NO_TRADE, B: NO_TRADE, C: NO_TRADE } }));
    const a = buildMcpOpportunityAnswer(r);
    expect(a.headline).toBe("Three bullish setups found, but none currently qualify as trades.");
    expect(a.headline).not.toMatch(/trade candidates identified/);
    expect(a.answer).toContain("0 qualified as trade candidates, 3 did not qualify (NO TRADE)");
  });

  it("mixed verdicts get the 'reviewed; N qualify' headline", async () => {
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85)];
    const r = await runMcpOpportunitySearch("bullish", "Find 3 bullish trades", deps({ setups, candidates: { B: NO_TRADE, C: NO_TRADE } }));
    const a = buildMcpOpportunityAnswer(r);
    expect(a.headline).toBe("Three bullish setups reviewed; one currently qualifies as a trade.");
  });

  it("zero qualifying results use the no-qualifying-setups headline", () => {
    const a = buildMcpOpportunityAnswer({
      intent: "bullish", source: "mcp", generatedAt: "x", brokerConnected: false, maxRiskDollars: null, opportunities: [],
    });
    expect(a.headline).toBe("No qualifying bullish setups currently meet the criteria.");
  });

  it("duplicate symbol across strategies is preserved with distinct strategy labels, no confluence claims", async () => {
    const setups = [setup("NVDA", "momentum_breakout", 92), setup("NVDA", "vcp", 88)];
    const r = await runMcpOpportunitySearch("trade", "Find 2 trades", deps({ setups }));
    expect(r.opportunities.map((o) => `${o.setup.symbol}:${o.setup.strategy}`)).toEqual(["NVDA:momentum_breakout", "NVDA:vcp"]);
    const a = buildMcpOpportunityAnswer(r);
    expect(a.answer).toContain("momentum_breakout");
    expect(a.answer).toContain("vcp");
    expect(a.answer).not.toMatch(/confluence/i);
  });

  it("mock-sourced data cannot produce high confidence", async () => {
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85)].map((s) => ({ ...s, source: "mock" }));
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups }));
    expect(mcpOpportunityConfidence(r)).toBe("low");
  });

  it("missing underlying market data cannot produce high confidence", async () => {
    const bare = (sym: string): McpSetup => ({ ...setup(sym, "vcp", 90), trigger: null, invalidation: null });
    const noLevels: McpCandidate = { verdict: "STOCK", stockCandidate: { trigger: null, riskPlan: null } };
    const setups = [bare("A"), bare("B"), bare("C")];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups, candidates: { A: noLevels, B: noLevels, C: noLevels } }));
    expect(mcpOpportunityConfidence(r)).not.toBe("high");
  });

  it("candidate-engine failure for everything → low confidence", async () => {
    const err = new Error("engine down");
    const setups = [setup("A", "vcp", 95), setup("B", "vcp", 90), setup("C", "vcp", 85)];
    const r = await runMcpOpportunitySearch("trade", "Find trades", deps({ setups, candidates: { A: err, B: err, C: err } }));
    expect(mcpOpportunityConfidence(r)).toBe("low");
  });
});
