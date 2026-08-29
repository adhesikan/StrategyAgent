import {
  MULTIBAGGER_MODEL_VERSION,
  MULTIBAGGER_RUNWAY_MODEL_VERSION,
} from "./types";
import type {
  MarketCapRunway,
  MarketCapRunwayConstraint,
  OptionalUpsideProfile,
  OptionalUpsideProfileKey,
  OptionalUpsideProfiles,
  RunwayDataQuality,
  RunwayFactor,
  RunwayScore,
  RunwaySignalsInput,
  SignalEvidence,
} from "./types";
import {
  buildDimensionScore,
  clampScore,
  isFiniteNumberInRange,
} from "./scoring";

export const RUNWAY_OPTIONALITY_MODEL = {
  version: MULTIBAGGER_RUNWAY_MODEL_VERSION,
  minimumSupportiveCurrentMarketCap: {
    "5x": 20_000_000_000,
    "10x": 10_000_000_000,
    "25x": 5_000_000_000,
    "100x": 1_000_000_000,
  },
  multiples: {
    "5x": 5,
    "10x": 10,
    "25x": 25,
    "100x": 100,
  },
} as const;

const PROFILE_KEYS = ["5x", "10x", "25x", "100x"] as const;

interface NormalizedRunwayInputs {
  currentMarketCap: number | null;
  revenue: number | null;
  revenueGrowth: number | null;
  addressableMarketDollars: number | null;
  addressableMarketReliable: boolean;
  industryGrowthPercent: number | null;
  operatingMarginPercent: number | null;
  freeCashFlowMarginPercent: number | null;
  freeCashFlowGrowthPercent: number | null;
  freeCashFlowPositive: boolean | null;
  shareDilutionPercent: number | null;
  balanceSheetStrength: number | null;
  cashAndEquivalentsDollars: number | null;
  annualCashBurnDollars: number | null;
  yearsToProfitability: number | null;
}

function normalizeInput(
  input?: RunwaySignalsInput | null,
): NormalizedRunwayInputs {
  const currentMarketCap =
    input?.currentMarketCap ?? input?.marketCapDollars ?? null;
  const revenue = input?.revenue ?? input?.annualRevenueDollars ?? null;
  const revenueGrowth =
    input?.revenueGrowth ?? input?.revenueGrowthPercent ?? null;
  return {
    currentMarketCap: isFiniteNumberInRange(currentMarketCap, Number.MIN_VALUE)
      ? currentMarketCap
      : null,
    revenue: isFiniteNumberInRange(revenue, Number.MIN_VALUE) ? revenue : null,
    revenueGrowth: isFiniteNumberInRange(revenueGrowth, -100, 10_000)
      ? revenueGrowth
      : null,
    addressableMarketDollars:
      input?.addressableMarketReliable === true &&
      isFiniteNumberInRange(
        input?.addressableMarketDollars,
        Number.MIN_VALUE,
      )
        ? input.addressableMarketDollars
        : null,
    addressableMarketReliable:
      input?.addressableMarketReliable === true &&
      isFiniteNumberInRange(
        input?.addressableMarketDollars,
        Number.MIN_VALUE,
      ),
    industryGrowthPercent: isFiniteNumberInRange(
      input?.industryGrowthPercent,
      -100,
      10_000,
    )
      ? input.industryGrowthPercent
      : null,
    operatingMarginPercent: isFiniteNumberInRange(
      input?.operatingMarginPercent,
      -100,
      100,
    )
      ? input.operatingMarginPercent
      : null,
    freeCashFlowMarginPercent: isFiniteNumberInRange(
      input?.freeCashFlowMarginPercent,
      -100,
      100,
    )
      ? input.freeCashFlowMarginPercent
      : null,
    freeCashFlowGrowthPercent: isFiniteNumberInRange(
      input?.freeCashFlowGrowthPercent,
      -100,
      10_000,
    )
      ? input.freeCashFlowGrowthPercent
      : null,
    freeCashFlowPositive:
      typeof input?.freeCashFlowPositive === "boolean"
        ? input.freeCashFlowPositive
        : null,
    shareDilutionPercent: isFiniteNumberInRange(
      input?.shareDilutionPercent,
      0,
      100,
    )
      ? input.shareDilutionPercent
      : null,
    balanceSheetStrength: isFiniteNumberInRange(
      input?.balanceSheetStrength,
      0,
      100,
    )
      ? input.balanceSheetStrength
      : null,
    cashAndEquivalentsDollars: isFiniteNumberInRange(
      input?.cashAndEquivalentsDollars,
      0,
    )
      ? input.cashAndEquivalentsDollars
      : null,
    annualCashBurnDollars: isFiniteNumberInRange(
      input?.annualCashBurnDollars,
      0,
    )
      ? input.annualCashBurnDollars
      : null,
    yearsToProfitability: isFiniteNumberInRange(
      input?.yearsToProfitability,
      0,
      100,
    )
      ? input.yearsToProfitability
      : null,
  };
}

