/**
 * Sprint 2.7.4 — Trade Risk & Scenario Analysis Engine
 *
 * Pure deterministic engine. No broker calls, no AI, no order construction.
 * All inputs come from the server-side TradeRiskScenarioInput handoff (2.7.3)
 * plus a server-resolved underlyingPrice and user constraints.
 *
 * PROBABILITY METRICS: OFF (probabilityMetricsEnabled = false always).
 * Audit finding: probability-engine.ts is a heuristic confidence scorer (0–100
 * weighted composite), not a validated statistical probability model.
 * Default decision: exclude probability claims from 2.7.4.
 *
 * THEORETICAL PRICING: Not used for pre-expiration repricing.
 * options-evaluator.ts has a Black-Scholes ATM approximation but it lacks
 * full validation for multi-leg structures and American-style early exercise.
 * Pre-expiration estimates use delta approximation only, clearly labeled.
 */

import type { TradeRiskScenarioInput } from "../../shared/contract-research-types";
import type { TradePlanningConstraints } from "../../shared/trade-planning-types";
import type { ContractResearchLeg, ContractResearchMetrics, OptionsContractResearchResult } from "../../shared/contract-research-types";
import type { OptionsStrategyFamily } from "../../shared/options-strategy-types";
import {
  RISK_SCENARIO_DISCLAIMER,
  RISK_SCENARIO_VERSION,
  DEFAULT_PRICE_SCENARIO_PCTS,
  DEFAULT_IV_SCENARIO_PCTS,
  MIDPOINT_EXECUTION_NOTE,
  STALE_QUOTE_THRESHOLD_MINUTES,
  LOW_OI_THRESHOLD,
  WIDE_SPREAD_THRESHOLD_PCT,
} from "../../shared/trade-risk-scenario-types";
import type {
  TradeRiskScenarioResult,
  RiskAnalysisHealth,
  RiskFlag,
  RiskFlagCode,
  GainLossValue,
  BreakevenPoint,
  PayoffProfile,
  CapitalProfile,
  GreekProfile,
  PriceScenario,
  VolatilityScenario,
  TimeDecayScenario,
  EventScenario,
  LiquidityRisk,
  QuoteRisk,
  ThesisRisk,
  ConstraintCheck,
  StructureSummary,
  StructureLegSummary,
  TradePlanInput,
  RiskAnalysisRequest,
} from "../../shared/trade-risk-scenario-types";
import { STRATEGY_FAMILY_LABELS } from "../../shared/options-strategy-types";

// ===========================================================================
// Session-level contract research result cache
// Populated by POST /session/:id/options/contracts route
// Consumed by POST /session/:id/risk-analysis route
// Keys: sessionId (string)
// ===========================================================================

const _sessionContractResearchCache = new Map<
  string,
  { result: OptionsContractResearchResult; storedAt: number }
>();
const SESSION_CONTRACT_RESEARCH_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function storeSessionContractResearch(
  sessionId: string,
  result: OptionsContractResearchResult,
): void {
  _sessionContractResearchCache.set(sessionId, { result, storedAt: Date.now() });
}

export function getSessionContractResearch(
  sessionId: string,
): OptionsContractResearchResult | null {
  const entry = _sessionContractResearchCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > SESSION_CONTRACT_RESEARCH_TTL_MS) {
    _sessionContractResearchCache.delete(sessionId);
    return null;
  }
  return entry.result;
}

// ===========================================================================
// Risk analysis result cache (5-min TTL per user+session+candidate)
// ===========================================================================

const _riskCache = new Map<string, { result: TradeRiskScenarioResult; expiresAt: number }>();
const RISK_CACHE_TTL_MS = 5 * 60 * 1000;

function riskCacheKey(userId: string, sessionId: string, candidateId: string): string {
  return `${userId}:${sessionId}:${candidateId}`;
}

export function getCachedRiskAnalysis(
  userId: string,
  sessionId: string,
  candidateId: string,
): TradeRiskScenarioResult | null {
  const key = riskCacheKey(userId, sessionId, candidateId);
  const entry = _riskCache.get(key);
  if (!entry || Date.now() >= entry.expiresAt) {
    _riskCache.delete(key);
    return null;
  }
  return entry.result;
}

function cacheRiskAnalysis(
  userId: string,
  sessionId: string,
  candidateId: string,
  result: TradeRiskScenarioResult,
): void {
  const key = riskCacheKey(userId, sessionId, candidateId);
  _riskCache.set(key, { result, expiresAt: Date.now() + RISK_CACHE_TTL_MS });
}

/** Clear all caches — used in tests. */
export function clearRiskScenarioCache(): void {
  _riskCache.clear();
  _sessionContractResearchCache.clear();
}

// ===========================================================================
// Health metrics (admin aggregate — no PII logged)
// ===========================================================================

const _health: RiskAnalysisHealth = {
  riskAnalysesRequested:        0,
  riskAnalysesCompleted:        0,
  partialRiskAnalyses:          0,
  failedRiskAnalyses:           0,
  averageRiskAnalysisLatencyMs: null,
  staleRiskAnalyses:            0,
  probabilityMetricsEnabled:    false,
  lastSuccessfulRiskAnalysisAt: null,
};

const _latencies: number[] = [];

function recordHealth(latencyMs: number, isPartial: boolean, isStale: boolean): void {
  _health.riskAnalysesCompleted++;
  if (isPartial) _health.partialRiskAnalyses++;
  if (isStale) _health.staleRiskAnalyses++;
  _latencies.push(latencyMs);
  if (_latencies.length > 200) _latencies.shift();
  _health.averageRiskAnalysisLatencyMs =
    Math.round(_latencies.reduce((a, b) => a + b, 0) / _latencies.length);
  _health.lastSuccessfulRiskAnalysisAt = new Date().toISOString();
}

export function getRiskAnalysisHealth(): RiskAnalysisHealth {
  return { ..._health };
}

// ===========================================================================
// Helpers
// ===========================================================================

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Intrinsic value of a single option at given price (per share). */
function intrinsicPerShare(optionType: "call" | "put", strike: number, price: number): number {
  return optionType === "call"
    ? Math.max(0, price - strike)
    : Math.max(0, strike - price);
}

/**
 * Aggregate intrinsic payoff across all legs at a given underlying price.
 * Returns dollars per contract (one spread unit × multiplier).
 */
function aggregateIntrinsicPayoff(
  legs: ContractResearchLeg[],
  scenarioPrice: number,
  multiplier: number,
): number {
  let total = 0;
  for (const leg of legs) {
    const sign = leg.role === "long_leg" ? 1 : -1;
    total += sign * intrinsicPerShare(leg.optionType, leg.strike, scenarioPrice);
  }
  return r2(total * multiplier);
}

/**
 * Net debit/credit from metrics or derived from legs.
 * Returns { debit, credit } — exactly one will be non-null for valid structures.
 */
