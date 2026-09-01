import { describe, expect, it } from "vitest";
import {
  canonicalStockIdentityForSymbolQuery,
  canonicalSecurityTypeStateQuery,
  parseCanonicalStockEligibleIdentities,
  reconcileCanonicalStockEligibility,
} from "../canonical-security-state";
import { CANONICAL_EFFECTIVE_HOLDINGS_CTE } from "../institutional-effective-holdings";
import { pool } from "../../../db";

describe("canonical security state", () => {
  it("reconciles verifier and analyzer stock populations", () => {
    expect(reconcileCanonicalStockEligibility(1475, 1475)).toMatchObject({
      difference: 0,
      reconciled: true,
    });
    expect(reconcileCanonicalStockEligibility(1475, 1474)).toMatchObject({
      difference: -1,
      reconciled: false,
    });
  });

  it("uses the same effective holding scope and canonical type source", () => {
    expect(canonicalSecurityTypeStateQuery).toContain("f.is_effective = TRUE");
    expect(canonicalSecurityTypeStateQuery).toContain("h.put_call IS NULL");
    expect(canonicalSecurityTypeStateQuery).toContain("COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'");
    expect(canonicalSecurityTypeStateQuery).toContain("h.reported_shares > 0");
    expect(canonicalSecurityTypeStateQuery).toContain("FROM security_master");
    expect(canonicalSecurityTypeStateQuery).toContain("asset_type IN ('common_stock', 'reit')");
    expect(canonicalSecurityTypeStateQuery).toContain("'other_pooled_fund'");
    expect(canonicalSecurityTypeStateQuery).toContain("stock_eligible_identities");
    expect(canonicalSecurityTypeStateQuery).toContain("candidate.share_class_figi");
    expect(canonicalStockIdentityForSymbolQuery).not.toContain("target_cusips");
    expect(canonicalStockIdentityForSymbolQuery).toContain(
      "FROM canonical\nWHERE symbol = $1",
    );
  });

  it("centralizes amendment, manager-quarter, and holding eligibility semantics", () => {
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain(
      "PARTITION BY f.filer_cik, f.period_of_report",
    );
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("f.accepted_at DESC NULLS LAST");
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("f.filing_date DESC");
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("f.accession_number DESC");
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("f.is_effective = TRUE");
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("h.put_call IS NULL");
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain(
      "COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'",
    );
    expect(CANONICAL_EFFECTIVE_HOLDINGS_CTE).toContain("h.reported_shares > 0");
  });

  it("returns a deterministic canonical CUSIP to symbol identity map", () => {
    expect(Array.from(parseCanonicalStockEligibleIdentities({
      "222222222": " reit ",
      "111111111": "abc",
    }))).toEqual([
      ["111111111", "ABC"],
      ["222222222", "REIT"],
    ]);
  });

  it("executes the symbol-scoped canonical identity query against PostgreSQL", async () => {
    const result = await pool.query(canonicalStockIdentityForSymbolQuery, ["AAPL"]);
    expect(result.rows).toEqual(expect.any(Array));
    const state = await pool.query(canonicalSecurityTypeStateQuery);
    expect(state.rows).toEqual(expect.any(Array));
  });
});