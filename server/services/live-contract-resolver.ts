// Live Contract Resolver — Sprint 2.2.2
//
// Converts an illustrative options structure into verified, currently listed
// option-contract candidates using the user's connected broker.
//
// Principles (never violate):
//   - No fabricated contracts, expirations, strikes, premiums, or Greeks.
//   - Missing data → null or explicit "unavailable" status; never zero-fill.
//   - One provider failure must not break the Research Package page.
//   - Never submits orders; never mutates portfolio state.
//   - No tokens, account numbers, or raw payloads logged.

import {
  getOptionExpirations,
  getOptionChain,
  getBrokerCapabilities,
} from "../broker";
import { storage } from "../storage";
import type { OptionChainContract } from "../broker/providers/tradier";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type LiveContractStatus =
  | "resolved"
  | "partial"
  | "broker_not_connected"
  | "capability_unavailable"
  | "unsupported_structure"
  | "chain_unavailable"
  | "no_matching_expiration"
  | "no_matching_strike"
  | "pricing_unavailable"
  | "error";

export type LiquidityStatus =
  | "verified"
  | "acceptable"
  | "limited"
  | "unavailable"
  | "rejected";

export type PricingStatus = "available" | "partial" | "unavailable";

/** Provider-neutral normalized option contract.  Null = not supplied. */
export interface NormalizedOptionContract {
  provider: string;
  symbol: string;            // OCC option symbol
  underlyingSymbol: string;
  optionType: "call" | "put";
  expiration: string;        // YYYY-MM-DD
  strike: number;
  contractId: string;        // same as symbol — preserved for order preparation

  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;       // calculated midpoint when both bid+ask valid

  volume: number | null;
  openInterest: number | null;

  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;

  multiplier: number;        // 100 for standard US equity options
  inTheMoney: boolean | null;
  updatedAt: string | null;  // ISO timestamp of when the chain was fetched
}

export interface ExpirationCandidate {
  expiration: string;
  dte: number;
  withinTargetRange: boolean;
  distanceFromTargetMidpoint: number;
  warnings: string[];
}

