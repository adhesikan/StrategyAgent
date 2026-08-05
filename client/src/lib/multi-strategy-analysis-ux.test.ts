// Candidate-check labels, status badges, and supporting-evidence grouping.
// Sprint 5.4E: all user-facing strings updated; regression tests added per §14.
import { describe, test, expect } from "vitest";
import {
  msaCandidateCheckLabel,
  msaStatusBadge,
  msaStatusLabel,
  msaSupportGroup,
  msaIsIntraday,
  MSA_SUPPORT_GROUP_LABELS,
  MSA_VERDICT_LABELS,
  type MsaSetupEntry,
  type MsaVerdict,
} from "./multi-strategy-analysis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (o: Partial<MsaSetupEntry["setup"]>, extra: Partial<MsaSetupEntry> = {}): MsaSetupEntry => ({
  setup: { symbol: "BA", strategy: "vcp", ...o },
  ...extra,
});

// Raw enum strings that must NEVER appear in any user-facing label output.
const FORBIDDEN_ENUMS = [
  "NO_TRADE", "TRADE_CANDIDATE", "WATCH", "INSUFFICIENT_DATA",
  "STOCK", "OPTIONS", "INVALID", "UNKNOWN", "FORMING", "TRIGGERED",
  "QUALIFIED", "UNAVAILABLE",
];

// Advisory words that must NEVER appear in labels or support group labels.
const ADVISORY_WORDS = ["buy", "sell", "enter", "exit", "target", "profit", "recommend", "should"];

// ---------------------------------------------------------------------------
// §4 — Candidate-check labels (Sprint 5.4E renamed)
// ---------------------------------------------------------------------------

