// Candidate-check labels and supporting-evidence grouping (spec §4-§5).
import { describe, test, expect } from "vitest";
import {
  msaCandidateCheckLabel,
  msaSupportGroup,
  msaIsIntraday,
  type MsaSetupEntry,
} from "./multi-strategy-analysis";

const entry = (o: Partial<MsaSetupEntry["setup"]>, extra: Partial<MsaSetupEntry> = {}): MsaSetupEntry => ({
  setup: { symbol: "BA", strategy: "vcp", ...o },
  ...extra,
});

describe("msaCandidateCheckLabel (§4)", () => {
  test("qualified", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "QUALIFIED", verdict: "STOCK" } })))
      .toBe("Trade candidate qualified");
  });
  test("rejected with MCP reason", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "NO_TRADE", reason: "no trigger level" } })))
      .toBe("Candidate rejected: no trigger level");
  });
  test("watch", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "WATCH" } })))
      .toBe("Setup detected, but not tradeable yet");
  });
  test("unavailable", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidateCheck: { status: "UNAVAILABLE" } })))
      .toBe("Candidate qualification unavailable");
  });
  test("legacy null candidate → unavailable; unevaluated → no label", () => {
    expect(msaCandidateCheckLabel(entry({}, { candidate: null }))).toBe("Candidate qualification unavailable");
    expect(msaCandidateCheckLabel(entry({}))).toBeNull();
  });
});

describe("msaSupportGroup (§5)", () => {
  test("triggered/ready → confirming; forming → forming", () => {
    expect(msaSupportGroup(entry({ status: "triggered" }))).toBe("confirming");
    expect(msaSupportGroup(entry({ status: "ready" }))).toBe("confirming");
    expect(msaSupportGroup(entry({ status: "forming" }))).toBe("forming");
  });
  test("6. unknown status is grouped as unavailable, never positive evidence", () => {
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

describe("msaIsIntraday", () => {
  test("intraday timeframes flagged; daily not", () => {
    expect(msaIsIntraday({ symbol: "BA", strategy: "open_drive_5m", timeframe: "5min" })).toBe(true);
    expect(msaIsIntraday({ symbol: "BA", strategy: "open_drive_15m", timeframe: "15min" })).toBe(true);
    expect(msaIsIntraday({ symbol: "BA", strategy: "vcp", timeframe: "1day" })).toBe(false);
    expect(msaIsIntraday({ symbol: "BA", strategy: "vcp" })).toBe(false);
  });
});
