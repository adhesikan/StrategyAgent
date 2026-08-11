/**
 * shared/execution-intent-types.ts — Sprint 2.8.6
 *
 * Canonical types for Sandbox/Test-Account Broker Submission,
 * Execution Status, Fills & Position Linking.
 *
 * PERMANENT INVARIANTS:
 *   - PRODUCTION mode is BLOCKED in Sprint 2.8.6.
 *   - A confirmed snapshot hash may produce at most ONE broker mutation.
 *   - SUBMISSION_UNKNOWN on timeout/ambiguity — never auto-retry.
 *   - All submission must flow through the single submission endpoint.
 *   - AI tools and schedulers may never call the submission endpoint.
 */

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION MODE
// ─────────────────────────────────────────────────────────────────────────────

/** Runtime execution mode. Source: BROKER_EXECUTION_MODE env var. */
export type ExecutionIntentMode = "DISABLED" | "SANDBOX" | "TEST_LIVE" | "PRODUCTION";

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION INTENT STATE MACHINE (15 states)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionIntentState =
  | "INTENT_CREATED"
  | "FINAL_VALIDATION_IN_PROGRESS"
  | "FINAL_VALIDATION_FAILED"
  | "SANDBOX_SUBMISSION_IN_PROGRESS"
  | "SUBMISSION_IN_PROGRESS"
  | "BROKER_ACCEPTED"
  | "SUBMISSION_UNKNOWN"
  | "REJECTED"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED_AT_BROKER"
  | "POSITION_LINKED"
  | "ABANDONED";

/** Terminal states — no further transitions allowed. */
export const TERMINAL_EXECUTION_STATES = new Set<ExecutionIntentState>([
  "FINAL_VALIDATION_FAILED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED_AT_BROKER",
  "POSITION_LINKED",
  "ABANDONED",
]);

/** Allowed state transitions. Only listed next-states are permitted. */
export const ALLOWED_TRANSITIONS: Record<ExecutionIntentState, ReadonlyArray<ExecutionIntentState>> = {
  INTENT_CREATED:                  ["FINAL_VALIDATION_IN_PROGRESS"],
  FINAL_VALIDATION_IN_PROGRESS:    ["FINAL_VALIDATION_FAILED", "SANDBOX_SUBMISSION_IN_PROGRESS", "SUBMISSION_IN_PROGRESS"],
  FINAL_VALIDATION_FAILED:         [],
  SANDBOX_SUBMISSION_IN_PROGRESS:  ["BROKER_ACCEPTED", "SUBMISSION_UNKNOWN", "REJECTED"],
  SUBMISSION_IN_PROGRESS:          ["BROKER_ACCEPTED", "SUBMISSION_UNKNOWN", "REJECTED"],
  BROKER_ACCEPTED:                 ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED_AT_BROKER", "SUBMISSION_UNKNOWN"],
  SUBMISSION_UNKNOWN:              ["BROKER_ACCEPTED", "REJECTED", "ABANDONED"],
  REJECTED:                        [],
  OPEN:                            ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED_AT_BROKER"],
  PARTIALLY_FILLED:                ["FILLED", "CANCELLED"],
  FILLED:                          ["POSITION_LINKED"],
  CANCELLED:                       [],
  EXPIRED_AT_BROKER:               [],
  POSITION_LINKED:                 [],
  ABANDONED:                       [],
};

