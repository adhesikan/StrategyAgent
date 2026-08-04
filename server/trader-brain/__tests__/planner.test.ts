// TraderBrain — Planner tests.
//
// Covers: deterministic tool plans, no duplicate tools, valid dependency DAGs,
// OpenAI step always optional, no credentials in args, ordering, tool allowlist.

import { describe, it, expect } from "vitest";
import {
  buildToolPlan,
  planHasNoDuplicateTools,
  planDepsAreValid,
  openAiStepIsOptional,
  findCredentialArgs,
} from "../planner";
import type { NormalizedBrainRequest } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<NormalizedBrainRequest>): NormalizedBrainRequest {
  return {
    rawPrompt: "test",
    intent: "RANK_MARKET_TRADES",
    tickers: [],
    ...overrides,
  };
}

const ANALYZE_SYMBOL_REQ = makeReq({
  intent: "ANALYZE_SYMBOL",
  symbol: "MU",
  tickers: ["MU"],
});

const RECOMMEND_REQ = makeReq({
  intent: "RECOMMEND_SYMBOL_TRADE",
  symbol: "NVDA",
  tickers: ["NVDA"],
  requestedStrategy: "covered_call",
  objective: "income",
});

const RANK_REQ = makeReq({
  intent: "RANK_MARKET_TRADES",
  tickers: [],
  objective: "income",
  maxRiskDollars: 500,
});

const PORTFOLIO_REQ = makeReq({
  intent: "PLAN_PORTFOLIO_TRADE",
  tickers: [],
  portfolioConstraints: {
    kind: "dollar_risk",
    maxRiskDollars: 500,
  },
  maxRiskDollars: 500,
});

const COMBINED_REQ = makeReq({
  intent: "COMBINED_ANALYSIS_RECOMMENDATION",
  symbol: "AAPL",
  tickers: ["AAPL"],
});

const EXPLAIN_REQ = makeReq({
  intent: "EXPLAIN_CONCEPT",
  tickers: [],
  educationTopic: "credit spreads",
});

const EDU_PLUS_ACTION_REQ = makeReq({
  intent: "EDUCATION_PLUS_ACTION",
  tickers: [],
  educationTopic: "VCP",
});

const MARKET_RESEARCH_REQ = makeReq({
  intent: "MARKET_RESEARCH",
  tickers: [],
});

