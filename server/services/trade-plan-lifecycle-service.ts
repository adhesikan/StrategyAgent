/**
 * server/services/trade-plan-lifecycle-service.ts — Sprint 2.7.6
 *
 * Trade Monitoring & Lifecycle Intelligence — deterministic lifecycle evaluation.
 *
 * ROADMAP DISCIPLINE:
 * - Research observations only. No execution. No exit instructions.
 * - No automatic plan mutation. No contract substitution. No strategy substitution.
 * - No broker orders. No suitability logic. No P/L. No autonomous agents.
 *
 * Architecture:
 *   evaluateTradePlanLifecycle(userId, tradePlanId)  → TradePlanLifecycleResult
 *   evaluateUserTradePlans(userId)                   → TradePlanLifecycleResult[]
 *   evaluateAllActiveTradePlans()                    → TradePlanLifecycleResult[]
 *   persistLifecycleActivity(...)                    → void (fire-and-forget)
 *   getLifecycleResult(userId, planId)               → cached result
 *   getTradePlanActivities(userId, planId, opts)      → paginated activity
 *   getLifecycleHealth()                             → platform health metrics
 *
 * Scheduler: NOT wired to cron in 2.7.6 (see SCHEDULER_NOTE in lifecycle-types).
 * Wire via evaluateAllActiveTradePlans() when 2.7.7 validation is complete.
 */

import { db } from "../db";
import {
  tradePlans,
  tradePlanActivity,
  type TradePlanActivityRow,
} from "../../shared/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

import type {
  TradePlanLifecycleResult,
  TradePlanActivity,
  LifecycleState,
  ResearchChangeItem,
  InvalidationChange,
  StructureChangeItem,
  EventChange,
  LiquidityChange,
  FreshnessChange,
  ReviewReason,
  ReviewReasonType,
  LifecycleResearchSummary,
  ReviewedResearchState,
  ExpirationState,
  ActivityEventType,
  TradePlanMonitoringHealthMetrics,
} from "../../shared/trade-plan-lifecycle-types";
import {
  LIFECYCLE_METHODOLOGY_VERSION,
  DEDUP_WINDOW_HOURS,
  DTE_THRESHOLDS,
} from "../../shared/trade-plan-lifecycle-types";

import { getCanonicalOpportunity } from "./opportunity-intelligence-service";
import type { TradePlanResearchSnapshot } from "../../shared/trade-plan-types";

// ============================================================================
// In-memory lifecycle cache (5-min per user+plan)
// ============================================================================

interface LifecycleCacheEntry {
  result:    TradePlanLifecycleResult;
  expiresAt: number;
}

const _lifecycleCache = new Map<string, LifecycleCacheEntry>();
const LIFECYCLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function _lifecycleCacheKey(userId: string, planId: string) {
  return `${userId}:${planId}`;
}

export function getCachedLifecycleResult(
  userId: string,
  planId: string,
): TradePlanLifecycleResult | null {
  const key = _lifecycleCacheKey(userId, planId);
  const entry = _lifecycleCache.get(key);
  if (!entry || Date.now() >= entry.expiresAt) {
    _lifecycleCache.delete(key);
    return null;
  }
  return entry.result;
}

function _cacheLifecycleResult(userId: string, planId: string, result: TradePlanLifecycleResult) {
  _lifecycleCache.set(_lifecycleCacheKey(userId, planId), {
    result,
    expiresAt: Date.now() + LIFECYCLE_CACHE_TTL_MS,
  });
}

function _invalidateLifecycleCache(userId: string, planId: string) {
  _lifecycleCache.delete(_lifecycleCacheKey(userId, planId));
}

// ============================================================================
// Platform health metrics (session-lifetime aggregate, no user data)
// ============================================================================

const _health: TradePlanMonitoringHealthMetrics & {
  _evaluationDurations: number[];
} = {
  plansEvaluated:              0,
  currentPlans:                0,
  changedPlans:                0,
  reviewRequiredPlans:         0,
  invalidatedPlans:            0,
  stalePlans:                  0,
  failedEvaluations:           0,
  averageEvaluationDurationMs: null,
  lastEvaluationAt:            null,
  _evaluationDurations:        [],
};

export function getLifecycleHealth(): TradePlanMonitoringHealthMetrics {
  const { _evaluationDurations, ...rest } = _health;
  return {
    ...rest,
    averageEvaluationDurationMs:
      _evaluationDurations.length > 0
        ? Math.round(_evaluationDurations.reduce((a, b) => a + b, 0) / _evaluationDurations.length)
        : null,
  };
}

function _recordEvaluation(state: LifecycleState, durationMs: number) {
  _health.plansEvaluated++;
  _health.lastEvaluationAt = new Date().toISOString();
  _health._evaluationDurations.push(durationMs);
  if (_health._evaluationDurations.length > 500) _health._evaluationDurations.shift();

  if (state === "CURRENT")            _health.currentPlans++;
  else if (state === "CHANGED")       _health.changedPlans++;
  else if (state === "REQUIRES_REVIEW") _health.reviewRequiredPlans++;
  else if (state === "THESIS_INVALIDATED") _health.invalidatedPlans++;
  else if (state === "DATA_STALE")    _health.stalePlans++;
}

function _recordEvaluationFailure() {
  _health.failedEvaluations++;
}

// ============================================================================
// Concurrency guard for manual evaluation
// ============================================================================

const _evaluating = new Set<string>(); // keyed by userId:planId

// ============================================================================
// Deterministic lifecycle evaluation helpers (pure functions)
// ============================================================================

/** Compute expiration state from current DTE (options plans) */
export function computeExpirationState(dte: number | null): ExpirationState {
  if (dte === null || dte === undefined) return "UNKNOWN";
  if (dte <= 0)                          return "EXPIRED";
  if (dte <= 20)                         return "NEAR_EXPIRATION";
  if (dte <= 45)                         return "APPROACHING_EXPIRATION";
  return "FAR_FROM_EXPIRATION";
}

/**
 * Detect research changes between saved snapshot and current opportunity.
 * Reuses existing Change Intelligence thresholds (5pt material, 0pt minor).
 */
