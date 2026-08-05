// Analysis Result Cache — Sprint 5.5B
//
// User-bound, per-symbol in-process cache for Ask AI results.
// Prevents redundant MCP+GPT calls when a reusable result exists.
//
// Design:
//   - Keyed by (userId, normalizedSymbol)
//   - Max 5 most-recent symbols per user (LRU eviction), 500 total entries
//   - 30-minute TTL per entry (matches conversation-memory TTL)
//   - No raw prompts, no account IDs, no broker tokens, no researchSave handles
//   - Populated by ask.ts after every successful TraderBrain analysis
//   - Queried by GET /api/analysis/cached
//   - Periodic sweep removes expired entries
//
// Privacy rules:
//   - userId is the only sensitive key — never logged externally
//   - No account numbers, positions, raw broker payloads, or evidence IDs
//   - All fields must already be safe for client rendering (same rules as ask.ts response)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Safe subset of AskResponse that may be cached and returned to the client.
 * Strips: researchSave (single-use handle), raw portfolio account details.
 */
export interface SafeAskResult {
  question: string;
  intent: string;
  tickers: string[];
  brokerConnected: boolean;
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
  picks?: unknown[];
  tradeDetail?: unknown | null;
  suggestions?: { label: string; href: string }[];
  source: string;
  disclaimer: string;
  referencesUsed?: { id: string; question: string; category: string }[];
  vcpAnalysis?: unknown;
  vcpScanFailed?: boolean;
  multiStrategyAnalysis?: unknown;
  opportunitySearch?: unknown;
  opportunitySearchFailed?: boolean;
  rankedTradeSearch?: unknown;
  rankedTradeSearchFailed?: boolean;
  rankedSearchSource?: string;
  strategyRecommendation?: unknown;
  recommendationFailed?: boolean;
  // NOTE: portfolioAwareness/portfolioTradePlan intentionally omitted
  // (they reference broker context that may change between calls)
}

export interface AnalysisCacheEntry {
  /** Normalized uppercase symbol (primary ticker). */
  symbol: string;
  /** Intent category derived from the ask response. */
  intent: string;
  /** ISO timestamp when the analysis was generated. */
  generatedAt: string;
  /** Server epoch timestamp for TTL checks. */
  storedAt: number;
  /** The full safe result, ready to render. */
  result: SafeAskResult;
}

export interface CachedAnalysisResponse {
  found: true;
  symbol: string;
  generatedAt: string;
  /** Elapsed seconds since generation. */
  ageSec: number;
  /** True when age exceeds the intraday freshness threshold (10 min). */
  isStale: boolean;
  /** "Analyzed X minutes ago" */
  freshnessLabel: string;
  canRefresh: true;
  result: SafeAskResult;
}

export type CachedAnalysisLookup =
  | CachedAnalysisResponse
  | { found: false };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const TTL_MS = 30 * 60 * 1000;       // 30 minutes absolute expiry
const STALE_MS = 10 * 60 * 1000;     // 10 minutes = intraday freshness threshold
const MAX_PER_USER = 5;               // LRU slots per user
const MAX_TOTAL = 500;                // hard cap across all users

/** Maps userId → ordered array of entries (most-recent last, oldest first). */
const store = new Map<string, AnalysisCacheEntry[]>();

// Periodic sweep every 5 minutes
const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [uid, entries] of store.entries()) {
    const live = entries.filter((e) => now - e.storedAt < TTL_MS);
    if (live.length === 0) {
      store.delete(uid);
    } else if (live.length !== entries.length) {
      store.set(uid, live);
    }
  }
}, 5 * 60 * 1000);
sweepInterval.unref?.();

