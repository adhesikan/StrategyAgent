/**
 * server/routes/options-preview.ts — Sprint 2.8.3
 *
 * Routes for Options / Multi-Leg Order Preview.
 *
 * PERMANENT INVARIANTS:
 *   - All endpoints are read-only regarding OrderDraft, TradePlan, Preflight,
 *     strategy family, legs, contracts, strikes, expirations, and account.
 *   - No /confirm, /submit, /place routes.
 *   - No leg decomposition.
 *   - Client may NOT submit authoritative fields — server reconstructs all.
 *
 * BROKER BOUNDARY: read-only adapter only.
 * No placeOrder, submitOrder, replaceOrder, cancelOrder, modifyOrder.
 */

import type { Express, Request, Response } from "express";
import {
  generateOptionsPreview,
  createDbOptionsPreviewDeps,
  getOptionsPreviewMetrics,
  ensureOptionsPreviewTables,
} from "../services/options-preview-service";
import {
  OPTIONS_PREVIEW_DISCLAIMER,
  OPTIONS_PREVIEW_METHODOLOGY_VERSION,
  OPTIONS_PREVIEW_NON_EXECUTION_BANNER,
} from "../../shared/options-order-preview-types";

/**
 * Forbidden client-injected fields.
 * Server reconstructs all authoritative values from stored sources.
 */
const FORBIDDEN_CLIENT_FIELDS = new Set([
  "strategyFamily", "legs", "contractSymbol", "contracts", "strike",
  "strikes", "expiration", "expirations", "ratio", "quantity",
  "account", "accountRef", "quote", "quotes", "bid", "ask",
  "netDebit", "netCredit", "debit", "credit", "riskValues",
  "riskData", "brokerCapability", "broadExpressionType", "selectedBy",
  "tradePlanVersion", "preflight", "symbol",
  // Injection attempts
  "forceExecute", "skipValidation", "bypassPreflight",
  "forceValid", "overrideStatus",
]);

export function registerOptionsPreviewRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
): void {

  // ── GET /api/execution/options-preview/health ──────────────────────────── 
  // Static route BEFORE dynamic — prevents "health" being treated as draftId
  app.get("/api/execution/options-preview/health", isAuthenticated, async (_req: Request, res: Response) => {
    const metrics = getOptionsPreviewMetrics();
    return res.json({
      status: "ACTIVE",
      feature: "options-order-preview",
      brokerSubmissionEnabled: false,
      executionEnabled: process.env.BROKER_EXECUTION_ENABLED === "true",
      methodologyVersion: OPTIONS_PREVIEW_METHODOLOGY_VERSION,
      disclaimer: OPTIONS_PREVIEW_DISCLAIMER,
      nonExecutionBanner: OPTIONS_PREVIEW_NON_EXECUTION_BANNER,
      metrics: {
        previewRequests: metrics.previewRequests,
        singleLegPreviews: metrics.singleLegPreviews,
        multiLegPreviews: metrics.multiLegPreviews,
        previewPasses: metrics.previewPasses,
        previewRequiresReview: metrics.previewRequiresReview,
        previewInvalid: metrics.previewInvalid,
        previewExpired: metrics.previewExpired,
        previewFailures: metrics.previewFailures,
        averagePreviewLatencyMs: metrics.averagePreviewLatencyMs,
        lastPreviewAt: metrics.lastPreviewAt,
      },
      _reminders: {
        orderSubmission: "DISABLED — Sprint 2.8.5 absolute block",
        confirmation: "NOT_IMPLEMENTED — Sprint 2.8.5",
        legDecomposition: "PROHIBITED — multi-leg structures must never be decomposed",
        nextSprint: "2.8.4 — Execution Validation Hardening",
      },
    });
  });

  // ── POST /api/execution/order-drafts/:draftId/options-preview ─────────────
  // Generate (or regenerate) an options order preview for the given draft.
  app.post(
    "/api/execution/order-drafts/:draftId/options-preview",
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
            message: `Client may not submit field: ${key}. All order parameters are reconstructed from server-stored sources.`,
            code: "FORBIDDEN_FIELD",
          });
        }
      }

      try {
        const deps = createDbOptionsPreviewDeps(userId);
        const { preview } = await generateOptionsPreview({ userId, draftId, deps });

        return res.status(200).json({
          preview,
          _nonExecutable: true,
          _noDecomposition: true,
          _reminders: {
            submission: "DISABLED",
            confirmation: "NOT_IMPLEMENTED",
            legDecomposition: "PROHIBITED",
          },
        });
      } catch (err: any) {
        console.error("[options-preview] generate failed:", err?.message);
        return res.status(500).json({
          message: "Failed to generate options order preview.",
          code: "PREVIEW_GENERATION_FAILED",
        });
      }
    },
  );

  // ── GET /api/execution/order-drafts/:draftId/options-preview ─────────────
  // Get the most recent preview (regenerates ephemerally).
  app.get(
    "/api/execution/order-drafts/:draftId/options-preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const draftId = req.params.draftId;
      if (!draftId || typeof draftId !== "string") {
        return res.status(400).json({ message: "Missing draftId", code: "MISSING_DRAFT_ID" });
      }

      try {
        const deps = createDbOptionsPreviewDeps(userId);
        const { preview } = await generateOptionsPreview({ userId, draftId, deps });

        return res.status(200).json({ preview });
      } catch (err: any) {
        console.error("[options-preview] get failed:", err?.message);
        return res.status(500).json({
          message: "Failed to generate options order preview.",
          code: "PREVIEW_GENERATION_FAILED",
        });
      }
    },
  );

  // ── POST /api/execution/order-drafts/:draftId/options-preview/refresh ─────
  // Refresh current quote context. MUST NOT mutate OrderDraft.
  app.post(
    "/api/execution/order-drafts/:draftId/options-preview/refresh",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const draftId = req.params.draftId;
      if (!draftId || typeof draftId !== "string") {
        return res.status(400).json({ message: "Missing draftId", code: "MISSING_DRAFT_ID" });
      }

      for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
        if (key in (req.body ?? {})) {
          return res.status(400).json({
            message: `Client may not submit field: ${key}`,
            code: "FORBIDDEN_FIELD",
          });
        }
      }

      try {
        const deps = createDbOptionsPreviewDeps(userId);
        const { preview } = await generateOptionsPreview({ userId, draftId, deps });

        return res.status(200).json({
          preview,
          refreshed: true,
          _nonExecutable: true,
        });
      } catch (err: any) {
        console.error("[options-preview] refresh failed:", err?.message);
        return res.status(500).json({
          message: "Failed to refresh options order preview.",
          code: "PREVIEW_REFRESH_FAILED",
        });
      }
    },
  );
}

export { ensureOptionsPreviewTables };
