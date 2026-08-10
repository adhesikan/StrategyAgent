/**
 * Options Contract Research Engine — Sprint 2.7.3
 *
 * Deterministic pipeline:
 *   1. Load authoritative planning context
 *   2. Validate selected strategy family
 *   3. Check broker connection + capability
 *   4. Load option expirations (1 broker call)
 *   5. Filter expirations by DTE + event rules
 *   6. Load normalized chains per candidate expiration (1 call each — no N+1)
 *   7. Apply liquidity filters
 *   8. Apply delta/moneyness rules
 *   9. Construct valid strategy structures
 *  10. Validate multi-leg consistency
 *  11. Compute current structure metrics
 *  12. Order by ContractQualityCategory
 *  13. Return bounded candidate set with full rejection transparency
 *
 * PERMANENT RULES:
 *   - Selected strategy family required; never auto-substituted
 *   - Missing Greeks → null; never zero-fill
 *   - No Probability of Profit; no recommendation language
 *   - No order construction; no broker order submission
 *   - No N+1: one chain fetch per expiration
 *   - Cross-user isolation enforced at route level
 *   - No fabricated quotes, Greeks, or prices
 */

import {
  getOptionExpirations,
  getOptionChain,
  getBrokerCapabilities,
} from "../broker";
import { storage } from "../storage";
import type { OptionChainContract } from "../broker/providers/tradier";
import {
  computeDTE,
  normalizeOptionChainContract,
  resolveExpirations,
} from "./live-contract-resolver";
import type { NormalizedOptionContract } from "./live-contract-resolver";
import type {
  OptionsStrategyFamily,
  ThesisDirection,
  VolatilityContext,
  EventContext,
} from "../../shared/options-strategy-types";
import type {
  DteBucket,
  ExpirationResearchCandidate,
  ExpirationStatus,
  EventRelation,
  ExpirationIvSummary,
  ContractResearchLeg,
  ContractResearchMetrics,
  OptionsStructureResearchCandidate,
  StructureEventExposure,
  ContractResearchFilters,
  OptionsContractResearchResult,
  ContractResearchRejectionSummary,
  ContractResearchFreshness,
  ContractResearchStatus,
  ContractQualityCategory,
  ContractLiquidityQuality,
  Moneyness,
  TradeRiskScenarioInput,
  ContractResearchHealthMetrics,
} from "../../shared/contract-research-types";
import {
  DEFAULT_CONTRACT_RESEARCH_FILTERS,
  LIQUIDITY_THRESHOLDS,
  ATM_BAND_PCT,
  DTE_BUCKET_RANGES,
  CONTRACT_RESEARCH_DISCLAIMER,
  MIDPOINT_DISCLAIMER,
  OPTIONS_RISK_DISCLOSURE_EXTENDED,
  CONTRACT_RESEARCH_VERSION,
} from "../../shared/contract-research-types";

// ===========================================================================
// In-memory health metrics (admin aggregate only — no user/symbol data)
// ===========================================================================

let _health: ContractResearchHealthMetrics = {
  contractResearchRequests:         0,
  successfulContractResearch:       0,
  partialContractResearch:          0,
  failedContractResearch:           0,
  noValidCandidates:                0,
  requiresBrokerCount:              0,
  staleChainCount:                  0,
  emptyChainCount:                  0,
  averageContractResearchLatencyMs: null,
  lastSuccessfulContractResearchAt: null,
  optionChainProviderStatus:        "UNKNOWN",
};

const _latencySamples: number[] = [];
const MAX_LATENCY_SAMPLES = 100;

function recordLatency(ms: number): void {
  _latencySamples.push(ms);
  if (_latencySamples.length > MAX_LATENCY_SAMPLES) _latencySamples.shift();
  const sum = _latencySamples.reduce((a, b) => a + b, 0);
  _health.averageContractResearchLatencyMs = Math.round(sum / _latencySamples.length);
}

export function getContractResearchHealth(): ContractResearchHealthMetrics {
  return { ..._health };
}

// ===========================================================================
// Dependency injection (enables pure unit tests)
// ===========================================================================

export interface ContractResearchDeps {
  getBrokerConnection:  (userId: string) => Promise<{ provider: string; isConnected: boolean } | null | undefined>;
  getBrokerCapabilities:(userId: string) => Promise<{ optionsChain?: boolean } | null>;
  getOptionExpirations: (userId: string, symbol: string) => Promise<string[]>;
  getOptionChain:       (userId: string, symbol: string, expiration: string) => Promise<OptionChainContract[]>;
}

const defaultDeps: ContractResearchDeps = {
  getBrokerConnection:   (userId) => storage.getBrokerConnection(userId) as Promise<any>,
  getBrokerCapabilities: (userId) => getBrokerCapabilities(userId) as Promise<any>,
  getOptionExpirations:  (userId, symbol) => getOptionExpirations(userId, symbol),
  getOptionChain:        (userId, symbol, exp) => getOptionChain(userId, symbol, exp),
};

// ===========================================================================
// DTE bucket mapping per strategy family + research horizon
// ===========================================================================

/** Primary DTE target range per strategy family.
 *  Documented methodology — not arbitrary magic numbers.
 *  Research horizon label adjusts within these bounds. */
const FAMILY_DTE_DEFAULTS: Record<OptionsStrategyFamily, { min: number; max: number; label: string; note: string }> = {
  long_call:         { min: 30, max: 90,  label: "30–90 DTE",  note: "Medium-term bullish: enough time value, manageable theta." },
  long_put:          { min: 20, max: 60,  label: "20–60 DTE",  note: "Medium-term bearish: moderate DTE to capture move." },
  bull_call_spread:  { min: 30, max: 60,  label: "30–60 DTE",  note: "Defined-risk bullish: medium DTE balances time value and theta." },
  bear_put_spread:   { min: 30, max: 60,  label: "30–60 DTE",  note: "Defined-risk bearish: medium DTE." },
  bull_put_spread:   { min: 20, max: 45,  label: "20–45 DTE",  note: "Income credit spread: shorter DTE accelerates theta." },
  bear_call_spread:  { min: 20, max: 45,  label: "20–45 DTE",  note: "Income credit spread: shorter DTE." },
  covered_call:      { min: 20, max: 45,  label: "20–45 DTE",  note: "Income: monthly cycle, theta acceleration." },
  cash_secured_put:  { min: 20, max: 45,  label: "20–45 DTE",  note: "Income: monthly cycle." },
  protective_put:    { min: 30, max: 90,  label: "30–90 DTE",  note: "Protection: sufficient time to cover intended window." },
  collar:            { min: 30, max: 90,  label: "30–90 DTE",  note: "Protective + income: medium-long horizon." },
  iron_condor:       { min: 30, max: 60,  label: "30–60 DTE",  note: "Neutral: medium DTE for theta collection." },
  iron_butterfly:    { min: 20, max: 45,  label: "20–45 DTE",  note: "Neutral: shorter DTE for ATM premium." },
  long_straddle:     { min: 20, max: 45,  label: "20–45 DTE",  note: "Volatility: enough premium decay window." },
  long_strangle:     { min: 20, max: 45,  label: "20–45 DTE",  note: "Volatility: similar to straddle." },
  calendar_spread:   { min: 15, max: 60,  label: "15–60 DTE",  note: "Near leg: 15–30; far leg: 45–60+. Evaluated per leg." },
  diagonal_spread:   { min: 15, max: 60,  label: "15–60 DTE",  note: "Near leg: 15–30; far leg: 45–60+." },
  monitor_only:      { min: 1,  max: 730, label: "Any",        note: "Monitor only: no contract research applicable." },
};

function getDteRange(
  family: OptionsStrategyFamily,
  filters: ContractResearchFilters,
): { min: number; max: number; label: string } {
  if (filters.dteMin !== null && filters.dteMax !== null) {
    return {
      min:   Math.max(1, filters.dteMin),
      max:   Math.min(730, filters.dteMax),
      label: `${filters.dteMin}–${filters.dteMax} DTE (user filter)`,
    };
  }
  return FAMILY_DTE_DEFAULTS[family];
}

function classifyDteBucket(dte: number): DteBucket | null {
  for (const [bucket, range] of Object.entries(DTE_BUCKET_RANGES) as Array<[DteBucket, typeof DTE_BUCKET_RANGES[DteBucket]]>) {
    if (dte >= range.min && dte <= range.max) return bucket;
  }
  return null;
}

