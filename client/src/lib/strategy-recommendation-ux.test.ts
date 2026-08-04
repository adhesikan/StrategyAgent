// Recommendation Experience 2.0 — UI logic tests. The card components are
// thin renderers over these pure helpers, so every verdict path, CTA set,
// chip classification, and summary line is covered here deterministically.

import { describe, it, expect } from "vitest";
import {
  recStatusLabel,
  recStructureLabel,
  recSummaryLines,
  recEnvironmentNotes,
  recDecisionFactorChips,
  recNextSteps,
  recConfidenceChecks,
  recEvidence,
  type RecIdea,
  type RecommendationEvidence,
  type RecommendationVerdict,
  type StrategyRecommendation,
} from "./strategy-recommendation";

function idea(v: RecommendationVerdict, extra: Partial<RecIdea> = {}): RecIdea {
  return {
    overallVerdict: v,
    recommendedStrategy: "downtrend_breakdown",
    setup: { symbol: "META" },
    reasons: ["Trigger not reached"],
    ...extra,
  };
}

function rec(ideas: RecIdea[], extra: Partial<StrategyRecommendation> = {}): StrategyRecommendation {
  return { source: "mcp", generatedAt: "2026-08-04T00:00:00Z", recommendations: ideas, simulatedData: false, warnings: [], ...extra };
}

const evidence: RecommendationEvidence = {
  summary: { strategiesEvaluated: 12, ideasActionable: 0, ideasWatch: 1, ideasRejected: 0, dataQuality: "PARTIAL" },
  evaluations: [{ strategy: "downtrend breakdown", status: "WATCH", reason: "Trigger not reached" }],
  watchConditions: ["Closes below trigger", "Confirms with volume"],
  decisionFactors: ["Trigger not reached", "Upstream provider request failed (HTTP 429)."],
  selection: null,
  confidence: { level: "MEDIUM", reasons: ["Some market data was partial."] },
};

describe("hero card fields per verdict", () => {
  it("status labels are verdict-derived, never invented", () => {
    expect(recStatusLabel("LIVE_OPTIONS")).toBe("READY");
    expect(recStatusLabel("STOCK")).toBe("READY");
    expect(recStatusLabel("ESTIMATED_OPTIONS")).toBe("READY (ESTIMATES)");
    expect(recStatusLabel("WATCH")).toBe("FORMING");
    expect(recStatusLabel("NO_TRADE")).toBe("NO SETUP");
    expect(recStatusLabel("UNSUPPORTED")).toBe("UNSUPPORTED");
  });

  it("structure comes only from engine fields (Long Put, Shares fallback for STOCK)", () => {
    expect(recStructureLabel(idea("LIVE_OPTIONS", { optionAnalysis: { optionType: "put" } }))).toBe("Long Put");
    expect(recStructureLabel(idea("STOCK"))).toBe("Shares");
    expect(recStructureLabel(idea("WATCH"))).toBeNull();
  });
});

describe("5-second summary lines", () => {
  it("WATCH: forming + no confirmation + no trade yet", () => {
    const lines = recSummaryLines(rec([idea("WATCH")]));
    expect(lines).toEqual(["1 setup is forming.", "Confirmation has not occurred.", "No trade is recommended yet."]);
  });
  it("NO_TRADE: no qualifying setup", () => {
    const lines = recSummaryLines(rec([idea("NO_TRADE")]));
    expect(lines).toContain("No qualifying setup was found.");
    expect(lines).toContain("No trade is recommended yet.");
  });
  it("actionable verdicts never say 'no trade'", () => {
    const lines = recSummaryLines(rec([idea("STOCK")]));
    expect(lines).toEqual(["1 setup is actionable now."]);
  });
  it("UNSUPPORTED-only says the strategy is unsupported", () => {
    expect(recSummaryLines(rec([idea("UNSUPPORTED")]))).toContain("The requested strategy is not yet supported.");
  });
});

describe("environment notes — engine warnings only", () => {
  it("classifies regime/provider/earnings warnings and dedupes", () => {
    const notes = recEnvironmentNotes(
      rec([idea("NO_TRADE")], {
        warnings: [
          "Market regime unavailable: benchmark history for SPY could not be retrieved.",
          "Market regime unavailable: benchmark history for SPY could not be retrieved.",
          "Strategy \"vcp\" setup unavailable: Upstream provider request failed (vcp:history, HTTP 429).",
        ],
      }),
    );
    expect(notes).toEqual(["Market regime unavailable", "Upstream data provider degraded"]);
  });
  it("no warnings → no environment notes", () => {
    expect(recEnvironmentNotes(rec([idea("STOCK")]))).toEqual([]);
  });
});

