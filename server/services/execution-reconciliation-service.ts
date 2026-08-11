/**
 * server/services/execution-reconciliation-service.ts — Sprint 2.8.6
 *
 * Reconciliation engine for SUBMISSION_UNKNOWN states.
 * Also handles startup recovery (stale SUBMISSION_IN_PROGRESS intents).
 *
 * INVARIANTS:
 *   - Reconciliation never auto-submits — it only READS broker state.
 *   - Uses strongest available ID: brokerOrderRef → clientOrderTag → cannot reconcile.
 *   - Symbol-only match is never used.
 *   - State transitions always validated via ALLOWED_TRANSITIONS before applying.
 *   - Startup recovery marks stale intents as SUBMISSION_UNKNOWN (never retries).
 */

import type { ExecutionIntent, ExecutionIntentState, CanonicalBrokerOrderStatus } from "../../shared/execution-intent-types";
import { ALLOWED_TRANSITIONS } from "../../shared/execution-intent-types";
import {
  getExecutionIntentById,
  atomicTransitionState,
  getStaleSubmissionInProgressIntents,
} from "./execution-intent-tables";
import { normalizeToCanonicalStatus } from "./execution-final-validation-service";
import { syncFillFromBrokerStatus, linkExecutionToPosition } from "./execution-submission-service";
import type { BrokerStatusQueryResult } from "./execution-submission-service";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE BROKER QUERY ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationBrokerAdapter {
  queryOrderByRef(userId: string, brokerOrderRef: string): Promise<BrokerStatusQueryResult | null>;
  queryOrdersByTag(userId: string, clientOrderTag: string): Promise<BrokerStatusQueryResult[]>;
}

class LiveReconciliationAdapter implements ReconciliationBrokerAdapter {
  async queryOrderByRef(userId: string, brokerOrderRef: string): Promise<BrokerStatusQueryResult | null> {
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
          ? found.qty - (found.filledQty ?? 0) : null,
      };
    } catch {
      return null;
    }
  }

  async queryOrdersByTag(userId: string, clientOrderTag: string): Promise<BrokerStatusQueryResult[]> {
    // Most providers don't support tag-based lookup; return empty
    return [];
  }
}

let _reconcileAdapter: ReconciliationBrokerAdapter = new LiveReconciliationAdapter();

