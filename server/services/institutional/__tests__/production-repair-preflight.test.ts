import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  applyInstitutionalMappingRepair,
  loadInstitutionalRepairPreflight,
  VERIFIED_REPAIR_MAPPINGS,
  type RepairSourceIdentityDiagnostic,
} from "../production-repair";

function traceRows(unresolvedByCusip: Record<string, number> = {}) {
  return VERIFIED_REPAIR_MAPPINGS.map((mapping) => ({
    cusip: mapping.cusip,
    issuer_names: [mapping.issuerName],
    effective_holding_rows: 10,
    mapped_holding_rows: mapping.symbol === "MSFT" ? 10 : 0,
    conflicting_holding_rows: 0,
    reference_symbol: mapping.symbol === "MSFT" ? "MSFT" : null,
    reference_status: mapping.symbol === "MSFT" ? "reviewed" : null,
    source_identity_unresolved_eligible_groups: unresolvedByCusip[mapping.cusip] ?? 0,
  }));
}

function executorFixture(unresolvedByCusip: Record<string, number> = {}) {
  const queryTexts: string[] = [];
  const results = [
    [{ database: "railway", user: "app", schema: "public" }],
    [{ ready: true }],
    traceRows(unresolvedByCusip),
    [{
      current_key_groups: 60_413,
      materially_distinct_groups: 60_365,
      source_identity_unresolved_groups: 48,
      affected_filings: 1_000,
      affected_cusips: 5_000,
    }],
    [{ count: 0 }],
    [{ mapping_status: "reviewed", count: 1 }],
    [{
      total_filings: 1_394,
      effective_filings: 1_391,
      total_holdings: 562_552,
      effective_holdings: 562_176,
      effective_managers: 970,
      effective_quarters: 41,
      latest_effective_quarter: "2026-06-30",
      mapped_effective_holdings: 0,
      aggregate_rows: 0,
    }],
    [{
      effective_holdings: 562_176,
      reliable_mapping_candidates: 4,
      reliable_mapping_digest: "mapping-digest",
      already_mapped_effective_holdings: 10,
      holdings_to_update: 3_918,
      remaining_unmapped_effective_holdings: 558_248,
      conflicting_mapped_holdings: 0,
      aggregate_symbols: 4,
      aggregate_quarters: 141,
      aggregate_rows_to_insert: 141,
      aggregate_rows_to_update: 0,
      signal_rows_to_insert: 4,
      signal_rows_to_update: 0,
      target_holding_digest: "holding-digest",
    }],
  ];
  let index = 0;
  return {
    queryTexts,
    executor: {
      async execute(query: unknown) {
        queryTexts.push(new PgDialect().sqlToQuery(query as any).sql.toLowerCase());
        return results[index++] ?? [];
      },
    },
  };
}

const productionUnresolvedByCusip = {
  "037833100": 6,
  "67066G104": 13,
  "594918104": 11,
  "22160K105": 0,
};

function sourceDiagnostic(
  classification:
    | "SOURCE_ROWS_CONFIRM_MULTIPLE"
    | "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED"
    | "SOURCE_MATCH_AMBIGUOUS"
    | "SOURCE_UNAVAILABLE" = "SOURCE_ROWS_CONFIRM_MULTIPLE",
  options: { firstPhysicalRows?: number } = {},
): RepairSourceIdentityDiagnostic {
  const findings = VERIFIED_REPAIR_MAPPINGS.flatMap((mapping) =>
    Array.from(
      { length: productionUnresolvedByCusip[mapping.cusip] },
      (_, index) => {
        const findingClassification = mapping.symbol === "AAPL" && index === 0
          ? classification
          : "SOURCE_ROWS_CONFIRM_MULTIPLE";
        const physicalRows = mapping.symbol === "AAPL" && index === 0
          ? options.firstPhysicalRows ?? 2
          : 2;
        return {
          symbol: mapping.symbol,
          cusip: mapping.cusip,
          accessionNumber: `${mapping.cusip}${String(index).padStart(4, "0")}`,
          periodOfReport: "2026-06-30",
          classTitle: "COM",
          physicalRows,
          sourceMatchCount: findingClassification === "SOURCE_UNAVAILABLE"
            ? null
            : findingClassification === "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED"
              ? 1
              : physicalRows,
          classification: findingClassification,
          sourceError: findingClassification === "SOURCE_UNAVAILABLE"
            ? "SOURCE_DOCUMENT_UNAVAILABLE"
            : null,
          sourceRows: [],
          sourceDocument: null,
        };
      },
    )
  );
  return {
    findings,
    sourceDocuments: [],
    symbolStatus: {},
    conditionalAggregateImpact: {},
    summary: {},
  } as RepairSourceIdentityDiagnostic;
}

