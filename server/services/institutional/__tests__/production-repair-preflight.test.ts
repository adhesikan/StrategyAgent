import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  loadInstitutionalRepairPreflight,
  VERIFIED_REPAIR_MAPPINGS,
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

  it("fails closed when an effective aggregate-eligible target group is unresolved", async () => {
    const fixture = executorFixture({ "037833100": 1 });
    const preflight = await loadInstitutionalRepairPreflight(fixture.executor);
    expect(preflight.blockingIssues).toContain(
      "SOURCE_IDENTITY_UNRESOLVED_IN_REPAIR_SCOPE:AAPL",
    );
  });
});