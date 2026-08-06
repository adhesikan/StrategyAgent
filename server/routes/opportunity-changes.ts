// GET /api/opportunities/changes — Sprint 2.0
//
// Returns a structured lifecycle diff between the latest and the preceding
// successful Opportunity Engine scan.
//
// Response shape:
//   {
//     hasPreviousScan: boolean,
//     summary: {
//       newCount, triggeredCount, improvingCount, weakeningCount,
//       removedCount, approachingCount, stillQualifiedCount,
//       latestScanTime, previousScanTime
//     },
//     newOpportunities: LifecycleItem[],
//     triggered:        LifecycleItem[],
//     improving:        LifecycleItem[],
//     weakening:        LifecycleItem[],
//     removed:          LifecycleItem[],
//     approaching:      LifecycleItem[],
//     stillQualified:   LifecycleItem[],
//     all:              LifecycleItem[],
//     statistics: { avgRankDelta, topMover, mostStable }
//   }
//
//  Returns 200 with an empty diff when no valid snapshot or no previous scan.
//
// Trust rules:
//   - Authenticated endpoint; no broker connection required.
//   - No stack traces, MCP session IDs, or raw provider payloads in response.
//   - firstSeen values come only from the history table, never fabricated.

import type { Express, RequestHandler } from "express";
import {
  getLatestValidSnapshot,
  getPreviousValidSnapshot,
  getFirstSeenMap,
} from "../services/opportunity-snapshot-store";
import { compareSnapshots, type SnapshotComparison } from "../services/opportunity-comparison-service";

// ---------------------------------------------------------------------------
// Empty diff — returned when no scan history is available
// ---------------------------------------------------------------------------

function emptyComparison(): SnapshotComparison {
  return {
    hasPreviousScan: false,
    summary: {
      newCount: 0,
      triggeredCount: 0,
      improvingCount: 0,
      weakeningCount: 0,
      removedCount: 0,
      approachingCount: 0,
      stillQualifiedCount: 0,
      latestScanTime: null,
      previousScanTime: null,
    },
    newOpportunities: [],
    triggered: [],
    improving: [],
    weakening: [],
    removed: [],
    approaching: [],
    stillQualified: [],
    all: [],
    statistics: { avgRankDelta: 0, topMover: null, mostStable: null },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOpportunityChangesRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/opportunities/changes", isAuthenticated, async (_req, res) => {
    try {
      const [latest, previous] = await Promise.all([
        getLatestValidSnapshot(),
        getPreviousValidSnapshot(),
      ]);

      if (!latest) {
        return res.json(emptyComparison());
      }

      // Collect all unique symbols across both snapshots for firstSeen lookup
      const allSymbols = new Set<string>();
      const addSyms = (snap: typeof latest | null) => {
        if (!snap) return;
        for (const c of [...snap.topGrowth, ...snap.topIncome]) {
          allSymbols.add(c.symbol.toUpperCase());
        }
        for (const w of [...snap.topWatchlist, ...snap.approachingQualification]) {
          allSymbols.add(w.symbol.toUpperCase());
        }
      };
      addSyms(latest);
      addSyms(previous);

      const firstSeenMap = await getFirstSeenMap(Array.from(allSymbols));
      const comparison = compareSnapshots(latest, previous, firstSeenMap);

      return res.json(comparison);
    } catch (err: any) {
      process.stderr.write(
        JSON.stringify({
          event: "opportunity_changes_route_error",
          error: String(err?.message ?? err).slice(0, 200),
        }) + "\n",
      );
      return res.status(500).json({ error: "Failed to compute opportunity changes" });
    }
  });
}
