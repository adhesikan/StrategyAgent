#!/usr/bin/env tsx
/**
 * Report-only reconciliation of canonical identities and the live Stock View
 * resolver. This command has no mutation or ingestion dependencies.
 */
import { execFileSync } from "node:child_process";
import { runCli } from "../server/cli-runtime";

export const RECONCILIATION_TIMEOUT_MS = 180_000;
export const DATABASE_STATEMENT_TIMEOUT_MS = 170_000;
export const EVIDENCE_ACCESSION_BATCH_SIZE = 1_000;

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

export interface ReconciliationPerformance {
  runtimeMs: number;
  queryCount: number;
  maxQueryMs: number;
  timedOut: boolean;
}

interface ResolverFilingRow {
  accessionNumber: string;
  managerId: string;
  managerName: string;
  periodOfReport: string;
  filingDate: string;
  isEffective: boolean;
}

interface ResolverAggregateRow {
  symbol: string;
  periodOfReport: string;
  prevPeriodOfReport: string | null;
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

/**
 * Filing selection is independent of the symbol once the aggregate period is
 * known. Grouping symbols by period lets the verifier call the live selector
 * once per distinct period pair instead of once per symbol.
 */
export function selectResolverAccessionsBySymbol(
  symbols: readonly string[],
  aggregatesBySymbol: ReadonlyMap<string, ResolverAggregateRow>,
  latestFilingPeriod: string | null,
  filingRows: readonly ResolverFilingRow[],
  selectAligned: (
    rows: ResolverFilingRow[],
    requestedQuarter: "latest",
    canonicalAggregate: { quarter: { periodEndDate: string } } | null,
  ) => { currentFilings: Array<{ accessionNumber: string }>; previousFilings: Array<{ accessionNumber: string }> } | null,
): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const symbol of symbols) {
    const aggregate = aggregatesBySymbol.get(symbol);
    const selectedPeriod = aggregate?.periodOfReport ?? latestFilingPeriod;
    const key = JSON.stringify([
      selectedPeriod,
      aggregate?.prevPeriodOfReport ?? previousCalendarQuarter(selectedPeriod ?? ""),
      Boolean(aggregate),
    ]);
    groups.set(key, [...(groups.get(key) ?? []), symbol]);
  }

  const accessionsBySymbol: Record<string, string[]> = {};
  for (const [key, groupedSymbols] of groups) {
    const [selectedPeriod, previousPeriod, hasAggregate] =
      JSON.parse(key) as [string | null, string | null, boolean];
    const allowedPeriods = new Set(selectResolverFilingPeriods(
      selectedPeriod,
      previousPeriod,
    ));
    const selected = selectAligned(
      filingRows.filter((row) => allowedPeriods.has(row.periodOfReport)),
      "latest",
      hasAggregate && selectedPeriod
        ? { quarter: { periodEndDate: selectedPeriod } }
        : null,
    );
    const accessions = selected
      ? [...selected.currentFilings, ...selected.previousFilings]
          .map((filing) => filing.accessionNumber)
      : [];
    for (const symbol of groupedSymbols) {
      accessionsBySymbol[symbol] = accessions;
    }
  }
  return accessionsBySymbol;
}

export async function withReconciliationTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = RECONCILIATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("RECONCILIATION_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlLiteralList(values: readonly string[]): string {
  return values.map(sqlLiteral).join(", ");
}

function isTimeoutError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown };
  return value.code === "57014" ||
    String(value.message ?? "").includes("RECONCILIATION_TIMEOUT") ||
    String(value.message ?? "").includes("statement timeout");
}

