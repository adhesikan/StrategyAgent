// Sprint 4.2 — Portfolio Fit display helpers.
//
// Pure functions only — no React, no DOM, no server imports.
// All logic is testable without a browser environment.
//
// Design rules:
//   • Never fabricate values — only produce rows from fields actually present.
//   • Show "Unknown" for fields the broker returned as unknown.
//   • Show "—" only when a field is absent entirely (not fabricated zero/null).
//   • Never show account IDs, broker tokens, or raw dollar balances.
//   • suggestedQuantity comes from the VM (ranking engine), not awareness.

import type { SafePortfolioAwareness } from "@/lib/portfolio-awareness";

// ---------------------------------------------------------------------------
// Tier / sufficiency style maps
// ---------------------------------------------------------------------------

export type ConcentrationLevel = "normal" | "elevated" | "high";
export type SufficiencyValue =
  | "verified"
  | "not_verified"
  | "insufficient"
  | "unknown"
  | null
  | undefined;

/** Tailwind badge classes keyed by concentration level. */
export const CONCENTRATION_LEVEL_CLASS: Record<ConcentrationLevel, string> = {
  normal:   "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  elevated: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  high:     "border-red-500/40 text-red-300 bg-red-500/10",
};

/** Tailwind text-color class for a sufficiency value. */
export const SUFFICIENCY_CLASS: Record<string, string> = {
  verified:     "text-emerald-300",
  sufficient:   "text-emerald-300",
  not_verified: "text-amber-300",
  insufficient: "text-red-300",
  unknown:      "text-muted-foreground",
};

/** Human-readable label for a sufficiency value. */
export const SUFFICIENCY_LABEL: Record<string, string> = {
  verified:     "Verified",
  sufficient:   "Sufficient",
  not_verified: "Not verified",
  insufficient: "Insufficient",
  unknown:      "Unknown",
};

// ---------------------------------------------------------------------------
// Row type — every displayed item in the Portfolio Fit section
// ---------------------------------------------------------------------------

export interface PortfolioFitRow {
  /** Column label shown in muted foreground. */
  label: string;
  /** Formatted value string. Never empty — use "Unknown" or "None detected" per spec. */
  value: string;
  /** Tailwind text-color class for the value cell (empty = inherit). */
  valueClass: string;
  /**
   * When non-empty, the value should be rendered as a Badge with this class.
   * When empty, render as plain text with valueClass.
   */
  badgeClass: string;
  /** data-testid attribute for the row wrapper. */
  testId: string;
  /** True when the row represents a warning/alert condition. */
  isAlert: boolean;
}

// ---------------------------------------------------------------------------
// Derived state helpers
// ---------------------------------------------------------------------------

/** True when a broker is connected and awareness data was returned. */
export function isBrokerConnected(
  awareness: SafePortfolioAwareness | null | undefined,
): boolean {
  return awareness != null;
}

/**
 * True when the user holds an existing position in the symbol.
 * Uses verifiedShares as the canonical signal (mirrors existingPosition.shares).
 */
export function hasExistingPosition(
  awareness: SafePortfolioAwareness | null | undefined,
): boolean {
  return (
    awareness != null &&
    (awareness.existingPosition != null || (awareness.verifiedShares ?? 0) > 0)
  );
}

/**
 * Human sentence for the concentration state.
 * Returns null when no concentration data is present.
 *
 * Examples:
 *   "14.2% portfolio allocation — elevated"
 *   "21.0% portfolio allocation — high"
 *   "3.5% portfolio allocation"
 */
export function concentrationSummary(
  awareness: SafePortfolioAwareness | null | undefined,
): string | null {
  if (!awareness?.concentrationWarning) return null;
  const { pct, level } = awareness.concentrationWarning;
  if (level === "normal") return `${pct}% portfolio allocation`;
  return `${pct}% portfolio allocation — ${level}`;
}

// ---------------------------------------------------------------------------
// Main display-row builder
// ---------------------------------------------------------------------------

/**
 * Builds the ordered display rows for the Portfolio Fit section.
 *
 * Returns [] when awareness is null/undefined (caller shows the
 * "No brokerage connected" placeholder instead).
 *
 * Ordering matches the spec:
 *   Existing Position → Current Shares → Portfolio Concentration →
 *   Buying Power → Cash Available → Existing Options →
 *   Suggested Position Size → Adjustment Reason
 *
 * @param awareness  SafePortfolioAwareness object from the Ask AI response.
 * @param suggestedQuantity  From TradePlanViewModel (computed by ranking engine).
 */
