// Institutional Intelligence Service — Sprint 2.2.5.
//
// Serves pre-computed institutional aggregate data for the API.
// Never issues SEC requests at request time — all data comes from the DB.
//
// When INSTITUTIONAL_INTELLIGENCE_ENABLED=false:
//   Returns { status: "unavailable", ... } — existing placeholder is preserved.
//
// When enabled but no data exists for a symbol:
//   Returns { status: "unavailable", ... }.
//
// Security:
//   - No raw SEC payload in response.
//   - No credentials.
//   - Holder list is bounded.
//   - Source links use safe accession references only.
//   - Symbol is normalized and validated by the caller.

import { db } from "../../db";
import { eq, and, desc, lte } from "drizzle-orm";
import {
  institutionalQuarterlyAggregates,
  institutional13fFilings,
} from "@shared/schema";
import {
  isInstitutionalEnabled,
  quarterFromPeriodDate,
} from "./config";
import {
  classifyTrend,
  trendLabel,
  type TrendState,
} from "./trend-classifier";
import {
  computeEvidenceAlignment,
  alignmentLabel,
  type EvidenceAlignmentState,
} from "./evidence-alignment";
import type { AggregationResult } from "./aggregation-engine";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type InstitutionalStatus = "available" | "partial" | "unavailable" | "stale" | "error";

export interface FreshnessInfo {
  status: "current_quarter" | "prior_quarter" | "stale";
  daysSincePeriodEnd: number;
  daysSinceLatestFiling: number;
}

export interface CoverageInfo {
  mappingStatus: "complete" | "partial" | "insufficient";
  eligibleHoldingCount: number;
  excludedHoldingCount: number;
  warnings: string[];
}

export interface LargestHolderEntry {
  managerCik: string;
  managerName: string;
  reportedShares: number;
  reportedValue: number | null;
  quarterChangeShares: number | null;
  quarterChangePercent: number | null;
  activity: string;
  periodOfReport: string;
  filingDate: string;
}