function resolveNetDebitCredit(
  metrics: ContractResearchMetrics,
  legs: ContractResearchLeg[],
): { debit: number | null; credit: number | null } {
  if (metrics.estimatedDebit !== null || metrics.estimatedCredit !== null) {
    return { debit: metrics.estimatedDebit, credit: metrics.estimatedCredit };
  }
  // Derive from legs midpoints
  let net = 0;
  for (const leg of legs) {
    if (leg.midpoint === null) return { debit: null, credit: null };
    net += leg.role === "long_leg" ? leg.midpoint : -leg.midpoint;
  }
  if (net >= 0) return { debit: r2(net), credit: null };
  return { debit: null, credit: r2(-net) };
}

/** Extract the primary IV (average of long legs, or best available). */
function primaryIV(legs: ContractResearchLeg[]): number | null {
  const ivs = legs
    .filter(l => l.impliedVolatility !== null)
    .map(l => l.impliedVolatility as number);
  if (ivs.length === 0) return null;
  return r2(ivs.reduce((a, b) => a + b, 0) / ivs.length);
}

/** Parse a price level from an invalidation note (e.g. "below $142.50"). */
function parseInvalidationPrice(note: string | null): number | null {
  if (!note) return null;
  const match = note.match(/\$(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

// ===========================================================================
// Strategy-specific payoff computation
// ===========================================================================

function computePayoffProfile(
  strategyFamily: OptionsStrategyFamily,
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
  underlyingPrice: number | null,
): PayoffProfile {
  const multiplier = metrics.contractMultiplier;
  const { debit, credit } = resolveNetDebitCredit(metrics, legs);

  const longCalls  = legs.filter(l => l.role === "long_leg"  && l.optionType === "call").sort((a, b) => a.strike - b.strike);
  const shortCalls = legs.filter(l => l.role === "short_leg" && l.optionType === "call").sort((a, b) => a.strike - b.strike);
  const longPuts   = legs.filter(l => l.role === "long_leg"  && l.optionType === "put").sort((a, b) => b.strike - a.strike);  // desc
  const shortPuts  = legs.filter(l => l.role === "short_leg" && l.optionType === "put").sort((a, b) => b.strike - a.strike);

  const defined = (dollars: number, note: string): GainLossValue =>
    ({ type: "DEFINED", perContractDollars: r2(dollars), note });
  const substantial = (note: string): GainLossValue =>
    ({ type: "SUBSTANTIAL", perContractDollars: null, note });
  const unlimited = (note: string): GainLossValue =>
    ({ type: "UNLIMITED", perContractDollars: null, note });
  const pathDep = (note: string): GainLossValue =>
    ({ type: "PATH_DEPENDENT", perContractDollars: null, note });
  const na = (note: string): GainLossValue =>
    ({ type: "NOT_APPLICABLE", perContractDollars: null, note });

  const breakeven = (price: number, label: string, refPrice: number | null): BreakevenPoint => ({
    price: r2(price),
    label,
    distanceFromRefPct: refPrice ? r2(((price - refPrice) / refPrice) * 100) : null,
  });

  const ref = underlyingPrice;

  switch (strategyFamily) {
    case "long_call": {
      const d = debit ?? (longCalls[0]?.midpoint ?? null);
      const strike = longCalls[0]?.strike ?? null;
      return {
        maxLoss: d !== null ? defined(d * multiplier, `Premium paid: $${r2(d)} × ${multiplier}`) : substantial("Premium paid (midpoint unavailable)"),
        maxGain: unlimited("Theoretically unlimited — underlying has no upside cap."),
        breakevens: (strike !== null && d !== null) ? [breakeven(strike + d, "Breakeven", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Max loss is limited to the premium paid. Time decay works against long options.",
      };
    }
    case "long_put": {
      const d = debit ?? (longPuts[0]?.midpoint ?? null);
      const strike = longPuts[0]?.strike ?? null;
      const maxGainDollars = (strike !== null && d !== null) ? (strike - d) * multiplier : null;
      return {
        maxLoss: d !== null ? defined(d * multiplier, `Premium paid: $${r2(d)} × ${multiplier}`) : substantial("Premium paid (midpoint unavailable)"),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `Strike − Premium × Multiplier (if underlying falls to zero)`)
          : substantial("Bounded by underlying reaching zero (data unavailable)"),
        breakevens: (strike !== null && d !== null) ? [breakeven(strike - d, "Breakeven", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Max loss is limited to the premium paid. Max gain is bounded by underlying reaching zero.",
      };
    }
    case "covered_call": {
      const c = credit ?? (shortCalls[0]?.midpoint ?? null);
      const callStrike = shortCalls[0]?.strike ?? null;
      const maxGainDollars = (callStrike !== null && ref !== null && c !== null)
        ? (callStrike - ref + c) * multiplier : null;
      const bePrice = (ref !== null && c !== null) ? ref - c : null;
      return {
        maxLoss: substantial(
          "Underlying downside is substantial — the stock can fall significantly. Premium received offsets a portion only."
        ),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `(Call Strike − Reference + Credit) × Multiplier — upside capped at short strike`)
          : substantial("Upside capped at call strike (data unavailable for exact calculation)"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Reference − Premium)", ref)] : [],
        isDefinedRisk: false,
        payoffNote: "Covered call retains substantial downside risk of the underlying. Upside is capped at the short call strike. Early assignment possible.",
      };
    }
    case "cash_secured_put": {
      const c = credit ?? (shortPuts[0]?.midpoint ?? null);
      const putStrike = shortPuts[0]?.strike ?? null;
      const maxGainDollars = c !== null ? c * multiplier : null;
      const bePrice = (putStrike !== null && c !== null) ? putStrike - c : null;
      return {
        maxLoss: substantial(
          `Substantial downside if underlying falls significantly below put strike. Worst-case scenario: underlying approaches zero.`
        ),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `Premium received: $${r2(c!)} × ${multiplier}`)
          : substantial("Premium received (midpoint unavailable)"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Strike − Premium)", ref)] : [],
        isDefinedRisk: false,
        payoffNote: "Cash-secured put exposes the trader to substantial underlying downside. Assignment may result in acquiring shares at the put strike.",
      };
    }
    case "protective_put": {
      const d = debit ?? (longPuts[0]?.midpoint ?? null);
      const putStrike = longPuts[0]?.strike ?? null;
      const maxLossDollars = (ref !== null && putStrike !== null && d !== null)
        ? (ref - putStrike + d) * multiplier : null;
      const bePrice = (ref !== null && d !== null) ? ref + d : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Reference − Put Strike + Premium) × Multiplier — downside bounded`)
          : substantial("Bounded downside (data unavailable for exact calculation)"),
        maxGain: unlimited("Theoretically unlimited — stock upside retained, net of put premium paid."),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Reference + Premium)", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Protective put bounds downside at the put strike minus premium paid. Stock upside is retained (net of cost).",
      };
    }
    case "collar": {
      const putStrike  = longPuts[0]?.strike ?? null;
      const callStrike = shortCalls[0]?.strike ?? null;
      const netCost = debit ?? (credit !== null ? -credit : null);
      const maxLossDollars = (ref !== null && putStrike !== null && netCost !== null)
        ? (ref - putStrike + netCost) * multiplier : null;
      const maxGainDollars = (callStrike !== null && ref !== null && netCost !== null)
        ? (callStrike - ref - netCost) * multiplier : null;
      const bePrice = (ref !== null && netCost !== null) ? ref + netCost : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Reference − Put Strike + Net Cost) × Multiplier`)
          : substantial("Bounded downside (data unavailable for exact calculation)"),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `(Call Strike − Reference − Net Cost) × Multiplier`)
          : substantial("Capped upside (data unavailable for exact calculation)"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven", ref)] : [],
        isDefinedRisk: false,
        payoffNote: "Collar protects downside with a long put while capping upside with a short call. Net cost depends on premium differential.",
      };
    }
    case "bull_call_spread": {
      const longStrike  = longCalls[0]?.strike ?? null;
      const shortStrike = shortCalls[0]?.strike ?? null;
      const width = (longStrike !== null && shortStrike !== null) ? Math.abs(shortStrike - longStrike) : metrics.width;
      const d = debit;
      const maxGainDollars = (width !== null && d !== null) ? (width - d) * multiplier : null;
      const bePrice = (longStrike !== null && d !== null) ? longStrike + d : null;
      return {
        maxLoss: d !== null ? defined(d * multiplier, `Net debit: $${r2(d)} × ${multiplier}`) : substantial("Net debit unavailable"),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `(Spread Width − Net Debit) × Multiplier`)
          : substantial("Spread width or debit unavailable"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Long Strike + Net Debit)", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Bull call spread: max loss is the net debit; max gain is capped at the spread width minus net debit.",
      };
    }
    case "bear_put_spread": {
      const longStrike  = longPuts[0]?.strike ?? null;   // higher strike for bear put
      const shortStrike = shortPuts[0]?.strike ?? null;  // lower strike
      const width = (longStrike !== null && shortStrike !== null) ? Math.abs(longStrike - shortStrike) : metrics.width;
      const d = debit;
      const maxGainDollars = (width !== null && d !== null) ? (width - d) * multiplier : null;
      const bePrice = (longStrike !== null && d !== null) ? longStrike - d : null;
      return {
        maxLoss: d !== null ? defined(d * multiplier, `Net debit: $${r2(d)} × ${multiplier}`) : substantial("Net debit unavailable"),
        maxGain: maxGainDollars !== null
          ? defined(maxGainDollars, `(Spread Width − Net Debit) × Multiplier`)
          : substantial("Spread width or debit unavailable"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Long Put Strike − Net Debit)", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Bear put spread: max loss is the net debit; max gain capped at spread width minus net debit.",
      };
    }
    case "bull_put_spread": {
      // Short higher-strike put, long lower-strike put
      const shortPutStrike = shortPuts[0]?.strike ?? null;
      const longPutStrike  = longPuts[0]?.strike ?? null;
      const width = (shortPutStrike !== null && longPutStrike !== null) ? Math.abs(shortPutStrike - longPutStrike) : metrics.width;
      const c = credit;
      const maxLossDollars = (width !== null && c !== null) ? (width - c) * multiplier : null;
      const bePrice = (shortPutStrike !== null && c !== null) ? shortPutStrike - c : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Spread Width − Net Credit) × Multiplier`)
          : substantial("Spread width or credit unavailable"),
        maxGain: c !== null ? defined(c * multiplier, `Net credit: $${r2(c)} × ${multiplier}`) : substantial("Net credit unavailable"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Short Put Strike − Net Credit)", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Bull put spread: max gain is net credit received; max loss is spread width minus net credit.",
      };
    }
    case "bear_call_spread": {
      // Short lower-strike call, long higher-strike call
      const shortCallStrike = shortCalls[0]?.strike ?? null;
      const longCallStrike  = longCalls[0]?.strike ?? null;
      const width = (longCallStrike !== null && shortCallStrike !== null) ? Math.abs(longCallStrike - shortCallStrike) : metrics.width;
      const c = credit;
      const maxLossDollars = (width !== null && c !== null) ? (width - c) * multiplier : null;
      const bePrice = (shortCallStrike !== null && c !== null) ? shortCallStrike + c : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Spread Width − Net Credit) × Multiplier`)
          : substantial("Spread width or credit unavailable"),
        maxGain: c !== null ? defined(c * multiplier, `Net credit: $${r2(c)} × ${multiplier}`) : substantial("Net credit unavailable"),
        breakevens: bePrice !== null ? [breakeven(bePrice, "Breakeven (Short Call Strike + Net Credit)", ref)] : [],
        isDefinedRisk: true,
        payoffNote: "Bear call spread: max gain is net credit received; max loss is spread width minus net credit.",
      };
    }
    case "iron_condor": {
      // 4 legs: long put (lowest) < short put < short call < long call (highest)
      const allPuts  = legs.filter(l => l.optionType === "put").sort((a, b) => a.strike - b.strike);
      const allCalls = legs.filter(l => l.optionType === "call").sort((a, b) => a.strike - b.strike);
      const sp = allPuts.find(l => l.role === "short_leg")?.strike ?? null;
      const sc = allCalls.find(l => l.role === "short_leg")?.strike ?? null;
      const putWingWidth  = allPuts.length >= 2 ? Math.abs(allPuts[1].strike - allPuts[0].strike) : null;
      const callWingWidth = allCalls.length >= 2 ? Math.abs(allCalls[1].strike - allCalls[0].strike) : null;
      const maxWing = putWingWidth !== null && callWingWidth !== null
        ? Math.max(putWingWidth, callWingWidth)
        : (putWingWidth ?? callWingWidth);
      const c = credit;
      const maxLossDollars = (maxWing !== null && c !== null) ? (maxWing - c) * multiplier : null;
      const lowerBe = (sp !== null && c !== null) ? sp - c : null;
      const upperBe = (sc !== null && c !== null) ? sc + c : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Max Wing Width − Net Credit) × Multiplier`)
          : substantial("Wing width or credit unavailable"),
        maxGain: c !== null ? defined(c * multiplier, `Net credit: $${r2(c)} × ${multiplier} (underlying stays between short strikes)`) : substantial("Net credit unavailable"),
        breakevens: [
          ...(lowerBe !== null ? [breakeven(lowerBe, "Lower Breakeven (Short Put Strike − Net Credit)", ref)] : []),
          ...(upperBe !== null ? [breakeven(upperBe, "Upper Breakeven (Short Call Strike + Net Credit)", ref)] : []),
        ],
        isDefinedRisk: true,
        payoffNote: "Iron condor: profits when underlying stays within the short-strike range. Max loss is one wing width minus credit.",
      };
    }
    case "iron_butterfly": {
      const shortStrike = shortPuts[0]?.strike ?? shortCalls[0]?.strike ?? null;
      const allPuts  = legs.filter(l => l.optionType === "put").sort((a, b) => a.strike - b.strike);
      const allCalls = legs.filter(l => l.optionType === "call").sort((a, b) => a.strike - b.strike);
      const wingWidth = allPuts.length >= 2 ? Math.abs(allPuts[1].strike - allPuts[0].strike) : null;
      const c = credit;
      const maxLossDollars = (wingWidth !== null && c !== null) ? (wingWidth - c) * multiplier : null;
      const lowerBe = (shortStrike !== null && c !== null) ? shortStrike - c : null;
      const upperBe = (shortStrike !== null && c !== null) ? shortStrike + c : null;
      return {
        maxLoss: maxLossDollars !== null
          ? defined(maxLossDollars, `(Wing Width − Net Credit) × Multiplier`)
          : substantial("Wing width or credit unavailable"),
        maxGain: c !== null ? defined(c * multiplier, `Net credit: $${r2(c)} × ${multiplier} (underlying at short strike at expiration)`) : substantial("Net credit unavailable"),
        breakevens: [
          ...(lowerBe !== null ? [breakeven(lowerBe, "Lower Breakeven (Short Strike − Net Credit)", ref)] : []),
          ...(upperBe !== null ? [breakeven(upperBe, "Upper Breakeven (Short Strike + Net Credit)", ref)] : []),
        ],
        isDefinedRisk: true,
        payoffNote: "Iron butterfly: max gain if underlying finishes exactly at the short strike. Max loss is wing width minus credit.",
      };
    }
    case "calendar_spread":
    case "diagonal_spread": {
      return {
        maxLoss: pathDep(
          "Calendar and diagonal spreads are path-, time-, and volatility-dependent. " +
          "Max loss cannot be expressed as a single closed-form value in this sprint."
        ),
        maxGain: pathDep(
          "Max gain is path- and volatility-dependent — depends on IV differential between expirations."
        ),
        breakevens: [],
        isDefinedRisk: false,
        payoffNote: "Calendar and diagonal spread analysis requires multi-expiration modeling. Scenario analysis is indicative only.",
      };
    }
    default: {
      return {
        maxLoss: na("Strategy not supported in this analysis sprint."),
        maxGain: na("Strategy not supported in this analysis sprint."),
        breakevens: [],
        isDefinedRisk: false,
        payoffNote: "Payoff profile not available for this strategy family.",
      };
    }
  }
}

// ===========================================================================
// Capital Profile
// ===========================================================================

function computeCapitalProfile(
  strategyFamily: OptionsStrategyFamily,
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
  underlyingPrice: number | null,
): CapitalProfile {
  const multiplier = metrics.contractMultiplier;
  const { debit, credit } = resolveNetDebitCredit(metrics, legs);
  const shortPuts = legs.filter(l => l.role === "short_leg" && l.optionType === "put");

  let grossNotional: number | null = null;
  let estimatedScenarioCapital: number | null = null;
  let capitalNote = "";

  if (strategyFamily === "cash_secured_put" && shortPuts[0]) {
    grossNotional = r2(shortPuts[0].strike * multiplier);
    estimatedScenarioCapital = grossNotional;
    capitalNote = `Estimated scenario capital: put strike $${shortPuts[0].strike} × ${multiplier} = $${grossNotional} (cash-secured capital).`;
  } else if (strategyFamily === "covered_call" && underlyingPrice !== null) {
    estimatedScenarioCapital = r2(underlyingPrice * multiplier);
    capitalNote = `Estimated scenario capital: reference price $${underlyingPrice} × ${multiplier} = $${estimatedScenarioCapital} (underlying cost at reference).`;
  } else if (debit !== null) {
    estimatedScenarioCapital = r2(debit * multiplier);
    capitalNote = `Estimated scenario capital (debit): $${r2(debit)} × ${multiplier} = $${estimatedScenarioCapital}.`;
  } else if (credit !== null) {
    // Credit structures: capital not at risk is spread width − credit for defined-risk
    const width = metrics.width;
    if (width !== null) {
      const maxLossPerShare = width - credit;
      estimatedScenarioCapital = r2(Math.max(0, maxLossPerShare) * multiplier);
      capitalNote = `Estimated scenario capital (max loss at risk): (Spread Width $${width} − Credit $${r2(credit)}) × ${multiplier} = $${estimatedScenarioCapital}.`;
    } else {
      estimatedScenarioCapital = null;
      capitalNote = "Credit structure — scenario capital depends on margin requirement (not computable without position).";
    }
  } else {
    capitalNote = "Scenario capital unavailable — option data incomplete.";
  }

  return {
    netDebitPerContract:          debit,
    netCreditPerContract:         credit,
    grossContractNotional:        grossNotional,
    estimatedScenarioCapital,
    estimatedScenarioCapitalNote: capitalNote,
    contractMultiplier:           multiplier,
    debitCreditType:              metrics.debitCreditType,
  };
}

// ===========================================================================
// Greek Profile
// ===========================================================================

function computeGreekProfile(
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
): GreekProfile {
  const multiplier = metrics.contractMultiplier;

  // Use metrics values (already sign-corrected) if available
  const netDelta = metrics.netDelta;
  const netGamma = metrics.netGamma;
  const netTheta = metrics.netTheta;
  const netVega  = metrics.netVega;

  // Rho: aggregate from legs since metrics doesn't expose it
  let netRho: number | null = null;
  const rhoLegs = legs.filter(l => l.rho !== null);
  if (rhoLegs.length === legs.length) {
    netRho = r2(legs.reduce((sum, l) => sum + (l.role === "long_leg" ? 1 : -1) * (l.rho ?? 0), 0));
  }

  // Coverage: percent of legs that provided non-null delta (proxy for Greeks coverage)
  const deltaLegs = legs.filter(l => l.delta !== null).length;
  const greeksCoveragePercent = legs.length > 0 ? Math.round((deltaLegs / legs.length) * 100) : 0;
  const partialGreeks = greeksCoveragePercent < 100;

  const deltaAbs = netDelta !== null ? Math.abs(netDelta) : null;
  const deltaDir = netDelta !== null ? (netDelta > 0 ? "positive (net long delta)" : "negative (net short delta)") : "unknown";

  return {
    netDelta,
    netGamma,
    netTheta,
    netVega,
    netRho,
    greeksCoveragePercent,
    partialGreeks,
    greeksNote: partialGreeks
      ? `Greeks coverage is partial (${greeksCoveragePercent}% of legs). Missing Greeks remain null — never substituted with zero.`
      : "Greeks computed across all legs.",
    deltaInterpretation:
      `Delta estimates the structure's sensitivity to a $1 change in the underlying price, all else equal. ` +
      `Net delta is ${deltaDir}${deltaAbs !== null ? ` (magnitude: ${r2(deltaAbs)})` : ""}.` +
      ` Delta is NOT a probability measure.`,
    gammaInterpretation:
      "Gamma estimates how net delta may change as the underlying price changes. High gamma near expiration can cause rapid delta shifts.",
    thetaInterpretation:
      netTheta !== null
        ? `Net theta of ${r2(netTheta)} estimates the structure's time-decay sensitivity per calendar day, all else equal. ` +
          "Actual daily P/L will not exactly equal theta — theta itself changes over time."
        : "Theta unavailable (partial Greek coverage).",
    vegaInterpretation:
      netVega !== null
        ? `Net vega of ${r2(netVega)} estimates the sensitivity to a 1-percentage-point change in implied volatility, all else equal. ` +
          "This is an approximation — not a guarantee."
        : "Vega unavailable (partial Greek coverage).",
  };
}

