/**
 * server/routes/theoretical-options.ts
 *
 * Sprint 2.8.7C — Theoretical Options Research API Routes.
 *
 * Endpoints:
 *   GET /api/trade-planning/theoretical-options/:symbol
 *     Returns full TheoreticalOptionsResearch for the given symbol.
 *     Requires authentication (isAuthenticated).
 *     Uses the requesting user's ID for the Twelve Data access-control gate.
 *
 *   GET /api/trade-planning/theoretical-options/health
 *     Returns health metrics. No authentication required.
 *
 * BOUNDARY:
 *   This endpoint provides RESEARCH DATA ONLY.
 *   Results carry mode: "UNDERLYING_ONLY_THEORETICAL_MODE".
 *   They cannot satisfy execution preflight, order preparation,
 *   order preview, final revalidation, or broker submission.
 *
 * CONTRACT RESEARCH BOUNDARY:
 *   This is NOT a replacement for Contract Research.
 *   Contract Research (2.7.3) requires a live broker options chain.
 *   When a broker is not connected, Contract Research should indicate
 *   actual contract-level data is unavailable and refer to
 *   Theoretical Options Research for model-based exploration.
 */

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  buildTheoreticalOptionsResearch,
  getTheoreticalOptionsHealth,
} from "../services/theoretical-options/theoretical-options-research-service";

// ===========================================================================
// Input validation
// ===========================================================================

const symbolSchema = z
  .string()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z.]+$/, "Symbol must contain only letters and dots")
  .transform((s) => s.toUpperCase());

const querySchema = z.object({
  strikesEachSide: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(10).optional()),
});

// ===========================================================================
// Route registration
// ===========================================================================

export function registerTheoreticalOptionsRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // ── Health (no auth required) ─────────────────────────────────────────────
  app.get("/api/trade-planning/theoretical-options/health", (_req, res) => {
    res.json({ ok: true, ...getTheoreticalOptionsHealth() });
  });

  // ── Full theoretical options research ─────────────────────────────────────
  app.get(
    "/api/trade-planning/theoretical-options/:symbol",
    isAuthenticated,
    async (req, res) => {
      const symbolParse = symbolSchema.safeParse(req.params.symbol);
      if (!symbolParse.success) {
        return res.status(400).json({
          error: "Invalid symbol",
          details: symbolParse.error.flatten().formErrors,
        });
      }
      const symbol = symbolParse.data;

      const queryParse = querySchema.safeParse(req.query);
      if (!queryParse.success) {
        return res.status(400).json({
          error: "Invalid query parameters",
          details: queryParse.error.flatten().fieldErrors,
        });
      }
      const { strikesEachSide } = queryParse.data;

      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      try {
        const result = await buildTheoreticalOptionsResearch({
          userId,
          symbol,
          strikesEachSide,
        });
        return res.json(result);
      } catch (err) {
        console.error("[theoretical-options] Unhandled error", {
          symbol,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({
          error: "Failed to compute theoretical options research",
          symbol,
        });
      }
    },
  );
}
