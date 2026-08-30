#!/usr/bin/env tsx
/**
 * Population reference-enrichment operator. Default mode is read-only except
 * for OpenFIGI reads; it never prints credentials or provider response bodies.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { OpenFigiClient } from "../server/services/institutional/openfigi-client";
import { DrizzleInstitutionalSecurityReferenceRepository, persistSecurityReferenceResolution } from "../server/services/institutional/security-reference-repository";
import {
  buildInstitutionalSecurityReferencePlan, referenceApplyGuard, referencePlanAggregateSummary,
  selectInstitutionalReferenceLookupCusips, type EligibleReferencePopulationRow, type TrustedReferenceState,
} from "../server/services/institutional/security-reference-enrichment-planner";
import { resolveReviewedSecurityReference } from "../server/services/institutional/security-reference-enrichment";

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
SELECT x.cusip,COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('source',x.source,'cusip',x.cusip,'symbol',x.symbol,'status',x.status))
 FILTER (WHERE x.status IN ('reviewed','exact','unreviewed')), '[]'::jsonb) evidence,
 BOOL_OR(LOWER(COALESCE(x.status,'')) = 'rejected') blocked
FROM (
 SELECT cusip,'institutional_mapping' source,mapped_symbol symbol,mapping_status status FROM institutional_security_mappings
 UNION ALL SELECT cusip,'security_master',ticker,review_status FROM security_master
) x GROUP BY x.cusip`;
function rowsOf(result: unknown): any[] { return (result as { rows?: any[] }).rows ?? (Array.isArray(result) ? result : []); }
export interface ReferenceEnrichmentArgs { apply: boolean; dryRun: boolean; maxCusips?: number; planHash?: string; }
/** Strict and side-effect free so an operator cannot accidentally weaken guards. */
export function parseReferenceEnrichmentArgs(args: readonly string[]): ReferenceEnrichmentArgs {
  const parsed: ReferenceEnrichmentArgs = { apply: false, dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") { if (parsed.apply) throw new Error("ARGUMENT_REJECTED:DUPLICATE_APPLY"); parsed.apply = true; continue; }
    if (arg === "--dry-run") { if (parsed.dryRun) throw new Error("ARGUMENT_REJECTED:DUPLICATE_DRY_RUN"); parsed.dryRun = true; continue; }
    if (arg === "--max-cusips" || arg === "--plan-hash") {
      const supplied = args[++index];
      if (!supplied || supplied.startsWith("--")) throw new Error(`ARGUMENT_REJECTED:MISSING_VALUE:${arg}`);
      if (arg === "--plan-hash") parsed.planHash = supplied;
      else {
        const max = Number(supplied);
        if (!Number.isSafeInteger(max) || max < 0 || max > 10_000) throw new Error("ARGUMENT_REJECTED:INVALID_MAX_CUSIPS");
        parsed.maxCusips = max;
      }
      continue;
    }
    throw new Error(`ARGUMENT_REJECTED:UNKNOWN_FLAG:${arg}`);
  }
  if (parsed.apply && parsed.dryRun) throw new Error("ARGUMENT_REJECTED:APPLY_AND_DRY_RUN");
  if (parsed.apply && (parsed.maxCusips === undefined || parsed.maxCusips < 1)) throw new Error("ARGUMENT_REJECTED:APPLY_MAX_CUSIPS_REQUIRED");
  return parsed;
}
async function loadPlan(maxCusips: number) {
  const [populationRows, stateRows] = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return Promise.all([tx.execute(sql.raw(populationQuery)), tx.execute(sql.raw(evidenceQuery))]);
  });
  const population: EligibleReferencePopulationRow[] = rowsOf(populationRows).map(row => ({
    cusip: String(row.cusip), holdingRows: Number(row.holding_rows), reportedValueUsd: row.reported_value_usd == null ? null : String(row.reported_value_usd),
  }));
  const trustedState: TrustedReferenceState[] = rowsOf(stateRows).map(row => {
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    // Task #189 precedence is applied before current coverage is counted.
    return { cusip: String(row.cusip), evidence, blocked: row.blocked === true,
      trusted: resolveReviewedSecurityReference(String(row.cusip), evidence).outcome === "AUTHORITATIVELY_RESOLVABLE" };
  });
  // Population coverage is complete, but network work is bounded before the
  // client is called. Trusted and rejected CUSIPs are never requested.
  const plannedLookupCusips = selectInstitutionalReferenceLookupCusips({ population, trustedState, maxCusips });
  const providerResolutions = await new OpenFigiClient().resolveCusips(plannedLookupCusips);
  return buildInstitutionalSecurityReferencePlan({ population, trustedState, providerResolutions, plannedLookupCusips, maxCusips });
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  const args = parseReferenceEnrichmentArgs(process.argv.slice(2));
  const { apply, maxCusips: max } = args;
  // Dry runs get a conservative bounded action artifact while still assessing
  // the full eligible population.
  const plan = await loadPlan(max ?? 100);
  const issues = referenceApplyGuard({
    apply, suppliedPlanHash: args.planHash, planHash: plan.planHash, maxCusips: max,
    applyEnabled: process.env.INSTITUTIONAL_SECURITY_REFERENCE_APPLY_ENABLED,
    nodeEnv: process.env.NODE_ENV, railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
  });
  if (issues.length) throw new Error(`REFERENCE_ENRICHMENT_APPLY_REJECTED:${issues.join(",")}`);
  if (!apply) { console.log(JSON.stringify(referencePlanAggregateSummary(plan))); return; }
  // A second full read/re-resolution makes the hash check fresh at the write
  // boundary. Only its exact, already bounded hashed actions are persisted.
  const fresh = await loadPlan(max!);
  if (fresh.planHash !== plan.planHash || args.planHash !== fresh.planHash) {
    throw new Error("REFERENCE_ENRICHMENT_APPLY_REJECTED:FRESH_PLAN_HASH_REQUIRED");
  }
  const store = new DrizzleInstitutionalSecurityReferenceRepository();
  let completed = 0; let promoted = 0; let unresolved = 0;
  try {
    for (const action of fresh.actions) {
      const persisted = await persistSecurityReferenceResolution(store, action.resolution);
      if (action.promotable && !persisted.promoted) throw new Error("REFERENCE_ENRICHMENT_APPLY_REJECTED:PROMOTABLE_ACTION_DRIFT");
      if (persisted.promoted) promoted++; else unresolved++;
      completed++;
    }
  } catch (error) {
    // Do not disclose response/provider contents. Upserts make reruns safe.
    console.error(JSON.stringify({ error: "REFERENCE_ENRICHMENT_PARTIAL_FAILURE", completed, planned: fresh.actions.length }));
    throw error;
  }
  console.log(JSON.stringify({ ...referencePlanAggregateSummary(fresh), applied: { completed, planned: fresh.actions.length, promoted, unresolved } }));
}
if (!process.env.VITEST) main().catch(error => { console.error(`[reference-enrichment] ERROR: ${String(error.message ?? error).slice(0, 200)}`); process.exit(1); });