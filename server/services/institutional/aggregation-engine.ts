// Institutional Aggregation Engine — Sprint 2.2.5.
//
// Pure computation functions — no database access.
// All inputs come from the caller; all outputs are deterministic.
//
// KEY RULES (non-negotiable):
//   - Put/call rows are EXCLUDED from all share totals.
//   - PRN rows are EXCLUDED from share totals (they are principal amounts, not shares).
//   - Only exact and reviewed mappings are included in production aggregates.
//   - Nulls are never converted to zero.
//   - Filing date and period-of-report are never swapped.
//   - "New position" = positive shares this quarter, no position in prior comparable quarter.
//   - "Exit" = positive position in prior quarter, no position this quarter.
//   - Do not infer intraperiod transactions.
//
// Concentration metrics label: "Reported Holder Concentration"
// Denominator: aggregate mapped eligible 13F-reported shares for that quarter.

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface EligibleHolding {
  filerCik: string;
  filerName: string;
  reportedShares: number;
  reportedValue: number | null;
  putCall: "Put" | "Call" | null;
  sharesPrnType: "SH" | "PRN" | null;
  mappingStatus: string;
  periodOfReport: string;
  filingDate: string;
  accessionNumber: string;
}

export interface AggregationInput {
  symbol: string;
  periodOfReport: string;
  /** Holdings for the current quarter (all statuses; filtering happens here) */
  currentHoldings: EligibleHolding[];
  /** Holdings for the prior comparable quarter (for QoQ change) */
  previousHoldings: EligibleHolding[];
  prevPeriodOfReport: string | null;
  /** Whether any amendments were present in this quarter */
  hasAmendments: boolean;
  /** Whether pending amendments may be outstanding */
  hasPendingAmendments: boolean;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface LargestHolder {
  managerCik: string;
  managerName: string;
  reportedShares: number;
  reportedValue: number | null;
  quarterChangeShares: number | null;
  quarterChangePercent: number | null;
  activity: "new" | "increased" | "reduced" | "unchanged" | "exited";
  periodOfReport: string;
  filingDate: string;
}

export interface AggregationResult {
  symbol: string;
  periodOfReport: string;
  periodLabel: string;
  reportingManagerCount: number;
  aggregateReportedShares: number | null;
  aggregateReportedValue: number | null;
  prevPeriodOfReport: string | null;
  previousQuarterShares: number | null;
  previousQuarterValue: number | null;
  reportedSharesChange: number | null;
  reportedSharesChangePercent: number | null;
  newPositionCount: number;
  increasedPositionCount: number;
  reducedPositionCount: number;
  exitedPositionCount: number;
  unchangedCount: number;
  topHolderPercent: number | null;
  top5HolderPercent: number | null;
  top10HolderPercent: number | null;
  concentrationClassification: "low" | "moderate" | "high" | "unavailable";
  largestHolders: LargestHolder[];
  eligibleHoldingCount: number;
  excludedHoldingCount: number;
  coverageStatus: "complete" | "partial" | "insufficient";
  amendmentStatus: "clean" | "has_amendments" | "pending_amendments";
}

// ---------------------------------------------------------------------------
// Eligibility filter
// ---------------------------------------------------------------------------

/**
 * Determine whether a holding row is eligible for inclusion in the
 * common-stock aggregate.
 *
 * EXCLUDED:
 *   - put/call rows (options, never common-stock shares)
 *   - PRN rows (principal amount, not shares)
 *   - rows with null or zero reportedShares
 *   - rows with mappingStatus not in ["exact", "reviewed"] (for production)
 */
export function isEligibleForAggregate(
  holding: EligibleHolding,
  productionMode: boolean = true,
): boolean {
  // Exclude put/call (options)
  if (holding.putCall !== null) return false;
  // Exclude PRN (principal amount, not shares)
  if (holding.sharesPrnType === "PRN") return false;
  // Must have positive shares
  if (!holding.reportedShares || holding.reportedShares <= 0) return false;
  // Production: only exact/reviewed mappings
  if (productionMode && !["exact", "reviewed"].includes(holding.mappingStatus)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Per-filer aggregation
// ---------------------------------------------------------------------------

interface FilerPosition {
  cik: string;
  name: string;
  shares: number;
  value: number | null;
  filingDate: string;
}

function aggregateByFiler(holdings: EligibleHolding[]): Map<string, FilerPosition> {
  const byFiler = new Map<string, FilerPosition>();
  for (const h of holdings) {
    if (!isEligibleForAggregate(h)) continue;
    const existing = byFiler.get(h.filerCik);
    if (!existing) {
      byFiler.set(h.filerCik, {
        cik: h.filerCik,
        name: h.filerName,
        shares: h.reportedShares,
        value: h.reportedValue,
        filingDate: h.filingDate,
      });
    } else {
      // Same filer may report multiple classes — sum eligible shares
      existing.shares += h.reportedShares;
      if (existing.value !== null && h.reportedValue !== null) {
        existing.value += h.reportedValue;
      } else if (h.reportedValue !== null) {
        existing.value = h.reportedValue;
      }
    }
  }
  return byFiler;
}

// ---------------------------------------------------------------------------
// Activity classification
// ---------------------------------------------------------------------------

type Activity = "new" | "increased" | "reduced" | "unchanged" | "exited";

function classifyActivity(
  currentShares: number | undefined,
  prevShares: number | undefined,
): Activity {
  const hasCurrent = currentShares !== undefined && currentShares > 0;
  const hasPrev = prevShares !== undefined && prevShares > 0;

  if (hasCurrent && !hasPrev) return "new";
  if (!hasCurrent && hasPrev) return "exited";
  if (!hasCurrent && !hasPrev) return "unchanged"; // shouldn't occur in production
  if (currentShares! > prevShares!) return "increased";
  if (currentShares! < prevShares!) return "reduced";
  return "unchanged";
}

// ---------------------------------------------------------------------------
// Concentration computation
// ---------------------------------------------------------------------------

/**
 * Compute top-N holder concentration.
 * Denominator is the aggregate eligible 13F-reported shares for this quarter.
 *
 * Returns a value in [0, 1] or null when denominator is unavailable.
 */
function computeConcentration(
  sortedByShares: FilerPosition[],
  totalShares: number,
  n: number,
): number | null {
  if (totalShares <= 0 || sortedByShares.length === 0) return null;
  const topN = sortedByShares.slice(0, n);
  const topNShares = topN.reduce((sum, p) => sum + p.shares, 0);
  return topNShares / totalShares;
}

/**
 * Classify concentration into low / moderate / high.
 *
 * Thresholds for top-10 share of reported 13F shares:
 *   Low:      < 40%
 *   Moderate: 40–70%
 *   High:     > 70%
 *
 * These thresholds apply to the 13F-reported universe, not total ownership.
 */
export function classifyConcentration(
  top10Percent: number | null,
): "low" | "moderate" | "high" | "unavailable" {
  if (top10Percent === null) return "unavailable";
  if (top10Percent < 0.4) return "low";
  if (top10Percent < 0.7) return "moderate";
  return "high";
}

// ---------------------------------------------------------------------------
// Percent change helper
// ---------------------------------------------------------------------------

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

// ---------------------------------------------------------------------------
// Period label from ISO date
// ---------------------------------------------------------------------------

export function derivePeriodLabel(periodDate: string): string {
  const d = new Date(periodDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  let q: number;
  if (month <= 3) q = 1;
  else if (month <= 6) q = 2;
  else if (month <= 9) q = 3;
  else q = 4;
  return `${year}-Q${q}`;
}

// ---------------------------------------------------------------------------
// Coverage classification
// ---------------------------------------------------------------------------

/**
 * Classify coverage quality.
 *   complete:     ≥1 eligible manager mapped AND mapping confidence is high
 *   partial:      some eligible managers but mapping coverage may be incomplete
 *   insufficient: no eligible managers
 */
export function classifyCoverage(
  eligibleCount: number,
  totalCurrentHoldings: number,
): "complete" | "partial" | "insufficient" {
  if (eligibleCount === 0) return "insufficient";
  if (totalCurrentHoldings > 0 && eligibleCount / totalCurrentHoldings >= 0.5) return "complete";
  return "partial";
}

// ---------------------------------------------------------------------------
// Main aggregation function
// ---------------------------------------------------------------------------

/**
 * Compute the quarterly aggregate for a single symbol.
 *
 * This function is pure — it performs no DB I/O.
 * All data must be supplied by the caller.
 *
 * @param input - All holdings and metadata for the symbol+quarter.
 * @param maxLargestHolders - Bound on the returned largest-holders list (default 20).
 */
export function computeQuarterlyAggregate(
  input: AggregationInput,
  maxLargestHolders: number = 20,
): AggregationResult {
  const { symbol, periodOfReport, currentHoldings, previousHoldings, prevPeriodOfReport } = input;

  const periodLabel = derivePeriodLabel(periodOfReport);

  // Aggregate current quarter by filer (eligibility applied inside)
  const currentByFiler = aggregateByFiler(currentHoldings);
  const previousByFiler = aggregateByFiler(previousHoldings);

  const eligibleCount = currentByFiler.size;
  const totalCurrentHoldings = currentHoldings.length;
  const excludedCount = totalCurrentHoldings - currentHoldings.filter((h) => isEligibleForAggregate(h)).length;

  // Aggregate totals
  let totalShares = 0;
  let totalValue: number | null = null;
  for (const pos of Array.from(currentByFiler.values())) {
    totalShares += pos.shares;
    if (pos.value !== null) {
      totalValue = (totalValue ?? 0) + pos.value;
    }
  }

  let prevTotalShares: number | null = null;
  let prevTotalValue: number | null = null;
  for (const pos of Array.from(previousByFiler.values())) {
    prevTotalShares = (prevTotalShares ?? 0) + pos.shares;
    if (pos.value !== null) {
      prevTotalValue = (prevTotalValue ?? 0) + pos.value;
    }
  }

  // QoQ change
  const reportedSharesChange =
    totalShares > 0 && prevTotalShares !== null
      ? totalShares - prevTotalShares
      : null;

  const reportedSharesChangePercent =
    prevTotalShares !== null && prevTotalShares > 0
      ? percentChange(totalShares, prevTotalShares)
      : null;

  // Activity classification per manager
  const allManagerCiks = new Set([
    ...Array.from(currentByFiler.keys()),
    ...Array.from(previousByFiler.keys()),
  ]);

  let newCount = 0;
  let increasedCount = 0;
  let reducedCount = 0;
  let exitedCount = 0;
  let unchangedCount = 0;

  // Only count exits from managers that had a previous position but no current
  for (const cik of Array.from(allManagerCiks)) {
    const curr = currentByFiler.get(cik);
    const prev = previousByFiler.get(cik);

    // Only process managers who appear in current OR previous (both mapped)
    const activity = classifyActivity(curr?.shares, prev?.shares);
    if (activity === "new") newCount++;
    else if (activity === "increased") increasedCount++;
    else if (activity === "reduced") reducedCount++;
    else if (activity === "exited") {
      // Only count exits when prior quarter exists
      if (prevPeriodOfReport !== null) exitedCount++;
    } else unchangedCount++;
  }

  // Sort by current shares descending for concentration
  const sortedCurrent = Array.from(currentByFiler.values()).sort((a, b) => b.shares - a.shares);

  const topHolderPercent = computeConcentration(sortedCurrent, totalShares, 1);
  const top5HolderPercent = computeConcentration(sortedCurrent, totalShares, 5);
  const top10HolderPercent = computeConcentration(sortedCurrent, totalShares, 10);
  const concentrationClassification = classifyConcentration(top10HolderPercent);

  // Build largest-holders list
  const largestHolders: LargestHolder[] = sortedCurrent
    .slice(0, maxLargestHolders)
    .map((pos): LargestHolder => {
      const prev = previousByFiler.get(pos.cik);
      const qChange = prev ? pos.shares - prev.shares : null;
      const qChangePct =
        prev && prev.shares > 0 ? (pos.shares - prev.shares) / prev.shares : null;

      return {
        managerCik: pos.cik,
        managerName: pos.name,
        reportedShares: pos.shares,
        reportedValue: pos.value,
        quarterChangeShares: qChange,
        quarterChangePercent: qChangePct,
        activity: classifyActivity(pos.shares, prev?.shares) as LargestHolder["activity"],
        periodOfReport,
        filingDate: pos.filingDate,
      };
    });

  // Coverage and amendment status
  const coverageStatus = classifyCoverage(eligibleCount, totalCurrentHoldings);
  const amendmentStatus: AggregationResult["amendmentStatus"] = input.hasPendingAmendments
    ? "pending_amendments"
    : input.hasAmendments
    ? "has_amendments"
    : "clean";

  return {
    symbol,
    periodOfReport,
    periodLabel,
    reportingManagerCount: eligibleCount,
    aggregateReportedShares: totalShares > 0 ? totalShares : null,
    aggregateReportedValue: totalValue,
    prevPeriodOfReport,
    previousQuarterShares: prevTotalShares,
    previousQuarterValue: prevTotalValue,
    reportedSharesChange,
    reportedSharesChangePercent,
    newPositionCount: newCount,
    increasedPositionCount: increasedCount,
    reducedPositionCount: reducedCount,
    exitedPositionCount: exitedCount,
    unchangedCount,
    topHolderPercent,
    top5HolderPercent,
    top10HolderPercent,
    concentrationClassification,
    largestHolders,
    eligibleHoldingCount: eligibleCount,
    excludedHoldingCount: excludedCount,
    coverageStatus,
    amendmentStatus,
  };
}