export function setReconciliationAdapter(adapter: ReconciliationBrokerAdapter): void {
  _reconcileAdapter = adapter;
}
export function resetReconciliationAdapter(): void {
  _reconcileAdapter = new LiveReconciliationAdapter();
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILE SINGLE INTENT
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconcileResult {
  intentId: string;
  previousState: ExecutionIntentState;
  newState: ExecutionIntentState | null;
  brokerStatus: CanonicalBrokerOrderStatus | null;
  message: string;
  reconciled: boolean;
}

export async function reconcileExecutionIntent(
  intentId: string,
  userId: string,
): Promise<ReconcileResult> {
  const intent = await getExecutionIntentById(intentId, userId);
  if (!intent) {
    return { intentId, previousState: "INTENT_CREATED", newState: null, brokerStatus: null, message: "Intent not found.", reconciled: false };
  }

  const prevState = intent.state;

  // Only reconcile states that need it
  const reconcilableStates: ExecutionIntentState[] = [
    "SUBMISSION_UNKNOWN", "BROKER_ACCEPTED", "OPEN", "PARTIALLY_FILLED",
    "SANDBOX_SUBMISSION_IN_PROGRESS", "SUBMISSION_IN_PROGRESS",
  ];
  if (!reconcilableStates.includes(intent.state)) {
    return { intentId, previousState: prevState, newState: prevState, brokerStatus: null, message: `State ${intent.state} does not require reconciliation.`, reconciled: false };
  }

  // ── Query broker using strongest available ID ────────────────────────────
  let brokerStatus: BrokerStatusQueryResult | null = null;

  if (intent.brokerOrderRef) {
    brokerStatus = await _reconcileAdapter.queryOrderByRef(userId, intent.brokerOrderRef);
  }

  if (!brokerStatus && intent.clientOrderTag) {
    const byTag = await _reconcileAdapter.queryOrdersByTag(userId, intent.clientOrderTag);
    brokerStatus = byTag[0] ?? null;
  }

  if (!brokerStatus) {
    await atomicTransitionState(intentId, userId, intent.state as any, intent.state as any, {
      reconciledAt: new Date().toISOString(),
    });
    return { intentId, previousState: prevState, newState: intent.state, brokerStatus: null, message: "Could not locate order at broker using available identifiers. Manual investigation required.", reconciled: false };
  }

  const canonical = brokerStatus.canonicalStatus;
  const newState = mapBrokerStatusToIntentState(canonical, intent.state);

  if (!newState || !ALLOWED_TRANSITIONS[intent.state].includes(newState)) {
    return { intentId, previousState: prevState, newState: intent.state, brokerStatus: canonical, message: `Cannot transition from ${intent.state} to ${newState} (not allowed). Manual review required.`, reconciled: false };
  }

  // ── Apply state transition ───────────────────────────────────────────────
  const now = new Date().toISOString();
  const extra: any = {
    reconciledAt: now,
    brokerOrderRef: brokerStatus.brokerOrderRef ?? intent.brokerOrderRef,
  };
  if (brokerStatus.filledQty !== null) extra.filledQty = brokerStatus.filledQty;
  if (brokerStatus.fillPrice !== null) extra.fillPrice = brokerStatus.fillPrice;
  if (canonical === "FILLED" || canonical === "PARTIALLY_FILLED") extra.filledAt = now;

  const transitioned = await atomicTransitionState(intentId, userId, intent.state as any, newState, extra);

  // ── Sync fills if filled ─────────────────────────────────────────────────
  if (transitioned && (canonical === "FILLED" || canonical === "PARTIALLY_FILLED")) {
    await syncFillFromBrokerStatus(intentId, userId, brokerStatus);
  }

  // ── Auto-link position after fill ───────────────────────────────────────
  if (transitioned && canonical === "FILLED" && newState === "FILLED") {
    setImmediate(() => linkExecutionToPosition(intentId, userId).catch(() => {}));
  }

  return {
    intentId,
    previousState: prevState,
    newState,
    brokerStatus: canonical,
    message: transitioned
      ? `Reconciled: ${prevState} → ${newState} (broker status: ${canonical})`
      : `Reconcile attempted but state already changed (concurrent update).`,
    reconciled: transitioned,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP RECOVERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find stale SUBMISSION_IN_PROGRESS intents and mark them SUBMISSION_UNKNOWN.
 * Called once at server startup. Never retries or auto-submits.
 */
export async function reconcileStaleExecutionIntents(
  olderThanMs = 120_000,
): Promise<{ recovered: number; ids: string[] }> {
  try {
    const stale = await getStaleSubmissionInProgressIntents(olderThanMs);
    const ids: string[] = [];

    for (const intent of stale) {
      const inProgressState = intent.state as any;
      const moved = await atomicTransitionState(
        intent.id, intent.userId,
        inProgressState, "SUBMISSION_UNKNOWN",
        {
          errorCode: "EI_SUBMISSION_UNKNOWN",
          errorMessage: "Intent was found in SUBMISSION_IN_PROGRESS after server restart. Order status unknown — reconcile before retrying.",
          reconciledAt: new Date().toISOString(),
        },
      );
      if (moved) {
        ids.push(intent.id);
        console.warn(`[ExecutionReconciliation] Startup recovery: ${intent.id} (${intent.userId.substring(0, 8)}...) → SUBMISSION_UNKNOWN`);
      }
    }

    return { recovered: ids.length, ids };
  } catch (e: any) {
    console.error("[ExecutionReconciliation] Startup recovery error:", e?.message);
    return { recovered: 0, ids: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL STATUS → INTENT STATE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

function mapBrokerStatusToIntentState(
  canonical: CanonicalBrokerOrderStatus,
  currentState: ExecutionIntentState,
): ExecutionIntentState | null {
  switch (canonical) {
    case "FILLED":          return "FILLED";
    case "PARTIALLY_FILLED": return "PARTIALLY_FILLED";
    case "OPEN":
    case "PENDING":         return "OPEN";
    case "CANCELLED":       return "CANCELLED";
    case "REJECTED":        return "REJECTED";
    case "EXPIRED":         return "EXPIRED_AT_BROKER";
    case "UNKNOWN":         return currentState === "SUBMISSION_UNKNOWN" ? "SUBMISSION_UNKNOWN" : null;
    default:                return null;
  }
}
