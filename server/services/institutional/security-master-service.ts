// Institutional Intelligence — Security Master Service
//
// CUSIP → ticker mapping engine with priority-based resolution,
// confidence scoring, and a review workflow.
//
// Mapping priority (highest to lowest confidence):
//   1. security_master reviewed entry           (confidence 100)
//   2. institutionalSecurityMappings exact/reviewed  (confidence 95)
//   3. FIGI exact match                         (confidence 90)
//   4. Issuer name deterministic match (unique) (confidence 80)
//   5. Probable heuristic match                 (confidence 60)
//   6. Unmapped queue                           (confidence 0)
//
// NEVER overwrites a reviewed mapping via automation.
// The review workflow (approve/reject/merge) is human-gated.

import { db } from "../../db";
import {
  securityMaster,
  institutionalSecurityMappings,
  institutional13fHoldings,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  inArray,
  notInArray,
  desc,
  asc,
  like,
  ilike,
  sql,
  gt,
  ne,
} from "drizzle-orm";
import type { SecurityMaster, InsertSecurityMaster } from "@shared/schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  REVIEWED: 100,
  EXACT: 95,
  FIGI_EXACT: 90,
  NAME_MATCH: 80,
  PROBABLE: 60,
  UNMAPPED: 0,
} as const;

export type ReviewStatus = "reviewed" | "probable" | "needs_review" | "unmapped" | "rejected";
export type MappingMethod = "manual" | "cusip_exact" | "figi_exact" | "name_match" | "heuristic" | "unmapped";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MappingStats {
  reviewed: number;
  probable: number;
  needsReview: number;
  unmapped: number;
  rejected: number;
  total: number;
  mappedHoldings: number;
  unmappedHoldings: number;
  totalHoldings: number;
  coveragePercent: number;
}

export interface UnmappedIssuer {
  cusip: string;
  issuerName: string | null;
  holdingCount: number;
  figi: string | null;
}

export interface MappingQueueEntry {
  id: string;
  cusip: string;
  ticker: string | null;
  issuerName: string | null;
  exchange: string | null;
  assetType: string | null;
  figi: string | null;
  confidence: number;
  mappingMethod: string;
  reviewStatus: string;
  holdingCount: number;
  firstSeen: Date;
  lastVerified: Date;
  notes: string | null;
}

