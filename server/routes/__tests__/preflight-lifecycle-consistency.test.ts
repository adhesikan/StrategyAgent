/**
 * server/routes/__tests__/preflight-lifecycle-consistency.test.ts
 *
 * Regression coverage for the preflight–lifecycle consistency defect.
 *
 * DEFECT (root cause):
 *   getLifecycleResult() in createDbPreflightDeps() read from tradePlanActivity
 *   (event log) with an ascending sort order — returning the oldest activity row,
 *   not the current evaluated state. This meant lastReviewedAt (set by the user's
 *   explicit "Mark Research Reviewed" action) was invisible to preflight.
 *   Result: after a successful review the lifecycle UI showed "Research Current"
 *   but preflight still returned PLAN_REQUIRES_REVIEW.
 *
 * FIX:
 *   getLifecycleResult() now calls evaluateTradePlanLifecycle() — the same
 *   authoritative function used by the lifecycle UI endpoint. This gives preflight
 *   and the lifecycle panel a single shared computation path.
 *
 * Test scenarios (from the bug report):
 *   §PLC1  Material change → lifecycle REQUIRES_REVIEW → preflight blocks
 *   §PLC2  User acknowledges latest material change → lifecycle CURRENT → preflight PASS
 *   §PLC3  Acknowledgement does NOT bypass real lifecycle validation
 *   §PLC4  Review window expiry → REQUIRES_REVIEW again
 *   §PLC5  Happy path: no changes → preflight lifecycle PASS
 *   §PLC6  THESIS_INVALIDATED → FAIL (review cannot clear)
 *   §PLC7  DATA_STALE → FAIL (review cannot clear)
 *   §PLC8  UNKNOWN → FAIL (system error path)
 *   §PLC9  Null lifecycle result → lifecycle UNAVAILABLE (not crash)
 *   §PLC10 Source: getLifecycleResult uses evaluateTradePlanLifecycle
 *   §PLC11 Source: code does NOT query tradePlanActivity for lifecycle state
 *   §PLC12 Source: legacy ascending-sort bug is removed
 *   §PLC13 Review route records RESEARCH_REVIEWED and re-evaluates lifecycle
 *   §PLC14 Preflight lifecycle PASS → no PLAN_REQUIRES_REVIEW blocker
 *   §PLC15 Preflight lifecycle REQUIRES_REVIEW → PLAN_REQUIRES_REVIEW blocker
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runExecutionPreflight,
  type PreflightDependencies,
  type StoredTradePlan,
  type StoredLifecycleResult,
} from "../../services/execution-preflight-service";
import {
  MockBrokerExecutionAdapter,
} from "../../services/broker-execution-adapter";
import {
  computeLifecycleState,
} from "../../services/trade-plan-lifecycle-service";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Kill-switch env — tests require execution enabled
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
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-14T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function makePlan(overrides: Partial<StoredTradePlan> = {}): StoredTradePlan {
  return {
    id: "plan-nvda-001",
    userId: "user-001",
    symbol: "NVDA",
    planType: "EQUITY",
    status: "RESEARCH_COMPLETE",
    version: 1,
    updatedAt: daysAgo(2),
    riskSnapshot: {
      maxRiskDollars: 500,
      positionSizeShares: 10,
      entryPrice: 140,
      stopLossPrice: 130,
      targetPrice: 160,
    },
    structureSnapshot: {
      selectedExpressionFamily: "equity",
      entryTriggerType: "BREAKOUT",
    },
    limitations: [],
    ...overrides,
  };
}

function makeLifecycle(
  overrides: Partial<StoredLifecycleResult> = {}
): StoredLifecycleResult {
  return {
    planId: "plan-nvda-001",
    lifecycleState: "CURRENT",
    evaluatedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    ...overrides,
  };
}

function makeDeps(
  plan: StoredTradePlan | null,
  lifecycle: StoredLifecycleResult | null,
  adapterOpts: ConstructorParameters<typeof MockBrokerExecutionAdapter>[0] = {}
): PreflightDependencies {
  const broker = new MockBrokerExecutionAdapter(adapterOpts);
  return {
    brokerAdapter: broker,
    getTradePlan: async (planId, userId) => {
      if (!plan || plan.userId !== userId || plan.id !== planId) return null;
      return plan;
    },
    getLifecycleResult: async () => lifecycle,
    savePreflight: async () => {},
    saveAuditEvent: async () => {},
    now: () => NOW,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §PLC1  Material change → REQUIRES_REVIEW → preflight blocks
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC1  Material change → REQUIRES_REVIEW → preflight blocks", () => {
  it("lifecycle REQUIRES_REVIEW → lifecycleValidation REQUIRES_REVIEW", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("REQUIRES_REVIEW");
  });

  it("lifecycle REQUIRES_REVIEW → PLAN_REQUIRES_REVIEW blocker present", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });

  it("lifecycle REQUIRES_REVIEW → overall status is not PASS", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.overallStatus).not.toBe("PASS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC2  After review acknowledgement → lifecycle CURRENT → preflight PASS on lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC2  After review acknowledgement → lifecycle CURRENT → preflight PASS", () => {
  it("lifecycle CURRENT → lifecycleValidation PASS", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
  });

  it("lifecycle CURRENT → no PLAN_REQUIRES_REVIEW blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });

  it("computeLifecycleState: material change + review within 7 days → CURRENT", () => {
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -8" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(1),
    });
    expect(state).toBe("CURRENT");
  });

  it("computeLifecycleState: material change + within window → preflight sees CURRENT → no blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC3  Acknowledgement does NOT bypass real lifecycle validation
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC3  Acknowledgement does NOT bypass real lifecycle validation", () => {
  it("THESIS_INVALIDATED: review cannot clear (computeLifecycleState)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [],
      invalidationChanges: [{ observationState: "observed", description: "Price below stop" }],
      structureChanges: [],
      lastReviewedAt: daysAgo(0.5),
    })).toBe("THESIS_INVALIDATED");
  });

  it("DATA_STALE: review cannot clear (computeLifecycleState)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale" }],
      researchChanges: [],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(0.5),
    })).toBe("DATA_STALE");
  });

  it("QUALIFICATION_LOST: review cannot clear (computeLifecycleState)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: false,
      freshnessChanges: [],
      researchChanges: [],
      invalidationChanges: [],
      structureChanges: [],
      symbolNotQualified: true,
      lastReviewedAt: daysAgo(0.5),
    })).toBe("REQUIRES_REVIEW");
  });

  it("THESIS_INVALIDATED → preflight lifecycleValidation FAIL + blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "THESIS_INVALIDATED" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("THESIS_INVALIDATED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC4  Review window expiry → REQUIRES_REVIEW again
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC4  Review window expiry → REQUIRES_REVIEW again", () => {
  it("no lastReviewedAt + material change → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -12" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: null,
    })).toBe("REQUIRES_REVIEW");
  });

  it("review 8 days ago (outside 7-day window) + material change → REQUIRES_REVIEW", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -10" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(8),
    })).toBe("REQUIRES_REVIEW");
  });

  it("expired review → preflight returns PLAN_REQUIRES_REVIEW blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC5  Happy path: no material changes → preflight lifecycle PASS
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC5  Happy path: CURRENT / CHANGED → preflight lifecycle PASS", () => {
  it("CURRENT lifecycle → lifecycleValidation PASS", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
  });

  it("CHANGED lifecycle (minor, not material) → lifecycleValidation PASS", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CHANGED" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC6 / §PLC7 / §PLC8  Non-clearable states
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC6  THESIS_INVALIDATED → FAIL (review cannot clear)", () => {
  it("preflight lifecycleValidation FAIL + THESIS_INVALIDATED blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "THESIS_INVALIDATED" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("THESIS_INVALIDATED");
  });
});

describe("§PLC7  DATA_STALE → FAIL (review cannot clear)", () => {
  it("preflight lifecycleValidation FAIL + TRADE_PLAN_STALE blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "DATA_STALE" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("TRADE_PLAN_STALE");
  });
});

describe("§PLC8  UNKNOWN → FAIL (system error)", () => {
  it("preflight lifecycleValidation FAIL + UNKNOWN_CRITICAL_STATE blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "UNKNOWN" }), { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("UNKNOWN_CRITICAL_STATE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC9  Null lifecycle result → UNAVAILABLE (not crash)
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC9  Null lifecycle result → lifecycle UNAVAILABLE (not crash)", () => {
  it("null lifecycle → lifecycleValidation UNAVAILABLE", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), null, { connected: true })
    );
    expect(result.lifecycleValidation.status).toBe("UNAVAILABLE");
  });

  it("null lifecycle → no PLAN_REQUIRES_REVIEW blocker", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), null, { connected: true })
    );
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC10 / §PLC11 / §PLC12  Source inspection: fix is in place
// ─────────────────────────────────────────────────────────────────────────────

const preflightSrc = (() => {
  const f = path.resolve(__dirname, "../../services/execution-preflight-service.ts");
  try { return fs.readFileSync(f, "utf-8"); } catch { return ""; }
})();

// Isolate the getLifecycleResult implementation block in createDbPreflightDeps
const getLifecycleResultBlock = (() => {
  const start = preflightSrc.indexOf("async getLifecycleResult(");
  const end   = preflightSrc.indexOf("async savePreflight(");
  return (start >= 0 && end > start) ? preflightSrc.slice(start, end) : "";
})();

describe("§PLC10  Source: getLifecycleResult uses evaluateTradePlanLifecycle", () => {
  it("block calls evaluateTradePlanLifecycle", () => {
    expect(getLifecycleResultBlock).toContain("evaluateTradePlanLifecycle");
  });

  it("block imports from trade-plan-lifecycle-service", () => {
    expect(getLifecycleResultBlock).toContain("trade-plan-lifecycle-service");
  });

  it("block maps result.lifecycleState", () => {
    expect(getLifecycleResultBlock).toContain("result.lifecycleState");
  });

  it("block maps result.evaluatedAt", () => {
    expect(getLifecycleResultBlock).toContain("result.evaluatedAt");
  });
});

describe("§PLC11  Source: getLifecycleResult code does NOT query tradePlanActivity", () => {
  it("block has no .select() call (removed raw DB query)", () => {
    // Filter out comment lines — only check code lines
    const codeLines = getLifecycleResultBlock.split("\n")
      .filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    const hasSelectCall = codeLines.some(l => l.includes(".select()"));
    expect(hasSelectCall).toBe(false);
  });

  it("block does not use tradePlanActivity.tradePlanId (old WHERE clause)", () => {
    expect(getLifecycleResultBlock).not.toContain("tradePlanActivity.tradePlanId");
  });

  it("block does not import { tradePlanActivity } schema for DB query", () => {
    // Filter out comment lines
    const codeLines = getLifecycleResultBlock.split("\n")
      .filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    const hasImport = codeLines.some(l => l.includes("{ tradePlanActivity }"));
    expect(hasImport).toBe(false);
  });
});

describe("§PLC12  Source: legacy ascending-sort bug removed", () => {
  it("getLifecycleResult block does not use .orderBy(tradePlanActivity.observedAt)", () => {
    expect(getLifecycleResultBlock).not.toContain(".orderBy(tradePlanActivity.observedAt)");
  });

  it("getLifecycleResult block does not use tradePlanActivity.tradePlanId in WHERE", () => {
    expect(getLifecycleResultBlock).not.toContain("tradePlanActivity.tradePlanId");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC13  Review route: persists review and re-evaluates lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const reviewRouteSrc = (() => {
  const f = path.resolve(__dirname, "../../routes/trade-plans.ts");
  try { return fs.readFileSync(f, "utf-8"); } catch { return ""; }
})();

// Anchor on the Express registration line for the review route
const reviewRouteBlock = (() => {
  const anchor = 'app.post("/api/trade-plans/:id/lifecycle/review"';
  const endAnchor = 'app.post("/api/trade-plans/:id/lifecycle/evaluate"';
  const start = reviewRouteSrc.indexOf(anchor);
  const end   = reviewRouteSrc.indexOf(endAnchor);
  return (start >= 0 && end > start) ? reviewRouteSrc.slice(start, end) : "";
})();

describe("§PLC13  Review route records RESEARCH_REVIEWED and re-evaluates lifecycle", () => {
  it("review route block is non-empty (route is found in source)", () => {
    expect(reviewRouteBlock.length).toBeGreaterThan(100);
  });

  it("review route sets lastReviewedAt on the trade_plans row", () => {
    expect(reviewRouteBlock).toContain("lastReviewedAt");
  });

  it("review route persists RESEARCH_REVIEWED activity", () => {
    expect(reviewRouteBlock).toContain("RESEARCH_REVIEWED");
  });

  it("review route calls evaluateTradePlanLifecycle with force: true after setting lastReviewedAt", () => {
    expect(reviewRouteBlock).toContain("evaluateTradePlanLifecycle");
    expect(reviewRouteBlock).toContain("force: true");
  });

  it("review route responds with the updated lifecycleResult", () => {
    expect(reviewRouteBlock).toContain("lifecycleResult");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §PLC14 / §PLC15  Blocker contract
// ─────────────────────────────────────────────────────────────────────────────

describe("§PLC14  lifecycle PASS → no PLAN_REQUIRES_REVIEW blocker", () => {
  it("CURRENT → blockers does not include PLAN_REQUIRES_REVIEW", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.blockers.map(b => b.code)).not.toContain("PLAN_REQUIRES_REVIEW");
  });

  it("CURRENT → lifecycleValidation label is 'Research Lifecycle'", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "CURRENT" }), { connected: true })
    );
    expect(result.lifecycleValidation.label).toBe("Research Lifecycle");
  });
});

describe("§PLC15  lifecycle REQUIRES_REVIEW → PLAN_REQUIRES_REVIEW blocker", () => {
  it("REQUIRES_REVIEW → blockers include PLAN_REQUIRES_REVIEW", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });

  it("REQUIRES_REVIEW → blocker message mentions 'review'", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    const blocker = result.blockers.find(b => b.code === "PLAN_REQUIRES_REVIEW");
    expect(blocker?.message.toLowerCase()).toContain("review");
  });

  it("REQUIRES_REVIEW → lifecycleValidation.note mentions 'review'", async () => {
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-nvda-001", userId: "user-001" },
      makeDeps(makePlan(), makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }), { connected: true })
    );
    expect(result.lifecycleValidation.note?.toLowerCase()).toContain("review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Page refresh: review acknowledgement persists (lastReviewedAt in DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("Page refresh — review persists via trade_plans.last_reviewed_at", () => {
  it("reviewedStateChanges empty → review covers current state → CURRENT (state-anchored check)", () => {
    // Primary semantic: review is valid when computeResearchChanges(reviewedBaseline, current)
    // produces no material changes — regardless of when the last scan ran.
    // reviewedStateChanges: [] means scores are identical since the review was acknowledged.
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -5" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(6),
      reviewedStateChanges: [],  // empty = no material change since the review baseline
    })).toBe("CURRENT");
  });

  it("lastReviewedAt 7.5 days ago → REQUIRES_REVIEW (window expired)", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -5" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(7.5),
    })).toBe("REQUIRES_REVIEW");
  });

  it("lastReviewedAt fresh (< 1 day) + material change → CURRENT", () => {
    expect(computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [{ isMaterial: true, changeType: "RESEARCH_WEAKENED", description: "Technical -5" }],
      invalidationChanges: [],
      structureChanges: [],
      lastReviewedAt: daysAgo(0.01),
    })).toBe("CURRENT");
  });
});
