// Tests for the deterministic trade-strategy recommendation flow:
// intent classification, trade-goal normalization, MCP argument mapping,
// defensive payload validation, verdict-driven headlines/confidence, and
// CTA gating. Spec: routing must never turn analysis or education asks into
// recommendations, and a failed engine must never yield an invented trade.

import { describe, it, expect } from "vitest";
import {
  classifyTradeRequest,
  normalizeTradeGoal,
  tradeGoalToMcpArgs,
  validateRecommendationPayload,
  runStrategyRecommendation,
  recommendationHeadline,
  recommendationConfidence,
  suggestionsForRecommendation,
  tradeBuilderEligible,
  buildRecommendationFallbackAnswer,
  buildRecommendationUnavailableAnswer,
  recommendationKeyPoints,
  recommendationRiskNote,
  answerContradictsRecommendation,
  type StrategyRecommendation,
  type RecommendationIdea,
} from "./strategy-recommendation";

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

describe("classifyTradeRequest — trade-seeking asks route, others don't", () => {
  it("symbol-specific trade ask → recommendation", () => {
    const r = classifyTradeRequest("Find a trade for NVDA", ["NVDA"]);
    expect(r?.kind).toBe("recommendation");
    expect(r?.goal.symbol).toBe("NVDA");
  });

  it("'recommend a trade' and 'what should I trade today' route", () => {
    expect(classifyTradeRequest("Recommend a trade for MU", ["MU"])?.kind).toBe("recommendation");
    expect(classifyTradeRequest("What should I trade today?", [])?.kind).toBe("recommendation");
  });

  it("explicit strategy ask without a ticker routes market-wide", () => {
    const r = classifyTradeRequest("Find a credit spread", []);
    expect(r?.kind).toBe("recommendation");
    expect(r?.goal.symbol).toBeUndefined();
    expect(r?.goal.requestedStrategy).toBe("credit_spread");
  });

  it("plain analysis ask does NOT route", () => {
    expect(classifyTradeRequest("Analyze NVDA", ["NVDA"])).toBeNull();
    expect(classifyTradeRequest("How does MU look?", ["MU"])).toBeNull();
  });

  it("pure education does NOT route", () => {
    expect(classifyTradeRequest("What is a credit spread?", [])).toBeNull();
    expect(classifyTradeRequest("Explain how covered calls work", [])).toBeNull();
  });

  it("education + find → education_plus_search", () => {
    const r = classifyTradeRequest("Explain credit spreads and find one for me", []);
    expect(r?.kind).toBe("education_plus_search");
    expect(r?.goal.requestedStrategy).toBe("credit_spread");
  });

  it("analysis + recommendation → combined", () => {
    const r = classifyTradeRequest("Analyze NVDA and recommend a trade", ["NVDA"]);
    expect(r?.kind).toBe("combined");
    expect(r?.goal.symbol).toBe("NVDA");
  });

  it("news / portfolio / generic asks never route", () => {
    expect(classifyTradeRequest("Any news on TSLA?", ["TSLA"])).toBeNull();
    expect(classifyTradeRequest("How is my portfolio doing?", [])).toBeNull();
    expect(classifyTradeRequest("", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Goal normalization
// ---------------------------------------------------------------------------

describe("normalizeTradeGoal — centralized alias parsing", () => {
  it("parses strategy aliases", () => {
    expect(normalizeTradeGoal("find a covered call").requestedStrategy).toBe("covered_call");
    expect(normalizeTradeGoal("find a cash-secured put").requestedStrategy).toBe("cash_secured_put");
    expect(normalizeTradeGoal("find a bull put spread").requestedStrategy).toBe("bull_put_credit_spread");
    expect(normalizeTradeGoal("find a call credit spread").requestedStrategy).toBe("bear_call_credit_spread");
    expect(normalizeTradeGoal("find a call debit spread").requestedStrategy).toBe("call_debit_spread");
    expect(normalizeTradeGoal("find a long call").requestedStrategy).toBe("long_call");
  });

  it("derives direction and instrument from the strategy", () => {
    const g = normalizeTradeGoal("find a long put on SPY", ["SPY"]);
    expect(g.direction).toBe("bearish");
    expect(g.instrumentPreference).toBe("options");
    expect(normalizeTradeGoal("find a bullish stock trade").direction).toBe("bullish");
    expect(normalizeTradeGoal("find a bullish stock trade").instrumentPreference).toBe("stock");
  });

  it("parses risk budget, DTE, account size, idea count", () => {
    const g = normalizeTradeGoal("find 2 bullish trades under $500 max loss with 30 DTE, account of $25,000");
    expect(g.maxRiskDollars).toBe(500);
    expect(g.targetDTE).toBe(30);
    expect(g.accountSize).toBe(25000);
    expect(g.numberOfIdeas).toBe(2);
    expect(normalizeTradeGoal("find three trades").numberOfIdeas).toBe(3);
    expect(normalizeTradeGoal("risking 2% on a trade").maxRiskPercent).toBe(2);
  });

  it("income objective inferred for premium-selling asks", () => {
    expect(normalizeTradeGoal("find an income trade").objective).toBe("income");
    expect(normalizeTradeGoal("find a covered call").objective).toBe("income");
  });
});

// ---------------------------------------------------------------------------
// MCP argument mapping (model-safe only)
// ---------------------------------------------------------------------------

describe("tradeGoalToMcpArgs", () => {
  it("resolves generic credit_spread by direction", () => {
    expect(tradeGoalToMcpArgs({ requestedStrategy: "credit_spread", direction: "bearish" }).requestedStrategy).toBe("bear_call_credit_spread");
    expect(tradeGoalToMcpArgs({ requestedStrategy: "credit_spread" }).requestedStrategy).toBe("bull_put_credit_spread");
  });

  it("never leaks non-model-safe fields; attaches token only when provided", () => {
    const args = tradeGoalToMcpArgs({ symbol: "NVDA", maxRiskDollars: 500 });
    expect(Object.keys(args).sort()).toEqual(["maxRiskDollars", "symbol"]);
    expect(tradeGoalToMcpArgs({}, "tok").optionsContextToken).toBe("tok");
  });
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const goodIdea = {
  overallVerdict: "STOCK",
  recommendedStrategy: "stock",
  strategySummary: "Breakout setup",
  tradeCandidate: { symbol: "NVDA", entry: 100, stop: 95 },
  reasons: ["Strong trend"],
  warnings: [],
  confidence: 72,
  dataQuality: { underlying: "live" },
};

describe("validateRecommendationPayload — defensive", () => {
  it("accepts a well-formed payload and preserves fields", () => {
    const v = validateRecommendationPayload({ recommendations: [goodIdea], generatedAt: "2026-08-04T00:00:00Z", warnings: ["w"] });
    expect(v.recommendations).toHaveLength(1);
    expect(v.recommendations[0].overallVerdict).toBe("STOCK");
    expect(v.recommendations[0].confidence).toBe(72);
    expect(v.warnings).toEqual(["w"]);
    expect(v.simulatedData).toBe(false);
  });

  it("unknown verdicts degrade to NO_TRADE, junk entries dropped", () => {
    const v = validateRecommendationPayload({ recommendations: [{ overallVerdict: "MOON" }, null, "x"] });
    expect(v.recommendations).toHaveLength(1);
    expect(v.recommendations[0].overallVerdict).toBe("NO_TRADE");
  });

  it("malformed root never throws", () => {
    expect(validateRecommendationPayload(null).recommendations).toEqual([]);
    expect(validateRecommendationPayload("junk").recommendations).toEqual([]);
  });

  it("detects simulated/mock data anywhere in the payload", () => {
    const v = validateRecommendationPayload({ recommendations: [{ ...goodIdea, overallVerdict: "LIVE_OPTIONS", dataQuality: { options: "mock" } }] });
    expect(v.simulatedData).toBe(true);
  });
});

describe("runStrategyRecommendation", () => {
  it("calls the injected recommend dep with mapped args and validates", async () => {
    let seen: Record<string, unknown> | null = null;
    const rec = await runStrategyRecommendation(
      { symbol: "NVDA", maxRiskDollars: 500 },
      { recommend: async (args) => { seen = args; return { recommendations: [goodIdea] }; } },
    );
    expect(seen).toEqual({ symbol: "NVDA", maxRiskDollars: 500 });
    expect(rec.recommendations[0].overallVerdict).toBe("STOCK");
  });

  it("empty recommendations → MALFORMED_RECOMMENDATION error (never invented)", async () => {
    await expect(
      runStrategyRecommendation({}, { recommend: async () => ({ recommendations: [] }) }),
    ).rejects.toMatchObject({ code: "MALFORMED_RECOMMENDATION" });
  });

  it("times out slow engines", async () => {
    await expect(
      runStrategyRecommendation({}, { recommend: () => new Promise(() => {}), timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

// ---------------------------------------------------------------------------
// Presentation: headline / confidence / CTA gating
// ---------------------------------------------------------------------------

function recWith(verdict: string, extra: Partial<RecommendationIdea> = {}, simulated = false): StrategyRecommendation {
  return validateRecommendationPayload({
    recommendations: [{ ...goodIdea, ...extra, overallVerdict: verdict, ...(simulated ? { dataQuality: { options: "mock" } } : {}) }],
  });
}

describe("recommendationHeadline — verdict-driven, exact stance per verdict", () => {
  it("per-verdict headlines", () => {
    expect(recommendationHeadline(recWith("STOCK"))).toMatch(/stock trade candidate/i);
    expect(recommendationHeadline(recWith("LIVE_OPTIONS"))).toMatch(/live options trade candidate/i);
    expect(recommendationHeadline(recWith("LIVE_OPTIONS", {}, true))).toMatch(/simulated/i);
    expect(recommendationHeadline(recWith("ESTIMATED_OPTIONS"))).toMatch(/estimated options/i);
    expect(recommendationHeadline(recWith("WATCH"))).toMatch(/not actionable yet/i);
    expect(recommendationHeadline(recWith("NO_TRADE"))).toMatch(/none currently qualify/i);
    expect(recommendationHeadline(recWith("UNSUPPORTED"))).toMatch(/not yet supported/i);
  });

  it("multi-idea headline counts only actionable/watchable ideas", () => {
    const multi = validateRecommendationPayload({
      recommendations: [
        { ...goodIdea, overallVerdict: "STOCK" },
        { ...goodIdea, overallVerdict: "NO_TRADE" },
        { ...goodIdea, overallVerdict: "ESTIMATED_OPTIONS" },
      ],
    });
    expect(recommendationHeadline(multi)).toBe("2 trade candidates identified.");
  });
});

describe("recommendationConfidence — deterministic, never model-chosen", () => {
  it("simulated data is always low", () => {
    expect(recommendationConfidence(recWith("LIVE_OPTIONS", { confidence: 95 }, true))).toBe("low");
  });
  it("scales with verdict + engine confidence", () => {
    expect(recommendationConfidence(recWith("STOCK", { confidence: 80 }))).toBe("high");
    expect(recommendationConfidence(recWith("STOCK", { confidence: 50 }))).toBe("medium");
    expect(recommendationConfidence(recWith("WATCH", { confidence: 80 }))).toBe("medium");
    expect(recommendationConfidence(recWith("NO_TRADE", { confidence: 90 }))).toBe("low");
    expect(recommendationConfidence(recWith("UNSUPPORTED", { confidence: 90 }))).toBe("low");
  });
});

describe("CTA gating — no trade ticket for non-actionable or simulated results", () => {
  it("tradeBuilderEligible only for concrete STOCK / LIVE_OPTIONS with real data", () => {
    const stock = recWith("STOCK").recommendations[0];
    expect(tradeBuilderEligible(stock, false)).toBe(true);
    expect(tradeBuilderEligible(stock, true)).toBe(false); // simulated
    expect(tradeBuilderEligible(recWith("ESTIMATED_OPTIONS").recommendations[0], false)).toBe(false);
    expect(tradeBuilderEligible(recWith("WATCH").recommendations[0], false)).toBe(false);
    expect(tradeBuilderEligible(recWith("NO_TRADE").recommendations[0], false)).toBe(false);
    expect(tradeBuilderEligible(recWith("UNSUPPORTED").recommendations[0], false)).toBe(false);
  });

  it("suggestions never include a setup/trade link for NO_TRADE or UNSUPPORTED", () => {
    for (const verdict of ["NO_TRADE", "UNSUPPORTED", "WATCH"]) {
      const labels = suggestionsForRecommendation(recWith(verdict)).map((s) => s.label);
      expect(labels.join("|")).not.toContain("View Setup");
    }
    const actionable = suggestionsForRecommendation(recWith("STOCK")).map((s) => s.label);
    expect(actionable).toContain("View Setup");
  });

  it("ESTIMATED_OPTIONS suggests connecting a broker", () => {
    const labels = suggestionsForRecommendation(recWith("ESTIMATED_OPTIONS")).map((s) => s.label);
    expect(labels).toContain("Connect Broker");
  });
});

// ---------------------------------------------------------------------------
// Deterministic response shell — the NVDA contradiction regression
// (NO_TRADE card + bullish "best stock and option trades" prose must never
// coexist; keyPoints/riskNote come from the MCP payload, not the model)
// ---------------------------------------------------------------------------

describe("recommendationKeyPoints — derived only from MCP reasons/warnings", () => {
  it("uses idea reasons and warnings, deduped, capped at 5", () => {
    const rec = validateRecommendationPayload({
      recommendations: [{ ...goodIdea, overallVerdict: "NO_TRADE", reasons: ["No qualifying setup found for NVDA", "No qualifying setup found for NVDA"], warnings: ["Low data quality"] }],
      warnings: ["Engine-level warning"],
    });
    const pts = recommendationKeyPoints(rec);
    expect(pts).toEqual(["No qualifying setup found for NVDA", "Low data quality", "Engine-level warning"]);
    expect(pts.length).toBeLessThanOrEqual(5);
  });
});

describe("recommendationRiskNote — verdict-driven, never model prose", () => {
  it("NO_TRADE says no trade is recommended", () => {
    expect(recommendationRiskNote(recWith("NO_TRADE"))).toMatch(/no trade is recommended/i);
  });
  it("WATCH says not actionable yet", () => {
    expect(recommendationRiskNote(recWith("WATCH"))).toMatch(/not actionable yet/i);
  });
  it("UNSUPPORTED mentions unsupported strategy", () => {
    expect(recommendationRiskNote(recWith("UNSUPPORTED"))).toMatch(/isn't supported/i);
  });
  it("ESTIMATED_OPTIONS flags estimated structure, no live chain", () => {
    expect(recommendationRiskNote(recWith("ESTIMATED_OPTIONS"))).toMatch(/no live options chain/i);
  });
  it("simulated data is called out", () => {
    expect(recommendationRiskNote(recWith("LIVE_OPTIONS", {}, true))).toMatch(/simulated development data/i);
  });
});

describe("answerContradictsRecommendation — contradictory prose is detected", () => {
  const bullishProse =
    "NVDA looks bullish — here are the best stock and option trades. Best option trade: Defined-risk debit spread (66% confidence, max loss $330, expires 2026-09-18).";

  it("the exact production NVDA contradiction is flagged against NO_TRADE", () => {
    expect(answerContradictsRecommendation(bullishProse, recWith("NO_TRADE"))).toBe(true);
  });
  it("flagged against WATCH and UNSUPPORTED too", () => {
    expect(answerContradictsRecommendation(bullishProse, recWith("WATCH"))).toBe(true);
    expect(answerContradictsRecommendation(bullishProse, recWith("UNSUPPORTED"))).toBe(true);
  });
  it("actionable verdicts may legitimately carry trade language", () => {
    expect(answerContradictsRecommendation(bullishProse, recWith("LIVE_OPTIONS"))).toBe(false);
    expect(answerContradictsRecommendation(bullishProse, recWith("STOCK"))).toBe(false);
  });
  it("plain educational prose about a strategy is NOT flagged", () => {
    const education =
      "A credit spread is an options strategy where you sell one option and buy another to define your risk. The engine did not find a qualifying setup.";
    expect(answerContradictsRecommendation(education, recWith("UNSUPPORTED"))).toBe(false);
    expect(answerContradictsRecommendation("", recWith("NO_TRADE"))).toBe(false);
  });
});

describe("fallback answers — honest, never invented", () => {
  it("MCP-success/OpenAI-failure fallback preserves the deterministic result", () => {
    const fb = buildRecommendationFallbackAnswer(recWith("STOCK"));
    expect(fb.headline).toMatch(/stock trade candidate/i);
    expect(fb.answer).toContain("NVDA");
    expect(fb.riskNote).toMatch(/not investment advice/i);
  });

  it("engine-unavailable answer admits failure and fabricates nothing", () => {
    const u = buildRecommendationUnavailableAnswer();
    expect(u.headline).toMatch(/temporarily unavailable/i);
    expect(u.answer).toMatch(/no trade recommendation was generated/i);
    expect(u.answer).not.toMatch(/\$\d/);
  });
});
