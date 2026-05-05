import type { Request, Response, NextFunction, RequestHandler } from "express";
import { canAccessFeature, getRequiredPlan, getPlan, type FeatureKey } from "@shared/plans";
import { getUserPlanRecord, resetDailyAnalysesIfNeeded, incrementDailyAnalyses } from "../services/billing/userPlan";

interface SessionRequest extends Request {
  session: Request["session"] & { userId?: string };
}

/**
 * Hard gate: blocks the request unless the user's plan includes the given feature.
 * Returns 402 Payment Required with structured upgrade info.
 */
export function requireFeature(feature: FeatureKey): RequestHandler {
  return async (req: SessionRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const record = await getUserPlanRecord(userId);
      const planId = record?.planId ?? "free";
      if (canAccessFeature(planId, feature)) return next();

      const required = getRequiredPlan(feature);
      return res.status(402).json({
        error: "Plan upgrade required",
        code: "PLAN_UPGRADE_REQUIRED",
        feature,
        currentPlan: planId,
        requiredPlan: required,
        requiredPlanName: getPlan(required).name,
      });
    } catch (err) {
      console.error("planGuard.requireFeature error:", err);
      res.status(500).json({ error: "Plan check failed" });
    }
  };
}

/**
 * Soft quota gate for daily AI analyses. Blocks at limit and returns 429 with
 * structured payload. Does NOT increment — call enforceAnalysisQuota wrapper
 * (or use trackAnalysisUsage in the route) after a successful analysis.
 */
export function checkAnalysisQuota(): RequestHandler {
  return async (req: SessionRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const record = await resetDailyAnalysesIfNeeded(userId);
      const planId = record?.planId ?? "free";
      const plan = getPlan(planId);
      const limit = plan.limits.dailyAnalyses;
      const used = record?.dailyAnalysesUsed ?? 0;

      if (limit !== -1 && used >= limit) {
        return res.status(429).json({
          error: "Daily AI analysis limit reached",
          code: "ANALYSIS_QUOTA_EXCEEDED",
          currentPlan: planId,
          dailyAnalysesUsed: used,
          dailyAnalysesLimit: limit,
        });
      }
      next();
    } catch (err) {
      console.error("planGuard.checkAnalysisQuota error:", err);
      res.status(500).json({ error: "Quota check failed" });
    }
  };
}

/**
 * Helper to call from inside a successful AI analysis route (after generation).
 */
export async function trackAnalysisUsage(userId: string): Promise<void> {
  try {
    await incrementDailyAnalyses(userId);
  } catch (err) {
    console.error("trackAnalysisUsage error:", err);
  }
}