export interface MappingQueuePage {
  entries: MappingQueueEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PipelineRunResult {
  discovered: number;
  newEntries: number;
  resolvedViaExisting: number;
  resolvedViaFigi: number;
  resolvedViaName: number;
  unmapped: number;
  skippedReviewed: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Normalize issuer name for comparison: uppercase, collapse whitespace,
 *  strip common suffixes (INC, CORP, LTD, etc.) */
function normalizeIssuerName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE|CLASS [AB]|COM|COMMON|STOCK)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full mapping pipeline:
 *   1. Discover CUSIPs from holdings (optionally filtered by quarter).
 *   2. For each unknown CUSIP, run priority resolution.
 *   3. Upsert results into security_master (never overwrite reviewed entries).
 *   4. Update holding_count on all entries.
 *
 * Does NOT touch the ingestion pipeline or mapping-service.ts.
 */
export async function runMappingPipeline(opts: {
  quarter?: string;
  limitCusips?: number;
} = {}): Promise<PipelineRunResult> {
  const start = Date.now();

  // ── Step 1: Discover CUSIPs from holdings ───────────────────────────────
  let holdingsQuery = db
    .select({
      cusip: institutional13fHoldings.cusip,
      figi: institutional13fHoldings.figi,
      issuerName: institutional13fHoldings.issuerName,
      count: sql<number>`count(*)::int`,
    })
    .from(institutional13fHoldings)
    .groupBy(
      institutional13fHoldings.cusip,
      institutional13fHoldings.figi,
      institutional13fHoldings.issuerName,
    )
    .orderBy(desc(sql`count(*)`));

  if (opts.limitCusips) {
    holdingsQuery = (holdingsQuery as any).limit(opts.limitCusips);
  }

  const holdingGroups = await holdingsQuery;

  if (holdingGroups.length === 0) {
    return {
      discovered: 0,
      newEntries: 0,
      resolvedViaExisting: 0,
      resolvedViaFigi: 0,
      resolvedViaName: 0,
      unmapped: 0,
      skippedReviewed: 0,
      durationMs: Date.now() - start,
    };
  }

  // ── Step 2: Load existing security_master entries ──────────────────────
  const allCusips = Array.from(new Set(holdingGroups.map((h) => h.cusip)));
  const existingRows = await db
    .select()
    .from(securityMaster)
    .where(inArray(securityMaster.cusip, allCusips));

  const existingMap = new Map<string, SecurityMaster>();
  for (const row of existingRows) {
    existingMap.set(row.cusip, row);
  }

  // ── Step 3: Load legacy institutionalSecurityMappings for fallback ─────
  const legacyRows = await db
    .select({
      cusip: institutionalSecurityMappings.cusip,
      figi: institutionalSecurityMappings.figi,
      mappedSymbol: institutionalSecurityMappings.mappedSymbol,
      mappingStatus: institutionalSecurityMappings.mappingStatus,
      mappingMethod: institutionalSecurityMappings.mappingMethod,
    })
    .from(institutionalSecurityMappings)
    .where(
      inArray(institutionalSecurityMappings.mappingStatus, ["exact", "reviewed"]),
    );

  const legacyMap = new Map<string, { symbol: string | null; method: string }>();
  for (const row of legacyRows) {
    if (row.mappedSymbol) {
      legacyMap.set(row.cusip, { symbol: row.mappedSymbol, method: row.mappingMethod });
    }
  }

  // FIGI index over legacy rows for cross-CUSIP FIGI matching
  const figiMap = new Map<string, string>(); // figi → symbol
  for (const row of legacyRows) {
    if (row.figi && row.mappedSymbol) {
      figiMap.set(row.figi, row.mappedSymbol);
    }
  }
  // Also index FIGIs from security_master reviewed entries
  for (const row of existingRows) {
    if (row.figi && row.ticker && row.reviewStatus === "reviewed") {
      figiMap.set(row.figi, row.ticker);
    }
  }

  // Issuer name index from reviewed entries
  const nameMap = new Map<string, { symbol: string; cusip: string }[]>();
  const allReviewed = [
    ...existingRows.filter((r) => r.reviewStatus === "reviewed"),
  ];
  for (const row of allReviewed) {
    if (!row.ticker || !row.issuerName) continue;
    const key = normalizeIssuerName(row.issuerName);
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push({ symbol: row.ticker, cusip: row.cusip });
  }

  // ── Step 4: Resolve each CUSIP ─────────────────────────────────────────
  const stats = {
    discovered: holdingGroups.length,
    newEntries: 0,
    resolvedViaExisting: 0,
    resolvedViaFigi: 0,
    resolvedViaName: 0,
    unmapped: 0,
    skippedReviewed: 0,
  };

  const upserts: InsertSecurityMaster[] = [];

  // Group by CUSIP (take first issuerName and figi seen, use max count)
  const cusipGroups = new Map<string, { figi: string | null; issuerName: string | null; count: number }>();
  for (const h of holdingGroups) {
    const existing = cusipGroups.get(h.cusip);
    if (!existing || h.count > existing.count) {
      cusipGroups.set(h.cusip, { figi: h.figi, issuerName: h.issuerName, count: h.count });
    }
  }

  for (const [cusip, info] of Array.from(cusipGroups)) {
    const existing = existingMap.get(cusip);

    // Never overwrite reviewed entries via automation
    if (existing?.reviewStatus === "reviewed") {
      stats.skippedReviewed++;
      // Still update holding_count
      upserts.push({
        cusip,
        ticker: existing.ticker,
        issuerName: existing.issuerName ?? info.issuerName,
        figi: existing.figi ?? info.figi,
        confidence: existing.confidence,
        mappingMethod: existing.mappingMethod as MappingMethod,
        reviewStatus: existing.reviewStatus as ReviewStatus,
        holdingCount: info.count,
        notes: existing.notes,
      });
      continue;
    }

    // Priority 1: Already in security_master as reviewed (handled above)
    // Priority 2: Legacy exact/reviewed mapping
    const legacy = legacyMap.get(cusip);
    if (legacy?.symbol) {
      stats.resolvedViaExisting++;
      upserts.push({
        cusip,
        ticker: legacy.symbol,
        issuerName: info.issuerName,
        figi: info.figi,
        confidence: CONFIDENCE.EXACT,
        mappingMethod: "cusip_exact",
        reviewStatus: "probable", // will be confirmed reviewed after human review
        holdingCount: info.count,
        notes: `Auto-resolved from legacy mapping table (method: ${legacy.method})`,
      });
      continue;
    }

    // Priority 3: FIGI match
    if (info.figi) {
      const figiSymbol = figiMap.get(info.figi);
      if (figiSymbol) {
        stats.resolvedViaFigi++;
        upserts.push({
          cusip,
          ticker: figiSymbol,
          issuerName: info.issuerName,
          figi: info.figi,
          confidence: CONFIDENCE.FIGI_EXACT,
          mappingMethod: "figi_exact",
          reviewStatus: "probable",
          holdingCount: info.count,
          notes: `Auto-resolved via FIGI exact match (figi: ${info.figi})`,
        });
        continue;
      }
    }

    // Priority 4: Issuer name deterministic match (unique)
    if (info.issuerName) {
      const key = normalizeIssuerName(info.issuerName);
      const matches = nameMap.get(key);
      if (matches && matches.length === 1 && matches[0].cusip !== cusip) {
        stats.resolvedViaName++;
        upserts.push({
          cusip,
          ticker: matches[0].symbol,
          issuerName: info.issuerName,
          figi: info.figi,
          confidence: CONFIDENCE.NAME_MATCH,
          mappingMethod: "name_match",
          reviewStatus: "needs_review",
          holdingCount: info.count,
          notes: `Auto-resolved via issuer name match: "${info.issuerName}"`,
        });
        continue;
      }
    }

    // Priority 5+: Unmapped
    stats.unmapped++;
    upserts.push({
      cusip,
      ticker: null,
      issuerName: info.issuerName,
      figi: info.figi,
      confidence: CONFIDENCE.UNMAPPED,
      mappingMethod: "unmapped",
      reviewStatus: "unmapped",
      holdingCount: info.count,
      notes: null,
    });
  }

  // ── Step 5: Batch upsert ───────────────────────────────────────────────
  const BATCH = 500;
  let newCount = 0;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const batch = upserts.slice(i, i + BATCH);
    // Use INSERT ... ON CONFLICT to never overwrite reviewed entries' ticker/status
    for (const entry of batch) {
      const result = await db
        .insert(securityMaster)
        .values(entry)
        .onConflictDoUpdate({
          target: securityMaster.cusip,
          // Never overwrite reviewed mappings — guard with a WHERE clause
          setWhere: ne(securityMaster.reviewStatus, "reviewed"),
          set: {
            ticker: sql`CASE WHEN ${securityMaster.reviewStatus} = 'reviewed' THEN ${securityMaster.ticker} ELSE EXCLUDED.ticker END`,
            issuerName: sql`COALESCE(EXCLUDED.issuer_name, ${securityMaster.issuerName})`,
            figi: sql`COALESCE(EXCLUDED.figi, ${securityMaster.figi})`,
            confidence: sql`CASE WHEN ${securityMaster.reviewStatus} = 'reviewed' THEN ${securityMaster.confidence} ELSE EXCLUDED.confidence END`,
            mappingMethod: sql`CASE WHEN ${securityMaster.reviewStatus} = 'reviewed' THEN ${securityMaster.mappingMethod} ELSE EXCLUDED.mapping_method END`,
            reviewStatus: sql`CASE WHEN ${securityMaster.reviewStatus} = 'reviewed' THEN ${securityMaster.reviewStatus} ELSE EXCLUDED.review_status END`,
            holdingCount: sql`EXCLUDED.holding_count`,
            lastVerified: sql`now()`,
            notes: sql`CASE WHEN ${securityMaster.reviewStatus} = 'reviewed' THEN ${securityMaster.notes} ELSE EXCLUDED.notes END`,
          },
        })
        .returning({ id: securityMaster.id });
      if (result.length > 0) newCount++;
    }
  }
  stats.newEntries = newCount;

