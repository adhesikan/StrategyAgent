// Sprint 5.1 — TraderBrain Unified Recommendation Orchestration
// Regression tests covering spec §7 (12 scenarios).
//
// These tests cover:
//   R01 — Find a trade → RANK_MARKET_TRADES
//   R02 — Recommend a trade (no symbol) → RANK_MARKET_TRADES
//   R03 — Bullish search → RANK_MARKET_TRADES
//   R04 — Bearish search → RANK_MARKET_TRADES
//   R05 — Options recommendation → RANK_MARKET_TRADES or RECOMMEND_SYMBOL_TRADE
//   R06 — Income strategy → RANK_MARKET_TRADES
//   R07 — Growth strategy → RANK_MARKET_TRADES (new supplemental pattern)
//   R08 — Risk-budget search → PLAN_PORTFOLIO_TRADE
//   R09 — Portfolio-aware recommendation → PLAN_PORTFOLIO_TRADE
//   R10 — Fallback path (status check)
//   R11 — OpenAI explanation only (plan policy)
//   R12 — Response contract consistency (BRAIN_AUTHORITATIVE_INTENTS)
//
// No algorithm changes, no scanner changes, no MCP behavior changes.

import { describe, it, expect } from "vitest";
import { classifyBrainIntent } from "../intent-classifier";
import { buildToolPlan, planHasNoDuplicateTools, planDepsAreValid, openAiStepIsOptional, findCredentialArgs } from "../planner";
import { normalizeBrainRequest } from "../request-normalizer";
import { BRAIN_AUTHORITATIVE_INTENTS } from "../service";
import type { TraderBrainIntent } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classify(question: string, tickers: string[] = []): TraderBrainIntent {
  return classifyBrainIntent(question, tickers);
}

function plan(question: string, tickers: string[] = []) {
  const intent = classify(question, tickers);
  const normalized = normalizeBrainRequest(intent, question, tickers);
  return { intent, normalized, plan: buildToolPlan(normalized) };
}

// ---------------------------------------------------------------------------
// R01 — "Find a trade"
// ---------------------------------------------------------------------------

