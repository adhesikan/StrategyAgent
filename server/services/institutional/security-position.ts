/**
 * Normalized 13F security-position categories.
 *
 * These categories remain separate. Deterministic analytics should default to
 * COMMON_EQUITY and include PUT or CALL only when explicitly requested.
 */
export type InstitutionalSecurityPositionType =
  | "COMMON_EQUITY"
  | "PUT"
  | "CALL";

/**
 * Classify the SEC put_call field without merging option rows into equity.
 * Empty/null values represent common equity in the stored 13F contract.
 */
export function classifySecurityPositionType(
  putCall: string | null | undefined,
): InstitutionalSecurityPositionType {
  const normalized = String(putCall ?? "").trim().toUpperCase();
  if (!normalized) return "COMMON_EQUITY";
  if (normalized === "PUT" || normalized === "P") return "PUT";
  if (normalized === "CALL" || normalized === "C") return "CALL";
  throw new RangeError(`Unsupported institutional put_call value: ${normalized}`);
}

export function isCommonEquityPosition(
  putCall: string | null | undefined,
): boolean {
  return classifySecurityPositionType(putCall) === "COMMON_EQUITY";
}