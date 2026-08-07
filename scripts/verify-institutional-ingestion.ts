#!/usr/bin/env tsx
// Institutional Intelligence — Read-Only Verification Script
//
// Queries the database to verify that a 13F ingestion run completed correctly.
// NEVER writes, deletes, or modifies any data.
//
// Usage:
//   npx tsx scripts/verify-institutional-ingestion.ts --quarter 2026Q1
//   npx tsx scripts/verify-institutional-ingestion.ts --quarter 2025Q4
//
// Exit codes:
//   0 — PASS (run completed; filing and holding counts are consistent)
//   1 — FAIL / WARNING / missing data (see output for reason)
//
// Verdict rules:
//   PASS    — most-recent run for the quarter has status=completed, filingCount>0, holdingCount>0
//   WARNING — run is partial (aborted by timeout), or mismatch detected between run record and DB row counts
//   FAIL    — run has status=failed, or run record not found, or schema missing

import { parseArgs } from "node:util";
import { db } from "../server/db";
import { sql, eq, and, desc } from "drizzle-orm";
import {
  institutionalIngestionRuns,
  institutional13fFilings,
  institutional13fHoldings,
} from "@shared/schema";
import { parseQuarterLabel } from "../server/services/institutional/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function info(msg: string): void {
  console.log(msg);
}

function exit(code: number): never {
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Parse CLI
// ---------------------------------------------------------------------------

function parseCliArgs(): { quarter: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        quarter: { type: "string", short: "q" },
      },
      strict: true,
    });
  } catch (err: any) {
    console.error(`[verify:error] INVALID_ARGS: ${err?.message ?? "unknown"}`);
    exit(1);
  }

  const rawQuarter = (parsed.values as any).quarter as string | undefined;
  if (!rawQuarter) {
    console.error("[verify:error] INVALID_ARGS: --quarter YYYYQN is required. Example: --quarter 2026Q1");
    exit(1);
  }

  const p = parseQuarterLabel(rawQuarter);
  if (!p) {
    console.error(`[verify:error] INVALID_ARGS: "${rawQuarter}" is not a valid quarter label. Use YYYYQN or YYYY-QN.`);
    exit(1);
  }

  return { quarter: p.label };
}

// ---------------------------------------------------------------------------
// Schema preflight
// ---------------------------------------------------------------------------

