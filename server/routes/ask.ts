import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { refreshSentimentForSymbols, isOpenAiConfigured } from "../services/news";
import { getMarketSnapshot, type MarketSnapshot } from "../services/market-data";
import {
  findBestTrades,
  findBestTradesForSymbol,
  type BestTradePick,
  type BestTradeForSymbolResult,
} from "../services/best-trade-finder";
import { parsePrompt } from "../agent/prompt-interpreter";
import { selectInstrument } from "../services/instrument-selector";
import { scoreSetup } from "../services/probability-engine";
import type { TradeSetup } from "../agent/strategy-engine";
import { buildLongCallPlan, buildLongPutPlan, buildBullCallSpread, buildBearPutSpread, type OptionPlan } from "../services/options-evaluator";
import { getOptionExpirations, getOptionChain } from "../broker";

// Compact, human-readable trade ticket returned alongside the AI prose so
// users see real strikes/expiry/credit instead of a vague suggestion. Every
// number comes from the live snapshot price + the deterministic option-plan
// builders — we never invent strikes.
export interface AskTradeDetail {
  symbol: string;
  // Directional debit trades (long_call/long_put/bull_call_spread/bear_put_spread)
  // are debits paid up front; CSP/CC are credit-collecting income trades. The
  // frontend branches on strategy to render the right labels (Debit vs Credit,
  // Breakeven box, legs summary for spreads, etc).
  strategy:
    | "cash_secured_put"
    | "covered_call"
    | "long_call"
    | "long_put"
    | "bull_call_spread"
    | "bear_put_spread";
  strategyLabel: string;
  // For multi-leg structures, a human-readable summary of the legs
  // (e.g. "Long $100 / Short $105 call"). Single-leg tickets leave this null.
  legsLabel?: string | null;
  bias: "bullish" | "bearish" | "neutral";
  // Whether the active signals on this symbol AGREE with the requested trade
  // direction. Set when the trade is built from a directional ask (long
  // call/put) so the UI can call out a contrary-bias warning.
  signalAlignment?: "aligned" | "contrary" | "neutral";
  signalAlignmentNote?: string;
  spot: number;
  strike: number;
  optionType: "put" | "call";
  expiry: string;
  dte: number;
  // For credit trades (CSP/CC) this is the credit collected per share.
  // For debit trades (long_call/long_put) this is the premium PAID per share.
  premiumPerShare: number;
  premiumPerContract: number;
  collateralPerContract: number; // CSP only: cash collateral required per contract
  upsideCapPerContract: number | null; // CC only: max proceeds at assignment = (strike + premium) * 100
  maxProfitPerContract: number;
  maxLossPerContract: number;
  breakeven: number;
  delta: number;
  reasons: string[];
  warnings: string[];
  dataMode: "live" | "simulated";
  // Where the *option pricing* (premium, delta, IV) came from. "broker_chain"
  // means we pulled a real contract from the user's connected broker (Tradier
  // or TradeStation) — strike, expiry, bid/ask, delta are live market data.
  // "estimated" means no broker is connected (or the chain fetch failed) so
  // we used an internal Black–Scholes approximation — directionally correct
  // but NOT a live quote. The UI surfaces this clearly to the user.
  pricingSource: "broker_chain" | "estimated";
}

// Directional debit ticket — long call (bullish) or long put (bearish).
// Used when the user asks "find a long call on MU" so we return a concrete
// strike + expiry + debit instead of generic prose.
// Pull an explicit "N DTE" / "0 DTE" / "same-day" / "weekly" hint out of the
// raw question so option builders honor the user's requested expiry. Returns
// null if the user did not specify one (builder will fall back to its
// default — currently ~21d for single-leg and ~30d for spreads).
export function extractRequestedDte(question: string): number | null {
  const lower = question.toLowerCase();
  if (/\b(same[-\s]?day|0\s*dte|zero\s*dte)\b/.test(lower)) return 0;
  if (/\bweekly\s+(trade|play|option|setup|call|put|spread)\b/.test(lower)) return 7;
  if (/\bday\s+trade\b/.test(lower)) return 0;
  const m = lower.match(/\b(\d{1,3})\s*dte\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= 365) return n;
  }
  return null;
}

function buildDirectionalTradeDetail(
  symbol: string,
  livePrice: number | null,
  direction: "long_call" | "long_put",
  requestedDte: number | null = null,
): AskTradeDetail {
  const spot = livePrice && livePrice > 0 ? livePrice : 100;
  const dataMode: "live" | "simulated" = livePrice && livePrice > 0 ? "live" : "simulated";
  const bullish = direction === "long_call";

  const setup: TradeSetup = {
    id: `ask_${Date.now()}`,
    symbol,
    assetType: "option",
    strategyName: bullish ? "Long Call" : "Long Put",
    timeframe: "1D",
    setupType: "trade",
    bias: bullish ? "bullish" : "bearish",
    entry: spot,
    stop: bullish ? spot * 0.95 : spot * 1.05,
    targets: bullish ? [spot * 1.08, spot * 1.12] : [spot * 0.92, spot * 0.88],
    rewardRisk: null,
    modelScore: null,
    reasoning: [],
    invalidation: [],
    metrics: { currentPrice: spot },
    dataSource: dataMode === "live" ? "live broker quote" : "simulated price baseline",
    generatedAt: new Date().toISOString(),
  };

  const ctx = requestedDte != null ? { requestedDte } : {};
  const plan: OptionPlan = bullish ? buildLongCallPlan(setup, ctx) : buildLongPutPlan(setup, ctx);
  const leg = plan.legs[0];
  // Debit trades expose a positive netDebit — that's the premium the user pays.
  const debit = Math.abs(plan.netDebit);

  return {
    symbol,
    strategy: direction,
    strategyLabel: bullish ? "Long call" : "Long put",
    bias: setup.bias,
    spot: parseFloat(spot.toFixed(2)),
    strike: leg.strike,
    optionType: leg.type,
    expiry: plan.expiry,
    dte: plan.dte,
    premiumPerShare: parseFloat(debit.toFixed(2)),
    premiumPerContract: parseFloat((debit * 100).toFixed(2)),
    collateralPerContract: 0,
    upsideCapPerContract: null,
    maxProfitPerContract: parseFloat((plan.maxProfit * 100).toFixed(2)),
    maxLossPerContract: parseFloat((plan.maxLoss * 100).toFixed(2)),
    breakeven: plan.breakeven,
    delta: leg.delta,
    reasons: plan.reasons,
    warnings: plan.warnings,
    dataMode,
    pricingSource: "estimated",
  };
}

// Detect directional debit-option asks ("long call on MU", "buy a put on TSLA",
// "call option on AAPL"). Returns the direction or null. Multi-leg strategies
// (spreads, verticals, iron condors, butterflies, strangles, straddles,
// collars, credit/debit-spread phrasings) are excluded so e.g. "buy a call
// spread on AAPL" does NOT get routed into a single-leg long call ticket.
const MULTI_LEG_HINT = /\b(spread|vertical|iron|condor|butterfly|strangle|straddle|collar|calendar|diagonal|credit\s+spread|debit\s+spread)\b/;
function detectDirectionalOption(lower: string): "long_call" | "long_put" | null {
  if (MULTI_LEG_HINT.test(lower)) return null;
  if (/\b(long\s+calls?|buy\s+(a\s+|the\s+|some\s+)?calls?|call\s+options?)\b/.test(lower)) return "long_call";
  if (/\b(long\s+puts?|buy\s+(a\s+|the\s+|some\s+)?puts?|put\s+options?)\b/.test(lower)) return "long_put";
  return null;
}

