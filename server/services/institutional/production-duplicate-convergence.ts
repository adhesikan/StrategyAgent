/**
 * Guarded convergence for legacy 13F accession duplicates.  This module is
 * deliberately independent of normal ingestion: callers must supply the SEC
 * replay operation, which keeps the existing SEC parser/fetcher authoritative.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { normalizeAccession } from "./sec-13f-bulk-parser";
import type { AuthoritativeFilingMetadata, HoldingFingerprint, StoredFilingMetadata } from "./historical-filing-period-repair";
import { filingIndexUrl, secFetchDetailed } from "./sec-client";
import { parseInfoTableXml, selectInfoTableDocument } from "./sec-13f-parser";
import { inspectInfoTableDocument, normalizeSourceHoldingValue, validateInfoTableCompleteness } from "./production-source-identity-diagnostic";

export const DUPLICATE_CONVERGENCE_LOCK_KEY = 774_412_007;
export const DUPLICATE_CONVERGENCE_CONFIRMATION = "CONVERGE_PRODUCTION_13F_DUPLICATES";
export const CONVERGENCE_JOURNAL_TABLE = "institutional_convergence_journal";

export interface DuplicateGroup {
  canonicalAccession: string;
  rows: StoredFilingMetadata[];
  fingerprints: Map<string, HoldingFingerprint>;
  authoritative: AuthoritativeFilingMetadata | null;
  targets: Array<{ symbol: string; periodOfReport: string }>;
  replayValidation?: {
    sourceUrl: string;
    sourceChecksum: string;
    holdingCount: number;
  } | null;
}
export type ConvergenceAction =
  | "SAFE_CLEANUP"
  | "AUTHORITATIVE_REPLAY"
  | "BLOCKED"
  /** Replay-shaped group that is absent from the frozen validation manifest —
   * the validated population no longer matches reality, revalidate. */
  | "PLAN_CHANGED_REVALIDATION_REQUIRED";
export interface ConvergenceOperation {
  canonicalAccession: string; action: ConvergenceAction; survivorId: string | null;
  survivorRawAccession: string | null;
  filerCik: string | null;
  authoritative: AuthoritativeFilingMetadata | null;
  filerName: string | null;
  holdingSourceRawAccession: string | null;
  duplicateIds: string[]; affectedHoldings: number; periods: string[]; symbols: string[];
  targets: Array<{ symbol: string; periodOfReport: string }>;
  replaySourceUrl: string | null;
  replaySourceChecksum: string | null;
  replayHoldingCount: number | null;
  blocker: string | null;
}
export interface DuplicateConvergencePlan {
  mode: "DRY_RUN" | "APPLY";
  totalCanonicalDuplicateGroups: number; safeCleanupGroups: number; replayGroups: number; blockedGroups: number;
  planChangedGroups: number;
  safeCleanupOperations: number; replayOperations: number; affectedFilings: number; affectedHoldings: number;
  affectedPeriods: string[]; affectedSymbols: string[];
  downstreamRebuildScope: {
    targets: number;
    periods: string[];
    symbols: string[];
    symbolPeriods: Array<{ symbol: string; periodOfReport: string }>;
  };
  canonicalUniquenessReady: boolean; planHash: string; productionApplyReady: boolean;
  operations: ConvergenceOperation[];
}

export type ConvergenceJournalStatus =
  | "PLANNED"
  | "MUTATION_IN_PROGRESS"
  | "MUTATION_COMMITTED"
  | "MATERIALIZATION_IN_PROGRESS"
  | "COMPLETED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL";

export type ConvergenceMaterializationStage =
  | "EFFECTIVENESS_RECOMPUTED"
  | "AGGREGATES"
  | "SIGNALS"
  | "SNAPSHOTS";

export interface ConvergenceJournalRecord {
  id: string;
  planHash: string;
  status: ConvergenceJournalStatus;
  canonicalAccessions: string[];
  affectedPeriods: string[];
  affectedSymbols: string[];
  targets: Array<{ symbol: string; periodOfReport: string }>;
  mutationCompleted: boolean;
  materializationCompleted: boolean;
  lastCompletedStage: ConvergenceMaterializationStage | null;
  completedAggregateTargets: string[];
  completedSignalSymbols: string[];
  failureStage: string | null;
  failureReason: string | null;
  attemptCount: number;
  activeAttemptId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConvergenceJournalStore {
  create(record: Omit<ConvergenceJournalRecord, "id" | "createdAt" | "updatedAt">): Promise<ConvergenceJournalRecord>;
  update(id: string, patch: Partial<ConvergenceJournalRecord>): Promise<ConvergenceJournalRecord>;
}

export interface ConvergenceMaterializationDependencies {
  recomputeAggregate: (symbol: string, periodOfReport: string, previousPeriod: string | null) => Promise<unknown>;
  rebuildSignal: (symbol: string) => Promise<unknown>;
  refreshSnapshots: (options: { persist: boolean }) => Promise<unknown>;
}

function previousQuarterEnd(periodOfReport: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodOfReport);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month === 3) return `${year - 1}-12-31`;
  if (month === 6) return `${year}-03-31`;
  if (month === 9) return `${year}-06-30`;
  if (month === 12) return `${year}-09-30`;
  return null;
}