// ===========================================================================
// Price Scenarios
// ===========================================================================

function computePriceScenarios(
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
  breakevens: BreakevenPoint[],
  underlyingPrice: number,
  invalidationNote: string | null,
  scenarioPcts: number[],
): PriceScenario[] {
  const multiplier = metrics.contractMultiplier;
  const { debit, credit } = resolveNetDebitCredit(metrics, legs);
  const netDelta = metrics.netDelta;
  const invalidationPrice = parseInvalidationPrice(invalidationNote);

  // Initial cash flow: positive for credit structures, negative for debit
  const initialCashFlow = credit !== null ? credit * multiplier : (debit !== null ? -(debit * multiplier) : 0);

  const scenarios: PriceScenario[] = scenarioPcts.map(movePct => {
    const scenarioPrice = r2(underlyingPrice * (1 + movePct / 100));

    // 1. Expiration intrinsic payoff
    const intrinsic = aggregateIntrinsicPayoff(legs, scenarioPrice, multiplier);
    const expirationPnl = r2(intrinsic + initialCashFlow);

    // 2. Delta approximation (pre-expiration estimate)
    let deltaApproxPnl: number | null = null;
    let deltaNote = "Delta approximation unavailable — net delta missing.";
    if (netDelta !== null) {
      const priceChange = scenarioPrice - underlyingPrice;
      deltaApproxPnl = r2(netDelta * priceChange * multiplier);
      deltaNote =
        "Delta approximation only: netDelta × price change × multiplier. " +
        "This is a first-order approximation, not a theoretical model price. " +
        "Actual pre-expiration value depends on time, volatility, and higher-order Greeks.";
    }

    // Nearest breakeven distance
    let nearestBreakevenDistance: number | null = null;
    if (breakevens.length > 0) {
      const distances = breakevens.map(b => scenarioPrice - b.price);
      nearestBreakevenDistance = r2(distances.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)));
    }

    // Thesis invalidation
    let thesisStatus: PriceScenario["thesisInvalidationStatus"] = "UNKNOWN";
    let thesisNote: string | null = null;
    if (invalidationPrice !== null) {
      if (scenarioPrice < invalidationPrice) {
        thesisStatus = "BELOW_INVALIDATION";
        thesisNote = `Scenario price $${scenarioPrice} is below research invalidation reference $${invalidationPrice}.`;
      } else {
        thesisStatus = "WITHIN_RANGE";
        thesisNote = `Scenario price $${scenarioPrice} is above research invalidation reference $${invalidationPrice}.`;
      }
    }

    const payoffLabel =
      expirationPnl > 0.01 ? "Gain" : expirationPnl < -0.01 ? "Loss" : "At Breakeven";

    return {
      movePct,
      scenarioPrice,
      expirationIntrinsicPnlPerContract: expirationPnl,
      expirationPayoffLabel: payoffLabel,
      deltaApproxPnlPerContract: deltaApproxPnl,
      deltaApproxMethodologyNote: deltaNote,
      nearestBreakevenDistance,
      thesisInvalidationStatus: thesisStatus,
      thesisInvalidationNote: thesisNote,
      isCurrent: movePct === 0,
    };
  });

  return scenarios;
}