// ===========================================================================
// Moneyness classification
// ===========================================================================

function classifyMoneyness(strike: number, underlying: number, optionType: "call" | "put"): Moneyness {
  const distancePct = Math.abs(strike - underlying) / underlying;
  if (distancePct <= ATM_BAND_PCT) return "ATM";
  if (optionType === "call") return strike < underlying ? "ITM" : "OTM";
  return strike > underlying ? "ITM" : "OTM";
}

function strikeDistancePct(strike: number, underlying: number): number {
  return ((strike - underlying) / underlying) * 100;
}

// ===========================================================================
// Liquidity classification (2.7.3 thresholds — transparent)
// ===========================================================================

function classifyContractLiquidity(contract: NormalizedOptionContract): ContractLiquidityQuality {
  const bid = contract.bid;
  const ask = contract.ask;
  const oi  = contract.openInterest;
  const vol = contract.volume;

  if (bid === null || ask === null) return "UNKNOWN";
  if (bid > ask) return "POOR";             // crossed market
  if (ask <= 0)  return "POOR";

  const midpoint = (bid + ask) / 2;
  const spreadAbs = ask - bid;
  const spreadPct = midpoint > 0 ? spreadAbs / midpoint : null;

  const strongLiq = (
    (oi  ?? 0) >= LIQUIDITY_THRESHOLDS.STRONG_MIN_OI &&
    (vol ?? 0) >= LIQUIDITY_THRESHOLDS.STRONG_MIN_VOLUME &&
    spreadPct !== null && spreadPct < LIQUIDITY_THRESHOLDS.STRONG_MAX_SPREAD_PCT
  );
  if (strongLiq) return "STRONG";

  const acceptableLiq = (
    (oi ?? 0) >= LIQUIDITY_THRESHOLDS.ACCEPTABLE_MIN_OI &&
    spreadPct !== null && spreadPct < LIQUIDITY_THRESHOLDS.ACCEPTABLE_MAX_SPREAD_PCT
  );
  if (acceptableLiq) return "ACCEPTABLE";

  const limitedLiq = (
    (oi ?? 0) >= LIQUIDITY_THRESHOLDS.LIMITED_MIN_OI &&
    spreadPct !== null && spreadPct < LIQUIDITY_THRESHOLDS.LIMITED_MAX_SPREAD_PCT
  );
  if (limitedLiq) return "LIMITED";

  return "POOR";
}

function overallLiquidityFromLegs(legs: ContractResearchLeg[]): ContractLiquidityQuality {
  if (legs.length === 0) return "UNKNOWN";
  const order: ContractLiquidityQuality[] = ["POOR", "UNKNOWN", "LIMITED", "ACCEPTABLE", "STRONG"];
  let worst: ContractLiquidityQuality = "STRONG";
  for (const leg of legs) {
    const li = order.indexOf(leg.liquidity);
    const wi = order.indexOf(worst);
    if (li < wi) worst = leg.liquidity;
  }
  return worst;
}

function liquidityToQualityCategory(
  liq: ContractLiquidityQuality,
  hasFullGreeks: boolean,
  isFresh: boolean,
): ContractQualityCategory {
  if (liq === "STRONG"     && hasFullGreeks && isFresh) return "EXCELLENT_DATA_QUALITY";
  if (liq === "ACCEPTABLE" && isFresh)                  return "STRONG_DATA_QUALITY";
  if (liq === "LIMITED"   || !isFresh)                  return "ACCEPTABLE_DATA_QUALITY";
  return "LIMITED_DATA";
}

const QUALITY_ORDER: ContractQualityCategory[] = [
  "EXCELLENT_DATA_QUALITY",
  "STRONG_DATA_QUALITY",
  "ACCEPTABLE_DATA_QUALITY",
  "LIMITED_DATA",
];

// ===========================================================================
// Expiration IV summary
// ===========================================================================

function buildExpirationIvSummary(chain: NormalizedOptionContract[]): ExpirationIvSummary | null {
  const ivs = chain.map(c => c.impliedVolatility).filter((v): v is number => v !== null && v > 0);
  if (ivs.length === 0) return null;
  ivs.sort((a, b) => a - b);
  const mid = Math.floor(ivs.length / 2);
  const median = ivs.length % 2 === 0
    ? (ivs[mid - 1] + ivs[mid]) / 2
    : ivs[mid];
  return {
    medianIv: Math.round(median * 10000) / 100,  // % with 2 decimals
    minIv:    Math.round(ivs[0]  * 10000) / 100,
    maxIv:    Math.round(ivs[ivs.length - 1] * 10000) / 100,
    note:     "IV values are from provider data; interpret relative to strategy family and historical context.",
  };
}

// ===========================================================================
// Event window logic
// ===========================================================================

function determineEventRelation(
  expiration: string,
  eventContext: EventContext | null,
  today: Date,
): EventRelation {
  if (!eventContext?.hasUpcomingEvent) return "no_event_detected";
  if (!eventContext.daysUntilEvent)    return "event_unknown";

  const eventDate = new Date(today.getTime() + eventContext.daysUntilEvent * 24 * 60 * 60 * 1000);
  const expDate   = new Date(expiration + "T16:00:00-05:00");

  if (expDate < eventDate)  return "before_event";
  if (expDate >= eventDate) {
    // contains event if eventDate is within the holding window
    if (eventContext.daysUntilEvent <= computeDTE(expiration, today)) return "contains_event";
    return "after_event";
  }
  return "no_event_detected";
}

// ===========================================================================
// Leg builder helpers
// ===========================================================================

function buildLeg(
  index: number,
  role: ContractResearchLeg["role"],
  roleLabel: string,
  contract: NormalizedOptionContract,
  underlying: number,
): ContractResearchLeg {
  const bid     = contract.bid;
  const ask     = contract.ask;
  const midpoint = bid !== null && ask !== null && bid <= ask ? (bid + ask) / 2 : null;
  const spreadAbs = bid !== null && ask !== null ? ask - bid : null;
  const spreadPct = midpoint && midpoint > 0 && spreadAbs !== null ? spreadAbs / midpoint : null;

  return {
    legIndex:          index,
    role,
    roleLabel,
    optionType:        contract.optionType,
    strike:            contract.strike,
    expiration:        contract.expiration,
    dte:               computeDTE(contract.expiration, new Date()),
    contractSymbol:    contract.symbol,
    moneyness:         classifyMoneyness(contract.strike, underlying, contract.optionType),
    strikeDistancePct: +strikeDistancePct(contract.strike, underlying).toFixed(2),
    bid,
    ask,
    midpoint:          midpoint !== null ? +midpoint.toFixed(4) : null,
    spreadAbs:         spreadAbs !== null ? +spreadAbs.toFixed(4) : null,
    spreadPct:         spreadPct !== null ? +spreadPct.toFixed(4) : null,
    volume:            contract.volume,
    openInterest:      contract.openInterest,
    impliedVolatility: contract.impliedVolatility,
    delta:             contract.delta,
    gamma:             contract.gamma,
    theta:             contract.theta,
    vega:              contract.vega,
    rho:               contract.rho,
    liquidity:         classifyContractLiquidity(contract),
    updatedAt:         contract.updatedAt,
  };
}

function hasFullGreeks(legs: ContractResearchLeg[]): boolean {
  return legs.every(l => l.delta !== null && l.theta !== null && l.vega !== null);
}

function isChainFresh(legs: ContractResearchLeg[]): boolean {
  const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
  return legs.some(l => {
    if (!l.updatedAt) return false;
    return Date.now() - new Date(l.updatedAt).getTime() < STALE_THRESHOLD_MS;
  });
}

function computeNetGreeks(legs: ContractResearchLeg[], multiplierSign: number[]): {
  netDelta: number | null; netTheta: number | null; netVega: number | null; netGamma: number | null;
} {
  let netDelta = 0, netTheta = 0, netVega = 0, netGamma = 0;
  let hasDelta = true, hasTheta = true, hasVega = true, hasGamma = true;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const sign = multiplierSign[i] ?? 1;
    if (leg.delta === null) hasDelta = false; else netDelta += leg.delta * sign;
    if (leg.theta === null) hasTheta = false; else netTheta += leg.theta * sign;
    if (leg.vega  === null) hasVega  = false; else netVega  += leg.vega  * sign;
    if (leg.gamma === null) hasGamma = false; else netGamma += leg.gamma * sign;
  }
  return {
    netDelta: hasDelta ? +netDelta.toFixed(4) : null,
    netTheta: hasTheta ? +netTheta.toFixed(4) : null,
    netVega:  hasVega  ? +netVega.toFixed(4)  : null,
    netGamma: hasGamma ? +netGamma.toFixed(4) : null,
  };
}

