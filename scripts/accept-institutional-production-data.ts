#!/usr/bin/env tsx
/**
 * Railway-production acceptance check for Institutional Intelligence.
 *
 * This command is intentionally bounded to the four repaired securities and
 * the two adjacent quarters. It only receives database rows and pure service
 * results; it does not discover data, call the SEC, or change application state.
 *
 * Railway Shell usage:
 *   npx tsx scripts/accept-institutional-production-data.ts
 */

import { sql } from "drizzle-orm";
import type { InstitutionalQuarterlyAggregate } from "@shared/schema";

export const ACCEPTANCE_SYMBOLS = {
  AAPL: "037833100",
  NVDA: "67066G104",
  MSFT: "594918104",
  COST: "22160K105",
} as const;

export const ACCEPTANCE_QUARTERS = [
  { label: "2026-Q1", period: "2026-03-31" },
  { label: "2025-Q4", period: "2025-12-31" },
] as const;

type FixedSymbol = keyof typeof ACCEPTANCE_SYMBOLS;
const SYMBOLS = Object.keys(ACCEPTANCE_SYMBOLS) as FixedSymbol[];
const PERIODS = ACCEPTANCE_QUARTERS.map((quarter) => quarter.period);
const REQUIRED_PRESERVED_MULTIPLE_GROUPS: Record<FixedSymbol, number> = {
  AAPL: 6,
  NVDA: 13,
  MSFT: 11,
  COST: 0,
};

export interface AcceptanceRuntimeEnv {
  DATABASE_URL?: string;
  EXTERNAL_DATABASE_URL?: string;
  RAILWAY_ENVIRONMENT_NAME?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
  RAILWAY_ENVIRONMENT_ID?: string;
}

export function validateAcceptanceRuntime(
  env: AcceptanceRuntimeEnv,
): string[] {
  const issues: string[] = [];
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) {
    issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  }
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (!env.RAILWAY_PROJECT_ID) issues.push("RAILWAY_PROJECT_ID_REQUIRED");
  if (!env.RAILWAY_SERVICE_ID) issues.push("RAILWAY_SERVICE_ID_REQUIRED");
  if (!env.RAILWAY_ENVIRONMENT_ID) {
    issues.push("RAILWAY_ENVIRONMENT_ID_REQUIRED");
  }
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !(
        url.hostname.endsWith(".railway.internal") ||
        url.hostname.endsWith(".rlwy.net")
      )
    ) {
      issues.push("DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT");
    }
  } catch {
    if (env.DATABASE_URL) issues.push("DATABASE_URL_INVALID");
  }
  return issues;
}

export function buildReadOnlyDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  return url.toString();
}

type QueryResult = { rows?: unknown[] } | unknown[];
export interface AcceptanceExecutor {
  execute(query: unknown): Promise<QueryResult>;
}

export interface RawQuarterEvidence {
  symbol: string;
  period: string;
  periodLabel: string | null;
  aggregateRowCount: number;
  reportingManagerCount: number | null;
  aggregateReportedShares: number | null;
  aggregateReportedValue: number | null;
  previousQuarterShares: number | null;
  previousQuarterValue: number | null;
  reportedSharesChange: number | null;
  reportedSharesChangePercent: number | null;
  newPositionCount: number;
  increasedPositionCount: number;
  reducedPositionCount: number;
  exitedPositionCount: number;
  unchangedCount: number;
  eligibleHoldingCount: number;
  excludedHoldingCount: number;
  coverageStatus: string | null;
  amendmentStatus: string | null;
  invalidComparableRows: number;
  topHolderPercent: number | null;
  top5HolderPercent: number | null;
  largestHolders: unknown[];
  mappingCandidateRows: number;
  reliablyMappedCandidateRows: number;
  rawCommonRows: number;
  rawOptionRows: number;
  rawPrnRows: number;
  rawCommonRowsWithNullValue: number;
  rawCommonShares: number | null;
  rawCommonValue: number | null;
  rawCommonManagerCount: number;
}

export interface RawSymbolEvidence {
  symbol: string;
  cusip: string;
  effectiveHoldingRows: number;
  reliablyMappedHoldingRows: number;
  unmappedHoldingRows: number;
  conflictingMappedHoldingRows: number;
  mappingReferenceRows: number;
  conflictingReliableMappingRows: number;
  commonEquityRows: number;
  optionRows: number;
  prnRows: number;
  nullValueRows: number;
  exactDuplicateGroups: number;
  legitimateMultipleGroups: number;
  invalidComparableRowsAll: number;
  effectiveManagerCount: number;
  effectiveQuarterCount: number;
  aggregateQuarterCount: number;
  comparableManagerCount: number;
  quarterRows: RawQuarterEvidence[];
}

export interface AcceptanceServiceResults {
  analytics: any;
  trend: any;
  signal: any;
}

export interface AcceptanceSymbolReport {
  symbol: string;
  cusip: string;
  status: "PASS" | "FAIL";
  issues: string[];
  mapping: {
    effectiveHoldingRows: number;
    reliablyMappedHoldingRows: number;
    coverage: number | null;
    conflictingMappedHoldingRows: number;
    conflictingReliableMappingRows: number;
  };
  quarters: Array<{
    period: string;
    periodLabel: string | null;
    aggregate: {
      rowCount: number;
      managers: number | null;
      shares: number | null;
      valueDollars: number | null;
      previousShares: number | null;
      previousValueDollars: number | null;
      shareChange: number | null;
      shareChangePercent: number | null;
      newPositionCount: number;
      increasedPositionCount: number;
      reducedPositionCount: number;
      exitedPositionCount: number;
      unchangedCount: number;
      eligibleRows: number;
      excludedRows: number;
      coverageStatus: string | null;
      amendmentStatus: string | null;
    };
    rawChecks: {
      mappingCandidateRows: number;
      reliablyMappedCandidateRows: number;
      commonEquityRows: number;
      optionRows: number;
      prnRows: number;
      nullValueRows: number;
      commonShares: number | null;
      commonValueDollars: number | null;
      commonManagers: number;
      invalidComparableRows: number;
    };
  }>;
  comparableManagers: number;
  services: {
    analytics: {
      available: boolean;
      aggregateShares: number | null;
      aggregateValueDollars: number | null;
      mappingCoveragePercent: number | null;
    };
    trend: { available: boolean; classification: string | null };
    signal: {
      status: string | null;
      score: number | null;
      label: string | null;
      inputs: Record<string, unknown>;
      components: Record<string, unknown>;
    };
  };
  integrity: {
    exactDuplicateGroups: number;
    legitimateMultipleGroups: number;
    aggregateQuarterCount: number;
  };
}

