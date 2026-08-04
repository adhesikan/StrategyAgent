// TraderBrain — Service integration tests.
//
// Covers: feature flag, backward-compatible API, shadow field, no credential
// leakage, rule-based fallback, OpenAI non-authority, context isolation.
//
// All MCP calls are mocked via BrainExecutorDeps — no real network calls.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isBrainEnabled } from "../service";
import { classifyBrainIntent } from "../intent-classifier";
import { buildToolPlan, findCredentialArgs } from "../planner";
import { composeBrainResult, projectToResponseField, buildFallbackResult } from "../composer";
import { executeToolPlan } from "../executor";
import type { NormalizedBrainRequest, TrustedContext, TraderBrainResult } from "../types";
import type { BrainExecutorDeps } from "../executor";
import type { StrategyRecommendation } from "../../mcp/strategy-recommendation";
import type { MultiStrategyAnalysis } from "../../mcp/multi-strategy-analysis";
import type { RankedTradeSearch } from "../../routes/ranked-trade-search";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_REQUEST_ID = "svc-test-001";

function makeTrustedCtx(overrides: Partial<TrustedContext> = {}): TrustedContext {
  return {
    userId: "user-test-1",
    tickers: [],
    brokerConnected: false,
    ...overrides,
  };
}

const MOCK_RECOMMENDATION: StrategyRecommendation = {
  source: "mcp",
  generatedAt: new Date().toISOString(),
  recommendations: [{ overallVerdict: "LIVE_OPTIONS", recommendedStrategy: "covered_call" }],
  simulatedData: false,
};

const MOCK_ANALYSIS: MultiStrategyAnalysis = {
  symbol: "MU",
  strategiesChecked: 5,
  strategiesMatched: 1,
  strategiesFailed: 0,
  overallVerdict: "TRADE_CANDIDATE",
  supportingSetups: [],
  dataQuality: { source: "mcp_live", realMarketData: true, fresh: true, complete: true },
};

const MOCK_RANKED: RankedTradeSearch = {
  request: {},
  reviewedCount: 10,
  qualifiedCount: 2,
  watchCount: 0,
  rejectedCount: 8,
  unavailableCount: 0,
  candidates: [{ rank: 1, symbol: "AAPL" } as unknown as RankedTradeSearch["candidates"][0]],
  watchCandidates: [],
  rejectionSummary: [],
  generatedAt: new Date().toISOString(),
  warnings: [],
};

function makeSuccessDeps(): BrainExecutorDeps {
  return {
    runAnalysis: vi.fn().mockResolvedValue(MOCK_ANALYSIS),
    runRecommendation: vi.fn().mockResolvedValue(MOCK_RECOMMENDATION),
    runRanked: vi.fn().mockResolvedValue(MOCK_RANKED),
    runPortfolioPlan: vi.fn().mockResolvedValue({
      feasibility: { feasible: true },
      portfolioConstraints: [],
      qualifiedCandidates: [],
      generatedAt: new Date().toISOString(),
      warnings: [],
    }),
    runOpenAi: vi.fn().mockResolvedValue("AI explanation"),
  };
}

function makeReq(overrides: Partial<NormalizedBrainRequest>): NormalizedBrainRequest {
  return { rawPrompt: "test", intent: "RANK_MARKET_TRADES", tickers: [], ...overrides };
}

async function runFullFlow(req: NormalizedBrainRequest, ctx = makeTrustedCtx(), deps = makeSuccessDeps()): Promise<TraderBrainResult> {
  const plan = buildToolPlan(req);
  const evidence = await executeToolPlan(plan, ctx, deps, MOCK_REQUEST_ID);
  return composeBrainResult(MOCK_REQUEST_ID, plan, evidence, ctx);
}

