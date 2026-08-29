import type {
  DimensionScore,
  MultibaggerDimensionScores,
  MultibaggerProfile,
  ProfileScore,
  ScoreAvailability,
  SignalEvidence,
} from "./types";
import { MULTIBAGGER_MODEL_VERSION } from "./types";

export const DEFAULT_MULTIBAGGER_WEIGHTS = {
  institutional: 0.20,
  growth: 0.20,
  fundamental: 0.20,
  valuation: 0.15,
  runway: 0.15,
  optionality: 0.05,
  risk: 0.05,
} as const;

export const MULTIBAGGER_DISCLAIMER =
  "This is a deterministic research-prioritization framework, not a prediction or guarantee of 5x, 10x, 25x, or 100x returns.";

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isFiniteNumberInRange(
  value: unknown,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function scoreAvailability(
  evidence: SignalEvidence[],
  unavailableSignals: string[],
): ScoreAvailability {
  const availableCount = evidence.filter(
    (item) =>
      item.available &&
      typeof item.value === "number" &&
      Number.isFinite(item.value),
  ).length;
  if (availableCount === 0) return "unavailable";
  return unavailableSignals.length > 0 ? "partial" : "available";
}

export function buildDimensionScore<T extends DimensionScore["dimension"]>(
  dimension: T,
  evidence: SignalEvidence[],
  unavailableSignals: string[],
): DimensionScore & { dimension: T } {
  const numericEvidence = evidence.filter(
    (item): item is SignalEvidence & { value: number } =>
      item.available && typeof item.value === "number" && Number.isFinite(item.value),
  );
  const availability = scoreAvailability(evidence, unavailableSignals);
  return {
    dimension,
    score: numericEvidence.length > 0
      ? clampScore(
          numericEvidence.reduce((sum, item) => sum + item.value, 0) /
            numericEvidence.length,
        )
      : null,
    availability,
    evidence,
    unavailableSignals,
    modelVersion: MULTIBAGGER_MODEL_VERSION,
  };
}

export function weightedOverallScore(
  dimensions: MultibaggerDimensionScores,
  weights: Partial<typeof DEFAULT_MULTIBAGGER_WEIGHTS> = {},
): number | null {
  const resolved = { ...DEFAULT_MULTIBAGGER_WEIGHTS, ...weights };
  const entries = Object.entries(resolved) as Array<
    [keyof MultibaggerDimensionScores, number]
  >;
  let total = 0;
  let weightTotal = 0;
  for (const [dimension, weight] of entries) {
    const score = dimensions[dimension].score;
    if (score === null || weight <= 0) continue;
    total += score * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? clampScore(total / weightTotal) : null;
}

function profileFromWeightedDimensions(
  profile: MultibaggerProfile,
  dimensions: MultibaggerDimensionScores,
  weights: Partial<Record<keyof MultibaggerDimensionScores, number>>,
  rationale: string,
): ProfileScore {
  const evidence: SignalEvidence[] = [];
  let total = 0;
  let weightTotal = 0;
  const unavailableSignals: string[] = [];
  for (const [dimension, weight] of Object.entries(weights) as Array<
    [keyof MultibaggerDimensionScores, number]
  >) {
    const current = dimensions[dimension];
    if (current.score === null) {
      unavailableSignals.push(`${dimension} score`);
      continue;
    }
    total += current.score * weight;
    weightTotal += weight;
    evidence.push({
      key: dimension,
      label: `${dimension} dimension`,
      value: current.score,
      available: true,
      explanation: `Contributes the ${dimension} dimension score to this profile.`,
    });
  }
  const score = weightTotal > 0 ? clampScore(total / weightTotal) : null;
  return {
    profile,
    score,
    availability: score === null
      ? "unavailable"
      : unavailableSignals.length > 0
        ? "partial"
        : "available",
    eligible: score !== null,
    rationale: unavailableSignals.length > 0
      ? `${rationale} Missing: ${unavailableSignals.join(", ")}.`
      : rationale,
    evidence,
    modelVersion: MULTIBAGGER_MODEL_VERSION,
  };
}

function startingMarketCapitalizationScore(
  marketCapDollars: number | null | undefined,
): number | null {
  if (
    marketCapDollars === null ||
    marketCapDollars === undefined ||
    !Number.isFinite(marketCapDollars) ||
    marketCapDollars <= 0
  ) {
    return null;
  }
  if (marketCapDollars <= 1_000_000_000) return 100;
  if (marketCapDollars <= 5_000_000_000) return 80;
  if (marketCapDollars <= 20_000_000_000) return 55;
  if (marketCapDollars <= 100_000_000_000) return 25;
  return 5;
}

function economicRunwayScore(
  marketCapDollars: number | null | undefined,
  addressableMarketDollars: number | null | undefined,
): number | null {
  if (
    marketCapDollars === null ||
    marketCapDollars === undefined ||
    addressableMarketDollars === null ||
    addressableMarketDollars === undefined ||
    !Number.isFinite(marketCapDollars) ||
    !Number.isFinite(addressableMarketDollars) ||
    marketCapDollars <= 0 ||
    addressableMarketDollars <= 0
  ) {
    return null;
  }
  const ratio = addressableMarketDollars / marketCapDollars;
  if (ratio >= 100) return 100;
  if (ratio >= 25) return 85;
  if (ratio >= 10) return 70;
  if (ratio >= 3) return 45;
  return 15;
}

/**
 * 100x optionality deliberately has its own two-part test. It is not a
 * higher threshold applied to the overall score: starting capitalization and
 * economic runway are both required and remain separately visible.
 */
export function computeHundredXOptionalityProfile(input: {
  marketCapDollars?: number | null;
  addressableMarketDollars?: number | null;
}): ProfileScore {
  const startScore = startingMarketCapitalizationScore(input.marketCapDollars);
  const runwayScore = economicRunwayScore(
    input.marketCapDollars,
    input.addressableMarketDollars,
  );
  const evidence: SignalEvidence[] = [
    {
      key: "startingMarketCapitalization",
      label: "Starting market capitalization",
      value: startScore,
      available: startScore !== null,
      explanation: "Smaller starting capitalization leaves more room for scale, without implying an outcome.",
    },
    {
      key: "economicRunway",
      label: "Economic runway",
      value: runwayScore,
      available: runwayScore !== null,
      explanation: "Compares addressable market dollars with starting market capitalization.",
    },
  ];
  const unavailableSignals = evidence
    .filter((item) => !item.available)
    .map((item) => item.key);
  const available = evidence.filter(
    (item): item is SignalEvidence & { value: number } =>
      item.available && typeof item.value === "number",
  );
  const score = available.length === 2
    ? clampScore((available[0].value + available[1].value) / 2)
    : null;
  return {
    profile: "HUNDRED_X_OPTIONALITY",
    score,
    availability: score === null
      ? "unavailable"
      : unavailableSignals.length > 0
        ? "partial"
        : "available",
    eligible: score !== null,
    rationale: score === null
      ? `100x optionality requires both starting market capitalization and economic runway. Missing: ${unavailableSignals.join(", ")}.`
      : "100x optionality uses separate starting-capitalization and economic-runway evidence; it is not derived from the overall score.",
    evidence,
    modelVersion: MULTIBAGGER_MODEL_VERSION,
  };
}

export function computeProfileScores(
  dimensions: MultibaggerDimensionScores,
  input: {
    marketCapDollars?: number | null;
    addressableMarketDollars?: number | null;
  },
): Record<MultibaggerProfile, ProfileScore> {
  const profiles = {
    COMPOUNDER: profileFromWeightedDimensions(
      "COMPOUNDER",
      dimensions,
      { growth: 0.40, fundamental: 0.35, risk: 0.25 },
      "Emphasizes repeatable growth, business quality, and risk evidence.",
    ),
    FIVE_X_POTENTIAL: profileFromWeightedDimensions(
      "FIVE_X_POTENTIAL",
      dimensions,
      { growth: 0.30, fundamental: 0.25, valuation: 0.20, runway: 0.15, institutional: 0.10 },
      "Balances growth, quality, valuation, runway, and institutional evidence.",
    ),
    TEN_X_POTENTIAL: profileFromWeightedDimensions(
      "TEN_X_POTENTIAL",
      dimensions,
      { growth: 0.25, runway: 0.30, valuation: 0.15, institutional: 0.15, fundamental: 0.15 },
      "Places more emphasis on economic runway while retaining quality and ownership context.",
    ),
    TWENTY_FIVE_X_OPTIONALITY: profileFromWeightedDimensions(
      "TWENTY_FIVE_X_OPTIONALITY",
      dimensions,
      { optionality: 0.50, runway: 0.25, growth: 0.15, risk: 0.10 },
      "Uses explicit optionality and runway evidence rather than simply raising an overall-score cutoff.",
    ),
    HUNDRED_X_OPTIONALITY: computeHundredXOptionalityProfile(input),
  };
  return profiles;
}