function totalEntries(): number {
  let n = 0;
  for (const arr of store.values()) n += arr.length;
  return n;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store an analysis result for the given user + symbol.
 * Only stores when the result contains meaningful deterministic analysis
 * (multiStrategyAnalysis, vcpAnalysis, strategyRecommendation, or rankedTradeSearch).
 * Never throws — cache writes are fire-and-forget.
 */
export function storeAnalysisResult(
  userId: string,
  symbol: string,
  result: SafeAskResult,
): void {
  try {
    if (!userId || !symbol) return;
    // Only cache results that have deterministic analysis sections
    const hasMeaningfulAnalysis =
      result.multiStrategyAnalysis ||
      result.vcpAnalysis ||
      result.strategyRecommendation ||
      result.rankedTradeSearch;
    if (!hasMeaningfulAnalysis) return;

    // Enforce total cap
    if (totalEntries() >= MAX_TOTAL) return;

    const sym = symbol.toUpperCase();
    const entry: AnalysisCacheEntry = {
      symbol: sym,
      intent: result.intent ?? "unknown",
      generatedAt: new Date().toISOString(),
      storedAt: Date.now(),
      result,
    };

    const existing = store.get(userId) ?? [];
    // Remove any old entry for this symbol
    const withoutOld = existing.filter((e) => e.symbol !== sym);
    // Append new entry, enforce per-user limit (LRU: drop oldest)
    const updated = [...withoutOld, entry].slice(-MAX_PER_USER);
    store.set(userId, updated);
  } catch {
    // Never let cache writes break a request
  }
}

/**
 * Look up a cached analysis for the given user + symbol.
 * Returns { found: false } when nothing is cached or the entry is expired.
 */
export function lookupAnalysisResult(
  userId: string,
  symbol: string,
): CachedAnalysisLookup {
  const sym = symbol.toUpperCase();
  const entries = store.get(userId);
  if (!entries) return { found: false };

  const now = Date.now();
  const entry = [...entries].reverse().find((e) => e.symbol === sym);
  if (!entry) return { found: false };
  if (now - entry.storedAt >= TTL_MS) return { found: false };

  const ageSec = Math.floor((now - entry.storedAt) / 1000);
  const isStale = now - entry.storedAt >= STALE_MS;

  let freshnessLabel: string;
  if (ageSec < 60) {
    freshnessLabel = "Analyzed just now";
  } else if (ageSec < 3600) {
    const min = Math.floor(ageSec / 60);
    freshnessLabel = `Analyzed ${min} minute${min === 1 ? "" : "s"} ago`;
  } else {
    const hr = Math.floor(ageSec / 3600);
    freshnessLabel = `Analyzed ${hr} hour${hr === 1 ? "" : "s"} ago`;
  }

  return {
    found: true,
    symbol: entry.symbol,
    generatedAt: entry.generatedAt,
    ageSec,
    isStale,
    freshnessLabel,
    canRefresh: true,
    result: entry.result,
  };
}

/**
 * Batch: which of the provided symbols have a cached result for this user?
 * Returns the normalized (uppercase) symbols that have hits.
 * Safe to call with up to 20 symbols.
 */
export function batchLookupSymbols(
  userId: string,
  symbols: string[],
): string[] {
  const entries = store.get(userId);
  if (!entries) return [];

  const now = Date.now();
  const liveSymbols = new Set(
    entries
      .filter((e) => now - e.storedAt < TTL_MS)
      .map((e) => e.symbol),
  );
  return symbols
    .map((s) => s.toUpperCase())
    .filter((s) => liveSymbols.has(s));
}

/**
 * Evict a cached entry for the given user + symbol (called on explicit refresh).
 * Never throws.
 */
export function evictAnalysisResult(userId: string, symbol: string): void {
  try {
    const sym = symbol.toUpperCase();
    const entries = store.get(userId);
    if (!entries) return;
    const updated = entries.filter((e) => e.symbol !== sym);
    if (updated.length === 0) {
      store.delete(userId);
    } else {
      store.set(userId, updated);
    }
  } catch { /* ignore */ }
}

/** Active (non-expired) entry count. For tests/diagnostics only. */
export function activeCacheEntryCount(): number {
  const now = Date.now();
  let n = 0;
  for (const entries of store.values()) {
    n += entries.filter((e) => now - e.storedAt < TTL_MS).length;
  }
  return n;
}

/** Clear all entries. Test helper only. */
export function _clearAllCacheEntries(): void {
  store.clear();
}
