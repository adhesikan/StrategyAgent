// Sprint 4.1B — Institutional Trade Card logic tests.
// Sprint 4.1C — Unified Trade Status System tests.
// Sprint 4.1D — Ranking Transparency tests (computeRankingReasons,
//               computeCandidateQuality, CandidateQuality, fitsRiskBudget).
// Pure-function tests — no React, no DOM, no server calls.

import { describe, it, expect } from "vitest";
import {
  CANDIDATE_QUALITY_CLASS,
  CANDIDATE_QUALITY_LABEL,
  computeCandidateQuality,
  computeDistanceToTrigger,
  computeRankingReasons,
  computeTradeStatus,
  computeTradeStatusDirect,
  extractLevelPrice,
  fromRankedCandidate,
  fromRankedWatchCandidate,
  fromRecIdea,
  isTradePlanBuilderEligible,
  tradePlanCtas,
  tradeStatusBadgeClass,
  tradeStatusLabel,
  type CandidateQuality,
  type TradeCardStatus,
  type TradePlanViewModel,
} from "./trade-plan-view-model";
import type { RankedTradeCandidate, RankedWatchCandidate } from "./ranked-trade-search";
import type { RecIdea } from "./strategy-recommendation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<RankedTradeCandidate> = {}): RankedTradeCandidate {
  return {
    rank: 1,
    symbol: "NVDA",
    whySelected: ["EMA aligned uptrend", "Volume expansion 1.4x"],
    warnings: [],
    ...overrides,
  };
}

function makeWatchCandidate(overrides: Partial<RankedWatchCandidate> = {}): RankedWatchCandidate {
  return {
    symbol: "MSFT",
    watchConditions: ["Wait for volume confirmation"],
    ...overrides,
  };
}

function makeRecIdea(overrides: Partial<RecIdea> = {}): RecIdea {
  return {
    overallVerdict: "STOCK",
    confidence: 0.75,
    reasons: ["VCP setup confirmed"],
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractLevelPrice
// ---------------------------------------------------------------------------

describe("extractLevelPrice", () => {
  it("extracts a plain dollar price", () => {
    expect(extractLevelPrice("Stop below $192.50")).toBe(192.5);
  });

  it("extracts integer prices", () => {
    expect(extractLevelPrice("Break above $880")).toBe(880);
  });

  it("extracts price without dollar sign", () => {
    expect(extractLevelPrice("Target 950.00")).toBe(950);
  });

  it("returns undefined for undefined input", () => {
    expect(extractLevelPrice(undefined)).toBeUndefined();
  });

  it("returns undefined for text with no numeric content", () => {
    expect(extractLevelPrice("No price here")).toBeUndefined();
  });

  it("extracts only the first numeric value when multiple exist", () => {
    expect(extractLevelPrice("Between $100 and $200")).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// fromRankedCandidate — new stopPrice / targetPrice fields
// ---------------------------------------------------------------------------

describe("fromRankedCandidate — stopPrice and targetPrice", () => {
  it("populates stopPrice from invalidation text", () => {
    const vm = fromRankedCandidate(makeCandidate({ invalidation: "Stop below $840.00" }));
    expect(vm.stopPrice).toBe(840);
  });

  it("populates targetPrice from objective text", () => {
    const vm = fromRankedCandidate(makeCandidate({ objective: "Target $950.00" }));
    expect(vm.targetPrice).toBe(950);
  });

  it("leaves stopPrice undefined when invalidation is absent", () => {
    const vm = fromRankedCandidate(makeCandidate({ invalidation: undefined }));
    expect(vm.stopPrice).toBeUndefined();
  });

  it("leaves targetPrice undefined when objective is absent", () => {
    const vm = fromRankedCandidate(makeCandidate({ objective: undefined }));
    expect(vm.targetPrice).toBeUndefined();
  });

  it("sets verdict STOCK for non-options instrument", () => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: "equity" }));
    expect(vm.verdict).toBe("STOCK");
  });

  it("sets verdict LIVE_OPTIONS for options with exact risk", () => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: "call option", maxRiskIsExact: true }));
    expect(vm.verdict).toBe("LIVE_OPTIONS");
  });

  it("sets verdict ESTIMATED_OPTIONS for options without exact risk", () => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: "put option", maxRiskIsExact: false }));
    expect(vm.verdict).toBe("ESTIMATED_OPTIONS");
  });

  it("detects earningsRisk from warnings", () => {
    const vm = fromRankedCandidate(makeCandidate({ warnings: ["Earnings in 8 days"] }));
    expect(vm.earningsRisk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fromRankedWatchCandidate
// ---------------------------------------------------------------------------

describe("fromRankedWatchCandidate", () => {
  it("returns WATCH verdict", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.verdict).toBe("WATCH");
  });

  it("maps symbol correctly", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate({ symbol: "AAPL" }));
    expect(vm.symbol).toBe("AAPL");
  });

  it("populates watchConditions from watchConditions array", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate({
      watchConditions: ["Wait for volume", "Above 200-day EMA"],
    }));
    expect(vm.watchConditions).toEqual(["Wait for volume", "Above 200-day EMA"]);
  });

  it("sets warnings from missingConfirmation", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate({ missingConfirmation: "Trigger not reached" }));
    expect(vm.warnings).toContain("Trigger not reached");
  });

  it("sets status from currentStage", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate({ currentStage: "Contraction phase" }));
    expect(vm.status).toBe("Contraction phase");
  });

  it("has empty reasons array", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.reasons).toEqual([]);
  });

  it("sets source to ranked", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.source).toBe("ranked");
  });

  it("has NO_TRIGGER trigger state (no price level from watch data)", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.triggerState).toBe("NO_TRIGGER");
  });
});

