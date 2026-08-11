/**
 * shared/execution-readiness-types.ts — Sprint 2.8.4
 *
 * Canonical types for the Execution Readiness & Guardrails layer.
 *
 * ARCHITECTURE INVARIANTS:
 *   1. Readiness is DETERMINISTIC — no LLM involvement, ever.
 *      The AI assistant may EXPLAIN findings later, but it may NEVER:
 *        - convert BLOCKED to READY
 *        - ignore stale quotes
 *        - override missing buying power
 *        - override missing positions
 *        - override broker restrictions
 *   2. No live broker orders are submitted by this module.
 *   3. Unknown must remain unknown — NEVER fabricate capabilities.
 *   4. Forbidden status labels: TRADE_APPROVED, GO, EXECUTION_APPROVED,
 *      RECOMMENDED, PASS_THROUGH, ALL_CLEAR, APPROVED_TO_TRADE.
 *
 * Workflow position:
 *   Trade Plan → Options Order Preview (2.8.3)
 *             → Execution Readiness    (2.8.4) ← this module
 *             → Review & Confirm       (2.8.5, future)
 *             → Broker Submission      (future, requires 2.8.5 GO)
 */

import type { OptionsOrderPreview } from "./options-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// READINESS STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three possible readiness states.
 * NEVER use: TRADE_APPROVED, GO, EXECUTION_APPROVED, RECOMMENDED, PASS, PASS_THROUGH.
 */
export type ExecutionReadinessStatus =
  | "READY"               // all checks pass — "Ready for review"
  | "READY_WITH_WARNINGS" // non-blocking issues found — "Ready for review with caution"
  | "BLOCKED";            // one or more blockers — "Resolve blockers before continuing"

export const EXECUTION_READINESS_STATUS_LABELS: Record<ExecutionReadinessStatus, string> = {
  READY:               "Ready for Review",
  READY_WITH_WARNINGS: "Ready with Warnings",
  BLOCKED:             "Blocked",
};

export const EXECUTION_READINESS_STATUS_DESCRIPTIONS: Record<ExecutionReadinessStatus, string> = {
  READY:               "All readiness checks pass. Proceed to review.",
  READY_WITH_WARNINGS: "Order can proceed to review, but warnings require attention.",
  BLOCKED:             "One or more blockers must be resolved before proceeding.",
};

// ─────────────────────────────────────────────────────────────────────────────
// FINDING CATEGORY + SEVERITY
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionReadinessFindingCategory =
  | "MARKET_DATA"
  | "ACCOUNT"
  | "POSITION"
  | "CAPITAL"
  | "STRUCTURE"
  | "RISK"
  | "EXPIRATION"
  | "LIQUIDITY"
  | "PRICING";

export type ExecutionReadinessFindingSeverity =
  | "INFO"     // informational — does not affect status
  | "WARNING"  // promotes status to READY_WITH_WARNINGS
  | "BLOCKER"; // promotes status to BLOCKED