// ===========================================================================
// Metrics computation
// ===========================================================================

function buildMetrics(
  family: OptionsStrategyFamily,
  legs: ContractResearchLeg[],
  underlying: number,
  multiplierSigns: number[],
): ContractResearchMetrics {
  const multiplier = 100;
  const { netDelta, netTheta, netVega, netGamma } = computeNetGreeks(legs, multiplierSigns);

  // Net midpoint pricing
  let netMidpoint: number | null = null;
  let allMidpointsAvailable = legs.every(l => l.midpoint !== null);
  if (allMidpointsAvailable) {
    netMidpoint = legs.reduce((sum, leg, i) => sum + (leg.midpoint! * (multiplierSigns[i] ?? 1)), 0);
    netMidpoint = +netMidpoint.toFixed(4);
  }

  const isCredit = ["covered_call", "cash_secured_put", "bull_put_spread", "bear_call_spread",
                     "iron_condor", "iron_butterfly", "calendar_spread"].includes(family) ||
                   (netMidpoint !== null && netMidpoint < 0);
  const isDebit  = !isCredit && netMidpoint !== null && netMidpoint >= 0;

  const estimatedDebit  = isDebit  && netMidpoint !== null ? +Math.abs(netMidpoint).toFixed(4) : null;
  const estimatedCredit = isCredit && netMidpoint !== null ? +Math.abs(netMidpoint).toFixed(4) : null;

  // Width for spreads
  let width: number | null = null;
  if (legs.length >= 2) {
    const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
    width = +(strikes[strikes.length - 1] - strikes[0]).toFixed(2);
  }

  // Cash-secured capital estimate
  let capitalEstimate: number | null = null;
  if (family === "cash_secured_put" && legs[0]) {
    capitalEstimate = +(legs[0].strike * multiplier).toFixed(2);
  }

  // Intrinsic / extrinsic (single-leg only — multi-leg intrinsic is complex)
  let intrinsicValue: number | null = null;
  let extrinsicValue: number | null = null;
  if (legs.length === 1) {
    const leg = legs[0];
    const intrinsic = leg.optionType === "call"
      ? Math.max(0, underlying - leg.strike)
      : Math.max(0, leg.strike - underlying);
    intrinsicValue = +intrinsic.toFixed(4);
    if (leg.midpoint !== null) {
      extrinsicValue = +Math.max(0, leg.midpoint - intrinsic).toFixed(4);
    }
  }

  const isDefinedRisk = [
    "long_call", "long_put", "bull_call_spread", "bear_put_spread",
    "bull_put_spread", "bear_call_spread", "protective_put", "collar",
    "iron_condor", "iron_butterfly", "long_straddle", "long_strangle",
    "calendar_spread", "diagonal_spread",
  ].includes(family);

  return {
    estimatedDebit,
    estimatedCredit,
    width,
    capitalEstimate,
    intrinsicValue,
    extrinsicValue,
    netDelta,
    netTheta,
    netVega,
    netGamma,
    contractMultiplier: multiplier,
    isDefinedRisk,
    debitCreditType: isDebit ? "DEBIT" : isCredit ? "CREDIT" : null,
  };
}

// ===========================================================================
// Candidate ID
// ===========================================================================

let _candidateSeq = 0;
function newCandidateId(): string {
  return `cr-${Date.now()}-${++_candidateSeq}`;
}

// ===========================================================================
// Structure builders (per family)
// Returns null if structure cannot be validly constructed from available chain
// ===========================================================================

function findCallsNearDelta(
  chain: NormalizedOptionContract[],
  targetDeltaMin: number,
  targetDeltaMax: number,
  underlying: number,
  expiration: string,
): NormalizedOptionContract[] {
  const calls = chain.filter(c =>
    c.optionType === "call" && c.expiration === expiration
  );
  if (calls.length === 0) return [];
  // Try delta-based selection if available
  const withDelta = calls.filter(c => c.delta !== null &&
    Math.abs(c.delta) >= targetDeltaMin && Math.abs(c.delta) <= targetDeltaMax);
  if (withDelta.length > 0) {
    withDelta.sort((a, b) => Math.abs(b.delta! - (targetDeltaMin + targetDeltaMax) / 2)
                           - Math.abs(a.delta! - (targetDeltaMin + targetDeltaMax) / 2));
    return withDelta.slice(0, 3);
  }
  // Fallback: moneyness-based (near ATM)
  const sorted = calls.slice().sort((a, b) =>
    Math.abs(a.strike - underlying) - Math.abs(b.strike - underlying)
  );
  return sorted.slice(0, 3);
}

function findPutsNearDelta(
  chain: NormalizedOptionContract[],
  targetDeltaMin: number,
  targetDeltaMax: number,
  underlying: number,
  expiration: string,
): NormalizedOptionContract[] {
  const puts = chain.filter(c =>
    c.optionType === "put" && c.expiration === expiration
  );
  if (puts.length === 0) return [];
  const withDelta = puts.filter(c => c.delta !== null &&
    Math.abs(c.delta) >= targetDeltaMin && Math.abs(c.delta) <= targetDeltaMax);
  if (withDelta.length > 0) {
    withDelta.sort((a, b) => Math.abs(b.delta! - (targetDeltaMin + targetDeltaMax) / 2)
                           - Math.abs(a.delta! - (targetDeltaMin + targetDeltaMax) / 2));
    return withDelta.slice(0, 3);
  }
  const sorted = puts.slice().sort((a, b) =>
    Math.abs(a.strike - underlying) - Math.abs(b.strike - underlying)
  );
  return sorted.slice(0, 3);
}

function findAtmContracts(
  chain: NormalizedOptionContract[],
  type: "call" | "put",
  underlying: number,
  expiration: string,
): NormalizedOptionContract[] {
  return chain.filter(c => c.optionType === type && c.expiration === expiration)
    .slice().sort((a, b) => Math.abs(a.strike - underlying) - Math.abs(b.strike - underlying))
    .slice(0, 2);
}

function findOtmContracts(
  chain: NormalizedOptionContract[],
  type: "call" | "put",
  underlying: number,
  expiration: string,
  minOtmPct = 0.02,
  maxOtmPct = 0.08,
): NormalizedOptionContract[] {
  return chain.filter(c => {
    if (c.optionType !== type || c.expiration !== expiration) return false;
    if (type === "call") {
      const pct = (c.strike - underlying) / underlying;
      return pct >= minOtmPct && pct <= maxOtmPct;
    } else {
      const pct = (underlying - c.strike) / underlying;
      return pct >= minOtmPct && pct <= maxOtmPct;
    }
  }).slice().sort((a, b) => Math.abs(a.strike - underlying) - Math.abs(b.strike - underlying))
    .slice(0, 3);
}

interface BuiltStructure {
  legs:    ContractResearchLeg[];
  signs:   number[];       // +1 long, -1 short (for net Greek computation)
  reasons: string[];
  warnings: string[];
}

function buildSingleLeg(
  contract: NormalizedOptionContract,
  role: ContractResearchLeg["role"],
  roleLabel: string,
  underlying: number,
  reasons: string[],
): BuiltStructure {
  const leg = buildLeg(0, role, roleLabel, contract, underlying);
  return { legs: [leg], signs: [1], reasons, warnings: [] };
}

function buildVerticalSpread(
  longContract: NormalizedOptionContract,
  shortContract: NormalizedOptionContract,
  underlying: number,
  reasons: string[],
): BuiltStructure | null {
  // Validate strike ordering
  if (longContract.optionType !== shortContract.optionType) return null;
  if (longContract.expiration !== shortContract.expiration) return null;
  if (longContract.strike === shortContract.strike) return null;

  const longLeg  = buildLeg(0, "long_leg",  "Long Leg",  longContract,  underlying);
  const shortLeg = buildLeg(1, "short_leg", "Short Leg", shortContract, underlying);
  const warnings: string[] = [];

  // Validate call spread ordering (long strike < short strike for bull call)
  // We just build the legs — caller validates ordering per family
  if (Math.abs(longContract.strike - shortContract.strike) < 0.01) {
    warnings.push("Long and short strikes are the same — spread width is zero.");
    return null;
  }

  return { legs: [longLeg, shortLeg], signs: [1, -1], reasons, warnings };
}

