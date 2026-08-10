/**
 * Trade Planning Foundation — Shared Types
 *
 * Sprint 2.7.0: Canonical types for the Research → Trade Planning bridge.
 *
 * ARCHITECTURE CONTRACT:
 *   Research answers WHAT deserves investigation.
 *   Goals answer WHICH research matters to this user.
 *   Portfolio Intelligence answers HOW this research relates to existing exposure.
 *   Trade Planning answers HOW this qualified thesis could potentially be expressed.
 *   Trade Construction answers WHAT specific structure could represent that scenario.
 *   Execution answers DOES the user explicitly choose to submit it?
 *
 * ROADMAP DISCIPLINE — Sprint 2.7.0 does NOT implement:
 *   - Strike selection
 *   - Expiration selection
 *   - Order construction
 *   - Broker submission
 *   - Trade recommendations
 *   - "Best trade" ranking
 *   - Suitability decisions
 *   - Target prices
 *   - Profit guarantees
 *   - Autonomous execution
 *
 * COMPLIANCE:
 *   TradePlanningConstraints are USER-SELECTED PLANNING PREFERENCES.
 *   They are NOT: risk tolerance, risk capacity, suitability, or financial advice.
 *   No income, net worth, age, tax bracket, employment, or household data collected.
 */

import type {
  EvidenceItem, RiskFactor, InvalidatesThesis,
} from "./opportunity-intelligence-types";
import type { ResearchHorizon } from "./research-goal-types";

// ===========================================================================
// Expression Families
// ===========================================================================

/**
 * Broad research-expression family (Sprint 2.7.0).
 * Does NOT include specific contracts, strikes, expirations, or spread widths.
 * Those belong to Sprint 2.7.2 (Options Strategy Matching Engine).
 */
export const EXPRESSION_FAMILIES = [
  "equity",
  "equity_scaled",
  "income",
  "defined_risk_directional",
  "covered_call",
  "cash_secured_put",
  "vertical_spread",
  "long_option",
  "neutral_options",
  "monitor_only",
] as const;

export type ExpressionFamily = typeof EXPRESSION_FAMILIES[number];

export const EXPRESSION_FAMILY_LABELS: Record<ExpressionFamily, string> = {
  equity:                   "Equity Research",
  equity_scaled:            "Scaled Equity Research",
  income:                   "Income Research",
  defined_risk_directional: "Defined-Risk Options Research",
  covered_call:             "Covered Call Research",
  cash_secured_put:         "Cash-Secured Put Research",
  vertical_spread:          "Vertical Spread Research",
  long_option:              "Long Options Research",
  neutral_options:          "Neutral Options Research",
  monitor_only:             "Monitor Only",
};

export const EXPRESSION_FAMILY_DESCRIPTIONS: Record<ExpressionFamily, string> = {
  equity:
    "Research how the thesis could potentially be expressed through direct equity ownership.",
  equity_scaled:
    "Research how a scaled or phased equity position could be structured across multiple entries.",
  income:
    "Research income-focused expression approaches consistent with the candidate's profile.",
  defined_risk_directional:
    "Research options structures that cap maximum capital at risk while maintaining directional exposure.",
  covered_call:
    "Research covered-call structures for candidates where equity exposure and income context align.",
  cash_secured_put:
    "Research cash-secured put structures for candidates with acquisition or income context.",
  vertical_spread:
    "Research vertical spread structures for defined-risk directional expression.",
  long_option:
    "Research long options positions for directional thesis expression.",
  neutral_options:
    "Research non-directional options structures for range-bound or uncertainty-focused contexts.",
  monitor_only:
    "Monitor this candidate without constructing a research expression at this time.",
};

// ---------------------------------------------------------------------------
// Eligibility status
// ---------------------------------------------------------------------------

export const EXPRESSION_STATUSES = [
  "applicable",
  "potentially_applicable",
  "unavailable",
] as const;

export type ExpressionStatus = typeof EXPRESSION_STATUSES[number];

export const EXPRESSION_STATUS_LABELS: Record<ExpressionStatus, string> = {
  applicable:            "Applicable",
  potentially_applicable:"Potentially Applicable",
  unavailable:           "Unavailable",
};

export const EXPRESSION_STATUS_DESCRIPTIONS: Record<ExpressionStatus, string> = {
  applicable:
    "Research conditions and planning constraints support exploring this expression.",
  potentially_applicable:
    "Conditions partially support this expression. See missing constraints.",
  unavailable:
    "Current research conditions or planning constraints do not support this expression.",
};

