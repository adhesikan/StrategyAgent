import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeAcceptanceReport,
  validateRuntimeAcceptanceEnvironment,
} from "./accept-institutional-runtime-population";

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

  it("classifies direct, mapping-backed, multi-CUSIP, and availability states", () => {
    const context = (symbol: string, canonicalCusips: string[]) => ({
      requestedSymbol: symbol,
      normalizedSymbol: symbol,
      canonicalCusips,
      assetType: "common_stock" as const,
      stockAnalyticsEligible: true as const,
      identityProvenance:
        "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY" as const,
      currentEffectivePeriod: "2026-06-30",
    });
    const contexts = new Map([
      ["DIRECT", context("DIRECT", ["111111111"])],
      ["MAPPED", context("MAPPED", ["222222222"])],
      ["MULTI", context("MULTI", ["333333333", "444444444"])],
      ["NOPOS", context("NOPOS", ["555555555"])],
      ["SHORT", context("SHORT", ["666666666"])],
    ]);
    const aggregate = (coverageStatus = "complete") => ({
      coverageStatus,
    }) as any;
    const support = {
      holdingsBySymbol: new Map([
        ["DIRECT", { eligibleHoldingCount: 3, latestPeriod: "2026-06-30" }],
        ["MAPPED", { eligibleHoldingCount: 2, latestPeriod: "2026-06-30" }],
        ["MULTI", { eligibleHoldingCount: 4, latestPeriod: "2026-06-30" }],
        ["NOPOS", { eligibleHoldingCount: 0, latestPeriod: null }],
        ["SHORT", { eligibleHoldingCount: 1, latestPeriod: "2026-06-30" }],
      ]),
      aggregatesBySymbol: new Map([
        ["DIRECT", [aggregate(), aggregate()]],
        ["MAPPED", [aggregate(), aggregate()]],
        ["MULTI", [aggregate(), aggregate()]],
        ["NOPOS", [aggregate(), aggregate()]],
        ["SHORT", [aggregate()]],
      ]),
      signalsBySymbol: new Map(),
      signalAvailableSymbols: new Set(["DIRECT", "MAPPED", "MULTI", "NOPOS"]),
    };
    const report = buildRuntimeAcceptanceReport(
      ["DIRECT", "MAPPED", "MULTI", "NOPOS", "SHORT", "UNSUPPORTED"],
      contexts,
      support,
    );
    expect(report.identityResolved).toBe(5);
    expect(report.identityFailed).toBe(1);
    expect(report.holdingsLoaded).toBe(4);
    expect(report.stockViewNoReportedPosition).toBe(1);
    expect(report.trendInsufficientHistory).toBe(1);
    expect(report.stockViewUnexpectedUnsupported).toBe(1);
    expect(report.unexpectedSamples.IDENTITY_CONTRACT).toEqual(["UNSUPPORTED"]);
    expect(report.acceptance).toBe("FAIL");
  });
});