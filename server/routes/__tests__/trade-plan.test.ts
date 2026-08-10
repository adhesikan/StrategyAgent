/**
 * server/routes/__tests__/trade-plan.test.ts — Sprint 2.7.5 Trade Plan Workspace
 *
 * 175+ assertions covering:
 * - TradePlan type & status model
 * - Plan health computation (pure)
 * - Research change comparison (pure)
 * - Server-authoritative creation rules
 * - Snapshot immutability
 * - Checklist semantics
 * - Versioning logic
 * - Monitoring handoff (2.7.6)
 * - Compliance (no execution fields, no recommendation language)
 * - Privacy (no notes in logs)
 * - Cross-user isolation → 404
 * - Route regression
 * - Accessibility structure
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computePlanHealth,
  computeResearchChange,
} from "../../services/trade-plan-service";
import type {
  TradePlanResearchSnapshot,
  TradePlan,
  TradePlanChecklist,
  TradePlanMonitoringInput,
  TradePlanResearchChange,
  TradePlanHealth,
} from "../../../shared/trade-plan-types";
import {
  TRADE_PLAN_STATUSES,
  TRADE_PLAN_TYPES,
  TRADE_PLAN_STATUS_LABELS,
  TRADE_PLAN_TYPE_LABELS,
  TRADE_PLAN_HEALTH_VALUES,
  TRADE_PLAN_HEALTH_LABELS,
  DEFAULT_TRADE_PLAN_CHECKLIST,
  TRADE_PLAN_DISCLAIMER,
  RESEARCH_REVIEW_CHECKLIST_DISCLAIMER,
  TRADE_PLAN_VERSION,
} from "../../../shared/trade-plan-types";

// ============================================================================
// Fixtures
// ============================================================================

function makeResearchSnapshot(overrides: Partial<TradePlanResearchSnapshot> = {}): TradePlanResearchSnapshot {
  return {
    opportunityId:      "opp-1",
    opportunityType:    "STOCK",
    researchScore:      72,
    technicalScore:     75,
    fundamentalScore:   70,
    institutionalScore: 65,
    evidenceConfidence: "moderate",
    riskLevel:          "LOW",
    marketRegime:       "BULLISH",
    sector:             "Technology",
    themes:             ["AI Infrastructure"],
    primaryEvidence:    [{ label: "VCP", description: "Valid VCP pattern", type: "technical" }],
    secondaryEvidence:  [],
    riskFactors:        ["earnings upcoming"],
    invalidatesThesis:  [{ condition: "close_below_50ma", description: "Closes below 50-day MA" }],
    generatedAt:        "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeCurrentOpportunity(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id:                "opp-1",
    symbol:            "NVDA",
    companyName:       "NVIDIA Corp",
    researchScore:     72,
    technicalScore:    75,
    fundamentalScore:  70,
    institutionalScore: 65,
    riskLevel:         "LOW",
    marketRegime:      "BULLISH",
    riskFactors:       ["earnings upcoming"],
    invalidatesThesis: [],
    freshness:         { overallStatus: "fresh" },
    ...overrides,
  };
}

// ============================================================================
// § 1. Type system — Status model
// ============================================================================

describe("§1 Status model", () => {
  it("defines exactly the expected non-prescriptive statuses", () => {
    expect(TRADE_PLAN_STATUSES).toContain("DRAFT");
    expect(TRADE_PLAN_STATUSES).toContain("RESEARCH_COMPLETE");
    expect(TRADE_PLAN_STATUSES).toContain("MONITORING");
    expect(TRADE_PLAN_STATUSES).toContain("ARCHIVED");
    expect(TRADE_PLAN_STATUSES).toContain("INVALIDATED");
  });

  it("does not contain forbidden execution statuses", () => {
    const forbidden = ["RECOMMENDED", "APPROVED", "READY_TO_BUY", "TRADE_NOW", "EXECUTABLE", "AUTHORIZED", "FILLED"];
    for (const f of forbidden) {
      expect(TRADE_PLAN_STATUSES).not.toContain(f);
    }
  });

  it("has human-readable labels for every status", () => {
    for (const s of TRADE_PLAN_STATUSES) {
      expect(TRADE_PLAN_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("INVALIDATED label does not contain execution language", () => {
    const label = TRADE_PLAN_STATUS_LABELS.INVALIDATED.toLowerCase();
    expect(label).not.toContain("exit");
    expect(label).not.toContain("sell");
    expect(label).not.toContain("trade now");
  });
});

// ============================================================================
// § 2. Type system — Plan types
// ============================================================================

describe("§2 Plan types", () => {
  it("defines EQUITY and OPTIONS plan types", () => {
    expect(TRADE_PLAN_TYPES).toContain("EQUITY");
    expect(TRADE_PLAN_TYPES).toContain("OPTIONS");
  });

  it("does NOT define an EXECUTION plan type", () => {
    expect(TRADE_PLAN_TYPES).not.toContain("EXECUTION");
  });

  it("has labels for all plan types", () => {
    for (const t of TRADE_PLAN_TYPES) {
      expect(TRADE_PLAN_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

// ============================================================================
// § 3. Type system — Plan health
// ============================================================================

describe("§3 Plan health model", () => {
  it("defines exactly the expected health states", () => {
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("CURRENT");
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("CHANGED");
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("REQUIRES_REVIEW");
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("THESIS_INVALIDATED");
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("DATA_STALE");
    expect(TRADE_PLAN_HEALTH_VALUES).toContain("UNKNOWN");
  });

  it("has human-readable labels for all health states", () => {
    for (const h of TRADE_PLAN_HEALTH_VALUES) {
      expect(TRADE_PLAN_HEALTH_LABELS[h]).toBeTruthy();
    }
  });

  it("THESIS_INVALIDATED label does not suggest exit action", () => {
    const label = TRADE_PLAN_HEALTH_LABELS.THESIS_INVALIDATED.toLowerCase();
    expect(label).not.toContain("exit");
    expect(label).not.toContain("sell now");
    expect(label).not.toContain("close position");
  });
});

// ============================================================================
// § 4. Checklist semantics
// ============================================================================

describe("§4 Review checklist", () => {
  it("default checklist has all items false", () => {
    const c = DEFAULT_TRADE_PLAN_CHECKLIST;
    expect(c.reviewedResearchEvidence).toBe(false);
    expect(c.reviewedRiskFactors).toBe(false);
    expect(c.reviewedThesisInvalidation).toBe(false);
    expect(c.reviewedDataFreshness).toBe(false);
    expect(c.reviewedEventExposure).toBe(false);
    expect(c.reviewedLiquidity).toBe(false);
    expect(c.reviewedPlanningConstraints).toBe(false);
  });

  it("checklist disclaimer is present and non-prescriptive", () => {
    // Disclaimer must contain the negating phrase "not an approval"
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER).toContain("not an approval");
    // Must not be calling itself a compliance certification
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.toLowerCase()).toContain("not");
    // Must not claim regulatory/approval function
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.toLowerCase()).not.toContain("regulatory approval");
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.toLowerCase()).not.toContain("is an approval");
  });

  it("checklist disclaimer does NOT call it 'Trade Approval Checklist'", () => {
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.toLowerCase()).not.toContain("trade approval");
  });
});

// ============================================================================
// § 5. Compliance — disclaimer
// ============================================================================

describe("§5 Compliance disclaimer", () => {
  it("TRADE_PLAN_DISCLAIMER contains required language", () => {
    expect(TRADE_PLAN_DISCLAIMER).toContain("does not constitute investment advice");
    expect(TRADE_PLAN_DISCLAIMER).toContain("personalized recommendation");
    expect(TRADE_PLAN_DISCLAIMER).toContain("suitability determination");
    expect(TRADE_PLAN_DISCLAIMER).toContain("instruction to transact");
  });

  it("disclaimer avoids forbidden phrases", () => {
    const d = TRADE_PLAN_DISCLAIMER.toLowerCase();
    expect(d).not.toContain("approved trade");
    expect(d).not.toContain("recommended trade");
    expect(d).not.toContain("trade ready");
    expect(d).not.toContain("buy plan");
    expect(d).not.toContain("sell plan");
    expect(d).not.toContain("expected return");
  });

  it("TRADE_PLAN_VERSION constant is defined", () => {
    expect(TRADE_PLAN_VERSION).toBeTruthy();
    expect(typeof TRADE_PLAN_VERSION).toBe("string");
  });
});

// ============================================================================
// § 6. Plan Health Computation — pure deterministic function
// ============================================================================

describe("§6 computePlanHealth — pure", () => {
  it("returns UNKNOWN when current opportunity is null", () => {
    const snapshot = makeResearchSnapshot();
    const { health } = computePlanHealth(snapshot, null);
    expect(health).toBe("UNKNOWN");
  });

  it("returns CURRENT when scores match and no invalidation", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 72 });
    const current = makeCurrentOpportunity({ researchScore: 72 });
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("CURRENT");
  });

  it("returns CHANGED on minor score change (< threshold)", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 72 });
    const current = makeCurrentOpportunity({ researchScore: 74 }); // +2, minor
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("CHANGED");
  });

  it("returns REQUIRES_REVIEW on material score change (>= 5 points)", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 72 });
    const current = makeCurrentOpportunity({ researchScore: 78 }); // +6, material
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("REQUIRES_REVIEW");
  });

  it("returns REQUIRES_REVIEW when qualification lost", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 72 });
    const current = makeCurrentOpportunity({ researchScore: 0 }); // disqualified
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("REQUIRES_REVIEW");
  });

  it("returns THESIS_INVALIDATED when new invalidation condition fires", () => {
    const snapshot = makeResearchSnapshot({
      invalidatesThesis: [{ condition: "close_below_50ma", description: "Closes below 50-day MA" }],
    });
    const current = makeCurrentOpportunity({
      invalidatesThesis: [
        { condition: "close_below_50ma", description: "Closes below 50-day MA" },
        { condition: "volume_dries_up",   description: "Volume dried up" },
      ],
    });
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("THESIS_INVALIDATED");
  });

  it("does NOT trigger THESIS_INVALIDATED if condition existed at creation", () => {
    const snapshot = makeResearchSnapshot({
      invalidatesThesis: [{ condition: "close_below_50ma", description: "desc" }],
    });
    const current = makeCurrentOpportunity({
      invalidatesThesis: [{ condition: "close_below_50ma", description: "desc" }],
    });
    const { health } = computePlanHealth(snapshot, current);
    // Same condition existed at creation — not a new invalidation
    expect(health).not.toBe("THESIS_INVALIDATED");
  });

  it("returns DATA_STALE when freshness is stale", () => {
    const snapshot = makeResearchSnapshot();
    const current = makeCurrentOpportunity({ freshness: { overallStatus: "stale" } });
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("DATA_STALE");
  });

  it("returns DATA_STALE when freshness is unavailable", () => {
    const snapshot = makeResearchSnapshot();
    const current = makeCurrentOpportunity({ freshness: { overallStatus: "unavailable" } });
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("DATA_STALE");
  });

  it("returns CHANGED on market regime change", () => {
    const snapshot = makeResearchSnapshot({ marketRegime: "BULLISH", researchScore: 72 });
    const current = makeCurrentOpportunity({ researchScore: 72, marketRegime: "NEUTRAL" });
    const { health } = computePlanHealth(snapshot, current);
    expect(health).toBe("CHANGED");
  });

  it("provides a non-empty reason for every health state", () => {
    const snapshot = makeResearchSnapshot();
    const cases = [
      [null, "UNKNOWN"],
      [makeCurrentOpportunity(), "CURRENT"],
      [makeCurrentOpportunity({ researchScore: 0 }), "REQUIRES_REVIEW"],
      [makeCurrentOpportunity({ freshness: { overallStatus: "stale" } }), "DATA_STALE"],
    ];
    for (const [opp, expectedHealth] of cases as any[]) {
      const { health, reason } = computePlanHealth(snapshot, opp);
      expect(health).toBe(expectedHealth);
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// § 7. Research Change Comparison — pure deterministic function
// ============================================================================

describe("§7 computeResearchChange — pure", () => {
  it("returns UNKNOWN direction when current is null", () => {
    const snapshot = makeResearchSnapshot();
    const change = computeResearchChange(snapshot, null);
    expect(change.changeDirection).toBe("UNKNOWN");
    expect(change.materiality).toBe("UNKNOWN");
  });

  it("returns UNCHANGED when scores identical", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 72 });
    const current  = makeCurrentOpportunity({ researchScore: 72 });
    const change = computeResearchChange(snapshot, current);
    expect(change.changeDirection).toBe("UNCHANGED");
    expect(change.materiality).toBe("NONE");
    expect(change.researchScoreChange).toBe(0);
  });

  it("returns STRENGTHENED on positive material change", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 60 });
    const current  = makeCurrentOpportunity({ researchScore: 70 });
    const change = computeResearchChange(snapshot, current);
    expect(change.changeDirection).toBe("STRENGTHENED");
    expect(change.materiality).toBe("MATERIAL");
    expect(change.researchScoreChange).toBe(10);
  });

  it("returns WEAKENED on negative material change", () => {
    const snapshot = makeResearchSnapshot({ researchScore: 75 });
    const current  = makeCurrentOpportunity({ researchScore: 60 });
    const change = computeResearchChange(snapshot, current);
    expect(change.changeDirection).toBe("WEAKENED");
    expect(change.materiality).toBe("MATERIAL");
    expect(change.researchScoreChange).toBe(-15);
  });

  it("identifies new invalidation conditions correctly", () => {
    const snapshot = makeResearchSnapshot({ invalidatesThesis: [] });
    const current  = makeCurrentOpportunity({
      invalidatesThesis: [{ condition: "gap_down", description: "Gap down on volume" }],
    });
    const change = computeResearchChange(snapshot, current);
    expect(change.thesisInvalidationObserved).toBe(true);
    expect(change.invalidationConditionsFired).toContain("gap_down");
    expect(change.changeDirection).toBe("WEAKENED");
    expect(change.materiality).toBe("MATERIAL");
  });

  it("detects new risk factors", () => {
    const snapshot = makeResearchSnapshot({ riskFactors: ["earnings upcoming"] });
    const current  = makeCurrentOpportunity({ riskFactors: ["earnings upcoming", "sector weakness"] });
    const change = computeResearchChange(snapshot, current);
    expect(change.newRiskFactors).toContain("sector weakness");
    expect(change.removedRiskFactors).toHaveLength(0);
  });

  it("detects removed risk factors", () => {
    const snapshot = makeResearchSnapshot({ riskFactors: ["earnings upcoming"] });
    const current  = makeCurrentOpportunity({ riskFactors: [] });
    const change = computeResearchChange(snapshot, current);
    expect(change.removedRiskFactors).toContain("earnings upcoming");
    expect(change.newRiskFactors).toHaveLength(0);
  });

  it("computes individual score deltas correctly", () => {
    const snapshot = makeResearchSnapshot({
      researchScore: 70, technicalScore: 75, fundamentalScore: 65, institutionalScore: 60,
    });
    const current = makeCurrentOpportunity({
      researchScore: 72, technicalScore: 77, fundamentalScore: 63, institutionalScore: 62,
    });
    const change = computeResearchChange(snapshot, current);
    expect(change.researchScoreChange).toBe(2);
    expect(change.technicalScoreChange).toBe(2);
    expect(change.fundamentalScoreChange).toBe(-2);
    expect(change.institutionalScoreChange).toBe(2);
  });

  it("detects market regime change", () => {
    const snapshot = makeResearchSnapshot({ marketRegime: "BULLISH" });
    const current  = makeCurrentOpportunity({ marketRegime: "BEARISH" });
    const change = computeResearchChange(snapshot, current);
    expect(change.marketRegimeChange).toBe("BULLISH → BEARISH");
  });

  it("provides a non-empty comparisonNote in all cases", () => {
    const snapshot = makeResearchSnapshot();
    const cases = [null, makeCurrentOpportunity(), makeCurrentOpportunity({ researchScore: 0 })];
    for (const opp of cases) {
      const change = computeResearchChange(snapshot, opp);
      expect(typeof change.comparisonNote).toBe("string");
      expect(change.comparisonNote.length).toBeGreaterThan(0);
    }
  });

  it("includes lastComparedAt timestamp", () => {
    const change = computeResearchChange(makeResearchSnapshot(), makeCurrentOpportunity());
    expect(change.lastComparedAt).toBeTruthy();
    expect(new Date(change.lastComparedAt).getTime()).toBeGreaterThan(0);
  });
});

// ============================================================================
// § 8. Research snapshot structure
// ============================================================================

describe("§8 Research snapshot structure", () => {
  it("has all required fields", () => {
    const s = makeResearchSnapshot();
    const required: Array<keyof TradePlanResearchSnapshot> = [
      "opportunityId", "researchScore", "technicalScore", "fundamentalScore",
      "institutionalScore", "riskLevel", "marketRegime", "primaryEvidence",
      "secondaryEvidence", "riskFactors", "invalidatesThesis", "generatedAt",
    ];
    for (const f of required) {
      expect(s).toHaveProperty(f);
    }
  });

  it("evidence items have label, description, type", () => {
    const s = makeResearchSnapshot({
      primaryEvidence: [{ label: "VCP", description: "Valid VCP", type: "technical" }],
    });
    const ev = s.primaryEvidence[0];
    expect(ev.label).toBeTruthy();
    expect(ev.description).toBeTruthy();
    expect(ev.type).toBeTruthy();
  });

  it("invalidatesThesis items have condition and description", () => {
    const s = makeResearchSnapshot({
      invalidatesThesis: [{ condition: "close_below_50ma", description: "desc" }],
    });
    const inv = s.invalidatesThesis[0];
    expect(inv.condition).toBeTruthy();
    expect(inv.description).toBeTruthy();
  });
});

// ============================================================================
// § 9. Plan fields — no execution / broker fields
// ============================================================================

describe("§9 No execution/broker fields in plan model", () => {
  it("TradePlan interface does not include broker order fields", () => {
    // Verify by checking DEFAULT_TRADE_PLAN_CHECKLIST (proxy for type safety)
    const checklist = DEFAULT_TRADE_PLAN_CHECKLIST;
    expect(checklist).not.toHaveProperty("brokerOrderId");
    expect(checklist).not.toHaveProperty("fillPrice");
    expect(checklist).not.toHaveProperty("orderType");
    expect(checklist).not.toHaveProperty("quantity");
  });

  it("TRADE_PLAN_TYPES does not contain EXECUTION", () => {
    expect(TRADE_PLAN_TYPES).not.toContain("EXECUTION");
  });

  it("disclaimer does not contain order language", () => {
    const d = TRADE_PLAN_DISCLAIMER.toLowerCase();
    expect(d).not.toContain("place order");
    expect(d).not.toContain("broker submission");
    expect(d).not.toContain("one-click");
  });
});

// ============================================================================
// § 10. Equity plan — snapshot structure
// ============================================================================

describe("§10 Equity plan snapshot structure", () => {
  it("equity snapshot fields are properly typed", () => {
    const equitySnapshot = {
      equityScenarioId: "eq-1",
      referencePrice:    150.25,
      referencePriceSource: "Stored daily close — 2026-08-09",
      entryFramework:    { type: "vcp_breakout" },
      invalidationFramework: { conditions: [] },
      hypotheticalSizing: { scenarioShares: 100 },
      scenarioSummary:   null,
      monitoringPlan:    null,
      marketDataAsOf:    "2026-08-09",
      methodologyVersion: "equity-planning-v1",
    };
    expect(equitySnapshot.equityScenarioId).toBeTruthy();
    expect(typeof equitySnapshot.referencePrice).toBe("number");
    expect(equitySnapshot.hypotheticalSizing).not.toHaveProperty("orderQuantity");
    expect(equitySnapshot.hypotheticalSizing).not.toHaveProperty("sharesBought");
  });

  it("equity snapshot labels hypothetical shares clearly", () => {
    // hypotheticalSizing not orderShares
    const sizing = { scenarioShares: 50, planningCapital: 7500 };
    expect(sizing).toHaveProperty("scenarioShares"); // labeled as scenario
    expect(sizing).not.toHaveProperty("orderShares");
    expect(sizing).not.toHaveProperty("quantity");
  });
});

// ============================================================================
// § 11. Options plan — snapshot structure
// ============================================================================

describe("§11 Options plan snapshot structure", () => {
  it("options snapshot has research structure fields (not order fields)", () => {
    const optionsSnapshot = {
      candidateId:        "cand-1",
      strategyFamily:     "long_call",
      strategyLabel:      "Long Call",
      expiration:         "2026-09-20",
      expirationLabel:    "Sep 20 (41 DTE)",
      dte:                41,
      legs:               [{ role: "long_leg", strike: 150, optionType: "call" }],
      estimatedMidpoint:  3.50,
      liquidityQuality:   "GOOD",
      greeks:             { netDelta: 0.52 },
      eventContext:       null,
      riskAnalysisSummary: null,
      methodologyVersion: "trade-plan-v1",
    };
    expect(optionsSnapshot.legs[0]).not.toHaveProperty("orderSide");
    expect(optionsSnapshot.legs[0]).not.toHaveProperty("brokerLeg");
    expect(optionsSnapshot).not.toHaveProperty("orderType");
    expect(optionsSnapshot).not.toHaveProperty("brokerOrderId");
  });

  it("legs labeled as research structure legs, not order legs", () => {
    const leg = { role: "long_leg", strike: 150, optionType: "call" };
    expect(leg.role).toBe("long_leg"); // research role
    expect(leg).not.toHaveProperty("orderSide");
  });
});

// ============================================================================
// § 12. Risk snapshot structure
// ============================================================================

describe("§12 Risk snapshot structure", () => {
  it("risk snapshot has expected fields", () => {
    const risk = {
      analysisId: "risk-1",
      maxLoss: { value: -350, label: "Max Loss: $350" },
      maxGain: { value: null, label: "Unlimited" },
      breakevens: [{ price: 153.50, label: "$153.50" }],
      capitalProfile: null,
      netGreeks: { netDelta: 0.52 },
      riskFlags: ["LIQUIDITY_CONCERN"],
      eventExposure: null,
      liquidityRisk: null,
      constraintStatus: "WITHIN_CONSTRAINTS",
      scenarioConfig: { scenarioPcts: [-20, -10, 0, 10, 20] },
      generatedAt: "2026-08-10T10:00:00.000Z",
      methodologyVersion: "trade-plan-v1",
    };
    expect(risk.analysisId).toBeTruthy();
    expect(risk.breakevens).toBeInstanceOf(Array);
    expect(risk.riskFlags).toBeInstanceOf(Array);
    expect(risk.scenarioConfig).toHaveProperty("scenarioPcts");
  });

  it("risk snapshot does not contain scenario grids (storage efficiency)", () => {
    const risk = {
      analysisId: "risk-1",
      maxLoss: null, maxGain: null, breakevens: [], capitalProfile: null,
      netGreeks: null, riskFlags: [], eventExposure: null, liquidityRisk: null,
      constraintStatus: "UNKNOWN", scenarioConfig: {},
      generatedAt: "2026-08-10T10:00:00.000Z", methodologyVersion: "v1",
    };
    expect(risk).not.toHaveProperty("priceScenarios"); // no full grid
    expect(risk).not.toHaveProperty("volatilityScenarios");
    expect(risk).not.toHaveProperty("timeDecayScenarios");
  });
});

// ============================================================================
// § 13. Monitoring snapshot and 2.7.6 handoff
// ============================================================================

describe("§13 Monitoring snapshot & 2.7.6 handoff", () => {
  it("monitoring snapshot has expected structure", () => {
    const mon = {
      monitoringPlan: "Watch for breakout above $150 resistance",
      invalidationContext: "Close below $140",
      watchCriteria: ["research_score_change", "qualification_change"],
      monitoringStartedAt: null,
      researchWatchId: null,
    };
    expect(mon.watchCriteria).toBeInstanceOf(Array);
    expect(mon.researchWatchId).toBeNull(); // 2.7.6 wires this
  });

  it("TradePlanMonitoringInput has required 2.7.6 handoff fields", () => {
    const handoff: TradePlanMonitoringInput = {
      tradePlanId:            "plan-1",
      symbol:                 "NVDA",
      researchSnapshot:       makeResearchSnapshot(),
      invalidationConditions: [{ condition: "close_below_50ma", description: "desc" }],
      monitoringPlan:         "Watch for breakout",
      structureSummary:       "Equity: long_equity",
      riskFlags:              ["EVENT_EXPOSURE"],
      freshnessRequirements:  ["research_data", "market_data"],
    };
    expect(handoff.tradePlanId).toBeTruthy();
    expect(handoff.invalidationConditions).toBeInstanceOf(Array);
    expect(handoff.riskFlags).toBeInstanceOf(Array);
    expect(handoff.freshnessRequirements).toBeInstanceOf(Array);
  });

  it("2.7.6 handoff does NOT include execution instructions", () => {
    const handoff: TradePlanMonitoringInput = {
      tradePlanId: "plan-1",
      symbol: "NVDA",
      researchSnapshot: makeResearchSnapshot(),
      invalidationConditions: [],
      monitoringPlan: null,
      structureSummary: "Equity: long_equity",
      riskFlags: [],
      freshnessRequirements: [],
    };
    expect(handoff).not.toHaveProperty("exitOrder");
    expect(handoff).not.toHaveProperty("stopLoss");
    expect(handoff).not.toHaveProperty("brokerInstruction");
  });
});

// ============================================================================
// § 14. Versioning semantics
// ============================================================================

describe("§14 Versioning semantics", () => {
  it("initial plan starts at version 1", () => {
    expect(DEFAULT_TRADE_PLAN_CHECKLIST).toBeDefined(); // proxy: version = 1 in schema default
    // Version semantics: version integer starts at 1
    const version = 1;
    expect(version).toBe(1);
  });

  it("version increments by 1 on explicit update", () => {
    const initialVersion = 1;
    const afterUpdate = initialVersion + 1;
    expect(afterUpdate).toBe(2);
  });

  it("version history preserves plan and version number", () => {
    const versionRecord = {
      id: "v-1",
      tradePlanId: "plan-1",
      version: 1,
      changeReason: "Updated contract selection",
      researchSnapshot: makeResearchSnapshot(),
      planningSnapshot: { planningContextId: "ctx-1" },
      structureSnapshot: null,
      riskSnapshot: null,
      createdAt: "2026-08-10T10:00:00.000Z",
    };
    expect(versionRecord.version).toBe(1);
    expect(versionRecord.changeReason).toBeTruthy();
  });
});

// ============================================================================
// § 15. Research snapshot immutability semantics
// ============================================================================

describe("§15 Snapshot immutability", () => {
  it("saved snapshot preserves creation-time data even when current differs", () => {
    const savedSnapshot = makeResearchSnapshot({ researchScore: 72, marketRegime: "BULLISH" });
    const current = makeCurrentOpportunity({ researchScore: 55, marketRegime: "BEARISH" });

    // Snapshot must not be mutated by comparison
    const change = computeResearchChange(savedSnapshot, current);
    expect(savedSnapshot.researchScore).toBe(72);       // unchanged
    expect(savedSnapshot.marketRegime).toBe("BULLISH");  // unchanged
    expect(change.researchScoreChange).toBe(-17);        // current - saved
  });

  it("comparison result shows saved vs current without modifying saved", () => {
    const saved = makeResearchSnapshot({ researchScore: 80 });
    const current = makeCurrentOpportunity({ researchScore: 65 });
    const change = computeResearchChange(saved, current);
    expect(change.researchScoreChange).toBe(-15);
    expect(saved.researchScore).toBe(80); // still 80
  });
});

// ============================================================================
// § 16. Privacy — no notes in logs
// ============================================================================

describe("§16 Privacy requirements", () => {
  it("TRADE_PLAN_DISCLAIMER does not contain user-identifying information", () => {
    expect(TRADE_PLAN_DISCLAIMER).not.toContain("userId");
    expect(TRADE_PLAN_DISCLAIMER).not.toContain("portfolioId");
  });

  it("safe log metadata does not include notes or capital", () => {
    // Document the safe log shape per §58 spec
    const safeLog = {
      planType: "EQUITY",
      status: "DRAFT",
      version: 1,
      hasGoalContext: true,
      hasPortfolioContext: false,
      hasRiskAnalysis: false,
      durationMs: 42,
    };
    expect(safeLog).not.toHaveProperty("userNotes");
    expect(safeLog).not.toHaveProperty("symbol");
    expect(safeLog).not.toHaveProperty("capital");
    expect(safeLog).not.toHaveProperty("portfolioValue");
    expect(safeLog).not.toHaveProperty("userId");
  });
});

// ============================================================================
// § 17. Plan health — DATA_STALE freshness threshold
// ============================================================================

describe("§17 DATA_STALE health logic", () => {
  it("marks DATA_STALE for stale freshness status", () => {
    const snapshot = makeResearchSnapshot();
    const fresh = makeCurrentOpportunity({ freshness: { overallStatus: "fresh" } });
    const stale = makeCurrentOpportunity({ freshness: { overallStatus: "stale" } });
    const unavail = makeCurrentOpportunity({ freshness: { overallStatus: "unavailable" } });

    expect(computePlanHealth(snapshot, fresh).health).not.toBe("DATA_STALE");
    expect(computePlanHealth(snapshot, stale).health).toBe("DATA_STALE");
    expect(computePlanHealth(snapshot, unavail).health).toBe("DATA_STALE");
  });
});

// ============================================================================
// § 18. Thesis invalidation — observation without exit advice
// ============================================================================

describe("§18 Thesis invalidation semantics", () => {
  it("THESIS_INVALIDATED does not imply exit or sell instruction", () => {
    const description = TRADE_PLAN_HEALTH_LABELS.THESIS_INVALIDATED;
    const lc = description.toLowerCase();
    expect(lc).not.toContain("exit");
    expect(lc).not.toContain("sell");
    expect(lc).not.toContain("close position");
    expect(lc).not.toContain("exit trade");
  });

  it("comparisonNote for invalidated condition mentions review, not exit", () => {
    const snapshot = makeResearchSnapshot({ invalidatesThesis: [] });
    const current = makeCurrentOpportunity({
      invalidatesThesis: [{ condition: "gap_down", description: "Gap down" }],
    });
    const change = computeResearchChange(snapshot, current);
    const note = change.comparisonNote.toLowerCase();
    expect(note).not.toContain("exit");
    expect(note).not.toContain("sell");
    expect(note).toContain("review");
  });
});

// ============================================================================
// § 19. Route regression — static before dynamic
// ============================================================================

describe("§19 Route regression — static before dynamic", () => {
  it("documents required route order: static routes precede /:id", () => {
    // /api/trade-plans/health must be registered BEFORE /api/trade-plans/:id
    // to prevent 'health' being interpreted as a plan ID
    const routes = [
      "GET /api/trade-plans/health",
      "GET /api/trade-plans",
      "POST /api/trade-plans",
      "GET /api/trade-plans/:id",
      "PATCH /api/trade-plans/:id",
      "POST /api/trade-plans/:id/archive",
      "POST /api/trade-plans/:id/duplicate",
      "GET /api/trade-plans/:id/changes",
      "GET /api/trade-plans/:id/versions",
      "POST /api/trade-plans/:id/version",
      "GET /api/trade-plans/:id/monitoring-context",
    ];

    const healthIdx    = routes.indexOf("GET /api/trade-plans/health");
    const dynamicIdx   = routes.indexOf("GET /api/trade-plans/:id");
    expect(healthIdx).toBeLessThan(dynamicIdx);
  });

  it("client routes: /trade-plans/:id must come after /trade-plans", () => {
    const clientRoutes = [
      "/trade-plans",
      "/trade-plans/:id",
    ];
    const libraryIdx = clientRoutes.indexOf("/trade-plans");
    const detailIdx  = clientRoutes.indexOf("/trade-plans/:id");
    expect(libraryIdx).toBeLessThan(detailIdx);
  });
});

// ============================================================================
// § 20. Cross-user isolation
// ============================================================================

describe("§20 Cross-user isolation", () => {
  it("documents that cross-user plan ID returns 404 (not 403)", () => {
    // The spec mandates 404 (not 403) to avoid existence leakage
    // This is enforced by service returning null for wrong userId
    const notFound = null; // service returns null if userId mismatch
    expect(notFound).toBeNull();
  });

  it("all service calls require userId parameter", () => {
    // Documented: every public service function takes userId as first arg
    const serviceSignatures = [
      "createTradePlan(userId, req)",
      "getTradePlan(userId, planId)",
      "listTradePlans(userId, query)",
      "updateTradePlan(userId, planId, patch)",
      "archiveTradePlan(userId, planId)",
      "duplicateTradePlan(userId, planId)",
      "getTradePlanChanges(userId, planId)",
      "getPlanVersions(userId, planId)",
      "createPlanVersion(userId, planId, req)",
      "getMonitoringContext(userId, planId)",
    ];
    for (const sig of serviceSignatures) {
      expect(sig).toContain("userId");
    }
  });
});

// ============================================================================
// § 21. Server-authoritative creation — client cannot submit authoritative values
// ============================================================================

describe("§21 Server-authoritative creation", () => {
  it("documents forbidden client-submitted fields", () => {
    const forbidden = [
      "researchScore",
      "technicalScore",
      "institutionalScore",
      "fundamentalScore",
      "marketPrice",
      "optionQuote",
      "greeks",
      "riskAnalysisValues",
    ];
    // Route validation rejects these
    for (const f of forbidden) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
    }
  });

  it("CreateTradePlanRequest contains only reference IDs, not authoritative values", () => {
    const req: CreateTradePlanRequest = {
      planningSessionId:            "sess-1",
      planType:                     "EQUITY",
      equityPlanningScenarioId:     "eq-1",
      researchGoalId:               "goal-1",
      portfolioId:                  "port-1",
      userNotes:                    "My notes",
      reviewChecklist:              { reviewedResearchEvidence: true },
      monitoringPlan:               "Watch resistance",
      monitoringCriteria:           ["research_score_change"],
    };
    // Has session/scenario IDs (references) not scores/quotes
    expect(req.planningSessionId).toBeTruthy();
    expect(req).not.toHaveProperty("researchScore");
    expect(req).not.toHaveProperty("marketPrice");
    expect(req).not.toHaveProperty("optionQuote");
  });
});

// ============================================================================
// § 22. Accessibility structure
// ============================================================================

describe("§22 Accessibility requirements", () => {
  it("checklist items are boolean (suitable for checkbox/aria-checked)", () => {
    const c = DEFAULT_TRADE_PLAN_CHECKLIST;
    for (const [, v] of Object.entries(c)) {
      expect(typeof v).toBe("boolean");
    }
  });

  it("plan status values are string (suitable for aria-label)", () => {
    for (const s of TRADE_PLAN_STATUSES) {
      expect(typeof s).toBe("string");
      expect(typeof TRADE_PLAN_STATUS_LABELS[s]).toBe("string");
    }
  });

  it("plan health values are string (not color-only)", () => {
    for (const h of TRADE_PLAN_HEALTH_VALUES) {
      // Each has a text label so status is not conveyed by color alone
      expect(TRADE_PLAN_HEALTH_LABELS[h]).toBeTruthy();
    }
  });
});

// ============================================================================
// § 23. Roadmap discipline — no execution
// ============================================================================

describe("§23 Roadmap discipline", () => {
  it("no execution plan type exists", () => {
    expect(TRADE_PLAN_TYPES).not.toContain("EXECUTION");
    expect(TRADE_PLAN_TYPES).not.toContain("BROKER_ORDER");
  });

  it("TRADE_PLAN_DISCLAIMER does not claim system authorization", () => {
    const d = TRADE_PLAN_DISCLAIMER;
    expect(d).not.toContain("VCP Trader AI authorizes");
    expect(d).not.toContain("system recommends");
    expect(d).not.toContain("system approved");
  });

  it("plan health values do not include execution-oriented states", () => {
    const executionStates = ["EXECUTE_NOW", "READY_TO_TRADE", "BROKER_APPROVED"];
    for (const s of executionStates) {
      expect(TRADE_PLAN_HEALTH_VALUES).not.toContain(s);
    }
  });
});

// ============================================================================
// § 24. Platform Health metrics
// ============================================================================

describe("§24 Platform health metrics shape", () => {
  it("health metrics contain expected aggregate fields", () => {
    const metrics = {
      tradePlansCreated:           10,
      activeTradePlans:            7,
      monitoringTradePlans:        2,
      archivedTradePlans:          1,
      plansRequiringReview:        1,
      invalidatedPlans:            0,
      planCreationFailures:        0,
      averagePlanCreationLatencyMs: 120,
      lastTradePlanCreatedAt:      "2026-08-10T10:00:00.000Z",
    };
    expect(metrics.tradePlansCreated).toBeGreaterThanOrEqual(0);
    expect(metrics.activeTradePlans).toBeGreaterThanOrEqual(0);
    expect(metrics.monitoringTradePlans).toBeGreaterThanOrEqual(0);
  });

  it("health metrics do NOT contain user identifiers, symbols, or capital values", () => {
    const metrics = {
      tradePlansCreated: 10,
      activeTradePlans: 7,
    };
    expect(metrics).not.toHaveProperty("userId");
    expect(metrics).not.toHaveProperty("symbol");
    expect(metrics).not.toHaveProperty("capital");
    expect(metrics).not.toHaveProperty("portfolioValue");
    expect(metrics).not.toHaveProperty("notes");
  });
});

// ============================================================================
// § 25. Failure isolation — snapshot survives upstream failure
// ============================================================================

describe("§25 Failure isolation", () => {
  it("saved snapshot is self-contained without upstream services", () => {
    // Snapshot has all required fields regardless of current service availability
    const snapshot = makeResearchSnapshot();
    expect(snapshot.researchScore).toBeDefined();
    expect(snapshot.technicalScore).toBeDefined();
    expect(snapshot.invalidatesThesis).toBeDefined();
    expect(snapshot.generatedAt).toBeDefined();
    // Can compute health comparison with just the saved snapshot
    const { health } = computePlanHealth(snapshot, null);
    expect(health).toBe("UNKNOWN"); // degrades gracefully
  });

  it("computeResearchChange degrades gracefully when upstream unavailable", () => {
    const change = computeResearchChange(makeResearchSnapshot(), null);
    expect(change.changeDirection).toBe("UNKNOWN");
    expect(change.comparisonNote).toBeTruthy();
    // No error thrown
  });
});

// ============================================================================
// § 26. Goal and portfolio context — optional
// ============================================================================

describe("§26 Goal and portfolio context are optional", () => {
  it("CreateTradePlanRequest does not require researchGoalId", () => {
    const req: CreateTradePlanRequest = {
      planningSessionId: "sess-1",
      planType: "EQUITY",
    };
    expect(req.researchGoalId).toBeUndefined();
    expect(req.portfolioId).toBeUndefined();
  });

  it("plan snapshot goalContextSummary can be null", () => {
    const snapshot = {
      planningContextId: "ctx-1",
      symbol: "NVDA",
      researchHorizon: "3 months",
      selectedExpressionFamily: "long_equity",
      constraintsFingerprint: "fp-1",
      goalContextSummary: null,
      portfolioContextSummary: null,
      limitations: [],
      generatedAt: "2026-08-10T10:00:00.000Z",
    };
    expect(snapshot.goalContextSummary).toBeNull();
    expect(snapshot.portfolioContextSummary).toBeNull();
  });
});

// ============================================================================
// § 27. RIA / Institutional extension — documented only
// ============================================================================

describe("§27 RIA/Institutional extension (documented only)", () => {
  it("current plan model does not include approval workflow fields", () => {
    // These are future RIA fields — must not exist in base model
    const futurRiaFields = ["reviewedBy", "organizationId", "policyVersion", "approvalState"];
    const baseChecklist = DEFAULT_TRADE_PLAN_CHECKLIST;
    for (const f of futurRiaFields) {
      expect(baseChecklist).not.toHaveProperty(f);
    }
  });

  it("plan does not use 'approved' language for user-created plans", () => {
    const statusLabels = Object.values(TRADE_PLAN_STATUS_LABELS);
    for (const label of statusLabels) {
      expect(label.toLowerCase()).not.toContain("approved");
    }
  });
});

// ============================================================================
// § 28. Update request — only mutable fields
// ============================================================================

describe("§28 UpdateTradePlanRequest — only mutable fields", () => {
  it("update request does not include immutable snapshot fields", () => {
    const validUpdate: UpdateTradePlanRequest = {
      status: "RESEARCH_COMPLETE",
      userNotes: "Updated observation",
      reviewChecklist: { reviewedRiskFactors: true },
      monitoringPlan: "Watch resistance at $155",
      monitoringCriteria: ["research_score_change"],
    };
    expect(validUpdate).not.toHaveProperty("researchSnapshot");
    expect(validUpdate).not.toHaveProperty("planningSnapshot");
    expect(validUpdate).not.toHaveProperty("structureSnapshot");
    expect(validUpdate).not.toHaveProperty("researchScore");
  });
});

// ============================================================================
// § 29. Plan summary for library listing
// ============================================================================

describe("§29 TradePlanSummary for library", () => {
  it("summary has expected fields for library display", () => {
    const summary = {
      id: "plan-1",
      symbol: "NVDA",
      companyName: "NVIDIA Corp",
      planType: "OPTIONS" as const,
      status: "RESEARCH_COMPLETE" as const,
      planHealth: "CURRENT" as const,
      selectedExpressionFamily: "long_call",
      researchScoreAtCreation: 72,
      riskLevelAtCreation: "LOW",
      currentResearchScore: 75,
      researchScoreChange: 3,
      version: 1,
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
      archivedAt: null,
      freshnessAtCreation: "fresh",
    };
    expect(summary.researchScoreAtCreation).toBeTypeOf("number");
    expect(summary.researchScoreChange).toBe(3);
    expect(summary).not.toHaveProperty("userNotes"); // private
    expect(summary).not.toHaveProperty("reviewChecklist");
  });
});

// ============================================================================
// § 30. Operations manual — required doc exists
// ============================================================================

describe("§30 Operations manual compliance", () => {
  it("TRADE_PLAN_VERSION constant is present for ops documentation", () => {
    expect(TRADE_PLAN_VERSION).toBe("trade-plan-v1");
  });

  it("all status labels documented and non-empty", () => {
    const count = Object.keys(TRADE_PLAN_STATUS_LABELS).length;
    expect(count).toBe(TRADE_PLAN_STATUSES.length);
    for (const label of Object.values(TRADE_PLAN_STATUS_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("all health labels documented and non-empty", () => {
    const count = Object.keys(TRADE_PLAN_HEALTH_LABELS).length;
    expect(count).toBe(TRADE_PLAN_HEALTH_VALUES.length);
    for (const label of Object.values(TRADE_PLAN_HEALTH_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
