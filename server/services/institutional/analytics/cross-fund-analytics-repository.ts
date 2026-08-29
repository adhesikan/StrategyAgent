/**
 * Set-based source adapter for cross-fund institutional activity rankings.
 *
 * Filing selection is bounded to the requested/latest quarter and its adjacent
 * calendar quarter. Holdings are loaded in deterministic pages across all
 * selected accessions; there is no manager-by-manager query.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { institutional13fFilings } from "@shared/schema";
import { parseQuarterIdentifier } from "../quarter-utils";
import { selectEffectiveStockFilings, loadAllStockInstitutionalHoldings } from "./stock-analytics-repository";
import { createInstitutionalQuarter } from "./types";
import {
  filterByCohortManagerIds,
  getActiveManagerIdsForCohort,
} from "../manager-cohort-service";
import type {
  CrossFundInstitutionalAnalyticsSource,
  CrossFundInstitutionalRepository,
  CrossFundInstitutionalRepositoryQuery,
} from "./repository";
import type { FundPortfolioXRayQuarterSelector } from "./types";

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

function selectedPeriodFromQuarter(
  quarter: FundPortfolioXRayQuarterSelector,
): string | null {
  if (typeof quarter === "object") return quarter.periodEndDate;
  return parseQuarterIdentifier(quarter)?.periodEndDate ?? null;
}

export const crossFundInstitutionalRepository: CrossFundInstitutionalRepository = {
  async getCrossFundInstitutionalSource(
    query: CrossFundInstitutionalRepositoryQuery,
  ): Promise<CrossFundInstitutionalAnalyticsSource | null> {
    let selectedPeriod = selectedPeriodFromQuarter(query.quarter);
    if (selectedPeriod === null) {
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
    const [currentHoldings, previousHoldings] = await Promise.all([
      loadAllStockInstitutionalHoldings(currentAccessions),
      loadAllStockInstitutionalHoldings(previousAccessions),
    ]);
    const quarter = createInstitutionalQuarter(selected.currentQuarter.periodEndDate);
    if (!quarter) return null;
    return {
      quarter,
      previousQuarter: selected.previousQuarter,
      dataAsOf: quarter.periodEndDate,
      currentHoldings,
      previousHoldings,
      currentFilingManagerIds: selected.currentFilings.map(
        (filing) => filing.managerId,
      ),
      comparableManagerIds: selected.comparableManagerIds,
    };
  },
};