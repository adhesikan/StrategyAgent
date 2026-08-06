// Tests for Sprint 2.1.3 — Research Decision Engine
//
// Covers all exported pure functions. No DOM rendering required.
// All logic is deterministic — same inputs always produce same output.

import { describe, it, expect } from "vitest";
import { deriveThesis, buildThesisExplanation } from "./research-decision-card";
import {
  computeTechnicalScore,
  computeMomentumScore,
  computeVolumeScore,
  computeRelativeStrengthScore,
  computeRegimeScore,
  computeFundamentalsScore,
  computeLiquidityScore,
  computeRiskScore,
  computeScoreComponents,
} from "./score-breakdown-card";
import {
  classifyEvidenceAlignment,
  buildEvidenceSections,
} from "./supporting-evidence-card";
import { buildInvalidationItems } from "./invalidation-card";
import { buildImprovementItems, buildWarningItems } from "./catalyst-timeline-card";
import { buildQualificationConfirmations } from "./qualification-summary-card";
import type { ResearchPackage, EvidenceStars } from "../types";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ResearchPackage["candidate"]> = {}): ResearchPackage["candidate"] {
  return {
    rank: 1,
    symbol: "NVDA",
    strategy: "VCP",
    confidence: "high",
    whySelected: ["Strong RS vs SPY", "Volume dry-up in base", "Near 52-week high pivot"],
    warnings: [],
    trigger: "135.50",
    invalidation: "128.00",
    objective: "148.00",
    rewardRisk: 2.4,
    maxRisk: 500,
    dataQuality: "good",
    fitsRiskBudget: true,
    ...overrides,
  };
}

function makePkg(overrides: Partial<ResearchPackage> = {}): ResearchPackage {
  return {
    symbol: "NVDA",
    candidate: makeCandidate(),
    lifecycleItem: null,
    scanHistory: [],
    brokerConnected: false,
    marketRegime: "TRENDING",
    dataSource: "mcp-v1",
    dataQuality: "good",
    freshnessStatus: "fresh",
    completedAt: new Date().toISOString(),
    snapshotId: "snap-001",
    ...overrides,
  };
}

const baseStars: EvidenceStars = {
  technical: 5,
  congress: 3,
  news: 3,
  institutional: 0,
  catalysts: 2,
  regime: 5,
};

// ---------------------------------------------------------------------------
// deriveThesis
// ---------------------------------------------------------------------------

describe("deriveThesis", () => {
  it("returns bullish for trending + high confidence + no warnings", () => {
    expect(deriveThesis(makePkg(), baseStars)).toBe("bullish");
  });

  it("returns bearish for 3+ warnings", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ warnings: ["W1", "W2", "W3"] }),
    });
    expect(deriveThesis(pkg, baseStars)).toBe("bearish");
  });

  it("returns bearish for RISK_OFF + low tech score", () => {
    const pkg = makePkg({
      marketRegime: "RISK_OFF",
      candidate: makeCandidate({ confidence: "low", whySelected: [] }),
    });
    expect(deriveThesis(pkg, baseStars)).toBe("bearish");
  });

  it("returns neutral for choppy market", () => {
    const pkg = makePkg({ marketRegime: "CHOPPY" });
    expect(deriveThesis(pkg, baseStars)).toBe("neutral");
  });

  it("returns neutral for medium confidence", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ confidence: "medium" }),
    });
    // techScore = 55 (medium) → below 70 → neutral
    expect(deriveThesis(pkg, baseStars)).toBe("neutral");
  });

  it("returns one of three valid thesis values", () => {
    const result = deriveThesis(makePkg(), baseStars);
    expect(["bullish", "neutral", "bearish"]).toContain(result);
  });

  it("handles null market regime gracefully", () => {
    const pkg = makePkg({ marketRegime: null });
    const result = deriveThesis(pkg, baseStars);
    // high confidence but no regime → bullish (regimeAvail=false → falls through)
    expect(result).toBe("bullish");
  });
});

