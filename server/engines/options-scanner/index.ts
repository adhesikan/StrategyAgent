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

export async function runOptionsScan(
  request: OptionsScanRequest,
  _brokerAccessToken?: string,
): Promise<OptionsScanResult> {
  const { symbols, strategyKey } = request;
  const prefs = { ...DEFAULT_SCAN_PREFS, ...request.scanPreferences };

  let candidates: OptionCandidate[];

  switch (strategyKey) {
    case "wheel":
      candidates = generateWheelCandidates(symbols, prefs);
      break;
    case "credit-spreads":
      candidates = generateCreditSpreadCandidates(symbols, prefs);
      break;
    case "long-options":
    default:
      candidates = generateLongOptionCandidates(symbols, prefs);
      break;
  }

  candidates.sort((a, b) => b.score - a.score);
  candidates.forEach((c, i) => (c.rank = i + 1));

  return {
    strategyKey: request.strategyKey,
    universeId: request.universeId,
    scannedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
}

function getExpirationInDTE(dteMin: number, dteMax: number): { expiration: string; dte: number } {
  const dte = dteMin + Math.floor(Math.random() * (dteMax - dteMin + 1));
  const exp = new Date();
  exp.setDate(exp.getDate() + dte);
  const dayOfWeek = exp.getDay();
  if (dayOfWeek === 0) exp.setDate(exp.getDate() + 5);
  else if (dayOfWeek === 6) exp.setDate(exp.getDate() + 6);
  else {
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    exp.setDate(exp.getDate() + daysToFriday);
  }
  const actualDte = Math.round((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return { expiration: exp.toISOString().split("T")[0], dte: actualDte };
}

function roundStrike(raw: number): number {
  if (raw < 5) return Math.round(raw * 2) / 2;
  if (raw < 25) return Math.round(raw * 2) / 2;
  return Math.round(raw);
}

function generateLongOptionCandidates(symbols: string[], prefs: ScanPreferences): OptionCandidate[] {
  return symbols.map((symbol) => {
    const stockPrice = 50 + Math.random() * 450;
    const isCall = Math.random() > 0.4;
    const otmFactor = isCall ? 1 + Math.random() * 0.05 : 1 - Math.random() * 0.05;
    const strike = roundStrike(stockPrice * otmFactor);
    const { expiration, dte } = getExpirationInDTE(prefs.dteMin, prefs.dteMax);
    const iv = 0.2 + Math.random() * 0.6;
    const rawDelta = prefs.deltaMin + Math.random() * (prefs.deltaMax - prefs.deltaMin);
    const delta = isCall ? rawDelta : -rawDelta;
    const theta = -(0.02 + Math.random() * 0.08);
    const premiumPct = prefs.minPremiumPct + Math.random() * 4;
    const mid = Math.max(0.10, (premiumPct / 100) * stockPrice);
    const bid = Math.round((mid * 0.95) * 100) / 100;
    const ask = Math.round((mid * 1.05) * 100) / 100;
    const maxLoss = mid * 100;
    const maxProfit = isCall ? Infinity : (strike - mid) * 100;
    const breakeven = isCall ? strike + mid : strike - mid;
    const pop = Math.round(30 + Math.random() * 40);

    const leg: OptionLeg = {
      side: "buy", optionType: isCall ? "call" : "put", strike, expiration,
      bid, ask, mid: Math.round(mid * 100) / 100, delta: Math.round(delta * 100) / 100,
      theta: Math.round(theta * 100) / 100, impliedVol: Math.round(iv * 1000) / 10,
      openInterest: Math.floor(500 + Math.random() * 10000),
      volume: Math.floor(50 + Math.random() * 5000),
    };

    const ivPct = Math.round(iv * 100);
    const rationale = `${symbol} at $${stockPrice.toFixed(0)} — ${ivPct}% IV. ${isCall ? "Bullish" : "Bearish"} setup with ${dte}-day expiry. Defined risk at $${mid.toFixed(2)} per contract.`;

    return {
      rank: 0, symbol: `${symbol}${strike}${isCall ? "C" : "P"}`, underlying: symbol,
      expiration, strike, optionType: isCall ? "call" as const : "put" as const,
      strategyVariant: isCall ? "Long Call" : "Long Put",
      strategy: "long-options",
      bid, ask, mid: Math.round(mid * 100) / 100,
      impliedVol: Math.round(iv * 1000) / 10,
      delta: Math.round(delta * 100) / 100,
      theta: Math.round(theta * 100) / 100,
      openInterest: leg.openInterest, volume: leg.volume,
      score: Math.round((60 + Math.random() * 40) * 10) / 10,
      rationale, dte, premiumPct: Math.round(premiumPct * 100) / 100,
      maxProfit: maxProfit === Infinity ? -1 : Math.round(maxProfit), maxLoss: Math.round(maxLoss),
      breakeven: Math.round(breakeven * 100) / 100,
      legs: [leg], pop, stockPrice: Math.round(stockPrice * 100) / 100,
    };
  });
}

function generateWheelCandidates(symbols: string[], prefs: ScanPreferences): OptionCandidate[] {
  return symbols.map((symbol) => {
    const stockPrice = 50 + Math.random() * 450;
    const isCoveredCall = Math.random() > 0.5;
    const { expiration, dte } = getExpirationInDTE(prefs.dteMin, prefs.dteMax);
    const iv = 0.2 + Math.random() * 0.5;

    if (isCoveredCall) {
      const otmFactor = 1 + 0.02 + Math.random() * 0.08;
      const strike = roundStrike(stockPrice * otmFactor);
      const rawDelta = prefs.deltaMin + Math.random() * (prefs.deltaMax - prefs.deltaMin);
      const delta = -rawDelta;
      const theta = 0.02 + Math.random() * 0.06;
      const premiumPct = prefs.minPremiumPct + Math.random() * 3;
      const mid = Math.max(0.10, (premiumPct / 100) * stockPrice);
      const bid = Math.round((mid * 0.95) * 100) / 100;
      const ask = Math.round((mid * 1.05) * 100) / 100;
      const maxProfit = (strike - stockPrice + mid) * 100;
      const maxLoss = (stockPrice - mid) * 100;
      const breakeven = stockPrice - mid;
      const pop = Math.round(55 + Math.random() * 30);

      const leg: OptionLeg = {
        side: "sell", optionType: "call", strike, expiration,
        bid, ask, mid: Math.round(mid * 100) / 100, delta: Math.round(delta * 100) / 100,
        theta: Math.round(theta * 100) / 100, impliedVol: Math.round(iv * 1000) / 10,
        openInterest: Math.floor(500 + Math.random() * 10000),
        volume: Math.floor(50 + Math.random() * 5000),
      };

      const ivPct = Math.round(iv * 100);
      return {
        rank: 0, symbol: `${symbol}${strike}C`, underlying: symbol,
        expiration, strike, optionType: "call" as const,
        strategyVariant: "Covered Call",
        strategy: "wheel",
        bid, ask, mid: Math.round(mid * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        delta: Math.round(delta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        openInterest: leg.openInterest, volume: leg.volume,
        score: Math.round((60 + Math.random() * 40) * 10) / 10,
        rationale: `${symbol} at $${stockPrice.toFixed(0)} — sell ${strike}C covered call for $${mid.toFixed(2)} credit. ${ivPct}% IV, ${dte} DTE. Earn income while holding shares.`,
        dte, premiumPct: Math.round(premiumPct * 100) / 100,
        maxProfit: Math.round(maxProfit), maxLoss: Math.round(maxLoss),
        breakeven: Math.round(breakeven * 100) / 100,
        legs: [leg], pop, stockPrice: Math.round(stockPrice * 100) / 100,
      };
    } else {
      const otmFactor = 1 - 0.02 - Math.random() * 0.08;
      const strike = roundStrike(stockPrice * otmFactor);
      const rawDelta = prefs.deltaMin + Math.random() * (prefs.deltaMax - prefs.deltaMin);
      const delta = -rawDelta;
      const theta = 0.02 + Math.random() * 0.06;
      const premiumPct = prefs.minPremiumPct + Math.random() * 3;
      const mid = Math.max(0.10, (premiumPct / 100) * stockPrice);
      const bid = Math.round((mid * 0.95) * 100) / 100;
      const ask = Math.round((mid * 1.05) * 100) / 100;
      const maxProfit = mid * 100;
      const maxLoss = (strike - mid) * 100;
      const breakeven = strike - mid;
      const pop = Math.round(55 + Math.random() * 30);

      const leg: OptionLeg = {
        side: "sell", optionType: "put", strike, expiration,
        bid, ask, mid: Math.round(mid * 100) / 100, delta: Math.round(delta * 100) / 100,
        theta: Math.round(theta * 100) / 100, impliedVol: Math.round(iv * 1000) / 10,
        openInterest: Math.floor(500 + Math.random() * 10000),
        volume: Math.floor(50 + Math.random() * 5000),
      };

      const ivPct = Math.round(iv * 100);
      return {
        rank: 0, symbol: `${symbol}${strike}P`, underlying: symbol,
        expiration, strike, optionType: "put" as const,
        strategyVariant: "Cash-Secured Put",
        strategy: "wheel",
        bid, ask, mid: Math.round(mid * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        delta: Math.round(delta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        openInterest: leg.openInterest, volume: leg.volume,
        score: Math.round((60 + Math.random() * 40) * 10) / 10,
        rationale: `${symbol} at $${stockPrice.toFixed(0)} — sell ${strike}P cash-secured put for $${mid.toFixed(2)} credit. ${ivPct}% IV, ${dte} DTE. Get paid to wait for a lower entry.`,
        dte, premiumPct: Math.round(premiumPct * 100) / 100,
        maxProfit: Math.round(maxProfit), maxLoss: Math.round(maxLoss),
        breakeven: Math.round(breakeven * 100) / 100,
        legs: [leg], pop, stockPrice: Math.round(stockPrice * 100) / 100,
      };
    }
  });
}

function generateCreditSpreadCandidates(symbols: string[], prefs: ScanPreferences): OptionCandidate[] {
  return symbols.map((symbol) => {
    const stockPrice = 50 + Math.random() * 450;
    const isBullPut = Math.random() > 0.5;
    const { expiration, dte } = getExpirationInDTE(prefs.dteMin, prefs.dteMax);
    const iv = 0.2 + Math.random() * 0.5;
    const spreadWidth = Math.max(1, Math.round(stockPrice * 0.02 + Math.random() * stockPrice * 0.03));

    if (isBullPut) {
      const shortStrike = roundStrike(stockPrice * (1 - 0.03 - Math.random() * 0.07));
      const longStrike = roundStrike(shortStrike - spreadWidth);
      const rawDelta = prefs.deltaMin + Math.random() * (prefs.deltaMax - prefs.deltaMin);
      const theta = 0.01 + Math.random() * 0.04;
      const credit = Math.max(0.10, spreadWidth * (0.25 + Math.random() * 0.25));
      const maxProfit = credit * 100;
      const maxLoss = (spreadWidth - credit) * 100;
      const breakeven = shortStrike - credit;
      const pop = Math.round(55 + Math.random() * 30);
      const premiumPct = (credit / stockPrice) * 100;

      const shortLeg: OptionLeg = {
        side: "sell", optionType: "put", strike: shortStrike, expiration,
        bid: Math.round((credit * 1.02) * 100) / 100, ask: Math.round((credit * 1.08) * 100) / 100,
        mid: Math.round(credit * 100) / 100,
        delta: Math.round(-rawDelta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        openInterest: Math.floor(500 + Math.random() * 10000),
        volume: Math.floor(50 + Math.random() * 5000),
      };
      const longLeg: OptionLeg = {
        side: "buy", optionType: "put", strike: longStrike, expiration,
        bid: Math.round((credit * 0.3) * 100) / 100, ask: Math.round((credit * 0.5) * 100) / 100,
        mid: Math.round((credit * 0.4) * 100) / 100,
        delta: Math.round((-rawDelta * 0.5) * 100) / 100,
        theta: Math.round((-theta * 0.4) * 100) / 100,
        impliedVol: Math.round((iv * 0.95) * 1000) / 10,
        openInterest: Math.floor(200 + Math.random() * 5000),
        volume: Math.floor(20 + Math.random() * 2000),
      };

      const ivPct = Math.round(iv * 100);
      return {
        rank: 0,
        symbol: `${symbol}${shortStrike}/${longStrike}P`,
        underlying: symbol,
        expiration, strike: shortStrike,
        optionType: "put" as const,
        strategyVariant: "Bull Put Spread",
        strategy: "credit-spreads",
        bid: shortLeg.bid, ask: shortLeg.ask,
        mid: Math.round(credit * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        delta: Math.round(-rawDelta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        openInterest: shortLeg.openInterest + longLeg.openInterest,
        volume: shortLeg.volume + longLeg.volume,
        score: Math.round((60 + Math.random() * 40) * 10) / 10,
        rationale: `${symbol} at $${stockPrice.toFixed(0)} — sell ${shortStrike}/${longStrike} bull put spread for $${credit.toFixed(2)} credit. ${ivPct}% IV, ${dte} DTE. Max profit $${maxProfit.toFixed(0)}, max loss $${maxLoss.toFixed(0)}.`,
        dte, premiumPct: Math.round(premiumPct * 100) / 100,
        maxProfit: Math.round(maxProfit), maxLoss: Math.round(maxLoss),
        breakeven: Math.round(breakeven * 100) / 100,
        legs: [shortLeg, longLeg],
        pop, stockPrice: Math.round(stockPrice * 100) / 100,
      };
    } else {
      const shortStrike = roundStrike(stockPrice * (1 + 0.03 + Math.random() * 0.07));
      const longStrike = roundStrike(shortStrike + spreadWidth);
      const rawDelta = prefs.deltaMin + Math.random() * (prefs.deltaMax - prefs.deltaMin);
      const theta = 0.01 + Math.random() * 0.04;
      const credit = Math.max(0.10, spreadWidth * (0.25 + Math.random() * 0.25));
      const maxProfit = credit * 100;
      const maxLoss = (spreadWidth - credit) * 100;
      const breakeven = shortStrike + credit;
      const pop = Math.round(55 + Math.random() * 30);
      const premiumPct = (credit / stockPrice) * 100;

      const shortLeg: OptionLeg = {
        side: "sell", optionType: "call", strike: shortStrike, expiration,
        bid: Math.round((credit * 1.02) * 100) / 100, ask: Math.round((credit * 1.08) * 100) / 100,
        mid: Math.round(credit * 100) / 100,
        delta: Math.round(-rawDelta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        openInterest: Math.floor(500 + Math.random() * 10000),
        volume: Math.floor(50 + Math.random() * 5000),
      };
      const longLeg: OptionLeg = {
        side: "buy", optionType: "call", strike: longStrike, expiration,
        bid: Math.round((credit * 0.3) * 100) / 100, ask: Math.round((credit * 0.5) * 100) / 100,
        mid: Math.round((credit * 0.4) * 100) / 100,
        delta: Math.round((rawDelta * 0.3) * 100) / 100,
        theta: Math.round((-theta * 0.4) * 100) / 100,
        impliedVol: Math.round((iv * 1.05) * 1000) / 10,
        openInterest: Math.floor(200 + Math.random() * 5000),
        volume: Math.floor(20 + Math.random() * 2000),
      };

      const ivPct = Math.round(iv * 100);
      return {
        rank: 0,
        symbol: `${symbol}${shortStrike}/${longStrike}C`,
        underlying: symbol,
        expiration, strike: shortStrike,
        optionType: "call" as const,
        strategyVariant: "Bear Call Spread",
        strategy: "credit-spreads",
        bid: shortLeg.bid, ask: shortLeg.ask,
        mid: Math.round(credit * 100) / 100,
        impliedVol: Math.round(iv * 1000) / 10,
        delta: Math.round(-rawDelta * 100) / 100,
        theta: Math.round(theta * 100) / 100,
        openInterest: shortLeg.openInterest + longLeg.openInterest,
        volume: shortLeg.volume + longLeg.volume,
        score: Math.round((60 + Math.random() * 40) * 10) / 10,
        rationale: `${symbol} at $${stockPrice.toFixed(0)} — sell ${shortStrike}/${longStrike} bear call spread for $${credit.toFixed(2)} credit. ${ivPct}% IV, ${dte} DTE. Max profit $${maxProfit.toFixed(0)}, max loss $${maxLoss.toFixed(0)}.`,
        dte, premiumPct: Math.round(premiumPct * 100) / 100,
        maxProfit: Math.round(maxProfit), maxLoss: Math.round(maxLoss),
        breakeven: Math.round(breakeven * 100) / 100,
        legs: [shortLeg, longLeg],
        pop, stockPrice: Math.round(stockPrice * 100) / 100,
      };
    }
  });
}
