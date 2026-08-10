/**
 * Research Goals Routes — Sprint 2.6.5
 *
 * GET    /api/research-goals                    list user's goals
 * POST   /api/research-goals                    create a goal
 * GET    /api/research-goals/primary            get primary goal
 * GET    /api/research-goals/:id                get goal detail
 * PATCH  /api/research-goals/:id                update goal
 * DELETE /api/research-goals/:id                archive/delete goal
 * POST   /api/research-goals/:id/primary        set as primary
 * GET    /api/research-goals/:id/matches        compute deterministic matches
 * GET    /api/research-goals/:id/activity       goal activity summary
 * GET    /api/research-goals/:id/context        research workspace context
 * GET    /api/research-goals/:id/plan           research plan
 * GET    /api/research-goals/health             platform health (admin)
 *
 * OWNERSHIP: userId always from session.
 * Cross-user goal ID returns 404 (not 403).
 *
 * COMPLIANCE: No suitability scoring, no recommendation language.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import {
  listGoals,
  getGoal,
  getPrimaryGoal,
  createGoal,
  updateGoal,
  archiveGoal,
  deleteGoal,
  setPrimaryGoal,
  computeGoalMatches,
  computeGoalActivity,
  buildGoalResearchContext,
  buildResearchPlan,
  getResearchGoalHealth,
  validateGoalType,
  validateHorizon,
  validateResearchStyle,
} from "../services/research-goal-service";
import {
  GOAL_TYPE_LABELS,
  RESEARCH_HORIZON_LABELS,
  RESEARCH_STYLE_LABELS,
  VOLATILITY_PREFERENCE_LABELS,
  GOAL_MATCH_STATE_LABELS,
  GOAL_MATCH_DISCLAIMER,
  GOAL_COMPLIANCE_DISCLAIMER,
  GOAL_PRIVACY_DISCLOSURE,
  GOAL_TYPES,
  RESEARCH_HORIZONS,
  RESEARCH_STYLES,
  VOLATILITY_PREFERENCES,
} from "../../shared/research-goal-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: Request): string | null {
  return (req.session as any)?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerResearchGoalRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin?: RequestHandler,
): void {

  // ── GET /api/research-goals/health ────────────────────────────────────────
  // Register static routes BEFORE dynamic :id routes (routing regression rule)
  app.get("/api/research-goals/health", async (_req: Request, res: Response) => {
    try {
      const health = await getResearchGoalHealth();
      return res.json({ health });
    } catch {
      return res.status(500).json({ error: "Health check failed" });
    }
  });

  // ── GET /api/research-goals/metadata ──────────────────────────────────────
  app.get("/api/research-goals/metadata", (_req: Request, res: Response) => {
    return res.json({
      goalTypes:             GOAL_TYPES.map(t => ({ value: t, label: GOAL_TYPE_LABELS[t] })),
      horizons:              RESEARCH_HORIZONS.map(h => ({ value: h, label: RESEARCH_HORIZON_LABELS[h] })),
      researchStyles:        RESEARCH_STYLES.map(s => ({ value: s, label: RESEARCH_STYLE_LABELS[s] })),
      volatilityPreferences: VOLATILITY_PREFERENCES.map(v => ({ value: v, label: VOLATILITY_PREFERENCE_LABELS[v] })),
      matchStates:           Object.entries(GOAL_MATCH_STATE_LABELS).map(([k, v]) => ({ value: k, label: v })),
      compliance: {
        disclaimer:       GOAL_COMPLIANCE_DISCLAIMER,
        privacyDisclosure: GOAL_PRIVACY_DISCLOSURE,
        matchDisclaimer:  GOAL_MATCH_DISCLAIMER,
      },
    });
  });

  // ── GET /api/research-goals/primary ───────────────────────────────────────
  app.get("/api/research-goals/primary", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getPrimaryGoal(userId);
      if (!goal) return res.json({ goal: null });
      return res.json({ goal });
    } catch (err: any) {
      console.error("[research-goals] primary goal failed:", err?.message);
      return res.status(500).json({ error: "Failed to load primary goal" });
    }
  });

  // ── GET /api/research-goals ───────────────────────────────────────────────
  app.get("/api/research-goals", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const includeArchived = req.query.includeArchived === "true";
      const goals = await listGoals(userId, { includeArchived });
      return res.json({ goals, total: goals.length });
    } catch (err: any) {
      console.error("[research-goals] list failed:", err?.message);
      return res.status(500).json({ error: "Failed to load research goals" });
    }
  });

  // ── POST /api/research-goals ──────────────────────────────────────────────
  app.post("/api/research-goals", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const {
      name, goalType, description, horizon, researchStyle,
      focusAreas, preferredSectors, preferredThemes,
      preferredOpportunityTypes, volatilityPreference,
      optionsInterest, monitoringEnabled,
    } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!goalType || !validateGoalType(goalType)) {
      return res.status(400).json({ error: `goalType must be one of: ${GOAL_TYPES.join(", ")}` });
    }
    if (!horizon || !validateHorizon(horizon)) {
      return res.status(400).json({ error: `horizon must be one of: ${RESEARCH_HORIZONS.join(", ")}` });
    }
    if (!researchStyle || !validateResearchStyle(researchStyle)) {
      return res.status(400).json({ error: `researchStyle must be one of: ${RESEARCH_STYLES.join(", ")}` });
    }

    try {
      const goal = await createGoal(userId, {
        name,
        goalType,
        description: description ?? undefined,
        horizon,
        researchStyle,
        focusAreas:               Array.isArray(focusAreas) ? focusAreas : [],
        preferredSectors:         Array.isArray(preferredSectors) ? preferredSectors : [],
        preferredThemes:          Array.isArray(preferredThemes) ? preferredThemes : [],
        preferredOpportunityTypes: Array.isArray(preferredOpportunityTypes) ? preferredOpportunityTypes : [],
        volatilityPreference:     volatilityPreference ?? "balanced",
        optionsInterest:          !!optionsInterest,
        monitoringEnabled:        !!monitoringEnabled,
      });
      return res.status(201).json({ goal });
    } catch (err: any) {
      if (err?.message?.startsWith("Invalid")) {
        return res.status(400).json({ error: err.message });
      }
      console.error("[research-goals] create failed:", err?.message);
      return res.status(500).json({ error: "Failed to create research goal" });
    }
  });

  // ── GET /api/research-goals/:id ───────────────────────────────────────────
  app.get("/api/research-goals/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found" });
      return res.json({ goal });
    } catch (err: any) {
      console.error("[research-goals] get failed:", err?.message);
      return res.status(500).json({ error: "Failed to load research goal" });
    }
  });

  // ── PATCH /api/research-goals/:id ─────────────────────────────────────────
  app.patch("/api/research-goals/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await updateGoal(req.params.id, userId, req.body ?? {});
      if (!goal) return res.status(404).json({ error: "Research goal not found" });
      return res.json({ goal });
    } catch (err: any) {
      console.error("[research-goals] update failed:", err?.message);
      return res.status(500).json({ error: "Failed to update research goal" });
    }
  });

  // ── DELETE /api/research-goals/:id ────────────────────────────────────────
  app.delete("/api/research-goals/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const force = req.query.force === "true";
      let ok: boolean;
      if (force) {
        ok = await deleteGoal(req.params.id, userId);
      } else {
        ok = await archiveGoal(req.params.id, userId);
      }
      if (!ok) return res.status(404).json({ error: "Research goal not found" });
      return res.json({ archived: !force, deleted: force });
    } catch (err: any) {
      console.error("[research-goals] delete failed:", err?.message);
      return res.status(500).json({ error: "Failed to archive research goal" });
    }
  });

  // ── POST /api/research-goals/:id/primary ─────────────────────────────────
  app.post("/api/research-goals/:id/primary", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await setPrimaryGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found or archived" });
      return res.json({ goal });
    } catch (err: any) {
      console.error("[research-goals] set primary failed:", err?.message);
      return res.status(500).json({ error: "Failed to set primary goal" });
    }
  });

  // ── GET /api/research-goals/:id/matches ──────────────────────────────────
  app.get("/api/research-goals/:id/matches", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found" });

      const maxResults = Math.min(100, parseInt(String(req.query.maxResults ?? "50"), 10) || 50);
      const matchSummary = await computeGoalMatches(goal, { maxResults });

      return res.json({
        ...matchSummary,
        matchStateLabels: GOAL_MATCH_STATE_LABELS,
        disclaimer:       GOAL_MATCH_DISCLAIMER,
        complianceNote:   GOAL_COMPLIANCE_DISCLAIMER,
      });
    } catch (err: any) {
      console.error("[research-goals] matches failed:", err?.message);
      return res.status(500).json({ error: "Failed to compute goal matches" });
    }
  });

  // ── GET /api/research-goals/:id/activity ─────────────────────────────────
  app.get("/api/research-goals/:id/activity", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found" });

      const activity = await computeGoalActivity(goal);
      return res.json(activity);
    } catch (err: any) {
      console.error("[research-goals] activity failed:", err?.message);
      return res.status(500).json({ error: "Failed to compute goal activity" });
    }
  });

  // ── GET /api/research-goals/:id/context ──────────────────────────────────
  app.get("/api/research-goals/:id/context", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found" });

      const context = await buildGoalResearchContext(goal);
      return res.json({ context });
    } catch (err: any) {
      console.error("[research-goals] context failed:", err?.message);
      return res.status(500).json({ error: "Failed to build goal research context" });
    }
  });

  // ── GET /api/research-goals/:id/plan ─────────────────────────────────────
  app.get("/api/research-goals/:id/plan", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const goal = await getGoal(req.params.id, userId);
      if (!goal) return res.status(404).json({ error: "Research goal not found" });

      const plan = await buildResearchPlan(goal);
      return res.json({ plan, disclaimer: GOAL_COMPLIANCE_DISCLAIMER });
    } catch (err: any) {
      console.error("[research-goals] plan failed:", err?.message);
      return res.status(500).json({ error: "Failed to build research plan" });
    }
  });
}