/**
 * Result for one expression family after deterministic eligibility evaluation.
 * No numeric scores — status is categorical only.
 * No "recommended" or "best" language.
 */
export interface ExpressionFamilyResult {
  family:              ExpressionFamily;
  label:               string;
  description:         string;
  status:              ExpressionStatus;
  /** Human-readable reasons why this family is applicable or potentially applicable. */
  reasons:             string[];
  /** Constraints the user hasn't provided yet that could change eligibility. */
  constraintsMissing:  string[];
  /** Data limitations affecting this family's evaluation. */
  limitations:         string[];
}

// ===========================================================================
// Planning Constraints
// ===========================================================================

/**
 * User-selected trade planning preferences.
 *
 * CRITICAL: These are NOT:
 *   - risk tolerance
 *   - risk capacity
 *   - suitability assessment
 *   - financial advice
 *
 * No income, net worth, age, tax bracket, employment, or household data collected.
 * These are used ONLY to construct research scenarios.
 */
export interface TradePlanningConstraints {
  /** Total capital the user wants to consider for this planning scenario. */
  capitalAvailable?:      number;
  /** Maximum capital the user wants to put at risk in this planning scenario. */
  maxCapitalAtRisk?:      number;
  /** Maximum dollar loss the user wants to model per position. */
  maxLossPerPosition?:    number;
  /** Preferred research horizon for this planning scenario. */
  preferredHoldingPeriod?: "short" | "medium" | "long" | "multi_year";
  /** Whether equity research is allowed in this session. Default: true */
  equityAllowed:           boolean;
  /** Whether options research is allowed in this session. Default: false */
  optionsAllowed:          boolean;
  /** Whether defined-risk is preferred over undefined-risk structures. */
  definedRiskPreferred?:   boolean;
  /** Whether income-focused research expressions should be surfaced. */
  incomeFocus?:            boolean;
  /** Whether directional research expressions should be emphasized. */
  directionalFocus?:       boolean;
  /** Whether to note earnings/event windows in the planning context. */
  avoidEarningsWindow?:    boolean;
}

export const DEFAULT_CONSTRAINTS: TradePlanningConstraints = {
  equityAllowed:  true,
  optionsAllowed: false,
};

// ===========================================================================
// Portfolio Context within planning
// ===========================================================================

export interface PlanningPortfolioContext {
  portfolioId:         string;
  portfolioName:       string;
  ownsSymbol:          boolean;
  /** Current position size if owned (shares or contracts). */
  positionSize?:       number;
  /** Portfolio weight (0–100) if owned. */
  portfolioWeight?:    number;
  /** Average cost basis if available. */
  costBasis?:          number | null;
  /** Current market value of position if owned. */
  currentExposure?:    number | null;
  /** Concentration context. */
  concentrationNote?:  string | null;
  /** Most recent research change for this symbol in portfolio context. */
  recentResearchChange?: string | null;
  freshness:           PlanningFreshness;
}

// ===========================================================================
// Goal Context within planning
// ===========================================================================

export interface PlanningGoalContext {
  goalId:           string;
  goalName:         string;
  goalType:         string;
  horizon:          ResearchHorizon;
  researchStyle:    string;
  incomeFocused:    boolean;
  optionsInterest:  boolean;
  preferredThemes:  string[];
  matchState:       "strong_match" | "match" | "partial_match" | "outside_filters";
  freshness:        PlanningFreshness;
}

// ===========================================================================
// Freshness
// ===========================================================================

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unavailable";

export interface PlanningFreshness {
  status:       FreshnessStatus;
  label:        string;
  ageMinutes?:  number;
  updatedAt?:   string;
}

// ===========================================================================
// Canonical Trade Planning Context
// ===========================================================================

/**
 * The canonical bridge object between Research and Trade Planning.
 *
 * Server assembles this from authoritative services — client NEVER submits
 * research scores, qualification status, or portfolio weights.
 *
 * Client may submit only: userId-selected constraints, goalId, portfolioId,
 * and selected expression family.
 */
export interface TradePlanningContext {
  id:              string;
  userId:          string;
  symbol:          string;
  companyName:     string | null;

  // Source of truth: Opportunity Intelligence
  opportunityId:    string;
  opportunityType:  string;
  opportunityLabel: string;