const UNKNOWN_REQ = makeReq({
  intent: "UNKNOWN",
  tickers: [],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolsIn(req: NormalizedBrainRequest) {
  return buildToolPlan(req).steps.map((s) => s.tool);
}

// ---------------------------------------------------------------------------
// ANALYZE_SYMBOL plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — ANALYZE_SYMBOL", () => {
  it("includes multi_strategy_analysis", () => {
    expect(toolsIn(ANALYZE_SYMBOL_REQ)).toContain("multi_strategy_analysis");
  });
  it("analysis step has symbol in args", () => {
    const plan = buildToolPlan(ANALYZE_SYMBOL_REQ);
    const step = plan.steps.find((s) => s.tool === "multi_strategy_analysis")!;
    expect(step.arguments.symbol).toBe("MU");
  });
  it("analysis step is required", () => {
    const plan = buildToolPlan(ANALYZE_SYMBOL_REQ);
    const step = plan.steps.find((s) => s.tool === "multi_strategy_analysis")!;
    expect(step.required).toBe(true);
  });
  it("openai step is optional", () => {
    expect(openAiStepIsOptional(buildToolPlan(ANALYZE_SYMBOL_REQ))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RECOMMEND_SYMBOL_TRADE plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — RECOMMEND_SYMBOL_TRADE", () => {
  it("includes recommend_trade_strategy", () => {
    expect(toolsIn(RECOMMEND_REQ)).toContain("recommend_trade_strategy");
  });
  it("symbol is passed in args", () => {
    const plan = buildToolPlan(RECOMMEND_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.arguments.symbol).toBe("NVDA");
  });
  it("strategy and objective forwarded", () => {
    const plan = buildToolPlan(RECOMMEND_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.arguments.requestedStrategy).toBe("covered_call");
    expect(step.arguments.objective).toBe("income");
  });
  it("requires PORTFOLIO_CONTEXT and OPTIONS_CONTEXT scopes", () => {
    const plan = buildToolPlan(RECOMMEND_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.trustedContextScopes).toContain("PORTFOLIO_CONTEXT");
    expect(step.trustedContextScopes).toContain("OPTIONS_CONTEXT");
  });
  it("openai step depends on recommend step", () => {
    const plan = buildToolPlan(RECOMMEND_REQ);
    const openAiStep = plan.steps.find((s) => s.tool === "openai_explanation");
    expect(openAiStep?.dependsOn).toContain("recommend");
  });
});

// ---------------------------------------------------------------------------
// RANK_MARKET_TRADES plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — RANK_MARKET_TRADES", () => {
  it("includes rank_market_trade_candidates", () => {
    expect(toolsIn(RANK_REQ)).toContain("rank_market_trade_candidates");
  });
  it("does NOT include openai_explanation (rank is self-contained)", () => {
    expect(toolsIn(RANK_REQ)).not.toContain("openai_explanation");
  });
  it("risk budget forwarded to args", () => {
    const plan = buildToolPlan(RANK_REQ);
    const step = plan.steps.find((s) => s.tool === "rank_market_trade_candidates")!;
    expect(step.arguments.maxRiskDollars).toBe(500);
  });
  it("objective forwarded", () => {
    const plan = buildToolPlan(RANK_REQ);
    const step = plan.steps.find((s) => s.tool === "rank_market_trade_candidates")!;
    expect(step.arguments.objective).toBe("income");
  });
  it("responsePolicy.requiresOpenAi is false", () => {
    expect(buildToolPlan(RANK_REQ).responsePolicy.requiresOpenAi).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PLAN_PORTFOLIO_TRADE plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — PLAN_PORTFOLIO_TRADE", () => {
  it("includes plan_portfolio_trade", () => {
    expect(toolsIn(PORTFOLIO_REQ)).toContain("plan_portfolio_trade");
  });
  it("maxRiskDollars forwarded", () => {
    const plan = buildToolPlan(PORTFOLIO_REQ);
    const step = plan.steps.find((s) => s.tool === "plan_portfolio_trade")!;
    expect(step.arguments.maxRiskDollars).toBe(500);
  });
  it("failure policy is degrade_to_market_only", () => {
    const plan = buildToolPlan(PORTFOLIO_REQ);
    const step = plan.steps.find((s) => s.tool === "plan_portfolio_trade")!;
    expect(step.failurePolicy).toBe("degrade_to_market_only");
  });
  it("requires PORTFOLIO_CONTEXT scope", () => {
    const plan = buildToolPlan(PORTFOLIO_REQ);
    const step = plan.steps.find((s) => s.tool === "plan_portfolio_trade")!;
    expect(step.trustedContextScopes).toContain("PORTFOLIO_CONTEXT");
  });
});

// ---------------------------------------------------------------------------
// COMBINED_ANALYSIS_RECOMMENDATION plan (legacy assertions — superseded below)
// The migration makes both steps independent; tests consolidated into the
// "migration invariants" suite later in this file.
// ---------------------------------------------------------------------------
describe("buildToolPlan — COMBINED_ANALYSIS_RECOMMENDATION (basic)", () => {
  it("includes both multi_strategy_analysis and recommend_trade_strategy", () => {
    const tools = toolsIn(COMBINED_REQ);
    expect(tools).toContain("multi_strategy_analysis");
    expect(tools).toContain("recommend_trade_strategy");
  });
  // Post-migration: recommend runs independently — it does NOT depend on analysis.
  it("recommend step does NOT depend on analysis (independent after migration)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const recStep = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(recStep.dependsOn).not.toContain("analysis");
  });
});

// ---------------------------------------------------------------------------
// EXPLAIN_CONCEPT plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — EXPLAIN_CONCEPT", () => {
  it("contains only openai_explanation (no MCP trading tools)", () => {
    const tools = toolsIn(EXPLAIN_REQ);
    expect(tools).toEqual(["openai_explanation"]);
  });
  it("openai step has no MCP dependencies", () => {
    const plan = buildToolPlan(EXPLAIN_REQ);
    const step = plan.steps[0];
    expect(step.dependsOn).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EDUCATION_PLUS_ACTION plan
// ---------------------------------------------------------------------------
describe("buildToolPlan — EDUCATION_PLUS_ACTION", () => {
  it("includes a trading action tool and openai_explanation", () => {
    const tools = toolsIn(EDU_PLUS_ACTION_REQ);
    const hasMcp = tools.some((t) =>
      t === "recommend_trade_strategy" || t === "rank_market_trade_candidates"
    );
    expect(hasMcp).toBe(true);
    expect(tools).toContain("openai_explanation");
  });
});

// ---------------------------------------------------------------------------
// COMBINED_ANALYSIS_RECOMMENDATION plan — migration invariants
// ---------------------------------------------------------------------------
describe("buildToolPlan — COMBINED_ANALYSIS_RECOMMENDATION", () => {
  it("includes both multi_strategy_analysis and recommend_trade_strategy", () => {
    const tools = toolsIn(COMBINED_REQ);
    expect(tools).toContain("multi_strategy_analysis");
    expect(tools).toContain("recommend_trade_strategy");
  });

  it("analysis step is NOT required (skip_section on failure)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "multi_strategy_analysis")!;
    expect(step.required).toBe(false);
    expect(step.failurePolicy).toBe("skip_section");
  });

  it("recommend step is NOT required (skip_section on failure)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.required).toBe(false);
    expect(step.failurePolicy).toBe("skip_section");
  });

  it("recommend step does NOT depend on analysis (independent execution)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.dependsOn).not.toContain("analysis");
  });

  it("analysis step does NOT depend on recommend (independent execution)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "multi_strategy_analysis")!;
    expect(step.dependsOn).not.toContain("recommend");
  });

  it("openai_explanation step has no dependsOn (runs regardless of sections)", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const oaiStep = plan.steps.find((s) => s.tool === "openai_explanation")!;
    expect(oaiStep).toBeDefined();
    expect(oaiStep.dependsOn).toHaveLength(0);
  });

  it("symbol is forwarded to analysis step args", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "multi_strategy_analysis")!;
    expect(step.arguments.symbol).toBe("AAPL");
  });

  it("symbol is forwarded to recommend step args", () => {
    const plan = buildToolPlan(COMBINED_REQ);
    const step = plan.steps.find((s) => s.tool === "recommend_trade_strategy")!;
    expect(step.arguments.symbol).toBe("AAPL");
  });

  it("openai step is optional (required: false)", () => {
    expect(openAiStepIsOptional(buildToolPlan(COMBINED_REQ))).toBe(true);
  });

  it("dependency DAG is valid (no forward references)", () => {
    expect(planDepsAreValid(buildToolPlan(COMBINED_REQ))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural invariants across all intents
// ---------------------------------------------------------------------------
const ALL_REQUESTS: [string, NormalizedBrainRequest][] = [
  ["ANALYZE_SYMBOL",                    ANALYZE_SYMBOL_REQ],
  ["RECOMMEND_SYMBOL_TRADE",            RECOMMEND_REQ],
  ["RANK_MARKET_TRADES",                RANK_REQ],
  ["PLAN_PORTFOLIO_TRADE",              PORTFOLIO_REQ],
  ["COMBINED_ANALYSIS_RECOMMENDATION",  COMBINED_REQ],
  ["EXPLAIN_CONCEPT",                   EXPLAIN_REQ],
  ["EDUCATION_PLUS_ACTION",             EDU_PLUS_ACTION_REQ],
  ["MARKET_RESEARCH",                   MARKET_RESEARCH_REQ],
  ["UNKNOWN",                           UNKNOWN_REQ],
];

describe("buildToolPlan — structural invariants", () => {
  for (const [name, req] of ALL_REQUESTS) {
    it(`${name}: no duplicate tools`, () => {
      expect(planHasNoDuplicateTools(buildToolPlan(req))).toBe(true);
    });
    it(`${name}: valid dependency DAG (no forward references)`, () => {
      expect(planDepsAreValid(buildToolPlan(req))).toBe(true);
    });
    it(`${name}: openAI step always optional`, () => {
      expect(openAiStepIsOptional(buildToolPlan(req))).toBe(true);
    });
    it(`${name}: no credential args in plan`, () => {
      const creds = findCredentialArgs(buildToolPlan(req));
      expect(creds).toEqual([]);
    });
    it(`${name}: deterministic repeatability`, () => {
      const p1 = buildToolPlan(req);
      const p2 = buildToolPlan(req);
      expect(p1.steps.map((s) => s.tool)).toEqual(p2.steps.map((s) => s.tool));
      expect(p1.steps.map((s) => s.id)).toEqual(p2.steps.map((s) => s.id));
    });
  }
});

// ---------------------------------------------------------------------------
// No execution in planner
// ---------------------------------------------------------------------------
describe("buildToolPlan — no execution", () => {
  it("buildToolPlan is synchronous (returns ToolPlan, not Promise)", () => {
    const result = buildToolPlan(ANALYZE_SYMBOL_REQ);
    // If it were async it would be a Promise — check it's a plain object
    expect(typeof (result as unknown as Promise<unknown>)?.then).toBe("undefined");
    expect(result.steps).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tool allowlist — only BrainToolId values appear in plans
// ---------------------------------------------------------------------------
const ALLOWED_BRAIN_TOOLS = new Set([
  "recommend_trade_strategy",
  "rank_market_trade_candidates",
  "plan_portfolio_trade",
  "multi_strategy_analysis",
  "scan_vcp",
  "get_quote",
  "get_news",
  "get_market_history",
  "openai_explanation",
]);

describe("buildToolPlan — tool allowlist", () => {
  for (const [name, req] of ALL_REQUESTS) {
    it(`${name}: all step tools are in BrainToolId allowlist`, () => {
      const plan = buildToolPlan(req);
      for (const step of plan.steps) {
        expect(ALLOWED_BRAIN_TOOLS.has(step.tool), `unexpected tool: ${step.tool}`).toBe(true);
      }
    });
  }
});
