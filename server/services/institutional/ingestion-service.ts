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
import { sql, eq, and, inArray, desc, gte } from "drizzle-orm";
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
} from "./config";
import { parseBulkQuarter, bulkDatasetUrl } from "./sec-13f-bulk-parser";
import type { ParsedBulkHolding } from "./sec-13f-bulk-parser";
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
  }>,
): Promise<void> {
  await db
    .update(institutionalIngestionRuns)
    .set(update as any)
    .where(eq(institutionalIngestionRuns.id, id));
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
  status: "completed" | "partial" | "empty_not_published" | "empty_parse_failure" | "failed";
}

async function ingestQuarter(
  year: number,
  q: 1 | 2 | 3 | 4,
  periodEnd: string,
  signal: AbortSignal,
): Promise<QuarterIngestionResult> {
  const quarter = `${year}-Q${q}`;

  log("institutional_13f_ingestion_started", { quarter, year, q });

  // Download and parse the bulk archive (replaces the prior per-filing XML approach which
  // produced zero results because company.idx is fixed-width, not pipe-delimited).
  const parseResult = await parseBulkQuarter(year, q, signal);

  log("institutional_13f_archive_inspected", {
    quarter,
    archiveBytes: parseResult.diagnostics.archiveBytes,
    entryCount: parseResult.diagnostics.archiveEntries.length,
    entryNames: parseResult.diagnostics.archiveEntries.slice(0, 8),
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
      status: parseResult.status,
    };
  }

  log("institutional_13f_rows_parsed", {
    quarter,
    submissionRows: parseResult.diagnostics.submissionRows,
    informationTableRows: parseResult.diagnostics.informationTableRows,
    joinedHoldingRows: parseResult.diagnostics.joinedHoldingRows,
    rejectedRows: parseResult.diagnostics.rejectedRows,
    eligibleCommonStockRows: parseResult.diagnostics.eligibleCommonStockRows,
    putCallExcludedRows: parseResult.diagnostics.putCallExcludedRows,
    prnExcludedRows: parseResult.diagnostics.prnExcludedRows,
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

  let filingCount = 0;
  let holdingCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  const sourceUrl = bulkDatasetUrl(year, q);

  for (const [accession, holdings] of Array.from(holdingsByAccession.entries())) {
    if (signal.aborted) break;

    // Idempotent: skip accessions already in the database
    const existing = await db
      .select({ id: institutional13fFilings.id })
      .from(institutional13fFilings)
      .where(eq(institutional13fFilings.accessionNumber, accession))
      .limit(1);

    if (existing.length > 0) continue;

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
  }

  log("institutional_13f_join_summary", {
    quarter,
    filingCount,
    holdingCount,
    mappedCount,
    unmappedCount,
  });

  // All filings were already in the DB (idempotent re-run)
  if (filingCount === 0 && parseResult.holdings.length > 0) {
    return {
      quarter,
      periodOfReport: periodEnd,
      filingCount: 0,
      holdingCount: 0,
      mappedCount: 0,
      unmappedCount: 0,
      status: "completed",
    };
  }

  // Recompute aggregates for all mapped symbols
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

  return {
    quarter,
    periodOfReport: periodEnd,
    filingCount,
    holdingCount,
    mappedCount,
    unmappedCount,
    status: parseResult.status === "partial_success" ? "partial" : "completed",
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
    /** Ingest the N most-recent quarters (ignored when specificQuarterLabels is set). */
    quartersOverride?: number;
    /**
     * Ingest exactly these quarter labels (e.g. ["2026-Q1", "2025-Q4"]).
     * Overrides quartersOverride and the default backfillQuarters config.
     * Each label must be parseable by parseQuarterLabel().
     */
    specificQuarterLabels?: string[];
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

  try {
    // Determine quarter list — specific labels take precedence over count override
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
    let quartersProcessed = 0;
    let overallStatus: "completed" | "partial" | "failed" = "completed";

    for (const q of quarters) {
      if (controller.signal.aborted) break;

      const runId = await createRun(`${q.year}-Q${q.q}`, q.periodEnd, initiatedBy);
      const start = Date.now();

      try {
        const result = await ingestQuarter(q.year, q.q, q.periodEnd, controller.signal);
        const durationMs = Date.now() - start;

        if (result.status === "empty_not_published") {
          // Quarter not yet released by SEC — record for audit, do not count as processed
          await updateRun(runId, {
            status: "empty_not_published",
            errorCode: "EMPTY_NOT_PUBLISHED",
            errorSummary: "Quarterly bulk dataset not yet published by SEC",
            completedAt: new Date(),
            durationMs,
          });
          log("institutional_13f_quarter_not_published", { quarter: q.label });
          // quartersProcessed intentionally NOT incremented — retry later
        } else if (result.status === "empty_parse_failure") {
          // Archive downloaded but zero 13F-HR filings parsed — parser failure
          await updateRun(runId, {
            status: "failed",
            errorCode: "EMPTY_PARSE_FAILURE",
            errorSummary: "Archive downloaded but zero 13F-HR holdings parsed",
            filingCount: 0,
            holdingCount: 0,
            completedAt: new Date(),
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
            completedAt: new Date(),
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

  // Non-blocking startup run
  setTimeout(() => {
    runInstitutionalIngestion({ initiatedBy: "startup" }).catch((err: any) =>
      log("institutional_ingestion_startup_error", { errorCode: err?.name ?? "ERROR" }),
    );
  }, 30_000); // 30s delay after startup to avoid contending with other init

  log("institutional_ingestion_scheduled");
}
