// Backfill + daily ingestion for provider-neutral daily market data
// (Phases 7, 9, 10). Uses a Postgres advisory lock so duplicate jobs cannot
// run across instances, upserts bars safely, recalculates indicators, and
// generates internal daily analysis snapshots. The previous valid snapshot is
// preserved until the new snapshot is validated.

import { sql, eq, and, desc, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  marketDataSymbols,
  marketDailyBars,
  marketDataIngestionRuns,
  marketDataIngestionItems,
  dailyIndicators,
  dailyAnalysisSnapshots,
  marketDataLicenseConfig,
} from "@shared/schema";
import { twelveDataProvider } from "./twelve-data-client";
import { validateBar } from "./validation";
import { computeDailyIndicators, CALCULATION_VERSION, type DailyIndicatorSet } from "./indicators";
import { getTwelveDataConfig, isIngestionAllowed } from "./config";
import type { NormalizedDailyBar } from "./types";

const INGESTION_LOCK_KEY = 774_412_001; // arbitrary app-wide lock id

let ingestionPaused = false;
export function setIngestionPaused(paused: boolean) {
  ingestionPaused = paused;
}
export function isIngestionPaused() {
  return ingestionPaused;
}

const SEED_SYMBOLS: Array<{ symbol: string; companyName: string; assetType: string }> = [
  { symbol: "SPY", companyName: "SPDR S&P 500 ETF", assetType: "etf" },
  { symbol: "QQQ", companyName: "Invesco QQQ Trust", assetType: "etf" },
  { symbol: "IWM", companyName: "iShares Russell 2000 ETF", assetType: "etf" },
  { symbol: "DIA", companyName: "SPDR Dow Jones Industrial Average ETF", assetType: "etf" },
  { symbol: "NVDA", companyName: "NVIDIA Corporation", assetType: "equity" },
  { symbol: "MSFT", companyName: "Microsoft Corporation", assetType: "equity" },
  { symbol: "AAPL", companyName: "Apple Inc.", assetType: "equity" },
  { symbol: "AMZN", companyName: "Amazon.com, Inc.", assetType: "equity" },
  { symbol: "GOOGL", companyName: "Alphabet Inc.", assetType: "equity" },
  { symbol: "META", companyName: "Meta Platforms, Inc.", assetType: "equity" },
  { symbol: "AVGO", companyName: "Broadcom Inc.", assetType: "equity" },
  { symbol: "AMD", companyName: "Advanced Micro Devices, Inc.", assetType: "equity" },
  { symbol: "MU", companyName: "Micron Technology, Inc.", assetType: "equity" },
  { symbol: "PLTR", companyName: "Palantir Technologies Inc.", assetType: "equity" },
  { symbol: "ORCL", companyName: "Oracle Corporation", assetType: "equity" },
  { symbol: "JPM", companyName: "JPMorgan Chase & Co.", assetType: "equity" },
  { symbol: "COST", companyName: "Costco Wholesale Corporation", assetType: "equity" },
  { symbol: "WMT", companyName: "Walmart Inc.", assetType: "equity" },
  { symbol: "TSLA", companyName: "Tesla, Inc.", assetType: "equity" },
  { symbol: "XOM", companyName: "Exxon Mobil Corporation", assetType: "equity" },
];

/** Seed the curated universe ONLY if no symbols exist yet. */
export async function seedSymbolUniverseIfEmpty(): Promise<number> {
  const existing = await db.select({ id: marketDataSymbols.id }).from(marketDataSymbols).limit(1);
  if (existing.length > 0) return 0;
  await db.insert(marketDataSymbols).values(
    SEED_SYMBOLS.map((s, i) => ({
      symbol: s.symbol,
      companyName: s.companyName,
      assetType: s.assetType,
      displayOrder: i,
      trialEnabled: true,
      internalAnalysisEnabled: true,
      enabled: true,
    })),
  );
  return SEED_SYMBOLS.length;
}

