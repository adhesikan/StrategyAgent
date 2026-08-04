// Types + pure presentation helpers for the deterministic ranked market
// trade search (MCP rank_market_trade_candidates). Presentation and
// navigation only — the frontend never generates, reorders, or promotes
// candidates, and never opens the Trade Builder automatically.

import { askRoute } from "@/lib/command-center";

export interface RankedTradeCandidate {
  rank: number;
  symbol: string;
  strategy?: string;
  setupStatus?: string;
  instrument?: string;
  structure?: string;
  trigger?: string;
  invalidation?: string;
  objective?: string;
  rewardRisk?: number;
  maxRisk?: number;
  /** true only when maxRisk derives from live, real contract/stop data. */
  maxRiskIsExact?: boolean;
  quantity?: number;
  confidence?: string;
  dataQuality?: string;
  fitsRiskBudget?: boolean;
  whySelected: string[];
  warnings: string[];
  /**
   * Raw scanner score for this setup (pattern quality / stage confidence).
   * Distinct from rank — a high-scoring setup may rank lower than a lower-
   * scoring one because rank also weights trigger availability, risk fit,
   * data completeness, and freshness.
   */
  strategyScore?: number;
  /**
   * Last known price for the underlying (used by triggerStatusLabel to
   * determine whether the trigger has already been crossed).
   */
  currentPrice?: number;
  /**
   * "price"  — trigger is a specific price level (breakout above $X).
   * "event"  — trigger requires a non-price event (earnings beat, gap-up
   *            open, opening-range breakout). "Trigger confirmed" / "Awaiting
   *            breakout" do not apply; "Event confirmation required" is shown.
   * Absent   — treat as "price" (backward compat with MCP responses that
   *            don't include this field).
   */
  triggerType?: "price" | "event";
}

export interface RankedWatchCandidate {
  symbol: string;
  strategy?: string;
  currentStage?: string;
  missingConfirmation?: string;
  watchConditions: string[];
}

export interface RankedRejectionGroup {
  reason: string;
  count: number;
  symbols: string[];
}

/** Pre-confluence exclusion — happens BEFORE bucket assignment.
 *  Not a quality rejection; an excluded opportunity never reached qualification. */
export interface RankedExclusionGroup {
  reason: string;
  count: number;
}

export interface RankedTradeSearch {
  request: Record<string, unknown>;
  /** RAW stored opportunities reviewed — NOT the post-confluence population. */
  reviewedCount: number;
  /** Confluence groups formed from stored opportunities (0 = nothing passed pre-qualification). */
  groupedCandidateCount?: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  unavailableCount: number;
  /** Opportunities excluded BEFORE confluence/qualification — not the same as rejection. */
  excludedCount?: number;
  /** Breakdown of why opportunities were excluded before qualification. */
  exclusionSummary?: RankedExclusionGroup[];
  candidates: RankedTradeCandidate[];
  watchCandidates: RankedWatchCandidate[];
  rejectionSummary: RankedRejectionGroup[];
  generatedAt: string;
  warnings: string[];
  maxRiskDollars?: number;
}

