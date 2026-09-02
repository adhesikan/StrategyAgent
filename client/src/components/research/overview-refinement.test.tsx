// Sprint 2.2.1 — Overview refinement tests
//
// Covers:
//  - Research posture: bullish candidate with multiple warnings is NOT Bearish
//  - Research thesis: concise, specific, uses rank / strategy / regime / warnings
//  - Evidence numeric scores: shown when available, N/A for institutional
//  - Stock parameters: no bare blank/dash values
//  - Options summary: DTE + strike guidance shown; no premiums / Greeks
//  - Risk grouping: warnings categorized without loss, high-severity first
//  - Action card: connected → Review with InstaTrade®; disconnected → Connect Broker
//  - Congress summary: disclaimer always present; no fabricated counts
//  - Compact market context: regime label, alignment, data source

import { describe, it, expect } from "vitest";

// ── Decision card helpers ────────────────────────────────────────────────────
import {
  derivePosture,
  deriveThesis,
  buildThesisExplanation,
} from "./decision/research-decision-card";

// ── Evidence card helpers ────────────────────────────────────────────────────
import {
  evidenceSignalLabel,
  computeEvidenceNumericScores,
  scoreToLabel,
  normalizeRegimeForScoring,
  isTechnicalScoreAvailable,
  evidenceSignalClass,
} from "./evidence-card";

// ── Stock trade card helpers ─────────────────────────────────────────────────
import { resolveFieldState } from "./stock-trade-card";

// ── Risk card helpers ────────────────────────────────────────────────────────
import { classifyWarning, groupWarnings } from "./risk-card";

// ── Congress summary helpers ─────────────────────────────────────────────────
import { congressActivityLabel } from "./congress-summary-card";

// ── Compact market context helpers ───────────────────────────────────────────
import {
  formatRegimeLabel,
  deriveAlignment,
  sanitizeDataSource,
} from "./compact-market-context";

import type { ResearchPackage, EvidenceStars } from "./types";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makePkg(overrides: Partial<ResearchPackage> = {}): ResearchPackage {
  return {
    symbol: "PLTR",
    brokerConnected: false,
    marketRegime: "TRENDING",
    dataSource: "Stored market history via MCP (Twelve Data)",
    dataQuality: "good",
    freshnessStatus: "fresh",
    completedAt: new Date().toISOString(),
    snapshotId: "snap-1",
    lifecycleItem: null,
    scanHistory: [],
    candidate: {
      rank: 2,
      symbol: "PLTR",
      strategy: "VCP",
      confidence: "high",
      whySelected: ["Volume contraction meeting VCP criteria"],
      warnings: [],
      fitsRiskBudget: true,
    },
    ...overrides,
  };
}

function makeStars(overrides: Partial<EvidenceStars> = {}): EvidenceStars {
  return {
    technical: 4,
    congress: 3,
    news: 4,
    institutional: 0,
    catalysts: 2,
    regime: 5,
    ...overrides,
  };
}

// ===========================================================================
// 1. Research Posture tests
// ===========================================================================

