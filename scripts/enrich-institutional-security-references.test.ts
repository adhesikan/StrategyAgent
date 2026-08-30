import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ db: {} }));

import { evidenceQuery, parseReferenceEnrichmentArgs, populationQuery } from "./enrich-institutional-security-references";

describe("reference enrichment CLI arguments", () => {
  it("rejects unsafe or malformed invocation forms", () => {
    expect(() => parseReferenceEnrichmentArgs(["--apply", "--dry-run", "--max-cusips", "1"])).toThrow("APPLY_AND_DRY_RUN");
    expect(() => parseReferenceEnrichmentArgs(["--wat"])).toThrow("UNKNOWN_FLAG");
    expect(() => parseReferenceEnrichmentArgs(["--max-cusips"])).toThrow("MISSING_VALUE");
    expect(() => parseReferenceEnrichmentArgs(["--max-cusips", "-1"])).toThrow("INVALID_MAX_CUSIPS");
    expect(() => parseReferenceEnrichmentArgs(["--apply", "--max-cusips", "0"])).toThrow("APPLY_MAX_CUSIPS_REQUIRED");
  });
  it("keeps the effective, positive-share, PRN eligibility contract", () => {
    expect(populationQuery).toContain("f.is_effective=TRUE");
    expect(populationQuery).toContain("COALESCE(UPPER(h.shares_prn_type),'SH') <> 'PRN'");
    expect(populationQuery).toContain("h.reported_shares>0");
  });
  it("has valid evidence select syntax and aggregates rejection blocks from both local tables", () => {
    expect(evidenceQuery).not.toMatch(/evidence\s*,\s*FROM/i);
    expect(evidenceQuery).toMatch(/blocked\s+FROM/i);
    expect(evidenceQuery).toContain("mapping_status");
    expect(evidenceQuery).toContain("review_status");
    expect(evidenceQuery).toContain("= 'rejected'");
  });
});