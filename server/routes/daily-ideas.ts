import type { Express, RequestHandler } from "express";
import {
  getDailyIdeasForUser,
  getGrowthIdeas,
  getIncomeIdeas,
  getStockIdeas,
  getOptionIdeas,
  getWatchlistAlerts,
  getMarketAlerts,
  getBeginnerFriendlyIdeaCards,
  type ScanOverrides,
} from "../services/daily-opportunity-scan";
import type { RadarUniverseId } from "../services/opportunity-radar/universe-service";

type Bucket =
  | "all"
  | "growth"
  | "income"
  | "stocks"
  | "options"
  | "watchlist"
  | "alerts"
  | "beginner";

const handlers: Record<Bucket, (userId: string, overrides?: ScanOverrides) => Promise<unknown>> = {
  all: getDailyIdeasForUser,
  growth: getGrowthIdeas,
  income: getIncomeIdeas,
  stocks: getStockIdeas,
  options: getOptionIdeas,
  watchlist: getWatchlistAlerts,
  alerts: getMarketAlerts,
  beginner: (userId) => getBeginnerFriendlyIdeaCards(userId),
};

const VALID_UNIVERSES: RadarUniverseId[] = [
  "watchlist",
  "large_cap",
  "high_volume",
  "options_liquid",
  "nasdaq_100",
  "sp_500",
  "custom",
];

function parseOverrides(query: Record<string, unknown>): ScanOverrides | undefined {
  const overrides: ScanOverrides = {};
  const rawUniverse = typeof query.universe === "string" ? query.universe : undefined;
  if (rawUniverse && VALID_UNIVERSES.includes(rawUniverse as RadarUniverseId)) {
    overrides.universe = rawUniverse as RadarUniverseId;
  }
  const rawSymbols = typeof query.customSymbols === "string" ? query.customSymbols : undefined;
  if (rawSymbols) {
    const list = rawSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 30);
    if (list.length > 0) overrides.customSymbols = list;
  }
  if (!overrides.universe && !overrides.customSymbols) return undefined;
  return overrides;
}

export function registerDailyIdeasRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.get("/api/daily-ideas", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "unauthorized" });
      const bucket = (String(req.query.bucket || "all") as Bucket);
      const handler = handlers[bucket] ?? getDailyIdeasForUser;
      const overrides = parseOverrides(req.query as Record<string, unknown>);
      const result = await handler(userId, overrides);
      res.json(result);
    } catch (err) {
      console.error("[daily-ideas] error:", err);
      res.status(500).json({ error: "Failed to load daily ideas" });
    }
  });
}