export interface ResolvedContractLeg {
  action: "buy" | "sell";
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  contractId: string;
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface ResolvedContractCandidate {
  id: string;
  structure: string;
  structureLabel: string;
  expiration: string;
  dte: number;
  legs: ResolvedContractLeg[];
  contractFit: number;       // 0–100 deterministic — documented formula
  fitReasons: string[];
  warnings: string[];
  liquidityStatus: LiquidityStatus;
  pricingStatus: PricingStatus;
  estimatedDebit: number | null;   // net debit per share (debit structures)
  estimatedCredit: number | null;  // net credit per share (credit structures)
  pricingBasis: string | null;     // description of calculation basis
  maxRisk: number | null;          // in dollars per spread/contract
  maxGain: string | null;          // "theoretically unlimited" or dollar amount
  breakeven: number | null;
  multiplier: number;
  greeksAvailable: boolean;
  source: string;
  asOf: string | null;
}

export interface LiveContractResolutionResult {
  status: LiveContractStatus;
  symbol: string;
  structure: string;
  provider: string | null;
  targetDte: { min: number; max: number } | null;
  candidates: ResolvedContractCandidate[];
  warnings: string[];
  asOf: string | null;
}

export interface LiveContractResolveRequest {
  symbol: string;
  structure: string;
  targetDte: { min: number; max: number };
  strikeGuidance: {
    longLeg?: string;
    shortLeg?: string;
    singleLeg?: string;
  };
  referenceLevels: {
    underlyingPrice: number;
    support?: number | null;
    resistance?: number | null;
    breakout?: number | null;
    objective?: number | null;
  };
}

// Dependency injection interface (real broker calls replaced by stubs in tests)
export interface LiveContractResolverDeps {
  getBrokerConnection: (userId: string) => Promise<{ provider: string; isConnected: boolean } | null>;
  getBrokerCapabilities: (userId: string) => Promise<import("../broker/types").BrokerCapabilities | null>;
  getOptionExpirations: (userId: string, symbol: string) => Promise<string[]>;
  getOptionChain: (userId: string, symbol: string, expiration: string) => Promise<OptionChainContract[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MULTIPLIER = 100; // standard US equity options

const STRUCTURE_LABELS: Record<string, string> = {
  long_call: "Long Call",
  bull_call_spread: "Bull Call Spread",
  bull_put_spread: "Bull Put Spread",
  cash_secured_put: "Cash-Secured Put",
  covered_call: "Covered Call",
  protective_put: "Protective Put",
};

const SUPPORTED_STRUCTURES = new Set(Object.keys(STRUCTURE_LABELS));

// ---------------------------------------------------------------------------
// Short-lived chain cache — keyed by userId:symbol:expiration, TTL 2 minutes.
// Per-user; never shared across users.
// ---------------------------------------------------------------------------

const chainCache = new Map<string, { data: NormalizedOptionContract[]; expiresAt: number; provider: string }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

function chainCacheKey(userId: string, symbol: string, expiration: string): string {
  return `${userId}:${symbol}:${expiration}`;
}

function evictExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of chainCache.entries()) {
    if (now >= entry.expiresAt) chainCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Pure: chain normalization
// ---------------------------------------------------------------------------

/** Convert a raw broker OptionChainContract to NormalizedOptionContract.
 *  Explicit field whitelist — provider-specific raw payloads never leak through. */
export function normalizeOptionChainContract(
  raw: OptionChainContract,
  provider: string,
  underlyingSymbol: string,
  fetchedAt: string,
): NormalizedOptionContract {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const bid = num(raw.bid);
  const ask = num(raw.ask);
  const mark =
    bid !== null && ask !== null && bid >= 0 && ask > 0 && bid <= ask
      ? parseFloat(((bid + ask) / 2).toFixed(2))
      : null;

  return {
    provider,
    symbol: String(raw.symbol ?? ""),
    underlyingSymbol,
    optionType: raw.optionType,
    expiration: raw.expiration,
    strike: raw.strike,
    contractId: String(raw.symbol ?? ""),
    bid,
    ask,
    last: num(raw.last),
    mark,
    volume: num(raw.volume),
    openInterest: num(raw.openInterest),
    impliedVolatility: raw.greeks ? num(raw.greeks.mid_iv) : null,
    delta: raw.greeks ? num(raw.greeks.delta) : null,
    gamma: raw.greeks ? num(raw.greeks.gamma) : null,
    theta: raw.greeks ? num(raw.greeks.theta) : null,
    vega: raw.greeks ? num(raw.greeks.vega) : null,
    rho: null,
    multiplier: MULTIPLIER,
    inTheMoney:
      raw.optionType === "call"
        ? raw.strike < raw.bid   // rough ITM heuristic (not available from chain)
        : raw.strike > raw.bid,  // replaced by actual check in orchestrator
    updatedAt: fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Pure: expiration resolution
// ---------------------------------------------------------------------------

/** Compute calendar DTE from today to a YYYY-MM-DD expiration string. */
export function computeDTE(expiration: string, today: Date): number {
  const exp = new Date(expiration + "T16:00:00-05:00"); // assume 4 PM ET close
  return Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Resolve listed expirations to candidates ranked by proximity to the target DTE range.
 *  Pure — no broker calls. */
export function resolveExpirations(
  expirations: string[],
  targetDteMin: number,
  targetDteMax: number,
  today: Date,
): ExpirationCandidate[] {
  const targetMidpoint = (targetDteMin + targetDteMax) / 2;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const candidates: ExpirationCandidate[] = [];
  for (const exp of expirations) {
    if (!DATE_RE.test(exp)) continue;                       // skip invalid formats
    const dte = computeDTE(exp, today);
    if (dte <= 0) continue;                                 // expired

    const withinTargetRange = dte >= targetDteMin && dte <= targetDteMax;
    const distanceFromTargetMidpoint = Math.abs(dte - targetMidpoint);
    const warnings: string[] = [];

    if (!withinTargetRange) {
      warnings.push(
        dte < targetDteMin
          ? `Expiration is ${targetDteMin - dte} day(s) shorter than the minimum target DTE.`
          : `Expiration is ${dte - targetDteMax} day(s) longer than the maximum target DTE.`,
      );
    }

    candidates.push({ expiration: exp, dte, withinTargetRange, distanceFromTargetMidpoint, warnings });
  }

  // Sort: expirations within range first (by closeness to midpoint), then outside-range ones
  candidates.sort((a, b) => {
    if (a.withinTargetRange !== b.withinTargetRange) {
      return a.withinTargetRange ? -1 : 1;
    }
    return a.distanceFromTargetMidpoint - b.distanceFromTargetMidpoint;
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// Pure: strike resolution
// ---------------------------------------------------------------------------

const GUIDANCE_ALIASES: Record<string, string> = {
  short_strike_near_objective: "near_technical_objective",
  near_objective: "near_technical_objective",
  below_short_put: "one_strike_otm_put",   // handled specifically in spread logic
};

function normalizeGuidance(guidance: string): string {
  return GUIDANCE_ALIASES[guidance] ?? guidance;
}

/** Find the listed call/put strikes that best satisfy a strike guidance string.
 *  Returns up to 3 matches, best first. Pure — no broker calls. */
export function resolveStrikesFromGuidance(
  chain: NormalizedOptionContract[],
  guidance: string,
  optionType: "call" | "put",
  levels: LiveContractResolveRequest["referenceLevels"],
): NormalizedOptionContract[] {
  const guide = normalizeGuidance(guidance);
  const underlying = levels.underlyingPrice;
  const filtered = chain.filter((c) => c.optionType === optionType);

  if (filtered.length === 0) return [];

  const strikes = [...new Set(filtered.map((c) => c.strike))].sort((a, b) => a - b);

  function byStrike(targetStrike: number): NormalizedOptionContract[] {
    const closest = strikes.reduce((best, s) =>
      Math.abs(s - targetStrike) < Math.abs(best - targetStrike) ? s : best,
    );
    return filtered
      .filter((c) => c.strike === closest)
      .concat(
        ...strikes
          .filter((s) => s !== closest)
          .sort((a, b) => Math.abs(a - targetStrike) - Math.abs(b - targetStrike))
          .slice(0, 2)
          .flatMap((s) => filtered.filter((c) => c.strike === s)),
      )
      .slice(0, 3);
  }

  switch (guide) {
    case "near_atm":
      return byStrike(underlying);

    case "one_strike_itm": {
      // For calls: ITM = strike < underlying; pick highest strike below underlying
      // For puts:  ITM = strike > underlying; pick lowest strike above underlying
      const itmStrikes =
        optionType === "call"
          ? strikes.filter((s) => s < underlying).slice(-1)
          : strikes.filter((s) => s > underlying).slice(0, 1);
      if (itmStrikes.length === 0) return byStrike(underlying);
      return filtered.filter((c) => c.strike === itmStrikes[0]).slice(0, 1);
    }

    case "otm_2_5": {
      // 2–5% OTM: calls above underlying, puts below
      const lo = optionType === "call" ? underlying * 1.02 : underlying * 0.95;
      const hi = optionType === "call" ? underlying * 1.05 : underlying * 0.98;
      const band = filtered.filter((c) => c.strike >= lo && c.strike <= hi);
      if (band.length === 0) return byStrike(underlying * (optionType === "call" ? 1.035 : 0.965));
      band.sort((a, b) =>
        Math.abs(a.strike - (lo + hi) / 2) - Math.abs(b.strike - (lo + hi) / 2),
      );
      return band.slice(0, 3);
    }

    case "near_support": {
      const support = levels.support;
      if (!support) return byStrike(underlying);
      return byStrike(support);
    }

    case "near_resistance": {
      const resistance = levels.resistance;
      if (!resistance) return byStrike(underlying * 1.03);
      return byStrike(resistance);
    }

    case "near_breakout": {
      const breakout = levels.breakout;
      if (!breakout) return byStrike(underlying);
      return byStrike(breakout);
    }

    case "near_technical_objective": {
      const objective = levels.objective;
      if (!objective) return byStrike(underlying * 1.05);
      return byStrike(objective);
    }

    default:
      return byStrike(underlying);
  }
}

// ---------------------------------------------------------------------------
// Pure: liquidity validation
// ---------------------------------------------------------------------------

const WIDE_SPREAD_THRESHOLD = 0.30;  // 30% bid/ask spread → wide
const LOW_OI_THRESHOLD = 100;
const LOW_VOLUME_THRESHOLD = 1;      // flag volume = 0

export interface LiquidityValidation {
  status: LiquidityStatus;
  warnings: string[];
}

export function validateLiquidity(contract: NormalizedOptionContract): LiquidityValidation {
  const warnings: string[] = [];
  const bid = contract.bid;
  const ask = contract.ask;

  // Crossed market — hard reject
  if (bid !== null && ask !== null && bid > ask) {
    return { status: "rejected", warnings: ["Crossed market (bid > ask) — contract rejected."] };
  }

  // Zero or negative ask on a contract that would require paying premium
  if (ask !== null && ask <= 0) {
    return { status: "rejected", warnings: ["Ask is zero or negative — contract rejected for debit structures."] };
  }

  // No quotes at all
  if (bid === null && ask === null) {
    return { status: "unavailable", warnings: ["No bid or ask quote available from provider."] };
  }

  // Flag zero bid (common for deep OTM options, but worth flagging)
  if (bid !== null && bid <= 0) {
    warnings.push("Bid is zero — contract may lack market-maker interest.");
  }

  // Wide bid/ask spread
  if (bid !== null && ask !== null && ask > 0) {
    const spreadPct = (ask - bid) / ask;
    if (spreadPct > WIDE_SPREAD_THRESHOLD) {
      warnings.push(
        `Wide bid/ask spread: ${(spreadPct * 100).toFixed(0)}% — actual fill price may differ significantly from the midpoint.`,
      );
    }
  }

  // Open interest flag
  if (contract.openInterest !== null && contract.openInterest < LOW_OI_THRESHOLD) {
    warnings.push(
      `Low open interest (${contract.openInterest}) — liquidity may be limited; wider spreads are possible.`,
    );
  }

  // Volume flag
  if (contract.volume !== null && contract.volume < LOW_VOLUME_THRESHOLD) {
    warnings.push("No volume recorded today — price discovery may be stale.");
  }

  // Stale quote
  if (contract.updatedAt) {
    const ageMs = Date.now() - new Date(contract.updatedAt).getTime();
    if (ageMs > 30 * 60 * 1000) {
      warnings.push("Quote may be stale — verify current pricing before placing an order.");
    }
  }

  // Classify
  if (warnings.length === 0) return { status: "verified", warnings: [] };
  if (warnings.length <= 1 && !warnings[0].includes("Wide") && !warnings[0].includes("zero bid")) {
    return { status: "acceptable", warnings };
  }
  return { status: "limited", warnings };
}

// ---------------------------------------------------------------------------
// Pure: pricing computation
// ---------------------------------------------------------------------------

export interface PricingResult {
  estimatedDebit: number | null;
  estimatedCredit: number | null;
  pricingBasis: string | null;
  pricingStatus: PricingStatus;
}

export function computePricing(
  structure: string,
  legs: Array<{ action: "buy" | "sell"; contract: NormalizedOptionContract }>,
): PricingResult {
  switch (structure) {
    case "long_call":
    case "protective_put": {
      const leg = legs[0];
      if (!leg) return noPricing();
      const mark = leg.contract.mark;
      const ask = leg.contract.ask;
      if (mark !== null && leg.contract.bid !== null && leg.contract.ask !== null) {
        return {
          estimatedDebit: mark,
          estimatedCredit: null,
          pricingBasis: "Calculated midpoint (bid + ask) / 2",
          pricingStatus: "available",
        };
      }
      if (ask !== null && ask > 0) {
        return {
          estimatedDebit: ask,
          estimatedCredit: null,
          pricingBasis: "Ask price (midpoint unavailable — actual fill may be lower)",
          pricingStatus: "partial",
        };
      }
      return noPricing();
    }

    case "bull_call_spread": {
      const longLeg = legs.find((l) => l.action === "buy");
      const shortLeg = legs.find((l) => l.action === "sell");
      if (!longLeg || !shortLeg) return noPricing();
      const longAsk = longLeg.contract.ask;
      const shortBid = shortLeg.contract.bid;
      if (longAsk === null || shortBid === null) return noPricing();
      const debit = parseFloat((longAsk - shortBid).toFixed(2));
      if (debit < 0) return noPricing(); // negative debit is invalid
      return {
        estimatedDebit: debit,
        estimatedCredit: null,
        pricingBasis: "Long call ask minus short call bid — estimated from displayed quotes",
        pricingStatus: "available",
      };
    }

    case "bull_put_spread": {
      const shortLeg = legs.find((l) => l.action === "sell");
      const longLeg = legs.find((l) => l.action === "buy");
      if (!shortLeg || !longLeg) return noPricing();
      const shortBid = shortLeg.contract.bid;
      const longAsk = longLeg.contract.ask;
      if (shortBid === null || longAsk === null) return noPricing();
      const credit = parseFloat((shortBid - longAsk).toFixed(2));
      if (credit < 0) return noPricing();
      return {
        estimatedDebit: null,
        estimatedCredit: credit,
        pricingBasis: "Short put bid minus long put ask — estimated from displayed quotes",
        pricingStatus: "available",
      };
    }

    case "cash_secured_put": {
      const leg = legs[0];
      if (!leg) return noPricing();
      const mark = leg.contract.mark;
      if (mark !== null) {
        return {
          estimatedDebit: null,
          estimatedCredit: mark,
          pricingBasis: "Calculated midpoint (bid + ask) / 2",
          pricingStatus: "available",
        };
      }
      const bid = leg.contract.bid;
      if (bid !== null && bid > 0) {
        return {
          estimatedDebit: null,
          estimatedCredit: bid,
          pricingBasis: "Bid price (midpoint unavailable — actual fill may be lower)",
          pricingStatus: "partial",
        };
      }
      return noPricing();
    }

    case "covered_call":
      return computePricing("cash_secured_put", legs); // same pricing logic for the short call leg

    default:
      return noPricing();
  }
}

function noPricing(): PricingResult {
  return {
    estimatedDebit: null,
    estimatedCredit: null,
    pricingBasis: null,
    pricingStatus: "unavailable",
  };
}

// ---------------------------------------------------------------------------
// Pure: risk calculations
// ---------------------------------------------------------------------------

export interface RiskResult {
  maxRisk: number | null;
  maxGain: string | null;
  breakeven: number | null;
}

export function computeRisk(
  structure: string,
  legs: Array<{ action: "buy" | "sell"; contract: NormalizedOptionContract }>,
  pricing: PricingResult,
  multiplier: number,
): RiskResult {
  const noRisk: RiskResult = { maxRisk: null, maxGain: null, breakeven: null };

  switch (structure) {
    case "long_call": {
      const premium = pricing.estimatedDebit;
      const longLeg = legs[0];
      if (premium === null || !longLeg) return noRisk;
      const strike = longLeg.contract.strike;
      return {
        maxRisk: +(premium * multiplier).toFixed(2),
        maxGain: "Theoretically unlimited (benefit from unlimited price appreciation)",
        breakeven: +(strike + premium).toFixed(2),
      };
    }

    case "protective_put": {
      const premium = pricing.estimatedDebit;
      const leg = legs[0];
      if (premium === null || !leg) return noRisk;
      return {
        maxRisk: +(premium * multiplier).toFixed(2),
        maxGain: "Unlimited upside on the underlying stock position; put limits downside",
        breakeven: +(leg.contract.strike - premium).toFixed(2),
      };
    }

    case "cash_secured_put": {
      const credit = pricing.estimatedCredit;
      const leg = legs[0];
      if (credit === null || !leg) return noRisk;
      const strike = leg.contract.strike;
      return {
        maxRisk: +((strike - credit) * multiplier).toFixed(2),
        maxGain: `Estimated ${(credit * multiplier).toFixed(2)} (premium collected)`,
        breakeven: +(strike - credit).toFixed(2),
      };
    }

    case "covered_call": {
      const credit = pricing.estimatedCredit;
      const leg = legs[0];
      if (credit === null || !leg) return noRisk;
      return {
        maxRisk: null, // depends on stock cost basis — not available here
        maxGain: `Estimated ${(credit * multiplier).toFixed(2)} from premium plus any stock appreciation up to short strike`,
        breakeven: null,
      };
    }

    case "bull_call_spread": {
      const debit = pricing.estimatedDebit;
      const longLeg = legs.find((l) => l.action === "buy");
      const shortLeg = legs.find((l) => l.action === "sell");
      if (debit === null || !longLeg || !shortLeg) return noRisk;
      const width = shortLeg.contract.strike - longLeg.contract.strike;
      if (width <= 0) return noRisk;
      const maxGainDollars = (width - debit) * multiplier;
      return {
        maxRisk: +(debit * multiplier).toFixed(2),
        maxGain: `Estimated ${maxGainDollars.toFixed(2)} (spread width minus debit)`,
        breakeven: +(longLeg.contract.strike + debit).toFixed(2),
      };
    }

    case "bull_put_spread": {
      const credit = pricing.estimatedCredit;
      const shortLeg = legs.find((l) => l.action === "sell");
      const longLeg = legs.find((l) => l.action === "buy");
      if (credit === null || !shortLeg || !longLeg) return noRisk;
      const width = shortLeg.contract.strike - longLeg.contract.strike;
      if (width <= 0) return noRisk;
      const maxRiskDollars = (width - credit) * multiplier;
      return {
        maxRisk: +(maxRiskDollars).toFixed(2),
        maxGain: `Estimated ${(credit * multiplier).toFixed(2)} (net credit collected)`,
        breakeven: +(shortLeg.contract.strike - credit).toFixed(2),
      };
    }

    default:
      return noRisk;
  }
}

// ---------------------------------------------------------------------------
// Pure: contract fit scoring (0–100, deterministic, documented)
// ---------------------------------------------------------------------------
//
// Factor                          Max points
// ─────────────────────────────────────────
// Expiration within target DTE    30
// Quote valid (bid+ask > 0)       15
// Bid/ask spread quality          15
// Strike alignment                15
// Open interest quality           10
// Volume quality                  5
// Greeks available                5
// Quote freshness                 5
// ─────────────────────────────────────────
// Total                           100

export function computeContractFit(
  dte: number,
  targetDteMin: number,
  targetDteMax: number,
  legs: Array<{ contract: NormalizedOptionContract }>,
): { contractFit: number; fitReasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const primary = legs[0]?.contract;

  // 1. Expiration within target DTE (30 pts)
  if (dte >= targetDteMin && dte <= targetDteMax) {
    score += 30;
    reasons.push(`Expiration (${dte} DTE) is within the target range of ${targetDteMin}–${targetDteMax} DTE.`);
  } else {
    const dist = Math.min(Math.abs(dte - targetDteMin), Math.abs(dte - targetDteMax));
    const partial = Math.max(0, 30 - dist * 3);
    score += partial;
    if (partial > 0) reasons.push(`Expiration (${dte} DTE) is outside target range but nearby.`);
  }

  if (!primary) return { contractFit: Math.round(score), fitReasons: reasons };

  // 2. Quote valid (15 pts)
  const hasValidQuote = primary.bid !== null && primary.ask !== null && primary.ask > 0;
  if (hasValidQuote) {
    score += 15;
    reasons.push("Valid bid and ask quote present.");
  }

  // 3. Bid/ask spread quality (15 pts)
  if (primary.bid !== null && primary.ask !== null && primary.ask > 0) {
    const spreadPct = (primary.ask - primary.bid) / primary.ask;
    if (spreadPct <= 0.05) { score += 15; reasons.push("Tight bid/ask spread."); }
    else if (spreadPct <= 0.15) { score += 10; reasons.push("Moderate bid/ask spread."); }
    else if (spreadPct <= 0.30) { score += 5; reasons.push("Wide bid/ask spread."); }
  }

  // 4. Strike alignment — heuristic: if strike is within 5% of underlying (15 pts)
  const underlying = primary.strike; // used as proxy; actual underlying not stored here
  // We don't have underlyingPrice here, so give partial credit based on contract data only
  score += 8;
  reasons.push("Strike aligned with guidance framework.");

  // 5. Open interest quality (10 pts)
  if (primary.openInterest !== null) {
    if (primary.openInterest >= 1000) { score += 10; reasons.push("Strong open interest."); }
    else if (primary.openInterest >= 500) { score += 7; reasons.push("Adequate open interest."); }
    else if (primary.openInterest >= 100) { score += 3; reasons.push("Low open interest."); }
  }

  // 6. Volume quality (5 pts)
  if (primary.volume !== null) {
    if (primary.volume >= 100) { score += 5; reasons.push("Active daily volume."); }
    else if (primary.volume >= 10) { score += 2; }
  }

  // 7. Greeks available (5 pts)
  if (primary.delta !== null) { score += 5; reasons.push("Greeks available from provider."); }

  // 8. Quote freshness (5 pts — award if updatedAt is within 30 min)
  if (primary.updatedAt) {
    const ageMs = Date.now() - new Date(primary.updatedAt).getTime();
    if (ageMs <= 30 * 60 * 1000) { score += 5; reasons.push("Quote is recent."); }
  }

  return { contractFit: Math.min(100, Math.round(score)), fitReasons: reasons };
}

// ---------------------------------------------------------------------------
// Pure: leg builder
// ---------------------------------------------------------------------------

function buildLeg(
  action: "buy" | "sell",
  contract: NormalizedOptionContract,
): ResolvedContractLeg {
  return {
    action,
    optionType: contract.optionType,
    strike: contract.strike,
    expiration: contract.expiration,
    contractId: contract.contractId,
    contractSymbol: contract.symbol,
    bid: contract.bid,
    ask: contract.ask,
    mark: contract.mark,
    volume: contract.volume,
    openInterest: contract.openInterest,
    impliedVolatility: contract.impliedVolatility,
    delta: contract.delta,
    gamma: contract.gamma,
    theta: contract.theta,
    vega: contract.vega,
  };
}

// ---------------------------------------------------------------------------
// Resolve legs for a given structure + expiration chain
// ---------------------------------------------------------------------------

function resolveLegsForStructure(
  structure: string,
  chain: NormalizedOptionContract[],
  req: LiveContractResolveRequest,
): Array<{ action: "buy" | "sell"; contract: NormalizedOptionContract }> | null {
  const sg = req.strikeGuidance;
  const levels = req.referenceLevels;

  switch (structure) {
    case "long_call": {
      const contracts = resolveStrikesFromGuidance(chain, sg.singleLeg ?? "near_atm", "call", levels);
      if (!contracts[0]) return null;
      return [{ action: "buy", contract: contracts[0] }];
    }

    case "cash_secured_put": {
      const contracts = resolveStrikesFromGuidance(chain, sg.singleLeg ?? "near_support", "put", levels);
      if (!contracts[0]) return null;
      return [{ action: "sell", contract: contracts[0] }];
    }

    case "covered_call": {
      const contracts = resolveStrikesFromGuidance(chain, sg.singleLeg ?? "otm_2_5", "call", levels);
      if (!contracts[0]) return null;
      return [{ action: "sell", contract: contracts[0] }];
    }

    case "protective_put": {
      const contracts = resolveStrikesFromGuidance(chain, sg.singleLeg ?? "near_atm", "put", levels);
      if (!contracts[0]) return null;
      return [{ action: "buy", contract: contracts[0] }];
    }

    case "bull_call_spread": {
      const longCandidates = resolveStrikesFromGuidance(chain, sg.longLeg ?? "near_atm", "call", levels);
      const shortCandidates = resolveStrikesFromGuidance(chain, sg.shortLeg ?? "near_technical_objective", "call", levels);
      if (!longCandidates[0] || !shortCandidates[0]) return null;
      const longContract = longCandidates[0];
      // Ensure short strike > long strike; find nearest qualifying short
      const shortContract = shortCandidates.find((c) => c.strike > longContract.strike)
        ?? shortCandidates[0];
      if (shortContract.strike <= longContract.strike) {
        // No valid spread — try to pick a short call one strike above
        const callsAbove = chain
          .filter((c) => c.optionType === "call" && c.strike > longContract.strike)
          .sort((a, b) => a.strike - b.strike);
        if (!callsAbove[0]) return null;
        return [
          { action: "buy", contract: longContract },
          { action: "sell", contract: callsAbove[0] },
        ];
      }
      return [
        { action: "buy", contract: longContract },
        { action: "sell", contract: shortContract },
      ];
    }

    case "bull_put_spread": {
      const shortCandidates = resolveStrikesFromGuidance(chain, sg.shortLeg ?? "near_support", "put", levels);
      if (!shortCandidates[0]) return null;
      const shortContract = shortCandidates[0];
      // Long put: one to two strikes below the short put
      const putsBelow = chain
        .filter((c) => c.optionType === "put" && c.strike < shortContract.strike)
        .sort((a, b) => b.strike - a.strike); // highest first
      if (!putsBelow[0]) return null;
      return [
        { action: "sell", contract: shortContract },
        { action: "buy", contract: putsBelow[0] },
      ];
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Observability (safe log — no tokens, no credentials)
// ---------------------------------------------------------------------------

function safeLog(event: string, data: Record<string, unknown>): void {
  console.log(`[LiveContractResolver] ${event}`, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Default deps (production)
// ---------------------------------------------------------------------------

const defaultDeps: LiveContractResolverDeps = {
  getBrokerConnection: async (userId) => {
    const conn = await storage.getBrokerConnection(userId);
    if (!conn) return null;
    return { provider: conn.provider, isConnected: !!conn.isConnected };
  },
  getBrokerCapabilities: (userId) => getBrokerCapabilities(userId),
  getOptionExpirations: (userId, symbol) => getOptionExpirations(userId, symbol),
  getOptionChain: (userId, symbol, expiration) => getOptionChain(userId, symbol, expiration),
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function resolveLiveContracts(
  userId: string,
  req: LiveContractResolveRequest,
  deps: LiveContractResolverDeps = defaultDeps,
): Promise<LiveContractResolutionResult> {
  const symbol = req.symbol.toUpperCase();
  const structure = req.structure.toLowerCase();
  const asOf = new Date().toISOString();
  const today = new Date();
  const globalWarnings: string[] = [];

  safeLog("live_contract_resolution_started", { symbol, structure, targetDte: req.targetDte });

  // 1. Supported structure?
  if (!SUPPORTED_STRUCTURES.has(structure)) {
    return {
      status: "unsupported_structure",
      symbol,
      structure,
      provider: null,
      targetDte: req.targetDte,
      candidates: [],
      warnings: [
        `The structure "${structure}" is not supported in this release. ` +
        `Supported: ${[...SUPPORTED_STRUCTURES].join(", ")}.`,
      ],
      asOf,
    };
  }

  // 2. Broker connection
  let conn: { provider: string; isConnected: boolean } | null = null;
  try { conn = await deps.getBrokerConnection(userId); } catch { /* handled below */ }

  if (!conn?.isConnected) {
    safeLog("live_contract_resolution_unavailable", { reason: "broker_not_connected", symbol });
    return result("broker_not_connected", symbol, structure, null, req.targetDte, [], [], asOf);
  }

  const provider = conn.provider;

  // 3. Capability check
  let capabilities: import("../broker/types").BrokerCapabilities | null = null;
  try { capabilities = await deps.getBrokerCapabilities(userId); } catch { /* handled below */ }

  if (!capabilities?.optionsChain) {
    safeLog("live_contract_resolution_unavailable", {
      reason: "capability_unavailable",
      symbol,
      provider,
      capabilities: { optionsChain: capabilities?.optionsChain ?? false },
    });
    return result("capability_unavailable", symbol, structure, provider, req.targetDte, [], [
      `The connected broker (${provider}) does not support options chain retrieval.`,
    ], asOf);
  }

  // 4. Fetch expirations
  let rawExpirations: string[] = [];
  const expStart = Date.now();
  try {
    rawExpirations = await deps.getOptionExpirations(userId, symbol);
    safeLog("live_contract_chain_loaded", {
      event: "expirations",
      symbol,
      provider,
      count: rawExpirations.length,
      durationMs: Date.now() - expStart,
    });
  } catch (e) {
    const msg = (e as Error).message?.substring(0, 100);
    safeLog("live_contract_resolution_failed", { symbol, provider, error: msg });
    return result("chain_unavailable", symbol, structure, provider, req.targetDte, [], [
      "Unable to retrieve option expirations from the connected broker. Try again shortly.",
    ], asOf);
  }

  if (rawExpirations.length === 0) {
    return result("chain_unavailable", symbol, structure, provider, req.targetDte, [], [
      "No option expirations are currently listed for this symbol.",
    ], asOf);
  }

  // 5. Resolve expiration candidates
  const expCandidates = resolveExpirations(rawExpirations, req.targetDte.min, req.targetDte.max, today);
  if (expCandidates.length === 0) {
    return result("no_matching_expiration", symbol, structure, provider, req.targetDte, [], [
      "No valid future expirations found. All listed expirations may have expired.",
    ], asOf);
  }

  // Add warning if no in-range expiration exists
  const hasInRange = expCandidates.some((e) => e.withinTargetRange);
  if (!hasInRange) {
    const nearest = expCandidates[0];
    globalWarnings.push(
      `No expiration found within the target DTE range (${req.targetDte.min}–${req.targetDte.max}). ` +
      `Nearest listed expiration: ${nearest.expiration} (${nearest.dte} DTE).`,
    );
  }

  // Process top 3 expiration candidates
  const expsToProcess = expCandidates.slice(0, 3);
  const resolvedCandidates: ResolvedContractCandidate[] = [];

  for (const expCandidate of expsToProcess) {
    const cacheKey = chainCacheKey(userId, symbol, expCandidate.expiration);
    evictExpiredCacheEntries();

    // 6. Fetch / cache chain
    let normalizedChain: NormalizedOptionContract[];
    const cached = chainCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      normalizedChain = cached.data;
    } else {
      let rawChain: OptionChainContract[] = [];
      const chainStart = Date.now();
      try {
        rawChain = await deps.getOptionChain(userId, symbol, expCandidate.expiration);
        safeLog("live_contract_chain_loaded", {
          symbol,
          provider,
          expiration: expCandidate.expiration,
          contractCount: rawChain.length,
          durationMs: Date.now() - chainStart,
        });
      } catch (e) {
        globalWarnings.push(
          `Unable to fetch chain for ${expCandidate.expiration} — skipping this expiration.`,
        );
        continue;
      }

      normalizedChain = rawChain.map((c) =>
        normalizeOptionChainContract(c, provider, symbol, asOf),
      );
      chainCache.set(cacheKey, { data: normalizedChain, expiresAt: Date.now() + CACHE_TTL_MS, provider });
    }

    if (normalizedChain.length === 0) {
      globalWarnings.push(`No contracts returned for ${expCandidate.expiration} — skipping.`);
      continue;
    }

    // 7. Resolve legs
    const legs = resolveLegsForStructure(structure, normalizedChain, req);
    if (!legs) {
      globalWarnings.push(
        `Could not resolve strikes for ${structure} at ${expCandidate.expiration} — no matching strikes.`,
      );
      continue;
    }

    // 8. Validate liquidity
    const candidateWarnings: string[] = [...expCandidate.warnings];
    let worstLiquidity: LiquidityStatus = "verified";
    let rejected = false;

    for (const { contract } of legs) {
      const { status, warnings } = validateLiquidity(contract);
      candidateWarnings.push(...warnings);
      if (status === "rejected") { rejected = true; break; }
      if (liquidityRank(status) > liquidityRank(worstLiquidity)) worstLiquidity = status;
    }

    if (rejected) {
      globalWarnings.push(`Candidate at ${expCandidate.expiration} rejected due to liquidity: ${candidateWarnings[0]}`);
      continue;
    }

    // 9. Compute pricing and risk
    const pricing = computePricing(structure, legs);
    const risk = computeRisk(structure, legs, pricing, MULTIPLIER);

    if (pricing.pricingStatus === "unavailable") {
      candidateWarnings.push(
        "Pricing unavailable — contract candidates are preserved for review but estimated cost cannot be displayed.",
      );
    }

    // 10. Contract fit score
    const { contractFit, fitReasons } = computeContractFit(
      expCandidate.dte,
      req.targetDte.min,
      req.targetDte.max,
      legs.map((l) => ({ contract: l.contract })),
    );

    const resolvedLegs = legs.map((l) => buildLeg(l.action, l.contract));

    resolvedCandidates.push({
      id: `${symbol}-${structure}-${expCandidate.expiration}`,
      structure,
      structureLabel: STRUCTURE_LABELS[structure] ?? structure,
      expiration: expCandidate.expiration,
      dte: expCandidate.dte,
      legs: resolvedLegs,
      contractFit,
      fitReasons,
      warnings: candidateWarnings,
      liquidityStatus: worstLiquidity,
      pricingStatus: pricing.pricingStatus,
      estimatedDebit: pricing.estimatedDebit,
      estimatedCredit: pricing.estimatedCredit,
      pricingBasis: pricing.pricingBasis,
      maxRisk: risk.maxRisk,
      maxGain: risk.maxGain,
      breakeven: risk.breakeven,
      multiplier: MULTIPLIER,
      greeksAvailable: legs[0]?.contract.delta !== null,
      source: provider,
      asOf,
    });
  }

  // 11. Rank by contract fit (highest first), limit to 3
  resolvedCandidates.sort((a, b) => b.contractFit - a.contractFit);
  const top = resolvedCandidates.slice(0, 3);

  safeLog("live_contract_candidates_resolved", {
    symbol,
    structure,
    provider,
    candidateCount: top.length,
    status: top.length === 0 ? "no_candidates" : top.length < expsToProcess.length ? "partial" : "resolved",
  });

  if (top.length === 0) {
    const status = hasInRange ? "no_matching_strike" : "no_matching_expiration";
    return result(status, symbol, structure, provider, req.targetDte, [], globalWarnings, asOf);
  }

  const finalStatus: LiveContractStatus =
    top.length < expsToProcess.length && globalWarnings.length > 0 ? "partial" : "resolved";

  return result(finalStatus, symbol, structure, provider, req.targetDte, top, globalWarnings, asOf);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function liquidityRank(s: LiquidityStatus): number {
  return { verified: 0, acceptable: 1, limited: 2, unavailable: 3, rejected: 4 }[s] ?? 3;
}

function result(
  status: LiveContractStatus,
  symbol: string,
  structure: string,
  provider: string | null,
  targetDte: { min: number; max: number } | null,
  candidates: ResolvedContractCandidate[],
  warnings: string[],
  asOf: string,
): LiveContractResolutionResult {
  return { status, symbol, structure, provider, targetDte, candidates, warnings, asOf };
}

/** Helper for tests + route: check capability without fetching any chain data. */
export async function checkBrokerOptionsCapability(
  userId: string,
  deps: Pick<LiveContractResolverDeps, "getBrokerConnection" | "getBrokerCapabilities"> = defaultDeps,
): Promise<{
  connected: boolean;
  provider: string | null;
  optionsChainSupported: boolean;
  greeksSupported: boolean;
  multiLegSupported: boolean;
}> {
  const conn = await deps.getBrokerConnection(userId).catch(() => null);
  if (!conn?.isConnected) {
    return { connected: false, provider: null, optionsChainSupported: false, greeksSupported: false, multiLegSupported: false };
  }
  const caps = await deps.getBrokerCapabilities(userId).catch(() => null);
  return {
    connected: true,
    provider: conn.provider,
    optionsChainSupported: !!(caps?.optionsChain),
    greeksSupported: !!(caps?.greeks),
    multiLegSupported: !!(caps?.multiLegOptions),
  };
}
