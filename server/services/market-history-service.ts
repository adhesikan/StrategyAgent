// Canonical historical market-data service — database-first.
//
// This is the ONLY place that decides which data source satisfies a market
// history request. All deterministic scanners and the internal MCP history
// route must call getHistoricalBars() instead of directly constructing
// TwelveDataDailyProvider or reading market_daily_bars ad-hoc.
//
// Provider precedence — global scan (MARKET_HISTORY_DATABASE_FIRST=true):
//   1. Sufficient + fresh validated PostgreSQL bars  → return immediately
//   2. Twelve Data refresh if missing/stale          → validate, persist, return
//      (only when MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED=true and allowExternalRefresh=true)
//   3. Stale stored bars when refresh is unavailable → return with stale metadata
//   4. Unavailable
//
// Emergency rollback (MARKET_HISTORY_DATABASE_FIRST=false):
//   Passes through directly to TwelveDataDailyProvider (legacy behavior).
//
// Global scan safety: set allowExternalRefresh=false for Opportunity Engine
// scans so a single scan cannot trigger dozens of uncontrolled external requests.
// The scheduled ingestion job is the approved mechanism for refreshing stored bars.
//
// Freshness policy (daily bars):
//   A bar is "fresh" when the latest stored trade_date is within
//   STALE_THRESHOLD_WEEKDAYS of the most recent completed weekday (Mon-Fri).
//   Using weekday distance (not wall-clock hours) prevents Friday's bar from
//   appearing stale on Saturday/Sunday or Monday morning before market open.
//   3-weekday threshold covers US single-day federal holidays without a
//   holiday calendar dependency.
//
// Disallowed providers: Yahoo Finance, mock/synthetic data, fabricated OHLCV,
// hash-generated prices. These are enforced by the provider allowlist and the
// bar validation rules in validation.ts.

import { sql, eq, and } from "drizzle-orm";
import { db } from "../db";
import { marketDataSymbols, marketDailyBars } from "@shared/schema";
import { loadStoredBars, persistValidatedBars } from "./daily-market-data/ingestion";
import { validateBar } from "./daily-market-data/validation";
import { TwelveDataDailyProvider } from "./daily-market-data/twelve-data-client";
import { MarketDataProviderError, type NormalizedDailyBar } from "./daily-market-data/types";
import { isIngestionAllowed } from "./daily-market-data/config";

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/** Use stored PostgreSQL bars as the primary source (true by default). */
export function isDatabaseFirstEnabled(): boolean {
  return (process.env.MARKET_HISTORY_DATABASE_FIRST ?? "true").toLowerCase() !== "false";
}

/** Allow on-demand Twelve Data refresh when stored bars are missing/stale. */
export function isExternalRefreshEnabled(): boolean {
  return (process.env.MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED ?? "true").toLowerCase() !== "false";
}

// ---------------------------------------------------------------------------
// History-depth policy constants
//
// These are the MINIMUM bar counts required before an indicator is considered
// computable. Callers that request fewer bars will receive a freshness status
// of "insufficient". Do not shrink these to make scans appear to complete on
// sparse data — that produces misleading technical indicators.
// ---------------------------------------------------------------------------

export const HISTORY_DEPTH = {
  /**
   * Full technical analysis: SMA-200 requires 200 bars; add a 50-bar warm-up
   * buffer so the first computed SMA-200 is stable (not based on only 200 bars
   * of initialization). Also covers EMA-21 warm-up, RSI-14, ATR-14, and the
   * 52-week-high lookback (252 trading days ≈ 1 year).
   */
  FULL_TECHNICAL: 260,

  /**
   * Standard scan: covers SMA-50, SMA-20, EMA-21, EMA-8, RSI-14, ATR-14,
   * RVOL, 20-day returns, VCP base formation. Sufficient for rank_market_trade_candidates
   * and most scanner tools without the full 200-day moving average.
   */
  STANDARD_SCAN: 120,

  /**
   * Minimum for any meaningful indicator. Below this, even RSI-14 is unreliable
   * and no VCP structure can be evaluated.
   */
  MINIMUM: 30,
} as const;

// ---------------------------------------------------------------------------
// Freshness policy
//
// "Fresh" = the latest stored bar's trade_date is within N weekdays of today.
// Weekday distance prevents false staleness on weekends and around holidays.
// ---------------------------------------------------------------------------

