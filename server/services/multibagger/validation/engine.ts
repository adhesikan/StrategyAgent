import { computeMultibaggerDiscovery } from "../engine";
import { createHash } from "node:crypto";
import {
  MULTIBAGGER_PROFILES,
  type MultibaggerDimension,
  type MultibaggerDiscoveryInput,
  type MultibaggerDiscoveryResult,
  type MultibaggerProfile,
} from "../types";
import {
  HISTORICAL_VALIDATION_VERSION,
  type DateScopedValue,
  type EvaluationPrice,
  type HistoricalModelComputer,
  type HistoricalPriceObservation,
  type HistoricalPriceSeries,
  type HistoricalSymbolEvaluation,
  type HistoricalValidationDataProvider,
  type HistoricalValidationRequest,
  type HistoricalValidationRunResult,
  type HoldingHorizonYears,
  type HorizonOutcome,
  type ModelClassification,
  type PointInTimeModelInputs,
  type SupportedHistoricalModelVersion,
  type ValidationUnavailableReason,
} from "./types";

const SUPPORTED_MODEL_VERSIONS = new Set<SupportedHistoricalModelVersion>([
  "multibagger_v1",
]);
const VALID_HORIZONS = new Set<HoldingHorizonYears>([1, 3, 5]);
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
export const HISTORICAL_PRICE_ENDPOINT_POLICY = {
  maximumEvaluationPriceLagCalendarDays: 7,
  maximumHorizonEndPriceLagCalendarDays: 7,
} as const;
const DIMENSIONS: MultibaggerDimension[] = [
  "institutional",
  "growth",
  "fundamental",
  "valuation",
  "runway",
  "optionality",
  "risk",
];

export class PointInTimeViolationError extends Error {
  constructor(
    public readonly field: string,
    public readonly observedDate: string,
    public readonly evaluationDate: string,
  ) {
    super(
      `Point-in-time violation: ${field} date ${observedDate} is after evaluation date ${evaluationDate}.`,
    );
    this.name = "PointInTimeViolationError";
  }
}

function requireDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${field} must be a valid calendar date.`);
  }
  return value;
}

function assertNotFuture(
  field: string,
  value: string | null | undefined,
  evaluationDate: string,
): void {
  if (value == null) return;
  const normalized = requireDate(value.slice(0, 10), field);
  if (normalized > evaluationDate) {
    throw new PointInTimeViolationError(field, normalized, evaluationDate);
  }
}

function assertScopedValue<T>(
  field: string,
  scoped: DateScopedValue<T>,
  evaluationDate: string,
): void {
  if (scoped === null || typeof scoped !== "object") {
    throw new Error(`${field} must be a date-scoped provider value.`);
  }
  const runtime = scoped as unknown as Record<string, unknown>;
  if (runtime.status !== "available" && runtime.status !== "unavailable") {
    throw new Error(
      `${field}.status must be "available" or "unavailable".`,
    );
  }
  if (typeof runtime.source !== "string" || runtime.source.trim() === "") {
    throw new Error(`${field}.source must be a nonempty string.`);
  }
  if (
    runtime.sourceVersion !== null &&
    typeof runtime.sourceVersion !== "string"
  ) {
    throw new Error(`${field}.sourceVersion must be a string or null.`);
  }
  if (runtime.status === "available") {
    if (runtime.value === null || runtime.value === undefined) {
      throw new Error(`${field}.value is required when status is available.`);
    }
    if (typeof runtime.asOf !== "string" || runtime.asOf.trim() === "") {
      throw new Error(
        `${field}.asOf is required when status is available.`,
      );
    }
    const asOf = requireDate(runtime.asOf, `${field}.asOf`);
    if (asOf > evaluationDate) {
      throw new PointInTimeViolationError(field, asOf, evaluationDate);
    }
    return;
  }
  if (runtime.value !== null || runtime.asOf !== null) {
    throw new Error(
      `${field} must have null value and asOf when status is unavailable.`,
    );
  }
  if (typeof runtime.reason !== "string" || runtime.reason.trim() === "") {
    throw new Error(
      `${field}.reason is required when status is unavailable.`,
    );
  }
}

/**
 * Enforce the validation trust boundary before any production score is called.
 * Wrapper dates are mandatory for available values, and known nested dates are
 * independently checked so a misleading wrapper cannot hide future data.
 */
export function assertPointInTimeInputs(
  inputs: PointInTimeModelInputs,
  evaluationDate: string,
): void {
  requireDate(evaluationDate, "evaluationDate");
  assertScopedValue(
    "institutionalAnalytics",
    inputs.institutionalAnalytics,
    evaluationDate,
  );
  assertScopedValue(
    "institutionalTrend",
    inputs.institutionalTrend,
    evaluationDate,
  );
  assertScopedValue(
    "institutionalSignals",
    inputs.institutionalSignals,
    evaluationDate,
  );
  assertScopedValue(
    "specialistManagerParticipation",
    inputs.specialistManagerParticipation,
    evaluationDate,
  );
  assertScopedValue("growth", inputs.growth, evaluationDate);
  assertScopedValue("fundamental", inputs.fundamental, evaluationDate);
  assertScopedValue("valuation", inputs.valuation, evaluationDate);
  assertScopedValue("runway", inputs.runway, evaluationDate);
  assertScopedValue("risk", inputs.risk, evaluationDate);
  assertScopedValue("metadata", inputs.metadata, evaluationDate);

  if (inputs.institutionalAnalytics.status === "available") {
    assertNotFuture(
      "institutionalAnalytics.dataAsOf",
      inputs.institutionalAnalytics.value.dataAsOf,
      evaluationDate,
    );
    assertNotFuture(
      "institutionalAnalytics.quarter.periodEndDate",
      inputs.institutionalAnalytics.value.quarter.periodEndDate,
      evaluationDate,
    );
  }
  if (inputs.institutionalTrend.status === "available") {
    inputs.institutionalTrend.value.quarters.forEach((quarter, index) => {
      assertNotFuture(
        `institutionalTrend.quarters[${index}].quarter.periodEndDate`,
        quarter.quarter.periodEndDate,
        evaluationDate,
      );
    });
  }
  if (inputs.institutionalSignals.status === "available") {
    assertNotFuture(
      "institutionalSignals.context.dataAsOf",
      inputs.institutionalSignals.value.context.dataAsOf,
      evaluationDate,
    );
  }
}

function normalizeRequest(request: HistoricalValidationRequest) {
  const evaluationDate = requireDate(
    request.evaluationDate,
    "evaluationDate",
  );
  const symbols = Array.from(
    new Set(
      request.symbolUniverse.map((symbol) => symbol.trim().toUpperCase()),
    ),
  ).sort();
  if (symbols.length === 0 || symbols.some((symbol) => !SYMBOL_RE.test(symbol))) {
    throw new Error("symbolUniverse must contain one or more valid symbols.");
  }
  const horizons = Array.from(new Set(request.horizons)).sort(
    (left, right) => left - right,
  );
  if (
    horizons.length === 0 ||
    horizons.some((horizon) => !VALID_HORIZONS.has(horizon))
  ) {
    throw new Error("horizons must contain one or more of 1, 3, or 5 years.");
  }
  if (!SHA256_RE.test(request.scoringArtifactHash)) {
    throw new Error(
      "scoringArtifactHash must be a lowercase SHA-256 digest of the immutable scoring artifact.",
    );
  }
  return { evaluationDate, symbols, horizons };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addYears(date: string, years: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() + years);
  // Feb 29 rolls into March in JS; clamp it to Feb 28 for a stable anniversary.
  if (month === 1 && value.getUTCMonth() !== 1) {
    value.setUTCDate(0);
  }
  return value.toISOString().slice(0, 10);
}

function calendarDayDifference(earlier: string, later: string): number {
  return Math.floor(
    (new Date(`${later}T00:00:00.000Z`).getTime() -
      new Date(`${earlier}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function contentHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function unavailableInput<T>(
  input: DateScopedValue<T>,
): T | null {
  return input.status === "available" ? input.value : null;
}

