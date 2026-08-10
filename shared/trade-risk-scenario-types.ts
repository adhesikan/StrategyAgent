/**
 * Sprint 2.7.4 — Trade Risk & Scenario Analysis
 *
 * Canonical types for TradeRiskScenarioResult and all sub-types.
 *
 * 2.7.3 answers: WHICH contracts deserve research?
 * 2.7.4 answers: WHAT are the economic and risk characteristics under
 *                deterministic hypothetical scenarios?
 *
 * This engine MUST NOT:
 *  - change the selected underlying or strategy family
 *  - substitute a different contract candidate automatically
 *  - rank candidates as personalized recommendations
 *  - construct or submit a broker order
 *  - claim probability of profit
 *  - use "expected return", "chance of winning", or "recommended trade"
 */

import type { OptionsStrategyFamily } from "./options-strategy-types";

// ===========================================================================
// Risk Flag Codes (deterministic — no severity weighting)
// ===========================================================================

export type RiskFlagCode =
  | "MAX_LOSS_EXCEEDS_CONSTRAINT"
  | "EVENT_WINDOW"
  | "STALE_QUOTE"
  | "WIDE_BID_ASK"
  | "LOW_OPEN_INTEREST"
  | "PARTIAL_GREEKS"
  | "PATH_DEPENDENT_PAYOFF"
  | "ASSIGNMENT_RISK"
  | "EARLY_EXERCISE_RISK"
  | "UNLIMITED_GAIN"
  | "SUBSTANTIAL_UNDERLYING_DOWNSIDE";

export interface RiskFlag {
  code: RiskFlagCode;
  note: string;
}

// ===========================================================================
// Gain / Loss value representation
// ===========================================================================

/**
 * How a max-gain or max-loss figure is classified.
 * DEFINED   — exact dollar amount is mathematically derivable.
 * SUBSTANTIAL — large but not infinite (e.g. covered call stock downside).
 * UNLIMITED — theoretically unbounded upside (long call).
 * PATH_DEPENDENT — depends on time/volatility path (calendar/diagonal).
 * NOT_APPLICABLE — strategy not supported in this sprint (monitor_only).
 */
export type GainLossType =
  | "DEFINED"
  | "SUBSTANTIAL"
  | "UNLIMITED"
  | "PATH_DEPENDENT"
  | "NOT_APPLICABLE";

export interface GainLossValue {
  type:                  GainLossType;
  /** Exact loss/gain per contract unit in dollars — null unless type=DEFINED. */
  perContractDollars:    number | null;
  /** Total for one spread unit (perContractDollars already). */
  note:                  string;       // always non-empty
}

// ===========================================================================
// Breakeven
// ===========================================================================

export interface BreakevenPoint {
  price:            number;
  label:            string;   // e.g. "Breakeven" / "Lower Breakeven" / "Upper Breakeven"
  distanceFromRefPct: number | null;  // % above/below reference price; null if no ref
}

// ===========================================================================
// Payoff Profile
// ===========================================================================

export interface PayoffProfile {
  maxLoss:         GainLossValue;
  maxGain:         GainLossValue;
  breakevens:      BreakevenPoint[];
  isDefinedRisk:   boolean;
  payoffNote:      string;
}

// ===========================================================================
// Capital Profile
// ===========================================================================

export interface CapitalProfile {
  /** Net debit paid per contract (positive = debit; null if credit structure). */
  netDebitPerContract:          number | null;
  /** Net credit received per contract (positive = credit; null if debit structure). */
  netCreditPerContract:         number | null;
  /**
   * Gross contract notional — meaningful for cash-secured put (putStrike × multiplier).
   * null for debit-only structures.
   */
  grossContractNotional:        number | null;
  /**
   * Best estimate of the scenario capital at stake for one contract unit.
   * For debit structures: debit × multiplier.
   * For cash-secured put: putStrike × multiplier.
   * For covered call: underlying reference value.
   * null if not computable.
   */
  estimatedScenarioCapital:     number | null;
  estimatedScenarioCapitalNote: string;
  contractMultiplier:           number;
  debitCreditType:              "DEBIT" | "CREDIT" | null;
}

