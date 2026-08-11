/**
 * server/services/execution-submission-service.ts — Sprint 2.8.6
 *
 * THE SINGLE BROKER SUBMISSION ORCHESTRATOR.
 *
 * PERMANENT INVARIANTS:
 *   - Only called from POST /api/executions/:id/submit (never from AI/scheduler/background).
 *   - Persists SUBMISSION_IN_PROGRESS BEFORE network call.
 *   - Timeout or ambiguous response → SUBMISSION_UNKNOWN (never FAILED, never auto-retry).
 *   - One confirmed snapshot hash → at most one broker mutation (idempotency key + DB UNIQUE).
 *   - PRODUCTION mode → always rejected.
 *   - State transitions enforced via atomic DB update (WHERE state = expected).
 *   - No raw tokens, credentials, or balance data returned to client.
 */

import crypto from "crypto";
import type { ExecutionIntent, ExecutionIntentMode } from "../../shared/execution-intent-types";
import {
  EI_FINAL_VALIDATION_FAILED,
  EI_WRONG_STATE_FOR_SUBMIT,
  EI_PRODUCTION_NOT_ENABLED,
  EI_KILL_SWITCH_ACTIVE,
  EI_CONCURRENT_SUBMISSION,
  EI_SUBMISSION_UNKNOWN,
  EI_BROKER_REJECTED,
  EI_DUPLICATE_SUBMISSION,
  PRODUCTION_SUBMISSION_NOT_ENABLED,
} from "../../shared/execution-intent-types";
import {
  getExecutionIntentById,
  atomicTransitionState,
  insertSubmissionAttempt,
  updateSubmissionAttempt,
  insertExecutionFill,
  insertPositionLink,
  getFillsByIntentId,
} from "./execution-intent-tables";
import {
  runFinalValidation,
  computeSubmissionFingerprint,
  normalizeToCanonicalStatus,
} from "./execution-final-validation-service";
import { translateIntentToOrderRequests, buildClientOrderTag } from "./broker-translation-service";
import { isExecutionEnabled, getExecutionMode, isProviderExecutionEnabled } from "./execution-policy";
import type { FinalValidationContext } from "./execution-final-validation-service";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE BROKER ADAPTER (mockable for tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerSubmissionAdapter {
  placeOrder(
    userId: string,
    order: import("../broker/types").OrderRequest,
    timeoutMs: number,
  ): Promise<BrokerSubmissionResult>;
  queryOrderStatus(
    userId: string,
    brokerOrderRef: string,
  ): Promise<BrokerStatusQueryResult | null>;
}

export interface BrokerSubmissionResult {
  outcome: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  brokerOrderRef: string | null;
  rawStatus: string;
  timedOut: boolean;
  errorMessage: string | null;
}

export interface BrokerStatusQueryResult {
  brokerOrderRef: string;
  canonicalStatus: import("../../shared/execution-intent-types").CanonicalBrokerOrderStatus;
  rawStatus: string;
  filledQty: number | null;
  fillPrice: number | null;
  remainingQty: number | null;
}

// Default live adapter using placeBrokerOrder from broker/index
class LiveBrokerSubmissionAdapter implements BrokerSubmissionAdapter {
  async placeOrder(
    userId: string,
    order: import("../broker/types").OrderRequest,
    timeoutMs: number,
  ): Promise<BrokerSubmissionResult> {
    const { placeBrokerOrder } = await import("../broker/index");

    // Race the broker call against a timeout
    let timedOut = false;
    const result = await Promise.race([
      placeBrokerOrder(userId, order).then(r => ({ r, err: null })).catch(err => ({ r: null, err })),
      new Promise<{ r: null; err: Error; timeout: true }>(resolve =>
        setTimeout(() => { timedOut = true; resolve({ r: null, err: new Error("BROKER_TIMEOUT"), timeout: true }); }, timeoutMs),
      ),
    ]);

    if (timedOut || (result as any).timeout) {
      return { outcome: "UNKNOWN", brokerOrderRef: null, rawStatus: "TIMEOUT", timedOut: true, errorMessage: "Broker request timed out. Order status is unknown." };
    }

    const { r, err } = result as { r: import("../broker/types").OrderResponse | null; err: Error | null };

    if (err) {
      // Determine if this is a clear rejection or ambiguous
      const msg = err.message ?? "";
      const isClearRejection = /reject|invalid|bad request|insufficient|not allowed|error.*order/i.test(msg);
      if (isClearRejection) {
        return { outcome: "REJECTED", brokerOrderRef: null, rawStatus: "REJECTED", timedOut: false, errorMessage: msg };
      }
      // 5xx or network ambiguity → UNKNOWN
      return { outcome: "UNKNOWN", brokerOrderRef: null, rawStatus: "NETWORK_ERROR", timedOut: false, errorMessage: msg };
    }

    if (!r) {
      return { outcome: "UNKNOWN", brokerOrderRef: null, rawStatus: "EMPTY_RESPONSE", timedOut: false, errorMessage: "Broker returned empty response." };
    }

    // orderId "pending" → ambiguous
    if (r.orderId === "pending") {
      return { outcome: "UNKNOWN", brokerOrderRef: null, rawStatus: r.status ?? "pending", timedOut: false, errorMessage: "Broker acknowledged but did not return an order ID." };
    }

    return { outcome: "ACCEPTED", brokerOrderRef: r.orderId, rawStatus: r.status ?? "accepted", timedOut: false, errorMessage: null };
  }

  async queryOrderStatus(userId: string, brokerOrderRef: string): Promise<BrokerStatusQueryResult | null> {
    try {
      const { getBrokerOrders } = await import("../broker/index");
      const orders = await getBrokerOrders(userId);
      const found = orders.find(o => String(o.id) === String(brokerOrderRef));
      if (!found) return null;
      return {
        brokerOrderRef,
        canonicalStatus: normalizeToCanonicalStatus(found.status),
        rawStatus: found.status,
        filledQty: typeof found.filledQty === "number" ? found.filledQty : null,
        fillPrice: typeof found.price === "number" ? found.price : null,
        remainingQty: typeof found.qty === "number" && typeof found.filledQty === "number"
          ? found.qty - found.filledQty : null,
      };
    } catch {
      return null;
    }
  }
}

let _adapter: BrokerSubmissionAdapter = new LiveBrokerSubmissionAdapter();

/** Override for tests — inject a deterministic test adapter. */
export function setBrokerSubmissionAdapter(adapter: BrokerSubmissionAdapter): void {
  _adapter = adapter;
}
export function resetBrokerSubmissionAdapter(): void {
  _adapter = new LiveBrokerSubmissionAdapter();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmissionServiceResult {
  ok: boolean;
  state: string;
  errorCode?: string;
  errorMessage?: string;
  brokerOrderRef?: string | null;
  clientOrderTag?: string | null;
  intent?: ExecutionIntent;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

const SUBMISSION_TIMEOUT_MS = 30_000;

export async function submitExecutionIntent(
  intentId: string,
  userId: string,
  validationContext: FinalValidationContext,
): Promise<SubmissionServiceResult> {

  // ── Safety: PRODUCTION is always blocked ────────────────────────────────
  void PRODUCTION_SUBMISSION_NOT_ENABLED; // compile-time proof

  // ── Load intent ─────────────────────────────────────────────────────────
  const intent = await getExecutionIntentById(intentId, userId);
  if (!intent) {
    return { ok: false, state: "NOT_FOUND", errorCode: "EI_INTENT_NOT_FOUND", errorMessage: "Execution intent not found." };
  }

  // ── Check intent is in submittable state ─────────────────────────────────
  if (intent.state !== "INTENT_CREATED") {
    return { ok: false, state: intent.state, errorCode: EI_WRONG_STATE_FOR_SUBMIT, errorMessage: `Intent is in state ${intent.state}. Only INTENT_CREATED intents can be submitted.`, intent };
  }

  // ── PRODUCTION block (runtime guard) ────────────────────────────────────
  const mode = intent.executionMode as ExecutionIntentMode;
  if (mode === "PRODUCTION") {
    return { ok: false, state: intent.state, errorCode: EI_PRODUCTION_NOT_ENABLED, errorMessage: "General production customer execution is not enabled in this release.", intent };
  }

  // ── Global kill switch ──────────────────────────────────────────────────
  if (!isExecutionEnabled()) {
    return { ok: false, state: intent.state, errorCode: EI_KILL_SWITCH_ACTIVE, errorMessage: "Execution is globally disabled.", intent };
  }

  // ── Provider kill switch ─────────────────────────────────────────────────
  if (!isProviderExecutionEnabled(intent.provider)) {
    return { ok: false, state: intent.state, errorCode: EI_KILL_SWITCH_ACTIVE, errorMessage: `Provider ${intent.provider} execution is disabled.`, intent };
  }

  // ── Atomic optimistic lock: transition to FINAL_VALIDATION_IN_PROGRESS ──
  const locked = await atomicTransitionState(
    intentId, userId,
    "INTENT_CREATED", "FINAL_VALIDATION_IN_PROGRESS",
    { finalValidationAt: new Date().toISOString() },
  );
  if (!locked) {
    // Another request won the race
    return { ok: false, state: intent.state, errorCode: EI_CONCURRENT_SUBMISSION, errorMessage: "Another submission is already in progress for this intent.", intent };
  }

  // ── Run final validation ─────────────────────────────────────────────────
  const validation = runFinalValidation(intent, validationContext);
  if (!validation.valid) {
    await atomicTransitionState(
      intentId, userId,
      "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
      {
        errorCode: EI_FINAL_VALIDATION_FAILED,
        errorMessage: validation.blockers.map(b => b.message).join("; "),
      },
    );
    return {
      ok: false,
      state: "FINAL_VALIDATION_FAILED",
      errorCode: EI_FINAL_VALIDATION_FAILED,
      errorMessage: `Final validation failed: ${validation.blockers.map(b => b.message).join("; ")}`,
    };
  }

  // ── Translate order ──────────────────────────────────────────────────────
  const translation = translateIntentToOrderRequests(intent, intent.provider);
  if (!translation.ok || !translation.orderRequests?.length) {
    await atomicTransitionState(
      intentId, userId,
      "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
      { errorCode: translation.errorCode ?? "EI_TRANSLATION_ERROR", errorMessage: translation.errorMessage ?? "Order translation failed." },
    );
    return { ok: false, state: "FINAL_VALIDATION_FAILED", errorCode: translation.errorCode, errorMessage: translation.errorMessage };
  }

  // ── Reject multi-leg orders in v1 (partial submission risk) ─────────────
  // Multi-leg translates to N individual orders; submitting only [0] would be a
  // silent partial fill. Reject cleanly rather than risk an uncovered position.
  if (translation.orderRequests.length > 1) {
    await atomicTransitionState(
      intentId, userId,
      "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
      { errorCode: "EI_MULTI_LEG_NOT_SUPPORTED", errorMessage: "Multi-leg option orders are not supported for broker submission in this release. Use single-leg options only." },
    );
    return { ok: false, state: "FINAL_VALIDATION_FAILED", errorCode: "EI_MULTI_LEG_NOT_SUPPORTED", errorMessage: "Multi-leg option orders are not supported for broker submission in this release." };
  }

  // ── SANDBOX account routing — must never touch live account ──────────────
  // For Tradier: prefix accountId with 'sandbox:' so placeBrokerOrder routes
  // to the paper token (connection.sandboxAccessToken). This is the established
  // Tradier paper-account convention in server/broker/index.ts:597-599.
  // For TradeStation: the connection.simMode flag controls SIM routing; if the
  // user's stored connection is not SIM, reject to prevent live-money execution.
  if (mode === "SANDBOX") {
    const orderReqFirst = translation.orderRequests[0];
    if (intent.provider === "tradier") {
      // Prefix sandbox: so resolveAccountToken uses sandboxAccessToken
      translation.orderRequests[0] = { ...orderReqFirst, accountId: `sandbox:${orderReqFirst.accountId.replace(/^sandbox:/, "")}` };
    } else if (intent.provider === "tradestation") {
      // TradeStation SIM is connection-level — check that the stored connection is SIM
      try {
        const { storage } = await import("../storage");
        const conn = await storage.getBrokerConnectionWithToken(userId);
        if (!conn?.simMode) {
          await atomicTransitionState(
            intentId, userId,
            "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
            { errorCode: "EI_SANDBOX_NO_SIM_CONNECTION", errorMessage: "SANDBOX mode requires a TradeStation SIM connection. Reconnect using the SIM account type." },
          );
          return { ok: false, state: "FINAL_VALIDATION_FAILED", errorCode: "EI_SANDBOX_NO_SIM_CONNECTION", errorMessage: "SANDBOX mode requires a TradeStation SIM connection." };
        }
      } catch {
        await atomicTransitionState(
          intentId, userId,
          "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
          { errorCode: "EI_SANDBOX_CONNECTION_CHECK_FAILED", errorMessage: "Could not verify SIM connection status. Cannot submit in SANDBOX mode." },
        );
        return { ok: false, state: "FINAL_VALIDATION_FAILED", errorCode: "EI_SANDBOX_CONNECTION_CHECK_FAILED", errorMessage: "Could not verify SIM connection status." };
      }
    }
    // Other providers: no sandbox support in v1
    else {
      await atomicTransitionState(
        intentId, userId,
        "FINAL_VALIDATION_IN_PROGRESS", "FINAL_VALIDATION_FAILED",
        { errorCode: "EI_SANDBOX_PROVIDER_NOT_SUPPORTED", errorMessage: `Provider ${intent.provider} does not support SANDBOX mode in this release.` },
      );
      return { ok: false, state: "FINAL_VALIDATION_FAILED", errorCode: "EI_SANDBOX_PROVIDER_NOT_SUPPORTED", errorMessage: `Provider ${intent.provider} does not support SANDBOX mode.` };
    }
  }

  // ── Compute submission fingerprint ───────────────────────────────────────
  const fingerprint = computeSubmissionFingerprint(intent);
  const clientOrderTag = buildClientOrderTag(intentId);

  // ── Determine in-progress state based on mode ────────────────────────────
  const inProgressState = mode === "SANDBOX" ? "SANDBOX_SUBMISSION_IN_PROGRESS" : "SUBMISSION_IN_PROGRESS";

  // ── Persist submission attempt (IN_PROGRESS) BEFORE network call ─────────
  const attemptId = crypto.randomUUID();
  const attemptNumber = (intent.attemptCount ?? 0) + 1;
  await insertSubmissionAttempt({
    id: attemptId,
    executionIntentId: intentId,
    userId,
    attemptNumber,
    startedAt: new Date().toISOString(),
    completedAt: null,
    outcome: "IN_PROGRESS",
    brokerOrderRef: null,
    errorCode: null,
    errorMessage: null,
    timeoutMs: SUBMISSION_TIMEOUT_MS,
    timedOut: false,
  });

  // ── Transition to in-progress state ─────────────────────────────────────
  await atomicTransitionState(
    intentId, userId,
    "FINAL_VALIDATION_IN_PROGRESS", inProgressState as any,
    {
      submissionFingerprint: fingerprint,
      submittedAt: new Date().toISOString(),
      attemptCountDelta: 1,
    },
  );

  // ── SINGLE NETWORK CALL (point of no return) ─────────────────────────────
  let brokerResult: BrokerSubmissionResult;
  try {
    const orderReq = translation.orderRequests[0];
    brokerResult = await _adapter.placeOrder(userId, orderReq, SUBMISSION_TIMEOUT_MS);
  } catch (e: any) {
    // Unexpected error during submission — treat as UNKNOWN
    brokerResult = {
      outcome: "UNKNOWN",
      brokerOrderRef: null,
      rawStatus: "UNEXPECTED_ERROR",
      timedOut: false,
      errorMessage: e?.message ?? "Unexpected submission error",
    };
  }

  // ── Resolve final state based on broker result ───────────────────────────
  const now = new Date().toISOString();
  let finalState: string;
  let returnOk = false;

  if (brokerResult.outcome === "ACCEPTED" && brokerResult.brokerOrderRef) {
    finalState = "BROKER_ACCEPTED";
    returnOk = true;
    await atomicTransitionState(
      intentId, userId,
      inProgressState as any, "BROKER_ACCEPTED",
      {
        brokerOrderRef: brokerResult.brokerOrderRef,
        clientOrderTag,
        acknowledgedAt: now,
        errorCode: null,
        errorMessage: null,
      },
    );
    await updateSubmissionAttempt(attemptId, "BROKER_ACCEPTED", { brokerOrderRef: brokerResult.brokerOrderRef });
  } else if (brokerResult.outcome === "REJECTED") {
    finalState = "REJECTED";
    await atomicTransitionState(
      intentId, userId,
      inProgressState as any, "REJECTED",
      {
        errorCode: EI_BROKER_REJECTED,
        errorMessage: brokerResult.errorMessage ?? "Broker rejected the order.",
      },
    );
    await updateSubmissionAttempt(attemptId, "REJECTED", { errorCode: EI_BROKER_REJECTED, errorMessage: brokerResult.errorMessage ?? undefined });
  } else {
    // UNKNOWN / timeout / ambiguous → SUBMISSION_UNKNOWN (never retry)
    finalState = "SUBMISSION_UNKNOWN";
    await atomicTransitionState(
      intentId, userId,
      inProgressState as any, "SUBMISSION_UNKNOWN",
      {
        errorCode: EI_SUBMISSION_UNKNOWN,
        errorMessage: brokerResult.errorMessage ?? "Broker response was ambiguous. Do not retry. Reconcile before any further action.",
      },
    );
    await updateSubmissionAttempt(attemptId, "SUBMISSION_UNKNOWN", {
      errorCode: EI_SUBMISSION_UNKNOWN,
      errorMessage: brokerResult.errorMessage ?? undefined,
      timedOut: brokerResult.timedOut,
    });
  }

  const updated = await getExecutionIntentById(intentId, userId);

  return {
    ok: returnOk,
    state: finalState,
    errorCode: returnOk ? undefined : (finalState === "SUBMISSION_UNKNOWN" ? EI_SUBMISSION_UNKNOWN : EI_BROKER_REJECTED),
    errorMessage: returnOk ? undefined : (brokerResult.errorMessage ?? undefined),
    brokerOrderRef: brokerResult.brokerOrderRef,
    clientOrderTag: returnOk ? clientOrderTag : undefined,
    intent: updated ?? intent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT CREATION FROM CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateIntentFromConfirmationInput {
  userId: string;
  confirmationId: string;
  confirmationSnapshotHash: string;
  tradePlanId: string;
  provider: string;
  accountRef: string;
  accountRefMasked: string;
  executionMode: ExecutionIntentMode;
  instrumentType: string;
  structureType: string;
  symbol: string;
  orderDetails: import("../../shared/execution-intent-types").ExecutionIntentOrderDetails;
}

export async function createIntentFromConfirmation(
  input: CreateIntentFromConfirmationInput,
): Promise<ExecutionIntent> {
  const { computeIdempotencyKey } = await import("./execution-final-validation-service");
  const { insertExecutionIntent } = await import("./execution-intent-tables");
  const { maskAccountId } = await import("./broker-execution-adapter");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const idempotencyKey = computeIdempotencyKey(
    input.userId,
    input.confirmationId,
    input.confirmationSnapshotHash,
    input.accountRef,
    input.provider,
  );

  const intent: ExecutionIntent = {
    id,
    userId: input.userId,
    confirmationId: input.confirmationId,
    confirmationSnapshotHash: input.confirmationSnapshotHash,
    tradePlanId: input.tradePlanId,
    provider: input.provider,
    accountRef: input.accountRef,
    accountRefMasked: input.accountRefMasked || maskAccountId(input.accountRef),
    executionMode: input.executionMode,
    state: "INTENT_CREATED",
    idempotencyKey,
    submissionFingerprint: null,
    instrumentType: input.instrumentType,
    structureType: input.structureType,
    symbol: input.symbol,
    intentJson: input.orderDetails,
    brokerOrderRef: null,
    clientOrderTag: null,
    filledQty: null,
    orderedQty: input.orderDetails.quantity,
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
  };

  await insertExecutionIntent(intent);
  return intent;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILL PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

export async function syncFillFromBrokerStatus(
  intentId: string,
  userId: string,
  status: BrokerStatusQueryResult,
): Promise<void> {
  if (!status.filledQty || status.filledQty <= 0) return;

  const existingFills = await getFillsByIntentId(intentId);
  const totalFilled = existingFills.reduce((sum, f) => sum + f.filledQty, 0);
  const newFillQty = status.filledQty - totalFilled;
  if (newFillQty <= 0) return; // no new fill

  const intent = await getExecutionIntentById(intentId, userId);
  if (!intent) return;

  await insertExecutionFill({
    id: crypto.randomUUID(),
    executionIntentId: intentId,
    userId,
    fillSequence: existingFills.length + 1,
    orderedQty: intent.orderedQty ?? intent.intentJson.quantity,
    filledQty: status.filledQty,
    remainingQty: status.remainingQty ?? 0,
    fillPrice: status.fillPrice,
    fillAt: new Date().toISOString(),
    commission: null,
    fees: null,
    brokerFillId: null,
    rawStatusFromBroker: status.rawStatus,
    createdAt: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION LINKING
// ─────────────────────────────────────────────────────────────────────────────

export async function linkExecutionToPosition(intentId: string, userId: string): Promise<void> {
  const intent = await getExecutionIntentById(intentId, userId);
  if (!intent || intent.state !== "FILLED") return;

  await insertPositionLink({
    id: crypto.randomUUID(),
    executionIntentId: intentId,
    userId,
    portfolioId: null, // v1: not linked to a specific portfolio record
    symbol: intent.symbol,
    linkStrategy: "broker_sync",
    linkedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  await atomicTransitionState(intentId, userId, "FILLED", "POSITION_LINKED", { linkedAt: new Date().toISOString() });

  // Fire-and-forget: trigger bounded broker portfolio refresh (does not block)
  setImmediate(async () => {
    try {
      const { invalidateBrokerCache } = await import("../broker/index");
      invalidateBrokerCache(userId);
    } catch { /* non-fatal */ }
  });
}
