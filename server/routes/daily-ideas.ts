import type { Express, RequestHandler } from "express";
import {
  getDailyIdeasForUser,
  getGrowthIdeas,
  getIncomeIdeas,
  getStockIdeas,
  getOptionIdeas,
  getWatchlistAlerts,
  getBeginnerFriendlyIdeaCards,
} from "../services/daily-opportunity-scan";

type Bucket = "all" | "growth" | "income" | "stocks" | "options" | "watchlist" | "beginner";

const handlers: Record<Bucket, (userId: string) => Promise<unknown>> = {
  all: getDailyIdeasForUser,
  growth: getGrowthIdeas,
  income: getIncomeIdeas,
  stocks: getStockIdeas,
  options: getOptionIdeas,
  watchlist: getWatchlistAlerts,
  beginner: getBeginnerFriendlyIdeaCards,
};

export function registerDailyIdeasRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.get("/api/daily-ideas", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "unauthorized" });
      const bucket = (String(req.query.bucket || "all") as Bucket);
      const handler = handlers[bucket] ?? getDailyIdeasForUser;
      const result = await handler(userId);
      res.json(result);
    } catch (err) {
      console.error("[daily-ideas] error:", err);
      res.status(500).json({ error: "Failed to load daily ideas" });
    }
  });
}
