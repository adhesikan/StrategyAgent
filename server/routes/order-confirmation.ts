/**
 * server/routes/order-confirmation.ts — Sprint 2.8.5
 *
 * API routes for Review, Consent & Final Order Confirmation.
 *
 * PERMANENT INVARIANTS:
 *   - NO broker order submission at any point in this file.
 *   - brokerSubmissionEnabled: false everywhere.
 *   - userId is ALWAYS derived from session — never from client body.
 *   - snapshotHash is ALWAYS computed server-side — never trusted from client.
 *   - FORBIDDEN fields from client body → immediate HTTP 400.
 *   - BLOCKED readiness → snapshot creation rejected.
 *   - Confirmation is idempotent (same snapshotId + userId → same result).
 *
 * Routes:
 *   GET  /api/execution/order-confirmation/health          (static — before dynamic)
 *   POST /api/trade-plans/:id/final-review                 (create snapshot)
 *   GET  /api/trade-plans/:id/final-review                 (get latest snapshot)
 *   POST /api/trade-plans/:id/final-review/:sid/confirm    (confirm)
 */

import type { Express, RequestHandler } from "express";
import crypto from "crypto";
import {
  buildFinalOrderReviewSnapshot,
  validateSnapshotEligibility,
  revalidateBeforeConfirm,
  checkAllRequiredAcknowledgementsPresent,
  persistSnapshot,
  getLatestSnapshot,
  getSnapshotById,
  invalidateExistingSnapshots,
  getExistingConfirmation,
  persistConfirmation,
  updateSnapshotState,
  logAuditEvent,
  getOrderConfirmationHealth,
  ensureOrderConfirmationTables,
} from "../services/order-confirmation-service";
import { getLatestReadinessResult } from "../services/execution-readiness-service";
import {
  CR_SNAPSHOT_NOT_FOUND,
  CR_MISSING_REQUIRED_ACK,
  CR_OWNERSHIP_VIOLATION,
  CR_FORBIDDEN_FIELD,
  DEFAULT_FINAL_REVIEW_CONFIG,
  BROKER_SUBMISSION_ENABLED,
  FINAL_REVIEW_DISCLAIMER,
} from "../../shared/order-confirmation-types";
import type { OrderConfirmation } from "../../shared/order-confirmation-types";

export { ensureOrderConfirmationTables };

// ─────────────────────────────────────────────────────────────────────────────
// FORBIDDEN CLIENT FIELDS — same defensive pattern as Sprint 2.8.4
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_CLIENT_FIELDS = new Set([
  "userId", "user_id",
  "snapshotHash", "snapshot_hash",
  "executionReadinessId", "readinessId",
  "readinessStatus",
  "brokerCapabilities", "optionsPermission",
  "optionsLevel", "accountStatus", "connected",
  "sessionToken", "accessToken", "brokerToken",
  "forceConfirm", "bypassValidation", "skipRevalidation",
  "approved", "authorized", "brokerAccountId",
  "buyingPower", "accountBalance", "balance",
  "positions", "overrideStatus", "forceReady",
]);

