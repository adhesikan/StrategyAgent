/**
 * PostgreSQL adapter for reusable stock-level institutional analytics.
 *
 * Only persisted effective filings are eligible. The adapter selects one
 * authoritative accession per manager/quarter and loads symbol candidates
 * through the conservative security-enrichment boundary. It performs no SEC
 * or network I/O.
 */

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  institutional13fFilings,
  institutional13fHoldings,
  institutionalSecurityMappings,
  institutionalQuarterlyAggregates,
  securityMaster,
  type InstitutionalQuarterlyAggregate,
} from "@shared/schema";
import { parseQuarterIdentifier } from "../quarter-utils";
import { getEnrichedInstitutionalHoldings } from "./security-enrichment-repository";
import { createInstitutionalQuarter } from "./types";
import { resolveInstitutionalSecurity } from "../security-resolver";
import { isEligibleForStockInstitutionalAnalytics } from "../security-type-eligibility";
import {
  filterByCohortManagerIds,
  getActiveManagerIdsForCohort,
} from "../manager-cohort-service";
import type {
  CanonicalInstitutionalQuarterAggregate,
  EffectiveFundFiling,
  StockInstitutionalAnalyticsSource,
  StockInstitutionalRepository,
  StockInstitutionalRepositoryQuery,
} from "./repository";
import type {
  EnrichedInstitutionalHolding,
  EnrichedInstitutionalHoldingsQuery,
  FundPortfolioXRayQuarterSelector,
} from "./types";

export interface EffectiveStockFilingCandidate extends EffectiveFundFiling {
  isEffective: boolean;
}

export interface EffectiveStockFilingSelection {
  currentQuarter: NonNullable<ReturnType<typeof createInstitutionalQuarter>>;
  previousQuarter: NonNullable<ReturnType<typeof createInstitutionalQuarter>> | null;
  currentFilings: EffectiveFundFiling[];
  previousFilings: EffectiveFundFiling[];
  comparableManagerIds: string[];
}

