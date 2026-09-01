import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRuntimeAcceptanceEnvironment } from "./accept-institutional-runtime-population";

describe("institutional runtime population acceptance guards", () => {
  it("requires an identified Railway production database", () => {
    expect(validateRuntimeAcceptanceEnvironment({})).toEqual([
      "DATABASE_URL_REQUIRED",
      "RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION",
      "RAILWAY_PROJECT_ID_REQUIRED",
      "RAILWAY_SERVICE_ID_REQUIRED",
      "RAILWAY_ENVIRONMENT_ID_REQUIRED",
    ]);
    expect(validateRuntimeAcceptanceEnvironment({
      DATABASE_URL: "postgresql://user:pass@postgres.railway.internal:5432/railway",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment",
    })).toEqual([]);
  });

  it("is bounded, read-only, batched, and imports shared runtime loaders", () => {
    const source = readFileSync(
      new URL("./accept-institutional-runtime-population.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("default_transaction_read_only=on");
    expect(source).toContain("BEGIN READ ONLY");
    expect(source).toContain("TIMEOUT_MS = 180_000");
    expect(source).toContain("resolveCanonicalInstitutionalSecurityContexts");
    expect(source).toContain("loadCanonicalRuntimeSupport");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    expect(source).not.toMatch(/\b(fetch|axios)\b/i);
  });
});