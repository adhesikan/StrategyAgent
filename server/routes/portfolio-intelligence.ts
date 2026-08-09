// ---------------------------------------------------------------------------
// Sprint 2.6.1 — Portfolio Intelligence Routes
//
// GET /api/portfolio/:id/intelligence         — full portfolio intelligence
// GET /api/portfolio/:id/intelligence/:symbol — single holding context
//
// Both require authentication + ownership.
// No private financial values in structured logs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sprint 2.6.1 — Portfolio Intelligence Routes
//
// GET /api/portfolio/:id/intelligence         — full portfolio intelligence
// GET /api/portfolio/:id/intelligence/:symbol — single holding context
//
// Both require authentication (session.userId) + ownership.
// No private financial values in structured logs.
// ---------------------------------------------------------------------------

import { type RequestHandler, type Router } from "express";
import {
  getPortfolioIntelligence,
  getPortfolioSymbolIntelligence,
  invalidatePortfolioIntelligenceCache,
} from "../services/portfolio-intelligence-service";

export { invalidatePortfolioIntelligenceCache };

export function registerPortfolioIntelligenceRoutes(
  app: Router,
  isAuthenticated: RequestHandler,
): void {
  // ── GET /api/portfolio/:id/intelligence ────────────────────────────────
  app.get(
    "/api/portfolio/:id/intelligence",
    isAuthenticated,
    async (req, res) => {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;
      const snapshotId  = typeof req.query.snapshotId === "string" ? req.query.snapshotId : undefined;

      try {
        const response = await getPortfolioIntelligence(userId, portfolioId, snapshotId);
        return res.status(200).json(response);
      } catch (err) {
        console.error("Portfolio intelligence error:", err);
        return res.status(500).json({
          available:    false,
          portfolioId,
          generatedAt:  new Date().toISOString(),
          intelligence: null,
          message:      "Portfolio Intelligence is temporarily unavailable.",
        });
      }
    },
  );

  // ── GET /api/portfolio/:id/intelligence/:symbol ────────────────────────
  app.get(
    "/api/portfolio/:id/intelligence/:symbol",
    isAuthenticated,
    async (req, res) => {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;
      const symbol      = req.params.symbol?.toUpperCase();

      if (!symbol) return res.status(400).json({ error: "Symbol required" });

      try {
        const detail = await getPortfolioSymbolIntelligence(userId, portfolioId, symbol);

        if (!detail) {
          return res.status(404).json({ error: "Portfolio or holding not found" });
        }

        return res.status(200).json(detail);
      } catch (err) {
        console.error("Portfolio symbol intelligence error:", err);
        return res.status(500).json({ error: "Portfolio Intelligence is temporarily unavailable." });
      }
    },
  );
}
