import type {
  FundamentalSignalsInput,
  GrowthSignalsInput,
  InstitutionalDiscoverySignalInputs,
  InstitutionalDiscoveryStage,
  MultibaggerDimension,
  MultibaggerDiscoveryResult,
  MultibaggerProfile,
  RiskSignalsInput,
  RunwaySignalsInput,
  SpecialistManagerCohort,
  ValuationSignalsInput,
  VerifiedSpecialistManagerParticipation,
} from "../types";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../../institutional/analytics/types";

export const HISTORICAL_VALIDATION_VERSION =
  "multibagger_historical_validation_v1" as const;

export type SupportedHistoricalModelVersion = "multibagger_v1";
export type HistoricalModelVersion = SupportedHistoricalModelVersion | string;
export type HoldingHorizonYears = 1 | 3 | 5;

export type ValidationUnavailableReason =
  | "UNSUPPORTED_MODEL_VERSION"
  | "MODEL_INPUTS_UNAVAILABLE"
  | "EVALUATION_PRICE_UNAVAILABLE"
  | "EVALUATION_PRICE_STALE"
  | "PRICE_HISTORY_UNAVAILABLE"
  | "INSUFFICIENT_FUTURE_WINDOW"
  | "NO_FUTURE_OBSERVATIONS"
  | "HORIZON_END_PRICE_STALE";

export interface HistoricalValidationRequest {
  evaluationDate: string;
  symbolUniverse: string[];
  modelVersion: HistoricalModelVersion;
  /**
   * SHA-256 of the immutable scoring build/configuration used for this run.
   * The offline runner must obtain this from its versioned research artifact.
   */
  scoringArtifactHash: string;
  horizons: HoldingHorizonYears[];
}

export interface DateScopedAvailableValue<T> {
  status: "available";
  value: T;
  /** Latest date whose information contributed to this value. */
  asOf: string;
  source: string;
  sourceVersion: string | null;
}

export interface DateScopedUnavailableValue {
  status: "unavailable";
  value: null;
  asOf: null;
  source: string;
  sourceVersion: string | null;
  reason: string;
}

export type DateScopedValue<T> =
  | DateScopedAvailableValue<T>
  | DateScopedUnavailableValue;

export type ValidationMarketCapGroup =
  | "MICRO"
  | "SMALL"
  | "MID"
  | "LARGE"
  | "MEGA"
  | "UNAVAILABLE";

export interface HistoricalValidationMetadata {
  sector: string | null;
  industry: string | null;
  marketCapDollars: number | null;
  marketCapGroup: ValidationMarketCapGroup;
}

export interface PointInTimeModelInputs {
  symbol: string;
  institutionalAnalytics: DateScopedValue<StockInstitutionalAnalytics>;
  institutionalTrend: DateScopedValue<StockInstitutionalTrendResult>;
  institutionalSignals: DateScopedValue<InstitutionalDiscoverySignalInputs>;
  specialistManagerParticipation:
    DateScopedValue<VerifiedSpecialistManagerParticipation>;
  growth: DateScopedValue<GrowthSignalsInput>;
  fundamental: DateScopedValue<FundamentalSignalsInput>;
  valuation: DateScopedValue<ValuationSignalsInput>;
  runway: DateScopedValue<RunwaySignalsInput>;
  risk: DateScopedValue<RiskSignalsInput>;
  metadata: DateScopedValue<HistoricalValidationMetadata>;
}

export interface HistoricalPriceObservation {
  symbol: string;
  date: string;
  close: number;
  source: string;
  sourceVersion: string | null;
}

export type HistoricalPriceAdjustmentBasis =
  | "split_adjusted_close"
  | "total_return_adjusted_close";

export interface HistoricalPriceSeriesAvailable {
  status: "available";
  symbol: string;
  observations: HistoricalPriceObservation[];
  /** Latest date the provider searched, including dates with no market session. */
  availableThrough: string;
  source: string;
  sourceVersion: string | null;
  adjustmentBasis: HistoricalPriceAdjustmentBasis;
  corporateActionPolicyVersion: string;
}

export interface HistoricalPriceSeriesUnavailable {
  status: "unavailable";
  symbol: string;
  observations: [];
  availableThrough: string | null;
  source: string;
  sourceVersion: string | null;
  adjustmentBasis: null;
  corporateActionPolicyVersion: null;
  reason: string;
}

export type HistoricalPriceSeries =
  | HistoricalPriceSeriesAvailable
  | HistoricalPriceSeriesUnavailable;

export interface HistoricalValidationProviderProvenance {
  providerId: string;
  providerVersion: string;
  datasetVersion: string | null;
}

export interface HistoricalValidationDataProvider {
  provenance: HistoricalValidationProviderProvenance;
  loadModelInputs(params: {
    symbol: string;
    evaluationDate: string;
    modelVersion: SupportedHistoricalModelVersion;
  }): Promise<PointInTimeModelInputs | null>;
  loadPriceSeries(params: {
    symbol: string;
    startDate: string;
    endDate: string;
  }): Promise<HistoricalPriceSeries>;
}

