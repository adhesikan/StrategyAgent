/**
 * server/services/theoretical-options/realized-volatility.ts
 *
 * Sprint 2.8.7C — Historical / Realized Volatility Engine.
 *
 * Computes HV10, HV20, HV30, HV60, HV90 from stored daily bars.
 *
 * METHOD:
 *   Log returns: r_t = ln(P_t / P_{t-1})
 *   Annualized HV = stddev(r_t) × sqrt(252)
 *   - 252 is the annualization factor (trading days/year)
 *   - NOT used for BSM time-to-expiration (which uses calendar days / 365)
 *
 * REUSE:
 *   Delegates to historicalVolatility() from indicators.ts — the canonical
 *   log-return-based HV function already in the codebase. No duplication.
 *
 * BEHAVIOR:
 *   - Returns null for a lookback period when insufficient history exists
 *   - Never fabricates a value
 *   - observationCount reflects actual observations used
 *
 * DEFAULT for pricing: HV30 (per Amendment C1).
 */

import { historicalVolatility } from "../daily-market-data/indicators";
import type { NormalizedDailyBar } from "../daily-market-data/types";
import type {
  HistoricalVolatilitySet,
  HistoricalVolatilityEntry,
} from "@shared/theoretical-options-types";

const ANNUALIZATION_FACTOR = 252 as const;

const LOOKBACKS = [10, 20, 30, 60, 90] as const;
type Lookback = (typeof LOOKBACKS)[number];

/**
 * Build one HistoricalVolatilityEntry for the given lookback period.
 *
 * Returns null for annualizedVol when bars.length < lookback + 1.
 * The historicalVolatility() function from indicators.ts requires at least
 * (period + 1) bars to compute one log return per observation.
 */
function buildHVEntry(
  bars: NormalizedDailyBar[],
  lookback: Lookback,
  underlyingDataSource: string,
): HistoricalVolatilityEntry {
  // Need lookback + 1 bars for lookback log-return observations
  const requiredBars = lookback + 1;
  if (bars.length < requiredBars) {
    return {
      lookback,
      annualizedVol: null,
      observationCount: null,
      annualizationFactor: ANNUALIZATION_FACTOR,
      asOf: bars.length > 0 ? (bars[bars.length - 1].tradeDate ?? null) : null,
      underlyingDataSource,
    };
  }

  const closes = bars.map((b) => b.close);
  const vol = historicalVolatility(closes, lookback);

  return {
    lookback,
    annualizedVol: vol,
    observationCount: lookback,
    annualizationFactor: ANNUALIZATION_FACTOR,
    asOf: bars[bars.length - 1].tradeDate ?? null,
    underlyingDataSource,
  };
}

/**
 * Compute all HV lookback periods from an ordered array of daily bars.
 *
 * @param bars              - Ascending-sorted NormalizedDailyBar array (oldest first)
 * @param symbol            - Ticker symbol for labeling
 * @param underlyingDataSource - Provenance label (e.g. "Twelve Data / stored bars")
 */
export function computeHistoricalVolatilitySet(
  bars: NormalizedDailyBar[],
  symbol: string,
  underlyingDataSource: string,
): HistoricalVolatilitySet {
  const hv10 = buildHVEntry(bars, 10, underlyingDataSource);
  const hv20 = buildHVEntry(bars, 20, underlyingDataSource);
  const hv30 = buildHVEntry(bars, 30, underlyingDataSource);
  const hv60 = buildHVEntry(bars, 60, underlyingDataSource);
  const hv90 = buildHVEntry(bars, 90, underlyingDataSource);

  // Default volatility input for BSM: HV30 per Amendment C1
  const defaultVol = hv30.annualizedVol;

  return {
    symbol,
    hv10,
    hv20,
    hv30,
    hv60,
    hv90,
    defaultVol,
    defaultLookback: 30,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Derive the best available volatility input from a HistoricalVolatilitySet.
 * Falls back in order: HV30 → HV20 → HV60 → HV10 → HV90 → null.
 */
export function resolveBestVol(
  hvSet: HistoricalVolatilitySet,
): { vol: number | null; source: string; lookback: Lookback | null } {
  const candidates: Array<{ entry: HistoricalVolatilityEntry; label: string }> = [
    { entry: hvSet.hv30, label: "HV30" },
    { entry: hvSet.hv20, label: "HV20" },
    { entry: hvSet.hv60, label: "HV60" },
    { entry: hvSet.hv10, label: "HV10" },
    { entry: hvSet.hv90, label: "HV90" },
  ];

  for (const { entry, label } of candidates) {
    if (entry.annualizedVol !== null) {
      return { vol: entry.annualizedVol, source: label, lookback: entry.lookback as Lookback };
    }
  }
  return { vol: null, source: "UNAVAILABLE", lookback: null };
}
