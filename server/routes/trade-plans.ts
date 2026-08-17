/**
 * server/routes/trade-plans.ts — Sprint 2.7.5 + 2.7.6 Trade Plan Workspace & Lifecycle
 *
 * All routes authenticated. Strict user ownership — cross-user plan ID → 404.
 * No broker fields. No execution CTA. No order model.
 *
 * Static route ordering rule (MUST be preserved):
 *   /api/trade-plans/health                  (static — before /:id)
 *   /api/trade-plans/:id/lifecycle           (sub-static — before /:id/*)
 *   /api/trade-plans/:id/lifecycle/evaluate  (deeper static — before /:id/lifecycle)
 *   /api/trade-plans/:id/activity            (static sub-resource)
 *   All other /:id/* routes
 *
 * Sprint 2.7.6 additions:
 *   GET  /api/trade-plans/:id/lifecycle
 *   POST /api/trade-plans/:id/lifecycle/evaluate
 *   GET  /api/trade-plans/:id/activity
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
  updateTradePlanPlanningCapital,
} from "../services/trade-plan-service";
import {
  evaluateTradePlanLifecycle,
  getCachedLifecycleResult,
  getTradePlanActivities,
  persistLifecycleActivity,
  buildActivitiesFromLifecycleResult,
  getLifecycleHealth,
} from "../services/trade-plan-lifecycle-service";
import type {
  CreateTradePlanRequest,
  UpdateTradePlanRequest,
  CreateTradePlanVersionRequest,
  TradePlanListQuery,
  TradePlanStatus,
  TradePlanType,
} from "../../shared/trade-plan-types";
import { TRADE_PLAN_STATUSES, TRADE_PLAN_TYPES } from "../../shared/trade-plan-types";
import type { LifecycleEvaluateRequest } from "../../shared/trade-plan-lifecycle-types";

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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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

  // ── PATCH /api/trade-plans/:id/planning-capital (Sprint 2.8.7 BI-004) ──────
  // Updates planningSnapshot.planningCapital in-place. No version bump.
  // SAFETY: never authorizes execution. Never represents broker buying power.
  app.patch("/api/trade-plans/:id/planning-capital", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { capitalAmount, maxRiskPercent, maxAllocationPercent } = req.body ?? {};

    if (typeof capitalAmount !== "number" || capitalAmount <= 0) {
      return res.status(400).json({ message: "capitalAmount must be a positive number." });
    }
    if (typeof maxRiskPercent !== "number" || maxRiskPercent < 0 || maxRiskPercent > 100) {
      return res.status(400).json({ message: "maxRiskPercent must be a number between 0 and 100." });
    }
    if (typeof maxAllocationPercent !== "number" || maxAllocationPercent < 0 || maxAllocationPercent > 100) {
      return res.status(400).json({ message: "maxAllocationPercent must be a number between 0 and 100." });
    }

    try {
      const plan = await updateTradePlanPlanningCapital(
        userId, req.params.id, capitalAmount, maxRiskPercent, maxAllocationPercent,
      );
      if (!plan) return res.status(404).json({ message: "Trade plan not found or archived." });
      // Safe log — no capital values logged
      console.log("[trade-plan] planning_capital_updated", { planType: plan.planType });
      return res.json({ plan, source: "USER_DEFINED_PLANNING_CAPITAL" });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to update planning capital." });
    }
  });

  // ── POST /api/trade-plans/:id/archive ──────────────────────────────────────
  app.post("/api/trade-plans/:id/archive", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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
    const userId = req.session.userId!;
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

  // ── GET /api/trade-plans/:id/monitoring-context ────────────────────────────
  app.get("/api/trade-plans/:id/monitoring-context", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const monitoringInput = await getMonitoringContext(userId, req.params.id);
      if (!monitoringInput) return res.status(404).json({ message: "Trade plan not found." });

      return res.json({
        tradePlanId:     req.params.id,
        monitoringInput,
        existingWatchId: null, // 2.7.7 may wire research-watch link
      });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to get monitoring context." });
    }
  });

  // ── POST /api/trade-plans/:id/lifecycle/review ─────────────────────────────
  // Explicit user research-review acknowledgement.
  // Sets lastReviewedAt = now, records RESEARCH_REVIEWED activity, re-evaluates lifecycle.
  // Only the plan owner may acknowledge. Cross-user → 404 (same as all other /:id routes).
  app.post("/api/trade-plans/:id/lifecycle/review", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const planId = req.params.id;
    const startMs = Date.now();

    try {
      // 1. Verify ownership — strict: unknown plan → 404 (not 403, to avoid ID enumeration)
      const { db } = await import("../db");
      const { tradePlans } = await import("../../shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const planRows = await db
        .select({ id: tradePlans.id, userId: tradePlans.userId, planHealth: tradePlans.planHealth, status: tradePlans.status })
        .from(tradePlans)
        .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
        .limit(1);

      if (!planRows.length) {
        return res.status(404).json({ message: "Trade plan not found." });
      }

      const previousLifecycleState = planRows[0].planHealth as string | null;

      // 2. Capture the current research state as the reviewed baseline.
      //    This is the lifecycle-relevant state the user just reviewed.
      //    Stored WITHOUT scan timestamps so routine scans never invalidate the baseline.
      let lastReviewedResearchState: Record<string, unknown> | null = null;
      try {
        const { getCanonicalOpportunity } = await import("../services/opportunity-intelligence-service");
        const planSymbolRows = await db
          .select({ symbol: tradePlans.symbol })
          .from(tradePlans)
          .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
          .limit(1);
        const symbol = planSymbolRows[0]?.symbol;
        if (symbol) {
          const opp = await getCanonicalOpportunity(symbol);
          if (opp) {
            // Capture all fields used by computeResearchChanges(), but NOT asOf/generatedAt.
            lastReviewedResearchState = {
              researchScore:      opp.researchScore      ?? 0,
              technicalScore:     opp.technicalScore     ?? 0,
              fundamentalScore:   opp.fundamentalScore   ?? 0,
              institutionalScore: opp.institutionalScore ?? 0,
              riskLevel:          opp.riskLevel          ?? "unknown",
              qualified:          opp.qualified          ?? false,
              marketRegime:       opp.marketRegime       ?? null,
              sector:             opp.sector             ?? null,
              themes:             opp.themes             ?? [],
            };
          }
        }
      } catch {
        // Fire-and-forget: failing to capture the reviewed state is non-fatal.
        // The review timestamp still persists; the legacy 7-day fallback applies.
      }

      // 3. Persist review timestamp and reviewed research state — both authoritative.
      const reviewedAt = new Date();
      await db
        .update(tradePlans)
        .set({
          lastReviewedAt:            reviewedAt,
          lastReviewedResearchState: lastReviewedResearchState ?? undefined,
          updatedAt:                 new Date(),
        })
        .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)));

      // 3. Record RESEARCH_REVIEWED activity event
      const reviewActivity: Omit<import("../../shared/trade-plan-lifecycle-types").TradePlanActivity, "id" | "tradePlanId" | "userId" | "fingerprint"> = {
        activityType:  "RESEARCH_REVIEWED",
        observedAt:    reviewedAt.toISOString(),
        previousState: previousLifecycleState ?? "UNKNOWN",
        currentState:  "CURRENT",
        summary:       "Research Reviewed — user explicitly acknowledged current conditions",
        metadata: {
          reviewedAt: reviewedAt.toISOString(),
          acknowledgedBy: "USER",
        },
      };

      await persistLifecycleActivity(userId, planId, [reviewActivity]).catch(() => {});

      // 4. Re-evaluate lifecycle with the new lastReviewedAt in place
      const lifecycleResult = await evaluateTradePlanLifecycle(userId, planId, { force: true });

      // 5. Persist any new lifecycle activity events
      const activityDrafts = buildActivitiesFromLifecycleResult(lifecycleResult, null);
      const newActivities = await persistLifecycleActivity(userId, planId, activityDrafts).catch(() => []);

      // 6. Invalidate any stored preflight results for this plan.
      //    The stored preflight was computed before the review (pre-review lifecycle state,
      //    old evaluatedAt). Deleting it forces the client GET to return 404 and prompts
      //    the user to re-run preflight — which will now see the updated lifecycle state.
      try {
        const { executionPreflights } = await import("../../shared/schema");
        await db
          .delete(executionPreflights)
          .where(
            and(
              eq(executionPreflights.tradePlanId, planId),
              eq(executionPreflights.userId, userId)
            )
          );
      } catch {
        // Fire-and-forget: preflight invalidation is best-effort. If it fails,
        // the stale stored result stays but the next POST preflight will overwrite it.
      }

      return res.status(200).json({
        tradePlanId:      planId,
        reviewedAt:       reviewedAt.toISOString(),
        lifecycleResult,
        newActivities,
        durationMs:       Date.now() - startMs,
      });
    } catch (err: any) {
      console.error("[trade-plans] lifecycle review failed:", err?.message);
      if (err?.message?.includes("not found")) {
        return res.status(404).json({ message: "Trade plan not found." });
      }
      return res.status(500).json({ message: "Failed to record research review." });
    }
  });

  // ── POST /api/trade-plans/:id/lifecycle/evaluate (evaluate first — deeper static) ─
  app.post("/api/trade-plans/:id/lifecycle/evaluate", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { force }: LifecycleEvaluateRequest = req.body ?? {};
    const startMs = Date.now();

    try {
      const lifecycleResult = await evaluateTradePlanLifecycle(
        userId,
        req.params.id,
        { force: !!force },
      );

      // Persist significant activity events (fire-and-forget)
      const activityDrafts = buildActivitiesFromLifecycleResult(lifecycleResult, null);
      const newActivities = await persistLifecycleActivity(
        userId,
        req.params.id,
        activityDrafts,
      ).catch(() => []);

      return res.status(200).json({
        tradePlanId:      req.params.id,
        lifecycleResult,
        newActivities,
        durationMs:       Date.now() - startMs,
      });
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        return res.status(404).json({ message: "Trade plan not found." });
      }
      return res.status(500).json({ message: "Failed to evaluate trade plan lifecycle." });
    }
  });

  // ── GET /api/trade-plans/:id/lifecycle ─────────────────────────────────────
  app.get("/api/trade-plans/:id/lifecycle", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      // Return cached result if available; otherwise evaluate fresh
      const cached = getCachedLifecycleResult(userId, req.params.id);
      if (cached) {
        return res.json({ tradePlanId: req.params.id, cached: true, lifecycleResult: cached });
      }

      const lifecycleResult = await evaluateTradePlanLifecycle(userId, req.params.id);
      return res.json({ tradePlanId: req.params.id, cached: false, lifecycleResult });
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        return res.status(404).json({ message: "Trade plan not found." });
      }
      return res.status(500).json({ message: "Failed to get lifecycle." });
    }
  });

  // ── GET /api/trade-plans/:id/activity ──────────────────────────────────────
  app.get("/api/trade-plans/:id/activity", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const limit  = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const category = req.query.category as string | undefined;

    try {
      const result = await getTradePlanActivities(userId, req.params.id, {
        category: category as any,
        limit,
        offset,
      });
      return res.json({ tradePlanId: req.params.id, ...result });
    } catch (err: any) {
      if (err?.message?.includes("not found")) {
        return res.status(404).json({ message: "Trade plan not found." });
      }
      return res.status(500).json({ message: "Failed to get activity." });
    }
  });

  // ── GET /api/trade-plans/lifecycle/health (lifecycle health — admin aggregate) ─
  app.get("/api/trade-plans/lifecycle/health", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, metrics: getLifecycleHealth() });
    } catch {
      return res.status(500).json({ message: "Failed to get lifecycle health." });
    }
  });
}
