#!/usr/bin/env tsx
/** Generic, read-only institutional coverage analyzer.  It never applies a plan. */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import { runCli } from "../server/cli-runtime";
import {
  applyInstitutionalCoveragePlan, assertReadOnlySql, buildActionableCoveragePlan, categoryCoverageMetrics, classifyCusipEvidence, countCanonicalStockEligibleInputs, coverageTotals, rankCoverageRootCauses,
  securityTypeCoverageMetrics,
  type CoveragePlan,
} from "../server/services/institutional/institutional-coverage-analyzer";
import { classifyInstitutionalSecurityType } from "../server/services/institutional/security-type-eligibility";
import { createCoveragePostgresAdapter } from "../server/services/institutional/institutional-coverage-postgres-adapter";
import { canonicalSecurityTypeStateQuery, reconcileCanonicalStockEligibility } from "../server/services/institutional/canonical-security-state";
import { recomputeAggregateForSymbol } from "../server/services/institutional/ingestion-service";
import { rebuildInstitutionalSignalForSymbol } from "../server/services/institutional/signal-engine";
import { runIntelligencePrecomputation } from "../server/services/intelligence-orchestrator";

function rowsOf(result: unknown): any[] { return (result as { rows?: any[] }).rows ?? (Array.isArray(result) ? result : []); }
const query = `
WITH ranked_filings AS (
 SELECT f.*, ROW_NUMBER() OVER (PARTITION BY filer_cik,period_of_report
   ORDER BY is_effective DESC, accepted_at DESC NULLS LAST, filing_date DESC, accession_number DESC) rn
 FROM institutional_13f_filings f
), canonical_filings AS (
 SELECT * FROM ranked_filings WHERE is_effective=TRUE AND rn=1
), newest_canonical_quarter AS (SELECT MAX(period_of_report) period FROM canonical_filings),
eligible AS (
 SELECT h.*,f.period_of_report canonical_period,f.accession_number canonical_accession
 FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number
 WHERE h.put_call IS NULL AND h.shares_prn_type IS DISTINCT FROM 'PRN' AND h.reported_shares > 0
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
   JSONB_AGG(JSONB_BUILD_OBJECT('source','security_master','symbol',ticker,'status',review_status,'assetType',asset_type)) master_evidence
 FROM security_master GROUP BY cusip
) SELECT a.*,l.latest_holding_rows,l.latest_null_value_rows,l.latest_reported_value_usd,m.mapping_evidence,s.asset_type,s.master_evidence
 FROM all_history a
 LEFT JOIN latest_history l USING(cusip)
 LEFT JOIN mapping_evidence m USING(cusip)
 LEFT JOIN master_evidence s USING(cusip)
 ORDER BY a.cusip`;

/** Kept separate so an empty eligible universe still reports the newest filing period. */
const newestQuarterDiagnosticsQuery = `
WITH ranked_filings AS (
 SELECT f.*, ROW_NUMBER() OVER (PARTITION BY filer_cik,period_of_report
   ORDER BY is_effective DESC, accepted_at DESC NULLS LAST, filing_date DESC, accession_number DESC) rn
 FROM institutional_13f_filings f
), canonical_filings AS (
 SELECT * FROM ranked_filings WHERE is_effective=TRUE AND rn=1
), newest AS (SELECT MAX(period_of_report) period FROM canonical_filings),
eligible AS (
 SELECT h.id,h.reported_value,f.period_of_report FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number
 WHERE h.put_call IS NULL AND h.shares_prn_type IS DISTINCT FROM 'PRN' AND h.reported_shares > 0
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
 (SELECT COUNT(DISTINCT cusip) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number)::int distinct_cusips,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE put_call IS NOT NULL)::int option_rows,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE LOWER(put_call)='put')::int put_rows,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE LOWER(put_call)='call')::int call_rows,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE shares_prn_type='PRN')::int prn_rows,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE reported_shares IS NULL)::int null_share_rows,
 (SELECT COUNT(*) FROM institutional_13f_holdings h JOIN canonical_filings f ON f.accession_number=h.accession_number WHERE reported_shares <= 0)::int nonpositive_share_rows,
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
    sourceEvidence: [...(r.holding_evidence ?? []), ...(r.mapping_evidence ?? []), ...(r.master_evidence ?? [])],
    }),
    canonicalSecurityType: classifyInstitutionalSecurityType({ assetType: r.asset_type }).canonicalType,
    securityTypePopulation: classifyInstitutionalSecurityType({ assetType: r.asset_type }).analyticsPopulation,
  }));
  const before = coverageTotals(classifications);
  const plan = buildActionableCoveragePlan({
    classifications, before,
    existingAggregateTargets: new Set(rows.aggregateTargets.map(row => `${row.symbol}:${row.period}`)),
    existingSignalSymbols: new Set(rows.signalTargets.map(row => String(row.symbol))),
    snapshotRowsByFamily: {
      sector_intelligence_snapshots: Number(rows.diagnostics.sector_snapshot_rows ?? 0),
      theme_intelligence_snapshots: Number(rows.diagnostics.theme_snapshot_rows ?? 0),
    },
  });
  const canonicalReconciliation = reconcileCanonicalStockEligibility(
    Number(rows.canonicalState.stock_eligible_cusips ?? 0),
    countCanonicalStockEligibleInputs(classifications),
  );
  if (!canonicalReconciliation.reconciled) {
    throw new Error(`CANONICAL_ELIGIBILITY_RECONCILIATION_FAILED:${JSON.stringify(canonicalReconciliation)}`);
  }
  return { rows, classifications, before, plan, canonicalReconciliation };
}
export async function loadInstitutionalCoveragePlan(executor: Executor): Promise<CoveragePlan> {
  return (await loadCoverage(executor)).plan;
}
function priorCalendarQuarter(period: string, available: ReadonlySet<string>): string | null {
  const [year, month] = period.split("-").map(Number);
  const priorEnd = new Date(Date.UTC(year, month - 4, 0)).toISOString().slice(0, 10);
  return available.has(priorEnd) ? priorEnd : null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  if (process.env.EXTERNAL_DATABASE_URL) throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  const args = process.argv.slice(2); const apply = args.includes("--apply");
  const arg = (name: string) => args[args.indexOf(name) + 1];
  assertReadOnlySql(query);
  assertReadOnlySql(newestQuarterDiagnosticsQuery);
  assertReadOnlySql(aggregateTargetsQuery);
  assertReadOnlySql(signalTargetsQuery);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return loadCoverage(tx as unknown as Executor);
  });
  const { rows: data, classifications, before, plan, canonicalReconciliation } = rows;
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
  if (apply) {
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
    categories: categoryMetrics, securityTypes: securityTypeMetrics, rootCauseRanking: rankCoverageRootCauses(categoryMetrics),
    materialization: plan.affected, plan }, null, 2));
}
if (!process.env.VITEST) {
  void runCli(main, {
    label: "institutional-coverage",
    close: () => pool.end(),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}