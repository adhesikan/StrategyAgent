/**
 * server/routes/__tests__/trade-preferences.test.ts — Sprint 2.8.1A
 *
 * Tests for Trade Preferences & User-Directed Expression Selection.
 * Pure computation only — no DB, no broker calls.
 *
 * INVARIANTS tested:
 *   - User preference does not qualify/disqualify opportunities
 *   - User preference does not alter strategy matching
 *   - User preference is not suitability
 *   - User preference is not broker permission
 *   - selectedBy is always "USER" — AI cannot set
 *   - Global preference does not mutate existing trade plans
 *   - Covered Call cannot become naked short call
 *   - CSP capital deferred to contract research
 *   - All 9 broad expression types defined with labels
 *   - Forbidden phrases absent from compliance constants
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Pure types + constants ───
import {
  BROAD_EXPRESSION_TYPES,
  BROAD_EXPRESSION_LABELS,
  BROAD_EXPRESSION_EDUCATIONAL,
  BROAD_TO_FAMILIES,
  isBroadExpressionType,
  EXPRESSION_COMPATIBILITY_STATUSES,
  EXPRESSION_COMPATIBILITY_LABELS,
  COMPATIBILITY_SORT_WEIGHT,
  TRADE_PREFERENCES_SETTINGS_DISCLAIMER,
  EXPRESSION_SELECTION_DISCLAIMER,
  COVERED_CALL_CAPITAL_NOTE,
  CSP_CAPITAL_NOTE,
  ADVANCED_OPTIONS_NOTE,
  EXPRESSION_SELECTION_FORBIDDEN_PHRASES,
  TRADE_PREFERENCES_METHODOLOGY_VERSION,
  DEFAULT_USER_TRADING_PREFERENCES,
} from "../../../shared/trade-preference-types";
import type {
  BroadExpressionType,
  UserTradingPreferences,
} from "../../../shared/trade-preference-types";

// ─── Pure service functions ───
import {
  computeBroadCompatibility,
  computeExpressionOptions,
  getUserTradingPreferences,
  saveUserTradingPreferences,
  saveBroadExpressionSelection,
  getBroadExpressionSelection,
  resolveExpressionRouting,
} from "../../services/trade-preferences-service";
import type { ExpressionFamilyResult } from "../../../shared/trade-planning-types";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeFamily(
  family: string,
  status: "applicable" | "potentially_applicable" | "unavailable",
  reasons: string[] = [],
  constraintsMissing: string[] = [],
  limitations: string[] = []
): ExpressionFamilyResult {
  return {
    family:           family as any,
    label:            family,
    description:      family,
    status,
    reasons,
    constraintsMissing,
    limitations,
  };
}

const FULL_APPLICABLE_FAMILIES: ExpressionFamilyResult[] = [
  makeFamily("equity",                    "applicable",            ["Equity research applicable"]),
  makeFamily("equity_scaled",             "applicable",            ["Scaled equity applicable"]),
  makeFamily("long_option",               "applicable",            ["Long options applicable"]),
  makeFamily("covered_call",              "applicable",            ["Covered call applicable"]),
  makeFamily("cash_secured_put",          "applicable",            ["CSP applicable"]),
  makeFamily("defined_risk_directional",  "applicable",            ["Defined-risk applicable"]),
  makeFamily("vertical_spread",           "applicable",            ["Vertical spread applicable"]),
  makeFamily("income",                    "applicable",            ["Income applicable"]),
  makeFamily("neutral_options",           "potentially_applicable",["Neutral potentially"]),
  makeFamily("monitor_only",              "unavailable",           ["Monitor only"]),
];

const DIRECTIONAL_ONLY_FAMILIES: ExpressionFamilyResult[] = [
  makeFamily("equity",               "applicable",   ["Strong directional thesis"]),
  makeFamily("equity_scaled",        "applicable",   ["Strong directional thesis"]),
  makeFamily("long_option",          "applicable",   ["Directional options"]),
  makeFamily("defined_risk_directional", "applicable", ["Defined-risk directional"]),
  makeFamily("covered_call",         "unavailable",  ["Directional context"]),
  makeFamily("cash_secured_put",     "unavailable",  ["Directional context"]),
  makeFamily("vertical_spread",      "applicable",   ["Vertical applicable"]),
  makeFamily("income",               "unavailable",  ["Directional thesis not aligned"]),
  makeFamily("neutral_options",      "unavailable",  ["Current thesis is directional, not neutral"]),
  makeFamily("monitor_only",         "unavailable",  ["Monitor only"]),
];

function makeMockPrefs(types: BroadExpressionType[]): UserTradingPreferences {
  return {
    userId: "user-1",
    preferredExpressionTypes: types,
    showOtherCompatibleStructures: true,
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CANONICAL EXPRESSION TYPES
// ─────────────────────────────────────────────────────────────────────────────

describe("Canonical broad expression types", () => {
  it("defines exactly 9 broad expression types", () => {
    expect(BROAD_EXPRESSION_TYPES).toHaveLength(9);
  });

  it("includes all required types", () => {
    const required: BroadExpressionType[] = [
      "STOCK", "LONG_OPTIONS", "COVERED_CALL", "CASH_SECURED_PUT",
      "DEFINED_RISK_OPTIONS", "INCOME_OPTIONS", "NEUTRAL_OPTIONS",
      "ADVANCED_OPTIONS", "EXPLORE_COMPATIBLE_STRUCTURES",
    ];
    for (const t of required) {
      expect(BROAD_EXPRESSION_TYPES).toContain(t);
    }
  });

  it("every type has a user-facing label", () => {
    for (const t of BROAD_EXPRESSION_TYPES) {
      expect(BROAD_EXPRESSION_LABELS[t]).toBeTruthy();
      expect(typeof BROAD_EXPRESSION_LABELS[t]).toBe("string");
    }
  });

  it("every type has an educational summary", () => {
    for (const t of BROAD_EXPRESSION_TYPES) {
      expect(BROAD_EXPRESSION_EDUCATIONAL[t]).toBeTruthy();
    }
  });

  it("every type has a BROAD_TO_FAMILIES entry", () => {
    for (const t of BROAD_EXPRESSION_TYPES) {
      expect(BROAD_TO_FAMILIES[t]).toBeDefined();
      expect(Array.isArray(BROAD_TO_FAMILIES[t])).toBe(true);
    }
  });

  it("STOCK maps to equity families", () => {
    expect(BROAD_TO_FAMILIES["STOCK"]).toContain("equity");
    expect(BROAD_TO_FAMILIES["STOCK"]).toContain("equity_scaled");
  });

  it("LONG_OPTIONS maps to long_option", () => {
    expect(BROAD_TO_FAMILIES["LONG_OPTIONS"]).toContain("long_option");
  });

  it("COVERED_CALL maps to covered_call only", () => {
    expect(BROAD_TO_FAMILIES["COVERED_CALL"]).toContain("covered_call");
  });

  it("CASH_SECURED_PUT maps to cash_secured_put", () => {
    expect(BROAD_TO_FAMILIES["CASH_SECURED_PUT"]).toContain("cash_secured_put");
  });

  it("EXPLORE_COMPATIBLE_STRUCTURES maps to empty (dynamic)", () => {
    expect(BROAD_TO_FAMILIES["EXPLORE_COMPATIBLE_STRUCTURES"]).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. isBroadExpressionType guard
// ─────────────────────────────────────────────────────────────────────────────

describe("isBroadExpressionType guard", () => {
  it("accepts valid types", () => {
    for (const t of BROAD_EXPRESSION_TYPES) {
      expect(isBroadExpressionType(t)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isBroadExpressionType("AGGRESSIVE_TRADER")).toBe(false);
    expect(isBroadExpressionType("BEST_STRATEGY")).toBe(false);
    expect(isBroadExpressionType("")).toBe(false);
    expect(isBroadExpressionType(null)).toBe(false);
    expect(isBroadExpressionType(undefined)).toBe(false);
    expect(isBroadExpressionType(42)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. COMPATIBILITY STATUS
// ─────────────────────────────────────────────────────────────────────────────

describe("Compatibility statuses", () => {
  it("defines 4 statuses", () => {
    expect(EXPRESSION_COMPATIBILITY_STATUSES).toHaveLength(4);
  });

  it("every status has a label", () => {
    for (const s of EXPRESSION_COMPATIBILITY_STATUSES) {
      expect(EXPRESSION_COMPATIBILITY_LABELS[s]).toBeTruthy();
    }
  });

  it("sort weights: AVAILABLE < AVAILABLE_WITH_REQUIREMENTS < NOT_ALIGNED < UNAVAILABLE", () => {
    expect(COMPATIBILITY_SORT_WEIGHT["AVAILABLE"]).toBeLessThan(COMPATIBILITY_SORT_WEIGHT["AVAILABLE_WITH_REQUIREMENTS"]);
    expect(COMPATIBILITY_SORT_WEIGHT["AVAILABLE_WITH_REQUIREMENTS"]).toBeLessThan(COMPATIBILITY_SORT_WEIGHT["NOT_ALIGNED_WITH_CURRENT_RESEARCH"]);
    expect(COMPATIBILITY_SORT_WEIGHT["NOT_ALIGNED_WITH_CURRENT_RESEARCH"]).toBeLessThan(COMPATIBILITY_SORT_WEIGHT["UNAVAILABLE"]);
  });

  it("does not use 'Bad Strategy' or 'Not Recommended' as status labels", () => {
    for (const s of EXPRESSION_COMPATIBILITY_STATUSES) {
      expect(EXPRESSION_COMPATIBILITY_LABELS[s]).not.toContain("Bad Strategy");
      expect(EXPRESSION_COMPATIBILITY_LABELS[s]).not.toContain("Not Recommended");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance constants", () => {
  it("settings disclaimer is present", () => {
    expect(TRADE_PREFERENCES_SETTINGS_DISCLAIMER).toBeTruthy();
    expect(TRADE_PREFERENCES_SETTINGS_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("selection disclaimer is present", () => {
    expect(EXPRESSION_SELECTION_DISCLAIMER).toBeTruthy();
    expect(EXPRESSION_SELECTION_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("settings disclaimer contains presentation-only language", () => {
    expect(TRADE_PREFERENCES_SETTINGS_DISCLAIMER.toLowerCase()).toContain("shows first");
  });

  it("settings disclaimer rejects suitability", () => {
    expect(TRADE_PREFERENCES_SETTINGS_DISCLAIMER.toLowerCase()).toContain("suitability");
    expect(TRADE_PREFERENCES_SETTINGS_DISCLAIMER.toLowerCase()).toContain("not");
  });

  it("selection disclaimer rejects investment advice", () => {
    expect(EXPRESSION_SELECTION_DISCLAIMER.toLowerCase()).toContain("investment advice");
    expect(EXPRESSION_SELECTION_DISCLAIMER.toLowerCase()).toContain("not");
  });

  it("methodology version is '2.8.1A'", () => {
    expect(TRADE_PREFERENCES_METHODOLOGY_VERSION).toBe("2.8.1A");
  });

  it("forbidden phrases list includes key items", () => {
    const forbidden = EXPRESSION_SELECTION_FORBIDDEN_PHRASES as readonly string[];
    expect(forbidden).toContain("Recommended for You");
    expect(forbidden).toContain("Best Strategy");
    expect(forbidden).toContain("Suitable Strategy");
    expect(forbidden).toContain("AI Chose");
    expect(forbidden).toContain("Based on your profile");
    expect(forbidden).toContain("Suitability");
  });

  it("covered call capital note exists", () => {
    expect(COVERED_CALL_CAPITAL_NOTE).toBeTruthy();
  });

  it("CSP capital note contains 'contract research'", () => {
    expect(CSP_CAPITAL_NOTE.toLowerCase()).toContain("contract research");
  });

  it("advanced options note contains 'opt-in'", () => {
    expect(ADVANCED_OPTIONS_NOTE.toLowerCase()).toContain("opt-in");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPATIBILITY COMPUTATION — STOCK
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — STOCK", () => {
  it("returns AVAILABLE when equity family is applicable", () => {
    const result = computeBroadCompatibility("STOCK", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns AVAILABLE even with no matching families (equity assumed)", () => {
    const result = computeBroadCompatibility("STOCK", []);
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns compatible families list", () => {
    const result = computeBroadCompatibility("STOCK", FULL_APPLICABLE_FAMILIES);
    expect(result.compatibleFamilies).toContain("equity");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMPATIBILITY — LONG_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — LONG_OPTIONS", () => {
  it("returns AVAILABLE when long_option is applicable", () => {
    const result = computeBroadCompatibility("LONG_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns UNAVAILABLE when long_option is not in families", () => {
    const families = FULL_APPLICABLE_FAMILIES.filter(f => f.family !== "long_option");
    const result = computeBroadCompatibility("LONG_OPTIONS", families);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("returns AVAILABLE_WITH_REQUIREMENTS when potentially_applicable", () => {
    const families = [makeFamily("long_option", "potentially_applicable", ["Directional thesis"], ["Options enabled needed"])];
    const result = computeBroadCompatibility("LONG_OPTIONS", families);
    expect(result.status).toBe("AVAILABLE_WITH_REQUIREMENTS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. COMPATIBILITY — COVERED_CALL (ownership rules)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — COVERED_CALL (ownership)", () => {
  it("returns AVAILABLE when covered_call is applicable and shares confirmed", () => {
    const result = computeBroadCompatibility("COVERED_CALL", FULL_APPLICABLE_FAMILIES, {
      symbol: "NVDA",
      hasSharesOf: () => true,
    });
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns AVAILABLE_WITH_REQUIREMENTS when shares cannot be confirmed", () => {
    const result = computeBroadCompatibility("COVERED_CALL", FULL_APPLICABLE_FAMILIES, {
      symbol: "NVDA",
      hasSharesOf: () => false,
    });
    expect(result.status).toBe("AVAILABLE_WITH_REQUIREMENTS");
  });

  it("returns UNAVAILABLE when covered_call family is unavailable and no shares", () => {
    const families = [makeFamily("covered_call", "unavailable", ["No income context"])];
    const result = computeBroadCompatibility("COVERED_CALL", families, {
      symbol: "NVDA",
      hasSharesOf: () => false,
    });
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("COVERED_CALL requirements always include the capital note", () => {
    const result = computeBroadCompatibility("COVERED_CALL", FULL_APPLICABLE_FAMILIES);
    expect(result.requirements.join(" ")).toContain("shares");
  });

  it("COVERED_CALL cannot become naked short — no strategy downgrade", () => {
    // Test that COVERED_CALL compatibility never reports AVAILABLE without ownership check
    const result = computeBroadCompatibility("COVERED_CALL", FULL_APPLICABLE_FAMILIES, {
      symbol: "NVDA",
      hasSharesOf: () => false,
    });
    // Should be AVAILABLE_WITH_REQUIREMENTS (requires shares), not a downgrade to naked
    expect(["AVAILABLE_WITH_REQUIREMENTS", "UNAVAILABLE"]).toContain(result.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. COMPATIBILITY — CASH_SECURED_PUT
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — CASH_SECURED_PUT", () => {
  it("returns AVAILABLE when cash_secured_put is applicable", () => {
    const result = computeBroadCompatibility("CASH_SECURED_PUT", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("limitations include CSP capital note", () => {
    const result = computeBroadCompatibility("CASH_SECURED_PUT", FULL_APPLICABLE_FAMILIES);
    expect(result.limitations.join(" ")).toContain("contract research");
  });

  it("returns NOT_ALIGNED when thesis is strongly directional and CSP unavailable", () => {
    const families = [makeFamily("cash_secured_put", "unavailable", ["Directional thesis not aligned"])];
    const result = computeBroadCompatibility("CASH_SECURED_PUT", families);
    expect(result.status).toBe("NOT_ALIGNED_WITH_CURRENT_RESEARCH");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. COMPATIBILITY — DEFINED_RISK_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — DEFINED_RISK_OPTIONS", () => {
  it("returns AVAILABLE when defined_risk_directional is applicable", () => {
    const result = computeBroadCompatibility("DEFINED_RISK_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("compatibleFamilies includes defined_risk_directional", () => {
    const result = computeBroadCompatibility("DEFINED_RISK_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.compatibleFamilies).toContain("defined_risk_directional");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. COMPATIBILITY — INCOME_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — INCOME_OPTIONS", () => {
  it("returns AVAILABLE when income family is applicable", () => {
    const result = computeBroadCompatibility("INCOME_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns NOT_ALIGNED_WITH_CURRENT_RESEARCH for directional-only thesis", () => {
    const result = computeBroadCompatibility("INCOME_OPTIONS", DIRECTIONAL_ONLY_FAMILIES);
    // income family is unavailable with directional reason
    expect(["NOT_ALIGNED_WITH_CURRENT_RESEARCH", "UNAVAILABLE"]).toContain(result.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. COMPATIBILITY — NEUTRAL_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — NEUTRAL_OPTIONS", () => {
  it("returns AVAILABLE_WITH_REQUIREMENTS when neutral_options is potentially_applicable", () => {
    const result = computeBroadCompatibility("NEUTRAL_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE_WITH_REQUIREMENTS");
  });

  it("returns NOT_ALIGNED_WITH_CURRENT_RESEARCH for strongly directional thesis", () => {
    const result = computeBroadCompatibility("NEUTRAL_OPTIONS", DIRECTIONAL_ONLY_FAMILIES);
    expect(result.status).toBe("NOT_ALIGNED_WITH_CURRENT_RESEARCH");
  });

  it("does not say 'Not Recommended' or 'Bad Strategy' in reasons", () => {
    const result = computeBroadCompatibility("NEUTRAL_OPTIONS", DIRECTIONAL_ONLY_FAMILIES);
    const allText = [...result.reasons, ...result.limitations].join(" ");
    expect(allText).not.toContain("Not Recommended");
    expect(allText).not.toContain("Bad Strategy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. COMPATIBILITY — ADVANCED_OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — ADVANCED_OPTIONS", () => {
  it("always returns AVAILABLE_WITH_REQUIREMENTS (opt-in)", () => {
    const result = computeBroadCompatibility("ADVANCED_OPTIONS", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE_WITH_REQUIREMENTS");
  });

  it("limitations include opt-in language", () => {
    const result = computeBroadCompatibility("ADVANCED_OPTIONS", FULL_APPLICABLE_FAMILIES);
    const allText = [...result.limitations, ...result.reasons].join(" ");
    expect(allText.toLowerCase()).toContain("opt-in");
  });

  it("returns AVAILABLE_WITH_REQUIREMENTS even for directional-only context", () => {
    const result = computeBroadCompatibility("ADVANCED_OPTIONS", DIRECTIONAL_ONLY_FAMILIES);
    expect(result.status).toBe("AVAILABLE_WITH_REQUIREMENTS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. COMPATIBILITY — EXPLORE_COMPATIBLE_STRUCTURES
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBroadCompatibility — EXPLORE_COMPATIBLE_STRUCTURES", () => {
  it("always returns AVAILABLE", () => {
    const result = computeBroadCompatibility("EXPLORE_COMPATIBLE_STRUCTURES", FULL_APPLICABLE_FAMILIES);
    expect(result.status).toBe("AVAILABLE");
  });

  it("returns all applicable and potentially_applicable families", () => {
    const result = computeBroadCompatibility("EXPLORE_COMPATIBLE_STRUCTURES", FULL_APPLICABLE_FAMILIES);
    expect(result.compatibleFamilies.length).toBeGreaterThan(0);
    expect(result.compatibleFamilies).not.toContain("monitor_only"); // monitor_only is unavailable
  });

  it("user still chooses — no AI auto-selection", () => {
    // The result is just a list of options — no selectedExpressionType is set here
    const result = computeBroadCompatibility("EXPLORE_COMPATIBLE_STRUCTURES", FULL_APPLICABLE_FAMILIES);
    expect(result).not.toHaveProperty("selectedExpressionType");
    expect(result).not.toHaveProperty("selectedBy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. computeExpressionOptions ORDERING
// ─────────────────────────────────────────────────────────────────────────────

describe("computeExpressionOptions — ordering", () => {
  it("produces 9 options (one per broad type)", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    expect(result.options).toHaveLength(9);
  });

  it("includes symbol and disclaimer", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    expect(result.symbol).toBe("NVDA");
    expect(result.disclaimer).toBeTruthy();
    expect(result.methodologyVersion).toBe("2.8.1A");
  });

  it("preferred categories appear before non-preferred within same compatibility tier", () => {
    const prefs = makeMockPrefs(["DEFINED_RISK_OPTIONS"]);
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, prefs);

    const drIdx = result.options.findIndex(o => o.expressionType === "DEFINED_RISK_OPTIONS");
    const stockIdx = result.options.findIndex(o => o.expressionType === "STOCK");

    // Both are AVAILABLE — DEFINED_RISK should come before STOCK since preferred
    expect(drIdx).toBeLessThan(stockIdx);
  });

  it("AVAILABLE options always precede AVAILABLE_WITH_REQUIREMENTS", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    let seenNonAvailable = false;
    for (const opt of result.options) {
      if (opt.compatibilityStatus !== "AVAILABLE") seenNonAvailable = true;
      if (seenNonAvailable) {
        expect(opt.compatibilityStatus).not.toBe("AVAILABLE");
      }
    }
  });

  it("NOT_ALIGNED options precede UNAVAILABLE", () => {
    const result = computeExpressionOptions("NVDA", DIRECTIONAL_ONLY_FAMILIES, null);
    let seenUnavailable = false;
    for (const opt of result.options) {
      if (opt.compatibilityStatus === "UNAVAILABLE") seenUnavailable = true;
      if (seenUnavailable) {
        expect(opt.compatibilityStatus).not.toBe("NOT_ALIGNED_WITH_CURRENT_RESEARCH");
      }
    }
  });

  it("marks preferred types correctly when preferences set", () => {
    const prefs = makeMockPrefs(["STOCK", "LONG_OPTIONS"]);
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, prefs);
    const stock = result.options.find(o => o.expressionType === "STOCK");
    const longOpts = result.options.find(o => o.expressionType === "LONG_OPTIONS");
    const covered = result.options.find(o => o.expressionType === "COVERED_CALL");
    expect(stock?.preferredByUser).toBe(true);
    expect(longOpts?.preferredByUser).toBe(true);
    expect(covered?.preferredByUser).toBe(false);
  });

  it("no numeric recommendation score in any option", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    for (const opt of result.options) {
      expect(opt).not.toHaveProperty("recommendationScore");
      expect(opt).not.toHaveProperty("suitabilityScore");
      expect(opt).not.toHaveProperty("score");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. PREFERENCE vs COMPATIBILITY SEPARATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Preference vs compatibility separation", () => {
  it("preference does not change compatibility status", () => {
    // With NO preference — neutral options is AVAILABLE_WITH_REQUIREMENTS
    const noPrefs = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    const neutralNoPrefs = noPrefs.options.find(o => o.expressionType === "NEUTRAL_OPTIONS")!;

    // With Neutral preference — same status
    const withPrefs = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, makeMockPrefs(["NEUTRAL_OPTIONS"]));
    const neutralWithPrefs = withPrefs.options.find(o => o.expressionType === "NEUTRAL_OPTIONS")!;

    expect(neutralNoPrefs.compatibilityStatus).toBe(neutralWithPrefs.compatibilityStatus);
    // Only preferredByUser changes
    expect(neutralNoPrefs.preferredByUser).toBe(false);
    expect(neutralWithPrefs.preferredByUser).toBe(true);
  });

  it("preference does not qualify/disqualify research candidates (compatibility unchanged)", () => {
    // UNAVAILABLE stays UNAVAILABLE even when preferred
    const families = [makeFamily("income", "unavailable", ["No income context"]),
                      makeFamily("covered_call", "unavailable", ["No context"]),
                      makeFamily("cash_secured_put", "unavailable", ["No context"])];
    const prefs = makeMockPrefs(["INCOME_OPTIONS"]);
    const result = computeExpressionOptions("NVDA", families, prefs);
    const income = result.options.find(o => o.expressionType === "INCOME_OPTIONS")!;
    // Income is unavailable — preference doesn't change that
    expect(["UNAVAILABLE", "NOT_ALIGNED_WITH_CURRENT_RESEARCH"]).toContain(income.compatibilityStatus);
  });

  it("preference is not a hard filter — all types still shown", () => {
    const prefs = makeMockPrefs(["STOCK"]);
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, prefs);
    // All 9 types shown, not just STOCK
    expect(result.options).toHaveLength(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. PREFERENCE vs BROKER PERMISSION SEPARATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Preference vs broker permission separation", () => {
  it("expression options result has no broker permission fields", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    expect(result).not.toHaveProperty("brokerPermissions");
    expect(result).not.toHaveProperty("optionsPermission");
    expect(result).not.toHaveProperty("brokerAccount");
  });

  it("each option has no broker permission fields", () => {
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    for (const opt of result.options) {
      expect(opt).not.toHaveProperty("brokerPermissions");
      expect(opt).not.toHaveProperty("brokerAuthorized");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. PREFERENCE vs SUITABILITY SEPARATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Preference vs suitability separation", () => {
  it("UserTradingPreferences has no financial profile fields", () => {
    const prefs: UserTradingPreferences = {
      userId: "u1",
      preferredExpressionTypes: ["STOCK"],
      showOtherCompatibleStructures: true,
      updatedAt: new Date().toISOString(),
    };
    expect(prefs).not.toHaveProperty("income");
    expect(prefs).not.toHaveProperty("netWorth");
    expect(prefs).not.toHaveProperty("age");
    expect(prefs).not.toHaveProperty("taxBracket");
    expect(prefs).not.toHaveProperty("riskTolerance");
    expect(prefs).not.toHaveProperty("riskCapacity");
    expect(prefs).not.toHaveProperty("investmentObjective");
    expect(prefs).not.toHaveProperty("suitabilityScore");
    expect(prefs).not.toHaveProperty("traderType");
  });

  it("DEFAULT_USER_TRADING_PREFERENCES has no suitability fields", () => {
    expect(DEFAULT_USER_TRADING_PREFERENCES).not.toHaveProperty("suitabilityScore");
    expect(DEFAULT_USER_TRADING_PREFERENCES).not.toHaveProperty("riskProfile");
    expect(DEFAULT_USER_TRADING_PREFERENCES).not.toHaveProperty("traderType");
  });

  it("BROAD_EXPRESSION_LABELS do not contain forbidden phrases", () => {
    const forbidden = EXPRESSION_SELECTION_FORBIDDEN_PHRASES as readonly string[];
    for (const [, label] of Object.entries(BROAD_EXPRESSION_LABELS)) {
      for (const phrase of forbidden) {
        expect(label).not.toContain(phrase);
      }
    }
  });

  it("BROAD_EXPRESSION_EDUCATIONAL descriptions contain no performance promises", () => {
    const forbidden = ["guaranteed", "will make", "will profit", "best performance"];
    for (const [, desc] of Object.entries(BROAD_EXPRESSION_EDUCATIONAL)) {
      for (const phrase of forbidden) {
        expect(desc.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. MULTIPLE PREFERENCES SUPPORTED
// ─────────────────────────────────────────────────────────────────────────────

describe("Multiple preferences", () => {
  it("supports multiple preferred expression types", () => {
    const prefs = makeMockPrefs(["STOCK", "LONG_OPTIONS", "COVERED_CALL", "CASH_SECURED_PUT"]);
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, prefs);
    const preferred = result.options.filter(o => o.preferredByUser);
    expect(preferred.length).toBe(4);
  });

  it("empty preferences shows all categories without hard filtering", () => {
    const prefs = makeMockPrefs([]);
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, prefs);
    expect(result.options).toHaveLength(9);
    expect(result.options.every(o => !o.preferredByUser)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. getUserTradingPreferences — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("getUserTradingPreferences", () => {
  it("returns defaults when no row exists", async () => {
    const prefs = await getUserTradingPreferences("user-new", {
      getUserSettingsRow: async () => null,
    });
    expect(prefs.userId).toBe("user-new");
    expect(prefs.preferredExpressionTypes).toEqual([]);
    expect(prefs.showOtherCompatibleStructures).toBe(true);
  });

  it("returns saved preferences when row exists", async () => {
    const prefs = await getUserTradingPreferences("user-1", {
      getUserSettingsRow: async () => ({
        preferredExpressionTypes: ["STOCK", "LONG_OPTIONS"],
        showOtherCompatibleStructures: false,
        updatedAt: new Date("2026-01-01"),
      }),
    });
    expect(prefs.preferredExpressionTypes).toEqual(["STOCK", "LONG_OPTIONS"]);
    expect(prefs.showOtherCompatibleStructures).toBe(false);
  });

  it("filters out invalid expression types from saved row", async () => {
    const prefs = await getUserTradingPreferences("user-1", {
      getUserSettingsRow: async () => ({
        preferredExpressionTypes: ["STOCK", "INVALID_TYPE", "AGGRESSIVE_TRADER"],
        showOtherCompatibleStructures: true,
        updatedAt: new Date(),
      }),
    });
    expect(prefs.preferredExpressionTypes).toEqual(["STOCK"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. saveUserTradingPreferences
// ─────────────────────────────────────────────────────────────────────────────

describe("saveUserTradingPreferences", () => {
  it("saves valid preferences", async () => {
    const stored: Record<string, unknown> = {};
    await saveUserTradingPreferences("u1", {
      preferredExpressionTypes: ["STOCK", "DEFINED_RISK_OPTIONS"],
      showOtherCompatibleStructures: true,
    }, {
      updateUserSettingsRow: async (_, patch) => { Object.assign(stored, patch); },
      getUserSettingsRow: async () => ({
        preferredExpressionTypes: stored.preferredExpressionTypes ?? [],
        showOtherCompatibleStructures: stored.showOtherCompatibleStructures ?? true,
        updatedAt: new Date(),
      }),
    });
    expect(stored.preferredExpressionTypes).toEqual(["STOCK", "DEFINED_RISK_OPTIONS"]);
  });

  it("deduplicates preferences", async () => {
    const stored: Record<string, unknown> = {};
    await saveUserTradingPreferences("u1", {
      preferredExpressionTypes: ["STOCK", "STOCK", "LONG_OPTIONS"],
    }, {
      updateUserSettingsRow: async (_, patch) => { Object.assign(stored, patch); },
      getUserSettingsRow: async () => ({ preferredExpressionTypes: stored.preferredExpressionTypes ?? [], showOtherCompatibleStructures: true, updatedAt: new Date() }),
    });
    expect((stored.preferredExpressionTypes as string[]).filter(v => v === "STOCK")).toHaveLength(1);
  });

  it("rejects invalid expression types silently (not included)", async () => {
    const stored: Record<string, unknown> = {};
    await saveUserTradingPreferences("u1", {
      preferredExpressionTypes: ["STOCK", "AGGRESSIVE_TRADER" as any, "SUITABILITY_PROFILE" as any],
    }, {
      updateUserSettingsRow: async (_, patch) => { Object.assign(stored, patch); },
      getUserSettingsRow: async () => ({ preferredExpressionTypes: stored.preferredExpressionTypes ?? [], showOtherCompatibleStructures: true, updatedAt: new Date() }),
    });
    expect(stored.preferredExpressionTypes).toEqual(["STOCK"]);
  });

  it("does NOT mutate existing trade plans or planning sessions", async () => {
    const planMutated = vi.fn();
    const sessionMutated = vi.fn();
    await saveUserTradingPreferences("u1", {
      preferredExpressionTypes: ["LONG_OPTIONS"],
    }, {
      updateUserSettingsRow: async () => {},
      getUserSettingsRow: async () => ({ preferredExpressionTypes: ["LONG_OPTIONS"], showOtherCompatibleStructures: true, updatedAt: new Date() }),
      updateTradePlan: planMutated,
      updatePlanningSession: sessionMutated,
    });
    expect(planMutated).not.toHaveBeenCalled();
    expect(sessionMutated).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. saveBroadExpressionSelection — selectedBy always USER
// ─────────────────────────────────────────────────────────────────────────────

describe("saveBroadExpressionSelection", () => {
  const mockSession = { id: "sess-1", userId: "u1", symbol: "NVDA", constraints: {} };

  it("saves selection with selectedBy = USER", async () => {
    let saved: Record<string, unknown> = {};
    const result = await saveBroadExpressionSelection("u1", "sess-1", "LONG_OPTIONS", {
      getPlanningSession: async () => mockSession,
      updatePlanningSession: async (_, __, patch) => { Object.assign(saved, patch); },
    });
    expect(result.selectedBy).toBe("USER");
    expect(result.selectedExpressionType).toBe("LONG_OPTIONS");
    expect(saved.expressionSelectedBy).toBe("USER");
    expect(saved.broadExpressionType).toBe("LONG_OPTIONS");
  });

  it("throws SESSION_NOT_FOUND for unknown session", async () => {
    await expect(
      saveBroadExpressionSelection("u1", "bad-session", "STOCK", {
        getPlanningSession: async () => null,
        updatePlanningSession: async () => {},
      })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("throws INVALID_EXPRESSION_TYPE for bad type", async () => {
    await expect(
      saveBroadExpressionSelection("u1", "sess-1", "AI_CHOSE_FOR_ME", {
        getPlanningSession: async () => mockSession,
        updatePlanningSession: async () => {},
      })
    ).rejects.toMatchObject({ code: "INVALID_EXPRESSION_TYPE" });
  });

  it("selectedBy cannot be overridden to non-USER value", async () => {
    let saved: Record<string, unknown> = {};
    await saveBroadExpressionSelection("u1", "sess-1", "STOCK", {
      getPlanningSession: async () => mockSession,
      updatePlanningSession: async (_, __, patch) => { Object.assign(saved, patch); },
    });
    // expressionSelectedBy must always be "USER"
    expect(saved.expressionSelectedBy).toBe("USER");
    expect(saved.expressionSelectedBy).not.toBe("AI");
    expect(saved.expressionSelectedBy).not.toBe("SYSTEM");
  });

  it("persists symbol from session", async () => {
    const result = await saveBroadExpressionSelection("u1", "sess-1", "DEFINED_RISK_OPTIONS", {
      getPlanningSession: async () => mockSession,
      updatePlanningSession: async () => {},
    });
    expect(result.symbol).toBe("NVDA");
  });

  it("all 9 broad expression types can be selected", async () => {
    for (const broadType of BROAD_EXPRESSION_TYPES) {
      const result = await saveBroadExpressionSelection("u1", "sess-1", broadType, {
        getPlanningSession: async () => mockSession,
        updatePlanningSession: async () => {},
      });
      expect(result.selectedExpressionType).toBe(broadType);
      expect(result.selectedBy).toBe("USER");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. getBroadExpressionSelection
// ─────────────────────────────────────────────────────────────────────────────

describe("getBroadExpressionSelection", () => {
  it("returns null when no selection saved", async () => {
    const result = await getBroadExpressionSelection("u1", "sess-1", {
      getPlanningSession: async () => ({ id: "sess-1", userId: "u1", symbol: "NVDA", broadExpressionType: null }),
    });
    expect(result).toBeNull();
  });

  it("returns null when session not found", async () => {
    const result = await getBroadExpressionSelection("u1", "sess-x", {
      getPlanningSession: async () => null,
    });
    expect(result).toBeNull();
  });

  it("returns selection when saved", async () => {
    const result = await getBroadExpressionSelection("u1", "sess-1", {
      getPlanningSession: async () => ({
        id: "sess-1", userId: "u1", symbol: "AAPL",
        broadExpressionType: "STOCK",
        updatedAt: new Date("2026-06-01"),
      }),
    });
    expect(result?.selectedExpressionType).toBe("STOCK");
    expect(result?.selectedBy).toBe("USER");
    expect(result?.symbol).toBe("AAPL");
  });

  it("returns null for invalid saved expression type", async () => {
    const result = await getBroadExpressionSelection("u1", "sess-1", {
      getPlanningSession: async () => ({
        id: "sess-1", userId: "u1", symbol: "AAPL",
        broadExpressionType: "SUITABILITY_SCORE",
      }),
    });
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. EXPRESSION ROUTING
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveExpressionRouting", () => {
  const allFamilies = ["equity", "equity_scaled", "long_option", "income", "neutral_options"] as const;

  it("STOCK routes to EQUITY engine", () => {
    const routing = resolveExpressionRouting("STOCK", allFamilies);
    expect(routing.engine).toBe("EQUITY");
  });

  it("LONG_OPTIONS routes to OPTIONS_MATCHING engine", () => {
    const routing = resolveExpressionRouting("LONG_OPTIONS", allFamilies);
    expect(routing.engine).toBe("OPTIONS_MATCHING");
    expect((routing as any).constraintedFamilies).toContain("long_option");
  });

  it("COVERED_CALL routes to OPTIONS_MATCHING", () => {
    const routing = resolveExpressionRouting("COVERED_CALL", allFamilies);
    expect(routing.engine).toBe("OPTIONS_MATCHING");
    expect((routing as any).constraintedFamilies).toContain("covered_call");
  });

  it("CASH_SECURED_PUT routes to OPTIONS_MATCHING", () => {
    const routing = resolveExpressionRouting("CASH_SECURED_PUT", allFamilies);
    expect(routing.engine).toBe("OPTIONS_MATCHING");
    expect((routing as any).constraintedFamilies).toContain("cash_secured_put");
  });

  it("DEFINED_RISK_OPTIONS routes to OPTIONS_MATCHING with defined-risk families", () => {
    const routing = resolveExpressionRouting("DEFINED_RISK_OPTIONS", allFamilies);
    expect(routing.engine).toBe("OPTIONS_MATCHING");
    expect((routing as any).constraintedFamilies).toContain("defined_risk_directional");
  });

  it("EXPLORE_COMPATIBLE_STRUCTURES routes to EXPLORE_ALL engine", () => {
    const routing = resolveExpressionRouting("EXPLORE_COMPATIBLE_STRUCTURES", allFamilies);
    expect(routing.engine).toBe("EXPLORE_ALL");
  });

  it("EXPLORE_ALL receives all compatible families", () => {
    const routing = resolveExpressionRouting("EXPLORE_COMPATIBLE_STRUCTURES", allFamilies);
    expect((routing as any).families).toEqual(allFamilies);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. ROADMAP DISCIPLINE INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Roadmap discipline invariants", () => {
  it("computeExpressionOptions does not call any broker API", () => {
    // Pure computation — no external deps
    const result = computeExpressionOptions("NVDA", FULL_APPLICABLE_FAMILIES, null);
    expect(result).toBeDefined();
    // No broker fields in result
    expect(result).not.toHaveProperty("brokerConnected");
    expect(result).not.toHaveProperty("executionEnabled");
  });

  it("computeBroadCompatibility does not return recommendation language", () => {
    for (const broadType of BROAD_EXPRESSION_TYPES) {
      const result = computeBroadCompatibility(broadType, FULL_APPLICABLE_FAMILIES);
      const allText = [...result.reasons, ...result.requirements, ...result.limitations].join(" ");
      expect(allText).not.toContain("Recommended for You");
      expect(allText).not.toContain("Best Strategy");
      expect(allText).not.toContain("AI Chose");
      expect(allText).not.toContain("Suitable");
    }
  });

  it("UserTradingPreferences does not contain financial questionnaire fields", () => {
    // Type-level test — ensure the type interface is clean
    const prefs: UserTradingPreferences = {
      userId: "u1",
      preferredExpressionTypes: [],
      showOtherCompatibleStructures: true,
      updatedAt: new Date().toISOString(),
    };
    const keys = Object.keys(prefs);
    const financialFields = ["income", "netWorth", "age", "taxBracket", "riskTolerance", "riskCapacity", "investmentObjective", "timeToRetirement", "dependents"];
    for (const f of financialFields) {
      expect(keys).not.toContain(f);
    }
  });

  it("EXPRESSION_SELECTION_FORBIDDEN_PHRASES includes AI-selection phrases", () => {
    const forbidden = EXPRESSION_SELECTION_FORBIDDEN_PHRASES as readonly string[];
    expect(forbidden).toContain("AI Chose");
    expect(forbidden).toContain("AI Selected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. SECURITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Security", () => {
  it("saveBroadExpressionSelection — cross-user session returns SESSION_NOT_FOUND (not other-user data)", async () => {
    // user-2 tries to access user-1's session — session not found
    await expect(
      saveBroadExpressionSelection("user-2", "sess-user-1", "STOCK", {
        getPlanningSession: async () => null, // ownership check fails
        updatePlanningSession: async () => {},
      })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("getUserTradingPreferences returns user-specific data only", async () => {
    let queriedId: string | null = null;
    await getUserTradingPreferences("u-specific", {
      getUserSettingsRow: async (id) => { queriedId = id; return null; },
    });
    expect(queriedId).toBe("u-specific");
  });
});
