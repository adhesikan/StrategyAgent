#!/usr/bin/env tsx
/**
 * Controlled Institutional Intelligence production repair.
 *
 * Default mode is read-only. Write mode requires:
 *   --apply
 *   --environment production
 *   --confirm REPAIR_INSTITUTIONAL_PRODUCTION_DATA
 *   --plan-hash <hash printed by a fresh dry run>
 *   --checkpoint-file <path>
 *
 * This command never ingests or backfills SEC data and never changes feature
 * flags. Preflight may fetch the bounded authoritative SEC source documents
 * required to reconcile source identity in the explicit repair scope.
 */

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  INSTITUTIONAL_REPAIR_CONFIRMATION,
  REPAIR_STAGE_ORDER,
  VERIFIED_REPAIR_MAPPINGS,
  type RepairStage,
  applyInstitutionalMappingRepair,
  loadInstitutionalRepairPreflight,
  getRepairStageBlockingIssues,
  shouldRunRepairStage,
  evaluateInstitutionalRepairValidation,
  validateInstitutionalRepairSymbols,
  validateRepairApplyRequest,
} from "../server/services/institutional/production-repair";
import { rebuildInstitutionalAggregates } from "../server/services/institutional/ingestion-service";
import { rebuildInstitutionalSignals } from "../server/services/institutional/signal-engine";
import { runIntelligencePrecomputation } from "../server/services/intelligence-orchestrator";

interface CliOptions {
  apply: boolean;
  confirmation: string | null;
  environment: string | null;
  planHash: string | null;
  checkpointFile: string | null;
  databaseName: string | null;
  fromStage: RepairStage;
}

export interface Checkpoint {
  version: 1;
  mode: "apply";
  planHash: string;
  resumePlanHash: string;
  databaseIdentity: {
    database: string;
    user: string;
    schema: string;
    railwayEnvironment: string | null;
  };
  startedAt: string;
  updatedAt: string;
  stages: Partial<Record<RepairStage, {
    status: "completed" | "blocked" | "failed";
    completedAt: string;
    result: unknown;
  }>>;
}

function fail(code: string, message: string): never {
  console.error(`[institutional-repair:error] ${code}: ${message}`);
  process.exit(1);
}

export function parseRepairCliArgs(args: string[]): CliOptions {
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      apply: { type: "boolean", default: false },
      confirm: { type: "string" },
      environment: { type: "string" },
      "plan-hash": { type: "string" },
      "checkpoint-file": { type: "string" },
      "database-name": { type: "string" },
      "from-stage": { type: "string", default: "mapping" },
    },
  });
  const fromStage = String(parsed.values["from-stage"]) as RepairStage;
  if (!REPAIR_STAGE_ORDER.includes(fromStage)) {
    throw new Error(`INVALID_STAGE:${fromStage}`);
  }
  return {
    apply: Boolean(parsed.values.apply),
    confirmation: parsed.values.confirm ? String(parsed.values.confirm) : null,
    environment: parsed.values.environment ? String(parsed.values.environment) : null,
    planHash: parsed.values["plan-hash"] ? String(parsed.values["plan-hash"]) : null,
    checkpointFile: parsed.values["checkpoint-file"] ? String(parsed.values["checkpoint-file"]) : null,
    databaseName: parsed.values["database-name"] ? String(parsed.values["database-name"]) : null,
    fromStage,
  };
}

async function persistCheckpoint(path: string, checkpoint: Checkpoint): Promise<void> {
  checkpoint.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
}

export function validateRepairCheckpointResume(
  checkpoint: Checkpoint,
  input: {
    fromStage: RepairStage;
    currentPlanHash: string;
    databaseIdentity: Checkpoint["databaseIdentity"];
  },
): string[] {
  if (input.fromStage === "mapping") return [];
  const issues: string[] = [];
  if (checkpoint.version !== 1 || checkpoint.mode !== "apply") {
    issues.push("CHECKPOINT_FORMAT_INVALID");
  }
  if (checkpoint.resumePlanHash !== input.currentPlanHash) {
    issues.push("CHECKPOINT_PLAN_HASH_MISMATCH");
  }
  if (
    checkpoint.databaseIdentity.database !== input.databaseIdentity.database ||
    checkpoint.databaseIdentity.user !== input.databaseIdentity.user ||
    checkpoint.databaseIdentity.schema !== input.databaseIdentity.schema ||
    checkpoint.databaseIdentity.railwayEnvironment !== input.databaseIdentity.railwayEnvironment
  ) {
    issues.push("CHECKPOINT_DATABASE_IDENTITY_MISMATCH");
  }
  const priorStages = REPAIR_STAGE_ORDER.slice(0, REPAIR_STAGE_ORDER.indexOf(input.fromStage));
  for (const stage of priorStages) {
    if (checkpoint.stages[stage]?.status !== "completed") {
      issues.push(`CHECKPOINT_PRIOR_STAGE_NOT_COMPLETED:${stage}`);
    }
  }
  return issues;
}

async function loadCheckpoint(path: string): Promise<Checkpoint> {
  return JSON.parse(await readFile(path, "utf8")) as Checkpoint;
}

