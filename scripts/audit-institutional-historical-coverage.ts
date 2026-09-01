#!/usr/bin/env tsx
// Read-only quarter-by-quarter institutional coverage audit.

import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { getInstitutionalConfig } from "../server/services/institutional/config";
import {
  fetchDatasetCatalog,
  resolveCatalogQuarterRange,
} from "../server/services/institutional/sec-dataset-catalog";

export type HistoricalSourceClassification =
  | "SOURCE_AVAILABLE"
  | "SOURCE_MISSING"
  | "SOURCE_FAILED"
  | "NOT_YET_PUBLISHED";

export function classifyHistoricalSource(input: {
  catalogAvailable: boolean;
  latestRunStatus: string | null;
  latestRunErrorCode: string | null;
  quarterEnd: string;
  today: Date;
}): HistoricalSourceClassification {
  if (input.latestRunStatus === "failed" || input.latestRunStatus === "partial") return "SOURCE_FAILED";
  if (input.catalogAvailable) return "SOURCE_AVAILABLE";
  const eligibleAfter = new Date(`${input.quarterEnd}T00:00:00Z`);
  eligibleAfter.setUTCDate(eligibleAfter.getUTCDate() + 60);
  return input.today < eligibleAfter ? "NOT_YET_PUBLISHED" : "SOURCE_MISSING";
}

function parseRange(args: string[]): { fromQuarter: string; toQuarter: string } {
  const parsed = parseArgs({
    args,
    options: {
      "from-quarter": { type: "string" },
      "to-quarter": { type: "string" },
    },
    strict: true,
  });
  const fromQuarter = parsed.values["from-quarter"];
  const toQuarter = parsed.values["to-quarter"];
  if (!fromQuarter || !toQuarter) throw new Error("EXPLICIT_QUARTER_RANGE_REQUIRED");
  return { fromQuarter, toQuarter };
}

