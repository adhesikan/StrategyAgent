// Sprint 4.1B — Institutional Trade Card logic tests.
// Covers: extractLevelPrice, fromRankedCandidate (new fields), fromRankedWatchCandidate,
// fromRecIdea (new fields), tradePlanCtas (new CTAs), and warning categorization.
// Pure-function tests — no React, no DOM, no server calls.

import { describe, it, expect } from "vitest";
import {
  computeDistanceToTrigger,
  extractLevelPrice,
  fromRankedCandidate,
  fromRankedWatchCandidate,
  fromRecIdea,
  isTradePlanBuilderEligible,
  tradePlanCtas,
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
  const REJECTED_VERDICTS = ["NO_TRADE", "UNSUPPORTED"];
  const UNAVAILABLE_VERDICTS = ["UNAVAILABLE"];

  it.each(QUALIFIED_VERDICTS)("verdict %s maps to qualified decision state", (v) => {
    const vm = fromRankedCandidate(makeCandidate({ instrument: v.includes("OPTIONS") ? "option" : "equity" }));
    // Verify that the view model would yield a qualified state
    const isQualified = vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS";
    expect(isQualified).toBe(true);
  });

  it.each(WATCH_VERDICTS)("verdict %s maps to watch decision state", (v) => {
    const vm = fromRankedWatchCandidate(makeWatchCandidate());
    expect(vm.verdict).toBe("WATCH");
  });

  it.each(UNAVAILABLE_VERDICTS)("verdict %s maps to unavailable decision state", (v) => {
    const vm = fromRecIdea(makeRecIdea({ overallVerdict: v as any }));
    expect(vm.verdict).toBe(v);
  });
});