function percentageScore(value: number, midpoint: number): number {
  return clampScore(50 + (value / midpoint) * 50);
}

function marketCapScore(value: number): number {
  if (value <= 1_000_000_000) return 100;
  if (value <= 5_000_000_000) return 85;
  if (value <= 20_000_000_000) return 65;
  if (value <= 100_000_000_000) return 35;
  return 10;
}

function economicRunwayScore(
  addressableMarketDollars: number | null,
  targetMarketCap: number | null,
): number | null {
  if (
    addressableMarketDollars === null ||
    targetMarketCap === null ||
    targetMarketCap <= 0
  ) {
    return null;
  }
  const ratio = addressableMarketDollars / targetMarketCap;
  if (ratio >= 2) return 100;
  if (ratio >= 1) return 75;
  if (ratio >= 0.5) return 45;
  return 0;
}

function buildDataQuality(
  availableInputs: string[],
  unavailableInputs: string[],
  warnings: string[] = [],
): RunwayDataQuality {
  return {
    status:
      availableInputs.length === 0
        ? "INSUFFICIENT_DATA"
        : unavailableInputs.length === 0
          ? "COMPLETE"
          : "PARTIAL",
    availableInputs: [...availableInputs],
    unavailableInputs: [...unavailableInputs],
    warnings: [
      "This runway and optionality model is a deterministic constraint screen, not a forecast or a certainty claim.",
      ...warnings,
    ],
    modelVersion: MULTIBAGGER_RUNWAY_MODEL_VERSION,
  };
}

function factor(
  code: string,
  label: string,
  value: number | string | null,
  explanation: string,
): RunwayFactor {
  return { code, label, value, explanation };
}

function buildMarketCapRunway(
  values: NormalizedRunwayInputs,
): MarketCapRunway {
  const targetMarketCaps = Object.fromEntries(
    PROFILE_KEYS.map((key) => [
      key,
      values.currentMarketCap === null ||
      values.currentMarketCap >
        Number.MAX_VALUE / RUNWAY_OPTIONALITY_MODEL.multiples[key]
        ? null
        : values.currentMarketCap *
          RUNWAY_OPTIONALITY_MODEL.multiples[key],
    ]),
  ) as Record<OptionalUpsideProfileKey, number | null>;
  const constraints = Object.fromEntries(
    PROFILE_KEYS.map((key) => {
      const current = values.currentMarketCap;
      const maximum =
        RUNWAY_OPTIONALITY_MODEL.minimumSupportiveCurrentMarketCap[key];
      const constraint: MarketCapRunwayConstraint = {
        status:
          current === null
            ? "UNAVAILABLE"
            : current <= maximum
              ? "SUPPORTS"
              : "CONSTRAINS",
        currentMarketCap: current,
        targetMarketCap: targetMarketCaps[key],
        maximumSupportiveCurrentMarketCap: maximum,
        explanation:
          current === null
            ? "Current market capitalization is unavailable."
            : current <= maximum
              ? `Current market capitalization is within the model's supportive range for ${key} scale.`
              : `Current market capitalization is above the model's supportive range for ${key} scale; this does not make the outcome impossible, but materially limits the profile.`,
      };
      return [key, constraint];
    }),
  ) as Record<OptionalUpsideProfileKey, MarketCapRunwayConstraint>;
  return {
    currentMarketCap: values.currentMarketCap,
    addressableMarketDollars: values.addressableMarketDollars,
    addressableMarketReliable: values.addressableMarketReliable,
    addressableMarketToCurrentCapRatio:
      values.addressableMarketDollars !== null &&
      values.currentMarketCap !== null
        ? values.addressableMarketDollars / values.currentMarketCap
        : null,
    targetMarketCaps,
    constraints,
    modelVersion: MULTIBAGGER_RUNWAY_MODEL_VERSION,
  };
}

