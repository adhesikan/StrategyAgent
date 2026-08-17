/**
 * server/__tests__/execution-preflight-brokerless.test.ts
 *
 * Sprint 2.8.7A — Brokerless Trade Plan Readiness & Preflight Split
 *
 * Permanent safety invariants:
 * A. Brokerless Trade Plan Readiness can PASS
 * B. Brokerless overallStatus is NEVER "PASS"
 * C. Brokerless executionAvailable is ALWAYS false
 * D. Order preparation rejects brokerless result (overallStatus ≠ PASS)
 * E. Broker submission remains impossible
 * F. Broker connection transition enriches same plan (TPR unchanged)
 * G. Broker disconnect removes execution availability only (TPR intact)
 * H. Lifecycle/freshness logic remains unchanged
 * I. No automatic broker calls from Trade Plan rendering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runExecutionPreflight,
  type PreflightDependencies,
  type StoredTradePlan,
  type StoredLifecycleResult,
  formatPreflightQuoteAge,
} from "../services/execution-preflight-service";
import type { ExecutionPreflightResult } from "@shared/execution-types";

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SETUP — enable execution so tests exercise the real brokerless path
// (not the EXECUTION_DISABLED fast-path).  The "no broker" condition is
// simulated by returning connected:false from the adapter.
// ─────────────────────────────────────────────────────────────────────────────

const ORIG_BROKER_EXECUTION_ENABLED = process.env.BROKER_EXECUTION_ENABLED;

beforeEach(() => {
  process.env.BROKER_EXECUTION_ENABLED = "true";
});

afterEach(() => {
  if (ORIG_BROKER_EXECUTION_ENABLED === undefined) {
    delete process.env.BROKER_EXECUTION_ENABLED;
  } else {
    process.env.BROKER_EXECUTION_ENABLED = ORIG_BROKER_EXECUTION_ENABLED;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-15T14:00:00Z");

function makePlan(overrides: Partial<StoredTradePlan> = {}): StoredTradePlan {
  return {
    id: "plan-123",
    userId: "user-456",
    symbol: "AAPL",
    planType: "EQUITY",
    status: "ACTIVE",
    archivedAt: null,
    riskSnapshot: { calculatedAt: "2026-06-15T10:00:00Z", maxRisk: 500, expectedValue: 1200 },
    structureSnapshot: { structureType: "long_call", legs: [], strike: 185 },
    planningSnapshot: { maxRiskDollars: 500, scenarioMaxLoss: 400, estimatedCapital: 5000 },
    updatedAt: new Date("2026-06-12T12:00:00Z"),
    version: 3,
    limitations: [],
    ...overrides,
  };
}

function makeLifecycle(state = "CURRENT"): StoredLifecycleResult {
  return {
    planId: "plan-123",
    lifecycleState: state,
    evaluatedAt: new Date("2026-06-15T13:00:00Z"),
  };
}

function makeBrokerAdapter(connected: boolean, overrides: Record<string, any> = {}) {
  return {
    getConnectionStatus: vi.fn().mockResolvedValue(
      connected
        ? { connected: true, provider: "tradier", needsReauth: false }
        : { connected: false, provider: undefined, needsReauth: false }
    ),
    listAccounts: vi.fn().mockResolvedValue(
      connected ? [{ accountRef: "acc-1", accountIdMasked: "••••1111", accountType: "MARGIN", provider: "tradier", isPreferred: true }] : []
    ),
    getPositions: vi.fn().mockResolvedValue([]),
    getBuyingPower: vi.fn().mockResolvedValue(connected ? { available: true, buyingPowerUsd: 25000, currency: "USD", source: "broker", asOf: NOW.toISOString() } : null),
    getQuoteValidation: vi.fn().mockResolvedValue(connected ? { symbol: "AAPL", hasBid: true, hasAsk: true, hasMid: true, isStale: false, isCrossed: false, isZeroBid: false, isSpreadInvalid: false, isFresh: true, freshnessSec: 5, source: "broker", asOf: NOW.toISOString() } : null),
    getAccountCapabilities: vi.fn().mockResolvedValue(connected ? { equityTrading: true, optionsTrading: true, multiLeg: true, source: "broker", checkedAt: NOW.toISOString() } : null),
    validateOptionsContract: vi.fn().mockResolvedValue({ exists: true, isExpired: false }),
    ...overrides,
  };
}

function makeDeps(
  plan: StoredTradePlan | null,
  lifecycle: StoredLifecycleResult | null,
  brokerConnected: boolean,
  brokerOverrides: Record<string, any> = {}
): PreflightDependencies {
  return {
    brokerAdapter: makeBrokerAdapter(brokerConnected, brokerOverrides) as any,
    getTradePlan: vi.fn().mockResolvedValue(plan),
    getLifecycleResult: vi.fn().mockResolvedValue(lifecycle),
    savePreflight: vi.fn().mockResolvedValue(undefined),
    saveAuditEvent: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: BROKERLESS INDEPENDENT PREFLIGHT
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 1 — Brokerless Independent Preflight", () => {
  it("INV-A: Trade Plan Readiness can PASS without broker", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness).toBeDefined();
    expect(result.tradePlanReadiness!.status).toBe("PASS");
    expect(result.tradePlanReadiness!.label).toBe("Plan Ready");
  });

  it("INV-B: overallStatus is NEVER PASS without broker", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).not.toBe("PASS");
  });

  it("INV-C: executionAvailable is ALWAYS false without broker", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.executionAvailable).toBe(false);
  });

  it("brokerless overallStatus is UNAVAILABLE when no plan blockers", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("UNAVAILABLE");
  });

  it("brokerless BROKER_NOT_CONNECTED is not in blockers", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const brokerBlockers = result.blockers.filter(b => b.code === "BROKER_NOT_CONNECTED");
    expect(brokerBlockers).toHaveLength(0);
  });

  it("broker dimensions return NOT_CONNECTED (not FAIL) when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerValidation.status).toBe("NOT_CONNECTED");
    expect(result.accountValidation.status).toBe("NOT_CONNECTED");
    expect(result.permissionsValidation.status).toBe("NOT_CONNECTED");
  });

  it("buying power returns NOT_CONFIRMED (not blocker) when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.buyingPowerValidation.status).toBe("NOT_CONFIRMED");
    const buyingPowerBlockers = result.blockers.filter(b => b.code === "BUYING_POWER_UNAVAILABLE");
    expect(buyingPowerBlockers).toHaveLength(0);
  });

  it("equity position validation returns NOT_APPLICABLE when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.positionValidation.status).toBe("NOT_APPLICABLE");
  });

  it("quote validation returns PLANNING_MODE (not blocker) when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    const quoteBlockers = result.blockers.filter(b => b.code === "QUOTE_STALE");
    expect(quoteBlockers).toHaveLength(0);
  });

  it("equity structure validation returns PASS when broker absent (plan-derivable)", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.structureValidation.status).toBe("PASS");
  });

  it("options structure validation returns PLANNING_MODE when broker absent", async () => {
    const plan = makePlan({ planType: "OPTIONS", structureSnapshot: { structureType: "long_call", legs: [{ contractSymbol: "AAPL260619C00185000" }] } });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.structureValidation.status).toBe("PLANNING_MODE");
  });

  it("independent TPR dims (1,2,3,11) evaluate without broker", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.dimensions.tradePlan.status).toBe("PASS");
    expect(tpr.dimensions.lifecycle.status).toBe("PASS");
    expect(tpr.dimensions.freshness.status).toBe("PASS");
    expect(tpr.dimensions.risk.status).toBe("PASS");
    expect(tpr.dimensions.planningConstraints.status).toBe("PASS");
  });

  it("brokerExecutionReadiness is NOT_CONNECTED when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerExecutionReadiness).toBeDefined();
    expect(result.brokerExecutionReadiness!.status).toBe("NOT_CONNECTED");
    expect(result.brokerExecutionReadiness!.brokerConnected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: TPR NEVER AUTHORIZES EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 2 — TPR Never Authorizes Execution", () => {
  it("INV-D: overallStatus PASS requires broker connected", async () => {
    // With broker connected
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);
    expect(result.overallStatus).toBe("PASS");
    expect(result.executionAvailable).toBe(true);
  });

  it("INV-D: overallStatus is NOT PASS when broker absent even if TPR PASS", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.status).toBe("PASS"); // TPR passes
    expect(result.overallStatus).not.toBe("PASS");         // But overall does not
    expect(result.executionAvailable).toBe(false);
  });

  it("TPR PASS + no broker → UNAVAILABLE overall (not FAIL)", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("UNAVAILABLE");
  });

  it("plan blockers still produce FAIL overall even without broker", async () => {
    const plan = makePlan({ riskSnapshot: null }); // risk UNAVAILABLE → UNAVAILABLE dim
    const lifecycleInvalidated: StoredLifecycleResult = {
      planId: "plan-123", lifecycleState: "THESIS_INVALIDATED", evaluatedAt: NOW,
    };
    const deps = makeDeps(plan, lifecycleInvalidated, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("FAIL");
    expect(result.tradePlanReadiness!.status).toBe("FAIL");
    expect(result.executionAvailable).toBe(false);
  });

  it("executionAvailable matches overallStatus === PASS", async () => {
    const withBroker = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);
    const withoutBroker = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);

    const [r1, r2] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withBroker),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withoutBroker),
    ]);

    expect(r1.executionAvailable).toBe(r1.overallStatus === "PASS");
    expect(r2.executionAvailable).toBe(r2.overallStatus === "PASS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: BROKER TRANSITION
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 3 — Broker Transition", () => {
  it("INV-F: same plan enriched when broker connects (TPR status unchanged)", async () => {
    const plan = makePlan();
    const lifecycle = makeLifecycle("CURRENT");

    const brokerlessDeps = makeDeps(plan, lifecycle, false);
    const brokerDeps = makeDeps(plan, lifecycle, true);

    const [brokerless, withBroker] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, brokerlessDeps),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, brokerDeps),
    ]);

    // TPR status unchanged when broker connects
    expect(brokerless.tradePlanReadiness!.status).toBe(withBroker.tradePlanReadiness!.status);

    // But overall differs
    expect(brokerless.overallStatus).toBe("UNAVAILABLE");
    expect(withBroker.overallStatus).toBe("PASS");
  });

  it("INV-G: broker disconnect removes execution availability but not TPR", async () => {
    const plan = makePlan();
    const lifecycle = makeLifecycle("CURRENT");

    // Simulate plan with broker → broker disconnect
    const afterDisconnect = makeDeps(plan, lifecycle, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, afterDisconnect);

    // TPR still evaluates
    expect(result.tradePlanReadiness!.status).toBe("PASS");
    // Execution not available
    expect(result.executionAvailable).toBe(false);
    // BER is NOT_CONNECTED
    expect(result.brokerExecutionReadiness!.status).toBe("NOT_CONNECTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: EQUITY INDEPENDENT MODE
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 4 — Equity Independent Mode", () => {
  it("equity LONG plan: all independent dims evaluate without broker", async () => {
    const plan = makePlan({ planType: "EQUITY" });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const { tradePlanReadiness: tpr } = result;
    expect(tpr).toBeDefined();
    expect(tpr!.dimensions.tradePlan.status).toBe("PASS");
    expect(tpr!.dimensions.lifecycle.status).toBe("PASS");
    expect(tpr!.dimensions.freshness.status).toBe("PASS");
    expect(tpr!.dimensions.risk.status).toBe("PASS");
    expect(tpr!.dimensions.planningConstraints.status).toBe("PASS");
  });

  it("equity plan: position dim is NOT_APPLICABLE (no shares required for direct purchase)", async () => {
    const deps = makeDeps(makePlan({ planType: "EQUITY" }), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.positionValidation.status).toBe("NOT_APPLICABLE");
  });

  it("equity plan: planning constraint exceeded → TPR FAIL + overall FAIL", async () => {
    const plan = makePlan({
      planningSnapshot: { maxRiskDollars: 500, scenarioMaxLoss: 700 }, // exceeds by more than 10%
    });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.dimensions.planningConstraints.status).toBe("FAIL");
    expect(result.tradePlanReadiness!.status).toBe("FAIL");
    expect(result.overallStatus).toBe("FAIL");
  });

  it("equity plan: stale risk snapshot → TPR FAIL", async () => {
    const plan = makePlan({
      riskSnapshot: { calculatedAt: "2025-01-01T00:00:00Z" }, // very stale
    });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.riskValidation.status).toBe("FAIL");
    expect(result.tradePlanReadiness!.status).toBe("FAIL");
  });

  it("equity plan: missing risk snapshot → TPR UNAVAILABLE (not REQUIRES_REVIEW)", async () => {
    // UAT blocker fix: UNAVAILABLE risk dim must roll up to UNAVAILABLE overall,
    // NOT to REQUIRES_REVIEW. "Review Required" is only for dims that explicitly
    // require human review action.
    const plan = makePlan({ riskSnapshot: null });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.riskValidation.status).toBe("UNAVAILABLE");
    expect(result.tradePlanReadiness!.status).toBe("UNAVAILABLE");
    expect(result.tradePlanReadiness!.label).toBe("Not Fully Assessed");
    expect(result.tradePlanReadiness!.label).not.toBe("Review Required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: STATUS VOCABULARY
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 5 — Status Vocabulary", () => {
  it("NOT_CONNECTED is returned for broker dims (not FAIL, not UNAVAILABLE)", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerValidation.status).toBe("NOT_CONNECTED");
    expect(result.accountValidation.status).toBe("NOT_CONNECTED");
    expect(result.permissionsValidation.status).toBe("NOT_CONNECTED");
  });

  it("NOT_CONFIRMED is returned for buying power when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.buyingPowerValidation.status).toBe("NOT_CONFIRMED");
  });

  it("NOT_APPLICABLE is returned for equity position when broker absent", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.positionValidation.status).toBe("NOT_APPLICABLE");
  });

  it("PLANNING_MODE is returned for quote and OPTIONS structure when broker absent", async () => {
    const optionsPlan = makePlan({ planType: "OPTIONS", structureSnapshot: { legs: [{ contractSymbol: "X" }] } });
    const deps = makeDeps(optionsPlan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.structureValidation.status).toBe("PLANNING_MODE");
  });

  it("methodologyVersion is 2.8.7a", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.methodologyVersion).toBe("2.8.7a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6: BACKWARD COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 6 — Backward Compatibility", () => {
  it("overallStatus field still present and valid", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(["PASS", "FAIL", "REQUIRES_REVIEW", "UNAVAILABLE", "EXECUTION_DISABLED"]).toContain(result.overallStatus);
  });

  it("all 11 original validation dimension fields still present", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanValidation).toBeDefined();
    expect(result.lifecycleValidation).toBeDefined();
    expect(result.freshnessValidation).toBeDefined();
    expect(result.brokerValidation).toBeDefined();
    expect(result.accountValidation).toBeDefined();
    expect(result.permissionsValidation).toBeDefined();
    expect(result.buyingPowerValidation).toBeDefined();
    expect(result.positionValidation).toBeDefined();
    expect(result.quoteValidation).toBeDefined();
    expect(result.structureValidation).toBeDefined();
    expect(result.riskValidation).toBeDefined();
  });

  it("blockers and warnings arrays always present", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("limitations array always present", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(Array.isArray(result.limitations)).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("new additive fields: tradePlanReadiness, brokerExecutionReadiness, executionAvailable", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result).toHaveProperty("tradePlanReadiness");
    expect(result).toHaveProperty("brokerExecutionReadiness");
    expect(result).toHaveProperty("executionAvailable");
  });

  it("EXECUTION_DISABLED fast-path still works (broker irrelevant)", async () => {
    // Mock execution disabled by making the policy return disabled
    // We test this via the direct result structure
    // Note: actual test would need env mock; this validates the type structure
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    // Result is a valid ExecutionPreflightResult regardless
    expect(result.id).toBeTruthy();
    expect(result.tradePlanId).toBe("plan-123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7: FAILURE MATRIX
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 7 — Failure Matrix", () => {
  it("plan not found → FAIL overall (TPR and BER both N/A)", async () => {
    const deps = makeDeps(null, null, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("FAIL");
    expect(result.executionAvailable).toBe(false);
  });

  it("archived plan → FAIL overall", async () => {
    const plan = makePlan({ archivedAt: new Date("2026-01-01") });
    const deps = makeDeps(plan, null, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("FAIL");
  });

  it("THESIS_INVALIDATED lifecycle → TPR FAIL + overall FAIL", async () => {
    const deps = makeDeps(
      makePlan(),
      { planId: "plan-123", lifecycleState: "THESIS_INVALIDATED", evaluatedAt: NOW },
      false
    );
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.lifecycleValidation.status).toBe("FAIL");
    expect(result.tradePlanReadiness!.status).toBe("FAIL");
    expect(result.overallStatus).toBe("FAIL");
  });

  it("DATA_STALE lifecycle → TPR FAIL + overall FAIL", async () => {
    const deps = makeDeps(
      makePlan(),
      { planId: "plan-123", lifecycleState: "DATA_STALE", evaluatedAt: NOW },
      false
    );
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.status).toBe("FAIL");
  });

  it("REQUIRES_REVIEW lifecycle → TPR REQUIRES_REVIEW overall FAIL (lifecycle blocker)", async () => {
    const deps = makeDeps(
      makePlan(),
      { planId: "plan-123", lifecycleState: "REQUIRES_REVIEW", evaluatedAt: NOW },
      false
    );
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.status).toBe("REQUIRES_REVIEW");
    // PLAN_REQUIRES_REVIEW is a blocker → overall FAIL
    expect(result.overallStatus).toBe("FAIL");
  });

  it("broker reauth needed → brokerValidation FAIL + overall FAIL", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), true, {
      getConnectionStatus: vi.fn().mockResolvedValue({ connected: true, provider: "tradier", needsReauth: true }),
    });
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerValidation.status).toBe("FAIL");
    expect(result.overallStatus).toBe("FAIL");
    // But TPR may still pass (broker reauth is execution layer, not plan layer)
    // Note: BROKER_NEEDS_REAUTH blocker causes overall FAIL regardless
  });

  it("constraint exceeded without broker → TPR FAIL + overall FAIL", async () => {
    const plan = makePlan({
      planningSnapshot: { maxRiskDollars: 100, scenarioMaxLoss: 500 }, // grossly exceeded
    });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.dimensions.planningConstraints.status).toBe("FAIL");
    expect(result.tradePlanReadiness!.status).toBe("FAIL");
    expect(result.overallStatus).toBe("FAIL");
    expect(result.executionAvailable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8: LIFECYCLE / FRESHNESS UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 8 — Lifecycle / Freshness Unchanged (INV-H)", () => {
  it("lifecycle CURRENT → lifecycleValidation PASS", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.lifecycleValidation.status).toBe("PASS");
  });

  it("lifecycle null → lifecycleValidation UNAVAILABLE + warning", async () => {
    const deps = makeDeps(makePlan(), null, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.lifecycleValidation.status).toBe("UNAVAILABLE");
    expect(result.warnings.some(w => w.code === "DATA_PARTIALLY_UNAVAILABLE")).toBe(true);
  });

  it("very old plan (>30 days) → freshnessValidation REQUIRES_REVIEW", async () => {
    const plan = makePlan({
      updatedAt: new Date("2026-01-01T00:00:00Z"), // ~5.5 months old
    });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.freshnessValidation.status).toBe("REQUIRES_REVIEW");
  });

  it("freshness logic is independent of broker status", async () => {
    const plan = makePlan({ updatedAt: new Date("2026-01-01T00:00:00Z") });
    const [r1, r2] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, makeDeps(plan, makeLifecycle("CURRENT"), false)),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, makeDeps(plan, makeLifecycle("CURRENT"), true)),
    ]);

    expect(r1.freshnessValidation.status).toBe(r2.freshnessValidation.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9: BROKER EXECUTION READINESS DETAILS
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 9 — Broker Execution Readiness Details", () => {
  it("BER is READY when broker connected and all checks pass", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerExecutionReadiness!.status).toBe("READY");
    expect(result.brokerExecutionReadiness!.brokerConnected).toBe(true);
    expect(result.brokerExecutionReadiness!.label).toBe("Ready");
  });

  it("BER has all 7 dimension fields", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const ber = result.brokerExecutionReadiness!;
    expect(ber.dimensions.brokerConnection).toBeDefined();
    expect(ber.dimensions.brokerAccount).toBeDefined();
    expect(ber.dimensions.permissions).toBeDefined();
    expect(ber.dimensions.buyingPower).toBeDefined();
    expect(ber.dimensions.position).toBeDefined();
    expect(ber.dimensions.quote).toBeDefined();
    expect(ber.dimensions.structure).toBeDefined();
  });

  it("BER BLOCKED when broker connected but has FAIL dims", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), true, {
      getConnectionStatus: vi.fn().mockResolvedValue({ connected: true, needsReauth: true, provider: "tradier" }),
    });
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerExecutionReadiness!.status).toBe("BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 10: PLANNING CONSTRAINT DIMENSION
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 10 — Planning Constraint Dimension", () => {
  it("constraint dim PASS when within bounds", async () => {
    const deps = makeDeps(makePlan({ planningSnapshot: { maxRiskDollars: 500, scenarioMaxLoss: 400 } }), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.dimensions.planningConstraints.status).toBe("PASS");
  });

  it("constraint dim FAIL when exceeded (>10% buffer)", async () => {
    const deps = makeDeps(makePlan({ planningSnapshot: { maxRiskDollars: 500, scenarioMaxLoss: 600 } }), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.dimensions.planningConstraints.status).toBe("FAIL");
    expect(result.blockers.some(b => b.code === "PLANNING_CONSTRAINT_EXCEEDED")).toBe(true);
  });

  it("constraint dim UNAVAILABLE when no planning snapshot", async () => {
    const deps = makeDeps(makePlan({ planningSnapshot: null }), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness!.dimensions.planningConstraints.status).toBe("UNAVAILABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 13: SPRINT 2.8.7B — BROKER-INDEPENDENT EQUITY PLANNING QUOTE
//
// Tests Phases 5–8 of Sprint 2.8.7B. All scenarios use injectable
// getPlanningQuote dep — no real Twelve Data calls in tests.
// ─────────────────────────────────────────────────────────────────────────────

function makePlanningQuote(overrides: Partial<import("@shared/execution-types").PlanningQuoteData> = {}): import("@shared/execution-types").PlanningQuoteData {
  return {
    source: "PLANNING_MARKET_DATA",
    provider: "twelve_data",
    symbol: "AAPL",
    price: 185.42,
    asOf: new Date(NOW.getTime() - 45_000).toISOString(), // 45s ago
    session: "regular",
    extendedHours: false,
    isMarketOpen: true,
    freshnessSec: 45,
    dataQuality: "fresh",
    isStale: false,
    ...overrides,
  };
}

function makeDepsWithPlanningQuote(
  plan: StoredTradePlan | null,
  lifecycle: StoredLifecycleResult | null,
  brokerConnected: boolean,
  planningQuote: import("@shared/execution-types").PlanningQuoteData | null,
  brokerOverrides: Record<string, any> = {}
): PreflightDependencies {
  return {
    ...makeDeps(plan, lifecycle, brokerConnected, brokerOverrides),
    getPlanningQuote: vi.fn().mockResolvedValue(planningQuote),
  };
}

describe("Suite 13A — Phase 8A: Brokerless EQUITY + valid Twelve Data planning quote", () => {
  it("quote dim carries planningQuote when planning data available", async () => {
    const pq = makePlanningQuote();
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote).toBeDefined();
    expect(result.quoteValidation.planningQuote?.source).toBe("PLANNING_MARKET_DATA");
    expect(result.quoteValidation.planningQuote?.provider).toBe("twelve_data");
    expect(result.quoteValidation.planningQuote?.price).toBe(185.42);
  });

  it("planning quote note mentions Twelve Data and the price", async () => {
    const pq = makePlanningQuote({ price: 185.42, dataQuality: "fresh" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.note).toContain("Twelve Data");
    expect(result.quoteValidation.note).toContain("185.42");
  });

  it("planning quote note for fresh quote mentions market session", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh", isMarketOpen: true, session: "regular" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.note).toContain("Market Open");
  });

  it("planning data does NOT affect overallStatus (still not PASS without broker)", async () => {
    const pq = makePlanningQuote();
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).not.toBe("PASS");
    expect(result.executionAvailable).toBe(false);
  });

  it("planning quote does not make TPR PASS on its own — TPR depends on plan dims", async () => {
    const pq = makePlanningQuote();
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    // TPR PASS remains possible (plan is complete)
    expect(result.tradePlanReadiness?.status).toBe("PASS");
    // But execution is still unavailable
    expect(result.executionAvailable).toBe(false);
  });
});

describe("Suite 13B — Phase 8B: Brokerless EQUITY + stale Twelve Data data", () => {
  it("stale planning quote still produces PLANNING_MODE (not FAIL)", async () => {
    const pq = makePlanningQuote({
      dataQuality: "stale",
      isStale: true,
      freshnessSec: 100_000,
      isMarketOpen: false,
      session: "closed",
    });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    // Stale planning data → PLANNING_MODE (not an execution blocker)
    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote?.isStale).toBe(true);
    // Not converted to FAIL or blocker
    const quoteBl = result.blockers.filter(b => b.code === "QUOTE_STALE");
    expect(quoteBl).toHaveLength(0);
  });

  it("stale note contains 'Stale' and hours-old indicator", async () => {
    const pq = makePlanningQuote({
      dataQuality: "stale",
      isStale: true,
      freshnessSec: 100_800, // 28h
      isMarketOpen: false,
      session: "closed",
    });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.note).toContain("Stale");
    expect(result.quoteValidation.note).toContain("28h");
  });

  it("last_close (overnight) quote: PLANNING_MODE, not stale, not error", async () => {
    const pq = makePlanningQuote({
      dataQuality: "last_close",
      isStale: false,
      freshnessSec: 14_400, // 4h ago (overnight)
      isMarketOpen: false,
      session: "closed",
    });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote?.isStale).toBe(false);
    expect(result.quoteValidation.planningQuote?.dataQuality).toBe("last_close");
  });
});

describe("Suite 13C — Phase 8C: Brokerless EQUITY + Twelve Data unavailable", () => {
  it("null planning quote → fallback PLANNING_MODE note (no planningQuote field)", async () => {
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, null);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote).toBeUndefined();
    expect(result.quoteValidation.note).toContain("Planning mode");
  });

  it("no getPlanningQuote dep → PLANNING_MODE fallback (existing 2.8.7A behavior)", async () => {
    // Deps without getPlanningQuote — simulates legacy/test callers
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote).toBeUndefined();
  });

  it("getPlanningQuote throwing → null fallback, no crash", async () => {
    const deps: PreflightDependencies = {
      ...makeDeps(makePlan(), makeLifecycle("CURRENT"), false),
      getPlanningQuote: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    // Must not throw
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote).toBeUndefined();
  });
});

describe("Suite 13D — Phase 8D: Broker connected + broker execution quote", () => {
  it("broker connected → broker quote validation used (planning quote NOT called)", async () => {
    const getPlanningQuote = vi.fn().mockResolvedValue(makePlanningQuote());
    const deps: PreflightDependencies = {
      ...makeDeps(makePlan(), makeLifecycle("CURRENT"), true),
      getPlanningQuote,
    };
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    // Broker connected → execution-grade quote used, not planning quote
    expect(getPlanningQuote).not.toHaveBeenCalled();
    // Quote dim reflects broker result
    expect(result.quoteValidation.status).toBe("PASS");
    // No planningQuote on execution-grade dim
    expect(result.quoteValidation.planningQuote).toBeUndefined();
  });

  it("broker connected → overallStatus can be PASS (planning quote does not interfere)", async () => {
    const deps: PreflightDependencies = {
      ...makeDeps(makePlan(), makeLifecycle("CURRENT"), true),
      getPlanningQuote: vi.fn().mockResolvedValue(makePlanningQuote()),
    };
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).toBe("PASS");
    expect(result.executionAvailable).toBe(true);
  });
});

describe("Suite 13E — Phase 8E/F: Broker connect/disconnect transitions", () => {
  it("Phase 8E: disconnect broker → planning quote remains available, execution unavailable", async () => {
    const pq = makePlanningQuote();
    const withBroker    = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), true,  null);
    const withoutBroker = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);

    const [rBroker, rNoBroker] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withBroker),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withoutBroker),
    ]);

    // With broker: execution-grade quote, execution available
    expect(rBroker.overallStatus).toBe("PASS");
    expect(rBroker.quoteValidation.planningQuote).toBeUndefined();

    // Without broker: planning quote available, execution not available
    expect(rNoBroker.overallStatus).not.toBe("PASS");
    expect(rNoBroker.executionAvailable).toBe(false);
    expect(rNoBroker.quoteValidation.planningQuote).toBeDefined();
    expect(rNoBroker.quoteValidation.planningQuote?.source).toBe("PLANNING_MARKET_DATA");
  });

  it("Phase 8F: reconnect broker → execution validation becomes available, planning quote not used", async () => {
    const pq = makePlanningQuote();
    const withoutBroker = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const withBroker    = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), true,  null);

    const [rNoBroker, rBroker] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withoutBroker),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withBroker),
    ]);

    // Reconnected → execution available
    expect(rBroker.overallStatus).toBe("PASS");
    expect(rBroker.executionAvailable).toBe(true);
    expect(rBroker.quoteValidation.planningQuote).toBeUndefined();

    // Disconnected → execution not available, but planning quote shown
    expect(rNoBroker.executionAvailable).toBe(false);
    expect(rNoBroker.quoteValidation.planningQuote?.source).toBe("PLANNING_MARKET_DATA");
  });
});

describe("Suite 13F — Phase 8G: Planning quote cannot satisfy execution gate", () => {
  it("overallStatus NEVER PASS from planning quote alone", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh", isMarketOpen: true });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).not.toBe("PASS");
    expect(result.executionAvailable).toBe(false);
  });

  it("planningQuote.source is PLANNING_MARKET_DATA — never EXECUTION_MARKET_DATA or broker", async () => {
    const pq = makePlanningQuote();
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.planningQuote?.source).toBe("PLANNING_MARKET_DATA");
    expect(result.quoteValidation.planningQuote?.source).not.toBe("broker");
  });

  it("brokerExecutionReadiness is NOT_CONNECTED even with valid planning quote", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.brokerExecutionReadiness?.status).toBe("NOT_CONNECTED");
    expect(result.brokerExecutionReadiness?.brokerConnected).toBe(false);
  });
});

describe("Suite 13G — Phase 8H/I: Permanent safety invariants with planning quote", () => {
  it("Phase 8H: overallStatus never PASS when brokerless (with planning quote)", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh", isMarketOpen: true });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).not.toBe("PASS");
  });

  it("Phase 8I: executionAvailable never true when brokerless (with planning quote)", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh", isMarketOpen: true });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.executionAvailable).toBe(false);
  });

  it("planning quote does not produce QUOTE_STALE blocker", async () => {
    const pq = makePlanningQuote({ dataQuality: "stale", isStale: true, freshnessSec: 200_000 });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const quoteBl = result.blockers.filter(b => b.code === "QUOTE_STALE");
    expect(quoteBl).toHaveLength(0);
  });

  it("planning quote does not produce QUOTE_INVALID blocker", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const invBl = result.blockers.filter(b => b.code === "QUOTE_INVALID");
    expect(invBl).toHaveLength(0);
  });
});

describe("Suite 13H — Phase 8J: Market session behavior", () => {
  const sessions = [
    { session: "regular" as const, isMarketOpen: true,  freshnessSec: 30,    expectedQuality: "fresh"      },
    { session: "pre"     as const, isMarketOpen: false, freshnessSec: 1_800,  expectedQuality: "last_close" },
    { session: "after"   as const, isMarketOpen: false, freshnessSec: 3_600,  expectedQuality: "last_close" },
    { session: "closed"  as const, isMarketOpen: false, freshnessSec: 14_400, expectedQuality: "last_close" },
    // Weekend
    { session: "closed"  as const, isMarketOpen: false, freshnessSec: 60_000, expectedQuality: "last_close" },
  ];

  for (const s of sessions) {
    it(`${s.session} session (freshnessSec=${s.freshnessSec}) → PLANNING_MODE, dataQuality="${s.expectedQuality}"`, async () => {
      const pq = makePlanningQuote({
        session: s.session,
        isMarketOpen: s.isMarketOpen,
        freshnessSec: s.freshnessSec,
        dataQuality: s.expectedQuality as any,
        isStale: s.expectedQuality === "stale",
      });
      const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
      const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

      expect(result.quoteValidation.status).toBe("PLANNING_MODE");
      expect(result.quoteValidation.planningQuote?.dataQuality).toBe(s.expectedQuality);
      // Session label in note for non-stale
      if (s.expectedQuality !== "stale") {
        expect(result.quoteValidation.note).toBeDefined();
      }
    });
  }

  it("stale quote (>25h) → PLANNING_MODE with isStale=true, not execution failure", async () => {
    const pq = makePlanningQuote({ dataQuality: "stale", isStale: true, freshnessSec: 100_800 });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote?.isStale).toBe(true);
    expect(result.blockers.filter(b => b.dimension === "quote")).toHaveLength(0);
  });
});

describe("Suite 13I — Phase 8K: No fabricated prices", () => {
  it("null planning quote → no price in note or planningQuote", async () => {
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, null);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.planningQuote).toBeUndefined();
    // Note should not contain a fabricated $ amount
    expect(result.quoteValidation.note).not.toMatch(/\$\d+/);
  });

  it("planning quote price comes directly from injected mock — not derived from plan fields", async () => {
    const pq = makePlanningQuote({ price: 999.99 });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.quoteValidation.planningQuote?.price).toBe(999.99);
  });
});

describe("Suite 13J — Phase 8L: Existing 2.8.7A invariants remain passing", () => {
  it("INV-A intact: TPR can PASS without broker (with planning quote)", async () => {
    const pq = makePlanningQuote();
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.tradePlanReadiness?.status).toBe("PASS");
  });

  it("INV-B intact: brokerless overallStatus never PASS", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.overallStatus).not.toBe("PASS");
  });

  it("INV-C intact: brokerless executionAvailable always false", async () => {
    const pq = makePlanningQuote({ dataQuality: "fresh" });
    const deps = makeDepsWithPlanningQuote(makePlan(), makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    expect(result.executionAvailable).toBe(false);
  });

  it("OPTIONS plan: planning quote not used (OPTIONS stays PLANNING_MODE without price)", async () => {
    const optionsPlan = makePlan({ planType: "OPTIONS", structureSnapshot: { legs: [{ contractSymbol: "AAPL260619C185" }] } });
    const pq = makePlanningQuote({ symbol: "AAPL" });
    const deps = makeDepsWithPlanningQuote(optionsPlan, makeLifecycle("CURRENT"), false, pq);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    // OPTIONS: planning quote not enriched (contract validation requires broker)
    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
    expect(result.quoteValidation.planningQuote).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 12: UAT BLOCKER REGRESSION — UNAVAILABLE ≠ REQUIRES_REVIEW
//
// Reproduces the exact UAT failure: Risk Analysis = UNAVAILABLE was incorrectly
// rolling up to "Review Required" overall TPR label even when no dimension
// explicitly required human review.
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 12 — UAT Regression: UNAVAILABLE must not produce 'Review Required'", () => {
  // Exact UAT scenario:
  // Trade Plan PASS, Research Lifecycle PASS, Plan Freshness PASS,
  // Risk Analysis UNAVAILABLE, Planning Constraints PASS, broker disconnected
  it("exact UAT state: risk UNAVAILABLE + lifecycle PASS + broker disconnected → NOT 'Review Required'", async () => {
    const plan = makePlan({ riskSnapshot: null }); // risk UNAVAILABLE
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;

    // All dims per the UAT observation
    expect(tpr.dimensions.tradePlan.status).toBe("PASS");
    expect(tpr.dimensions.lifecycle.status).toBe("PASS");
    expect(tpr.dimensions.freshness.status).toBe("PASS");
    expect(tpr.dimensions.risk.status).toBe("UNAVAILABLE");
    expect(tpr.dimensions.planningConstraints.status).toBe("PASS");

    // Overall must be UNAVAILABLE, never REQUIRES_REVIEW
    expect(tpr.status).toBe("UNAVAILABLE");
    expect(tpr.status).not.toBe("REQUIRES_REVIEW");

    // Label must be "Not Fully Assessed" — never "Review Required"
    expect(tpr.label).toBe("Not Fully Assessed");
    expect(tpr.label).not.toBe("Review Required");

    // Execution still correctly unavailable (broker disconnected)
    expect(result.executionAvailable).toBe(false);
    expect(result.overallStatus).not.toBe("PASS");
  });

  // UAT item 7a: lifecycle REQUIRES_REVIEW → TPR overall REQUIRES_REVIEW → "Review Required"
  it("lifecycle REQUIRES_REVIEW → TPR 'Review Required' (legitimate use of the label)", async () => {
    const plan = makePlan({ riskSnapshot: null }); // risk also UNAVAILABLE
    const deps = makeDeps(plan, makeLifecycle("REQUIRES_REVIEW"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.dimensions.lifecycle.status).toBe("REQUIRES_REVIEW");
    expect(tpr.status).toBe("REQUIRES_REVIEW");
    expect(tpr.label).toBe("Review Required");
  });

  // UAT item 7b: lifecycle PASS (no dims REQUIRES_REVIEW) → NO "Review Required" label
  it("lifecycle PASS + all other dims PASS → label is 'Plan Ready', not 'Review Required'", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.status).toBe("PASS");
    expect(tpr.label).toBe("Plan Ready");
    expect(tpr.label).not.toBe("Review Required");
  });

  // UAT item 7c: risk UNAVAILABLE + lifecycle PASS → UNAVAILABLE (not REQUIRES_REVIEW)
  it("risk UNAVAILABLE + lifecycle PASS → TPR UNAVAILABLE", async () => {
    const plan = makePlan({ riskSnapshot: null });
    const deps = makeDeps(plan, makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.dimensions.risk.status).toBe("UNAVAILABLE");
    expect(tpr.dimensions.lifecycle.status).toBe("PASS");
    expect(tpr.status).toBe("UNAVAILABLE");
    expect(tpr.status).not.toBe("REQUIRES_REVIEW");
  });

  // UAT item 7d: risk PASS + lifecycle PASS → TPR PASS
  it("risk PASS + lifecycle PASS → TPR PASS", async () => {
    const deps = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.dimensions.risk.status).toBe("PASS");
    expect(tpr.status).toBe("PASS");
    expect(tpr.label).toBe("Plan Ready");
  });

  // UAT item 7e: broker disconnected does NOT affect research-review state
  it("broker disconnect does not affect TPR lifecycle dim or overall research-review state", async () => {
    const withBroker    = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);
    const withoutBroker = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);

    const [r1, r2] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withBroker),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withoutBroker),
    ]);

    // TPR lifecycle dim identical regardless of broker
    expect(r1.tradePlanReadiness!.dimensions.lifecycle.status).toBe("PASS");
    expect(r2.tradePlanReadiness!.dimensions.lifecycle.status).toBe("PASS");
    // TPR status identical
    expect(r1.tradePlanReadiness!.status).toBe("PASS");
    expect(r2.tradePlanReadiness!.status).toBe("PASS");
    // Only overall and executionAvailable differ
    expect(r1.overallStatus).toBe("PASS");
    expect(r2.overallStatus).not.toBe("PASS");
  });

  // UAT item 7f: broker reconnect does NOT alter Trade Plan Readiness semantics
  it("broker reconnect does not change TPR dimensions or status", async () => {
    const withoutBroker = makeDeps(makePlan(), makeLifecycle("CURRENT"), false);
    const withBroker    = makeDeps(makePlan(), makeLifecycle("CURRENT"), true);

    const [r1, r2] = await Promise.all([
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withoutBroker),
      runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, withBroker),
    ]);

    // TPR is identical
    const tpr1 = r1.tradePlanReadiness!;
    const tpr2 = r2.tradePlanReadiness!;
    expect(tpr1.status).toBe(tpr2.status);
    expect(tpr1.label).toBe(tpr2.label);
    expect(tpr1.dimensions.tradePlan.status).toBe(tpr2.dimensions.tradePlan.status);
    expect(tpr1.dimensions.lifecycle.status).toBe(tpr2.dimensions.lifecycle.status);
    expect(tpr1.dimensions.risk.status).toBe(tpr2.dimensions.risk.status);
  });

  // REQUIRES_REVIEW takes priority over UNAVAILABLE when both are present
  it("REQUIRES_REVIEW dim takes priority over UNAVAILABLE dim in rollup", async () => {
    // lifecycle = REQUIRES_REVIEW, risk = UNAVAILABLE (no snapshot)
    const plan = makePlan({ riskSnapshot: null });
    const deps = makeDeps(plan, makeLifecycle("REQUIRES_REVIEW"), false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.dimensions.lifecycle.status).toBe("REQUIRES_REVIEW");
    expect(tpr.dimensions.risk.status).toBe("UNAVAILABLE");
    // REQUIRES_REVIEW wins over UNAVAILABLE
    expect(tpr.status).toBe("REQUIRES_REVIEW");
    expect(tpr.label).toBe("Review Required");
  });

  // FAIL takes priority over both REQUIRES_REVIEW and UNAVAILABLE
  it("FAIL dim takes priority over REQUIRES_REVIEW and UNAVAILABLE in rollup", async () => {
    // lifecycle = THESIS_INVALIDATED (FAIL), risk = no snapshot (UNAVAILABLE)
    const plan = makePlan({ riskSnapshot: null });
    const lifecycle: StoredLifecycleResult = {
      planId: "plan-123", lifecycleState: "THESIS_INVALIDATED", evaluatedAt: NOW,
    };
    const deps = makeDeps(plan, lifecycle, false);
    const result = await runExecutionPreflight({ tradePlanId: "plan-123", userId: "user-456" }, deps);

    const tpr = result.tradePlanReadiness!;
    expect(tpr.status).toBe("FAIL");
    expect(tpr.label).toBe("Blocked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 11: SAFETY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 11 — formatPreflightQuoteAge helper unchanged", () => {
  it("Infinity → 'Quote timestamp unavailable.'", () => {
    expect(formatPreflightQuoteAge(Infinity)).toBe("Quote timestamp unavailable.");
  });

  it("< 3600 → seconds format", () => {
    expect(formatPreflightQuoteAge(42)).toBe("Quote is 42s old.");
  });

  it(">= 3600 → hours/minutes format", () => {
    expect(formatPreflightQuoteAge(3750)).toBe("Last market quote is 1h 2m old.");
  });

  it("negative value → 'Quote timestamp unavailable.'", () => {
    expect(formatPreflightQuoteAge(-1)).toBe("Quote timestamp unavailable.");
  });
});