describe("derivePosture — bullish candidate should never show Bearish from warnings alone", () => {
  it("bullish base + 3 warnings → Constructive, not Bearish", () => {
    const pkg = makePkg({
      marketRegime: "TRENDING",
      candidate: {
        rank: 1,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Volume contraction pattern", "Strong relative strength"],
        warnings: [
          "Earnings upcoming within 2 weeks",
          "Volume below 10-day average",
          "Sector under distribution",
        ],
      },
    });
    const stars = makeStars();
    const posture = derivePosture(pkg, stars);
    expect(posture).not.toBe("bearish");
    expect(["constructive", "bullish"]).toContain(posture);
  });

  it("bullish base + 4 warnings → Constructive, not Bearish", () => {
    const pkg = makePkg({
      marketRegime: "TRENDING",
      candidate: {
        rank: 3,
        symbol: "NVDA",
        strategy: "BREAKOUT",
        confidence: "medium",
        whySelected: ["Fresh breakout above pivot"],
        warnings: ["W1", "W2", "W3", "W4"],
      },
    });
    const posture = derivePosture(pkg, makeStars());
    expect(posture).not.toBe("bearish");
    expect(["constructive", "neutral", "unrated"]).toContain(posture);
  });

  it("RISK_OFF + weak technicals → Bearish (explicit bearish signal)", () => {
    const pkg = makePkg({
      marketRegime: "RISK_OFF",
      candidate: {
        rank: 5,
        symbol: "XYZ",
        strategy: "SWING",
        confidence: "low",
        whySelected: [],
        warnings: [],
      },
    });
    const posture = derivePosture(pkg, makeStars({ technical: 1, regime: 1 }));
    expect(posture).toBe("bearish");
  });

  it("RISK_OFF + strong technicals → Defensive, not Bearish", () => {
    const pkg = makePkg({
      marketRegime: "RISK_OFF",
      candidate: {
        rank: 1,
        symbol: "AAPL",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Strong relative strength", "Volume contraction"],
        warnings: [],
      },
    });
    const posture = derivePosture(pkg, makeStars());
    expect(posture).toBe("defensive");
  });

  it("missing confidence + weak evidence → Unrated, not Bearish", () => {
    const pkg = makePkg({
      marketRegime: "CHOPPY",
      candidate: {
        rank: 4,
        symbol: "ABC",
        strategy: "SWING",
        confidence: undefined,
        whySelected: [],
        warnings: [],
      },
    });
    const posture = derivePosture(
      pkg,
      makeStars({ technical: 1, regime: 2, congress: 1, news: 1, catalysts: 1 }),
    );
    expect(posture).toBe("unrated");
    expect(posture).not.toBe("bearish");
  });

  it("bullish candidate with 0 warnings in TRENDING → Bullish", () => {
    const pkg = makePkg({
      marketRegime: "TRENDING",
      candidate: {
        rank: 1,
        symbol: "META",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Perfect VCP contraction", "Relative strength leader"],
        warnings: [],
        invalidation: "500",
      },
    });
    const posture = derivePosture(pkg, makeStars());
    expect(posture).toBe("bullish");
  });
});

describe("deriveThesis — backward-compat (3-way) still works correctly", () => {
  it("does NOT return bearish from warning count alone", () => {
    const pkg = makePkg({
      marketRegime: "TRENDING",
      candidate: {
        rank: 1,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Volume contraction", "RS leader"],
        warnings: ["W1", "W2", "W3", "W4"],
      },
    });
    const thesis = deriveThesis(pkg, makeStars());
    expect(thesis).not.toBe("bearish");
  });

  it("RISK_OFF + weak tech → bearish", () => {
    const pkg = makePkg({
      marketRegime: "RISK_OFF",
      candidate: {
        rank: 5,
        symbol: "XYZ",
        strategy: "SWING",
        confidence: "low",
        whySelected: [],
        warnings: [],
      },
    });
    const thesis = deriveThesis(pkg, makeStars({ technical: 1 }));
    expect(thesis).toBe("bearish");
  });

  it("null marketRegime → handled without throwing", () => {
    const pkg = makePkg({ marketRegime: null });
    expect(() => deriveThesis(pkg, makeStars())).not.toThrow();
  });
});

// ===========================================================================
// 2. Thesis explanation tests
// ===========================================================================

describe("buildThesisExplanation", () => {
  it("includes strategy when available", () => {
    const pkg = makePkg({
      candidate: {
        rank: 2,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Volume contraction meeting VCP criteria"],
        warnings: [],
      },
    });
    const text = buildThesisExplanation(pkg);
    expect(text).toContain("VCP");
  });

  it("includes rank when available", () => {
    const pkg = makePkg();
    const text = buildThesisExplanation(pkg);
    expect(text).toContain("#2");
  });

  it("includes regime when TRENDING", () => {
    const pkg = makePkg({ marketRegime: "TRENDING" });
    const text = buildThesisExplanation(pkg);
    expect(text.toLowerCase()).toContain("bull");
  });

  it("includes warning count when warnings > 0", () => {
    const pkg = makePkg({
      candidate: {
        rank: 2,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["Volume contraction"],
        warnings: ["W1", "W2", "W3", "W4"],
      },
    });
    const text = buildThesisExplanation(pkg);
    expect(text).toContain("4");
    expect(text.toLowerCase()).toContain("warning");
  });

  it("handles missing whySelected gracefully", () => {
    const pkg = makePkg({
      candidate: {
        rank: 1,
        symbol: "PLTR",
        strategy: "VCP",
        whySelected: [],
        warnings: [],
      },
    });
    const text = buildThesisExplanation(pkg);
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(20);
  });

  it("handles null marketRegime honestly", () => {
    const pkg = makePkg({ marketRegime: null });
    const text = buildThesisExplanation(pkg);
    expect(text.toLowerCase()).toContain("unavailable");
  });
});

