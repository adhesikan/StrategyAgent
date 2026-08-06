// workspace-simplified.test.tsx — Sprint 2.2.4 UX Simplification Tests
//
// Pure-function tests for the new simplified workspace helpers.
// No RTL / DOM dependency.
//
// Sections:
//   A — selectTopRisks
//   B — buildHeroData
//   C — buildCompactPlanData
//   D — formatWhatChanged
//   E — structural / integration

import { describe, it, expect } from "vitest";
import {
  selectTopRisks,
  buildHeroData,
  buildCompactPlanData,
  formatWhatChanged,
} from "./workspace-simplified";
import type { RiskGroup } from "./workspace-sections";
import type { ResearchPackage } from "@/components/research/types";
import type { OptionsStructure } from "@/components/research/structure";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGroups(items: { label: string; detail: string; severity: string }[]): RiskGroup[] {
  return [{ id: "g1", label: "Trade", items: items as any }];
}

const LOW: RiskGroup[] = makeGroups([
  { label: "Minor gap", detail: "Gap risk", severity: "low" },
]);
const MIXED: RiskGroup[] = [
  {
    id: "market",
    label: "Market",
    items: [
      { label: "VIX elevated", detail: "VIX > 25", severity: "high" } as any,
      { label: "Sector weak", detail: "XLC -2%", severity: "medium" } as any,
    ],
  },
  {
    id: "trade",
    label: "Trade",
    items: [
      { label: "Earnings risk", detail: "Earnings this week", severity: "critical" } as any,
      { label: "Low volume", detail: "Below 20d avg", severity: "low" } as any,
    ],
  },
];

function makePkg(overrides: Partial<ResearchPackage["candidate"]> = {}): ResearchPackage {
  return {
    symbol: "COST",
    brokerConnected: false,
    marketRegime: "TRENDING",
    dataSource: "twelve_data",
    dataQuality: "good",
    freshnessStatus: "fresh",
    completedAt: "2026-08-06T10:00:00Z",
    snapshotId: "snap-1",
    lifecycleItem: null,
    scanHistory: [],
    candidate: {
      rank: 1,
      symbol: "COST",
      whySelected: ["Strong VCP pattern", "High RS", "Volume confirmation"],
      warnings: ["Earnings this week"],
      strategy: "VCP Breakout",
      trigger: "$920–925",
      invalidation: "$905",
      objective: "$960",
      rewardRisk: 2.5,
      confidence: "High",
      ...overrides,
    },
  } as ResearchPackage;
}

function makeOptStructure(overrides: Partial<OptionsStructure> = {}): OptionsStructure {
  return {
    name: "bull-call-spread",
    label: "Bull Call Spread",
    preferredDTE: "30–45 DTE",
    strikeGuidance: "Buy ATM, sell 5% OTM",
    reason: "Best for moderate bullish moves",
    capitalEfficiency: "Good",
    riskProfile: "Defined risk",
    timeDecay: "Moderate",
    marketOutlook: "Bullish",
    isDefinedRisk: true,
    isBestOverall: true,
    isIncome: false,
    isConservative: false,
    ...overrides,
  } as OptionsStructure;
}

// ---------------------------------------------------------------------------
// A — selectTopRisks
// ---------------------------------------------------------------------------

