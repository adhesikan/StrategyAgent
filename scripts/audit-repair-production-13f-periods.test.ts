import { describe, expect, it, vi } from "vitest";
import {
  buildHistoricalAuditReadOnlyUrl,
  chunkCanonicalCiks,
  extractAuthoritativeSecFilings,
  getHistoricalRepairApplyGuardIssues,
  HistoricalAuditBoundError,
  loadAuthoritativeSecMetadata,
  parseHistoricalPeriodAuditArgs,
  validateHistoricalAuditBounds,
  validateHistoricalPeriodAuditEnvironment,
} from "./audit-repair-production-13f-periods";
import { buildHistoricalFilingRepairPlan } from "../server/services/institutional/historical-filing-period-repair";

describe("historical filing-period production audit", () => {
  it("defaults to dry-run and requires explicit apply arguments", () => {
    expect(parseHistoricalPeriodAuditArgs([])).toMatchObject({
      apply: false,
      planHash: null,
      confirm: null,
      maxFilings: 5000,
      maxCiks: 5000,
      cikBatchSize: 100,
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

  it("keeps configurable batching deterministic and bounded by hard ceilings", () => {
    expect(chunkCanonicalCiks(["0000000003", "0000000001", "0000000002", "0000000001"], 2))
      .toEqual([["0000000001", "0000000002"], ["0000000003"]]);
    expect(validateHistoricalAuditBounds({
      maxFilings: 5000,
      maxCiks: 5000,
      cikBatchSize: 100,
    })).toEqual([]);
    expect(validateHistoricalAuditBounds({
      maxFilings: 10001,
      maxCiks: 5000,
      cikBatchSize: 100,
    })).toContain("MAX_FILINGS_HARD_CEILING_EXCEEDED");
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

  it("processes more than 1000 CIKs in deterministic serial batches", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => {
      const cik = String(index + 1).padStart(10, "0");
      return {
        id: `row-${index}`,
        rawAccession: `${cik}26000001`,
        filerCik: cik,
        filingDate: "2026-05-15",
        periodOfReport: "2026-03-31",
        filingType: "13F-HR",
        amendmentFlag: false,
        isEffective: true,
      };
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const progress: number[] = [];
    const fetchSec = vi.fn(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const cik = url.match(/CIK(\d{10})/)?.[1] ?? "0000000000";
      const response = JSON.stringify({
        filings: {
          recent: {
            accessionNumber: [`${cik}26000001`],
            filingDate: ["2026-05-15"],
            reportDate: ["2026-03-31"],
            form: ["13F-HR"],
          },
          files: [],
        },
      });
      inFlight--;
      return response;
    });
    const metadata = await loadAuthoritativeSecMetadata(rows, {
      maxCiks: 5000,
      cikBatchSize: 100,
      fetchSec,
      onProgress: (item) => progress.push(item.batchNumber),
    });
    expect(metadata.size).toBe(1001);
    expect(fetchSec).toHaveBeenCalledTimes(1001);
    expect(maxInFlight).toBe(1);
    expect(progress).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
  });

  it("returns structured population details when the CIK cap is exceeded", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => {
      const cik = String(index + 1).padStart(10, "0");
      return {
        id: `row-${index}`,
        rawAccession: `${cik}26000001`,
        filerCik: cik,
        filingDate: "2026-05-15",
        periodOfReport: "2026-03-31",
        filingType: "13F-HR",
        amendmentFlag: false,
        isEffective: true,
      };
    });
    const failure = await loadAuthoritativeSecMetadata(rows, {
      maxCiks: 1000,
      fetchSec: vi.fn(),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HistoricalAuditBoundError);
    expect((failure as HistoricalAuditBoundError).details).toMatchObject({
      error: "PRODUCTION_POPULATION_EXCEEDS_HARD_CAP",
      actualFilings: 1001,
      actualUniqueCiks: 1001,
      maxCiks: 1000,
    } satisfies Partial<HistoricalAuditBoundError["details"]>);
  });

  it("dry-run helpers have no database write dependency", () => {
    const execute = vi.fn();
    expect(execute).not.toHaveBeenCalled();
  });
});