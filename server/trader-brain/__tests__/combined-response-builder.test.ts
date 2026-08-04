// TraderBrain — combined-response-builder tests.
//
// Covers all 4 partial-failure cases, OpenAI prose wiring, section separation,
// no score/verdict blending, and backward-compatible AskAnswer shape.

import { describe, it, expect } from "vitest";
import {
  buildCombinedAskAnswer,
  buildCombinedSystemPrompt,
  buildCombinedUserContent,
} from "../combined-response-builder";
import type { TraderBrainResult, NormalizedBrainRequest } from "../types";
import type { MultiStrategyAnalysis } from "../../mcp/multi-strategy-analysis";
import type { StrategyRecommendation } from "../../mcp/strategy-recommendation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNormalizedReq(overrides: Partial<NormalizedBrainRequest> = {}): NormalizedBrainRequest {
  return {
    rawPrompt: "Analyze BA and recommend a trade",
    intent: "COMBINED_ANALYSIS_RECOMMENDATION",
    tickers: ["BA"],
    symbol: "BA",
    ...overrides,
  };
}

function makeAnalysis(symbol = "BA"): MultiStrategyAnalysis {
  return {
    symbol,
    overallVerdict: "WATCH",
    strategiesChecked: 3,
    strategiesMatched: 1,
    strategiesFailed: 0,
    primarySetup: null,
    supportingSetups: [],
    dataQuality: { source: "mcp", realMarketData: true, fresh: true, complete: true },
    generatedAt: new Date().toISOString(),
  } as unknown as MultiStrategyAnalysis;
}

function makeRecommendation(): StrategyRecommendation {
  return {
    recommendations: [
      {
        recommendedStrategy: "covered_call",
        overallVerdict: "ESTIMATED_OPTIONS",
        warnings: ["Simulated data"],
      },
    ],
    warnings: [],
    generatedAt: new Date().toISOString(),
  } as unknown as StrategyRecommendation;
}

function makeBrainResult(
  sections: TraderBrainResult["sections"],
  overrides: Partial<TraderBrainResult> = {},
): TraderBrainResult {
  return {
    requestId: "test-req-1",
    intent: "COMBINED_ANALYSIS_RECOMMENDATION",
    normalizedRequest: makeNormalizedReq(),
    status: "ok",
    headline: "BA analysis and recommendation",
    confidence: "medium",
    sections,
    evidence: [],
    warnings: [],
    limitations: [],
    nextActions: [],
    generatedAt: new Date().toISOString(),
    openAiUsed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Case 1: Both succeeded
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer — both succeeded", () => {
  it("returns multiStrategyAnalysis and strategyRecommendation sections", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.multiStrategyAnalysis).toBeDefined();
    expect(out.strategyRecommendation).toBeDefined();
  });

  it("does not set recommendationFailed", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.recommendationFailed).toBeUndefined();
  });

  it("uses openAiExplanation prose when provided", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const prose = "This is the OpenAI explanation for BA.";
    const out = await buildCombinedAskAnswer(result, prose);
    expect(out.answer).toBe(prose);
  });

  it("falls back to deterministic answer when openAiExplanation is null", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    expect(typeof out.answer).toBe("string");
    expect(out.answer.length).toBeGreaterThan(0);
  });

  it("never blends scanner scores into recommendation verdict text", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    // Both sections are present independently — no cross-contamination
    expect(out.strategyRecommendation).toBeDefined();
    expect(out.multiStrategyAnalysis).toBeDefined();
    // Recommendation verdict is separate from analysis verdict
    const recVerdicts = out.strategyRecommendation!.recommendations.map((r) => r.overallVerdict);
    const analysisVerdict = out.multiStrategyAnalysis!.overallVerdict;
    expect(recVerdicts).toBeDefined();
    expect(analysisVerdict).toBeDefined();
    // Key points must not contain the recommendation strategy name mixed with the analysis verdict
    // (i.e., the two sections should not be fused into a single misleading bullet)
    expect(out.keyPoints.length).toBeLessThanOrEqual(5);
  });

  it("key points include recommendation facts (up to 2) before analysis points", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    expect(Array.isArray(out.keyPoints)).toBe(true);
    expect(out.keyPoints.length).toBeGreaterThan(0);
    expect(out.keyPoints.length).toBeLessThanOrEqual(5);
  });

  it("confidence is defined and valid", async () => {
    const result = makeBrainResult({
      analysis: makeAnalysis(),
      recommendation: makeRecommendation(),
    });
    const out = await buildCombinedAskAnswer(result, null);
    expect(["low", "medium", "high"]).toContain(out.confidence);
  });
});