export function computeResearchChanges(
  saved: TradePlanResearchSnapshot,
  current: LifecycleResearchSummary,
): ResearchChangeItem[] {
  if (!current.available) return [];

  const changes: ResearchChangeItem[] = [];
  const MATERIAL_THRESHOLD = 5;

  // Research score
  const rDelta = current.researchScore - saved.researchScore;
  if (Math.abs(rDelta) > 0) {
    changes.push({
      changeType:   rDelta > 0 ? "RESEARCH_STRENGTHENED" : "RESEARCH_WEAKENED",
      savedValue:   saved.researchScore,
      currentValue: current.researchScore,
      delta:        rDelta,
      description:  `Research score changed from ${saved.researchScore.toFixed(1)} to ${current.researchScore.toFixed(1)}`,
      isMaterial:   Math.abs(rDelta) >= MATERIAL_THRESHOLD,
    });
  }

  // Technical score
  const tDelta = current.technicalScore - saved.technicalScore;
  if (Math.abs(tDelta) > 0) {
    changes.push({
      changeType:   tDelta > 0 ? "TECHNICAL_STRENGTHENED" : "TECHNICAL_WEAKENED",
      savedValue:   saved.technicalScore,
      currentValue: current.technicalScore,
      delta:        tDelta,
      description:  `Technical score changed from ${saved.technicalScore.toFixed(1)} to ${current.technicalScore.toFixed(1)}`,
      isMaterial:   Math.abs(tDelta) >= MATERIAL_THRESHOLD,
    });
  }

  // Fundamental score
  const fDelta = current.fundamentalScore - saved.fundamentalScore;
  if (Math.abs(fDelta) > 0) {
    changes.push({
      changeType:   "FUNDAMENTAL_CHANGED",
      savedValue:   saved.fundamentalScore,
      currentValue: current.fundamentalScore,
      delta:        fDelta,
      description:  `Fundamental score changed from ${saved.fundamentalScore.toFixed(1)} to ${current.fundamentalScore.toFixed(1)}`,
      isMaterial:   Math.abs(fDelta) >= MATERIAL_THRESHOLD,
    });
  }

  // Institutional score
  const iDelta = current.institutionalScore - saved.institutionalScore;
  if (Math.abs(iDelta) > 0) {
    changes.push({
      changeType:   "INSTITUTIONAL_CHANGED",
      savedValue:   saved.institutionalScore,
      currentValue: current.institutionalScore,
      delta:        iDelta,
      description:  `Institutional score changed from ${saved.institutionalScore.toFixed(1)} to ${current.institutionalScore.toFixed(1)}`,
      isMaterial:   Math.abs(iDelta) >= MATERIAL_THRESHOLD,
    });
  }

  // Qualification
  const savedQualified = (saved as any).qualified ?? false;
  if (savedQualified !== current.qualified) {
    changes.push({
      changeType:   current.qualified ? "NEWLY_QUALIFIED" : "NO_LONGER_QUALIFIED",
      savedValue:   savedQualified ? "qualified" : "not qualified",
      currentValue: current.qualified ? "qualified" : "not qualified",
      delta:        null,
      description:  current.qualified
        ? "Symbol is now research-qualified"
        : "Symbol no longer meets research qualification criteria",
      isMaterial:   true, // qualification changes are always material
    });
  }

  // Risk level
  if (saved.riskLevel !== current.riskLevel) {
    changes.push({
      changeType:   "RISK_LEVEL_CHANGED",
      savedValue:   saved.riskLevel,
      currentValue: current.riskLevel,
      delta:        null,
      description:  `Risk level changed from ${saved.riskLevel} to ${current.riskLevel}`,
      isMaterial:   false, // informational unless both MATERIAL thresholds crossed
    });
  }

  // Market regime
  if (saved.marketRegime && current.marketRegime && saved.marketRegime !== current.marketRegime) {
    changes.push({
      changeType:   "REGIME_CHANGED",
      savedValue:   saved.marketRegime,
      currentValue: current.marketRegime,
      delta:        null,
      description:  `Market regime changed from ${saved.marketRegime} to ${current.marketRegime}`,
      isMaterial:   false, // regime change can be review reason if explicitly listed
    });
  }

  // Sector
  if (saved.sector && current.sector && saved.sector !== current.sector) {
    changes.push({
      changeType:   "SECTOR_CONTEXT_CHANGED",
      savedValue:   saved.sector,
      currentValue: current.sector,
      delta:        null,
      description:  `Sector context changed from ${saved.sector} to ${current.sector}`,
      isMaterial:   false,
    });
  }

  // Themes — simplified diff (first theme changed)
  const savedTheme  = (saved.themes ?? [])[0] ?? null;
  const currentTheme = (current.themes ?? [])[0] ?? null;
  if (savedTheme && currentTheme && savedTheme !== currentTheme) {
    changes.push({
      changeType:   "THEME_CONTEXT_CHANGED",
      savedValue:   savedTheme,
      currentValue: currentTheme,
      delta:        null,
      description:  "Primary theme context changed",
      isMaterial:   false,
    });
  }

  return changes;
}

/**
 * Evaluate thesis invalidation conditions from saved snapshot
 * against current research state.
 */
export function computeInvalidationChanges(
  saved: TradePlanResearchSnapshot,
  current: LifecycleResearchSummary | null,
): InvalidationChange[] {
  const conditions = saved.invalidatesThesis ?? [];
  if (conditions.length === 0) return [];

  // When current data is unavailable, return each condition as "unknown" (not empty)
  if (!current) {
    return conditions.map((cond: any) => ({
      condition:        cond.condition,
      description:      cond.description ?? `Condition: ${cond.condition}`,
      observationState: "unknown" as const,
      evaluationNote:   "Current research data is unavailable — condition cannot be evaluated.",
    } satisfies InvalidationChange));
  }

  return conditions.map((cond: any) => {
    const condType: string = cond.condition ?? "";

    let observationState: "observed" | "notObserved" | "unknown" = "unknown";
    let evaluationNote = "Unable to evaluate against current data.";

    // Evaluate each known condition type against available current data
    if (condType.includes("QUALIFICATION") || condType.includes("NO_LONGER_QUALIFIED")) {
      if (current.available) {
        observationState = !current.qualified ? "observed" : "notObserved";
        evaluationNote = `Current qualification: ${current.qualified ? "qualified" : "not qualified"}`;
      }
    } else if (condType.includes("TECHNICAL") || condType.includes("STAGE")) {
      if (current.available) {
        const tDelta = current.technicalScore - saved.technicalScore;
        observationState = tDelta < -10 ? "observed" : "notObserved";
        evaluationNote = `Technical score delta: ${tDelta >= 0 ? "+" : ""}${tDelta.toFixed(1)} from saved snapshot`;
      }
    } else if (condType.includes("REGIME") && saved.marketRegime && current.marketRegime) {
      observationState = current.marketRegime !== saved.marketRegime ? "observed" : "notObserved";
      evaluationNote = `Market regime: saved=${saved.marketRegime}, current=${current.marketRegime}`;
    } else if (condType.includes("RESEARCH") || condType.includes("SCORE")) {
      if (current.available) {
        const rDelta = current.researchScore - saved.researchScore;
        observationState = rDelta < -10 ? "observed" : "notObserved";
        evaluationNote = `Research score delta: ${rDelta >= 0 ? "+" : ""}${rDelta.toFixed(1)} from saved snapshot`;
      }
    } else if (condType.includes("FUNDAMENTAL")) {
      if (current.available) {
        const fDelta = current.fundamentalScore - saved.fundamentalScore;
        observationState = fDelta < -10 ? "observed" : "notObserved";
        evaluationNote = `Fundamental score delta: ${fDelta >= 0 ? "+" : ""}${fDelta.toFixed(1)} from saved snapshot`;
      }
    } else if (condType.includes("INSTITUTIONAL")) {
      if (current.available) {
        const iDelta = current.institutionalScore - saved.institutionalScore;
        observationState = iDelta < -10 ? "observed" : "notObserved";
        evaluationNote = `Institutional score delta: ${iDelta >= 0 ? "+" : ""}${iDelta.toFixed(1)} from saved snapshot`;
      }
    }

    return {
      condition:        cond.condition,
      description:      cond.description ?? `Condition: ${condType}`,
      observationState,
      evaluationNote,
    } satisfies InvalidationChange;
  });
}

