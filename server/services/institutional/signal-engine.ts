// Institutional Signal Engine — Sprint 2.2.6
//
// Deterministic, pure-computation transformation of pre-aggregated 13F data
// into an explainable Institutional Signal for a ticker.
//
// KEY PRINCIPLES (non-negotiable):
//   - No LLM. No predictions. No buy/sell recommendations.
//   - Score represents strength/direction of REPORTED 13F activity only.
//   - Missing data returns explicit status, never fabricated neutral evidence.
//   - All inputs come from institutional_quarterly_aggregates — never raw holdings
//     at request time.
//   - Amendment handling is already done upstream by the aggregation engine.
//   - Score = null when data quality is insufficient.
//   - 13F data is always delayed — freshness fields make this explicit.
//
// SCORE FORMULA (see computeInstitutionalScore):
//   A. Breadth (30%):          net direction of manager counts
//   B. Accumulation (30%):     aggregate share change magnitude
//   C. Entrants vs Exits (25%): net new managers vs exited managers
//   D. Concentration context (15%): broadening vs concentrating ownership
//
// LABEL THRESHOLDS (see scoreToLabel):
//   >= 75  → "Strong Accumulation"
//   >= 60  → "Accumulation"
//   >= 40  → "Stable"
//   >= 25  → "Distribution"
//   <  25  → "Strong Distribution"
//   null   → "Insufficient Data"
//
// DATA QUALITY THRESHOLDS (see computeDataQuality):
//   high         : managerCountLatest >= 10 AND coverage complete
//   moderate     : managerCountLatest >= 5  OR coverage complete
//   limited      : managerCountLatest >= 2
//   insufficient : managerCountLatest < 2  → score = null

import { db } from "../../db";
import { eq, desc } from "drizzle-orm";
import {
  institutionalQuarterlyAggregates,
  institutionalSymbolSignals,
  type InstitutionalQuarterlyAggregate,
} from "@shared/schema";
import { derivePeriodLabel } from "./aggregation-engine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InstitutionalSignalStatus =
  | "available"
  | "insufficient_history"
  | "mapping_incomplete"
  | "processing"
  | "unavailable";

export type InstitutionalSignalLabel =
  | "Strong Accumulation"
  | "Accumulation"
  | "Stable"
  | "Distribution"
  | "Strong Distribution"
  | "Insufficient Data";

export type ConcentrationTrend =
  | "increasing_concentration"
  | "stable_concentration"
  | "broadening_ownership"
  | "insufficient_data";

export type DataQualityConfidence = "high" | "moderate" | "limited" | "insufficient";

export type ManagerChangeType = "NEW" | "EXITED" | "INCREASED" | "REDUCED" | "UNCHANGED";

export interface InstitutionalManagerChange {
  /** Manager name as reported in SEC 13F filing */
  managerName: string;
  /** Shares in previous comparable quarter (null for NEW positions) */
  previousShares: number | null;
  /** Shares in latest quarter (null for EXITED positions) */
  latestShares: number | null;
  /** Net share change: latestShares − previousShares */
  shareChange: number | null;
  /** Share change as fraction of previous shares; null when previous = 0 */
  shareChangePct: number | null;
  /** Reported value in canonical US dollars in previous quarter */
  previousValue: number | null;
  /** Reported value in canonical US dollars in latest quarter */
  latestValue: number | null;
  /** Approximate value change in US dollars (null when either value unavailable) */
  valueChange: number | null;
  changeType: ManagerChangeType;
}

export interface InstitutionalScoreComponents {
  /** 0-100: net direction of manager count changes (increased vs reduced) */
  breadth: number | null;
  /** 0-100: aggregate share change percentage vs reference range */
  accumulation: number | null;
  /** 0-100: net new managers vs exited managers */
  entrantsVsExits: number | null;
  /** 0-100: broadening vs concentrating ownership context */
  concentration: number | null;
  /** 0-100: data quality gate factor (applied as weight modifier) */
  dataQuality: number | null;
}