// ===========================================================================
// Volatility Scenarios (vega approximation)
// ===========================================================================

function computeVolatilityScenarios(
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
  ivChangePcts: number[],
): VolatilityScenario[] {
  const multiplier = metrics.contractMultiplier;
  const netVega = metrics.netVega;
  const baseIV = primaryIV(legs);

  return ivChangePcts.map(relPct => {
    const label = relPct === 0 ? "Current IV" : relPct > 0 ? `IV +${relPct}% (relative)` : `IV −${Math.abs(relPct)}% (relative)`;
    const scenarioIV = baseIV !== null ? r2(baseIV * (1 + relPct / 100)) : null;

    let estimatedChange: number | null = null;
    let method: VolatilityScenario["methodology"] = "UNAVAILABLE";
    let methodNote = "Net vega unavailable — IV sensitivity cannot be estimated.";

    if (netVega !== null && baseIV !== null) {
      // ΔIV (absolute decimal) = baseIV × relPct / 100
      // Value change per share = netVega × (ΔIV × 100 pct-points)
      // Per contract = value change per share × multiplier
      const deltaIVDecimal = baseIV * (relPct / 100);
      const deltaIVPctPoints = deltaIVDecimal * 100;
      estimatedChange = r2(netVega * deltaIVPctPoints * multiplier);
      method = "VEGA_APPROXIMATION";
      methodNote =
        "Vega approximation: netVega × ΔIV (pct-points) × multiplier. " +
        "First-order approximation — actual sensitivity is non-linear and varies with time and underlying price. " +
        "Not a theoretical model price.";
    } else if (netVega === null) {
      methodNote = "Net vega is null (partial Greek coverage) — IV sensitivity unavailable.";
    }

    return {
      ivRelativeChangePct: relPct,
      ivRelativeChangePctLabel: label,
      baseIVDecimal: baseIV,
      scenarioIVDecimal: scenarioIV,
      estimatedValueChangePerContract: estimatedChange,
      methodology: method,
      methodologyNote: methodNote,
    };
  });
}

