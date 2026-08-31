import { describe, expect, it } from "vitest";
import {
  classifyInstitutionalSecurityType,
  isEligibleForStockInstitutionalAnalytics,
} from "../security-type-eligibility";

describe("institutional security type eligibility", () => {
  it.each([
    ["common stock", "common_stock"],
    ["REIT", "reit"],
  ])("admits %s to stock analytics", (securityType, canonicalType) => {
    const result = classifyInstitutionalSecurityType({ securityType });
    expect(result.canonicalType).toBe(canonicalType);
    expect(result.analyticsPopulation).toBe("ELIGIBLE_STOCK_ANALYTICS");
  });

  it.each([
    ["ETF", "etf"],
    ["Exchange Traded Product", "etf"],
    ["Mutual Fund", "mutual_fund"],
    ["Open-End Fund", "mutual_fund"],
    ["Closed-End Fund", "closed_end_fund"],
    ["Money Market Fund", "money_market_fund"],
  ])("keeps %s in separate fund analytics", (securityType, canonicalType) => {
    const result = classifyInstitutionalSecurityType({ securityType });
    expect(result.canonicalType).toBe(canonicalType);
    expect(result.analyticsPopulation).toBe(
      "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS",
    );
    expect(isEligibleForStockInstitutionalAnalytics({ securityType })).toBe(
      false,
    );
  });

  it.each([
    ["ADR", "adr"],
    ["foreign listing", "foreign_listing"],
    ["Preferred Stock", "preferred"],
    ["Corporate Bond", "debt"],
    ["Warrant", "warrant"],
    ["Rights", "rights"],
  ])("excludes %s from stock analytics", (securityType, canonicalType) => {
    const result = classifyInstitutionalSecurityType({ securityType });
    expect(result.canonicalType).toBe(canonicalType);
    expect(result.analyticsPopulation).toBe("UNSUPPORTED_FOR_STOCK_ANALYTICS");
  });

  it.each([
    { securityType: "Equity" },
    { securityType: "Common Stock", securityType2: "ADR" },
    { securityType: "Common Stock", marketSector: "Fixed Income" },
    { assetType: null },
    {},
  ])("fails closed for insufficient or contradictory evidence", (input) => {
    expect(
      classifyInstitutionalSecurityType(input).analyticsPopulation,
    ).toBe("INSUFFICIENT_SECURITY_TYPE_EVIDENCE");
    expect(isEligibleForStockInstitutionalAnalytics(input)).toBe(false);
  });

  it("uses the persisted canonical asset type as the authoritative value", () => {
    expect(
      classifyInstitutionalSecurityType({
        assetType: "common_stock",
        securityType: "ETF",
      }),
    ).toMatchObject({
      canonicalType: "common_stock",
      analyticsPopulation: "ELIGIBLE_STOCK_ANALYTICS",
    });
  });
});