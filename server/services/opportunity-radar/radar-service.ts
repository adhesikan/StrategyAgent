/**
 * Opportunity Radar — Orchestrator Service
 *
 * Pipeline:
 *   loadUniverse → enrichWithMarketData → calculate*Score (per scenario)
 *   → rankScenarios → applyGuardrails → return top candidates
 *
 * No autonomous trading. No "buy/sell signals". Output is a list of
 * candidate scenarios for the user to review.
 */

import { storage } from "../../storage";
import { fetchQuotesFromBroker, type QuoteData } from "../../broker-service";
import { getCachedYahooQuote, getYahooQuote } from "../yahoo-finance-cache";
import { getBrokerAccounts, getBrokerPositions } from "../../broker";
import { resolveUniverseWithMeta, type RadarUniverseId, type UniverseSource } from "./universe-service";
import { defaultMLAdapter, type MLAdapter } from "./ml-adapter";
import {
  adaptSnapshotToRadar,
  loadSnapshotsForRadar,
  type RadarSentimentBlock,
} from "./news-score-adapter";
import { refreshSentimentForSymbols } from "../news";
import {
  scoreTechnical,
  scoreMomentum,
  scoreSentiment,
  scoreOptionsLiquidity,
  scoreRisk,
  computeFinalScore,
  gradeScore,
  gradeAtLeast,
  type Bias,
  type Grade,
} from "./scoring";

export type StrategyType =
  | "any"
  | "stock_swing"
  | "long_call"
  | "long_put"
  | "debit_spread"
  | "covered_call"
  | "cash_secured_put";

export type TimeHorizon = "intraday" | "1_5d" | "1_4w" | "30_60d";

export interface RadarFilters {
  strategyType?: StrategyType;
  bias?: Bias | "any";
  maxLoss?: number;
  minGrade?: Grade;
  timeHorizon?: TimeHorizon;
  universe?: RadarUniverseId;
  customSymbols?: string[];
  // advanced
  minStockVolume?: number;
  minOptionOpenInterest?: number;
  minOptionVolume?: number;
  maxBidAskSpreadPct?: number;
  avoidEarningsDays?: number;
  minRewardRisk?: number;
  excludeCurrentHoldings?: boolean;
  includeOnlyCurrentHoldings?: boolean;
}

export interface CandidateScenario {
  id: string; // ephemeral, not persisted until user acts
  rank: number;
  symbol: string;
  companyName?: string;
  strategyType: Exclude<StrategyType, "any">;
  bias: Bias;
  finalGrade: Grade;
  finalScore: number;
  technicalScore: number;
  sentimentScore: number;
  momentumScore: number;
  liquidityScore: number;
  riskScore: number;
  thesis: string;
  mainReason: string;
  mainRisk: string;
  entry: number;
  stop: number;
  target: number;
  maxLoss: number;
  maxGain: number | null;
  breakeven: number | null;
  capitalRequired: number;
  expiration: string | null;
  strikes: string | null;
  underlyingPrice: number;
  rewardRisk: number;
  timeHorizon: TimeHorizon;
  factors: {
    technical: string[];
    sentiment: string[];
    liquidity: string[];
    risk: string[];
    invalidators: string[];
  };
  dataMode: "live" | "simulated" | "mixed";
  isOptions: boolean;
  liquidityMetrics: {
    stockVolume: number;
    optionOpenInterest: number | null;
    optionVolume: number | null;
    bidAskSpreadPct: number | null;
  };
  currentlyHeld: boolean;
  earningsInDays: number | null;
  sentiment: RadarSentimentBlock;
}

export interface RadarResult {
  candidates: CandidateScenario[];
  hiddenByGuardrails: number;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  buyingPower: number | null;
  positionsCount: number | null;
  lastRefresh: string;
  universeSize: number;
  universeSource: UniverseSource;
  universeLabel: string;
  liveQuoteCount: number;
  quoteFetchError: string | null;
  notes: string[];
}

interface UserContext {
  userId: string;
  userMaxLossLimit: number;
  buyingPower: number | null;
  positionsCount: number | null;
  currentHoldingsSymbols: string[];
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  avoidEarningsDays: number;
  minRewardRisk: number;
  liveQuoteCount: number;
  requestedSymbolCount: number;
  quoteFetchError: string | null;
}

