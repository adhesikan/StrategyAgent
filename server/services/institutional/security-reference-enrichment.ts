/**
 * Provider-neutral, conservative enrichment of institutional security
 * references. This module intentionally never compares issuer names or tries
 * to infer a security from a similar CUSIP, FIGI, or ticker.
 */

import { resolveInstitutionalSecurity } from "./security-resolver";

export type SecurityReferenceOutcome =
  | "AUTHORITATIVELY_RESOLVABLE"
  | "AMBIGUOUS"
  | "CONFLICTING"
  | "UNSUPPORTED"
  | "NO_REFERENCE_AVAILABLE"
  | "PROVIDER_FAILED"
  | "RATE_LIMITED"
  | "PARTIAL_RESPONSE";

export type SecurityReferenceEvidenceStatus = "reviewed" | "exact" | "unreviewed";

export interface SecurityReferenceEvidence {
  source: string;
  cusip: string | null | undefined;
  symbol: string | null | undefined;
  status: SecurityReferenceEvidenceStatus;
  /** A reviewer can explicitly prevent automated resolution. */
  ambiguous?: boolean;
}

export interface SecurityReferenceCandidate {
  provider: string;
  figi?: string | null;
  compositeFigi?: string | null;
  shareClassFigi?: string | null;
  ticker?: string | null;
  name?: string | null;
  securityType?: string | null;
  marketSector?: string | null;
  securityType2?: string | null;
  exchangeCode?: string | null;
  /** Explicit provider signal that this identifier has more than one meaning. */
  ambiguous?: boolean;
}

export interface SecurityReferenceResolution {
  cusip: string | null;
  outcome: SecurityReferenceOutcome;
  symbol: string | null;
  candidates: readonly SecurityReferenceCandidate[];
  evidence: readonly SecurityReferenceEvidence[];
  /** Stable, non-cryptographic grouping key; not a security identifier. */
  fingerprint: string;
  errorCode?: string;
  retryAfterMs?: number;
}

export const CUSIP_PATTERN = /^[0-9A-Z]{9}$/;

