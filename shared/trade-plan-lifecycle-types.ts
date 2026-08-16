/**
 * shared/trade-plan-lifecycle-types.ts — Sprint 2.7.6
 *
 * Canonical types for Trade Monitoring & Lifecycle Intelligence.
 *
 * ROADMAP DISCIPLINE:
 * - These types describe RESEARCH OBSERVATIONS only.
 * - No execution instructions. No exit signals. No broker orders.
 * - No P/L. No suitability scoring. No "close position" semantics.
 */

// ============================================================================
// Lifecycle States
// ============================================================================

export const LIFECYCLE_STATES = [
  "CURRENT",
  "CHANGED",
  "REQUIRES_REVIEW",
  "THESIS_INVALIDATED",
  "DATA_STALE",
  "ARCHIVED",
  "UNKNOWN",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_STATE_LABELS: Record<LifecycleState, string> = {
  CURRENT:            "Research Current",
  CHANGED:            "Research Changed",
  REQUIRES_REVIEW:    "Research Review Required",
  THESIS_INVALIDATED: "Thesis Invalidation Observed",
  DATA_STALE:         "Data Stale",
  ARCHIVED:           "Archived",
  UNKNOWN:            "Unknown",
};

/** Lifecycle states that trigger a REQUIRES_REVIEW CTA */
export const REVIEW_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  "REQUIRES_REVIEW",
  "THESIS_INVALIDATED",
]);

// ============================================================================
// Expiration States (options-specific)
// ============================================================================

export const EXPIRATION_STATES = [
  "FAR_FROM_EXPIRATION",    // > 45 DTE remaining
  "APPROACHING_EXPIRATION", // 21–45 DTE remaining
  "NEAR_EXPIRATION",        // ≤ 20 DTE remaining
  "EXPIRED",                // DTE ≤ 0
  "UNKNOWN",
] as const;

export type ExpirationState = (typeof EXPIRATION_STATES)[number];

/**
 * DTE thresholds — documented here as the canonical source.
 * FAR_FROM_EXPIRATION: > 45 DTE
 * APPROACHING_EXPIRATION: > 20 and ≤ 45 DTE
 * NEAR_EXPIRATION: > 0 and ≤ 20 DTE
 * EXPIRED: ≤ 0 DTE
 */
export const DTE_THRESHOLDS = {
  FAR_MIN:          46,  // strictly more than APPROACHING threshold
  APPROACHING_MIN:  21,  // more than NEAR threshold
  NEAR_MIN:          1,  // more than 0
} as const;

export const EXPIRATION_STATE_LABELS: Record<ExpirationState, string> = {
  FAR_FROM_EXPIRATION:    "Far from Expiration",
  APPROACHING_EXPIRATION: "Approaching Expiration",
  NEAR_EXPIRATION:        "Near Expiration",
  EXPIRED:                "Expired",
  UNKNOWN:                "Expiration Unknown",
};

// ============================================================================
// Research Change Types
// ============================================================================

export const RESEARCH_CHANGE_TYPES = [
  "RESEARCH_STRENGTHENED",
  "RESEARCH_WEAKENED",
  "NEWLY_QUALIFIED",
  "NO_LONGER_QUALIFIED",
  "TECHNICAL_STRENGTHENED",
  "TECHNICAL_WEAKENED",
  "FUNDAMENTAL_CHANGED",
  "INSTITUTIONAL_CHANGED",
  "REGIME_CHANGED",
  "SECTOR_CONTEXT_CHANGED",
  "THEME_CONTEXT_CHANGED",
  "RISK_LEVEL_CHANGED",
  "EVIDENCE_CONFIDENCE_CHANGED",
] as const;

export type ResearchChangeType = (typeof RESEARCH_CHANGE_TYPES)[number];

export interface ResearchChangeItem {
  changeType: ResearchChangeType;
  savedValue: string | number | null;
  currentValue: string | number | null;
  delta: number | null;
  description: string;
  isMaterial: boolean;
}

// ============================================================================
// Invalidation Changes
// ============================================================================

export const INVALIDATION_OBSERVATION_STATES = [
  "observed",
  "notObserved",
  "unknown",
] as const;