describe("decision factor chips", () => {
  it("classifies known factors with full engine sentence preserved as detail", () => {
    const chips = recDecisionFactorChips([
      "Trigger not reached",
      "Reward/risk below threshold",
      "Earnings inside trade horizon",
      "Market regime unavailable",
      "Upstream provider request failed (HTTP 429).",
    ]);
    expect(chips.map((c) => c.label)).toEqual([
      "Entry Trigger Missing",
      "Poor Reward/Risk",
      "Upcoming Earnings",
      "Market Regime Missing",
      "Data Unavailable",
    ]);
    expect(chips[0].detail).toBe("Trigger not reached");
    expect(chips[3].tone).toBe("environment");
    expect(chips[4].tone).toBe("data");
  });
  it("unknown factors become truncated neutral chips — never dropped or invented", () => {
    const chips = recDecisionFactorChips(["Some very specific engine sentence that is much longer than thirty-two characters"]);
    expect(chips[0].tone).toBe("neutral");
    expect(chips[0].label.endsWith("…")).toBe(true);
    expect(chips[0].detail).toMatch(/^Some very specific/);
  });
});

describe("verdict-aware next steps", () => {
  it("WATCH: chart / watchlist / scanner", () => {
    const labels = recNextSteps(idea("WATCH"), false).map((s) => s.label);
    expect(labels).toEqual(["View Chart", "Add to Watchlist", "Open Scanner"]);
  });
  it("NO_TRADE: similar opportunities / scanner / chart", () => {
    const labels = recNextSteps(idea("NO_TRADE"), false).map((s) => s.label);
    expect(labels).toEqual(["Find Similar Opportunities", "Open Scanner", "View Chart"]);
  });
  it("LIVE_OPTIONS with candidate: includes Build Trade Ticket; simulated data never does", () => {
    const live = idea("LIVE_OPTIONS", { optionAnalysis: { strike: 200 } });
    expect(recNextSteps(live, false).map((s) => s.label)).toContain("Build Trade Ticket");
    expect(recNextSteps(live, true).map((s) => s.label)).not.toContain("Build Trade Ticket");
  });
  it("STOCK: review plan first; UNSUPPORTED: supported strategies + scanner", () => {
    expect(recNextSteps(idea("STOCK", { tradeCandidate: { entry: 1 } }), false)[0].label).toBe("Review Stock Plan");
    expect(recNextSteps(idea("UNSUPPORTED"), false).map((s) => s.label)).toEqual(["Show Supported Strategies", "Open Scanner"]);
  });
  it("ESTIMATED_OPTIONS: never a trade ticket; offers broker connect", () => {
    const labels = recNextSteps(idea("ESTIMATED_OPTIONS", { optionAnalysis: { strikeZone: "195-200" } }), false).map((s) => s.label);
    expect(labels).not.toContain("Build Trade Ticket");
    expect(labels).toContain("Connect Broker for Live Options");
  });
  it("all hrefs point at real app routes", () => {
    const verdicts: RecommendationVerdict[] = ["WATCH", "NO_TRADE", "LIVE_OPTIONS", "STOCK", "ESTIMATED_OPTIONS", "UNSUPPORTED"];
    const validPrefixes = ["/charts", "/scanner", "/trade/", "/opportunity-radar", "/watchlists", "/settings", "/help"];
    for (const v of verdicts) {
      for (const s of recNextSteps(idea(v, { tradeCandidate: { entry: 1 }, optionAnalysis: { strike: 1 } }), false)) {
        expect(validPrefixes.some((p) => s.href.startsWith(p)), `${v}: ${s.href}`).toBe(true);
      }
    }
  });
});

describe("confidence checks — evidence quality, never chain-of-thought", () => {
  it("positive facts + negative data findings, with environment negatives appended", () => {
    const checks = recConfidenceChecks(evidence, rec([idea("WATCH")], { warnings: ["Market regime unavailable: x"] }));
    expect(checks[0]).toEqual({ ok: true, text: "12 strategies evaluated" });
    expect(checks[1]).toEqual({ ok: true, text: "Deterministic recommendation engine" });
    expect(checks.find((c) => /partial/i.test(c.text))?.ok).toBe(false);
    expect(checks.find((c) => c.text === "Market regime unavailable")?.ok).toBe(false);
  });
});

describe("recEvidence defensive accessor", () => {
  it("accepts a well-formed payload and rejects malformed ones", () => {
    expect(recEvidence(rec([idea("WATCH")], { recommendationEvidence: evidence }))).not.toBeNull();
    expect(recEvidence(rec([idea("WATCH")]))).toBeNull();
    expect(recEvidence(rec([idea("WATCH")], { recommendationEvidence: { summary: {} } as any }))).toBeNull();
  });
});
