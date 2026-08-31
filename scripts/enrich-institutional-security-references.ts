#!/usr/bin/env tsx
/**
 * Population reference-enrichment operator. Default mode is read-only except
 * for OpenFIGI reads; it never prints credentials or provider response bodies.
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import { runCli } from "../server/cli-runtime";
import { OpenFigiClient } from "../server/services/institutional/openfigi-client";
import { DrizzleInstitutionalSecurityReferenceRepository, persistSecurityReferenceResolution } from "../server/services/institutional/security-reference-repository";
import {
  buildInstitutionalSecurityReferencePlan, referenceApplyGuard, referencePlanAggregateSummary, referencePlanChunkSummary,
  selectInstitutionalReferenceLookupCusips, type EligibleReferencePopulationRow, type InstitutionalSecurityReferencePlan,
  type PersistedReferenceLookupState, type TrustedReferenceState,
} from "../server/services/institutional/security-reference-enrichment-planner";
import { normalizeCusip, resolveReviewedSecurityReference, type SecurityReferenceCandidate, type SecurityReferenceResolution } from "../server/services/institutional/security-reference-enrichment";
import { classifyInstitutionalSecurityType } from "../server/services/institutional/security-type-eligibility";

export const populationQuery = `
WITH ranked AS (
 SELECT f.accession_number, ROW_NUMBER() OVER (PARTITION BY f.filer_cik,f.period_of_report
 ORDER BY f.is_effective DESC,f.accepted_at DESC NULLS LAST,f.filing_date DESC,f.accession_number DESC) rn
 FROM institutional_13f_filings f WHERE f.is_effective=TRUE
), eligible AS (
 SELECT h.cusip,h.reported_value FROM institutional_13f_holdings h JOIN ranked f
 ON f.accession_number=h.accession_number WHERE f.rn=1 AND h.put_call IS NULL
 AND COALESCE(UPPER(h.shares_prn_type),'SH') <> 'PRN' AND h.reported_shares>0
)
SELECT cusip,COUNT(*)::int holding_rows,SUM(reported_value) FILTER (WHERE reported_value IS NOT NULL)::text reported_value_usd
FROM eligible GROUP BY cusip ORDER BY cusip`;
export const evidenceQuery = `
SELECT x.cusip,COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('source',x.source,'cusip',x.cusip,'symbol',x.symbol,'status',x.status,'assetType',x.asset_type))
 FILTER (WHERE x.status IN ('reviewed','exact','unreviewed')), '[]'::jsonb) evidence,
 BOOL_OR(LOWER(COALESCE(x.status,'')) = 'rejected') blocked,
 MAX(x.asset_type) FILTER (WHERE x.source='security_master') current_asset_type,
 BOOL_OR(x.source='security_master' AND LOWER(COALESCE(x.status,''))='reviewed') asset_type_reviewed
FROM (
 SELECT cusip,'institutional_mapping' source,mapped_symbol symbol,mapping_status status,NULL::text asset_type FROM institutional_security_mappings
 UNION ALL SELECT cusip,'security_master',ticker,review_status,asset_type FROM security_master
) x GROUP BY x.cusip`;
export const lookupStateQuery = `
 SELECT s.cusip,s.provider_outcome,s.outcome,s.fingerprint,
  COUNT(c.id) FILTER (WHERE c.is_current=TRUE)::int current_candidate_count
 FROM institutional_security_lookup_states s
 LEFT JOIN institutional_security_candidate_observations c
  ON c.provider=s.provider AND c.cusip=s.cusip
 WHERE s.provider='openfigi'
 GROUP BY s.cusip,s.provider_outcome,s.outcome,s.fingerprint`;
export const candidateHistoryQuery = `
 SELECT cusip,COUNT(*)::int current_candidate_count
 FROM institutional_security_candidate_observations
 WHERE provider='openfigi' AND is_current=TRUE
 GROUP BY cusip`;
export const candidateEvidenceQuery = `
 SELECT cusip,figi,composite_figi,share_class_figi,ticker,name,exchange_code,
  market_sector,security_type,security_type2
 FROM institutional_security_candidate_observations
 WHERE provider='openfigi' AND is_current=TRUE
 ORDER BY cusip,candidate_fingerprint`;
function rowsOf(result: unknown): any[] { return (result as { rows?: any[] }).rows ?? (Array.isArray(result) ? result : []); }
export interface ReferenceEnrichmentArgs {
  apply: boolean;
  dryRun: boolean;
  /** Max provider CUSIP requests in this deterministic cursor chunk. */
  maxCusips?: number;
  /** Exclusive normalized CUSIP cursor for resumable read-only runs. */
  cursor?: string;
  planHash?: string;
  /** Re-query ambiguous/unsupported/no-reference outcomes intentionally. */
  refreshTerminal: boolean;
}
/** Strict and side-effect free so an operator cannot accidentally weaken guards. */
export function parseReferenceEnrichmentArgs(args: readonly string[]): ReferenceEnrichmentArgs {
  const parsed: ReferenceEnrichmentArgs = { apply: false, dryRun: false, refreshTerminal: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") { if (parsed.apply) throw new Error("ARGUMENT_REJECTED:DUPLICATE_APPLY"); parsed.apply = true; continue; }
    if (arg === "--dry-run") { if (parsed.dryRun) throw new Error("ARGUMENT_REJECTED:DUPLICATE_DRY_RUN"); parsed.dryRun = true; continue; }
    if (arg === "--refresh-terminal") {
      if (parsed.refreshTerminal) throw new Error("ARGUMENT_REJECTED:DUPLICATE_REFRESH_TERMINAL");
      parsed.refreshTerminal = true;
      continue;
    }
    if (arg === "--max-cusips" || arg === "--cursor" || arg === "--plan-hash") {
      const supplied = args[++index];
      if (!supplied || supplied.startsWith("--")) throw new Error(`ARGUMENT_REJECTED:MISSING_VALUE:${arg}`);
      if (arg === "--plan-hash") {
        if (parsed.planHash !== undefined) throw new Error("ARGUMENT_REJECTED:DUPLICATE_PLAN_HASH");
        parsed.planHash = supplied;
      } else if (arg === "--cursor") {
        if (parsed.cursor !== undefined) throw new Error("ARGUMENT_REJECTED:DUPLICATE_CURSOR");
        const cursor = normalizeCusip(supplied);
        if (!cursor) throw new Error("ARGUMENT_REJECTED:INVALID_CUSIP_CURSOR");
        parsed.cursor = cursor;
      } else {
        if (parsed.maxCusips !== undefined || !/^(0|[1-9]\d*)$/.test(supplied)) {
          throw new Error("ARGUMENT_REJECTED:INVALID_MAX_CUSIPS");
        }
        const max = Number(supplied);
        if (!Number.isSafeInteger(max) || max < 0 || max > 10_000) throw new Error("ARGUMENT_REJECTED:INVALID_MAX_CUSIPS");
        parsed.maxCusips = max;
      }
      continue;
    }
    throw new Error(`ARGUMENT_REJECTED:UNKNOWN_FLAG:${arg}`);
  }
  if (parsed.apply && parsed.dryRun) throw new Error("ARGUMENT_REJECTED:APPLY_AND_DRY_RUN");
  if (parsed.apply && parsed.cursor) throw new Error("ARGUMENT_REJECTED:APPLY_CURSOR_UNSUPPORTED");
  if (parsed.apply && (parsed.maxCusips === undefined || parsed.maxCusips < 1)) throw new Error("ARGUMENT_REJECTED:APPLY_MAX_CUSIPS_REQUIRED");
  return parsed;
}
export interface SafeOpenFigiRuntimeMetadata {
  authMode: "KEYED" | "UNAUTHENTICATED"; batchSize: number; concurrency: number;
  requestLimit: number; windowMs: number; minimumIntervalMs: number;
}
export interface LoadedReferencePlan { plan: InstitutionalSecurityReferencePlan; runtime: SafeOpenFigiRuntimeMetadata; }
async function loadPlan(maxCusips: number, cursor?: string, refreshTerminal = false): Promise<LoadedReferencePlan> {
  const [populationRows, evidenceRows, lookupRows, candidateRows, candidateEvidenceRows] = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return Promise.all([
      tx.execute(sql.raw(populationQuery)),
      tx.execute(sql.raw(evidenceQuery)),
      tx.execute(sql.raw(lookupStateQuery)),
      tx.execute(sql.raw(candidateHistoryQuery)),
      tx.execute(sql.raw(candidateEvidenceQuery)),
    ]);
  });
  const evidenceByCusip = new Map<string, {
    evidence: any[];
    blocked: boolean;
    currentAssetType: string | null;
    assetTypeReviewed: boolean;
  }>();
  for (const row of rowsOf(evidenceRows)) {
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    const cusip = normalizeCusip(String(row.cusip));
    if (cusip) evidenceByCusip.set(cusip, {
      evidence,
      blocked: row.blocked === true,
      currentAssetType: row.current_asset_type == null ? null : String(row.current_asset_type),
      assetTypeReviewed: row.asset_type_reviewed === true,
    });
  }
  const lookupByCusip = new Map<string, PersistedReferenceLookupState>();
  for (const row of rowsOf(lookupRows)) {
    const cusip = normalizeCusip(String(row.cusip));
    if (cusip) lookupByCusip.set(cusip, {
      providerOutcome: row.provider_outcome == null ? null : String(row.provider_outcome),
      outcome: row.outcome == null ? null : String(row.outcome),
      fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
      currentCandidateCount: Number(row.current_candidate_count ?? 0),
    });
  }
  const candidateHistoryCusips = new Set<string>();
  for (const row of rowsOf(candidateRows)) {
    const cusip = normalizeCusip(String(row.cusip));
    if (cusip && Number(row.current_candidate_count ?? 0) > 0) candidateHistoryCusips.add(cusip);
  }
  const candidatesByCusip = new Map<string, SecurityReferenceCandidate[]>();
  for (const row of rowsOf(candidateEvidenceRows)) {
    const cusip = normalizeCusip(String(row.cusip));
    if (!cusip) continue;
    const candidate: SecurityReferenceCandidate = {
      provider: "openfigi",
      figi: row.figi == null ? null : String(row.figi),
      compositeFigi: row.composite_figi == null ? null : String(row.composite_figi),
      shareClassFigi: row.share_class_figi == null ? null : String(row.share_class_figi),
      ticker: row.ticker == null ? null : String(row.ticker),
      name: row.name == null ? null : String(row.name),
      exchangeCode: row.exchange_code == null ? null : String(row.exchange_code),
      marketSector: row.market_sector == null ? null : String(row.market_sector),
      securityType: row.security_type == null ? null : String(row.security_type),
      securityType2: row.security_type2 == null ? null : String(row.security_type2),
    };
    candidatesByCusip.set(cusip, [...(candidatesByCusip.get(cusip) ?? []), candidate]);
  }
  const population: EligibleReferencePopulationRow[] = rowsOf(populationRows).map(row => {
    const cusip = String(row.cusip);
    const evidenceState = evidenceByCusip.get(normalizeCusip(cusip) ?? cusip);
    return {
      cusip,
      holdingRows: Number(row.holding_rows),
      reportedValueUsd: row.reported_value_usd == null ? null : String(row.reported_value_usd),
      trustedSymbols: (evidenceState?.evidence ?? [])
        .filter((item) => ["reviewed", "exact"].includes(String(item.status).toLowerCase()))
        .map((item) => String(item.symbol ?? "")),
      currentAssetType: evidenceState?.currentAssetType ?? null,
    };
  });
  const trustedState: TrustedReferenceState[] = [...new Set([
    ...evidenceByCusip.keys(), ...lookupByCusip.keys(), ...candidateHistoryCusips,
  ])].map(cusip => {
    const evidenceState = evidenceByCusip.get(cusip);
    const evidence = evidenceState?.evidence ?? [];
    // Task #189 precedence is applied before current coverage is counted.
    return { cusip, evidence, blocked: evidenceState?.blocked === true,
      lookupState: lookupByCusip.get(cusip),
      candidateHistoryPresent: candidateHistoryCusips.has(cusip),
      candidateEvidence: candidatesByCusip.get(cusip) ?? [],
      currentAssetType: evidenceState?.currentAssetType ?? null,
      assetTypeReviewed: evidenceState?.assetTypeReviewed === true,
      trusted: resolveReviewedSecurityReference(cusip, evidence).outcome === "AUTHORITATIVELY_RESOLVABLE" };
  });
  // Population coverage is complete, but network work is bounded before the
  // client is called. Trusted and rejected CUSIPs are never requested.
  const plannedLookupCusips = selectInstitutionalReferenceLookupCusips({
    population, trustedState, maxCusips, cursor, refreshTerminal,
    includeAssetTypeBackfill: true,
  });
  const client = new OpenFigiClient();
  const stateByCusip = new Map(trustedState.map((state) => [state.cusip, state]));
  const providerLookupCusips = plannedLookupCusips.filter((cusip) => {
    const state = stateByCusip.get(cusip);
    if (!state?.trusted || !state.candidateEvidence?.length) return true;
    const symbols = new Set(state.evidence.map((item) => String(item.symbol ?? "").trim().toUpperCase()).filter(Boolean));
    const types = Array.from(new Set(state.candidateEvidence
      .filter((candidate) => symbols.has(String(candidate.ticker ?? "").trim().toUpperCase()))
      .map((candidate) => classifyInstitutionalSecurityType(candidate))
      .filter((classification) => classification.analyticsPopulation !== "INSUFFICIENT_SECURITY_TYPE_EVIDENCE")
      .map((classification) => classification.canonicalType)));
    return types.length !== 1;
  });
  const providerResolutions = await client.resolveCusips(providerLookupCusips);
  return { plan: buildInstitutionalSecurityReferencePlan({
    population, trustedState, providerResolutions, plannedLookupCusips, maxCusips, cursor, refreshTerminal,
    includeAssetTypeBackfill: true,
  }),
    runtime: client.executionProfile };
}
export async function executeReferenceEnrichment(input: {
  args: ReferenceEnrichmentArgs;
  loadPlan: (maxCusips: number, cursor?: string, refreshTerminal?: boolean) => Promise<LoadedReferencePlan>;
  persistResolution?: (resolution: SecurityReferenceResolution) => Promise<{ promoted: boolean }>;
  applyEnabled?: string; nodeEnv?: string; railwayEnvironment?: string;
  error?: (value: string) => void;
}) {
  const { args } = input;
  if (args.apply && args.cursor) throw new Error("ARGUMENT_REJECTED:APPLY_CURSOR_UNSUPPORTED");
  const loaded = await input.loadPlan(args.maxCusips ?? 100, args.cursor, args.refreshTerminal);
  const plan = loaded.plan;
  const issues = referenceApplyGuard({ apply: args.apply, suppliedPlanHash: args.planHash, planHash: plan.planHash, maxCusips: args.maxCusips,
    applyEnabled: input.applyEnabled, nodeEnv: input.nodeEnv, railwayEnvironment: input.railwayEnvironment });
  if (issues.length) throw new Error(`REFERENCE_ENRICHMENT_APPLY_REJECTED:${issues.join(",")}`);
  const summary = { ...referencePlanAggregateSummary(plan), runtime: loaded.runtime, chunk: referencePlanChunkSummary(plan) };
  if (!args.apply) return summary;
  const fresh = await input.loadPlan(args.maxCusips!, undefined, args.refreshTerminal);
  if (fresh.plan.planHash !== plan.planHash || args.planHash !== fresh.plan.planHash) {
    throw new Error("REFERENCE_ENRICHMENT_APPLY_REJECTED:FRESH_PLAN_HASH_REQUIRED");
  }
  if (!input.persistResolution) throw new Error("REFERENCE_ENRICHMENT_APPLY_REJECTED:PERSISTENCE_REQUIRED");
  let completed = 0; let promoted = 0; let unresolved = 0;
  try {
    for (const action of fresh.plan.actions) {
      const persisted = await input.persistResolution(action.resolution);
      if (action.promotable && !persisted.promoted) throw new Error("REFERENCE_ENRICHMENT_APPLY_REJECTED:PROMOTABLE_ACTION_DRIFT");
      if (persisted.promoted) promoted++; else unresolved++;
      completed++;
    }
  } catch (error) {
    input.error?.(JSON.stringify({ error: "REFERENCE_ENRICHMENT_PARTIAL_FAILURE", completed, planned: fresh.plan.actions.length }));
    throw error;
  }
  return { ...referencePlanAggregateSummary(fresh.plan), runtime: fresh.runtime,
    applied: { completed, planned: fresh.plan.actions.length, promoted, unresolved } };
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  const args = parseReferenceEnrichmentArgs(process.argv.slice(2));
  const store = args.apply ? new DrizzleInstitutionalSecurityReferenceRepository() : undefined;
  const result = await executeReferenceEnrichment({
    args, loadPlan, persistResolution: resolution => persistSecurityReferenceResolution(store!, resolution),
    applyEnabled: process.env.INSTITUTIONAL_SECURITY_REFERENCE_APPLY_ENABLED,
    nodeEnv: process.env.NODE_ENV, railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
    error: message => console.error(message),
  });
  console.log(JSON.stringify(result));
}
if (!process.env.VITEST) {
  void runCli(main, {
    label: "reference-enrichment",
    close: () => pool.end(),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}