/**
 * shared/theoretical-options-types.ts
 *
 * Sprint 2.8.7C — Canonical Theoretical Options Research Types
 *
 * ARCHITECTURE: Audit C / Amendment C1 — UNDERLYING_ONLY_THEORETICAL_MODE
 *
 * PERMANENT INVARIANT (C1):
 *   TheoreticalOptionValue can NEVER satisfy:
 *   - Execution Preflight quote validation
 *   - Order Preparation execution quote
 *   - Order Preview executable price validation
 *   - Final Revalidation
 *   - Broker Submission
 *
 * Structural incompatibility is enforced via the `_brand` readonly field.
 * These types must remain structurally incompatible with NormalizedOptionContract,
 * ExecutionQuote, BrokerQuote, and OrderPreparationQuote — by design.
 *
 * FORBIDDEN FIELD NAMES (must never appear on theoretical values):
 *   price, quote, bid, ask, last, mark, midpoint, executionPrice
 *
 * REQUIRED FIELD NAMES for modeled values:
 *   theoreticalValue, modelCallValue, modelPutValue
 *   modelDelta, modelGamma, modelTheta, modelVega, modelRho
 */

// ===========================================================================
// Mode identifier
// ===========================================================================

/** The canonical mode name for underlying-data-only theoretical research. */
export const UNDERLYING_ONLY_THEORETICAL_MODE = "UNDERLYING_ONLY_THEORETICAL_MODE" as const;

/** Pricing model identifier. */
export const BSM_MODEL_NAME = "BLACK_SCHOLES_CONTINUOUS_DIVIDEND" as const;

/** Greek source identifier — all modeled Greeks from realized vol, not observed IV. */
export const GREEK_SOURCE_VCP = "VCP_REALIZED_VOL_MODEL" as const;

// ===========================================================================
// Quality states (§8)
// ===========================================================================

export type TheoreticalQuality =
  | "NORMAL"
  | "LOW_CONFIDENCE"
  | "SHORT_DTE_WARNING"
  | "DEEP_ITM_OTM_WARNING"
  | "INSUFFICIENT_HISTORY"
  | "UNAVAILABLE";

export const THEORETICAL_QUALITY_LABELS: Record<TheoreticalQuality, string> = {
  NORMAL:                "Normal",
  LOW_CONFIDENCE:        "Low Confidence",
  SHORT_DTE_WARNING:     "Short DTE — elevated model uncertainty",
  DEEP_ITM_OTM_WARNING:  "Deep ITM/OTM — reduced model reliability",
  INSUFFICIENT_HISTORY:  "Insufficient Price History",
  UNAVAILABLE:           "Unavailable",
};

/** DTE threshold below which SHORT_DTE_WARNING is applied. */
export const SHORT_DTE_WARNING_THRESHOLD = 7;

/**
 * Deep ITM/OTM threshold.
 * |ln(S/K)| > 0.5 ≈ underlying more than ~65% OTM/ITM from the strike.
 * Per Amendment C1 approved threshold.
 */
export const DEEP_MONEYNESS_THRESHOLD = 0.5;

// ===========================================================================
// Expiration mode (§9)
// ===========================================================================

export type ExpirationMode =
  | "ACTUAL_LISTED_EXPIRATION"
  | "HYPOTHETICAL_EXPIRATION";

/**
 * Hypothetical DTE scenarios used in theoretical-only mode.
 * These are NEVER actual listed expiration dates.
 */
export const HYPOTHETICAL_DTE_SCENARIOS: ReadonlyArray<number> = [7, 14, 30, 45, 60, 90];

// ===========================================================================
// Dividend yield source
// ===========================================================================

export type DividendYieldSource = "OBSERVED" | "DERIVED" | "DEFAULT_ZERO";

// ===========================================================================
// Risk-free rate source
// ===========================================================================

export type RiskFreeRateSource = "APPROX_RATE" | "LIVE_TREASURY" | "CONFIGURED";

// ===========================================================================
// Historical / Realized Volatility (§2)
// ===========================================================================

