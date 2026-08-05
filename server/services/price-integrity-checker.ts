// Price Integrity Checker — Production Safety Fix
//
// Independent ratio-based cross-check: compares the price reported by the MCP
// scanner against the latest close or quote from VCP Trader's own data source.
//
// Purpose: detect decimal-order mismatches (10×, 100×, 0.1×, 0.01×) or
// material unexplained divergence before trusting any price-derived level.
//
// This module NEVER corrects values — it only classifies the relationship.
// Raw price values are NEVER forwarded to the client; use safeIntegrityResult()
// before including in any response payload.

export type PriceRatioCategory = "ok" | "10x" | "100x" | "0.1x" | "0.01x" | "divergent" | "unknown";

export interface PriceIntegrityResult {
  valid: boolean;
  /** Safe error code — never reveals provider internals. */
  code?:
    | "PRICE_REFERENCE_MISMATCH"
    | "PRICE_REFERENCE_UNAVAILABLE"
    | "PRICE_NON_FINITE"
    /**
     * Both the broker quote and the internal history close were available but
     * disagreed by more than the conflict tolerance (±40%). Prefer neither
     * silently — block ResearchSave and suppress price levels.
     */
    | "PRICE_REFERENCE_CONFLICT"
    /**
     * The selected reference is older than the approved freshness window
     * (>5 calendar days). A ratio comparison against a stale reference would
     * risk misclassifying legitimate long-term price moves as decimal-order
     * errors. Price levels are NOT suppressed — they cannot be validated by
     * this check, not refuted. ResearchSave is blocked until a fresh reference
     * is available.
     */
    | "PRICE_REFERENCE_STALE";
  /** Category of the detected ratio mismatch. */
  ratioCategory?: PriceRatioCategory;
  /** Price-derived fields that should be suppressed when valid:false. */
  affectedFields?: string[];
  /** Label for the reference source used (never the raw provider identifier). */
  referenceSource?: string;
  /**
   * Raw prices for server-side logging only — NEVER forward to client.
   * Use safeIntegrityResult() to strip these before any response.
   */
  setupPrice?: number;
  referencePrice?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ±15% is accepted as "ok" — accounts for intraday movement, spread,
// rounding differences, and brief delayed-data lag.
const TOLERANCE_RATIO_LOW = 0.85;
const TOLERANCE_RATIO_HIGH = 1.15;

// Decimal-order mismatch bands. A ratio between 8–12 is classified as "10×".
// A ratio between 80–120 is classified as "100×". Inverse ratios → inverse labels.
const DECIMAL_BANDS: Array<{
  low: number;
  high: number;
  label: PriceRatioCategory;
  inverse: PriceRatioCategory;
}> = [
  { low: 8, high: 12, label: "10x", inverse: "0.1x" },
  { low: 80, high: 120, label: "100x", inverse: "0.01x" },
];

/** Fields in a scan_strategy setup that carry price-derived values. */
export const AFFECTED_PRICE_FIELDS: readonly string[] = [
  "currentPrice",
  "trigger",
  "invalidation",
  "technicalObjective",
  "resistance",
  "majorHigh",
];

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Compares `setupPrice` (from the MCP scanner response) against `referencePrice`
 * (from VCP Trader's own market-history provider or live quote).
 *
 * Returns `{ valid: true, ratioCategory: "ok" }` when prices agree within ±15%.
 *
 * Returns `{ valid: false, code, ratioCategory, affectedFields }` for:
 * - Decimal-order mismatch (10×, 100×, 0.1×, 0.01×)
 * - Material unexplained divergence (outside tolerance, not a clean decimal order)
 * - Missing or non-finite prices
 *
 * `referenceSource` is a safe human-readable label for the reference (e.g.
 * "live_quote", "market_history") — never the raw provider identifier.
 */
export function checkPriceIntegrity(
  setupPrice: number | null | undefined,
  referencePrice: number | null | undefined,
  referenceSource: string = "market_history",
): PriceIntegrityResult {
  // --- Guard: missing prices ---
  if (setupPrice == null || referencePrice == null) {
    return { valid: false, code: "PRICE_REFERENCE_UNAVAILABLE", referenceSource };
  }

  // --- Guard: non-finite or non-positive setup price ---
  if (!Number.isFinite(setupPrice) || setupPrice <= 0) {
    return {
      valid: false,
      code: "PRICE_NON_FINITE",
      referenceSource,
      setupPrice,
    };
  }

  // --- Guard: non-finite or non-positive reference price ---
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return { valid: false, code: "PRICE_REFERENCE_UNAVAILABLE", referenceSource };
  }

  const ratio = setupPrice / referencePrice;

  // --- Within tolerance → valid ---
  if (ratio >= TOLERANCE_RATIO_LOW && ratio <= TOLERANCE_RATIO_HIGH) {
    return { valid: true, ratioCategory: "ok", referenceSource };
  }

  // --- Forward decimal-order mismatches (setupPrice >> referencePrice) ---
  for (const band of DECIMAL_BANDS) {
    if (ratio >= band.low && ratio <= band.high) {
      return {
        valid: false,
        code: "PRICE_REFERENCE_MISMATCH",
        ratioCategory: band.label,
        affectedFields: [...AFFECTED_PRICE_FIELDS],
        referenceSource,
        setupPrice,
        referencePrice,
      };
    }
  }

  // --- Inverse decimal-order mismatches (setupPrice << referencePrice) ---
  const invRatio = referencePrice / setupPrice;
  for (const band of DECIMAL_BANDS) {
    if (invRatio >= band.low && invRatio <= band.high) {
      return {
        valid: false,
        code: "PRICE_REFERENCE_MISMATCH",
        ratioCategory: band.inverse,
        affectedFields: [...AFFECTED_PRICE_FIELDS],
        referenceSource,
        setupPrice,
        referencePrice,
      };
    }
  }

  // --- Material unexplained divergence ---
  return {
    valid: false,
    code: "PRICE_REFERENCE_MISMATCH",
    ratioCategory: "divergent",
    affectedFields: [...AFFECTED_PRICE_FIELDS],
    referenceSource,
    setupPrice,
    referencePrice,
  };
}

// ---------------------------------------------------------------------------
// Safe public version (strips raw prices before client send)
// ---------------------------------------------------------------------------

/**
 * Returns a copy of the integrity result with raw price values removed.
 * ALWAYS use this before including a PriceIntegrityResult in any response.
 */
export function safeIntegrityResult(
  r: PriceIntegrityResult,
): Omit<PriceIntegrityResult, "setupPrice" | "referencePrice"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { setupPrice: _s, referencePrice: _r, ...safe } = r;
  return safe;
}

