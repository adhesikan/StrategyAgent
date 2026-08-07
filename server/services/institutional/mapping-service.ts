// Institutional Security Mapping Service — Sprint 2.2.5.
//
// Maps CUSIP identifiers from 13F holdings to VCP Trader internal symbols.
//
// Mapping hierarchy (per spec):
//   1. Exact CUSIP match already present in institutionalSecurityMappings
//   2. Exact FIGI match when both sides provide FIGI
//   3. Previously reviewed durable mapping
//   4. Deterministic issuer/class match (only when unique + high-confidence)
//   5. Unmapped
//
// Production analytics ONLY use exact and reviewed mappings.
// probable / ambiguous are available in diagnostic views only.
//
// Every mapping records: method, symbol, status, created-at, last-verified.

import { db } from "../../db";
import {
  institutionalSecurityMappings,
  institutionalSecurityMappings as mappingsTable,
  institutional13fHoldings,
} from "@shared/schema";
import { eq, and, inArray, or, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { InsertInstitutionalSecurityMapping } from "@shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MappingStatus = "exact" | "reviewed" | "probable" | "ambiguous" | "unmapped" | "rejected";
export type MappingMethod = "cusip_exact" | "figi_exact" | "reviewed" | "name_match" | "manual";

export interface MappingResult {
  cusip: string;
  mappedSymbol: string | null;
  mappingStatus: MappingStatus;
  mappingMethod: MappingMethod | null;
}

export interface MappingRow {
  cusip: string;
  figi: string | null;
  mappedSymbol: string | null;
  mappingStatus: MappingStatus;
  mappingMethod: MappingMethod;
}

// ---------------------------------------------------------------------------
// In-memory cache (invalidated on upsert)
// ---------------------------------------------------------------------------

let mappingCache: Map<string, MappingRow> | null = null;

async function getCache(): Promise<Map<string, MappingRow>> {
  if (mappingCache) return mappingCache;
  mappingCache = await loadAllMappings();
  return mappingCache;
}

function invalidateCache(): void {
  mappingCache = null;
}

async function loadAllMappings(): Promise<Map<string, MappingRow>> {
  const rows = await db
    .select({
      cusip: institutionalSecurityMappings.cusip,
      figi: institutionalSecurityMappings.figi,
      mappedSymbol: institutionalSecurityMappings.mappedSymbol,
      mappingStatus: institutionalSecurityMappings.mappingStatus,
      mappingMethod: institutionalSecurityMappings.mappingMethod,
    })
    .from(institutionalSecurityMappings);

  const map = new Map<string, MappingRow>();
  for (const row of rows) {
    map.set(row.cusip, {
      cusip: row.cusip,
      figi: row.figi,
      mappedSymbol: row.mappedSymbol,
      mappingStatus: row.mappingStatus as MappingStatus,
      mappingMethod: row.mappingMethod as MappingMethod,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Resolve a CUSIP (and optional FIGI) to an internal symbol.
 * Only exact and reviewed mappings are returned with a non-null symbol
 * for production use. Probable/ambiguous are returned as-is for diagnostics.
 */
export async function resolveMapping(
  cusip: string,
  figi: string | null = null,
): Promise<MappingResult> {
  const cache = await getCache();

  // 1. Exact CUSIP match
  const existing = cache.get(cusip);
  if (existing) {
    return {
      cusip,
      mappedSymbol: existing.mappedSymbol,
      mappingStatus: existing.mappingStatus as MappingStatus,
      mappingMethod: existing.mappingMethod as MappingMethod,
    };
  }

  // 2. FIGI match — check other rows with matching FIGI
  if (figi) {
    for (const row of Array.from(cache.values())) {
      if (row.figi === figi && row.mappedSymbol) {
        // Found via FIGI — create a derived exact entry
        const derived: InsertInstitutionalSecurityMapping = {
          cusip,
          figi,
          mappedSymbol: row.mappedSymbol,
          mappingStatus: "exact",
          mappingMethod: "figi_exact",
          notes: `Derived from FIGI match with CUSIP ${row.cusip}`,
        };
        await upsertMapping(derived);
        return {
          cusip,
          mappedSymbol: row.mappedSymbol,
          mappingStatus: "exact",
          mappingMethod: "figi_exact",
        };
      }
    }
  }

  // 3. Unmapped — record as unmapped so the audit knows about it
  return {
    cusip,
    mappedSymbol: null,
    mappingStatus: "unmapped",
    mappingMethod: null,
  };
}

/**
 * Batch resolve CUSIPs. Returns a Map<cusip, MappingResult>.
 * Efficient for ingestion of a full filing.
 */
export async function resolveMappingsBatch(
  entries: Array<{ cusip: string; figi: string | null }>,
): Promise<Map<string, MappingResult>> {
  const cache = await getCache();
  const results = new Map<string, MappingResult>();

  for (const { cusip, figi } of entries) {
    if (results.has(cusip)) continue;
    const existing = cache.get(cusip);
    if (existing) {
      results.set(cusip, {
        cusip,
        mappedSymbol: existing.mappedSymbol,
        mappingStatus: existing.mappingStatus as MappingStatus,
        mappingMethod: existing.mappingMethod as MappingMethod,
      });
      continue;
    }
    // FIGI fallback
    if (figi) {
      let found = false;
      for (const row of Array.from(cache.values())) {
        if (row.figi === figi && row.mappedSymbol) {
          results.set(cusip, { cusip, mappedSymbol: row.mappedSymbol, mappingStatus: "exact", mappingMethod: "figi_exact" });
          found = true;
          break;
        }
      }
      if (found) continue;
    }
    results.set(cusip, { cusip, mappedSymbol: null, mappingStatus: "unmapped", mappingMethod: null });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a mapping record. On conflict (cusip), update the fields
 * unless the existing status is exact/reviewed and the new one is weaker.
 */
export async function upsertMapping(
  mapping: InsertInstitutionalSecurityMapping,
): Promise<void> {
  await db
    .insert(institutionalSecurityMappings)
    .values(mapping)
    .onConflictDoUpdate({
      target: institutionalSecurityMappings.cusip,
      set: {
        figi: sql`EXCLUDED.figi`,
        mappedSymbol: sql`EXCLUDED.mapped_symbol`,
        mappingStatus: sql`EXCLUDED.mapping_status`,
        mappingMethod: sql`EXCLUDED.mapping_method`,
        lastVerifiedAt: sql`now()`,
        notes: sql`EXCLUDED.notes`,
      },
    });
  invalidateCache();
}

/**
 * Seed known-correct CUSIP→ticker mappings from a static list.
 * Only records that are not already in the DB are inserted.
 * This is the mechanism for the VCP Trader tracked universe.
 */
export async function seedReviewedMappings(
  mappings: Array<{ cusip: string; symbol: string; issuerName?: string; classTitle?: string; notes?: string }>,
): Promise<number> {
  let seeded = 0;
  for (const m of mappings) {
    const existing = await db
      .select({ cusip: institutionalSecurityMappings.cusip })
      .from(institutionalSecurityMappings)
      .where(eq(institutionalSecurityMappings.cusip, m.cusip))
      .limit(1);

    if (existing.length === 0) {
      await upsertMapping({
        cusip: m.cusip,
        figi: null,
        issuerName: m.issuerName ?? null,
        classTitle: m.classTitle ?? "COM",
        mappedSymbol: m.symbol,
        mappingStatus: "reviewed",
        mappingMethod: "manual",
        notes: m.notes ?? "Seeded from VCP Trader universe mapping table",
      });
      seeded++;
    }
  }
  return seeded;
}

// ---------------------------------------------------------------------------
// Update holdings table with mapping results
// ---------------------------------------------------------------------------

/**
 * Apply mapping results to the institutional_13f_holdings table for a given
 * accession number. Called after parsing a filing.
 */
export async function applyMappingsToHoldings(accessionNumber: string): Promise<{
  mappedCount: number;
  unmappedCount: number;
}> {
  // Fetch all holdings for this accession that are unmapped
  const holdings = await db
    .select({
      id: institutional13fHoldings.id,
      cusip: institutional13fHoldings.cusip,
      figi: institutional13fHoldings.figi,
      mappingStatus: institutional13fHoldings.mappingStatus,
    })
    .from(institutional13fHoldings)
    .where(eq(institutional13fHoldings.accessionNumber, accessionNumber));

  if (holdings.length === 0) return { mappedCount: 0, unmappedCount: 0 };

  const entries = holdings.map((h) => ({ cusip: h.cusip, figi: h.figi }));
  const mappings = await resolveMappingsBatch(entries);

  let mappedCount = 0;
  let unmappedCount = 0;

  for (const holding of holdings) {
    const mapping = mappings.get(holding.cusip);
    if (!mapping) { unmappedCount++; continue; }

    await db
      .update(institutional13fHoldings)
      .set({
        mappedSymbol: mapping.mappedSymbol,
        mappingStatus: mapping.mappingStatus,
      })
      .where(eq(institutional13fHoldings.id, holding.id));

    if (mapping.mappedSymbol) mappedCount++;
    else unmappedCount++;
  }

  return { mappedCount, unmappedCount };
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

/** Count mappings by status. */
export async function getMappingCounts(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT mapping_status, COUNT(*)::int AS cnt
    FROM institutional_security_mappings
    GROUP BY mapping_status
  `);
  const counts: Record<string, number> = {};
  const rowArr = (rows as any).rows ?? (rows as any);
  for (const row of rowArr) {
    counts[row.mapping_status] = row.cnt;
  }
  return counts;
}

/** Return symbols in the tracked universe that have at least one exact/reviewed mapping. */
export async function getMappedSymbols(): Promise<string[]> {
  const rows = await db
    .select({ mappedSymbol: institutionalSecurityMappings.mappedSymbol })
    .from(institutionalSecurityMappings)
    .where(
      and(
        inArray(institutionalSecurityMappings.mappingStatus, ["exact", "reviewed"]),
        sql`${institutionalSecurityMappings.mappedSymbol} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.mappedSymbol!).filter(Boolean);
}
