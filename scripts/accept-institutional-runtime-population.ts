#!/usr/bin/env tsx
/**
 * Bounded, read-only production population acceptance for the canonical
 * Institutional Intelligence runtime. It calls the shared canonical context
 * and batched downstream loaders; it does not duplicate their SQL.
 */
import { runCli } from "../server/cli-runtime";
import {
  canonicalSecurityTypeStateQuery,
  parseCanonicalStockEligibleIdentities,
} from "../server/services/institutional/canonical-security-state";
import type { CanonicalInstitutionalSecurityContext } from "../server/services/institutional/canonical-institutional-security-context";
import type { CanonicalRuntimeSupport } from "../server/services/institutional/canonical-runtime-loaders";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../server/services/institutional/analytics/types";

const TIMEOUT_MS = 180_000;
const STATEMENT_TIMEOUT_MS = 170_000;
const SAMPLE_LIMIT = 10;
export type RootCause =
  | "IDENTITY_CONTRACT"
  | "PERIOD_SELECTION"
  | "HOLDING_SELECTION"
  | "AGGREGATE_LOOKUP"
  | "SIGNAL_LOOKUP"
  | "TREND_LOOKUP"
  | "LEGACY_DEPENDENCY"
  | "AVAILABILITY_CLASSIFICATION"
  | "SQL_RUNTIME"
  | "OTHER";

function readOnlyUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  return url.toString();
}
export interface RuntimeAcceptanceEnvironment {
  DATABASE_URL?: string;
  EXTERNAL_DATABASE_URL?: string;
  RAILWAY_ENVIRONMENT_NAME?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
  RAILWAY_ENVIRONMENT_ID?: string;
}

export function validateRuntimeAcceptanceEnvironment(
  env: RuntimeAcceptanceEnvironment,
): string[] {
  const issues: string[] = [];
  const url = env.DATABASE_URL;
  if (!url) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (!env.RAILWAY_PROJECT_ID) issues.push("RAILWAY_PROJECT_ID_REQUIRED");
  if (!env.RAILWAY_SERVICE_ID) issues.push("RAILWAY_SERVICE_ID_REQUIRED");
  if (!env.RAILWAY_ENVIRONMENT_ID) issues.push("RAILWAY_ENVIRONMENT_ID_REQUIRED");
  if (!url) return issues;
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !(parsed.hostname.endsWith(".railway.internal") || parsed.hostname.endsWith(".rlwy.net"))) {
      issues.push("DATABASE_URL_IS_NOT_RAILWAY_POSTGRES");
    }
  } catch {
    issues.push("DATABASE_URL_INVALID");
  }
  return issues;
}

function assertRuntime(): void {
  const issues = validateRuntimeAcceptanceEnvironment(process.env);
  if (issues.length > 0) {
    throw new Error("DATABASE_RUNTIME_REJECTED:PRODUCTION_READ_ONLY_GUARD");
  }
}
function samples(): Record<RootCause, string[]> {
  return {
    IDENTITY_CONTRACT: [], HOLDING_SELECTION: [], AGGREGATE_LOOKUP: [],
    SIGNAL_LOOKUP: [], TREND_LOOKUP: [], AVAILABILITY_CLASSIFICATION: [],
    PERIOD_SELECTION: [], LEGACY_DEPENDENCY: [], SQL_RUNTIME: [], OTHER: [],
  };
}
function addSample(target: string[], value: string) {
  if (target.length < SAMPLE_LIMIT) target.push(value);
}

export interface RuntimeServiceAcceptanceReport {
  canonicalSymbols: number;
  stockViewServiceCalls: number;
  stockViewAvailable: number;
  stockViewPartial: number;
  stockViewInsufficientHistory: number;
  stockViewNoReportedPosition: number;
  stockViewUnexpectedUnsupported: number;
  stockViewUpstreamError: number;
  stockViewRuntimeExceptions: number;
  trendServiceCalls: number;
  trendAvailable: number;
  trendInsufficientHistory: number;
  trendUnexpectedUnavailable: number;
  trendRuntimeExceptions: number;
  unexpectedSamples: Record<RootCause, string[]>;
  acceptance: "PASS" | "FAIL";
}

export interface RuntimeAcceptanceServices {
  getStockInstitutionalAnalytics(
    symbol: string,
    context: CanonicalInstitutionalSecurityContext | null,
  ): Promise<StockInstitutionalAnalytics | null>;
  getStockInstitutionalTrend(
    symbol: string,
    context: CanonicalInstitutionalSecurityContext | null,
  ): Promise<StockInstitutionalTrendResult | null>;
}

async function mapConcurrent<T>(
  values: readonly string[],
  concurrency: number,
  worker: (value: string) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(values.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => run(),
    ),
  );
  return results;
}