// ---------------------------------------------------------------------------
// Resolved-reference entry-point (freshness-aware)
// ---------------------------------------------------------------------------

/**
 * Structural minimum expected from a ResolvedReference without creating a
 * circular import (price-reference-resolver → price-integrity-checker).
 */
interface IntegrityableReference {
  /** True when both sources disagreed beyond the conflict tolerance. */
  conflict: boolean;
  /** Null when no usable reference price was found. */
  referencePrice: number | null;
  /** Human-readable label for the reference source. */
  source: string;
  /**
   * True when the reference is fresh or acceptable enough to run a ratio
   * comparison. False when freshness is "stale" or "unknown" — a ratio
   * comparison against a stale reference risks misclassifying legitimate
   * long-term price moves as decimal-order errors.
   */
  canCompareRatio: boolean;
}

/**
 * Freshness-aware entry-point for callers that already hold a
 * `ResolvedReference` from `resolveReferencePrice()`.
 *
 * Decision order:
 * 1. Conflict detected → PRICE_REFERENCE_CONFLICT (suppresses prices)
 * 2. No reference price → PRICE_REFERENCE_UNAVAILABLE
 * 3. Reference too stale for ratio comparison → PRICE_REFERENCE_STALE
 *    (does NOT suppress prices — the reference cannot validate, not refute)
 * 4. All clear → delegate to `checkPriceIntegrity` for ratio logic
 */
export function checkPriceIntegrityFromResolved(
  setupPrice: number | null | undefined,
  resolved: IntegrityableReference,
): PriceIntegrityResult {
  if (resolved.conflict) {
    return {
      valid: false,
      code: "PRICE_REFERENCE_CONFLICT",
      referenceSource: "unavailable",
    };
  }
  if (resolved.referencePrice == null) {
    return {
      valid: false,
      code: "PRICE_REFERENCE_UNAVAILABLE",
      referenceSource: resolved.source,
    };
  }
  if (!resolved.canCompareRatio) {
    return {
      valid: false,
      code: "PRICE_REFERENCE_STALE",
      referenceSource: resolved.source,
    };
  }
  return checkPriceIntegrity(setupPrice, resolved.referencePrice, resolved.source);
}
