// Regression tests for combined-response-builder consistency (§1–§9)
//
// 15 tests covering:
//  - canonical trigger resolution (5)
//  - actionability model (4)
//  - combined headline (3)
//  - trade-status: ESTIMATED_OPTIONS never TRADE_READY (2)
//  - buildCombinedAskAnswer shape (1)

import { describe, it, expect } from "vitest";
import {
  resolveCanonicalTrigger,
  computeActionability,
  type CanonicalTrigger,
  type CombinedActionability,
  buildCombinedAskAnswer,
} from "../combined-response-builder";
import type { MultiStrategyAnalysis } from "../../mcp/multi-strategy-analysis";
import type { StrategyRecommendation } from "../../mcp/strategy-recommendation";
import type { TraderBrainResult } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<MultiStrategyAnalysis> = {}): MultiStrategyAnalysis {
  return {
    source: "mcp",
    symbol: "BA",
    generatedAt: new Date().toISOString(),
    overallVerdict: "TRADE_CANDIDATE",
    strategiesChecked: 10,
    strategiesMatched: 3,
    dataQuality: { fresh: true } as any,
    primarySetup: {
      setup: {
        symbol: "BA",
        strategy: "vcp",
        trigger: { price: 239.02, basis: "resistance break" },
      } as any,
      candidateCheck: { status: "QUALIFIED" } as any,
      selectionReasons: [],
    } as any,
    supportingSetups: [],
    ...overrides,
  };
}

function makeRec(overrides: Partial<StrategyRecommendation> = {}): StrategyRecommendation {
  return {
    source: "mcp",
    generatedAt: new Date().toISOString(),
    simulatedData: false,
    recommendations: [
      {
        overallVerdict: "ESTIMATED_OPTIONS",
        recommendedStrategy: "Bull Call Spread",
        tradeCandidate: null,
        reasons: ["VCP detected", "Volume surge"],
        warnings: [],
      },
    ],
    ...overrides,
  };
}

function makeBrainResult(
  analysis: MultiStrategyAnalysis | null,
  recommendation: StrategyRecommendation | null,
): TraderBrainResult {
  return {
    intent: "COMBINED",
    sections: {
      ...(analysis ? { analysis } : {}),
      ...(recommendation ? { recommendation } : {}),
    },
    normalizedRequest: { symbol: "BA", tickers: ["BA"], question: "Analyze BA" } as any,
  } as any;
}

// ---------------------------------------------------------------------------
// §2 — Canonical trigger resolution
// ---------------------------------------------------------------------------