// ---------------------------------------------------------------------------
// buildThesisExplanation
// ---------------------------------------------------------------------------

describe("buildThesisExplanation", () => {
  it("returns a non-empty string", () => {
    const exp = buildThesisExplanation(makePkg());
    expect(typeof exp).toBe("string");
    expect(exp.length).toBeGreaterThan(10);
  });

  it("mentions the primary whySelected item", () => {
    const pkg = makePkg();
    const exp = buildThesisExplanation(pkg);
    expect(exp).toContain("Strong RS vs SPY");
  });

  it("mentions the strategy", () => {
    const exp = buildThesisExplanation(makePkg());
    expect(exp.toLowerCase()).toContain("vcp");
  });

  it("includes regime context for TRENDING", () => {
    const exp = buildThesisExplanation(makePkg({ marketRegime: "TRENDING" }));
    expect(exp.toLowerCase()).toContain("uptrend");
  });

  it("includes caution note for RISK_OFF", () => {
    const exp = buildThesisExplanation(makePkg({ marketRegime: "RISK_OFF" }));
    expect(exp.toLowerCase()).toContain("risk-off");
  });

  it("mentions warning count when warnings present", () => {
    const pkg = makePkg({ candidate: makeCandidate({ warnings: ["Earnings next week"] }) });
    const exp = buildThesisExplanation(pkg);
    expect(exp).toContain("1 scanner warning flag");
  });

  it("does not mention warnings when there are none", () => {
    const exp = buildThesisExplanation(makePkg());
    expect(exp).not.toContain("scanner warning flag");
  });

  it("handles missing whySelected gracefully", () => {
    const pkg = makePkg({ candidate: makeCandidate({ whySelected: [] }) });
    const exp = buildThesisExplanation(pkg);
    expect(exp).toContain("scanner pattern identification");
  });
});

// ---------------------------------------------------------------------------
// computeTechnicalScore
// ---------------------------------------------------------------------------

