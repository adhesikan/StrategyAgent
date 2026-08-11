/**
 * shared/execution-types.ts
 *
 * Sprint 2.8.0 — Execution Architecture, Compliance & Broker Preflight
 *
 * Canonical execution types shared between server and client.
 *
 * IMPORTANT: These types describe preflight, audit, and future architecture only.
 * NO order submission, order payload, or fill monitoring types are defined here.
 * Order submission types belong to Sprint 2.8.5 and must not be introduced earlier.
 *
 * PERMANENT EXECUTION INVARIANT:
 * No AI, scanner, research engine, planning engine, lifecycle engine, or client-side
 * request may directly cause a broker order. Every broker submission must eventually
 * require a user-owned saved Trade Plan, a current server-side Execution Preflight,
 * fresh market/broker data, validated broker account, validated permissions, validated
 * buying power/position state, current risk analysis, short-lived explicit user
 * confirmation, and persistent idempotency protection.
 */

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION MODE / KILL SWITCH
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionMode = "disabled" | "sandbox" | "test_live" | "production";

/**
 * Canonical execution policy.
 * All safety requirements default TRUE.
 * Client cannot disable any safeguard.
 */
export interface ExecutionPolicy {
  executionMode: ExecutionMode;
  /** Global kill switch. If false, all order-capable endpoints return 503. */
  executionEnabled: boolean;
  requireTradePlan: boolean;
  requireFreshLifecycle: boolean;
  requireFreshQuotes: boolean;
  requireRiskAnalysis: boolean;
  requireBrokerConnection: boolean;
  requireAccountValidation: boolean;
  requirePermissions: boolean;
  requireBuyingPower: boolean;
  requirePositionValidation: boolean;
  requireExplicitConfirmation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFLIGHT OVERALL STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allowed overall preflight statuses.
 * NEVER use: READY_TO_TRADE, APPROVED, RECOMMENDED.
 */
export type ExecutionPreflightStatus =
  | "PASS"
  | "FAIL"
  | "REQUIRES_REVIEW"
  | "UNAVAILABLE"
  | "EXECUTION_DISABLED";

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION DIMENSIONS
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationStatus = "PASS" | "FAIL" | "REQUIRES_REVIEW" | "UNAVAILABLE" | "SKIPPED";

export interface ValidationDimension {
  status: ValidationStatus;
  /** Short human-readable label — never uses "approved", "recommended", "safe" */
  label: string;
  /** Optional note explaining the outcome */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFLIGHT BLOCKERS & WARNINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical execution blockers.
 * BLOCKER: future order cannot continue.
 * No recommendation semantics.
 */
export type ExecutionBlockerCode =
  | "EXECUTION_DISABLED"
  | "BROKER_NOT_CONNECTED"
  | "BROKER_NEEDS_REAUTH"
  | "ACCOUNT_NOT_RESOLVED"
  | "ACCOUNT_NOT_OWNED"
  | "EQUITY_PERMISSION_UNAVAILABLE"
  | "OPTIONS_PERMISSION_INSUFFICIENT"
  | "MULTILEG_NOT_SUPPORTED"
  | "BUYING_POWER_UNAVAILABLE"
  | "INSUFFICIENT_BUYING_POWER"
  | "POSITION_NOT_CONFIRMED"
  | "INSUFFICIENT_COVERED_SHARES"
  | "INSUFFICIENT_PROTECTIVE_SHARES"
  | "QUOTE_STALE"
  | "QUOTE_INVALID"
  | "CONTRACT_EXPIRED"
  | "CONTRACT_UNAVAILABLE"
  | "RISK_ANALYSIS_STALE"
  | "TRADE_PLAN_STALE"
  | "THESIS_INVALIDATED"
  | "PLAN_REQUIRES_REVIEW"
  | "STRUCTURE_CHANGED"
  | "UNKNOWN_CRITICAL_STATE"
  | "BROKER_RATE_LIMITED"
  | "BROKER_TIMEOUT"
  | "TRADE_PLAN_ARCHIVED"
  | "TRADE_PLAN_NOT_FOUND"
  | "PLANNING_CONSTRAINT_EXCEEDED";

export interface PreflightBlocker {
  code: ExecutionBlockerCode;
  message: string;
  dimension: string;
}

/**
 * Warnings do not block the future order flow — user should review.
 */
export type ExecutionWarningCode =
  | "EARNINGS_APPROACHING"
  | "WIDE_SPREAD"
  | "MARKET_NEAR_CLOSE"
  | "RESEARCH_CHANGED"
  | "LIFECYCLE_REQUIRES_REVIEW"
  | "QUOTE_AGING"
  | "OPTIONS_LEVEL_UNVERIFIED"
  | "RISK_ANALYSIS_AGING"
  | "MULTI_ACCOUNT_SELECTION_REQUIRED"
  | "EXTENDED_HOURS_NOT_SUPPORTED"
  | "FRACTIONAL_NOT_SUPPORTED"
  | "DATA_PARTIALLY_UNAVAILABLE";

export interface PreflightWarning {
  code: ExecutionWarningCode;
  message: string;
  dimension: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMATION REQUIREMENTS (future 2.8.1+)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Items the user must review before future order preparation.
 * Defined in 2.8.0 as architecture only. Not yet activated.
 */
export interface ConfirmationRequirements {
  requireSymbolReview: boolean;
  requireStrategyReview: boolean;
  requireLegsReview: boolean;
  requireQuantityReview: boolean;
  requireEstimatedPriceReview: boolean;
  requireEstimatedCapitalReview: boolean;
  requireMaxLossReview: boolean;
  requireBrokerAccountReview: boolean;
  requireExpirationReview: boolean;
  requireWarningsAcknowledged: boolean;
  /** Future TTL in seconds for any confirmation token */
  confirmationTtlSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION PREFLIGHT RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical execution preflight result.
 *
 * Preflight checks technical and account prerequisites that would need to be
 * satisfied before a future broker order could be prepared. A passing preflight
 * is not an investment recommendation, suitability determination, guarantee of
 * execution, or instruction to transact.
 */
export interface ExecutionPreflightResult {
  id: string;
  tradePlanId: string;
  userId: string;