// ===========================================================================
// Time Decay Scenarios (theta approximation)
// ===========================================================================

function computeTimeDecayScenarios(
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
  primaryDte: number,
): TimeDecayScenario[] {
  const multiplier = metrics.contractMultiplier;
  const netTheta = metrics.netTheta;

  const checkpoints = [
    { label: "Today",            elapsed: 0 },
    { label: "25% Time Elapsed", elapsed: Math.round(primaryDte * 0.25) },
    { label: "50% Time Elapsed", elapsed: Math.round(primaryDte * 0.50) },
    { label: "75% Time Elapsed", elapsed: Math.round(primaryDte * 0.75) },
    { label: "Near Expiration",  elapsed: Math.max(0, primaryDte - 2) },
    { label: "At Expiration",    elapsed: primaryDte },
  ];

  const thetaNote =
    "Theta approximation: cumulative estimated decay = netTheta × days elapsed × multiplier. " +
    "Theta itself changes over time (accelerates near expiration) — this estimate uses a constant theta and is a local approximation only. " +
    "Actual decay will differ from this linear projection.";

  return checkpoints.map(cp => {
    const daysRemaining = Math.max(0, primaryDte - cp.elapsed);

    if (cp.label === "At Expiration") {
      return {
        label: cp.label,
        daysElapsed: cp.elapsed,
        daysRemaining: 0,
        cumulativeEstimatedDecayPerContract: null,
        methodology: "AT_EXPIRATION_INTRINSIC",
        methodologyNote: "At expiration, value is intrinsic payoff only. See price scenarios for expiration P/L.",
      };
    }

    let cumulativeDecay: number | null = null;
    let method: TimeDecayScenario["methodology"] = "UNAVAILABLE";
    let note = "Net theta unavailable — time decay estimate not possible.";

    if (netTheta !== null) {
      cumulativeDecay = r2(netTheta * cp.elapsed * multiplier);
      method = "THETA_APPROXIMATION";
      note = thetaNote;
    }

    return {
      label: cp.label,
      daysElapsed: cp.elapsed,
      daysRemaining,
      cumulativeEstimatedDecayPerContract: cumulativeDecay,
      methodology: method,
      methodologyNote: note,
    };
  });
}