export interface HistoricalVolatilityEntry {
  /** Lookback window in trading days. */
  lookback: 10 | 20 | 30 | 60 | 90;
  /** Annualized HV (e.g. 0.35 = 35%). Null if insufficient history. */
  annualizedVol: number | null;
  /** Actual number of log-return observations used. */
  observationCount: number | null;
  /** Always 252 — trading days per year used for annualization. */
  annualizationFactor: 252;
  /** ISO-8601 date of the most recent bar included in the calculation. */
  asOf: string | null;
  /** Data source label. */
  underlyingDataSource: string;
}

export interface HistoricalVolatilitySet {
  symbol: string;
  hv10: HistoricalVolatilityEntry;
  hv20: HistoricalVolatilityEntry;
  hv30: HistoricalVolatilityEntry;
  hv60: HistoricalVolatilityEntry;
  hv90: HistoricalVolatilityEntry;
  /** HV30 is the default volatility input for theoretical pricing. */
  defaultVol: number | null;
  defaultLookback: 30;
  computedAt: string;
}

// ===========================================================================
// Theoretical Greeks (§7)
// ===========================================================================

/**
 * Model Greeks from BSM with realized volatility.
 *
 * INVARIANT: These are NEVER live/market-observed Greeks.
 * greekSource must always be "VCP_REALIZED_VOL_MODEL".
 *
 * Field naming:
 *   modelDelta, modelGamma, modelTheta, modelVega, modelRho
 * (never delta, gamma, theta, vega, rho without the "model" prefix in this type)
 */
export interface TheoreticalGreeks {
  /** Option type this Greek set applies to. */
  optionType: "CALL" | "PUT";
  /** Delta: rate of change of option value per $1 move in underlying. */
  modelDelta: number | null;
  /** Gamma: rate of change of delta per $1 move (same for call/put). */
  modelGamma: number | null;
  /** Theta: per-calendar-day time decay (negative for long options). */
  modelTheta: number | null;
  /** Vega: per 1% change in volatility (positive for long options). */
  modelVega: number | null;
  /** Rho: per 1% change in risk-free rate. */
  modelRho: number | null;
  /** Source label — always "VCP_REALIZED_VOL_MODEL". */
  greekSource: "VCP_REALIZED_VOL_MODEL";
}

// ===========================================================================
// Core theoretical option value (§6)
// ===========================================================================

/**
 * A single BSM theoretical option value with provenance.
 *
 * STRUCTURAL INCOMPATIBILITY INVARIANT (C1):
 *   The `_brand` field makes this type structurally incompatible with
 *   NormalizedOptionContract, ExecutionQuote, BrokerQuote, and
 *   OrderPreparationQuote — none of which have `_brand: "THEORETICAL_ONLY"`.
 *
 * FORBIDDEN: bid, ask, last, mark, midpoint, price, executionPrice, quote.
 * REQUIRED: theoreticalValue, modelCallValue, modelPutValue.
 */
export interface TheoreticalOptionValue {
  /** Structural brand — permanently incompatible with execution-grade types. */
  readonly _brand: "THEORETICAL_ONLY";

  /** The canonical mode. Always UNDERLYING_ONLY_THEORETICAL_MODE. */
  mode: typeof UNDERLYING_ONLY_THEORETICAL_MODE;

  /** Pricing model. Always BLACK_SCHOLES_CONTINUOUS_DIVIDEND. */
  model: typeof BSM_MODEL_NAME;

  /** Underlying price used as S in the BSM formula. */
  underlyingPrice: number;

  /** Strike price used as K in the BSM formula. */
  strike: number;

  /** DTE (days to expiration) used to derive T. */
  dte: number;

  /**
   * T = DTE / 365 — calendar-time fraction used in BSM.
   * NOT DTE/252: 252 is used only for annualizing trading-day realized vol,
   * not for contract time-to-expiration.
   */
  timeToExpirationYears: number;

  /** Risk-free rate used (e.g. 0.045 = 4.5%). */
  riskFreeRate: number;

  /** Risk-free rate source label. */
  riskFreeRateSource: RiskFreeRateSource;