// ─────────────────────────────────────────────────────────────────────────────
// FINDING
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionReadinessFinding {
  code: string;                            // machine-readable stable code
  severity: ExecutionReadinessFindingSeverity;
  category: ExecutionReadinessFindingCategory;
  title: string;                           // short human label
  message: string;                         // plain-language explanation
  source?: string;                         // data source if relevant
  legIndex?: number;                       // which leg, if leg-specific
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING CODES
// ─────────────────────────────────────────────────────────────────────────────

// Market Data
export const FR_QUOTE_UNAVAILABLE           = "QUOTE_UNAVAILABLE";
export const FR_QUOTE_STALE                 = "QUOTE_STALE";
export const FR_ALL_QUOTES_UNAVAILABLE      = "ALL_QUOTES_UNAVAILABLE";
export const FR_OPTION_MARKET_INVALID       = "OPTION_MARKET_INVALID";
export const FR_WIDE_BID_ASK_SPREAD         = "WIDE_BID_ASK_SPREAD";
export const FR_SEVERE_WIDE_SPREAD          = "SEVERE_WIDE_SPREAD";
export const FR_ZERO_BID                    = "ZERO_BID";
export const FR_MARKET_CLOSED               = "MARKET_CLOSED";
export const FR_PARTIAL_GREEKS              = "PARTIAL_GREEKS";

// Account
export const FR_BROKER_NOT_CONNECTED        = "BROKER_NOT_CONNECTED";
export const FR_ACCOUNT_UNAVAILABLE         = "ACCOUNT_UNAVAILABLE";
export const FR_OPTIONS_PERMISSION_UNCONFIRMED = "OPTIONS_PERMISSION_UNCONFIRMED";
export const FR_OPTIONS_NOT_SUPPORTED       = "OPTIONS_NOT_SUPPORTED";
export const FR_MULTILEG_NOT_SUPPORTED      = "MULTILEG_NOT_SUPPORTED";

// Position
export const FR_INSUFFICIENT_COVERED_SHARES = "INSUFFICIENT_COVERED_SHARES";
export const FR_INSUFFICIENT_OPTION_POSITION = "INSUFFICIENT_OPTION_POSITION";
export const FR_POSITION_DATA_UNAVAILABLE   = "POSITION_DATA_UNAVAILABLE";
export const FR_POSITION_NOT_FOUND          = "POSITION_NOT_FOUND";

// Capital
export const FR_BUYING_POWER_INSUFFICIENT   = "BUYING_POWER_INSUFFICIENT";
export const FR_BUYING_POWER_UNCONFIRMED    = "BUYING_POWER_UNCONFIRMED";
export const FR_BROKER_MARGIN_CALCULATION_REQUIRED = "BROKER_MARGIN_CALCULATION_REQUIRED";

// Structure
export const FR_INVALID_LEG_STRUCTURE       = "INVALID_LEG_STRUCTURE";
export const FR_INVALID_STRIKE_ORDER        = "INVALID_STRIKE_ORDER";
export const FR_INVALID_EXPIRATION_STRUCTURE = "INVALID_EXPIRATION_STRUCTURE";
export const FR_INVALID_QUANTITY            = "INVALID_QUANTITY";
export const FR_MIXED_UNDERLYING            = "MIXED_UNDERLYING";

// Risk / Assignment
export const FR_SHORT_OPTION_ASSIGNMENT_RISK = "SHORT_OPTION_ASSIGNMENT_RISK";
export const FR_EARLY_EXERCISE_RISK         = "EARLY_EXERCISE_RISK";
export const FR_PIN_RISK                    = "PIN_RISK";

// Expiration
export const FR_OPTION_EXPIRED              = "OPTION_EXPIRED";
export const FR_ZERO_DTE                    = "ZERO_DTE";
export const FR_NEAR_EXPIRATION             = "NEAR_EXPIRATION";

// Liquidity
export const FR_LOW_OPEN_INTEREST           = "LOW_OPEN_INTEREST";
export const FR_LOW_VOLUME                  = "LOW_VOLUME";

// Pricing
export const FR_INVALID_NET_PRICE           = "INVALID_NET_PRICE";
export const FR_PRICING_DIRECTION_MISMATCH  = "PRICING_DIRECTION_MISMATCH";
export const FR_PRICING_UNAVAILABLE         = "PRICING_UNAVAILABLE";

// ─────────────────────────────────────────────────────────────────────────────
// CAPITAL ESTIMATE
// ─────────────────────────────────────────────────────────────────────────────

export type CapitalEstimationType =
  | "DEFINED_RISK"              // max loss calculable from structure
  | "BROKER_MARGIN_REQUIRED"    // undefined-risk: broker must calculate margin
  | "SHARES_ONLY"               // covered call / protective put — shares already owned
  | "UNAVAILABLE";              // cannot estimate

export interface CapitalEstimate {
  estimatedRequirementUsd: number | null;
  estimatedRequirementLabel: string;
  estimationType: CapitalEstimationType;
  breakdown: string;   // plain-language breakdown of the calculation
  isEstimate: true;    // always true — NEVER call this an approval
  disclaimer: string;
}

export const CAPITAL_ESTIMATE_DISCLAIMER =
  "Capital requirement is a pre-trade estimate only. Actual margin requirements may differ. " +
  "This is not investment advice and does not guarantee execution at any price.";

// ─────────────────────────────────────────────────────────────────────────────
// READINESS RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionReadinessResult {
  readonly engineVersion: "2.8.4";
  readonly ruleEngineVersion: "2.8.4";

  id: string;
  status: ExecutionReadinessStatus;
  statusLabel: string;
  statusDescription: string;

  findings: ExecutionReadinessFinding[];
  blockerCount: number;
  warningCount: number;
  infoCount: number;

  capitalEstimate: CapitalEstimate | null;

  evaluatedAt: string;   // ISO 8601

  tradePlanId: string;
  orderDraftId: string | null;
  orderPreviewId: string | null;

  /** Whether broker submission capability is currently enabled (always false pre-2.8.5) */
  brokerSubmissionEnabled: false;

  disclaimer: string;
}

export const EXECUTION_READINESS_DISCLAIMER =
  "Execution Readiness is a deterministic pre-trade check only. " +
  "It does not guarantee order acceptance, execution, fill price, or profitability. " +
  "This result is not investment advice.";

export const EXECUTION_READINESS_METHODOLOGY_VERSION = "2.8.4" as const;

