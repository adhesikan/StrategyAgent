/**
 * PostgreSQL adapter for reusable stock-level institutional analytics.
 *
 * Only persisted effective filings are eligible. The adapter selects one
 * authoritative accession per manager/quarter and loads symbol candidates
 * through the conservative security-enrichment boundary. It performs no SEC
 * or network I/O.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  institutional13fFilings,
  institutional13fHoldings,
} from "@shared/schema";
import { parseQuarterIdentifier } from "../quarter-utils";
import { getEnrichedInstitutionalHoldings } from "./security-enrichment-repository";
import { createInstitutionalQuarter } from "./types";
import {
  filterByCohortManagerIds,
  getActiveManagerIdsForCohort,
} from "../manager-cohort-service";
import type {
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
): Promise<EnrichedInstitutionalHolding[]> {
  if (accessionNumbers.length === 0) return [];
  const holdings: EnrichedInstitutionalHolding[] = [];
  let offset = 0;
  while (true) {
    const page = await loadPage({
      accessionNumbers,
      symbol,
      limit: pageSize,
      offset,
    });
    holdings.push(...page);
    if (page.length < pageSize) return holdings;
    offset += page.length;
  }
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
    if (selectedPeriod === null) {
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
    const previousPeriod = previousQuarterPeriod(selectedPeriod);
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
    const selected = selectEffectiveStockFilings(
      eligibleFilingRows,
      query.quarter,
    );
    if (!selected) return null;

    const currentAccessions = selected.currentFilings.map(
      (filing) => filing.accessionNumber,
    );
    const previousAccessions = selected.previousFilings.map(
      (filing) => filing.accessionNumber,
    );
    const [currentHoldings, previousHoldings, managerPortfolioValues] =
      await Promise.all([
        loadAllStockInstitutionalHoldings(
          currentAccessions,
          query.symbol,
        ),
        previousAccessions.length > 0
          ? loadAllStockInstitutionalHoldings(
              previousAccessions,
              query.symbol,
            )
          : Promise.resolve([]),
        loadManagerPortfolioValues(selected.currentFilings),
      ]);

    return {
      symbol: query.symbol,
      quarter: selected.currentQuarter,
      previousQuarter: selected.previousQuarter,
      dataAsOf: selected.currentQuarter.periodEndDate,
      currentHoldings,
      previousHoldings,
      managerPortfolioValues,
      currentFilingManagerIds: selected.currentFilings.map(
        (filing) => filing.managerId,
      ),
      comparableManagerIds: selected.comparableManagerIds,
    };
  },
};