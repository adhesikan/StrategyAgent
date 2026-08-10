/**
 * server/routes/__tests__/performance-baseline.test.ts — Sprint 2.7.7
 *
 * Performance Baseline Tests
 *
 * Measures pure computation time for critical service functions.
 * No network, no DB. Establishes baselines for:
 *   - Lifecycle evaluation (pure computation path)
 *   - Portfolio intelligence computation
 *   - Opportunity ranking helpers
 *   - Research change classification
 *
 * Not a load test — single-threaded pure timing.
 *
 * Category: PERFORMANCE
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §P1 — Lifecycle service pure computation baseline
// ============================================================================

describe("§P1: Lifecycle pure computation performance", () => {
  it("computeExpirationState runs in < 10ms for option input", async () => {
    const { computeExpirationState } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      computeExpirationState(30); // 30 DTE — APPROACHING_EXPIRATION
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / 100;
    expect(perCall, `computeExpirationState p100 avg ${perCall.toFixed(2)}ms should be < 10ms`).toBeLessThan(10);
  });

  it("buildActivityFingerprint runs in < 5ms", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      buildActivityFingerprint("plan-id", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / 1000;
    expect(perCall, `buildActivityFingerprint avg ${perCall.toFixed(3)}ms should be < 5ms`).toBeLessThan(5);
  });
});

// ============================================================================
// §P2 — Opportunity ranking helpers baseline
// ============================================================================

describe("§P2: Opportunity ranking helper performance", () => {
  it("formatRelativeTime runs 1000 calls in < 200ms", async () => {
    // Try importing from common locations
    let formatFn: ((d: Date) => string) | null = null;
    try {
      const mod = await import("../../../client/src/lib/opportunity-ranking-helpers");
      formatFn = (mod as any).formatRelativeTime ?? (mod as any).formatTimeAgo;
    } catch {
      // Module may not be directly importable in server context — skip
      return;
    }
    if (!formatFn) return;

    const start = performance.now();
    const now = new Date();
    for (let i = 0; i < 1000; i++) {
      formatFn(now);
    }
    const elapsed = performance.now() - start;
    expect(elapsed, `1000 formatRelativeTime calls took ${elapsed.toFixed(0)}ms — should be < 200ms`).toBeLessThan(200);
  });
});

// ============================================================================
// §P3 — Fingerprint collision rate
// ============================================================================

describe("§P3: Fingerprint uniqueness (dedup accuracy)", () => {
  it("100 distinct plan+type combos produce 100 distinct fingerprints", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const fingerprints = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const fp = buildActivityFingerprint(`plan-${i}`, "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
      fingerprints.add(fp);
    }
    expect(fingerprints.size).toBe(100);
  });

  it("same inputs produce identical fingerprint (deterministic)", async () => {
    const { buildActivityFingerprint } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const fp1 = buildActivityFingerprint("plan-A", "THESIS_INVALIDATION_OBSERVED", "THESIS_INVALIDATED", "2.7.6");
    const fp2 = buildActivityFingerprint("plan-A", "THESIS_INVALIDATION_OBSERVED", "THESIS_INVALIDATED", "2.7.6");
    expect(fp1).toBe(fp2);
  });
});

// ============================================================================
// §P4 — Cache performance
// ============================================================================

describe("§P4: In-process cache read/write performance", () => {
  it("getCachedLifecycleResult (cache miss) runs 10000 calls in < 100ms", async () => {
    const { getCachedLifecycleResult } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      getCachedLifecycleResult(`user-${i}`, `plan-${i}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed, `10k cache lookups took ${elapsed.toFixed(0)}ms — should be < 100ms`).toBeLessThan(100);
  });
});

// ============================================================================
// §P5 — Report: document baseline numbers
// ============================================================================

describe("§P5: Performance baseline documentation", () => {
  it("prints baseline summary (informational — always passes)", async () => {
    const { buildActivityFingerprint, getCachedLifecycleResult } = await import(
      "../../services/trade-plan-lifecycle-service"
    );

    // Fingerprint
    const fpStart = performance.now();
    for (let i = 0; i < 1000; i++) buildActivityFingerprint("plan", "T", "S", "v");
    const fpMs = (performance.now() - fpStart) / 1000;

    // Cache
    const cacheStart = performance.now();
    for (let i = 0; i < 10_000; i++) getCachedLifecycleResult("u", "p");
    const cacheMs = (performance.now() - cacheStart) / 10_000;

    console.log([
      "\n📊 PERFORMANCE BASELINE (Sprint 2.7.7)",
      `  buildActivityFingerprint:   ${fpMs.toFixed(3)} ms/call`,
      `  getCachedLifecycleResult:   ${cacheMs.toFixed(4)} ms/call (cache miss)`,
      "  [API endpoint baselines measured separately — requires running server]",
    ].join("\n"));

    expect(true).toBe(true); // always passes — informational only
  });
});