  /** Continuous dividend yield used (0 = DEFAULT_ZERO fallback). */
  dividendYield: number;

  /** Dividend yield source. */
  dividendYieldSource: DividendYieldSource;

  /** Annualized volatility input (e.g. 0.35 = 35%). */
  volatilityInput: number;

  /** Source label of the volatility input (e.g. "HV30"). */
  volatilitySource: string;

  /** Lookback period in trading days used for the default volatility. */
  sigmaLookback: number;

  /** ISO-8601 date of the most recent bar used in the HV calculation. */
  sigmaAsOf: string | null;

  /** Data source for the underlying price bars. */
  underlyingDataSource: string;

  /** Moneyness classification. */
  moneyness: "ATM" | "ITM" | "OTM";

  /** Quality state. */
  quality: TheoreticalQuality;

  /**
   * Theoretical call value.
   * Null when quality = UNAVAILABLE or required inputs are missing.
   * Named modelCallValue — never "price", "bid", "ask", "mark", etc.
   */
  modelCallValue: number | null;

  /**
   * Theoretical put value.
   * Named modelPutValue — never "price", "bid", "ask", "mark", etc.
   */
  modelPutValue: number | null;

  /** Theoretical call Greeks. Null when quality = UNAVAILABLE. */
  callGreeks: TheoreticalGreeks | null;

  /** Theoretical put Greeks. Null when quality = UNAVAILABLE. */
  putGreeks: TheoreticalGreeks | null;
}

// ===========================================================================
// Theoretical strike row and grid (§10)
// ===========================================================================

/**
 * A single row in the THEORETICAL STRIKE GRID.
 *
 * DISTINCTION: This is NOT an option chain.
 *   - No OCC contract symbols.
 *   - No bid, ask, volume, open interest, or implied volatility.
 *   - Expiration dates are hypothetical ("N DTE (hypothetical)").
 */
export interface TheoreticalStrikeRow {
  /** Strike price. */
  strike: number;

  /** Moneyness label. */
  moneyness: "ATM" | "ITM" | "OTM";

  /** Distance from ATM in dollars. */
  distanceFromAtm: number;

  /** Distance from ATM as a percentage of underlying price. */
  distancePct: number;

  /** Call theoretical value. Null when quality = UNAVAILABLE. */
  modelCallValue: number | null;

  /** Put theoretical value. Null when quality = UNAVAILABLE. */
  modelPutValue: number | null;

  /** Call model delta. */
  modelCallDelta: number | null;

  /** Put model delta. */
  modelPutDelta: number | null;

  /** Model gamma (same for call and put at same strike). */
  modelGamma: number | null;

  /** Model theta (call). Negative for long option. */
  modelCallTheta: number | null;

  /** Model theta (put). Negative for long option. */
  modelPutTheta: number | null;

  /** Model vega (same for call and put at same strike). */
  modelVega: number | null;

  /** Quality state for this row. */
  quality: TheoreticalQuality;
}

/**
 * A complete theoretical strike grid for a single DTE scenario.
 *
 * Labeled as "N DTE (hypothetical)" — NEVER as an actual exchange-listed date.
 */
export interface TheoreticalStrikeGrid {
  /** Underlying symbol. */
  symbol: string;

  /** Underlying price at time of calculation. */
  underlyingPrice: number;

  /** DTE scenario. One of HYPOTHETICAL_DTE_SCENARIOS. */
  dte: number;

  /**
   * Human-readable DTE label.
   * Always includes "(hypothetical)" to distinguish from listed expirations.
   */
  dteLabel: string;

  /** Expiration mode — always HYPOTHETICAL_EXPIRATION in this sprint. */
  expirationMode: ExpirationMode;

  /** Strike increment used (derived from underlying price). */
  strikeIncrement: number;

  /** All strike rows, sorted ascending by strike. */
  rows: TheoreticalStrikeRow[];

  /** Provenance: volatility input. */
  volatilityInput: number;

  /** Provenance: volatility source. */
  volatilitySource: string;

  /** Provenance: as-of date of the HV calculation. */
  sigmaAsOf: string | null;