export interface InstitutionalSignal {
  symbol: string;
  status: InstitutionalSignalStatus;
  latestQuarter: string | null;
  previousQuarter: string | null;
  /** ISO date of the latest quarter's period-of-report */
  periodEndDate: string | null;
  /** 0–100 institutional evidence score; null when data quality is insufficient */
  score: number | null;
  label: InstitutionalSignalLabel | null;
  summary: string | null;
  metrics: {
    managerCountLatest: number | null;
    managerCountPrevious: number | null;
    totalSharesLatest: number | null;
    totalSharesPrevious: number | null;
    totalValueLatest: number | null;
    totalValuePrevious: number | null;
    shareChange: number | null;
    shareChangePct: number | null;
    valueChange: number | null;
    valueChangePct: number | null;
    newManagerCount: number;
    exitedManagerCount: number;
    increasedManagerCount: number;
    reducedManagerCount: number;
    unchangedManagerCount: number;
  };
  concentration: {
    holderCount: number;
    topHolderSharePct: number | null;
    top5HolderSharePct: number | null;
    trend: ConcentrationTrend;
  };
  /** Top 5 managers with the largest absolute INCREASE in reported shares */
  topBuyers: InstitutionalManagerChange[];
  /** Top 5 managers with the largest absolute DECREASE in reported shares */
  topSellers: InstitutionalManagerChange[];
  /** Top 5 managers that opened NEW positions this quarter */
  newPositions: InstitutionalManagerChange[];
  /** Top 5 managers that fully EXITED their position (inferred from prior quarter) */
  exitedPositions: InstitutionalManagerChange[];
  scoreComponents: InstitutionalScoreComponents;
  dataQuality: {
    /** Fraction of holdings rows that were eligible for this signal; null when unknown */
    mappingCoverage: number | null;
    /** Number of managers comparable across both quarters */
    comparableManagerCount: number;
    /** Coverage status for the latest quarter */
    latestQuarterCoverage: number | null;
    /** Coverage status for the previous quarter */
    previousQuarterCoverage: number | null;
    confidence: DataQualityConfidence;
  };
  freshness: {
    source: "SEC Form 13F";
    /** Always true — 13F filings are due 45 days after quarter end */
    delayed: true;
    periodEndDate: string | null;
    calculatedAt: string | null;
  };
}

// ---------------------------------------------------------------------------
// Future consumer contracts (Sprint 2.2.7 surfaces)
// ---------------------------------------------------------------------------

export interface InstitutionalEvidence {
  available: boolean;
  score: number | null;
  label: InstitutionalSignalLabel | null;
  /** Derived from score: strong (≥70), moderate (≥50), weak (≥30), unavailable */
  evidenceStrength: "strong" | "moderate" | "weak" | "unavailable";
  dataQuality: DataQualityConfidence;
  summary: string | null;
}

export interface InstitutionalWorkspaceContract {
  status: InstitutionalSignalStatus;
  score: number | null;
  label: InstitutionalSignalLabel | null;
  latestQuarter: string | null;
  summary: string | null;
  /** Up to 3 plain-language evidence bullet points */
  topEvidence: string[];
}

// ---------------------------------------------------------------------------
// Internal — stored largestHolder shape (from aggregation-engine.ts)
// ---------------------------------------------------------------------------

interface StoredHolder {
  managerCik: string;
  managerName: string;
  reportedShares: number;
  reportedValue: number | null;
  quarterChangeShares: number | null;
  quarterChangePercent: number | null;
  activity: "new" | "increased" | "reduced" | "unchanged" | "exited";
  periodOfReport: string;
  filingDate: string;
}

function parseHolders(raw: unknown): StoredHolder[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is StoredHolder => h && typeof h === "object");
}

// ---------------------------------------------------------------------------
// Pure: derive manager-level change lists from stored holder JSON
// ---------------------------------------------------------------------------

function holderToChange(
  h: StoredHolder,
  type: ManagerChangeType,
  prevShares: number | null,
  prevValue: number | null,
): InstitutionalManagerChange {
  const latestShares = type === "EXITED" ? null : h.reportedShares;
  const latestValue = type === "EXITED" ? null : h.reportedValue;
  const shareChange = latestShares !== null && prevShares !== null
    ? latestShares - prevShares
    : h.quarterChangeShares ?? null;
  const shareChangePct = h.quarterChangePercent ?? null;
  const valueChange =
    latestValue !== null && prevValue !== null ? latestValue - prevValue : null;
  return {
    managerName: h.managerName,
    previousShares: prevShares,
    latestShares,
    shareChange,
    shareChangePct,
    previousValue: prevValue,
    latestValue,
    valueChange,
    changeType: type,
  };
}

/**
 * Derive top buyers (INCREASED by most absolute shares) from current holders.
 * Source: largestHolders JSONB from the current aggregate (capped to 20 largest by current shares).
 */
export function deriveTopBuyers(currentHolders: StoredHolder[], n = 5): InstitutionalManagerChange[] {
  return currentHolders
    .filter((h) => h.activity === "increased" && (h.quarterChangeShares ?? 0) > 0)
    .sort((a, b) => (b.quarterChangeShares ?? 0) - (a.quarterChangeShares ?? 0))
    .slice(0, n)
    .map((h) => {
      const prevShares = h.quarterChangeShares !== null ? h.reportedShares - h.quarterChangeShares : null;
      return holderToChange(h, "INCREASED", prevShares, null);
    });
}

/**
 * Derive top sellers (REDUCED by most absolute shares) from current holders.
 */
export function deriveTopSellers(currentHolders: StoredHolder[], n = 5): InstitutionalManagerChange[] {
  return currentHolders
    .filter((h) => h.activity === "reduced" && (h.quarterChangeShares ?? 0) < 0)
    .sort((a, b) => (a.quarterChangeShares ?? 0) - (b.quarterChangeShares ?? 0)) // most negative first
    .slice(0, n)
    .map((h) => {
      const prevShares = h.quarterChangeShares !== null ? h.reportedShares - h.quarterChangeShares : null;
      return holderToChange(h, "REDUCED", prevShares, null);
    });
}

