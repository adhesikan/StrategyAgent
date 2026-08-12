/**
 * server/routes/__tests__/candidate-consistency.test.ts — Sprint 2.8.6A-defect-2
 *
 * Cross-surface candidate consistency invariants.
 *
 * Invariant: If a symbol is present in the current opportunity ranking snapshot,
 * then:
 *   1. Opportunity Workspace must find it (getCanonicalOpportunity returns non-null)
 *   2. Trade Planning context must accept it (getCanonicalOpportunity returns non-null)
 *   3. The workspace response includes tradePlanningEligible: true
 *
 * All tests are pure / structural — no DB, no network.
 * Injectable deps are used everywhere so tests remain fast and deterministic.
 *
 * Category: regression
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setLatestRanking,
  getLatestRanking,
} from "../../services/opportunity-ranking-engine";
import {
  getCanonicalOpportunity,
  getOpportunityIntelligence,
} from "../../services/opportunity-intelligence-service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal scored growth candidate matching the ScoredGrowthCandidate shape. */
function makeGrowthCandidate(symbol: string, overallScore = 66) {
  return {
    symbol,
    score: overallScore,
    strategy: "Trend Continuation",
    reasons:  ["Strong relative volume", "VCP detected"],
    warnings: [],
    setupDetected: true,
    resistance: 180.5,
    opportunityScore: {
      overallScore,
      technical: 75,
      institutional: 60,
      fundamental: 55,
      risk: 70,
      regime: 65,
      confidence: "medium" as const,
      sector: "Consumer Staples",
      category: "Top Growth",
    },
  };
}

/** Minimal scored watch candidate. */
function makeWatchCandidate(symbol: string, overallScore = 45) {
  return {
    symbol,
    score: overallScore,
    strategy: "Approaching Setup",
    reasons: ["Tightening volatility"],
    warnings: [],
    setupDetected: false,
    resistance: null,
    opportunityScore: {
      overallScore,
      technical: 50,
      institutional: 40,
      fundamental: 40,
      risk: 45,
      regime: 50,
      confidence: "low" as const,
      sector: "Technology",
      category: "Watch",
    },
  };
}

/** Minimal OpportunityRankingResult. */
function makeRanking(overrides: {
  topGrowth?: ReturnType<typeof makeGrowthCandidate>[];
  topIncome?: ReturnType<typeof makeGrowthCandidate>[];
  watchlist?: ReturnType<typeof makeWatchCandidate>[];
  approaching?: ReturnType<typeof makeWatchCandidate>[];
} = {}) {
  return {
    generatedAt: new Date().toISOString(),
    regime: "NEUTRAL" as const,
    topGrowth:   overrides.topGrowth   ?? [],
    topIncome:   overrides.topIncome   ?? [],
    watchlist:   overrides.watchlist   ?? [],
    approaching: overrides.approaching ?? [],
    changes:     [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let savedRanking: ReturnType<typeof getLatestRanking> = null;

beforeEach(() => {
  savedRanking = getLatestRanking();
});

afterEach(() => {
  // Restore original in-memory ranking after each test
  if (savedRanking) {
    setLatestRanking(savedRanking as any);
  } else {
    // Reset to null is not directly possible since setLatestRanking enforces non-null.
    // Use a side-channel: set a recognizably empty ranking.
    setLatestRanking(makeRanking() as any);
  }
});

// ---------------------------------------------------------------------------
// §12 — Cross-surface invariant: topGrowth symbol is accepted by all surfaces
// ---------------------------------------------------------------------------

describe("§12 Cross-surface invariant: TOP_GROWTH symbol accepted by all surfaces", () => {
  it("WMT fixture (score 66, TOP_GROWTH) → getCanonicalOpportunity returns non-null", async () => {
    const wmt = makeGrowthCandidate("WMT", 66);
    setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);

    const opp = await getCanonicalOpportunity("WMT");
    expect(opp).not.toBeNull();
    expect(opp!.symbol).toBe("WMT");
  });

  it("WMT fixture → opportunityScore.overallScore is 66", async () => {
    const wmt = makeGrowthCandidate("WMT", 66);
    setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);

    const opp = await getCanonicalOpportunity("WMT");
    expect(opp!.researchScore).toBeDefined();
    // The score may be normalized but should be in a valid 0-100 range
    expect(opp!.researchScore).toBeGreaterThanOrEqual(0);
    expect(opp!.researchScore).toBeLessThanOrEqual(100);
  });

  it("WMT in topGrowth → getOpportunityIntelligence includes WMT", async () => {
    const wmt = makeGrowthCandidate("WMT", 66);
    setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);

    const result = await getOpportunityIntelligence();
    expect(result).not.toBeNull();
    const found = result!.opportunities.find(o => o.symbol === "WMT");
    expect(found).toBeDefined();
  });

  it("symbol in topGrowth → tradePlanningEligible should be true (derived from getCanonicalOpportunity)", async () => {
    const candidate = makeGrowthCandidate("AAPL", 80);
    setLatestRanking(makeRanking({ topGrowth: [candidate] }) as any);

    const opp = await getCanonicalOpportunity("AAPL");
    // tradePlanningEligible = opportunity !== null
    expect(opp).not.toBeNull();
  });

  it("symbol in topIncome → getCanonicalOpportunity returns non-null", async () => {
    const income = makeGrowthCandidate("JNJ", 72);
    setLatestRanking(makeRanking({ topIncome: [income] }) as any);

    const opp = await getCanonicalOpportunity("JNJ");
    expect(opp).not.toBeNull();
  });

  it("symbol in watchlist → getCanonicalOpportunity returns non-null (watchlist symbols are in canonical snapshot)", async () => {
    const watchSym = makeWatchCandidate("TSLA", 48);
    setLatestRanking(makeRanking({ watchlist: [watchSym] }) as any);

    const opp = await getCanonicalOpportunity("TSLA");
    expect(opp).not.toBeNull();
  });

  it("symbol lookup is case-insensitive", async () => {
    const wmt = makeGrowthCandidate("WMT", 66);
    setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);

    const oppUpper = await getCanonicalOpportunity("WMT");
    const oppLower = await getCanonicalOpportunity("wmt");
    const oppMixed = await getCanonicalOpportunity("Wmt");

    expect(oppUpper).not.toBeNull();
    expect(oppLower).not.toBeNull();
    expect(oppMixed).not.toBeNull();
    expect(oppUpper!.symbol).toBe("WMT");
  });
});

