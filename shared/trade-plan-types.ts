/**
 * shared/trade-plan-types.ts — Sprint 2.7.5 Trade Plan Workspace
 *
 * ARCHITECTURE RULE: The Trade Plan Workspace is the system of record for a
 * USER-SAVED RESEARCH PLAN. It may preserve research evidence, planning
 * assumptions, selected research structure, risk analysis, monitoring
 * conditions, and notes. It may compare saved research with current research.
 * It may NEVER silently rewrite the original research snapshot, replace a
 * user-selected strategy, replace a selected contract candidate, change
 * risk-analysis results, turn a research plan into an executable broker order,
 * or represent the saved plan as a system recommendation.
 *
 * DO NOT implement:
 * - broker order ticket or submission
 * - one-click or automated execution
 * - probability of profit / expected return
 * - suitability scoring or personalized recommendations
 * - "approved trade" / "recommended trade" language
 */

// ============================================================================
// Status Model
// ============================================================================

/** Non-prescriptive plan status. Never implies regulatory approval or execution readiness. */
export const TRADE_PLAN_STATUSES = [
  "DRAFT",              // User is still assembling/reviewing the research plan
  "RESEARCH_COMPLETE",  // User has reviewed available research and saved the plan
  "MONITORING",         // User wants to monitor research conditions over time
  "ARCHIVED",           // No longer active
  "INVALIDATED",        // Only if current evidence crossed a documented invalidation condition
] as const;

export type TradePlanStatus = typeof TRADE_PLAN_STATUSES[number];

export const TRADE_PLAN_STATUS_LABELS: Record<TradePlanStatus, string> = {
  DRAFT:              "Draft",
  RESEARCH_COMPLETE:  "Research Complete",
  MONITORING:         "Monitoring",
  ARCHIVED:           "Archived",
  INVALIDATED:        "Invalidated",
};

export const TRADE_PLAN_STATUS_DESCRIPTIONS: Record<TradePlanStatus, string> = {
  DRAFT:             "Research plan is being assembled and reviewed.",
  RESEARCH_COMPLETE: "Research has been reviewed and the plan has been saved.",
  MONITORING:        "Research conditions are being monitored over time.",
  ARCHIVED:          "This plan is no longer active.",
  INVALIDATED:       "A canonical thesis invalidation condition was observed.",
};

// ============================================================================
// Plan Type
// ============================================================================

export const TRADE_PLAN_TYPES = ["EQUITY", "OPTIONS"] as const;
export type TradePlanType = typeof TRADE_PLAN_TYPES[number];

export const TRADE_PLAN_TYPE_LABELS: Record<TradePlanType, string> = {
  EQUITY:  "Equity",
  OPTIONS: "Options",
};

// ============================================================================
// Plan Health (deterministic research state — NOT a trade status)
// ============================================================================

/** Deterministic research state. Not a trade status. */
export const TRADE_PLAN_HEALTH_VALUES = [
  "CURRENT",            // Research unchanged since plan creation
  "CHANGED",            // Research has changed (minor)
  "REQUIRES_REVIEW",    // Material evidence change detected
  "THESIS_INVALIDATED", // Canonical invalidation condition triggered
  "DATA_STALE",         // Critical data too stale to reliably evaluate
  "UNKNOWN",            // Cannot determine without current research
] as const;

export type TradePlanHealth = typeof TRADE_PLAN_HEALTH_VALUES[number];

export const TRADE_PLAN_HEALTH_LABELS: Record<TradePlanHealth, string> = {
  CURRENT:            "Current",
  CHANGED:            "Changed",
  REQUIRES_REVIEW:    "Requires Review",
  THESIS_INVALIDATED: "Thesis Invalidation Observed",
  DATA_STALE:         "Data Stale",
  UNKNOWN:            "Unknown",
};

export const TRADE_PLAN_HEALTH_DESCRIPTIONS: Record<TradePlanHealth, string> = {
  CURRENT:
    "Research evidence is materially consistent with evidence at plan creation.",
  CHANGED:
    "Research evidence has changed since plan creation, but no material threshold crossed.",
  REQUIRES_REVIEW:
    "A material evidence change has been detected. Review the current vs saved comparison.",
  THESIS_INVALIDATED:
    "A documented thesis invalidation condition was observed in current research. " +
    "This does not constitute exit advice.",
  DATA_STALE:
    "Critical market or research data is too stale to reliably evaluate plan health.",
  UNKNOWN:
    "Plan health cannot be determined without current research data.",
};

// ============================================================================
// Research Snapshot (preserved at plan creation)
// ============================================================================

/** Evidence item preserved in snapshot (compact). */
export interface SnapshotEvidenceItem {
  label:       string;
  description: string;
  type:        string;
}

