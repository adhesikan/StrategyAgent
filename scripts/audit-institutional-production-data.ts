#!/usr/bin/env tsx
// Institutional Intelligence — production data waterfall diagnostic.
//
// READ-ONLY: this script executes SELECT statements only. It never ingests,
// backfills, maps, aggregates, migrates, or prints DATABASE_URL.
//
// Railway Shell usage:
//   npx tsx scripts/audit-institutional-production-data.ts

import { db } from "../server/db";
import { sql } from "drizzle-orm";

export const EXPECTED_SECURITY_CUSIPS = {
  AAPL: "037833100",
  NVDA: "67066G104",
  MSFT: "594918104",
  COST: "22160K105",
} as const;

type MappingExecutionEvidence = {
  effectiveHoldings: number;
  mappedEffectiveHoldings: number;
  nonDefaultHoldingStatuses: number;
  mappingRows: number;
  runsWithMappingCounts: number;
};

export function inferMappingPipelineState(evidence: MappingExecutionEvidence): string {
  if (evidence.effectiveHoldings === 0) {
    return "NOT_APPLICABLE_NO_EFFECTIVE_HOLDINGS";
  }
  if (
    evidence.mappedEffectiveHoldings > 0 ||
    evidence.nonDefaultHoldingStatuses > 0 ||
    evidence.runsWithMappingCounts > 0
  ) {
    return "EXECUTION_EVIDENCE_PRESENT";
  }
  if (evidence.mappingRows === 0) {
    return "NO_MAPPING_REFERENCE_ROWS; EXECUTION_NOT_PROVABLE_FROM_STORED_DATA";
  }
  return "MAPPING_ROWS_EXIST_BUT_NO_APPLICATION_EVIDENCE";
}

