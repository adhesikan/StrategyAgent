/**
 * Equity Trade Planning Types — Sprint 2.7.1
 *
 * Canonical types for the Equity Trade Planning Engine.
 *
 * ARCHITECTURE CONTRACT:
 *   Equity Planning is the HOW layer for equity expression research.
 *   It consumes TradePlanningContext (already validated research).
 *   It does NOT:
 *     - Score or rank securities
 *     - Select strikes, expirations, or contracts
 *     - Produce orders
 *     - Submit to brokers
 *     - Perform suitability assessments
 *     - Generate options strategy logic (Sprint 2.7.2+)
 *
 * COMPLIANCE LANGUAGE:
 *   "Equity Trade Planning provides hypothetical research scenarios based on
 *   existing research evidence and planning constraints you select. It does
 *   not constitute investment advice, a personalized recommendation,
 *   suitability determination, or instruction to buy, sell, hold, or size
 *   a position."
 *
 * TERMINOLOGY REQUIRED:
 *   ✓ Equity Research Scenario
 *   ✓ Research Entry Framework
 *   ✓ Hypothetical Position Size
 *   ✓ Scenario Capital
 *   ✓ Research Invalidation
 *   ✓ Scenario Analysis
 *   ✓ Monitoring Plan
 *   ✓ Research Consideration
 *   ✓ Hypothetical Scenario P/L
 *
 * TERMINOLOGY FORBIDDEN:
 *   ✗ Recommended Entry / Buy Zone / Best Entry / Strong Buy
 *   ✗ Recommended Position Size
 *   ✗ Target Price / Price Target / Profit Target
 *   ✗ Expected Return / Projected Return / Forecast Return
 *   ✗ Safe Trade / Low Risk for You / Appropriate Risk
 *   ✗ Guaranteed Upside
 */

// ===========================================================================
// Entry Condition Types
// ===========================================================================

export const ENTRY_CONDITION_TYPES = [
  "CURRENT_STRUCTURE",
  "BREAKOUT_CONFIRMATION",
  "PULLBACK_TO_SUPPORT",
  "RECLAIM",
  "TREND_CONTINUATION",
  "MONITOR_ONLY",
] as const;

export type EntryConditionType = (typeof ENTRY_CONDITION_TYPES)[number];

export const ENTRY_CONDITION_LABELS: Record<EntryConditionType, string> = {
  CURRENT_STRUCTURE:      "Current Research Structure",
  BREAKOUT_CONFIRMATION:  "Breakout Confirmation",
  PULLBACK_TO_SUPPORT:    "Pullback to Research Support",
  RECLAIM:                "Level Reclaim",
  TREND_CONTINUATION:     "Trend Continuation",
  MONITOR_ONLY:           "Monitor Only",
};

// ===========================================================================
// Reference Level (from canonical research only — never fabricated)
// ===========================================================================

export type ReferenceLevelType =
  | "support"
  | "resistance"
  | "moving_average"
  | "invalidation"
  | "pivot"
  | "prior_high"
  | "prior_low";

export interface ReferenceLevel {
  type:        ReferenceLevelType;
  label:       string;                // e.g. "Research Support", "SMA 50", "Technical Resistance"
  price:       number;
  source:      string;                // e.g. "Stored technical bars", "Canonical research evidence"
  description: string;
}

// ===========================================================================
// Entry Framework
// ===========================================================================

export interface EntryZone {
  label:       string;                // "Research Scenario Entry Zone"
  priceLow:    number;
  priceHigh:   number;
  reason:      string;
  sourceLevel: ReferenceLevelType;
}

export interface EntryFramework {
  available:          boolean;        // false when no validated technical level exists
  conditionType:      EntryConditionType | null;
  referencePrice:     number | null;
  entryZones:         EntryZone[];
  requiredEvidence:   string[];       // conditions that must hold for entry consideration
  invalidIf:          string[];       // conditions that would negate the entry framework
  referenceLevels:    ReferenceLevel[];
  notes:              string[];
  unavailableReason?: string;         // why entry framework is unavailable (if !available)
}

// ===========================================================================
// Invalidation Framework
// ===========================================================================

export interface InvalidationCondition {
  condition:    string;               // human-readable research invalidation condition
  detail:       string | null;
  severity:     "high" | "medium" | "low";
  evidenceSource: string;
}

