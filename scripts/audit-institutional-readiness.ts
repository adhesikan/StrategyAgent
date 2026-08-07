#!/usr/bin/env tsx
// Institutional Intelligence Readiness Audit — updated for gate separation.
//
// Read-only audit script. Never prints secrets or full filing rows.
// Works correctly while INSTITUTIONAL_INTELLIGENCE_ENABLED=false.
//
// Usage:
//   npx tsx scripts/audit-institutional-readiness.ts
//
// Reports:
//   - schemaReady
//   - secConfigured
//   - ingestionEnabled
//   - publicFeatureEnabled
//   - availableQuarters
//   - completedIngestionRuns
//   - exactReviewedMappingCount
//   - trackedUniverseCoverage
//   - comparableQuarterSymbolCount
//   - COST mapping status
//   - COST quarter availability
//   - aggregate status
//   - amendment status
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
const COST_CUSIP = "22160K105";
const COST_TICKER = "COST";

// ---------------------------------------------------------------------------
// Schema preflight — catch missing tables gracefully
// ---------------------------------------------------------------------------

async function checkSchema(): Promise<boolean> {
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
// Main audit
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== Institutional Intelligence Readiness Audit ===\n");

  // --- Configuration check ---
  const secUserAgent = (process.env.SEC_USER_AGENT ?? "").trim();
  const publicFeatureEnabled = process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED === "true";
  const ingestionEnabled = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED !== "false";

  console.log("CONFIGURATION:");
  console.log(`  schemaReady:            [checking…]`);
  console.log(`  publicFeatureEnabled:   ${publicFeatureEnabled}  (INSTITUTIONAL_INTELLIGENCE_ENABLED)`);
  console.log(`  ingestionEnabled:       ${ingestionEnabled}  (INSTITUTIONAL_13F_INGESTION_ENABLED)`);
  console.log(`  secConfigured:          ${secUserAgent ? "true" : "false [MISSING — ingestion disabled]"}  (SEC_USER_AGENT)`);
  console.log(`  backfillQuarters:       ${process.env.INSTITUTIONAL_13F_BACKFILL_QUARTERS ?? "8 (default)"}`);
  console.log();

  // --- Schema check ---
  const schemaReady = await checkSchema();
  if (!schemaReady) {
    console.log("  schemaReady:            FALSE");
    console.log();
    console.log("❌ INSTITUTIONAL_SCHEMA_MISSING");
    console.log("   Database tables have not been created yet.");
    console.log("   Run the migration to proceed:");
    console.log('   psql "$DATABASE_URL" -f scripts/migrate-institutional.sql');
    console.log();
    console.log("=== Audit complete — NO_GO (schema missing) ===\n");
    process.exit(1);
  }
  console.log("SCHEMA:                   ready ✓");
  console.log();

  // --- Ingestion runs ---
  const runs = await db
    .select()
    .from(institutionalIngestionRuns)
    .orderBy(desc(institutionalIngestionRuns.startedAt))
    .limit(10);

  const completedRuns = runs.filter((r) => r.status === "completed" || r.status === "partial");
  const failedRuns = runs.filter((r) => r.status === "failed");

  console.log(`INGESTION RUNS (last 10):`);
  console.log(`  completedIngestionRuns: ${completedRuns.length}`);
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
  console.log(`  availableQuarters:      ${quarters.length}`);
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

  // --- Symbols with at least two comparable quarters ---
  const comparableResult = await db.execute(sql`
    SELECT COUNT(*) AS symbol_count
    FROM (
      SELECT symbol
      FROM ${institutionalQuarterlyAggregates}
      GROUP BY symbol
      HAVING COUNT(DISTINCT period_of_report) >= 2
    ) sub
  `);
  const comparableQuarterSymbolCount = Number((comparableResult as any).rows?.[0]?.symbol_count ?? 0);
  console.log(`COMPARABLE QUARTER COVERAGE:`);
  console.log(`  comparableQuarterSymbolCount: ${comparableQuarterSymbolCount}`);
  console.log();

  // --- Holdings counts ---
  const holdingTotals = await db.execute(sql`
    SELECT
      COUNT(*) AS total_holdings,
      COUNT(*) FILTER (WHERE mapping_status IN ('exact','reviewed')) AS mapped_holdings,
      COUNT(*) FILTER (WHERE mapping_status = 'unmapped') AS unmapped_holdings
    FROM institutional_13f_holdings
  `);
  const ht = (holdingTotals as any).rows?.[0] ?? {};
  const totalHoldings = Number(ht.total_holdings ?? 0);
  const mappedHoldings = Number(ht.mapped_holdings ?? 0);
  const unmappedHoldings = Number(ht.unmapped_holdings ?? 0);

  console.log("HOLDINGS:");
  console.log(`  totalHoldings:          ${totalHoldings}`);
  console.log(`  mappedHoldings:         ${mappedHoldings}`);
  console.log(`  unmappedHoldings:       ${unmappedHoldings}`);
  console.log();

  // --- Security mappings ---
  const mappingTotals = await db.execute(sql`
    SELECT
      COUNT(*) AS total_mappings,
      COUNT(*) FILTER (WHERE mapping_status IN ('exact', 'reviewed')) AS exact_reviewed,
      COUNT(*) FILTER (WHERE mapping_status = 'probable') AS probable,
      COUNT(*) FILTER (WHERE mapping_status = 'ambiguous') AS ambiguous,
      COUNT(*) FILTER (WHERE mapping_status = 'unmapped') AS unmapped
    FROM institutional_security_mappings
  `);
  const mt = (mappingTotals as any).rows?.[0] ?? {};
  const totalMappings = Number(mt.total_mappings ?? 0);
  const exactCount = Number(mt.exact_reviewed ?? 0);

  console.log("SECURITY MAPPINGS:");
  console.log(`  exactReviewedMappingCount: ${exactCount}`);
  console.log(`  probable:               ${Number(mt.probable ?? 0)}`);
  console.log(`  ambiguous:              ${Number(mt.ambiguous ?? 0)}`);
  console.log(`  unmapped:               ${Number(mt.unmapped ?? 0)}`);
  const coveragePct = totalMappings > 0 ? ((exactCount / totalMappings) * 100).toFixed(1) : "N/A";
  console.log(`  trackedUniverseCoverage: ${coveragePct}% exact/reviewed`);
  console.log();

  // --- COST mapping status ---
  const costMappings = await db
    .select()
    .from(institutionalSecurityMappings)
    .where(
      and(
        eq(institutionalSecurityMappings.cusip, COST_CUSIP),
        eq(institutionalSecurityMappings.mappedSymbol, COST_TICKER),
      ),
    );

  console.log("COST MAPPING STATUS:");
  if (costMappings.length === 0) {
    console.log(`  ❌ COST (${COST_CUSIP}) has no reviewed mapping.`);
    console.log(`  Run: npx tsx scripts/seed-institutional-mappings.ts \\`);
    console.log(`       --cusip ${COST_CUSIP} --ticker COST \\`);
    console.log(`       --issuer "Costco Wholesale Corporation" --method manual_reviewed`);
  } else {
    const cm = costMappings[0];
    console.log(`  ✓ Mapped: cusip=${cm.cusip} ticker=${cm.mappedSymbol} status=${cm.mappingStatus} method=${cm.mappingMethod}`);
    if (cm.lastVerifiedAt) {
      console.log(`    lastVerifiedAt: ${new Date(cm.lastVerifiedAt).toISOString().slice(0, 10)}`);
    }
  }
  console.log();

  // --- COST quarter availability ---
  const costQuarters = await db
    .select({
      periodLabel: institutionalQuarterlyAggregates.periodLabel,
      periodOfReport: institutionalQuarterlyAggregates.periodOfReport,
      reportingManagerCount: institutionalQuarterlyAggregates.reportingManagerCount,
    })
    .from(institutionalQuarterlyAggregates)
    .where(eq(institutionalQuarterlyAggregates.symbol, COST_TICKER))
    .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
    .limit(4);

  console.log("COST QUARTER AVAILABILITY:");
  if (costQuarters.length === 0) {
    console.log("  No aggregate data for COST.");
  } else {
    for (const cq of costQuarters) {
      console.log(`  ${cq.periodLabel} | period=${cq.periodOfReport} | managers=${cq.reportingManagerCount}`);
    }
  }
  const costHasComparableQuarters = costQuarters.length >= 2;
  console.log(`  COST comparableQuarters: ${costHasComparableQuarters ? "✓" : "❌ (need ≥2)"}`);
  console.log();

  // --- Amendment status ---
  const amendments = await db
    .select({
      accessionNumber: institutional13fFilings.accessionNumber,
      isEffective: institutional13fFilings.isEffective,
    })
    .from(institutional13fFilings)
    .where(eq(institutional13fFilings.amendmentFlag, true))
    .limit(10);

  console.log("AMENDMENT HANDLING:");
  console.log(`  amendmentStatus:        ${amendments.length === 0 ? "no amendments found (OK if no data)" : `${amendments.length} amendment(s) processed"}`}`);
  for (const a of amendments) {
    console.log(`  ${a.accessionNumber} | effective: ${a.isEffective}`);
  }
  console.log();

  // --- Aggregate status ---
  const aggCount = await db.execute(sql`SELECT COUNT(*) AS cnt FROM institutional_quarterly_aggregates`);
  const aggTotal = Number((aggCount as any).rows?.[0]?.cnt ?? 0);
  console.log("AGGREGATE STATUS:");
  console.log(`  totalAggregateRows:     ${aggTotal}`);
  console.log(`  aggregateReady:         ${aggTotal > 0 ? "✓" : "❌ (run ingestion first)"}`);
  console.log();

  // --- Verdict ---
  const hasMinQuarters = quarters.length >= 2;
  const hasMappings = exactCount > 0;
  const hasMappingThreshold = totalMappings === 0 || (exactCount / totalMappings >= MAPPING_THRESHOLD);
  const noFailedRuns = failedRuns.length === 0;
  const hasSecAgent = secUserAgent.length > 0;
  const hasCostMapping = costMappings.length > 0;

  console.log("=== VERDICT ===\n");

  // Always report gate states separately
  console.log(`  schemaReady:            ✓`);
  console.log(`  secConfigured:          ${hasSecAgent ? "✓" : "❌"}`);
  console.log(`  ingestionEnabled:       ${ingestionEnabled ? "✓" : "❌"}`);
  console.log(`  publicFeatureEnabled:   ${publicFeatureEnabled ? "✓" : "❌ (expected while preparing data)"}`);
  console.log(`  exactReviewedMappings:  ${exactCount} (threshold: ≥60% of tracked universe)`);
  console.log(`  availableQuarters:      ${quarters.length}`);
  console.log(`  comparableSymbols:      ${comparableQuarterSymbolCount}`);
  console.log(`  COSTMapped:             ${hasCostMapping ? "✓" : "❌"}`);
  console.log(`  COSTComparable:         ${costHasComparableQuarters ? "✓" : "❌"}`);
  console.log();

  if (hasMinQuarters && hasMappings && hasMappingThreshold && noFailedRuns) {
    console.log("✅ GO");
    console.log("   - Two or more quarters loaded with sufficient mapping coverage.");
    console.log("   - No critical ingestion failures.");
    console.log("   - Ready for production UAT.");
    console.log("   - Set INSTITUTIONAL_INTELLIGENCE_ENABLED=true to enable the public tab.");
  } else if (quarters.length === 1 && hasMappings) {
    console.log("⚠️  CONDITIONAL_GO");
    console.log("   - Data available for exactly 1 quarter.");
    console.log("   - Trend classification will show 'Insufficient History'.");
    console.log("   - UI labels partial coverage clearly.");
    console.log("   - Ingest a second quarter before enabling the public tab for full value.");
  } else if (!hasMappings) {
    console.log("❌ NO_GO — No exact or reviewed security mappings found.");
    console.log("   - Seed reviewed mappings:");
    console.log("   - npx tsx scripts/seed-institutional-mappings.ts --cusip <CUSIP> --ticker <TICKER> --issuer \"<Name>\"");
  } else if (!noFailedRuns) {
    console.log("❌ NO_GO — Recent ingestion failures detected. Review error codes above.");
  } else {
    console.log("❌ NO_GO — No valid quarterly data found.");
    console.log("   Activation sequence:");
    console.log("   1. psql \"$DATABASE_URL\" -f scripts/migrate-institutional.sql");
    console.log("   2. Set SEC_USER_AGENT and INSTITUTIONAL_13F_INGESTION_ENABLED=true");
    console.log("   3. npx tsx scripts/run-institutional-backfill.ts --quarters 2");
    console.log("   4. npx tsx scripts/seed-institutional-mappings.ts --cusip 22160K105 --ticker COST --issuer \"Costco Wholesale Corporation\"");
    console.log("   5. npx tsx scripts/audit-institutional-readiness.ts");
    console.log("   6. When GO: set INSTITUTIONAL_INTELLIGENCE_ENABLED=true");
  }

  if (!hasSecAgent) {
    console.log("\n⚠️  WARNING: SEC_USER_AGENT is not configured — ingestion is blocked.");
    console.log("   Set SEC_USER_AGENT='VCP Trader AI <contact-email-you-own>'");
  }

  if (!publicFeatureEnabled) {
    console.log("\nℹ️  NOTE: INSTITUTIONAL_INTELLIGENCE_ENABLED=false");
    console.log("   This audit ran correctly while the public feature is disabled.");
    console.log("   Ingestion and mapping preparation can proceed in this state.");
  }

  console.log("\n=== Audit complete ===\n");
  process.exit(0);
}

main().catch((err: any) => {
  console.error("Audit script error:", err?.message ?? err);
  process.exit(1);
});
