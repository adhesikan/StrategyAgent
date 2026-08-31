#!/usr/bin/env tsx
/** Generic, read-only institutional coverage analyzer.  It never applies a plan. */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import { runCli } from "../server/cli-runtime";
import {
  applyInstitutionalCoveragePlan, assertReadOnlySql, buildActionableCoveragePlan, categoryCoverageMetrics, classifyCusipEvidence, countCanonicalStockEligibleInputs, coverageTotals, providerNormalizationAudit, rankCoverageRootCauses,
  securityTypeCoverageMetrics,
  type CoveragePlan,
} from "../server/services/institutional/institutional-coverage-analyzer";
import { classifyInstitutionalSecurityType } from "../server/services/institutional/security-type-eligibility";
import { createCoveragePostgresAdapter } from "../server/services/institutional/institutional-coverage-postgres-adapter";
import { canonicalSecurityTypeStateQuery, parseCanonicalStockEligibleIdentities, reconcileCanonicalStockEligibility } from "../server/services/institutional/canonical-security-state";
import { CANONICAL_EFFECTIVE_HOLDINGS_CTE } from "../server/services/institutional/institutional-effective-holdings";
import { buildInstitutionalAssetTypeCorrectionPlan } from "../server/services/institutional/security-reference-enrichment-planner";
import {
  applyInstitutionalSecurityTypeCorrections,
} from "../server/services/institutional/security-reference-correction";
import { recomputeAggregateForSymbol } from "../server/services/institutional/ingestion-service";
import { rebuildInstitutionalSignalForSymbol } from "../server/services/institutional/signal-engine";
import { runIntelligencePrecomputation } from "../server/services/intelligence-orchestrator";

function rowsOf(result: unknown): any[] { return (result as { rows?: any[] }).rows ?? (Array.isArray(result) ? result : []); }
const query = `
${CANONICAL_EFFECTIVE_HOLDINGS_CTE},
newest_canonical_quarter AS (SELECT MAX(period_of_report) period FROM canonical_filings),
eligible AS (
 SELECT h.*, h.canonical_period_of_report canonical_period
 FROM canonical_effective_holdings h
),
all_history AS (
 SELECT cusip,COUNT(*)::int holding_rows,COUNT(*) FILTER (WHERE reported_value IS NULL)::int null_value_rows,
    SUM(reported_value) FILTER (WHERE reported_value IS NOT NULL)::text reported_value_usd,
   MAX(canonical_period)::text latest_quarter,
   ARRAY_AGG(DISTINCT canonical_period::text ORDER BY canonical_period::text) periods,
   COUNT(*) FILTER (WHERE mapped_symbol IS NULL OR mapping_status NOT IN ('exact','reviewed'))::int stale_unmapped_holding_rows,
   SUM(reported_value) FILTER (WHERE (mapped_symbol IS NULL OR mapping_status NOT IN ('exact','reviewed')) AND reported_value IS NOT NULL)::text stale_unmapped_value_usd,
   COUNT(*) FILTER (WHERE mapped_symbol IS NOT NULL AND mapping_status IN ('exact','reviewed'))::int currently_materialized_holding_rows,
   SUM(reported_value) FILTER (WHERE mapped_symbol IS NOT NULL AND mapping_status IN ('exact','reviewed') AND reported_value IS NOT NULL)::text currently_materialized_value_usd,
   JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('source','holding','symbol',mapped_symbol,'status',mapping_status)) holding_evidence
 FROM eligible GROUP BY cusip
), latest_history AS (
 SELECT cusip,COUNT(*)::int latest_holding_rows,COUNT(*) FILTER (WHERE reported_value IS NULL)::int latest_null_value_rows,
    SUM(reported_value) FILTER (WHERE reported_value IS NOT NULL)::text latest_reported_value_usd
 FROM eligible WHERE canonical_period=(SELECT period FROM newest_canonical_quarter) GROUP BY cusip
), mapping_evidence AS (
 SELECT cusip,JSONB_AGG(JSONB_BUILD_OBJECT('source','institutional_mapping','symbol',mapped_symbol,'status',mapping_status)) mapping_evidence
 FROM institutional_security_mappings GROUP BY cusip
), master_evidence AS (
 SELECT cusip,MAX(asset_type) asset_type,
    BOOL_OR(review_status='reviewed' AND asset_type IS NOT NULL) asset_type_reviewed,
    MAX(mapping_method) mapping_method,
    JSONB_AGG(JSONB_BUILD_OBJECT('source','security_master','symbol',ticker,'status',review_status,'assetType',asset_type,'mappingMethod',mapping_method)) master_evidence
 FROM security_master GROUP BY cusip
 ), provider_evidence AS (
  SELECT cusip,JSONB_AGG(JSONB_BUILD_OBJECT(
    'provider',provider,'ticker',ticker,'figi',figi,'compositeFigi',composite_figi,
    'shareClassFigi',share_class_figi,'securityType',security_type,'securityType2',security_type2,
    'marketSector',market_sector,'securityDescription',name,'exchangeCode',exchange_code
  ) ORDER BY candidate_fingerprint) provider_candidates
  FROM institutional_security_candidate_observations
  WHERE is_current=TRUE GROUP BY cusip
 ) SELECT a.*,l.latest_holding_rows,l.latest_null_value_rows,l.latest_reported_value_usd,
   m.mapping_evidence,s.asset_type,s.master_evidence,s.asset_type_reviewed,s.mapping_method,p.provider_candidates
 FROM all_history a
 LEFT JOIN latest_history l USING(cusip)
 LEFT JOIN mapping_evidence m USING(cusip)
 LEFT JOIN master_evidence s USING(cusip)
  LEFT JOIN provider_evidence p USING(cusip)
 ORDER BY a.cusip`;

