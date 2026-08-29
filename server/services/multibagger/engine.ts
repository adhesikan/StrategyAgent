import { computeFundamentalQualityScore } from "./fundamental-signals";
import { computeGrowthScore } from "./growth-signals";
import { computeInstitutionalDiscoveryScore } from "./institutional-signals";
import { computeRunwayScore } from "./runway-signals";
import { computeRiskScore } from "./risk-signals";
import {
  buildDimensionScore,
  computeProfileScores,
  MULTIBAGGER_DISCLAIMER,
  weightedOverallScore,
} from "./scoring";
import { computeValuationScore } from "./valuation-signals";
import type {
  MultibaggerDiscoveryInput,
  MultibaggerDiscoveryResult,
  MultibaggerDimensionScores,
  OptionalityScore,
  OverallMultibaggerScore,
  SignalEvidence,
} from "./types";
import { MULTIBAGGER_MODEL_VERSION } from "./types";

export function computeOptionalityScore(
  input: MultibaggerDiscoveryInput,
): OptionalityScore {
  const marketCap = input.runway?.marketCapDollars ?? input.valuation?.marketCapDollars;
  const addressableMarket = input.runway?.addressableMarketDollars;
  const evidence: SignalEvidence[] = [];
  const unavailableSignals: string[] = [];
  if (Number.isFinite(marketCap) && marketCap != null && marketCap > 0) {
    evidence.push({
      key: "startingMarketCapitalization",
      label: "Starting market capitalization",
      value: marketCap <= 1_000_000_000 ? 100 : marketCap <= 20_000_000_000 ? 60 : 20,
      available: true,
      explanation: "Small starting capitalization can provide scale optionality; it is not a return forecast.",
    });
  } else {
    unavailableSignals.push("starting market capitalization");
  }
  if (
    Number.isFinite(marketCap) &&
    marketCap != null &&
    marketCap > 0 &&
    Number.isFinite(addressableMarket) &&
    addressableMarket != null &&
    addressableMarket > 0
  ) {
    evidence.push({
      key: "economicRunway",
      label: "Economic runway",
      value: Math.min(100, Math.max(0, Math.log10(addressableMarket / marketCap) * 50)),
      available: true,
      explanation: "Addressable-market headroom is kept separate from the overall score.",
    });
  } else {
    unavailableSignals.push("economic runway");
  }
  return buildDimensionScore("optionality", evidence, unavailableSignals);
}

export function computeMultibaggerDiscovery(
  input: MultibaggerDiscoveryInput,
): MultibaggerDiscoveryResult {
  const dimensions: MultibaggerDimensionScores = {
    institutional: computeInstitutionalDiscoveryScore(input),
    growth: computeGrowthScore(input.growth),
    fundamental: computeFundamentalQualityScore(input.fundamental),
    valuation: computeValuationScore(input.valuation),
    runway: computeRunwayScore(input.runway),
    optionality: computeOptionalityScore(input),
    risk: computeRiskScore(input.risk),
  };
  const profiles = computeProfileScores(dimensions, {
    marketCapDollars: input.runway?.marketCapDollars ?? input.valuation?.marketCapDollars,
    addressableMarketDollars: input.runway?.addressableMarketDollars,
  });
  const score = weightedOverallScore(dimensions);
  const availableDimensionCount = Object.values(dimensions).filter(
    (dimension) => dimension.score !== null,
  ).length;
  const overall: OverallMultibaggerScore = {
    score,
    availability: score === null
      ? "unavailable"
      : availableDimensionCount < 4
        ? "partial"
        : "available",
    confidence: score === null
      ? "unavailable"
      : availableDimensionCount >= 6
        ? "high"
        : availableDimensionCount >= 3
          ? "moderate"
          : "limited",
    dimensions,
    profileScores: profiles,
    modelVersion: MULTIBAGGER_MODEL_VERSION,
    disclaimer: MULTIBAGGER_DISCLAIMER,
  };
  const unavailable = Object.values(dimensions)
    .flatMap((dimension) => dimension.unavailableSignals.map(
      (signal: string) => `${dimension.dimension}: ${signal}`,
    ));
  return {
    symbol: input.symbol.trim().toUpperCase(),
    modelVersion: MULTIBAGGER_MODEL_VERSION,
    dimensions,
    overall,
    profiles,
    availableDimensionCount,
    unavailableDimensionCount: Object.keys(dimensions).length - availableDimensionCount,
    limitations: [
      ...unavailable.map((signal) => `Unavailable input — ${signal}.`),
      "Scores are descriptive research signals and do not predict or guarantee investment returns.",
    ],
    disclaimer: MULTIBAGGER_DISCLAIMER,
  };
}