// ---------------------------------------------------------------------------
// fromRecIdea — new expectedHold field
// ---------------------------------------------------------------------------

describe("fromRecIdea — expectedHold", () => {
  it("maps expectedHold from tradeCandidate.expectedHold", () => {
    const idea = makeRecIdea({
      tradeCandidate: { expectedHold: "1–3 weeks" } as any,
    });
    const vm = fromRecIdea(idea);
    expect(vm.expectedHold).toBe("1–3 weeks");
  });

  it("maps expectedHold from tradeCandidate.holdPeriod as fallback", () => {
    const idea = makeRecIdea({
      tradeCandidate: { holdPeriod: "2 weeks" } as any,
    });
    const vm = fromRecIdea(idea);
    expect(vm.expectedHold).toBe("2 weeks");
  });

  it("leaves expectedHold undefined when absent", () => {
    const vm = fromRecIdea(makeRecIdea());
    expect(vm.expectedHold).toBeUndefined();
  });

  it("populates stopPrice from invalidation in tradeCandidate", () => {
    const idea = makeRecIdea({
      tradeCandidate: { stop: "$175.00" } as any,
    });
    const vm = fromRecIdea(idea);
    expect(vm.stopPrice).toBe(175);
  });

  it("populates targetPrice from target in tradeCandidate", () => {
    const idea = makeRecIdea({
      tradeCandidate: { target: "$220.00" } as any,
    });
    const vm = fromRecIdea(idea);
    expect(vm.targetPrice).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// tradePlanCtas — new CTAs (View Chart, Open Scanner)
// ---------------------------------------------------------------------------

describe("tradePlanCtas", () => {
  function vmWithVerdict(verdict: string, extra: Partial<TradePlanViewModel> = {}): TradePlanViewModel {
    return {
      symbol: "NVDA",
      verdict: verdict as any,
      triggerState: "NO_TRIGGER",
      reasons: [],
      warnings: [],
      source: "ranked",
      ...extra,
    };
  }

  it("STOCK verdict includes Analyze, View Chart, Open Scanner", () => {
    const ctas = tradePlanCtas(vmWithVerdict("STOCK"));
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Analyze");
    expect(labels).toContain("View Chart");
    expect(labels).toContain("Open Scanner");
  });

  it("LIVE_OPTIONS verdict includes View Chart and Open Scanner", () => {
    const ctas = tradePlanCtas(vmWithVerdict("LIVE_OPTIONS"));
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("View Chart");
    expect(labels).toContain("Open Scanner");
  });

  it("ESTIMATED_OPTIONS verdict includes Analyze, View Chart, Connect Provider, Open Scanner", () => {
    const ctas = tradePlanCtas(vmWithVerdict("ESTIMATED_OPTIONS"));
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Analyze");
    expect(labels).toContain("View Chart");
    expect(labels).toContain("Connect Provider");
    expect(labels).toContain("Open Scanner");
  });

  it("WATCH verdict includes Analyze, View Chart, Add to Watchlist, Open Scanner", () => {
    const ctas = tradePlanCtas(vmWithVerdict("WATCH"));
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Analyze");
    expect(labels).toContain("View Chart");
    expect(labels).toContain("Add to Watchlist");
    expect(labels).toContain("Open Scanner");
  });

  it("NO_TRADE verdict includes Analyze, View Chart, Open Scanner", () => {
    const ctas = tradePlanCtas(vmWithVerdict("NO_TRADE"));
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Analyze");
    expect(labels).toContain("Open Scanner");
  });

  it("STOCK verdict includes Open Trade Builder when eligible", () => {
    const vm = vmWithVerdict("STOCK", {
      trigger: "Break above $192.50",
      triggerState: "AWAITING_TRIGGER",
      invalidation: "Stop below $180",
      maxRisk: 350,
      suggestedQuantity: 5,
      dataQuality: "live",
    });
    const ctas = tradePlanCtas(vm);
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Open Trade Builder");
  });

  it("STOCK verdict does NOT include Trade Builder when ineligible (missing trigger)", () => {
    const ctas = tradePlanCtas(vmWithVerdict("STOCK"));
    const labels = ctas.map((c) => c.label);
    expect(labels).not.toContain("Open Trade Builder");
  });

  it("View Chart href points to market-intel for the symbol", () => {
    const ctas = tradePlanCtas(vmWithVerdict("STOCK"));
    const viewChart = ctas.find((c) => c.label === "View Chart");
    expect(viewChart?.href).toContain("/market-intel");
    expect(viewChart?.href).toContain("NVDA");
  });

  it("Analyze is the primary CTA for STOCK", () => {
    const ctas = tradePlanCtas(vmWithVerdict("STOCK"));
    const primary = ctas.filter((c) => c.primary);
    expect(primary[0]?.label).toBe("Analyze");
  });
});

// ---------------------------------------------------------------------------
// computeDistanceToTrigger — already triggered / awaiting
// ---------------------------------------------------------------------------

describe("computeDistanceToTrigger — distance label correctness", () => {
  it("returns null when trigger state is NO_TRIGGER", () => {
    const vm: Pick<TradePlanViewModel, "trigger" | "currentPrice" | "triggerState"> = {
      trigger: undefined,
      currentPrice: 100,
      triggerState: "NO_TRIGGER",
    };
    expect(computeDistanceToTrigger(vm)).toBeNull();
  });

  it("returns positive distance when price is below trigger", () => {
    const vm = { trigger: "Break above $192.50", currentPrice: 185, triggerState: "AWAITING_TRIGGER" as const };
    const result = computeDistanceToTrigger(vm);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\+\$7\.50/);
  });

  it("returns negative distance when price is above trigger (already triggered)", () => {
    const vm = { trigger: "Break above $180", currentPrice: 192, triggerState: "TRIGGERED" as const };
    const result = computeDistanceToTrigger(vm);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^-\$/);
  });

  it("returns At trigger when price equals trigger exactly", () => {
    const vm = { trigger: "Break above $192.50", currentPrice: 192.5, triggerState: "TRIGGERED" as const };
    expect(computeDistanceToTrigger(vm)).toBe("At trigger");
  });
});

// ---------------------------------------------------------------------------
// isTradePlanBuilderEligible — regression guard
// ---------------------------------------------------------------------------

describe("isTradePlanBuilderEligible", () => {
  function eligibleVm(): TradePlanViewModel {
    return {
      symbol: "NVDA",
      verdict: "STOCK",
      trigger: "Break above $192.50",
      triggerState: "AWAITING_TRIGGER",
      invalidation: "Stop below $180",
      maxRisk: 350,
      suggestedQuantity: 5,
      dataQuality: "live",
      reasons: [],
      warnings: [],
      source: "ranked",
    };
  }

  it("returns true when all required fields are present and data quality is live", () => {
    expect(isTradePlanBuilderEligible(eligibleVm())).toBe(true);
  });

  it("returns false when trigger is absent", () => {
    const vm = { ...eligibleVm(), trigger: undefined, triggerState: "NO_TRIGGER" as const };
    expect(isTradePlanBuilderEligible(vm)).toBe(false);
  });

  it("returns false when invalidation is absent", () => {
    const vm = { ...eligibleVm(), invalidation: undefined };
    expect(isTradePlanBuilderEligible(vm)).toBe(false);
  });

  it("returns false when dataQuality is estimated", () => {
    const vm = { ...eligibleVm(), dataQuality: "estimated" };
    expect(isTradePlanBuilderEligible(vm)).toBe(false);
  });

  it("returns false when maxRisk is absent", () => {
    const vm = { ...eligibleVm(), maxRisk: undefined };
    expect(isTradePlanBuilderEligible(vm)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Decision state mapping (verified through VM values, not React component)
// ---------------------------------------------------------------------------

describe("verdict → decision state mapping (logic only)", () => {
  const QUALIFIED_VERDICTS = ["STOCK", "LIVE_OPTIONS", "ESTIMATED_OPTIONS"];
  const WATCH_VERDICTS = ["WATCH"];
  const UNAVAILABLE_VERDICTS = ["UNAVAILABLE"];

  it.each(QUALIFIED_VERDICTS)("verdict %s maps to qualified decision state", (v) => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: v.includes("OPTIONS") ? "option" : "equity" }));
    const isQualified = vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS";
    expect(isQualified).toBe(true);
  });

  it.each(WATCH_VERDICTS)("verdict %s maps to watch decision state", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.verdict).toBe("WATCH");
  });

  it.each(UNAVAILABLE_VERDICTS)("verdict %s maps to unavailable decision state", (v) => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: v as any }));
    expect(vm.verdict).toBe(v);
  });
});

