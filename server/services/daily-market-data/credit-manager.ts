// Persistent (Postgres-backed) Twelve Data credit manager.
// Safety thresholds (7/min, 750/day) sit below the provider limits (8/min,
// 800/day) to preserve reserve capacity. Counters are stored in the
// market_data_credit_usage table via atomic upserts so multiple instances
// share the same budget — never in-memory only.

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { marketDataCreditUsage, marketDataRequestLog } from "@shared/schema";
import { getTwelveDataConfig } from "./config";

export type CreditReservation =
  | { granted: true; minuteUsed: number; dayUsed: number }
  | { granted: false; reason: "minute_limit" | "daily_limit"; retryAfterMs: number; minuteUsed: number; dayUsed: number };

function minuteWindowStart(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d;
}

function dayWindowStart(now = new Date()): Date {
  // Daily quota resets on the provider's UTC day.
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function usedInWindow(windowType: "minute" | "day", windowStart: Date): Promise<number> {
  const rows = await db
    .select({ creditsUsed: marketDataCreditUsage.creditsUsed })
    .from(marketDataCreditUsage)
    .where(
      sql`${marketDataCreditUsage.provider} = 'twelve_data' AND ${marketDataCreditUsage.windowType} = ${windowType} AND ${marketDataCreditUsage.windowStart} = ${windowStart}`,
    );
  return rows[0]?.creditsUsed ?? 0;
}

async function addToWindow(windowType: "minute" | "day", windowStart: Date, credits: number): Promise<void> {
  await db
    .insert(marketDataCreditUsage)
    .values({ provider: "twelve_data", windowType, windowStart, creditsUsed: credits })
    .onConflictDoUpdate({
      target: [marketDataCreditUsage.provider, marketDataCreditUsage.windowType, marketDataCreditUsage.windowStart],
      set: {
        creditsUsed: sql`${marketDataCreditUsage.creditsUsed} + ${credits}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Reserve credits before making a provider request. Returns granted:false with
 * a retry delay when the minute or daily safety threshold would be exceeded.
 */
export async function reserveCredits(credits: number, now = new Date()): Promise<CreditReservation> {
  const cfg = getTwelveDataConfig();
  const minStart = minuteWindowStart(now);
  const dayStart = dayWindowStart(now);

  // Atomic check-and-increment inside a single transaction: ensure both
  // window rows exist, take row locks (FOR UPDATE), validate limits, then
  // increment. Concurrent reservations serialize on the row locks so the
  // safety caps can never be oversubscribed.
  return db.transaction(async (tx) => {
    await tx
      .insert(marketDataCreditUsage)
      .values([
        { provider: "twelve_data", windowType: "minute", windowStart: minStart, creditsUsed: 0 },
        { provider: "twelve_data", windowType: "day", windowStart: dayStart, creditsUsed: 0 },
      ])
      .onConflictDoNothing();

    const rows = await tx.execute(sql`
      SELECT window_type AS "windowType", credits_used AS "creditsUsed"
      FROM market_data_credit_usage
      WHERE provider = 'twelve_data'
        AND ((window_type = 'minute' AND window_start = ${minStart}) OR (window_type = 'day' AND window_start = ${dayStart}))
      FOR UPDATE
    `);
    const list = (rows as any).rows ?? rows;
    const minuteUsed = Number(list.find((r: any) => r.windowType === "minute")?.creditsUsed ?? 0);
    const dayUsed = Number(list.find((r: any) => r.windowType === "day")?.creditsUsed ?? 0);

    if (dayUsed + credits > cfg.dailySafetyLimit) {
      const nextDay = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      return { granted: false as const, reason: "daily_limit" as const, retryAfterMs: nextDay.getTime() - now.getTime(), minuteUsed, dayUsed };
    }
    if (minuteUsed + credits > cfg.minuteSafetyLimit) {
      const nextMinute = new Date(minStart.getTime() + 60_000);
      return { granted: false as const, reason: "minute_limit" as const, retryAfterMs: Math.max(250, nextMinute.getTime() - now.getTime()), minuteUsed, dayUsed };
    }

    await tx.execute(sql`
      UPDATE market_data_credit_usage
      SET credits_used = credits_used + ${credits}, updated_at = now()
      WHERE provider = 'twelve_data'
        AND ((window_type = 'minute' AND window_start = ${minStart}) OR (window_type = 'day' AND window_start = ${dayStart}))
    `);
    return { granted: true as const, minuteUsed: minuteUsed + credits, dayUsed: dayUsed + credits };
  });
}

/** Release credits from a reservation whose request never went out. */
export async function releaseCredits(credits: number, reservedAt = new Date()): Promise<void> {
  await Promise.all([
    addToWindow("minute", minuteWindowStart(reservedAt), -credits),
    addToWindow("day", dayWindowStart(reservedAt), -credits),
  ]);
}

/**
 * Reserve credits, waiting through minute windows if needed (up to maxWaitMs).
 * Stops immediately (throws) if the daily safety limit is reached.
 */
export async function reserveCreditsBlocking(credits: number, maxWaitMs = 180_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const res = await reserveCredits(credits);
    if (res.granted) return;
    if (res.reason === "daily_limit") {
      throw new Error("DAILY_CREDIT_LIMIT_REACHED");
    }
    if (Date.now() + res.retryAfterMs > deadline) {
      throw new Error("CREDIT_WAIT_TIMEOUT");
    }
    await new Promise((r) => setTimeout(r, res.retryAfterMs));
  }
}

export async function getCreditUsageSummary() {
  const cfg = getTwelveDataConfig();
  const now = new Date();
  const [minuteUsed, dayUsed] = await Promise.all([
    usedInWindow("minute", minuteWindowStart(now)),
    usedInWindow("day", dayWindowStart(now)),
  ]);
  return {
    minuteUsed,
    minuteSafetyLimit: cfg.minuteSafetyLimit,
    minuteProviderLimit: cfg.creditsPerMinute,
    dayUsed,
    dailySafetyLimit: cfg.dailySafetyLimit,
    dailyProviderLimit: cfg.dailyCreditLimit,
  };
}

export async function logProviderRequest(entry: {
  endpoint: string;
  endpointWeight?: number;
  symbolsRequested: string[];
  creditsUsed: number;
  status: "success" | "error" | "deferred";
  retryCount?: number;
  durationMs?: number;
  ingestionRunId?: string | null;
  caller?: string;
  errorCode?: string | null;
}): Promise<void> {
  const cfg = getTwelveDataConfig();
  try {
    await db.insert(marketDataRequestLog).values({
      provider: "twelve_data",
      endpoint: entry.endpoint,
      endpointWeight: entry.endpointWeight ?? 1,
      symbolsRequested: entry.symbolsRequested,
      creditsUsed: entry.creditsUsed,
      status: entry.status,
      retryCount: entry.retryCount ?? 0,
      durationMs: entry.durationMs,
      ingestionRunId: entry.ingestionRunId ?? null,
      environment: cfg.environment,
      caller: entry.caller ?? null,
      errorCode: entry.errorCode ?? null,
    });
  } catch (e) {
    console.error("[market-data] failed to write request log:", (e as Error).message);
  }
}