  evaluatedAt: string; // ISO 8601

  /**
   * Overall status.
   * Never: READY_TO_TRADE, APPROVED, RECOMMENDED.
   */
  overallStatus: ExecutionPreflightStatus;

  /** Dimension-level validation results */
  tradePlanValidation: ValidationDimension;
  lifecycleValidation: ValidationDimension;
  freshnessValidation: ValidationDimension;
  brokerValidation: ValidationDimension;
  accountValidation: ValidationDimension;
  permissionsValidation: ValidationDimension;
  buyingPowerValidation: ValidationDimension;
  positionValidation: ValidationDimension;
  quoteValidation: ValidationDimension;
  structureValidation: ValidationDimension;
  riskValidation: ValidationDimension;

  /** Future confirmation requirements (architecture document, not yet activated) */
  confirmationRequirements: ConfirmationRequirements;

  /** Blockers that must be resolved before any future order preparation */
  blockers: PreflightBlocker[];
  /** Warnings that should be reviewed but may not block future flow per policy */
  warnings: PreflightWarning[];
  /** Documented platform limitations relevant to this preflight */
  limitations: string[];

  /**
   * When this preflight result expires.
   * A preflight PASS must not be reused indefinitely.
   * Based on shortest freshness window across all checks.
   */
  validUntil?: string; // ISO 8601

  /** Execution mode at evaluation time */
  executionMode: ExecutionMode;

  /** Provider checked (if broker connected) */
  provider?: string;

  /** Methodology version for auditability */
  methodologyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CAPABILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform-level execution capability summary.
 * Returned by GET /api/execution/capabilities.
 * Never exposes raw account IDs, balances, or tokens.
 */
export interface ExecutionCapability {
  executionEnabled: boolean;
  executionMode: ExecutionMode;

