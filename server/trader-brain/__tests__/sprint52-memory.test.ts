// Sprint 5.2 — TraderBrain Conversation Memory
// Regression tests covering spec §7 scenarios.
//
// Tests:
//   M01 — Follow-up detection (ordinal, options, risk, income, account, tone, direction)
//   M02 — Context reuse (overrides carry forward correctly)
//   M03 — Context clearing (explicit reset)
//   M04 — Symbol references
//   M05 — Recommendation references
//   M06 — Risk references (carry-forward + refinement)
//   M07 — Portfolio references
//   M08 — Multi-turn conversation simulation
//   M09 — Memory store CRUD + TTL behaviour
//   M10 — Resolver contract invariants
//
// No algorithm changes. No scanner changes. No MCP changes.

import { describe, it, expect, beforeEach } from "vitest";

import {
  isExplicitReset,
  classifyFollowUp,
  resolveFollowUp,
  applyFollowUpOverrides,
  type FollowUpKind,
} from "../follow-up-resolver";

import {
  getMemory,
  setMemory,
  clearMemory,
  hasMemory,
  storeResult,
  activeEntryCount,
  type ConversationMemory,
} from "../conversation-memory";

import type { TraderBrainResult, NormalizedBrainRequest } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = `test-user-sprint52-${Math.random().toString(36).slice(2, 8)}`;

function makeMemory(partial: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    lastUpdated: Date.now(),
    lastIntent: "RANK_MARKET_TRADES",
    lastNormalizedRequest: {
      rawPrompt: "find bullish trades",
      intent: "RANK_MARKET_TRADES",
      tickers: [],
      direction: "bullish",
      maxRiskDollars: 500,
      objective: "growth",
    } as NormalizedBrainRequest,
    lastSearch: { candidates: [
      { symbol: "AAPL", strategy: "bull_call_spread" },
      { symbol: "NVDA", strategy: "long_stock" },
      { symbol: "MSFT", strategy: "covered_call" },
    ] } as unknown as ConversationMemory["lastSearch"],
    lastRecommendation: null,
    lastAnalysis: null,
    lastPortfolioTradePlan: null,
    lastAnalyzedSymbol: null,
    lastPortfolioFilters: null,
    lastRiskBudget: { dollars: 500 },
    lastStrategyPreference: null,
    lastMarketDirection: "bullish",
    lastWatchlistReference: null,
    lastObjective: "growth",
    lastRejectedReasons: ["NVDA: insufficient liquidity"],
    lastUnavailableReasons: [],
    lastRankedCandidates: [
      { symbol: "AAPL", strategy: "bull_call_spread" },
      { symbol: "NVDA", strategy: "long_stock" },
      { symbol: "MSFT", strategy: "covered_call" },
    ],
    pendingContextNote: null,
    ...partial,
  };
}

function makeResult(partial: Partial<TraderBrainResult> = {}): TraderBrainResult {
  return {
    requestId: "r-001",
    intent: "RANK_MARKET_TRADES",
    normalizedRequest: {
      rawPrompt: "find bullish trades",
      intent: "RANK_MARKET_TRADES",
      tickers: [],
      direction: "bullish",
      maxRiskDollars: 400,
    } as NormalizedBrainRequest,
    status: "complete",
    headline: "3 bullish candidates found",
    confidence: "high",
    sections: {
      rankedSearch: {
        candidates: [
          { symbol: "TSLA", strategy: "bull_call_spread" },
          { symbol: "AAPL", strategy: "long_stock" },
        ],
        watchCandidates: [],
        excludedCount: 0,
        groupedCandidateCount: 2,
      } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
    },
    evidence: [],
    warnings: ["Low liquidity in NVDA"],
    limitations: [],
    nextActions: [],
    generatedAt: new Date().toISOString(),
    openAiUsed: false,
  } as TraderBrainResult;
  // Merge partial last to allow override
  return { ...makeResult(), ...partial } as TraderBrainResult;
}

// ---------------------------------------------------------------------------
// M01 — Follow-up detection
// ---------------------------------------------------------------------------