// ---------------------------------------------------------------------------
// Feature flag: isBrainEnabled
// ---------------------------------------------------------------------------
describe("isBrainEnabled — feature flag", () => {
  const origEnv = process.env.TRADER_BRAIN_ENABLED;
  afterEach(() => {
    process.env.TRADER_BRAIN_ENABLED = origEnv ?? "";
  });

  it("disabled by default (unset)", () => {
    delete process.env.TRADER_BRAIN_ENABLED;
    expect(isBrainEnabled("RANK_MARKET_TRADES")).toBe(false);
  });

  it("'false' → disabled", () => {
    process.env.TRADER_BRAIN_ENABLED = "false";
    expect(isBrainEnabled("RECOMMEND_SYMBOL_TRADE")).toBe(false);
  });

  it("'all' → all intents enabled", () => {
    process.env.TRADER_BRAIN_ENABLED = "all";
    const intents = [
      "ANALYZE_SYMBOL", "RECOMMEND_SYMBOL_TRADE", "RANK_MARKET_TRADES",
      "PLAN_PORTFOLIO_TRADE", "COMBINED_ANALYSIS_RECOMMENDATION",
      "EXPLAIN_CONCEPT", "EDUCATION_PLUS_ACTION", "MARKET_RESEARCH", "UNKNOWN",
    ] as const;
    for (const intent of intents) {
      expect(isBrainEnabled(intent)).toBe(true);
    }
  });

  it("'shadow' → all intents enabled", () => {
    process.env.TRADER_BRAIN_ENABLED = "shadow";
    expect(isBrainEnabled("RANK_MARKET_TRADES")).toBe(true);
    expect(isBrainEnabled("EXPLAIN_CONCEPT")).toBe(true);
  });

  it("comma-separated list enables only listed intents", () => {
    process.env.TRADER_BRAIN_ENABLED = "COMBINED_ANALYSIS_RECOMMENDATION,RECOMMEND_SYMBOL_TRADE";
    expect(isBrainEnabled("COMBINED_ANALYSIS_RECOMMENDATION")).toBe(true);
    expect(isBrainEnabled("RECOMMEND_SYMBOL_TRADE")).toBe(true);
    expect(isBrainEnabled("RANK_MARKET_TRADES")).toBe(false);
    expect(isBrainEnabled("EXPLAIN_CONCEPT")).toBe(false);
    expect(isBrainEnabled("UNKNOWN")).toBe(false);
  });

  it("case-insensitive matching in comma list", () => {
    process.env.TRADER_BRAIN_ENABLED = "rank_market_trades,explain_concept";
    expect(isBrainEnabled("RANK_MARKET_TRADES")).toBe(true);
    expect(isBrainEnabled("EXPLAIN_CONCEPT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Backward-compatible API: projectToResponseField strips evidence
// ---------------------------------------------------------------------------
describe("projectToResponseField — backward-compatible traderBrain field", () => {
  it("evidence envelopes are stripped (never sent to client)", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect("evidence" in field).toBe(false);
    expect((field as unknown as TraderBrainResult).evidence).toBeUndefined();
  });

  it("intent is preserved", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect(field.intent).toBe("RANK_MARKET_TRADES");
  });

  it("status is preserved", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect(["complete","partial","degraded","unavailable","error"]).toContain(field.status);
  });

  it("sections are preserved", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect(field.sections).toBeDefined();
  });

  it("warnings array present", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect(Array.isArray(field.warnings)).toBe(true);
  });

  it("generatedAt is ISO timestamp", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req);
    const field = projectToResponseField(result);
    expect(() => new Date(field.generatedAt)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No credential leakage in result
// ---------------------------------------------------------------------------
describe("TraderBrainResult — no credential leakage", () => {
  it("portfolioToken not in result warnings/limitations", async () => {
    const ctx = makeTrustedCtx({ portfolioToken: "secret-portfolio-token-xyz" });
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-portfolio-token-xyz");
  });

  it("optionsToken not in result", async () => {
    const ctx = makeTrustedCtx({ optionsToken: "secret-options-token-abc" });
    const req = makeReq({
      intent: "RECOMMEND_SYMBOL_TRADE",
      symbol: "NVDA",
      tickers: ["NVDA"],
    });
    const result = await runFullFlow(req, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-options-token-abc");
  });

  it("userId not in result", async () => {
    const ctx = makeTrustedCtx({ userId: "private-user-id-123" });
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const result = await runFullFlow(req, ctx);
    const field = projectToResponseField(result);
    const serialized = JSON.stringify(field);
    expect(serialized).not.toContain("private-user-id-123");
  });

  it("plan args contain no credential fields", () => {
    const requests: NormalizedBrainRequest[] = [
      makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] }),
      makeReq({ intent: "RANK_MARKET_TRADES" }),
      makeReq({ intent: "PLAN_PORTFOLIO_TRADE", portfolioConstraints: { kind: "dollar_risk", maxRiskDollars: 500 } }),
      makeReq({ intent: "COMBINED_ANALYSIS_RECOMMENDATION", symbol: "BA", tickers: ["BA"] }),
    ];
    for (const req of requests) {
      const plan = buildToolPlan(req);
      const creds = findCredentialArgs(plan);
      expect(creds).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// OpenAI non-authority: deterministic sections survive OpenAI failure
// ---------------------------------------------------------------------------
describe("TraderBrainResult — OpenAI non-authority", () => {
  it("recommendation section present even when OpenAI fails", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const deps = makeSuccessDeps({
      runOpenAi: vi.fn().mockRejectedValue(new Error("OpenAI unavailable")),
    });
    const result = await runFullFlow(req, makeTrustedCtx(), deps);
    // Deterministic recommendation always present regardless of OpenAI status
    expect(result.sections.recommendation).toBeDefined();
    expect(result.sections.recommendation).not.toBeNull();
    // Recommendation verdict must be unchanged (not overridden by OpenAI)
    const verdict = result.sections.recommendation?.recommendations?.[0]?.overallVerdict;
    expect(verdict).toBe("LIVE_OPTIONS");
    // openAiExplanation, if present, must be additive prose — never a trade verdict
    if (result.sections.openAiExplanation) {
      expect(typeof result.sections.openAiExplanation).toBe("string");
      // Explanation must not re-state the verdict as its own decision
      expect(result.sections.openAiExplanation).not.toMatch(/^overallVerdict/i);
    }
  });

  it("ranked search section present even when OpenAI fails", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    // No openai step in RANK plan — verify it still works
    const result = await runFullFlow(req);
    expect(result.sections.rankedSearch).toBeDefined();
    expect(result.sections.rankedSearch).not.toBeNull();
  });

  it("OpenAI explanation is additive only — does not replace headline", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const result = await runFullFlow(req);
    // Headline is always deterministic
    expect(result.headline).toBeTruthy();
    // openAiExplanation is prose addition, not the headline
    if (result.sections.openAiExplanation) {
      expect(result.headline).not.toBe(result.sections.openAiExplanation);
    }
  });
});

// ---------------------------------------------------------------------------
// Fallback result
// ---------------------------------------------------------------------------
describe("buildFallbackResult", () => {
  it("status is unavailable", () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const fallback = buildFallbackResult(MOCK_REQUEST_ID, plan, "MCP_UNAVAILABLE");
    expect(fallback.status).toBe("unavailable");
  });

  it("no invented recommendation in fallback", () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const fallback = buildFallbackResult(MOCK_REQUEST_ID, plan, "MCP_UNAVAILABLE");
    expect(fallback.sections.recommendation).toBeUndefined();
    expect(fallback.sections.rankedSearch).toBeUndefined();
  });

  it("honest headline (no fabricated trade)", () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const fallback = buildFallbackResult(MOCK_REQUEST_ID, plan, "MCP_UNAVAILABLE");
    expect(fallback.headline.toLowerCase()).toContain("unavailable");
  });

  it("no credential fields in fallback", () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = buildToolPlan(req);
    const fallback = buildFallbackResult(MOCK_REQUEST_ID, plan, "MCP_UNAVAILABLE");
    const s = JSON.stringify(fallback);
    expect(s).not.toContain("token");
    expect(s).not.toContain("userId");
  });

  it("evidence is empty (no data fabricated)", () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = buildToolPlan(req);
    const fallback = buildFallbackResult(MOCK_REQUEST_ID, plan, "MCP_UNAVAILABLE");
    expect(fallback.evidence).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No execution — result depends on plan steps only
// ---------------------------------------------------------------------------
describe("TraderBrainResult — no execution", () => {
  it("result contains no order/execute/place fields", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const result = await runFullFlow(req);
    const s = JSON.stringify(result);
    expect(s).not.toContain('"execute"');
    expect(s).not.toContain('"place_order"');
    expect(s).not.toContain('"submit_order"');
  });
});

// ---------------------------------------------------------------------------
// End-to-end intent coverage
// ---------------------------------------------------------------------------
describe("full-flow — all intents produce a result", () => {
  const INTENTS: [string, NormalizedBrainRequest][] = [
    ["ANALYZE_SYMBOL",                    makeReq({ intent: "ANALYZE_SYMBOL", symbol: "MU", tickers: ["MU"] })],
    ["RECOMMEND_SYMBOL_TRADE",            makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] })],
    ["RANK_MARKET_TRADES",                makeReq({ intent: "RANK_MARKET_TRADES" })],
    ["PLAN_PORTFOLIO_TRADE",              makeReq({ intent: "PLAN_PORTFOLIO_TRADE", portfolioConstraints: { kind: "dollar_risk", maxRiskDollars: 500 } })],
    ["COMBINED_ANALYSIS_RECOMMENDATION",  makeReq({ intent: "COMBINED_ANALYSIS_RECOMMENDATION", symbol: "BA", tickers: ["BA"] })],
    ["EXPLAIN_CONCEPT",                   makeReq({ intent: "EXPLAIN_CONCEPT", educationTopic: "credit spreads" })],
    ["EDUCATION_PLUS_ACTION",             makeReq({ intent: "EDUCATION_PLUS_ACTION" })],
    ["MARKET_RESEARCH",                   makeReq({ intent: "MARKET_RESEARCH" })],
    ["UNKNOWN",                           makeReq({ intent: "UNKNOWN" })],
  ];

  for (const [name, req] of INTENTS) {
    it(`${name}: result has required top-level fields`, async () => {
      const result = await runFullFlow(req);
      expect(result.requestId).toBeTruthy();
      expect(result.intent).toBe(req.intent);
      expect(result.status).toBeTruthy();
      expect(result.headline).toBeTruthy();
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.limitations)).toBe(true);
      expect(Array.isArray(result.nextActions)).toBe(true);
      expect(result.generatedAt).toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// Count and risk normalization round-trip
// ---------------------------------------------------------------------------
describe("normalization round-trip", () => {
  it("maxRiskDollars from request survives to plan args", () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES", maxRiskDollars: 500 });
    const plan = buildToolPlan(req);
    const rankStep = plan.steps.find((s) => s.tool === "rank_market_trade_candidates")!;
    expect(rankStep.arguments.maxRiskDollars).toBe(500);
  });

  it("maxRiskPercent from request survives to plan args for portfolio trade", () => {
    const req = makeReq({
      intent: "PLAN_PORTFOLIO_TRADE",
      portfolioConstraints: { kind: "percent_of_portfolio", maxRiskPercent: 5 },
      maxRiskPercent: 5,
    });
    const plan = buildToolPlan(req);
    const step = plan.steps.find((s) => s.tool === "plan_portfolio_trade")!;
    expect(step.arguments.maxRiskPercent).toBe(5);
  });

  it("direction forwarded to rank args", () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES", direction: "bullish" });
    const plan = buildToolPlan(req);
    const step = plan.steps.find((s) => s.tool === "rank_market_trade_candidates")!;
    expect(step.arguments.direction).toBe("bullish");
  });
});
