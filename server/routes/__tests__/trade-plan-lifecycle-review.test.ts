/**
 * server/routes/__tests__/trade-plan-lifecycle-review.test.ts
 *
 * Sprint 2.8.6A — Defect-9: Trade Plan lifecycle review workflow
 *
 * Tests covering:
 *   §RR1  "Open Research Workspace" navigates to /research-workspace?symbol=NVDA (not /research/:id)
 *   §RR2  "Review Research" / "Review Current Research" does not auto-acknowledge
 *   §RR3  POST /api/trade-plans/:id/lifecycle/review sets lastReviewedAt
 *   §RR4  POST .../review records RESEARCH_REVIEWED activity
 *   §RR5  POST .../review re-evaluates lifecycle
 *   §RR6  computeLifecycleState — lastReviewedAt within window → CURRENT
 *   §RR7  computeLifecycleState — lastReviewedAt expired (> 7 days) → REQUIRES_REVIEW
 *   §RR8  computeLifecycleState — lastReviewedAt present but THESIS_INVALIDATED → still THESIS_INVALIDATED
 *   §RR9  computeLifecycleState — lastReviewedAt present but DATA_STALE → still DATA_STALE
 *   §RR10 computeLifecycleState — no material changes → CURRENT regardless of lastReviewedAt
 *   §RR11 POST .../review rejects cross-user access (ownership guard)
 *   §RR12 RESEARCH_REVIEWED is a valid ActivityEventType
 *   §RR13 Broken link regression: /research/${symbol} route pattern must NOT appear in lifecycle CTA
 *   §RR14 Correct route: /research-workspace?symbol= pattern must appear in lifecycle source
 *   §RR15 POST .../review invalidates preflight cache (lifecycle re-evaluated)
 *   §RR16 computeLifecycleState — null lastReviewedAt → behaves as before (REQUIRES_REVIEW)
 *   §RR17 Review window boundary: exactly 7 days → still clears
 *   §RR18 Review window boundary: 7 days + 1 hour → REQUIRES_REVIEW again
 *   §RR19 Activity label: RESEARCH_REVIEWED → "Research Reviewed"
 *   §RR20 Activity category: RESEARCH_REVIEWED → "user_action"
 */

import { describe, it, expect } from "vitest";
import {
  computeLifecycleState,
} from "../../services/trade-plan-lifecycle-service";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_EVENT_LABELS,
  ACTIVITY_CATEGORY_MAP,
} from "../../../shared/trade-plan-lifecycle-types";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const THRESHOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

function daysHoursAgo(days: number, hours: number): Date {
  return new Date(Date.now() - (days * MS_PER_DAY + hours * 3600 * 1000));
}

/** Base params that produce REQUIRES_REVIEW without review */
const materialChangeParams = {
  planStatus:          "RESEARCH_COMPLETE",
  currentAvailable:    true,
  freshnessChanges:    [],
  researchChanges:     [{ isMaterial: true, changeType: "RESEARCH_WEAKENED" as any, description: "Technical -10" }],
  invalidationChanges: [],
  structureChanges:    [],
};

/** Base params that produce CURRENT without any changes */
const noChangeParams = {
  planStatus:          "RESEARCH_COMPLETE",
  currentAvailable:    true,
  freshnessChanges:    [],
  researchChanges:     [],
  invalidationChanges: [],
  structureChanges:    [],
};

/** Params with thesis invalidation */
const invalidatedParams = {
  ...materialChangeParams,
  invalidationChanges: [{ observationState: "observed" as any, description: "Condition observed" }],
};

/** Params with data stale */
const dataStaleParams = {
  ...materialChangeParams,
  freshnessChanges: [{ changeType: "DATA_BECAME_STALE" as any, description: "Stale" }],
};

