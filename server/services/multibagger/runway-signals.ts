import type { RunwayScore, RunwaySignalsInput, SignalEvidence } from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

export function computeRunwayScore(
  input?: RunwaySignalsInput | null,
): RunwayScore {
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  const add = (
    key: string,
    label: string,
    value: number | null | undefined,
    explanation: string,
  ) => {
    if (!isFiniteNumberInRange(value, 0, 100)) {
      unavailableSignals.push(key);
      return;
    }
    evidence.push({ key, label, value: clampScore(value), available: true, explanation });
  };

  if (
    input?.marketCapDollars != null &&
    input.addressableMarketDollars != null &&
    isFiniteNumberInRange(input.marketCapDollars, Number.MIN_VALUE) &&
    isFiniteNumberInRange(input.addressableMarketDollars, Number.MIN_VALUE)
  ) {
    const ratio = input.addressableMarketDollars / input.marketCapDollars;
    add(
      "addressableMarketHeadroom",
      "Addressable-market headroom",
      Math.min(100, Math.max(0, (Math.log10(ratio) / 2) * 100)),
      "Compares addressable market with starting market capitalization.",
    );
  } else {
    unavailableSignals.push("addressable-market headroom");
  }
  if (
    input?.annualRevenueDollars != null &&
    input.addressableMarketDollars != null &&
    isFiniteNumberInRange(input.annualRevenueDollars, 0) &&
    isFiniteNumberInRange(input.addressableMarketDollars, Number.MIN_VALUE)
  ) {
    const penetration = input.annualRevenueDollars / input.addressableMarketDollars;
    add(
      "addressableMarketPenetration",
      "Addressable-market penetration",
      (1 - Math.min(1, penetration)) * 100,
      "Lower current revenue penetration indicates more unserved economic runway, without assuming it will be captured.",
    );
  } else {
    unavailableSignals.push("addressable-market penetration");
  }
  if (isFiniteNumberInRange(input?.revenueGrowthPercent, -100, 10_000)) {
    add(
      "revenueGrowth",
      "Revenue growth runway",
      50 + (input.revenueGrowthPercent / 30) * 50,
      "Uses supplied growth as an input to runway, without extrapolating a return.",
    );
  } else {
    unavailableSignals.push("revenue growth runway");
  }
  if (
    input?.cashAndEquivalentsDollars != null &&
    input.annualCashBurnDollars != null &&
    isFiniteNumberInRange(input.cashAndEquivalentsDollars, 0) &&
    isFiniteNumberInRange(input.annualCashBurnDollars, 0)
  ) {
    const score = input.annualCashBurnDollars <= 0
      ? 90
      : Math.min(100, (input.cashAndEquivalentsDollars / input.annualCashBurnDollars / 5) * 100);
    add("cashRunway", "Cash runway", score, "Approximates years of cash coverage from supplied cash and burn values.");
  } else {
    unavailableSignals.push("cash runway");
  }
  if (isFiniteNumberInRange(input?.yearsToProfitability, 0, 100)) {
    add("yearsToProfitability", "Years to profitability", 100 - input.yearsToProfitability * 10, "Lower supplied years to profitability receive more runway quality credit.");
  } else {
    unavailableSignals.push("years to profitability");
  }
  return buildDimensionScore("runway", evidence, unavailableSignals);
}