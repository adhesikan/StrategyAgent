/**
 * shared/trade-preference-types.ts — Sprint 2.8.1A
 *
 * Canonical types for:
 *   - UserTradingPreferences (global, presentation-only)
 *   - BroadExpressionType (8 user-facing research structure categories)
 *   - ExpressionOption (compatibility card per category)
 *   - OpportunityExpressionSelection (per-opportunity explicit user choice)
 *
 * PERMANENT ARCHITECTURE RULE:
 * UserTradingPreferences determine which research structures are shown first.
 * They do NOT qualify securities, determine suitability, authorize strategies,
 * override broker permissions, override risk controls, or authorize execution.
 * The user explicitly chooses the broad expression type for each Trade Planning
 * workflow. VCP Trader AI may then evaluate compatible structures INSIDE that
 * user-selected category. The specific structure and contract remain
 * user-selected before execution planning proceeds.
 *
 * Five permanently separate concepts — never merge:
 * 1. UserTradingPreferences     — presentation ordering only
 * 2. OpportunityExpressionSelection — explicit per-opportunity user choice
 * 3. OptionsStrategyMatch        — structural compatibility per thesis
 * 4. BrokerPermissions           — what broker account allows
 * 5. ExecutionPreflightResult    — safety/execution readiness
 *
 * COMPLIANCE:
 * - Do NOT say "Recommended for You", "Best Strategy", "Suitable"
 * - Do NOT derive preference from income, net worth, age, tax, employment
 * - Do NOT say "Based on your profile"
 * - Do NOT create Trader Type, Risk Score, Suitability Profile
 */

// ─────────────────────────────────────────────────────────────────────────────
// BROAD EXPRESSION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const BROAD_EXPRESSION_TYPES = [
  "STOCK",
  "LONG_OPTIONS",
  "COVERED_CALL",
  "CASH_SECURED_PUT",
  "DEFINED_RISK_OPTIONS",
  "INCOME_OPTIONS",
  "NEUTRAL_OPTIONS",
  "ADVANCED_OPTIONS",
  "EXPLORE_COMPATIBLE_STRUCTURES",
] as const;

export type BroadExpressionType = (typeof BROAD_EXPRESSION_TYPES)[number];

export function isBroadExpressionType(v: unknown): v is BroadExpressionType {
  return typeof v === "string" && (BROAD_EXPRESSION_TYPES as readonly string[]).includes(v);
}

/** User-facing labels. Never "Recommended" or "Best". */
export const BROAD_EXPRESSION_LABELS: Record<BroadExpressionType, string> = {
  STOCK:                       "Stock",
  LONG_OPTIONS:                "Long Options",
  COVERED_CALL:                "Covered Calls",
  CASH_SECURED_PUT:            "Cash-Secured Puts",
  DEFINED_RISK_OPTIONS:        "Defined-Risk Options",
  INCOME_OPTIONS:              "Income / Premium Strategies",
  NEUTRAL_OPTIONS:             "Neutral / Range Strategies",
  ADVANCED_OPTIONS:            "Advanced Options",
  EXPLORE_COMPATIBLE_STRUCTURES: "Explore Compatible Structures",
};

