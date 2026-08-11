/**
 * server/routes/order-preparation.ts — Sprint 2.8.1
 *
 * Order Preparation API routes.
 *
 * ARCHITECTURE INVARIANT: No route here submits, places, replaces, or cancels
 * a broker order. All routes produce or manage non-executable OrderDrafts only.
 *
 * Routes:
 *   POST   /api/trade-plans/:id/execution/order-draft   — create draft
 *   GET    /api/trade-plans/:id/execution/order-draft   — get latest draft for plan
 *   GET    /api/execution/order-drafts/:draftId         — get draft by ID
 *   PATCH  /api/execution/order-drafts/:draftId         — update draft preferences
 *   DELETE /api/execution/order-drafts/:draftId         — abandon draft
 *   GET    /api/execution/order-preparation/health      — platform health
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { orderDrafts } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  prepareOrderDraft,
  updateOrderDraft,
  abandonOrderDraft,
  createDbOrderPreparationDeps,
  getOrderPreparationMetrics,
  recordDraftCreated,
  recordDraftFailure,
} from "../services/order-preparation-service";
import type { CreateOrderDraftRequest, UpdateOrderDraftRequest } from "../../shared/order-draft-types";
import { ORDER_PREPARATION_METHODOLOGY_VERSION } from "../../shared/order-draft-types";

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export function registerOrderPreparationRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: Function) => void,
): void {

  // ── GET /api/execution/order-preparation/health ──────────────────────────
  // MUST be before /:draftId to avoid static/dynamic collision.
  app.get("/api/execution/order-preparation/health", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const metrics = getOrderPreparationMetrics();
      const orderPrepEnabled = (process.env["ORDER_PREPARATION_ENABLED"] ?? "true") !== "false";
      const brokerSubmissionEnabled = process.env["BROKER_EXECUTION_ENABLED"] === "true";

      let activeDrafts = 0;
      try {
        const rows = await db
          .select()
          .from(orderDrafts)
          .where(eq(orderDrafts.status, "VALID"));
        activeDrafts = rows.length;
      } catch { /* non-fatal */ }

      const state = !orderPrepEnabled ? "DISABLED" : "HEALTHY";

      res.json({
        state,
        orderPreparationEnabled: orderPrepEnabled,
        brokerSubmissionEnabled,
        draftsCreated: metrics.draftsCreated,
        activeDrafts,
        expiredDrafts: metrics.expiredDrafts,
        invalidDrafts: metrics.invalidDrafts,
        abandonedDrafts: metrics.abandonedDrafts,
        draftCreationFailures: metrics.draftCreationFailures,
        averageDraftLatencyMs: metrics.avgLatencyMs,
        lastDraftCreatedAt: metrics.lastDraftCreatedAt,
        checkedAt: new Date().toISOString(),
        methodologyVersion: ORDER_PREPARATION_METHODOLOGY_VERSION,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Health check failed.", detail: e?.message });
    }
  });

  // ── POST /api/trade-plans/:id/execution/order-draft ──────────────────────
  app.post("/api/trade-plans/:id/execution/order-draft", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const tradePlanId = req.params["id"];
    const body = req.body as Partial<CreateOrderDraftRequest>;

    // Validate required fields
    if (!body.preflightId || typeof body.preflightId !== "string") {
      return res.status(400).json({ message: "preflightId is required." });
    }
    if (!body.preferences || typeof body.preferences !== "object") {
      return res.status(400).json({ message: "preferences is required." });
    }

    // Reject client-injected forbidden fields (symbol, legs, strike, quote, etc.)
    const forbidden = ["symbol", "legs", "strike", "expiration", "quote", "bid", "ask",
      "marketPrice", "researchScore", "riskAnalysis", "buyingPower", "accountId",
      "forceExecute", "skipQuoteValidation", "submit", "execute"];
    for (const f of forbidden) {
      if (f in (body as any)) {
        return res.status(400).json({ message: `Field "${f}" may not be submitted by client.` });
      }
    }

    const startMs = Date.now();
    try {
      const deps = createDbOrderPreparationDeps(userId);
      const result = await prepareOrderDraft(
        {
          userId,
          tradePlanId,
          preflightId: body.preflightId,
          preferences: body.preferences,
        },
        deps,
      );

      if (result.error || !result.draft) {
        recordDraftFailure();
        return res.status(422).json({
          error: result.error ?? "PREPARATION_FAILED",
          message: result.message ?? "Order draft preparation failed.",
        });
      }

      recordDraftCreated(Date.now() - startMs);
      const status = result.wasExisting ? 200 : 201;
      return res.status(status).json(result.draft);
    } catch (e: any) {
      recordDraftFailure();
      console.error("[order-prep] create draft error:", e?.message);
      return res.status(500).json({ message: "Internal error during order draft preparation." });
    }
  });

  // ── GET /api/trade-plans/:id/execution/order-draft ───────────────────────
  app.get("/api/trade-plans/:id/execution/order-draft", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const tradePlanId = req.params["id"];

    try {
      const rows = await db
        .select()
        .from(orderDrafts)
        .where(and(
          eq(orderDrafts.userId, userId),
          eq(orderDrafts.tradePlanId, tradePlanId),
        ))
        .orderBy(desc(orderDrafts.createdAt))
        .limit(1);

      if (!rows[0]) {
        return res.status(404).json({ message: "No order draft found for this Trade Plan." });
      }

      const draft = rows[0].draftJson as unknown;
      return res.json(draft);
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to retrieve order draft." });
    }
  });

  // ── GET /api/execution/order-drafts/:draftId ─────────────────────────────
  app.get("/api/execution/order-drafts/:draftId", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const draftId = req.params["draftId"];

    try {
      const rows = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, draftId))
        .limit(1);

      if (!rows[0]) {
        // Cross-user returns 404 (not 403) to prevent enumeration
        return res.status(404).json({ message: "Order draft not found." });
      }

      if (rows[0].userId !== userId) {
        return res.status(404).json({ message: "Order draft not found." });
      }

      return res.json(rows[0].draftJson);
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to retrieve order draft." });
    }
  });

  // ── PATCH /api/execution/order-drafts/:draftId ───────────────────────────
  app.patch("/api/execution/order-drafts/:draftId", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const draftId = req.params["draftId"];
    const body = req.body as Partial<UpdateOrderDraftRequest>;

    if (!body.preferences || typeof body.preferences !== "object") {
      return res.status(400).json({ message: "preferences is required." });
    }

    // Reject forbidden fields
    const forbidden = ["symbol", "legs", "strategy", "contracts", "broker", "provider",
      "accountId", "riskAnalysis", "forceExecute", "submit", "execute"];
    for (const f of forbidden) {
      if (f in (body as any)) {
        return res.status(400).json({ message: `Field "${f}" may not be modified directly.` });
      }
    }

    try {
      const deps = createDbOrderPreparationDeps(userId);
      const result = await updateOrderDraft({ userId, draftId, preferences: body.preferences }, deps);

      if (result.error || !result.draft) {
        const status = result.error === "NOT_FOUND" ? 404 : result.error === "EXPIRED" ? 422 : 422;
        return res.status(status).json({ error: result.error, message: result.message });
      }

      return res.json(result.draft);
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to update order draft." });
    }
  });

  // ── DELETE /api/execution/order-drafts/:draftId ──────────────────────────
  app.delete("/api/execution/order-drafts/:draftId", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const draftId = req.params["draftId"];

    try {
      const deps = createDbOrderPreparationDeps(userId);
      const result = await abandonOrderDraft(draftId, userId, deps);

      if (!result.success) {
        const status = result.error === "NOT_FOUND" ? 404 : 500;
        return res.status(status).json({ error: result.error });
      }

      return res.json({ success: true, message: "Order draft abandoned." });
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to abandon order draft." });
    }
  });
}

export { ensureOrderDraftTables } from "../services/order-preparation-service";
