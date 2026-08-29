// Client-side types for Institutional Intelligence — Sprint 2.2.5.
// Mirrors the server InstitutionalApiResponse shape.
// Keeps all terminology in sync with the accuracy spec.

export type InstitutionalStatus = "available" | "partial" | "unavailable" | "stale" | "error";

export type TrendState =
  | "increasing"
  | "stable"
  | "decreasing"
  | "mixed"
  | "insufficient_history"
  | "unavailable";

export type EvidenceAlignmentState = "supports" | "neutral" | "weakens" | "unavailable";

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
  activity: "new" | "increased" | "reduced" | "unchanged" | "exited";
  periodOfReport: string;
  filingDate: string;
}

export interface HistoricalQuarterEntry {
  periodLabel: string;
  periodOfReport: string;
  aggregateReportedShares: number | null;
  reportingManagerCount: number;
  trend: string;
}

export interface InstitutionalData {
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
  largestReportedHolders: LargestHolderEntry[];
  evidenceAlignment: {
    state: EvidenceAlignmentState;
    label: string;
    reasons: string[];
  };
  limitations: string[];
  sourceLinks: Array<{ label: string; url: string }>;
  historicalQuarters: HistoricalQuarterEntry[];
}

// ---------------------------------------------------------------------------
// Pure display helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Format a share count with suffix (e.g. 12.4M, 340K). */
export function formatShares(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Format a canonical reported value in US dollars for display. */
export function formatReportedValueDollars(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * @deprecated Use formatReportedValueDollars. Retained for import compatibility.
 */
export function formatValueThousands(n: number | null | undefined): string {
  return formatReportedValueDollars(n);
}

/** Format a QoQ percent change with sign. */
export function formatPctChange(n: number | null | undefined): string {
  if (n == null) return "N/A";
  const pct = n * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Format a concentration percent (0–1 range). */
export function formatConcentrationPct(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

/** Return CSS color class for trend state. */
export function trendColorClass(trend: TrendState | string): string {
  switch (trend) {
    case "increasing": return "text-emerald-400";
    case "stable": return "text-sky-400";
    case "decreasing": return "text-rose-400";
    case "mixed": return "text-amber-400";
    default: return "text-muted-foreground";
  }
}

/** Return CSS color class for evidence alignment state. */
export function alignmentColorClass(state: EvidenceAlignmentState | string): string {
  switch (state) {
    case "supports": return "text-emerald-400";
    case "weakens": return "text-rose-400";
    case "neutral": return "text-sky-400";
    default: return "text-muted-foreground";
  }
}

/** Return activity badge label and style. */
export function activityBadge(activity: string): { label: string; className: string } {
  switch (activity) {
    case "new":      return { label: "New",       className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" };
    case "increased":return { label: "Increased", className: "text-sky-300 border-sky-500/40 bg-sky-500/10" };
    case "reduced":  return { label: "Reduced",   className: "text-amber-300 border-amber-500/40 bg-amber-500/10" };
    case "exited":   return { label: "Exited",    className: "text-rose-300 border-rose-500/40 bg-rose-500/10" };
    default:         return { label: "Unchanged", className: "text-muted-foreground border-border/40" };
  }
}

/** Format an ISO date string to "MMM D, YYYY". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Format a period of report to "YYYY-QN (MMM DD, YYYY)". */
export function formatPeriodOfReport(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${year}-Q${q} (${formatted})`;
}
