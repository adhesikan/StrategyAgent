import { describe, expect, it } from "vitest";
import {
  INSTITUTIONAL_REPAIR_CONFIRMATION,
  VERIFIED_REPAIR_MAPPINGS,
  buildDuplicateDataQualityWarnings,
  buildInstitutionalRepairPlanHash,
  classifyExpectedSecurityTrace,
  evaluateInstitutionalRepairValidation,
  getRepairBlockingIssues,
  getRepairScopeDuplicateBlockingIssues,
  getRepairStageBlockingIssues,
  issuerNamesMatchExpectedSymbol,
  shouldRunRepairStage,
  validateRepairApplyRequest,
} from "../server/services/institutional/production-repair";
import { previousCalendarQuarterEnd } from "../server/services/institutional/ingestion-service";
import {
  parseRepairCliArgs,
  validateRepairCheckpointResume,
  validateRepairDatabaseRuntime,
  type Checkpoint,
} from "./repair-institutional-production-data";

describe("institutional production repair safety", () => {
  it("defaults to dry-run and the mapping stage", () => {
    expect(parseRepairCliArgs([])).toMatchObject({ apply: false, fromStage: "mapping" });
  });

  it("requires every production write guard", () => {
    expect(validateRepairApplyRequest({
      apply: true,
      confirmation: "wrong",
      environment: "development",
      railwayEnvironment: "staging",
      publicFeatureEnabled: true,
    })).toEqual([
      "CONFIRMATION_PHRASE_MISMATCH",
      "PRODUCTION_ENVIRONMENT_ARGUMENT_REQUIRED",
      "RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION",
      "EXPECTED_DATABASE_NAME_REQUIRED",
      "PUBLIC_FEATURE_MUST_REMAIN_DISABLED",
    ]);

    expect(validateRepairApplyRequest({
      apply: true,
      confirmation: INSTITUTIONAL_REPAIR_CONFIRMATION,
      environment: "production",
      railwayEnvironment: "production",
      publicFeatureEnabled: false,
      expectedDatabase: "production_db",
      currentDatabase: "production_db",
    })).toEqual([]);
  });

  it("requires the runtime DATABASE_URL and rejects external database overrides", () => {
    expect(validateRepairDatabaseRuntime({})).toEqual(["DATABASE_URL_REQUIRED"]);
    expect(validateRepairDatabaseRuntime({
      DATABASE_URL: "configured",
      EXTERNAL_DATABASE_URL: "configured",
    })).toEqual(["EXTERNAL_DATABASE_URL_FORBIDDEN"]);
    expect(validateRepairDatabaseRuntime({ DATABASE_URL: "configured" })).toEqual([]);
  });

  it("blocks repair until canonical security corrections are complete", () => {
    const issues = getRepairBlockingIssues({
      databaseIdentity: { database: "db", user: "user", schema: "public", railwayEnvironment: "production" },
      schemaReady: true,
      publicFeatureEnabled: false,
      duplicateHoldingGroups: 0,
      duplicateClassification: {
        materiallyDistinctGroups: 0,
        sourceIdentityUnresolvedGroups: 0,
        affectedFilings: 0,
        affectedCusips: 0,
        exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
        rootCause: "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      },
      dataQualityWarnings: [],
      orphanHoldingRows: 0,
      mappingCounts: {},
      dataQuality: {
        totalFilings: 2, effectiveFilings: 2, totalHoldings: 2, effectiveHoldings: 2,
        effectiveManagers: 1, effectiveQuarters: 2, latestEffectiveQuarter: "2026-06-30",
        mappedEffectiveHoldings: 0, mappingCoverage: 0, aggregateRows: 0, aggregateState: "incomplete",
      },
      expectedSecurities: [],
      canonicalCorrectionState: {
        verified: true,
        correctionPlanHash: "hash",
        correctionActions: 1,
        unresolvedBlockers: 0,
      },
      plan: {
        effectiveHoldings: 2, reliableMappingCandidates: 0, mappingRowsToInsert: 0,
        mappingRowsToPromote: 0, ambiguousMappings: 0, unmappedMappings: 0, rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0, holdingsToUpdate: 0, remainingUnmappedEffectiveHoldings: 2,
        conflictingMappedHoldings: 0, aggregateSymbols: 0, aggregateQuarters: 0,
        aggregateRowsToInsert: 0, aggregateRowsToUpdate: 0, signalRowsToInsert: 0, signalRowsToUpdate: 0,
        reliableMappingDigest: "", targetHoldingDigest: "",
      },
    });
    expect(issues).toContain("CANONICAL_SECURITY_TYPE_CORRECTIONS_PENDING");
  });

  it("contains only the four explicitly verified repair mappings", () => {
    expect(VERIFIED_REPAIR_MAPPINGS).toEqual([
      { symbol: "AAPL", cusip: "037833100", issuerName: "Apple Inc." },
      { symbol: "NVDA", cusip: "67066G104", issuerName: "NVIDIA Corporation" },
      { symbol: "MSFT", cusip: "594918104", issuerName: "Microsoft Corporation" },
      { symbol: "COST", cusip: "22160K105", issuerName: "Costco Wholesale Corporation" },
    ]);
  });

  it("never silently overwrites conflicting mappings", () => {
    expect(classifyExpectedSecurityTrace({
      symbol: "AAPL",
      effectiveHoldingRows: 10,
      conflictingHoldingRows: 1,
      referenceSymbol: "MSFT",
      referenceStatus: "reviewed",
    })).toBe("conflict");
    expect(classifyExpectedSecurityTrace({
      symbol: "AAPL",
      effectiveHoldingRows: 10,
      conflictingHoldingRows: 0,
      referenceSymbol: "AAPL",
      referenceStatus: "probable",
    })).toBe("promote_reviewed");
    expect(classifyExpectedSecurityTrace({
      symbol: "AAPL",
      effectiveHoldingRows: 10,
      conflictingHoldingRows: 0,
      referenceSymbol: "AAPL",
      referenceStatus: "reviewed",
    })).toBe("already_reliable");
  });

  it("blocks duplicates, orphans, missing expected CUSIPs and conflicts", () => {
    const issues = getRepairBlockingIssues({
      databaseIdentity: {
        database: "db",
        user: "user",
        schema: "public",
        railwayEnvironment: "production",
      },
      schemaReady: true,
      publicFeatureEnabled: false,
      duplicateHoldingGroups: 2,
      duplicateClassification: {
        materiallyDistinctGroups: 2,
        sourceIdentityUnresolvedGroups: 0,
        affectedFilings: 2,
        affectedCusips: 2,
        exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
        rootCause: "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      },
      dataQualityWarnings: [
        "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
        "MATERIALLY_DISTINCT_LEGACY_KEY_GROUPS:2",
      ],
      orphanHoldingRows: 1,
      mappingCounts: {},
      dataQuality: {
        totalFilings: 0,
        effectiveFilings: 0,
        totalHoldings: 0,
        effectiveHoldings: 0,
        effectiveManagers: 0,
        effectiveQuarters: 0,
        latestEffectiveQuarter: null,
        mappedEffectiveHoldings: 0,
        mappingCoverage: null,
        aggregateRows: 0,
        aggregateState: "incomplete",
      },
      expectedSecurities: VERIFIED_REPAIR_MAPPINGS.map((mapping, index) => ({
        ...mapping,
        issuerNames: [],
        effectiveHoldingRows: index === 0 ? 0 : 1,
        mappedHoldingRows: 0,
        conflictingHoldingRows: index === 1 ? 1 : 0,
        sourceIdentityUnresolvedEligibleGroups: index === 2 ? 1 : 0,
        issuerIdentityMatched: true,
        referenceSymbol: null,
        referenceStatus: null,
        mappingAction: index === 1 ? "conflict" as const : "insert_reviewed" as const,
      })),
      plan: {
        effectiveHoldings: 10,
        reliableMappingCandidates: 4,
        mappingRowsToInsert: 4,
        mappingRowsToPromote: 0,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 9,
        remainingUnmappedEffectiveHoldings: 1,
        conflictingMappedHoldings: 1,
        aggregateSymbols: 4,
        aggregateQuarters: 8,
        aggregateRowsToInsert: 8,
        aggregateRowsToUpdate: 0,
        signalRowsToInsert: 4,
        signalRowsToUpdate: 0,
        reliableMappingDigest: "mappings",
        targetHoldingDigest: "holdings",
      },
    });
    expect(issues).not.toContain("DUPLICATE_HOLDING_GROUPS_PRESENT");
    expect(issues).toContain("SOURCE_IDENTITY_UNRESOLVED_IN_REPAIR_SCOPE:MSFT");
    expect(issues).toContain("ORPHAN_HOLDINGS_PRESENT");
    expect(issues).toContain("EXPECTED_CUSIP_NOT_PRESENT:AAPL");
    expect(issues).toContain("EXPECTED_CUSIP_CONFLICT:NVDA");
    expect(issues).toContain("CONFLICTING_EXISTING_HOLDING_MAPPINGS");
    expect(issues).toContain("NO_EFFECTIVE_FILINGS");
    expect(issues).toContain("INSUFFICIENT_HISTORICAL_QUARTERS");
  });

  it("treats global duplicate classifications as warnings and blocks only unresolved target rows", () => {
    const cleanTargets = VERIFIED_REPAIR_MAPPINGS.map((mapping) => ({
      ...mapping,
      issuerNames: [mapping.issuerName],
      effectiveHoldingRows: 10,
      mappedHoldingRows: 0,
      conflictingHoldingRows: 0,
      sourceIdentityUnresolvedEligibleGroups: 0,
      issuerIdentityMatched: true,
      referenceSymbol: null,
      referenceStatus: null,
      mappingAction: "insert_reviewed" as const,
    }));
    expect(getRepairScopeDuplicateBlockingIssues(cleanTargets)).toEqual([]);
    expect(buildDuplicateDataQualityWarnings({
      materiallyDistinctGroups: 60_365,
      sourceIdentityUnresolvedGroups: 48,
    })).toEqual([
      "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      "MATERIALLY_DISTINCT_LEGACY_KEY_GROUPS:60365",
      "SOURCE_IDENTITY_UNRESOLVED_GLOBAL:48",
    ]);
    expect(getRepairScopeDuplicateBlockingIssues([
      ...cleanTargets.slice(0, 3),
      { ...cleanTargets[3], sourceIdentityUnresolvedEligibleGroups: 2 },
    ])).toEqual(["SOURCE_IDENTITY_UNRESOLVED_IN_REPAIR_SCOPE:COST"]);
  });

  it("stops when existing reliable mapping coverage is no longer near zero", () => {
    const issues = getRepairBlockingIssues({
      databaseIdentity: {
        database: "prod",
        user: "user",
        schema: "public",
        railwayEnvironment: "production",
      },
      schemaReady: true,
      publicFeatureEnabled: false,
      duplicateHoldingGroups: 0,
      duplicateClassification: {
        materiallyDistinctGroups: 0,
        sourceIdentityUnresolvedGroups: 0,
        affectedFilings: 0,
        affectedCusips: 0,
        exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
        rootCause: "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      },
      dataQualityWarnings: [],
      orphanHoldingRows: 0,
      mappingCounts: { reviewed: 10 },
      dataQuality: {
        totalFilings: 1394,
        effectiveFilings: 970,
        totalHoldings: 562000,
        effectiveHoldings: 500000,
        effectiveManagers: 970,
        effectiveQuarters: 41,
        latestEffectiveQuarter: "2026-06-30",
        mappedEffectiveHoldings: 30000,
        mappingCoverage: 0.06,
        aggregateRows: 0,
        aggregateState: "incomplete",
      },
      expectedSecurities: VERIFIED_REPAIR_MAPPINGS.map((mapping) => ({
        ...mapping,
        issuerNames: [mapping.issuerName],
        effectiveHoldingRows: 10,
        mappedHoldingRows: 0,
        conflictingHoldingRows: 0,
        sourceIdentityUnresolvedEligibleGroups: 0,
        issuerIdentityMatched: true,
        referenceSymbol: null,
        referenceStatus: null,
        mappingAction: "insert_reviewed" as const,
      })),
      plan: {
        effectiveHoldings: 500000,
        reliableMappingCandidates: 4,
        mappingRowsToInsert: 4,
        mappingRowsToPromote: 0,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 40,
        remainingUnmappedEffectiveHoldings: 499960,
        conflictingMappedHoldings: 0,
        aggregateSymbols: 4,
        aggregateQuarters: 164,
        aggregateRowsToInsert: 164,
        aggregateRowsToUpdate: 0,
        signalRowsToInsert: 4,
        signalRowsToUpdate: 0,
        reliableMappingDigest: "mappings",
        targetHoldingDigest: "holdings",
      },
    });
    expect(issues).toContain("MAPPING_COVERAGE_NOT_NEAR_ZERO");
  });

  it("requires incomplete scoped aggregates for mapping or aggregate stages only", () => {
    const preflight = {
      dataQuality: { aggregateState: "present" },
    } as Parameters<typeof getRepairStageBlockingIssues>[0];
    expect(getRepairStageBlockingIssues(preflight, "mapping")).toEqual([
      "AGGREGATE_STATE_NOT_INCOMPLETE",
    ]);
    expect(getRepairStageBlockingIssues(preflight, "aggregates")).toEqual([
      "AGGREGATE_STATE_NOT_INCOMPLETE",
    ]);
    expect(getRepairStageBlockingIssues(preflight, "snapshots")).toEqual([]);
  });

  it("hashes plans deterministically and changes on drift", () => {
    const plan = {
      databaseIdentity: { database: "db", user: "user", schema: "public", railwayEnvironment: "production" },
      schemaReady: true,
      publicFeatureEnabled: false,
      duplicateHoldingGroups: 0,
      duplicateClassification: {
        materiallyDistinctGroups: 0,
        sourceIdentityUnresolvedGroups: 0,
        affectedFilings: 0,
        affectedCusips: 0,
        exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
        rootCause: "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      },
      dataQualityWarnings: [],
      orphanHoldingRows: 0,
      mappingCounts: {},
      dataQuality: {
        totalFilings: 100,
        effectiveFilings: 100,
        totalHoldings: 1000,
        effectiveHoldings: 1000,
        effectiveManagers: 20,
        effectiveQuarters: 8,
        latestEffectiveQuarter: "2026-06-30",
        mappedEffectiveHoldings: 0,
        mappingCoverage: 0,
        aggregateRows: 0,
        aggregateState: "incomplete",
      },
      expectedSecurities: [],
      plan: {
        effectiveHoldings: 100,
        reliableMappingCandidates: 4,
        mappingRowsToInsert: 4,
        mappingRowsToPromote: 0,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 100,
        remainingUnmappedEffectiveHoldings: 0,
        conflictingMappedHoldings: 0,
        aggregateSymbols: 4,
        aggregateQuarters: 8,
        aggregateRowsToInsert: 8,
        aggregateRowsToUpdate: 0,
        signalRowsToInsert: 4,
        signalRowsToUpdate: 0,
        reliableMappingDigest: "mappings",
        targetHoldingDigest: "holdings",
      },
    };
    expect(buildInstitutionalRepairPlanHash(plan)).toBe(buildInstitutionalRepairPlanHash(plan));
    expect(buildInstitutionalRepairPlanHash(plan)).not.toBe(
      buildInstitutionalRepairPlanHash({
        ...plan,
        plan: { ...plan.plan, holdingsToUpdate: 99 },
      }),
    );
    expect(buildInstitutionalRepairPlanHash(plan)).not.toBe(
      buildInstitutionalRepairPlanHash({
        ...plan,
        plan: { ...plan.plan, targetHoldingDigest: "same-count-different-targets" },
      }),
    );
  });

  it("supports resuming from a downstream idempotent stage", () => {
    expect(shouldRunRepairStage("mapping", "signals")).toBe(false);
    expect(shouldRunRepairStage("signals", "signals")).toBe(true);
    expect(shouldRunRepairStage("validation", "signals")).toBe(true);
  });

  it("uses only the immediate calendar quarter as a comparison", () => {
    expect(previousCalendarQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousCalendarQuarterEnd("2026-06-30")).toBe("2026-03-31");
    expect(previousCalendarQuarterEnd("2026-09-30")).toBe("2026-06-30");
    expect(previousCalendarQuarterEnd("2026-12-31")).toBe("2026-09-30");
    expect(previousCalendarQuarterEnd("2026-08-30")).toBeNull();
  });

  it("verifies expected CUSIPs against issuer identity evidence", () => {
    expect(issuerNamesMatchExpectedSymbol("AAPL", ["APPLE INC"])).toBe(true);
    expect(issuerNamesMatchExpectedSymbol("NVDA", ["NVIDIA CORPORATION COM"])).toBe(true);
    expect(issuerNamesMatchExpectedSymbol("MSFT", ["UNRELATED ISSUER"])).toBe(false);
    expect(issuerNamesMatchExpectedSymbol("COST", [])).toBe(false);
  });

  it("rejects resume when identity, plan, or prior stages do not match", () => {
    const checkpoint: Checkpoint = {
      version: 1,
      mode: "apply",
      planHash: "original",
      resumePlanHash: "current",
      databaseIdentity: {
        database: "prod",
        user: "postgres",
        schema: "public",
        railwayEnvironment: "production",
      },
      startedAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      stages: {
        mapping: {
          status: "completed",
          completedAt: "2026-08-30T00:01:00.000Z",
          result: {},
        },
      },
    };
    expect(validateRepairCheckpointResume(checkpoint, {
      fromStage: "signals",
      currentPlanHash: "drifted",
      databaseIdentity: { ...checkpoint.databaseIdentity, database: "other" },
    })).toEqual([
      "CHECKPOINT_PLAN_HASH_MISMATCH",
      "CHECKPOINT_DATABASE_IDENTITY_MISMATCH",
      "CHECKPOINT_PRIOR_STAGE_NOT_COMPLETED:aggregates",
    ]);
  });

  it("accepts a snapshots resume with the refreshed post-aggregate and post-signal hash", () => {
    const checkpoint: Checkpoint = {
      version: 1,
      mode: "apply",
      planHash: "initial-plan",
      resumePlanHash: "post-signal-plan",
      databaseIdentity: {
        database: "prod",
        user: "postgres",
        schema: "public",
        railwayEnvironment: "production",
      },
      startedAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:05:00.000Z",
      stages: {
        mapping: {
          status: "completed",
          completedAt: "2026-08-30T00:01:00.000Z",
          result: {},
        },
        aggregates: {
          status: "completed",
          completedAt: "2026-08-30T00:03:00.000Z",
          result: {},
        },
        signals: {
          status: "completed",
          completedAt: "2026-08-30T00:05:00.000Z",
          result: {},
        },
      },
    };
    expect(validateRepairCheckpointResume(checkpoint, {
      fromStage: "snapshots",
      currentPlanHash: "post-signal-plan",
      databaseIdentity: checkpoint.databaseIdentity,
    })).toEqual([]);
  });

  it("fails validation when rebuilt data is incomplete or stale", () => {
    const issues = evaluateInstitutionalRepairValidation({
      symbols: [{
        symbol: "AAPL",
        reference_symbol: "AAPL",
        reference_status: "reviewed",
        holding_rows: 10,
        reliably_mapped_rows: 9,
        aggregate_quarters: 1,
        latest_aggregate_at: "2026-08-29T00:00:00.000Z",
        signal_status: "unavailable",
        signal_calculated_at: null,
      }],
      snapshots: {
        sectorRows: 0,
        latestSectorGeneratedAt: null,
        themeRows: 0,
        latestThemeGeneratedAt: null,
      },
      invalidComparableRows: 1,
    }, {
      repairStartedAt: "2026-08-30T00:00:00.000Z",
      snapshotsRequired: true,
    });
    expect(issues).toContain("VALIDATION_MAPPING_COVERAGE_INCOMPLETE:AAPL");
    expect(issues).toContain("VALIDATION_COMPARABLE_QUARTERS_MISSING:AAPL");
    expect(issues).toContain("VALIDATION_AGGREGATE_NOT_REBUILT:AAPL");
    expect(issues).toContain("VALIDATION_SIGNAL_NOT_AVAILABLE:AAPL");
    expect(issues).toContain("VALIDATION_INVALID_QUARTER_COMPARISONS");
    expect(issues).toContain("VALIDATION_SECTOR_SNAPSHOT_NOT_REBUILT");
    expect(issues).toContain("VALIDATION_THEME_SNAPSHOT_NOT_REBUILT");
  });
});