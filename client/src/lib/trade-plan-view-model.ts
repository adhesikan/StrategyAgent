// Sprint 4B — Canonical TradePlanViewModel: single source of truth for the
// trade plan card used across ranked search, single-symbol recommendation,
// and analysis flows. Mappers translate each backend payload into this view
// model; the card never accesses raw payloads directly.
//
// Rules:
//   Never fabricate values — map only what the server supplied.
//   All optional fields use undefined (not null or "") when absent.
//   Source ("ranked" | "recommendation" | "analysis") controls CTA eligibility.

import type { RankedTradeCandidate, RankedWatchCandidate } from "@/lib/ranked-trade-search";
import type { RecIdea, RecommendationVerdict } from "@/lib/strategy-recommendation";

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
  opts: { requestedMax?: number } = {},
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
    suggestedQuantity: c.quantity,
    rewardRisk: c.rewardRisk,
    confidence: c.confidence ?? undefined,
    dataQuality: c.dataQuality ?? undefined,
    earningsRisk: earningsRisk || undefined,
    reasons: c.whySelected ?? [],
    warnings: c.warnings ?? [],
    source: "ranked",
  };
  vm.distanceToTrigger = computeDistanceToTrigger(vm) ?? undefined;
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
  return {
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
  return vm;
}
