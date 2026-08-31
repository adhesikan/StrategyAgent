/**
 * PostgreSQL adapter for institutional holding enrichment.
 *
 * The adapter resolves the CUSIP first, then joins existing symbol metadata.
 * It never promotes probable/ambiguous mappings to a symbol and never creates
 * a company record as a side effect of reading a holding.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  institutional13fHoldings,
  institutionalSecurityMappings,
  securityMaster,
  securityMasterThemes,
  securityThemes,
  symbols,
} from "@shared/schema";
import type {
  EnrichedInstitutionalHolding,
  EnrichedInstitutionalHoldingsQuery,
  InstitutionalMappingCoverage,
  InstitutionalSecurityMetadata,
  InstitutionalThemeMembership,
} from "./types";
import {
  buildEnrichedInstitutionalHolding,
  resolveReliableSecurityMapping,
} from "./security-enrichment";
import { classifySecurityPositionType } from "../security-position";
import type {
  EnrichmentHoldingInput,
  SecurityMappingEvidence,
} from "./security-enrichment";

type EnrichedHoldingRow = {
  holding: typeof institutional13fHoldings.$inferSelect;
  master: typeof securityMaster.$inferSelect | null;
  mapping: typeof institutionalSecurityMappings.$inferSelect | null;
};

function buildConditions(query: EnrichedInstitutionalHoldingsQuery) {
  const conditions = [];
  if (query.accessionNumber) {
    conditions.push(eq(institutional13fHoldings.accessionNumber, query.accessionNumber));
  }
  if (query.accessionNumbers && query.accessionNumbers.length > 0) {
    conditions.push(
      inArray(institutional13fHoldings.accessionNumber, query.accessionNumbers),
    );
  }
  if (query.cusips && query.cusips.length > 0) {
    conditions.push(inArray(institutional13fHoldings.cusip, query.cusips));
  }
  if (query.periodOfReport) {
    conditions.push(eq(institutional13fHoldings.periodOfReport, query.periodOfReport));
  }
  if (query.periodOfReports && query.periodOfReports.length > 0) {
    conditions.push(
      inArray(institutional13fHoldings.periodOfReport, query.periodOfReports),
    );
  }
  if (query.symbol?.trim()) {
    const symbol = query.symbol.trim().toUpperCase();
    conditions.push(
      or(
        sql`UPPER(${securityMaster.ticker}) = ${symbol}`,
        sql`UPPER(${institutionalSecurityMappings.mappedSymbol}) = ${symbol}`,
        sql`UPPER(${institutional13fHoldings.mappedSymbol}) = ${symbol}`,
      ),
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function holdingInput(row: EnrichedHoldingRow): EnrichmentHoldingInput {
  return {
    holdingId: row.holding.id,
    accessionNumber: row.holding.accessionNumber,
    filerCik: row.holding.filerCik,
    filerName: row.holding.filerName,
    issuerName: row.holding.issuerName,
    cusip: row.holding.cusip,
    periodOfReport: row.holding.periodOfReport,
    reportedValueDollars: row.holding.reportedValue,
    reportedShares: row.holding.reportedShares,
    sharesPrnType: row.holding.sharesPrnType,
    securityPositionType: classifySecurityPositionType(row.holding.putCall),
    putCall: row.holding.putCall,
  };
}

function evidenceFor(row: EnrichedHoldingRow): SecurityMappingEvidence[] {
  return [
    {
      source: "security_master",
      symbol: row.master?.ticker ?? null,
      status: row.master?.reviewStatus ?? null,
    },
    {
      source: "institutional_mapping",
      symbol: row.mapping?.mappedSymbol ?? null,
      status: row.mapping?.mappingStatus ?? null,
    },
    {
      source: "holding",
      symbol: row.holding.mappedSymbol,
      status: row.holding.mappingStatus,
    },
  ];
}

async function loadSymbolMetadata(symbolList: string[]) {
  if (symbolList.length === 0) return new Map<string, typeof symbols.$inferSelect>();
  const rows = await db
    .select()
    .from(symbols)
    .where(inArray(symbols.ticker, symbolList));
  return new Map(rows.map((row) => [row.ticker.toUpperCase(), row]));
}

async function loadThemes(masterIds: string[]) {
  const result = new Map<string, InstitutionalThemeMembership[]>();
  if (masterIds.length === 0) return result;
  const rows = await db
    .select({
      securityMasterId: securityMasterThemes.securityMasterId,
      themeId: securityThemes.themeId,
      themeName: securityThemes.name,
      description: securityThemes.description,
      classificationMethod: securityMasterThemes.classificationMethod,
    })
    .from(securityMasterThemes)
    .innerJoin(
      securityThemes,
      eq(securityThemes.themeId, securityMasterThemes.themeId),
    )
    .where(
      and(
        inArray(securityMasterThemes.securityMasterId, masterIds),
        eq(securityThemes.active, true),
      ),
    );

  for (const row of rows) {
    const memberships = result.get(row.securityMasterId) ?? [];
    memberships.push({
      themeId: row.themeId,
      themeName: row.themeName,
      description: row.description,
      classificationMethod: row.classificationMethod,
    });
    result.set(row.securityMasterId, memberships);
  }
  return result;
}

export async function getEnrichedInstitutionalHoldings(
  query: EnrichedInstitutionalHoldingsQuery = {},
): Promise<EnrichedInstitutionalHolding[]> {
  const rows = await db
    .select({
      holding: institutional13fHoldings,
      master: securityMaster,
      mapping: institutionalSecurityMappings,
    })
    .from(institutional13fHoldings)
    .leftJoin(
      securityMaster,
      eq(securityMaster.cusip, institutional13fHoldings.cusip),
    )
    .leftJoin(
      institutionalSecurityMappings,
      eq(
        institutionalSecurityMappings.cusip,
        institutional13fHoldings.cusip,
      ),
    )
    .where(buildConditions(query))
    .orderBy(
      institutional13fHoldings.accessionNumber,
      institutional13fHoldings.cusip,
      institutional13fHoldings.id,
      institutionalSecurityMappings.id,
      securityMaster.id,
    )
    .limit(query.limit ?? 10_000)
    .offset(query.offset ?? 0) as unknown as EnrichedHoldingRow[];

  const resolutions = rows.map((row) => resolveReliableSecurityMapping(evidenceFor(row)));
  const symbolList = Array.from(
    new Set(
      resolutions
        .map((resolution) => resolution.symbol)
        .filter((symbol): symbol is string => symbol !== null),
    ),
  );
  const metadataBySymbol = await loadSymbolMetadata(symbolList);
  const masterIds = Array.from(
    new Set(
      rows
        .map((row) => row.master?.id)
        .filter((id): id is string => id != null),
    ),
  );
  const themesByMasterId = await loadThemes(masterIds);

  return rows.map((row, index) => {
    const resolution = resolutions[index];
    const masterMatchesSymbol =
      resolution.symbol != null &&
      row.master?.ticker?.trim().toUpperCase() === resolution.symbol;
    const metadataRow = resolution.symbol
      ? metadataBySymbol.get(resolution.symbol)
      : undefined;
    const metadata: InstitutionalSecurityMetadata | null = resolution.symbol
      ? {
          symbol: resolution.symbol,
          companyName:
            metadataRow?.name ??
            (masterMatchesSymbol ? row.master?.issuerName : null) ??
            row.holding.issuerName,
          sector: metadataRow?.sector ?? null,
          industry: metadataRow?.industry ?? null,
          subIndustry: metadataRow?.subIndustry ?? null,
          marketCap: metadataRow?.marketCap ?? null,
          exchange:
            metadataRow?.exchange ??
            (masterMatchesSymbol ? row.master?.exchange : null) ??
            null,
          country: metadataRow?.country ?? null,
          // Canonical stock eligibility is CUSIP-scoped: identity may come
          // from an exact/reviewed institutional mapping while asset type
          // comes from security_master for that same CUSIP. Requiring the
          // security-master ticker to match here discards valid mapping-only
          // identities before stock analytics can consume them.
          assetType: row.master?.assetType ?? null,
        }
      : null;

    return buildEnrichedInstitutionalHolding(
      holdingInput(row),
      resolution,
      metadata,
      masterMatchesSymbol && row.master?.id
        ? themesByMasterId.get(row.master.id) ?? []
        : [],
      metadataRow ? "canonical" : "partial",
    );
  });
}

export async function getInstitutionalMappingCoverage(
  query: Omit<EnrichedInstitutionalHoldingsQuery, "limit" | "offset"> = {},
): Promise<InstitutionalMappingCoverage> {
  const accessionNumber = query.accessionNumber ?? null;
  const periodOfReport = query.periodOfReport ?? null;
  const result = await db.execute(sql`
    WITH evidence AS (
      SELECT
        h.id,
        sm.id AS security_master_id,
        UPPER(NULLIF(TRIM(sm.ticker), '')) AS security_master_ticker,
        CASE
          WHEN sm.review_status = 'reviewed'
            THEN UPPER(NULLIF(TRIM(sm.ticker), ''))
          ELSE NULL
        END AS reviewed_master_symbol,
        CASE
          WHEN ism.mapping_status IN ('exact', 'reviewed')
            THEN UPPER(NULLIF(TRIM(ism.mapped_symbol), ''))
          ELSE NULL
        END AS exact_mapping_symbol,
        CASE
          WHEN h.mapping_status IN ('exact', 'reviewed')
            THEN UPPER(NULLIF(TRIM(h.mapped_symbol), ''))
          ELSE NULL
        END AS exact_holding_symbol,
        (
          ism.mapping_status = 'ambiguous'
          OR h.mapping_status = 'ambiguous'
        ) AS has_ambiguous_status
      FROM institutional_13f_holdings h
      LEFT JOIN security_master sm ON sm.cusip = h.cusip
      LEFT JOIN institutional_security_mappings ism ON ism.cusip = h.cusip
      WHERE (${accessionNumber}::text IS NULL OR h.accession_number = ${accessionNumber})
        AND (${periodOfReport}::date IS NULL OR h.period_of_report = ${periodOfReport}::date)
    ),
    resolved AS (
      SELECT
        *,
        CASE
          WHEN reviewed_master_symbol IS NOT NULL THEN 'reliably_mapped'
          WHEN exact_mapping_symbol IS NOT NULL
            AND exact_holding_symbol IS NOT NULL
            AND exact_mapping_symbol <> exact_holding_symbol THEN 'ambiguous'
          WHEN COALESCE(exact_mapping_symbol, exact_holding_symbol) IS NOT NULL
            THEN 'reliably_mapped'
          WHEN has_ambiguous_status THEN 'ambiguous'
          ELSE 'unmapped'
        END AS mapping_resolution,
        CASE
          WHEN reviewed_master_symbol IS NOT NULL THEN reviewed_master_symbol
          WHEN exact_mapping_symbol IS NOT NULL
            AND exact_holding_symbol IS NOT NULL
            AND exact_mapping_symbol <> exact_holding_symbol THEN NULL
          ELSE COALESCE(exact_mapping_symbol, exact_holding_symbol)
        END AS resolved_symbol
      FROM evidence
    ),
    enriched AS (
      SELECT
        r.*,
        s.ticker AS canonical_ticker,
        s.sector,
        s.industry,
        EXISTS (
          SELECT 1
          FROM security_master_themes smt
          INNER JOIN security_themes st
            ON st.theme_id = smt.theme_id
           AND st.active = TRUE
          WHERE smt.security_master_id = r.security_master_id
            AND r.security_master_ticker = r.resolved_symbol
        ) AS has_theme
      FROM resolved r
      LEFT JOIN symbols s ON UPPER(s.ticker) = r.resolved_symbol
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE mapping_resolution = 'reliably_mapped'
      )::int AS reliably_mapped,
      COUNT(*) FILTER (WHERE mapping_resolution = 'unmapped')::int AS unmapped,
      COUNT(*) FILTER (WHERE mapping_resolution = 'ambiguous')::int AS ambiguous,
      COUNT(*) FILTER (
        WHERE mapping_resolution <> 'reliably_mapped'
           OR canonical_ticker IS NULL
      )::int AS unclassified,
      COUNT(*) FILTER (WHERE sector IS NOT NULL)::int AS sector_enriched,
      COUNT(*) FILTER (WHERE industry IS NOT NULL)::int AS industry_enriched,
      COUNT(*) FILTER (WHERE has_theme)::int AS theme_enriched
    FROM enriched
  `);
  const rows = (result as any).rows ?? result;
  const row = rows[0] ?? {};
  const total = Number(row.total ?? 0);
  const reliablyMapped = Number(row.reliably_mapped ?? 0);
  const sectorEnriched = Number(row.sector_enriched ?? 0);
  const industryEnriched = Number(row.industry_enriched ?? 0);
  const themeEnriched = Number(row.theme_enriched ?? 0);
  const toPercent = (count: number) =>
    total === 0 ? 0 : Math.round((count / total) * 10000) / 100;

  return {
    totalHoldingCount: total,
    reliablyMappedHoldingCount: reliablyMapped,
    unmappedHoldingCount: Number(row.unmapped ?? 0),
    ambiguousHoldingCount: Number(row.ambiguous ?? 0),
    unclassifiedHoldingCount: Number(row.unclassified ?? 0),
    symbolCoveragePercent: toPercent(reliablyMapped),
    sectorEnrichedHoldingCount: sectorEnriched,
    industryEnrichedHoldingCount: industryEnriched,
    themeEnrichedHoldingCount: themeEnriched,
    sectorCoveragePercent: toPercent(sectorEnriched),
    industryCoveragePercent: toPercent(industryEnriched),
    themeCoveragePercent: toPercent(themeEnriched),
  };
}

export const institutionalEnrichmentRepository = {
  getEnrichedInstitutionalHoldings,
  getInstitutionalMappingCoverage,
};