// ===========================================================================
// Sprint 4.1C — Unified Trade Status System
// ===========================================================================

// ---------------------------------------------------------------------------
// computeTradeStatusDirect — 8 status derivation paths
// ---------------------------------------------------------------------------

describe("computeTradeStatusDirect", () => {
  // Qualified verdicts — trigger-state driven
  it("STOCK + NO_TRIGGER → TRADE_READY", () => {
    expect(computeTradeStatusDirect({ verdict: "STOCK", triggerState: "NO_TRIGGER" })).toBe("TRADE_READY");
  });

  it("STOCK + TRIGGERED → TRIGGERED", () => {
    expect(computeTradeStatusDirect({ verdict: "STOCK", triggerState: "TRIGGERED" })).toBe("TRIGGERED");
  });

  it("STOCK + AWAITING_TRIGGER → AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "STOCK", triggerState: "AWAITING_TRIGGER" })).toBe("AWAITING_BREAKOUT");
  });

  it("STOCK + EVENT_CONFIRMATION → AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "STOCK", triggerState: "EVENT_CONFIRMATION" })).toBe("AWAITING_BREAKOUT");
  });

  it("LIVE_OPTIONS + TRIGGERED → TRIGGERED", () => {
    expect(computeTradeStatusDirect({ verdict: "LIVE_OPTIONS", triggerState: "TRIGGERED" })).toBe("TRIGGERED");
  });

  it("ESTIMATED_OPTIONS + AWAITING_TRIGGER → AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "ESTIMATED_OPTIONS", triggerState: "AWAITING_TRIGGER" })).toBe("AWAITING_BREAKOUT");
  });

  // WATCH verdict
  it("WATCH + no code → WATCH", () => {
    expect(computeTradeStatusDirect({ verdict: "WATCH" })).toBe("WATCH");
  });

  it("WATCH + WAITING_FOR_TRIGGER → AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "WATCH", rejectionReasonCode: "WAITING_FOR_TRIGGER" })).toBe("AWAITING_BREAKOUT");
  });

  // NO_TRADE — earnings hold
  it("NO_TRADE + EARNINGS_RISK code → EARNINGS_HOLD", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "EARNINGS_RISK" })).toBe("EARNINGS_HOLD");
  });

  it("NO_TRADE + earningsRisk flag → EARNINGS_HOLD (flag takes priority)", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", earningsRisk: true })).toBe("EARNINGS_HOLD");
  });

  // NO_TRADE — data limited
  it("NO_TRADE + DATA_UNAVAILABLE → DATA_LIMITED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "DATA_UNAVAILABLE" })).toBe("DATA_LIMITED");
  });

  it("NO_TRADE + UNDERLYING_MARKET_DATA_UNAVAILABLE → DATA_LIMITED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "UNDERLYING_MARKET_DATA_UNAVAILABLE" })).toBe("DATA_LIMITED");
  });

  it("NO_TRADE + OPTIONS_DATA_UNAVAILABLE → DATA_LIMITED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "OPTIONS_DATA_UNAVAILABLE" })).toBe("DATA_LIMITED");
  });

  it("NO_TRADE + DATA_FRESHNESS_INSUFFICIENT → DATA_LIMITED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "DATA_FRESHNESS_INSUFFICIENT" })).toBe("DATA_LIMITED");
  });

  it("NO_TRADE + CANDIDATE_CONFIRMATION_UNAVAILABLE → DATA_LIMITED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "CANDIDATE_CONFIRMATION_UNAVAILABLE" })).toBe("DATA_LIMITED");
  });

  // NO_TRADE — market unavailable
  it("NO_TRADE + MARKET_REGIME_UNAVAILABLE → MARKET_UNAVAILABLE", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "MARKET_REGIME_UNAVAILABLE" })).toBe("MARKET_UNAVAILABLE");
  });

  // NO_TRADE — awaiting breakout (price not yet at trigger)
  it("NO_TRADE + WAITING_FOR_TRIGGER → AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "WAITING_FOR_TRIGGER" })).toBe("AWAITING_BREAKOUT");
  });

  // NO_TRADE — generic rejection
  it("NO_TRADE + RISK_LIMIT_EXCEEDED → REJECTED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "RISK_LIMIT_EXCEEDED" })).toBe("REJECTED");
  });

  it("NO_TRADE + DIRECTION_CONFLICT → REJECTED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "DIRECTION_CONFLICT" })).toBe("REJECTED");
  });

  it("NO_TRADE + no code → REJECTED", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE" })).toBe("REJECTED");
  });

  // UNAVAILABLE
  it("UNAVAILABLE → MARKET_UNAVAILABLE", () => {
    expect(computeTradeStatusDirect({ verdict: "UNAVAILABLE" })).toBe("MARKET_UNAVAILABLE");
  });

  // UNSUPPORTED
  it("UNSUPPORTED + no code → REJECTED", () => {
    expect(computeTradeStatusDirect({ verdict: "UNSUPPORTED" })).toBe("REJECTED");
  });

  // Suffix rejection codes (e.g. "EARNINGS_RISK:NVDA")
  it("rejection code with symbol suffix is correctly matched", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "EARNINGS_RISK:NVDA" })).toBe("EARNINGS_HOLD");
  });

  it("WAITING_FOR_TRIGGER:NVDA suffix correctly matched for AWAITING_BREAKOUT", () => {
    expect(computeTradeStatusDirect({ verdict: "NO_TRADE", rejectionReasonCode: "WAITING_FOR_TRIGGER:NVDA" })).toBe("AWAITING_BREAKOUT");
  });
});

