/**
 * server/services/theoretical-options/theoretical-options-research-service.ts
 *
 * Sprint 2.8.7C — Theoretical Options Research Service (Orchestration).
 *
 * PURPOSE:
 *   Smallest canonical orchestration layer for broker-independent theoretical
 *   options research. Combines:
 *     1. Underlying price (from planning-market-data / 2.8.7B)
 *     2. Historical bars → realized volatility (HV10/20/30/60/90)
 *     3. BSM pricing engine (theoretical call/put values)
 *     4. Model Greeks
 *     5. Theoretical strike grid (all hypothetical DTE scenarios, local computation)
 *     6. ATM summary per DTE scenario
 *
 * REUSE MAP:
 *   getPlanningQuoteData()        → REUSED (planning-quote.ts, Sprint 2.8.7B)
 *   getHistoricalBars()           → REUSED (market-history-service.ts)
 *   historicalVolatility()        → REUSED (indicators.ts, via realized-volatility.ts)
 *   TwelveDataDailyProvider       → UNCHANGED (no new direct client)
 *   computeBSM() / computeGreeks  → NEW (black-scholes.ts)
 *   buildAllStrikeGrids()         → NEW (strike-grid.ts)
 *   getRiskFreeRate()             → NEW (risk-free-rate.ts)
 *   Options Strategy Matching     → EXTENDED (caller enriches from atmSummary)
 *   Trade Risk & Scenario         → EXTENDED (caller passes modeledPremium metadata)
 *   Contract Research             → BOUNDARY (separate — this is NOT Contract Research)
 *   Execution pipeline            → UNCHANGED (theoretical values structurally excluded)
 *
 * INVARIANT (C1):
 *   TheoreticalOptionsResearch output can NEVER satisfy execution-grade
 *   quote validation, order preparation, or broker submission.
 *   The _brand: "THEORETICAL_ONLY" field enforces structural incompatibility.
 *
 * PERFORMANCE:
 *   - Underlying price fetched once
 *   - Historical bars fetched once
 *   - All strike/DTE grid computations are local (no per-strike API calls)
 */

import { getHistoricalBars } from "../market-history-service";
import { getPlanningQuoteData } from "../daily-market-data/planning-quote";
import { computeHistoricalVolatilitySet, resolveBestVol } from "./realized-volatility";
import { computeBSM, dteToTimeYears, classifyMoneyness } from "./black-scholes";
import { buildAllStrikeGrids, hypotheticalDteLabel } from "./strike-grid";
import { getRiskFreeRate } from "./risk-free-rate";
import type {
  TheoreticalOptionsResearch,
  AtmSummaryRow,
  TheoreticalQuality,
  TheoreticalMethodology,
  HistoricalVolatilitySet,
} from "@shared/theoretical-options-types";
import {
  UNDERLYING_ONLY_THEORETICAL_MODE,
  HYPOTHETICAL_DTE_SCENARIOS,
  THEORETICAL_OPTIONS_DISCLOSURE,
  SHORT_DTE_WARNING_THRESHOLD,
} from "@shared/theoretical-options-types";

// ===========================================================================
// Health metrics (in-memory, resets on restart)
// ===========================================================================

interface TheoreticalOptionsHealth {
  requestCount:   number;
  successCount:   number;
  unavailableCount: number;
  errorCount:     number;
  lastSuccessAt:  string | null;
}

const _health: TheoreticalOptionsHealth = {
  requestCount:    0,
  successCount:    0,
  unavailableCount: 0,
  errorCount:      0,
  lastSuccessAt:   null,
};

export function getTheoreticalOptionsHealth() {
  return { ...structuredClone(_health) };
}

// ===========================================================================
// Underlying data source label
// ===========================================================================

const UNDERLYING_DATA_SOURCE = "Twelve Data / stored daily bars (planning-market-data)";

// ===========================================================================
// ATM summary row
// ===========================================================================

function buildAtmSummaryRow(
  dte: number,
  underlyingPrice: number,
  riskFreeRate: number,
  dividendYield: number,
  sigma: number,
): AtmSummaryRow {
  const T = dteToTimeYears(dte);
  // ATM = use underlying price as strike for true ATM calculation
  const bsm = computeBSM(
    { S: underlyingPrice, K: underlyingPrice, T, r: riskFreeRate, q: dividendYield, sigma },
    dte,
  );
  return {
    dte,
    dteLabel: hypotheticalDteLabel(dte),
    modelCallValue: bsm.modelCallValue,
    modelPutValue:  bsm.modelPutValue,
    modelCallDelta: bsm.callGreeks?.modelDelta ?? null,
    modelPutDelta:  bsm.putGreeks?.modelDelta ?? null,
    modelGamma:     bsm.callGreeks?.modelGamma ?? null,
    modelTheta:     bsm.callGreeks?.modelTheta ?? null,
    modelVega:      bsm.callGreeks?.modelVega ?? null,
    quality:        bsm.quality,
  };
}

// ===========================================================================
// Quality notes
// ===========================================================================

