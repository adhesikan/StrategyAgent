#!/usr/bin/env tsx
/**
 * Aggregate-only, read-only verification of canonical institutional security
 * types. This command never applies remediation or prints individual IDs.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { runCli } from "../server/cli-runtime";
import { canonicalSecurityTypeStateQuery } from "../server/services/institutional/canonical-security-state";

export const securityTypeStateQuery = canonicalSecurityTypeStateQuery;

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