function targetKey(target: { symbol: string; periodOfReport: string }): string {
  return `${target.symbol}:${target.periodOfReport}`;
}

function sanitizeJournalFailure(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/https?:\/\/\S+/gi, "[url]").replace(/\s+/g, " ").slice(0, 200);
}

function assertJournalScope(record: ConvergenceJournalRecord, plan: DuplicateConvergencePlan): void {
  if (
    record.planHash !== plan.planHash ||
    stable(record.canonicalAccessions) !== stable(
      plan.operations.filter((operation) => operation.action !== "BLOCKED")
        .map((operation) => operation.canonicalAccession),
    )
  ) {
    throw new Error("CONVERGENCE_JOURNAL_SCOPE_MISMATCH");
  }
}

/**
 * Resume only the post-commit work recorded in the journal. Each target and
 * symbol is checkpointed before advancing, so a process exit can restart at
 * the first incomplete item without looking for duplicate filings again.
 */
export async function resumeConvergenceMaterialization(
  journal: ConvergenceJournalRecord,
  store: ConvergenceJournalStore,
  dependencies: ConvergenceMaterializationDependencies,
): Promise<ConvergenceJournalRecord> {
  if (journal.status === "COMPLETED") return journal;
  if (!journal.mutationCompleted) throw new Error("CONVERGENCE_MUTATION_NOT_COMMITTED");
  if (journal.status === "FAILED_TERMINAL") throw new Error("CONVERGENCE_JOURNAL_TERMINAL");

  let current = await store.update(journal.id, {
    status: "MATERIALIZATION_IN_PROGRESS",
    failureStage: null,
    failureReason: null,
    attemptCount: journal.attemptCount + 1,
  });
  let activeStage: ConvergenceMaterializationStage = "AGGREGATES";
  try {
    const aggregateDone = new Set(current.completedAggregateTargets);
    for (const target of current.targets) {
      if (aggregateDone.has(targetKey(target))) continue;
      activeStage = "AGGREGATES";
      await dependencies.recomputeAggregate(
        target.symbol,
        target.periodOfReport,
        previousQuarterEnd(target.periodOfReport),
      );
      aggregateDone.add(targetKey(target));
      current = await store.update(current.id, {
        status: "MATERIALIZATION_IN_PROGRESS",
        lastCompletedStage: "AGGREGATES",
        completedAggregateTargets: Array.from(aggregateDone).sort(),
      });
    }

    const signalDone = new Set(current.completedSignalSymbols);
    for (const symbol of current.affectedSymbols) {
      if (signalDone.has(symbol)) continue;
      activeStage = "SIGNALS";
      await dependencies.rebuildSignal(symbol);
      signalDone.add(symbol);
      current = await store.update(current.id, {
        status: "MATERIALIZATION_IN_PROGRESS",
        lastCompletedStage: "SIGNALS",
        completedSignalSymbols: Array.from(signalDone).sort(),
      });
    }

    if (current.affectedSymbols.length > 0 && current.lastCompletedStage !== "SNAPSHOTS") {
      activeStage = "SNAPSHOTS";
      await dependencies.refreshSnapshots({ persist: true });
      current = await store.update(current.id, {
        status: "COMPLETED",
        materializationCompleted: true,
        lastCompletedStage: "SNAPSHOTS",
        failureStage: null,
        failureReason: null,
        activeAttemptId: null,
        leaseExpiresAt: null,
      });
    } else {
      current = await store.update(current.id, {
        status: "COMPLETED",
        materializationCompleted: true,
        failureStage: null,
        failureReason: null,
        activeAttemptId: null,
        leaseExpiresAt: null,
      });
    }
    return current;
  } catch (error) {
    current = await store.update(current.id, {
      status: "FAILED_RETRYABLE",
      failureStage: activeStage,
      failureReason: sanitizeJournalFailure(error),
      attemptCount: current.attemptCount,
      activeAttemptId: null,
      leaseExpiresAt: null,
    });
    throw error;
  }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sameFingerprint(a: HoldingFingerprint, b: HoldingFingerprint) {
  return a.count === b.count && a.digest === b.digest;
}
/** Pure, deterministic planner; no database or SEC calls occur here. */
export function buildDuplicateConvergencePlan(
  groups: DuplicateGroup[],
  mode: "DRY_RUN" | "APPLY" = "DRY_RUN",
  options: { requireReplayValidation?: boolean; manifestAccessions?: ReadonlySet<string> } = {},
): DuplicateConvergencePlan {
  const operations: ConvergenceOperation[] = [];
  for (const group of [...groups].sort((a, b) => a.canonicalAccession.localeCompare(b.canonicalAccession))) {
    if (group.rows.length < 2) continue;
    const accession = normalizeAccession(group.canonicalAccession);
    const rows = [...group.rows].sort((a, b) => (a.rawAccession === accession ? 0 : 1) - (b.rawAccession === accession ? 0 : 1) || a.id.localeCompare(b.id));
    const prints = rows.map((row) => group.fingerprints.get(row.rawAccession));
    const metadataValid = !!group.authoritative && rows.every((r) =>
      r.filerCik === group.authoritative!.filerCik && r.filingDate === group.authoritative!.filingDate &&
      r.periodOfReport === group.authoritative!.periodOfReport &&
      r.filingType.trim().toUpperCase() === group.authoritative!.filingType.trim().toUpperCase() &&
      r.amendmentFlag === group.authoritative!.amendmentFlag);
    const nonEmpty = prints.filter((item): item is HoldingFingerprint => !!item && item.count > 0);
    const safe = /^\d{18}$/.test(accession) && metadataValid && prints.length === rows.length &&
      (nonEmpty.length <= 1 || nonEmpty.every((p) => sameFingerprint(p, nonEmpty[0])));
    const replayCandidate = !safe && !!group.authoritative && /^\d{18}$/.test(accession);
    const replayValidated = !!group.replayValidation;
    // A manifest gate (DRY_RUN / APPLY): a replay-shaped group that is not in
    // the frozen validated population is PLAN_CHANGED, not a generic block.
    const manifestGated = options.manifestAccessions !== undefined;
    const inManifest = !manifestGated || options.manifestAccessions!.has(accession);
    const action: ConvergenceAction = safe
      ? "SAFE_CLEANUP"
      : replayCandidate && (!options.requireReplayValidation || replayValidated)
        ? "AUTHORITATIVE_REPLAY"
        : replayCandidate && manifestGated && !inManifest
          ? "PLAN_CHANGED_REVALIDATION_REQUIRED"
          : "BLOCKED";
    const holdingSource = safe
      ? rows.find((row) => (group.fingerprints.get(row.rawAccession)?.count ?? 0) > 0) ?? rows[0]
      : null;
    const targets = Array.from(new Map(group.targets.map((target) => [
      `${target.symbol}:${target.periodOfReport}`,
      { symbol: target.symbol.trim().toUpperCase(), periodOfReport: target.periodOfReport },
    ])).values()).sort((a, b) =>
      a.symbol.localeCompare(b.symbol) || a.periodOfReport.localeCompare(b.periodOfReport));
    operations.push({ canonicalAccession: accession, action, survivorId: safe ? rows[0].id : null, survivorRawAccession: safe ? rows[0].rawAccession : null, filerCik: group.authoritative?.filerCik ?? null, authoritative: group.authoritative,
      filerName: rows[0]?.filerName ?? null, holdingSourceRawAccession: holdingSource?.rawAccession ?? null,
      duplicateIds: rows.slice(safe ? 1 : 0).map(r => r.id), affectedHoldings: prints.reduce((n, p) => n + (p?.count ?? 0), 0),
      periods: Array.from(new Set([...rows.map(r => r.periodOfReport), group.authoritative?.periodOfReport].filter(Boolean) as string[])).sort(),
      symbols: Array.from(new Set(targets.map((target) => target.symbol))).sort(), targets,
      replaySourceUrl: group.replayValidation?.sourceUrl ?? null,
      replaySourceChecksum: group.replayValidation?.sourceChecksum ?? null,
      replayHoldingCount: group.replayValidation?.holdingCount ?? null,
      blocker: action === "BLOCKED"
        ? replayCandidate ? "AUTHORITATIVE_REPLAY_NOT_VALIDATED" : "AUTHORITATIVE_SEC_IDENTITY_REQUIRED"
        : action === "PLAN_CHANGED_REVALIDATION_REQUIRED"
          ? "PLAN_CHANGED_REVALIDATION_REQUIRED"
          : null });
  }
  const filtered = operations.filter(o => o.action === "SAFE_CLEANUP" || o.action === "AUTHORITATIVE_REPLAY");
  const periods = Array.from(new Set(filtered.flatMap(o => o.periods))).sort();
  const symbols = Array.from(new Set(filtered.flatMap(o => o.symbols))).sort();
  const targets = Array.from(new Map(filtered.flatMap((operation) => operation.targets).map((target) => [
    `${target.symbol}:${target.periodOfReport}`,
    target,
  ])).values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol) || a.periodOfReport.localeCompare(b.periodOfReport));
  const body = { operations, affectedPeriods: periods, affectedSymbols: symbols };
  const safe = operations.filter(o => o.action === "SAFE_CLEANUP");
  const replay = operations.filter(o => o.action === "AUTHORITATIVE_REPLAY");
  const blocked = operations.filter(o => o.action === "BLOCKED");
  const planChanged = operations.filter(o => o.action === "PLAN_CHANGED_REVALIDATION_REQUIRED");
  const applyReady = blocked.length === 0 && planChanged.length === 0;
  return { mode, totalCanonicalDuplicateGroups: operations.length, safeCleanupGroups: safe.length, replayGroups: replay.length, blockedGroups: blocked.length,
    planChangedGroups: planChanged.length,
    safeCleanupOperations: safe.length, replayOperations: replay.length, affectedFilings: filtered.reduce((n,o) => n + o.duplicateIds.length + 1, 0),
    affectedHoldings: filtered.reduce((n,o) => n + o.affectedHoldings, 0), affectedPeriods: periods, affectedSymbols: symbols,
    downstreamRebuildScope: { targets: targets.length, periods, symbols, symbolPeriods: targets }, canonicalUniquenessReady: applyReady,
    planHash: createHash("sha256").update(stable(body)).digest("hex"), productionApplyReady: applyReady && operations.length > 0, operations };
}

