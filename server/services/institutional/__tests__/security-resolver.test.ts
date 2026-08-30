import { describe, expect, it } from "vitest";
import { resolveInstitutionalSecurity } from "../security-resolver";

describe("institutional security resolver", () => {
  it("resolves matching reviewed/exact evidence without fuzzy promotion", () => {
    expect(resolveInstitutionalSecurity([
      { source: "master", symbol: " nvda ", status: "reviewed", cusip: "67066G104" },
      { source: "holding", symbol: "NVDA", status: "exact", cusip: "67066G104" },
    ])).toMatchObject({ outcome: "RESOLVED_TRUSTED", symbol: "NVDA" });
  });

  it("keeps conflicting trusted symbols unresolved across multiple CUSIPs", () => {
    expect(resolveInstitutionalSecurity([
      { source: "mapping:111111111", symbol: "AAA", status: "reviewed", cusip: "111111111", figi: "BBG1" },
      { source: "mapping:222222222", symbol: "BBB", status: "exact", cusip: "222222222", figi: "BBG1" },
    ])).toMatchObject({ outcome: "CONFLICTING", symbol: null });
  });

  it("does not pair an exact status with a symbol from another source", () => {
    expect(resolveInstitutionalSecurity([
      { source: "one", symbol: "NVDA", status: "probable" },
      { source: "two", symbol: null, status: "exact" },
    ])).toMatchObject({ outcome: "UNSUPPORTED", symbol: null });
  });

  it("reports explicit ambiguity and absent evidence distinctly", () => {
    expect(resolveInstitutionalSecurity([
      { source: "mapping", symbol: null, status: "ambiguous" },
    ])).toMatchObject({ outcome: "AMBIGUOUS", symbol: null });
    expect(resolveInstitutionalSecurity([
      { source: "mapping", symbol: null, status: "unmapped" },
    ])).toMatchObject({ outcome: "INSUFFICIENT_EVIDENCE", symbol: null });
  });

  it("does not let trusted evidence override an explicit ambiguous record", () => {
    expect(resolveInstitutionalSecurity([
      { source: "holding", symbol: "NVDA", status: "exact" },
      { source: "mapping", symbol: null, status: "ambiguous" },
    ])).toMatchObject({ outcome: "AMBIGUOUS", symbol: null });
  });
});