export function validateRepairDatabaseRuntime(env: {
  DATABASE_URL?: string;
  EXTERNAL_DATABASE_URL?: string;
}): string[] {
  const issues: string[] = [];
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  return issues;
}

function printDryRun(
  preflight: Awaited<ReturnType<typeof loadInstitutionalRepairPreflight>>,
  intelligencePreview: Awaited<ReturnType<typeof runIntelligencePrecomputation>>,
  options: CliOptions,
): void {
  const runtimeIssues = intelligencePreview.status === "completed"
    ? []
    : [`INTELLIGENCE_PRECOMPUTATION_${intelligencePreview.status.toUpperCase()}`];
  const blockingIssues = [
    ...preflight.blockingIssues,
    ...getRepairStageBlockingIssues(preflight, options.fromStage),
    ...runtimeIssues,
  ];
  console.log("\n=== Institutional Production Repair — DRY RUN ===");
  console.log("READ-ONLY: no mappings, holdings, aggregates, signals, or snapshots were changed.");
  console.log(JSON.stringify(preflight, null, 2));
  console.log("\nEXPECTED WRITE COUNTS:");
  console.log(JSON.stringify({
    securityMappingsToInsert: preflight.plan.mappingRowsToInsert,
    securityMappingsToPromote: preflight.plan.mappingRowsToPromote,
    holdingsToMap: preflight.plan.holdingsToUpdate,
    holdingsRemainingUnmapped: preflight.plan.remainingUnmappedEffectiveHoldings,
    aggregateRowsToInsert: preflight.plan.aggregateRowsToInsert,
    aggregateRowsToUpdate: preflight.plan.aggregateRowsToUpdate,
    signalRowsToInsert: preflight.plan.signalRowsToInsert,
    signalRowsToUpdate: preflight.plan.signalRowsToUpdate,
    sectorSnapshotRowsToRebuild: intelligencePreview.status === "completed"
      ? intelligencePreview.sectorCount
      : null,
    themeSnapshotRowsToRebuild: intelligencePreview.status === "completed"
      ? intelligencePreview.themeCount
      : null,
    intelligencePreview,
  }, null, 2));
  console.log(
    `\nRECOMMENDATION: ${blockingIssues.length === 0 ? "GO" : "NO-GO"} ` +
      `(blocking issues: ${blockingIssues.length})`,
  );
  if (blockingIssues.length === 0) {
    console.log("\nTo apply this exact plan after review:");
    console.log(
      `npx tsx scripts/repair-institutional-production-data.ts --apply --environment production ` +
      `--confirm ${INSTITUTIONAL_REPAIR_CONFIRMATION} --plan-hash ${preflight.planHash} ` +
      `--database-name ${preflight.databaseIdentity.database} ` +
      `--checkpoint-file /tmp/institutional-repair-checkpoint.json`,
    );
  }
}

