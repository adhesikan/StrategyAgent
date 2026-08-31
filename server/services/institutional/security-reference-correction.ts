import { createHash } from "node:crypto";
import type {
  CanonicalCorrectionAction,
  InstitutionalAssetTypeCorrectionPlan,
} from "./security-reference-enrichment-planner";

export const INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION =
  "APPLY_INSTITUTIONAL_SECURITY_TYPE_CORRECTIONS";
export const INSTITUTIONAL_SECURITY_TYPE_CORRECTION_LOCK_KEY = 774_412_005;

export interface CorrectionApplyTransaction {
  loadPlan(): Promise<InstitutionalAssetTypeCorrectionPlan>;
  applyTypeCorrection(action: Extract<CanonicalCorrectionAction, { action: "TYPE_CORRECTION" }>): Promise<void>;
  applySymbolCorrection(action: Extract<CanonicalCorrectionAction, { action: "SYMBOL_CORRECTION" }>): Promise<void>;
}

export interface CorrectionApplyDatabase {
  identity(): Promise<{ database: string; schema: string }>;
  withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T>;
  transaction<T>(fn: (tx: CorrectionApplyTransaction) => Promise<T>): Promise<T>;
}

export function validateSecurityTypeCorrectionApplyRequest(input: {
  apply: boolean;
  confirmation?: string | null;
  environment?: string | null;
  railwayEnvironment?: string | null;
  nodeEnvironment?: string | null;
  correctionApplyEnabled?: string | null;
  expectedDatabase?: string | null;
  currentDatabase?: string | null;
  expectedSchema?: string | null;
  currentSchema?: string | null;
  databaseUrl?: string | null;
  externalDatabaseUrl?: string | null;
  suppliedPlanHash?: string | null;
  freshPlanHash?: string | null;
}): string[] {
  if (!input.apply) return [];
  const issues: string[] = [];
  if (input.confirmation !== INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION) {
    issues.push("CORRECTION_CONFIRMATION_REQUIRED");
  }
  if (input.environment !== "production") issues.push("PRODUCTION_ENVIRONMENT_ARGUMENT_REQUIRED");
  if (input.railwayEnvironment?.toLowerCase() !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (input.nodeEnvironment !== "production") issues.push("NODE_ENV_PRODUCTION_REQUIRED");
  if (input.correctionApplyEnabled !== "true") {
    issues.push("SECURITY_TYPE_CORRECTION_APPLY_GUARD_REQUIRED");
  }
  if (!input.databaseUrl) issues.push("DATABASE_URL_REQUIRED");
  if (input.externalDatabaseUrl) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (!input.expectedDatabase) issues.push("EXPECTED_DATABASE_NAME_REQUIRED");
  else if (input.expectedDatabase !== input.currentDatabase) issues.push("DATABASE_IDENTITY_MISMATCH");
  if (!input.expectedSchema) issues.push("EXPECTED_SCHEMA_NAME_REQUIRED");
  else if (input.expectedSchema !== input.currentSchema) issues.push("SCHEMA_IDENTITY_MISMATCH");
  if (!input.suppliedPlanHash || input.suppliedPlanHash !== input.freshPlanHash) {
    issues.push("FRESH_CORRECTION_PLAN_HASH_REQUIRED");
  }
  return issues;
}

export function correctionPlanHash(plan: InstitutionalAssetTypeCorrectionPlan): string {
  return plan.planHash;
}

/**
 * Applies only the exact, freshly reloaded canonical correction artifact.
 * The injected transaction owns rollback; no derived institutional data is
 * touched by this operation.
 */
export async function applyInstitutionalSecurityTypeCorrections(input: {
  database: CorrectionApplyDatabase;
  artifact: InstitutionalAssetTypeCorrectionPlan;
  confirmation?: string | null;
  environment?: string | null;
  railwayEnvironment?: string | null;
  nodeEnvironment?: string | null;
  correctionApplyEnabled?: string | null;
  expectedDatabase?: string | null;
  expectedSchema?: string | null;
  databaseUrl?: string | null;
  externalDatabaseUrl?: string | null;
  suppliedPlanHash?: string | null;
}): Promise<{ planHash: string; typeCorrections: number; symbolCorrections: number }> {
  const identity = await input.database.identity();
  const issues = validateSecurityTypeCorrectionApplyRequest({
    apply: true,
    confirmation: input.confirmation,
    environment: input.environment,
    railwayEnvironment: input.railwayEnvironment,
    nodeEnvironment: input.nodeEnvironment,
    correctionApplyEnabled: input.correctionApplyEnabled,
    expectedDatabase: input.expectedDatabase,
    currentDatabase: identity.database,
    expectedSchema: input.expectedSchema,
    currentSchema: identity.schema,
    databaseUrl: input.databaseUrl,
    externalDatabaseUrl: input.externalDatabaseUrl,
    suppliedPlanHash: input.suppliedPlanHash,
    freshPlanHash: input.artifact.planHash,
  });
  if (issues.length) throw new Error(`SECURITY_TYPE_CORRECTION_REJECTED:${issues.join(",")}`);

  return input.database.withAdvisoryLock(INSTITUTIONAL_SECURITY_TYPE_CORRECTION_LOCK_KEY, async () =>
    input.database.transaction(async (tx) => {
      const fresh = await tx.loadPlan();
      if (fresh.planHash !== input.artifact.planHash || fresh.planHash !== input.suppliedPlanHash) {
        throw new Error("SECURITY_TYPE_CORRECTION_REJECTED:STALE_PLAN_HASH");
      }
      if (fresh.blockers.insufficientEvidenceCusips > 0 ||
          fresh.blockers.contradictoryEvidenceCusips > 0 ||
          fresh.blockers.canonicalSymbolReviewRequiredCusips > 0) {
        // A blocker is reportable, but never a reason to guess or partially
        // apply a correction artifact.
        throw new Error("SECURITY_TYPE_CORRECTION_REJECTED:UNRESOLVED_CANONICAL_BLOCKERS");
      }
      let typeCorrections = 0;
      let symbolCorrections = 0;
      for (const action of fresh.actions) {
        if (action.action === "TYPE_CORRECTION") {
          await tx.applyTypeCorrection(action);
          typeCorrections++;
        } else {
          await tx.applySymbolCorrection(action);
          symbolCorrections++;
        }
      }
      return { planHash: fresh.planHash, typeCorrections, symbolCorrections };
    }),
  );
}

export function hashCorrectionIdentity(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}