export interface EvaluationPrice {
  status: "available" | "unavailable";
  date: string | null;
  close: number | null;
  source: string | null;
  sourceVersion: string | null;
}

export interface HorizonOutcomeAvailable {
  status: "available";
  horizonYears: HoldingHorizonYears;
  targetDate: string;
  endPriceDate: string;
  endPrice: number;
  futureReturnPercent: number;
  maximumFutureReturnPercent: number;
  maximumDrawdownPercent: number;
  observationCount: number;
  unavailableReason: null;
}

export interface HorizonOutcomeUnavailable {
  status: "unavailable";
  horizonYears: HoldingHorizonYears;
  targetDate: string;
  endPriceDate: null;
  endPrice: null;
  futureReturnPercent: null;
  maximumFutureReturnPercent: null;
  maximumDrawdownPercent: null;
  observationCount: number;
  unavailableReason: ValidationUnavailableReason;
}

export type HorizonOutcome =
  | HorizonOutcomeAvailable
  | HorizonOutcomeUnavailable;

export type ModelClassification =
  | MultibaggerProfile
  | "UNCLASSIFIED"
  | null;

export interface HistoricalSymbolMetadata {
  sector: string | null;
  industry: string | null;
  marketCapDollars: number | null;
  marketCapGroup: ValidationMarketCapGroup;
  institutionalDiscoveryStage: InstitutionalDiscoveryStage | null;
}

export interface HistoricalSymbolEvaluation {
  symbol: string;
  evaluationDate: string;
  modelVersion: HistoricalModelVersion;
  status: "available" | "partial" | "unavailable";
  unavailableReason: ValidationUnavailableReason | null;
  overallScore: number | null;
  componentScores: Record<MultibaggerDimension, number | null>;
  classification: ModelClassification;
  profileClassifications: Record<
    MultibaggerProfile,
    {
      score: number | null;
      availability: "available" | "partial" | "unavailable";
      eligible: boolean;
    }
  > | null;
  evaluationPrice: EvaluationPrice;
  outcomes: HorizonOutcome[];
  metadata: HistoricalSymbolMetadata;
  inputProvenance: Record<
    string,
    {
      status: "available" | "unavailable";
      asOf: string | null;
      source: string;
      sourceVersion: string | null;
    }
  >;
  priceProvenance: {
    status: "available" | "unavailable";
    source: string;
    sourceVersion: string | null;
    availableThrough: string | null;
    adjustmentBasis: HistoricalPriceAdjustmentBasis | null;
    corporateActionPolicyVersion: string | null;
  };
  inputSnapshotHash: string | null;
  priceSnapshotHash: string | null;
  limitations: string[];
}

export interface HistoricalValidationRunProvenance {
  validationVersion: typeof HISTORICAL_VALIDATION_VERSION;
  modelVersion: HistoricalModelVersion;
  evaluationDate: string;
  normalizedSymbolUniverse: string[];
  horizons: HoldingHorizonYears[];
  provider: HistoricalValidationProviderProvenance;
  modelArtifact: {
    implementation: "computeMultibaggerDiscovery";
    scoringContractVersion: HistoricalModelVersion;
    scoringArtifactHash: string;
  };
  runKey: string;
}

export interface HistoricalValidationRunResult {
  request: HistoricalValidationRequest;
  provenance: HistoricalValidationRunProvenance;
  evaluations: HistoricalSymbolEvaluation[];
}

export interface TopDecileOutcome {
  symbol: string;
  overallScore: number | null;
  outcomeStatus: "available" | "unavailable";
  futureReturnPercent: number | null;
  unavailableReason: ValidationUnavailableReason | "HORIZON_NOT_EVALUATED" | null;
  horizonYears: HoldingHorizonYears;
}

export interface ClassificationCohorts {
  falsePositives: string[];
  falseNegatives: string[];
  truePositives: string[];
  trueNegatives: string[];
  excludedUnavailable: string[];
}

export interface ScoreDistributionBucket {
  minimumInclusive: number;
  maximumBoundary: number;
  maximumInclusive: boolean;
  count: number;
  symbols: string[];
}

export interface ScoreDistribution {
  buckets: ScoreDistributionBucket[];
  unavailableCount: number;
  unavailableSymbols: string[];
}

export interface GroupedValidationSummary {
  group: string;
  symbolCount: number;
  scoredSymbolCount: number;
  observableOutcomeCount: number;
  averageScore: number | null;
  averageFutureReturnPercent: number | null;
  medianFutureReturnPercent: number | null;
}

export type HistoricalModelComputer = (
  input: Parameters<typeof import("../engine").computeMultibaggerDiscovery>[0],
) => MultibaggerDiscoveryResult;

export interface SpecialistCohortProvenance {
  cohorts: SpecialistManagerCohort[];
}