/**
 * Compute structure changes for options plans.
 * Does NOT recompute a new contract candidate.
 */
export function computeStructureChanges(
  planType: string,
  structureSnapshot: Record<string, unknown> | null,
  currentDTE: number | null,
): StructureChangeItem[] {
  if (planType !== "OPTIONS" || !structureSnapshot) return [];

  const changes: StructureChangeItem[] = [];
  const savedDTE: number | null = (structureSnapshot as any).dte ?? null;
  const expirationState = computeExpirationState(currentDTE);

  // DTE change
  if (savedDTE !== null && currentDTE !== null && savedDTE !== currentDTE) {
    changes.push({
      changeType:   "DTE_CHANGED",
      description:  `Days to expiration changed from ${savedDTE} to ${currentDTE}`,
      savedValue:   savedDTE,
      currentValue: currentDTE,
      isMaterial:   expirationState === "NEAR_EXPIRATION" || expirationState === "EXPIRED",
    });
  }

  // Expiration lifecycle states
  if (expirationState === "APPROACHING_EXPIRATION") {
    changes.push({
      changeType:   "EXPIRATION_APPROACHING",
      description:  "Contract is approaching expiration; review current research assumptions and structure risk.",
      savedValue:   savedDTE,
      currentValue: currentDTE,
      isMaterial:   true,
    });
  } else if (expirationState === "NEAR_EXPIRATION" || expirationState === "EXPIRED") {
    changes.push({
      changeType:   "EXPIRATION_NEAR",
      description:  expirationState === "EXPIRED"
        ? "Contract has expired; plan reflects expired structure."
        : "Contract is near expiration; review current research assumptions urgently.",
      savedValue:   savedDTE,
      currentValue: currentDTE,
      isMaterial:   true,
    });
  }

  return changes;
}

/**
 * Compute freshness changes.
 * A plan becomes DATA_STALE when research data is unavailable or older than expected.
 */
export function computeFreshnessChanges(
  savedFreshness: string,
  currentAvailable: boolean,
  currentOpportunityAge?: number | null, // hours since last research update
): FreshnessChange[] {
  const changes: FreshnessChange[] = [];

  if (!currentAvailable) {
    changes.push({
      changeType:       "DATA_UNAVAILABLE",
      dataSource:       "research",
      description:      "Current research data is unavailable for this symbol.",
      savedFreshness,
      currentFreshness: "unavailable",
    });
    return changes;
  }

  if (currentOpportunityAge !== null && currentOpportunityAge !== undefined) {
    const STALE_THRESHOLD_HOURS = 48;
    if (currentOpportunityAge > STALE_THRESHOLD_HOURS) {
      changes.push({
        changeType:       "DATA_BECAME_STALE",
        dataSource:       "research",
        description:      `Research data is ${Math.round(currentOpportunityAge)}h old (threshold: ${STALE_THRESHOLD_HOURS}h).`,
        savedFreshness,
        currentFreshness: "stale",
      });
    }
  }

  return changes;
}

/**
 * Determine lifecycle state from all computed changes and freshness.
 */
/**
 * How long an explicit user research review acknowledgement clears
 * the REQUIRES_REVIEW lifecycle state. After this window, the user
 * must review again (in case new changes have accumulated).
 */
const REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS = 7;