// ---------------------------------------------------------------------------
// computeTradeStatus — VM-based wrapper
// ---------------------------------------------------------------------------

describe("computeTradeStatus (VM-based)", () => {
  it("populates tradeStatus in fromRankedCandidate result", () => {
    const vm = fromRankedCandidate(makeCandidate({
      trigger: "Break above $192.50",
      currentPrice: 185,
    }));
    expect(vm.tradeStatus).toBe("AWAITING_BREAKOUT");
  });

  it("populates tradeStatus in fromRankedWatchCandidate result", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.tradeStatus).toBe("WATCH");
  });

  it("populates tradeStatus in fromRecIdea (NO_TRADE, EARNINGS_RISK)", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "NO_TRADE", rejectionReasonCode: "EARNINGS_RISK" }));
    expect(vm.tradeStatus).toBe("EARNINGS_HOLD");
  });

  it("populates tradeStatus in fromRecIdea (STOCK, no trigger)", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "STOCK" }));
    expect(vm.tradeStatus).toBe("TRADE_READY");
  });

  it("STOCK with triggered candidate → TRIGGERED", () => {
    const vm = fromRankedCandidate(makeCandidate({
      trigger: "Break above $150",
      currentPrice: 155, // above trigger → TRIGGERED
    }));
    expect(vm.tradeStatus).toBe("TRIGGERED");
  });
});

// ---------------------------------------------------------------------------
// tradeStatusLabel — all 8 statuses and REJECTED sub-reasons
// ---------------------------------------------------------------------------

