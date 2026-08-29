import type { GrowthScore, GrowthSignalsInput, SignalEvidence } from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

function growthToScore(value: number): number {
  return clampScore(50 + (value / 30) * 50);
}

export function computeGrowthScore(
  input?: GrowthSignalsInput | null,
): GrowthScore {
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  const fields: Array<[keyof GrowthSignalsInput, string]> = [
    ["revenueGrowthYoYPercent", "Revenue growth year over year"],
    ["revenueCagr3yPercent", "Revenue three-year CAGR"],
    ["epsGrowthYoYPercent", "EPS growth year over year"],
    ["freeCashFlowGrowthYoYPercent", "Free cash flow growth year over year"],
  ];
  for (const [key, label] of fields) {
    const value = input?.[key];
    if (!isFiniteNumberInRange(value, -100, 10_000)) {
      unavailableSignals.push(key);
      continue;
    }
    evidence.push({
      key,
      label,
      value: growthToScore(value),
      available: true,
      explanation: "Growth rate is normalized into a bounded research score.",
    });
  }
  return buildDimensionScore("growth", evidence, unavailableSignals);
}