/**
 * The one request-time identity boundary for stock Institutional Intelligence.
 *
 * It deliberately derives its CUSIP set from canonical-security-state rather
 * than from a ticker on a holding or security_master.  Consumers receive a
 * resolved CUSIP set and must carry that set into their downstream reads.
 */
import { pool } from "../../db";
import { canonicalStockIdentityCte } from "./canonical-security-state";

export type CanonicalInstitutionalIdentityProvenance =
  "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY";

export interface CanonicalInstitutionalSecurityContext {
  requestedSymbol: string;
  normalizedSymbol: string;
  canonicalCusips: string[];
  assetType: "common_stock" | "reit";
  stockAnalyticsEligible: true;
  identityProvenance: CanonicalInstitutionalIdentityProvenance;
  currentEffectivePeriod: string | null;
}

interface ContextRow {
  normalizedSymbol?: string;
  /** Compatibility with callers/tests of the previous row-per-CUSIP query. */
  cusip?: string;
  assetType?: string | null;
  cusips: string[] | null;
  assetTypes: string[] | null;
  currentEffectivePeriod: string | Date | null;
}

/**
 * This is intentionally composed from the accepted canonical CTE.  It does
 * not add a second interpretation of trusted identity; it only packages the
 * already-selected rows for runtime consumers.
 */
export const canonicalInstitutionalSecurityContextForSymbolQuery = `
${canonicalStockIdentityCte}
SELECT
  ARRAY_AGG(canonical.cusip ORDER BY canonical.cusip) AS cusips,
  ARRAY_AGG(DISTINCT canonical.asset_type ORDER BY canonical.asset_type) AS "assetTypes",
  MAX(holdings.canonical_period_of_report) AS "currentEffectivePeriod"
FROM canonical
JOIN canonical_effective_holdings holdings ON holdings.cusip = canonical.cusip
WHERE canonical.symbol = $1
  AND canonical.asset_type IN ('common_stock', 'reit')`;

/** Set-based form of the exact same context query, for population readers. */
export const canonicalInstitutionalSecurityContextsQuery =
  canonicalInstitutionalSecurityContextForSymbolQuery
    .replace("canonical.symbol = $1", "canonical.symbol = ANY($1::text[])")
    .replace(
      "SELECT\n  ARRAY_AGG",
      "SELECT\n  canonical.symbol AS \"normalizedSymbol\",\n  ARRAY_AGG",
    )
    .replace(
      "  AND canonical.asset_type IN ('common_stock', 'reit')",
      "  AND canonical.asset_type IN ('common_stock', 'reit')\nGROUP BY canonical.symbol",
    );

function normalized(value: string): string {
  return value.trim().toUpperCase();
}

function dateText(value: string | Date | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function resolveCanonicalInstitutionalSecurityContext(
  requestedSymbol: string,
): Promise<CanonicalInstitutionalSecurityContext | null> {
  const normalizedSymbol = normalized(requestedSymbol);
  if (!normalizedSymbol) return null;
  const result = await pool.query<ContextRow>(
    canonicalInstitutionalSecurityContextForSymbolQuery,
    [normalizedSymbol],
  );
  const row = result.rows[0];
  const canonicalCusips = Array.from(new Set(
    result.rows
      .flatMap((candidate) =>
        candidate.cusips ?? (candidate.cusip ? [candidate.cusip] : []),
      )
      .map(normalized)
      .filter(Boolean),
  )).sort();
  const assetTypes = Array.from(new Set(
    result.rows
      .flatMap((candidate) =>
        candidate.assetTypes ??
        (candidate.assetType ? [candidate.assetType] : []),
      )
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ));
  if (canonicalCusips.length === 0 || assetTypes.length !== 1) return null;
  const assetType = assetTypes[0];
  if (assetType !== "common_stock" && assetType !== "reit") return null;
  return {
    requestedSymbol,
    normalizedSymbol,
    canonicalCusips,
    assetType,
    stockAnalyticsEligible: true,
    identityProvenance: "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY",
    currentEffectivePeriod: dateText(row?.currentEffectivePeriod ?? null),
  };
}

/**
 * Batches canonical context resolution. This is the acceptance-harness seam:
 * one canonical database query irrespective of population size.
 */
export async function resolveCanonicalInstitutionalSecurityContexts(
  requestedSymbols: readonly string[],
): Promise<Map<string, CanonicalInstitutionalSecurityContext>> {
  const symbols = Array.from(new Set(requestedSymbols.map(normalized).filter(Boolean))).sort();
  if (symbols.length === 0) return new Map();
  const result = await pool.query<ContextRow>(
    canonicalInstitutionalSecurityContextsQuery,
    [symbols],
  );
  const contexts = new Map<string, CanonicalInstitutionalSecurityContext>();
  for (const row of result.rows) {
    const normalizedSymbol = normalized(row.normalizedSymbol ?? "");
    const canonicalCusips = Array.from(new Set(
      (row.cusips ?? []).map(normalized).filter(Boolean),
    )).sort();
    const assetTypes = Array.from(new Set(
      (row.assetTypes ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    ));
    const assetType = assetTypes[0];
    if (!normalizedSymbol || canonicalCusips.length === 0 || assetTypes.length !== 1 ||
      (assetType !== "common_stock" && assetType !== "reit")) continue;
    contexts.set(normalizedSymbol, {
      requestedSymbol: normalizedSymbol,
      normalizedSymbol,
      canonicalCusips,
      assetType,
      stockAnalyticsEligible: true,
      identityProvenance: "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY",
      currentEffectivePeriod: dateText(row.currentEffectivePeriod),
    });
  }
  return contexts;
}