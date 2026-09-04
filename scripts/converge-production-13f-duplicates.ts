#!/usr/bin/env tsx
/**
 * Guarded production convergence for canonical 13F filing duplicates.
 *
 * DRY_RUN is the default and uses a server-enforced read-only connection.
 * APPLY requires the exact hash from a fresh dry run and validates every
 * authoritative replay source again before deleting legacy rows.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import {
  applyDuplicateConvergenceDurable,
  buildDuplicateConvergencePlan,
  DUPLICATE_CONVERGENCE_CONFIRMATION,
  getDuplicateConvergenceApplyGuardIssues,
  loadAuthoritativeReplaySource,
  readConvergenceJournal,
  resumePersistedDuplicateConvergence,
  validateDuplicateConvergenceEnvironment,
  type AuthoritativeReplaySource,
  type ConvergenceExecutor,
  type ConvergenceOperation,
  type DuplicateGroup,
  type ReplaySourceFetcher,
} from "../server/services/institutional/production-duplicate-convergence";
import { normalizeAccession } from "../server/services/institutional/sec-13f-bulk-parser";
import type { AuthoritativeFilingMetadata } from "../server/services/institutional/historical-filing-period-repair";
import type { SourceRejectionCode } from "../server/services/institutional/production-source-identity-diagnostic";
import {
  buildHistoricalAuditReadOnlyUrl,
  createSecMetadataVerificationStatus,
  loadAuthoritativeSecMetadata,
  readDuplicateHoldingFingerprints,
  readStoredFilings,
} from "./audit-repair-production-13f-periods";
import { fetchDatasetCatalog } from "../server/services/institutional/sec-dataset-catalog";
import { secFetchDetailed } from "../server/services/institutional/sec-client";

export interface DuplicateConvergenceArgs {
  apply: boolean;
  summaryOnly: boolean;
  validateReplay: boolean;
  verbose: boolean;
  planHash: string | null;
  confirm: string | null;
}

export function parseDuplicateConvergenceArgs(args: string[]): DuplicateConvergenceArgs {
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      apply: { type: "boolean", default: false },
      "summary-only": { type: "boolean", default: false },
      "validate-replay": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "plan-hash": { type: "string" },
      confirm: { type: "string" },
    },
  });
  return {
    apply: Boolean(parsed.values.apply),
    summaryOnly: Boolean(parsed.values["summary-only"]),
    validateReplay: Boolean(parsed.values["validate-replay"]),
    verbose: Boolean(parsed.values.verbose),
    planHash: parsed.values["plan-hash"] ? String(parsed.values["plan-hash"]) : null,
    confirm: parsed.values.confirm ? String(parsed.values.confirm) : null,
  };
}

// v2: identity validation no longer asserts the accession prefix equals the
// 13F manager CIK (invalid for agent-submitted filings).  Every replay
// candidate must be revalidated under v2; v1 checkpoints are automatically
// stale via the version check in replayValidationsFromCheckpoints().
const REPLAY_VALIDATOR_VERSION = "13f-replay-validator-v2";
const REPLAY_VALIDATION_CONCURRENCY = 2;

export function replayValidationMetadataFingerprint(
  metadata: AuthoritativeFilingMetadata | null,
): string {
  return createHash("sha256").update(JSON.stringify(metadata && {
    canonicalAccession: metadata.canonicalAccession,
    filerCik: metadata.filerCik,
    filingDate: metadata.filingDate,
    periodOfReport: metadata.periodOfReport,
    filingType: metadata.filingType,
    amendmentFlag: metadata.amendmentFlag,
  })).digest("hex");
}

export type ReplayCheckpoint = {
  metadataFingerprint: string; validatorVersion: string; status: string;
  sourceUrl: string | null; sourceChecksum: string | null; holdingCount: number | null;
};

async function readReplayCheckpoints(
  executor: ConvergenceExecutor,
): Promise<Map<string, ReplayCheckpoint>> {
  const result = await executor.execute(sql`
    SELECT canonical_accession AS "canonicalAccession",
           metadata_fingerprint AS "metadataFingerprint",
           validator_version AS "validatorVersion", status,
           source_url AS "sourceUrl", source_checksum AS "sourceChecksum",
           holding_count AS "holdingCount"
      FROM institutional_replay_validation_checkpoints
  `);
  return new Map(rowsOf(result).map((row) => [String(row.canonicalAccession), {
    metadataFingerprint: String(row.metadataFingerprint),
    validatorVersion: String(row.validatorVersion), status: String(row.status),
    sourceUrl: row.sourceUrl == null ? null : String(row.sourceUrl),
    sourceChecksum: row.sourceChecksum == null ? null : String(row.sourceChecksum),
    holdingCount: row.holdingCount == null ? null : Number(row.holdingCount),
  }]));
}

export function replayValidationsFromCheckpoints(
  groups: DuplicateGroup[],
  checkpoints: ReadonlyMap<string, ReplayCheckpoint>,
): Map<string, DuplicateGroup["replayValidation"]> {
  const result = new Map<string, DuplicateGroup["replayValidation"]>();
  const replayAccessions = new Set(
    buildDuplicateConvergencePlan(groups, "DRY_RUN").operations
      .filter((operation) => operation.action === "AUTHORITATIVE_REPLAY")
      .map((operation) => operation.canonicalAccession),
  );
  for (const group of groups) {
    if (!replayAccessions.has(group.canonicalAccession)) continue;
    const checkpoint = checkpoints.get(group.canonicalAccession);
    if (
      checkpoint?.status === "VALID" &&
      checkpoint.validatorVersion === REPLAY_VALIDATOR_VERSION &&
      checkpoint.metadataFingerprint === replayValidationMetadataFingerprint(group.authoritative) &&
      checkpoint.sourceUrl && checkpoint.sourceChecksum &&
      Number.isInteger(checkpoint.holdingCount) && checkpoint.holdingCount > 0
    ) result.set(group.canonicalAccession, {
      sourceUrl: checkpoint.sourceUrl, sourceChecksum: checkpoint.sourceChecksum,
      holdingCount: checkpoint.holdingCount,
    });
    else result.set(group.canonicalAccession, null);
  }
  return result;
}

export function replayGroupsNeedingValidation(
  groups: DuplicateGroup[],
  validations: ReadonlyMap<string, DuplicateGroup["replayValidation"]>,
): DuplicateGroup[] {
  const replayAccessions = new Set(
    buildDuplicateConvergencePlan(groups, "DRY_RUN").operations
      .filter((operation) => operation.action === "AUTHORITATIVE_REPLAY")
      .map((operation) => operation.canonicalAccession),
  );
  return groups.filter((group) =>
    replayAccessions.has(group.canonicalAccession) &&
    !validations.get(group.canonicalAccession));
}

/**
 * The exact closed set of sub-codes loadAuthoritativeReplaySource() can emit
 * as `AUTHORITATIVE_INFOTABLE_INVALID:${diagnostic.rejectionCode}`.  Mirrors
 * the SourceRejectionCode union: `satisfies` fails to compile if a listed
 * value is not a SourceRejectionCode, and _UnlistedSourceRejectionCode fails
 * if the union gains a value that is not listed here — so this stays in sync
 * deliberately, never by accident.
 */