  /** ISO-8601 timestamp of when this grid was computed. */
  computedAt: string;
}

// ===========================================================================
// Full options research value (§16) — Audit C/C1 architecture
// ===========================================================================

/**
 * Full options research result preserving the Audit C/C1 architecture.
 *
 * theoretical — available in UNDERLYING_ONLY_THEORETICAL_MODE (this sprint).
 * market      — null this sprint; populated when independent chain data arrives.
 * derivedComparison — null this sprint; populated when both sides are available.
 *
 * Neither field overwrites the other. Both must coexist.
 */
export interface OptionsResearchValue {
  /**
   * Theoretical model outputs (available without broker or options chain).
   * Null when underlying data is unavailable or quality = UNAVAILABLE.
   */
  theoretical: TheoreticalOptionsResearch | null;

  /**
   * Market-observed option data (future — independent chain feed).
   * Null this sprint.
   */
  market: null;

  /**
   * Derived comparison between model and market (future).
   * Null this sprint.
   */
  derivedComparison: null;
}

// ===========================================================================
// Theoretical options research result
// ===========================================================================

export interface TheoreticalOptionsResearch {
  symbol: string;

  /** Mode identifier. */
  mode: typeof UNDERLYING_ONLY_THEORETICAL_MODE;

  /** Historical / realized volatility set. */
  volatilitySet: HistoricalVolatilitySet;

  /** Underlying data source description. */
  underlyingDataSource: string;

  /** Underlying price used for all calculations. */
  underlyingPrice: number;

  /**
   * Strike grids — one per hypothetical DTE scenario.
   * Only populated for DTE scenarios in HYPOTHETICAL_DTE_SCENARIOS.
   */
  strikeGrids: TheoreticalStrikeGrid[];

  /**
   * ATM values for each DTE scenario — quick reference without traversing grids.
   * Useful for strategy-level enrichment.
   */
  atmSummary: AtmSummaryRow[];

  /** Risk-free rate used. */
  riskFreeRate: number;

  /** Risk-free rate source label. */
  riskFreeRateSource: RiskFreeRateSource;

  /** Continuous dividend yield used. */
  dividendYield: number;

  /** Dividend yield source. */
  dividendYieldSource: DividendYieldSource;

  /** Overall quality assessment. */
  quality: TheoreticalQuality;

  /** Quality notes and warnings. */
  qualityNotes: string[];

  /** ISO-8601 timestamp of computation. */
  computedAt: string;

  /**
   * Required UI disclosure.
   * Must appear whenever theoretical values are shown to a user.
   */
  disclosure: string;

  /**
   * Methodology details — for expandable UI section.
   */
  methodology: TheoreticalMethodology;
}

/** ATM summary row for a single DTE scenario. */
export interface AtmSummaryRow {
  dte: number;
  dteLabel: string;
  modelCallValue: number | null;
  modelPutValue: number | null;
  modelCallDelta: number | null;
  modelPutDelta: number | null;
  modelGamma: number | null;
  modelTheta: number | null;
  modelVega: number | null;
  quality: TheoreticalQuality;
}

/** Methodology details for the expandable UI panel. */
export interface TheoreticalMethodology {
  pricingModel: string;
  volatilityInput: string;
  volatilityLookback: string;
  sigmaAsOf: string | null;
  underlyingSource: string;
  riskFreeRateSource: string;
  riskFreeRateValue: string;
  dividendYieldSource: string;
  dividendYieldValue: string;
  timeConvention: string;
}

// ===========================================================================
// Required disclosures
// ===========================================================================

export const THEORETICAL_OPTIONS_DISCLOSURE =
  "Theoretical values — not live option quotes. " +
  "Values are model estimates based on historical volatility and are provided for research purposes only. " +
  "They do not represent actual market prices, bid/ask quotes, or executable premiums. " +
  "Theoretical values may differ materially from actual market prices due to supply/demand, " +
  "liquidity, implied volatility, and other factors. " +
  "This is not a recommendation to buy or sell any option.";

export const THEORETICAL_OPTIONS_SHORT_DISCLOSURE =
  "Theoretical values — not live option quotes.";
