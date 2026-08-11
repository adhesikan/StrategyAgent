/**
 * server/routes/equity-preview.ts — Sprint 2.8.2
 *
 * Routes for Equity Order Preview.
 *
 * PERMANENT INVARIANTS:
 *   - All endpoints are read-only regarding OrderDraft, TradePlan, Preflight.
 *   - No /confirm, /submit, /place routes.
 *   - Client may NOT submit: symbol, quantity, side, orderType, TIF, limitPrice, quote, account.
 *   - Those come exclusively from server-stored sources.
 *
 * BROKER BOUNDARY: read-only adapter only.
 * No placeOrder, submitOrder, replaceOrder, cancelOrder calls anywhere in this file.
 */

import type { Express, Request, Response } from "express";
import {
  generateEquityPreview,
  createDbEquityPreviewDeps,
  getEquityPreviewMetrics,
} from "../services/equity-preview-service";
import {
  EQUITY_PREVIEW_DISCLAIMER,
  EQUITY_PREVIEW_METHODOLOGY_VERSION,
} from "../../shared/equity-order-preview-types";

/** Forbidden client-injected fields. Server derives these from stored data only. */
const FORBIDDEN_CLIENT_FIELDS = new Set([
  "symbol", "quantity", "side", "sideIntent", "orderType", "timeInForce",
  "limitPrice", "quote", "bid", "ask", "account", "accountRef",
  "tradePlanVersion", "riskContext", "preflight", "broadExpressionType",
  "selectedBy", "selectedExpressionType",
]);

export function registerEquityPreviewRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
): void {

  // ── GET /api/execution/equity-preview/health ─────────────────────────────
  app.get("/api/execution/equity-preview/health", isAuthenticated, async (_req: Request, res: Response) => {
    const metrics = getEquityPreviewMetrics();
    return res.json({
      status: "ACTIVE",
      feature: "equity-order-preview",
      brokerSubmissionEnabled: metrics.brokerSubmissionEnabled,
      executionEnabled: process.env.BROKER_EXECUTION_ENABLED === "true",
      methodologyVersion: EQUITY_PREVIEW_METHODOLOGY_VERSION,
      disclaimer: EQUITY_PREVIEW_DISCLAIMER,
      metrics: {
        previewRequests: metrics.previewRequests,
        previewPasses: metrics.previewPasses,
        previewRequiresReview: metrics.previewRequiresReview,
        previewExpired: metrics.previewExpired,
        previewFailures: metrics.previewFailures,
        averagePreviewLatencyMs: metrics.averagePreviewLatencyMs,
        lastPreviewAt: metrics.lastPreviewAt,
      },
      // PERMANENT REMINDERS — do not remove:
      _reminders: {
        orderSubmission: "DISABLED — Sprint 2.8.5 absolute block",
        confirmation: "NOT_IMPLEMENTED — Sprint 2.8.5",
        nextSprint: "2.8.3 Options/Multi-Leg Preview",
      },
    });
  });

  // ── POST /api/execution/order-drafts/:draftId/equity-preview ─────────────
  // Generate (or regenerate) an equity order preview for the given draft.
  // Client may submit: { refresh?: boolean }
  // Client may NOT submit: symbol, quantity, side, orderType, etc.
  app.post(
    "/api/execution/order-drafts/:draftId/equity-preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const draftId = req.params.draftId;
      if (!draftId || typeof draftId !== "string") {
        return res.status(400).json({ message: "Missing draftId", code: "MISSING_DRAFT_ID" });
      }

      // Reject forbidden client-submitted fields
      for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
        if (key in (req.body ?? {})) {
          return res.status(400).json({
            message: `Client may not submit field: ${key}. All order parameters are derived from server-stored sources.`,
            code: "FORBIDDEN_FIELD",
          });
        }
      }

      try {
        const deps = createDbEquityPreviewDeps(userId);
        const { preview } = await generateEquityPreview({ userId, draftId, deps });

        return res.status(200).json({
          preview,
          _nonExecutable: true,
          _reminders: {
            submission: "DISABLED",
            confirmation: "NOT_IMPLEMENTED",
          },
        });
      } catch (err: any) {
        console.error("[equity-preview] generate failed:", err?.message);
        return res.status(500).json({
          message: "Failed to generate equity order preview.",
          code: "PREVIEW_GENERATION_FAILED",
        });
      }
    },
  );

  // ── GET /api/execution/order-drafts/:draftId/equity-preview ──────────────
  // Get the most recent preview for a draft (regenerates ephemerally).
  app.get(
    "/api/execution/order-drafts/:draftId/equity-preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const draftId = req.params.draftId;
      if (!draftId || typeof draftId !== "string") {
        return res.status(400).json({ message: "Missing draftId", code: "MISSING_DRAFT_ID" });
      }

      try {
        const deps = createDbEquityPreviewDeps(userId);
        const { preview } = await generateEquityPreview({ userId, draftId, deps });

        return res.status(200).json({ preview });
      } catch (err: any) {
        console.error("[equity-preview] get failed:", err?.message);
        return res.status(500).json({
          message: "Failed to generate equity order preview.",
          code: "PREVIEW_GENERATION_FAILED",
        });
      }
    },
  );

  // ── POST /api/execution/order-drafts/:draftId/equity-preview/refresh ─────
  // Refresh the preview — re-reads current quote and validation state.
  // MUST NOT mutate the OrderDraft.
  app.post(
    "/api/execution/order-drafts/:draftId/equity-preview/refresh",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const draftId = req.params.draftId;
      if (!draftId || typeof draftId !== "string") {
        return res.status(400).json({ message: "Missing draftId", code: "MISSING_DRAFT_ID" });
      }

      // Reject forbidden client-submitted fields
      for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
        if (key in (req.body ?? {})) {
          return res.status(400).json({
            message: `Client may not submit field: ${key}`,
            code: "FORBIDDEN_FIELD",
          });
        }
      }

      try {
        const deps = createDbEquityPreviewDeps(userId);
        const { preview } = await generateEquityPreview({ userId, draftId, deps });

        return res.status(200).json({
          preview,
          refreshed: true,
          _nonExecutable: true,
        });
      } catch (err: any) {
        console.error("[equity-preview] refresh failed:", err?.message);
        return res.status(500).json({
          message: "Failed to refresh equity order preview.",
          code: "PREVIEW_REFRESH_FAILED",
        });
      }
    },
  );
}

// Re-export for server/routes.ts startup init (no DB table needed — preview is ephemeral)
export async function ensureEquityPreviewTables(): Promise<void> {
  // No new DB tables for Sprint 2.8.2.
  // Preview is ephemeral (computed on demand).
  // Audit events use existing execution_audit_events table.
}