export interface RankedCta {
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * Trade Builder is offered ONLY for a qualified candidate that is
 * actionable, fresh, real-data, and complete (spec §9). Missing or unknown
 * information disables it — never the other way around.
 */
export function tradeBuilderEligible(c: RankedTradeCandidate): boolean {
  if (!c.symbol) return false;
  // Complete: entry/exit framing plus sizing must all be present.
  if (!c.trigger || !c.invalidation || c.maxRisk == null || c.quantity == null) return false;
  // Real data: an explicit dataQuality that is estimated/partial/stale/mock
  // disqualifies; absent dataQuality is UNKNOWN → not eligible.
  if (!c.dataQuality || /estimat|partial|mock|stale|unavailable/i.test(c.dataQuality)) return false;
  // Fresh/actionable: an explicit stale or non-actionable status disqualifies.
  if (c.setupStatus && /stale|expired|invalid|rejected|watch/i.test(c.setupStatus)) return false;
  // A stated risk-budget miss disqualifies.
  if (c.fitsRiskBudget === false) return false;
  return true;
}

/** CTAs for a qualified candidate. Never auto-navigates anywhere. */
export function qualifiedCtas(c: RankedTradeCandidate): RankedCta[] {
  const sym = c.symbol.toUpperCase();
  const out: RankedCta[] = [
    { label: "Analyze", href: askRoute(`Analyze ${sym}`), primary: true },
    { label: "Review Trade", href: `/market-intel?symbol=${sym}` },
    { label: "Risk Details", href: askRoute(`What is the risk on the ${sym} setup?`) },
  ];
  if (tradeBuilderEligible(c)) out.push({ label: "Open Trade Builder", href: `/trade/${sym}` });
  return out;
}

/** CTAs for a watch candidate — never the Trade Builder. */
export function watchCtas(w: RankedWatchCandidate): RankedCta[] {
  const sym = w.symbol.toUpperCase();
  return [
    { label: "Analyze", href: askRoute(`Analyze ${sym}`), primary: true },
    { label: "Add to Watchlist", href: `/watchlist?add=${sym}` },
    { label: "View Setup", href: `/market-intel?symbol=${sym}` },
    { label: "Open Scanner", href: "/scanner" },
  ];
}

/** CTAs when ranking is limited by unavailable data. */
export function unavailableCtas(question: string): RankedCta[] {
  return [
    { label: "Retry", href: askRoute(question), primary: true },
    { label: "Open Scanner", href: "/scanner" },
  ];
}

/** CTAs when all opportunities were excluded before qualification (no triggers, stale, etc.).
 *  Never includes the Trade Builder — no candidate was produced. */
export function exclusionCtas(): RankedCta[] {
  return [
    { label: "Open Scanner", href: "/scanner", primary: true },
    { label: "Review Watchlist", href: "/watchlist" },
    { label: "Run a Fresh Scan", href: "/scanner?run=1" },
    { label: "View Stored Setups", href: "/opportunities" },
  ];
}

// ---------------------------------------------------------------------------
// §2 — Source state type (drives fallback-banner logic in ask.tsx)
// ---------------------------------------------------------------------------

/**
 * Explicit source state for the ranked trade search result.
 *
 * RANKED_MCP_SUCCESS          — rank_market_trade_candidates returned ≥1 candidate or watch entry.
 * RANKED_MCP_EMPTY            — rank_market_trade_candidates returned successfully but all buckets empty.
 * RANKED_MCP_FAILED_WITH_FALLBACK — the MCP call threw; the UI is showing a standard-search fallback.
 * STANDARD_SEARCH             — the request was routed to opportunity-search (no ranked call attempted).
 * RULE_BASED_SUMMARY          — fully deterministic rule-based answer (no LLM, no MCP call).
 */
export type RankedSearchSource =
  | "RANKED_MCP_SUCCESS"
  | "RANKED_MCP_EMPTY"
  | "RANKED_MCP_FAILED_WITH_FALLBACK"
  | "STANDARD_SEARCH"
  | "RULE_BASED_SUMMARY";

// ---------------------------------------------------------------------------
// §3 — Trigger-state helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the candidate has an actionable trigger field.
 * A trigger is actionable when the `trigger` string is present and non-empty.
 * Absent trigger → false; present → true (regardless of current price).
 *
 * "Entry Trigger Missing" must NEVER be shown when this returns true.
 */
export function hasActionableTrigger(c: RankedTradeCandidate): boolean {
  return typeof c.trigger === "string" && c.trigger.trim().length > 0;
}

/**
 * Human-readable trigger status label for display in cards.
 *
 * Rules:
 *  - triggerType === "event"  → "Event confirmation required"
 *  - no trigger               → "No trigger"
 *  - currentPrice >= trigger  → "Trigger confirmed"   (price already crossed)
 *  - currentPrice < trigger   → "Awaiting breakout"
 *  - trigger present but currentPrice unknown → "Awaiting breakout" (conservative default)
 *
 * The trigger field is a free-form string from MCP so we extract a price
 * from it with a best-effort regex; if we can't find one we fall back to
 * "Awaiting breakout" rather than "Entry Trigger Missing".
 */
export function triggerStatusLabel(c: RankedTradeCandidate): string {
  if (!hasActionableTrigger(c)) return "No trigger";
  if (c.triggerType === "event") return "Event confirmation required";

  // Best-effort price extraction from the trigger string (e.g. "Break above 190.50").
  const match = /[\d,]+(?:\.\d+)?/.exec(c.trigger!.replace(/,/g, ""));
  const triggerPrice = match ? parseFloat(match[0]) : null;

  if (triggerPrice != null && c.currentPrice != null) {
    return c.currentPrice >= triggerPrice ? "Trigger confirmed" : "Awaiting breakout";
  }
  return "Awaiting breakout";
}

// ---------------------------------------------------------------------------
// §6 — NO_TRADE specific reason labels
// ---------------------------------------------------------------------------

/**
 * Maps MCP rejection-reason codes to trader-facing chip labels.
 * Used in strategy-recommendation-cards and multi-strategy-analysis-cards
 * so traders see a specific reason rather than only the generic NO_TRADE verdict.
 */
export const NO_TRADE_REASON_LABELS: Record<string, string> = {
  WAITING_FOR_TRIGGER:  "Waiting for Trigger",
  RISK_LIMIT_EXCEEDED:  "Risk Limit Exceeded",
  EARNINGS_RISK:        "Earnings Risk",
  STALE_SETUP:          "Stale Setup",
  DATA_UNAVAILABLE:     "Data Unavailable",
  DIRECTION_CONFLICT:   "Direction Conflict",
  NO_VALID_SETUP:       "No Valid Setup",
  UNSUPPORTED_STRUCTURE: "Unsupported Structure",
};

/**
 * Returns a specific trader-facing label for a NO_TRADE / WATCH rejection reason code,
 * or null when the reason is absent or generic (so callers can choose not to render a chip).
 */
export function translateNoTradeReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  // Exact match first.
  if (NO_TRADE_REASON_LABELS[reason]) return NO_TRADE_REASON_LABELS[reason];
  // Prefix match for reason codes with suffixes (e.g. "EARNINGS_RISK:NVDA").
  for (const [key, label] of Object.entries(NO_TRADE_REASON_LABELS)) {
    if (reason.startsWith(key)) return label;
  }
  return null;
}

