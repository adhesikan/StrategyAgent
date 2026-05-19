import type { TradeSetup } from "../agent/strategy-engine";

export type OptionStrategyType =
  | "long_call"
  | "long_put"
  | "bull_call_spread"
  | "bear_put_spread"
  | "cash_secured_put"
  | "covered_call";

export interface OptionLeg {
  strike: number;
  type: "call" | "put";
  delta: number;
  iv: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  volume: number;
  side: "long" | "short";
}

export interface OptionPlan {
  strategyType: OptionStrategyType;
  symbol: string;
  expiry: string;
  dte: number;
  legs: OptionLeg[];
  netDebit: number; // per-share, multiply by 100 for contract cost
  maxProfit: number; // per share
  maxLoss: number; // per share
  breakeven: number;
  suitabilityScore: number;
  warnings: string[];
  reasons: string[];
}

export interface OptionsContext {
  livePrice?: number;
  ivRank?: number; // 0-100
  earningsBeforeExpiry?: boolean;
  // When the user explicitly asked for a specific DTE (e.g. "find a 0 DTE
  // trade on MU", "weekly trade on TSLA"), honor it instead of the builder's
  // default. 0 means same-day expiry (snapped to today if a weekday, else
  // next weekday). Any positive value is used as-is (no Friday-snap) so the
  // returned expiry actually matches what was requested.
  requestedDte?: number;
}

const BUSINESS_DAY_MS = 24 * 60 * 60 * 1000;

function pickExpiry(targetDte = 21, requestedDte?: number): { expiry: string; dte: number } {
  // Honor an explicit user-requested DTE if provided.
  if (typeof requestedDte === "number" && requestedDte >= 0) {
    let target = new Date(Date.now() + requestedDte * BUSINESS_DAY_MS);
    // For 0 DTE, bump past weekends to the next trading day so the expiry
    // is always a date the market is actually open.
    if (requestedDte === 0) {
      target = new Date();
      const day = target.getDay();
      if (day === 6) target.setDate(target.getDate() + 2); // Sat -> Mon
      else if (day === 0) target.setDate(target.getDate() + 1); // Sun -> Mon
    }
    const expiry = target.toISOString().slice(0, 10);
    // When the user asked for 0 DTE we always report dte=0 regardless of
    // weekend snap, so the rest of the system (premium model, copy, ticket)
    // treats it as a same-day trade.
    const dte =
      requestedDte === 0
        ? 0
        : Math.max(0, Math.round((target.getTime() - Date.now()) / BUSINESS_DAY_MS));
    return { expiry, dte };
  }
  const target = new Date(Date.now() + targetDte * BUSINESS_DAY_MS);
  // Snap to next Friday
  const day = target.getDay();
  const offset = (5 - day + 7) % 7;
  target.setDate(target.getDate() + offset);
  const expiry = target.toISOString().slice(0, 10);
  const dte = Math.max(1, Math.round((target.getTime() - Date.now()) / BUSINESS_DAY_MS));
  return { expiry, dte };
}

function approximateDelta(strike: number, spot: number, type: "call" | "put"): number {
  // Crude delta approximation: ATM ≈ 0.50, deeper ITM higher.
  const moneyness = (spot - strike) / spot;
  if (type === "call") {
    return Math.max(0.05, Math.min(0.95, 0.5 + moneyness * 5));
  }
  return -Math.max(0.05, Math.min(0.95, 0.5 - moneyness * 5));
}

function approximatePremium(strike: number, spot: number, type: "call" | "put", dte: number, iv = 0.35): number {
  // Simplified: intrinsic + time value scaled by sqrt(dte)*iv
  const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  // 0 DTE → no extrinsic. We give same-day options a tiny residual (1/3 of
  // a single-day worth) so ATM/OTM premiums aren't literally zero (which
  // would imply free options) but stay clearly near-intrinsic.
  const dteForExtrinsic = dte <= 0 ? 0.33 : dte;
  const timeValue = spot * iv * Math.sqrt(dteForExtrinsic / 365);
  // Reduce time value as you go further OTM
  const moneynessFactor = type === "call"
    ? Math.exp(-Math.max(0, strike - spot) / (spot * 0.1))
    : Math.exp(-Math.max(0, spot - strike) / (spot * 0.1));
  return parseFloat((intrinsic + timeValue * moneynessFactor).toFixed(2));
}

function buildLeg(strike: number, type: "call" | "put", spot: number, dte: number, iv: number, side: "long" | "short"): OptionLeg {
  const mid = approximatePremium(strike, spot, type, dte, iv);
  const spread = Math.max(0.05, mid * 0.04);
  const bid = parseFloat((mid - spread / 2).toFixed(2));
  const ask = parseFloat((mid + spread / 2).toFixed(2));
  return {
    strike,
    type,
    delta: parseFloat(approximateDelta(strike, spot, type).toFixed(2)),
    iv,
    bid,
    ask,
    mid,
    openInterest: 500 + Math.floor(Math.random() * 1500),
    volume: 100 + Math.floor(Math.random() * 600),
    side,
  };
}