function periodEnd(year: number, q: number): string {
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][q - 1]}`;
}

function enumerateRange(fromQuarter: string, toQuarter: string): Array<{ quarter: string; period: string }> {
  const parse = (value: string) => {
    const match = /^(\d{4})-?Q([1-4])$/i.exec(value);
    if (!match) throw new Error("INVALID_QUARTER_RANGE");
    return Number(match[1]) * 4 + Number(match[2]) - 1;
  };
  const start = parse(fromQuarter);
  const end = parse(toQuarter);
  if (start > end) throw new Error("INVALID_QUARTER_RANGE");
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const ordinal = start + index;
    const year = Math.floor(ordinal / 4);
    const q = ordinal % 4 + 1;
    return { quarter: `${year}-Q${q}`, period: periodEnd(year, q) };
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const range = parseRange(args);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("EXTERNAL_DATABASE_URL_FORBIDDEN");
  const config = getInstitutionalConfig();
  if (!config.secUserAgent) throw new Error("SEC_USER_AGENT_REQUIRED");

  const catalog = await fetchDatasetCatalog(config.secUserAgent);
  const catalogRange = resolveCatalogQuarterRange(range.fromQuarter, range.toQuarter, catalog);
  const available = new Set(catalogRange.descriptors.map((item) => `${item.year}-Q${item.q}`));

  for (const item of enumerateRange(range.fromQuarter, range.toQuarter)) {
    const result = await db.execute(sql`
      WITH ranked_filings AS (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY f.filer_cik, f.period_of_report
                 ORDER BY f.is_effective DESC,
                          f.accepted_at DESC NULLS LAST,
                          f.filing_date DESC,
                          f.accession_number DESC
               ) AS filing_rank
          FROM institutional_13f_filings f
      ), effective_holdings AS (
        SELECT h.*
          FROM institutional_13f_holdings h
          JOIN ranked_filings f
            ON f.accession_number = h.accession_number
           AND f.is_effective = true
           AND f.filing_rank = 1
         WHERE h.period_of_report = ${item.period}
           AND h.put_call IS NULL
           AND COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'
           AND h.reported_shares > 0
      ), evidence AS (
        SELECT cusip, mapped_symbol AS symbol, mapping_status AS status
          FROM institutional_security_mappings
        UNION ALL
        SELECT cusip, ticker AS symbol, review_status AS status
          FROM security_master
      ), trusted AS (
        SELECT cusip,
               MAX(NULLIF(UPPER(TRIM(symbol)), ''))
                 FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) AS symbol
          FROM evidence
         GROUP BY cusip
        HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(symbol)), ''))
                 FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) = 1
           AND BOOL_OR(LOWER(COALESCE(status, '')) = 'rejected') IS NOT TRUE
      ), canonical AS (
        SELECT DISTINCT e.cusip, t.symbol, sm.asset_type
          FROM (SELECT DISTINCT cusip FROM effective_holdings) e
          JOIN trusted t ON t.cusip = e.cusip
          LEFT JOIN security_master sm ON sm.cusip = e.cusip
         WHERE sm.asset_type IN ('common_stock', 'reit')
           AND (
             (t.symbol ~ '^[A-Z0-9]+$' AND LENGTH(t.symbol) <= 12)
             OR (
               t.symbol ~ '^[A-Z0-9]+\.[A-Z0-9]+$'
               AND LENGTH(t.symbol) <= 12
               AND EXISTS (
                 SELECT 1
                   FROM institutional_security_candidate_observations candidate
                  WHERE candidate.cusip = e.cusip
                    AND candidate.is_current = TRUE
                    AND UPPER(TRIM(candidate.ticker)) = t.symbol
                    AND NULLIF(TRIM(candidate.share_class_figi), '') IS NOT NULL
               )
             )
           )
      )
      SELECT
        (SELECT COUNT(*)::int FROM institutional_13f_filings f WHERE f.period_of_report = ${item.period}) AS filings,
        (SELECT COUNT(*)::int FROM institutional_13f_filings f WHERE f.period_of_report = ${item.period} AND f.is_effective = true) AS "effectiveFilings",
        (SELECT COUNT(*)::int FROM institutional_13f_holdings h WHERE h.period_of_report = ${item.period}) AS "holdingRows",
        (SELECT COUNT(*)::int FROM canonical) AS "canonicalStockCusips",
        (SELECT COUNT(DISTINCT symbol)::int FROM canonical) AS "canonicalStockSymbols",
        (SELECT COUNT(DISTINCT a.symbol)::int FROM institutional_quarterly_aggregates a WHERE a.period_of_report = ${item.period}) AS "aggregateSymbols",
        (SELECT COUNT(DISTINCT s.symbol)::int FROM institutional_symbol_signals s WHERE s.period_end_date = ${item.period}) AS "signalSymbols",
        (SELECT r.status FROM institutional_ingestion_runs r WHERE r.quarter = ${item.quarter} ORDER BY r.started_at DESC LIMIT 1) AS "latestRunStatus",
        (SELECT r.error_code FROM institutional_ingestion_runs r WHERE r.quarter = ${item.quarter} ORDER BY r.started_at DESC LIMIT 1) AS "latestRunErrorCode"
    `);
    const row = result.rows[0] as any;
    console.log(JSON.stringify({
      quarter: item.quarter,
      source: classifyHistoricalSource({
        catalogAvailable: available.has(item.quarter),
        latestRunStatus: row.latestRunStatus ?? null,
        latestRunErrorCode: row.latestRunErrorCode ?? null,
        quarterEnd: item.period,
        today: new Date(),
      }),
      filings: row.filings ?? 0,
      effectiveFilings: row.effectiveFilings ?? 0,
      holdingRows: row.holdingRows ?? 0,
      canonicalStockCusips: row.canonicalStockCusips ?? 0,
      canonicalStockSymbols: row.canonicalStockSymbols ?? 0,
      aggregateSymbols: row.aggregateSymbols ?? 0,
      signalSymbols: row.signalSymbols ?? 0,
    }));
  }
}

if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    console.error(`[historical-coverage:error] ${error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN_FAILURE"}`);
    process.exitCode = 1;
  });
}