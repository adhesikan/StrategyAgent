// Institutional 13F Ingestion Service — Sprint 2.2.5.
//
// Orchestrates the full 13F ingestion workflow:
//   1. Acquire PostgreSQL advisory lock (key 774_412_003) — prevents concurrent runs.
//   2. Determine which quarters need ingestion.
//   3. Download SEC EDGAR quarterly index for each quarter.
//   4. For each 13F-HR filer, fetch and parse the InfoTable.
//   5. Store filings + holdings in the DB (idempotent upserts).
//   6. Apply symbol mappings.
//   7. Recompute quarterly aggregates for each mapped symbol.
//   8. Release lock.
//
// RULES (non-negotiable):
//   - NEVER performs bulk ingestion during ordinary page requests.
//   - Does NOT block application startup (called fire-and-forget).
//   - Does NOT issue any SEC requests if SEC_USER_AGENT is not configured.
//   - Does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true — ingestion can
//     run while the public UI tab is disabled (pre-activation backfill flow).
//   - DOES require INSTITUTIONAL_13F_INGESTION_ENABLED=true (default) AND
//     SEC_USER_AGENT to be set.
//   - FAILED status never replaces a completed/partial ingestion run.
//   - Advisory lock prevents concurrent runs across Railway instances.

import { db } from "../../db";
import { sql, eq, and, gt, inArray, desc, gte, or, lt } from "drizzle-orm";
import {
  institutional13fFilings,
  institutional13fHoldings,
  institutionalQuarterlyAggregates,
  institutionalIngestionRuns,
  institutionalSecurityMappings,
} from "@shared/schema";
import type {
  InsertInstitutional13fFiling,
  InsertInstitutional13fHolding,
  InsertInstitutionalQuarterlyAggregate,
} from "@shared/schema";
import {
  getInstitutionalConfig,
  parseQuarterLabel,
  isIngestionConfigured,
  recentQuarters,
  quarterFromPeriodDate,
  INSTITUTIONAL_ADVISORY_LOCK_KEY,
  getAccessionsPerRun,
  getStaleRunThresholdMinutes,
} from "./config";
import {
  parseBulkQuarter,
  parseBulkFromDescriptor,
  bulkDatasetUrl,
} from "./sec-13f-bulk-parser";
import type { ParsedBulkHolding } from "./sec-13f-bulk-parser";
import type { DatasetDescriptor } from "./sec-dataset-catalog";
import { resolveMappingsBatch, applyMappingsToHoldings, getMappedSymbols } from "./mapping-service";
import { computeQuarterlyAggregate, derivePeriodLabel, type AggregationInput } from "./aggregation-engine";
import { classifyTrend } from "./trend-classifier";
import { computeEvidenceAlignment } from "./evidence-alignment";

// ---------------------------------------------------------------------------
// Structured logging (safe: no credentials, no full payloads, no user data)
// ---------------------------------------------------------------------------

function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe = { event, ts: new Date().toISOString(), ...fields };
  // Never log: env secrets, raw filing content, full HTTP headers, DB URL
  console.log(JSON.stringify(safe));
}

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------

async function tryAcquireLock(): Promise<boolean> {
  const res: any = await db.execute(
    sql`SELECT pg_try_advisory_lock(${INSTITUTIONAL_ADVISORY_LOCK_KEY}) AS locked`,
  );
  const row = res.rows?.[0] ?? res[0];
  return row?.locked === true;
}

async function releaseLock(): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_unlock(${INSTITUTIONAL_ADVISORY_LOCK_KEY})`,
  );
}

// ---------------------------------------------------------------------------
// Ingestion run lifecycle
// ---------------------------------------------------------------------------

async function createRun(quarter: string, periodOfReport: string, initiatedBy: string): Promise<string> {
  const [row] = await db
    .insert(institutionalIngestionRuns)
    .values({ quarter, periodOfReport, status: "running", initiatedBy })
    .returning({ id: institutionalIngestionRuns.id });
  return row.id;
}

async function updateRun(
  id: string,
  update: Partial<{
    status: string;
    filingCount: number;
    holdingCount: number;
    mappedCount: number;
    unmappedCount: number;
    errorCode: string;
    errorSummary: string;
    completedAt: Date;
    durationMs: number;
    totalAccessions: number;
    processedAccessions: number;
    lastHeartbeatAt: Date;
  }>,
): Promise<void> {
  await db
    .update(institutionalIngestionRuns)
    .set(update as any)
    .where(eq(institutionalIngestionRuns.id, id));
}

/**
 * Write a lightweight heartbeat to the run record.
 * Called every HEARTBEAT_INTERVAL accessions and at persistence start.
 * Never throws — failures are swallowed to avoid disrupting ingestion.
 */
async function heartbeatRun(
  id: string,
  processedAccessions: number,
  totalAccessions: number,
): Promise<void> {
  await db
    .update(institutionalIngestionRuns)
    .set({
      processedAccessions,
      totalAccessions,
      lastHeartbeatAt: new Date(),
    } as any)
    .where(eq(institutionalIngestionRuns.id, id));
}

/**
 * Mark stale "running" ingestion runs as partial.
 *
 * A run is stale when its last_heartbeat_at (or started_at if no heartbeat)
 * is older than staleThresholdMinutes. This prevents permanently-stuck "running"
 * entries after a Railway restart or SIGKILL.
 *
 * Advisory-lock safety: if another process currently holds the institutional
 * advisory lock (i.e. an active ingestion is running), cleanup is skipped
 * entirely. This prevents a second cron invocation from marking an active
 * run as stale mid-flight. The lock is acquired and immediately released —
 * it is only used as a "is-anyone-ingesting?" check, not held for ingestion.
 *
 * Safe to call at daily-job startup. Returns the number of runs cleaned up,
 * or -1 if cleanup was skipped because ingestion is actively locked.
 */
export async function cleanStalePendingRuns(
  staleThresholdMinutes = getStaleRunThresholdMinutes(),
): Promise<number> {
  // Check advisory lock: if held by another process, an active ingestion is
  // in progress and we must not touch its run record.
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${INSTITUTIONAL_ADVISORY_LOCK_KEY}::bigint) AS acquired`,
  );
  const lockAcquired = (lockResult.rows[0] as any)?.acquired === true;
  if (!lockAcquired) {
    log("institutional_stale_cleanup_skipped", {
      reason: "advisory_lock_held",
      hint: "Another ingestion process is actively running — cleanup deferred.",
    });
    return -1; // -1 = skipped (not an error)
  }
  // Release immediately: we only needed it to confirm no active ingestion exists.
  await db.execute(
    sql`SELECT pg_advisory_unlock(${INSTITUTIONAL_ADVISORY_LOCK_KEY}::bigint)`,
  );

  const threshold = new Date(Date.now() - staleThresholdMinutes * 60 * 1_000);

  // Find stale running runs
  const staleRows = await db
    .select({ id: institutionalIngestionRuns.id, quarter: institutionalIngestionRuns.quarter })
    .from(institutionalIngestionRuns)
    .where(
      and(
        eq(institutionalIngestionRuns.status, "running"),
        or(
          // Has heartbeat but it's stale
          and(
            sql`${institutionalIngestionRuns.lastHeartbeatAt} IS NOT NULL`,
            lt(institutionalIngestionRuns.lastHeartbeatAt as any, threshold),
          ),
          // No heartbeat and started_at is stale
          and(
            sql`${institutionalIngestionRuns.lastHeartbeatAt} IS NULL`,
            lt(institutionalIngestionRuns.startedAt, threshold),
          ),
        ),
      ),
    );

  if (staleRows.length === 0) return 0;

  const ids = staleRows.map((r) => r.id);
  await db
    .update(institutionalIngestionRuns)
    .set({
      status: "partial",
      errorCode: "STALE_RUN_INTERRUPTED",
      errorSummary: `Run interrupted — no heartbeat for ${staleThresholdMinutes}+ minutes`,
      completedAt: new Date(),
    } as any)
    .where(inArray(institutionalIngestionRuns.id, ids));

  for (const r of staleRows) {
    log("institutional_13f_stale_run_cleaned", {
      runId: r.id,
      quarter: r.quarter,
      staleThresholdMinutes,
    });
  }

  return staleRows.length;
}

