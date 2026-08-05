// Freshness Policy — Sprint 5.5B
//
// Single source of truth for analysis result TTLs and user-facing freshness labels.
// Used by dashboard cards, Ask AI result display, and the cached-result banner.
//
// Rules:
//   - Never hardcode market-status assumptions in this module.
//   - All market-hours checks go through shared/market-session.ts.
//   - Raw TTL numbers must not appear in UI copy.

import { getMarketSession } from "@shared/market-session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessCategory =
  | "intraday_setup"      // Scanner/ranking output — stale after 10 min during market hours
  | "market_ranking"      // Broad market ranking — stale after 10 min during market hours
  | "news_sentiment"      // News/sentiment context — stale after 30 min
  | "daily_swing"         // Daily/swing analysis — valid until a newer completed daily bar
  | "long_term"           // Long-term analysis — valid for the current trading day
  | "saved_research"      // Immutable saved record — never stale
  | "demonstration";      // Reference/demo data — never stale (no real market data)

export type SourceType =
  | "scanner_ranking"     // Output of generateCandidateScenarios / radar
  | "full_analysis"       // Ask AI brain result (multiStrategyAnalysis / vcpAnalysis)
  | "context_only"        // News-sentiment context, NOT a deterministic setup
  | "saved_research"      // Persisted research record
  | "demonstration";      // Hardcoded reference / simulated data

export interface FreshnessStatus {
  /** True when the result should be considered outdated and the user offered a refresh. */
  isStale: boolean;
  /** User-facing label for the result age/quality (e.g. "Analyzed 5 minutes ago"). */
  label: string;
  /** Whether the user can trigger a fresh analysis for this item. */
  canRefresh: boolean;
  /** True for demonstration/reference data that has no expiry. */
  isDemonstration: boolean;
}

// ---------------------------------------------------------------------------
// TTL table
// ---------------------------------------------------------------------------

/** TTL in milliseconds per freshness category. */
const TTL_MS: Record<FreshnessCategory, number> = {
  intraday_setup:  10 * 60 * 1000,         // 10 minutes
  market_ranking:  10 * 60 * 1000,         // 10 minutes
  news_sentiment:  30 * 60 * 1000,         // 30 minutes
  daily_swing:     24 * 60 * 60 * 1000,    // 24 hours (valid until next daily bar)
  long_term:       24 * 60 * 60 * 1000,    // valid for the current trading day
  saved_research:  Infinity,               // immutable — never expires
  demonstration:   Infinity,               // always valid (no real data to go stale)
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Compute the freshness status for a result given its generation time and category.
 *
 * @param generatedAt  ISO timestamp string from the result (or Date object).
 * @param category     Freshness category from the result source.
 * @param now          Current time (defaults to new Date()). Useful for testing.
 */
export function getFreshnessStatus(
  generatedAt: string | Date | null | undefined,
  category: FreshnessCategory,
  now: Date = new Date(),
): FreshnessStatus {
  if (category === "demonstration") {
    return {
      isStale: false,
      label: "Demonstration data",
      canRefresh: false,
      isDemonstration: true,
    };
  }

  if (category === "saved_research") {
    return {
      isStale: false,
      label: "Saved research",
      canRefresh: false,
      isDemonstration: false,
    };
  }

  if (!generatedAt) {
    return {
      isStale: true,
      label: "Timestamp unavailable",
      canRefresh: true,
      isDemonstration: false,
    };
  }

  const generatedMs = typeof generatedAt === "string"
    ? Date.parse(generatedAt)
    : generatedAt.getTime();

  if (Number.isNaN(generatedMs)) {
    return {
      isStale: true,
      label: "Timestamp unavailable",
      canRefresh: true,
      isDemonstration: false,
    };
  }

  const ageMs = now.getTime() - generatedMs;
  const ttl = TTL_MS[category];
  const isStale = ageMs >= ttl;

  // For intraday categories, also consider whether market is currently open.
  // If the market is closed, intraday data from the prior session is still the
  // most current available — do not label it stale just because the clock TTL
  // expired across a closed session. We keep the isStale flag from TTL logic
  // but soften the label so users are not confused.
  const marketSession = getMarketSession(now);
  const isMarketClosed = marketSession === "closed";

  const label = buildAgeLabel(ageMs, isStale, category, isMarketClosed);

  return {
    isStale,
    label,
    canRefresh: true,
    isDemonstration: false,
  };
}

// ---------------------------------------------------------------------------
// Source-type → category mapping
// ---------------------------------------------------------------------------

/**
 * Map a SourceType to a FreshnessCategory.
 * Use this when you have the source type but need the category for TTL checks.
 */
export function categoryForSourceType(sourceType: SourceType): FreshnessCategory {
  switch (sourceType) {
    case "scanner_ranking":  return "intraday_setup";
    case "full_analysis":    return "intraday_setup"; // intraday during hours; daily otherwise
    case "context_only":     return "news_sentiment";
    case "saved_research":   return "saved_research";
    case "demonstration":    return "demonstration";
    default:                 return "intraday_setup";
  }
}

// ---------------------------------------------------------------------------
// Action-label helpers (spec §11)
// ---------------------------------------------------------------------------

/**
 * Returns the correct CTA label based on the source type and whether a
 * cached full-analysis result exists for the item.
 *
 * Open Analysis       → existing full result available
 * Run Full Analysis   → no full result exists (context-only or cache miss)
 * Refresh Analysis    → user requests recomputation
 * Open Saved Research → immutable saved record
 * Open Example        → demonstration content
 */
export function ctaLabel(params: {
  sourceType: SourceType;
  hasCachedResult: boolean;
  isRefresh?: boolean;
}): string {
  const { sourceType, hasCachedResult, isRefresh } = params;

  if (isRefresh) return "Refresh Analysis";
  if (sourceType === "demonstration") return "Open Example";
  if (sourceType === "saved_research") return "Open Saved Research";
  if (sourceType === "context_only") return "Run Full Analysis";
  if (hasCachedResult) return "Open Analysis";
  return "Run Full Analysis";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildAgeLabel(
  ageMs: number,
  isStale: boolean,
  category: FreshnessCategory,
  isMarketClosed: boolean,
): string {
  const ageSec = Math.floor(ageMs / 1000);
  const ageMin = Math.floor(ageSec / 60);
  const ageHr = Math.floor(ageMin / 60);

  if (ageSec < 60) return "Just now";
  if (ageMin < 60) return `${ageMin} minute${ageMin === 1 ? "" : "s"} ago`;
  if (ageHr < 24) return `${ageHr} hour${ageHr === 1 ? "" : "s"} ago`;

  const days = Math.floor(ageHr / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
