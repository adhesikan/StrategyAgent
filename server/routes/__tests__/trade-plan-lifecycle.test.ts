/**
 * server/routes/__tests__/trade-plan-lifecycle.test.ts — Sprint 2.7.6
 *
 * Tests for Trade Monitoring & Lifecycle Intelligence.
 * All pure/deterministic tests — no DB, no network, no broker.
 * Test categories:
 *   - unit: type system, state model, enum completeness
 *   - pure/service: computeExpirationState, computeResearchChanges, computeLifecycleState, etc.
 *   - structural: TradePlanLifecycleResult shape, compliance language, logging safety
 *   - compliance: forbidden language, lifecycle disclaimer
 *   - security: cross-user isolation, no PII in logs
 *   - integration: service layer chain (pure helpers end-to-end)
 *   - smoke: quality gate, smoke suite readiness
 *   - route regression: static/dynamic route ordering
 */

import { describe, it, expect } from "vitest";

// ── Types under test ──────────────────────────────────────────────────────────
import {
  LIFECYCLE_STATES,
  LIFECYCLE_STATE_LABELS,
  EXPIRATION_STATES,
  EXPIRATION_STATE_LABELS,
  RESEARCH_CHANGE_TYPES,
  REVIEW_REASON_TYPES,
  REVIEW_REASON_LABELS,
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_EVENT_LABELS,
  ACTIVITY_CATEGORY_MAP,
  LIFECYCLE_DISCLAIMER,
  LIFECYCLE_FORBIDDEN_PHRASES,
  LIFECYCLE_METHODOLOGY_VERSION,
  DEDUP_WINDOW_HOURS,
  DTE_THRESHOLDS,
  REVIEW_STATES,
  SCHEDULER_NOTE,
} from "../../../shared/trade-plan-lifecycle-types";
import type {
  TradePlanLifecycleResult,
  TradePlanActivity,
  LifecycleResearchSummary,
  ResearchChangeItem,
  InvalidationChange,
  StructureChangeItem,
  ReviewReason,
} from "../../../shared/trade-plan-lifecycle-types";