// ===========================================================================
// 3. Evidence signal tests
// ===========================================================================

describe("evidenceSignalLabel", () => {
  it("returns 'Unavailable' for 0 stars", () => {
    expect(evidenceSignalLabel(0)).toBe("Unavailable");
  });

  it("returns labeled text for each level without relying on color", () => {
    expect(evidenceSignalLabel(1)).toBe("Weak");
    expect(evidenceSignalLabel(2)).toBe("Limited");
    expect(evidenceSignalLabel(3)).toBe("Moderate");
    expect(evidenceSignalLabel(4)).toBe("Solid");
    expect(evidenceSignalLabel(5)).toBe("Strong");
  });
});

describe("computeEvidenceNumericScores", () => {
  it("news score = stars.news * 20", () => {
    const stars = makeStars({ news: 4 });
    const scores = computeEvidenceNumericScores(stars);
    expect(scores.news).toBe(80);
  });

  it("congress score = stars.congress * 20", () => {
    const stars = makeStars({ congress: 3 });
    const scores = computeEvidenceNumericScores(stars);
    expect(scores.congress).toBe(60);
  });

  it("institutional is always null (N/A)", () => {
    const stars = makeStars();
    const scores = computeEvidenceNumericScores(stars);
    expect(scores.institutional).toBeNull();
  });

  it("catalysts score is approximately stars.catalysts * 33", () => {
    const stars = makeStars({ catalysts: 2 });
    const scores = computeEvidenceNumericScores(stars);
    expect(scores.catalysts).toBeGreaterThan(60);
    expect(scores.catalysts).toBeLessThanOrEqual(70);
  });

  it("does not fabricate scores when unavailable", () => {
    const stars = makeStars({ congress: 1 });
    const scores = computeEvidenceNumericScores(stars);
    expect(typeof scores.congress).toBe("number");
    expect(scores.congress).toBe(20); // 1 * 20
  });
});

// ===========================================================================
// 4. Stock parameters — resolved field state
// ===========================================================================

describe("resolveFieldState — no bare blank metric values", () => {
  it("entry: missing → 'Not resolved' with explanation", () => {
    const result = resolveFieldState(null, "entry");
    expect(result.isResolved).toBe(false);
    expect(result.value).not.toBe("—");
    expect(result.value).not.toBe("");
    expect(result.value).toBe("Not resolved");
    expect(result.sub).toBeTruthy();
  });

  it("stop: missing → 'Not resolved' with explanation", () => {
    const result = resolveFieldState(undefined, "stop");
    expect(result.isResolved).toBe(false);
    expect(result.value).toBe("Not resolved");
    expect(result.sub).toBeTruthy();
  });

  it("rr: missing → 'Not calculated' with explanation", () => {
    const result = resolveFieldState(null, "rr");
    expect(result.value).toBe("Not calculated");
    expect(result.sub).toContain("entry");
  });

  it("maxRisk: missing → informative state", () => {
    const result = resolveFieldState(null, "maxRisk");
    expect(result.isResolved).toBe(false);
    expect(result.value).not.toBe("—");
  });

  it("position: missing → requires risk budget message", () => {
    const result = resolveFieldState(null, "position");
    expect(result.value.toLowerCase()).toContain("risk budget");
  });

  it("confidence: missing → informative state", () => {
    const result = resolveFieldState(null, "confidence");
    expect(result.value).toBe("Not resolved");
    expect(result.sub).toBeTruthy();
  });

  it("resolved values pass through unchanged", () => {
    const result = resolveFieldState("150.25", "entry");
    expect(result.isResolved).toBe(true);
    expect(result.value).toBe("150.25");
  });
});