// Detect defined-risk debit-spread asks. Returns:
//   - "bull_call_spread" for explicit bull-call-spread phrasings
//   - "bear_put_spread" for explicit bear-put-spread phrasings
//   - "debit_spread" when the user just says "debit spread" / "vertical" —
//     direction is resolved later from the symbol's detected bias
//   - null otherwise
// We deliberately exclude credit spreads, iron condors, butterflies, strangles,
// straddles, collars, calendars, and diagonals — those need different builders
// we don't yet expose to Ask.
// "bear call spread" and "bull put spread" are CREDIT verticals — selling
// premium, not paying a debit. We do not yet expose builders for them in Ask,
// so they must be rejected before the generic "call spread"/"put spread"
// patterns below match (otherwise "bear call spread" would silently route to
// bull_call_spread). Also rejects explicit credit spreads, iron condors,
// butterflies, strangles, straddles, collars, calendars, and diagonals.
const UNSUPPORTED_MULTI_LEG = /\b(credit\s+spread|bear\s+call\s+spread|bull\s+put\s+spread|call\s+credit\s+spread|put\s+credit\s+spread|iron|condor|butterfly|strangle|straddle|collar|calendar|diagonal)\b/;
function detectSpreadIntent(lower: string): "bull_call_spread" | "bear_put_spread" | "debit_spread" | null {
  if (UNSUPPORTED_MULTI_LEG.test(lower)) return null;
  if (/\bbull\s+call\s+spread\b|\bcall\s+debit\s+spread\b/.test(lower)) return "bull_call_spread";
  if (/\bbear\s+put\s+spread\b|\bput\s+debit\s+spread\b/.test(lower)) return "bear_put_spread";
  // Generic "call spread" → bull; "put spread" → bear (debit spread default).
  if (/\bcall\s+spread\b/.test(lower)) return "bull_call_spread";
  if (/\bput\s+spread\b/.test(lower)) return "bear_put_spread";
  // "debit spread" / "vertical spread" with no direction — resolve via bias later.
  if (/\bdebit\s+spread\b|\bvertical(\s+spread)?\b/.test(lower)) return "debit_spread";
  return null;
}