export interface InvalidationFramework {
  conditions:      InvalidationCondition[];
  referenceLevels: ReferenceLevel[];
  evidenceSources: string[];
}

// ===========================================================================
// Position Sizing Framework
// ===========================================================================

export interface SizingFramework {
  // Inputs (from user constraints — none inferred from financial capacity)
  capitalAvailable:       number | null;
  maxCapitalAtRisk:       number | null;
  maxLossPerPosition:     number | null;
  referencePrice:         number | null;
  invalidationPrice:      number | null;

  // Computed (only when inputs allow)
  riskPerShare:           number | null;  // referencePrice - invalidationPrice (when available)
  sharesByCapitalLimit:   number | null;  // floor(maxCapitalAtRisk / referencePrice)
  sharesByRiskLimit:      number | null;  // floor(maxLossPerPosition / riskPerShare)
  effectiveScenarioShares: number | null; // min(sharesByCapitalLimit, sharesByRiskLimit) or best available
  capitalRequired:        number | null;  // effectiveScenarioShares * referencePrice
  capitalPercentOfPlanningCapital: number | null;
  estimatedLossAtInvalidation: number | null;

  // Partial state reasons
  partialReasons:         string[];

  // Rounding
  roundingNotes:          string[];

  // Compliance
  disclaimer:             string;
}

// ===========================================================================
// Scenario Grid (deterministic — NOT a price forecast)
// ===========================================================================

export interface ScenarioPoint {
  percentChange:    number;          // e.g. -0.20, -0.10, 0, +0.10, +0.20
  label:            string;          // e.g. "-20%", "+10%"
  hypotheticalPrice: number;
  hypotheticalMarketValue: number | null;  // null when no shares
  hypotheticalPL:   number | null;         // null when no shares or no reference price
  hypotheticalPLPct: number | null;
  isReferenceLevel: boolean;
  referenceLevelLabel: string | null;      // e.g. "Research Support", "SMA 50"
}

export interface ScenarioGrid {
  referencePrice:   number;
  sharesUsed:       number | null;   // null when no sizing computed
  capitalInvested:  number | null;
  scenarioPoints:   ScenarioPoint[];

  // Reward/risk (only when both upside and invalidation reference exist)
  upsideDistance:   number | null;   // from referencePrice to resistance/upside reference
  downsideDistance: number | null;   // from referencePrice to invalidation level
  rewardRiskRatio:  number | null;   // upsideDistance / downsideDistance

  disclaimer: string;                // "Hypothetical Scenario — not a price forecast"
}

// ===========================================================================
// Monitoring Plan
// ===========================================================================

export type MonitoringCategory =
  | "technical"
  | "fundamental"
  | "institutional"
  | "sector"
  | "theme"
  | "market_regime"
  | "portfolio_exposure"
  | "events";

export interface MonitoringItem {
  category:        MonitoringCategory;
  label:           string;
  currentState:    string;
  watchCondition:  string;           // "Review if..."
  evidenceSource:  string;
}

export interface MonitoringPlan {
  items:          MonitoringItem[];
  alertsNote:     string;            // "Alert implementation is a future feature"
}

// ===========================================================================
// Capital Context
// ===========================================================================

export interface CapitalContext {
  planningCapital:         number | null;
  maxScenarioCapital:      number | null;
  maxScenarioLoss:         number | null;
  hypotheticalShares:      number | null;
  estimatedCapitalRequired: number | null;
  estimatedLossAtInvalidation: number | null;
  disclaimer: string;
}

// ===========================================================================
// Research Evidence Summary
// ===========================================================================

export interface EquityResearchEvidence {
  whyQualified:       string;
  primaryEvidence:    Array<{ label: string; detail: string | null; severity?: string }>;
  secondaryEvidence:  Array<{ label: string; detail: string | null; severity?: string }>;
  risks:              Array<{ label: string; detail: string | null; severity?: string }>;
  thesisInvalidation: Array<{ condition: string; detail: string | null }>;
  recentChanges:      string[];
  marketRegime:       string | null;
  sectorContext:      string | null;
  themeContext:       string[];
  goalContext:        string | null;
  portfolioContext:   string | null;
}

// ===========================================================================
// Data Freshness
// ===========================================================================

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unavailable";

