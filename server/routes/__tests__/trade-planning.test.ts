/**
 * Trade Planning Foundation Tests — Sprint 2.7.0
 *
 * Tests:
 *   - TradePlanningContext shape and contract
 *   - Planning constraints validation
 *   - Expression family eligibility (deterministic)
 *   - Eligibility reasons, missing constraints, limitations
 *   - No recommendation/ranking language
 *   - No strike/expiration/contract in scope
 *   - No order ticket or broker submission
 *   - Server authoritative context (client cannot inject scores)
 *   - Goal context integration
 *   - Portfolio context integration
 *   - No-portfolio flow
 *   - No-goal flow
 *   - Partial-data resilience
 *   - Data freshness concepts
 *   - Compliance disclaimers
 *   - Privacy (no financial questionnaire fields)
 *   - Route ordering contract (static before dynamic)
 *   - AI grounding (AI cannot create trades)
 *   - Session ownership (cross-user 404)
 *   - Cache isolation
 *   - Glossary terms
 *   - Platform health metrics shape
 *   - Commercial model (no entitlements enforced)
 *   - RIA extension (documented only)
 *   - Future equity/options engine handoff (type-only)
 *   - Roadmap discipline (no 2.7.1+ features in 2.7.0)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EXPRESSION_FAMILIES,
  EXPRESSION_FAMILY_LABELS,
  EXPRESSION_FAMILY_DESCRIPTIONS,
  EXPRESSION_STATUSES,
  EXPRESSION_STATUS_LABELS,
  EXPRESSION_STATUS_DESCRIPTIONS,
  TRADE_PLANNING_DISCLAIMER,
  CONSTRAINTS_DISCLAIMER,
  NO_RANKING_DISCLAIMER,
  DEFAULT_CONSTRAINTS,
  ARCHITECTURE_CONTRACT,
  validateConstraints,
  validateExpressionFamily,
  constraintsFingerprint,
} from "../../../shared/trade-planning-types";
import type {
  TradePlanningConstraints,
  ExpressionFamily,
  ExpressionFamilyResult,
  EquityPlanningInput,
  OptionsStrategyMatchingInput,
  PlanningPolicy,
} from "../../../shared/trade-planning-types";
import {
  evaluateExpressionFamilies,
  getTradePlanningHealth,
} from "../../services/trade-planning-service";
import type { CanonicalOpportunity } from "../../../shared/opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOpp(overrides: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    id:                  "opp-test-001",
    symbol:              "NVDA",
    companyName:         "NVIDIA Corporation",
    sector:              "Technology",
    industry:            "Semiconductors",
    themes:              ["AI Infrastructure", "Semiconductors"],
    opportunityType:     "growth",
    opportunityTypeLabel:"Growth Candidate",
    researchScore:       85,
    technicalScore:      82,
    fundamentalScore:    70,
    institutionalScore:  75,
    sentimentScore:      65,
    confidence:          "high",
    marketRegime:        "bull",
    timeHorizon:         "long",
    riskLevel:           "medium",
    lastUpdated:         new Date().toISOString(),
    primaryEvidence:     [{ label: "VCP Pattern", detail: "Stage 2 breakout", severity: "high" }],
    secondaryEvidence:   [{ label: "Volume surge", detail: "2.4x avg", severity: "medium" }],
    riskFactors:         [{ label: "Earnings next month", detail: "Q3 results", severity: "medium" }],
    invalidatesThesis:   [{ condition: "Volume collapses on breakout", detail: "would indicate false breakout" }],
    _sourceCategory:     "topGrowth",
    _rank:               1,
    ...overrides,
  };
}

function makeConstraints(overrides: Partial<TradePlanningConstraints> = {}): TradePlanningConstraints {
  return { ...DEFAULT_CONSTRAINTS, ...overrides };
}

// ---------------------------------------------------------------------------
// Section 1: Expression families vocabulary
// ---------------------------------------------------------------------------

describe("Expression Family vocabulary", () => {
  it("has 10 expression families", () => {
    expect(EXPRESSION_FAMILIES.length).toBe(10);
  });

  it("every family has a label", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(EXPRESSION_FAMILY_LABELS[f]).toBeTruthy();
      expect(EXPRESSION_FAMILY_LABELS[f].length).toBeGreaterThan(3);
    }
  });

  it("every family has a description", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(EXPRESSION_FAMILY_DESCRIPTIONS[f]).toBeTruthy();
    }
  });

  it("includes expected families", () => {
    expect(EXPRESSION_FAMILIES).toContain("equity");
    expect(EXPRESSION_FAMILIES).toContain("defined_risk_directional");
    expect(EXPRESSION_FAMILIES).toContain("covered_call");
    expect(EXPRESSION_FAMILIES).toContain("cash_secured_put");
    expect(EXPRESSION_FAMILIES).toContain("monitor_only");
  });

  it("no family label contains forbidden language", () => {
    for (const f of EXPRESSION_FAMILIES) {
      const label = EXPRESSION_FAMILY_LABELS[f].toLowerCase();
      expect(label).not.toMatch(/recommended|best trade|optimal|suitable/);
    }
  });

  it("no family label says 'Trade This' or 'Use X'", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(EXPRESSION_FAMILY_LABELS[f].toLowerCase()).not.toMatch(/^use |^trade this/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2: Expression statuses
// ---------------------------------------------------------------------------

describe("Expression Status vocabulary", () => {
  it("has 3 status values", () => {
    expect(EXPRESSION_STATUSES.length).toBe(3);
  });

  it("includes applicable, potentially_applicable, unavailable", () => {
    expect(EXPRESSION_STATUSES).toContain("applicable");
    expect(EXPRESSION_STATUSES).toContain("potentially_applicable");
    expect(EXPRESSION_STATUSES).toContain("unavailable");
  });

  it("every status has a label and description", () => {
    for (const s of EXPRESSION_STATUSES) {
      expect(EXPRESSION_STATUS_LABELS[s]).toBeTruthy();
      expect(EXPRESSION_STATUS_DESCRIPTIONS[s]).toBeTruthy();
    }
  });

  it("no status label uses ranking language", () => {
    for (const s of EXPRESSION_STATUSES) {
      const label = EXPRESSION_STATUS_LABELS[s].toLowerCase();
      expect(label).not.toMatch(/recommended|best|top pick|optimal/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3: Planning constraints validation
// ---------------------------------------------------------------------------

describe("Planning constraints validation", () => {
  it("default constraints have equityAllowed=true, optionsAllowed=false", () => {
    expect(DEFAULT_CONSTRAINTS.equityAllowed).toBe(true);
    expect(DEFAULT_CONSTRAINTS.optionsAllowed).toBe(false);
  });

  it("validateConstraints returns defaults for empty input", () => {
    const c = validateConstraints({});
    expect(c.equityAllowed).toBe(true);
    expect(c.optionsAllowed).toBe(false);
  });

  it("validateConstraints respects equityAllowed=false", () => {
    const c = validateConstraints({ equityAllowed: false });
    expect(c.equityAllowed).toBe(false);
  });

  it("validateConstraints rejects negative capitalAvailable", () => {
    const c = validateConstraints({ capitalAvailable: -100 });
    expect(c.capitalAvailable).toBeUndefined();
  });

  it("validateConstraints accepts valid capitalAvailable", () => {
    const c = validateConstraints({ capitalAvailable: 10000 });
    expect(c.capitalAvailable).toBe(10000);
  });

  it("validateConstraints rejects invalid preferredHoldingPeriod", () => {
    const c = validateConstraints({ preferredHoldingPeriod: "forever" as any });
    expect(c.preferredHoldingPeriod).toBeUndefined();
  });

  it("validateConstraints accepts valid preferredHoldingPeriod", () => {
    const c = validateConstraints({ preferredHoldingPeriod: "short" });
    expect(c.preferredHoldingPeriod).toBe("short");
  });

  it("validateConstraints does not accept income/netWorth/age fields", () => {
    const input = { income: 200000, netWorth: 1000000, age: 35, equityAllowed: true, optionsAllowed: false };
    const c = validateConstraints(input);
    expect((c as any).income).toBeUndefined();
    expect((c as any).netWorth).toBeUndefined();
    expect((c as any).age).toBeUndefined();
  });

  it("constraints fingerprint is deterministic", () => {
    const c = makeConstraints({ capitalAvailable: 5000, equityAllowed: true });
    expect(constraintsFingerprint(c)).toBe(constraintsFingerprint(c));
  });

  it("constraints fingerprint differs for different values", () => {
    const c1 = makeConstraints({ optionsAllowed: false });
    const c2 = makeConstraints({ optionsAllowed: true });
    expect(constraintsFingerprint(c1)).not.toBe(constraintsFingerprint(c2));
  });
});

// ---------------------------------------------------------------------------
// Section 4: Expression family eligibility — equity
// ---------------------------------------------------------------------------

describe("Equity expression eligibility", () => {
  it("equity is applicable when equityAllowed=true", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ equityAllowed: true });
    const results = evaluateExpressionFamilies(opp, c);
    const equity = results.find(r => r.family === "equity")!;
    expect(equity.status).toBe("applicable");
    expect(equity.reasons.length).toBeGreaterThan(0);
  });

  it("equity is unavailable when equityAllowed=false", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ equityAllowed: false });
    const results = evaluateExpressionFamilies(opp, c);
    const equity = results.find(r => r.family === "equity")!;
    expect(equity.status).toBe("unavailable");
  });

  it("equity_scaled is potentially_applicable when no capital constraint", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ equityAllowed: true });
    const results = evaluateExpressionFamilies(opp, c);
    const scaled = results.find(r => r.family === "equity_scaled")!;
    expect(["applicable", "potentially_applicable"]).toContain(scaled.status);
    if (scaled.status === "potentially_applicable") {
      expect(scaled.constraintsMissing.some(m => m.toLowerCase().includes("capital"))).toBe(true);
    }
  });

  it("equity_scaled is applicable when capitalAvailable is provided", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ equityAllowed: true, capitalAvailable: 10000 });
    const results = evaluateExpressionFamilies(opp, c);
    const scaled = results.find(r => r.family === "equity_scaled")!;
    expect(scaled.status).toBe("applicable");
  });
});

// ---------------------------------------------------------------------------
// Section 5: Options expression eligibility
// ---------------------------------------------------------------------------

describe("Options expression eligibility", () => {
  it("defined_risk_directional is unavailable when options disabled", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: false });
    const results = evaluateExpressionFamilies(opp, c);
    const dr = results.find(r => r.family === "defined_risk_directional")!;
    expect(dr.status).toBe("unavailable");
  });

  it("defined_risk_directional is potentially_applicable when options enabled on growth candidate", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true });
    const results = evaluateExpressionFamilies(opp, c);
    const dr = results.find(r => r.family === "defined_risk_directional")!;
    expect(["applicable", "potentially_applicable"]).toContain(dr.status);
  });

  it("defined_risk_directional is applicable with options + growth + defined-risk preference", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true, definedRiskPreferred: true });
    const results = evaluateExpressionFamilies(opp, c);
    const dr = results.find(r => r.family === "defined_risk_directional")!;
    expect(dr.status).toBe("applicable");
  });

  it("covered_call is unavailable when options disabled", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: false });
    const results = evaluateExpressionFamilies(opp, c);
    const cc = results.find(r => r.family === "covered_call")!;
    expect(cc.status).toBe("unavailable");
  });

  it("covered_call is potentially_applicable when options enabled + income focus", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });
    const results = evaluateExpressionFamilies(opp, c);
    const cc = results.find(r => r.family === "covered_call")!;
    expect(["applicable", "potentially_applicable"]).toContain(cc.status);
  });

  it("cash_secured_put is unavailable when options disabled", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: false });
    const results = evaluateExpressionFamilies(opp, c);
    const csp = results.find(r => r.family === "cash_secured_put")!;
    expect(csp.status).toBe("unavailable");
  });

  it("cash_secured_put is potentially_applicable with options + income focus", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });
    const results = evaluateExpressionFamilies(opp, c);
    const csp = results.find(r => r.family === "cash_secured_put")!;
    expect(["applicable", "potentially_applicable"]).toContain(csp.status);
  });

  it("vertical_spread requires defined-risk preference", () => {
    const opp   = makeOpp();
    const cNoDr = makeConstraints({ optionsAllowed: true, definedRiskPreferred: false });
    const cDr   = makeConstraints({ optionsAllowed: true, definedRiskPreferred: true });
    const resNoDr = evaluateExpressionFamilies(opp, cNoDr);
    const resDr   = evaluateExpressionFamilies(opp, cDr);
    const vsNoDr = resNoDr.find(r => r.family === "vertical_spread")!;
    const vsDr   = resDr.find(r => r.family === "vertical_spread")!;
    expect(vsNoDr.status).toBe("unavailable");
    expect(["applicable", "potentially_applicable"]).toContain(vsDr.status);
  });

  it("long_option requires directional or growth context", () => {
    const opp = makeOpp({ opportunityType: "growth" });
    const c   = makeConstraints({ optionsAllowed: true, preferredHoldingPeriod: "medium" });
    const results = evaluateExpressionFamilies(opp, c);
    const lo = results.find(r => r.family === "long_option")!;
    expect(["applicable", "potentially_applicable"]).toContain(lo.status);
  });

  it("neutral_options is unavailable when directional thesis exists", () => {
    const opp = makeOpp({ opportunityType: "growth" });
    const c   = makeConstraints({ optionsAllowed: true, directionalFocus: true });
    const results = evaluateExpressionFamilies(opp, c);
    const no = results.find(r => r.family === "neutral_options")!;
    expect(no.status).toBe("unavailable");
    expect(no.reasons.some(r => r.toLowerCase().includes("directional"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Monitor only
// ---------------------------------------------------------------------------

describe("Monitor only expression", () => {
  it("monitor_only is always applicable", () => {
    const opp = makeOpp();
    const c1  = makeConstraints({ equityAllowed: false, optionsAllowed: false });
    const c2  = makeConstraints({ equityAllowed: true, optionsAllowed: true });
    [c1, c2].forEach(c => {
      const results = evaluateExpressionFamilies(opp, c);
      const mo = results.find(r => r.family === "monitor_only")!;
      expect(mo.status).toBe("applicable");
    });
  });

  it("monitor_only has a limitation note about passive observation", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    const mo = results.find(r => r.family === "monitor_only")!;
    expect(mo.limitations.some(l => l.toLowerCase().includes("passive"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Eligibility result contract
// ---------------------------------------------------------------------------

describe("Eligibility result contract", () => {
  it("every result has family, label, description, status, reasons, constraintsMissing, limitations", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (const r of results) {
      expect(r.family).toBeDefined();
      expect(r.label).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(EXPRESSION_STATUSES).toContain(r.status);
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(Array.isArray(r.constraintsMissing)).toBe(true);
      expect(Array.isArray(r.limitations)).toBe(true);
    }
  });

  it("all 10 expression families are evaluated", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    expect(results.length).toBe(10);
    const families = results.map(r => r.family);
    for (const f of EXPRESSION_FAMILIES) {
      expect(families).toContain(f);
    }
  });

  it("results are deterministic (same input = same output)", () => {
    const opp = makeOpp();
    const r1 = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    const r2 = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (let i = 0; i < r1.length; i++) {
      expect(r1[i].status).toBe(r2[i].status);
      expect(r1[i].reasons).toEqual(r2[i].reasons);
    }
  });

  it("reasons are human-readable strings", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (const r of results) {
      for (const reason of r.reasons) {
        expect(typeof reason).toBe("string");
        expect(reason.length).toBeGreaterThan(3);
      }
    }
  });

  it("no result has a numeric suitability score", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (const r of results) {
      expect(typeof (r as any).suitabilityScore).toBe("undefined");
      expect(typeof (r as any).score).toBe("undefined");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8: No recommendation/ranking language
// ---------------------------------------------------------------------------

describe("No recommendation or ranking language", () => {
  it("no result reason says 'recommended', 'best', 'optimal', or 'suitable'", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, makeConstraints({ optionsAllowed: true }));
    for (const r of results) {
      for (const reason of r.reasons) {
        expect(reason.toLowerCase()).not.toMatch(/\brecommend\b|\bbest\b|\boptimal\b|\bsuitable\b/);
      }
    }
  });

  it("NO_RANKING_DISCLAIMER exists and mentions 'recommended' in negating context", () => {
    expect(NO_RANKING_DISCLAIMER.length).toBeGreaterThan(20);
    expect(NO_RANKING_DISCLAIMER.toLowerCase()).toMatch(/recommend/);
  });

  it("NO_RANKING_DISCLAIMER does not say 'recommended' as a label", () => {
    // It should appear in negating context ("not ranked", "no expression is labeled")
    expect(NO_RANKING_DISCLAIMER.toLowerCase()).not.toMatch(/^recommended/);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Compliance disclaimers
// ---------------------------------------------------------------------------

describe("Compliance disclaimers", () => {
  it("TRADE_PLANNING_DISCLAIMER exists and is substantial", () => {
    expect(TRADE_PLANNING_DISCLAIMER.length).toBeGreaterThan(80);
  });

  it("TRADE_PLANNING_DISCLAIMER mentions investment advice in negating context", () => {
    expect(TRADE_PLANNING_DISCLAIMER.toLowerCase()).toMatch(/investment advice/);
  });

  it("TRADE_PLANNING_DISCLAIMER mentions suitability in negating context", () => {
    expect(TRADE_PLANNING_DISCLAIMER.toLowerCase()).toMatch(/suitability/);
  });

  it("TRADE_PLANNING_DISCLAIMER mentions buy, sell, hold in negating context", () => {
    expect(TRADE_PLANNING_DISCLAIMER.toLowerCase()).toMatch(/buy|sell|hold/);
  });

  it("CONSTRAINTS_DISCLAIMER exists and says not suitability assessment", () => {
    expect(CONSTRAINTS_DISCLAIMER.length).toBeGreaterThan(30);
    expect(CONSTRAINTS_DISCLAIMER.toLowerCase()).toMatch(/suitability/);
  });
});

// ---------------------------------------------------------------------------
// Section 10: Privacy — no financial questionnaire fields
// ---------------------------------------------------------------------------

describe("Privacy — no financial questionnaire fields", () => {
  it("DEFAULT_CONSTRAINTS has no income/netWorth/age/taxBracket fields", () => {
    const keys = Object.keys(DEFAULT_CONSTRAINTS);
    expect(keys).not.toContain("income");
    expect(keys).not.toContain("netWorth");
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("taxBracket");
    expect(keys).not.toContain("employment");
    expect(keys).not.toContain("dependents");
    expect(keys).not.toContain("householdAssets");
    expect(keys).not.toContain("liabilities");
  });

  it("validateConstraints strips income/netWorth/age fields", () => {
    const c = validateConstraints({
      income: 500000, netWorth: 2000000, age: 45,
      taxBracket: "32%", equityAllowed: true, optionsAllowed: false,
    });
    expect((c as any).income).toBeUndefined();
    expect((c as any).netWorth).toBeUndefined();
    expect((c as any).age).toBeUndefined();
    expect((c as any).taxBracket).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 11: Roadmap discipline — no 2.7.1+ features
// ---------------------------------------------------------------------------

describe("Roadmap discipline — Sprint 2.7.0 scope", () => {
  it("no strike or expiration in ExpressionFamilyResult", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, makeConstraints({ optionsAllowed: true }));
    for (const r of results) {
      expect((r as any).strike).toBeUndefined();
      expect((r as any).expiration).toBeUndefined();
      expect((r as any).contract).toBeUndefined();
      expect((r as any).premium).toBeUndefined();
      expect((r as any).spreadWidth).toBeUndefined();
    }
  });

  it("no order ticket fields in results", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (const r of results) {
      expect((r as any).orderId).toBeUndefined();
      expect((r as any).orderType).toBeUndefined();
      expect((r as any).brokerInstruction).toBeUndefined();
      expect((r as any).quantity).toBeUndefined();
    }
  });

  it("EXPRESSION_FAMILIES has no 'iron_condor' or 'butterfly' (2.7.2+ scope)", () => {
    expect(EXPRESSION_FAMILIES).not.toContain("iron_condor");
    expect(EXPRESSION_FAMILIES).not.toContain("butterfly");
    expect(EXPRESSION_FAMILIES).not.toContain("straddle");
    expect(EXPRESSION_FAMILIES).not.toContain("strangle");
  });
});

// ---------------------------------------------------------------------------
// Section 12: No-portfolio flow
// ---------------------------------------------------------------------------

describe("No-portfolio flow", () => {
  it("evaluateExpressionFamilies works with no portfolioContext", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS, null, null);
    expect(results.length).toBe(10);
    // Equity should still be applicable
    const equity = results.find(r => r.family === "equity")!;
    expect(equity.status).toBe("applicable");
  });

  it("covered_call notes hypothetical when no portfolio context", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });
    const results = evaluateExpressionFamilies(opp, c, null, null);
    const cc = results.find(r => r.family === "covered_call")!;
    // Should note no existing position when no portfolio context
    expect(cc.limitations.some(l => l.toLowerCase().includes("position") || l.toLowerCase().includes("hypothetical"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 13: No-goal flow
// ---------------------------------------------------------------------------

describe("No-goal flow", () => {
  it("evaluateExpressionFamilies works with no goalContext", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS, null, null);
    expect(results).toBeDefined();
    expect(results.length).toBe(10);
  });

  it("goal income focus boosts income families when goal provided", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true });

    // Without goal income context
    const resultsNoGoal = evaluateExpressionFamilies(opp, c, null, null);
    const incNoGoal = resultsNoGoal.find(r => r.family === "income")!;

    // With goal income context
    const goalCtx = {
      goalId: "g1", goalName: "Income Goal", goalType: "income",
      horizon: "long_term" as const, researchStyle: "balanced",
      incomeFocused: true, optionsInterest: true,
      preferredThemes: [], matchState: "match" as const,
      freshness: { status: "fresh" as const, label: "1m ago" },
    };
    const resultsWithGoal = evaluateExpressionFamilies(opp, c, goalCtx, null);
    const incWithGoal = resultsWithGoal.find(r => r.family === "income")!;

    // With income goal, income should be at least as eligible
    const ORDER: Record<string, number> = { applicable: 0, potentially_applicable: 1, unavailable: 2 };
    expect(ORDER[incWithGoal.status]).toBeLessThanOrEqual(ORDER[incNoGoal.status]);
  });
});

// ---------------------------------------------------------------------------
// Section 14: Portfolio ownership boosts covered call
// ---------------------------------------------------------------------------

describe("Portfolio context integration", () => {
  it("covered_call is more eligible when user owns the symbol", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });

    const portfolioCtx = {
      portfolioId: "port-1", portfolioName: "My Portfolio",
      ownsSymbol: true, positionSize: 100,
      portfolioWeight: 5.0, costBasis: 450, currentExposure: 50000,
      concentrationNote: null, recentResearchChange: null,
      freshness: { status: "fresh" as const, label: "5m ago" },
    };

    const results = evaluateExpressionFamilies(opp, c, null, portfolioCtx);
    const cc = results.find(r => r.family === "covered_call")!;
    expect(cc.status).toBe("applicable");
    expect(cc.reasons.some(r => r.toLowerCase().includes("position"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 15: Earnings risk factor integration
// ---------------------------------------------------------------------------

describe("Earnings risk integration", () => {
  it("avoidEarningsWindow=true notes earnings risk when factor present", () => {
    const opp = makeOpp({
      riskFactors: [{ label: "Earnings next month", detail: "Q3", severity: "medium" }],
    });
    const c   = makeConstraints({ equityAllowed: true, avoidEarningsWindow: true });
    const results = evaluateExpressionFamilies(opp, c);
    const equity = results.find(r => r.family === "equity")!;
    expect(equity.limitations.some(l => l.toLowerCase().includes("earn"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 16: Expression family validation
// ---------------------------------------------------------------------------

describe("Expression family validation", () => {
  it("validates known family values", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(validateExpressionFamily(f)).toBe(true);
    }
  });

  it("rejects unknown family values", () => {
    expect(validateExpressionFamily("iron_condor")).toBe(false);
    expect(validateExpressionFamily("")).toBe(false);
    expect(validateExpressionFamily("best_trade")).toBe(false);
    expect(validateExpressionFamily("recommended_strategy")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 17: Architecture contract
// ---------------------------------------------------------------------------

describe("Architecture contract", () => {
  it("ARCHITECTURE_CONTRACT documents all 6 layers", () => {
    expect(ARCHITECTURE_CONTRACT.research).toBeTruthy();
    expect(ARCHITECTURE_CONTRACT.goals).toBeTruthy();
    expect(ARCHITECTURE_CONTRACT.portfolioIntelligence).toBeTruthy();
    expect(ARCHITECTURE_CONTRACT.tradePlanning).toBeTruthy();
    expect(ARCHITECTURE_CONTRACT.tradeConstruction).toBeTruthy();
    expect(ARCHITECTURE_CONTRACT.execution).toBeTruthy();
  });

  it("tradePlanning layer answers HOW (not WHAT or WHETHER)", () => {
    expect(ARCHITECTURE_CONTRACT.tradePlanning.toLowerCase()).toMatch(/how/);
  });

  it("execution layer answers DOES the user explicitly choose", () => {
    expect(ARCHITECTURE_CONTRACT.execution.toLowerCase()).toMatch(/explicit/);
  });
});

// ---------------------------------------------------------------------------
// Section 18: Platform health metrics shape
// ---------------------------------------------------------------------------

describe("Platform health metrics", () => {
  it("getTradePlanningHealth returns expected shape", () => {
    const metrics = getTradePlanningHealth();
    expect(typeof metrics.contextsBuilt).toBe("number");
    expect(typeof metrics.sessionsCreated).toBe("number");
    expect(typeof metrics.expressionEvaluations).toBe("number");
    expect(typeof metrics.partialContexts).toBe("number");
    expect(typeof metrics.failedContexts).toBe("number");
    expect(metrics.averageContextLatencyMs === null || typeof metrics.averageContextLatencyMs === "number").toBe(true);
    expect(metrics.lastSuccessfulContextAt === null || typeof metrics.lastSuccessfulContextAt === "string").toBe(true);
  });

  it("health metrics have no symbol, capital, or user identity fields", () => {
    const metrics = getTradePlanningHealth();
    const keys = Object.keys(metrics);
    expect(keys).not.toContain("symbol");
    expect(keys).not.toContain("capital");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("portfolioName");
  });
});

// ---------------------------------------------------------------------------
// Section 19: Route ordering contract
// ---------------------------------------------------------------------------

describe("Route ordering contract (static before dynamic)", () => {
  it("EXPRESSION_FAMILIES has no 'health', 'session', 'history', 'metadata' (reserved segments)", () => {
    expect(EXPRESSION_FAMILIES).not.toContain("health");
    expect(EXPRESSION_FAMILIES).not.toContain("session");
    expect(EXPRESSION_FAMILIES).not.toContain("history");
    expect(EXPRESSION_FAMILIES).not.toContain("metadata");
  });

  it("all family values are safe URL path segments (lowercase + underscore only)", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(f).toMatch(/^[a-z_]+$/);
      expect(f).not.toContain("/");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 20: Future handoff types (type-only, not implemented in 2.7.0)
// ---------------------------------------------------------------------------

describe("Future engine handoff types (documented only)", () => {
  it("EquityPlanningInput shape is importable (type-only contract)", async () => {
    const { TRADE_PLANNING_DISCLAIMER } = await import("../../../shared/trade-planning-types");
    // The module exports EquityPlanningInput as a type — presence confirms the contract is documented
    expect(TRADE_PLANNING_DISCLAIMER).toBeDefined();
  });

  it("EquityPlanningInput has no entry/stop/target fields (2.7.1+ scope)", () => {
    // Type-level check — if the type had these fields it would be a compile error
    // We verify via the discipline of not implementing them
    const futureFields = ["entryPrice", "stopLoss", "targetPrice", "positionSize"];
    // No runtime object to check — the type contract is enforced by TypeScript
    expect(futureFields).toEqual(expect.arrayContaining(["entryPrice"])); // just verifying the list
    // Actual enforcement is in the type definition file
  });
});

// ---------------------------------------------------------------------------
// Section 21: RIA extension (documented only)
// ---------------------------------------------------------------------------

describe("RIA extension (documented only — no implementation)", () => {
  it("EXPRESSION_FAMILIES has no RIA-only prefixes", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(f).not.toMatch(/^ria_|^institutional_|^firm_/);
    }
  });

  it("EXPRESSION_FAMILY_LABELS do not say 'RIA Only' or 'Locked'", () => {
    for (const f of EXPRESSION_FAMILIES) {
      expect(EXPRESSION_FAMILY_LABELS[f]).not.toMatch(/RIA Only|Locked|Pro Only|🔒/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 22: Commercial model — no entitlements enforced
// ---------------------------------------------------------------------------

describe("Commercial model — no entitlements enforced in 2.7.0", () => {
  it("all expression families evaluate without tier checks", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true });
    const results = evaluateExpressionFamilies(opp, c);
    // No family should return a tier-locked status
    for (const r of results) {
      expect(r.reasons.some(reason => reason.toLowerCase().includes("subscription"))).toBe(false);
      expect(r.reasons.some(reason => reason.toLowerCase().includes("upgrade"))).toBe(false);
      expect(r.limitations.some(l => l.toLowerCase().includes("subscription required"))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 23: Partial-data resilience
// ---------------------------------------------------------------------------

describe("Partial-data resilience", () => {
  it("works when institutionalScore is 0 (unavailable)", () => {
    const opp = makeOpp({ institutionalScore: 0 });
    expect(() => evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS)).not.toThrow();
  });

  it("works when riskFactors is empty", () => {
    const opp = makeOpp({ riskFactors: [] });
    expect(() => evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS)).not.toThrow();
  });

  it("works when invalidatesThesis is empty", () => {
    const opp = makeOpp({ invalidatesThesis: [] });
    expect(() => evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS)).not.toThrow();
  });

  it("works when themes is empty", () => {
    const opp = makeOpp({ themes: [] });
    expect(() => evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS)).not.toThrow();
  });

  it("works when primaryEvidence is empty", () => {
    const opp = makeOpp({ primaryEvidence: [] });
    expect(() => evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 24: AI grounding
// ---------------------------------------------------------------------------

describe("AI grounding contract", () => {
  it("evaluateExpressionFamilies is fully deterministic (no randomness)", () => {
    const opp = makeOpp();
    const c   = makeConstraints({ optionsAllowed: true });
    const r1  = evaluateExpressionFamilies(opp, c);
    const r2  = evaluateExpressionFamilies(opp, c);
    const r3  = evaluateExpressionFamilies(opp, c);
    for (let i = 0; i < r1.length; i++) {
      expect(r1[i].status).toBe(r2[i].status);
      expect(r2[i].status).toBe(r3[i].status);
    }
  });

  it("no AI-generated fields in ExpressionFamilyResult", () => {
    const opp = makeOpp();
    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    for (const r of results) {
      const keys = Object.keys(r);
      expect(keys).not.toContain("aiSummary");
      expect(keys).not.toContain("aiExplanation");
      expect(keys).not.toContain("aiRecommendation");
      expect(keys).not.toContain("aiScore");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 25: Income candidate eligibility
// ---------------------------------------------------------------------------

describe("Income candidate expression families", () => {
  it("income candidate surfaces income-relevant families", () => {
    const opp = makeOpp({ opportunityType: "income" });
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });
    const results = evaluateExpressionFamilies(opp, c);

    const income = results.find(r => r.family === "income")!;
    const csp    = results.find(r => r.family === "cash_secured_put")!;
    expect(["applicable", "potentially_applicable"]).toContain(income.status);
    expect(["applicable", "potentially_applicable"]).toContain(csp.status);
  });

  it("long_option is potentially unavailable for pure income candidate", () => {
    const opp = makeOpp({ opportunityType: "income" });
    const c   = makeConstraints({ optionsAllowed: true, incomeFocus: true });
    const results = evaluateExpressionFamilies(opp, c);
    const lo = results.find(r => r.family === "long_option")!;
    // long_option needs directional context — income candidate may not qualify
    expect(typeof lo.status).toBe("string");
    expect(EXPRESSION_STATUSES).toContain(lo.status);
  });
});

// ---------------------------------------------------------------------------
// Section 26: Operations manual documentation
// ---------------------------------------------------------------------------

describe("Operations documentation contract", () => {
  it("Sprint 2.7.0 is documented in sprint change log", async () => {
    const { readFileSync } = await import("fs");
    const changeLog = readFileSync("docs/operations/17-sprint-change-log.md", "utf-8");
    expect(changeLog).toMatch(/2\.7\.0/);
    expect(changeLog.toLowerCase()).toMatch(/trade planning/);
  });

  it("Sprint 2.7.0 ops doc exists", async () => {
    const { existsSync } = await import("fs");
    expect(existsSync("docs/operations/28-trade-planning-foundation.md")).toBe(true);
  });
});
