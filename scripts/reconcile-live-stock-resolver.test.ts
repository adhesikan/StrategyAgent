import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildReconciliationReadOnlyUrl,
  EVIDENCE_ACCESSION_BATCH_SIZE,
  RECONCILIATION_TIMEOUT_MS,
  parseReconciliationArguments,
  selectResolverFilingPeriods,
  selectResolverAccessionsBySymbol,
  validateReconciliationRuntime,
  withReconciliationTimeout,
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

  it("groups filing selection so shared periods do not create an N+1 selector loop", () => {
    const calls: string[] = [];
    const accessions = selectResolverAccessionsBySymbol(
      ["ABC", "DEF", "GHI"],
      new Map([
        ["ABC", { symbol: "ABC", periodOfReport: "2026-03-31", prevPeriodOfReport: null }],
        ["DEF", { symbol: "DEF", periodOfReport: "2026-03-31", prevPeriodOfReport: null }],
        ["GHI", { symbol: "GHI", periodOfReport: "2025-12-31", prevPeriodOfReport: "2025-09-30" }],
      ]),
      "2026-03-31",
      [
        { accessionNumber: "a", managerId: "1", managerName: "One", periodOfReport: "2026-03-31", filingDate: "2026-05-01", isEffective: true },
        { accessionNumber: "b", managerId: "1", managerName: "One", periodOfReport: "2025-12-31", filingDate: "2026-02-01", isEffective: true },
      ],
      (rows, requestedQuarter, aggregate) => {
        calls.push(`${requestedQuarter}:${aggregate?.quarter.periodEndDate ?? "latest"}:${rows.length}`);
        return rows.length
          ? { currentFilings: [{ accessionNumber: rows[0].accessionNumber }], previousFilings: [] }
          : null;
      },
    );
    expect(calls).toHaveLength(2);
    expect(accessions).toEqual({ ABC: ["a"], DEF: ["a"], GHI: ["b"] });
  });

  it("fails closed at the hard timeout without changing the timeout contract", async () => {
    await expect(withReconciliationTimeout(
      () => new Promise<never>(() => {}),
      1,
    )).rejects.toThrow("RECONCILIATION_TIMEOUT");
    expect(RECONCILIATION_TIMEOUT_MS).toBeLessThan(5 * 60 * 1000);
    expect(EVIDENCE_ACCESSION_BATCH_SIZE).toBeGreaterThan(0);
  });

  it("contains no write SQL or mutation/ingestion imports", () => {
    const source = readFileSync(new URL("./reconcile-live-stock-resolver.ts", import.meta.url), "utf8");
    expect(source).toContain("SET TRANSACTION READ ONLY");
    expect(source).toContain("assertReadOnlySql(statement)");
    expect(source).toContain("EVIDENCE_ACCESSION_BATCH_SIZE");
    expect(source).toContain("statement_timeout");
    expect(source).not.toContain("DATABASE_RUNTIME_REJECTED:COMMIT_MISMATCH");
    expect(source).not.toContain("DATABASE_RUNTIME_REJECTED:DATABASE_MISMATCH");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM)\b/);
    expect(source).not.toMatch(/import\([^)]*(mutation|ingestion|apply)/i);
    expect(source).not.toContain("console.log(process.env.DATABASE_URL");
    expect(source).toContain("close: async () => undefined");
  });
});