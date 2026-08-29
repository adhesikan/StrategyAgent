import type {
  InstitutionalAccumulationScoreResult,
  StockInstitutionalAnalytics,
  StockInstitutionalTrendClassification,
  StockInstitutionalTrendResult,
} from "../institutional/analytics/types";

export const MULTIBAGGER_MODEL_VERSION = "multibagger_v1" as const;
export const MULTIBAGGER_RUNWAY_MODEL_VERSION =
  "multibagger_runway_v1" as const;

export const MULTIBAGGER_PROFILES = [
  "COMPOUNDER",
  "FIVE_X_POTENTIAL",
  "TEN_X_POTENTIAL",
  "TWENTY_FIVE_X_OPTIONALITY",
  "HUNDRED_X_OPTIONALITY",
] as const;
export type MultibaggerProfile = (typeof MULTIBAGGER_PROFILES)[number];

export type ScoreAvailability = "available" | "partial" | "unavailable";
export const INSTITUTIONAL_DISCOVERY_STAGES = [
  "EARLY_DISCOVERY",
  "EXPANDING_PARTICIPATION",
  "BROAD_CONSENSUS",
  "MATURE_OR_CROWDED",
] as const;
export type InstitutionalDiscoveryStage =
  (typeof INSTITUTIONAL_DISCOVERY_STAGES)[number];
export type MultibaggerDimension =
  | "institutional"
  | "growth"
  | "fundamental"
  | "valuation"
  | "runway"
  | "optionality"
  | "risk";

export interface SignalEvidence {
  key: string;
  label: string;
  value: number | string | null;
  available: boolean;
  explanation: string;
}

export type SpecialistManagerCohort =
  | "technology_specialist"
  | "healthcare_specialist";

export interface VerifiedSpecialistManagerParticipation {
  verified: true;
  cohorts: SpecialistManagerCohort[];
  verifiedManagerUniverseCount: number;
  participatingManagerCount: number;
  participationPercent: number;
}

export interface InstitutionalDiscoveryDataContext {
  scope: "TRACKED_REPORTED_13F_MANAGERS";
  delayedReporting: true;
  eligible: boolean;
  dataQuarter: string | null;
  dataAsOf: string | null;
  analyticsStatus: "complete" | "partial" | "insufficient" | "unavailable";
  trendStatus: "complete" | "partial" | "insufficient" | "unavailable" | null;
  mappingCoveragePercent: number | null;
  trendCoveragePercent: number | null;
  reportingManagerCount: number | null;
  warnings: string[];
}

export interface InstitutionalDiscoverySignalInputs {
  institutionalAccumulationScore: number | null;
  institutionalTrend: StockInstitutionalTrendClassification | null;
  /** Percent change in reported holder count versus the comparable quarter. */
  reportedHolderGrowth: number | null;
  /** Newly reported managers as a percent of prior reported holders. */
  newManagerBreadth: number | null;
  /** Percent change in aggregate reported shares. */
  aggregateReportedShareTrend: number | null;
  /** Percent of comparable quarters with a positive participation balance. */
  multiQuarterPersistence: number | null;
  specialistManagerParticipation: VerifiedSpecialistManagerParticipation | null;
  institutionalDiscoveryStage: InstitutionalDiscoveryStage | null;
  reportedHolderCount: number | null;
  accumulationModelVersion: InstitutionalAccumulationScoreResult["modelVersion"] | null;
  context: InstitutionalDiscoveryDataContext;
}

export interface InstitutionalDiscoveryEvidence extends SignalEvidence {
  rawValue: number | string | null;
  normalizedScore: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  weightedContribution: number | null;
  direction: "positive" | "neutral" | "caution" | "unavailable";
  source:
    | "institutional_accumulation_v1"
    | "stock_institutional_analytics"
    | "institutional_trend_v1"
    | "verified_manager_cohort";
}

export interface InstitutionalDiscoveryReason {
  code:
    | "PARTICIPATION_INCREASING"
    | "REPORTED_SHARES_INCREASING"
    | "PERSISTENT_PARTICIPATION"
    | "BREADTH_EXPANDING"
    | "VERIFIED_SPECIALIST_PARTICIPATION"
    | "PARTICIPATION_WEAKENING"
    | "MATURE_OR_CROWDED_CAUTION";
  direction: "positive" | "caution";
  summary: string;
  evidenceKeys: string[];
}

