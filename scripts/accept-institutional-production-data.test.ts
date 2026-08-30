import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_QUARTERS,
  ACCEPTANCE_SYMBOLS,
  buildReadOnlyDatabaseUrl,
  runAcceptance,
  validateAcceptanceReport,
  validateAcceptanceRuntime,
  type AcceptanceServiceResults,
  type RawSymbolEvidence,
} from "./accept-institutional-production-data";

function makeEvidence(overrides: Partial<RawSymbolEvidence> = {}): RawSymbolEvidence {
  const symbol = overrides.symbol ?? "AAPL";
  const cusip = overrides.cusip ?? ACCEPTANCE_SYMBOLS[symbol as keyof typeof ACCEPTANCE_SYMBOLS];
  return {
    symbol,
    cusip,
    effectiveHoldingRows: 10,
    reliablyMappedHoldingRows: 10,
    unmappedHoldingRows: 0,
    conflictingMappedHoldingRows: 0,
    mappingReferenceRows: 1,
    conflictingReliableMappingRows: 0,
    commonEquityRows: 10,
    optionRows: 0,
    prnRows: 0,
    nullValueRows: 0,
    exactDuplicateGroups: 0,
    legitimateMultipleGroups: 2,
    invalidComparableRowsAll: 0,
    effectiveManagerCount: 10,
    effectiveQuarterCount: 2,
    aggregateQuarterCount: 2,
    comparableManagerCount: 10,
    quarterRows: ACCEPTANCE_QUARTERS.map(({ period, label }, index) => ({
      symbol,
      period,
      periodLabel: label,
      aggregateRowCount: 1,
      reportingManagerCount: 10,
      aggregateReportedShares: 1000 + index,
      aggregateReportedValue: 100000 + index,
      previousQuarterShares: index === 0 ? 1001 : null,
      previousQuarterValue: index === 0 ? 100001 : null,
      reportedSharesChange: index === 0 ? -1 : null,
      reportedSharesChangePercent: index === 0 ? 0.001 : null,
      newPositionCount: 1,
      increasedPositionCount: 2,
      reducedPositionCount: 1,
      exitedPositionCount: 0,
      unchangedCount: 6,
      eligibleHoldingCount: 10,
      excludedHoldingCount: 0,
      coverageStatus: "complete",
      amendmentStatus: "clean",
      invalidComparableRows: 0,
      topHolderPercent: 0.1,
      top5HolderPercent: 0.3,
      largestHolders: [],
      rawCommonRows: 10,
      rawOptionRows: 0,
      rawPrnRows: 0,
      rawCommonRowsWithNullValue: 0,
      rawCommonShares: 1000 + index,
      rawCommonValue: 100000 + index,
      rawCommonManagerCount: 10,
    })),
    ...overrides,
  };
}

function makeServices(evidence: RawSymbolEvidence): Map<string, AcceptanceServiceResults> {
  const current = evidence.quarterRows.find((row) => row.period === "2026-03-31")!;
  return new Map([[evidence.symbol, {
    analytics: {
      aggregateReportedShares: current.aggregateReportedShares,
      aggregateReportedValueDollars: current.aggregateReportedValue,
      reportingManagerCount: current.reportingManagerCount,
      managerChangeCounts: {
        new: current.newPositionCount,
        increased: current.increasedPositionCount,
        reduced: current.reducedPositionCount,
        exited: current.exitedPositionCount,
        unchanged: current.unchangedCount,
      },
      mappingCoverage: {
        reliablyMappedHoldingCount: evidence.reliablyMappedHoldingRows,
        coveragePercent: 100,
      },
    },
    trend: {
      quarters: evidence.quarterRows.map((quarter) => ({
        quarter: { periodEndDate: quarter.period },
        aggregateReportedShares: quarter.aggregateReportedShares,
        aggregateReportedValue: quarter.aggregateReportedValue,
      })),
      classification: "ACCUMULATION",
      dataQuality: { status: "complete", comparableManagerCount: 10 },
    },
    signal: {
      status: "available",
      score: 60,
      label: "Accumulation",
      metrics: {
        totalSharesLatest: current.aggregateReportedShares,
        totalValueLatest: current.aggregateReportedValue,
      },
      scoreComponents: {
        breadth: 60,
        accumulation: 50,
        entrantsVsExits: 55,
        concentration: 50,
        dataQuality: 100,
      },
    },
  }]]);
}

