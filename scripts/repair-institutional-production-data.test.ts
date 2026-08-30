import { describe, expect, it } from "vitest";
import {
  INSTITUTIONAL_REPAIR_CONFIRMATION,
  VERIFIED_REPAIR_MAPPINGS,
  buildInstitutionalRepairPlanHash,
  classifyExpectedSecurityTrace,
  evaluateInstitutionalRepairValidation,
  getRepairBlockingIssues,
  issuerNamesMatchExpectedSymbol,
  shouldRunRepairStage,
  validateRepairApplyRequest,
} from "../server/services/institutional/production-repair";
import { previousCalendarQuarterEnd } from "../server/services/institutional/ingestion-service";
import {
  parseRepairCliArgs,
  validateRepairCheckpointResume,
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
      orphanHoldingRows: 1,
      mappingCounts: {},
      expectedSecurities: VERIFIED_REPAIR_MAPPINGS.map((mapping, index) => ({
        ...mapping,
        issuerNames: [],
        effectiveHoldingRows: index === 0 ? 0 : 1,
        mappedHoldingRows: 0,
        conflictingHoldingRows: index === 1 ? 1 : 0,
        issuerIdentityMatched: true,
        referenceSymbol: null,
        referenceStatus: null,
        mappingAction: index === 1 ? "conflict" as const : "insert_reviewed" as const,
      })),
      plan: {
        effectiveHoldings: 10,
        reliableMappingCandidates: 4,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 9,
        conflictingMappedHoldings: 1,
        aggregateSymbols: 4,
        aggregateQuarters: 8,
        reliableMappingDigest: "mappings",
        targetHoldingDigest: "holdings",
      },
    });
    expect(issues).toContain("DUPLICATE_HOLDING_GROUPS_PRESENT");
    expect(issues).toContain("ORPHAN_HOLDINGS_PRESENT");
    expect(issues).toContain("EXPECTED_CUSIP_NOT_PRESENT:AAPL");
    expect(issues).toContain("EXPECTED_CUSIP_CONFLICT:NVDA");
    expect(issues).toContain("CONFLICTING_EXISTING_HOLDING_MAPPINGS");
  });

  it("hashes plans deterministically and changes on drift", () => {
    const plan = {
      databaseIdentity: { database: "db", user: "user", schema: "public", railwayEnvironment: "production" },
      schemaReady: true,
      publicFeatureEnabled: false,
      duplicateHoldingGroups: 0,
      orphanHoldingRows: 0,
      mappingCounts: {},
      expectedSecurities: [],
      plan: {
        effectiveHoldings: 100,
        reliableMappingCandidates: 4,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 100,
        conflictingMappedHoldings: 0,
        aggregateSymbols: 4,
        aggregateQuarters: 8,
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