/**
 * Derive new positions (managers with NEW activity) from current holders.
 * Ranked by current reported shares (largest new position first).
 */
export function deriveNewPositions(currentHolders: StoredHolder[], n = 5): InstitutionalManagerChange[] {
  return currentHolders
    .filter((h) => h.activity === "new")
    .sort((a, b) => b.reportedShares - a.reportedShares)
    .slice(0, n)
    .map((h) => holderToChange(h, "NEW", null, null));
}

/**
 * Derive exited positions from the PREVIOUS quarter's largest holders.
 * A manager is considered exited when they appear in the previous quarter's top holders
 * but do NOT appear in the current quarter's top holders.
 *
 * NOTE: This is inferred from the stored top-20 holder lists; complete exit history
 * requires raw holdings (available at rebuild time if needed in future sprint).
 */
export function deriveExitedPositions(
  previousHolders: StoredHolder[],
  currentHolders: StoredHolder[],
  n = 5,
): InstitutionalManagerChange[] {
  const currentCiks = new Set(currentHolders.map((h) => h.managerCik));
  return previousHolders
    .filter((h) => !currentCiks.has(h.managerCik) && h.reportedShares > 0)
    .sort((a, b) => b.reportedShares - a.reportedShares)
    .slice(0, n)
    .map((h) => holderToChange(h, "EXITED", h.reportedShares, h.reportedValue));
}

// ---------------------------------------------------------------------------
// Pure: concentration trend
// ---------------------------------------------------------------------------

/**
 * Classify concentration trend by comparing top-5 holder pct between quarters.
 * Threshold: 5 percentage-point change (absolute) to register a trend.
 */
export function computeConcentrationTrend(
  latestTop5: number | null,
  previousTop5: number | null,
): ConcentrationTrend {
  if (latestTop5 === null || previousTop5 === null) return "insufficient_data";
  const diff = latestTop5 - previousTop5;
  if (diff > 0.05) return "increasing_concentration";
  if (diff < -0.05) return "broadening_ownership";
  return "stable_concentration";
}

// ---------------------------------------------------------------------------
// Pure: data quality
// ---------------------------------------------------------------------------

/**
 * Compute data quality confidence.
 *
 * Thresholds:
 *   high         : managerCount >= 10 AND coverage complete (ratio >= 0.5)
 *   moderate     : managerCount >= 5  AND coverage >= 0.3
 *   limited      : managerCount >= 2
 *   insufficient : managerCount < 2   (→ score = null)
 *
 * mappingCoverage = eligibleHoldingCount / (eligibleHoldingCount + excludedHoldingCount)
 * This reflects the fraction of holdings rows from effective filings that were
 * eligible (mapped + not put/call + not PRN) for the current symbol's aggregate.
 * It is NOT global mapping coverage — it is symbol-specific.
 *
 * We use symbol-level coverage rather than a global 60% threshold because
 * a well-covered symbol may exist alongside many unmapped symbols in the DB.
 */
export function computeDataQuality(
  managerCountLatest: number,
  mappingCoverage: number | null,
  hasTwoQuarters: boolean,
): { confidence: DataQualityConfidence; comparableManagerCount: number } {
  const comparableManagerCount = managerCountLatest;
  if (!hasTwoQuarters || managerCountLatest < 2) {
    return { confidence: "insufficient", comparableManagerCount };
  }
  const cov = mappingCoverage ?? 0;
  if (managerCountLatest >= 10 && cov >= 0.5) return { confidence: "high", comparableManagerCount };
  if (managerCountLatest >= 5 && cov >= 0.3) return { confidence: "moderate", comparableManagerCount };
  return { confidence: "limited", comparableManagerCount };
}

// ---------------------------------------------------------------------------
// Pure: score components
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round0(v: number): number {
  return Math.round(v);
}

/**
 * Component A — Breadth (30%)
 * Net direction of manager-count changes.
 *
 * Formula: 50 + 50 * (increased − reduced) / max(increased + reduced, 1)
 * Range: [0, 100]
 * Neutral point: 50 (equal numbers of increasers and reducers)
 */
export function computeBreadthComponent(increased: number, reduced: number): number {
  const changers = increased + reduced;
  if (changers === 0) return 50;
  return clamp(50 + 50 * (increased - reduced) / changers, 0, 100);
}

/**
 * Component B — Accumulation (30%)
 * Magnitude and direction of aggregate share change.
 *
 * Formula: 50 + 50 * clamp(shareChangePct / 0.25, -1, 1)
 * Reference range: ±25% share change = full signal (0 or 100).
 * Range: [0, 100]. Null when shareChangePct is unavailable.
 */
export function computeAccumulationComponent(shareChangePct: number | null): number | null {
  if (shareChangePct === null) return null;
  const normalized = clamp(shareChangePct / 0.25, -1, 1);
  return clamp(round0(50 + 50 * normalized), 0, 100);
}

/**
 * Component C — Entrants vs Exits (25%)
 * Net new managers vs exited managers, relative to total active manager count.
 *
 * Formula: 50 + 50 * clamp((new − exited) / max(new + exited, 1), -1, 1)
 * Range: [0, 100]. Neutral point: 50 (equal new and exited).
 */
