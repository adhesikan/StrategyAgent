// Sprint 4B — Canonical TradePlanViewModel: single source of truth for the
// trade plan card used across ranked search, single-symbol recommendation,
// and analysis flows. Mappers translate each backend payload into this view
// model; the card never accesses raw payloads directly.
//
// Rules:
//   Never fabricate values — map only what the server supplied.
//   All optional fields use undefined (not null or "") when absent.
//   Source ("ranked" | "recommendation" | "analysis") controls CTA eligibility.
//
// Sprint 4.1D — Ranking Transparency:
//   rankingReasons  — deterministic observable phrases explaining the ranking.
//   candidateQuality — tier label derived from quality signals, NOT a score alias.
//   Neither field exposes proprietary weighting or implies score == rank.

import type { RankedTradeCandidate, RankedWatchCandidate } from "@/lib/ranked-trade-search";
import type { RecIdea, RecommendationVerdict } from "@/lib/strategy-recommendation";
import type { SafePortfolioAwareness } from "@/lib/portfolio-awareness";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trigger evaluation state — computed from currentPrice × triggerPrice. */
export type TradePlanTriggerState =
  | "TRIGGERED"          // currentPrice has crossed the trigger level
  | "AWAITING_TRIGGER"   // trigger exists, price hasn't reached it yet
  | "EVENT_CONFIRMATION" // trigger is a session/event (not a simple price level)
  | "NO_TRIGGER"         // no trigger was supplied
  | "UNKNOWN";           // trigger text present but price cannot be extracted

/** Unified verdict — superset of RecommendationVerdict. */
export type TradePlanVerdict = RecommendationVerdict | "UNAVAILABLE";

// ---------------------------------------------------------------------------
// Sprint 4.1D — Ranking Transparency
// ---------------------------------------------------------------------------

/**
 * Observable quality tier for a ranked candidate.
 *
 * Derived from confidence, data quality, trigger state, earnings risk, and
 * warning count. NOT a score alias — a high-scoring setup may land in
 * MODERATE if data is partial or earnings risk is present.
 *
 * PRIME      — triggered + high/medium confidence + live data + no earnings risk
 * STRONG     — qualified setup + solid confidence + few warnings
 * MODERATE   — watch-list or qualified with gaps / low confidence
 * SPECULATIVE — estimated-options data, low confidence, stale data, or earnings risk
 */
export type CandidateQuality = "PRIME" | "STRONG" | "MODERATE" | "SPECULATIVE";

/** Human label for each quality tier (never implies a numeric score). */
export const CANDIDATE_QUALITY_LABEL: Record<CandidateQuality, string> = {
  PRIME:       "Prime",
  STRONG:      "Strong",
  MODERATE:    "Moderate",
  SPECULATIVE: "Speculative",
};

/** Tailwind badge classes per quality tier. */
export const CANDIDATE_QUALITY_CLASS: Record<CandidateQuality, string> = {
  PRIME:       "border-emerald-500/50 text-emerald-300 bg-emerald-500/10",
  STRONG:      "border-sky-500/40 text-sky-300 bg-sky-500/8",
  MODERATE:    "border-amber-500/40 text-amber-300 bg-amber-500/8",
  SPECULATIVE: "border-muted-foreground/30 text-muted-foreground bg-muted/8",
};

/**
 * Derives the candidate quality tier from observable VM fields.
 * Never exposes proprietary weights.
 */
export function computeCandidateQuality(vm: Pick<
  TradePlanViewModel,
  | "verdict"
  | "tradeStatus"
  | "confidence"
  | "dataQuality"
  | "earningsRisk"
  | "warnings"
>): CandidateQuality {
  const isEstimated = vm.verdict === "ESTIMATED_OPTIONS";
  const isEarnings  = !!vm.earningsRisk;
  const isStaleData = !vm.dataQuality || /estimat|partial|mock|stale|unavailable/i.test(vm.dataQuality);
  const isLowConf   = !vm.confidence || /low/i.test(vm.confidence);
  const isHighConf  = !isLowConf && !!vm.confidence && /high/i.test(vm.confidence);
  const isMedConf   = !isLowConf && !isHighConf;
  const warningCount = (vm.warnings ?? []).length;
  const isTriggered = vm.tradeStatus === "TRIGGERED";
  const isQualified =
    vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS";

  // Speculative: estimated options, stale/absent data, earnings risk, or low confidence
  if (isEstimated || isStaleData || isEarnings || isLowConf) return "SPECULATIVE";

  // Prime: triggered + high/medium confidence + live data + zero warnings
  if (isTriggered && (isHighConf || isMedConf) && !isStaleData && !isEarnings && warningCount === 0) {
    return "PRIME";
  }

  // Strong: qualified + (high/medium confidence) + ≤1 warnings
  if (isQualified && (isHighConf || isMedConf) && warningCount <= 1) return "STRONG";

  // Moderate: watch-list or qualified with gaps
  if (isQualified) return "MODERATE";

  return "SPECULATIVE";
}

