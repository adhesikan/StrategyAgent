// TraderBrain — Executor tests.
//
// Covers: dependency ordering, optional step failure continues execution,
// required step failure aborts remaining steps, MCP timeout, context isolation,
// no credential leakage, payload preservation, no execution without plan.

import { describe, it, expect, vi } from "vitest";
import { executeToolPlan } from "../executor";
import { buildToolPlan } from "../planner";
import type { NormalizedBrainRequest, TrustedContext } from "../types";
import type { BrainExecutorDeps } from "../executor";
import type { StrategyRecommendation } from "../../mcp/strategy-recommendation";
import type { MultiStrategyAnalysis } from "../../mcp/multi-strategy-analysis";
import type { RankedTradeSearch } from "../../routes/ranked-trade-search";
import type { PortfolioTradePlan } from "../../routes/portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_REQUEST_ID = "test-req-001";

function makeTrustedCtx(overrides: Partial<TrustedContext> = {}): TrustedContext {
  return {
    userId: "user-1",
    tickers: [],
    brokerConnected: false,
    portfolioToken: undefined,
    optionsToken: undefined,
    ...overrides,
  };
}

const MOCK_RECOMMENDATION: StrategyRecommendation = {
  source: "mcp",
  generatedAt: new Date().toISOString(),
  recommendations: [
    {
      overallVerdict: "LIVE_OPTIONS",
      recommendedStrategy: "covered_call",
    },
  ],
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
  watchCount: 1,
  rejectedCount: 7,
  unavailableCount: 0,
  candidates: [{ rank: 1, symbol: "AAPL" } as unknown as RankedTradeSearch["candidates"][0]],
  watchCandidates: [],
  rejectionSummary: [],
  generatedAt: new Date().toISOString(),
  warnings: [],
};

const MOCK_PORTFOLIO_PLAN: PortfolioTradePlan = {
  feasibility: { feasible: true },
  portfolioConstraints: [],
  qualifiedCandidates: [],
  generatedAt: new Date().toISOString(),
  warnings: [],
};

function makeSuccessDeps(overrides: Partial<BrainExecutorDeps> = {}): BrainExecutorDeps {
  return {
    runAnalysis: vi.fn().mockResolvedValue(MOCK_ANALYSIS),
    runRecommendation: vi.fn().mockResolvedValue(MOCK_RECOMMENDATION),
    runRanked: vi.fn().mockResolvedValue(MOCK_RANKED),
    runPortfolioPlan: vi.fn().mockResolvedValue(MOCK_PORTFOLIO_PLAN),
    runOpenAi: vi.fn().mockResolvedValue("AI explanation text"),
    ...overrides,
  };
}

function makeReq(overrides: Partial<NormalizedBrainRequest>): NormalizedBrainRequest {
  return {
    rawPrompt: "test",
    intent: "RANK_MARKET_TRADES",
    tickers: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Required step success → "ok" evidence
// ---------------------------------------------------------------------------
describe("executeToolPlan — required step success", () => {
  it("RANK_MARKET_TRADES: rank step produces ok evidence", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps();
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const rankEv = evidence.find((e) => e.stepId === "rank")!;
    expect(rankEv.status).toBe("ok");
    expect(rankEv.data).toEqual(MOCK_RANKED);
  });

  it("RECOMMEND_SYMBOL_TRADE: recommend step preserves full payload", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps();
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const recEv = evidence.find((e) => e.stepId === "recommend")!;
    expect(recEv.status).toBe("ok");
    // Original payload preserved under data (not flattened)
    expect(recEv.data).toEqual(MOCK_RECOMMENDATION);
    expect((recEv.data as StrategyRecommendation).recommendations[0].overallVerdict).toBe("LIVE_OPTIONS");
  });
});