/** Kept separate so an empty eligible universe still reports the newest filing period. */
const newestQuarterDiagnosticsQuery = `
${CANONICAL_EFFECTIVE_HOLDINGS_CTE},
newest AS (SELECT MAX(period_of_report) period FROM canonical_filings),
eligible AS (
 SELECT h.id,h.reported_value,h.period_of_report FROM canonical_effective_holdings h
)
SELECT newest.period::text newest_canonical_filing_quarter,COUNT(eligible.id)::int eligible_rows_in_newest_quarter,
 COUNT(eligible.id) FILTER (WHERE eligible.reported_value IS NULL)::int null_value_rows_in_newest_quarter,
 (SELECT COUNT(*) FROM institutional_13f_filings)::int total_filings,
  (SELECT COUNT(*) FROM canonical_filings)::int effective_filings,
 (SELECT COUNT(DISTINCT filer_cik) FROM institutional_13f_filings)::int total_managers,
  (SELECT COUNT(DISTINCT filer_cik) FROM canonical_filings)::int effective_managers,
 (SELECT COUNT(DISTINCT period_of_report) FROM institutional_13f_filings)::int total_quarters,
  (SELECT COUNT(DISTINCT period_of_report) FROM canonical_filings)::int effective_quarters,
 (SELECT COUNT(*) FROM institutional_13f_holdings)::int total_holdings,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number)::int effective_holdings,
  (SELECT COUNT(DISTINCT issuer_name) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number)::int distinct_issuers,
  (SELECT COUNT(DISTINCT class_title) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number)::int distinct_classes,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE h.put_call IS NOT NULL)::int option_rows,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE LOWER(h.put_call)='put')::int put_rows,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE LOWER(h.put_call)='call')::int call_rows,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE h.shares_prn_type='PRN')::int prn_rows,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE h.reported_shares IS NULL)::int null_share_rows,
  (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE h.reported_shares <= 0)::int nonpositive_share_rows,
 (SELECT COUNT(*) FROM institutional_quarterly_aggregates)::int aggregate_rows,
 (SELECT COUNT(*) FROM institutional_symbol_signals)::int signal_rows,
 (SELECT COUNT(*) FROM sector_intelligence_snapshots)::int sector_snapshot_rows,
 (SELECT COUNT(*) FROM theme_intelligence_snapshots)::int theme_snapshot_rows
 FROM newest LEFT JOIN eligible ON eligible.period_of_report=newest.period
GROUP BY newest.period`;
const aggregateTargetsQuery = `SELECT symbol,period_of_report::text period FROM institutional_quarterly_aggregates ORDER BY symbol,period_of_report`;
const signalTargetsQuery = `SELECT DISTINCT symbol FROM institutional_symbol_signals ORDER BY symbol`;