describe("institutional production repair preflight SQL boundary", () => {
  it("keeps global findings as warnings and permits clean four-symbol target scope", async () => {
    const fixture = executorFixture();
    const preflight = await loadInstitutionalRepairPreflight(fixture.executor);

    expect(preflight.duplicateHoldingGroups).toBe(60_413);
    expect(preflight.duplicateClassification).toMatchObject({
      materiallyDistinctGroups: 60_365,
      sourceIdentityUnresolvedGroups: 48,
      exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
      rootCause: "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
    });
    expect(preflight.dataQualityWarnings).toEqual([
      "DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED",
      "MATERIALLY_DISTINCT_LEGACY_KEY_GROUPS:60365",
      "SOURCE_IDENTITY_UNRESOLVED_GLOBAL:48",
    ]);
    expect(preflight.blockingIssues).not.toContain("DUPLICATE_HOLDING_GROUPS_PRESENT");
    expect(preflight.blockingIssues).not.toEqual(expect.arrayContaining([
      expect.stringContaining("SOURCE_IDENTITY_UNRESOLVED_IN_REPAIR_SCOPE"),
    ]));

    const targetSql = fixture.queryTexts[2];
    expect(targetSql).toContain("f.is_effective = true");
    expect(targetSql).toContain("h.put_call is null");
    expect(targetSql).toContain("h.shares_prn_type is distinct from 'prn'");
    expect(targetSql).toContain("h.reported_shares > 0");
    expect(targetSql).toContain("h.investment_discretion");
    expect(targetSql).toContain("h.other_manager");
    expect(targetSql).toContain("h.voting_sole");
    expect(targetSql).toContain("h.reported_value");

    const allSql = fixture.queryTexts.join("\n");
    expect(allSql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/);
  });

  it("fails closed when source evidence for an eligible target group is unavailable", async () => {
    const fixture = executorFixture({ "037833100": 1 });
    const preflight = await loadInstitutionalRepairPreflight(fixture.executor);
    expect(preflight.provenance).toMatchObject({
      status: "unavailable",
      unresolvedEligibleGroups: 1,
      blockingGroups: 1,
    });
    expect(preflight.blockingIssues).toContain("SOURCE_UNAVAILABLE:AAPL");
  });

  it("allows all 30 source-confirmed multiple groups without changing stored rows", async () => {
    const fixture = executorFixture(productionUnresolvedByCusip);
    const preflight = await loadInstitutionalRepairPreflight(fixture.executor, {
      reconcileSourceIdentity: async () => sourceDiagnostic(),
    });

    expect(preflight.provenance).toMatchObject({
      status: "reconciled",
      unresolvedEligibleGroups: 30,
      reconciledGroups: 30,
      blockingGroups: 0,
      classificationCounts: {
        SOURCE_ROWS_CONFIRM_MULTIPLE: 30,
        INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED: 0,
        SOURCE_MATCH_AMBIGUOUS: 0,
        SOURCE_UNAVAILABLE: 0,
      },
    });
    expect(preflight.blockingIssues).not.toEqual(expect.arrayContaining([
      expect.stringContaining("SOURCE_"),
      expect.stringContaining("DUPLICATION_CONFIRMED"),
    ]));
    expect(fixture.queryTexts.join("\n")).not.toMatch(
      /\b(insert|update|delete|truncate|alter|drop)\b/,
    );
  });

  it.each([
    "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED",
    "SOURCE_MATCH_AMBIGUOUS",
    "SOURCE_UNAVAILABLE",
  ] as const)("blocks the %s provenance outcome", async (classification) => {
    const fixture = executorFixture(productionUnresolvedByCusip);
    const preflight = await loadInstitutionalRepairPreflight(fixture.executor, {
      reconcileSourceIdentity: async () => sourceDiagnostic(classification),
    });

    expect(preflight.provenance?.blockingGroups).toBe(1);
    expect(preflight.blockingIssues).toContain(`${classification}:AAPL`);
  });

  it("changes the plan hash when source provenance changes", async () => {
    const firstFixture = executorFixture(productionUnresolvedByCusip);
    const secondFixture = executorFixture(productionUnresolvedByCusip);
    const first = await loadInstitutionalRepairPreflight(firstFixture.executor, {
      reconcileSourceIdentity: async () => sourceDiagnostic(
        "SOURCE_ROWS_CONFIRM_MULTIPLE",
        { firstPhysicalRows: 2 },
      ),
    });
    const second = await loadInstitutionalRepairPreflight(secondFixture.executor, {
      reconcileSourceIdentity: async () => sourceDiagnostic(
        "SOURCE_ROWS_CONFIRM_MULTIPLE",
        { firstPhysicalRows: 3 },
      ),
    });

    expect(first.provenance?.digest).not.toBe(second.provenance?.digest);
    expect(first.planHash).not.toBe(second.planHash);
  });

  it("revalidates provenance after the transaction lock and aborts drift before writes", async () => {
    const dryRunFixture = executorFixture(productionUnresolvedByCusip);
    const dryRun = await loadInstitutionalRepairPreflight(dryRunFixture.executor, {
      reconcileSourceIdentity: async () => sourceDiagnostic(
        "SOURCE_ROWS_CONFIRM_MULTIPLE",
        { firstPhysicalRows: 2 },
      ),
    });
    const applyFixture = executorFixture(productionUnresolvedByCusip);
    const transactionSql: string[] = [];
    let reconciliationCalled = false;
    const transactionExecutor = {
      async execute(query: unknown) {
        const text = new PgDialect().sqlToQuery(query as any).sql.toLowerCase();
        transactionSql.push(text);
        if (text.includes("set transaction isolation level repeatable read")) return [];
        if (text.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
        return applyFixture.executor.execute(query);
      },
    };

    await expect(applyInstitutionalMappingRepair(dryRun.planHash, {
      database: {
        async transaction(operation) {
          return operation(transactionExecutor);
        },
      },
      preflight: {
        reconcileSourceIdentity: async () => {
          reconciliationCalled = true;
          expect(transactionSql.some((text) => text.includes("pg_try_advisory_xact_lock"))).toBe(true);
          expect(transactionSql.join("\n")).not.toMatch(/\b(insert|update|delete)\b/);
          return sourceDiagnostic(
            "SOURCE_ROWS_CONFIRM_MULTIPLE",
            { firstPhysicalRows: 3 },
          );
        },
      },
    })).rejects.toThrow("INSTITUTIONAL_REPAIR_PLAN_DRIFT");

    expect(reconciliationCalled).toBe(true);
    expect(transactionSql[0]).toContain("set transaction isolation level repeatable read");
    expect(transactionSql[1]).toContain("pg_try_advisory_xact_lock");
    expect(transactionSql.join("\n")).not.toMatch(/\b(insert|update|delete)\b/);
  });
});
