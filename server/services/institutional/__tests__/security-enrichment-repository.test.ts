import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { selectMock, executeMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("../../../db", () => ({
  db: {
    select: selectMock,
    execute: executeMock,
  },
}));

import {
  getEnrichedInstitutionalHoldings,
  getInstitutionalMappingCoverage,
} from "../analytics/security-enrichment-repository";

function holdingQuery(rows: unknown[]) {
  return {
    from: () => ({
      leftJoin: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: () => ({
              offset: async () => rows,
            }),
          }),
        }),
      }),
    }),
  };
}

function symbolQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

function themeQuery(rows: unknown[]) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: async () => rows,
      }),
    }),
  };
}

describe("institutional enrichment PostgreSQL repository", () => {
  beforeEach(() => {
    selectMock.mockReset();
    executeMock.mockReset();
  });

  it("joins trusted holdings to canonical symbols and normalized themes", async () => {
    selectMock
      .mockReturnValueOnce(holdingQuery([
        {
          holding: {
            id: "holding-1",
            accessionNumber: "accession-1",
            filerCik: "0001",
            filerName: "Example Fund",
            issuerName: "NVIDIA CORP",
            classTitle: "COM",
            cusip: "67066G104",
            reportedValue: 1_000_000,
            reportedShares: 10_000,
            sharesPrnType: "SH",
            putCall: null,
            periodOfReport: "2026-03-31",
            mappedSymbol: "NVDA",
            mappingStatus: "exact",
          },
          master: {
            id: "security-1",
            ticker: "NVDA",
            issuerName: "NVIDIA Corporation",
            exchange: "NASDAQ",
            assetType: "common_stock",
            reviewStatus: "probable",
          },
          mapping: {
            mappedSymbol: "NVDA",
            mappingStatus: "exact",
          },
        },
        {
          holding: {
            id: "holding-2",
            accessionNumber: "accession-1",
            filerCik: "0001",
            filerName: "Example Fund",
            issuerName: "Unknown Issuer",
            classTitle: "COM",
            cusip: "000000000",
            reportedValue: 500_000,
            reportedShares: 5_000,
            sharesPrnType: "SH",
            putCall: null,
            periodOfReport: "2026-03-31",
            mappedSymbol: null,
            mappingStatus: "ambiguous",
          },
          master: null,
          mapping: {
            mappedSymbol: null,
            mappingStatus: "ambiguous",
          },
        },
      ]))
      .mockReturnValueOnce(symbolQuery([
        {
          ticker: "NVDA",
          name: "NVIDIA Corporation",
          exchange: "NASDAQ",
          sector: "Technology",
          industry: "Semiconductors",
          subIndustry: "Semiconductor Designers",
          marketCap: 4_000_000_000_000,
          country: "United States",
        },
      ]))
      .mockReturnValueOnce(themeQuery([
        {
          securityMasterId: "security-1",
          themeId: "ai-infrastructure",
          themeName: "AI Infrastructure",
          description: "AI infrastructure providers",
          classificationMethod: "curated",
        },
      ]));

    const rows = await getEnrichedInstitutionalHoldings({
      accessionNumber: "accession-1",
    });
    expect(rows[0]).toMatchObject({
      mappingResolution: "reliably_mapped",
      metadataResolution: "canonical",
      classificationStatus: "classified",
      metadata: {
        symbol: "NVDA",
        sector: "Technology",
        subIndustry: "Semiconductor Designers",
        country: "United States",
      },
      themes: [{ themeId: "ai-infrastructure" }],
    });
    expect(rows[1]).toMatchObject({
      mappingResolution: "ambiguous",
      metadataResolution: "unavailable",
      classificationStatus: "unclassified",
      metadata: null,
      themes: [],
    });
  });

  it("computes coverage in one deterministic SQL aggregation", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        total: 100,
        reliably_mapped: 80,
        unmapped: 15,
        ambiguous: 5,
        unclassified: 25,
        sector_enriched: 75,
        industry_enriched: 70,
        theme_enriched: 50,
      }],
    });

    const result = await getInstitutionalMappingCoverage({
      periodOfReport: "2026-03-31",
    });
    expect(result).toMatchObject({
      totalHoldingCount: 100,
      reliablyMappedHoldingCount: 80,
      unclassifiedHoldingCount: 25,
      symbolCoveragePercent: 80,
      sectorCoveragePercent: 75,
      themeCoveragePercent: 50,
    });

    const query = executeMock.mock.calls[0][0];
    const rendered = new PgDialect().sqlToQuery(query).sql;
    expect(rendered).toContain("WITH evidence AS");
    expect(rendered).toContain("COUNT(*) FILTER");
    expect(rendered).not.toContain("OFFSET");
  });
});