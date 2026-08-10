/**
 * server/routes/trade-plans.ts — Sprint 2.7.5 Trade Plan Workspace
 *
 * All routes authenticated. Strict user ownership — cross-user plan ID → 404.
 * No broker fields. No execution CTA. No order model.
 *
 * Static routes (e.g. /api/trade-plans/health) MUST precede dynamic /:id routes.
 */

import type { Express, Request, Response } from "express";
import {
  createTradePlan,
  getTradePlan,
  listTradePlans,
  updateTradePlan,
  archiveTradePlan,
  duplicateTradePlan,
  getTradePlanChanges,
  getPlanVersions,
  createPlanVersion,
  getMonitoringContext,
  getTradePlanHealthMetrics,
} from "../services/trade-plan-service";
import type {
  CreateTradePlanRequest,
  UpdateTradePlanRequest,
  CreateTradePlanVersionRequest,
  TradePlanListQuery,
  TradePlanStatus,
  TradePlanType,
} from "../../shared/trade-plan-types";
import { TRADE_PLAN_STATUSES, TRADE_PLAN_TYPES } from "../../shared/trade-plan-types";

export function registerTradePlanRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
): void {

  // ── GET /api/trade-plans/health (static — must be before /:id) ─────────────
  app.get("/api/trade-plans/health", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const metrics = await getTradePlanHealthMetrics();
      return res.json({ ok: true, metrics });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get trade plan health." });
    }
  });

  // ── GET /api/trade-plans ────────────────────────────────────────────────────
  app.get("/api/trade-plans", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const {
      status,
      planType,
      symbol,
      sort,
      offset,
      limit,
    } = req.query as Record<string, string | undefined>;

    // Parse status (allow comma-separated or single)
    let statusFilter: TradePlanStatus | TradePlanStatus[] | undefined;
    if (status) {
      const parts = status.split(",").map(s => s.trim()).filter(
        s => TRADE_PLAN_STATUSES.includes(s as TradePlanStatus)
      ) as TradePlanStatus[];
      statusFilter = parts.length === 1 ? parts[0] : parts.length > 1 ? parts : undefined;
    }

    const query: TradePlanListQuery = {
      status:   statusFilter,
      planType: planType && TRADE_PLAN_TYPES.includes(planType as TradePlanType)
        ? planType as TradePlanType
        : undefined,
      symbol:   symbol ? symbol.toUpperCase() : undefined,
      sort:     (sort as TradePlanListQuery["sort"]) ?? "newest",
      offset:   offset ? parseInt(offset, 10) : 0,
      limit:    limit  ? parseInt(limit,  10) : 20,
    };

    try {
      const result = await listTradePlans(userId, query);
      return res.json(result);
    } catch (err: any) {
      console.error("[trade-plans] list failed:", err?.message);
      return res.status(500).json({ message: "Failed to list trade plans." });
    }
  });

  // ── POST /api/trade-plans ───────────────────────────────────────────────────
  app.post("/api/trade-plans", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const body = req.body as CreateTradePlanRequest;

    if (!body.planningSessionId || typeof body.planningSessionId !== "string") {
      return res.status(400).json({ message: "planningSessionId is required." });
    }
    if (!body.planType || !TRADE_PLAN_TYPES.includes(body.planType as TradePlanType)) {
      return res.status(400).json({ message: "planType must be EQUITY or OPTIONS." });
    }

    // Reject any attempt to submit authoritative values from client
    const forbidden = ["researchScore", "technicalScore", "institutionalScore",
      "fundamentalScore", "marketPrice", "optionQuote", "greeks", "riskAnalysisValues"];
    for (const f of forbidden) {
      if (f in body) {
        return res.status(400).json({
          message: `Client may not submit ${f}. Server reconstructs authoritative values.`
        });
      }
    }

    try {
      const plan = await createTradePlan(userId, body);
      // Log safe metadata only — never notes, symbol, capital, or portfolio values
      console.log("[trade-plan] trade_plan_created", {
        planType: plan.planType,
        status:   plan.status,
        version:  plan.version,
        hasGoalContext:      !!plan.researchGoalId,
        hasPortfolioContext: !!plan.portfolioId,
        hasRiskAnalysis:     !!plan.riskSnapshot,
      });
      return res.status(201).json(plan);
    } catch (err: any) {
      console.error("[trade-plans] create failed:", err?.message);
      const msg = err?.message ?? "Failed to create trade plan.";
      if (msg.includes("not found") || msg.includes("does not belong")) {
        return res.status(404).json({ message: msg });
      }
      return res.status(500).json({ message: msg });
    }
  });

  // ── GET /api/trade-plans/:id ────────────────────────────────────────────────
  app.get("/api/trade-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const plan = await getTradePlan(userId, req.params.id);
      if (!plan) return res.status(404).json({ message: "Trade plan not found." });
      return res.json(plan);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get trade plan." });
    }
  });

  // ── PATCH /api/trade-plans/:id ──────────────────────────────────────────────
  app.patch("/api/trade-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const body = req.body as UpdateTradePlanRequest;

    // Reject attempts to edit immutable snapshot fields
    const immutableFields = ["researchSnapshot", "planningSnapshot", "structureSnapshot",
      "riskSnapshot", "researchScore", "planType", "symbol", "userId"];
    for (const f of immutableFields) {
      if (f in body) {
        return res.status(400).json({
          message: `${f} is immutable. Use POST /api/trade-plans/:id/version to create a new version.`,
        });
      }
    }

    try {
      const plan = await updateTradePlan(userId, req.params.id, body);
      if (!plan) return res.status(404).json({ message: "Trade plan not found." });
      // Safe log — no notes, symbol, capital
      console.log("[trade-plan] trade_plan_updated", {
        status:  plan.status,
        version: plan.version,
      });
      return res.json(plan);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to update trade plan." });
    }
  });

  // ── POST /api/trade-plans/:id/archive ──────────────────────────────────────
  app.post("/api/trade-plans/:id/archive", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const plan = await archiveTradePlan(userId, req.params.id);
      if (!plan) return res.status(404).json({ message: "Trade plan not found." });
      console.log("[trade-plan] trade_plan_archived", { version: plan.version });
      return res.json(plan);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to archive trade plan." });
    }
  });

  // ── POST /api/trade-plans/:id/duplicate ────────────────────────────────────
  app.post("/api/trade-plans/:id/duplicate", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const plan = await duplicateTradePlan(userId, req.params.id);
      if (!plan) return res.status(404).json({ message: "Trade plan not found." });
      console.log("[trade-plan] trade_plan_duplicated", { planType: plan.planType });
      return res.status(201).json(plan);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to duplicate trade plan." });
    }
  });

  // ── GET /api/trade-plans/:id/changes ───────────────────────────────────────
  app.get("/api/trade-plans/:id/changes", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const result = await getTradePlanChanges(userId, req.params.id);
      if (!result) return res.status(404).json({ message: "Trade plan not found." });

      const { plan, change, planHealth, healthReason } = result;
      return res.json({
        tradePlanId:   plan.id,
        symbol:        plan.symbol,
        savedSnapshot: plan.researchSnapshot,
        change,
        planHealth,
        healthReason,
      });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get research changes." });
    }
  });

  // ── GET /api/trade-plans/:id/versions ──────────────────────────────────────
  app.get("/api/trade-plans/:id/versions", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const versions = await getPlanVersions(userId, req.params.id);
      return res.json({ versions });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get plan versions." });
    }
  });

  // ── POST /api/trade-plans/:id/version ──────────────────────────────────────
  app.post("/api/trade-plans/:id/version", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const body = req.body as CreateTradePlanVersionRequest;

    try {
      const result = await createPlanVersion(userId, req.params.id, body);
      if (!result) return res.status(404).json({ message: "Trade plan not found." });
      console.log("[trade-plan] trade_plan_version_created", {
        version: result.version.version,
        hasChangeReason: !!body.changeReason,
      });
      return res.status(201).json(result);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to create plan version." });
    }
  });

  // ── GET /api/trade-plans/:id/monitoring-context (2.7.6 handoff) ───────────
  app.get("/api/trade-plans/:id/monitoring-context", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const monitoringInput = await getMonitoringContext(userId, req.params.id);
      if (!monitoringInput) return res.status(404).json({ message: "Trade plan not found." });

      return res.json({
        tradePlanId:     req.params.id,
        monitoringInput,
        existingWatchId: null, // 2.7.6 will wire this up
      });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get monitoring context." });
    }
  });
}