export function computeLifecycleState(params: {
  planStatus:           string;
  currentAvailable:     boolean;
  freshnessChanges:     FreshnessChange[];
  researchChanges:      ResearchChangeItem[];
  invalidationChanges:  InvalidationChange[];
  structureChanges:     StructureChangeItem[];
  /**
   * Timestamp of the last explicit user research-review acknowledgement.
   * Only used as a fallback when no reviewedStateChanges are available (legacy plans).
   *
   * Does NOT clear THESIS_INVALIDATED, DATA_STALE, or SYMBOL_NOT_QUALIFIED;
   * those take priority and cannot be cleared by review alone.
   */
  lastReviewedAt?:          Date | null;
  /**
   * Pre-computed changes between the reviewed research baseline (lastReviewedResearchState)
   * and the current OppIntel state.  Computed by evaluateTradePlanLifecycle() via
   * computeResearchChanges(lastReviewedResearchState, currentSummary) — the SAME comparator
   * used for plan-creation → current changes.
   *
   * Review validity rule (primary, state-anchored):
   *   - no material changes in reviewedStateChanges → review is valid → CURRENT
   *   - material changes present → scores/qualification drifted since review → REQUIRES_REVIEW
   *   - null → no reviewed baseline stored (plans reviewed before this fix) → use legacy fallback
   *
   * This correctly handles repeated scans with identical scores: the same scan data produces
   * the same change vector → no material change → CURRENT (scan timestamp is irrelevant).
   * Only genuine score/qualification movement triggers re-review.
   */
  reviewedStateChanges?:    ResearchChangeItem[] | null;
  /**
   * True when getCanonicalOpportunity() returned null without throwing an exception.
   * Means the symbol was specifically excluded from the current qualified-candidate
   * snapshot — not a transient system error.
   *
   * When true:
   *   - lifecycle state = REQUIRES_REVIEW (not UNKNOWN)
   *   - reason = QUALIFICATION_LOST
   *   - lastReviewedAt does NOT clear this state — the symbol remains unqualified
   *   - execution preflight continues to block
   */
  symbolNotQualified?:      boolean;
}): LifecycleState {
  const {
    planStatus,
    currentAvailable,
    freshnessChanges,
    researchChanges,
    invalidationChanges,
    structureChanges,
    lastReviewedAt,
    reviewedStateChanges,
    symbolNotQualified,
  } = params;

  if (planStatus === "ARCHIVED" || planStatus === "INVALIDATED") return "ARCHIVED";

  // Symbol specifically not in current qualified-candidate list → REQUIRES_REVIEW.
  // This takes priority over UNKNOWN (which is for transient system errors).
  // Review acknowledgement does NOT clear this — the user can review and acknowledge
  // but the symbol remains unqualified until OppIntel re-qualifies it.
  if (symbolNotQualified) return "REQUIRES_REVIEW";

  // Data unavailable due to a system/transient error (not a qualification decision).
  if (!currentAvailable) return "UNKNOWN";

  // Data stale check — review cannot clear this; data must be refreshed.
  const isDataStale = freshnessChanges.some(
    fc => fc.changeType === "DATA_BECAME_STALE" || fc.changeType === "DATA_UNAVAILABLE"
  );
  if (isDataStale) return "DATA_STALE";

  // Thesis invalidation — review cannot clear this; explicit action required.
  const hasInvalidation = invalidationChanges.some(ic => ic.observationState === "observed");
  if (hasInvalidation) return "THESIS_INVALIDATED";

  // Material research changes → requires review (or already reviewed and accepted).
  const hasMaterialChange = [
    ...researchChanges,
    ...structureChanges,
  ].some(c => c.isMaterial);

  if (hasMaterialChange) {
    // Check whether the user has explicitly reviewed and the review still covers current state.
    //
    // PRIMARY — state-anchored check (reviewedStateChanges available):
    //   computeResearchChanges() was called by evaluateTradePlanLifecycle() with
    //   lastReviewedResearchState as the "saved" baseline and currentSummary as "current".
    //   If the result has no material changes, the research state hasn't drifted beyond
    //   what the user acknowledged → CURRENT.
    //   If any change is material, scores/qualification moved since review → REQUIRES_REVIEW.
    //
    //   This correctly handles repeated scans with identical scores: the same scores
    //   produce the same (empty or non-material) change vector regardless of scan time.
    //   Only genuine score/qualification movement triggers re-review.
    //   Scan timestamps (generatedAt / asOf) play NO role.
    //
    // LEGACY FALLBACK (reviewedStateChanges is null — plan reviewed before fix deployed):
    //   Use the 7-day wall-clock window. Do not fabricate a reviewed baseline.
    //
    // THESIS_INVALIDATED, DATA_STALE, and SYMBOL_NOT_QUALIFIED always take priority (above).
    if (reviewedStateChanges !== null && reviewedStateChanges !== undefined) {
      // State-anchored: no material changes since reviewed baseline → still valid
      if (!reviewedStateChanges.some(c => c.isMaterial)) {
        return "CURRENT";
      }
      // Material changes occurred since the reviewed baseline — needs re-review
    } else if (lastReviewedAt) {
      // Legacy fallback: 7-day wall-clock window (no reviewed baseline stored)
      const reviewedAtMs = new Date(lastReviewedAt).getTime();
      if (!isNaN(reviewedAtMs)) {
        const ageDays = (Date.now() - reviewedAtMs) / (1000 * 60 * 60 * 24);
        if (ageDays <= REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS) {
          return "CURRENT";
        }
      }
    }
    return "REQUIRES_REVIEW";
  }

  // Minor changes
  const hasAnyChange = [
    ...researchChanges,
    ...structureChanges,
  ].length > 0;
  if (hasAnyChange) return "CHANGED";

  return "CURRENT";
}

/**
 * Build transparent review reasons from all changes.
 */
export function computeReviewReasons(params: {
  researchChanges:     ResearchChangeItem[];
  invalidationChanges: InvalidationChange[];
  structureChanges:    StructureChangeItem[];
  eventChanges:        EventChange[];
  liquidityChanges:    LiquidityChange[];
  freshnessChanges:    FreshnessChange[];
  /**
   * True when the symbol specifically dropped out of the OppIntel
   * qualified-candidate snapshot (not a transient system error).
   * Emits QUALIFICATION_LOST as the first (most prominent) review reason.
   */
  symbolNotQualified?: boolean;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];

  // Qualification lost — highest priority reason; emitted first.
  if (params.symbolNotQualified) {
    reasons.push({
      reasonType: "QUALIFICATION_LOST",
      description:
        "This symbol no longer qualifies in the latest Opportunity Intelligence snapshot. " +
        "Review the original research thesis against current conditions before continuing. " +
        "Acknowledging this review records your awareness but does not restore qualification.",
    });
    // When qualification is lost the remaining score-based reasons are unavailable
    // (no current data to compare). Return early to avoid spurious CRITICAL_DATA_STALE.
    return reasons;
  }
  const { researchChanges, invalidationChanges, structureChanges, eventChanges, liquidityChanges, freshnessChanges } = params;

  // Qualification loss
  if (researchChanges.some(c => c.changeType === "NO_LONGER_QUALIFIED")) {
    reasons.push({
      reasonType: "QUALIFICATION_LOST",
      description: "The symbol no longer meets research qualification criteria.",
    });
  }

  // Research score materially weakened
  const weakened = researchChanges.find(c => c.changeType === "RESEARCH_WEAKENED" && c.isMaterial);
  if (weakened) {
    reasons.push({
      reasonType: "RESEARCH_SCORE_MATERIALLY_WEAKENED",
      description: weakened.description,
    });
  }

  // Technical invalidation
  const techWeak = researchChanges.find(c => c.changeType === "TECHNICAL_WEAKENED" && c.isMaterial);
  if (techWeak) {
    reasons.push({
      reasonType: "TECHNICAL_INVALIDATION_OBSERVED",
      description: techWeak.description,
    });
  }

  // Thesis invalidation
  if (invalidationChanges.some(ic => ic.observationState === "observed")) {
    reasons.push({
      reasonType: "THESIS_INVALIDATION_OBSERVED",
      description: "One or more saved research thesis invalidation conditions are currently observed.",
    });
  }

  // Critical data stale
  if (freshnessChanges.some(fc => fc.changeType === "DATA_BECAME_STALE" || fc.changeType === "DATA_UNAVAILABLE")) {
    reasons.push({
      reasonType: "CRITICAL_DATA_STALE",
      description: "One or more required research data sources are stale or unavailable.",
    });
  }

  // Earnings entering lifetime
  if (eventChanges.some(ec => ec.changeType === "EVENT_ENTERED_LIFETIME")) {
    reasons.push({
      reasonType: "EARNINGS_INSIDE_STRUCTURE_LIFETIME",
      description: "An earnings or market event has entered the plan research window.",
    });
  }

  // Liquidity degraded
  if (liquidityChanges.some(lc => lc.changeType === "LIQUIDITY_WEAKENED" || lc.changeType === "QUOTE_STALE")) {
    reasons.push({
      reasonType: "LIQUIDITY_DEGRADED",
      description: "Liquidity or quote quality has degraded since plan creation.",
    });
  }

  // Expiration approaching
  if (structureChanges.some(sc => sc.changeType === "EXPIRATION_APPROACHING" || sc.changeType === "EXPIRATION_NEAR")) {
    reasons.push({
      reasonType: "EXPIRATION_APPROACHING",
      description: "The saved options structure is approaching or near expiration.",
    });
  }

  // Regime changed
  if (researchChanges.some(c => c.changeType === "REGIME_CHANGED")) {
    reasons.push({
      reasonType: "MARKET_REGIME_CHANGED",
      description: `Market regime has changed since plan creation.`,
    });
  }

  return reasons;
}