// Detect generic "find me a (good) option trade / trade idea" asks that
// DON'T name a specific structure. These include the very common conditional
// pattern "is X bullish? if yes find me a good option trade". We route them
// through the bias engine and pick:
//   - bullish bias → long_call
//   - bearish bias → long_put
//   - neutral bias → null (don't force a ticket — let prose explain why)
// Returns true if the prompt looks like a generic "give me a trade" ask.
// Excludes multi-leg phrasings (those go through detectSpreadIntent) and the
// already-handled single-leg explicit asks (those go through
// detectDirectionalOption). Excludes income/wheel phrasings (those are
// covered by parsePrompt's incomeIntent).
const INCOME_HINT = /\b(wheel|cash[-\s]?secured\s+put|covered\s+call|csp|premium\s+income|sell\s+(a\s+|the\s+|some\s+)?puts?|sell\s+(a\s+|the\s+|some\s+)?calls?|income|collect\s+premium)\b/;
function detectGenericTradeAsk(lower: string): boolean {
  if (MULTI_LEG_HINT.test(lower)) return false;
  if (INCOME_HINT.test(lower)) return false;
  // Already covered by detectDirectionalOption — let that path handle them so
  // we don't double-trigger.
  if (/\b(long\s+calls?|buy\s+(a\s+|the\s+|some\s+)?calls?|call\s+options?|long\s+puts?|buy\s+(a\s+|the\s+|some\s+)?puts?|put\s+options?)\b/.test(lower)) return false;
  // Generic option / trade asks. We require the prompt to be ASKING for a
  // trade — not just mentioning options in passing.
  if (/\b(option\s+(trade|play|idea|setup|strategy)|find\s+me\s+(a\s+|an\s+|the\s+|some\s+)?(good\s+|best\s+)?(option\s+)?trade|good\s+(option\s+)?trade|best\s+(option\s+)?trade|trade\s+idea|trade\s+setup|what\s+(option\s+)?trade|any\s+(option\s+)?trade|suggest\s+(a\s+|an\s+)?(option\s+)?trade|recommend\s+(a\s+|an\s+)?(option\s+)?trade)\b/.test(lower)) {
    return true;
  }
  // Expiry-shorthand asks like "find a 0 DTE trade on MU", "weekly trade on
  // TSLA", "swing trade on NVDA", "play on AMD". These all imply the user
  // wants a structured trade idea but don't specify direction. We REQUIRE an
  // explicit ask verb so educational/definitional prompts like "what is the
  // trade on MU price" or "explain 0 DTE" don't accidentally fire.
  const askVerb = /\b(find|give\s+me|show\s+me|suggest|recommend|build|need|want|looking\s+for|what(?:'s|\s+is)?\s+(?:a|the|some)?\s*(?:good|best)?|any|good|best|consider)\b/;
  if (!askVerb.test(lower)) return false;
  return /\b((0|zero|same[-\s]?day|1|2|3|5|7)\s*dte\s+(trade|play|option|setup|idea)|(0|zero)\s*dte\b|weekly\s+(trade|play|option|setup)|swing\s+(trade|play|setup)|day\s+trade|short[-\s]?term\s+(trade|play|setup)|(play|trade|setup|idea)\s+(on|for|in)\s+[a-z]{1,5}|directional\s+(trade|play|bet)|bullish\s+(trade|play|setup)|bearish\s+(trade|play|setup))\b/.test(lower);
}

// Bull-call or bear-put debit spread ticket. Both legs come from the
// deterministic option-plan builders so strikes/widths/debit/breakeven are
// internally consistent — we never invent numbers.
function buildSpreadTradeDetail(
  symbol: string,
  livePrice: number | null,
  spread: "bull_call_spread" | "bear_put_spread",
  requestedDte: number | null = null,
): AskTradeDetail {
  const spot = livePrice && livePrice > 0 ? livePrice : 100;
  const dataMode: "live" | "simulated" = livePrice && livePrice > 0 ? "live" : "simulated";
  const bullish = spread === "bull_call_spread";

  const setup: TradeSetup = {
    id: `ask_${Date.now()}`,
    symbol,
    assetType: "option",
    strategyName: bullish ? "Bull Call Spread" : "Bear Put Spread",
    timeframe: "1D",
    setupType: "trade",
    bias: bullish ? "bullish" : "bearish",
    entry: spot,
    stop: bullish ? spot * 0.95 : spot * 1.05,
    targets: bullish ? [spot * 1.05, spot * 1.08] : [spot * 0.95, spot * 0.92],
    rewardRisk: null,
    modelScore: null,
    reasoning: [],
    invalidation: [],
    metrics: { currentPrice: spot },
    dataSource: dataMode === "live" ? "live broker quote" : "simulated price baseline",
    generatedAt: new Date().toISOString(),
  };

  const spreadCtx = requestedDte != null ? { requestedDte } : {};
  const plan: OptionPlan = bullish ? buildBullCallSpread(setup, spreadCtx) : buildBearPutSpread(setup, spreadCtx);
  const longLeg = plan.legs.find((l) => l.side === "long") ?? plan.legs[0];
  const shortLeg = plan.legs.find((l) => l.side === "short") ?? plan.legs[1];
  const debit = Math.abs(plan.netDebit);
  const legType = longLeg.type;
  const legsLabel = `Long $${longLeg.strike} / Short $${shortLeg.strike} ${legType}`;

  return {
    symbol,
    strategy: spread,
    strategyLabel: bullish ? "Bull call spread" : "Bear put spread",
    legsLabel,
    bias: setup.bias,
    spot: parseFloat(spot.toFixed(2)),
    // Headline strike = the long leg (the one you buy). The shortLeg lives in
    // legsLabel so the user sees both.
    strike: longLeg.strike,
    optionType: legType,
    expiry: plan.expiry,
    dte: plan.dte,
    premiumPerShare: parseFloat(debit.toFixed(2)),
    premiumPerContract: parseFloat((debit * 100).toFixed(2)),
    collateralPerContract: 0,
    upsideCapPerContract: null,
    maxProfitPerContract: parseFloat((plan.maxProfit * 100).toFixed(2)),
    maxLossPerContract: parseFloat((plan.maxLoss * 100).toFixed(2)),
    breakeven: plan.breakeven,
    delta: longLeg.delta,
    reasons: plan.reasons,
    warnings: plan.warnings,
    dataMode,
    pricingSource: "estimated",
  };
}

function buildIncomeTradeDetail(
  symbol: string,
  livePrice: number | null,
  incomeIntent: "wheel" | "cash_secured_put" | "covered_call",
): AskTradeDetail | null {
  // We need a real spot to build a meaningful plan. If we don't have a live
  // quote, fall back to a simulated price baseline so the preview still shows
  // realistic shape — clearly marked as simulated.
  const spot = livePrice && livePrice > 0 ? livePrice : 100;
  const dataMode: "live" | "simulated" = livePrice && livePrice > 0 ? "live" : "simulated";

  // Wheel + (default) put → CSP. Wheel + call-only would be CC (handled when
  // the prompt interpreter pinned to "covered_call").
  const wantedStrategy: "cash_secured_put" | "covered_call" =
    incomeIntent === "covered_call" ? "covered_call" : "cash_secured_put";

  // Minimal TradeSetup so the existing selector machinery works unchanged.
  const setup: TradeSetup = {
    id: `ask_${Date.now()}`,
    symbol,
    assetType: "option",
    strategyName: wantedStrategy === "cash_secured_put" ? "Cash-Secured Put (Wheel)" : "Covered Call (Wheel)",
    timeframe: "1D",
    setupType: "income",
    bias: "neutral",
    entry: spot,
    stop: spot * 0.95,
    targets: [spot * 1.02, spot * 1.05],
    rewardRisk: null,
    modelScore: null,
    reasoning: [],
    invalidation: [],
    metrics: { currentPrice: spot },
    dataSource: dataMode === "live" ? "live broker quote" : "simulated price baseline",
    generatedAt: new Date().toISOString(),
  };

  const probability = scoreSetup({ setup });
  const recommendation = selectInstrument({
    setup,
    probability,
    prefs: {},
    incomeIntent,
  });

  const plan: OptionPlan | undefined = recommendation.recommendedPlan;
  if (!plan || plan.legs.length === 0) return null;
  if (plan.strategyType !== "cash_secured_put" && plan.strategyType !== "covered_call") return null;

  const leg = plan.legs[0];
  // Credit trades expose the premium as a negative netDebit.
  const credit = Math.abs(plan.netDebit);
  // CSP: cash you must keep aside (strike × 100, minus the premium credited).
  // CC : the 100 shares are the collateral, not cash — we report 0 here and
  // surface upsideCapPerContract instead, which is the actually meaningful
  // ceiling for a covered call.
  const collateral = plan.strategyType === "cash_secured_put"
    ? leg.strike * 100 - credit * 100
    : 0;
  // Total proceeds if assigned on a covered call = (strike + premium) * 100.
  // This is the real "upside cap" — what you walk away with per contract.
  const upsideCap = plan.strategyType === "covered_call"
    ? parseFloat(((leg.strike + credit) * 100).toFixed(2))
    : null;

  return {
    symbol,
    strategy: plan.strategyType,
    strategyLabel: plan.strategyType === "cash_secured_put" ? "Cash-secured put" : "Covered call",
    bias: setup.bias,
    spot: parseFloat(spot.toFixed(2)),
    strike: leg.strike,
    optionType: leg.type,
    expiry: plan.expiry,
    dte: plan.dte,
    premiumPerShare: parseFloat(credit.toFixed(2)),
    premiumPerContract: parseFloat((credit * 100).toFixed(2)),
    collateralPerContract: parseFloat(collateral.toFixed(2)),
    upsideCapPerContract: upsideCap,
    maxProfitPerContract: parseFloat((plan.maxProfit * 100).toFixed(2)),
    maxLossPerContract: parseFloat((plan.maxLoss * 100).toFixed(2)),
    breakeven: plan.breakeven,
    delta: leg.delta,
    reasons: plan.reasons,
    warnings: plan.warnings,
    dataMode,
    pricingSource: "estimated",
  };
}

// Snap a synthetic single-leg trade ticket to a real contract from the user's
// connected broker (Tradier / TradeStation) when possible. This replaces the
// internal premium/delta estimates with live market quotes:
//   - Picks the listed expiration closest to the requested DTE.
//   - Picks the listed strike closest to the synthetic strike (same type).
//   - Recomputes premium/breakeven/max-P/L/collateral/upside-cap from the
//     real bid+ask midpoint.
// Returns the original ticket unchanged if no broker is connected, the chain
// is empty, or the closest contract has no usable quote. Multi-leg spreads
// are left as estimates here (they need both legs from the chain — handled
// elsewhere) and are explicitly skipped.
async function enrichTradeDetailFromBrokerChain(
  userId: string,
  td: AskTradeDetail,
): Promise<AskTradeDetail> {
  // Spreads have two legs — enrichment for those is out of scope for this
  // path. Leave them as "estimated" so the UI flags them clearly.
  if (td.strategy === "bull_call_spread" || td.strategy === "bear_put_spread") {
    return td;
  }
  try {
    const expirations = await getOptionExpirations(userId, td.symbol);
    if (!expirations || expirations.length === 0) return td;

    // Pick the listed expiration whose date is closest to the synthetic one.
    const today = Date.now();
    const targetMs = today + td.dte * 86400000;
    let bestExp: string | null = null;
    let bestExpDelta = Infinity;
    for (const exp of expirations) {
      const t = Date.parse(exp);
      if (Number.isNaN(t)) continue;
      const d = Math.abs(t - targetMs);
      if (d < bestExpDelta) {
        bestExpDelta = d;
        bestExp = exp;
      }
    }
    if (!bestExp) return td;

    const chain = await getOptionChain(userId, td.symbol, bestExp);
    if (!chain || chain.length === 0) return td;

    // Filter to the right side of the chain, drop malformed contracts
    // (NaN/non-positive strike) up front, then pick closest strike.
    const sameType = chain.filter(
      (c) => c.optionType === td.optionType && Number.isFinite(c.strike) && c.strike > 0,
    );
    if (sameType.length === 0) return td;
    let best = sameType[0];
    let bestDelta = Math.abs(best.strike - td.strike);
    for (const c of sameType) {
      const d = Math.abs(c.strike - td.strike);
      if (d < bestDelta) {
        bestDelta = d;
        best = c;
      }
    }

    // Strict all-or-nothing: every required broker field must be finite and
    // valid, otherwise we keep the estimated ticket rather than emit a
    // mixed/partially-broker ticket that's misleadingly labeled
    // "Live broker chain".
    const strike = best.strike;
    if (!Number.isFinite(strike) || strike <= 0) return td;

    const rawDelta = best.greeks?.delta;
    if (!Number.isFinite(rawDelta)) return td;
    const delta = rawDelta as number;

    const expiry = best.expiration;
    const expiryMs = Date.parse(expiry);
    if (!Number.isFinite(expiryMs)) return td;

    // Live mid from bid/ask; fall back to last if one side is missing.
    const bid = Number.isFinite(best.bid) && best.bid > 0 ? best.bid : 0;
    const ask = Number.isFinite(best.ask) && best.ask > 0 ? best.ask : 0;
    let mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : best.last;
    if (!Number.isFinite(mid) || mid <= 0) return td;
    const realDte = Math.max(0, Math.round((expiryMs - today) / 86400000));
    const spot = td.spot;

    // Recompute downstream fields per strategy. Mirrors the math in
    // buildLongCallPlan / buildLongPutPlan / buildCashSecuredPutPlan /
    // buildCoveredCallPlan but uses the live mid as the premium. Target
    // multipliers (1.08 / 0.92) match the synthetic setups created in
    // buildDirectionalTradeDetail so the "Est. profit at target" value
    // stays consistent before and after enrichment.
    const out: AskTradeDetail = {
      ...td,
      strike,
      expiry,
      dte: realDte,
      delta: parseFloat(delta.toFixed(2)),
      premiumPerShare: parseFloat(mid.toFixed(2)),
      premiumPerContract: parseFloat((mid * 100).toFixed(2)),
      pricingSource: "broker_chain",
    };

    if (td.strategy === "long_call") {
      const target = spot * 1.08;
      out.breakeven = parseFloat((strike + mid).toFixed(2));
      out.maxLossPerContract = parseFloat((mid * 100).toFixed(2));
      out.maxProfitPerContract = parseFloat((Math.max(0, target - strike - mid) * 100).toFixed(2));
    } else if (td.strategy === "long_put") {
      const target = spot * 0.92;
      out.breakeven = parseFloat((strike - mid).toFixed(2));
      out.maxLossPerContract = parseFloat((mid * 100).toFixed(2));
      out.maxProfitPerContract = parseFloat((Math.max(0, strike - target - mid) * 100).toFixed(2));
    } else if (td.strategy === "cash_secured_put") {
      out.collateralPerContract = parseFloat((strike * 100 - mid * 100).toFixed(2));
      out.breakeven = parseFloat((strike - mid).toFixed(2));
      out.maxProfitPerContract = parseFloat((mid * 100).toFixed(2));
      out.maxLossPerContract = parseFloat(((strike - mid) * 100).toFixed(2));
    } else if (td.strategy === "covered_call") {
      out.upsideCapPerContract = parseFloat(((strike + mid) * 100).toFixed(2));
      out.breakeven = parseFloat((spot - mid).toFixed(2));
      out.maxProfitPerContract = parseFloat(((Math.max(0, strike - spot) + mid) * 100).toFixed(2));
      out.maxLossPerContract = parseFloat((Math.max(0, spot - mid) * 100).toFixed(2));
    }
    return out;
  } catch (err) {
    console.warn("[ask] broker chain enrichment failed:", (err as Error).message);
    return td;
  }
}

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

const COMMON_WORDS = new Set([
  "I", "A", "AN", "IS", "IT", "TO", "OF", "IN", "ON", "AT", "BY", "DO", "MY", "ME",
  "WHY", "HOW", "WHAT", "WHEN", "WHERE", "WHO", "CAN", "SHOULD", "WILL", "WOULD",
  "THE", "AND", "OR", "FOR", "WITH", "FROM", "THIS", "THAT", "BUY", "SELL", "PUT",
  "CALL", "STOCK", "STOCKS", "TRADE", "TRADES", "PRICE", "MARKET", "OPTION", "OPTIONS",
  "SHOW", "FIND", "GIVE", "TELL", "MAKE", "GET", "USE", "TODAY", "NOW", "BEST",
  "GOOD", "BAD", "UP", "DOWN", "OUT", "RUN", "DAY", "ALL", "ANY", "BE", "ARE",
  "MOVING", "GROW", "INCOME", "RISK", "PRO", "PLAN", "AI",
]);

const TICKER_PATTERN = /\b([A-Z]{1,5})\b/g;

function extractTickers(text: string, max = 3): string[] {
  const found = new Set<string>();

  // 1) Explicit $ticker syntax in any case wins (most unambiguous).
  const dollar = text.match(/\$([A-Za-z]{1,5})\b/g) ?? [];
  for (const d of dollar) {
    const sym = d.replace("$", "").toUpperCase();
    if (!COMMON_WORDS.has(sym)) {
      found.add(sym);
      if (found.size >= max) return Array.from(found);
    }
  }

  // 2) Uppercase tokens (NVDA, AAPL).
  const upper = text.match(TICKER_PATTERN) ?? [];
  for (const t of upper) {
    if (!COMMON_WORDS.has(t) && t.length >= 1 && t.length <= 5) {
      found.add(t);
      if (found.size >= max) return Array.from(found);
    }
  }

  // 3) Case-insensitive fallback: tokenize, uppercase short alpha words,
  //    and treat them as candidate tickers (minus common words). Catches
  //    "why is nvda moving".
  const tokens = text.split(/[^A-Za-z$]+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 2 || tok.length > 5) continue;
    const sym = tok.toUpperCase();
    if (COMMON_WORDS.has(sym)) continue;
    if (found.has(sym)) continue;
    found.add(sym);
    if (found.size >= max) break;
  }
  return Array.from(found);
}

function classifyIntent(q: string): "best-trade" | "income" | "growth" | "news" | "trade-idea" | "general" {
  const lower = q.toLowerCase();
  // "best trade" intent must be checked first — it's the highest-value action
  // and the phrasing overlaps with several others.
  if (
    /(best (trade|stock|option|setup|pick)s?)|(find (me )?(a |the )?(best )?trade)|(top (pick|trade|setup)s?)|(what should i (trade|buy) (now|today))|(high[- ]?probability)/.test(lower)
  ) {
    return "best-trade";
  }
  if (/(income|covered call|cash[- ]secured|premium|dividend|monthly cash|weekly income)/.test(lower)) return "income";
  if (/(grow|growth|long[- ]?term|nest egg|retire|portfolio|compound|build wealth)/.test(lower)) return "growth";
  if (/(why|news|catalyst|sentiment|moving|happening|announce|earnings|fed)/.test(lower)) return "news";
  if (/(setup|trade|entry|breakout|swing|day trade|buy|short|long|call|put|spread)/.test(lower)) return "trade-idea";
  return "general";
}

// Extracts a universe hint from a free-form question — matches the same
// universe choices offered on the Best Trade page so chat invocation is
// consistent with explicit feature use.
function detectUniverseHint(lower: string): "watchlist" | "sp_100" | "sp_500" | "nasdaq_100" | "high_volume" | "options_liquid" | "large_cap" | null {
  if (/\bwatchlist\b/.test(lower)) return "watchlist";
  if (/\bs\s*&?\s*p\s*-?\s*100\b|\bsp[\s-]?100\b|\boex\b/.test(lower)) return "sp_100";
  if (/\bs\s*&?\s*p\s*-?\s*500\b|\bsp[\s-]?500\b/.test(lower)) return "sp_500";
  if (/\bnasdaq[\s-]?100\b|\bndx\b|\bqqq\b/.test(lower)) return "nasdaq_100";
  if (/\bhigh[\s-]?volume\b|\bmost active\b|\btop volume\b/.test(lower)) return "high_volume";
  if (/\boptions?[\s-]?liquid\b|\bliquid options?\b/.test(lower)) return "options_liquid";
  if (/\bdow\s*30\b|\bdjia\b|\bblue[\s-]?chips?\b/.test(lower)) return "large_cap";
  return null;
}

function suggestionsForIntent(intent: ReturnType<typeof classifyIntent>, tickers: string[]): { label: string; href: string }[] {
  const t = tickers[0];
  switch (intent) {
    case "best-trade":
      return t
        ? [
            { label: `Build a ticket for ${t}`, href: `/trade/${t}` },
            { label: `Open ${t} chart`, href: `/charts/${t}` },
            { label: "See ranked opportunities", href: "/opportunity-radar" },
          ]
        : [
            { label: "See ranked opportunities", href: "/opportunity-radar" },
            { label: "Open Trade Builder", href: "/trade-finder" },
          ];
    case "income":
      return [
        { label: "Open Income Mode", href: "/income-mode" },
        { label: "See today's income ideas", href: "/opportunity-radar" },
      ];
    case "growth":
      return [
        { label: "Open Grow Mode", href: "/goal-mode" },
        { label: "See top growth ideas", href: "/opportunity-radar" },
      ];
    case "news":
      return t
        ? [
            { label: `View ${t} in Market Intel`, href: `/market-intel?symbol=${t}` },
            { label: `Trade ${t}`, href: `/trade/${t}` },
          ]
        : [{ label: "Open Market Intel", href: "/market-intel" }];
    case "trade-idea":
      return t
        ? [
            { label: `Build a setup for ${t}`, href: `/trade-finder?symbol=${t}` },
            { label: `Trade ${t}`, href: `/trade/${t}` },
          ]
        : [
            { label: "Open Trade Builder", href: "/trade-finder" },
            { label: "See ranked opportunities", href: "/opportunity-radar" },
          ];
    default:
      return [
        { label: "Open Trade Builder", href: "/trade-finder" },
        { label: "See ranked opportunities", href: "/opportunity-radar" },
      ];
  }
}

const SYSTEM_PROMPT = `You are VCP Trader AI, an assistant for self-directed retail traders inside the VCP Trader AI app.

Strict rules:
- You provide software-generated educational analysis. You NEVER give personalized investment advice, price predictions, or guarantees.
- Always include a brief risk note when discussing a specific trade idea.
- Keep answers concise (max ~180 words) and structured. Use plain English; avoid jargon unless asked.
- If the user mentions a ticker, anchor your answer to the supplied live quote, computed indicators (RSI, MACD, SMA/EMA, Bollinger, ATR, VWAP, volume, support/resistance), and sentiment context. Do not invent prices or invent indicator values.
- Reference indicators in plain English (e.g., "RSI is overbought near 72" or "trading above the 50-day average"). If indicators or live quote are missing, say so honestly.
- Never suggest auto-trading or autopilot behavior.

Return STRICT JSON with this exact shape:
{
  "headline": "one short sentence answering the question",
  "answer": "2-4 short paragraphs of plain-English explanation (markdown line breaks ok)",
  "keyPoints": ["bullet 1", "bullet 2", "bullet 3"],
  "riskNote": "one sentence on risk / what could go wrong",
  "confidence": "low | medium | high"
}`;

interface TickerContext {
  symbol: string;
  last: number | null;
  changePercent: number | null;
  sentimentLabel: string | null;
  sentimentScore: number | null;
  whyItMatters: string | null;
  market: MarketSnapshot | null;
}

interface ContextBlock {
  tickers: TickerContext[];
  brokerConnected: boolean;
  brokerProvider: string | null;
  intent: string;
}

async function buildContext(userId: string, question: string, intent: string, tickers: string[]): Promise<ContextBlock> {
  const ctx: ContextBlock = { tickers: [], brokerConnected: false, brokerProvider: null, intent };

  try {
    const conn = await storage.getBrokerConnectionWithToken(userId);
    ctx.brokerConnected = !!(conn && conn.isConnected && conn.accessToken);
    ctx.brokerProvider = conn?.provider ?? null;
  } catch {}

  if (tickers.length > 0) {
    // Pull sentiment + live broker market snapshots (quote + indicators) in parallel.
    const [sentimentResult, snapshots] = await Promise.all([
      refreshSentimentForSymbols(tickers, { itemsPerSymbol: 4 }).catch((err) => {
        console.warn("[ask] sentiment lookup failed:", err);
        return { snapshots: [] as any[] };
      }),
      Promise.all(tickers.map((s) => getMarketSnapshot(userId, s).catch((e) => {
        console.warn(`[ask] market snapshot failed for ${s}:`, (e as Error).message);
        return null;
      }))),
    ]);
    const sentSnaps = sentimentResult.snapshots ?? [];

    for (let i = 0; i < tickers.length; i++) {
      const sym = tickers[i];
      const snap = sentSnaps.find((s: any) => s.symbol === sym);
      const market = snapshots[i];
      ctx.tickers.push({
        symbol: sym,
        last: market?.quote?.last ?? null,
        changePercent: market?.quote?.changePercent ?? null,
        sentimentLabel: snap?.sentimentLabel ?? null,
        sentimentScore: snap?.sentimentScore ?? null,
        whyItMatters: snap?.whyItMatters ?? null,
        market: market ?? null,
      });
    }
  }

  return ctx;
}

interface AskAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
}