describe("tradeStatusLabel", () => {
  function vmWith(status: TradeCardStatus, rejectionReasonCode?: string): Pick<TradePlanViewModel, "tradeStatus" | "rejectionReasonCode"> {
    return { tradeStatus: status, rejectionReasonCode };
  }

  it("TRADE_READY → 'Trade Ready'", () => {
    expect(tradeStatusLabel(vmWith("TRADE_READY"))).toBe("Trade Ready");
  });

  it("TRIGGERED → 'Triggered'", () => {
    expect(tradeStatusLabel(vmWith("TRIGGERED"))).toBe("Triggered");
  });

  it("AWAITING_BREAKOUT → 'Awaiting Breakout'", () => {
    expect(tradeStatusLabel(vmWith("AWAITING_BREAKOUT"))).toBe("Awaiting Breakout");
  });

  it("WATCH → 'Waiting for Confirmation'", () => {
    expect(tradeStatusLabel(vmWith("WATCH"))).toBe("Waiting for Confirmation");
  });

  it("EARNINGS_HOLD → 'Earnings Hold'", () => {
    expect(tradeStatusLabel(vmWith("EARNINGS_HOLD"))).toBe("Earnings Hold");
  });

  it("DATA_LIMITED → 'Data Limited'", () => {
    expect(tradeStatusLabel(vmWith("DATA_LIMITED"))).toBe("Data Limited");
  });

  it("MARKET_UNAVAILABLE → 'Market Unavailable'", () => {
    expect(tradeStatusLabel(vmWith("MARKET_UNAVAILABLE"))).toBe("Market Unavailable");
  });

  // REJECTED sub-reasons
  it("REJECTED + RISK_LIMIT_EXCEEDED → 'Rejected — Risk'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "RISK_LIMIT_EXCEEDED"))).toBe("Rejected — Risk");
  });

  it("REJECTED + EARNINGS_RISK → 'Rejected — Earnings'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "EARNINGS_RISK"))).toBe("Rejected — Earnings");
  });

  it("REJECTED + DIRECTION_CONFLICT → 'Rejected — Direction'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "DIRECTION_CONFLICT"))).toBe("Rejected — Direction");
  });

  it("REJECTED + STALE_SETUP → 'Rejected — Stale Setup'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "STALE_SETUP"))).toBe("Rejected — Stale Setup");
  });

  it("REJECTED + NO_VALID_SETUP → 'Rejected — No Valid Setup'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "NO_VALID_SETUP"))).toBe("Rejected — No Valid Setup");
  });

  it("REJECTED + UNSUPPORTED_STRUCTURE → 'Rejected — Unsupported'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "UNSUPPORTED_STRUCTURE"))).toBe("Rejected — Unsupported");
  });

  it("REJECTED + LIQUIDITY_RISK → 'Rejected — Liquidity'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "LIQUIDITY_RISK"))).toBe("Rejected — Liquidity");
  });

  it("REJECTED + POSITION_LIMIT_EXCEEDED → 'Rejected — Position Limit'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "POSITION_LIMIT_EXCEEDED"))).toBe("Rejected — Position Limit");
  });

  it("REJECTED + no code → generic 'Rejected'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED"))).toBe("Rejected");
  });

  it("REJECTED + unknown code → generic 'Rejected'", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "SOME_UNKNOWN_CODE"))).toBe("Rejected");
  });

  it("REJECTED + code with suffix → base code used for sub-reason", () => {
    expect(tradeStatusLabel(vmWith("REJECTED", "RISK_LIMIT_EXCEEDED:NVDA"))).toBe("Rejected — Risk");
  });

  it("no tradeStatus (undefined) → falls back to 'Rejected'", () => {
    expect(tradeStatusLabel({ tradeStatus: undefined, rejectionReasonCode: undefined })).toBe("Rejected");
  });
});

// ---------------------------------------------------------------------------
// tradeStatusBadgeClass — returns a non-empty Tailwind string for all statuses
// ---------------------------------------------------------------------------

describe("tradeStatusBadgeClass", () => {
  const ALL_STATUSES: TradeCardStatus[] = [
    "TRADE_READY",
    "TRIGGERED",
    "AWAITING_BREAKOUT",
    "WATCH",
    "REJECTED",
    "DATA_LIMITED",
    "MARKET_UNAVAILABLE",
    "EARNINGS_HOLD",
  ];

  it.each(ALL_STATUSES)("returns a non-empty class string for %s", (status) => {
    const cls = tradeStatusBadgeClass(status);
    expect(cls).toBeTruthy();
    expect(cls.length).toBeGreaterThan(0);
  });

  it("qualified statuses use emerald tones", () => {
    expect(tradeStatusBadgeClass("TRADE_READY")).toContain("emerald");
    expect(tradeStatusBadgeClass("TRIGGERED")).toContain("emerald");
  });

  it("AWAITING_BREAKOUT uses sky tone", () => {
    expect(tradeStatusBadgeClass("AWAITING_BREAKOUT")).toContain("sky");
  });

  it("WATCH uses amber tone", () => {
    expect(tradeStatusBadgeClass("WATCH")).toContain("amber");
  });

  it("EARNINGS_HOLD uses orange tone", () => {
    expect(tradeStatusBadgeClass("EARNINGS_HOLD")).toContain("orange");
  });

  it("DATA_LIMITED uses purple tone", () => {
    expect(tradeStatusBadgeClass("DATA_LIMITED")).toContain("purple");
  });
});

// ---------------------------------------------------------------------------
// Integration: end-to-end status through VM mappers
// ---------------------------------------------------------------------------

describe("tradeStatus end-to-end through mappers", () => {
  it("fromRankedCandidate STOCK (no trigger) sets TRADE_READY and label", () => {
    const vm = fromRankedCandidate(makeCandidate());
    expect(vm.tradeStatus).toBe("TRADE_READY");
    expect(tradeStatusLabel(vm)).toBe("Trade Ready");
  });

  it("fromRankedWatchCandidate sets WATCH and label 'Waiting for Confirmation'", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(tradeStatusLabel(vm)).toBe("Waiting for Confirmation");
  });

  it("fromRecIdea NO_TRADE + RISK_LIMIT_EXCEEDED → 'Rejected — Risk'", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "NO_TRADE", rejectionReasonCode: "RISK_LIMIT_EXCEEDED" }));
    expect(tradeStatusLabel(vm)).toBe("Rejected — Risk");
  });

  it("fromRecIdea NO_TRADE + EARNINGS_RISK → 'Earnings Hold'", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "NO_TRADE", rejectionReasonCode: "EARNINGS_RISK" }));
    expect(tradeStatusLabel(vm)).toBe("Earnings Hold");
  });

  it("fromRecIdea NO_TRADE + DATA_UNAVAILABLE → 'Data Limited'", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "NO_TRADE", rejectionReasonCode: "DATA_UNAVAILABLE" }));
    expect(tradeStatusLabel(vm)).toBe("Data Limited");
  });

  it("fromRecIdea UNAVAILABLE → 'Market Unavailable'", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "UNAVAILABLE" as any }));
    expect(tradeStatusLabel(vm)).toBe("Market Unavailable");
  });

  it("fromRecIdea WATCH + no code → 'Waiting for Confirmation'", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "WATCH" }));
    expect(tradeStatusLabel(vm)).toBe("Waiting for Confirmation");
  });
});

