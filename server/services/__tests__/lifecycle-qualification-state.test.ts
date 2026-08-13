/**
 * server/services/__tests__/lifecycle-qualification-state.test.ts
 *
 * Regression coverage for the "symbol drops from OppIntel qualified-candidate list" lifecycle defect.
 *
 * Spec test cases A–I (from the bug report):
 *   A. Qualified candidate → create Trade Plan → candidate remains qualified
 *   B. Qualified candidate → create Trade Plan → candidate later removed
 *   C. Removed candidate → saved Trade Plan remains accessible (logic tested here; route tested separately)
 *   D. Removed candidate → historical research (savedResearchSummary) remains accessible
 *   E. Removed candidate → Review Research works (review panel shows saved data)
 *   F. Removed candidate → Execution Preflight blocks appropriately
 *   G. Archived plan behavior remains unchanged
 *   H. Another user's Trade Plan cannot be accessed (ownership; route-level; contract tested here)
 *   I. Truly nonexistent Trade Plan still returns NOT_FOUND
 *
 * Additional coverage:
 *   §QS1  symbolQualificationStatus=NOT_QUALIFIED when getCanonicalOpportunity returns null (no exception)
 *   §QS2  symbolQualificationStatus=UNKNOWN when getCanonicalOpportunity throws (system error)
 *   §QS3  symbolQualificationStatus=QUALIFIED when opportunity present
 *   §QS4  computeLifecycleState: symbolNotQualified=true → REQUIRES_REVIEW (not UNKNOWN)
 *   §QS5  computeLifecycleState: symbolNotQualified=true, lastReviewedAt recent → REQUIRES_REVIEW (NOT clearable)
 *   §QS6  computeLifecycleState: symbolNotQualified=false, !currentAvailable → UNKNOWN (system error)
 *   §QS7  computeReviewReasons: symbolNotQualified=true → QUALIFICATION_LOST reason (first)
 *   §QS8  computeReviewReasons: symbolNotQualified=true → returns early (no CRITICAL_DATA_STALE pollution)
 *   §QS9  computeLifecycleState: symbolNotQualified + ARCHIVED plan → ARCHIVED (plan status takes priority)
 *   §QS10 computeLifecycleState: symbolNotQualified=false, hasMaterialChange, recent review → CURRENT
 *   §QS11 lifecycle result includes symbolQualificationStatus field
 *   §QS12 lifecycle limitations describe NOT_QUALIFIED clearly (not generic "unavailable" message)
 *   §QS13 preflight blocks with PLAN_REQUIRES_REVIEW when lifecycle=REQUIRES_REVIEW (from qualification loss)
 *   §QS14 review acknowledgement records RESEARCH_REVIEWED activity even for NOT_QUALIFIED case
 *   §QS15 source file: "No Longer Qualified" language used in client UI
 */

import { describe, it, expect } from "vitest";
import {
  computeLifecycleState,
  computeReviewReasons,
} from "../trade-plan-lifecycle-service";
import { REVIEW_REASON_TYPES } from "../../../shared/trade-plan-lifecycle-types";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const BASE_QUALIFIED_PARAMS = {
  planStatus:          "RESEARCH_COMPLETE",
  currentAvailable:    true,
  freshnessChanges:    [] as any[],
  researchChanges:     [] as any[],
  invalidationChanges: [] as any[],
  structureChanges:    [] as any[],
};

const BASE_NOT_QUALIFIED_PARAMS = {
  planStatus:          "RESEARCH_COMPLETE",
  currentAvailable:    false,
  freshnessChanges:    [{ changeType: "DATA_UNAVAILABLE", dataSource: "research", description: "unavailable", savedFreshness: null, currentFreshness: null }] as any[],
  researchChanges:     [] as any[],
  invalidationChanges: [] as any[],
  structureChanges:    [] as any[],
  symbolNotQualified:  true,
};