/**
 * Returns deterministic, human-readable reasons explaining why a candidate
 * achieved its ranking position.
 *
 * Rules:
 *   • Each phrase is observable from the VM — nothing fabricated.
 *   • Phrases describe observable advantages, not internal weights.
 *   • An empty array is returned when no rank is set (non-ranked sources).
 *   • Never implies that the highest score automatically ranks first.
 */
export function computeRankingReasons(vm: Pick<
  TradePlanViewModel,
  | "rank"
  | "verdict"
  | "triggerState"
  | "tradeStatus"
  | "dataQuality"
  | "rewardRisk"
  | "earningsRisk"
  | "reasons"
  | "maxRiskIsExact"
  | "fitsRiskBudget"
  | "warnings"
>): string[] {
  // Only ranked candidates get ranking reasons
  if (vm.rank == null) return [];

  const phrases: string[] = [];

  // 1. Actionable — has a defined entry trigger (not a vague "watch" state)
  if (
    vm.triggerState === "TRIGGERED" ||
    vm.triggerState === "AWAITING_TRIGGER" ||
    vm.triggerState === "UNKNOWN" ||
    vm.tradeStatus === "TRIGGERED" ||
    vm.tradeStatus === "AWAITING_BREAKOUT" ||
    vm.tradeStatus === "TRADE_READY"
  ) {
    phrases.push("Actionable");
  }

  // 2. Fresh data — data quality field present and not stale/estimated
  if (vm.dataQuality && !/estimat|partial|mock|stale|unavailable/i.test(vm.dataQuality)) {
    phrases.push("Fresh data");
  }

  // 3. Better reward/risk — R:R ≥ 2.5
  if (vm.rewardRisk != null && vm.rewardRisk >= 2.5) {
    phrases.push("Better reward/risk");
  }

  // 4. Lower earnings risk — no earnings event flagged
  if (!vm.earningsRisk && !(vm.warnings ?? []).some((w) => /earnings/i.test(w))) {
    phrases.push("Lower earnings risk");
  }

  // 5. Higher confluence — ≥ 3 supporting signals
  if ((vm.reasons ?? []).length >= 3) {
    phrases.push("Higher confluence");
  }

  // 6. Fits risk parameters — risk budget confirmed
  if (vm.fitsRiskBudget === true) {
    phrases.push("Fits risk parameters");
  }

  // 7. Exact sizing available — live contract data present
  if (vm.maxRiskIsExact === true) {
    phrases.push("Exact sizing available");
  }

  return phrases;
}

// ---------------------------------------------------------------------------
// Sprint 4.1C — Unified Trade Status System
// ---------------------------------------------------------------------------

/**
 * 8 canonical trade statuses — deterministic, derived from verdict + trigger
 * state + rejection reason code. Replaces generic "No Trade" labels everywhere.
 *
 * TRADE_READY       — qualified; no specific trigger price (broad entry or market order)
 * TRIGGERED         — price has crossed the entry trigger level; enter now
 * AWAITING_BREAKOUT — qualified but price hasn't reached the trigger yet
 * WATCH             — conditions partially met; waiting for confirmation
 * REJECTED          — disqualified (sub-reason via rejectionReasonCode)
 * DATA_LIMITED      — disqualified: incomplete or stale market data
 * MARKET_UNAVAILABLE — disqualified: data feed or market regime unavailable
 * EARNINGS_HOLD     — disqualified: pending earnings event blocks the setup
 */
export type TradeCardStatus =
  | "TRADE_READY"
  | "TRIGGERED"
  | "AWAITING_BREAKOUT"
  | "WATCH"
  | "REJECTED"
  | "DATA_LIMITED"
  | "MARKET_UNAVAILABLE"
  | "EARNINGS_HOLD";