export interface AcceptanceReport {
  productionAcceptance: "PASS" | "FAIL";
  featureFlagReadiness: "SAFE_TO_ENABLE" | "DO_NOT_ENABLE";
  issues: string[];
  symbols: AcceptanceSymbolReport[];
  snapshots: { sectorCount: number; themeCount: number };
}

function rowsOf(result: QueryResult): any[] {
  return (result as { rows?: any[] }).rows ??
    (Array.isArray(result) ? result : []);
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function sameNumber(left: number | null, right: number | null): boolean {
  return left === right || (left !== null && right !== null && Math.abs(left - right) < 0.000001);
}

function independentlyCalculateSignalScore(components: any): number | null {
  const weighted: Array<[unknown, number]> = [
    [components?.breadth, 0.30],
    [components?.accumulation, 0.30],
    [components?.entrantsVsExits, 0.25],
    [components?.concentration, 0.15],
  ];
  if (weighted.some(([value]) => !finiteNumber(value))) return null;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(weighted.reduce((sum, [value, weight]) => sum + Number(value) * weight, 0)),
    ),
  );
}

function independentlyLabelSignal(score: number | null): string {
  if (score === null) return "Insufficient Data";
  if (score >= 75) return "Strong Accumulation";
  if (score >= 60) return "Accumulation";
  if (score >= 40) return "Stable";
  if (score >= 25) return "Distribution";
  return "Strong Distribution";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function quarterKey(symbol: string, period: string): string {
  return `${symbol}:${period}`;
}

/**
 * The query is a fixed, literal acceptance scope. Its only dynamic inputs are
 * the constants above, which prevents an operator from widening the check.
 */
export async function loadAcceptanceEvidence(
  executor: AcceptanceExecutor,
): Promise<{ symbols: RawSymbolEvidence[]; snapshots: { sectorCount: number; themeCount: number } }> {
  const result = await executor.execute(sql.raw(`
    WITH requested(symbol, cusip) AS (
      VALUES
        ('AAPL', '037833100'),
        ('NVDA', '67066G104'),
        ('MSFT', '594918104'),
        ('COST', '22160K105')
    ),
    fixed_quarters(period_of_report) AS (
      VALUES ('2026-03-31'::date), ('2025-12-31'::date)
    ),
    effective AS (
      SELECT h.*
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
    ),
    target AS (
      SELECT
        r.symbol AS requested_symbol,
        r.cusip AS requested_cusip,
        e.*,
        sm.ticker AS security_master_symbol,
        sm.review_status AS security_master_status,
        ism.mapped_symbol AS institutional_mapping_symbol,
        ism.mapping_status AS institutional_mapping_status
      FROM requested r
      LEFT JOIN effective e ON e.cusip = r.cusip
      LEFT JOIN security_master sm ON sm.cusip = e.cusip
      LEFT JOIN institutional_security_mappings ism ON ism.cusip = e.cusip
    ),
    target_resolved AS (
      SELECT
        target.*,
        CASE
          WHEN security_master_status = 'reviewed'
            AND NULLIF(UPPER(TRIM(security_master_symbol)), '') IS NOT NULL
            THEN 'reliably_mapped'
          WHEN institutional_mapping_status IN ('exact', 'reviewed')
            AND NULLIF(UPPER(TRIM(institutional_mapping_symbol)), '') IS NOT NULL
            AND mapping_status IN ('exact', 'reviewed')
            AND NULLIF(UPPER(TRIM(mapped_symbol)), '') IS NOT NULL
            AND UPPER(TRIM(institutional_mapping_symbol)) <> UPPER(TRIM(mapped_symbol))
            THEN 'ambiguous'
          WHEN COALESCE(
            CASE
              WHEN institutional_mapping_status IN ('exact', 'reviewed')
                THEN NULLIF(UPPER(TRIM(institutional_mapping_symbol)), '')
            END,
            CASE
              WHEN mapping_status IN ('exact', 'reviewed')
                THEN NULLIF(UPPER(TRIM(mapped_symbol)), '')
            END
          ) IS NOT NULL
            THEN 'reliably_mapped'
          WHEN institutional_mapping_status = 'ambiguous'
            OR mapping_status = 'ambiguous'
            THEN 'ambiguous'
          ELSE 'unmapped'
        END AS resolved_mapping_status,
        CASE
          WHEN security_master_status = 'reviewed'
            AND NULLIF(UPPER(TRIM(security_master_symbol)), '') IS NOT NULL
            THEN NULLIF(UPPER(TRIM(security_master_symbol)), '')
          WHEN institutional_mapping_status IN ('exact', 'reviewed')
            AND NULLIF(UPPER(TRIM(institutional_mapping_symbol)), '') IS NOT NULL
            AND mapping_status IN ('exact', 'reviewed')
            AND NULLIF(UPPER(TRIM(mapped_symbol)), '') IS NOT NULL
            AND UPPER(TRIM(institutional_mapping_symbol)) <> UPPER(TRIM(mapped_symbol))
            THEN NULL
          ELSE COALESCE(
            CASE
              WHEN institutional_mapping_status IN ('exact', 'reviewed')
                THEN NULLIF(UPPER(TRIM(institutional_mapping_symbol)), '')
            END,
            CASE
              WHEN mapping_status IN ('exact', 'reviewed')
                THEN NULLIF(UPPER(TRIM(mapped_symbol)), '')
            END
          )
        END AS resolved_symbol
      FROM target
    ),
    mapped_by_symbol AS (
      SELECT *
      FROM effective
      WHERE mapped_symbol IN ('AAPL', 'NVDA', 'MSFT', 'COST')
    ),
    raw_quarters AS (
      SELECT
        r.symbol,
        q.period_of_report::text AS period,
        COUNT(DISTINCT a.id)::int AS aggregate_row_count,
        MAX(a.period_label) AS period_label,
        MAX(a.reporting_manager_count)::int AS reporting_manager_count,
        MAX(a.aggregate_reported_shares)::float8 AS aggregate_reported_shares,
        MAX(a.aggregate_reported_value)::float8 AS aggregate_reported_value,
        MAX(a.previous_quarter_shares)::float8 AS previous_quarter_shares,
        MAX(a.previous_quarter_value)::float8 AS previous_quarter_value,
        MAX(a.reported_shares_change)::float8 AS reported_shares_change,
        MAX(a.reported_shares_change_percent)::float8 AS reported_shares_change_percent,
        MAX(a.new_position_count)::int AS new_position_count,
        MAX(a.increased_position_count)::int AS increased_position_count,
        MAX(a.reduced_position_count)::int AS reduced_position_count,
        MAX(a.exited_position_count)::int AS exited_position_count,
        MAX(a.unchanged_count)::int AS unchanged_count,
        MAX(a.eligible_holding_count)::int AS eligible_holding_count,
        MAX(a.excluded_holding_count)::int AS excluded_holding_count,
        MAX(a.coverage_status) AS coverage_status,
        MAX(a.amendment_status) AS amendment_status,
        MAX(a.top_holder_percent)::float8 AS top_holder_percent,
        MAX(a.top5_holder_percent)::float8 AS top5_holder_percent,
        MAX(a.largest_holders::text) AS largest_holders_text,
        COUNT(DISTINCT a.id) FILTER (
          WHERE a.prev_period_of_report IS NOT NULL
            AND a.prev_period_of_report <> (DATE_TRUNC('quarter', a.period_of_report)::date - 1)
        )::int AS invalid_comparable_rows,
        (
          SELECT COUNT(*)::int
          FROM target_resolved candidate
          WHERE candidate.requested_symbol = r.symbol
            AND candidate.period_of_report = q.period_of_report
            AND NULLIF(BTRIM(candidate.put_call), '') IS NULL
            AND UPPER(COALESCE(candidate.shares_prn_type, '')) <> 'PRN'
            AND candidate.reported_shares > 0
        ) AS mapping_candidate_rows,
        (
          SELECT COUNT(*)::int
          FROM target_resolved candidate
          WHERE candidate.requested_symbol = r.symbol
            AND candidate.period_of_report = q.period_of_report
            AND candidate.resolved_mapping_status = 'reliably_mapped'
            AND candidate.resolved_symbol = r.symbol
            AND NULLIF(BTRIM(candidate.put_call), '') IS NULL
            AND UPPER(COALESCE(candidate.shares_prn_type, '')) <> 'PRN'
            AND candidate.reported_shares > 0
        ) AS reliably_mapped_candidate_rows,
        COUNT(m.id) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NULL
            AND UPPER(COALESCE(m.shares_prn_type, '')) <> 'PRN'
            AND m.reported_shares > 0
        )::int AS raw_common_rows,
        COUNT(m.id) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NOT NULL
        )::int AS raw_option_rows,
        COUNT(m.id) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND UPPER(COALESCE(m.shares_prn_type, '')) = 'PRN'
        )::int AS raw_prn_rows,
        COUNT(m.id) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NULL
            AND UPPER(COALESCE(m.shares_prn_type, '')) <> 'PRN'
            AND m.reported_shares > 0
            AND m.reported_value IS NULL
        )::int AS raw_common_rows_with_null_value,
        SUM(m.reported_shares) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NULL
            AND UPPER(COALESCE(m.shares_prn_type, '')) <> 'PRN'
            AND m.reported_shares > 0
        )::float8 AS raw_common_shares,
        SUM(m.reported_value) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NULL
            AND UPPER(COALESCE(m.shares_prn_type, '')) <> 'PRN'
            AND m.reported_shares > 0
        )::float8 AS raw_common_value,
        COUNT(DISTINCT m.filer_cik) FILTER (
          WHERE m.mapped_symbol = r.symbol
            AND m.mapping_status IN ('exact', 'reviewed')
            AND m.put_call IS NULL
            AND UPPER(COALESCE(m.shares_prn_type, '')) <> 'PRN'
            AND m.reported_shares > 0
        )::int AS raw_common_manager_count
      FROM requested r
      CROSS JOIN fixed_quarters q
      LEFT JOIN institutional_quarterly_aggregates a
        ON a.symbol = r.symbol AND a.period_of_report = q.period_of_report
      LEFT JOIN mapped_by_symbol m
        ON m.mapped_symbol = r.symbol AND m.period_of_report = q.period_of_report
      GROUP BY r.symbol, q.period_of_report
    ),
    mapping_stats AS (
      SELECT
        r.symbol,
        r.cusip,
        COUNT(t.id)::int AS effective_holding_rows,
        COUNT(t.id) FILTER (
          WHERE t.mapped_symbol = r.symbol
            AND t.mapping_status IN ('exact', 'reviewed')
        )::int AS reliably_mapped_holding_rows,
        COUNT(t.id) FILTER (
          WHERE t.mapped_symbol IS NULL OR t.mapping_status NOT IN ('exact', 'reviewed')
        )::int AS unmapped_holding_rows,
        COUNT(t.id) FILTER (
          WHERE t.mapped_symbol IS NOT NULL AND t.mapped_symbol <> r.symbol
        )::int AS conflicting_mapped_holding_rows,
        COUNT(DISTINCT m.id)::int AS mapping_reference_rows,
        COUNT(DISTINCT m.id) FILTER (
          WHERE m.mapping_status IN ('exact', 'reviewed')
            AND m.mapped_symbol IS NOT NULL
            AND m.mapped_symbol <> r.symbol
        )::int AS conflicting_reliable_mapping_rows,
        COUNT(t.id) FILTER (WHERE t.put_call IS NULL AND UPPER(COALESCE(t.shares_prn_type, '')) <> 'PRN')::int AS common_equity_rows,
        COUNT(t.id) FILTER (WHERE t.put_call IS NOT NULL)::int AS option_rows,
        COUNT(t.id) FILTER (WHERE UPPER(COALESCE(t.shares_prn_type, '')) = 'PRN')::int AS prn_rows,
        COUNT(t.id) FILTER (WHERE t.reported_value IS NULL)::int AS null_value_rows,
        (
          SELECT COUNT(*)::int
          FROM institutional_quarterly_aggregates qa
          WHERE qa.symbol = r.symbol
            AND qa.prev_period_of_report IS NOT NULL
            AND qa.prev_period_of_report <> (DATE_TRUNC('quarter', qa.period_of_report)::date - 1)
        ) AS invalid_comparable_rows_all,
        COUNT(DISTINCT t.filer_cik)::int AS effective_manager_count,
        COUNT(DISTINCT t.period_of_report)::int AS effective_quarter_count,
        (
          SELECT COUNT(DISTINCT qa.period_of_report)::int
          FROM institutional_quarterly_aggregates qa
          WHERE qa.symbol = r.symbol
        ) AS aggregate_quarter_count
      FROM requested r
      LEFT JOIN target t ON t.requested_symbol = r.symbol
      LEFT JOIN institutional_security_mappings m ON m.cusip = r.cusip
      GROUP BY r.symbol, r.cusip
    ),
    preserved_multiple_groups AS (
      SELECT requested_symbol AS symbol, COUNT(*)::int AS group_count
      FROM (
        SELECT
          requested_symbol,
          accession_number,
          cusip,
          class_title,
          issuer_name,
          figi,
          reported_value,
          reported_shares,
          shares_prn_type,
          investment_discretion,
          other_manager,
          voting_sole,
          voting_shared,
          voting_none,
          filer_cik,
          period_of_report,
          filing_date
        FROM target
        WHERE id IS NOT NULL
          AND put_call IS NULL
          AND shares_prn_type IS DISTINCT FROM 'PRN'
          AND reported_shares > 0
        GROUP BY
          requested_symbol,
          accession_number,
          cusip,
          class_title,
          issuer_name,
          figi,
          reported_value,
          reported_shares,
          shares_prn_type,
          investment_discretion,
          other_manager,
          voting_sole,
          voting_shared,
          voting_none,
          filer_cik,
          period_of_report,
          filing_date
        HAVING COUNT(*) > 1
      ) confirmed
      GROUP BY requested_symbol
    ),
    comparable_managers AS (
      SELECT requested_symbol AS symbol, COUNT(*)::int AS comparable_manager_count
      FROM (
        SELECT requested_symbol, filer_cik
        FROM target
        WHERE id IS NOT NULL
          AND period_of_report IN ('2026-03-31'::date, '2025-12-31'::date)
          AND mapped_symbol = requested_symbol
          AND mapping_status IN ('exact', 'reviewed')
          AND put_call IS NULL
          AND UPPER(COALESCE(shares_prn_type, '')) <> 'PRN'
        GROUP BY requested_symbol, filer_cik
        HAVING COUNT(DISTINCT period_of_report) = 2
      ) matched
      GROUP BY requested_symbol
    )
    SELECT
      ms.*,
      GREATEST(
        COALESCE(pg.group_count, 0) - CASE ms.symbol
          WHEN 'AAPL' THEN 6
          WHEN 'NVDA' THEN 13
          WHEN 'MSFT' THEN 11
          WHEN 'COST' THEN 0
        END,
        0
      )::int AS exact_duplicate_groups,
      COALESCE(pg.group_count, 0)::int AS legitimate_multiple_groups,
      rq.period,
      rq.period_label,
      rq.aggregate_row_count,
      rq.reporting_manager_count,
      rq.aggregate_reported_shares,
      rq.aggregate_reported_value,
      rq.previous_quarter_shares,
      rq.previous_quarter_value,
      rq.reported_shares_change,
      rq.reported_shares_change_percent,
      rq.new_position_count,
      rq.increased_position_count,
      rq.reduced_position_count,
      rq.exited_position_count,
      rq.unchanged_count,
      rq.eligible_holding_count,
      rq.excluded_holding_count,
      rq.coverage_status,
      rq.amendment_status,
      rq.top_holder_percent,
      rq.top5_holder_percent,
      rq.largest_holders_text,
      rq.invalid_comparable_rows,
      rq.mapping_candidate_rows,
      rq.reliably_mapped_candidate_rows,
      rq.raw_common_rows,
      rq.raw_option_rows,
      rq.raw_prn_rows,
      rq.raw_common_rows_with_null_value,
      rq.raw_common_shares,
      rq.raw_common_value,
      rq.raw_common_manager_count,
      COALESCE(cm.comparable_manager_count, 0) AS comparable_manager_count
    FROM mapping_stats ms
    INNER JOIN raw_quarters rq ON rq.symbol = ms.symbol
    LEFT JOIN preserved_multiple_groups pg ON pg.symbol = ms.symbol
    LEFT JOIN comparable_managers cm ON cm.symbol = ms.symbol
    ORDER BY ms.symbol, rq.period DESC
  `));
  const rows = rowsOf(result);
  const bySymbol = new Map<string, RawSymbolEvidence>();
  for (const row of rows) {
    const symbol = String(row.symbol);
    const current = bySymbol.get(symbol) ?? {
      symbol,
      cusip: String(row.cusip),
      effectiveHoldingRows: count(row.effective_holding_rows),
      reliablyMappedHoldingRows: count(row.reliably_mapped_holding_rows),
      unmappedHoldingRows: count(row.unmapped_holding_rows),
      conflictingMappedHoldingRows: count(row.conflicting_mapped_holding_rows),
      mappingReferenceRows: count(row.mapping_reference_rows),
      conflictingReliableMappingRows: count(row.conflicting_reliable_mapping_rows),
      commonEquityRows: count(row.common_equity_rows),
      optionRows: count(row.option_rows),
      prnRows: count(row.prn_rows),
      nullValueRows: count(row.null_value_rows),
      exactDuplicateGroups: count(row.exact_duplicate_groups),
      legitimateMultipleGroups: count(row.legitimate_multiple_groups),
      invalidComparableRowsAll: count(row.invalid_comparable_rows_all),
      effectiveManagerCount: count(row.effective_manager_count),
      effectiveQuarterCount: count(row.effective_quarter_count),
      aggregateQuarterCount: count(row.aggregate_quarter_count),
      comparableManagerCount: count(row.comparable_manager_count),
      quarterRows: [],
    };
    current.quarterRows.push({
      symbol,
      period: String(row.period).slice(0, 10),
      periodLabel: text(row.period_label),
      aggregateRowCount: count(row.aggregate_row_count),
      reportingManagerCount: nullableNumber(row.reporting_manager_count),
      aggregateReportedShares: nullableNumber(row.aggregate_reported_shares),
      aggregateReportedValue: nullableNumber(row.aggregate_reported_value),
      previousQuarterShares: nullableNumber(row.previous_quarter_shares),
      previousQuarterValue: nullableNumber(row.previous_quarter_value),
      reportedSharesChange: nullableNumber(row.reported_shares_change),
      reportedSharesChangePercent: nullableNumber(row.reported_shares_change_percent),
      newPositionCount: count(row.new_position_count),
      increasedPositionCount: count(row.increased_position_count),
      reducedPositionCount: count(row.reduced_position_count),
      exitedPositionCount: count(row.exited_position_count),
      unchangedCount: count(row.unchanged_count),
      eligibleHoldingCount: count(row.eligible_holding_count),
      excludedHoldingCount: count(row.excluded_holding_count),
      coverageStatus: text(row.coverage_status),
      amendmentStatus: text(row.amendment_status),
      invalidComparableRows: count(row.invalid_comparable_rows),
      topHolderPercent: nullableNumber(row.top_holder_percent),
      top5HolderPercent: nullableNumber(row.top5_holder_percent),
      largestHolders: (() => {
        try {
          const parsed = JSON.parse(String(row.largest_holders_text ?? "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
      mappingCandidateRows: count(row.mapping_candidate_rows),
      reliablyMappedCandidateRows: count(
        row.reliably_mapped_candidate_rows,
      ),
      rawCommonRows: count(row.raw_common_rows),
      rawOptionRows: count(row.raw_option_rows),
      rawPrnRows: count(row.raw_prn_rows),
      rawCommonRowsWithNullValue: count(row.raw_common_rows_with_null_value),
      rawCommonShares: nullableNumber(row.raw_common_shares),
      rawCommonValue: nullableNumber(row.raw_common_value),
      rawCommonManagerCount: count(row.raw_common_manager_count),
    });
    bySymbol.set(symbol, current);
  }
  const snapshotResult = await executor.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*)::int FROM sector_intelligence_snapshots) AS sector_count,
      (SELECT COUNT(*)::int FROM theme_intelligence_snapshots) AS theme_count
  `));
  const snapshot = rowsOf(snapshotResult)[0] ?? {};
  return {
    symbols: SYMBOLS.map((symbol) => bySymbol.get(symbol) ?? {
      symbol,
      cusip: ACCEPTANCE_SYMBOLS[symbol],
      effectiveHoldingRows: 0,
      reliablyMappedHoldingRows: 0,
      unmappedHoldingRows: 0,
      conflictingMappedHoldingRows: 0,
      mappingReferenceRows: 0,
      conflictingReliableMappingRows: 0,
      commonEquityRows: 0,
      optionRows: 0,
      prnRows: 0,
      nullValueRows: 0,
      exactDuplicateGroups: 0,
      legitimateMultipleGroups: 0,
      invalidComparableRowsAll: 0,
      effectiveManagerCount: 0,
      effectiveQuarterCount: 0,
      aggregateQuarterCount: 0,
      comparableManagerCount: 0,
      quarterRows: [],
    }),
    snapshots: {
      sectorCount: count(snapshot.sector_count),
      themeCount: count(snapshot.theme_count),
    },
  };
}

function rowFor(
  evidence: RawSymbolEvidence,
  period: string,
): RawQuarterEvidence | undefined {
  return evidence.quarterRows.find((row) => row.period === period);
}

export function validateAcceptanceReport(
  evidence: { symbols: RawSymbolEvidence[]; snapshots: { sectorCount: number; themeCount: number } },
  services: Map<string, AcceptanceServiceResults>,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  if (evidence.symbols.length !== SYMBOLS.length) {
    issues.push("SYMBOL_SET_INCOMPLETE");
  }
  for (const expectedSymbol of SYMBOLS) {
    const symbolEvidence = evidence.symbols.find((item) => item.symbol === expectedSymbol);
    if (!symbolEvidence) {
      issues.push(`SYMBOL_MISSING:${expectedSymbol}`);
      continue;
    }
    if (symbolEvidence.cusip !== ACCEPTANCE_SYMBOLS[expectedSymbol]) {
      issues.push(`CUSIP_MISMATCH:${expectedSymbol}`);
    }
    if (symbolEvidence.effectiveHoldingRows === 0) {
      issues.push(`NO_EFFECTIVE_HOLDINGS:${expectedSymbol}`);
    }
    if (symbolEvidence.aggregateQuarterCount < 2) {
      issues.push(`AGGREGATE_HISTORY_INCOMPLETE:${expectedSymbol}`);
    }
    if (symbolEvidence.comparableManagerCount === 0) {
      issues.push(`NO_CUSIP_QOQ_MANAGER_MATCH:${expectedSymbol}`);
    }
    if (
      symbolEvidence.reliablyMappedHoldingRows !== symbolEvidence.effectiveHoldingRows ||
      symbolEvidence.unmappedHoldingRows > 0
    ) {
      issues.push(`MAPPING_COVERAGE_INCOMPLETE:${expectedSymbol}`);
    }
    if (
      symbolEvidence.conflictingMappedHoldingRows > 0 ||
      symbolEvidence.conflictingReliableMappingRows > 0
    ) {
      issues.push(`CONFLICTING_MAPPING:${expectedSymbol}`);
    }
    if (symbolEvidence.exactDuplicateGroups > 0) {
      issues.push(`EXACT_DUPLICATE_ROWS:${expectedSymbol}`);
    }
    if (
      symbolEvidence.legitimateMultipleGroups !==
        REQUIRED_PRESERVED_MULTIPLE_GROUPS[expectedSymbol]
    ) {
      issues.push(`PRESERVED_MULTIPLE_GROUPS_MISMATCH:${expectedSymbol}`);
    }
    if (symbolEvidence.invalidComparableRowsAll > 0) {
      issues.push(`INVALID_COMPARABLE_ROWS:${expectedSymbol}`);
    }
    for (const period of PERIODS) {
      const key = quarterKey(expectedSymbol, period);
      const quarter = rowFor(symbolEvidence, period);
      if (seen.has(key)) issues.push(`DUPLICATE_QUARTER_EVIDENCE:${key}`);
      seen.add(key);
      if (!quarter) {
        issues.push(`QUARTER_MISSING:${key}`);
        continue;
      }
      if (quarter.aggregateRowCount !== 1) {
        issues.push(`AGGREGATE_ROW_COUNT:${key}`);
      }
      if (
        quarter.reportingManagerCount === null ||
        quarter.aggregateReportedShares === null ||
        quarter.aggregateReportedValue === null
      ) {
        issues.push(`AGGREGATE_VALUE_MISSING:${key}`);
      }
      if (quarter.coverageStatus !== "complete") {
        issues.push(`AGGREGATE_COVERAGE_NOT_COMPLETE:${key}`);
      }
      if (quarter.invalidComparableRows !== 0) {
        issues.push(`INVALID_COMPARABLE_ROWS:${key}`);
      }
      if (quarter.rawCommonRowsWithNullValue > 0) {
        issues.push(`NULL_CANONICAL_VALUE:${key}`);
      }
      if (!sameNumber(quarter.aggregateReportedShares, quarter.rawCommonShares)) {
        issues.push(`SHARE_TOTAL_MISMATCH:${key}`);
      }
      if (!sameNumber(quarter.aggregateReportedValue, quarter.rawCommonValue)) {
        issues.push(`USD_TOTAL_MISMATCH:${key}`);
      }
      if (quarter.aggregateReportedShares !== null && quarter.aggregateReportedShares < 0) {
        issues.push(`NEGATIVE_SHARE_TOTAL:${key}`);
      }
      if (quarter.aggregateReportedValue !== null && quarter.aggregateReportedValue < 0) {
        issues.push(`NEGATIVE_USD_TOTAL:${key}`);
      }
    }
    const current = rowFor(symbolEvidence, PERIODS[0]);
    const previous = rowFor(symbolEvidence, PERIODS[1]);
    if (current && previous) {
      if (
        current.previousQuarterShares !== null &&
        !sameNumber(current.previousQuarterShares, previous.aggregateReportedShares)
      ) {
        issues.push(`PREVIOUS_SHARE_LINK_MISMATCH:${expectedSymbol}`);
      }
      if (
        current.previousQuarterValue !== null &&
        !sameNumber(current.previousQuarterValue, previous.aggregateReportedValue)
      ) {
        issues.push(`PREVIOUS_USD_LINK_MISMATCH:${expectedSymbol}`);
      }
      if (current.rawCommonManagerCount === 0 || previous.rawCommonManagerCount === 0) {
        issues.push(`NO_COMPARABLE_MANAGER_INPUT:${expectedSymbol}`);
      }
    }
    const service = services.get(expectedSymbol);
    if (!service) {
      issues.push(`SERVICE_RESULTS_MISSING:${expectedSymbol}`);
      continue;
    }
    const analytics = service.analytics;
    const trend = service.trend;
    const signal = service.signal;
    if (!analytics || !trend || !signal) {
      issues.push(`SERVICE_RESPONSE_MISSING:${expectedSymbol}`);
    } else {
      if (analytics.aggregateReportedShares !== current?.aggregateReportedShares) {
        issues.push(`ANALYTICS_SHARE_MISMATCH:${expectedSymbol}`);
      }
      if (analytics.aggregateReportedValueDollars !== current?.aggregateReportedValue) {
        issues.push(`ANALYTICS_USD_MISMATCH:${expectedSymbol}`);
      }
      if (analytics.reportingManagerCount !== current?.reportingManagerCount) {
        issues.push(`ANALYTICS_MANAGER_COUNT_MISMATCH:${expectedSymbol}`);
      }
      const activity = analytics.managerChangeCounts;
      if (
        !activity ||
        activity.new !== current?.newPositionCount ||
        activity.increased !== current?.increasedPositionCount ||
        activity.reduced !== current?.reducedPositionCount ||
        activity.exited !== current?.exitedPositionCount ||
        activity.unchanged !== current?.unchangedCount
      ) {
        issues.push(`ANALYTICS_ACTIVITY_MISMATCH:${expectedSymbol}`);
      }
      if (
        !analytics.mappingCoverage ||
        !current ||
        analytics.mappingCoverage.candidateHoldingCount !==
          current.mappingCandidateRows ||
        analytics.mappingCoverage.reliablyMappedHoldingCount !==
          current.reliablyMappedCandidateRows ||
        analytics.mappingCoverage.coveragePercent !==
          (current.mappingCandidateRows === 0
            ? 0
            : Math.round(
                (current.reliablyMappedCandidateRows /
                  current.mappingCandidateRows) *
                  10_000,
              ) / 100) ||
        current.reliablyMappedCandidateRows !== current.mappingCandidateRows
      ) {
        issues.push(`ANALYTICS_MAPPING_MISMATCH:${expectedSymbol}`);
      }
      const trendByPeriod = new Map(
        Array.isArray(trend.quarters)
          ? trend.quarters.map((quarter: any) => [quarter?.quarter?.periodEndDate, quarter])
          : [],
      );
      if (trendByPeriod.size < 2 || PERIODS.some((period) => !trendByPeriod.has(period))) {
        issues.push(`TREND_QUARTERS_INCOMPLETE:${expectedSymbol}`);
      } else {
        for (const period of PERIODS) {
          const trendQuarter = trendByPeriod.get(period) as any;
          const rawQuarter = rowFor(symbolEvidence, period);
          if (trendQuarter?.aggregateReportedShares !== rawQuarter?.aggregateReportedShares) {
            issues.push(`TREND_SHARE_MISMATCH:${expectedSymbol}:${period}`);
          }
          if (trendQuarter?.aggregateReportedValue !== rawQuarter?.aggregateReportedValue) {
            issues.push(`TREND_USD_MISMATCH:${expectedSymbol}:${period}`);
          }
        }
      }
      if (
        !trend.classification ||
        trend.classification === "INSUFFICIENT_DATA" ||
        !trend.dataQuality ||
        ["insufficient", "unavailable"].includes(trend.dataQuality.status)
      ) {
        issues.push(`TREND_RESPONSE_INCOMPLETE:${expectedSymbol}`);
      }
      if (
        signal.status !== "available" ||
        !finiteNumber(signal.score) ||
        signal.score < 0 ||
        signal.score > 100 ||
        typeof signal.label !== "string" ||
        signal.label.length === 0
      ) {
        issues.push(`SIGNAL_UNAVAILABLE:${expectedSymbol}`);
      }
      const independentlyCalculatedScore = independentlyCalculateSignalScore(
        signal.scoreComponents,
      );
      if (
        independentlyCalculatedScore === null ||
        signal.score !== independentlyCalculatedScore ||
        signal.label !== independentlyLabelSignal(independentlyCalculatedScore)
      ) {
        issues.push(`SIGNAL_CALCULATION_MISMATCH:${expectedSymbol}`);
      }
      if (signal.label !== "Distribution") {
        issues.push(`SIGNAL_EXPECTED_DISTRIBUTION:${expectedSymbol}`);
      }
      if (signal.metrics?.totalSharesLatest !== current?.aggregateReportedShares) {
        issues.push(`SIGNAL_SHARE_INPUT_MISMATCH:${expectedSymbol}`);
      }
      if (signal.metrics?.totalValueLatest !== current?.aggregateReportedValue) {
        issues.push(`SIGNAL_USD_INPUT_MISMATCH:${expectedSymbol}`);
      }
      if (
        signal.metrics?.managerCountLatest !== current?.reportingManagerCount ||
        signal.metrics?.managerCountPrevious !== previous?.reportingManagerCount ||
        signal.metrics?.totalSharesPrevious !== previous?.aggregateReportedShares ||
        signal.metrics?.totalValuePrevious !== previous?.aggregateReportedValue ||
        signal.metrics?.newManagerCount !== current?.newPositionCount ||
        signal.metrics?.exitedManagerCount !== current?.exitedPositionCount ||
        signal.metrics?.increasedManagerCount !== current?.increasedPositionCount ||
        signal.metrics?.reducedManagerCount !== current?.reducedPositionCount ||
        signal.metrics?.unchangedManagerCount !== current?.unchangedCount
      ) {
        issues.push(`SIGNAL_INPUTS_MISMATCH:${expectedSymbol}`);
      }
      if (
        !signal.scoreComponents ||
        !finiteNumber(signal.scoreComponents.breadth) ||
        !finiteNumber(signal.scoreComponents.accumulation) ||
        !finiteNumber(signal.scoreComponents.entrantsVsExits) ||
        !finiteNumber(signal.scoreComponents.concentration) ||
        !finiteNumber(signal.scoreComponents.dataQuality)
      ) {
        issues.push(`SIGNAL_COMPONENTS_INCOMPLETE:${expectedSymbol}`);
      }
    }
  }
  if (seen.size !== SYMBOLS.length * PERIODS.length) {
    issues.push("FIXED_QUARTER_SET_INCOMPLETE");
  }
  if (evidence.snapshots.sectorCount === 0) issues.push("SECTOR_SNAPSHOTS_MISSING");
  if (evidence.snapshots.themeCount === 0) issues.push("THEME_SNAPSHOTS_MISSING");
  return issues;
}

function compactServiceResult(
  raw: any,
  trend: any,
  signal: any,
): AcceptanceServiceResults {
  return { analytics: raw, trend, signal };
}

function toAggregateRow(
  quarter: RawQuarterEvidence,
): InstitutionalQuarterlyAggregate {
  return {
    id: `acceptance:${quarter.symbol}:${quarter.period}`,
    symbol: quarter.symbol,
    periodOfReport: quarter.period,
    periodLabel: quarter.periodLabel ?? "",
    reportingManagerCount: quarter.reportingManagerCount ?? 0,
    aggregateReportedShares: quarter.aggregateReportedShares,
    aggregateReportedValue: quarter.aggregateReportedValue,
    prevPeriodOfReport: quarter.period === PERIODS[0] ? PERIODS[1] : null,
    previousQuarterShares: quarter.previousQuarterShares,
    previousQuarterValue: quarter.previousQuarterValue,
    reportedSharesChange: quarter.reportedSharesChange,
    reportedSharesChangePercent: quarter.reportedSharesChangePercent,
    newPositionCount: quarter.newPositionCount,
    increasedPositionCount: quarter.increasedPositionCount,
    reducedPositionCount: quarter.reducedPositionCount,
    exitedPositionCount: quarter.exitedPositionCount,
    unchangedCount: quarter.unchangedCount,
    topHolderPercent: quarter.topHolderPercent,
    top5HolderPercent: quarter.top5HolderPercent,
    top10HolderPercent: null,
    concentrationClassification: null,
    trend: "unavailable",
    largestHolders: quarter.largestHolders,
    eligibleHoldingCount: quarter.eligibleHoldingCount,
    excludedHoldingCount: quarter.excludedHoldingCount,
    coverageStatus: quarter.coverageStatus ?? "insufficient",
    amendmentStatus: quarter.amendmentStatus ?? "clean",
    generatedAt: new Date(0),
  };
}

export async function runAcceptance(
  executor: AcceptanceExecutor,
  services: {
    getStockInstitutionalAnalytics: (...args: any[]) => Promise<any>;
    getStockInstitutionalTrend: (...args: any[]) => Promise<any>;
    buildInstitutionalSignal: (
      current: InstitutionalQuarterlyAggregate,
      previous: InstitutionalQuarterlyAggregate | null,
    ) => any;
    getLatestSectorSnapshots: () => Promise<any[]>;
    getLatestThemeSnapshots: () => Promise<any[]>;
  },
): Promise<AcceptanceReport> {
  const evidence = await loadAcceptanceEvidence(executor);
  const [sectorSnapshots, themeSnapshots] = await Promise.all([
    services.getLatestSectorSnapshots(),
    services.getLatestThemeSnapshots(),
  ]);
  evidence.snapshots = {
    sectorCount: sectorSnapshots.length,
    themeCount: themeSnapshots.length,
  };

  const servicesBySymbol = new Map<string, AcceptanceServiceResults>();
  const reportSymbols: AcceptanceSymbolReport[] = [];
  for (const symbol of SYMBOLS) {
    const rawEvidence = evidence.symbols.find((item) => item.symbol === symbol)!;
    const current = rowFor(rawEvidence, PERIODS[0]);
    const previous = rowFor(rawEvidence, PERIODS[1]);
    const [analytics, trend] = await Promise.all([
      services.getStockInstitutionalAnalytics(symbol, "2026-Q1", {
        positionType: "COMMON_EQUITY",
        topN: 5,
      }),
      services.getStockInstitutionalTrend(symbol, {
        quarter: "2026-Q1",
        historyQuarters: 2,
        positionType: "COMMON_EQUITY",
      }),
    ]);
    const signal = current
      ? services.buildInstitutionalSignal(
        toAggregateRow(current),
        previous ? toAggregateRow(previous) : null,
      )
      : null;
    const serviceResults = compactServiceResult(analytics, trend, signal);
    servicesBySymbol.set(symbol, serviceResults);
    reportSymbols.push({
      symbol,
      cusip: rawEvidence.cusip,
      status: "PASS",
      issues: [],
      mapping: {
        effectiveHoldingRows: rawEvidence.effectiveHoldingRows,
        reliablyMappedHoldingRows: rawEvidence.reliablyMappedHoldingRows,
        coverage: rawEvidence.effectiveHoldingRows > 0
          ? rawEvidence.reliablyMappedHoldingRows / rawEvidence.effectiveHoldingRows
          : null,
        conflictingMappedHoldingRows: rawEvidence.conflictingMappedHoldingRows,
        conflictingReliableMappingRows: rawEvidence.conflictingReliableMappingRows,
      },
      quarters: rawEvidence.quarterRows.map((quarter) => ({
        period: quarter.period,
        periodLabel: quarter.periodLabel,
        aggregate: {
          rowCount: quarter.aggregateRowCount,
          managers: quarter.reportingManagerCount,
          shares: quarter.aggregateReportedShares,
          valueDollars: quarter.aggregateReportedValue,
          previousShares: quarter.previousQuarterShares,
          previousValueDollars: quarter.previousQuarterValue,
          shareChange: quarter.reportedSharesChange,
          shareChangePercent: quarter.reportedSharesChangePercent,
            newPositionCount: quarter.newPositionCount,
            increasedPositionCount: quarter.increasedPositionCount,
            reducedPositionCount: quarter.reducedPositionCount,
            exitedPositionCount: quarter.exitedPositionCount,
            unchangedCount: quarter.unchangedCount,
          eligibleRows: quarter.eligibleHoldingCount,
          excludedRows: quarter.excludedHoldingCount,
          coverageStatus: quarter.coverageStatus,
          amendmentStatus: quarter.amendmentStatus,
        },
        rawChecks: {
          mappingCandidateRows: quarter.mappingCandidateRows,
          reliablyMappedCandidateRows:
            quarter.reliablyMappedCandidateRows,
          commonEquityRows: rawEvidence.commonEquityRows,
          optionRows: quarter.rawOptionRows,
          prnRows: quarter.rawPrnRows,
          nullValueRows: quarter.rawCommonRowsWithNullValue,
          commonShares: quarter.rawCommonShares,
          commonValueDollars: quarter.rawCommonValue,
          commonManagers: quarter.rawCommonManagerCount,
          invalidComparableRows: quarter.invalidComparableRows,
        },
      })),
      comparableManagers: rawEvidence.comparableManagerCount,
      services: {
        analytics: {
          available: Boolean(analytics),
          aggregateShares: analytics?.aggregateReportedShares ?? null,
          aggregateValueDollars: analytics?.aggregateReportedValueDollars ?? null,
          mappingCoveragePercent: analytics?.mappingCoverage?.coveragePercent ?? null,
        },
        trend: {
          available: Boolean(trend),
          classification: trend?.classification ?? null,
        },
        signal: {
          status: signal?.status ?? null,
          score: signal?.score ?? null,
          label: signal?.label ?? null,
          inputs: signal?.metrics ?? {},
          components: signal?.scoreComponents ?? {},
        },
      },
      integrity: {
        exactDuplicateGroups: rawEvidence.exactDuplicateGroups,
        legitimateMultipleGroups: rawEvidence.legitimateMultipleGroups,
        aggregateQuarterCount: rawEvidence.aggregateQuarterCount,
      },
    });
  }
  const issues = validateAcceptanceReport(evidence, servicesBySymbol);
  const globalIssues = issues.filter(
    (issue) => !SYMBOLS.some((symbol) => issue.includes(symbol)),
  );
  for (const symbolReport of reportSymbols) {
    symbolReport.issues = issues.filter(
      (issue) => issue.includes(symbolReport.symbol) || globalIssues.includes(issue),
    );
    symbolReport.status = symbolReport.issues.length === 0 ? "PASS" : "FAIL";
  }
  return {
    productionAcceptance: issues.length === 0 ? "PASS" : "FAIL",
    featureFlagReadiness: issues.length === 0 ? "SAFE_TO_ENABLE" : "DO_NOT_ENABLE",
    issues,
    symbols: reportSymbols,
    snapshots: evidence.snapshots,
  };
}

async function main(): Promise<void> {
  const runtimeIssues = validateAcceptanceRuntime(process.env);
  if (runtimeIssues.length > 0) {
    throw new Error(`DATABASE_RUNTIME_REJECTED:${runtimeIssues.join(",")}`);
  }
  process.env.DATABASE_URL = buildReadOnlyDatabaseUrl(process.env.DATABASE_URL!);

  const [{ db, pool }, analytics, trend, signal, snapshots] = await Promise.all([
    import("../server/db"),
    import("../server/services/institutional/analytics/stock-analytics"),
    import("../server/services/institutional/analytics/stock-trend"),
    import("../server/services/institutional/signal-engine"),
    import("../server/services/intelligence-snapshot-store"),
  ]);
  try {
    const modeResult = await db.execute(sql.raw("SHOW default_transaction_read_only"));
    const mode = rowsOf(modeResult as unknown as QueryResult)[0]?.default_transaction_read_only;
    if (mode !== "on") {
      throw new Error("DATABASE_RUNTIME_REJECTED:READ_ONLY_SESSION_REQUIRED");
    }
    const report = await runAcceptance(db as unknown as AcceptanceExecutor, {
      getStockInstitutionalAnalytics: analytics.getStockInstitutionalAnalytics,
      getStockInstitutionalTrend: trend.getStockInstitutionalTrend,
      buildInstitutionalSignal: signal.buildInstitutionalSignal,
      getLatestSectorSnapshots: snapshots.getLatestSectorSnapshots,
      getLatestThemeSnapshots: snapshots.getLatestThemeSnapshots,
    });
    console.log(JSON.stringify(report, null, 2));
    console.table(report.symbols.map((item) => {
      const q1 = item.quarters.find((quarter) => quarter.period === PERIODS[0]);
      const q4 = item.quarters.find((quarter) => quarter.period === PERIODS[1]);
      const failed = (prefixes: string[]) =>
        item.issues.some((issue) => prefixes.some((prefix) => issue.startsWith(prefix)));
      return {
        symbol: item.symbol,
        status: item.status,
        q1Managers: q1?.aggregate.managers ?? null,
        q1Shares: q1?.aggregate.shares ?? null,
        q1AggregateValueUsd: q1?.aggregate.valueDollars ?? null,
        q1Activity: q1
          ? `N${q1.aggregate.newPositionCount ?? "?"}/I${q1.aggregate.increasedPositionCount ?? "?"}`
          : null,
        q4Managers: q4?.aggregate.managers ?? null,
        q4Shares: q4?.aggregate.shares ?? null,
        q4AggregateValueUsd: q4?.aggregate.valueDollars ?? null,
        qoqValidation: failed(["PREVIOUS_", "NO_CUSIP_", "NO_COMPARABLE_"])
          ? "FAIL"
          : "PASS",
        signalValidation: failed(["SIGNAL_"]) ? "FAIL" : "PASS",
        serviceValidation: failed([
          "ANALYTICS_",
          "TREND_",
          "SERVICE_",
          "SECTOR_",
          "THEME_",
        ])
          ? "FAIL"
          : "PASS",
        mapped: `${item.mapping.reliablyMappedHoldingRows}/${item.mapping.effectiveHoldingRows}`,
        preservedMultipleGroups: item.integrity.legitimateMultipleGroups,
      };
    }));
    console.log(`PRODUCTION ACCEPTANCE: ${report.productionAcceptance}`);
    console.log(`FEATURE FLAG READINESS: ${report.featureFlagReadiness}`);
    console.log(
      `READY TO ENABLE FEATURE FLAG: ${
        report.featureFlagReadiness === "SAFE_TO_ENABLE" ? "YES" : "NO"
      }`,
    );
    if (report.productionAcceptance === "FAIL") {
      throw new Error(`ACCEPTANCE_FAILED:${report.issues.join(",")}`);
    }
  } finally {
    await pool.end();
  }
}

if (!process.env.VITEST) {
  main().catch((error: any) => {
    console.error(
      `[institutional-production-acceptance] ERROR: ${String(error?.message ?? error).slice(0, 500)}`,
    );
    process.exitCode = 1;
  });
}