export const SOURCE_REJECTION_CODES = [
  "RESPONSE_NOT_XML", "SEC_HTML_WRAPPER", "XML_DECLARATION_INVALID", "XML_TRUNCATED",
  "XML_UNCLOSED_TAG", "XML_MISNESTED_TAG", "INVALID_ENTITY", "ILLEGAL_XML_CHARACTER",
  "DOCTYPE_PRESENT", "MULTIPLE_ROOT_ELEMENTS", "INVALID_DOCUMENT_ORDER",
  "UNEXPECTED_SEC_FORMAT", "WRONG_DOCUMENT_SELECTED", "SEC_ERROR_RESPONSE",
  "CONTENT_ENCODING_ERROR", "OTHER_VALIDATION_FAILURE",
] as const satisfies readonly SourceRejectionCode[];

// Compile-time completeness guard. If SourceRejectionCode gains a member,
// this resolves to that member (not `never`) and the assignment errors —
// add the new value to SOURCE_REJECTION_CODES above.
type _UnlistedSourceRejectionCode = Exclude<SourceRejectionCode, (typeof SOURCE_REJECTION_CODES)[number]>;
const _sourceRejectionCodesAreExhaustive: [_UnlistedSourceRejectionCode] extends [never] ? true
  : _UnlistedSourceRejectionCode = true;