// ---------------------------------------------------------------------------
// TradeCardStatus derivation (low-level — accepts raw fields)
// ---------------------------------------------------------------------------

/**
 * Derives the canonical TradeCardStatus from raw fields — usable in any context
 * that doesn't have a full VM (e.g. recommendation hero cards).
 */
export function computeTradeStatusDirect(opts: {
  verdict: TradePlanVerdict | string;
  triggerState?: TradePlanTriggerState;
  rejectionReasonCode?: string | null;
  earningsRisk?: boolean;
}): TradeCardStatus {
  const { verdict, triggerState = "NO_TRIGGER", rejectionReasonCode, earningsRisk } = opts;
  const code = rejectionReasonCode ?? "";
  const base = code.split(":")[0].trim();

  if (verdict === "STOCK" || verdict === "LIVE_OPTIONS" || verdict === "ESTIMATED_OPTIONS") {
    if (triggerState === "TRIGGERED") return "TRIGGERED";
    if (triggerState === "AWAITING_TRIGGER" || triggerState === "UNKNOWN" || triggerState === "EVENT_CONFIRMATION") {
      return "AWAITING_BREAKOUT";
    }
    return "TRADE_READY"; // NO_TRIGGER — qualified, no specific price trigger
  }

  if (verdict === "WATCH") {
    if (base === "WAITING_FOR_TRIGGER") return "AWAITING_BREAKOUT";
    return "WATCH";
  }

  if (verdict === "NO_TRADE" || verdict === "UNSUPPORTED") {
    if (earningsRisk || base === "EARNINGS_RISK") return "EARNINGS_HOLD";
    const dataLimitedCodes = [
      "DATA_UNAVAILABLE",
      "UNDERLYING_MARKET_DATA_UNAVAILABLE",
      "OPTIONS_DATA_UNAVAILABLE",
      "DATA_FRESHNESS_INSUFFICIENT",
      "CANDIDATE_CONFIRMATION_UNAVAILABLE",
    ];
    if (dataLimitedCodes.includes(base)) return "DATA_LIMITED";
    if (base === "MARKET_REGIME_UNAVAILABLE") return "MARKET_UNAVAILABLE";
    if (base === "WAITING_FOR_TRIGGER") return "AWAITING_BREAKOUT";
    return "REJECTED";
  }

  if (verdict === "UNAVAILABLE") return "MARKET_UNAVAILABLE";
  return "REJECTED";
}

/**
 * Derives the canonical TradeCardStatus from a TradePlanViewModel.
 * Always returns one of the 8 defined statuses — never null.
 */
export function computeTradeStatus(
  vm: Pick<TradePlanViewModel, "verdict" | "triggerState" | "rejectionReasonCode" | "earningsRisk">,
): TradeCardStatus {
  return computeTradeStatusDirect({
    verdict: vm.verdict,
    triggerState: vm.triggerState,
    rejectionReasonCode: vm.rejectionReasonCode,
    earningsRisk: vm.earningsRisk,
  });
}

/**
 * Returns the trader-facing label for a TradeCardStatus.
 *
 * For REJECTED, appends a sub-reason when derivable from rejectionReasonCode:
 *   RISK_LIMIT_EXCEEDED      → "Rejected — Risk"
 *   EARNINGS_RISK            → "Rejected — Earnings"
 *   DIRECTION_CONFLICT       → "Rejected — Direction"
 *   STALE_SETUP              → "Rejected — Stale Setup"
 *   NO_VALID_SETUP           → "Rejected — No Valid Setup"
 *   UNSUPPORTED_STRUCTURE    → "Rejected — Unsupported"
 *   LIQUIDITY_RISK           → "Rejected — Liquidity"
 *   POSITION_LIMIT_EXCEEDED  → "Rejected — Position Limit"
 *   (other / absent)         → "Rejected"
 */
