#!/usr/bin/env tsx
/**
 * Aggregate-only, read-only verification of canonical institutional security
 * types. This command never applies remediation or prints individual IDs.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { runCli } from "../server/cli-runtime";

export const securityTypeStateQuery = `
WITH eligible_cusips AS (
  SELECT DISTINCT h.cusip
  FROM institutional_13f_holdings h
  JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
  WHERE f.is_effective = TRUE
    AND h.put_call IS NULL
    AND COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'
    AND h.reported_shares > 0
), evidence AS (
  SELECT cusip, mapped_symbol AS symbol, mapping_status AS status, NULL::text AS asset_type
  FROM institutional_security_mappings
  UNION ALL
  SELECT cusip, ticker AS symbol, review_status AS status, asset_type
  FROM security_master
), trusted AS (
  SELECT cusip
  FROM evidence
  GROUP BY cusip
  HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(symbol)), ''))
           FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) = 1
     AND BOOL_OR(LOWER(COALESCE(status, '')) = 'rejected') IS NOT TRUE
), canonical AS (
  SELECT e.cusip, MAX(sm.asset_type) AS asset_type
  FROM eligible_cusips e
  JOIN trusted t ON t.cusip = e.cusip
  LEFT JOIN security_master sm ON sm.cusip = e.cusip
  GROUP BY e.cusip
)
SELECT
  COUNT(*)::int AS trusted_cusips,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NOT NULL)::int AS asset_type_populated,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NULL)::int AS asset_type_missing,
  COUNT(*) FILTER (WHERE asset_type IN ('common_stock', 'reit'))::int AS stock_eligible_cusips,
  COUNT(*) FILTER (WHERE asset_type IN ('etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund'))::int AS separate_fund_cusips,
  COUNT(*) FILTER (WHERE asset_type IS NULL OR asset_type NOT IN (
    'common_stock', 'reit', 'etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund'
  ))::int AS unsupported_or_insufficient_cusips
FROM canonical`;

function rowsOf(result: unknown): any[] {
  return (result as { rows?: any[] }).rows ?? (Array.isArray(result) ? result : []);
}

export interface SecurityTypeStateReport {
  trustedCusips: number;
  assetTypePopulated: number;
  assetTypeMissing: number;
  stockEligibleCusips: number;
  separateFundCusips: number;
  unsupportedOrInsufficientCusips: number;
}

export function normalizeSecurityTypeStateReport(row: Record<string, unknown>): SecurityTypeStateReport {
  const count = (key: string) => Number(row[key] ?? 0);
  return {
    trustedCusips: count("trusted_cusips"),
    assetTypePopulated: count("asset_type_populated"),
    assetTypeMissing: count("asset_type_missing"),
    stockEligibleCusips: count("stock_eligible_cusips"),
    separateFundCusips: count("separate_fund_cusips"),
    unsupportedOrInsufficientCusips: count("unsupported_or_insufficient_cusips"),
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("DATABASE_RUNTIME_REJECTED:RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return tx.execute(sql.raw(securityTypeStateQuery));
  });
  console.log(JSON.stringify(normalizeSecurityTypeStateReport(rowsOf(result)[0] ?? {})));
}

if (!process.env.VITEST) {
  void runCli(main, {
    label: "institutional-security-type-state",
    close: () => pool.end(),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}