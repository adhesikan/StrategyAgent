#!/usr/bin/env tsx
/**
 * Report-only reconciliation of canonical identities and the live Stock View
 * resolver. This command has no mutation or ingestion dependencies.
 */
import { execFileSync } from "node:child_process";
import { runCli } from "../server/cli-runtime";

export interface ReconciliationRuntimeEnv {
  DATABASE_URL?: string;
  EXTERNAL_DATABASE_URL?: string;
  RAILWAY_ENVIRONMENT_NAME?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
  RAILWAY_ENVIRONMENT_ID?: string;
  RAILWAY_GIT_COMMIT_SHA?: string;
}

export interface ReconciliationArguments {
  expectedCommit: string | null;
  expectedDatabase: string | null;
}

export function parseReconciliationArguments(argv: readonly string[]): ReconciliationArguments {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index < 0 ? null : argv[index + 1]?.trim() || null;
  };
  return {
    expectedCommit: value("--expected-commit"),
    expectedDatabase: value("--expected-database"),
  };
}

export function buildReconciliationReadOnlyUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  return url.toString();
}

export function previousCalendarQuarter(period: string): string | null {
  const date = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  if (month === 3) return `${year - 1}-12-31`;
  if (month === 6) return `${year}-03-31`;
  if (month === 9) return `${year}-06-30`;
  if (month === 12) return `${year}-09-30`;
  return null;
}

export function selectResolverFilingPeriods(
  selectedPeriod: string | null,
  aggregatePreviousPeriod: string | null | undefined,
): string[] {
  if (!selectedPeriod) return [];
  return Array.from(new Set([
    selectedPeriod,
    aggregatePreviousPeriod ?? previousCalendarQuarter(selectedPeriod),
  ].filter((value): value is string => Boolean(value))));
}

export function validateReconciliationRuntime(
  env: ReconciliationRuntimeEnv,
  args: ReconciliationArguments,
): string[] {
  const issues: string[] = [];
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (!env.RAILWAY_PROJECT_ID) issues.push("RAILWAY_PROJECT_ID_REQUIRED");
  if (!env.RAILWAY_SERVICE_ID) issues.push("RAILWAY_SERVICE_ID_REQUIRED");
  if (!env.RAILWAY_ENVIRONMENT_ID) issues.push("RAILWAY_ENVIRONMENT_ID_REQUIRED");
  if (!args.expectedCommit) issues.push("EXPECTED_COMMIT_REQUIRED");
  if (!args.expectedDatabase) issues.push("EXPECTED_DATABASE_REQUIRED");
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !(url.hostname.endsWith(".railway.internal") || url.hostname.endsWith(".rlwy.net"))) {
      issues.push("DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT");
    }
  } catch {
    if (env.DATABASE_URL) issues.push("DATABASE_URL_INVALID");
  }
  return issues;
}

function rowsOf(result: unknown): Record<string, any>[] {
  return (result as { rows?: Record<string, any>[] }).rows ??
    (Array.isArray(result) ? result : []);
}