async function main(): Promise<void> {
  const databaseRuntimeIssues = validateRepairDatabaseRuntime(process.env);
  if (databaseRuntimeIssues.length > 0) {
    fail("DATABASE_RUNTIME_REJECTED", databaseRuntimeIssues.join(","));
  }
  let options: CliOptions;
  try {
    options = parseRepairCliArgs(process.argv.slice(2));
  } catch (error: any) {
    fail("INVALID_ARGS", String(error?.message ?? error));
  }

  const preflight = await loadInstitutionalRepairPreflight();
  const intelligencePreview = await runIntelligencePrecomputation({ persist: false });
  if (!options.apply) {
    printDryRun(preflight, intelligencePreview, options);
    process.exit(
      preflight.blockingIssues.length === 0 &&
      getRepairStageBlockingIssues(preflight, options.fromStage).length === 0 &&
      intelligencePreview.status === "completed"
        ? 0
        : 2,
    );
  }

  const guardIssues = validateRepairApplyRequest({
    apply: true,
    confirmation: options.confirmation,
    environment: options.environment,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    publicFeatureEnabled: preflight.publicFeatureEnabled,
    expectedDatabase: options.databaseName,
    currentDatabase: preflight.databaseIdentity.database,
  });
  if (!options.planHash) guardIssues.push("PLAN_HASH_REQUIRED");
  if (options.planHash && options.planHash !== preflight.planHash) guardIssues.push("PLAN_HASH_MISMATCH");
  if (!options.checkpointFile) guardIssues.push("CHECKPOINT_FILE_REQUIRED");
  guardIssues.push(...preflight.blockingIssues);
  guardIssues.push(...getRepairStageBlockingIssues(preflight, options.fromStage));
  if (intelligencePreview.status !== "completed") {
    guardIssues.push(`INTELLIGENCE_PRECOMPUTATION_${intelligencePreview.status.toUpperCase()}`);
  }
  if (guardIssues.length > 0) {
    fail("PREFLIGHT_FAILED", Array.from(new Set(guardIssues)).join(","));
  }

  const now = new Date().toISOString();
  let checkpoint: Checkpoint;
  if (options.fromStage === "mapping") {
    checkpoint = {
      version: 1,
      mode: "apply",
      planHash: preflight.planHash,
      resumePlanHash: preflight.planHash,
      databaseIdentity: preflight.databaseIdentity,
      startedAt: now,
      updatedAt: now,
      stages: {},
    };
  } else {
    try {
      checkpoint = await loadCheckpoint(options.checkpointFile!);
    } catch (error: any) {
      fail("CHECKPOINT_READ_FAILED", String(error?.message ?? error).slice(0, 200));
    }
    const resumeIssues = validateRepairCheckpointResume(checkpoint, {
      fromStage: options.fromStage,
      currentPlanHash: preflight.planHash,
      databaseIdentity: preflight.databaseIdentity,
    });
    if (resumeIssues.length > 0) {
      fail("CHECKPOINT_RESUME_REJECTED", resumeIssues.join(","));
    }
  }
  await persistCheckpoint(options.checkpointFile!, checkpoint);

  const runStage = async (
    stage: RepairStage,
    operation: () => Promise<unknown>,
    blocked: (result: any) => boolean = () => false,
  ): Promise<unknown> => {
    if (!shouldRunRepairStage(stage, options.fromStage)) return null;
    try {
      const result = await operation();
      checkpoint.stages[stage] = {
        status: blocked(result) ? "blocked" : "completed",
        completedAt: new Date().toISOString(),
        result,
      };
      await persistCheckpoint(options.checkpointFile!, checkpoint);
      console.log(`[institutional-repair] ${stage}: ${checkpoint.stages[stage]!.status}`);
      return result;
    } catch (error: any) {
      const safeError = String(error?.message ?? error).slice(0, 300);
      checkpoint.stages[stage] = {
        status: "failed",
        completedAt: new Date().toISOString(),
        result: {
          error: safeError,
          partialResult: error?.repairResult ?? null,
        },
      };
      await persistCheckpoint(options.checkpointFile!, checkpoint);
      throw error;
    }
  };

  const refreshResumePlanHash = async (): Promise<void> => {
    const refreshedPreflight = await loadInstitutionalRepairPreflight();
    checkpoint.resumePlanHash = refreshedPreflight.planHash;
    await persistCheckpoint(options.checkpointFile!, checkpoint);
  };

  const mappingResult = await runStage(
    "mapping",
    async () => applyInstitutionalMappingRepair(preflight.planHash),
  );
  if (mappingResult) {
    await refreshResumePlanHash();
  }

  const symbols = VERIFIED_REPAIR_MAPPINGS.map((mapping) => mapping.symbol);
  const aggregateResult = await runStage(
    "aggregates",
    async () => {
      const result = await rebuildInstitutionalAggregates({ symbols });
      if (result.failed > 0) {
        throw Object.assign(
          new Error(`AGGREGATE_REBUILD_PARTIAL:${result.failed}`),
          { repairResult: result },
        );
      }
      return result;
    },
  );
  if (aggregateResult) {
    await refreshResumePlanHash();
  }

  const signalResult = await runStage(
    "signals",
    async () => {
      const result = await rebuildInstitutionalSignals({ symbols });
      if (result.failed > 0) {
        throw Object.assign(
          new Error(`SIGNAL_REBUILD_PARTIAL:${result.failed}`),
          { repairResult: result },
        );
      }
      return result;
    },
  );
  if (signalResult) {
    await refreshResumePlanHash();
  }

  const snapshotResult = await runStage(
    "snapshots",
    async () => {
      const result = await runIntelligencePrecomputation();
      if (result.status === "failed") {
        throw Object.assign(
          new Error(`SNAPSHOT_REBUILD_FAILED:${result.error}`),
          { repairResult: result },
        );
      }
      return result;
    },
    (result) => result?.status === "blocked",
  );

  const validation = await runStage(
    "validation",
    async () => {
      const result = await validateInstitutionalRepairSymbols();
      const issues = evaluateInstitutionalRepairValidation(result, {
        repairStartedAt: checkpoint.startedAt,
        snapshotsRequired: (snapshotResult as any)?.status !== "blocked",
      });
      if (issues.length > 0) {
        throw Object.assign(
          new Error(`VALIDATION_FAILED:${issues.join(",")}`),
          { repairResult: { issues, validation: result } },
        );
      }
      return result;
    },
  );

  const snapshotsBlocked = (snapshotResult as any)?.status === "blocked";
  console.log(
    snapshotsBlocked
      ? "\n=== Institutional Production Repair Finished — Snapshots Blocked ==="
      : "\n=== Institutional Production Repair Complete ===",
  );
  console.log(JSON.stringify({
    planHash: preflight.planHash,
    checkpointFile: options.checkpointFile,
    validation,
  }, null, 2));
  console.log("INSTITUTIONAL_INTELLIGENCE_ENABLED was not changed.");
  if (snapshotsBlocked) {
    console.log("Run a normal Opportunity Engine scan, then resume from --from-stage snapshots.");
  }
  process.exit(snapshotsBlocked ? 2 : 0);
}

if (!process.env.VITEST) {
  main().catch((error: any) => {
    const message = String(error?.message ?? error).slice(0, 300);
    console.error(`[institutional-repair:fatal] ${message}`);
    process.exit(1);
  });
}