// ===========================================================================
// Greek Profile
// ===========================================================================

export interface GreekProfile {
  netDelta:               number | null;
  netGamma:               number | null;
  netTheta:               number | null;
  netVega:                number | null;
  netRho:                 number | null;
  /** 0–100 — percentage of legs that contributed a non-null Greek value. */
  greeksCoveragePercent:  number;
  partialGreeks:          boolean;
  greeksNote:             string;
  deltaInterpretation:    string;
  gammaInterpretation:    string;
  thetaInterpretation:    string;
  vegaInterpretation:     string;
}

// ===========================================================================
// Price Scenarios
// ===========================================================================

/**
 * Hypothesis: the underlying moves by movePct% from the reference price.
 * Results are labeled HYPOTHETICAL — not a forecast.
 *
 * Two distinct calculations are returned:
 *  (1) Expiration intrinsic payoff — valid closed-form math at expiration.
 *  (2) Pre-expiration delta approximation — first-order Greek approximation;
 *      labeled clearly as an approximation, not a model price.
 */
export interface PriceScenario {
  movePct:             number;    // e.g. -20, -10, 0, +10, +20
  scenarioPrice:       number;

  // ---- At-expiration (intrinsic math) ------------------------------------
  expirationIntrinsicPnlPerContract: number;   // P/L at expiration (dollars)
  expirationPayoffLabel:             string;   // "Gain" / "Loss" / "Breakeven"

  // ---- Pre-expiration approximation (delta-only) -------------------------
  /** Estimated P/L approximation using net delta × price change × multiplier. */
  deltaApproxPnlPerContract:         number | null;
  deltaApproxMethodologyNote:        string;

  // ---- Context -----------------------------------------------------------
  /** Distance to the nearest breakeven (positive = above, negative = below). */
  nearestBreakevenDistance:          number | null;
  thesisInvalidationStatus:
    | "BELOW_INVALIDATION"
    | "ABOVE_INVALIDATION"
    | "WITHIN_RANGE"
    | "UNKNOWN";
  thesisInvalidationNote:            string | null;
  /** True for the 0% move scenario. */
  isCurrent:                         boolean;
}

// ===========================================================================
// Volatility Scenarios (vega approximation)
// ===========================================================================

export interface VolatilityScenario {
  /** Relative % change applied to current IV. e.g. -20 means IV × 0.80. */
  ivRelativeChangePct:               number;
  ivRelativeChangePctLabel:          string;
  baseIVDecimal:                     number | null;
  scenarioIVDecimal:                 number | null;
  /** Estimated structure value change per contract (vega approximation). */
  estimatedValueChangePerContract:   number | null;
  methodology:                       "VEGA_APPROXIMATION" | "UNAVAILABLE";
  methodologyNote:                   string;
}

// ===========================================================================
// Time Decay Scenarios
// ===========================================================================

export interface TimeDecayScenario {
  label:            string;  // "Today" / "25% Elapsed" / "50%" / "75%" / "Near Expiration" / "At Expiration"
  daysElapsed:      number;
  daysRemaining:    number;
  /** Cumulative estimated theta impact per contract from today. */
  cumulativeEstimatedDecayPerContract: number | null;
  methodology: "THETA_APPROXIMATION" | "AT_EXPIRATION_INTRINSIC" | "UNAVAILABLE";
  methodologyNote: string;
}

// ===========================================================================
// Event Scenario
// ===========================================================================

export interface EventScenario {
  eventType:                string;
  eventDate:                string | null;
  eventWithinStructureLife: boolean;
  daysUntilEvent:           number | null;
  gapRiskNote:              string;
  ivUncertaintyNote:        string;
  assignmentRiskNote:       string | null;
}

// ===========================================================================
// Liquidity & Quote Risk
// ===========================================================================

