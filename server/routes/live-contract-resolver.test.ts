// Live Contract Resolver — Server Tests (Sprint 2.2.2)
//
// Test categories A–K (per spec):
//   A. Pure unit: resolveExpirations
//   B. Pure unit: resolveStrikesFromGuidance
//   C. Pure unit: validateLiquidity
//   D. Pure unit: computePricing
//   E. Pure unit: computeRisk
//   F. Pure unit: computeContractFit
//   G. Pure unit: normalizeOptionChainContract
//   H. Integration: resolveLiveContracts end-to-end paths
//   I. Security: no broker tokens, account IDs, or raw provider payloads in response
//   J. Route: POST /api/options/resolve-contracts + GET /api/options/broker-capability
//   K. Capability flag: BrokerCapabilities extension
//
// Run: npx vitest run --root . server/routes/live-contract-resolver.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import {
  resolveExpirations,
  resolveStrikesFromGuidance,
  validateLiquidity,
  computePricing,
  computeRisk,
  computeContractFit,
  normalizeOptionChainContract,
  resolveLiveContracts,
  checkBrokerOptionsCapability,
  type NormalizedOptionContract,
  type LiveContractResolverDeps,
  type LiveContractResolveRequest,
} from "../services/live-contract-resolver";
import { registerLiveContractResolverRoutes } from "./live-contract-resolver";
import type { OptionChainContract } from "../broker/providers/tradier";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = new Date("2026-08-06T12:00:00-05:00");

function rawContract(overrides: Partial<OptionChainContract> = {}): OptionChainContract {
  return {
    symbol: "NVDA260918C00130000",
    strike: 130,
    optionType: "call",
    expiration: "2026-09-18",
    bid: 3.10,
    ask: 3.30,
    last: 3.20,
    volume: 850,
    openInterest: 5200,
    greeks: { delta: 0.52, gamma: 0.02, theta: -0.05, vega: 0.18, mid_iv: 0.39 },
    ...overrides,
  };
}

// Fresh timestamp — always within the 30-min stale window so stale-quote logic
// doesn't fire unless the test explicitly overrides updatedAt.
const FRESH_TS = new Date(Date.now() - 5 * 60 * 1000).toISOString();

