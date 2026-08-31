import { describe, expect, it } from "vitest";
import { applyInstitutionalCoveragePlan, assertReadOnlySql, buildActionableCoveragePlan, buildCoveragePlan, classifyCusipEvidence, countCanonicalStockEligibleInputs, coverageTotals, GLOBAL_COVERAGE_ADVISORY_LOCK, providerNormalizationAudit, securityTypeCoverageMetrics, validateCoverageApplyRequest } from "../institutional-coverage-analyzer";
import { reconcileCanonicalStockEligibility } from "../canonical-security-state";
import { classifyInstitutionalSecurityType } from "../security-type-eligibility";

describe("institutional coverage analyzer", () => {
  const base = { cusip: "123456789", holdingRows: 2, reportedValueUsd: 100, latestQuarter: "2025-12-31" };
  it("classifies evidence without guessing", () => {
    expect(classifyCusipEvidence(base).category).toBe("INSUFFICIENT_NO_REFERENCE");
    expect(classifyCusipEvidence({ ...base, sourceEvidence: [{ source: "mapping", symbol: "ABC", status: "probable" }] }).category).toBe("UNSUPPORTED");
    expect(classifyCusipEvidence({ ...base, sourceEvidence: [{ source: "mapping", symbol: null, status: "ambiguous" }] }).category).toBe("AMBIGUOUS");
    expect(classifyCusipEvidence({ ...base, reliableReferenceSymbols: ["abc"] }).projectedSymbol).toBe("ABC");
    expect(classifyCusipEvidence({ ...base, holdingSymbols: ["ABC"], reliableReferenceSymbols: ["XYZ"] }).category).toBe("CONFLICTING");
  });
  it("weights coverage by canonical reported value", () => {
    const rows = [classifyCusipEvidence({ ...base, reliableReferenceSymbols: ["ABC"] }), classifyCusipEvidence({ ...base, cusip: "987654321", reportedValueUsd: 900 })];
    expect(coverageTotals(rows)).toMatchObject({ reportedValueUsd: "1000", reliablyMappedValueUsd: "100" });
    expect(coverageTotals([
      classifyCusipEvidence({ ...base, reportedValueUsd: null, nullValueRows: 2 }),
      classifyCusipEvidence({ ...base, cusip: "987654321", reportedValueUsd: 900 }),
    ])).toMatchObject({ reportedValueUsd: "900", knownValueCusips: 1, nullValueCusips: 1, nullValueRows: 2 });
  });
  it("reports security-type populations and their existing derived targets", () => {
    const rows = [
      {
        ...classifyCusipEvidence({
          ...base,
          cusip: "111111111",
          holdingRows: 3,
          reportedValueUsd: "1200",
          sourceEvidence: [{ source: "security_master", symbol: "ABC", status: "reviewed" }],
        }),
        canonicalSecurityType: "common_stock" as const,
        securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
      },
      {
        ...classifyCusipEvidence({
          ...base,
          cusip: "222222222",
          reportedValueUsd: "800",
          sourceEvidence: [{ source: "security_master", symbol: "SPY", status: "reviewed" }],
        }),
        canonicalSecurityType: "etf" as const,
        securityTypePopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS" as const,
      },
    ];
    expect(
      securityTypeCoverageMetrics(
        rows,
        new Set(["ABC:2026-06-30", "SPY:2026-06-30"]),
        new Set(["ABC"]),
      ),
    ).toEqual([
      {
        canonicalSecurityType: "common_stock",
        securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS",
        distinctCusips: 1,
        distinctSymbols: 1,
        holdingRows: 3,
        reportedValueUsd: "1200",
        aggregateTargets: 1,
        signalTargets: 1,
      },
      {
        canonicalSecurityType: "etf",
        securityTypePopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS",
        distinctCusips: 1,
        distinctSymbols: 1,
        holdingRows: 2,
        reportedValueUsd: "800",
        aggregateTargets: 1,
        signalTargets: 0,
      },
    ]);
  });
  it("uses canonical identity and type when a holding symbol is stale or null", () => {
    const row = {
      ...classifyCusipEvidence({
        ...base,
        cusip: "111111111",
        holdingSymbols: [],
        staleUnmappedHoldingRows: 1,
        reliableReferenceSymbols: ["ABC"],
        sourceEvidence: [
          { source: "holding", symbol: null, status: "stale" },
          { source: "institutional_mapping", symbol: "ABC", status: "exact" },
          { source: "security_master", symbol: "ABC", status: "probable" },
        ],
        periods: ["2025-09-30", "2025-12-31"],
      }),
      canonicalSecurityType: "common_stock" as const,
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
    };
    const plan = buildActionableCoveragePlan({
      classifications: [row],
      before: coverageTotals([row]),
      existingAggregateTargets: new Set(),
      existingSignalSymbols: new Set(),
    });
    expect(row.category).toBe("TRUSTED");
    expect(row.projectedSymbol).toBe("ABC");
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations?.[0]).toMatchObject({
      cusip: "111111111",
      symbol: "ABC",
      mappingAction: "PROMOTE_TRUSTED_REFERENCE",
      aggregateTargets: [
        { symbol: "ABC", period: "2025-09-30" },
        { symbol: "ABC", period: "2025-12-31" },
      ],
      signalTarget: { symbol: "ABC" },
    });
  });

  it("keeps Task 196 stock, fund, unsupported, and unresolved populations separate", () => {
    expect(classifyInstitutionalSecurityType({ assetType: "REIT" })).toMatchObject({
      canonicalType: "reit",
      analyticsPopulation: "ELIGIBLE_STOCK_ANALYTICS",
    });
    expect(classifyInstitutionalSecurityType({ assetType: "ETF" })).toMatchObject({
      canonicalType: "etf",
      analyticsPopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS",
    });
    expect(classifyInstitutionalSecurityType({ assetType: "ADR" })).toMatchObject({
      canonicalType: "adr",
      analyticsPopulation: "UNSUPPORTED_FOR_STOCK_ANALYTICS",
    });
    expect(classifyInstitutionalSecurityType({})).toMatchObject({
      canonicalType: "insufficient_evidence",
      analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
    });
  });

  it("does not plan fund, unsupported, or unresolved rows for stock materialization", () => {
    const makeTyped = (
      cusip: string,
      symbol: string,
      canonicalSecurityType: "reit" | "etf" | "adr" | "insufficient_evidence",
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" | "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS" | "UNSUPPORTED_FOR_STOCK_ANALYTICS" | "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
    ) => ({
      ...classifyCusipEvidence({
        ...base, cusip, reliableReferenceSymbols: symbol === "" ? [] : [symbol],
        sourceEvidence: symbol === "" ? [] : [{ source: "institutional_mapping", symbol, status: "exact" }],
      }),
      canonicalSecurityType,
      securityTypePopulation,
    });
    const plan = buildActionableCoveragePlan({
      classifications: [
        makeTyped("111111111", "REIT", "reit", "ELIGIBLE_STOCK_ANALYTICS"),
        makeTyped("222222222", "ETF", "etf", "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS"),
        makeTyped("333333333", "ADR", "adr", "UNSUPPORTED_FOR_STOCK_ANALYTICS"),
        makeTyped("444444444", "", "insufficient_evidence", "INSUFFICIENT_SECURITY_TYPE_EVIDENCE"),
      ],
      before: coverageTotals([]),
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations?.[0].symbol).toBe("REIT");
  });

  it("fails closed for rejected identity evidence", () => {
    const row = classifyCusipEvidence({
      ...base,
      reliableReferenceSymbols: ["ABC"],
      sourceEvidence: [
        { source: "institutional_mapping", symbol: "ABC", status: "exact" },
        { source: "security_master", symbol: "ABC", status: "rejected" },
      ],
    });
    expect(row.category).toBe("INSUFFICIENT_NO_REFERENCE");
    expect(row.projectedSymbol).toBeNull();
    expect(buildActionableCoveragePlan({
      classifications: [{
        ...row,
        canonicalSecurityType: "common_stock",
        securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS",
      }],
      before: coverageTotals([row]),
    }).operations).toEqual([]);
  });

  it("deduplicates aggregate and signal targets when multiple CUSIPs map to one symbol", () => {
    const rows = ["111111111", "222222222"].map((cusip) => ({
      ...classifyCusipEvidence({
        ...base, cusip, reliableReferenceSymbols: ["ABC"],
        periods: ["2025-09-30", "2025-12-31"],
        sourceEvidence: [{ source: "institutional_mapping", symbol: "ABC", status: "reviewed" }],
      }),
      canonicalSecurityType: "common_stock" as const,
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
    }));
    const plan = buildActionableCoveragePlan({
      classifications: rows,
      before: coverageTotals(rows),
    });
    expect(plan.operations).toHaveLength(2);
    expect(plan.affected.aggregates).toEqual([
      "insert:ABC:2025-09-30",
      "insert:ABC:2025-12-31",
    ]);
    expect(plan.affected.signals).toEqual(["insert:ABC"]);
  });

  it("reconciles canonical verifier and analyzer eligibility for the same population", () => {
    const rows = [
      {
        ...classifyCusipEvidence({
          ...base, cusip: "111111111",
          sourceEvidence: [{ source: "institutional_mapping", symbol: "ABC", status: "exact" }],
        }),
        canonicalSecurityType: "common_stock" as const,
        securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
      },
      {
        ...classifyCusipEvidence({
          ...base, cusip: "222222222",
          sourceEvidence: [{ source: "institutional_mapping", symbol: "REIT", status: "reviewed" }],
        }),
        canonicalSecurityType: "reit" as const,
        securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
      },
      {
        ...classifyCusipEvidence({
          ...base, cusip: "333333333",
          sourceEvidence: [{ source: "institutional_mapping", symbol: "ETF", status: "exact" }],
        }),
        canonicalSecurityType: "etf" as const,
        securityTypePopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS" as const,
      },
    ];
    expect(reconcileCanonicalStockEligibility(
      2,
      countCanonicalStockEligibleInputs(rows),
    )).toMatchObject({ difference: 0, reconciled: true });
  });
  it("hashes equivalent plans deterministically", () => {
    const one = classifyCusipEvidence(base); const input = { version: 1 as const, mode: "REMEDIATION_PLAN" as const, before: coverageTotals([one]), projected: coverageTotals([one]), classifications: [one], affected: { mappings: ["b", "a"], holdings: 0, quarters: [], aggregates: [], signals: [], snapshots: [] } };
    expect(buildCoveragePlan(input).planHash).toBe(buildCoveragePlan({ ...input, affected: { ...input.affected, mappings: ["a", "b"] } }).planHash);
  });
  it("rejects writes and refuses apply", () => {
    expect(() => assertReadOnlySql("UPDATE x SET a=1")).toThrow("READ_ONLY_SQL_REQUIRED");
    expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
    expect(() => assertReadOnlySql("SELECT COUNT(*) FROM h WHERE LOWER(put_call) = 'call'")).not.toThrow();
    expect(() => assertReadOnlySql("SELECT 'update x set y=1' AS harmless")).not.toThrow();
    expect(validateCoverageApplyRequest({ apply: true })).toEqual(expect.arrayContaining([
      "PRODUCTION_ENVIRONMENT_REQUIRED", "DATABASE_IDENTITY_MISMATCH",
      "SCHEMA_IDENTITY_MISMATCH", "CONFIRMATION_REQUIRED", "FRESH_PLAN_HASH_REQUIRED",
    ]));
  });
  it("uses advisory lock, rechecks hash, and applies idempotent injected operations", async () => {
    const trusted = {
      ...classifyCusipEvidence({ ...base, reliableReferenceSymbols: ["ABC"], staleUnmappedHoldingRows: 2, periods: ["2025-09-30"] }),
      canonicalSecurityType: "common_stock" as const,
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
    };
    const plan = buildActionableCoveragePlan({ classifications: [trusted], before: coverageTotals([trusted]) });
    const calls: string[] = [];
    const result = await applyInstitutionalCoveragePlan({
      artifact: plan, environment: "production", confirmation: "APPLY_INSTITUTIONAL_COVERAGE_PLAN",
      expectedDatabase: "prod", expectedSchema: "public", suppliedPlanHash: plan.planHash,
      database: {
        async identity() { return { database: "prod", schema: "public" }; },
        async withAdvisoryLock(key, fn) { calls.push(`lock:${key}`); return fn(); },
        async transaction(fn) { return fn({
          async loadPlan() { return plan; }, async promoteMapping() { calls.push("mapping"); },
          async updateHoldings() { calls.push("holdings"); }, async upsertAggregate() { calls.push("aggregate"); },
          async upsertSignal() { calls.push("signal"); },
        }); },
      },
      rebuilder: { async refreshSnapshots() { calls.push("snapshots"); } },
    });
    expect(result.operations).toBe(1);
    expect(calls).toEqual([`lock:${GLOBAL_COVERAGE_ADVISORY_LOCK}`, "mapping", "holdings", "aggregate", "signal", "snapshots"]);
    expect(plan.rollback?.sql).toContain("ROLLBACK");
  });
  it("retains all historical promotion periods while a newest filing quarter can be empty", () => {
    const trusted = classifyCusipEvidence({ ...base, reliableReferenceSymbols: ["ABC"], staleUnmappedHoldingRows: 2, periods: ["2025-06-30", "2025-09-30"] });
    const plan = buildCoveragePlan({ version: 1, mode: "REMEDIATION_PLAN", before: coverageTotals([trusted]), projected: coverageTotals([trusted]), classifications: [trusted], affected: {
      mappings: [trusted.cusip], holdings: 2, quarters: [...(trusted.periods ?? [])],
      aggregates: (trusted.periods ?? []).map(period => `${trusted.projectedSymbol}:${period}`), signals: ["ABC"], snapshots: [],
    }});
    expect(plan.affected.quarters).toEqual(["2025-06-30", "2025-09-30"]);
    expect(coverageTotals([])).toMatchObject({ eligibleCusips: 0, holdingRows: 0 });
  });
  it("reports materialized percentages and missing derived targets for current trusted holdings", () => {
    const trusted = {
      ...classifyCusipEvidence({
      ...base, holdingRows: 2, currentlyMaterializedHoldingRows: 2,
      currentlyMaterializedValueUsd: "100", reliableReferenceSymbols: ["ABC"],
      staleUnmappedHoldingRows: 0, periods: ["2025-09-30"],
      }),
      canonicalSecurityType: "common_stock" as const,
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" as const,
    };
    const before = coverageTotals([trusted]);
    const plan = buildActionableCoveragePlan({
      classifications: [trusted, { ...trusted, cusip: "987654321" }], before,
      existingAggregateTargets: new Set(), existingSignalSymbols: new Set(),
      snapshotRowsByFamily: { sector_intelligence_snapshots: 3, theme_intelligence_snapshots: 4 },
    });
    expect(before).toMatchObject({
      currentlyFullyMaterializedCusips: 1, fullyMaterializedCusipPercent: 100,
      materializedRowPercent: 100, materializedKnownValuePercent: 100,
    });
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations?.[0].mappingAction).toBe("NONE");
    expect(plan.affected.aggregates).toHaveLength(1);
    expect(plan.affected.signals).toHaveLength(1);
    expect(plan.downstream?.aggregates).toMatchObject({ expected: 1, missing: 1, inserts: 1 });
    expect(plan.downstream?.signals).toMatchObject({ expected: 1, missing: 1, inserts: 1 });
  });
  it("does not plan stock aggregates or signals for separate or unclassified types", () => {
    const trusted = classifyCusipEvidence({
      ...base,
      reliableReferenceSymbols: ["ETF"],
      staleUnmappedHoldingRows: 2,
      periods: ["2025-09-30"],
    });
    const separateFund = {
      ...trusted,
      canonicalSecurityType: "etf" as const,
      securityTypePopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS" as const,
    };
    expect(
      buildActionableCoveragePlan({
        classifications: [separateFund, trusted],
        before: coverageTotals([separateFund, trusted]),
      }).operations,
    ).toEqual([]);
  });

  it("groups provider tuples and counts type provenance and downstream targets", () => {
    const row = classifyCusipEvidence({
      ...base,
      reliableReferenceSymbols: ["ACME"],
      providerCandidates: [{
        provider: "openfigi", ticker: "ACME", figi: "BBGACME",
        securityType: "ETF", marketSector: "Equity",
      }],
      persistedAssetType: "common_stock",
      assetTypeProvenance: "figi_exact",
      assetTypeReviewed: false,
    });
    const audit = providerNormalizationAudit(
      [{ ...row, canonicalSecurityType: "common_stock", securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS" }],
      new Set(["ACME:2025-09-30"]),
      new Set(["ACME"]),
    );
    expect(audit.groups).toContainEqual(expect.objectContaining({
      provider: "openfigi",
      securityType: "ETF",
      persistedAssetType: "common_stock",
      persistedTypeProvenance: "figi_exact",
      providerCanonicalSecurityType: "etf",
      aggregateTargets: 1,
      signalTargets: 1,
    }));
    expect(audit.providerClassificationContradictoryToPersistedCusips).toBe(1);
    expect(audit.staleMachineDerivedTypeCusips).toBe(1);
  });
});