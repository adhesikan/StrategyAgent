import { resolveInstitutionalSecurity } from "../security-resolver";
import { isEligibleForStockInstitutionalAnalytics } from "../security-type-eligibility";

export interface StockCandidateIdentity {
  candidateCusips: string[];
  hasReliableSecurityIdentity: boolean;
  hasDisqualifyingCandidateEvidence: boolean;
  hasTargetSpecificCandidateEvidence: boolean;
}

export interface StockCandidateCanonicalRow {
  cusip: string | null;
  reviewStatus: string | null;
  assetType: string | null;
}

export interface StockCandidateEvidenceRow {
  cusip: string | null;
  masterTicker: string | null;
  masterReviewStatus: string | null;
  masterAssetType: string | null;
  mappingSymbol: string | null;
  mappingStatus: string | null;
  holdingMappedSymbol: string | null;
  holdingMappingStatus: string | null;
}

/** Pure form of the live Stock View identity gate. */
export function evaluateStockCandidateIdentity(
  symbol: string,
  canonicalRows: readonly StockCandidateCanonicalRow[],
  evidenceRows: readonly StockCandidateEvidenceRow[],
): StockCandidateIdentity {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const matchesTarget = (value: string | null | undefined) =>
    value?.trim().toUpperCase() === normalizedSymbol;
  const resolvedRows = evidenceRows.map((row) => ({
    row,
    resolution: resolveInstitutionalSecurity([
      { source: "security_master", symbol: row.masterTicker, status: row.masterReviewStatus },
      { source: "institutional_mapping", symbol: row.mappingSymbol, status: row.mappingStatus },
      { source: "holding", symbol: row.holdingMappedSymbol, status: row.holdingMappingStatus },
    ]),
  }));
  const trustedForTarget = resolvedRows.filter(
    ({ row, resolution }) =>
      resolution.outcome === "RESOLVED_TRUSTED" &&
      matchesTarget(resolution.symbol) &&
      isEligibleForStockInstitutionalAnalytics({ assetType: row.masterAssetType }),
  );
  const trustedCanonicalForTarget = canonicalRows.some((canonical) => {
    if (canonical.reviewStatus !== "reviewed") return false;
    if (!isEligibleForStockInstitutionalAnalytics({ assetType: canonical.assetType })) return false;
    const sameCusipEvidence = evidenceRows.filter((row) => row.cusip === canonical.cusip);
    const resolution = resolveInstitutionalSecurity([
      {
        source: "security_master",
        symbol: normalizedSymbol,
        status: canonical.reviewStatus,
        cusip: canonical.cusip,
      },
      ...sameCusipEvidence.flatMap((row) => [
        { source: "institutional_mapping", symbol: row.mappingSymbol, status: row.mappingStatus, cusip: row.cusip },
        { source: "holding", symbol: row.holdingMappedSymbol, status: row.holdingMappingStatus, cusip: row.cusip },
      ]),
    ]);
    return resolution.outcome === "RESOLVED_TRUSTED" && matchesTarget(resolution.symbol);
  });
  const hasDisqualifyingCandidateEvidence = resolvedRows.some(
    ({ row, resolution }) =>
      !isEligibleForStockInstitutionalAnalytics({ assetType: row.masterAssetType }) ||
      resolution.outcome === "CONFLICTING" ||
      resolution.outcome === "AMBIGUOUS" ||
      (resolution.outcome === "RESOLVED_TRUSTED" && !matchesTarget(resolution.symbol)),
  );
  return {
    candidateCusips: Array.from(new Set(
      [...canonicalRows, ...evidenceRows]
        .map((row) => row.cusip)
        .filter((cusip): cusip is string => Boolean(cusip)),
    )).sort(),
    hasReliableSecurityIdentity: trustedForTarget.length > 0 || trustedCanonicalForTarget,
    hasDisqualifyingCandidateEvidence,
    hasTargetSpecificCandidateEvidence: canonicalRows.length > 0 || evidenceRows.length > 0,
  };
}