import type { UserTradePreferences } from "@shared/schema";
import type { InstrumentType } from "./instrument-selector";

export interface GuardrailContext {
  prefs: Partial<UserTradePreferences>;
  instrumentType: InstrumentType;
  setupScore?: number | null;
  rewardRisk?: number | null;
  optionLiquidity?: {
    bidAskSpreadPct?: number;
    openInterest?: number;
    volume?: number;
  };
}

export interface GuardrailResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
}

const DEFAULTS: Partial<UserTradePreferences> = {
  allowStocks: true,
  allowLongCalls: true,
  allowLongPuts: true,
  allowDebitSpreads: true,
  allowCreditSpreads: false,
  definedRiskOnly: false,
  preferredDteMin: 7,
  preferredDteMax: 45,
  minOpenInterest: 100,
  minOptionVolume: 50,
  maxBidAskSpreadPct: 10.0,
  minRewardRisk: 1.5,
  minProbabilityScore: 65,
};

function isInstrumentAllowed(type: InstrumentType, prefs: Partial<UserTradePreferences>): boolean {
  switch (type) {
    case "stock": return prefs.allowStocks ?? true;
    case "long_call": return (prefs.allowLongCalls ?? true) && !(prefs.definedRiskOnly ?? false);
    case "long_put": return (prefs.allowLongPuts ?? true) && !(prefs.definedRiskOnly ?? false);
    case "bull_call_spread":
    case "bear_put_spread": return prefs.allowDebitSpreads ?? true;
    // CSP / CC are explicit income-style trades. The user opted into them by
    // asking for a wheel/income trade, so we don't gate behind the directional
    // option toggles. (definedRiskOnly does not apply — both have well-defined
    // collateral / share-backed risk profiles.)
    case "cash_secured_put":
    case "covered_call": return true;
  }
}

export function checkGuardrails(ctx: GuardrailContext): GuardrailResult {
  const prefs = { ...DEFAULTS, ...ctx.prefs };
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!isInstrumentAllowed(ctx.instrumentType, prefs)) {
    blockers.push(`Trade preference does not allow ${ctx.instrumentType.replace(/_/g, " ")} trades`);
  }

  if (typeof ctx.setupScore === "number" && typeof prefs.minProbabilityScore === "number") {
    if (ctx.setupScore < prefs.minProbabilityScore) {
      blockers.push(`Setup score ${ctx.setupScore} below your minimum (${prefs.minProbabilityScore})`);
    }
  }

  if (typeof ctx.rewardRisk === "number" && typeof prefs.minRewardRisk === "number") {
    if (ctx.rewardRisk < prefs.minRewardRisk) {
      blockers.push(`Reward/risk ${ctx.rewardRisk.toFixed(2)} below your minimum (${prefs.minRewardRisk})`);
    }
  }

  if (ctx.optionLiquidity) {
    const { bidAskSpreadPct, openInterest, volume } = ctx.optionLiquidity;
    if (typeof bidAskSpreadPct === "number" && typeof prefs.maxBidAskSpreadPct === "number") {
      if (bidAskSpreadPct > prefs.maxBidAskSpreadPct) {
        warnings.push(`Bid/ask spread ${bidAskSpreadPct.toFixed(1)}% exceeds your max (${prefs.maxBidAskSpreadPct}%)`);
      }
    }
    if (typeof openInterest === "number" && typeof prefs.minOpenInterest === "number") {
      if (openInterest < prefs.minOpenInterest) {
        warnings.push(`Open interest ${openInterest} below your minimum (${prefs.minOpenInterest})`);
      }
    }
    if (typeof volume === "number" && typeof prefs.minOptionVolume === "number") {
      if (volume < prefs.minOptionVolume) {
        warnings.push(`Option volume ${volume} below your minimum (${prefs.minOptionVolume})`);
      }
    }
  }

  return { passed: blockers.length === 0, blockers, warnings };
}
