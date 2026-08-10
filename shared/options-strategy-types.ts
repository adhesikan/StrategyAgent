/**
 * Options Strategy Matching Types — Sprint 2.7.2
 *
 * SCOPE: Strategy FAMILY matching only.
 * This sprint does NOT select: expiration, strike, contract, premium, spread
 * width, quantity, or broker order. Those belong to later sprints.
 *
 * COMPLIANCE:
 *   "Options Strategy Matching identifies strategy families that are
 *   structurally consistent with the current research thesis and planning
 *   constraints. It does not recommend a specific strategy, contract,
 *   expiration, strike, or trade and does not constitute investment advice
 *   or a suitability determination."
 */

// ===========================================================================
// Strategy Family Registry
// ===========================================================================

export type OptionsStrategyFamily =
  | "long_call"
  | "long_put"
  | "bull_call_spread"
  | "bear_put_spread"
  | "bull_put_spread"
  | "bear_call_spread"
  | "covered_call"
  | "cash_secured_put"
  | "protective_put"
  | "collar"
  | "iron_condor"
  | "iron_butterfly"
  | "long_straddle"
  | "long_strangle"
  | "calendar_spread"
  | "diagonal_spread"
  | "monitor_only";

export const ALL_OPTIONS_STRATEGY_FAMILIES: ReadonlyArray<OptionsStrategyFamily> = [
  "long_call",
  "long_put",
  "bull_call_spread",
  "bear_put_spread",
  "bull_put_spread",
  "bear_call_spread",
  "covered_call",
  "cash_secured_put",
  "protective_put",
  "collar",
  "iron_condor",
  "iron_butterfly",
  "long_straddle",
  "long_strangle",
  "calendar_spread",
  "diagonal_spread",
  "monitor_only",
];

// ===========================================================================
// Strategy Category
// ===========================================================================

export type StrategyCategory =
  | "directional_bullish"
  | "directional_bearish"
  | "income"
  | "neutral_range_bound"
  | "volatility"
  | "protective"
  | "monitor_only";

export const STRATEGY_CATEGORY_LABELS: Record<StrategyCategory, string> = {
  directional_bullish: "Directional Bullish",
  directional_bearish: "Directional Bearish",
  income:              "Income",
  neutral_range_bound: "Neutral / Range-Bound",
  volatility:          "Volatility",
  protective:          "Protective / Existing Position",
  monitor_only:        "Monitor Only",
};

/** Canonical category for each strategy family. */
export const STRATEGY_FAMILY_CATEGORY: Record<OptionsStrategyFamily, StrategyCategory> = {
  long_call:        "directional_bullish",
  bull_call_spread: "directional_bullish",
  bull_put_spread:  "directional_bullish",   // credit spread — bullish directional / income
  cash_secured_put: "income",
  long_put:         "directional_bearish",
  bear_put_spread:  "directional_bearish",
  bear_call_spread: "directional_bearish",   // credit spread — bearish directional / income
  covered_call:     "income",
  iron_condor:      "neutral_range_bound",
  iron_butterfly:   "neutral_range_bound",
  collar:           "protective",
  protective_put:   "protective",
  long_straddle:    "volatility",
  long_strangle:    "volatility",
  calendar_spread:  "neutral_range_bound",
  diagonal_spread:  "directional_bullish",   // most common form is bullish diagonal
  monitor_only:     "monitor_only",
};

/** Human-readable labels for each strategy family. */
export const STRATEGY_FAMILY_LABELS: Record<OptionsStrategyFamily, string> = {
  long_call:        "Long Call",
  long_put:         "Long Put",
  bull_call_spread: "Bull Call Spread",
  bear_put_spread:  "Bear Put Spread",
  bull_put_spread:  "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  covered_call:     "Covered Call",
  cash_secured_put: "Cash-Secured Put",
  protective_put:   "Protective Put",
  collar:           "Collar",
  iron_condor:      "Iron Condor",
  iron_butterfly:   "Iron Butterfly",
  long_straddle:    "Long Straddle",
  long_strangle:    "Long Strangle",
  calendar_spread:  "Calendar Spread",
  diagonal_spread:  "Diagonal Spread",
  monitor_only:     "Monitor Only",
};

// ===========================================================================
// Strategy Match Status
// ===========================================================================

export type StrategyMatchStatus =
  | "APPLICABLE"
  | "POTENTIALLY_APPLICABLE"
  | "NOT_APPLICABLE"
  | "UNAVAILABLE";

