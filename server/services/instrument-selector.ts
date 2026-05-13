import type { TradeSetup } from "../agent/strategy-engine";
import type { ProbabilityResult } from "./probability-engine";
import type { UserTradePreferences } from "@shared/schema";
import { buildOptionPlan, type OptionPlan, type OptionStrategyType, type OptionsContext } from "./options-evaluator";

export type InstrumentType =
  | "stock"
  | "long_call"
  | "long_put"
  | "bull_call_spread"
  | "bear_put_spread"
  | "cash_secured_put"
  | "covered_call";

// Income / wheel-style intent surfaced by the prompt interpreter. When set,
// the selector prefers premium-collection vehicles (CSP / CC) over directional
// debit plays for the matching option type.
export type IncomeIntent = "wheel" | "cash_secured_put" | "covered_call" | null;

export interface InstrumentRecommendation {
  recommended: InstrumentType;
  alternative: InstrumentType | null;
  recommendedPlan?: OptionPlan;
  alternativePlan?: OptionPlan;
  vehicleScore: number;
  reasons: string[];
  tradeoffs: string[];
}

export interface SelectorInput {
  setup: TradeSetup;
  probability: ProbabilityResult;
  prefs: Partial<UserTradePreferences>;
  optionsContext?: OptionsContext;
  /**
   * Optional income/wheel hint from the prompt interpreter. When set, premium-
   * collection vehicles (CSP / CC) are added to the candidate pool and given
   * priority over the directional debit options that share the same option
   * type — this prevents "find a put trade for a wheel strategy" from being
   * answered with a bear put spread.
   */
  incomeIntent?: IncomeIntent;
}

const DEFAULT_PREFS: Partial<UserTradePreferences> = {
  allowStocks: true,
  allowLongCalls: true,
  allowLongPuts: true,
  allowDebitSpreads: true,
  allowCreditSpreads: false,
  definedRiskOnly: false,
  minRewardRisk: 1.5,
  minProbabilityScore: 65,
};

function isAllowed(type: InstrumentType, prefs: Partial<UserTradePreferences>): boolean {
  switch (type) {
    case "stock": return prefs.allowStocks ?? true;
    case "long_call": return prefs.allowLongCalls ?? true;
    case "long_put": return prefs.allowLongPuts ?? true;
    case "bull_call_spread":
    case "bear_put_spread": return prefs.allowDebitSpreads ?? true;
    // CSP and CC are income-style trades. They are not directional debit
    // spreads, so we don't gate them behind allowDebitSpreads — the prompt
    // explicitly asked for a wheel/income trade. When the user has an
    // explicit Income flag we'd honour it, but the schema doesn't have one
    // yet, so default to allowed.
    case "cash_secured_put":
    case "covered_call": return true;
  }
}

function scoreOptionVehicle(plan: OptionPlan, probability: ProbabilityResult): number {
  // Combine option suitability with probability and a slight preference for defined risk
  const base = plan.suitabilityScore * 0.6 + probability.finalScore * 0.4;
  return Math.round(base);
}