function buildProductionInput(
  inputs: PointInTimeModelInputs,
): MultibaggerDiscoveryInput {
  return {
    symbol: inputs.symbol.trim().toUpperCase(),
    institutionalAnalytics: unavailableInput(inputs.institutionalAnalytics),
    institutionalTrend: unavailableInput(inputs.institutionalTrend),
    institutionalSignals: unavailableInput(inputs.institutionalSignals),
    specialistManagerParticipation: unavailableInput(
      inputs.specialistManagerParticipation,
    ),
    growth: unavailableInput(inputs.growth),
    fundamental: unavailableInput(inputs.fundamental),
    valuation: unavailableInput(inputs.valuation),
    runway: unavailableInput(inputs.runway),
    risk: unavailableInput(inputs.risk),
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validatePriceSeries(
  series: HistoricalPriceSeries,
  symbol: string,
  requestedStartDate: string,
  requestedEndDate: string,
): HistoricalPriceObservation[] {
  if (series.status === "unavailable") return [];
  if (series.symbol.trim().toUpperCase() !== symbol) {
    throw new Error(`Price provider returned the wrong symbol for ${symbol}.`);
  }
  if (
    series.adjustmentBasis !== "split_adjusted_close" &&
    series.adjustmentBasis !== "total_return_adjusted_close"
  ) {
    throw new Error(
      `Price provider returned an unsupported adjustment basis for ${symbol}.`,
    );
  }
  if (!series.corporateActionPolicyVersion.trim()) {
    throw new Error(
      `Price provider did not identify its corporate-action policy for ${symbol}.`,
    );
  }
  requireDate(series.availableThrough, "priceSeries.availableThrough");
  const byDate = new Map<string, HistoricalPriceObservation>();
  for (const observation of series.observations) {
    const date = requireDate(observation.date, "priceObservation.date");
    if (date < requestedStartDate || date > requestedEndDate) {
      throw new Error(
        `Price observation for ${symbol} on ${date} is outside the requested validation window.`,
      );
    }
    if (date > series.availableThrough) {
      throw new Error(
        `Price observation for ${symbol} on ${date} is after the provider's available-through date.`,
      );
    }
    if (
      observation.symbol.trim().toUpperCase() !== symbol ||
      !Number.isFinite(observation.close) ||
      observation.close <= 0
    ) {
      throw new Error(`Invalid price observation for ${symbol} on ${date}.`);
    }
    if (byDate.has(date)) {
      throw new Error(
        `Price provider returned duplicate observations for ${symbol} on ${date}.`,
      );
    }
    byDate.set(date, { ...observation, symbol, date });
  }
  return Array.from(byDate.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function selectEvaluationPrice(
  observations: HistoricalPriceObservation[],
  evaluationDate: string,
): EvaluationPrice {
  const eligible = observations.filter(
    (observation) => observation.date <= evaluationDate,
  );
  const selected = eligible.at(-1);
  return selected &&
    calendarDayDifference(selected.date, evaluationDate) <=
      HISTORICAL_PRICE_ENDPOINT_POLICY.maximumEvaluationPriceLagCalendarDays
    ? {
        status: "available",
        date: selected.date,
        close: selected.close,
        source: selected.source,
        sourceVersion: selected.sourceVersion,
      }
    : {
        status: "unavailable",
        date: null,
        close: null,
        source: null,
        sourceVersion: null,
      };
}

function unavailableOutcome(
  horizonYears: HoldingHorizonYears,
  targetDate: string,
  reason: ValidationUnavailableReason,
  observationCount = 0,
): HorizonOutcome {
  return {
    status: "unavailable",
    horizonYears,
    targetDate,
    endPriceDate: null,
    endPrice: null,
    futureReturnPercent: null,
    maximumFutureReturnPercent: null,
    maximumDrawdownPercent: null,
    observationCount,
    unavailableReason: reason,
  };
}

function calculateMaximumDrawdownPercent(
  evaluationClose: number,
  future: HistoricalPriceObservation[],
): number {
  let peak = evaluationClose;
  let maximumDrawdown = 0;
  for (const observation of future) {
    peak = Math.max(peak, observation.close);
    maximumDrawdown = Math.min(
      maximumDrawdown,
      ((observation.close - peak) / peak) * 100,
    );
  }
  return roundMetric(maximumDrawdown);
}

function calculateOutcome(
  horizonYears: HoldingHorizonYears,
  evaluationDate: string,
  evaluationPrice: EvaluationPrice,
  series: HistoricalPriceSeries,
  observations: HistoricalPriceObservation[],
): HorizonOutcome {
  const targetDate = addYears(evaluationDate, horizonYears);
  if (series.status === "unavailable") {
    return unavailableOutcome(
      horizonYears,
      targetDate,
      "PRICE_HISTORY_UNAVAILABLE",
    );
  }
  if (evaluationPrice.status !== "available" || evaluationPrice.close == null) {
    const hasPriorPrice = observations.some(
      (observation) => observation.date <= evaluationDate,
    );
    return unavailableOutcome(
      horizonYears,
      targetDate,
      hasPriorPrice ? "EVALUATION_PRICE_STALE" : "EVALUATION_PRICE_UNAVAILABLE",
    );
  }
  const future = observations.filter(
    (observation) =>
      observation.date > evaluationDate && observation.date <= targetDate,
  );
  if (series.availableThrough < targetDate) {
    return unavailableOutcome(
      horizonYears,
      targetDate,
      "INSUFFICIENT_FUTURE_WINDOW",
      future.length,
    );
  }
  const end = future.at(-1);
  if (!end) {
    return unavailableOutcome(
      horizonYears,
      targetDate,
      "NO_FUTURE_OBSERVATIONS",
    );
  }
  if (
    calendarDayDifference(end.date, targetDate) >
    HISTORICAL_PRICE_ENDPOINT_POLICY.maximumHorizonEndPriceLagCalendarDays
  ) {
    return unavailableOutcome(
      horizonYears,
      targetDate,
      "HORIZON_END_PRICE_STALE",
      future.length,
    );
  }
  const maximumClose = Math.max(
    evaluationPrice.close,
    ...future.map((observation) => observation.close),
  );
  return {
    status: "available",
    horizonYears,
    targetDate,
    endPriceDate: end.date,
    endPrice: end.close,
    futureReturnPercent: roundMetric(
      ((end.close - evaluationPrice.close) / evaluationPrice.close) * 100,
    ),
    maximumFutureReturnPercent: roundMetric(
      ((maximumClose - evaluationPrice.close) / evaluationPrice.close) * 100,
    ),
    maximumDrawdownPercent: calculateMaximumDrawdownPercent(
      evaluationPrice.close,
      future,
    ),
    observationCount: future.length,
    unavailableReason: null,
  };
}

function classify(result: MultibaggerDiscoveryResult): ModelClassification {
  const precedence: MultibaggerProfile[] = [
    "HUNDRED_X_OPTIONALITY",
    "TWENTY_FIVE_X_OPTIONALITY",
    "TEN_X_POTENTIAL",
    "FIVE_X_POTENTIAL",
    "COMPOUNDER",
  ];
  return (
    precedence.find((profile) => result.profiles[profile].eligible) ??
    (result.overall.score === null ? null : "UNCLASSIFIED")
  );
}

function emptyComponentScores(): Record<MultibaggerDimension, number | null> {
  return {
    institutional: null,
    growth: null,
    fundamental: null,
    valuation: null,
    runway: null,
    optionality: null,
    risk: null,
  };
}

function emptyEvaluation(
  symbol: string,
  request: HistoricalValidationRequest,
  horizons: HoldingHorizonYears[],
  reason: ValidationUnavailableReason,
): HistoricalSymbolEvaluation {
  return {
    symbol,
    evaluationDate: request.evaluationDate,
    modelVersion: request.modelVersion,
    status: "unavailable",
    unavailableReason: reason,
    overallScore: null,
    componentScores: emptyComponentScores(),
    classification: null,
    profileClassifications: null,
    evaluationPrice: {
      status: "unavailable",
      date: null,
      close: null,
      source: null,
      sourceVersion: null,
    },
    outcomes: horizons.map((horizon) =>
      unavailableOutcome(
        horizon,
        addYears(request.evaluationDate, horizon),
        reason,
      ),
    ),
    metadata: {
      sector: null,
      industry: null,
      marketCapDollars: null,
      marketCapGroup: "UNAVAILABLE",
      institutionalDiscoveryStage: null,
    },
    inputProvenance: {},
    priceProvenance: {
      status: "unavailable",
      source: "not_loaded",
      sourceVersion: null,
      availableThrough: null,
      adjustmentBasis: null,
      corporateActionPolicyVersion: null,
    },
    inputSnapshotHash: null,
    priceSnapshotHash: null,
    limitations: [reason],
  };
}

function inputProvenance(
  inputs: PointInTimeModelInputs,
): HistoricalSymbolEvaluation["inputProvenance"] {
  const result: HistoricalSymbolEvaluation["inputProvenance"] = {};
  const add = (name: string, scoped: DateScopedValue<unknown>) => {
    result[name] = {
      status: scoped.status,
      asOf: scoped.asOf,
      source: scoped.source,
      sourceVersion: scoped.sourceVersion,
    };
  };
  add("institutionalAnalytics", inputs.institutionalAnalytics);
  add("institutionalTrend", inputs.institutionalTrend);
  add("institutionalSignals", inputs.institutionalSignals);
  add(
    "specialistManagerParticipation",
    inputs.specialistManagerParticipation,
  );
  add("growth", inputs.growth);
  add("fundamental", inputs.fundamental);
  add("valuation", inputs.valuation);
  add("runway", inputs.runway);
  add("risk", inputs.risk);
  add("metadata", inputs.metadata);
  return result;
}

async function evaluateSymbol(params: {
  symbol: string;
  request: HistoricalValidationRequest;
  horizons: HoldingHorizonYears[];
  provider: HistoricalValidationDataProvider;
  computeModel: HistoricalModelComputer;
}): Promise<HistoricalSymbolEvaluation> {
  const modelVersion = params.request
    .modelVersion as SupportedHistoricalModelVersion;
  const inputs = await params.provider.loadModelInputs({
    symbol: params.symbol,
    evaluationDate: params.request.evaluationDate,
    modelVersion,
  });
  if (!inputs) {
    return emptyEvaluation(
      params.symbol,
      params.request,
      params.horizons,
      "MODEL_INPUTS_UNAVAILABLE",
    );
  }
  if (inputs.symbol.trim().toUpperCase() !== params.symbol) {
    throw new Error(`Model-input provider returned the wrong symbol for ${params.symbol}.`);
  }
  assertPointInTimeInputs(inputs, params.request.evaluationDate);
  const result = params.computeModel(buildProductionInput(inputs));
  const maximumHorizon = Math.max(...params.horizons);
  const priceStartDate = addDays(params.request.evaluationDate, -14);
  const priceEndDate = addDays(
    addYears(params.request.evaluationDate, maximumHorizon),
    7,
  );
  const priceSeries = await params.provider.loadPriceSeries({
    symbol: params.symbol,
    startDate: priceStartDate,
    endDate: priceEndDate,
  });
  const observations = validatePriceSeries(
    priceSeries,
    params.symbol,
    priceStartDate,
    priceEndDate,
  );
  const evaluationPrice = selectEvaluationPrice(
    observations,
    params.request.evaluationDate,
  );
  const metadata = unavailableInput(inputs.metadata);
  const componentScores = Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension,
      result.dimensions[dimension].score,
    ]),
  ) as Record<MultibaggerDimension, number | null>;
  const profileClassifications = Object.fromEntries(
    MULTIBAGGER_PROFILES.map((profile) => [
      profile,
      {
        score: result.profiles[profile].score,
        availability: result.profiles[profile].availability,
        eligible: result.profiles[profile].eligible,
      },
    ]),
  ) as HistoricalSymbolEvaluation["profileClassifications"];

  return {
    symbol: params.symbol,
    evaluationDate: params.request.evaluationDate,
    modelVersion: params.request.modelVersion,
    status: result.overall.availability,
    unavailableReason:
      result.overall.score === null ? "MODEL_INPUTS_UNAVAILABLE" : null,
    overallScore: result.overall.score,
    componentScores,
    classification: classify(result),
    profileClassifications,
    evaluationPrice,
    outcomes: params.horizons.map((horizon) =>
      calculateOutcome(
        horizon,
        params.request.evaluationDate,
        evaluationPrice,
        priceSeries,
        observations,
      ),
    ),
    metadata: {
      sector: metadata?.sector ?? null,
      industry: metadata?.industry ?? null,
      marketCapDollars: metadata?.marketCapDollars ?? null,
      marketCapGroup: metadata?.marketCapGroup ?? "UNAVAILABLE",
      institutionalDiscoveryStage:
        result.institutionalDiscovery.stage ?? null,
    },
    inputProvenance: inputProvenance(inputs),
    priceProvenance: {
      status: priceSeries.status,
      source: priceSeries.source,
      sourceVersion: priceSeries.sourceVersion,
      availableThrough: priceSeries.availableThrough,
      adjustmentBasis: priceSeries.adjustmentBasis,
      corporateActionPolicyVersion:
        priceSeries.corporateActionPolicyVersion,
    },
    inputSnapshotHash: contentHash(inputs),
    priceSnapshotHash: contentHash({
      ...priceSeries,
      observations,
    }),
    limitations: [...result.limitations],
  };
}

export async function runHistoricalMultibaggerValidation(
  request: HistoricalValidationRequest,
  provider: HistoricalValidationDataProvider,
  computeModel: HistoricalModelComputer = computeMultibaggerDiscovery,
): Promise<HistoricalValidationRunResult> {
  const normalized = normalizeRequest(request);
  const normalizedRequest: HistoricalValidationRequest = {
    evaluationDate: normalized.evaluationDate,
    symbolUniverse: normalized.symbols,
    modelVersion: request.modelVersion,
    scoringArtifactHash: request.scoringArtifactHash,
    horizons: normalized.horizons,
  };
  let evaluations: HistoricalSymbolEvaluation[];
  if (!SUPPORTED_MODEL_VERSIONS.has(request.modelVersion as SupportedHistoricalModelVersion)) {
    evaluations = normalized.symbols.map((symbol) =>
      emptyEvaluation(
        symbol,
        normalizedRequest,
        normalized.horizons,
        "UNSUPPORTED_MODEL_VERSION",
      ),
    );
  } else {
    evaluations = [];
    for (const symbol of normalized.symbols) {
      evaluations.push(
        await evaluateSymbol({
          symbol,
          request: normalizedRequest,
          horizons: normalized.horizons,
          provider,
          computeModel,
        }),
      );
    }
  }
  const runKey = contentHash({
    validationVersion: HISTORICAL_VALIDATION_VERSION,
    request: normalizedRequest,
    provider: provider.provenance,
    modelArtifact: {
      implementation: "computeMultibaggerDiscovery",
      scoringContractVersion: request.modelVersion,
      scoringArtifactHash: request.scoringArtifactHash,
    },
    snapshots: evaluations.map((evaluation) => ({
      symbol: evaluation.symbol,
      inputSnapshotHash: evaluation.inputSnapshotHash,
      priceSnapshotHash: evaluation.priceSnapshotHash,
    })),
  });

  return {
    request: normalizedRequest,
    provenance: {
      validationVersion: HISTORICAL_VALIDATION_VERSION,
      modelVersion: request.modelVersion,
      evaluationDate: normalized.evaluationDate,
      normalizedSymbolUniverse: normalized.symbols,
      horizons: normalized.horizons,
      provider: { ...provider.provenance },
      modelArtifact: {
        implementation: "computeMultibaggerDiscovery",
        scoringContractVersion: request.modelVersion,
        scoringArtifactHash: request.scoringArtifactHash,
      },
      runKey,
    },
    evaluations,
  };
}