export type InvalidationObservationState = (typeof INVALIDATION_OBSERVATION_STATES)[number];

export interface InvalidationChange {
  condition: string;
  description: string;
  observationState: InvalidationObservationState;
  /** What current data was compared to evaluate this condition */
  evaluationNote: string;
}

// ============================================================================
// Structure / Risk Changes (options-specific)
// ============================================================================

export const STRUCTURE_CHANGE_TYPES = [
  "EXPIRATION_APPROACHING",
  "EXPIRATION_NEAR",
  "EXPIRED",
  "CONSTRAINT_STATUS_CHANGED",
  "GREEKS_PARTIAL",
  "GREEKS_DEGRADED",
  "DTE_CHANGED",
] as const;

export type StructureChangeType = (typeof STRUCTURE_CHANGE_TYPES)[number];

export interface StructureChangeItem {
  changeType: StructureChangeType;
  description: string;
  savedValue: string | number | null;
  currentValue: string | number | null;
  isMaterial: boolean;
}

// ============================================================================
// Event Changes
// ============================================================================

export const EVENT_CHANGE_TYPES = [
  "EVENT_ENTERED_LIFETIME",
  "EVENT_APPROACHING",
  "EVENT_PASSED",
  "EVENT_DATE_CHANGED",
  "NO_EVENT_CHANGE",
] as const;

export type EventChangeType = (typeof EVENT_CHANGE_TYPES)[number];

export interface EventChange {
  changeType: EventChangeType;
  eventLabel: string;  // e.g. "Earnings", "FOMC"
  description: string;
  eventDate: string | null;
}

// ============================================================================
// Liquidity Changes
// ============================================================================

export const LIQUIDITY_CHANGE_TYPES = [
  "LIQUIDITY_IMPROVED",
  "LIQUIDITY_WEAKENED",
  "QUOTE_STALE",
  "NO_CHANGE",
] as const;

export type LiquidityChangeType = (typeof LIQUIDITY_CHANGE_TYPES)[number];

export interface LiquidityChange {
  changeType: LiquidityChangeType;
  description: string;
  savedLiquidityQuality: string | null;
  currentLiquidityQuality: string | null;
}

// ============================================================================
// Freshness Changes
// ============================================================================

export const FRESHNESS_CHANGE_TYPES = [
  "DATA_BECAME_STALE",
  "DATA_REFRESHED",
  "DATA_UNAVAILABLE",
  "NO_CHANGE",
] as const;

export type FreshnessChangeType = (typeof FRESHNESS_CHANGE_TYPES)[number];

export interface FreshnessChange {
  changeType: FreshnessChangeType;
  dataSource: string;   // e.g. "research", "market_data", "options_chain"
  description: string;
  savedFreshness: string | null;
  currentFreshness: string | null;
}

// ============================================================================
// Review Reasons
// ============================================================================

export const REVIEW_REASON_TYPES = [
  "QUALIFICATION_LOST",
  "RESEARCH_SCORE_MATERIALLY_WEAKENED",
  "TECHNICAL_INVALIDATION_OBSERVED",
  "CRITICAL_DATA_STALE",
  "EARNINGS_INSIDE_STRUCTURE_LIFETIME",
  "LIQUIDITY_DEGRADED",
  "EXPIRATION_APPROACHING",
  "MAX_LOSS_CONSTRAINT_EXCEEDED",
  "MARKET_REGIME_CHANGED",
  "THESIS_INVALIDATION_OBSERVED",
] as const;

export type ReviewReasonType = (typeof REVIEW_REASON_TYPES)[number];

export const REVIEW_REASON_LABELS: Record<ReviewReasonType, string> = {
  QUALIFICATION_LOST:                 "Qualification Lost",
  RESEARCH_SCORE_MATERIALLY_WEAKENED: "Research Score Materially Weakened",
  TECHNICAL_INVALIDATION_OBSERVED:    "Technical Invalidation Observed",
  CRITICAL_DATA_STALE:                "Critical Data Stale",
  EARNINGS_INSIDE_STRUCTURE_LIFETIME: "Earnings Now Inside Structure Lifetime",
  LIQUIDITY_DEGRADED:                 "Liquidity Degraded",
  EXPIRATION_APPROACHING:             "Expiration Approaching",
  MAX_LOSS_CONSTRAINT_EXCEEDED:       "Saved Max-Loss Constraint Exceeded",
  MARKET_REGIME_CHANGED:              "Market Regime Materially Changed",
  THESIS_INVALIDATION_OBSERVED:       "Research Thesis Invalidation Condition Observed",
};

