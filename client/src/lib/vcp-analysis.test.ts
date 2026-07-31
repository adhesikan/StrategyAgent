import { describe, it, expect } from "vitest";
import {
  stageLabel,
  stageTone,
  pivotDisplay,
  majorHighDisplay,
  structureRows,
  contractionSequenceDisplay,
  assessmentItems,
  isRenderableVcpAnalysis,
  type VcpAnalysis,
} from "./vcp-analysis";

const noSetup: VcpAnalysis = {
  analysisSummary: { vcpScore: 18, stage: "no-setup", trend: "Weak" },
  vcpStructure: {
    stage: "No valid VCP setup",
    base: "No confirmed base",
    contractions: "No valid tightening sequence",
    volatility: "Not sufficiently compressed",
    volume: "Contracting 19%",
    higherLows: "Not established",
    actionablePivot: { detected: false, price: null, source: null, distancePercent: null },
    majorHigh: { price: 1255, date: "2026-06-25", distancePercent: -33.39, note: "historical context only" },
    baseSupport: null,
    baseResistance: null,
  },
  setupAssessment: {
    qualifies: false,
    strengths: [],
    weaknesses: ["trend structure is weak", "no confirmed consolidation base"],
    improvementConditions: ["MU needs to repair the trend structure", "A consolidation base needs to form"],
    watchConditions: ["Reclaiming key moving averages"],
  },
};

const pivotReady: VcpAnalysis = {
  analysisSummary: { vcpScore: 94, stage: "pivot-ready", trend: "Strong uptrend" },
  vcpStructure: {
    stage: "Pivot-ready",
    base: "Confirmed (42 days, 12.5% deep)",
    contractions: "Tightening",
    volatility: "Compressed",
    volume: "Contracting 35%",
    higherLows: "Established",
    actionablePivot: { detected: true, price: 100.53, source: "resistance", distancePercent: 0.75 },
    majorHigh: { price: 1274.55, date: "2026-05-12", distancePercent: 5, note: "historical context only" },
    baseSupport: 92.1,
    baseResistance: 100.53,
  },
  setupAssessment: {
    qualifies: true,
    strengths: ["price is 0.75% from a valid actionable pivot at $100.53", "established uptrend"],
    weaknesses: [],
    improvementConditions: [],
    watchConditions: ["Actionable pivot: $100.53", "Base support: $92.10"],
  },
};

describe("stageLabel / stageTone", () => {
  it("maps every stage to its display label", () => {
    expect(stageLabel("no-setup")).toBe("No Setup");
    expect(stageLabel("early")).toBe("Early");
    expect(stageLabel("developing")).toBe("Developing");
    expect(stageLabel("contraction")).toBe("Contraction");
    expect(stageLabel("pivot-ready")).toBe("Pivot Ready");
    expect(stageLabel(null)).toBe("Unknown");
    expect(stageLabel("future-stage")).toBe("future-stage"); // pass through unknowns
  });
  it("uses existing accent tones per stage", () => {
    expect(stageTone("pivot-ready")).toContain("emerald");
    expect(stageTone("contraction")).toContain("sky");
    expect(stageTone("early")).toContain("amber");
    expect(stageTone("no-setup")).toContain("rose");
  });
});

describe("pivotDisplay", () => {
  it("null/undetected pivot → 'None' (valid data, not an error)", () => {
    expect(pivotDisplay({ detected: false, price: null, source: null, distancePercent: null })).toBe("None");
    expect(pivotDisplay(null)).toBe("None");
    expect(pivotDisplay(undefined)).toBe("None");
  });
  it("real pivot shows price and distance", () => {
    expect(pivotDisplay(pivotReady.vcpStructure.actionablePivot)).toBe("$100.53 (0.8% away)");
  });
});

describe("majorHighDisplay — always historical context, never entry language", () => {
  it("labels the major high as historical context only", () => {
    const s = majorHighDisplay(noSetup.vcpStructure.majorHigh)!;
    expect(s).toBe("$1,255.00 on 2026-06-25, 33.4% below — historical context only");
    for (const banned of ["pivot", "breakout", "buy point", "entry"]) {
      expect(s.toLowerCase()).not.toContain(banned);
    }
  });
  it("returns null when price missing", () => {
    expect(majorHighDisplay({ price: null, date: null, distancePercent: null, note: "historical context only" })).toBeNull();
    expect(majorHighDisplay(null)).toBeNull();
  });
});

