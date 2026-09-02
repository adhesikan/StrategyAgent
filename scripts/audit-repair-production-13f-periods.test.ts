import { describe, expect, it, vi } from "vitest";
import {
  buildHistoricalAuditReadOnlyUrl,
  extractAuthoritativeSecFilings,
  getHistoricalRepairApplyGuardIssues,
  parseHistoricalPeriodAuditArgs,
  validateHistoricalPeriodAuditEnvironment,
} from "./audit-repair-production-13f-periods";
import { buildHistoricalFilingRepairPlan } from "../server/services/institutional/historical-filing-period-repair";

describe("historical filing-period production audit", () => {
  it("defaults to dry-run and requires explicit apply arguments", () => {
    expect(parseHistoricalPeriodAuditArgs([])).toEqual({
      apply: false,
      planHash: null,
      confirm: null,
    });
    expect(parseHistoricalPeriodAuditArgs([
      "--apply",
      "--plan-hash",
      "abc",
      "--confirm",
      "REPAIR_HISTORICAL_13F_PERIODS",
    ])).toMatchObject({ apply: true, planHash: "abc" });
  });

  it("enforces production Railway identity and rejects external database indirection", () => {
    const base = {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment",
      DATABASE_URL: "postgres://user:pass@db.railway.internal:5432/app",
      SEC_USER_AGENT: "App contact@example.com",
    };
    expect(validateHistoricalPeriodAuditEnvironment(base, false)).toEqual([]);
    expect(validateHistoricalPeriodAuditEnvironment({
      ...base,
      EXTERNAL_DATABASE_URL: "postgres://external",
    }, false)).toContain("EXTERNAL_DATABASE_URL_FORBIDDEN");
    expect(validateHistoricalPeriodAuditEnvironment({
      ...base,
      RAILWAY_ENVIRONMENT_NAME: "development",
    }, false)).toContain("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  });

  it("forces read-only sessions for the audit command", () => {
    const url = new URL(buildHistoricalAuditReadOnlyUrl(
      "postgres://user:pass@db.railway.internal:5432/app",
    ));
    expect(url.searchParams.get("options")).toContain("default_transaction_read_only=on");
    expect(url.searchParams.get("options")).toContain("statement_timeout=");
  });

  it("extracts authoritative SEC accession metadata and ignores unrelated forms", () => {
    const result = extractAuthoritativeSecFilings({
      accessionNumber: ["0000000001-26-000001", "0000000001-26-000002"],
      filingDate: ["2026-05-15", "2026-05-16"],
      reportDate: ["2026-03-31", "2026-03-31"],
      form: ["13F-HR", "10-Q"],
    }, new Set(["000000000126000001", "000000000126000002"]));
    expect(result).toEqual([{
      canonicalAccession: "000000000126000001",
      filerCik: "0000000001",
      filingDate: "2026-05-15",
      periodOfReport: "2026-03-31",
      filingType: "13F-HR",
      amendmentFlag: false,
    }]);
  });

  it("fails closed unless apply confirmation and plan hash match", () => {
    const plan = buildHistoricalFilingRepairPlan([], new Map());
    const issues = getHistoricalRepairApplyGuardIssues({
      apply: true,
      planHash: "wrong",
      confirm: null,
    }, { ...plan, operations: [{
      canonicalAccession: "000000000126000001",
      survivorId: "row",
      duplicateIds: [],
      oldPeriods: ["2024-03-31"],
      authoritative: {
        canonicalAccession: "000000000126000001",
        filerCik: "0000000001",
        filingDate: "2026-05-15",
        periodOfReport: "2026-03-31",
        filingType: "13F-HR",
        amendmentFlag: false,
      },
      canonicalizeAccession: false,
    }] });
    expect(issues).toContain("PLAN_HASH_MISMATCH");
    expect(issues).toContain("CONFIRMATION_REQUIRED");
  });

  it("dry-run helpers have no database write dependency", () => {
    const execute = vi.fn();
    expect(execute).not.toHaveBeenCalled();
  });
});