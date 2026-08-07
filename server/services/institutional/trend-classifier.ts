// Institutional Trend Classifier — Sprint 2.2.5.
//
// Pure deterministic function. No DB access. No randomness.
//
// Output label: "13F Reported Holdings Trend"
// Preferred states:
//   Increasing | Stable | Decreasing | Mixed | Insufficient History | Unavailable
//
// Rules are fully documented below.
// Do not call the result "accumulation" when confidence or coverage is insufficient.
// Do not imply the trend predicts future returns.
//
// Inputs: two consecutive quarterly aggregate results.
// If only one quarter is available → Insufficient History.
// If coverage is insufficient → Unavailable.

import type { AggregationResult } from "./aggregation-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendState =
  | "increasing"
  | "stable"
  | "decreasing"
  | "mixed"
  | "insufficient_history"
  | "unavailable";

export interface TrendClassification {
  trend: TrendState;
  /** All rules that contributed to the classification, in plain language. */
  reasons: string[];
  /** Whether classification is based on full or partial coverage data */
  confidenceLevel: "high" | "moderate" | "low";
}

// ---------------------------------------------------------------------------
// Thresholds (documented)
// ---------------------------------------------------------------------------

/**
 * THRESHOLD DOCUMENTATION
 *
 * Share change thresholds:
 *   Increasing: reportedSharesChangePercent > +2% AND increasers > reducers
 *   Stable:     |reportedSharesChangePercent| ≤ 2% OR (change is small and mixed)
 *   Decreasing: reportedSharesChangePercent < -2% AND reducers > increasers
 *   Mixed:      shares changed significantly but manager counts conflict
 *               (e.g. aggregate increased but more managers reduced than increased)
 *
 * Manager activity dominance:
 *   "Meaningfully exceed": one side has ≥ 1.5× the other AND absolute diff ≥ 3 managers
 *   OR one side has ≥ 60% of all active managers (new+increased vs reduced+exited)
 *
 * Coverage requirements:
 *   Classification is suppressed to Unavailable when:
 *     - coverageStatus = "insufficient"
 *     - reportingManagerCount = 0
 *   Classification confidence is low when:
 *     - coverageStatus = "partial"
 *     - amendmentStatus = "pending_amendments"
 */

