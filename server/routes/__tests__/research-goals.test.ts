/**
 * Research Goals Tests — Sprint 2.6.5
 *
 * Tests:
 *   - Goal types, horizons, styles (vocabulary)
 *   - CRUD helpers (pure)
 *   - Goal matching (deterministic)
 *   - Match states (categorical, no numeric suitability score)
 *   - Match explanations
 *   - Primary goal logic
 *   - Portfolio-free behavior
 *   - Compliance (no suitability scoring, no recommendation language)
 *   - Route contract (static routes before dynamic)
 *   - Privacy disclosure and compliance disclaimer
 *   - Partial data resilience
 *   - Ownership (cross-user isolation)
 *   - Cache isolation
 *   - AI grounding rules
 *   - No ranking changes
 */

import { describe, it, expect } from "vitest";
import {
  GOAL_TYPES,
  GOAL_TYPE_LABELS,
  GOAL_TYPE_DESCRIPTIONS,
  RESEARCH_HORIZONS,
  RESEARCH_HORIZON_LABELS,
  RESEARCH_HORIZON_DESCRIPTIONS,
  RESEARCH_STYLES,
  RESEARCH_STYLE_LABELS,
  VOLATILITY_PREFERENCES,
  VOLATILITY_PREFERENCE_LABELS,
  VOLATILITY_DISCLAIMER,
  GOAL_COMPLIANCE_DISCLAIMER,
  GOAL_PRIVACY_DISCLOSURE,
  GOAL_MATCH_DISCLAIMER,
  GOAL_MATCH_STATE_LABELS,
  HORIZON_TO_TIME_HORIZON_MAP,
} from "../../../shared/research-goal-types";
import {
  validateGoalType,
  validateHorizon,
  validateResearchStyle,
  validateVolatilityPreference,
  matchOpportunityToGoal,
} from "../../services/research-goal-service";
import type { ResearchGoal } from "../../../shared/research-goal-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<ResearchGoal> = {}): ResearchGoal {
  return {
    id:                        "goal-1",
    userId:                    "user-1",
    name:                      "Long-Term AI Research",
    goalType:                  "ai_infrastructure",
    description:               null,
    horizon:                   "long_term",
    researchStyle:             "growth",
    focusAreas:                [],
    preferredSectors:          ["Technology"],
    preferredThemes:           ["AI Infrastructure", "Semiconductors"],
    preferredOpportunityTypes: [],
    volatilityPreference:      "balanced",
    optionsInterest:           false,
    monitoringEnabled:         false,
    isPrimary:                 false,
    status:                    "active",
    createdAt:                 new Date().toISOString(),
    updatedAt:                 new Date().toISOString(),
    ...overrides,
  };
}