describe("resolveCanonicalTrigger", () => {
  it("T01: resolves from recommendation tradeCandidate (priority 1)", () => {
    const rec = makeRec({
      recommendations: [
        {
          overallVerdict: "ESTIMATED_OPTIONS",
          recommendedStrategy: "Bull Call Spread",
          tradeCandidate: { trigger: "$245.00 break", entryTrigger: "$240.00" } as any,
          reasons: [],
        },
      ],
    });
    const trigger = resolveCanonicalTrigger(makeAnalysis(), rec);
    expect(trigger).not.toBeNull();
    // Should prefer the first valid candidate field (trigger → "$245.00 break" parses to 245)
    expect(trigger!.price).toBeCloseTo(245, 1);
    expect(trigger!.source).toBe("recommendation_candidate");
  });

  it("T02: falls back to recommendation setup trigger when candidate has none", () => {
    const rec = makeRec({
      recommendations: [
        {
          overallVerdict: "ESTIMATED_OPTIONS",
          recommendedStrategy: "Bull Call Spread",
          tradeCandidate: { direction: "bullish" } as any,
          setup: { trigger: { price: 241.5, basis: "setup resistance" }, symbol: "BA", strategy: "vcp" } as any,
          reasons: [],
        },
      ],
    });
    const trigger = resolveCanonicalTrigger(makeAnalysis(), rec);
    expect(trigger).not.toBeNull();
    expect(trigger!.price).toBeCloseTo(241.5, 1);
    expect(trigger!.source).toBe("recommendation_setup");
    expect(trigger!.basis).toBe("setup resistance");
  });

  it("T03: borrows from analysis primary setup when recommendation has no trigger", () => {
    const rec = makeRec({
      recommendations: [
        {
          overallVerdict: "ESTIMATED_OPTIONS",
          recommendedStrategy: "Bull Call Spread",
          tradeCandidate: null,
          setup: null,
          reasons: [],
        },
      ],
    });
    const trigger = resolveCanonicalTrigger(makeAnalysis(), rec);
    expect(trigger).not.toBeNull();
    expect(trigger!.price).toBeCloseTo(239.02, 1);
    expect(trigger!.source).toBe("analysis_primary");
    expect(trigger!.basis).toBe("resistance break");
  });

  it("T04: returns null when no trigger exists in either section", () => {
    const rec = makeRec({
      recommendations: [
        {
          overallVerdict: "ESTIMATED_OPTIONS",
          recommendedStrategy: "Bull Call Spread",
          tradeCandidate: null,
          setup: null,
          reasons: [],
        },
      ],
    });
    const analysis = makeAnalysis({
      primarySetup: {
        setup: { symbol: "BA", strategy: "vcp", trigger: null } as any,
        candidateCheck: { status: "QUALIFIED" } as any,
        selectionReasons: [],
      } as any,
    });
    const trigger = resolveCanonicalTrigger(analysis, rec);
    expect(trigger).toBeNull();
  });

  it("T05: does NOT borrow analysis trigger when symbol mismatches", () => {
    const rec = makeRec({
      recommendations: [
        {
          overallVerdict: "ESTIMATED_OPTIONS",
          recommendedStrategy: "Bull Call Spread",
          tradeCandidate: null,
          setup: null,
          reasons: [],
        },
      ],
    });
    // Analysis symbol = BA but primary setup symbol = AAPL (mismatch)
    const analysis = makeAnalysis({
      symbol: "BA",
      primarySetup: {
        setup: { symbol: "AAPL", strategy: "vcp", trigger: { price: 180, basis: "AAPL resistance" } } as any,
        candidateCheck: { status: "QUALIFIED" } as any,
        selectionReasons: [],
      } as any,
    });
    const trigger = resolveCanonicalTrigger(analysis, rec);
    expect(trigger).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3 — Actionability model
// ---------------------------------------------------------------------------

describe("computeActionability", () => {
  it("T06: LIVE_OPTIONS + fresh analysis → tradeTicketReady", () => {
    const rec = makeRec({ recommendations: [{ overallVerdict: "LIVE_OPTIONS", recommendedStrategy: "Buy Call" } as any] });
    const result = computeActionability(makeAnalysis({ dataQuality: { fresh: true } as any }), rec);
    expect(result.optionsContractLive).toBe(true);
    expect(result.tradeTicketReady).toBe(true);
    expect(result.stalenessRequired).toBe(false);
    expect(result.cashRequirementVerified).toBe(true);
  });

  it("T07: ESTIMATED_OPTIONS → never tradeTicketReady, cashRequirementVerified=false", () => {
    const rec = makeRec(); // defaults to ESTIMATED_OPTIONS
    const result = computeActionability(makeAnalysis(), rec);
    expect(result.optionsStructureEstimated).toBe(true);
    expect(result.optionsContractLive).toBe(false);
    expect(result.tradeTicketReady).toBe(false);
    expect(result.cashRequirementVerified).toBe(false);
  });

  it("T08: stale analysis (fresh=false) → stalenessRequired, suppresses tradeTicketReady for LIVE_OPTIONS", () => {
    const rec = makeRec({ recommendations: [{ overallVerdict: "LIVE_OPTIONS", recommendedStrategy: "Buy Call" } as any] });
    const staleAnalysis = makeAnalysis({ dataQuality: { fresh: false } as any });
    const result = computeActionability(staleAnalysis, rec);
    expect(result.stalenessRequired).toBe(true);
    expect(result.tradeTicketReady).toBe(false); // Stale overrides LIVE_OPTIONS readiness
  });

  it("T09: STOCK verdict → underlyingSetupActionable, no options flags", () => {
    const rec = makeRec({ recommendations: [{ overallVerdict: "STOCK", recommendedStrategy: "Long stock" } as any] });
    const result = computeActionability(makeAnalysis(), rec);
    expect(result.underlyingSetupActionable).toBe(true);
    expect(result.optionsStructureEstimated).toBe(false);
    expect(result.optionsContractLive).toBe(false);
    expect(result.cashRequirementVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §9 — Combined headline
// ---------------------------------------------------------------------------

// We test buildCombinedAskAnswer's headline rather than the private helper directly
// to validate the full pipeline.

describe("buildCombinedAskAnswer headline invariants", () => {
  it("T10: stale setup → headline contains 'fresh confirmation'", async () => {
    const staleAnalysis = makeAnalysis({ dataQuality: { fresh: false } as any });
    const result = makeBrainResult(staleAnalysis, makeRec());
    const answer = await buildCombinedAskAnswer(result, null);
    expect(answer.headline.toLowerCase()).toMatch(/fresh confirmation|revalid/);
  });

  it("T11: ESTIMATED_OPTIONS + qualified analysis → headline mentions 'qualified' and 'estimated'", async () => {
    const result = makeBrainResult(makeAnalysis(), makeRec());
    const answer = await buildCombinedAskAnswer(result, null);
    expect(answer.headline.toLowerCase()).toMatch(/qualified|setup/);
    expect(answer.headline.toLowerCase()).toMatch(/estimated/);
  });

  it("T12: LIVE_OPTIONS + fresh → headline mentions 'live options'", async () => {
    const rec = makeRec({ recommendations: [{ overallVerdict: "LIVE_OPTIONS", recommendedStrategy: "Buy Call" } as any] });
    const result = makeBrainResult(makeAnalysis(), rec);
    const answer = await buildCombinedAskAnswer(result, null);
    expect(answer.headline.toLowerCase()).toMatch(/live options/);
  });
});

// ---------------------------------------------------------------------------
// ESTIMATED_OPTIONS trade-status regression — mirror of frontend logic
// ---------------------------------------------------------------------------
//
// We mirror `computeTradeStatusDirect` from client/src/lib/trade-plan-view-model.ts
// rather than crossing the client boundary from a server test. These tests verify
// the EXACT branching rules that were changed for ESTIMATED_OPTIONS.
//
// The corresponding client test lives in client/src/lib/__tests__/ (vitest root = client/).

type TradeCardStatus = "TRADE_READY" | "TRIGGERED" | "AWAITING_BREAKOUT" | "WATCH" | "REJECTED" | "DATA_LIMITED" | "MARKET_UNAVAILABLE" | "EARNINGS_HOLD";
type TriggerState = "NO_TRIGGER" | "AWAITING_TRIGGER" | "TRIGGERED" | "UNKNOWN" | "EVENT_CONFIRMATION";

function computeTradeStatusDirectMirror(opts: {
  verdict: string;
  triggerState?: TriggerState;
}): TradeCardStatus {
  const { verdict, triggerState = "NO_TRIGGER" } = opts;
  if (verdict === "STOCK" || verdict === "LIVE_OPTIONS") {
    if (triggerState === "TRIGGERED") return "TRIGGERED";
    if (triggerState === "AWAITING_TRIGGER" || triggerState === "UNKNOWN" || triggerState === "EVENT_CONFIRMATION") return "AWAITING_BREAKOUT";
    return "TRADE_READY";
  }
  if (verdict === "ESTIMATED_OPTIONS") {
    // No live contract — never TRADE_READY.
    if (triggerState === "TRIGGERED") return "TRIGGERED";
    return "AWAITING_BREAKOUT";
  }
  if (verdict === "WATCH") return "WATCH";
  return "REJECTED";
}

describe("computeTradeStatusDirect (mirror) — ESTIMATED_OPTIONS never TRADE_READY", () => {
  it("T13: ESTIMATED_OPTIONS + NO_TRIGGER → AWAITING_BREAKOUT (not TRADE_READY)", () => {
    const status = computeTradeStatusDirectMirror({ verdict: "ESTIMATED_OPTIONS", triggerState: "NO_TRIGGER" });
    expect(status).toBe("AWAITING_BREAKOUT");
    expect(status).not.toBe("TRADE_READY");
  });

  it("T14: ESTIMATED_OPTIONS + TRIGGERED → TRIGGERED (can still be triggered)", () => {
    const status = computeTradeStatusDirectMirror({ verdict: "ESTIMATED_OPTIONS", triggerState: "TRIGGERED" });
    expect(status).toBe("TRIGGERED");
  });

  it("STOCK + NO_TRIGGER still → TRADE_READY (regression guard)", () => {
    const status = computeTradeStatusDirectMirror({ verdict: "STOCK", triggerState: "NO_TRIGGER" });
    expect(status).toBe("TRADE_READY");
  });

  it("LIVE_OPTIONS + NO_TRIGGER still → TRADE_READY (regression guard)", () => {
    const status = computeTradeStatusDirectMirror({ verdict: "LIVE_OPTIONS", triggerState: "NO_TRIGGER" });
    expect(status).toBe("TRADE_READY");
  });
});

// ---------------------------------------------------------------------------
// §1 — buildCombinedAskAnswer output shape
// ---------------------------------------------------------------------------

describe("buildCombinedAskAnswer output shape", () => {
  it("T15: Case 1 (both succeed) includes analysisConfidence, canonicalTrigger, actionability", async () => {
    const result = makeBrainResult(makeAnalysis(), makeRec());
    const answer = await buildCombinedAskAnswer(result, null);

    // §4 confidence ownership
    expect(answer.confidence).toMatch(/^(low|medium|high)$/);
    expect(answer.analysisConfidence).toMatch(/^(low|medium|high)$/);

    // §2 canonical trigger (analysis trigger borrowed since rec has none)
    expect(answer.canonicalTrigger).not.toBeUndefined();
    expect(answer.canonicalTrigger?.price).toBeCloseTo(239.02, 1);
    expect(answer.canonicalTrigger?.source).toBe("analysis_primary");

    // §3 actionability model present
    expect(answer.actionability).toBeDefined();
    expect(answer.actionability?.optionsStructureEstimated).toBe(true);
    expect(answer.actionability?.tradeTicketReady).toBe(false);
    expect(answer.actionability?.cashRequirementVerified).toBe(false);

    // §3 actionability warning present in keyPoints
    const hasEstimatedWarning = answer.keyPoints.some((p) =>
      p.toLowerCase().includes("estimated")
    );
    expect(hasEstimatedWarning).toBe(true);

    // Both data sections present
    expect(answer.multiStrategyAnalysis).toBeDefined();
    expect(answer.strategyRecommendation).toBeDefined();
    expect(answer.recommendationFailed).toBeUndefined();
  });
});