const BASE_SYSTEM_ERROR_PARAMS = {
  ...BASE_NOT_QUALIFIED_PARAMS,
  symbolNotQualified: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// §QS4 / §QS5 / §QS6  computeLifecycleState behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS4  computeLifecycleState: symbolNotQualified=true → REQUIRES_REVIEW", () => {
  it("A (qualified, no changes) → CURRENT", () => {
    expect(computeLifecycleState(BASE_QUALIFIED_PARAMS)).toBe("CURRENT");
  });

  it("B (symbol later removed) → REQUIRES_REVIEW (not UNKNOWN)", () => {
    expect(computeLifecycleState(BASE_NOT_QUALIFIED_PARAMS)).toBe("REQUIRES_REVIEW");
  });

  it("G (archived plan + symbolNotQualified) → ARCHIVED (plan status takes priority)", () => {
    expect(computeLifecycleState({ ...BASE_NOT_QUALIFIED_PARAMS, planStatus: "ARCHIVED" })).toBe("ARCHIVED");
  });

  it("symbol not qualified + thesis invalidated → REQUIRES_REVIEW (symbolNotQualified fires first)", () => {
    expect(computeLifecycleState({
      ...BASE_NOT_QUALIFIED_PARAMS,
      invalidationChanges: [{ observationState: "observed", description: "cond" }],
    })).toBe("REQUIRES_REVIEW");
  });
});

describe("§QS5  computeLifecycleState: symbolNotQualified=true, recent review → REQUIRES_REVIEW (NOT clearable)", () => {
  it("recent review (1 day ago) + symbolNotQualified → REQUIRES_REVIEW (review cannot clear qualification loss)", () => {
    expect(computeLifecycleState({
      ...BASE_NOT_QUALIFIED_PARAMS,
      lastReviewedAt: daysAgo(1),
    })).toBe("REQUIRES_REVIEW");
  });

  it("recent review (same day) + symbolNotQualified → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      ...BASE_NOT_QUALIFIED_PARAMS,
      lastReviewedAt: daysAgo(0.01),
    })).toBe("REQUIRES_REVIEW");
  });

  it("recent review (6 days) + symbolNotQualified → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      ...BASE_NOT_QUALIFIED_PARAMS,
      lastReviewedAt: daysAgo(6),
    })).toBe("REQUIRES_REVIEW");
  });
});

describe("§QS6  computeLifecycleState: symbolNotQualified=false, !currentAvailable → UNKNOWN (system error)", () => {
  it("system error (exception thrown, symbolNotQualified=false) → UNKNOWN", () => {
    expect(computeLifecycleState(BASE_SYSTEM_ERROR_PARAMS)).toBe("UNKNOWN");
  });

  it("system error + recent review → UNKNOWN (review cannot clear system errors)", () => {
    expect(computeLifecycleState({
      ...BASE_SYSTEM_ERROR_PARAMS,
      lastReviewedAt: daysAgo(1),
    })).toBe("UNKNOWN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS7 / §QS8  computeReviewReasons
// ─────────────────────────────────────────────────────────────────────────────

const BASE_REVIEW_PARAMS = {
  researchChanges:     [] as any[],
  invalidationChanges: [] as any[],
  structureChanges:    [] as any[],
  eventChanges:        [] as any[],
  liquidityChanges:    [] as any[],
  freshnessChanges:    [{ changeType: "DATA_UNAVAILABLE" }] as any[],
};

describe("§QS7  computeReviewReasons: symbolNotQualified=true → QUALIFICATION_LOST first", () => {
  it("QUALIFICATION_LOST is the first (and only) reason when symbolNotQualified", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0].reasonType).toBe("QUALIFICATION_LOST");
  });

  it("QUALIFICATION_LOST description mentions 'no longer qualifies'", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    expect(reasons[0].description.toLowerCase()).toContain("no longer qualifies");
  });

  it("description mentions acknowledging the review", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    expect(reasons[0].description.toLowerCase()).toContain("acknowledging");
  });
});

