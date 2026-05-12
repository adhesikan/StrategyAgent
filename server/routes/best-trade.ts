import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  findBestTrades,
  BEST_TRADE_UNIVERSES,
  type BestTradeRequest,
} from "../services/best-trade-finder";

const universeIds = ["watchlist", "large_cap", "high_volume", "options_liquid", "nasdaq_100", "sp_100", "sp_500", "custom"] as const;

const findSchema = z.object({
  universe: z.enum(universeIds).optional(),
  customSymbols: z.array(z.string().min(1).max(8)).max(30).optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  maxLoss: z.number().min(0).max(1_000_000).optional(),
  bias: z.enum(["bullish", "bearish", "neutral", "any"]).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export function registerBestTradeRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/best-trade/universes", isAuthenticated, (_req, res) => {
    res.json(BEST_TRADE_UNIVERSES);
  });

  app.post("/api/best-trade/find", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const parsed = findSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      }
      const reqBody: BestTradeRequest = parsed.data;
      const result = await findBestTrades(userId, reqBody);
      res.json(result);
    } catch (err: any) {
      console.error("[POST /api/best-trade/find]", err);
      res.status(500).json({ error: err.message || "Failed to find best trades" });
    }
  });
}
