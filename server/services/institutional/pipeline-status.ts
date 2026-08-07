// Institutional Intelligence — Pipeline Status Service
//
// Queries DB to assemble the full pipeline status for admin API and CLI scripts.
// Read-only: never writes.

import { db } from "../../db";
import { sql, eq, and, desc } from "drizzle-orm";
import {
  institutionalIngestionRuns,
  institutional13fFilings,
  institutional13fHoldings,
  institutionalQuarterlyAggregates,
} from "@shared/schema";
import {
  computeQuarterState,
  quarterStateLabel,
  isResumable,
  isReady,
  type QuarterState,
  type QuarterProgress,
  type RunSnapshot,
} from "./quarter-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStatus {
  schedulerEnabled: boolean;
  ingestionConfigured: boolean;
  institutionalDataReady: boolean;
  lastRun: Date | null;
  nextExpectedRun: Date | null;
  quarters: QuarterPipelineEntry[];
}

export interface QuarterPipelineEntry {
  quarter: string;
  periodOfReport: string;
  state: QuarterState;
  stateLabel: string;
  progressPercent: number;
  processedAccessions: number | null;
  totalAccessions: number | null;
  storedFilings: number;
  storedHoldings: number;
  lastHeartbeat: Date | null;
  lastScheduledRun: Date | null;
  resumable: boolean;
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

/**
 * Assemble the full pipeline status for the given set of quarter labels.
 * Runs DB queries per quarter (no heavy joins).
 */
export async function getPipelineStatus(
  quarterLabels: string[],
  {
    schedulerEnabled = true,
    ingestionConfigured = false,
  }: {
    schedulerEnabled?: boolean;
    ingestionConfigured?: boolean;
  } = {},
): Promise<PipelineStatus> {
  const entries: QuarterPipelineEntry[] = [];

  for (const quarter of quarterLabels) {
    const entry = await getQuarterProgress(quarter);
    entries.push(entry);
  }

  const institutionalDataReady = entries.some((e) => e.ready);

  // Last run across all quarters
  const lastRun =
    entries
      .map((e) => e.lastScheduledRun)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // Next expected run: yesterday's last run + 24h, or tomorrow 06:00 UTC
  let nextExpectedRun: Date | null = null;
  if (lastRun) {
    nextExpectedRun = new Date(lastRun.getTime() + 24 * 60 * 60 * 1000);
  } else {
    // Default: next 06:00 UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    tomorrow.setUTCHours(6, 0, 0, 0);
    nextExpectedRun = tomorrow;
  }

  return {
    schedulerEnabled,
    ingestionConfigured,
    institutionalDataReady,
    lastRun,
    nextExpectedRun,
    quarters: entries,
  };
}

// ---------------------------------------------------------------------------
// Per-quarter progress
// ---------------------------------------------------------------------------

export async function getQuarterProgress(quarter: string): Promise<QuarterPipelineEntry> {
  // Latest run for this quarter
  const latestRuns = await db
    .select({
      status: institutionalIngestionRuns.status,
      filingCount: institutionalIngestionRuns.filingCount,
      holdingCount: institutionalIngestionRuns.holdingCount,
      mappedCount: institutionalIngestionRuns.mappedCount,
      totalAccessions: institutionalIngestionRuns.totalAccessions,
      processedAccessions: institutionalIngestionRuns.processedAccessions,
      lastHeartbeatAt: institutionalIngestionRuns.lastHeartbeatAt,
      startedAt: institutionalIngestionRuns.startedAt,
      errorCode: institutionalIngestionRuns.errorCode,
      periodOfReport: institutionalIngestionRuns.periodOfReport,
    })
    .from(institutionalIngestionRuns)
    .where(eq(institutionalIngestionRuns.quarter, quarter))
    .orderBy(desc(institutionalIngestionRuns.startedAt))
    .limit(1);

  const latestRun = latestRuns[0] ?? null;
  const periodOfReport = latestRun?.periodOfReport ?? "";

  // Actual stored filing count (ground truth — not just what this run inserted)
  const filingCountResult = periodOfReport
    ? await db
        .select({ count: sql<number>`COUNT(DISTINCT ${institutional13fFilings.accessionNumber})` })
        .from(institutional13fFilings)
        .where(eq(institutional13fFilings.periodOfReport, periodOfReport))
    : [{ count: 0 }];
  const storedFilings = Number(filingCountResult[0]?.count ?? 0);

  // Actual stored holding count
  const holdingCountResult = periodOfReport
    ? await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(institutional13fHoldings)
        .where(eq(institutional13fHoldings.periodOfReport, periodOfReport))
    : [{ count: 0 }];
  const storedHoldings = Number(holdingCountResult[0]?.count ?? 0);

  // Aggregates exist with coverage?
  const aggResult = periodOfReport
    ? await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(institutionalQuarterlyAggregates)
        .where(
          and(
            eq(institutionalQuarterlyAggregates.periodOfReport, periodOfReport),
            sql`${institutionalQuarterlyAggregates.eligibleHoldingCount} > 0`,
          ),
        )
    : [{ count: 0 }];
  const hasAggregatesWithCoverage = Number(aggResult[0]?.count ?? 0) > 0;

  const runSnapshot: RunSnapshot | null = latestRun
    ? {
        status: latestRun.status,
        filingCount: latestRun.filingCount,
        holdingCount: latestRun.holdingCount,
        mappedCount: latestRun.mappedCount,
        totalAccessions: latestRun.totalAccessions ?? null,
        processedAccessions: latestRun.processedAccessions ?? null,
        lastHeartbeatAt: latestRun.lastHeartbeatAt ?? null,
        startedAt: latestRun.startedAt,
        errorCode: latestRun.errorCode ?? null,
      }
    : null;

  const state = computeQuarterState(runSnapshot, storedFilings, hasAggregatesWithCoverage);

  // Progress percentage: stored filings vs. expected total
  const totalAccessions = runSnapshot?.totalAccessions ?? null;
  let progressPercent = 0;
  if (totalAccessions && totalAccessions > 0) {
    progressPercent = Math.min(100, Math.round((storedFilings / totalAccessions) * 100));
  } else if (state === "READY") {
    progressPercent = 100;
  }

  return {
    quarter,
    periodOfReport,
    state,
    stateLabel: quarterStateLabel(state),
    progressPercent,
    processedAccessions: runSnapshot?.processedAccessions ?? null,
    totalAccessions,
    storedFilings,
    storedHoldings,
    lastHeartbeat: runSnapshot?.lastHeartbeatAt ?? null,
    lastScheduledRun: runSnapshot?.startedAt ?? null,
    resumable: isResumable(state),
    ready: isReady(state),
  };
}

// ---------------------------------------------------------------------------
// Readiness summary
// ---------------------------------------------------------------------------

/**
 * True when at least one quarter is READY and two quarters have data.
 * Suitable for eventual INSTITUTIONAL_INTELLIGENCE_ENABLED activation decision.
 */
export function assessDataReadiness(quarters: QuarterPipelineEntry[]): {
  institutionalDataReady: boolean;
  reason: string;
} {
  const readyQuarters = quarters.filter((q) => q.ready);
  if (readyQuarters.length === 0) {
    return {
      institutionalDataReady: false,
      reason: "No quarters have completed aggregation with coverage",
    };
  }
  if (readyQuarters.length === 1) {
    return {
      institutionalDataReady: true,
      reason: `One quarter ready (${readyQuarters[0].quarter}); two quarters needed for trend analysis`,
    };
  }
  return {
    institutionalDataReady: true,
    reason: `${readyQuarters.length} quarters ready: ${readyQuarters.map((q) => q.quarter).join(", ")}`,
  };
}
