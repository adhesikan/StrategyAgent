/**
 * PostgreSQL adapter for manager-level portfolio X-ray analytics.
 *
 * Filing selection is deliberately separate from calculation: only rows marked
 * is_effective are candidates, and the selected accession is then passed to
 * the existing persisted enrichment adapter. No SEC/network call occurs here.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../db";
import { institutional13fFilings } from "@shared/schema";
import { parseQuarterIdentifier } from "../quarter-utils";
import { createInstitutionalQuarter } from "./types";
import type {
  EffectiveFundFiling,
  FundPortfolioXRayRepository,
  FundPortfolioXRayRepositoryQuery,
  FundPortfolioXRaySource,
} from "./repository";
import { getEnrichedInstitutionalHoldings } from "./security-enrichment-repository";

export interface EffectiveFundFilingCandidate extends EffectiveFundFiling {
  isEffective: boolean;
}

function dateText(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function normalizeManagerId(managerId: string): string {
  const stripped = String(managerId ?? "").trim().replace(/^0+/, "") || "0";
  return stripped.padStart(10, "0");
}

/**
 * Pick one authoritative filing per period and return the requested period
 * with the immediately preceding calendar quarter when it is available.
 */
export function selectEffectiveFundFilings(
  rows: EffectiveFundFilingCandidate[],
  quarter: FundPortfolioXRayRepositoryQuery["quarter"],
): { current: EffectiveFundFiling; previous: EffectiveFundFiling | null } | null {
  const effective = rows
    .filter((row) => row.isEffective)
    .slice()
    .sort((a, b) => {
      const period = b.periodOfReport.localeCompare(a.periodOfReport);
      if (period !== 0) return period;
      const filing = b.filingDate.localeCompare(a.filingDate);
      if (filing !== 0) return filing;
      return b.accessionNumber.localeCompare(a.accessionNumber);
    });

  const uniqueByPeriod: EffectiveFundFiling[] = [];
  const seenPeriods = new Set<string>();
  for (const filing of effective) {
    if (seenPeriods.has(filing.periodOfReport)) continue;
    seenPeriods.add(filing.periodOfReport);
    uniqueByPeriod.push(filing);
  }

  const requestedPeriod =
    typeof quarter === "object"
      ? quarter.periodEndDate
      : parseQuarterIdentifier(quarter)?.periodEndDate ?? null;
  const index = requestedPeriod === null
    ? 0
    : uniqueByPeriod.findIndex((filing) => filing.periodOfReport === requestedPeriod);
  if (index < 0 || uniqueByPeriod[index] === undefined) return null;
  const current = uniqueByPeriod[index];
  const parsedCurrent = parseQuarterIdentifier(current.periodOfReport);
  let precedingPeriod: string | null = null;
  if (parsedCurrent?.kind === "quarter") {
    const precedingYear =
      parsedCurrent.quarter === 1 ? parsedCurrent.year - 1 : parsedCurrent.year;
    const precedingQuarter =
      parsedCurrent.quarter === 1 ? 4 : parsedCurrent.quarter - 1;
    precedingPeriod = parseQuarterIdentifier(
      `${precedingYear}-Q${precedingQuarter}`,
    )?.periodEndDate ?? null;
  }

  return {
    current,
    previous:
      precedingPeriod === null
        ? null
        : uniqueByPeriod.find(
            (filing) => filing.periodOfReport === precedingPeriod,
          ) ?? null,
  };
}

export const fundPortfolioXRayRepository: FundPortfolioXRayRepository = {
  async getFundPortfolioSource(
    query: FundPortfolioXRayRepositoryQuery,
  ): Promise<FundPortfolioXRaySource | null> {
    const managerId = normalizeManagerId(query.managerId);
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
          eq(institutional13fFilings.filerCik, managerId),
          eq(institutional13fFilings.isEffective, true),
        ),
      )
      .orderBy(
        desc(institutional13fFilings.periodOfReport),
        desc(institutional13fFilings.filingDate),
        desc(institutional13fFilings.accessionNumber),
      );

    const selected = selectEffectiveFundFilings(
      filingRows.map((row) => ({
        ...row,
        periodOfReport: dateText(row.periodOfReport),
        filingDate: dateText(row.filingDate),
      })),
      query.quarter,
    );
    if (!selected) return null;

    const [currentHoldings, previousHoldings] = await Promise.all([
      getEnrichedInstitutionalHoldings({
        accessionNumber: selected.current.accessionNumber,
        limit: 100_000,
      }),
      selected.previous
        ? getEnrichedInstitutionalHoldings({
            accessionNumber: selected.previous.accessionNumber,
            limit: 100_000,
          })
        : Promise.resolve([]),
    ]);

    return {
      managerId: selected.current.managerId,
      managerName: selected.current.managerName,
      currentFiling: selected.current,
      currentHoldings,
      previousFiling: selected.previous,
      previousHoldings,
    };
  },
};