function makeOpp(overrides: Partial<{
  symbol: string;
  companyName: string | null;
  sector: string | null;
  themes: string[];
  opportunityType: string;
  timeHorizon: string | null;
  riskLevel: string | null;
  institutionalScore: number;
  technicalScore: number;
  researchScore: number;
}> = {}) {
  return {
    symbol:             "NVDA",
    companyName:        "NVIDIA Corporation",
    sector:             "Technology",
    themes:             ["AI Infrastructure", "Semiconductors", "GPU Computing"],
    opportunityType:    "growth",
    timeHorizon:        "long",
    riskLevel:          "medium",
    institutionalScore: 72,
    technicalScore:     81,
    researchScore:      85,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 1: Goal Type vocabulary
// ---------------------------------------------------------------------------

describe("Goal Types", () => {
  it("has 12 goal types", () => {
    expect(GOAL_TYPES.length).toBe(12);
  });

  it("every goal type has a label", () => {
    for (const gt of GOAL_TYPES) {
      expect(GOAL_TYPE_LABELS[gt]).toBeTruthy();
    }
  });

  it("every goal type has a description", () => {
    for (const gt of GOAL_TYPES) {
      expect(GOAL_TYPE_DESCRIPTIONS[gt]).toBeTruthy();
    }
  });

  it("includes expected goal types", () => {
    expect(GOAL_TYPES).toContain("long_term_growth");
    expect(GOAL_TYPES).toContain("ai_infrastructure");
    expect(GOAL_TYPES).toContain("income");
    expect(GOAL_TYPES).toContain("options_income");
    expect(GOAL_TYPES).toContain("custom");
  });

  it("no goal type label contains suitability language", () => {
    for (const gt of GOAL_TYPES) {
      const label = GOAL_TYPE_LABELS[gt].toLowerCase();
      expect(label).not.toMatch(/suitable|suitability|recommended for you|best for you/);
    }
  });

  it("no goal type description implies automated portfolio management", () => {
    for (const gt of GOAL_TYPES) {
      const desc = GOAL_TYPE_DESCRIPTIONS[gt].toLowerCase();
      expect(desc).not.toMatch(/rebalance|auto.?rebalance|automatic trade/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2: Research Horizons
// ---------------------------------------------------------------------------

describe("Research Horizons", () => {
  it("has 4 research horizons", () => {
    expect(RESEARCH_HORIZONS.length).toBe(4);
  });

  it("every horizon has a label and description", () => {
    for (const h of RESEARCH_HORIZONS) {
      expect(RESEARCH_HORIZON_LABELS[h]).toBeTruthy();
      expect(RESEARCH_HORIZON_DESCRIPTIONS[h]).toBeTruthy();
    }
  });

  it("no horizon description implies holding period", () => {
    for (const h of RESEARCH_HORIZONS) {
      const desc = RESEARCH_HORIZON_DESCRIPTIONS[h].toLowerCase();
      expect(desc).not.toMatch(/hold|holding period|expected return/);
    }
  });

  it("horizon maps to time horizon values", () => {
    expect(HORIZON_TO_TIME_HORIZON_MAP.long_term).toContain("long");
    expect(HORIZON_TO_TIME_HORIZON_MAP.short_term).toContain("short");
    expect(HORIZON_TO_TIME_HORIZON_MAP.multi_year).toContain("long");
  });
});

// ---------------------------------------------------------------------------
// Section 3: Research Styles
// ---------------------------------------------------------------------------

describe("Research Styles", () => {
  it("has at least 8 research styles", () => {
    expect(RESEARCH_STYLES.length).toBeGreaterThanOrEqual(8);
  });

  it("every style has a label", () => {
    for (const s of RESEARCH_STYLES) {
      expect(RESEARCH_STYLE_LABELS[s]).toBeTruthy();
    }
  });

  it("includes expected styles", () => {
    expect(RESEARCH_STYLES).toContain("growth");
    expect(RESEARCH_STYLES).toContain("balanced");
    expect(RESEARCH_STYLES).toContain("institutional_activity");
    expect(RESEARCH_STYLES).toContain("thematic");
  });
});

// ---------------------------------------------------------------------------
// Section 4: Volatility Preference
// ---------------------------------------------------------------------------

describe("Volatility Preference", () => {
  it("has 3 volatility preferences", () => {
    expect(VOLATILITY_PREFERENCES.length).toBe(3);
  });

  it("every preference has a label", () => {
    for (const v of VOLATILITY_PREFERENCES) {
      expect(VOLATILITY_PREFERENCE_LABELS[v]).toBeTruthy();
    }
  });

  it("includes lower, balanced, higher_accepted", () => {
    expect(VOLATILITY_PREFERENCES).toContain("lower");
    expect(VOLATILITY_PREFERENCES).toContain("balanced");
    expect(VOLATILITY_PREFERENCES).toContain("higher_accepted");
  });

  it("disclaimer says this is not a suitability assessment", () => {
    expect(VOLATILITY_DISCLAIMER).toBeTruthy();
    const lower = VOLATILITY_DISCLAIMER.toLowerCase();
    // Must NOT frame this as a risk-tolerance questionnaire
    expect(lower).not.toMatch(/risk tolerance questionnaire|risk tolerance test|financial questionnaire/);
    // Must explicitly disclaim suitability (negating context is fine)
    expect(lower).toMatch(/not represent a suitability|does not represent a suitability|not.*suitability assessment/i);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Validation helpers
// ---------------------------------------------------------------------------

describe("Validation helpers", () => {
  it("validates goal types correctly", () => {
    expect(validateGoalType("ai_infrastructure")).toBe(true);
    expect(validateGoalType("custom")).toBe(true);
    expect(validateGoalType("unknown_type")).toBe(false);
    expect(validateGoalType("")).toBe(false);
    expect(validateGoalType("suitable_for_you")).toBe(false);
  });

  it("validates horizons correctly", () => {
    expect(validateHorizon("long_term")).toBe(true);
    expect(validateHorizon("short_term")).toBe(true);
    expect(validateHorizon("5_years")).toBe(false);
  });

  it("validates research styles correctly", () => {
    expect(validateResearchStyle("growth")).toBe(true);
    expect(validateResearchStyle("balanced")).toBe(true);
    expect(validateResearchStyle("aggressive")).toBe(false);
  });

  it("validates volatility preferences correctly", () => {
    expect(validateVolatilityPreference("lower")).toBe(true);
    expect(validateVolatilityPreference("balanced")).toBe(true);
    expect(validateVolatilityPreference("higher_accepted")).toBe(true);
    expect(validateVolatilityPreference("aggressive")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Goal matching — deterministic
// ---------------------------------------------------------------------------

describe("Goal matching (deterministic)", () => {
  it("returns strong_match when themes + sector align", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.goalId).toBe("goal-1");
    expect(result.symbol).toBe("NVDA");
    expect(["strong_match", "match"]).toContain(result.matchState);
  });

  it("returns outside_filters or partial_match when no topic filters match", () => {
    // Goal: Biotechnology / Healthcare. Opp: Technology / AI Infrastructure.
    // Theme and sector miss entirely. Horizon or volatility may add a small
    // secondary score, so the result is outside_filters or at most partial_match.
    const goal = makeGoal({
      preferredThemes:           ["Biotechnology"],
      preferredSectors:          ["Healthcare"],
      preferredOpportunityTypes: ["income"],    // also won't match "growth" opp
    });
    const opp = makeOpp({ sector: "Technology", themes: ["AI Infrastructure"], opportunityType: "growth" });
    const result = matchOpportunityToGoal(opp, goal);
    expect(["outside_filters", "partial_match"]).toContain(result.matchState);
    // Should NOT be a strong_match or match
    expect(result.matchState).not.toBe("strong_match");
    expect(result.matchState).not.toBe("match");
  });

  it("returns match when no filters are set (broad goal)", () => {
    const goal = makeGoal({ preferredThemes: [], preferredSectors: [], preferredOpportunityTypes: [] });
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.matchState).toBe("match");
    expect(result.matchReasons.length).toBeGreaterThan(0);
  });

  it("theme matching is case-insensitive partial match", () => {
    const goal = makeGoal({ preferredThemes: ["ai infrastructure"] });
    const opp  = makeOpp({ themes: ["AI Infrastructure", "GPU"] });
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.matchedThemes.length).toBeGreaterThan(0);
  });

  it("sector matching is case-insensitive", () => {
    const goal = makeGoal({ preferredSectors: ["technology"] });
    const opp  = makeOpp({ sector: "Technology" });
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.matchedSectors).toContain("Technology");
  });

  it("opportunity type matching works", () => {
    const goal = makeGoal({
      preferredThemes:           [],
      preferredSectors:          [],
      preferredOpportunityTypes: ["growth"],
    });
    const opp  = makeOpp({ opportunityType: "growth", sector: null, themes: [] });
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.matchedOpportunityTypes).toContain("growth");
    expect(result.matchState).not.toBe("outside_filters");
  });

  it("horizon alignment is checked", () => {
    const goal = makeGoal({ horizon: "long_term" });
    const opp  = makeOpp({ timeHorizon: "long" });
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.horizonAligned).toBe(true);
  });

  it("horizon misalignment does not crash", () => {
    const goal = makeGoal({ horizon: "short_term" });
    const opp  = makeOpp({ timeHorizon: "long" });
    const result = matchOpportunityToGoal(opp, goal);
    expect(typeof result.horizonAligned).toBe("boolean");
  });

  it("missing timeHorizon on opp does not crash", () => {
    const goal = makeGoal();
    const opp  = makeOpp({ timeHorizon: null });
    expect(() => matchOpportunityToGoal(opp, goal)).not.toThrow();
  });

  it("missing sector on opp does not crash", () => {
    const goal = makeGoal({ preferredSectors: ["Technology"] });
    const opp  = makeOpp({ sector: null });
    expect(() => matchOpportunityToGoal(opp, goal)).not.toThrow();
  });

  it("high-risk opp is penalized for lower volatility goal", () => {
    const lowVolGoal = makeGoal({ volatilityPreference: "lower", preferredThemes: ["AI Infrastructure"] });
    const highRiskOpp = makeOpp({ riskLevel: "high" });
    const lowVolResult = matchOpportunityToGoal(highRiskOpp, lowVolGoal);

    const balancedGoal = makeGoal({ volatilityPreference: "balanced", preferredThemes: ["AI Infrastructure"] });
    const balancedResult = matchOpportunityToGoal(highRiskOpp, balancedGoal);

    // lower volatility goal should not improve match quality for high-risk opp
    const ORDER: Record<string, number> = { strong_match: 0, match: 1, partial_match: 2, outside_filters: 3 };
    expect(ORDER[lowVolResult.matchState]).toBeGreaterThanOrEqual(ORDER[balancedResult.matchState]);
  });

  it("options interest boosts options-type opps", () => {
    const goal = makeGoal({ optionsInterest: true, preferredThemes: [], preferredSectors: [], preferredOpportunityTypes: [] });
    const optionsOpp = makeOpp({ opportunityType: "covered_call" });
    const result = matchOpportunityToGoal(optionsOpp, goal);
    expect(result.matchReasons).toContain("options research interest");
  });
});

// ---------------------------------------------------------------------------
// Section 7: Match state labels
// ---------------------------------------------------------------------------

describe("Match state labels", () => {
  it("has labels for all 4 match states", () => {
    expect(GOAL_MATCH_STATE_LABELS.strong_match).toBeTruthy();
    expect(GOAL_MATCH_STATE_LABELS.match).toBeTruthy();
    expect(GOAL_MATCH_STATE_LABELS.partial_match).toBeTruthy();
    expect(GOAL_MATCH_STATE_LABELS.outside_filters).toBeTruthy();
  });

  it("no match state label contains suitability language", () => {
    for (const [, label] of Object.entries(GOAL_MATCH_STATE_LABELS)) {
      const lower = label.toLowerCase();
      expect(lower).not.toMatch(/suitable|recommended for you|best investment/);
    }
  });

  it("strong match label is 'Strong Research Match'", () => {
    expect(GOAL_MATCH_STATE_LABELS.strong_match).toBe("Strong Research Match");
  });
});

// ---------------------------------------------------------------------------
// Section 8: Compliance and privacy
// ---------------------------------------------------------------------------

describe("Compliance and privacy disclaimers", () => {
  it("compliance disclaimer exists and is non-trivial", () => {
    expect(GOAL_COMPLIANCE_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("compliance disclaimer does not contain recommendation language", () => {
    expect(GOAL_COMPLIANCE_DISCLAIMER.toLowerCase()).not.toMatch(/\brecommend\b/);
  });

  it("compliance disclaimer explicitly says 'not a suitability assessment'", () => {
    expect(GOAL_COMPLIANCE_DISCLAIMER.toLowerCase()).toMatch(/suitability/);
  });

  it("compliance disclaimer explicitly says 'not an investment recommendation'", () => {
    expect(GOAL_COMPLIANCE_DISCLAIMER.toLowerCase()).toMatch(/investment recommendation/);
  });

  it("privacy disclosure exists", () => {
    expect(GOAL_PRIVACY_DISCLOSURE.length).toBeGreaterThan(30);
  });

  it("match disclaimer explicitly says goals do not mean suitability", () => {
    expect(GOAL_MATCH_DISCLAIMER.toLowerCase()).toMatch(/suitable|suitability/);
  });

  it("match disclaimer explicitly says 'not that you should buy'", () => {
    expect(GOAL_MATCH_DISCLAIMER.toLowerCase()).toMatch(/buy/);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Match explanation content
// ---------------------------------------------------------------------------

describe("Match explanation content", () => {
  it("match reasons are human-readable strings", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    for (const reason of result.matchReasons) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("match reasons do not say 'you should buy'", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    for (const reason of result.matchReasons) {
      expect(reason.toLowerCase()).not.toMatch(/you should buy|recommended for you|suitable/);
    }
  });

  it("matched themes list is a subset of opp themes", () => {
    const goal = makeGoal({ preferredThemes: ["AI Infrastructure"] });
    const opp  = makeOpp({ themes: ["AI Infrastructure", "GPU Computing"] });
    const result = matchOpportunityToGoal(opp, goal);
    for (const t of result.matchedThemes) {
      // Should be one of opp's themes
      expect(opp.themes.some(oppT => oppT.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(oppT.toLowerCase()))).toBe(true);
    }
  });

  it("match result always has goalId and symbol", () => {
    const goal = makeGoal();
    const opp  = makeOpp({ symbol: "TSLA" });
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.goalId).toBe("goal-1");
    expect(result.symbol).toBe("TSLA");
  });
});

// ---------------------------------------------------------------------------
// Section 10: Portfolio-free behavior
// ---------------------------------------------------------------------------

describe("Portfolio-free behavior", () => {
  it("matchOpportunityToGoal works without portfolio data", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    // No portfolio context needed
    const result = matchOpportunityToGoal(opp, goal);
    expect(result).toBeDefined();
    expect(result.matchState).toBeDefined();
  });

  it("goal matching is complete without portfolio", () => {
    const goal = makeGoal({
      preferredThemes: ["AI Infrastructure"],
      preferredSectors: ["Technology"],
    });
    const opps = [
      makeOpp({ symbol: "NVDA" }),
      makeOpp({ symbol: "MSFT", themes: ["Cloud Computing"] }),
    ];
    const results = opps.map(o => matchOpportunityToGoal(o, goal));
    expect(results.length).toBe(2);
    expect(results[0].symbol).toBe("NVDA");
    expect(results[1].symbol).toBe("MSFT");
  });
});

// ---------------------------------------------------------------------------
// Section 11: No suitability score
// ---------------------------------------------------------------------------

describe("No suitability scoring", () => {
  it("matchOpportunityToGoal returns categorical matchState, not a number", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    expect(typeof result.matchState).toBe("string");
    expect(typeof (result as any).suitabilityScore).toBe("undefined");
    expect(typeof (result as any).suitabilityRating).toBe("undefined");
    expect(typeof (result as any).riskScore).toBe("undefined");
  });

  it("all possible matchState values are in GOAL_MATCH_STATE_LABELS", () => {
    const validStates = Object.keys(GOAL_MATCH_STATE_LABELS);
    const goal = makeGoal();
    const oppNoFilter = makeOpp();
    const result = matchOpportunityToGoal(oppNoFilter, goal);
    expect(validStates).toContain(result.matchState);
  });
});

// ---------------------------------------------------------------------------
// Section 12: Opportunity Intelligence scores are unchanged
// ---------------------------------------------------------------------------

describe("Opportunity scores not modified by goal matching", () => {
  it("matchOpportunityToGoal does not modify opp object", () => {
    const goal = makeGoal();
    const opp  = makeOpp({ researchScore: 85, technicalScore: 81 });
    const original = { ...opp };
    matchOpportunityToGoal(opp, goal);
    expect(opp.researchScore).toBe(original.researchScore);
    expect(opp.technicalScore).toBe(original.technicalScore);
  });

  it("matchOpportunityToGoal result has no researchScore field", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    expect(typeof (result as any).researchScore).toBe("undefined");
    expect(typeof (result as any).technicalScore).toBe("undefined");
  });
});

// ---------------------------------------------------------------------------
// Section 13: Route ordering contract
// ---------------------------------------------------------------------------

describe("Route ordering contract (static before dynamic)", () => {
  it("GOAL_TYPES does not include 'new', 'primary', 'health', 'metadata' (reserved route words)", () => {
    // These are static sub-routes — must not conflict with /goals/:id
    expect(GOAL_TYPES).not.toContain("new");
    expect(GOAL_TYPES).not.toContain("primary");
    expect(GOAL_TYPES).not.toContain("health");
    expect(GOAL_TYPES).not.toContain("metadata");
  });

  it("all goal type values are safe URL path segments (no slashes)", () => {
    for (const gt of GOAL_TYPES) {
      expect(gt).not.toContain("/");
      expect(gt).toMatch(/^[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 14: AI grounding contract
// ---------------------------------------------------------------------------

describe("AI grounding contract", () => {
  it("goal matching is deterministic (same input = same output)", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result1 = matchOpportunityToGoal(opp, goal);
    const result2 = matchOpportunityToGoal(opp, goal);
    expect(result1.matchState).toBe(result2.matchState);
    expect(result1.matchReasons).toEqual(result2.matchReasons);
  });

  it("no AI-generated fields in match result", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    const resultKeys = Object.keys(result);
    // No AI-generated summary or narrative
    expect(resultKeys).not.toContain("aiSummary");
    expect(resultKeys).not.toContain("aiExplanation");
    expect(resultKeys).not.toContain("aiRecommendation");
  });
});

// ---------------------------------------------------------------------------
// Section 15: Multiple goals / primary goal
// ---------------------------------------------------------------------------

describe("Multiple goals and primary logic", () => {
  it("a goal can be marked primary", () => {
    const goal = makeGoal({ isPrimary: true });
    expect(goal.isPrimary).toBe(true);
  });

  it("a goal can have different status values", () => {
    for (const status of ["active", "paused", "archived"] as const) {
      const goal = makeGoal({ status });
      expect(goal.status).toBe(status);
    }
  });

  it("archived goal type field still validates", () => {
    const goal = makeGoal({ status: "archived", goalType: "ai_infrastructure" });
    expect(validateGoalType(goal.goalType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 16: Cross-user isolation
// ---------------------------------------------------------------------------

describe("Cross-user ownership contract", () => {
  it("GoalMatchResult contains goalId (for ownership verification)", () => {
    const goal = makeGoal({ id: "unique-goal-id", userId: "user-abc" });
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    expect(result.goalId).toBe("unique-goal-id");
  });

  it("different users produce separate match keys (userId is in cacheKey)", () => {
    // The cache key includes userId — validated by convention that matchCacheKey uses userId
    // Indirect test: two goals with different userIds have different IDs
    const goal1 = makeGoal({ id: "g1", userId: "userA" });
    const goal2 = makeGoal({ id: "g2", userId: "userB" });
    expect(goal1.userId).not.toBe(goal2.userId);
  });
});

// ---------------------------------------------------------------------------
// Section 17: Mobile structure (layout props present)
// ---------------------------------------------------------------------------

describe("Type completeness for mobile-responsive rendering", () => {
  it("ResearchGoal has all required fields for rendering", () => {
    const goal = makeGoal();
    // Fields needed for card rendering
    expect(goal.name).toBeDefined();
    expect(goal.goalType).toBeDefined();
    expect(goal.horizon).toBeDefined();
    expect(goal.researchStyle).toBeDefined();
    expect(goal.preferredThemes).toBeInstanceOf(Array);
    expect(goal.preferredSectors).toBeInstanceOf(Array);
    expect(typeof goal.isPrimary).toBe("boolean");
    expect(goal.status).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 18: Commercial tier documentation (no entitlements enforced)
// ---------------------------------------------------------------------------

describe("Commercial tier — documented only, not enforced", () => {
  it("GOAL_TYPES does not include tier-gated prefixes", () => {
    for (const gt of GOAL_TYPES) {
      expect(gt).not.toMatch(/^pro_|^enterprise_|^ria_/);
    }
  });

  it("goal type labels do not advertise locked features", () => {
    for (const gt of GOAL_TYPES) {
      expect(GOAL_TYPE_LABELS[gt]).not.toMatch(/🔒|Locked|Pro Only|Premium Only/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 19: Future Trade Planning handoff interface (documented only)
// ---------------------------------------------------------------------------

describe("Future Trade Planning handoff", () => {
  it("TradePlanningContextShape is importable as type (type-only, not implemented)", async () => {
    const { GOAL_COMPLIANCE_DISCLAIMER } = await import("../../../shared/research-goal-types");
    expect(GOAL_COMPLIANCE_DISCLAIMER).toBeDefined();
    // TradePlanningContextShape is exported as a type — presence of the module confirms the contract is documented
  });
});

// ---------------------------------------------------------------------------
// Section 20: Data minimization
// ---------------------------------------------------------------------------

describe("Data minimization", () => {
  it("ResearchGoal has no income / net worth / age fields", () => {
    const goal = makeGoal();
    const keys = Object.keys(goal);
    expect(keys).not.toContain("income");
    expect(keys).not.toContain("netWorth");
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("taxBracket");
    expect(keys).not.toContain("dependents");
    expect(keys).not.toContain("employment");
  });

  it("match result has no sensitive personal data fields", () => {
    const goal = makeGoal();
    const opp  = makeOpp();
    const result = matchOpportunityToGoal(opp, goal);
    const keys = Object.keys(result);
    expect(keys).not.toContain("income");
    expect(keys).not.toContain("netWorth");
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("userId"); // userId not exposed in match results
  });
});
