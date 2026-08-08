// Intelligence Snapshot Store — Sprint 2.3.3
//
// Reads and writes precomputed sector/theme intelligence snapshots to PostgreSQL.
// Computation happens in sector-intelligence-engine.ts and theme-intelligence-engine.ts.
// This module only handles persistence and retrieval.
//
// Schema: sector_intelligence_snapshots, theme_intelligence_snapshots
// Retention: 30-day rolling window (enforced on each write)

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  sectorIntelligenceSnapshots,
  themeIntelligenceSnapshots,
} from "../../shared/schema";

// ---------------------------------------------------------------------------
// Date normalization helper
// ---------------------------------------------------------------------------
// The raw db.execute() path returns PG TIMESTAMP columns as Date objects in dev
// but as ISO strings in some production driver configurations. This helper
// handles both so callers never call .toISOString() on a string.
function toIso(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
import type {
  SectorIntelligence,
  SectorSnapshot,
  IntelligenceLabel,
} from "./sector-intelligence-engine";
import type { ThemeIntelligence, ThemeSnapshot } from "./theme-intelligence-engine";

// ---------------------------------------------------------------------------
// Write — sector snapshot
// ---------------------------------------------------------------------------

export async function saveSectorSnapshot(snapshot: SectorSnapshot): Promise<void> {
  if (snapshot.sectors.length === 0) return;

  const rows = snapshot.sectors.map(s => ({
    sector:      s.sector,
    score:       s.score,
    label:       s.label,
    metrics:     serializeSectorMetrics(s),
    topSymbols:  s.topSymbols,
    changes:     s.changes,
    generatedAt: new Date(snapshot.generatedAt),
  }));

  await db.insert(sectorIntelligenceSnapshots).values(rows);

  // Retention: delete rows older than 30 days
  await db.execute(
    sql`DELETE FROM sector_intelligence_snapshots WHERE generated_at < NOW() - INTERVAL '30 days'`,
  );
}

// ---------------------------------------------------------------------------
// Write — theme snapshot
// ---------------------------------------------------------------------------

export async function saveThemeSnapshot(snapshot: ThemeSnapshot): Promise<void> {
  if (snapshot.themes.length === 0) return;

  const rows = snapshot.themes.map(t => ({
    themeId:     t.themeId,
    themeName:   t.themeName,
    score:       t.score,
    label:       t.label,
    metrics:     serializeThemeMetrics(t),
    topSymbols:  t.topSymbols,
    changes:     t.changes,
    generatedAt: new Date(snapshot.generatedAt),
  }));

  await db.insert(themeIntelligenceSnapshots).values(rows);

  // Retention: delete rows older than 30 days
  await db.execute(
    sql`DELETE FROM theme_intelligence_snapshots WHERE generated_at < NOW() - INTERVAL '30 days'`,
  );
}

// ---------------------------------------------------------------------------
// Read — latest sector snapshots (one per sector)
// ---------------------------------------------------------------------------

export interface StoredSectorSummary {
  sector:          string;
  score:           number;
  label:           IntelligenceLabel;
  generatedAt:     string;
  metrics:         Record<string, unknown>;
  topSymbols:      unknown[];
  changes:         Record<string, unknown>;
}

export async function getLatestSectorSnapshots(): Promise<StoredSectorSummary[]> {
  const rows = await db.execute<{
    sector: string;
    score: number;
    label: string;
    generated_at: Date;
    metrics: unknown;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    SELECT DISTINCT ON (sector)
      sector, score, label, generated_at, metrics, top_symbols, changes
    FROM sector_intelligence_snapshots
    ORDER BY sector, generated_at DESC
  `);

  return rows.rows.map(r => ({
    sector:      r.sector,
    score:       r.score,
    label:       r.label as IntelligenceLabel,
    generatedAt: toIso(r.generated_at),
    metrics:     (r.metrics ?? {}) as Record<string, unknown>,
    topSymbols:  (r.top_symbols ?? []) as unknown[],
    changes:     (r.changes ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Read — latest single sector detail
// ---------------------------------------------------------------------------

export async function getLatestSectorDetail(sector: string): Promise<StoredSectorSummary | null> {
  const rows = await db.execute<{
    sector: string;
    score: number;
    label: string;
    generated_at: Date;
    metrics: unknown;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    SELECT sector, score, label, generated_at, metrics, top_symbols, changes
    FROM sector_intelligence_snapshots
    WHERE sector = ${sector}
    ORDER BY generated_at DESC
    LIMIT 1
  `);

  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    sector:      r.sector,
    score:       r.score,
    label:       r.label as IntelligenceLabel,
    generatedAt: toIso(r.generated_at),
    metrics:     (r.metrics ?? {}) as Record<string, unknown>,
    topSymbols:  (r.top_symbols ?? []) as unknown[],
    changes:     (r.changes ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Read — latest theme snapshots (one per theme)
// ---------------------------------------------------------------------------

export interface StoredThemeSummary {
  themeId:         string;
  themeName:       string;
  score:           number;
  label:           IntelligenceLabel;
  generatedAt:     string;
  metrics:         Record<string, unknown>;
  topSymbols:      unknown[];
  changes:         Record<string, unknown>;
}

export async function getLatestThemeSnapshots(): Promise<StoredThemeSummary[]> {
  const rows = await db.execute<{
    theme_id: string;
    theme_name: string;
    score: number;
    label: string;
    generated_at: Date;
    metrics: unknown;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    SELECT DISTINCT ON (theme_id)
      theme_id, theme_name, score, label, generated_at, metrics, top_symbols, changes
    FROM theme_intelligence_snapshots
    ORDER BY theme_id, generated_at DESC
  `);

  return rows.rows.map(r => ({
    themeId:     r.theme_id,
    themeName:   r.theme_name,
    score:       r.score,
    label:       r.label as IntelligenceLabel,
    generatedAt: toIso(r.generated_at),
    metrics:     (r.metrics ?? {}) as Record<string, unknown>,
    topSymbols:  (r.top_symbols ?? []) as unknown[],
    changes:     (r.changes ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Read — latest single theme detail
// ---------------------------------------------------------------------------

export async function getLatestThemeDetail(themeId: string): Promise<StoredThemeSummary | null> {
  const rows = await db.execute<{
    theme_id: string;
    theme_name: string;
    score: number;
    label: string;
    generated_at: Date;
    metrics: unknown;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    SELECT theme_id, theme_name, score, label, generated_at, metrics, top_symbols, changes
    FROM theme_intelligence_snapshots
    WHERE theme_id = ${themeId}
    ORDER BY generated_at DESC
    LIMIT 1
  `);

  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    themeId:     r.theme_id,
    themeName:   r.theme_name,
    score:       r.score,
    label:       r.label as IntelligenceLabel,
    generatedAt: toIso(r.generated_at),
    metrics:     (r.metrics ?? {}) as Record<string, unknown>,
    topSymbols:  (r.top_symbols ?? []) as unknown[],
    changes:     (r.changes ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Read — theme history (last N snapshots)
// ---------------------------------------------------------------------------

export async function getThemeHistory(themeId: string, limit = 12): Promise<StoredThemeSummary[]> {
  const safeLimit = Math.min(52, Math.max(1, limit));
  const rows = await db.execute<{
    theme_id: string;
    theme_name: string;
    score: number;
    label: string;
    generated_at: Date;
    metrics: unknown;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    SELECT theme_id, theme_name, score, label, generated_at, metrics, top_symbols, changes
    FROM theme_intelligence_snapshots
    WHERE theme_id = ${themeId}
    ORDER BY generated_at DESC
    LIMIT ${safeLimit}
  `);

  return rows.rows.map(r => ({
    themeId:     r.theme_id,
    themeName:   r.theme_name,
    score:       r.score,
    label:       r.label as IntelligenceLabel,
    generatedAt: toIso(r.generated_at),
    metrics:     (r.metrics ?? {}) as Record<string, unknown>,
    topSymbols:  (r.top_symbols ?? []) as unknown[],
    changes:     (r.changes ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Read — previous snapshots for change detection
// ---------------------------------------------------------------------------

export async function getPreviousSectorScores(): Promise<
  Map<string, { score: number; topSymbols: string[]; strengtheningSymbols: string[] }>
> {
  // For each sector, get the second-most-recent snapshot
  const rows = await db.execute<{
    sector: string;
    score: number;
    top_symbols: unknown;
    changes: unknown;
  }>(sql`
    WITH ranked AS (
      SELECT sector, score, top_symbols, changes,
             ROW_NUMBER() OVER (PARTITION BY sector ORDER BY generated_at DESC) AS rn
      FROM sector_intelligence_snapshots
    )
    SELECT sector, score, top_symbols, changes FROM ranked WHERE rn = 2
  `);

  const result = new Map<string, { score: number; topSymbols: string[]; strengtheningSymbols: string[] }>();
  for (const r of rows.rows) {
    const topSyms = Array.isArray(r.top_symbols)
      ? (r.top_symbols as { symbol?: string }[]).map(s => s?.symbol ?? "").filter(Boolean)
      : [];
    const changes = (r.changes ?? {}) as { strengtheningSymbols?: string[] };
    result.set(r.sector, {
      score:                r.score,
      topSymbols:           topSyms,
      strengtheningSymbols: changes.strengtheningSymbols ?? [],
    });
  }
  return result;
}

export async function getPreviousThemeScores(): Promise<
  Map<string, { score: number; topSymbols: string[] }>
> {
  const rows = await db.execute<{
    theme_id: string;
    score: number;
    top_symbols: unknown;
  }>(sql`
    WITH ranked AS (
      SELECT theme_id, score, top_symbols,
             ROW_NUMBER() OVER (PARTITION BY theme_id ORDER BY generated_at DESC) AS rn
      FROM theme_intelligence_snapshots
    )
    SELECT theme_id, score, top_symbols FROM ranked WHERE rn = 2
  `);

  const result = new Map<string, { score: number; topSymbols: string[] }>();
  for (const r of rows.rows) {
    const topSyms = Array.isArray(r.top_symbols)
      ? (r.top_symbols as { symbol?: string }[]).map(s => s?.symbol ?? "").filter(Boolean)
      : [];
    result.set(r.theme_id, { score: r.score, topSymbols: topSyms });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Serialization helpers (strip allMembers from stored metrics to keep JSONB lean)
// ---------------------------------------------------------------------------

function serializeSectorMetrics(s: SectorIntelligence): Record<string, unknown> {
  return {
    eligibleSymbolCount:             s.eligibleSymbolCount,
    rankedSymbolCount:               s.rankedSymbolCount,
    averageOpportunityScore:         s.averageOpportunityScore,
    medianOpportunityScore:          s.medianOpportunityScore,
    topOpportunityScore:             s.topOpportunityScore,
    highConfidenceCount:             s.highConfidenceCount,
    newOpportunityCount:             s.newOpportunityCount,
    upgradedCount:                   s.upgradedCount,
    downgradedCount:                 s.downgradedCount,
    institutionalDataAvailableCount: s.institutionalDataAvailableCount,
    institutionalAccumulationCount:  s.institutionalAccumulationCount,
    institutionalDistributionCount:  s.institutionalDistributionCount,
    averageInstitutionalScore:       s.averageInstitutionalScore,
    strengtheningCount:              s.strengtheningCount,
    weakeningCount:                  s.weakeningCount,
    industries:                      s.industries,
    technicalCoverage:               s.technicalCoverage,
    institutionalCoverage:           s.institutionalCoverage,
  };
}

function serializeThemeMetrics(t: ThemeIntelligence): Record<string, unknown> {
  return {
    memberCount:                     t.memberCount,
    rankedMemberCount:               t.rankedMemberCount,
    averageOpportunityScore:         t.averageOpportunityScore,
    medianOpportunityScore:          t.medianOpportunityScore,
    topOpportunityScore:             t.topOpportunityScore,
    breadth:                         t.breadth,
    highConfidenceCount:             t.highConfidenceCount,
    newOpportunityCount:             t.newOpportunityCount,
    upgradedCount:                   t.upgradedCount,
    downgradedCount:                 t.downgradedCount,
    strengtheningCount:              t.strengtheningCount,
    weakeningCount:                  t.weakeningCount,
    institutionalDataAvailableCount: t.institutionalDataAvailableCount,
    institutionalAccumulationCount:  t.institutionalAccumulationCount,
    institutionalDistributionCount:  t.institutionalDistributionCount,
    allMembers:                      t.allMembers,
    description:                     t.description,
    dataQuality:                     t.dataQuality,
  };
}
