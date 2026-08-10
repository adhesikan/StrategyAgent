/**
 * Options Contract Research Types — Sprint 2.7.3
 *
 * ARCHITECTURE POSITION:
 *   Research → Goals → Portfolio → Trade Planning Foundation →
 *   Equity Planning → Options Strategy Matching → OPTIONS CONTRACT RESEARCH →
 *   Risk & Scenario Analysis (2.7.4) → Trade Plan Workspace (2.7.5) → Execution
 *
 * This sprint answers: WHICH expirations, strikes, and contracts are worth
 * researching within the already-selected strategy family?
 *
 * PERMANENT RULES:
 *   - Strategy family must be user-selected (from 2.7.2); never auto-substituted
 *   - No fabricated quotes, Greeks, or prices
 *   - No Probability of Profit / chance-of-winning metrics
 *   - No order construction; no broker submission
 *   - Missing Greeks → null; never zero-fill
 *   - Midpoint ≠ fill price
 *   - Covered call/protective structures require confirmed ownership
 */

import type { OptionsStrategyFamily, ThesisDirection, VolatilityContext, LiquidityContext, EventContext } from "./options-strategy-types";

// ===========================================================================
// DTE Buckets
// ===========================================================================

export type DteBucket =
  | "very_short"   // 0–14 DTE
  | "short"        // 15–30 DTE
  | "medium"       // 31–60 DTE
  | "long"         // 61–90 DTE
  | "leaps";       // 91+ DTE

export const DTE_BUCKET_RANGES: Record<DteBucket, { min: number; max: number; label: string }> = {
  very_short: { min: 1,  max: 14,   label: "Very Short (1–14 DTE)" },
  short:      { min: 15, max: 30,   label: "Short (15–30 DTE)" },
  medium:     { min: 31, max: 60,   label: "Medium (31–60 DTE)" },
  long:       { min: 61, max: 90,   label: "Long (61–90 DTE)" },
  leaps:      { min: 91, max: 730,  label: "LEAPS (91+ DTE)" },
};

// ===========================================================================
// Expiration Research
// ===========================================================================

export type ExpirationStatus =
  | "RESEARCH_CANDIDATE"      // Passes all filters; recommended for research
  | "OUTSIDE_HORIZON"         // DTE does not align with research horizon
  | "EVENT_EXCLUDED"          // Excluded because avoidEarningsWindow=true and event inside
  | "INSUFFICIENT_DATA"       // Not enough contracts or data to evaluate
  | "EXPIRED_OR_INVALID";     // DTE <= 0 or invalid format

export type EventRelation =
  | "before_event"      // Expiration is before the event date
  | "contains_event"    // Expiration window contains event
  | "after_event"       // Expiration is after event
  | "no_event_detected"
  | "event_unknown";    // Event date not available

export interface ExpirationResearchCandidate {
  expiration:            string;          // YYYY-MM-DD
  dte:                   number;
  dteBucket:             DteBucket | null;
  status:                ExpirationStatus;
  statusLabel:           string;

  reasons:               string[];        // Why included or excluded
  eventFlags:            string[];        // Event-related warnings

  eventRelation:         EventRelation;
  containsEarnings:      boolean;
  earningsDate:          string | null;   // YYYY-MM-DD if known

  /** Number of normalized contracts available for this expiration. */
  contractCount:         number;
  /** Fraction of strikes with adequate liquidity. */
  liquidityCoverage:     "STRONG" | "ACCEPTABLE" | "LIMITED" | "POOR" | "UNKNOWN";

  /** Summary IV for this expiration, if available. */
  ivSummary:             ExpirationIvSummary | null;
}

export interface ExpirationIvSummary {
  medianIv:   number | null;
  minIv:      number | null;
  maxIv:      number | null;
  note:       string;
}

// ===========================================================================
// Liquidity Quality (contract-level)
// ===========================================================================

export type ContractLiquidityQuality =
  | "STRONG"       // OI ≥ 500 AND volume ≥ 50 AND spreadPct < 5%
  | "ACCEPTABLE"   // OI ≥ 100 AND spreadPct < 15%
  | "LIMITED"      // OI ≥ 10 AND spreadPct < 30%
  | "POOR"         // Below all thresholds
  | "UNKNOWN";     // Missing data

export const LIQUIDITY_QUALITY_LABELS: Record<ContractLiquidityQuality, string> = {
  STRONG:     "Strong",
  ACCEPTABLE: "Acceptable",
  LIMITED:    "Limited",
  POOR:       "Poor",
  UNKNOWN:    "Unknown",
};

