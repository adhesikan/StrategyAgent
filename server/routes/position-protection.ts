import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  createPlan,
  updatePlan,
  cancelPlan,
  pausePlan,
  resumePlan,
  getPlansForUser,
  getPlan,
  getEventsForPlan,
  getProtectionConfig,
  getAllPlansForAdmin,
  getAdminStats,
  type CreatePlanInput,
} from "../services/position-protection/index";
import { getWorkerHeartbeat } from "../position-protection-worker";

const valueMode = z.enum(["price", "percent", "dollar"]);
const trailMode = z.enum(["percent", "dollar"]);

const createPlanSchema = z.object({
  brokerProvider: z.string().min(1),
  brokerAccountId: z.string().min(1),
  accountMode: z.enum(["paper", "live"]).default("paper"),
  symbol: z.string().min(1),
  instrumentType: z.enum(["stock", "option"]).default("stock"),
  optionSymbol: z.string().optional().nullable(),
  positionSide: z.enum(["long", "short"]).default("long"),
  quantity: z.number().int().positive(),
  entryPrice: z.number().positive().optional().nullable(),
  stopEnabled: z.boolean().optional(),
  stopMode: valueMode.optional(),
  stopValue: z.number().positive().optional(),
  targetEnabled: z.boolean().optional(),
  targetMode: valueMode.optional(),
  targetValue: z.number().positive().optional(),
  trailEnabled: z.boolean().optional(),
  trailMode: trailMode.optional(),
  trailValue: z.number().positive().optional(),
  exitOrderType: z.enum(["market", "stop", "stop_limit"]).optional(),
  acknowledged: z.boolean(),
  acknowledgedText: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updatePlanSchema = createPlanSchema.partial();

export function registerPositionProtectionRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  // Public-ish: surface current capability flags so the UI can show/hide.
  app.get("/api/position-protection/config", isAuthenticated, (_req, res) => {
    res.json(getProtectionConfig());
  });

  app.get("/api/position-protection/plans", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const plans = await getPlansForUser(userId);
      res.json(plans);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.get("/api/position-protection/plans/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const plan = await getPlan(req.params.id, userId);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.get("/api/position-protection/plans/:id/events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const plan = await getPlan(req.params.id, userId);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      const events = await getEventsForPlan(req.params.id, userId);
      res.json(events);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.post("/api/position-protection/plans", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parsed = createPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const plan = await createPlan(userId, parsed.data as CreatePlanInput);
      res.status(201).json(plan);
    } catch (err) {
      const e = err as Error & { code?: string };
      const status = e.code ? 422 : 500;
      res.status(status).json({ message: e.message, code: e.code });
    }
  });

  app.patch("/api/position-protection/plans/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parsed = updatePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const plan = await updatePlan(req.params.id, userId, parsed.data as Partial<CreatePlanInput>);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    } catch (err) {
      const e = err as Error & { code?: string };
      const status = e.code ? 422 : 500;
      res.status(status).json({ message: e.message, code: e.code });
    }
  });

  app.post("/api/position-protection/plans/:id/pause", isAuthenticated, async (req, res) => {
    try {
      const plan = await pausePlan(req.params.id, req.session.userId!);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.post("/api/position-protection/plans/:id/resume", isAuthenticated, async (req, res) => {
    try {
      const plan = await resumePlan(req.params.id, req.session.userId!);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.post("/api/position-protection/plans/:id/cancel", isAuthenticated, async (req, res) => {
    try {
      const plan = await cancelPlan(req.params.id, req.session.userId!);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Admin monitoring of all plans across users.
  app.get("/api/admin/position-protection/plans", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const statusParam = typeof req.query.status === "string" ? req.query.status.split(",") : undefined;
      const plans = await getAllPlansForAdmin(statusParam);
      res.json(plans);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Admin telemetry: aggregate counts + worker heartbeat.
  app.get("/api/admin/position-protection/stats", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const stats = await getAdminStats();
      res.json({ stats, heartbeat: getWorkerHeartbeat(), config: getProtectionConfig() });
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });
}
