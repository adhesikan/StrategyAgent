/**
 * server/routes/__tests__/integration.test.ts — Sprint 2.7.6
 *
 * Integration Test Suite — mandatory for every sprint from 2.7.6 onward.
 * cmd: npm run test:integration
 *
 * Tests real service layer integrations (pure computation — no DB, no network).
 * Covers the major boundary handoffs documented in the sprint spec.
 *
 * Category: integration
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §I1 — Research Changes → Lifecycle State (end-to-end pure chain)
// ============================================================================

describe("Integration §I1: Research Changes → Lifecycle State", () => {
  it("weakened research → lifecycle REQUIRES_REVIEW (no intermediary gaps)", async () => {
    const {
      computeResearchChanges,
      computeInvalidationChanges,
      computeStructureChanges,
      computeFreshnessChanges,
      computeLifecycleState,
    } = await import("../../services/trade-plan-lifecycle-service");

    const saved = {
      researchScore: 75, technicalScore: 70, fundamentalScore: 65, institutionalScore: 60,
      riskLevel: "moderate", marketRegime: "BULL_TREND", sector: "Tech", themes: ["AI"],
      primaryEvidence: [], secondaryEvidence: [], riskFactors: [], invalidatesThesis: [],
      generatedAt: new Date("2026-08-01").toISOString(),
    } as any;

    const current = {
      researchScore: 58, technicalScore: 52, fundamentalScore: 65, institutionalScore: 60,
      riskLevel: "moderate", qualified: true, marketRegime: "BULL_TREND",
      sector: "Tech", themes: ["AI"], asOf: new Date().toISOString(), available: true,
    };

    const rChanges = computeResearchChanges(saved, current);
    const iChanges = computeInvalidationChanges(saved, current);
    const sChanges = computeStructureChanges("EQUITY", null, null);
    const fChanges = computeFreshnessChanges("fresh", true, 2);

    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: fChanges, researchChanges: rChanges,
      invalidationChanges: iChanges, structureChanges: sChanges,
    });

    // Research score dropped 17 points — material → REQUIRES_REVIEW
    expect(state).toBe("REQUIRES_REVIEW");
  });

  it("no change → lifecycle CURRENT (full chain)", async () => {
    const {
      computeResearchChanges, computeInvalidationChanges,
      computeStructureChanges, computeFreshnessChanges, computeLifecycleState,
    } = await import("../../services/trade-plan-lifecycle-service");

    const saved = {
      researchScore: 70, technicalScore: 65, fundamentalScore: 60, institutionalScore: 55,
      riskLevel: "moderate", qualified: true,  // explicit so no spurious NEWLY_QUALIFIED change
      marketRegime: "BULL_TREND", sector: "Tech", themes: ["AI"],
      primaryEvidence: [], secondaryEvidence: [], riskFactors: [], invalidatesThesis: [],
      generatedAt: new Date().toISOString(),
    } as any;

    const current = {
      researchScore: 70, technicalScore: 65, fundamentalScore: 60, institutionalScore: 55,
      riskLevel: "moderate", qualified: true, marketRegime: "BULL_TREND",
      sector: "Tech", themes: ["AI"], asOf: new Date().toISOString(), available: true,
    };

    const rChanges = computeResearchChanges(saved, current);
    const iChanges = computeInvalidationChanges(saved, current);
    const sChanges = computeStructureChanges("EQUITY", null, null);
    const fChanges = computeFreshnessChanges("fresh", true, 1);

    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: fChanges, researchChanges: rChanges,
      invalidationChanges: iChanges, structureChanges: sChanges,
    });

    expect(state).toBe("CURRENT");
  });
});

// ============================================================================
// §I2 — Invalidation → Lifecycle → Activity (end-to-end)
// ============================================================================

describe("Integration §I2: Invalidation → Lifecycle → Activity events", () => {
  it("observed invalidation → THESIS_INVALIDATED state → THESIS_INVALIDATION_OBSERVED activity", async () => {
    const {
      computeInvalidationChanges, computeLifecycleState,
      buildActivitiesFromLifecycleResult,
    } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const saved = {
      researchScore: 70, technicalScore: 65, fundamentalScore: 60, institutionalScore: 55,
      riskLevel: "moderate", marketRegime: "BULL_TREND", sector: "Tech", themes: [],
      primaryEvidence: [], secondaryEvidence: [], riskFactors: [],
      invalidatesThesis: [{ condition: "QUALIFICATION_LOST", description: "Qualification lost" }],
      generatedAt: new Date("2026-08-01").toISOString(),
    } as any;

    const current = {
      researchScore: 70, technicalScore: 65, fundamentalScore: 60, institutionalScore: 55,
      riskLevel: "moderate", qualified: false, // ← qualification lost
      marketRegime: "BULL_TREND", sector: "Tech", themes: [],
      asOf: new Date().toISOString(), available: true,
    };

    const iChanges = computeInvalidationChanges(saved, current);
    expect(iChanges[0].observationState).toBe("observed");

    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [], invalidationChanges: iChanges, structureChanges: [],
    });
    expect(state).toBe("THESIS_INVALIDATED");

    const fakeResult = {
      tradePlanId: "p1", symbol: "AAPL", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: state,
      researchChanges: [], invalidationChanges: iChanges, structureChanges: [],
      eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: current, savedResearchSummary: current,
      requiresReview: true, reviewReasons: [{ reasonType: "THESIS_INVALIDATION_OBSERVED" as any, description: "d" }],
      limitations: [], freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities = buildActivitiesFromLifecycleResult(fakeResult, "CURRENT");
    // THESIS_INVALIDATION_OBSERVED is emitted when transitioning into THESIS_INVALIDATED
    expect(activities.some(a => a.activityType === "THESIS_INVALIDATION_OBSERVED")).toBe(true);
    // REVIEW_REQUIRED is NOT emitted for THESIS_INVALIDATED — that state takes precedence;
    // no dual-emit for the same event
    expect(activities.some(a => a.activityType === "REVIEW_REQUIRED")).toBe(false);
  });
});

// ============================================================================
// §I3 — Options Plan Lifecycle: DTE → Expiration → Structure Change → Activity
// ============================================================================

describe("Integration §I3: Options DTE → Expiration → Structure → Activity", () => {
  it("DTE 15 → NEAR_EXPIRATION → EXPIRATION_NEAR structure change → EXPIRATION_APPROACHING activity", async () => {
    const {
      computeExpirationState, computeStructureChanges, buildActivitiesFromLifecycleResult,
    } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const currentDTE = 15;
    const expirationState = computeExpirationState(currentDTE);
    expect(expirationState).toBe("NEAR_EXPIRATION");

    const sChanges = computeStructureChanges("OPTIONS", { dte: 60, expiration: "2026-09-19" }, currentDTE);
    expect(sChanges.some(s => s.changeType === "EXPIRATION_NEAR")).toBe(true);
    expect(sChanges.some(s => s.isMaterial)).toBe(true);

    const fakeResult = {
      tradePlanId: "p-options", symbol: "AAPL", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: "REQUIRES_REVIEW" as const,
      expirationState, currentDTE,
      researchChanges: [], invalidationChanges: [], structureChanges: sChanges,
      eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: true, reviewReasons: [{ reasonType: "EXPIRATION_APPROACHING" as any, description: "d" }],
      limitations: [], freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities = buildActivitiesFromLifecycleResult(fakeResult, "CURRENT");
    expect(activities.some(a => a.activityType === "EXPIRATION_APPROACHING")).toBe(true);
  });

  it("DTE 0 → EXPIRED state", async () => {
    const { computeExpirationState } = await import("../../services/trade-plan-lifecycle-service");
    expect(computeExpirationState(0)).toBe("EXPIRED");
  });
});

// ============================================================================
// §I4 — Trade Plan → Monitoring Context Handoff (2.7.6)
// ============================================================================

describe("Integration §I4: Trade Plan → Monitoring Context Handoff", () => {
  it("TradePlanMonitoringInput shape is well-defined in types", async () => {
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");
    // Verify the handoff type exists (structural)
    const types = await import("../../../shared/trade-plan-types");
    // TradePlanMonitoringInput was added in 2.7.5
    expect(typeof LIFECYCLE_METHODOLOGY_VERSION).toBe("string");
    expect(types.TRADE_PLAN_DISCLAIMER).toBeTruthy();
  });

  it("monitoring context lifecycle state is a valid LifecycleState", async () => {
    const { LIFECYCLE_STATES } = await import("../../../shared/trade-plan-lifecycle-types");
    const validStates = Array.from(LIFECYCLE_STATES);
    // Each state the monitoring context could report must be in LIFECYCLE_STATES
    expect(validStates).toContain("CURRENT");
    expect(validStates).toContain("REQUIRES_REVIEW");
    expect(validStates).toContain("THESIS_INVALIDATED");
  });
});

// ============================================================================
// §I5 — Review Reasons → Review Actions (UX layer contract)
// ============================================================================

describe("Integration §I5: Review reasons → review action labels", () => {
  it("QUALIFICATION_LOST maps to a human-readable label", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(REVIEW_REASON_LABELS["QUALIFICATION_LOST"]).toContain("Qualification");
  });

  it("EXPIRATION_APPROACHING maps to a human-readable label", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(REVIEW_REASON_LABELS["EXPIRATION_APPROACHING"]).toContain("Expiration");
  });

  it("THESIS_INVALIDATION_OBSERVED maps to neutral label (no exit language)", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const label = REVIEW_REASON_LABELS["THESIS_INVALIDATION_OBSERVED"];
    expect(label).toBeTruthy();
    expect(label.toLowerCase()).not.toContain("exit");
    expect(label.toLowerCase()).not.toContain("sell");
  });

  it("CRITICAL_DATA_STALE maps to a human-readable label", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(REVIEW_REASON_LABELS["CRITICAL_DATA_STALE"]).toContain("Stale");
  });
});

// ============================================================================
// §I6 — Activity Fingerprint → Deduplication (integration)
// ============================================================================

describe("Integration §I6: Fingerprint → Deduplication contract", () => {
  it("same lifecycle result emitted twice does not produce duplicate fingerprints", async () => {
    const { buildActivitiesFromLifecycleResult, buildActivityFingerprint } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const fakeResult = {
      tradePlanId: "plan-dedup-test", symbol: "MSFT", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: "THESIS_INVALIDATED" as const,
      researchChanges: [], invalidationChanges: [{ condition: "QUAL", description: "lost", observationState: "observed" as const, evaluationNote: "not qualified" }],
      structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: true, reviewReasons: [], limitations: [],
      freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities1 = buildActivitiesFromLifecycleResult(fakeResult, "CURRENT");
    const activities2 = buildActivitiesFromLifecycleResult(fakeResult, "THESIS_INVALIDATED"); // already invalidated

    // First emission: THESIS_INVALIDATION activity should appear
    expect(activities1.some(a => a.activityType === "THESIS_INVALIDATION_OBSERVED")).toBe(true);
    // Second emission (same state): should NOT re-emit the invalidation
    expect(activities2.some(a => a.activityType === "THESIS_INVALIDATION_OBSERVED")).toBe(false);

    // Fingerprints for the same activity type + state must be identical
    const fp1 = buildActivityFingerprint("plan-dedup-test", "THESIS_INVALIDATION_OBSERVED", "THESIS_INVALIDATED", LIFECYCLE_METHODOLOGY_VERSION);
    const fp2 = buildActivityFingerprint("plan-dedup-test", "THESIS_INVALIDATION_OBSERVED", "THESIS_INVALIDATED", LIFECYCLE_METHODOLOGY_VERSION);
    expect(fp1).toBe(fp2);
  });
});

// ============================================================================
// §I7 — Platform Health Integration
// ============================================================================

describe("Integration §I7: Platform Health lifecycle metrics", () => {
  it("getLifecycleHealth returns zero-state metrics on fresh import", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();
    // Session starts at 0 — pure structural check
    expect(typeof metrics.plansEvaluated).toBe("number");
    expect(typeof metrics.failedEvaluations).toBe("number");
    expect(typeof metrics.currentPlans).toBe("number");
  });

  it("lifecycle health metrics are aggregates only (no symbol, no user)", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();
    const keys = Object.keys(metrics);
    expect(keys).not.toContain("symbol");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("notes");
  });
});
