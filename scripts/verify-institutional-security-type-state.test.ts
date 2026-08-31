import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ db: {}, pool: { end: vi.fn() } }));

import {
  normalizeSecurityTypeStateReport,
  securityTypeStateQuery,
} from "./verify-institutional-security-type-state";

describe("security type state verification CLI", () => {
  it("normalizes aggregate-only canonical state counts", () => {
    expect(normalizeSecurityTypeStateReport({
      trusted_cusips: "3206",
      asset_type_populated: "3202",
      asset_type_missing: "4",
      stock_eligible_cusips: "2800",
      separate_fund_cusips: "200",
      unsupported_or_insufficient_cusips: "206",
    })).toEqual({
      trustedCusips: 3206,
      assetTypePopulated: 3202,
      assetTypeMissing: 4,
      stockEligibleCusips: 2800,
      separateFundCusips: 200,
      unsupportedOrInsufficientCusips: 206,
    });
  });

  it("is an aggregate-only read query with the Task 196 eligibility filters", () => {
    expect(securityTypeStateQuery).toContain("FROM security_master");
    expect(securityTypeStateQuery).toContain("h.put_call IS NULL");
    expect(securityTypeStateQuery).toContain("h.reported_shares > 0");
    expect(securityTypeStateQuery).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|DROP|ALTER|TRUNCATE)\b/i);
    expect(securityTypeStateQuery).not.toMatch(/SELECT\s+\*/i);
    expect(securityTypeStateQuery.trim()).toMatch(/COUNT\(\*\)[\s\S]+FROM canonical$/);
  });
});