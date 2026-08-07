#!/usr/bin/env tsx
// Institutional Intelligence Readiness Audit — Sprint 2.2.5.
//
// Read-only audit script. Never prints secrets or full filing rows.
//
// Usage:
//   npx tsx scripts/audit-institutional-readiness.ts
//
// Output:
//   - SEC User-Agent configured
//   - Available quarters
//   - Latest successful ingestion
//   - Filings and holdings counts
//   - Exact/reviewed mappings
//   - Tracked-universe coverage
//   - Amendment status
//   - API readiness
//
// Verdicts: GO | CONDITIONAL_GO | NO_GO

import { db } from "../server/db";
import { sql, eq, and, inArray, desc } from "drizzle-orm";
import {
  institutionalIngestionRuns,
  institutionalQuarterlyAggregates,
  institutionalSecurityMappings,
  institutional13fFilings,
  institutional13fHoldings,
} from "../shared/schema";

const MAPPING_THRESHOLD = 0.6; // 60% of tracked universe must have exact/reviewed mapping

async function main(): Promise<void> {
  console.log("\n=== Institutional Intelligence Readiness Audit ===\n");

  // --- Configuration check ---
  const secUserAgent = (process.env.SEC_USER_AGENT ?? "").trim();
  const featureEnabled = process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED === "true";
  const ingestionEnabled = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED !== "false";

  console.log("CONFIGURATION:");
  console.log(`  INSTITUTIONAL_INTELLIGENCE_ENABLED: ${featureEnabled}`);
  console.log(`  INSTITUTIONAL_13F_INGESTION_ENABLED: ${ingestionEnabled}`);
  console.log(`  SEC_USER_AGENT: ${secUserAgent ? "[configured]" : "[MISSING — ingestion disabled]"}`);
  console.log(`  INSTITUTIONAL_13F_BACKFILL_QUARTERS: ${process.env.INSTITUTIONAL_13F_BACKFILL_QUARTERS ?? "8 (default)"}`);
  console.log();

  // --- Ingestion runs ---
  const runs = await db
    .select()
    .from(institutionalIngestionRuns)
    .orderBy(desc(institutionalIngestionRuns.startedAt))
    .limit(10);

  const completedRuns = runs.filter((r) => r.status === "completed" || r.status === "partial");
  const failedRuns = runs.filter((r) => r.status === "failed");

  console.log("INGESTION RUNS (last 10):");
  if (runs.length === 0) {
    console.log("  No ingestion runs found.");
  } else {
    for (const run of runs) {
      const dur = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : "N/A";
      console.log(
        `  ${run.quarter.padEnd(8)} | ${run.status.padEnd(16)} | ${run.filingCount} filings | ` +
        `${run.holdingCount} holdings | ${run.mappedCount} mapped | ${dur}` +
        (run.errorCode ? ` | [${run.errorCode}]` : ""),
      );
    }
  }
  console.log();

  // --- Available quarters in aggregates ---
  const quarters = await db
    .select({
      periodLabel: institutionalQuarterlyAggregates.periodLabel,
      symbolCount: sql<number>`COUNT(DISTINCT ${institutionalQuarterlyAggregates.symbol})`,
      maxManagers: sql<number>`MAX(${institutionalQuarterlyAggregates.reportingManagerCount})`,
      generatedAt: sql<string>`MAX(${institutionalQuarterlyAggregates.generatedAt})`,
    })
    .from(institutionalQuarterlyAggregates)
    .groupBy(institutionalQuarterlyAggregates.periodLabel)
    .orderBy(desc(institutionalQuarterlyAggregates.periodLabel))
    .limit(8);

  console.log("AVAILABLE QUARTERS IN AGGREGATES:");
  if (quarters.length === 0) {
    console.log("  No aggregate quarters found.");
  } else {
    for (const q of quarters) {
      console.log(
        `  ${q.periodLabel} | ${q.symbolCount} symbols | max ${q.maxManagers} managers | generated ${q.generatedAt?.slice(0, 10) ?? "N/A"}`,
      );
    }
  }
  console.log();

  // --- Holdings counts ---
  const holdingTotals = await db.execute(sql`
    SELECT
      COUNT(*) AS total_holdings,
      COUNT(*) FILTER (WHERE mapping_status IN ('exact','reviewed')) AS mapped_holdings,
      COUNT(*) FILTER (WHERE mapping_status = 'unmapped') AS unmapped_holdings,
      COUNT(*) FILTER (WHERE put_call IS NOT NULL) AS put_call_holdings,
      COUNT(DISTINCT period_of_report) AS quarters
    FROM institutional_13f_holdings
  `);
  const ht = (holdingTotals as any).rows?.[0] ?? {};
  console.log("HOLDINGS:");
  console.log(`  Total rows: ${ht.total_holdings ?? 0}`);
  console.log(`  Mapped (exact/reviewed): ${ht.mapped_holdings ?? 0}`);
  console.log(`  Unmapped: ${ht.unmapped_holdings ?? 0}`);
  console.log(`  Put/call (excluded from totals): ${ht.put_call_holdings ?? 0}`);
  console.log(`  Quarters covered: ${ht.quarters ?? 0}`);
  console.log();

  // --- Mapping quality ---
  const mappingStats = await db.execute(sql`
    SELECT mapping_status, COUNT(*)::int AS cnt
    FROM institutional_security_mappings
    GROUP BY mapping_status
  `);
  const ms = Object.fromEntries(
    ((mappingStats as any).rows ?? []).map((r: any) => [r.mapping_status, r.cnt]),
  );
  const exactCount = (ms.exact ?? 0) + (ms.reviewed ?? 0);
  const totalMappings = Object.values(ms).reduce((a: any, b: any) => a + b, 0);

  console.log("SECURITY MAPPINGS:");
  console.log(`  exact: ${ms.exact ?? 0}`);
  console.log(`  reviewed: ${ms.reviewed ?? 0}`);
  console.log(`  probable: ${ms.probable ?? 0}`);
  console.log(`  ambiguous: ${ms.ambiguous ?? 0}`);
  console.log(`  unmapped: ${ms.unmapped ?? 0}`);
  console.log(`  rejected: ${ms.rejected ?? 0}`);
  console.log(`  Total: ${totalMappings}`);
  console.log();

  // --- Symbols with two comparable quarters ---
  const twoQtrs = await db.execute(sql`
    SELECT symbol, COUNT(DISTINCT period_of_report) AS quarter_count
    FROM institutional_quarterly_aggregates
    GROUP BY symbol
    HAVING COUNT(DISTINCT period_of_report) >= 2
  `);
  const symbolsWith2Q = ((twoQtrs as any).rows ?? []).length;

  console.log("SYMBOLS WITH ≥2 COMPARABLE QUARTERS: " + symbolsWith2Q);
  console.log();

  // --- Amendment status ---
  const amendments = await db
    .select({
      accessionNumber: institutional13fFilings.accessionNumber,
      amendmentStatus: sql<boolean>`${institutional13fFilings.amendmentFlag}`,
      isEffective: institutional13fFilings.isEffective,
    })
    .from(institutional13fFilings)
    .where(eq(institutional13fFilings.amendmentFlag, true))
    .limit(5);

  console.log(`AMENDMENT PROCESSING: ${amendments.length} amendment filings found (up to 5 shown)`);
  for (const a of amendments) {
    console.log(`  ${a.accessionNumber} | effective: ${a.isEffective}`);
  }
  console.log();

  // --- Verdict ---
  const hasMinQuarters = quarters.length >= 2;
  const hasMappings = exactCount > 0;
  const hasMappingThreshold = totalMappings === 0 || (exactCount / totalMappings >= MAPPING_THRESHOLD);
  const noFailedRuns = failedRuns.length === 0;
  const hasSecAgent = secUserAgent.length > 0;

  console.log("=== VERDICT ===\n");

  if (hasMinQuarters && hasMappings && hasMappingThreshold && noFailedRuns) {
    console.log("✅ GO");
    console.log("   - Two or more quarters loaded with sufficient mapping coverage.");
    console.log("   - No critical ingestion failures.");
    console.log("   - Ready for production UAT.");
  } else if (!hasMinQuarters && hasMappings) {
    console.log("⚠️  CONDITIONAL_GO");
    console.log("   - Data available for fewer than 2 comparable quarters.");
    console.log("   - Trend classification will show 'Insufficient History'.");
    console.log("   - UI labels partial coverage clearly.");
  } else if (!hasMappings) {
    console.log("❌ NO_GO");
    console.log("   - No exact or reviewed security mappings found.");
    console.log("   - 13F data cannot be linked to VCP Trader symbols.");
    console.log("   - Seed reviewed mappings before enabling the feature.");
  } else if (!noFailedRuns) {
    console.log("❌ NO_GO");
    console.log("   - Recent ingestion failures detected. Review error codes above.");
  } else {
    console.log("❌ NO_GO");
    console.log("   - No valid quarterly data found. Run ingestion first.");
  }

  if (!hasSecAgent) {
    console.log("\n⚠️  WARNING: SEC_USER_AGENT is not configured — ingestion is disabled.");
    console.log("   Configure it to enable 13F data fetching from SEC EDGAR.");
  }

  console.log("\n=== Audit complete ===\n");
  process.exit(0);
}

main().catch((err: any) => {
  console.error("Audit script error:", err?.message ?? err);
  process.exit(1);
});