/** Ensure the license config row exists (env vars remain the final control). */
export async function ensureLicenseConfigRow(): Promise<void> {
  const existing = await db
    .select({ id: marketDataLicenseConfig.id })
    .from(marketDataLicenseConfig)
    .where(eq(marketDataLicenseConfig.provider, "twelve_data"))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(marketDataLicenseConfig).values({
    provider: "twelve_data",
    planName: "basic",
    licenseMode: "prelaunch",
    externalDisplayEnabled: false,
    attributionRequired: true,
    confirmationReference: "Written email confirmation from Twelve Data sales",
    notes:
      "Basic may be used for testing and pre-launch. Venture (or higher external-display plan) required before external user display.",
  });
}

async function tryAcquireLock(): Promise<boolean> {
  const res: any = await db.execute(sql`SELECT pg_try_advisory_lock(${INGESTION_LOCK_KEY}) AS locked`);
  const row = res.rows?.[0] ?? res[0];
  return row?.locked === true;
}

async function releaseLock(): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(${INGESTION_LOCK_KEY})`);
}

type SymbolIngestResult = {
  symbol: string;
  status: "success" | "failed" | "deferred";
  inserted: number;
  updated: number;
  received: number;
  latestTradeDate: string | null;
  errorCode?: string;
  errorMessage?: string;
};

async function upsertBars(symbol: string, bars: NormalizedDailyBar[]): Promise<{ inserted: number; updated: number; latest: string | null }> {
  let inserted = 0;
  let updated = 0;
  let latest: string | null = null;

  // Previous close context for split-jump warnings.
  let prevClose: number | null = null;

  for (const bar of bars) {
    const check = validateBar(bar, { requestedSymbol: symbol, previousClose: prevClose });
    prevClose = bar.close;
    if (!check.valid) {
      console.warn(`[market-data] rejected bar ${symbol} ${bar.tradeDate}: ${check.errors.join("; ")}`);
      continue;
    }
    if (check.warnings.length) {
      console.warn(`[market-data] warning ${symbol} ${bar.tradeDate}: ${check.warnings.join("; ")}`);
    }

    const res = await db
      .insert(marketDailyBars)
      .values({
        symbol,
        tradeDate: bar.tradeDate,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        adjustedClose: bar.adjustedClose != null ? String(bar.adjustedClose) : null,
        volume: bar.volume,
        dataProvider: bar.provider,
        providerTimestamp: bar.providerTimestamp ?? null,
        isComplete: bar.isComplete,
        validatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [marketDailyBars.symbol, marketDailyBars.tradeDate, marketDailyBars.dataProvider],
        set: {
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: bar.volume,
          updatedAt: new Date(),
          validatedAt: new Date(),
          dataVersion: sql`${marketDailyBars.dataVersion} + CASE WHEN ${marketDailyBars.close} <> ${String(bar.close)}::numeric THEN 1 ELSE 0 END`,
        },
      })
      .returning({ dataVersion: marketDailyBars.dataVersion });

    if (res[0]?.dataVersion && res[0].dataVersion > 1) updated++;
    else inserted++;
    if (!latest || bar.tradeDate > latest) latest = bar.tradeDate;
  }
  return { inserted, updated, latest };
}

export async function loadStoredBars(symbol: string, limit = 320): Promise<NormalizedDailyBar[]> {
  const rows = await db
    .select()
    .from(marketDailyBars)
    .where(and(eq(marketDailyBars.symbol, symbol), eq(marketDailyBars.isComplete, true)))
    .orderBy(desc(marketDailyBars.tradeDate))
    .limit(limit);
  return rows
    .reverse()
    .map((r) => ({
      symbol: r.symbol,
      tradeDate: r.tradeDate,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      adjustedClose: r.adjustedClose != null ? Number(r.adjustedClose) : null,
      volume: Number(r.volume),
      provider: r.dataProvider,
      providerTimestamp: r.providerTimestamp,
      isComplete: r.isComplete,
    }));
}

async function saveIndicators(ind: DailyIndicatorSet): Promise<void> {
  const num = (v: number | null) => (v != null && Number.isFinite(v) ? String(v) : null);
  await db
    .insert(dailyIndicators)
    .values({
      symbol: ind.symbol,
      tradeDate: ind.tradeDate,
      sma10: num(ind.sma10),
      sma20: num(ind.sma20),
      sma50: num(ind.sma50),
      sma100: num(ind.sma100),
      sma200: num(ind.sma200),
      ema8: num(ind.ema8),
      ema21: num(ind.ema21),
      rsi14: num(ind.rsi14),
      atr14: num(ind.atr14),
      averageVolume20: ind.averageVolume20,
      relativeVolume: num(ind.relativeVolume),
      return1d: num(ind.return1d),
      return5d: num(ind.return5d),
      return20d: num(ind.return20d),
      historicalVolatility20: num(ind.historicalVolatility20),
      distanceFrom52WeekHigh: num(ind.distanceFrom52WeekHigh),
      trendScore: ind.trendScore,
      momentumScore: ind.momentumScore,
      volumeScore: ind.volumeScore,
      riskScore: ind.riskScore,
      calculationVersion: ind.calculationVersion,
    })
    .onConflictDoUpdate({
      target: [dailyIndicators.symbol, dailyIndicators.tradeDate, dailyIndicators.calculationVersion],
      set: {
        sma10: num(ind.sma10),
        sma20: num(ind.sma20),
        sma50: num(ind.sma50),
        sma200: num(ind.sma200),
        ema8: num(ind.ema8),
        ema21: num(ind.ema21),
        rsi14: num(ind.rsi14),
        atr14: num(ind.atr14),
        averageVolume20: ind.averageVolume20,
        relativeVolume: num(ind.relativeVolume),
        return1d: num(ind.return1d),
        return5d: num(ind.return5d),
        return20d: num(ind.return20d),
        historicalVolatility20: num(ind.historicalVolatility20),
        distanceFrom52WeekHigh: num(ind.distanceFrom52WeekHigh),
        trendScore: ind.trendScore,
        momentumScore: ind.momentumScore,
        volumeScore: ind.volumeScore,
        riskScore: ind.riskScore,
        calculatedAt: new Date(),
      },
    });
}

function gradeFromScore(score: number): string {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  return "C";
}

/** Evaluate built-in daily conditions against the indicator set. */
export function evaluateDailyConditions(ind: DailyIndicatorSet, lastClose: number) {
  const passed: string[] = [];
  const failed: string[] = [];
  const check = (name: string, ok: boolean | null) => {
    if (ok === null) return;
    (ok ? passed : failed).push(name);
  };
  check("Price above SMA 20", ind.sma20 != null ? lastClose > ind.sma20 : null);
  check("Price above SMA 50", ind.sma50 != null ? lastClose > ind.sma50 : null);
  check("Price above SMA 200", ind.sma200 != null ? lastClose > ind.sma200 : null);
  check("SMA 50 above SMA 200", ind.sma50 != null && ind.sma200 != null ? ind.sma50 > ind.sma200 : null);
  check("RSI in healthy range (40-70)", ind.rsi14 != null ? ind.rsi14 >= 40 && ind.rsi14 <= 70 : null);
  check("Relative volume above 1.0", ind.relativeVolume != null ? ind.relativeVolume >= 1 : null);
  check("Within 10% of 52-week high", ind.distanceFrom52WeekHigh != null ? ind.distanceFrom52WeekHigh >= -0.1 : null);
  check("Positive 20-day return", ind.return20d != null ? ind.return20d > 0 : null);
  check(
    "ATR risk acceptable (<6% of price)",
    ind.atr14 != null && lastClose > 0 ? ind.atr14 / lastClose < 0.06 : null,
  );
  return { passed, failed };
}

/** Generate an internal daily analysis snapshot from stored data. */
export async function generateSnapshotForSymbol(symbol: string): Promise<boolean> {
  const bars = await loadStoredBars(symbol, 320);
  if (bars.length < 30) return false;
  const ind = computeDailyIndicators(bars);
  if (!ind) return false;
  await saveIndicators(ind);

  const last = bars[bars.length - 1];
  const { passed, failed } = evaluateDailyConditions(ind, last.close);

  const parts: number[] = [];
  const weight = (v: number | null, w: number) => {
    if (v != null) parts.push(v * w);
  };
  let totalW = 0;
  if (ind.trendScore != null) totalW += 0.3;
  if (ind.momentumScore != null) totalW += 0.3;
  if (ind.volumeScore != null) totalW += 0.2;
  if (ind.riskScore != null) totalW += 0.2;
  weight(ind.trendScore, 0.3);
  weight(ind.momentumScore, 0.3);
  weight(ind.volumeScore, 0.2);
  weight(ind.riskScore, 0.2);
  if (totalW === 0) return false;
  const composite = Math.round(parts.reduce((a, b) => a + b, 0) / totalW);

  const strengths: string[] = [];
  const risks: string[] = [];
  if (ind.trendScore != null && ind.trendScore >= 70) strengths.push("Strong trend alignment above key moving averages");
  if (ind.momentumScore != null && ind.momentumScore >= 70) strengths.push("Positive momentum over the last 20 sessions");
  if (ind.relativeVolume != null && ind.relativeVolume >= 1.3) strengths.push("Elevated relative volume");
  if (ind.distanceFrom52WeekHigh != null && ind.distanceFrom52WeekHigh >= -0.05) strengths.push("Near 52-week high");
  if (ind.riskScore != null && ind.riskScore < 40) risks.push("Elevated historical volatility");
  if (ind.rsi14 != null && ind.rsi14 > 75) risks.push("RSI extended above 75");
  if (ind.trendScore != null && ind.trendScore < 40) risks.push("Price below key moving averages");
  if (strengths.length === 0) strengths.push("Mixed technical picture based on historical daily data");
  if (risks.length === 0) risks.push("Prices and conditions may have changed since the last completed session");

  const setupType =
    ind.distanceFrom52WeekHigh != null && ind.distanceFrom52WeekHigh >= -0.05
      ? "Near-High Continuation"
      : ind.trendScore != null && ind.trendScore >= 70
        ? "Uptrend Pullback Watch"
        : "Neutral / Watch";

  // Insert new snapshot first, then flip isCurrent (previous snapshot is
  // preserved until the new one is fully written).
  const inserted = await db
    .insert(dailyAnalysisSnapshots)
    .values({
      symbol,
      analysisDate: new Date().toISOString().slice(0, 10),
      marketDataAsOf: last.tradeDate,
      compositeScore: composite,
      compositeGrade: gradeFromScore(composite),
      technicalScore: ind.trendScore,
      momentumScore: ind.momentumScore,
      volumeScore: ind.volumeScore,
      trendScore: ind.trendScore,
      riskScore: ind.riskScore,
      conditionsPassed: passed,
      conditionsFailed: failed,
      setupType,
      summary: `Historical daily analysis through ${last.tradeDate}. Composite ${composite} (${gradeFromScore(composite)}), ${passed.length}/${passed.length + failed.length} conditions passed.`,
      strengths,
      risks,
      dataProvider: "twelve_data",
      calculationVersion: CALCULATION_VERSION,
      accessScope: "internal",
      publishedAt: new Date(),
      isCurrent: false,
    })
    .returning({ id: dailyAnalysisSnapshots.id });

  const newId = inserted[0]?.id;
  if (!newId) return false;
  await db
    .update(dailyAnalysisSnapshots)
    .set({ isCurrent: false })
    .where(and(eq(dailyAnalysisSnapshots.symbol, symbol), eq(dailyAnalysisSnapshots.isCurrent, true)));
  await db.update(dailyAnalysisSnapshots).set({ isCurrent: true }).where(eq(dailyAnalysisSnapshots.id, newId));
  return true;
}

async function ingestSymbol(
  sym: { symbol: string; backfillYears: number },
  runId: string,
  mode: "backfill" | "daily",
): Promise<SymbolIngestResult> {
  const itemStart = new Date();
  try {
    let startDate: string | undefined;
    if (mode === "backfill") {
      const years = Math.min(Math.max(sym.backfillYears || 2, 1), 5);
      const d = new Date();
      d.setFullYear(d.getFullYear() - years);
      startDate = d.toISOString().slice(0, 10);
    } else {
      // Small recent window (last stored date minus 7 days) to catch corrections.
      const latest = await db
        .select({ tradeDate: marketDailyBars.tradeDate })
        .from(marketDailyBars)
        .where(eq(marketDailyBars.symbol, sym.symbol))
        .orderBy(desc(marketDailyBars.tradeDate))
        .limit(1);
      if (latest[0]) {
        const d = new Date(latest[0].tradeDate + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 7);
        startDate = d.toISOString().slice(0, 10);
      } else {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 2);
        startDate = d.toISOString().slice(0, 10);
      }
    }

    const bars = await twelveDataProvider.getDailyBars({
      symbol: sym.symbol,
      startDate,
      caller: `ingestion:${mode}`,
      ingestionRunId: runId,
    });
    const { inserted, updated, latest } = await upsertBars(sym.symbol, bars);

    await db
      .update(marketDataSymbols)
      .set({
        lastSuccessfulIngestionAt: new Date(),
        latestAvailableTradeDate: latest,
        updatedAt: new Date(),
      })
      .where(eq(marketDataSymbols.symbol, sym.symbol));

    await generateSnapshotForSymbol(sym.symbol);

    await db.insert(marketDataIngestionItems).values({
      ingestionRunId: runId,
      symbol: sym.symbol,
      status: "success",
      creditsUsed: 1,
      recordsReceived: bars.length,
      recordsInserted: inserted,
      recordsUpdated: updated,
      latestTradeDate: latest,
      startedAt: itemStart,
      completedAt: new Date(),
    });
    return { symbol: sym.symbol, status: "success", inserted, updated, received: bars.length, latestTradeDate: latest };
  } catch (e: any) {
    const code = e?.code || (e?.message === "DAILY_CREDIT_LIMIT_REACHED" ? "QUOTA" : "UNKNOWN");
    await db.insert(marketDataIngestionItems).values({
      ingestionRunId: runId,
      symbol: sym.symbol,
      status: code === "QUOTA" ? "deferred" : "failed",
      errorCode: String(code),
      errorMessage: String(e?.message || e).slice(0, 500),
      startedAt: itemStart,
      completedAt: new Date(),
    });
    return {
      symbol: sym.symbol,
      status: code === "QUOTA" ? "deferred" : "failed",
      inserted: 0,
      updated: 0,
      received: 0,
      latestTradeDate: null,
      errorCode: String(code),
      errorMessage: String(e?.message || e),
    };
  }
}

export async function runIngestion(options: {
  runType: "backfill" | "daily" | "manual";
  symbols?: string[]; // limit to specific symbols
  initiatedBy?: string;
}): Promise<{ runId: string | null; status: string; results: SymbolIngestResult[] }> {
  if (!isIngestionAllowed()) {
    return { runId: null, status: "disabled", results: [] };
  }
  if (ingestionPaused && options.runType !== "manual") {
    return { runId: null, status: "paused", results: [] };
  }
  if (!(await tryAcquireLock())) {
    return { runId: null, status: "locked", results: [] };
  }

  const cfg = getTwelveDataConfig();
  try {
    await seedSymbolUniverseIfEmpty();
    await ensureLicenseConfigRow();

    let symbolRows = await db
      .select()
      .from(marketDataSymbols)
      .where(eq(marketDataSymbols.enabled, true))
      .orderBy(asc(marketDataSymbols.displayOrder));
    if (options.symbols?.length) {
      const wanted = new Set(options.symbols.map((s) => s.toUpperCase()));
      symbolRows = symbolRows.filter((s) => wanted.has(s.symbol.toUpperCase()));
    }

    const run = await db
      .insert(marketDataIngestionRuns)
      .values({
        provider: "twelve_data",
        runType: options.runType === "manual" ? "manual" : options.runType,
        environment: cfg.environment,
        status: "running",
        symbolsRequested: symbolRows.length,
        initiatedBy: options.initiatedBy ?? null,
      })
      .returning({ id: marketDataIngestionRuns.id });
    const runId = run[0].id;

    const results: SymbolIngestResult[] = [];
    const mode = options.runType === "backfill" ? "backfill" : "daily";
    for (const sym of symbolRows) {
      const r = await ingestSymbol({ symbol: sym.symbol, backfillYears: sym.backfillYears }, runId, mode);
      results.push(r);
      if (r.errorCode === "QUOTA" || r.errorMessage === "DAILY_CREDIT_LIMIT_REACHED") {
        // Stop optional ingestion when daily safety limit is hit; resumable later.
        break;
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const deferred = results.some((r) => r.status === "deferred");
    const status =
      deferred && succeeded < symbolRows.length
        ? "deferred_quota"
        : failed > 0 && succeeded > 0
          ? "partially_completed"
          : failed > 0 && succeeded === 0
            ? "failed"
            : "completed";

    await db
      .update(marketDataIngestionRuns)
      .set({
        status,
        completedAt: new Date(),
        symbolsSucceeded: succeeded,
        symbolsFailed: failed,
        creditsUsed: results.length,
        recordsInserted: results.reduce((a, r) => a + r.inserted, 0),
        recordsUpdated: results.reduce((a, r) => a + r.updated, 0),
        errorSummary:
          failed > 0
            ? results
                .filter((r) => r.status === "failed")
                .map((r) => `${r.symbol}: ${r.errorCode}`)
                .join("; ")
                .slice(0, 900)
            : null,
      })
      .where(eq(marketDataIngestionRuns.id, runId));

    // Fire-and-forget internal research report email summarizing the ingestion run.
    const reportTo = process.env.ADMIN_SUPPORT_NOTIFICATION_EMAIL || process.env.EMAIL_FORWARD_ADDRESS;
    if (reportTo && results.length > 0) {
      (async () => {
        const { sendResearchReportEmail } = await import("../email/email-service");
        const inserted = results.reduce((a, r) => a + r.inserted, 0);
        const updated = results.reduce((a, r) => a + r.updated, 0);
        const summary = [
          `Daily market data ingestion finished with status: ${status}.`,
          `Symbols succeeded: ${succeeded}, failed: ${failed}, credits used: ${results.length}.`,
          `Records inserted: ${inserted}, updated: ${updated}.`,
          failed > 0
            ? `Failures: ${results.filter((r) => r.status === "failed").map((r) => `${r.symbol} (${r.errorCode})`).join(", ")}`
            : "No failures.",
        ].join("\n");
        await sendResearchReportEmail(reportTo, `Daily Market Data Report — ${status}`, summary);
      })().catch((err) => console.warn("[Ingestion] Research report email failed:", err?.message || err));
    }

    return { runId, status, results };
  } finally {
    await releaseLock();
  }
}

// --- US market holiday calendar (NYSE full-day closures) ---

function easterSunday(year: number): Date {
  // Anonymous Gregorian computus.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const dd = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7);
}

/** Observed date for a fixed-date holiday: Sat -> Friday, Sun -> Monday. */
function observed(year: number, month: number, day: number): [number, number] {
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay();
  if (dow === 6) return [month, day - 1];
  if (dow === 0) return [month, day + 1];
  return [month, day];
}

function usMarketHolidays(year: number): Set<string> {
  const set = new Set<string>();
  const add = (month: number, day: number) =>
    set.add(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  const addObserved = (month: number, day: number) => {
    const [m, d] = observed(year, month, day);
    if (d >= 1) add(m, d); // New Year observed on prior Dec 31 falls in prior year — skip
  };
  addObserved(0, 1); // New Year's Day
  add(0, nthWeekdayOfMonth(year, 0, 1, 3)); // MLK Day (3rd Mon Jan)
  add(1, nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents' Day (3rd Mon Feb)
  const easter = easterSunday(year); // Good Friday
  const gf = new Date(easter.getTime() - 2 * 86400_000);
  add(gf.getUTCMonth(), gf.getUTCDate());
  add(4, lastWeekdayOfMonth(year, 4, 1)); // Memorial Day (last Mon May)
  addObserved(5, 19); // Juneteenth
  addObserved(6, 4); // Independence Day
  add(8, nthWeekdayOfMonth(year, 8, 1, 1)); // Labor Day (1st Mon Sep)
  add(10, nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving (4th Thu Nov)
  addObserved(11, 25); // Christmas
  return set;
}

/** True on expected US trading days (ET weekday, not an NYSE full-day holiday). */
export function isExpectedTradingDay(d = new Date()): boolean {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = et.getDay();
  if (dow === 0 || dow === 6) return false;
  const key = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  return !usMarketHolidays(et.getFullYear()).has(key);
}