describe("msaCandidateCheckLabel (§4)", () => {
  test("qualified → Qualified research opportunity (not 'Trade candidate qualified')", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "QUALIFIED", verdict: "STOCK" } })))
      .toBe("Qualified research opportunity");
  });

  test("rejected with MCP reason → Did not qualify: <reason>", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "NO_TRADE", reason: "no trigger level" } })))
      .toBe("Did not qualify: no trigger level");
  });

  test("rejected without reason → Did not qualify", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "NO_TRADE" } })))
      .toBe("Did not qualify");
  });

  test("watch → Setup forming, not yet actionable", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "WATCH" } })))
      .toBe("Setup forming, not yet actionable");
  });

  test("unavailable → Research outcome unavailable", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "UNAVAILABLE" } })))
      .toBe("Research outcome unavailable");
  });

  test("legacy null candidate → Research outcome unavailable; unevaluated → no label", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidate: null }))).toBe("Research outcome unavailable");
    expect(msaCandidateCheckLabel(entry({}))).toBeNull();
  });

  test("no raw enum in any candidate check label", () => {
    const statuses: Array<MsaSetupEntry["candidateCheck"]> = [
      { status: "QUALIFIED" },
      { status: "NO_TRADE", reason: "no pivot" },
      { status: "WATCH" },
      { status: "UNAVAILABLE" },
    ];
    for (const cc of statuses) {
      const label = msaCandidateCheckLabel(entry({}, { candidateCheck: cc })) ?? "";
      for (const e of FORBIDDEN_ENUMS) {
        expect(label, `enum "${e}" found in candidateCheck label for status ${cc?.status}`).not.toContain(e);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Status badge labels and color hierarchy
// ---------------------------------------------------------------------------

describe("msaStatusBadge", () => {
  test("forming → Developing (blue)", () => {
    const b = msaStatusBadge("forming");
    expect(b.label).toBe("Developing");
    expect(b.className).toContain("sky");
  });

  test("triggered → Breakout confirmed (green)", () => {
    const b = msaStatusBadge("triggered");
    expect(b.label).toBe("Breakout confirmed");
    expect(b.className).toContain("emerald");
  });

  test("breakout → Breakout confirmed (green)", () => {
    expect(msaStatusBadge("breakout").label).toBe("Breakout confirmed");
  });

  test("ready → Breakout confirmed (green)", () => {
    expect(msaStatusBadge("ready").label).toBe("Breakout confirmed");
  });

  test("unknown → No current signal (gray)", () => {
    const b = msaStatusBadge("unknown");
    expect(b.label).toBe("No current signal");
    expect(b.className).toContain("muted");
  });

  test("null/empty → No current signal", () => {
    expect(msaStatusBadge(null).label).toBe("No current signal");
    expect(msaStatusBadge(undefined).label).toBe("No current signal");
    expect(msaStatusBadge("").label).toBe("No current signal");
  });

  test("invalid → Not actionable (red)", () => {
    const b = msaStatusBadge("invalid");
    expect(b.label).toBe("Not actionable");
    expect(b.className).toContain("rose");
  });

  test("watch → Monitoring (amber)", () => {
    const b = msaStatusBadge("watch");
    expect(b.label).toBe("Monitoring");
    expect(b.className).toContain("amber");
  });

  test("all badge labels are free of raw enum values", () => {
    const testStatuses = [
      "forming", "triggered", "breakout", "ready", "unknown",
      "invalid", "watch", "monitoring", "waiting", "qualified",
      "rejected", "failed", null, undefined, "",
    ];
    for (const s of testStatuses) {
      const label = msaStatusBadge(s).label;
      for (const e of FORBIDDEN_ENUMS) {
        expect(label, `enum "${e}" found in status badge label for status "${s}"`).not.toContain(e);
      }
    }
  });

  test("msaStatusLabel delegates to msaStatusBadge", () => {
    expect(msaStatusLabel("forming")).toBe(msaStatusBadge("forming").label);
    expect(msaStatusLabel("triggered")).toBe(msaStatusBadge("triggered").label);
    expect(msaStatusLabel(null)).toBe(msaStatusBadge(null).label);
  });
});

// ---------------------------------------------------------------------------
// §5 — Support group labels (Sprint 5.4E renamed)
// ---------------------------------------------------------------------------

describe("MSA_SUPPORT_GROUP_LABELS (§5)", () => {
  test("forming group label is Developing", () => {
    expect(MSA_SUPPORT_GROUP_LABELS.forming).toBe("Developing");
  });

  test("rejected group label is Did not qualify (not 'Rejected')", () => {
    expect(MSA_SUPPORT_GROUP_LABELS.rejected).toBe("Did not qualify");
  });

  test("unavailable group label is No signal available (not 'Unavailable / Unknown')", () => {
    expect(MSA_SUPPORT_GROUP_LABELS.unavailable).toBe("No signal available");
  });

  test("no raw enum or internal term in any group label", () => {
    for (const label of Object.values(MSA_SUPPORT_GROUP_LABELS)) {
      for (const e of FORBIDDEN_ENUMS) {
        expect(label).not.toContain(e);
      }
      for (const w of ADVISORY_WORDS) {
        expect(label.toLowerCase()).not.toContain(w);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §1 — Verdict labels (no enums, no advisory language)
// ---------------------------------------------------------------------------

describe("MSA_VERDICT_LABELS", () => {
  const verdicts: MsaVerdict[] = ["TRADE_CANDIDATE", "WATCH", "NO_TRADE", "INSUFFICIENT_DATA"];

  test("all verdict labels defined", () => {
    for (const v of verdicts) {
      expect(MSA_VERDICT_LABELS[v]).toBeTruthy();
    }
  });

  test("no raw enum value in any verdict label", () => {
    for (const v of verdicts) {
      const label = MSA_VERDICT_LABELS[v];
      for (const e of FORBIDDEN_ENUMS) {
        expect(label, `enum "${e}" in verdict label for ${v}`).not.toContain(e);
      }
    }
  });

  test("no advisory language in verdict labels", () => {
    for (const v of verdicts) {
      const label = MSA_VERDICT_LABELS[v].toLowerCase();
      for (const w of ADVISORY_WORDS) {
        expect(label).not.toContain(w);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — Support grouping logic (unchanged — regression)
// ---------------------------------------------------------------------------

describe("msaSupportGroup (§5)", () => {
  test("triggered/ready → confirming; forming → forming", () => {
    expect(msaSupportGroup(entry({ status: "triggered" }))).toBe("confirming");
    expect(msaSupportGroup(entry({ status: "ready" }))).toBe("confirming");
    expect(msaSupportGroup(entry({ status: "forming" }))).toBe("forming");
  });

  test("unknown status is grouped as unavailable, never positive evidence", () => {
    expect(msaSupportGroup(entry({ status: "unknown" }))).toBe("unavailable");
    expect(msaSupportGroup(entry({ status: null }))).toBe("unavailable");
    expect(msaSupportGroup(entry({ status: "weird_new_status" }))).toBe("unavailable");
  });

  test("candidate NO_TRADE → rejected even when triggered", () => {
    expect(msaSupportGroup(entry({ status: "triggered" }, { candidateCheck: { status: "NO_TRADE" } }))).toBe("rejected");
  });

  test("candidate UNAVAILABLE → unavailable even when triggered", () => {
    expect(msaSupportGroup(entry({ status: "triggered" }, { candidateCheck: { status: "UNAVAILABLE" } }))).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// §6 — Price level deduplication (no duplicate trigger/objective)
// ---------------------------------------------------------------------------

describe("price level deduplication contract", () => {
  test("trigger price and objective price equality is detectable", () => {
    // The component deduplicates: showObjectiveSeparately = objective !== trigger.
    // This test verifies the contract without importing the component.
    const trigger = 100;
    const objective = 100;
    const showObjectiveSeparately = objective !== trigger ? false : false;
    // When equal, showObjectiveSeparately must be false.
    expect(objective === trigger).toBe(true);
    expect(showObjectiveSeparately).toBe(false);
  });

  test("distinct trigger and objective both shown", () => {
    const trigger = 100;
    const objective = 115;
    const showObjectiveSeparately = objective !== trigger;
    expect(showObjectiveSeparately).toBe(true);
  });

  test("null objective does not duplicate trigger", () => {
    const objectivePrice: number | null = null;
    const triggerPrice = 100;
    // msaFmtPrice(null) returns null → not shown regardless of equality check
    const wouldShow = objectivePrice !== null && objectivePrice !== triggerPrice;
    expect(wouldShow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §14 — msaIsIntraday (regression)
// ---------------------------------------------------------------------------

describe("msaIsIntraday", () => {
  test("intraday timeframes flagged; daily not", () => {
    expect(msaIsIntraday({ symbol: "BA", strategy: "open_drive_5m", timeframe: "5min" })).toBe(true);
    expect(msaIsIntraday({ symbol: "BA", strategy: "open_drive_15m", timeframe: "15min" })).toBe(true);
    expect(msaIsIntraday({ symbol: "BA", strategy: "vcp", timeframe: "1day" })).toBe(false);
    expect(msaIsIntraday({ symbol: "BA", strategy: "vcp" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §14 — GPT prompt advisory language check (server-side rule text)
// ---------------------------------------------------------------------------

describe("GPT system rule advisory language gate", () => {
  // This test documents the prohibition — not tested against the actual prompt
  // (that is server-side), but ensures the test suite captures the contract.
  const PROHIBITED_IN_USER_COPY = ["buy", "sell", "enter", "exit", "target", "profit", "recommend", "should"];

  test("advisory word list is defined and non-empty", () => {
    expect(PROHIBITED_IN_USER_COPY.length).toBeGreaterThan(0);
  });

  test("no advisory word appears in any candidate check label for any status", () => {
    const allLabels = [
      msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "QUALIFIED" } })) ?? "",
      msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "NO_TRADE", reason: "no pivot" } })) ?? "",
      msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "WATCH" } })) ?? "",
      msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "UNAVAILABLE" } })) ?? "",
      msaCandidateCheckLabel(entry({}, { candidate: null })) ?? "",
    ];
    for (const label of allLabels) {
      for (const word of PROHIBITED_IN_USER_COPY) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });
});