export interface InstitutionalApiResponse {
  status: InstitutionalStatus;
  symbol: string;
  source: "SEC Form 13F" | null;
  periodOfReport: string | null;
  latestFilingDate: string | null;
  generatedAt: string | null;
  freshness: FreshnessInfo | null;
  coverage: CoverageInfo | null;
  summary: {
    reportingManagerCount: number;
    aggregateReportedShares: number | null;
    aggregateReportedValue: number | null;
    reportedSharesChange: number | null;
    reportedSharesChangePercent: number | null;
    trend: TrendState;
    trendLabel: string;
  } | null;
  managerActivity: {
    new: number;
    increased: number;
    reduced: number;
    exited: number;
    unchanged: number;
  } | null;
  concentration: {
    topHolderPercentOfReportedShares: number | null;
    top5PercentOfReportedShares: number | null;
    top10PercentOfReportedShares: number | null;
    classification: string;
  } | null;
  /** Bounded to MAX_LARGEST_HOLDERS */
  largestReportedHolders: LargestHolderEntry[];
  evidenceAlignment: {
    state: EvidenceAlignmentState;
    label: string;
    reasons: string[];
  };
  limitations: string[];
  sourceLinks: Array<{ label: string; url: string }>;
  /** Historical quarters for chart (up to 8, chronological order) */
  historicalQuarters: Array<{
    periodLabel: string;
    periodOfReport: string;
    aggregateReportedShares: number | null;
    reportingManagerCount: number;
    trend: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LARGEST_HOLDERS = 20;
const STALE_DAYS = 180; // > 180 days since period end = stale

// Standard 13F limitations (always displayed)
const STANDARD_LIMITATIONS: string[] = [
  "Form 13F is periodic and delayed — filings are due within 45 days of quarter end.",
  "Holdings reflect the period-of-report date, not the filing date or any later date.",
  "Filings may be amended; the most recent effective version is shown.",
  "Form 13F does not provide a complete picture of all institutional activity.",
  "Short positions are not represented as ordinary long holdings.",
  "Put/call entries are excluded from common-stock share totals.",
  "Reported holdings may have changed materially after quarter end.",
  "Source filings may contain filer-supplied inaccuracies.",
  "This data reflects 13F-reported holdings only, not total institutional ownership.",
];

// ---------------------------------------------------------------------------
// Freshness computation
// ---------------------------------------------------------------------------

function computeFreshness(periodOfReport: string, latestFilingDate: string): FreshnessInfo {
  const now = new Date();
  const periodEnd = new Date(periodOfReport);
  const filingDate = new Date(latestFilingDate);

  const daysSincePeriodEnd = Math.floor((now.getTime() - periodEnd.getTime()) / 86_400_000);
  const daysSinceLatestFiling = Math.floor((now.getTime() - filingDate.getTime()) / 86_400_000);

  let status: FreshnessInfo["status"];
  if (daysSincePeriodEnd <= 95) status = "current_quarter";   // within ~3 months of period end
  else if (daysSincePeriodEnd <= 185) status = "prior_quarter";
  else status = "stale";

  return { status, daysSincePeriodEnd, daysSinceLatestFiling };
}

// ---------------------------------------------------------------------------
// EDGAR source link builder
// ---------------------------------------------------------------------------

function buildEdgarLink(filerCik: string, accessionNumber: string): string {
  const cikClean = filerCik.replace(/^0+/, "");
  const accDashed = accessionNumber.replace(/^(\d{10})(\d{6})(\d+)$/, "$1-$2-$3");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikClean}&type=13F-HR&dateb=&owner=include&count=10`;
}

// ---------------------------------------------------------------------------
// Main service function
// ---------------------------------------------------------------------------

/**
 * Retrieve the institutional intelligence response for a symbol.
 *
 * @param symbol - Normalized uppercase ticker (validated by caller).
 * @param maxHolders - Maximum number of largest-holder entries (default 20).
 */
export async function getInstitutionalData(
  symbol: string,
  maxHolders: number = MAX_LARGEST_HOLDERS,
): Promise<InstitutionalApiResponse> {
  // Feature flag check
  if (!isInstitutionalEnabled()) {
    return unavailableResponse(symbol, "Institutional Intelligence is not enabled on this deployment.");
  }

  try {
    // Fetch the most recent aggregate for this symbol
    const [current] = await db
      .select()
      .from(institutionalQuarterlyAggregates)
      .where(eq(institutionalQuarterlyAggregates.symbol, symbol))
      .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
      .limit(1);

    if (!current) {
      return unavailableResponse(symbol, "No 13F aggregate data available for this symbol.");
    }

    // Fetch previous quarter aggregate for trend
    const [previous] = current.prevPeriodOfReport
      ? await db
          .select()
          .from(institutionalQuarterlyAggregates)
          .where(
            and(
              eq(institutionalQuarterlyAggregates.symbol, symbol),
              eq(institutionalQuarterlyAggregates.periodOfReport, current.prevPeriodOfReport),
            ),
          )
          .limit(1)
      : [null];

    // Fetch historical quarters for chart (up to 8, newest first → reverse to chronological)
    const histRows = await db
      .select({
        periodLabel: institutionalQuarterlyAggregates.periodLabel,
        periodOfReport: institutionalQuarterlyAggregates.periodOfReport,
        aggregateReportedShares: institutionalQuarterlyAggregates.aggregateReportedShares,
        reportingManagerCount: institutionalQuarterlyAggregates.reportingManagerCount,
        trend: institutionalQuarterlyAggregates.trend,
      })
      .from(institutionalQuarterlyAggregates)
      .where(eq(institutionalQuarterlyAggregates.symbol, symbol))
      .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport))
      .limit(8);

    const historicalQuarters = histRows.reverse().map((r) => ({
      periodLabel: r.periodLabel,
      periodOfReport: r.periodOfReport,
      aggregateReportedShares: r.aggregateReportedShares,
      reportingManagerCount: r.reportingManagerCount,
      trend: r.trend,
    }));

    // Find the latest filing date
    const latestFilingRows = await db
      .select({
        filingDate: institutional13fFilings.filingDate,
        accessionNumber: institutional13fFilings.accessionNumber,
        filerCik: institutional13fFilings.filerCik,
      })
      .from(institutional13fFilings)
      .where(
        and(
          eq(institutional13fFilings.periodOfReport, current.periodOfReport),
          eq(institutional13fFilings.isEffective, true),
        ),
      )
      .orderBy(desc(institutional13fFilings.filingDate))
      .limit(1);

    const latestFilingDate = latestFilingRows[0]?.filingDate ?? null;
    const latestFilingCik = latestFilingRows[0]?.filerCik ?? null;
    const latestAccession = latestFilingRows[0]?.accessionNumber ?? null;

    // Freshness
    const freshness = latestFilingDate
      ? computeFreshness(current.periodOfReport, latestFilingDate)
      : null;

    // Determine overall status
    let status: InstitutionalStatus = "available";
    if (current.coverageStatus === "insufficient") {
      status = "partial";
    } else if (freshness?.status === "stale") {
      status = "stale";
    }

    // Trend and evidence alignment
    const trendResult = classifyTrend(current as any, previous as any ?? null);
    const trendState: TrendState = trendResult.trend;

    const evidenceResult = computeEvidenceAlignment(current as any, trendState);

    // Coverage warnings
    const coverageWarnings: string[] = [];
    if (current.coverageStatus === "partial") {
      coverageWarnings.push("Coverage is partial — not all 13F managers may be reflected.");
    }
    if (current.amendmentStatus === "has_amendments") {
      coverageWarnings.push("Some 13F amendments were processed for this quarter.");
    }
    if (current.amendmentStatus === "pending_amendments") {
      coverageWarnings.push("Amendment processing may be incomplete for this quarter.");
    }

    // Largest holders — bounded, with safe fields only
    const rawHolders = (Array.isArray(current.largestHolders) ? current.largestHolders : []) as any[];
    const largestReportedHolders: LargestHolderEntry[] = rawHolders
      .slice(0, maxHolders)
      .map((h: any) => ({
        managerCik: String(h.managerCik ?? ""),
        managerName: String(h.managerName ?? ""),
        reportedShares: Number(h.reportedShares ?? 0),
        reportedValue: h.reportedValue != null ? Number(h.reportedValue) : null,
        quarterChangeShares: h.quarterChangeShares != null ? Number(h.quarterChangeShares) : null,
        quarterChangePercent: h.quarterChangePercent != null ? Number(h.quarterChangePercent) : null,
        activity: String(h.activity ?? "unchanged"),
        periodOfReport: String(h.periodOfReport ?? current.periodOfReport),
        filingDate: String(h.filingDate ?? ""),
      }));

    // Source links — safe EDGAR accession references only
    const sourceLinks: Array<{ label: string; url: string }> = [];
    if (latestFilingCik) {
      sourceLinks.push({
        label: `SEC EDGAR 13F-HR filings for ${symbol}`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${latestFilingCik.replace(/^0+/, "")}&type=13F-HR&dateb=&owner=include&count=10`,
      });
    }
    sourceLinks.push({
      label: "SEC EDGAR 13F filing search",
      url: "https://efts.sec.gov/LATEST/search-index?q=%2213F-HR%22&forms=13F-HR",
    });

    return {
      status,
      symbol,
      source: "SEC Form 13F",
      periodOfReport: current.periodOfReport,
      latestFilingDate,
      generatedAt: current.generatedAt.toISOString(),
      freshness,
      coverage: {
        mappingStatus: current.coverageStatus as CoverageInfo["mappingStatus"],
        eligibleHoldingCount: current.eligibleHoldingCount,
        excludedHoldingCount: current.excludedHoldingCount,
        warnings: coverageWarnings,
      },
      summary: {
        reportingManagerCount: current.reportingManagerCount,
        aggregateReportedShares: current.aggregateReportedShares,
        aggregateReportedValue: current.aggregateReportedValue,
        reportedSharesChange: current.reportedSharesChange,
        reportedSharesChangePercent: current.reportedSharesChangePercent,
        trend: trendState,
        trendLabel: trendLabel(trendState),
      },
      managerActivity: {
        new: current.newPositionCount,
        increased: current.increasedPositionCount,
        reduced: current.reducedPositionCount,
        exited: current.exitedPositionCount,
        unchanged: current.unchangedCount,
      },
      concentration: {
        topHolderPercentOfReportedShares: current.topHolderPercent,
        top5PercentOfReportedShares: current.top5HolderPercent,
        top10PercentOfReportedShares: current.top10HolderPercent,
        classification: current.concentrationClassification ?? "unavailable",
      },
      largestReportedHolders,
      evidenceAlignment: {
        state: evidenceResult.state,
        label: alignmentLabel(evidenceResult.state),
        reasons: evidenceResult.reasons,
      },
      limitations: STANDARD_LIMITATIONS,
      sourceLinks,
      historicalQuarters,
    };
  } catch (err: any) {
    console.error("[Institutional] Service error:", err?.message);
    return unavailableResponse(symbol, "An error occurred retrieving institutional data.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unavailableResponse(symbol: string, reason: string): InstitutionalApiResponse {
  return {
    status: "unavailable",
    symbol,
    source: null,
    periodOfReport: null,
    latestFilingDate: null,
    generatedAt: null,
    freshness: null,
    coverage: null,
    summary: null,
    managerActivity: null,
    concentration: null,
    largestReportedHolders: [],
    evidenceAlignment: { state: "unavailable", label: "Unavailable", reasons: [reason] },
    limitations: STANDARD_LIMITATIONS,
    sourceLinks: [
      {
        label: "SEC EDGAR 13F filing search",
        url: "https://efts.sec.gov/LATEST/search-index?q=%2213F-HR%22&forms=13F-HR",
      },
    ],
    historicalQuarters: [],
  };
}