function ruleBasedAnswer(question: string, intent: string, ctx: ContextBlock): AskAnswer {
  const t = ctx.tickers[0];
  if (intent === "news" && t) {
    const sent = t.sentimentLabel ?? "neutral";
    return {
      headline: `Recent ${t.symbol} sentiment is ${sent}.`,
      answer: t.whyItMatters
        ? `Based on recent headlines, ${t.symbol} sentiment is ${sent}. ${t.whyItMatters}`
        : `Sentiment for ${t.symbol} is currently ${sent}. Open Market Intel for the underlying headlines and a per-article breakdown.`,
      keyPoints: [
        `Sentiment label: ${sent}`,
        t.sentimentScore != null ? `Score: ${t.sentimentScore}` : "Score: unavailable",
        "Open Market Intel for the source articles.",
      ],
      riskNote: "Sentiment changes quickly. Confirm with the live chart and your own plan before acting.",
      confidence: "low",
    };
  }
  if (intent === "income") {
    return {
      headline: "Income Mode is the right starting point.",
      answer: "For monthly cash flow, the typical paths are covered calls (you own the stock and sell calls), cash-secured puts (collect premium with capital set aside), or defined-risk credit spreads. Income Mode lets you set capital, target premium, and constraints, then ranks candidates.",
      keyPoints: ["Covered calls require owning shares", "Cash-secured puts require capital", "Defined-risk spreads cap the loss"],
      riskNote: "Premium-selling caps upside and still carries downside exposure on the underlying.",
      confidence: "medium",
    };
  }
  if (intent === "growth") {
    return {
      headline: "Grow Mode walks you through a goal-based plan.",
      answer: "Tell us your starting capital, time horizon, and risk tolerance. The Strategy Agent ranks candidate scenarios with a probability grade, R/R, and a plain-English why. Every order is reviewed by you before it leaves InstaTrade™.",
      keyPoints: ["Set capital and goal", "Pick risk per trade", "Review every order before sending"],
      riskNote: "Past performance does not predict future results.",
      confidence: "medium",
    };
  }
  return {
    headline: "Here's where to look inside VCP Trader AI.",
    answer: "Use the Trade Builder to express a setup in plain English, the Opportunity Radar for ranked candidates, or Market Intel for news and sentiment. Every idea is software-generated analysis, not a recommendation.",
    keyPoints: ["Trade Builder for custom setups", "Opportunity Radar for ranked ideas", "Market Intel for news context"],
    riskNote: "All output is informational only — confirm with your own plan before trading.",
    confidence: "low",
  };
}

