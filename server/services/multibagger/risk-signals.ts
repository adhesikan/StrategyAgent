import type { RiskScore, RiskSignalsInput, SignalEvidence } from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

export function computeRiskScore(input?: RiskSignalsInput | null): RiskScore {
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  const add = (
    key: string,
    label: string,
    value: number | null | undefined,
    score: number,
    explanation: string,
    minimum: number,
    maximum: number,
  ) => {
    if (!isFiniteNumberInRange(value, minimum, maximum)) {
      unavailableSignals.push(key);
      return;
    }
    evidence.push({ key, label, value: clampScore(score), available: true, explanation });
  };
  add("annualizedVolatilityPercent", "Annualized volatility", input?.annualizedVolatilityPercent, 100 - (input?.annualizedVolatilityPercent ?? 0) * 2, "Lower volatility receives a higher risk-quality score.", 0, 1_000);
  add("maxDrawdownPercent", "Maximum drawdown", input?.maxDrawdownPercent, 100 - (input?.maxDrawdownPercent ?? 0) * 1.5, "Lower drawdown receives a higher risk-quality score.", 0, 100);
  add("debtToEquity", "Debt to equity", input?.debtToEquity, 100 - (input?.debtToEquity ?? 0) * 30, "Lower leverage receives a higher risk-quality score.", 0, 100);
  add("customerConcentrationPercent", "Customer concentration", input?.customerConcentrationPercent, 100 - (input?.customerConcentrationPercent ?? 0), "Lower concentration receives a higher risk-quality score.", 0, 100);
  if (input?.regulatoryRisk) {
    const regulatoryScore = { low: 90, medium: 55, high: 20 }[input.regulatoryRisk];
    add("regulatoryRisk", "Regulatory risk", 1, regulatoryScore, "Qualitative regulatory-risk input supplied by the data provider.", 1, 1);
  } else {
    unavailableSignals.push("regulatory risk");
  }
  return buildDimensionScore("risk", evidence, unavailableSignals);
}