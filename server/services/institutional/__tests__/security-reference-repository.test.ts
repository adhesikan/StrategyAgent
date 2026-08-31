import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assetTypeForOpenFigiCandidate, orchestrateSecurityReferenceLookups,
  persistSecurityReferenceResolution, type InstitutionalSecurityReferenceStore,
} from "../security-reference-repository";
import type { SecurityReferenceResolution } from "../security-reference-enrichment";

const candidate = { provider: "openfigi", ticker: "ACME", figi: "BBG000ACME", securityType: "Common Stock", marketSector: "Equity" };
function store(reviewStatus = "unmapped"): InstitutionalSecurityReferenceStore & { deactivated: number; promoted: number; lookupOutcome: string | null; providerOutcome: string | null; effectiveSymbol: string | null; writes: number } {
  const memory: InstitutionalSecurityReferenceStore & { deactivated: number; promoted: number; lookupOutcome: string | null; providerOutcome: string | null; effectiveSymbol: string | null; writes: number } = {
    deactivated: 0, promoted: 0, lookupOutcome: null, providerOutcome: null, effectiveSymbol: null, writes: 0,
    loadEligibleCusips: async () => ["000000001"],
    getTrustedLocalEvidence: async (cusip) => reviewStatus === "unmapped" ? [] : [{
      source: "security_master", symbol: reviewStatus === "reviewed" ? "KEEP" : null,
      status: reviewStatus, figi: null, cusip,
    }],
    saveLookup: async (input) => { memory.writes++; memory.lookupOutcome = input.effectiveOutcome; memory.providerOutcome = input.resolution.outcome; memory.effectiveSymbol = input.effectiveSymbol; }, saveCandidates: async () => { memory.writes++; },
    markMissingCandidatesNonCurrent: async () => { memory.writes++; memory.deactivated++; },
    promoteExact: async () => { memory.promoted++; },
  };
  return memory;
}
const resolution = (): SecurityReferenceResolution => ({
  cusip: "000000001", outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "ACME",
  candidates: [candidate], evidence: [], fingerprint: "sr-test",
});

describe("security reference repository", () => {
  it("promotes only an exact supported OpenFIGI candidate", async () => {
    const memory = store();
    const result = await persistSecurityReferenceResolution(memory, resolution());
    expect(result).toMatchObject({ symbol: "ACME", promoted: true });
    expect(memory.promoted).toBe(1);
    expect(assetTypeForOpenFigiCandidate(candidate)).toBe("common_stock");
  });

  it("preserves non-stock reference identity classifications for separate analytics", () => {
    expect(assetTypeForOpenFigiCandidate({
      ...candidate,
      securityType: "ETF",
    })).toBe("etf");
    expect(assetTypeForOpenFigiCandidate({
      ...candidate,
      securityType: "Closed-End Fund",
    })).toBe("closed_end_fund");
    expect(assetTypeForOpenFigiCandidate({
      ...candidate,
      securityType: "ADR",
    })).toBe("adr");
  });

  it("does not guess a stock type when provider classification is absent", () => {
    expect(assetTypeForOpenFigiCandidate({
      ...candidate,
      securityType: undefined,
      securityType2: undefined,
      marketSector: undefined,
    })).toBe("insufficient_evidence");
  });

  it("keeps reviewed evidence ahead of automation and bounds orchestration", async () => {
    const memory = store("reviewed");
    const result = await orchestrateSecurityReferenceLookups(memory, {
      resolveCusips: async () => [resolution(), resolution()],
    }, ["000000001", "000000001", "000000002"], 1);
    expect(result).toMatchObject({ requested: 1, processed: 1, promoted: 0 });
    expect(result.results[0].symbol).toBe("KEEP");
  });

  it("promotes same-symbol multiple candidates but rejects conflicting exact symbols", async () => {
    const memory = store();
    const same = resolution();
    same.candidates = [candidate, { ...candidate, compositeFigi: "BBGCOMP", figi: undefined }];
    expect((await persistSecurityReferenceResolution(memory, same)).promoted).toBe(true);
    const conflict = resolution();
    conflict.candidates = [candidate, { ...candidate, ticker: "OTHER", figi: "BBGOTHER" }];
    expect(await persistSecurityReferenceResolution(store(), conflict)).toMatchObject({ promoted: false, symbol: null });
  });

  it("does not retire candidates for transient or invalid provider outcomes", async () => {
    const memory = store();
    const transient = { ...resolution(), outcome: "RATE_LIMITED" as const, candidates: [] };
    await persistSecurityReferenceResolution(memory, transient);
    expect(memory.deactivated).toBe(0);
    const unsupported = { ...resolution(), outcome: "UNSUPPORTED" as const, candidates: [] };
    await persistSecurityReferenceResolution(memory, unsupported);
    expect(memory.deactivated).toBe(0);
    await persistSecurityReferenceResolution(memory, resolution());
    expect(memory.deactivated).toBe(1);
  });

  it("persists a reviewed effective result separately from provider outcome", async () => {
    const memory = store("reviewed");
    const missing = { ...resolution(), outcome: "PARTIAL_RESPONSE" as const, candidates: [] };
    expect(await persistSecurityReferenceResolution(memory, missing)).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "KEEP" });
    expect(memory).toMatchObject({ providerOutcome: "PARTIAL_RESPONSE", lookupOutcome: "AUTHORITATIVELY_RESOLVABLE", effectiveSymbol: "KEEP" });
  });

  it("persists rejected local ownership as unsupported without promotion", async () => {
    const memory = store("rejected");
    expect(await persistSecurityReferenceResolution(memory, resolution())).toMatchObject({ outcome: "UNSUPPORTED", symbol: null, promoted: false });
    expect(memory).toMatchObject({ writes: 0, promoted: 0 });
  });

  it("excludes reviewed and rejected security-master rows before provider lookup", () => {
    const source = readFileSync(
      "server/services/institutional/security-reference-repository.ts",
      "utf8",
    );
    expect(source).toContain(
      "securityMaster.reviewStatus} NOT IN ('reviewed', 'rejected')",
    );
  });

  it("allows separate CUSIPs to promote to one symbol and delegates idempotency to the store", async () => {
    const memory = store();
    const persisted = new Set<string>();
    memory.promoteExact = async ({ cusip, ticker }) => { persisted.add(`${cusip}:${ticker}`); memory.promoted = persisted.size; };
    const second = { ...resolution(), cusip: "000000002" };
    await persistSecurityReferenceResolution(memory, resolution());
    await persistSecurityReferenceResolution(memory, resolution());
    await persistSecurityReferenceResolution(memory, second);
    expect(persisted).toEqual(new Set(["000000001:ACME", "000000002:ACME"]));
    expect(memory.promoted).toBe(2);
  });
});