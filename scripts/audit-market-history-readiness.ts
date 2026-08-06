#!/usr/bin/env npx tsx
// scripts/audit-market-history-readiness.ts
//
// Read-only production readiness diagnostic for database-first market history.
//
// Reads from PostgreSQL via DATABASE_URL. Makes zero writes, zero external
// API calls (no Twelve Data, no broker, no MCP), and does not modify any
// application state.
//
// Usage:
//   DATABASE_URL=postgresql://... npx tsx scripts/audit-market-history-readiness.ts
//
// Or if DATABASE_URL is already set in the environment:
//   npx tsx scripts/audit-market-history-readiness.ts

import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Universe and policy constants (mirrors production values exactly)
// ---------------------------------------------------------------------------

/**
 * Curated internal-analysis universe: the same seed used by the ingestion job.
 * Updated via market_data_symbols admin if symbols are added/removed.
 * The audit queries live DB rows but falls back to these for reference.
 */
export const SEED_UNIVERSE_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA",                    // market regime / ETF breadth
  "NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META", // mega-cap tech
  "AVGO", "AMD", "MU", "PLTR", "ORCL",            // semiconductors / software
  "JPM", "COST", "WMT", "TSLA", "XOM",            // diversified
] as const;

export type SeedSymbol = typeof SEED_UNIVERSE_SYMBOLS[number];

/**
 * Symbols required for market-regime evaluation. Absence of ANY of these is
 * a hard blocker — scans must not present results as complete without them.
 */
export const REGIME_SYMBOLS: readonly string[] = ["SPY", "QQQ", "IWM", "DIA"];

/** Bar count the daily scanner requests from loadStoredBars (daily-scanner.ts:122). */
export const REQUIRED_BARS = 320;

/**
 * Minimum bar count for a meaningful scan result (daily-scanner.ts:123-124).
 * Below this the scanner skips the symbol entirely.
 */
export const MINIMUM_BARS = 50;

/** Weekday-distance threshold for "fresh" data in a global scan context. */
export const SCAN_STALE_WEEKDAYS = 3;

/**
 * Weekday-distance threshold for "stale but usable" — data is old but still
 * provides value for a conditional scan if previous snapshot exists.
 */
export const USABLE_STALE_WEEKDAYS = 10;

// Readiness go/no-go thresholds
export const GO_THRESHOLD_PCT = 95;
export const CONDITIONAL_GO_THRESHOLD_PCT = 85;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadinessStatus =
  | "READY"
  | "STALE_BUT_USABLE"
  | "INSUFFICIENT_HISTORY"
  | "MISSING"
  | "INVALID";

export type GoNogo = "GO" | "CONDITIONAL_GO" | "NO_GO";

export interface SymbolAuditResult {
  symbol: string;
  assetType: string;
  companyName: string;
  backfillYears: number;
  barCount: number;
  requiredBarCount: number;
  minimumBarCount: number;
  latestBarDate: string | null;
  earliestBarDate: string | null;
  freshness: "fresh" | "stale" | "usable" | "unavailable";
  provider: string | null;
  interval: "1day"; // table stores daily bars only
  duplicateTimestampCount: number;
  invalidBarCount: number;
  readinessStatus: ReadinessStatus;
  isRegimeSymbol: boolean;
}

export interface AuditSummary {
  universeSize: number;
  readyCount: number;
  staleButUsableCount: number;
  insufficientHistoryCount: number;
  missingCount: number;
  invalidCount: number;
  coveragePercent: number;
  latestCompletedMarketDate: string | null;
  oldestRequiredDate: string | null;
  providerDistribution: Record<string, number>;
  regimeSymbolsReady: string[];
  regimeSymbolsMissing: string[];
  regimeSymbolsInsufficient: string[];
  symbolsByStatus: {
    missing: string[];
    insufficient: string[];
    invalid: string[];
    stale: string[];
  };
  goNogo: GoNogo;
  goNogoReason: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — no I/O)
// ---------------------------------------------------------------------------