export interface DimensionScore {
  dimension: MultibaggerDimension;
  score: number | null;
  availability: ScoreAvailability;
  evidence: SignalEvidence[];
  unavailableSignals: string[];
  modelVersion: typeof MULTIBAGGER_MODEL_VERSION;
}

export interface InstitutionalDiscoveryScore extends DimensionScore {
  dimension: "institutional";
  stage: InstitutionalDiscoveryStage | null;
  signals: InstitutionalDiscoverySignalInputs;
  evidence: InstitutionalDiscoveryEvidence[];
  reasons: InstitutionalDiscoveryReason[];
}

export interface GrowthScore extends DimensionScore {
  dimension: "growth";
}

export interface FundamentalQualityScore extends DimensionScore {
  dimension: "fundamental";
}

export interface ValuationScore extends DimensionScore {
  dimension: "valuation";
}

export interface RunwayScore extends DimensionScore {
  dimension: "runway";
  runwayModelVersion: typeof MULTIBAGGER_RUNWAY_MODEL_VERSION;
  marketCapRunway: MarketCapRunway;
  optionalUpsideProfiles: OptionalUpsideProfiles;
  dataQuality: RunwayDataQuality;
}

export interface OptionalityScore extends DimensionScore {
  dimension: "optionality";
}

/**
 * RiskScore is a quality score: higher means more risk evidence is favorable,
 * not that the company is more risky.
 */
export interface RiskScore extends DimensionScore {
  dimension: "risk";
}

export interface GrowthSignalsInput {
  revenueGrowthYoYPercent?: number | null;
  revenueCagr3yPercent?: number | null;
  epsGrowthYoYPercent?: number | null;
  freeCashFlowGrowthYoYPercent?: number | null;
}

export interface FundamentalSignalsInput {
  grossMarginPercent?: number | null;
  operatingMarginPercent?: number | null;
  freeCashFlowMarginPercent?: number | null;
  returnOnInvestedCapitalPercent?: number | null;
  debtToEquity?: number | null;
  earningsStabilityPercent?: number | null;
}

export interface ValuationSignalsInput {
  marketCapDollars?: number | null;
  revenueDollars?: number | null;
  enterpriseValueDollars?: number | null;
  forwardPriceToEarnings?: number | null;
  priceToSales?: number | null;
  enterpriseValueToRevenue?: number | null;
}

export interface RunwaySignalsInput {
  /** Preferred name; marketCapDollars remains supported for compatibility. */
  currentMarketCap?: number | null;
  marketCapDollars?: number | null;
  /** Preferred name; annualRevenueDollars remains supported for compatibility. */
  revenue?: number | null;
  addressableMarketDollars?: number | null;
  /** Numeric TAM is usable only when this is explicitly true. */
  addressableMarketReliable?: boolean;
  annualRevenueDollars?: number | null;
  /** Preferred name; revenueGrowthPercent remains supported for compatibility. */
  revenueGrowth?: number | null;
  revenueGrowthPercent?: number | null;
  industryGrowthPercent?: number | null;
  operatingMarginPercent?: number | null;
  freeCashFlowMarginPercent?: number | null;
  freeCashFlowGrowthPercent?: number | null;
  freeCashFlowPositive?: boolean | null;
  shareDilutionPercent?: number | null;
  balanceSheetStrength?: number | null;
  cashAndEquivalentsDollars?: number | null;
  annualCashBurnDollars?: number | null;
  yearsToProfitability?: number | null;
}

export type OptionalUpsideProfileKey = "5x" | "10x" | "25x" | "100x";
export type OptionalUpsideProfileClassification =
  | "STRONG_PROFILE"
  | "MODERATE_PROFILE"
  | "WEAK_PROFILE"
  | "INSUFFICIENT_DATA";

export interface RunwayFactor {
  code: string;
  label: string;
  value: number | string | null;
  explanation: string;
}

