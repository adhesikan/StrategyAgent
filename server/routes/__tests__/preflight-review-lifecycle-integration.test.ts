/**
 * server/routes/__tests__/preflight-review-lifecycle-integration.test.ts
 *
 * Regression tests for the state-anchored review validity fix (Defect-10c + production follow-up).
 *
 * Root cause: currentSummary.asOf is scan-execution timestamp, not material-change timestamp.
 * Routine 4-hour scans with IDENTICAL scores advanced asOf, invalidating reviews incorrectly.
 *
 * Fix: reviews are anchored to a reviewed research state snapshot (lastReviewedResearchState).
 * On subsequent evaluations computeResearchChanges(reviewedState, currentSummary) is called —
 * the SAME canonical comparator used for plan-creation → current changes. No new threshold logic.
 *
 *   - identical research in a later scan        → still CURRENT  (scan timestamps irrelevant)
 *   - score drift meeting material-change rules → REQUIRES_REVIEW
 *   - qualification/removal/re-qualification    → REQUIRES_REVIEW  (material)
 *   - risk-level change (defined as material)   → REQUIRES_REVIEW if isMaterial
 *   - non-material drift                         → CURRENT
 *   - preflight consumes the same lifecycle      → via force:true documented separately
 *
 * All tests are PURE COMPUTATION — no DB, no network, no broker calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeLifecycleState, computeResearchChanges } from "../../services/trade-plan-lifecycle-service";
import type { ResearchChangeItem, ReviewedResearchState } from "../../../shared/trade-plan-lifecycle-types";
import type { TradePlanResearchSnapshot } from "../../../shared/trade-plan-types";
import {
  runExecutionPreflight,
  type PreflightDependencies,
  type StoredTradePlan,
  type StoredLifecycleResult,
} from "../../services/execution-preflight-service";
import { MockBrokerExecutionAdapter } from "../../services/broker-execution-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// Kill-switch env
// ─────────────────────────────────────────────────────────────────────────────

let _savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  _savedEnv = {
    BROKER_EXECUTION_ENABLED: process.env.BROKER_EXECUTION_ENABLED,
    BROKER_EXECUTION_MODE:    process.env.BROKER_EXECUTION_MODE,
  };
  process.env.BROKER_EXECUTION_ENABLED = "true";
  process.env.BROKER_EXECUTION_MODE    = "sandbox";
});
afterEach(() => {
  for (const [k, v] of Object.entries(_savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures — scores at plan creation vs scores after drift
// ─────────────────────────────────────────────────────────────────────────────

/** Scores captured when NVDA plan was created (the saved research snapshot). */
const SAVED_SCORES = {
  researchScore: 82, technicalScore: 78, fundamentalScore: 70,
  institutionalScore: 65, riskLevel: "moderate", qualified: true,
  marketRegime: "bullish", sector: "Technology", themes: ["AI"],
};

/** Scores after a material drop — what triggered REQUIRES_REVIEW vs the saved plan. */
const CURRENT_SCORES_V1 = {
  researchScore: 68, technicalScore: 64, fundamentalScore: 70,
  institutionalScore: 65, riskLevel: "moderate", qualified: true,
  marketRegime: "bullish", sector: "Technology", themes: ["AI"],
  asOf: "2026-08-10T10:00:00Z",   // scan v1 timestamp
  available: true,
};

/**
 * Identical scores in a later scan — ONLY the timestamp (asOf) changed.
 * The fix must NOT treat this as a new material change.
 */
const CURRENT_SCORES_V2_SAME = {
  ...CURRENT_SCORES_V1,
  asOf: "2026-08-10T14:00:00Z",   // scan v2: 4h later, SAME underlying scores
};

/** Yet another identical scan — to prove stability of the no-change result. */
const CURRENT_SCORES_V3_SAME = {
  ...CURRENT_SCORES_V1,
  asOf: "2026-08-10T18:00:00Z",   // scan v3: 8h after v1, SAME scores again
};

