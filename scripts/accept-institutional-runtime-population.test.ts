import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getStockInstitutionalAnalytics } from "../server/services/institutional/analytics/stock-analytics";
import {
  runRuntimeServiceAcceptance,
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

  it("is bounded, read-only, batched, and invokes the actual services", () => {
    const source = readFileSync(
      new URL("./accept-institutional-runtime-population.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("default_transaction_read_only=on");
    expect(source).toContain("BEGIN READ ONLY");
    expect(source).toContain("TIMEOUT_MS = 180_000");
    expect(source).toContain("resolveCanonicalInstitutionalSecurityContexts");
    expect(source).toContain("loadCanonicalRuntimeSupport");
    expect(source).toContain("getStockInstitutionalAnalytics");
    expect(source).toContain("getStockInstitutionalTrend");
    expect(source).not.toContain("buildRuntimeAcceptanceReport");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    expect(source).not.toMatch(/\b(fetch|axios)\b/i);
  });

  it("classifies direct, mapping-backed, multi-CUSIP, and actual service states", async () => {
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
    const stockAvailability = new Map<string, string>([
      ["DIRECT", "AVAILABLE"],
      ["MAPPED", "PARTIAL"],
      ["MULTI", "AVAILABLE"],
      ["NOPOS", "NO_REPORTED_POSITION"],
      ["SHORT", "INSUFFICIENT_HISTORY"],
    ]);
    const report = await runRuntimeServiceAcceptance(
      ["DIRECT", "MAPPED", "MULTI", "NOPOS", "SHORT", "UNSUPPORTED"],
      contexts,
      support,
      {
        getStockInstitutionalAnalytics: async (symbol) => ({
          availability: stockAvailability.get(symbol),
        }) as any,
        getStockInstitutionalTrend: async (symbol) => ({
          classification: symbol === "SHORT"
            ? "INSUFFICIENT_DATA"
            : "ACCUMULATION",
          quarters: symbol === "SHORT" ? [{}] : [{}, {}],
        }) as any,
      },
    );
    expect(report.stockViewServiceCalls).toBe(6);
    expect(report.stockViewAvailable).toBe(2);
    expect(report.stockViewPartial).toBe(1);
    expect(report.stockViewNoReportedPosition).toBe(1);
    expect(report.trendInsufficientHistory).toBe(1);
    expect(report.stockViewUnexpectedUnsupported).toBe(1);
    expect(report.unexpectedSamples.IDENTITY_CONTRACT).toEqual(["UNSUPPORTED"]);
    expect(report.acceptance).toBe("FAIL");
  });

  it("passes canonical context into the actual Stock View service so prerequisites cannot disagree", async () => {
    const context = {
      requestedSymbol: "JPM",
      normalizedSymbol: "JPM",
      canonicalCusips: ["46625H100"],
      assetType: "common_stock" as const,
      stockAnalyticsEligible: true as const,
      identityProvenance:
        "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY" as const,
      currentEffectivePeriod: "2026-06-30",
    };
    const report = await runRuntimeServiceAcceptance(
      ["JPM"],
      new Map([["JPM", context]]),
      {
        holdingsBySymbol: new Map([
          ["JPM", { eligibleHoldingCount: 100, latestPeriod: "2026-06-30" }],
        ]),
        aggregatesBySymbol: new Map([["JPM", [{}, {}] as any]]),
        signalsBySymbol: new Map(),
        signalAvailableSymbols: new Set(["JPM"]),
      },
      {
        getStockInstitutionalAnalytics: (symbol, canonicalContext) =>
          getStockInstitutionalAnalytics(
            symbol,
            "latest",
            {},
            {
              getStockInstitutionalSource: async (query) => ({
                symbol: query.symbol,
                candidateCusips:
                  query.canonicalContext?.canonicalCusips ?? [],
                hasReliableSecurityIdentity:
                  query.canonicalContext?.stockAnalyticsEligible ?? false,
                hasTargetSpecificCandidateEvidence:
                  Boolean(query.canonicalContext),
                quarter: {
                  id: "2026-Q2",
                  label: "Q2 2026",
                  periodEndDate: "2026-06-30",
                },
                previousQuarter: null,
                dataAsOf: "2026-06-30",
                currentHoldings: [],
                previousHoldings: [],
                managerPortfolioValues: {},
                currentFilingManagerIds: [],
                comparableManagerIds: [],
              }) as any,
            },
            canonicalContext,
          ),
        getStockInstitutionalTrend: async () => ({
          classification: "ACCUMULATION",
          quarters: [{}, {}],
        }) as any,
      },
    );
    expect(report.stockViewNoReportedPosition).toBe(1);
    expect(report.stockViewUnexpectedUnsupported).toBe(0);
    expect(report.acceptance).toBe("PASS");
  });

  it("separates repository failures from unexpected runtime exceptions", async () => {
    const context = {
      requestedSymbol: "FAIL",
      normalizedSymbol: "FAIL",
      canonicalCusips: ["111111111"],
      assetType: "common_stock" as const,
      stockAnalyticsEligible: true as const,
      identityProvenance:
        "CANONICAL_EFFECTIVE_HOLDINGS_TRUSTED_IDENTITY" as const,
      currentEffectivePeriod: "2026-06-30",
    };
    const repositoryFailure = Object.assign(new Error("database unavailable"), {
      name: "StockViewRepositoryStageError",
    });
    const report = await runRuntimeServiceAcceptance(
      ["FAIL"],
      new Map([["FAIL", context]]),
      {
        holdingsBySymbol: new Map(),
        aggregatesBySymbol: new Map(),
        signalsBySymbol: new Map(),
        signalAvailableSymbols: new Set(),
      },
      {
        getStockInstitutionalAnalytics: async () => { throw repositoryFailure; },
        getStockInstitutionalTrend: async () => { throw new Error("boom"); },
      },
    );
    expect(report.stockViewUpstreamError).toBe(1);
    expect(report.stockViewRuntimeExceptions).toBe(0);
    expect(report.trendRuntimeExceptions).toBe(1);
    expect(report.acceptance).toBe("FAIL");
  });
});