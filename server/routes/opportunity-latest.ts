// GET /api/opportunities/latest — Sprint 1.1
//
// Returns the most recent pre-computed opportunity snapshot from the Opportunity
// Engine (server/services/opportunity-engine.ts).
//
// Response shape:
//   {
//     snapshot: {                            // null before first scan
//       id, status, freshnessStatus,
//       refreshStatus, startedAt, completedAt, generatedAt,
//       dataSource, dataQuality, scannerVersion, marketRegime,
//       counts: { reviewed, qualified, watch, rejected, excluded, unavailable },
//       topGrowth[], topIncome[], topWatchlist[], approachingQualification[],
//       warnings[]
//     } | null,
//     lastRefresh: { status, attemptedAt, errorSummary }
//   }
//
// Trust rules:
//   - No stack traces, MCP session details, tokens, or internal URLs in response.
//   - freshnessStatus derived from completedAt vs configured interval.
//   - refreshStatus reflects the current engine run state.
//   - Safe error summary only (max 200 chars).

import type { Express, RequestHandler } from "express";
import {
  getLatestSnapshot,
  getRefreshState,
  getIntervalMs,
} from "../services/opportunity-engine";

/** Snapshots older than 1.5× the configured interval are considered stale. */
const FRESHNESS_MULTIPLIER = 1.5;

export function registerOpportunityLatestRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/opportunities/latest", isAuthenticated, (_req, res) => {
    const snapshot = getLatestSnapshot();
    const refreshState = getRefreshState();

    if (!snapshot) {
      return res.json({
        snapshot: null,
        lastRefresh: {
          status: refreshState.status,
          attemptedAt: refreshState.attemptedAt,
          errorSummary: refreshState.errorSummary
            ? refreshState.errorSummary.slice(0, 200)
            : null,
        },
      });
    }

    // Freshness: stale if completedAt is older than 1.5× the configured interval.
    const completedMs = snapshot.completedAt
      ? new Date(snapshot.completedAt).getTime()
      : 0;
    const staleThresholdMs = getIntervalMs() * FRESHNESS_MULTIPLIER;
    const freshnessStatus =
      Date.now() - completedMs < staleThresholdMs ? "fresh" : "stale";

    if (freshnessStatus === "stale") {
      console.log(
        JSON.stringify({
          event: "opportunity_snapshot_served_stale",
          id: snapshot.id,
          status: snapshot.status,
          completedAt: snapshot.completedAt,
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          event: "opportunity_snapshot_served",
          id: snapshot.id,
          status: snapshot.status,
        }),
      );
    }

    return res.json({
      snapshot: {
        id: snapshot.id,
        status: snapshot.status,
        freshnessStatus,
        refreshStatus: refreshState.status,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        generatedAt: snapshot.generatedAt,
        dataSource: snapshot.dataSource,
        dataQuality: snapshot.dataQuality,
        scannerVersion: snapshot.scannerVersion,
        marketRegime: snapshot.marketRegime,
        counts: {
          reviewed: snapshot.reviewedCount,
          qualified: snapshot.qualifiedCount,
          watch: snapshot.watchCount,
          rejected: snapshot.rejectedCount,
          excluded: snapshot.excludedCount,
          unavailable: snapshot.unavailableCount,
        },
        topGrowth: snapshot.topGrowth,
        topIncome: snapshot.topIncome,
        topWatchlist: snapshot.topWatchlist,
        approachingQualification: snapshot.approachingQualification,
        warnings: snapshot.warnings,
      },
      lastRefresh: {
        status: refreshState.status,
        attemptedAt: refreshState.attemptedAt,
        errorSummary: null, // Only exposed when snapshot is null
      },
    });
  });
}