// ============================================================================
// Build lifecycle research summary from canonical opportunity
// ============================================================================

function _buildCurrentSummary(opp: any | null): LifecycleResearchSummary | null {
  if (!opp) return null;
  return {
    researchScore:       opp.researchScore ?? 0,
    technicalScore:      opp.technicalScore ?? 0,
    fundamentalScore:    opp.fundamentalScore ?? 0,
    institutionalScore:  opp.institutionalScore ?? 0,
    riskLevel:           opp.riskLevel ?? "unknown",
    qualified:           opp.qualified ?? opp.researchScore >= 60,
    marketRegime:        opp.marketRegime ?? null,
    sector:              opp.sector ?? null,
    themes:              opp.themes ?? [],
    asOf:                opp.generatedAt ?? new Date().toISOString(),
    available:           true,
  };
}

function _buildSavedSummary(snapshot: TradePlanResearchSnapshot): LifecycleResearchSummary {
  return {
    researchScore:      snapshot.researchScore,
    technicalScore:     snapshot.technicalScore,
    fundamentalScore:   snapshot.fundamentalScore,
    institutionalScore: snapshot.institutionalScore,
    riskLevel:          snapshot.riskLevel,
    qualified:          (snapshot as any).qualified ?? snapshot.researchScore >= 60,
    marketRegime:       snapshot.marketRegime ?? null,
    sector:             snapshot.sector ?? null,
    themes:             snapshot.themes ?? [],
    asOf:               snapshot.generatedAt,
    available:          true,
  };
}

function _computeFreshness(
  currentSummary: LifecycleResearchSummary | null,
  freshnessChanges: FreshnessChange[],
): "fresh" | "recent" | "stale" | "unknown" {
  if (!currentSummary || !currentSummary.available) return "unknown";
  if (freshnessChanges.some(f => f.changeType === "DATA_UNAVAILABLE")) return "unknown";
  if (freshnessChanges.some(f => f.changeType === "DATA_BECAME_STALE")) return "stale";
  // Assess age of current data
  const ageMs = Date.now() - new Date(currentSummary.asOf).getTime();
  const ageH  = ageMs / (1000 * 60 * 60);
  if (ageH < 4)  return "fresh";
  if (ageH < 24) return "recent";
  return "stale";
}

// ============================================================================
// Main evaluation function
// ============================================================================

/**
 * Evaluate the lifecycle of a single trade plan.
 * Server-authoritative: looks up plan from DB, fetches current research,
 * computes deterministic lifecycle state.
 * Uses 5-min in-memory cache per user+plan.
 */
