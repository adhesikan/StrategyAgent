import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildReconciliationReadOnlyUrl,
  parseReconciliationArguments,
  selectResolverFilingPeriods,
  validateReconciliationRuntime,
} from "./reconcile-live-stock-resolver";

describe("live Stock View reconciliation CLI safety", () => {
  const env = {
    DATABASE_URL: "postgresql://user:secret@db.railway.internal/prod",
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_SERVICE_ID: "service",
    RAILWAY_ENVIRONMENT_ID: "environment",
  };

  it("requires expected commit and database and rejects external URLs", () => {
    expect(validateReconciliationRuntime(env, {
      expectedCommit: null,
      expectedDatabase: null,
    })).toEqual(expect.arrayContaining(["EXPECTED_COMMIT_REQUIRED", "EXPECTED_DATABASE_REQUIRED"]));
    expect(validateReconciliationRuntime({
      ...env,
      EXTERNAL_DATABASE_URL: "postgresql://external",
    }, {
      expectedCommit: "abc",
      expectedDatabase: "prod",
    })).toContain("EXTERNAL_DATABASE_URL_FORBIDDEN");
  });

  it("parses fail-closed identity arguments", () => {
    expect(parseReconciliationArguments([
      "--expected-commit", "abc", "--expected-database", "prod",
    ])).toEqual({ expectedCommit: "abc", expectedDatabase: "prod" });
  });

  it("forces default transaction read-only without exposing credentials", () => {
    const url = buildReconciliationReadOnlyUrl(env.DATABASE_URL);
    expect(new URL(url).searchParams.get("options")).toBe("-c default_transaction_read_only=on");
  });

  it("falls back to the prior calendar quarter when aggregate prev period is null", () => {
    expect(selectResolverFilingPeriods("2026-03-31", null)).toEqual([
      "2026-03-31",
      "2025-12-31",
    ]);
    expect(selectResolverFilingPeriods("2026-03-31", "2025-09-30")).toEqual([
      "2026-03-31",
      "2025-09-30",
    ]);
  });

  it("contains no write SQL or mutation/ingestion imports", () => {
    const source = readFileSync(new URL("./reconcile-live-stock-resolver.ts", import.meta.url), "utf8");
    expect(source).toContain("SET TRANSACTION READ ONLY");
    expect(source).toContain("assertReadOnlySql(statement)");
    expect(source).not.toContain("DATABASE_RUNTIME_REJECTED:COMMIT_MISMATCH");
    expect(source).not.toContain("DATABASE_RUNTIME_REJECTED:DATABASE_MISMATCH");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM)\b/);
    expect(source).not.toMatch(/import\([^)]*(mutation|ingestion|apply)/i);
    expect(source).not.toContain("console.log(process.env.DATABASE_URL");
  });
});