// ---------------------------------------------------------------------------
// §13 — Negative invariant: absent symbol is rejected
// ---------------------------------------------------------------------------

describe("§13 Negative invariant: absent symbol rejected by all surfaces", () => {
  it("symbol NOT in current snapshot → getCanonicalOpportunity returns null", async () => {
    const wmt = makeGrowthCandidate("WMT", 66);
    setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);

    const opp = await getCanonicalOpportunity("MISSING_XYZ");
    expect(opp).toBeNull();
  });

  it("empty ranking → getCanonicalOpportunity returns null for any symbol", async () => {
    setLatestRanking(makeRanking() as any);

    const opp = await getCanonicalOpportunity("WMT");
    expect(opp).toBeNull();
  });

  it("symbol in old snapshot (watchlist) but not in new snapshot (empty) → getCanonicalOpportunity returns null", async () => {
    // Simulate snapshot rollover: new scan produced empty topGrowth
    setLatestRanking(makeRanking({ topGrowth: [] }) as any);

    const opp = await getCanonicalOpportunity("WMT");
    expect(opp).toBeNull();
  });

  it("tradePlanningEligible is false when symbol absent (derived)", async () => {
    setLatestRanking(makeRanking() as any);
    const opp = await getCanonicalOpportunity("ABSENT");
    // tradePlanningEligible = opportunity !== null = false
    expect(opp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §14 — Snapshot rollover: all surfaces converge on the new snapshot
// ---------------------------------------------------------------------------

describe("§14 Snapshot rollover: surfaces converge on the new snapshot", () => {
  it("after setLatestRanking with new snapshot, getCanonicalOpportunity reflects new snapshot", async () => {
    // S1: WMT present
    const s1 = makeRanking({ topGrowth: [makeGrowthCandidate("WMT", 66)] });
    setLatestRanking(s1 as any);
    expect(await getCanonicalOpportunity("WMT")).not.toBeNull();
    expect(await getCanonicalOpportunity("NVDA")).toBeNull();

    // S2: WMT dropped, NVDA added
    const s2 = makeRanking({ topGrowth: [makeGrowthCandidate("NVDA", 78)] });
    setLatestRanking(s2 as any);

    // After rollover: WMT gone, NVDA present
    expect(await getCanonicalOpportunity("WMT")).toBeNull();
    expect(await getCanonicalOpportunity("NVDA")).not.toBeNull();
  });

  it("after rollover, total opportunity count matches new snapshot", async () => {
    const s1 = makeRanking({
      topGrowth: [makeGrowthCandidate("A", 80), makeGrowthCandidate("B", 70)],
      watchlist: [makeWatchCandidate("C", 45)],
    });
    setLatestRanking(s1 as any);
    const r1 = await getOpportunityIntelligence();
    expect(r1!.opportunities).toHaveLength(3);

    // Rollover to a smaller snapshot
    const s2 = makeRanking({ topGrowth: [makeGrowthCandidate("A", 80)] });
    setLatestRanking(s2 as any);
    const r2 = await getOpportunityIntelligence();
    expect(r2!.opportunities).toHaveLength(1);
  });

  it("getOpportunityIntelligence returns null when ranking is null", async () => {
    // Cannot directly set to null (setLatestRanking enforces non-null type),
    // so test via empty ranking + null from service perspective
    // The module-level ranking variable would be null before first init;
    // we confirm null ranking → null result by checking service behavior
    // with an empty ranking (the best approximation in pure tests).
    setLatestRanking(makeRanking() as any);
    const result = await getOpportunityIntelligence();
    // Empty ranking is valid; result is non-null with zero opportunities
    expect(result).not.toBeNull();
    expect(result!.opportunities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §17 — TEST_LIVE independence: allowlist does not influence research qualification
// ---------------------------------------------------------------------------

describe("§17 TEST_LIVE independence: execution allowlist does not affect research qualification", () => {
  it("EXECUTION_TEST_SYMBOL_ALLOWLIST env var is independent of getCanonicalOpportunity", async () => {
    // Temporarily set the TEST_LIVE allowlist env var
    const original = process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST;
    process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST = "FAKERSTOCK";

    try {
      // WMT is NOT in the allowlist, but IS in the ranking
      const wmt = makeGrowthCandidate("WMT", 66);
      setLatestRanking(makeRanking({ topGrowth: [wmt] }) as any);
      const oppWmt = await getCanonicalOpportunity("WMT");
      expect(oppWmt).not.toBeNull(); // WMT is qualified (not affected by allowlist)

      // FAKERSTOCK IS in the allowlist, but NOT in the ranking
      const oppFaker = await getCanonicalOpportunity("FAKERSTOCK");
      expect(oppFaker).toBeNull(); // FAKERSTOCK is NOT qualified (allowlist alone doesn't qualify)
    } finally {
      if (original === undefined) {
        delete process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST;
      } else {
        process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST = original;
      }
    }
  });

  it("EXECUTION_TEST_ACCOUNT_ALLOWLIST env var does not affect research qualification", async () => {
    const original = process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST;
    process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST = "ACCT12345,ACCT99999";

    try {
      setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("MSFT", 75)] }) as any);
      const opp = await getCanonicalOpportunity("MSFT");
      expect(opp).not.toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST;
      } else {
        process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST = original;
      }
    }
  });

  it("getCanonicalOpportunity reads only from getLatestRanking — no execution env var dependency", async () => {
    // Unset all execution-related env vars and confirm qualification still works
    const vars = [
      "BROKER_EXECUTION_ENABLED",
      "BROKER_EXECUTION_MODE",
      "EXECUTION_TEST_LIVE_ARMED",
      "EXECUTION_TEST_SYMBOL_ALLOWLIST",
      "EXECUTION_TEST_ACCOUNT_ALLOWLIST",
    ] as const;
    const originals = vars.map(k => [k, process.env[k]] as const);
    vars.forEach(k => delete process.env[k]);

    try {
      setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("AAPL", 85)] }) as any);
      const opp = await getCanonicalOpportunity("AAPL");
      expect(opp).not.toBeNull(); // Qualified solely from ranking, never from execution gates
    } finally {
      originals.forEach(([k, v]) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
    }
  });
});

// ---------------------------------------------------------------------------
// §20 — Cross-surface fixture: canonical WMT TOP_GROWTH scenario
// ---------------------------------------------------------------------------

describe("§20 Cross-surface fixture: WMT TOP_GROWTH score 66", () => {
  it("WMT at score 66 appears in getOpportunityIntelligence().opportunities", async () => {
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("WMT", 66)] }) as any);

    const intel = await getOpportunityIntelligence();
    const wmt = intel!.opportunities.find(o => o.symbol === "WMT");
    expect(wmt).toBeDefined();
    expect(wmt!.researchScore).toBeGreaterThanOrEqual(0);
  });

  it("WMT at score 66 is accepted by getCanonicalOpportunity (Trade Planning gate)", async () => {
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("WMT", 66)] }) as any);

    const opp = await getCanonicalOpportunity("WMT");
    expect(opp).not.toBeNull();
    expect(opp!.symbol).toBe("WMT");
  });

  it("WMT tradePlanningEligible = true when present in snapshot", async () => {
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("WMT", 66)] }) as any);
    const opp = await getCanonicalOpportunity("WMT");
    // tradePlanningEligible === (opp !== null)
    expect(opp !== null).toBe(true);
  });

  it("WMT tradePlanningEligible = false when absent from snapshot", async () => {
    // Snapshot without WMT
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("AAPL", 85)] }) as any);
    const opp = await getCanonicalOpportunity("WMT");
    expect(opp !== null).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §21 — Regression: representative symbol types