/** Invalidation condition preserved in snapshot. */
export interface SnapshotInvalidationCondition {
  condition:   string;
  description: string;
}

/**
 * Compact research snapshot preserved at plan creation time.
 * Allows later comparison: Plan Creation Research vs Current Research.
 * Never re-scored or refreshed — immutable once saved.
 */
export interface TradePlanResearchSnapshot {
  opportunityId:      string | null;
  opportunityType:    string | null;
  researchScore:      number;
  technicalScore:     number;
  fundamentalScore:   number;
  institutionalScore: number;
  evidenceConfidence: string | null;
  riskLevel:          string;
  marketRegime:       string | null;
  sector:             string | null;
  themes:             string[];
  primaryEvidence:    SnapshotEvidenceItem[];
  secondaryEvidence:  SnapshotEvidenceItem[];
  riskFactors:        string[];
  invalidatesThesis:  SnapshotInvalidationCondition[];
  generatedAt:        string; // ISO
}

// ============================================================================
// Planning Snapshot
// ============================================================================

/**
 * Compact planning-context snapshot preserved at plan creation.
 * Does not include sensitive account information.
 */
export interface TradePlanPlanningSnapshot {
  planningContextId:         string;
  symbol:                    string;
  researchHorizon:           string | null;
  selectedExpressionFamily:  string;
  constraintsFingerprint:    string;
  goalContextSummary:        string | null;  // brief, no sensitive data
  portfolioContextSummary:   string | null;  // brief, no sensitive data
  limitations:               string[];
  generatedAt:               string; // ISO
}

// ============================================================================
// Equity Plan Snapshot
// ============================================================================

/**
 * Compact equity scenario summary preserved at plan creation.
 * Labels hypothetical quantities clearly. Never an order quantity field.
 */
export interface TradePlanEquitySnapshot {
  equityScenarioId:          string;
  referencePrice:            number | null;
  referencePriceSource:      string;
  entryFramework:            Record<string, unknown>;
  invalidationFramework:     Record<string, unknown>;
  hypotheticalSizing:        Record<string, unknown> | null;
  scenarioSummary:           Record<string, unknown> | null;
  monitoringPlan:            Record<string, unknown> | null;
  marketDataAsOf:            string | null;
  methodologyVersion:        string;
}

// ============================================================================
// Options Plan Snapshot
// ============================================================================

/**
 * Compact options structure snapshot preserved at plan creation.
 * Legs are RESEARCH STRUCTURE LEGS — not order legs.
 * No broker order instructions.
 */
export interface TradePlanOptionsSnapshot {
  candidateId:               string;
  strategyFamily:            string;
  strategyLabel:             string;
  expiration:                string;
  expirationLabel:           string;
  dte:                       number;
  legs:                      Record<string, unknown>[];
  estimatedMidpoint:         number | null;
  liquidityQuality:          string;
  greeks:                    Record<string, unknown> | null;
  eventContext:              Record<string, unknown> | null;
  riskAnalysisSummary:       Record<string, unknown> | null;
  methodologyVersion:        string;
}

// ============================================================================
// Risk Snapshot
// ============================================================================

/**
 * Compact risk-analysis summary preserved at plan creation.
 * Scenario grids are not persisted to keep storage manageable.
 */
export interface TradePlanRiskSnapshot {
  analysisId:        string;
  maxLoss:           Record<string, unknown> | null;
  maxGain:           Record<string, unknown> | null;
  breakevens:        Record<string, unknown>[];
  capitalProfile:    Record<string, unknown> | null;
  netGreeks:         Record<string, unknown> | null;
  riskFlags:         string[];
  eventExposure:     Record<string, unknown> | null;
  liquidityRisk:     Record<string, unknown> | null;
  constraintStatus:  string;
  scenarioConfig:    Record<string, unknown>;
  generatedAt:       string; // ISO
  methodologyVersion: string;
}

// ============================================================================
// Monitoring Snapshot
// ============================================================================

export interface TradePlanMonitoringSnapshot {
  monitoringPlan:        string | null;
  invalidationContext:   string | null;
  watchCriteria:         string[];
  monitoringStartedAt:   string | null;
  researchWatchId:       string | null;
}

// ============================================================================
// Review Checklist
// ============================================================================

/**
 * Personal research-review aid.
 * NOT an approval, compliance certification, or determination that a trade is appropriate.
 */
export interface TradePlanChecklist {
  reviewedResearchEvidence:    boolean;
  reviewedRiskFactors:         boolean;
  reviewedThesisInvalidation:  boolean;
  reviewedDataFreshness:       boolean;
  reviewedEventExposure:       boolean;
  reviewedLiquidity:           boolean;
  reviewedPlanningConstraints: boolean;
}

