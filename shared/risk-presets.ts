export interface RiskPreset {
  key: "conservative" | "balanced" | "aggressive";
  label: string;
  description: string;
  recommended?: boolean;
  deltaMin: number;
  deltaMax: number;
  lossCutoffMult: number;
  minPremiumPct: number;
  vixPause: number;
  riskPerTrade: number;
  maxDeploy: number;
}

export const RISK_PRESETS: RiskPreset[] = [
  {
    key: "conservative",
    label: "Conservative",
    description: "Lower delta range, tighter loss cutoffs, higher premium thresholds. Best for capital preservation.",
    deltaMin: 0.08,
    deltaMax: 0.15,
    lossCutoffMult: 1.2,
    minPremiumPct: 28,
    vixPause: 22,
    riskPerTrade: 1.0,
    maxDeploy: 30,
  },
  {
    key: "balanced",
    label: "Balanced",
    description: "Moderate delta range with balanced risk/reward. Recommended for most traders.",
    recommended: true,
    deltaMin: 0.10,
    deltaMax: 0.20,
    lossCutoffMult: 1.5,
    minPremiumPct: 25,
    vixPause: 25,
    riskPerTrade: 2.0,
    maxDeploy: 50,
  },
  {
    key: "aggressive",
    label: "Aggressive",
    description: "Wider delta range, relaxed cutoffs, lower premium floors. Higher potential returns with more risk.",
    deltaMin: 0.15,
    deltaMax: 0.30,
    lossCutoffMult: 1.8,
    minPremiumPct: 22,
    vixPause: 28,
    riskPerTrade: 3.0,
    maxDeploy: 70,
  },
];

export function getPreset(key: string): RiskPreset | undefined {
  return RISK_PRESETS.find(p => p.key === key);
}
