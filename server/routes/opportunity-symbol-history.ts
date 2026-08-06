// GET /api/opportunities/symbol/:symbol/history — Sprint 2.0
//
// Returns the full historical record for a single symbol from the
// opportunity_history table, ordered newest-first.
//
// Response shape:
//   {
//     symbol: string,
//     history: Array<{
//       id, snapshotId, scanTime, rank, score, qualificationStatus,
//       lifecycleState, strategy, marketRegime, createdAt
//     }>
//   }
//
// Returns an empty history array when the symbol has no records.
//
// Trust rules:
//   - Authenticated; no broker connection required.
//   - Symbol is normalised to uppercase; invalid symbols return 400.
//   - No stack traces or internal IDs beyond snapshotId in response.

import type { Express, RequestHandler } from "express";
import { getSymbolHistory } from "../services/opportunity-snapshot-store";

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const MAX_HISTORY_ROWS = 100;

export function registerOpportunitySymbolHistoryRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/opportunities/symbol/:symbol/history",
    isAuthenticated,
    async (req, res) => {
      const raw = String(req.params.symbol ?? "").toUpperCase().trim();
      if (!SYMBOL_RE.test(raw)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        const rows = await getSymbolHistory(raw, MAX_HISTORY_ROWS);
        return res.json({ symbol: raw, history: rows });
      } catch (err: any) {
        process.stderr.write(
          JSON.stringify({
            event: "opportunity_symbol_history_route_error",
            symbol: raw,
            error: String(err?.message ?? err).slice(0, 200),
          }) + "\n",
        );
        return res.status(500).json({ error: "Failed to fetch symbol history" });
      }
    },
  );
}