export const DEFAULT_TRADE_PLAN_CHECKLIST: TradePlanChecklist = {
  reviewedResearchEvidence:    false,
  reviewedRiskFactors:         false,
  reviewedThesisInvalidation:  false,
  reviewedDataFreshness:       false,
  reviewedEventExposure:       false,
  reviewedLiquidity:           false,
  reviewedPlanningConstraints: false,
};

// ============================================================================
// Canonical TradePlan
// ============================================================================

/**
 * The canonical TradePlan.
 *
 * A Trade Plan is a user-saved research record that combines research evidence,
 * planning assumptions, hypothetical structures, risk analysis, and monitoring
 * conditions. It does not constitute investment advice, a personalized
 * recommendation, suitability determination, or instruction to transact.
 */
export interface TradePlan {
  id:                    string;
  userId:                string;
  symbol:                string;
  companyName:           string | null;

  planType:              TradePlanType;
  status:                TradePlanStatus;
  planHealth:            TradePlanHealth;

  planningContextId:     string;
  researchGoalId:        string | null;
  portfolioId:           string | null;

  selectedExpressionFamily: string;

  // Immutable snapshots (preserved at plan creation)
  researchSnapshot:      TradePlanResearchSnapshot;
  planningSnapshot:      TradePlanPlanningSnapshot;
  structureSnapshot:     TradePlanEquitySnapshot | TradePlanOptionsSnapshot | null;
  riskSnapshot:          TradePlanRiskSnapshot | null;

  // Mutable user data
  monitoringSnapshot:    TradePlanMonitoringSnapshot;
  userNotes:             string | null;
  reviewChecklist:       TradePlanChecklist;

  // Timestamps
  version:               number;
  createdAt:             string;
  updatedAt:             string;
  archivedAt:            string | null;
  completedResearchAt:   string | null;
  monitoringStartedAt:   string | null;

  // Creation-time context
  freshnessAtCreation:   string;   // e.g. "fresh" | "aging" | "stale"
  limitations:           string[];
}

// ============================================================================
// Plan Summary (for library listing)
// ============================================================================

/** Lightweight summary for the /trade-plans list page. */
export interface TradePlanSummary {
  id:                       string;
  symbol:                   string;
  companyName:              string | null;
  planType:                 TradePlanType;
  status:                   TradePlanStatus;
  planHealth:               TradePlanHealth;
  selectedExpressionFamily: string;

  // Research score at creation
  researchScoreAtCreation:  number;
  riskLevelAtCreation:      string;

  // Current research score (null if unavailable)
  currentResearchScore:     number | null;
  researchScoreChange:      number | null;

  version:                  number;
  createdAt:                string;
  updatedAt:                string;
  archivedAt:               string | null;
  freshnessAtCreation:      string;
}

// ============================================================================
// Plan Version
// ============================================================================

/** Immutable version record. Created when user explicitly updates core plan fields. */
export interface TradePlanVersion {
  id:               string;
  tradePlanId:      string;
  version:          number;
  changeReason:     string | null;
  researchSnapshot: TradePlanResearchSnapshot;
  planningSnapshot: TradePlanPlanningSnapshot;
  structureSnapshot: TradePlanEquitySnapshot | TradePlanOptionsSnapshot | null;
  riskSnapshot:     TradePlanRiskSnapshot | null;
  createdAt:        string;
}

// ============================================================================
// Research Change Comparison (Saved vs Current)
// ============================================================================

/** Direction of research change. */
export type ResearchChangeDirection =
  | "STRENGTHENED"
  | "WEAKENED"
  | "UNCHANGED"
  | "MIXED"
  | "UNKNOWN";

/** Materiality of research change. */
export type ResearchChangeMateriality =
  | "MATERIAL"
  | "MINOR"
  | "NONE"
  | "UNKNOWN";

/**
 * Deterministic comparison of saved research snapshot vs current research.
 * Uses existing Change Intelligence thresholds — no new formulas.
 */
export interface TradePlanResearchChange {
  researchScoreChange:        number | null;
  technicalScoreChange:       number | null;
  fundamentalScoreChange:     number | null;
  institutionalScoreChange:   number | null;
  riskLevelChange:            string | null;       // e.g. "LOW → MODERATE"
  marketRegimeChange:         string | null;       // e.g. "BULLISH → NEUTRAL"
  qualificationChange:        string | null;       // e.g. "qualified → disqualified"
  thesisInvalidationObserved: boolean;
  invalidationConditionsFired: string[];
  newRiskFactors:             string[];
  removedRiskFactors:         string[];
  changeDirection:            ResearchChangeDirection;
  materiality:                ResearchChangeMateriality;
  lastComparedAt:             string; // ISO
  comparisonNote:             string;
}

