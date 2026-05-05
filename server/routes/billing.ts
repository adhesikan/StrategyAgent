import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getBillingStatus } from "../services/billing/userPlan";
import { createCheckoutSession, createPortalSession } from "../services/billing/stripe";
import { isPlanId, type PlanId } from "@shared/plans";

interface SessionRequest extends Request {
  session: Request["session"] & { userId?: string };
}

const checkoutSchema = z.object({
  planId: z.enum(["pro", "edge", "team"]),
  cycle: z.enum(["monthly", "annual"]).default("monthly"),
});

export function registerBillingRoutes(app: Express, isAuthenticated: any) {
  app.get("/api/billing/status", isAuthenticated, async (req: SessionRequest, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const status = await getBillingStatus(userId);
      res.json(status);
    } catch (error) {
      console.error("Failed to get billing status:", error);
      res.status(500).json({ error: "Failed to get billing status" });
    }
  });

  app.post("/api/billing/checkout", isAuthenticated, async (req: SessionRequest, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { planId, cycle } = checkoutSchema.parse(req.body);
      const email = (req.session as any)?.userEmail ?? null;
      const result = await createCheckoutSession(userId, planId as PlanId, cycle, email);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Checkout failed";
      console.error("Checkout error:", msg);
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/billing/portal", isAuthenticated, async (req: SessionRequest, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const result = await createPortalSession(userId);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Portal session failed";
      console.error("Portal error:", msg);
      res.status(400).json({ error: msg });
    }
  });
}