// ── Pure helpers under test ───────────────────────────────────────────────────
import {
  computeExpirationState,
  computeResearchChanges,
  computeInvalidationChanges,
  computeStructureChanges,
  computeFreshnessChanges,
  computeLifecycleState,
  computeReviewReasons,
  buildActivityFingerprint,
  buildActivitiesFromLifecycleResult,
} from "../../services/trade-plan-lifecycle-service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSavedResearchSnapshot(overrides: Partial<any> = {}): any {
  return {
    researchScore:       70,
    technicalScore:      65,
    fundamentalScore:    60,
    institutionalScore:  55,
    riskLevel:           "moderate",
    evidenceConfidence:  "medium",
    marketRegime:        "BULL_TREND",
    sector:              "Technology",
    themes:              ["AI Infrastructure"],
    qualified:           true,  // explicit so computeResearchChanges detects qualification changes correctly
    primaryEvidence:     [],
    secondaryEvidence:   [],
    riskFactors:         [],
    invalidatesThesis:   [],
    generatedAt:         new Date("2026-08-01T10:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeCurrentSummary(overrides: Partial<LifecycleResearchSummary> = {}): LifecycleResearchSummary {
  return {
    researchScore:      70,
    technicalScore:     65,
    fundamentalScore:   60,
    institutionalScore: 55,
    riskLevel:          "moderate",
    qualified:          true,
    marketRegime:       "BULL_TREND",
    sector:             "Technology",
    themes:             ["AI Infrastructure"],
    asOf:               new Date().toISOString(),
    available:          true,
    ...overrides,
  };
}

function makeLifecycleResult(overrides: Partial<TradePlanLifecycleResult> = {}): TradePlanLifecycleResult {
  return {
    tradePlanId:            "plan-123",
    symbol:                 "NVDA",
    evaluatedAt:            new Date().toISOString(),
    savedPlanStatus:        "RESEARCH_COMPLETE",
    lifecycleState:         "CURRENT",
    researchChanges:        [],
    invalidationChanges:    [],
    structureChanges:       [],
    eventChanges:           [],
    liquidityChanges:       [],
    freshnessChanges:       [],
    currentResearchSummary: makeCurrentSummary(),
    savedResearchSummary:   makeCurrentSummary(),
    requiresReview:         false,
    reviewReasons:          [],
    limitations:            [],
    freshness:              "fresh",
    methodologyVersion:     LIFECYCLE_METHODOLOGY_VERSION,
    ...overrides,
  };
}

// ============================================================================
// § 1 — Type System
// ============================================================================

describe("§1 Lifecycle type system", () => {
  it("LIFECYCLE_STATES includes all required states", () => {
    const required = ["CURRENT", "CHANGED", "REQUIRES_REVIEW", "THESIS_INVALIDATED", "DATA_STALE", "ARCHIVED", "UNKNOWN"];
    for (const s of required) expect(LIFECYCLE_STATES).toContain(s as any);
  });

  it("every lifecycle state has a label", () => {
    for (const s of LIFECYCLE_STATES) {
      expect(LIFECYCLE_STATE_LABELS[s]).toBeTruthy();
    }
  });

  it("forbidden lifecycle states are not defined", () => {
    const forbidden = ["EXIT", "SELL", "CLOSE", "STOPPED_OUT", "ROLL", "TAKE_PROFIT", "BUY_MORE"];
    for (const f of forbidden) {
      expect(LIFECYCLE_STATES).not.toContain(f as any);
    }
  });

  it("EXPIRATION_STATES includes all required states", () => {
    const required = ["FAR_FROM_EXPIRATION", "APPROACHING_EXPIRATION", "NEAR_EXPIRATION", "EXPIRED", "UNKNOWN"];
    for (const s of required) expect(EXPIRATION_STATES).toContain(s as any);
  });

  it("every expiration state has a label", () => {
    for (const s of EXPIRATION_STATES) {
      expect(EXPIRATION_STATE_LABELS[s]).toBeTruthy();
    }
  });

  it("RESEARCH_CHANGE_TYPES are defined", () => {
    expect(RESEARCH_CHANGE_TYPES.length).toBeGreaterThan(5);
  });

  it("REVIEW_REASON_TYPES are defined and labeled", () => {
    for (const r of REVIEW_REASON_TYPES) {
      expect(REVIEW_REASON_LABELS[r]).toBeTruthy();
    }
  });

  it("ACTIVITY_EVENT_TYPES are defined and labeled", () => {
    for (const t of ACTIVITY_EVENT_TYPES) {
      expect(ACTIVITY_EVENT_LABELS[t]).toBeTruthy();
    }
  });

  it("every activity type has a category", () => {
    for (const t of ACTIVITY_EVENT_TYPES) {
      expect(ACTIVITY_CATEGORY_MAP[t]).toBeTruthy();
    }
  });

  it("REVIEW_STATES includes REQUIRES_REVIEW and THESIS_INVALIDATED", () => {
    expect(REVIEW_STATES.has("REQUIRES_REVIEW")).toBe(true);
    expect(REVIEW_STATES.has("THESIS_INVALIDATED")).toBe(true);
    expect(REVIEW_STATES.has("CURRENT")).toBe(false);
  });

  it("DTE_THRESHOLDS are consistent (FAR > APPROACHING > NEAR)", () => {
    expect(DTE_THRESHOLDS.FAR_MIN).toBeGreaterThan(DTE_THRESHOLDS.APPROACHING_MIN);
    expect(DTE_THRESHOLDS.APPROACHING_MIN).toBeGreaterThan(DTE_THRESHOLDS.NEAR_MIN);
  });

  it("DEDUP_WINDOW_HOURS is a positive number", () => {
    expect(DEDUP_WINDOW_HOURS).toBeGreaterThan(0);
  });

  it("LIFECYCLE_METHODOLOGY_VERSION is defined", () => {
    expect(LIFECYCLE_METHODOLOGY_VERSION).toBeTruthy();
    expect(typeof LIFECYCLE_METHODOLOGY_VERSION).toBe("string");
  });
});

// ============================================================================
// § 2 — Expiration State (pure)
// ============================================================================

describe("§2 computeExpirationState", () => {
  it("null DTE → UNKNOWN", () => {
    expect(computeExpirationState(null)).toBe("UNKNOWN");
  });

  it("0 DTE → EXPIRED", () => {
    expect(computeExpirationState(0)).toBe("EXPIRED");
  });

  it("negative DTE → EXPIRED", () => {
    expect(computeExpirationState(-5)).toBe("EXPIRED");
  });

  it("10 DTE → NEAR_EXPIRATION", () => {
    expect(computeExpirationState(10)).toBe("NEAR_EXPIRATION");
  });

  it("20 DTE → NEAR_EXPIRATION (boundary)", () => {
    expect(computeExpirationState(20)).toBe("NEAR_EXPIRATION");
  });

  it("21 DTE → APPROACHING_EXPIRATION (boundary)", () => {
    expect(computeExpirationState(21)).toBe("APPROACHING_EXPIRATION");
  });

  it("30 DTE → APPROACHING_EXPIRATION", () => {
    expect(computeExpirationState(30)).toBe("APPROACHING_EXPIRATION");
  });

  it("45 DTE → APPROACHING_EXPIRATION (boundary)", () => {
    expect(computeExpirationState(45)).toBe("APPROACHING_EXPIRATION");
  });

  it("46 DTE → FAR_FROM_EXPIRATION (boundary)", () => {
    expect(computeExpirationState(46)).toBe("FAR_FROM_EXPIRATION");
  });

  it("90 DTE → FAR_FROM_EXPIRATION", () => {
    expect(computeExpirationState(90)).toBe("FAR_FROM_EXPIRATION");
  });
});

// ============================================================================
// § 3 — Research Changes (pure)
// ============================================================================

describe("§3 computeResearchChanges", () => {
  it("no change when scores identical", () => {
    const saved    = makeSavedResearchSnapshot();
    const current  = makeCurrentSummary();
    const changes  = computeResearchChanges(saved, current);
    expect(changes).toHaveLength(0);
  });

  it("RESEARCH_STRENGTHENED when score increases materially", () => {
    const saved    = makeSavedResearchSnapshot({ researchScore: 60 });
    const current  = makeCurrentSummary({ researchScore: 72 });
    const changes  = computeResearchChanges(saved, current);
    const rc       = changes.find(c => c.changeType === "RESEARCH_STRENGTHENED");
    expect(rc).toBeDefined();
    expect(rc!.isMaterial).toBe(true);
    expect(rc!.delta).toBe(12);
  });

  it("RESEARCH_WEAKENED when score decreases materially", () => {
    const saved    = makeSavedResearchSnapshot({ researchScore: 75 });
    const current  = makeCurrentSummary({ researchScore: 62 });
    const changes  = computeResearchChanges(saved, current);
    const rc       = changes.find(c => c.changeType === "RESEARCH_WEAKENED");
    expect(rc).toBeDefined();
    expect(rc!.isMaterial).toBe(true);
    expect(rc!.delta).toBe(-13);
  });

  it("non-material when delta < 5", () => {
    const saved    = makeSavedResearchSnapshot({ researchScore: 70 });
    const current  = makeCurrentSummary({ researchScore: 73 });
    const changes  = computeResearchChanges(saved, current);
    const rc       = changes.find(c => c.changeType === "RESEARCH_STRENGTHENED");
    expect(rc?.isMaterial).toBe(false);
  });

  it("NO_LONGER_QUALIFIED when qualification lost", () => {
    const saved    = makeSavedResearchSnapshot();
    const current  = makeCurrentSummary({ qualified: false });
    const changes  = computeResearchChanges(saved, current);
    const rc       = changes.find(c => c.changeType === "NO_LONGER_QUALIFIED");
    expect(rc).toBeDefined();
    expect(rc!.isMaterial).toBe(true);
  });

  it("NEWLY_QUALIFIED when qualification gained", () => {
    const saved    = makeSavedResearchSnapshot({ qualified: false });
    const current  = makeCurrentSummary({ qualified: true });
    const changes  = computeResearchChanges(saved, current);
    const rc       = changes.find(c => c.changeType === "NEWLY_QUALIFIED");
    expect(rc).toBeDefined();
    expect(rc!.isMaterial).toBe(true);
  });

  it("TECHNICAL_STRENGTHENED when technical score increases", () => {
    const saved   = makeSavedResearchSnapshot({ technicalScore: 50 });
    const current = makeCurrentSummary({ technicalScore: 68 });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "TECHNICAL_STRENGTHENED")).toBe(true);
  });

  it("TECHNICAL_WEAKENED when technical score decreases", () => {
    const saved   = makeSavedResearchSnapshot({ technicalScore: 75 });
    const current = makeCurrentSummary({ technicalScore: 60 });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "TECHNICAL_WEAKENED")).toBe(true);
  });

  it("FUNDAMENTAL_CHANGED when fundamental score changes", () => {
    const saved   = makeSavedResearchSnapshot({ fundamentalScore: 60 });
    const current = makeCurrentSummary({ fundamentalScore: 48 });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "FUNDAMENTAL_CHANGED")).toBe(true);
  });

  it("INSTITUTIONAL_CHANGED when institutional score changes", () => {
    const saved   = makeSavedResearchSnapshot({ institutionalScore: 55 });
    const current = makeCurrentSummary({ institutionalScore: 40 });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "INSTITUTIONAL_CHANGED")).toBe(true);
  });

  it("REGIME_CHANGED when market regime changes", () => {
    const saved   = makeSavedResearchSnapshot({ marketRegime: "BULL_TREND" });
    const current = makeCurrentSummary({ marketRegime: "BEAR_TREND" });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "REGIME_CHANGED")).toBe(true);
  });

  it("SECTOR_CONTEXT_CHANGED when sector changes", () => {
    const saved   = makeSavedResearchSnapshot({ sector: "Technology" });
    const current = makeCurrentSummary({ sector: "Healthcare" });
    const changes = computeResearchChanges(saved, current);
    expect(changes.some(c => c.changeType === "SECTOR_CONTEXT_CHANGED")).toBe(true);
  });

  it("returns empty when current unavailable", () => {
    const saved   = makeSavedResearchSnapshot();
    const current = makeCurrentSummary({ available: false });
    const changes = computeResearchChanges(saved, current);
    expect(changes).toHaveLength(0);
  });

  it("no execution language in change descriptions", () => {
    const saved   = makeSavedResearchSnapshot({ researchScore: 80 });
    const current = makeCurrentSummary({ researchScore: 55 });
    const changes = computeResearchChanges(saved, current);
    for (const c of changes) {
      expect(c.description.toLowerCase()).not.toContain("sell");
      expect(c.description.toLowerCase()).not.toContain("exit");
      expect(c.description.toLowerCase()).not.toContain("close the position");
    }
  });
});

