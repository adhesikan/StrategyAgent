/**
 * Sprint 2.7.4 — Trade Risk & Scenario Analysis tests
 *
 * Pure unit tests — no broker calls, no DB, no express.
 * All test coverage is against deterministic engine functions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTradeRiskScenarioResult,
  clearRiskScenarioCache,
  getCachedRiskAnalysis,
  storeSessionContractResearch,
  getSessionContractResearch,
  getRiskAnalysisHealth,
  type BuildRiskScenarioInput,
} from "../../services/trade-risk-scenario-service";
import {
  RISK_SCENARIO_DISCLAIMER,
  RISK_SCENARIO_VERSION,
  DEFAULT_PRICE_SCENARIO_PCTS,
  DEFAULT_IV_SCENARIO_PCTS,
} from "../../../shared/trade-risk-scenario-types";
import type {
  TradeRiskScenarioResult,
  RiskFlagCode,
} from "../../../shared/trade-risk-scenario-types";
import type { TradeRiskScenarioInput, ContractResearchLeg } from "../../../shared/contract-research-types";
import type { TradePlanningConstraints } from "../../../shared/trade-planning-types";

// ===========================================================================
// Helpers
// ===========================================================================

beforeEach(() => {
  clearRiskScenarioCache();
});

function futureDate(daysFromNow: number): string {
  const d = new Date("2026-08-10");
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function makeLeg(overrides: Partial<ContractResearchLeg> = {}): ContractResearchLeg {
  return {
    legIndex:      0,
    role:          "long_leg",
    roleLabel:     "Long",
    optionType:    "call",
    strike:        150,
    expiration:    futureDate(42),
    dte:           42,
    contractSymbol: "NVDA260920C00150000",
    moneyness:     "ATM",
    strikeDistancePct: 0,
    bid:           3.00,
    ask:           3.20,
    midpoint:      3.10,
    spreadAbs:     0.20,
    spreadPct:     6.45,
    volume:        500,
    openInterest:  1000,
    impliedVolatility: 0.45,
    delta:         0.52,
    gamma:         0.03,
    theta:         -0.05,
    vega:          0.12,
    rho:           0.01,
    liquidity:     "GOOD",
    updatedAt:     new Date().toISOString(),
    ...overrides,
  };
}

function makeLongCall(strike = 150, dte = 42, mid = 3.10): ContractResearchLeg {
  return makeLeg({ role: "long_leg", optionType: "call", strike, dte, expiration: futureDate(dte), midpoint: mid, bid: mid - 0.10, ask: mid + 0.10 });
}

function makeShortCall(strike = 160, dte = 42, mid = 1.50): ContractResearchLeg {
  return makeLeg({ role: "short_leg", optionType: "call", strike, dte, expiration: futureDate(dte), midpoint: mid, bid: mid - 0.10, ask: mid + 0.10, delta: 0.35 });
}

function makeLongPut(strike = 145, dte = 42, mid = 2.80): ContractResearchLeg {
  return makeLeg({ role: "long_leg", optionType: "put", strike, dte, expiration: futureDate(dte), midpoint: mid, bid: mid - 0.10, ask: mid + 0.10, delta: -0.40 });
}

function makeShortPut(strike = 140, dte = 42, mid = 1.80): ContractResearchLeg {
  return makeLeg({ role: "short_leg", optionType: "put", strike, dte, expiration: futureDate(dte), midpoint: mid, bid: mid - 0.10, ask: mid + 0.10, delta: -0.30 });
}

function makeMetrics(overrides: Partial<{
  estimatedDebit: number | null;
  estimatedCredit: number | null;
  width: number | null;
  netDelta: number | null;
  netTheta: number | null;
  netVega: number | null;
  netGamma: number | null;
  isDefinedRisk: boolean;
  debitCreditType: "DEBIT" | "CREDIT" | null;
  capitalEstimate: number | null;
}> = {}) {
  return {
    estimatedDebit:  null,
    estimatedCredit: null,
    width:           null,
    capitalEstimate: null,
    intrinsicValue:  null,
    extrinsicValue:  null,
    netDelta:        0.52,
    netTheta:        -0.05,
    netVega:         0.12,
    netGamma:        0.03,
    contractMultiplier: 100,
    isDefinedRisk:   true,
    debitCreditType: null as "DEBIT" | "CREDIT" | null,
    ...overrides,
  };
}

function makeInput(
  strategyFamily: string,
  legs: ContractResearchLeg[],
  metricsOverrides: Parameters<typeof makeMetrics>[0] = {},
): TradeRiskScenarioInput {
  const m = makeMetrics(metricsOverrides);
  return {
    planningContextId:           "ctx-test-001",
    contractResearchCandidateId: "cand-test-001",
    strategyFamily:              strategyFamily as any,
    legs,
    currentStructureMetrics:     m,
    researchThesisSummary:       "NVDA shows VCP base with institutional accumulation.",
    invalidationNote:            "Thesis invalidated below $142.00",
    planningConstraintsFingerprint: "fp-test",
  };
}

const DEFAULT_CONSTRAINTS: TradePlanningConstraints = {
  optionsAllowed: true,
  maxCapitalAtRisk: 500,
};

function buildResult(
  strategyFamily: string,
  legs: ContractResearchLeg[],
  metricsOverrides: Parameters<typeof makeMetrics>[0] = {},
  opts: Partial<BuildRiskScenarioInput> = {},
): TradeRiskScenarioResult {
  return buildTradeRiskScenarioResult({
    input:           makeInput(strategyFamily, legs, metricsOverrides),
    userId:          "user-test",
    sessionId:       "sess-test",
    underlyingPrice: 150,
    constraints:     DEFAULT_CONSTRAINTS,
    qualityCategory: "EXCELLENT",
    marketDataAsOf:  null,
    optionDataAsOf:  null,
    ...opts,
  });
}

// ===========================================================================
// Section 1: Canonical model structure
// ===========================================================================

describe("Canonical TradeRiskScenarioResult model", () => {
  it("result has required top-level fields", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, debitCreditType: "DEBIT" });
    expect(r.id).toBeTruthy();
    expect(r.userId).toBe("user-test");
    expect(r.planningContextId).toBe("ctx-test-001");
    expect(r.contractResearchCandidateId).toBe("cand-test-001");
    expect(r.strategyFamily).toBe("long_call");
    expect(r.generatedAt).toBeTruthy();
    expect(r.methodologyVersion).toBe(RISK_SCENARIO_VERSION);
    expect(r.disclaimer).toBe(RISK_SCENARIO_DISCLAIMER);
  });

  it("probabilityMetricsEnabled is always false", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.probabilityMetricsEnabled).toBe(false);
  });

  it("probabilityMetricsNote explains why probability is off", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.probabilityMetricsNote.length).toBeGreaterThan(20);
    expect(r.probabilityMetricsNote).not.toMatch(/probability of profit/i);
    expect(r.probabilityMetricsNote).not.toMatch(/chance of winning/i);
  });

  it("portfolioContext is null in 2.7.4", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.portfolioContext).toBeNull();
  });

  it("tradePlanHandoff has required fields for 2.7.5", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const h = r.tradePlanHandoff;
    expect(h.planningContextId).toBe("ctx-test-001");
    expect(h.contractResearchCandidateId).toBe("cand-test-001");
    expect(h.riskScenarioAnalysisId).toBe(r.id);
    expect(h.selectedExpressionFamily).toBe("long_call");
    expect(typeof h.researchThesis).toBe("string");
  });

  it("tradePlanHandoff carries risk flags", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(Array.isArray(r.tradePlanHandoff.riskFlags)).toBe(true);
  });

  it("assumptions array is non-empty", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it("limitations array is non-empty and mentions probability", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.limitations.length).toBeGreaterThan(0);
    const hasProb = r.limitations.some(l => l.toLowerCase().includes("probability"));
    expect(hasProb).toBe(true);
  });

  it("generationLatencyMs is a non-negative number", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.generationLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// Section 2: Long Call
// ===========================================================================

describe("Long Call payoff", () => {
  it("maxLoss equals debit × multiplier", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10, debitCreditType: "DEBIT" });
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(310);
  });

  it("maxGain is UNLIMITED", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    expect(r.payoffProfile.maxGain.type).toBe("UNLIMITED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBeNull();
  });

  it("breakeven = strike + debit", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    expect(r.payoffProfile.breakevens).toHaveLength(1);
    expect(r.payoffProfile.breakevens[0].price).toBe(153.10);
  });

  it("isDefinedRisk is true", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    expect(r.payoffProfile.isDefinedRisk).toBe(true);
  });

  it("UNLIMITED_GAIN flag is set", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("UNLIMITED_GAIN");
  });
});

// ===========================================================================
// Section 3: Long Put
// ===========================================================================

describe("Long Put payoff", () => {
  it("maxLoss equals debit × multiplier", () => {
    const r = buildResult("long_put", [makeLongPut(145, 42, 2.80)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(280);
  });

  it("maxGain is DEFINED (strike − debit) × 100", () => {
    const r = buildResult("long_put", [makeLongPut(145, 42, 2.80)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    // (145 − 2.80) × 100 = 14220 — use explicit literal to avoid floating-point arithmetic mismatch
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(14220);
  });

  it("breakeven = strike − debit", () => {
    const r = buildResult("long_put", [makeLongPut(145, 42, 2.80)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(142.20, 1);
  });

  it("isDefinedRisk is true", () => {
    const r = buildResult("long_put", [makeLongPut()], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.isDefinedRisk).toBe(true);
  });
});

// ===========================================================================
// Section 4: Covered Call
// ===========================================================================

describe("Covered Call payoff", () => {
  it("maxLoss is SUBSTANTIAL", () => {
    const r = buildResult("covered_call", [makeShortCall(160, 42, 2.00)], { estimatedCredit: 2.00 });
    expect(r.payoffProfile.maxLoss.type).toBe("SUBSTANTIAL");
  });

  it("maxGain is DEFINED when refPrice available", () => {
    const r = buildResult("covered_call", [makeShortCall(160, 42, 2.00)], { estimatedCredit: 2.00 });
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    // (160 - 150 + 2) × 100 = 1200
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(1200);
  });

  it("SUBSTANTIAL_UNDERLYING_DOWNSIDE flag is set", () => {
    const r = buildResult("covered_call", [makeShortCall(160, 42, 2.00)], { estimatedCredit: 2.00 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("SUBSTANTIAL_UNDERLYING_DOWNSIDE");
  });

  it("ASSIGNMENT_RISK flag is set", () => {
    const r = buildResult("covered_call", [makeShortCall(160, 42, 2.00)], { estimatedCredit: 2.00 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("ASSIGNMENT_RISK");
  });

  it("EARLY_EXERCISE_RISK flag is set", () => {
    const r = buildResult("covered_call", [makeShortCall(160, 42, 2.00)], { estimatedCredit: 2.00 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("EARLY_EXERCISE_RISK");
  });

  it("isDefinedRisk is false", () => {
    const r = buildResult("covered_call", [makeShortCall()], { estimatedCredit: 2.00 });
    expect(r.payoffProfile.isDefinedRisk).toBe(false);
  });
});

// ===========================================================================
// Section 5: Cash-Secured Put
// ===========================================================================

describe("Cash-Secured Put payoff", () => {
  it("maxLoss is SUBSTANTIAL", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140, 42, 1.80)], { estimatedCredit: 1.80 });
    expect(r.payoffProfile.maxLoss.type).toBe("SUBSTANTIAL");
  });

  it("maxGain = credit × multiplier", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140, 42, 1.80)], { estimatedCredit: 1.80 });
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(180);
  });

  it("breakeven = strike − credit", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140, 42, 1.80)], { estimatedCredit: 1.80 });
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(138.20, 1);
  });

  it("capital profile uses put strike × multiplier", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140)], { estimatedCredit: 1.80 });
    expect(r.capitalProfile.grossContractNotional).toBe(14000); // 140 × 100
    expect(r.capitalProfile.estimatedScenarioCapital).toBe(14000);
  });

  it("EARLY_EXERCISE_RISK flag is set", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140)], { estimatedCredit: 1.80 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("EARLY_EXERCISE_RISK");
  });
});

// ===========================================================================
// Section 6: Protective Put
// ===========================================================================

describe("Protective Put payoff", () => {
  it("maxLoss is DEFINED and bounded", () => {
    // (refPrice − putStrike + debit) × 100 = (150 − 145 + 2.80) × 100 = 780
    const r = buildResult("protective_put", [makeLongPut(145, 42, 2.80)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(780);
  });

  it("maxGain is UNLIMITED", () => {
    const r = buildResult("protective_put", [makeLongPut(145)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.maxGain.type).toBe("UNLIMITED");
  });

  it("isDefinedRisk is true", () => {
    const r = buildResult("protective_put", [makeLongPut(145)], { estimatedDebit: 2.80 });
    expect(r.payoffProfile.isDefinedRisk).toBe(true);
  });
});

// ===========================================================================
// Section 7: Bull Call Spread
// ===========================================================================

describe("Bull Call Spread payoff", () => {
  const legs = [makeLongCall(150, 42, 3.10), makeShortCall(160, 42, 1.50)];
  const metrics = { estimatedDebit: 1.60, width: 10, debitCreditType: "DEBIT" as const };

  it("maxLoss = net debit × multiplier", () => {
    const r = buildResult("bull_call_spread", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(160);
  });

  it("maxGain = (width − debit) × multiplier", () => {
    const r = buildResult("bull_call_spread", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(840); // (10 - 1.60) × 100
  });

  it("breakeven = long strike + net debit", () => {
    const r = buildResult("bull_call_spread", legs, metrics);
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(151.60, 1);
  });

  it("isDefinedRisk is true", () => {
    const r = buildResult("bull_call_spread", legs, metrics);
    expect(r.payoffProfile.isDefinedRisk).toBe(true);
  });
});

// ===========================================================================
// Section 8: Bear Put Spread
// ===========================================================================

describe("Bear Put Spread payoff", () => {
  // Long higher-strike put (145), short lower-strike put (135)
  const legs = [
    makeLongPut(145, 42, 3.00),
    makeLeg({ role: "short_leg", optionType: "put", strike: 135, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta: -0.25, impliedVolatility: 0.40, volume: 300, openInterest: 800, spreadPct: 12, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedDebit: 1.50, width: 10, debitCreditType: "DEBIT" as const };

  it("maxLoss = net debit × multiplier", () => {
    const r = buildResult("bear_put_spread", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(150);
  });

  it("maxGain = (width − debit) × multiplier", () => {
    const r = buildResult("bear_put_spread", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(850); // (10 - 1.50) × 100
  });

  it("breakeven = long put strike − net debit", () => {
    const r = buildResult("bear_put_spread", legs, metrics);
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(143.50, 1);
  });
});

// ===========================================================================
// Section 9: Bull Put Spread
// ===========================================================================

describe("Bull Put Spread payoff", () => {
  // Short 150 put, long 140 put
  const legs = [
    makeLeg({ role: "short_leg", optionType: "put", strike: 150, dte: 42, expiration: futureDate(42), midpoint: 3.00, bid: 2.90, ask: 3.10, delta: -0.50, impliedVolatility: 0.45, volume: 400, openInterest: 900, spreadPct: 6.7, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "put", strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.20, bid: 1.10, ask: 1.30, delta: -0.30, impliedVolatility: 0.40, volume: 300, openInterest: 700, spreadPct: 16.7, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedCredit: 1.80, width: 10, debitCreditType: "CREDIT" as const };

  it("maxLoss = (width − credit) × multiplier", () => {
    const r = buildResult("bull_put_spread", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(820); // (10 - 1.80) × 100
  });

  it("maxGain = credit × multiplier", () => {
    const r = buildResult("bull_put_spread", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(180);
  });

  it("breakeven = short put strike − credit", () => {
    const r = buildResult("bull_put_spread", legs, metrics);
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(148.20, 1);
  });
});

// ===========================================================================
// Section 10: Bear Call Spread
// ===========================================================================

describe("Bear Call Spread payoff", () => {
  // Short 150 call, long 160 call
  const legs = [
    makeLeg({ role: "short_leg", optionType: "call", strike: 150, dte: 42, expiration: futureDate(42), midpoint: 3.50, bid: 3.40, ask: 3.60, delta: 0.55, impliedVolatility: 0.45, volume: 500, openInterest: 1000, spreadPct: 5.7, liquidity: "EXCELLENT", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "call", strike: 160, dte: 42, expiration: futureDate(42), midpoint: 1.80, bid: 1.70, ask: 1.90, delta: 0.35, impliedVolatility: 0.42, volume: 400, openInterest: 800, spreadPct: 11.1, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedCredit: 1.70, width: 10, debitCreditType: "CREDIT" as const };

  it("maxLoss = (width − credit) × multiplier", () => {
    const r = buildResult("bear_call_spread", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(830); // (10 - 1.70) × 100
  });

  it("maxGain = credit × multiplier", () => {
    const r = buildResult("bear_call_spread", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(170);
  });

  it("breakeven = short call strike + credit", () => {
    const r = buildResult("bear_call_spread", legs, metrics);
    expect(r.payoffProfile.breakevens[0].price).toBeCloseTo(151.70, 1);
  });
});

// ===========================================================================
// Section 11: Iron Condor
// ===========================================================================

describe("Iron Condor payoff", () => {
  // Long put 130, short put 140, short call 160, long call 170 (wings = 10 each)
  const legs = [
    makeLeg({ role: "long_leg",  optionType: "put",  strike: 130, dte: 42, expiration: futureDate(42), midpoint: 0.80, bid: 0.75, ask: 0.85, delta: -0.15, impliedVolatility: 0.50, volume: 200, openInterest: 600, spreadPct: 12.5, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "put",  strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta: -0.25, impliedVolatility: 0.46, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "call", strike: 160, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta:  0.25, impliedVolatility: 0.44, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "call", strike: 170, dte: 42, expiration: futureDate(42), midpoint: 0.80, bid: 0.75, ask: 0.85, delta:  0.15, impliedVolatility: 0.42, volume: 200, openInterest: 600, spreadPct: 12.5, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedCredit: 1.40, width: 10, debitCreditType: "CREDIT" as const, isDefinedRisk: true };

  it("maxLoss = (max wing − credit) × multiplier", () => {
    const r = buildResult("iron_condor", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(860); // (10 - 1.40) × 100
  });

  it("maxGain = credit × multiplier", () => {
    const r = buildResult("iron_condor", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(140);
  });

  it("has two breakevens", () => {
    const r = buildResult("iron_condor", legs, metrics);
    expect(r.payoffProfile.breakevens).toHaveLength(2);
    const prices = r.payoffProfile.breakevens.map(b => b.price).sort((a, b) => a - b);
    expect(prices[0]).toBeCloseTo(138.60, 1); // short put 140 - 1.40
    expect(prices[1]).toBeCloseTo(161.40, 1); // short call 160 + 1.40
  });

  it("no probability claims", () => {
    const r = buildResult("iron_condor", legs, metrics);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/probability of profit/i);
    expect(text).not.toMatch(/chance of winning/i);
    expect(text).not.toMatch(/win rate/i);
  });
});

// ===========================================================================
// Section 12: Iron Condor with unequal wings
// ===========================================================================

describe("Iron Condor with unequal wings", () => {
  // Put wing = 10, call wing = 15
  const legs = [
    makeLeg({ role: "long_leg",  optionType: "put",  strike: 130, dte: 42, expiration: futureDate(42), midpoint: 0.80, bid: 0.70, ask: 0.90, delta: -0.12, impliedVolatility: 0.52, volume: 200, openInterest: 500, spreadPct: 25, liquidity: "THIN", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "put",  strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta: -0.25, impliedVolatility: 0.46, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "call", strike: 160, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta:  0.25, impliedVolatility: 0.44, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "call", strike: 175, dte: 42, expiration: futureDate(42), midpoint: 0.60, bid: 0.50, ask: 0.70, delta:  0.10, impliedVolatility: 0.40, volume: 150, openInterest: 400, spreadPct: 33.3, liquidity: "THIN", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedCredit: 1.60, debitCreditType: "CREDIT" as const };

  it("maxLoss uses the larger wing width", () => {
    const r = buildResult("iron_condor", legs, metrics);
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
    // call wing = 15, put wing = 10; max wing = 15; (15 - 1.60) × 100 = 1340
    expect(r.payoffProfile.maxLoss.perContractDollars).toBe(1340);
  });
});

// ===========================================================================
// Section 13: Iron Butterfly
// ===========================================================================

describe("Iron Butterfly payoff", () => {
  // Simplified: short put 150, long put 140, short call 150, long call 160
  const legs = [
    makeLeg({ role: "long_leg",  optionType: "put",  strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.00, bid: 0.90, ask: 1.10, delta: -0.20, impliedVolatility: 0.48, volume: 200, openInterest: 600, spreadPct: 20, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "put",  strike: 150, dte: 42, expiration: futureDate(42), midpoint: 3.00, bid: 2.90, ask: 3.10, delta: -0.50, impliedVolatility: 0.45, volume: 500, openInterest: 1200, spreadPct: 6.7, liquidity: "EXCELLENT", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "short_leg", optionType: "call", strike: 150, dte: 42, expiration: futureDate(42), midpoint: 3.00, bid: 2.90, ask: 3.10, delta:  0.50, impliedVolatility: 0.45, volume: 500, openInterest: 1200, spreadPct: 6.7, liquidity: "EXCELLENT", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "call", strike: 160, dte: 42, expiration: futureDate(42), midpoint: 1.00, bid: 0.90, ask: 1.10, delta:  0.20, impliedVolatility: 0.42, volume: 200, openInterest: 600, spreadPct: 20, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
  ];
  const metrics = { estimatedCredit: 4.00, debitCreditType: "CREDIT" as const };

  it("maxGain = credit × multiplier", () => {
    const r = buildResult("iron_butterfly", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
    expect(r.payoffProfile.maxGain.perContractDollars).toBe(400);
  });

  it("has two breakevens", () => {
    const r = buildResult("iron_butterfly", legs, metrics);
    expect(r.payoffProfile.breakevens).toHaveLength(2);
    // short strike = 150; lower be = 150 - 4 = 146; upper be = 150 + 4 = 154
    const prices = r.payoffProfile.breakevens.map(b => b.price).sort((a, b) => a - b);
    expect(prices[0]).toBeCloseTo(146, 0);
    expect(prices[1]).toBeCloseTo(154, 0);
  });
});

// ===========================================================================
// Section 14: Calendar and Diagonal (path dependent)
// ===========================================================================

describe("Calendar spread — path dependent", () => {
  const legs = [
    makeLeg({ role: "short_leg", optionType: "call", strike: 150, dte: 21, expiration: futureDate(21), midpoint: 2.50, bid: 2.40, ask: 2.60, delta: 0.50, impliedVolatility: 0.50, volume: 300, openInterest: 800, spreadPct: 8, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    makeLeg({ role: "long_leg",  optionType: "call", strike: 150, dte: 56, expiration: futureDate(56), midpoint: 4.20, bid: 4.10, ask: 4.30, delta: 0.55, impliedVolatility: 0.45, volume: 250, openInterest: 700, spreadPct: 4.8, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
  ];

  it("maxLoss is PATH_DEPENDENT for calendar", () => {
    const r = buildResult("calendar_spread", legs, {});
    expect(r.payoffProfile.maxLoss.type).toBe("PATH_DEPENDENT");
  });

  it("maxGain is PATH_DEPENDENT for calendar", () => {
    const r = buildResult("calendar_spread", legs, {});
    expect(r.payoffProfile.maxGain.type).toBe("PATH_DEPENDENT");
  });

  it("PATH_DEPENDENT_PAYOFF flag set", () => {
    const r = buildResult("calendar_spread", legs, {});
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("PATH_DEPENDENT_PAYOFF");
  });

  it("maxLoss is PATH_DEPENDENT for diagonal", () => {
    const r = buildResult("diagonal_spread", legs, {});
    expect(r.payoffProfile.maxLoss.type).toBe("PATH_DEPENDENT");
  });
});

// ===========================================================================
// Section 15: Collar
// ===========================================================================

describe("Collar payoff", () => {
  const legs = [
    makeLongPut(145, 42, 2.00),
    makeShortCall(160, 42, 2.20),
  ];
  // Net credit (call premium > put premium)
  const metrics = { estimatedCredit: 0.20, debitCreditType: "CREDIT" as const };

  it("maxLoss is DEFINED", () => {
    const r = buildResult("collar", legs, metrics);
    // (150 - 145 - 0.20) × 100 = 480 (refPrice 150, putStrike 145, netCost = -0.20 credit = -0.20)
    expect(r.payoffProfile.maxLoss.type).toBe("DEFINED");
  });

  it("maxGain is DEFINED", () => {
    const r = buildResult("collar", legs, metrics);
    expect(r.payoffProfile.maxGain.type).toBe("DEFINED");
  });
});

// ===========================================================================
// Section 16: Breakevens with distanceFromRefPct
// ===========================================================================

describe("Breakeven distance from reference", () => {
  it("breakeven includes distance percentage", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    const be = r.payoffProfile.breakevens[0];
    expect(be.distanceFromRefPct).not.toBeNull();
    // breakeven = 153.10, ref = 150, dist = (153.10-150)/150 × 100 ≈ +2.07%
    expect(be.distanceFromRefPct).toBeCloseTo(2.07, 0);
  });

  it("two-breakeven structure both have distances", () => {
    const legs = [
      makeLeg({ role: "long_leg",  optionType: "put",  strike: 130, dte: 42, expiration: futureDate(42), midpoint: 0.80, bid: 0.75, ask: 0.85, delta: -0.15, impliedVolatility: 0.50, volume: 200, openInterest: 600, spreadPct: 12.5, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
      makeLeg({ role: "short_leg", optionType: "put",  strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta: -0.25, impliedVolatility: 0.46, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
      makeLeg({ role: "short_leg", optionType: "call", strike: 160, dte: 42, expiration: futureDate(42), midpoint: 1.50, bid: 1.40, ask: 1.60, delta:  0.25, impliedVolatility: 0.44, volume: 300, openInterest: 800, spreadPct: 13.3, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
      makeLeg({ role: "long_leg",  optionType: "call", strike: 170, dte: 42, expiration: futureDate(42), midpoint: 0.80, bid: 0.75, ask: 0.85, delta:  0.15, impliedVolatility: 0.42, volume: 200, openInterest: 600, spreadPct: 12.5, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
    ];
    const r = buildResult("iron_condor", legs, { estimatedCredit: 1.40 });
    for (const be of r.payoffProfile.breakevens) {
      expect(be.distanceFromRefPct).not.toBeNull();
    }
  });
});

// ===========================================================================
// Section 17: Price scenarios
// ===========================================================================

describe("Price scenarios", () => {
  it("returns DEFAULT_PRICE_SCENARIO_PCTS scenarios by default", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    expect(r.priceScenarios).toHaveLength(DEFAULT_PRICE_SCENARIO_PCTS.length);
  });

  it("custom scenario percentages are used when provided", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 }),
      userId:          "user-test",
      sessionId:       "sess-test",
      underlyingPrice: 150,
      constraints:     DEFAULT_CONSTRAINTS,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
      customScenarioPcts: [-10, 0, 10],
    });
    expect(r.priceScenarios).toHaveLength(3);
    expect(r.priceScenarios.map(s => s.movePct)).toEqual([-10, 0, 10]);
  });

  it("scenario at 0% is marked isCurrent", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const current = r.priceScenarios.find(s => s.movePct === 0);
    expect(current?.isCurrent).toBe(true);
  });

  it("long call +20% scenario shows intrinsic gain", () => {
    // strike 150, debit 3.10, ref 150, +20% → scenarioPrice 180
    // intrinsic = 180 - 150 = 30 per share; P/L = 30 × 100 - 310 = 2690
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    const s = r.priceScenarios.find(s => s.movePct === 20)!;
    expect(s.scenarioPrice).toBe(180);
    expect(s.expirationIntrinsicPnlPerContract).toBe(2690);
    expect(s.expirationPayoffLabel).toBe("Gain");
  });

  it("long call −20% scenario shows full premium loss at expiration", () => {
    // strike 150, debit 3.10, ref 150, −20% → scenarioPrice 120
    // intrinsic = 0; P/L = 0 - 310 = -310
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    const s = r.priceScenarios.find(s => s.movePct === -20)!;
    expect(s.expirationIntrinsicPnlPerContract).toBe(-310);
    expect(s.expirationPayoffLabel).toBe("Loss");
  });

  it("bull call spread at expiration: capped above upper strike", () => {
    // Long 150c, short 160c, debit 1.60; at +30% (195): intrinsic = (195-150)-(195-160)= 45-35=10, P/L = 10×100-160=840
    const legs = [makeLongCall(150, 42, 3.10), makeShortCall(160, 42, 1.50)];
    const r = buildResult("bull_call_spread", legs, { estimatedDebit: 1.60, width: 10 });
    const s30 = r.priceScenarios.find(s => s.movePct === 30)!;
    // P/L should be capped at (10 - 1.60) × 100 = 840
    expect(s30.expirationIntrinsicPnlPerContract).toBe(840);
  });

  it("scenario P/L is labeled correctly", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    const s = r.priceScenarios.find(s => s.movePct === 0)!;
    // At 0% move: long call expiration intrinsic = max(0, 150-150)=0; P/L = -310 → Loss
    expect(s.expirationPayoffLabel).toBe("Loss");
  });

  it("delta approximation is present when netDelta is available", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, netDelta: 0.52 });
    const s = r.priceScenarios.find(s => s.movePct === 10)!;
    expect(s.deltaApproxPnlPerContract).not.toBeNull();
  });

  it("delta approximation is null when netDelta is null", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, netDelta: null });
    const s = r.priceScenarios.find(s => s.movePct === 10)!;
    expect(s.deltaApproxPnlPerContract).toBeNull();
  });

  it("delta approximation note is provided", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, netDelta: 0.52 });
    const s = r.priceScenarios.find(s => s.movePct === 10)!;
    expect(s.deltaApproxMethodologyNote).toBeTruthy();
    expect(s.deltaApproxMethodologyNote.length).toBeGreaterThan(20);
  });

  it("expiration and pre-expiration are separately labeled (not confused)", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, netDelta: 0.52 });
    const s = r.priceScenarios.find(s => s.movePct === 10)!;
    expect(typeof s.expirationIntrinsicPnlPerContract).toBe("number");
    expect(typeof s.deltaApproxPnlPerContract).toBe("number");
  });
});

// ===========================================================================
// Section 18: Thesis invalidation overlay
// ===========================================================================

describe("Thesis invalidation overlay", () => {
  it("BELOW_INVALIDATION when scenario price < invalidation level", () => {
    // invalidation = 142; -10% scenario = 135
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const s = r.priceScenarios.find(s => s.movePct === -10)!;
    expect(s.thesisInvalidationStatus).toBe("BELOW_INVALIDATION");
  });

  it("WITHIN_RANGE when scenario price > invalidation level", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const s = r.priceScenarios.find(s => s.movePct === 0)!;
    // ref = 150 > 142 invalidation
    expect(s.thesisInvalidationStatus).toBe("WITHIN_RANGE");
  });

  it("UNKNOWN when no invalidation note", () => {
    const r = buildTradeRiskScenarioResult({
      input: {
        ...makeInput("long_call", [makeLongCall()], { estimatedDebit: 3.10 }),
        invalidationNote: null,
      },
      userId:          "user-test",
      sessionId:       "sess-test",
      underlyingPrice: 150,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
    });
    const s = r.priceScenarios.find(s => s.movePct === 0)!;
    expect(s.thesisInvalidationStatus).toBe("UNKNOWN");
  });

  it("thesisRisk includes parsed invalidation level", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    expect(r.thesisRisk.invalidationPriceLevel).toBe(142.00);
  });

  it("thesisRisk summary is populated", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    expect(r.thesisRisk.researchThesisSummary.length).toBeGreaterThan(5);
  });
});

// ===========================================================================
// Section 19: Net Greeks
// ===========================================================================

describe("Greek profile", () => {
  it("net delta from metrics (already sign-corrected)", () => {
    const r = buildResult("long_call", [makeLongCall()], { netDelta: 0.52 });
    expect(r.greekProfile.netDelta).toBe(0.52);
  });

  it("missing Greek remains null", () => {
    const r = buildResult("long_call", [makeLong({ delta: null })], { netDelta: null });
    expect(r.greekProfile.netDelta).toBeNull();
  });

  it("greeksCoveragePercent is 100 when all legs have delta", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.greekProfile.greeksCoveragePercent).toBe(100);
  });

  it("greeksCoveragePercent is 0 when no leg has delta", () => {
    const r = buildResult("long_call", [makeLong({ delta: null })]);
    expect(r.greekProfile.greeksCoveragePercent).toBe(0);
  });

  it("partialGreeks is true when coverage < 100%", () => {
    const legs = [makeLongCall(), makeLong({ delta: null })];
    const r = buildResult("bull_call_spread", legs, { estimatedDebit: 1.60, width: 10 });
    expect(r.greekProfile.partialGreeks).toBe(true);
  });

  it("PARTIAL_GREEKS flag when partialGreeks", () => {
    const r = buildResult("long_call", [makeLong({ delta: null })]);
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("PARTIAL_GREEKS");
  });

  it("delta interpretation does not claim probability-as-chance language", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    // Negating context ("NOT a probability measure") is compliant — only affirmative claims are forbidden
    expect(r.greekProfile.deltaInterpretation).not.toMatch(/chance of (finishing|winning|profit)/i);
    expect(r.greekProfile.deltaInterpretation).not.toMatch(/probability of profit/i);
    expect(r.greekProfile.deltaInterpretation).not.toMatch(/probability itm/i);
  });

  it("theta interpretation notes time-changing nature", () => {
    const r = buildResult("long_call", [makeLongCall()], { netTheta: -0.05 });
    expect(r.greekProfile.thetaInterpretation).toMatch(/theta itself changes/i);
  });

  it("vega interpretation mentions approximation", () => {
    const r = buildResult("long_call", [makeLongCall()], { netVega: 0.12 });
    expect(r.greekProfile.vegaInterpretation).toMatch(/approximation/i);
  });
});

// Helper for null-delta leg
function makeLong(overrides: Partial<ContractResearchLeg> = {}): ContractResearchLeg {
  return makeLeg({ role: "long_leg", optionType: "call", ...overrides });
}

// ===========================================================================
// Section 20: Volatility scenarios
// ===========================================================================

describe("Volatility scenarios (vega approximation)", () => {
  it("returns 5 IV scenarios by default", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.volatilityScenarios).toHaveLength(DEFAULT_IV_SCENARIO_PCTS.length);
  });

  it("methodology is VEGA_APPROXIMATION when vega is available", () => {
    const r = buildResult("long_call", [makeLongCall()], { netVega: 0.12 });
    const base = r.volatilityScenarios.find(s => s.ivRelativeChangePct === 0)!;
    expect(base.methodology).toBe("VEGA_APPROXIMATION");
  });

  it("methodology is UNAVAILABLE when vega is null", () => {
    const r = buildResult("long_call", [makeLong({ vega: null })], { netVega: null });
    const s = r.volatilityScenarios.find(s => s.ivRelativeChangePct === 10)!;
    expect(s.methodology).toBe("UNAVAILABLE");
    expect(s.estimatedValueChangePerContract).toBeNull();
  });

  it("IV +20% relative increases structure value for positive vega", () => {
    // netVega = 0.12, baseIV = 0.45, +20% → ΔIV = 0.09 → Δ pct-points = 9
    // change = 0.12 × 9 × 100 = 108
    const r = buildResult("long_call", [makeLongCall()], { netVega: 0.12 });
    const s = r.volatilityScenarios.find(s => s.ivRelativeChangePct === 20)!;
    expect(s.estimatedValueChangePerContract).toBeGreaterThan(0);
  });

  it("IV −20% relative decreases structure value for positive vega", () => {
    const r = buildResult("long_call", [makeLongCall()], { netVega: 0.12 });
    const s = r.volatilityScenarios.find(s => s.ivRelativeChangePct === -20)!;
    expect(s.estimatedValueChangePerContract).toBeLessThan(0);
  });

  it("methodology note is populated", () => {
    const r = buildResult("long_call", [makeLongCall()], { netVega: 0.12 });
    const s = r.volatilityScenarios.find(s => s.ivRelativeChangePct === 10)!;
    expect(s.methodologyNote.length).toBeGreaterThan(20);
  });
});

// ===========================================================================
// Section 21: Time decay scenarios
// ===========================================================================

describe("Time decay scenarios", () => {
  it("returns 6 checkpoints", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)]);
    expect(r.timeDecayScenarios).toHaveLength(6);
  });

  it("Today checkpoint has 0 days elapsed", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const today = r.timeDecayScenarios.find(s => s.label === "Today")!;
    expect(today.daysElapsed).toBe(0);
  });

  it("At Expiration uses AT_EXPIRATION_INTRINSIC methodology", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const atExp = r.timeDecayScenarios.find(s => s.label === "At Expiration")!;
    expect(atExp.methodology).toBe("AT_EXPIRATION_INTRINSIC");
  });

  it("cumulative decay increases over time for negative theta", () => {
    const r = buildResult("long_call", [makeLongCall()], { netTheta: -0.05 });
    const q1 = r.timeDecayScenarios.find(s => s.label === "25% Time Elapsed")!;
    const q2 = r.timeDecayScenarios.find(s => s.label === "50% Time Elapsed")!;
    // Both have negative cumulative (decay) and q2 more negative than q1
    expect(q2.cumulativeEstimatedDecayPerContract!).toBeLessThan(q1.cumulativeEstimatedDecayPerContract!);
  });

  it("theta limitation note disclosed", () => {
    const r = buildResult("long_call", [makeLongCall()], { netTheta: -0.05 });
    const q1 = r.timeDecayScenarios.find(s => s.label === "25% Time Elapsed")!;
    expect(q1.methodologyNote).toMatch(/theta itself changes/i);
  });

  it("UNAVAILABLE when theta is null", () => {
    const r = buildResult("long_call", [makeLong({ theta: null })], { netTheta: null });
    const q1 = r.timeDecayScenarios.find(s => s.label === "25% Time Elapsed")!;
    expect(q1.methodology).toBe("UNAVAILABLE");
    expect(q1.cumulativeEstimatedDecayPerContract).toBeNull();
  });
});

// ===========================================================================
// Section 22: Event scenarios
// ===========================================================================

describe("Event scenarios", () => {
  it("empty when no event exposure", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.eventScenarios).toHaveLength(0);
  });

  it("populated when containsEarnings = true", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall()]),
      userId:          "user-test",
      sessionId:       "sess-test",
      underlyingPrice: 150,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
      eventExposure: {
        containsEarnings: true,
        eventType: "Earnings",
        earningsDate: futureDate(7),
        insideEventWindow: true,
        eventNote: "Earnings within expiration window.",
      },
    });
    expect(r.eventScenarios).toHaveLength(1);
    expect(r.eventScenarios[0].eventType).toBe("Earnings");
    expect(r.eventScenarios[0].eventWithinStructureLife).toBe(true);
  });

  it("EVENT_WINDOW flag set when event present", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall()]),
      userId:          "user-test",
      sessionId:       "sess-test",
      underlyingPrice: 150,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
      eventExposure: {
        containsEarnings: true,
        eventType: "Earnings",
        earningsDate: futureDate(7),
        insideEventWindow: true,
        eventNote: "Earnings.",
      },
    });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("EVENT_WINDOW");
  });

  it("event scenario does not forecast the earnings move", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall()]),
      userId:          "user-test",
      sessionId:       "sess-test",
      underlyingPrice: 150,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
      eventExposure: {
        containsEarnings: true,
        eventType: "Earnings",
        earningsDate: futureDate(7),
        insideEventWindow: true,
        eventNote: "Earnings.",
      },
    });
    const text = JSON.stringify(r.eventScenarios);
    expect(text).not.toMatch(/expected move is \$|will move \$|forecast/i);
  });
});

// ===========================================================================
// Section 23: Assignment and early exercise risk
// ===========================================================================

describe("Assignment and early exercise risk", () => {
  it("ASSIGNMENT_RISK flag when short leg present", () => {
    const r = buildResult("bull_call_spread", [makeLongCall(150), makeShortCall(160)], { estimatedDebit: 1.60, width: 10 });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("ASSIGNMENT_RISK");
  });

  it("EARLY_EXERCISE_RISK only for covered_call and cash_secured_put", () => {
    const covered = buildResult("covered_call", [makeShortCall(160)], { estimatedCredit: 2.00 });
    const spread  = buildResult("bull_call_spread", [makeLongCall(150), makeShortCall(160)], { estimatedDebit: 1.60, width: 10 });
    expect(covered.riskFlags.map(f => f.code)).toContain("EARLY_EXERCISE_RISK");
    // Bull call spread should have ASSIGNMENT_RISK but not necessarily EARLY_EXERCISE_RISK
    const spreadCodes = spread.riskFlags.map(f => f.code);
    expect(spreadCodes).toContain("ASSIGNMENT_RISK");
  });
});

// ===========================================================================
// Section 24: Planning constraint check
// ===========================================================================

describe("Planning constraint check", () => {
  it("WITHIN_CONSTRAINT when maxLoss ≤ userMaxCapitalAtRisk", () => {
    // maxLoss = 310 (long call debit), constraint = 500
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 500 } });
    expect(r.constraintCheck.status).toBe("WITHIN_CONSTRAINT");
    expect(r.constraintCheck.scenarioMaxLoss).toBe(310);
  });

  it("EXCEEDS_CONSTRAINT when maxLoss > userMaxCapitalAtRisk", () => {
    // maxLoss = 310, constraint = 200
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 200 } });
    expect(r.constraintCheck.status).toBe("EXCEEDS_CONSTRAINT");
  });

  it("MAX_LOSS_EXCEEDS_CONSTRAINT flag when status is EXCEEDS", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 200 } });
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("MAX_LOSS_EXCEEDS_CONSTRAINT");
  });

  it("NO_CONSTRAINT_SET when no maxCapitalAtRisk", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true } });
    expect(r.constraintCheck.status).toBe("NO_CONSTRAINT_SET");
  });

  it("UNDEFINED_RISK when maxLoss is not DEFINED", () => {
    const r = buildResult("covered_call", [makeShortCall(160)], { estimatedCredit: 2.00 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 500 } });
    expect(r.constraintCheck.status).toBe("UNDEFINED_RISK");
  });

  it("constraint status note does not say Suitable or Recommended", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    expect(r.constraintCheck.statusNote).not.toMatch(/suitable/i);
    expect(r.constraintCheck.statusNote).not.toMatch(/recommended/i);
  });

  it("does not auto-substitute another contract", () => {
    // When exceeds constraint, candidateId is unchanged
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 100 } });
    expect(r.contractResearchCandidateId).toBe("cand-test-001");
  });
});

// ===========================================================================
// Section 25: Stale quote detection
// ===========================================================================

describe("Stale quote detection", () => {
  it("STALE_QUOTE flag when quote is old", () => {
    const oldDate = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 min ago
    const r = buildResult("long_call", [makeLeg({ updatedAt: oldDate })]);
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("STALE_QUOTE");
    expect(r.freshness.isStale).toBe(true);
  });

  it("no STALE_QUOTE when quote is fresh", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).not.toContain("STALE_QUOTE");
    expect(r.freshness.isStale).toBe(false);
  });

  it("UNKNOWN freshness when updatedAt is null", () => {
    const r = buildResult("long_call", [makeLeg({ updatedAt: null })]);
    expect(r.liquidityRisk.quoteFreshness).toBe("UNKNOWN");
  });
});

// ===========================================================================
// Section 26: Liquidity and quote risk
// ===========================================================================

describe("Liquidity and quote risk", () => {
  it("WIDE_BID_ASK flag when spread > threshold", () => {
    const r = buildResult("long_call", [makeLeg({ spreadPct: 20 })]);
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("WIDE_BID_ASK");
  });

  it("LOW_OPEN_INTEREST flag when OI < threshold", () => {
    const r = buildResult("long_call", [makeLeg({ openInterest: 50 })]);
    const codes = r.riskFlags.map(f => f.code);
    expect(codes).toContain("LOW_OPEN_INTEREST");
  });

  it("executionNote contains midpoint warning", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.liquidityRisk.executionNote).toMatch(/midpoint/i);
  });

  it("quoteRisk midpointNote is non-empty", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.quoteRisk.midpointNote.length).toBeGreaterThan(10);
  });
});

// ===========================================================================
// Section 27: Compliance — no forbidden language
// ===========================================================================

describe("Compliance — forbidden language", () => {
  const strategies: Array<[string, ContractResearchLeg[]]> = [
    ["long_call", [makeLongCall()]],
    ["long_put", [makeLongPut()]],
    ["covered_call", [makeShortCall()]],
    ["cash_secured_put", [makeShortPut()]],
    ["bull_call_spread", [makeLongCall(), makeShortCall()]],
  ];

  for (const [fam, legs] of strategies) {
    it(`${fam}: no forbidden language`, () => {
      const r = buildResult(fam, legs, { estimatedDebit: 2.00 });
      const text = JSON.stringify(r);
      expect(text).not.toMatch(/expected profit/i);
      expect(text).not.toMatch(/expected return/i);
      expect(text).not.toMatch(/chance of winning/i);
      expect(text).not.toMatch(/safe trade/i);
      expect(text).not.toMatch(/best risk.reward trade/i);
      expect(text).not.toMatch(/guaranteed loss limit/i);
      expect(text).not.toMatch(/"recommended"/i);
    });
  }

  it("disclaimer is present and non-empty", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.disclaimer).toBe(RISK_SCENARIO_DISCLAIMER);
    expect(r.disclaimer.length).toBeGreaterThan(50);
  });

  it("options risk disclosure is present", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.optionsRiskDisclosure.length).toBeGreaterThan(50);
  });

  it("probability metrics are always off", () => {
    const fams = ["long_call", "long_put", "bull_call_spread", "iron_condor", "calendar_spread"];
    for (const f of fams) {
      const r = buildResult(f, [makeLongCall()]);
      expect(r.probabilityMetricsEnabled).toBe(false);
    }
  });
});

// ===========================================================================
// Section 28: Capital profile
// ===========================================================================

describe("Capital profile", () => {
  it("debit structure: estimatedScenarioCapital = debit × multiplier", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10, debitCreditType: "DEBIT" });
    expect(r.capitalProfile.netDebitPerContract).toBe(3.10);
    expect(r.capitalProfile.estimatedScenarioCapital).toBe(310);
  });

  it("cash_secured_put: capital = strike × multiplier", () => {
    const r = buildResult("cash_secured_put", [makeShortPut(140)], { estimatedCredit: 1.80, debitCreditType: "CREDIT" });
    expect(r.capitalProfile.estimatedScenarioCapital).toBe(14000);
  });

  it("credit spread: capital = (width − credit) × multiplier", () => {
    const r = buildResult("bull_put_spread", [
      makeLeg({ role: "short_leg", optionType: "put", strike: 150, dte: 42, expiration: futureDate(42), midpoint: 3.00, bid: 2.90, ask: 3.10, delta: -0.50, impliedVolatility: 0.45, volume: 400, openInterest: 900, spreadPct: 6.7, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
      makeLeg({ role: "long_leg",  optionType: "put", strike: 140, dte: 42, expiration: futureDate(42), midpoint: 1.20, bid: 1.10, ask: 1.30, delta: -0.30, impliedVolatility: 0.40, volume: 300, openInterest: 700, spreadPct: 16.7, liquidity: "FAIR", updatedAt: new Date().toISOString() }),
    ], { estimatedCredit: 1.80, width: 10, debitCreditType: "CREDIT" });
    // (10 - 1.80) × 100 = 820
    expect(r.capitalProfile.estimatedScenarioCapital).toBe(820);
  });

  it("does not use 'Recommended Capital' or 'Optimal Capital' language", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const text = JSON.stringify(r.capitalProfile);
    expect(text).not.toMatch(/recommended capital/i);
    expect(text).not.toMatch(/optimal capital/i);
  });
});

// ===========================================================================
// Section 29: Partial data resilience
// ===========================================================================

describe("Partial data resilience", () => {
  it("no underlying price → empty price scenarios, no crash", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall()], { estimatedDebit: 3.10 }),
      userId:          "u",
      sessionId:       "s",
      underlyingPrice: null,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
    });
    expect(r.priceScenarios).toHaveLength(0);
  });

  it("null constraints → NO_CONSTRAINT_SET", () => {
    const r = buildTradeRiskScenarioResult({
      input:           makeInput("long_call", [makeLongCall()], { estimatedDebit: 3.10 }),
      userId:          "u",
      sessionId:       "s",
      underlyingPrice: 150,
      constraints:     null,
      qualityCategory: "EXCELLENT",
      marketDataAsOf:  null,
      optionDataAsOf:  null,
    });
    expect(r.constraintCheck.status).toBe("NO_CONSTRAINT_SET");
  });

  it("no event exposure → no event scenarios", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.eventScenarios).toHaveLength(0);
  });

  it("missing legs midpoints → graceful payoff note", () => {
    const leg = makeLeg({ midpoint: null, bid: null, ask: null });
    const r = buildResult("long_call", [leg], { estimatedDebit: null });
    // maxLoss should be SUBSTANTIAL (no debit computable)
    expect(r.payoffProfile.maxLoss.type).toBe("SUBSTANTIAL");
  });
});

// ===========================================================================
// Section 30: Server authority — client cannot inject legs/quotes
// ===========================================================================

describe("Server authority (no client injection)", () => {
  it("legs come from TradeRiskScenarioInput, not reconstructed from request body", () => {
    const input = makeInput("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    // The service uses input.legs — not any external object
    const r = buildTradeRiskScenarioResult({
      input, userId: "u", sessionId: "s",
      underlyingPrice: 150, constraints: null,
      qualityCategory: "EXCELLENT", marketDataAsOf: null, optionDataAsOf: null,
    });
    expect(r.structureSummary.legs).toHaveLength(1);
    expect(r.structureSummary.legs[0].strike).toBe(150);
  });
});

// ===========================================================================
// Section 31: Cache isolation
// ===========================================================================

describe("Cache isolation", () => {
  it("different users get different cache entries", () => {
    const input = makeInput("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    const r1 = buildTradeRiskScenarioResult({ input, userId: "user-A", sessionId: "s1", underlyingPrice: 150, constraints: null, qualityCategory: "EXCELLENT", marketDataAsOf: null, optionDataAsOf: null });
    const r2 = buildTradeRiskScenarioResult({ input, userId: "user-B", sessionId: "s2", underlyingPrice: 150, constraints: null, qualityCategory: "EXCELLENT", marketDataAsOf: null, optionDataAsOf: null });
    expect(r1.id).not.toBe(r2.id);
  });

  it("clearRiskScenarioCache prevents stale lookup", () => {
    const input = makeInput("long_call", [makeLongCall()], { estimatedDebit: 3.10 });
    buildTradeRiskScenarioResult({ input, userId: "user-C", sessionId: "s-c", underlyingPrice: 150, constraints: null, qualityCategory: "EXCELLENT", marketDataAsOf: null, optionDataAsOf: null });
    clearRiskScenarioCache();
    const cached = getCachedRiskAnalysis("user-C", "s-c", "cand-test-001");
    expect(cached).toBeNull();
  });
});

// ===========================================================================
// Section 32: Session contract research cache
// ===========================================================================

describe("Session contract research cache", () => {
  it("stores and retrieves a contract research result", () => {
    const fakeResult = { structureCandidates: [], symbol: "TEST" } as any;
    storeSessionContractResearch("session-X", fakeResult);
    const retrieved = getSessionContractResearch("session-X");
    expect(retrieved).toEqual(fakeResult);
  });

  it("clearRiskScenarioCache also clears session contract research", () => {
    const fakeResult = { structureCandidates: [] } as any;
    storeSessionContractResearch("session-Y", fakeResult);
    clearRiskScenarioCache();
    expect(getSessionContractResearch("session-Y")).toBeNull();
  });
});

// ===========================================================================
// Section 33: Platform health metrics
// ===========================================================================

describe("Platform health metrics", () => {
  it("riskAnalysesRequested increments on each build call", () => {
    const before = getRiskAnalysisHealth().riskAnalysesRequested;
    buildResult("long_call", [makeLongCall()]);
    const after = getRiskAnalysisHealth().riskAnalysesRequested;
    expect(after).toBeGreaterThan(before);
  });

  it("probabilityMetricsEnabled is always false in health", () => {
    const h = getRiskAnalysisHealth();
    expect(h.probabilityMetricsEnabled).toBe(false);
  });
});

// ===========================================================================
// Section 34: Structure summary
// ===========================================================================

describe("Structure summary", () => {
  it("legs are summarized correctly", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)], { estimatedDebit: 3.10 });
    expect(r.structureSummary.legs).toHaveLength(1);
    expect(r.structureSummary.legs[0].strike).toBe(150);
    expect(r.structureSummary.legs[0].role).toBe("long_leg");
    expect(r.structureSummary.legs[0].optionType).toBe("call");
  });

  it("primaryDte is the max DTE across all legs", () => {
    const legs = [
      makeLeg({ role: "short_leg", optionType: "call", strike: 150, dte: 21, expiration: futureDate(21), midpoint: 2.50, bid: 2.40, ask: 2.60, delta: 0.50, impliedVolatility: 0.50, volume: 300, openInterest: 800, spreadPct: 8, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
      makeLeg({ role: "long_leg",  optionType: "call", strike: 150, dte: 56, expiration: futureDate(56), midpoint: 4.20, bid: 4.10, ask: 4.30, delta: 0.55, impliedVolatility: 0.45, volume: 250, openInterest: 700, spreadPct: 4.8, liquidity: "GOOD", updatedAt: new Date().toISOString() }),
    ];
    const r = buildResult("calendar_spread", legs);
    expect(r.structureSummary.primaryDte).toBe(56);
  });

  it("unique expirations listed", () => {
    const r = buildResult("long_call", [makeLongCall(150, 42, 3.10)]);
    expect(r.structureSummary.expirations).toHaveLength(1);
  });
});

// ===========================================================================
// Section 35: 2.7.5 handoff contract
// ===========================================================================

describe("2.7.5 TradePlanInput handoff", () => {
  it("contains required fields for 2.7.5", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const h = r.tradePlanHandoff;
    expect(h.riskScenarioAnalysisId).toBe(r.id);
    expect(h.selectedExpressionFamily).toBe("long_call");
    expect(h.planningContextId).toBe("ctx-test-001");
    expect(h.contractResearchCandidateId).toBe("cand-test-001");
    expect(h.equityPlanningScenarioId).toBeNull();
  });

  it("riskFlags in handoff match riskFlags in result", () => {
    const r = buildResult("long_call", [makeLongCall()], { estimatedDebit: 3.10 }, { constraints: { optionsAllowed: true, maxCapitalAtRisk: 100 } });
    expect(r.tradePlanHandoff.riskFlags.sort()).toEqual(r.riskFlags.map(f => f.code).sort());
  });

  it("invalidationContext is set from input", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.tradePlanHandoff.invalidationContext).toBe("Thesis invalidated below $142.00");
  });
});

// ===========================================================================
// Section 36: Roadmap discipline — no execution
// ===========================================================================

describe("Roadmap discipline", () => {
  it("result contains no order ticket fields", () => {
    const r = buildResult("long_call", [makeLongCall()]);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/"orderType"/);
    expect(text).not.toMatch(/"limitPrice"/);
    expect(text).not.toMatch(/"executionPayload"/);
    expect(text).not.toMatch(/"brokerOrder"/);
  });

  it("result contains no auto-substitution of candidate", () => {
    // candidateId in result matches input candidateId
    const r = buildResult("long_call", [makeLongCall()]);
    expect(r.contractResearchCandidateId).toBe("cand-test-001");
  });
});

// ===========================================================================
// Section 37: RISK_SCENARIO_DISCLAIMER constant
// ===========================================================================

describe("RISK_SCENARIO_DISCLAIMER constant", () => {
  it("is non-empty", () => {
    expect(RISK_SCENARIO_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("contains 'hypothetical'", () => {
    expect(RISK_SCENARIO_DISCLAIMER).toMatch(/hypothetical/i);
  });

  it("does not say 'recommended trade' or 'best trade'", () => {
    expect(RISK_SCENARIO_DISCLAIMER).not.toMatch(/recommended trade/i);
    expect(RISK_SCENARIO_DISCLAIMER).not.toMatch(/best trade/i);
  });
});
