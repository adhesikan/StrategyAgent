import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { institutional13fFilings, institutional13fHoldings, institutionalSecurityCandidateObservations, institutionalSecurityLookupStates, institutionalSecurityMappings, securityMaster } from "@shared/schema";
import { resolveInstitutionalSecurity } from "./security-resolver";
import { assessCanonicalPrimarySymbol, isSupported13fIdentityCandidate, normalizeCusip, normalizeReferenceSymbol, type SecurityReferenceCandidate, type SecurityReferenceResolution } from "./security-reference-enrichment";
import { classifyInstitutionalSecurityType, type CanonicalInstitutionalSecurityType } from "./security-type-eligibility";

export type LocalSecurityEvidence = {
  source: string;
  symbol: string | null;
  status: string;
  cusip: string;
  figi: string | null;
  assetType?: string | null;
};
export interface InstitutionalSecurityReferenceStore {
  loadEligibleCusips(periodsOfReport?: readonly string[], options?: { systematic?: boolean }): Promise<string[]>;
  getTrustedLocalEvidence(cusip: string): Promise<LocalSecurityEvidence[]>;
  saveLookup(input: { resolution: SecurityReferenceResolution; provider: string; effectiveOutcome: string; effectiveSymbol: string | null }, observedAt: Date): Promise<void>;
  saveCandidates(cusip: string, provider: string, candidates: readonly SecurityReferenceCandidate[], observedAt: Date): Promise<void>;
  markMissingCandidatesNonCurrent(cusip: string, provider: string, fingerprints: readonly string[]): Promise<void>;
  promoteExact(input: { cusip: string; ticker: string; figi: string | null; name: string | null; exchange: string | null; assetType: string | null; provenance: string }): Promise<void>;
  populateAssetType?(input: { cusip: string; assetType: CanonicalInstitutionalSecurityType; provenance: string }): Promise<void>;
  correctAssetType?(input: { cusip: string; currentAssetType: string; assetType: CanonicalInstitutionalSecurityType; provenance: string }): Promise<void>;
  correctCanonicalSymbol?(input: { cusip: string; currentSymbol: string | null; symbol: string; provenance: string }): Promise<void>;
}
const safeCode = (code: string | undefined) => code?.replace(/[^A-Z0-9_:-]/gi, "").slice(0, 64) || null;
export function candidateFingerprint(c: SecurityReferenceCandidate): string {
  const v = [c.provider, c.figi, c.compositeFigi, c.shareClassFigi, normalizeReferenceSymbol(c.ticker), c.name, c.exchangeCode, c.marketSector, c.securityType, c.securityType2].map(x => x?.trim().toUpperCase() ?? "").join("\u001f");
  let h = 0x811c9dc5; for (const x of v) { h ^= x.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return `src-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
export function assetTypeForOpenFigiCandidate(c: SecurityReferenceCandidate): string {
  return classifyInstitutionalSecurityType(c).canonicalType;
}
function assetTypeEvidenceForSymbol(
  candidates: readonly SecurityReferenceCandidate[],
  symbol: string,
): { assetType: CanonicalInstitutionalSecurityType; evidence: string[] } | null {
  const matching = candidates.filter((candidate) =>
    normalizeReferenceSymbol(candidate.ticker) === symbol,
  );
  const classified = matching.map((candidate) => ({
    classification: classifyInstitutionalSecurityType(candidate),
    candidate,
  })).filter(({ classification }) =>
    classification.analyticsPopulation !== "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
  );
  const types = Array.from(new Set(classified.map(({ classification }) => classification.canonicalType)));
  if (types.length !== 1) return null;
  return {
    assetType: types[0],
    evidence: Array.from(new Set(classified.flatMap(({ classification }) => classification.evidence))).sort(),
  };
}
function assetTypeProvenance(
  provider: string,
  assetType: CanonicalInstitutionalSecurityType,
  evidence: readonly string[],
): string {
  return `${provider}_asset_type:${assetType};evidence:${[...evidence].sort().join("|") || "provider_classification"}`;
}
const providerOf = (r: SecurityReferenceResolution) => r.candidates[0]?.provider?.trim().toLowerCase() || "openfigi";
const providerEvidence = (r: SecurityReferenceResolution) => r.candidates
  .filter(c => isSupported13fIdentityCandidate(c) && assessCanonicalPrimarySymbol(c).symbol)
  .map(c => ({ source: `openfigi:${candidateFingerprint(c)}`, symbol: assessCanonicalPrimarySymbol(c).symbol, status: "exact", cusip: r.cusip, figi: c.figi }));
const canRetire = (r: SecurityReferenceResolution) => r.outcome === "AUTHORITATIVELY_RESOLVABLE" || r.outcome === "NO_REFERENCE_AVAILABLE" || r.outcome === "AMBIGUOUS" || (r.outcome === "UNSUPPORTED" && r.candidates.length > 0);

export async function persistSecurityReferenceResolution(store: InstitutionalSecurityReferenceStore, input: SecurityReferenceResolution, observedAt = new Date()): Promise<{ cusip: string | null; outcome: string; symbol: string | null; promoted: boolean }> {
  const cusip = normalizeCusip(input.cusip);
  if (!cusip) return { cusip: null, outcome: "UNSUPPORTED", symbol: null, promoted: false };
  const provider = providerOf(input);
  const resolution = { ...input, cusip, candidates: input.candidates.map(c => ({ ...c, provider: c.provider || provider })) };
  const local = await store.getTrustedLocalEvidence(cusip);
  // A rejection is an owner-controlled identity decision. Do not retain any
  // provider-derived state or candidate history for it.
  if (local.some(e => e.status === "rejected")) return { cusip, outcome: "UNSUPPORTED", symbol: null, promoted: false };
  const reviewed = local.filter(e => e.status === "reviewed");
  // Task #189 is the only authority which resolves the selected evidence tier.
  const trusted = resolveInstitutionalSecurity(reviewed.length ? reviewed : [...local.filter(e => e.status === "exact"), ...providerEvidence(resolution)]);
  const hasLocalExact = local.some(e => e.status === "exact");
  const effectiveOutcome = reviewed.length && trusted.outcome === "RESOLVED_TRUSTED" ? "AUTHORITATIVELY_RESOLVABLE"
    : trusted.outcome === "CONFLICTING" && hasLocalExact ? "CONFLICTING" : resolution.outcome;
  const effectiveSymbol = effectiveOutcome === "AUTHORITATIVELY_RESOLVABLE" && trusted.outcome === "RESOLVED_TRUSTED" ? trusted.symbol : null;
  await store.saveLookup({ resolution, provider, effectiveOutcome, effectiveSymbol }, observedAt);
  await store.saveCandidates(cusip, provider, resolution.candidates, observedAt);
  if (canRetire(resolution)) await store.markMissingCandidatesNonCurrent(cusip, provider, resolution.candidates.map(candidateFingerprint));
  if (effectiveOutcome !== "AUTHORITATIVELY_RESOLVABLE" || trusted.outcome !== "RESOLVED_TRUSTED" || !trusted.symbol) return { cusip, outcome: effectiveOutcome, symbol: null, promoted: false };
  const assetTypeEvidence = assetTypeEvidenceForSymbol(resolution.candidates, trusted.symbol);
  if (assetTypeEvidence && store.populateAssetType) {
    await store.populateAssetType({
      cusip,
      assetType: assetTypeEvidence.assetType,
      provenance: assetTypeProvenance(provider, assetTypeEvidence.assetType, assetTypeEvidence.evidence),
    });
  }
  if (reviewed.length) return { cusip, outcome: effectiveOutcome, symbol: trusted.symbol, promoted: !!assetTypeEvidence };
   const matches = resolution.candidates.filter(c =>
     isSupported13fIdentityCandidate(c)
     && assessCanonicalPrimarySymbol(c).symbol === trusted.symbol,
   );
  if (!matches.length) return { cusip, outcome: "INSUFFICIENT_EVIDENCE", symbol: null, promoted: false };
  const candidate = [...matches].sort((a, b) => {
    const richness = (c: SecurityReferenceCandidate) => Number(!!c.figi) + Number(!!c.compositeFigi) + Number(!!c.shareClassFigi);
    return richness(b) - richness(a) || candidateFingerprint(a).localeCompare(candidateFingerprint(b));
  })[0];
  const assetType = assetTypeEvidence?.assetType ?? null;
  await store.promoteExact({
    cusip,
    ticker: trusted.symbol,
    figi: candidate.figi?.trim().toUpperCase() ?? null,
    name: candidate.name?.trim() ?? null,
    exchange: candidate.exchangeCode?.trim().toUpperCase() ?? null,
    assetType,
    provenance: assetTypeEvidence
      ? assetTypeProvenance(provider, assetTypeEvidence.assetType, assetTypeEvidence.evidence)
      : "openfigi_exact;asset_type:insufficient_evidence",
  });
  return { cusip, outcome: effectiveOutcome, symbol: trusted.symbol, promoted: true };
}

export interface SecurityReferenceProvider { resolveCusips(cusips: readonly string[]): Promise<SecurityReferenceResolution[]>; }
export async function orchestrateSecurityReferenceLookups(store: InstitutionalSecurityReferenceStore, provider: SecurityReferenceProvider, cusips?: readonly string[], maxCusips = 100) {
  const source = cusips ?? await store.loadEligibleCusips();
  const ids = Array.from(new Set(source.map(normalizeCusip).filter((x): x is string => !!x))).slice(0, Math.max(0, maxCusips));
  const received = await provider.resolveCusips(ids); const results = [];
  for (let i = 0; i < ids.length; i++) results.push(await persistSecurityReferenceResolution(store, received[i] ?? { cusip: ids[i], outcome: "PARTIAL_RESPONSE", symbol: null, candidates: [], evidence: [], fingerprint: "missing-provider-result", errorCode: "MISSING_PROVIDER_RESULT" }));
  return { requested: ids.length, processed: results.length, promoted: results.filter(x => x.promoted).length, results };
}

export class DrizzleInstitutionalSecurityReferenceRepository implements InstitutionalSecurityReferenceStore {
  async loadEligibleCusips(periodsOfReport?: readonly string[], options: { systematic?: boolean } = {}): Promise<string[]> {
    // Mapping state, not lookup state, is authoritative: retry lookup/promote
    // failures but never waste provider capacity on trusted local mappings.
    const rows = await db.selectDistinct({ cusip: institutional13fHoldings.cusip }).from(institutional13fHoldings).innerJoin(institutional13fFilings, eq(institutional13fHoldings.accessionNumber, institutional13fFilings.accessionNumber)).leftJoin(institutionalSecurityMappings, eq(institutionalSecurityMappings.cusip, institutional13fHoldings.cusip)).leftJoin(securityMaster, eq(securityMaster.cusip, institutional13fHoldings.cusip)).where(and(
      eq(institutional13fFilings.isEffective, true),
      sql`${institutional13fHoldings.putCall} IS NULL`,
      sql`COALESCE(UPPER(${institutional13fHoldings.sharesPrnType}), 'SH') <> 'PRN'`,
      sql`${institutional13fHoldings.reportedShares} > 0`,
      periodsOfReport?.length ? inArray(institutional13fHoldings.periodOfReport, [...periodsOfReport]) : undefined,
      // Normal identity enrichment excludes trusted mappings. The second
      // branch is the deliberate Task #197 exception for a missing/stale
      // canonical type; it never selects a reviewed non-null type.
      sql`(
        (
          (${securityMaster.reviewStatus} IS NULL OR ${securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected'))
          AND (${institutionalSecurityMappings.mappingStatus} IS NULL OR ${institutionalSecurityMappings.mappingStatus} <> 'rejected')
          AND (${options.systematic ? sql`TRUE` : sql`${institutionalSecurityMappings.mappingStatus} IS NULL OR ${institutionalSecurityMappings.mappingStatus} NOT IN ('exact', 'reviewed')`})
        )
        OR
        (
          (${institutionalSecurityMappings.mappingStatus} IN ('exact', 'reviewed') OR ${securityMaster.reviewStatus} = 'reviewed')
          AND (
            ${securityMaster.assetType} IS NULL
            OR (${securityMaster.assetType} IN ('insufficient_evidence', 'ambiguous')
              AND ${securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected'))
          )
        )
      )`,
    ));
    return rows.map(r => normalizeCusip(r.cusip)).filter((x): x is string => !!x);
  }
  async getTrustedLocalEvidence(cusip: string): Promise<LocalSecurityEvidence[]> {
    const masters = await db.select({ symbol: securityMaster.ticker, status: securityMaster.reviewStatus, figi: securityMaster.figi, assetType: securityMaster.assetType }).from(securityMaster).where(eq(securityMaster.cusip, cusip)).limit(1);
    const mappings = await db.select({ symbol: institutionalSecurityMappings.mappedSymbol, status: institutionalSecurityMappings.mappingStatus, figi: institutionalSecurityMappings.figi }).from(institutionalSecurityMappings).where(eq(institutionalSecurityMappings.cusip, cusip)).limit(1);
    return [...masters.map(x => ({ ...x, source: "security_master", cusip })), ...mappings.map(x => ({ ...x, source: "institutional_security_mappings", cusip }))];
  }
  async saveLookup(input: { resolution: SecurityReferenceResolution; provider: string; effectiveOutcome: string; effectiveSymbol: string | null }, at: Date) { const r = input.resolution; const retryAfterAt = r.retryAfterMs == null ? null : new Date(at.getTime() + r.retryAfterMs); await db.insert(institutionalSecurityLookupStates).values({ provider: input.provider, cusip: r.cusip!, providerOutcome: r.outcome, outcome: input.effectiveOutcome, resolvedSymbol: input.effectiveSymbol, candidateCount: r.candidates.length, fingerprint: r.fingerprint, errorCode: safeCode(r.errorCode), retryAfterAt, lastObservedAt: at, provenance: "openfigi" }).onConflictDoUpdate({ target: [institutionalSecurityLookupStates.provider, institutionalSecurityLookupStates.cusip], set: { providerOutcome: r.outcome, outcome: input.effectiveOutcome, resolvedSymbol: input.effectiveSymbol, candidateCount: r.candidates.length, fingerprint: r.fingerprint, errorCode: safeCode(r.errorCode), retryAfterAt, lastObservedAt: at, provenance: "openfigi" } }); }
  async saveCandidates(cusip: string, provider: string, cs: readonly SecurityReferenceCandidate[], at: Date) { for (const c of cs) await db.insert(institutionalSecurityCandidateObservations).values({ provider, cusip, figi: c.figi ?? null, compositeFigi: c.compositeFigi ?? null, shareClassFigi: c.shareClassFigi ?? null, ticker: normalizeReferenceSymbol(c.ticker), name: c.name ?? null, exchangeCode: c.exchangeCode ?? null, marketSector: c.marketSector ?? null, securityType: c.securityType ?? null, securityType2: c.securityType2 ?? null, supported: isSupported13fIdentityCandidate(c), candidateFingerprint: candidateFingerprint(c), lastObservedAt: at, isCurrent: true }).onConflictDoUpdate({ target: [institutionalSecurityCandidateObservations.provider, institutionalSecurityCandidateObservations.cusip, institutionalSecurityCandidateObservations.candidateFingerprint], set: { lastObservedAt: at, isCurrent: true } }); }
  async markMissingCandidatesNonCurrent(cusip: string, provider: string, fps: readonly string[]) { const where = [eq(institutionalSecurityCandidateObservations.cusip, cusip), eq(institutionalSecurityCandidateObservations.provider, provider), eq(institutionalSecurityCandidateObservations.isCurrent, true)]; if (fps.length) where.push(notInArray(institutionalSecurityCandidateObservations.candidateFingerprint, [...fps])); await db.update(institutionalSecurityCandidateObservations).set({ isCurrent: false }).where(and(...where)); }
  async promoteExact(i: { cusip: string; ticker: string; figi: string | null; name: string | null; exchange: string | null; assetType: string | null; provenance: string }) {
    await db.transaction(async tx => {
      const sm = await tx.select({ status: securityMaster.reviewStatus }).from(securityMaster).where(eq(securityMaster.cusip, i.cusip)).limit(1);
       if (!sm[0]) await tx.insert(securityMaster).values({ cusip: i.cusip, ticker: i.ticker, figi: i.figi, issuerName: i.name, exchange: i.exchange, assetType: i.assetType, confidence: 95, mappingMethod: "cusip_exact", reviewStatus: "probable", notes: i.provenance });
       else if (sm[0].status !== "reviewed" && sm[0].status !== "rejected") await tx.update(securityMaster).set({ ticker: i.ticker, figi: i.figi, issuerName: i.name, exchange: i.exchange, ...(i.assetType === null ? {} : { assetType: i.assetType }), confidence: 95, mappingMethod: "cusip_exact", reviewStatus: "probable", lastVerified: new Date(), notes: i.provenance }).where(and(eq(securityMaster.cusip, i.cusip), sql`${securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected')`));
      const map = await tx.select({ status: institutionalSecurityMappings.mappingStatus }).from(institutionalSecurityMappings).where(eq(institutionalSecurityMappings.cusip, i.cusip)).limit(1);
      if (!map[0]) await tx.insert(institutionalSecurityMappings).values({ cusip: i.cusip, figi: i.figi, mappedSymbol: i.ticker, mappingStatus: "exact", mappingMethod: "cusip_exact", notes: i.provenance });
      else if (map[0].status !== "reviewed" && map[0].status !== "rejected") await tx.update(institutionalSecurityMappings).set({ figi: i.figi, mappedSymbol: i.ticker, mappingStatus: "exact", mappingMethod: "cusip_exact", lastVerifiedAt: new Date(), notes: i.provenance }).where(and(eq(institutionalSecurityMappings.cusip, i.cusip), sql`${institutionalSecurityMappings.mappingStatus} NOT IN ('reviewed', 'rejected')`));
    });
  }
  async populateAssetType(i: { cusip: string; assetType: CanonicalInstitutionalSecurityType; provenance: string }) {
    await db.transaction(async (tx) => {
      const existing = await tx.select({
        reviewStatus: securityMaster.reviewStatus,
        assetType: securityMaster.assetType,
      }).from(securityMaster).where(eq(securityMaster.cusip, i.cusip)).limit(1);
      const current = existing[0];
      if (current) {
        if (
          current.assetType !== null &&
          current.assetType !== "insufficient_evidence" &&
          current.assetType !== "ambiguous"
        ) return;
        if (
          current.reviewStatus === "reviewed" &&
          current.assetType !== null
        ) return;
        if (current.reviewStatus === "rejected") return;
        await tx.update(securityMaster)
          .set({ assetType: i.assetType, notes: i.provenance, lastVerified: new Date() })
          .where(and(
            eq(securityMaster.cusip, i.cusip),
            sql`${securityMaster.assetType} IS NULL OR (
              ${securityMaster.assetType} IN ('insufficient_evidence', 'ambiguous')
              AND ${securityMaster.reviewStatus} <> 'reviewed'
            )`,
          ));
        return;
      }
      const mapping = await tx.select({
        mappedSymbol: institutionalSecurityMappings.mappedSymbol,
        figi: institutionalSecurityMappings.figi,
        mappingStatus: institutionalSecurityMappings.mappingStatus,
      }).from(institutionalSecurityMappings)
        .where(eq(institutionalSecurityMappings.cusip, i.cusip))
        .limit(1);
      const trustedMapping = mapping[0];
      if (!trustedMapping || !["exact", "reviewed"].includes(trustedMapping.mappingStatus)) return;
      await tx.insert(securityMaster).values({
        cusip: i.cusip,
        ticker: trustedMapping.mappedSymbol,
        figi: trustedMapping.figi,
        assetType: i.assetType,
        confidence: trustedMapping.mappingStatus === "reviewed" ? 100 : 95,
        mappingMethod: "cusip_exact",
        reviewStatus: trustedMapping.mappingStatus === "reviewed" ? "reviewed" : "probable",
        notes: i.provenance,
      });
    });
  }
  async correctAssetType(i: { cusip: string; currentAssetType: string; assetType: CanonicalInstitutionalSecurityType; provenance: string }) {
    await db.update(securityMaster).set({
      assetType: i.assetType,
      notes: i.provenance,
      lastVerified: new Date(),
    }).where(and(
      eq(securityMaster.cusip, i.cusip),
      eq(securityMaster.assetType, i.currentAssetType),
      sql`${securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected')`,
    ));
  }
  async correctCanonicalSymbol(i: { cusip: string; currentSymbol: string | null; symbol: string; provenance: string }) {
    await db.transaction(async (tx) => {
      await tx.update(securityMaster).set({
        ticker: i.symbol,
        notes: i.provenance,
        lastVerified: new Date(),
      }).where(and(
        eq(securityMaster.cusip, i.cusip),
        sql`${securityMaster.ticker} IS NOT DISTINCT FROM ${i.currentSymbol}`,
        sql`${securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected')`,
      ));
      await tx.update(institutionalSecurityMappings).set({
        mappedSymbol: i.symbol,
        notes: i.provenance,
        lastVerifiedAt: new Date(),
      }).where(and(
        eq(institutionalSecurityMappings.cusip, i.cusip),
        sql`${institutionalSecurityMappings.mappedSymbol} IS NOT DISTINCT FROM ${i.currentSymbol}`,
        sql`${institutionalSecurityMappings.mappingStatus} NOT IN ('reviewed', 'rejected')`,
      ));
    });
  }
}