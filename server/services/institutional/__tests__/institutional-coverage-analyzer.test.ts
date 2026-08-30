import { describe, expect, it } from "vitest";
import { applyInstitutionalCoveragePlan, assertReadOnlySql, buildActionableCoveragePlan, buildCoveragePlan, classifyCusipEvidence, coverageTotals, GLOBAL_COVERAGE_ADVISORY_LOCK, validateCoverageApplyRequest } from "../institutional-coverage-analyzer";

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
    const trusted = classifyCusipEvidence({ ...base, reliableReferenceSymbols: ["ABC"], staleUnmappedHoldingRows: 2, periods: ["2025-09-30"] });
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
    const trusted = classifyCusipEvidence({
      ...base, holdingRows: 2, currentlyMaterializedHoldingRows: 2,
      currentlyMaterializedValueUsd: "100", reliableReferenceSymbols: ["ABC"],
      staleUnmappedHoldingRows: 0, periods: ["2025-09-30"],
    });
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
});