function buildIronCondor(
  shortPut: NormalizedOptionContract,
  longPut:  NormalizedOptionContract,
  shortCall: NormalizedOptionContract,
  longCall:  NormalizedOptionContract,
  underlying: number,
  reasons: string[],
): BuiltStructure | null {
  // Validate wing ordering: longPut < shortPut < shortCall < longCall
  if (!(longPut.strike < shortPut.strike &&
        shortPut.strike < shortCall.strike &&
        shortCall.strike < longCall.strike)) {
    return null;
  }
  if (longPut.expiration !== shortPut.expiration  ||
      shortPut.expiration !== shortCall.expiration ||
      shortCall.expiration !== longCall.expiration)  return null;

  return {
    legs: [
      buildLeg(0, "wing_long",  "Long Put Wing",   longPut,   underlying),
      buildLeg(1, "short_leg",  "Short Put",        shortPut,  underlying),
      buildLeg(2, "short_leg",  "Short Call",       shortCall, underlying),
      buildLeg(3, "wing_long",  "Long Call Wing",   longCall,  underlying),
    ],
    signs:    [1, -1, -1, 1],
    reasons,
    warnings: [],
  };
}

function buildIronButterfly(
  longPut:  NormalizedOptionContract,
  atmPut:   NormalizedOptionContract,
  atmCall:  NormalizedOptionContract,
  longCall: NormalizedOptionContract,
  underlying: number,
  reasons: string[],
): BuiltStructure | null {
  // ATM strikes should be equal (same strike)
  if (Math.abs(atmPut.strike - atmCall.strike) > 0.01) return null;
  if (!(longPut.strike < atmPut.strike && atmCall.strike < longCall.strike)) return null;
  if (longPut.expiration !== atmPut.expiration) return null;

  return {
    legs: [
      buildLeg(0, "wing_long",  "Long Put Wing",   longPut,  underlying),
      buildLeg(1, "short_leg",  "Short ATM Put",   atmPut,   underlying),
      buildLeg(2, "short_leg",  "Short ATM Call",  atmCall,  underlying),
      buildLeg(3, "wing_long",  "Long Call Wing",  longCall, underlying),
    ],
    signs:    [1, -1, -1, 1],
    reasons,
    warnings: [],
  };
}

// ===========================================================================
// Structure construction per strategy family
// ===========================================================================