  brokerConnected: boolean;
  provider?: string;
  accountResolved: boolean;
  /** Masked for display only: e.g. "••••1234" */
  accountIdMasked?: string;

  supportsEquityOrders: boolean;
  supportsOptionsOrders: boolean;
  supportsMultiLegOrders: boolean;

  optionsPermissionLevel?: number | null;
  buyingPowerAvailable?: boolean;
  positionDataAvailable: boolean;

  quoteValidationAvailable: boolean;
  orderIdempotencyAvailable: boolean;
  explicitConfirmationRequired: boolean;

  blockers: ExecutionBlockerCode[];
  warnings: ExecutionWarningCode[];
  lastCheckedAt: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER ABSTRACTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized broker permissions from provider.
 * If provider cannot supply a field: null.
 * Do not guess.
 */
export interface BrokerPermissions {
  equityTrading: boolean | null;
  optionsTrading: boolean | null;
  optionsLevel?: number | null;
  multiLeg: boolean | null;
  margin?: boolean | null;
  shortOptions?: boolean | null;
  /** "broker" = from live API, "unavailable" = not provided */
  source: "broker" | "unavailable";
  checkedAt: string; // ISO 8601
}

/**
 * Normalized broker account.
 * accountIdMasked for display; fullId server-side only, never sent to client.
 */
export interface BrokerAccount {
  /** Server-side reference only — never expose in full to client or logs */
  accountRef: string;
  /** Display-safe masked identifier, e.g. "••••1234" */
  accountIdMasked: string;
  accountType: BrokerAccountType;
  accountName?: string;
  provider: string;
  isPreferred: boolean;
}

export type BrokerAccountType = "CASH" | "MARGIN" | "IRA" | "ROTH_IRA" | "OTHER";

/**
 * Broker balance/buying power context.
 * Amounts are server-side only — never logged in full, never sent to client in preflight.
 */
export interface BrokerBalanceContext {
  available: boolean;
  /** Estimated buying power in USD (server-side only) */
  buyingPowerUsd?: number;
  currency: string;
  source: "broker" | "unavailable";
  asOf: string; // ISO 8601
}

/**
 * Broker position summary for a specific symbol.
 * Used for covered-call/protective-put share validation.
 */
export interface BrokerPositionContext {
  symbol: string;
  quantity: number;
  /** Whether position data came from live broker API */
  isLiveBrokerData: boolean;
  asOf: string; // ISO 8601
}

/**
 * Quote validation result for preflight.
 * Never includes raw price for order construction — preflight only.
 */
export interface BrokerQuoteValidation {
  symbol: string;
  hasBid: boolean;
  hasAsk: boolean;
  hasMid: boolean;
  isStale: boolean;
  isCrossed: boolean;
  isZeroBid: boolean;
  isSpreadInvalid: boolean;
  /** Whether the quote is recent enough for execution preflight */
  isFresh: boolean;
  freshnessSec: number;
  source: "broker" | "reference" | "unavailable";
  asOf: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENT
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionAuditEventType =
  | "PREFLIGHT_STARTED"
  | "PREFLIGHT_COMPLETED"
  | "PREFLIGHT_FAILED"
  | "BROKER_CONNECTION_CHECKED"
  | "ACCOUNT_VALIDATED"
  | "PERMISSIONS_CHECKED"
  | "BUYING_POWER_CHECKED"
  | "POSITION_CHECKED"
  | "QUOTE_VALIDATED"
  | "RISK_VALIDATED"
  | "EXECUTION_DISABLED_ATTEMPT";
  // Future order event types added in Sprint 2.8.5+

/**
 * Execution audit event — append-only.
 * Never contains: broker tokens, full account IDs, raw portfolio, balances, passwords.
 */
export interface ExecutionAuditEvent {
  id: string;
  userId: string;
  tradePlanId: string;
  eventType: ExecutionAuditEventType;
  occurredAt: string; // ISO 8601
  provider?: string;
  /** Masked account reference only */
  accountRefMasked?: string;
  /** Safe metadata: no sensitive values */
  metadata: ExecutionAuditMetadata;
}

/**
 * Safe audit metadata fields.
 * Allowed: provider, planType, status, blockerCount, warningCount,
 *          hasFreshQuote, hasPermissions, durationMs.
 * Never: token, balance, position, userId beyond what's already in the event.
 */
export interface ExecutionAuditMetadata {
  provider?: string;
  planType?: string;
  status?: string;
  blockerCount?: number;
  warningCount?: number;
  hasFreshQuote?: boolean;
  hasPermissions?: boolean;
  durationMs?: number;
  executionMode?: ExecutionMode;
  [key: string]: string | number | boolean | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION HEALTH (Platform Health section)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionHealthState =
  | "DISABLED"
  | "SANDBOX_READY"
  | "DEGRADED"
  | "NOT_READY";
// Never: READY_FOR_LIVE_TRADING

export interface ExecutionHealthSummary {
  state: ExecutionHealthState;
  executionMode: ExecutionMode;
  executionEnabled: boolean;

