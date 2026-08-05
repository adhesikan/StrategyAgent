// Price Reference Resolver — Task #40
//
// Resolves a trusted reference price for the independent price-integrity
// cross-check. Implements a deterministic precedence chain:
//
//   1. Connected-broker / market-snapshot live quote
//   2. Latest valid completed daily close from VCP Trader's own internal
//      market-history provider (TwelveDataDailyProvider)
//   3. Unavailable
//
// SOURCE INDEPENDENCE NOTE:
// Both the MCP scanner and this resolver may ultimately use Twelve Data as
// the underlying provider. This check is therefore a CROSS-SERVICE
// CONSISTENCY check (MCP vs VCP Trader), not a fully independent vendor
// check. It still catches: MCP-side scaling bugs, serialization errors,
// stale setup-cache values, and transformation errors.
//
// Raw prices (broker quote, history close) are stored only in this module's
// result for server-side diagnostics. Never forward _brokerPrice or
// _historyClose to any client response.

import type { NormalizedDailyBar } from "./daily-market-data/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReferenceSource =
  | "broker_quote"
  | "internal_history_close"
  | "unavailable";

export type FreshnessCategory = "fresh" | "acceptable" | "stale" | "unknown";

export interface ResolvedReference {
  source: ReferenceSource;
  /** Reference price used for the integrity comparison. Null when unavailable. */
  referencePrice: number | null;
  /** ISO date string of the reference (candle date for history, now for quote). */
  referenceTimestamp?: string;
  freshness: FreshnessCategory;
  /**
   * True when both broker quote and history close are valid but materially
   * disagree (ratio outside the conflict tolerance). Block saves when true.
   */
  conflict: boolean;
  /**
   * True when the reference is fresh or acceptable enough to run a ratio
   * comparison against the MCP setup price.
   *
   * False when:
   * - freshness is "stale" (>5 calendar days) — a ratio comparison would
   *   risk misclassifying legitimate long-term price appreciation as a
   *   decimal-order error (e.g. a stock that moved from $89 to $893 over
   *   a year would falsely appear as a 10× scaling bug)
   * - freshness is "unknown" (malformed candle date)
   * - source is "unavailable" (no reference resolved)
   * - conflict is true (neither source trusted)
   *
   * Callers must gate ratio classification on this flag, not freshness alone.
   * A stale higher-priority source must never defeat a fresh lower-priority
   * source for ratio purposes.
   */
  canCompareRatio: boolean;
  /** Server diagnostics only — NEVER forward to client. */
  _brokerPrice?: number;
  _historyClose?: number;
  _historyTimestamp?: string;
}