function buildStructureCandidates(
  family: OptionsStrategyFamily,
  chain: NormalizedOptionContract[],
  expiration: string,
  dte: number,
  underlying: number,
  filters: ContractResearchFilters,
  ownsSymbol: boolean,
  eventExposure: StructureEventExposure,
  rejections: Map<string, number>,
  planningContextId: string,
  thesisDirection: ThesisDirection,
  invalidationNote: string | null,
  constraintsFp: string,
): OptionsStructureResearchCandidate[] {
  const candidates: OptionsStructureResearchCandidate[] = [];
  const expirationLabel = `${new Date(expiration + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;

  function addRejection(reason: string) {
    rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
  }

  function passesLiquidityFilter(contract: NormalizedOptionContract): boolean {
    const liq = classifyContractLiquidity(contract);
    if (liq === "POOR") {
      addRejection("Poor liquidity");
      return false;
    }
    const oi = contract.openInterest ?? 0;
    const minOi = filters.minOpenInterest ?? 10;
    if (oi < minOi) {
      addRejection(`Open interest below minimum (${minOi})`);
      return false;
    }
    if (filters.minVolume !== null && (contract.volume ?? 0) < filters.minVolume) {
      addRejection(`Volume below minimum (${filters.minVolume})`);
      return false;
    }
    if (filters.maxBidAskSpreadPct !== null) {
      const bid = contract.bid ?? 0;
      const ask = contract.ask ?? 0;
      const mid = (bid + ask) / 2;
      const spread = mid > 0 ? (ask - bid) / mid : 1;
      if (spread > filters.maxBidAskSpreadPct) {
        addRejection(`Bid/ask spread too wide (${(spread * 100).toFixed(0)}%)`);
        return false;
      }
    }
    return true;
  }

  function buildCandidate(structure: BuiltStructure, reasons: string[], cashNote: string | null): OptionsStructureResearchCandidate {
    const { legs, signs } = structure;
    const metrics = buildMetrics(family, legs, underlying, signs);
    const overallLiq = overallLiquidityFromLegs(legs);
    const fullGreeks = hasFullGreeks(legs);
    const fresh = isChainFresh(legs);
    const qualityCategory = liquidityToQualityCategory(overallLiq, fullGreeks, fresh);
    const warnings = [...structure.warnings];
    if (!fullGreeks) warnings.push("Some Greeks are unavailable; net position Greeks cannot be fully computed.");
    if (!fresh) warnings.push("Quote freshness could not be confirmed; verify current pricing.");
    if (eventExposure.containsEarnings) warnings.push(`Event exposure: ${eventExposure.eventNote}`);

    const candidateId = newCandidateId();
    const riskScenarioInput: TradeRiskScenarioInput = {
      planningContextId,
      contractResearchCandidateId: candidateId,
      strategyFamily: family,
      legs,
      currentStructureMetrics: metrics,
      researchThesisSummary: `${thesisDirection} thesis — ${family}`,
      invalidationNote,
      planningConstraintsFingerprint: constraintsFp,
    };

    return {
      id: candidateId,
      strategyFamily: family,
      strategyLabel: FAMILY_LABELS[family] ?? family,
      expiration,
      dte,
      expirationLabel,
      legs,
      metrics,
      overallLiquidity: overallLiq,
      qualityCategory,
      researchReasons: reasons,
      warnings,
      rejectionReasons: [],
      eventExposure,
      underlyingPriceRef: underlying,
      underlyingPriceLabel: `$${underlying.toFixed(2)} (reference price)`,
      cashSecuredCapitalNote: cashNote,
      riskScenarioInput,
    };
  }

  switch (family) {
    case "long_call": {
      const calls = findCallsNearDelta(chain, 0.40, 0.70, underlying, expiration);
      for (const c of calls) {
        if (!passesLiquidityFilter(c)) continue;
        const s = buildSingleLeg(c, "long_leg", "Long Call Research Leg", underlying, [
          `Strike: $${c.strike} (${classifyMoneyness(c.strike, underlying, "call")})`,
          "Long call: benefits from underlying price appreciation above the strike.",
        ]);
        candidates.push(buildCandidate(s, [...s.reasons, ...["Bullish directional thesis; long call captures upside."]], null));
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "long_put": {
      const puts = findPutsNearDelta(chain, 0.35, 0.65, underlying, expiration);
      for (const p of puts) {
        if (!passesLiquidityFilter(p)) continue;
        const s = buildSingleLeg(p, "long_leg", "Long Put Research Leg", underlying, [
          `Strike: $${p.strike} (${classifyMoneyness(p.strike, underlying, "put")})`,
          "Long put: benefits from underlying price decline below the strike.",
        ]);
        candidates.push(buildCandidate(s, [...s.reasons], null));
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "bull_call_spread": {
      const longCalls  = findCallsNearDelta(chain, 0.45, 0.65, underlying, expiration);
      const shortCalls = findCallsNearDelta(chain, 0.20, 0.40, underlying, expiration);
      for (const lc of longCalls) {
        if (!passesLiquidityFilter(lc)) continue;
        for (const sc of shortCalls) {
          if (!passesLiquidityFilter(sc)) continue;
          if (sc.strike <= lc.strike) { addRejection("Bull call spread: short strike must be above long strike"); continue; }
          const s = buildVerticalSpread(lc, sc, underlying, [
            `Long call: $${lc.strike} strike; short call: $${sc.strike} strike.`,
            "Bull call spread: defined-risk bullish structure. Max gain limited to spread width minus debit.",
          ]);
          if (!s) continue;
          candidates.push(buildCandidate(s, s.reasons, null));
          if (candidates.length >= 3) break;
        }
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "bear_put_spread": {
      const longPuts  = findPutsNearDelta(chain, 0.45, 0.65, underlying, expiration);
      const shortPuts = findPutsNearDelta(chain, 0.20, 0.40, underlying, expiration);
      for (const lp of longPuts) {
        if (!passesLiquidityFilter(lp)) continue;
        for (const sp of shortPuts) {
          if (!passesLiquidityFilter(sp)) continue;
          if (sp.strike >= lp.strike) { addRejection("Bear put spread: short strike must be below long strike"); continue; }
          const s = buildVerticalSpread(lp, sp, underlying, [
            `Long put: $${lp.strike}; short put: $${sp.strike}.`,
            "Bear put spread: defined-risk bearish structure.",
          ]);
          if (!s) continue;
          candidates.push(buildCandidate(s, s.reasons, null));
          if (candidates.length >= 3) break;
        }
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "bull_put_spread": {
      const shortPuts = findPutsNearDelta(chain, 0.25, 0.45, underlying, expiration);
      const longPuts  = findPutsNearDelta(chain, 0.10, 0.25, underlying, expiration);
      for (const sp of shortPuts) {
        if (!passesLiquidityFilter(sp)) continue;
        for (const lp of longPuts) {
          if (!passesLiquidityFilter(lp)) continue;
          if (lp.strike >= sp.strike) { addRejection("Bull put spread: long strike must be below short strike"); continue; }
          const longLeg  = buildLeg(0, "long_leg",  "Long Put Leg",  lp, underlying);
          const shortLeg = buildLeg(1, "short_leg", "Short Put Leg", sp, underlying);
          candidates.push(buildCandidate(
            { legs: [shortLeg, longLeg], signs: [-1, 1], reasons: [
              `Short put: $${sp.strike}; long put: $${lp.strike}. Net credit structure.`,
              "Bull put spread: income/credit strategy benefiting from price above short strike.",
            ], warnings: [] },
            [`Short put $${sp.strike}, long put $${lp.strike}`],
            null,
          ));
          if (candidates.length >= 3) break;
        }
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "bear_call_spread": {
      const shortCalls = findCallsNearDelta(chain, 0.25, 0.45, underlying, expiration);
      const longCalls  = findCallsNearDelta(chain, 0.10, 0.25, underlying, expiration);
      for (const sc of shortCalls) {
        if (!passesLiquidityFilter(sc)) continue;
        for (const lc of longCalls) {
          if (!passesLiquidityFilter(lc)) continue;
          if (lc.strike <= sc.strike) { addRejection("Bear call spread: long strike must be above short strike"); continue; }
          const shortLeg = buildLeg(0, "short_leg", "Short Call Leg", sc, underlying);
          const longLeg  = buildLeg(1, "long_leg",  "Long Call Leg",  lc, underlying);
          candidates.push(buildCandidate(
            { legs: [shortLeg, longLeg], signs: [-1, 1], reasons: [
              `Short call: $${sc.strike}; long call: $${lc.strike}. Net credit.`,
              "Bear call spread: income/credit strategy; profits if underlying stays below short strike.",
            ], warnings: [] },
            [`Short call $${sc.strike}, long call $${lc.strike}`],
            null,
          ));
          if (candidates.length >= 3) break;
        }
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "covered_call": {
      if (!ownsSymbol) {
        addRejection("Covered call requires confirmed underlying ownership (100+ shares per contract)");
        break;
      }
      const otmCalls = findOtmContracts(chain, "call", underlying, expiration, 0.01, 0.08);
      for (const c of otmCalls) {
        if (!passesLiquidityFilter(c)) continue;
        const leg = buildLeg(0, "short_leg", "Short Call Research Leg", c, underlying);
        candidates.push(buildCandidate(
          { legs: [leg], signs: [-1], reasons: [
            `Short call $${c.strike} against confirmed underlying shares.`,
            "Covered call: generates premium income against owned shares.",
            "Portfolio requires 100 shares per contract to be considered covered.",
          ], warnings: [] },
          [`Short call $${c.strike}`],
          null,
        ));
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "cash_secured_put": {
      const otmPuts = findOtmContracts(chain, "put", underlying, expiration, 0.02, 0.08);
      for (const p of otmPuts) {
        if (!passesLiquidityFilter(p)) continue;
        const leg = buildLeg(0, "short_leg", "Short Put Research Leg", p, underlying);
        const capitalNote = `Estimated cash-secured capital: $${(p.strike * 100).toLocaleString()} per contract (strike × 100). Actual broker requirement may differ.`;
        candidates.push(buildCandidate(
          { legs: [leg], signs: [-1], reasons: [
            `Short put $${p.strike} — income structure.`,
            "Cash-secured put: receive premium; obligated to purchase shares at strike if assigned.",
            capitalNote,
          ], warnings: [] },
          [`Short put $${p.strike}`],
          capitalNote,
        ));
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "protective_put": {
      if (!ownsSymbol) {
        addRejection("Protective put requires confirmed underlying ownership");
        break;
      }
      const otmPuts = findOtmContracts(chain, "put", underlying, expiration, 0.02, 0.10);
      for (const p of otmPuts) {
        if (!passesLiquidityFilter(p)) continue;
        const s = buildSingleLeg(p, "long_leg", "Long Put Research Leg", underlying, [
          `Long put $${p.strike} as downside protection for owned shares.`,
          "Protective put: limits downside below the put strike.",
        ]);
        candidates.push(buildCandidate(s, s.reasons, null));
        if (candidates.length >= 3) break;
      }
      break;
    }

    case "collar": {
      if (!ownsSymbol) {
        addRejection("Collar requires confirmed underlying ownership");
        break;
      }
      const otmPuts  = findOtmContracts(chain, "put",  underlying, expiration, 0.03, 0.08);
      const otmCalls = findOtmContracts(chain, "call", underlying, expiration, 0.02, 0.07);
      for (const p of otmPuts) {
        if (!passesLiquidityFilter(p)) continue;
        for (const c of otmCalls) {
          if (!passesLiquidityFilter(c)) continue;
          const putLeg  = buildLeg(0, "long_leg",  "Long Put (Protection)",    p, underlying);
          const callLeg = buildLeg(1, "short_leg", "Short Call (Income Offset)", c, underlying);
          candidates.push(buildCandidate(
            { legs: [putLeg, callLeg], signs: [1, -1], reasons: [
              `Long put $${p.strike} + short call $${c.strike}.`,
              "Collar: downside protection with call premium offsetting put cost.",
            ], warnings: [] },
            [`Long put $${p.strike}, short call $${c.strike}`],
            null,
          ));
          if (candidates.length >= 2) break;
        }
        if (candidates.length >= 2) break;
      }
      break;
    }

    case "iron_condor": {
      const atmPuts  = findAtmContracts(chain, "put",  underlying, expiration);
      const atmCalls = findAtmContracts(chain, "call", underlying, expiration);
      const wingPuts  = findOtmContracts(chain, "put",  underlying, expiration, 0.04, 0.12);
      const wingCalls = findOtmContracts(chain, "call", underlying, expiration, 0.04, 0.12);
      for (const sp of atmPuts) {
        if (!passesLiquidityFilter(sp)) continue;
        for (const sc of atmCalls) {
          if (!passesLiquidityFilter(sc)) continue;
          if (sc.strike <= sp.strike) continue;
          const lp = wingPuts.find(p => p.strike < sp.strike && passesLiquidityFilter(p));
          const lc = wingCalls.find(c => c.strike > sc.strike && passesLiquidityFilter(c));
          if (!lp || !lc) continue;
          const ic = buildIronCondor(sp, lp, sc, lc, underlying, [
            `Long put $${lp.strike} / short put $${sp.strike} / short call $${sc.strike} / long call $${lc.strike}.`,
            "Iron condor: neutral strategy benefiting from range-bound price action.",
          ]);
          if (!ic) continue;
          candidates.push(buildCandidate(ic, ic.reasons, null));
          if (candidates.length >= 2) break;
        }
        if (candidates.length >= 2) break;
      }
      break;
    }

    case "iron_butterfly": {
      const atmList = findAtmContracts(chain, "call", underlying, expiration);
      for (const atmC of atmList) {
        const atmP = chain.find(c => c.optionType === "put" && c.strike === atmC.strike && c.expiration === expiration);
        if (!atmP) continue;
        if (!passesLiquidityFilter(atmC) || !passesLiquidityFilter(atmP)) continue;
        const lc = findOtmContracts(chain, "call", underlying, expiration, 0.04, 0.10)[0];
        const lp = findOtmContracts(chain, "put",  underlying, expiration, 0.04, 0.10)[0];
        if (!lc || !lp) continue;
        const ib = buildIronButterfly(lp, atmP, atmC, lc, underlying, [
          `Long put $${lp.strike} / short ATM put $${atmP.strike} / short ATM call $${atmC.strike} / long call $${lc.strike}.`,
          "Iron butterfly: neutral, benefits from low volatility and ATM pin at expiration.",
        ]);
        if (!ib) continue;
        candidates.push(buildCandidate(ib, ib.reasons, null));
        break;
      }
      break;
    }

    case "long_straddle": {
      const atmCalls = findAtmContracts(chain, "call", underlying, expiration);
      for (const ac of atmCalls) {
        const ap = chain.find(c => c.optionType === "put" && c.strike === ac.strike && c.expiration === expiration);
        if (!ap) continue;
        if (!passesLiquidityFilter(ac) || !passesLiquidityFilter(ap)) continue;
        const callLeg = buildLeg(0, "long_leg", "Long Call",   ac, underlying);
        const putLeg  = buildLeg(1, "long_leg", "Long Put",    ap, underlying);
        candidates.push(buildCandidate(
          { legs: [callLeg, putLeg], signs: [1, 1], reasons: [
            `Long ATM call $${ac.strike} + long ATM put $${ap.strike}.`,
            "Long straddle: benefits from significant price movement in either direction.",
          ], warnings: [] },
          [`Long straddle at $${ac.strike}`],
          null,
        ));
        break;
      }
      break;
    }

    case "long_strangle": {
      const otmCalls = findOtmContracts(chain, "call", underlying, expiration, 0.03, 0.08);
      const otmPuts  = findOtmContracts(chain, "put",  underlying, expiration, 0.03, 0.08);
      const oc = otmCalls[0];
      const op = otmPuts[0];
      if (oc && op && passesLiquidityFilter(oc) && passesLiquidityFilter(op)) {
        const callLeg = buildLeg(0, "long_leg", "Long OTM Call", oc, underlying);
        const putLeg  = buildLeg(1, "long_leg", "Long OTM Put",  op, underlying);
        candidates.push(buildCandidate(
          { legs: [callLeg, putLeg], signs: [1, 1], reasons: [
            `Long OTM call $${oc.strike} + long OTM put $${op.strike}.`,
            "Long strangle: lower debit than straddle; requires larger move to be profitable.",
          ], warnings: [] },
          [`Long strangle $${op.strike}/$${oc.strike}`],
          null,
        ));
      }
      break;
    }

    case "calendar_spread": {
      // Calendar: short near expiration, long far expiration — requires two chains
      // In this expiration pass, we note the requirement and skip multi-expiry building
      // (multi-expiry calendar is handled at the result level with two expiration passes)
      addRejection("Calendar spread requires two expirations — evaluated across expiration pairs");
      break;
    }

    case "diagonal_spread": {
      addRejection("Diagonal spread requires two expirations — evaluated across expiration pairs");
      break;
    }

    case "monitor_only": {
      // No contract research — monitor_only family explicitly has no contracts
      break;
    }

    default:
      addRejection(`Strategy family '${family}' not supported in contract research`);
  }

  return candidates;
}

// ===========================================================================
// Family label map
// ===========================================================================

const FAMILY_LABELS: Record<OptionsStrategyFamily, string> = {
  long_call:         "Long Call",
  long_put:          "Long Put",
  bull_call_spread:  "Bull Call Spread",
  bear_put_spread:   "Bear Put Spread",
  bull_put_spread:   "Bull Put Spread",
  bear_call_spread:  "Bear Call Spread",
  covered_call:      "Covered Call",
  cash_secured_put:  "Cash-Secured Put",
  protective_put:    "Protective Put",
  collar:            "Collar",
  iron_condor:       "Iron Condor",
  iron_butterfly:    "Iron Butterfly",
  long_straddle:     "Long Straddle",
  long_strangle:     "Long Strangle",
  calendar_spread:   "Calendar Spread",
  diagonal_spread:   "Diagonal Spread",
  monitor_only:      "Monitor Only",
};

// ===========================================================================
// Families that require ownership
// ===========================================================================

const OWNERSHIP_REQUIRED_FAMILIES = new Set<OptionsStrategyFamily>([
  "covered_call", "protective_put", "collar",
]);

// ===========================================================================
// Families not supported for live contract research (multi-expiry / monitor)
// ===========================================================================

const UNSUPPORTED_FOR_LIVE_RESEARCH = new Set<OptionsStrategyFamily>([
  "monitor_only",
]);

const MULTI_EXPIRY_FAMILIES = new Set<OptionsStrategyFamily>([
  "calendar_spread", "diagonal_spread",
]);

// ===========================================================================
// Chain freshness check
// ===========================================================================

const STALE_CHAIN_THRESHOLD_MS = 15 * 60 * 1000; // 15 min

function buildChainFreshness(asOf: string | null, provider: string | null): ContractResearchFreshness {
  if (!asOf) {
    return {
      optionChainAsOf:  null,
      marketDataAsOf:   null,
      provider,
      freshnessStatus:  "UNAVAILABLE",
      staleWarning:     "Option chain timestamp is unavailable.",
      chainAgeMinutes:  null,
    };
  }
  const ageMs = Date.now() - new Date(asOf).getTime();
  const ageMin = Math.round(ageMs / 60000);
  let freshnessStatus: ContractResearchFreshness["freshnessStatus"];
  let staleWarning: string | null = null;
  if (ageMs < 5 * 60 * 1000)  freshnessStatus = "FRESH";
  else if (ageMs < 15 * 60 * 1000) freshnessStatus = "AGING";
  else {
    freshnessStatus = "STALE";
    staleWarning = `Option chain data is ${ageMin} minutes old. Prices may not reflect current market conditions.`;
  }
  return {
    optionChainAsOf:  asOf,
    marketDataAsOf:   asOf,
    provider,
    freshnessStatus,
    staleWarning,
    chainAgeMinutes:  ageMin,
  };
}

// ===========================================================================
// Short-lived per-user chain cache (TTL: 2 minutes)
// Keys: userId:symbol:expiration — never shared across users
// ===========================================================================

const _chainCache = new Map<string, { data: NormalizedOptionContract[]; asOf: string; expiresAt: number; provider: string }>();
const CHAIN_CACHE_TTL_MS = 2 * 60 * 1000;

/** Clear chain cache — used in tests to prevent cross-test leakage */
export function clearContractResearchCache(): void {
  _chainCache.clear();
}

function chainCacheKey(userId: string, symbol: string, expiration: string): string {
  return `cr:${userId}:${symbol}:${expiration}`;
}

function evictExpired(): void {
  const now = Date.now();
  Array.from(_chainCache.entries()).forEach(([k, v]) => {
    if (now >= v.expiresAt) _chainCache.delete(k);
  });
}

// ===========================================================================
// Main engine
// ===========================================================================

export interface ContractResearchInput {
  userId:            string;
  symbol:            string;
  strategyFamily:    OptionsStrategyFamily;
  planningContextId: string;
  thesisDirection:   ThesisDirection;
  researchHorizon:   string | null;
  underlyingPrice:   number | null;
  volatilityContext: VolatilityContext;
  eventContext:      EventContext | null;
  ownsSymbol:        boolean;
  filters:           ContractResearchFilters;
  invalidationNote:  string | null;
  constraintsFp:     string;
}

export async function buildContractResearchResult(
  input: ContractResearchInput,
  deps: ContractResearchDeps = defaultDeps,
): Promise<OptionsContractResearchResult> {
  const start = Date.now();
  _health.contractResearchRequests++;
  evictExpired();

  const {
    userId, symbol, strategyFamily, planningContextId,
    thesisDirection, researchHorizon, underlyingPrice,
    volatilityContext, eventContext, ownsSymbol,
    filters, invalidationNote, constraintsFp,
  } = input;

  const today   = new Date();
  const now     = today.toISOString();
  const resultId = `cr-${Date.now()}`;

  const statusLabel = (s: ContractResearchStatus): string => ({
    COMPLETE:                            "Complete",
    PARTIAL:                             "Partial — some data unavailable",
    NO_VALID_CONTRACT_RESEARCH_CANDIDATES: "No qualifying contract candidates found",
    CONTRACT_RESEARCH_REQUIRES_BROKER:   "Broker connection required",
    CHAIN_UNAVAILABLE:                   "Option chain unavailable",
    STALE_CHAIN:                         "Option chain data is stale",
    UNSUPPORTED_FAMILY:                  "Strategy family not supported for live research",
    ERROR:                               "Unexpected error",
  }[s] ?? s);

  function makeResult(
    status: ContractResearchStatus,
    extras: Partial<OptionsContractResearchResult> = {},
  ): OptionsContractResearchResult {
    const latency = Date.now() - start;
    recordLatency(latency);
    return {
      id:                   resultId,
      planningContextId,
      symbol,
      strategyFamily,
      strategyFamilyLabel:  FAMILY_LABELS[strategyFamily] ?? strategyFamily,
      generatedAt:          now,
      status,
      statusLabel:          statusLabel(status),
      thesisDirection,
      thesisDirectionLabel: thesisDirection,
      researchHorizon,
      underlyingPrice,
      underlyingPriceLabel: underlyingPrice ? `$${underlyingPrice.toFixed(2)} (reference)` : "Unavailable",
      volatilityContext,
      eventContext,
      filtersApplied:       filters,
      derivedDteRange:      getDteRange(strategyFamily, filters),
      expirationCandidates: [],
      structureCandidates:  [],
      providerCallCount:    0,
      rejectionSummary:     { contractsEvaluated: 0, contractsRejected: 0, structuresBuilt: 0, structuresRejected: 0, topRejectionReasons: [] },
      limitations:          [],
      freshness:            buildChainFreshness(null, null),
      disclaimer:           CONTRACT_RESEARCH_DISCLAIMER,
      midpointDisclaimer:   MIDPOINT_DISCLAIMER,
      optionsRiskDisclosure: OPTIONS_RISK_DISCLOSURE_EXTENDED,
      methodologyVersion:   CONTRACT_RESEARCH_VERSION,
      generationLatencyMs:  latency,
      ...extras,
    };
  }

  // ── 1. Guard: unsupported families ──────────────────────────────────────
  if (UNSUPPORTED_FOR_LIVE_RESEARCH.has(strategyFamily)) {
    _health.failedContractResearch++;
    return makeResult("UNSUPPORTED_FAMILY", {
      limitations: [`Strategy family '${FAMILY_LABELS[strategyFamily]}' does not involve specific contract selection.`],
    });
  }

  if (MULTI_EXPIRY_FAMILIES.has(strategyFamily)) {
    _health.failedContractResearch++;
    return makeResult("UNSUPPORTED_FAMILY", {
      limitations: [
        `${FAMILY_LABELS[strategyFamily]} requires two different expirations. ` +
        "Multi-expiry structure research is planned for a future release.",
      ],
    });
  }

  // ── 2. Ownership guard for protected families ────────────────────────────
  if (OWNERSHIP_REQUIRED_FAMILIES.has(strategyFamily) && !ownsSymbol) {
    _health.failedContractResearch++;
    return makeResult("NO_VALID_CONTRACT_RESEARCH_CANDIDATES", {
      limitations: [
        `${FAMILY_LABELS[strategyFamily]} requires confirmed underlying ownership (100+ shares per contract). ` +
        "Connect a portfolio with verified share holdings to proceed.",
      ],
    });
  }

  // ── 3. Broker connection ─────────────────────────────────────────────────
  let provider: string | null = null;
  try {
    const conn = await deps.getBrokerConnection(userId);
    if (!conn?.isConnected) {
      _health.requiresBrokerCount++;
      _health.failedContractResearch++;
      return makeResult("CONTRACT_RESEARCH_REQUIRES_BROKER", {
        limitations: ["Connect a Tradier or TradeStation broker account to access live option chain data."],
      });
    }
    provider = (conn as any).provider ?? null;
    _health.optionChainProviderStatus = "HEALTHY";
  } catch {
    _health.optionChainProviderStatus = "DEGRADED";
    _health.failedContractResearch++;
    return makeResult("ERROR", { limitations: ["Broker connection check failed. Please try again."] });
  }

  // ── 4. Capability check ──────────────────────────────────────────────────
  try {
    const cap = await deps.getBrokerCapabilities(userId);
    if (!cap?.optionsChain) {
      _health.failedContractResearch++;
      return makeResult("CONTRACT_RESEARCH_REQUIRES_BROKER", {
        limitations: [`The connected broker (${provider}) does not support option chain retrieval.`],
      });
    }
  } catch {
    _health.failedContractResearch++;
    return makeResult("ERROR", { limitations: ["Broker capability check failed."] });
  }

  // ── 5. Load expirations (1 broker call) ───────────────────────────────────
  let rawExpirations: string[] = [];
  let providerCallCount = 0;
  try {
    rawExpirations = await deps.getOptionExpirations(userId, symbol);
    providerCallCount++;
  } catch {
    _health.emptyChainCount++;
    _health.failedContractResearch++;
    return makeResult("CHAIN_UNAVAILABLE", {
      providerCallCount,
      limitations: ["Unable to retrieve option expirations. The broker may be temporarily unavailable."],
    });
  }

  if (rawExpirations.length === 0) {
    _health.emptyChainCount++;
    _health.failedContractResearch++;
    return makeResult("CHAIN_UNAVAILABLE", {
      providerCallCount,
      limitations: ["No option expirations are currently listed for this symbol."],
    });
  }

  // ── 6. DTE range + expiration candidates ─────────────────────────────────
  const dteRange = getDteRange(strategyFamily, filters);
  const resolvedExps = resolveExpirations(rawExpirations, dteRange.min, dteRange.max, today);

  // Build ExpirationResearchCandidates for all raw expirations (for transparency)
  const expirationCandidates: ExpirationResearchCandidate[] = rawExpirations.map(exp => {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(exp)) {
      return {
        expiration: exp, dte: 0, dteBucket: null, status: "EXPIRED_OR_INVALID",
        statusLabel: "Expired or Invalid", reasons: ["Invalid date format"], eventFlags: [],
        eventRelation: "no_event_detected" as EventRelation, containsEarnings: false, earningsDate: null,
        contractCount: 0, liquidityCoverage: "UNKNOWN", ivSummary: null,
      };
    }
    const dte   = computeDTE(exp, today);
    if (dte <= 0) return {
      expiration: exp, dte, dteBucket: null, status: "EXPIRED_OR_INVALID",
      statusLabel: "Expired or Invalid", reasons: ["Expiration has passed"], eventFlags: [],
      eventRelation: "no_event_detected" as EventRelation, containsEarnings: false, earningsDate: null,
      contractCount: 0, liquidityCoverage: "UNKNOWN", ivSummary: null,
    };

    const withinRange = dte >= dteRange.min && dte <= dteRange.max;
    const eventRelation = determineEventRelation(exp, eventContext, today);
    const containsEarnings = eventRelation === "contains_event";
    const eventFlags: string[] = [];
    if (containsEarnings) eventFlags.push("Contains earnings / event window");

    let status: ExpirationStatus = withinRange ? "RESEARCH_CANDIDATE" : "OUTSIDE_HORIZON";
    const reasons: string[] = [];

    if (withinRange) {
      reasons.push(`DTE ${dte} is within the target range of ${dteRange.min}–${dteRange.max}.`);
      reasons.push(`Aligns with ${strategyFamily} research horizon (${dteRange.label}).`);
    } else {
      status = "OUTSIDE_HORIZON";
      reasons.push(`DTE ${dte} is outside the target range of ${dteRange.min}–${dteRange.max}.`);
    }

    if (containsEarnings && filters.avoidEarningsWindow) {
      status = "EVENT_EXCLUDED";
      reasons.push("Excluded: avoidEarningsWindow is active and this expiration contains an event.");
    } else if (containsEarnings) {
      eventFlags.push("EVENT WINDOW INCLUDED — earnings exposure not avoided per current filters.");
    }

    return {
      expiration: exp, dte, dteBucket: classifyDteBucket(dte),
      status, statusLabel: status.replace(/_/g, " "),
      reasons, eventFlags, eventRelation, containsEarnings,
      earningsDate: eventContext?.daysUntilEvent
        ? new Date(today.getTime() + eventContext.daysUntilEvent * 86400000).toISOString().slice(0, 10)
        : null,
      contractCount: 0,     // filled after chain load below
      liquidityCoverage: "UNKNOWN" as ContractLiquidityQuality,
      ivSummary: null,
    };
  });

  // ── 7. Load chains per candidate expiration (no N+1) ──────────────────────
  const candidateExps = expirationCandidates.filter(
    e => e.status === "RESEARCH_CANDIDATE",
  ).slice(0, 4); // evaluate at most 4 expirations

  const allRejections = new Map<string, number>();
  const allStructures: OptionsStructureResearchCandidate[] = [];
  let totalContractsEvaluated = 0;
  let totalContractsRejected  = 0;
  let chainAsOf: string | null = null;
  const limitations: string[] = [];

  for (const expCandidate of candidateExps) {
    const exp = expCandidate.expiration;
    let chain: NormalizedOptionContract[] = [];
    const cacheKey = chainCacheKey(userId, symbol, exp);
    const cached   = _chainCache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      chain = cached.data;
      chainAsOf = cached.asOf;
    } else {
      try {
        const raw = await deps.getOptionChain(userId, symbol, exp);
        providerCallCount++;
        const asOf = new Date().toISOString();
        chain = raw.map(c => normalizeOptionChainContract(c, provider!, symbol, asOf));
        _chainCache.set(cacheKey, { data: chain, asOf, expiresAt: Date.now() + CHAIN_CACHE_TTL_MS, provider: provider! });
        chainAsOf = asOf;
      } catch {
        limitations.push(`Option chain for ${exp} could not be retrieved; expiration skipped.`);
        expCandidate.status = "INSUFFICIENT_DATA";
        continue;
      }
    }

    if (chain.length === 0) {
      expCandidate.status = "INSUFFICIENT_DATA";
      expCandidate.reasons.push("No contracts returned for this expiration.");
      limitations.push(`No contracts available for expiration ${exp}.`);
      _health.emptyChainCount++;
      continue;
    }

    // Enrich expiration candidate with chain data
    expCandidate.contractCount = chain.length;
    expCandidate.ivSummary = buildExpirationIvSummary(chain);
    const goodLiq = chain.filter(c => classifyContractLiquidity(c) !== "POOR").length;
    const liqPct = chain.length > 0 ? goodLiq / chain.length : 0;
    expCandidate.liquidityCoverage =
      liqPct >= 0.7 ? "STRONG" :
      liqPct >= 0.4 ? "ACCEPTABLE" :
      liqPct >= 0.2 ? "LIMITED" : "POOR";

    // Staleness check
    if (chainAsOf) {
      const ageMs = Date.now() - new Date(chainAsOf).getTime();
      if (ageMs > STALE_CHAIN_THRESHOLD_MS) {
        _health.staleChainCount++;
        limitations.push(`Option chain data for ${exp} is ${Math.round(ageMs / 60000)} minutes old.`);
      }
    }

    // Apply event exclusion
    if (expCandidate.containsEarnings && filters.avoidEarningsWindow) continue;

    const eventExposure: StructureEventExposure = {
      containsEarnings: expCandidate.containsEarnings,
      eventType:        eventContext?.eventType ?? null,
      earningsDate:     expCandidate.earningsDate,
      insideEventWindow: expCandidate.containsEarnings,
      eventNote:        expCandidate.containsEarnings
        ? "This expiration window contains a potential earnings or event date. Event-related moves may affect this structure."
        : "No earnings or event detected within this expiration window.",
    };

    // Apply liquidity filter to chain contracts
    const beforeCount = chain.length;
    const filteredChain = chain.filter(c => {
      const liq = classifyContractLiquidity(c);
      if (liq === "POOR") { allRejections.set("Poor liquidity", (allRejections.get("Poor liquidity") ?? 0) + 1); return false; }
      const oi = c.openInterest ?? 0;
      const minOi = filters.minOpenInterest ?? 10;
      if (oi < minOi) { allRejections.set(`OI below ${minOi}`, (allRejections.get(`OI below ${minOi}`) ?? 0) + 1); return false; }
      if (filters.maxBidAskSpreadPct !== null) {
        const bid = c.bid ?? 0;
        const ask = c.ask ?? 0;
        const mid = (bid + ask) / 2;
        const sp = mid > 0 ? (ask - bid) / mid : 1;
        if (sp > filters.maxBidAskSpreadPct) { allRejections.set("Spread too wide", (allRejections.get("Spread too wide") ?? 0) + 1); return false; }
      }
      return true;
    });

    totalContractsEvaluated += beforeCount;
    totalContractsRejected  += (beforeCount - filteredChain.length);

    const underlying = underlyingPrice ?? 0;
    if (!underlying) {
      limitations.push("Underlying reference price unavailable; strike distance and moneyness cannot be computed.");
    }

    const expStructures = buildStructureCandidates(
      strategyFamily,
      filteredChain,
      exp,
      expCandidate.dte,
      underlying,
      filters,
      ownsSymbol,
      eventExposure,
      allRejections,
      planningContextId,
      thesisDirection,
      invalidationNote,
      constraintsFp,
    );

    allStructures.push(...expStructures);
  }

  // ── 8. Sort by quality category ──────────────────────────────────────────
  allStructures.sort((a, b) =>
    QUALITY_ORDER.indexOf(a.qualityCategory) - QUALITY_ORDER.indexOf(b.qualityCategory)
  );

  // ── 9. Cap candidates ─────────────────────────────────────────────────────
  const MAX_CANDIDATES = 5;
  const structureCandidates = allStructures.slice(0, MAX_CANDIDATES);

  // ── 10. Build rejection summary ───────────────────────────────────────────
  const topRejectionReasons = Array.from(allRejections.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  const rejectionSummary: ContractResearchRejectionSummary = {
    contractsEvaluated:   totalContractsEvaluated,
    contractsRejected:    totalContractsRejected,
    structuresBuilt:      allStructures.length,
    structuresRejected:   Math.max(0, allStructures.length - structureCandidates.length),
    topRejectionReasons,
  };

  // ── 11. Final status ──────────────────────────────────────────────────────
  let status: ContractResearchStatus;
  if (structureCandidates.length === 0) {
    status = "NO_VALID_CONTRACT_RESEARCH_CANDIDATES";
    _health.noValidCandidates++;
    _health.failedContractResearch++;
  } else if (limitations.length > 0) {
    status = "PARTIAL";
    _health.partialContractResearch++;
  } else {
    status = "COMPLETE";
    _health.successfulContractResearch++;
    _health.lastSuccessfulContractResearchAt = now;
  }

  if (strategyFamily === "monitor_only") {
    limitations.push("Monitor Only does not involve contract selection. No research candidates are generated.");
  }

  const freshness = buildChainFreshness(chainAsOf, provider);
  const latency   = Date.now() - start;
  recordLatency(latency);

  console.log(JSON.stringify({
    event:            "options_contract_research_completed",
    durationMs:       latency,
    provider,
    strategyFamily,
    contractCount:    totalContractsEvaluated,
    expirationCount:  candidateExps.length,
    structuresBuilt:  allStructures.length,
    rejectionCounts:  Object.fromEntries(allRejections.entries()),
    hasEventContext:  !!eventContext?.hasUpcomingEvent,
    hasGreeksCoverage: structureCandidates.some(c => c.legs.some(l => l.delta !== null)),
    providerCallCount,
  }));

  return {
    id:                   resultId,
    planningContextId,
    symbol,
    strategyFamily,
    strategyFamilyLabel:  FAMILY_LABELS[strategyFamily] ?? strategyFamily,
    generatedAt:          now,
    status,
    statusLabel:          statusLabel(status),
    thesisDirection,
    thesisDirectionLabel: thesisDirection,
    researchHorizon,
    underlyingPrice,
    underlyingPriceLabel: underlyingPrice ? `$${underlyingPrice.toFixed(2)} (reference)` : "Unavailable",
    volatilityContext,
    eventContext,
    filtersApplied:       filters,
    derivedDteRange:      dteRange,
    expirationCandidates,
    structureCandidates,
    providerCallCount,
    rejectionSummary,
    limitations,
    freshness,
    disclaimer:           CONTRACT_RESEARCH_DISCLAIMER,
    midpointDisclaimer:   MIDPOINT_DISCLAIMER,
    optionsRiskDisclosure: OPTIONS_RISK_DISCLOSURE_EXTENDED,
    methodologyVersion:   CONTRACT_RESEARCH_VERSION,
    generationLatencyMs:  latency,
  };
}