function checkForbiddenFields(body: Record<string, unknown>): string | null {
  for (const field of Object.keys(body)) {
    if (FORBIDDEN_CLIENT_FIELDS.has(field)) return field;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function registerOrderConfirmationRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // ── Health (static — must be before dynamic :id routes) ─────────────────
  app.get("/api/execution/order-confirmation/health", (_req, res) => {
    res.json({
      ok: true,
      ...getOrderConfirmationHealth(),
      brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
      disclaimer: FINAL_REVIEW_DISCLAIMER,
    });
  });

  // ── Create final review snapshot ────────────────────────────────────────
  app.post(
    "/api/trade-plans/:id/final-review",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = req.session?.userId as string | undefined;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const tradePlanId = req.params.id;
        const body = (req.body ?? {}) as Record<string, unknown>;

        // Forbidden field guard
        const forbiddenField = checkForbiddenFields(body);
        if (forbiddenField) {
          return res.status(400).json({
            code: CR_FORBIDDEN_FIELD,
            message: `Field '${forbiddenField}' may not be supplied by the client.`,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Load execution readiness — always server-side, never from client
        const readiness = await getLatestReadinessResult(tradePlanId, userId);

        // Check eligibility — BLOCKED readiness → reject immediately
        const eligibility = validateSnapshotEligibility(readiness);
        if (!eligibility.eligible) {
          return res.status(422).json({
            code: eligibility.errorCode,
            message: eligibility.errorMessage,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Attempt to load the current options preview for the readiness's draft
        // Uses dynamic import to avoid circular dependency with options-preview-service
        let preview: import("../../shared/options-order-preview-types").OptionsOrderPreview | null = null;
        if (readiness!.orderDraftId) {
          try {
            const previewMod = await import("../services/options-preview-service");
            const result = await previewMod.generateOptionsPreview(
              readiness!.orderDraftId,
              { userId, tradePlanId },
            ).catch(() => null);
            preview = result?.preview ?? null;
          } catch {
            // Preview unavailable — snapshot will have minimal leg/pricing data
          }
        }

        // Invalidate any existing non-confirmed snapshots for this user/plan
        // This is the key invariant: a new snapshot always supersedes old ones
        await invalidateExistingSnapshots(tradePlanId, userId, "new_review_snapshot_created");

        // Build the immutable snapshot
        const config = DEFAULT_FINAL_REVIEW_CONFIG;
        const snapshot = preview
          ? buildFinalOrderReviewSnapshot(preview, readiness!, userId, tradePlanId, config)
          : buildMinimalSnapshot(readiness!, userId, tradePlanId, config);

        // Persist
        await persistSnapshot(snapshot);

        // Fire-and-forget audit event
        logAuditEvent(
          "FINAL_REVIEW_CREATED",
          userId,
          tradePlanId,
          snapshot.id,
          snapshot.snapshotHash,
          { strategyFamily: snapshot.strategyFamily, symbol: snapshot.symbol },
        );

        return res.json({
          snapshot,
          acknowledgements: snapshot.acknowledgements,
          expiresAt: snapshot.expiresAt,
          brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
        });
      } catch (e: any) {
        console.error("[order-confirmation] create snapshot error:", e?.message);
        return res.status(500).json({ message: "Failed to create review snapshot" });
      }
    },
  );

  // ── Get current review snapshot ─────────────────────────────────────────
  app.get(
    "/api/trade-plans/:id/final-review",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = req.session?.userId as string | undefined;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const tradePlanId = req.params.id;
        const snapshot = await getLatestSnapshot(tradePlanId, userId);

        if (!snapshot) {
          return res.status(404).json({
            code: CR_SNAPSHOT_NOT_FOUND,
            message: "No review snapshot found for this trade plan.",
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Update state: CREATED → VIEWED; CREATED/VIEWED + expired → EXPIRED
        const now = new Date();
        if (snapshot.state === "CREATED" || snapshot.state === "VIEWED") {
          if (new Date(snapshot.expiresAt) <= now) {
            await updateSnapshotState(snapshot.id, "EXPIRED");
            snapshot.state = "EXPIRED";
            logAuditEvent("FINAL_REVIEW_EXPIRED", userId, tradePlanId, snapshot.id, snapshot.snapshotHash);
          } else if (snapshot.state === "CREATED") {
            await updateSnapshotState(snapshot.id, "VIEWED");
            snapshot.state = "VIEWED";
            logAuditEvent("FINAL_REVIEW_VIEWED", userId, tradePlanId, snapshot.id, snapshot.snapshotHash);
          }
        }

        const confirmation = await getExistingConfirmation(snapshot.id, userId);

        return res.json({
          snapshot,
          confirmation: confirmation ?? null,
          brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
        });
      } catch (e: any) {
        console.error("[order-confirmation] get snapshot error:", e?.message);
        return res.status(500).json({ message: "Failed to load review snapshot" });
      }
    },
  );

  // ── Confirm ─────────────────────────────────────────────────────────────
  app.post(
    "/api/trade-plans/:id/final-review/:snapshotId/confirm",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = req.session?.userId as string | undefined;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const tradePlanId = req.params.id;
        const snapshotId = req.params.snapshotId;
        const body = (req.body ?? {}) as Record<string, unknown>;

        // Forbidden field guard
        const forbiddenField = checkForbiddenFields(body);
        if (forbiddenField) {
          return res.status(400).json({
            code: CR_FORBIDDEN_FIELD,
            message: `Field '${forbiddenField}' may not be supplied by the client.`,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Client sends only acknowledgement codes — all other data comes from server
        const submittedCodes: string[] = Array.isArray(body.acknowledgementCodes)
          ? (body.acknowledgementCodes as string[]).filter((c): c is string => typeof c === "string")
          : [];

        // Load snapshot — ownership validated via userId scope in DB query
        const snapshot = await getSnapshotById(snapshotId, userId);
        if (!snapshot) {
          return res.status(404).json({
            code: CR_SNAPSHOT_NOT_FOUND,
            message: "Review snapshot not found.",
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Belt-and-suspenders ownership check
        if (snapshot.userId !== userId) {
          return res.status(403).json({
            code: CR_OWNERSHIP_VIOLATION,
            message: "Snapshot does not belong to the authenticated user.",
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Idempotency — return existing confirmation unchanged
        const existing = await getExistingConfirmation(snapshotId, userId);
        if (existing) {
          logAuditEvent("FINAL_REVIEW_CONFIRMED", userId, tradePlanId, snapshotId, existing.snapshotHash, { idempotent: true });
          return res.json({
            confirmation: existing,
            idempotent: true,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
            message: "Order Confirmed",
            nextStep: "Ready for the next submission step.",
          });
        }

        // Server-side revalidation — load current readiness
        const currentReadiness = await getLatestReadinessResult(tradePlanId, userId);

        // Attempt to load current preview for change detection
        let currentPreview: import("../../shared/options-order-preview-types").OptionsOrderPreview | null = null;
        try {
          const previewMod = await import("../services/options-preview-service");
          const result = await previewMod.generateOptionsPreview(
            snapshot.orderPreviewId,
            { userId, tradePlanId },
          ).catch(() => null);
          currentPreview = result?.preview ?? null;
        } catch { /* best-effort */ }

        const now = new Date();
        const revalidation = revalidateBeforeConfirm(snapshot, currentReadiness, currentPreview, now);

        if (!revalidation.valid) {
          // Update DB state to reflect the new status
          if (revalidation.errorCode === "CR_SNAPSHOT_EXPIRED") {
            await updateSnapshotState(snapshotId, "EXPIRED");
            logAuditEvent("FINAL_REVIEW_EXPIRED", userId, tradePlanId, snapshotId, snapshot.snapshotHash);
          } else {
            await updateSnapshotState(snapshotId, "INVALIDATED", now.toISOString(), revalidation.errorCode ?? "changed");
            logAuditEvent("FINAL_REVIEW_INVALIDATED", userId, tradePlanId, snapshotId, snapshot.snapshotHash, { reason: revalidation.errorCode });
          }
          return res.status(422).json({
            code: revalidation.errorCode,
            message: revalidation.errorMessage,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Validate required acknowledgements
        const ackCheck = checkAllRequiredAcknowledgementsPresent(submittedCodes, snapshot.acknowledgements);
        if (!ackCheck.valid) {
          return res.status(422).json({
            code: CR_MISSING_REQUIRED_ACK,
            message: `Missing required acknowledgements: ${ackCheck.missing.join(", ")}`,
            missing: ackCheck.missing,
            brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          });
        }

        // Build and persist confirmation — bound to exact snapshot hash
        const confirmation: OrderConfirmation = {
          id: crypto.randomUUID(),
          snapshotId,
          userId,
          status: "CONFIRMED",
          acknowledgementCodes: submittedCodes,
          confirmedAt: now.toISOString(),
          ipMetadata: null,  // not collected in v1 per privacy policy
          userAgentMetadata: null,
          snapshotHash: snapshot.snapshotHash,  // cryptographic binding
        };

        await persistConfirmation(confirmation);
        await updateSnapshotState(snapshotId, "CONFIRMED");

        // Audit (fire-and-forget)
        logAuditEvent(
          "ORDER_CONFIRMED",
          userId,
          tradePlanId,
          snapshotId,
          snapshot.snapshotHash,
          { strategyFamily: snapshot.strategyFamily, symbol: snapshot.symbol, ackCount: submittedCodes.length },
        );

        return res.json({
          confirmation,
          brokerSubmissionEnabled: BROKER_SUBMISSION_ENABLED,
          message: "Order Confirmed",
          nextStep: "Ready for the next submission step.",
        });
      } catch (e: any) {
        console.error("[order-confirmation] confirm error:", e?.message);
        return res.status(500).json({ message: "Failed to confirm order review" });
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL SNAPSHOT FALLBACK
// When the options preview cannot be loaded, build a minimal snapshot from
// readiness data only. Legs and pricing will be empty/null.
// ─────────────────────────────────────────────────────────────────────────────

function buildMinimalSnapshot(
  readiness: import("../../shared/execution-readiness-types").ExecutionReadinessResult,
  userId: string,
  tradePlanId: string,
  config: import("../../shared/order-confirmation-types").FinalReviewConfig,
): import("../../shared/order-confirmation-types").FinalOrderReviewSnapshot {
  const {
    buildFinalOrderReviewSnapshot: _unused,  // not used for minimal
    computeCanonicalPayload,
    computeSnapshotHash,
  } = require("../services/order-confirmation-service");

  const now = new Date();
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.snapshotTtlSeconds * 1000).toISOString();

  const capital = readiness.capitalEstimate?.estimatedRequirementUsd ?? null;
  const pricing = { pricingType: "UNKNOWN" as const, netPrice: null, limitPrice: null, estimatedNotional: null, multiplier: 100 };
  const economics = {
    estimatedMaxProfit: null, estimatedMaxLoss: capital,
    estimatedCapitalRequired: capital, breakEvenPoints: [],
    capitalSource: capital !== null ? "readiness_estimate" as const : "unavailable" as const,
    profitSource: "unavailable" as const,
    lossSource: capital !== null ? "readiness_estimate" as const : "unavailable" as const,
    feesDisclaimer: "Broker fees and commissions may not be included.",
  };
  const readinessRef = {
    status: readiness.status as "READY" | "READY_WITH_WARNINGS",
    blockerCount: readiness.blockerCount,
    warningCount: readiness.warningCount,
    findingCodes: readiness.findings.map(f => f.code),
  };
  const acknowledgements = [
    { code: "ACK_REVIEWED_ORDER", required: true, title: "Order Reviewed", text: "I have reviewed the order details." },
    { code: "ACK_OPTIONS_RISK", required: true, title: "Options Risk", text: "I understand options involve risk and may expire worthless." },
  ];
  const marketDataObservedAt = readiness.evaluatedAt;

  const canonicalPayload = computeCanonicalPayload({
    tradePlanId, orderPreviewId: readiness.orderDraftId ?? "unknown",
    executionReadinessId: readiness.id, userId,
    strategyFamily: "unknown", symbol: "unknown",
    legs: [], quantity: 0, pricing, economics,
    readiness: readinessRef, marketDataObservedAt,
    reviewedDataVersion: config.reviewedDataVersion,
  });

  return {
    id, tradePlanId,
    orderPreviewId: readiness.orderDraftId ?? "unknown",
    executionReadinessId: readiness.id,
    userId, strategyFamily: "unknown", strategyLabel: "Unknown Strategy",
    symbol: "unknown", companyName: null, legs: [], quantity: 0,
    pricing, economics, readiness: readinessRef, acknowledgements,
    marketDataObservedAt, reviewedDataVersion: config.reviewedDataVersion,
    snapshotHash: computeSnapshotHash(canonicalPayload),
    state: "CREATED", createdAt, expiresAt, invalidatedAt: null, invalidationReason: null,
  };
}
