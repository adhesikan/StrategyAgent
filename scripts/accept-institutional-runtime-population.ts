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

async function main(): Promise<void> {
  assertRuntime();
  process.env.DATABASE_URL = readOnlyUrl(process.env.DATABASE_URL!);
  const started = performance.now();
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("RUNTIME_ACCEPTANCE_TIMEOUT")), TIMEOUT_MS));
  const acceptance = async () => {
    const { pool } = await import("../server/db");
    const { resolveCanonicalInstitutionalSecurityContexts } =
      await import("../server/services/institutional/canonical-institutional-security-context");
    const { loadCanonicalRuntimeSupport } =
      await import("../server/services/institutional/canonical-runtime-loaders");
    const unexpected = samples();
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
        let holdingsLoaded = 0, holdingsUnavailableLegitimately = 0;
        let aggregatesLoaded = 0, aggregateMissingUnexpectedly = 0;
        let signalsLoaded = 0, signalMissingUnexpectedly = 0;
        let trendLoaded = 0, trendInsufficientHistory = 0, trendUnexpectedFailure = 0;
        for (const symbol of symbols) {
          const context = contexts.get(symbol);
          if (!context) { addSample(unexpected.IDENTITY_CONTRACT, symbol); continue; }
          const aggregateRows = support.aggregatesBySymbol.get(symbol) ?? [];
          const holdingSupport = support.holdingsBySymbol.get(symbol);
          if (!holdingSupport) {
            holdingsUnavailableLegitimately++;
            addSample(unexpected.HOLDING_SELECTION, symbol);
          } else if (
            context.currentEffectivePeriod &&
            holdingSupport.latestPeriod !== context.currentEffectivePeriod
          ) {
            addSample(unexpected.PERIOD_SELECTION, symbol);
          } else {
            holdingsLoaded++;
          }
          const latest = aggregateRows[0];
          if (!latest) { aggregateMissingUnexpectedly++; addSample(unexpected.AGGREGATE_LOOKUP, symbol); continue; }
          aggregatesLoaded++;
          if (support.signalsBySymbol.has(symbol)) signalsLoaded++;
          else { signalMissingUnexpectedly++; addSample(unexpected.SIGNAL_LOOKUP, symbol); }
          if (aggregateRows.length >= 2) trendLoaded++;
          else trendInsufficientHistory++;
        }
        await client.query("COMMIT");
        const identityFailed = symbols.length - contexts.size;
        const stockViewAvailable = symbols.filter((symbol) =>
          contexts.has(symbol) &&
          support.holdingsBySymbol.has(symbol) &&
          (support.aggregatesBySymbol.get(symbol)?.length ?? 0) >= 2,
        ).length;
        const unexpectedUnsupported = identityFailed;
        const unexpectedFailureCount =
          identityFailed +
          aggregateMissingUnexpectedly +
          signalMissingUnexpectedly +
          trendUnexpectedFailure +
          Object.values(unexpected).reduce((sum, values) => sum + values.length, 0);
        console.log(JSON.stringify({
          canonicalSymbols: symbols.length, identityResolved: contexts.size, identityFailed,
          holdingsLoaded, holdingsUnavailableLegitimately, holdingsUnexpectedFailure: 0,
          aggregatesLoaded, aggregateMissingUnexpectedly,
          signalsLoaded, signalMissingUnexpectedly,
          trendLoaded, trendInsufficientHistory, trendUnexpectedFailure,
          stockViewAvailable,
          stockViewPartial: 0,
          stockViewInsufficientHistory: trendInsufficientHistory,
          stockViewNoReportedPosition: holdingsUnavailableLegitimately,
          stockViewUnexpectedUnsupported: unexpectedUnsupported,
          stockViewUpstreamError: 0,
          runtimeExceptions: 0,
          unexpectedSamples: unexpected,
          runtimeMs: Math.round(performance.now() - started),
          boundedTimeoutMs: TIMEOUT_MS,
          readOnly: true,
          acceptance: unexpectedFailureCount === 0 ? "PASS" : "FAIL",
        }, null, 2));
      } finally { client.release(); }
    } finally { await pool.end(); }
  };
  await Promise.race([acceptance(), timeout]);
}
if (!process.env.VITEST) void runCli(main, {
  label: "institutional-runtime-population-acceptance", close: async () => undefined,
}).then((code) => { process.exitCode ||= code; });