export interface ReferenceResolverDeps {
  /**
   * Fetches recent daily bars for the symbol.
   * Implementations call TwelveDataDailyProvider.getDailyBars directly
   * (no HTTP round-trip through the public endpoint).
   */
  fetchHistory: (symbol: string) => Promise<NormalizedDailyBar[]>;
  /** Injectable for tests. Defaults to new Date(). */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Freshness policy (calendar-day based; no market-calendar lookup required)
//
// "fresh"      — 0–1 calendar days old (same or previous day)
// "acceptable" — 2–5 calendar days old (covers weekends + short holidays)
// "stale"      — >5 calendar days old
//
// A Friday close is NOT stale on Saturday or Sunday — it falls within the
// "acceptable" window. A stale close is still used as a reference (better
// than nothing), but the limitation is documented.
//
// Known limitation: large overnight gaps (>15%) or corporate actions
// (splits, dividends) may cause a valid comparison to fail even when prices
// are correct on both sides.
// ---------------------------------------------------------------------------

const FRESHNESS_FRESH_DAYS = 1;
const FRESHNESS_ACCEPTABLE_DAYS = 5;

/**
 * Smallest output size that reliably gives us the latest completed candle
 * while minimising API credit consumption.
 */
const HISTORY_OUTPUT_SIZE = 5;

/**
 * Conflict tolerance between broker quote and history close. Using ±40%
 * rather than the setup-vs-reference ±15% to avoid false positives on
 * large-gap days while still catching actual decimal-order errors (2×, 10×).
 */
const CONFLICT_RATIO_LOW = 0.60;   // 0.60× = 40% below history
const CONFLICT_RATIO_HIGH = 1.40;  // 1.40× = 40% above history

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidClose(close: unknown): close is number {
  return typeof close === "number" && Number.isFinite(close) && close > 0;
}

function freshnessFromTradeDate(tradeDate: string, now: Date): FreshnessCategory {
  // tradeDate format: "YYYY-MM-DD"
  const parsed = new Date(`${tradeDate}T12:00:00Z`); // noon UTC to avoid tz edge cases
  if (isNaN(parsed.getTime())) return "unknown";
  const diffMs = now.getTime() - parsed.getTime();
  if (diffMs < 0) return "unknown"; // future-dated → not a completed candle
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  if (diffDays <= FRESHNESS_FRESH_DAYS) return "fresh";
  if (diffDays <= FRESHNESS_ACCEPTABLE_DAYS) return "acceptable";
  return "stale";
}

function isFutureDated(tradeDate: string, now: Date): boolean {
  const parsed = new Date(`${tradeDate}T12:00:00Z`);
  if (isNaN(parsed.getTime())) return false;
  return parsed.getTime() > now.getTime();
}

/**
 * Finds the latest valid completed daily close from a bar array.
 * Skips: non-finite values, zero/negative closes, future-dated candles.
 * Returns null when no valid candle is found.
 */
function latestValidBar(
  bars: NormalizedDailyBar[],
  now: Date,
): { close: number; tradeDate: string } | null {
  // bars are sorted oldest→newest by the provider; iterate newest first
  const sorted = [...bars].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  for (const bar of sorted) {
    if (isFutureDated(bar.tradeDate, now)) continue;
    if (!isValidClose(bar.close)) continue;
    return { close: bar.close, tradeDate: bar.tradeDate };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a trusted reference price for the independent price-integrity check.
 *
 * Precedence:
 * 1. Broker/market-snapshot live quote (quotePrice)
 * 2. Latest valid close from VCP Trader's own market-history provider
 * 3. Unavailable
 *
 * When both sources are available, they are cross-checked. If they disagree
 * by more than ±40%, the result is `{ conflict: true }` — callers should treat
 * this as a data-quality failure and block ResearchSave.
 *
 * @param symbol    — ticker symbol (used for the history fetch)
 * @param quotePrice — live broker/snapshot price (null when disconnected)
 * @param deps       — injectable fetcher + clock for testing
 */
export async function resolveReferencePrice(
  symbol: string,
  quotePrice: number | null | undefined,
  deps: ReferenceResolverDeps,
): Promise<ResolvedReference> {
  const now = deps.now ?? new Date();

  const quoteValid =
    quotePrice != null && Number.isFinite(quotePrice) && quotePrice > 0;

  // Fetch history (best-effort; failure is non-blocking).
  let historyBar: { close: number; tradeDate: string } | null = null;
  try {
    const bars = await deps.fetchHistory(symbol);
    historyBar = latestValidBar(bars, now);
  } catch {
    // Provider unavailable, rate-limited, or symbol not found — treated as no history.
  }

  const historyValid = historyBar !== null;

  // ── Case A: Both sources available ──────────────────────────────────────
  if (quoteValid && historyValid) {
    const ratio = (quotePrice as number) / historyBar!.close;
    if (ratio <= CONFLICT_RATIO_LOW || ratio >= CONFLICT_RATIO_HIGH) {
      // Material disagreement between broker quote and history close.
      // Prefer neither silently — flag conflict. A stale higher-priority
      // source (broker) must not defeat a fresh lower-priority source
      // (history); conflict detection applies regardless of direction.
      return {
        source: "unavailable",
        referencePrice: null,
        freshness: "unknown",
        conflict: true,
        canCompareRatio: false,
        _brokerPrice: quotePrice as number,
        _historyClose: historyBar!.close,
        _historyTimestamp: historyBar!.tradeDate,
      };
    }
    // Consistent — prefer the broker quote (more current).
    return {
      source: "broker_quote",
      referencePrice: quotePrice as number,
      referenceTimestamp: now.toISOString(),
      freshness: "fresh", // live quote is always "fresh"
      conflict: false,
      canCompareRatio: true,
      _brokerPrice: quotePrice as number,
      _historyClose: historyBar!.close,
      _historyTimestamp: historyBar!.tradeDate,
    };
  }

  // ── Case B: Broker quote only ────────────────────────────────────────────
  if (quoteValid && !historyValid) {
    return {
      source: "broker_quote",
      referencePrice: quotePrice as number,
      referenceTimestamp: now.toISOString(),
      freshness: "fresh",
      conflict: false,
      canCompareRatio: true, // live broker quotes are always request-time fresh
      _brokerPrice: quotePrice as number,
    };
  }

  // ── Case C: History only (disconnected user) ─────────────────────────────
  if (!quoteValid && historyValid) {
    const freshness = freshnessFromTradeDate(historyBar!.tradeDate, now);
    // A stale reference must not be used for ratio classification — a
    // legitimate long-term price move would appear as a decimal-order error.
    const canCompareRatio = freshness === "fresh" || freshness === "acceptable";
    return {
      source: "internal_history_close",
      referencePrice: historyBar!.close,
      referenceTimestamp: historyBar!.tradeDate,
      freshness,
      conflict: false,
      canCompareRatio,
      _historyClose: historyBar!.close,
      _historyTimestamp: historyBar!.tradeDate,
    };
  }

  // ── Case D: Neither available ─────────────────────────────────────────────
  return {
    source: "unavailable",
    referencePrice: null,
    freshness: "unknown",
    conflict: false,
    canCompareRatio: false,
  };
}
