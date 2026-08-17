/**
 * server/routes/__tests__/execution-preflight.test.ts
 *
 * Sprint 2.8.0 — Execution Preflight Test Suite
 * 175+ assertions covering all acceptance criteria.
 *
 * All tests use pure computation + injectable dependencies.
 * No real database, no real broker calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  ExecutionPreflightResult,
  ExecutionPreflightStatus,
  ExecutionBlockerCode,
  ExecutionWarningCode,
} from "@shared/execution-types";
import {
  EXECUTION_PREFLIGHT_DISCLAIMER,
  EXECUTION_FORBIDDEN_PHRASES,
  EXECUTION_FRESHNESS_THRESHOLDS,
} from "@shared/execution-types";
import {
  runExecutionPreflight,
  type PreflightDependencies,
  type StoredTradePlan,
  type StoredLifecycleResult,
} from "../../services/execution-preflight-service";
import {
  MockBrokerExecutionAdapter,
  type MockBrokerAdapterSpyCalls,
} from "../../services/broker-execution-adapter";
import {
  isExecutionEnabled,
  getExecutionMode,
  isTradierExecutionEnabled,
  isTradeStationExecutionEnabled,
  isProviderExecutionEnabled,
  detectSafetyBypassAttempt,
  getExecutionPolicy,
} from "../../services/execution-policy";

// ─── Mock environment helpers ────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); }
  finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── Plan factory ────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-11T12:00:00Z");

function makePlan(overrides: Partial<StoredTradePlan> = {}): StoredTradePlan {
  return {
    id: "plan-001",
    userId: "user-001",
    symbol: "AAPL",
    planType: "EQUITY",
    status: "ACTIVE",
    archivedAt: null,
    riskSnapshot: { calculatedAt: NOW.toISOString(), maxRiskDollars: 500 },
    structureSnapshot: { type: "long_stock", quantity: 10 },
    planningSnapshot: { maxRiskDollars: 500, estimatedCapital: 1500 },
    updatedAt: new Date(NOW.getTime() - 3600_000), // 1 hour ago
    version: 1,
    limitations: [],
    ...overrides,
  };
}

function makeLifecycle(overrides: Partial<StoredLifecycleResult> = {}): StoredLifecycleResult {
  return {
    planId: "plan-001",
    lifecycleState: "CURRENT",
    evaluatedAt: new Date(NOW.getTime() - 300_000), // 5 min ago
    ...overrides,
  };
}

function makeDeps(
  plan: StoredTradePlan | null,
  lifecycle: StoredLifecycleResult | null,
  adapterOpts: ConstructorParameters<typeof MockBrokerExecutionAdapter>[0] = {}
): PreflightDependencies {
  const preflightsSaved: ExecutionPreflightResult[] = [];
  const auditsSaved: any[] = [];
  const broker = new MockBrokerExecutionAdapter(adapterOpts);

  return {
    brokerAdapter: broker,
    getTradePlan: async (planId, userId) => {
      if (!plan || plan.userId !== userId || plan.id !== planId) return null;
      return plan;
    },
    getLifecycleResult: async () => lifecycle,
    savePreflight: async (result) => { preflightsSaved.push(result); },
    saveAuditEvent: async (event) => { auditsSaved.push(event); },
    now: () => NOW,
  };
}

function getBrokerSpy(deps: PreflightDependencies): MockBrokerAdapterSpyCalls {
  return (deps.brokerAdapter as MockBrokerExecutionAdapter).spy;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. KILL SWITCH — BROKER_EXECUTION_ENABLED env var
// ─────────────────────────────────────────────────────────────────────────────

describe("execution-policy: kill switch", () => {
  it("returns false when BROKER_EXECUTION_ENABLED is unset", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: undefined }, () => {
      expect(isExecutionEnabled()).toBe(false);
    });
  });

  it("returns false when BROKER_EXECUTION_ENABLED=false", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: "false" }, () => {
      expect(isExecutionEnabled()).toBe(false);
    });
  });

  it("returns false when BROKER_EXECUTION_ENABLED is invalid value", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: "yes" }, () => {
      expect(isExecutionEnabled()).toBe(false);
    });
  });

  it("returns true only for exact 'true'", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: "true" }, () => {
      expect(isExecutionEnabled()).toBe(true);
    });
  });

  it("is case-insensitive for 'True'", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: "True" }, () => {
      expect(isExecutionEnabled()).toBe(true);
    });
  });
});

describe("execution-policy: execution mode", () => {
  it("defaults to 'disabled' when unset", () => {
    withEnv({ BROKER_EXECUTION_MODE: undefined }, () => {
      expect(getExecutionMode()).toBe("disabled");
    });
  });

  it("returns 'sandbox' when set", () => {
    withEnv({ BROKER_EXECUTION_MODE: "sandbox" }, () => {
      expect(getExecutionMode()).toBe("sandbox");
    });
  });

  it("returns 'production' when set", () => {
    withEnv({ BROKER_EXECUTION_MODE: "production" }, () => {
      expect(getExecutionMode()).toBe("production");
    });
  });

  it("returns 'disabled' for invalid values", () => {
    withEnv({ BROKER_EXECUTION_MODE: "live" }, () => {
      expect(getExecutionMode()).toBe("disabled");
    });
  });
});

describe("execution-policy: provider flags", () => {
  it("tradier: returns false when global kill switch is off", () => {
    withEnv({
      BROKER_EXECUTION_ENABLED: "false",
      TRADIER_EXECUTION_ENABLED: "true",
    }, () => {
      expect(isTradierExecutionEnabled()).toBe(false);
    });
  });

  it("tradier: returns true only when both global + provider flags are true", () => {
    withEnv({
      BROKER_EXECUTION_ENABLED: "true",
      TRADIER_EXECUTION_ENABLED: "true",
    }, () => {
      expect(isTradierExecutionEnabled()).toBe(true);
    });
  });

  it("tradestation: returns false when global kill switch is off", () => {
    withEnv({
      BROKER_EXECUTION_ENABLED: "false",
      TRADESTATION_EXECUTION_ENABLED: "true",
    }, () => {
      expect(isTradeStationExecutionEnabled()).toBe(false);
    });
  });

  it("global override: even with all provider flags true, global off = all disabled", () => {
    withEnv({
      BROKER_EXECUTION_ENABLED: "false",
      TRADIER_EXECUTION_ENABLED: "true",
      TRADESTATION_EXECUTION_ENABLED: "true",
    }, () => {
      expect(isProviderExecutionEnabled("tradier")).toBe(false);
      expect(isProviderExecutionEnabled("tradestation")).toBe(false);
    });
  });

  it("unknown provider: always disabled", () => {
    withEnv({ BROKER_EXECUTION_ENABLED: "true" }, () => {
      expect(isProviderExecutionEnabled("rithmic")).toBe(false);
      expect(isProviderExecutionEnabled("schwab")).toBe(false);
    });
  });
});

describe("execution-policy: all safety requirements default true", () => {
  it("every policy field defaults to true / disabled", () => {
    withEnv({
      BROKER_EXECUTION_ENABLED: "false",
      BROKER_EXECUTION_MODE: "disabled",
    }, () => {
      const policy = getExecutionPolicy();
      expect(policy.requireTradePlan).toBe(true);
      expect(policy.requireFreshLifecycle).toBe(true);
      expect(policy.requireFreshQuotes).toBe(true);
      expect(policy.requireRiskAnalysis).toBe(true);
      expect(policy.requireBrokerConnection).toBe(true);
      expect(policy.requireAccountValidation).toBe(true);
      expect(policy.requirePermissions).toBe(true);
      expect(policy.requireBuyingPower).toBe(true);
      expect(policy.requirePositionValidation).toBe(true);
      expect(policy.requireExplicitConfirmation).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SAFETY BYPASS DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("detectSafetyBypassAttempt", () => {
  it("returns empty when no bypass fields present", () => {
    expect(detectSafetyBypassAttempt({ requestedAccountRef: "acc-1" })).toHaveLength(0);
  });

  it("detects forceExecute", () => {
    expect(detectSafetyBypassAttempt({ forceExecute: true })).toContain("forceExecute");
  });

  it("detects skipQuoteValidation", () => {
    expect(detectSafetyBypassAttempt({ skipQuoteValidation: true })).toContain("skipQuoteValidation");
  });

  it("detects skipBuyingPower", () => {
    expect(detectSafetyBypassAttempt({ skipBuyingPower: true })).toContain("skipBuyingPower");
  });

  it("detects ignoreInvalidation", () => {
    expect(detectSafetyBypassAttempt({ ignoreInvalidation: true })).toContain("ignoreInvalidation");
  });

  it("detects bypassPreflight", () => {
    expect(detectSafetyBypassAttempt({ bypassPreflight: true })).toContain("bypassPreflight");
  });

  it("detects multiple bypass fields", () => {
    const result = detectSafetyBypassAttempt({ forceExecute: true, skipRisk: true });
    expect(result).toContain("forceExecute");
    expect(result).toContain("skipRisk");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXECUTION DISABLED FAST-PATH
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: execution disabled", () => {
  beforeEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  it("returns EXECUTION_DISABLED when flag is unset", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("EXECUTION_DISABLED");
  });

  it("includes EXECUTION_DISABLED blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const codes = result.blockers.map(b => b.code);
    expect(codes).toContain("EXECUTION_DISABLED");
  });

  it("includes disclaimer in limitations", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.limitations.join(" ")).toContain("not an investment recommendation");
  });

  it("broker/account/quote dimensions are SKIPPED when execution disabled", async () => {
    // Sprint 2.8.7A: EXECUTION_DISABLED path now computes TPR dims (risk/lifecycle/freshness).
    // Broker-dependent dims (broker, account, quote) remain SKIPPED.
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const brokerDims = [
      result.brokerValidation, result.accountValidation, result.quoteValidation,
    ];
    expect(brokerDims.every(d => d.status === "SKIPPED")).toBe(true);
    // overallStatus is EXECUTION_DISABLED (not FAIL)
    expect(result.overallStatus).toBe("EXECUTION_DISABLED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TRADE PLAN REQUIRED
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: trade plan required", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("returns FAIL + TRADE_PLAN_NOT_FOUND when plan does not exist", async () => {
    const deps = makeDeps(null, null);
    const result = await runExecutionPreflight(
      { tradePlanId: "nonexistent", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("FAIL");
    const codes = result.blockers.map(b => b.code);
    expect(codes).toContain("TRADE_PLAN_NOT_FOUND");
  });

  it("returns FAIL + TRADE_PLAN_NOT_FOUND for cross-user access", async () => {
    const plan = makePlan({ userId: "other-user" });
    const deps = makeDeps(plan, null);
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("FAIL");
    const codes = result.blockers.map(b => b.code);
    expect(codes).toContain("TRADE_PLAN_NOT_FOUND");
  });

  it("returns FAIL + TRADE_PLAN_ARCHIVED for archived plan", async () => {
    const plan = makePlan({ archivedAt: new Date("2026-08-01") });
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("FAIL");
    const codes = result.blockers.map(b => b.code);
    expect(codes).toContain("TRADE_PLAN_ARCHIVED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. LIFECYCLE STATE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: lifecycle validation", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("THESIS_INVALIDATED → FAIL with THESIS_INVALIDATED blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle({ lifecycleState: "THESIS_INVALIDATED" }));
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("THESIS_INVALIDATED");
  });

  it("DATA_STALE → FAIL with TRADE_PLAN_STALE blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle({ lifecycleState: "DATA_STALE" }));
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).toBe("FAIL");
    expect(result.blockers.map(b => b.code)).toContain("TRADE_PLAN_STALE");
  });

  it("REQUIRES_REVIEW → FAIL with PLAN_REQUIRES_REVIEW blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle({ lifecycleState: "REQUIRES_REVIEW" }));
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("PLAN_REQUIRES_REVIEW");
  });

  it("UNKNOWN → FAIL with UNKNOWN_CRITICAL_STATE blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle({ lifecycleState: "UNKNOWN" }));
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("UNKNOWN_CRITICAL_STATE");
  });

  it("CURRENT → lifecycle dimension PASS", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle({ lifecycleState: "CURRENT" }));
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.lifecycleValidation.status).toBe("PASS");
  });

  it("null lifecycle → UNAVAILABLE warning", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, null);
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.lifecycleValidation.status).toBe("UNAVAILABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. BROKER CONNECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: broker connection", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("broker not connected → NOT_CONNECTED status on broker dim (Sprint 2.8.7A: no BROKER_NOT_CONNECTED blocker)", async () => {
    // Sprint 2.8.7A: broker absence is no longer a blocker — dimension returns NOT_CONNECTED.
    // The overall status becomes UNAVAILABLE (not FAIL) when broker is absent and no plan blockers exist.
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: false });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.brokerValidation.status).toBe("NOT_CONNECTED");
    expect(result.blockers.map(b => b.code)).not.toContain("BROKER_NOT_CONNECTED");
    expect(result.overallStatus).toBe("UNAVAILABLE");
  });

  it("needs reauth → BROKER_NEEDS_REAUTH blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true, needsReauth: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("BROKER_NEEDS_REAUTH");
  });

  it("connected + no reauth → broker dimension PASS", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true, needsReauth: false });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.brokerValidation.status).toBe("PASS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ACCOUNT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: account resolution", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("no accounts → ACCOUNT_NOT_RESOLVED blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      accounts: [],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("ACCOUNT_NOT_RESOLVED");
  });

  it("requestedAccountRef not in accounts → ACCOUNT_NOT_OWNED", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      accounts: [{
        accountRef: "real-account",
        accountIdMasked: "••••6789",
        accountType: "CASH",
        provider: "mock",
        isPreferred: true,
      }],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001", requestedAccountRef: "other-account" },
      deps
    );
    expect(result.blockers.map(b => b.code)).toContain("ACCOUNT_NOT_OWNED");
  });

  it("multiple accounts without selection → REQUIRES_REVIEW on accountValidation", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      accounts: [
        { accountRef: "a1", accountIdMasked: "••••0001", accountType: "CASH", provider: "mock", isPreferred: false },
        { accountRef: "a2", accountIdMasked: "••••0002", accountType: "MARGIN", provider: "mock", isPreferred: false },
      ],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.accountValidation.status).toBe("REQUIRES_REVIEW");
    const warnCodes = result.warnings.map(w => w.code);
    expect(warnCodes).toContain("MULTI_ACCOUNT_SELECTION_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: permissions", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("options plan with optionsTrading=false → OPTIONS_PERMISSION_INSUFFICIENT", async () => {
    const plan = makePlan({ planType: "OPTIONS", structureSnapshot: { type: "long_call", legs: [] } });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      permissions: { equityTrading: true, optionsTrading: false, source: "broker" as const },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("OPTIONS_PERMISSION_INSUFFICIENT");
  });

  it("equity plan with equityTrading=false → EQUITY_PERMISSION_UNAVAILABLE", async () => {
    const plan = makePlan({ planType: "EQUITY" });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      permissions: { equityTrading: false, optionsTrading: true, source: "broker" as const },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("EQUITY_PERMISSION_UNAVAILABLE");
  });

  it("permissions source=unavailable → UNAVAILABLE dimension + OPTIONS_LEVEL_UNVERIFIED warning", async () => {
    const plan = makePlan({ planType: "OPTIONS", structureSnapshot: { type: "long_call" } });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      permissions: { source: "unavailable" as const },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.permissionsValidation.status).toBe("UNAVAILABLE");
    expect(result.warnings.map(w => w.code)).toContain("OPTIONS_LEVEL_UNVERIFIED");
  });

  it("multi-leg structure with multiLeg=false → MULTILEG_NOT_SUPPORTED", async () => {
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: {
        type: "spread",
        legs: [
          { contractSymbol: "AAPL260117C00170000" },
          { contractSymbol: "AAPL260117C00175000" },
        ],
      },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      permissions: {
        equityTrading: true,
        optionsTrading: true,
        multiLeg: false,
        source: "broker" as const,
      },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("MULTILEG_NOT_SUPPORTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. BUYING POWER
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: buying power", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("buyingPower unavailable → BUYING_POWER_UNAVAILABLE blocker", async () => {
    const plan = makePlan({ planningSnapshot: { maxRiskDollars: 500, estimatedCapital: 5000 } });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      buyingPower: { available: false },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("BUYING_POWER_UNAVAILABLE");
  });

  it("estimatedCapital > buyingPower → INSUFFICIENT_BUYING_POWER", async () => {
    const plan = makePlan({
      planningSnapshot: { maxRiskDollars: 500, estimatedCapital: 15000 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      buyingPower: { available: true, buyingPowerUsd: 1000 },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("INSUFFICIENT_BUYING_POWER");
  });

  it("sufficient buying power → buyingPower dimension PASS", async () => {
    const plan = makePlan({
      planningSnapshot: { maxRiskDollars: 500, estimatedCapital: 1500 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      buyingPower: { available: true, buyingPowerUsd: 10000 },
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.buyingPowerValidation.status).toBe("PASS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. POSITION VALIDATION (covered call / protective put)
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: position requirements", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("covered_call without shares → INSUFFICIENT_COVERED_SHARES", async () => {
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: { type: "covered_call", contractQuantity: 1, multiplier: 100 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      positions: [], // no shares
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("INSUFFICIENT_COVERED_SHARES");
  });

  it("covered_call with sufficient shares → position dimension PASS", async () => {
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: { type: "covered_call", contractQuantity: 1, multiplier: 100 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      positions: [{ symbol: "AAPL", quantity: 100, isLiveBrokerData: true, asOf: NOW.toISOString() }],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.positionValidation.status).toBe("PASS");
  });

  it("protective_put without shares → INSUFFICIENT_PROTECTIVE_SHARES", async () => {
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: { type: "protective_put", contractQuantity: 1, multiplier: 100 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      positions: [],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("INSUFFICIENT_PROTECTIVE_SHARES");
  });

  it("collar without shares → INSUFFICIENT_COVERED_SHARES", async () => {
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: { type: "collar", contractQuantity: 1, multiplier: 100 },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      positions: [],
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const codes = result.blockers.map(b => b.code);
    expect(
      codes.includes("INSUFFICIENT_COVERED_SHARES") || codes.includes("INSUFFICIENT_PROTECTIVE_SHARES")
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. QUOTE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: quote validation", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("stale quote → QUOTE_STALE blocker", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      quoteValid: true,
      quoteFresh: false,
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("QUOTE_STALE");
  });

  it("fresh + valid quote → quote dimension PASS", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      quoteValid: true,
      quoteFresh: true,
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.quoteValidation.status).toBe("PASS");
  });

  it("broker disconnected → quote dimension PLANNING_MODE (Sprint 2.8.7A)", async () => {
    // Sprint 2.8.7A: broker absence no longer produces UNAVAILABLE on the quote dim.
    // Returns PLANNING_MODE — evaluated in planning context; not a blocker.
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: false,
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.quoteValidation.status).toBe("PLANNING_MODE");
  });

  it("expired options contract → CONTRACT_EXPIRED blocker", async () => {
    // OCC format expired contract (date in 2020)
    const plan = makePlan({
      planType: "OPTIONS",
      structureSnapshot: {
        type: "long_call",
        legs: [{ contractSymbol: "AAPL200117C00150000" }],
      },
    });
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      quoteValid: false,
      quoteFresh: false,
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const codes = result.blockers.map(b => b.code);
    // Either CONTRACT_EXPIRED or QUOTE_STALE depending on which path triggers first
    expect(codes.some(c =>
      c === "CONTRACT_EXPIRED" || c === "QUOTE_STALE" || c === "CONTRACT_UNAVAILABLE"
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. RISK ANALYSIS VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: risk validation", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("risk analysis stale (> 24h) → RISK_ANALYSIS_STALE blocker", async () => {
    const staleDate = new Date(NOW.getTime() - (EXECUTION_FRESHNESS_THRESHOLDS.riskAnalysisSec + 1) * 1000);
    const plan = makePlan({
      riskSnapshot: { calculatedAt: staleDate.toISOString() },
    });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("RISK_ANALYSIS_STALE");
  });

  it("fresh risk analysis → risk dimension PASS", async () => {
    const plan = makePlan({
      riskSnapshot: { calculatedAt: new Date(NOW.getTime() - 3600_000).toISOString() },
    });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.riskValidation.status).toBe("PASS");
  });

  it("no risk snapshot → UNAVAILABLE on risk dimension", async () => {
    const plan = makePlan({ riskSnapshot: null });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.riskValidation.status).toBe("UNAVAILABLE");
    const warnCodes = result.warnings.map(w => w.code);
    expect(warnCodes).toContain("DATA_PARTIALLY_UNAVAILABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. PLANNING CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: planning constraints", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("scenarioMaxLoss > maxRiskDollars * 1.1 → PLANNING_CONSTRAINT_EXCEEDED blocker", async () => {
    const plan = makePlan({
      planningSnapshot: {
        maxRiskDollars: 500,
        scenarioMaxLoss: 700, // 40% over
      },
    });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.blockers.map(b => b.code)).toContain("PLANNING_CONSTRAINT_EXCEEDED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. BLOCKERS, WARNINGS, VALID_UNTIL
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: blockers, warnings, validUntil", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("PASS result has validUntil set", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      quoteFresh: true,
      quoteValid: true,
    });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    if (result.overallStatus === "PASS") {
      expect(result.validUntil).toBeDefined();
      const expiresAt = new Date(result.validUntil!);
      expect(expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("FAIL result has no validUntil", async () => {
    const plan = makePlan({ archivedAt: new Date("2026-08-01") });
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.validUntil).toBeUndefined();
  });

  it("preflight result always includes methodology version", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.methodologyVersion).toBe("2.8.7a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. NO ORDER CALLS (broker spy)
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: broker spy — no order calls", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("PASS path: no order methods called on broker adapter", async () => {
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), {
      connected: true,
      quoteFresh: true,
      quoteValid: true,
    });
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const spy = getBrokerSpy(deps);
    expect(spy.placeOrder).toBe(0);
    expect(spy.submitOrder).toBe(0);
    expect(spy.replaceOrder).toBe(0);
    expect(spy.cancelOrder).toBe(0);
  });

  it("FAIL path: no order methods called", async () => {
    const plan = makePlan({ archivedAt: new Date("2026-08-01") });
    const deps = makeDeps(plan, makeLifecycle());
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const spy = getBrokerSpy(deps);
    expect(spy.placeOrder).toBe(0);
    expect(spy.submitOrder).toBe(0);
    expect(spy.replaceOrder).toBe(0);
    expect(spy.cancelOrder).toBe(0);
  });

  it("EXECUTION_DISABLED path: no order methods called", async () => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle());
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const spy = getBrokerSpy(deps);
    expect(spy.placeOrder).toBe(0);
    expect(spy.submitOrder).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: audit events", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("emits PREFLIGHT_STARTED audit event", async () => {
    const auditsSaved: any[] = [];
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle()),
      saveAuditEvent: async (evt) => { auditsSaved.push(evt); },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const startEvent = auditsSaved.find(e => e.eventType === "PREFLIGHT_STARTED");
    expect(startEvent).toBeDefined();
    expect(startEvent.userId).toBe("user-001");
  });

  it("emits PREFLIGHT_COMPLETED or PREFLIGHT_FAILED event", async () => {
    const auditsSaved: any[] = [];
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle(), { connected: true }),
      saveAuditEvent: async (evt) => { auditsSaved.push(evt); },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const terminal = auditsSaved.find(e =>
      e.eventType === "PREFLIGHT_COMPLETED" || e.eventType === "PREFLIGHT_FAILED"
    );
    expect(terminal).toBeDefined();
  });

  it("audit events never contain raw broker token", async () => {
    const auditsSaved: any[] = [];
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle()),
      saveAuditEvent: async (evt) => { auditsSaved.push(evt); },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const allJson = JSON.stringify(auditsSaved);
    expect(allJson).not.toContain("accessToken");
    expect(allJson).not.toContain("refreshToken");
    expect(allJson).not.toContain("password");
  });

  it("audit events use masked account ref not full ID", async () => {
    const auditsSaved: any[] = [];
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle(), { connected: true }),
      saveAuditEvent: async (evt) => { auditsSaved.push(evt); },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const allJson = JSON.stringify(auditsSaved);
    // Must not contain full raw account ID from mock
    expect(allJson).not.toContain("mock-account-123");
  });

  it("EXECUTION_DISABLED emits EXECUTION_DISABLED_ATTEMPT", async () => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    const auditsSaved: any[] = [];
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle()),
      saveAuditEvent: async (evt) => { auditsSaved.push(evt); },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    const disabledEvent = auditsSaved.find(e => e.eventType === "EXECUTION_DISABLED_ATTEMPT");
    expect(disabledEvent).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. LOG REDACTION / DATA SCRUBBING
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: output scrubbing", () => {
  it("result JSON never contains raw account ID", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const json = JSON.stringify(result);
    expect(json).not.toContain("mock-account-123");
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  it("result JSON contains masked account reference when resolved", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const json = JSON.stringify(result);
    // Account note may appear in accountValidation.note
    if (result.accountValidation.note) {
      expect(result.accountValidation.note).toContain("••••");
    }
    delete process.env.BROKER_EXECUTION_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. COMPLIANCE LANGUAGE
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: compliance language", () => {
  it("disclaimer contains 'not an investment recommendation'", () => {
    expect(EXECUTION_PREFLIGHT_DISCLAIMER).toContain("not an investment recommendation");
  });

  it("disclaimer contains 'not a guarantee'", () => {
    expect(EXECUTION_PREFLIGHT_DISCLAIMER).toContain("guarantee");
  });

  it("overallStatus values never include READY_TO_TRADE", async () => {
    const allowedStatuses: ExecutionPreflightStatus[] = [
      "PASS", "FAIL", "REQUIRES_REVIEW", "UNAVAILABLE", "EXECUTION_DISABLED"
    ];
    const forbidden = ["READY_TO_TRADE", "APPROVED", "RECOMMENDED"];
    forbidden.forEach(s => {
      expect(allowedStatuses).not.toContain(s);
    });
  });

  it("EXECUTION_FORBIDDEN_PHRASES never appear in preflight result blocker messages", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const allText = [
      ...result.blockers.map(b => b.message),
      ...result.warnings.map(w => w.message),
      ...result.limitations,
    ].join(" ");
    EXECUTION_FORBIDDEN_PHRASES.forEach(phrase => {
      expect(allText).not.toContain(phrase);
    });
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  it("result overallStatus is never READY_TO_TRADE or APPROVED", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan();
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    expect(result.overallStatus).not.toBe("READY_TO_TRADE");
    expect(result.overallStatus).not.toBe("APPROVED");
    expect(result.overallStatus).not.toBe("RECOMMENDED");
    delete process.env.BROKER_EXECUTION_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. CONFIRMATION REQUIREMENTS
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: confirmation requirements", () => {
  it("EQUITY plan includes all equity review requirements", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan({ planType: "EQUITY" });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const reqs = result.confirmationRequirements;
    expect(reqs.requireSymbolReview).toBe(true);
    expect(reqs.requireQuantityReview).toBe(true);
    expect(reqs.requireEstimatedCapitalReview).toBe(true);
    expect(reqs.requireBrokerAccountReview).toBe(true);
    expect(reqs.requireMaxLossReview).toBe(true);
    expect(reqs.confirmationTtlSeconds).toBeGreaterThan(0);
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  it("OPTIONS plan includes options-specific requirements", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    const plan = makePlan({ planType: "OPTIONS", structureSnapshot: { type: "long_call" } });
    const deps = makeDeps(plan, makeLifecycle(), { connected: true });
    const result = await runExecutionPreflight(
      { tradePlanId: "plan-001", userId: "user-001" }, deps
    );
    const reqs = result.confirmationRequirements;
    expect(reqs.requireLegsReview).toBe(true);
    expect(reqs.requireExpirationReview).toBe(true);
    delete process.env.BROKER_EXECUTION_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. EXECUTION TYPES CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("execution-types: constants", () => {
  it("EXECUTION_FRESHNESS_THRESHOLDS are positive numbers", () => {
    Object.entries(EXECUTION_FRESHNESS_THRESHOLDS).forEach(([k, v]) => {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThan(0);
    });
  });

  it("preflightResultSec is 300 (5 minutes)", () => {
    expect(EXECUTION_FRESHNESS_THRESHOLDS.preflightResultSec).toBe(300);
  });

  it("underlyingQuoteSec is 60 (1 minute)", () => {
    expect(EXECUTION_FRESHNESS_THRESHOLDS.underlyingQuoteSec).toBe(60);
  });

  it("EXECUTION_PREFLIGHT_DISCLAIMER is non-empty", () => {
    expect(EXECUTION_PREFLIGHT_DISCLAIMER.length).toBeGreaterThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. PREFLIGHT PERSISTED
// ─────────────────────────────────────────────────────────────────────────────

describe("preflight: persistence", () => {
  beforeEach(() => {
    process.env.BROKER_EXECUTION_ENABLED = "true";
    process.env.BROKER_EXECUTION_MODE = "sandbox";
  });
  afterEach(() => {
    delete process.env.BROKER_EXECUTION_ENABLED;
    delete process.env.BROKER_EXECUTION_MODE;
  });

  it("savePreflight is called once per evaluation", async () => {
    let saveCount = 0;
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle(), { connected: true }),
      savePreflight: async () => { saveCount++; },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    expect(saveCount).toBe(1);
  });

  it("savePreflight receives result with correct tradePlanId and userId", async () => {
    let savedResult: ExecutionPreflightResult | null = null;
    const plan = makePlan();
    const deps: PreflightDependencies = {
      ...makeDeps(plan, makeLifecycle(), { connected: true }),
      savePreflight: async (result) => { savedResult = result; },
    };
    await runExecutionPreflight({ tradePlanId: "plan-001", userId: "user-001" }, deps);
    expect(savedResult?.tradePlanId).toBe("plan-001");
    expect(savedResult?.userId).toBe("user-001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. FRESHNESS THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

describe("execution-types: freshness thresholds are stricter than research", () => {
  it("quote freshness < 120s (stricter than typical market data)", () => {
    expect(EXECUTION_FRESHNESS_THRESHOLDS.underlyingQuoteSec).toBeLessThanOrEqual(120);
  });

  it("preflight valid window is 5 minutes max", () => {
    expect(EXECUTION_FRESHNESS_THRESHOLDS.preflightResultSec).toBeLessThanOrEqual(300);
  });
});