  /** Aggregate metrics — no user PII, no balances, no positions */
  preflightRequests: number;
  preflightPasses: number;
  preflightFailures: number;
  brokerConnectionsAvailable: number;
  permissionsChecks: number;
  buyingPowerChecks: number;
  quoteChecks: number;
  lastPreflightAt?: string; // ISO 8601

  /** Per-provider availability */
  providerStatus: Record<string, "available" | "unavailable" | "unchecked">;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURE ARCHITECTURE (Sprint 2.8.1+)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execution state machine states.
 * DO NOT activate broker-dependent transitions before Sprint 2.8.5.
 *
 * Allowed transitions (enforced server-side only):
 * DRAFT_INTENT → PREFLIGHT_REQUIRED → PREFLIGHT_PASSED → CONFIRMATION_REQUIRED
 * → CONFIRMED → SUBMISSION_IN_PROGRESS → SUBMITTED → BROKER_ACCEPTED
 * → PARTIALLY_FILLED | FILLED | REJECTED
 * Any → CANCEL_PENDING → CANCELLED
 * Any → EXPIRED | FAILED
 *
 * State skipping is PROHIBITED. No DRAFT → SUBMITTED, no PREFLIGHT_REQUIRED → BROKER_ACCEPTED.
 */
export type ExecutionIntentState =
  | "DRAFT_INTENT"
  | "PREFLIGHT_REQUIRED"
  | "PREFLIGHT_PASSED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMED"
  | "SUBMISSION_IN_PROGRESS"
  | "SUBMITTED"
  | "BROKER_ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

/**
 * Execution intent — future architecture contract.
 * Documented in Sprint 2.8.0. Activated in Sprint 2.8.1.
 * Does NOT contain an order payload.
 */
export interface ExecutionIntent {
  id: string;
  userId: string;
  tradePlanId: string;
  preflightId: string;
  /** Server-authorized account reference only */
  selectedAccountRef: string;
  structureType: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 — short-lived
  confirmationState: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  status: ExecutionIntentState;
}

/**
 * Order preparation handoff contract — Sprint 2.8.1 interface.
 * Documented here for architecture continuity.
 * No order payload. 2.8.1 must revalidate preflight freshness before use.
 */
export interface OrderPreparationInput {
  tradePlanId: string;
  executionPreflightId: string;
  brokerProvider: string;
  /** Server-authorized account reference */
  brokerAccountRef: string;
  /** Reference to saved selected structure from Trade Plan */
  selectedStructureReference: string;
  userExecutionPreferences: Record<string, unknown>;
}

/**
 * Order idempotency architecture — Sprint 2.8.5 contract.
 * Documented in Sprint 2.8.0 for future consistency.
 *
 * Future order submission must have:
 *   clientIntentId        — client-generated
 *   server executionIntentId — server-generated
 *   broker clientOrderId  — where provider supports it
 *   idempotencyKey        — deterministic from: user + broker connection + account + tradePlan + structure + legs + quantity + intent version
 *   submissionFingerprint — hash of idempotencyKey
 *   duplicateSubmitLock   — persistent, not in-memory
 *   persistentSubmissionRecord — database row
 */
export interface FutureOrderIdempotencyDesign {
  clientIntentId: string;
  executionIntentId: string;
  brokerClientOrderId?: string;
  idempotencyKey: string;
  submissionFingerprint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER CAPABILITY MATRIX
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderCapabilityState = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

/**
 * Per-provider capability matrix.
 * Populate from actual integration code, not speculation.
 */
export interface ProviderCapabilityMatrix {
  provider: string;
  equity: ProviderCapabilityState;
  options: ProviderCapabilityState;
  multiLeg: ProviderCapabilityState;
  fractional: ProviderCapabilityState;
  marketOrder: ProviderCapabilityState;
  limitOrder: ProviderCapabilityState;
  stopOrder: ProviderCapabilityState;
  sandbox: ProviderCapabilityState;
  permissionsApi: ProviderCapabilityState;
  buyingPowerApi: ProviderCapabilityState;
  positionsApi: ProviderCapabilityState;
  quoteApi: ProviderCapabilityState;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRESHNESS THRESHOLDS (execution-grade, stricter than research)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical freshness thresholds for execution preflight.
 * Stricter than research freshness thresholds.
 * All values in seconds.
 */
export const EXECUTION_FRESHNESS_THRESHOLDS = {
  /** Maximum age of underlying quote for preflight PASS (60 seconds) */
  underlyingQuoteSec: 60,
  /** Maximum age of option quote for preflight PASS (120 seconds) */
  optionQuoteSec: 120,
  /** Maximum age of account data for preflight PASS (5 minutes) */
  accountDataSec: 300,
  /** Maximum age of buying power for preflight PASS (5 minutes) */
  buyingPowerSec: 300,
  /** Maximum age of position data for preflight PASS (2 minutes) */
  positionSec: 120,
  /** Maximum age of broker connection token check for preflight (10 minutes) */
  brokerConnectionSec: 600,
  /** Maximum age of risk analysis for preflight PASS (24 hours) */
  riskAnalysisSec: 86400,
  /** Maximum age of trade-plan lifecycle evaluation for preflight (1 hour) */
  lifecycleSec: 3600,
  /** How long a preflight PASS result is valid (5 minutes) */
  preflightResultSec: 300,
} as const;

export type ExecutionFreshnessThresholds = typeof EXECUTION_FRESHNESS_THRESHOLDS;

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical execution preflight disclaimer.
 * Must be displayed whenever preflight results are shown to users.
 */
export const EXECUTION_PREFLIGHT_DISCLAIMER =
  "Execution Preflight checks technical and account prerequisites that would need " +
  "to be satisfied before a future broker order could be prepared. A passing " +
  "preflight is not an investment recommendation, suitability determination, " +
  "guarantee of execution, or instruction to transact.";

/**
 * Quote disclosure for execution context.
 */
export const EXECUTION_QUOTE_DISCLOSURE =
  "Quotes may change before any future order is submitted. Execution will require " +
  "fresh quote validation.";

/**
 * Options risk disclosure for execution preflight.
 */
export const EXECUTION_OPTIONS_DISCLOSURE =
  "Broker permissions and buying-power requirements are broker-controlled. " +
  "Research calculations may differ from broker requirements. " +
  "Broker-reported requirements are authoritative at execution time.";

/**
 * Forbidden compliance phrases — must never appear in execution preflight UI or API.
 */
export const EXECUTION_FORBIDDEN_PHRASES = [
  "Trade Approved",
  "Approved Trade",
  "Ready to Trade",
  "Safe to Trade",
  "Recommended Order",
  "Guaranteed Fill",
  "Guaranteed Execution",
  "Best Order",
  "Best Broker",
  "Buy Now",
  "Sell Now",
  "Place Trade",
] as const;