// ---------------------------------------------------------------------------
// Filing upsert
// ---------------------------------------------------------------------------

async function upsertFiling(filing: InsertInstitutional13fFiling): Promise<void> {
  await db
    .insert(institutional13fFilings)
    .values(filing)
    .onConflictDoNothing({ target: institutional13fFilings.accessionNumber });
}

// ---------------------------------------------------------------------------
// Holdings upsert (idempotent)
// ---------------------------------------------------------------------------

async function upsertHoldings(holdings: InsertInstitutional13fHolding[]): Promise<void> {
  if (holdings.length === 0) return;
  // Insert in batches of 500 to avoid oversized queries
  for (let i = 0; i < holdings.length; i += 500) {
    const batch = holdings.slice(i, i + 500);
    await db
      .insert(institutional13fHoldings)
      .values(batch)
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// Amendment effectiveness tracking
// ---------------------------------------------------------------------------

/**
 * After ingesting an amendment (13F-HR/A), mark the previous filing for the same
 * filer+quarter as no longer effective.
 *
 * Policy:
 *   - Retain original and amended filings for auditability.
 *   - Only the most recent filing for a filer+quarter is marked isEffective=true.
 *   - If an amendment and original both exist, the amendment supersedes the original.
 */
async function updateEffectivenessForFiler(
  filerCik: string,
  periodOfReport: string,
  newAccession: string,
  newFilingDate: string,
): Promise<void> {
  // Mark all other filings for this filer+quarter as not effective
  await db
    .update(institutional13fFilings)
    .set({ isEffective: false })
    .where(
      and(
        eq(institutional13fFilings.filerCik, filerCik),
        eq(institutional13fFilings.periodOfReport, periodOfReport),
        sql`${institutional13fFilings.accessionNumber} != ${newAccession}`,
      ),
    );
}

// ---------------------------------------------------------------------------
// Aggregate recomputation for a symbol after ingestion
// ---------------------------------------------------------------------------

async function recomputeAggregateForSymbol(
  symbol: string,
  periodOfReport: string,
  prevPeriodOfReport: string | null,
): Promise<void> {
  // Fetch current quarter holdings (effective filings only)
  const currentHoldings = await db
    .select({
      filerCik: institutional13fHoldings.filerCik,
      filerName: institutional13fHoldings.filerName,
      reportedShares: institutional13fHoldings.reportedShares,
      reportedValue: institutional13fHoldings.reportedValue,
      putCall: institutional13fHoldings.putCall,
      sharesPrnType: institutional13fHoldings.sharesPrnType,
      mappingStatus: institutional13fHoldings.mappingStatus,
      periodOfReport: institutional13fHoldings.periodOfReport,
      filingDate: institutional13fHoldings.filingDate,
      accessionNumber: institutional13fHoldings.accessionNumber,
    })
    .from(institutional13fHoldings)
    // Join to only include holdings from effective filings
    .innerJoin(
      institutional13fFilings,
      and(
        eq(institutional13fHoldings.accessionNumber, institutional13fFilings.accessionNumber),
        eq(institutional13fFilings.isEffective, true),
      ),
    )
    .where(
      and(
        eq(institutional13fHoldings.mappedSymbol, symbol),
        eq(institutional13fHoldings.periodOfReport, periodOfReport),
      ),
    );

  // Fetch prior quarter holdings
  const previousHoldings = prevPeriodOfReport
    ? await db
        .select({
          filerCik: institutional13fHoldings.filerCik,
          filerName: institutional13fHoldings.filerName,
          reportedShares: institutional13fHoldings.reportedShares,
          reportedValue: institutional13fHoldings.reportedValue,
          putCall: institutional13fHoldings.putCall,
          sharesPrnType: institutional13fHoldings.sharesPrnType,
          mappingStatus: institutional13fHoldings.mappingStatus,
          periodOfReport: institutional13fHoldings.periodOfReport,
          filingDate: institutional13fHoldings.filingDate,
          accessionNumber: institutional13fHoldings.accessionNumber,
        })
        .from(institutional13fHoldings)
        .innerJoin(
          institutional13fFilings,
          and(
            eq(institutional13fHoldings.accessionNumber, institutional13fFilings.accessionNumber),
            eq(institutional13fFilings.isEffective, true),
          ),
        )
        .where(
          and(
            eq(institutional13fHoldings.mappedSymbol, symbol),
            eq(institutional13fHoldings.periodOfReport, prevPeriodOfReport),
          ),
        )
    : [];

  // Check for amendments in this quarter
  const amendmentRows = await db
    .select({ accessionNumber: institutional13fFilings.accessionNumber })
    .from(institutional13fFilings)
    .where(
      and(
        eq(institutional13fFilings.periodOfReport, periodOfReport),
        eq(institutional13fFilings.amendmentFlag, true),
      ),
    )
    .limit(1);

  const input: AggregationInput = {
    symbol,
    periodOfReport,
    currentHoldings: currentHoldings as any,
    previousHoldings: previousHoldings as any,
    prevPeriodOfReport,
    hasAmendments: amendmentRows.length > 0,
    hasPendingAmendments: false,
  };

  const agg = computeQuarterlyAggregate(input);

  // Fetch prior aggregate for trend
  let prevAgg = null;
  if (prevPeriodOfReport) {
    const [prevRow] = await db
      .select()
      .from(institutionalQuarterlyAggregates)
      .where(
        and(
          eq(institutionalQuarterlyAggregates.symbol, symbol),
          eq(institutionalQuarterlyAggregates.periodOfReport, prevPeriodOfReport),
        ),
      )
      .limit(1);
    prevAgg = prevRow ?? null;
  }

  const trendResult = classifyTrend(agg, prevAgg as any);

  const insert: InsertInstitutionalQuarterlyAggregate = {
    symbol,
    periodOfReport,
    periodLabel: derivePeriodLabel(periodOfReport),
    reportingManagerCount: agg.reportingManagerCount,
    aggregateReportedShares: agg.aggregateReportedShares,
    aggregateReportedValue: agg.aggregateReportedValue,
    prevPeriodOfReport,
    previousQuarterShares: agg.previousQuarterShares,
    previousQuarterValue: agg.previousQuarterValue,
    reportedSharesChange: agg.reportedSharesChange,
    reportedSharesChangePercent: agg.reportedSharesChangePercent,
    newPositionCount: agg.newPositionCount,
    increasedPositionCount: agg.increasedPositionCount,
    reducedPositionCount: agg.reducedPositionCount,
    exitedPositionCount: agg.exitedPositionCount,
    unchangedCount: agg.unchangedCount,
    topHolderPercent: agg.topHolderPercent,
    top5HolderPercent: agg.top5HolderPercent,
    top10HolderPercent: agg.top10HolderPercent,
    concentrationClassification: agg.concentrationClassification,
    trend: trendResult.trend,
    largestHolders: agg.largestHolders as any,
    eligibleHoldingCount: agg.eligibleHoldingCount,
    excludedHoldingCount: agg.excludedHoldingCount,
    coverageStatus: agg.coverageStatus,
    amendmentStatus: agg.amendmentStatus,
  };

  await db
    .insert(institutionalQuarterlyAggregates)
    .values(insert)
    .onConflictDoUpdate({
      target: [
        institutionalQuarterlyAggregates.symbol,
        institutionalQuarterlyAggregates.periodOfReport,
      ],
      set: {
        reportingManagerCount: insert.reportingManagerCount,
        aggregateReportedShares: insert.aggregateReportedShares,
        aggregateReportedValue: insert.aggregateReportedValue,
        prevPeriodOfReport: insert.prevPeriodOfReport,
        previousQuarterShares: insert.previousQuarterShares,
        previousQuarterValue: insert.previousQuarterValue,
        reportedSharesChange: insert.reportedSharesChange,
        reportedSharesChangePercent: insert.reportedSharesChangePercent,
        newPositionCount: insert.newPositionCount,
        increasedPositionCount: insert.increasedPositionCount,
        reducedPositionCount: insert.reducedPositionCount,
        exitedPositionCount: insert.exitedPositionCount,
        unchangedCount: insert.unchangedCount,
        topHolderPercent: insert.topHolderPercent,
        top5HolderPercent: insert.top5HolderPercent,
        top10HolderPercent: insert.top10HolderPercent,
        concentrationClassification: insert.concentrationClassification,
        trend: insert.trend,
        largestHolders: insert.largestHolders,
        eligibleHoldingCount: insert.eligibleHoldingCount,
        excludedHoldingCount: insert.excludedHoldingCount,
        coverageStatus: insert.coverageStatus,
        amendmentStatus: insert.amendmentStatus,
        generatedAt: new Date(),
      },
    });
}


// ---------------------------------------------------------------------------
// Quarter ingestion
// ---------------------------------------------------------------------------

interface QuarterIngestionResult {
  quarter: string;
  periodOfReport: string;
  filingCount: number;
  holdingCount: number;
  mappedCount: number;
  unmappedCount: number;
  /** Filings that already existed in DB and were skipped (idempotent re-run). */
  skippedExistingFilings: number;
  status: "completed" | "partial" | "empty_not_published" | "empty_parse_failure" | "failed";
  /** Set when status="partial" due to AbortSignal timeout. */
  abortedByTimeout?: boolean;
  /** Set when status="partial" due to bounded chunk limit (clean stop, not a timeout). */
  chunkLimitReached?: boolean;
  /** Set when eligible rows > threshold but persistedHoldings = 0 despite no abort. */
  persistenceCountMismatch?: boolean;
  /** Error code to store in the run record when status is a failure variant. */
  errorCode?: string;
  /** Total accessions in the parsed dataset (for run record storage). */
  totalAccessions?: number;
  /** Accessions processed (checked) in this invocation (both new and skipped). */
  processedAccessions?: number;
}

/** Minimum number of eligible common-stock rows below which PERSISTENCE_COUNT_MISMATCH is not raised. */
const MIN_ELIGIBLE_FOR_MISMATCH_CHECK = 1_000;

/**
 * Log a structured progress event during the persistence phase.
 * Emitted every PROGRESS_LOG_INTERVAL accessions to prevent silent 20-minute gaps.
 */
function logPersistenceProgress(
  quarter: string,
  phase: "holdings",
  processedAccessions: number,
  totalAccessions: number,
  insertedFilings: number,
  skippedFilings: number,
  insertedHoldings: number,
  startMs: number,
): void {
  const elapsedSeconds = Math.round((Date.now() - startMs) / 1000);
  const rowsPerSecond = elapsedSeconds > 0 ? Math.round(insertedHoldings / elapsedSeconds) : 0;
  log("institutional_13f_persistence_progress", {
    quarter,
    phase,
    processedAccessions,
    totalAccessions,
    insertedFilings,
    skippedFilings,
    insertedHoldings,
    elapsedSeconds,
    rowsPerSecond,
  });
}

const PROGRESS_LOG_INTERVAL = 100; // log every N accessions
const HEARTBEAT_INTERVAL = 50;    // write heartbeat to DB every N accessions

async function ingestQuarter(
  year: number,
  q: 1 | 2 | 3 | 4,
  periodEnd: string,
  signal: AbortSignal,
  opts?: { chunkSize?: number; runId?: string },
): Promise<QuarterIngestionResult> {
  const quarter = `${year}-Q${q}`;

  log("institutional_13f_ingestion_started", { quarter, year, q });

  // Download and parse the bulk archive.
  // NOTE: parseBulkQuarter uses the legacy YYYYqN URL construction, which
  // only works for datasets through 2023Q4. For post-2023 datasets, the
  // runInstitutionalIngestion path now uses ingestFromDescriptor instead.
  const parseResult = await parseBulkQuarter(year, q, signal);

  log("institutional_13f_archive_inspected", {
    quarter,
    archiveBytes: parseResult.diagnostics.archiveBytes,
    entryCount: parseResult.diagnostics.archiveEntries.length,
    entryNames: parseResult.diagnostics.archiveEntries.slice(0, 8),
    resolvedSubmissionEntry: parseResult.diagnostics.resolvedSubmissionEntry,
    resolvedCoverPageEntry: parseResult.diagnostics.resolvedCoverPageEntry,
    resolvedInfoTableEntry: parseResult.diagnostics.resolvedInfoTableEntry,
    resolutionMode: parseResult.diagnostics.resolutionMode,
    status: parseResult.status,
  });

  if (parseResult.status === "empty_not_published") {
    log("institutional_13f_quarter_not_published", { quarter });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings: 0,
      status: "empty_not_published",
    };
  }

  if (parseResult.status === "failed" || parseResult.status === "empty_parse_failure") {
    log("institutional_13f_empty_parse_failure", {
      quarter,
      reason: parseResult.reason,
      submissionRows: parseResult.diagnostics.submissionRows,
      informationTableRows: parseResult.diagnostics.informationTableRows,
      joinedHoldingRows: parseResult.diagnostics.joinedHoldingRows,
      rejectedRows: parseResult.diagnostics.rejectedRows,
    });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings: 0,
      status: parseResult.status,
    };
  }

  log("institutional_13f_rows_parsed", {
    quarter,
    submissionRows: parseResult.diagnostics.submissionRows,
    parsedSubmissionRows: parseResult.diagnostics.parsedSubmissionRows,
    submissionTypeCounts: parseResult.diagnostics.submissionTypeCounts,
    normalizedSubmissionTypeCounts: parseResult.diagnostics.normalizedSubmissionTypeCounts,
    // type classification
    recognizedHoldingsFormRows: parseResult.diagnostics.recognizedHoldingsFormRows,
    recognized13fHrRows: parseResult.diagnostics.recognized13fHrRows,
    recognized13fHrAmendmentRows: parseResult.diagnostics.recognized13fHrAmendmentRows,
    excludedNoticeRows: parseResult.diagnostics.excludedNoticeRows,
    excludedUnknownTypeRows: parseResult.diagnostics.excludedUnknownTypeRows,
    // field-level rejection counters
    rejectedMissingAccession: parseResult.diagnostics.rejectedMissingAccession,
    rejectedInvalidAccession: parseResult.diagnostics.rejectedInvalidAccession,
    rejectedMissingCik: parseResult.diagnostics.rejectedMissingCik,
    rejectedInvalidCik: parseResult.diagnostics.rejectedInvalidCik,
    rejectedMissingPeriodOfReport: parseResult.diagnostics.rejectedMissingPeriodOfReport,
    rejectedInvalidPeriodOfReport: parseResult.diagnostics.rejectedInvalidPeriodOfReport,
    rejectedInvalidFilingDate: parseResult.diagnostics.rejectedInvalidFilingDate,
    rejectedOtherSubmissionValidation: parseResult.diagnostics.rejectedOtherSubmissionValidation,
    // post-validation
    includedSubmissionCount: parseResult.diagnostics.includedSubmissionCount,
    excludedNoticeCount: parseResult.diagnostics.excludedNoticeCount,
    excludedUnknownSubmissionTypeCount: parseResult.diagnostics.excludedUnknownSubmissionTypeCount,
    amendmentSubmissionCount: parseResult.diagnostics.amendmentSubmissionCount,
    coverPageRows: parseResult.diagnostics.coverPageRows,
    parsedCoverPageRows: parseResult.diagnostics.parsedCoverPageRows,
    coverPageJoinCount: parseResult.diagnostics.coverPageJoinCount,
    coverPageUnmatchedSubmissionCount: parseResult.diagnostics.coverPageUnmatchedSubmissionCount,
    duplicateCoverPageAccessionCount: parseResult.diagnostics.duplicateCoverPageAccessionCount,
    informationTableRows: parseResult.diagnostics.informationTableRows,
    parsedInformationRows: parseResult.diagnostics.parsedInformationRows,
    joinedHoldingRows: parseResult.diagnostics.joinedHoldingRows,
    missingManagerIdentityCount: parseResult.diagnostics.missingManagerIdentityCount,
    managerCikConflictCount: parseResult.diagnostics.managerCikConflictCount,
    missingManagerCikCount: parseResult.diagnostics.missingManagerCikCount,
    amendmentFlagConflictCount: parseResult.diagnostics.amendmentFlagConflictCount,
    rejectedRows: parseResult.diagnostics.rejectedRows,
    eligibleCommonStockRows: parseResult.diagnostics.eligibleCommonStockRows,
    putCallExcludedRows: parseResult.diagnostics.putCallExcludedRows,
    prnExcludedRows: parseResult.diagnostics.prnExcludedRows,
    submissionHeaderMapping: parseResult.diagnostics.submissionHeaderMapping,
    coverPageHeaderMapping: parseResult.diagnostics.coverPageHeaderMapping,
    infoTableHeaderMapping: parseResult.diagnostics.infoTableHeaderMapping,
    durationMs: parseResult.diagnostics.durationMs,
  });

  // Group holdings by accession number (one DB filing row per accession)
  const holdingsByAccession = new Map<string, ParsedBulkHolding[]>();
  for (const h of parseResult.holdings) {
    if (!holdingsByAccession.has(h.accessionNumber)) {
      holdingsByAccession.set(h.accessionNumber, []);
    }
    holdingsByAccession.get(h.accessionNumber)!.push(h);
  }

  const totalAccessions = holdingsByAccession.size;
  log("institutional_13f_persistence_started", {
    quarter,
    totalAccessions,
    totalHoldings: parseResult.holdings.length,
    eligibleCommonStockRows: parseResult.diagnostics.eligibleCommonStockRows,
  });

  let filingCount = 0;
  let holdingCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let skippedExistingFilings = 0;
  let abortedEarly = false;
  let chunkLimitReached = false;
  let newAccessions = 0;
  let processedAccessions = 0;
  const chunkSize = opts?.chunkSize ?? Infinity;
  const sourceUrl = bulkDatasetUrl(year, q);
  const persistenceStartMs = Date.now();

  // Record totalAccessions in the run record immediately (fire-and-forget)
  if (opts?.runId) {
    heartbeatRun(opts.runId, 0, totalAccessions).catch(() => {});
  }

  for (const [accession, holdings] of Array.from(holdingsByAccession.entries())) {
    if (signal.aborted) { abortedEarly = true; break; }

    // Idempotent: skip accessions already in the database
    const existing = await db
      .select({ id: institutional13fFilings.id })
      .from(institutional13fFilings)
      .where(eq(institutional13fFilings.accessionNumber, accession))
      .limit(1);

    processedAccessions++;

    if (existing.length > 0) {
      skippedExistingFilings++;
      // Heartbeat for skipped accessions too (progress tracking)
      if (processedAccessions % HEARTBEAT_INTERVAL === 0 && opts?.runId) {
        heartbeatRun(opts.runId, processedAccessions, totalAccessions).catch(() => {});
      }
      continue;
    }

    const first = holdings[0];

    await upsertFiling({
      accessionNumber: accession,
      filerCik: first.filerCik,
      filerName: first.filerName,
      filingType: first.filingType,
      filingDate: first.filingDate,
      acceptedAt: null,
      periodOfReport: first.periodOfReport,
      amendmentFlag: first.isAmendment,
      amendmentNumber: null,
      amendmentType: null,
      isEffective: true,
      sourceUrl,
      sourceChecksum: null,
    });

    if (first.isAmendment) {
      await updateEffectivenessForFiler(
        first.filerCik,
        first.periodOfReport,
        accession,
        first.filingDate,
      );
    }

    const holdingRows: InsertInstitutional13fHolding[] = holdings.map((h) => ({
      accessionNumber: h.accessionNumber,
      filerCik: h.filerCik,
      filerName: h.filerName,
      issuerName: h.issuerName,
      classTitle: h.classTitle,
      cusip: h.cusip,
      figi: h.figi,
      reportedValue: h.reportedValue,
      reportedShares: h.reportedShares,
      sharesPrnType: h.sharesPrnType,
      putCall: h.putCall,
      investmentDiscretion: h.investmentDiscretion,
      otherManager: h.otherManager,
      votingSole: h.votingSole,
      votingShared: h.votingShared,
      votingNone: h.votingNone,
      periodOfReport: h.periodOfReport,
      filingDate: h.filingDate,
      mappedSymbol: null,
      mappingStatus: "unmapped",
    }));

    await upsertHoldings(holdingRows);

    const { mappedCount: mc, unmappedCount: uc } =
      await applyMappingsToHoldings(accession);

    filingCount++;
    holdingCount += holdingRows.length;
    mappedCount += mc;
    unmappedCount += uc;
    newAccessions++;

    if (processedAccessions % PROGRESS_LOG_INTERVAL === 0) {
      logPersistenceProgress(
        quarter, "holdings", processedAccessions, totalAccessions,
        filingCount, skippedExistingFilings, holdingCount, persistenceStartMs,
      );
    }

    // Heartbeat: write progress to DB for stale-run detection and resumability
    if (processedAccessions % HEARTBEAT_INTERVAL === 0 && opts?.runId) {
      heartbeatRun(opts.runId, processedAccessions, totalAccessions).catch(() => {});
    }

    // Chunk limit: exit cleanly after processing N new accessions this invocation
    if (chunkSize !== Infinity && newAccessions >= chunkSize) {
      chunkLimitReached = true;
      break;
    }
  }

  log("institutional_13f_join_summary", {
    quarter,
    totalAccessions,
    processedAccessions,
    filingCount,
    skippedExistingFilings,
    holdingCount,
    mappedCount,
    unmappedCount,
    abortedEarly,
    chunkLimitReached,
  });

  // Chunk limit reached: clean partial stop (not a timeout).
  // Aggregation is deferred until persistence is complete.
  if (chunkLimitReached) {
    log("institutional_13f_chunk_complete", {
      quarter,
      newAccessions,
      processedAccessions,
      totalAccessions,
      remainingAccessions: totalAccessions - processedAccessions,
      filingCount,
      holdingCount,
    });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      chunkLimitReached: true,
    };
  }

  // AbortSignal fired: run is partial, not completed.
  // The next re-run will safely resume via skippedExistingFilings logic.
  if (abortedEarly) {
    log("institutional_13f_ingestion_aborted", {
      quarter,
      reason: "timeout_or_signal",
      processedAccessions,
      remainingAccessions: totalAccessions - processedAccessions,
      filingCount,
      holdingCount,
    });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      abortedByTimeout: true,
    };
  }

  // All filings were already in the DB (idempotent re-run) — completed with 0 new rows
  if (filingCount === 0 && skippedExistingFilings === totalAccessions && totalAccessions > 0) {
    log("institutional_13f_idempotent_rerun", { quarter, skippedExistingFilings });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "completed",
    };
  }

  // PERSISTENCE_COUNT_MISMATCH: eligible rows present but nothing was persisted
  const eligibleRows = parseResult.diagnostics.eligibleCommonStockRows;
  if (holdingCount === 0 && eligibleRows > MIN_ELIGIBLE_FOR_MISMATCH_CHECK && totalAccessions > 0) {
    log("institutional_13f_persistence_count_mismatch", {
      quarter,
      eligibleCommonStockRows: eligibleRows,
      holdingCount,
      filingCount,
      totalAccessions,
      skippedExistingFilings,
    });
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      persistenceCountMismatch: true,
      errorCode: "PERSISTENCE_COUNT_MISMATCH",
    };
  }

  // Persistence complete — recompute aggregates for all mapped symbols
  log("institutional_13f_aggregation_started", { quarter });
  const mappedSymbols = await getMappedSymbols();
  for (const symbol of mappedSymbols) {
    if (signal.aborted) break;
    try {
      await recomputeAggregateForSymbol(symbol, periodEnd, null);
    } catch (err: any) {
      log("institutional_aggregate_error", { symbol, errorCode: err.name ?? "ERROR" });
    }
  }

  log("institutional_13f_aggregation_completed", {
    quarter,
    symbolCount: mappedSymbols.length,
  });

  const finalStatus = parseResult.status === "partial_success" ? "partial" : "completed";
  log("institutional_13f_dataset_completed", {
    quarter,
    filingCount,
    skippedExistingFilings,
    holdingCount,
    mappedCount,
    unmappedCount,
    totalAccessions,
    status: finalStatus,
  });

  return {
    quarter,
    periodOfReport: periodEnd,
    filingCount,
    holdingCount,
    mappedCount,
    unmappedCount,
    skippedExistingFilings,
    totalAccessions,
    processedAccessions,
    status: finalStatus,
  };
}

