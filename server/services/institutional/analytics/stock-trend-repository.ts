/**
 * PostgreSQL adapter for multi-quarter stock institutional trend snapshots.
 *
 * It selects effective filings for a bounded consecutive period window and
 * loads all selected symbol holdings in one paged enrichment stream. No SEC or
 * per-manager/per-quarter request-time fetches are performed.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { institutional13fFilings } from "@shared/schema";
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