export const STRATEGY_MATCH_STATUS_LABELS: Record<StrategyMatchStatus, string> = {
  APPLICABLE:             "Applicable",
  POTENTIALLY_APPLICABLE: "Potentially Applicable",
  NOT_APPLICABLE:         "Not Applicable",
  UNAVAILABLE:            "Unavailable",
};

// ===========================================================================
// Thesis Direction
// ===========================================================================

export type ThesisDirection =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL"
  | "RANGE_BOUND"
  | "VOLATILITY_EXPANSION"
  | "VOLATILITY_CONTRACTION"
  | "MIXED"
  | "UNKNOWN";

export const THESIS_DIRECTION_LABELS: Record<ThesisDirection, string> = {
  BULLISH:                "Bullish",
  BEARISH:                "Bearish",
  NEUTRAL:                "Neutral",
  RANGE_BOUND:            "Range-Bound",
  VOLATILITY_EXPANSION:   "Volatility Expansion",
  VOLATILITY_CONTRACTION: "Volatility Contraction",
  MIXED:                  "Mixed",
  UNKNOWN:                "Unknown",
};

// ===========================================================================
// Volatility Context
// ===========================================================================

export type VolatilityLevel = "LOW" | "NORMAL" | "ELEVATED" | "HIGH" | "UNKNOWN";

export interface VolatilityContext {
  level:  VolatilityLevel;
  note:   string;
  source: string | null;
}

// ===========================================================================
// Liquidity Context
// ===========================================================================

export type LiquidityAvailability = "AVAILABLE" | "LIMITED" | "UNKNOWN";

export interface LiquidityContext {
  availability: LiquidityAvailability;
  note: string;
}

// ===========================================================================
// Event Context
// ===========================================================================

export interface EventContext {
  hasUpcomingEvent:    boolean;
  eventType:           string | null;  // "earnings" | "fda" | "economic" | null
  daysUntilEvent:      number | null;
  insideEventWindow:   boolean;
  earningsWindowDays:  number;
  note:                string;
}

// ===========================================================================
// Canonical Strategy Match
// ===========================================================================

/** Broad structural description of a strategy family. No strikes/expirations. */
export interface StrategyStructureDescription {
  /** Number of legs involved generically. */
  legCount:  number;
  /** Generic leg direction descriptions (not actual contracts). */
  legLabels: string[];
  /** Whether premium is paid (long structures) or received (short/credit). */
  premiumDirection: "paid" | "received" | "neutral" | "varies";
  /** Is this a defined-risk structure? */
  isDefinedRisk: boolean;
  /** Does this structure generate income (credit/premium-selling)? */
  isIncomeFocused: boolean;
  /** Does this structure require directional movement? */
  isDirectional: boolean;
  /** Does this structure require an existing underlying position? */
  requiresOwnership: boolean;
}

export interface OptionsStrategyMatch {
  strategyFamily:              OptionsStrategyFamily;
  strategyLabel:               string;
  strategyCategory:            StrategyCategory;
  strategyCategoryLabel:       string;
  status:                      StrategyMatchStatus;
  statusLabel:                 string;

  /** Why this family is applicable or not. */
  reasons:                     string[];
  /** Which planning constraints / evidence items support this match. */
  constraintsSatisfied:        string[];
  /** Which information is needed before this family can be fully evaluated. */
  constraintsMissing:          string[];

  /** Educational: broad risk characteristics (not personalized). */
  riskCharacteristics:         string[];
  /** Educational: income-oriented characteristics. */
  incomeCharacteristics:       string[];
  /** Educational: directional characteristics. */
  directionalCharacteristics:  string[];
  /** How event context (earnings, announcements) affects this family. */
  eventConsiderations:         string[];
  /** Conditions the portfolio context must satisfy. */
  portfolioRequirements:       string[];
  /** Partial-data or context limitations. */
  limitations:                 string[];

  /** Generic structural description — no actual contracts/strikes. */
  structure:                   StrategyStructureDescription;

  /** What is needed from Contract Research (2.7.3) before proceeding. */
  nextStageRequirements:       string[];

  /** Canonical handoff input for 2.7.3 (null until family is selected). */
  contractResearchInput:       OptionsContractResearchInput | null;
}

// ===========================================================================
// Freshness
// ===========================================================================

export type MatchFreshnessStatus = "fresh" | "aging" | "stale" | "unavailable";

export interface MatchFreshnessItem {
  label:    string;
  status:   MatchFreshnessStatus;
  asOf:     string | null;
  ageLabel: string;
}