export interface RunwayDataQuality {
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA";
  availableInputs: string[];
  unavailableInputs: string[];
  warnings: string[];
  modelVersion: typeof MULTIBAGGER_RUNWAY_MODEL_VERSION;
}

export interface MarketCapRunwayConstraint {
  status: "SUPPORTS" | "CONSTRAINS" | "UNAVAILABLE";
  currentMarketCap: number | null;
  targetMarketCap: number | null;
  maximumSupportiveCurrentMarketCap: number | null;
  explanation: string;
}

export interface MarketCapRunway {
  currentMarketCap: number | null;
  addressableMarketDollars: number | null;
  addressableMarketReliable: boolean;
  addressableMarketToCurrentCapRatio: number | null;
  targetMarketCaps: Record<OptionalUpsideProfileKey, number | null>;
  constraints: Record<
    OptionalUpsideProfileKey,
    MarketCapRunwayConstraint
  >;
  modelVersion: typeof MULTIBAGGER_RUNWAY_MODEL_VERSION;
}

export interface OptionalUpsideProfile {
  multiple: 5 | 10 | 25 | 100;
  classification: OptionalUpsideProfileClassification;
  score: number | null;
  supportingFactors: RunwayFactor[];
  limitingFactors: RunwayFactor[];
  dataQuality: RunwayDataQuality;
  modelVersion: typeof MULTIBAGGER_RUNWAY_MODEL_VERSION;
}

export type OptionalUpsideProfiles = Record<
  OptionalUpsideProfileKey,
  OptionalUpsideProfile
>;

export interface RiskSignalsInput {
  annualizedVolatilityPercent?: number | null;
  maxDrawdownPercent?: number | null;
  debtToEquity?: number | null;
  customerConcentrationPercent?: number | null;
  regulatoryRisk?: "low" | "medium" | "high" | null;
}

export interface MultibaggerDiscoveryInput {
  symbol: string;
  institutionalAnalytics?: StockInstitutionalAnalytics | null;
  institutionalTrend?: StockInstitutionalTrendResult | null;
  institutionalSignals?: InstitutionalDiscoverySignalInputs | null;
  specialistManagerParticipation?: VerifiedSpecialistManagerParticipation | null;
  growth?: GrowthSignalsInput | null;
  fundamental?: FundamentalSignalsInput | null;
  valuation?: ValuationSignalsInput | null;
  runway?: RunwaySignalsInput | null;
  risk?: RiskSignalsInput | null;
}

export interface MultibaggerDimensionScores {
  institutional: InstitutionalDiscoveryScore;
  growth: GrowthScore;
  fundamental: FundamentalQualityScore;
  valuation: ValuationScore;
  runway: RunwayScore;
  optionality: OptionalityScore;
  risk: RiskScore;
}

export interface ProfileScore {
  profile: MultibaggerProfile;
  score: number | null;
  availability: ScoreAvailability;
  eligible: boolean;
  rationale: string;
  evidence: SignalEvidence[];
  modelVersion: typeof MULTIBAGGER_MODEL_VERSION;
}

export interface OverallMultibaggerScore {
  score: number | null;
  availability: ScoreAvailability;
  confidence: "high" | "moderate" | "limited" | "unavailable";
  dimensions: MultibaggerDimensionScores;
  profileScores: Record<MultibaggerProfile, ProfileScore>;
  modelVersion: typeof MULTIBAGGER_MODEL_VERSION;
  disclaimer: string;
}

export interface MultibaggerDiscoveryResult {
  symbol: string;
  modelVersion: typeof MULTIBAGGER_MODEL_VERSION;
  dimensions: MultibaggerDimensionScores;
  institutionalDiscovery: InstitutionalDiscoveryScore;
  runwayScore: RunwayScore;
  marketCapRunway: MarketCapRunway;
  optionalUpsideProfiles: OptionalUpsideProfiles;
  overall: OverallMultibaggerScore;
  profiles: Record<MultibaggerProfile, ProfileScore>;
  availableDimensionCount: number;
  unavailableDimensionCount: number;
  limitations: string[];
  disclaimer: string;
}