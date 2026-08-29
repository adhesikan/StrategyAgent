import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  securityMasterThemes,
  securityThemes,
  symbols,
} from "@shared/schema";
import {
  buildEnrichedInstitutionalHolding,
  computeInstitutionalMappingCoverage,
  resolveReliableSecurityMapping,
} from "../analytics/security-enrichment";
import type {
  InstitutionalSecurityMetadata,
  InstitutionalThemeMembership,
} from "../analytics/types";
import { buildCuratedSecurityThemeMemberships } from "../security-theme-mapping";
import { readFileSync } from "node:fs";

const baseHolding = {
  holdingId: "holding-1",
  accessionNumber: "accession-1",
  filerCik: "0001",
  filerName: "Example Fund",
  issuerName: "Example Issuer",
  cusip: "123456789",
  periodOfReport: "2026-03-31",
  reportedValueDollars: 1_000_000,
  reportedShares: 10_000,
  securityPositionType: "COMMON_EQUITY",
  putCall: null,
};

const metadata: InstitutionalSecurityMetadata = {
  symbol: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  subIndustry: "Semiconductor Designers",
  marketCap: 4_000_000_000_000,
  exchange: "NASDAQ",
  country: "United States",
  assetType: "common_stock",
};

const theme: InstitutionalThemeMembership = {
  themeId: "ai-infrastructure",
  themeName: "AI Infrastructure",
  description: "AI infrastructure providers",
  classificationMethod: "curated",
};

describe("institutional security enrichment", () => {
  it("gives a human-reviewed security master mapping priority", () => {
    expect(resolveReliableSecurityMapping([
      { source: "security_master", symbol: "NVDA", status: "reviewed" },
      { source: "institutional_mapping", symbol: "OTHER", status: "exact" },
      { source: "holding", symbol: "OTHER", status: "exact" },
    ])).toEqual({
      status: "reliably_mapped",
      symbol: "NVDA",
      reason: null,
    });
  });

  it("treats conflicting exact mappings as ambiguous", () => {
    expect(resolveReliableSecurityMapping([
      { source: "security_master", symbol: "NVDA", status: "probable" },
      { source: "institutional_mapping", symbol: "NVDA", status: "exact" },
      { source: "holding", symbol: "AMD", status: "reviewed" },
    ])).toEqual({
      status: "ambiguous",
      symbol: null,
      reason: "ambiguous",
    });
  });

  it("does not promote probable or name-based mappings into analytics", () => {
    expect(resolveReliableSecurityMapping([
      { source: "security_master", symbol: "NVDA", status: "probable" },
      { source: "institutional_mapping", symbol: "NVDA", status: "probable" },
      { source: "holding", symbol: null, status: "unmapped" },
    ])).toEqual({
      status: "unmapped",
      symbol: null,
      reason: "unmapped",
    });
  });

  it("counts an explicitly ambiguous source as ambiguous", () => {
    expect(resolveReliableSecurityMapping([
      { source: "security_master", symbol: null, status: "needs_review" },
      { source: "institutional_mapping", symbol: null, status: "ambiguous" },
      { source: "holding", symbol: null, status: "ambiguous" },
    ])).toEqual({
      status: "ambiguous",
      symbol: null,
      reason: "ambiguous",
    });
  });

  it("preserves unresolved holdings but strips symbol metadata and themes", () => {
    const result = buildEnrichedInstitutionalHolding(
      baseHolding,
      { status: "ambiguous", symbol: null, reason: "ambiguous" },
      metadata,
      [theme],
    );
    expect(result.classificationStatus).toBe("unclassified");
    expect(result.unclassifiedReason).toBe("ambiguous");
    expect(result.metadata).toBeNull();
    expect(result.themes).toEqual([]);
    expect(result.reportedValueDollars).toBe(1_000_000);
  });

  it("reports mapping and classification coverage separately", () => {
    const mapped = buildEnrichedInstitutionalHolding(
      baseHolding,
      { status: "reliably_mapped", symbol: "NVDA", reason: null },
      metadata,
      [theme],
    );
    const unmapped = buildEnrichedInstitutionalHolding(
      { ...baseHolding, holdingId: "holding-2", cusip: "000000000" },
      { status: "unmapped", symbol: null, reason: "unmapped" },
      null,
      [],
    );
    const ambiguous = buildEnrichedInstitutionalHolding(
      { ...baseHolding, holdingId: "holding-3", cusip: "999999999" },
      { status: "ambiguous", symbol: null, reason: "ambiguous" },
      null,
      [],
    );

    expect(computeInstitutionalMappingCoverage([mapped, unmapped, ambiguous]))
      .toEqual({
        totalHoldingCount: 3,
        reliablyMappedHoldingCount: 1,
        unmappedHoldingCount: 1,
        ambiguousHoldingCount: 1,
        unclassifiedHoldingCount: 2,
        symbolCoveragePercent: 33.33,
        sectorEnrichedHoldingCount: 1,
        industryEnrichedHoldingCount: 1,
        themeEnrichedHoldingCount: 1,
        sectorCoveragePercent: 33.33,
        industryCoveragePercent: 33.33,
        themeCoveragePercent: 33.33,
      });
  });

  it("keeps a trusted symbol but marks missing canonical metadata unclassified", () => {
    const result = buildEnrichedInstitutionalHolding(
      baseHolding,
      { status: "reliably_mapped", symbol: "NVDA", reason: null },
      { ...metadata, sector: null, industry: null },
      [],
      "partial",
    );
    expect(result.mappingResolution).toBe("reliably_mapped");
    expect(result.metadataResolution).toBe("partial");
    expect(result.classificationStatus).toBe("unclassified");
    expect(result.unclassifiedReason).toBe("metadata_unavailable");
  });

  it("supports zero-to-many curated themes without analytics hardcoding", () => {
    expect(buildCuratedSecurityThemeMemberships(
      [{ id: "security-1", ticker: "NVDA" }, { id: "security-2", ticker: "NONE" }],
      [
        { themeId: "theme-a", symbols: ["NVDA"] },
        { themeId: "theme-b", symbols: ["NVDA", "AMD"] },
      ],
    )).toEqual([
      {
        securityMasterId: "security-1",
        themeId: "theme-a",
        classificationMethod: "curated",
        source: "theme-registry",
      },
      {
        securityMasterId: "security-1",
        themeId: "theme-b",
        classificationMethod: "curated",
        source: "theme-registry",
      },
    ]);
  });

  it("uses existing symbols metadata plus normalized theme tables", () => {
    expect(getTableName(symbols)).toBe("symbols");
    expect(symbols.subIndustry.name).toBe("sub_industry");
    expect(symbols.country.name).toBe("country");
    expect(getTableName(securityThemes)).toBe("security_themes");
    expect(getTableName(securityMasterThemes)).toBe("security_master_themes");
  });

  it("wires enrichment migration and theme sync into runtime startup", () => {
    const startupSource = readFileSync("server/index.ts", "utf8");
    const migrationSource = readFileSync(
      "migrations/030_institutional_security_enrichment.sql",
      "utf8",
    );
    expect(startupSource).toContain("ensureInstitutionalSecurityEnrichmentSchema()");
    expect(startupSource).toContain("syncSecurityThemesFromRegistry()");
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS security_themes");
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS security_master_themes");
    expect(migrationSource).toContain("REFERENCES security_master(id)");
  });
});