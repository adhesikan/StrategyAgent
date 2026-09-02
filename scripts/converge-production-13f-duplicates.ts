#!/usr/bin/env tsx
/**
 * Guarded production convergence for canonical 13F filing duplicates.
 *
 * DRY_RUN is the default and uses a server-enforced read-only connection.
 * APPLY requires the exact hash from a fresh dry run and validates every
 * authoritative replay source again before deleting legacy rows.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import {
  applyDuplicateConvergence,
  buildDuplicateConvergencePlan,
  DUPLICATE_CONVERGENCE_CONFIRMATION,
  getDuplicateConvergenceApplyGuardIssues,
  loadAuthoritativeReplaySource,
  validateDuplicateConvergenceEnvironment,
  type AuthoritativeReplaySource,
  type ConvergenceExecutor,
  type ConvergenceOperation,
  type DuplicateGroup,
} from "../server/services/institutional/production-duplicate-convergence";
import { normalizeAccession } from "../server/services/institutional/sec-13f-bulk-parser";
import type { AuthoritativeFilingMetadata } from "../server/services/institutional/historical-filing-period-repair";
import {
  buildHistoricalAuditReadOnlyUrl,
  createSecMetadataVerificationStatus,
  loadAuthoritativeSecMetadata,
  readDuplicateHoldingFingerprints,
  readStoredFilings,
} from "./audit-repair-production-13f-periods";
import { fetchDatasetCatalog } from "../server/services/institutional/sec-dataset-catalog";

export interface DuplicateConvergenceArgs {
  apply: boolean;
  planHash: string | null;
  confirm: string | null;
}

export function parseDuplicateConvergenceArgs(args: string[]): DuplicateConvergenceArgs {
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      apply: { type: "boolean", default: false },
      "plan-hash": { type: "string" },
      confirm: { type: "string" },
    },
  });
  return {
    apply: Boolean(parsed.values.apply),
    planHash: parsed.values["plan-hash"] ? String(parsed.values["plan-hash"]) : null,
    confirm: parsed.values.confirm ? String(parsed.values.confirm) : null,
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
): Promise<Map<string, DuplicateGroup["replayValidation"]>> {
  const preliminary = buildDuplicateConvergencePlan(groups, "DRY_RUN");
  const validations = new Map<string, DuplicateGroup["replayValidation"]>();
  for (const operation of preliminary.operations) {
    if (operation.action !== "AUTHORITATIVE_REPLAY") continue;
    try {
      const source = await loader(operation);
      validations.set(operation.canonicalAccession, {
        sourceUrl: source.sourceUrl,
        sourceChecksum: source.sourceChecksum,
        holdingCount: source.holdings.length,
      });
    } catch {
      validations.set(operation.canonicalAccession, null);
    }
  }
  return validations;
}

function publicPlan(plan: ReturnType<typeof buildDuplicateConvergencePlan>) {
  const { operations: _operations, ...output } = plan;
  return { ...output, metadataCorrectionOperations: 0 };
}

async function persistReplaySource(
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
  if (!args.apply) {
    process.env.DATABASE_URL = buildHistoricalAuditReadOnlyUrl(process.env.DATABASE_URL!);
  }

  const { db, pool } = await import("../server/db");
  try {
    const executor = db as unknown as ConvergenceExecutor;
    if (!args.apply) {
      const mode = rowsOf(await executor.execute(sql.raw("SHOW default_transaction_read_only")))[0]
        ?.default_transaction_read_only;
      if (mode !== "on") throw new Error("READ_ONLY_SESSION_REQUIRED");
    }

    const storedRows = await readStoredFilings(executor);
    const verificationStatus = createSecMetadataVerificationStatus();
    const authoritative = await loadAuthoritativeSecMetadata(storedRows, {
      status: verificationStatus,
      fetchCatalog: () => fetchDatasetCatalog(process.env.SEC_USER_AGENT!),
    });
    const initialGroups = await loadDuplicateGroups(executor, authoritative);
    const replayValidations = await validateReplayGroups(initialGroups);
    const groups = await loadDuplicateGroups(executor, authoritative, replayValidations);
    const plan = buildDuplicateConvergencePlan(
      groups,
      args.apply ? "APPLY" : "DRY_RUN",
      { requireReplayValidation: true },
    );

    if (!args.apply) {
      console.log(JSON.stringify(publicPlan(plan), null, 2));
      return;
    }
    const guardIssues = getDuplicateConvergenceApplyGuardIssues(plan, args);
    if (guardIssues.length > 0) {
      throw new Error(`DUPLICATE_CONVERGENCE_GUARD_REJECTED:${guardIssues.join(",")}`);
    }

    const { materializeAffectedInstitutionalTargets } = await import(
      "../server/services/institutional/ingestion-service"
    );
    await applyDuplicateConvergence(executor, plan, {
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
      materialize: materializeAffectedInstitutionalTargets,
    });
    console.log(JSON.stringify({ ...publicPlan(plan), mode: "APPLIED" }, null, 2));
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