export interface LiquidityRisk {
  overallLiquidityCategory: string;
  worstLegLiquidityLabel:   string;
  quoteFreshness:           "FRESH" | "STALE" | "UNKNOWN";
  widestBidAskSpreadPct:    number | null;
  lowestOpenInterest:       number | null;
  lowestVolume:             number | null;
  executionNote:            string;
}

export interface QuoteRisk {
  midpointNote:              string;
  /** Debit if structure cost evaluated at bid prices (worst-case for buyer). */
  bidSideDebitPerContract:   number | null;
  /** Debit if evaluated at ask prices. */
  askSideDebitPerContract:   number | null;
  /** Debit at midpoint (the research reference). */
  midpointDebitPerContract:  number | null;
  spreadIllustrationNote:    string;
}

// ===========================================================================
// Thesis Risk (invalidation overlay)
// ===========================================================================

export interface ThesisRisk {
  researchThesisSummary:     string;
  invalidationNote:          string | null;
  /**
   * Price level extracted from invalidationNote (e.g. $142 from "below $142").
   * null if not parseable.
   */
  invalidationPriceLevel:    number | null;
  thesisIntegrationNote:     string;
}

// ===========================================================================
// Planning Constraint Check
// ===========================================================================

export interface ConstraintCheck {
  userMaxCapitalAtRisk:  number | null;  // from userConstraints.maxCapitalAtRisk
  scenarioMaxLoss:       number | null;  // from payoffProfile.maxLoss (DEFINED only)
  /**
   * WITHIN_CONSTRAINT   — maxLoss ≤ userMaxCapitalAtRisk
   * EXCEEDS_CONSTRAINT  — maxLoss > userMaxCapitalAtRisk
   * NO_CONSTRAINT_SET   — user has no maxCapitalAtRisk set
   * UNDEFINED_RISK      — max loss is not DEFINED (substantial/unlimited/path-dep)
   */
  status: "WITHIN_CONSTRAINT" | "EXCEEDS_CONSTRAINT" | "NO_CONSTRAINT_SET" | "UNDEFINED_RISK";
  statusNote: string;
}

// ===========================================================================
// Structure Summary (top-card display data)
// ===========================================================================

export interface StructureLegSummary {
  role:          "long_leg" | "short_leg";
  roleLabel:     string;
  optionType:    "call" | "put";
  strike:        number;
  expiration:    string;
  dte:           number;
  midpoint:      number | null;
  ivDisplay:     string | null;   // "45.0%"
  delta:         number | null;
}

export interface StructureSummary {
  strategyFamily:       string;
  strategyLabel:        string;
  expirations:          string[];         // unique expiration dates
  primaryDte:           number;
  legs:                 StructureLegSummary[];
  referencePrice:       number | null;
  referencePriceLabel:  string;
  estimatedMidpoint:    number | null;    // net debit/credit midpoint
  debitCreditType:      "DEBIT" | "CREDIT" | null;
  contractMultiplier:   number;
  primaryIVDisplay:     string | null;
  eventWindowNote:      string;
  liquidityCategoryLabel: string;
}

// ===========================================================================
// Main Result
// ===========================================================================

export interface TradeRiskScenarioResult {
  id:                          string;
  userId:                      string;
  planningContextId:           string;
  contractResearchCandidateId: string;

  symbol:                      string;
  strategyFamily:              string;

  generatedAt:                 string;
  marketDataAsOf:              string | null;
  optionDataAsOf:              string | null;
  generationLatencyMs:         number;

  structureSummary:            StructureSummary;
  capitalProfile:              CapitalProfile;
  payoffProfile:               PayoffProfile;
  greekProfile:                GreekProfile;
  priceScenarios:              PriceScenario[];
  volatilityScenarios:         VolatilityScenario[];
  timeDecayScenarios:          TimeDecayScenario[];
  eventScenarios:              EventScenario[];