function dateText(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function previousQuarterPeriod(periodOfReport: string): string | null {
  const current = parseQuarterIdentifier(periodOfReport);
  if (current?.kind !== "quarter") return null;
  const year = current.quarter === 1 ? current.year - 1 : current.year;
  const quarter = current.quarter === 1 ? 4 : current.quarter - 1;
  return parseQuarterIdentifier(`${year}-Q${quarter}`)?.periodEndDate ?? null;
}

function normalizeCoverageStatus(
  value: string,
): CanonicalInstitutionalQuarterAggregate["coverageStatus"] {
  return value === "complete" || value === "partial"
    ? value
    : "insufficient";
}

function toCanonicalAggregate(
  current: InstitutionalQuarterlyAggregate,
  previous: InstitutionalQuarterlyAggregate | null,
): CanonicalInstitutionalQuarterAggregate | null {
  const quarter = createInstitutionalQuarter(dateText(current.periodOfReport));
  const previousQuarter = current.prevPeriodOfReport
    ? createInstitutionalQuarter(dateText(current.prevPeriodOfReport))
    : null;
  if (!quarter) return null;
  return {
    quarter,
    previousQuarter,
    previousReportingManagerCount: previous?.reportingManagerCount ?? null,
    reportingManagerCount: current.reportingManagerCount,
    aggregateReportedShares: current.aggregateReportedShares,
    aggregateReportedValue: current.aggregateReportedValue,
    previousQuarterShares: current.previousQuarterShares,
    previousQuarterValue: current.previousQuarterValue,
    reportedSharesChange: current.reportedSharesChange,
    reportedSharesChangePercent: current.reportedSharesChangePercent,
    newPositionCount: current.newPositionCount,
    increasedPositionCount: current.increasedPositionCount,
    reducedPositionCount: current.reducedPositionCount,
    exitedPositionCount: current.exitedPositionCount,
    unchangedCount: current.unchangedCount,
    eligibleHoldingCount: current.eligibleHoldingCount,
    excludedHoldingCount: current.excludedHoldingCount,
    coverageStatus: normalizeCoverageStatus(current.coverageStatus),
  };
}

type EnrichedHoldingsPageLoader = (
  query: EnrichedInstitutionalHoldingsQuery,
) => Promise<EnrichedInstitutionalHolding[]>;

/**
 * Load a symbol candidate set to exhaustion using a deterministic repository
 * order. No safety cap is allowed to silently change analytics totals.
 */
export async function loadAllStockInstitutionalHoldings(
  accessionNumbers: string[],
  symbol?: string,
  loadPage: EnrichedHoldingsPageLoader = getEnrichedInstitutionalHoldings,
  pageSize = 5_000,
  candidateCusips?: string[],
): Promise<EnrichedInstitutionalHolding[]> {
  if (accessionNumbers.length === 0) return [];
  const holdings: EnrichedInstitutionalHolding[] = [];
  let offset = 0;
  while (true) {
    const page = await loadPage({
      accessionNumbers,
      ...(candidateCusips && candidateCusips.length > 0
        ? { cusips: candidateCusips }
        : { symbol }),
      limit: pageSize,
      offset,
    });
    holdings.push(...page);
    if (page.length < pageSize) {
      return holdings.filter((holding) =>
        isEligibleForStockInstitutionalAnalytics({
          assetType: holding.metadata?.assetType,
        }),
      );
    }
    offset += page.length;
  }
}

interface StockCandidateIdentity {
  candidateCusips: string[];
  hasReliableSecurityIdentity: boolean;
  hasDisqualifyingCandidateEvidence: boolean;
  hasTargetSpecificCandidateEvidence: boolean;
}

export async function loadStockCandidateIdentity(
  accessionNumbers: string[],
  symbol: string,
): Promise<StockCandidateIdentity> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const canonicalRows = await db
    .select({
      cusip: securityMaster.cusip,
      reviewStatus: securityMaster.reviewStatus,
      assetType: securityMaster.assetType,
    })
    .from(securityMaster)
    .where(sql`UPPER(${securityMaster.ticker}) = ${normalizedSymbol}`);
  const evidenceRows = accessionNumbers.length === 0 ? [] : await db
    .select({
      cusip: institutional13fHoldings.cusip,
      masterTicker: securityMaster.ticker,
      masterReviewStatus: securityMaster.reviewStatus,
      masterAssetType: securityMaster.assetType,
      mappingSymbol: institutionalSecurityMappings.mappedSymbol,
      mappingStatus: institutionalSecurityMappings.mappingStatus,
      holdingMappedSymbol: institutional13fHoldings.mappedSymbol,
      holdingMappingStatus: institutional13fHoldings.mappingStatus,
    })
    .from(institutional13fHoldings)
    .leftJoin(
      securityMaster,
      eq(securityMaster.cusip, institutional13fHoldings.cusip),
    )
    .leftJoin(
      institutionalSecurityMappings,
      eq(
        institutionalSecurityMappings.cusip,
        institutional13fHoldings.cusip,
      ),
    )
    .where(
      and(
        inArray(institutional13fHoldings.accessionNumber, accessionNumbers),
        or(
          sql`UPPER(${securityMaster.ticker}) = ${normalizedSymbol}`,
          sql`UPPER(${institutionalSecurityMappings.mappedSymbol}) = ${normalizedSymbol}`,
          sql`UPPER(${institutional13fHoldings.mappedSymbol}) = ${normalizedSymbol}`,
        ),
      ),
    );
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
      isEligibleForStockInstitutionalAnalytics({
        assetType: row.masterAssetType,
      }),
  );
  const trustedCanonicalForTarget = canonicalRows.some((canonical) => {
    if (canonical.reviewStatus !== "reviewed") return false;
    if (
      !isEligibleForStockInstitutionalAnalytics({
        assetType: canonical.assetType,
      })
    ) {
      return false;
    }
    const sameCusipEvidence = evidenceRows.filter(
      (row) => row.cusip === canonical.cusip,
    );
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
    return resolution.outcome === "RESOLVED_TRUSTED" &&
      matchesTarget(resolution.symbol);
  });
  const hasDisqualifyingCandidateEvidence = resolvedRows.some(
    ({ row, resolution }) =>
      !isEligibleForStockInstitutionalAnalytics({
        assetType: row.masterAssetType,
      }) ||
      resolution.outcome === "CONFLICTING" ||
      resolution.outcome === "AMBIGUOUS" ||
      (resolution.outcome === "RESOLVED_TRUSTED" &&
        !matchesTarget(resolution.symbol)),
  );
  return {
    candidateCusips: Array.from(
    new Set(
       [
          ...canonicalRows,
          // Candidate CUSIPs are diagnostic evidence, not trusted identity.
          // Keep target-specific filing rows visible so unresolved/conflicting
          // populations can be reported instead of disappearing as zero.
          ...evidenceRows,
       ]
        .map((row) => row.cusip)
        .filter((cusip): cusip is string => Boolean(cusip)),
    ),
    ).sort(),
    hasReliableSecurityIdentity:
      trustedForTarget.length > 0 || trustedCanonicalForTarget,
    hasDisqualifyingCandidateEvidence,
    hasTargetSpecificCandidateEvidence:
      canonicalRows.length > 0 || evidenceRows.length > 0,
  };
}