/** Scores after a FURTHER material drop — new review needed. */
const CURRENT_SCORES_V4_WORSE = {
  ...CURRENT_SCORES_V1,
  researchScore: 50, technicalScore: 45,   // additional -18 / -19 pts (material)
  asOf: "2026-08-11T08:00:00Z",
};

/** Scores with a non-material drift only (< 5 pts). */
const CURRENT_SCORES_NON_MATERIAL = {
  ...CURRENT_SCORES_V1,
  researchScore: 70, technicalScore: 66,   // +2 / +2 pts from reviewed baseline — non-material
  asOf: "2026-08-10T16:00:00Z",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build reviewedStateChanges by calling the canonical comparator
// ─────────────────────────────────────────────────────────────────────────────

function buildReviewedStateChanges(
  reviewedState: ReviewedResearchState,
  currentScores: typeof CURRENT_SCORES_V1,
): ResearchChangeItem[] {
  return computeResearchChanges(
    reviewedState as unknown as TradePlanResearchSnapshot,
    { ...currentScores, available: true },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-1  computeLifecycleState — full review sequence (9 required scenarios)
// ─────────────────────────────────────────────────────────────────────────────

describe("§PRLCI-1  computeLifecycleState — full state-anchored review sequence", () => {

  const materialChanges: ResearchChangeItem[] = [
    { isMaterial: true, changeType: "RESEARCH_WEAKENED", savedValue: 82, currentValue: 68, delta: -14, description: "Research score changed" },
    { isMaterial: true, changeType: "TECHNICAL_WEAKENED", savedValue: 78, currentValue: 64, delta: -14, description: "Technical score changed" },
  ];

  // ── Scenario 1: material score change → review required ───────────────────
  it("Scenario 1: material score change (vs saved plan) → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: null, reviewedStateChanges: null,
    })).toBe("REQUIRES_REVIEW");
  });

  // ── Scenario 2: mark reviewed (state-anchored) → CURRENT ──────────────────
  it("Scenario 2: mark reviewed — reviewed state matches current state → CURRENT", () => {
    // User reviews at scan-v1 scores. Reviewed baseline = V1 scores.
    // reviewedStateChanges = computeResearchChanges(reviewedBaseline=V1, current=V1) = []
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_V1);

    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(false);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,  // no material changes since reviewed baseline
    })).toBe("CURRENT");
  });

  // ── Scenario 3: identical next scan with newer asOf → STILL CURRENT ───────
  it("Scenario 3: identical next scan (asOf advanced, scores unchanged) → CURRENT", () => {
    // THE CORE FIX: V2 has newer asOf but same scores. Review must remain valid.
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_V2_SAME);

    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(false);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,  // V2 asOf is newer but scores identical → no material change
    })).toBe("CURRENT");
  });

  // ── Scenario 4: second identical scan → STILL CURRENT ────────────────────
  it("Scenario 4: second identical scan (V3) → CURRENT (stability)", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_V3_SAME);

    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(false);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,  // V3: still same scores → still CURRENT
    })).toBe("CURRENT");
  });

  // ── Scenario 5: new material score change → REQUIRES_REVIEW ──────────────
  it("Scenario 5: scores dropped further since review → REQUIRES_REVIEW", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_V4_WORSE);

    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(true);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,  // V4: researchScore -18, technicalScore -19 → material
    })).toBe("REQUIRES_REVIEW");
  });

  // ── Scenario 6: qualified → removed → REQUIRES_REVIEW ────────────────────
  it("Scenario 6: symbol removed (symbolNotQualified = true) → REQUIRES_REVIEW regardless of review", () => {
    // symbolNotQualified check fires BEFORE reviewedStateChanges — always REQUIRES_REVIEW
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_V1);
    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(false);

    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: false,
      freshnessChanges: [], researchChanges: [],
      invalidationChanges: [], structureChanges: [],
      symbolNotQualified: true,
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,  // would be CURRENT... but symbolNotQualified takes priority
    })).toBe("REQUIRES_REVIEW");
  });

  // ── Scenario 7: removed → re-qualified → REQUIRES_REVIEW ─────────────────
  it("Scenario 7: re-qualified after removal — reviewed baseline had qualified=false → REQUIRES_REVIEW", () => {
    // If the user reviewed while symbol was removed, reviewed state captured qualified=false.
    // When symbol re-qualifies (qualified=true), NEWLY_QUALIFIED is material → REQUIRES_REVIEW.
    const reviewedWhileRemoved: ReviewedResearchState = {
      ...CURRENT_SCORES_V1,
      qualified: false,   // symbol was not qualified when user acknowledged
    };
    const reQualifiedCurrent = { ...CURRENT_SCORES_V1, qualified: true };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedWhileRemoved, reQualifiedCurrent);

    expect(reviewedStateChanges.some(c => c.isMaterial && c.changeType === "NEWLY_QUALIFIED")).toBe(true);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,
    })).toBe("REQUIRES_REVIEW");
  });

  // ── Scenario 8: material risk/classification change → REQUIRES_REVIEW ─────
  it("Scenario 8: NO_LONGER_QUALIFIED in reviewed state changes → REQUIRES_REVIEW", () => {
    // Reviewed state had qualified=true; symbol lost qualification since review.
    const reviewedQualified: ReviewedResearchState = { ...CURRENT_SCORES_V1, qualified: true };
    const nowUnqualified = { ...CURRENT_SCORES_V1, qualified: false };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedQualified, nowUnqualified);

    expect(reviewedStateChanges.some(c => c.isMaterial && c.changeType === "NO_LONGER_QUALIFIED")).toBe(true);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,
    })).toBe("REQUIRES_REVIEW");
  });

  // ── Scenario 9: non-material drift → CURRENT ─────────────────────────────
  it("Scenario 9: non-material drift from reviewed baseline (< 5 pts) → CURRENT", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const reviewedStateChanges = buildReviewedStateChanges(reviewedState, CURRENT_SCORES_NON_MATERIAL);

    // +2 pts on research, +2 pts on technical — below the 5-point material threshold
    expect(reviewedStateChanges.some(c => c.isMaterial)).toBe(false);
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: materialChanges,
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges,
    })).toBe("CURRENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-2  Preflight integration — post-review lifecycle PASS
// ─────────────────────────────────────────────────────────────────────────────

const T_NOW = new Date("2026-08-11T09:00:00Z");

function makePlan(): StoredTradePlan {
  return {
    id: "plan-nvda-001",
    userId: "user-001",
    symbol: "NVDA",
    planType: "EQUITY",
    status: "RESEARCH_COMPLETE",
    version: 1,
    updatedAt: new Date("2026-08-09T10:00:00Z"),
    riskSnapshot: { maxRiskDollars: 500, positionSizeShares: 10, entryPrice: 140, stopLossPrice: 130, targetPrice: 160 },
    structureSnapshot: { selectedExpressionFamily: "equity", entryTriggerType: "BREAKOUT" },
    limitations: [],
  };
}

function makeLifecycleDeps(
  plan: StoredTradePlan,
  lifecycleState: StoredLifecycleResult["lifecycleState"],
  evaluatedAt: Date,
): PreflightDependencies {
  return {
    brokerAdapter: new MockBrokerExecutionAdapter({ connected: true }) as any,
    getTradePlan: async () => plan,
    getLifecycleResult: async () => ({ planId: plan.id, lifecycleState, evaluatedAt }),
    savePreflight: async () => {},
    saveAuditEvent: async () => {},
    now: () => T_NOW,
  };
}

describe("§PRLCI-2  Preflight integration — review → lifecycle PASS", () => {

  it("Pre-review: REQUIRES_REVIEW → preflight blocks with PLAN_REQUIRES_REVIEW", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "REQUIRES_REVIEW", T_NOW),
    );
    expect(result.lifecycleValidation.status).toBe("REQUIRES_REVIEW");
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });

  it("After review: CURRENT → preflight lifecycle PASS, no PLAN_REQUIRES_REVIEW blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "CURRENT", T_NOW),
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });

  it("After review: Plan Freshness PASS (evaluatedAt is recent = T_NOW)", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "CURRENT", T_NOW),
    );
    expect(result.freshnessValidation.status).toBe("PASS");
  });

  it("Second preflight run (no new change) → lifecycle still PASS", async () => {
    const deps = makeLifecycleDeps(makePlan(), "CURRENT", T_NOW);
    const run1 = await runExecutionPreflight({ tradePlanId: "plan-nvda-001", userId: "user-001" }, deps);
    const run2 = await runExecutionPreflight({ tradePlanId: "plan-nvda-001", userId: "user-001" }, deps);
    expect(run1.lifecycleValidation.status).toBe("PASS");
    expect(run2.lifecycleValidation.status).toBe("PASS");
    expect(run2.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });

  it("New material change after review → lifecycle REQUIRES_REVIEW → preflight blocks again", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "REQUIRES_REVIEW", T_NOW),
    );
    expect(result.lifecycleValidation.status).toBe("REQUIRES_REVIEW");
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-3  Plan Freshness dimension
// ─────────────────────────────────────────────────────────────────────────────