  // Optional personalizations
  researchGoalId?:  string | null;
  portfolioId?:     string | null;

  // Research horizon from opportunity + goal context
  researchHorizon:  string;
  marketRegime:     string | null;

  // Authoritative quality scores (server-assembled, never client-supplied)
  researchScore:      number;
  technicalScore:     number;
  fundamentalScore:   number;
  institutionalScore: number;
  evidenceConfidence: string;
  riskLevel:          string;

  // Research evidence (copied from CanonicalOpportunity)
  primaryEvidence:   EvidenceItem[];
  secondaryEvidence: EvidenceItem[];
  riskFactors:       RiskFactor[];
  invalidatesThesis: InvalidatesThesis[];

  // Classification
  sector:    string | null;
  industry:  string | null;
  themes:    string[];

  // Optional contexts (absent = planning works without them)
  portfolioContext?: PlanningPortfolioContext | null;
  goalContext?:      PlanningGoalContext | null;

  // User-selected planning constraints
  userConstraints: TradePlanningConstraints;

  // Eligible expression families (filled after evaluateExpressionFamilies)
  eligibleExpressionFamilies: ExpressionFamilyResult[];

  // Limitations and freshness
  limitations:  string[];
  freshness: {
    opportunityIntelligence: PlanningFreshness;
    technicalEvidence:       PlanningFreshness;
    fundamentalEvidence:     PlanningFreshness;
    institutionalEvidence:   PlanningFreshness;
    portfolioContext:        PlanningFreshness;
    goalContext:             PlanningFreshness;
  };

  generatedAt: string;
}

// ===========================================================================
// Planning Session (DB model)
// ===========================================================================

export interface TradePlanningSession {
  id:                      string;
  userId:                  string;
  symbol:                  string;
  opportunityId:           string | null;
  researchGoalId:          string | null;
  portfolioId:             string | null;
  constraints:             TradePlanningConstraints;
  selectedExpressionFamily: ExpressionFamily | null;
  createdAt:               string;
  updatedAt:               string;
}

// ===========================================================================
// API request/response types
// ===========================================================================

export interface BuildContextRequest {
  /** ID of the user's Research Goal to include in context (optional). */
  goalId?:       string | null;
  /** ID of the user's Portfolio to include in context (optional). */
  portfolioId?:  string | null;
}

export interface CreateSessionRequest {
  symbol:       string;
  constraints?: Partial<TradePlanningConstraints>;
  goalId?:      string | null;
  portfolioId?: string | null;
}

export interface UpdateSessionRequest {
  constraints?:             Partial<TradePlanningConstraints>;
  goalId?:                  string | null;
  portfolioId?:             string | null;
  selectedExpressionFamily?: ExpressionFamily | null;
}

// ===========================================================================
// Future Engine Handoff Interfaces (documented only — not implemented in 2.7.0)
// ===========================================================================

/**
 * Sprint 2.7.1 — Equity Planning Engine input contract.
 * NOT implemented in Sprint 2.7.0.
 * Defines only the handoff shape so 2.7.1 has a concrete contract to fill.
 *
 * Does NOT include: entry price, stop loss, position size, target price.
 * Those belong to approved methodology in Sprint 2.7.1.
 */
export interface EquityPlanningInput {
  tradePlanningContextId: string;
  symbol:                 string;
  researchHorizon:        string;
  planningConstraints:    TradePlanningConstraints;
  researchEvidence:       EvidenceItem[];
  invalidationEvidence:   InvalidatesThesis[];
}

/**
 * Sprint 2.7.2 — Options Strategy Matching Engine input contract.
 * NOT implemented in Sprint 2.7.0.
 * Defines only the handoff shape so 2.7.2 has a concrete contract to fill.
 *
 * Does NOT include: strike, expiration, contract, premium, spread width.
 * Those belong to Sprint 2.7.3.
 */
export interface OptionsStrategyMatchingInput {
  planningContextId:  string;
  symbol:             string;
  opportunityType:    string;
  researchHorizon:    string;
  volatilityPreference: "lower" | "balanced" | "higher_accepted";
  incomeFocus:        boolean;
  directionalBias:    "bullish" | "bearish" | "neutral";
  riskPreference:     "defined" | "undefined";
}

/**
 * Future Policy Layer (RIA / Institutional) — Sprint 2.7.x+
 * NOT implemented in Sprint 2.7.0.
 */