void _sourceRejectionCodesAreExhaustive;

const SOURCE_REJECTION_CODE_SET: ReadonlySet<string> = new Set(SOURCE_REJECTION_CODES);

/**
 * Reduce a replay error to a bounded, deterministic failure code safe to
 * persist in institutional_replay_validation_checkpoints.failure_reason.
 *
 * A detailed sub-code is preserved for exactly one known-safe structured
 * error family produced by our own code: loadAuthoritativeReplaySource()
 * throws `AUTHORITATIVE_INFOTABLE_INVALID:${diagnostic.rejectionCode}`.  The
 * sub-code is joined on ONLY when it is one of the exact SourceRejectionCode
 * values (see SOURCE_REJECTION_CODE_SET); any other value — arbitrary token,
 * URL, credential, free-form text — collapses to the bare prefix:
 *   "AUTHORITATIVE_INFOTABLE_INVALID:WRONG_DOCUMENT_SELECTED"
 *       -> "AUTHORITATIVE_INFOTABLE_INVALID_WRONG_DOCUMENT_SELECTED"
 *   "AUTHORITATIVE_INFOTABLE_INVALID:ABC123SECRET" -> "AUTHORITATIVE_INFOTABLE_INVALID"
 *
 * Every other error keeps only its first colon-delimited segment, and only
 * when that segment is itself a bare uppercase code token.  URLs, raw SEC
 * response text, free-form exception messages, and credentials/tokens all
 * fail that test and fall back to a safe constant — no later colon segments
 * are ever persisted for non-whitelisted families.
 *
 * Output: uppercase A-Z / 0-9 / underscore only, <= 100 chars, deterministic.
 */
export function replayFailureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);

  const infotable = /^AUTHORITATIVE_INFOTABLE_INVALID:([^:]*)/.exec(value);
  if (infotable) {
    return SOURCE_REJECTION_CODE_SET.has(infotable[1])
      ? `AUTHORITATIVE_INFOTABLE_INVALID_${infotable[1]}`.slice(0, 100)
      : "AUTHORITATIVE_INFOTABLE_INVALID";
  }

  const top = value.split(":", 1)[0].trim();
  return /^[A-Z0-9_]{1,60}$/.test(top) ? top : "REPLAY_VALIDATION_FAILED";
}