// ============================================================================
// 2.7.6 Handoff Model
// ============================================================================

/**
 * Handoff from Trade Plan Workspace (2.7.5) to Trade Monitoring & Lifecycle (2.7.6).
 * 2.7.6 will consume this. Do not implement lifecycle monitoring in 2.7.5.
 */
export interface TradePlanMonitoringInput {
  tradePlanId:            string;
  symbol:                 string;
  researchSnapshot:       TradePlanResearchSnapshot;
  invalidationConditions: SnapshotInvalidationCondition[];
  monitoringPlan:         string | null;
  structureSummary:       string;
  riskFlags:              string[];
  freshnessRequirements:  string[];
}

// ============================================================================
// API Request / Response
// ============================================================================

/**
 * Request to create a new trade plan.
 * Server reconstructs authoritative scores, quotes, Greeks, risk values.
 * Client submits only references — NOT authoritative values.
 */
export interface CreateTradePlanRequest {
  planningSessionId:              string;
  planType:                       TradePlanType;
  // Options plan: provide candidateId + riskAnalysisId
  contractResearchCandidateId?:   string;
  riskScenarioAnalysisId?:        string;
  // Equity plan: provide equityScenarioId
  equityPlanningScenarioId?:      string;
  // Optional context
  researchGoalId?:                string;
  portfolioId?:                   string;
  // User-editable at creation
  userNotes?:                     string;
  reviewChecklist?:               Partial<TradePlanChecklist>;
  monitoringPlan?:                string;
  monitoringCriteria?:            string[];
}

/** Request to update mutable plan fields. */
export interface UpdateTradePlanRequest {
  // Mutable fields only
  status?:          TradePlanStatus;
  userNotes?:       string;
  reviewChecklist?: Partial<TradePlanChecklist>;
  monitoringPlan?:  string;
  monitoringCriteria?: string[];
}

/** Request to create a new version (preserves previous snapshot). */
export interface CreateTradePlanVersionRequest {
  changeReason?: string;
  // Re-run from an updated session reference
  planningSessionId?: string;
  contractResearchCandidateId?: string;
  riskScenarioAnalysisId?: string;
  equityPlanningScenarioId?: string;
}

/** List/search query parameters. */
export interface TradePlanListQuery {
  status?:   TradePlanStatus | TradePlanStatus[];
  planType?: TradePlanType;
  symbol?:   string;
  sort?:     "newest" | "oldest" | "updated" | "symbol" | "status";
  offset?:   number;
  limit?:    number;
}

/** Response for GET /api/trade-plans */
export interface TradePlanListResponse {
  plans:      TradePlanSummary[];
  total:      number;
  offset:     number;
  limit:      number;
}

/** Response for GET /api/trade-plans/:id/changes */
export interface TradePlanChangesResponse {
  tradePlanId:    string;
  symbol:         string;
  savedSnapshot:  TradePlanResearchSnapshot;
  change:         TradePlanResearchChange;
  planHealth:     TradePlanHealth;
  healthReason:   string;
}

/** Response for GET /api/trade-plans/:id/monitoring-context */
export interface TradePlanMonitoringContextResponse {
  tradePlanId:     string;
  monitoringInput: TradePlanMonitoringInput;
  existingWatchId: string | null;
}

// ============================================================================
// Health Metrics (admin aggregate — no PII, no symbols, no capital)
// ============================================================================

export interface TradePlanHealthMetrics {
  tradePlansCreated:          number;
  activeTradePlans:           number;
  monitoringTradePlans:       number;
  archivedTradePlans:         number;
  plansRequiringReview:       number;
  invalidatedPlans:           number;
  planCreationFailures:       number;
  averagePlanCreationLatencyMs: number | null;
  lastTradePlanCreatedAt:     string | null;
}

// ============================================================================
// Compliance
// ============================================================================

export const TRADE_PLAN_DISCLAIMER =
  "A Trade Plan is a user-saved research record that combines research " +
  "evidence, planning assumptions, hypothetical structures, risk analysis, " +
  "and monitoring conditions. It does not constitute investment advice, a " +
  "personalized recommendation, suitability determination, or instruction " +
  "to transact.";

export const RESEARCH_REVIEW_CHECKLIST_DISCLAIMER =
  "This checklist helps you track which research areas you have reviewed. " +
  "It is not an approval, compliance certification, or determination that a " +
  "trade is appropriate.";

export const TRADE_PLAN_VERSION = "trade-plan-v1";
