// Job Status Store — Sprint 2.3.6
//
// In-memory canonical background-job status model.
// Each long-running pipeline updates its status here so the Platform Health
// page can show operators a unified view without querying logs.
//
// Thread-safe for single-process Node.js. Does NOT survive restarts — this is
// operational state for the current session only.

export type JobStatus = "idle" | "running" | "completed" | "failed" | "partial";

export interface JobState {
  jobName:          string;
  status:           JobStatus;
  startedAt:        string | null;
  completedAt:      string | null;
  durationMs:       number | null;
  processed:        number | null;
  remaining:        number | null;
  lastSuccessAt:    string | null;
  lastErrorCode:    string | null;
  lastErrorMessage: string | null;
  nextScheduledRun: string | null;
  meta:             Record<string, unknown>;
}

export type JobName =
  | "scanner"
  | "ranking"
  | "intelligence_precompute"
  | "institutional_ingestion"
  | "mapping_pipeline"
  | "institutional_signal_rebuild"
  | "symbol_enrichment";

// ---------------------------------------------------------------------------
// Store — module-level singleton
// ---------------------------------------------------------------------------

const jobs = new Map<JobName, JobState>();

function defaultState(jobName: JobName): JobState {
  return {
    jobName,
    status:           "idle",
    startedAt:        null,
    completedAt:      null,
    durationMs:       null,
    processed:        null,
    remaining:        null,
    lastSuccessAt:    null,
    lastErrorCode:    null,
    lastErrorMessage: null,
    nextScheduledRun: null,
    meta:             {},
  };
}

export function getJobStatus(name: JobName): JobState {
  return jobs.get(name) ?? defaultState(name);
}

export function getAllJobStatuses(): Record<JobName, JobState> {
  const all: Partial<Record<JobName, JobState>> = {};
  const allNames: JobName[] = [
    "scanner",
    "ranking",
    "intelligence_precompute",
    "institutional_ingestion",
    "mapping_pipeline",
    "institutional_signal_rebuild",
    "symbol_enrichment",
  ];
  for (const name of allNames) {
    all[name] = getJobStatus(name);
  }
  return all as Record<JobName, JobState>;
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

export function markJobStarted(name: JobName, meta?: Record<string, unknown>): void {
  const prev = getJobStatus(name);
  jobs.set(name, {
    ...prev,
    jobName:          name,
    status:           "running",
    startedAt:        new Date().toISOString(),
    completedAt:      null,
    durationMs:       null,
    lastErrorCode:    null,
    lastErrorMessage: null,
    meta:             { ...prev.meta, ...meta },
  });
}

export function markJobCompleted(
  name: JobName,
  opts?: { processed?: number; remaining?: number; meta?: Record<string, unknown> },
): void {
  const prev = getJobStatus(name);
  const now  = new Date().toISOString();
  const durationMs = prev.startedAt
    ? new Date(now).getTime() - new Date(prev.startedAt).getTime()
    : null;
  jobs.set(name, {
    ...prev,
    status:        "completed",
    completedAt:   now,
    durationMs,
    lastSuccessAt: now,
    processed:     opts?.processed ?? prev.processed,
    remaining:     opts?.remaining ?? 0,
    meta:          { ...prev.meta, ...opts?.meta },
  });
}

export function markJobFailed(
  name: JobName,
  opts: { errorCode?: string; errorMessage?: string; meta?: Record<string, unknown> },
): void {
  const prev = getJobStatus(name);
  const now  = new Date().toISOString();
  const durationMs = prev.startedAt
    ? new Date(now).getTime() - new Date(prev.startedAt).getTime()
    : null;
  jobs.set(name, {
    ...prev,
    status:           "failed",
    completedAt:      now,
    durationMs,
    lastErrorCode:    opts.errorCode    ?? null,
    lastErrorMessage: (opts.errorMessage ?? "").slice(0, 500) || null,
    meta:             { ...prev.meta, ...opts?.meta },
  });
}

export function markJobPartial(
  name: JobName,
  opts?: { processed?: number; remaining?: number; errorMessage?: string; meta?: Record<string, unknown> },
): void {
  const prev = getJobStatus(name);
  const now  = new Date().toISOString();
  const durationMs = prev.startedAt
    ? new Date(now).getTime() - new Date(prev.startedAt).getTime()
    : null;
  jobs.set(name, {
    ...prev,
    status:           "partial",
    completedAt:      now,
    durationMs,
    processed:        opts?.processed ?? prev.processed,
    remaining:        opts?.remaining ?? null,
    lastErrorMessage: opts?.errorMessage?.slice(0, 500) ?? prev.lastErrorMessage,
    meta:             { ...prev.meta, ...opts?.meta },
  });
}

export function updateJobProgress(
  name: JobName,
  opts: { processed?: number; remaining?: number; meta?: Record<string, unknown> },
): void {
  const prev = getJobStatus(name);
  jobs.set(name, {
    ...prev,
    processed: opts.processed ?? prev.processed,
    remaining: opts.remaining ?? prev.remaining,
    meta:      { ...prev.meta, ...opts.meta },
  });
}

export function setJobNextScheduledRun(name: JobName, nextRun: string | null): void {
  const prev = getJobStatus(name);
  jobs.set(name, { ...prev, nextScheduledRun: nextRun });
}
