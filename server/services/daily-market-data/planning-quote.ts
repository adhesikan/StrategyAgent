/**
 * server/services/daily-market-data/planning-quote.ts
 *
 * Sprint 2.8.7B — Broker-independent equity planning quote adapter.
 *
 * Thin adapter: converts a Twelve Data RealTimeQuote into a canonical
 * PlanningQuoteData for use in execution preflight and Trade Plan Readiness.
 *
 * SAFETY BOUNDARY:
 *   PlanningQuoteData.source = "PLANNING_MARKET_DATA"
 *   This NEVER satisfies execution-grade quote validation.
 *   Execution validation requires a live broker quote (source = "broker").
 *   These two data classes are kept permanently distinct.
 *
 * Data quality thresholds:
 *   "fresh"      — market open AND freshnessSec < FRESH_THRESHOLD_SEC (5 min)
 *   "last_close" — not fresh but freshnessSec < STALE_THRESHOLD_SEC (~25h)
 *                  Normal state overnight, weekends, and extended-hours sessions.
 *   "stale"      — freshnessSec >= STALE_THRESHOLD_SEC (anomalous — missed session)
 *
 * Callers receive null on any error (access denied, provider unavailable,
 * rate limit, malformed payload). Never throws. Never fabricates a price.
 */

import { getRealtimeQuoteForUser } from "./realtime-quote";
import type { PlanningQuoteData } from "@shared/execution-types";

/** 5 minutes — within this window, a quote during an open market is "fresh". */
const FRESH_THRESHOLD_SEC = 300;

/** ~25 hours — beyond this, a quote is anomalously stale (missed a session). */
const STALE_THRESHOLD_SEC = 90_000;

/**
 * Obtain a broker-independent planning quote for an equity symbol.
 *
 * Uses the gated `getRealtimeQuoteForUser` path — Twelve Data access control
 * and credit management are handled internally. The caller supplies userId so
 * the access gate can verify entitlement.
 *
 * Returns null when:
 *   - Twelve Data is disabled, unconfigured, or the user has no access
 *   - The provider returns an error or rate-limit response
 *   - The response payload contains no usable price
 *
 * @param userId  - Authenticated user ID (for access-control gate)
 * @param symbol  - Uppercase equity ticker (e.g. "NVDA")
 * @param now     - Override for test determinism (defaults to current time)
 */
export async function getPlanningQuoteData(
  userId: string,
  symbol: string,
  now: Date = new Date(),
): Promise<PlanningQuoteData | null> {
  try {
    const rt = await getRealtimeQuoteForUser(userId, symbol, "equity_plan_readiness");
    if (!rt) return null;

    // Compute freshness — never substitute fetch time for a missing provider timestamp.
    const asOfMs = Date.parse(rt.asOf);
    const freshnessSec = Number.isFinite(asOfMs)
      ? Math.max(0, Math.round((now.getTime() - asOfMs) / 1000))
      : Infinity;

    // Classify data quality:
    //   "fresh"      — actively trading market, quote < 5 min old
    //   "last_close" — market closed or quote older than 5 min but within 25h
    //                  (normal overnight + weekend state; not anomalous)
    //   "stale"      — > 25h old (anomalous; something is wrong with data feed)
    let dataQuality: PlanningQuoteData["dataQuality"];
    if (rt.isMarketOpen && freshnessSec < FRESH_THRESHOLD_SEC) {
      dataQuality = "fresh";
    } else if (freshnessSec < STALE_THRESHOLD_SEC) {
      dataQuality = "last_close";
    } else {
      dataQuality = "stale";
    }

    return {
      source: "PLANNING_MARKET_DATA",
      provider: "twelve_data",
      symbol: rt.symbol,
      price: rt.last,
      asOf: rt.asOf,
      session: rt.session,
      extendedHours: rt.extendedHours,
      isMarketOpen: rt.isMarketOpen,
      freshnessSec: Number.isFinite(freshnessSec) ? freshnessSec : Infinity,
      dataQuality,
      isStale: dataQuality === "stale",
    };
  } catch {
    // Any error (network, auth, provider) returns null — callers degrade gracefully.
    return null;
  }
}