export function validateDuplicateConvergenceEnvironment(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  if (env.NODE_ENV !== "production" || env.RAILWAY_ENVIRONMENT_NAME !== "production") errors.push("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  for (const k of ["RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID", "DATABASE_URL"]) if (!env[k]) errors.push(`${k}_REQUIRED`);
  if (env.EXTERNAL_DATABASE_URL) errors.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  return errors;
}
export function getDuplicateConvergenceApplyGuardIssues(plan: DuplicateConvergencePlan, input: { apply: boolean; planHash: string | null; confirm: string | null }): string[] {
  if (!input.apply) return [];
  const issues: string[] = [];
  if (input.planHash !== plan.planHash) issues.push(input.planHash ? "PLAN_HASH_MISMATCH" : "PLAN_HASH_REQUIRED");
  if (input.confirm !== DUPLICATE_CONVERGENCE_CONFIRMATION) issues.push("CONFIRMATION_REQUIRED");
  if (!plan.productionApplyReady) issues.push("PLAN_NOT_APPLY_READY");
  return issues;
}
export interface ConvergenceExecutor { execute(query: unknown): Promise<unknown>; transaction?<T>(fn: (tx: ConvergenceExecutor) => Promise<T>): Promise<T> }
export interface DuplicateConvergenceDependencies {
  replay: (tx: ConvergenceExecutor, operation: ConvergenceOperation) => Promise<void>;
  materialize: (targets: Array<{symbol: string; periodOfReport: string}>) => Promise<unknown>;
  revalidatePlan?: (tx: ConvergenceExecutor) => Promise<string>;
}
export interface DurableDuplicateConvergenceDependencies {
  replay: DuplicateConvergenceDependencies["replay"];
  revalidatePlan?: DuplicateConvergenceDependencies["revalidatePlan"];
  materialization: ConvergenceMaterializationDependencies;
}

function resultRows(result: any): any[] {
  return Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : [];
}

function targetArray(value: unknown): Array<{ symbol: string; periodOfReport: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as any).symbol !== "string" ||
      typeof (item as any).periodOfReport !== "string"
    ) return [];
    return [{
      symbol: String((item as any).symbol),
      periodOfReport: String((item as any).periodOfReport),
    }];
  });
}

