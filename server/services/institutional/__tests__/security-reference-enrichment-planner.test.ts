import { describe, expect, it } from "vitest";
import { resolveReviewedSecurityReference } from "../security-reference-enrichment";
import {
  assetTypeCoverageSummary, buildInstitutionalSecurityReferencePlan, referenceApplyGuard, referencePlanAggregateSummary, referencePlanChunkSummary,
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

  it("preserves every guarded apply precondition and exposes only safe aggregate output", () => {
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

  it("prioritizes never-processed CUSIPs before retryable outcomes and skips terminals", () => {
    const population = [
      { cusip: "000000001", holdingRows: 1, reportedValueUsd: "1" },
      { cusip: "000000002", holdingRows: 1, reportedValueUsd: "2" },
      { cusip: "000000003", holdingRows: 1, reportedValueUsd: "3" },
      { cusip: "000000004", holdingRows: 1, reportedValueUsd: "4" },
      { cusip: "000000005", holdingRows: 1, reportedValueUsd: "5" },
    ];
    const trustedState = [
      { cusip: "000000001", evidence: [], lookupState: { outcome: "AMBIGUOUS" } },
      { cusip: "000000002", evidence: [], lookupState: { providerOutcome: "RATE_LIMITED" } },
      { cusip: "000000004", evidence: [], lookupState: { outcome: "NO_REFERENCE_AVAILABLE" } },
      { cusip: "000000005", evidence: [], lookupState: { outcome: "PROVIDER_FAILED" } },
    ];
    expect(selectInstitutionalReferenceLookupCusips({ population, trustedState, maxCusips: 3 }))
      .toEqual(["000000003", "000000002", "000000005"]);
    const plan = buildInstitutionalSecurityReferencePlan({
      population,
      trustedState,
      providerResolutions: [],
      plannedLookupCusips: ["000000003"],
      maxCusips: 1,
    });
    expect(plan.selection).toMatchObject({
      skipped_terminal_ambiguous: 1,
      skipped_terminal_no_reference: 1,
      retryable_provider_failed: 1,
      retryable_rate_limited: 1,
      never_processed: 1,
    });
    expect(plan.actionCounts.skippedByLimit).toBe(2);
    expect(plan.outcomes.find(item => item.outcome === "terminal_ambiguous"))
      .toMatchObject({ distinctCusips: 1 });
    expect(plan.outcomes.find(item => item.outcome === "terminal_no_reference"))
      .toMatchObject({ distinctCusips: 1 });
  });

  it("re-queries terminal outcomes only with an explicit refresh", () => {
    const population = [{ cusip: "000000001", holdingRows: 1, reportedValueUsd: "1" }];
    const trustedState = [{ cusip: "000000001", evidence: [], lookupState: { outcome: "UNSUPPORTED" } }];
    expect(selectInstitutionalReferenceLookupCusips({ population, trustedState, maxCusips: 1 }))
      .toEqual([]);
    expect(selectInstitutionalReferenceLookupCusips({ population, trustedState, maxCusips: 1, refreshTerminal: true }))
      .toEqual(["000000001"]);
    const first = buildInstitutionalSecurityReferencePlan({
      population, trustedState, providerResolutions: [], maxCusips: 1,
    });
    const refreshed = buildInstitutionalSecurityReferencePlan({
      population, trustedState, providerResolutions: [], maxCusips: 1, refreshTerminal: true,
    });
    expect(first.planHash).not.toBe(refreshed.planHash);
    expect(first.actionCounts.plannedLookups).toBe(0);
  });

  it("does not call a CUSIP with candidate history never-processed", () => {
    const population = [
      { cusip: "000000001", holdingRows: 1, reportedValueUsd: "1" },
      { cusip: "000000002", holdingRows: 1, reportedValueUsd: "2" },
    ];
    const trustedState = [{
      cusip: "000000001",
      evidence: [],
      candidateHistoryPresent: true,
    }];
    expect(selectInstitutionalReferenceLookupCusips({ population, trustedState, maxCusips: 2 }))
      .toEqual(["000000002", "000000001"]);
  });

  it("classifies unrequested bounded remainder as not processed, never partial", () => {
    const plan = buildInstitutionalSecurityReferencePlan({
      population: [
        { cusip: "037833100", holdingRows: 2, reportedValueUsd: "3" },
        { cusip: "594918104", holdingRows: 5, reportedValueUsd: "7" },
      ], trustedState: [], plannedLookupCusips: ["037833100"], providerResolutions: [resolution], maxCusips: 1,
    });
    expect(plan.actionCounts.skippedByLimit).toBe(1);
    expect(plan.actionCounts.notProcessed).toBe(1);
    expect(plan.outcomes.find(x => x.outcome === "not_processed")).toMatchObject({ distinctCusips: 1, holdingRows: 5, knownReportedValueUsd: "7" });
    expect(plan.outcomes.find(x => x.outcome === "partial")?.distinctCusips).toBe(0);
    expect(plan.attemptedOutcomes.reduce((total, item) => total + item.count, 0))
      .toBe(plan.actionCounts.plannedLookups);
    expect(plan.attemptedOutcomes.find(item => item.outcome === "authoritatively_resolvable")?.count).toBe(1);
    const output = JSON.stringify(referencePlanAggregateSummary(plan));
    // The sole identifier permitted in safe output is the continuation cursor.
    expect(referencePlanChunkSummary(plan).nextCursor).toBe("037833100");
    expect(output).not.toContain("594918104");
  });

  it("selects a deterministic exclusive CUSIP cursor chunk and reports cursor skips separately", () => {
    const base = {
      population: [
        { cusip: "594918104", holdingRows: 1, reportedValueUsd: "1" },
        { cusip: "037833100", holdingRows: 1, reportedValueUsd: "1" },
        { cusip: "023135106", holdingRows: 1, reportedValueUsd: "1" },
      ], trustedState: [], maxCusips: 1,
    };
    expect(selectInstitutionalReferenceLookupCusips(base)).toEqual(["023135106"]);
    expect(selectInstitutionalReferenceLookupCusips({ ...base, cursor: "023135106" })).toEqual(["037833100"]);
    expect(selectInstitutionalReferenceLookupCusips({ ...base, cursor: "037833100" })).toEqual(["594918104"]);
    const plan = buildInstitutionalSecurityReferencePlan({
      ...base, cursor: "023135106", plannedLookupCusips: ["037833100"], providerResolutions: [resolution],
    });
    expect(plan.actionCounts).toMatchObject({ skippedByCursor: 1, skippedByLimit: 1, notProcessed: 2 });
    expect(plan.nextCursor).toBe("037833100");
    expect(referencePlanChunkSummary(plan)).toMatchObject({
      cursor: "023135106", nextCursor: "037833100", requested: 1, hasMore: true,
    });
    const empty = buildInstitutionalSecurityReferencePlan({ ...base, cursor: "594918104", plannedLookupCusips: [], providerResolutions: [] });
    expect(empty.nextCursor).toBeNull();
    expect(referencePlanChunkSummary(empty)).toMatchObject({ nextCursor: null, requested: 0, hasMore: false });
  });

  it("hashes the complete population, cursor chunk, and exact provider results", () => {
    const first = buildInstitutionalSecurityReferencePlan({ ...input(1), plannedLookupCusips: ["037833100"] });
    const changedPopulation = buildInstitutionalSecurityReferencePlan({
      ...input(1), plannedLookupCusips: ["037833100"],
      population: [...input().population, { cusip: "023135106", holdingRows: 1, reportedValueUsd: "1" }],
    });
    const changedProvider = buildInstitutionalSecurityReferencePlan({
      ...input(1), plannedLookupCusips: ["037833100"],
      providerResolutions: [{ ...resolution, outcome: "NO_REFERENCE_AVAILABLE", symbol: null, candidates: [] }],
    });
    expect(changedPopulation.planHash).not.toBe(first.planHash);
    expect(changedProvider.planHash).not.toBe(first.planHash);
  });

  it("backfills trusted missing asset types and reports projected coverage", () => {
    const providerCandidate = {
      provider: "openfigi",
      ticker: "ACME",
      figi: "BBGACME",
      securityType: "Common Stock",
      marketSector: "Equity",
    };
    const population = [{
      cusip: "000000001",
      holdingRows: 3,
      reportedValueUsd: "900",
      trustedSymbols: ["ACME"],
      currentAssetType: null,
    }];
    const trustedState = [{
      cusip: "000000001",
      evidence: [{ source: "institutional_mapping", cusip: "000000001", symbol: "ACME", status: "exact" as const }],
      trusted: true,
      currentAssetType: null,
      candidateEvidence: [providerCandidate],
    }];
    const selected = selectInstitutionalReferenceLookupCusips({
      population,
      trustedState,
      maxCusips: 1,
      includeAssetTypeBackfill: true,
    });
    expect(selected).toEqual(["000000001"]);
    const plan = buildInstitutionalSecurityReferencePlan({
      population,
      trustedState,
      providerResolutions: [],
      plannedLookupCusips: selected,
      maxCusips: 1,
      includeAssetTypeBackfill: true,
    });
    expect(plan.actions[0]).toMatchObject({
      assetTypeBackfill: true,
      assetType: "common_stock",
      promotable: true,
    });
    expect(plan.assetTypes).toMatchObject({
      trustedCusips: 1,
      trustedSymbols: 1,
      assetTypePopulated: 0,
      assetTypeMissing: 1,
      projectedAssetTypePopulated: 1,
      projectedAssetTypeInsufficient: 0,
    });
    expect(plan.assetTypes.classifications).toContainEqual(expect.objectContaining({
      canonicalSecurityType: "common_stock",
      securityTypePopulation: "ELIGIBLE_STOCK_ANALYTICS",
      distinctCusips: 1,
      distinctSymbols: 1,
      holdingRows: 3,
      reportedValueUsd: "900",
    }));
    expect(plan.selection.asset_type_backfill).toBe(1);
  });

  it("does not select a reviewed non-null asset type for automated backfill", () => {
    expect(selectInstitutionalReferenceLookupCusips({
      population: [{
        cusip: "000000001",
        holdingRows: 1,
        reportedValueUsd: "1",
        currentAssetType: "common_stock",
      }],
      trustedState: [{
        cusip: "000000001",
        evidence: [{ source: "master", cusip: "000000001", symbol: "ACME", status: "reviewed" }],
        trusted: true,
        currentAssetType: "common_stock",
        assetTypeReviewed: true,
      }],
      maxCusips: 1,
      includeAssetTypeBackfill: true,
    })).toEqual([]);
  });

  it("prioritizes every trusted asset-type backfill before retryable failures", () => {
    const backfillCusips = ["900000001", "900000002", "900000003", "900000004"];
    const retryCusips = Array.from({ length: 1036 }, (_, index) =>
      `1${String(index + 1).padStart(8, "0")}`,
    );
    const population = [
      ...backfillCusips.map((cusip, index) => ({
        cusip,
        holdingRows: index + 1,
        reportedValueUsd: String(index + 1),
        trustedSymbols: [`BACKFILL${index + 1}`],
        currentAssetType: null,
      })),
      ...retryCusips.map((cusip) => ({
        cusip,
        holdingRows: 1,
        reportedValueUsd: "1",
      })),
    ];
    const trustedState = [
      ...backfillCusips.map((cusip, index) => ({
        cusip,
        evidence: [{
          source: "mapping",
          cusip,
          symbol: `BACKFILL${index + 1}`,
          status: "exact" as const,
        }],
        trusted: true,
        currentAssetType: null,
      })),
      ...retryCusips.map((cusip) => ({
        cusip,
        evidence: [],
        lookupState: { outcome: "PROVIDER_FAILED" },
      })),
    ];
    const selected = selectInstitutionalReferenceLookupCusips({
      population,
      trustedState,
      maxCusips: 100,
      includeAssetTypeBackfill: true,
    });
    expect(selected).toHaveLength(100);
    expect(selected.slice(0, 4)).toEqual(backfillCusips);
    expect(selected.slice(4)).toEqual(retryCusips.slice(0, 96));
    expect(selectInstitutionalReferenceLookupCusips({
      population,
      trustedState,
      maxCusips: 2,
      includeAssetTypeBackfill: true,
    })).toEqual(backfillCusips.slice(0, 2));
  });

  it("counts insufficient and fund projections without making them stock-eligible", () => {
    const population = [
      { cusip: "000000001", holdingRows: 1, reportedValueUsd: "10", trustedSymbols: ["FUND"], currentAssetType: null },
      { cusip: "000000002", holdingRows: 2, reportedValueUsd: "20", trustedSymbols: ["UNKNOWN"], currentAssetType: null },
    ];
    const trustedState = [
      {
        cusip: "000000001",
        evidence: [{ source: "mapping", cusip: "000000001", symbol: "FUND", status: "exact" as const }],
        trusted: true,
        candidateEvidence: [{ provider: "openfigi", ticker: "FUND", securityType: "ETF" }],
      },
      {
        cusip: "000000002",
        evidence: [{ source: "mapping", cusip: "000000002", symbol: "UNKNOWN", status: "exact" as const }],
        trusted: true,
        candidateEvidence: [{ provider: "openfigi", ticker: "UNKNOWN", securityType: "Equity" }],
      },
    ];
    const summary = assetTypeCoverageSummary(population, trustedState);
    expect(summary.projectedAssetTypePopulated).toBe(1);
    expect(summary.projectedAssetTypeInsufficient).toBe(1);
    expect(summary.classifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalSecurityType: "etf", securityTypePopulation: "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS" }),
      expect.objectContaining({ canonicalSecurityType: "insufficient_evidence", securityTypePopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE" }),
    ]));
  });
});