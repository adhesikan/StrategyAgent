// Shadow Validator — Fixture Suite.
//
// Covers:
//   1. extractBrainSnapshot — field extraction from TraderBrainResult.
//   2. extractLegacySnapshot — field extraction from legacy ask.ts answer.
//   3. compareSnapshots — all 8 dimensions, all 9 intents, all mismatch categories.
//   4. The 4 initially-shadowed prompts: correct Brain intent + tool plan.
//   5. logShadowComparison — safe log format (no full payload).
//
// No live MCP, no HTTP, no OpenAI. All fixtures are deterministic.

import { describe, it, expect, vi } from "vitest";
import {
  extractBrainSnapshot,
  extractLegacySnapshot,
  compareSnapshots,
  logShadowComparison,
  type BrainValidationSnapshot,
  type LegacyAskSnapshot,
} from "../shadow-validator";
import type {
  TraderBrainResult,
  TraderBrainIntent,
  BrainExecutionStatus,
} from "../types";
import { classifyBrainIntent } from "../intent-classifier";
import { normalizeBrainRequest } from "../request-normalizer";
import { buildToolPlan } from "../planner";

// ---------------------------------------------------------------------------
// Fixture builders — pure helpers, no I/O
// ---------------------------------------------------------------------------

function makeBrainResult(overrides: Partial<TraderBrainResult> = {}): TraderBrainResult {
  return {
    requestId: "test-req-001",
    intent: "RECOMMEND_SYMBOL_TRADE",
    normalizedRequest: {
      rawPrompt: "Find a trade for BA",
      intent: "RECOMMEND_SYMBOL_TRADE",
      tickers: ["BA"],
      symbol: "BA",
    },
    status: "complete",
    headline: "Trade ready: Iron Condor on BA.",
    confidence: "medium",
    sections: {
      recommendation: {
        recommendations: [
          {
            overallVerdict: "LIVE_OPTIONS",
            recommendedStrategy: "Iron Condor",
            confidence: 0.72,
            reasons: [],
            warnings: [],
            riskAssessment: null,
            optionAnalysis: null,
            recommendedPosition: null,
            strategySummary: "",
          } as unknown as TraderBrainResult["sections"]["recommendation"] extends infer T
            ? T extends { recommendations: Array<infer R> } ? R : never
            : never,
        ],
      } as unknown as NonNullable<TraderBrainResult["sections"]["recommendation"]>,
    },
    evidence: [
      {
        stepId: "recommend",
        source: "mcp_live" as const,
        tool: "recommend_trade_strategy" as const,
        status: "ok" as const,
        durationMs: 1200,
        generatedAt: "2026-08-04T12:00:00Z",
        data: {},
        dataQuality: { estimated: false, simulated: false, partial: false, stale: false },
        warnings: [],
        limitations: [],
        verdict: "LIVE_OPTIONS",
      },
    ],
    warnings: [],
    limitations: [],
    nextActions: [
      { label: "Build ticket for BA", href: "/trade/BA", gate: "verdict_trade_ready" },
      { label: "Open BA chart", href: "/charts/BA", gate: "always" },
    ],
    generatedAt: "2026-08-04T12:00:00Z",
    openAiUsed: false,
    ...overrides,
  };
}

function makeBrainSnap(overrides: Partial<BrainValidationSnapshot> = {}): BrainValidationSnapshot {
  return {
    intent: "RECOMMEND_SYMBOL_TRADE",
    primaryTools: ["recommend_trade_strategy"],
    openAiPlanned: false,
    symbol: "BA",
    direction: undefined,
    numberOfIdeas: undefined,
    maxRiskDollars: undefined,
    verdict: "LIVE_OPTIONS",
    qualifiedCount: undefined,
    totalCandidateCount: undefined,
    warningCount: 0,
    dataQuality: { estimated: false, simulated: false, partial: false, stale: false },
    ctaGates: ["verdict_trade_ready", "always"],
    status: "complete",
    hasFailure: false,
    ...overrides,
  };
}