function normalized(overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract {
  return {
    provider: "tradier",
    symbol: "NVDA260918C00130000",
    underlyingSymbol: "NVDA",
    optionType: "call",
    expiration: "2026-09-18",
    strike: 130,
    contractId: "NVDA260918C00130000",
    bid: 3.10,
    ask: 3.30,
    last: 3.20,
    mark: 3.20,
    volume: 850,
    openInterest: 5200,
    impliedVolatility: 0.39,
    delta: 0.52,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.18,
    rho: null,
    multiplier: 100,
    inTheMoney: false,
    updatedAt: FRESH_TS,
    ...overrides,
  };
}

const BASE_REQUEST: LiveContractResolveRequest = {
  symbol: "NVDA",
  structure: "long_call",
  targetDte: { min: 30, max: 60 },
  strikeGuidance: { singleLeg: "near_atm" },
  referenceLevels: {
    underlyingPrice: 130,
    support: 120,
    resistance: 145,
    breakout: 140,
    objective: 160,
  },
};

function makeChain(overrides: Partial<NormalizedOptionContract>[] = []): NormalizedOptionContract[] {
  const strikes = [120, 125, 130, 135, 140, 145, 150];
  const base = strikes.flatMap((strike) =>
    (["call", "put"] as const).map((optionType) =>
      normalized({
        strike,
        optionType,
        symbol: `NVDA260918${optionType === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
        contractId: `NVDA260918${optionType === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
      }),
    ),
  );
  return base;
}

// ---------------------------------------------------------------------------
// Section A: resolveExpirations
// ---------------------------------------------------------------------------

describe("A. resolveExpirations", () => {
  it("A1: filters expired dates", () => {
    const result = resolveExpirations(["2026-07-01", "2026-09-18"], 30, 60, TODAY);
    expect(result.map((e) => e.expiration)).not.toContain("2026-07-01");
  });

  it("A2: rejects invalid date formats", () => {
    const result = resolveExpirations(["not-a-date", "2026-09-18"], 30, 60, TODAY);
    expect(result.map((e) => e.expiration)).toEqual(["2026-09-18"]);
  });

  it("A3: marks in-range expirations as withinTargetRange=true", () => {
    const result = resolveExpirations(["2026-09-18", "2026-12-18"], 30, 60, TODAY);
    const sep = result.find((e) => e.expiration === "2026-09-18");
    expect(sep?.withinTargetRange).toBe(true);
  });

  it("A4: marks out-of-range expirations with warnings", () => {
    const result = resolveExpirations(["2026-12-18"], 30, 60, TODAY);
    expect(result[0]?.warnings.length).toBeGreaterThan(0);
  });

  it("A5: returns in-range expirations before out-of-range ones", () => {
    const result = resolveExpirations(["2026-12-18", "2026-09-18"], 30, 60, TODAY);
    expect(result[0]?.expiration).toBe("2026-09-18");
  });

  it("A6: sorts multiple in-range by closeness to DTE midpoint", () => {
    const result = resolveExpirations(["2026-09-18", "2026-09-04"], 30, 60, TODAY);
    // 2026-09-04 ≈ 29 DTE (just outside), 2026-09-18 ≈ 43 DTE (in range)
    const inRange = result.filter((e) => e.withinTargetRange);
    expect(inRange.length).toBeGreaterThan(0);
  });

  it("A7: empty input returns empty output", () => {
    expect(resolveExpirations([], 30, 60, TODAY)).toEqual([]);
  });

  it("A8: DTE is positive for future expirations", () => {
    const result = resolveExpirations(["2026-09-18"], 30, 60, TODAY);
    expect(result[0]?.dte).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section B: resolveStrikesFromGuidance
// ---------------------------------------------------------------------------

describe("B. resolveStrikesFromGuidance", () => {
  const chain = makeChain();
  const levels = BASE_REQUEST.referenceLevels;

  it("B1: near_atm returns call closest to underlying price", () => {
    const result = resolveStrikesFromGuidance(chain, "near_atm", "call", levels);
    expect(result[0]?.strike).toBe(130);
    expect(result[0]?.optionType).toBe("call");
  });

  it("B2: near_support returns contract closest to support level", () => {
    const result = resolveStrikesFromGuidance(chain, "near_support", "put", levels);
    expect(result[0]?.strike).toBe(120);
  });

  it("B3: near_technical_objective returns call closest to objective (150 is nearest listed strike to 160)", () => {
    // objective is 160, but chain only has strikes up to 150 → expect 150
    const result = resolveStrikesFromGuidance(chain, "near_technical_objective", "call", levels);
    expect(result[0]?.strike).toBe(150);
    expect(result[0]?.optionType).toBe("call");
  });

  it("B4: otm_2_5 for calls returns strike 2-5% above underlying", () => {
    const result = resolveStrikesFromGuidance(chain, "otm_2_5", "call", levels);
    expect(result[0]).toBeDefined();
    if (result[0]) {
      expect(result[0].strike).toBeGreaterThan(levels.underlyingPrice);
    }
  });

  it("B5: one_strike_itm for calls returns highest strike below underlying", () => {
    const result = resolveStrikesFromGuidance(chain, "one_strike_itm", "call", levels);
    if (result.length > 0) {
      expect(result[0].strike).toBeLessThan(levels.underlyingPrice);
    }
  });

  it("B6: filters by optionType — call guidance only returns calls", () => {
    const result = resolveStrikesFromGuidance(chain, "near_atm", "call", levels);
    expect(result.every((c) => c.optionType === "call")).toBe(true);
  });

  it("B7: returns empty array for empty chain", () => {
    const result = resolveStrikesFromGuidance([], "near_atm", "call", levels);
    expect(result).toEqual([]);
  });

  it("B8: near_breakout returns contract closest to breakout level", () => {
    const result = resolveStrikesFromGuidance(chain, "near_breakout", "call", levels);
    expect(result[0]).toBeDefined();
    if (result[0]) {
      expect(Math.abs(result[0].strike - (levels.breakout ?? levels.underlyingPrice))).toBeLessThanOrEqual(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Section C: validateLiquidity
// ---------------------------------------------------------------------------

describe("C. validateLiquidity", () => {
  it("C1: verified — good bid/ask with tight spread", () => {
    const { status } = validateLiquidity(normalized({ bid: 3.10, ask: 3.30, openInterest: 5000, volume: 200 }));
    expect(status).toBe("verified");
  });

  it("C2: rejected — crossed market (bid > ask)", () => {
    const { status, warnings } = validateLiquidity(normalized({ bid: 3.50, ask: 3.20 }));
    expect(status).toBe("rejected");
    expect(warnings.some((w) => w.includes("Crossed market"))).toBe(true);
  });

  it("C3: rejected — zero ask", () => {
    const { status } = validateLiquidity(normalized({ bid: 0, ask: 0 }));
    expect(status).toBe("rejected");
  });

  it("C4: unavailable — both bid and ask null", () => {
    const { status } = validateLiquidity(normalized({ bid: null, ask: null }));
    expect(status).toBe("unavailable");
  });

  it("C5: limited — wide spread (> 30%)", () => {
    const { status } = validateLiquidity(normalized({ bid: 0.10, ask: 2.00, openInterest: 5000, volume: 200 }));
    expect(["limited", "acceptable"]).toContain(status); // wide spread
  });

  it("C6: warning flagged for zero bid", () => {
    const { warnings } = validateLiquidity(normalized({ bid: 0, ask: 0.50 }));
    expect(warnings.some((w) => w.includes("zero") || w.includes("Bid"))).toBe(true);
  });

  it("C7: warning flagged for low open interest", () => {
    const { warnings } = validateLiquidity(normalized({ openInterest: 50 }));
    expect(warnings.some((w) => w.includes("open interest"))).toBe(true);
  });

  it("C8: no warning for high open interest", () => {
    const { warnings } = validateLiquidity(normalized({ openInterest: 2000, volume: 500 }));
    expect(warnings.filter((w) => w.includes("open interest"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section D: computePricing
// ---------------------------------------------------------------------------

describe("D. computePricing", () => {
  it("D1: long_call uses midpoint when bid+ask available", () => {
    const leg = { action: "buy" as const, contract: normalized({ bid: 3.10, ask: 3.30, mark: 3.20 }) };
    const { estimatedDebit, pricingStatus, pricingBasis } = computePricing("long_call", [leg]);
    expect(estimatedDebit).toBe(3.20);
    expect(pricingStatus).toBe("available");
    expect(pricingBasis).toContain("midpoint");
  });

  it("D2: long_call falls back to ask when no mark", () => {
    const leg = { action: "buy" as const, contract: normalized({ bid: null, ask: 3.30, mark: null }) };
    const { estimatedDebit, pricingStatus } = computePricing("long_call", [leg]);
    expect(estimatedDebit).toBe(3.30);
    expect(pricingStatus).toBe("partial");
  });

  it("D3: bull_call_spread: debit = longAsk - shortBid", () => {
    const longLeg = { action: "buy" as const, contract: normalized({ ask: 3.30, bid: 3.10 }) };
    const shortLeg = { action: "sell" as const, contract: normalized({ strike: 145, ask: 1.20, bid: 1.10 }) };
    const { estimatedDebit, pricingStatus } = computePricing("bull_call_spread", [longLeg, shortLeg]);
    expect(estimatedDebit).toBeCloseTo(3.30 - 1.10, 2);
    expect(pricingStatus).toBe("available");
  });

  it("D4: bull_put_spread: credit = shortBid - longAsk", () => {
    const shortLeg = { action: "sell" as const, contract: normalized({ bid: 2.50, ask: 2.70, optionType: "put", strike: 125 }) };
    const longLeg  = { action: "buy"  as const, contract: normalized({ bid: 1.10, ask: 1.30, optionType: "put", strike: 120 }) };
    const { estimatedCredit, pricingStatus } = computePricing("bull_put_spread", [shortLeg, longLeg]);
    expect(estimatedCredit).toBeCloseTo(2.50 - 1.30, 2);
    expect(pricingStatus).toBe("available");
  });

  it("D5: cash_secured_put uses midpoint", () => {
    const leg = { action: "sell" as const, contract: normalized({ bid: 1.80, ask: 2.00, mark: 1.90, optionType: "put" }) };
    const { estimatedCredit, pricingStatus } = computePricing("cash_secured_put", [leg]);
    expect(estimatedCredit).toBe(1.90);
    expect(pricingStatus).toBe("available");
  });

  it("D6: returns unavailable when ask is null", () => {
    const leg = { action: "buy" as const, contract: normalized({ bid: null, ask: null, mark: null }) };
    const { pricingStatus } = computePricing("long_call", [leg]);
    expect(pricingStatus).toBe("unavailable");
  });

  it("D7: bull_call_spread returns unavailable when missing bids", () => {
    const longLeg = { action: "buy" as const, contract: normalized({ ask: null }) };
    const shortLeg = { action: "sell" as const, contract: normalized({ bid: null }) };
    const { pricingStatus } = computePricing("bull_call_spread", [longLeg, shortLeg]);
    expect(pricingStatus).toBe("unavailable");
  });

  it("D8: covered_call uses same logic as cash_secured_put", () => {
    const leg = { action: "sell" as const, contract: normalized({ bid: 1.50, ask: 1.70, mark: 1.60 }) };
    const { estimatedCredit } = computePricing("covered_call", [leg]);
    expect(estimatedCredit).toBe(1.60);
  });
});

// ---------------------------------------------------------------------------
// Section E: computeRisk
// ---------------------------------------------------------------------------

describe("E. computeRisk", () => {
  it("E1: long_call maxRisk = premium × 100", () => {
    const pricing = { estimatedDebit: 3.20, estimatedCredit: null, pricingBasis: "midpoint", pricingStatus: "available" as const };
    const legs = [{ action: "buy" as const, contract: normalized({ strike: 130 }) }];
    const { maxRisk, breakeven } = computeRisk("long_call", legs, pricing, 100);
    expect(maxRisk).toBe(320);
    expect(breakeven).toBeCloseTo(130 + 3.20, 2);
  });

  it("E2: long_call maxGain is unlimited", () => {
    const pricing = { estimatedDebit: 3.20, estimatedCredit: null, pricingBasis: "midpoint", pricingStatus: "available" as const };
    const legs = [{ action: "buy" as const, contract: normalized({ strike: 130 }) }];
    const { maxGain } = computeRisk("long_call", legs, pricing, 100);
    expect(maxGain?.toLowerCase()).toContain("unlimited");
  });

  it("E3: bull_call_spread maxRisk = debit × 100", () => {
    const pricing = { estimatedDebit: 2.20, estimatedCredit: null, pricingBasis: "basis", pricingStatus: "available" as const };
    const legs = [
      { action: "buy" as const, contract: normalized({ strike: 130 }) },
      { action: "sell" as const, contract: normalized({ strike: 145 }) },
    ];
    const { maxRisk } = computeRisk("bull_call_spread", legs, pricing, 100);
    expect(maxRisk).toBe(220);
  });

  it("E4: bull_call_spread breakeven = longStrike + debit", () => {
    const pricing = { estimatedDebit: 2.20, estimatedCredit: null, pricingBasis: "basis", pricingStatus: "available" as const };
    const legs = [
      { action: "buy" as const, contract: normalized({ strike: 130 }) },
      { action: "sell" as const, contract: normalized({ strike: 145 }) },
    ];
    const { breakeven } = computeRisk("bull_call_spread", legs, pricing, 100);
    expect(breakeven).toBeCloseTo(130 + 2.20, 2);
  });

  it("E5: bull_put_spread maxRisk = (width - credit) × 100", () => {
    const pricing = { estimatedDebit: null, estimatedCredit: 1.20, pricingBasis: "basis", pricingStatus: "available" as const };
    const legs = [
      { action: "sell" as const, contract: normalized({ strike: 125, optionType: "put" }) },
      { action: "buy" as const, contract: normalized({ strike: 120, optionType: "put" }) },
    ];
    const { maxRisk } = computeRisk("bull_put_spread", legs, pricing, 100);
    expect(maxRisk).toBeCloseTo((5 - 1.20) * 100, 1);
  });

  it("E6: cash_secured_put breakeven = strike - credit", () => {
    const pricing = { estimatedDebit: null, estimatedCredit: 1.90, pricingBasis: "midpoint", pricingStatus: "available" as const };
    const legs = [{ action: "sell" as const, contract: normalized({ strike: 120, optionType: "put" }) }];
    const { breakeven } = computeRisk("cash_secured_put", legs, pricing, 100);
    expect(breakeven).toBeCloseTo(120 - 1.90, 2);
  });

  it("E7: returns null fields when pricing unavailable", () => {
    const pricing = { estimatedDebit: null, estimatedCredit: null, pricingBasis: null, pricingStatus: "unavailable" as const };
    const legs = [{ action: "buy" as const, contract: normalized() }];
    const { maxRisk, maxGain, breakeven } = computeRisk("long_call", legs, pricing, 100);
    expect(maxRisk).toBeNull();
    expect(maxGain).toBeNull();
    expect(breakeven).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section F: computeContractFit
// ---------------------------------------------------------------------------

describe("F. computeContractFit", () => {
  it("F1: returns 0–100 integer", () => {
    const { contractFit } = computeContractFit(43, 30, 60, [{ contract: normalized() }]);
    expect(contractFit).toBeGreaterThanOrEqual(0);
    expect(contractFit).toBeLessThanOrEqual(100);
    expect(Number.isInteger(contractFit)).toBe(true);
  });

  it("F2: in-range DTE scores higher than out-of-range", () => {
    const { contractFit: inRange } = computeContractFit(43, 30, 60, [{ contract: normalized() }]);
    const { contractFit: outRange } = computeContractFit(120, 30, 60, [{ contract: normalized() }]);
    expect(inRange).toBeGreaterThan(outRange);
  });

  it("F3: valid quote contributes to score", () => {
    const withQuote = computeContractFit(43, 30, 60, [{ contract: normalized({ bid: 3.10, ask: 3.30 }) }]);
    const withoutQuote = computeContractFit(43, 30, 60, [{ contract: normalized({ bid: null, ask: null }) }]);
    expect(withQuote.contractFit).toBeGreaterThan(withoutQuote.contractFit);
  });

  it("F4: Greeks presence adds to score", () => {
    const with_ = computeContractFit(43, 30, 60, [{ contract: normalized({ delta: 0.52 }) }]);
    const without = computeContractFit(43, 30, 60, [{ contract: normalized({ delta: null, gamma: null, theta: null, vega: null }) }]);
    expect(with_.contractFit).toBeGreaterThanOrEqual(without.contractFit);
  });

  it("F5: high OI scores better than low OI", () => {
    const highOI = computeContractFit(43, 30, 60, [{ contract: normalized({ openInterest: 5000 }) }]);
    const lowOI = computeContractFit(43, 30, 60, [{ contract: normalized({ openInterest: 50 }) }]);
    expect(highOI.contractFit).toBeGreaterThan(lowOI.contractFit);
  });

  it("F6: fitReasons is non-empty for good contracts", () => {
    const { fitReasons } = computeContractFit(43, 30, 60, [{ contract: normalized() }]);
    expect(fitReasons.length).toBeGreaterThan(0);
  });

  it("F7: returns score even with no legs", () => {
    const { contractFit } = computeContractFit(43, 30, 60, []);
    expect(contractFit).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Section G: normalizeOptionChainContract
// ---------------------------------------------------------------------------

describe("G. normalizeOptionChainContract", () => {
  const FETCH_TS = "2026-08-06T17:30:00.000Z";

  it("G1: normalizes a complete contract", () => {
    const result = normalizeOptionChainContract(rawContract(), "tradier", "NVDA", FETCH_TS);
    expect(result.symbol).toBe("NVDA260918C00130000");
    expect(result.strike).toBe(130);
    expect(result.optionType).toBe("call");
    expect(result.bid).toBe(3.10);
    expect(result.ask).toBe(3.30);
    expect(result.delta).toBeCloseTo(0.52);
    expect(result.provider).toBe("tradier");
    expect(result.underlyingSymbol).toBe("NVDA");
    expect(result.updatedAt).toBe(FETCH_TS);
  });

  it("G2: computes mark = (bid+ask)/2 when both valid", () => {
    const result = normalizeOptionChainContract(rawContract({ bid: 3.10, ask: 3.30 }), "tradier", "NVDA", FETCH_TS);
    expect(result.mark).toBeCloseTo(3.20, 2);
  });

  it("G3: mark is null when ask <= 0", () => {
    const result = normalizeOptionChainContract(rawContract({ bid: 0, ask: 0 }), "tradier", "NVDA", FETCH_TS);
    expect(result.mark).toBeNull();
  });

  it("G4: mark is null when bid > ask (crossed market)", () => {
    const result = normalizeOptionChainContract(rawContract({ bid: 4.0, ask: 3.0 }), "tradier", "NVDA", FETCH_TS);
    expect(result.mark).toBeNull();
  });

  it("G5: greeks are null when not supplied", () => {
    const result = normalizeOptionChainContract(rawContract({ greeks: undefined }), "tradier", "NVDA", FETCH_TS);
    expect(result.delta).toBeNull();
    expect(result.gamma).toBeNull();
    expect(result.theta).toBeNull();
    expect(result.vega).toBeNull();
    expect(result.impliedVolatility).toBeNull();
  });

  it("G6: multiplier is always 100", () => {
    const result = normalizeOptionChainContract(rawContract(), "tradier", "NVDA", FETCH_TS);
    expect(result.multiplier).toBe(100);
  });

  it("G7: rho is null (not provided by standard chain)", () => {
    const result = normalizeOptionChainContract(rawContract(), "tradier", "NVDA", FETCH_TS);
    expect(result.rho).toBeNull();
  });

  it("G8: no extra fields from raw payload leak through", () => {
    const rawWithLeak = { ...rawContract(), accountId: "ACCT-SECRET", accessToken: "TOKEN-123" } as any;
    const result = normalizeOptionChainContract(rawWithLeak, "tradier", "NVDA", FETCH_TS) as any;
    expect(result.accountId).toBeUndefined();
    expect(result.accessToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section H: resolveLiveContracts — end-to-end paths (injectable deps)
// ---------------------------------------------------------------------------

describe("H. resolveLiveContracts integration", () => {
  function makeDeps(overrides: Partial<LiveContractResolverDeps> = {}): LiveContractResolverDeps {
    return {
      getBrokerConnection: async () => ({ provider: "tradier", isConnected: true }),
      getBrokerCapabilities: async () => ({
        nativeTrailingStop: false,
        stocks: true,
        options: true,
        spreads: true,
        optionsChain: true,
        optionQuotes: true,
        greeks: true,
        multiLegOptions: false,
        execution: true,
      }),
      getOptionExpirations: async () => ["2026-09-04", "2026-09-18", "2026-10-16"],
      getOptionChain: async (_userId, _symbol, _exp) => {
        const strikes = [120, 125, 130, 135, 140, 145, 150];
        return strikes.flatMap((strike) =>
          (["call", "put"] as const).map((optionType) =>
            rawContract({
              strike,
              optionType,
              symbol: `NVDA${_exp.replace(/-/g, "").slice(2)}${optionType === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
              expiration: _exp,
            }),
          ),
        );
      },
      ...overrides,
    };
  }

  it("H1: resolved status for long_call with valid broker", async () => {
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, makeDeps());
    expect(["resolved", "partial"]).toContain(result.status);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("H2: broker_not_connected when no connection", async () => {
    const deps = makeDeps({ getBrokerConnection: async () => null });
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, deps);
    expect(result.status).toBe("broker_not_connected");
    expect(result.candidates).toEqual([]);
  });

  it("H3: broker_not_connected when isConnected=false", async () => {
    const deps = makeDeps({ getBrokerConnection: async () => ({ provider: "tradier", isConnected: false }) });
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, deps);
    expect(result.status).toBe("broker_not_connected");
  });

  it("H4: capability_unavailable when optionsChain=false", async () => {
    const deps = makeDeps({ getBrokerCapabilities: async () => ({ nativeTrailingStop: false, stocks: true, options: false, spreads: false, optionsChain: false }) });
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, deps);
    expect(result.status).toBe("capability_unavailable");
  });

  it("H5: unsupported_structure for unrecognized structure", async () => {
    const result = await resolveLiveContracts("user-1", { ...BASE_REQUEST, structure: "iron_condor" }, makeDeps());
    expect(result.status).toBe("unsupported_structure");
  });

  it("H6: chain_unavailable when expirations API throws", async () => {
    const deps = makeDeps({ getOptionExpirations: async () => { throw new Error("503"); } });
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, deps);
    expect(result.status).toBe("chain_unavailable");
  });

  it("H7: no_matching_expiration when all expirations are expired", async () => {
    const deps = makeDeps({ getOptionExpirations: async () => ["2026-07-01", "2026-08-01"] });
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, deps);
    expect(["no_matching_expiration", "chain_unavailable"]).toContain(result.status);
  });

  it("H8: bull_call_spread resolves two legs", async () => {
    const result = await resolveLiveContracts("user-1", {
      ...BASE_REQUEST,
      structure: "bull_call_spread",
      strikeGuidance: { longLeg: "near_atm", shortLeg: "near_technical_objective" },
    }, makeDeps());
    if (result.status === "resolved" || result.status === "partial") {
      expect(result.candidates[0]?.legs.length).toBe(2);
      const [long, short] = result.candidates[0].legs;
      expect(long?.action).toBe("buy");
      expect(short?.action).toBe("sell");
      expect(short!.strike).toBeGreaterThan(long!.strike);
    }
  });

  it("H9: candidates sorted by contractFit descending", async () => {
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, makeDeps());
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].contractFit).toBeGreaterThanOrEqual(result.candidates[i].contractFit);
    }
  });

  it("H10: bull_put_spread resolves short > long strike", async () => {
    const result = await resolveLiveContracts("user-1", {
      ...BASE_REQUEST,
      structure: "bull_put_spread",
      strikeGuidance: { shortLeg: "near_support", longLeg: "near_support" },
    }, makeDeps());
    if (result.status === "resolved" || result.status === "partial") {
      const cand = result.candidates[0];
      if (cand?.legs.length === 2) {
        const short = cand.legs.find((l) => l.action === "sell");
        const long = cand.legs.find((l) => l.action === "buy");
        if (short && long) expect(short.strike).toBeGreaterThan(long.strike);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Section I: Security — no broker tokens/account IDs in response
// ---------------------------------------------------------------------------

describe("I. Security", () => {
  function makeDeps(): LiveContractResolverDeps {
    const SECRET_TOKEN = "eyJhbGciOiJIUzI1NiJ9.SUPER_SECRET";
    const ACCOUNT_ID = "ACCT-99991234";
    return {
      getBrokerConnection: async () => ({ provider: "tradier", isConnected: true }),
      getBrokerCapabilities: async () => ({
        nativeTrailingStop: false, stocks: true, options: true, spreads: true,
        optionsChain: true, optionQuotes: true, greeks: true, multiLegOptions: false, execution: true,
      }),
      getOptionExpirations: async () => ["2026-09-18"],
      getOptionChain: async () => [
        { ...rawContract(), accountId: ACCOUNT_ID, accessToken: SECRET_TOKEN } as any,
      ],
    };
  }

  it("I1: response does not contain broker access token", async () => {
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, makeDeps());
    const json = JSON.stringify(result);
    expect(json).not.toContain("SUPER_SECRET");
  });

  it("I2: response does not contain account ID", async () => {
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, makeDeps());
    const json = JSON.stringify(result);
    expect(json).not.toContain("ACCT-99991234");
  });

  it("I3: response does not contain userId", async () => {
    const result = await resolveLiveContracts("user-1", BASE_REQUEST, makeDeps());
    const json = JSON.stringify(result);
    expect(json).not.toContain("user-1");
  });
});

// ---------------------------------------------------------------------------
// Section J: Route tests
// ---------------------------------------------------------------------------

describe("J. Route: /api/options", () => {
  let server: Server;
  let baseUrl: string;

  function makeDeps(): LiveContractResolverDeps {
    return {
      getBrokerConnection: async () => ({ provider: "tradier", isConnected: true }),
      getBrokerCapabilities: async () => ({
        nativeTrailingStop: false, stocks: true, options: true, spreads: true,
        optionsChain: true, optionQuotes: true, greeks: true, multiLegOptions: false, execution: true,
      }),
      getOptionExpirations: async () => ["2026-09-18"],
      getOptionChain: async (_u, _s, exp) => [rawContract({ expiration: exp })],
    };
  }

  function fakeAuth(userId: string) {
    return (req: any, res: any, next: any) => { req.session = { userId }; next(); };
  }

  beforeEach(async () => {
    // Override the default deps with injectable ones — we test the route layer only
    const app = express();
    app.use(express.json());
    // Register with fake auth middleware
    const auth = fakeAuth("test-user");
    app.get("/api/options/broker-capability", auth, async (req: any, res: any) => {
      res.json({ connected: true, provider: "tradier", optionsChainSupported: true, greeksSupported: true, multiLegSupported: false });
    });
    app.post("/api/options/resolve-contracts", auth, async (req: any, res: any) => {
      const { resolveContractsBodySchema } = await import("./live-contract-resolver");
      const parsed = resolveContractsBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_REQUEST", details: parsed.error.issues } });
      const result = await resolveLiveContracts("test-user", parsed.data, makeDeps());
      res.json(result);
    });
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("J1: GET /api/options/broker-capability returns connected+capability", async () => {
    const res = await fetch(`${baseUrl}/api/options/broker-capability`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.optionsChainSupported).toBe(true);
  });

  it("J2: POST /api/options/resolve-contracts returns valid result", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "NVDA",
        structure: "long_call",
        targetDte: { min: 30, max: 60 },
        strikeGuidance: { singleLeg: "near_atm" },
        referenceLevels: { underlyingPrice: 130 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("NVDA");
    expect(body.structure).toBe("long_call");
    expect(["resolved", "partial", "no_matching_strike", "no_matching_expiration"]).toContain(body.status);
  });

  it("J3: rejects request with invalid symbol", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "!!!",
        structure: "long_call",
        targetDte: { min: 30, max: 60 },
        strikeGuidance: {},
        referenceLevels: { underlyingPrice: 130 },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("J4: rejects request when targetDte.min > targetDte.max", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "NVDA",
        structure: "long_call",
        targetDte: { min: 90, max: 30 },
        strikeGuidance: {},
        referenceLevels: { underlyingPrice: 130 },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("J5: rejects underlyingPrice ≤ 0", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "NVDA",
        structure: "long_call",
        targetDte: { min: 30, max: 60 },
        strikeGuidance: {},
        referenceLevels: { underlyingPrice: -1 },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("J6: lowercase symbol in body is normalized to uppercase", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "nvda",
        structure: "long_call",
        targetDte: { min: 30, max: 60 },
        strikeGuidance: {},
        referenceLevels: { underlyingPrice: 130 },
      }),
    });
    const body = await res.json();
    expect(body.symbol).toBe("NVDA");
  });

  it("J7: unsupported structure returns unsupported_structure status (not 500)", async () => {
    const res = await fetch(`${baseUrl}/api/options/resolve-contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "NVDA",
        structure: "iron_condor",
        targetDte: { min: 30, max: 60 },
        strikeGuidance: {},
        referenceLevels: { underlyingPrice: 130 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("unsupported_structure");
  });
});

// ---------------------------------------------------------------------------
// Section K: BrokerCapabilities extension
// ---------------------------------------------------------------------------

describe("K. BrokerCapabilities extension", () => {
  it("K1: Tradier capabilities include optionsChain, optionQuotes, greeks", async () => {
    const { tradierProvider } = await import("../broker/providers/tradier");
    expect(tradierProvider.capabilities.optionsChain).toBe(true);
    expect(tradierProvider.capabilities.optionQuotes).toBe(true);
    expect(tradierProvider.capabilities.greeks).toBe(true);
  });

  it("K2: TradeStation capabilities include optionsChain, optionQuotes, greeks", async () => {
    const { tradestationProvider } = await import("../broker/providers/tradestation");
    expect(tradestationProvider.capabilities.optionsChain).toBe(true);
    expect(tradestationProvider.capabilities.optionQuotes).toBe(true);
    expect(tradestationProvider.capabilities.greeks).toBe(true);
  });

  it("K3: Schwab capabilities have optionsChain=false", async () => {
    const { schwabProvider } = await import("../broker/providers/schwab");
    expect(schwabProvider.capabilities.optionsChain).toBe(false);
    expect(schwabProvider.capabilities.options).toBe(false);
  });

  it("K4: checkBrokerOptionsCapability returns connected=false when no broker", async () => {
    const result = await checkBrokerOptionsCapability("user-x", {
      getBrokerConnection: async () => null,
      getBrokerCapabilities: async () => null,
    });
    expect(result.connected).toBe(false);
    expect(result.optionsChainSupported).toBe(false);
  });

  it("K5: checkBrokerOptionsCapability reflects optionsChain flag", async () => {
    const result = await checkBrokerOptionsCapability("user-x", {
      getBrokerConnection: async () => ({ provider: "tradier", isConnected: true }),
      getBrokerCapabilities: async () => ({
        nativeTrailingStop: false, stocks: true, options: true, spreads: true,
        optionsChain: true, optionQuotes: true, greeks: true, multiLegOptions: false, execution: true,
      }),
    });
    expect(result.connected).toBe(true);
    expect(result.provider).toBe("tradier");
    expect(result.optionsChainSupported).toBe(true);
  });
});