function rowsOf(result: unknown): any[] {
  const candidate = result as { rows?: any[] };
  return candidate.rows ?? (Array.isArray(result) ? result : []);
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function printRows(title: string, rows: any[]): void {
  console.log(`\n${title}:`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of rows) {
    console.log(`  ${JSON.stringify(row)}`);
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present
  `);
  return rowsOf(result)[0]?.present === true;
}

async function main(): Promise<void> {
  console.log("\n=== Institutional Intelligence Production Data Waterfall ===");
  console.log("READ-ONLY: SELECT statements only; credentials are never printed.");

  const coreResult = await db.execute(sql`
    WITH effective_filings AS (
      SELECT accession_number, filer_cik, period_of_report
      FROM institutional_13f_filings
      WHERE is_effective = TRUE
    ),
    effective_holdings AS (
      SELECT
        h.accession_number,
        h.filer_cik,
        h.period_of_report,
        h.cusip,
        h.mapped_symbol,
        h.mapping_status
      FROM institutional_13f_holdings h
      INNER JOIN effective_filings f
        ON f.accession_number = h.accession_number
    )
    SELECT
      (SELECT COUNT(*) FROM institutional_13f_filings) AS total_filings,
      (SELECT COUNT(*) FROM effective_filings) AS effective_filings,
      (SELECT COUNT(DISTINCT filer_cik) FROM effective_filings) AS distinct_effective_managers,
      (SELECT COUNT(DISTINCT period_of_report) FROM effective_filings) AS distinct_effective_quarters,
      (SELECT MAX(period_of_report) FROM effective_filings) AS latest_effective_quarter,
      (SELECT COUNT(*) FROM institutional_13f_holdings) AS total_holdings,
      (SELECT COUNT(*) FROM effective_holdings) AS holdings_joined_to_effective_filings,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapped_symbol IS NOT NULL) AS mapped_effective_holdings,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapped_symbol IS NULL) AS null_mapped_symbol_effective_holdings,
      (SELECT COUNT(DISTINCT cusip) FROM effective_holdings) AS distinct_effective_cusips,
      (SELECT COUNT(DISTINCT mapped_symbol) FROM effective_holdings WHERE mapped_symbol IS NOT NULL) AS distinct_mapped_symbols,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapped_symbol = 'AAPL') AS aapl_effective_holdings,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapped_symbol = 'NVDA') AS nvda_effective_holdings,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapped_symbol = 'MSFT') AS msft_effective_holdings,
      (SELECT COUNT(*) FROM institutional_security_mappings) AS security_mapping_rows,
      (SELECT COUNT(*) FROM institutional_quarterly_aggregates) AS aggregate_rows,
      (SELECT COUNT(*) FROM effective_holdings WHERE mapping_status <> 'unmapped') AS non_default_holding_statuses,
      (
        SELECT COUNT(*)
        FROM institutional_ingestion_runs
        WHERE mapped_count > 0 OR unmapped_count > 0
      ) AS runs_with_mapping_counts
  `);
  const core = rowsOf(coreResult)[0] ?? {};
  printRows("CORE WATERFALL", [core]);

  const filingQuartersResult = await db.execute(sql`
    SELECT
      period_of_report,
      COUNT(*) AS total_filings,
      COUNT(*) FILTER (WHERE is_effective = TRUE) AS effective_filings,
      COUNT(DISTINCT filer_cik) FILTER (WHERE is_effective = TRUE) AS effective_managers
    FROM institutional_13f_filings
    GROUP BY period_of_report
    ORDER BY period_of_report DESC
  `);
  printRows("FILING COUNTS BY REPORTING QUARTER", rowsOf(filingQuartersResult));

  const runResult = await db.execute(sql`
    SELECT
      quarter,
      period_of_report,
      status,
      filing_count,
      holding_count,
      mapped_count,
      unmapped_count,
      total_accessions,
      processed_accessions,
      started_at,
      completed_at,
      error_code
    FROM institutional_ingestion_runs
    ORDER BY started_at DESC
    LIMIT 20
  `);
  const runRows = rowsOf(runResult);
  printRows("LATEST INGESTION RUN RECORDS", runRows);

  const persistedByRunPeriodResult = await db.execute(sql`
    SELECT
      r.quarter,
      r.period_of_report,
      r.status AS latest_run_status,
      r.filing_count AS latest_run_reported_filings,
      r.holding_count AS latest_run_reported_holdings,
      COUNT(DISTINCT f.accession_number) AS persisted_filings_for_period,
      COUNT(h.id) AS persisted_holdings_for_period
    FROM (
      SELECT DISTINCT ON (quarter)
        quarter,
        period_of_report,
        status,
        filing_count,
        holding_count,
        started_at
      FROM institutional_ingestion_runs
      ORDER BY quarter, started_at DESC
    ) r
    LEFT JOIN institutional_13f_filings f
      ON f.period_of_report = r.period_of_report
    LEFT JOIN institutional_13f_holdings h
      ON h.accession_number = f.accession_number
    GROUP BY
      r.quarter,
      r.period_of_report,
      r.status,
      r.filing_count,
      r.holding_count
    ORDER BY r.period_of_report DESC
  `);
  printRows(
    "LATEST RUN STATE VS PERSISTED ROWS FOR ITS PERIOD",
    rowsOf(persistedByRunPeriodResult),
  );

  const holdingStatusResult = await db.execute(sql`
    WITH effective_holdings AS (
      SELECT h.mapping_status
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
      WHERE f.is_effective = TRUE
    )
    SELECT mapping_status, COUNT(*) AS holding_count
    FROM effective_holdings
    GROUP BY mapping_status
    ORDER BY holding_count DESC, mapping_status
  `);
  printRows("EFFECTIVE HOLDINGS BY MAPPING STATUS", rowsOf(holdingStatusResult));

  const mappingDistributionResult = await db.execute(sql`
    SELECT
      mapping_status,
      mapping_method,
      COUNT(*) AS mapping_count,
      COUNT(*) FILTER (WHERE mapped_symbol IS NOT NULL) AS mappings_with_symbol
    FROM institutional_security_mappings
    GROUP BY mapping_status, mapping_method
    ORDER BY mapping_count DESC, mapping_status, mapping_method
  `);
  printRows("MAPPING TABLE STATUS/METHOD DISTRIBUTION", rowsOf(mappingDistributionResult));

  const unappliedResult = await db.execute(sql`
    WITH effective_holdings AS (
      SELECT h.id, h.cusip, h.mapped_symbol, h.mapping_status
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
      WHERE f.is_effective = TRUE
    )
    SELECT
      COUNT(*) AS unapplied_holding_rows,
      COUNT(DISTINCT h.cusip) AS unapplied_distinct_cusips
    FROM effective_holdings h
    INNER JOIN institutional_security_mappings m
      ON m.cusip = h.cusip
    WHERE h.mapped_symbol IS NULL
      AND m.mapped_symbol IS NOT NULL
      AND m.mapping_status IN ('exact', 'reviewed')
  `);
  printRows("RELIABLE MAPPINGS NOT APPLIED TO EFFECTIVE HOLDINGS", rowsOf(unappliedResult));

  const expectedCusips = Object.values(EXPECTED_SECURITY_CUSIPS);
  const securityTraceResult = await db.execute(sql`
    WITH effective_holdings AS (
      SELECT
        h.cusip,
        h.issuer_name,
        h.mapped_symbol,
        h.mapping_status
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
      WHERE f.is_effective = TRUE
    )
    SELECT
      h.cusip,
      MIN(h.issuer_name) AS sample_issuer_name,
      COUNT(*) AS effective_holding_rows,
      COUNT(*) FILTER (WHERE h.mapped_symbol IS NOT NULL) AS mapped_holding_rows,
      MIN(h.mapped_symbol) AS mapped_symbol,
      STRING_AGG(DISTINCT h.mapping_status, ',' ORDER BY h.mapping_status) AS holding_mapping_statuses,
      MAX(m.mapped_symbol) AS reference_mapped_symbol,
      STRING_AGG(DISTINCT m.mapping_status, ',' ORDER BY m.mapping_status)
        FILTER (WHERE m.mapping_status IS NOT NULL) AS reference_mapping_statuses,
      STRING_AGG(DISTINCT m.mapping_method, ',' ORDER BY m.mapping_method)
        FILTER (WHERE m.mapping_method IS NOT NULL) AS reference_mapping_methods
    FROM effective_holdings h
    LEFT JOIN institutional_security_mappings m
      ON m.cusip = h.cusip
    WHERE h.cusip IN (${sql.join(expectedCusips.map((cusip) => sql`${cusip}`), sql`, `)})
    GROUP BY h.cusip
    ORDER BY h.cusip
  `);
  const traceByCusip = new Map(rowsOf(securityTraceResult).map((row) => [row.cusip, row]));
  printRows(
    "EXPECTED SECURITY CUSIP TRACE",
    Object.entries(EXPECTED_SECURITY_CUSIPS).map(([symbol, cusip]) => ({
      expected_symbol: symbol,
      expected_cusip: cusip,
      ...(traceByCusip.get(cusip) ?? {
        effective_holding_rows: 0,
        mapped_holding_rows: 0,
        mapped_symbol: null,
        holding_mapping_statuses: null,
        reference_mapped_symbol: null,
        reference_mapping_statuses: null,
        reference_mapping_methods: null,
      }),
    })),
  );

  for (const tableName of [
    "institutional_symbol_signals",
    "sector_intelligence_snapshots",
    "theme_intelligence_snapshots",
  ]) {
    const present = await tableExists(tableName);
    if (!present) {
      printRows(`OPTIONAL TABLE ${tableName}`, [{ present: false }]);
      continue;
    }

    if (tableName === "institutional_symbol_signals") {
      const result = await db.execute(sql`
        SELECT COUNT(*) AS row_count, MAX(calculated_at) AS latest_generated_at
        FROM institutional_symbol_signals
      `);
      printRows(`OPTIONAL TABLE ${tableName}`, [{ present: true, ...rowsOf(result)[0] }]);
    } else if (tableName === "sector_intelligence_snapshots") {
      const result = await db.execute(sql`
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT sector) AS distinct_items,
          MAX(generated_at) AS latest_generated_at
        FROM sector_intelligence_snapshots
      `);
      printRows(`OPTIONAL TABLE ${tableName}`, [{ present: true, ...rowsOf(result)[0] }]);
    } else {
      const result = await db.execute(sql`
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT theme_id) AS distinct_items,
          MAX(generated_at) AS latest_generated_at
        FROM theme_intelligence_snapshots
      `);
      printRows(`OPTIONAL TABLE ${tableName}`, [{ present: true, ...rowsOf(result)[0] }]);
    }
  }

  const mappingState = inferMappingPipelineState({
    effectiveHoldings: count(core.holdings_joined_to_effective_filings),
    mappedEffectiveHoldings: count(core.mapped_effective_holdings),
    nonDefaultHoldingStatuses: count(core.non_default_holding_statuses),
    mappingRows: count(core.security_mapping_rows),
    runsWithMappingCounts: count(core.runs_with_mapping_counts),
  });

  console.log("\nDIAGNOSTIC INTERPRETATION:");
  console.log(
    "  pipelineStatusCounts: PERSISTED_ROWS_FOR_LATEST_RUN_PERIOD (not SEC discovery counts and not necessarily rows inserted by the latest run)",
  );
  console.log(
    "  readinessCompletedRuns: latest 10 run records whose status is completed or partial",
  );
  console.log(`  mappingPipelineState: ${mappingState}`);
  console.log(
    "  aggregateDependency: institutional_quarterly_aggregates requires reliably mapped holdings",
  );

  console.log("\n=== Diagnostic complete — database unchanged ===\n");
}

if (!process.env.VITEST) {
  main().catch((error: any) => {
    const message = String(error?.message ?? error).slice(0, 500);
    console.error(`[institutional-production-audit] ERROR: ${message}`);
    process.exit(1);
  });
}