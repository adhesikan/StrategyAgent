// Institutional Evidence Alignment — Sprint 2.2.5.
//
// Pure deterministic function — no DB access.
// Integrates 13F institutional context into the Evidence Engine additively.
//
// Possible states: Supports | Neutral | Weakens | Unavailable
// All rules are deterministic and documented below.
//
// RESTRICTIONS:
//   - Do not change existing global evidence-score formulas.
//   - Institutional evidence must not dominate technical qualification.
//   - Do not call the result a "recommendation."
//   - Do not show stars or predictive confidence outside the existing model.
//   - Never imply institutional participation predicts future returns.

import type { AggregationResult } from "./aggregation-engine";
import type { TrendState } from "./trend-classifier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvidenceAlignmentState = "supports" | "neutral" | "weakens" | "unavailable";

export interface EvidenceAlignmentResult {
  state: EvidenceAlignmentState;
  /** Plain-language reasons, each tied to a specific rule */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Rules (documented)
// ---------------------------------------------------------------------------

/**
 * RULE DOCUMENTATION
 *
 * UNAVAILABLE when ANY of:
 *   - aggregate is null (no data for this symbol)
 *   - coverageStatus = "insufficient"
 *   - reportingManagerCount = 0
 *   - prevPeriodOfReport is null (no prior quarter for comparison)
 *   - amendmentStatus = "pending_amendments"
 *   - trend = "unavailable"
 *
 * SUPPORTS when ALL of:
 *   - eligible reported shares increased (reportedSharesChange > 0)
 *   - increasing managers meaningfully exceed reducing managers
 *     (newPositionCount + increasedPositionCount > reducedPositionCount + exitedPositionCount
 *      by at least MIN_MANAGER_ADVANTAGE managers AND ratio ≥ MIN_MANAGER_RATIO)
 *   - coverageStatus = "complete" OR "partial" with adequate manager count
 *   - no unresolved amendment issues
 *
 * WEAKENS when ALL of:
 *   - eligible reported shares decreased (reportedSharesChange < 0)
 *   - reducers/exits meaningfully exceed increasers/new positions
 *   - coverageStatus is adequate
 *
 * NEUTRAL when:
 *   - shares change is small OR manager activity is mixed
 *   - OR conditions for SUPPORTS/WEAKENS are not clearly met
 */

const MIN_MANAGER_ADVANTAGE = 2;
const MIN_MANAGER_RATIO = 1.3;

function isManagerDominant(a: number, b: number): boolean {
  if (a === 0 && b === 0) return false;
  if (b === 0 && a >= MIN_MANAGER_ADVANTAGE) return true;
  return a - b >= MIN_MANAGER_ADVANTAGE && (b === 0 || a / b >= MIN_MANAGER_RATIO);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compute the evidence alignment state for a given quarterly aggregate and trend.
 *
 * @param aggregate - Pre-computed aggregate result, or null when no data.
 * @param trend - Trend classification for the symbol.
 */
export function computeEvidenceAlignment(
  aggregate: AggregationResult | null,
  trend: TrendState,
): EvidenceAlignmentResult {
  // Guard: no data at all
  if (aggregate === null) {
    return {
      state: "unavailable",
      reasons: ["No 13F data is available for this security."],
    };
  }

  const reasons: string[] = [];

  // Guard: insufficient coverage
  if (aggregate.coverageStatus === "insufficient" || aggregate.reportingManagerCount === 0) {
    return {
      state: "unavailable",
      reasons: ["13F coverage is insufficient for a meaningful evidence assessment."],
    };
  }

  // Guard: only one quarter of data
  if (aggregate.prevPeriodOfReport === null) {
    return {
      state: "unavailable",
      reasons: [
        "Only one quarter of 13F data is available. Two comparable quarters are required for evidence alignment.",
      ],
    };
  }

  // Guard: pending amendments
  if (aggregate.amendmentStatus === "pending_amendments") {
    return {
      state: "unavailable",
      reasons: ["Pending 13F amendments may affect the aggregate; assessment deferred until amendments are processed."],
    };
  }

  // Guard: trend unavailable
  if (trend === "unavailable" || trend === "insufficient_history") {
    return {
      state: "unavailable",
      reasons: ["Trend data is unavailable; evidence alignment cannot be determined."],
    };
  }

  const bulls = aggregate.newPositionCount + aggregate.increasedPositionCount;
  const bears = aggregate.reducedPositionCount + aggregate.exitedPositionCount;
  const sharesChange = aggregate.reportedSharesChange;

  // SUPPORTS conditions
  const sharesIncreased = sharesChange !== null && sharesChange > 0;
  const bullsDominant = isManagerDominant(bulls, bears);

  if (sharesIncreased && bullsDominant) {
    if (sharesChange !== null) {
      const pct = aggregate.reportedSharesChangePercent;
      reasons.push(
        pct !== null
          ? `Reported eligible shares increased ${(pct * 100).toFixed(1)}% quarter-over-quarter.`
          : "Reported eligible shares increased quarter-over-quarter.",
      );
    }
    reasons.push(
      `Increasing and new reporting managers (${bulls}) meaningfully exceed reducing and exiting managers (${bears}).`,
    );
    if (aggregate.coverageStatus === "partial") {
      reasons.push("Note: coverage is partial — not all eligible managers may be reflected.");
    }
    return { state: "supports", reasons };
  }

  // WEAKENS conditions
  const sharesDecreased = sharesChange !== null && sharesChange < 0;
  const bearsDominant = isManagerDominant(bears, bulls);

  if (sharesDecreased && bearsDominant) {
    if (sharesChange !== null) {
      const pct = aggregate.reportedSharesChangePercent;
      reasons.push(
        pct !== null
          ? `Reported eligible shares decreased ${(Math.abs(pct) * 100).toFixed(1)}% quarter-over-quarter.`
          : "Reported eligible shares decreased quarter-over-quarter.",
      );
    }
    reasons.push(
      `Reducing and exiting reporting managers (${bears}) meaningfully exceed increasing and new managers (${bulls}).`,
    );
    return { state: "weakens", reasons };
  }

  // NEUTRAL: mixed or small changes
  if (sharesChange !== null && Math.abs(sharesChange) > 0) {
    if (aggregate.reportedSharesChangePercent !== null) {
      reasons.push(
        `Aggregate reported shares changed ${aggregate.reportedSharesChangePercent > 0 ? "+" : ""}${(aggregate.reportedSharesChangePercent * 100).toFixed(1)}% — change is within the neutral range or manager signals are mixed.`,
      );
    }
  } else {
    reasons.push("Reported share change is negligible or not available.");
  }

  if (bulls > 0 || bears > 0) {
    reasons.push(`Manager activity is mixed: ${bulls} increasing/new vs ${bears} reducing/exiting.`);
  }

  return { state: "neutral", reasons };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Map state to user-facing label. */
export function alignmentLabel(state: EvidenceAlignmentState): string {
  switch (state) {
    case "supports": return "Supports";
    case "neutral": return "Neutral";
    case "weakens": return "Weakens";
    case "unavailable": return "Unavailable";
    default: return "Unavailable";
  }
}

/** Color class for alignment badge. */
export function alignmentColorClass(state: EvidenceAlignmentState): string {
  switch (state) {
    case "supports": return "text-emerald-400";
    case "weakens": return "text-rose-400";
    case "neutral": return "text-sky-400";
    default: return "text-muted-foreground";
  }
}