export function selectInstrument(input: SelectorInput): InstrumentRecommendation {
  const prefs = { ...DEFAULT_PREFS, ...input.prefs };
  const { setup, probability, optionsContext, incomeIntent } = input;
  const reasons: string[] = [];
  const tradeoffs: string[] = [];

  const isBullish = setup.bias === "bullish";
  const isBearish = setup.bias === "bearish";
  const conviction = probability.finalScore;
  const grade = probability.grade;

  // Build candidate plans (cheap, mock-data backed)
  const candidates: { type: InstrumentType; plan?: OptionPlan; score: number; why: string[]; tradeoff: string[] }[] = [];

  // Income / wheel intent: build CSP and/or CC explicitly and skip the
  // directional debit candidates entirely. A CSP is naturally suited to a
  // neutral-to-bullish view; a CC to a neutral-to-mildly-bullish view. Both
  // are *credit* trades, fundamentally different from a long put or a debit
  // put spread, so we must not let those win for a wheel-style request.
  if (incomeIntent) {
    const wantsPut = incomeIntent === "cash_secured_put" || incomeIntent === "wheel";
    const wantsCall = incomeIntent === "covered_call" || incomeIntent === "wheel";

    if (wantsPut && isAllowed("cash_secured_put", prefs)) {
      const plan = buildOptionPlan("cash_secured_put", setup, optionsContext);
      candidates.push({
        type: "cash_secured_put",
        plan,
        score: scoreOptionVehicle(plan, probability) + 10,
        why: [
          "Wheel-style income trade — collect premium up front",
          `Sells one ${plan.legs[0]?.strike} put expiring ~${plan.dte}d out`,
          "If assigned, you buy 100 shares at the strike (typical wheel entry)",
        ],
        tradeoff: [
          "Capital tied up as cash collateral until expiry or assignment",
          "Obligated to buy shares at the strike if the stock falls below it",
        ],
      });
    }
    if (wantsCall && isAllowed("covered_call", prefs)) {
      const plan = buildOptionPlan("covered_call", setup, optionsContext);
      candidates.push({
        type: "covered_call",
        plan,
        score: scoreOptionVehicle(plan, probability) + 10,
        why: [
          "Wheel-style income trade — collect premium on shares you own",
          `Sells one ${plan.legs[0]?.strike} call expiring ~${plan.dte}d out`,
          "Premium offsets some downside; upside capped at the strike",
        ],
        tradeoff: [
          "Caps your upside above the strike",
          "Premium does not protect against a meaningful drop in the shares",
        ],
      });
    }

    // If we built at least one income candidate, return it directly — we do
    // not want to mix in a long_put / bear_put_spread for a wheel request.
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      const alt = candidates.find((c) => c.type !== best.type) ?? null;
      reasons.push(...best.why);
      tradeoffs.push(...best.tradeoff);
      reasons.push(`Probability score ${conviction} (${grade})`);
      return {
        recommended: best.type,
        alternative: alt?.type ?? null,
        recommendedPlan: best.plan,
        alternativePlan: alt?.plan,
        vehicleScore: best.score,
        reasons: reasons.slice(0, 5),
        tradeoffs: tradeoffs.slice(0, 4),
      };
    }
    // Otherwise fall through to the standard selection below.
  }

  // Stock candidate
  if (isAllowed("stock", prefs)) {
    const stockScore = Math.round(probability.finalScore * 0.95);
    candidates.push({
      type: "stock",
      score: stockScore,
      why: ["Direct exposure with no expiry decay", "Simplest execution path", "Best when liquidity in options is poor"],
      tradeoff: ["No leverage", "Larger capital required than options"],
    });
  }

  if (isBullish) {
    if (isAllowed("long_call", prefs) && !prefs.definedRiskOnly) {
      const plan = buildOptionPlan("long_call", setup, optionsContext);
      candidates.push({
        type: "long_call",
        plan,
        score: scoreOptionVehicle(plan, probability),
        why: ["Bullish bias with capped downside (premium paid)", `~${plan.dte}d expiry near ATM`, "Leverages a strong directional move"],
        tradeoff: ["Time decay erodes value", "IV expansion required for explosive gains"],
      });
    }
    if (isAllowed("bull_call_spread", prefs)) {
      const plan = buildOptionPlan("bull_call_spread", setup, optionsContext);
      candidates.push({
        type: "bull_call_spread",
        plan,
        score: scoreOptionVehicle(plan, probability) + (prefs.definedRiskOnly ? 5 : 0),
        why: ["Defined risk and defined reward", "Lower cost than long call alone", "Profits if price reaches short strike by expiry"],
        tradeoff: ["Capped upside", "Spread fills can slip in low liquidity"],
      });
    }
  }

  if (isBearish) {
    if (isAllowed("long_put", prefs) && !prefs.definedRiskOnly) {
      const plan = buildOptionPlan("long_put", setup, optionsContext);
      candidates.push({
        type: "long_put",
        plan,
        score: scoreOptionVehicle(plan, probability),
        why: ["Bearish bias with capped downside (premium paid)", `~${plan.dte}d expiry near ATM`, "Leverages a strong directional drop"],
        tradeoff: ["Time decay erodes value", "IV crush after events hurts"],
      });
    }
    if (isAllowed("bear_put_spread", prefs)) {
      const plan = buildOptionPlan("bear_put_spread", setup, optionsContext);
      candidates.push({
        type: "bear_put_spread",
        plan,
        score: scoreOptionVehicle(plan, probability) + (prefs.definedRiskOnly ? 5 : 0),
        why: ["Defined risk and defined reward", "Lower cost than long put alone", "Profits if price reaches short strike by expiry"],
        tradeoff: ["Capped downside", "Spread fills can slip in low liquidity"],
      });
    }
  }

  if (candidates.length === 0) {
    return {
      recommended: "stock",
      alternative: null,
      vehicleScore: probability.finalScore,
      reasons: ["No allowed instruments matched preferences — defaulting to stock"],
      tradeoffs: ["Adjust trade preferences in Settings to enable other instruments"],
    };
  }

  // Heuristic preference: high-conviction directional w/ good options liquidity → long option;
  // moderate conviction or defined-risk preference → spread; weak liquidity → stock.
  candidates.sort((a, b) => b.score - a.score);

  // Boost defined-risk vehicles when probability is moderate
  if (conviction < 75) {
    for (const c of candidates) {
      if (c.type === "bull_call_spread" || c.type === "bear_put_spread") c.score += 4;
    }
    candidates.sort((a, b) => b.score - a.score);
  }

  // Penalize options if their suitability is poor (wide spreads / low OI)
  for (const c of candidates) {
    if (c.plan && c.plan.suitabilityScore < 60) {
      c.score -= 15;
      c.tradeoff.push("Options liquidity is weak — stock may be safer");
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const alt = candidates.find((c) => c.type !== best.type);

  reasons.push(...best.why);
  tradeoffs.push(...best.tradeoff);
  reasons.push(`Probability score ${conviction} (${grade})`);

  return {
    recommended: best.type,
    alternative: alt ? alt.type : null,
    recommendedPlan: best.plan,
    alternativePlan: alt?.plan,
    vehicleScore: best.score,
    reasons: reasons.slice(0, 5),
    tradeoffs: tradeoffs.slice(0, 4),
  };
}