// ===========================================================================
// Event Scenarios
// ===========================================================================

function computeEventScenarios(
  legs: ContractResearchLeg[],
  eventExposure: {
    containsEarnings: boolean;
    eventType: string | null;
    earningsDate: string | null;
    insideEventWindow: boolean;
    eventNote: string;
  } | undefined,
  strategyFamily: OptionsStrategyFamily,
): EventScenario[] {
  if (!eventExposure?.containsEarnings && !eventExposure?.insideEventWindow) return [];

  const eventDate = eventExposure.earningsDate ?? null;
  const hasShortLeg = legs.some(l => l.role === "short_leg");

  let assignmentNote: string | null = null;
  if (hasShortLeg) {
    assignmentNote =
      "Short option legs carry assignment risk around earnings and events. " +
      "Early assignment, while uncommon for out-of-the-money options, is possible.";
  }

  return [{
    eventType:                eventExposure.eventType ?? "Earnings/Event",
    eventDate,
    eventWithinStructureLife: eventExposure.insideEventWindow,
    daysUntilEvent:           null, // Would need current date to compute
    gapRiskNote:
      "Earnings and material events may cause significant underlying price gaps. " +
      "Gap moves can exceed any price scenario presented here.",
    ivUncertaintyNote:
      "Implied volatility typically increases before earnings and collapses after. " +
      "This IV behavior is not captured in static scenario estimates.",
    assignmentRiskNote: assignmentNote,
  }];
}

// ===========================================================================
// Liquidity & Quote Risk
// ===========================================================================

function computeLiquidityRisk(
  legs: ContractResearchLeg[],
  qualityCategory: string,
): LiquidityRisk {
  const spreads = legs.map(l => l.spreadPct).filter((v): v is number => v !== null);
  const ois = legs.map(l => l.openInterest).filter((v): v is number => v !== null);
  const vols = legs.map(l => l.volume).filter((v): v is number => v !== null);

  const widestSpread = spreads.length > 0 ? Math.max(...spreads) : null;
  const lowestOI     = ois.length > 0 ? Math.min(...ois) : null;
  const lowestVol    = vols.length > 0 ? Math.min(...vols) : null;

  // Freshness: any leg older than threshold?
  const now = Date.now();
  const staleThresholdMs = STALE_QUOTE_THRESHOLD_MINUTES * 60 * 1000;
  let freshness: LiquidityRisk["quoteFreshness"] = "UNKNOWN";
  const hasUpdatedAt = legs.some(l => l.updatedAt !== null);
  if (hasUpdatedAt) {
    const isAnyStale = legs.some(l => {
      if (!l.updatedAt) return false;
      return now - new Date(l.updatedAt).getTime() > staleThresholdMs;
    });
    freshness = isAnyStale ? "STALE" : "FRESH";
  }

  // Worst leg liquidity
  const liquidityRanks = ["EXCELLENT", "GOOD", "FAIR", "THIN", "ILLIQUID", "UNAVAILABLE"];
  const worstLiquidity = legs.reduce<string>((worst, leg) => {
    const rank = liquidityRanks.indexOf(leg.liquidity as string);
    const worstRank = liquidityRanks.indexOf(worst);
    return rank > worstRank ? leg.liquidity as string : worst;
  }, "EXCELLENT");

  return {
    overallLiquidityCategory: qualityCategory,
    worstLegLiquidityLabel:   worstLiquidity,
    quoteFreshness:           freshness,
    widestBidAskSpreadPct:    widestSpread !== null ? r2(widestSpread) : null,
    lowestOpenInterest:       lowestOI,
    lowestVolume:             lowestVol,
    executionNote:            MIDPOINT_EXECUTION_NOTE,
  };
}

// ===========================================================================
// Quote Risk (bid / midpoint / ask sensitivity illustration)
// ===========================================================================

function computeQuoteRisk(
  legs: ContractResearchLeg[],
  metrics: ContractResearchMetrics,
): QuoteRisk {
  const multiplier = metrics.contractMultiplier;

  let bidSide: number | null = null;
  let askSide: number | null = null;
  let midSide = metrics.estimatedDebit ?? (metrics.estimatedCredit !== null ? null : null);

  // Compute bid-side and ask-side costs
  const hasBidAsk = legs.every(l => l.bid !== null && l.ask !== null);
  if (hasBidAsk) {
    let bidNet = 0;
    let askNet = 0;
    for (const leg of legs) {
      // For buyer: long leg cost = ask; short leg proceeds = bid
      if (leg.role === "long_leg") {
        bidNet += leg.bid!;    // worst-case buy = ask, but bid/ask from market is what market shows
        askNet += leg.ask!;
      } else {
        bidNet -= leg.ask!;    // worst-case sell = bid side (receive less)
        askNet -= leg.bid!;
      }
    }
    // If net positive = debit; show as positive debit amounts
    bidSide = r2(Math.abs(bidNet) * multiplier);
    askSide = r2(Math.abs(askNet) * multiplier);
  }

  return {
    midpointNote:
      "Midpoint references are used for scenario analysis. Actual fills may differ significantly from midpoint, particularly for illiquid structures.",
    bidSideDebitPerContract:  bidSide,
    askSideDebitPerContract:  askSide,
    midpointDebitPerContract: metrics.estimatedDebit !== null
      ? r2(metrics.estimatedDebit * multiplier)
      : (metrics.estimatedCredit !== null ? null : null),
    spreadIllustrationNote:
      "Bid-to-ask spread range illustrates execution uncertainty. Not a simulation — actual execution price is unknown.",
  };
}

// ===========================================================================
// Risk Flags
// ===========================================================================

