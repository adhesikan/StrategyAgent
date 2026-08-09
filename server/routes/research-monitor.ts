/**
 * Research Monitor Routes — Sprint 2.5.4
 *
 * GET  /api/research-monitor/watches           list user's active watches
 * POST /api/research-monitor/watches           create a new watch
 * GET  /api/research-monitor/watches/:id       watch detail
 * PATCH /api/research-monitor/watches/:id      update a watch
 * DELETE /api/research-monitor/watches/:id     archive a watch
 * POST /api/research-monitor/watches/:id/evaluate  manually trigger evaluation
 * GET  /api/research-monitor/feed              daily research feed
 * GET  /api/research-monitor/health            monitoring health (admin-accessible)
 *
 * Compliance: no recommendation, prediction, or guarantee in any response.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import {
  createWatch,
  listWatches,
  getWatchById,
  getWatchDetail,
  updateWatch,
  deleteWatch,
  evaluateWatch,
  getDailyFeed,
  getResearchMonitoringHealth,
} from "../services/research-monitor-service";
import type { CreateWatchInput, UpdateWatchInput, WatchType } from "../../shared/research-monitor-types";
import { WATCH_TYPES } from "../../shared/research-monitor-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: Request): string | null {
  return (req.session as any)?.userId ?? null;
}

function validateWatchType(t: string): t is WatchType {
  return WATCH_TYPES.includes(t as WatchType);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerResearchMonitorRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/research-monitor/watches ─────────────────────────────────────
  app.get("/api/research-monitor/watches", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const includeArchived = req.query.includeArchived === "true";
      const watches = await listWatches(userId, includeArchived);
      return res.json({ watches, total: watches.length });
    } catch (err: any) {
      console.error("[research-monitor] list watches failed:", err?.message);
      return res.status(500).json({ error: "Failed to load research watches" });
    }
  });

  // ── POST /api/research-monitor/watches ────────────────────────────────────
  app.post("/api/research-monitor/watches", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, watchType, entityId, entityLabel } = req.body ?? {};
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!watchType || !validateWatchType(watchType)) {
      return res.status(400).json({ error: `watchType must be one of: ${WATCH_TYPES.join(", ")}` });
    }
    // Entity-required watch types
    const entityRequired: WatchType[] = ["company", "theme", "sector", "collection", "institutional_activity"];
    if (entityRequired.includes(watchType) && (!entityId || typeof entityId !== "string")) {
      return res.status(400).json({ error: `entityId is required for watchType "${watchType}"` });
    }
    try {
      const input: CreateWatchInput = {
        name: String(name),
        watchType,
        entityId: entityId ? String(entityId) : null,
        entityLabel: entityLabel ? String(entityLabel) : null,
      };
      const watch = await createWatch(userId, input);
      return res.status(201).json({ watch });
    } catch (err: any) {
      console.error("[research-monitor] create watch failed:", err?.message);
      return res.status(500).json({ error: "Failed to create research watch" });
    }
  });

  // ── GET /api/research-monitor/watches/:id ─────────────────────────────────
  app.get("/api/research-monitor/watches/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const detail = await getWatchDetail(req.params.id, userId);
      if (!detail) return res.status(404).json({ error: "Research watch not found" });
      return res.json({ watch: detail });
    } catch (err: any) {
      console.error("[research-monitor] get watch failed:", err?.message);
      return res.status(500).json({ error: "Failed to load research watch" });
    }
  });

  // ── PATCH /api/research-monitor/watches/:id ───────────────────────────────
  app.patch("/api/research-monitor/watches/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, status, notifyEmail, notifyPush } = req.body ?? {};
    const validStatuses = ["active", "paused", "archived"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }
    try {
      const input: UpdateWatchInput = {
        name: name ? String(name) : undefined,
        status: status as UpdateWatchInput["status"],
        notifyEmail: notifyEmail !== undefined ? Boolean(notifyEmail) : undefined,
        notifyPush: notifyPush !== undefined ? Boolean(notifyPush) : undefined,
      };
      const updated = await updateWatch(req.params.id, userId, input);
      if (!updated) return res.status(404).json({ error: "Research watch not found" });
      return res.json({ watch: updated });
    } catch (err: any) {
      console.error("[research-monitor] update watch failed:", err?.message);
      return res.status(500).json({ error: "Failed to update research watch" });
    }
  });

  // ── DELETE /api/research-monitor/watches/:id ──────────────────────────────
  app.delete("/api/research-monitor/watches/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const ok = await deleteWatch(req.params.id, userId);
      if (!ok) return res.status(404).json({ error: "Research watch not found" });
      return res.json({ ok: true, message: "Research watch archived" });
    } catch (err: any) {
      console.error("[research-monitor] delete watch failed:", err?.message);
      return res.status(500).json({ error: "Failed to archive research watch" });
    }
  });

  // ── POST /api/research-monitor/watches/:id/evaluate ───────────────────────
  app.post("/api/research-monitor/watches/:id/evaluate", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await evaluateWatch(req.params.id, userId);
      if (!result) return res.status(404).json({ error: "Research watch not found or not active" });
      return res.json({ evaluation: result });
    } catch (err: any) {
      console.error("[research-monitor] evaluate watch failed:", err?.message);
      return res.status(500).json({ error: "Failed to evaluate research watch" });
    }
  });

  // ── GET /api/research-monitor/feed ────────────────────────────────────────
  app.get("/api/research-monitor/feed", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const feed = await getDailyFeed(userId);
      return res.json({ feed });
    } catch (err: any) {
      console.error("[research-monitor] feed failed:", err?.message);
      return res.status(500).json({ error: "Failed to generate daily research feed" });
    }
  });

  // ── GET /api/research-monitor/health ──────────────────────────────────────
  app.get("/api/research-monitor/health", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const health = await getResearchMonitoringHealth();
      return res.json({ health });
    } catch (err: any) {
      console.error("[research-monitor] health failed:", err?.message);
      return res.status(500).json({ error: "Failed to get monitoring health" });
    }
  });
}