export interface EquityFreshnessItem {
  label:     string;
  status:    FreshnessStatus;
  asOf:      string | null;          // ISO timestamp
  ageLabel:  string;                 // "5 min ago", "2 hours ago", "3 days ago"
}

export interface EquityPlanningFreshness {
  referencePrice:          EquityFreshnessItem;
  technicalLevels:         EquityFreshnessItem;
  opportunityIntelligence: EquityFreshnessItem;
  fundamentals:            EquityFreshnessItem;
  institutional:           EquityFreshnessItem;
  portfolio:               EquityFreshnessItem;
  goal:                    EquityFreshnessItem;
  hasStaleCriticalData:    boolean;
  staleWarning:            string | null;
}

// ===========================================================================
// Equity Planning Scenario (canonical — reusable by future sprints)
// ===========================================================================

export interface EquityPlanningScenario {
  id:                  string;
  planningContextId:   string;
  planningSessionId:   string | null;
  symbol:              string;
  generatedAt:         string;        // ISO timestamp
  marketDataAsOf:      string | null; // ISO timestamp of reference price data

  // Research summary (from canonical TradePlanningContext — never re-scored)
  researchSummary:     EquityResearchEvidence;

  // Reference price (from stored bars — never fabricated)
  referencePrice:      number | null;
  referencePriceSource: string;       // "Stored daily close — [date]"

  // Frameworks (deterministic, pure)
  entryFramework:      EntryFramework;
  invalidationFramework: InvalidationFramework;
  sizingFramework:     SizingFramework;
  scenarioGrid:        ScenarioGrid | null;   // null when no reference price
  monitoringPlan:      MonitoringPlan;

  // Capital context
  capitalContext:      CapitalContext;

  // Limitations from partial data
  limitations:         string[];

  // Data freshness
  freshness:           EquityPlanningFreshness;

  // Versioning / audit
  methodologyVersion:  string;        // "equity-planning-v1"
  planningConstraintsFingerprint: string;
}

// ===========================================================================
// Equity Planning Input (consumed by service)
// ===========================================================================

export interface EquityPlanningInput {
  userId:              string;
  symbol:              string;
  tradePlanningContextId: string;
  planningSessionId:   string | null;
  constraints:         import("./trade-planning-types").TradePlanningConstraints;
  // Client may submit scenario range preferences
  downsidePct?:        number;       // default -0.20
  upsidePct?:          number;       // default +0.20
}

// ===========================================================================
// Health Metrics (extends Trade Planning health)
// ===========================================================================

export interface EquityPlanningHealthMetrics {
  equityScenariosGenerated:         number;
  partialEquityScenarios:           number;
  failedEquityScenarios:            number;
  averageEquityScenarioLatencyMs:   number | null;
  lastSuccessfulEquityScenarioAt:   string | null;
  // Admin-only aggregates — no symbols, capital, or user identity
}

// ===========================================================================
// Compliance constants
// ===========================================================================

export const EQUITY_PLANNING_DISCLAIMER =
  "Equity Trade Planning provides hypothetical research scenarios based on " +
  "existing research evidence and planning constraints you select. It does " +
  "not constitute investment advice, a personalized recommendation, " +
  "suitability determination, or instruction to buy, sell, hold, or size a position.";

export const SIZING_DISCLAIMER =
  "Planning values illustrate the selected research scenario and are not " +
  "individualized position-size recommendations.";

export const SCENARIO_DISCLAIMER =
  "Hypothetical Scenario — these figures are not a price forecast, " +
  "expected return, or projected return.";

export const REWARD_RISK_DISCLAIMER =
  "Scenario reward/risk ratios are derived from reference levels in the " +
  "research thesis and are not a prediction of actual outcome.";

export const MONITORING_DISCLAIMER =
  "Alert implementation is a future feature. This monitoring plan is " +
  "a research reference only.";

export const FUTURE_EXECUTION_DISCLAIMER =
  "This scenario is not an order. Future Order Preparation (Sprint 2.7.5+) " +
  "will require fresh market data, buying power confirmation, and explicit " +
  "user action before any order is constructed.";

/** Scenario range defaults */
export const DEFAULT_SCENARIO_PERCENTAGES = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20];

export const EQUITY_METHODOLOGY_VERSION = "equity-planning-v1";