export interface ReviewReason {
  reasonType: ReviewReasonType;
  description: string;
}

// ============================================================================
// Symbol Qualification Status
// ============================================================================

/**
 * Whether the plan's symbol currently qualifies in the Opportunity Intelligence
 * qualified-candidate snapshot.
 *
 * QUALIFIED     — symbol present in the latest qualified-candidate snapshot.
 * NOT_QUALIFIED — symbol specifically absent from the snapshot (dropped out).
 *                 Distinct from a system error — the OppIntel engine ran and
 *                 explicitly did not include this symbol.
 * UNKNOWN       — could not determine (system error / OppIntel unavailable).
 */
export type SymbolQualificationStatus = "QUALIFIED" | "NOT_QUALIFIED" | "UNKNOWN";

// ============================================================================
// Research Summary (saved and current)
// ============================================================================

export interface LifecycleResearchSummary {
  researchScore: number;
  technicalScore: number;
  fundamentalScore: number;
  institutionalScore: number;
  riskLevel: string;
  qualified: boolean;
  marketRegime: string | null;
  sector: string | null;
  themes: string[];
  asOf: string;    // ISO timestamp
  available: boolean;
}

/**
 * Snapshot of the research state at the moment the user clicked "Mark Research Reviewed".
 * Persisted as JSONB in trade_plans.last_reviewed_research_state.
 *
 * Intentionally does NOT include asOf / scan timestamps.
 * Scan execution time is irrelevant to review validity — only the research state matters.
 *
 * Structurally compatible with TradePlanResearchSnapshot for use with
 * computeResearchChanges(reviewedState as TradePlanResearchSnapshot, currentSummary).
 *
 * Review validity rule:
 *   On subsequent lifecycle evaluations, computeResearchChanges() is called with
 *   lastReviewedResearchState as the "saved" baseline.  If the result contains no
 *   material changes the review acknowledgement remains valid → CURRENT.
 *   If any material change has occurred since the review → REQUIRES_REVIEW.
 */
export interface ReviewedResearchState {
  researchScore:      number;
  technicalScore:     number;
  fundamentalScore:   number;
  institutionalScore: number;
  riskLevel:          string;
  qualified:          boolean;
  marketRegime:       string | null;
  sector:             string | null;
  themes:             string[];
}

// ============================================================================
// Canonical Lifecycle Result
// ============================================================================

export interface TradePlanLifecycleResult {
  tradePlanId: string;
  symbol: string;
  evaluatedAt: string;

  savedPlanStatus:  string;   // TradePlanStatus value
  lifecycleState:   LifecycleState;

  /**
   * Whether the plan's symbol currently qualifies in the Opportunity
   * Intelligence qualified-candidate snapshot.
   *
   * NOT_QUALIFIED means the symbol specifically dropped out — the OppIntel
   * engine ran and excluded it. This is different from UNKNOWN (system error).
   *
   * When NOT_QUALIFIED:
   * - lifecycleState === "REQUIRES_REVIEW"
   * - reviewReasons contains QUALIFICATION_LOST
   * - Review acknowledgement (lastReviewedAt) does NOT clear REQUIRES_REVIEW
   * - currentResearchSummary is null (no current candidate data available)
   * - Execution preflight continues to block
   */
  symbolQualificationStatus: SymbolQualificationStatus;

  // Option-specific
  expirationState?: ExpirationState;
  currentDTE?: number | null;

  // Categorized changes
  researchChanges:   ResearchChangeItem[];
  invalidationChanges: InvalidationChange[];
  structureChanges:  StructureChangeItem[];
  eventChanges:      EventChange[];
  liquidityChanges:  LiquidityChange[];
  freshnessChanges:  FreshnessChange[];

  currentResearchSummary:  LifecycleResearchSummary | null;
  savedResearchSummary:    LifecycleResearchSummary;

  requiresReview:    boolean;
  reviewReasons:     ReviewReason[];