function computeRiskFlags(
  payoffProfile: PayoffProfile,
  liquidityRisk: LiquidityRisk,
  constraintCheck: ConstraintCheck,
  eventScenarios: EventScenario[],
  greekProfile: GreekProfile,
  strategyFamily: OptionsStrategyFamily,
  legs: ContractResearchLeg[],
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (constraintCheck.status === "EXCEEDS_CONSTRAINT") {
    flags.push({ code: "MAX_LOSS_EXCEEDS_CONSTRAINT", note: constraintCheck.statusNote });
  }
  if (eventScenarios.length > 0) {
    flags.push({ code: "EVENT_WINDOW", note: "Expiration window contains an earnings event or material announcement." });
  }
  if (liquidityRisk.quoteFreshness === "STALE") {
    flags.push({ code: "STALE_QUOTE", note: `Option quotes are older than ${STALE_QUOTE_THRESHOLD_MINUTES} minutes. Midpoint references may not reflect current market.` });
  }
  if (liquidityRisk.widestBidAskSpreadPct !== null && liquidityRisk.widestBidAskSpreadPct > WIDE_SPREAD_THRESHOLD_PCT) {
    flags.push({ code: "WIDE_BID_ASK", note: `Widest leg bid-ask spread: ${liquidityRisk.widestBidAskSpreadPct.toFixed(1)}% — execution cost may be significant.` });
  }
  if (liquidityRisk.lowestOpenInterest !== null && liquidityRisk.lowestOpenInterest < LOW_OI_THRESHOLD) {
    flags.push({ code: "LOW_OPEN_INTEREST", note: `Lowest leg open interest: ${liquidityRisk.lowestOpenInterest} contracts — liquidity risk is elevated.` });
  }
  if (greekProfile.partialGreeks) {
    flags.push({ code: "PARTIAL_GREEKS", note: `Greeks coverage: ${greekProfile.greeksCoveragePercent}%. Missing Greeks remain null in all estimates.` });
  }
  if (payoffProfile.maxLoss.type === "PATH_DEPENDENT" || payoffProfile.maxGain.type === "PATH_DEPENDENT") {
    flags.push({ code: "PATH_DEPENDENT_PAYOFF", note: "This strategy's payoff depends on the path of price and volatility — closed-form max gain/loss not available." });
  }
  if (legs.some(l => l.role === "short_leg")) {
    flags.push({ code: "ASSIGNMENT_RISK", note: "Short option legs carry assignment risk. Early assignment is possible, particularly for in-the-money options near expiration or ex-dividend dates." });
  }
  if (strategyFamily === "covered_call" || strategyFamily === "cash_secured_put") {
    flags.push({ code: "EARLY_EXERCISE_RISK", note: "American-style equity options may be exercised early. Covered calls and cash-secured puts have early assignment exposure." });
  }
  if (payoffProfile.maxGain.type === "UNLIMITED") {
    flags.push({ code: "UNLIMITED_GAIN", note: "Theoretical maximum gain is unlimited (long call). Actual outcomes are bounded by market conditions." });
  }
  if (payoffProfile.maxLoss.type === "SUBSTANTIAL") {
    flags.push({ code: "SUBSTANTIAL_UNDERLYING_DOWNSIDE", note: "This strategy retains substantial underlying downside risk. The premium received does not fully protect against large adverse moves." });
  }

  return flags;
}

// ===========================================================================
// Constraint Check
// ===========================================================================

function computeConstraintCheck(
  payoffProfile: PayoffProfile,
  constraints: TradePlanningConstraints | null,
): ConstraintCheck {
  const userMax = constraints?.maxCapitalAtRisk ?? null;
  const maxLossVal = payoffProfile.maxLoss;
  const scenarioMaxLoss = maxLossVal.type === "DEFINED" ? maxLossVal.perContractDollars : null;

  if (userMax === null) {
    return {
      userMaxCapitalAtRisk: null,
      scenarioMaxLoss,
      status: "NO_CONSTRAINT_SET",
      statusNote: "No maximum capital-at-risk planning constraint has been set. Set one in Trade Planning Constraints to see a comparison.",
    };
  }
  if (scenarioMaxLoss === null) {
    return {
      userMaxCapitalAtRisk: userMax,
      scenarioMaxLoss: null,
      status: "UNDEFINED_RISK",
      statusNote: `Selected planning constraint: $${userMax}. Scenario maximum loss is not defined (${maxLossVal.type.toLowerCase().replace("_", " ")} risk). Cannot compare numerically.`,
    };
  }
  if (scenarioMaxLoss <= userMax) {
    return {
      userMaxCapitalAtRisk: userMax,
      scenarioMaxLoss,
      status: "WITHIN_CONSTRAINT",
      statusNote: `Scenario max loss $${scenarioMaxLoss} is within the selected planning constraint of $${userMax}.`,
    };
  }
  return {
    userMaxCapitalAtRisk: userMax,
    scenarioMaxLoss,
    status: "EXCEEDS_CONSTRAINT",
    statusNote: `Scenario max loss $${scenarioMaxLoss} exceeds the selected planning constraint of $${userMax}. Return to Contract Research to select a different candidate if desired.`,
  };
}

// ===========================================================================
// Structure Summary
// ===========================================================================

function computeStructureSummary(
  input: TradeRiskScenarioInput,
  underlyingPrice: number | null,
  qualityCategoryLabel: string,
  eventNote: string,
): StructureSummary {
  const metrics = input.currentStructureMetrics;
  const legs = input.legs;
  const { debit, credit } = resolveNetDebitCredit(metrics, legs);
  const midpoint = debit ?? credit;
  const iv = primaryIV(legs);
  const stratLabel = (STRATEGY_FAMILY_LABELS as Record<string, string>)[input.strategyFamily] ?? input.strategyFamily;

  const legSummaries: StructureLegSummary[] = legs.map(leg => ({
    role:       (leg.role === "long_leg" || leg.role === "short_leg" ? leg.role : "long_leg") as "long_leg" | "short_leg",
    roleLabel:  leg.roleLabel,
    optionType: leg.optionType,
    strike:     leg.strike,
    expiration: leg.expiration,
    dte:        leg.dte,
    midpoint:   leg.midpoint,
    ivDisplay:  leg.impliedVolatility !== null ? pct(leg.impliedVolatility) : null,
    delta:      leg.delta,
  }));

  const expirations = Array.from(new Set(legs.map(l => l.expiration)));
  const primaryDte = Math.max(...legs.map(l => l.dte));

  return {
    strategyFamily:       input.strategyFamily,
    strategyLabel:        stratLabel,
    expirations,
    primaryDte,
    legs:                 legSummaries,
    referencePrice:       underlyingPrice,
    referencePriceLabel:  underlyingPrice !== null ? `$${underlyingPrice} (reference)` : "Reference price unavailable",
    estimatedMidpoint:    midpoint,
    debitCreditType:      metrics.debitCreditType,
    contractMultiplier:   metrics.contractMultiplier,
    primaryIVDisplay:     iv !== null ? pct(iv) : null,
    eventWindowNote:      eventNote,
    liquidityCategoryLabel: qualityCategoryLabel,
  };
}

// ===========================================================================
// Thesis Risk
// ===========================================================================

function computeThesisRisk(input: TradeRiskScenarioInput): ThesisRisk {
  const invalidationPrice = parseInvalidationPrice(input.invalidationNote);
  return {
    researchThesisSummary: input.researchThesisSummary,
    invalidationNote:      input.invalidationNote,
    invalidationPriceLevel: invalidationPrice,
    thesisIntegrationNote:
      invalidationPrice !== null
        ? `Research invalidation reference level: $${invalidationPrice}. Scenarios crossing this level are marked in the price scenario table.`
        : "No specific invalidation price level parsed from planning context. Review the research thesis for qualitative invalidation criteria.",
  };
}

// ===========================================================================
// Main engine entry point
// ===========================================================================

