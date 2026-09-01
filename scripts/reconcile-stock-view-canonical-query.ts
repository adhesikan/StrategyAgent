#!/usr/bin/env tsx
/**
 * Read-only production reconciliation of the accepted canonical Stock View
 * population against the exact SQL identity contract used by Stock View.
 *
 * This command intentionally reports; it never repairs, ingests, enriches,
 * applies, or mutates production data.
 */
import { execFileSync } from "node:child_process";
import { runCli } from "../server/cli-runtime";
import {
  buildReconciliationReadOnlyUrl,
  RECONCILIATION_TIMEOUT_MS,
  validateReconciliationRuntime,
  withReconciliationTimeout,
} from "./reconcile-live-stock-resolver";
import {
  canonicalSecurityTypeStateQuery,
  canonicalStockIdentityCte,
  canonicalStockIdentityForSymbolQuery,
  parseCanonicalStockEligibleIdentities,
} from "../server/services/institutional/canonical-security-state";
import { pool } from "../server/db";

export const STOCK_VIEW_RECONCILIATION_STATEMENT_TIMEOUT_MS = 170_000;
export const MAX_MISMATCH_SAMPLES = 10;

export type FirstFailedPredicate =
  | "EFFECTIVE_HOLDING_SELECTION"
  | "TRUSTED_MAPPING"
  | "MAPPED_SYMBOL"
  | "SECURITY_MASTER_JOIN"
  | "ASSET_TYPE"
  | "SYMBOL_VALIDATION"
  | "SHARE_CLASS_VALIDATION"
  | "CANONICAL_GROUPING"
  | "FINAL_SYMBOL_FILTER"
  | "OTHER";

export interface StockViewReconciliationArguments {
  expectedCommit: string | null;
  expectedDatabase: string | null;
}

export interface StockViewMismatchSample {
  symbol: string;
  canonicalCusips: string[];
  stockViewCusips: string[];
  mappingEvidencePresent: boolean;
  securityMasterTickerMatch: boolean;
  assetType: string | null;
  firstFailedPredicate: FirstFailedPredicate;
}

export interface StockViewReconciliationReport {
  canonicalSymbols: number;
  canonicalCusips: number;
  stockViewResolvableSymbols: number;
  stockViewUnresolvableSymbols: number;
  identitySetMismatchSymbols: number;
  canonicalOnlyCusips: number;
  stockViewOnlyCusips: number;
  mappingBackedCanonicalSymbols: number;
  mappingBackedStockViewResolvableSymbols: number;
  mappingBackedStockViewUnresolvableSymbols: number;
  directSecurityMasterCanonicalSymbols: number;
  directSecurityMasterResolvableSymbols: number;
  aggregateBackedButStockViewUnresolvable: number;
  signalBackedButStockViewUnresolvable: number;
  runtimeDatabaseName: string;
  runtimeSchemaName: string;
  runningCommit: string | null;
  expectedCommit: string | null;
  sameCommit: boolean;
  queryCount: number;
  runtimeMs: number;
  timedOut: boolean;
  mismatchSamples: StockViewMismatchSample[];
}

interface IdentityRow {
  cusip: string;
  symbol: string;
}

interface StockViewRow {
  cusip: string;
  symbol: string;
  assetType: string | null;
}