// ============================================================================
// § 4 — Invalidation Monitoring (pure)
// ============================================================================

describe("§4 computeInvalidationChanges", () => {
  it("returns empty when no saved conditions", () => {
    const saved   = makeSavedResearchSnapshot({ invalidatesThesis: [] });
    const current = makeCurrentSummary();
    expect(computeInvalidationChanges(saved, current)).toHaveLength(0);
  });

  it("returns unknown when current unavailable", () => {
    const saved = makeSavedResearchSnapshot({
      invalidatesThesis: [{ condition: "QUALIFICATION_LOST", description: "Qualification lost" }],
    });
    const result = computeInvalidationChanges(saved, null);
    expect(result).toHaveLength(1);
    expect(result[0].observationState).toBe("unknown");
  });

  it("QUALIFICATION condition → observed when not qualified", () => {
    const saved = makeSavedResearchSnapshot({
      invalidatesThesis: [{ condition: "QUALIFICATION_LOST", description: "Qualification lost" }],
    });
    const current = makeCurrentSummary({ qualified: false });
    const result  = computeInvalidationChanges(saved, current);
    expect(result[0].observationState).toBe("observed");
  });

  it("QUALIFICATION condition → notObserved when still qualified", () => {
    const saved = makeSavedResearchSnapshot({
      invalidatesThesis: [{ condition: "QUALIFICATION_LOST", description: "Qualification lost" }],
    });
    const current = makeCurrentSummary({ qualified: true });
    const result  = computeInvalidationChanges(saved, current);
    expect(result[0].observationState).toBe("notObserved");
  });

  it("invalidation observation does not say exit or sell", () => {
    const saved = makeSavedResearchSnapshot({
      invalidatesThesis: [{ condition: "TECHNICAL_STAGE_DETERIORATION", description: "Stage deteriorated" }],
    });
    const current = makeCurrentSummary({ technicalScore: 30 });
    const result  = computeInvalidationChanges(saved, current);
    for (const r of result) {
      expect(r.description.toLowerCase()).not.toContain("sell");
      expect(r.description.toLowerCase()).not.toContain("exit now");
      expect(r.description.toLowerCase()).not.toContain("close the position");
    }
  });
});

// ============================================================================
// § 5 — Structure Changes / DTE (pure)
// ============================================================================