/** Transparent liquidity thresholds (documented, not hidden). */
export const LIQUIDITY_THRESHOLDS = {
  STRONG_MIN_OI:       500,
  STRONG_MIN_VOLUME:   50,
  STRONG_MAX_SPREAD_PCT: 0.05,    // 5%
  ACCEPTABLE_MIN_OI:   100,
  ACCEPTABLE_MAX_SPREAD_PCT: 0.15, // 15%
  LIMITED_MIN_OI:      10,
  LIMITED_MAX_SPREAD_PCT: 0.30,    // 30%
} as const;

// ===========================================================================
// Contract Quality Ordering
// ===========================================================================

export type ContractQualityCategory =
  | "EXCELLENT_DATA_QUALITY"   // Strong liquidity + full Greeks + fresh quote
  | "STRONG_DATA_QUALITY"      // Acceptable liquidity + partial Greeks + fresh quote
  | "ACCEPTABLE_DATA_QUALITY"  // Limited liquidity or partial data
  | "LIMITED_DATA";            // Poor liquidity or missing Greeks

export const CONTRACT_QUALITY_LABELS: Record<ContractQualityCategory, string> = {
  EXCELLENT_DATA_QUALITY:  "Excellent Data Quality",
  STRONG_DATA_QUALITY:     "Strong Data Quality",
  ACCEPTABLE_DATA_QUALITY: "Acceptable Data Quality",
  LIMITED_DATA:            "Limited Data",
};

// ===========================================================================
// Moneyness
// ===========================================================================

export type Moneyness = "ITM" | "ATM" | "OTM" | "UNKNOWN";

export const MONEYNESS_LABELS: Record<Moneyness, string> = {
  ITM:     "In the Money",
  ATM:     "At the Money",
  OTM:     "Out of the Money",
  UNKNOWN: "Unknown",
};

/** ATM band: strike within ±2% of underlying price. */
export const ATM_BAND_PCT = 0.02;

// ===========================================================================
// Contract Research Leg (no order instructions — research only)
// ===========================================================================

export type LegRole = "long_leg" | "short_leg" | "wing_long" | "wing_short";

export interface ContractResearchLeg {
  legIndex:        number;
  role:            LegRole;             // "long_leg" / "short_leg" — not BUY/SELL order
  roleLabel:       string;
  optionType:      "call" | "put";
  strike:          number;
  expiration:      string;              // YYYY-MM-DD
  dte:             number;
  contractSymbol:  string;              // OCC symbol for reference

  moneyness:       Moneyness;
  strikeDistancePct: number | null;     // % distance from underlying

  bid:             number | null;
  ask:             number | null;
  midpoint:        number | null;       // (bid+ask)/2 — not a fill price
  spreadAbs:       number | null;       // ask-bid
  spreadPct:       number | null;       // spreadAbs/midpoint

  volume:          number | null;
  openInterest:    number | null;
  impliedVolatility: number | null;

  delta:           number | null;
  gamma:           number | null;
  theta:           number | null;
  vega:            number | null;
  rho:             number | null;

  liquidity:       ContractLiquidityQuality;
  updatedAt:       string | null;
}

// ===========================================================================
// Structure Metrics (current snapshot — not P/L scenarios)
// ===========================================================================

export interface ContractResearchMetrics {
  /** Net debit paid (positive = debit; null if unavailable). */
  estimatedDebit:     number | null;
  /** Net credit received (positive = credit; null if unavailable). */
  estimatedCredit:    number | null;
  /** Spread width for vertical spreads (highStrike - lowStrike). */
  width:              number | null;
  /** Estimated cash-secured capital requirement (cash_secured_put only). */
  capitalEstimate:    number | null;
  /** Intrinsic value of the net structure (if computable). */
  intrinsicValue:     number | null;
  /** Extrinsic (time) value of the net structure. */
  extrinsicValue:     number | null;
  /** Net delta across all legs (null if any leg delta missing). */
  netDelta:           number | null;
  /** Net theta across all legs (null if any leg theta missing). */
  netTheta:           number | null;
  /** Net vega across all legs (null if any leg vega missing). */
  netVega:            number | null;
  /** Net gamma across all legs (null if any leg gamma missing). */
  netGamma:           number | null;
  /** Contract multiplier (100 for standard US equity options). */
  contractMultiplier: number;
  /** Whether this structure is defined-risk. */
  isDefinedRisk:      boolean;
  /** DEBIT / CREDIT classification (null if cannot be determined). */
  debitCreditType:    "DEBIT" | "CREDIT" | null;
}