export function tradeStatusLabel(vm: Pick<TradePlanViewModel, "tradeStatus" | "rejectionReasonCode">): string {
  const status = vm.tradeStatus ?? "REJECTED";
  switch (status) {
    case "TRADE_READY":        return "Trade Ready";
    case "TRIGGERED":          return "Triggered";
    case "AWAITING_BREAKOUT":  return "Awaiting Breakout";
    case "WATCH":              return "Waiting for Confirmation";
    case "EARNINGS_HOLD":      return "Earnings Hold";
    case "DATA_LIMITED":       return "Data Limited";
    case "MARKET_UNAVAILABLE": return "Market Unavailable";
    case "REJECTED": {
      const code = vm.rejectionReasonCode ?? "";
      const base = code.split(":")[0].trim();
      switch (base) {
        case "EARNINGS_RISK":           return "Rejected — Earnings";
        case "RISK_LIMIT_EXCEEDED":     return "Rejected — Risk";
        case "DIRECTION_CONFLICT":      return "Rejected — Direction";
        case "STALE_SETUP":             return "Rejected — Stale Setup";
        case "NO_VALID_SETUP":          return "Rejected — No Valid Setup";
        case "UNSUPPORTED_STRUCTURE":   return "Rejected — Unsupported";
        case "LIQUIDITY_RISK":          return "Rejected — Liquidity";
        case "POSITION_LIMIT_EXCEEDED": return "Rejected — Position Limit";
        default:                        return "Rejected";
      }
    }
    default: return "Rejected";
  }
}

/** Tailwind badge classes for a TradeCardStatus. */
export function tradeStatusBadgeClass(status: TradeCardStatus): string {
  switch (status) {
    case "TRADE_READY":        return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
    case "TRIGGERED":          return "border-emerald-400/60 text-emerald-200 bg-emerald-500/20";
    case "AWAITING_BREAKOUT":  return "border-sky-500/40 text-sky-300 bg-sky-500/10";
    case "WATCH":              return "border-amber-500/40 text-amber-300 bg-amber-500/10";
    case "EARNINGS_HOLD":      return "border-orange-500/40 text-orange-300 bg-orange-500/10";
    case "DATA_LIMITED":       return "border-purple-500/40 text-purple-300 bg-purple-500/10";
    case "MARKET_UNAVAILABLE": return "border-muted text-muted-foreground bg-muted/20";
    case "REJECTED":           return "border-muted text-muted-foreground bg-muted/20";
    default:                   return "border-muted text-muted-foreground bg-muted/20";
  }
}

export interface TradePlanCta {
  label: string;
  href: string;
  primary?: boolean;
}

export interface TradePlanViewModel {
  // Identity
  symbol: string;
  rank?: number;
  verdict: TradePlanVerdict;
  status?: string;           // setupStatus / recStatusLabel
  // Strategy
  strategy?: string;
  strategyScore?: number;
  direction?: string;
  instrument?: string;
  // Price & trigger
  currentPrice?: number;
  trigger?: string;
  triggerState: TradePlanTriggerState;
  distanceToTrigger?: string; // "+$5.50 (+2.9% to trigger)"
  // Levels — both text (display) and extracted numeric (labels/formatting)
  invalidation?: string;
  objective?: string;
  /** Numeric stop price extracted from invalidation text (for compact display). */
  stopPrice?: number;
  /** Numeric target price extracted from objective text (for compact display). */
  targetPrice?: number;
  riskPerUnit?: number;
  /** Expected hold duration (e.g. "1–3 weeks") when provided by source. */
  expectedHold?: string;
  // Risk
  suggestedQuantity?: number;
  maxRisk?: number;
  maxRiskIsExact?: boolean;
  rewardRisk?: number;
  // Metadata
  confidence?: string;       // "High" / "Medium" / "Low" / raw string
  dataQuality?: string;
  earningsRisk?: boolean;
  simulatedData?: boolean;
  // Decision content
  reasons: string[];         // "Why selected" bullets
  warnings: string[];
  watchConditions?: string[]; // "What would change the verdict"
  rejectionReasonCode?: string | null;
  /** Sprint 4.1C: unified deterministic status — replaces generic "No Trade" label. */
  tradeStatus?: TradeCardStatus;
  // Sprint 4.1D — Ranking Transparency
  /**
   * Observable quality tier for this setup — NOT a score alias or rank proxy.
   * Derived from confidence, data quality, trigger state, earnings risk, and
   * warnings. Only populated for ranked candidates.
   */
  candidateQuality?: CandidateQuality;
  /**
   * Deterministic phrases explaining why this candidate achieved its rank.
   * Each phrase is observable (never reveals internal weights). Empty for
   * non-ranked sources. Examples: "Actionable", "Fresh data", "Better reward/risk".
   */
  rankingReasons?: string[];
  /**
   * Whether the candidate's max-risk estimate fits within the user's risk
   * budget (as determined by the ranking engine).
   */
  fitsRiskBudget?: boolean;
  /**
   * Sprint 4.2 — Portfolio Fit.
   *
   * Populated by the caller after fromRankedCandidate (awareness comes back
   * from the Ask AI route alongside the candidate list, not inside it).
   *
   *   undefined  — section not rendered (no portfolio context attempted)
   *   null       — "No brokerage connected" state
   *   object     — show portfolio fit rows from SafePortfolioAwareness
   *
   * Never contains account IDs, raw balances, or broker tokens.
   * All display values come from the trusted server-derived SafePortfolioAwareness.
   */
  portfolioAwareness?: SafePortfolioAwareness | null;
  // Source tag — controls CTA set and Trade Builder eligibility.
  source: "ranked" | "recommendation" | "analysis";
}

