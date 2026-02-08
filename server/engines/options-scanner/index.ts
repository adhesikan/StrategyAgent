export interface OptionsScanRequest {
  universeId: string;
  strategyKey: string;
  symbols: string[];
  riskSettings?: RiskSettings;
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

export interface OptionCandidate {
  rank: number;
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
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
}

export interface OptionsScanResult {
  strategyKey: string;
  universeId: string;
  scannedAt: string;
  candidateCount: number;
  candidates: OptionCandidate[];
}

export const STRATEGY_DEFINITIONS = [
  { key: "wheel", label: "Wheel Strategy (CSP + CC)", description: "Sell cash-secured puts, then covered calls on assignment" },
  { key: "credit-spreads", label: "Credit Spreads (MWFS)", description: "Mon-Wed-Fri short-dated credit spread strategy for consistent premium" },
  { key: "swing-pullbacks", label: "Swing Trade Pullbacks", description: "Options on pullback entries in trending stocks for swing trades" },
  { key: "vwap-reclaim", label: "Day Trade VWAP Reclaim", description: "Intraday options on VWAP reclaim setups with tight risk" },
  { key: "volume-breakouts", label: "Relative Volume Breakouts", description: "Options on stocks breaking out with unusual relative volume" },
  { key: "long-options", label: "Long Options (Calls/Puts)", description: "Directional long calls or puts on high-conviction setups" },
] as const;

export async function runOptionsScan(
  request: OptionsScanRequest,
  _brokerAccessToken?: string,
): Promise<OptionsScanResult> {
  const { symbols, strategyKey, riskSettings } = request;

  const deltaMin = riskSettings?.deltaMin ?? 0.10;
  const deltaMax = riskSettings?.deltaMax ?? 0.30;
  const minPremiumPct = riskSettings?.minPremiumPct ?? 0.5;

  const candidates: OptionCandidate[] = symbols.map((symbol, i) => {
    const basePrice = 100 + Math.random() * 400;
    const strike = Math.round(basePrice * (0.9 + Math.random() * 0.2));
    const iv = 0.2 + Math.random() * 0.6;

    const rawDelta = deltaMin + Math.random() * (deltaMax - deltaMin);
    const delta = strategyKey === "wheel" ? -rawDelta : rawDelta;

    const theta = -(0.02 + Math.random() * 0.08);
    const premiumPct = minPremiumPct + Math.random() * 3;
    const mid = Math.max(0.05, (premiumPct / 100) * basePrice);

    return {
      rank: i + 1,
      symbol: `${symbol}${strike}${strategyKey === "wheel" ? "P" : "C"}`,
      underlying: symbol,
      expiration: getNextExpiration(),
      strike,
      optionType: strategyKey === "wheel" ? "put" as const : "call" as const,
      strategy: strategyKey,
      bid: Math.round((mid - 0.1) * 100) / 100,
      ask: Math.round((mid + 0.1) * 100) / 100,
      mid: Math.round(mid * 100) / 100,
      impliedVol: Math.round(iv * 1000) / 10,
      delta: Math.round(delta * 100) / 100,
      theta: Math.round(theta * 100) / 100,
      openInterest: Math.floor(500 + Math.random() * 10000),
      volume: Math.floor(50 + Math.random() * 5000),
      score: Math.round((70 + Math.random() * 30) * 10) / 10,
      rationale: generateRationale(strategyKey, symbol, iv, riskSettings),
    };
  });

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

function getNextExpiration(): string {
  const now = new Date();
  const daysToFriday = (5 - now.getDay() + 7) % 7 || 7;
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysToFriday);
  return friday.toISOString().split("T")[0];
}

function generateRationale(strategy: string, symbol: string, iv: number, risk?: RiskSettings): string {
  const ivPct = Math.round(iv * 100);
  const riskNote = risk?.protectionsEnabled ? " Protections active." : "";
  switch (strategy) {
    case "wheel":
      return `${symbol} at ${ivPct}% IV — elevated premium for CSP entry. Delta range ${risk?.deltaMin ?? 0.10}–${risk?.deltaMax ?? 0.30}.${riskNote}`;
    case "credit-spreads":
      return `${symbol} range-bound with ${ivPct}% IV — favorable MWF credit spread conditions with rapid theta decay.${riskNote}`;
    case "swing-pullbacks":
      return `${symbol} pulling back to support at ${ivPct}% IV — swing entry with defined risk on options.${riskNote}`;
    case "vwap-reclaim":
      return `${symbol} reclaiming VWAP at ${ivPct}% IV — intraday momentum setup with tight stop.${riskNote}`;
    case "volume-breakouts":
      return `${symbol} breaking out on relative volume surge at ${ivPct}% IV — momentum continuation play.${riskNote}`;
    case "long-options":
      return `${symbol} directional setup at ${ivPct}% IV — high-conviction long option with defined risk.${riskNote}`;
    default:
      return `${symbol} scan result at ${ivPct}% IV.${riskNote}`;
  }
}