// ─────────────────────────────────────────────────────────────────────────────
// BROKER CAPABILITIES (normalized — provider-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized broker capability context for readiness checks.
 * Unknown fields must remain null — never fabricate capabilities.
 */
export interface BrokerReadinessCapabilities {
  connected: boolean;
  provider: string;
  supportsOptions: boolean | null;      // null = UNKNOWN
  supportsMultileg: boolean | null;     // null = UNKNOWN
  optionsLevel: string | null;          // null = not reported by broker
  accountStatus: string | null;
  buyingPowerUsd: number | null;        // null = unavailable
  buyingPowerSource: "broker" | "unavailable";
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION CONTEXT (simplified for readiness)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadinessPositionContext {
  symbol: string;
  quantity: number;
  isOption: boolean;
  contractSymbol?: string;
  isLiveBrokerData: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAIL CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionGuardrailConfig {
  /** Seconds before an underlying quote is considered stale */
  quoteStaleSeconds: number;
  /** Seconds before an option contract quote is considered stale */
  optionQuoteStaleSeconds: number;
  /** Warn on 0 DTE (same-day expiration) */
  zeroDteWarning: boolean;
  /** Warn when DTE ≤ this many days */
  nearExpirationDays: number;
  /** Bid/ask spread % threshold for WARNING */
  wideBidAskWarningPct: number;
  /** Bid/ask spread % threshold for SEVERE WARNING */
  wideBidAskSevereWarningPct: number;
  /** Open interest below this → LOW_OPEN_INTEREST warning */
  lowOpenInterestThreshold: number;
  /** Volume below this → LOW_VOLUME warning */
  lowVolumeThreshold: number;
}

export const DEFAULT_EXECUTION_GUARDRAIL_CONFIG: ExecutionGuardrailConfig = {
  quoteStaleSeconds:          900,  // 15 minutes for underlying
  optionQuoteStaleSeconds:    300,  // 5 minutes for option contracts
  zeroDteWarning:             true,
  nearExpirationDays:         2,
  wideBidAskWarningPct:       10,
  wideBidAskSevereWarningPct: 20,
  lowOpenInterestThreshold:   100,
  lowVolumeThreshold:         10,
};

// ─────────────────────────────────────────────────────────────────────────────
// INPUT SHAPE
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionReadinessInput {
  tradePlanId: string;
  userId: string;
  orderDraftId: string | null;
  orderPreviewId: string | null;

  /** Options Order Preview from Sprint 2.8.3 — must be VALID or REQUIRES_REVIEW */
  preview: OptionsOrderPreview;

  /** Live broker positions, or null if unavailable */
  positions: ReadinessPositionContext[] | null;

  /** Broker capabilities, or null if broker disconnected/unknown */
  brokerCapabilities: BrokerReadinessCapabilities | null;

  /** Injectable for tests */
  now?: Date;

  /** Override default guardrail config */
  config?: Partial<ExecutionGuardrailConfig>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPS INTERFACE (injectable for tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionReadinessDeps {
  now(): Date;
  persistResult(result: ExecutionReadinessResult, input: ExecutionReadinessInput): Promise<void>;
  loadBrokerCapabilities(userId: string, provider: string, accountRef: string): Promise<BrokerReadinessCapabilities | null>;
  loadPositions(userId: string, accountRef: string): Promise<ReadinessPositionContext[] | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY METADATA (expected leg counts, coverage requirements, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_EXPECTED_LEG_COUNT: Record<string, number> = {
  long_call:          1,
  long_put:           1,
  covered_call:       1,
  cash_secured_put:   1,
  protective_put:     1,
  collar:             2,
  bull_call_spread:   2,
  bear_put_spread:    2,
  bull_put_spread:    2,
  bear_call_spread:   2,
  long_straddle:      2,
  long_strangle:      2,
  calendar_spread:    2,
  diagonal_spread:    2,
  iron_condor:        4,
  iron_butterfly:     4,
};

/** Strategy families that require existing share coverage */
export const COVERAGE_REQUIRED_FAMILIES = new Set([
  "covered_call",
  "collar",
]);

/** Strategy families where protective_put share requirement depends on riskContext.coverageValidated */
export const PROTECTIVE_PUT_FAMILIES = new Set([
  "protective_put",
]);

/** Strategy families where capital is defined-risk (max loss calculable) */
export const DEFINED_RISK_FAMILIES = new Set([
  "long_call", "long_put", "protective_put",
  "bull_call_spread", "bear_put_spread",
  "bull_put_spread", "bear_call_spread",
  "covered_call", "cash_secured_put",
  "collar",
  "long_straddle", "long_strangle",
  "calendar_spread", "diagonal_spread",
  "iron_condor", "iron_butterfly",
]);
