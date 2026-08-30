/**
 * Deterministic security identity resolver shared by institutional ingestion
 * and analytics. It deliberately does not perform issuer/name/fuzzy matching.
 */

export type SecurityResolverOutcome =
  | "RESOLVED_TRUSTED"
  | "AMBIGUOUS"
  | "CONFLICTING"
  | "UNSUPPORTED"
  | "INSUFFICIENT_EVIDENCE";

export interface SecurityResolutionEvidence {
  /** A provenance label. Symbol and status always belong to this one record. */
  source: string;
  symbol: string | null | undefined;
  status: string | null | undefined;
  cusip?: string | null;
  figi?: string | null;
  /** Explicitly marks source data which has already identified ambiguity. */
  ambiguous?: boolean;
}

export interface SecurityResolution {
  outcome: SecurityResolverOutcome;
  symbol: string | null;
  /** The trusted evidence records supporting a resolved symbol. */
  evidence: SecurityResolutionEvidence[];
}

export function normalizeSecuritySymbol(symbol: string | null | undefined): string | null {
  const normalized = symbol?.trim().toUpperCase();
  return normalized || null;
}

function trustRank(status: string | null | undefined): number {
  switch (status?.trim().toLowerCase()) {
    case "reviewed":
      return 2;
    case "exact":
      return 1;
    default:
      return 0;
  }
}

/**
 * Resolves only reviewed or exact evidence. Disagreement between any trusted
 * records is a conflict; callers that have a documented source precedence may
 * pass only that source tier on their first resolver invocation.
 * A symbol is never paired with a status from a different source record.
 */
export function resolveInstitutionalSecurity(
  evidence: readonly SecurityResolutionEvidence[],
): SecurityResolution {
  const usable = evidence
    .map((item) => ({ item, symbol: normalizeSecuritySymbol(item.symbol), rank: trustRank(item.status) }))
    .filter((item) => item.symbol !== null);
  const trusted = usable.filter((item) => item.rank > 0);

  if (trusted.length > 0) {
    const symbols = new Set(trusted.map((item) => item.symbol!));
    if (symbols.size !== 1) {
      return { outcome: "CONFLICTING", symbol: null, evidence: trusted.map(({ item }) => item) };
    }
    if (evidence.some((item) => item.ambiguous || item.status?.trim().toLowerCase() === "ambiguous")) {
      return { outcome: "AMBIGUOUS", symbol: null, evidence: trusted.map(({ item }) => item) };
    }
    return {
      outcome: "RESOLVED_TRUSTED",
      symbol: trusted[0].symbol,
      evidence: trusted.map(({ item }) => item),
    };
  }

  if (evidence.some((item) => item.ambiguous || item.status?.trim().toLowerCase() === "ambiguous")) {
    return { outcome: "AMBIGUOUS", symbol: null, evidence: [] };
  }
  if (usable.length > 0) {
    return { outcome: "UNSUPPORTED", symbol: null, evidence: [] };
  }
  return { outcome: "INSUFFICIENT_EVIDENCE", symbol: null, evidence: [] };
}

/** Alias retained as a concise entry point for domain callers. */
export const resolveSecurityEvidence = resolveInstitutionalSecurity;