export const FRESHNESS_POLICY = {
  /**
   * Global scan / Opportunity Engine: 3 weekdays.
   * Covers: Friday bar is fresh through Monday morning (Sat=0, Sun=0, Mon=1 weekday gap).
   * Also covers a single US federal holiday (e.g. Monday holiday — gap is still ≤1 weekday
   * from Friday). Does NOT cover long holiday weekends (Thanksgiving Fri is open).
   */
  SCAN_STALE_WEEKDAYS: 3,

  /**
   * User-specific analysis (Ask AI, Advanced Trade Builder): 5 weekdays.
   * More relaxed — user sees bars with clear stale labeling.
   */
  USER_STALE_WEEKDAYS: 5,
} as const;

// Exported for testing.
export type FreshnessStatus = "fresh" | "stale" | "unavailable";
export type SourceType = "stored" | "external_refresh" | "stored_stale";

export interface HistoricalBarsResult {
  bars: NormalizedDailyBar[];
  sourceType: SourceType;
  /** "twelve_data" | "broker:<id>" | "stored" */
  provider: string;
  freshnessStatus: FreshnessStatus;
  /** Latest bar trade_date in result set, or null when unavailable. */
  latestBarDate: string | null;
  barCount: number;
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Freshness helpers
// ---------------------------------------------------------------------------

/**
 * Returns the most recent Mon-Fri calendar date at or before `refDate`.
 * Does NOT account for market holidays — relies on the weekday threshold
 * in FRESHNESS_POLICY to absorb holiday gaps conservatively.
 */
export function mostRecentWeekday(refDate = new Date()): string {
  const d = new Date(refDate);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Count how many Mon-Fri days fall strictly between fromDate and toDate
 * (exclusive of fromDate, inclusive of toDate).
 * Returns 0 when fromDate >= toDate.
 */
export function weekdayDistance(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00Z");
  const to = new Date(toDate + "T00:00:00Z");
  if (to <= from) return 0;
  let count = 0;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= to) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * Check whether a bar at latestBarDate is "fresh" for the given purpose.
 * Returns "unavailable" when latestBarDate is null.
 */
export function checkFreshness(
  latestBarDate: string | null,
  purpose: "scan" | "user",
  refDate = new Date(),
): FreshnessStatus {
  if (!latestBarDate) return "unavailable";
  const refWeekday = mostRecentWeekday(refDate);
  // If stored bar is newer than expected (e.g., fetched post-close for today), treat as fresh.
  if (latestBarDate >= refWeekday) return "fresh";
  const threshold =
    purpose === "scan" ? FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS : FRESHNESS_POLICY.USER_STALE_WEEKDAYS;
  const dist = weekdayDistance(latestBarDate, refWeekday);
  return dist <= threshold ? "fresh" : "stale";
}

// ---------------------------------------------------------------------------
// Disallowed provider guard
// ---------------------------------------------------------------------------

const ALLOWED_PROVIDERS = new Set(["twelve_data", "tradier", "tradestation", "schwab"]);
const DISALLOWED_PROVIDERS = new Set(["yahoo", "yahoo_finance", "mock", "synthetic", "fake", "test_data"]);

function assertProviderAllowed(provider: string): void {
  const p = provider.toLowerCase().trim();
  if (DISALLOWED_PROVIDERS.has(p) || p.startsWith("mock") || p.startsWith("fake")) {
    throw new MarketDataProviderError(
      `Provider "${provider}" is not approved for production market data.`,
      "DISABLED",
      true,
    );
  }
}

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------

/**
 * Get historical daily bars for a symbol.
 *
 * Purpose controls provider precedence and freshness thresholds:
 *   "scan"   — global Opportunity Engine; never makes per-user broker calls;
 *              tight freshness requirement; allowExternalRefresh defaults false
 *   "user"   — user-facing analysis; relaxed freshness; may use broker bars
 *              in future when BrokerProvider.getHistoricalBars() is wired
 *   "regime" — market-regime calculation; same as "scan"
 */
export async function getHistoricalBars(params: {
  symbol: string;
  outputSize: number;
  purpose: "scan" | "user" | "regime";
  freshnessRequirement?: "strict" | "relaxed";
  /** When false, no external provider is called even if bars are stale/missing. */
  allowExternalRefresh?: boolean;
  caller?: string;
}): Promise<HistoricalBarsResult> {
  const symbol = params.symbol.trim().toUpperCase();
  const outputSize = Math.max(1, Math.min(params.outputSize, 5000));
  const allowRefresh =
    params.allowExternalRefresh !== undefined
      ? params.allowExternalRefresh
      : params.purpose !== "scan"; // scan defaults to no external refresh
  const purposeForFreshness = params.purpose === "user" ? "user" : "scan";
  const retrievedAt = new Date().toISOString();

  // ── Legacy rollback path ──────────────────────────────────────────────────
  if (!isDatabaseFirstEnabled()) {
    const provider = new TwelveDataDailyProvider();
    const bars = await provider.getDailyBars({ symbol, outputSize, caller: params.caller });
    const latest = bars.length > 0 ? bars[bars.length - 1].tradeDate : null;
    return {
      bars,
      sourceType: "external_refresh",
      provider: "twelve_data",
      freshnessStatus: checkFreshness(latest, purposeForFreshness),
      latestBarDate: latest,
      barCount: bars.length,
      retrievedAt,
    };
  }

  // ── Phase 1: Read stored bars ─────────────────────────────────────────────
  // Fetch slightly more than requested so freshness and depth can both be
  // evaluated even when the latest bar is today (incomplete candle guard).
  const fetchLimit = Math.max(outputSize + 10, HISTORY_DEPTH.MINIMUM + 10);
  let storedBars: NormalizedDailyBar[] = [];
  try {
    storedBars = await loadStoredBars(symbol, fetchLimit);
  } catch (err: any) {
    // Non-fatal — continue to the external refresh path.
    console.warn(`[market-history] stored bars unavailable for ${symbol}:`, err?.message ?? err);
  }

  // Trim to requested outputSize (loadStoredBars already sorts ascending).
  const trimmedStored = storedBars.slice(-outputSize);
  const latestStored = trimmedStored.length > 0 ? trimmedStored[trimmedStored.length - 1].tradeDate : null;
  const storedFreshness = checkFreshness(latestStored, purposeForFreshness);
  const hasEnoughBars = trimmedStored.length >= Math.min(outputSize, HISTORY_DEPTH.MINIMUM);

  // ── Phase 2: Return stored bars if sufficient ─────────────────────────────
  if (hasEnoughBars && storedFreshness === "fresh") {
    return {
      bars: trimmedStored,
      sourceType: "stored",
      provider: trimmedStored[0]?.provider ?? "twelve_data",
      freshnessStatus: "fresh",
      latestBarDate: latestStored,
      barCount: trimmedStored.length,
      retrievedAt,
    };
  }

  // ── Phase 3: External refresh when missing or stale ───────────────────────
  if (allowRefresh && isExternalRefreshEnabled() && isIngestionAllowed()) {
    try {
      const provider = new TwelveDataDailyProvider();
      const freshBars = await provider.getDailyBars({
        symbol,
        outputSize: Math.max(outputSize, HISTORY_DEPTH.STANDARD_SCAN),
        caller: params.caller ?? "market_history_service",
      });

      // Validate each bar before persisting.
      const validBars: NormalizedDailyBar[] = [];
      let prevClose: number | null = null;
      for (const bar of freshBars) {
        assertProviderAllowed(bar.provider);
        const check = validateBar(bar, { requestedSymbol: symbol, previousClose: prevClose });
        prevClose = bar.close;
        if (!check.valid) {
          console.warn(`[market-history] rejected bar ${symbol} ${bar.tradeDate}: ${check.errors.join("; ")}`);
          continue;
        }
        validBars.push(bar);
      }

      if (validBars.length > 0) {
        await persistValidatedBars(symbol, validBars).catch((err: any) => {
          // Persist failure is non-fatal — we still return the freshly-fetched bars.
          console.warn(`[market-history] persist failed for ${symbol}:`, err?.message ?? err);
        });

        const trimmed = validBars.slice(-outputSize);
        const latest = trimmed.length > 0 ? trimmed[trimmed.length - 1].tradeDate : null;
        return {
          bars: trimmed,
          sourceType: "external_refresh",
          provider: "twelve_data",
          freshnessStatus: checkFreshness(latest, purposeForFreshness),
          latestBarDate: latest,
          barCount: trimmed.length,
          retrievedAt,
        };
      }
    } catch (err: any) {
      // External refresh failed — fall through to stale-stored-bars path.
      console.warn(`[market-history] external refresh failed for ${symbol}:`, err?.message ?? err);
    }
  }

  // ── Phase 4: Return stale stored bars if any exist ────────────────────────
  if (trimmedStored.length > 0) {
    return {
      bars: trimmedStored,
      sourceType: "stored_stale",
      provider: trimmedStored[0]?.provider ?? "twelve_data",
      freshnessStatus: "stale",
      latestBarDate: latestStored,
      barCount: trimmedStored.length,
      retrievedAt,
    };
  }

  // ── Phase 5: Unavailable ──────────────────────────────────────────────────
  throw new MarketDataProviderError(
    `No historical bars available for ${symbol}. Stored bars: 0. External refresh: ${allowRefresh ? "attempted and failed" : "disabled for this call"}.`,
    "EMPTY",
    false,
  );
}

// ---------------------------------------------------------------------------
// Scan readiness check
//
// Evaluates whether the stored-bar universe has sufficient coverage to run
// a broad Opportunity Engine scan. Run this before launching a scan to decide
// whether to proceed, preserve the previous snapshot, or wait for backfill.
// ---------------------------------------------------------------------------

export interface ScanReadiness {
  /** Total symbols configured for internal analysis. */
  universeSize: number;
  /** Symbols with fresh bars meeting STANDARD_SCAN depth. */
  readySymbols: number;
  /** Symbols with stored bars that are beyond the staleness threshold. */
  staleSymbols: number;
  /** Symbols with no stored bars or fewer than MINIMUM bars. */
  missingSymbols: number;
  /** readySymbols / universeSize × 100 (0 when universeSize = 0). */
  coveragePercent: number;
  /** Latest bar trade_date across all ready symbols (YYYY-MM-DD or null). */
  latestCompletedBarDate: string | null;
  /** Human-readable source summary for logs and dashboard. */
  dataSourceSummary: string;
  /** ISO timestamp of when this readiness check was performed. */
  checkedAt: string;
}

export async function checkScanReadiness(refDate = new Date()): Promise<ScanReadiness> {
  const checkedAt = new Date().toISOString();

  // One query: latest bar date and bar count per enabled+internalAnalysis symbol.
  const rows = await db.execute(sql`
    SELECT
      mds.symbol,
      MAX(mdb.trade_date) AS latest_bar_date,
      COUNT(mdb.id)::int AS bar_count
    FROM market_data_symbols mds
    LEFT JOIN market_daily_bars mdb
      ON mdb.symbol = mds.symbol
      AND mdb.is_complete = true
    WHERE mds.enabled = true
      AND mds.internal_analysis_enabled = true
    GROUP BY mds.symbol
    ORDER BY mds.symbol
  `);

  const list: Array<{ symbol: string; latest_bar_date: string | null; bar_count: number }> =
    ((rows as any).rows ?? rows).map((r: any) => ({
      symbol: r.symbol,
      latest_bar_date: r.latest_bar_date,
      bar_count: Number(r.bar_count ?? 0),
    }));

  const universeSize = list.length;
  let readySymbols = 0;
  let staleSymbols = 0;
  let missingSymbols = 0;
  let latestCompletedBarDate: string | null = null;

  for (const row of list) {
    if (row.bar_count < HISTORY_DEPTH.MINIMUM || !row.latest_bar_date) {
      missingSymbols++;
      continue;
    }
    const freshness = checkFreshness(row.latest_bar_date, "scan", refDate);
    if (freshness === "fresh") {
      readySymbols++;
      if (!latestCompletedBarDate || row.latest_bar_date > latestCompletedBarDate) {
        latestCompletedBarDate = row.latest_bar_date;
      }
    } else {
      staleSymbols++;
    }
  }

  const coveragePercent =
    universeSize > 0 ? Math.round((readySymbols / universeSize) * 100) : 0;

  return {
    universeSize,
    readySymbols,
    staleSymbols,
    missingSymbols,
    coveragePercent,
    latestCompletedBarDate,
    dataSourceSummary: "PostgreSQL market_daily_bars (source: twelve_data)",
    checkedAt,
  };
}

// ---------------------------------------------------------------------------
// Minimum recommended coverage threshold before launching a full scan
// ---------------------------------------------------------------------------

/** Scan proceeds normally when coverage is at or above this percentage. */
export const MIN_SCAN_COVERAGE_PCT = 70;

/**
 * Returns true when readiness indicates enough universe coverage for a
 * reliable scan. When false, the Opportunity Engine should preserve the
 * previous valid snapshot rather than producing a misleadingly sparse result.
 */
export function isScanCoverageAdequate(readiness: ScanReadiness): boolean {
  return readiness.coveragePercent >= MIN_SCAN_COVERAGE_PCT && readiness.readySymbols > 0;
}