/** Educational descriptions — no performance promises. */
export const BROAD_EXPRESSION_EDUCATIONAL: Record<BroadExpressionType, string> = {
  STOCK:
    "Explore an equity-based research scenario using entry framework, hypothetical sizing, risk observations, and thesis invalidation.",
  LONG_OPTIONS:
    "Explore long call or put structures consistent with the current research direction and planning horizon.",
  COVERED_CALL:
    "Explore covered-call research when sufficient underlying shares are confirmed.",
  CASH_SECURED_PUT:
    "Explore put structures backed by estimated cash-secured capital. Exact capital requirement is determined during contract research.",
  DEFINED_RISK_OPTIONS:
    "Explore options structures where risk is structurally bounded by the selected multi-leg construction.",
  INCOME_OPTIONS:
    "Explore premium-selling strategies oriented toward income generation. Suitability and coverage requirements are verified separately.",
  NEUTRAL_OPTIONS:
    "Explore range-bound or low-directional-bias structures. Availability depends on current research thesis direction.",
  ADVANCED_OPTIONS:
    "Explore calendar, diagonal, or complex multi-leg structures. Opt-in category for extended options research.",
  EXPLORE_COMPATIBLE_STRUCTURES:
    "View all research structure categories structurally compatible with the current opportunity. You still choose the specific structure.",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY STATUS
// ─────────────────────────────────────────────────────────────────────────────

export const EXPRESSION_COMPATIBILITY_STATUSES = [
  "AVAILABLE",
  "AVAILABLE_WITH_REQUIREMENTS",
  "NOT_ALIGNED_WITH_CURRENT_RESEARCH",
  "UNAVAILABLE",
] as const;

export type ExpressionCompatibilityStatus =
  (typeof EXPRESSION_COMPATIBILITY_STATUSES)[number];

export const EXPRESSION_COMPATIBILITY_LABELS: Record<ExpressionCompatibilityStatus, string> = {
  AVAILABLE:                        "Available",
  AVAILABLE_WITH_REQUIREMENTS:      "Available with Requirements",
  NOT_ALIGNED_WITH_CURRENT_RESEARCH:"Not Aligned with Current Research",
  UNAVAILABLE:                      "Unavailable",
};

/** Sort weight — lower = shown first. */
export const COMPATIBILITY_SORT_WEIGHT: Record<ExpressionCompatibilityStatus, number> = {
  AVAILABLE:                        0,
  AVAILABLE_WITH_REQUIREMENTS:      1,
  NOT_ALIGNED_WITH_CURRENT_RESEARCH:2,
  UNAVAILABLE:                      3,
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESSION OPTION  (one card per broad category)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpressionOption {
  expressionType:          BroadExpressionType;
  label:                   string;
  educationalSummary:      string;
  compatibilityStatus:     ExpressionCompatibilityStatus;
  preferredByUser:         boolean;
  /** Why this status — shown to user. Never "Not Recommended". */
  reasons:                 string[];
  /** What the user needs to satisfy before proceeding. */
  requirements:            string[];
  /** Non-blocking constraints or notes. */
  limitations:             string[];
  /** Low-level ExpressionFamily values available under this broad type. */
  specificCompatibleFamilies: string[];
}

/** Ordered list of ExpressionOption — preferred first within same status. */
export interface ExpressionOptionsResult {
  symbol:          string;
  sessionId?:      string;
  options:         ExpressionOption[];
  userPreferences: UserTradingPreferences | null;
  disclaimer:      string;
  generatedAt:     string;
  methodologyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// USER TRADING PREFERENCES  (global, presentation-only)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserTradingPreferences {
  userId:                      string;
  preferredExpressionTypes:    BroadExpressionType[];
  showOtherCompatibleStructures: boolean;
  updatedAt:                   string;
}

/** Default when user has not saved any preferences — show all categories. */
export const DEFAULT_USER_TRADING_PREFERENCES: Omit<UserTradingPreferences, "userId" | "updatedAt"> = {
  preferredExpressionTypes:    [],
  showOtherCompatibleStructures: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY EXPRESSION SELECTION  (per-opportunity explicit user choice)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * selectedBy must be "USER".
 * AI cannot set this on behalf of the user.
 */
export interface OpportunityExpressionSelection {
  id:                   string;
  userId:               string;
  symbol:               string;
  planningSessionId:    string;
  selectedExpressionType: BroadExpressionType;
  selectedBy:           "USER";
  selectedAt:           string;
  updatedAt?:           string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROAD → FAMILY MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Low-level ExpressionFamily values (from shared/trade-planning-types.ts) that
 * map to each broad category. Empty array for EXPLORE means "all".
 *
 * ExpressionFamily values: equity | equity_scaled | income | defined_risk_directional
 *   | covered_call | cash_secured_put | vertical_spread | long_option
 *   | neutral_options | monitor_only
 */
export const BROAD_TO_FAMILIES: Record<BroadExpressionType, readonly string[]> = {
  STOCK:                       ["equity", "equity_scaled"],
  LONG_OPTIONS:                ["long_option"],
  COVERED_CALL:                ["covered_call"],
  CASH_SECURED_PUT:            ["cash_secured_put"],
  DEFINED_RISK_OPTIONS:        ["defined_risk_directional", "vertical_spread"],
  INCOME_OPTIONS:              ["income", "covered_call", "cash_secured_put"],
  NEUTRAL_OPTIONS:             ["neutral_options"],
  ADVANCED_OPTIONS:            ["neutral_options", "defined_risk_directional"],
  EXPLORE_COMPATIBLE_STRUCTURES: [], // all families — computed dynamically
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const TRADE_PREFERENCES_SETTINGS_DISCLAIMER =
  "These preferences control which research structures VCP Trader AI shows first. They do not determine whether any investment or strategy is appropriate for you and are not a suitability assessment or investment recommendation.";

export const EXPRESSION_SELECTION_DISCLAIMER =
  "You choose the type of research structure you want to explore. VCP Trader AI then analyzes structures within that category using the current research thesis and available data. This does not constitute investment advice, a recommendation, or a suitability determination.";

export const COVERED_CALL_CAPITAL_NOTE =
  "Covered call research requires sufficient underlying shares. Coverage is confirmed during contract research and execution preflight.";

export const CSP_CAPITAL_NOTE =
  "Exact cash-secured capital requirement is determined during contract research.";

export const ADVANCED_OPTIONS_NOTE =
  "Advanced options structures are an opt-in research category. Availability depends on options permissions confirmed during execution preflight.";

/** Methodology version for this sprint. */
export const TRADE_PREFERENCES_METHODOLOGY_VERSION = "2.8.1A";

/** Forbidden phrases — must never appear in expression-selection UI copy. */
export const EXPRESSION_SELECTION_FORBIDDEN_PHRASES = [
  "Recommended for You",
  "Best Strategy",
  "Best Strategy for You",
  "Your Ideal Strategy",
  "Your Risk Profile",
  "Suitable Strategy",
  "Appropriate for You",
  "AI Chose",
  "AI Selected",
  "Optimal Trade Type",
  "Top Strategy",
  "Based on your profile",
  "Suitability",
] as const;