// ---------------------------------------------------------------------------
// Trigger state computation (shared by both mappers)
// ---------------------------------------------------------------------------

/** Extracts the first numeric price from a text string (trigger, stop, target).
 *  Returns null when no parseable price is found (e.g. event triggers). */
function extractTriggerPrice(trigger: string): number | null {
  const m = trigger.match(/\b(\d{1,6}(?:\.\d{1,4})?)\b/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Exported alias — extracts the first numeric price from any level description
 * (trigger, invalidation/stop, objective/target). Returns undefined when the
 * text is absent or contains no parseable price.
 *
 * Examples:
 *   extractLevelPrice("Break above $192.50") → 192.5
 *   extractLevelPrice("Stop below $180")     → 180
 *   extractLevelPrice(undefined)             → undefined
 */
export function extractLevelPrice(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const result = extractTriggerPrice(text);
  return result != null ? result : undefined;
}

export function computeTriggerState(opts: {
  trigger?: string;
  currentPrice?: number;
  triggerType?: "price" | "event";
}): TradePlanTriggerState {
  const { trigger, currentPrice, triggerType } = opts;
  if (!trigger?.trim()) return "NO_TRIGGER";
  if (triggerType === "event") return "EVENT_CONFIRMATION";
  const triggerPrice = extractTriggerPrice(trigger);
  if (triggerPrice === null) return "UNKNOWN";
  if (!currentPrice) return "AWAITING_TRIGGER";
  return currentPrice >= triggerPrice ? "TRIGGERED" : "AWAITING_TRIGGER";
}

/** Computes a human-readable distance string (dollar + percentage).
 *  Returns null when trigger price or current price is unavailable. */
export function computeDistanceToTrigger(
  vm: Pick<TradePlanViewModel, "trigger" | "currentPrice" | "triggerState">,
): string | null {
  if (vm.triggerState === "NO_TRIGGER" || vm.triggerState === "EVENT_CONFIRMATION") return null;
  if (!vm.trigger || !vm.currentPrice) return null;
  const triggerPrice = extractTriggerPrice(vm.trigger);
  if (triggerPrice === null) return null;
  const distance = triggerPrice - vm.currentPrice;
  const pct = (distance / vm.currentPrice) * 100;
  const absDollar = Math.abs(distance).toFixed(2);
  const absPct = Math.abs(pct).toFixed(1);
  if (distance > 0) return `+$${absDollar} (+${absPct}% to trigger)`;
  if (distance < 0) return `-$${absDollar} (−${absPct}% — above trigger)`;
  return "At trigger";
}

// ---------------------------------------------------------------------------
// Trade Builder eligibility (spec §4)
// ---------------------------------------------------------------------------

/** Trade Builder is only offered when all safeguards pass. */
export function isTradePlanBuilderEligible(vm: TradePlanViewModel): boolean {
  if (!vm.trigger || !vm.invalidation || vm.maxRisk == null || vm.suggestedQuantity == null) return false;
  if (!vm.dataQuality || /estimat|partial|mock|stale|unavailable/i.test(vm.dataQuality)) return false;
  if (vm.triggerState === "NO_TRIGGER") return false;
  return true;
}

// ---------------------------------------------------------------------------
// CTA generation (spec §4)
// ---------------------------------------------------------------------------

export function tradePlanCtas(vm: TradePlanViewModel): TradePlanCta[] {
  const sym = vm.symbol.toUpperCase();
  const enc = (q: string) => encodeURIComponent(q);
  switch (vm.verdict) {
    case "STOCK":
    case "LIVE_OPTIONS": {
      const out: TradePlanCta[] = [
        { label: "Analyze", href: `/ask?q=${enc(`Analyze ${sym}`)}`, primary: true },
        { label: "View Chart", href: `/market-intel?symbol=${sym}` },
      ];
      if (isTradePlanBuilderEligible(vm)) out.push({ label: "Open Trade Builder", href: `/trade/${sym}` });
      out.push({ label: "Open Scanner", href: "/scanner" });
      return out;
    }
    case "ESTIMATED_OPTIONS":
      // No real trade ticket — only view setup and connect a live provider.
      return [
        { label: "Analyze", href: `/ask?q=${enc(`Analyze ${sym}`)}`, primary: true },
        { label: "View Chart", href: `/market-intel?symbol=${sym}` },
        { label: "Connect Provider", href: "/settings/broker" },
        { label: "Open Scanner", href: "/scanner" },
      ];
    case "WATCH":
      // No Trade Builder — awaiting confirmation.
      return [
        { label: "Analyze", href: `/ask?q=${enc(`Analyze ${sym}`)}`, primary: true },
        { label: "View Chart", href: `/market-intel?symbol=${sym}` },
        { label: "Add to Watchlist", href: `/watchlist?add=${sym}` },
        { label: "Open Scanner", href: "/scanner" },
      ];
    case "NO_TRADE":
    case "UNAVAILABLE":
      // No Trade Builder — nothing to act on.
      return [
        { label: "Analyze", href: `/ask?q=${enc(`Analyze ${sym}`)}`, primary: true },
        { label: "View Chart", href: `/market-intel?symbol=${sym}` },
        { label: "Open Scanner", href: "/scanner" },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Mapper — RankedTradeCandidate → TradePlanViewModel
// ---------------------------------------------------------------------------

export function fromRankedCandidate(
  c: RankedTradeCandidate,
  opts: {
    requestedMax?: number;
    /**
     * Sprint 4.2: Pass the SafePortfolioAwareness returned by the Ask AI
     * route for this symbol, or null when the user has no broker connected.
     * When omitted (undefined) the Portfolio Fit section is hidden entirely.
     */
    portfolioAwareness?: SafePortfolioAwareness | null;
  } = {},
): TradePlanViewModel {
  const isOptions = /option/i.test(c.instrument ?? "");
  const verdict: TradePlanVerdict = !isOptions
    ? "STOCK"
    : c.maxRiskIsExact
      ? "LIVE_OPTIONS"
      : "ESTIMATED_OPTIONS";

  const earningsRisk = (c.warnings ?? []).some((w) => /earnings/i.test(w));

  const vm: TradePlanViewModel = {
    symbol: c.symbol,
    rank: c.rank,
    verdict,
    status: c.setupStatus,
    strategy: c.strategy ?? undefined,
    strategyScore: c.strategyScore,
    instrument: c.structure ?? c.instrument ?? undefined,
    currentPrice: c.currentPrice,
    trigger: c.trigger ?? undefined,
    triggerState: computeTriggerState({
      trigger: c.trigger,
      currentPrice: c.currentPrice,
      triggerType: c.triggerType,
    }),
    invalidation: c.invalidation ?? undefined,
    objective: c.objective ?? undefined,
    stopPrice: extractLevelPrice(c.invalidation ?? undefined),
    targetPrice: extractLevelPrice(c.objective ?? undefined),
    maxRisk: c.maxRisk,
    maxRiskIsExact: c.maxRiskIsExact,
    fitsRiskBudget: c.fitsRiskBudget,
    suggestedQuantity: c.quantity,
    rewardRisk: c.rewardRisk,
    confidence: c.confidence ?? undefined,
    dataQuality: c.dataQuality ?? undefined,
    earningsRisk: earningsRisk || undefined,
    reasons: c.whySelected ?? [],
    warnings: c.warnings ?? [],
    source: "ranked",
    // Sprint 4.2: portfolio awareness — undefined = hidden; null = disconnected; object = data
    portfolioAwareness: opts.portfolioAwareness,
  };
  vm.distanceToTrigger = computeDistanceToTrigger(vm) ?? undefined;
  vm.tradeStatus = computeTradeStatus(vm);
  // Sprint 4.1D — populate quality tier and ranking reasons after status/trigger are set
  vm.candidateQuality = computeCandidateQuality(vm);
  vm.rankingReasons   = computeRankingReasons(vm);
  return vm;
}

// ---------------------------------------------------------------------------
// Mapper — RankedWatchCandidate → TradePlanViewModel
// ---------------------------------------------------------------------------

/**
 * Maps a ranked watch candidate to a WATCH-verdict view model.
 * Watch candidates carry minimal data (no trigger price, no levels) — all
 * numeric fields are absent. The `reasons` array is populated from
 * watchConditions so the Decision/WHY section renders meaningfully.
 */
export function fromRankedWatchCandidate(w: RankedWatchCandidate): TradePlanViewModel {
  const vm: TradePlanViewModel = {
    symbol: w.symbol,
    verdict: "WATCH",
    strategy: w.strategy ?? undefined,
    triggerState: "NO_TRIGGER",
    status: w.currentStage,
    reasons: [],
    warnings: w.missingConfirmation ? [w.missingConfirmation] : [],
    watchConditions: w.watchConditions.length > 0 ? w.watchConditions : undefined,
    source: "ranked",
  };
  vm.tradeStatus = computeTradeStatus(vm);
  return vm;
}

// ---------------------------------------------------------------------------
// Mapper — RecIdea → TradePlanViewModel
// ---------------------------------------------------------------------------

function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function safeStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function confidenceLabel(n: number | null | undefined): string | undefined {
  if (n == null) return undefined;
  if (n >= 0.8) return "High";
  if (n >= 0.5) return "Medium";
  return "Low";
}

export function fromRecIdea(
  idea: RecIdea,
  opts: {
    symbol?: string;
    direction?: string;
    simulatedData?: boolean;
    watchConditions?: string[];
  } = {},
): TradePlanViewModel {
  const cand = (idea.tradeCandidate ?? {}) as Record<string, unknown>;
  const risk = (idea.riskAssessment ?? {}) as Record<string, unknown>;
  const pos = (idea.recommendedPosition ?? {}) as Record<string, unknown>;
  const dq = (idea.dataQuality ?? {}) as Record<string, unknown>;

  const trigger =
    safeStr(cand.trigger ?? cand.entryTrigger ?? cand.entry ?? cand.entryPrice) ?? undefined;
  const currentPrice = safeNum(cand.currentPrice ?? cand.lastPrice) ?? undefined;
  const invalidation =
    safeStr(cand.invalidation ?? cand.stop ?? cand.stopPrice) ?? undefined;
  const objective =
    safeStr(cand.target ?? cand.targetPrice ?? cand.technicalObjective) ?? undefined;
  const maxRisk =
    safeNum(risk.maxRiskDollars ?? risk.maxLoss ?? pos.maxRiskDollars) ?? undefined;
  const qty =
    safeNum(pos.shares ?? pos.contracts ?? pos.suggestedQuantity) ?? undefined;
  const rr = safeNum(cand.rewardRisk ?? cand.rewardRiskRatio) ?? undefined;
  const dqStr = safeStr(dq.level ?? dq.source ?? dq.quality) ?? undefined;
  const instrument = safeStr(cand.instrument ?? cand.type ?? cand.recommendedInstrument) ?? undefined;

  const earningsRisk =
    idea.rejectionReasonCode === "EARNINGS_RISK" ||
    (idea.warnings ?? []).some((w) => /earnings/i.test(w));

  const expectedHold =
    safeStr(cand.expectedHold ?? cand.holdPeriod ?? cand.timeframe ?? cand.expectedHoldDuration) ?? undefined;

  const vm: TradePlanViewModel = {
    symbol: opts.symbol ?? "—",
    verdict: idea.overallVerdict as TradePlanVerdict,
    strategy: safeStr(idea.recommendedStrategy) ?? undefined,
    direction: opts.direction,
    instrument,
    currentPrice,
    trigger,
    triggerState: computeTriggerState({ trigger, currentPrice }),
    invalidation,
    objective,
    stopPrice: extractLevelPrice(invalidation),
    targetPrice: extractLevelPrice(objective),
    expectedHold,
    maxRisk,
    suggestedQuantity: qty,
    rewardRisk: rr,
    confidence: confidenceLabel(idea.confidence),
    dataQuality: dqStr,
    earningsRisk: earningsRisk || undefined,
    simulatedData: opts.simulatedData,
    reasons: idea.reasons ?? [],
    warnings: idea.warnings ?? [],
    watchConditions: opts.watchConditions,
    rejectionReasonCode: idea.rejectionReasonCode,
    source: "recommendation",
  };
  vm.distanceToTrigger = computeDistanceToTrigger(vm) ?? undefined;
  vm.tradeStatus = computeTradeStatus(vm);
  return vm;
}
