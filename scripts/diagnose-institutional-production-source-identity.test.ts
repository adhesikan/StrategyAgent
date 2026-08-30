import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseExpectedDatabase,
  validateExpectedRailwayIdentity,
  validateProductionSourceDiagnosticRuntime,
} from "./diagnose-institutional-production-source-identity";

describe("production source identity script guards", () => {
  it("requires expected Railway production database identity and a nonblank SEC user agent", () => {
    expect(parseExpectedDatabase([])).toBeNull();
    expect(parseExpectedDatabase(["--database-name", "railway"])).toBe("railway");
    expect(validateProductionSourceDiagnosticRuntime({
      DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
      RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service", RAILWAY_ENVIRONMENT_ID: "environment", SEC_USER_AGENT: " ",
    })).toContain("SEC_USER_AGENT_REQUIRED");
    expect(validateProductionSourceDiagnosticRuntime({
      DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
      EXTERNAL_DATABASE_URL: "forbidden", RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project", RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment", SEC_USER_AGENT: "Diagnostic ops@example.com",
    })).toEqual(["EXTERNAL_DATABASE_URL_FORBIDDEN"]);
  });

  it("keeps DB import dynamic and contains no write or ingestion/backfill import", () => {
    const source = readFileSync(new URL("./diagnose-institutional-production-source-identity.ts", import.meta.url), "utf8");
    expect(source).toContain('await import("../server/db")');
    expect(source).not.toMatch(/from ["'][^"']*(ingestion|backfill)/i);
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  });

  it("requires and exactly matches every operator-provided Railway ID", () => {
    const env = {
      RAILWAY_PROJECT_ID: "project", RAILWAY_SERVICE_ID: "service", RAILWAY_ENVIRONMENT_ID: "environment",
    };
    expect(validateExpectedRailwayIdentity(env, [])).toEqual([
      "EXPECTED_PROJECT_ID_REQUIRED", "EXPECTED_SERVICE_ID_REQUIRED", "EXPECTED_ENVIRONMENT_ID_REQUIRED",
    ]);
    expect(validateExpectedRailwayIdentity(env, [
      "--project-id", "wrong", "--service-id", "wrong", "--environment-id", "wrong",
    ])).toEqual([
      "RAILWAY_PROJECT_ID_MISMATCH", "RAILWAY_SERVICE_ID_MISMATCH", "RAILWAY_ENVIRONMENT_ID_MISMATCH",
    ]);
    expect(validateExpectedRailwayIdentity(env, [
      "--project-id", "project", "--service-id", "service", "--environment-id", "environment",
    ])).toEqual([]);
  });
});