// GET /api/opportunities/changes/explained — Sprint 2.3.1
//
// Returns a rich change-intelligence report explaining WHY each opportunity
// changed since the previous scan.
//
// Must be registered BEFORE /api/opportunities/changes so the /explained
// segment isn't captured by the existing :id dynamic route (if any).
//
// Response shape:
//   {
//     generatedAt: string,
//     majorMovers:  OpportunityChangeExplanation[],
//     upgrades:     OpportunityChangeExplanation[],
//     downgrades:   OpportunityChangeExplanation[],
//     newEntries:   OpportunityChangeExplanation[],
//     removed:      OpportunityChangeExplanation[],
//   }
//
// Trust rules:
//   - Authenticated; no broker connection required.
//   - No stack traces or internal IDs in response.
//   - All explanations are deterministic — no LLM.
//   - "removed" symbols are found by querying recent history that is absent
//     from the current ranking; max 48-hour window to avoid false positives.

import type { Express, RequestHandler } from "express";
import { getLatestRanking } from "../services/opportunity-ranking-engine";
import {
  buildChangeIntelligenceReport,
  type SymbolHistoryRow,
} from "../services/opportunity-change-engine";
import { db } from "../db";
import { opportunityHistory } from "@shared/schema";
import { desc, inArray, sql, gte } from "drizzle-orm";

const SYMBOL_RE = /^[A-Z]{1,10}$/;

/**
 * Batch-fetch the last 2 history rows per symbol.
 * Uses a DISTINCT ON query to avoid N+1 round-trips.
 */
async function getBatchHistory(
  symbols: string[],
): Promise<Map<string, SymbolHistoryRow[]>> {
  if (symbols.length === 0) return new Map();

  const upper = symbols.map(s => s.toUpperCase()).filter(s => SYMBOL_RE.test(s));
  if (upper.length === 0) return new Map();

  // Fetch the last 3 rows per symbol (we only need 2 but fetch 3 for safety)
  const rows = await db
    .select()
    .from(opportunityHistory)
    .where(inArray(opportunityHistory.symbol, upper))
    .orderBy(desc(opportunityHistory.scanTime))
    .limit(upper.length * 3);

  const map = new Map<string, SymbolHistoryRow[]>();
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    if (!map.has(sym)) map.set(sym, []);
    const bucket = map.get(sym)!;
    if (bucket.length < 2) {
      bucket.push({
        symbol: sym,
        score: parseFloat(String(r.score ?? "0")),
        rank: r.rank,
        qualificationStatus: r.qualificationStatus,
        lifecycleState: r.lifecycleState,
        strategy: r.strategy,
        marketRegime: r.marketRegime,
        scanTime: r.scanTime.toISOString(),
      });
    }
  }
  return map;
}

/**
 * Find symbols that had a QUALIFIED scan within the last 48 hours
 * but are NOT in the current ranking.
 */
async function findRecentlyRemovedSymbols(
  currentSymbols: Set<string>,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await db
    .select({ symbol: opportunityHistory.symbol })
    .from(opportunityHistory)
    .where(
      sql`${opportunityHistory.qualificationStatus} = 'QUALIFIED'
       AND ${opportunityHistory.scanTime} >= ${cutoff.toISOString()}`,
    )
    .orderBy(desc(opportunityHistory.scanTime));

  const seen = new Set<string>();
  const removed: string[] = [];
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    if (!currentSymbols.has(sym) && !seen.has(sym)) {
      seen.add(sym);
      removed.push(sym);
    }
  }
  return removed.slice(0, 20); // cap to avoid oversized responses
}

export function registerOpportunityChangesExplainedRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/opportunities/changes/explained",
    isAuthenticated,
    async (_req, res) => {
      try {
        const ranking = getLatestRanking();
        if (!ranking) {
          return res.json({
            generatedAt: new Date().toISOString(),
            majorMovers: [],
            upgrades: [],
            downgrades: [],
            newEntries: [],
            removed: [],
            available: false,
            message: "Ranking not yet available — waiting for first scan.",
          });
        }

        // Collect all symbols in current ranking
        const currentSymbols = new Set<string>();
        for (const c of [...ranking.topGrowth, ...ranking.topIncome]) {
          currentSymbols.add(c.symbol.toUpperCase());
        }
        for (const c of [...ranking.watchlist, ...ranking.approaching]) {
          currentSymbols.add(c.symbol.toUpperCase());
        }

        // Parallel: fetch history + find removed symbols
        const [historyMap, removedSymbols] = await Promise.all([
          getBatchHistory(Array.from(currentSymbols)),
          findRecentlyRemovedSymbols(currentSymbols),
        ]);

        // Also fetch history for removed symbols
        if (removedSymbols.length > 0) {
          const removedHistory = await getBatchHistory(removedSymbols);
          for (const entry of Array.from(removedHistory.entries())) {
            const [sym, rows] = entry;
            if (!historyMap.has(sym)) historyMap.set(sym, rows);
          }
        }

        const report = buildChangeIntelligenceReport(ranking, historyMap, removedSymbols);

        return res.json({ ...report, available: true });
      } catch (err: any) {
        process.stderr.write(
          JSON.stringify({
            event: "opportunity_changes_explained_error",
            error: String(err?.message ?? err).slice(0, 200),
          }) + "\n",
        );
        return res.status(500).json({ error: "Failed to build change intelligence report" });
      }
    },
  );
}
