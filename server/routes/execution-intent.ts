/**
 * server/routes/execution-intent.ts — Sprint 2.8.6
 *
 * API routes for Sandbox/Test-Account Broker Submission.
 *
 * PERMANENT INVARIANTS:
 *   - NO broker submission from AI, scheduler, or background agent.
 *   - userId always from session — never from client body.
 *   - PRODUCTION mode always blocked.
 *   - Forbidden client fields → 400 immediate.
 *   - Submit body: {} only (no order details from client).
 *   - Static /health route before dynamic /:id routes.
 *
 * Routes:
 *   GET  /api/executions/health                        (static)
 *   POST /api/executions/from-confirmation/:cid        (create intent)
 *   GET  /api/executions                               (list user's intents)
 *   GET  /api/executions/:id                           (get intent)
 *   GET  /api/executions/:id/status                    (status + fills)
 *   GET  /api/executions/:id/activity                  (audit events)
 *   POST /api/executions/:id/submit                    (THE ONLY submission endpoint)
 *   POST /api/executions/:id/reconcile                 (trigger reconciliation)
 *   POST /api/executions/:id/cancel                    (cancel if OPEN/BROKER_ACCEPTED)
 */

import type { Express, RequestHandler } from "express";
import {
  getExecutionIntentById,
  getExecutionIntentsByUser,
  getExecutionIntentByConfirmation,
  getFillsByIntentId,
  atomicTransitionState,
} from "../services/execution-intent-tables";
import { submitExecutionIntent, createIntentFromConfirmation } from "../services/execution-submission-service";
import { reconcileExecutionIntent } from "../services/execution-reconciliation-service";
import {
  isExecutionEnabled,
  getExecutionMode,
  isTestLiveSafetyGateOpen,
} from "../services/execution-policy";
import {
  EXECUTION_INTENT_COMPLIANCE_LABELS,
  SUBMISSION_UNKNOWN_USER_MESSAGE,
  TEST_LIVE_DISCLAIMER,
  PRODUCTION_SUBMISSION_NOT_ENABLED,
  FORBIDDEN_INTENT_CLIENT_FIELDS,
  EI_FORBIDDEN_FIELD,
  EI_OWNERSHIP_VIOLATION,
  EI_INTENT_NOT_FOUND,
  EI_WRONG_STATE_FOR_SUBMIT,
  EI_PRODUCTION_NOT_ENABLED,
  type ExecutionIntentMode,
  type ExecutionIntentOrderDetails,
} from "../../shared/execution-intent-types";

// ─────────────────────────────────────────────────────────────────────────────
// FORBIDDEN FIELDS — client may never supply these
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_FIELD_SET = new Set(FORBIDDEN_INTENT_CLIENT_FIELDS);

function checkForbiddenFields(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELD_SET.has(key)) return key;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function executionModeLabel(mode: string): string {
  return EXECUTION_INTENT_COMPLIANCE_LABELS[mode.toUpperCase()] ?? mode;
}

