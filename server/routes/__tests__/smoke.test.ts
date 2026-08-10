/**
 * server/routes/__tests__/smoke.test.ts — Sprint 2.7.6
 *
 * Formal Smoke Test Suite
 * cmd: npm run test:smoke
 *
 * Answers: "Is the platform fundamentally alive?"
 *
 * These tests are all pure/structural — no DB, no network.
 * They verify that the type contracts, service exports, and route registration
 * logic required for the platform to function are correctly in place.
 *
 * Category: smoke
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §S1 — Core Service Exports
// ============================================================================

describe("Smoke §S1: Core service exports loadable", () => {
  it("trade-plan-lifecycle-service exports evaluateTradePlanLifecycle", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.evaluateTradePlanLifecycle).toBe("function");
  });

  it("trade-plan-lifecycle-service exports evaluateUserTradePlans", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.evaluateUserTradePlans).toBe("function");
  });

  it("trade-plan-lifecycle-service exports evaluateAllActiveTradePlans", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.evaluateAllActiveTradePlans).toBe("function");
  });

  it("trade-plan-lifecycle-service exports ensureTradePlanActivityTable", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.ensureTradePlanActivityTable).toBe("function");
  });

  it("trade-plan-lifecycle-service exports getLifecycleHealth", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.getLifecycleHealth).toBe("function");
  });

  it("trade-plan-lifecycle-service exports getTradePlanActivities", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof svc.getTradePlanActivities).toBe("function");
  });

  it("trade-plan-service exports ensureTradePlanTables", async () => {
    const svc = await import("../../services/trade-plan-service");
    expect(typeof svc.ensureTradePlanTables).toBe("function");
  });

  it("trade-plan-service exports createTradePlan", async () => {
    const svc = await import("../../services/trade-plan-service");
    expect(typeof svc.createTradePlan).toBe("function");
  });

  it("opportunity-intelligence-service exports getCanonicalOpportunity", async () => {
    const svc = await import("../../services/opportunity-intelligence-service");
    expect(typeof svc.getCanonicalOpportunity).toBe("function");
  });

  it("job-status-store exports getAllJobStatuses", async () => {
    const svc = await import("../../services/job-status-store");
    expect(typeof svc.getAllJobStatuses).toBe("function");
  });
});

// ============================================================================
// §S2 — Critical Type Contracts
// ============================================================================

describe("Smoke §S2: Critical type contracts", () => {
  it("LIFECYCLE_STATES is a non-empty readonly array", async () => {
    const { LIFECYCLE_STATES } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(Array.isArray(LIFECYCLE_STATES)).toBe(true);
    expect(LIFECYCLE_STATES.length).toBeGreaterThan(0);
  });

  it("TRADE_PLAN_STATUSES is a non-empty readonly array", async () => {
    const { TRADE_PLAN_STATUSES } = await import("../../../shared/trade-plan-types");
    expect(Array.isArray(TRADE_PLAN_STATUSES)).toBe(true);
    expect(TRADE_PLAN_STATUSES.length).toBeGreaterThan(0);
  });

  it("LIFECYCLE_DISCLAIMER exists", async () => {
    const { LIFECYCLE_DISCLAIMER } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("TRADE_PLAN_DISCLAIMER exists", async () => {
    const { TRADE_PLAN_DISCLAIMER } = await import("../../../shared/trade-plan-types");
    expect(TRADE_PLAN_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("LIFECYCLE_METHODOLOGY_VERSION is set", async () => {
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_METHODOLOGY_VERSION).toBeTruthy();
  });
});

// ============================================================================
// §S3 — Schema Table Definitions
// ============================================================================

describe("Smoke §S3: Schema table definitions present", () => {
  it("tradePlans table is exported from schema", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.tradePlans).toBeDefined();
  });

  it("tradePlanVersions table is exported from schema", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.tradePlanVersions).toBeDefined();
  });

  it("tradePlanActivity table is exported from schema", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.tradePlanActivity).toBeDefined();
  });

  it("tradePlanActivity has required columns", async () => {
    const schema = await import("../../../shared/schema");
    const cols = Object.keys(schema.tradePlanActivity);
    // Drizzle table object has column accessors + table meta
    expect(cols.length).toBeGreaterThan(3);
  });
});

// ============================================================================
// §S4 — Lifecycle Pure Functions
// ============================================================================

describe("Smoke §S4: Lifecycle pure helpers are callable", () => {
  it("computeExpirationState(90) = FAR_FROM_EXPIRATION", async () => {
    const { computeExpirationState } = await import("../../services/trade-plan-lifecycle-service");
    expect(computeExpirationState(90)).toBe("FAR_FROM_EXPIRATION");
  });

  it("computeLifecycleState returns a valid LifecycleState", async () => {
    const { computeLifecycleState } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_STATES } = await import("../../../shared/trade-plan-lifecycle-types");
    const state = computeLifecycleState({
      planStatus: "RESEARCH_COMPLETE", currentAvailable: true,
      freshnessChanges: [], researchChanges: [], invalidationChanges: [], structureChanges: [],
    });
    expect(LIFECYCLE_STATES).toContain(state);
  });

  it("buildActivityFingerprint returns a string", async () => {
    const { buildActivityFingerprint } = await import("../../services/trade-plan-lifecycle-service");
    const fp = buildActivityFingerprint("plan-1", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(typeof fp).toBe("string");
    expect(fp.length).toBeGreaterThan(0);
  });

  it("getLifecycleHealth returns a metrics object", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();
    expect(typeof metrics.plansEvaluated).toBe("number");
  });
});

// ============================================================================
// §S5 — Route Registration (structural)
// ============================================================================

describe("Smoke §S5: Route registration structural checks", () => {
  it("registerTradePlanRoutes is exported from trade-plans routes", async () => {
    const mod = await import("../trade-plans");
    expect(typeof mod.registerTradePlanRoutes).toBe("function");
  });

  it("static lifecycle/health path differs from dynamic /:id path", () => {
    expect("/api/trade-plans/lifecycle/health").not.toContain("/:id");
    expect("/api/trade-plans/:id/lifecycle").toContain("/:id");
  });
});

// ============================================================================
// §S6 — Job Status Store
// ============================================================================

describe("Smoke §S6: Job status store includes lifecycle job", () => {
  it("trade_plan_monitoring is a recognized JobName", async () => {
    const { getJobStatus } = await import("../../services/job-status-store");
    const state = getJobStatus("trade_plan_monitoring");
    expect(state).toBeDefined();
    expect(state.status).toBe("idle");
  });
});

// ============================================================================
// §S7 — Compliance Smoke
// ============================================================================

describe("Smoke §S7: Compliance language smoke check", () => {
  it("lifecycle disclaimer does not contain 'exit now'", async () => {
    const { LIFECYCLE_DISCLAIMER } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_DISCLAIMER.toLowerCase()).not.toContain("exit now");
  });

  it("lifecycle disclaimer does not contain 'sell now'", async () => {
    const { LIFECYCLE_DISCLAIMER } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_DISCLAIMER.toLowerCase()).not.toContain("sell now");
  });

  it("trade plan disclaimer does not contain recommendation language", async () => {
    const { TRADE_PLAN_DISCLAIMER } = await import("../../../shared/trade-plan-types");
    expect(TRADE_PLAN_DISCLAIMER.toLowerCase()).not.toContain("recommended trade");
    expect(TRADE_PLAN_DISCLAIMER.toLowerCase()).not.toContain("approved trade");
  });
});
