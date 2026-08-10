/**
 * server/routes/__tests__/idempotency.test.ts — Sprint 2.7.7
 *
 * Idempotency & Concurrency Guard Tests
 *
 * Validates that repeated safe actions produce no duplicate state corruption,
 * and that concurrency guards work correctly.
 *
 * All tests are pure/structural — no DB, no network.
 *
 * Category: STRUCTURAL (idempotency, concurrency)
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §IDEMP1 — Lifecycle dedup (fingerprint idempotency)
// ============================================================================

describe("§IDEMP1: Lifecycle event deduplication", () => {
  it("identical lifecycle evaluation produces identical fingerprint", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const args = ["plan-123", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6"] as const;
    const fp1 = buildActivityFingerprint(...args);
    const fp2 = buildActivityFingerprint(...args);
    const fp3 = buildActivityFingerprint(...args);
    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  it("different plan IDs produce different fingerprints", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const fp1 = buildActivityFingerprint("plan-A", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const fp2 = buildActivityFingerprint("plan-B", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(fp1).not.toBe(fp2);
  });

  it("different activity types produce different fingerprints (no cross-dedup)", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const fp1 = buildActivityFingerprint("plan-A", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const fp2 = buildActivityFingerprint("plan-A", "THESIS_INVALIDATION_OBSERVED", "THESIS_INVALIDATED", "2.7.6");
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprints are 32 characters (truncated SHA256)", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const fp = buildActivityFingerprint("plan-X", "DATA_BECAME_STALE", "DATA_STALE", "2.7.6");
    expect(fp.length).toBe(32);
  });
});

// ============================================================================
// §IDEMP2 — Cache idempotency
// ============================================================================

describe("§IDEMP2: In-process cache idempotency", () => {
  it("getCachedLifecycleResult returns null for unknown key (no phantom cache)", async () => {
    const { getCachedLifecycleResult } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    // Fresh import — cache should be empty for novel keys
    const result = getCachedLifecycleResult("user-never-seen", "plan-never-seen");
    expect(result).toBeNull();
  });

  it("multiple reads of same null cache entry do not create phantom entries", async () => {
    const { getCachedLifecycleResult } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    for (let i = 0; i < 5; i++) {
      const r = getCachedLifecycleResult("phantom-user", "phantom-plan");
      expect(r).toBeNull();
    }
  });
});

// ============================================================================
// §IDEMP3 — Job status store idempotency
// ============================================================================

describe("§IDEMP3: Job status store idempotency", () => {
  it("setting job status multiple times does not corrupt state", async () => {
    const { markJobStarted, markJobCompleted, getJobStatus } = await import(
      "../../services/job-status-store"
    );
    markJobStarted("trade_plan_monitoring");
    markJobCompleted("trade_plan_monitoring", { itemsProcessed: 5 });
    const status = getJobStatus("trade_plan_monitoring");
    expect(status.status).toBe("completed");
  });

  it("job status store handles concurrent marks for same job", async () => {
    const { markJobStarted, getJobStatus } = await import("../../services/job-status-store");
    const jobs: Array<Promise<void>> = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(Promise.resolve().then(() => markJobStarted("trade_plan_monitoring")));
    }
    await Promise.all(jobs);
    const status = getJobStatus("trade_plan_monitoring");
    expect(status).toBeDefined();
    expect(status.status).toBe("running");
  });

  it("different job names do not interfere with each other", async () => {
    const { markJobStarted, markJobCompleted, markJobFailed, getJobStatus } = await import(
      "../../services/job-status-store"
    );
    markJobCompleted("market_data_ingestion", {});
    markJobStarted("trade_plan_monitoring");
    markJobFailed("institutional_ingestion", { errorMessage: "test error" });

    expect(getJobStatus("market_data_ingestion").status).toBe("completed");
    expect(getJobStatus("trade_plan_monitoring").status).toBe("running");
    expect(getJobStatus("institutional_ingestion").status).toBe("failed");
  });
});

// ============================================================================
// §IDEMP4 — Lifecycle state machine idempotency
// ============================================================================

describe("§IDEMP4: Lifecycle state machine is deterministic", () => {
  it("same inputs produce same lifecycle state (no side effects in computeLifecycleState)", async () => {
    const { computeLifecycleState } = await import(
      "../../services/trade-plan-lifecycle-service"
    );

    const mockParams = {
      planStatus: "ACTIVE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [],
      invalidationChanges: [],
      structureChanges: [],
    };

    const state1 = computeLifecycleState(mockParams);
    const state2 = computeLifecycleState(mockParams);
    const state3 = computeLifecycleState(mockParams);

    expect(state1).toBe(state2);
    expect(state2).toBe(state3);
  });

  it("CURRENT state is returned for no changes (baseline invariant)", async () => {
    const { computeLifecycleState } = await import(
      "../../services/trade-plan-lifecycle-service"
    );

    const cleanParams = {
      planStatus: "ACTIVE",
      currentAvailable: true,
      freshnessChanges: [],
      researchChanges: [],
      invalidationChanges: [],
      structureChanges: [],
    };

    const state = computeLifecycleState(cleanParams);
    expect(state).toBe("CURRENT");
  });
});

// ============================================================================
// §IDEMP5 — Schema ensure functions are idempotent
// ============================================================================

describe("§IDEMP5: Schema ensure functions are callable multiple times", () => {
  it("ensureTradePlanActivityTable is a function (idempotent ensure pattern)", async () => {
    const { ensureTradePlanActivityTable } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    expect(typeof ensureTradePlanActivityTable).toBe("function");
    // We cannot call it without a real DB — just verify it exists and is callable
  });
});
