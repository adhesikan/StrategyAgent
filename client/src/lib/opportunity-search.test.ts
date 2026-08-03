import { describe, it, expect } from "vitest";
import {
  candidateStateLabel,
  optionStrategyLabel,
  strikeZoneDisplay,
  cardCtas,
  SEARCH_TITLES,
  type OpportunityCard,
} from "./opportunity-search";

const base: OpportunityCard = {
  symbol: "CRDO",
  strategy: "VCP Breakout",
  score: 91,
  stage: "pivot-ready",
  reasons: [],
  warnings: [],
  candidateState: null,
};

describe("labels", () => {
  it("candidate state labels", () => {
    expect(candidateStateLabel("stock")).toBe("Stock Candidate");
    expect(candidateStateLabel("estimated_options")).toBe("Estimated Options Strategy");
    expect(candidateStateLabel("no_trade")).toBe("No Trade");
    expect(candidateStateLabel(null)).toBeNull();
    expect(candidateStateLabel(undefined)).toBeNull();
  });
  it("option strategy + strike zone display", () => {
    expect(optionStrategyLabel("CASH_SECURED_PUT")).toBe("Cash-Secured Put");
    expect(optionStrategyLabel("COVERED_CALL")).toBe("Covered Call");
    expect(strikeZoneDisplay({ low: 86, high: 91.2 })).toBe("$86.00–$91.20");
    expect(strikeZoneDisplay(null)).toBeNull();
  });
  it("titles cover every search type", () => {
    expect(Object.keys(SEARCH_TITLES).sort()).toEqual(["bearish", "bullish", "income", "trade", "vcp"]);
  });
});

describe("cardCtas — Trade Builder gating (spec §7/§13, test 23: research navigation only)", () => {
  it("pivot-ready: View Setup opens the trade setup page, chart is separate", () => {
    const ctas = cardCtas(base, true);
    expect(ctas.map((c) => c.label)).toEqual(["Analyze CRDO", "View Setup", "View Chart"]);
    expect(ctas[1].href).toBe("/trade/CRDO");
    expect(ctas[2].href).toBe("/market-intel?symbol=CRDO");
  });
  it("developing/early never expose Trade Builder", () => {
    for (const stage of ["developing", "early", undefined]) {
      const labels = cardCtas({ ...base, stage }, true).map((c) => c.label);
      expect(labels.join("|")).not.toContain("Trade Builder");
    }
  });
  it("no_trade → research navigation only (View Setup, never Trade Builder)", () => {
    expect(cardCtas({ ...base, candidateState: "no_trade" }, true).map((c) => c.label)).toEqual([
      "Analyze CRDO",
      "View Setup",
      "Open Scanner",
    ]);
  });
  it("MCP STOCK verdict (candidateState stock) links View Setup to the trade page even without pivot-ready stage", () => {
    const ctas = cardCtas({ ...base, stage: "ready", candidateState: "stock", verdict: "STOCK" }, true);
    expect(ctas.map((c) => c.label)).toEqual(["Analyze CRDO", "View Setup", "View Chart"]);
    expect(ctas[1].href).toBe("/trade/CRDO");
  });
  it("estimated options without broker → Connect Broker CTA first (test 18)", () => {
    const ctas = cardCtas(
      {
        ...base,
        candidateState: "estimated_options",
        estimatedOptions: { strategy: "CASH_SECURED_PUT", status: "estimated", targetDteMin: 20, targetDteMax: 45, shortStrikeZone: null, connectionRequiredForLiveContracts: true },
      },
      false,
    );
    expect(ctas[0]).toMatchObject({ label: "Connect Broker", href: "/settings", primary: true });
    expect(ctas.map((c) => c.label)).toContain("Open Income Mode");
  });
  it("estimated options with broker connected → no Connect Broker CTA", () => {
    const ctas = cardCtas(
      {
        ...base,
        candidateState: "estimated_options",
        estimatedOptions: { strategy: "COVERED_CALL", status: "estimated", targetDteMin: 20, targetDteMax: 45, shortStrikeZone: null, connectionRequiredForLiveContracts: false },
      },
      true,
    );
    expect(ctas.map((c) => c.label)).not.toContain("Connect Broker");
  });
});

describe("live option candidates", () => {
  const liveCard = {
    symbol: "NVDA",
    reasons: [],
    warnings: [],
    candidateState: "live_options" as const,
    liveOption: {
      status: "live" as const,
      strategy: "long_call",
      expiration: "2026-09-18",
      dte: 46,
      legs: [{ action: "buy" as const, type: "call" as const, strike: 105, bid: 4.1, ask: 4.3, mid: 4.2 }],
      priceBasis: "bid_ask" as const,
      estimatedNet: -4.2,
      netKind: "debit" as const,
      maxLoss: 420,
      maxProfit: null,
      breakeven: [109.2],
      rankReasons: ["fits risk budget"],
    },
  };

  it("labels live option candidates distinctly from estimated", () => {
    expect(candidateStateLabel("live_options")).toBe("Live Option Candidate");
    expect(candidateStateLabel("estimated_options")).toBe("Estimated Options Strategy");
    expect(candidateStateLabel("live_options")).not.toBe(candidateStateLabel("estimated_options"));
  });

  it("live option CTAs lead with View Setup, no Connect Broker CTA", () => {
    const ctas = cardCtas(liveCard as any, true);
    expect(ctas[0]).toMatchObject({ label: "View Setup", primary: true });
    expect(ctas.map((c) => c.label)).not.toContain("Connect Broker");
  });

  it("estimated options without a broker keep the Connect Broker CTA", () => {
    const card = {
      symbol: "NVDA",
      reasons: [],
      warnings: [],
      candidateState: "estimated_options" as const,
      estimatedOptions: {
        strategy: "long_call",
        status: "estimated" as const,
        targetDteMin: 30,
        targetDteMax: 45,
        connectionRequiredForLiveContracts: true,
      },
    };
    const ctas = cardCtas(card as any, false);
    expect(ctas[0]).toMatchObject({ label: "Connect Broker", href: "/settings", primary: true });
  });
});
