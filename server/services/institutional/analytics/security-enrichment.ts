/**
 * Institutional security enrichment domain helpers.
 *
 * CUSIP resolution is deliberately conservative: only reviewed security-master
 * records and exact/reviewed legacy holding mappings can produce a symbol.
 * An unresolved holding remains a valid holding, but cannot enter symbol-based
 * sector, industry, or theme calculations.
 */

import type {
  EnrichedInstitutionalHolding,
  EnrichmentMetadataResolution,
  InstitutionalMappingCoverage,
  InstitutionalSecurityMetadata,
  InstitutionalThemeMembership,
} from "./types";

export interface SecurityMappingEvidence {
  source: "security_master" | "institutional_mapping" | "holding";
  symbol: string | null;
  status: string | null;
}

export interface ReliableMappingResolution {
  status: "reliably_mapped" | "unmapped" | "ambiguous";
  symbol: string | null;
  reason: "unmapped" | "ambiguous" | null;
}

function normalizedSymbol(symbol: string | null | undefined): string | null {
  const value = symbol?.trim().toUpperCase();
  return value ? value : null;
}

/**
 * Apply the existing mapping trust order without guessing:
 * reviewed security_master > exact/reviewed mapping records.
 * Conflicting same-level evidence is ambiguous, not auto-resolved.
 */
export function resolveReliableSecurityMapping(
  evidence: SecurityMappingEvidence[],
): ReliableMappingResolution {
  const reviewedMaster = evidence.find(
    (item) =>
      item.source === "security_master" &&
      item.status === "reviewed" &&
      normalizedSymbol(item.symbol),
  );
  if (reviewedMaster) {
    return {
      status: "reliably_mapped",
      symbol: normalizedSymbol(reviewedMaster.symbol),
      reason: null,
    };
  }

  const exactEvidence = evidence.filter(
    (item) =>
      (item.source === "institutional_mapping" || item.source === "holding") &&
      (item.status === "exact" || item.status === "reviewed") &&
      normalizedSymbol(item.symbol),
  );
  const symbols = Array.from(
    new Set(exactEvidence.map((item) => normalizedSymbol(item.symbol)!)),
  );
  if (symbols.length === 1) {
    return { status: "reliably_mapped", symbol: symbols[0], reason: null };
  }
  if (symbols.length > 1) {
    return { status: "ambiguous", symbol: null, reason: "ambiguous" };
  }
  if (evidence.some((item) => item.status === "ambiguous")) {
    return { status: "ambiguous", symbol: null, reason: "ambiguous" };
  }
  return { status: "unmapped", symbol: null, reason: "unmapped" };
}

export interface EnrichmentHoldingInput {
  holdingId: string;
  accessionNumber: string;
  filerCik: string;
  filerName: string;
  issuerName: string;
  cusip: string;
  periodOfReport: string;
  reportedValueDollars: number | null;
  reportedShares: number | null;
  securityPositionType: string | null;
  putCall: string | null;
}

export function buildEnrichedInstitutionalHolding(
  holding: EnrichmentHoldingInput,
  resolution: ReliableMappingResolution,
  metadata: InstitutionalSecurityMetadata | null,
  themes: InstitutionalThemeMembership[],
  metadataResolution: EnrichmentMetadataResolution = metadata ? "canonical" : "unavailable",
): EnrichedInstitutionalHolding {
  const isMapped = resolution.status === "reliably_mapped";
  const isCanonical = isMapped && metadataResolution === "canonical";
  return {
    ...holding,
    mappingResolution: resolution.status,
    metadataResolution: isMapped ? metadataResolution : "unavailable",
    classificationStatus: isCanonical ? "classified" : "unclassified",
    unclassifiedReason:
      !isMapped
        ? resolution.reason
        : isCanonical
          ? null
          : "metadata_unavailable",
    metadata: isMapped ? metadata : null,
    themes: isMapped ? themes : [],
  };
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000) / 100;
}

export function computeInstitutionalMappingCoverage(
  holdings: EnrichedInstitutionalHolding[],
): InstitutionalMappingCoverage {
  const totalHoldingCount = holdings.length;
  const reliablyMappedHoldingCount = holdings.filter(
    (holding) => holding.mappingResolution === "reliably_mapped",
  ).length;
  const unmappedHoldingCount = holdings.filter(
    (holding) => holding.mappingResolution === "unmapped",
  ).length;
  const ambiguousHoldingCount = holdings.filter(
    (holding) => holding.mappingResolution === "ambiguous",
  ).length;
  const sectorEnrichedHoldingCount = holdings.filter(
    (holding) => holding.metadata?.sector != null,
  ).length;
  const industryEnrichedHoldingCount = holdings.filter(
    (holding) => holding.metadata?.industry != null,
  ).length;
  const themeEnrichedHoldingCount = holdings.filter(
    (holding) => holding.themes.length > 0,
  ).length;

  return {
    totalHoldingCount,
    reliablyMappedHoldingCount,
    unmappedHoldingCount,
    ambiguousHoldingCount,
    unclassifiedHoldingCount: holdings.filter(
      (holding) => holding.classificationStatus === "unclassified",
    ).length,
    symbolCoveragePercent: percentage(reliablyMappedHoldingCount, totalHoldingCount),
    sectorEnrichedHoldingCount,
    industryEnrichedHoldingCount,
    themeEnrichedHoldingCount,
    sectorCoveragePercent: percentage(sectorEnrichedHoldingCount, totalHoldingCount),
    industryCoveragePercent: percentage(industryEnrichedHoldingCount, totalHoldingCount),
    themeCoveragePercent: percentage(themeEnrichedHoldingCount, totalHoldingCount),
  };
}