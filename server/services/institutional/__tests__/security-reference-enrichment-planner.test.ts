import { describe, expect, it } from "vitest";
import { resolveReviewedSecurityReference } from "../security-reference-enrichment";
import {
  buildInstitutionalSecurityReferencePlan, referenceApplyGuard, referencePlanAggregateSummary,
  selectInstitutionalReferenceLookupCusips,
} from "../security-reference-enrichment-planner";

const resolution = resolveReviewedSecurityReference("037833100", [], [{
  provider: "openfigi", ticker: "AAPL", figi: "BBG000B9XRY4", securityType: "Common Stock",
}]);
const input = (maxCusips = 5) => ({
  population: [
    { cusip: "594918104", holdingRows: 3, reportedValueUsd: null },
    { cusip: "037833100", holdingRows: 2, reportedValueUsd: "100" },
  ],
  trustedState: [{ cusip: "594918104", trusted: true, evidence: [] }],
  providerResolutions: [resolution],
  maxCusips,
});

describe("institutional security reference enrichment planner", () => {
  it("has a stable hash independent of input order and correct coverage math", () => {
    const first = buildInstitutionalSecurityReferencePlan(input());
    const reversed = buildInstitutionalSecurityReferencePlan({
      ...input(), population: [...input().population].reverse(),
      trustedState: [...input().trustedState].reverse(), providerResolutions: [...input().providerResolutions].reverse(),
    });
    expect(first.planHash).toBe(reversed.planHash);
    expect(first.before).toMatchObject({ distinctCusips: 1, holdingRows: 3, knownReportedValueUsd: null });
    expect(first.projected).toMatchObject({ distinctCusips: 2, holdingRows: 5, knownReportedValueUsd: "100" });
    expect(first.actions.map(x => x.cusip)).toEqual(["037833100"]);
  });

  it("bounds the exact hashed action set and leaves an empty plan idempotent", () => {
    const bounded = buildInstitutionalSecurityReferencePlan(input(0));
    expect(bounded.actions).toEqual([]);
    expect(bounded.actionCounts).toMatchObject({ plannedWrites: 0, skippedByLimit: 1 });
    const empty = buildInstitutionalSecurityReferencePlan({ population: [], trustedState: [], providerResolutions: [], maxCusips: 10 });
    expect(empty.actions).toEqual([]);
    expect(empty.before.knownReportedValueUsd).toBeNull();
    expect(empty.projected).toEqual(empty.before);
  });

  it("requires every apply guard and exposes only safe aggregate output", () => {
    const plan = buildInstitutionalSecurityReferencePlan(input());
    expect(referenceApplyGuard({ apply: true, planHash: plan.planHash, suppliedPlanHash: plan.planHash, maxCusips: 5, applyEnabled: "true", nodeEnv: "production", railwayEnvironment: "production" })).toEqual([]);
    expect(referenceApplyGuard({ apply: true, planHash: plan.planHash, maxCusips: undefined, applyEnabled: "false", nodeEnv: "production", railwayEnvironment: "staging" }))
      .toEqual(expect.arrayContaining(["FRESH_PLAN_HASH_REQUIRED", "APPLY_NOT_ENABLED", "MAX_CUSIPS_REQUIRED", "RAILWAY_PRODUCTION_IDENTITY_REQUIRED"]));
    const output = referencePlanAggregateSummary(plan);
    expect(output).not.toHaveProperty("actions");
    expect(JSON.stringify(output)).not.toContain("BBG000B9XRY4");
  });

  it("plans bounded unresolved observations but projects only promotable coverage", () => {
    const failed = { ...resolution, cusip: "594918104" as const, outcome: "PROVIDER_FAILED" as const, symbol: null, candidates: [] };
    const plan = buildInstitutionalSecurityReferencePlan({
      ...input(1), trustedState: [], providerResolutions: [resolution, failed],
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ cusip: "037833100", promotable: true });
    expect(plan.actionCounts).toMatchObject({ plannedLookups: 1, plannedWrites: 1, promotable: 1, skippedByLimit: 1 });
    expect(plan.projected.distinctCusips).toBe(1);
  });

  it("does not count conflicting current exact evidence as trusted coverage", () => {
    const plan = buildInstitutionalSecurityReferencePlan({
      population: [{ cusip: "037833100", holdingRows: 1, reportedValueUsd: "1" }],
      trustedState: [{ cusip: "037833100", trusted: true, evidence: [
        { source: "mapping", cusip: "037833100", symbol: "AAPL", status: "exact" },
        { source: "master", cusip: "037833100", symbol: "MSFT", status: "exact" },
      ] }],
      providerResolutions: [resolution], maxCusips: 2,
    });
    expect(plan.before.distinctCusips).toBe(0);
    expect(plan.actions).toHaveLength(1);
  });

  it("excludes rejected local records from actions and projected coverage", () => {
    const plan = buildInstitutionalSecurityReferencePlan({
      population: [{ cusip: "037833100", holdingRows: 4, reportedValueUsd: "9" }],
      trustedState: [{ cusip: "037833100", blocked: true, trusted: true, evidence: [] }],
      providerResolutions: [resolution], maxCusips: 2,
    });
    expect(plan.before.distinctCusips).toBe(0);
    expect(plan.projected.distinctCusips).toBe(0);
    expect(plan.actions).toEqual([]);
    expect(plan.outcomes.find(item => item.outcome === "unsupported")).toMatchObject({ distinctCusips: 1, holdingRows: 4 });
  });

  it("selects only bounded untrusted/unblocked provider inputs deterministically", () => {
    const base = {
      population: [
        { cusip: "594918104", holdingRows: 1, reportedValueUsd: "1" },
        { cusip: "037833100", holdingRows: 1, reportedValueUsd: "1" },
        { cusip: "023135106", holdingRows: 1, reportedValueUsd: "1" },
      ],
      trustedState: [
        { cusip: "594918104", trusted: true, evidence: [] },
        { cusip: "023135106", blocked: true, evidence: [] },
      ], maxCusips: 1,
    };
    expect(selectInstitutionalReferenceLookupCusips(base)).toEqual(["037833100"]);
    expect(selectInstitutionalReferenceLookupCusips({ ...base, population: [...base.population].reverse() })).toEqual(["037833100"]);
    const plan = buildInstitutionalSecurityReferencePlan({
      ...base, plannedLookupCusips: ["037833100"], providerResolutions: [resolution],
    });
    expect(plan.actionCounts.skippedByLimit).toBe(0);
    expect(plan.outcomes.find(x => x.outcome === "unsupported")?.distinctCusips).toBe(1);
    expect(JSON.stringify(referencePlanAggregateSummary(plan))).not.toContain("023135106");
  });

  it("accounts for unassessed bounded remainder only as aggregate partial coverage", () => {
    const plan = buildInstitutionalSecurityReferencePlan({
      population: [
        { cusip: "037833100", holdingRows: 2, reportedValueUsd: "3" },
        { cusip: "594918104", holdingRows: 5, reportedValueUsd: "7" },
      ], trustedState: [], plannedLookupCusips: ["037833100"], providerResolutions: [resolution], maxCusips: 1,
    });
    expect(plan.actionCounts.skippedByLimit).toBe(1);
    expect(plan.outcomes.find(x => x.outcome === "partial")).toMatchObject({ distinctCusips: 1, holdingRows: 5, knownReportedValueUsd: "7" });
    const output = JSON.stringify(referencePlanAggregateSummary(plan));
    expect(output).not.toContain("037833100");
    expect(output).not.toContain("594918104");
  });
});