  return {
    ...stats,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

/**
 * Approve a mapping: mark as reviewed, set ticker.
 * Also syncs the confirmed mapping into institutionalSecurityMappings
 * so the ingestion pipeline picks it up on its next run.
 */
export async function approveMapping(
  cusip: string,
  ticker: string,
  opts: { exchange?: string; assetType?: string; notes?: string } = {},
): Promise<SecurityMaster> {
  const normalTicker = ticker.toUpperCase().trim();
  if (!normalTicker) throw new Error("ticker is required");

  // Update security_master
  const [updated] = await db
    .update(securityMaster)
    .set({
      ticker: normalTicker,
      exchange: opts.exchange ?? null,
      assetType: opts.assetType ?? null,
      confidence: CONFIDENCE.REVIEWED,
      mappingMethod: "manual",
      reviewStatus: "reviewed",
      lastVerified: new Date(),
      notes: opts.notes ?? null,
    })
    .where(eq(securityMaster.cusip, cusip))
    .returning();

  if (!updated) throw new Error(`CUSIP not found in security_master: ${cusip}`);

  // Sync to institutionalSecurityMappings (upsert, respect existing reviewed entries)
  await db
    .insert(institutionalSecurityMappings)
    .values({
      cusip,
      figi: updated.figi,
      issuerName: updated.issuerName,
      classTitle: null,
      mappedSymbol: normalTicker,
      mappingStatus: "reviewed",
      mappingMethod: "manual",
      notes: `Approved via mapping queue — ${opts.notes ?? "no notes"}`,
    })
    .onConflictDoUpdate({
      target: institutionalSecurityMappings.cusip,
      set: {
        mappedSymbol: sql`EXCLUDED.mapped_symbol`,
        mappingStatus: sql`'reviewed'`,
        mappingMethod: sql`'manual'`,
        lastVerifiedAt: sql`now()`,
        notes: sql`EXCLUDED.notes`,
      },
    });

  return updated;
}

/**
 * Reject a mapping: mark as rejected, clear ticker.
 */
export async function rejectMapping(
  cusip: string,
  notes?: string,
): Promise<SecurityMaster> {
  const [updated] = await db
    .update(securityMaster)
    .set({
      ticker: null,
      confidence: 0,
      mappingMethod: "manual",
      reviewStatus: "rejected",
      lastVerified: new Date(),
      notes: notes ?? null,
    })
    .where(eq(securityMaster.cusip, cusip))
    .returning();

  if (!updated) throw new Error(`CUSIP not found in security_master: ${cusip}`);

  // Also mark rejected in legacy table if present
  await db
    .update(institutionalSecurityMappings)
    .set({ mappingStatus: "rejected", lastVerifiedAt: new Date() })
    .where(eq(institutionalSecurityMappings.cusip, cusip));

  return updated;
}

/**
 * Merge: point fromCusip to the same ticker as intoCusip.
 * fromCusip must not already be reviewed.
 */
export async function mergeMapping(fromCusip: string, intoCusip: string): Promise<SecurityMaster> {
  const [target] = await db
    .select()
    .from(securityMaster)
    .where(
      and(
        eq(securityMaster.cusip, intoCusip),
        eq(securityMaster.reviewStatus, "reviewed"),
      ),
    )
    .limit(1);

  if (!target) {
    throw new Error(`Target CUSIP ${intoCusip} is not reviewed — cannot merge into it`);
  }

  const [updated] = await db
    .update(securityMaster)
    .set({
      ticker: target.ticker,
      confidence: CONFIDENCE.REVIEWED,
      mappingMethod: "manual",
      reviewStatus: "reviewed",
      lastVerified: new Date(),
      notes: `Merged with ${intoCusip}`,
    })
    .where(
      and(
        eq(securityMaster.cusip, fromCusip),
        ne(securityMaster.reviewStatus, "reviewed"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error(`CUSIP ${fromCusip} is already reviewed or not found — cannot merge`);
  }

  // Sync to legacy table
  await db
    .insert(institutionalSecurityMappings)
    .values({
      cusip: fromCusip,
      figi: updated.figi,
      issuerName: updated.issuerName,
      classTitle: null,
      mappedSymbol: target.ticker,
      mappingStatus: "reviewed",
      mappingMethod: "manual",
      notes: `Merged with ${intoCusip}`,
    })
    .onConflictDoUpdate({
      target: institutionalSecurityMappings.cusip,
      set: {
        mappedSymbol: sql`EXCLUDED.mapped_symbol`,
        mappingStatus: sql`'reviewed'`,
        mappingMethod: sql`'manual'`,
        lastVerifiedAt: sql`now()`,
        notes: sql`EXCLUDED.notes`,
      },
    });

  return updated;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export async function getMappingStats(): Promise<MappingStats> {
  // Counts by reviewStatus from security_master
  const statusCounts = await db.execute(sql`
    SELECT review_status, COUNT(*)::int AS cnt
    FROM security_master
    GROUP BY review_status
  `);

  const counts: Record<string, number> = {};
  const rows = (statusCounts as any).rows ?? statusCounts;
  for (const row of rows) {
    counts[row.review_status] = Number(row.cnt);
  }

  const reviewed = counts["reviewed"] ?? 0;
  const probable = counts["probable"] ?? 0;
  const needsReview = counts["needs_review"] ?? 0;
  const unmapped = counts["unmapped"] ?? 0;
  const rejected = counts["rejected"] ?? 0;
  const total = reviewed + probable + needsReview + unmapped + rejected;

  // Holdings coverage from institutional_13f_holdings
  const holdingsCoverage = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE mapped_symbol IS NOT NULL AND mapping_status IN ('exact','reviewed'))::int AS mapped,
      COUNT(*) FILTER (WHERE mapped_symbol IS NULL OR mapping_status NOT IN ('exact','reviewed'))::int AS unmapped_h,
      COUNT(*)::int AS total_h
    FROM institutional_13f_holdings
    WHERE put_call IS NULL AND shares_prn_type = 'SH'
  `);

  const hRow = ((holdingsCoverage as any).rows ?? holdingsCoverage)[0] ?? {};
  const mappedHoldings = Number(hRow.mapped ?? 0);
  const unmappedHoldings = Number(hRow.unmapped_h ?? 0);
  const totalHoldings = Number(hRow.total_h ?? 0);
  const coveragePercent = totalHoldings > 0 ? Math.round((mappedHoldings / totalHoldings) * 100) : 0;

  return {
    reviewed,
    probable,
    needsReview,
    unmapped,
    rejected,
    total,
    mappedHoldings,
    unmappedHoldings,
    totalHoldings,
    coveragePercent,
  };
}

export async function getTopUnmapped(limit = 25): Promise<UnmappedIssuer[]> {
  const rows = await db
    .select({
      cusip: securityMaster.cusip,
      issuerName: securityMaster.issuerName,
      holdingCount: securityMaster.holdingCount,
      figi: securityMaster.figi,
    })
    .from(securityMaster)
    .where(
      inArray(securityMaster.reviewStatus, ["unmapped", "needs_review"]),
    )
    .orderBy(desc(securityMaster.holdingCount))
    .limit(limit);

  return rows.map((r) => ({
    cusip: r.cusip,
    issuerName: r.issuerName,
    holdingCount: r.holdingCount,
    figi: r.figi,
  }));
}

// ---------------------------------------------------------------------------
// Queue listing
// ---------------------------------------------------------------------------

export async function getMappingQueue(opts: {
  status?: ReviewStatus | "all";
  search?: string;
  page?: number;
  pageSize?: number;
  orderBy?: "holdingCount" | "confidence" | "lastVerified";
  order?: "asc" | "desc";
}): Promise<MappingQueuePage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const status = opts.status ?? "all";

  const conditions: any[] = [];

  if (status !== "all") {
    conditions.push(eq(securityMaster.reviewStatus, status));
  } else {
    // Default: exclude rejected when showing "all"
    conditions.push(ne(securityMaster.reviewStatus, "rejected"));
  }

  if (opts.search) {
    const s = `%${opts.search.toUpperCase()}%`;
    conditions.push(
      or(
        ilike(securityMaster.cusip, s),
        ilike(securityMaster.ticker, s),
        ilike(securityMaster.issuerName, s),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const countResult = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(securityMaster)
    .where(whereClause);
  const total = Number(countResult[0]?.cnt ?? 0);

  // Fetch page
  const orderCol =
    opts.orderBy === "confidence"
      ? securityMaster.confidence
      : opts.orderBy === "lastVerified"
        ? securityMaster.lastVerified
        : securityMaster.holdingCount;

  const orderDir = opts.order === "asc" ? asc(orderCol) : desc(orderCol);

  const entries = await db
    .select()
    .from(securityMaster)
    .where(whereClause)
    .orderBy(orderDir)
    .limit(pageSize)
    .offset(offset);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      cusip: e.cusip,
      ticker: e.ticker,
      issuerName: e.issuerName,
      exchange: e.exchange,
      assetType: e.assetType,
      figi: e.figi,
      confidence: e.confidence,
      mappingMethod: e.mappingMethod,
      reviewStatus: e.reviewStatus,
      holdingCount: e.holdingCount,
      firstSeen: e.firstSeen,
      lastVerified: e.lastVerified,
      notes: e.notes,
    })),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Audit summary
// ---------------------------------------------------------------------------

export interface MappingAudit {
  stats: MappingStats;
  topUnmapped: UnmappedIssuer[];
  remainingWork: {
    toReview: number;
    estimatedReviewMinutes: number;
  };
}

export async function getMappingAudit(): Promise<MappingAudit> {
  const [stats, topUnmapped] = await Promise.all([
    getMappingStats(),
    getTopUnmapped(20),
  ]);

  const toReview = stats.needsReview + stats.probable;
  // Rough estimate: 30 seconds per mapping review
  const estimatedReviewMinutes = Math.ceil((toReview * 0.5) / 60);

  return {
    stats,
    topUnmapped,
    remainingWork: {
      toReview,
      estimatedReviewMinutes,
    },
  };
}