describe("§PRLCI-3  Plan Freshness: evaluatedAt determines freshness, not review status", () => {
  it("evaluatedAt = T_NOW (seconds old) → Plan Freshness PASS", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "CURRENT", T_NOW),
    );
    expect(result.freshnessValidation.status).toBe("PASS");
  });

  it("evaluatedAt = 3h ago → Plan Freshness REQUIRES_REVIEW (stale lifecycle)", async () => {
    const threeHoursAgo = new Date(T_NOW.getTime() - 3 * 60 * 60_000);
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "CURRENT", threeHoursAgo),
    );
    expect(result.freshnessValidation.status).toBe("REQUIRES_REVIEW");
  });

  it("Pre-fix bug reproduction: old stored preflight (REQUIRES_REVIEW + 3h-old evaluatedAt) shows both failing", async () => {
    const threeHoursAgo = new Date(T_NOW.getTime() - 3 * 60 * 60_000);
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeLifecycleDeps(makePlan(), "REQUIRES_REVIEW", threeHoursAgo),
    );
    expect(result.lifecycleValidation.status).toBe("REQUIRES_REVIEW");
    expect(result.freshnessValidation.status).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-4  State-anchored review validity: reviewedStateChanges semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("§PRLCI-4  reviewedStateChanges validity semantics", () => {
  const materialChange: ResearchChangeItem = {
    isMaterial: true, changeType: "RESEARCH_WEAKENED",
    savedValue: 82, currentValue: 68, delta: -14, description: "Research score changed",
  };
  const nonMaterialChange: ResearchChangeItem = {
    isMaterial: false, changeType: "RESEARCH_WEAKENED",
    savedValue: 68, currentValue: 70, delta: 2, description: "Tiny drift",
  };

  it("reviewedStateChanges = [] (empty) → no material change since review → CURRENT", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges: [],   // empty = no changes since review
    })).toBe("CURRENT");
  });

  it("reviewedStateChanges = [nonMaterial only] → CURRENT (threshold not met)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges: [nonMaterialChange],
    })).toBe("CURRENT");
  });

  it("reviewedStateChanges = [material] → scores drifted since review → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date("2026-08-10T11:00:00Z"),
      reviewedStateChanges: [materialChange],   // material change since review
    })).toBe("REQUIRES_REVIEW");
  });

  it("reviewedStateChanges = null (legacy plan, no baseline stored) → falls back to 7-day window", () => {
    const recentReview = new Date(Date.now() - 1 * 24 * 60 * 60_000); // 1 day ago
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: recentReview,
      reviewedStateChanges: null,   // no reviewed baseline → legacy fallback
    })).toBe("CURRENT");   // within 7-day window
  });

  it("reviewedStateChanges = null + lastReviewedAt null → REQUIRES_REVIEW (no review done)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: null, reviewedStateChanges: null,
    })).toBe("REQUIRES_REVIEW");
  });

  it("reviewedStateChanges = [] (identical scan) regardless of time elapsed → CURRENT (scan timestamp irrelevant)", () => {
    // This is the core production fix: the opportunity engine ran a new scan 4h after the review.
    // Scores are IDENTICAL. reviewedStateChanges is empty. CURRENT — NOT REQUIRES_REVIEW.
    const reviewedAt = new Date("2026-08-10T11:00:00Z");
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [materialChange],
      invalidationChanges: [], structureChanges: [],
      lastReviewedAt: reviewedAt,
      reviewedStateChanges: [],   // new scan ran, same scores
    })).toBe("CURRENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-5  Non-clearable states unaffected by reviewedStateChanges
// ─────────────────────────────────────────────────────────────────────────────

describe("§PRLCI-5  Non-clearable states unaffected by review", () => {
  const materialChange: ResearchChangeItem = {
    isMaterial: true, changeType: "RESEARCH_WEAKENED",
    savedValue: 82, currentValue: 68, delta: -14, description: "...",
  };

  it("THESIS_INVALIDATED: reviewedStateChanges=[] does not clear it", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [materialChange],
      invalidationChanges: [{ observationState: "observed", description: "Price below stop" }],
      structureChanges: [],
      lastReviewedAt: new Date(), reviewedStateChanges: [],
    })).toBe("THESIS_INVALIDATED");
  });

  it("DATA_STALE: reviewedStateChanges=[] does not clear it", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale" }],
      researchChanges: [], invalidationChanges: [], structureChanges: [],
      lastReviewedAt: new Date(), reviewedStateChanges: [],
    })).toBe("DATA_STALE");
  });

  it("QUALIFICATION_LOST: symbolNotQualified=true + reviewedStateChanges=[] → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: false,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
      symbolNotQualified: true,
      lastReviewedAt: new Date(), reviewedStateChanges: [],
    })).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PRLCI-6  computeResearchChanges: same scores → no material changes (canonical verifier)