describe("structureRows", () => {
  it("no-setup: renders scanner strings verbatim, pivot None, no support/resistance rows", () => {
    const rows = structureRows(noSetup.vcpStructure);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Base"]).toBe("No confirmed base");
    expect(byLabel["Contractions"]).toBe("No valid tightening sequence");
    expect(byLabel["Volume"]).toBe("Contracting 19%");
    expect(byLabel["Actionable pivot"]).toBe("None");
    expect(byLabel["Major high"]).toContain("historical context only");
    expect(byLabel["Base support"]).toBeUndefined();
    expect(byLabel["Base resistance"]).toBeUndefined();
  });
  it("pivot-ready: includes support/resistance and real pivot", () => {
    const rows = structureRows(pivotReady.vcpStructure);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Actionable pivot"]).toBe("$100.53 (0.8% away)");
    expect(byLabel["Base support"]).toBe("$92.10");
    expect(byLabel["Base resistance"]).toBe("$100.53");
    expect(byLabel["Higher lows"]).toBe("Established");
  });
  it("omits fields the scanner did not supply", () => {
    const rows = structureRows({ ...noSetup.vcpStructure, contractions: null, volatility: null, volume: null, higherLows: null });
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(["Base", "Actionable pivot", "Major high"]);
  });
});

describe("contractionSequenceDisplay", () => {
  it("formats depths as an arrow sequence with durations", () => {
    const r = contractionSequenceDisplay([
      { depthPercent: 21.57, durationDays: 4 },
      { depthPercent: 28.95, durationDays: 7 },
      { depthPercent: 22.36, durationDays: 6 },
    ])!;
    expect(r.sequence).toBe("21.6% → 28.9% → 22.4%");
    expect(r.durations).toBe("4, 7, 6 days");
  });
  it("omits durations line when any duration is missing; null when no sequence", () => {
    expect(contractionSequenceDisplay([{ depthPercent: 17, durationDays: null }])!.durations).toBeNull();
    expect(contractionSequenceDisplay([])).toBeNull();
    expect(contractionSequenceDisplay(undefined)).toBeNull();
  });
  it("structureRows appends the sequence to the Contractions row with duration subtext", () => {
    const rows = structureRows({
      ...noSetup.vcpStructure,
      contractionSequence: [
        { depthPercent: 21.57, durationDays: 4 },
        { depthPercent: 28.95, durationDays: 7 },
      ],
    });
    const row = rows.find((r) => r.label === "Contractions")!;
    expect(row.value).toBe("No valid tightening sequence (21.6% → 28.9%)");
    expect(row.subtext).toBe("4, 7 days");
    // without a sequence the row is unchanged
    const plain = structureRows(noSetup.vcpStructure).find((r) => r.label === "Contractions")!;
    expect(plain.value).toBe("No valid tightening sequence");
    expect(plain.subtext).toBeUndefined();
  });
});

describe("assessmentItems", () => {
  it("qualifying setup shows strengths", () => {
    const a = assessmentItems(pivotReady.setupAssessment);
    expect(a.positive).toBe(true);
    expect(a.items).toEqual(pivotReady.setupAssessment.strengths);
    expect(a.title).toContain("qualifies");
  });
  it("non-qualifying setup shows weaknesses", () => {
    const a = assessmentItems(noSetup.setupAssessment);
    expect(a.positive).toBe(false);
    expect(a.items).toEqual(noSetup.setupAssessment.weaknesses);
  });
});

describe("isRenderableVcpAnalysis", () => {
  it("accepts well-formed payloads and rejects malformed ones (old UI unchanged)", () => {
    expect(isRenderableVcpAnalysis(noSetup)).toBe(true);
    expect(isRenderableVcpAnalysis(pivotReady)).toBe(true);
    expect(isRenderableVcpAnalysis(undefined)).toBe(false);
    expect(isRenderableVcpAnalysis(null)).toBe(false);
    expect(isRenderableVcpAnalysis({})).toBe(false);
    expect(isRenderableVcpAnalysis({ analysisSummary: {} })).toBe(false);
  });
});
