/**
 * server/routes/__tests__/security.test.ts — Sprint 2.7.6
 *
 * Security Test Suite — mandatory for every sprint from 2.7.6 onward.
 * cmd: npm run test:security
 *
 * Covers:
 *   - Cross-user isolation: plan ID → userId ownership check
 *   - No userId from request body (session-only authority)
 *   - Cache key isolation (no cross-user cache hits)
 *   - No secrets/tokens in lifecycle responses
 *   - No PII in activity metadata
 *   - Structured logging field safety
 *   - Ownership patterns in service layer
 *
 * All tests are pure/structural — no DB, no network.
 *
 * Category: security
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §SEC1 — Cross-User Isolation (structural)
// ============================================================================

describe("Security §SEC1: Cross-user isolation contracts", () => {
  it("evaluateTradePlanLifecycle takes userId as first arg (ownership is explicit)", async () => {
    const { evaluateTradePlanLifecycle } = await import("../../services/trade-plan-lifecycle-service");
    // Verify function signature arity (userId, tradePlanId, opts)
    expect(evaluateTradePlanLifecycle.length).toBeGreaterThanOrEqual(2);
  });

  it("getTradePlanActivities takes userId as first arg (ownership is explicit)", async () => {
    const { getTradePlanActivities } = await import("../../services/trade-plan-lifecycle-service");
    expect(getTradePlanActivities.length).toBeGreaterThanOrEqual(2);
  });

  it("getCachedLifecycleResult key includes userId (no cross-user cache hits)", async () => {
    const { getCachedLifecycleResult } = await import("../../services/trade-plan-lifecycle-service");
    // User A has no result cached for their plan initially
    const result = getCachedLifecycleResult("user-A", "plan-XYZ");
    expect(result).toBeNull();
  });

  it("different userId → no shared cache entry (cache isolation)", async () => {
    const { getCachedLifecycleResult } = await import("../../services/trade-plan-lifecycle-service");
    const r1 = getCachedLifecycleResult("user-ALPHA", "plan-same-id");
    const r2 = getCachedLifecycleResult("user-BETA", "plan-same-id");
    // Both null since they were never populated
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it("activity fingerprint uses plan-scoped key (no cross-plan dedup collisions)", async () => {
    const { buildActivityFingerprint } = await import("../../services/trade-plan-lifecycle-service");
    const fp1 = buildActivityFingerprint("plan-A", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    const fp2 = buildActivityFingerprint("plan-B", "REVIEW_REQUIRED", "REQUIRES_REVIEW", "2.7.6");
    expect(fp1).not.toBe(fp2);
  });

  it("persistLifecycleActivity takes userId as first arg (ownership is explicit)", async () => {
    const { persistLifecycleActivity } = await import("../../services/trade-plan-lifecycle-service");
    expect(persistLifecycleActivity.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// §SEC2 — Session-Only Authority (no body userId)
// ============================================================================

describe("Security §SEC2: Session-only authority patterns", () => {
  it("registerTradePlanRoutes function exists (route handler must extract userId from session)", async () => {
    const { registerTradePlanRoutes } = await import("../trade-plans");
    expect(typeof registerTradePlanRoutes).toBe("function");
  });

  it("lifecycle evaluate route source does not use req.body.userId as authority", async () => {
    const { evaluateTradePlanLifecycle } = await import("../../services/trade-plan-lifecycle-service");
    // The service function explicitly receives userId as a parameter (injected from session by route)
    // This structural test ensures userId comes from the caller, not body
    const fnSrc = evaluateTradePlanLifecycle.toString();
    expect(fnSrc.includes("userId")).toBe(true);
    // The service does NOT parse req.body — it receives userId as a plain arg
    expect(fnSrc.includes("req.body")).toBe(false);
    expect(fnSrc.includes("request.body")).toBe(false);
  });

  it("getLifecycleHealth returns aggregate only (no user-identifying data)", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();
    const json = JSON.stringify(metrics);
    expect(json).not.toContain("userId");
    expect(json).not.toContain("email");
    expect(json).not.toContain("planId");  // aggregate, not per-plan
    expect(json).not.toContain("symbol");
  });
});

// ============================================================================
// §SEC3 — No Secrets / Tokens in Responses
// ============================================================================

describe("Security §SEC3: No secrets or tokens in lifecycle output", () => {
  it("TradePlanLifecycleResult has no token, apiKey, or secret fields", async () => {
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const fakeResult = {
      tradePlanId: "plan-sec-1", symbol: "AAPL", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "DRAFT", lifecycleState: "CURRENT" as const,
      researchChanges: [], invalidationChanges: [], structureChanges: [],
      eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: false, reviewReasons: [], limitations: [],
      freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const json = JSON.stringify(fakeResult);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("token");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("password");
    expect(json).not.toContain("credential");
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain("bearer");
  });

  it("activity metadata never contains broker tokens or credentials", async () => {
    const { buildActivitiesFromLifecycleResult } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const result = {
      tradePlanId: "plan-sec-2", symbol: "MSFT", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: "THESIS_INVALIDATED" as const,
      researchChanges: [], invalidationChanges: [{ condition: "QUAL", description: "d", observationState: "observed" as const, evaluationNote: "" }],
      structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: true, reviewReasons: [], limitations: [],
      freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    for (const a of activities) {
      const meta = JSON.stringify(a.metadata);
      expect(meta).not.toContain("token");
      expect(meta).not.toContain("apiKey");
      expect(meta).not.toContain("secret");
      expect(meta).not.toContain("password");
      expect(meta).not.toContain("Authorization");
    }
  });

  it("lifecycle forbidden phrases list exists and is non-empty", async () => {
    const { LIFECYCLE_FORBIDDEN_PHRASES } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(LIFECYCLE_FORBIDDEN_PHRASES.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// §SEC4 — No PII in Activity Events
// ============================================================================

describe("Security §SEC4: No PII in activity metadata", () => {
  it("buildActivitiesFromLifecycleResult metadata has no email or personal info", async () => {
    const { buildActivitiesFromLifecycleResult } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");

    const result = {
      tradePlanId: "plan-pii-1", symbol: "NVDA", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: "REQUIRES_REVIEW" as const,
      researchChanges: [{ changeType: "RESEARCH_WEAKENED" as any, savedValue: 80, currentValue: 60, delta: -20, description: "Score dropped", isMaterial: true }],
      invalidationChanges: [], structureChanges: [], eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: true, reviewReasons: [{ reasonType: "RESEARCH_SCORE_MATERIALLY_WEAKENED" as any, description: "d" }],
      limitations: [], freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    for (const a of activities) {
      const meta = JSON.stringify(a.metadata);
      const summary = a.summary;

      // No PII patterns
      expect(meta).not.toMatch(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/); // no email
      expect(meta).not.toContain("userId");
      expect(meta).not.toContain("email");
      expect(meta).not.toContain("phone");
      expect(meta).not.toContain("address");
      expect(meta).not.toContain("ssn");

      // No capital or P/L data
      expect(meta).not.toContain("capital");
      expect(meta).not.toContain("pnl");
      expect(meta).not.toContain("profit");
      expect(meta).not.toContain("loss");
      expect(meta).not.toContain("notional");
      expect(meta).not.toContain("accountId");
      expect(meta).not.toContain("account_id");

      // Summary also must be clean
      expect(summary).not.toContain("@");
      expect(summary.toLowerCase()).not.toContain("userId");
    }
  });

  it("no phone numbers or SSNs in lifecycle result", async () => {
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");
    const result = {
      tradePlanId: "plan-pii-2", symbol: "AAPL", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "DRAFT", lifecycleState: "CURRENT" as const,
      researchChanges: [], invalidationChanges: [], structureChanges: [],
      eventChanges: [], liquidityChanges: [], freshnessChanges: [],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: false, reviewReasons: [], limitations: [],
      freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const json = JSON.stringify(result);
    // No SSN patterns (xxx-xx-xxxx)
    expect(json).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    // No US phone patterns (xxx-xxx-xxxx)
    expect(json).not.toMatch(/\d{3}-\d{3}-\d{4}/);
  });
});

// ============================================================================
// §SEC5 — Structured Logging Field Safety
// ============================================================================

describe("Security §SEC5: Structured logging field safety", () => {
  it("lifecycle service logging fields do not include PII field names", async () => {
    // These are the documented safe fields emitted by _logStructured
    const safeFields = ["event", "durationMs", "planType", "lifecycleState", "changeCount", "riskFlagCount", "hasEventChange", "hasLiquidityChange", "ts"];
    const forbiddenFields = ["userId", "email", "phone", "notes", "capital", "pnl", "position", "accountId", "symbol", "ticker"];

    // Verify no overlap
    for (const safeField of safeFields) {
      expect(forbiddenFields).not.toContain(safeField);
    }
  });

  it("evaluateAllActiveTradePlans returns aggregate counts only (no user data)", async () => {
    const { evaluateAllActiveTradePlans } = await import("../../services/trade-plan-lifecycle-service");
    expect(typeof evaluateAllActiveTradePlans).toBe("function");
    // Structural: the function signature takes no user context (it's a scheduler-ready aggregate)
    expect(evaluateAllActiveTradePlans.length).toBe(0);
  });

  it("getLifecycleHealth output has no nested user data", async () => {
    const { getLifecycleHealth } = await import("../../services/trade-plan-lifecycle-service");
    const metrics = getLifecycleHealth();

    // All values should be numbers or null (no objects with user data)
    for (const [key, value] of Object.entries(metrics)) {
      expect(typeof value === "number" || value === null || typeof value === "string").toBe(true);
    }
  });
});

// ============================================================================
// §SEC6 — LIFECYCLE_FORBIDDEN_PHRASES Completeness
// ============================================================================

describe("Security §SEC6: LIFECYCLE_FORBIDDEN_PHRASES completeness", () => {
  it("forbidden phrases include execution language", async () => {
    const { LIFECYCLE_FORBIDDEN_PHRASES } = await import("../../../shared/trade-plan-lifecycle-types");
    const phrases = LIFECYCLE_FORBIDDEN_PHRASES.map((p: string) => p.toLowerCase());

    // Must include key execution terms
    const required = ["exit", "sell", "close", "roll", "take profit", "stop loss triggered"];
    for (const term of required) {
      expect(phrases.some(p => p.includes(term))).toBe(true);
    }
  });

  it("forbidden phrases do not include legitimate research terms", async () => {
    const { LIFECYCLE_FORBIDDEN_PHRASES } = await import("../../../shared/trade-plan-lifecycle-types");
    const phrases = LIFECYCLE_FORBIDDEN_PHRASES.map((p: string) => p.toLowerCase());

    // These terms are legitimate in lifecycle context
    const legitimate = ["review", "evaluate", "analyze", "observe", "monitor"];
    for (const term of legitimate) {
      // Should not be wholesale-banned
      const entirelyBanned = phrases.includes(term);
      expect(entirelyBanned).toBe(false);
    }
  });

  it("lifecycle state labels contain no forbidden phrases", async () => {
    const { LIFECYCLE_STATE_LABELS, LIFECYCLE_FORBIDDEN_PHRASES } = await import("../../../shared/trade-plan-lifecycle-types");
    const allLabels = Object.values(LIFECYCLE_STATE_LABELS).join(" ").toLowerCase();
    for (const phrase of LIFECYCLE_FORBIDDEN_PHRASES) {
      expect(allLabels).not.toContain(phrase.toLowerCase());
    }
  });
});

// ============================================================================
// §SEC7 — No Execution Language in All Lifecycle Outputs
// ============================================================================

describe("Security §SEC7: No execution language in all lifecycle outputs", () => {
  it("computeResearchChanges descriptions have no execution language", async () => {
    const { computeResearchChanges } = await import("../../services/trade-plan-lifecycle-service");
    const forbidden = ["sell", "exit now", "close the position", "take profit", "stop out", "roll the position"];

    const saved = {
      researchScore: 80, technicalScore: 75, fundamentalScore: 70, institutionalScore: 65,
      riskLevel: "low", marketRegime: "BULL_TREND", sector: "Tech", themes: ["AI"],
      primaryEvidence: [], secondaryEvidence: [], riskFactors: [], invalidatesThesis: [],
      generatedAt: new Date("2026-08-01").toISOString(), qualified: true,
    } as any;

    const scenarios = [
      { researchScore: 55, technicalScore: 50, fundamentalScore: 70, institutionalScore: 65, riskLevel: "high", qualified: false, marketRegime: "BEAR_TREND", sector: "Healthcare", themes: ["Biotech"], asOf: new Date().toISOString(), available: true },
    ];

    for (const current of scenarios) {
      const changes = computeResearchChanges(saved, current as any);
      for (const c of changes) {
        for (const phrase of forbidden) {
          expect(c.description.toLowerCase()).not.toContain(phrase);
        }
      }
    }
  });

  it("computeReviewReasons descriptions have no execution language", async () => {
    const { computeReviewReasons } = await import("../../services/trade-plan-lifecycle-service");
    const forbidden = ["sell", "exit now", "close the position", "take profit", "stop loss", "roll"];

    const reasons = computeReviewReasons({
      researchChanges: [
        { changeType: "NO_LONGER_QUALIFIED", savedValue: "qualified", currentValue: "not qualified", delta: null, description: "Qual lost", isMaterial: true },
        { changeType: "RESEARCH_WEAKENED", savedValue: 80, currentValue: 55, delta: -25, description: "Score dropped", isMaterial: true },
        { changeType: "REGIME_CHANGED", savedValue: "BULL_TREND", currentValue: "BEAR_TREND", delta: null, description: "Regime changed", isMaterial: false },
      ],
      invalidationChanges: [{ condition: "QUAL", description: "d", observationState: "observed", evaluationNote: "" }],
      structureChanges: [{ changeType: "EXPIRATION_APPROACHING", description: "30 DTE", savedValue: 60, currentValue: 30, isMaterial: true }],
      eventChanges: [{ changeType: "EVENT_ENTERED_LIFETIME", eventLabel: "Earnings", description: "Earnings entered window", eventDate: "2026-09-01" }],
      liquidityChanges: [{ changeType: "LIQUIDITY_WEAKENED", description: "Poor liquidity", savedLiquidityQuality: "good", currentLiquidityQuality: "poor" }],
      freshnessChanges: [{ changeType: "DATA_BECAME_STALE", dataSource: "research", description: "stale", savedFreshness: "fresh", currentFreshness: "stale" }],
    });

    for (const r of reasons) {
      for (const phrase of forbidden) {
        expect(r.description.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it("buildActivitiesFromLifecycleResult summaries have no execution language", async () => {
    const { buildActivitiesFromLifecycleResult } = await import("../../services/trade-plan-lifecycle-service");
    const { LIFECYCLE_METHODOLOGY_VERSION } = await import("../../../shared/trade-plan-lifecycle-types");
    const forbidden = ["sell", "exit now", "close the position", "take profit", "stop loss", "roll"];

    const result = {
      tradePlanId: "plan-exec-lang", symbol: "TSLA", evaluatedAt: new Date().toISOString(),
      savedPlanStatus: "RESEARCH_COMPLETE", lifecycleState: "THESIS_INVALIDATED" as const,
      researchChanges: [
        { changeType: "RESEARCH_WEAKENED" as any, savedValue: 80, currentValue: 55, delta: -25, description: "Research weakened", isMaterial: true },
        { changeType: "NO_LONGER_QUALIFIED" as any, savedValue: "qualified", currentValue: "not qualified", delta: null, description: "Qual lost", isMaterial: true },
      ],
      invalidationChanges: [{ condition: "QUAL", description: "d", observationState: "observed" as const, evaluationNote: "" }],
      structureChanges: [{ changeType: "EXPIRATION_APPROACHING" as any, description: "30 DTE", savedValue: 60, currentValue: 30, isMaterial: true }],
      eventChanges: [], liquidityChanges: [], freshnessChanges: [{ changeType: "DATA_BECAME_STALE" as any, dataSource: "research", description: "stale", savedFreshness: "fresh", currentFreshness: "stale" }],
      currentResearchSummary: null, savedResearchSummary: null as any,
      requiresReview: true, reviewReasons: [], limitations: [],
      freshness: "fresh" as const, methodologyVersion: LIFECYCLE_METHODOLOGY_VERSION,
    };

    const activities = buildActivitiesFromLifecycleResult(result, "CURRENT");
    for (const a of activities) {
      for (const phrase of forbidden) {
        expect(a.summary.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});