  limitations:       string[];
  freshness:         "fresh" | "recent" | "stale" | "unknown";
  methodologyVersion: string;
}

export const LIFECYCLE_METHODOLOGY_VERSION = "2.7.6";

// ============================================================================
// Activity Event Types
// ============================================================================

export const ACTIVITY_EVENT_TYPES = [
  "PLAN_CREATED",
  "PLAN_STATUS_CHANGED",
  "PLAN_ARCHIVED",
  "PLAN_VERSION_CREATED",
  "LIFECYCLE_EVALUATED",
  "RESEARCH_STRENGTHENED",
  "RESEARCH_WEAKENED",
  "QUALIFICATION_CHANGED",
  "REGIME_CHANGED",
  "THESIS_INVALIDATION_OBSERVED",
  "REVIEW_REQUIRED",
  "DATA_STALE",
  "EXPIRATION_APPROACHING",
  "EVENT_ENTERED_LIFETIME",
  "LIQUIDITY_CHANGED",
  "USER_NOTES_UPDATED",
  "CHECKLIST_UPDATED",
  "RESEARCH_REVIEWED",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const ACTIVITY_EVENT_LABELS: Record<ActivityEventType, string> = {
  PLAN_CREATED:                   "Plan Created",
  PLAN_STATUS_CHANGED:            "Status Changed",
  PLAN_ARCHIVED:                  "Plan Archived",
  PLAN_VERSION_CREATED:           "New Version Saved",
  LIFECYCLE_EVALUATED:            "Lifecycle Evaluated",
  RESEARCH_STRENGTHENED:          "Research Strengthened",
  RESEARCH_WEAKENED:              "Research Weakened",
  QUALIFICATION_CHANGED:          "Qualification Changed",
  REGIME_CHANGED:                 "Market Regime Changed",
  THESIS_INVALIDATION_OBSERVED:   "Research Thesis Invalidation Condition Observed",
  REVIEW_REQUIRED:                "Research Review Required",
  DATA_STALE:                     "Data Became Stale",
  EXPIRATION_APPROACHING:         "Contract Approaching Expiration",
  EVENT_ENTERED_LIFETIME:         "Earnings / Event Entered Plan Lifetime",
  LIQUIDITY_CHANGED:              "Liquidity Changed",
  USER_NOTES_UPDATED:             "Notes Updated",
  CHECKLIST_UPDATED:              "Research Checklist Updated",
  RESEARCH_REVIEWED:              "Research Reviewed",
};

/**
 * Activity categories for timeline filtering.
 * The UI uses these groups — keep them stable.
 */
export const ACTIVITY_CATEGORY_MAP: Record<ActivityEventType, "research" | "risk" | "events" | "freshness" | "user_action"> = {
  PLAN_CREATED:                 "user_action",
  PLAN_STATUS_CHANGED:          "user_action",
  PLAN_ARCHIVED:                "user_action",
  PLAN_VERSION_CREATED:         "user_action",
  LIFECYCLE_EVALUATED:          "research",
  RESEARCH_STRENGTHENED:        "research",
  RESEARCH_WEAKENED:            "research",
  QUALIFICATION_CHANGED:        "research",
  REGIME_CHANGED:               "research",
  THESIS_INVALIDATION_OBSERVED: "research",
  REVIEW_REQUIRED:              "research",
  DATA_STALE:                   "freshness",
  EXPIRATION_APPROACHING:       "risk",
  EVENT_ENTERED_LIFETIME:       "events",
  LIQUIDITY_CHANGED:            "risk",
  USER_NOTES_UPDATED:           "user_action",
  CHECKLIST_UPDATED:            "user_action",
  RESEARCH_REVIEWED:            "user_action",
};

// ============================================================================
// Trade Plan Activity (persistence model)
// ============================================================================

export interface TradePlanActivity {
  id:           string;
  tradePlanId:  string;
  userId:       string;
  activityType: ActivityEventType;
  observedAt:   string;     // ISO timestamp
  previousState: string | null;
  currentState:  string | null;
  summary:       string;
  /** Metadata — safe for logging (no capital, P/L, notes, option legs, user identity) */
  metadata:      Record<string, unknown>;
  /** Fingerprint for deduplication */
  fingerprint:   string;
}

// ============================================================================
// API response shapes
// ============================================================================

export interface TradePlanLifecycleResponse {
  tradePlanId:      string;
  cached:           boolean;
  lifecycleResult:  TradePlanLifecycleResult;
}

export interface TradePlanActivityResponse {
  tradePlanId: string;
  activities:  TradePlanActivity[];
  total:       number;
  hasMore:     boolean;
}

export interface LifecycleEvaluateRequest {
  /** Optional: force re-evaluation even if cached result is fresh */
  force?: boolean;
}

export interface LifecycleEvaluateResponse {
  tradePlanId:      string;
  lifecycleResult:  TradePlanLifecycleResult;
  newActivities:    TradePlanActivity[];
  durationMs:       number;
}

// ============================================================================
// Platform Health metrics (admin aggregate — no user-specific data)
// ============================================================================

export interface TradePlanMonitoringHealthMetrics {
  plansEvaluated:              number;
  currentPlans:                number;
  changedPlans:                number;
  reviewRequiredPlans:         number;
  invalidatedPlans:            number;
  stalePlans:                  number;
  failedEvaluations:           number;
  averageEvaluationDurationMs: number | null;
  lastEvaluationAt:            string | null;
}

// ============================================================================
// Compliance
// ============================================================================

export const LIFECYCLE_DISCLAIMER =
  "Trade Monitoring & Lifecycle Intelligence compares a saved research plan " +
  "with current available research and market information. Lifecycle states " +
  "such as Requires Review or Thesis Invalidated are research observations, " +
  "not instructions to buy, sell, hold, close, roll, or otherwise transact.";

/**
 * Language that must NEVER appear in lifecycle-facing UI strings.
 * These are checked by the compliance regression suite.
 */
export const LIFECYCLE_FORBIDDEN_PHRASES = [
  "Exit Signal",
  "Sell Signal",
  "Close Now",
  "Take Profit",
  "Stop Loss Triggered",
  "Roll Recommended",
  "Adjustment Recommended",
  "Exit now",
  "Close the position",
  "Sell now",
  "Stop out",
] as const;

// ============================================================================
// Deduplication — documented contract
// ============================================================================

/**
 * Activity event deduplication fingerprint.
 *
 * A lifecycle event is considered a duplicate if, within the same trade plan,
 * an activity of the same type and current state was already recorded within
 * the deduplication window.
 *
 * Fingerprint components:
 *   - tradePlanId
 *   - activityType
 *   - currentState (coerced to string)
 *   - relevantDataVersion (e.g. "research-2026-08-10", lifecycle methodology version)
 *
 * Window: DEDUP_WINDOW_HOURS hours. Events outside the window may recur.
 */
export const DEDUP_WINDOW_HOURS = 24;

// ============================================================================
// Scheduler decision (documented)
// ============================================================================

/**
 * SCHEDULER DECISION (Sprint 2.7.6):
 *
 * The lifecycle evaluation service exposes a clean interface
 * (`evaluateTradePlanLifecycle`, `evaluateUserTradePlans`, `evaluateAllActiveTradePlans`)
 * that is scheduler-ready but NOT wired to any recurring cron job in this sprint.
 *
 * Rationale:
 * - Existing schedulers (scheduled-scan-service, agent-worker) are opinionated
 *   about their own domains and should not be silently extended with lifecycle
 *   evaluation work without explicit scope agreement.
 * - Manual evaluation (POST /lifecycle/evaluate) is available in 2.7.6.
 * - 2.7.7 (E2E Validation) will validate the full chain before any automated
 *   background evaluation is scheduled.
 *
 * When wiring to a scheduler:
 * - Use `evaluateAllActiveTradePlans()` from the lifecycle service.
 * - Add `trade_plan_monitoring` to job-status-store.
 * - Guard with a concurrency flag to prevent overlapping runs.
 */
export const SCHEDULER_NOTE =
  "Lifecycle evaluation is scheduler-ready but not auto-scheduled in Sprint 2.7.6. " +
  "Use POST /api/trade-plans/:id/lifecycle/evaluate for manual evaluation. " +
  "See Sprint 2.7.7 for automated scheduling.";