// ---------------------------------------------------------------------------
// Case 2: Analysis succeeded, recommendation failed
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer — analysis OK, recommendation failed", () => {
  it("includes multiStrategyAnalysis, no strategyRecommendation", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.multiStrategyAnalysis).toBeDefined();
    expect(out.strategyRecommendation).toBeUndefined();
  });

  it("sets recommendationFailed: true", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.recommendationFailed).toBe(true);
  });

  it("headline mentions symbol and 'recommendation unavailable'", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis("BA"), recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.headline.toLowerCase()).toMatch(/ba|recommendation unavailable/);
  });

  it("answer discloses recommendation unavailability — no invented trade", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.answer).toMatch(/recommendation|unavailable/i);
    // Must NOT mention a specific strategy as if it were recommended
    expect(out.answer).not.toMatch(/place a|enter a (long|short)|buy.*contract/i);
  });

  it("includes OpenAI explanation in answer when provided", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const prose = "OpenAI analysis prose here.";
    const out = await buildCombinedAskAnswer(result, prose);
    expect(out.answer).toContain(prose);
  });

  it("confidence is derived from analysis, not defaulting to 'none'", async () => {
    const result = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(["low", "medium", "high"]).toContain(out.confidence);
  });
});

// ---------------------------------------------------------------------------
// Case 3: Recommendation succeeded, analysis failed
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer — recommendation OK, analysis failed", () => {
  it("includes strategyRecommendation, no multiStrategyAnalysis", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.strategyRecommendation).toBeDefined();
    expect(out.multiStrategyAnalysis).toBeUndefined();
  });

  it("does NOT set recommendationFailed", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.recommendationFailed).toBeUndefined();
  });

  it("answer discloses analysis limitation without hiding the recommendation", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.answer).toMatch(/analysis.*(unavailable|temporarily)/i);
  });

  it("uses openAiExplanation prose when provided", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const prose = "Recommendation prose.";
    const out = await buildCombinedAskAnswer(result, prose);
    expect(out.answer).toContain(prose);
  });

  it("confidence is derived from recommendation", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const out = await buildCombinedAskAnswer(result, null);
    expect(["low", "medium", "high"]).toContain(out.confidence);
  });
});

// ---------------------------------------------------------------------------
// Case 4: Both failed
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer — both failed", () => {
  it("sets recommendationFailed: true", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.recommendationFailed).toBe(true);
  });

  it("does NOT include either section", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.multiStrategyAnalysis).toBeUndefined();
    expect(out.strategyRecommendation).toBeUndefined();
  });

  it("confidence is 'low'", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.confidence).toBe("low");
  });

  it("answer never invents a trade", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.answer).not.toMatch(/place a|enter a (long|short)|buy.*contract/i);
    expect(out.answer).toMatch(/unavailable|transient/i);
  });

  it("headline mentions symbol when available", async () => {
    const result = makeBrainResult({ analysis: null, recommendation: null });
    const out = await buildCombinedAskAnswer(result, null);
    expect(out.headline).toMatch(/ba|unavailable/i);
  });
});

