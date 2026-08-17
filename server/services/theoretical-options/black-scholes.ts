/**
 * server/services/theoretical-options/black-scholes.ts
 *
 * Sprint 2.8.7C — Black-Scholes-Merton Pricing Engine (Dividend-Adjusted).
 *
 * MODEL: Black-Scholes-Merton with continuous dividend yield.
 * Canonical name: "BLACK_SCHOLES_CONTINUOUS_DIVIDEND"
 *
 * ─────────────────────────────────────────────────────────
 * INPUTS:
 *   S     = underlying price
 *   K     = strike price
 *   T     = time to expiration in calendar-year fraction (DTE / 365)
 *   r     = risk-free rate (annualized, decimal)
 *   q     = continuous dividend yield (annualized, decimal; 0 if unknown)
 *   sigma = annualized volatility (e.g. HV30)
 *
 * TIME CONVENTION (CRITICAL):
 *   T = DTE / 365   (calendar-time fraction)
 *
 *   NOT DTE / 252.
 *   252 is used exclusively for annualizing trading-day realized volatility.
 *   BSM time-to-expiration uses calendar days.
 *
 * ─────────────────────────────────────────────────────────
 * FORMULAS:
 *   d1 = [ln(S/K) + (r - q + sigma²/2) × T] / (sigma × sqrt(T))
 *   d2 = d1 - sigma × sqrt(T)
 *
 *   Call = S × e^(-qT) × N(d1) - K × e^(-rT) × N(d2)
 *   Put  = K × e^(-rT) × N(-d2) - S × e^(-qT) × N(-d1)
 *
 * ─────────────────────────────────────────────────────────
 * GREEKS (per contract, not per 1% or per $100):
 *   Delta_call  = e^(-qT) × N(d1)
 *   Delta_put   = e^(-qT) × [N(d1) - 1]
 *   Gamma       = e^(-qT) × phi(d1) / (S × sigma × sqrt(T))
 *   Theta_call  = [-S × e^(-qT) × phi(d1) × sigma / (2 × sqrt(T))
 *                  - r × K × e^(-rT) × N(d2)
 *                  + q × S × e^(-qT) × N(d1)] / 365   (per calendar day)
 *   Theta_put   = [-S × e^(-qT) × phi(d1) × sigma / (2 × sqrt(T))
 *                  + r × K × e^(-rT) × N(-d2)
 *                  - q × S × e^(-qT) × N(-d1)] / 365  (per calendar day)
 *   Vega        = S × e^(-qT) × phi(d1) × sqrt(T) / 100  (per 1% vol change)
 *   Rho_call    = K × T × e^(-rT) × N(d2) / 100          (per 1% rate change)
 *   Rho_put     = -K × T × e^(-rT) × N(-d2) / 100        (per 1% rate change)
 *
 * ─────────────────────────────────────────────────────────
 * QUALITY RULES:
 *   T ≤ 0 or sigma ≤ 0 or S ≤ 0 or K ≤ 0 → UNAVAILABLE, all outputs null
 *   DTE < SHORT_DTE_WARNING_THRESHOLD (7)  → SHORT_DTE_WARNING
 *   |ln(S/K)| > DEEP_MONEYNESS_THRESHOLD  → DEEP_ITM_OTM_WARNING
 *
 * ─────────────────────────────────────────────────────────
 * FORBIDDEN OUTPUT FIELD NAMES: price, bid, ask, last, mark, midpoint, executionPrice
 * REQUIRED OUTPUT FIELD NAMES: modelCallValue, modelPutValue, modelDelta, etc.
 */

import type { TheoreticalGreeks, TheoreticalQuality } from "@shared/theoretical-options-types";
import {
  SHORT_DTE_WARNING_THRESHOLD,
  DEEP_MONEYNESS_THRESHOLD,
  BSM_MODEL_NAME,
  GREEK_SOURCE_VCP,
} from "@shared/theoretical-options-types";

// ===========================================================================
// Normal distribution helpers
// ===========================================================================

/**
 * Standard normal PDF: phi(x) = (1/sqrt(2π)) × e^(-x²/2)
 */
export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF: N(x)
 *
 * Uses Abramowitz & Stegun approximation 26.2.17 (maximum error: 7.5e-8).
 * Suitable for options pricing; accuracy is consistent with production use.
 */