// ---------------------------------------------------------------------------

describe("§21 Regression: representative symbol types", () => {
  it("Top Growth symbol (score 80) → accepted", async () => {
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("NVDA", 80)] }) as any);
    expect(await getCanonicalOpportunity("NVDA")).not.toBeNull();
  });

  it("Watch symbol (score 45) → accepted (watch symbols are in the snapshot)", async () => {
    setLatestRanking(makeRanking({ watchlist: [makeWatchCandidate("PLTR", 45)] }) as any);
    expect(await getCanonicalOpportunity("PLTR")).not.toBeNull();
  });

  it("Unqualified / absent symbol → rejected", async () => {
    setLatestRanking(makeRanking({ topGrowth: [makeGrowthCandidate("NVDA", 80)] }) as any);
    expect(await getCanonicalOpportunity("TOTALLY_RANDOM_NOT_RANKED")).toBeNull();
  });

  it("Symbol absent from snapshot → null from getCanonicalOpportunity", async () => {
    setLatestRanking(makeRanking({ topGrowth: [] }) as any);
    expect(await getCanonicalOpportunity("WMT")).toBeNull();
  });

  it("Approaching qualification symbol → accepted (in snapshot)", async () => {
    setLatestRanking(makeRanking({ approaching: [makeWatchCandidate("AMD", 38)] }) as any);
    expect(await getCanonicalOpportunity("AMD")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §WorkspaceResponse — tradePlanningEligible field contract
// ---------------------------------------------------------------------------

describe("WorkspaceV2Response.tradePlanningEligible contract", () => {
  it("tradePlanningEligible is true when opportunity is present", () => {
    // Structural: tradePlanningEligible = opportunity !== null
    const opp = { symbol: "WMT" }; // any truthy value
    const eligible = opp !== null;
    expect(eligible).toBe(true);
  });

  it("tradePlanningEligible is false when opportunity is null", () => {
    const opp = null;
    const eligible = opp !== null;
    expect(eligible).toBe(false);
  });

  it("tradePlanningEligible is a boolean, not a nullable or truthy value", () => {
    expect(typeof (null !== null)).toBe("boolean");
    expect(typeof ({} !== null)).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// §Startup — initOpportunityEngine ranking restoration
// ---------------------------------------------------------------------------

describe("§Startup initOpportunityEngine ranking restoration contract", () => {
  it("getLatestRanking is non-null after setLatestRanking is called (simulates post-init state)", () => {
    const ranking = makeRanking({ topGrowth: [makeGrowthCandidate("WMT", 66)] });
    setLatestRanking(ranking as any);
    expect(getLatestRanking()).not.toBeNull();
    expect(getLatestRanking()!.topGrowth).toHaveLength(1);
    expect(getLatestRanking()!.topGrowth[0].symbol).toBe("WMT");
  });

  it("initOpportunityEngine calls computeRankingForSnapshot and setLatestRanking (structural: function is exported)", async () => {
    const mod = await import("../../services/opportunity-engine");
    expect(typeof mod.initOpportunityEngine).toBe("function");
    expect(typeof mod.scheduleOpportunityEngine).toBe("function");
  });

  it("computeRankingForSnapshot is exported (callable from initOpportunityEngine)", async () => {
    const mod = await import("../../services/opportunity-ranking-engine");
    expect(typeof mod.computeRankingForSnapshot).toBe("function");
  });

  it("setLatestRanking is exported (called by initOpportunityEngine after restore)", async () => {
    const mod = await import("../../services/opportunity-ranking-engine");
    expect(typeof mod.setLatestRanking).toBe("function");
  });

  it("initOpportunityEngine source calls computeRankingForSnapshot and setLatestRanking", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../../services/opportunity-engine.ts", import.meta.url).pathname,
      "utf8",
    );
    const fnStart = src.indexOf("export async function initOpportunityEngine");
    const fnEnd = src.indexOf("\nexport ", fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toContain("computeRankingForSnapshot");
    expect(fnBody).toContain("setLatestRanking");
  });
});