async function callOpenAi(
  question: string,
  ctx: ContextBlock,
  opts: { useReferenceLibrary?: boolean } = {},
): Promise<AskAnswer | null> {
  if (!isOpenAiConfigured()) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Pull curated reference answers (promoted from the admin Agent Test
    // Suite) that match this question. Skipped when called from the admin
    // test runner so promoted answers don't inflate benchmark scores.
    // Failure is non-fatal — the agent still answers normally.
    let referenceBlock = "";
    if (opts.useReferenceLibrary !== false) {
      try {
        const { buildReferencePromptBlock } = await import("../services/agent-reference-answers");
        referenceBlock = await buildReferencePromptBlock(question, 3);
      } catch (err) {
        console.warn("[ask] reference-answers lookup failed:", (err as Error).message);
      }
    }
    // Trim context for prompt: keep only top S/R levels and key indicator values to reduce tokens.
    const compact = {
      ...ctx,
      tickers: ctx.tickers.map((t) => ({
        symbol: t.symbol,
        last: t.last,
        changePercent: t.changePercent,
        sentimentLabel: t.sentimentLabel,
        sentimentScore: t.sentimentScore,
        whyItMatters: t.whyItMatters,
        provider: t.market?.provider ?? null,
        indicators: t.market?.indicators
          ? {
              trend: t.market.indicators.trend,
              sma20: t.market.indicators.sma20,
              sma50: t.market.indicators.sma50,
              sma200: t.market.indicators.sma200,
              ema9: t.market.indicators.ema9,
              ema21: t.market.indicators.ema21,
              rsi14: t.market.indicators.rsi14,
              macd: t.market.indicators.macd,
              bollinger: t.market.indicators.bollinger,
              atr14: t.market.indicators.atr14,
              vwapSession: t.market.indicators.vwapSession,
              volume: t.market.indicators.volume,
              supports: t.market.indicators.supportResistance.support,
              resistances: t.market.indicators.supportResistance.resistance,
            }
          : null,
      })),
    };
    const userContent = JSON.stringify({ question, context: compact });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(referenceBlock
          ? [{ role: "system" as const, content: referenceBlock }]
          : []),
        { role: "user", content: userContent },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const conf = String(parsed.confidence ?? "low").toLowerCase();
    return {
      headline: typeof parsed.headline === "string" && parsed.headline.trim() ? parsed.headline.trim().slice(0, 160) : "Here's what I found.",
      answer: typeof parsed.answer === "string" ? parsed.answer.trim().slice(0, 1800) : "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((x: any) => typeof x === "string").slice(0, 5) : [],
      riskNote: typeof parsed.riskNote === "string" ? parsed.riskNote.trim().slice(0, 280) : "All output is software-generated analysis — not investment advice.",
      confidence: conf === "high" ? "high" : conf === "medium" ? "medium" : "low",
    };
  } catch (err) {
    console.warn("[ask] openai call failed, falling back:", err);
    return null;
  }
}