export async function evaluateTradePlanLifecycle(
  userId: string,
  tradePlanId: string,
  opts?: { force?: boolean },
): Promise<TradePlanLifecycleResult> {
  const startMs = Date.now();
  const cacheKey = _lifecycleCacheKey(userId, tradePlanId);

  // Return cached if fresh and not forced
  if (!opts?.force) {
    const cached = getCachedLifecycleResult(userId, tradePlanId);
    if (cached) return cached;
  }

  // Concurrency guard
  if (_evaluating.has(cacheKey)) {
    // Wait for the in-flight evaluation (simple poll)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      const result = getCachedLifecycleResult(userId, tradePlanId);
      if (result) return result;
    }
    // Give up and evaluate anyway
  }

  _evaluating.add(cacheKey);

  try {
    // 1. Load plan from DB (strict ownership)
    const planRows = await db
      .select()
      .from(tradePlans)
      .where(and(eq(tradePlans.id, tradePlanId), eq(tradePlans.userId, userId)))
      .limit(1);

    if (!planRows.length) {
      throw new Error(`Trade plan not found: ${tradePlanId}`);
    }

    const plan = planRows[0];
    const researchSnapshot = plan.researchSnapshot as unknown as TradePlanResearchSnapshot;
    const structureSnapshot = plan.structureSnapshot as Record<string, unknown> | null;

    _logStructured("trade_plan_lifecycle_started", {
      durationMs:         0,
      planType:           plan.planType,
      lifecycleState:     plan.planHealth ?? "UNKNOWN",
      changeCount:        0,
      riskFlagCount:      0,
      hasEventChange:     false,
      hasLiquidityChange: false,
    });

    // 2. Fetch current opportunity (degrades gracefully if unavailable)
    //
    // Key distinction:
    //   null returned (no exception) → symbol specifically NOT in qualified-candidate list
    //                                  → symbolNotQualified = true → REQUIRES_REVIEW
    //   exception thrown             → transient system error
    //                                  → symbolNotQualified = false → UNKNOWN
    //
    // This separation is intentional: "dropped from the list" is a research event
    // the user must acknowledge; "OppIntel is down" is not the user's concern.
    let currentOpportunity: any = null;
    let symbolNotQualified = false;
    let opportunityFetchError = false;
    try {
      currentOpportunity = await getCanonicalOpportunity(plan.symbol);
      if (currentOpportunity === null) {
        // Symbol specifically not present in the latest qualified-candidate snapshot.
        symbolNotQualified = true;
      }
    } catch {
      // Transient system error — treat as data temporarily unavailable (UNKNOWN).
      opportunityFetchError = true;
    }

    const currentSummary  = _buildCurrentSummary(currentOpportunity);
    const savedSummary    = _buildSavedSummary(researchSnapshot);
    // currentAvailable = false when either symbolNotQualified OR opportunityFetchError
    const currentAvailable = currentSummary !== null;

    // 3. Compute DTE for options plans
    let currentDTE: number | null = null;
    if (plan.planType === "OPTIONS" && structureSnapshot) {
      const savedExpiration: string | null = (structureSnapshot as any).expiration ?? null;
      if (savedExpiration) {
        const expDate = new Date(savedExpiration);
        const nowDate = new Date();
        const diffMs  = expDate.getTime() - nowDate.getTime();
        currentDTE = Math.round(diffMs / (1000 * 60 * 60 * 24));
      }
    }

    // 4. Compute all change vectors
    const researchChanges   = currentSummary
      ? computeResearchChanges(researchSnapshot, currentSummary)
      : [];

    const invalidationChanges = computeInvalidationChanges(
      researchSnapshot,
      currentSummary,
    );

    const structureChanges = computeStructureChanges(
      plan.planType,
      structureSnapshot,
      currentDTE,
    );

    // Event and liquidity changes — informational stubs (no event feed in 2.7.6)
    const eventChanges:     EventChange[]     = [];
    const liquidityChanges: LiquidityChange[] = [];

    const currentOpportunityAgeH = currentSummary
      ? (Date.now() - new Date(currentSummary.asOf).getTime()) / (1000 * 60 * 60)
      : null;

    const freshnessChanges = computeFreshnessChanges(
      plan.freshnessAtCreation,
      currentAvailable,
      currentOpportunityAgeH,
    );

    // 5. Compute lifecycle state
    // Read review acknowledgement fields from the plan row.
    const lastReviewedAt          = (plan as any).lastReviewedAt ?? null;
    const lastReviewedResearchState: ReviewedResearchState | null =
      (plan as any).lastReviewedResearchState ?? null;

    // Compute changes between the reviewed baseline and current state.
    // Uses the SAME comparator as plan-creation → current (no separate threshold logic).
    // reviewedStateChanges === null means no baseline is stored (legacy plan) → fallback.
    let reviewedStateChanges: ResearchChangeItem[] | null = null;
    if (lastReviewedResearchState && currentSummary) {
      reviewedStateChanges = computeResearchChanges(
        lastReviewedResearchState as unknown as TradePlanResearchSnapshot,
        currentSummary,
      );
    }

    // Diagnostic log: emitted whenever there are material changes (vs saved plan) so
    // operators can trace why a plan is CURRENT vs REQUIRES_REVIEW in production.
    if (researchChanges.some(c => c.isMaterial) || structureChanges.some(c => c.isMaterial)) {
      console.log("[lifecycle:diagnostic]", JSON.stringify({
        planId:                    tradePlanId,
        symbol:                    plan.symbol,
        lastReviewedAt:            lastReviewedAt ? new Date(lastReviewedAt).toISOString() : null,
        reviewedStateAvailable:    lastReviewedResearchState !== null,
        reviewedStateHasMaterial:  reviewedStateChanges
          ? reviewedStateChanges.some(c => c.isMaterial)
          : null,
        materialPlanChanges:       researchChanges.filter(c => c.isMaterial).map(c => c.changeType),
        materialStructureChanges:  structureChanges.filter(c => c.isMaterial).map(c => c.changeType),
      }));
    }

    const lifecycleState = computeLifecycleState({
      planStatus:           plan.status,
      currentAvailable,
      freshnessChanges,
      researchChanges,
      invalidationChanges,
      structureChanges,
      lastReviewedAt,
      reviewedStateChanges,
      symbolNotQualified,
    });

    // 6. Compute review reasons (transparent, no opaque score)
    const reviewReasons = computeReviewReasons({
      researchChanges,
      invalidationChanges,
      structureChanges,
      eventChanges,
      liquidityChanges,
      freshnessChanges,
      symbolNotQualified,
    });

    const requiresReview = reviewReasons.length > 0;

    // 7. Limitations
    const limitations: string[] = [];
    if (symbolNotQualified) {
      limitations.push(
        `${plan.symbol} is not present in the latest qualified-candidate snapshot. ` +
        "Historical saved research is available. Current comparison data is unavailable."
      );
    } else if (!currentAvailable) {
      limitations.push("Current research data is temporarily unavailable for this symbol.");
    }
    if (plan.planType === "OPTIONS" && currentDTE === null)
      limitations.push("Current DTE could not be computed (expiration date unavailable in snapshot).");
    if (eventChanges.length === 0 && plan.planType === "OPTIONS")
      limitations.push("Event calendar not evaluated in Sprint 2.7.6 (requires event feed integration).");
    if (liquidityChanges.length === 0 && plan.planType === "OPTIONS")
      limitations.push("Live liquidity comparison not evaluated (requires current options chain).");

    const freshness = _computeFreshness(currentSummary, freshnessChanges);
    const expirationState: ExpirationState | undefined =
      plan.planType === "OPTIONS" ? computeExpirationState(currentDTE) : undefined;

    const symbolQualificationStatus: import("../../shared/trade-plan-lifecycle-types").SymbolQualificationStatus =
      symbolNotQualified    ? "NOT_QUALIFIED" :
      opportunityFetchError ? "UNKNOWN" :
      currentAvailable      ? "QUALIFIED" :
      "UNKNOWN";

    const result: TradePlanLifecycleResult = {
      tradePlanId,
      symbol:               plan.symbol,
      evaluatedAt:          new Date().toISOString(),
      savedPlanStatus:      plan.status,
      lifecycleState,
      symbolQualificationStatus,
      expirationState,
      currentDTE:           plan.planType === "OPTIONS" ? currentDTE : undefined,
      researchChanges,
      invalidationChanges,
      structureChanges,
      eventChanges,
      liquidityChanges,
      freshnessChanges,
      currentResearchSummary:  currentSummary,
      savedResearchSummary:    savedSummary,
      requiresReview,
      reviewReasons,
      limitations,
      freshness,
      methodologyVersion:   LIFECYCLE_METHODOLOGY_VERSION,
    };

    // 8. Cache result
    _cacheLifecycleResult(userId, tradePlanId, result);

    // 9. Update plan health in DB (fire-and-forget, non-blocking)
    const newHealth = _lifecycleStateToHealth(lifecycleState);
    if (newHealth !== plan.planHealth) {
      db.update(tradePlans)
        .set({ planHealth: newHealth, updatedAt: new Date() })
        .where(and(eq(tradePlans.id, tradePlanId), eq(tradePlans.userId, userId)))
        .catch((e: any) => console.error("[lifecycle] health update failed:", e?.message));
    }

    const durationMs = Date.now() - startMs;
    _recordEvaluation(lifecycleState, durationMs);

    _logStructured("trade_plan_lifecycle_completed", {
      durationMs,
      planType:       plan.planType,
      lifecycleState,
      changeCount:    researchChanges.length + structureChanges.length,
      riskFlagCount:  structureChanges.filter(s => s.isMaterial).length,
      hasEventChange: eventChanges.length > 0,
      hasLiquidityChange: liquidityChanges.length > 0,
    });

    if (lifecycleState === "REQUIRES_REVIEW") {
      _logStructured("trade_plan_review_required", {
        durationMs,
        planType: plan.planType,
        lifecycleState,
        changeCount: reviewReasons.length,
        riskFlagCount: 0,
        hasEventChange: false,
        hasLiquidityChange: false,
      });
    }
    if (lifecycleState === "THESIS_INVALIDATED") {
      _logStructured("trade_plan_thesis_invalidated", {
        durationMs,
        planType: plan.planType,
        lifecycleState,
        changeCount: invalidationChanges.filter(i => i.observationState === "observed").length,
        riskFlagCount: 0,
        hasEventChange: false,
        hasLiquidityChange: false,
      });
    }

    return result;
  } catch (err: any) {
    _recordEvaluationFailure();
    _logStructured("trade_plan_lifecycle_failed", {
      durationMs:    Date.now() - startMs,
      planType:      "unknown",
      lifecycleState: "UNKNOWN",
      changeCount:   0,
      riskFlagCount: 0,
      hasEventChange: false,
      hasLiquidityChange: false,
    });
    throw err;
  } finally {
    _evaluating.delete(cacheKey);
  }
}

