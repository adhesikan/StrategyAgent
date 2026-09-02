/**
 * Guarded convergence for legacy 13F accession duplicates.  This module is
 * deliberately independent of normal ingestion: callers must supply the SEC
 * replay operation, which keeps the existing SEC parser/fetcher authoritative.
 */
import { createHash } from "node:crypto";
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
export type ConvergenceAction = "SAFE_CLEANUP" | "AUTHORITATIVE_REPLAY" | "BLOCKED";
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
    ) ||
    stable(record.targets) !== stable(plan.downstreamRebuildScope.symbolPeriods)
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
  try {
    const aggregateDone = new Set(current.completedAggregateTargets);
    for (const target of current.targets) {
      if (aggregateDone.has(targetKey(target))) continue;
      await dependencies.recomputeAggregate(
        target.symbol,
        target.periodOfReport,
        null,
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
      await dependencies.rebuildSignal(symbol);
      signalDone.add(symbol);
      current = await store.update(current.id, {
        status: "MATERIALIZATION_IN_PROGRESS",
        lastCompletedStage: "SIGNALS",
        completedSignalSymbols: Array.from(signalDone).sort(),
      });
    }

    if (current.affectedSymbols.length > 0 && current.lastCompletedStage !== "SNAPSHOTS") {
      await dependencies.refreshSnapshots({ persist: true });
      current = await store.update(current.id, {
        status: "COMPLETED",
        materializationCompleted: true,
        lastCompletedStage: "SNAPSHOTS",
        failureStage: null,
        failureReason: null,
      });
    } else {
      current = await store.update(current.id, {
        status: "COMPLETED",
        materializationCompleted: true,
        failureStage: null,
        failureReason: null,
      });
    }
    return current;
  } catch (error) {
    current = await store.update(current.id, {
      status: "FAILED_RETRYABLE",
      failureStage: current.lastCompletedStage ?? "AGGREGATES",
      failureReason: sanitizeJournalFailure(error),
      attemptCount: current.attemptCount,
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
  options: { requireReplayValidation?: boolean } = {},
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
    const action: ConvergenceAction = safe
      ? "SAFE_CLEANUP"
      : replayCandidate && (!options.requireReplayValidation || replayValidated)
        ? "AUTHORITATIVE_REPLAY"
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
        : null });
  }
  const filtered = operations.filter(o => o.action !== "BLOCKED");
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
  return { mode, totalCanonicalDuplicateGroups: operations.length, safeCleanupGroups: safe.length, replayGroups: replay.length, blockedGroups: blocked.length,
    safeCleanupOperations: safe.length, replayOperations: replay.length, affectedFilings: filtered.reduce((n,o) => n + o.duplicateIds.length + 1, 0),
    affectedHoldings: filtered.reduce((n,o) => n + o.affectedHoldings, 0), affectedPeriods: periods, affectedSymbols: symbols,
    downstreamRebuildScope: { targets: targets.length, periods, symbols, symbolPeriods: targets }, canonicalUniquenessReady: blocked.length === 0,
    planHash: createHash("sha256").update(stable(body)).digest("hex"), productionApplyReady: blocked.length === 0 && operations.length > 0, operations };
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
export interface AuthoritativeReplaySource {
  indexUrl: string; sourceUrl: string; sourceChecksum: string;
  holdings: ReturnType<typeof parseInfoTableXml>["holdings"];
}
/** Uses the established strict SEC document selection/parser path; no fuzzy lookup. */
export async function loadAuthoritativeReplaySource(operation: ConvergenceOperation): Promise<AuthoritativeReplaySource> {
  const metadata = operation.authoritative;
  if (!metadata || metadata.canonicalAccession !== operation.canonicalAccession || metadata.filerCik !== operation.canonicalAccession.slice(0, 10)) {
    throw new Error("AUTHORITATIVE_REPLAY_IDENTITY_INVALID");
  }
  const indexUrl = filingIndexUrl(metadata.filerCik, metadata.canonicalAccession);
  const index = await secFetchDetailed(indexUrl);
  const selection = selectInfoTableDocument(index.text, metadata.filerCik, metadata.canonicalAccession);
  if (!selection.path) throw new Error("AUTHORITATIVE_INFOTABLE_NOT_UNIQUE");
  const sourceUrl = new URL(selection.path, "https://www.sec.gov").toString();
  const document = await secFetchDetailed(sourceUrl);
  const diagnostic = inspectInfoTableDocument(document.text, document);
  if (diagnostic.rejectionCode) throw new Error(`AUTHORITATIVE_INFOTABLE_INVALID:${diagnostic.rejectionCode}`);
  const parsed = parseInfoTableXml(document.text);
  if (!validateInfoTableCompleteness(document.text, parsed).complete) throw new Error("AUTHORITATIVE_INFOTABLE_INCOMPLETE");
  if (parsed.holdings.length === 0) throw new Error("AUTHORITATIVE_INFOTABLE_EMPTY");
  return { indexUrl, sourceUrl, sourceChecksum: createHash("sha256").update(document.text).digest("hex"),
    holdings: parsed.holdings.map(row => normalizeSourceHoldingValue(row, metadata.filingDate).holding) };
}
/** Applies each validated operation atomically. Replay is invoked before legacy deletion. */
export async function applyDuplicateConvergence(executor: ConvergenceExecutor, plan: DuplicateConvergencePlan, deps: DuplicateConvergenceDependencies): Promise<void> {
  if (!plan.productionApplyReady) throw new Error("PLAN_NOT_APPLY_READY");
  const run = async (tx: ConvergenceExecutor) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const lockResult: any = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${DUPLICATE_CONVERGENCE_LOCK_KEY}::bigint) AS locked`,
    );
    const lockRows = lockResult?.rows ?? lockResult;
    if (lockRows?.[0]?.locked !== true) throw new Error("DUPLICATE_CONVERGENCE_LOCK_HELD");
    if (deps.revalidatePlan && await deps.revalidatePlan(tx) !== plan.planHash) throw new Error("STALE_PLAN_HASH");
    for (const operation of plan.operations) {
      if (operation.action === "BLOCKED") throw new Error("BLOCKED_OPERATION");
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
  };
  if (executor.transaction) await executor.transaction(run); else await run(executor);
  const canonicalAccessions = plan.operations
    .filter((operation) => operation.action !== "BLOCKED")
    .map((operation) => operation.canonicalAccession);
  const refreshedTargets: Array<{ symbol: string; periodOfReport: string }> = [];
  if (canonicalAccessions.length > 0) {
    const values = sql.join(canonicalAccessions.map((accession) => sql`${accession}`), sql`, `);
    const targetResult: any = await executor.execute(sql`
      SELECT DISTINCT UPPER(mapped_symbol) AS symbol,
             period_of_report::text AS "periodOfReport"
        FROM institutional_13f_holdings
       WHERE accession_number IN (${values})
         AND mapped_symbol IS NOT NULL
    `);
    for (const row of targetResult?.rows ?? targetResult ?? []) {
      refreshedTargets.push({
        symbol: String(row.symbol),
        periodOfReport: String(row.periodOfReport),
      });
    }
  }
  const targets = Array.from(new Map([
    ...plan.downstreamRebuildScope.symbolPeriods,
    ...refreshedTargets,
  ].map((target) => [`${target.symbol}:${target.periodOfReport}`, target])).values());
  await deps.materialize(targets);
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