/**
 * Count Mon-Fri weekdays between two YYYY-MM-DD strings (exclusive of from,
 * inclusive of to). Returns 0 when from >= to.
 */
export function weekdayDist(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00Z");
  const to = new Date(toDate + "T00:00:00Z");
  if (to <= from) return 0;
  let n = 0;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= to) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

/** Most recent Mon-Fri calendar date at or before refDate (UTC). */
export function latestWeekday(refDate = new Date()): string {
  const d = new Date(refDate);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Classify a single symbol's stored-bar state into a ReadinessStatus.
 *
 * Priority order (highest wins):
 *   1. MISSING     — no bars at all
 *   2. INVALID     — integrity violations detected
 *   3. INSUFFICIENT_HISTORY — bars exist but below scanner minimum
 *   4. STALE_BUT_USABLE — enough bars, but data is old (> SCAN threshold)
 *   5. READY       — fresh, sufficient, valid
 */
export function classifyReadiness(params: {
  barCount: number;
  latestBarDate: string | null;
  invalidBarCount: number;
  duplicateTimestampCount: number;
  minimumBarCount: number;
  requiredBarCount: number;
  scanStaleWeekdays: number;
  usableStaleWeekdays: number;
  refDate: Date;
}): { status: ReadinessStatus; freshness: "fresh" | "stale" | "usable" | "unavailable" } {
  const {
    barCount, latestBarDate, invalidBarCount, duplicateTimestampCount,
    minimumBarCount, scanStaleWeekdays, usableStaleWeekdays, refDate,
  } = params;

  if (barCount === 0 || !latestBarDate) {
    return { status: "MISSING", freshness: "unavailable" };
  }

  if (invalidBarCount > 0 || duplicateTimestampCount > 0) {
    const refWd = latestWeekday(refDate);
    const dist = weekdayDist(latestBarDate, refWd);
    const freshness = dist <= scanStaleWeekdays ? "fresh" : dist <= usableStaleWeekdays ? "usable" : "stale";
    return { status: "INVALID", freshness };
  }

  if (barCount < minimumBarCount) {
    const refWd = latestWeekday(refDate);
    const dist = weekdayDist(latestBarDate, refWd);
    const freshness = dist <= scanStaleWeekdays ? "fresh" : dist <= usableStaleWeekdays ? "usable" : "stale";
    return { status: "INSUFFICIENT_HISTORY", freshness };
  }

  const refWd = latestWeekday(refDate);
  // latestBarDate may be >= refWd if bar was fetched after today's market close
  const dist = latestBarDate >= refWd ? 0 : weekdayDist(latestBarDate, refWd);

  if (dist <= scanStaleWeekdays) {
    return { status: "READY", freshness: "fresh" };
  }
  if (dist <= usableStaleWeekdays) {
    return { status: "STALE_BUT_USABLE", freshness: "usable" };
  }
  // Data is too old even for usable threshold — treat as insufficient
  return { status: "INSUFFICIENT_HISTORY", freshness: "stale" };
}

/**
 * Determine GO / CONDITIONAL_GO / NO_GO based on per-symbol results.
 *
 * Rules (in order — first match wins):
 *   NO_GO:          coverage < CONDITIONAL_GO_THRESHOLD_PCT
 *               OR  any required regime symbol is MISSING or INSUFFICIENT_HISTORY
 *               OR  any INVALID bars anywhere in the universe
 *   CONDITIONAL_GO: coverage 85–94.99% AND regime symbols READY or STALE_BUT_USABLE
 *   GO:             coverage ≥ GO_THRESHOLD_PCT AND all regime symbols READY AND 0 INVALID
 */
export function determineGoNogo(params: {
  symbolResults: SymbolAuditResult[];
  regimeSymbols: readonly string[];
  goThresholdPct: number;
  conditionalGoThresholdPct: number;
}): { goNogo: GoNogo; reason: string } {
  const { symbolResults, regimeSymbols, goThresholdPct, conditionalGoThresholdPct } = params;

  const total = symbolResults.length;
  if (total === 0) {
    return { goNogo: "NO_GO", reason: "Universe is empty — no symbols found in market_data_symbols" };
  }

  const readyOrUsable = symbolResults.filter(
    (s) => s.readinessStatus === "READY" || s.readinessStatus === "STALE_BUT_USABLE",
  ).length;
  const invalidSymbols = symbolResults.filter((s) => s.readinessStatus === "INVALID");
  const coveragePct = (readyOrUsable / total) * 100;

  // Check regime symbols
  const regimeResults = regimeSymbols
    .map((sym) => ({ sym, result: symbolResults.find((s) => s.symbol === sym) }));
  const regimeMissing = regimeResults.filter(
    (r) => !r.result || r.result.readinessStatus === "MISSING",
  );
  const regimeInsufficient = regimeResults.filter(
    (r) => r.result && r.result.readinessStatus === "INSUFFICIENT_HISTORY",
  );

  // NO_GO conditions
  if (invalidSymbols.length > 0) {
    return {
      goNogo: "NO_GO",
      reason: `${invalidSymbols.length} symbol(s) have INVALID bars: ${invalidSymbols.map((s) => s.symbol).join(", ")}`,
    };
  }
  if (regimeMissing.length > 0) {
    return {
      goNogo: "NO_GO",
      reason: `Required regime symbol(s) MISSING: ${regimeMissing.map((r) => r.sym).join(", ")}`,
    };
  }
  if (regimeInsufficient.length > 0) {
    return {
      goNogo: "NO_GO",
      reason: `Required regime symbol(s) have INSUFFICIENT_HISTORY: ${regimeInsufficient.map((r) => r.sym).join(", ")}`,
    };
  }
  if (coveragePct < conditionalGoThresholdPct) {
    return {
      goNogo: "NO_GO",
      reason: `Coverage ${coveragePct.toFixed(1)}% is below the minimum ${conditionalGoThresholdPct}% threshold`,
    };
  }

  // GO
  const regimeNotReady = regimeResults.filter(
    (r) => r.result && r.result.readinessStatus !== "READY",
  );
  if (coveragePct >= goThresholdPct && regimeNotReady.length === 0) {
    return {
      goNogo: "GO",
      reason: `Coverage ${coveragePct.toFixed(1)}% ≥ ${goThresholdPct}% and all regime symbols READY`,
    };
  }

  // CONDITIONAL_GO
  const reasons: string[] = [];
  if (coveragePct < goThresholdPct) {
    reasons.push(`coverage ${coveragePct.toFixed(1)}% < ${goThresholdPct}%`);
  }
  if (regimeNotReady.length > 0) {
    reasons.push(`regime symbols not READY: ${regimeNotReady.map((r) => r.sym).join(", ")}`);
  }
  return {
    goNogo: "CONDITIONAL_GO",
    reason: `Conditional: ${reasons.join("; ")}. Requires: previous valid snapshot + active backfill`,
  };
}

/**
 * Aggregate per-symbol results into a summary object for display.
 */
export function computeSummary(params: {
  symbolResults: SymbolAuditResult[];
  regimeSymbols: readonly string[];
  goThresholdPct: number;
  conditionalGoThresholdPct: number;
}): AuditSummary {
  const { symbolResults, regimeSymbols, goThresholdPct, conditionalGoThresholdPct } = params;

  const total = symbolResults.length;
  const ready = symbolResults.filter((s) => s.readinessStatus === "READY").length;
  const stale = symbolResults.filter((s) => s.readinessStatus === "STALE_BUT_USABLE").length;
  const insufficient = symbolResults.filter((s) => s.readinessStatus === "INSUFFICIENT_HISTORY").length;
  const missing = symbolResults.filter((s) => s.readinessStatus === "MISSING").length;
  const invalid = symbolResults.filter((s) => s.readinessStatus === "INVALID").length;

  const readyOrUsable = ready + stale;
  const coveragePct = total > 0 ? Math.round((readyOrUsable / total) * 100) : 0;

  const latestDates = symbolResults
    .map((s) => s.latestBarDate)
    .filter(Boolean) as string[];
  const latestCompletedMarketDate = latestDates.length > 0 ? latestDates.sort().at(-1)! : null;

  // Oldest date we would need for full technical analysis
  const now = new Date();
  const approxRequiredDays = Math.ceil((REQUIRED_BARS / 5) * 7); // calendar days
  const oldestDate = new Date(now);
  oldestDate.setUTCDate(oldestDate.getUTCDate() - approxRequiredDays);
  const oldestRequiredDate = oldestDate.toISOString().slice(0, 10);

  // Provider distribution
  const providerDist: Record<string, number> = {};
  for (const s of symbolResults) {
    if (s.provider) {
      providerDist[s.provider] = (providerDist[s.provider] ?? 0) + 1;
    } else {
      providerDist["none"] = (providerDist["none"] ?? 0) + 1;
    }
  }

  // Regime breakdown
  const regimeReady: string[] = [];
  const regimeMissing: string[] = [];
  const regimeInsufficient: string[] = [];
  for (const sym of regimeSymbols) {
    const r = symbolResults.find((s) => s.symbol === sym);
    if (!r || r.readinessStatus === "MISSING") regimeMissing.push(sym);
    else if (r.readinessStatus === "INSUFFICIENT_HISTORY") regimeInsufficient.push(sym);
    else regimeReady.push(sym);
  }

  const { goNogo, reason: goNogoReason } = determineGoNogo({
    symbolResults, regimeSymbols, goThresholdPct, conditionalGoThresholdPct,
  });

  return {
    universeSize: total,
    readyCount: ready,
    staleButUsableCount: stale,
    insufficientHistoryCount: insufficient,
    missingCount: missing,
    invalidCount: invalid,
    coveragePercent: coveragePct,
    latestCompletedMarketDate,
    oldestRequiredDate,
    providerDistribution: providerDist,
    regimeSymbolsReady: regimeReady,
    regimeSymbolsMissing: regimeMissing,
    regimeSymbolsInsufficient: regimeInsufficient,
    symbolsByStatus: {
      missing: symbolResults.filter((s) => s.readinessStatus === "MISSING").map((s) => s.symbol),
      insufficient: symbolResults.filter((s) => s.readinessStatus === "INSUFFICIENT_HISTORY").map((s) => s.symbol),
      invalid: symbolResults.filter((s) => s.readinessStatus === "INVALID").map((s) => s.symbol),
      stale: symbolResults.filter((s) => s.readinessStatus === "STALE_BUT_USABLE").map((s) => s.symbol),
    },
    goNogo,
    goNogoReason,
  };
}

// ---------------------------------------------------------------------------
// Safe output formatter (never prints credentials or raw candle data)
// ---------------------------------------------------------------------------

export function formatSummary(summary: AuditSummary, refDate = new Date()): string {
  const lines: string[] = [];
  const hr = "─".repeat(60);

  lines.push(hr);
  lines.push("  Market History Production Readiness Audit");
  lines.push(`  ${new Date(refDate).toUTCString()}`);
  lines.push(hr);

  lines.push("");
  lines.push("UNIVERSE");
  lines.push(`  Total symbols:          ${summary.universeSize}`);
  lines.push(`  Regime symbols:         ${REGIME_SYMBOLS.join(", ")}`);
  lines.push(`  Required history:       ${REQUIRED_BARS} bars (scanner request depth)`);
  lines.push(`  Minimum history:        ${MINIMUM_BARS} bars (scanner skip threshold)`);
  lines.push(`  Interval:               1day (daily bars only)`);

  lines.push("");
  lines.push("COVERAGE");
  lines.push(`  READY:                  ${summary.readyCount}`);
  lines.push(`  STALE_BUT_USABLE:       ${summary.staleButUsableCount}`);
  lines.push(`  INSUFFICIENT_HISTORY:   ${summary.insufficientHistoryCount}`);
  lines.push(`  MISSING:                ${summary.missingCount}`);
  lines.push(`  INVALID:                ${summary.invalidCount}`);
  lines.push(`  Coverage (READY+USABLE): ${summary.coveragePercent}%`);

  lines.push("");
  lines.push("DATES");
  lines.push(`  Latest bar in universe: ${summary.latestCompletedMarketDate ?? "(none)"}`);
  lines.push(`  Oldest date required:   ${summary.oldestRequiredDate ?? "(n/a)"}`);

  lines.push("");
  lines.push("PROVIDERS");
  for (const [provider, count] of Object.entries(summary.providerDistribution)) {
    lines.push(`  ${provider}: ${count} symbol(s)`);
  }

  lines.push("");
  lines.push("REGIME SYMBOLS");
  if (summary.regimeSymbolsReady.length > 0) {
    lines.push(`  READY:       ${summary.regimeSymbolsReady.join(", ")}`);
  }
  if (summary.regimeSymbolsInsufficient.length > 0) {
    lines.push(`  INSUFFICIENT: ${summary.regimeSymbolsInsufficient.join(", ")}`);
  }
  if (summary.regimeSymbolsMissing.length > 0) {
    lines.push(`  MISSING:     ${summary.regimeSymbolsMissing.join(", ")}`);
  }

  if (summary.symbolsByStatus.missing.length > 0) {
    lines.push("");
    lines.push("MISSING SYMBOLS");
    lines.push(`  ${summary.symbolsByStatus.missing.join(", ")}`);
  }
  if (summary.symbolsByStatus.insufficient.length > 0) {
    lines.push("");
    lines.push("INSUFFICIENT HISTORY");
    lines.push(`  ${summary.symbolsByStatus.insufficient.join(", ")}`);
  }
  if (summary.symbolsByStatus.invalid.length > 0) {
    lines.push("");
    lines.push("INVALID BARS (integrity violations)");
    lines.push(`  ${summary.symbolsByStatus.invalid.join(", ")}`);
  }
  if (summary.symbolsByStatus.stale.length > 0) {
    lines.push("");
    lines.push("STALE BUT USABLE");
    lines.push(`  ${summary.symbolsByStatus.stale.join(", ")}`);
  }

  lines.push("");
  lines.push(hr);
  const emoji = summary.goNogo === "GO" ? "✓" : summary.goNogo === "CONDITIONAL_GO" ? "⚠" : "✗";
  lines.push(`  ${emoji} ${summary.goNogo}`);
  lines.push(`  ${summary.goNogoReason}`);
  lines.push(hr);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Database queries (I/O — not unit tested directly)
// ---------------------------------------------------------------------------

interface SymbolRow {
  symbol: string;
  asset_type: string;
  company_name: string;
  backfill_years: number;
  bar_count: string;
  latest_bar_date: string | null;
  earliest_bar_date: string | null;
  provider: string | null;
  invalid_bar_count: string;
}

interface DupRow {
  symbol: string;
  dup_count: string;
}

export async function fetchSymbolData(pool: Pool): Promise<{
  symbols: SymbolRow[];
  dups: Record<string, number>;
}> {
  // Single bulk query: per-symbol bar stats + integrity check.
  // SET TRANSACTION READ ONLY enforces no-write guarantee.
  const client = await pool.connect();
  try {
    await client.query("SET TRANSACTION READ ONLY");

    const symbolsResult = await client.query<SymbolRow>(`
      SELECT
        mds.symbol,
        COALESCE(mds.asset_type, 'equity')            AS asset_type,
        COALESCE(mds.company_name, mds.symbol)        AS company_name,
        COALESCE(mds.backfill_years, 2)               AS backfill_years,
        COUNT(mdb.id)::text                            AS bar_count,
        MAX(mdb.trade_date::text)                      AS latest_bar_date,
        MIN(mdb.trade_date::text)                      AS earliest_bar_date,
        MAX(mdb.data_provider)                         AS provider,
        COUNT(
          CASE WHEN
            mdb.high < mdb.low
            OR mdb.high < mdb.open
            OR mdb.high < mdb.close
            OR mdb.low  > mdb.open
            OR mdb.low  > mdb.close
            OR mdb.open  <= 0
            OR mdb.close <= 0
            OR mdb.high  <= 0
            OR mdb.low   <= 0
            OR mdb.volume < 0
          THEN 1 END
        )::text                                        AS invalid_bar_count
      FROM market_data_symbols mds
      LEFT JOIN market_daily_bars mdb
        ON mdb.symbol = mds.symbol
        AND mdb.is_complete = true
      WHERE mds.enabled = true
        AND mds.internal_analysis_enabled = true
      GROUP BY mds.symbol, mds.asset_type, mds.company_name, mds.backfill_years
      ORDER BY mds.symbol
    `);

    // Duplicate trade_date per symbol (same provider — unique constraint covers this,
    // but different providers could produce the same date from different sources).
    const dupResult = await client.query<DupRow>(`
      SELECT symbol, COUNT(*)::text AS dup_count
      FROM (
        SELECT symbol, trade_date
        FROM market_daily_bars
        WHERE is_complete = true
        GROUP BY symbol, trade_date
        HAVING COUNT(*) > 1
      ) sub
      GROUP BY symbol
    `);

    const dupMap: Record<string, number> = {};
    for (const row of dupResult.rows) {
      dupMap[row.symbol] = Number(row.dup_count);
    }

    return { symbols: symbolsResult.rows, dups: dupMap };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main — entry point when run directly
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write(
      "ERROR: DATABASE_URL is not set. " +
      "Set it before running this script.\n" +
      "Example: DATABASE_URL=postgresql://... npx tsx scripts/audit-market-history-readiness.ts\n",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl, max: 1, ssl: { rejectUnauthorized: false } });

  try {
    const { symbols, dups } = await fetchSymbolData(pool);

    const refDate = new Date();
    const symbolResults: SymbolAuditResult[] = symbols.map((row) => {
      const barCount = Number(row.bar_count);
      const invalidBarCount = Number(row.invalid_bar_count);
      const dupCount = dups[row.symbol] ?? 0;

      const { status, freshness } = classifyReadiness({
        barCount,
        latestBarDate: row.latest_bar_date,
        invalidBarCount,
        duplicateTimestampCount: dupCount,
        minimumBarCount: MINIMUM_BARS,
        requiredBarCount: REQUIRED_BARS,
        scanStaleWeekdays: SCAN_STALE_WEEKDAYS,
        usableStaleWeekdays: USABLE_STALE_WEEKDAYS,
        refDate,
      });

      return {
        symbol: row.symbol,
        assetType: row.asset_type,
        companyName: row.company_name,
        backfillYears: Number(row.backfill_years),
        barCount,
        requiredBarCount: REQUIRED_BARS,
        minimumBarCount: MINIMUM_BARS,
        latestBarDate: row.latest_bar_date,
        earliestBarDate: row.earliest_bar_date,
        freshness,
        provider: row.provider,
        interval: "1day",
        duplicateTimestampCount: dupCount,
        invalidBarCount,
        readinessStatus: status,
        isRegimeSymbol: REGIME_SYMBOLS.includes(row.symbol),
      };
    });

    const summary = computeSummary({
      symbolResults,
      regimeSymbols: REGIME_SYMBOLS,
      goThresholdPct: GO_THRESHOLD_PCT,
      conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT,
    });

    process.stdout.write(formatSummary(summary, refDate) + "\n");

    // Exit code: 0 for GO/CONDITIONAL_GO, 1 for NO_GO
    process.exit(summary.goNogo === "NO_GO" ? 1 : 0);
  } catch (err: any) {
    // Never print the connection string or credentials
    process.stderr.write(`ERROR: Database query failed: ${err?.message ?? "unknown error"}\n`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly, not when imported by tests
if (
  process.argv[1] &&
  (process.argv[1].endsWith("audit-market-history-readiness.ts") ||
    process.argv[1].endsWith("audit-market-history-readiness.js"))
) {
  main();
}