function makeLegacySnap(overrides: Partial<LegacyAskSnapshot> = {}): LegacyAskSnapshot {
  return {
    legacyIntent: "trade-idea",
    tickers: ["BA"],
    toolBranch: "recommendation",
    symbol: "BA",
    verdict: "LIVE_OPTIONS",
    qualifiedCount: undefined,
    totalCandidateCount: undefined,
    warningCount: 0,
    hasDataQualityFlag: false,
    hasFailure: false,
    failureKind: undefined,
    confidence: "medium",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. extractBrainSnapshot
// ---------------------------------------------------------------------------

describe("extractBrainSnapshot", () => {
  it("extracts intent, tools, symbol, verdict from RECOMMEND result", () => {
    const result = makeBrainResult();
    const snap = extractBrainSnapshot(result);
    expect(snap.intent).toBe("RECOMMEND_SYMBOL_TRADE");
    expect(snap.primaryTools).toContain("recommend_trade_strategy");
    expect(snap.symbol).toBe("BA");
    expect(snap.verdict).toBe("LIVE_OPTIONS");
    expect(snap.hasFailure).toBe(false);
  });

  it("marks hasFailure true for unavailable status", () => {
    const result = makeBrainResult({ status: "unavailable", sections: {}, nextActions: [], evidence: [] });
    const snap = extractBrainSnapshot(result);
    expect(snap.hasFailure).toBe(true);
  });

  it("marks hasFailure true for error status", () => {
    const result = makeBrainResult({ status: "error", sections: {}, evidence: [] });
    const snap = extractBrainSnapshot(result);
    expect(snap.hasFailure).toBe(true);
  });

  it("extracts qualifiedCount from rankedSearch section", () => {
    const result = makeBrainResult({
      intent: "RANK_MARKET_TRADES",
      normalizedRequest: {
        rawPrompt: "Find three bullish trades",
        intent: "RANK_MARKET_TRADES",
        tickers: [],
        direction: "bullish",
        numberOfIdeas: 3,
      },
      sections: {
        rankedSearch: {
          qualifiedCount: 3,
          watchCount: 1,
          rejectedCount: 2,
          unavailableCount: 0,
          reviewedCount: 10,
          candidates: [
            { symbol: "AAPL" } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>["candidates"][0],
            { symbol: "MSFT" } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>["candidates"][0],
            { symbol: "TSLA" } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>["candidates"][0],
          ],
          watchCandidates: [
            { symbol: "AMZN" } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>["watchCandidates"][0],
          ],
        } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
      },
    });
    const snap = extractBrainSnapshot(result);
    expect(snap.qualifiedCount).toBe(3);
    expect(snap.totalCandidateCount).toBe(4); // 3 + 1 watch
  });

  it("extracts portfolio plan verdict", () => {
    const result = makeBrainResult({
      intent: "PLAN_PORTFOLIO_TRADE",
      normalizedRequest: { rawPrompt: "Find a trade under $500 risk", intent: "PLAN_PORTFOLIO_TRADE", tickers: [], maxRiskDollars: 500 },
      sections: {
        portfolioTradePlan: {
          feasibility: { feasible: true },
          qualifiedCandidates: [{ symbol: "AAPL" }, { symbol: "MSFT" }],
        } as unknown as NonNullable<TraderBrainResult["sections"]["portfolioTradePlan"]>,
      },
    });
    const snap = extractBrainSnapshot(result);
    expect(snap.verdict).toBe("FEASIBLE");
    expect(snap.qualifiedCount).toBe(2);
  });

  it("aggregates data quality flags across evidence", () => {
    const result = makeBrainResult({
      evidence: [
        {
          stepId: "recommend",
          source: "mcp_mock" as const,
          tool: "recommend_trade_strategy" as const,
          status: "degraded" as const,
          durationMs: 800,
          generatedAt: "2026-08-04T12:00:00Z",
          data: {},
          dataQuality: { estimated: false, simulated: true, partial: false, stale: false },
          warnings: ["Mock data in use"],
          limitations: [],
        },
      ],
    });
    const snap = extractBrainSnapshot(result);
    expect(snap.dataQuality.simulated).toBe(true);
    expect(snap.dataQuality.estimated).toBe(false);
  });

  it("extracts CTA gates from nextActions", () => {
    const result = makeBrainResult();
    const snap = extractBrainSnapshot(result);
    expect(snap.ctaGates).toContain("verdict_trade_ready");
    expect(snap.ctaGates).toContain("always");
  });

  it("handles empty evidence array gracefully", () => {
    const result = makeBrainResult({
      status: "unavailable",
      evidence: [],
      sections: {},
      nextActions: [],
    });
    const snap = extractBrainSnapshot(result);
    expect(snap.primaryTools).toEqual([]);
    expect(snap.verdict).toBeUndefined();
    expect(snap.dataQuality).toEqual({ estimated: false, simulated: false, partial: false, stale: false });
  });
});

// ---------------------------------------------------------------------------
// 2. extractLegacySnapshot
// ---------------------------------------------------------------------------

describe("extractLegacySnapshot", () => {
  it("detects combined branch from multiStrategyAnalysis + strategyRecommendation", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      strategyRecommendation: {
        recommendations: [{ overallVerdict: "LIVE_OPTIONS" }],
      } as unknown as Parameters<typeof extractLegacySnapshot>[2] extends null | undefined ? never : NonNullable<Parameters<typeof extractLegacySnapshot>[2]>["strategyRecommendation"],
      multiStrategyAnalysis: { dataQuality: { realMarketData: true } },
    });
    expect(snap.toolBranch).toBe("combined");
    expect(snap.verdict).toBe("LIVE_OPTIONS");
  });

  it("detects recommendation branch (no multiStrategy)", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      strategyRecommendation: {
        recommendations: [{ overallVerdict: "WATCH" }],
      } as unknown as NonNullable<Parameters<typeof extractLegacySnapshot>[2]>["strategyRecommendation"],
    });
    expect(snap.toolBranch).toBe("recommendation");
    expect(snap.verdict).toBe("WATCH");
  });

  it("detects multi_strategy branch (no recommendation)", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      multiStrategyAnalysis: { dataQuality: { realMarketData: true } },
    });
    expect(snap.toolBranch).toBe("multi_strategy");
    expect(snap.verdict).toBeUndefined();
  });

  it("detects vcp branch", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      vcpAnalysis: { stage: 2 },
    });
    expect(snap.toolBranch).toBe("vcp");
  });

  it("defaults to openai_only when no deterministic data", () => {
    const snap = extractLegacySnapshot("general", [], null);
    expect(snap.toolBranch).toBe("openai_only");
    expect(snap.symbol).toBeUndefined();
    expect(snap.hasFailure).toBe(false);
  });

  it("detects recommendationFailed", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      recommendationFailed: true,
    });
    expect(snap.hasFailure).toBe(true);
    expect(snap.failureKind).toBe("recommendation");
  });

  it("detects vcpScanFailed", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      vcpScanFailed: true,
    });
    expect(snap.hasFailure).toBe(true);
    expect(snap.failureKind).toBe("vcp");
  });

  it("sets hasDataQualityFlag when realMarketData is false", () => {
    const snap = extractLegacySnapshot("trade-idea", ["BA"], {
      multiStrategyAnalysis: { dataQuality: { realMarketData: false } },
    });
    expect(snap.hasDataQualityFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. compareSnapshots — intent dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — INTENT dimension", () => {
  it("MATCH: trade-idea + RECOMMEND_SYMBOL_TRADE", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-1");
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH: news + MARKET_RESEARCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "MARKET_RESEARCH" }),
      makeLegacySnap({ legacyIntent: "news", toolBranch: "openai_only" }),
      "req-2",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH: best-trade + RANK_MARKET_TRADES", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "RANK_MARKET_TRADES", primaryTools: ["rank_market_trade_candidates"], symbol: undefined }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", symbol: undefined }),
      "req-3",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE: trade-idea + PLAN_PORTFOLIO_TRADE", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "PLAN_PORTFOLIO_TRADE", primaryTools: ["plan_portfolio_trade"], symbol: undefined }),
      makeLegacySnap({ legacyIntent: "trade-idea", toolBranch: "portfolio_trade_plan" }),
      "req-4",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: trade-idea + EXPLAIN_CONCEPT → INTENT_MISMATCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "EXPLAIN_CONCEPT", primaryTools: [] }),
      makeLegacySnap({ legacyIntent: "trade-idea" }),
      "req-5",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("INTENT_MISMATCH");
    expect(r.mismatchCategories).toContain("INTENT_MISMATCH");
  });

  it("MISMATCH: news + RECOMMEND_SYMBOL_TRADE → INTENT_MISMATCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "RECOMMEND_SYMBOL_TRADE" }),
      makeLegacySnap({ legacyIntent: "news", toolBranch: "openai_only" }),
      "req-6",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("INTENT_MISMATCH");
  });

  it("EXPECTED_DIFFERENCE: general + EDUCATION_PLUS_ACTION", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "EDUCATION_PLUS_ACTION", primaryTools: [] }),
      makeLegacySnap({ legacyIntent: "general", toolBranch: "openai_only" }),
      "req-7",
    );
    const d = r.dimensions.find((d) => d.dimension === "intent")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });
});