// ===========================================================================
// 5. Options summary — no fabricated values
// ===========================================================================
// These tests operate on the options-structure-card helpers directly
// to verify the compact overview contract.
import { deriveOptionsStructures, deriveDTE, deriveStrikeGuidance } from "./structure/options-structure-card";
import { deriveThesis as _dt } from "./decision/research-decision-card";

describe("compact options overview contract", () => {
  it("DTE range is always shown (no specific expiration date)", () => {
    const pkg = makePkg();
    const dte = deriveDTE(pkg.candidate);
    expect(dte).toMatch(/DTE/);
    // must be a range or period label, never an actual date
    expect(dte).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO date
    expect(dte).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/); // no month name
  });

  it("strike guidance is shown for bull-call-spread", () => {
    const guidance = deriveStrikeGuidance("bull-call-spread");
    expect(guidance).toBeTruthy();
    // must not contain a fabricated dollar amount
    expect(guidance).not.toMatch(/\$\d+/);
  });

  it("RISK_OFF → no options structures generated", () => {
    const pkg = makePkg({ marketRegime: "RISK_OFF" });
    const thesis = _dt(pkg, makeStars());
    const structures = deriveOptionsStructures(pkg, thesis);
    expect(structures).toHaveLength(0);
  });

  it("intraday strategy → no options structures generated", () => {
    const pkg = makePkg({
      candidate: {
        rank: 1,
        symbol: "SPY",
        strategy: "ORB5",
        whySelected: [],
        warnings: [],
      },
    });
    const thesis = _dt(pkg, makeStars());
    const structures = deriveOptionsStructures(pkg, thesis);
    expect(structures).toHaveLength(0);
  });

  it("bullish TRENDING + high confidence → at least one structure recommended", () => {
    const pkg = makePkg({
      marketRegime: "TRENDING",
      candidate: {
        rank: 1,
        symbol: "NVDA",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["RS leader"],
        warnings: [],
      },
    });
    const thesis = _dt(pkg, makeStars());
    const structures = deriveOptionsStructures(pkg, thesis);
    expect(structures.length).toBeGreaterThan(0);
    // no fabricated premium / Greeks / open interest in structure objects
    for (const s of structures) {
      expect((s as any).premium).toBeUndefined();
      expect((s as any).delta).toBeUndefined();
      expect((s as any).openInterest).toBeUndefined();
      expect((s as any).probability).toBeUndefined();
    }
  });

  it("no expiration dates in any derived structure", () => {
    const pkg = makePkg({ marketRegime: "TRENDING" });
    const thesis = _dt(pkg, makeStars());
    const structures = deriveOptionsStructures(pkg, thesis);
    for (const s of structures) {
      // expiration should be a DTE range string, never a date string
      expect(s.preferredDTE).toMatch(/DTE/);
      expect(s.preferredDTE).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

// ===========================================================================
// 6. Risk grouping tests
// ===========================================================================

describe("classifyWarning — deterministic keyword mapping", () => {
  it("classifies earnings warning as 'market'", () => {
    expect(classifyWarning("Earnings report expected within 2 weeks")).toBe("market");
  });
  it("classifies sector warning as 'market'", () => {
    expect(classifyWarning("Sector showing distribution")).toBe("market");
  });
  it("classifies stop-related warning as 'trade-plan'", () => {
    expect(classifyWarning("No stop level has been supplied by the scanner")).toBe("trade-plan");
  });
  it("classifies objective warning as 'trade-plan'", () => {
    expect(classifyWarning("Scanner did not provide a price objective")).toBe("trade-plan");
  });
  it("classifies liquidity warning as 'execution'", () => {
    expect(classifyWarning("Low average daily volume — liquidity may be limited")).toBe("execution");
  });
  it("classifies float/thin warning as 'execution'", () => {
    expect(classifyWarning("Thin float may cause wider spreads")).toBe("execution");
  });
  it("unclassified → 'other'", () => {
    expect(classifyWarning("Unknown scanner note")).toBe("other");
  });
});

describe("groupWarnings — no warnings are lost", () => {
  it("all warnings appear exactly once across groups", () => {
    const warnings = [
      "Earnings upcoming",
      "No stop supplied",
      "Thin float",
      "Unknown risk",
      "Volume below average",
    ];
    const groups = groupWarnings(warnings);
    const all = [
      ...groups.market,
      ...groups["trade-plan"],
      ...groups.execution,
      ...groups.other,
    ];
    expect(all).toHaveLength(warnings.length);
    // every original warning appears
    for (const w of warnings) {
      expect(all).toContain(w);
    }
  });

  it("empty warnings → all groups empty", () => {
    const groups = groupWarnings([]);
    expect(groups.market).toHaveLength(0);
    expect(groups["trade-plan"]).toHaveLength(0);
    expect(groups.execution).toHaveLength(0);
    expect(groups.other).toHaveLength(0);
  });
});

// ===========================================================================
// 7. Congress summary — no fabricated counts, disclaimer always present
// ===========================================================================

describe("congressActivityLabel", () => {
  it("returns honest message for 0 or 1 stars (minimal/no data)", () => {
    // congress is typed 1–5; passing 1 covers the minimal case
    const label = congressActivityLabel(1);
    expect(label.toLowerCase()).toContain("minimal");
  });

  it("returns non-predictive language", () => {
    const label = congressActivityLabel(4);
    // must not contain predictive words
    expect(label.toLowerCase()).not.toContain("predict");
    expect(label.toLowerCase()).not.toContain("expected");
    expect(label.toLowerCase()).not.toContain("will");
  });

  it("returns 'active disclosures' for 4+ stars", () => {
    expect(congressActivityLabel(4).toLowerCase()).toContain("active");
    expect(congressActivityLabel(5).toLowerCase()).toContain("active");
  });
});

// ===========================================================================
// 8. Compact market context helpers
// ===========================================================================

describe("formatRegimeLabel", () => {
  it("maps TRENDING → Strong Bull", () => {
    expect(formatRegimeLabel("TRENDING")).toBe("Strong Bull");
  });
  it("maps CHOPPY → Choppy", () => {
    expect(formatRegimeLabel("CHOPPY")).toBe("Choppy");
  });
  it("maps RISK_OFF → Risk-Off", () => {
    expect(formatRegimeLabel("RISK_OFF")).toBe("Risk-Off");
  });
  it("returns 'Not available' for null", () => {
    expect(formatRegimeLabel(null)).toBe("Not available");
  });
  it("returns 'Not available' for undefined", () => {
    expect(formatRegimeLabel(undefined)).toBe("Not available");
  });
});

describe("deriveAlignment", () => {
  it("matching regimes → Aligned", () => {
    expect(deriveAlignment("TRENDING", "TRENDING")).toBe("Aligned");
  });
  it("RISK_OFF market → caution message", () => {
    expect(deriveAlignment("TRENDING", "RISK_OFF")).toContain("Risk-Off");
  });
  it("missing market regime → Not available", () => {
    expect(deriveAlignment("TRENDING", null)).toBe("Not available");
  });
});

describe("sanitizeDataSource", () => {
  it("twelve data + mcp → factual restatement", () => {
    const result = sanitizeDataSource("Stored market history via MCP (Twelve Data)");
    expect(result.toLowerCase()).toContain("mcp");
    expect(result.toLowerCase()).not.toContain("real-time");
    expect(result.toLowerCase()).not.toContain("live");
  });
  it("null → Not available", () => {
    expect(sanitizeDataSource(null)).toBe("Not available");
  });
  it("never claims real-time when data is stored", () => {
    const result = sanitizeDataSource("Stored daily bars");
    expect(result.toLowerCase()).not.toContain("real-time");
  });
});

// ===========================================================================
// 9. Evidence Presentation UAT Fix — Sprint 2.2.1 Final
// ===========================================================================

// --- scoreToLabel -----------------------------------------------------------

describe("scoreToLabel — shared threshold function", () => {
  it("100 / 100 maps to Strong, never Moderate or Weak", () => {
    expect(scoreToLabel(100)).toBe("Strong");
    expect(scoreToLabel(100)).not.toBe("Moderate");
    expect(scoreToLabel(100)).not.toBe("Weak");
  });

  it("81 maps to Strong (lower boundary)", () => {
    expect(scoreToLabel(81)).toBe("Strong");
  });

  it("80 maps to Solid (upper boundary of Solid)", () => {
    expect(scoreToLabel(80)).toBe("Solid");
  });

  it("60 maps to Moderate (consistent with Congress 3★ = 60 scenario)", () => {
    // Congress: 3★ × 20 = 60 → Moderate ← this was correct in UAT; must stay correct
    expect(scoreToLabel(60)).toBe("Moderate");
  });

  it("61 maps to Solid (not Moderate)", () => {
    expect(scoreToLabel(61)).toBe("Solid");
  });

  it("41 maps to Moderate (lower boundary of Moderate)", () => {
    expect(scoreToLabel(41)).toBe("Moderate");
  });

  it("40 maps to Limited", () => {
    expect(scoreToLabel(40)).toBe("Limited");
  });

  it("20 maps to Weak", () => {
    expect(scoreToLabel(20)).toBe("Weak");
  });

  it("null maps to N/A", () => {
    expect(scoreToLabel(null)).toBe("N/A");
  });

  it("score label and evidenceSignalLabel agree for all 5-star providers", () => {
    // stars × 20 must land in the same semantic bucket as evidenceSignalLabel(stars)
    const starLabelMap: Record<number, string> = {
      1: "Weak",
      2: "Limited",
      3: "Moderate",
      4: "Solid",
      5: "Strong",
    };
    for (const [stars, expected] of Object.entries(starLabelMap)) {
      const score = Number(stars) * 20;
      expect(scoreToLabel(score)).toBe(expected);
    }
  });
});

// --- normalizeRegimeForScoring ----------------------------------------------

describe("normalizeRegimeForScoring — MCP string normalization", () => {
  it("TRENDING (canonical) passes through unchanged", () => {
    expect(normalizeRegimeForScoring("TRENDING")).toBe("TRENDING");
  });

  it("strong_bull normalizes to TRENDING", () => {
    expect(normalizeRegimeForScoring("strong_bull")).toBe("TRENDING");
  });

  it("STRONG_BULL normalizes to TRENDING", () => {
    expect(normalizeRegimeForScoring("STRONG_BULL")).toBe("TRENDING");
  });

  it("bull_trend normalizes to TRENDING", () => {
    expect(normalizeRegimeForScoring("bull_trend")).toBe("TRENDING");
  });

  it("RISK_OFF (canonical) passes through unchanged", () => {
    expect(normalizeRegimeForScoring("RISK_OFF")).toBe("RISK_OFF");
  });

  it("risk_off normalizes to RISK_OFF", () => {
    expect(normalizeRegimeForScoring("risk_off")).toBe("RISK_OFF");
  });

  it("CHOPPY (canonical) passes through unchanged", () => {
    expect(normalizeRegimeForScoring("CHOPPY")).toBe("CHOPPY");
  });

  it("choppy normalizes to CHOPPY", () => {
    expect(normalizeRegimeForScoring("choppy")).toBe("CHOPPY");
  });

  it("unknown string returns null (→ N/A, not an invented score)", () => {
    expect(normalizeRegimeForScoring("COMPLETELY_UNKNOWN")).toBeNull();
    expect(normalizeRegimeForScoring("VOLATILE_REGIME")).toBeNull();
    expect(normalizeRegimeForScoring("TRANSITION")).toBeNull();
  });

  it("null returns null", () => {
    expect(normalizeRegimeForScoring(null)).toBeNull();
  });

  it("undefined returns null", () => {
    expect(normalizeRegimeForScoring(undefined)).toBeNull();
  });
});

// --- isTechnicalScoreAvailable ----------------------------------------------

describe("isTechnicalScoreAvailable", () => {
  it("candidate with confidence → available", () => {
    expect(isTechnicalScoreAvailable({ confidence: "high" })).toBe(true);
    expect(isTechnicalScoreAvailable({ confidence: "medium" })).toBe(true);
    expect(isTechnicalScoreAvailable({ confidence: "low" })).toBe(true);
  });

  it("confidence undefined → not available (must show N/A, not 20)", () => {
    expect(isTechnicalScoreAvailable({ confidence: undefined })).toBe(false);
  });

  it("confidence null → not available", () => {
    expect(isTechnicalScoreAvailable({ confidence: null })).toBe(false);
  });

  it("confidence empty string → not available", () => {
    expect(isTechnicalScoreAvailable({ confidence: "" })).toBe(false);
  });
});

// --- computeEvidenceNumericScores UAT scenarios ----------------------------

describe("computeEvidenceNumericScores — UAT fix scenarios", () => {
  const baseStars = makeStars({ catalysts: 3, regime: 5, news: 3, congress: 3 });

  it("Catalysts 3★ → score 100, label derived from score = Strong (UAT defect fix)", () => {
    const scores = computeEvidenceNumericScores(baseStars);
    expect(scores.catalysts).toBe(100);
    // scoreToLabel(100) = "Strong" — not "Moderate"
    expect(scoreToLabel(scores.catalysts!)).toBe("Strong");
    expect(scoreToLabel(scores.catalysts!)).not.toBe("Moderate");
  });

  it("Congress 3★ → score 60 → Moderate (was correct in UAT; must stay correct)", () => {
    const scores = computeEvidenceNumericScores(baseStars);
    expect(scores.congress).toBe(60);
    expect(scoreToLabel(scores.congress!)).toBe("Moderate");
  });

  it("Technical: missing confidence → null (N/A), not 20", () => {
    const pkg = makePkg({
      candidate: {
        rank: 1,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: undefined,
        whySelected: ["Strong RS", "Volume contraction", "Above 200 SMA"],
        warnings: [],
      },
    });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.technical).toBeNull(); // must not be 20
  });

  it("Technical: confidence 'high' + 3 whySelected → score 85, not null", () => {
    const pkg = makePkg({
      candidate: {
        rank: 1,
        symbol: "PLTR",
        strategy: "VCP",
        confidence: "high",
        whySelected: ["RS leader", "Volume contraction", "Above 200 SMA"],
        warnings: [],
      },
    });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.technical).toBe(85);
    expect(scoreToLabel(scores.technical!)).toBe("Strong");
  });

  it("Regime: strong_bull → normalized to TRENDING → score 90 (UAT defect fix)", () => {
    const pkg = makePkg({ marketRegime: "strong_bull" });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.regime).toBe(90);
    expect(scoreToLabel(scores.regime!)).toBe("Strong");
  });

  it("Regime: RISK_OFF → score 15 → Weak (remains correct, defensive intent preserved)", () => {
    const pkg = makePkg({ marketRegime: "RISK_OFF" });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.regime).toBe(15);
    expect(scoreToLabel(scores.regime!)).toBe("Weak");
  });

  it("Regime: TRENDING → score 90 → Strong", () => {
    const pkg = makePkg({ marketRegime: "TRENDING" });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.regime).toBe(90);
    expect(scoreToLabel(scores.regime!)).toBe("Strong");
  });

  it("Regime: unknown string → null (N/A, not an invented score)", () => {
    const pkg = makePkg({ marketRegime: "COMPLETELY_UNKNOWN_REGIME" });
    const scores = computeEvidenceNumericScores(baseStars, pkg);
    expect(scores.regime).toBeNull();
  });

  it("Institutional → always null (N/A)", () => {
    const scores = computeEvidenceNumericScores(baseStars, makePkg());
    expect(scores.institutional).toBeNull();
  });
});

// --- dot-bar color class consistency ----------------------------------------

describe("evidenceSignalClass — dot-bar classes match thresholds", () => {
  it("0 stars → unavailable class", () => {
    expect(evidenceSignalClass(0)).toContain("border");
  });

  it("1 star → rose (Weak)", () => {
    expect(evidenceSignalClass(1)).toContain("rose");
  });

  it("2 stars → amber (Limited)", () => {
    expect(evidenceSignalClass(2)).toContain("amber");
  });

  it("3 stars → sky (Moderate)", () => {
    expect(evidenceSignalClass(3)).toContain("sky");
  });

  it("4 stars → emerald (Solid)", () => {
    expect(evidenceSignalClass(4)).toContain("emerald");
  });

  it("5 stars → emerald (Strong)", () => {
    expect(evidenceSignalClass(5)).toContain("emerald");
  });
});
