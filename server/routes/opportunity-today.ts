// GET /api/opportunities/today — Sprint 2.2.7
//
// Returns the latest precomputed Opportunity Ranking Engine result.
// This is a read-only endpoint; rankings are computed by the Opportunity Engine
// background job after every scanner run — never on-demand.
//
// Response shape:
//   {
//     ranking: {
//       generatedAt, snapshotId, regime, weights,
//       topGrowth[],   // ScoredGrowthCandidate
//       topIncome[],
//       watchlist[],
//       approaching[],
//       changes[]
//     } | null,
//     available: boolean,
//     message: string | null   // set when ranking is unavailable
//   }
//
// Trust rules:
//   - No stack traces, tokens, or internal state in response.
//   - Institutional score is already stripped of raw holdings data.
//   - ranking = null until the first scanner run completes.

import type { Express, RequestHandler } from "express";
import { getLatestRanking } from "../services/opportunity-ranking-engine";

export function registerOpportunityTodayRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/opportunities/today", isAuthenticated, (_req, res) => {
    const ranking = getLatestRanking();

    if (!ranking) {
      return res.json({
        ranking: null,
        available: false,
        message:
          "Opportunity rankings are being computed. " +
          "The first scan must complete before rankings are available.",
      });
    }

    return res.json({
      ranking,
      available: true,
      message: null,
    });
  });
}
