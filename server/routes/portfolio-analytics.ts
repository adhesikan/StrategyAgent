/**
 * Portfolio Analytics Routes — Sprint 2.6.2
 *
 * GET /api/portfolio/:id/analytics         — full analytics for a period
 * GET /api/portfolio/:id/analytics/:symbol — per-holding analytics
 *
 * SECURITY:
 *   - Authenticated (req.session.userId!)
 *   - Ownership enforced: 404 for cross-user portfolio IDs
 *   - No portfolio values, symbols, cost basis, or user identity in logs
 *   - No portfolio contents in error responses
 */

import type { Express, Request, Response, RequestHandler } from "express";
import {
  computePortfolioAnalytics,
  computeHoldingAnalytics,
} from "../services/portfolio-analytics-service";
import type { AnalyticsPeriod } from "../../shared/portfolio-analytics-types";

const VALID_PERIODS: AnalyticsPeriod[] = ["7D", "30D", "90D", "YTD", "1Y", "ALL"];

function isPeriod(s: unknown): s is AnalyticsPeriod {
  return VALID_PERIODS.includes(s as AnalyticsPeriod);
}

export function registerPortfolioAnalyticsRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/portfolio/:id/analytics ──────────────────────────────────────
  app.get(
    "/api/portfolio/:id/analytics",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;
      const rawPeriod   = req.query.period;
      const period: AnalyticsPeriod = isPeriod(rawPeriod) ? rawPeriod : "30D";

      if (!portfolioId || typeof portfolioId !== "string") {
        return res.status(400).json({ error: "Portfolio ID is required" });
      }

      try {
        const analytics = await computePortfolioAnalytics(portfolioId, userId, period);

        if (!analytics) {
          return res.status(404).json({
            available:   false,
            portfolioId,
            period,
            generatedAt: new Date().toISOString(),
            analytics:   null,
            message:     "Portfolio not found or you do not have access to it.",
          });
        }

        return res.json({
          available:   true,
          portfolioId,
          period,
          generatedAt: analytics.generatedAt,
          analytics,
        });

      } catch (err: any) {
        console.error("[portfolio-analytics] GET failed:", err?.message?.slice(0, 200));
        return res.status(500).json({ error: "Analytics unavailable" });
      }
    },
  );

  // ── GET /api/portfolio/:id/analytics/:symbol ──────────────────────────────
  app.get(
    "/api/portfolio/:id/analytics/:symbol",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;
      const symbol      = req.params.symbol?.toUpperCase();
      const rawPeriod   = req.query.period;
      const period: AnalyticsPeriod = isPeriod(rawPeriod) ? rawPeriod : "30D";

      if (!portfolioId || !symbol) {
        return res.status(400).json({ error: "Portfolio ID and symbol are required" });
      }
      if (symbol.length > 10 || !/^[A-Z0-9.^-]+$/.test(symbol)) {
        return res.status(400).json({ error: "Invalid symbol format" });
      }

      try {
        const analytics = await computeHoldingAnalytics(portfolioId, userId, symbol, period);

        if (!analytics) {
          return res.status(404).json({
            available:   false,
            portfolioId,
            symbol,
            generatedAt: new Date().toISOString(),
            analytics:   null,
            message:     "Portfolio not found or you do not have access to it.",
          });
        }

        return res.json({
          available:   true,
          portfolioId,
          symbol,
          generatedAt: analytics.freshness.generatedAt,
          analytics,
        });

      } catch (err: any) {
        console.error("[portfolio-analytics] GET symbol failed:", err?.message?.slice(0, 200));
        return res.status(500).json({ error: "Holding analytics unavailable" });
      }
    },
  );
}