// ===========================================================================
// Structure Research Candidate
// ===========================================================================

export interface OptionsStructureResearchCandidate {
  id:                      string;       // UUID-like for client reference
  strategyFamily:          OptionsStrategyFamily;
  strategyLabel:           string;

  expiration:              string;       // primary expiration (YYYY-MM-DD)
  dte:                     number;
  expirationLabel:         string;       // human label e.g. "Sep 20 (42 DTE)"

  legs:                    ContractResearchLeg[];

  metrics:                 ContractResearchMetrics;

  overallLiquidity:        ContractLiquidityQuality;
  qualityCategory:         ContractQualityCategory;

  researchReasons:         string[];     // Why this candidate passed filters
  warnings:                string[];     // Partial data, event exposure, etc.
  rejectionReasons:        string[];     // Empty unless status = "REJECTED"

  eventExposure:           StructureEventExposure;

  /** Freshenss of underlying quote used for moneyness/distance calc. */
  underlyingPriceRef:      number | null;
  underlyingPriceLabel:    string;

  /** For cash_secured_put: estimated capital at this strike. */
  cashSecuredCapitalNote:  string | null;

  /** 2.7.4 handoff — populated for every passing candidate. */
  riskScenarioInput:       TradeRiskScenarioInput;
}

export interface StructureEventExposure {
  containsEarnings:    boolean;
  eventType:           string | null;
  earningsDate:        string | null;
  insideEventWindow:   boolean;
  eventNote:           string;
}

// ===========================================================================
// 2.7.4 Handoff
// ===========================================================================

/**
 * Canonical handoff from Contract Research (2.7.3) to
 * Risk & Scenario Analysis (2.7.4).
 *
 * 2.7.3 answers: WHICH contracts deserve research?
 * 2.7.4 answers: WHAT are the scenario outcomes (max gain/loss, breakeven,
 *                Greeks sensitivity, underlying-price scenarios)?
 *
 * 2.7.4 must consume this input and must NOT re-run contract selection.
 */
export interface TradeRiskScenarioInput {
  planningContextId:           string;
  contractResearchCandidateId: string;
  strategyFamily:              OptionsStrategyFamily;
  /** Snapshot of legs at the time of research (not live at 2.7.4 time). */
  legs:                        ContractResearchLeg[];
  /** Current-snapshot structure metrics. */
  currentStructureMetrics:     ContractResearchMetrics;
  /** Brief description of the research thesis. */
  researchThesisSummary:       string;
  /** Invalidation note from the planning context. */
  invalidationNote:            string | null;
  /** Opaque fingerprint for cache/versioning only. */
  planningConstraintsFingerprint: string;
}

// ===========================================================================
// Canonical Contract Research Result
// ===========================================================================

export type ContractResearchStatus =
  | "COMPLETE"                          // Candidates found
  | "PARTIAL"                           // Some data missing but candidates returned
  | "NO_VALID_CONTRACT_RESEARCH_CANDIDATES" // No candidates passed filters
  | "CONTRACT_RESEARCH_REQUIRES_BROKER"  // Broker not connected
  | "CHAIN_UNAVAILABLE"                  // Provider returned empty chain
  | "STALE_CHAIN"                        // Chain too stale to use
  | "UNSUPPORTED_FAMILY"                 // Strategy family not supported for live research
  | "ERROR";                             // Unexpected failure

export interface ContractResearchFilters {
  /** DTE range override (min DTE). If null, use strategy-family default. */
  dteMin:              number | null;
  dteMax:              number | null;
  /** Minimum open interest per contract. */
  minOpenInterest:     number | null;
  /** Minimum volume per contract. */
  minVolume:           number | null;
  /** Maximum bid/ask spread as a fraction of midpoint (e.g. 0.30 = 30%). */
  maxBidAskSpreadPct:  number | null;
  /** Avoid expirations containing earnings/events. */
  avoidEarningsWindow: boolean;
  /** Minimum delta (absolute value) for long directional legs. */
  minDeltaLong:        number | null;
  /** Maximum delta (absolute value) for long directional legs. */
  maxDeltaLong:        number | null;
}

export const DEFAULT_CONTRACT_RESEARCH_FILTERS: ContractResearchFilters = {
  dteMin:              null,    // use strategy-family defaults
  dteMax:              null,
  minOpenInterest:     10,
  minVolume:           null,    // no volume floor by default
  maxBidAskSpreadPct:  0.30,    // 30% max spread
  avoidEarningsWindow: false,
  minDeltaLong:        null,
  maxDeltaLong:        null,
};

