import { describe, expect, it } from "vitest";
import {
  canonicalSecurityTypeStateQuery,
  parseCanonicalStockEligibleIdentities,
  reconcileCanonicalStockEligibility,
} from "../canonical-security-state";

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
});