function parseJournalRow(row: any): ConvergenceJournalRecord {
  if (!row || typeof row !== "object") throw new Error("CONVERGENCE_JOURNAL_INVALID");
  const record: ConvergenceJournalRecord = {
    id: String(row.id ?? ""),
    planHash: String(row.planHash ?? row.plan_hash ?? ""),
    status: String(row.status ?? "") as ConvergenceJournalStatus,
    canonicalAccessions: stringArray(row.canonicalAccessions ?? row.canonical_accessions),
    affectedPeriods: stringArray(row.affectedPeriods ?? row.affected_periods),
    affectedSymbols: stringArray(row.affectedSymbols ?? row.affected_symbols),
    targets: targetArray(row.targets),
    mutationCompleted: Boolean(row.mutationCompleted ?? row.mutation_completed),
    materializationCompleted: Boolean(row.materializationCompleted ?? row.materialization_completed),
    lastCompletedStage: (row.lastCompletedStage ?? row.last_completed_stage ?? null) as ConvergenceMaterializationStage | null,
    completedAggregateTargets: stringArray(row.completedAggregateTargets ?? row.completed_aggregate_targets),
    completedSignalSymbols: stringArray(row.completedSignalSymbols ?? row.completed_signal_symbols),
    failureStage: row.failureStage ?? row.failure_stage ?? null,
    failureReason: row.failureReason ?? row.failure_reason ?? null,
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    activeAttemptId: row.activeAttemptId ?? row.active_attempt_id ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? row.lease_expires_at
      ? new Date(row.leaseExpiresAt ?? row.lease_expires_at).toISOString()
      : null,
    createdAt: new Date(row.createdAt ?? row.created_at).toISOString(),
    updatedAt: new Date(row.updatedAt ?? row.updated_at).toISOString(),
  };
  const validStatuses: ConvergenceJournalStatus[] = [
    "PLANNED", "MUTATION_IN_PROGRESS", "MUTATION_COMMITTED",
    "MATERIALIZATION_IN_PROGRESS", "COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL",
  ];
  if (
    !record.id ||
    !/^[a-f0-9]{64}$/.test(record.planHash) ||
    !validStatuses.includes(record.status) ||
    !Number.isInteger(record.attemptCount) ||
    record.attemptCount < 0
  ) {
    throw new Error("CONVERGENCE_JOURNAL_INVALID");
  }
  if (getConvergenceJournalConsistencyIssues(record).length > 0) {
    throw new Error("CONVERGENCE_JOURNAL_INCONSISTENT");
  }
  return record;
}