  liquidityRisk:               LiquidityRisk;
  quoteRisk:                   QuoteRisk;
  thesisRisk:                  ThesisRisk;
  constraintCheck:             ConstraintCheck;
  /** Optional: populated if user has an active portfolio and the symbol appears. */
  portfolioContext:            null;  // 2.7.4: always null; extended in future

  riskFlags:                   RiskFlag[];
  assumptions:                 string[];
  limitations:                 string[];
  warnings:                    string[];

  /**
   * Probability metrics are OFF in 2.7.4.
   * The Probability Engine audit found a heuristic confidence scorer —
   * not a validated statistical model. Default: false.
   */
  probabilityMetricsEnabled:   false;
  probabilityMetricsNote:      string;

  freshness: {
    isStale:        boolean;
    staleReasons:   string[];
    optionDataAge:  string | null;
  };

  methodologyVersion: string;
  disclaimer:         string;
  optionsRiskDisclosure: string;

  /** 2.7.5 handoff contract — see TradePlanInput below. */
  tradePlanHandoff: TradePlanInput;
}

// ===========================================================================
// 2.7.5 Handoff Contract
// ===========================================================================

/**
 * Handoff from Risk & Scenario Analysis (2.7.4) to Trade Plan Workspace (2.7.5).
 *
 * 2.7.5 combines: Research Thesis + Planning Structure + Contract Candidate
 *                + Risk Analysis + Monitoring Plan + User Notes.
 * No execution in 2.7.5.
 */
export interface TradePlanInput {
  planningContextId:             string;
  selectedExpressionFamily:      string;
  contractResearchCandidateId:   string | null;
  equityPlanningScenarioId:      string | null;
  riskScenarioAnalysisId:        string;
  researchThesis:                string;
  planningConstraintsFingerprint: string;
  monitoringPlan:                string | null;  // future: user notes
  riskFlags:                     RiskFlagCode[];
  invalidationContext:           string | null;
}

// ===========================================================================
// Health Metrics (admin aggregate — no PII)
// ===========================================================================

export interface RiskAnalysisHealth {
  riskAnalysesRequested:       number;
  riskAnalysesCompleted:       number;
  partialRiskAnalyses:         number;
  failedRiskAnalyses:          number;
  averageRiskAnalysisLatencyMs: number | null;
  staleRiskAnalyses:           number;
  probabilityMetricsEnabled:   false;
  lastSuccessfulRiskAnalysisAt: string | null;
}

// ===========================================================================
// API Request / Response shapes
// ===========================================================================

export interface RiskAnalysisRequest {
  contractResearchCandidateId: string;
  /** Optional custom scenario percentages e.g. [-30,-15,0,15,30]. */
  customScenarioPcts?:         number[];
  /** Optional custom IV relative change percentages e.g. [-30,-10,0,10,30]. */
  customIVChangePcts?:         number[];
}

// ===========================================================================
// Constants
// ===========================================================================

export const RISK_SCENARIO_DISCLAIMER =
  "Trade Risk & Scenario Analysis presents deterministic and hypothetical " +
  "risk scenarios for a user-selected research structure. Scenario results " +
  "are not forecasts, guarantees, personalized recommendations, or " +
  "instructions to transact. Actual outcomes and execution prices may " +
  "differ materially.";

export const RISK_SCENARIO_VERSION = "2.7.4";

export const DEFAULT_PRICE_SCENARIO_PCTS = [-30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30];

export const DEFAULT_IV_SCENARIO_PCTS = [-20, -10, 0, 10, 20];

export const MIDPOINT_EXECUTION_NOTE =
  "Scenario values are based on research midpoint references and may not " +
  "reflect executable prices. Actual fills depend on market liquidity and bid/ask spreads.";

/** Legs with updatedAt more than this many minutes old are considered stale. */
export const STALE_QUOTE_THRESHOLD_MINUTES = 30;

export const LOW_OI_THRESHOLD = 200;
export const WIDE_SPREAD_THRESHOLD_PCT = 15;   // > 15% bid-ask spread
