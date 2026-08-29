import type {
  FundamentalQualityScore,
  FundamentalSignalsInput,
  SignalEvidence,
} from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

function bounded(value: number, low: number, high: number): number {
  return clampScore(((value - low) / (high - low)) * 100);
}

export function computeFundamentalQualityScore(
  input?: FundamentalSignalsInput | null,
): FundamentalQualityScore {
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  const add = (
    key: keyof FundamentalSignalsInput,
    label: string,
    value: number | null | undefined,
    score: number,
    minimum: number,
    maximum: number,
  ) => {
    if (!isFiniteNumberInRange(value, minimum, maximum)) {
      unavailableSignals.push(key);
      return;
    }
    evidence.push({
      key,
      label,
      value: score,
      available: true,
      explanation: "Fundamental quality is scored from the supplied normalized financial metric.",
    });
  };
  add("grossMarginPercent", "Gross margin", input?.grossMarginPercent, bounded(input?.grossMarginPercent ?? 0, 0, 100), -100, 100);
  add("operatingMarginPercent", "Operating margin", input?.operatingMarginPercent, bounded(input?.operatingMarginPercent ?? 0, -20, 60), -500, 100);
  add("freeCashFlowMarginPercent", "Free cash flow margin", input?.freeCashFlowMarginPercent, bounded(input?.freeCashFlowMarginPercent ?? 0, -20, 40), -500, 100);
  add("returnOnInvestedCapitalPercent", "Return on invested capital", input?.returnOnInvestedCapitalPercent, bounded(input?.returnOnInvestedCapitalPercent ?? 0, -20, 40), -500, 1_000);
  add("debtToEquity", "Debt to equity", input?.debtToEquity, clampScore(100 - (input?.debtToEquity ?? 0) * 30), 0, 100);
  add("earningsStabilityPercent", "Earnings stability", input?.earningsStabilityPercent, bounded(input?.earningsStabilityPercent ?? 0, 0, 100), 0, 100);
  return buildDimensionScore("fundamental", evidence, unavailableSignals);
}