export function getConvergenceJournalConsistencyIssues(
  record: ConvergenceJournalRecord,
): string[] {
  const issues: string[] = [];
  const stageValues: ConvergenceMaterializationStage[] = [
    "EFFECTIVENESS_RECOMPUTED", "AGGREGATES", "SIGNALS", "SNAPSHOTS",
  ];
  if (record.lastCompletedStage && !stageValues.includes(record.lastCompletedStage)) {
    issues.push("INVALID_LAST_COMPLETED_STAGE");
  }
  const keys = record.targets.map(targetKey);
  if (
    new Set(keys).size !== keys.length ||
    record.targets.some((target) =>
      target.symbol !== target.symbol.trim().toUpperCase() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(target.periodOfReport))
  ) {
    issues.push("INVALID_TARGET_SCOPE");
  }
  const targetSet = new Set(keys);
  if (record.completedAggregateTargets.some((key) => !targetSet.has(key))) {
    issues.push("UNKNOWN_COMPLETED_AGGREGATE_TARGET");
  }
  const symbolSet = new Set(record.affectedSymbols);
  if (record.completedSignalSymbols.some((symbol) => !symbolSet.has(symbol))) {
    issues.push("UNKNOWN_COMPLETED_SIGNAL_SYMBOL");
  }
  if (
    record.status === "COMPLETED" &&
    (!record.mutationCompleted || !record.materializationCompleted)
  ) {
    issues.push("COMPLETED_FLAGS_INVALID");
  }
  if (
    record.materializationCompleted &&
    record.status !== "COMPLETED"
  ) {
    issues.push("MATERIALIZATION_STATUS_INVALID");
  }
  if (
    ["MUTATION_COMMITTED", "MATERIALIZATION_IN_PROGRESS", "FAILED_RETRYABLE", "COMPLETED"]
      .includes(record.status) &&
    !record.mutationCompleted
  ) {
    issues.push("MUTATION_STATUS_INVALID");
  }
  return issues;
}

export async function readConvergenceJournal(
  executor: ConvergenceExecutor,
  planHash: string,
): Promise<ConvergenceJournalRecord | null> {
  const result = await executor.execute(sql`
    SELECT id, plan_hash AS "planHash", status,
           canonical_accessions AS "canonicalAccessions",
           affected_periods AS "affectedPeriods",
           affected_symbols AS "affectedSymbols", targets,
           mutation_completed AS "mutationCompleted",
           materialization_completed AS "materializationCompleted",
           last_completed_stage AS "lastCompletedStage",
           completed_aggregate_targets AS "completedAggregateTargets",
           completed_signal_symbols AS "completedSignalSymbols",
           failure_stage AS "failureStage", failure_reason AS "failureReason",
           attempt_count AS "attemptCount",
           active_attempt_id AS "activeAttemptId",
           lease_expires_at AS "leaseExpiresAt",
           created_at AS "createdAt", updated_at AS "updatedAt"
      FROM institutional_convergence_journal
     WHERE plan_hash = ${planHash}
     LIMIT 1
  `);
  const rows = resultRows(result);
  return rows.length === 0 ? null : parseJournalRow(rows[0]);
}

export function createDatabaseConvergenceJournalStore(
  executor: ConvergenceExecutor,
): ConvergenceJournalStore {
  return {
    async create(input) {
      const result = await executor.execute(sql`
        INSERT INTO institutional_convergence_journal (
          plan_hash, status, canonical_accessions, affected_periods,
          affected_symbols, targets, mutation_completed,
          materialization_completed, last_completed_stage,
          completed_aggregate_targets, completed_signal_symbols,
          failure_stage, failure_reason, attempt_count,
          active_attempt_id, lease_expires_at
        ) VALUES (
          ${input.planHash}, ${input.status},
          CAST(${JSON.stringify(input.canonicalAccessions)} AS jsonb),
          CAST(${JSON.stringify(input.affectedPeriods)} AS jsonb),
          CAST(${JSON.stringify(input.affectedSymbols)} AS jsonb),
          CAST(${JSON.stringify(input.targets)} AS jsonb),
          ${input.mutationCompleted}, ${input.materializationCompleted},
          ${input.lastCompletedStage},
          CAST(${JSON.stringify(input.completedAggregateTargets)} AS jsonb),
          CAST(${JSON.stringify(input.completedSignalSymbols)} AS jsonb),
          ${input.failureStage}, ${input.failureReason}, ${input.attemptCount},
          ${input.activeAttemptId}, ${input.leaseExpiresAt}
        )
        RETURNING *
      `);
      return parseJournalRow(resultRows(result)[0]);
    },
    async update(id, patch) {
      const existingResult = await executor.execute(sql`
        SELECT * FROM institutional_convergence_journal WHERE id = ${id} FOR UPDATE
      `);
      const existing = parseJournalRow(resultRows(existingResult)[0]);
      const next = { ...existing, ...patch, id: existing.id, planHash: existing.planHash };
      const result = await executor.execute(sql`
        UPDATE institutional_convergence_journal
           SET status = ${next.status},
               canonical_accessions = CAST(${JSON.stringify(next.canonicalAccessions)} AS jsonb),
               affected_periods = CAST(${JSON.stringify(next.affectedPeriods)} AS jsonb),
               affected_symbols = CAST(${JSON.stringify(next.affectedSymbols)} AS jsonb),
               targets = CAST(${JSON.stringify(next.targets)} AS jsonb),
               mutation_completed = ${next.mutationCompleted},
               materialization_completed = ${next.materializationCompleted},
               last_completed_stage = ${next.lastCompletedStage},
               completed_aggregate_targets = CAST(${JSON.stringify(next.completedAggregateTargets)} AS jsonb),
               completed_signal_symbols = CAST(${JSON.stringify(next.completedSignalSymbols)} AS jsonb),
               failure_stage = ${next.failureStage},
               failure_reason = ${next.failureReason},
               attempt_count = ${next.attemptCount},
               active_attempt_id = ${next.activeAttemptId},
               lease_expires_at = ${next.leaseExpiresAt},
               updated_at = NOW()
         WHERE id = ${id}
         RETURNING *
      `);
      return parseJournalRow(resultRows(result)[0]);
    },
  };
}

