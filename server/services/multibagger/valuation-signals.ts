import type {
  SignalEvidence,
  ValuationScore,
  ValuationSignalsInput,
} from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

function multipleToScore(value: number): number {
  if (value <= 10) return 100;
  if (value >= 50) return 0;
  return clampScore(100 - ((value - 10) / 40) * 100);
}

export function computeValuationScore(
  input?: ValuationSignalsInput | null,
): ValuationScore {
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  const add = (key: string, label: string, value: number | null | undefined) => {
    if (!isFiniteNumberInRange(value, 0, 10_000)) {
      unavailableSignals.push(key);
      return;
    }
    evidence.push({
      key,
      label,
      value: multipleToScore(value),
      available: true,
      explanation: "Valuation multiple is normalized for comparative research; it is not a target-price model.",
    });
  };
  const validMultiple = (value: unknown): value is number =>
    isFiniteNumberInRange(value, 0, 10_000);
  add("forwardPriceToEarnings", "Forward price-to-earnings", input?.forwardPriceToEarnings);
  if (validMultiple(input?.priceToSales)) {
    add("priceToSales", "Price-to-sales", input.priceToSales);
  } else if (
    input?.marketCapDollars != null &&
    input.revenueDollars != null &&
    isFiniteNumberInRange(input.marketCapDollars, 0) &&
    isFiniteNumberInRange(input.revenueDollars, Number.MIN_VALUE)
  ) {
    add("derivedPriceToSales", "Derived price-to-sales", input.marketCapDollars / input.revenueDollars);
  } else {
    unavailableSignals.push("price-to-sales");
  }
  if (validMultiple(input?.enterpriseValueToRevenue)) {
    add(
      "enterpriseValueToRevenue",
      "Enterprise-value-to-revenue",
      input.enterpriseValueToRevenue,
    );
  } else if (
    input?.enterpriseValueDollars != null &&
    input.revenueDollars != null &&
    isFiniteNumberInRange(input.enterpriseValueDollars, 0) &&
    isFiniteNumberInRange(input.revenueDollars, Number.MIN_VALUE)
  ) {
    add("derivedEnterpriseValueToRevenue", "Derived enterprise-value-to-revenue", input.enterpriseValueDollars / input.revenueDollars);
  } else {
    unavailableSignals.push("enterprise-value-to-revenue");
  }
  return buildDimensionScore("valuation", evidence, unavailableSignals);
}