export function computeEntrantsVsExitsComponent(newCount: number, exitedCount: number): number {
  const pool = newCount + exitedCount;
  if (pool === 0) return 50;
  return clamp(round0(50 + 50 * (newCount - exitedCount) / pool), 0, 100);
}

/**
 * Component D — Concentration context (15%)
 * Contextual signal quality modifier based on ownership breadth.
 *
 * NOT directional (does not imply concentration = bad).
 * broadening_ownership  : 65 — more managers sharing position = broader signal
 * stable_concentration  : 50 — neutral
 * increasing_concentration: 40 — more concentrated (reduced breadth signal)
 * insufficient_data     : 50 — neutral
 */
export function computeConcentrationComponent(trend: ConcentrationTrend): number {
  switch (trend) {
    case "broadening_ownership": return 65;
    case "stable_concentration": return 50;
    case "increasing_concentration": return 40;
    case "insufficient_data": return 50;
  }
}

/**
 * Compute the final weighted institutional evidence score (0–100).
 *
 * Weights: A=30%, B=30%, C=25%, D=15%
 * Null components are excluded and weights are renormalized.
 * Returns null when data quality is "insufficient" or when no valid components exist.
 */
export function computeInstitutionalScore(components: {
  breadth: number | null;
  accumulation: number | null;
  entrantsVsExits: number | null;
  concentration: number | null;
  confidence: DataQualityConfidence;
}): number | null {
  if (components.confidence === "insufficient") return null;

  const weighted: Array<[number | null, number]> = [
    [components.breadth, 0.30],
    [components.accumulation, 0.30],
    [components.entrantsVsExits, 0.25],
    [components.concentration, 0.15],
  ];

  let weightSum = 0;
  let scoreSum = 0;
  for (const [value, weight] of weighted) {
    if (value !== null) {
      scoreSum += value * weight;
      weightSum += weight;
    }
  }

  if (weightSum === 0) return null;

  // Renormalize if some components were null
  const raw = scoreSum / weightSum;
  return clamp(round0(raw), 0, 100);
}

// ---------------------------------------------------------------------------
// Pure: label
// ---------------------------------------------------------------------------

/**
 * Convert numeric score to signal label.
 *
 * Thresholds (inclusive lower bound):
 *   >= 75 → "Strong Accumulation"
 *   >= 60 → "Accumulation"
 *   >= 40 → "Stable"
 *   >= 25 → "Distribution"
 *   <  25 → "Strong Distribution"
 *   null  → "Insufficient Data"
 */
export function scoreToLabel(score: number | null): InstitutionalSignalLabel {
  if (score === null) return "Insufficient Data";
  if (score >= 75) return "Strong Accumulation";
  if (score >= 60) return "Accumulation";
  if (score >= 40) return "Stable";
  if (score >= 25) return "Distribution";
  return "Strong Distribution";
}

// ---------------------------------------------------------------------------
// Pure: deterministic summary
// ---------------------------------------------------------------------------

/**
 * Generate a short, deterministic summary from metrics.
 * No LLM. No investment recommendations. No predictive statements.
 *
 * Language examples:
 *   "Reported institutional ownership increased in the latest comparable quarter,
 *    with more managers increasing positions than reducing them."
 *
 *   "Reported ownership was broadly stable across the two latest comparable quarters."
 *
 *   "Comparable 13F history is not yet sufficient to calculate an institutional trend."
 */
export function buildDeterministicSummary(
  status: InstitutionalSignalStatus,
  label: InstitutionalSignalLabel | null,
  newCount: number,
  exitedCount: number,
  increasedCount: number,
  reducedCount: number,
  hasTwoQuarters: boolean,
  confidence: DataQualityConfidence,
): string {
  if (status === "unavailable") {
    return "Institutional 13F data is not available for this symbol.";
  }
  if (status === "processing") {
    return "Institutional 13F data is being processed for this symbol.";
  }
  if (!hasTwoQuarters || status === "insufficient_history") {
    return "Comparable 13F history is not yet sufficient to calculate an institutional ownership trend.";
  }
  if (status === "mapping_incomplete") {
    return "CUSIP-to-ticker mapping is incomplete for this symbol. The available signal is based on partially mapped holdings only.";
  }
  if (confidence === "insufficient") {
    return "Insufficient reporting activity in the 13F universe to produce a meaningful institutional ownership signal.";
  }

  const netManagers = increasedCount - reducedCount;
  const netEntrants = newCount - exitedCount;

  let directionPhrase: string;
  if (!label || label === "Insufficient Data") {
    directionPhrase = "Reported 13F institutional ownership activity could not be reliably classified.";
  } else if (label === "Strong Accumulation") {
    directionPhrase = "Reported institutional ownership increased substantially in the latest comparable quarter, with significantly more managers increasing positions than reducing them.";
  } else if (label === "Accumulation") {
    directionPhrase = "Reported institutional ownership increased in the latest comparable quarter, with more managers increasing positions than reducing them.";
  } else if (label === "Stable") {
    directionPhrase = "Reported institutional ownership was broadly stable across the two latest comparable quarters.";
  } else if (label === "Distribution") {
    directionPhrase = "Reported institutional ownership decreased in the latest comparable quarter, with more managers reducing positions than increasing them.";
  } else {
    directionPhrase = "Reported institutional ownership decreased substantially in the latest comparable quarter, with significantly more managers reducing or exiting positions.";
  }

  const entranceParts: string[] = [];
  if (newCount > 0) entranceParts.push(`${newCount} new position${newCount !== 1 ? "s" : ""} opened`);
  if (exitedCount > 0) entranceParts.push(`${exitedCount} position${exitedCount !== 1 ? "s" : ""} closed`);
  const entranceSuffix = entranceParts.length > 0 ? ` (${entranceParts.join(", ")}).` : ".";

  return `${directionPhrase}${entranceParts.length > 0 ? ` ${entranceParts[0].charAt(0).toUpperCase() + entranceParts[0].slice(1)}${entranceParts.length > 1 ? ` and ${entranceParts[1]}` : ""}.` : "."}`;
}