async function saveReplayCheckpoint(
  executor: ConvergenceExecutor, group: DuplicateGroup, source: AuthoritativeReplaySource | null,
  failureReason: string | null,
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO institutional_replay_validation_checkpoints (
      canonical_accession, metadata_fingerprint, validator_version, status,
      source_url, source_checksum, holding_count, failure_reason, validated_at, updated_at
    ) VALUES (
      ${group.canonicalAccession}, ${replayValidationMetadataFingerprint(group.authoritative)},
      ${REPLAY_VALIDATOR_VERSION}, ${source ? "VALID" : "FAILED"},
      ${source?.sourceUrl ?? null}, ${source?.sourceChecksum ?? null},
      ${source?.holdings.length ?? null}, ${failureReason}, NOW(), NOW()
    ) ON CONFLICT (canonical_accession) DO UPDATE SET
      metadata_fingerprint = EXCLUDED.metadata_fingerprint,
      validator_version = EXCLUDED.validator_version, status = EXCLUDED.status,
      source_url = EXCLUDED.source_url, source_checksum = EXCLUDED.source_checksum,
      holding_count = EXCLUDED.holding_count, failure_reason = EXCLUDED.failure_reason,
      validated_at = EXCLUDED.validated_at, updated_at = NOW()
  `);
}

export function buildSummaryOnlyReport(
  groups: DuplicateGroup[],
  journalPresent: boolean,
) {
  const plan = buildDuplicateConvergencePlan(groups, "DRY_RUN");
  const replayCandidateGroups = plan.operations.filter(
    (operation) => operation.action === "AUTHORITATIVE_REPLAY",
  ).length;
  const blockedIdentityGroups = plan.operations.filter(
    (operation) => operation.action === "BLOCKED",
  ).length;
  const reason = replayCandidateGroups > 0
    ? "REPLAY_VALIDATION_REQUIRED"
    : blockedIdentityGroups > 0
      ? "AUTHORITATIVE_IDENTITY_REQUIRED"
      : "NO_REPLAY_VALIDATION_REQUIRED";
  return {
    mode: "SUMMARY_ONLY",
    duplicateGroups: plan.totalCanonicalDuplicateGroups,
    safeCleanupGroups: plan.safeCleanupGroups,
    replayCandidateGroups,
    blockedIdentityGroups,
    affectedPeriodsCount: plan.affectedPeriods.length,
    affectedSymbolsCount: plan.affectedSymbols.length,
    downstreamTargetCount: plan.downstreamRebuildScope.targets,
    replayValidationRequired: replayCandidateGroups,
    journalPresent,
    productionApplyReady: false,
    reason,
    diagnosticPlanHash: createHash("sha256")
      .update(`SUMMARY_ONLY:${plan.planHash}`)
      .digest("hex"),
  };
}

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
}

async function readTargetsByAccession(
  executor: ConvergenceExecutor,
): Promise<Map<string, Array<{ symbol: string; periodOfReport: string }>>> {
  const result = await executor.execute(sql`
    SELECT DISTINCT
           regexp_replace(accession_number, '[^0-9]', '', 'g') AS accession,
           UPPER(mapped_symbol) AS symbol,
           period_of_report::text AS "periodOfReport"
      FROM institutional_13f_holdings
     WHERE mapped_symbol IS NOT NULL
     ORDER BY accession, symbol, "periodOfReport"
  `);
  const output = new Map<string, Array<{ symbol: string; periodOfReport: string }>>();
  for (const row of rowsOf(result)) {
    const accession = String(row.accession);
    const target = {
      symbol: String(row.symbol),
      periodOfReport: String(row.periodOfReport),
    };
    const group = output.get(accession);
    if (group) group.push(target);
    else output.set(accession, [target]);
  }
  return output;
}

export async function loadDuplicateGroups(
  executor: ConvergenceExecutor,
  authoritative: ReadonlyMap<string, AuthoritativeFilingMetadata[]>,
  replayValidations: ReadonlyMap<string, DuplicateGroup["replayValidation"]> = new Map(),
): Promise<DuplicateGroup[]> {
  const rows = await readStoredFilings(executor);
  const fingerprints = await readDuplicateHoldingFingerprints(executor, rows);
  const targets = await readTargetsByAccession(executor);
  const byAccession = new Map<string, typeof rows>();
  for (const row of rows) {
    const accession = normalizeAccession(row.rawAccession);
    const group = byAccession.get(accession);
    if (group) group.push(row);
    else byAccession.set(accession, [row]);
  }
  return Array.from(byAccession.entries())
    .filter(([, group]) => group.length > 1)
    .map(([canonicalAccession, group]) => {
      const evidence = authoritative.get(canonicalAccession) ?? [];
      return {
        canonicalAccession,
        rows: group,
        fingerprints,
        authoritative: evidence.length === 1 ? evidence[0] : null,
        targets: targets.get(canonicalAccession) ?? [],
        replayValidation: replayValidations.get(canonicalAccession),
      };
    });
}

export async function validateReplayGroups(
  groups: DuplicateGroup[],
  loader: (operation: ConvergenceOperation) => Promise<AuthoritativeReplaySource> =
    loadAuthoritativeReplaySource,
  options: {
    checkpoint?: (group: DuplicateGroup, source: AuthoritativeReplaySource | null, failureCode: string | null) => Promise<void>;
    onProgress?: (completed: number, total: number, accession: string) => void;
  } = {},
): Promise<Map<string, DuplicateGroup["replayValidation"]>> {
  const preliminary = buildDuplicateConvergencePlan(groups, "DRY_RUN");
  const validations = new Map<string, DuplicateGroup["replayValidation"]>();
  const operations = preliminary.operations.filter((operation) => operation.action === "AUTHORITATIVE_REPLAY");
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < operations.length) {
      const operation = operations[next++];
      const group = groups.find((candidate) => candidate.canonicalAccession === operation.canonicalAccession);
      if (!group) throw new Error("REPLAY_VALIDATION_GROUP_MISSING");
      try {
        const source = await loader(operation);
        await options.checkpoint?.(group, source, null);
        validations.set(operation.canonicalAccession, {
          sourceUrl: source.sourceUrl, sourceChecksum: source.sourceChecksum, holdingCount: source.holdings.length,
        });
      } catch (error) {
        // A failed checkpoint is durable evidence that this accession cannot
        // authorize APPLY; never retain a prior successful result.
        await options.checkpoint?.(group, null, replayFailureCode(error));
        validations.set(operation.canonicalAccession, null);
      } finally {
        completed += 1;
        options.onProgress?.(completed, operations.length, operation.canonicalAccession);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REPLAY_VALIDATION_CONCURRENCY, operations.length) }, worker));
  return validations;
}

/** Per-process cache used only by explicit validation. APPLY calls the loader
 * directly, intentionally bypassing this cache and the SEC client's cache. */
export function createValidationCachedLoader(
  fetchDetailed: ReplaySourceFetcher = secFetchDetailed,
): (operation: ConvergenceOperation) => Promise<AuthoritativeReplaySource> {
  const responses = new Map<string, ReturnType<ReplaySourceFetcher>>();
  const fetcher: ReplaySourceFetcher = (url, _cacheKey, signal) => {
    let response = responses.get(url);
    if (!response) {
      response = fetchDetailed(url, undefined, signal);
      responses.set(url, response);
    }
    return response;
  };
  return (operation) => loadAuthoritativeReplaySource(operation, fetcher);
}

export function buildPublicPlanReport(
  plan: ReturnType<typeof buildDuplicateConvergencePlan>,
  resumeReady: boolean,
  verbose = false,
) {
  const report = {
    mode: plan.mode,
    duplicateGroups: plan.totalCanonicalDuplicateGroups,
    safeCleanupGroups: plan.safeCleanupGroups,
    replayGroups: plan.replayGroups,
    blockedGroups: plan.blockedGroups,
    affectedPeriodsCount: plan.affectedPeriods.length,
    affectedSymbolsCount: plan.affectedSymbols.length,
    downstreamTargetCount: plan.downstreamRebuildScope.targets,
    journalRequired: true,
    resumeReady,
    productionApplyReady: plan.productionApplyReady,
    planHash: plan.planHash,
  };
  return verbose ? {
    ...report,
    affectedPeriods: plan.affectedPeriods,
    affectedSymbols: plan.affectedSymbols,
    downstreamTargets: plan.downstreamRebuildScope.symbolPeriods,
  } : report;
}

export async function persistReplaySource(
  tx: ConvergenceExecutor,
  operation: ConvergenceOperation,
  source: AuthoritativeReplaySource,
): Promise<void> {
  const metadata = operation.authoritative;
  if (!metadata || !operation.filerName) throw new Error("AUTHORITATIVE_REPLAY_METADATA_MISSING");
  if (
    source.sourceUrl !== operation.replaySourceUrl ||
    source.sourceChecksum !== operation.replaySourceChecksum ||
    source.holdings.length !== operation.replayHoldingCount
  ) {
    throw new Error("AUTHORITATIVE_REPLAY_SOURCE_DRIFT");
  }

  // The source is fully validated before either destructive statement.
  await tx.execute(sql`
    DELETE FROM institutional_13f_holdings
     WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession}
  `);
  await tx.execute(sql`
    DELETE FROM institutional_13f_filings
     WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession}
  `);
  await tx.execute(sql`
    INSERT INTO institutional_13f_filings (
      accession_number, filer_cik, filer_name, filing_type, filing_date,
      period_of_report, amendment_flag, is_effective, source_url, source_checksum
    ) VALUES (
      ${metadata.canonicalAccession}, ${metadata.filerCik}, ${operation.filerName},
      ${metadata.filingType}, ${metadata.filingDate}, ${metadata.periodOfReport},
      ${metadata.amendmentFlag}, TRUE, ${source.sourceUrl}, ${source.sourceChecksum}
    )
  `);
  for (let index = 0; index < source.holdings.length; index += 250) {
    const values = sql.join(source.holdings.slice(index, index + 250).map((holding) => sql`(
      ${metadata.canonicalAccession}, ${metadata.filerCik}, ${operation.filerName},
      ${holding.issuerName}, ${holding.classTitle}, ${holding.cusip}, ${holding.figi},
      ${holding.reportedValue}, ${holding.reportedShares}, ${holding.sharesPrnType},
      ${holding.putCall}, ${holding.investmentDiscretion}, ${holding.otherManager},
      ${holding.votingSole}, ${holding.votingShared}, ${holding.votingNone},
      ${metadata.periodOfReport}, ${metadata.filingDate},
      (SELECT mapped_symbol FROM institutional_security_mappings
        WHERE cusip = ${holding.cusip} AND mapping_status IN ('exact', 'reviewed') LIMIT 1),
      COALESCE((SELECT mapping_status FROM institutional_security_mappings
        WHERE cusip = ${holding.cusip} AND mapping_status IN ('exact', 'reviewed') LIMIT 1), 'unmapped')
    )`), sql`, `);
    await tx.execute(sql`
      INSERT INTO institutional_13f_holdings (
        accession_number, filer_cik, filer_name, issuer_name, class_title, cusip,
        figi, reported_value, reported_shares, shares_prn_type, put_call,
        investment_discretion, other_manager, voting_sole, voting_shared,
        voting_none, period_of_report, filing_date, mapped_symbol, mapping_status
      ) VALUES ${values}
    `);
  }
}

async function main(): Promise<void> {
  const args = parseDuplicateConvergenceArgs(process.argv.slice(2));
  const environmentIssues = validateDuplicateConvergenceEnvironment(process.env);
  if (environmentIssues.length > 0) {
    throw new Error(`PRODUCTION_RUNTIME_REJECTED:${environmentIssues.join(",")}`);
  }
  if ((args.summaryOnly && args.apply) || (args.summaryOnly && args.validateReplay)) {
    throw new Error("SUMMARY_ONLY_MUTATION_OR_VALIDATION_FORBIDDEN");
  }
  if (args.apply && args.validateReplay) {
    throw new Error("APPLY_REPLAY_VALIDATION_FORBIDDEN");
  }
  // Validation checkpoints are the sole non-APPLY writes permitted here.
  if (!args.apply && !args.validateReplay) {
    process.env.DATABASE_URL = buildHistoricalAuditReadOnlyUrl(process.env.DATABASE_URL!);
  }

  const { db, pool } = await import("../server/db");
  try {
    const executor = db as unknown as ConvergenceExecutor;
    if (!args.apply && !args.validateReplay) {
      const mode = rowsOf(await executor.execute(sql.raw("SHOW default_transaction_read_only")))[0]
        ?.default_transaction_read_only;
      if (mode !== "on") throw new Error("READ_ONLY_SESSION_REQUIRED");
    }

    const loadMaterializationDependencies = async () => {
      const [
        { recomputeAggregateForSymbol },
        { rebuildInstitutionalSignalForSymbol },
        { runIntelligencePrecomputation },
      ] = await Promise.all([
        import("../server/services/institutional/ingestion-service"),
        import("../server/services/institutional/signal-engine"),
        import("../server/services/institutional/intelligence-orchestrator"),
      ]);
      return {
        recomputeAggregate: recomputeAggregateForSymbol,
        rebuildSignal: rebuildInstitutionalSignalForSymbol,
        refreshSnapshots: runIntelligencePrecomputation,
      };
    };

    if (args.apply && args.planHash) {
      const journal = await readConvergenceJournal(executor, args.planHash);
      if (journal) {
        if (args.confirm !== DUPLICATE_CONVERGENCE_CONFIRMATION) {
          throw new Error("DUPLICATE_CONVERGENCE_GUARD_REJECTED:CONFIRMATION_REQUIRED");
        }
        const resumed = await resumePersistedDuplicateConvergence(
          executor,
          journal,
          await loadMaterializationDependencies(),
        );
        console.log(JSON.stringify({
          mode: resumed.status === "COMPLETED" ? "ALREADY_COMPLETED" : "RESUMED",
          planHash: resumed.planHash,
          status: resumed.status,
          downstreamTargets: resumed.targets,
          mutationRepeated: false,
        }, null, 2));
        return;
      }
    }

    const storedRows = await readStoredFilings(executor);
    const verificationStatus = createSecMetadataVerificationStatus();
    const authoritative = await loadAuthoritativeSecMetadata(storedRows, {
      status: verificationStatus,
      fetchCatalog: () => fetchDatasetCatalog(process.env.SEC_USER_AGENT!),
    });
    const initialGroups = await loadDuplicateGroups(executor, authoritative);
    if (args.summaryOnly) {
      const summaryPlan = buildDuplicateConvergencePlan(initialGroups, "DRY_RUN");
      const journal = await readConvergenceJournal(executor, summaryPlan.planHash);
      console.log(JSON.stringify(buildSummaryOnlyReport(initialGroups, journal !== null)));
      return;
    }
    let replayValidations: Map<string, DuplicateGroup["replayValidation"]>;
    if (args.validateReplay) {
      const existing = replayValidationsFromCheckpoints(
        initialGroups, await readReplayCheckpoints(executor),
      );
      const preliminary = buildDuplicateConvergencePlan(initialGroups, "DRY_RUN");
      const replayAccessions = preliminary.operations
        .filter((operation) => operation.action === "AUTHORITATIVE_REPLAY")
        .map((operation) => operation.canonicalAccession);
      const reusedGroups = replayAccessions
        .filter((accession) => existing.get(accession)).length;
      const pending = replayGroupsNeedingValidation(initialGroups, existing);
      // Validation is deliberately bounded to two operations.  Its temporary
      // response cache is process-local and never reaches the APPLY path.
       const refreshed = await validateReplayGroups(pending, createValidationCachedLoader(), {
        checkpoint: (group, source, failureCode) =>
          saveReplayCheckpoint(executor, group, source, failureCode),
        onProgress: (completed, total, accession) =>
          console.error(JSON.stringify({
            mode: "VALIDATE_REPLAY",
            completed: reusedGroups + completed,
            total: replayAccessions.length,
            attemptedThisRun: completed,
            pendingThisRun: total,
            accession,
          })),
      });
      replayValidations = new Map([...existing, ...refreshed]);
       const failed = replayAccessions.some((accession) => !replayValidations.get(accession));
      console.log(JSON.stringify({
        mode: "VALIDATE_REPLAY",
        replayCandidateGroups: preliminary.operations.filter(
          (operation) => operation.action === "AUTHORITATIVE_REPLAY",
        ).length,
         validatedGroups: replayAccessions.filter((accession) => replayValidations.get(accession)).length,
         failedGroups: replayAccessions.filter((accession) => !replayValidations.get(accession)).length,
        complete: !failed,
      }, null, 2));
      if (failed) throw new Error("REPLAY_VALIDATION_INCOMPLETE");
      return;
    }
    // Normal DRY_RUN/APPLY never validates by downloading documents.  A
    // missing, stale, failed, or partial persisted checkpoint blocks replay.
    replayValidations = replayValidationsFromCheckpoints(
      initialGroups, await readReplayCheckpoints(executor),
    );
    const groups = await loadDuplicateGroups(executor, authoritative, replayValidations);
    const plan = buildDuplicateConvergencePlan(
      groups,
      args.apply ? "APPLY" : "DRY_RUN",
      { requireReplayValidation: true },
    );

    if (!args.apply) {
      const journal = await readConvergenceJournal(executor, plan.planHash);
      console.log(JSON.stringify(buildPublicPlanReport(plan, journal !== null, args.verbose), null, 2));
      return;
    }
    const guardIssues = getDuplicateConvergenceApplyGuardIssues(plan, args);
    if (guardIssues.length > 0) {
      throw new Error(`DUPLICATE_CONVERGENCE_GUARD_REJECTED:${guardIssues.join(",")}`);
    }

    const completed = await applyDuplicateConvergenceDurable(executor, plan, {
      revalidatePlan: async (tx) => {
        const freshGroups = await loadDuplicateGroups(tx, authoritative, replayValidations);
        return buildDuplicateConvergencePlan(
          freshGroups,
          "APPLY",
          { requireReplayValidation: true },
        ).planHash;
      },
      replay: async (tx, operation) => {
        const source = await loadAuthoritativeReplaySource(operation);
        await persistReplaySource(tx, operation, source);
      },
      materialization: await loadMaterializationDependencies(),
    });
    console.log(JSON.stringify({
      ...buildPublicPlanReport(plan, true, args.verbose),
      mode: "APPLIED",
      status: completed.status,
      runId: completed.id,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message.split(":")[0] : "DUPLICATE_CONVERGENCE_FAILED",
    }));
    process.exitCode = 1;
  });
}