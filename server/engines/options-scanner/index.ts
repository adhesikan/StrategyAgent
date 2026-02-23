import {
  tradierGetBatchQuotes,
  tradierGetOptionExpirations,
  tradierGetOptionChain,
  type StockQuote,
  type OptionChainContract,
} from "../../broker/providers/tradier";
import {
  tsGetBatchQuotes,
  tsGetOptionExpirations,
  tsGetOptionChain,
} from "../../broker/providers/tradestation";

export type OptionsProvider = "tradier" | "tradestation";

interface ProviderFunctions {
  getBatchQuotes: (token: string, symbols: string[]) => Promise<Map<string, StockQuote>>;
  getOptionExpirations: (token: string, symbol: string) => Promise<string[]>;
  getOptionChain: (token: string, symbol: string, expiration: string) => Promise<OptionChainContract[]>;
}

function getProviderFunctions(provider: OptionsProvider): ProviderFunctions {
  switch (provider) {
    case "tradestation":
      return {
        getBatchQuotes: tsGetBatchQuotes,
        getOptionExpirations: tsGetOptionExpirations,
        getOptionChain: tsGetOptionChain,
      };
    case "tradier":
    default:
      return {
        getBatchQuotes: tradierGetBatchQuotes,
        getOptionExpirations: tradierGetOptionExpirations,
        getOptionChain: tradierGetOptionChain,
      };
  }
}

export interface ScanPreferences {
  dteMin: number;
  dteMax: number;
  deltaMin: number;
  deltaMax: number;
  minPremiumPct: number;
}

export interface OptionsScanRequest {
  universeId: string;
  strategyKey: string;
  symbols: string[];
  riskSettings?: RiskSettings;
  scanPreferences?: ScanPreferences;
  provider?: OptionsProvider;
}

export interface RiskSettings {
  deltaMin: number;
  deltaMax: number;
  minPremiumPct: number;
  vixPause: number;
  lossCutoffMult: number;
  protectionsEnabled: boolean;
  guardrails: Record<string, unknown>;
}

export interface OptionLeg {
  side: "buy" | "sell";
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  theta: number;
  impliedVol: number;
  openInterest: number;
  volume: number;
}

export interface OptionCandidate {
  rank: number;
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  strategyVariant: string;
  strategy: string;
  bid: number;
  ask: number;
  mid: number;
  impliedVol: number;
  delta: number;
  theta: number;
  openInterest: number;
  volume: number;
  score: number;
  rationale: string;
  dte: number;
  premiumPct: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  legs: OptionLeg[];
  pop: number;
  stockPrice: number;
}

export interface OptionsScanResult {
  strategyKey: string;
  universeId: string;
  scannedAt: string;
  candidateCount: number;
  candidates: OptionCandidate[];
}

export const STRATEGY_DEFINITIONS = [
  { key: "long-options", label: "Long Options", description: "Buy calls when you think a stock will go up, or puts when you think it will go down. Simple and straightforward." },
  { key: "wheel", label: "Wheel Strategy", description: "Get paid to wait for stocks you want to buy at a lower price. If assigned, sell calls to earn more income." },
  { key: "credit-spreads", label: "Credit Spreads", description: "Collect premium by selling spreads. You profit when the stock stays in your expected range." },
] as const;

const DEFAULT_SCAN_PREFS: ScanPreferences = {
  dteMin: 14,
  dteMax: 45,
  deltaMin: 0.15,
  deltaMax: 0.35,
  minPremiumPct: 0.5,
};

function screenStockScore(q: StockQuote): number {
  let score = 0;

  if (q.changePercent > 0) score += Math.min(q.changePercent * 3, 15);
  if (q.changePercent < -3) score -= 10;

  if (q.avgVolume > 0 && q.volume > 0) {
    const rvol = q.volume / q.avgVolume;
    if (rvol >= 1.5) score += 15;
    else if (rvol >= 1.0) score += 8;
    else if (rvol < 0.5) score -= 5;
  }

  if (q.avgVolume >= 500000) score += 10;
  else if (q.avgVolume >= 100000) score += 5;

  if (q.high > 0 && q.prevClose > 0) {
    const rangeFromHigh = ((q.high - q.last) / q.high) * 100;
    if (rangeFromHigh < 2) score += 10;
    else if (rangeFromHigh < 5) score += 5;
  }

  if (q.last > q.open && q.open > 0) score += 5;

  if (q.prevClose > 0 && q.last > q.prevClose) score += 5;

  return score;
}

