import { describe, it, expect } from "vitest";
import {
  baseTicketFromCard,
  overlayMcpTicket,
  prepareTicketBodySchema,
  type PrepareTicketBody,
} from "./prepare-ticket";

const stockBody: PrepareTicketBody = {
  symbol: "nvda",
  assetType: "stock",
  strategy: "stock_swing",
  entryPrice: 120.5,
  stopPrice: 114,
  targetPrice: 138,
  quantity: 16,
  maxRiskDollars: 500,
};

const optionBody: PrepareTicketBody = {
  symbol: "MU",
  assetType: "option",
  strategy: "bull_call_spread",
  netKind: "debit",
  estimatedNet: -1.85,
  maxLoss: 185,
  maxProfit: 315,
  breakeven: [126.85],
  expiration: "2026-09-18",
  legs: [
    { action: "buy", type: "call", strike: 125, expiration: "2026-09-18", mid: 4.1 },
    { action: "sell", type: "call", strike: 130, expiration: "2026-09-18", mid: 2.25 },
  ],
};

describe("prepareTicketBodySchema", () => {
  it("accepts a valid option body and rejects junk", () => {
    expect(prepareTicketBodySchema.safeParse(optionBody).success).toBe(true);
    expect(prepareTicketBodySchema.safeParse({ symbol: "", assetType: "stock" }).success).toBe(false);
    expect(
      prepareTicketBodySchema.safeParse({ ...optionBody, legs: Array(7).fill(optionBody.legs![0]) }).success,
    ).toBe(false);
  });
});

describe("baseTicketFromCard", () => {
  it("builds a stock ticket from card values only", () => {
    const t = baseTicketFromCard(stockBody);
    expect(t.symbol).toBe("NVDA");
    expect(t.quantity).toBe(16);
    expect(t.limitPrice).toBe(120.5);
    expect(t.stopPrice).toBe(114);
    expect(t.targetPrice).toBe(138);
  });

  it("defaults quantity when absent (100 shares / 1 contract)", () => {
    expect(baseTicketFromCard({ ...stockBody, quantity: undefined }).quantity).toBe(100);
    expect(baseTicketFromCard({ ...optionBody }).quantity).toBe(1);
  });

  it("builds an option ticket with legs and abs(net) limit prefill", () => {
    const t = baseTicketFromCard(optionBody);
    expect(t.legs).toHaveLength(2);
    expect(t.limitPrice).toBeCloseTo(1.85);
    expect(t.netKind).toBe("debit");
    expect(t.maxLoss).toBe(185);
    expect(t.breakeven).toEqual([126.85]);
  });
});

describe("overlayMcpTicket", () => {
  const base = baseTicketFromCard(stockBody);

  it("refines numeric fields from a sane MCP response", () => {
    const warnings: string[] = [];
    const out = overlayMcpTicket(base, { ticket: { quantity: 12, limitPrice: 120.25, stopPrice: 113.5, targetPrice: 140 } }, warnings);
    expect(out.quantity).toBe(12);
    expect(out.limitPrice).toBe(120.25);
    expect(out.stopPrice).toBe(113.5);
    expect(out.targetPrice).toBe(140);
    expect(warnings).toEqual([]);
  });

  it("ignores garbage values and non-object responses", () => {
    const warnings: string[] = [];
    expect(overlayMcpTicket(base, null, warnings)).toEqual(base);
    const out = overlayMcpTicket(base, { quantity: -5, limitPrice: "high", stopPrice: NaN }, warnings);
    expect(out.quantity).toBe(16);
    expect(out.limitPrice).toBe(120.5);
    expect(out.stopPrice).toBe(114);
  });

  it("rejects inconsistent stop >= target and keeps card values with a warning", () => {
    const warnings: string[] = [];
    const out = overlayMcpTicket(base, { stopPrice: 150, targetPrice: 140 }, warnings);
    expect(out.stopPrice).toBe(114);
    expect(out.targetPrice).toBe(138);
    expect(warnings.length).toBe(1);
  });

  it("never adds legs from the MCP response", () => {
    const optBase = baseTicketFromCard(optionBody);
    const out = overlayMcpTicket(optBase, { legs: [{ action: "buy", type: "put", strike: 1 }] }, []);
    expect(out.legs).toHaveLength(2);
    expect(out.legs![0].strike).toBe(125);
  });

  it("passes through bounded string warnings only", () => {
    const warnings: string[] = [];
    overlayMcpTicket(base, { warnings: ["check earnings date", 42, "x".repeat(500)] }, warnings);
    expect(warnings).toEqual(["check earnings date"]);
  });
});