function buildQualityNotes(
  hvSet: HistoricalVolatilitySet,
  overallQuality: TheoreticalQuality,
): string[] {
  const notes: string[] = [];

  if (hvSet.defaultVol === null) {
    notes.push("HV30 is unavailable — insufficient price history for the default 30-day lookback.");
  }
  if (hvSet.hv30.annualizedVol === null && hvSet.hv20.annualizedVol !== null) {
    notes.push("Using HV20 as fallback volatility input (HV30 unavailable).");
  }
  if (overallQuality === "INSUFFICIENT_HISTORY") {
    notes.push("Insufficient price history to compute any volatility lookback. Theoretical values are unavailable.");
  }
  if (overallQuality === "UNAVAILABLE") {
    notes.push("Underlying data is unavailable. All theoretical values are null.");
  }

  // Warn on very short DTE scenarios
  const shortDteScenarios = HYPOTHETICAL_DTE_SCENARIOS.filter(
    (d) => d < SHORT_DTE_WARNING_THRESHOLD,
  );
  if (shortDteScenarios.length > 0) {
    notes.push(
      `DTE scenarios under ${SHORT_DTE_WARNING_THRESHOLD} days carry elevated model uncertainty — BSM assumptions weaken near expiration.`,
    );
  }

  return notes;
}

// ===========================================================================
// Methodology record
// ===========================================================================

function buildMethodology(
  sigma: number | null,
  sigmaSource: string,
  sigmaAsOf: string | null,
  rfResult: ReturnType<typeof getRiskFreeRate>,
  dividendYield: number,
  dividendYieldSource: string,
): TheoreticalMethodology {
  return {
    pricingModel:         "Black-Scholes-Merton with continuous dividend yield",
    volatilityInput:      sigma !== null ? `${(sigma * 100).toFixed(1)}% annualized (${sigmaSource})` : `${sigmaSource} (unavailable)`,
    volatilityLookback:   `${sigmaSource} — ${sigmaSource.replace("HV", "")} trading-day lookback, annualized via √252`,
    sigmaAsOf,
    underlyingSource:     UNDERLYING_DATA_SOURCE,
    riskFreeRateSource:   rfResult.source,
    riskFreeRateValue:    rfResult.label,
    dividendYieldSource,
    dividendYieldValue:   `${(dividendYield * 100).toFixed(2)}%`,
    timeConvention:       "T = DTE / 365 (calendar-time fraction). 252 is used only for vol annualization, not for BSM T.",
  };
}

// ===========================================================================
// Main research builder
// ===========================================================================

export interface TheoreticalOptionsRequest {
  /** Authenticated user ID (for Twelve Data access-control gate). */
  userId: string;
  /** Uppercase equity symbol (e.g. "NVDA"). */
  symbol: string;
  /**
   * Hypothetical DTE scenarios to compute.
   * Defaults to HYPOTHETICAL_DTE_SCENARIOS = [7, 14, 30, 45, 60, 90].
   */
  dteScenarios?: ReadonlyArray<number>;
  /**
   * Number of strikes above and below ATM in each grid.
   * Defaults to 5 (11 strikes total per DTE).
   */
  strikesEachSide?: number;
}

/**
 * Build a full theoretical options research result.
 *
 * This is the sole public entry point for 2.8.7C theoretical research.
 * It is NOT a Contract Research replacement — Contract Research requires
 * live broker options chain data.
 */