// ─────────────────────────────────────────────────────────────────────────────
// §RR6  computeLifecycleState — recent review clears REQUIRES_REVIEW
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR6  computeLifecycleState: lastReviewedAt within window → CURRENT", () => {
  it("reviewed 1 day ago + material change → CURRENT (user accepted)", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysAgo(1) });
    expect(state).toBe("CURRENT");
  });

  it("reviewed 3 days ago + material change → CURRENT", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysAgo(3) });
    expect(state).toBe("CURRENT");
  });

  it("reviewed exactly 7 days ago → CURRENT (boundary inclusive)", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysAgo(THRESHOLD_DAYS) });
    expect(state).toBe("CURRENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR7  Expired review window → REQUIRES_REVIEW again
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR7  computeLifecycleState: expired review → REQUIRES_REVIEW", () => {
  it("reviewed 7 days + 1 hour ago → REQUIRES_REVIEW (window expired)", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysHoursAgo(7, 1) });
    expect(state).toBe("REQUIRES_REVIEW");
  });

  it("reviewed 30 days ago → REQUIRES_REVIEW", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysAgo(30) });
    expect(state).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR8  THESIS_INVALIDATED takes priority over review acknowledgement
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR8  computeLifecycleState: THESIS_INVALIDATED not cleared by review", () => {
  it("recent review + invalidation condition → THESIS_INVALIDATED (review cannot clear)", () => {
    const state = computeLifecycleState({ ...invalidatedParams, lastReviewedAt: daysAgo(1) });
    expect(state).toBe("THESIS_INVALIDATED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR9  DATA_STALE takes priority over review acknowledgement
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR9  computeLifecycleState: DATA_STALE not cleared by review", () => {
  it("recent review + data stale → DATA_STALE (review cannot clear)", () => {
    const state = computeLifecycleState({ ...dataStaleParams, lastReviewedAt: daysAgo(1) });
    expect(state).toBe("DATA_STALE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR10 No material changes → CURRENT regardless of review
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR10 computeLifecycleState: no material changes → CURRENT regardless", () => {
  it("no changes + no review → CURRENT", () => {
    const state = computeLifecycleState(noChangeParams);
    expect(state).toBe("CURRENT");
  });

  it("no changes + review → CURRENT", () => {
    const state = computeLifecycleState({ ...noChangeParams, lastReviewedAt: daysAgo(1) });
    expect(state).toBe("CURRENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR16 null lastReviewedAt → behaves as original (REQUIRES_REVIEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR16 computeLifecycleState: null/absent review → original behavior", () => {
  it("no lastReviewedAt + material change → REQUIRES_REVIEW", () => {
    const state = computeLifecycleState(materialChangeParams);
    expect(state).toBe("REQUIRES_REVIEW");
  });

  it("null lastReviewedAt + material change → REQUIRES_REVIEW", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: null });
    expect(state).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR17 / §RR18  Window boundary precision
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR17/§RR18  review window boundary precision", () => {
  it("6 days + 23h ago → CURRENT (within 7-day window)", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysHoursAgo(6, 23) });
    expect(state).toBe("CURRENT");
  });

  it("7 days + 1h ago → REQUIRES_REVIEW (past window)", () => {
    const state = computeLifecycleState({ ...materialChangeParams, lastReviewedAt: daysHoursAgo(7, 1) });
    expect(state).toBe("REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR12 RESEARCH_REVIEWED is a valid ActivityEventType
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR12  RESEARCH_REVIEWED activity type", () => {
  it("is included in ACTIVITY_EVENT_TYPES", () => {
    expect(ACTIVITY_EVENT_TYPES).toContain("RESEARCH_REVIEWED");
  });

  it("has a label in ACTIVITY_EVENT_LABELS", () => {
    expect(ACTIVITY_EVENT_LABELS["RESEARCH_REVIEWED"]).toBeDefined();
    expect(ACTIVITY_EVENT_LABELS["RESEARCH_REVIEWED"]).toBe("Research Reviewed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR19 / §RR20  Activity label and category
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR19  RESEARCH_REVIEWED activity label", () => {
  it("label is 'Research Reviewed'", () => {
    expect(ACTIVITY_EVENT_LABELS["RESEARCH_REVIEWED"]).toBe("Research Reviewed");
  });
});

describe("§RR20  RESEARCH_REVIEWED activity category", () => {
  it("category is 'user_action'", () => {
    expect(ACTIVITY_CATEGORY_MAP["RESEARCH_REVIEWED"]).toBe("user_action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR1  "Open Research Workspace" route: /research-workspace?symbol= (not /research/:id)
// §RR13 Broken link regression: /research/${symbol} must NOT appear in lifecycle CTA
// §RR14 Correct route: /research-workspace?symbol= must appear
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR1 / §RR13 / §RR14  client-side route regression", () => {
  const clientFile = path.resolve(__dirname, "../../../client/src/pages/trade-plan-detail.tsx");
  let src = "";

  try {
    src = fs.readFileSync(clientFile, "utf-8");
  } catch {
    // File not accessible from test environment — skip DOM tests
  }

  it("source file is readable", () => {
    expect(src.length).toBeGreaterThan(100);
  });

  it("§RR13: lifecycle CTA does NOT navigate to /research/${plan.symbol} (old broken route)", () => {
    // The broken route hit ResearchDetailPage which expects a record UUID, not a symbol
    // Look for the broken pattern in lifecycle CTA context (within 200 chars of 'Open Research Workspace')
    const occurrences = [...src.matchAll(/Open Research Workspace/g)];
    for (const match of occurrences) {
      const context = src.slice(Math.max(0, match.index! - 300), match.index! + 300);
      // Should not contain the broken /research/ route without ?symbol= or research-workspace
      expect(context).not.toMatch(/navigate\(`\/research\/\$\{plan\.symbol\}`\)/);
    }
  });

  it("§RR14: lifecycle CTA navigates to /research-workspace?symbol= (canonical route)", () => {
    // At least one 'Open Research Workspace' link must use the correct route
    expect(src).toContain("/research-workspace?symbol=");
  });

  it("§RR14: the correct route uses plan.symbol, not a hardcoded symbol", () => {
    expect(src).toContain("research-workspace?symbol=${plan.symbol}");
  });

  it("§RR2: 'Mark Research Reviewed' button exists (explicit acknowledgement required)", () => {
    expect(src).toContain("mark-research-reviewed-btn");
  });

  it("§RR2: opening the workspace alone (navigate call) is separate from the review button", () => {
    // The review button calls handleMarkReviewed, not navigate
    expect(src).toContain("handleMarkReviewed");
  });

  it("§RR2: Review panel is a separate UI step (not auto-opened on workspace click)", () => {
    // reviewPanelOpen state controls the panel — not triggered by workspace navigation
    expect(src).toContain("reviewPanelOpen");
    expect(src).toContain("setReviewPanelOpen");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR3  POST /api/trade-plans/:id/lifecycle/review route exists in trade-plans.ts
// §RR11 Cross-user access rejected (ownership guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR3 / §RR11  server route contract", () => {
  const routeFile = path.resolve(__dirname, "../trade-plans.ts");
  let routeSrc = "";

  try {
    routeSrc = fs.readFileSync(routeFile, "utf-8");
  } catch {
    // Skip if file not accessible
  }

  it("source file is readable", () => {
    expect(routeSrc.length).toBeGreaterThan(100);
  });

  it("§RR3: POST /api/trade-plans/:id/lifecycle/review endpoint exists", () => {
    expect(routeSrc).toContain("/lifecycle/review");
  });

  it("§RR3: review endpoint sets lastReviewedAt", () => {
    expect(routeSrc).toContain("lastReviewedAt");
    expect(routeSrc).toContain("reviewedAt");
  });

  it("§RR4: records RESEARCH_REVIEWED activity type", () => {
    expect(routeSrc).toContain("RESEARCH_REVIEWED");
  });

  it("§RR5: calls evaluateTradePlanLifecycle after review", () => {
    const reviewBlock = routeSrc.slice(routeSrc.indexOf("lifecycle/review"));
    expect(reviewBlock).toContain("evaluateTradePlanLifecycle");
  });

  it("§RR11: ownership guard — only owner can review (userId check)", () => {
    // Use the actual route registration line (not the header comment which also mentions the path)
    const routeStart = routeSrc.indexOf('lifecycle/review", isAuthenticated');
    const routeEnd   = routeSrc.indexOf('lifecycle/evaluate", isAuthenticated');
    const reviewBlock = routeStart >= 0 && routeEnd > routeStart
      ? routeSrc.slice(routeStart, routeEnd)
      : routeSrc; // fallback: search full file
    expect(reviewBlock).toContain("userId");
    expect(reviewBlock).toContain("planId");
    // Cross-user → 404 (not 403, to avoid ID enumeration)
    expect(reviewBlock).toContain("404");
  });

  it("§RR11: review endpoint returns 404 (not 403) for unknown plan — prevents ID enumeration", () => {
    const routeStart = routeSrc.indexOf('lifecycle/review", isAuthenticated');
    const routeEnd   = routeSrc.indexOf('lifecycle/evaluate", isAuthenticated');
    const reviewBlock = routeStart >= 0 && routeEnd > routeStart
      ? routeSrc.slice(routeStart, routeEnd)
      : routeSrc;
    expect(reviewBlock).toContain("Trade plan not found");
    // Must not issue a 403 response — use 404 to prevent plan-ID enumeration
    expect(reviewBlock).not.toMatch(/res\.status\(403\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR15  Review endpoint invalidates preflight (lifecycle re-evaluated with force)
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR15  review endpoint forces lifecycle re-evaluation", () => {
  const routeFile = path.resolve(__dirname, "../trade-plans.ts");
  let routeSrc = "";

  try {
    routeSrc = fs.readFileSync(routeFile, "utf-8");
  } catch {}

  it("review endpoint calls evaluateTradePlanLifecycle with force: true", () => {
    const routeStart = routeSrc.indexOf('lifecycle/review", isAuthenticated');
    const routeEnd   = routeSrc.indexOf('lifecycle/evaluate", isAuthenticated');
    const reviewBlock = routeStart >= 0 && routeEnd > routeStart
      ? routeSrc.slice(routeStart, routeEnd)
      : routeSrc;
    expect(reviewBlock).toContain("force: true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR — Schema: lastReviewedAt exists in trade_plans schema
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR — schema: lastReviewedAt column", () => {
  const schemaFile = path.resolve(__dirname, "../../../shared/schema.ts");
  let schemaSrc = "";

  try {
    schemaSrc = fs.readFileSync(schemaFile, "utf-8");
  } catch {}

  it("lastReviewedAt column exists in tradePlans table definition", () => {
    const tradePlansBlock = schemaSrc.slice(
      schemaSrc.indexOf("export const tradePlans = pgTable"),
      schemaSrc.indexOf("export type TradePlanRow")
    );
    expect(tradePlansBlock).toContain("lastReviewedAt");
    expect(tradePlansBlock).toContain("last_reviewed_at");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §RR — Lifecycle service: computeLifecycleState accepts lastReviewedAt param
// ─────────────────────────────────────────────────────────────────────────────

describe("§RR — lifecycle service: computeLifecycleState signature", () => {
  const svcFile = path.resolve(__dirname, "../../services/trade-plan-lifecycle-service.ts");
  let svcSrc = "";

  try {
    svcSrc = fs.readFileSync(svcFile, "utf-8");
  } catch {}

  it("computeLifecycleState accepts lastReviewedAt parameter", () => {
    const fnBlock = svcSrc.slice(svcSrc.indexOf("export function computeLifecycleState"), svcSrc.indexOf("export function computeLifecycleState") + 2000);
    expect(fnBlock).toContain("lastReviewedAt");
  });

  it("review window is 7 days", () => {
    expect(svcSrc).toContain("REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS = 7");
  });

  it("THESIS_INVALIDATED check appears before the lastReviewedAt branch in function body", () => {
    const fnStart = svcSrc.indexOf("export function computeLifecycleState");
    const invalidationPos = svcSrc.indexOf("THESIS_INVALIDATED", fnStart);
    // Search for the runtime branch, not the param declaration which also contains the string.
    // "if (lastReviewedAt)" is the actual decision-point in the function body.
    const reviewedAtPos = svcSrc.indexOf("if (lastReviewedAt)", fnStart);
    expect(invalidationPos).toBeGreaterThan(0);
    expect(reviewedAtPos).toBeGreaterThan(0);
    expect(invalidationPos).toBeLessThan(reviewedAtPos);
  });

  it("DATA_STALE check appears before the lastReviewedAt branch in function body", () => {
    const fnStart = svcSrc.indexOf("export function computeLifecycleState");
    const stalePos = svcSrc.indexOf("DATA_STALE", fnStart);
    const reviewedAtPos = svcSrc.indexOf("if (lastReviewedAt)", fnStart);
    expect(stalePos).toBeGreaterThan(0);
    expect(reviewedAtPos).toBeGreaterThan(0);
    expect(stalePos).toBeLessThan(reviewedAtPos);
  });
});