function profileDataQuality(
  values: NormalizedRunwayInputs,
  requiredTAM: boolean,
): RunwayDataQuality {
  const available: string[] = [];
  const unavailable: string[] = [];
  const add = (key: string, present: boolean) =>
    (present ? available : unavailable).push(key);
  add("currentMarketCap", values.currentMarketCap !== null);
  add("revenue", values.revenue !== null);
  add("revenueGrowth", values.revenueGrowth !== null);
  add("addressableMarket", values.addressableMarketDollars !== null);
  add(
    "operatingMargin",
    values.operatingMarginPercent !== null,
  );
  add(
    "freeCashFlowCharacteristics",
    values.freeCashFlowPositive !== null ||
      values.freeCashFlowMarginPercent !== null ||
      values.freeCashFlowGrowthPercent !== null,
  );
  add("shareDilution", values.shareDilutionPercent !== null);
  add("balanceSheetStrength", values.balanceSheetStrength !== null);
  const quality = buildDataQuality(
    available,
    unavailable,
    requiredTAM && values.addressableMarketDollars === null
      ? ["Reliable addressable-market data is unavailable; no TAM value was inferred."]
      : [],
  );
  if (
    values.currentMarketCap === null ||
    values.revenue === null ||
    values.revenueGrowth === null ||
    (requiredTAM && values.addressableMarketDollars === null)
  ) {
    quality.status = "INSUFFICIENT_DATA";
  }
  return quality;
}