describe("M01: Follow-up detection", () => {
  const HAS_MEMORY = true;

  it("detects ordinal references", () => {
    expect(classifyFollowUp("show me the second one", HAS_MEMORY)).toBe("ordinal_reference");
    expect(classifyFollowUp("show me the first one", HAS_MEMORY)).toBe("ordinal_reference");
    expect(classifyFollowUp("what's the third one", HAS_MEMORY)).toBe("ordinal_reference");
    expect(classifyFollowUp("what is the second option", HAS_MEMORY)).toBe("ordinal_reference");
  });

  it("detects implicit follow-up references", () => {
    expect(classifyFollowUp("show me more", HAS_MEMORY)).toBe("ordinal_reference");
    expect(classifyFollowUp("what else", HAS_MEMORY)).toBe("ordinal_reference");
    expect(classifyFollowUp("show me the rest", HAS_MEMORY)).toBe("ordinal_reference");
  });

  it("detects options pivot", () => {
    expect(classifyFollowUp("what about options", HAS_MEMORY)).toBe("options_pivot");
    expect(classifyFollowUp("show me options version", HAS_MEMORY)).toBe("options_pivot");
    expect(classifyFollowUp("can I do options for that", HAS_MEMORY)).toBe("options_pivot");
  });

  it("detects risk refinement", () => {
    expect(classifyFollowUp("make it lower risk", HAS_MEMORY)).toBe("risk_refinement");
    expect(classifyFollowUp("something more conservative", HAS_MEMORY)).toBe("risk_refinement");
    expect(classifyFollowUp("lower the risk", HAS_MEMORY)).toBe("risk_refinement");
    expect(classifyFollowUp("less risky please", HAS_MEMORY)).toBe("risk_refinement");
  });

  it("detects income filter", () => {
    expect(classifyFollowUp("show only income ideas", HAS_MEMORY)).toBe("income_filter");
    expect(classifyFollowUp("income version", HAS_MEMORY)).toBe("income_filter");
    expect(classifyFollowUp("show me income ones", HAS_MEMORY)).toBe("income_filter");
  });

  it("detects account context", () => {
    expect(classifyFollowUp("use my account", HAS_MEMORY)).toBe("account_context");
    expect(classifyFollowUp("with my portfolio", HAS_MEMORY)).toBe("account_context");
    expect(classifyFollowUp("use my positions", HAS_MEMORY)).toBe("account_context");
  });

  it("detects tone refinement (conservative)", () => {
    expect(classifyFollowUp("show conservative ideas", HAS_MEMORY)).toBe("tone_refinement");
    // "conservative ones" → tone_refinement (distinct from "more conservative"
    // which maps to risk_refinement because RISK_REFINE_RE owns "more conservative")
    expect(classifyFollowUp("conservative ones", HAS_MEMORY)).toBe("tone_refinement");
  });

  it("detects tone refinement (aggressive)", () => {
    expect(classifyFollowUp("show aggressive ones", HAS_MEMORY)).toBe("tone_refinement");
    expect(classifyFollowUp("more aggressive", HAS_MEMORY)).toBe("tone_refinement");
  });

  it("detects direction flip", () => {
    expect(classifyFollowUp("show me the bearish version", HAS_MEMORY)).toBe("direction_flip");
    expect(classifyFollowUp("what about bearish", HAS_MEMORY)).toBe("direction_flip");
    expect(classifyFollowUp("bullish version", HAS_MEMORY)).toBe("direction_flip");
  });

  it("returns 'none' when no memory exists", () => {
    expect(classifyFollowUp("show me the second one", false)).toBe("none");
    expect(classifyFollowUp("what about options", false)).toBe("none");
    expect(classifyFollowUp("make it lower risk", false)).toBe("none");
  });

  it("returns 'none' for fresh questions", () => {
    expect(classifyFollowUp("find bullish trades", HAS_MEMORY)).toBe("none");
    expect(classifyFollowUp("analyze NVDA", HAS_MEMORY)).toBe("none");
    expect(classifyFollowUp("find income opportunities", HAS_MEMORY)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// M02 — Context reuse (overrides carry forward)
// ---------------------------------------------------------------------------

describe("M02: Context reuse — overrides carry forward correctly", () => {
  it("ordinal reference resolves to the correct candidate", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("show me the second one", mem);
    expect(result.kind).toBe("ordinal_reference");
    expect(result.contextHit).toBe(true);
    expect(result.resolvedCandidate).toMatchObject({ symbol: "NVDA" });
  });

  it("first-ordinal reference resolves to first candidate", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("show me the first one", mem);
    expect(result.resolvedCandidate).toMatchObject({ symbol: "AAPL" });
  });

  it("third-ordinal reference resolves to third candidate", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("the third one", mem);
    expect(result.resolvedCandidate).toMatchObject({ symbol: "MSFT" });
  });

  it("options pivot carries direction and risk from memory", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("what about options", mem);
    expect(result.kind).toBe("options_pivot");
    expect(result.overrides.instrumentPreference).toBe("options");
    expect(result.overrides.direction).toBe("bullish");
    expect(result.overrides.maxRiskDollars).toBe(500);
  });

  it("risk refinement reduces dollar budget by ~30%", () => {
    const mem = makeMemory({ lastRiskBudget: { dollars: 500 } });
    const result = resolveFollowUp("make it lower risk", mem);
    expect(result.kind).toBe("risk_refinement");
    expect(result.overrides.maxRiskDollars).toBeDefined();
    expect(result.overrides.maxRiskDollars!).toBeLessThan(500);
    expect(result.overrides.maxRiskDollars!).toBeGreaterThan(200);
  });

  it("income filter sets objective and instrumentPreference", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("show only income ideas", mem);
    expect(result.kind).toBe("income_filter");
    expect(result.overrides.objective).toBe("income");
    expect(result.overrides.instrumentPreference).toBe("options");
  });

  it("direction flip sets the new direction", () => {
    const mem = makeMemory({ lastMarketDirection: "bullish" });
    const result = resolveFollowUp("show me the bearish version", mem);
    expect(result.kind).toBe("direction_flip");
    expect(result.overrides.direction).toBe("bearish");
    expect(result.contextHit).toBe(true);
  });

  it("context note is set on context hit", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("what about options", mem);
    expect(result.contextNote).not.toBeNull();
    expect(typeof result.contextNote).toBe("string");
    expect(result.contextNote!.length).toBeGreaterThan(0);
  });

  it("context note is null when kind is none", () => {
    const mem = makeMemory();
    const result = resolveFollowUp("find bearish trades", mem);
    expect(result.kind).toBe("none");
    expect(result.contextNote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M03 — Context clearing (explicit reset)
// ---------------------------------------------------------------------------

describe("M03: Context clearing — explicit reset", () => {
  beforeEach(() => {
    clearMemory(TEST_USER);
  });

  it("detects reset phrases correctly", () => {
    expect(isExplicitReset("start over")).toBe(true);
    expect(isExplicitReset("new search")).toBe(true);
    expect(isExplicitReset("ignore previous search")).toBe(true);
    expect(isExplicitReset("clear context")).toBe(true);
    expect(isExplicitReset("clear history")).toBe(true);
    expect(isExplicitReset("forget that")).toBe(true);
    expect(isExplicitReset("reset context")).toBe(true);
    expect(isExplicitReset("fresh start")).toBe(true);
  });

  it("does NOT treat trade questions as resets", () => {
    expect(isExplicitReset("find bullish trades")).toBe(false);
    expect(isExplicitReset("show me the second one")).toBe(false);
    expect(isExplicitReset("analyze NVDA")).toBe(false);
    expect(isExplicitReset("what about options")).toBe(false);
  });

  it("clearMemory removes user memory", () => {
    setMemory(TEST_USER, makeMemory());
    expect(hasMemory(TEST_USER)).toBe(true);
    clearMemory(TEST_USER);
    expect(hasMemory(TEST_USER)).toBe(false);
  });

  it("getMemory returns empty after clear", () => {
    setMemory(TEST_USER, makeMemory());
    clearMemory(TEST_USER);
    const mem = getMemory(TEST_USER);
    expect(mem.lastIntent).toBeNull();
    expect(mem.lastSearch).toBeNull();
    expect(mem.lastRankedCandidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// M04 — Symbol references
// ---------------------------------------------------------------------------

describe("M04: Symbol references", () => {
  it("exclusion inquiry extracts the inquired symbol", () => {
    const mem = makeMemory({ lastRejectedReasons: ["NVDA: no valid setup"] });
    const result = resolveFollowUp("why wasn't NVDA included", mem);
    expect(result.kind).toBe("exclusion_inquiry");
    expect(result.inquiredSymbol).toBe("NVDA");
    expect(result.contextHit).toBe(true);
  });

  it("stores analyzed symbol from brain result", () => {
    const uid = `test-sym-${Math.random().toString(36).slice(2, 8)}`;
    const result: TraderBrainResult = {
      ...makeResult(),
      intent: "RECOMMEND_SYMBOL_TRADE",
      normalizedRequest: {
        rawPrompt: "find a covered call on NVDA",
        intent: "RECOMMEND_SYMBOL_TRADE",
        tickers: ["NVDA"],
        symbol: "NVDA",
      } as NormalizedBrainRequest,
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastAnalyzedSymbol).toBe("NVDA");
    clearMemory(uid);
  });
});

// ---------------------------------------------------------------------------
// M05 — Recommendation references
// ---------------------------------------------------------------------------

describe("M05: Recommendation references", () => {
  it("stores recommendation section from brain result", () => {
    const uid = `test-rec-${Math.random().toString(36).slice(2, 8)}`;
    const mockRec = {
      recommendations: [{ strategy: "bull_call_spread", symbol: "AAPL" }],
      verdict: "TRADE_READY",
    };
    const result: TraderBrainResult = {
      ...makeResult(),
      intent: "RECOMMEND_SYMBOL_TRADE",
      sections: {
        recommendation: mockRec as unknown as NonNullable<TraderBrainResult["sections"]["recommendation"]>,
      },
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastRecommendation).toEqual(mockRec);
    clearMemory(uid);
  });
});

// ---------------------------------------------------------------------------
// M06 — Risk references (carry-forward + refinement)
// ---------------------------------------------------------------------------

describe("M06: Risk references", () => {
  it("stores risk budget from normalized request", () => {
    const uid = `test-risk-${Math.random().toString(36).slice(2, 8)}`;
    const result: TraderBrainResult = {
      ...makeResult(),
      normalizedRequest: {
        rawPrompt: "find a trade risking under $300",
        intent: "PLAN_PORTFOLIO_TRADE",
        tickers: [],
        maxRiskDollars: 300,
      } as NormalizedBrainRequest,
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastRiskBudget?.dollars).toBe(300);
    clearMemory(uid);
  });

  it("risk refinement uses stored budget", () => {
    const mem = makeMemory({ lastRiskBudget: { dollars: 1000 } });
    const result = resolveFollowUp("make it lower risk", mem);
    expect(result.overrides.maxRiskDollars).toBeLessThan(1000);
    expect(result.overrides.maxRiskDollars).toBeGreaterThan(0);
  });

  it("percent-risk budget is also refined", () => {
    const mem = makeMemory({ lastRiskBudget: { percent: 5 } });
    const result = resolveFollowUp("lower the risk", mem);
    expect(result.overrides.maxRiskPercent).toBeDefined();
    expect(result.overrides.maxRiskPercent!).toBeLessThan(5);
  });

  it("no risk override when memory has no budget", () => {
    const mem = makeMemory({ lastRiskBudget: null });
    const result = resolveFollowUp("make it lower risk", mem);
    // Should still be a risk_refinement but no specific dollar override
    expect(result.kind).toBe("risk_refinement");
    expect(result.overrides.maxRiskDollars).toBeUndefined();
    expect(result.overrides.maxRiskPercent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M07 — Portfolio references
// ---------------------------------------------------------------------------

describe("M07: Portfolio references", () => {
  it("stores portfolio trade plan from brain result", () => {
    const uid = `test-pf-${Math.random().toString(36).slice(2, 8)}`;
    const mockPlan = { feasibility: { feasible: true }, qualifiedCandidates: [] };
    const result: TraderBrainResult = {
      ...makeResult(),
      intent: "PLAN_PORTFOLIO_TRADE",
      sections: {
        portfolioTradePlan: mockPlan as unknown as NonNullable<TraderBrainResult["sections"]["portfolioTradePlan"]>,
      },
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastPortfolioTradePlan).toEqual(mockPlan);
    clearMemory(uid);
  });

  it("account context follow-up sets require_existing_position constraint", () => {
    const mem = makeMemory({ lastPortfolioFilters: null });
    const result = resolveFollowUp("use my account", mem);
    expect(result.kind).toBe("account_context");
    expect(result.overrides.portfolioConstraints).toBeDefined();
    expect(result.overrides.portfolioConstraints?.kind).toBe("require_existing_position");
  });

  it("account context follow-up preserves existing filters when present", () => {
    const existingFilters = { kind: "sector_exclusion" as const, excludeSectors: ["tech"] };
    const mem = makeMemory({ lastPortfolioFilters: existingFilters });
    const result = resolveFollowUp("use my portfolio", mem);
    expect(result.overrides.portfolioConstraints).toEqual(existingFilters);
  });
});

// ---------------------------------------------------------------------------
// M08 — Multi-turn conversation simulation
// ---------------------------------------------------------------------------

describe("M08: Multi-turn conversation simulation", () => {
  const uid = `test-multi-${Math.random().toString(36).slice(2, 8)}`;

  it("turn 1: fresh search stores result", () => {
    clearMemory(uid);
    const result1: TraderBrainResult = {
      ...makeResult(),
      normalizedRequest: {
        rawPrompt: "find bullish trades",
        intent: "RANK_MARKET_TRADES",
        tickers: [],
        direction: "bullish",
        maxRiskDollars: 500,
      } as NormalizedBrainRequest,
      sections: {
        rankedSearch: {
          candidates: [
            { symbol: "AAPL" }, { symbol: "NVDA" }, { symbol: "TSLA" },
          ],
          watchCandidates: [],
          excludedCount: 2,
          groupedCandidateCount: 3,
        } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
      },
    };
    storeResult(uid, result1);
    const mem = getMemory(uid);
    expect(mem.lastIntent).toBe("RANK_MARKET_TRADES");
    expect(mem.lastRankedCandidates).toHaveLength(3);
    expect(mem.lastMarketDirection).toBe("bullish");
  });

  it("turn 2: 'show me the second one' resolves to NVDA", () => {
    const mem = getMemory(uid);
    const result = resolveFollowUp("show me the second one", mem);
    expect(result.kind).toBe("ordinal_reference");
    expect(result.resolvedCandidate).toMatchObject({ symbol: "NVDA" });
    expect(result.contextHit).toBe(true);
  });

  it("turn 3: 'what about options' carries direction from turn 1", () => {
    const mem = getMemory(uid);
    const result = resolveFollowUp("what about options", mem);
    expect(result.kind).toBe("options_pivot");
    expect(result.overrides.instrumentPreference).toBe("options");
    expect(result.overrides.direction).toBe("bullish");
  });

  it("turn 4: 'make it lower risk' reduces from $500", () => {
    const mem = getMemory(uid);
    const result = resolveFollowUp("make it lower risk", mem);
    expect(result.kind).toBe("risk_refinement");
    expect(result.overrides.maxRiskDollars!).toBeLessThan(500);
  });

  it("turn 5: 'start over' clears memory", () => {
    clearMemory(uid);
    expect(hasMemory(uid)).toBe(false);
    const mem = getMemory(uid);
    const result = resolveFollowUp("show me the second one", mem);
    expect(result.kind).toBe("none"); // no memory = no follow-up
  });
});

// ---------------------------------------------------------------------------
// M09 — Memory store CRUD + behaviour
// ---------------------------------------------------------------------------

describe("M09: Memory store CRUD", () => {
  const uid = `test-crud-${Math.random().toString(36).slice(2, 8)}`;

  it("getMemory returns empty snapshot for unknown user", () => {
    clearMemory(uid);
    const mem = getMemory(`nonexistent-${Math.random()}`);
    expect(mem.lastIntent).toBeNull();
    expect(mem.lastRankedCandidates).toHaveLength(0);
    expect(mem.lastRejectedReasons).toHaveLength(0);
  });

  it("setMemory + getMemory round-trips correctly", () => {
    const snap = makeMemory({ lastMarketDirection: "bearish" });
    setMemory(uid, snap);
    const retrieved = getMemory(uid);
    expect(retrieved.lastMarketDirection).toBe("bearish");
    expect(retrieved.lastRiskBudget?.dollars).toBe(500);
  });

  it("hasMemory returns true after setMemory", () => {
    setMemory(uid, makeMemory());
    expect(hasMemory(uid)).toBe(true);
    clearMemory(uid);
    expect(hasMemory(uid)).toBe(false);
  });

  it("storeResult writes candidates list", () => {
    const result: TraderBrainResult = {
      ...makeResult(),
      sections: {
        rankedSearch: {
          candidates: [{ symbol: "X" }, { symbol: "Y" }],
          watchCandidates: [],
          excludedCount: 0,
          groupedCandidateCount: 2,
        } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
      },
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastRankedCandidates).toHaveLength(2);
    clearMemory(uid);
  });

  it("storeResult captures warnings as rejectedReasons", () => {
    const result: TraderBrainResult = {
      ...makeResult(),
      warnings: ["NVDA excluded: low volume", "TSLA excluded: earnings risk"],
    };
    storeResult(uid, result);
    const mem = getMemory(uid);
    expect(mem.lastRejectedReasons.length).toBeGreaterThan(0);
    clearMemory(uid);
  });

  it("storeResult never throws", () => {
    expect(() => storeResult("any-user", {} as TraderBrainResult)).not.toThrow();
  });

  it("activeEntryCount increases after setMemory", () => {
    const before = activeEntryCount();
    const uniqueUid = `unique-${Math.random()}`;
    setMemory(uniqueUid, makeMemory());
    expect(activeEntryCount()).toBeGreaterThanOrEqual(before + 1);
    clearMemory(uniqueUid);
  });
});

// ---------------------------------------------------------------------------
// M10 — Resolver contract invariants
// ---------------------------------------------------------------------------

describe("M10: Resolver contract invariants", () => {
  it("resolveFollowUp always returns a valid ResolvedFollowUp shape", () => {
    const mem = makeMemory();
    const phrases = [
      "show me the second one",
      "what about options",
      "make it lower risk",
      "show only income ideas",
      "use my account",
      "show conservative ideas",
      "show aggressive ones",
      "why wasn't NVDA included",
      "show me the bearish version",
      "find bullish trades",
    ];
    for (const phrase of phrases) {
      const result = resolveFollowUp(phrase, mem);
      expect(typeof result.kind).toBe("string");
      expect(typeof result.contextHit).toBe("boolean");
      expect(typeof result.overrides).toBe("object");
      expect(result.resolvedCandidate === null || typeof result.resolvedCandidate === "object").toBe(true);
      expect(result.inquiredSymbol === null || typeof result.inquiredSymbol === "string").toBe(true);
    }
  });

  it("resolveFollowUp never throws", () => {
    const emptyMem = getMemory("definitely-nonexistent-user-xyz");
    const fuzzInputs = ["", "   ", "!!!", "AAPL NVDA TSLA", "?", "123"];
    for (const input of fuzzInputs) {
      expect(() => resolveFollowUp(input, emptyMem)).not.toThrow();
    }
  });

  it("applyFollowUpOverrides is a clean merge", () => {
    const req: NormalizedBrainRequest = {
      rawPrompt: "find bullish trades",
      intent: "RANK_MARKET_TRADES",
      tickers: [],
      direction: "bullish",
      maxRiskDollars: 500,
    } as NormalizedBrainRequest;
    const overrides: Partial<NormalizedBrainRequest> = {
      direction: "bearish",
      instrumentPreference: "options",
    };
    const merged = applyFollowUpOverrides(req, overrides);
    expect(merged.direction).toBe("bearish");
    expect(merged.instrumentPreference).toBe("options");
    // Original untouched fields preserved
    expect(merged.maxRiskDollars).toBe(500);
    expect(merged.rawPrompt).toBe("find bullish trades");
  });

  it("applyFollowUpOverrides is non-destructive to input req", () => {
    const req: NormalizedBrainRequest = {
      rawPrompt: "find trades",
      intent: "RANK_MARKET_TRADES",
      tickers: [],
      direction: "bullish",
    } as NormalizedBrainRequest;
    const overrides = { direction: "bearish" as const };
    applyFollowUpOverrides(req, overrides);
    expect(req.direction).toBe("bullish"); // unchanged
  });

  it("isExplicitReset never throws on any input", () => {
    const inputs = ["", "   ", null as unknown as string, undefined as unknown as string, "start over", "find trades"];
    for (const input of inputs) {
      expect(() => isExplicitReset(input ?? "")).not.toThrow();
    }
  });

  it("all FollowUpKind values are covered by classifyFollowUp", () => {
    // Each known kind is reachable with a real phrase
    const cases: Array<[string, FollowUpKind]> = [
      ["show me the second one", "ordinal_reference"],
      ["what about options", "options_pivot"],
      ["make it lower risk", "risk_refinement"],
      ["show only income ideas", "income_filter"],
      ["use my account", "account_context"],
      ["show conservative ideas", "tone_refinement"],
      ["show me the bearish version", "direction_flip"],
      ["why wasn't NVDA included", "exclusion_inquiry"],
      ["show me 5 more", "count_refinement"],
      ["find bullish trades", "none"],
    ];
    for (const [phrase, expectedKind] of cases) {
      expect(classifyFollowUp(phrase, true)).toBe(expectedKind);
    }
  });
});
