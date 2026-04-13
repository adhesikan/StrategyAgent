import { TradingStyle, MarketScope, PersonaGoal, PersonaRisk } from "./schema";

export interface PersonaInput {
  tradingStyle: string;
  marketScope: string;
  personaGoal: string;
  personaRisk: string;
}

export interface PersonaOutput {
  personaLabel: string;
  strategyBundleId: string;
  riskPerTradeUsd: number;
  maxTradesPerDay: number;
  minConfidenceThreshold: number;
  strategies: string[];
  tip: string;
}

export const STRATEGY_BUNDLES: Record<string, { label: string; strategies: string[]; description: string }> = {
  DAY_CORE_STOCKS: {
    label: "Day Trading Core",
    strategies: ["ORB5", "ORB15", "GAP_AND_GO", "HIGH_RVOL", "VWAP_RECLAIM"],
    description: "Intraday momentum and breakout strategies for stocks",
  },
  SWING_VCP_STOCKS: {
    label: "Swing VCP",
    strategies: ["VCP", "VCP_MULTIDAY", "CLASSIC_PULLBACK"],
    description: "Multi-day contraction and breakout patterns",
  },
  AUTO_BALANCED: {
    label: "Auto Balanced",
    strategies: ["VCP", "ORB5", "GAP_AND_GO", "HIGH_RVOL", "VWAP_RECLAIM"],
    description: "Balanced mix of day and swing strategies",
  },
  DAY_CORE_OPTIONS: {
    label: "Day Trading Options",
    strategies: ["ORB5", "ORB15", "GAP_AND_GO"],
    description: "Options-compatible intraday strategies (coming soon)",
  },
  SWING_OPTIONS: {
    label: "Swing Options",
    strategies: ["VCP", "VCP_MULTIDAY"],
    description: "Options-focused swing strategies (coming soon)",
  },
};

const RISK_DEFAULTS: Record<string, { riskPerTradeUsd: number; maxTradesPerDay: number }> = {
  CONSERVATIVE: { riskPerTradeUsd: 250, maxTradesPerDay: 1 },
  BALANCED: { riskPerTradeUsd: 500, maxTradesPerDay: 2 },
  AGGRESSIVE: { riskPerTradeUsd: 1000, maxTradesPerDay: 5 },
};

const PERSONA_LABELS: Record<string, Record<string, string>> = {
  DAY: {
    CONSERVATIVE: "Cautious Day Trader",
    BALANCED: "Steady Day Trader",
    AGGRESSIVE: "Fast Momentum Trader",
  },
  SWING: {
    CONSERVATIVE: "Patient Swing Trader",
    BALANCED: "Steady Swing Trader",
    AGGRESSIVE: "Active Swing Trader",
  },
  AUTO: {
    CONSERVATIVE: "Conservative Auto Trader",
    BALANCED: "Balanced Auto Trader",
    AGGRESSIVE: "Aggressive Auto Trader",
  },
};

const PERSONA_TIPS: Record<string, string> = {
  CONSISTENCY: "Focus on following your rules consistently. The system handles execution so you can stay disciplined.",
  SAVE_TIME: "Your autopilot is working for you. Check in once a day to review activity and adjust settings as needed.",
  OPPORTUNITIES: "The scanner is covering more ground than manual watching. Review top picks daily and refine your filters over time.",
  REDUCE_EMOTION: "Automation removes emotional decision-making. Trust your settings and avoid overriding the system impulsively.",
};

export function computePersona(input: PersonaInput): PersonaOutput {
  const style = input.tradingStyle || TradingStyle.AUTO;
  const scope = input.marketScope || MarketScope.STOCKS;
  const risk = input.personaRisk || PersonaRisk.BALANCED;
  const goal = input.personaGoal || PersonaGoal.SAVE_TIME;

  let bundleId: string;
  if (scope === MarketScope.OPTIONS) {
    bundleId = style === TradingStyle.SWING ? "SWING_OPTIONS" : "DAY_CORE_OPTIONS";
  } else if (style === TradingStyle.DAY) {
    bundleId = "DAY_CORE_STOCKS";
  } else if (style === TradingStyle.SWING) {
    bundleId = "SWING_VCP_STOCKS";
  } else {
    bundleId = "AUTO_BALANCED";
  }

  if (scope === MarketScope.BOTH && style === TradingStyle.AUTO) {
    bundleId = "AUTO_BALANCED";
  }

  const bundle = STRATEGY_BUNDLES[bundleId] || STRATEGY_BUNDLES.AUTO_BALANCED;
  const riskDefaults = RISK_DEFAULTS[risk] || RISK_DEFAULTS.BALANCED;

  const personaLabel = PERSONA_LABELS[style]?.[risk] || "Custom Trader";
  const tip = PERSONA_TIPS[goal] || PERSONA_TIPS.SAVE_TIME;

  return {
    personaLabel,
    strategyBundleId: bundleId,
    riskPerTradeUsd: riskDefaults.riskPerTradeUsd,
    maxTradesPerDay: riskDefaults.maxTradesPerDay,
    minConfidenceThreshold: 90,
    strategies: bundle.strategies,
    tip,
  };
}

export const DISCLAIMER_VERSION = "v1.1.0";

export const DISCLAIMER_BULLETS = [
  "Strategy Agent is software that helps you analyze strategies and generate trade setups based on rules you choose.",
  "It does not provide investment advice and does not guarantee outcomes.",
  "You are solely responsible for all trading decisions, settings, and risk.",
  "Trading involves risk, including loss of principal.",
  "Past performance and backtests (if shown) are not indicative of future results.",
  "By enabling autopilot you agree you will not hold Sunfish Technologies/Strategy Agent liable for gains or losses.",
];

export const DISCLAIMER_FULL_TEXT = DISCLAIMER_BULLETS.join(" ");

export function computeDisclaimerHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