export function portfolioFitRows(
  awareness: SafePortfolioAwareness | null | undefined,
  suggestedQuantity?: number,
): PortfolioFitRow[] {
  if (!awareness) return [];

  const rows: PortfolioFitRow[] = [];

  // 1. Existing Position — shows share count + unrealised P&L when present.
  if (awareness.existingPosition != null) {
    const { shares, unrealizedPnl } = awareness.existingPosition;
    const pnlStr =
      unrealizedPnl !== 0
        ? ` (${unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} P&L)`
        : "";
    rows.push({
      label: "Existing Position",
      value: `${shares.toLocaleString()} shares${pnlStr}`,
      valueClass: "text-amber-300 font-medium",
      badgeClass: "",
      testId: "row-pf-existing-position",
      isAlert: true,
    });
  }

  // 2. Current Shares — verifiedShares only when existingPosition row was not shown.
  //    (existingPosition.shares mirrors verifiedShares; avoid duplicate rows.)
  if (
    awareness.verifiedShares != null &&
    awareness.existingPosition == null &&
    awareness.verifiedShares > 0
  ) {
    rows.push({
      label: "Current Shares",
      value: `${awareness.verifiedShares.toLocaleString()} shares`,
      valueClass: "text-amber-300 font-medium",
      badgeClass: "",
      testId: "row-pf-verified-shares",
      isAlert: true,
    });
  }

  // 3. Portfolio Concentration
  if (awareness.concentrationWarning != null) {
    const { pct, level } = awareness.concentrationWarning;
    rows.push({
      label: "Portfolio Concentration",
      value: `${pct}%`,
      valueClass:
        level === "high"
          ? "text-red-300 font-medium"
          : level === "elevated"
            ? "text-amber-300 font-medium"
            : "font-medium",
      badgeClass: CONCENTRATION_LEVEL_CLASS[level] ?? "",
      testId: "row-pf-concentration",
      isAlert: level !== "normal",
    });
  }

  // 4. Buying Power — show when explicitly returned (including "unknown").
  if (awareness.buyingPowerSufficiency != null) {
    const bp = awareness.buyingPowerSufficiency;
    rows.push({
      label: "Buying Power",
      value: SUFFICIENCY_LABEL[bp] ?? bp,
      valueClass: SUFFICIENCY_CLASS[bp] ?? "text-muted-foreground",
      badgeClass: "",
      testId: "row-pf-buying-power",
      isAlert: bp === "insufficient",
    });
  }

  // 5. Cash Available — show when explicitly returned (including "unknown").
  if (awareness.cashSufficiency != null) {
    const cs = awareness.cashSufficiency;
    rows.push({
      label: "Cash Available",
      value: SUFFICIENCY_LABEL[cs] ?? cs,
      valueClass: SUFFICIENCY_CLASS[cs] ?? "text-muted-foreground",
      badgeClass: "",
      testId: "row-pf-cash",
      isAlert: cs === "insufficient",
    });
  }

  // 6. Existing Options — field present (even when null = "None detected").
  //    Only omit when the field itself was never returned (undefined).
  if (awareness.existingOptionExposure !== undefined) {
    rows.push({
      label: "Existing Options",
      value: awareness.existingOptionExposure ?? "None detected",
      valueClass: awareness.existingOptionExposure
        ? "font-medium"
        : "text-muted-foreground",
      badgeClass: "",
      testId: "row-pf-options",
      isAlert: false,
    });
  }

  // 7. Suggested Position Size — from VM risk layer, not awareness.
  if (suggestedQuantity != null) {
    rows.push({
      label: "Suggested Position Size",
      value: `${suggestedQuantity.toLocaleString()} shares`,
      valueClass: "font-medium",
      badgeClass: "",
      testId: "row-pf-suggested-size",
      isAlert: false,
    });
  }

  // 8. Adjustment Reason — sizing override text from the ranking engine.
  if (awareness.sizingAdjustment) {
    rows.push({
      label: "Adjustment Reason",
      value: awareness.sizingAdjustment,
      valueClass: "text-amber-300/90",
      badgeClass: "",
      testId: "row-pf-adjustment-reason",
      isAlert: true,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Section-level visibility helper
// ---------------------------------------------------------------------------

/**
 * Returns the display state for the Portfolio Fit section as a whole.
 *
 * "hidden"        — portfolioAwareness is undefined; section is not rendered.
 * "disconnected"  — portfolioAwareness is explicitly null; show "No brokerage connected".
 * "no-position"   — awareness is present but no meaningful rows to display.
 * "show"          — at least one row to display.
 */
export type PortfolioFitState =
  | "hidden"
  | "disconnected"
  | "no-position"
  | "show";

export function portfolioFitState(
  awareness: SafePortfolioAwareness | null | undefined,
  suggestedQuantity?: number,
): PortfolioFitState {
  if (awareness === undefined) return "hidden";
  if (awareness === null) return "disconnected";
  const rows = portfolioFitRows(awareness, suggestedQuantity);
  return rows.length > 0 ? "show" : "no-position";
}
