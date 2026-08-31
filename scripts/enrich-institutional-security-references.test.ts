import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ db: {} }));

import { buildInstitutionalSecurityReferencePlan } from "../server/services/institutional/security-reference-enrichment-planner";
import { candidateHistoryQuery, evidenceQuery, executeReferenceEnrichment, lookupStateQuery, parseReferenceEnrichmentArgs, populationQuery } from "./enrich-institutional-security-references";

describe("reference enrichment CLI arguments", () => {
  it("rejects unsafe or malformed invocation forms", () => {
    expect(() => parseReferenceEnrichmentArgs(["--apply"])).toThrow("APPLY_MAX_CUSIPS_REQUIRED");
    expect(() => parseReferenceEnrichmentArgs(["--wat"])).toThrow("UNKNOWN_FLAG");
    expect(() => parseReferenceEnrichmentArgs(["--max-cusips"])).toThrow("MISSING_VALUE");
    expect(() => parseReferenceEnrichmentArgs(["--max-cusips", "-1"])).toThrow("INVALID_MAX_CUSIPS");
    expect(() => parseReferenceEnrichmentArgs(["--cursor", "not-a-cusip-too-long"])).toThrow("INVALID_CUSIP_CURSOR");
    expect(() => parseReferenceEnrichmentArgs(["--cursor"])).toThrow("MISSING_VALUE");
    expect(() => parseReferenceEnrichmentArgs(["--cursor", "037833100", "--cursor", "594918104"])).toThrow("DUPLICATE_CURSOR");
    expect(() => parseReferenceEnrichmentArgs(["--max-cusips", "1e2"])).toThrow("INVALID_MAX_CUSIPS");
    expect(() => parseReferenceEnrichmentArgs(["--apply", "--cursor", "037833100", "--max-cusips", "1", "--plan-hash", "hash"])).toThrow("APPLY_CURSOR_UNSUPPORTED");
  });
  it("normalizes a strict exclusive cursor with the bounded chunk size", () => {
    expect(parseReferenceEnrichmentArgs(["--dry-run", "--cursor", "037833100", "--max-cusips", "1"]))
      .toEqual({ apply: false, dryRun: true, cursor: "037833100", maxCusips: 1, refreshTerminal: false });
  });
  it("requires an explicit terminal refresh flag and rejects duplicate use", () => {
    expect(parseReferenceEnrichmentArgs(["--dry-run", "--refresh-terminal"]))
      .toMatchObject({ refreshTerminal: true });
    expect(() => parseReferenceEnrichmentArgs(["--refresh-terminal", "--refresh-terminal"]))
      .toThrow("DUPLICATE_REFRESH_TERMINAL");
  });
  it("performs zero persistence calls for injected dry-run orchestration", async () => {
    const plan = buildInstitutionalSecurityReferencePlan({
      population: [{ cusip: "037833100", holdingRows: 1, reportedValueUsd: "1" }],
      trustedState: [], providerResolutions: [], plannedLookupCusips: ["037833100"], maxCusips: 1,
    });
    const persistResolution = vi.fn();
    const result = await executeReferenceEnrichment({
      args: { apply: false, dryRun: true, maxCusips: 1 },
      loadPlan: async () => ({ plan, runtime: { authMode: "UNAUTHENTICATED", batchSize: 10, concurrency: 1, requestLimit: 25, windowMs: 60_000, minimumIntervalMs: 2_400 } }),
      persistResolution,
    });
    expect(persistResolution).not.toHaveBeenCalled();
    expect(result).toMatchObject({ runtime: { authMode: "UNAUTHENTICATED", batchSize: 10 }, chunk: { nextCursor: "037833100", requested: 1 } });
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
  it("loads persisted provider outcomes and current candidate history read-only", () => {
    expect(lookupStateQuery).toContain("institutional_security_lookup_states");
    expect(lookupStateQuery).toContain("institutional_security_candidate_observations");
    expect(lookupStateQuery).toContain("s.provider='openfigi'");
    expect(lookupStateQuery).toContain("current_candidate_count");
    expect(candidateHistoryQuery).toContain("is_current=TRUE");
  });
});