// ---------------------------------------------------------------------------
// Descriptor-based ingestion (catalog-driven, post-2023 safe)
// ---------------------------------------------------------------------------

/**
 * Ingest a single SEC 13F bulk dataset identified by a catalog DatasetDescriptor.
 *
 * Uses parseBulkFromDescriptor() to download via the descriptor's exact URL,
 * then persists filings + holdings using the actual CONFORMED-PERIOD-OF-REPORT
 * from each filing row (not the descriptor's expected period).
 *
 * The descriptor's expectedPeriodOfReport is used as the run-record period
 * and return value period (for aggregation scheduling). Individual filing rows
 * carry their own periodOfReport as parsed from SUBMISSION.TSV.
 */
async function ingestFromDescriptor(
  descriptor: DatasetDescriptor,
  signal: AbortSignal,
  opts?: { chunkSize?: number; runId?: string },
): Promise<QuarterIngestionResult> {
  const quarter = `${descriptor.year}-Q${descriptor.q}`;
  const sourceUrl = descriptor.downloadUrl;

  log("institutional_13f_ingestion_started", {
    quarter,
    fileName: descriptor.fileName,
    windowStart: descriptor.windowStart,
    windowEnd: descriptor.windowEnd,
    expectedPeriodOfReport: descriptor.expectedPeriodOfReport,
  });

  const parseResult = await parseBulkFromDescriptor(descriptor, signal);

  log("institutional_13f_archive_inspected", {
    quarter,
    fileName: descriptor.fileName,
    archiveBytes: parseResult.diagnostics.archiveBytes,
    entryCount: parseResult.diagnostics.archiveEntries.length,
    entryNames: parseResult.diagnostics.archiveEntries.slice(0, 8),
    resolvedSubmissionEntry: parseResult.diagnostics.resolvedSubmissionEntry,
    resolvedCoverPageEntry: parseResult.diagnostics.resolvedCoverPageEntry,
    resolvedInfoTableEntry: parseResult.diagnostics.resolvedInfoTableEntry,
    resolutionMode: parseResult.diagnostics.resolutionMode,
    status: parseResult.status,
  });

  if (parseResult.status === "empty_not_published") {
    log("institutional_13f_quarter_not_published", { quarter, fileName: descriptor.fileName });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings: 0,
      status: "empty_not_published",
    };
  }

  if (parseResult.status === "failed" || parseResult.status === "empty_parse_failure") {
    log("institutional_13f_empty_parse_failure", {
      quarter,
      fileName: descriptor.fileName,
      reason: parseResult.reason,
      submissionRows: parseResult.diagnostics.submissionRows,
      informationTableRows: parseResult.diagnostics.informationTableRows,
      joinedHoldingRows: parseResult.diagnostics.joinedHoldingRows,
      rejectedRows: parseResult.diagnostics.rejectedRows,
    });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings: 0,
      status: parseResult.status,
    };
  }

  log("institutional_13f_rows_parsed", {
    quarter,
    fileName: descriptor.fileName,
    submissionRows: parseResult.diagnostics.submissionRows,
    parsedSubmissionRows: parseResult.diagnostics.parsedSubmissionRows,
    submissionTypeCounts: parseResult.diagnostics.submissionTypeCounts,
    normalizedSubmissionTypeCounts: parseResult.diagnostics.normalizedSubmissionTypeCounts,
    // type classification
    recognizedHoldingsFormRows: parseResult.diagnostics.recognizedHoldingsFormRows,
    recognized13fHrRows: parseResult.diagnostics.recognized13fHrRows,
    recognized13fHrAmendmentRows: parseResult.diagnostics.recognized13fHrAmendmentRows,
    excludedNoticeRows: parseResult.diagnostics.excludedNoticeRows,
    excludedUnknownTypeRows: parseResult.diagnostics.excludedUnknownTypeRows,
    // field-level rejection counters
    rejectedMissingAccession: parseResult.diagnostics.rejectedMissingAccession,
    rejectedInvalidAccession: parseResult.diagnostics.rejectedInvalidAccession,
    rejectedMissingCik: parseResult.diagnostics.rejectedMissingCik,
    rejectedInvalidCik: parseResult.diagnostics.rejectedInvalidCik,
    rejectedMissingPeriodOfReport: parseResult.diagnostics.rejectedMissingPeriodOfReport,
    rejectedInvalidPeriodOfReport: parseResult.diagnostics.rejectedInvalidPeriodOfReport,
    rejectedInvalidFilingDate: parseResult.diagnostics.rejectedInvalidFilingDate,
    rejectedOtherSubmissionValidation: parseResult.diagnostics.rejectedOtherSubmissionValidation,
    // post-validation
    includedSubmissionCount: parseResult.diagnostics.includedSubmissionCount,
    excludedNoticeCount: parseResult.diagnostics.excludedNoticeCount,
    excludedUnknownSubmissionTypeCount: parseResult.diagnostics.excludedUnknownSubmissionTypeCount,
    amendmentSubmissionCount: parseResult.diagnostics.amendmentSubmissionCount,
    coverPageRows: parseResult.diagnostics.coverPageRows,
    parsedCoverPageRows: parseResult.diagnostics.parsedCoverPageRows,
    coverPageJoinCount: parseResult.diagnostics.coverPageJoinCount,
    coverPageUnmatchedSubmissionCount: parseResult.diagnostics.coverPageUnmatchedSubmissionCount,
    duplicateCoverPageAccessionCount: parseResult.diagnostics.duplicateCoverPageAccessionCount,
    informationTableRows: parseResult.diagnostics.informationTableRows,
    parsedInformationRows: parseResult.diagnostics.parsedInformationRows,
    joinedHoldingRows: parseResult.diagnostics.joinedHoldingRows,
    missingManagerIdentityCount: parseResult.diagnostics.missingManagerIdentityCount,
    managerCikConflictCount: parseResult.diagnostics.managerCikConflictCount,
    missingManagerCikCount: parseResult.diagnostics.missingManagerCikCount,
    amendmentFlagConflictCount: parseResult.diagnostics.amendmentFlagConflictCount,
    rejectedRows: parseResult.diagnostics.rejectedRows,
    eligibleCommonStockRows: parseResult.diagnostics.eligibleCommonStockRows,
    putCallExcludedRows: parseResult.diagnostics.putCallExcludedRows,
    prnExcludedRows: parseResult.diagnostics.prnExcludedRows,
    submissionHeaderMapping: parseResult.diagnostics.submissionHeaderMapping,
    coverPageHeaderMapping: parseResult.diagnostics.coverPageHeaderMapping,
    infoTableHeaderMapping: parseResult.diagnostics.infoTableHeaderMapping,
    durationMs: parseResult.diagnostics.durationMs,
  });

  const holdingsByAccession = new Map<string, ParsedBulkHolding[]>();
  for (const h of parseResult.holdings) {
    if (!holdingsByAccession.has(h.accessionNumber)) {
      holdingsByAccession.set(h.accessionNumber, []);
    }
    holdingsByAccession.get(h.accessionNumber)!.push(h);
  }

  const totalAccessions = holdingsByAccession.size;
  log("institutional_13f_persistence_started", {
    quarter,
    fileName: descriptor.fileName,
    totalAccessions,
    totalHoldings: parseResult.holdings.length,
    eligibleCommonStockRows: parseResult.diagnostics.eligibleCommonStockRows,
  });

  let filingCount = 0;
  let holdingCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let skippedExistingFilings = 0;
  let abortedEarly = false;
  let chunkLimitReached = false;
  let newAccessions = 0;
  let processedAccessions = 0;
  const chunkSize = opts?.chunkSize ?? Infinity;
  const persistenceStartMs = Date.now();

  // Record totalAccessions in the run record immediately (fire-and-forget)
  if (opts?.runId) {
    heartbeatRun(opts.runId, 0, totalAccessions).catch(() => {});
  }

  for (const [accession, holdings] of Array.from(holdingsByAccession.entries())) {
    if (signal.aborted) { abortedEarly = true; break; }

    const existing = await db
      .select({ id: institutional13fFilings.id })
      .from(institutional13fFilings)
      .where(eq(institutional13fFilings.accessionNumber, accession))
      .limit(1);

    processedAccessions++;

    if (existing.length > 0) {
      skippedExistingFilings++;
      // Heartbeat for skipped accessions too (progress tracking)
      if (processedAccessions % HEARTBEAT_INTERVAL === 0 && opts?.runId) {
        heartbeatRun(opts.runId, processedAccessions, totalAccessions).catch(() => {});
      }
      continue;
    }

    const first = holdings[0];

    await upsertFiling({
      accessionNumber: accession,
      filerCik: first.filerCik,
      filerName: first.filerName,
      filingType: first.filingType,
      filingDate: first.filingDate,
      acceptedAt: null,
      // Use actual parsed periodOfReport from SUBMISSION.TSV, not descriptor's expected period.
      // This preserves correct holdings dates for late filers and amendments.
      periodOfReport: first.periodOfReport,
      amendmentFlag: first.isAmendment,
      amendmentNumber: null,
      amendmentType: null,
      isEffective: true,
      // Record the catalog-resolved URL and dataset metadata for auditability.
      sourceUrl,
      sourceChecksum: null,
    });

    if (first.isAmendment) {
      await updateEffectivenessForFiler(
        first.filerCik,
        first.periodOfReport,
        accession,
        first.filingDate,
      );
    }

    const holdingRows: InsertInstitutional13fHolding[] = holdings.map((h) => ({
      accessionNumber: h.accessionNumber,
      filerCik: h.filerCik,
      filerName: h.filerName,
      issuerName: h.issuerName,
      classTitle: h.classTitle,
      cusip: h.cusip,
      figi: h.figi,
      reportedValue: h.reportedValue,
      reportedShares: h.reportedShares,
      sharesPrnType: h.sharesPrnType,
      putCall: h.putCall,
      investmentDiscretion: h.investmentDiscretion,
      otherManager: h.otherManager,
      votingSole: h.votingSole,
      votingShared: h.votingShared,
      votingNone: h.votingNone,
      // Actual periodOfReport from each filing row — may differ from descriptor's expected period.
      periodOfReport: h.periodOfReport,
      filingDate: h.filingDate,
      mappedSymbol: null,
      mappingStatus: "unmapped",
    }));

    await upsertHoldings(holdingRows);

    const { mappedCount: mc, unmappedCount: uc } =
      await applyMappingsToHoldings(accession);

    filingCount++;
    holdingCount += holdingRows.length;
    mappedCount += mc;
    unmappedCount += uc;
    newAccessions++;

    if (processedAccessions % PROGRESS_LOG_INTERVAL === 0) {
      logPersistenceProgress(
        quarter, "holdings", processedAccessions, totalAccessions,
        filingCount, skippedExistingFilings, holdingCount, persistenceStartMs,
      );
    }

    // Heartbeat: write progress to DB for stale-run detection and resumability
    if (processedAccessions % HEARTBEAT_INTERVAL === 0 && opts?.runId) {
      heartbeatRun(opts.runId, processedAccessions, totalAccessions).catch(() => {});
    }

    // Chunk limit: exit cleanly after processing N new accessions this invocation
    if (chunkSize !== Infinity && newAccessions >= chunkSize) {
      chunkLimitReached = true;
      break;
    }
  }

  log("institutional_13f_join_summary", {
    quarter,
    fileName: descriptor.fileName,
    totalAccessions,
    processedAccessions,
    filingCount,
    skippedExistingFilings,
    holdingCount,
    mappedCount,
    unmappedCount,
    abortedEarly,
    chunkLimitReached,
  });

  // Chunk limit reached: clean partial stop (not a timeout).
  // Aggregation is deferred until persistence is complete.
  if (chunkLimitReached) {
    log("institutional_13f_chunk_complete", {
      quarter,
      fileName: descriptor.fileName,
      newAccessions,
      processedAccessions,
      totalAccessions,
      remainingAccessions: totalAccessions - processedAccessions,
      filingCount,
      holdingCount,
    });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      chunkLimitReached: true,
    };
  }

  // AbortSignal fired: run is partial, not completed.
  // The next re-run will safely resume via skippedExistingFilings logic.
  if (abortedEarly) {
    log("institutional_13f_ingestion_aborted", {
      quarter,
      fileName: descriptor.fileName,
      reason: "timeout_or_signal",
      processedAccessions,
      remainingAccessions: totalAccessions - processedAccessions,
      filingCount,
      holdingCount,
    });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      abortedByTimeout: true,
    };
  }

  // All filings were already in the DB (idempotent re-run) — completed with 0 new rows
  if (filingCount === 0 && skippedExistingFilings === totalAccessions && totalAccessions > 0) {
    log("institutional_13f_idempotent_rerun", { quarter, fileName: descriptor.fileName, skippedExistingFilings });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "completed",
    };
  }

  // PERSISTENCE_COUNT_MISMATCH: eligible rows present but nothing was persisted
  const eligibleRows = parseResult.diagnostics.eligibleCommonStockRows;
  if (holdingCount === 0 && eligibleRows > MIN_ELIGIBLE_FOR_MISMATCH_CHECK && totalAccessions > 0) {
    log("institutional_13f_persistence_count_mismatch", {
      quarter,
      fileName: descriptor.fileName,
      eligibleCommonStockRows: eligibleRows,
      holdingCount,
      filingCount,
      totalAccessions,
      skippedExistingFilings,
    });
    return {
      quarter,
      periodOfReport: descriptor.expectedPeriodOfReport,
      filingCount,
      holdingCount,
      mappedCount,
      unmappedCount,
      skippedExistingFilings,
      totalAccessions,
      processedAccessions,
      status: "partial",
      persistenceCountMismatch: true,
      errorCode: "PERSISTENCE_COUNT_MISMATCH",
    };
  }

  // Persistence complete — recompute aggregates for all mapped symbols
  log("institutional_13f_aggregation_started", { quarter, fileName: descriptor.fileName });
  const mappedSymbols = await getMappedSymbols();
  for (const symbol of mappedSymbols) {
    if (signal.aborted) break;
    try {
      await recomputeAggregateForSymbol(symbol, descriptor.expectedPeriodOfReport, null);
    } catch (err: any) {
      log("institutional_aggregate_error", { symbol, errorCode: err.name ?? "ERROR" });
    }
  }

  log("institutional_13f_aggregation_completed", {
    quarter,
    symbolCount: mappedSymbols.length,
  });

  const finalStatus = parseResult.status === "partial_success" ? "partial" : "completed";
  log("institutional_13f_dataset_completed", {
    quarter,
    fileName: descriptor.fileName,
    filingCount,
    skippedExistingFilings,
    holdingCount,
    mappedCount,
    unmappedCount,
    totalAccessions,
    status: finalStatus,
  });

  return {
    quarter,
    periodOfReport: descriptor.expectedPeriodOfReport,
    filingCount,
    holdingCount,
    mappedCount,
    unmappedCount,
    skippedExistingFilings,
    totalAccessions,
    processedAccessions,
    status: finalStatus,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Run institutional 13F ingestion for the configured number of recent quarters.
 *
 * Called:
 *   - By the daily scheduler (once per day during filing season)
 *   - By the admin manual trigger (POST /api/admin/institutional/run)
 *   - By the CLI backfill script (scripts/run-institutional-backfill.ts)
 *   - On startup (fire-and-forget, non-blocking)
 *
 * Will no-op if:
 *   - INSTITUTIONAL_13F_INGESTION_ENABLED=false
 *   - SEC_USER_AGENT is not configured
 *   - Advisory lock is already held
 *
 * Does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true.
 * The public UI gate is separate from the ingestion gate.
 */
export async function runInstitutionalIngestion(
  options: {
    initiatedBy?: string;
    /** Ingest the N most-recent quarters (ignored when specificQuarterLabels/specificDescriptors are set). */
    quartersOverride?: number;
    /**
     * Ingest exactly these quarter labels (e.g. ["2026-Q1", "2025-Q4"]).
     * Overrides quartersOverride and the default backfillQuarters config.
     * Each label must be parseable by parseQuarterLabel().
     * Uses legacy URL construction — only reliable through 2023Q4.
     */
    specificQuarterLabels?: string[];
    /**
     * Ingest exactly these catalog-resolved dataset descriptors.
     * Takes precedence over specificQuarterLabels and quartersOverride.
     * Each descriptor carries the authoritative download URL from the
     * official SEC catalog — no URL reconstruction occurs.
     * Preferred for post-2023 datasets.
     */
    specificDescriptors?: DatasetDescriptor[];
    /**
     * When true, skip the already-completed-quarter check and re-ingest even if a
     * prior completed run exists with filingCount > 0 and holdingCount > 0.
     * Useful for reprocessing after a mapping update or schema migration.
     * The daily job passes force=true for PARTIAL quarters (detected by state machine).
     */
    force?: boolean;
    /**
     * Maximum number of NEW (non-skipped) accessions to persist this invocation.
     * Defaults to INSTITUTIONAL_ACCESSIONS_PER_RUN env var (default 300).
     * Set to Infinity (or omit) to process all accessions (backfill/manual mode).
     * The daily scheduler uses this to bound each run to < 10-15 minutes.
     */
    chunkSize?: number;
  } = {},
): Promise<{ status: "completed" | "partial" | "skipped_disabled" | "skipped_locked" | "failed"; quartersProcessed: number }> {
  const cfg = getInstitutionalConfig();

  if (!isIngestionConfigured()) {
    log("institutional_13f_ingestion_skipped", {
      reason: !cfg.ingestionEnabled ? "ingestion_disabled" : "no_user_agent",
    });
    return { status: "skipped_disabled", quartersProcessed: 0 };
  }

  const lockAcquired = await tryAcquireLock();
  if (!lockAcquired) {
    log("institutional_13f_ingestion_skipped", { reason: "advisory_lock_held" });
    return { status: "skipped_locked", quartersProcessed: 0 };
  }

  const controller = new AbortController();
  const timeoutMs = 20 * 60 * 1000; // 20 min max
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const initiatedBy = options.initiatedBy ?? "scheduler";
  // Resolve chunkSize: explicit option → env var default → Infinity for unlimited backfill
  const chunkSize = options.chunkSize !== undefined ? options.chunkSize : getAccessionsPerRun();

  try {
    let quartersProcessed = 0;
    let overallStatus: "completed" | "partial" | "failed" = "completed";

    // ── Descriptor path (catalog-driven, post-2023 safe) ────────────────────
    if (options.specificDescriptors && options.specificDescriptors.length > 0) {
      for (const descriptor of options.specificDescriptors) {
        if (controller.signal.aborted) break;

        const runQuarter = `${descriptor.year}-Q${descriptor.q}`;

        // ── Resumable skip ──────────────────────────────────────────────────
        // If a prior run already completed with real data, skip re-ingesting.
        // Pass force=true to override (e.g. after a mapping refresh).
        if (!options.force) {
          const existingCompleted = await db
            .select({ id: institutionalIngestionRuns.id, filingCount: institutionalIngestionRuns.filingCount, holdingCount: institutionalIngestionRuns.holdingCount })
            .from(institutionalIngestionRuns)
            .where(
              and(
                eq(institutionalIngestionRuns.quarter, runQuarter),
                eq(institutionalIngestionRuns.status, "completed"),
                gt(institutionalIngestionRuns.filingCount, 0),
                gt(institutionalIngestionRuns.holdingCount, 0),
              ),
            )
            .limit(1);

          if (existingCompleted.length > 0) {
            const prior = existingCompleted[0];
            log("institutional_13f_quarter_skipped_completed", {
              quarter: runQuarter,
              priorRunId: prior.id,
              filingCount: prior.filingCount,
              holdingCount: prior.holdingCount,
              reason: "prior_completed_run_exists",
            });
            quartersProcessed++;
            continue;
          }
        }

        const runId = await createRun(runQuarter, descriptor.expectedPeriodOfReport, initiatedBy);
        const start = Date.now();

        try {
          const result = await ingestFromDescriptor(descriptor, controller.signal, { chunkSize, runId });
          const durationMs = Date.now() - start;

          if (result.status === "empty_not_published") {
            await updateRun(runId, {
              status: "empty_not_published",
              errorCode: "EMPTY_NOT_PUBLISHED",
              errorSummary: `Dataset ${descriptor.fileName} not yet available (HTTP 404)`,
              completedAt: new Date(),
              lastHeartbeatAt: new Date(),
              durationMs,
            });
            log("institutional_13f_quarter_not_published", { quarter: runQuarter, fileName: descriptor.fileName });
          } else if (result.status === "empty_parse_failure") {
            await updateRun(runId, {
              status: "failed",
              errorCode: "EMPTY_PARSE_FAILURE",
              errorSummary: "Archive downloaded but zero 13F-HR holdings parsed",
              filingCount: 0,
              holdingCount: 0,
              completedAt: new Date(),
              lastHeartbeatAt: new Date(),
              durationMs,
            });
            // Note: institutional_13f_empty_parse_failure is already emitted
            // inside ingestFromDescriptor() with full parse diagnostics.
            // Do NOT re-emit here — that was the source of duplicate events.
            quartersProcessed++;
            overallStatus = "partial";
          } else {
            // Surface PERSISTENCE_COUNT_MISMATCH or INGESTION_ABORTED in run record
            const errorCode = result.persistenceCountMismatch
              ? "PERSISTENCE_COUNT_MISMATCH"
              : result.abortedByTimeout
                ? "INGESTION_ABORTED_TIMEOUT"
                : result.errorCode;
            const errorSummary = result.abortedByTimeout
              ? `Ingestion aborted by timeout — persisted ${result.filingCount} of available filings`
              : result.persistenceCountMismatch
                ? "Holdings count 0 despite eligible rows; re-run required"
                : undefined;

            await updateRun(runId, {
              status: result.status === "partial" ? "partial" : "completed",
              filingCount: result.filingCount,
              holdingCount: result.holdingCount,
              mappedCount: result.mappedCount,
              unmappedCount: result.unmappedCount,
              ...(errorCode ? { errorCode } : {}),
              ...(errorSummary ? { errorSummary } : {}),
              ...(result.totalAccessions !== undefined ? { totalAccessions: result.totalAccessions } : {}),
              ...(result.processedAccessions !== undefined ? { processedAccessions: result.processedAccessions } : {}),
              completedAt: new Date(),
              lastHeartbeatAt: new Date(),
              durationMs,
            });
            quartersProcessed++;
            if (result.status !== "completed") overallStatus = "partial";
          }
        } catch (err: any) {
          const durationMs = Date.now() - start;
          const errMsg = String(err?.message ?? "").slice(0, 200);
          await updateRun(runId, {
            status: "failed",
            errorCode: err.name ?? "INGESTION_ERROR",
            errorSummary: errMsg,
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            durationMs,
          });
          log("institutional_13f_ingestion_failed", { errorCode: err.name, quarter: runQuarter });
          overallStatus = "partial";
        }
      }

      return { status: overallStatus, quartersProcessed };
    }

    // ── Legacy label/count path (uses YYYYqN URL construction) ──────────────
    let quarters: Array<{ year: number; q: 1 | 2 | 3 | 4; periodEnd: string; label: string }>;
    if (options.specificQuarterLabels && options.specificQuarterLabels.length > 0) {
      const parsed = options.specificQuarterLabels.map((lbl) => {
        const p = parseQuarterLabel(lbl);
        if (!p) throw new Error(`Invalid quarter label: ${lbl}. Use format YYYY-QN or YYYYqN.`);
        return p;
      });
      quarters = parsed;
    } else {
      const n = options.quartersOverride ?? cfg.backfillQuarters;
      quarters = recentQuarters(n);
    }

    for (const q of quarters) {
      if (controller.signal.aborted) break;

      const runId = await createRun(`${q.year}-Q${q.q}`, q.periodEnd, initiatedBy);
      const start = Date.now();

      try {
        const result = await ingestQuarter(q.year, q.q, q.periodEnd, controller.signal, { chunkSize, runId });
        const durationMs = Date.now() - start;

        if (result.status === "empty_not_published") {
          await updateRun(runId, {
            status: "empty_not_published",
            errorCode: "EMPTY_NOT_PUBLISHED",
            errorSummary: "Quarterly bulk dataset not yet published by SEC",
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            durationMs,
          });
          log("institutional_13f_quarter_not_published", { quarter: q.label });
        } else if (result.status === "empty_parse_failure") {
          await updateRun(runId, {
            status: "failed",
            errorCode: "EMPTY_PARSE_FAILURE",
            errorSummary: "Archive downloaded but zero 13F-HR holdings parsed",
            filingCount: 0,
            holdingCount: 0,
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            durationMs,
          });
          log("institutional_13f_empty_parse_failure", { quarter: q.label });
          quartersProcessed++;
          overallStatus = "partial";
        } else {
          await updateRun(runId, {
            status: result.status === "partial" ? "partial" : "completed",
            filingCount: result.filingCount,
            holdingCount: result.holdingCount,
            mappedCount: result.mappedCount,
            unmappedCount: result.unmappedCount,
            ...(result.totalAccessions !== undefined ? { totalAccessions: result.totalAccessions } : {}),
            ...(result.processedAccessions !== undefined ? { processedAccessions: result.processedAccessions } : {}),
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            durationMs,
          });
          quartersProcessed++;
          if (result.status !== "completed") overallStatus = "partial";
        }
      } catch (err: any) {
        const durationMs = Date.now() - start;
        const errMsg = String(err?.message ?? "").slice(0, 200);
        await updateRun(runId, {
          status: "failed",
          errorCode: err.name ?? "INGESTION_ERROR",
          errorSummary: errMsg,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
          durationMs,
        });
        log("institutional_13f_ingestion_failed", { errorCode: err.name, quarter: q.label });
        overallStatus = "partial";
      }
    }

    return { status: overallStatus, quartersProcessed };
  } catch (err: any) {
    log("institutional_13f_ingestion_failed", { errorCode: err.name ?? "FATAL" });
    return { status: "failed", quartersProcessed: 0 };
  } finally {
    clearTimeout(timeout);
    await releaseLock().catch(() => {});
  }
}

/**
 * Schedule the institutional ingestion job.
 * Called from server/index.ts on startup (fire-and-forget).
 * - Runs once at startup
 * - Then daily at 6:00 AM ET (for fresh filing discovery)
 */
export function scheduleInstitutionalIngestion(): void {
  if (!isIngestionConfigured()) {
    log("institutional_ingestion_schedule_skipped", { reason: "not_configured" });
    return;
  }

  // Non-blocking startup run — uses unlimited chunk size so it does not consume
  // the Railway cron job's daily bounded-chunk budget. The startup run is an
  // opportunistic backfill/recovery path, not the scheduled daily increment.
  setTimeout(() => {
    runInstitutionalIngestion({ initiatedBy: "startup", chunkSize: Infinity }).catch((err: any) =>
      log("institutional_ingestion_startup_error", { errorCode: err?.name ?? "ERROR" }),
    );
  }, 30_000); // 30s delay after startup to avoid contending with other init

  log("institutional_ingestion_scheduled");
}