type Executor = { execute(query: unknown): Promise<unknown> };
async function loadCoverage(executor: Executor) {
  const rows = {
    evidence: rowsOf(await executor.execute(sql.raw(query))),
    diagnostics: rowsOf(await executor.execute(sql.raw(newestQuarterDiagnosticsQuery)))[0] ?? {},
    aggregateTargets: rowsOf(await executor.execute(sql.raw(aggregateTargetsQuery))),
    signalTargets: rowsOf(await executor.execute(sql.raw(signalTargetsQuery))),
    canonicalState: rowsOf(await executor.execute(sql.raw(canonicalSecurityTypeStateQuery)))[0] ?? {},
  };
  const classifications = rows.evidence.map((r) => ({
    ...classifyCusipEvidence({
    cusip: String(r.cusip), holdingRows: Number(r.holding_rows), staleUnmappedHoldingRows: Number(r.stale_unmapped_holding_rows),
    staleUnmappedValueUsd: r.stale_unmapped_value_usd === null ? null : String(r.stale_unmapped_value_usd),
    currentlyMaterializedHoldingRows: Number(r.currently_materialized_holding_rows),
    currentlyMaterializedValueUsd: r.currently_materialized_value_usd === null ? null : String(r.currently_materialized_value_usd),
    reportedValueUsd: r.reported_value_usd === null ? null : String(r.reported_value_usd),
    nullValueRows: Number(r.null_value_rows ?? 0), latestQuarter: r.latest_quarter ? String(r.latest_quarter) : null,
    periods: Array.isArray(r.periods) ? r.periods.map(String) : [],
    holdingSymbols: (r.holding_evidence ?? []).map((item: any) => item.symbol).filter(Boolean),
    sourceEvidence: [...(r.mapping_evidence ?? []), ...(r.master_evidence ?? [])],
     providerCandidates: Array.isArray(r.provider_candidates) ? r.provider_candidates : [],
     persistedAssetType: r.asset_type === null || r.asset_type === undefined ? null : String(r.asset_type),
     assetTypeProvenance: r.mapping_method ? String(r.mapping_method) : null,
     assetTypeReviewed: r.asset_type_reviewed === true,
    }),
    canonicalSecurityType: classifyInstitutionalSecurityType({ assetType: r.asset_type }).canonicalType,
    securityTypePopulation: classifyInstitutionalSecurityType({ assetType: r.asset_type }).analyticsPopulation,
  }));
  const before = coverageTotals(classifications);
  const canonicalStockEligibleIdentities = parseCanonicalStockEligibleIdentities(
    rows.canonicalState.stock_eligible_identities,
  );
  const canonicalReconciliation = reconcileCanonicalStockEligibility(
    Number(rows.canonicalState.stock_eligible_cusips ?? 0),
    countCanonicalStockEligibleInputs(classifications),
  );
  if (!canonicalReconciliation.reconciled) {
    throw new Error(`CANONICAL_ELIGIBILITY_RECONCILIATION_FAILED:${JSON.stringify(canonicalReconciliation)}`);
  }
  const normalizationAudit = providerNormalizationAudit(
    classifications,
    new Set(rows.aggregateTargets.map(row => `${row.symbol}:${row.period}`)),
    new Set(rows.signalTargets.map(row => String(row.symbol))),
  );
  const correctionPlan = buildInstitutionalAssetTypeCorrectionPlan({
    population: classifications.map((row) => ({
      cusip: row.cusip,
      holdingRows: row.holdingRows,
      reportedValueUsd: row.reportedValueUsd === null ? null : String(row.reportedValueUsd),
      trustedSymbols: row.projectedSymbol ? [row.projectedSymbol] : [],
      currentAssetType: row.persistedAssetType ?? null,
    })),
    trustedState: classifications.map((row) => ({
      cusip: row.cusip,
      trusted: row.category === "TRUSTED",
      evidence: row.sourceEvidence,
      currentAssetType: row.persistedAssetType ?? null,
      assetTypeReviewed: row.assetTypeReviewed,
      candidateEvidence: row.providerCandidates ?? [],
    })),
  });
  const correctionBlockers = new Map(
    correctionPlan.blockerCusips.map((item) => [item.cusip, item.blocker]),
  );
  const correctedClassifications = classifications.map((row) => {
    const action = correctionPlan.actions.find((candidate) => candidate.cusip === row.cusip);
    const blocker = correctionBlockers.get(row.cusip) ??
      (action?.action === "TYPE_CORRECTION" ? "STALE_MACHINE_DERIVED_TYPE" :
        action?.action === "SYMBOL_CORRECTION" ? "CANONICAL_SYMBOL_REVIEW_REQUIRED" : undefined);
    return blocker ? { ...row, canonicalCorrectionBlocker: blocker } : row;
  });
  const remediationCanonicalIdentities = new Map(
    Array.from(canonicalStockEligibleIdentities)
      .filter(([cusip]) => !correctionBlockers.has(cusip)
        && !correctionPlan.actions.some((action) => action.cusip === cusip)),
  );
  const plan = buildActionableCoveragePlan({
    classifications: correctedClassifications, before,
    canonicalStockEligibleIdentities: remediationCanonicalIdentities,
    existingAggregateTargets: new Set(rows.aggregateTargets.map(row => `${row.symbol}:${row.period}`)),
    existingSignalSymbols: new Set(rows.signalTargets.map(row => String(row.symbol))),
    snapshotRowsByFamily: {
      sector_intelligence_snapshots: Number(rows.diagnostics.sector_snapshot_rows ?? 0),
      theme_intelligence_snapshots: Number(rows.diagnostics.theme_snapshot_rows ?? 0),
    },
  });
  return { rows, classifications: correctedClassifications, before, plan, canonicalReconciliation, normalizationAudit, correctionPlan };
}
export async function loadInstitutionalCoveragePlan(executor: Executor): Promise<CoveragePlan> {
  return (await loadCoverage(executor)).plan;
}
export async function loadInstitutionalAssetTypeCorrectionPlan(executor: Executor) {
  return (await loadCoverage(executor)).correctionPlan;
}
function priorCalendarQuarter(period: string, available: ReadonlySet<string>): string | null {
  const [year, month] = period.split("-").map(Number);
  const priorEnd = new Date(Date.UTC(year, month - 4, 0)).toISOString().slice(0, 10);
  return available.has(priorEnd) ? priorEnd : null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const applyCorrections = args.includes("--apply-corrections") || args.includes("--corrections") || args.includes("--correction-apply");
  const summaryOnly = args.includes("--summary-only");
  if (summaryOnly && apply) throw new Error("SUMMARY_ONLY_IS_READ_ONLY");
  const arg = (name: string) => args[args.indexOf(name) + 1];
  assertReadOnlySql(query);
  assertReadOnlySql(newestQuarterDiagnosticsQuery);
  assertReadOnlySql(aggregateTargetsQuery);
  assertReadOnlySql(signalTargetsQuery);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return loadCoverage(tx as unknown as Executor);
  });
    const { rows: data, classifications, before, plan, canonicalReconciliation, normalizationAudit, correctionPlan } = rows;
  const latestClassifications = data.evidence
    .filter((r) => Number(r.latest_holding_rows ?? 0) > 0)
     .map((r) => ({
       ...classifyCusipEvidence({
      cusip: String(r.cusip),
      holdingRows: Number(r.latest_holding_rows),
      staleUnmappedHoldingRows: Number(r.stale_unmapped_holding_rows),
      reportedValueUsd: r.latest_reported_value_usd === null ? null : String(r.latest_reported_value_usd),
      nullValueRows: Number(r.latest_null_value_rows ?? 0),
      latestQuarter: r.latest_quarter ? String(r.latest_quarter) : null,
       sourceEvidence: [...(r.holding_evidence ?? []), ...(r.mapping_evidence ?? []), ...(r.master_evidence ?? [])],
       }),
       canonicalSecurityType: classifyInstitutionalSecurityType({ assetType: r.asset_type }).canonicalType,
       securityTypePopulation: classifyInstitutionalSecurityType({ assetType: r.asset_type }).analyticsPopulation,
     }));
  const latestQuarter = coverageTotals(latestClassifications);
  if (applyCorrections) {
    if (!apply) throw new Error("CORRECTION_APPLY_REQUIRES_APPLY_FLAG");
    await applyInstitutionalSecurityTypeCorrections({
      database: {
        async identity() {
          const result = rowsOf(await db.execute(sql`SELECT current_database() AS database, current_schema() AS schema`))[0] ?? {};
          return { database: String(result.database ?? ""), schema: String(result.schema ?? "") };
        },
        async withAdvisoryLock<T>(_key: number, fn: () => Promise<T>) { return fn(); },
        async transaction<T>(fn: (tx: any) => Promise<T>) {
          return db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(774412005::bigint)`);
            return fn({
              async loadPlan() { return (await loadCoverage(tx as unknown as Executor)).correctionPlan; },
              async applyTypeCorrection(action: any) {
                await tx.execute(sql`
                  UPDATE security_master
                  SET asset_type = ${action.projectedAssetType},
                      last_verified = NOW(),
                      notes = ${`provider correction: ${action.providerEvidence.join("|")}`}
                  WHERE cusip = ${action.cusip}
                    AND asset_type = ${action.currentAssetType}
                    AND COALESCE(review_status, '') NOT IN ('reviewed', 'rejected')
                `);
              },
              async applySymbolCorrection(action: any) {
                await tx.execute(sql`
                  UPDATE security_master
                  SET ticker = ${action.projectedSymbol}, last_verified = NOW(),
                      notes = ${`provider symbol correction: ${action.providerEvidence.join("|")}`}
                  WHERE cusip = ${action.cusip}
                    AND ticker IS NOT DISTINCT FROM ${action.currentSymbol}
                    AND COALESCE(review_status, '') NOT IN ('reviewed', 'rejected')
                `);
                await tx.execute(sql`
                  UPDATE institutional_security_mappings
                  SET mapped_symbol = ${action.projectedSymbol}, last_verified_at = NOW(),
                      notes = ${`provider symbol correction: ${action.providerEvidence.join("|")}`}
                  WHERE cusip = ${action.cusip}
                    AND mapped_symbol IS NOT DISTINCT FROM ${action.currentSymbol}
                    AND COALESCE(mapping_status, '') NOT IN ('reviewed', 'rejected')
                `);
              },
            });
          });
        },
      },
      artifact: correctionPlan,
      confirmation: arg("--confirm"),
      environment: arg("--environment"),
      railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
      nodeEnvironment: process.env.NODE_ENV,
      correctionApplyEnabled: process.env.INSTITUTIONAL_SECURITY_TYPE_CORRECTION_APPLY_ENABLED,
      expectedDatabase: arg("--database-name"),
      expectedSchema: arg("--schema-name"),
      databaseUrl: process.env.DATABASE_URL,
      externalDatabaseUrl: process.env.EXTERNAL_DATABASE_URL,
      suppliedPlanHash: arg("--plan-hash"),
    });
    return;
  }
  if (apply) {
    if (correctionPlan.actions.length || correctionPlan.blockerCusips.length) {
      throw new Error("CANONICAL_SECURITY_STATE_CORRECTION_REQUIRED");
    }
    await applyInstitutionalCoveragePlan({
      database: createCoveragePostgresAdapter(db as any, loadInstitutionalCoveragePlan),
      artifact: plan, environment: arg("--environment"), confirmation: arg("--confirm"),
      expectedDatabase: arg("--database-name"), expectedSchema: arg("--schema-name"),
      suppliedPlanHash: arg("--plan-hash"),
      rebuilder: {
        async rebuildAggregates(targets) {
          const periods = new Set(targets.map(target => target.period));
          for (const target of targets) {
            await recomputeAggregateForSymbol(target.symbol, target.period, priorCalendarQuarter(target.period, periods));
          }
        },
        async rebuildSignals(targets) { for (const target of targets) await rebuildInstitutionalSignalForSymbol(target.symbol); },
        async refreshSnapshots(targets) { if (targets.length) await runIntelligencePrecomputation({ persist: true }); },
      },
    });
    return;
  }
  if (summaryOnly) {
    console.log(JSON.stringify({
      eligibleCusips: before.eligibleCusips,
      holdingRows: before.holdingRows,
      reportedValueUsd: before.reportedValueUsd,
      trustedCusips: before.reliablyMappedCusips,
      canonicalStockEligibleCusips: plan.stockEligibility.canonicalStockEligibleCusips,
      remediationStockEligibleCusips: plan.stockEligibility.remediationStockEligibleCusips,
      stockEligibilityReconciled: plan.stockEligibility.stockEligibilityReconciled,
      fundCusipsExcludedFromStockRemediation: plan.stockEligibility.fundCusipsExcludedFromStockRemediation,
      nonStockCusipsInStockRemediation: plan.stockEligibility.nonStockCusipsInStockRemediation,
      aggregateTargets: plan.downstream?.aggregates.expected ?? 0,
      signalTargets: plan.downstream?.signals.expected ?? 0,
      separateFundCusips: classifications.filter((row) => row.securityTypePopulation === "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS").length,
      canonicalCorrectionActions: correctionPlan.actions.length,
      canonicalBlockers: correctionPlan.blockers,
       holdingCountReconciled: plan.holdingCountReconciled ?? false,
       holdingCountMismatchCusips: plan.holdingCountMismatchCusips ?? [],
      remediationBlocked: plan.stockEligibility.remediationBlocked,
      planHash: plan.planHash,
    }));
    return;
  }
  const latestByCusip = Object.fromEntries(data.evidence.map(row => [String(row.cusip), Number(row.latest_holding_rows ?? 0)]));
  const categoryMetrics = categoryCoverageMetrics(classifications, latestByCusip);
  const securityTypeMetrics = securityTypeCoverageMetrics(
    classifications,
    new Set(data.aggregateTargets.map(row => `${row.symbol}:${row.period}`)),
    new Set(data.signalTargets.map(row => String(row.symbol))),
  );
  console.log(JSON.stringify({ funnel: data.diagnostics, allHistory: before, latestQuarter,
    canonicalReconciliation,
    trustedIdentityCoverage: {
      note: "Potential identity coverage; distinct from currently materialized holding coverage.",
      cusips: before.reliablyMappedCusips, knownValueUsd: before.reliablyMappedValueUsd,
    },
    materializedCoverage: { current: {
      cusips: before.currentlyFullyMaterializedCusips, cusipPercent: before.fullyMaterializedCusipPercent,
      rows: before.currentlyMaterializedHoldingRows, rowPercent: before.materializedRowPercent,
      knownValueUsd: before.currentlyMaterializedValueUsd, valuePercent: before.materializedKnownValuePercent,
    }, projected: {
      cusips: plan.projected.currentlyFullyMaterializedCusips, cusipPercent: plan.projected.fullyMaterializedCusipPercent,
      rows: plan.projected.currentlyMaterializedHoldingRows, rowPercent: plan.projected.materializedRowPercent,
      knownValueUsd: plan.projected.currentlyMaterializedValueUsd, valuePercent: plan.projected.materializedKnownValuePercent,
    }},
    latestCanonicalFilingQuarter: data.diagnostics.newest_canonical_filing_quarter ?? null,
    newestFilingQuarterEligibleRows: Number(data.diagnostics.eligible_rows_in_newest_quarter ?? 0),
    newestFilingQuarterNullValueRows: Number(data.diagnostics.null_value_rows_in_newest_quarter ?? 0),
    newestFilingQuarterHasNoEligibleRows: Number(data.diagnostics.eligible_rows_in_newest_quarter ?? 0) === 0,
    coverageFunnel: {
      allHistoryEligibleCusips: before.eligibleCusips,
      allHistoryEligibleHoldingRows: before.holdingRows,
      latestEligibleCusips: latestQuarter.eligibleCusips,
      latestEligibleHoldingRows: latestQuarter.holdingRows,
      latestTrustedCusips: latestQuarter.reliablyMappedCusips,
      latestNullValueCusips: latestQuarter.nullValueCusips,
    },
    categories: categoryMetrics, securityTypes: securityTypeMetrics,
    providerNormalization: normalizationAudit,
    assetTypeCorrectionPlan: {
      planHash: correctionPlan.planHash,
      actionCount: correctionPlan.actions.length,
      before: correctionPlan.before,
      projected: correctionPlan.projected,
       blockers: correctionPlan.blockers,
       blockerCusips: correctionPlan.blockerCusips,
       actions: correctionPlan.actions.map((action) => ({
         action: action.action,
        cusip: action.cusip,
         ...(action.action === "TYPE_CORRECTION" ? {
           currentAssetType: action.currentAssetType,
           projectedAssetType: action.projectedAssetType,
           symbol: action.symbol,
         } : {
           currentSymbol: action.currentSymbol,
           projectedSymbol: action.projectedSymbol,
         }),
        preservesTrustedIdentity: action.preservesTrustedIdentity,
      })),
    },
    rootCauseRanking: rankCoverageRootCauses(categoryMetrics),
    materialization: plan.affected, plan }, null, 2));
}
if (!process.env.VITEST && /analyze-institutional-coverage\.(ts|js)$/.test(process.argv[1] ?? "")) {
  void runCli(main, {
    label: "institutional-coverage",
    close: () => pool.end(),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}