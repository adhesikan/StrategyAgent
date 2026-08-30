import { describe, expect, it } from "vitest";
import {
  parseExpectedDatabase,
  validateDiscrepancyRuntime,
} from "./investigate-institutional-repair-duplicate-discrepancy";

describe("institutional repair discrepancy diagnostic safety", () => {
  it("requires an explicit expected database name", () => {
    expect(parseExpectedDatabase([])).toBeNull();
    expect(parseExpectedDatabase(["--database-name", "railway"])).toBe("railway");
  });

  it("fails closed unless the runtime is Railway production PostgreSQL", () => {
    expect(validateDiscrepancyRuntime({})).toEqual([
      "DATABASE_URL_REQUIRED",
      "RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION",
      "RAILWAY_PROJECT_ID_REQUIRED",
      "RAILWAY_SERVICE_ID_REQUIRED",
      "RAILWAY_ENVIRONMENT_ID_REQUIRED",
    ]);
    expect(validateDiscrepancyRuntime({
      DATABASE_URL: "postgresql://user:password@postgres.railway.internal:5432/railway",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment",
    })).toEqual([]);
    expect(validateDiscrepancyRuntime({
      DATABASE_URL: "postgresql://localhost/dev",
      EXTERNAL_DATABASE_URL: "configured",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment",
    })).toEqual([
      "EXTERNAL_DATABASE_URL_FORBIDDEN",
      "DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT",
    ]);
  });
});