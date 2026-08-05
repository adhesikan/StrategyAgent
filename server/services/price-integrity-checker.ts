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
  code?: "PRICE_REFERENCE_MISMATCH" | "PRICE_REFERENCE_UNAVAILABLE" | "PRICE_NON_FINITE";
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