/** Human-readable label for a known MCP exclusion reason code. */
export function translateExclusionReason(reason: string): string {
  switch (reason) {
    case "NOT_ACTIONABLE_NO_TRIGGER":      return "No actionable trigger was available";
    case "STALE":                          return "Stored setup was stale";
    case "DIRECTION_MISMATCH":             return "Setup direction did not match the request";
    case "INVALID_SETUP":                  return "Stored setup was not structurally valid";
    case "SIMULATED_DATA_NOT_ELIGIBLE":    return "Only simulated data was available";
    default:
      return reason.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Honest counts line. reviewedCount is labeled as raw stored opportunities
 *  reviewed and is never implied to equal the bucket population. */
export function rankedCountsLine(s: RankedTradeSearch): string {
  const parts = [
    `${s.reviewedCount} stored ${s.reviewedCount === 1 ? "opportunity" : "opportunities"} reviewed`,
    ...(s.groupedCandidateCount !== undefined ? [`${s.groupedCandidateCount} post-confluence`] : []),
    `${s.qualifiedCount} qualified`,
    ...(s.excludedCount !== undefined && s.excludedCount > 0 ? [`${s.excludedCount} excluded`] : []),
    ...(s.watchCount > 0 ? [`${s.watchCount} worth watching`] : []),
    ...(s.rejectedCount > 0 ? [`${s.rejectedCount} rejected`] : []),
    ...(s.unavailableCount > 0 ? [`${s.unavailableCount} unavailable`] : []),
  ];
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// §7 — Rejection reason translation + "what would make it actionable"
// ---------------------------------------------------------------------------

/**
 * Maps internal MCP rejection-reason codes to plain trader-facing language.
 * Never exposes implementation wording ("underlying market data unavailable").
 */
export const REJECTION_REASON_LABELS: Record<string, string> = {
  WAITING_FOR_TRIGGER:               "Trigger not yet reached",
  RISK_LIMIT_EXCEEDED:               "Exceeds risk limit",
  EARNINGS_RISK:                     "Earnings event pending",
  STALE_SETUP:                       "Setup has gone stale",
  DATA_UNAVAILABLE:                  "Required market confirmation missing",
  DIRECTION_CONFLICT:                "Direction conflict with market regime",
  NO_VALID_SETUP:                    "No valid setup detected",
  UNSUPPORTED_STRUCTURE:             "Structure not yet supported",
  // Internal implementation terms that must never surface verbatim:
  UNDERLYING_MARKET_DATA_UNAVAILABLE: "Required market confirmation missing",
  OPTIONS_DATA_UNAVAILABLE:          "Options data unavailable",
  MARKET_REGIME_UNAVAILABLE:         "Market regime unavailable",
  DATA_FRESHNESS_INSUFFICIENT:       "Data freshness insufficient",
  CANDIDATE_CONFIRMATION_UNAVAILABLE: "Candidate confirmation unavailable",
};

/** Returns a trader-facing rejection reason label, never the raw MCP code. */
export function translateRejectionReason(reason: string): string {
  if (!reason) return reason;
  // Exact match.
  if (REJECTION_REASON_LABELS[reason]) return REJECTION_REASON_LABELS[reason];
  // Prefix match for reason codes with suffixes (e.g. "EARNINGS_RISK:NVDA").
  for (const [key, label] of Object.entries(REJECTION_REASON_LABELS)) {
    if (reason.startsWith(key + ":") || reason === key) return label;
  }
  // Fallback: humanize the code so internal wording is never shown verbatim.
  return reason
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns a short "what would make this actionable" hint for a rejection
 * reason code, or null when no specific hint is known.
 */
export function actionableHint(reason: string): string | null {
  // Strip any per-symbol suffix (e.g. "EARNINGS_RISK:NVDA" → "EARNINGS_RISK")
  const base = reason.split(":")[0].trim();
  switch (base) {
    case "WAITING_FOR_TRIGGER":
      return "Wait for the price to reach the entry trigger level";
    case "RISK_LIMIT_EXCEEDED":
      return "Reduce the requested risk budget, or ask about smaller defined-risk setups";
    case "EARNINGS_RISK":
      return "Wait until the earnings event passes";
    case "STALE_SETUP":
      return "Wait for the scanner to detect a fresh setup";
    case "DATA_UNAVAILABLE":
    case "UNDERLYING_MARKET_DATA_UNAVAILABLE":
      return "Wait for market data to become available from the provider";
    case "DIRECTION_CONFLICT":
      return "Look for setups aligned with the current market regime";
    case "NO_VALID_SETUP":
      return "Wait for the scanner to detect a valid pattern";
    case "UNSUPPORTED_STRUCTURE":
      return "Try a different instrument type or structure";
    case "OPTIONS_DATA_UNAVAILABLE":
      return "Connect a broker with live options data, or ask about equity setups instead";
    case "MARKET_REGIME_UNAVAILABLE":
      return "Wait for market regime data to become available";
    case "DATA_FRESHNESS_INSUFFICIENT":
      return "Wait for fresh data — stored setup data may be outdated";
    case "CANDIDATE_CONFIRMATION_UNAVAILABLE":
      return "Wait for full confirmation data to become available";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// §8 — Empty-state helpers (4 distinct states per spec §2)
// ---------------------------------------------------------------------------

/**
 * Describes the visual empty state for a ranked search that produced no
 * actionable candidates. Includes headline, subtitle, icon key, and CTAs.
 * The icon key is a logical name; the component maps it to a Lucide icon.
 */
export interface RankedEmptyState {
  headline: string;
  subtitle: string;
  /** Logical icon key — the rendering component maps this to a Lucide icon. */
  icon: "no-results" | "not-yet" | "market-unavailable" | "fallback";
  cta: RankedCta[];
}

/**
 * Derives the correct empty state for a ranked search result.
 *
 * Returns null when there ARE qualified candidates or watches (not an empty
 * state — the cards should render normally). Returns a state for the four
 * spec-defined cases:
 *
 * A) No opportunities detected (reviewedCount = 0 or no setups found)
 * B) Opportunities detected but none qualify (setups reviewed, all rejected/excluded)
 * C) Market unavailable (data could not be retrieved)
 * D) Fallback (MCP failed, showing standard search)
 *
 * The RANKED_MCP_FAILED_WITH_FALLBACK source drives case D; all other empty
 * states are derived from the payload. The function never returns D from the
 * payload alone — source must be explicitly RANKED_MCP_FAILED_WITH_FALLBACK.
 */
export function buildEmptyState(
  search: RankedTradeSearch | undefined,
  source: string | undefined,
  question?: string,
): RankedEmptyState | null {
  // Case D: explicit MCP failure with fallback — shown before the standard
  // search results. The banner in ask.tsx handles this; this function
  // returns the empty-state card shown INSTEAD of search cards.
  if (source === "RANKED_MCP_FAILED_WITH_FALLBACK") {
    return {
      headline: "Ranking temporarily unavailable",
      subtitle: "The trade-ranking engine could not be reached. Showing the standard opportunity search instead.",
      icon: "fallback",
      cta: [
        { label: "Retry", href: askRoute(question ?? "Find the best trades today"), primary: true },
        { label: "Open Scanner", href: "/scanner" },
      ],
    };
  }

  // If there ARE candidates or watches, this is not an empty state.
  if (search && (search.candidates.length > 0 || search.watchCandidates.length > 0)) return null;
  // No search payload at all → no state to derive.
  if (!search) return null;

  // Case C: market data could not be retrieved (all or nearly all setups had
  // unavailable data, and nothing qualified).
  const hasUnavailable = search.unavailableCount > 0;
  const hasNoQualified = search.qualifiedCount === 0;
  const dataOnlyIssue =
    hasUnavailable && hasNoQualified && search.rejectedCount === 0 && search.candidates.length === 0;
  if (dataOnlyIssue) {
    return {
      headline: "Live market information could not be retrieved",
      subtitle: `${search.unavailableCount} ${search.unavailableCount === 1 ? "setup" : "setups"} could not be evaluated because market data was unavailable. Nothing was fabricated to fill the gap.`,
      icon: "market-unavailable",
      cta: [
        { label: "Retry", href: askRoute(question ?? "Find the best trades today"), primary: true },
        { label: "Open Scanner", href: "/scanner" },
      ],
    };
  }

  // Case B: setups were reviewed but none qualify (rejections, exclusions, or
  // watches only — no actionable candidates).
  const reviewedSomething =
    search.reviewedCount > 0 ||
    search.rejectedCount > 0 ||
    (search.excludedCount ?? 0) > 0 ||
    search.watchCandidates.length > 0;
  if (reviewedSomething) {
    const total =
      search.rejectedCount +
      (search.excludedCount ?? 0) +
      (search.groupedCandidateCount ?? 0);
    const totalLabel = total > 0 ? `${total} ${total === 1 ? "setup was" : "setups were"} reviewed` : "Setups were reviewed";
    return {
      headline: `${totalLabel}, but none currently qualify`,
      subtitle:
        "No setups met the required confirmation checks. Review the details below, or check back as market conditions change.",
      icon: "not-yet",
      cta: [
        { label: "Open Scanner", href: "/scanner", primary: true },
        { label: "Review Watchlist", href: "/watchlist" },
        { label: "Run a Fresh Scan", href: "/scanner?run=1" },
      ],
    };
  }

  // Case A: true zero — no stored setups matched the criteria at all.
  return {
    headline: "No opportunities detected",
    subtitle: "No stored setups matched the current criteria.",
    icon: "no-results",
    cta: [
      { label: "Open Scanner", href: "/scanner", primary: true },
      { label: "Run a Fresh Scan", href: "/scanner?run=1" },
      { label: "Review Watchlist", href: "/watchlist" },
    ],
  };
}

/** Risk-fit line for a candidate under a requested budget (spec §8).
 *  Options candidates without exact (live) risk never claim an exact max
 *  loss — returns an "estimated" phrasing instead. */
export function riskFitLine(c: RankedTradeCandidate, requestedMax?: number): string | null {
  if (c.maxRisk == null) return null;
  const amount = `$${c.maxRisk.toLocaleString("en-US")}`;
  const label = c.maxRiskIsExact ? `Max risk ${amount}` : `Estimated max risk ${amount} (not an exact figure)`;
  if (requestedMax == null) return label;
  const fits = c.fitsRiskBudget ?? (c.maxRiskIsExact ? c.maxRisk <= requestedMax : undefined);
  const fitText = fits === true ? "fits" : fits === false ? "exceeds" : "compare against";
  return `${label} — ${fitText} the requested $${requestedMax.toLocaleString("en-US")} limit${c.quantity != null ? ` at ${c.quantity} ${c.quantity === 1 ? "unit" : "units"}` : ""}`;
}