// ---------------------------------------------------------------------------
// Pure: future evidence/workspace compact contracts
// ---------------------------------------------------------------------------

export function signalToEvidence(signal: InstitutionalSignal): InstitutionalEvidence {
  const available = signal.status === "available" || signal.status === "insufficient_history";
  const score = signal.score;
  let evidenceStrength: InstitutionalEvidence["evidenceStrength"] = "unavailable";
  if (score !== null) {
    if (score >= 70) evidenceStrength = "strong";
    else if (score >= 50) evidenceStrength = "moderate";
    else evidenceStrength = "weak";
  }
  return {
    available,
    score,
    label: signal.label,
    evidenceStrength,
    dataQuality: signal.dataQuality.confidence,
    summary: signal.summary,
  };
}

export function signalToWorkspaceContract(signal: InstitutionalSignal): InstitutionalWorkspaceContract {
  const topEvidence: string[] = [];
  if (signal.metrics.newManagerCount > 0) {
    topEvidence.push(`${signal.metrics.newManagerCount} new manager${signal.metrics.newManagerCount !== 1 ? "s" : ""} opened positions`);
  }
  if (signal.metrics.exitedManagerCount > 0) {
    topEvidence.push(`${signal.metrics.exitedManagerCount} manager${signal.metrics.exitedManagerCount !== 1 ? "s" : ""} fully exited`);
  }
  if (signal.topBuyers.length > 0) {
    topEvidence.push(`Top buyer: ${signal.topBuyers[0].managerName}`);
  }
  return {
    status: signal.status,
    score: signal.score,
    label: signal.label,
    latestQuarter: signal.latestQuarter,
    summary: signal.summary,
    topEvidence: topEvidence.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Core: build signal from two aggregate rows (pure, no DB)
// ---------------------------------------------------------------------------

/**
 * Build a complete InstitutionalSignal from two pre-aggregated quarter rows.
 *
 * @param current  Latest quarter's aggregate row
 * @param previous Previous comparable quarter's aggregate row (null = one quarter only)
 * @param now      Optional timestamp for calculatedAt (defaults to current time)
 */
export function buildInstitutionalSignal(
  current: InstitutionalQuarterlyAggregate,
  previous: InstitutionalQuarterlyAggregate | null,
  now: Date = new Date(),
): InstitutionalSignal {
  const symbol = current.symbol;
  const hasTwoQuarters = previous !== null;

  // Quarter labels
  const latestQuarter = current.periodLabel ?? derivePeriodLabel(current.periodOfReport);
  const previousQuarter = previous
    ? (previous.periodLabel ?? derivePeriodLabel(previous.periodOfReport))
    : null;

  // Manager activity counts
  const newCount = current.newPositionCount ?? 0;
  const exitedCount = current.exitedPositionCount ?? 0;
  const increasedCount = current.increasedPositionCount ?? 0;
  const reducedCount = current.reducedPositionCount ?? 0;
  const unchangedCount = current.unchangedCount ?? 0;

  // Mapping coverage (symbol-level: eligible / total-reported)
  const eligibleCount = current.eligibleHoldingCount ?? 0;
  const excludedCount = current.excludedHoldingCount ?? 0;
  const totalHoldings = eligibleCount + excludedCount;
  const mappingCoverage = totalHoldings > 0 ? eligibleCount / totalHoldings : null;

  // Data quality
  const { confidence, comparableManagerCount } = computeDataQuality(
    current.reportingManagerCount ?? 0,
    mappingCoverage,
    hasTwoQuarters,
  );

  // Determine status
  let status: InstitutionalSignalStatus;
  if (!current.reportingManagerCount || current.reportingManagerCount === 0) {
    if (current.coverageStatus === "insufficient") {
      status = "mapping_incomplete";
    } else {
      status = "unavailable";
    }
  } else if (!hasTwoQuarters) {
    status = "insufficient_history";
  } else if (current.coverageStatus === "insufficient") {
    status = "mapping_incomplete";
  } else {
    status = "available";
  }

  // Parse largest holders from JSONB
  const currentHolders = parseHolders(current.largestHolders);
  const previousHolders = previous ? parseHolders(previous.largestHolders) : [];

  // Derive bounded change lists (all from stored JSON, no raw-holdings query)
  const topBuyers = deriveTopBuyers(currentHolders, 5);
  const topSellers = deriveTopSellers(currentHolders, 5);
  const newPositions = deriveNewPositions(currentHolders, 5);
  const exitedPositions = hasTwoQuarters
    ? deriveExitedPositions(previousHolders, currentHolders, 5)
    : [];

  // Concentration trend
  const concTrend = computeConcentrationTrend(
    current.top5HolderPercent ?? null,
    previous?.top5HolderPercent ?? null,
  );

  // Score components
  const A = computeBreadthComponent(increasedCount, reducedCount);
  const B = computeAccumulationComponent(current.reportedSharesChangePercent ?? null);
  const C = computeEntrantsVsExitsComponent(newCount, exitedCount);
  const D = computeConcentrationComponent(concTrend);

  const score = computeInstitutionalScore({
    breadth: A,
    accumulation: B,
    entrantsVsExits: C,
    concentration: D,
    confidence,
  });

  const label = scoreToLabel(score);
  const summary = buildDeterministicSummary(
    status,
    label,
    newCount,
    exitedCount,
    increasedCount,
    reducedCount,
    hasTwoQuarters,
    confidence,
  );

  // Metrics: value change in canonical US dollars
  const totalValueLatest = current.aggregateReportedValue ?? null;
  const totalValuePrevious = previous?.aggregateReportedValue ?? null;
  const valueChange =
    totalValueLatest !== null && totalValuePrevious !== null
      ? totalValueLatest - totalValuePrevious
      : null;
  const valueChangePct =
    valueChange !== null && totalValuePrevious !== null && totalValuePrevious > 0
      ? valueChange / totalValuePrevious
      : null;

  // Previous quarter's coverage for dataQuality diagnostics
  const prevEligible = previous?.eligibleHoldingCount ?? 0;
  const prevExcluded = previous?.excludedHoldingCount ?? 0;
  const prevTotal = prevEligible + prevExcluded;
  const prevCoverage = prevTotal > 0 ? prevEligible / prevTotal : null;

  return {
    symbol,
    status,
    latestQuarter,
    previousQuarter,
    periodEndDate: current.periodOfReport,
    score,
    label,
    summary,
    metrics: {
      managerCountLatest: current.reportingManagerCount ?? null,
      managerCountPrevious: previous?.reportingManagerCount ?? null,
      totalSharesLatest: current.aggregateReportedShares ?? null,
      totalSharesPrevious: current.previousQuarterShares ?? previous?.aggregateReportedShares ?? null,
      totalValueLatest,
      totalValuePrevious,
      shareChange: current.reportedSharesChange ?? null,
      shareChangePct: current.reportedSharesChangePercent ?? null,
      valueChange,
      valueChangePct,
      newManagerCount: newCount,
      exitedManagerCount: exitedCount,
      increasedManagerCount: increasedCount,
      reducedManagerCount: reducedCount,
      unchangedManagerCount: unchangedCount,
    },
    concentration: {
      holderCount: currentHolders.length,
      topHolderSharePct: current.topHolderPercent ?? null,
      top5HolderSharePct: current.top5HolderPercent ?? null,
      trend: concTrend,
    },
    topBuyers,
    topSellers,
    newPositions,
    exitedPositions,
    scoreComponents: {
      breadth: A,
      accumulation: B,
      entrantsVsExits: C,
      concentration: D,
      dataQuality: confidence === "insufficient" ? 0 : confidence === "limited" ? 40 : confidence === "moderate" ? 70 : 100,
    },
    dataQuality: {
      mappingCoverage: mappingCoverage !== null ? Math.round(mappingCoverage * 1000) / 1000 : null,
      comparableManagerCount,
      latestQuarterCoverage: mappingCoverage !== null ? Math.round(mappingCoverage * 1000) / 1000 : null,
      previousQuarterCoverage: prevCoverage !== null ? Math.round(prevCoverage * 1000) / 1000 : null,
      confidence,
    },
    freshness: {
      source: "SEC Form 13F",
      delayed: true,
      periodEndDate: current.periodOfReport,
      calculatedAt: now.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Rebuild service: read aggregates → compute signal → upsert
// ---------------------------------------------------------------------------

/**
 * Rebuild the precomputed institutional signal for one symbol.
 *
 * Reads the two most-recent institutional_quarterly_aggregates rows for the symbol,
 * computes the signal, and upserts into institutional_symbol_signals.
 *
 * Idempotent — safe to rerun. Does not access raw holdings at all.
 */
export async function rebuildInstitutionalSignalForSymbol(symbol: string): Promise<InstitutionalSignal> {
  const rows = await db
    .select()
    .from(institutionalQuarterlyAggregates)
    .where(eq(institutionalQuarterlyAggregates.symbol, symbol))
    .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
    .limit(2);

  if (rows.length === 0) {
    // No data at all — return unavailable, nothing to upsert
    const unavailable: InstitutionalSignal = {
      symbol,
      status: "unavailable",
      latestQuarter: null,
      previousQuarter: null,
      periodEndDate: null,
      score: null,
      label: null,
      summary: "No 13F aggregate data available for this symbol.",
      metrics: {
        managerCountLatest: null, managerCountPrevious: null,
        totalSharesLatest: null, totalSharesPrevious: null,
        totalValueLatest: null, totalValuePrevious: null,
        shareChange: null, shareChangePct: null, valueChange: null, valueChangePct: null,
        newManagerCount: 0, exitedManagerCount: 0, increasedManagerCount: 0,
        reducedManagerCount: 0, unchangedManagerCount: 0,
      },
      concentration: { holderCount: 0, topHolderSharePct: null, top5HolderSharePct: null, trend: "insufficient_data" },
      topBuyers: [], topSellers: [], newPositions: [], exitedPositions: [],
      scoreComponents: { breadth: null, accumulation: null, entrantsVsExits: null, concentration: null, dataQuality: null },
      dataQuality: { mappingCoverage: null, comparableManagerCount: 0, latestQuarterCoverage: null, previousQuarterCoverage: null, confidence: "insufficient" },
      freshness: { source: "SEC Form 13F", delayed: true, periodEndDate: null, calculatedAt: new Date().toISOString() },
    };
    return unavailable;
  }

  const [current, previous] = rows;
  const signal = buildInstitutionalSignal(current, previous ?? null);

  // Upsert into institutional_symbol_signals
  await db
    .insert(institutionalSymbolSignals)
    .values({
      symbol,
      status: signal.status,
      latestQuarter: signal.latestQuarter,
      previousQuarter: signal.previousQuarter,
      periodEndDate: signal.periodEndDate,
      score: signal.score,
      label: signal.label,
      summary: signal.summary,
      managerCountLatest: signal.metrics.managerCountLatest,
      managerCountPrevious: signal.metrics.managerCountPrevious,
      totalSharesLatest: signal.metrics.totalSharesLatest,
      totalSharesPrevious: signal.metrics.totalSharesPrevious,
      totalValueLatest: signal.metrics.totalValueLatest,
      totalValuePrevious: signal.metrics.totalValuePrevious,
      newManagerCount: signal.metrics.newManagerCount,
      exitedManagerCount: signal.metrics.exitedManagerCount,
      increasedManagerCount: signal.metrics.increasedManagerCount,
      reducedManagerCount: signal.metrics.reducedManagerCount,
      unchangedManagerCount: signal.metrics.unchangedManagerCount,
      topHolderPct: signal.concentration.topHolderSharePct,
      top5HolderPct: signal.concentration.top5HolderSharePct,
      concentrationTrend: signal.concentration.trend,
      mappingCoverage: signal.dataQuality.mappingCoverage,
      dataQualityConfidence: signal.dataQuality.confidence,
      topBuyers: signal.topBuyers as any,
      topSellers: signal.topSellers as any,
      newPositions: signal.newPositions as any,
      exitedPositions: signal.exitedPositions as any,
      scoreComponents: signal.scoreComponents as any,
      calculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: institutionalSymbolSignals.symbol,
      set: {
        status: signal.status,
        latestQuarter: signal.latestQuarter,
        previousQuarter: signal.previousQuarter,
        periodEndDate: signal.periodEndDate,
        score: signal.score,
        label: signal.label,
        summary: signal.summary,
        managerCountLatest: signal.metrics.managerCountLatest,
        managerCountPrevious: signal.metrics.managerCountPrevious,
        totalSharesLatest: signal.metrics.totalSharesLatest,
        totalSharesPrevious: signal.metrics.totalSharesPrevious,
        totalValueLatest: signal.metrics.totalValueLatest,
        totalValuePrevious: signal.metrics.totalValuePrevious,
        newManagerCount: signal.metrics.newManagerCount,
        exitedManagerCount: signal.metrics.exitedManagerCount,
        increasedManagerCount: signal.metrics.increasedManagerCount,
        reducedManagerCount: signal.metrics.reducedManagerCount,
        unchangedManagerCount: signal.metrics.unchangedManagerCount,
        topHolderPct: signal.concentration.topHolderSharePct,
        top5HolderPct: signal.concentration.top5HolderSharePct,
        concentrationTrend: signal.concentration.trend,
        mappingCoverage: signal.dataQuality.mappingCoverage,
        dataQualityConfidence: signal.dataQuality.confidence,
        topBuyers: signal.topBuyers as any,
        topSellers: signal.topSellers as any,
        newPositions: signal.newPositions as any,
        exitedPositions: signal.exitedPositions as any,
        scoreComponents: signal.scoreComponents as any,
        calculatedAt: new Date(),
      },
    });

  return signal;
}

/**
 * Rebuild signals for all symbols that have quarterly aggregate data.
 *
 * Idempotent — safe to rerun. Processes symbols sequentially to avoid
 * overwhelming the database. Future sprint may add scheduler integration.
 *
 * @param opts.symbols  Optional explicit list of symbols to rebuild (default: all)
 * @param opts.limit    Cap on number of symbols (default: unlimited)
 */
export async function rebuildInstitutionalSignals(opts: {
  symbols?: string[];
  limit?: number;
} = {}): Promise<{ rebuilt: number; failed: number; durationMs: number }> {
  const start = Date.now();

  let symbols: string[];
  if (opts.symbols && opts.symbols.length > 0) {
    symbols = opts.symbols;
  } else {
    // Distinct symbols from quarterly aggregates
    const rows = await db
      .selectDistinct({ symbol: institutionalQuarterlyAggregates.symbol })
      .from(institutionalQuarterlyAggregates);
    symbols = rows.map((r) => r.symbol);
  }

  if (opts.limit && opts.limit > 0) {
    symbols = symbols.slice(0, opts.limit);
  }

  let rebuilt = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      await rebuildInstitutionalSignalForSymbol(symbol);
      rebuilt++;
    } catch (err: any) {
      console.error(`[signal-engine] Failed to rebuild signal for ${symbol}: ${err?.message}`);
      failed++;
    }
  }

  console.log(`[signal-engine] Rebuild complete: ${rebuilt} rebuilt, ${failed} failed in ${Date.now() - start}ms`);
  return { rebuilt, failed, durationMs: Date.now() - start };
}

/**
 * Read a precomputed signal from institutional_symbol_signals.
 * Falls back to live computation from aggregates when not yet precomputed.
 * Returns null when no data exists at all.
 */
export async function getInstitutionalSignal(symbol: string): Promise<InstitutionalSignal | null> {
  // Try precomputed first (single-row lookup, O(1))
  const [stored] = await db
    .select()
    .from(institutionalSymbolSignals)
    .where(eq(institutionalSymbolSignals.symbol, symbol))
    .limit(1);

  if (stored) {
    // Reconstruct InstitutionalSignal from stored row
    return {
      symbol: stored.symbol,
      status: (stored.status as InstitutionalSignalStatus) ?? "unavailable",
      latestQuarter: stored.latestQuarter,
      previousQuarter: stored.previousQuarter,
      periodEndDate: stored.periodEndDate,
      score: stored.score,
      label: (stored.label as InstitutionalSignalLabel) ?? null,
      summary: stored.summary,
      metrics: {
        managerCountLatest: stored.managerCountLatest,
        managerCountPrevious: stored.managerCountPrevious,
        totalSharesLatest: stored.totalSharesLatest,
        totalSharesPrevious: stored.totalSharesPrevious,
        totalValueLatest: stored.totalValueLatest,
        totalValuePrevious: stored.totalValuePrevious,
        shareChange: null, // not stored, recomputable
        shareChangePct: null, // not stored, recomputable
        valueChange: null,
        valueChangePct: null,
        newManagerCount: stored.newManagerCount ?? 0,
        exitedManagerCount: stored.exitedManagerCount ?? 0,
        increasedManagerCount: stored.increasedManagerCount ?? 0,
        reducedManagerCount: stored.reducedManagerCount ?? 0,
        unchangedManagerCount: stored.unchangedManagerCount ?? 0,
      },
      concentration: {
        holderCount: 0,
        topHolderSharePct: stored.topHolderPct,
        top5HolderSharePct: stored.top5HolderPct,
        trend: (stored.concentrationTrend as ConcentrationTrend) ?? "insufficient_data",
      },
      topBuyers: Array.isArray(stored.topBuyers) ? (stored.topBuyers as InstitutionalManagerChange[]) : [],
      topSellers: Array.isArray(stored.topSellers) ? (stored.topSellers as InstitutionalManagerChange[]) : [],
      newPositions: Array.isArray(stored.newPositions) ? (stored.newPositions as InstitutionalManagerChange[]) : [],
      exitedPositions: Array.isArray(stored.exitedPositions) ? (stored.exitedPositions as InstitutionalManagerChange[]) : [],
      scoreComponents: (stored.scoreComponents as InstitutionalScoreComponents) ?? {
        breadth: null, accumulation: null, entrantsVsExits: null, concentration: null, dataQuality: null,
      },
      dataQuality: {
        mappingCoverage: stored.mappingCoverage,
        comparableManagerCount: stored.managerCountLatest ?? 0,
        latestQuarterCoverage: stored.mappingCoverage,
        previousQuarterCoverage: null,
        confidence: (stored.dataQualityConfidence as DataQualityConfidence) ?? "insufficient",
      },
      freshness: {
        source: "SEC Form 13F",
        delayed: true,
        periodEndDate: stored.periodEndDate,
        calculatedAt: stored.calculatedAt?.toISOString() ?? null,
      },
    };
  }

  // Fallback: compute live from aggregates (then save for next time)
  const signal = await rebuildInstitutionalSignalForSymbol(symbol);
  if (signal.status === "unavailable" && signal.metrics.managerCountLatest === null) {
    return null;
  }
  return signal;
}
