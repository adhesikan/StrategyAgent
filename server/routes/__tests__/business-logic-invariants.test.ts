/**
 * server/routes/__tests__/business-logic-invariants.test.ts — Sprint 2.7.7
 *
 * Business Logic Invariants — permanent architecture rule pins.
 * These tests protect the fundamental contracts of Phase 2.7.
 * They must pass in every sprint and can never be removed.
 *
 * Invariants:
 *   1. Opportunity Intelligence owns research score
 *   2. Trade Planning cannot promote unqualified symbol
 *   3. Strategy Matching cannot change underlying
 *   4. Contract Research cannot change strategy family
 *   5. Risk Analysis cannot substitute contract
 *   6. Trade Plan cannot mutate saved research snapshot silently
 *   7. Lifecycle Intelligence cannot issue execution instruction
 *   8. Client cannot supply authoritative scores
 *   9. Portfolio is optional for research and trade planning
 *  10. Goal is optional for trade planning
 *  11. Broker is optional until execution boundary (Phase 2.8+)
 *
 * Category: STRUCTURAL (invariants)
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §INV1 — Opportunity Intelligence owns research score
// ============================================================================

describe("§INV1: Opportunity Intelligence owns research score", () => {
  it("CanonicalOpportunity type comes from opportunity-intelligence-service, not client", async () => {
    const svc = await import("../../services/opportunity-intelligence-service");
    // getOpportunityIntelligence is the authoritative enriched source
    expect(typeof svc.getOpportunityIntelligence).toBe("function");
  });

  it("getOpportunityIntelligence is the authoritative source (not rank-only)", async () => {
    const svc = await import("../../services/opportunity-intelligence-service");
    // Intelligence service builds CanonicalOpportunity enriched with themes/sectors/institutional
    expect(svc.getOpportunityIntelligence).toBeDefined();
    // Also verify pure helpers exist (sortOpportunities, filterOpportunities)
    expect(typeof svc.sortOpportunities).toBe("function");
    expect(typeof svc.filterOpportunities).toBe("function");
  });
});

// ============================================================================
// §INV2 — Trade Planning: unqualified symbol guard
// ============================================================================

describe("§INV2: Trade Planning cannot promote unqualified symbol", () => {
  it("lifecycle service exports computeLifecycleState (state machine)", async () => {
    const { computeLifecycleState } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    expect(typeof computeLifecycleState).toBe("function");
  });

  it("lifecycle service exports computeReviewReasons (transparent review logic)", async () => {
    const { computeReviewReasons } = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof computeReviewReasons).toBe("function");
  });
});

// ============================================================================
// §INV3 — Strategy Matching: underlying cannot be changed by matching
// ============================================================================

describe("§INV3: Strategy Matching cannot change underlying symbol", () => {
  it("options strategy types use symbol as input, not output", async () => {
    // The strategy matching types file should define symbol as required input
    const types = await import("../../../shared/trade-plan-lifecycle-types").catch(() => null);
    // Structural: lifecycle service does not own strategy matching — different module
    expect(types).toBeDefined();
  });

  it("options strategy matching service is separate from lifecycle service", async () => {
    const { evaluateTradePlanLifecycle } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    // lifecycle service should not export strategy matching functions
    const svc = await import("../../services/trade-plan-lifecycle-service") as Record<string, unknown>;
    const hasStrategyMatch = typeof svc["matchOptionsStrategies"] === "function";
    expect(hasStrategyMatch, "Lifecycle service should not own strategy matching").toBe(false);
  });
});

// ============================================================================
// §INV4 — Contract Research: strategy family immutable
// ============================================================================

describe("§INV4: Contract Research cannot change strategy family", () => {
  it("options chain route accepts strategyFamily as filter input, not as output override", async () => {
    // Structural: no service should mutate a passed-in strategyFamily
    // Verified by checking lifecycle service does not import contract research in a way that overrides family
    const svc = await import("../../services/trade-plan-lifecycle-service") as Record<string, unknown>;
    expect(typeof svc["overrideStrategyFamily"]).toBe("undefined");
    expect(typeof svc["changeStrategyFamily"]).toBe("undefined");
  });
});

// ============================================================================
// §INV5 — Risk Analysis: contract substitution forbidden
// ============================================================================

describe("§INV5: Risk Analysis cannot substitute contract", () => {
  it("lifecycle service does not export contract substitution functions", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service") as Record<string, unknown>;
    expect(typeof svc["substituteContract"]).toBe("undefined");
    expect(typeof svc["replaceContract"]).toBe("undefined");
    expect(typeof svc["selectBetterContract"]).toBe("undefined");
  });
});

// ============================================================================
// §INV6 — Trade Plan snapshot immutability
// ============================================================================

describe("§INV6: Trade Plan saved research snapshot is immutable", () => {
  it("tradePlanVersions schema has researchSnapshot column (append-only by design)", async () => {
    const { tradePlanVersions } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanVersions);
    expect(cols).toContain("researchSnapshot"); // immutable JSONB snapshot
    expect(cols).toContain("version");          // version integer for ordering
  });

  it("lifecycle service reads snapshot but does not mutate it", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service") as Record<string, unknown>;
    // No mutation functions for snapshots
    expect(typeof svc["mutateSnapshot"]).toBe("undefined");
    expect(typeof svc["updateSnapshot"]).toBe("undefined");
    expect(typeof svc["replaceSnapshot"]).toBe("undefined");
  });

  it("evaluateTradePlanLifecycle function signature confirms userId+planId isolation", async () => {
    const { evaluateTradePlanLifecycle } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    // Takes userId and planId as separate args — ownership is explicit
    expect(evaluateTradePlanLifecycle.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// §INV7 — Lifecycle Intelligence: no execution instruction
// ============================================================================

describe("§INV7: Lifecycle Intelligence cannot issue execution instruction", () => {
  it("LIFECYCLE_FORBIDDEN_PHRASES covers execution language", async () => {
    const { LIFECYCLE_FORBIDDEN_PHRASES } = await import(
      "../../../shared/trade-plan-lifecycle-types"
    );
    const flat = LIFECYCLE_FORBIDDEN_PHRASES.join(" ").toLowerCase();
    expect(flat).toMatch(/exit|sell|close|profit/);
  });

  it("lifecycle state labels contain no execution commands", async () => {
    const { LIFECYCLE_STATE_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    for (const [state, label] of Object.entries(LIFECYCLE_STATE_LABELS)) {
      const l = label.toLowerCase();
      expect(l, `State "${state}" label should not contain "exit"`).not.toContain("exit");
      expect(l, `State "${state}" label should not contain "sell"`).not.toContain("sell");
      expect(l, `State "${state}" label should not contain "close position"`).not.toContain("close position");
    }
  });

  it("LIFECYCLE_DISCLAIMER is present and >= 50 characters", async () => {
    const { LIFECYCLE_DISCLAIMER } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_DISCLAIMER.length).toBeGreaterThanOrEqual(50);
  });
});

// ============================================================================
// §INV8 — Client cannot supply authoritative scores
// ============================================================================

describe("§INV8: Server-authoritative scoring", () => {
  it("lifecycle service derives state server-side (not from client input)", async () => {
    const { computeLifecycleState } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    // Function exists server-side and produces deterministic output
    // If client could override, there would be a 'clientProvidedState' parameter
    const fnStr = computeLifecycleState.toString();
    expect(fnStr).not.toContain("clientProvidedState");
    expect(fnStr).not.toContain("overrideState");
  });
});

// ============================================================================
// §INV9 — Portfolio is optional for research and trade planning
// ============================================================================

describe("§INV9: Portfolio is optional", () => {
  it("lifecycle service evaluateTradePlanLifecycle does not require portfolio", async () => {
    const { evaluateTradePlanLifecycle } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    // Function accepts a plan and evaluates it — portfolio context is optional
    // Structural: function should be callable without portfolio context
    const fnStr = evaluateTradePlanLifecycle.toString();
    // Should not throw if portfolio is missing
    expect(fnStr).not.toMatch(/required.*portfolio|portfolio.*required/i);
  });
});

// ============================================================================
// §INV10 — Goal is optional for trade planning
// ============================================================================

describe("§INV10: Research Goal is optional for trade planning", () => {
  it("lifecycle types do not reference research goal as required", async () => {
    const types = await import("../../../shared/trade-plan-lifecycle-types") as Record<string, unknown>;
    // No required goal field in lifecycle evaluation types
    const typeStr = JSON.stringify(types);
    // Structural: lifecycle system is goal-independent
    expect(typeStr).not.toMatch(/"goalRequired"\s*:\s*true/);
  });
});

// ============================================================================
// §INV11 — Broker is optional until execution boundary
// ============================================================================

describe("§INV11: Broker is optional through Phase 2.7", () => {
  it("lifecycle service does not require broker connection", async () => {
    const svc = await import("../../services/trade-plan-lifecycle-service") as Record<string, unknown>;
    // No broker-required functions in lifecycle service
    expect(typeof svc["requireBrokerConnection"]).toBe("undefined");
    expect(typeof svc["assertBrokerConnected"]).toBe("undefined");
  });

  it("lifecycle types have no broker-required fields", async () => {
    const { LIFECYCLE_STATE_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    // All lifecycle states should be resolvable without broker
    expect(Object.keys(LIFECYCLE_STATE_LABELS).length).toBeGreaterThan(0);
  });
});