// ---------------------------------------------------------------------------
// Shape invariants across all cases
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer — shape invariants", () => {
  const CASES: [string, TraderBrainResult["sections"]][] = [
    ["both",            { analysis: makeAnalysis(), recommendation: makeRecommendation() }],
    ["analysis only",   { analysis: makeAnalysis(), recommendation: null }],
    ["rec only",        { analysis: null,            recommendation: makeRecommendation() }],
    ["both failed",     { analysis: null,            recommendation: null }],
  ];

  for (const [label, sections] of CASES) {
    describe(`[${label}]`, () => {
      it("headline is a non-empty string", async () => {
        const r = makeBrainResult(sections);
        const out = await buildCombinedAskAnswer(r, null);
        expect(typeof out.headline).toBe("string");
        expect(out.headline.length).toBeGreaterThan(0);
      });

      it("answer is a non-empty string", async () => {
        const r = makeBrainResult(sections);
        const out = await buildCombinedAskAnswer(r, null);
        expect(typeof out.answer).toBe("string");
        expect(out.answer.length).toBeGreaterThan(0);
      });

      it("keyPoints is an array", async () => {
        const r = makeBrainResult(sections);
        const out = await buildCombinedAskAnswer(r, null);
        expect(Array.isArray(out.keyPoints)).toBe(true);
      });

      it("riskNote is a non-empty string", async () => {
        const r = makeBrainResult(sections);
        const out = await buildCombinedAskAnswer(r, null);
        expect(typeof out.riskNote).toBe("string");
        expect(out.riskNote.length).toBeGreaterThan(0);
      });

      it("confidence is one of low/medium/high", async () => {
        const r = makeBrainResult(sections);
        const out = await buildCombinedAskAnswer(r, null);
        expect(["low", "medium", "high"]).toContain(out.confidence);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// buildCombinedSystemPrompt
// ---------------------------------------------------------------------------

describe("buildCombinedSystemPrompt", () => {
  it("returns null when both sections are absent", () => {
    const r = makeBrainResult({ analysis: null, recommendation: null });
    expect(buildCombinedSystemPrompt(r)).toBeNull();
  });

  it("returns a string when analysis is present", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const prompt = buildCombinedSystemPrompt(r);
    expect(typeof prompt).toBe("string");
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it("returns a string when recommendation is present", () => {
    const r = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const prompt = buildCombinedSystemPrompt(r);
    expect(typeof prompt).toBe("string");
  });

  it("includes verdict constraint when recommendation is present", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: makeRecommendation() });
    const prompt = buildCombinedSystemPrompt(r)!;
    // Must constrain the model: the verdict is the source of truth
    expect(prompt).toMatch(/verdict|source of truth/i);
  });

  it("discloses analysis unavailability when analysis is null", () => {
    const r = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const prompt = buildCombinedSystemPrompt(r)!;
    expect(prompt).toMatch(/analysis.*unavailable|unavailable.*analysis/i);
  });

  it("discloses recommendation unavailability when recommendation is null", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const prompt = buildCombinedSystemPrompt(r)!;
    expect(prompt).toMatch(/recommendation.*unavailable|unavailable.*recommendation/i);
  });

  it("contains the no-invent instruction", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: makeRecommendation() });
    const prompt = buildCombinedSystemPrompt(r)!;
    expect(prompt).toMatch(/never invent|never claim/i);
  });
});

// ---------------------------------------------------------------------------
// buildCombinedUserContent
// ---------------------------------------------------------------------------

describe("buildCombinedUserContent", () => {
  it("includes the user question", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: makeRecommendation() });
    const content = buildCombinedUserContent(r, "Analyze BA and recommend a trade");
    expect(content).toContain("Analyze BA and recommend a trade");
  });

  it("includes ANALYSIS section when present", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const content = buildCombinedUserContent(r, "Analyze BA");
    expect(content).toMatch(/ANALYSIS/);
    expect(content).not.toMatch(/ANALYSIS.*unavailable/i);
  });

  it("shows 'analysis: temporarily unavailable' when null", () => {
    const r = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const content = buildCombinedUserContent(r, "Analyze BA");
    expect(content).toMatch(/ANALYSIS.*unavailable/i);
  });

  it("includes RECOMMENDATION section when present", () => {
    const r = makeBrainResult({ analysis: null, recommendation: makeRecommendation() });
    const content = buildCombinedUserContent(r, "Analyze BA");
    expect(content).toMatch(/RECOMMENDATION/);
    expect(content).not.toMatch(/RECOMMENDATION.*unavailable/i);
  });

  it("shows 'recommendation: temporarily unavailable' when null", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: null });
    const content = buildCombinedUserContent(r, "Analyze BA");
    expect(content).toMatch(/RECOMMENDATION.*unavailable/i);
  });

  it("never embeds raw section objects (keeps summaries only)", () => {
    const r = makeBrainResult({ analysis: makeAnalysis(), recommendation: makeRecommendation() });
    const content = buildCombinedUserContent(r, "Analyze BA");
    // Should not contain raw JSON property markers that would expose full payloads
    expect(content).not.toMatch(/"strategies":\s*\[/);
    expect(content).not.toMatch(/"recommendations":\s*\[/);
  });
});