export function isAllowedTransition(from: ExecutionIntentState, to: ExecutionIntentState): boolean {
  return (ALLOWED_TRANSITIONS[from] as string[]).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL BROKER ORDER STATUS
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalBrokerOrderStatus =
  | "PENDING"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION INTENT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionIntent {
  id: string;
  userId: string;
  confirmationId: string;
  confirmationSnapshotHash: string;
  tradePlanId: string;
  provider: string;
  accountRef: string;
  accountRefMasked: string;
  executionMode: ExecutionIntentMode;
  state: ExecutionIntentState;
  idempotencyKey: string;
  submissionFingerprint: string | null;
  instrumentType: string;
  structureType: string;
  symbol: string;
  intentJson: ExecutionIntentOrderDetails;
  brokerOrderRef: string | null;
  clientOrderTag: string | null;
  filledQty: number | null;
  orderedQty: number | null;
  fillPrice: number | null;
  finalValidationAt: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  reconciledAt: string | null;
  filledAt: string | null;
  linkedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Order details embedded in the intent — extracted from the confirmed order draft. */
export interface ExecutionIntentOrderDetails {
  side: "buy" | "sell";
  quantity: number;
  /** limit, stop, stop_limit. Market orders are BANNED in TEST_LIVE. */
  orderType: "market" | "limit" | "stop" | "stop_limit";
  limitPrice: number | null;
  stopPrice: number | null;
  duration: "day" | "gtc";
  estimatedNotional: number | null;
  /** For options */
  optionSymbol?: string;
  optionSide?: "buy_to_open" | "buy_to_close" | "sell_to_open" | "sell_to_close";
  /** For multi-leg (NOT supported in TEST_LIVE) */
  legs?: ExecutionIntentLeg[];
}

export interface ExecutionIntentLeg {
  contractSymbol: string;
  optionSide: "buy_to_open" | "buy_to_close" | "sell_to_open" | "sell_to_close";
  quantity: number;
  limitPrice: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION FILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionFill {
  id: string;
  executionIntentId: string;
  userId: string;
  fillSequence: number;
  orderedQty: number;
  filledQty: number;
  remainingQty: number;
  fillPrice: number | null;
  fillAt: string;
  commission: number | null;
  fees: number | null;
  brokerFillId: string | null;
  rawStatusFromBroker: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION POSITION LINK
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionPositionLink {
  id: string;
  executionIntentId: string;
  userId: string;
  portfolioId: string | null;
  symbol: string;
  linkStrategy: "broker_sync" | "manual" | "estimated";
  linkedAt: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION SUBMISSION ATTEMPT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionSubmissionAttempt {
  id: string;
  executionIntentId: string;
  userId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  outcome: "BROKER_ACCEPTED" | "REJECTED" | "SUBMISSION_UNKNOWN" | "IN_PROGRESS" | "SUPERSEDED";
  brokerOrderRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  timeoutMs: number;
  timedOut: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER ORDER ACKNOWLEDGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerOrderAcknowledgement {
  brokerOrderRef: string;
  clientOrderTag: string | null;
  status: CanonicalBrokerOrderStatus;
  acknowledgedAt: string;
  rawStatus: string;
  provider: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL VALIDATION RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalValidationResult {
  valid: boolean;
  blockers: FinalValidationBlocker[];
  checkedAt: string;
}

export interface FinalValidationBlocker {
  check: string;
  errorCode: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST_LIVE SAFETY GATE RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface TestLiveSafetyGateResult {
  open: boolean;
  failedGates: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION FINGERPRINT
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmissionFingerprintInput {
  instrumentType: string;
  structureType: string;
  symbol: string;
  side: string;
  quantity: number;
  orderType: string;
  limitPrice: number | null;
  duration: string;
  accountRef: string;
  provider: string;
  executionMode: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES (EI_* prefix)
// ─────────────────────────────────────────────────────────────────────────────

export const EI_CONFIRMATION_NOT_FOUND            = "EI_CONFIRMATION_NOT_FOUND";
export const EI_CONFIRMATION_NOT_CONFIRMED        = "EI_CONFIRMATION_NOT_CONFIRMED";
export const EI_CONFIRMATION_HASH_MISMATCH        = "EI_CONFIRMATION_HASH_MISMATCH";
export const EI_CONFIRMATION_SNAPSHOT_EXPIRED     = "EI_CONFIRMATION_SNAPSHOT_EXPIRED";
export const EI_CONFIRMATION_ALREADY_USED         = "EI_CONFIRMATION_ALREADY_USED";
export const EI_INTENT_NOT_FOUND                  = "EI_INTENT_NOT_FOUND";
export const EI_INVALID_STATE_TRANSITION          = "EI_INVALID_STATE_TRANSITION";
export const EI_WRONG_STATE_FOR_SUBMIT            = "EI_WRONG_STATE_FOR_SUBMIT";
export const EI_KILL_SWITCH_ACTIVE                = "EI_KILL_SWITCH_ACTIVE";
export const EI_EXECUTION_DISABLED                = "EI_EXECUTION_DISABLED";
export const EI_PRODUCTION_NOT_ENABLED            = "EI_PRODUCTION_NOT_ENABLED";
export const EI_TEST_LIVE_NOT_ARMED               = "EI_TEST_LIVE_NOT_ARMED";
export const EI_TEST_LIVE_ARMING_EXPIRED          = "EI_TEST_LIVE_ARMING_EXPIRED";
export const EI_ACCOUNT_NOT_ALLOWLISTED           = "EI_ACCOUNT_NOT_ALLOWLISTED";
export const EI_SYMBOL_NOT_ALLOWLISTED            = "EI_SYMBOL_NOT_ALLOWLISTED";
export const EI_NOTIONAL_EXCEEDS_CAP              = "EI_NOTIONAL_EXCEEDS_CAP";
export const EI_EQUITY_QTY_EXCEEDS_CAP            = "EI_EQUITY_QTY_EXCEEDS_CAP";
export const EI_OPTION_CONTRACTS_EXCEEDS_CAP      = "EI_OPTION_CONTRACTS_EXCEEDS_CAP";
export const EI_MARKET_ORDER_BANNED_IN_TEST_LIVE  = "EI_MARKET_ORDER_BANNED_IN_TEST_LIVE";
export const EI_MULTI_LEG_BANNED_IN_TEST_LIVE     = "EI_MULTI_LEG_BANNED_IN_TEST_LIVE";
export const EI_BROKER_NOT_CONNECTED              = "EI_BROKER_NOT_CONNECTED";
export const EI_PROVIDER_MISMATCH                 = "EI_PROVIDER_MISMATCH";
export const EI_ACCOUNT_MISMATCH                  = "EI_ACCOUNT_MISMATCH";
export const EI_FINAL_VALIDATION_FAILED           = "EI_FINAL_VALIDATION_FAILED";
export const EI_SUBMISSION_UNKNOWN                = "EI_SUBMISSION_UNKNOWN";
export const EI_BROKER_REJECTED                   = "EI_BROKER_REJECTED";
export const EI_IDEMPOTENCY_VIOLATION             = "EI_IDEMPOTENCY_VIOLATION";
export const EI_DUPLICATE_SUBMISSION              = "EI_DUPLICATE_SUBMISSION";
export const EI_OWNERSHIP_VIOLATION               = "EI_OWNERSHIP_VIOLATION";
export const EI_FORBIDDEN_FIELD                   = "EI_FORBIDDEN_FIELD";
export const EI_AI_SUBMISSION_BLOCKED             = "EI_AI_SUBMISSION_BLOCKED";
export const EI_PROVIDER_NOT_SUPPORTED            = "EI_PROVIDER_NOT_SUPPORTED";
export const EI_CONCURRENT_SUBMISSION             = "EI_CONCURRENT_SUBMISSION";

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

export const FORBIDDEN_INTENT_CLIENT_FIELDS = [
  "brokerPayload", "rawOrder", "accountId", "legs", "quantity", "price",
  "side", "symbol", "forceSubmit", "skipValidation", "retry", "mode",
  "testAccount", "overrideMode", "bypassGate", "production", "live",
];

/**
 * PRODUCTION_SUBMISSION_NOT_ENABLED — compile-time invariant for Sprint 2.8.6.
 * General customer production execution remains blocked.
 */
export const PRODUCTION_SUBMISSION_NOT_ENABLED: true = true;

export const EXECUTION_INTENT_COMPLIANCE_LABELS: Record<string, string> = {
  SANDBOX:   "Paper Trading",
  TEST_LIVE: "Live Test Account",
  DISABLED:  "Disabled",
  PRODUCTION: "Production (Blocked)",
};

export const SUBMISSION_UNKNOWN_USER_MESSAGE =
  "The broker connection timed out or returned an ambiguous response. " +
  "Your order may or may not have been placed. Do NOT submit again. " +
  "Check your broker account directly to confirm the order status, then use Reconcile.";

export const TEST_LIVE_DISCLAIMER =
  "This order will be submitted to a REAL brokerage account using real money. " +
  "Only test-authorized accounts and symbols are permitted. " +
  "This is not investment advice.";
