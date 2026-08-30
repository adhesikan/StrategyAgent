/**
 * PostgreSQL adapter for multi-quarter stock institutional trend snapshots.
 *
 * It selects effective filings for a bounded consecutive period window and
 * loads all selected symbol holdings in one paged enrichment stream. No SEC or
 * per-manager/per-quarter request-time fetches are performed.
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../../../db";
import {
  institutional13fFilings,
  institutionalQuarterlyAggregates,
  type InstitutionalQuarterlyAggregate,
} from "@shared/schema";
import { parseQuarterIdentifier } from "../quarter-utils";
import { getEnrichedInstitutionalHoldings } from "./security-enrichment-repository";
import { createInstitutionalQuarter } from "./types";
import {
  filterByCohortManagerIds,
  getActiveManagerIdsForCohort,
} from "../manager-cohort-service";
import {
  loadAllStockInstitutionalHoldings,
} from "./stock-analytics-repository";
import type {
  CanonicalInstitutionalQuarterAggregate,
  EffectiveFundFiling,
  StockInstitutionalTrendQuarterSource,
  StockInstitutionalTrendRepository,
  StockInstitutionalTrendRepositoryQuery,
  StockInstitutionalTrendSource,
} from "./repository";
import type {
  EnrichedInstitutionalHolding,
  FundPortfolioXRayQuarterSelector,
} from "./types";

function dateText(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
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

function previousQuarterPeriod(periodOfReport: string): string | null {
  const parsed = parseQuarterIdentifier(periodOfReport);
  if (parsed?.kind !== "quarter") return null;
  const year = parsed.quarter === 1 ? parsed.year - 1 : parsed.year;
  const quarter = parsed.quarter === 1 ? 4 : parsed.quarter - 1;
  return parseQuarterIdentifier(`${year}-Q${quarter}`)?.periodEndDate ?? null;
}

function periodsEndingAt(endPeriod: string, count: number): string[] {
  const periods: string[] = [];
  let period: string | null = endPeriod;
  for (let index = 0; index < count && period; index++) {
    periods.push(period);
    period = previousQuarterPeriod(period);
  }
  return periods;
}

function selectedPeriodFromQuarter(
  quarter: FundPortfolioXRayQuarterSelector,
): string | null {
  if (typeof quarter === "object") return quarter.periodEndDate;
  return parseQuarterIdentifier(quarter)?.periodEndDate ?? null;
}

function selectEffectiveTrendFilings(
  rows: EffectiveFundFiling[],
  periods: string[],
): Map<string, EffectiveFundFiling[]> {
  const selected = new Map<string, EffectiveFundFiling[]>();
  const unique = new Map<string, EffectiveFundFiling>();
  for (const filing of rows
    .filter((row) => row.isEffective)
    .slice()
    .sort(
      (left, right) =>
        right.periodOfReport.localeCompare(left.periodOfReport) ||
        left.managerId.localeCompare(right.managerId) ||
        right.filingDate.localeCompare(left.filingDate) ||
        right.accessionNumber.localeCompare(left.accessionNumber),
    )) {
    const key = `${filing.managerId}:${filing.periodOfReport}`;
    if (!unique.has(key)) unique.set(key, filing);
  }
  for (const period of periods) {
    selected.set(
      period,
      Array.from(unique.values()).filter(
        (filing) => filing.periodOfReport === period,
      ),
    );
  }
  return selected;
}

function holdingsForAccessions(
  holdings: EnrichedInstitutionalHolding[],
  accessions: Set<string>,
): EnrichedInstitutionalHolding[] {
  return holdings.filter((holding) => accessions.has(holding.accessionNumber));
}

export const stockInstitutionalTrendRepository: StockInstitutionalTrendRepository =
  {
    async getStockInstitutionalTrendSource(
      query: StockInstitutionalTrendRepositoryQuery,
    ): Promise<StockInstitutionalTrendSource | null> {
      const requestedHistory = query.options.historyQuarters;
      const requestedCount =
        requestedHistory === undefined || !Number.isFinite(requestedHistory)
          ? 8
          : Math.max(1, Math.min(8, Math.floor(requestedHistory)));
      let selectedPeriod = selectedPeriodFromQuarter(
        query.options.quarter ?? "latest",
      );
      const canonicalMode =
        (query.options.positionType ?? "COMMON_EQUITY") === "COMMON_EQUITY" &&
        query.options.cohort === undefined;
      if (canonicalMode) {
        const rows = await db
          .select()
          .from(institutionalQuarterlyAggregates)
          .where(
            selectedPeriod
              ? and(
                  eq(institutionalQuarterlyAggregates.symbol, query.symbol),
                  lte(
                    institutionalQuarterlyAggregates.periodOfReport,
                    selectedPeriod,
                  ),
                )
              : eq(institutionalQuarterlyAggregates.symbol, query.symbol),
          )
          .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
          .limit(requestedCount);
        if (
          rows.length === 0 ||
          (selectedPeriod &&
            dateText(rows[0].periodOfReport) !== selectedPeriod)
        ) {
          return null;
        }
        const returnedPeriods = new Set(
          rows.map((row) => dateText(row.periodOfReport)),
        );
        const missingPreviousPeriods = Array.from(
          new Set(
            rows
              .map((row) =>
                row.prevPeriodOfReport
                  ? dateText(row.prevPeriodOfReport)
                  : null,
              )
              .filter(
                (period): period is string =>
                  period !== null && !returnedPeriods.has(period),
              ),
          ),
        );
        const predecessorRows =
          missingPreviousPeriods.length > 0
            ? await db
                .select()
                .from(institutionalQuarterlyAggregates)
                .where(
                  and(
                    eq(institutionalQuarterlyAggregates.symbol, query.symbol),
                    inArray(
                      institutionalQuarterlyAggregates.periodOfReport,
                      missingPreviousPeriods,
                    ),
                  ),
                )
            : [];
        const byPeriod = new Map(
          [...rows, ...predecessorRows].map((row) => [
            dateText(row.periodOfReport),
            row,
          ]),
        );
        const quarters = rows
          .map((row): StockInstitutionalTrendQuarterSource | null => {
            const previousPeriod = row.prevPeriodOfReport
              ? dateText(row.prevPeriodOfReport)
              : null;
            const canonicalAggregate = toCanonicalAggregate(
              row,
              previousPeriod ? byPeriod.get(previousPeriod) ?? null : null,
            );
            if (!canonicalAggregate) return null;
            return {
              quarter: canonicalAggregate.quarter,
              previousQuarter: canonicalAggregate.previousQuarter,
              currentHoldings: [],
              previousHoldings: [],
              currentFilingManagerIds: [],
              comparableManagerIds: [],
              canonicalAggregate,
            };
          })
          .filter(
            (
              quarter,
            ): quarter is StockInstitutionalTrendQuarterSource =>
              quarter !== null,
          )
          .reverse();
        return quarters.length > 0
          ? { symbol: query.symbol, quarters }
          : null;
      }
      if (!selectedPeriod) {
        const latest = await db
          .select({ periodOfReport: institutional13fFilings.periodOfReport })
          .from(institutional13fFilings)
          .where(eq(institutional13fFilings.isEffective, true))
          .orderBy(desc(institutional13fFilings.periodOfReport))
          .limit(1);
        selectedPeriod = latest[0]
          ? dateText(latest[0].periodOfReport)
          : null;
      }
      if (!selectedPeriod) return null;

      const periods = periodsEndingAt(selectedPeriod, requestedCount);
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
      const filings = selectEffectiveTrendFilings(
        eligibleFilingRows,
        periods,
      );
      const availablePeriods = periods.filter(
        (period) => (filings.get(period) ?? []).length > 0,
      );
      if (
        availablePeriods.length === 0 ||
        (filings.get(selectedPeriod) ?? []).length === 0
      ) {
        return null;
      }

      const allAccessions = Array.from(
        new Set(
          availablePeriods.flatMap((period) =>
            (filings.get(period) ?? []).map(
              (filing) => filing.accessionNumber,
            ),
          ),
        ),
      );
      const allHoldings = await loadAllStockInstitutionalHoldings(
        allAccessions,
        query.symbol,
        getEnrichedInstitutionalHoldings,
      );
      const sources: StockInstitutionalTrendQuarterSource[] = [];
      for (const period of availablePeriods) {
        const currentFilings = filings.get(period) ?? [];
        const priorPeriod = previousQuarterPeriod(period);
        const currentManagerIds = new Set(
          currentFilings.map((filing) => filing.managerId),
        );
        const previousFilings = priorPeriod
          ? (filings.get(priorPeriod) ?? []).filter((filing) =>
              currentManagerIds.has(filing.managerId),
            )
          : [];
        const quarter = createInstitutionalQuarter(period);
        const previousQuarter =
          previousFilings.length > 0 && priorPeriod
            ? createInstitutionalQuarter(priorPeriod)
            : null;
        if (!quarter) continue;
        sources.push({
          quarter,
          previousQuarter,
          currentHoldings: holdingsForAccessions(
            allHoldings,
            new Set(currentFilings.map((filing) => filing.accessionNumber)),
          ),
          previousHoldings: holdingsForAccessions(
            allHoldings,
            new Set(previousFilings.map((filing) => filing.accessionNumber)),
          ),
          currentFilingManagerIds: currentFilings.map(
            (filing) => filing.managerId,
          ),
          comparableManagerIds: previousFilings.map(
            (filing) => filing.managerId,
          ),
        });
      }
      return { symbol: query.symbol, quarters: sources.reverse() };
    },
  };