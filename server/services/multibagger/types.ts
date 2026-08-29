import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../institutional/analytics/types";

export const MULTIBAGGER_MODEL_VERSION = "multibagger_v1" as const;

export const MULTIBAGGER_PROFILES = [
  "COMPOUNDER",
  "FIVE_X_POTENTIAL",
  "TEN_X_POTENTIAL",
  "TWENTY_FIVE_X_OPTIONALITY",
  "HUNDRED_X_OPTIONALITY",
] as const;
export type MultibaggerProfile = (typeof MULTIBAGGER_PROFILES)[number];

export type ScoreAvailability = "available" | "partial" | "unavailable";
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
  marketCapDollars?: number | null;
  addressableMarketDollars?: number | null;
  annualRevenueDollars?: number | null;
  revenueGrowthPercent?: number | null;
  cashAndEquivalentsDollars?: number | null;
  annualCashBurnDollars?: number | null;
  yearsToProfitability?: number | null;
}

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
  overall: OverallMultibaggerScore;
  profiles: Record<MultibaggerProfile, ProfileScore>;
  availableDimensionCount: number;
  unavailableDimensionCount: number;
  limitations: string[];
  disclaimer: string;
}