export interface OptionsMatchFreshness {
  opportunityIntelligence: MatchFreshnessItem;
  portfolioContext:        MatchFreshnessItem;
  goalContext:             MatchFreshnessItem;
  volatilityData:          MatchFreshnessItem;
  eventData:               MatchFreshnessItem;
  hasStaleCriticalData:    boolean;
  staleWarning:            string | null;
}

// ===========================================================================
// Canonical Match Result
// ===========================================================================

export interface OptionsStrategyMatchResult {
  id:                              string;
  planningContextId:               string;
  symbol:                          string;
  generatedAt:                     string;

  thesisDirection:                 ThesisDirection;
  thesisDirectionLabel:            string;
  thesisDirectionReasoning:        string[];
  researchHorizon:                 string | null;
  marketRegime:                    string | null;

  volatilityContext:               VolatilityContext;
  liquidityContext:                LiquidityContext;
  eventContext:                    EventContext | null;

  portfolioOwnership:              "owned" | "not_owned" | "unknown";
  goalContextLabel:                string | null;

  /** All 17 strategy family evaluations. */
  matches:                         OptionsStrategyMatch[];

  applicableCount:                 number;
  potentialCount:                  number;
  notApplicableCount:              number;
  unavailableCount:                number;

  /** Partial-data or context limitations affecting the whole result. */
  limitations:                     string[];

  freshness:                       OptionsMatchFreshness;
  disclaimer:                      string;
  optionsRiskDisclosure:           string;
  methodologyVersion:              string;
  planningConstraintsFingerprint:  string;
  generationLatencyMs?:            number;
}

// ===========================================================================
// 2.7.3 Handoff Contract (documented, not implemented)
// ===========================================================================

/**
 * Canonical handoff input from Options Strategy Matching (2.7.2) to
 * Contract Research (2.7.3).
 *
 * 2.7.2 answers: WHICH strategy families fit the thesis?
 * 2.7.3 answers: WHICH contracts/expirations/strikes are suitable for
 *               RESEARCH within the user-selected strategy family?
 *
 * 2.7.3 must consume this input. It must NOT re-run strategy-family
 * selection from scratch.
 */
export interface OptionsContractResearchInput {
  planningContextId:              string;
  strategyFamily:                 OptionsStrategyFamily;
  researchHorizon:                string | null;
  thesisDirection:                ThesisDirection;
  volatilityContext:              VolatilityContext;
  liquidityContext:               LiquidityContext;
  eventContext:                   EventContext | null;
  /** Opaque fingerprint — for cache/versioning only, no constraint values. */
  planningConstraintsFingerprint: string;
}

// ===========================================================================
// Compliance constants
// ===========================================================================

export const OPTIONS_STRATEGY_DISCLAIMER =
  "Options Strategy Matching identifies strategy families that are structurally " +
  "consistent with the current research thesis and planning constraints. It does not " +
  "recommend a specific strategy, contract, expiration, strike, or trade and does not " +
  "constitute investment advice or a suitability determination.";

export const OPTIONS_RISK_DISCLOSURE =
  "Options involve risk and are not suitable for everyone. Options may lose their " +
  "entire value rapidly. Some options strategies can involve substantial or " +
  "theoretically unlimited loss unless defined-risk protections are used. Not every " +
  "strategy described here is a defined-risk structure. Verify the broad loss " +
  "characteristics of any strategy family before pursuing contract research.";

export const NO_RECOMMENDATION_NOTE =
  "No strategy family is labeled 'best,' 'recommended,' 'highest probability,' " +
  "or 'winning.' Strategy matching is a research tool, not a trade instruction.";

/** Current methodology version for cache busting and ops auditing. */
export const OPTIONS_MATCHING_VERSION = "options-matching-v1";

// ===========================================================================
// RIA / Institutional Policy (documented, not implemented)
// ===========================================================================

/**
 * Future: OptionsPlanningPolicy for RIA/Institutional tier.
 * Not implemented in 2.7.2 — no entitlement enforcement.
 *
 * interface OptionsPlanningPolicy {
 *   allowedStrategies?:    OptionsStrategyFamily[];
 *   prohibitedStrategies?: OptionsStrategyFamily[];
 *   optionsLevel?:         "level_1" | "level_2" | "level_3" | "level_4";
 *   requireDefinedRisk?:   boolean;
 *   minLiquidityRules?:    string;
 *   maxEventExposure?:     number;  // days
 *   customDisclosures?:    string[];
 * }
 */