async function checkSchemaExists(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM institutional_ingestion_runs LIMIT 0`);
    return true;
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("42P01")) {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { quarter } = parseCliArgs();

  info(`\n=== Institutional 13F Verification — ${quarter} ===\n`);

  // Schema check
  info("Checking database schema…");
  const schemaOk = await checkSchemaExists();
  if (!schemaOk) {
    info("  ✗ Schema missing — institutional_ingestion_runs table not found");
    info("\n─────────────────────────────────────────────────────────────────────");
    info(`VERDICT: FAIL — schema not migrated`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }
  info("  ✓ Schema present\n");

  // ── 1. Run records ────────────────────────────────────────────────────────
  info("Run records (all runs for this quarter, newest first):");
  const runs = await db
    .select({
      id: institutionalIngestionRuns.id,
      status: institutionalIngestionRuns.status,
      filingCount: institutionalIngestionRuns.filingCount,
      holdingCount: institutionalIngestionRuns.holdingCount,
      mappedCount: institutionalIngestionRuns.mappedCount,
      unmappedCount: institutionalIngestionRuns.unmappedCount,
      errorCode: institutionalIngestionRuns.errorCode,
      errorSummary: institutionalIngestionRuns.errorSummary,
      startedAt: institutionalIngestionRuns.startedAt,
      completedAt: institutionalIngestionRuns.completedAt,
      durationMs: institutionalIngestionRuns.durationMs,
      initiatedBy: institutionalIngestionRuns.initiatedBy,
    })
    .from(institutionalIngestionRuns)
    .where(eq(institutionalIngestionRuns.quarter, quarter))
    .orderBy(desc(institutionalIngestionRuns.startedAt))
    .limit(10);

  if (runs.length === 0) {
    info(`  (no run records found for ${quarter})`);
    info("\n─────────────────────────────────────────────────────────────────────");
    info(`VERDICT: FAIL — no ingestion run found for ${quarter}`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const label = i === 0 ? " ← most recent" : "";
    const duration = r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : "n/a";
    info(`  Run #${i + 1}${label}`);
    info(`    Status:      ${r.status}`);
    info(`    Filings:     ${r.filingCount.toLocaleString()}`);
    info(`    Holdings:    ${r.holdingCount.toLocaleString()}`);
    info(`    Mapped:      ${r.mappedCount.toLocaleString()}`);
    info(`    Unmapped:    ${r.unmappedCount.toLocaleString()}`);
    info(`    Duration:    ${duration}`);
    info(`    Started:     ${r.startedAt?.toISOString() ?? "n/a"}`);
    info(`    Completed:   ${r.completedAt?.toISOString() ?? "still running"}`);
    info(`    Initiated:   ${r.initiatedBy}`);
    if (r.errorCode) {
      info(`    Error code:  ${r.errorCode}`);
    }
    if (r.errorSummary) {
      info(`    Error:       ${r.errorSummary.slice(0, 120)}`);
    }
    info("");
  }

  const latest = runs[0];

  // ── 2. Actual DB counts ───────────────────────────────────────────────────
  info("Actual DB row counts for this quarter (independent of run record):");

  // Count filings for the quarter — use periodOfReport
  const periodOfReport = latest.completedAt
    ? (
        await db
          .select({ periodOfReport: institutionalIngestionRuns.periodOfReport })
          .from(institutionalIngestionRuns)
          .where(eq(institutionalIngestionRuns.quarter, quarter))
          .orderBy(desc(institutionalIngestionRuns.startedAt))
          .limit(1)
      )[0]?.periodOfReport ?? null
    : null;

  // Count filings stored for this period
  const [filingRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(institutional13fFilings)
    .where(periodOfReport ? eq(institutional13fFilings.periodOfReport, periodOfReport) : sql`FALSE`);

  const [holdingRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(institutional13fHoldings)
    .where(periodOfReport ? eq(institutional13fHoldings.periodOfReport, periodOfReport) : sql`FALSE`);

  const dbFilings = filingRow?.count ?? 0;
  const dbHoldings = holdingRow?.count ?? 0;

  info(`  Period of report:  ${periodOfReport ?? "(unknown)"}`);
  info(`  Filings in DB:     ${dbFilings.toLocaleString()}`);
  info(`  Holdings in DB:    ${dbHoldings.toLocaleString()}`);
  info("");

  // ── 3. Count waterfall ────────────────────────────────────────────────────
  info("Count waterfall (run record vs actual DB):");
  const filingMatch = Math.abs(dbFilings - latest.filingCount) < Math.max(1, latest.filingCount * 0.01); // within 1%
  const holdingMatch = Math.abs(dbHoldings - latest.holdingCount) < Math.max(1, latest.holdingCount * 0.01);
  info(`  Run record filings:  ${latest.filingCount.toLocaleString()}   DB filings: ${dbFilings.toLocaleString()}   ${filingMatch ? "✓ consistent" : "⚠ MISMATCH"}`);
  info(`  Run record holdings: ${latest.holdingCount.toLocaleString()}   DB holdings: ${dbHoldings.toLocaleString()}   ${holdingMatch ? "✓ consistent" : "⚠ MISMATCH"}`);
  info("");

  // ── 4. Verdict ────────────────────────────────────────────────────────────
  info("─────────────────────────────────────────────────────────────────────");

  if (latest.status === "completed" && latest.filingCount > 0 && latest.holdingCount > 0 && filingMatch && holdingMatch) {
    info(`VERDICT: PASS`);
    info(`  Quarter ${quarter} is fully ingested.`);
    info(`  ${latest.filingCount.toLocaleString()} filings, ${latest.holdingCount.toLocaleString()} holdings stored.`);
    info(`  Run counts match actual DB row counts.`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(0);
  }

  if (latest.status === "partial" || latest.errorCode === "INGESTION_ABORTED_TIMEOUT" || latest.errorCode === "PERSISTENCE_COUNT_MISMATCH") {
    info(`VERDICT: WARNING — partial ingestion`);
    if (latest.errorCode === "INGESTION_ABORTED_TIMEOUT" || latest.errorCode === "PERSISTENCE_COUNT_MISMATCH") {
      info(`  Error: ${latest.errorCode}`);
      info(`  ${latest.filingCount.toLocaleString()} filings stored; re-run required to complete ingestion.`);
      info(`  Re-run command: npx tsx scripts/run-institutional-backfill.ts --quarters 2`);
      info(`  (The re-run will skip already-persisted filings and resume from where it left off.)`);
    } else {
      info(`  Ingestion is partial. Check structured logs for error codes.`);
    }
    if (!filingMatch || !holdingMatch) {
      info(`  Additionally: DB row counts do not match run record — possible concurrent modification.`);
    }
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }

  if (latest.status === "failed") {
    info(`VERDICT: FAIL — ingestion failed`);
    info(`  Error code: ${latest.errorCode ?? "unknown"}`);
    info(`  ${latest.errorSummary ?? "No details available. Check structured application logs."}`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }

  if (latest.status === "completed" && (latest.filingCount === 0 || latest.holdingCount === 0)) {
    info(`VERDICT: WARNING — completed with zero counts`);
    info(`  Run status is 'completed' but filingCount=${latest.filingCount}, holdingCount=${latest.holdingCount}.`);
    info(`  This may indicate an idempotent re-run (all data already present) or a false-completed abort.`);
    info(`  Verify DB counts above match expectations for ${quarter}.`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }

  if (!filingMatch || !holdingMatch) {
    info(`VERDICT: WARNING — count mismatch`);
    info(`  Run record counts do not match actual DB row counts.`);
    info(`  This may indicate concurrent modification or a partial re-run.`);
    info("─────────────────────────────────────────────────────────────────────\n");
    exit(1);
  }

  info(`VERDICT: WARNING — unexpected state`);
  info(`  Status: ${latest.status}, filings: ${latest.filingCount}, holdings: ${latest.holdingCount}`);
  info("─────────────────────────────────────────────────────────────────────\n");
  exit(1);
}

// Only auto-execute when run directly (not when imported by the test suite)
if (!process.env.VITEST) {
  main().catch((err: any) => {
    const code: string = err?.name ?? "FATAL";
    const msg: string = String(err?.message ?? "").slice(0, 300);
    console.error(`[verify:fatal] ${code}: ${msg}`);
    process.exit(1);
  });
}