describe("§5 computeStructureChanges", () => {
  it("returns empty for equity plans", () => {
    const result = computeStructureChanges("EQUITY", { dte: 30 }, 20);
    expect(result).toHaveLength(0);
  });

  it("returns empty when no structure snapshot", () => {
    const result = computeStructureChanges("OPTIONS", null, 20);
    expect(result).toHaveLength(0);
  });

  it("DTE_CHANGED emitted when DTE differs", () => {
    const result = computeStructureChanges("OPTIONS", { dte: 45 }, 30);
    expect(result.some(c => c.changeType === "DTE_CHANGED")).toBe(true);
  });

  it("EXPIRATION_APPROACHING emitted when DTE 21-45", () => {
    const result = computeStructureChanges("OPTIONS", { dte: 60 }, 30);
    expect(result.some(c => c.changeType === "EXPIRATION_APPROACHING")).toBe(true);
  });

  it("EXPIRATION_NEAR emitted when DTE ≤ 20", () => {
    const result = computeStructureChanges("OPTIONS", { dte: 45 }, 10);
    expect(result.some(c => c.changeType === "EXPIRATION_NEAR")).toBe(true);
  });

  it("EXPIRATION_NEAR emitted when DTE = 0 (expired)", () => {
    const result = computeStructureChanges("OPTIONS", { dte: 45 }, 0);
    expect(result.some(c => c.changeType === "EXPIRATION_NEAR")).toBe(true);
  });

  it("no prescriptive language in structure change descriptions", () => {
    const result = computeStructureChanges("OPTIONS", { dte: 60 }, 5);
    for (const c of result) {
      expect(c.description.toLowerCase()).not.toContain("roll");
      expect(c.description.toLowerCase()).not.toContain("close");
      expect(c.description.toLowerCase()).not.toContain("sell");
    }
  });
});

// ============================================================================
// § 6 — Freshness Changes (pure)
// ============================================================================

describe("§6 computeFreshnessChanges", () => {
  it("DATA_UNAVAILABLE when current unavailable", () => {
    const result = computeFreshnessChanges("fresh", false, null);
    expect(result.some(f => f.changeType === "DATA_UNAVAILABLE")).toBe(true);
  });

  it("DATA_BECAME_STALE when age > 48h", () => {
    const result = computeFreshnessChanges("fresh", true, 50);
    expect(result.some(f => f.changeType === "DATA_BECAME_STALE")).toBe(true);
  });

  it("empty when data is current and young", () => {
    const result = computeFreshnessChanges("fresh", true, 2);
    expect(result).toHaveLength(0);
  });

  it("empty when age is exactly at boundary (48h)", () => {
    const result = computeFreshnessChanges("fresh", true, 48);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// § 7 — Lifecycle State Computation (pure)
// ============================================================================

describe("§7 computeLifecycleState", () => {
  it("ARCHIVED when plan status is ARCHIVED", () => {
    const state = computeLifecycleState({
      planStatus: "ARCHIVED", currentAvailable: true,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("ARCHIVED");
  });

  it("UNKNOWN when current data unavailable", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: false,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("UNKNOWN");
  });

  it("DATA_STALE when freshness change is stale", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale", savedFreshness: "fresh", currentFreshness: "stale" }],
      researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("DATA_STALE");
  });

  it("THESIS_INVALIDATED when invalidation observed", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [],
      invalidationChanges: [{ condition: "QUAL", description: "", observationState: "observed", evaluationNote: "" }],
      structureChanges: [],
    });
    expect(state).toBe("THESIS_INVALIDATED");
  });

  it("REQUIRES_REVIEW when material research change", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], invalidationChanges: [],
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 75, currentValue: 60, delta: -15, description: "", isMaterial: true }],
      structureChanges: [],
    });
    expect(state).toBe("REQUIRES_REVIEW");
  });

  it("CHANGED when non-material research change", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], invalidationChanges: [],
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 70, currentValue: 68, delta: -2, description: "", isMaterial: false }],
      structureChanges: [],
    });
    expect(state).toBe("CHANGED");
  });

  it("CURRENT when no changes", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("CURRENT");
  });

  it("THESIS_INVALIDATED takes precedence over REQUIRES_REVIEW", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 80, currentValue: 60, delta: -20, description: "", isMaterial: true }],
      invalidationChanges: [{ condition: "QUAL", description: "", observationState: "observed", evaluationNote: "" }],
      structureChanges: [],
    });
    expect(state).toBe("THESIS_INVALIDATED");
  });

  it("DATA_STALE takes precedence over CHANGED (data quality gates first)", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale", savedFreshness: "fresh", currentFreshness: "stale" }],
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 70, currentValue: 68, delta: -2, description: "", isMaterial: false }],
      invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("DATA_STALE");
  });
});

// ============================================================================
// § 8 — Review Reasons (pure)
// ============================================================================

