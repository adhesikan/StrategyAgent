import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical institutional runtime convergence architecture", () => {
  it("keeps the active Stock View UI off legacy ticker-only endpoints", () => {
    const source = readFileSync(
      new URL("../../../../client/src/pages/institutional-intelligence.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("`/api/institutional/${symbol}");
    expect(source).not.toContain("/api/institutional/signals/");
    expect(source).toContain("/api/institutional/v1/stocks/");
  });

  it("resolves runtime identity only through the canonical context", () => {
    const source = readFileSync(
      new URL("../analytics/stock-analytics-repository.ts", import.meta.url),
      "utf8",
    );
    const identityBlock = source.slice(
      source.indexOf("export async function loadStockCandidateIdentity"),
      source.indexOf("export async function loadStockCandidateCusips"),
    );
    expect(identityBlock).toContain("resolveCanonicalInstitutionalSecurityContext");
    expect(identityBlock).not.toMatch(/mappedSymbol|masterTicker|holdingMappedSymbol/);
  });

  it("binds batched holdings to canonical CUSIPs and effective holdings", () => {
    const source = readFileSync(
      new URL("../canonical-runtime-loaders.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("canonicalStockIdentityCte");
    expect(source).toContain("canonical_effective_holdings");
    expect(source).toContain("holdings.cusip = canonical.cusip");
    expect(source).not.toContain("mapped_symbol");
  });
});