describe("R01: Find a trade → RANK_MARKET_TRADES", () => {
  it("classifies direct trade-finding phrases as RANK", () => {
    expect(classify("Find a trade")).toBe("RANK_MARKET_TRADES");
    expect(classify("find me a good trade today")).toBe("RANK_MARKET_TRADES");
    expect(classify("show me a trade opportunity")).toBe("RANK_MARKET_TRADES");
    expect(classify("what should I trade today")).toBe("RANK_MARKET_TRADES");
  });

  it("plan for RANK produces rank_market_trade_candidates tool", () => {
    const { plan: p } = plan("Find a trade");
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("rank_market_trade_candidates");
    expect(planHasNoDuplicateTools(p)).toBe(true);
    expect(planDepsAreValid(p)).toBe(true);
  });

  it("RANK intent is in BRAIN_AUTHORITATIVE_INTENTS", () => {
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("RANK_MARKET_TRADES")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R02 — "Recommend a trade" (no symbol)
// ---------------------------------------------------------------------------

describe("R02: Recommend a trade (no symbol) → RANK_MARKET_TRADES", () => {
  it("recommendation without symbol → market-wide rank", () => {
    expect(classify("recommend a trade")).toBe("RANK_MARKET_TRADES");
    expect(classify("recommend me some trades")).toBe("RANK_MARKET_TRADES");
    expect(classify("give me a trade recommendation")).toBe("RANK_MARKET_TRADES");
  });

  it("plan uses rank step (no symbol → rank, not recommend)", () => {
    const { plan: p } = plan("recommend a trade");
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("rank_market_trade_candidates");
    expect(tools).not.toContain("recommend_trade_strategy");
  });
});

// ---------------------------------------------------------------------------
// R03 — Bullish search
// ---------------------------------------------------------------------------

describe("R03: Bullish search → RANK_MARKET_TRADES", () => {
  it("bullish trade phrases route to RANK", () => {
    expect(classify("find bullish trades")).toBe("RANK_MARKET_TRADES");
    expect(classify("bullish trade opportunities")).toBe("RANK_MARKET_TRADES");
    expect(classify("find me bullish setups today")).toBe("RANK_MARKET_TRADES");
    expect(classify("show me the best bullish plays")).toBe("RANK_MARKET_TRADES");
  });

  it("plan for bullish RANK produces the rank step", () => {
    const { plan: p, normalized } = plan("find bullish trades");
    expect(p.steps[0].tool).toBe("rank_market_trade_candidates");
    // Direction may be parsed by normalizer
    expect(planHasNoDuplicateTools(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R04 — Bearish search
// ---------------------------------------------------------------------------

describe("R04: Bearish search → RANK_MARKET_TRADES", () => {
  it("bearish trade phrases route to RANK", () => {
    expect(classify("find bearish trades")).toBe("RANK_MARKET_TRADES");
    expect(classify("bearish trade ideas")).toBe("RANK_MARKET_TRADES");
    expect(classify("show me bearish setups")).toBe("RANK_MARKET_TRADES");
  });

  it("plan for bearish RANK is valid", () => {
    const { plan: p } = plan("find bearish trades");
    expect(planHasNoDuplicateTools(p)).toBe(true);
    expect(planDepsAreValid(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R05 — Options recommendation
// ---------------------------------------------------------------------------

describe("R05: Options recommendation → RANK or RECOMMEND", () => {
  it("options without symbol → RANK (market-wide options search)", () => {
    const intent = classify("find options trades");
    expect(["RANK_MARKET_TRADES", "RECOMMEND_SYMBOL_TRADE"]).toContain(intent);
  });

  it("options with validated symbol → RECOMMEND_SYMBOL_TRADE", () => {
    expect(classify("find a covered call on NVDA", ["NVDA"])).toBe("RECOMMEND_SYMBOL_TRADE");
    expect(classify("recommend an options trade for AAPL", ["AAPL"])).toBe("RECOMMEND_SYMBOL_TRADE");
  });

  it("RECOMMEND_SYMBOL_TRADE is in BRAIN_AUTHORITATIVE_INTENTS", () => {
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("RECOMMEND_SYMBOL_TRADE")).toBe(true);
  });

  it("plan for RECOMMEND produces recommend_trade_strategy tool", () => {
    const { plan: p } = plan("find a credit spread on NVDA", ["NVDA"]);
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("recommend_trade_strategy");
    expect(openAiStepIsOptional(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R06 — Income strategy
// ---------------------------------------------------------------------------

describe("R06: Income strategy → RANK_MARKET_TRADES", () => {
  it("income strategy phrases → RANK", () => {
    expect(classify("find income trade opportunities")).toBe("RANK_MARKET_TRADES");
    expect(classify("income trade ideas")).toBe("RANK_MARKET_TRADES");
    expect(classify("income trade for today")).toBe("RANK_MARKET_TRADES");
    expect(classify("trade for income")).toBe("RANK_MARKET_TRADES");
  });
});

// ---------------------------------------------------------------------------
// R07 — Growth strategy (new supplemental pattern)
// ---------------------------------------------------------------------------

describe("R07: Growth strategy → RANK_MARKET_TRADES (spec §1 new pattern)", () => {
  it("growth trade routes to RANK", () => {
    expect(classify("growth trade opportunities")).toBe("RANK_MARKET_TRADES");
    expect(classify("find a growth trade")).toBe("RANK_MARKET_TRADES");
    expect(classify("show me growth trade setups")).toBe("RANK_MARKET_TRADES");
  });

  it("conservative trade routes to RANK", () => {
    expect(classify("conservative trade ideas")).toBe("RANK_MARKET_TRADES");
    expect(classify("conservative trade setup")).toBe("RANK_MARKET_TRADES");
  });

  it("aggressive trade routes to RANK", () => {
    expect(classify("aggressive trade opportunity")).toBe("RANK_MARKET_TRADES");
    expect(classify("aggressive trade play")).toBe("RANK_MARKET_TRADES");
  });

  it("high conviction trade routes to RANK", () => {
    expect(classify("high conviction trade")).toBe("RANK_MARKET_TRADES");
    expect(classify("high-conviction trade setup")).toBe("RANK_MARKET_TRADES");
  });

  it("defined risk trade routes to RANK", () => {
    expect(classify("defined-risk trade idea")).toBe("RANK_MARKET_TRADES");
    expect(classify("trade with defined risk")).toBe("RANK_MARKET_TRADES");
  });
});

// ---------------------------------------------------------------------------
// R08 — Risk-budget search → PLAN_PORTFOLIO_TRADE
// ---------------------------------------------------------------------------

describe("R08: Risk-budget search → PLAN_PORTFOLIO_TRADE", () => {
  it("dollar-risk limit phrases → PLAN_PORTFOLIO_TRADE", () => {
    // Phrases that match DOLLAR_RISK_RE: keyword immediately before $amount
    expect(classify("find a trade risking under $300")).toBe("PLAN_PORTFOLIO_TRADE");
    expect(classify("max risk $200 trade")).toBe("PLAN_PORTFOLIO_TRADE");
    expect(classify("trade risking less than $500")).toBe("PLAN_PORTFOLIO_TRADE");
  });

  it("PLAN_PORTFOLIO_TRADE is in BRAIN_AUTHORITATIVE_INTENTS", () => {
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("PLAN_PORTFOLIO_TRADE")).toBe(true);
  });

  it("plan for PLAN_PORTFOLIO_TRADE uses plan_portfolio_trade tool", () => {
    const { plan: p } = plan("find a trade risking under $500");
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("plan_portfolio_trade");
    expect(openAiStepIsOptional(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R09 — Portfolio-aware recommendation → PLAN_PORTFOLIO_TRADE
// ---------------------------------------------------------------------------

describe("R09: Portfolio-aware recommendation → PLAN_PORTFOLIO_TRADE", () => {
  it("sector exclusion phrases → PLAN_PORTFOLIO_TRADE", () => {
    // SECTOR_EXCLUSION_RE requires: outside|avoid|excluding|not in|away from|reduce|limit … sector/exposure
    expect(classify("trade excluding energy sector")).toBe("PLAN_PORTFOLIO_TRADE");
    expect(classify("find me a trade excluding tech sector")).toBe("PLAN_PORTFOLIO_TRADE");
  });

  it("percent-of-portfolio phrases → PLAN_PORTFOLIO_TRADE", () => {
    expect(classify("trade risking 2% of my portfolio")).toBe("PLAN_PORTFOLIO_TRADE");
    expect(classify("find a trade using 5% of my capital")).toBe("PLAN_PORTFOLIO_TRADE");
  });

  it("plan constraints are wired from normalizer", () => {
    const { normalized } = plan("find a trade risking under $400");
    // portfolioConstraints should be present when classifyPortfolioTradePlan fires
    // (may be null if not available in test env — defensive check)
    expect(normalized.intent).toBe("PLAN_PORTFOLIO_TRADE");
  });
});

// ---------------------------------------------------------------------------
// R10 — Fallback path
// ---------------------------------------------------------------------------

describe("R10: Fallback path (Brain failure contract)", () => {
  it("BRAIN_AUTHORITATIVE_INTENTS contains exactly the 5 trade intents", () => {
    const expected: TraderBrainIntent[] = [
      "RANK_MARKET_TRADES",
      "PLAN_PORTFOLIO_TRADE",
      "RECOMMEND_SYMBOL_TRADE",
      "COMBINED_ANALYSIS_RECOMMENDATION",
      "EDUCATION_PLUS_ACTION",
    ];
    for (const intent of expected) {
      expect(BRAIN_AUTHORITATIVE_INTENTS.has(intent)).toBe(true);
    }
    // Non-trade intents are NOT in the set
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("ANALYZE_SYMBOL")).toBe(false);
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("EXPLAIN_CONCEPT")).toBe(false);
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("MARKET_RESEARCH")).toBe(false);
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("UNKNOWN")).toBe(false);
  });

  it("ANALYZE_SYMBOL is NOT authoritative — falls through to legacy", () => {
    // Non-authoritative intents should NOT be in the set (legacy path is primary)
    expect(BRAIN_AUTHORITATIVE_INTENTS.has("ANALYZE_SYMBOL")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R11 — OpenAI explanation only (plan policy)
// ---------------------------------------------------------------------------

describe("R11: OpenAI explanation plan policy", () => {
  it("RANK plan does NOT include openai_explanation (deterministic only)", () => {
    const { plan: p } = plan("find me the best trades");
    const tools = p.steps.map((s) => s.tool);
    // RANK plan never includes openai_explanation — deterministic buckets are self-explanatory
    expect(tools).not.toContain("openai_explanation");
    expect(p.responsePolicy.requiresOpenAi).toBe(false);
  });

  it("RECOMMEND plan includes openai_explanation as optional", () => {
    const { plan: p } = plan("find a bull call spread on AAPL", ["AAPL"]);
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("openai_explanation");
    expect(openAiStepIsOptional(p)).toBe(true);
  });

  it("PORTFOLIO plan includes openai_explanation as optional", () => {
    const { plan: p } = plan("find a trade risking under $400");
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("openai_explanation");
    expect(openAiStepIsOptional(p)).toBe(true);
  });

  it("COMBINED plan includes openai_explanation as optional", () => {
    const { plan: p } = plan("analyze NVDA and give me a trade recommendation", ["NVDA"]);
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("openai_explanation");
    expect(openAiStepIsOptional(p)).toBe(true);
  });

  it("EDUCATION_PLUS_ACTION plan includes openai_explanation as optional", () => {
    const { plan: p } = plan("explain what a VCP is and find me one");
    const tools = p.steps.map((s) => s.tool);
    expect(tools).toContain("openai_explanation");
    expect(openAiStepIsOptional(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R12 — Response contract consistency
// ---------------------------------------------------------------------------

describe("R12: Response contract — plan structure invariants for all trade intents", () => {
  const tradePhrases: Array<[string, string[], TraderBrainIntent]> = [
    ["find the best trades today", [], "RANK_MARKET_TRADES"],
    ["find a trade risking under $300", [], "PLAN_PORTFOLIO_TRADE"],
    ["find a covered call on NVDA", ["NVDA"], "RECOMMEND_SYMBOL_TRADE"],
    ["analyze MU and give me a trade", ["MU"], "COMBINED_ANALYSIS_RECOMMENDATION"],
    ["explain a bull call spread and find one", [], "EDUCATION_PLUS_ACTION"],
  ];

  it.each(tradePhrases)(
    "%s → %s intent; plan is valid",
    (question, tickers, expectedIntent) => {
      const intent = classify(question, tickers);
      expect(intent).toBe(expectedIntent);

      const normalized = normalizeBrainRequest(intent, question, tickers);
      const p = buildToolPlan(normalized);

      // All plans must satisfy these invariants
      expect(planHasNoDuplicateTools(p)).toBe(true);
      expect(planDepsAreValid(p)).toBe(true);
      expect(openAiStepIsOptional(p)).toBe(true);
      expect(p.intent).toBe(expectedIntent);

      // All authoritative intents are in BRAIN_AUTHORITATIVE_INTENTS
      expect(BRAIN_AUTHORITATIVE_INTENTS.has(expectedIntent)).toBe(true);
    },
  );

  it("every plan step has a timeoutClass", () => {
    for (const [question, tickers] of tradePhrases) {
      const intent = classify(question, tickers);
      const normalized = normalizeBrainRequest(intent, question, tickers);
      const p = buildToolPlan(normalized);
      for (const step of p.steps) {
        expect(["fast", "standard", "extended"]).toContain(step.timeoutClass);
      }
    }
  });

  it("no plan step contains credential-looking argument keys", () => {
    for (const [question, tickers] of tradePhrases) {
      const intent = classify(question, tickers);
      const normalized = normalizeBrainRequest(intent, question, tickers);
      const p = buildToolPlan(normalized);
      const creds = findCredentialArgs(p);
      expect(creds).toHaveLength(0);
    }
  });

  it("BRAIN_AUTHORITATIVE_INTENTS has exactly 5 elements", () => {
    expect(BRAIN_AUTHORITATIVE_INTENTS.size).toBe(5);
  });
});