describe("A — selectTopRisks", () => {
  it("A1 — returns empty shown and zero hiddenCount when groups empty", () => {
    const r = selectTopRisks([], 3);
    expect(r.shown).toHaveLength(0);
    expect(r.hiddenCount).toBe(0);
  });

  it("A2 — returns all items when fewer than maxShown", () => {
    const r = selectTopRisks(LOW, 5);
    expect(r.shown).toHaveLength(1);
    expect(r.hiddenCount).toBe(0);
  });

  it("A3 — sorts by severity: critical first", () => {
    const r = selectTopRisks(MIXED, 10);
    expect(r.shown[0].severity).toBe("critical");
    expect(r.shown[1].severity).toBe("high");
    expect(r.shown[2].severity).toBe("medium");
    expect(r.shown[3].severity).toBe("low");
  });

  it("A4 — caps shown at maxShown and reports correct hiddenCount", () => {
    const r = selectTopRisks(MIXED, 2);
    expect(r.shown).toHaveLength(2);
    expect(r.hiddenCount).toBe(2);
  });

  it("A5 — maxShown=0 hides all and reports full hiddenCount", () => {
    const r = selectTopRisks(MIXED, 0);
    expect(r.shown).toHaveLength(0);
    expect(r.hiddenCount).toBe(4);
  });

  it("A6 — single group single item: shown=1, hidden=0", () => {
    const r = selectTopRisks(LOW, 3);
    expect(r.shown).toHaveLength(1);
    expect(r.shown[0].label).toBe("Minor gap");
    expect(r.hiddenCount).toBe(0);
  });

  it("A7 — items from multiple groups are flattened before sorting", () => {
    const r = selectTopRisks(MIXED, 10);
    expect(r.shown).toHaveLength(4);
  });

  it("A8 — maxShown=1 returns only the critical item", () => {
    const r = selectTopRisks(MIXED, 1);
    expect(r.shown[0].severity).toBe("critical");
    expect(r.shown[0].label).toBe("Earnings risk");
    expect(r.hiddenCount).toBe(3);
  });

  it("A9 — hiddenCount is never negative", () => {
    const r = selectTopRisks(LOW, 100);
    expect(r.hiddenCount).toBeGreaterThanOrEqual(0);
  });

  it("A10 — maxShown exactly equal to item count: hidden=0", () => {
    const r = selectTopRisks(MIXED, 4);
    expect(r.shown).toHaveLength(4);
    expect(r.hiddenCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B — buildHeroData
// ---------------------------------------------------------------------------

describe("B — buildHeroData", () => {
  it("B1 — bullish thesis maps to bullish variant", () => {
    const h = buildHeroData(makePkg(), "bullish", MIXED);
    expect(h.thesis).toBe("bullish");
    expect(h.postureVariant).toBe("bullish");
  });

  it("B2 — neutral thesis maps to neutral variant", () => {
    const h = buildHeroData(makePkg(), "neutral", []);
    expect(h.postureVariant).toBe("neutral");
    expect(h.postureLabel).toContain("Neutral");
  });

  it("B3 — bearish thesis maps to bearish variant", () => {
    const h = buildHeroData(makePkg(), "bearish", []);
    expect(h.postureVariant).toBe("bearish");
    expect(h.postureLabel).toContain("Bearish");
  });

  it("B4 — whySelected3 contains at most 3 items", () => {
    const pkg = makePkg({ whySelected: ["A", "B", "C", "D", "E"] });
    const h = buildHeroData(pkg, "bullish", []);
    expect(h.whySelected3).toHaveLength(3);
    expect(h.whySelected3[0]).toBe("A");
  });

  it("B5 — whySelected3 handles empty array", () => {
    const pkg = makePkg({ whySelected: [] });
    const h = buildHeroData(pkg, "bullish", []);
    expect(h.whySelected3).toHaveLength(0);
  });

  it("B6 — topRiskLabel uses the most critical risk from groups", () => {
    const h = buildHeroData(makePkg(), "bullish", MIXED);
    expect(h.topRiskLabel).toBe("Earnings risk");
    expect(h.topRiskSeverity).toBe("critical");
  });

  it("B7 — topRiskLabel is null when no risk groups", () => {
    const h = buildHeroData(makePkg(), "bullish", []);
    expect(h.topRiskLabel).toBeNull();
    expect(h.topRiskSeverity).toBeNull();
  });

  it("B8 — regimeLabel converts TRENDING", () => {
    const h = buildHeroData(makePkg(), "bullish", []);
    expect(h.regimeLabel).toBe("Trending");
  });

  it("B9 — regimeLabel converts RISK_OFF", () => {
    const pkg = { ...makePkg(), marketRegime: "RISK_OFF" };
    const h = buildHeroData(pkg, "bearish", []);
    expect(h.regimeLabel).toBe("Risk-Off");
  });

  it("B10 — regimeLabel falls back to raw value for unknown regime", () => {
    const pkg = { ...makePkg(), marketRegime: "CUSTOM_REGIME" };
    const h = buildHeroData(pkg, "neutral", []);
    expect(h.regimeLabel).toBe("CUSTOM_REGIME");
  });

  it("B11 — regimeLabel is 'Unknown' when regime is null", () => {
    const pkg = { ...makePkg(), marketRegime: null };
    const h = buildHeroData(pkg, "neutral", []);
    expect(h.regimeLabel).toBe("Unknown");
  });

  it("B12 — confidence is passed through from candidate", () => {
    const h = buildHeroData(makePkg({ confidence: "Moderate" }), "bullish", []);
    expect(h.confidence).toBe("Moderate");
  });

  it("B13 — confidence is null when not set on candidate", () => {
    const h = buildHeroData(makePkg({ confidence: undefined }), "bullish", []);
    expect(h.confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C — buildCompactPlanData
// ---------------------------------------------------------------------------

describe("C — buildCompactPlanData", () => {
  it("C1 — stock fields pass through from candidate", () => {
    const plan = buildCompactPlanData(makePkg(), null);
    expect(plan.entryZone).toBe("$920–925");
    expect(plan.stop).toBe("$905");
    expect(plan.target).toBe("$960");
    expect(plan.rewardRisk).toBe("2.5:1");
  });

  it("C2 — fields default to '—' when candidate fields are undefined", () => {
    const pkg = makePkg({ trigger: undefined, invalidation: undefined, objective: undefined });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.entryZone).toBe("—");
    expect(plan.stop).toBe("—");
    expect(plan.target).toBe("—");
  });

  it("C3 — rewardRisk defaults to '—' when not set", () => {
    const pkg = makePkg({ rewardRisk: undefined });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.rewardRisk).toBe("—");
  });

  it("C4 — rewardRisk formats to 1 decimal place", () => {
    const pkg = makePkg({ rewardRisk: 3 });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.rewardRisk).toBe("3.0:1");
  });

  it("C5 — hasOptionsStructure is false when optStructure is null", () => {
    const plan = buildCompactPlanData(makePkg(), null);
    expect(plan.hasOptionsStructure).toBe(false);
    expect(plan.structureLabel).toBe("Not determined");
    expect(plan.preferredDTE).toBe("—");
    expect(plan.strikeGuidance).toBe("—");
    expect(plan.isDefinedRisk).toBe(false);
  });

  it("C6 — options fields populate from OptionsStructure", () => {
    const plan = buildCompactPlanData(makePkg(), makeOptStructure());
    expect(plan.hasOptionsStructure).toBe(true);
    expect(plan.structureLabel).toBe("Bull Call Spread");
    expect(plan.preferredDTE).toBe("30–45 DTE");
    expect(plan.strikeGuidance).toBe("Buy ATM, sell 5% OTM");
    expect(plan.isDefinedRisk).toBe(true);
  });

  it("C7 — isDefinedRisk reflects structure field", () => {
    const plan = buildCompactPlanData(makePkg(), makeOptStructure({ isDefinedRisk: false }));
    expect(plan.isDefinedRisk).toBe(false);
  });

  it("C8 — holdingPeriod infers Intraday for ORB strategy", () => {
    const pkg = makePkg({ strategy: "ORB Momentum" });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.holdingPeriod).toBe("Intraday");
  });

  it("C9 — holdingPeriod infers Intraday for gap strategy", () => {
    const pkg = makePkg({ strategy: "Gap and Go" });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.holdingPeriod).toBe("Intraday");
  });

  it("C10 — holdingPeriod defaults to 'Swing trade' when strategy is undefined", () => {
    const pkg = makePkg({ strategy: undefined });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.holdingPeriod).toBe("Swing trade");
  });

  it("C11 — holdingPeriod infers Momentum for momentum strategy", () => {
    const pkg = makePkg({ strategy: "VCP Momentum Breakout" });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.holdingPeriod).toBe("Momentum (days–weeks)");
  });
});

// ---------------------------------------------------------------------------
// D — formatWhatChanged
// ---------------------------------------------------------------------------

describe("D — formatWhatChanged", () => {
  it("D1 — returns first appearance message when item is null", () => {
    const msg = formatWhatChanged(null);
    expect(msg).toContain("First appearance");
  });

  it("D2 — returns a non-empty string for null input", () => {
    expect(formatWhatChanged(null).length).toBeGreaterThan(0);
  });

  it("D3 — formats item with lifecycleState and rank", () => {
    const item = {
      id: "i1",
      symbol: "COST",
      scanSnapshotId: "s1",
      lifecycleState: "HELD_STABLE" as const,
      previousLifecycleState: "NEWLY_QUALIFIED" as const,
      rank: 1,
      previousRank: 1,
      score: 92,
      previousScore: 92,
      scoreDelta: 0,
      strategy: "VCP",
      createdAt: new Date().toISOString(),
    };
    const msg = formatWhatChanged(item);
    expect(msg.length).toBeGreaterThan(0);
    expect(typeof msg).toBe("string");
  });

  it("D4 — result is always a string (never null or undefined)", () => {
    expect(typeof formatWhatChanged(null)).toBe("string");
  });

  it("D5 — different lifecycle states produce different messages", () => {
    const base = {
      id: "i1",
      symbol: "COST",
      scanSnapshotId: "s1",
      rank: 1,
      previousRank: 2,
      score: 90,
      previousScore: 85,
      scoreDelta: 5,
      strategy: "VCP",
      createdAt: new Date().toISOString(),
    };
    const msgNew = formatWhatChanged({
      ...base,
      lifecycleState: "NEWLY_QUALIFIED" as const,
      previousLifecycleState: null as any,
    });
    const msgStable = formatWhatChanged({
      ...base,
      lifecycleState: "HELD_STABLE" as const,
      previousLifecycleState: "HELD_STABLE" as const,
    });
    // They should differ
    expect(msgNew).not.toBe(msgStable);
  });
});

// ---------------------------------------------------------------------------
// E — Structural assertions
// ---------------------------------------------------------------------------

describe("E — Structural exports", () => {
  it("E1 — selectTopRisks is a function with arity 2", () => {
    expect(typeof selectTopRisks).toBe("function");
    expect(selectTopRisks.length).toBe(2);
  });

  it("E2 — buildHeroData is a function with arity 3", () => {
    expect(typeof buildHeroData).toBe("function");
    expect(buildHeroData.length).toBe(3);
  });

  it("E3 — buildCompactPlanData is a function with arity 2", () => {
    expect(typeof buildCompactPlanData).toBe("function");
    expect(buildCompactPlanData.length).toBe(2);
  });

  it("E4 — formatWhatChanged is a function with arity 1", () => {
    expect(typeof formatWhatChanged).toBe("function");
    expect(formatWhatChanged.length).toBe(1);
  });

  it("E5 — selectTopRisks result has correct shape", () => {
    const r = selectTopRisks([], 3);
    expect("shown" in r && "hiddenCount" in r).toBe(true);
  });

  it("E6 — buildHeroData result has all required fields", () => {
    const h = buildHeroData(makePkg(), "bullish", []);
    const keys: (keyof typeof h)[] = [
      "thesis", "postureLabel", "postureVariant",
      "whySelected3", "topRiskLabel", "topRiskSeverity",
      "regimeLabel", "confidence",
    ];
    keys.forEach((k) => expect(k in h).toBe(true));
  });

  it("E7 — buildCompactPlanData result has all required fields", () => {
    const plan = buildCompactPlanData(makePkg(), null);
    const keys: (keyof typeof plan)[] = [
      "entryZone", "stop", "target", "rewardRisk", "holdingPeriod",
      "structureLabel", "preferredDTE", "strikeGuidance",
      "isDefinedRisk", "hasOptionsStructure",
    ];
    keys.forEach((k) => expect(k in plan).toBe(true));
  });

  it("E8 — postureVariant is one of bullish | neutral | bearish", () => {
    const valid = ["bullish", "neutral", "bearish"];
    (["bullish", "neutral", "bearish"] as const).forEach((thesis) => {
      const h = buildHeroData(makePkg(), thesis, []);
      expect(valid).toContain(h.postureVariant);
    });
  });

  it("E9 — selectTopRisks shown items preserve label and detail", () => {
    const r = selectTopRisks(LOW, 10);
    expect(r.shown[0].label).toBe("Minor gap");
    expect(r.shown[0].detail).toBe("Gap risk");
  });

  it("E10 — buildCompactPlanData with undefined rewardRisk: 0 should still be '—'", () => {
    // rewardRisk: 0 is falsy but a valid number — ensure it renders as "0.0:1" not "—"
    const pkg = makePkg({ rewardRisk: 0 });
    const plan = buildCompactPlanData(pkg, null);
    expect(plan.rewardRisk).toBe("0.0:1");
  });
});
