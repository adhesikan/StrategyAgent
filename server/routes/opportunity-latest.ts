// GET /api/opportunities/latest
//
// Returns the most recent pre-computed opportunity snapshot from the
// Opportunity Engine (server/services/opportunity-engine.ts).
//
// Response shape:
//   { snapshot: OpportunitySnapshot }   — when a scan has completed
//   { snapshot: null }                  — before the first scan
//
// Authentication: required (isAuthenticated middleware).
// No MCP call is made here — the engine runs independently in the background.

import type { Express, RequestHandler } from "express";
import { getLatestSnapshot } from "../services/opportunity-engine";

export function registerOpportunityLatestRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/opportunities/latest", isAuthenticated, (_req, res) => {
    const snapshot = getLatestSnapshot();
    return res.json({ snapshot: snapshot ?? null });
  });
}