/** Map lifecycle state to TradePlanHealth value */
function _lifecycleStateToHealth(state: LifecycleState): string {
  const map: Record<LifecycleState, string> = {
    CURRENT:            "CURRENT",
    CHANGED:            "CHANGED",
    REQUIRES_REVIEW:    "REQUIRES_REVIEW",
    THESIS_INVALIDATED: "THESIS_INVALIDATED",
    DATA_STALE:         "DATA_STALE",
    ARCHIVED:           "UNKNOWN",
    UNKNOWN:            "UNKNOWN",
  };
  return map[state] ?? "UNKNOWN";
}

// ============================================================================
// Batch evaluation
// ============================================================================

/**
 * Evaluate all active plans for a single user.
 * Batches plan DB query, reuses OpportunityIntelligence (no N+1 scanner calls).
 */
export async function evaluateUserTradePlans(
  userId: string,
): Promise<{ planId: string; result: TradePlanLifecycleResult | null; error?: string }[]> {
  const plans = await db
    .select()
    .from(tradePlans)
    .where(and(
      eq(tradePlans.userId, userId),
      inArray(tradePlans.status, ["DRAFT", "RESEARCH_COMPLETE", "MONITORING"]),
    ))
    .orderBy(desc(tradePlans.updatedAt))
    .limit(50);

  const results = await Promise.all(
    plans.map(async (p) => {
      try {
        const result = await evaluateTradePlanLifecycle(userId, p.id);
        return { planId: p.id, result };
      } catch (e: any) {
        return { planId: p.id, result: null, error: e?.message };
      }
    })
  );

  return results;
}

/**
 * Evaluate all active plans across all users.
 * Scheduler-ready — NOT wired to cron in 2.7.6 (see SCHEDULER_NOTE).
 * Returns aggregate counts; no user-identifying data.
 */
export async function evaluateAllActiveTradePlans(): Promise<{
  total:    number;
  success:  number;
  failed:   number;
  stateCounts: Record<LifecycleState, number>;
}> {
  const plans = await db
    .select({ id: tradePlans.id, userId: tradePlans.userId })
    .from(tradePlans)
    .where(inArray(tradePlans.status, ["DRAFT", "RESEARCH_COMPLETE", "MONITORING"]))
    .limit(200);

  const stateCounts: Record<LifecycleState, number> = {
    CURRENT: 0, CHANGED: 0, REQUIRES_REVIEW: 0,
    THESIS_INVALIDATED: 0, DATA_STALE: 0, ARCHIVED: 0, UNKNOWN: 0,
  };
  let success = 0, failed = 0;

  await Promise.all(
    plans.map(async (p) => {
      try {
        const r = await evaluateTradePlanLifecycle(p.userId, p.id);
        stateCounts[r.lifecycleState]++;
        success++;
      } catch {
        failed++;
      }
    })
  );

  return { total: plans.length, success, failed, stateCounts };
}

// ============================================================================
// Activity persistence
// ============================================================================

/**
 * Build a deduplication fingerprint.
 * Fingerprint = SHA256(tradePlanId + activityType + currentState + dataVersion).
 */
