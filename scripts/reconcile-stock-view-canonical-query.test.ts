import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSetBasedStockViewQuery,
  buildStockViewReconciliationReport,
  MAX_MISMATCH_SAMPLES,
  parseStockViewReconciliationArguments,
  validateStockViewReconciliationArguments,
} from "./reconcile-stock-view-canonical-query";
import { RECONCILIATION_TIMEOUT_MS, withReconciliationTimeout } from "./reconcile-live-stock-resolver";

const metadata = {
  runtimeDatabaseName: "railway",
  runtimeSchemaName: "public",
  runningCommit: "abc",
  expectedCommit: "abc",
  queryCount: 5,
  runtimeMs: 12,
};

function report(overrides: Record<string, unknown> = {}) {
  return buildStockViewReconciliationReport({
    canonicalIdentities: [{ cusip: "111111111", symbol: "ABC" }],
    stockViewRows: [{ cusip: "111111111", symbol: "ABC", assetType: "common_stock" }],
    traceRows: [{
      cusip: "111111111",
      requestedSymbol: "ABC",
      trustedSymbol: "ABC",
      effectiveHoldingSelected: true,
      mappingEvidencePresent: false,
      securityMasterTickerMatch: true,
      securityMasterPresent: true,
      securityMasterReviewStatus: "reviewed",
      assetType: "common_stock",
      shareClassValid: true,
    }],
    ...metadata,
    ...overrides,
  });
}

describe("actual Stock View canonical query reconciliation", () => {
  it("uses the shared production query and only generalizes its final symbol parameter", () => {
    const query = buildSetBasedStockViewQuery();
    expect(query).toContain("WITH");
    expect(query).toContain("canonical_effective_holdings");
    expect(query).toContain("WHERE symbol = ANY($1::text[])");
    expect(query).toContain("asset_type IN ('common_stock', 'reit')");
    expect(query).not.toContain("target_cusips");
  });

  it("reconciles direct security-master identity", () => {
    expect(report()).toMatchObject({
      canonicalSymbols: 1,
      canonicalCusips: 1,
      stockViewResolvableSymbols: 1,
      identitySetMismatchSymbols: 0,
      directSecurityMasterCanonicalSymbols: 1,
      directSecurityMasterResolvableSymbols: 1,
    });
  });

  it("reconciles mapping-backed identity", () => {
    expect(report({
      traceRows: [{
        cusip: "111111111",
        requestedSymbol: "ABC",
        trustedSymbol: "ABC",
        effectiveHoldingSelected: true,
        mappingEvidencePresent: true,
        securityMasterTickerMatch: false,
        securityMasterPresent: true,
        securityMasterReviewStatus: "unmapped",
        assetType: "common_stock",
        shareClassValid: true,
      }],
    })).toMatchObject({
      mappingBackedCanonicalSymbols: 1,
      mappingBackedStockViewResolvableSymbols: 1,
      mappingBackedStockViewUnresolvableSymbols: 0,
      directSecurityMasterCanonicalSymbols: 0,
    });
  });

  it("requires all CUSIPs for a multi-CUSIP symbol to match exactly", () => {
    const result = report({
      canonicalIdentities: [
        { cusip: "111111111", symbol: "ABC" },
        { cusip: "222222222", symbol: "ABC" },
      ],
      stockViewRows: [{ cusip: "111111111", symbol: "ABC", assetType: "common_stock" }],
      traceRows: [{
        cusip: "111111111",
        requestedSymbol: "ABC",
        trustedSymbol: "ABC",
        effectiveHoldingSelected: true,
        mappingEvidencePresent: true,
        securityMasterTickerMatch: false,
        securityMasterPresent: true,
        securityMasterReviewStatus: "unmapped",
        assetType: "common_stock",
        shareClassValid: true,
      }],
    });
    expect(result).toMatchObject({
      stockViewResolvableSymbols: 0,
      identitySetMismatchSymbols: 1,
      canonicalOnlyCusips: 1,
      mismatchSamples: [{
        symbol: "ABC",
        canonicalCusips: ["111111111", "222222222"],
        stockViewCusips: ["111111111"],
      }],
    });
  });

  it("reports mismatch evidence and caps samples at ten", () => {
    const canonicalIdentities = Array.from({ length: 14 }, (_, index) => ({
      cusip: String(index).padStart(9, "0"),
      symbol: `S${index}`,
    }));
    const result = report({
      canonicalIdentities,
      stockViewRows: [],
      traceRows: canonicalIdentities.map((row) => ({
        ...row,
        requestedSymbol: row.symbol,
        trustedSymbol: row.symbol,
        effectiveHoldingSelected: true,
        mappingEvidencePresent: true,
        securityMasterTickerMatch: false,
        securityMasterPresent: true,
        securityMasterReviewStatus: "unmapped",
        assetType: "common_stock",
        shareClassValid: true,
      })),
    });
    expect(result.identitySetMismatchSymbols).toBe(14);
    expect(result.mismatchSamples).toHaveLength(MAX_MISMATCH_SAMPLES);
    expect(result.mismatchSamples[0]).toMatchObject({
      mappingEvidencePresent: true,
      securityMasterTickerMatch: false,
      firstFailedPredicate: "CANONICAL_GROUPING",
    });
  });

  it("fails closed for missing or mismatched commit/database arguments", () => {
    expect(parseStockViewReconciliationArguments([
      "--expected-commit", "abc", "--expected-database", "railway",
    ])).toEqual({ expectedCommit: "abc", expectedDatabase: "railway" });
    expect(validateStockViewReconciliationArguments({
      expectedCommit: null,
      expectedDatabase: null,
    })).toEqual(["EXPECTED_COMMIT_REQUIRED", "EXPECTED_DATABASE_REQUIRED"]);
    expect(report({ expectedCommit: "different" }).sameCommit).toBe(false);
  });

  it("preserves the hard timeout fail-closed contract", async () => {
    await expect(withReconciliationTimeout(
      () => new Promise<never>(() => {}),
      1,
    )).rejects.toThrow("RECONCILIATION_TIMEOUT");
    expect(RECONCILIATION_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
  });

  it("contains no production write operations", () => {
    const source = readFileSync(new URL("./reconcile-stock-view-canonical-query.ts", import.meta.url), "utf8");
    expect(source).toContain("SET TRANSACTION READ ONLY");
    expect(source).toContain("SET LOCAL statement_timeout");
    expect(source).toContain("await client.query(\"COMMIT\")");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM)\b/);
    expect(source).not.toMatch(/import\([^)]*(mutation|ingestion|apply)/i);
  });
});