export interface PlanningPolicy {
  allowedExpressionFamilies:    ExpressionFamily[];
  prohibitedExpressionFamilies: ExpressionFamily[];
  maxPlanningCapital?:          number;
  approvedHorizons:             string[];
  liquidityRequirements?:       string;
  customDisclosures:            string[];
}

// ===========================================================================
// Platform health (in-memory metrics)
// ===========================================================================

export interface TradePlanningHealthMetrics {
  contextsBuilt:              number;
  sessionsCreated:            number;
  expressionEvaluations:      number;
  partialContexts:            number;
  failedContexts:             number;
  averageContextLatencyMs:    number | null;
  lastSuccessfulContextAt:    string | null;
}

// ===========================================================================
// Compliance constants
// ===========================================================================

/** Canonical compliance disclaimer — must appear on all trade-planning surfaces. */
export const TRADE_PLANNING_DISCLAIMER =
  "Trade Planning provides research scenarios showing how an existing research thesis could " +
  "potentially be expressed. It does not constitute investment advice, a personalized " +
  "recommendation, a suitability determination, or an instruction to buy, sell, hold, " +
  "or enter any security or strategy.";

/** Constraints disclaimer — appears near the planning constraints form. */
export const CONSTRAINTS_DISCLAIMER =
  "These values are used only to construct research scenarios and do not " +
  "constitute a suitability assessment.";

/** No expression-ranking disclaimer. */
export const NO_RANKING_DISCLAIMER =
  "Research expressions are not ranked by preference. " +
  "No expression is labeled 'recommended,' 'best,' or 'optimal.'";

// ===========================================================================
// Architecture contract constants
// ===========================================================================

export const ARCHITECTURE_CONTRACT = {
  research:            "Answers WHAT deserves investigation",
  goals:               "Answers WHICH research matters to this user",
  portfolioIntelligence:"Answers HOW this research relates to existing exposure",
  tradePlanning:       "Answers HOW this qualified thesis could potentially be expressed",
  tradeConstruction:   "Answers WHAT specific structure could represent that scenario",
  execution:           "Answers DOES the user explicitly choose to submit it",
} as const;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateExpressionFamily(f: string): f is ExpressionFamily {
  return (EXPRESSION_FAMILIES as readonly string[]).includes(f);
}

export function validateConstraints(raw: unknown): TradePlanningConstraints {
  if (!raw || typeof raw !== "object") return DEFAULT_CONSTRAINTS;
  const c = raw as Record<string, unknown>;
  return {
    capitalAvailable:      typeof c.capitalAvailable === "number" && c.capitalAvailable > 0
                             ? c.capitalAvailable : undefined,
    maxCapitalAtRisk:      typeof c.maxCapitalAtRisk === "number" && c.maxCapitalAtRisk > 0
                             ? c.maxCapitalAtRisk : undefined,
    maxLossPerPosition:    typeof c.maxLossPerPosition === "number" && c.maxLossPerPosition > 0
                             ? c.maxLossPerPosition : undefined,
    preferredHoldingPeriod:["short","medium","long","multi_year"].includes(c.preferredHoldingPeriod as string)
                             ? (c.preferredHoldingPeriod as "short"|"medium"|"long"|"multi_year") : undefined,
    equityAllowed:   c.equityAllowed === false ? false : true,
    optionsAllowed:  c.optionsAllowed === true,
    definedRiskPreferred: c.definedRiskPreferred === true ? true : undefined,
    incomeFocus:          c.incomeFocus === true ? true : undefined,
    directionalFocus:     c.directionalFocus === true ? true : undefined,
    avoidEarningsWindow:  c.avoidEarningsWindow === true ? true : undefined,
  };
}

export function constraintsFingerprint(c: TradePlanningConstraints): string {
  return [
    c.capitalAvailable ?? 0,
    c.maxCapitalAtRisk ?? 0,
    c.maxLossPerPosition ?? 0,
    c.preferredHoldingPeriod ?? "",
    c.equityAllowed ? "1" : "0",
    c.optionsAllowed ? "1" : "0",
    c.definedRiskPreferred ? "1" : "0",
    c.incomeFocus ? "1" : "0",
    c.directionalFocus ? "1" : "0",
    c.avoidEarningsWindow ? "1" : "0",
  ].join(":");
}