interface TraceRow {
  cusip: string;
  requestedSymbol: string;
  trustedSymbol: string | null;
  effectiveHoldingSelected: boolean;
  mappingEvidencePresent: boolean;
  securityMasterTickerMatch: boolean;
  securityMasterPresent: boolean;
  securityMasterReviewStatus: string | null;
  assetType: string | null;
  shareClassValid: boolean;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function rowsOf(result: unknown): Record<string, any>[] {
  return (result as { rows?: Record<string, any>[] }).rows ??
    (Array.isArray(result) ? result : []);
}

function localCommit(): string | null {
  if (process.env.RAILWAY_GIT_COMMIT_SHA?.trim()) {
    return process.env.RAILWAY_GIT_COMMIT_SHA.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function parseStockViewReconciliationArguments(
  argv: readonly string[],
): StockViewReconciliationArguments {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index < 0 ? null : argv[index + 1]?.trim() || null;
  };
  return {
    expectedCommit: value("--expected-commit"),
    expectedDatabase: value("--expected-database"),
  };
}

/**
 * Converts the shared production query from one symbol to a bounded set of
 * symbols without copying or reimplementing its CTE/predicate contract.
 */
export function buildSetBasedStockViewQuery(): string {
  const marker = "WHERE symbol = $1";
  if (!canonicalStockIdentityForSymbolQuery.includes(marker)) {
    throw new Error("STOCK_VIEW_QUERY_CONTRACT_CHANGED");
  }
  return canonicalStockIdentityForSymbolQuery
    .replace(
    marker,
    "WHERE symbol = ANY($1::text[])",
    )
    .replace(
      "SELECT\n  cusip,",
      "SELECT\n  symbol,\n  cusip,",
    );
}

export function validateStockViewReconciliationArguments(
  args: StockViewReconciliationArguments,
): string[] {
  const issues: string[] = [];
  if (!args.expectedCommit) issues.push("EXPECTED_COMMIT_REQUIRED");
  if (!args.expectedDatabase) issues.push("EXPECTED_DATABASE_REQUIRED");
  return issues;
}

function setBySymbol(
  identities: readonly IdentityRow[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const row of identities) {
    const symbol = normalize(row.symbol);
    const cusip = normalize(row.cusip);
    if (!symbol || !cusip) continue;
    if (!result.has(symbol)) result.set(symbol, new Set());
    result.get(symbol)!.add(cusip);
  }
  return result;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set(Array.from(left).filter((value) => !right.has(value)));
}

function firstFailedPredicate(
  symbol: string,
  trace: TraceRow | undefined,
  runtimeCanonicalRow: IdentityRow | undefined,
): FirstFailedPredicate {
  if (runtimeCanonicalRow && normalize(runtimeCanonicalRow.symbol) !== symbol) {
    return "FINAL_SYMBOL_FILTER";
  }
  if (!trace?.effectiveHoldingSelected) return "EFFECTIVE_HOLDING_SELECTION";
  if (!trace.trustedSymbol) return "TRUSTED_MAPPING";
  if (trace.trustedSymbol !== symbol) return "MAPPED_SYMBOL";
  if (!trace.securityMasterPresent) return "SECURITY_MASTER_JOIN";
  if (!["common_stock", "reit"].includes(normalize(trace.assetType))) {
    return "ASSET_TYPE";
  }
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return "SYMBOL_VALIDATION";
  if (symbol.includes(".") && !trace.shareClassValid) return "SHARE_CLASS_VALIDATION";
  return "CANONICAL_GROUPING";
}

export interface BuildStockViewReportInput {
  canonicalIdentities: readonly IdentityRow[];
  stockViewRows: readonly StockViewRow[];
  runtimeCanonicalRows?: readonly IdentityRow[];
  traceRows?: readonly TraceRow[];
  aggregateSymbols?: readonly string[];
  signalSymbols?: readonly string[];
  runtimeDatabaseName: string;
  runtimeSchemaName: string;
  runningCommit: string | null;
  expectedCommit: string | null;
  queryCount: number;
  runtimeMs: number;
  timedOut?: boolean;
}

export function buildStockViewReconciliationReport(
  input: BuildStockViewReportInput,
): StockViewReconciliationReport {
  const canonicalBySymbol = setBySymbol(input.canonicalIdentities);
  const runtimeBySymbol = setBySymbol(input.stockViewRows);
  const runtimeRowsByCusip = new Map(
    (input.runtimeCanonicalRows ?? []).map((row) => [normalize(row.cusip), row]),
  );
  const traceByCusip = new Map(
    (input.traceRows ?? []).map((row) => [normalize(row.cusip), row]),
  );
  const allCanonicalCusips = new Set(
    input.canonicalIdentities.map((row) => normalize(row.cusip)).filter(Boolean),
  );
  const allStockViewCusips = new Set(
    input.stockViewRows.map((row) => normalize(row.cusip)).filter(Boolean),
  );
  const validSymbols = Array.from(canonicalBySymbol.keys()).filter((symbol) =>
    /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol),
  );
  const resolvable = new Set<string>();
  const mismatches: StockViewMismatchSample[] = [];
  for (const symbol of Array.from(canonicalBySymbol.keys()).sort()) {
    const canonicalCusips = canonicalBySymbol.get(symbol) ?? new Set();
    const stockViewCusips = runtimeBySymbol.get(symbol) ?? new Set();
    const exact = canonicalCusips.size === stockViewCusips.size &&
      Array.from(canonicalCusips).every((cusip) => stockViewCusips.has(cusip));
    if (exact && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) resolvable.add(symbol);
    if (!exact) {
      const sampleCusip = Array.from(difference(canonicalCusips, stockViewCusips))
        .sort()[0] ?? Array.from(canonicalCusips).sort()[0];
      const trace = sampleCusip ? traceByCusip.get(sampleCusip) : undefined;
      const runtimeCanonicalRow = sampleCusip
        ? runtimeRowsByCusip.get(sampleCusip)
        : undefined;
      mismatches.push({
        symbol,
        canonicalCusips: Array.from(canonicalCusips).sort(),
        stockViewCusips: Array.from(stockViewCusips).sort(),
        mappingEvidencePresent: Boolean(trace?.mappingEvidencePresent),
        securityMasterTickerMatch: Boolean(trace?.securityMasterTickerMatch),
        assetType: trace?.assetType ?? null,
        firstFailedPredicate: firstFailedPredicate(symbol, trace, runtimeCanonicalRow),
      });
    }
  }
  const mappingBacked = new Set(
    (input.traceRows ?? [])
      .filter((row) => row.mappingEvidencePresent)
      .map((row) => row.requestedSymbol),
  );
  const directMaster = new Set(
    (input.traceRows ?? [])
      .filter((row) =>
        row.securityMasterTickerMatch &&
        normalize(row.securityMasterReviewStatus) === "REVIEWED" &&
        ["common_stock", "reit"].includes(normalize(row.assetType)),
      )
      .map((row) => row.requestedSymbol),
  );
  const aggregate = new Set((input.aggregateSymbols ?? []).map(normalize).filter(Boolean));
  const signal = new Set((input.signalSymbols ?? []).map(normalize).filter(Boolean));
  const unresolvable = new Set(
    Array.from(canonicalBySymbol.keys()).filter((symbol) => !resolvable.has(symbol)),
  );
  const runtimeOnly = difference(allStockViewCusips, allCanonicalCusips);
  return {
    canonicalSymbols: canonicalBySymbol.size,
    canonicalCusips: allCanonicalCusips.size,
    stockViewResolvableSymbols: resolvable.size,
    stockViewUnresolvableSymbols: unresolvable.size,
    identitySetMismatchSymbols: mismatches.length,
    canonicalOnlyCusips: difference(allCanonicalCusips, allStockViewCusips).size,
    stockViewOnlyCusips: runtimeOnly.size,
    mappingBackedCanonicalSymbols: mappingBacked.size,
    mappingBackedStockViewResolvableSymbols: Array.from(mappingBacked)
      .filter((symbol) => resolvable.has(symbol)).length,
    mappingBackedStockViewUnresolvableSymbols: Array.from(mappingBacked)
      .filter((symbol) => unresolvable.has(symbol)).length,
    directSecurityMasterCanonicalSymbols: directMaster.size,
    directSecurityMasterResolvableSymbols: Array.from(directMaster)
      .filter((symbol) => resolvable.has(symbol)).length,
    aggregateBackedButStockViewUnresolvable: Array.from(aggregate)
      .filter((symbol) => canonicalBySymbol.has(symbol) && unresolvable.has(symbol)).length,
    signalBackedButStockViewUnresolvable: Array.from(signal)
      .filter((symbol) => canonicalBySymbol.has(symbol) && unresolvable.has(symbol)).length,
    runtimeDatabaseName: input.runtimeDatabaseName,
    runtimeSchemaName: input.runtimeSchemaName,
    runningCommit: input.runningCommit,
    expectedCommit: input.expectedCommit,
    sameCommit: Boolean(input.expectedCommit) &&
      input.runningCommit === input.expectedCommit,
    queryCount: input.queryCount,
    runtimeMs: input.runtimeMs,
    timedOut: input.timedOut ?? false,
    mismatchSamples: mismatches
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .slice(0, MAX_MISMATCH_SAMPLES),
  };
}

function sqlTraceQuery(): string {
  return `
${canonicalStockIdentityCte},
targets AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb)
    AS target(cusip text, symbol text)
)
SELECT
  target.cusip,
  target.symbol AS "requestedSymbol",
  trusted.symbol AS "trustedSymbol",
  EXISTS (
    SELECT 1 FROM eligible_cusips eligible
    WHERE eligible.cusip = target.cusip
  ) AS "effectiveHoldingSelected",
  EXISTS (
    SELECT 1
    FROM institutional_security_mappings mapping
    WHERE mapping.cusip = target.cusip
      AND UPPER(TRIM(mapping.mapped_symbol)) = UPPER(TRIM(target.symbol))
      AND LOWER(COALESCE(mapping.mapping_status, '')) IN ('exact', 'reviewed')
  ) AS "mappingEvidencePresent",
  EXISTS (
    SELECT 1
    FROM security_master master
    WHERE master.cusip = target.cusip
      AND UPPER(TRIM(master.ticker)) = UPPER(TRIM(target.symbol))
  ) AS "securityMasterTickerMatch",
  (master.cusip IS NOT NULL) AS "securityMasterPresent",
  master.review_status AS "securityMasterReviewStatus",
  master.asset_type AS "assetType",
  (
    target.symbol !~ '\\.'
    OR EXISTS (
      SELECT 1
      FROM institutional_security_candidate_observations candidate
      WHERE candidate.cusip = target.cusip
        AND candidate.is_current = TRUE
        AND UPPER(TRIM(candidate.ticker)) = UPPER(TRIM(target.symbol))
        AND NULLIF(TRIM(candidate.share_class_figi), '') IS NOT NULL
    )
  ) AS "shareClassValid"
FROM targets target
LEFT JOIN trusted ON trusted.cusip = target.cusip
LEFT JOIN security_master master ON master.cusip = target.cusip
ORDER BY target.cusip`;
}

async function main(): Promise<void> {
  const args = parseStockViewReconciliationArguments(process.argv.slice(2));
  const argumentIssues = validateStockViewReconciliationArguments(args);
  const runtimeIssues = validateReconciliationRuntime(process.env, args);
  if (argumentIssues.length || runtimeIssues.length) {
    throw new Error(`DATABASE_RUNTIME_REJECTED:${[
      ...argumentIssues,
      ...runtimeIssues.filter((issue) => !argumentIssues.includes(issue)),
    ].join(",")}`);
  }
  const runningCommit = localCommit();
  process.env.DATABASE_URL = buildReconciliationReadOnlyUrl(process.env.DATABASE_URL!);
  const startedAt = performance.now();
  let queryCount = 0;
  let timedOut = false;
  const measure = async <T>(operation: () => Promise<T>): Promise<T> => {
    queryCount++;
    return operation();
  };
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = '${STOCK_VIEW_RECONCILIATION_STATEMENT_TIMEOUT_MS}ms'`,
      );
      const query = <T = Record<string, any>>(statement: string, params?: unknown[]) =>
        measure(async () => rowsOf(await client.query<T>(statement, params)));
      const identity = (await query(
        "SELECT current_database() AS database, current_schema() AS schema",
      ))[0] ?? {};
      if (String(identity.database) !== args.expectedDatabase) {
        throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_MISMATCH");
      }
      if (runningCommit !== args.expectedCommit) {
        throw new Error("DATABASE_RUNTIME_REJECTED:COMMIT_MISMATCH");
      }
      const canonicalState = (await query(canonicalSecurityTypeStateQuery))[0] ?? {};
      const canonicalIdentities = Array.from(
        parseCanonicalStockEligibleIdentities(canonicalState.stock_eligible_identities),
      ).map(([cusip, symbol]) => ({ cusip, symbol }));
      const targetSymbols = Array.from(new Set(
        canonicalIdentities
          .map((row) => normalize(row.symbol))
          .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)),
      )).sort();
      const targetJson = JSON.stringify(canonicalIdentities);
      const stockViewRows = targetSymbols.length
        ? await query<StockViewRow>(buildSetBasedStockViewQuery(), [targetSymbols])
        : [];
      const runtimeCanonicalRows = targetSymbols.length
        ? await query<IdentityRow>(`
${canonicalStockIdentityCte}
SELECT cusip, symbol
FROM canonical
WHERE symbol = ANY($1::text[])
ORDER BY cusip`, [targetSymbols])
        : [];
      const traceRows = canonicalIdentities.length
        ? await query<TraceRow>(sqlTraceQuery(), [targetJson])
        : [];
      const supportRows = targetSymbols.length
        ? await query(`
          SELECT UPPER(TRIM(symbol)) AS symbol, 'aggregate' AS source
          FROM institutional_quarterly_aggregates
          WHERE UPPER(TRIM(symbol)) = ANY($1::text[])
          UNION
          SELECT UPPER(TRIM(symbol)) AS symbol, 'signal' AS source
          FROM institutional_symbol_signals
          WHERE UPPER(TRIM(symbol)) = ANY($1::text[])
        `, [targetSymbols])
        : [];
      const aggregateSymbols = supportRows
        .filter((row) => row.source === "aggregate")
        .map((row) => row.symbol);
      const signalSymbols = supportRows
        .filter((row) => row.source === "signal")
        .map((row) => row.symbol);
      const report = buildStockViewReconciliationReport({
        canonicalIdentities,
        stockViewRows,
        runtimeCanonicalRows,
        traceRows,
        aggregateSymbols,
        signalSymbols,
        runtimeDatabaseName: String(identity.database),
        runtimeSchemaName: String(identity.schema),
        runningCommit,
        expectedCommit: args.expectedCommit,
        queryCount,
        runtimeMs: performance.now() - startedAt,
        timedOut: false,
      });
      if (!report.sameCommit) throw new Error("DATABASE_RUNTIME_REJECTED:COMMIT_MISMATCH");
      await client.query("COMMIT");
      return report;
    } finally {
      client.release();
    }
    }, RECONCILIATION_TIMEOUT_MS);
    console.log(JSON.stringify({
      ...report,
      timedOut,
      queryCount,
      runtimeMs: performance.now() - startedAt,
    }, null, 2));
    if (report.identitySetMismatchSymbols > 0 || report.stockViewUnresolvableSymbols > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    timedOut = String((error as { message?: unknown })?.message ?? "")
      .includes("RECONCILIATION_TIMEOUT");
    if (timedOut) {
      console.error(JSON.stringify({
        status: "TIMEOUT",
        timedOut: true,
        queryCount,
        runtimeMs: performance.now() - startedAt,
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
    label: "stock-view-canonical-reconciliation",
    close: async () => undefined,
  }).then((code) => {
    process.exitCode ||= code;
  });
}