export interface AuthoritativeReplaySource {
  indexUrl: string; sourceUrl: string; sourceChecksum: string;
  holdings: ReturnType<typeof parseInfoTableXml>["holdings"];
}

async function readTargetsForCanonicalAccessions(
  executor: ConvergenceExecutor,
  canonicalAccessions: string[],
): Promise<Array<{ symbol: string; periodOfReport: string }>> {
  if (canonicalAccessions.length === 0) return [];
  const values = sql.join(canonicalAccessions.map((accession) => sql`${accession}`), sql`, `);
  const targetResult: any = await executor.execute(sql`
    SELECT DISTINCT UPPER(mapped_symbol) AS symbol,
           period_of_report::text AS "periodOfReport"
      FROM institutional_13f_holdings
     WHERE accession_number IN (${values})
       AND mapped_symbol IS NOT NULL
     ORDER BY symbol, "periodOfReport"
  `);
  return resultRows(targetResult).map((row) => ({
    symbol: String(row.symbol),
    periodOfReport: String(row.periodOfReport),
  }));
}
/** Uses the established strict SEC document selection/parser path; no fuzzy lookup. */
export type ReplaySourceFetcher = typeof secFetchDetailed;

export async function loadAuthoritativeReplaySource(
  operation: ConvergenceOperation,
  fetchDetailed: ReplaySourceFetcher = secFetchDetailed,
): Promise<AuthoritativeReplaySource> {
  const metadata = operation.authoritative;
  // Identity is bound to the canonical 18-digit accession.  The accession
  // prefix is the EDGAR submitter id (frequently a filing agent) and is NOT
  // guaranteed to equal the 13F filing-manager CIK for agent-submitted
  // filings, so it must not be asserted against metadata.filerCik.  The
  // manager CIK only has to be a well-formed 10-digit value, and it remains
  // the authoritative SEC manager CIK used for the archive URL and the
  // persisted filing row.
  if (
    !metadata ||
    metadata.canonicalAccession !== operation.canonicalAccession ||
    !/^\d{10}$/.test(metadata.filerCik)
  ) {
    throw new Error("AUTHORITATIVE_REPLAY_IDENTITY_INVALID");
  }
  const indexUrl = filingIndexUrl(metadata.filerCik, metadata.canonicalAccession);
  const index = await fetchDetailed(indexUrl);
  const selection = selectInfoTableDocument(index.text, metadata.filerCik, metadata.canonicalAccession);
  if (!selection.path) throw new Error("AUTHORITATIVE_INFOTABLE_NOT_UNIQUE");
  const sourceUrl = new URL(selection.path, "https://www.sec.gov").toString();
  const document = await fetchDetailed(sourceUrl);
  const diagnostic = inspectInfoTableDocument(document.text, document);
  if (diagnostic.rejectionCode) throw new Error(`AUTHORITATIVE_INFOTABLE_INVALID:${diagnostic.rejectionCode}`);
  const parsed = parseInfoTableXml(document.text);
  if (!validateInfoTableCompleteness(document.text, parsed).complete) throw new Error("AUTHORITATIVE_INFOTABLE_INCOMPLETE");
  if (parsed.holdings.length === 0) throw new Error("AUTHORITATIVE_INFOTABLE_EMPTY");
  return { indexUrl, sourceUrl, sourceChecksum: createHash("sha256").update(document.text).digest("hex"),
    holdings: parsed.holdings.map(row => normalizeSourceHoldingValue(row, metadata.filingDate).holding) };
}
async function executeConvergenceMutation(
  tx: ConvergenceExecutor,
  plan: DuplicateConvergencePlan,
  deps: Pick<DuplicateConvergenceDependencies, "replay" | "revalidatePlan">,
  hooks: {
    beforeMutation?: () => Promise<void>;
    afterMutation?: () => Promise<void>;
  } = {},
): Promise<void> {
  await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
  const lockResult: any = await tx.execute(
    sql`SELECT pg_try_advisory_xact_lock(${DUPLICATE_CONVERGENCE_LOCK_KEY}::bigint) AS locked`,
  );
  const lockRows = lockResult?.rows ?? lockResult;
  if (lockRows?.[0]?.locked !== true) throw new Error("DUPLICATE_CONVERGENCE_LOCK_HELD");
  if (deps.revalidatePlan && await deps.revalidatePlan(tx) !== plan.planHash) throw new Error("STALE_PLAN_HASH");
  await hooks.beforeMutation?.();
  for (const operation of plan.operations) {
    if (operation.action === "BLOCKED") throw new Error("BLOCKED_OPERATION");
    if (operation.action === "PLAN_CHANGED_REVALIDATION_REQUIRED") throw new Error("PLAN_CHANGED_OPERATION");
    if (operation.action === "AUTHORITATIVE_REPLAY") await deps.replay(tx, operation); // validates/persists first
    if (operation.action === "SAFE_CLEANUP") {
      const holdingSource = operation.holdingSourceRawAccession;
      if (!holdingSource) throw new Error("SAFE_CLEANUP_HOLDING_SOURCE_MISSING");
      // Empty copies are disposable; identical non-empty copies are reduced
      // to one donor before the donor is canonicalized.
      await tx.execute(sql`
        DELETE FROM institutional_13f_holdings
         WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession}
           AND accession_number <> ${holdingSource}
      `);
      await tx.execute(sql`
        UPDATE institutional_13f_holdings
           SET accession_number = ${operation.canonicalAccession}
         WHERE accession_number = ${holdingSource}
      `);
      await tx.execute(sql`DELETE FROM institutional_13f_filings WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession} AND id <> ${operation.survivorId!}`);
      await tx.execute(sql`UPDATE institutional_13f_filings SET accession_number = ${operation.canonicalAccession} WHERE id = ${operation.survivorId!}`);
      await recomputeEffectiveness(tx, operation);
      continue;
    }
    await tx.execute(sql`DELETE FROM institutional_13f_holdings WHERE accession_number IN (SELECT accession_number FROM institutional_13f_filings WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession}) AND accession_number <> ${operation.canonicalAccession}`);
    await tx.execute(sql`DELETE FROM institutional_13f_filings WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession} AND accession_number <> ${operation.canonicalAccession}`);
    await recomputeEffectiveness(tx, operation);
  }
  const collisions: any = await tx.execute(sql`SELECT 1 FROM institutional_13f_filings GROUP BY regexp_replace(accession_number, '[^0-9]', '', 'g') HAVING COUNT(*) > 1 LIMIT 1`);
  if ((collisions.rows ?? collisions)?.length) throw new Error("CANONICAL_ACCESSION_COLLISION_REMAINS");
  await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_13f_filings_canonical_accession ON institutional_13f_filings ((regexp_replace(accession_number, '[^0-9]', '', 'g')))`);
  await hooks.afterMutation?.();
}

/** Applies each validated operation atomically. Replay is invoked before legacy deletion. */
export async function applyDuplicateConvergence(executor: ConvergenceExecutor, plan: DuplicateConvergencePlan, deps: DuplicateConvergenceDependencies): Promise<void> {
  if (!plan.productionApplyReady) throw new Error("PLAN_NOT_APPLY_READY");
  const run = async (tx: ConvergenceExecutor) => {
    await executeConvergenceMutation(tx, plan, deps);
  };
  if (executor.transaction) await executor.transaction(run); else await run(executor);
  const canonicalAccessions = plan.operations
    .filter((operation) => operation.action !== "BLOCKED")
    .map((operation) => operation.canonicalAccession);
  const refreshedTargets = await readTargetsForCanonicalAccessions(
    executor,
    canonicalAccessions,
  );
  const targets = Array.from(new Map([
    ...plan.downstreamRebuildScope.symbolPeriods,
    ...refreshedTargets,
  ].map((target) => [`${target.symbol}:${target.periodOfReport}`, target])).values());
  await deps.materialize(targets);
}

function initialJournalRecord(
  plan: DuplicateConvergencePlan,
): Omit<ConvergenceJournalRecord, "id" | "createdAt" | "updatedAt"> {
  return {
    planHash: plan.planHash,
    status: "MUTATION_IN_PROGRESS",
    canonicalAccessions: plan.operations
      .filter((operation) => operation.action !== "BLOCKED")
      .map((operation) => operation.canonicalAccession),
    affectedPeriods: plan.affectedPeriods,
    affectedSymbols: plan.affectedSymbols,
    targets: plan.downstreamRebuildScope.symbolPeriods,
    mutationCompleted: false,
    materializationCompleted: false,
    lastCompletedStage: null,
    completedAggregateTargets: [],
    completedSignalSymbols: [],
    failureStage: null,
    failureReason: null,
    attemptCount: 0,
    activeAttemptId: null,
    leaseExpiresAt: null,
  };
}

export async function resumePersistedDuplicateConvergence(
  executor: ConvergenceExecutor,
  journal: ConvergenceJournalRecord,
  dependencies: ConvergenceMaterializationDependencies,
): Promise<ConvergenceJournalRecord> {
  const fresh = await readConvergenceJournal(executor, journal.planHash);
  if (!fresh || fresh.id !== journal.id) throw new Error("CONVERGENCE_JOURNAL_MISSING");
  if (fresh.status === "COMPLETED") return fresh;
  if (!fresh.mutationCompleted) throw new Error("CONVERGENCE_JOURNAL_INCONSISTENT");
  if (!executor.transaction) throw new Error("CONVERGENCE_TRANSACTION_REQUIRED");
  const attemptId = randomUUID();
  const claimed = await executor.transaction(async (tx) => {
    const lockResult: any = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${DUPLICATE_CONVERGENCE_LOCK_KEY}::bigint) AS locked`,
    );
    if ((lockResult?.rows ?? lockResult)?.[0]?.locked !== true) {
      throw new Error("DUPLICATE_CONVERGENCE_LOCK_HELD");
    }
    const result = await tx.execute(sql`
      UPDATE institutional_convergence_journal
         SET active_attempt_id = ${attemptId},
             lease_expires_at = NOW() + INTERVAL '10 minutes',
             updated_at = NOW()
       WHERE id = ${fresh.id}
         AND mutation_completed = TRUE
         AND materialization_completed = FALSE
         AND status <> 'FAILED_TERMINAL'
         AND (
           active_attempt_id IS NULL OR
           lease_expires_at IS NULL OR
           lease_expires_at <= NOW()
         )
       RETURNING *
    `);
    const rows = resultRows(result);
    if (rows.length !== 1) throw new Error("DUPLICATE_CONVERGENCE_RESUME_ACTIVE");
    return parseJournalRow(rows[0]);
  });
  const store = createDatabaseConvergenceJournalStore(executor);
  return resumeConvergenceMaterialization(claimed, store, dependencies);
}

