import { describe, expect, it, vi } from "vitest";
import {
  enrichInstitutionalSecurityReferencesForIngestion,
  type InstitutionalReferenceEnrichmentDependencies,
} from "../ingestion-service";
import type { InstitutionalSecurityReferenceStore } from "../security-reference-repository";
import type { SecurityReferenceResolution } from "../security-reference-enrichment";

const enabledConfig = {
  enabled: false,
  ingestionEnabled: true,
  secUserAgent: "test@example.test",
  backfillQuarters: 8,
  institutionalSecurityReferenceEnabled: true,
  institutionalSecurityReferenceMaxCusips: 1,
};

function store(cusips = ["000000001", "000000002"]): InstitutionalSecurityReferenceStore & {
  promoted: number;
  providerOutcomes: string[];
} {
  const memory: InstitutionalSecurityReferenceStore & { promoted: number; providerOutcomes: string[] } = {
    promoted: 0,
    providerOutcomes: [],
    loadEligibleCusips: vi.fn(async () => cusips),
    getTrustedLocalEvidence: async () => [],
    saveLookup: async ({ resolution }) => { memory.providerOutcomes.push(resolution.outcome); },
    saveCandidates: async () => undefined,
    markMissingCandidatesNonCurrent: async () => undefined,
    promoteExact: async () => { memory.promoted++; },
  };
  return memory;
}

const exact = (cusip: string): SecurityReferenceResolution => ({
  cusip,
  outcome: "AUTHORITATIVELY_RESOLVABLE",
  symbol: "FUTR",
  candidates: [{
    provider: "openfigi",
    ticker: "FUTR",
    figi: "BBG000FUTR",
    securityType: "Common Stock",
    marketSector: "Equity",
  }],
  evidence: [],
  fingerprint: "safe-test-fingerprint",
});

describe("future institutional reference ingestion", () => {
  it("does nothing when the opt-in enrichment flag is disabled", async () => {
    const createRepository = vi.fn();
    const createProvider = vi.fn();
    const result = await enrichInstitutionalSecurityReferencesForIngestion(
      ["2026-06-30"],
      {
        getConfig: () => ({ ...enabledConfig, institutionalSecurityReferenceEnabled: false }),
        createRepository,
        createProvider,
      } as Partial<InstitutionalReferenceEnrichmentDependencies>,
    );
    expect(result).toEqual({ enabled: false, requested: 0, processed: 0, promoted: 0 });
    expect(createRepository).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("uses the current and prior periods and honors the bounded request budget", async () => {
    const memory = store();
    const resolveCusips = vi.fn(async (cusips: readonly string[]) => cusips.map(exact));
    await expect(enrichInstitutionalSecurityReferencesForIngestion(
      ["2026-06-30", "2026-03-31"],
      {
        getConfig: () => enabledConfig,
        createRepository: () => memory,
        createProvider: () => ({ resolveCusips }),
      },
    )).resolves.toMatchObject({ enabled: true, requested: 1, processed: 1, promoted: 1 });
    expect(memory.loadEligibleCusips).toHaveBeenCalledWith(["2026-06-30", "2026-03-31"]);
    expect(resolveCusips).toHaveBeenCalledWith(["000000001"]);
    expect(memory.promoted).toBe(1);
  });

  it("records provider failures as unresolved outcomes and continues", async () => {
    const memory = store(["000000001"]);
    await expect(enrichInstitutionalSecurityReferencesForIngestion(
      ["2026-06-30"],
      {
        getConfig: () => enabledConfig,
        createRepository: () => memory,
        createProvider: () => ({
          resolveCusips: async () => { throw new Error("provider unavailable"); },
        }),
      },
    )).resolves.toMatchObject({ enabled: true, requested: 1, processed: 1, promoted: 0 });
    expect(memory.providerOutcomes).toEqual(["PROVIDER_FAILED"]);
    expect(memory.promoted).toBe(0);
  });
});