/** Removes presentation separators only; it does not repair or checksum CUSIPs. */
export function normalizeCusip(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  return CUSIP_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeReferenceSymbol(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function stableCandidateCompare(a: SecurityReferenceCandidate, b: SecurityReferenceCandidate): number {
  return [
    a.ticker ?? "", a.figi ?? "", a.compositeFigi ?? "", a.shareClassFigi ?? "",
    a.securityType ?? "", a.marketSector ?? "", a.exchangeCode ?? "", a.name ?? "",
  ].join("\u0000").localeCompare([
    b.ticker ?? "", b.figi ?? "", b.compositeFigi ?? "", b.shareClassFigi ?? "",
    b.securityType ?? "", b.marketSector ?? "", b.exchangeCode ?? "", b.name ?? "",
  ].join("\u0000"));
}

function normalizedCandidate(candidate: SecurityReferenceCandidate): SecurityReferenceCandidate {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  return {
    provider: clean(candidate.provider) ?? "unknown",
    figi: clean(candidate.figi)?.toUpperCase() ?? null,
    compositeFigi: clean(candidate.compositeFigi)?.toUpperCase() ?? null,
    shareClassFigi: clean(candidate.shareClassFigi)?.toUpperCase() ?? null,
    ticker: normalizeReferenceSymbol(candidate.ticker),
    name: clean(candidate.name),
    securityType: clean(candidate.securityType),
    marketSector: clean(candidate.marketSector),
    securityType2: clean(candidate.securityType2),
    exchangeCode: clean(candidate.exchangeCode)?.toUpperCase() ?? null,
    ambiguous: candidate.ambiguous === true,
  };
}

export function sortSecurityReferenceCandidates(
  candidates: readonly SecurityReferenceCandidate[],
): SecurityReferenceCandidate[] {
  return candidates.map(normalizedCandidate).sort(stableCandidateCompare);
}

function fingerprint(parts: readonly string[]): string {
  // FNV-1a is deliberately used only to make deterministic output concise.
  let hash = 0x811c9dc5;
  for (const char of parts.join("\u001f")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sr-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function makeResolution(
  cusip: string | null,
  outcome: SecurityReferenceOutcome,
  symbol: string | null,
  candidates: readonly SecurityReferenceCandidate[],
  evidence: readonly SecurityReferenceEvidence[],
  extra: Pick<SecurityReferenceResolution, "errorCode" | "retryAfterMs"> = {},
): SecurityReferenceResolution {
  const sortedCandidates = sortSecurityReferenceCandidates(candidates);
  return {
    cusip,
    outcome,
    symbol,
    candidates: sortedCandidates,
    evidence: [...evidence].sort((a, b) =>
      `${a.source}\u0000${a.symbol ?? ""}`.localeCompare(`${b.source}\u0000${b.symbol ?? ""}`),
    ),
    fingerprint: fingerprint([
      cusip ?? "", outcome, symbol ?? "",
      ...sortedCandidates.map((candidate) =>
        [candidate.provider, candidate.ticker ?? "", candidate.figi ?? "", candidate.compositeFigi ?? "",
          candidate.shareClassFigi ?? "", candidate.name ?? "", candidate.securityType ?? "",
          candidate.marketSector ?? "", candidate.securityType2 ?? "", candidate.exchangeCode ?? ""].join("|")),
    ]),
    ...extra,
  };
}

/**
 * Reviewed evidence takes precedence over all automated evidence. Exact
 * evidence is useful only when no reviewed evidence exists. This is pure so
 * review workflows can use the same rule without an HTTP provider.
 */
export function resolveReviewedSecurityReference(
  cusipInput: string | null | undefined,
  evidence: readonly SecurityReferenceEvidence[],
  candidates: readonly SecurityReferenceCandidate[] = [],
): SecurityReferenceResolution {
  const cusip = normalizeCusip(cusipInput);
  if (!cusip) return makeResolution(null, "UNSUPPORTED", null, candidates, evidence, { errorCode: "INVALID_CUSIP" });

  const matching = evidence.filter((item) => normalizeCusip(item.cusip) === cusip);
  const reviewed = matching.filter((item) => item.status === "reviewed");
  const supportedCandidates = candidates.filter(isSupported13fIdentityCandidate);
  if (candidates.length > 0 && supportedCandidates.length === 0) {
    // A reviewed decision is authoritative even when the provider's current
    // classification is not 13F-eligible.
    if (reviewed.length === 0) return makeResolution(cusip, "UNSUPPORTED", null, candidates, []);
  }

  // Task #189 is the sole trust resolver. Reviewed evidence is an exclusive
  // tier: lower-tier local/provider evidence cannot override or conflict with it.
  const exact = matching.filter((item) => item.status === "exact");
  const resolverEvidence = reviewed.length > 0
    ? reviewed
    : exact;
  if (reviewed.length === 0 && exact.length === 0) {
    if (supportedCandidates.some((candidate) => candidate.ambiguous)) {
      return makeResolution(cusip, "AMBIGUOUS", null, candidates, []);
    }
    const providerSymbols = new Set(supportedCandidates.map((candidate) => normalizeReferenceSymbol(candidate.ticker)).filter(Boolean));
    if (providerSymbols.size > 1) return makeResolution(cusip, "AMBIGUOUS", null, candidates, []);
  }

  const candidateEvidence: SecurityReferenceEvidence[] = reviewed.length === 0
    ? supportedCandidates.map((candidate, index) => ({
      source: `${candidate.provider}:${candidate.figi ?? candidate.compositeFigi ?? index}`,
      cusip,
      symbol: candidate.ticker,
      status: "exact",
      ambiguous: candidate.ambiguous,
    }))
    : [];
  // Importing Task #189 here ensures every trusted/effective resolution,
  // including local-vs-provider disagreements, uses one resolver.
  const task189 = resolveInstitutionalSecurity([...resolverEvidence, ...candidateEvidence]);
  const effectiveEvidence: SecurityReferenceEvidence[] = task189.evidence.map((item) => ({
    source: item.source,
    cusip: item.cusip ?? cusip,
    symbol: item.symbol,
    status: item.status === "reviewed" ? "reviewed" : "exact",
    ambiguous: item.ambiguous,
  }));
  switch (task189.outcome) {
    case "RESOLVED_TRUSTED":
      return makeResolution(cusip, "AUTHORITATIVELY_RESOLVABLE", task189.symbol, candidates, effectiveEvidence);
    case "CONFLICTING":
      return makeResolution(cusip, "CONFLICTING", null, candidates, effectiveEvidence);
    case "AMBIGUOUS":
      return makeResolution(cusip, "AMBIGUOUS", null, candidates, effectiveEvidence);
    default:
      return makeResolution(cusip, "NO_REFERENCE_AVAILABLE", null, candidates, effectiveEvidence);
  }
}

/**
 * 13F identity enrichment is limited to equity-like reported securities. The
 * check is intentionally explicit and conservative; it is not a name match.
 */
export function isSupported13fIdentityCandidate(candidate: SecurityReferenceCandidate): boolean {
  const classification = `${candidate.securityType ?? ""} ${candidate.securityType2 ?? ""} ${candidate.marketSector ?? ""}`
    .trim()
    .toUpperCase();
  if (!classification) return false;
  if (/\b(DEBT|BOND|NOTE|OPTION|FUTURE|FORWARD|WARRANT|RIGHTS?|PREFERRED|MONEY MARKET|MUTUAL FUND CASH|CURRENCY)\b/.test(classification)) {
    return false;
  }
  return /\b(COMMON STOCK|COMMON EQUITY|EQUITY|ETF|ETP|EXCHANGE TRADED FUND|FUND|REIT|REAL ESTATE INVESTMENT TRUST|ADR|ADS|DEPOSIT(?:ARY|ORY) RECEIPT|FOREIGN (?:SHARE|EQUITY|COMMON)|ORDINARY SHARE|SPECIAL COMMON)\b/.test(classification);
}

/** Provider outcomes are retained rather than hidden behind a guessed mapping. */
export function resolveProviderSecurityReference(
  cusip: string | null | undefined,
  providerOutcome: Exclude<SecurityReferenceOutcome, "AUTHORITATIVELY_RESOLVABLE" | "AMBIGUOUS" | "CONFLICTING" | "UNSUPPORTED" | "NO_REFERENCE_AVAILABLE">,
  candidates: readonly SecurityReferenceCandidate[] = [],
  extra: Pick<SecurityReferenceResolution, "errorCode" | "retryAfterMs"> = {},
): SecurityReferenceResolution {
  const normalized = normalizeCusip(cusip);
  return makeResolution(normalized, normalized ? providerOutcome : "UNSUPPORTED", null, candidates, [], extra);
}