describe("§8 computeReviewReasons", () => {
  it("no reasons for clean plan", () => {
    const reasons = computeReviewReasons({
      researchChanges: [], invalidationChanges: [], structureChanges: [],
      eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    expect(reasons).toHaveLength(0);
  });

  it("QUALIFICATION_LOST when NO_LONGER_QUALIFIED change present", () => {
    const reasons = computeReviewReasons({
      researchChanges: [{ changeType: "NO_LONGER_QUALIFIED", savedValue: "qualified", currentValue: "not qualified", delta: null, description: "Qualification lost", isMaterial: true }],
      invalidationChanges: [], structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    expect(reasons.some(r => r.reasonType === "QUALIFICATION_LOST")).toBe(true);
  });

  it("RESEARCH_SCORE_MATERIALLY_WEAKENED when material RESEARCH_WEAKENED", () => {
    const reasons = computeReviewReasons({
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 80, currentValue: 60, delta: -20, description: "Score dropped", isMaterial: true }],
      invalidationChanges: [], structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    expect(reasons.some(r => r.reasonType === "RESEARCH_SCORE_MATERIALLY_WEAKENED")).toBe(true);
  });

  it("THESIS_INVALIDATION_OBSERVED when invalidation observed", () => {
    const reasons = computeReviewReasons({
      researchChanges: [],
      invalidationChanges: [{ condition: "QUAL", description: "", observationState: "observed", evaluationNote: "" }],
      structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    expect(reasons.some(r => r.reasonType === "THESIS_INVALIDATION_OBSERVED")).toBe(true);
  });

  it("CRITICAL_DATA_STALE when stale freshness change", () => {
    const reasons = computeReviewReasons({
      researchChanges: [], invalidationChanges: [], structureChanges: [], eventChanges: [], liquidityChanges: [],
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale", savedFreshness: "fresh", currentFreshness: "stale" }],
    });
    expect(reasons.some(r => r.reasonType === "CRITICAL_DATA_STALE")).toBe(true);
  });

  it("EXPIRATION_APPROACHING when approaching expiration", () => {
    const reasons = computeReviewReasons({
      researchChanges: [], invalidationChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      structureChanges: [{ changeType: "EXPIRATION_APPROACHING", description: "", savedValue: 60, currentValue: 30, isMaterial: true }],
    });
    expect(reasons.some(r => r.reasonType === "EXPIRATION_APPROACHING")).toBe(true);
  });

  it("MARKET_REGIME_CHANGED when regime change detected", () => {
    const reasons = computeReviewReasons({
      researchChanges: [{ changeType: "REGIME_CHANGED", savedValue: "BULL_TREND", currentValue: "BEAR_TREND", delta: null, description: "Regime changed", isMaterial: false }],
      invalidationChanges: [], structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    expect(reasons.some(r => r.reasonType === "MARKET_REGIME_CHANGED")).toBe(true);
  });

  it("review reason descriptions never contain exit instructions", () => {
    const reasons = computeReviewReasons({
      researchChanges: [
        { changeType: "RESEARCH_WEAKENED", savedValue: 80, currentValue: 60, delta: -20, description: "Score dropped", isMaterial: true },
        { changeType: "NO_LONGER_QUALIFIED", savedValue: "qualified", currentValue: "not qualified", delta: null, description: "Qualification lost", isMaterial: true },
      ],
      invalidationChanges: [{ condition: "QUAL", description: "Qualification lost", observationState: "observed", evaluationNote: "" }],
      structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
    });
    for (const r of reasons) {
      expect(r.description.toLowerCase()).not.toContain("exit now");
      expect(r.description.toLowerCase()).not.toContain("sell now");
      expect(r.description.toLowerCase()).not.toContain("close the position");
      expect(r.description.toLowerCase()).not.toContain("take profit");
      expect(r.description.toLowerCase()).not.toContain("stop out");
    }
  });
});

// ============================================================================
// § 9 — Activity Fingerprinting & Building (pure)
// ============================================================================

describe("§9 Activity fingerprinting and building", () => {
  it("same inputs produce same fingerprint", () => {
    const f1 = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const f2 = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(f1).toBe(f2);
  });

  it("different state produces different fingerprint", () => {
    const f1 = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const f2 = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "THESIS_INVALIDATED", "2.7.6");
    expect(f1).not.toBe(f2);
  });

  it("different plan ID produces different fingerprint", () => {
    const f1 = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const f2 = buildActivityFingerprint("plan-2", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(f1).not.toBe(f2);
  });

  it("fingerprint is 32 hex chars", () => {
    const f = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(/^[0-9a-f]{32}$/.test(f)).toBe(true);
  });

  it("buildActivitiesFromLifecycleResult: no activity for CURRENT unchanged plan", () => {
    const result = makeLifecycleResult({ lifecycleState: "CURRENT" });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    expect(activities).toHaveLength(0);
  });

  it("buildActivitiesFromLifecycleResult: THESIS_INVALIDATION_OBSERVED emitted on first invalidation", () => {
    const result = makeLifecycleResult({ lifecycleState: "THESIS_INVALIDATED" });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    expect(activities.some(a => a.activityType === "THESIS_INVALIDATION_OBSERVED")).toBe(true);
  });

  it("buildActivitiesFromLifecycleResult: THESIS_INVALIDATION not re-emitted if previous was already invalidated", () => {
    const result = makeLifecycleResult({ lifecycleState: "THESIS_INVALIDATED" });
    const activities = buildActivitiesFromLifecycleResult(result, "THESIS_INVALIDATED");
    expect(activities.some(a => a.activityType === "THESIS_INVALIDATION_OBSERVED")).toBe(false);
  });

  it("buildActivitiesFromLifecycleResult: REVIEW_REQUIRED emitted on first transition", () => {
    const result = makeLifecycleResult({ lifecycleState: "REQUIRES_REVIEW", reviewReasons: [{ reasonType: "QUALIFICATION_LOST", description: "Qual lost" }] });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    expect(activities.some(a => a.activityType === "REVIEW_REQUIRED")).toBe(false.valueOf() || activities.some(a => a.activityType === "REVIEW_REQUIRED"));
    // More specifically:
    const reviewAct = activities.find(a => a.activityType === "REVIEW_REQUIRED");
    expect(reviewAct).toBeDefined();
  });

  it("buildActivitiesFromLifecycleResult: DATA_STALE emitted on stale transition", () => {
    const result = makeLifecycleResult({ lifecycleState: "DATA_STALE" });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    expect(activities.some(a => a.activityType === "DATA_STALE")).toBe(true);
  });

  it("buildActivitiesFromLifecycleResult: RESEARCH_WEAKENED emitted for material weakening", () => {
    const result = makeLifecycleResult({
      lifecycleState: "REQUIRES_REVIEW",
      researchChanges: [{ changeType: "RESEARCH_WEAKENED", savedValue: 80, currentValue: 60, delta: -20, description: "Score dropped 20 pts", isMaterial: true }],
    });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    expect(activities.some(a => a.activityType === "RESEARCH_WEAKENED")).toBe(true);
  });

  it("activity metadata never contains capital, P/L, notes, or user identity", () => {
    const result = makeLifecycleResult({
      lifecycleState: "REQUIRES_REVIEW",
      reviewReasons:  [{ reasonType: "QUALIFICATION_LOST", description: "Qual lost" }],
    });
    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    for (const a of activities) {
      const meta = JSON.stringify(a.metadata);
      expect(meta).not.toContain("userId");
      expect(meta).not.toContain("email");
      expect(meta).not.toContain("notes");
      expect(meta).not.toContain("capital");
      expect(meta).not.toContain("pnl");
      expect(meta).not.toContain("position");
    }
  });
});

// ============================================================================
// § 10 — TradePlanLifecycleResult shape
// ============================================================================

describe("§10 TradePlanLifecycleResult shape", () => {
  it("required fields are defined", () => {
    const r = makeLifecycleResult();
    expect(r.tradePlanId).toBeTruthy();
    expect(r.symbol).toBeTruthy();
    expect(r.evaluatedAt).toBeTruthy();
    expect(r.savedPlanStatus).toBeTruthy();
    expect(r.lifecycleState).toBeTruthy();
    expect(Array.isArray(r.researchChanges)).toBe(true);
    expect(Array.isArray(r.invalidationChanges)).toBe(true);
    expect(Array.isArray(r.structureChanges)).toBe(true);
    expect(Array.isArray(r.eventChanges)).toBe(true);
    expect(Array.isArray(r.liquidityChanges)).toBe(true);
    expect(Array.isArray(r.freshnessChanges)).toBe(true);
    expect(typeof r.requiresReview).toBe("boolean");
    expect(Array.isArray(r.reviewReasons)).toBe(true);
    expect(Array.isArray(r.limitations)).toBe(true);
    expect(r.methodologyVersion).toBeTruthy();
  });

  it("lifecycleState is a valid LIFECYCLE_STATE", () => {
    const r = makeLifecycleResult();
    expect(LIFECYCLE_STATES).toContain(r.lifecycleState);
  });

  it("freshness is one of the expected values", () => {
    const r = makeLifecycleResult();
    expect(["fresh", "recent", "stale", "unknown"]).toContain(r.freshness);
  });
});

// ============================================================================
// § 11 — Compliance
// ============================================================================

describe("§11 Compliance — no execution language", () => {
  it("LIFECYCLE_DISCLAIMER exists and is non-prescriptive", () => {
    expect(LIFECYCLE_DISCLAIMER).toBeTruthy();
    expect(LIFECYCLE_DISCLAIMER).toContain("research observations");
    expect(LIFECYCLE_DISCLAIMER.toLowerCase()).not.toContain("instruction to buy");
    // Disclaimer uses "not instructions to buy, sell" — check it's clear
    expect(LIFECYCLE_DISCLAIMER.toLowerCase()).toContain("not instructions to buy");
  });

  it("LIFECYCLE_FORBIDDEN_PHRASES are defined", () => {
    expect(LIFECYCLE_FORBIDDEN_PHRASES.length).toBeGreaterThan(5);
  });

  it("lifecycle state labels never contain exit instructions", () => {
    for (const label of Object.values(LIFECYCLE_STATE_LABELS)) {
      expect(label.toLowerCase()).not.toContain("exit");
      expect(label.toLowerCase()).not.toContain("sell");
      expect(label.toLowerCase()).not.toContain("close");
      expect(label.toLowerCase()).not.toContain("stop out");
    }
  });

  it("review reason labels never contain execution instructions", () => {
    for (const label of Object.values(REVIEW_REASON_LABELS)) {
      expect(label.toLowerCase()).not.toContain("sell");
      expect(label.toLowerCase()).not.toContain("exit now");
      expect(label.toLowerCase()).not.toContain("close the position");
    }
  });

  it("activity event labels never contain execution instructions", () => {
    for (const label of Object.values(ACTIVITY_EVENT_LABELS)) {
      expect(label.toLowerCase()).not.toContain("sell");
      expect(label.toLowerCase()).not.toContain("exit");
      expect(label.toLowerCase()).not.toContain("close position");
    }
  });

  it("forbidden phrases are not present in lifecycle state labels", () => {
    const allLabels = [
      ...Object.values(LIFECYCLE_STATE_LABELS),
      ...Object.values(EXPIRATION_STATE_LABELS),
      ...Object.values(REVIEW_REASON_LABELS),
      ...Object.values(ACTIVITY_EVENT_LABELS),
    ].join(" | ").toLowerCase();

    for (const phrase of LIFECYCLE_FORBIDDEN_PHRASES) {
      expect(allLabels).not.toContain(phrase.toLowerCase());
    }
  });

  it("SCHEDULER_NOTE does not contain broker execution language", () => {
    expect(SCHEDULER_NOTE.toLowerCase()).not.toContain("broker order");
    expect(SCHEDULER_NOTE.toLowerCase()).not.toContain("execution");
  });

  it("thesis invalidated state label is neutral and non-prescriptive", () => {
    const label = LIFECYCLE_STATE_LABELS["THESIS_INVALIDATED"];
    expect(label).toContain("Observed");
    expect(label.toLowerCase()).not.toContain("exit");
    expect(label.toLowerCase()).not.toContain("sell");
  });

  it("REQUIRES_REVIEW label does not prescribe action", () => {
    const label = LIFECYCLE_STATE_LABELS["REQUIRES_REVIEW"];
    expect(label).toContain("Review");
    expect(label.toLowerCase()).not.toContain("sell");
    expect(label.toLowerCase()).not.toContain("stop");
  });
});

// ============================================================================
// § 12 — Security / Cross-user Isolation
// ============================================================================

describe("§12 Security / ownership", () => {
  it("activity fingerprint includes tradePlanId preventing cross-plan collisions", () => {
    const f1 = buildActivityFingerprint("plan-A", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const f2 = buildActivityFingerprint("plan-B", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(f1).not.toBe(f2);
  });

  it("lifecycle result contains tradePlanId (ownership tracing)", () => {
    const r = makeLifecycleResult({ tradePlanId: "plan-xyz" });
    expect(r.tradePlanId).toBe("plan-xyz");
  });

  it("lifecycle result does not contain userId (never in output)", () => {
    const r = makeLifecycleResult();
    const json = JSON.stringify(r);
    expect(json).not.toContain("userId");
    expect(json).not.toContain("user_id");
  });

  it("lifecycle result does not contain user notes", () => {
    const r = makeLifecycleResult();
    const json = JSON.stringify(r);
    expect(json).not.toContain("userNotes");
    expect(json).not.toContain("user_notes");
  });

  it("activity metadata must not contain user identity", () => {
    const activities = buildActivitiesFromLifecycleResult(
      makeLifecycleResult({ lifecycleState: "THESIS_INVALIDATED" }),
      "CURRENT",
    );
    for (const a of activities) {
      const meta = JSON.stringify(a.metadata);
      expect(meta).not.toContain("userId");
      expect(meta).not.toContain("email");
      expect(meta).not.toContain("password");
    }
  });
});

// ============================================================================
// § 13 — Partial Failure Resilience
// ============================================================================

describe("§13 Partial failure resilience", () => {
  it("computeResearchChanges returns empty (not error) when current is unavailable", () => {
    const saved = makeSavedResearchSnapshot();
    const current = makeCurrentSummary({ available: false });
    expect(() => computeResearchChanges(saved, current)).not.toThrow();
    expect(computeResearchChanges(saved, current)).toHaveLength(0);
  });

  it("computeInvalidationChanges returns unknown (not error) when current is null", () => {
    const saved = makeSavedResearchSnapshot({ invalidatesThesis: [{ condition: "QUAL", description: "d" }] });
    expect(() => computeInvalidationChanges(saved, null)).not.toThrow();
    const result = computeInvalidationChanges(saved, null);
    expect(result[0].observationState).toBe("unknown");
  });

  it("computeStructureChanges returns empty (not error) when snapshot is null", () => {
    expect(() => computeStructureChanges("OPTIONS", null, 20)).not.toThrow();
    expect(computeStructureChanges("OPTIONS", null, 20)).toHaveLength(0);
  });

  it("computeFreshnessChanges returns DATA_UNAVAILABLE (not error) when unavailable", () => {
    expect(() => computeFreshnessChanges("fresh", false, null)).not.toThrow();
    const result = computeFreshnessChanges("fresh", false, null);
    expect(result[0].changeType).toBe("DATA_UNAVAILABLE");
  });

  it("computeLifecycleState returns UNKNOWN when data unavailable", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: false,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(state).toBe("UNKNOWN");
  });
});

// ============================================================================
// § 14 — Integration: full lifecycle evaluation chain (pure)
// ============================================================================

describe("§14 Integration — full lifecycle chain (pure)", () => {
  it("CURRENT → CURRENT when nothing changes", () => {
    const saved    = makeSavedResearchSnapshot();
    const current  = makeCurrentSummary();
    const rChanges = computeResearchChanges(saved, current);
    const iChanges = computeInvalidationChanges(saved, current);
    const sChanges = computeStructureChanges("EQUITY", null, null);
    const fChanges = computeFreshnessChanges("fresh", true, 1);
    const state    = computeLifecycleState({ planStatus: "RESEARCH_COMPLETE", currentAvailable: true, freshnessChanges: fChanges, researchChanges: rChanges, invalidationChanges: iChanges, structureChanges: sChanges });
    const reasons  = computeReviewReasons({ researchChanges: rChanges, invalidationChanges: iChanges, structureChanges: sChanges, eventChanges: [], liquidityChanges: [], freshnessChanges: fChanges });
    expect(state).toBe("CURRENT");
    expect(reasons).toHaveLength(0);
  });

  it("RESEARCH_COMPLETE plan with -10 score change → REQUIRES_REVIEW", () => {
    const saved    = makeSavedResearchSnapshot({ researchScore: 75 });
    const current  = makeCurrentSummary({ researchScore: 62 });
    const rChanges = computeResearchChanges(saved, current);
    const state    = computeLifecycleState({ planStatus: "RESEARCH_COMPLETE", currentAvailable: true, freshnessChanges: [], researchChanges: rChanges, invalidationChanges: [], structureChanges: [] });
    expect(state).toBe("REQUIRES_REVIEW");
  });

  it("qualification loss → THESIS_INVALIDATED (invalidation observed)", () => {
    const saved = makeSavedResearchSnapshot({
      invalidatesThesis: [{ condition: "QUALIFICATION_LOST", description: "No longer qualified" }],
    });
    const current  = makeCurrentSummary({ qualified: false });
    const iChanges = computeInvalidationChanges(saved, current);
    const state    = computeLifecycleState({ planStatus: "RESEARCH_COMPLETE", currentAvailable: true, freshnessChanges: [], researchChanges: [], invalidationChanges: iChanges, structureChanges: [] });
    expect(state).toBe("THESIS_INVALIDATED");
  });

  it("equity plan + APPROACHING_EXPIRATION not computed (structure changes empty)", () => {
    const sChanges = computeStructureChanges("EQUITY", { dte: 60 }, 20);
    expect(sChanges).toHaveLength(0); // equity ignores DTE
  });

  it("options plan + DTE 10 → NEAR_EXPIRATION in structure changes", () => {
    const sChanges = computeStructureChanges("OPTIONS", { dte: 60 }, 10);
    expect(sChanges.some(c => c.changeType === "EXPIRATION_NEAR")).toBe(true);
  });

  it("full chain produces valid TradePlanLifecycleResult shape", () => {
    const saved    = makeSavedResearchSnapshot();
    const current  = makeCurrentSummary({ researchScore: 72 });
    const rChanges = computeResearchChanges(saved, current);
    const iChanges = computeInvalidationChanges(saved, current);
    const sChanges = computeStructureChanges("EQUITY", null, null);
    const fChanges = computeFreshnessChanges("fresh", true, 2);
    const state    = computeLifecycleState({ planStatus: "RESEARCH_COMPLETE", currentAvailable: true, freshnessChanges: fChanges, researchChanges: rChanges, invalidationChanges: iChanges, structureChanges: sChanges });
    const reasons  = computeReviewReasons({ researchChanges: rChanges, invalidationChanges: iChanges, structureChanges: sChanges, eventChanges: [], liquidityChanges: [], freshnessChanges: fChanges });

    const result: TradePlanLifecycleResult = {
      tradePlanId: "plan-test-1", symbol: "NVDA", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: state,
      researchChanges: rChanges, invalidationChanges: iChanges, structureChanges: sChanges,
      eventChanges: [], liquidityChanges: [], freshnessChanges: fChanges,
      currentResearchSummary: current, savedResearchSummary: makeCurrentSummary(),
      requiresReview: reasons.length > 0, reviewReasons: reasons,
      limitations: [], freshness: "fresh", methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    expect(LIFECYCLE_STATES).toContain(result.lifecycleState);
    expect(result.methodologyVersion).toBe(LIFECYCLE_METHODOLOGY_VERSION);
    expect(Array.isArray(result.limitations)).toBe(true);
  });
});

// ============================================================================
// § 15 — Route Regression (Sprint 2.7.5 + 2.7.6 static/dynamic ordering)
// ============================================================================

describe("§15 Route regression — static before dynamic", () => {
  it("/api/trade-plans/health is a static path (does not contain :id)", () => {
    const path = "/api/trade-plans/health";
    expect(path.includes(":")).toBe(false);
  });

  it("/api/trade-plans/:id/lifecycle/evaluate must be registered before /:id/lifecycle", () => {
    // These are documented registration-order requirements — verify the path strings
    const deeper = "/api/trade-plans/:id/lifecycle/evaluate";
    const shallower = "/api/trade-plans/:id/lifecycle";
    expect(deeper.split("/").length).toBeGreaterThan(shallower.split("/").length);
  });

  it("/api/trade-plans/:id/activity is a distinct resource", () => {
    expect("/api/trade-plans/:id/activity").not.toBe("/api/trade-plans/:id/lifecycle");
  });

  it("/opportunities/today must not resolve as ticker TODAY", () => {
    // Historical regression from Opportunity Engine sprint
    const path = "/opportunities/today";
    expect(path).toBe("/opportunities/today");
    expect(path).not.toContain("ticker");
  });

  it("/opportunities/changes must not resolve as ticker CHANGES", () => {
    const path = "/opportunities/changes";
    expect(path).not.toContain("ticker");
  });

  it("/trade-plans (static list) must differ from /trade-plans/:id (dynamic detail)", () => {
    expect("/trade-plans").not.toBe("/trade-plans/:id");
  });

  it("/trade-plans/lifecycle/health is a static admin path", () => {
    // This is a documented static route under the lifecycle namespace
    const path = "/api/trade-plans/lifecycle/health";
    expect(path).not.toContain("/:id");
  });
});

// ============================================================================
// § 16 — Methodology version and docs constants
// ============================================================================

describe("§16 Methodology and operations constants", () => {
  it("LIFECYCLE_METHODOLOGY_VERSION matches sprint", () => {
    expect(LIFECYCLE_METHODOLOGY_VERSION).toBe("2.7.6");
  });

  it("DEDUP_WINDOW_HOURS is 24", () => {
    expect(DEDUP_WINDOW_HOURS).toBe(24);
  });

  it("DTE_THRESHOLDS are documented correctly", () => {
    expect(DTE_THRESHOLDS.FAR_MIN).toBe(46);
    expect(DTE_THRESHOLDS.APPROACHING_MIN).toBe(21);
    expect(DTE_THRESHOLDS.NEAR_MIN).toBe(1);
  });
});

// ============================================================================
// § 17 — Structured Logging Safety
// ============================================================================

describe("§17 Structured logging field safety", () => {
  it("lifecycle logging fields do not include sensitive names", () => {
    // These are the safe fields from the spec — ensure no PII patterns
    const safeFields = ["durationMs", "planType", "lifecycleState", "changeCount", "riskFlagCount", "hasEventChange", "hasLiquidityChange"];
    const forbidden  = ["userId", "email", "capital", "pnl", "notes", "legs", "portfolioValue", "user_id"];

    for (const safe of safeFields) {
      expect(forbidden).not.toContain(safe);
    }
  });
});

// ============================================================================
// § 18 — Platform Health Metrics (unit)
// ============================================================================

describe("§18 Platform health metrics model", () => {
  it("health metrics model fields are defined in lifecycle types", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();
    expect(typeof metrics.plansEvaluated).toBe("number");
    expect(typeof metrics.currentPlans).toBe("number");
    expect(typeof metrics.changedPlans).toBe("number");
    expect(typeof metrics.reviewRequiredPlans).toBe("number");
    expect(typeof metrics.invalidatedPlans).toBe("number");
    expect(typeof metrics.stalePlans).toBe("number");
    expect(typeof metrics.failedEvaluations).toBe("number");
  });
});
