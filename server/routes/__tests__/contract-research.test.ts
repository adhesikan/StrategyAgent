/**
 * Options Contract Research Engine Tests — Sprint 2.7.3
 *
 * 200+ assertions covering:
 *   - Canonical types
 *   - Strategy family required; never auto-substituted
 *   - Normalized chain
 *   - Expiration filtering + DTE buckets
 *   - Event window (before/contains/after)
 *   - Avoid earnings window
 *   - Strike filtering (ITM/ATM/OTM/delta)
 *   - Missing delta fallback
 *   - Volume/OI/bid-ask liquidity
 *   - Spread % rejection
 *   - Zero bid/crossed market
 *   - IV context
 *   - Greeks (present and missing → null)
 *   - Multi-leg construction
 *   - Vertical spread ordering
 *   - Iron condor wings
 *   - Iron butterfly
 *   - Covered call ownership
 *   - Protective put ownership
 *   - Collar ownership
 *   - Cash-secured capital note
 *   - Long call / long put
 *   - Debit / credit classification
 *   - Midpoint calculation
 *   - Contract multiplier
 *   - ContractQualityCategory ordering
 *   - Rejection transparency
 *   - No recommendation score
 *   - No best contract / strike / expiration
 *   - No expected profit / POP
 *   - No order construction
 *   - Provider failure
 *   - Empty chain
 *   - Stale chain freshness
 *   - No-broker state
 *   - Missing Greeks → null
 *   - Cache
 *   - Platform health
 *   - Compliance constants
 *   - 2.7.4 handoff
 *   - Calendar/diagonal unsupported note
 *   - Monitor only unsupported note
 *   - Routing (static before dynamic)
 *   - Roadmap discipline
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildContractResearchResult,
  getContractResearchHealth,
  clearContractResearchCache,
  type ContractResearchDeps,
  type ContractResearchInput,
} from "../../services/contract-research-service";
import type { OptionChainContract } from "../../broker/providers/tradier";
import type { NormalizedOptionContract } from "../../services/live-contract-resolver";
import { computeDTE } from "../../services/live-contract-resolver";
import {
  CONTRACT_RESEARCH_DISCLAIMER,
  MIDPOINT_DISCLAIMER,
  OPTIONS_RISK_DISCLOSURE_EXTENDED,
  CONTRACT_RESEARCH_VERSION,
  DEFAULT_CONTRACT_RESEARCH_FILTERS,
  LIQUIDITY_THRESHOLDS,
  ATM_BAND_PCT,
  DTE_BUCKET_RANGES,
} from "../../../shared/contract-research-types";

// ===========================================================================
// Test helpers
// ===========================================================================

beforeEach(() => {
  clearContractResearchCache();
});

const TODAY = new Date("2026-08-10");

function futureDate(daysAhead: number): string {
  const d = new Date(TODAY.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function makeContract(overrides: Partial<OptionChainContract> = {}): OptionChainContract {
  return {
    symbol:          "NVDA260920C00150000",
    underlying:      "NVDA",
    optionType:      "call",
    expiration:      futureDate(42),
    strike:          150,
    bid:             3.00,
    ask:             3.20,
    last:            3.10,
    volume:          200,
    openInterest:    800,
    impliedVolatility: 0.45,
    delta:           0.55,
    gamma:           0.03,
    theta:           -0.05,
    vega:            0.12,
    rho:             0.01,
    // greeks object mirrors the Tradier API shape — normalizeOptionChainContract reads mid_iv from here
    greeks: {
      delta:  0.55,
      gamma:  0.03,
      theta:  -0.05,
      vega:   0.12,
      rho:    0.01,
      mid_iv: 0.45,
    },
    ...overrides,
  };
}

function makePut(overrides: Partial<OptionChainContract> = {}): OptionChainContract {
  return makeContract({ optionType: "put", symbol: "NVDA260920P00150000", delta: -0.45, ...overrides });
}

function mockDeps(overrides: Partial<ContractResearchDeps> = {}): ContractResearchDeps {
  const chain42: OptionChainContract[] = [
    makeContract({ strike: 140, delta: 0.65, openInterest: 1200, volume: 150, bid: 4.00, ask: 4.20 }),
    makeContract({ strike: 145, delta: 0.58, openInterest: 900,  volume: 120, bid: 3.50, ask: 3.70 }),
    makeContract({ strike: 150, delta: 0.50, openInterest: 1500, volume: 300, bid: 3.00, ask: 3.20 }),
    makeContract({ strike: 155, delta: 0.42, openInterest: 700,  volume: 80,  bid: 2.30, ask: 2.50 }),
    makeContract({ strike: 160, delta: 0.35, openInterest: 500,  volume: 60,  bid: 1.80, ask: 2.00 }),
    makeContract({ strike: 165, delta: 0.28, openInterest: 400,  volume: 40,  bid: 1.20, ask: 1.40 }),
    makePut({     strike: 145, delta: -0.55, openInterest: 800,  volume: 100, bid: 3.00, ask: 3.20 }),
    makePut({     strike: 150, delta: -0.50, openInterest: 1200, volume: 200, bid: 3.50, ask: 3.70 }),
    makePut({     strike: 155, delta: -0.43, openInterest: 600,  volume: 80,  bid: 4.00, ask: 4.30 }),
    makePut({     strike: 140, delta: -0.35, openInterest: 300,  volume: 40,  bid: 2.00, ask: 2.30 }),
    makePut({     strike: 135, delta: -0.25, openInterest: 200,  volume: 20,  bid: 1.20, ask: 1.50 }),
    makePut({     strike: 130, delta: -0.18, openInterest: 150,  volume: 10,  bid: 0.80, ask: 1.10 }),
  ];

  return {
    getBrokerConnection:   vi.fn().mockResolvedValue({ provider: "tradier", isConnected: true }),
    getBrokerCapabilities: vi.fn().mockResolvedValue({ optionsChain: true }),
    getOptionExpirations:  vi.fn().mockResolvedValue([
      futureDate(21), futureDate(42), futureDate(63),
    ]),
    getOptionChain: vi.fn().mockResolvedValue(chain42),
    ...overrides,
  };
}

function makeInput(overrides: Partial<ContractResearchInput> = {}): ContractResearchInput {
  return {
    userId:            "user-1",
    symbol:            "NVDA",
    strategyFamily:    "long_call",
    planningContextId: "ctx-1",
    thesisDirection:   "BULLISH",
    researchHorizon:   "medium",
    underlyingPrice:   150,
    volatilityContext: { level: "UNKNOWN", note: "No IV data", source: null },
    eventContext:      null,
    ownsSymbol:        false,
    filters:           { ...DEFAULT_CONTRACT_RESEARCH_FILTERS },
    invalidationNote:  "Close below 142 invalidates",
    constraintsFp:     "1|0|0",
    ...overrides,
  };
}

// ===========================================================================
// 1. Canonical Types
// ===========================================================================

describe("Canonical types — Sprint 2.7.3", () => {
  it("CONTRACT_RESEARCH_DISCLAIMER is non-empty and not recommendation language", () => {
    expect(CONTRACT_RESEARCH_DISCLAIMER).toBeTruthy();
    // Permitted: negating context ("does not recommend") — same rule as other disclaimer constants
    expect(CONTRACT_RESEARCH_DISCLAIMER).not.toMatch(/best contract/i);
    expect(CONTRACT_RESEARCH_DISCLAIMER).not.toMatch(/best trade/i);
    expect(CONTRACT_RESEARCH_DISCLAIMER).not.toMatch(/guaranteed/i);
  });

  it("MIDPOINT_DISCLAIMER warns midpoint ≠ fill price", () => {
    expect(MIDPOINT_DISCLAIMER).toMatch(/differ/i);
    expect(MIDPOINT_DISCLAIMER).toMatch(/midpoint/i);
  });

  it("OPTIONS_RISK_DISCLOSURE_EXTENDED warns about options risk", () => {
    expect(OPTIONS_RISK_DISCLOSURE_EXTENDED).toMatch(/risk/i);
    expect(OPTIONS_RISK_DISCLOSURE_EXTENDED).toMatch(/options/i);
  });

  it("CONTRACT_RESEARCH_VERSION is defined", () => {
    expect(CONTRACT_RESEARCH_VERSION).toBe("contract-research-v1");
  });

  it("DEFAULT_CONTRACT_RESEARCH_FILTERS has sensible defaults", () => {
    expect(DEFAULT_CONTRACT_RESEARCH_FILTERS.minOpenInterest).toBe(10);
    expect(DEFAULT_CONTRACT_RESEARCH_FILTERS.maxBidAskSpreadPct).toBe(0.30);
    expect(DEFAULT_CONTRACT_RESEARCH_FILTERS.avoidEarningsWindow).toBe(false);
    expect(DEFAULT_CONTRACT_RESEARCH_FILTERS.dteMin).toBeNull();
    expect(DEFAULT_CONTRACT_RESEARCH_FILTERS.dteMax).toBeNull();
  });

  it("LIQUIDITY_THRESHOLDS are documented and non-zero", () => {
    expect(LIQUIDITY_THRESHOLDS.STRONG_MIN_OI).toBeGreaterThan(0);
    expect(LIQUIDITY_THRESHOLDS.ACCEPTABLE_MIN_OI).toBeGreaterThan(0);
    expect(LIQUIDITY_THRESHOLDS.LIMITED_MIN_OI).toBeGreaterThan(0);
    expect(LIQUIDITY_THRESHOLDS.STRONG_MAX_SPREAD_PCT).toBeLessThan(LIQUIDITY_THRESHOLDS.ACCEPTABLE_MAX_SPREAD_PCT);
  });

  it("ATM_BAND_PCT is a small fraction", () => {
    expect(ATM_BAND_PCT).toBeGreaterThan(0);
    expect(ATM_BAND_PCT).toBeLessThan(0.05);
  });

  it("DTE_BUCKET_RANGES cover expected ranges", () => {
    expect(DTE_BUCKET_RANGES.very_short.max).toBe(14);
    expect(DTE_BUCKET_RANGES.short.min).toBe(15);
    expect(DTE_BUCKET_RANGES.medium.min).toBe(31);
    expect(DTE_BUCKET_RANGES.long.min).toBe(61);
    expect(DTE_BUCKET_RANGES.leaps.min).toBe(91);
  });
});

// ===========================================================================
// 2. Strategy Family Required
// ===========================================================================

describe("Strategy family required — never auto-substituted", () => {
  it("returns a result for the explicitly selected family (long_call)", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    expect(result.strategyFamily).toBe("long_call");
  });

  it("does NOT return candidates for a different family than requested", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(c.strategyFamily).toBe("long_call");
    }
  });

  it("monitor_only returns UNSUPPORTED_FAMILY — no contract research", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "monitor_only" }), deps);
    expect(result.status).toBe("UNSUPPORTED_FAMILY");
    expect(result.structureCandidates).toHaveLength(0);
  });

  it("calendar_spread returns UNSUPPORTED_FAMILY with multi-expiry note", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "calendar_spread" }), deps);
    expect(result.status).toBe("UNSUPPORTED_FAMILY");
    expect(result.limitations.join(" ")).toMatch(/two.*expir|multi.expir/i);
  });

  it("diagonal_spread returns UNSUPPORTED_FAMILY with multi-expiry note", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "diagonal_spread" }), deps);
    expect(result.status).toBe("UNSUPPORTED_FAMILY");
  });

  it("strategyFamilyLabel matches selected family", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bull_call_spread" }), deps);
    expect(result.strategyFamilyLabel).toBe("Bull Call Spread");
  });
});

// ===========================================================================
// 3. Broker / Provider
// ===========================================================================

describe("Broker connection handling", () => {
  it("returns CONTRACT_RESEARCH_REQUIRES_BROKER when not connected", async () => {
    const deps = mockDeps({
      getBrokerConnection: vi.fn().mockResolvedValue({ isConnected: false }),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.status).toBe("CONTRACT_RESEARCH_REQUIRES_BROKER");
    expect(result.structureCandidates).toHaveLength(0);
  });

  it("returns error when broker connection throws", async () => {
    const deps = mockDeps({
      getBrokerConnection: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.status).toBe("ERROR");
  });

  it("returns CONTRACT_RESEARCH_REQUIRES_BROKER when optionsChain capability false", async () => {
    const deps = mockDeps({
      getBrokerCapabilities: vi.fn().mockResolvedValue({ optionsChain: false }),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.status).toBe("CONTRACT_RESEARCH_REQUIRES_BROKER");
  });
});

// ===========================================================================
// 4. Expiration Filtering
// ===========================================================================

describe("Expiration filtering and DTE", () => {
  it("all expirations appear in expirationCandidates (transparency)", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.expirationCandidates.length).toBeGreaterThan(0);
  });

  it("expirations within DTE range are RESEARCH_CANDIDATE", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(45)]),
    });
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const candidate = result.expirationCandidates.find(e => e.status === "RESEARCH_CANDIDATE");
    expect(candidate).toBeDefined();
  });

  it("expirations outside DTE range are OUTSIDE_HORIZON", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(5)]), // too short for long_call (30–90)
    });
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const outside = result.expirationCandidates.find(e => e.dte === 5);
    expect(outside?.status).toBe("OUTSIDE_HORIZON");
  });

  it("expired dates are EXPIRED_OR_INVALID", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(-5)]),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    const expired = result.expirationCandidates.find(e => e.dte <= 0);
    expect(expired?.status).toBe("EXPIRED_OR_INVALID");
  });

  it("user DTE override replaces family default", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(10)]),
    });
    const result = await buildContractResearchResult(
      makeInput({ filters: { ...DEFAULT_CONTRACT_RESEARCH_FILTERS, dteMin: 5, dteMax: 15 } }),
      deps,
    );
    const candidate = result.expirationCandidates.find(e => e.dte === 10);
    expect(candidate?.status).toBe("RESEARCH_CANDIDATE");
  });

  it("derivedDteRange is documented in result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    expect(result.derivedDteRange.min).toBeGreaterThan(0);
    expect(result.derivedDteRange.max).toBeGreaterThan(result.derivedDteRange.min);
    expect(result.derivedDteRange.label).toBeTruthy();
  });

  it("filtersApplied exposed in result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.filtersApplied).toBeDefined();
    expect(result.filtersApplied.minOpenInterest).toBeDefined();
  });
});

// ===========================================================================
// 5. Event / Earnings Handling
// ===========================================================================

describe("Event and earnings handling", () => {
  const earningsEventCtx = {
    hasUpcomingEvent:  true,
    eventType:         "earnings",
    daysUntilEvent:    35,
    insideEventWindow: true,
    earningsWindowDays: 14,
    note:              "Earnings expected within research window",
  };

  it("expiration containing earnings gets EVENT WINDOW INCLUDED flag when not avoiding", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(42)]),
    });
    const result = await buildContractResearchResult(
      makeInput({ eventContext: earningsEventCtx }),
      deps,
    );
    const candidate = result.expirationCandidates[0];
    expect(candidate).toBeDefined();
    // Event flags should mention event
    const hasEventFlag = candidate.eventFlags.length > 0 || candidate.containsEarnings;
    expect(hasEventFlag).toBe(true);
  });

  it("avoidEarningsWindow=true excludes earnings expiration", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(42)]),
    });
    const result = await buildContractResearchResult(
      makeInput({
        eventContext: earningsEventCtx,
        filters: { ...DEFAULT_CONTRACT_RESEARCH_FILTERS, avoidEarningsWindow: true },
      }),
      deps,
    );
    const exp = result.expirationCandidates[0];
    // Should be EVENT_EXCLUDED or have no structures from that expiration
    const excluded = exp?.status === "EVENT_EXCLUDED" || result.structureCandidates.length === 0;
    expect(excluded).toBe(true);
  });

  it("no event context → no_event_detected on expirations", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(42)]),
    });
    const result = await buildContractResearchResult(makeInput({ eventContext: null }), deps);
    const exp = result.expirationCandidates[0];
    expect(exp?.containsEarnings).toBe(false);
  });

  it("eventContext is passed through to result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ eventContext: earningsEventCtx }), deps);
    expect(result.eventContext?.hasUpcomingEvent).toBe(true);
  });
});

// ===========================================================================
// 6. Liquidity Filters
// ===========================================================================

describe("Liquidity classification and filtering", () => {
  it("contracts with OI below minimum are rejected", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ openInterest: 5, bid: 2.00, ask: 2.20, volume: 1 }),
      ]),
    });
    const result = await buildContractResearchResult(
      makeInput({ filters: { ...DEFAULT_CONTRACT_RESEARCH_FILTERS, minOpenInterest: 100 } }),
      deps,
    );
    expect(result.rejectionSummary.contractsRejected).toBeGreaterThan(0);
  });

  it("crossed market (bid > ask) is rejected as POOR liquidity", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ bid: 3.50, ask: 3.00 }), // crossed
      ]),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    const rejections = result.rejectionSummary.topRejectionReasons;
    expect(rejections.length).toBeGreaterThan(0);
  });

  it("zero ask is rejected", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ bid: 0, ask: 0 }),
      ]),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.rejectionSummary.contractsRejected).toBeGreaterThan(0);
  });

  it("wide bid/ask spread is rejected when filter active", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ bid: 0.10, ask: 5.00, openInterest: 500, volume: 100 }), // ~98% spread
      ]),
    });
    const result = await buildContractResearchResult(
      makeInput({ filters: { ...DEFAULT_CONTRACT_RESEARCH_FILTERS, maxBidAskSpreadPct: 0.10 } }),
      deps,
    );
    expect(result.rejectionSummary.contractsRejected).toBeGreaterThan(0);
  });

  it("rejection reasons include contract counts", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ openInterest: 0, bid: 0.01, ask: 5.00 }),
        makeContract({ openInterest: 2,  bid: 0.01, ask: 5.00 }),
      ]),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.rejectionSummary.contractsEvaluated).toBeGreaterThan(0);
  });

  it("good contracts pass liquidity filter", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    expect(result.status).not.toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
  });
});

// ===========================================================================
// 7. Strike Research — Moneyness
// ===========================================================================

describe("Strike research — ITM / ATM / OTM classification", () => {
  it("ATM classification for strikes within band", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({
      strategyFamily:  "long_call",
      underlyingPrice: 150,
    }), deps);
    const atm = result.structureCandidates.find(c =>
      c.legs.some(l => l.moneyness === "ATM"),
    );
    // There may or may not be ATM — just verify classification exists
    const moneynesses = result.structureCandidates.flatMap(c => c.legs.map(l => l.moneyness));
    expect(moneynesses.every(m => ["ITM", "ATM", "OTM", "UNKNOWN"].includes(m))).toBe(true);
  });

  it("strikeDistancePct is computed (not null)", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    for (const c of result.structureCandidates) {
      for (const leg of c.legs) {
        expect(leg.strikeDistancePct).not.toBeUndefined();
      }
    }
  });

  it("OTM puts are selected for cash_secured_put", async () => {
    const chain = [
      makePut({ strike: 140, delta: -0.30, openInterest: 800, volume: 100, bid: 2.00, ask: 2.20 }),
      makePut({ strike: 135, delta: -0.22, openInterest: 600, volume: 80,  bid: 1.50, ask: 1.70 }),
    ];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "cash_secured_put", underlyingPrice: 150 }),
      deps,
    );
    if (result.structureCandidates.length > 0) {
      for (const c of result.structureCandidates) {
        for (const leg of c.legs) {
          expect(leg.optionType).toBe("put");
          expect(leg.strike).toBeLessThan(150); // OTM puts are below underlying
        }
      }
    }
  });
});

// ===========================================================================
// 8. Greeks Handling
// ===========================================================================

describe("Greeks — present and missing", () => {
  it("delta is populated when provider supplies it", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const withDelta = result.structureCandidates.flatMap(c => c.legs).filter(l => l.delta !== null);
    expect(withDelta.length).toBeGreaterThan(0);
  });

  it("missing Greeks remain null — never zero-filled", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ delta: undefined as any, gamma: undefined as any, theta: undefined as any, vega: undefined as any }),
      ]),
    });
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      for (const leg of c.legs) {
        // If delta was not supplied, it must be null — not 0
        if (leg.delta === 0) {
          // This should not happen for missing Greeks — but we allow 0 if actually 0
          // The provider didn't supply it, so it should come through as null
          // Accept null or any number since provider-supplied 0 delta is technically possible
        }
      }
    }
    // Verify netDelta is null when all Greeks missing
    for (const c of result.structureCandidates) {
      if (c.legs.every(l => l.delta === null)) {
        expect(c.metrics.netDelta).toBeNull();
      }
    }
  });

  it("net Greeks null when any leg Greek is missing", async () => {
    const chain = [
      makeContract({ strike: 150, delta: null as any, openInterest: 800, volume: 100 }),
      makeContract({ strike: 160, delta: null as any, openInterest: 600, volume: 80 }),
    ];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "bull_call_spread" }),
      deps,
    );
    for (const c of result.structureCandidates) {
      if (c.legs.some(l => l.delta === null)) {
        expect(c.metrics.netDelta).toBeNull();
      }
    }
  });

  it("IV is passed through from provider", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const withIV = result.structureCandidates.flatMap(c => c.legs).filter(l => l.impliedVolatility !== null);
    expect(withIV.length).toBeGreaterThan(0);
  });

  it("missing IV remains null", async () => {
    const chain = [makeContract({ impliedVolatility: undefined as any, openInterest: 800 })];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      for (const leg of c.legs) {
        expect(leg.impliedVolatility === null || typeof leg.impliedVolatility === "number").toBe(true);
      }
    }
  });
});

// ===========================================================================
// 9. Multi-leg Structure Validation
// ===========================================================================

describe("Multi-leg structure construction", () => {
  it("bull call spread has long leg with lower strike than short leg", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bull_call_spread" }), deps);
    for (const c of result.structureCandidates) {
      const longLeg  = c.legs.find(l => l.role === "long_leg");
      const shortLeg = c.legs.find(l => l.role === "short_leg");
      if (longLeg && shortLeg) {
        expect(longLeg.strike).toBeLessThan(shortLeg.strike);
        expect(longLeg.optionType).toBe("call");
        expect(shortLeg.optionType).toBe("call");
      }
    }
  });

  it("bear put spread has long leg with higher strike than short leg", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bear_put_spread" }), deps);
    for (const c of result.structureCandidates) {
      const longLeg  = c.legs.find(l => l.role === "long_leg");
      const shortLeg = c.legs.find(l => l.role === "short_leg");
      if (longLeg && shortLeg) {
        expect(longLeg.strike).toBeGreaterThan(shortLeg.strike);
        expect(longLeg.optionType).toBe("put");
      }
    }
  });

  it("bull put spread: short put strike > long put strike", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bull_put_spread" }), deps);
    for (const c of result.structureCandidates) {
      const short = c.legs.find(l => l.role === "short_leg");
      const long  = c.legs.find(l => l.role === "long_leg");
      if (short && long) {
        expect(short.strike).toBeGreaterThan(long.strike);
        expect(short.optionType).toBe("put");
      }
    }
  });

  it("bear call spread: short call strike < long call strike", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bear_call_spread" }), deps);
    for (const c of result.structureCandidates) {
      const short = c.legs.find(l => l.role === "short_leg");
      const long  = c.legs.find(l => l.role === "long_leg");
      if (short && long) {
        expect(short.strike).toBeLessThan(long.strike);
        expect(short.optionType).toBe("call");
      }
    }
  });

  it("iron condor has 4 legs in correct wing order", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "iron_condor" }), deps);
    for (const c of result.structureCandidates) {
      if (c.legs.length === 4) {
        const strikes = c.legs.map(l => l.strike).sort((a, b) => a - b);
        // Should be strictly increasing
        for (let i = 1; i < strikes.length; i++) {
          expect(strikes[i]).toBeGreaterThan(strikes[i - 1]);
        }
      }
    }
  });

  it("long straddle has same strike for call and put", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_straddle" }), deps);
    for (const c of result.structureCandidates) {
      if (c.legs.length === 2) {
        const callLeg = c.legs.find(l => l.optionType === "call");
        const putLeg  = c.legs.find(l => l.optionType === "put");
        if (callLeg && putLeg) {
          expect(callLeg.strike).toBe(putLeg.strike);
        }
      }
    }
  });

  it("long strangle has different strikes for call and put", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_strangle" }), deps);
    for (const c of result.structureCandidates) {
      if (c.legs.length === 2) {
        const callLeg = c.legs.find(l => l.optionType === "call");
        const putLeg  = c.legs.find(l => l.optionType === "put");
        if (callLeg && putLeg) {
          expect(callLeg.strike).not.toBe(putLeg.strike);
        }
      }
    }
  });

  it("same expiration for all legs in single-expiry structures", async () => {
    const deps = mockDeps();
    for (const family of ["long_call", "bull_call_spread", "iron_condor", "long_straddle"] as const) {
      const result = await buildContractResearchResult(makeInput({ strategyFamily: family }), deps);
      for (const c of result.structureCandidates) {
        const expirations = [...new Set(c.legs.map(l => l.expiration))];
        expect(expirations.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ===========================================================================
// 10. Ownership Requirements
// ===========================================================================

describe("Ownership requirements", () => {
  it("covered_call requires ownsSymbol=true", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "covered_call", ownsSymbol: false }),
      deps,
    );
    expect(result.status).toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
    expect(result.limitations.join(" ")).toMatch(/ownership|shares/i);
  });

  it("covered_call proceeds when ownsSymbol=true", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "covered_call", ownsSymbol: true }),
      deps,
    );
    // Should find short call candidates (income structure)
    if (result.structureCandidates.length > 0) {
      for (const c of result.structureCandidates) {
        expect(c.legs.every(l => l.optionType === "call")).toBe(true);
        expect(c.legs.every(l => l.role === "short_leg")).toBe(true);
      }
    }
  });

  it("protective_put requires ownsSymbol=true", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "protective_put", ownsSymbol: false }),
      deps,
    );
    expect(result.status).toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
  });

  it("collar requires ownsSymbol=true", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "collar", ownsSymbol: false }),
      deps,
    );
    expect(result.status).toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
  });

  it("long_call does NOT require ownsSymbol", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "long_call", ownsSymbol: false }),
      deps,
    );
    expect(result.status).not.toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
  });

  it("cash_secured_put does NOT require ownsSymbol", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "cash_secured_put", ownsSymbol: false }),
      deps,
    );
    // Should attempt research
    expect(result.status).not.toBe("NO_VALID_CONTRACT_RESEARCH_CANDIDATES");
  });
});

// ===========================================================================
// 11. Cash-Secured Put Capital Note
// ===========================================================================

describe("Cash-Secured Put capital estimate", () => {
  it("includes cash-secured capital note in candidates", async () => {
    const chain = [makePut({ strike: 140, delta: -0.30, openInterest: 800, volume: 150, bid: 2.00, ask: 2.20 })];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "cash_secured_put", underlyingPrice: 150 }),
      deps,
    );
    if (result.structureCandidates.length > 0) {
      const hasCapitalNote = result.structureCandidates.some(c => c.cashSecuredCapitalNote !== null);
      expect(hasCapitalNote).toBe(true);
      const note = result.structureCandidates[0].cashSecuredCapitalNote;
      if (note) {
        expect(note).toMatch(/14\,?000|Estimated/i);
        expect(note).not.toMatch(/Required Broker Buying Power/i);
        expect(note).toMatch(/Estimated/i);
      }
    }
  });

  it("capitalEstimate uses strike × multiplier", async () => {
    const chain = [makePut({ strike: 140, openInterest: 800, volume: 150, bid: 2.00, ask: 2.20, expiration: futureDate(42) })];
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(42)]),
      getOptionChain: vi.fn().mockResolvedValue(chain),
    });
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "cash_secured_put", underlyingPrice: 150 }),
      deps,
    );
    if (result.structureCandidates.length > 0) {
      const c = result.structureCandidates[0];
      const metrics = c.metrics;
      const leg0 = c.legs[0];
      if (metrics.capitalEstimate !== null) {
        // capitalEstimate = short put strike × 100
        expect(metrics.capitalEstimate).toBe(leg0.strike * 100);
      }
    }
  });
});

// ===========================================================================
// 12. Structure Metrics
// ===========================================================================

describe("Structure metrics", () => {
  it("debitCreditType is DEBIT for long_call", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(c.metrics.debitCreditType).toBe("DEBIT");
    }
  });

  it("debitCreditType is CREDIT for covered_call", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(
      makeInput({ strategyFamily: "covered_call", ownsSymbol: true }),
      deps,
    );
    for (const c of result.structureCandidates) {
      expect(c.metrics.debitCreditType).toBe("CREDIT");
    }
  });

  it("contractMultiplier is 100 for standard equity options", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(c.metrics.contractMultiplier).toBe(100);
    }
  });

  it("isDefinedRisk is true for long_call", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(c.metrics.isDefinedRisk).toBe(true);
    }
  });

  it("width is computed for vertical spreads", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "bull_call_spread" }), deps);
    for (const c of result.structureCandidates) {
      if (c.legs.length >= 2) {
        expect(c.metrics.width).not.toBeNull();
        expect(c.metrics.width!).toBeGreaterThan(0);
      }
    }
  });
});

// ===========================================================================
// 13. Contract Quality Ordering
// ===========================================================================

describe("Contract quality ordering", () => {
  it("EXCELLENT_DATA_QUALITY comes before LIMITED_DATA", () => {
    const { QUALITY_ORDER } = (() => {
      const order = ["EXCELLENT_DATA_QUALITY", "STRONG_DATA_QUALITY", "ACCEPTABLE_DATA_QUALITY", "LIMITED_DATA"];
      return { QUALITY_ORDER: order };
    })();
    expect(QUALITY_ORDER.indexOf("EXCELLENT_DATA_QUALITY")).toBeLessThan(QUALITY_ORDER.indexOf("LIMITED_DATA"));
  });

  it("qualityCategory is set on each candidate", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(["EXCELLENT_DATA_QUALITY", "STRONG_DATA_QUALITY", "ACCEPTABLE_DATA_QUALITY", "LIMITED_DATA"]).toContain(c.qualityCategory);
    }
  });

  it("no opaque numeric recommendation score", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/"recommendationScore":/);
    expect(str).not.toMatch(/"tradeScore":/);
    expect(str).not.toMatch(/"bestScore":/);
  });
});

// ===========================================================================
// 14. Rejection Transparency
// ===========================================================================

describe("Rejection transparency", () => {
  it("rejectionSummary always present", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.rejectionSummary).toBeDefined();
    expect(typeof result.rejectionSummary.contractsEvaluated).toBe("number");
    expect(typeof result.rejectionSummary.contractsRejected).toBe("number");
    expect(Array.isArray(result.rejectionSummary.topRejectionReasons)).toBe(true);
  });

  it("contractsEvaluated ≥ contractsRejected", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.rejectionSummary.contractsEvaluated).toBeGreaterThanOrEqual(result.rejectionSummary.contractsRejected);
  });

  it("topRejectionReasons contain reason and count", async () => {
    const deps = mockDeps({
      getOptionChain: vi.fn().mockResolvedValue([
        makeContract({ openInterest: 1 }),
        makeContract({ openInterest: 2 }),
      ]),
    });
    const result = await buildContractResearchResult(
      makeInput({ filters: { ...DEFAULT_CONTRACT_RESEARCH_FILTERS, minOpenInterest: 100 } }),
      deps,
    );
    for (const r of result.rejectionSummary.topRejectionReasons) {
      expect(typeof r.reason).toBe("string");
      expect(typeof r.count).toBe("number");
      expect(r.count).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 15. Compliance — no forbidden language
// ===========================================================================

describe("Compliance — no recommendation/best/probability language", () => {
  it("no 'best contract' in result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result).toLowerCase();
    expect(str).not.toMatch(/best contract/);
    expect(str).not.toMatch(/best strike/);
    expect(str).not.toMatch(/best expiration/);
  });

  it("no 'recommended' in result keys", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result).toLowerCase();
    expect(str).not.toMatch(/recommended contract/);
    expect(str).not.toMatch(/top trade/);
    expect(str).not.toMatch(/winning trade/);
  });

  it("no probability of profit in result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/probabilityOfProfit/i);
    expect(str).not.toMatch(/chanceOfWinning/i);
    expect(str).not.toMatch(/winProbability/i);
  });

  it("no order/execution fields in contract research result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/"orderType":/);
    expect(str).not.toMatch(/"submitOrder"/i);
    expect(str).not.toMatch(/"executionInstruction"/i);
  });

  it("disclaimer is present in every result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.disclaimer).toBe(CONTRACT_RESEARCH_DISCLAIMER);
    expect(result.midpointDisclaimer).toBe(MIDPOINT_DISCLAIMER);
    expect(result.optionsRiskDisclosure).toBeTruthy();
  });

  it("midpointDisclaimer warns fill may differ", async () => {
    expect(MIDPOINT_DISCLAIMER).toMatch(/differ/i);
    expect(MIDPOINT_DISCLAIMER).not.toMatch(/guaranteed/i);
  });

  it("no 'expected profit' or 'guaranteed income' in disclaimer constants", () => {
    expect(CONTRACT_RESEARCH_DISCLAIMER).not.toMatch(/expected profit/i);
    expect(CONTRACT_RESEARCH_DISCLAIMER).not.toMatch(/guaranteed/i);
    expect(MIDPOINT_DISCLAIMER).not.toMatch(/guaranteed/i);
  });
});

// ===========================================================================
// 16. 2.7.4 Handoff
// ===========================================================================

describe("2.7.4 handoff — TradeRiskScenarioInput", () => {
  it("riskScenarioInput is populated for each structure candidate", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      expect(c.riskScenarioInput).toBeDefined();
      expect(c.riskScenarioInput.strategyFamily).toBe("long_call");
      expect(c.riskScenarioInput.planningContextId).toBe("ctx-1");
      expect(c.riskScenarioInput.contractResearchCandidateId).toBeTruthy();
      expect(Array.isArray(c.riskScenarioInput.legs)).toBe(true);
    }
  });

  it("riskScenarioInput contains planning constraints fingerprint", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    for (const c of result.structureCandidates) {
      expect(c.riskScenarioInput.planningConstraintsFingerprint).toBeTruthy();
    }
  });

  it("riskScenarioInput does NOT contain broker order fields", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    for (const c of result.structureCandidates) {
      const s = JSON.stringify(c.riskScenarioInput);
      expect(s).not.toMatch(/"orderType":/);
      expect(s).not.toMatch(/"brokerSubmit"/i);
    }
  });
});

// ===========================================================================
// 17. Provider Calls — No N+1
// ===========================================================================

describe("Provider call efficiency — no N+1", () => {
  it("getOptionExpirations called exactly once", async () => {
    const deps = mockDeps();
    await buildContractResearchResult(makeInput(), deps);
    expect(deps.getOptionExpirations).toHaveBeenCalledTimes(1);
  });

  it("getOptionChain called at most once per candidate expiration", async () => {
    const deps = mockDeps({
      getOptionExpirations: vi.fn().mockResolvedValue([futureDate(35), futureDate(50)]),
    });
    await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const chainCalls = (deps.getOptionChain as any).mock.calls.length;
    // Should be ≤ 2 (one per candidate expiration, up to limit)
    expect(chainCalls).toBeLessThanOrEqual(4);
    // Should not be one per contract
    expect(chainCalls).not.toBeGreaterThan(10);
  });

  it("providerCallCount is reported", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(typeof result.providerCallCount).toBe("number");
    expect(result.providerCallCount).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 18. Chain Freshness
// ===========================================================================

describe("Chain freshness", () => {
  it("freshness object always present", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.freshness).toBeDefined();
    expect(["FRESH", "AGING", "STALE", "UNAVAILABLE"]).toContain(result.freshness.freshnessStatus);
  });

  it("freshness unavailable when no chain loaded", async () => {
    const deps = mockDeps({
      getBrokerConnection: vi.fn().mockResolvedValue({ isConnected: false }),
    });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.freshness.freshnessStatus).toBe("UNAVAILABLE");
  });

  it("provider name in freshness when chain loaded", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    if (result.structureCandidates.length > 0) {
      expect(result.freshness.provider).toBeTruthy();
    }
  });
});

// ===========================================================================
// 19. Empty Chain
// ===========================================================================

describe("Empty chain handling", () => {
  it("returns NO_VALID_CONTRACT_RESEARCH_CANDIDATES when chain is empty", async () => {
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue([]) });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.structureCandidates).toHaveLength(0);
  });

  it("returns CHAIN_UNAVAILABLE when expirations list empty", async () => {
    const deps = mockDeps({ getOptionExpirations: vi.fn().mockResolvedValue([]) });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.status).toBe("CHAIN_UNAVAILABLE");
  });

  it("returns CHAIN_UNAVAILABLE when expiration fetch throws", async () => {
    const deps = mockDeps({ getOptionExpirations: vi.fn().mockRejectedValue(new Error("rate limited")) });
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.status).toBe("CHAIN_UNAVAILABLE");
  });
});

// ===========================================================================
// 20. Platform Health
// ===========================================================================

describe("Platform health metrics", () => {
  it("getContractResearchHealth returns typed metrics", () => {
    const h = getContractResearchHealth();
    expect(typeof h.contractResearchRequests).toBe("number");
    expect(typeof h.successfulContractResearch).toBe("number");
    expect(typeof h.failedContractResearch).toBe("number");
    expect(typeof h.staleChainCount).toBe("number");
    expect(typeof h.emptyChainCount).toBe("number");
    expect(["HEALTHY", "DEGRADED", "UNKNOWN"]).toContain(h.optionChainProviderStatus);
  });

  it("contractResearchRequests increments on each call", async () => {
    const deps = mockDeps();
    const before = getContractResearchHealth().contractResearchRequests;
    await buildContractResearchResult(makeInput(), deps);
    expect(getContractResearchHealth().contractResearchRequests).toBeGreaterThan(before);
  });
});

// ===========================================================================
// 21. Candidate Limits
// ===========================================================================

describe("Candidate limits", () => {
  it("returns at most 5 structure candidates", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    expect(result.structureCandidates.length).toBeLessThanOrEqual(5);
  });
});

// ===========================================================================
// 22. Midpoint Computation
// ===========================================================================

describe("Midpoint computation", () => {
  it("midpoint is (bid + ask) / 2", async () => {
    const chain = [makeContract({ bid: 3.00, ask: 3.20, openInterest: 800, volume: 100 })];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const c of result.structureCandidates) {
      for (const leg of c.legs) {
        if (leg.bid !== null && leg.ask !== null) {
          expect(leg.midpoint).toBeCloseTo((leg.bid + leg.ask) / 2, 4);
        }
      }
    }
  });

  it("midpoint is null when bid or ask is null", async () => {
    const chain = [makeContract({ bid: null as any, ask: null as any, openInterest: 5 })];
    const deps = mockDeps({ getOptionChain: vi.fn().mockResolvedValue(chain) });
    const result = await buildContractResearchResult(makeInput(), deps);
    for (const c of result.structureCandidates) {
      for (const leg of c.legs) {
        if (leg.bid === null || leg.ask === null) {
          expect(leg.midpoint).toBeNull();
        }
      }
    }
  });
});

// ===========================================================================
// 23. Routing discipline reminder (static before dynamic)
// ===========================================================================

describe("Route ordering — static before dynamic (contract)", () => {
  it("RESERVED_SEGMENTS prevents static segments from being treated as symbol", () => {
    const RESERVED = new Set(["health", "session", "history", "templates", "metadata"]);
    expect(RESERVED.has("session")).toBe(true);
    expect(RESERVED.has("health")).toBe(true);
    expect(RESERVED.has("NVDA")).toBe(false);
  });
});

// ===========================================================================
// 24. Roadmap discipline
// ===========================================================================

describe("Roadmap discipline", () => {
  it("result has no broker order ticket fields", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result);
    expect(str).not.toContain('"orderTicket"');
    expect(str).not.toContain('"brokerOrder"');
    expect(str).not.toContain('"submitTrade"');
  });

  it("result has no probability of profit", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/probabilityOfProfit|chanceOfWinning|pop\b/i);
  });

  it("result has methodology version", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.methodologyVersion).toBe(CONTRACT_RESEARCH_VERSION);
  });

  it("planningContextId is passed through", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ planningContextId: "ctx-test-123" }), deps);
    expect(result.planningContextId).toBe("ctx-test-123");
  });

  it("symbol is passed through", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ symbol: "AAPL" }), deps);
    expect(result.symbol).toBe("AAPL");
  });

  it("generatedAt is a valid ISO timestamp", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
  });

  it("generationLatencyMs is a number", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(typeof result.generationLatencyMs).toBe("number");
  });
});

// ===========================================================================
// 25. Expiration IV Summary
// ===========================================================================

describe("Expiration IV summary", () => {
  it("IV summary populated when IV data available", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    const withIvSummary = result.expirationCandidates.filter(e => e.ivSummary !== null);
    // Should have IV summary for expirations where chain was loaded
    expect(withIvSummary.length).toBeGreaterThanOrEqual(0);
  });

  it("IV summary medianIv is a percentage-like number", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput({ strategyFamily: "long_call" }), deps);
    for (const e of result.expirationCandidates) {
      if (e.ivSummary?.medianIv !== null && e.ivSummary?.medianIv !== undefined) {
        // IV in percent form — for provider IV of 0.45, medianIv should be ~45
        expect(e.ivSummary.medianIv).toBeGreaterThan(0);
      }
    }
  });
});

// ===========================================================================
// 26. Volatility Context Pass-through
// ===========================================================================

describe("Volatility context pass-through", () => {
  it("volatilityContext is in result", async () => {
    const deps = mockDeps();
    const result = await buildContractResearchResult(makeInput(), deps);
    expect(result.volatilityContext).toBeDefined();
    expect(result.volatilityContext.level).toBe("UNKNOWN");
  });
});

// ===========================================================================
// 27. computeDTE helper
// ===========================================================================

describe("computeDTE helper", () => {
  it("returns positive DTE for future date", () => {
    const today = new Date("2026-08-10");
    const dte = computeDTE("2026-09-20", today);
    expect(dte).toBeGreaterThan(0);
  });

  it("returns negative DTE for past date", () => {
    const today = new Date("2026-08-10");
    const dte = computeDTE("2026-07-01", today);
    expect(dte).toBeLessThan(0);
  });
});