export async function runOptionsScan(
  request: OptionsScanRequest,
  brokerAccessToken?: string,
): Promise<OptionsScanResult> {
  const { symbols, strategyKey } = request;
  const prefs = { ...DEFAULT_SCAN_PREFS, ...request.scanPreferences };

  const emptyResult: OptionsScanResult = {
    strategyKey: request.strategyKey,
    universeId: request.universeId,
    scannedAt: new Date().toISOString(),
    candidateCount: 0,
    candidates: [],
  };

  if (!brokerAccessToken) {
    console.warn("[OptionsScanner] No broker token provided, returning empty results");
    return emptyResult;
  }

  const providerName = request.provider || "tradier";
  const fns = getProviderFunctions(providerName);

  console.log(`[OptionsScanner] Fetching quotes for ${symbols.length} symbols via ${providerName}...`);
  const quotes = await fns.getBatchQuotes(brokerAccessToken, symbols);
  console.log(`[OptionsScanner] Got ${quotes.size} quotes`);

  const validSymbols = symbols.filter(s => {
    const q = quotes.get(s);
    return q && q.last > 0;
  });

  if (validSymbols.length === 0) {
    console.warn("[OptionsScanner] No valid stock quotes returned from broker");
    return emptyResult;
  }

  const maxSymbols = Math.min(validSymbols.length, 30);
  let selectedSymbols: string[];
  if (validSymbols.length <= maxSymbols) {
    selectedSymbols = validSymbols;
  } else {
    const scored = validSymbols.map(s => {
      const q = quotes.get(s)!;
      return { symbol: s, score: screenStockScore(q) };
    });
    scored.sort((a, b) => b.score - a.score);
    selectedSymbols = scored.slice(0, maxSymbols).map(s => s.symbol);
    console.log(`[OptionsScanner] Pre-screened top ${maxSymbols} stocks from ${validSymbols.length} (top: ${selectedSymbols.slice(0, 5).join(", ")})`);
  }

  console.log(`[OptionsScanner] Fetching option chains for ${selectedSymbols.length} symbols via ${providerName}...`);
  const chainData = new Map<string, { expirations: string[]; chains: Map<string, OptionChainContract[]> }>();

  const chainPromises = selectedSymbols.map(async (symbol) => {
    try {
      const allExps = await fns.getOptionExpirations(brokerAccessToken, symbol);
      if (allExps.length === 0) return;

      const now = Date.now();
      const minDate = new Date(now + prefs.dteMin * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const maxDate = new Date(now + prefs.dteMax * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const filteredExps = allExps.filter(e => e >= minDate && e <= maxDate);

      if (filteredExps.length === 0) return;

      const chains = new Map<string, OptionChainContract[]>();
      const expsToFetch = filteredExps.length <= 3
        ? filteredExps
        : [filteredExps[0], filteredExps[Math.floor(filteredExps.length / 2)], filteredExps[filteredExps.length - 1]];

      for (const exp of expsToFetch) {
        const chain = await fns.getOptionChain(brokerAccessToken, symbol, exp);
        if (chain.length > 0) {
          chains.set(exp, chain);
        }
      }

      if (chains.size > 0) {
        chainData.set(symbol, { expirations: filteredExps, chains });
      }
    } catch (e) {
      console.warn(`[OptionsScanner] Skipping ${symbol}: ${(e as Error).message}`);
    }
  });

  await Promise.all(chainPromises);
  console.log(`[OptionsScanner] Got chain data for ${chainData.size} symbols`);

  let candidates: OptionCandidate[];

  switch (strategyKey) {
    case "wheel":
      candidates = buildWheelCandidates(quotes, chainData, prefs);
      break;
    case "credit-spreads":
      candidates = buildCreditSpreadCandidates(quotes, chainData, prefs);
      break;
    case "long-options":
    default:
      candidates = buildLongOptionCandidates(quotes, chainData, prefs);
      break;
  }

  candidates.sort((a, b) => b.score - a.score);

  const bestPerStock = new Map<string, OptionCandidate>();
  for (const c of candidates) {
    if (!bestPerStock.has(c.underlying)) {
      bestPerStock.set(c.underlying, c);
    }
  }
  candidates = Array.from(bestPerStock.values());

  candidates.forEach((c, i) => (c.rank = i + 1));

  return {
    strategyKey: request.strategyKey,
    universeId: request.universeId,
    scannedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
}

function calcDte(expiration: string): number {
  return Math.round((new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function estimatePop(delta: number, strategyType: "long" | "credit"): number {
  const absDelta = Math.abs(delta);
  if (strategyType === "credit") {
    return Math.round((1 - absDelta) * 100);
  }
  return Math.round(absDelta * 100);
}

function scoreCandidate(opts: {
  premiumPct: number;
  pop: number;
  volume: number;
  openInterest: number;
  iv: number;
  absDelta: number;
  deltaMin: number;
  deltaMax: number;
  isCall: boolean;
  stockChangePct: number;
  stockNearHigh: boolean;
}): number {
  let score = 50;
  score += Math.min(opts.premiumPct * 5, 20);
  score += (opts.pop / 100) * 15;
  if (opts.volume > 100) score += 5;
  if (opts.openInterest > 500) score += 5;
  if (opts.iv > 0.3 && opts.iv < 0.8) score += 5;
  if (opts.absDelta >= opts.deltaMin && opts.absDelta <= opts.deltaMax) score += 5;

  const bullish = opts.stockChangePct > 0;
  const directionAligned = (opts.isCall && bullish) || (!opts.isCall && !bullish);
  if (directionAligned) {
    score += 10;
  } else {
    score -= 15;
  }
  if (opts.isCall && opts.stockNearHigh) score += 5;
  if (!opts.isCall && opts.stockChangePct < -1) score += 5;

  return r2(Math.max(0, Math.min(score, 100)));
}

function buildLongOptionCandidates(
  quotes: Map<string, StockQuote>,
  chainData: Map<string, { expirations: string[]; chains: Map<string, OptionChainContract[]> }>,
  prefs: ScanPreferences,
): OptionCandidate[] {
  const candidates: OptionCandidate[] = [];

  for (const entry of Array.from(chainData.entries())) {
    const symbol = entry[0];
    const data = entry[1];
    const quote = quotes.get(symbol);
    if (!quote) continue;
    const stockPrice = quote.last;

    for (const chainEntry of Array.from(data.chains.entries())) {
      const expiration = chainEntry[0];
      const chain = chainEntry[1];
      const dte = calcDte(expiration);

      const otmCalls = chain.filter((c: OptionChainContract) =>
        c.optionType === "call" &&
        c.strike > stockPrice &&
        c.bid > 0 &&
        c.greeks &&
        Math.abs(c.greeks.delta) >= prefs.deltaMin &&
        Math.abs(c.greeks.delta) <= prefs.deltaMax
      );

      const otmPuts = chain.filter((c: OptionChainContract) =>
        c.optionType === "put" &&
        c.strike < stockPrice &&
        c.bid > 0 &&
        c.greeks &&
        Math.abs(c.greeks.delta) >= prefs.deltaMin &&
        Math.abs(c.greeks.delta) <= prefs.deltaMax
      );

      const bestCall = otmCalls.sort((a: OptionChainContract, b: OptionChainContract) => Math.abs(Math.abs(a.greeks!.delta) - 0.3) - Math.abs(Math.abs(b.greeks!.delta) - 0.3))[0];
      const bestPut = otmPuts.sort((a: OptionChainContract, b: OptionChainContract) => Math.abs(Math.abs(a.greeks!.delta) - 0.3) - Math.abs(Math.abs(b.greeks!.delta) - 0.3))[0];

      const contenders: { contract: OptionChainContract; score: number; candidate: OptionCandidate }[] = [];
      for (const contract of [bestCall, bestPut].filter(Boolean) as OptionChainContract[]) {
        const isCall = contract.optionType === "call";
        const mid = r2((contract.bid + contract.ask) / 2);
        if (mid <= 0) continue;
        const premiumPct = r2((mid / stockPrice) * 100);
        if (premiumPct < prefs.minPremiumPct) continue;

        const delta = contract.greeks?.delta ?? 0;
        const theta = contract.greeks?.theta ?? 0;
        const iv = contract.greeks?.mid_iv ?? 0;

        const maxLoss = Math.round(mid * 100);
        const maxProfit = isCall ? -1 : Math.round((contract.strike - mid) * 100);
        const breakeven = isCall ? r2(contract.strike + mid) : r2(contract.strike - mid);
        const pop = estimatePop(delta, "long");

        const leg: OptionLeg = {
          side: "buy",
          optionType: contract.optionType,
          strike: contract.strike,
          expiration,
          bid: contract.bid,
          ask: contract.ask,
          mid,
          delta: r2(delta),
          theta: r2(theta),
          impliedVol: r2(iv * 100),
          openInterest: contract.openInterest,
          volume: contract.volume,
        };

        const ivPct = Math.round(iv * 100);
        const rationale = `${symbol} at $${stockPrice.toFixed(2)} — ${ivPct}% IV. ${isCall ? "Bullish" : "Bearish"} setup with ${dte}-day expiry. Defined risk at $${mid.toFixed(2)} per contract.`;

        const stockNearHigh = quote.high > 0 && ((quote.high - quote.last) / quote.high) * 100 < 3;
        const s = scoreCandidate({
          premiumPct,
          pop,
          volume: contract.volume,
          openInterest: contract.openInterest,
          iv,
          absDelta: Math.abs(delta),
          deltaMin: prefs.deltaMin,
          deltaMax: prefs.deltaMax,
          isCall,
          stockChangePct: quote.changePercent,
          stockNearHigh,
        });

        contenders.push({ contract, score: s, candidate: {
          rank: 0,
          symbol: contract.symbol,
          underlying: symbol,
          expiration,
          strike: contract.strike,
          optionType: contract.optionType,
          strategyVariant: isCall ? "Long Call" : "Long Put",
          strategy: "long-options",
          bid: contract.bid,
          ask: contract.ask,
          mid,
          impliedVol: r2(iv * 100),
          delta: r2(delta),
          theta: r2(theta),
          openInterest: contract.openInterest,
          volume: contract.volume,
          score: s,
          rationale,
          dte,
          premiumPct,
          maxProfit,
          maxLoss,
          breakeven,
          legs: [leg],
          pop,
          stockPrice: r2(stockPrice),
        }});
      }

      if (contenders.length > 0) {
        contenders.sort((a, b) => b.score - a.score);
        candidates.push(contenders[0].candidate);
      }
    }
  }

  return candidates;
}

function buildWheelCandidates(
  quotes: Map<string, StockQuote>,
  chainData: Map<string, { expirations: string[]; chains: Map<string, OptionChainContract[]> }>,
  prefs: ScanPreferences,
): OptionCandidate[] {
  const candidates: OptionCandidate[] = [];

  for (const entry of Array.from(chainData.entries())) {
    const symbol = entry[0];
    const data = entry[1];
    const quote = quotes.get(symbol);
    if (!quote) continue;
    const stockPrice = quote.last;

    for (const chainEntry of Array.from(data.chains.entries())) {
      const expiration = chainEntry[0];
      const chain = chainEntry[1];
      const dte = calcDte(expiration);

      const otmPuts = chain.filter((c: OptionChainContract) =>
        c.optionType === "put" &&
        c.strike < stockPrice &&
        c.bid > 0.05 &&
        c.greeks &&
        Math.abs(c.greeks.delta) >= prefs.deltaMin &&
        Math.abs(c.greeks.delta) <= prefs.deltaMax
      );

      const otmCalls = chain.filter((c: OptionChainContract) =>
        c.optionType === "call" &&
        c.strike > stockPrice &&
        c.bid > 0.05 &&
        c.greeks &&
        Math.abs(c.greeks.delta) >= prefs.deltaMin &&
        Math.abs(c.greeks.delta) <= prefs.deltaMax
      );

      const bestPut = otmPuts.sort((a: OptionChainContract, b: OptionChainContract) => b.bid - a.bid)[0];
      const bestCall = otmCalls.sort((a: OptionChainContract, b: OptionChainContract) => b.bid - a.bid)[0];

      if (bestPut) {
        const mid = r2((bestPut.bid + bestPut.ask) / 2);
        const premiumPct = r2((mid / stockPrice) * 100);
        if (premiumPct >= prefs.minPremiumPct) {
          const delta = bestPut.greeks?.delta ?? 0;
          const theta = bestPut.greeks?.theta ?? 0;
          const iv = bestPut.greeks?.mid_iv ?? 0;
          const maxProfit = Math.round(mid * 100);
          const maxLoss = Math.round((bestPut.strike - mid) * 100);
          const breakeven = r2(bestPut.strike - mid);
          const pop = estimatePop(delta, "credit");

          const leg: OptionLeg = {
            side: "sell", optionType: "put", strike: bestPut.strike, expiration,
            bid: bestPut.bid, ask: bestPut.ask, mid,
            delta: r2(delta), theta: r2(theta), impliedVol: r2(iv * 100),
            openInterest: bestPut.openInterest, volume: bestPut.volume,
          };

          candidates.push({
            rank: 0,
            symbol: bestPut.symbol,
            underlying: symbol, expiration, strike: bestPut.strike,
            optionType: "put", strategyVariant: "Cash-Secured Put", strategy: "wheel",
            bid: bestPut.bid, ask: bestPut.ask, mid,
            impliedVol: r2(iv * 100), delta: r2(delta), theta: r2(theta),
            openInterest: bestPut.openInterest, volume: bestPut.volume,
            score: scoreCandidate({ premiumPct, pop, volume: bestPut.volume, openInterest: bestPut.openInterest, iv, absDelta: Math.abs(delta), deltaMin: prefs.deltaMin, deltaMax: prefs.deltaMax, isCall: false, stockChangePct: quote.changePercent, stockNearHigh: quote.high > 0 && ((quote.high - quote.last) / quote.high) * 100 < 3 }),
            rationale: `${symbol} at $${stockPrice.toFixed(2)} — sell ${bestPut.strike}P cash-secured put for $${mid.toFixed(2)} credit. ${Math.round(iv * 100)}% IV, ${dte} DTE.`,
            dte, premiumPct, maxProfit, maxLoss, breakeven, legs: [leg], pop, stockPrice: r2(stockPrice),
          });
        }
      }

      if (bestCall) {
        const mid = r2((bestCall.bid + bestCall.ask) / 2);
        const premiumPct = r2((mid / stockPrice) * 100);
        if (premiumPct >= prefs.minPremiumPct) {
          const delta = bestCall.greeks?.delta ?? 0;
          const theta = bestCall.greeks?.theta ?? 0;
          const iv = bestCall.greeks?.mid_iv ?? 0;
          const maxProfit = Math.round((bestCall.strike - stockPrice + mid) * 100);
          const maxLoss = Math.round((stockPrice - mid) * 100);
          const breakeven = r2(stockPrice - mid);
          const pop = estimatePop(delta, "credit");

          const leg: OptionLeg = {
            side: "sell", optionType: "call", strike: bestCall.strike, expiration,
            bid: bestCall.bid, ask: bestCall.ask, mid,
            delta: r2(delta), theta: r2(theta), impliedVol: r2(iv * 100),
            openInterest: bestCall.openInterest, volume: bestCall.volume,
          };

          candidates.push({
            rank: 0,
            symbol: bestCall.symbol,
            underlying: symbol, expiration, strike: bestCall.strike,
            optionType: "call", strategyVariant: "Covered Call", strategy: "wheel",
            bid: bestCall.bid, ask: bestCall.ask, mid,
            impliedVol: r2(iv * 100), delta: r2(delta), theta: r2(theta),
            openInterest: bestCall.openInterest, volume: bestCall.volume,
            score: scoreCandidate({ premiumPct, pop, volume: bestCall.volume, openInterest: bestCall.openInterest, iv, absDelta: Math.abs(delta), deltaMin: prefs.deltaMin, deltaMax: prefs.deltaMax, isCall: true, stockChangePct: quote.changePercent, stockNearHigh: quote.high > 0 && ((quote.high - quote.last) / quote.high) * 100 < 3 }),
            rationale: `${symbol} at $${stockPrice.toFixed(2)} — sell ${bestCall.strike}C covered call for $${mid.toFixed(2)} credit. ${Math.round(iv * 100)}% IV, ${dte} DTE.`,
            dte, premiumPct, maxProfit, maxLoss, breakeven, legs: [leg], pop, stockPrice: r2(stockPrice),
          });
        }
      }
    }
  }

  return candidates;
}

function buildCreditSpreadCandidates(
  quotes: Map<string, StockQuote>,
  chainData: Map<string, { expirations: string[]; chains: Map<string, OptionChainContract[]> }>,
  prefs: ScanPreferences,
): OptionCandidate[] {
  const candidates: OptionCandidate[] = [];

  for (const entry of Array.from(chainData.entries())) {
    const symbol = entry[0];
    const data = entry[1];
    const quote = quotes.get(symbol);
    if (!quote) continue;
    const stockPrice = quote.last;

    for (const chainEntry of Array.from(data.chains.entries())) {
      const expiration = chainEntry[0];
      const chain = chainEntry[1];
      const dte = calcDte(expiration);

      const otmPuts = chain
        .filter((c: OptionChainContract) => c.optionType === "put" && c.strike < stockPrice && c.bid > 0 && c.greeks)
        .sort((a: OptionChainContract, b: OptionChainContract) => b.strike - a.strike);

      const otmCalls = chain
        .filter((c: OptionChainContract) => c.optionType === "call" && c.strike > stockPrice && c.bid > 0 && c.greeks)
        .sort((a: OptionChainContract, b: OptionChainContract) => a.strike - b.strike);

      const shortPut = otmPuts.find((c: OptionChainContract) => Math.abs(c.greeks!.delta) >= prefs.deltaMin && Math.abs(c.greeks!.delta) <= prefs.deltaMax);
      if (shortPut) {
        const longPut = otmPuts.find((c: OptionChainContract) => c.strike < shortPut.strike && c.strike >= shortPut.strike - stockPrice * 0.05);
        if (longPut) {
          const credit = r2(shortPut.bid - longPut.ask);
          if (credit > 0) {
            const spreadWidth = shortPut.strike - longPut.strike;
            const premiumPct = r2((credit / stockPrice) * 100);
            if (premiumPct >= prefs.minPremiumPct) {
              const delta = shortPut.greeks?.delta ?? 0;
              const theta = (shortPut.greeks?.theta ?? 0) - (longPut.greeks?.theta ?? 0);
              const iv = shortPut.greeks?.mid_iv ?? 0;
              const maxProfit = Math.round(credit * 100);
              const maxLoss = Math.round((spreadWidth - credit) * 100);
              const breakeven = r2(shortPut.strike - credit);
              const pop = estimatePop(delta, "credit");

              const shortLeg: OptionLeg = {
                side: "sell", optionType: "put", strike: shortPut.strike, expiration,
                bid: shortPut.bid, ask: shortPut.ask, mid: r2((shortPut.bid + shortPut.ask) / 2),
                delta: r2(shortPut.greeks?.delta ?? 0), theta: r2(shortPut.greeks?.theta ?? 0),
                impliedVol: r2((shortPut.greeks?.mid_iv ?? 0) * 100),
                openInterest: shortPut.openInterest, volume: shortPut.volume,
              };
              const longLegEntry: OptionLeg = {
                side: "buy", optionType: "put", strike: longPut.strike, expiration,
                bid: longPut.bid, ask: longPut.ask, mid: r2((longPut.bid + longPut.ask) / 2),
                delta: r2(longPut.greeks?.delta ?? 0), theta: r2(longPut.greeks?.theta ?? 0),
                impliedVol: r2((longPut.greeks?.mid_iv ?? 0) * 100),
                openInterest: longPut.openInterest, volume: longPut.volume,
              };

              candidates.push({
                rank: 0,
                symbol: `${shortPut.symbol}/${longPut.symbol}`,
                underlying: symbol, expiration, strike: shortPut.strike,
                optionType: "put", strategyVariant: "Bull Put Spread", strategy: "credit-spreads",
                bid: shortPut.bid, ask: shortPut.ask, mid: credit,
                impliedVol: r2(iv * 100), delta: r2(delta), theta: r2(theta),
                openInterest: shortPut.openInterest + longPut.openInterest,
                volume: shortPut.volume + longPut.volume,
                score: scoreCandidate({ premiumPct, pop, volume: shortPut.volume + longPut.volume, openInterest: shortPut.openInterest + longPut.openInterest, iv, absDelta: Math.abs(delta), deltaMin: prefs.deltaMin, deltaMax: prefs.deltaMax, isCall: true, stockChangePct: quote.changePercent, stockNearHigh: quote.high > 0 && ((quote.high - quote.last) / quote.high) * 100 < 3 }),
                rationale: `${symbol} at $${stockPrice.toFixed(2)} — sell ${shortPut.strike}/${longPut.strike} bull put spread for $${credit.toFixed(2)} credit. ${Math.round(iv * 100)}% IV, ${dte} DTE. Max profit $${maxProfit}, max loss $${maxLoss}.`,
                dte, premiumPct, maxProfit, maxLoss, breakeven,
                legs: [shortLeg, longLegEntry], pop, stockPrice: r2(stockPrice),
              });
            }
          }
        }
      }

      const shortCall = otmCalls.find((c: OptionChainContract) => Math.abs(c.greeks!.delta) >= prefs.deltaMin && Math.abs(c.greeks!.delta) <= prefs.deltaMax);
      if (shortCall) {
        const longCall = otmCalls.find((c: OptionChainContract) => c.strike > shortCall.strike && c.strike <= shortCall.strike + stockPrice * 0.05);
        if (longCall) {
          const credit = r2(shortCall.bid - longCall.ask);
          if (credit > 0) {
            const spreadWidth = longCall.strike - shortCall.strike;
            const premiumPct = r2((credit / stockPrice) * 100);
            if (premiumPct >= prefs.minPremiumPct) {
              const delta = shortCall.greeks?.delta ?? 0;
              const theta = (shortCall.greeks?.theta ?? 0) - (longCall.greeks?.theta ?? 0);
              const iv = shortCall.greeks?.mid_iv ?? 0;
              const maxProfit = Math.round(credit * 100);
              const maxLoss = Math.round((spreadWidth - credit) * 100);
              const breakeven = r2(shortCall.strike + credit);
              const pop = estimatePop(delta, "credit");

              const shortLeg: OptionLeg = {
                side: "sell", optionType: "call", strike: shortCall.strike, expiration,
                bid: shortCall.bid, ask: shortCall.ask, mid: r2((shortCall.bid + shortCall.ask) / 2),
                delta: r2(shortCall.greeks?.delta ?? 0), theta: r2(shortCall.greeks?.theta ?? 0),
                impliedVol: r2((shortCall.greeks?.mid_iv ?? 0) * 100),
                openInterest: shortCall.openInterest, volume: shortCall.volume,
              };
              const longLegEntry: OptionLeg = {
                side: "buy", optionType: "call", strike: longCall.strike, expiration,
                bid: longCall.bid, ask: longCall.ask, mid: r2((longCall.bid + longCall.ask) / 2),
                delta: r2(longCall.greeks?.delta ?? 0), theta: r2(longCall.greeks?.theta ?? 0),
                impliedVol: r2((longCall.greeks?.mid_iv ?? 0) * 100),
                openInterest: longCall.openInterest, volume: longCall.volume,
              };

              candidates.push({
                rank: 0,
                symbol: `${shortCall.symbol}/${longCall.symbol}`,
                underlying: symbol, expiration, strike: shortCall.strike,
                optionType: "call", strategyVariant: "Bear Call Spread", strategy: "credit-spreads",
                bid: shortCall.bid, ask: shortCall.ask, mid: credit,
                impliedVol: r2(iv * 100), delta: r2(delta), theta: r2(theta),
                openInterest: shortCall.openInterest + longCall.openInterest,
                volume: shortCall.volume + longCall.volume,
                score: scoreCandidate({ premiumPct, pop, volume: shortCall.volume + longCall.volume, openInterest: shortCall.openInterest + longCall.openInterest, iv, absDelta: Math.abs(delta), deltaMin: prefs.deltaMin, deltaMax: prefs.deltaMax, isCall: false, stockChangePct: quote.changePercent, stockNearHigh: quote.high > 0 && ((quote.high - quote.last) / quote.high) * 100 < 3 }),
                rationale: `${symbol} at $${stockPrice.toFixed(2)} — sell ${shortCall.strike}/${longCall.strike} bear call spread for $${credit.toFixed(2)} credit. ${Math.round(iv * 100)}% IV, ${dte} DTE. Max profit $${maxProfit}, max loss $${maxLoss}.`,
                dte, premiumPct, maxProfit, maxLoss, breakeven,
                legs: [shortLeg, longLegEntry], pop, stockPrice: r2(stockPrice),
              });
            }
          }
        }
      }
    }
  }

  return candidates;
}
