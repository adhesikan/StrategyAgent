// GET /api/opportunities/research/:symbol — Sprint 2.1
//
// Assembles a Research Package for a single Opportunity Engine candidate.
// Returns all fields the /opportunity/:symbol page needs in one call.
//
// Response shape: ResearchPackage (see interface below)
//
// Returns 404 when the symbol is not in the current qualified candidate list.
// Returns 200 with an empty/graceful shape when history is unavailable.
//
// Trust rules:
//   - Authenticated; user session required.
//   - Symbol normalised to uppercase; invalid symbols return 400.
//   - No stack traces, MCP session IDs, or raw provider payloads in response.
//   - brokerConnected derived from DB row, never fabricated.
//   - No trade recommendations, buy/sell language, or price targets.

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import {
  getLatestValidSnapshot,
  getPreviousValidSnapshot,
  getFirstSeenMap,
  getSymbolHistory,
  type PersistedOpportunitySnapshot,
} from "../services/opportunity-snapshot-store";
import {
  compareSnapshots,
  type LifecycleItem,
  type SnapshotComparison,
} from "../services/opportunity-comparison-service";
import { getIntervalMs } from "../services/opportunity-engine";
import type { RankedTradeCandidate } from "./ranked-trade-search";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const FRESHNESS_MULTIPLIER = 1.5;
const MAX_HISTORY_ROWS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanHistoryEntry {
  id: string;
  snapshotId: string;
  scanTime: string;
  rank: number | null;
  score: number;
  qualificationStatus: string;
  lifecycleState: string;
  strategy: string | null;
  marketRegime: string | null;
  createdAt: string;
}

export interface ResearchPackage {
  symbol: string;
  candidate: RankedTradeCandidate;
  /** Lifecycle diff item for this symbol — null when no previous scan exists. */
  lifecycleItem: LifecycleItem | null;
  /** Scan history (newest first, max 10 rows). */
  scanHistory: ScanHistoryEntry[];
  /** True when the authenticated user has an active broker connection. */
  brokerConnected: boolean;
  /** Current market regime from the snapshot payload. */
  marketRegime: string | null;
  dataSource: string;
  dataQuality: string;
  freshnessStatus: "fresh" | "stale";
  completedAt: string;
  snapshotId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFreshness(completedAt: string): "fresh" | "stale" {
  const completedMs = new Date(completedAt).getTime();
  const staleThresholdMs = getIntervalMs() * FRESHNESS_MULTIPLIER;
  return Date.now() - completedMs < staleThresholdMs ? "fresh" : "stale";
}

function findCandidateInSnapshot(
  sym: string,
  snapshot: PersistedOpportunitySnapshot,
): RankedTradeCandidate | null {
  const upper = sym.toUpperCase();
  const all = [...snapshot.topGrowth, ...snapshot.topIncome];
  // If symbol appears in both growth and income, prefer the lower rank
  let best: RankedTradeCandidate | null = null;
  for (const c of all) {
    if (c.symbol.toUpperCase() !== upper) continue;
    if (!best || c.rank < best.rank) best = c;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOpportunityResearchRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/opportunities/research/:symbol",
    isAuthenticated,
    async (req, res) => {
      const raw = String(req.params.symbol ?? "").toUpperCase().trim();
      if (!SYMBOL_RE.test(raw)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        const userId = req.session.userId!;

        // Fan-out all independent async fetches together
        const [latest, previous, brokerConnection, historyRows] =
          await Promise.all([
            getLatestValidSnapshot(),
            getPreviousValidSnapshot(),
            storage.getBrokerConnection(userId).catch(() => null),
            getSymbolHistory(raw, MAX_HISTORY_ROWS),
          ]);

        // 404 when no valid snapshot exists
        if (!latest) {
          return res.status(404).json({
            error: "No opportunity scan available",
            code: "NO_SNAPSHOT",
          });
        }

        // 404 when symbol not in current qualified list
        const candidate = findCandidateInSnapshot(raw, latest);
        if (!candidate) {
          return res.status(404).json({
            error: "Symbol not found in current scan",
            code: "SYMBOL_NOT_FOUND",
          });
        }

        // Lifecycle diff (uses same logic as /api/opportunities/changes)
        let lifecycleItem: LifecycleItem | null = null;
        if (previous) {
          const allSymbols = new Set<string>([raw]);
          for (const c of [
            ...latest.topGrowth,
            ...latest.topIncome,
            ...previous.topGrowth,
            ...previous.topIncome,
          ]) {
            allSymbols.add(c.symbol.toUpperCase());
          }
          const firstSeenMap = await getFirstSeenMap(Array.from(allSymbols));
          const comparison: SnapshotComparison = compareSnapshots(
            latest,
            previous,
            firstSeenMap,
          );
          lifecycleItem =
            comparison.all.find(
              (i) => i.symbol.toUpperCase() === raw,
            ) ?? null;
        }

        const pkg: ResearchPackage = {
          symbol: raw,
          candidate,
          lifecycleItem,
          scanHistory: historyRows,
          brokerConnected: !!(brokerConnection?.isConnected),
          marketRegime: latest.marketRegime,
          dataSource: latest.dataSource,
          dataQuality: latest.dataQuality,
          freshnessStatus: computeFreshness(latest.completedAt),
          completedAt: latest.completedAt,
          snapshotId: latest.id,
        };

        return res.json(pkg);
      } catch (err: any) {
        process.stderr.write(
          JSON.stringify({
            event: "opportunity_research_route_error",
            symbol: raw,
            error: String(err?.message ?? err).slice(0, 200),
          }) + "\n",
        );
        return res
          .status(500)
          .json({ error: "Failed to assemble research package" });
      }
    },
  );
}
