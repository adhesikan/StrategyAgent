// Institutional Intelligence — Quarter State Machine
//
// Pure computation: derives a meaningful operational state for a 13F quarter
// from raw run record + DB counts. No I/O.
//
// States (in typical progression order):
//   NOT_STARTED       → no ingestion run exists for this quarter
//   PARSING           → run is active, no holdings persisted yet
//   PERSISTING        → run is active, holdings accumulating
//   PARTIAL           → run stopped before persistence completion
//   READY_FOR_MAPPING → persistence complete, no qualified aggregates yet
//   AGGREGATING       → aggregation is running (run active, persistence done)
//   READY             → aggregates with coverage ≥ threshold
//   FAILED            → run failed with unrecoverable error

export type QuarterState =
  | "NOT_STARTED"
  | "PARSING"
  | "PERSISTING"
  | "PARTIAL"
  | "READY_FOR_MAPPING"
  | "AGGREGATING"
  | "READY"
  | "FAILED";

/**
 * Fraction of totalAccessions that must be stored before a quarter is
 * considered persistence-complete. Allows for a small number of filers
 * whose accessions SEC omits from a given bulk dataset.
 */
export const COMPLETION_THRESHOLD = 0.95;

/**
 * Minimum stored filings required before we consider a READY_FOR_MAPPING
 * transition. Prevents an empty dataset from being considered "complete".
 */
export const MIN_READY_FILINGS = 50;

/** Snapshot of the most recent ingestion run for a quarter. */
export interface RunSnapshot {
  status: string;
  filingCount: number;
  holdingCount: number;
  mappedCount: number;
  /** Set when totalAccessions was stored during the first parse. NULL means unknown. */
  totalAccessions: number | null;
  processedAccessions: number | null;
  lastHeartbeatAt: Date | null;
  startedAt: Date;
  errorCode: string | null;
}

/** Full progress summary for a quarter. */
export interface QuarterProgress {
  quarter: string;
  state: QuarterState;
  progressPercent: number;
  processedAccessions: number | null;
  totalAccessions: number | null;
  storedFilings: number;
  storedHoldings: number;
  lastHeartbeat: Date | null;
  lastScheduledRun: Date | null;
  resumable: boolean;
  ready: boolean;
}

/**
 * Derive the operational state for a quarter.
 *
 * @param latestRun       Most-recent ingestion run record (null = never started)
 * @param storedFilingCount Count of distinct accessions in institutional_13f_filings for this period
 * @param hasAggregatesWithCoverage True when institutional_quarterly_aggregates has rows with
 *                         eligibleHoldingCount > 0 (mapped holdings exist)
 */
export function computeQuarterState(
  latestRun: RunSnapshot | null,
  storedFilingCount: number,
  hasAggregatesWithCoverage: boolean,
): QuarterState {
  if (!latestRun) return "NOT_STARTED";

  const { status, holdingCount, totalAccessions } = latestRun;

  // Active run
  if (status === "running") {
    if (holdingCount > 0) return "PERSISTING";
    return "PARSING";
  }

  // Hard failures
  if (status === "failed" || status === "empty_parse_failure") return "FAILED";

  // Dataset not yet published — try again tomorrow
  if (status === "empty_not_published") return "NOT_STARTED";

  // Explicit partial
  if (status === "partial") return "PARTIAL";

  // Completed run — validate that persistence is actually done
  if (status === "completed") {
    // Conservative: if we never stored totalAccessions, we can't confirm completeness.
    // Treat as PARTIAL so the daily job retries and stores it.
    if (totalAccessions === null) return "PARTIAL";

    // Not enough filings stored vs. what we expect from the full dataset
    if (storedFilingCount < totalAccessions * COMPLETION_THRESHOLD) return "PARTIAL";

    // Persistence confirmed complete
    if (!hasAggregatesWithCoverage) return "READY_FOR_MAPPING";
    return "READY";
  }

  // skipped_locked, skipped_disabled → not started from this quarter's perspective
  return "NOT_STARTED";
}

/** True when the daily job should attempt (or resume) processing for this quarter. */
export function isResumable(state: QuarterState): boolean {
  return state === "NOT_STARTED" || state === "PARTIAL" || state === "FAILED";
}

/** True when this quarter is fully ready for the public UI. */
export function isReady(state: QuarterState): boolean {
  return state === "READY";
}

/** Human-readable label for display. */
export function quarterStateLabel(state: QuarterState): string {
  const labels: Record<QuarterState, string> = {
    NOT_STARTED: "Not started",
    PARSING: "Parsing SEC archive",
    PERSISTING: "Persisting holdings",
    PARTIAL: "Partial — resumable",
    READY_FOR_MAPPING: "Awaiting aggregation",
    AGGREGATING: "Aggregating",
    READY: "Ready",
    FAILED: "Failed",
  };
  return labels[state] ?? state;
}
