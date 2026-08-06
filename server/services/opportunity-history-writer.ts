// Opportunity History Writer — Sprint 2.0
//
// Non-blocking, fire-and-forget service that writes one row per symbol
// into the opportunity_history table after each successful Opportunity Engine scan.
//
// Called from opportunity-engine.ts AFTER saveSuccessfulSnapshot() returns.
// Failures are logged but never propagated — this service must never block
// or fail the scan result.
//
// Trust rules:
//   - Never called before persist (snapshotId must exist in DB first)
//   - Never exposes session IDs, tokens, or raw provider payloads
//   - No retry logic — idempotency not required (new scan = new rows)

import { db } from "../db";
import { opportunityHistory } from "@shared/schema";
import type { PersistedOpportunitySnapshot } from "./opportunity-snapshot-store";
import {
  computeLifecycleState,
  deriveScore,
  buildBucketMaps,
  type LifecycleState,
  type QualificationStatus,
} from "./opportunity-comparison-service";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface WriteHistoryArgs {
  snapshotId: string;
  completedAt: Date;
  marketRegime: string | null;
  topGrowth: Array<{ symbol: string; rank: number; strategy?: string }>;
  topIncome: Array<{ symbol: string; rank: number; strategy?: string }>;
  topWatchlist: Array<{ symbol: string; strategy?: string }>;
  approachingQualification: Array<{ symbol: string; strategy?: string }>;
  unavailableCount: number;
  previousSnapshot: PersistedOpportunitySnapshot | null;
}

// ---------------------------------------------------------------------------
// History record builder
// ---------------------------------------------------------------------------

interface HistoryRow {
  snapshotId: string;
  symbol: string;
  strategy: string | null;
  scanTime: Date;
  rank: number | null;
  score: string;
  qualificationStatus: string;
  lifecycleState: string;
  reasonSummary: string | null;
  marketRegime: string | null;
  technicalScore: string | null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Write lifecycle history rows for all symbols in the given scan result.
 * Non-fatal — catches and logs all errors internally.
 * Must be called AFTER the new snapshot is persisted so snapshotId is valid.
 */
export async function writeOpportunityHistory(args: WriteHistoryArgs): Promise<void> {
  try {
    const {
      snapshotId,
      completedAt,
      marketRegime,
      topGrowth,
      topIncome,
      topWatchlist,
      approachingQualification,
      unavailableCount,
      previousSnapshot,
    } = args;

    // Build a fake PersistedOpportunitySnapshot-like structure for buildBucketMaps
    const latestForMaps = {
      topGrowth: topGrowth as any,
      topIncome: topIncome as any,
      topWatchlist: topWatchlist as any,
      approachingQualification: approachingQualification as any,
      unavailableCount,
    } as PersistedOpportunitySnapshot;

    const latestMaps = buildBucketMaps(latestForMaps);
    const prevMaps   = buildBucketMaps(previousSnapshot);

    const rows: HistoryRow[] = [];
    const seen = new Set<string>();

    const addQualified = (c: { symbol: string; rank: number; strategy?: string }) => {
      const sym = c.symbol.toUpperCase();
      if (seen.has(sym)) return;
      seen.add(sym);
      const state: LifecycleState = computeLifecycleState(sym, latestMaps, prevMaps, unavailableCount);
      const score = deriveScore(c.rank, true);
      rows.push({
        snapshotId,
        symbol: c.symbol,
        strategy: c.strategy ?? null,
        scanTime: completedAt,
        rank: c.rank,
        score: score.toFixed(2),
        qualificationStatus: "QUALIFIED" satisfies QualificationStatus,
        lifecycleState: state,
        reasonSummary: null,
        marketRegime,
        technicalScore: null,
      });
    };

    const addWatch = (w: { symbol: string; strategy?: string }) => {
      const sym = w.symbol.toUpperCase();
      if (seen.has(sym)) return;
      seen.add(sym);
      const state: LifecycleState = computeLifecycleState(sym, latestMaps, prevMaps, unavailableCount);
      rows.push({
        snapshotId,
        symbol: w.symbol,
        strategy: w.strategy ?? null,
        scanTime: completedAt,
        rank: null,
        score: "0.00",
        qualificationStatus: "WATCHING" satisfies QualificationStatus,
        lifecycleState: state,
        reasonSummary: null,
        marketRegime,
        technicalScore: null,
      });
    };

    for (const c of topGrowth)             addQualified(c);
    for (const c of topIncome)             addQualified(c);
    for (const w of topWatchlist)          addWatch(w);
    for (const w of approachingQualification) addWatch(w);

    if (rows.length === 0) return;

    await db.insert(opportunityHistory).values(
      rows.map(r => ({
        snapshotId: r.snapshotId,
        symbol: r.symbol,
        strategy: r.strategy,
        scanTime: r.scanTime,
        rank: r.rank,
        score: r.score,
        qualificationStatus: r.qualificationStatus,
        lifecycleState: r.lifecycleState,
        reasonSummary: r.reasonSummary,
        marketRegime: r.marketRegime,
        technicalScore: r.technicalScore,
      })),
    );

    process.stdout.write(
      JSON.stringify({
        event: "opportunity_history_written",
        snapshotId,
        symbolCount: rows.length,
      }) + "\n",
    );
  } catch (err: any) {
    process.stderr.write(
      JSON.stringify({
        event: "opportunity_history_write_failed",
        error: String(err?.message ?? err).slice(0, 200),
      }) + "\n",
    );
    // Never re-throw — must be non-fatal
  }
}