/**
 * Persist the exact rebuild scope in the same transaction as the destructive
 * convergence. The MUTATION_COMMITTED journal state and filing changes become
 * visible atomically, so post-commit work can always resume from this record.
 */
export async function applyDuplicateConvergenceDurable(
  executor: ConvergenceExecutor,
  plan: DuplicateConvergencePlan,
  deps: DurableDuplicateConvergenceDependencies,
): Promise<ConvergenceJournalRecord> {
  if (!plan.productionApplyReady) throw new Error("PLAN_NOT_APPLY_READY");
  const existing = await readConvergenceJournal(executor, plan.planHash);
  if (existing) {
    assertJournalScope(existing, plan);
    return resumePersistedDuplicateConvergence(executor, existing, deps.materialization);
  }
  if (!executor.transaction) throw new Error("CONVERGENCE_TRANSACTION_REQUIRED");

  let committedJournal: ConvergenceJournalRecord | null = null;
  await executor.transaction(async (tx) => {
    const store = createDatabaseConvergenceJournalStore(tx);
    await executeConvergenceMutation(tx, plan, deps, {
      beforeMutation: async () => {
        committedJournal = await store.create(initialJournalRecord(plan));
      },
      afterMutation: async () => {
        if (!committedJournal) throw new Error("CONVERGENCE_JOURNAL_MISSING");
        const refreshedTargets = await readTargetsForCanonicalAccessions(
          tx,
          committedJournal.canonicalAccessions,
        );
        const targets = Array.from(new Map([
          ...committedJournal.targets,
          ...refreshedTargets,
        ].map((target) => [targetKey(target), target])).values()).sort((a, b) =>
          a.symbol.localeCompare(b.symbol) ||
          a.periodOfReport.localeCompare(b.periodOfReport));
        committedJournal = await store.update(committedJournal.id, {
          status: "MUTATION_COMMITTED",
          mutationCompleted: true,
          lastCompletedStage: "EFFECTIVENESS_RECOMPUTED",
          targets,
          affectedSymbols: Array.from(new Set(targets.map((target) => target.symbol))).sort(),
          affectedPeriods: Array.from(new Set([
            ...committedJournal.affectedPeriods,
            ...targets.map((target) => target.periodOfReport),
          ])).sort(),
        });
      },
    });
  });
  if (!committedJournal) throw new Error("CONVERGENCE_JOURNAL_COMMIT_MISSING");
  return resumePersistedDuplicateConvergence(
    executor,
    committedJournal,
    deps.materialization,
  );
}
async function recomputeEffectiveness(tx: ConvergenceExecutor, operation: ConvergenceOperation): Promise<void> {
  if (!operation.filerCik || operation.periods.length === 0) return;
  for (const period of operation.periods) {
    await tx.execute(sql`UPDATE institutional_13f_filings SET is_effective = accession_number = (
      SELECT accession_number FROM institutional_13f_filings
       WHERE filer_cik = ${operation.filerCik} AND period_of_report = ${period}
       ORDER BY amendment_flag DESC, filing_date DESC, accession_number DESC LIMIT 1
    ) WHERE filer_cik = ${operation.filerCik} AND period_of_report = ${period}`);
  }
}