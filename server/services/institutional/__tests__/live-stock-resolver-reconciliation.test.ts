import { describe, expect, it } from "vitest";
import { reconcileLiveStockResolver } from "../live-stock-resolver-reconciliation";

const baseMetadata = {
  runtimeCommit: "abc",
  expectedCommit: "abc",
  runtimeDatabase: "prod",
  expectedDatabase: "prod",
  runtimeSchema: "public",
  analyzerDatabase: "prod",
  analyzerSchema: "public",
};

function reconcile(overrides: Record<string, unknown> = {}) {
  return reconcileLiveStockResolver({
    canonicalIdentities: { "111111111": "ABC" },
    securityMasterRows: [{
      cusip: "111111111",
      ticker: "ABC",
      reviewStatus: "reviewed",
      assetType: "common_stock",
    }],
    evidenceRows: [],
    aggregateRows: [{ symbol: "ABC" }],
    signalSymbols: ["ABC"],
    ...baseMetadata,
    ...overrides,
  } as any);
}

describe("live Stock View resolver reconciliation", () => {
  it.each(["common_stock", "reit"])("accepts direct reviewed %s master identity", (assetType) => {
    const report = reconcile({
      securityMasterRows: [{
        cusip: "111111111", ticker: "abc", reviewStatus: "reviewed", assetType,
      }],
    });
    expect(report.counts).toMatchObject({
      liveResolverResolvableSymbols: 1,
      directSecurityMasterSymbols: 1,
    });
    expect(report.reconciled).toBe(true);
  });

  it("accepts mapping-only evidence", () => {
    const report = reconcile({
      securityMasterRows: [{
        cusip: "111111111", ticker: null, reviewStatus: "unmapped", assetType: "reit",
      }],
      evidenceRows: [{
        accessionNumber: "a", periodOfReport: "2026-03-31", cusip: "111111111",
        masterTicker: null, masterReviewStatus: "unmapped", masterAssetType: "reit",
        mappingSymbol: "ABC", mappingStatus: "exact",
        holdingMappedSymbol: null, holdingMappingStatus: null,
      }],
    });
    expect(report.counts).toMatchObject({
      liveResolverResolvableSymbols: 1,
      trustedMappingSymbols: 1,
      mappingOnlyCanonicalSymbols: 1,
    });
  });

  it("retains multiple CUSIPs for one symbol", () => {
    const report = reconcile({
      canonicalIdentities: { "111111111": "ABC", "222222222": "ABC" },
      securityMasterRows: [
        { cusip: "111111111", ticker: "ABC", reviewStatus: "reviewed", assetType: "common_stock" },
        { cusip: "222222222", ticker: "ABC", reviewStatus: "reviewed", assetType: "reit" },
      ],
    });
    expect(report.counts).toMatchObject({
      canonicalStockEligibleCusips: 2,
      canonicalStockEligibleSymbols: 1,
    });
  });

  it.each([
    ["etf", "fund"],
    ["preferred", "unsupported"],
  ])("disqualifies %s evidence", (assetType) => {
    const report = reconcile({
      securityMasterRows: [{
        cusip: "111111111", ticker: "ABC", reviewStatus: "reviewed", assetType,
      }],
      evidenceRows: [{
        accessionNumber: "a", periodOfReport: "2026-03-31", cusip: "111111111",
        masterTicker: "ABC", masterReviewStatus: "reviewed", masterAssetType: assetType,
        mappingSymbol: null, mappingStatus: null,
        holdingMappedSymbol: null, holdingMappingStatus: null,
      }],
    });
    expect(report.counts.liveResolverUnresolvableCanonicalSymbols).toBe(1);
  });

  it("reports unresolved and conflicting identities", () => {
    const unresolved = reconcile({ securityMasterRows: [] });
    expect(unresolved.mismatchSamples.some((sample) => sample.reason === "UNRESOLVED")).toBe(true);
    const conflicting = reconcile({
      evidenceRows: [{
        accessionNumber: "a", periodOfReport: "2026-03-31", cusip: "111111111",
        masterTicker: "ABC", masterReviewStatus: "reviewed", masterAssetType: "common_stock",
        mappingSymbol: "XYZ", mappingStatus: "exact",
        holdingMappedSymbol: null, holdingMappingStatus: null,
      }],
    });
    expect(conflicting.mismatchSamples.some(
      (sample) => sample.reason === "DISQUALIFYING_EVIDENCE",
    )).toBe(true);
    expect(conflicting.firstDivergencePoint).toBe("LIVE_IDENTITY_RESOLVER");
  });

  it.each([
    ["ambiguous", null],
    ["rejected", "ABC"],
  ])("fails closed for %s mapping evidence", (mappingStatus, mappingSymbol) => {
    const report = reconcile({
      securityMasterRows: [{
        cusip: "111111111", ticker: null, reviewStatus: "unmapped", assetType: "common_stock",
      }],
      evidenceRows: [{
        accessionNumber: "a", periodOfReport: "2026-03-31", cusip: "111111111",
        masterTicker: null, masterReviewStatus: "unmapped", masterAssetType: "common_stock",
        mappingSymbol, mappingStatus,
        holdingMappedSymbol: null, holdingMappingStatus: null,
      }],
    });
    expect(report.counts.liveResolverResolvableSymbols).toBe(0);
    expect(report.liveResolverReconciled).toBe(false);
  });

  it("counts malformed symbols", () => {
    const report = reconcile({
      canonicalIdentities: { "111111111": "BAD SYMBOL" },
      securityMasterRows: [{
        cusip: "111111111", ticker: "BAD SYMBOL", reviewStatus: "reviewed", assetType: "common_stock",
      }],
      aggregateRows: [{ symbol: "BAD SYMBOL" }],
      signalSymbols: ["BAD SYMBOL"],
    });
    expect(report.counts.malformedSymbols).toBe(1);
    expect(report.liveResolverReconciled).toBe(false);
    expect(report.firstDivergencePoint).toBe("SYMBOL_NORMALIZATION");
  });

  it("ignores unrelated aggregate and signal symbols", () => {
    const report = reconcile({
      aggregateRows: [{ symbol: "XYZ" }],
      signalSymbols: ["ABC"],
    });
    expect(report.counts.aggregateBackedSymbols).toBe(0);
    expect(report.liveResolverReconciled).toBe(true);
  });

  it("requires the live candidate CUSIP set to equal the canonical set", () => {
    const report = reconcile({
      securityMasterRows: [
        { cusip: "111111111", ticker: "ABC", reviewStatus: "reviewed", assetType: "common_stock" },
        { cusip: "222222222", ticker: "ABC", reviewStatus: "reviewed", assetType: "common_stock" },
      ],
    });
    expect(report.counts.identitySetMismatches).toBe(1);
    expect(report.counts.liveResolverResolvableSymbols).toBe(0);
    expect(report.mismatchSamples).toContainEqual(expect.objectContaining({
      symbol: "ABC",
      reason: "IDENTITY_SET_MISMATCH",
      canonicalCusips: ["111111111"],
      candidateCusips: ["111111111", "222222222"],
    }));
    expect(report.liveResolverReconciled).toBe(false);
    expect(report.firstDivergencePoint).toBe("CUSIP_IDENTITY_SET");
  });

  it("reports backed-but-unresolvable counts only within canonical symbols", () => {
    const report = reconcile({
      canonicalIdentities: { "111111111": "ABC", "222222222": "DEF" },
      securityMasterRows: [{
        cusip: "111111111", ticker: "ABC", reviewStatus: "reviewed", assetType: "common_stock",
      }],
      aggregateRows: [{ symbol: "ABC" }, { symbol: "DEF" }, { symbol: "UNRELATED" }],
      signalSymbols: ["DEF", "UNRELATED"],
    });
    expect(report.counts).toMatchObject({
      aggregateBackedSymbols: 2,
      signalBackedSymbols: 1,
      aggregateBackedButLiveUnresolvable: 1,
      signalBackedButLiveUnresolvable: 1,
      liveResolverUnresolvableCanonicalSymbols: 1,
    });
  });

  it("fails reconciliation on commit or database identity mismatch", () => {
    expect(reconcile({ expectedCommit: "other" }).metadata.sameCommit).toBe(false);
    expect(reconcile({ expectedDatabase: "other" }).metadata.runtimeDatabaseMatchesExpected).toBe(false);
    expect(reconcile({ analyzerDatabase: "other" }).metadata.sameDatabaseIdentity).toBe(false);
    expect(reconcile({ expectedCommit: "other" }).firstDivergencePoint).toBe("RUNNING_COMMIT");
    expect(reconcile({ expectedDatabase: "other" }).firstDivergencePoint).toBe("RUNTIME_DATABASE");
    expect(reconcile({ analyzerDatabase: "other" }).firstDivergencePoint).toBe("ANALYZER_DATABASE");
  });

  it("caps deterministic mismatch samples at ten", () => {
    const canonicalIdentities = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [String(index).padStart(9, "0"), `S${index}`]),
    );
    const report = reconcile({
      canonicalIdentities,
      securityMasterRows: [],
      aggregateRows: [],
      signalSymbols: [],
    });
    expect(report.mismatchSamples).toHaveLength(10);
  });
});