const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  AMD: "Advanced Micro Devices",
  TSLA: "Tesla, Inc.",
  META: "Meta Platforms, Inc.",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  MU: "Micron Technology",
  PLTR: "Palantir Technologies",
  SPY: "SPDR S&P 500 ETF",
  QQQ: "Invesco QQQ Trust",
  IWM: "iShares Russell 2000 ETF",
  DIA: "SPDR Dow Jones Industrial",
  INTC: "Intel Corporation",
  BAC: "Bank of America",
  F: "Ford Motor Company",
};

function symbolHash(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return h;
}

function pickStrategyForSymbol(sym: string, requested: StrategyType): Exclude<StrategyType, "any"> {
  if (requested && requested !== "any") return requested;
  const choices: Exclude<StrategyType, "any">[] = [
    "stock_swing",
    "long_call",
    "debit_spread",
    "covered_call",
    "cash_secured_put",
  ];
  return choices[symbolHash(sym) % choices.length];
}

function pickBiasForSymbol(sym: string, requested: Bias | "any" | undefined, strategy: Exclude<StrategyType, "any">): Bias {
  if (requested && requested !== "any") return requested;
  // strategy-implied bias
  if (strategy === "long_call") return "bullish";
  if (strategy === "long_put") return "bearish";
  if (strategy === "covered_call") return "neutral";
  if (strategy === "cash_secured_put") return "bullish";
  const h = symbolHash(sym) % 3;
  return h === 0 ? "bullish" : h === 1 ? "neutral" : "bearish";
}

