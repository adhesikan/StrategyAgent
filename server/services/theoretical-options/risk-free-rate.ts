/**
 * server/services/theoretical-options/risk-free-rate.ts
 *
 * Sprint 2.8.7C — Isolated risk-free rate module.
 *
 * AUDIT STATUS: No live risk-free rate source exists in this codebase.
 * Per Audit C/C1 approval, this sprint uses an approximate rate
 * (APPROX_RATE) isolated behind this interface.
 *
 * REPLACEMENT: When a live Treasury/SOFR feed is added, replace
 * getLiveRiskFreeRate() and update the source label to "LIVE_TREASURY".
 * The rest of the codebase references only getRiskFreeRate() and
 * RiskFreeRateResult — no other file should hardcode this value.
 *
 * DEFAULT VALUE:
 *   0.045 (4.5%) — approximate US short-term risk-free rate as of mid-2026.
 *   Configurable via env var THEORETICAL_OPTIONS_RISK_FREE_RATE.
 *
 * LABEL: "APPROX_RATE" — must never be labeled "live" or "market-observed".
 */

import type { RiskFreeRateSource } from "@shared/theoretical-options-types";

export interface RiskFreeRateResult {
  rate: number;
  source: RiskFreeRateSource;
  /** Human-readable description for methodology panel. */
  label: string;
}

/**
 * The fallback approximation.
 * ~US T-bill rate as of mid-2026.
 * Configurable via THEORETICAL_OPTIONS_RISK_FREE_RATE env var (decimal, e.g. "0.045").
 */
const DEFAULT_APPROX_RATE = 0.045;

/**
 * Get the risk-free rate for theoretical options pricing.
 *
 * Current implementation: APPROX_RATE (configurable via env var).
 * Future: replace with live Treasury/SOFR feed without changing callers.
 */
export function getRiskFreeRate(): RiskFreeRateResult {
  const envVal = process.env.THEORETICAL_OPTIONS_RISK_FREE_RATE;
  if (envVal) {
    const parsed = parseFloat(envVal);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
      return {
        rate: parsed,
        source: "CONFIGURED",
        label: `${(parsed * 100).toFixed(2)}% (configured via THEORETICAL_OPTIONS_RISK_FREE_RATE)`,
      };
    }
  }

  return {
    rate: DEFAULT_APPROX_RATE,
    source: "APPROX_RATE",
    label: `${(DEFAULT_APPROX_RATE * 100).toFixed(1)}% (approximate — US short-term rate, mid-2026)`,
  };
}