function makeCompleteFixture(): {
  symbols: RawSymbolEvidence[];
  services: Map<string, AcceptanceServiceResults>;
} {
  const symbols = Object.entries(ACCEPTANCE_SYMBOLS).map(([symbol, cusip]) =>
    makeEvidence({ symbol, cusip }),
  );
  return {
    symbols,
    services: new Map(
      symbols.flatMap((evidence) => Array.from(makeServices(evidence).entries())),
    ),
  };
}

describe("Railway institutional acceptance guards", () => {
  it("requires the production Railway context and rejects external database routing", () => {
    expect(validateAcceptanceRuntime({})).toEqual([
      "DATABASE_URL_REQUIRED",
      "RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION",
      "RAILWAY_PROJECT_ID_REQUIRED",
      "RAILWAY_SERVICE_ID_REQUIRED",
      "RAILWAY_ENVIRONMENT_ID_REQUIRED",
    ]);
    expect(validateAcceptanceRuntime({
      DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
      EXTERNAL_DATABASE_URL: "forbidden",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_SERVICE_ID: "service",
      RAILWAY_ENVIRONMENT_ID: "environment",
    })).toEqual(["EXTERNAL_DATABASE_URL_FORBIDDEN"]);
    const readOnlyUrl = new URL(buildReadOnlyDatabaseUrl(
      "postgresql://u:p@postgres.railway.internal:5432/railway?sslmode=require",
    ));
    expect(readOnlyUrl.searchParams.get("options")).toBe("-c default_transaction_read_only=on");
    expect(readOnlyUrl.searchParams.get("sslmode")).toBe("require");
  });

  it("has no application database import until guards pass and no mutation/network path", () => {
    const source = readFileSync(new URL("./accept-institutional-production-data.ts", import.meta.url), "utf8");
    expect(source).toContain('import("../server/db")');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    expect(source).not.toMatch(/\b(fetch|axios|https?:\/\/)\b/i);
    expect(source).not.toMatch(/ingestion|backfill/i);
  });

  it("fails closed when either fixed quarter is absent", () => {
    const evidence = makeEvidence({
      symbol: "AAPL",
      quarterRows: [makeEvidence().quarterRows[0]],
    });
    const issues = validateAcceptanceReport(
      { symbols: [evidence], snapshots: { sectorCount: 1, themeCount: 1 } },
      makeServices(evidence),
    );
    expect(issues).toContain("QUARTER_MISSING:AAPL:2025-12-31");
    expect(issues).toContain("FIXED_QUARTER_SET_INCOMPLETE");
  });

  it("passes only when all four symbols and both fixed quarters are complete", () => {
    const fixture = makeCompleteFixture();
    expect(validateAcceptanceReport(
      {
        symbols: fixture.symbols,
        snapshots: { sectorCount: 1, themeCount: 1 },
      },
      fixture.services,
    )).toEqual([]);
  });

  it("fails closed on conflicting mappings, duplicate rows, and a raw aggregate mismatch", () => {
    const evidence = makeEvidence({
      symbol: "AAPL",
      conflictingMappedHoldingRows: 1,
      conflictingReliableMappingRows: 1,
      exactDuplicateGroups: 1,
      quarterRows: makeEvidence().quarterRows.map((row, index) =>
        index === 0 ? { ...row, rawCommonValue: 1 } : row,
      ),
    });
    const issues = validateAcceptanceReport(
      { symbols: [evidence], snapshots: { sectorCount: 1, themeCount: 1 } },
      makeServices(evidence),
    );
    expect(issues).toContain("CONFLICTING_MAPPING:AAPL");
    expect(issues).toContain("EXACT_DUPLICATE_ROWS:AAPL");
    expect(issues).toContain("USD_TOTAL_MISMATCH:AAPL:2026-03-31");
    expect(issues).toContain("SYMBOL_MISSING:NVDA");
    expect(issues).toContain("SYMBOL_MISSING:MSFT");
    expect(issues).toContain("SYMBOL_MISSING:COST");
  });

  it("runs the fixed query and service seams to a complete PASS report", async () => {
    const fixture = makeCompleteFixture();
    const databaseRows = fixture.symbols.flatMap((symbolEvidence) =>
      symbolEvidence.quarterRows.map((quarter) => ({
        symbol: symbolEvidence.symbol,
        cusip: symbolEvidence.cusip,
        effective_holding_rows: symbolEvidence.effectiveHoldingRows,
        reliably_mapped_holding_rows: symbolEvidence.reliablyMappedHoldingRows,
        unmapped_holding_rows: symbolEvidence.unmappedHoldingRows,
        conflicting_mapped_holding_rows: symbolEvidence.conflictingMappedHoldingRows,
        mapping_reference_rows: symbolEvidence.mappingReferenceRows,
        conflicting_reliable_mapping_rows: symbolEvidence.conflictingReliableMappingRows,
        common_equity_rows: symbolEvidence.commonEquityRows,
        option_rows: symbolEvidence.optionRows,
        prn_rows: symbolEvidence.prnRows,
        null_value_rows: symbolEvidence.nullValueRows,
        exact_duplicate_groups: symbolEvidence.exactDuplicateGroups,
        legitimate_multiple_groups: symbolEvidence.legitimateMultipleGroups,
        invalid_comparable_rows_all: symbolEvidence.invalidComparableRowsAll,
        effective_manager_count: symbolEvidence.effectiveManagerCount,
        effective_quarter_count: symbolEvidence.effectiveQuarterCount,
        aggregate_quarter_count: symbolEvidence.aggregateQuarterCount,
        comparable_manager_count: symbolEvidence.comparableManagerCount,
        period: quarter.period,
        period_label: quarter.periodLabel,
        aggregate_row_count: quarter.aggregateRowCount,
        reporting_manager_count: quarter.reportingManagerCount,
        aggregate_reported_shares: quarter.aggregateReportedShares,
        aggregate_reported_value: quarter.aggregateReportedValue,
        previous_quarter_shares: quarter.previousQuarterShares,
        previous_quarter_value: quarter.previousQuarterValue,
        reported_shares_change: quarter.reportedSharesChange,
        reported_shares_change_percent: quarter.reportedSharesChangePercent,
        new_position_count: quarter.newPositionCount,
        increased_position_count: quarter.increasedPositionCount,
        reduced_position_count: quarter.reducedPositionCount,
        exited_position_count: quarter.exitedPositionCount,
        unchanged_count: quarter.unchangedCount,
        eligible_holding_count: quarter.eligibleHoldingCount,
        excluded_holding_count: quarter.excludedHoldingCount,
        coverage_status: quarter.coverageStatus,
        amendment_status: quarter.amendmentStatus,
        invalid_comparable_rows: quarter.invalidComparableRows,
        top_holder_percent: quarter.topHolderPercent,
        top5_holder_percent: quarter.top5HolderPercent,
        largest_holders_text: JSON.stringify(quarter.largestHolders),
        raw_common_rows: quarter.rawCommonRows,
        raw_option_rows: quarter.rawOptionRows,
        raw_prn_rows: quarter.rawPrnRows,
        raw_common_rows_with_null_value: quarter.rawCommonRowsWithNullValue,
        raw_common_shares: quarter.rawCommonShares,
        raw_common_value: quarter.rawCommonValue,
        raw_common_manager_count: quarter.rawCommonManagerCount,
      })),
    );
    let queryCount = 0;
    const executor = {
      execute: async () => {
        queryCount += 1;
        return queryCount === 1
          ? { rows: databaseRows }
          : { rows: [{ sector_count: 1, theme_count: 1 }] };
      },
    };
    const services = {
      getStockInstitutionalAnalytics: async (symbol: string) =>
        fixture.services.get(symbol)?.analytics,
      getStockInstitutionalTrend: async (symbol: string) =>
        fixture.services.get(symbol)?.trend,
      buildInstitutionalSignal: (current: any) =>
        fixture.services.get(current.symbol)?.signal,
      getLatestSectorSnapshots: async () => [{}],
      getLatestThemeSnapshots: async () => [{}],
    };
    const report = await runAcceptance(executor, services);
    expect(queryCount).toBe(2);
    expect(report.productionAcceptance).toBe("PASS");
    expect(report.featureFlagReadiness).toBe("SAFE_TO_ENABLE");
    expect(report.symbols.every((item) => item.status === "PASS")).toBe(true);
    expect(report.symbols.map((item) => item.symbol)).toEqual([
      "AAPL", "NVDA", "MSFT", "COST",
    ]);
  });
});