function roundStrike(price: number): number {
  if (price < 25) return Math.round(price * 2) / 2; // 0.50
  if (price < 200) return Math.round(price);
  return Math.round(price / 5) * 5;
}

function suitabilityScore(legs: OptionLeg[]): { score: number; warnings: string[] } {
  const warnings: string[] = [];
  let score = 100;
  for (const leg of legs) {
    const spreadPct = leg.mid > 0 ? ((leg.ask - leg.bid) / leg.mid) * 100 : 100;
    if (spreadPct > 10) { warnings.push(`Wide bid/ask on ${leg.strike} ${leg.type} (${spreadPct.toFixed(1)}%)`); score -= 15; }
    if (leg.openInterest < 100) { warnings.push(`Low open interest on ${leg.strike} ${leg.type}`); score -= 10; }
    if (leg.volume < 50) { warnings.push(`Low volume on ${leg.strike} ${leg.type}`); score -= 5; }
    if (leg.type === "call" && Math.abs(leg.delta) < 0.30) { warnings.push("Call delta is low — speculative"); score -= 10; }
    if (leg.type === "put" && Math.abs(leg.delta) < 0.30) { warnings.push("Put delta is low — speculative"); score -= 10; }
  }
  return { score: Math.max(0, score), warnings };
}

export function buildLongCallPlan(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(21, ctx.requestedDte);
  const strike = roundStrike(spot * 0.99); // slightly ITM
  const leg = buildLeg(strike, "call", spot, dte, iv, "long");
  const netDebit = leg.mid;
  const breakeven = parseFloat((strike + netDebit).toFixed(2));
  const target = setup.targets?.[0] ?? spot * 1.05;
  const maxProfit = parseFloat(Math.max(0, target - strike - netDebit).toFixed(2));
  const maxLoss = netDebit;
  const sui = suitabilityScore([leg]);
  const reasons = ["Defined upside via long premium", `Strike ${strike} is ~ATM (delta ${leg.delta})`, `Expiry ~${dte}d aligns with horizon`];
  if (ctx.earningsBeforeExpiry) sui.warnings.push("Earnings before expiry — IV crush risk");
  return {
    strategyType: "long_call",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [leg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons,
  };
}

export function buildLongPutPlan(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(21, ctx.requestedDte);
  const strike = roundStrike(spot * 1.01);
  const leg = buildLeg(strike, "put", spot, dte, iv, "long");
  const netDebit = leg.mid;
  const breakeven = parseFloat((strike - netDebit).toFixed(2));
  const target = setup.targets?.[0] ?? spot * 0.95;
  const maxProfit = parseFloat(Math.max(0, strike - target - netDebit).toFixed(2));
  const maxLoss = netDebit;
  const sui = suitabilityScore([leg]);
  if (ctx.earningsBeforeExpiry) sui.warnings.push("Earnings before expiry — IV crush risk");
  return {
    strategyType: "long_put",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [leg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons: ["Defined downside via long premium", `Strike ${strike} is ~ATM (delta ${leg.delta})`, `Expiry ~${dte}d aligns with horizon`],
  };
}

export function buildBullCallSpread(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(30, ctx.requestedDte);
  const longStrike = roundStrike(spot * 0.99);
  const shortStrike = roundStrike((setup.targets?.[0] ?? spot * 1.05));
  const longLeg = buildLeg(longStrike, "call", spot, dte, iv, "long");
  const shortLeg = buildLeg(Math.max(shortStrike, longStrike + 1), "call", spot, dte, iv, "short");
  const netDebit = parseFloat((longLeg.mid - shortLeg.mid).toFixed(2));
  const width = shortLeg.strike - longLeg.strike;
  const maxProfit = parseFloat((width - netDebit).toFixed(2));
  const maxLoss = netDebit;
  const breakeven = parseFloat((longLeg.strike + netDebit).toFixed(2));
  const sui = suitabilityScore([longLeg, shortLeg]);
  const debitRatio = width > 0 ? netDebit / width : 1;
  if (debitRatio > 0.7) sui.warnings.push("Debit is large relative to spread width");
  return {
    strategyType: "bull_call_spread",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [longLeg, shortLeg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons: [
      "Defined risk and reward via debit spread",
      `Long ${longLeg.strike} / Short ${shortLeg.strike} call`,
      `Max profit ${maxProfit} vs max loss ${maxLoss}`,
    ],
  };
}

export function buildBearPutSpread(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(30, ctx.requestedDte);
  const longStrike = roundStrike(spot * 1.01);
  const shortStrike = roundStrike((setup.targets?.[0] ?? spot * 0.95));
  const longLeg = buildLeg(longStrike, "put", spot, dte, iv, "long");
  const shortLeg = buildLeg(Math.min(shortStrike, longStrike - 1), "put", spot, dte, iv, "short");
  const netDebit = parseFloat((longLeg.mid - shortLeg.mid).toFixed(2));
  const width = longLeg.strike - shortLeg.strike;
  const maxProfit = parseFloat((width - netDebit).toFixed(2));
  const maxLoss = netDebit;
  const breakeven = parseFloat((longLeg.strike - netDebit).toFixed(2));
  const sui = suitabilityScore([longLeg, shortLeg]);
  const debitRatio = width > 0 ? netDebit / width : 1;
  if (debitRatio > 0.7) sui.warnings.push("Debit is large relative to spread width");
  return {
    strategyType: "bear_put_spread",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [longLeg, shortLeg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons: [
      "Defined risk and reward via debit spread",
      `Long ${longLeg.strike} / Short ${shortLeg.strike} put`,
      `Max profit ${maxProfit} vs max loss ${maxLoss}`,
    ],
  };
}

// Sells one OTM put (~delta -0.30) with cash reserved to buy 100 shares if
// assigned. Income/wheel-style — a *credit* trade, not a debit. We expose the
// premium as a negative netDebit so downstream code that already understands
// "negative debit = credit" works without a schema change.
export function buildCashSecuredPutPlan(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(35);
  // Target ~5% OTM put — a typical wheel CSP entry, well below the spot.
  const strike = roundStrike(spot * 0.95);
  const leg = buildLeg(strike, "put", spot, dte, iv, "short");
  const credit = leg.mid;
  const netDebit = parseFloat((-credit).toFixed(2));
  const breakeven = parseFloat((strike - credit).toFixed(2));
  const maxProfit = credit; // keep premium if put expires worthless
  const maxLoss = parseFloat(Math.max(0, strike - credit).toFixed(2)); // assigned at strike, stock to $0 worst case
  const sui = suitabilityScore([leg]);
  const reasons = [
    "Income trade — collect premium up front",
    `Sell ${strike} put (~${(Math.abs(leg.delta) * 100).toFixed(0)} delta), ~${dte}d to expiry`,
    `Cash collateral required: ~$${(strike * 100).toFixed(0)} per contract`,
    "If assigned, you buy 100 shares at the strike — typical wheel entry",
  ];
  if (ctx.earningsBeforeExpiry) sui.warnings.push("Earnings before expiry — assignment risk if stock drops on the print");
  return {
    strategyType: "cash_secured_put",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [leg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons,
  };
}

// Sells one OTM call (~delta 0.30) against 100 shares the user already owns.
// Income/wheel-style — also a *credit* trade, exposed as negative netDebit.
export function buildCoveredCallPlan(setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  const spot = ctx.livePrice ?? setup.metrics?.currentPrice ?? setup.entry;
  const iv = ctx.ivRank ? 0.25 + (ctx.ivRank / 100) * 0.6 : 0.35;
  const { expiry, dte } = pickExpiry(35);
  const strike = roundStrike(spot * 1.05);
  const leg = buildLeg(strike, "call", spot, dte, iv, "short");
  const credit = leg.mid;
  const netDebit = parseFloat((-credit).toFixed(2));
  // Max profit = appreciation up to strike + premium; max loss approximates
  // shares-only downside minus premium cushion (we don't know cost basis here
  // so we assume entry at current spot).
  const maxProfit = parseFloat((Math.max(0, strike - spot) + credit).toFixed(2));
  const maxLoss = parseFloat(Math.max(0, spot - credit).toFixed(2));
  const breakeven = parseFloat((spot - credit).toFixed(2));
  const sui = suitabilityScore([leg]);
  const reasons = [
    "Income trade — collect premium against shares you own",
    `Sell ${strike} call (~${(leg.delta * 100).toFixed(0)} delta), ~${dte}d to expiry`,
    `Upside capped at the ${strike} strike; premium offsets some downside`,
    "If assigned, your shares are called away at the strike",
  ];
  if (ctx.earningsBeforeExpiry) sui.warnings.push("Earnings before expiry — premium may be inflated, assignment risk on a beat");
  return {
    strategyType: "covered_call",
    symbol: setup.symbol,
    expiry,
    dte,
    legs: [leg],
    netDebit,
    maxProfit,
    maxLoss,
    breakeven,
    suitabilityScore: sui.score,
    warnings: sui.warnings,
    reasons,
  };
}

export function buildOptionPlan(strategyType: OptionStrategyType, setup: TradeSetup, ctx: OptionsContext = {}): OptionPlan {
  switch (strategyType) {
    case "long_call": return buildLongCallPlan(setup, ctx);
    case "long_put": return buildLongPutPlan(setup, ctx);
    case "bull_call_spread": return buildBullCallSpread(setup, ctx);
    case "bear_put_spread": return buildBearPutSpread(setup, ctx);
    case "cash_secured_put": return buildCashSecuredPutPlan(setup, ctx);
    case "covered_call": return buildCoveredCallPlan(setup, ctx);
  }
}