export async function loadStockCandidateCusips(
  accessionNumbers: string[],
  symbol: string,
): Promise<string[]> {
  return (await loadStockCandidateIdentity(accessionNumbers, symbol))
    .candidateCusips;
}

/**
 * Select one effective accession for each manager in the current period and
 * the adjacent prior calendar quarter. A prior filing is returned only for a
 * manager that also has a current-period filing.
 */
export function selectEffectiveStockFilings(
  rows: EffectiveStockFilingCandidate[],
  quarter: FundPortfolioXRayQuarterSelector,
): EffectiveStockFilingSelection | null {
  const effective = rows
    .filter((row) => row.isEffective)
    .slice()
    .sort((a, b) => {
      const period = b.periodOfReport.localeCompare(a.periodOfReport);
      if (period !== 0) return period;
      const manager = a.managerId.localeCompare(b.managerId);
      if (manager !== 0) return manager;
      const filing = b.filingDate.localeCompare(a.filingDate);
      if (filing !== 0) return filing;
      return b.accessionNumber.localeCompare(a.accessionNumber);
    });

  const unique: EffectiveFundFiling[] = [];
  const seen = new Set<string>();
  for (const filing of effective) {
    const key = `${filing.managerId}:${filing.periodOfReport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(filing);
  }

  const requestedPeriod =
    typeof quarter === "object"
      ? quarter.periodEndDate
      : parseQuarterIdentifier(quarter)?.periodEndDate ?? null;
  const selectedPeriod =
    requestedPeriod ??
    unique.map((filing) => filing.periodOfReport).sort().reverse()[0] ??
    null;
  if (!selectedPeriod) return null;
  const currentQuarter = createInstitutionalQuarter(selectedPeriod);
  if (!currentQuarter) return null;
  const currentFilings = unique.filter(
    (filing) => filing.periodOfReport === selectedPeriod,
  );
  if (currentFilings.length === 0) return null;

  const previousPeriod = previousQuarterPeriod(selectedPeriod);
  const currentManagerIds = new Set(
    currentFilings.map((filing) => filing.managerId),
  );
  const previousFilings = previousPeriod
    ? unique.filter(
        (filing) =>
          filing.periodOfReport === previousPeriod &&
          currentManagerIds.has(filing.managerId),
      )
    : [];
  const comparableManagerIds = previousFilings.map(
    (filing) => filing.managerId,
  );

  return {
    currentQuarter,
    previousQuarter:
      previousPeriod && previousFilings.length > 0
        ? createInstitutionalQuarter(previousPeriod)
        : null,
    currentFilings,
    previousFilings,
    comparableManagerIds,
  };
}

/**
 * Canonical summaries and reconstructed holder details must describe the same
 * period. A lagging aggregate therefore pins detail selection to its resolved
 * quarter instead of allowing "latest" to advance to a newer filing.
 */
export function selectAlignedStockFilings(
  rows: EffectiveStockFilingCandidate[],
  requestedQuarter: FundPortfolioXRayQuarterSelector,
  canonicalAggregate: CanonicalInstitutionalQuarterAggregate | null,
): EffectiveStockFilingSelection | null {
  return selectEffectiveStockFilings(
    rows,
    canonicalAggregate?.quarter ?? requestedQuarter,
  );
}

/**
 * Full reported filing value is the denominator for every stock position
 * type. In particular, a PUT/CALL numerator must not be divided by the
 * manager's options-only value, and common equity must not omit options/PRN.
 */
export async function loadManagerPortfolioValues(
  filings: EffectiveFundFiling[],
): Promise<Record<string, number | null>> {
  if (filings.length === 0) return {};
  const accessionNumbers = filings.map((filing) => filing.accessionNumber);
  const rows = await db
    .select({
      accessionNumber: institutional13fHoldings.accessionNumber,
      reportedValue: sql<number | null>`
        CASE
          WHEN BOOL_OR(${institutional13fHoldings.reportedValue} IS NULL)
            THEN NULL
          ELSE SUM(${institutional13fHoldings.reportedValue})
        END
      `,
    })
    .from(institutional13fHoldings)
    .where(
      inArray(institutional13fHoldings.accessionNumber, accessionNumbers),
    )
    .groupBy(institutional13fHoldings.accessionNumber);
  const managerByAccession = new Map(
    filings.map((filing) => [filing.accessionNumber, filing.managerId]),
  );
  const result: Record<string, number | null> = {};
  for (const row of rows) {
    const managerId = managerByAccession.get(row.accessionNumber);
    if (managerId) result[managerId] = row.reportedValue;
  }
  return result;
}

export const stockInstitutionalRepository: StockInstitutionalRepository = {
  async getStockInstitutionalSource(
    query: StockInstitutionalRepositoryQuery,
  ): Promise<StockInstitutionalAnalyticsSource | null> {
    let selectedPeriod: string | null;
    if (typeof query.quarter === "object") {
      selectedPeriod = query.quarter.periodEndDate;
    } else {
      const parsedQuarter = parseQuarterIdentifier(query.quarter);
      if (!parsedQuarter) return null;
      selectedPeriod =
        parsedQuarter.kind === "quarter"
          ? parsedQuarter.periodEndDate
          : null;
    }
    const canonicalMode =
      (query.options.positionType ?? "COMMON_EQUITY") === "COMMON_EQUITY" &&
      query.options.cohort === undefined;
    let canonicalAggregate: CanonicalInstitutionalQuarterAggregate | null = null;
    if (canonicalMode) {
      const canonicalRows = await db
        .select()
        .from(institutionalQuarterlyAggregates)
        .where(
          selectedPeriod
            ? and(
                eq(institutionalQuarterlyAggregates.symbol, query.symbol),
                eq(institutionalQuarterlyAggregates.periodOfReport, selectedPeriod),
              )
            : eq(institutionalQuarterlyAggregates.symbol, query.symbol),
        )
        .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
        .limit(1);
      const currentAggregate = canonicalRows[0];
      if (currentAggregate) {
        selectedPeriod = dateText(currentAggregate.periodOfReport);
        const canonicalPreviousPeriod = currentAggregate.prevPeriodOfReport
          ? dateText(currentAggregate.prevPeriodOfReport)
          : null;
        const previousRows = canonicalPreviousPeriod
          ? await db
              .select()
              .from(institutionalQuarterlyAggregates)
              .where(
                and(
                  eq(institutionalQuarterlyAggregates.symbol, query.symbol),
                  eq(
                    institutionalQuarterlyAggregates.periodOfReport,
                    canonicalPreviousPeriod,
                  ),
                ),
              )
              .limit(1)
          : [];
        canonicalAggregate = toCanonicalAggregate(
          currentAggregate,
          previousRows[0] ?? null,
        );
        if (!canonicalAggregate) return null;
      }
    }
    if (!canonicalAggregate && selectedPeriod === null) {
      const latestRows = await db
        .select({ periodOfReport: institutional13fFilings.periodOfReport })
        .from(institutional13fFilings)
        .where(eq(institutional13fFilings.isEffective, true))
        .orderBy(desc(institutional13fFilings.periodOfReport))
        .limit(1);
      selectedPeriod = latestRows[0]
        ? dateText(latestRows[0].periodOfReport)
        : null;
    }
    if (!selectedPeriod) return null;
    const previousPeriod =
      canonicalAggregate?.previousQuarter?.periodEndDate ??
      previousQuarterPeriod(selectedPeriod);
    const periods = previousPeriod
      ? [selectedPeriod, previousPeriod]
      : [selectedPeriod];
    const filingRows = await db
      .select({
        accessionNumber: institutional13fFilings.accessionNumber,
        managerId: institutional13fFilings.filerCik,
        managerName: institutional13fFilings.filerName,
        periodOfReport: institutional13fFilings.periodOfReport,
        filingDate: institutional13fFilings.filingDate,
        isEffective: institutional13fFilings.isEffective,
      })
      .from(institutional13fFilings)
      .where(
        and(
          eq(institutional13fFilings.isEffective, true),
          inArray(institutional13fFilings.periodOfReport, periods),
        ),
      )
      .orderBy(
        desc(institutional13fFilings.periodOfReport),
        desc(institutional13fFilings.filingDate),
        desc(institutional13fFilings.accessionNumber),
      );

    const cohortManagerIds = await getActiveManagerIdsForCohort(
      query.options.cohort,
    );
    const eligibleFilingRows = filterByCohortManagerIds(
      filingRows.map((row) => ({
        ...row,
        periodOfReport: dateText(row.periodOfReport),
        filingDate: dateText(row.filingDate),
      })),
      cohortManagerIds,
    );
    const selected = selectAlignedStockFilings(
      eligibleFilingRows,
      query.quarter,
      canonicalAggregate,
    );
    if (!selected) {
      // A persisted aggregate is only a cache. Without an aligned effective
      // filing population there is no evidence set to revalidate, so fail
      // closed rather than exposing cached numeric totals.
      return null;
    }

    const currentAccessions = selected.currentFilings.map(
      (filing) => filing.accessionNumber,
    );
    const previousAccessions = selected.previousFilings.map(
      (filing) => filing.accessionNumber,
    );
    const candidateIdentity = await loadStockCandidateIdentity(
      [...currentAccessions, ...previousAccessions],
      query.symbol,
    );
    // Persisted canonical aggregates are a cache, not identity evidence. Never
    // expose one unless the underlying requested-symbol holdings still resolve
    // through the shared deterministic boundary.
    if (
      !candidateIdentity.hasReliableSecurityIdentity ||
      candidateIdentity.hasDisqualifyingCandidateEvidence
    ) {
      canonicalAggregate = null;
    }
    const candidateCusips = candidateIdentity.candidateCusips;
    const [currentHoldings, previousHoldings, managerPortfolioValues] =
      await Promise.all([
        loadAllStockInstitutionalHoldings(
          currentAccessions,
          query.symbol,
          getEnrichedInstitutionalHoldings,
          5_000,
          candidateCusips,
        ),
        previousAccessions.length > 0
          ? loadAllStockInstitutionalHoldings(
              previousAccessions,
              query.symbol,
              getEnrichedInstitutionalHoldings,
              5_000,
              candidateCusips,
            )
          : Promise.resolve([]),
        loadManagerPortfolioValues(selected.currentFilings),
      ]);

    return {
      symbol: query.symbol,
      candidateCusips,
      hasReliableSecurityIdentity:
        candidateIdentity.hasReliableSecurityIdentity,
      hasTargetSpecificCandidateEvidence:
        candidateIdentity.hasTargetSpecificCandidateEvidence,
      quarter: canonicalAggregate?.quarter ?? selected.currentQuarter,
      previousQuarter:
        canonicalAggregate?.previousQuarter ?? selected.previousQuarter,
      dataAsOf:
        canonicalAggregate?.quarter.periodEndDate ??
        selected.currentQuarter.periodEndDate,
      currentHoldings,
      previousHoldings,
      managerPortfolioValues,
      currentFilingManagerIds: selected.currentFilings.map(
        (filing) => filing.managerId,
      ),
      comparableManagerIds: selected.comparableManagerIds,
      canonicalAggregate,
    };
  },
};