export async function runRuntimeServiceAcceptance(
  symbols: readonly string[],
  contexts: ReadonlyMap<string, CanonicalInstitutionalSecurityContext>,
  support: CanonicalRuntimeSupport,
  services: RuntimeAcceptanceServices,
  concurrency = 16,
): Promise<RuntimeServiceAcceptanceReport> {
  const unexpected = samples();
  let stockViewAvailable = 0;
  let stockViewPartial = 0;
  let stockViewInsufficientHistory = 0;
  let stockViewNoReportedPosition = 0;
  let stockViewUnexpectedUnsupported = 0;
  let stockViewUpstreamError = 0;
  let stockViewRuntimeExceptions = 0;
  let trendAvailable = 0;
  let trendInsufficientHistory = 0;
  let trendUnexpectedUnavailable = 0;
  let trendRuntimeExceptions = 0;
  await mapConcurrent(symbols, concurrency, async (symbol) => {
    const context = contexts.get(symbol) ?? null;
    if (!context) {
      addSample(unexpected.IDENTITY_CONTRACT, symbol);
    }
    try {
      const result = await services.getStockInstitutionalAnalytics(
        symbol,
        context,
      );
      switch (result?.availability) {
        case "AVAILABLE": stockViewAvailable++; break;
        case "PARTIAL": stockViewPartial++; break;
        case "INSUFFICIENT_HISTORY": stockViewInsufficientHistory++; break;
        case "NO_REPORTED_POSITION": stockViewNoReportedPosition++; break;
        case "UNSUPPORTED":
        case "UNMAPPED":
        case undefined:
          stockViewUnexpectedUnsupported++;
          addSample(unexpected.AVAILABILITY_CLASSIFICATION, symbol);
          break;
      }
    } catch (error) {
      const postgresCode =
        typeof (error as { code?: unknown } | null)?.code === "string"
          ? String((error as { code: string }).code)
          : null;
      if (
        (error instanceof Error &&
          error.name === "StockViewRepositoryStageError") ||
        postgresCode
      ) {
        stockViewUpstreamError++;
        addSample(unexpected.SQL_RUNTIME, symbol);
      } else {
        stockViewRuntimeExceptions++;
        addSample(unexpected.OTHER, symbol);
      }
    }
    try {
      const result = await services.getStockInstitutionalTrend(symbol, context);
      if (result) {
        if (
          result.classification === "INSUFFICIENT_DATA" ||
          result.quarters.length < 2
        ) {
          trendInsufficientHistory++;
        } else {
          trendAvailable++;
        }
      } else if ((support.aggregatesBySymbol.get(symbol)?.length ?? 0) < 2) {
        trendInsufficientHistory++;
      } else {
        trendUnexpectedUnavailable++;
        addSample(unexpected.TREND_LOOKUP, symbol);
      }
    } catch {
      trendRuntimeExceptions++;
      addSample(unexpected.SQL_RUNTIME, symbol);
    }
  });
  const failureCount =
    stockViewUnexpectedUnsupported +
    stockViewUpstreamError +
    stockViewRuntimeExceptions +
    trendUnexpectedUnavailable +
    trendRuntimeExceptions;
  return {
    canonicalSymbols: symbols.length,
    stockViewServiceCalls: symbols.length,
    stockViewAvailable,
    stockViewPartial,
    stockViewInsufficientHistory,
    stockViewNoReportedPosition,
    stockViewUnexpectedUnsupported,
    stockViewUpstreamError,
    stockViewRuntimeExceptions,
    trendServiceCalls: symbols.length,
    trendAvailable,
    trendInsufficientHistory,
    trendUnexpectedUnavailable,
    trendRuntimeExceptions,
    unexpectedSamples: unexpected,
    acceptance: failureCount === 0 ? "PASS" : "FAIL",
  };
}

async function main(): Promise<void> {
  assertRuntime();
  process.env.DATABASE_URL = readOnlyUrl(process.env.DATABASE_URL!);
  const started = performance.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) =>
    {
      timeoutHandle = setTimeout(
        () => reject(new Error("RUNTIME_ACCEPTANCE_TIMEOUT")),
        TIMEOUT_MS,
      );
    });
  const acceptance = async () => {
    const { pool } = await import("../server/db");
    const { resolveCanonicalInstitutionalSecurityContexts } =
      await import("../server/services/institutional/canonical-institutional-security-context");
    const { loadCanonicalRuntimeSupport } =
      await import("../server/services/institutional/canonical-runtime-loaders");
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
        const state = await client.query(canonicalSecurityTypeStateQuery);
        const identities = parseCanonicalStockEligibleIdentities(
          state.rows[0]?.stock_eligible_identities,
        );
        const symbols = Array.from(new Set(Array.from(identities.values()))).sort();
        // Same shared context resolver used by Stock View/trend, in one batch.
        const contexts = await resolveCanonicalInstitutionalSecurityContexts(symbols);
        const contextValues = Array.from(contexts.values());
        // Same shared aggregate/signal batch loader used by runtime consumers.
        const support = await loadCanonicalRuntimeSupport(contextValues);
        const {
          getStockInstitutionalAnalytics,
          getStockInstitutionalTrend,
        } = await import("../server/services/institutional/analytics");
        const report = await runRuntimeServiceAcceptance(
          symbols,
          contexts,
          support,
          {
            getStockInstitutionalAnalytics: (symbol, context) =>
              getStockInstitutionalAnalytics(
                symbol,
                "latest",
                {},
                undefined,
                context,
              ),
            getStockInstitutionalTrend: (symbol, context) =>
              getStockInstitutionalTrend(
                symbol,
                {},
                undefined,
                context,
              ),
          },
        );
        await client.query("COMMIT");
        console.log(JSON.stringify({
          ...report,
          runtimeMs: Math.round(performance.now() - started),
          boundedTimeoutMs: TIMEOUT_MS,
          readOnly: true,
        }, null, 2));
      } finally { client.release(); }
    } finally { await pool.end(); }
  };
  try {
    await Promise.race([acceptance(), timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
if (!process.env.VITEST) void runCli(main, {
  label: "institutional-runtime-population-acceptance", close: async () => undefined,
}).then((code) => { process.exitCode ||= code; });