const SHARE_CHANGE_THRESHOLD = 0.02; // 2%
const MANAGER_DOMINANCE_RATIO = 1.5;
const MANAGER_DOMINANCE_MIN_DIFF = 3;
const MANAGER_DOMINANCE_MIN_SHARE = 0.6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isManagerDominant(a: number, b: number): boolean {
  if (a === 0 && b === 0) return false;
  if (b === 0) return true;
  return (
    (a >= b * MANAGER_DOMINANCE_RATIO && a - b >= MANAGER_DOMINANCE_MIN_DIFF) ||
    (a / (a + b) >= MANAGER_DOMINANCE_MIN_SHARE)
  );
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify the 13F reported holdings trend given current and optional previous aggregate.
 *
 * @param current - The most recent quarter's aggregate.
 * @param previous - The prior comparable quarter's aggregate, or null for first-quarter data.
 */
export function classifyTrend(
  current: AggregationResult,
  previous: AggregationResult | null,
): TrendClassification {
  const reasons: string[] = [];

  // Guard: no prior quarter data
  if (previous === null || current.prevPeriodOfReport === null) {
    return {
      trend: "insufficient_history",
      reasons: ["Only one quarter of 13F data is available; two comparable quarters are required for a trend."],
      confidenceLevel: "low",
    };
  }

  // Guard: current coverage insufficient
  if (current.coverageStatus === "insufficient" || current.reportingManagerCount === 0) {
    return {
      trend: "unavailable",
      reasons: ["Insufficient 13F coverage for this security in the current quarter."],
      confidenceLevel: "low",
    };
  }

  // Confidence level
  let confidenceLevel: "high" | "moderate" | "low" = "high";
  if (
    current.coverageStatus === "partial" ||
    current.amendmentStatus === "pending_amendments" ||
    previous.coverageStatus === "partial"
  ) {
    confidenceLevel = "moderate";
  }
  // current.coverageStatus === "insufficient" is already guarded above (early return).
  // Only check previous here.
  if (previous.coverageStatus === "insufficient") {
    confidenceLevel = "low";
  }

  // Aggregate shares signal
  const pctChange = current.reportedSharesChangePercent;
  let sharesSignal: "up" | "flat" | "down" | "unknown" = "unknown";
  if (pctChange !== null) {
    if (pctChange > SHARE_CHANGE_THRESHOLD) {
      sharesSignal = "up";
      reasons.push(
        `Aggregate reported shares increased ${(pctChange * 100).toFixed(1)}% quarter-over-quarter.`,
      );
    } else if (pctChange < -SHARE_CHANGE_THRESHOLD) {
      sharesSignal = "down";
      reasons.push(
        `Aggregate reported shares decreased ${(Math.abs(pctChange) * 100).toFixed(1)}% quarter-over-quarter.`,
      );
    } else {
      sharesSignal = "flat";
      reasons.push(
        `Aggregate reported shares changed by less than 2% quarter-over-quarter (stable).`,
      );
    }
  }

  // Manager activity signal
  const bulls = current.newPositionCount + current.increasedPositionCount;
  const bears = current.reducedPositionCount + current.exitedPositionCount;

  let managerSignal: "bull" | "bear" | "mixed" | "neutral" = "neutral";
  if (bulls > 0 || bears > 0) {
    if (isManagerDominant(bulls, bears)) {
      managerSignal = "bull";
      reasons.push(
        `Increasing/new reporting managers (${bulls}) meaningfully exceed reducing/exiting managers (${bears}).`,
      );
    } else if (isManagerDominant(bears, bulls)) {
      managerSignal = "bear";
      reasons.push(
        `Reducing/exiting reporting managers (${bears}) meaningfully exceed increasing/new managers (${bulls}).`,
      );
    } else {
      managerSignal = "mixed";
      reasons.push(
        `Manager activity is mixed: ${bulls} increasing/new vs ${bears} reducing/exiting.`,
      );
    }
  }

  // Combine signals into trend
  let trend: TrendState;

  if (sharesSignal === "up" && (managerSignal === "bull" || managerSignal === "neutral")) {
    trend = "increasing";
  } else if (sharesSignal === "down" && (managerSignal === "bear" || managerSignal === "neutral")) {
    trend = "decreasing";
  } else if (sharesSignal === "flat") {
    trend = "stable";
  } else if (sharesSignal === "up" && managerSignal === "bear") {
    // Aggregate up but more managers reducing — mixed
    trend = "mixed";
    reasons.push("Aggregate shares increased but more managers reduced or exited than added positions.");
  } else if (sharesSignal === "down" && managerSignal === "bull") {
    // Aggregate down but more managers increasing — mixed
    trend = "mixed";
    reasons.push("Aggregate shares decreased but more managers added than reduced positions.");
  } else if (managerSignal === "mixed") {
    trend = "mixed";
  } else if (sharesSignal === "unknown") {
    trend = "unavailable";
    reasons.push("Reported shares change could not be computed (missing data).");
  } else {
    trend = "stable";
  }

  return { trend, reasons, confidenceLevel };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Map trend state to a user-facing label. */
export function trendLabel(trend: TrendState): string {
  switch (trend) {
    case "increasing": return "Increasing";
    case "stable": return "Stable";
    case "decreasing": return "Decreasing";
    case "mixed": return "Mixed";
    case "insufficient_history": return "Insufficient History";
    case "unavailable": return "Unavailable";
    default: return "Unavailable";
  }
}

/** Color class for trend badge in the UI. */
export function trendColorClass(trend: TrendState): string {
  switch (trend) {
    case "increasing": return "text-emerald-400";
    case "stable": return "text-sky-400";
    case "decreasing": return "text-rose-400";
    case "mixed": return "text-amber-400";
    default: return "text-muted-foreground";
  }
}