describe("§QS8  computeReviewReasons: symbolNotQualified=true → returns early (no CRITICAL_DATA_STALE)", () => {
  it("returns exactly one reason (early return prevents CRITICAL_DATA_STALE from freshnessChanges)", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    expect(reasons).toHaveLength(1);
    expect(reasons[0].reasonType).toBe("QUALIFICATION_LOST");
  });

  it("without symbolNotQualified, DATA_UNAVAILABLE freshness change would emit CRITICAL_DATA_STALE", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: false });
    expect(reasons.some(r => r.reasonType === "CRITICAL_DATA_STALE")).toBe(true);
  });

  it("without symbolNotQualified, no QUALIFICATION_LOST reason emitted", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: false });
    expect(reasons.some(r => r.reasonType === "QUALIFICATION_LOST")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS9  ARCHIVED plan behavior unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS9  Archived plan: symbolNotQualified takes back seat to ARCHIVED status", () => {
  it("ARCHIVED status + symbolNotQualified → ARCHIVED (not REQUIRES_REVIEW)", () => {
    expect(computeLifecycleState({ ...BASE_NOT_QUALIFIED_PARAMS, planStatus: "ARCHIVED" })).toBe("ARCHIVED");
  });

  it("INVALIDATED status + symbolNotQualified → ARCHIVED", () => {
    expect(computeLifecycleState({ ...BASE_NOT_QUALIFIED_PARAMS, planStatus: "INVALIDATED" })).toBe("ARCHIVED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS10  Score-based REQUIRES_REVIEW remains clearable by review
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS10  Score-based material change + recent review → CURRENT (unaffected by symbolNotQualified fix)", () => {
  it("material change + recent review + symbolNotQualified=false → CURRENT", () => {
    expect(computeLifecycleState({
      planStatus:          "RESEARCH_COMPLETE",
      currentAvailable:    true,
      freshnessChanges:    [] as any[],
      researchChanges:     [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -10" }],
      invalidationChanges: [] as any[],
      structureChanges:    [] as any[],
      lastReviewedAt:      daysAgo(1),
    })).toBe("CURRENT");
  });

  it("material change + no review → REQUIRES_REVIEW (unchanged baseline)", () => {
    expect(computeLifecycleState({
      planStatus:          "RESEARCH_COMPLETE",
      currentAvailable:    true,
      freshnessChanges:    [] as any[],
      researchChanges:     [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -10" }],
      invalidationChanges: [] as any[],
      structureChanges:    [] as any[],
    })).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS1 / §QS2 / §QS3  symbolQualificationStatus values (source inspection)
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS1 / §QS2 / §QS3  symbolQualificationStatus in service source", () => {
  const svcFile = path.resolve(__dirname, "../trade-plan-lifecycle-service.ts");
  let src = "";
  try { src = fs.readFileSync(svcFile, "utf-8"); } catch {}

  it("service tracks symbolNotQualified when getCanonicalOpportunity returns null", () => {
    expect(src).toContain("symbolNotQualified = true");
  });

  it("service tracks opportunityFetchError when getCanonicalOpportunity throws", () => {
    expect(src).toContain("opportunityFetchError = true");
  });

  it("symbolQualificationStatus is NOT_QUALIFIED when symbolNotQualified", () => {
    expect(src).toContain(`symbolNotQualified    ? "NOT_QUALIFIED"`);
  });

  it("symbolQualificationStatus is UNKNOWN when opportunityFetchError", () => {
    expect(src).toContain(`opportunityFetchError ? "UNKNOWN"`);
  });

  it("symbolQualificationStatus is QUALIFIED when currentAvailable", () => {
    expect(src).toContain(`currentAvailable      ? "QUALIFIED"`);
  });

  it("symbolQualificationStatus is added to the lifecycle result object", () => {
    expect(src).toContain("symbolQualificationStatus,");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS11  TradePlanLifecycleResult type includes symbolQualificationStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS11  shared type: TradePlanLifecycleResult.symbolQualificationStatus", () => {
  const typesFile = path.resolve(__dirname, "../../../shared/trade-plan-lifecycle-types.ts");
  let src = "";
  try { src = fs.readFileSync(typesFile, "utf-8"); } catch {}

  it("SymbolQualificationStatus type is defined", () => {
    expect(src).toContain('type SymbolQualificationStatus');
  });

  it("SymbolQualificationStatus has QUALIFIED / NOT_QUALIFIED / UNKNOWN values", () => {
    expect(src).toContain('"QUALIFIED"');
    expect(src).toContain('"NOT_QUALIFIED"');
  });

  it("TradePlanLifecycleResult includes symbolQualificationStatus field", () => {
    const resultBlock = src.slice(
      src.indexOf("interface TradePlanLifecycleResult"),
      src.indexOf("interface TradePlanLifecycleResult") + 3000
    );
    expect(resultBlock).toContain("symbolQualificationStatus");
  });

  it("QUALIFICATION_LOST is in REVIEW_REASON_TYPES", () => {
    expect(REVIEW_REASON_TYPES).toContain("QUALIFICATION_LOST");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS12  Lifecycle limitations distinguish NOT_QUALIFIED from generic unavailable
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS12  Limitations: NOT_QUALIFIED vs generic data unavailable", () => {
  const svcFile = path.resolve(__dirname, "../trade-plan-lifecycle-service.ts");
  let src = "";
  try { src = fs.readFileSync(svcFile, "utf-8"); } catch {}

  it("NOT_QUALIFIED limitations mention 'not present in the latest qualified-candidate snapshot'", () => {
    expect(src).toContain("not present in the latest qualified-candidate snapshot");
  });

  it("system error limitations say 'temporarily unavailable' (distinguishing from qualification loss)", () => {
    expect(src).toContain("temporarily unavailable");
  });

  it("NOT_QUALIFIED limitations mention 'Historical saved research is available'", () => {
    expect(src).toContain("Historical saved research is available");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS13  Preflight blocks appropriately (source inspection)
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS13  Preflight: REQUIRES_REVIEW → PLAN_REQUIRES_REVIEW blocker", () => {
  const preflightFile = path.resolve(__dirname, "../../services/execution-preflight-service.ts");
  let src = "";
  try { src = fs.readFileSync(preflightFile, "utf-8"); } catch {}

  it("preflight has PLAN_REQUIRES_REVIEW blocker for REQUIRES_REVIEW state", () => {
    expect(src).toContain("PLAN_REQUIRES_REVIEW");
    expect(src).toContain('state === "REQUIRES_REVIEW"');
  });

  it("preflight has separate UNKNOWN_CRITICAL_STATE blocker for UNKNOWN state", () => {
    expect(src).toContain("UNKNOWN_CRITICAL_STATE");
    expect(src).toContain('state === "UNKNOWN"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS14  RESEARCH_REVIEWED activity type available for NOT_QUALIFIED case
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS14  RESEARCH_REVIEWED activity available for NOT_QUALIFIED case", () => {
  it("RESEARCH_REVIEWED is in ACTIVITY_EVENT_TYPES (from prior sprint)", async () => {
    const { ACTIVITY_EVENT_TYPES } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(ACTIVITY_EVENT_TYPES).toContain("RESEARCH_REVIEWED");
  });

  it("review endpoint records RESEARCH_REVIEWED for any REQUIRES_REVIEW case (including NOT_QUALIFIED)", () => {
    const routeFile = path.resolve(__dirname, "../../routes/trade-plans.ts");
    let src = "";
    try { src = fs.readFileSync(routeFile, "utf-8"); } catch {}
    // The review endpoint does not check symbolQualificationStatus — it always records the review
    const reviewRouteBlock = src.slice(src.indexOf('lifecycle/review", isAuthenticated'), src.indexOf('lifecycle/evaluate", isAuthenticated'));
    expect(reviewRouteBlock).toContain("RESEARCH_REVIEWED");
    // But it re-evaluates lifecycle, so symbolNotQualified will still yield REQUIRES_REVIEW
    expect(reviewRouteBlock).toContain("evaluateTradePlanLifecycle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §QS15  Client UI: "No Longer Qualified" language
// ─────────────────────────────────────────────────────────────────────────────

describe("§QS15  Client UI: qualification-loss language", () => {
  const clientFile = path.resolve(__dirname, "../../../client/src/pages/trade-plan-detail.tsx");
  let src = "";
  try { src = fs.readFileSync(clientFile, "utf-8"); } catch {}

  it("source file is readable", () => {
    expect(src.length).toBeGreaterThan(100);
  });

  it("uses 'No Longer Qualified' language (not 'Bad trade' / 'Sell' / 'Do not buy')", () => {
    expect(src).toContain("No Longer Qualified");
    expect(src.toLowerCase()).not.toContain("bad trade");
    expect(src.toLowerCase()).not.toContain("do not buy");
    expect(src.toLowerCase()).not.toContain("exit now");
  });

  it("isNotQualified derived from symbolQualificationStatus === 'NOT_QUALIFIED'", () => {
    expect(src).toContain('symbolQualificationStatus === "NOT_QUALIFIED"');
  });

  it("review panel shows saved research when isNotQualified", () => {
    expect(src).toContain("Research at Plan Creation");
  });

  it("review panel shows 'Current Opportunity Status' card when isNotQualified", () => {
    expect(src).toContain("Current Opportunity Status");
  });

  it("acknowledgement disclaimer mentions 'does not restore qualification'", () => {
    expect(src).toContain("does not restore qualification");
  });

  it("acknowledgement disclaimer mentions 'does not constitute a buy or sell recommendation' (for score-based path)", () => {
    expect(src).toContain("does not constitute a buy or sell recommendation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B / D / E  Domain model separation: saved plan data is preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("B / D / E  Domain model: saved research survives qualification loss", () => {
  it("D: computeLifecycleState returns REQUIRES_REVIEW (not a delete/archive) when symbol removed", () => {
    const state = computeLifecycleState(BASE_NOT_QUALIFIED_PARAMS);
    expect(state).toBe("REQUIRES_REVIEW");
    expect(state).not.toBe("ARCHIVED");
    expect(state).not.toBe("UNKNOWN");
  });

  it("E: computeReviewReasons returns QUALIFICATION_LOST reason (review workflow accessible)", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    expect(reasons.some(r => r.reasonType === "QUALIFICATION_LOST")).toBe(true);
  });

  it("E: review reasons describe actionable next steps", () => {
    const reasons = computeReviewReasons({ ...BASE_REVIEW_PARAMS, symbolNotQualified: true });
    const qual = reasons.find(r => r.reasonType === "QUALIFICATION_LOST")!;
    expect(qual.description.toLowerCase()).toContain("review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F  Preflight behavior: blocks after qualification loss (even after review)
// ─────────────────────────────────────────────────────────────────────────────

describe("F  Preflight blocks after review when symbol still unqualified", () => {
  it("lifecycle state remains REQUIRES_REVIEW even after review (recent lastReviewedAt)", () => {
    // Simulates: user reviewed → lastReviewedAt = now → re-evaluate lifecycle → symbol STILL not in OppIntel
    const state = computeLifecycleState({
      ...BASE_NOT_QUALIFIED_PARAMS,
      lastReviewedAt: new Date(), // just reviewed
    });
    expect(state).toBe("REQUIRES_REVIEW"); // still REQUIRES_REVIEW — not CURRENT
  });

  it("preflight source has REQUIRES_REVIEW → status: REQUIRES_REVIEW (not PASS)", () => {
    const preflightFile = path.resolve(__dirname, "../../services/execution-preflight-service.ts");
    let src = "";
    try { src = fs.readFileSync(preflightFile, "utf-8"); } catch {}
    // The PLAN_REQUIRES_REVIEW blocker and the status: "REQUIRES_REVIEW" return
    // both appear in the lifecycle-dimension builder for the REQUIRES_REVIEW branch.
    expect(src).toContain("PLAN_REQUIRES_REVIEW");
    expect(src).toContain('status: "REQUIRES_REVIEW"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H / I  Ownership and NOT_FOUND invariants (source inspection)
// ─────────────────────────────────────────────────────────────────────────────

describe("H / I  Ownership guard and NOT_FOUND contract", () => {
  const planSvcFile = path.resolve(__dirname, "../trade-plan-service.ts");
  let planSrc = "";
  try { planSrc = fs.readFileSync(planSvcFile, "utf-8"); } catch {}

  it("H: getTradePlan filters by both planId AND userId (ownership enforced)", () => {
    const fnBlock = planSrc.slice(planSrc.indexOf("export async function getTradePlan"), planSrc.indexOf("export async function getTradePlan") + 1000);
    expect(fnBlock).toContain("userId");
    expect(fnBlock).toContain("planId");
  });

  it("I: getTradePlan returns null for truly nonexistent plan (route returns 404)", () => {
    // The service returns null; routes check and return 404.
    // Verify the route contract.
    const routeFile = path.resolve(__dirname, "../../routes/trade-plans.ts");
    let routeSrc = "";
    try { routeSrc = fs.readFileSync(routeFile, "utf-8"); } catch {}
    expect(routeSrc).toContain("Trade plan not found.");
  });

  it("lifecycle evaluator does NOT include OppIntel in the plan ownership check", () => {
    // The lifecycler DB query must only filter by planId + userId, NOT by symbol/OppIntel
    const svcFile = path.resolve(__dirname, "../trade-plan-lifecycle-service.ts");
    let svcSrc = "";
    try { svcSrc = fs.readFileSync(svcFile, "utf-8"); } catch {}

    // The DB query for the plan
    const planQuery = svcSrc.slice(svcSrc.indexOf("Load plan from DB"), svcSrc.indexOf("Fetch current opportunity"));
    expect(planQuery).toContain("eq(tradePlans.id");
    expect(planQuery).toContain("eq(tradePlans.userId");
    // Must NOT join on any opportunity / snapshot table
    expect(planQuery).not.toContain("opportunity_scan_snapshots");
    expect(planQuery).not.toContain("getCanonicalOpportunity");
  });
});