// Programmatic entry point used by the admin Agent Test Suite. Runs the same
// classify → context → AI/rule-based answer pipeline as POST /api/ask without
// going through Express, so the test runner doesn't need a session cookie.
// Returns the flat answer payload (no broker enrichment / trade ticket — the
// test bank evaluates prose, not order tickets).
export async function askForAdminTest(
  question: string,
  userId: string,
): Promise<{ headline: string; answer: string; keyPoints: string[]; riskNote: string }> {
  const intent = classifyIntent(question);
  const tickers = extractTickers(question);
  const ctx = await buildContext(userId, question, intent, tickers);
  let answer = await callOpenAi(question, ctx, { useReferenceLibrary: false });
  if (!answer) answer = ruleBasedAnswer(question, intent, ctx);
  return {
    headline: answer.headline ?? "",
    answer: answer.answer ?? "",
    keyPoints: Array.isArray(answer.keyPoints) ? answer.keyPoints : [],
    riskNote: answer.riskNote ?? "",
  };
}

export function registerAskRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/ask", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Question is required (1-500 chars)." });
      }
      const { question } = parsed.data;
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const intent = classifyIntent(question);
      const tickers = extractTickers(question);
      const ctx = await buildContext(userId, question, intent, tickers);

      // Wheel / income / CSP / covered-call ask + a ticker → build a real
      // option ticket (strike, expiry, credit, max profit/loss) so the
      // response is actionable instead of generic prose.
      let tradeDetail: AskTradeDetail | null = null;
      // For directional debit asks (long_call/long_put/bull_call_spread/
      // bear_put_spread) we run a bias check so we can tell the user whether
      // the signals AGREE with their intent.
      type DirectionalKind = "long_call" | "long_put" | "bull_call_spread" | "bear_put_spread";
      let directionalBias: { direction: DirectionalKind; bias: "bullish" | "bearish" | "neutral"; biasReason: string } | null = null;
      try {
        const parsedPrompt = parsePrompt(question);
        const lower = question.toLowerCase();
        if (parsedPrompt.incomeIntent && tickers.length > 0) {
          const sym = tickers[0];
          const live = ctx.tickers.find((t) => t.symbol === sym)?.last ?? null;
          tradeDetail = buildIncomeTradeDetail(sym, live, parsedPrompt.incomeIntent);
        } else if (tickers.length > 0) {
          // Resolve which debit structure was asked for. Order: explicit spread
          // wording first (since "call spread" contains "call"), then
          // single-leg long-call/long-put, then the GENERIC "find me a good
          // option trade" pattern (resolved via bias the same way an
          // ambiguous "debit spread" is — bullish→long_call, bearish→long_put,
          // neutral→skip so we don't force a directional bet).
          const spreadAsk = detectSpreadIntent(lower);
          const dirAsk = !spreadAsk ? detectDirectionalOption(lower) : null;
          const genericAsk = !spreadAsk && !dirAsk ? detectGenericTradeAsk(lower) : false;
          if (spreadAsk || dirAsk || genericAsk) {
            const sym = tickers[0];
            const live = ctx.tickers.find((t) => t.symbol === sym)?.last ?? null;
            // Determine bias from the same scan engine the rest of the app
            // uses (price action + news + AI sentiment). This is what makes
            // the answer respect "if bullish/bearish" qualifiers AND resolves
            // ambiguous "debit spread" asks to bull-call vs bear-put.
            let biasMeta: { bias: "bullish" | "bearish" | "neutral"; biasReason: string } = {
              bias: "neutral",
              biasReason: `No clear directional signal on ${sym} right now from price action, news, or sentiment.`,
            };
            try {
              const biasResult: BestTradeForSymbolResult = await findBestTradesForSymbol(userId, sym);
              biasMeta = { bias: biasResult.bias, biasReason: biasResult.biasReason };
            } catch (err) {
              console.warn("[ask] directional bias check failed:", err);
            }

            // Resolve "debit_spread" (no direction in prompt) using the bias.
            // If the bias is neutral, default to bull-call so we still return
            // a concrete ticket — the alignment banner will flag it as speculative.
            // For a generic "find me an option trade" ask, map bias to
            // long_call/long_put. If the bias is neutral we DON'T force a
            // directional bet — fall through to plain prose with no ticket.
            let resolvedKind: DirectionalKind | null;
            if (spreadAsk === "debit_spread") {
              resolvedKind = biasMeta.bias === "bearish" ? "bear_put_spread" : "bull_call_spread";
            } else if (spreadAsk) {
              resolvedKind = spreadAsk;
            } else if (dirAsk) {
              resolvedKind = dirAsk;
            } else {
              // genericAsk path
              if (biasMeta.bias === "bullish") resolvedKind = "long_call";
              else if (biasMeta.bias === "bearish") resolvedKind = "long_put";
              else resolvedKind = null;
            }
            if (!resolvedKind) {
              // Neutral bias on a generic ask — skip ticket. Stash the bias
              // so the prose layer can still explain "no clear direction".
              directionalBias = null;
            } else {

            const requestedDte = extractRequestedDte(question);
            const td = resolvedKind === "bull_call_spread" || resolvedKind === "bear_put_spread"
              ? buildSpreadTradeDetail(sym, live, resolvedKind, requestedDte)
              : buildDirectionalTradeDetail(sym, live, resolvedKind, requestedDte);

            const wantBullish = resolvedKind === "long_call" || resolvedKind === "bull_call_spread";
            const matches = (wantBullish && biasMeta.bias === "bullish") || (!wantBullish && biasMeta.bias === "bearish");
            const contrary = (wantBullish && biasMeta.bias === "bearish") || (!wantBullish && biasMeta.bias === "bullish");
            const dirLabel = td.strategyLabel.toLowerCase();
            const oppositeLabel = wantBullish
              ? (resolvedKind === "long_call" ? "long put" : "bear put spread")
              : (resolvedKind === "long_put" ? "long call" : "bull call spread");
            td.signalAlignment = matches ? "aligned" : contrary ? "contrary" : "neutral";
            td.signalAlignmentNote = matches
              ? `Signals on ${sym} are ${biasMeta.bias} — they support a ${dirLabel}.`
              : contrary
                ? `Signals on ${sym} are ${biasMeta.bias} — the OPPOSITE of a ${dirLabel}. Consider a ${oppositeLabel} instead, or wait for the bias to shift.`
                : `Signals on ${sym} are neutral right now — a directional ${dirLabel} is speculative until the bias confirms.`;
            tradeDetail = td;
            directionalBias = { direction: resolvedKind, ...biasMeta };
            }
          }
        }
      } catch (err) {
        console.warn("[ask] trade detail build failed:", err);
      }

      // If the user has a connected broker, replace the synthetic premium/
      // delta estimates with real contract data pulled from their broker's
      // option chain. Falls through silently on failure so the synthetic
      // estimate is still returned (and flagged as "Estimated" in the UI).
      if (tradeDetail) {
        tradeDetail = await enrichTradeDetailFromBrokerChain(userId, tradeDetail);
      }

      // Best-trade intent. Two paths:
      //   1) A ticker is mentioned → run the per-symbol finder. It uses
      //      broker data + news + AI sentiment + built-in strategies to
      //      determine bias, then returns ONE best stock trade and ONE
      //      best defined-risk option trade.
      //   2) No ticker → fall back to a watchlist/universe scan and
      //      return the top defined-risk picks.
      let picks: BestTradePick[] = [];
      let bestTradeMeta: {
        scope: "symbol" | "universe";
        label: string;
        dataMode: "live" | "simulated" | "mixed";
        brokerConnected: boolean;
        bias?: "bullish" | "bearish" | "neutral";
        biasReason?: string;
        stockPick?: BestTradePick | null;
        optionPick?: BestTradePick | null;
      } | null = null;
      if (intent === "best-trade") {
        try {
          if (tickers.length > 0) {
            const sym = tickers[0];
            const result: BestTradeForSymbolResult = await findBestTradesForSymbol(userId, sym);
            const ordered: BestTradePick[] = [];
            if (result.stockPick) ordered.push(result.stockPick);
            if (result.optionPick) ordered.push(result.optionPick);
            picks = ordered;
            bestTradeMeta = {
              scope: "symbol",
              label: sym,
              dataMode: result.dataMode,
              brokerConnected: result.brokerConnected,
              bias: result.bias,
              biasReason: result.biasReason,
              stockPick: result.stockPick,
              optionPick: result.optionPick,
            };
          } else {
            const lower = question.toLowerCase();
            const hintedUniverse = detectUniverseHint(lower);
            const result = await findBestTrades(userId, {
              universe: hintedUniverse ?? "watchlist",
              limit: 3,
            });
            picks = result.picks;
            bestTradeMeta = {
              scope: "universe",
              label: result.universeLabel,
              dataMode: result.dataMode,
              brokerConnected: result.brokerConnected,
            };
          }
        } catch (err) {
          console.warn("[ask] best-trade scan failed:", err);
        }
      }

      let answer = await callOpenAi(question, ctx);
      const source: "openai" | "rule_based" = answer ? "openai" : "rule_based";
      if (!answer) answer = ruleBasedAnswer(question, intent, ctx);

      // For best-trade intent, override the headline/answer to reflect
      // the actual picks (or lack thereof).
      if (intent === "best-trade" && bestTradeMeta) {
        const dataLabel =
          bestTradeMeta.dataMode === "live"
            ? "live broker data"
            : bestTradeMeta.dataMode === "mixed"
              ? "a mix of live broker data and simulated examples"
              : "simulated examples";

        if (bestTradeMeta.scope === "symbol") {
          const sym = bestTradeMeta.label;
          const stock = bestTradeMeta.stockPick ?? null;
          const opt = bestTradeMeta.optionPick ?? null;
          const biasText = bestTradeMeta.bias ?? "neutral";
          if (stock || opt) {
            const parts: string[] = [];
            if (stock) {
              parts.push(
                `Best stock trade: ${stock.strategyLabel} (${stock.confidence}% confidence, R/R ${stock.rewardRisk.toFixed(2)}:1, max loss $${stock.maxLoss.toLocaleString()}).`,
              );
            }
            if (opt) {
              parts.push(
                `Best option trade: ${opt.strategyLabel} (${opt.confidence}% confidence, max loss $${opt.maxLoss.toLocaleString()}${opt.expiration ? `, expires ${opt.expiration}` : ""}).`,
              );
            }
            const top = stock ?? opt!;
            answer = {
              ...answer,
              headline: `${sym} looks ${biasText} — here are the best stock and option trades.`,
              answer: `Using ${dataLabel}, news headlines, and AI sentiment, ${sym} is reading ${biasText}. ${bestTradeMeta.biasReason ?? ""}\n\n${parts.join("\n")}\n\nReview both before acting — nothing is sent to your broker without your explicit approval.`,
              riskNote: top.mainRisk,
              confidence: top.confidence >= 80 ? "high" : top.confidence >= 65 ? "medium" : "low",
            };
          } else {
            answer = {
              ...answer,
              headline: `No qualifying trade on ${sym} right now.`,
              answer: `I scanned ${sym} using ${dataLabel} plus news and AI sentiment. The combined signals didn't produce a stock or defined-risk option setup that meets the minimum grade. Try again later or check the chart and news directly.`,
              confidence: "low",
            };
          }
        } else {
          // Universe scan (no specific ticker mentioned).
          const where = bestTradeMeta.label;
          if (picks.length > 0) {
            const top = picks[0];
            answer = {
              ...answer,
              headline: `Top defined-risk pick across ${where}: ${top.symbol} (${top.strategyLabel}, ${top.confidence}% confidence)`,
              answer: `Scanned ${where} using ${dataLabel} and ranked defined-risk candidates only (no naked long calls/puts). Top pick is ${top.symbol} — ${top.thesis} ${top.mainReason}\n\nAsk about a specific ticker (e.g. "Find a high-probability trade on NVDA") to get one stock + one option trade with bias analysis.`,
              riskNote: top.mainRisk,
              confidence: top.confidence >= 80 ? "high" : top.confidence >= 65 ? "medium" : "low",
            };
          } else {
            answer = {
              ...answer,
              headline: "No defined-risk picks meet the threshold right now.",
              answer: `I scanned ${where} for defined-risk setups (stocks with stops, debit spreads, covered calls, cash-secured puts) and nothing crossed the confidence floor. Try asking about a specific ticker (e.g. "best trade on AAPL").`,
              confidence: "low",
            };
          }
        }
      }

      // Directional debit ticket (long call / long put / bull-call or bear-put
      // spread) — override the AI prose with bias-aware language and concrete
      // strikes/debit.
      const isDirectionalDebit = tradeDetail
        && (tradeDetail.strategy === "long_call"
          || tradeDetail.strategy === "long_put"
          || tradeDetail.strategy === "bull_call_spread"
          || tradeDetail.strategy === "bear_put_spread");
      if (tradeDetail && isDirectionalDebit && directionalBias) {
        const td = tradeDetail;
        const isSpread = td.strategy === "bull_call_spread" || td.strategy === "bear_put_spread";
        const isBullishKind = td.strategy === "long_call" || td.strategy === "bull_call_spread";
        const wantWord = isBullishKind ? "bullish" : "bearish";
        const dirLabel = td.strategyLabel.toLowerCase();
        const sentenceData = td.dataMode === "live"
          ? `${td.symbol} is at $${td.spot.toFixed(2)}.`
          : `Using a simulated price baseline of $${td.spot.toFixed(2)} (no live quote available).`;
        const aligned = td.signalAlignment === "aligned";
        const contrary = td.signalAlignment === "contrary";
        const biasSentence = aligned
          ? `Signals on ${td.symbol} are reading ${directionalBias.bias} — that supports a ${dirLabel}. ${directionalBias.biasReason}`
          : contrary
            ? `Heads-up: signals on ${td.symbol} are reading ${directionalBias.bias} — the OPPOSITE of a ${dirLabel}. ${directionalBias.biasReason} I'm still showing the ${dirLabel} ticket below since you asked, but the current evidence does not back it.`
            : `Signals on ${td.symbol} are neutral right now — no clear ${wantWord} confirmation. ${directionalBias.biasReason} A ${dirLabel} here is speculative until the bias confirms.`;
        const planSentence = isSpread
          ? `Open 1× ${td.expiry} ${td.symbol} ${td.legsLabel} for about $${td.premiumPerShare.toFixed(2)} debit per share — roughly $${td.premiumPerContract.toFixed(0)} per contract. Max loss is the debit paid ($${td.maxLossPerContract.toFixed(0)} per contract). Max profit at expiry: $${td.maxProfitPerContract.toFixed(0)} per contract. Breakeven: $${td.breakeven.toFixed(2)}.`
          : `Buy 1× ${td.expiry} ${td.symbol} $${td.strike} ${td.optionType} for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} debit per contract. Max loss is the debit paid ($${td.maxLossPerContract.toFixed(0)} per contract). Breakeven at expiry: $${td.breakeven.toFixed(2)}.`;
        const headlineCore = isSpread
          ? `${td.strategyLabel.toLowerCase()} ${td.legsLabel ?? ""} expiring ${td.expiry}`
          : `buy the $${td.strike} ${td.optionType} expiring ${td.expiry}`;
        const headline = aligned
          ? `${td.symbol} looks ${directionalBias.bias} — ${headlineCore}`
          : contrary
            ? `${td.symbol} signals are ${directionalBias.bias} — a ${dirLabel} is contrary to the read`
            : `${td.symbol} bias is unclear — speculative ${dirLabel} ticket below`;
        answer = {
          ...answer,
          headline,
          answer: `${sentenceData}\n\n${biasSentence}\n\n${planSentence}`,
          keyPoints: [
            `Bias read: ${directionalBias.bias} (${td.signalAlignment === "aligned" ? "supports" : td.signalAlignment === "contrary" ? "contradicts" : "neutral on"} this ${dirLabel})`,
            isSpread
              ? `Legs: ${td.legsLabel}, expires ${td.expiry} (${td.dte} days)`
              : `Strike: $${td.strike} ${td.optionType} (~${Math.round(Math.abs(td.delta) * 100)} delta), expires ${td.expiry} (${td.dte} days)`,
            `Debit: ~$${td.premiumPerContract.toFixed(0)} per contract (also your max loss)`,
            isSpread
              ? `Max profit at expiry: $${td.maxProfitPerContract.toFixed(0)} per contract`
              : (td.strategy === "long_call" ? `Upside is uncapped above breakeven` : `Hard cap if stock → $0`),
            `Breakeven: $${td.breakeven.toFixed(2)}`,
          ],
          riskNote: isSpread
            ? `Defined-risk debit spread — max loss is the debit (~$${td.maxLossPerContract.toFixed(0)} per contract) if ${td.symbol} doesn't move in your favor by ${td.expiry}. Both legs lose time value; spreads cap upside in exchange for lower cost. Strikes/premium are approximate — confirm in your broker before sending.`
            : `Long ${td.optionType}s lose value to time decay every day. Max loss is the full debit (~$${td.maxLossPerContract.toFixed(0)} per contract) if ${td.symbol} doesn't move in your favor by ${td.expiry}. Strikes/premium are approximate — confirm in your broker before sending.`,
          confidence: aligned ? "medium" : "low",
        };
      } else if (tradeDetail) {
        // CSP / Covered-call (wheel) ticket — credit-collecting flow.
        const td = tradeDetail;
        const isCsp = td.strategy === "cash_secured_put";
        const verbAction = isCsp ? "Sell" : "Sell";
        const headline = isCsp
          ? `${td.symbol} wheel — sell the $${td.strike} put expiring ${td.expiry}`
          : `${td.symbol} wheel — sell the $${td.strike} call expiring ${td.expiry}`;
        const sentenceData = td.dataMode === "live"
          ? `${td.symbol} is at $${td.spot.toFixed(2)}.`
          : `Using a simulated price baseline of $${td.spot.toFixed(2)} (no live quote available).`;
        const sentencePlan = isCsp
          ? `${verbAction} 1× ${td.expiry} ${td.symbol} $${td.strike} put for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} credit per contract. Cash collateral required: about $${td.collateralPerContract.toFixed(0)}.`
          : `${verbAction} 1× ${td.expiry} ${td.symbol} $${td.strike} call against 100 shares you own for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} credit per contract.`;
        const sentenceOutcome = isCsp
          ? `If ${td.symbol} stays above $${td.strike} by expiry, you keep the $${td.premiumPerContract.toFixed(0)} premium. If it drops below, you're assigned 100 shares at $${td.strike} (effective cost basis ~$${td.breakeven.toFixed(2)}) — a typical wheel entry.`
          : `If ${td.symbol} stays below $${td.strike} by expiry, you keep the $${td.premiumPerContract.toFixed(0)} premium. If it closes above, your shares are called away at $${td.strike}.`;
        answer = {
          ...answer,
          headline,
          answer: `${sentenceData}\n\n${sentencePlan}\n\n${sentenceOutcome}`,
          keyPoints: [
            `Strike: $${td.strike} ${td.optionType} (~${Math.round(Math.abs(td.delta) * 100)} delta)`,
            `Expiry: ${td.expiry} (${td.dte} days)`,
            `Premium: ~$${td.premiumPerContract.toFixed(0)} per contract`,
            isCsp
              ? `Collateral: ~$${td.collateralPerContract.toFixed(0)} per contract`
              : `Max proceeds if assigned: ~$${(td.upsideCapPerContract ?? 0).toFixed(0)} per contract (capped at $${td.strike})`,
            `Breakeven: $${td.breakeven.toFixed(2)}`,
          ],
          riskNote: isCsp
            ? `If ${td.symbol} drops well below $${td.strike}, you're still obligated to buy at the strike. Max loss per contract is about $${td.maxLossPerContract.toFixed(0)} (stock to $0). Premium is approximate — confirm in your broker.`
            : `Premium offsets some downside but does not protect against a meaningful drop in the shares. Max loss per contract is about $${td.maxLossPerContract.toFixed(0)}. Premium is approximate — confirm in your broker.`,
          confidence: "medium",
        };
      }

      res.json({
        question,
        intent,
        tickers,
        brokerConnected: ctx.brokerConnected,
        ...answer,
        picks,
        tradeDetail,
        suggestions: suggestionsForIntent(intent, tickers),
        source,
        disclaimer: "Software-generated educational analysis — not investment advice. Confirm everything in your own broker before acting.",
      });
    } catch (err: any) {
      console.error("[POST /api/ask]", err);
      res.status(500).json({ error: "Failed to generate answer" });
    }
  });
}