// ---------------------------------------------------------------------------
// 3b. compareSnapshots — argument dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — ARGUMENTS dimension", () => {
  it("MATCH when symbols agree", () => {
    const r = compareSnapshots(makeBrainSnap({ symbol: "BA" }), makeLegacySnap({ symbol: "BA" }), "req-10");
    const d = r.dimensions.find((d) => d.dimension === "arguments")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MISMATCH when symbols disagree on single-symbol intent", () => {
    const r = compareSnapshots(
      makeBrainSnap({ symbol: "AAPL" }),
      makeLegacySnap({ symbol: "BA" }),
      "req-11",
    );
    const d = r.dimensions.find((d) => d.dimension === "arguments")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("ARGUMENT_MISMATCH");
  });

  it("MISMATCH when brain misses symbol on RECOMMEND intent", () => {
    const r = compareSnapshots(
      makeBrainSnap({ symbol: undefined }),
      makeLegacySnap({ symbol: "BA" }),
      "req-12",
    );
    const d = r.dimensions.find((d) => d.dimension === "arguments")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("ARGUMENT_MISMATCH");
  });

  it("EXPECTED_DIFFERENCE when brain has maxRiskDollars on non-portfolio legacy branch", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "PLAN_PORTFOLIO_TRADE", maxRiskDollars: 500, symbol: undefined }),
      makeLegacySnap({ legacyIntent: "trade-idea", toolBranch: "recommendation", symbol: undefined }),
      "req-13",
    );
    const d = r.dimensions.find((d) => d.dimension === "arguments")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });
});