describe("computeTechnicalScore", () => {
  it("returns 85 for high confidence + 3+ why items", () => {
    expect(computeTechnicalScore(makeCandidate())).toBe(85);
  });

  it("returns 70 for high confidence + 1 why item", () => {
    expect(computeTechnicalScore(makeCandidate({ whySelected: ["One reason"] }))).toBe(70);
  });

  it("returns 55 for medium confidence", () => {
    expect(computeTechnicalScore(makeCandidate({ confidence: "medium" }))).toBe(55);
  });

  it("returns 35 for low confidence", () => {
    expect(computeTechnicalScore(makeCandidate({ confidence: "low" }))).toBe(35);
  });

  it("returns 20 for no confidence", () => {
    expect(computeTechnicalScore(makeCandidate({ confidence: undefined }))).toBe(20);
  });

  it("is case-insensitive for confidence", () => {
    expect(computeTechnicalScore(makeCandidate({ confidence: "HIGH" }))).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// computeMomentumScore
// ---------------------------------------------------------------------------

describe("computeMomentumScore", () => {
  it("returns 75 for VCP strategy", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "VCP" }))).toBe(75);
  });

  it("returns 70 for GAP_AND_GO", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "GAP_AND_GO" }))).toBe(70);
  });

  it("returns 62 for ORB5", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "ORB5" }))).toBe(62);
  });

  it("returns 55 for PULLBACK", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "PULLBACK" }))).toBe(55);
  });

  it("returns 60 for SWING_TRADE", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "SWING_TRADE" }))).toBe(60);
  });

  it("returns 40 for unknown strategy", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: "UNKNOWN" }))).toBe(40);
  });

  it("returns 40 when strategy is undefined", () => {
    expect(computeMomentumScore(makeCandidate({ strategy: undefined }))).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// computeVolumeScore
// ---------------------------------------------------------------------------

describe("computeVolumeScore", () => {
  it("returns 30 when no volume mention", () => {
    expect(computeVolumeScore(makeCandidate({ whySelected: ["Strong trend"] }))).toBe(30);
  });

  it("returns higher score when volume dry-up present", () => {
    const score = computeVolumeScore(makeCandidate({
      whySelected: ["Volume dry-up confirmed", "RS strong"],
    }));
    expect(score).toBeGreaterThan(50);
  });

  it("returns higher score when volume surge present", () => {
    const score = computeVolumeScore(makeCandidate({
      whySelected: ["Volume surge on breakout"],
    }));
    expect(score).toBeGreaterThan(50);
  });

  it("reduces score when liquidity warning present", () => {
    const noWarn = computeVolumeScore(makeCandidate({ whySelected: ["Volume dry-up"] }));
    const withWarn = computeVolumeScore(makeCandidate({
      whySelected: ["Volume dry-up"],
      warnings: ["Thin volume in premarket"],
    }));
    expect(withWarn).toBeLessThan(noWarn);
  });

  it("clamps score between 20 and 90", () => {
    const extreme = computeVolumeScore(makeCandidate({
      whySelected: ["Volume surge expansion dry"],
      warnings: ["Thin volume thin volume thin volume"],
    }));
    expect(extreme).toBeGreaterThanOrEqual(20);
    expect(extreme).toBeLessThanOrEqual(90);
  });
});

// ---------------------------------------------------------------------------
// computeRegimeScore
// ---------------------------------------------------------------------------

describe("computeRegimeScore", () => {
  it("returns score 90 and available for TRENDING", () => {
    const { score, available } = computeRegimeScore("TRENDING");
    expect(score).toBe(90);
    expect(available).toBe(true);
  });

  it("returns score 50 for CHOPPY", () => {
    expect(computeRegimeScore("CHOPPY").score).toBe(50);
  });

  it("returns score 15 for RISK_OFF", () => {
    expect(computeRegimeScore("RISK_OFF").score).toBe(15);
  });

  it("returns available=false for null regime", () => {
    const { available } = computeRegimeScore(null);
    expect(available).toBe(false);
  });

  it("returns score 0 for null regime", () => {
    expect(computeRegimeScore(null).score).toBe(0);
  });

  it("returns available=true and a score for unknown regime", () => {
    const { available, score } = computeRegimeScore("SIDEWAYS");
    expect(available).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeScoreComponents
// ---------------------------------------------------------------------------

describe("computeScoreComponents", () => {
  it("returns exactly 11 components", () => {
    const components = computeScoreComponents(makePkg(), baseStars);
    expect(components).toHaveLength(11);
  });

  it("all components have id, label, score, available, source", () => {
    const components = computeScoreComponents(makePkg(), baseStars);
    for (const c of components) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.score).toBe("number");
      expect(typeof c.available).toBe("boolean");
      expect(typeof c.source).toBe("string");
    }
  });

  it("institutional is always unavailable with score 0", () => {
    const components = computeScoreComponents(makePkg(), baseStars);
    const inst = components.find((c) => c.id === "institutional")!;
    expect(inst.available).toBe(false);
    expect(inst.score).toBe(0);
  });

  it("all scores are 0–100", () => {
    const components = computeScoreComponents(makePkg(), baseStars);
    for (const c of components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  it("news score equals stars.news * 20", () => {
    const components = computeScoreComponents(makePkg(), { ...baseStars, news: 4 });
    const news = components.find((c) => c.id === "news")!;
    expect(news.score).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// classifyEvidenceAlignment
// ---------------------------------------------------------------------------

describe("classifyEvidenceAlignment", () => {
  it("returns unavailable when available=false", () => {
    expect(classifyEvidenceAlignment(90, false)).toBe("unavailable");
  });

  it("returns supports for score >= 65", () => {
    expect(classifyEvidenceAlignment(65, true)).toBe("supports");
    expect(classifyEvidenceAlignment(100, true)).toBe("supports");
  });

  it("returns neutral for score 40-64", () => {
    expect(classifyEvidenceAlignment(40, true)).toBe("neutral");
    expect(classifyEvidenceAlignment(64, true)).toBe("neutral");
  });

  it("returns weakens for score < 40", () => {
    expect(classifyEvidenceAlignment(0, true)).toBe("weakens");
    expect(classifyEvidenceAlignment(39, true)).toBe("weakens");
  });
});

// ---------------------------------------------------------------------------
// buildInvalidationItems
// ---------------------------------------------------------------------------

describe("buildInvalidationItems", () => {
  it("returns exactly 6 items", () => {
    const items = buildInvalidationItems(makePkg());
    expect(items).toHaveLength(6);
  });

  it("price item is available when invalidation is present", () => {
    const items = buildInvalidationItems(makePkg());
    const price = items.find((i) => i.type === "price")!;
    expect(price.available).toBe(true);
    expect(price.description).toContain("128.00");
  });

  it("price item is unavailable when invalidation is absent", () => {
    const pkg = makePkg({ candidate: makeCandidate({ invalidation: undefined }) });
    const items = buildInvalidationItems(pkg);
    const price = items.find((i) => i.type === "price")!;
    expect(price.available).toBe(false);
  });

  it("covers all required types", () => {
    const items = buildInvalidationItems(makePkg());
    const types = items.map((i) => i.type);
    expect(types).toContain("price");
    expect(types).toContain("technical");
    expect(types).toContain("fundamental");
    expect(types).toContain("earnings");
    expect(types).toContain("macro");
    expect(types).toContain("sector");
  });

  it("earnings item reflects warning keyword", () => {
    const pkg = makePkg({ candidate: makeCandidate({ warnings: ["Earnings report next week"] }) });
    const items = buildInvalidationItems(pkg);
    const earn = items.find((i) => i.type === "earnings")!;
    expect(earn.description.toLowerCase()).toContain("earnings");
  });

  it("macro item reflects RISK_OFF regime", () => {
    const pkg = makePkg({ marketRegime: "RISK_OFF" });
    const items = buildInvalidationItems(pkg);
    const macro = items.find((i) => i.type === "macro")!;
    expect(macro.description.toLowerCase()).toContain("risk-off");
  });
});

// ---------------------------------------------------------------------------
// buildImprovementItems
// ---------------------------------------------------------------------------

describe("buildImprovementItems", () => {
  it("returns at most 5 items", () => {
    const items = buildImprovementItems(makePkg(), baseStars);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("suggests regime improvement when not TRENDING", () => {
    const pkg = makePkg({ marketRegime: "CHOPPY" });
    const items = buildImprovementItems(pkg, baseStars);
    expect(items.some((i) => i.id === "regime")).toBe(true);
  });

  it("does not suggest regime improvement when TRENDING", () => {
    const pkg = makePkg({ marketRegime: "TRENDING" });
    const items = buildImprovementItems(pkg, baseStars);
    expect(items.some((i) => i.id === "regime")).toBe(false);
  });

  it("suggests R/R improvement when rewardRisk < 2", () => {
    const pkg = makePkg({ candidate: makeCandidate({ rewardRisk: 1.5 }) });
    const items = buildImprovementItems(pkg, baseStars);
    expect(items.some((i) => i.id === "reward-risk")).toBe(true);
  });

  it("suggests R/R calculation when rewardRisk is absent", () => {
    const pkg = makePkg({ candidate: makeCandidate({ rewardRisk: undefined }) });
    const items = buildImprovementItems(pkg, baseStars);
    expect(items.some((i) => i.id === "reward-risk")).toBe(true);
  });

  it("each item has id, category, and text", () => {
    const items = buildImprovementItems(makePkg(), baseStars);
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.category).toBe("string");
      expect(typeof item.text).toBe("string");
      expect(item.text.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildWarningItems
// ---------------------------------------------------------------------------

describe("buildWarningItems", () => {
  it("returns at most 6 items", () => {
    const items = buildWarningItems(makePkg());
    expect(items.length).toBeLessThanOrEqual(6);
  });

  it("returns empty array for a clean candidate", () => {
    const pkg = makePkg({ marketRegime: "TRENDING" });
    const items = buildWarningItems(pkg);
    expect(items).toHaveLength(0);
  });

  it("includes scanner warnings as high severity", () => {
    const pkg = makePkg({ candidate: makeCandidate({ warnings: ["Earnings next week"] }) });
    const items = buildWarningItems(pkg);
    const scannerWarn = items.find((i) => i.id === "scanner-0");
    expect(scannerWarn).toBeDefined();
    expect(scannerWarn?.severity).toBe("high");
  });

  it("includes RISK_OFF regime warning as high severity", () => {
    const pkg = makePkg({ marketRegime: "RISK_OFF" });
    const items = buildWarningItems(pkg);
    const regimeWarn = items.find((i) => i.id === "regime-risk-off");
    expect(regimeWarn).toBeDefined();
    expect(regimeWarn?.severity).toBe("high");
  });

  it("includes CHOPPY regime warning as medium severity", () => {
    const pkg = makePkg({ marketRegime: "CHOPPY" });
    const items = buildWarningItems(pkg);
    const choppyWarn = items.find((i) => i.id === "regime-choppy");
    expect(choppyWarn?.severity).toBe("medium");
  });

  it("each item has id, severity, and text", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ warnings: ["Test warning"] }),
      marketRegime: "CHOPPY",
    });
    const items = buildWarningItems(pkg);
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(["high", "medium", "low"]).toContain(item.severity);
      expect(typeof item.text).toBe("string");
      expect(item.text.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildQualificationConfirmations
// ---------------------------------------------------------------------------

describe("buildQualificationConfirmations", () => {
  it("returns exactly 4 confirmations", () => {
    const conf = buildQualificationConfirmations(makePkg());
    expect(conf).toHaveLength(4);
  });

  it("covers all 4 required signals", () => {
    const conf = buildQualificationConfirmations(makePkg());
    const ids = conf.map((c) => c.id);
    expect(ids).toContain("market-regime");
    expect(ids).toContain("volume");
    expect(ids).toContain("trend");
    expect(ids).toContain("momentum");
  });

  it("regime is confirmed for TRENDING", () => {
    const conf = buildQualificationConfirmations(makePkg({ marketRegime: "TRENDING" }));
    const regime = conf.find((c) => c.id === "market-regime")!;
    expect(regime.status).toBe("confirmed");
  });

  it("regime is missing for RISK_OFF", () => {
    const conf = buildQualificationConfirmations(makePkg({ marketRegime: "RISK_OFF" }));
    const regime = conf.find((c) => c.id === "market-regime")!;
    expect(regime.status).toBe("missing");
  });

  it("regime is unavailable when null", () => {
    const conf = buildQualificationConfirmations(makePkg({ marketRegime: null }));
    const regime = conf.find((c) => c.id === "market-regime")!;
    expect(regime.status).toBe("unavailable");
  });

  it("volume is confirmed when whySelected has dry-up", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ whySelected: ["Volume dry-up in base", "RS strong"] }),
    });
    const conf = buildQualificationConfirmations(pkg);
    const vol = conf.find((c) => c.id === "volume")!;
    expect(vol.status).toBe("confirmed");
  });

  it("volume is missing when no volume mention", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ whySelected: ["Strong trend", "High RS"] }),
    });
    const conf = buildQualificationConfirmations(pkg);
    const vol = conf.find((c) => c.id === "volume")!;
    expect(vol.status).toBe("missing");
  });

  it("each confirmation has id, label, status, and detail", () => {
    const conf = buildQualificationConfirmations(makePkg());
    for (const c of conf) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(["confirmed", "partial", "missing", "unavailable"]).toContain(c.status);
      expect(typeof c.detail).toBe("string");
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});