function createOptionalUpsideProfile(
  key: OptionalUpsideProfileKey,
  values: NormalizedRunwayInputs,
  marketCapRunway: MarketCapRunway,
): OptionalUpsideProfile {
  const multiple = RUNWAY_OPTIONALITY_MODEL.multiples[key];
  const requiresTAM = multiple >= 25;
  const quality = profileDataQuality(values, requiresTAM);
  const supportingFactors: RunwayFactor[] = [];
  const limitingFactors: RunwayFactor[] = [];
  const addScore = (
    code: string,
    label: string,
    score: number | null,
    weight: number,
    positiveWhenAtLeast = 70,
  ) => {
    if (score === null) return;
    if (score >= positiveWhenAtLeast) {
      supportingFactors.push(
        factor(code, label, score, `${label} supports the ${key} constraint screen.`),
      );
    } else {
      limitingFactors.push(
        factor(code, label, score, `${label} limits the ${key} constraint screen.`),
      );
    }
    scores.push({ score, weight });
  };
  const scores: Array<{ score: number; weight: number }> = [];
  const current = values.currentMarketCap;
  const target = marketCapRunway.targetMarketCaps[key];
  const maximum =
    RUNWAY_OPTIONALITY_MODEL.minimumSupportiveCurrentMarketCap[key];
  const capScore =
    current === null
      ? null
      : current <= maximum
        ? 100
        : current <= maximum * 5
          ? 45
          : 10;
  addScore(
    "marketCapConstraint",
    "Current market-cap constraint",
    capScore,
    0.3,
  );
  const tamScore = requiresTAM
    ? values.addressableMarketDollars === null
      ? null
      : economicRunwayScore(values.addressableMarketDollars, target)
    : values.addressableMarketDollars === null
      ? null
      : economicRunwayScore(values.addressableMarketDollars, target);
  addScore("economicRunway", "Addressable-market runway", tamScore, 0.3);
  const targetMarketCapToRevenue =
    target !== null && values.revenue !== null
      ? target / values.revenue
      : null;
  const revenueFeasibilityScore =
    targetMarketCapToRevenue === null
      ? null
      : targetMarketCapToRevenue <= 10
        ? 100
        : targetMarketCapToRevenue <= 20
          ? 75
          : targetMarketCapToRevenue <= 50
            ? 45
            : 10;
  addScore(
    "revenueFeasibility",
    "Target market-cap to current-revenue constraint",
    revenueFeasibilityScore,
    0.2,
  );
  addScore(
    "revenueGrowth",
    "Revenue growth",
    values.revenueGrowth === null
      ? null
      : percentageScore(values.revenueGrowth, 30),
    0.2,
  );
  addScore(
    "industryGrowth",
    "Industry growth",
    values.industryGrowthPercent === null
      ? null
      : percentageScore(values.industryGrowthPercent, 20),
    0.1,
  );
  addScore(
    "operatingMargin",
    "Operating margin",
    values.operatingMarginPercent === null
      ? null
      : percentageScore(values.operatingMarginPercent, 25),
    0.1,
  );
  const fcfScore =
    values.freeCashFlowPositive === null &&
    values.freeCashFlowMarginPercent === null &&
    values.freeCashFlowGrowthPercent === null
      ? null
      : clampScore(
          [
            values.freeCashFlowPositive === null
              ? null
              : values.freeCashFlowPositive
                ? 80
                : 20,
            values.freeCashFlowMarginPercent === null
              ? null
              : percentageScore(values.freeCashFlowMarginPercent, 20),
            values.freeCashFlowGrowthPercent === null
              ? null
              : percentageScore(values.freeCashFlowGrowthPercent, 30),
          ]
            .filter((score): score is number => score !== null)
            .reduce((sum, score, _, all) => sum + score / all.length, 0),
        );
  addScore(
    "freeCashFlowCharacteristics",
    "Free-cash-flow characteristics",
    fcfScore,
    0.1,
  );
  addScore(
    "balanceSheetStrength",
    "Balance-sheet strength",
    values.balanceSheetStrength,
    0.1,
  );
  const dilutionScore =
    values.shareDilutionPercent === null
      ? null
      : clampScore(100 - values.shareDilutionPercent * 3);
  addScore("shareDilution", "Share dilution", dilutionScore, 0.1);

  if (requiresTAM && values.addressableMarketDollars === null) {
    limitingFactors.push(
      factor(
        "missingReliableTAM",
        "Reliable addressable-market data",
        null,
        `The ${key} profile requires a reliable addressable-market input; no TAM was guessed.`,
      ),
    );
  }
  if (current !== null && current > maximum) {
    limitingFactors.push(
      factor(
        "marketCapAboveSupportiveRange",
        "Current market capitalization",
        current,
        `A ${key} outcome would require scaling from a market capitalization above the model's supportive range.`,
      ),
    );
  }
  if (
    targetMarketCapToRevenue !== null &&
    targetMarketCapToRevenue > 50
  ) {
    limitingFactors.push(
      factor(
        "targetMarketCapRevenueConstraint",
        "Target market cap relative to current revenue",
        targetMarketCapToRevenue,
        `At unchanged revenue, the ${key} target would exceed 50 times current revenue; the model does not assume future revenue growth will close that gap.`,
      ),
    );
  }
  if (values.shareDilutionPercent !== null && values.shareDilutionPercent >= 20) {
    limitingFactors.push(
      factor(
        "highShareDilution",
        "Share dilution",
        values.shareDilutionPercent,
        "High dilution reduces per-share optionality even if enterprise value grows.",
      ),
    );
  }
  if (values.balanceSheetStrength !== null && values.balanceSheetStrength <= 25) {
    limitingFactors.push(
      factor(
        "weakBalanceSheet",
        "Balance-sheet strength",
        values.balanceSheetStrength,
        "Weak balance-sheet strength can shorten the runway needed to fund growth.",
      ),
    );
  }

  const requiredInputsPresent =
    current !== null &&
    values.revenue !== null &&
    values.revenueGrowth !== null &&
    (!requiresTAM || values.addressableMarketDollars !== null);
  const score =
    requiredInputsPresent && scores.length > 0
      ? clampScore(
          scores.reduce((total, item) => total + item.score * item.weight, 0) /
            scores.reduce((total, item) => total + item.weight, 0),
        )
      : null;
  let classification: OptionalUpsideProfile["classification"];
  if (!requiredInputsPresent || score === null) {
    classification = "INSUFFICIENT_DATA";
  } else if (
    (values.shareDilutionPercent !== null &&
      values.shareDilutionPercent >= 30) ||
    (values.balanceSheetStrength !== null &&
      values.balanceSheetStrength <= 25) ||
    (targetMarketCapToRevenue !== null &&
      targetMarketCapToRevenue > 100)
  ) {
    classification = "WEAK_PROFILE";
  } else if (
    score >= 75 &&
    (values.shareDilutionPercent === null ||
      values.shareDilutionPercent < 20) &&
    (values.balanceSheetStrength === null ||
      values.balanceSheetStrength > 25) &&
    !(current !== null && current > maximum)
  ) {
    classification = "STRONG_PROFILE";
  } else if (score >= 55 && !(current !== null && current > maximum * 5)) {
    classification = "MODERATE_PROFILE";
  } else {
    classification = "WEAK_PROFILE";
  }
  return {
    multiple,
    classification,
    score,
    supportingFactors,
    limitingFactors,
    dataQuality: quality,
    modelVersion: MULTIBAGGER_RUNWAY_MODEL_VERSION,
  };
}