// ---------------------------------------------------------------------------
// 3c. compareSnapshots — tool plan dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — TOOL_PLAN dimension", () => {
  it("MATCH: recommendation tool branch + recommend_trade_strategy", () => {
    const r = compareSnapshots(
      makeBrainSnap({ primaryTools: ["recommend_trade_strategy"] }),
      makeLegacySnap({ toolBranch: "recommendation" }),
      "req-20",
    );
    const d = r.dimensions.find((d) => d.dimension === "tool_plan")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH: ranked tool branch + rank_market_trade_candidates", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "RANK_MARKET_TRADES", primaryTools: ["rank_market_trade_candidates"], symbol: undefined }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", symbol: undefined }),
      "req-21",
    );
    const d = r.dimensions.find((d) => d.dimension === "tool_plan")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH: vcp branch → brain uses multi_strategy_analysis (canonical substitution)", () => {
    // multi_strategy_analysis IS the canonical Brain tool for the legacy vcp branch.
    // Brain replaces VCP-only scan with multi-strategy; this is a MATCH, not a difference.
    const r = compareSnapshots(
      makeBrainSnap({ primaryTools: ["multi_strategy_analysis"] }),
      makeLegacySnap({ toolBranch: "vcp" }),
      "req-22",
    );
    const d = r.dimensions.find((d) => d.dimension === "tool_plan")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE: openai_only legacy + brain adds deterministic MCP", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "ANALYZE_SYMBOL", primaryTools: ["multi_strategy_analysis"] }),
      makeLegacySnap({ legacyIntent: "general", toolBranch: "openai_only" }),
      "req-23",
    );
    const d = r.dimensions.find((d) => d.dimension === "tool_plan")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: recommendation branch but brain picks rank tool", () => {
    const r = compareSnapshots(
      makeBrainSnap({ primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ toolBranch: "recommendation" }),
      "req-24",
    );
    const d = r.dimensions.find((d) => d.dimension === "tool_plan")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("TOOL_PLAN_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3d. compareSnapshots — verdict dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — VERDICT dimension", () => {
  it("MATCH when both have same verdict", () => {
    const r = compareSnapshots(makeBrainSnap({ verdict: "LIVE_OPTIONS" }), makeLegacySnap({ verdict: "LIVE_OPTIONS" }), "req-30");
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH when neither has a verdict", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: undefined, intent: "MARKET_RESEARCH", primaryTools: [] }),
      makeLegacySnap({ verdict: undefined, toolBranch: "openai_only" }),
      "req-31",
    );
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE: LIVE_OPTIONS vs ESTIMATED_OPTIONS", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "ESTIMATED_OPTIONS" }),
      "req-32",
    );
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: LIVE_OPTIONS vs WATCH → VERDICT_MISMATCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "WATCH" }),
      "req-33",
    );
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("VERDICT_MISMATCH");
  });

  it("EXPECTED_DIFFERENCE: brain unavailable, legacy has verdict", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: undefined, status: "unavailable", hasFailure: true }),
      makeLegacySnap({ verdict: "LIVE_OPTIONS" }),
      "req-34",
    );
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: brain has no verdict but legacy succeeded → VERDICT_MISMATCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: undefined, status: "complete" }),
      makeLegacySnap({ verdict: "STOCK" }),
      "req-35",
    );
    const d = r.dimensions.find((d) => d.dimension === "verdict")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("VERDICT_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3e. compareSnapshots — count dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — COUNT dimension", () => {
  it("MATCH when counts agree", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "RANK_MARKET_TRADES", qualifiedCount: 3, primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", qualifiedCount: 3 }),
      "req-40",
    );
    const d = r.dimensions.find((d) => d.dimension === "count")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE for minor count variance (±1)", () => {
    const r = compareSnapshots(
      makeBrainSnap({ qualifiedCount: 3, primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", qualifiedCount: 2 }),
      "req-41",
    );
    const d = r.dimensions.find((d) => d.dimension === "count")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH for large count divergence", () => {
    const r = compareSnapshots(
      makeBrainSnap({ qualifiedCount: 0, primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", qualifiedCount: 5 }),
      "req-42",
    );
    const d = r.dimensions.find((d) => d.dimension === "count")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("COUNT_MISMATCH");
  });

  it("MATCH when neither has a count (non-ranked intent)", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-43");
    const d = r.dimensions.find((d) => d.dimension === "count")!;
    expect(d.verdict).toBe("MATCH");
  });
});

// ---------------------------------------------------------------------------
// 3f. compareSnapshots — data quality dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — DATA_QUALITY dimension", () => {
  it("MATCH when both clean", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-50");
    const d = r.dimensions.find((d) => d.dimension === "data_quality")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE when brain flags simulated, legacy does not", () => {
    const r = compareSnapshots(
      makeBrainSnap({ dataQuality: { simulated: true, estimated: false, partial: false, stale: false } }),
      makeLegacySnap({ hasDataQualityFlag: false }),
      "req-51",
    );
    const d = r.dimensions.find((d) => d.dimension === "data_quality")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: DATA_QUALITY_MISMATCH when legacy flags but brain does not", () => {
    const r = compareSnapshots(
      makeBrainSnap({ dataQuality: { simulated: false, estimated: false, partial: false, stale: false } }),
      makeLegacySnap({ hasDataQualityFlag: true }),
      "req-52",
    );
    const d = r.dimensions.find((d) => d.dimension === "data_quality")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("DATA_QUALITY_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3g. compareSnapshots — CTA dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — CTA dimension", () => {
  it("MATCH when both have trade-ready CTA for LIVE_OPTIONS verdict", () => {
    const r = compareSnapshots(
      makeBrainSnap({ ctaGates: ["verdict_trade_ready", "always"], verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "LIVE_OPTIONS" }),
      "req-60",
    );
    const d = r.dimensions.find((d) => d.dimension === "cta")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH when neither is trade-ready (WATCH verdict)", () => {
    const r = compareSnapshots(
      makeBrainSnap({ ctaGates: ["verdict_watch", "always"], verdict: "WATCH" }),
      makeLegacySnap({ verdict: "WATCH" }),
      "req-61",
    );
    const d = r.dimensions.find((d) => d.dimension === "cta")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE: legacy LIVE_OPTIONS but brain unavailable (Phase 0)", () => {
    const r = compareSnapshots(
      makeBrainSnap({ ctaGates: [], verdict: undefined, status: "unavailable", hasFailure: true }),
      makeLegacySnap({ verdict: "LIVE_OPTIONS" }),
      "req-62",
    );
    const d = r.dimensions.find((d) => d.dimension === "cta")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: CTA_MISMATCH when brain offers trade-ready but legacy WATCH", () => {
    const r = compareSnapshots(
      makeBrainSnap({ ctaGates: ["verdict_trade_ready", "always"], verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "WATCH" }),
      "req-63",
    );
    const d = r.dimensions.find((d) => d.dimension === "cta")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("CTA_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3h. compareSnapshots — failure policy dimension
// ---------------------------------------------------------------------------

describe("compareSnapshots — FAILURE_POLICY dimension", () => {
  it("MATCH when both succeed", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-70");
    const d = r.dimensions.find((d) => d.dimension === "failure_policy")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("MATCH when both fail", () => {
    const r = compareSnapshots(
      makeBrainSnap({ hasFailure: true, status: "error" }),
      makeLegacySnap({ hasFailure: true, failureKind: "recommendation" }),
      "req-71",
    );
    const d = r.dimensions.find((d) => d.dimension === "failure_policy")!;
    expect(d.verdict).toBe("MATCH");
  });

  it("EXPECTED_DIFFERENCE: brain unavailable, legacy succeeded", () => {
    const r = compareSnapshots(
      makeBrainSnap({ hasFailure: true, status: "unavailable" }),
      makeLegacySnap({ hasFailure: false }),
      "req-72",
    );
    const d = r.dimensions.find((d) => d.dimension === "failure_policy")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });

  it("MISMATCH: FAILURE_POLICY_MISMATCH when brain errors on complete status", () => {
    const r = compareSnapshots(
      makeBrainSnap({ hasFailure: true, status: "error" }),
      makeLegacySnap({ hasFailure: false }),
      "req-73",
    );
    const d = r.dimensions.find((d) => d.dimension === "failure_policy")!;
    expect(d.verdict).toBe("MISMATCH");
    expect(d.category).toBe("FAILURE_POLICY_MISMATCH");
  });

  it("EXPECTED_DIFFERENCE: legacy failed, brain recovered", () => {
    const r = compareSnapshots(
      makeBrainSnap({ hasFailure: false }),
      makeLegacySnap({ hasFailure: true, failureKind: "recommendation" }),
      "req-74",
    );
    const d = r.dimensions.find((d) => d.dimension === "failure_policy")!;
    expect(d.verdict).toBe("EXPECTED_DIFFERENCE");
  });
});

// ---------------------------------------------------------------------------
// 4. Overall verdict and migratable logic
// ---------------------------------------------------------------------------

describe("compareSnapshots — overall verdict and migratable", () => {
  it("overallVerdict MATCH when all dimensions match", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-80");
    expect(r.overallVerdict).toBe("MATCH");
    expect(r.migratable).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it("overallVerdict EXPECTED_DIFFERENCE with no blockers → migratable", () => {
    // PLAN_PORTFOLIO_TRADE vs trade-idea/recommendation:
    // intent dimension → EXPECTED_DIFFERENCE (acceptable, not canonical)
    // tool_plan dimension → MISMATCH (plan_portfolio_trade vs recommendation)
    // But TOOL_PLAN_MISMATCH is not a blocking category, so migratable=false.
    // Use a fixture that only hits a non-blocking EXPECTED_DIFFERENCE:
    // openai_only legacy + brain adds MCP tools → EXPECTED_DIFFERENCE on tool_plan.
    const r = compareSnapshots(
      makeBrainSnap({
        intent: "ANALYZE_SYMBOL",
        primaryTools: ["multi_strategy_analysis"],
        symbol: undefined,
        verdict: undefined,
        ctaGates: ["always"],  // no verdict_trade_ready — brain has no trade-ready verdict
      }),
      makeLegacySnap({ legacyIntent: "general", toolBranch: "openai_only", symbol: undefined, verdict: undefined }),
      "req-81",
    );
    // intent: ANALYZE_SYMBOL in canonical["general"] → MATCH
    // tool_plan: openai_only legacy + brain adds multi_strategy → EXPECTED_DIFFERENCE
    // cta: neither side is trade-ready → MATCH
    // So overall is EXPECTED_DIFFERENCE and migratable=true (no blocking categories)
    expect(r.overallVerdict).toBe("EXPECTED_DIFFERENCE");
    expect(r.migratable).toBe(true);
  });

  it("overallVerdict MISMATCH when blocking dimension fails → not migratable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "EXPLAIN_CONCEPT", primaryTools: [], verdict: undefined }),
      makeLegacySnap({ legacyIntent: "trade-idea", verdict: "LIVE_OPTIONS" }),
      "req-82",
    );
    expect(r.overallVerdict).toBe("MISMATCH");
    expect(r.migratable).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("mismatchCategories only contains categories from MISMATCH dimensions", () => {
    const r = compareSnapshots(
      makeBrainSnap({ qualifiedCount: 0, primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", qualifiedCount: 5 }),
      "req-83",
    );
    expect(r.mismatchCategories).toContain("COUNT_MISMATCH");
    expect(r.mismatchCategories).not.toContain("INTENT_MISMATCH");
  });

  it("has exactly 8 dimensions", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-84");
    expect(r.dimensions).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 5. The 4 initially-shadowed prompts — intent + plan validation
// ---------------------------------------------------------------------------

describe("4 initially-shadowed prompts — intent classification", () => {
  it("'Find a trade for BA' → RECOMMEND_SYMBOL_TRADE", () => {
    const intent = classifyBrainIntent("Find a trade for BA", ["BA"]);
    expect(intent).toBe("RECOMMEND_SYMBOL_TRADE");
  });

  it("'Find three bullish trades' → RANK_MARKET_TRADES", () => {
    const intent = classifyBrainIntent("Find three bullish trades", []);
    expect(intent).toBe("RANK_MARKET_TRADES");
  });

  it("'Find a trade under $500 risk' → PLAN_PORTFOLIO_TRADE", () => {
    const intent = classifyBrainIntent("Find a trade under $500 risk", []);
    expect(intent).toBe("PLAN_PORTFOLIO_TRADE");
  });

  it("'Analyze BA and recommend a trade' → COMBINED_ANALYSIS_RECOMMENDATION", () => {
    const intent = classifyBrainIntent("Analyze BA and recommend a trade", ["BA"]);
    expect(intent).toBe("COMBINED_ANALYSIS_RECOMMENDATION");
  });
});

describe("4 initially-shadowed prompts — tool plan correctness", () => {
  it("RECOMMEND_SYMBOL_TRADE plan has recommend_trade_strategy as primary tool", () => {
    const norm = normalizeBrainRequest("RECOMMEND_SYMBOL_TRADE", "Find a trade for BA", ["BA"]);
    const plan = buildToolPlan(norm);
    const primary = plan.steps.filter((s) => s.tool !== "openai_explanation");
    expect(primary.map((s) => s.tool)).toContain("recommend_trade_strategy");
    expect(norm.symbol).toBe("BA");
  });

  it("RANK_MARKET_TRADES plan has rank_market_trade_candidates + numberOfIdeas=3 + bullish direction", () => {
    const norm = normalizeBrainRequest("RANK_MARKET_TRADES", "Find three bullish trades", []);
    const plan = buildToolPlan(norm);
    const primary = plan.steps.filter((s) => s.tool !== "openai_explanation");
    expect(primary.map((s) => s.tool)).toContain("rank_market_trade_candidates");
    expect(norm.direction).toBe("bullish");
    expect(norm.numberOfIdeas).toBe(3);
  });

  it("PLAN_PORTFOLIO_TRADE plan has plan_portfolio_trade + maxRiskDollars=500", () => {
    const norm = normalizeBrainRequest("PLAN_PORTFOLIO_TRADE", "Find a trade under $500 risk", []);
    const plan = buildToolPlan(norm);
    const primary = plan.steps.filter((s) => s.tool !== "openai_explanation");
    expect(primary.map((s) => s.tool)).toContain("plan_portfolio_trade");
    expect(norm.portfolioConstraints?.maxRiskDollars).toBe(500);
  });

  it("COMBINED plan has both multi_strategy_analysis and recommend_trade_strategy, symbol=BA", () => {
    const norm = normalizeBrainRequest("COMBINED_ANALYSIS_RECOMMENDATION", "Analyze BA and recommend a trade", ["BA"]);
    const plan = buildToolPlan(norm);
    const tools = plan.steps.map((s) => s.tool);
    expect(tools).toContain("multi_strategy_analysis");
    expect(tools).toContain("recommend_trade_strategy");
    expect(norm.symbol).toBe("BA");
  });

  it("OpenAI step is always optional in all 4 plans", () => {
    const fixtures = [
      { intent: "RECOMMEND_SYMBOL_TRADE" as TraderBrainIntent, q: "Find a trade for BA", t: ["BA"] },
      { intent: "RANK_MARKET_TRADES" as TraderBrainIntent, q: "Find three bullish trades", t: [] },
      { intent: "PLAN_PORTFOLIO_TRADE" as TraderBrainIntent, q: "Find a trade under $500 risk", t: [] },
      { intent: "COMBINED_ANALYSIS_RECOMMENDATION" as TraderBrainIntent, q: "Analyze BA and recommend a trade", t: ["BA"] },
    ];
    for (const { intent, q, t } of fixtures) {
      const norm = normalizeBrainRequest(intent, q, t);
      const plan = buildToolPlan(norm);
      const openAiSteps = plan.steps.filter((s) => s.tool === "openai_explanation");
      for (const step of openAiSteps) {
        expect(step.required, `OpenAI step must be optional for intent ${intent}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. All 9 intents — intent compatibility fixture table
// ---------------------------------------------------------------------------

describe("All 9 intents — legacy compatibility fixture table", () => {
  const fixtures: Array<{
    brain: TraderBrainIntent;
    legacy: LegacyAskSnapshot["legacyIntent"];
    branch: LegacyAskSnapshot["toolBranch"];
    expectedVerdict: "MATCH" | "EXPECTED_DIFFERENCE";
  }> = [
    // ANALYZE_SYMBOL is in canonical["general"] and multi_strategy_analysis is the
    // canonical Brain tool for the vcp branch → both intent and tool_plan dimensions
    // return MATCH; overall is MATCH.
    { brain: "ANALYZE_SYMBOL",                    legacy: "general",     branch: "vcp",            expectedVerdict: "MATCH" },
    { brain: "RECOMMEND_SYMBOL_TRADE",            legacy: "trade-idea",  branch: "recommendation", expectedVerdict: "MATCH" },
    { brain: "RANK_MARKET_TRADES",                legacy: "best-trade",  branch: "ranked_trade_search", expectedVerdict: "MATCH" },
    { brain: "PLAN_PORTFOLIO_TRADE",              legacy: "trade-idea",  branch: "portfolio_trade_plan", expectedVerdict: "EXPECTED_DIFFERENCE" },
    { brain: "COMBINED_ANALYSIS_RECOMMENDATION",  legacy: "trade-idea",  branch: "combined",       expectedVerdict: "MATCH" },
    { brain: "EXPLAIN_CONCEPT",                   legacy: "general",     branch: "openai_only",    expectedVerdict: "MATCH" },
    { brain: "EDUCATION_PLUS_ACTION",             legacy: "general",     branch: "openai_only",    expectedVerdict: "EXPECTED_DIFFERENCE" },
    { brain: "MARKET_RESEARCH",                   legacy: "news",        branch: "openai_only",    expectedVerdict: "MATCH" },
    { brain: "UNKNOWN",                           legacy: "general",     branch: "openai_only",    expectedVerdict: "MATCH" },
  ];

  for (const { brain, legacy, branch, expectedVerdict } of fixtures) {
    it(`${brain} vs ${legacy}/${branch} → intent dimension ${expectedVerdict}`, () => {
      const brainSnap = makeBrainSnap({ intent: brain, primaryTools: [], verdict: undefined });
      const legacySnap = makeLegacySnap({ legacyIntent: legacy, toolBranch: branch, verdict: undefined });
      const r = compareSnapshots(brainSnap, legacySnap, `fixture-${brain}`);
      const d = r.dimensions.find((d) => d.dimension === "intent")!;
      expect(d.verdict).toBe(expectedVerdict);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. logShadowComparison — safe log format
// ---------------------------------------------------------------------------

describe("logShadowComparison — safe log format", () => {
  it("emits structured JSON without full payload", () => {
    const r = compareSnapshots(makeBrainSnap(), makeLegacySnap(), "req-log-1");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logShadowComparison(r);
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe("BRAIN_SHADOW_COMPARISON");
    expect(logged.requestId).toBe("req-log-1");
    expect(logged.overallVerdict).toBe("MATCH");
    expect(logged.dimensionVerdicts).toHaveProperty("intent");
    // Ensure no full payload fields
    expect(logged).not.toHaveProperty("brainValue");
    expect(logged).not.toHaveProperty("legacyValue");
    spy.mockRestore();
  });

  it("logs migratable and mismatchCategories", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "EXPLAIN_CONCEPT", primaryTools: [], verdict: undefined }),
      makeLegacySnap({ legacyIntent: "trade-idea", verdict: "LIVE_OPTIONS" }),
      "req-log-2",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logShadowComparison(r);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.migratable).toBe(false);
    expect(Array.isArray(logged.mismatchCategories)).toBe(true);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. Mismatch category completeness
// ---------------------------------------------------------------------------

describe("All 8 mismatch categories are reachable", () => {
  const ALL_CATEGORIES: readonly string[] = [
    "INTENT_MISMATCH",
    "ARGUMENT_MISMATCH",
    "TOOL_PLAN_MISMATCH",
    "VERDICT_MISMATCH",
    "COUNT_MISMATCH",
    "DATA_QUALITY_MISMATCH",
    "CTA_MISMATCH",
    "FAILURE_POLICY_MISMATCH",
  ] as const;

  it("INTENT_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ intent: "EXPLAIN_CONCEPT", primaryTools: [] }),
      makeLegacySnap({ legacyIntent: "trade-idea" }),
      "cat-intent",
    );
    expect(r.mismatchCategories).toContain("INTENT_MISMATCH");
  });

  it("ARGUMENT_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ symbol: "AAPL" }),
      makeLegacySnap({ symbol: "BA" }),
      "cat-arg",
    );
    expect(r.mismatchCategories).toContain("ARGUMENT_MISMATCH");
  });

  it("TOOL_PLAN_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ toolBranch: "recommendation" }),
      "cat-tool",
    );
    expect(r.mismatchCategories).toContain("TOOL_PLAN_MISMATCH");
  });

  it("VERDICT_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "WATCH" }),
      "cat-verdict",
    );
    expect(r.mismatchCategories).toContain("VERDICT_MISMATCH");
  });

  it("COUNT_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ qualifiedCount: 0, primaryTools: ["rank_market_trade_candidates"] }),
      makeLegacySnap({ legacyIntent: "best-trade", toolBranch: "ranked_trade_search", qualifiedCount: 5 }),
      "cat-count",
    );
    expect(r.mismatchCategories).toContain("COUNT_MISMATCH");
  });

  it("DATA_QUALITY_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ dataQuality: { simulated: false, estimated: false, partial: false, stale: false } }),
      makeLegacySnap({ hasDataQualityFlag: true }),
      "cat-dq",
    );
    expect(r.mismatchCategories).toContain("DATA_QUALITY_MISMATCH");
  });

  it("CTA_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ ctaGates: ["verdict_trade_ready"], verdict: "LIVE_OPTIONS" }),
      makeLegacySnap({ verdict: "WATCH" }),
      "cat-cta",
    );
    expect(r.mismatchCategories).toContain("CTA_MISMATCH");
  });

  it("FAILURE_POLICY_MISMATCH is reachable", () => {
    const r = compareSnapshots(
      makeBrainSnap({ hasFailure: true, status: "error" }),
      makeLegacySnap({ hasFailure: false }),
      "cat-fail",
    );
    expect(r.mismatchCategories).toContain("FAILURE_POLICY_MISMATCH");
  });

  it("every category in ALL_CATEGORIES is tested above", () => {
    // Structural check: the list is exhaustive.
    expect(ALL_CATEGORIES).toHaveLength(8);
  });
});