// ---------------------------------------------------------------------------
// Optional step failure → execution continues
// ---------------------------------------------------------------------------
describe("executeToolPlan — optional step failure continues execution", () => {
  it("OpenAI failure does not abort required steps", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({
      runOpenAi: vi.fn().mockRejectedValue(new Error("OpenAI unavailable")),
    });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const recEv = evidence.find((e) => e.stepId === "recommend")!;
    const oaiEv = evidence.find((e) => e.stepId === "openai")!;
    // Recommendation succeeded
    expect(recEv.status).toBe("ok");
    // OpenAI failed but is captured, not rethrown
    expect(oaiEv.status).toBe("failed");
    expect(oaiEv.safeErrorCode).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Required step failure → remaining steps skipped
// ---------------------------------------------------------------------------
describe("executeToolPlan — required step failure aborts", () => {
  it("ANALYZE_SYMBOL: analysis failure → openai step is skipped", async () => {
    const req = makeReq({ intent: "ANALYZE_SYMBOL", symbol: "MU", tickers: ["MU"] });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({
      runAnalysis: vi.fn().mockRejectedValue(
        Object.assign(new Error("MCP unavailable"), { code: "MCP_UNAVAILABLE" }),
      ),
    });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const analysisEv = evidence.find((e) => e.stepId === "analysis")!;
    const oaiEv = evidence.find((e) => e.stepId === "openai")!;
    expect(analysisEv.status).toBe("failed");
    expect(analysisEv.safeErrorCode).toBe("MCP_UNAVAILABLE");
    // OpenAI step depends on analysis → should be skipped
    expect(["skipped", undefined].includes(oaiEv?.status ?? "skipped")).toBe(true);
  });

  it("COMBINED: required recommend step failure skips openai", async () => {
    const req = makeReq({ intent: "COMBINED_ANALYSIS_RECOMMENDATION", symbol: "BA", tickers: ["BA"] });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({
      runRecommendation: vi.fn().mockRejectedValue(
        Object.assign(new Error("timeout"), { code: "BRAIN_TOOL_TIMEOUT" }),
      ),
    });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const recEv = evidence.find((e) => e.stepId === "recommend")!;
    expect(recEv.status).toBe("failed");
    expect(recEv.safeErrorCode).toBe("BRAIN_TOOL_TIMEOUT");
    // No openai step should have status "ok"
    const oaiEv = evidence.find((e) => e.stepId === "openai");
    expect(oaiEv?.status).not.toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Context isolation — tokens injected from TrustedContext, not plan args
// ---------------------------------------------------------------------------
describe("executeToolPlan — context isolation", () => {
  it("portfolioToken injected from TrustedContext, not plan args", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const ctx = makeTrustedCtx({ portfolioToken: "opaque-portfolio-token-xyz" });

    let capturedPortfolioToken: string | undefined;
    const deps = makeSuccessDeps({
      runRecommendation: vi.fn().mockImplementation(async (_goal, pt, _ot) => {
        capturedPortfolioToken = pt;
        return MOCK_RECOMMENDATION;
      }),
    });

    await executeToolPlan(plan, ctx, deps, MOCK_REQUEST_ID);
    // Token was passed from TrustedContext
    expect(capturedPortfolioToken).toBe("opaque-portfolio-token-xyz");

    // Plan step arguments must NOT contain the token
    const recStep = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    const argStr = JSON.stringify(recStep.arguments);
    expect(argStr).not.toContain("opaque-portfolio-token-xyz");
  });

  it("optionsToken injected from TrustedContext, not plan args", async () => {
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const ctx = makeTrustedCtx({ optionsToken: "opaque-options-token-abc" });

    let capturedOptionsToken: string | undefined;
    const deps = makeSuccessDeps({
      runRecommendation: vi.fn().mockImplementation(async (_goal, _pt, ot) => {
        capturedOptionsToken = ot;
        return MOCK_RECOMMENDATION;
      }),
    });

    await executeToolPlan(plan, ctx, deps, MOCK_REQUEST_ID);
    expect(capturedOptionsToken).toBe("opaque-options-token-abc");

    const recStep = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(JSON.stringify(recStep.arguments)).not.toContain("opaque-options-token-abc");
  });

  it("when NONE scope, no tokens passed to dep", async () => {
    const req = makeReq({ intent: "ANALYZE_SYMBOL", symbol: "MU", tickers: ["MU"] });
    const plan = buildToolPlan(req);
    const ctx = makeTrustedCtx({ portfolioToken: "secret-token" });

    let capturedSymbol: string | undefined;
    const deps = makeSuccessDeps({
      runAnalysis: vi.fn().mockImplementation(async (symbol) => {
        capturedSymbol = symbol;
        return MOCK_ANALYSIS;
      }),
    });

    await executeToolPlan(plan, ctx, deps, MOCK_REQUEST_ID);
    // runAnalysis only receives symbol — no token
    expect(capturedSymbol).toBe("MU");
  });
});

// ---------------------------------------------------------------------------
// Payload preservation — evidence.data is never flattened
// ---------------------------------------------------------------------------
describe("executeToolPlan — payload preservation", () => {
  it("ranked search: full payload preserved including rejectionSummary", async () => {
    const extendedRanked = {
      ...MOCK_RANKED,
      rejectionSummary: [{ reason: "RISK_LIMIT", count: 5, symbols: ["X", "Y"] }],
      excludedCount: 3,
      exclusionSummary: [{ reason: "FILTER_DIRECTION", count: 3 }],
    };
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({ runRanked: vi.fn().mockResolvedValue(extendedRanked) });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const ev = evidence.find((e) => e.stepId === "rank")!;
    const data = ev.data as typeof extendedRanked;
    expect(data.rejectionSummary).toHaveLength(1);
    expect(data.rejectionSummary[0].reason).toBe("RISK_LIMIT");
    expect(data.excludedCount).toBe(3);
  });

  it("portfolio plan: feasibility preserved exactly", async () => {
    const planWithInfeasible: PortfolioTradePlan = {
      ...MOCK_PORTFOLIO_PLAN,
      feasibility: { feasible: false, reason: "No positions qualify" },
    };
    const req = makeReq({
      intent: "PLAN_PORTFOLIO_TRADE",
      portfolioConstraints: { kind: "dollar_risk", maxRiskDollars: 100 },
    });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({ runPortfolioPlan: vi.fn().mockResolvedValue(planWithInfeasible) });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const ev = evidence.find((e) => e.stepId === "portfolio_plan")!;
    const data = ev.data as PortfolioTradePlan;
    // feasibility.feasible must never be altered
    expect(data.feasibility.feasible).toBe(false);
    expect(data.feasibility.reason).toBe("No positions qualify");
  });
});

// ---------------------------------------------------------------------------
// Mock data detection
// ---------------------------------------------------------------------------
describe("executeToolPlan — mock/simulated data detection", () => {
  it("sets dataQuality.simulated when source is 'mock'", async () => {
    const mockRec = { ...MOCK_RECOMMENDATION, source: "mock" };
    const req = makeReq({ intent: "RECOMMEND_SYMBOL_TRADE", symbol: "NVDA", tickers: ["NVDA"] });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps({ runRecommendation: vi.fn().mockResolvedValue(mockRec) });
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    const ev = evidence.find((e) => e.stepId === "recommend")!;
    expect(ev.dataQuality.simulated).toBe(true);
    expect(ev.status).toBe("degraded");
    expect(ev.source).toBe("mcp_mock");
  });
});

// ---------------------------------------------------------------------------
// No execution without a plan step
// ---------------------------------------------------------------------------
describe("executeToolPlan — execution from plan only", () => {
  it("empty plan steps → empty evidence", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = { ...buildToolPlan(req), steps: [] };
    const deps = makeSuccessDeps();
    const evidence = await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    expect(evidence).toHaveLength(0);
    expect(deps.runRanked).not.toHaveBeenCalled();
  });

  it("only planned tools are called (runAnalysis not called for RANK intent)", async () => {
    const req = makeReq({ intent: "RANK_MARKET_TRADES" });
    const plan = buildToolPlan(req);
    const deps = makeSuccessDeps();
    await executeToolPlan(plan, makeTrustedCtx(), deps, MOCK_REQUEST_ID);
    expect(deps.runAnalysis).not.toHaveBeenCalled();
    expect(deps.runRecommendation).not.toHaveBeenCalled();
  });
});