export function computeOptionalUpsideProfiles(
  input?: RunwaySignalsInput | null,
): OptionalUpsideProfiles {
  const values = normalizeInput(input);
  const marketCapRunway = buildMarketCapRunway(values);
  return Object.fromEntries(
    PROFILE_KEYS.map((key) => [
      key,
      createOptionalUpsideProfile(key, values, marketCapRunway),
    ]),
  ) as OptionalUpsideProfiles;
}

export function computeMarketCapRunway(
  input?: RunwaySignalsInput | null,
): MarketCapRunway {
  return buildMarketCapRunway(normalizeInput(input));
}

export function computeRunwayScore(
  input?: RunwaySignalsInput | null,
): RunwayScore {
  const values = normalizeInput(input);
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

  if (values.currentMarketCap !== null) {
    add(
      "startingMarketCapitalization",
      "Starting market capitalization",
      marketCapScore(values.currentMarketCap),
      "Starting market capitalization constrains how much absolute value must be created at each upside multiple.",
    );
  } else {
    unavailableSignals.push("starting market capitalization");
  }
  if (
    values.currentMarketCap !== null &&
    values.addressableMarketDollars !== null
  ) {
    const ratio =
      values.addressableMarketDollars / values.currentMarketCap;
    add(
      "addressableMarketHeadroom",
      "Addressable-market headroom",
      Math.min(100, Math.max(0, (Math.log10(ratio) / 2) * 100)),
      "Compares reliable addressable-market data with starting market capitalization; no TAM is inferred.",
    );
  } else {
    unavailableSignals.push("addressable-market headroom");
  }
  if (
    values.revenue !== null &&
    values.addressableMarketDollars !== null
  ) {
    const penetration = values.revenue / values.addressableMarketDollars;
    add(
      "addressableMarketPenetration",
      "Addressable-market penetration",
      (1 - Math.min(1, penetration)) * 100,
      "Lower current revenue penetration indicates more unserved economic runway, without assuming it will be captured.",
    );
  } else {
    unavailableSignals.push("addressable-market penetration");
  }
  if (values.revenueGrowth !== null) {
    add(
      "revenueGrowth",
      "Revenue growth runway",
      50 + (values.revenueGrowth / 30) * 50,
      "Uses supplied growth as an input to runway, without extrapolating a return.",
    );
  } else {
    unavailableSignals.push("revenue growth runway");
  }
  if (
    values.cashAndEquivalentsDollars !== null &&
    values.annualCashBurnDollars !== null
  ) {
    const score = values.annualCashBurnDollars <= 0
      ? 90
      : Math.min(
          100,
          (values.cashAndEquivalentsDollars /
            values.annualCashBurnDollars /
            5) *
            100,
        );
    add("cashRunway", "Cash runway", score, "Approximates years of cash coverage from supplied cash and burn values.");
  } else {
    unavailableSignals.push("cash runway");
  }
  if (values.yearsToProfitability !== null) {
    add(
      "yearsToProfitability",
      "Years to profitability",
      100 - values.yearsToProfitability * 10,
      "Lower supplied years to profitability receive more runway quality credit.",
    );
  } else {
    unavailableSignals.push("years to profitability");
  }
  if (values.industryGrowthPercent !== null) {
    add(
      "industryGrowth",
      "Industry growth",
      percentageScore(values.industryGrowthPercent, 20),
      "Industry growth provides context for company growth but does not guarantee capture.",
    );
  } else {
    unavailableSignals.push("industry growth");
  }
  if (values.operatingMarginPercent !== null) {
    add(
      "operatingMargin",
      "Operating margin",
      percentageScore(values.operatingMarginPercent, 25),
      "Operating margin helps indicate whether growth can become economically durable.",
    );
  } else {
    unavailableSignals.push("operating margin");
  }
  if (
    values.freeCashFlowPositive !== null ||
    values.freeCashFlowMarginPercent !== null ||
    values.freeCashFlowGrowthPercent !== null
  ) {
    const fcfValues = [
      values.freeCashFlowPositive === null
        ? null
        : values.freeCashFlowPositive
          ? 80
          : 20,
      values.freeCashFlowMarginPercent === null
        ? null
        : percentageScore(values.freeCashFlowMarginPercent, 20),
      values.freeCashFlowGrowthPercent === null
        ? null
        : percentageScore(values.freeCashFlowGrowthPercent, 30),
    ].filter((value): value is number => value !== null);
    add(
      "freeCashFlowCharacteristics",
      "Free-cash-flow characteristics",
      fcfValues.reduce((sum, value) => sum + value, 0) / fcfValues.length,
      "Free-cash-flow characteristics indicate whether expansion is becoming self-funded.",
    );
  } else {
    unavailableSignals.push("free-cash-flow characteristics");
  }
  if (values.shareDilutionPercent !== null) {
    add(
      "shareDilution",
      "Share dilution",
      100 - values.shareDilutionPercent * 3,
      "Lower share dilution preserves more of any future enterprise-value growth for each share.",
    );
  } else {
    unavailableSignals.push("share dilution");
  }
  if (values.balanceSheetStrength !== null) {
    add(
      "balanceSheetStrength",
      "Balance-sheet strength",
      values.balanceSheetStrength,
      "Balance-sheet strength affects the time available to fund the runway.",
    );
  } else {
    unavailableSignals.push("balance-sheet strength");
  }
  const base = buildDimensionScore("runway", evidence, unavailableSignals);
  const marketCapRunway = buildMarketCapRunway(values);
  const optionalUpsideProfiles = computeOptionalUpsideProfiles(input);
  const dataQuality = buildDataQuality(
    evidence.filter((item) => item.available).map((item) => item.key),
    unavailableSignals,
    values.addressableMarketDollars === null
      ? ["Reliable addressable-market data is unavailable; no TAM value was inferred."]
      : [],
  );
  const hasRequiredRunwayInputs =
    values.currentMarketCap !== null &&
    values.revenue !== null &&
    values.revenueGrowth !== null;
  if (!hasRequiredRunwayInputs) {
    dataQuality.status = "INSUFFICIENT_DATA";
  }
  return {
    ...base,
    score: hasRequiredRunwayInputs ? base.score : null,
    availability: hasRequiredRunwayInputs
      ? base.availability
      : "unavailable",
    modelVersion: MULTIBAGGER_MODEL_VERSION,
    runwayModelVersion: MULTIBAGGER_RUNWAY_MODEL_VERSION,
    marketCapRunway,
    optionalUpsideProfiles,
    dataQuality,
  };
}