export interface BuildRiskScenarioInput {
  input:            TradeRiskScenarioInput;
  userId:           string;
  sessionId:        string;
  underlyingPrice:  number | null;
  constraints:      TradePlanningConstraints | null;
  qualityCategory:  string;
  eventExposure?: {
    containsEarnings: boolean;
    eventType: string | null;
    earningsDate: string | null;
    insideEventWindow: boolean;
    eventNote: string;
  };
  marketDataAsOf:   string | null;
  optionDataAsOf:   string | null;
  customScenarioPcts?: number[];
  customIVChangePcts?: number[];
}

export function buildTradeRiskScenarioResult(opts: BuildRiskScenarioInput): TradeRiskScenarioResult {
  const t0 = Date.now();
  _health.riskAnalysesRequested++;

  const {
    input, userId, sessionId, underlyingPrice, constraints,
    qualityCategory, eventExposure, marketDataAsOf, optionDataAsOf,
    customScenarioPcts, customIVChangePcts,
  } = opts;

  const strategyFamily = input.strategyFamily as OptionsStrategyFamily;
  const legs           = input.legs;
  const metrics        = input.currentStructureMetrics;
  const multiplier     = metrics.contractMultiplier;
  const primaryDte     = Math.max(...legs.map(l => l.dte), 0);

  const scenarioPcts = customScenarioPcts ?? DEFAULT_PRICE_SCENARIO_PCTS;
  const ivChangePcts = customIVChangePcts ?? DEFAULT_IV_SCENARIO_PCTS;

  // Core computations
  const payoffProfile    = computePayoffProfile(strategyFamily, legs, metrics, underlyingPrice);
  const capitalProfile   = computeCapitalProfile(strategyFamily, legs, metrics, underlyingPrice);
  const greekProfile     = computeGreekProfile(legs, metrics);
  const constraintCheck  = computeConstraintCheck(payoffProfile, constraints);
  const liquidityRisk    = computeLiquidityRisk(legs, qualityCategory);
  const quoteRisk        = computeQuoteRisk(legs, metrics);
  const thesisRisk       = computeThesisRisk(input);
  const eventScenarios   = computeEventScenarios(legs, eventExposure, strategyFamily);
  const riskFlags        = computeRiskFlags(
    payoffProfile, liquidityRisk, constraintCheck, eventScenarios, greekProfile, strategyFamily, legs,
  );

  // Price scenarios (only if we have a reference price)
  const priceScenarios: PriceScenario[] = underlyingPrice !== null
    ? computePriceScenarios(legs, metrics, payoffProfile.breakevens, underlyingPrice, input.invalidationNote, scenarioPcts)
    : [];

  const volatilityScenarios = computeVolatilityScenarios(legs, metrics, ivChangePcts);
  const timeDecayScenarios  = computeTimeDecayScenarios(legs, metrics, primaryDte);

  // Event window note for structure summary
  const eventNote = eventExposure?.eventNote ?? "No earnings or events detected within structure life.";

  const structureSummary = computeStructureSummary(input, underlyingPrice, qualityCategory, eventNote);

  // Stale detection
  const isStale = liquidityRisk.quoteFreshness === "STALE";
  const staleReasons: string[] = isStale
    ? [`Option quotes are older than ${STALE_QUOTE_THRESHOLD_MINUTES} minutes.`]
    : [];

  // Partial detection
  const isPartial = greekProfile.partialGreeks || priceScenarios.length === 0;

  const analysisId = crypto.randomUUID();
  const now = new Date().toISOString();
  const latencyMs = Date.now() - t0;

  // Assumptions & limitations
  const assumptions: string[] = [
    "Expiration payoff uses intrinsic value math (put-call parity at expiration).",
    "Pre-expiration estimates use first-order delta approximation only.",
    "One contract unit = one spread unit × multiplier.",
    "IV scenarios use vega approximation — linear and local only.",
    "Time decay scenarios use constant theta approximation — theta accelerates near expiration.",
    "No commission or transaction costs included.",
    "American-style equity options — early exercise not modeled.",
  ];

  const limitations: string[] = [
    "No theoretical (Black-Scholes) model price is used. The existing options-evaluator.ts model has not been validated for multi-leg structures.",
    "Calendar and diagonal spreads require multi-expiration modeling not yet implemented.",
    "Probability metrics are disabled — the existing heuristic confidence scorer is not a validated statistical model.",
    "Dividend and ex-date effects are not modeled.",
    "Portfolio-level Greeks and correlation are not included in 2.7.4.",
  ];

  const warnings: string[] = [
    ...(riskFlags.map(f => f.note)),
    "Scenario values are hypothetical and not forecasts.",
  ];

  // 2.7.5 handoff
  const tradePlanHandoff: TradePlanInput = {
    planningContextId:             input.planningContextId,
    selectedExpressionFamily:      input.strategyFamily,
    contractResearchCandidateId:   input.contractResearchCandidateId,
    equityPlanningScenarioId:      null,
    riskScenarioAnalysisId:        analysisId,
    researchThesis:                input.researchThesisSummary,
    planningConstraintsFingerprint: input.planningConstraintsFingerprint,
    monitoringPlan:                null,
    riskFlags:                     riskFlags.map(f => f.code),
    invalidationContext:           input.invalidationNote,
  };

  const result: TradeRiskScenarioResult = {
    id:                          analysisId,
    userId,
    planningContextId:           input.planningContextId,
    contractResearchCandidateId: input.contractResearchCandidateId,

    symbol:        structureSummary.strategyFamily, // will be overwritten by route
    strategyFamily: input.strategyFamily,

    generatedAt:       now,
    marketDataAsOf,
    optionDataAsOf,
    generationLatencyMs: latencyMs,

    structureSummary,
    capitalProfile,
    payoffProfile,
    greekProfile,
    priceScenarios,
    volatilityScenarios,
    timeDecayScenarios,
    eventScenarios,

    liquidityRisk,
    quoteRisk,
    thesisRisk,
    constraintCheck,
    portfolioContext: null,

    riskFlags,
    assumptions,
    limitations,
    warnings,

    probabilityMetricsEnabled: false,
    probabilityMetricsNote:
      "Probability metrics are disabled in this sprint. " +
      "The existing heuristic confidence scorer (probability-engine.ts) is a weighted 0–100 composite " +
      "signal quality indicator, not a validated statistical probability model. " +
      "Probability claims require a clearly defined and defensible methodology. Default: OFF.",

    freshness: { isStale, staleReasons, optionDataAge: optionDataAsOf },

    methodologyVersion: RISK_SCENARIO_VERSION,
    disclaimer: RISK_SCENARIO_DISCLAIMER,
    optionsRiskDisclosure:
      "Options trading involves significant risk. Multi-leg options strategies involve additional complexity and may not be appropriate for all traders. " +
      "Losses can exceed the premium paid for long options. Short options can result in assignment. " +
      "Read the Characteristics and Risks of Standardized Options (ODD) before trading.",

    tradePlanHandoff,
  };

  // Cache
  cacheRiskAnalysis(userId, sessionId, input.contractResearchCandidateId, result);

  recordHealth(latencyMs, isPartial, isStale);

  return result;
}
