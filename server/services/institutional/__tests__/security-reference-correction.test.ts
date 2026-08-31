import { describe, expect, it } from "vitest";
import {
  buildInstitutionalAssetTypeCorrectionPlan,
} from "../security-reference-enrichment-planner";
import {
  applyInstitutionalSecurityTypeCorrections,
  INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION,
  validateSecurityTypeCorrectionApplyRequest,
} from "../security-reference-correction";

const evidence = (cusip: string, symbol: string) => [
  { source: "institutional_mapping", cusip, symbol, status: "exact" as const },
];

describe("guarded canonical security corrections", () => {
  it("plans a provider-backed type correction without changing CUSIP identity", () => {
    const plan = buildInstitutionalAssetTypeCorrectionPlan({
      population: [{
        cusip: "000000001", holdingRows: 4, reportedValueUsd: "1200",
        trustedSymbols: ["FUND"], currentAssetType: "common_stock",
      }],
      trustedState: [{
        cusip: "000000001", evidence: evidence("000000001", "FUND"), trusted: true,
        currentAssetType: "common_stock",
        candidateEvidence: [{ provider: "openfigi", ticker: "FUND", securityType: "ETF" }],
      }],
    });
    expect(plan.actions).toEqual([expect.objectContaining({
      action: "TYPE_CORRECTION",
      cusip: "000000001",
      projectedAssetType: "etf",
      preservesTrustedIdentity: true,
    })]);
    expect(plan.before).toMatchObject({ stockEligibleCusips: 1, holdingRows: 4, reportedValueUsd: "1200" });
    expect(plan.projected).toMatchObject({ separateFundCusips: 1, holdingRows: 4, reportedValueUsd: "1200" });
    expect(plan.blockers.staleMachineDerivedTypeCusips).toBe(1);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("separates a uniquely provider-backed invalid symbol correction from an unresolved symbol", () => {
    const plan = buildInstitutionalAssetTypeCorrectionPlan({
      population: [
        { cusip: "000000001", holdingRows: 1, reportedValueUsd: "10", trustedSymbols: ["BAD/TICKER"], currentAssetType: "common_stock" },
        { cusip: "000000002", holdingRows: 1, reportedValueUsd: "20", trustedSymbols: ["BAD/TICKER"], currentAssetType: "common_stock" },
      ],
      trustedState: [
        {
          cusip: "000000001", evidence: evidence("000000001", "BAD/TICKER"), trusted: true,
          currentAssetType: "common_stock",
          candidateEvidence: [{ provider: "openfigi", ticker: "GOOD", securityType: "Common Stock" }],
        },
        {
          cusip: "000000002", evidence: evidence("000000002", "BAD/TICKER"), trusted: true,
          currentAssetType: "common_stock",
          candidateEvidence: [
            { provider: "openfigi", ticker: "GOOD", securityType: "Common Stock" },
            { provider: "openfigi", ticker: "OTHER", securityType: "Common Stock" },
          ],
        },
      ],
    });
    expect(plan.actions).toEqual([expect.objectContaining({
      action: "SYMBOL_CORRECTION",
      cusip: "000000001",
      currentSymbol: "BAD/TICKER",
      projectedSymbol: "GOOD",
      preservesCusip: true,
    })]);
    expect(plan.blockerCusips).toContainEqual({
      cusip: "000000002",
      blocker: "CANONICAL_SYMBOL_REVIEW_REQUIRED",
    });
  });

  it("never plans a reviewed type change", () => {
    const plan = buildInstitutionalAssetTypeCorrectionPlan({
      population: [{ cusip: "000000001", holdingRows: 1, reportedValueUsd: "10", trustedSymbols: ["KEEP"], currentAssetType: "common_stock" }],
      trustedState: [{
        cusip: "000000001", evidence: evidence("000000001", "KEEP"), trusted: true,
        currentAssetType: "common_stock", assetTypeReviewed: true,
        candidateEvidence: [{ provider: "openfigi", ticker: "KEEP", securityType: "ETF" }],
      }],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.blockers.staleMachineDerivedTypeCusips).toBe(0);
  });

  it("requires every dedicated production correction guard", () => {
    expect(validateSecurityTypeCorrectionApplyRequest({
      apply: true,
    })).toEqual(expect.arrayContaining([
      "CORRECTION_CONFIRMATION_REQUIRED",
      "PRODUCTION_ENVIRONMENT_ARGUMENT_REQUIRED",
      "RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION",
      "NODE_ENV_PRODUCTION_REQUIRED",
      "SECURITY_TYPE_CORRECTION_APPLY_GUARD_REQUIRED",
      "DATABASE_URL_REQUIRED",
      "EXPECTED_DATABASE_NAME_REQUIRED",
      "EXPECTED_SCHEMA_NAME_REQUIRED",
      "FRESH_CORRECTION_PLAN_HASH_REQUIRED",
    ]));
    expect(validateSecurityTypeCorrectionApplyRequest({
      apply: true,
      confirmation: INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION,
      environment: "production",
      railwayEnvironment: "production",
      nodeEnvironment: "production",
      correctionApplyEnabled: "true",
      databaseUrl: "configured",
      expectedDatabase: "prod",
      currentDatabase: "prod",
      expectedSchema: "public",
      currentSchema: "public",
      suppliedPlanHash: "hash",
      freshPlanHash: "hash",
    })).toEqual([]);
  });

  it("locks, rechecks the exact hash, and applies only the correction actions", async () => {
    const plan = buildInstitutionalAssetTypeCorrectionPlan({
      population: [{ cusip: "000000001", holdingRows: 1, reportedValueUsd: "10", trustedSymbols: ["FUND"], currentAssetType: "common_stock" }],
      trustedState: [{
        cusip: "000000001", evidence: evidence("000000001", "FUND"), trusted: true,
        currentAssetType: "common_stock",
        candidateEvidence: [{ provider: "openfigi", ticker: "FUND", securityType: "ETF" }],
      }],
    });
    const calls: string[] = [];
    const result = await applyInstitutionalSecurityTypeCorrections({
      artifact: plan,
      confirmation: INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION,
      environment: "production", railwayEnvironment: "production", nodeEnvironment: "production",
      correctionApplyEnabled: "true", databaseUrl: "configured",
      expectedDatabase: "prod", expectedSchema: "public",
      suppliedPlanHash: plan.planHash,
      database: {
        async identity() { return { database: "prod", schema: "public" }; },
        async withAdvisoryLock(key, fn) { calls.push(`lock:${key}`); return fn(); },
        async transaction(fn) {
          return fn({
            async loadPlan() { calls.push("load"); return plan; },
            async applyTypeCorrection(action) { calls.push(`${action.action}:${action.cusip}`); },
            async applySymbolCorrection(action) { calls.push(`${action.action}:${action.cusip}`); },
          });
        },
      },
    });
    expect(result).toEqual({ planHash: plan.planHash, typeCorrections: 1, symbolCorrections: 0 });
    expect(calls).toEqual(["lock:774412005", "load", "TYPE_CORRECTION:000000001"]);
  });

  it("rejects plan drift before any correction write", async () => {
    const plan = buildInstitutionalAssetTypeCorrectionPlan({
      population: [{ cusip: "000000001", holdingRows: 1, reportedValueUsd: "10", trustedSymbols: ["FUND"], currentAssetType: "common_stock" }],
      trustedState: [{
        cusip: "000000001", evidence: evidence("000000001", "FUND"), trusted: true,
        currentAssetType: "common_stock",
        candidateEvidence: [{ provider: "openfigi", ticker: "ETF", securityType: "ETF" }],
      }],
    });
    await expect(applyInstitutionalSecurityTypeCorrections({
      artifact: plan, confirmation: INSTITUTIONAL_SECURITY_TYPE_CORRECTION_CONFIRMATION,
      environment: "production", railwayEnvironment: "production", nodeEnvironment: "production",
      correctionApplyEnabled: "true", databaseUrl: "configured",
      expectedDatabase: "prod", expectedSchema: "public", suppliedPlanHash: plan.planHash,
      database: {
        async identity() { return { database: "prod", schema: "public" }; },
        async withAdvisoryLock(_key, fn) { return fn(); },
        async transaction(fn) {
          return fn({
            async loadPlan() { return { ...plan, planHash: "drift" }; },
            async applyTypeCorrection() { throw new Error("WRITE_MUST_NOT_RUN"); },
            async applySymbolCorrection() { throw new Error("WRITE_MUST_NOT_RUN"); },
          });
        },
      },
    })).rejects.toThrow("STALE_PLAN_HASH");
  });
});