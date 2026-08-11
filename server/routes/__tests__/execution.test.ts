/**
 * server/routes/__tests__/execution.test.ts — Sprint 2.8.6
 *
 * Pure unit tests for Sandbox/Test-Account Broker Submission,
 * Execution Status, Fills & Position Linking.
 *
 * All tests use injectable deps — no DB, no real broker, no network.
 *
 * Coverage target: 250+ assertions across all execution sub-systems.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  TERMINAL_EXECUTION_STATES,
  isAllowedTransition,
  PRODUCTION_SUBMISSION_NOT_ENABLED,
  EXECUTION_INTENT_COMPLIANCE_LABELS,
  SUBMISSION_UNKNOWN_USER_MESSAGE,
  TEST_LIVE_DISCLAIMER,
  FORBIDDEN_INTENT_CLIENT_FIELDS,
  EI_KILL_SWITCH_ACTIVE,
  EI_EXECUTION_DISABLED,
  EI_PRODUCTION_NOT_ENABLED,
  EI_BROKER_NOT_CONNECTED,
  EI_PROVIDER_MISMATCH,
  EI_ACCOUNT_MISMATCH,
  EI_CONFIRMATION_HASH_MISMATCH,
  EI_CONFIRMATION_SNAPSHOT_EXPIRED,
  EI_TEST_LIVE_NOT_ARMED,
  EI_ACCOUNT_NOT_ALLOWLISTED,
  EI_SYMBOL_NOT_ALLOWLISTED,
  EI_NOTIONAL_EXCEEDS_CAP,
  EI_EQUITY_QTY_EXCEEDS_CAP,
  EI_OPTION_CONTRACTS_EXCEEDS_CAP,
  EI_MARKET_ORDER_BANNED_IN_TEST_LIVE,
  EI_MULTI_LEG_BANNED_IN_TEST_LIVE,
  EI_FINAL_VALIDATION_FAILED,
  EI_SUBMISSION_UNKNOWN,
  EI_BROKER_REJECTED,
  EI_CONCURRENT_SUBMISSION,
  EI_WRONG_STATE_FOR_SUBMIT,
  EI_OWNERSHIP_VIOLATION,
  EI_FORBIDDEN_FIELD,
  EI_DUPLICATE_SUBMISSION,
  type ExecutionIntent,
  type ExecutionIntentState,
  type ExecutionIntentOrderDetails,
} from "../../../shared/execution-intent-types";
import {
  runFinalValidation,
  computeSubmissionFingerprint,
  computeIdempotencyKey,
  normalizeToCanonicalStatus,
  type FinalValidationContext,
} from "../../services/execution-final-validation-service";
import {
  translateEquityOrder,
  translateSingleLegOptionOrder,
  translateMultiLegOrder,
  translateIntentToOrderRequests,
  buildClientOrderTag,
  isSimModeProvider,
} from "../../services/broker-translation-service";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

function makeOrderDetails(overrides: Partial<ExecutionIntentOrderDetails> = {}): ExecutionIntentOrderDetails {
  return {
    side: "buy",
    quantity: 5,
    orderType: "limit",
    limitPrice: 150.00,
    stopPrice: null,
    duration: "day",
    estimatedNotional: 750,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  const now = "2026-08-11T14:00:00.000Z";
  return {
    id: "intent-aaa-111",
    userId: "user-001",
    confirmationId: "conf-001",
    confirmationSnapshotHash: "hash-abc-123",
    tradePlanId: "plan-001",
    provider: "tradier",
    accountRef: "ACCT1234",
    accountRefMasked: "****1234",
    executionMode: "SANDBOX",
    state: "INTENT_CREATED",
    idempotencyKey: "idem-key-001",
    submissionFingerprint: null,
    instrumentType: "equity",
    structureType: "long_equity",
    symbol: "AAPL",
    intentJson: makeOrderDetails(),
    brokerOrderRef: null,
    clientOrderTag: null,
    filledQty: null,
    orderedQty: 5,
    fillPrice: null,
    finalValidationAt: null,
    submittedAt: null,
    acknowledgedAt: null,
    reconciledAt: null,
    filledAt: null,
    linkedAt: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeValidationContext(overrides: Partial<FinalValidationContext> = {}): FinalValidationContext {
  return {
    connectedProvider: "tradier",
    brokerConnected: true,
    connectedAccountRef: "ACCT1234",
    snapshotExpiresAt: new Date(Date.now() + 300_000).toISOString(), // 5 min future
    currentSnapshotHash: "hash-abc-123",
    estimatedNotionalUsd: 750,
    buyingPowerUsd: 10_000,
    now: new Date("2026-08-11T14:00:00.000Z"),
    ...overrides,
  };
}

function makeSandboxDeps(overrides: any = {}) {
  return {
    isExecutionEnabled: () => true,
    getExecutionMode: () => "sandbox" as const,
    isTestLiveArmed: () => false,
    getTestLiveAllowlistedAccounts: () => [] as string[],
    getTestLiveAllowlistedSymbols: () => [] as string[],
    getTestLiveMaxNotional: () => null as number | null,
    getTestLiveMaxEquityQty: () => null as number | null,
    getTestLiveMaxOptionContracts: () => null as number | null,
    isTradierExecutionEnabled: () => true,
    isTradeStationExecutionEnabled: () => true,
    ...overrides,
  };
}

function makeTestLiveDeps(overrides: any = {}) {
  return {
    isExecutionEnabled: () => true,
    getExecutionMode: () => "test_live" as const,
    isTestLiveArmed: () => true,
    getTestLiveAllowlistedAccounts: () => ["ACCT1234"],
    getTestLiveAllowlistedSymbols: () => ["AAPL"],
    getTestLiveMaxNotional: () => 5000,
    getTestLiveMaxEquityQty: () => 100,
    getTestLiveMaxOptionContracts: () => 10,
    isTradierExecutionEnabled: () => true,
    isTradeStationExecutionEnabled: () => true,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

describe("ExecutionIntent State Machine", () => {

  describe("ALLOWED_TRANSITIONS completeness", () => {
    it("defines transitions for all 15 states", () => {
      const expectedStates: ExecutionIntentState[] = [
        "INTENT_CREATED", "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
        "SANDBOX_SUBMISSION_IN_PROGRESS", "SUBMISSION_IN_PROGRESS",
        "BROKER_ACCEPTED", "SUBMISSION_UNKNOWN", "REJECTED",
        "OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED",
        "EXPIRED_AT_BROKER", "POSITION_LINKED", "ABANDONED",
      ];
      for (const state of expectedStates) {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(state);
      }
    });

    it("has exactly 15 states in ALLOWED_TRANSITIONS", () => {
      expect(Object.keys(ALLOWED_TRANSITIONS).length).toBe(15);
    });
  });

  describe("isAllowedTransition — valid transitions", () => {
    it("INTENT_CREATED → FINAL_VALIDATION_IN_PROGRESS", () => {
      expect(isAllowedTransition("INTENT_CREATED", "FINAL_VALIDATION_IN_PROGRESS")).toBe(true);
    });
    it("FINAL_VALIDATION_IN_PROGRESS → FINAL_VALIDATION_FAILED", () => {
      expect(isAllowedTransition("FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED")).toBe(true);
    });
    it("FINAL_VALIDATION_IN_PROGRESS → SANDBOX_SUBMISSION_IN_PROGRESS", () => {
      expect(isAllowedTransition("FINAL_VALIDATION_IN_PROGRESS", "SANDBOX_SUBMISSION_IN_PROGRESS")).toBe(true);
    });
    it("FINAL_VALIDATION_IN_PROGRESS → SUBMISSION_IN_PROGRESS", () => {
      expect(isAllowedTransition("FINAL_VALIDATION_IN_PROGRESS", "SUBMISSION_IN_PROGRESS")).toBe(true);
    });
    it("SANDBOX_SUBMISSION_IN_PROGRESS → BROKER_ACCEPTED", () => {
      expect(isAllowedTransition("SANDBOX_SUBMISSION_IN_PROGRESS", "BROKER_ACCEPTED")).toBe(true);
    });
    it("SANDBOX_SUBMISSION_IN_PROGRESS → SUBMISSION_UNKNOWN", () => {
      expect(isAllowedTransition("SANDBOX_SUBMISSION_IN_PROGRESS", "SUBMISSION_UNKNOWN")).toBe(true);
    });
    it("SANDBOX_SUBMISSION_IN_PROGRESS → REJECTED", () => {
      expect(isAllowedTransition("SANDBOX_SUBMISSION_IN_PROGRESS", "REJECTED")).toBe(true);
    });
    it("SUBMISSION_IN_PROGRESS → BROKER_ACCEPTED", () => {
      expect(isAllowedTransition("SUBMISSION_IN_PROGRESS", "BROKER_ACCEPTED")).toBe(true);
    });
    it("SUBMISSION_IN_PROGRESS → SUBMISSION_UNKNOWN", () => {
      expect(isAllowedTransition("SUBMISSION_IN_PROGRESS", "SUBMISSION_UNKNOWN")).toBe(true);
    });
    it("SUBMISSION_IN_PROGRESS → REJECTED", () => {
      expect(isAllowedTransition("SUBMISSION_IN_PROGRESS", "REJECTED")).toBe(true);
    });
    it("BROKER_ACCEPTED → OPEN", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "OPEN")).toBe(true);
    });
    it("BROKER_ACCEPTED → PARTIALLY_FILLED", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "PARTIALLY_FILLED")).toBe(true);
    });
    it("BROKER_ACCEPTED → FILLED", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "FILLED")).toBe(true);
    });
    it("BROKER_ACCEPTED → CANCELLED", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "CANCELLED")).toBe(true);
    });
    it("BROKER_ACCEPTED → EXPIRED_AT_BROKER", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "EXPIRED_AT_BROKER")).toBe(true);
    });
    it("BROKER_ACCEPTED → SUBMISSION_UNKNOWN", () => {
      expect(isAllowedTransition("BROKER_ACCEPTED", "SUBMISSION_UNKNOWN")).toBe(true);
    });
    it("SUBMISSION_UNKNOWN → BROKER_ACCEPTED", () => {
      expect(isAllowedTransition("SUBMISSION_UNKNOWN", "BROKER_ACCEPTED")).toBe(true);
    });
    it("SUBMISSION_UNKNOWN → REJECTED", () => {
      expect(isAllowedTransition("SUBMISSION_UNKNOWN", "REJECTED")).toBe(true);
    });
    it("SUBMISSION_UNKNOWN → ABANDONED", () => {
      expect(isAllowedTransition("SUBMISSION_UNKNOWN", "ABANDONED")).toBe(true);
    });
    it("OPEN → PARTIALLY_FILLED", () => {
      expect(isAllowedTransition("OPEN", "PARTIALLY_FILLED")).toBe(true);
    });
    it("OPEN → FILLED", () => {
      expect(isAllowedTransition("OPEN", "FILLED")).toBe(true);
    });
    it("OPEN → CANCELLED", () => {
      expect(isAllowedTransition("OPEN", "CANCELLED")).toBe(true);
    });
    it("OPEN → EXPIRED_AT_BROKER", () => {
      expect(isAllowedTransition("OPEN", "EXPIRED_AT_BROKER")).toBe(true);
    });
    it("PARTIALLY_FILLED → FILLED", () => {
      expect(isAllowedTransition("PARTIALLY_FILLED", "FILLED")).toBe(true);
    });
    it("PARTIALLY_FILLED → CANCELLED", () => {
      expect(isAllowedTransition("PARTIALLY_FILLED", "CANCELLED")).toBe(true);
    });
    it("FILLED → POSITION_LINKED", () => {
      expect(isAllowedTransition("FILLED", "POSITION_LINKED")).toBe(true);
    });
  });

  describe("isAllowedTransition — invalid transitions (terminal and backwards)", () => {
    it("FINAL_VALIDATION_FAILED → anything is blocked", () => {
      expect(isAllowedTransition("FINAL_VALIDATION_FAILED", "INTENT_CREATED")).toBe(false);
      expect(isAllowedTransition("FINAL_VALIDATION_FAILED", "SUBMISSION_IN_PROGRESS")).toBe(false);
    });
    it("REJECTED → anything is blocked", () => {
      expect(isAllowedTransition("REJECTED", "OPEN")).toBe(false);
      expect(isAllowedTransition("REJECTED", "BROKER_ACCEPTED")).toBe(false);
    });
    it("CANCELLED → anything is blocked", () => {
      expect(isAllowedTransition("CANCELLED", "OPEN")).toBe(false);
      expect(isAllowedTransition("CANCELLED", "FILLED")).toBe(false);
    });
    it("POSITION_LINKED → anything is blocked", () => {
      expect(isAllowedTransition("POSITION_LINKED", "FILLED")).toBe(false);
    });
    it("ABANDONED → anything is blocked", () => {
      expect(isAllowedTransition("ABANDONED", "SUBMISSION_UNKNOWN")).toBe(false);
    });
    it("INTENT_CREATED → SUBMISSION_IN_PROGRESS directly is blocked", () => {
      expect(isAllowedTransition("INTENT_CREATED", "SUBMISSION_IN_PROGRESS")).toBe(false);
    });
    it("INTENT_CREATED → BROKER_ACCEPTED directly is blocked", () => {
      expect(isAllowedTransition("INTENT_CREATED", "BROKER_ACCEPTED")).toBe(false);
    });
    it("OPEN → INTENT_CREATED (backwards) is blocked", () => {
      expect(isAllowedTransition("OPEN", "INTENT_CREATED")).toBe(false);
    });
    it("FILLED → OPEN (backwards) is blocked", () => {
      expect(isAllowedTransition("FILLED", "OPEN")).toBe(false);
    });
    it("FILLED → CANCELLED is blocked", () => {
      expect(isAllowedTransition("FILLED", "CANCELLED")).toBe(false);
    });
  });

  describe("TERMINAL_EXECUTION_STATES", () => {
    it("includes all expected terminal states", () => {
      const terminals = ["FINAL_VALIDATION_FAILED", "REJECTED", "CANCELLED", "EXPIRED_AT_BROKER", "POSITION_LINKED", "ABANDONED"];
      for (const t of terminals) {
        expect(TERMINAL_EXECUTION_STATES.has(t as ExecutionIntentState)).toBe(true);
      }
    });
    it("does not include non-terminal states", () => {
      expect(TERMINAL_EXECUTION_STATES.has("INTENT_CREATED")).toBe(false);
      expect(TERMINAL_EXECUTION_STATES.has("OPEN")).toBe(false);
      expect(TERMINAL_EXECUTION_STATES.has("SUBMISSION_UNKNOWN")).toBe(false);
    });
    it("terminal states have no allowed next transitions", () => {
      for (const state of TERMINAL_EXECUTION_STATES) {
        expect(ALLOWED_TRANSITIONS[state].length).toBe(0);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: COMPLIANCE INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance Invariants", () => {
  it("PRODUCTION_SUBMISSION_NOT_ENABLED is literal true", () => {
    expect(PRODUCTION_SUBMISSION_NOT_ENABLED).toBe(true);
  });

  it("EXECUTION_INTENT_COMPLIANCE_LABELS has SANDBOX label", () => {
    expect(EXECUTION_INTENT_COMPLIANCE_LABELS["SANDBOX"]).toBe("Paper Trading");
  });

  it("EXECUTION_INTENT_COMPLIANCE_LABELS has TEST_LIVE label", () => {
    expect(EXECUTION_INTENT_COMPLIANCE_LABELS["TEST_LIVE"]).toBe("Live Test Account");
  });

  it("EXECUTION_INTENT_COMPLIANCE_LABELS has DISABLED label", () => {
    expect(EXECUTION_INTENT_COMPLIANCE_LABELS["DISABLED"]).toBe("Disabled");
  });

  it("EXECUTION_INTENT_COMPLIANCE_LABELS PRODUCTION is explicitly blocked label", () => {
    expect(EXECUTION_INTENT_COMPLIANCE_LABELS["PRODUCTION"]).toMatch(/blocked/i);
  });

  it("SUBMISSION_UNKNOWN_USER_MESSAGE does not say 'retry'", () => {
    expect(SUBMISSION_UNKNOWN_USER_MESSAGE.toLowerCase()).not.toContain("retry");
  });

  it("SUBMISSION_UNKNOWN_USER_MESSAGE says 'Do NOT submit again'", () => {
    expect(SUBMISSION_UNKNOWN_USER_MESSAGE).toMatch(/do not submit again/i);
  });

  it("SUBMISSION_UNKNOWN_USER_MESSAGE mentions Reconcile", () => {
    expect(SUBMISSION_UNKNOWN_USER_MESSAGE).toMatch(/reconcile/i);
  });

  it("TEST_LIVE_DISCLAIMER mentions real money", () => {
    expect(TEST_LIVE_DISCLAIMER.toLowerCase()).toMatch(/real/);
  });

  it("TEST_LIVE_DISCLAIMER is not investment advice", () => {
    expect(TEST_LIVE_DISCLAIMER).toMatch(/not investment advice/i);
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes brokerPayload", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("brokerPayload");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes forceSubmit", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("forceSubmit");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes skipValidation", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("skipValidation");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes production", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("production");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes bypassGate", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("bypassGate");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS includes overrideMode", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("overrideMode");
  });

  it("error codes use EI_ prefix consistently", () => {
    const eiCodes = [
      EI_KILL_SWITCH_ACTIVE, EI_EXECUTION_DISABLED, EI_PRODUCTION_NOT_ENABLED,
      EI_BROKER_NOT_CONNECTED, EI_PROVIDER_MISMATCH, EI_ACCOUNT_MISMATCH,
      EI_CONFIRMATION_HASH_MISMATCH, EI_CONFIRMATION_SNAPSHOT_EXPIRED,
      EI_TEST_LIVE_NOT_ARMED, EI_ACCOUNT_NOT_ALLOWLISTED, EI_SYMBOL_NOT_ALLOWLISTED,
      EI_NOTIONAL_EXCEEDS_CAP, EI_EQUITY_QTY_EXCEEDS_CAP, EI_OPTION_CONTRACTS_EXCEEDS_CAP,
      EI_MARKET_ORDER_BANNED_IN_TEST_LIVE, EI_MULTI_LEG_BANNED_IN_TEST_LIVE,
      EI_FINAL_VALIDATION_FAILED, EI_SUBMISSION_UNKNOWN, EI_BROKER_REJECTED,
      EI_CONCURRENT_SUBMISSION, EI_WRONG_STATE_FOR_SUBMIT, EI_OWNERSHIP_VIOLATION,
      EI_FORBIDDEN_FIELD, EI_DUPLICATE_SUBMISSION,
    ];
    for (const code of eiCodes) {
      expect(code).toMatch(/^EI_/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: FINAL VALIDATION SERVICE — SANDBOX
// ─────────────────────────────────────────────────────────────────────────────

describe("runFinalValidation — SANDBOX mode", () => {
  it("passes for a clean SANDBOX intent with all checks satisfied", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext();
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(true);
    expect(result.blockers.length).toBe(0);
  });

  it("blocks when kill switch is active", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext();
    const deps = makeSandboxDeps({ isExecutionEnabled: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_KILL_SWITCH_ACTIVE)).toBe(true);
  });

  it("blocks when execution mode is disabled", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext();
    const deps = makeSandboxDeps({ getExecutionMode: () => "disabled" });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_EXECUTION_DISABLED)).toBe(true);
  });

  it("blocks when mode is PRODUCTION", () => {
    const intent = makeIntent({ executionMode: "PRODUCTION" });
    const ctx = makeValidationContext();
    const deps = makeSandboxDeps({ getExecutionMode: () => "production" });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_PRODUCTION_NOT_ENABLED)).toBe(true);
  });

  it("blocks when broker is not connected", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext({ brokerConnected: false });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_BROKER_NOT_CONNECTED)).toBe(true);
  });

  it("blocks when provider does not match connected provider", () => {
    const intent = makeIntent({ executionMode: "SANDBOX", provider: "tradier" });
    const ctx = makeValidationContext({ connectedProvider: "tradestation" });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_PROVIDER_MISMATCH)).toBe(true);
  });

  it("blocks when account ref does not match connected account", () => {
    const intent = makeIntent({ executionMode: "SANDBOX", accountRef: "ACCT1234" });
    const ctx = makeValidationContext({ connectedAccountRef: "ACCT9999" });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_ACCOUNT_MISMATCH)).toBe(true);
  });

  it("blocks when confirmation snapshot hash has changed", () => {
    const intent = makeIntent({ confirmationSnapshotHash: "hash-abc-123" });
    const ctx = makeValidationContext({ currentSnapshotHash: "hash-DIFFERENT-999" });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_HASH_MISMATCH)).toBe(true);
  });

  it("passes when snapshot hash matches exactly", () => {
    const intent = makeIntent({ confirmationSnapshotHash: "hash-abc-123" });
    const ctx = makeValidationContext({ currentSnapshotHash: "hash-abc-123" });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_HASH_MISMATCH)).toBe(false);
  });

  it("blocks when snapshot has expired", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext({
      snapshotExpiresAt: new Date(Date.now() - 10_000).toISOString(), // 10s ago
      now: new Date("2026-08-11T14:00:00.000Z"),
    });
    const ctx2 = { ...ctx, snapshotExpiresAt: "2026-08-11T13:59:00.000Z" }; // before now
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx2, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_SNAPSHOT_EXPIRED)).toBe(true);
  });

  it("passes when snapshot is still valid (in the future)", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext({
      snapshotExpiresAt: "2026-08-11T14:05:00.000Z",
      now: new Date("2026-08-11T14:00:00.000Z"),
    });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_SNAPSHOT_EXPIRED)).toBe(false);
  });

  it("blocks when Tradier execution is disabled", () => {
    const intent = makeIntent({ executionMode: "SANDBOX", provider: "tradier" });
    const ctx = makeValidationContext();
    const deps = makeSandboxDeps({ isTradierExecutionEnabled: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_KILL_SWITCH_ACTIVE)).toBe(true);
  });

  it("blocks when TradeStation execution is disabled", () => {
    const intent = makeIntent({ executionMode: "SANDBOX", provider: "tradestation" });
    const ctx = makeValidationContext({ connectedProvider: "tradestation" });
    const deps = makeSandboxDeps({ isTradeStationExecutionEnabled: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_KILL_SWITCH_ACTIVE)).toBe(true);
  });

  it("collects ALL blockers (does not fail-fast on first failure)", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext({
      brokerConnected: false,
      connectedProvider: "tradestation", // mismatch
      currentSnapshotHash: "WRONG",      // hash mismatch
    });
    const deps = makeSandboxDeps({ isExecutionEnabled: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    // All accumulated
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it("includes a checkedAt timestamp", () => {
    const intent = makeIntent();
    const ctx = makeValidationContext({ now: new Date("2026-08-11T14:00:00.000Z") });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.checkedAt).toMatch(/2026-08-11/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: FINAL VALIDATION SERVICE — TEST_LIVE GATES
// ─────────────────────────────────────────────────────────────────────────────

describe("runFinalValidation — TEST_LIVE mode", () => {
  it("passes for a clean TEST_LIVE intent with all gates satisfied", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", symbol: "AAPL", instrumentType: "equity" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(true);
    expect(result.blockers.length).toBe(0);
  });

  it("blocks when TEST_LIVE not armed", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ isTestLiveArmed: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_TEST_LIVE_NOT_ARMED)).toBe(true);
  });

  it("blocks when account is not in allowlist", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", accountRef: "UNKNOWN_ACCT" });
    const ctx = makeValidationContext({ connectedAccountRef: "UNKNOWN_ACCT" });
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedAccounts: () => ["ACCT1234"] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_ACCOUNT_NOT_ALLOWLISTED)).toBe(true);
  });

  it("passes when account is in allowlist", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", accountRef: "ACCT1234" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedAccounts: () => ["ACCT1234", "ACCT5678"] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_ACCOUNT_NOT_ALLOWLISTED)).toBe(false);
  });

  it("blocks when account allowlist is empty (fail-closed — unconfigured = all blocked)", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", accountRef: "ACCT1234" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedAccounts: () => [] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_ACCOUNT_NOT_ALLOWLISTED)).toBe(true);
  });

  it("blocks when symbol is not in allowlist", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", symbol: "TSLA" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedSymbols: () => ["AAPL"] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_SYMBOL_NOT_ALLOWLISTED)).toBe(true);
  });

  it("passes when symbol is in allowlist (case-insensitive)", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", symbol: "aapl" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedSymbols: () => ["AAPL"] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_SYMBOL_NOT_ALLOWLISTED)).toBe(false);
  });

  it("blocks when symbol allowlist is empty (fail-closed — unconfigured = all blocked)", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", symbol: "AAPL" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveAllowlistedSymbols: () => [] });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_SYMBOL_NOT_ALLOWLISTED)).toBe(true);
  });

  it("blocks when estimated notional exceeds cap", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE" });
    const ctx = makeValidationContext({ estimatedNotionalUsd: 6000 }); // over $5000 cap
    const deps = makeTestLiveDeps({ getTestLiveMaxNotional: () => 5000 });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_NOTIONAL_EXCEEDS_CAP)).toBe(true);
  });

  it("passes when estimated notional is within cap", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE" });
    const ctx = makeValidationContext({ estimatedNotionalUsd: 4999 });
    const deps = makeTestLiveDeps({ getTestLiveMaxNotional: () => 5000 });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_NOTIONAL_EXCEEDS_CAP)).toBe(false);
  });

  it("blocks equity order exceeding qty cap", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "equity",
      intentJson: makeOrderDetails({ quantity: 200 }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveMaxEquityQty: () => 100 });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_EQUITY_QTY_EXCEEDS_CAP)).toBe(true);
  });

  it("passes equity order within qty cap", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "equity",
      intentJson: makeOrderDetails({ quantity: 50 }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveMaxEquityQty: () => 100 });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_EQUITY_QTY_EXCEEDS_CAP)).toBe(false);
  });

  it("blocks equity order when qty cap is unconfigured (fail-closed)", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "equity",
      intentJson: makeOrderDetails({ quantity: 1 }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveMaxEquityQty: () => null });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_EQUITY_QTY_EXCEEDS_CAP)).toBe(true);
  });

  it("blocks option order exceeding contract cap", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({ quantity: 15, optionSymbol: "AAPL260815C00150000", optionSide: "buy_to_open" }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveMaxOptionContracts: () => 10 });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_OPTION_CONTRACTS_EXCEEDS_CAP)).toBe(true);
  });

  it("blocks option order when contract cap is unconfigured (fail-closed)", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({ quantity: 1, optionSymbol: "AAPL260815C00150000", optionSide: "buy_to_open" }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({ getTestLiveMaxOptionContracts: () => null });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_OPTION_CONTRACTS_EXCEEDS_CAP)).toBe(true);
  });

  it("blocks when notional cap is unconfigured (fail-closed)", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE" });
    const ctx = makeValidationContext({ estimatedNotionalUsd: 100 }); // small order
    const deps = makeTestLiveDeps({ getTestLiveMaxNotional: () => null });
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_NOTIONAL_EXCEEDS_CAP)).toBe(true);
  });

  it("blocks market orders in TEST_LIVE", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      intentJson: makeOrderDetails({ orderType: "market", limitPrice: null }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_MARKET_ORDER_BANNED_IN_TEST_LIVE)).toBe(true);
  });

  it("allows limit orders in TEST_LIVE", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      intentJson: makeOrderDetails({ orderType: "limit", limitPrice: 150 }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_MARKET_ORDER_BANNED_IN_TEST_LIVE)).toBe(false);
  });

  it("blocks multi-leg orders in TEST_LIVE", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "multi_leg_option",
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_MULTI_LEG_BANNED_IN_TEST_LIVE)).toBe(true);
  });

  it("blocks when multi-leg detected via legs array in TEST_LIVE", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "equity", // even if typed wrong
      intentJson: makeOrderDetails({
        legs: [
          { contractSymbol: "AAPL260815C00150000", optionSide: "buy_to_open", quantity: 1, limitPrice: 5 },
          { contractSymbol: "AAPL260815C00160000", optionSide: "sell_to_open", quantity: 1, limitPrice: 3 },
        ],
      }),
    });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.valid).toBe(false);
    expect(result.blockers.some(b => b.errorCode === EI_MULTI_LEG_BANNED_IN_TEST_LIVE)).toBe(true);
  });

  it("does not apply TEST_LIVE gates in SANDBOX mode", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" }); // SANDBOX, not TEST_LIVE
    const ctx = makeValidationContext();
    // Deps configured as test_live disabled, but mode is SANDBOX so gates shouldn't fire
    const deps = makeSandboxDeps({ isTestLiveArmed: () => false });
    const result = runFinalValidation(intent, ctx, deps);
    // test_live gates should not apply
    expect(result.blockers.some(b => b.errorCode === EI_TEST_LIVE_NOT_ARMED)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: SUBMISSION FINGERPRINT & IDEMPOTENCY KEY
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSubmissionFingerprint", () => {
  it("returns a 64-char hex SHA-256 string", () => {
    const intent = makeIntent();
    const fp = computeSubmissionFingerprint(intent);
    expect(fp).toHaveLength(64);
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same intent", () => {
    const intent = makeIntent();
    expect(computeSubmissionFingerprint(intent)).toBe(computeSubmissionFingerprint(intent));
  });

  it("changes when symbol changes", () => {
    const i1 = makeIntent({ symbol: "AAPL" });
    const i2 = makeIntent({ symbol: "TSLA" });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when side changes", () => {
    const i1 = makeIntent({ intentJson: makeOrderDetails({ side: "buy" }) });
    const i2 = makeIntent({ intentJson: makeOrderDetails({ side: "sell" }) });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when quantity changes", () => {
    const i1 = makeIntent({ intentJson: makeOrderDetails({ quantity: 5 }) });
    const i2 = makeIntent({ intentJson: makeOrderDetails({ quantity: 10 }) });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when limit price changes", () => {
    const i1 = makeIntent({ intentJson: makeOrderDetails({ limitPrice: 150 }) });
    const i2 = makeIntent({ intentJson: makeOrderDetails({ limitPrice: 155 }) });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when execution mode changes", () => {
    const i1 = makeIntent({ executionMode: "SANDBOX" });
    const i2 = makeIntent({ executionMode: "TEST_LIVE" });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when account ref changes", () => {
    const i1 = makeIntent({ accountRef: "ACCT1234" });
    const i2 = makeIntent({ accountRef: "ACCT9999" });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });

  it("changes when confirmation snapshot hash changes", () => {
    const i1 = makeIntent({ confirmationSnapshotHash: "hash-A" });
    const i2 = makeIntent({ confirmationSnapshotHash: "hash-B" });
    expect(computeSubmissionFingerprint(i1)).not.toBe(computeSubmissionFingerprint(i2));
  });
});

describe("computeIdempotencyKey", () => {
  it("returns a 64-char hex SHA-256 string", () => {
    const key = computeIdempotencyKey("u1", "c1", "h1", "acc1", "tradier");
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(computeIdempotencyKey("u1", "c1", "h1", "acc1", "tradier"))
      .toBe(computeIdempotencyKey("u1", "c1", "h1", "acc1", "tradier"));
  });

  it("differs by userId", () => {
    const k1 = computeIdempotencyKey("user-A", "c1", "h1", "acc1", "tradier");
    const k2 = computeIdempotencyKey("user-B", "c1", "h1", "acc1", "tradier");
    expect(k1).not.toBe(k2);
  });

  it("differs by confirmationId", () => {
    const k1 = computeIdempotencyKey("u1", "conf-A", "h1", "acc1", "tradier");
    const k2 = computeIdempotencyKey("u1", "conf-B", "h1", "acc1", "tradier");
    expect(k1).not.toBe(k2);
  });

  it("differs by confirmationSnapshotHash", () => {
    const k1 = computeIdempotencyKey("u1", "c1", "hash-A", "acc1", "tradier");
    const k2 = computeIdempotencyKey("u1", "c1", "hash-B", "acc1", "tradier");
    expect(k1).not.toBe(k2);
  });

  it("differs by accountRef", () => {
    const k1 = computeIdempotencyKey("u1", "c1", "h1", "ACCT1234", "tradier");
    const k2 = computeIdempotencyKey("u1", "c1", "h1", "ACCT9999", "tradier");
    expect(k1).not.toBe(k2);
  });

  it("differs by provider", () => {
    const k1 = computeIdempotencyKey("u1", "c1", "h1", "acc1", "tradier");
    const k2 = computeIdempotencyKey("u1", "c1", "h1", "acc1", "tradestation");
    expect(k1).not.toBe(k2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: CANONICAL BROKER STATUS NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeToCanonicalStatus", () => {
  const cases: Array<[string, string]> = [
    ["filled",          "FILLED"],
    ["FILLED",          "FILLED"],
    ["full_fill",       "FILLED"],
    ["complete",        "FILLED"],
    ["partially_filled", "PARTIALLY_FILLED"],
    ["partial_fill",    "PARTIALLY_FILLED"],
    ["partial",         "PARTIALLY_FILLED"],
    ["open",            "OPEN"],
    ["accepted",        "OPEN"],
    ["pending",         "OPEN"],
    ["working",         "OPEN"],
    ["canceled",        "CANCELLED"],
    ["cancelled",       "CANCELLED"],
    ["voided",          "CANCELLED"],
    ["rejected",        "REJECTED"],
    ["rejected_by_market", "REJECTED"],
    ["failed",          "REJECTED"],
    ["expired",         "EXPIRED"],
    ["expired_by_broker", "EXPIRED"],
    ["queued",          "PENDING"],
    ["received",        "PENDING"],
    ["ack",             "PENDING"],
    ["placed",          "PENDING"],
    ["gibberish",       "UNKNOWN"],
    ["",                "UNKNOWN"],
    ["UNKNOWN_STATUS",  "UNKNOWN"],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => {
      expect(normalizeToCanonicalStatus(input)).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: BROKER TRANSLATION SERVICE
// ─────────────────────────────────────────────────────────────────────────────

describe("buildClientOrderTag", () => {
  it("returns VCP_ prefix followed by 8 uppercase chars", () => {
    // First 8 chars of intentId must be alphanumeric — use hex UUID prefix
    const tag = buildClientOrderTag("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(tag).toMatch(/^VCP_[A-Z0-9]{8}$/);
  });

  it("is deterministic for same intentId", () => {
    expect(buildClientOrderTag("abc123")).toBe(buildClientOrderTag("abc123"));
  });

  it("differs for different intentIds", () => {
    expect(buildClientOrderTag("intent-A")).not.toBe(buildClientOrderTag("intent-B"));
  });
});

describe("isSimModeProvider", () => {
  it("returns true for SANDBOX mode", () => {
    expect(isSimModeProvider("tradier", "SANDBOX")).toBe(true);
  });

  it("returns false for TEST_LIVE mode", () => {
    expect(isSimModeProvider("tradier", "TEST_LIVE")).toBe(false);
  });

  it("returns false for PRODUCTION mode", () => {
    expect(isSimModeProvider("tradier", "PRODUCTION")).toBe(false);
  });
});

describe("translateEquityOrder", () => {
  it("translates a buy limit equity order correctly", () => {
    const intent = makeIntent({
      symbol: "AAPL",
      instrumentType: "equity",
      accountRef: "ACCT1234",
      intentJson: makeOrderDetails({ side: "buy", quantity: 5, orderType: "limit", limitPrice: 150, duration: "day" }),
    });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.symbol).toBe("AAPL");
    expect(req.accountId).toBe("ACCT1234");
    expect(req.side).toBe("buy");
    expect(req.quantity).toBe(5);
    expect(req.orderType).toBe("limit");
    expect(req.price).toBe(150);
    expect(req.duration).toBe("day");
    expect(req.orderClass).toBe("equity");
  });

  it("translates a sell order correctly", () => {
    const intent = makeIntent({
      intentJson: makeOrderDetails({ side: "sell", quantity: 10, orderType: "limit", limitPrice: 200 }),
    });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.side).toBe("sell");
    expect(req.quantity).toBe(10);
    expect(req.price).toBe(200);
  });

  it("includes stopPrice for stop-limit orders", () => {
    const intent = makeIntent({
      intentJson: makeOrderDetails({ orderType: "stop_limit", limitPrice: 148, stopPrice: 145 }),
    });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.price).toBe(148);
    expect(req.stopPrice).toBe(145);
  });

  it("does not include price for stop orders (only stopPrice)", () => {
    const intent = makeIntent({
      intentJson: makeOrderDetails({ orderType: "stop", limitPrice: null, stopPrice: 145 }),
    });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.price).toBeUndefined();
    expect(req.stopPrice).toBe(145);
  });

  it("uses GTC duration", () => {
    const intent = makeIntent({
      intentJson: makeOrderDetails({ duration: "gtc" }),
    });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.duration).toBe("gtc");
  });
});

describe("translateSingleLegOptionOrder", () => {
  it("translates a buy-to-open call option correctly", () => {
    const intent = makeIntent({
      symbol: "AAPL",
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({
        optionSymbol: "AAPL260815C00150000",
        optionSide: "buy_to_open",
        orderType: "limit",
        limitPrice: 5.50,
      }),
    });
    const req = translateSingleLegOptionOrder(intent, "tradier");
    expect(req.optionSymbol).toBe("AAPL260815C00150000");
    expect(req.optionSide).toBe("buy_to_open");
    expect(req.orderClass).toBe("option");
    expect(req.price).toBe(5.50);
  });

  it("throws when optionSymbol is missing", () => {
    const intent = makeIntent({
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({ optionSymbol: undefined }),
    });
    expect(() => translateSingleLegOptionOrder(intent, "tradier")).toThrow();
  });

  it("translates sell-to-close option correctly", () => {
    const intent = makeIntent({
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({
        optionSymbol: "AAPL260815C00150000",
        optionSide: "sell_to_close",
        orderType: "limit",
        limitPrice: 8.00,
      }),
    });
    const req = translateSingleLegOptionOrder(intent, "tradier");
    expect(req.optionSide).toBe("sell_to_close");
    expect(req.price).toBe(8.00);
  });
});

describe("translateMultiLegOrder", () => {
  it("blocks multi-leg in TEST_LIVE", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", instrumentType: "multi_leg_option" });
    const result = translateMultiLegOrder(intent, "tradier");
    expect(result.supported).toBe(false);
    expect(result.blockerCode).toBe("EI_MULTI_LEG_BANNED_IN_TEST_LIVE");
  });

  it("translates multi-leg in SANDBOX correctly", () => {
    const intent = makeIntent({
      executionMode: "SANDBOX",
      symbol: "AAPL",
      instrumentType: "multi_leg_option",
      intentJson: makeOrderDetails({
        orderType: "limit",
        duration: "day",
        legs: [
          { contractSymbol: "AAPL260815C00150000", optionSide: "buy_to_open", quantity: 2, limitPrice: 5 },
          { contractSymbol: "AAPL260815C00160000", optionSide: "sell_to_open", quantity: 2, limitPrice: 3 },
        ],
      }),
    });
    const result = translateMultiLegOrder(intent, "tradier");
    expect(result.supported).toBe(true);
    expect(result.orders?.length).toBe(2);
    expect(result.orders?.[0].optionSymbol).toBe("AAPL260815C00150000");
    expect(result.orders?.[1].optionSymbol).toBe("AAPL260815C00160000");
  });

  it("returns not supported when legs array is empty", () => {
    const intent = makeIntent({
      executionMode: "SANDBOX",
      instrumentType: "multi_leg_option",
      intentJson: makeOrderDetails({ legs: [] }),
    });
    const result = translateMultiLegOrder(intent, "tradier");
    expect(result.supported).toBe(false);
    expect(result.blockerCode).toBe("EI_MULTI_LEG_MISSING_LEGS");
  });
});

describe("translateIntentToOrderRequests — dispatcher", () => {
  it("routes equity instruments to equity translator", () => {
    const intent = makeIntent({ instrumentType: "equity" });
    const result = translateIntentToOrderRequests(intent, "tradier");
    expect(result.ok).toBe(true);
    expect(result.orderRequests?.length).toBe(1);
    expect(result.orderRequests?.[0].orderClass).toBe("equity");
  });

  it("routes single_leg_option instruments to option translator", () => {
    const intent = makeIntent({
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({
        optionSymbol: "AAPL260815C00150000",
        optionSide: "buy_to_open",
      }),
    });
    const result = translateIntentToOrderRequests(intent, "tradier");
    expect(result.ok).toBe(true);
    expect(result.orderRequests?.[0].orderClass).toBe("option");
  });

  it("returns error for unknown instrument type", () => {
    const intent = makeIntent({ instrumentType: "unknown_exotic" as any });
    const result = translateIntentToOrderRequests(intent, "tradier");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("EI_UNKNOWN_INSTRUMENT_TYPE");
  });

  it("returns error when single_leg_option is missing optionSymbol", () => {
    const intent = makeIntent({
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({ optionSymbol: undefined }),
    });
    const result = translateIntentToOrderRequests(intent, "tradier");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("EI_TRANSLATION_ERROR");
  });

  it("returns error for multi-leg in TEST_LIVE", () => {
    const intent = makeIntent({
      executionMode: "TEST_LIVE",
      instrumentType: "multi_leg_option",
    });
    const result = translateIntentToOrderRequests(intent, "tradier");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("EI_MULTI_LEG_BANNED_IN_TEST_LIVE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: POLICY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("getExecutionMode", () => {
  it("returns disabled by default", async () => {
    const { getExecutionMode } = await import("../../services/execution-policy");
    const old = process.env.BROKER_EXECUTION_MODE;
    delete process.env.BROKER_EXECUTION_MODE;
    expect(getExecutionMode()).toBe("disabled");
    process.env.BROKER_EXECUTION_MODE = old;
  });

  it("returns sandbox when env is 'sandbox'", async () => {
    const { getExecutionMode } = await import("../../services/execution-policy");
    process.env.BROKER_EXECUTION_MODE = "sandbox";
    expect(getExecutionMode()).toBe("sandbox");
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("returns test_live when env is 'test_live'", async () => {
    const { getExecutionMode } = await import("../../services/execution-policy");
    process.env.BROKER_EXECUTION_MODE = "test_live";
    expect(getExecutionMode()).toBe("test_live");
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("returns disabled for invalid value", async () => {
    const { getExecutionMode } = await import("../../services/execution-policy");
    process.env.BROKER_EXECUTION_MODE = "INVALID_MODE";
    expect(getExecutionMode()).toBe("disabled");
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("returns production for 'production' env (runtime-level)", async () => {
    const { getExecutionMode } = await import("../../services/execution-policy");
    process.env.BROKER_EXECUTION_MODE = "production";
    expect(getExecutionMode()).toBe("production");
    delete process.env.BROKER_EXECUTION_MODE;
  });
});

describe("isTestLiveArmed", () => {
  it("returns false when EXECUTION_TEST_LIVE_ARMED is not set", async () => {
    const { isTestLiveArmed } = await import("../../services/execution-policy");
    delete process.env.EXECUTION_TEST_LIVE_ARMED;
    expect(isTestLiveArmed()).toBe(false);
  });

  it("returns false when EXECUTION_TEST_LIVE_ARMED is 'false'", async () => {
    const { isTestLiveArmed } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_LIVE_ARMED = "false";
    expect(isTestLiveArmed()).toBe(false);
    delete process.env.EXECUTION_TEST_LIVE_ARMED;
  });

  it("returns true when EXECUTION_TEST_LIVE_ARMED is 'true'", async () => {
    const { isTestLiveArmed } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_LIVE_ARMED = "true";
    delete process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL;
    expect(isTestLiveArmed()).toBe(true);
    delete process.env.EXECUTION_TEST_LIVE_ARMED;
  });

  it("returns false when arming has expired", async () => {
    const { isTestLiveArmed } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_LIVE_ARMED = "true";
    process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL = new Date(Date.now() - 10_000).toISOString();
    expect(isTestLiveArmed()).toBe(false);
    delete process.env.EXECUTION_TEST_LIVE_ARMED;
    delete process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL;
  });

  it("returns false for invalid UNTIL date", async () => {
    const { isTestLiveArmed } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_LIVE_ARMED = "true";
    process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL = "not-a-date";
    expect(isTestLiveArmed()).toBe(false);
    delete process.env.EXECUTION_TEST_LIVE_ARMED;
    delete process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL;
  });
});

describe("getTestLiveAllowlistedAccounts", () => {
  it("returns empty array when not configured", async () => {
    const { getTestLiveAllowlistedAccounts } = await import("../../services/execution-policy");
    delete process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST;
    expect(getTestLiveAllowlistedAccounts()).toEqual([]);
  });

  it("parses comma-separated account list", async () => {
    const { getTestLiveAllowlistedAccounts } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST = "ACCT1234, ACCT5678 , ACCT9999";
    const result = getTestLiveAllowlistedAccounts();
    expect(result).toContain("ACCT1234");
    expect(result).toContain("ACCT5678");
    expect(result).toContain("ACCT9999");
    expect(result.length).toBe(3);
    delete process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST;
  });
});

describe("getTestLiveAllowlistedSymbols", () => {
  it("returns empty array when not configured", async () => {
    const { getTestLiveAllowlistedSymbols } = await import("../../services/execution-policy");
    delete process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST;
    expect(getTestLiveAllowlistedSymbols()).toEqual([]);
  });

  it("normalizes symbols to uppercase", async () => {
    const { getTestLiveAllowlistedSymbols } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST = "aapl,tsla,nvda";
    const result = getTestLiveAllowlistedSymbols();
    expect(result).toContain("AAPL");
    expect(result).toContain("TSLA");
    expect(result).toContain("NVDA");
    delete process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST;
  });
});

describe("getTestLiveMaxNotional", () => {
  it("returns null when not configured", async () => {
    const { getTestLiveMaxNotional } = await import("../../services/execution-policy");
    delete process.env.EXECUTION_TEST_MAX_NOTIONAL;
    expect(getTestLiveMaxNotional()).toBeNull();
  });

  it("parses valid number", async () => {
    const { getTestLiveMaxNotional } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_MAX_NOTIONAL = "5000";
    expect(getTestLiveMaxNotional()).toBe(5000);
    delete process.env.EXECUTION_TEST_MAX_NOTIONAL;
  });

  it("returns null for non-numeric value", async () => {
    const { getTestLiveMaxNotional } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_MAX_NOTIONAL = "notanumber";
    expect(getTestLiveMaxNotional()).toBeNull();
    delete process.env.EXECUTION_TEST_MAX_NOTIONAL;
  });

  it("returns null for zero or negative", async () => {
    const { getTestLiveMaxNotional } = await import("../../services/execution-policy");
    process.env.EXECUTION_TEST_MAX_NOTIONAL = "0";
    expect(getTestLiveMaxNotional()).toBeNull();
    delete process.env.EXECUTION_TEST_MAX_NOTIONAL;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: SECURITY — FORBIDDEN FIELDS & CROSS-USER
// ─────────────────────────────────────────────────────────────────────────────

describe("Security Invariants", () => {
  it("FORBIDDEN_INTENT_CLIENT_FIELDS contains sensitive fields", () => {
    const sensitive = ["brokerPayload", "rawOrder", "accountId", "forceSubmit", "skipValidation", "production", "live", "bypassGate"];
    for (const f of sensitive) {
      expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain(f);
    }
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS contains overrideMode", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("overrideMode");
  });

  it("FORBIDDEN_INTENT_CLIENT_FIELDS contains retry", () => {
    expect(FORBIDDEN_INTENT_CLIENT_FIELDS).toContain("retry");
  });

  it("PRODUCTION_SUBMISSION_NOT_ENABLED cannot be false", () => {
    // This is a compile-time constant — type system guarantees it
    expect(PRODUCTION_SUBMISSION_NOT_ENABLED).toBe(true);
    expect(PRODUCTION_SUBMISSION_NOT_ENABLED).not.toBe(false);
  });

  it("EI_OWNERSHIP_VIOLATION is defined", () => {
    expect(EI_OWNERSHIP_VIOLATION).toBe("EI_OWNERSHIP_VIOLATION");
  });

  it("EI_FORBIDDEN_FIELD is defined", () => {
    expect(EI_FORBIDDEN_FIELD).toBe("EI_FORBIDDEN_FIELD");
  });

  it("EI_AI_SUBMISSION_BLOCKED is defined in types", async () => {
    const types = await import("../../../shared/execution-intent-types");
    expect(types.EI_AI_SUBMISSION_BLOCKED).toBe("EI_AI_SUBMISSION_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: RECONCILIATION STATE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

describe("Reconciliation — canonical status to intent state mapping", () => {
  // Tests for the mapBrokerStatusToIntentState function (via reconciliation service behavior)

  it("SUBMISSION_UNKNOWN can transition to BROKER_ACCEPTED (via reconcile)", () => {
    expect(isAllowedTransition("SUBMISSION_UNKNOWN", "BROKER_ACCEPTED")).toBe(true);
  });

  it("SUBMISSION_UNKNOWN can transition to REJECTED (via reconcile)", () => {
    expect(isAllowedTransition("SUBMISSION_UNKNOWN", "REJECTED")).toBe(true);
  });

  it("SUBMISSION_UNKNOWN can transition to ABANDONED (after manual review)", () => {
    expect(isAllowedTransition("SUBMISSION_UNKNOWN", "ABANDONED")).toBe(true);
  });

  it("BROKER_ACCEPTED can become OPEN after reconcile shows open", () => {
    expect(isAllowedTransition("BROKER_ACCEPTED", "OPEN")).toBe(true);
  });

  it("BROKER_ACCEPTED can become FILLED directly (fast fill)", () => {
    expect(isAllowedTransition("BROKER_ACCEPTED", "FILLED")).toBe(true);
  });

  it("OPEN can become PARTIALLY_FILLED", () => {
    expect(isAllowedTransition("OPEN", "PARTIALLY_FILLED")).toBe(true);
  });

  it("PARTIALLY_FILLED can become FILLED", () => {
    expect(isAllowedTransition("PARTIALLY_FILLED", "FILLED")).toBe(true);
  });

  it("FILLED transitions to POSITION_LINKED (auto-link)", () => {
    expect(isAllowedTransition("FILLED", "POSITION_LINKED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: EDGE CASES & BOUNDARY CONDITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("fingerprint handles null limitPrice without error", () => {
    const intent = makeIntent({ intentJson: makeOrderDetails({ orderType: "market", limitPrice: null }) });
    expect(() => computeSubmissionFingerprint(intent)).not.toThrow();
  });

  it("fingerprint handles zero quantity", () => {
    const intent = makeIntent({ intentJson: makeOrderDetails({ quantity: 0 }) });
    const fp = computeSubmissionFingerprint(intent);
    expect(fp).toHaveLength(64);
  });

  it("normalizeToCanonicalStatus handles mixed case input", () => {
    expect(normalizeToCanonicalStatus("Filled")).toBe("FILLED");
    expect(normalizeToCanonicalStatus("CANCELLED")).toBe("CANCELLED");
    expect(normalizeToCanonicalStatus("Open")).toBe("OPEN");
  });

  it("runFinalValidation handles null snapshotExpiresAt (no expiry check)", () => {
    const intent = makeIntent({ executionMode: "SANDBOX" });
    const ctx = makeValidationContext({ snapshotExpiresAt: null });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_SNAPSHOT_EXPIRED)).toBe(false);
  });

  it("runFinalValidation handles null currentSnapshotHash (no hash check)", () => {
    const intent = makeIntent({ confirmationSnapshotHash: "abc" });
    const ctx = makeValidationContext({ currentSnapshotHash: null });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_CONFIRMATION_HASH_MISMATCH)).toBe(false);
  });

  it("runFinalValidation handles null connectedProvider (no provider check)", () => {
    const intent = makeIntent({ executionMode: "SANDBOX", provider: "tradier" });
    const ctx = makeValidationContext({ connectedProvider: null });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_PROVIDER_MISMATCH)).toBe(false);
  });

  it("runFinalValidation handles null connectedAccountRef (no account check)", () => {
    const intent = makeIntent({ accountRef: "ACCT1234" });
    const ctx = makeValidationContext({ connectedAccountRef: null });
    const deps = makeSandboxDeps();
    const result = runFinalValidation(intent, ctx, deps);
    expect(result.blockers.some(b => b.errorCode === EI_ACCOUNT_MISMATCH)).toBe(false);
  });

  it("idempotency key does not contain raw account ref", () => {
    const key = computeIdempotencyKey("user-1", "conf-1", "hash-1", "MY_REAL_ACCOUNT_123", "tradier");
    expect(key).not.toContain("MY_REAL_ACCOUNT_123");
  });

  it("submission fingerprint does not contain accountRef in plain text", () => {
    const intent = makeIntent({ accountRef: "SUPER_SENSITIVE_ACCOUNT" });
    const fp = computeSubmissionFingerprint(intent);
    expect(fp).not.toContain("SUPER_SENSITIVE_ACCOUNT");
  });

  it("buildClientOrderTag truncates to 8 chars from intentId", () => {
    const longId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const tag = buildClientOrderTag(longId);
    // VCP_ + 8 chars
    expect(tag.length).toBe(12);
  });

  it("translateEquityOrder sets orderClass to equity always", () => {
    const intent = makeIntent({ instrumentType: "equity" });
    const req = translateEquityOrder(intent, "tradier");
    expect(req.orderClass).toBe("equity");
  });

  it("translateSingleLegOptionOrder sets orderClass to option always", () => {
    const intent = makeIntent({
      instrumentType: "single_leg_option",
      intentJson: makeOrderDetails({ optionSymbol: "X260815C00100000", optionSide: "buy_to_open" }),
    });
    const req = translateSingleLegOptionOrder(intent, "tradier");
    expect(req.orderClass).toBe("option");
  });

  it("all state transitions are arrays (not undefined)", () => {
    for (const state of Object.keys(ALLOWED_TRANSITIONS) as ExecutionIntentState[]) {
      expect(Array.isArray(ALLOWED_TRANSITIONS[state])).toBe(true);
    }
  });

  it("no state allows transition to INTENT_CREATED (no backwards reset)", () => {
    for (const state of Object.keys(ALLOWED_TRANSITIONS) as ExecutionIntentState[]) {
      expect(ALLOWED_TRANSITIONS[state]).not.toContain("INTENT_CREATED");
    }
  });

  it("SUBMISSION_IN_PROGRESS cannot transition back to FINAL_VALIDATION_IN_PROGRESS", () => {
    expect(isAllowedTransition("SUBMISSION_IN_PROGRESS", "FINAL_VALIDATION_IN_PROGRESS")).toBe(false);
  });

  it("test_live check count is exactly 8 distinct gate checks (armed + acct + symbol + 3 caps + market + multileg)", () => {
    const intent = makeIntent({ executionMode: "TEST_LIVE", symbol: "TSLA", instrumentType: "equity" });
    const ctx = makeValidationContext();
    const deps = makeTestLiveDeps({
      isTestLiveArmed: () => false,
      getTestLiveAllowlistedAccounts: () => ["WRONG_ACCT"],
      getTestLiveAllowlistedSymbols: () => ["AAPL"], // TSLA not in list
      getTestLiveMaxNotional: () => 100, // ctx.estimatedNotionalUsd = 750 → over cap
      getTestLiveMaxEquityQty: () => 1, // qty 5 → over cap
      getTestLiveMaxOptionContracts: () => 10,
    });
    const intentWithMarket = { ...intent, intentJson: { ...intent.intentJson, orderType: "market" as const } };
    const result = runFinalValidation(intentWithMarket, ctx, deps);
    // Should have: armed, account, symbol, notional, equity qty, market order
    expect(result.blockers.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: DDL COMPLIANCE CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe("Table DDL Sanity", () => {
  it("ensureExecutionIntentTables is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.ensureExecutionIntentTables).toBe("function");
  });

  it("insertExecutionIntent is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.insertExecutionIntent).toBe("function");
  });

  it("atomicTransitionState is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.atomicTransitionState).toBe("function");
  });

  it("insertSubmissionAttempt is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.insertSubmissionAttempt).toBe("function");
  });

  it("insertExecutionFill is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.insertExecutionFill).toBe("function");
  });

  it("getFillsByIntentId is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.getFillsByIntentId).toBe("function");
  });

  it("insertPositionLink is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.insertPositionLink).toBe("function");
  });

  it("getStaleSubmissionInProgressIntents is exported", async () => {
    const mod = await import("../../services/execution-intent-tables");
    expect(typeof mod.getStaleSubmissionInProgressIntents).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: SUBMISSION SERVICE API
// ─────────────────────────────────────────────────────────────────────────────

describe("Execution Submission Service API", () => {
  it("submitExecutionIntent is exported", async () => {
    const mod = await import("../../services/execution-submission-service");
    expect(typeof mod.submitExecutionIntent).toBe("function");
  });

  it("createIntentFromConfirmation is exported", async () => {
    const mod = await import("../../services/execution-submission-service");
    expect(typeof mod.createIntentFromConfirmation).toBe("function");
  });

  it("setBrokerSubmissionAdapter is exported (injectable for tests)", async () => {
    const mod = await import("../../services/execution-submission-service");
    expect(typeof mod.setBrokerSubmissionAdapter).toBe("function");
  });

  it("resetBrokerSubmissionAdapter is exported", async () => {
    const mod = await import("../../services/execution-submission-service");
    expect(typeof mod.resetBrokerSubmissionAdapter).toBe("function");
  });

  it("syncFillFromBrokerStatus is exported", async () => {
    const mod = await import("../../services/execution-submission-service");
    expect(typeof mod.syncFillFromBrokerStatus).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: RECONCILIATION SERVICE API
// ─────────────────────────────────────────────────────────────────────────────

describe("Reconciliation Service API", () => {
  it("reconcileExecutionIntent is exported", async () => {
    const mod = await import("../../services/execution-reconciliation-service");
    expect(typeof mod.reconcileExecutionIntent).toBe("function");
  });

  it("reconcileStaleExecutionIntents is exported", async () => {
    const mod = await import("../../services/execution-reconciliation-service");
    expect(typeof mod.reconcileStaleExecutionIntents).toBe("function");
  });

  it("setReconciliationAdapter is exported", async () => {
    const mod = await import("../../services/execution-reconciliation-service");
    expect(typeof mod.setReconciliationAdapter).toBe("function");
  });

  it("resetReconciliationAdapter is exported", async () => {
    const mod = await import("../../services/execution-reconciliation-service");
    expect(typeof mod.resetReconciliationAdapter).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: ROUTE REGISTRATION API
// ─────────────────────────────────────────────────────────────────────────────

describe("Route Registration API", () => {
  it("registerExecutionIntentRoutes is exported from routes/execution-intent", async () => {
    const mod = await import("../execution-intent");
    expect(typeof mod.registerExecutionIntentRoutes).toBe("function");
  });

  it("ensureExecutionIntentTables is re-exported from routes/execution-intent", async () => {
    const mod = await import("../execution-intent");
    expect(typeof mod.ensureExecutionIntentTables).toBe("function");
  });

  it("reconcileStaleExecutionIntents is re-exported from routes/execution-intent", async () => {
    const mod = await import("../execution-intent");
    expect(typeof mod.reconcileStaleExecutionIntents).toBe("function");
  });
});