export interface ContractResearchRejectionSummary {
  contractsEvaluated:   number;
  contractsRejected:    number;
  structuresBuilt:      number;
  structuresRejected:   number;
  topRejectionReasons:  Array<{ reason: string; count: number }>;
}

export interface ContractResearchFreshness {
  optionChainAsOf:       string | null;
  marketDataAsOf:        string | null;
  provider:              string | null;
  freshnessStatus:       "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  staleWarning:          string | null;
  chainAgeMinutes:       number | null;
}

export interface OptionsContractResearchResult {
  id:                    string;
  planningContextId:     string;
  symbol:                string;
  strategyFamily:        OptionsStrategyFamily;
  strategyFamilyLabel:   string;

  generatedAt:           string;
  status:                ContractResearchStatus;
  statusLabel:           string;

  thesisDirection:       ThesisDirection;
  thesisDirectionLabel:  string;
  researchHorizon:       string | null;
  underlyingPrice:       number | null;
  underlyingPriceLabel:  string;

  volatilityContext:     VolatilityContext;
  eventContext:          EventContext | null;

  /** Filters applied for this research session. */
  filtersApplied:        ContractResearchFilters;
  /** DTE range derived from strategy family + research horizon. */
  derivedDteRange:       { min: number; max: number; label: string };

  /** All evaluated expirations (passing and rejected). */
  expirationCandidates:  ExpirationResearchCandidate[];
  /** Passing structure candidates (ordered by quality category). */
  structureCandidates:   OptionsStructureResearchCandidate[];

  /** Provider call stats (no N+1). */
  providerCallCount:     number;

  rejectionSummary:      ContractResearchRejectionSummary;
  limitations:           string[];
  freshness:             ContractResearchFreshness;

  disclaimer:            string;
  midpointDisclaimer:    string;
  optionsRiskDisclosure: string;
  methodologyVersion:    string;
  generationLatencyMs?:  number;
}

// ===========================================================================
// Health (platform health metrics)
// ===========================================================================

export interface ContractResearchHealthMetrics {
  contractResearchRequests:         number;
  successfulContractResearch:       number;
  partialContractResearch:          number;
  failedContractResearch:           number;
  noValidCandidates:                number;
  requiresBrokerCount:              number;
  staleChainCount:                  number;
  emptyChainCount:                  number;
  averageContractResearchLatencyMs: number | null;
  lastSuccessfulContractResearchAt: string | null;
  optionChainProviderStatus:        "HEALTHY" | "DEGRADED" | "UNKNOWN";
}

// ===========================================================================
// Compliance constants
// ===========================================================================

export const CONTRACT_RESEARCH_DISCLAIMER =
  "Options Contract Research identifies contract and structure candidates " +
  "that satisfy deterministic research filters within a strategy family " +
  "selected for further analysis. It does not recommend a specific " +
  "contract or trade and does not constitute investment advice, " +
  "a suitability determination, or an instruction to transact.";

export const MIDPOINT_DISCLAIMER =
  "Quoted prices and calculated midpoint values are research references only. " +
  "Actual execution prices may differ materially from estimated midpoints due " +
  "to market conditions, liquidity, and provider execution quality.";

export const OPTIONS_RISK_DISCLOSURE_EXTENDED =
  "Options involve risk and are not suitable for everyone. Contract values " +
  "may move rapidly and can expire worthless. Multi-leg strategies involve " +
  "execution of multiple contracts and may require additional broker permissions. " +
  "Verify all details with your broker before placing any order.";

export const CONTRACT_RESEARCH_VERSION = "contract-research-v1";

// ===========================================================================
// RIA / Institutional Policy (documented, not implemented)
// ===========================================================================

/**
 * Future: OptionsContractPolicy for RIA/Institutional tier.
 * Not implemented in 2.7.3.
 *
 * interface OptionsContractPolicy {
 *   minOpenInterest:       number;
 *   minVolume:             number;
 *   maxBidAskSpreadPct:    number;
 *   allowedDteRanges:      Array<{ min: number; max: number }>;
 *   allowedDeltaRanges:    Array<{ min: number; max: number }>;
 *   prohibitedEventWindows: number;   // days before event to exclude
 *   allowedStrategyFamilies: OptionsStrategyFamily[];
 *   requireDefinedRisk:    boolean;
 *   customDisclosures:     string[];
 * }
 */
