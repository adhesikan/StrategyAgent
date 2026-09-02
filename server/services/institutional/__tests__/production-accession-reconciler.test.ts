import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  crossMatchExistingOnly,
  parseReconciliationArgs,
  summarizeCanonicalCollisions,
  validateReconciliationEnvironment,
} from "../../../../scripts/reconcile-production-13f-accessions";

describe("production accession reconciler", () => {
  it("contains no database mutation statement", () => {
    const source = readFileSync("scripts/reconcile-production-13f-accessions.ts", "utf8");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });

  it("requires production Railway shell identity and rejects external database indirection", () => {
    expect(() => validateReconciliationEnvironment({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: "postgres://redacted",
    })).toThrow("PRODUCTION_NODE_ENV_REQUIRED");
    expect(() => validateReconciliationEnvironment({
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: "postgres://redacted",
      EXTERNAL_DATABASE_URL: "postgres://redacted",
    })).toThrow("EXTERNAL_DATABASE_URL_FORBIDDEN");
  });

  it("accepts only an explicit ordered quarter range", () => {
    expect(parseReconciliationArgs(["--from-quarter", "2024-Q1", "--to-quarter", "2025-Q3"]))
      .toEqual({ fromQuarter: "2024-Q1", toQuarter: "2025-Q3" });
    expect(() => parseReconciliationArgs(["--from-quarter", "2024-Q1"])).toThrow("EXPLICIT_QUARTER_RANGE_REQUIRED");
  });

  it("compares canonical accessions and classifies raw collision variants", () => {
    const collisions = summarizeCanonicalCollisions([
      { rawAccession: "0000000001-24-000001" },
      { rawAccession: "000000000124000001" },
      { rawAccession: " 000000000224000002" },
      { rawAccession: "000000000224000002" },
    ]);
    expect(collisions.collisionGroups).toBe(2);
    expect(collisions.excessRows).toBe(2);
    expect(collisions.byCategory.DASHED_VS_UNDASHED).toMatchObject({ groups: 1, excessRows: 1 });
    expect(collisions.byCategory.WHITESPACE_OR_PUNCTUATION).toMatchObject({ groups: 1, excessRows: 1 });
  });

  it("performs deterministic cross-match without fuzzy issuer or ticker fields", () => {
    const source = [{
      rawAccession: "000000000124000001",
      canonicalAccession: "000000000124000001",
      filerCik: "0000000001",
      periodOfReport: "2024-03-31",
      filingDate: "2024-05-01",
      filingType: "13F-HR",
      amendmentFlag: false,
    }];
    const result = crossMatchExistingOnly([
      { ...source[0], rawAccession: "internal-1", canonicalAccession: "internal-1" },
      { ...source[0], rawAccession: "internal-2", canonicalAccession: "internal-2", filingDate: "2024-05-02" },
    ], source);
    expect(result.managerReportPeriodMatches).toBe(2);
    expect(result.managerReportPeriodFilingDateMatches).toBe(1);
    expect(result.uniqueDeterministicMatches).toBe(1);
    expect(result.ambiguousDeterministicMatches).toBe(0);
    expect(result.noDeterministicMatch).toBe(1);
  });
});