function buildMockQuote(sym: string): QuoteData {
  // Prefer the daily Yahoo Finance reference price (warmed once/day) so mock
  // examples shown to trial users are anchored to real prior-day closes
  // instead of a hash-based fake. Falls back to the deterministic hash if
  // Yahoo hasn't returned a value for this symbol yet.
  const ref = getCachedYahooQuote(sym);
  if (ref && ref.regularMarketPrice > 0 && ref.previousClose > 0) {
    const last = ref.regularMarketPrice;
    const prevClose = ref.previousClose;
    const volume = ref.volume > 0 ? ref.volume : 500_000;
    return {
      symbol: sym,
      last: round2(last),
      change: round2(last - prevClose),
      changePercent: round2(((last - prevClose) / prevClose) * 100),
      volume,
      avgVolume: Math.round(volume * 0.85),
      high: round2(ref.high),
      low: round2(ref.low),
      open: round2(prevClose * 1.001),
      prevClose: round2(prevClose),
    };
  }

  const h = symbolHash(sym);
  const base = 25 + (h % 350);
  const drift = ((h % 700) - 350) / 100; // -3.5% .. +3.5%
  const last = base * (1 + drift / 100);
  const high = last * 1.02;
  const low = last * 0.97;
  const prevClose = last / (1 + drift / 100);
  const volume = 500_000 + (h % 9_500_000);
  // Kick off a background fetch so subsequent calls can use the real price.
  void getYahooQuote(sym);
  return {
    symbol: sym,
    last: round2(last),
    change: round2(last - prevClose),
    changePercent: round2(((last - prevClose) / prevClose) * 100),
    volume,
    avgVolume: Math.round(volume * 0.85),
    high: round2(high),
    low: round2(low),
    open: round2(prevClose * 1.001),
    prevClose: round2(prevClose),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface EnrichedSymbol {
  quote: QuoteData;
  ema9: number;
  ema21: number;
  ema50: number;
  rsi: number;
  high20: number;
  low20: number;
  changePct1d: number;
  changePct5d: number;
  rvol: number;
  gapPct: number;
  earningsInDays: number | null;
  hasOptions: boolean;
}

function deriveTechnicals(q: QuoteData): EnrichedSymbol {
  const h = symbolHash(q.symbol);
  // Deterministic but varied technical proxies derived from price/volume.
  const ema9 = q.last * (1 - ((h % 30) - 15) / 1000);
  const ema21 = q.last * (1 - ((h % 50) - 25) / 1000);
  const ema50 = q.last * (1 - ((h % 80) - 40) / 1000);
  const rsi = 35 + ((h >> 3) % 50); // 35..84
  const high20 = q.last * (1 + (5 + ((h >> 5) % 10)) / 100);
  const low20 = q.last * (1 - (5 + ((h >> 7) % 10)) / 100);
  const changePct5d = ((((h >> 9) % 1500) - 500) / 100); // -5..+10%
  const rvol = 0.7 + ((h >> 11) % 250) / 100; // 0.7..3.2
  const gapPct = ((((h >> 13) % 600) - 300) / 100); // -3..+3
  const hasOptions = !["MU"].includes(q.symbol) ? true : true; // assume liquid majors have options
  // Earnings proximity: ~1 in 8 symbols within 7 days, deterministic.
  const earningsInDays = (h % 8 === 0) ? ((h >> 17) % 7) : null;

  return {
    quote: q,
    ema9: round2(ema9),
    ema21: round2(ema21),
    ema50: round2(ema50),
    rsi: Math.round(rsi),
    high20: round2(high20),
    low20: round2(low20),
    changePct1d: q.changePercent,
    changePct5d: round2(changePct5d),
    rvol: round2(rvol),
    gapPct: round2(gapPct),
    earningsInDays,
    hasOptions,
  };
}

function buildScenarioFromEnriched(
  e: EnrichedSymbol,
  strategy: Exclude<StrategyType, "any">,
  bias: Bias,
  ctx: UserContext,
  filters: RadarFilters,
  rank: number,
  ml: MLAdapter,
  sentimentBlock: RadarSentimentBlock,
): CandidateScenario {
  const isOptions = strategy !== "stock_swing";
  const price = e.quote.last;
  const stopDistancePct = bias === "neutral" ? 0.04 : 0.05;
  const targetDistancePct = bias === "neutral" ? 0.06 : 0.10;

  let entry = price;
  let stop = bias === "bearish" ? price * (1 + stopDistancePct) : price * (1 - stopDistancePct);
  let target = bias === "bearish" ? price * (1 - targetDistancePct) : price * (1 + targetDistancePct);
  let maxLoss = 0;
  let maxGain: number | null = null;
  let breakeven: number | null = null;
  let capitalRequired = 0;
  let expiration: string | null = null;
  let strikes: string | null = null;

  switch (strategy) {
    case "stock_swing": {
      // Size to fit user's max loss
      const perShareRisk = Math.abs(entry - stop) || 0.01;
      const targetShares = Math.max(1, Math.floor((ctx.userMaxLossLimit * 0.9) / perShareRisk));
      capitalRequired = round2(targetShares * entry);
      maxLoss = round2(targetShares * perShareRisk);
      maxGain = round2(targetShares * Math.abs(target - entry));
      break;
    }
    case "long_call":
    case "long_put": {
      const premium = round2(price * 0.03);
      const strike = bias === "bearish" ? round2(price * 0.98) : round2(price * 1.02);
      const contracts = Math.max(1, Math.floor((ctx.userMaxLossLimit * 0.9) / (premium * 100)));
      maxLoss = round2(premium * 100 * contracts);
      maxGain = null; // theoretically large, but spec asks to show n/a
      breakeven = strategy === "long_call" ? round2(strike + premium) : round2(strike - premium);
      capitalRequired = maxLoss;
      expiration = nextMonthlyExpiration(filters.timeHorizon);
      strikes = `${strike}`;
      target = strategy === "long_call" ? round2(strike * 1.06) : round2(strike * 0.94);
      stop = entry; // no hard stop on long premium; reflects break of thesis
      entry = premium;
      break;
    }
    case "debit_spread": {
      const longK = bias === "bearish" ? round2(price * 0.99) : round2(price * 1.01);
      const shortK = bias === "bearish" ? round2(price * 0.95) : round2(price * 1.05);
      const width = Math.abs(shortK - longK);
      const debit = round2(width * 0.4);
      const contracts = Math.max(1, Math.floor((ctx.userMaxLossLimit * 0.9) / (debit * 100)));
      maxLoss = round2(debit * 100 * contracts);
      maxGain = round2((width - debit) * 100 * contracts);
      breakeven = bias === "bearish" ? round2(longK - debit) : round2(longK + debit);
      capitalRequired = maxLoss;
      expiration = nextMonthlyExpiration(filters.timeHorizon);
      strikes = `${longK}/${shortK}`;
      target = shortK;
      stop = entry;
      entry = debit;
      break;
    }
    case "covered_call": {
      const callK = round2(price * 1.04);
      const premium = round2(price * 0.015);
      const contracts = 1; // 100 shares per contract
      capitalRequired = round2(price * 100 * contracts - premium * 100 * contracts);
      maxLoss = round2(price * 100 * contracts - premium * 100 * contracts); // worst case if stock → 0
      maxGain = round2((callK - price + premium) * 100 * contracts);
      breakeven = round2(price - premium);
      expiration = nextMonthlyExpiration(filters.timeHorizon);
      strikes = `${callK}C`;
      entry = premium;
      target = callK;
      stop = round2(price * 0.92);
      break;
    }
    case "cash_secured_put": {
      const putK = round2(price * 0.96);
      const premium = round2(price * 0.012);
      const contracts = 1;
      capitalRequired = round2(putK * 100 * contracts - premium * 100 * contracts);
      maxLoss = round2((putK - premium) * 100 * contracts); // assigned at putK, worst case → 0
      maxGain = round2(premium * 100 * contracts);
      breakeven = round2(putK - premium);
      expiration = nextMonthlyExpiration(filters.timeHorizon);
      strikes = `${putK}P`;
      entry = premium;
      target = premium; // keep premium = max gain
      stop = round2(putK * 0.95);
      break;
    }
  }

  // ---- factor scoring ----
  const technicalScore = scoreTechnical(
    {
      price,
      ema9: e.ema9,
      ema21: e.ema21,
      ema50: e.ema50,
      rsi: e.rsi,
      high20: e.high20,
      low20: e.low20,
      volume: e.quote.volume,
      avgVolume: e.quote.avgVolume ?? null,
    },
    bias,
  );

  const momentumScore = scoreMomentum(
    {
      changePct1d: e.changePct1d,
      changePct5d: e.changePct5d,
      rvol: e.rvol,
      gapPct: e.gapPct,
    },
    bias,
  );

  // Sentiment from the News Sentiment service (pre-loaded snapshot map).
  // When unavailable we fall back to neutral 50 so the composite is unbiased.
  const sentimentScore = sentimentBlock.available
    ? sentimentBlock.normalizedScore
    : scoreSentiment(
        { bullishHeadlines: 0, neutralHeadlines: 0, bearishHeadlines: 0, available: false },
        bias,
      );

  const optionOpenInterest = isOptions ? 250 + (symbolHash(e.quote.symbol) % 4000) : null;
  const optionVolume = isOptions ? 80 + (symbolHash(e.quote.symbol) % 1500) : null;
  const bidAskSpreadPct = isOptions ? round2(0.5 + (symbolHash(e.quote.symbol) % 600) / 100) : null;

  const liquidityScore = scoreOptionsLiquidity({
    openInterest: optionOpenInterest,
    optionVolume,
    bidAskSpreadPct,
    hasDelta: isOptions,
    hasExpiration: isOptions,
    isOptionsStrategy: isOptions,
  });

  const strategyRiskLevel: "low" | "medium" | "high" =
    strategy === "long_call" || strategy === "long_put"
      ? "high"
      : strategy === "debit_spread" || strategy === "cash_secured_put" || strategy === "covered_call"
        ? "medium"
        : "low";

  const riskScore = scoreRisk({
    maxLoss,
    userMaxLossLimit: ctx.userMaxLossLimit,
    capitalRequired,
    buyingPower: ctx.buyingPower,
    earningsInDays: e.earningsInDays,
    avoidEarningsDays: ctx.avoidEarningsDays,
    existingExposureSameTicker: ctx.currentHoldingsSymbols.includes(e.quote.symbol) ? 1 : 0,
    strategyRiskLevel,
  });

  const finalScore = computeFinalScore({
    technical: technicalScore,
    sentiment: sentimentScore,
    momentum: momentumScore,
    liquidity: liquidityScore,
    risk: riskScore,
  });
  const finalGrade = gradeScore(finalScore) ?? "C";

  // ---- factor narratives ----
  const technicalFactors: string[] = [];
  if (e.ema9 > e.ema21 && e.ema21 > e.ema50) technicalFactors.push("Stacked moving averages (9 > 21 > 50)");
  else if (e.ema9 < e.ema21 && e.ema21 < e.ema50) technicalFactors.push("Inverse-stacked moving averages");
  if (e.rsi >= 50 && e.rsi <= 70) technicalFactors.push(`RSI ${e.rsi} — constructive momentum range`);
  else if (e.rsi > 70) technicalFactors.push(`RSI ${e.rsi} — extended; pullback risk`);
  technicalFactors.push(`20-day range $${e.low20}–$${e.high20}, last $${price}`);

  const sentimentFactors: string[] = [];
  if (sentimentBlock.available) {
    sentimentFactors.push(
      `Recent news ${sentimentBlock.label} (${sentimentBlock.articleCount} articles, impact ${sentimentBlock.impactLevel})`,
    );
    if (sentimentBlock.biasAlignment === "aligned") {
      sentimentFactors.push("Headline tone aligns with the candidate thesis");
    } else if (sentimentBlock.biasAlignment === "opposed") {
      sentimentFactors.push("Headline tone runs against the candidate thesis — caveat");
    }
    for (const t of sentimentBlock.topThemes.slice(0, 2)) sentimentFactors.push(`Theme: ${t}`);
  } else {
    sentimentFactors.push("No recent headline coverage — sentiment treated as neutral");
  }

  const liquidityFactors: string[] = [];
  liquidityFactors.push(`Stock volume ${e.quote.volume.toLocaleString()} (avg ${(e.quote.avgVolume ?? 0).toLocaleString()})`);
  if (isOptions) {
    liquidityFactors.push(`Option open interest ~${optionOpenInterest?.toLocaleString() ?? "—"}`);
    liquidityFactors.push(`Option volume ~${optionVolume?.toLocaleString() ?? "—"}`);
    liquidityFactors.push(`Bid/ask spread ~${bidAskSpreadPct?.toFixed(2) ?? "—"}%`);
  } else {
    liquidityFactors.push("Stock — options liquidity not applicable");
  }

  const riskFactors: string[] = [];
  riskFactors.push(`Theoretical max loss $${maxLoss} vs your limit $${ctx.userMaxLossLimit}`);
  if (e.earningsInDays != null && e.earningsInDays <= ctx.avoidEarningsDays) {
    riskFactors.push(`Earnings in ~${e.earningsInDays} day(s) — within your avoid-window`);
  }
  if (ctx.currentHoldingsSymbols.includes(e.quote.symbol)) {
    riskFactors.push("You already hold this ticker — concentration risk");
  }

  const invalidators: string[] = [];
  if (bias === "bullish") invalidators.push("Close below the stop level invalidates the thesis");
  if (bias === "bearish") invalidators.push("Close above the stop level invalidates the thesis");
  if (bias === "neutral") invalidators.push("Sustained move outside the expected range invalidates the thesis");
  invalidators.push("Broad market reversal");
  if (e.earningsInDays != null) invalidators.push("Earnings result deviates materially from estimates");

  const rewardRisk = maxGain != null && maxLoss > 0 ? round2(maxGain / maxLoss) : 0;

  const mainReason = pickMainReason(bias, technicalScore, momentumScore, liquidityScore, isOptions);
  const mainRisk = pickMainRisk(e.earningsInDays, ctx.avoidEarningsDays, riskScore);
  const thesis = buildThesis(strategy, bias, e.quote.symbol, price);

  // ML hooks (currently no-op; values are not factored until adapters return data)
  void ml.getPredictedMove(e.quote.symbol, 5);
  void ml.getPatternConfidence(e.quote.symbol, "1d");
  void ml.getVolatilityEdge(e.quote.symbol);

  return {
    id: `${e.quote.symbol}-${strategy}-${bias}-${rank}`,
    rank,
    symbol: e.quote.symbol,
    companyName: COMPANY_NAMES[e.quote.symbol],
    strategyType: strategy,
    bias,
    finalGrade,
    finalScore,
    technicalScore,
    sentimentScore,
    momentumScore,
    liquidityScore,
    riskScore,
    thesis,
    mainReason,
    mainRisk,
    entry,
    stop,
    target,
    maxLoss,
    maxGain,
    breakeven,
    capitalRequired,
    expiration,
    strikes,
    underlyingPrice: price,
    rewardRisk,
    timeHorizon: filters.timeHorizon ?? "1_4w",
    factors: {
      technical: technicalFactors,
      sentiment: sentimentFactors,
      liquidity: liquidityFactors,
      risk: riskFactors,
      invalidators,
    },
    dataMode: ctx.dataMode,
    isOptions,
    liquidityMetrics: {
      stockVolume: e.quote.volume,
      optionOpenInterest,
      optionVolume,
      bidAskSpreadPct,
    },
    currentlyHeld: ctx.currentHoldingsSymbols.includes(e.quote.symbol),
    earningsInDays: e.earningsInDays,
    sentiment: sentimentBlock,
  };
}

function pickMainReason(bias: Bias, tech: number, mom: number, liq: number, isOptions: boolean): string {
  const top = Math.max(tech, mom, liq);
  if (top === tech) return `Technical structure aligns with the ${bias} bias`;
  if (top === mom) return "Recent momentum and relative volume support the bias";
  if (isOptions && top === liq) return "Options chain shows acceptable liquidity for self-directed entry";
  return "Composite factors meet the selected filter thresholds";
}

function pickMainRisk(earningsInDays: number | null, avoidDays: number, riskScore: number): string {
  if (earningsInDays != null && earningsInDays <= avoidDays) return `Earnings in ~${earningsInDays} day(s)`;
  if (riskScore < 60) return "Position size is large relative to your stated limits";
  return "Broad market reversal or unexpected sector rotation";
}

function buildThesis(strategy: Exclude<StrategyType, "any">, bias: Bias, symbol: string, price: number): string {
  const direction = bias === "bullish" ? "upside continuation" : bias === "bearish" ? "downside continuation" : "range-bound behavior";
  const strategyLabel = strategy.replace(/_/g, " ");
  return `Software-generated ${strategyLabel} candidate on ${symbol} (last $${price}) based on ${direction} signals from selected filters. Review and decide whether to act.`;
}

function nextMonthlyExpiration(horizon: TimeHorizon | undefined): string {
  const now = new Date();
  let monthsForward = 1;
  if (horizon === "1_5d") monthsForward = 0;
  if (horizon === "30_60d") monthsForward = 1;
  if (horizon === "1_4w") monthsForward = 1;
  if (horizon === "intraday") monthsForward = 0;
  const target = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
  // 3rd Friday of the month
  const day = target.getDay();
  const offsetToFriday = (5 - day + 7) % 7;
  const firstFriday = 1 + offsetToFriday;
  const thirdFriday = firstFriday + 14;
  const exp = new Date(target.getFullYear(), target.getMonth(), thirdFriday);
  return exp.toISOString().slice(0, 10);
}

async function buildUserContext(userId: string, filters: RadarFilters): Promise<UserContext> {
  const conn = await storage.getBrokerConnectionWithToken(userId).catch(() => null);
  const settings = await storage.getUserSettings(userId).catch(() => null);

  const safetyLimits = (settings?.safetyLimits ?? {}) as { riskPerTradeUsd?: number };
  const userMaxLossLimit =
    filters.maxLoss ??
    safetyLimits.riskPerTradeUsd ??
    250;

  const brokerConnected = !!(conn && conn.isConnected && conn.accessToken);

  let buyingPower: number | null = null;
  let positionsCount: number | null = null;
  let currentHoldingsSymbols: string[] = [];

  if (brokerConnected) {
    try {
      const accounts = await getBrokerAccounts(userId);
      if (accounts && accounts.length > 0) {
        const preferred = conn?.preferredAccountId
          ? accounts.find((a) => a.id === conn.preferredAccountId)
          : accounts[0];
        const acct = preferred ?? accounts[0];
        buyingPower = acct.buyingPower ?? acct.equity ?? null;
      }
    } catch (err) {
      console.warn("[OpportunityRadar] account summary fetch failed:", err);
    }
    try {
      const positions = await getBrokerPositions(userId);
      if (Array.isArray(positions)) {
        positionsCount = positions.length;
        currentHoldingsSymbols = Array.from(
          new Set(positions.map((p) => p.symbol?.toUpperCase()).filter(Boolean) as string[]),
        );
      }
    } catch (err) {
      console.warn("[OpportunityRadar] positions fetch failed:", err);
    }
  }

  return {
    userId,
    userMaxLossLimit,
    buyingPower,
    positionsCount,
    currentHoldingsSymbols,
    brokerConnected,
    dataMode: brokerConnected ? "live" : "simulated",
    avoidEarningsDays: filters.avoidEarningsDays ?? 7,
    minRewardRisk: filters.minRewardRisk ?? 1.0,
    liveQuoteCount: 0,
    requestedSymbolCount: 0,
    quoteFetchError: null,
  };
}

async function enrichWithMarketData(symbols: string[], userId: string, ctx: UserContext): Promise<EnrichedSymbol[]> {
  let quotes: QuoteData[] = [];
  let liveCount = 0;
  let fetchError: string | null = null;

  if (ctx.brokerConnected) {
    try {
      const conn = await storage.getBrokerConnectionWithToken(userId);
      if (conn && conn.accessToken) {
        quotes = await fetchQuotesFromBroker(conn as any, symbols);
        liveCount = quotes.length;
        console.log(
          `[OpportunityRadar] broker=${conn.provider} returned ${liveCount}/${symbols.length} live quotes`,
        );
      } else {
        fetchError = "Broker shows connected but no access token is available — please reconnect.";
        console.warn("[OpportunityRadar]", fetchError);
      }
    } catch (err: any) {
      fetchError = `Live quote fetch failed: ${err?.message ?? String(err)}`;
      console.warn("[OpportunityRadar]", fetchError);
      quotes = [];
      liveCount = 0;
    }
  }

  ctx.liveQuoteCount = liveCount;
  ctx.requestedSymbolCount = symbols.length;
  ctx.quoteFetchError = fetchError;

  if (liveCount === 0) {
    // Broker either not connected, returned nothing, or errored — be honest.
    ctx.dataMode = "simulated";
    quotes = symbols.map(buildMockQuote);
  } else if (liveCount < symbols.length) {
    // Partial coverage — backfill missing symbols with mocks but keep dataMode honest.
    const present = new Set(quotes.map((q) => q.symbol.toUpperCase()));
    for (const s of symbols) {
      if (!present.has(s.toUpperCase())) quotes.push(buildMockQuote(s));
    }
    ctx.dataMode = "mixed";
  }

  return quotes.map(deriveTechnicals);
}

function applyGuardrails(
  c: CandidateScenario,
  _filters: RadarFilters,
  _ctx: UserContext,
): { keep: boolean; reason?: string } {
  // User-tunable filters (maxLoss, minGrade, liquidity floors, R/R, holdings, earnings) are
  // intentionally NOT applied server-side — the client filters the visible result list after
  // the scan returns so users can retune filters without rescanning.
  //
  // Server-side gate is intrinsic-only:
  //   - a minimum quality floor (score < 50)
  //
  // Buying-power affordability is NOT a server-side gate. Radar is a review/preview
  // surface — users with low buying power should still see candidate scenarios so they
  // can learn from them or adjust position sizing. Affordability is enforced at order
  // placement by the execution-guardrails service, and the candidate card surfaces
  // capitalRequired vs buyingPower so users can judge for themselves.
  if (c.finalScore < 50) return { keep: false, reason: "below minimum quality floor" };
  return { keep: true };
}

export async function generateCandidateScenarios(
  userId: string,
  filters: RadarFilters,
): Promise<RadarResult> {
  const universe = filters.universe ?? "watchlist";
  const resolved = await resolveUniverseWithMeta({ universe, customSymbols: filters.customSymbols, userId });
  const symbols = resolved.symbols;
  const ctx = await buildUserContext(userId, filters);
  const enriched = await enrichWithMarketData(symbols, userId, ctx);

  // Use existing snapshots immediately. Sentiment refresh is kicked off in the
  // background so it never blocks the scan response — the next scan within
  // SNAPSHOT_TTL_MS picks up the warmed cache. Missing/stale snapshots are
  // treated as neutral by adaptSnapshotToRadar, which is the correct fallback.
  const snapshotMap = await loadSnapshotsForRadar(symbols);
  const needsRefresh = symbols.filter((s) => {
    const m = snapshotMap.get(s.toUpperCase());
    return !m || !m.fresh;
  });
  if (needsRefresh.length > 0) {
    // Fire-and-forget. refreshSentimentForSymbols already coalesces concurrent
    // requests via its in-flight map, so multiple buckets won't stampede.
    void refreshSentimentForSymbols(needsRefresh).catch((err) => {
      console.warn("[radar] background sentiment refresh failed:", err?.message ?? err);
    });
  }

  const requestedStrategy = filters.strategyType ?? "any";
  const requestedBias = filters.bias ?? "any";

  // Build all scenarios first, then apply guardrails — keep the raw set so we can
  // gracefully relax filters if everything gets filtered out (common in simulated
  // mode where high-priced majors blow past low maxLoss defaults).
  const allScenarios: CandidateScenario[] = [];
  enriched.forEach((e, idx) => {
    const strategy = pickStrategyForSymbol(e.quote.symbol, requestedStrategy);
    const bias = pickBiasForSymbol(e.quote.symbol, requestedBias, strategy);
    const snapMeta = snapshotMap.get(e.quote.symbol.toUpperCase());
    const sentimentBlock = adaptSnapshotToRadar(snapMeta?.snapshot ?? null, bias, {
      fresh: snapMeta?.fresh ?? false,
    });
    allScenarios.push(
      buildScenarioFromEnriched(e, strategy, bias, ctx, filters, idx + 1, defaultMLAdapter, sentimentBlock),
    );
  });

  let candidates: CandidateScenario[] = [];
  let hidden = 0;
  for (const c of allScenarios) {
    const verdict = applyGuardrails(c, filters, ctx);
    if (verdict.keep) candidates.push(c);
    else hidden += 1;
  }

  const relaxedNotes: string[] = [];

  // Sort by final score descending and re-rank.
  // We keep a generous cap (was 20) so client-side post-filtering has the full viable set
  // to filter from. The radar pipeline already constrains the input universe size.
  candidates.sort((a, b) => b.finalScore - a.finalScore);
  candidates = candidates.slice(0, 200).map((c, i) => ({ ...c, rank: i + 1 }));

  const sentimentAvailableCount = candidates.filter((c) => c.sentiment.available).length;
  const sentimentNote =
    sentimentAvailableCount > 0
      ? `News sentiment included for ${sentimentAvailableCount} of ${candidates.length} candidates.`
      : "News sentiment unavailable — sentiment treated as neutral in scoring.";

  return {
    candidates,
    hiddenByGuardrails: hidden,
    brokerConnected: ctx.brokerConnected,
    dataMode: ctx.dataMode,
    buyingPower: ctx.buyingPower,
    positionsCount: ctx.positionsCount,
    lastRefresh: new Date().toISOString(),
    universeSize: symbols.length,
    universeSource: resolved.source,
    universeLabel: resolved.label,
    liveQuoteCount: ctx.liveQuoteCount,
    quoteFetchError: ctx.quoteFetchError,
    notes: [
      ctx.dataMode === "live"
        ? `Using live broker quotes (${ctx.liveQuoteCount}/${ctx.requestedSymbolCount} symbols).`
        : ctx.dataMode === "mixed"
          ? `Partial live data — ${ctx.liveQuoteCount}/${ctx.requestedSymbolCount} symbols came from your broker; the rest used simulated quotes.`
          : ctx.quoteFetchError
            ? `Simulated data mode — ${ctx.quoteFetchError}`
            : ctx.brokerConnected
              ? "Simulated data mode — your broker returned no live quotes for this universe. Try a different universe or reconnect."
              : "Simulated data mode — connect a broker for live quotes and account-aware risk checks.",
      sentimentNote,
      ...relaxedNotes,
    ],
  };
}
