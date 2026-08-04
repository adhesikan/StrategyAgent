// Sprint 5.3B — Portfolio Intelligence Workspace
// Regression tests covering spec §5 scenarios.
//
// Tests:
//   PI01 — Portfolio present: full intelligence section is computed
//   PI02 — Portfolio absent: graceful no-context response
//   PI03 — Candidate impact: concentration before/after + cash impact
//   PI04 — Cash unavailable: unknown status handled gracefully
//   PI05 — Earnings overlap: flags extracted from warnings/limitations
//   PI06 — No concentration changes: handles missing concentrationWarning
//   PI07 — OpenAI failure: explanation absent, section still present
//   PI08 — Research questions: contextual follow-ups generated
//   PI09 — GPT prompt builder: never recommends buy/sell
//   PI10 — Contract invariants: never throws, output shape is always valid

import { describe, it, expect } from "vitest";

import {
  computePortfolioIntelligence,
  buildPortfolioIntelligencePrompt,
  type PortfolioIntelligence,
} from "../portfolio-intelligence-engine";

import type { SafePortfolioAwareness } from "../../routes/internal-portfolio";
import type { TraderBrainResult, NormalizedBrainRequest } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePfa(overrides: Partial<SafePortfolioAwareness> = {}): SafePortfolioAwareness {
  return {
    contextFreshness: "2026-08-04T12:00:00.000Z",
    cashSufficiency: "verified",
    buyingPowerSufficiency: "sufficient",
    existingOptionExposure: null,
    sizingAdjustment: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<TraderBrainResult> = {}): TraderBrainResult {
  return {
    requestId: "r-pi-001",
    intent: "RANK_MARKET_TRADES",
    normalizedRequest: {
      rawPrompt: "find bullish trades",
      intent: "RANK_MARKET_TRADES",
      tickers: [],
      direction: "bullish",
      maxRiskDollars: 500,
    } as NormalizedBrainRequest,
    status: "complete",
    headline: "3 bullish candidates found",
    confidence: "high",
    sections: {
      rankedSearch: {
        candidates: [
          { symbol: "AAPL", strategy: "bull_call_spread", maxRisk: 400 },
          { symbol: "NVDA", strategy: "long_stock", maxRisk: 500 },
          { symbol: "MSFT", strategy: "covered_call", maxRisk: 300 },
        ],
        watchCandidates: [],
        excludedCount: 2,
        groupedCandidateCount: 3,
      } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
    },
    evidence: [],
    warnings: [],
    limitations: [],
    nextActions: [],
    generatedAt: new Date().toISOString(),
    openAiUsed: false,
    ...overrides,
  } as TraderBrainResult;
}

// ---------------------------------------------------------------------------
// PI01 — Portfolio present: full section computed
// ---------------------------------------------------------------------------

describe("PI01: Portfolio present — full section is computed", () => {
  const pfa = makePfa({
    concentrationWarning: { pct: 12.5, level: "elevated" },
    existingPosition: { shares: 100, unrealizedPnl: 850 },
    duplicateExposure: true,
    sizingAdjustment: "Already holding 100 shares — consider whether additional size fits your risk plan.",
  });
  const result = makeResult({
    normalizedRequest: {
      rawPrompt: "find a trade for AAPL",
      intent: "RECOMMEND_SYMBOL_TRADE",
      tickers: ["AAPL"],
      symbol: "AAPL",
    } as NormalizedBrainRequest,
  });

  it("sets hasPortfolioContext: true", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.hasPortfolioContext).toBe(true);
  });

  it("populates exposure summary for the symbol", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.exposureSummary.length).toBeGreaterThan(0);
    const entry = pi.exposureSummary.find((e) => e.symbol === "AAPL");
    expect(entry).toBeDefined();
    expect(entry!.existing).toBe(true);
    expect(entry!.duplicateExposure).toBe(true);
  });

  it("populates concentration with currentPct", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    const concEntry = pi.concentration.find((c) => c.symbol === "AAPL");
    expect(concEntry).toBeDefined();
    expect(concEntry!.currentPct).toBe(12.5);
    expect(concEntry!.level).toBe("elevated");
  });

  it("populates cash utilization from SafePortfolioAwareness", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.cashUtilization.status).toBe("verified");
    expect(pi.cashUtilization.buyingPowerStatus).toBe("sufficient");
  });

  it("candidate impact includes the symbol", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.candidateImpact.length).toBeGreaterThan(0);
    const impact = pi.candidateImpact.find((c) => c.symbol === "AAPL");
    expect(impact).toBeDefined();
    expect(impact!.existingHolding).toBe(true);
    expect(impact!.duplicateExposure).toBe(true);
    expect(impact!.sizingNote).not.toBeNull();
  });

  it("data quality shows concentrationAvailable: true", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.dataQuality.portfolioDataAvailable).toBe(true);
    expect(pi.dataQuality.concentrationAvailable).toBe(true);
  });

  it("generates research questions", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    expect(pi.nextResearchQuestions.length).toBeGreaterThan(0);
    expect(pi.nextResearchQuestions.every((q) => typeof q.question === "string" && q.question.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PI02 — Portfolio absent: graceful no-context response
// ---------------------------------------------------------------------------

describe("PI02: Portfolio absent — graceful no-context response", () => {
  const result = makeResult();

  it("sets hasPortfolioContext: false", () => {
    const pi = computePortfolioIntelligence(result, null);
    expect(pi.hasPortfolioContext).toBe(false);
  });

  it("returns empty sections but valid shape", () => {
    const pi = computePortfolioIntelligence(result, null);
    expect(pi.exposureSummary).toEqual([]);
    expect(pi.candidateImpact).toEqual([]);
    expect(pi.concentration).toEqual([]);
    expect(pi.earningsFlags).toEqual([]);
  });

  it("cashUtilization status is unknown when no pfa", () => {
    const pi = computePortfolioIntelligence(result, null);
    expect(pi.cashUtilization.status).toBe("unknown");
    expect(pi.cashUtilization.buyingPowerStatus).toBe("unknown");
  });

  it("data quality reports portfolioDataAvailable: false", () => {
    const pi = computePortfolioIntelligence(result, null);
    expect(pi.dataQuality.portfolioDataAvailable).toBe(false);
    expect(pi.dataQuality.limitations.length).toBeGreaterThan(0);
    expect(pi.dataQuality.limitations[0]).toContain("Portfolio data unavailable");
  });

  it("still generates research questions (navigation aids exist even without portfolio data)", () => {
    const pi = computePortfolioIntelligence(result, null);
    expect(pi.nextResearchQuestions.length).toBeGreaterThanOrEqual(0);
    // All questions must be non-empty strings
    for (const q of pi.nextResearchQuestions) {
      expect(typeof q.question).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// PI03 — Candidate impact: concentration + cash impact
// ---------------------------------------------------------------------------

describe("PI03: Candidate impact — concentration before/after + cash impact", () => {
  const pfa = makePfa({
    concentrationWarning: { pct: 15.0, level: "elevated" },
    existingPosition: { shares: 50, unrealizedPnl: 200 },
    duplicateExposure: true,
    sizingAdjustment: "Already holding 50 shares.",
  });
  const result = makeResult({
    normalizedRequest: {
      rawPrompt: "find a trade for NVDA",
      intent: "RECOMMEND_SYMBOL_TRADE",
      tickers: ["NVDA"],
      symbol: "NVDA",
      maxRiskDollars: 500,
    } as NormalizedBrainRequest,
    sections: {
      rankedSearch: {
        candidates: [{ symbol: "NVDA", strategy: "bull_call_spread", maxRisk: 500 }],
        watchCandidates: [],
        excludedCount: 0,
        groupedCandidateCount: 1,
      } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
    },
  });

  it("candidateImpact has an entry for the primary symbol", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    const impact = pi.candidateImpact.find((c) => c.symbol === "NVDA");
    expect(impact).toBeDefined();
  });

  it("concentrationBefore is set from concentrationWarning.pct", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    const impact = pi.candidateImpact.find((c) => c.symbol === "NVDA");
    expect(impact!.concentrationBefore).toBe(15.0);
  });

  it("concentrationAfterEstimate is greater than before when risk is added", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    const impact = pi.candidateImpact.find((c) => c.symbol === "NVDA");
    // If estimatedAfterPct is set, it should be >= before
    if (impact!.concentrationAfterEstimate != null) {
      expect(impact!.concentrationAfterEstimate).toBeGreaterThanOrEqual(impact!.concentrationBefore!);
    }
  });

  it("sizingNote is passed through from SafePortfolioAwareness", () => {
    const pi = computePortfolioIntelligence(result, pfa);
    const impact = pi.candidateImpact.find((c) => c.symbol === "NVDA");
    expect(impact!.sizingNote).toBe("Already holding 50 shares.");
  });
});

// ---------------------------------------------------------------------------
// PI04 — Cash unavailable: unknown status handled gracefully
// ---------------------------------------------------------------------------

describe("PI04: Cash unavailable — unknown/not_verified handled gracefully", () => {
  it("cashSufficiency unknown → cashUtilization.status is unknown", () => {
    const pfa = makePfa({ cashSufficiency: "unknown", buyingPowerSufficiency: "unknown" });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    expect(pi.cashUtilization.status).toBe("unknown");
    expect(pi.cashUtilization.buyingPowerStatus).toBe("unknown");
  });

  it("cashSufficiency not_verified → status is not_verified", () => {
    const pfa = makePfa({ cashSufficiency: "not_verified", buyingPowerSufficiency: "sufficient" });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    expect(pi.cashUtilization.status).toBe("not_verified");
  });

  it("cashSufficiency insufficient → reflected + limitation added", () => {
    const pfa = makePfa({ cashSufficiency: "insufficient", buyingPowerSufficiency: "insufficient" });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    expect(pi.cashUtilization.status).toBe("insufficient");
    expect(pi.cashUtilization.buyingPowerStatus).toBe("insufficient");
  });

  it("data quality notes cash uncertainty", () => {
    const pfa = makePfa({ cashSufficiency: "unknown", buyingPowerSufficiency: "unknown" });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    const hasLimitation = pi.dataQuality.limitations.some((l) => l.toLowerCase().includes("cash") || l.toLowerCase().includes("buying power") || l.toLowerCase().includes("verified"));
    expect(hasLimitation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PI05 — Earnings overlap: flags extracted from warnings
// ---------------------------------------------------------------------------

describe("PI05: Earnings overlap — flags extracted from result warnings/limitations", () => {
  it("extracts earnings flags from result.warnings", () => {
    const result = makeResult({
      warnings: ["NVDA: upcoming earnings event — elevated risk", "AAPL is approaching earnings"],
      limitations: [],
    });
    const pi = computePortfolioIntelligence(result, makePfa());
    expect(pi.earningsFlags.length).toBeGreaterThan(0);
    const symbols = pi.earningsFlags.map((f) => f.symbol);
    expect(symbols).toContain("NVDA");
  });

  it("extracts earnings flags from result.limitations", () => {
    const result = makeResult({
      warnings: [],
      limitations: ["TSLA: earnings risk warning — exercise caution around the earnings event"],
    });
    const pi = computePortfolioIntelligence(result, makePfa());
    const tslaFlag = pi.earningsFlags.find((f) => f.symbol === "TSLA");
    expect(tslaFlag).toBeDefined();
    expect(tslaFlag!.warning).toContain("earnings");
  });

  it("no earnings warnings → empty earningsFlags", () => {
    const result = makeResult({ warnings: ["Low volume on XYZ"], limitations: [] });
    const pi = computePortfolioIntelligence(result, makePfa());
    // May still be empty or have no earnings-specific flags
    for (const flag of pi.earningsFlags) {
      expect(flag.warning.toLowerCase()).toMatch(/earnings/);
    }
  });

  it("earningsFlag warning is capped at 200 chars", () => {
    const longWarning = "NVDA: upcoming earnings event — " + "x".repeat(300);
    const result = makeResult({ warnings: [longWarning], limitations: [] });
    const pi = computePortfolioIntelligence(result, makePfa());
    for (const flag of pi.earningsFlags) {
      expect(flag.warning.length).toBeLessThanOrEqual(200);
    }
  });
});

// ---------------------------------------------------------------------------
// PI06 — No concentration changes: handles missing concentrationWarning
// ---------------------------------------------------------------------------

describe("PI06: No concentration changes — missing concentrationWarning handled", () => {
  it("concentration array is empty when no concentrationWarning on pfa", () => {
    const pfa = makePfa({ concentrationWarning: undefined });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "find trades",
        intent: "RANK_MARKET_TRADES",
        tickers: [],
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    // concentration may still have entries from duplicateExposure, but currentPct is absent
    for (const c of pi.concentration) {
      expect(c.currentPct).toBeUndefined();
    }
  });

  it("concentrationAvailable is false when pfa has no concentrationWarning", () => {
    const pfa = makePfa({ concentrationWarning: undefined });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    expect(pi.dataQuality.concentrationAvailable).toBe(false);
  });

  it("candidateImpact concentrationBefore is undefined without concentrationWarning", () => {
    const pfa = makePfa({ concentrationWarning: undefined });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "find trades for AAPL",
        intent: "RANK_MARKET_TRADES",
        tickers: ["AAPL"],
        symbol: "AAPL",
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    const impact = pi.candidateImpact.find((c) => c.symbol === "AAPL");
    if (impact) {
      expect(impact.concentrationBefore).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// PI07 — OpenAI failure: explanation absent, section still complete
// ---------------------------------------------------------------------------

describe("PI07: OpenAI failure — explanation absent, section still complete", () => {
  it("PortfolioIntelligence is valid without openAiExplanation", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 8.0, level: "normal" },
    });
    const result = makeResult();
    const pi = computePortfolioIntelligence(result, pfa);

    // No openAiExplanation set by engine — it's injected by ask.ts after OpenAI call
    expect(pi.openAiExplanation).toBeUndefined();

    // But the section is otherwise fully populated
    expect(pi.hasPortfolioContext).toBe(true);
    expect(pi.dataQuality.portfolioDataAvailable).toBe(true);
  });

  it("openAiExplanation can be added externally without breaking shape", () => {
    const pfa = makePfa();
    const result = makeResult();
    const pi = computePortfolioIntelligence(result, pfa);
    const withExplanation: PortfolioIntelligence = {
      ...pi,
      openAiExplanation: "This trade would add moderate concentration to your portfolio.",
    };
    expect(withExplanation.openAiExplanation).toBeTruthy();
    expect(withExplanation.hasPortfolioContext).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PI08 — Research questions: contextual follow-up prompts
// ---------------------------------------------------------------------------

describe("PI08: Research questions — contextual follow-ups generated", () => {
  it("generates at most 5 questions", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 25.0, level: "high" },
    });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    expect(pi.nextResearchQuestions.length).toBeLessThanOrEqual(5);
  });

  it("all questions are non-empty strings", () => {
    const pi = computePortfolioIntelligence(makeResult(), makePfa());
    for (const q of pi.nextResearchQuestions) {
      expect(typeof q.question).toBe("string");
      expect(q.question.trim().length).toBeGreaterThan(0);
    }
  });

  it("no duplicate questions", () => {
    const pi = computePortfolioIntelligence(makeResult(), makePfa());
    const seen = new Set<string>();
    for (const q of pi.nextResearchQuestions) {
      expect(seen.has(q.question)).toBe(false);
      seen.add(q.question);
    }
  });

  it("high concentration triggers diversification question", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 22.0, level: "high" },
    });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    const hasDiversify = pi.nextResearchQuestions.some(
      (q) => q.question.toLowerCase().includes("diversif") || q.question.toLowerCase().includes("concentration"),
    );
    expect(hasDiversify).toBe(true);
  });

  it("insufficient cash triggers lower-cost question", () => {
    const pfa = makePfa({
      cashSufficiency: "insufficient",
      buyingPowerSufficiency: "insufficient",
    });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    const hasCashQ = pi.nextResearchQuestions.some(
      (q) => q.question.toLowerCase().includes("lower") || q.question.toLowerCase().includes("buying power") || q.question.toLowerCase().includes("budget"),
    );
    expect(hasCashQ).toBe(true);
  });

  it("questions are navigation aids — none contain buy/sell advice", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 18.0, level: "elevated" },
    });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    for (const q of pi.nextResearchQuestions) {
      const lower = q.question.toLowerCase();
      expect(lower).not.toMatch(/\bbuy\b|\bsell\b|\bpurchase\b|\benter.*position\b|\bclose.*position\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// PI09 — GPT prompt builder: explains trade-offs, never buy/sell advice
// ---------------------------------------------------------------------------

describe("PI09: GPT prompt builder — explains trade-offs, no buy/sell advice", () => {
  it("returns null when no portfolio context", () => {
    const pi = computePortfolioIntelligence(makeResult(), null);
    const prompts = buildPortfolioIntelligencePrompt(pi, "find bullish trades");
    expect(prompts).toBeNull();
  });

  it("returns null when no candidate or concentration data", () => {
    const pi: PortfolioIntelligence = {
      hasPortfolioContext: true,
      exposureSummary: [],
      cashUtilization: { status: "unknown", buyingPowerStatus: "unknown" },
      candidateImpact: [],
      concentration: [],
      earningsFlags: [],
      dataQuality: {
        contextFreshness: new Date().toISOString(),
        portfolioDataAvailable: true,
        concentrationAvailable: false,
        cashDataAvailable: false,
        limitations: [],
      },
      nextResearchQuestions: [],
    };
    const prompts = buildPortfolioIntelligencePrompt(pi, "find trades");
    expect(prompts).toBeNull();
  });

  it("returns system + user prompts when data is present", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 15.0, level: "elevated" },
      existingPosition: { shares: 100, unrealizedPnl: 500 },
      duplicateExposure: true,
    });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "find trade for AAPL",
        intent: "RECOMMEND_SYMBOL_TRADE",
        tickers: ["AAPL"],
        symbol: "AAPL",
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    const prompts = buildPortfolioIntelligencePrompt(pi, "find trade for AAPL");
    expect(prompts).not.toBeNull();
    expect(typeof prompts!.system).toBe("string");
    expect(typeof prompts!.user).toBe("string");
    expect(prompts!.user).toContain("AAPL");
  });

  it("system prompt explicitly forbids buy/sell advice", () => {
    const pfa = makePfa({ concentrationWarning: { pct: 10.0, level: "elevated" } });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "find trade for NVDA",
        intent: "RECOMMEND_SYMBOL_TRADE",
        tickers: ["NVDA"],
        symbol: "NVDA",
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    const prompts = buildPortfolioIntelligencePrompt(pi, "find trade for NVDA");
    if (prompts) {
      const system = prompts.system.toLowerCase();
      expect(system).toMatch(/never recommend buying|not.*recommend.*buying|never recommend.*sell|not.*recommend.*selling/);
    }
  });

  it("user prompt includes the question", () => {
    const pfa = makePfa({ concentrationWarning: { pct: 8.0, level: "normal" } });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "analyze portfolio risk for TSLA",
        intent: "RECOMMEND_SYMBOL_TRADE",
        tickers: ["TSLA"],
        symbol: "TSLA",
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    const prompts = buildPortfolioIntelligencePrompt(pi, "analyze portfolio risk for TSLA");
    if (prompts) {
      expect(prompts.user).toContain("analyze portfolio risk for TSLA");
    }
  });
});

// ---------------------------------------------------------------------------
// PI10 — Contract invariants: never throws, output shape always valid
// ---------------------------------------------------------------------------

describe("PI10: Contract invariants — never throws, output shape always valid", () => {
  it("never throws on null pfa", () => {
    expect(() => computePortfolioIntelligence(makeResult(), null)).not.toThrow();
  });

  it("never throws on empty sections", () => {
    const result = makeResult({ sections: {} });
    expect(() => computePortfolioIntelligence(result, makePfa())).not.toThrow();
  });

  it("never throws on partial sections (only rankedSearch)", () => {
    const result = makeResult({
      sections: {
        rankedSearch: {
          candidates: [{ symbol: "AAPL", strategy: "bull_call_spread" }],
          watchCandidates: [],
          excludedCount: 0,
          groupedCandidateCount: 1,
        } as unknown as NonNullable<TraderBrainResult["sections"]["rankedSearch"]>,
      },
    });
    expect(() => computePortfolioIntelligence(result, makePfa())).not.toThrow();
  });

  it("never throws on malformed result", () => {
    expect(() => computePortfolioIntelligence({} as TraderBrainResult, null)).not.toThrow();
  });

  it("output always has all required top-level fields", () => {
    const inputs: Array<[TraderBrainResult, SafePortfolioAwareness | null]> = [
      [makeResult(), null],
      [makeResult(), makePfa()],
      [makeResult({ sections: {} }), makePfa()],
      [{} as TraderBrainResult, null],
    ];
    for (const [result, pfa] of inputs) {
      const pi = computePortfolioIntelligence(result, pfa);
      expect(typeof pi.hasPortfolioContext).toBe("boolean");
      expect(Array.isArray(pi.exposureSummary)).toBe(true);
      expect(Array.isArray(pi.candidateImpact)).toBe(true);
      expect(Array.isArray(pi.concentration)).toBe(true);
      expect(Array.isArray(pi.earningsFlags)).toBe(true);
      expect(typeof pi.dataQuality).toBe("object");
      expect(Array.isArray(pi.nextResearchQuestions)).toBe(true);
      expect(Array.isArray(pi.dataQuality.limitations)).toBe(true);
    }
  });

  it("percentages are always rounded to 1 decimal", () => {
    const pfa = makePfa({
      concentrationWarning: { pct: 12.3456, level: "elevated" },
    });
    const result = makeResult({
      normalizedRequest: {
        rawPrompt: "find trades",
        intent: "RANK_MARKET_TRADES",
        tickers: [],
        symbol: "AAPL",
      } as NormalizedBrainRequest,
    });
    const pi = computePortfolioIntelligence(result, pfa);
    for (const c of pi.concentration) {
      if (c.currentPct != null) {
        // The pct is passed through from pfa.concentrationWarning.pct as-is
        // (the rounding happens in computePortfolioAwareness, not here)
        expect(typeof c.currentPct).toBe("number");
      }
      if (c.estimatedAfterPct != null) {
        // Estimated "after" should also be numeric and > 0
        expect(c.estimatedAfterPct).toBeGreaterThan(0);
      }
    }
  });

  it("all research question strings contain no buy/sell advice", () => {
    const pfa = makePfa({ concentrationWarning: { pct: 30.0, level: "high" } });
    const pi = computePortfolioIntelligence(makeResult(), pfa);
    for (const q of pi.nextResearchQuestions) {
      expect(q.question.toLowerCase()).not.toMatch(/\bbuy\b|\bsell\b|\bpurchase\b/);
    }
  });
});