export function normCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))));
  const cdf = 1 - normPDF(x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

// ===========================================================================
// BSM inputs and outputs
// ===========================================================================

export interface BSMInputs {
  /** Underlying price (S). Must be > 0. */
  S: number;
  /** Strike price (K). Must be > 0. */
  K: number;
  /**
   * Time to expiration in CALENDAR-YEAR fraction (T = DTE / 365).
   * NOT DTE / 252.
   */
  T: number;
  /** Risk-free rate (annualized decimal, e.g. 0.045). */
  r: number;
  /** Continuous dividend yield (annualized decimal; 0 = no dividend). */
  q: number;
  /** Annualized volatility from realized/historical vol (e.g. 0.35 = 35%). */
  sigma: number;
}

export interface BSMOutputs {
  model: typeof BSM_MODEL_NAME;
  d1: number | null;
  d2: number | null;
  /** Theoretical call value. Never named "price", "bid", "ask", or "mark". */
  modelCallValue: number | null;
  /** Theoretical put value. Never named "price", "bid", "ask", or "mark". */
  modelPutValue: number | null;
  callGreeks: TheoreticalGreeks | null;
  putGreeks: TheoreticalGreeks | null;
  quality: TheoreticalQuality;
  qualityNote: string | null;
}

// ===========================================================================
// Quality assessment
// ===========================================================================

function assessQuality(inputs: BSMInputs, dte: number): TheoreticalQuality {
  const { S, K, T, sigma } = inputs;

  // Structural invalidity → UNAVAILABLE
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return "UNAVAILABLE";

  // Short DTE (T valid but < threshold)
  if (dte < SHORT_DTE_WARNING_THRESHOLD) return "SHORT_DTE_WARNING";

  // Deep ITM/OTM: |ln(S/K)| > threshold
  const lnMoneyness = Math.abs(Math.log(S / K));
  if (lnMoneyness > DEEP_MONEYNESS_THRESHOLD) return "DEEP_ITM_OTM_WARNING";

  return "NORMAL";
}

function qualityNote(q: TheoreticalQuality): string | null {
  switch (q) {
    case "SHORT_DTE_WARNING":
      return "DTE < 7 — model accuracy degrades significantly near expiration.";
    case "DEEP_ITM_OTM_WARNING":
      return "Strike is deeply ITM or OTM — BSM reliability is reduced at extreme moneyness.";
    case "UNAVAILABLE":
      return "Required inputs are invalid or missing — all outputs are null.";
    default:
      return null;
  }
}

// ===========================================================================
// Moneyness classification
// ===========================================================================

export function classifyMoneyness(
  S: number,
  K: number,
): "ATM" | "ITM" | "OTM" {
  // ATM: within 1% of underlying price
  const ratio = Math.abs(S - K) / S;
  if (ratio <= 0.01) return "ATM";
  return K < S ? "ITM" : "OTM";
}

// ===========================================================================
// Main BSM calculator
// ===========================================================================

/**
 * Compute BSM theoretical call/put values and model Greeks.
 *
 * @param inputs - BSM inputs (S, K, T, r, q, sigma)
 * @param dte    - Raw DTE (used for quality checks only; T must already be DTE/365)
 */
export function computeBSM(inputs: BSMInputs, dte: number): BSMOutputs {
  const { S, K, T, r, q, sigma } = inputs;

  const quality = assessQuality(inputs, dte);

  if (quality === "UNAVAILABLE") {
    return {
      model: BSM_MODEL_NAME,
      d1: null,
      d2: null,
      modelCallValue: null,
      modelPutValue: null,
      callGreeks: null,
      putGreeks: null,
      quality,
      qualityNote: qualityNote(quality),
    };
  }

  const sqrtT = Math.sqrt(T);
  const sigmaSqrtT = sigma * sqrtT;

  // BSM d1 and d2
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;

  // Discount factors
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);

  // Normal CDF values
  const Nd1  = normCDF(d1);
  const Nd2  = normCDF(d2);
  const Nnd1 = normCDF(-d1);
  const Nnd2 = normCDF(-d2);

  // Normal PDF at d1 (for Gamma, Theta, Vega)
  const phiD1 = normPDF(d1);

  // Theoretical values — never named bid, ask, price, mark, or midpoint
  const modelCallValue = S * eqT * Nd1 - K * erT * Nd2;
  const modelPutValue  = K * erT * Nnd2 - S * eqT * Nnd1;

  // ─── Model Greeks ───────────────────────────────────────────────────────

  // Delta
  const callDelta = eqT * Nd1;
  const putDelta  = eqT * (Nd1 - 1);

  // Gamma (same for call and put)
  const gamma = (eqT * phiD1) / (S * sigmaSqrtT);

  // Theta (per calendar day; divided by 365 since T uses calendar-year fraction)
  const thetaCommon = -S * eqT * phiD1 * sigma / (2 * sqrtT);
  const callTheta = (thetaCommon - r * K * erT * Nd2  + q * S * eqT * Nd1)  / 365;
  const putTheta  = (thetaCommon + r * K * erT * Nnd2 - q * S * eqT * Nnd1) / 365;

  // Vega: per 1% change in volatility (divide by 100)
  const vega = S * eqT * phiD1 * sqrtT / 100;

  // Rho: per 1% change in risk-free rate (divide by 100)
  const callRho = K * T * erT * Nd2  / 100;
  const putRho  = -K * T * erT * Nnd2 / 100;

  const callGreeks: TheoreticalGreeks = {
    optionType:  "CALL",
    modelDelta:  callDelta,
    modelGamma:  gamma,
    modelTheta:  callTheta,
    modelVega:   vega,
    modelRho:    callRho,
    greekSource: GREEK_SOURCE_VCP,
  };

  const putGreeks: TheoreticalGreeks = {
    optionType:  "PUT",
    modelDelta:  putDelta,
    modelGamma:  gamma,
    modelTheta:  putTheta,
    modelVega:   vega,
    modelRho:    putRho,
    greekSource: GREEK_SOURCE_VCP,
  };

  return {
    model: BSM_MODEL_NAME,
    d1,
    d2,
    modelCallValue: Math.max(0, modelCallValue),
    modelPutValue:  Math.max(0, modelPutValue),
    callGreeks,
    putGreeks,
    quality,
    qualityNote: qualityNote(quality),
  };
}

// ===========================================================================
// DTE → T conversion (canonical, documented)
// ===========================================================================

/**
 * Convert DTE (calendar days) to BSM time-to-expiration T.
 *
 * T = DTE / 365 (calendar-time fraction).
 *
 * NOT DTE / 252.
 * 252 is used for annualizing trading-day realized volatility only.
 * BSM uses calendar time for T.
 */
export function dteToTimeYears(dte: number): number {
  return Math.max(0, dte) / 365;
}