export async function buildTheoreticalOptionsResearch(
  req: TheoreticalOptionsRequest,
): Promise<TheoreticalOptionsResearch> {
  _health.requestCount++;
  const t0 = Date.now();

  const dteScenarios = req.dteScenarios ?? HYPOTHETICAL_DTE_SCENARIOS;
  const strikesEachSide = req.strikesEachSide ?? 5;
  const computedAt = new Date().toISOString();

  try {
    // ── 1. Risk-free rate (isolated, labeled) ─────────────────────────────
    const rfResult = getRiskFreeRate();

    // ── 2. Dividend yield (DEFAULT_ZERO — no live yield source) ──────────
    const dividendYield: number = 0;
    const dividendYieldSource = "DEFAULT_ZERO" as const;

    // ── 3. Underlying price (reuse 2.8.7B planning-quote adapter) ─────────
    const planningQuote = await getPlanningQuoteData(req.userId, req.symbol);
    const underlyingPrice: number | null = planningQuote?.price ?? null;

    if (underlyingPrice === null || underlyingPrice <= 0) {
      _health.unavailableCount++;
      const hvUnavailable = buildUnavailableHVSet(req.symbol);
      return buildUnavailableResult(
        req.symbol,
        hvUnavailable,
        rfResult,
        dividendYield,
        dividendYieldSource,
        computedAt,
        "Underlying price is unavailable — theoretical research cannot proceed without a reference price.",
      );
    }

    // ── 4. Historical bars → realized volatility ──────────────────────────
    // Need at least 91 bars for HV90 (90 log-return observations = 91 bars).
    // Use allowExternalRefresh=true for on-demand research (not batch scan).
    const barsResult = await getHistoricalBars({
      symbol: req.symbol,
      outputSize: 120, // 120 bars gives comfortable margin for all HV lookbacks
      allowExternalRefresh: true,
      purpose: "user",
      caller: "theoretical_options_research",
    });
    const bars = barsResult.bars;

    const hvSet = computeHistoricalVolatilitySet(bars, req.symbol, UNDERLYING_DATA_SOURCE);
    const { vol: sigma, source: sigmaSource, lookback: sigmaLookback } = resolveBestVol(hvSet);

    if (sigma === null) {
      _health.unavailableCount++;
      return buildUnavailableResult(
        req.symbol,
        hvSet,
        rfResult,
        dividendYield,
        dividendYieldSource,
        computedAt,
        "No volatility lookback has sufficient history. Theoretical values require at least 11 daily bars.",
      );
    }

    const sigmaAsOf = hvSet.hv30.asOf ?? hvSet.hv20.asOf ?? hvSet.hv10.asOf ?? null;

    // ── 5. Strike grids (all DTE scenarios, pure local computation) ────────
    const strikeGrids = buildAllStrikeGrids(
      {
        symbol: req.symbol,
        underlyingPrice,
        riskFreeRate: rfResult.rate,
        dividendYield,
        sigma,
        volatilitySource: sigmaSource,
        sigmaAsOf,
        strikesEachSide,
      },
      dteScenarios,
    );

    // ── 6. ATM summary (one row per DTE, true ATM strike = underlying price) ─
    const atmSummary: AtmSummaryRow[] = dteScenarios.map((dte) =>
      buildAtmSummaryRow(dte, underlyingPrice, rfResult.rate, dividendYield, sigma),
    );

    // ── 7. Overall quality ─────────────────────────────────────────────────
    const overallQuality: TheoreticalQuality =
      hvSet.hv30.annualizedVol !== null ? "NORMAL" : "LOW_CONFIDENCE";

    const qualityNotes = buildQualityNotes(hvSet, overallQuality);
    const methodology = buildMethodology(
      sigma,
      sigmaSource,
      sigmaAsOf,
      rfResult,
      dividendYield,
      dividendYieldSource,
    );

    _health.successCount++;
    _health.lastSuccessAt = new Date().toISOString();

    return {
      symbol: req.symbol,
      mode: UNDERLYING_ONLY_THEORETICAL_MODE,
      volatilitySet: hvSet,
      underlyingDataSource: UNDERLYING_DATA_SOURCE,
      underlyingPrice,
      strikeGrids,
      atmSummary,
      riskFreeRate: rfResult.rate,
      riskFreeRateSource: rfResult.source,
      dividendYield,
      dividendYieldSource,
      quality: overallQuality,
      qualityNotes,
      computedAt,
      disclosure: THEORETICAL_OPTIONS_DISCLOSURE,
      methodology,
    };
  } catch (err) {
    _health.errorCount++;
    const hvUnavailable = buildUnavailableHVSet(req.symbol);
    return buildUnavailableResult(
      req.symbol,
      hvUnavailable,
      getRiskFreeRate(),
      0,
      "DEFAULT_ZERO",
      computedAt,
      "An internal error occurred computing theoretical options research.",
    );
  }
}

// ===========================================================================
// Unavailable result helpers
// ===========================================================================

function buildUnavailableHVEntry(lookback: 10 | 20 | 30 | 60 | 90): import("@shared/theoretical-options-types").HistoricalVolatilityEntry {
  return {
    lookback,
    annualizedVol: null,
    observationCount: null,
    annualizationFactor: 252,
    asOf: null,
    underlyingDataSource: UNDERLYING_DATA_SOURCE,
  };
}

function buildUnavailableHVSet(symbol: string): HistoricalVolatilitySet {
  return {
    symbol,
    hv10: buildUnavailableHVEntry(10),
    hv20: buildUnavailableHVEntry(20),
    hv30: buildUnavailableHVEntry(30),
    hv60: buildUnavailableHVEntry(60),
    hv90: buildUnavailableHVEntry(90),
    defaultVol: null,
    defaultLookback: 30,
    computedAt: new Date().toISOString(),
  };
}

function buildUnavailableResult(
  symbol: string,
  hvSet: HistoricalVolatilitySet,
  rfResult: ReturnType<typeof getRiskFreeRate>,
  dividendYield: number,
  dividendYieldSource: "DEFAULT_ZERO",
  computedAt: string,
  reason: string,
): TheoreticalOptionsResearch {
  return {
    symbol,
    mode: UNDERLYING_ONLY_THEORETICAL_MODE,
    volatilitySet: hvSet,
    underlyingDataSource: UNDERLYING_DATA_SOURCE,
    underlyingPrice: 0,
    strikeGrids: [],
    atmSummary: [],
    riskFreeRate: rfResult.rate,
    riskFreeRateSource: rfResult.source,
    dividendYield,
    dividendYieldSource,
    quality: "UNAVAILABLE",
    qualityNotes: [reason],
    computedAt,
    disclosure: THEORETICAL_OPTIONS_DISCLOSURE,
    methodology: buildMethodology(null, "UNAVAILABLE", null, rfResult, dividendYield, dividendYieldSource),
  };
}