async function main(): Promise<void> {
  const args = parseReconciliationArguments(process.argv.slice(2));
  const issues = validateReconciliationRuntime(process.env, args);
  if (issues.length) throw new Error(`DATABASE_RUNTIME_REJECTED:${issues.join(",")}`);
  const runtimeCommit = localCommit(process.env);
  process.env.DATABASE_URL = buildReconciliationReadOnlyUrl(process.env.DATABASE_URL!);

  const startedAt = performance.now();
  const performanceMetrics: ReconciliationPerformance = {
    runtimeMs: 0,
    queryCount: 0,
    maxQueryMs: 0,
    timedOut: false,
  };
  const measure = async <T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const queryStartedAt = performance.now();
    performanceMetrics.queryCount++;
    try {
      return await operation();
    } finally {
      performanceMetrics.maxQueryMs = Math.max(
        performanceMetrics.maxQueryMs,
        performance.now() - queryStartedAt,
      );
      void label;
    }
  };
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
    const mode = rowsOf(await measure(
      "read-only-session",
      () => db.execute(sql.raw("SHOW default_transaction_read_only")),
    ))[0]?.default_transaction_read_only;
    if (mode !== "on") {
      throw new Error("DATABASE_RUNTIME_REJECTED:READ_ONLY_SESSION_REQUIRED");
    }
    const report = await withReconciliationTimeout(() => db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
      await tx.execute(sql.raw("SET LOCAL statement_timeout = '170000ms'"));
      const query = async (statement: string) => {
        analyzer.assertReadOnlySql(statement);
        return rowsOf(await measure(statement.slice(0, 64), () =>
          tx.execute(sql.raw(statement)),
        ));
      };
      const identitySql = "SELECT current_database() AS database, current_schema() AS schema";
      const runtimeIdentity = (await query(identitySql))[0] ?? {};
      const analyzerIdentity = (await query(identitySql))[0] ?? {};
      analyzer.assertReadOnlySql(canonicalState.canonicalSecurityTypeStateQuery);
      const canonical = rowsOf(await measure(
        "canonical-identities",
        () => tx.execute(sql.raw(canonicalState.canonicalSecurityTypeStateQuery)),
      ))[0] ?? {};
      const canonicalIdentities =
        canonicalState.parseCanonicalStockEligibleIdentities(canonical.stock_eligible_identities);
      const targetSymbols = Array.from(new Set(canonicalIdentities.values())).sort();
      const targetSymbolSql = targetSymbols.length ? sqlLiteralList(targetSymbols) : null;
      const latestAggregateRows = targetSymbols.length ? await query(`
        SELECT symbol, period_of_report::text AS "periodOfReport",
               prev_period_of_report::text AS "prevPeriodOfReport"
        FROM institutional_quarterly_aggregates
        WHERE symbol IN (${targetSymbolSql})
        ORDER BY symbol, period_of_report DESC
      `) : [];
      const aggregatesBySymbol = new Map<string, ResolverAggregateRow>();
      for (const row of latestAggregateRows) {
        const symbol = String(row.symbol).trim().toUpperCase();
        if (!aggregatesBySymbol.has(symbol)) {
          aggregatesBySymbol.set(symbol, {
            symbol,
            periodOfReport: String(row.periodOfReport),
            prevPeriodOfReport: row.prevPeriodOfReport
              ? String(row.prevPeriodOfReport)
              : null,
          });
        }
      }
      const latestFilingPeriod = targetSymbols.length
        ? String((await query(`
          SELECT period_of_report::text AS "periodOfReport"
          FROM institutional_13f_filings
          WHERE is_effective = TRUE
          ORDER BY period_of_report DESC
          LIMIT 1
        `))[0]?.periodOfReport ?? "")
        : null;
      const periods = new Set<string>();
      for (const symbol of targetSymbols) {
        const aggregate = aggregatesBySymbol.get(symbol);
        const selectedPeriod = aggregate?.periodOfReport ?? latestFilingPeriod;
        for (const period of selectResolverFilingPeriods(
          selectedPeriod,
          aggregate?.prevPeriodOfReport,
        )) {
          periods.add(period);
        }
      }
      const masterRows = targetSymbolSql ? await query(`
        SELECT cusip, ticker, review_status AS "reviewStatus", asset_type AS "assetType"
        FROM security_master
        WHERE UPPER(ticker) IN (${targetSymbolSql})
      `) : [];
      const aggregateRows = latestAggregateRows;
      const signalRows = targetSymbolSql ? await query(`
        SELECT DISTINCT symbol
        FROM institutional_symbol_signals
        WHERE symbol IN (${targetSymbolSql})
      `) : [];
      const filingRows = periods.size ? await query(`
        SELECT accession_number AS "accessionNumber", filer_cik AS "managerId",
               filer_name AS "managerName", period_of_report::text AS "periodOfReport",
               filing_date::text AS "filingDate", is_effective AS "isEffective"
        FROM institutional_13f_filings
        WHERE is_effective = TRUE
          AND period_of_report::text IN (${sqlLiteralList(Array.from(periods))})
      `) : [];
      const selectedAccessionsBySymbol = selectResolverAccessionsBySymbol(
        targetSymbols,
        aggregatesBySymbol,
        latestFilingPeriod || null,
        filingRows as ResolverFilingRow[],
        repository.selectAlignedStockFilings as any,
      );
      const accessions = Array.from(new Set(Object.values(selectedAccessionsBySymbol).flat()));
      let evidenceRows: Record<string, any>[] = [];
      for (let index = 0; index < accessions.length; index += EVIDENCE_ACCESSION_BATCH_SIZE) {
        const batch = accessions.slice(index, index + EVIDENCE_ACCESSION_BATCH_SIZE);
        if (!batch.length || !targetSymbolSql) continue;
        evidenceRows.push(...await query(`
          SELECT h.accession_number AS "accessionNumber", f.period_of_report::text AS "periodOfReport",
                 h.cusip, sm.ticker AS "masterTicker", sm.review_status AS "masterReviewStatus",
                 sm.asset_type AS "masterAssetType", m.mapped_symbol AS "mappingSymbol",
                 m.mapping_status AS "mappingStatus", h.mapped_symbol AS "holdingMappedSymbol",
                 h.mapping_status AS "holdingMappingStatus"
          FROM institutional_13f_holdings h
          JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
          LEFT JOIN security_master sm ON sm.cusip = h.cusip
          LEFT JOIN institutional_security_mappings m ON m.cusip = h.cusip
           WHERE h.accession_number IN (${sqlLiteralList(batch)})
             AND (
               UPPER(sm.ticker) IN (${targetSymbolSql})
               OR UPPER(m.mapped_symbol) IN (${targetSymbolSql})
               OR UPPER(h.mapped_symbol) IN (${targetSymbolSql})
             )
          `));
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
        performance: performanceMetrics,
      });
    }), RECONCILIATION_TIMEOUT_MS);
    performanceMetrics.runtimeMs = performance.now() - startedAt;
    console.log(JSON.stringify(report, null, 2));
    if (!report.reconciled) process.exitCode = 1;
  } catch (error) {
    performanceMetrics.runtimeMs = performance.now() - startedAt;
    if (isTimeoutError(error)) {
      performanceMetrics.timedOut = true;
      console.error(JSON.stringify({
        status: "TIMEOUT",
        timedOut: true,
        ...performanceMetrics,
        timeoutMs: RECONCILIATION_TIMEOUT_MS,
      }));
    }
    throw error;
  } finally {
    await pool.end();
  }
}

if (!process.env.VITEST) {
  void runCli(main, {
    label: "live-stock-resolver-reconciliation",
    close: async () => undefined,
  }).then((code) => {
    process.exitCode ||= code;
  });
}