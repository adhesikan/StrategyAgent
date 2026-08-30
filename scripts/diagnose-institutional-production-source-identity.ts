#!/usr/bin/env tsx
/** Railway-production, SELECT-only SEC source-identity diagnostic. */
import { sql } from "drizzle-orm";
import { secFetchDetailed } from "../server/services/institutional/sec-client";
import { runProductionSourceIdentityDiagnostic } from "../server/services/institutional/production-source-identity-diagnostic";

const SEC_FETCH_TIMEOUT_MS = 30_000;
export async function fetchSecWithTimeout(url: string): Promise<{ text: string; legacyText: string; status: number; contentType: string | null; byteLength: number; decodingError: boolean; detectedEncoding: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEC_FETCH_TIMEOUT_MS);
  try {
    return await secFetchDetailed(url, undefined, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseExpectedDatabase(argv: string[]): string | null {
  const index = argv.indexOf("--database-name");
  return index >= 0 ? argv[index + 1]?.trim() || null : null;
}
function parseFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1]?.trim() || null : null;
}
export function validateExpectedRailwayIdentity(env: NodeJS.ProcessEnv, argv: string[]): string[] {
  const expectations = [
    ["--project-id", "RAILWAY_PROJECT_ID", "EXPECTED_PROJECT_ID_REQUIRED", "RAILWAY_PROJECT_ID_MISMATCH"],
    ["--service-id", "RAILWAY_SERVICE_ID", "EXPECTED_SERVICE_ID_REQUIRED", "RAILWAY_SERVICE_ID_MISMATCH"],
    ["--environment-id", "RAILWAY_ENVIRONMENT_ID", "EXPECTED_ENVIRONMENT_ID_REQUIRED", "RAILWAY_ENVIRONMENT_ID_MISMATCH"],
  ] as const;
  const issues: string[] = [];
  for (const [flag, envName, missing, mismatch] of expectations) {
    const expected = parseFlag(argv, flag);
    if (!expected) issues.push(missing);
    else if (env[envName] !== expected) issues.push(mismatch);
  }
  return issues;
}
export function validateProductionSourceDiagnosticRuntime(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  if (!env.RAILWAY_PROJECT_ID) issues.push("RAILWAY_PROJECT_ID_REQUIRED");
  if (!env.RAILWAY_SERVICE_ID) issues.push("RAILWAY_SERVICE_ID_REQUIRED");
  if (!env.RAILWAY_ENVIRONMENT_ID) issues.push("RAILWAY_ENVIRONMENT_ID_REQUIRED");
  if (!env.SEC_USER_AGENT?.trim()) issues.push("SEC_USER_AGENT_REQUIRED");
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !(url.hostname.endsWith(".railway.internal") || url.hostname.endsWith(".rlwy.net"))) {
      issues.push("DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT");
    }
  } catch { if (env.DATABASE_URL) issues.push("DATABASE_URL_INVALID"); }
  return issues;
}
function rowsOf(result: unknown): any[] { return (result as any).rows ?? (Array.isArray(result) ? result : []); }
async function main(): Promise<void> {
  const issues = validateProductionSourceDiagnosticRuntime(process.env);
  issues.push(...validateExpectedRailwayIdentity(process.env, process.argv.slice(2)));
  if (issues.length) throw new Error(`DATABASE_RUNTIME_REJECTED:${issues.join(",")}`);
  const expected = parseExpectedDatabase(process.argv.slice(2));
  if (!expected) throw new Error("DATABASE_RUNTIME_REJECTED:EXPECTED_DATABASE_NAME_REQUIRED");
  const { db } = await import("../server/db");
  const identity = rowsOf(await db.execute(sql`SELECT current_database() AS database`))[0];
  if (identity?.database !== expected) throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_IDENTITY_MISMATCH");
  const report = await runProductionSourceIdentityDiagnostic(db as any, fetchSecWithTimeout);
  console.log(JSON.stringify({ ...report, productionApply: "NO" }, null, 2));
}
if (!process.env.VITEST) main().catch((error: any) => {
  console.error(`[production-source-identity-diagnostic] ERROR: ${String(error?.message ?? error).slice(0, 500)}`);
  process.exitCode = 1;
}).finally(() => {
  // This command has no apply mode, including when its fail-closed guards fire.
  console.log("PRODUCTION APPLY: NO");
});