function localCommit(env: ReconciliationRuntimeEnv): string | null {
  if (env.RAILWAY_GIT_COMMIT_SHA?.trim()) return env.RAILWAY_GIT_COMMIT_SHA.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseReconciliationArguments(process.argv.slice(2));
  const issues = validateReconciliationRuntime(process.env, args);
  if (issues.length) throw new Error(`DATABASE_RUNTIME_REJECTED:${issues.join(",")}`);
  const runtimeCommit = localCommit(process.env);
  process.env.DATABASE_URL = buildReconciliationReadOnlyUrl(process.env.DATABASE_URL!);

  const [{ db, pool }, drizzle, analyzer, canonicalState, repository, reconciliation] =
    await Promise.all([
      import("../server/db"),
      import("drizzle-orm"),
      import("../server/services/institutional/institutional-coverage-analyzer"),
      import("../server/services/institutional/canonical-security-state"),
      import("../server/services/institutional/analytics/stock-analytics-repository"),
      import("../server/services/institutional/live-stock-resolver-reconciliation"),
    ]);
  const { sql } = drizzle;
  try {
    const modeQuery = "SHOW default_transaction_read_only";
    const mode = rowsOf(await db.execute(sql.raw(modeQuery)))[0]?.default_transaction_read_only;
    if (mode !== "on") {
      throw new Error("DATABASE_RUNTIME_REJECTED:READ_ONLY_SESSION_REQUIRED");
    }
    const report = await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
      const query = async (statement: string) => {
        analyzer.assertReadOnlySql(statement);
        return rowsOf(await tx.execute(sql.raw(statement)));
      };
      const identitySql = "SELECT current_database() AS database, current_schema() AS schema";
      const runtimeIdentity = (await query(identitySql))[0] ?? {};
      const analyzerIdentity = (await query(identitySql))[0] ?? {};
      analyzer.assertReadOnlySql(canonicalState.canonicalSecurityTypeStateQuery);
      const canonical = rowsOf(await tx.execute(
        sql.raw(canonicalState.canonicalSecurityTypeStateQuery),
      ))[0] ?? {};
      const masterRows = await query(`
        SELECT cusip, ticker, review_status AS "reviewStatus", asset_type AS "assetType"
        FROM security_master
      `);
      const aggregateRows = await query(`
        SELECT symbol, period_of_report::text AS "periodOfReport",
               prev_period_of_report::text AS "prevPeriodOfReport"
        FROM institutional_quarterly_aggregates
        ORDER BY symbol, period_of_report DESC
      `);
      const signalRows = await query("SELECT DISTINCT symbol FROM institutional_symbol_signals");
      const filingRows = await query(`
        SELECT accession_number AS "accessionNumber", filer_cik AS "managerId",
               filer_name AS "managerName", period_of_report::text AS "periodOfReport",
               filing_date::text AS "filingDate", is_effective AS "isEffective"
        FROM institutional_13f_filings
        WHERE is_effective = TRUE
      `);
      const canonicalIdentities =
        canonicalState.parseCanonicalStockEligibleIdentities(canonical.stock_eligible_identities);
      const latestAggregate = new Map<string, Record<string, any>>();
      for (const row of aggregateRows) {
        const symbol = String(row.symbol).trim().toUpperCase();
        if (!latestAggregate.has(symbol)) latestAggregate.set(symbol, row);
      }
      const latestFilingPeriod = filingRows
        .map((row) => String(row.periodOfReport))
        .sort()
        .reverse()[0] ?? null;
      const selectedAccessionsBySymbol: Record<string, string[]> = {};
      for (const symbol of new Set(canonicalIdentities.values())) {
        const aggregate = latestAggregate.get(symbol);
        const selectedPeriod = aggregate?.periodOfReport ?? latestFilingPeriod;
        const allowedPeriods = new Set(selectResolverFilingPeriods(
          selectedPeriod,
          aggregate?.prevPeriodOfReport,
        ));
        const selected = repository.selectAlignedStockFilings(
          filingRows.filter((row) => allowedPeriods.has(String(row.periodOfReport))) as any,
          "latest",
          aggregate ? {
            quarter: { periodEndDate: aggregate.periodOfReport },
          } as any : null,
        );
        selectedAccessionsBySymbol[symbol] = selected
          ? [...selected.currentFilings, ...selected.previousFilings]
              .map((filing) => filing.accessionNumber)
          : [];
      }
      const accessions = Array.from(new Set(Object.values(selectedAccessionsBySymbol).flat()));
      let evidenceRows: Record<string, any>[] = [];
      if (accessions.length) {
        const literals = accessions.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
        evidenceRows = await query(`
          SELECT h.accession_number AS "accessionNumber", f.period_of_report::text AS "periodOfReport",
                 h.cusip, sm.ticker AS "masterTicker", sm.review_status AS "masterReviewStatus",
                 sm.asset_type AS "masterAssetType", m.mapped_symbol AS "mappingSymbol",
                 m.mapping_status AS "mappingStatus", h.mapped_symbol AS "holdingMappedSymbol",
                 h.mapping_status AS "holdingMappingStatus"
          FROM institutional_13f_holdings h
          JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
          LEFT JOIN security_master sm ON sm.cusip = h.cusip
          LEFT JOIN institutional_security_mappings m ON m.cusip = h.cusip
          WHERE h.accession_number IN (${literals})
        `);
      }
      return reconciliation.reconcileLiveStockResolver({
        canonicalIdentities,
        securityMasterRows: masterRows as any,
        evidenceRows: evidenceRows as any,
        selectedAccessionsBySymbol,
        aggregateRows: aggregateRows as any,
        signalSymbols: signalRows.map((row) => String(row.symbol)),
        runtimeCommit,
        expectedCommit: args.expectedCommit,
        runtimeDatabase: String(runtimeIdentity.database),
        expectedDatabase: args.expectedDatabase,
        runtimeSchema: String(runtimeIdentity.schema),
        analyzerDatabase: String(analyzerIdentity.database),
        analyzerSchema: String(analyzerIdentity.schema),
      });
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.reconciled) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (!process.env.VITEST) {
  void runCli(main, { label: "live-stock-resolver-reconciliation" }).then((code) => {
    process.exitCode ||= code;
  });
}