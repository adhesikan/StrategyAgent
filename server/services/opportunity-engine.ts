// Opportunity Engine — background scanner that pre-computes stock opportunities
// and stores the latest snapshot. The dashboard reads the snapshot via
// GET /api/opportunities/latest.
//
// Runs:
//   - once at startup (asynchronously, non-blocking)
//   - every REFRESH_INTERVAL_MS thereafter
//
// Never blocks application startup or dashboard rendering.
// If MCP is unavailable the snapshot remains null — clients show the
// "no first scan yet" state, not simulated data.

import { isMcpEnabled } from "../mcp/config";
import {
  runRankedTradeSearch,
  type RankedTradeCandidate,
  type RankedWatchCandidate,
} from "../routes/ranked-trade-search";

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SCANNER_VERSION = "mcp-v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpportunitySnapshot {
  /** ISO timestamp of when the engine completed this scan. */
  generatedAt: string;
  /** Internal version tag for the scanner pipeline. */
  scannerVersion: string;
  /** Market regime string returned by MCP (null when unavailable). */
  marketRegime: string | null;
  /** Human-readable data-source label. */
  dataSource: string;
  /** Top growth-oriented qualified candidates (momentum, breakout, VCP). */
  topGrowth: RankedTradeCandidate[];
  /** Top income-oriented qualified candidates (covered, credit, income strategies). */
  topIncome: RankedTradeCandidate[];
  /** Watch candidates already on a monitored watchlist. */
  topWatchlist: RankedWatchCandidate[];
  /** Watch candidates approaching full qualification criteria. */
  approachingQualification: RankedWatchCandidate[];
  /** Raw stored-opportunity count reviewed by the scanner. */
  reviewedCount: number;
  /** Count of fully qualified candidates. */
  qualifiedCount: number;
  /** Non-fatal warnings from the ranking pipeline. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// In-memory store (one process-lifetime snapshot)
// ---------------------------------------------------------------------------

let latestSnapshot: OpportunitySnapshot | null = null;
let engineRunning = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getLatestSnapshot(): OpportunitySnapshot | null {
  return latestSnapshot;
}

// ---------------------------------------------------------------------------
// Engine run
// ---------------------------------------------------------------------------

/**
 * Run one opportunity scan and store the result.
 * Safe to call concurrently — returns immediately if already running.
 * Never throws — failures are logged and the snapshot is left unchanged.
 */
export async function runOpportunityEngine(): Promise<void> {
  if (!isMcpEnabled()) {
    console.log(
      JSON.stringify({ event: "opportunity_engine_skipped", reason: "mcp_disabled" }),
    );
    return;
  }
  if (engineRunning) {
    console.log(
      JSON.stringify({ event: "opportunity_engine_skipped", reason: "already_running" }),
    );
    return;
  }

  engineRunning = true;
  const started = Date.now();
  console.log(JSON.stringify({ event: "opportunity_engine_started" }));

  try {
    const { rankMarketTradeCandidates } = await import("../mcp/tools");

    const search = await runRankedTradeSearch(
      { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
      {
        rank: (args) =>
          rankMarketTradeCandidates({
            numberOfIdeas: 10,
            instrumentPreference: "stock",
            direction: "either",
            ...args,
          }),
      },
    );

    // Attempt to get market regime (non-fatal if unavailable).
    let marketRegime: string | null = null;
    try {
      const { getMarketRegime } = await import("../mcp/tools");
      const regime = (await getMarketRegime()) as any;
      marketRegime =
        typeof regime?.regime === "string"
          ? regime.regime
          : typeof regime?.label === "string"
          ? regime.label
          : null;
    } catch {
      // Non-fatal — regime stays null.
    }

    // Partition candidates into growth vs income by strategy name.
    // Income strategies: covered calls, cash-secured puts, credit spreads,
    // dividend-focused, yield-enhancement. All others are classified growth.
    const INCOME_RE = /income|covered|put|call|credit|spread|dividend|yield/i;
    const all = search.candidates;
    const growthCandidates = all.filter(
      (c) => !c.strategy || !INCOME_RE.test(c.strategy),
    );
    const incomeCandidates = all.filter(
      (c) => c.strategy && INCOME_RE.test(c.strategy),
    );

    // Watch candidates: first 3 = "top watchlist", remainder = "approaching qualification"
    const topWatchlist = search.watchCandidates.slice(0, 3);
    const approachingQualification = search.watchCandidates.slice(3, 8);

    latestSnapshot = {
      generatedAt: new Date().toISOString(),
      scannerVersion: SCANNER_VERSION,
      marketRegime,
      dataSource: "Twelve Data via MCP",
      topGrowth: growthCandidates.slice(0, 5),
      topIncome: incomeCandidates.slice(0, 5),
      topWatchlist,
      approachingQualification,
      reviewedCount: search.reviewedCount,
      qualifiedCount: search.qualifiedCount,
      warnings: search.warnings,
    };

    console.log(
      JSON.stringify({
        event: "opportunity_engine_completed",
        durationMs: Date.now() - started,
        topGrowth: latestSnapshot.topGrowth.length,
        topIncome: latestSnapshot.topIncome.length,
        topWatchlist: latestSnapshot.topWatchlist.length,
        approachingQualification: latestSnapshot.approachingQualification.length,
        reviewedCount: latestSnapshot.reviewedCount,
      }),
    );
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        event: "opportunity_engine_failed",
        durationMs: Date.now() - started,
        error: String(err?.message ?? err).slice(0, 200),
      }),
    );
    // Snapshot is intentionally NOT updated on failure — stale is better than null
    // when a prior successful scan exists.
  } finally {
    engineRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the opportunity engine:
 *   - kick off the first scan immediately (non-blocking)
 *   - schedule periodic refreshes
 *
 * Call once from application startup. Never blocks startup.
 */
export function scheduleOpportunityEngine(): void {
  // Run first scan asynchronously — does NOT block startup or dashboard load.
  void runOpportunityEngine();

  function scheduleNext() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await runOpportunityEngine();
      scheduleNext();
    }, REFRESH_INTERVAL_MS);
    // Don't keep Node alive solely for the timer.
    if (refreshTimer && typeof (refreshTimer as any).unref === "function") {
      (refreshTimer as any).unref();
    }
  }
  scheduleNext();
}

export function stopOpportunityEngine(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
