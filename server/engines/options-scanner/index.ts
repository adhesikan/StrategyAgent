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
  { key: "wheel", label: "The Wheel", description: "Sell cash-secured puts, then covered calls on assignment" },
  { key: "credit-spreads", label: "Credit Spreads", description: "Sell vertical spreads for net credit" },
  { key: "mwfs", label: "MWFS", description: "Mon-Wed-Fri short-dated options strategy" },
  { key: "iron-condor", label: "Iron Condor", description: "Non-directional range-bound strategy" },
  { key: "covered-calls", label: "Covered Calls", description: "Generate income on existing equity positions" },
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
      return `${symbol} range-bound with ${ivPct}% IV — favorable credit spread conditions.${riskNote}`;
    case "mwfs":
      return `${symbol} short-dated opportunity at ${ivPct}% IV — rapid theta decay.${riskNote}`;
    case "iron-condor":
      return `${symbol} low directional bias, ${ivPct}% IV — balanced condor structure.${riskNote}`;
    case "covered-calls":
      return `${symbol} at ${ivPct}% IV — premium income on existing position.${riskNote}`;
    default:
      return `${symbol} scan result at ${ivPct}% IV.${riskNote}`;
  }
}