export function buildActivityFingerprint(
  tradePlanId:   string,
  activityType:  string,
  currentState:  string,
  dataVersion:   string,
): string {
  const raw = `${tradePlanId}|${activityType}|${currentState}|${dataVersion}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Persist lifecycle activity events for a trade plan.
 * Deduplicates by fingerprint within DEDUP_WINDOW_HOURS.
 * Fire-and-forget (does not throw).
 */
export async function persistLifecycleActivity(
  userId:       string,
  tradePlanId:  string,
  activities:   Omit<TradePlanActivity, "id" | "tradePlanId" | "userId" | "fingerprint">[],
): Promise<TradePlanActivity[]> {
  if (!activities.length) return [];

  const now = new Date();
  const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000);

  // Load fingerprints already stored in the dedup window
  const existingRows = await db
    .select({ fingerprint: tradePlanActivity.fingerprint })
    .from(tradePlanActivity)
    .where(and(
      eq(tradePlanActivity.tradePlanId, tradePlanId),
      sql`${tradePlanActivity.observedAt} >= ${dedupWindowStart.toISOString()}`,
    ));

  const existingFingerprints = new Set(existingRows.map(r => r.fingerprint));

  const toInsert: InsertTradePlanActivityArgs[] = [];
  for (const act of activities) {
    const fp = buildActivityFingerprint(
      tradePlanId,
      act.activityType,
      act.currentState ?? "",
      LIFECYCLE_METHODOLOGY_VERSION,
    );
    if (existingFingerprints.has(fp)) continue; // duplicate
    existingFingerprints.add(fp);

    toInsert.push({
      tradePlanId,
      userId,
      activityType:  act.activityType,
      observedAt:    new Date(act.observedAt),
      previousState: act.previousState ?? null,
      currentState:  act.currentState ?? null,
      summary:       act.summary,
      metadata:      act.metadata ?? {},
      fingerprint:   fp,
    });
  }

  if (!toInsert.length) return [];

  const inserted = await db
    .insert(tradePlanActivity)
    .values(toInsert)
    .returning();

  return inserted.map(_activityRowToModel);
}

interface InsertTradePlanActivityArgs {
  tradePlanId:   string;
  userId:        string;
  activityType:  string;
  observedAt:    Date;
  previousState: string | null;
  currentState:  string | null;
  summary:       string;
  metadata:      Record<string, unknown>;
  fingerprint:   string;
}

function _activityRowToModel(row: TradePlanActivityRow): TradePlanActivity {
  return {
    id:            row.id,
    tradePlanId:   row.tradePlanId,
    userId:        row.userId,
    activityType:  row.activityType as ActivityEventType,
    observedAt:    row.observedAt?.toISOString() ?? new Date().toISOString(),
    previousState: row.previousState ?? null,
    currentState:  row.currentState ?? null,
    summary:       row.summary,
    metadata:      row.metadata as Record<string, unknown>,
    fingerprint:   row.fingerprint,
  };
}

/**
 * Build activity events from a lifecycle evaluation result.
 * Only emits events for meaningful state changes.
 */
export function buildActivitiesFromLifecycleResult(
  result: TradePlanLifecycleResult,
  previousLifecycleState: LifecycleState | null,
): Omit<TradePlanActivity, "id" | "tradePlanId" | "userId" | "fingerprint">[] {
  const activities: Omit<TradePlanActivity, "id" | "tradePlanId" | "userId" | "fingerprint">[] = [];
  const now = result.evaluatedAt;

  // Research thesis invalidated
  if (result.lifecycleState === "THESIS_INVALIDATED" && previousLifecycleState !== "THESIS_INVALIDATED") {
    activities.push({
      activityType:  "THESIS_INVALIDATION_OBSERVED",
      observedAt:    now,
      previousState: previousLifecycleState ?? "UNKNOWN",
      currentState:  "THESIS_INVALIDATED",
      summary:       "Research Thesis Invalidation Condition Observed",
      metadata: {
        invalidationCount: result.invalidationChanges.filter(i => i.observationState === "observed").length,
        methodologyVersion: result.methodologyVersion,
      },
    });
  }

  // Review required
  if (result.lifecycleState === "REQUIRES_REVIEW" && previousLifecycleState !== "REQUIRES_REVIEW") {
    activities.push({
      activityType:  "REVIEW_REQUIRED",
      observedAt:    now,
      previousState: previousLifecycleState ?? "UNKNOWN",
      currentState:  "REQUIRES_REVIEW",
      summary:       `Research Review Required: ${result.reviewReasons.map(r => r.reasonType).join(", ")}`,
      metadata: {
        reviewReasonCount: result.reviewReasons.length,
        reviewReasons:     result.reviewReasons.map(r => r.reasonType),
        methodologyVersion: result.methodologyVersion,
      },
    });
  }

  // Data stale
  if (result.lifecycleState === "DATA_STALE" && previousLifecycleState !== "DATA_STALE") {
    activities.push({
      activityType:  "DATA_STALE",
      observedAt:    now,
      previousState: previousLifecycleState ?? "UNKNOWN",
      currentState:  "DATA_STALE",
      summary:       "Critical research data became stale",
      metadata:      { methodologyVersion: result.methodologyVersion },
    });
  }

  // Research weakened (material)
  const weakened = result.researchChanges.find(c => c.changeType === "RESEARCH_WEAKENED" && c.isMaterial);
  if (weakened) {
    activities.push({
      activityType:  "RESEARCH_WEAKENED",
      observedAt:    now,
      previousState: String(weakened.savedValue ?? ""),
      currentState:  String(weakened.currentValue ?? ""),
      summary:       weakened.description,
      metadata:      { delta: weakened.delta, methodologyVersion: result.methodologyVersion },
    });
  }

  // Research strengthened (material)
  const strengthened = result.researchChanges.find(c => c.changeType === "RESEARCH_STRENGTHENED" && c.isMaterial);
  if (strengthened) {
    activities.push({
      activityType:  "RESEARCH_STRENGTHENED",
      observedAt:    now,
      previousState: String(strengthened.savedValue ?? ""),
      currentState:  String(strengthened.currentValue ?? ""),
      summary:       strengthened.description,
      metadata:      { delta: strengthened.delta, methodologyVersion: result.methodologyVersion },
    });
  }

  // Qualification changed
  const qualChange = result.researchChanges.find(c =>
    c.changeType === "NEWLY_QUALIFIED" || c.changeType === "NO_LONGER_QUALIFIED"
  );
  if (qualChange) {
    activities.push({
      activityType:  "QUALIFICATION_CHANGED",
      observedAt:    now,
      previousState: String(qualChange.savedValue ?? ""),
      currentState:  String(qualChange.currentValue ?? ""),
      summary:       qualChange.description,
      metadata:      { methodologyVersion: result.methodologyVersion },
    });
  }

  // Regime changed
  const regimeChange = result.researchChanges.find(c => c.changeType === "REGIME_CHANGED");
  if (regimeChange) {
    activities.push({
      activityType:  "REGIME_CHANGED",
      observedAt:    now,
      previousState: String(regimeChange.savedValue ?? ""),
      currentState:  String(regimeChange.currentValue ?? ""),
      summary:       regimeChange.description,
      metadata:      { methodologyVersion: result.methodologyVersion },
    });
  }

  // Expiration approaching
  if (result.structureChanges.some(s => s.changeType === "EXPIRATION_APPROACHING" || s.changeType === "EXPIRATION_NEAR")) {
    activities.push({
      activityType:  "EXPIRATION_APPROACHING",
      observedAt:    now,
      previousState: null,
      currentState:  result.expirationState ?? null,
      summary:       `Contract approaching expiration (${result.currentDTE !== null && result.currentDTE !== undefined ? result.currentDTE + " DTE" : "unknown DTE"})`,
      metadata:      { currentDTE: result.currentDTE, methodologyVersion: result.methodologyVersion },
    });
  }

  return activities;
}

// ============================================================================
// Activity retrieval
// ============================================================================

export async function getTradePlanActivities(
  userId:      string,
  tradePlanId: string,
  opts?: {
    category?: "research" | "risk" | "events" | "freshness" | "user_action";
    limit?:    number;
    offset?:   number;
  },
): Promise<{ activities: TradePlanActivity[]; total: number; hasMore: boolean }> {
  const limit  = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;

  // Validate ownership
  const planRows = await db
    .select({ id: tradePlans.id })
    .from(tradePlans)
    .where(and(eq(tradePlans.id, tradePlanId), eq(tradePlans.userId, userId)))
    .limit(1);
  if (!planRows.length) throw new Error("Plan not found");

  const rows = await db
    .select()
    .from(tradePlanActivity)
    .where(eq(tradePlanActivity.tradePlanId, tradePlanId))
    .orderBy(desc(tradePlanActivity.observedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const sliced  = hasMore ? rows.slice(0, limit) : rows;

  return {
    activities: sliced.map(_activityRowToModel),
    total:      sliced.length,
    hasMore,
  };
}

// ============================================================================
// Startup table initialization
// ============================================================================

export async function ensureTradePlanActivityTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_plan_activity (
        id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        trade_plan_id  VARCHAR NOT NULL,
        user_id        TEXT NOT NULL,
        activity_type  TEXT NOT NULL,
        observed_at    TIMESTAMPTZ DEFAULT NOW(),
        previous_state TEXT,
        current_state  TEXT,
        summary        TEXT NOT NULL,
        metadata       JSONB NOT NULL DEFAULT '{}',
        fingerprint    TEXT NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpa_plan_id ON trade_plan_activity(trade_plan_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpa_user_id ON trade_plan_activity(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpa_observed_at ON trade_plan_activity(trade_plan_id, observed_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpa_fingerprint ON trade_plan_activity(fingerprint)`);
    console.log(JSON.stringify({ event: "trade_plan_activity_table_ready", ts: new Date().toISOString() }));
  } catch (err: any) {
    console.error(JSON.stringify({ event: "trade_plan_activity_table_error", error: err?.message, ts: new Date().toISOString() }));
  }
}

// ============================================================================
// Structured logging (safe fields only — no capital, P/L, notes, user identity)
// ============================================================================

function _logStructured(event: string, meta: {
  durationMs:        number;
  planType:          string;
  lifecycleState:    string;
  changeCount:       number;
  riskFlagCount:     number;
  hasEventChange:    boolean;
  hasLiquidityChange: boolean;
}) {
  console.log(JSON.stringify({
    event,
    ...meta,
    ts: new Date().toISOString(),
  }));
}