// ─────────────────────────────────────────────────────────────────────────────

describe("§PRLCI-6  computeResearchChanges: identical scores → no material changes", () => {

  it("same scores (V1 vs V1) → zero changes", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_V1, available: true },
    );
    expect(changes).toHaveLength(0);
  });

  it("same scores (V1 vs V2, different asOf) → zero changes (scan timestamp ignored)", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_V2_SAME, available: true },
    );
    expect(changes).toHaveLength(0);
  });

  it("material score drop → exactly those changes are material", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_V4_WORSE, available: true },
    );
    const material = changes.filter(c => c.isMaterial);
    expect(material.length).toBeGreaterThanOrEqual(1);
    expect(material.some(c => c.changeType === "RESEARCH_WEAKENED")).toBe(true);
  });

  it("qualification loss (qualified: true → false) → NO_LONGER_QUALIFIED is material", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1, qualified: true };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_V1, qualified: false, available: true },
    );
    expect(changes.some(c => c.changeType === "NO_LONGER_QUALIFIED" && c.isMaterial)).toBe(true);
  });

  it("re-qualification (qualified: false → true) → NEWLY_QUALIFIED is material", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1, qualified: false };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_V1, qualified: true, available: true },
    );
    expect(changes.some(c => c.changeType === "NEWLY_QUALIFIED" && c.isMaterial)).toBe(true);
  });

  it("non-material drift only (< 5pts) → no material changes", () => {
    const reviewedState: ReviewedResearchState = { ...CURRENT_SCORES_V1 };
    const changes = computeResearchChanges(
      reviewedState as unknown as TradePlanResearchSnapshot,
      { ...CURRENT_SCORES_NON_MATERIAL, available: true },
    );
    expect(changes.some(c => c.isMaterial)).toBe(false);
  });

  it("no changes at all → empty array", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
      lastReviewedAt: null, reviewedStateChanges: null,
    })).toBe("CURRENT");
  });
});