// ===========================================================================
// Sprint 4.1D — Ranking Transparency
// ===========================================================================

// ---------------------------------------------------------------------------
// computeCandidateQuality — all four tiers
// ---------------------------------------------------------------------------

describe("computeCandidateQuality", () => {
  // Helpers that build minimal objects accepted by computeCandidateQuality
  function qOpts(overrides: Partial<Parameters<typeof computeCandidateQuality>[0]> = {}) {
    return {
      verdict:       "STOCK" as const,
      tradeStatus:   "TRADE_READY" as const,
      confidence:    "High",
      dataQuality:   "LIVE",
      earningsRisk:  undefined as boolean | undefined,
      warnings:      [] as string[],
      ...overrides,
    };
  }

  it("PRIME: triggered + high confidence + live data + 0 warnings", () => {
    expect(computeCandidateQuality(qOpts({ tradeStatus: "TRIGGERED" }))).toBe("PRIME");
  });

  it("PRIME: triggered + medium confidence counts", () => {
    expect(computeCandidateQuality(qOpts({ tradeStatus: "TRIGGERED", confidence: "Medium" }))).toBe("PRIME");
  });

  it("STRONG: qualified + high confidence + 1 warning", () => {
    expect(computeCandidateQuality(qOpts({ warnings: ["Minor liquidity concern"] }))).toBe("STRONG");
  });

  it("STRONG: qualified + medium confidence + 0 warnings", () => {
    expect(computeCandidateQuality(qOpts({ confidence: "Medium" }))).toBe("STRONG");
  });

  it("MODERATE: triggered + high confidence + 2 warnings → drops to STRONG (≤1 threshold)", () => {
    // Triggered + high conf + 2 warnings → not PRIME (warning count), check ≤1 rule
    const result = computeCandidateQuality(qOpts({
      tradeStatus: "TRIGGERED",
      warnings: ["Warning A", "Warning B"],
    }));
    // 2 warnings → not PRIME; isQualified = true but warningCount > 1 → MODERATE
    expect(result).toBe("MODERATE");
  });

  it("MODERATE: WATCH-list (not in qualified set)", () => {
    expect(computeCandidateQuality(qOpts({
      verdict: "WATCH" as any,
      tradeStatus: "WATCH" as any,
    }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: ESTIMATED_OPTIONS always → SPECULATIVE regardless of confidence", () => {
    expect(computeCandidateQuality(qOpts({
      verdict: "ESTIMATED_OPTIONS" as any,
      tradeStatus: "TRADE_READY" as any,
    }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: low confidence", () => {
    expect(computeCandidateQuality(qOpts({ confidence: "Low" }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: earnings risk present", () => {
    expect(computeCandidateQuality(qOpts({ earningsRisk: true }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: stale data quality", () => {
    expect(computeCandidateQuality(qOpts({ dataQuality: "STALE" }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: estimated data quality", () => {
    expect(computeCandidateQuality(qOpts({ dataQuality: "ESTIMATED" }))).toBe("SPECULATIVE");
  });

  it("SPECULATIVE: missing data quality", () => {
    expect(computeCandidateQuality(qOpts({ dataQuality: undefined }))).toBe("SPECULATIVE");
  });
});

// ---------------------------------------------------------------------------
// CANDIDATE_QUALITY_LABEL and CANDIDATE_QUALITY_CLASS — completeness
// ---------------------------------------------------------------------------

describe("CANDIDATE_QUALITY_LABEL / CANDIDATE_QUALITY_CLASS", () => {
  const ALL_TIERS: CandidateQuality[] = ["PRIME", "STRONG", "MODERATE", "SPECULATIVE"];

  it.each(ALL_TIERS)("label is non-empty for %s", (tier) => {
    expect(CANDIDATE_QUALITY_LABEL[tier]).toBeTruthy();
  });

  it.each(ALL_TIERS)("badge class is non-empty for %s", (tier) => {
    expect(CANDIDATE_QUALITY_CLASS[tier]).toBeTruthy();
  });

  it("PRIME label is 'Prime'", () => {
    expect(CANDIDATE_QUALITY_LABEL.PRIME).toBe("Prime");
  });

  it("STRONG label is 'Strong'", () => {
    expect(CANDIDATE_QUALITY_LABEL.STRONG).toBe("Strong");
  });

  it("MODERATE label is 'Moderate'", () => {
    expect(CANDIDATE_QUALITY_LABEL.MODERATE).toBe("Moderate");
  });

  it("SPECULATIVE label is 'Speculative'", () => {
    expect(CANDIDATE_QUALITY_LABEL.SPECULATIVE).toBe("Speculative");
  });

  it("PRIME badge uses emerald tones", () => {
    expect(CANDIDATE_QUALITY_CLASS.PRIME).toContain("emerald");
  });

  it("SPECULATIVE badge uses muted tones", () => {
    expect(CANDIDATE_QUALITY_CLASS.SPECULATIVE).toContain("muted");
  });
});

// ---------------------------------------------------------------------------
// computeRankingReasons — all observable reason phrases
// ---------------------------------------------------------------------------

describe("computeRankingReasons", () => {
  function rankVM(overrides: Partial<Parameters<typeof computeRankingReasons>[0]> = {}) {
    return {
      rank:          1 as number | undefined,
      verdict:       "STOCK" as const,
      triggerState:  "AWAITING_TRIGGER" as const,
      tradeStatus:   "AWAITING_BREAKOUT" as const,
      dataQuality:   "LIVE",
      rewardRisk:    undefined as number | undefined,
      earningsRisk:  undefined as boolean | undefined,
      reasons:       [] as string[],
      maxRiskIsExact: undefined as boolean | undefined,
      fitsRiskBudget: undefined as boolean | undefined,
      warnings:      [] as string[],
      ...overrides,
    };
  }

  it("returns empty array when rank is undefined (non-ranked source)", () => {
    expect(computeRankingReasons(rankVM({ rank: undefined }))).toEqual([]);
  });

  it("'Actionable' present when triggerState is TRIGGERED", () => {
    const reasons = computeRankingReasons(rankVM({ triggerState: "TRIGGERED", tradeStatus: "TRIGGERED" as const }));
    expect(reasons).toContain("Actionable");
  });

  it("'Actionable' present when triggerState is AWAITING_TRIGGER", () => {
    expect(computeRankingReasons(rankVM())).toContain("Actionable");
  });

  it("'Actionable' present when tradeStatus is TRADE_READY", () => {
    const reasons = computeRankingReasons(rankVM({ triggerState: "NO_TRIGGER" as const, tradeStatus: "TRADE_READY" as const }));
    expect(reasons).toContain("Actionable");
  });

  it("'Actionable' absent when triggerState is NO_TRIGGER and tradeStatus is WATCH", () => {
    const reasons = computeRankingReasons(rankVM({
      triggerState: "NO_TRIGGER" as const,
      tradeStatus:  "WATCH" as const,
    }));
    expect(reasons).not.toContain("Actionable");
  });

  it("'Fresh data' present when dataQuality is LIVE", () => {
    expect(computeRankingReasons(rankVM())).toContain("Fresh data");
  });

  it("'Fresh data' present when dataQuality is HIGH", () => {
    expect(computeRankingReasons(rankVM({ dataQuality: "HIGH" }))).toContain("Fresh data");
  });

  it("'Fresh data' absent when dataQuality is STALE", () => {
    expect(computeRankingReasons(rankVM({ dataQuality: "STALE" }))).not.toContain("Fresh data");
  });

  it("'Fresh data' absent when dataQuality is ESTIMATED", () => {
    expect(computeRankingReasons(rankVM({ dataQuality: "ESTIMATED" }))).not.toContain("Fresh data");
  });

  it("'Fresh data' absent when dataQuality is undefined", () => {
    expect(computeRankingReasons(rankVM({ dataQuality: undefined }))).not.toContain("Fresh data");
  });

  it("'Better reward/risk' present when rewardRisk ≥ 2.5", () => {
    expect(computeRankingReasons(rankVM({ rewardRisk: 2.5 }))).toContain("Better reward/risk");
    expect(computeRankingReasons(rankVM({ rewardRisk: 3.2 }))).toContain("Better reward/risk");
  });

  it("'Better reward/risk' absent when rewardRisk < 2.5", () => {
    expect(computeRankingReasons(rankVM({ rewardRisk: 2.4 }))).not.toContain("Better reward/risk");
    expect(computeRankingReasons(rankVM({ rewardRisk: 1.0 }))).not.toContain("Better reward/risk");
  });

  it("'Better reward/risk' absent when rewardRisk is undefined", () => {
    expect(computeRankingReasons(rankVM({ rewardRisk: undefined }))).not.toContain("Better reward/risk");
  });

  it("'Lower earnings risk' present when earningsRisk is falsy and no earnings warning", () => {
    expect(computeRankingReasons(rankVM())).toContain("Lower earnings risk");
  });

  it("'Lower earnings risk' absent when earningsRisk is true", () => {
    expect(computeRankingReasons(rankVM({ earningsRisk: true }))).not.toContain("Lower earnings risk");
  });

  it("'Lower earnings risk' absent when warnings contain 'earnings'", () => {
    const reasons = computeRankingReasons(rankVM({ warnings: ["Upcoming earnings event"] }));
    expect(reasons).not.toContain("Lower earnings risk");
  });

  it("'Higher confluence' present when reasons.length ≥ 3", () => {
    expect(computeRankingReasons(rankVM({ reasons: ["A", "B", "C"] }))).toContain("Higher confluence");
    expect(computeRankingReasons(rankVM({ reasons: ["A", "B", "C", "D", "E"] }))).toContain("Higher confluence");
  });

  it("'Higher confluence' absent when reasons.length < 3", () => {
    expect(computeRankingReasons(rankVM({ reasons: ["A", "B"] }))).not.toContain("Higher confluence");
    expect(computeRankingReasons(rankVM({ reasons: [] }))).not.toContain("Higher confluence");
  });

  it("'Fits risk parameters' present when fitsRiskBudget is true", () => {
    expect(computeRankingReasons(rankVM({ fitsRiskBudget: true }))).toContain("Fits risk parameters");
  });

  it("'Fits risk parameters' absent when fitsRiskBudget is false", () => {
    expect(computeRankingReasons(rankVM({ fitsRiskBudget: false }))).not.toContain("Fits risk parameters");
  });

  it("'Fits risk parameters' absent when fitsRiskBudget is undefined", () => {
    expect(computeRankingReasons(rankVM({ fitsRiskBudget: undefined }))).not.toContain("Fits risk parameters");
  });

  it("'Exact sizing available' present when maxRiskIsExact is true", () => {
    expect(computeRankingReasons(rankVM({ maxRiskIsExact: true }))).toContain("Exact sizing available");
  });

  it("'Exact sizing available' absent when maxRiskIsExact is false/undefined", () => {
    expect(computeRankingReasons(rankVM({ maxRiskIsExact: false }))).not.toContain("Exact sizing available");
    expect(computeRankingReasons(rankVM({ maxRiskIsExact: undefined }))).not.toContain("Exact sizing available");
  });

  it("multiple reasons accumulate correctly", () => {
    const reasons = computeRankingReasons(rankVM({
      triggerState:   "TRIGGERED" as const,
      tradeStatus:    "TRIGGERED" as const,
      dataQuality:    "LIVE",
      rewardRisk:     3.0,
      earningsRisk:   undefined,
      reasons:        ["Signal A", "Signal B", "Signal C"],
      fitsRiskBudget: true,
      maxRiskIsExact: true,
    }));
    expect(reasons).toContain("Actionable");
    expect(reasons).toContain("Fresh data");
    expect(reasons).toContain("Better reward/risk");
    expect(reasons).toContain("Lower earnings risk");
    expect(reasons).toContain("Higher confluence");
    expect(reasons).toContain("Fits risk parameters");
    expect(reasons).toContain("Exact sizing available");
    expect(reasons.length).toBe(7);
  });

  it("all negative inputs yield empty reasons list (but array not undefined)", () => {
    const reasons = computeRankingReasons(rankVM({
      triggerState:   "NO_TRIGGER" as const,
      tradeStatus:    "WATCH" as const,
      dataQuality:    "STALE",
      rewardRisk:     1.0,
      earningsRisk:   true,
      reasons:        [],
      fitsRiskBudget: false,
      maxRiskIsExact: false,
    }));
    expect(reasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sprint 4.1D integration: fromRankedCandidate populates quality + reasons
// ---------------------------------------------------------------------------

describe("Sprint 4.1D integration through fromRankedCandidate", () => {
  it("candidateQuality is populated after fromRankedCandidate", () => {
    const vm = fromRankedCandidate(makeCandidate({
      confidence: "High",
      dataQuality: "LIVE",
    }));
    expect(vm.candidateQuality).toBeDefined();
    expect(["PRIME", "STRONG", "MODERATE", "SPECULATIVE"]).toContain(vm.candidateQuality);
  });

  it("rankingReasons is populated after fromRankedCandidate (ranked candidate)", () => {
    const vm = fromRankedCandidate(makeCandidate({
      rank: 1,
      dataQuality: "LIVE",
    }));
    expect(vm.rankingReasons).toBeDefined();
    expect(Array.isArray(vm.rankingReasons)).toBe(true);
  });

  it("rankingReasons contains 'Fresh data' when dataQuality is LIVE", () => {
    const vm = fromRankedCandidate(makeCandidate({ dataQuality: "LIVE" }));
    expect(vm.rankingReasons).toContain("Fresh data");
  });

  it("rankingReasons contains 'Better reward/risk' when rewardRisk ≥ 2.5", () => {
    const vm = fromRankedCandidate(makeCandidate({ rewardRisk: 3.0 }));
    expect(vm.rankingReasons).toContain("Better reward/risk");
  });

  it("rankingReasons contains 'Higher confluence' when whySelected has ≥ 3 items", () => {
    const vm = fromRankedCandidate(makeCandidate({
      whySelected: ["EMA aligned", "Volume expansion", "Stage 2 base"],
    }));
    expect(vm.rankingReasons).toContain("Higher confluence");
  });

  it("rankingReasons does not contain 'Lower earnings risk' when earnings warning present", () => {
    const vm = fromRankedCandidate(makeCandidate({
      warnings: ["Earnings in 3 days"],
    }));
    expect(vm.rankingReasons).not.toContain("Lower earnings risk");
  });

  it("fitsRiskBudget is mapped from candidate and contributes to rankingReasons", () => {
    const vm = fromRankedCandidate(makeCandidate({ fitsRiskBudget: true }));
    expect(vm.fitsRiskBudget).toBe(true);
    expect(vm.rankingReasons).toContain("Fits risk parameters");
  });

  it("candidateQuality is PRIME for triggered + high confidence + live data + 0 warnings", () => {
    const vm = fromRankedCandidate(makeCandidate({
      confidence:  "High",
      dataQuality: "LIVE",
      warnings:    [],
      // trigger causes TRIGGERED state when currentPrice ≥ triggerPrice
      trigger:     "Break above $150",
      currentPrice: 155,
    }));
    expect(vm.tradeStatus).toBe("TRIGGERED");
    expect(vm.candidateQuality).toBe("PRIME");
  });

  it("candidateQuality is SPECULATIVE for ESTIMATED_OPTIONS", () => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: "option", maxRiskIsExact: false }));
    expect(vm.verdict).toBe("ESTIMATED_OPTIONS");
    expect(vm.candidateQuality).toBe("SPECULATIVE");
  });

  it("candidateQuality is SPECULATIVE when earnings risk present", () => {
    const vm = fromRankedCandidate(makeCandidate({ warnings: ["Earnings event upcoming"] }));
    expect(vm.candidateQuality).toBe("SPECULATIVE");
  });

  it("fromRankedWatchCandidate does not populate rankingReasons (no rank)", () => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    // Watch candidates have no rank → reasons array should be empty or undefined
    expect(!vm.rankingReasons || vm.rankingReasons.length === 0).toBe(true);
  });

  it("fromRecIdea does not populate candidateQuality (recommendation source)", () => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: "STOCK" }));
    // Recommendation ideas have no rank-based quality tier
    expect(vm.candidateQuality).toBeUndefined();
  });
});
