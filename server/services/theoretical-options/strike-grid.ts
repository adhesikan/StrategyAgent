/**
 * server/services/theoretical-options/strike-grid.ts
 *
 * Sprint 2.8.7C — Theoretical Strike Grid Generator.
 *
 * DISTINCTION: This is NOT an option chain.
 *   - No OCC contract symbols (no "AAPL251219C00200000" style identifiers)
 *   - No bid, ask, volume, open interest, or implied volatility
 *   - Expiration mode = HYPOTHETICAL_EXPIRATION
 *   - DTE labels always include "(hypothetical)" — never an actual listed date
 *   - Call/put values are named modelCallValue / modelPutValue (never price/bid/ask)
 *
 * PERFORMANCE:
 *   Underlying price and historical bars are fetched ONCE.
 *   The entire strike/DTE grid is computed locally from that data.
 *   No per-strike external API calls.
 *
 * STRIKE INCREMENT POLICY:
 *   < $10:    $0.50
 *   $10-$30:  $1.00
 *   $30-$100: $2.50
 *   $100-$300: $5.00
 *   > $300:   $10.00
 *
 * STRIKE COUNT: ATM ± 5 strikes = 11 rows per DTE grid.
 */

import { computeBSM, dteToTimeYears, classifyMoneyness } from "./black-scholes";
import type {
  TheoreticalStrikeRow,
  TheoreticalStrikeGrid,
  TheoreticalQuality,
} from "@shared/theoretical-options-types";
import { GREEK_SOURCE_VCP } from "@shared/theoretical-options-types";

// ===========================================================================
// Strike increment policy
// ===========================================================================

/**
 * Derive the appropriate strike increment based on the underlying price.
 */
export function deriveStrikeIncrement(underlyingPrice: number): number {
  if (underlyingPrice < 10)  return 0.5;
  if (underlyingPrice < 30)  return 1.0;
  if (underlyingPrice < 100) return 2.5;
  if (underlyingPrice < 300) return 5.0;
  return 10.0;
}

/**
 * Round a strike to the nearest valid increment.
 */
function roundToIncrement(price: number, increment: number): number {
  return Math.round(price / increment) * increment;
}

// ===========================================================================
// DTE label
// ===========================================================================

/**
 * Human-readable label for a hypothetical DTE.
 * Always includes "(hypothetical)" to distinguish from actual listed expirations.
 */
export function hypotheticalDteLabel(dte: number): string {
  return `${dte} DTE (hypothetical)`;
}

// ===========================================================================
// Single strike row
// ===========================================================================

function buildStrikeRow(
  strike: number,
  underlyingPrice: number,
  dte: number,
  riskFreeRate: number,
  dividendYield: number,
  sigma: number,
): TheoreticalStrikeRow {
  const T = dteToTimeYears(dte);
  const moneyness = classifyMoneyness(underlyingPrice, strike);
  const distanceFromAtm = strike - underlyingPrice;
  const distancePct = underlyingPrice > 0 ? (distanceFromAtm / underlyingPrice) * 100 : 0;

  const bsm = computeBSM(
    { S: underlyingPrice, K: strike, T, r: riskFreeRate, q: dividendYield, sigma },
    dte,
  );

  return {
    strike,
    moneyness,
    distanceFromAtm,
    distancePct,
    modelCallValue: bsm.modelCallValue,
    modelPutValue:  bsm.modelPutValue,
    modelCallDelta: bsm.callGreeks?.modelDelta ?? null,
    modelPutDelta:  bsm.putGreeks?.modelDelta ?? null,
    modelGamma:     bsm.callGreeks?.modelGamma ?? null,
    modelCallTheta: bsm.callGreeks?.modelTheta ?? null,
    modelPutTheta:  bsm.putGreeks?.modelTheta ?? null,
    modelVega:      bsm.callGreeks?.modelVega ?? null,
    quality:        bsm.quality,
  };
}

// ===========================================================================
// Grid builder
// ===========================================================================

export interface BuildStrikeGridOptions {
  symbol: string;
  underlyingPrice: number;
  dte: number;
  riskFreeRate: number;
  dividendYield: number;
  /** Annualized volatility (e.g. 0.35 = 35%). */
  sigma: number;
  /** Volatility source label (e.g. "HV30"). */
  volatilitySource: string;
  /** ISO-8601 as-of date of the HV calculation. */
  sigmaAsOf: string | null;
  /** Number of strikes above and below ATM. Default: 5. */
  strikesEachSide?: number;
}

/**
 * Build one TheoreticalStrikeGrid for a single DTE scenario.
 *
 * Computes all strikes locally from the single underlying price.
 * No external API calls per strike.
 */
export function buildStrikeGrid(opts: BuildStrikeGridOptions): TheoreticalStrikeGrid {
  const {
    symbol,
    underlyingPrice,
    dte,
    riskFreeRate,
    dividendYield,
    sigma,
    volatilitySource,
    sigmaAsOf,
    strikesEachSide = 5,
  } = opts;

  const increment = deriveStrikeIncrement(underlyingPrice);
  const atmStrike = roundToIncrement(underlyingPrice, increment);

  // Generate strike ladder: ATM ± strikesEachSide
  const strikes: number[] = [];
  for (let i = -strikesEachSide; i <= strikesEachSide; i++) {
    const s = Math.round((atmStrike + i * increment) * 10000) / 10000; // floating-point safety
    if (s > 0) strikes.push(s);
  }
  // Sort ascending
  strikes.sort((a, b) => a - b);

  const rows: TheoreticalStrikeRow[] = strikes.map((strike) =>
    buildStrikeRow(strike, underlyingPrice, dte, riskFreeRate, dividendYield, sigma),
  );

  return {
    symbol,
    underlyingPrice,
    dte,
    dteLabel: hypotheticalDteLabel(dte),
    expirationMode: "HYPOTHETICAL_EXPIRATION",
    strikeIncrement: increment,
    rows,
    volatilityInput: sigma,
    volatilitySource,
    sigmaAsOf,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Build strike grids for all hypothetical DTE scenarios.
 * Fetches underlying price and sigma ONCE, then computes all grids locally.
 */
export function buildAllStrikeGrids(
  baseOpts: Omit<BuildStrikeGridOptions, "dte">,
  dteScenarios: ReadonlyArray<number>,
): TheoreticalStrikeGrid[] {
  return dteScenarios.map((dte) => buildStrikeGrid({ ...baseOpts, dte }));
}