function sanitizeIntentForClient(intent: any): any {
  if (!intent) return null;
  const { intentJson, ...rest } = intent;
  // Strip order details that could leak sensitive pricing context
  return {
    ...rest,
    instrumentType: rest.instrumentType,
    structureType: rest.structureType,
    symbol: rest.symbol,
    orderedQty: rest.orderedQty,
    // Never expose accountRef — only masked version
    accountRef: undefined,
    orderSummary: intentJson
      ? {
          side: intentJson.side,
          quantity: intentJson.quantity,
          orderType: intentJson.orderType,
          duration: intentJson.duration,
          estimatedNotional: intentJson.estimatedNotional ?? null,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function registerExecutionIntentRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // ── Health (static — MUST be before /:id dynamic routes) ────────────────
  app.get("/api/executions/health", (_req, res) => {
    const mode = getExecutionMode();
    res.json({
      ok: true,
      executionEnabled: isExecutionEnabled(),
      executionMode: mode,
      executionModeLabel: executionModeLabel(mode),
      productionSubmissionNotEnabled: PRODUCTION_SUBMISSION_NOT_ENABLED,
      checkedAt: new Date().toISOString(),
    });
  });

  // ── Create ExecutionIntent from confirmed order ───────────────────────────
  app.post(
    "/api/executions/from-confirmation/:confirmationId",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = req.session?.userId as string | undefined;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const { confirmationId } = req.params;
        const body = (req.body ?? {}) as Record<string, unknown>;

        // Forbidden field guard
        const forbidden = checkForbiddenFields(body);
        if (forbidden) {
          return res.status(400).json({ code: EI_FORBIDDEN_FIELD, message: `Field '${forbidden}' may not be supplied by the client.` });
        }

        // Check for existing intent for this confirmation
        const existing = await getExecutionIntentByConfirmation(confirmationId, userId);
        if (existing) {
          return res.json({ intent: sanitizeIntentForClient(existing), created: false, idempotent: true });
        }

        // Load the confirmation from DB
        const { pool } = await import("../db");
        const confRow = await pool.query(
          `SELECT * FROM order_confirmations WHERE id = $1 AND user_id = $2`,
          [confirmationId, userId],
        );
        if (!confRow.rows[0]) {
          return res.status(404).json({ code: "EI_CONFIRMATION_NOT_FOUND", message: "Confirmation not found." });
        }
        const conf = confRow.rows[0];
        if (conf.status && conf.status !== "CONFIRMED") {
          return res.status(422).json({ code: "EI_CONFIRMATION_NOT_CONFIRMED", message: "Confirmation is not in CONFIRMED state." });
        }

        // Load snapshot to get order details
        const snapRow = await pool.query(
          `SELECT * FROM final_order_review_snapshots WHERE id = $1 AND user_id = $2`,
          [conf.snapshot_id, userId],
        );
        if (!snapRow.rows[0]) {
          return res.status(404).json({ code: "EI_SNAPSHOT_NOT_FOUND", message: "Review snapshot not found." });
        }
        const snap = snapRow.rows[0];
        const snapJson = typeof snap.snapshot_json === "string"
          ? JSON.parse(snap.snapshot_json) : snap.snapshot_json;

        // Load order draft to get order details
        const draftRow = await pool.query(
          `SELECT * FROM order_drafts WHERE id = $1 AND user_id = $2`,
          [snapJson?.orderPreviewId ?? "", userId],
        );

        // Get broker connection for provider + account
        const { storage } = await import("../storage");
        const brokerConn = await storage.getBrokerConnectionWithToken(userId);
        if (!brokerConn?.isConnected || !brokerConn.provider) {
          return res.status(422).json({ code: "EI_BROKER_NOT_CONNECTED", message: "No connected broker found. Connect a broker before creating an execution intent." });
        }

        // Determine execution mode from current runtime
        const runtimeMode = getExecutionMode();
        const modeMap: Record<string, ExecutionIntentMode> = {
          sandbox: "SANDBOX",
          test_live: "TEST_LIVE",
          production: "PRODUCTION",
        };
        const executionMode: ExecutionIntentMode = modeMap[runtimeMode] ?? "DISABLED";

        if (executionMode === "DISABLED") {
          return res.status(422).json({ code: "EI_EXECUTION_DISABLED", message: "Execution is currently disabled." });
        }
        if (executionMode === "PRODUCTION") {
          return res.status(422).json({ code: EI_PRODUCTION_NOT_ENABLED, message: "General production customer execution is not enabled in this release." });
        }

        // Extract order details from draft/snapshot
        const draft = draftRow.rows[0];
        const draftJson = draft?.draft_json
          ? (typeof draft.draft_json === "string" ? JSON.parse(draft.draft_json) : draft.draft_json)
          : null;

        const legs = Array.isArray(snapJson?.legs) ? snapJson.legs : [];
        const instrumentType = snap.instrument_type ?? (legs.length > 1 ? "multi_leg_option" : legs.length === 1 ? "single_leg_option" : "equity");

        const orderDetails: ExecutionIntentOrderDetails = {
          side: draftJson?.side ?? "buy",
          quantity: draftJson?.quantity ?? snapJson?.quantity ?? 1,
          orderType: draftJson?.orderType ?? "limit",
          limitPrice: draftJson?.limitPrice ?? snapJson?.pricing?.limitPrice ?? null,
          stopPrice: draftJson?.stopPrice ?? null,
          duration: draftJson?.duration ?? "day",
          estimatedNotional: snapJson?.pricing?.estimatedNotional ?? null,
          optionSymbol: legs[0]?.contractSymbol ?? draftJson?.optionSymbol ?? undefined,
          optionSide: draftJson?.optionSide ?? undefined,
          legs: legs.length > 1 ? legs.map((l: any) => ({
            contractSymbol: l.contractSymbol,
            optionSide: l.canonicalIntent ?? "buy_to_open",
            quantity: l.quantity ?? 1,
            limitPrice: l.limitPriceContribution ?? null,
          })) : undefined,
        };

        const { maskAccountId } = await import("../services/broker-execution-adapter");
        const accountRef = brokerConn.preferredAccountId ?? "";
        const accountRefMasked = maskAccountId(accountRef);

        const intent = await createIntentFromConfirmation({
          userId,
          confirmationId,
          confirmationSnapshotHash: conf.snapshot_hash,
          tradePlanId: snapJson?.tradePlanId ?? snap.trade_plan_id ?? "",
          provider: brokerConn.provider,
          accountRef,
          accountRefMasked,
          executionMode,
          instrumentType,
          structureType: snap.structure_type ?? draftJson?.structureType ?? "unknown",
          symbol: snapJson?.symbol ?? snap.symbol ?? "UNKNOWN",
          orderDetails,
        });

        return res.status(201).json({
          intent: sanitizeIntentForClient(intent),
          created: true,
          executionMode,
          executionModeLabel: executionModeLabel(executionMode),
          disclaimer: executionMode === "TEST_LIVE" ? TEST_LIVE_DISCLAIMER : undefined,
        });
      } catch (e: any) {
        console.error("[execution-intent] create from confirmation error:", e?.message);
        if (e?.code === "23505") { // unique constraint violation
          return res.status(409).json({ code: "EI_CONFIRMATION_ALREADY_USED", message: "This confirmation has already been used to create an execution intent." });
        }
        return res.status(500).json({ message: "Failed to create execution intent." });
      }
    },
  );

  // ── List user's intents ──────────────────────────────────────────────────
  app.get("/api/executions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 50);
      const intents = await getExecutionIntentsByUser(userId, limit);
      return res.json({ intents: intents.map(sanitizeIntentForClient), count: intents.length });
    } catch (e: any) {
      console.error("[execution-intent] list error:", e?.message);
      return res.status(500).json({ message: "Failed to list execution intents." });
    }
  });

  // ── Get single intent ────────────────────────────────────────────────────
  app.get("/api/executions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const intent = await getExecutionIntentById(req.params.id, userId);
      if (!intent) return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Execution intent not found." });
      const fills = await getFillsByIntentId(intent.id);
      return res.json({
        intent: sanitizeIntentForClient(intent),
        fills,
        executionModeLabel: executionModeLabel(intent.executionMode),
        submissionUnknownMessage: intent.state === "SUBMISSION_UNKNOWN" ? SUBMISSION_UNKNOWN_USER_MESSAGE : null,
      });
    } catch (e: any) {
      console.error("[execution-intent] get error:", e?.message);
      return res.status(500).json({ message: "Failed to load execution intent." });
    }
  });

  // ── Status + fills ────────────────────────────────────────────────────────
  app.get("/api/executions/:id/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const intent = await getExecutionIntentById(req.params.id, userId);
      if (!intent) return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Execution intent not found." });
      const fills = await getFillsByIntentId(intent.id);
      return res.json({
        id: intent.id,
        state: intent.state,
        executionMode: intent.executionMode,
        executionModeLabel: executionModeLabel(intent.executionMode),
        brokerOrderRef: intent.state !== "INTENT_CREATED" ? intent.brokerOrderRef : null,
        filledQty: intent.filledQty,
        orderedQty: intent.orderedQty,
        fillPrice: intent.fillPrice,
        fills,
        submittedAt: intent.submittedAt,
        acknowledgedAt: intent.acknowledgedAt,
        reconciledAt: intent.reconciledAt,
        filledAt: intent.filledAt,
        errorCode: intent.errorCode,
        updatedAt: intent.updatedAt,
        submissionUnknownMessage: intent.state === "SUBMISSION_UNKNOWN" ? SUBMISSION_UNKNOWN_USER_MESSAGE : null,
      });
    } catch (e: any) {
      console.error("[execution-intent] status error:", e?.message);
      return res.status(500).json({ message: "Failed to get execution status." });
    }
  });

  // ── Activity / audit events ───────────────────────────────────────────────
  app.get("/api/executions/:id/activity", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const intent = await getExecutionIntentById(req.params.id, userId);
      if (!intent) return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Not found." });
      const { pool } = await import("../db");
      const auditRows = await pool.query(
        `SELECT * FROM execution_audit_events WHERE trade_plan_id = $1 AND user_id = $2 ORDER BY occurred_at DESC LIMIT 50`,
        [intent.tradePlanId, userId],
      );
      return res.json({ activity: auditRows.rows, intentId: intent.id });
    } catch (e: any) {
      console.error("[execution-intent] activity error:", e?.message);
      return res.status(500).json({ message: "Failed to load activity." });
    }
  });

  // ── THE ONLY SUBMISSION ENDPOINT ─────────────────────────────────────────
  app.post(
    "/api/executions/:id/submit",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = req.session?.userId as string | undefined;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const intentId = req.params.id;
        const body = (req.body ?? {}) as Record<string, unknown>;

        // Forbidden field guard — client body must be empty or contain only confirmationToken
        const forbidden = checkForbiddenFields(body);
        if (forbidden) {
          return res.status(400).json({ code: EI_FORBIDDEN_FIELD, message: `Field '${forbidden}' may not be supplied to the submit endpoint.` });
        }

        // AI hard block: X-Agent-Source header must not be present
        const agentSource = req.headers["x-agent-source"] as string | undefined;
        if (agentSource) {
          return res.status(403).json({ code: "EI_AI_SUBMISSION_BLOCKED", message: "Order submission is not permitted via automated agents or tools." });
        }

        // Load intent for context
        const intent = await getExecutionIntentById(intentId, userId);
        if (!intent) {
          return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Execution intent not found." });
        }

        // Ownership check
        if (intent.userId !== userId) {
          return res.status(403).json({ code: EI_OWNERSHIP_VIOLATION, message: "This intent does not belong to the authenticated user." });
        }

        if (intent.state !== "INTENT_CREATED") {
          return res.status(422).json({ code: EI_WRONG_STATE_FOR_SUBMIT, message: `Intent state is ${intent.state}. Only INTENT_CREATED intents can be submitted.`, state: intent.state });
        }

        // PRODUCTION block
        if (intent.executionMode === "PRODUCTION") {
          return res.status(422).json({ code: EI_PRODUCTION_NOT_ENABLED, message: "General production customer execution is not enabled in this release." });
        }

        // Build validation context from server-side broker data
        let connectedProvider: string | null = null;
        let brokerConnected = false;
        let connectedAccountRef: string | null = null;
        let snapshotExpiresAt: string | null = null;
        let currentSnapshotHash: string | null = null;
        let estimatedNotionalUsd: number | null = intent.intentJson.estimatedNotional ?? null;

        try {
          const { storage } = await import("../storage");
          const conn = await storage.getBrokerConnectionWithToken(userId);
          if (conn?.isConnected && conn.accessToken) {
            brokerConnected = true;
            connectedProvider = conn.provider ?? null;
            connectedAccountRef = conn.preferredAccountId ?? null;
          }
        } catch { /* non-fatal */ }

        try {
          const { pool } = await import("../db");
          const snapRow = await pool.query(
            `SELECT expires_at, snapshot_hash FROM order_confirmations WHERE id = $1 AND user_id = $2`,
            [intent.confirmationId, userId],
          );
          // Actually grab expires_at from the snapshot, not confirmation
          const snapDataRow = await pool.query(
            `SELECT expires_at, snapshot_hash FROM final_order_review_snapshots
             WHERE id = (SELECT snapshot_id FROM order_confirmations WHERE id = $1 AND user_id = $2)
             AND user_id = $2`,
            [intent.confirmationId, userId],
          );
          if (snapDataRow.rows[0]) {
            snapshotExpiresAt = snapDataRow.rows[0].expires_at?.toISOString() ?? null;
            currentSnapshotHash = snapDataRow.rows[0].snapshot_hash ?? null;
          }
        } catch { /* non-fatal */ }

        const validationContext = {
          connectedProvider,
          brokerConnected,
          connectedAccountRef,
          snapshotExpiresAt,
          currentSnapshotHash,
          estimatedNotionalUsd,
          buyingPowerUsd: null,
        };

        // Run submission
        const result = await submitExecutionIntent(intentId, userId, validationContext);

        if (result.ok) {
          return res.json({
            ok: true,
            state: result.state,
            brokerOrderRef: result.brokerOrderRef,
            clientOrderTag: result.clientOrderTag,
            intent: sanitizeIntentForClient(result.intent),
            executionModeLabel: executionModeLabel(intent.executionMode),
            message: intent.executionMode === "SANDBOX"
              ? "Order submitted to Paper Trading (sandbox)."
              : "Order submitted to Live Test Account.",
          });
        }

        const status = result.state === "SUBMISSION_UNKNOWN" ? 200 : 422;
        return res.status(status).json({
          ok: false,
          state: result.state,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          intent: sanitizeIntentForClient(result.intent),
          submissionUnknownMessage: result.state === "SUBMISSION_UNKNOWN" ? SUBMISSION_UNKNOWN_USER_MESSAGE : null,
        });

      } catch (e: any) {
        console.error("[execution-intent] submit error:", e?.message);
        return res.status(500).json({ message: "Submission failed due to an internal error." });
      }
    },
  );

  // ── Reconcile ────────────────────────────────────────────────────────────
  app.post("/api/executions/:id/reconcile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const intent = await getExecutionIntentById(req.params.id, userId);
      if (!intent) return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Not found." });
      if (intent.userId !== userId) return res.status(403).json({ code: EI_OWNERSHIP_VIOLATION, message: "Access denied." });

      const result = await reconcileExecutionIntent(req.params.id, userId);
      return res.json({ ...result });
    } catch (e: any) {
      console.error("[execution-intent] reconcile error:", e?.message);
      return res.status(500).json({ message: "Reconciliation failed." });
    }
  });

  // ── Cancel ───────────────────────────────────────────────────────────────
  app.post("/api/executions/:id/cancel", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const intent = await getExecutionIntentById(req.params.id, userId);
      if (!intent) return res.status(404).json({ code: EI_INTENT_NOT_FOUND, message: "Not found." });
      if (intent.userId !== userId) return res.status(403).json({ code: EI_OWNERSHIP_VIOLATION, message: "Access denied." });

      const cancellableStates = ["BROKER_ACCEPTED", "OPEN"];
      if (!cancellableStates.includes(intent.state)) {
        return res.status(422).json({ code: "EI_CANCEL_NOT_POSSIBLE", message: `Cannot cancel an intent in state ${intent.state}.` });
      }

      if (!intent.brokerOrderRef) {
        return res.status(422).json({ code: "EI_CANCEL_NO_ORDER_REF", message: "No broker order reference — cannot cancel." });
      }

      try {
        const { cancelBrokerOrder } = await import("../broker/index");
        const cancelResult = await cancelBrokerOrder(userId, intent.brokerOrderRef);
        if (cancelResult.success) {
          await atomicTransitionState(intent.id, userId, intent.state as any, "CANCELLED", {
            errorCode: null,
            errorMessage: null,
          });
          return res.json({ ok: true, state: "CANCELLED", message: cancelResult.message });
        }
        return res.status(422).json({ ok: false, message: cancelResult.message });
      } catch (e: any) {
        return res.status(500).json({ ok: false, message: `Cancel failed: ${e?.message}` });
      }
    } catch (e: any) {
      console.error("[execution-intent] cancel error:", e?.message);
      return res.status(500).json({ message: "Cancel failed." });
    }
  });
}

export { ensureExecutionIntentTables } from "../services/execution-intent-tables";
export { reconcileStaleExecutionIntents } from "../services/execution-reconciliation-service";
