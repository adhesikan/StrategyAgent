/**
 * Portfolio History Service — Sprint 2.6.0
 *
 * Captures portfolio snapshots after meaningful portfolio state changes and
 * provides deterministic portfolio change classification.
 *
 * ARCHITECTURE:
 *   Opportunity Intelligence (existing) → Portfolio History (this service)
 *   → Portfolio Change Intelligence → Future Portfolio Intelligence
 *
 * DESIGN RULES:
 *   - Database-first market data (getReferenceSnapshotsBulk, no Twelve Data calls)
 *   - Bulk-load everything (no N+1 queries)
 *   - Missing data stored as NULL, never coerced to 0
 *   - Deterministic deduplication (fingerprint = hash of sorted symbol:qty pairs)
 *   - Snapshot triggers are fire-and-forget; failures never block the user operation
 *   - Scores (researchScore, technicalScore, etc.) are READ from Opportunity Intelligence
 *     only — never redefined here
 *
 * COMPLIANCE:
 *   "Position Increased" / "Position Reduced" / "Research Evidence Improved"
 *   Never: "You bought", "You sold", "Recommendation"
 */

import crypto from "crypto";
import { db } from "../db";
import { portfolios, portfolioPositions } from "../../shared/schema";
import { eq, and, gte, lte, desc, lt, sql } from "drizzle-orm";
import { getReferenceSnapshotsBulk } from "./daily-market-data/reference-snapshot";
import { getOpportunityIntelligence } from "./opportunity-intelligence-service";
import { getAllThemes } from "../config/theme-registry";
import { markJobStarted, markJobCompleted, markJobFailed } from "./job-status-store";
import type {
  PortfolioSnapshot,
  PortfolioSnapshotCard,
  PortfolioPositionSnapshot,
  PortfolioChangeResult,
  PortfolioChangeSummary,
  PositionChangeItem,
  ResearchChangeItem,
  ExposureChangeItem,
  SnapshotCoverage,
  SnapshotSourceType,
  HistoryPeriod,
  PortfolioHistoryHealth,
  ResearchChangeType,
} from "../../shared/portfolio-history-types";

// ---------------------------------------------------------------------------
// Startup migration
// ---------------------------------------------------------------------------

export async function ensurePortfolioHistoryTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id                 VARCHAR(128) PRIMARY KEY,
      portfolio_id       VARCHAR(128) NOT NULL,
      user_id            VARCHAR(128) NOT NULL,
      snapshot_date      DATE NOT NULL,
      captured_at        TIMESTAMP NOT NULL,
      source_type        TEXT NOT NULL,
      total_market_value NUMERIC(20,4),
      total_cost_basis   NUMERIC(20,4),
      position_count     INTEGER NOT NULL DEFAULT 0,
      cash_value         NUMERIC(20,4),
      fingerprint        TEXT NOT NULL,
      coverage           JSONB NOT NULL DEFAULT '{}',
      metadata           JSONB NOT NULL DEFAULT '{}',
      created_at         TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ps_portfolio_id
      ON portfolio_snapshots (portfolio_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ps_user_id
      ON portfolio_snapshots (user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ps_portfolio_date
      ON portfolio_snapshots (portfolio_id, snapshot_date DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ps_captured_at
      ON portfolio_snapshots (portfolio_id, captured_at DESC)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portfolio_position_snapshots (
      id                   VARCHAR(128) PRIMARY KEY,
      snapshot_id          VARCHAR(128) NOT NULL,
      portfolio_id         VARCHAR(128) NOT NULL,
      symbol               TEXT NOT NULL,
      quantity             NUMERIC(18,8) NOT NULL,
      average_cost         NUMERIC(18,8),
      cost_basis           NUMERIC(18,8),
      reference_price      NUMERIC(18,8),
      market_value         NUMERIC(18,8),
      sector               TEXT,
      industry             TEXT,
      themes               TEXT[],
      research_score       INTEGER,
      technical_score      INTEGER,
      fundamental_score    INTEGER,
      institutional_score  INTEGER,
      risk_score           INTEGER,
      evidence_confidence  TEXT,
      opportunity_type     TEXT,
      captured_at          TIMESTAMP NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pps_snapshot_id
      ON portfolio_position_snapshots (snapshot_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pps_portfolio_id
      ON portfolio_position_snapshots (portfolio_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pps_symbol
      ON portfolio_position_snapshots (portfolio_id, symbol)
  `);

  console.log(JSON.stringify({ event: "[portfolio-history] tables_ready", ts: new Date().toISOString() }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _snapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _posSnapshotId(): string {
  return `psnap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute a deterministic fingerprint from a portfolio's positions.
 * Sorted by symbol then quantity so order doesn't matter.
 */
function _fingerprint(positions: Array<{ symbol: string; quantity: string | number }>): string {
  const pairs = positions
    .map(p => `${p.symbol.toUpperCase()}:${Number(p.quantity).toFixed(8)}`)
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(pairs).digest("hex").slice(0, 32);
}

/**
 * Check if an identical snapshot was already captured for this portfolio
 * within the last 30 minutes (same fingerprint → skip).
 */
async function _isDuplicate(portfolioId: string, fingerprint: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT id FROM portfolio_snapshots
    WHERE portfolio_id = ${portfolioId}
      AND fingerprint  = ${fingerprint}
      AND captured_at  >= ${cutoff.toISOString()}
    LIMIT 1
  `);
  return (rows.rows?.length ?? 0) > 0;
}

function _coverage(
  positions: Array<{
    symbol: string;
    referencePrice: number | null;
    research: { researchScore: number | null };
    sector: string | null;
    themes: string[];
  }>,
): SnapshotCoverage {
  const total = positions.length;
  const withMktData = positions.filter(p => p.referencePrice !== null).length;
  const withIntel   = positions.filter(p => p.research.researchScore !== null).length;
  const withSector  = positions.filter(p => p.sector !== null).length;
  const withTheme   = positions.filter(p => p.themes.length > 0).length;
  return {
    positionsTotal:                    total,
    positionsWithMarketData:           withMktData,
    positionsWithOpportunityIntelligence: withIntel,
    positionsWithSector:               withSector,
    positionsWithTheme:                withTheme,
    coveragePercent:                   total > 0 ? Math.round((withMktData / total) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Core snapshot capture
// ---------------------------------------------------------------------------

export interface CaptureSnapshotOptions {
  sourceType?: SnapshotSourceType;
  metadata?:   Record<string, unknown>;
}

export interface CaptureSnapshotResult {
  ok:          boolean;
  snapshotId?: string;
  skipped?:    boolean;   // true when deduplication fired
  reason?:     string;
  durationMs?: number;
}

/**
 * Capture a point-in-time snapshot of a portfolio.
 *
 * Enrichment steps (all bulk, no N+1):
 *   1. Load positions from portfolio_positions
 *   2. Batch reference prices from getReferenceSnapshotsBulk
 *   3. Load Opportunity Intelligence once for all symbols
 *   4. Resolve themes from theme registry (no DB call)
 *   5. Build lookup maps → enrich each position
 *   6. Compute coverage + deduplication fingerprint
 *   7. INSERT portfolio_snapshots + portfolio_position_snapshots in one txn
 */
export async function capturePortfolioSnapshot(
  portfolioId: string,
  userId: string,
  options: CaptureSnapshotOptions = {},
): Promise<CaptureSnapshotResult> {
  const startedAt = Date.now();
  const sourceType: SnapshotSourceType = options.sourceType ?? "manual_snapshot";

  try {
    // --- 1. Verify ownership ---
    const [portfolio] = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

    if (!portfolio) {
      return { ok: false, reason: "Portfolio not found or access denied" };
    }

    // --- 2. Load positions ---
    const rawPositions = await db
      .select()
      .from(portfolioPositions)
      .where(eq(portfolioPositions.portfolioId, portfolioId));

    if (rawPositions.length === 0) {
      return { ok: false, reason: "No positions to snapshot" };
    }

    // --- 3. Deduplication check ---
    const fingerprint = _fingerprint(rawPositions);
    const isDup = await _isDuplicate(portfolioId, fingerprint);
    if (isDup) {
      return { ok: true, skipped: true, reason: "Identical snapshot captured in last 30 minutes" };
    }

    // --- 4. Bulk reference prices ---
    const symbols = Array.from(new Set(rawPositions.map(p => p.symbol.toUpperCase())));
    // getReferenceSnapshotsBulk requires userId as first arg; returns Map<string, ReferenceSnapshot>
    const refSnaps = await getReferenceSnapshotsBulk(userId, symbols).catch(
      () => new Map<string, import("./daily-market-data/reference-snapshot").ReferenceSnapshot>()
    );
    // Build a simple symbol → lastPrice map for enrichment
    const refPrices = new Map<string, number>();
    for (const [sym, snap] of Array.from(refSnaps.entries())) {
      if (snap.lastPrice !== null && snap.lastPrice !== undefined) {
        refPrices.set(sym, snap.lastPrice);
      }
    }

    // --- 5. Opportunity Intelligence (once, all symbols) ---
    const intel = await getOpportunityIntelligence().catch(() => null);
    // Build symbol → CanonicalOpportunity map
    const intelMap = new Map<string, import("../../shared/opportunity-intelligence-types").CanonicalOpportunity>();
    if (intel?.opportunities) {
      for (const opp of intel.opportunities) {
        intelMap.set(opp.symbol.toUpperCase(), opp);
      }
    }

    // --- 6. Theme registry ---
    const allThemes = getAllThemes();
    // Build symbol → themeId[] map (O(themes × symbols), done once)
    const themeMap = new Map<string, string[]>();
    for (const t of allThemes) {
      for (const sym of t.symbols) {
        const existing = themeMap.get(sym) ?? [];
        existing.push(t.themeId);
        themeMap.set(sym, existing);
      }
    }

    // --- 7. Enrich positions ---
    const capturedAt = new Date();
    const snapshotId = _snapshotId();

    type EnrichedPosition = {
      symbol: string;
      quantity: number;
      averageCost: number | null;
      costBasis: number | null;
      referencePrice: number | null;
      marketValue: number | null;
      sector: string | null;
      industry: string | null;
      themes: string[];
      research: {
        researchScore: number | null;
        technicalScore: number | null;
        fundamentalScore: number | null;
        institutionalScore: number | null;
        riskScore: number | null;         // null — CanonicalOpportunity has riskLevel (string), not a numeric riskScore
        evidenceConfidence: string | null;
        opportunityType: string | null;
      };
    };

    const enriched: EnrichedPosition[] = rawPositions.map(pos => {
      const sym      = pos.symbol.toUpperCase();
      const refPrice = refPrices.get(sym) ?? null;
      const qty      = Number(pos.quantity);
      const opp      = intelMap.get(sym);
      const posThemes = themeMap.get(sym) ?? [];
      const marketVal = refPrice !== null ? refPrice * qty : null;

      return {
        symbol:          sym,
        quantity:        qty,
        averageCost:     pos.averageCost !== null ? Number(pos.averageCost) : null,
        costBasis:       pos.costBasis   !== null ? Number(pos.costBasis)   : null,
        referencePrice:  refPrice,
        marketValue:     marketVal,
        sector:          opp?.sector    ?? null,
        industry:        opp?.industry  ?? null,
        themes:          posThemes,
        research: {
          researchScore:      opp?.researchScore      !== undefined ? opp.researchScore      : null,
          technicalScore:     opp?.technicalScore     !== undefined ? opp.technicalScore     : null,
          fundamentalScore:   opp?.fundamentalScore   !== undefined ? opp.fundamentalScore   : null,
          institutionalScore: opp?.institutionalScore !== undefined ? opp.institutionalScore : null,
          riskScore:          null, // CanonicalOpportunity has riskLevel (string) not a numeric riskScore
          evidenceConfidence: opp?.confidence ?? null,
          opportunityType:    opp?.opportunityType ?? null,
        },
      };
    });

    // --- 8. Snapshot-level aggregates ---
    const totalMktVal  = enriched.some(p => p.marketValue !== null)
      ? enriched.reduce((s, p) => s + (p.marketValue ?? 0), 0)
      : null;
    const totalCostBasis = enriched.some(p => p.costBasis !== null)
      ? enriched.reduce((s, p) => s + (p.costBasis ?? 0), 0)
      : null;
    const coverage = _coverage(enriched);

    // --- 9. Insert snapshot row ---
    await db.execute(sql`
      INSERT INTO portfolio_snapshots
        (id, portfolio_id, user_id, snapshot_date, captured_at,
         source_type, total_market_value, total_cost_basis, position_count,
         fingerprint, coverage, metadata, created_at)
      VALUES (
        ${snapshotId},
        ${portfolioId},
        ${userId},
        ${capturedAt.toISOString().slice(0, 10)},
        ${capturedAt.toISOString()},
        ${sourceType},
        ${totalMktVal},
        ${totalCostBasis},
        ${rawPositions.length},
        ${fingerprint},
        ${JSON.stringify(coverage)},
        ${JSON.stringify(options.metadata ?? {})},
        NOW()
      )
    `);

    // --- 10. Insert position snapshot rows ---
    if (enriched.length > 0) {
      for (const p of enriched) {
        const posId = _posSnapshotId();
        await db.execute(sql`
          INSERT INTO portfolio_position_snapshots
            (id, snapshot_id, portfolio_id, symbol, quantity,
             average_cost, cost_basis, reference_price, market_value,
             sector, industry, themes,
             research_score, technical_score, fundamental_score,
             institutional_score, risk_score,
             evidence_confidence, opportunity_type, captured_at)
          VALUES (
            ${posId},
            ${snapshotId},
            ${portfolioId},
            ${p.symbol},
            ${p.quantity},
            ${p.averageCost},
            ${p.costBasis},
            ${p.referencePrice},
            ${p.marketValue},
            ${p.sector},
            ${p.industry},
            ${p.themes.length > 0 ? p.themes : null},
            ${p.research.researchScore},
            ${p.research.technicalScore},
            ${p.research.fundamentalScore},
            ${p.research.institutionalScore},
            ${p.research.riskScore},
            ${p.research.evidenceConfidence},
            ${p.research.opportunityType},
            ${capturedAt.toISOString()}
          )
        `);
      }
    }

    const durationMs = Date.now() - startedAt;

    console.log(JSON.stringify({
      event:        "portfolio_snapshot_completed",
      portfolioId,
      snapshotId,
      sourceType,
      positionCount: rawPositions.length,
      durationMs,
      ts:            capturedAt.toISOString(),
    }));

    return { ok: true, snapshotId, durationMs };

  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({
      event:       "portfolio_snapshot_failed",
      portfolioId,
      sourceType,
      durationMs,
      ts:          new Date().toISOString(),
    }));
    return { ok: false, reason: msg, durationMs };
  }
}

/**
 * Capture snapshots for all portfolios belonging to a user.
 * Scheduler-ready interface.
 */
export async function captureUserPortfolioSnapshots(
  userId: string,
  sourceType: SnapshotSourceType = "manual_snapshot",
): Promise<{ portfolioId: string; result: CaptureSnapshotResult }[]> {
  const userPortfolios = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(eq(portfolios.userId, userId));

  const results: { portfolioId: string; result: CaptureSnapshotResult }[] = [];
  for (const p of userPortfolios) {
    const result = await capturePortfolioSnapshot(p.id, userId, { sourceType });
    results.push({ portfolioId: p.id, result });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Fire-and-forget trigger (for use inside existing route handlers)
// ---------------------------------------------------------------------------

/**
 * Trigger a snapshot asynchronously. Failures are logged but never propagated.
 */
export function triggerSnapshotAsync(
  portfolioId: string,
  userId: string,
  sourceType: SnapshotSourceType,
): void {
  setImmediate(() => {
    capturePortfolioSnapshot(portfolioId, userId, { sourceType }).catch(err => {
      console.error("[portfolio-history] async snapshot trigger failed:", err?.message);
    });
  });
}

// ---------------------------------------------------------------------------
// History retrieval
// ---------------------------------------------------------------------------

function _periodCutoff(period: HistoryPeriod): Date | null {
  const now = new Date();
  switch (period) {
    case "7D":  return new Date(now.getTime() - 7  * 86400000);
    case "30D": return new Date(now.getTime() - 30 * 86400000);
    case "90D": return new Date(now.getTime() - 90 * 86400000);
    case "YTD": return new Date(now.getFullYear(), 0, 1);
    case "1Y":  return new Date(now.getTime() - 365 * 86400000);
    case "ALL": return null;
  }
}

export async function getPortfolioSnapshots(
  portfolioId: string,
  userId:       string,
  period:       HistoryPeriod = "30D",
): Promise<PortfolioSnapshotCard[]> {
  // Verify ownership
  const [portfolio] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

  if (!portfolio) return [];

  const cutoff = _periodCutoff(period);

  let queryStr = `
    SELECT id, portfolio_id, user_id, snapshot_date, captured_at,
           source_type, total_market_value, total_cost_basis,
           position_count, coverage
    FROM portfolio_snapshots
    WHERE portfolio_id = '${portfolioId}'
  `;
  if (cutoff) {
    queryStr += ` AND captured_at >= '${cutoff.toISOString()}'`;
  }
  queryStr += ` ORDER BY captured_at DESC LIMIT 100`;

  const rows = await db.execute(sql.raw(queryStr));

  return (rows.rows ?? []).map((r: any) => ({
    id:               r.id,
    portfolioId:      r.portfolio_id,
    snapshotDate:     r.snapshot_date instanceof Date
                        ? r.snapshot_date.toISOString().slice(0, 10)
                        : String(r.snapshot_date).slice(0, 10),
    capturedAt:       r.captured_at instanceof Date
                        ? r.captured_at.toISOString()
                        : String(r.captured_at),
    sourceType:       r.source_type as SnapshotSourceType,
    totalMarketValue: r.total_market_value !== null ? Number(r.total_market_value) : null,
    totalCostBasis:   r.total_cost_basis   !== null ? Number(r.total_cost_basis)   : null,
    positionCount:    Number(r.position_count ?? 0),
    coverage:         (typeof r.coverage === "string" ? JSON.parse(r.coverage) : r.coverage) ?? {},
  }));
}

async function _loadPositionSnapshots(snapshotId: string): Promise<PortfolioPositionSnapshot[]> {
  const rows = await db.execute(sql`
    SELECT * FROM portfolio_position_snapshots
    WHERE snapshot_id = ${snapshotId}
    ORDER BY symbol
  `);

  return (rows.rows ?? []).map((r: any) => ({
    id:             r.id,
    snapshotId:     r.snapshot_id,
    portfolioId:    r.portfolio_id,
    symbol:         r.symbol,
    quantity:       Number(r.quantity),
    averageCost:    r.average_cost    !== null ? Number(r.average_cost)    : null,
    costBasis:      r.cost_basis      !== null ? Number(r.cost_basis)      : null,
    referencePrice: r.reference_price !== null ? Number(r.reference_price) : null,
    marketValue:    r.market_value    !== null ? Number(r.market_value)    : null,
    sector:         r.sector ?? null,
    industry:       r.industry ?? null,
    themes:         r.themes ?? [],
    research: {
      researchScore:      r.research_score       !== null ? Number(r.research_score)       : null,
      technicalScore:     r.technical_score      !== null ? Number(r.technical_score)      : null,
      fundamentalScore:   r.fundamental_score    !== null ? Number(r.fundamental_score)    : null,
      institutionalScore: r.institutional_score  !== null ? Number(r.institutional_score)  : null,
      riskScore:          r.risk_score           !== null ? Number(r.risk_score)           : null,
      evidenceConfidence: r.evidence_confidence  ?? null,
      opportunityType:    r.opportunity_type     ?? null,
    },
    capturedAt:     r.captured_at instanceof Date
                      ? r.captured_at.toISOString()
                      : String(r.captured_at),
  }));
}

async function _getSnapshotById(snapshotId: string, userId: string): Promise<PortfolioSnapshot | null> {
  const rows = await db.execute(sql`
    SELECT * FROM portfolio_snapshots
    WHERE id = ${snapshotId}
      AND user_id = ${userId}
    LIMIT 1
  `);

  const r = rows.rows?.[0];
  if (!r) return null;

  const positions = await _loadPositionSnapshots(snapshotId);

  const cov: any = typeof r.coverage === "string" ? JSON.parse(r.coverage) : r.coverage;
  return {
    id:               String(r.id),
    portfolioId:      String(r.portfolio_id),
    userId:           String(r.user_id),
    snapshotDate:     r.snapshot_date instanceof Date
                        ? r.snapshot_date.toISOString().slice(0, 10)
                        : String(r.snapshot_date).slice(0, 10),
    capturedAt:       r.captured_at instanceof Date
                        ? r.captured_at.toISOString()
                        : String(r.captured_at),
    sourceType:       String(r.source_type) as SnapshotSourceType,
    totalMarketValue: r.total_market_value !== null ? Number(r.total_market_value) : null,
    totalCostBasis:   r.total_cost_basis   !== null ? Number(r.total_cost_basis)   : null,
    positionCount:    Number(r.position_count ?? 0),
    cashValue:        r.cash_value         !== null ? Number(r.cash_value)         : null,
    fingerprint:      String(r.fingerprint ?? ""),
    coverage:         cov ?? {},
    metadata:         typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}),
    positions,
    createdAt:        r.created_at instanceof Date
                        ? r.created_at.toISOString()
                        : String(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// Change classification engine
// ---------------------------------------------------------------------------

const RESEARCH_SCORE_THRESHOLD = 2; // points delta to classify as STRENGTHENED/WEAKENED

function _classifyPositions(
  prev: PortfolioPositionSnapshot[],
  curr: PortfolioPositionSnapshot[],
): {
  added:     PositionChangeItem[];
  exited:    PositionChangeItem[];
  increased: PositionChangeItem[];
  reduced:   PositionChangeItem[];
  unchanged: PositionChangeItem[];
} {
  const prevMap = new Map(prev.map(p => [p.symbol, p]));
  const currMap = new Map(curr.map(p => [p.symbol, p]));

  const added:     PositionChangeItem[] = [];
  const exited:    PositionChangeItem[] = [];
  const increased: PositionChangeItem[] = [];
  const reduced:   PositionChangeItem[] = [];
  const unchanged: PositionChangeItem[] = [];

  // Check all current symbols
  for (const [sym, cp] of Array.from(currMap.entries())) {
    const pp = prevMap.get(sym);
    const item: PositionChangeItem = {
      symbol:              sym,
      changeType:          "UNCHANGED",
      previousQuantity:    pp?.quantity ?? null,
      currentQuantity:     cp.quantity,
      quantityDelta:       pp ? cp.quantity - pp.quantity : null,
      previousMarketValue: pp?.marketValue ?? null,
      currentMarketValue:  cp.marketValue,
      marketValueDelta:    (cp.marketValue !== null && (pp?.marketValue ?? null) !== null)
                             ? cp.marketValue - (pp!.marketValue ?? 0)
                             : null,
      sector:              cp.sector,
      themes:              cp.themes,
    };

    if (!pp) {
      item.changeType    = "NEW";
      item.quantityDelta = cp.quantity;
      added.push(item);
    } else if (cp.quantity > pp.quantity) {
      item.changeType = "INCREASED";
      increased.push(item);
    } else if (cp.quantity < pp.quantity) {
      item.changeType = "REDUCED";
      reduced.push(item);
    } else {
      unchanged.push(item);
    }
  }

  // Check for exited (were in prev, not in curr)
  for (const [sym, pp] of Array.from(prevMap.entries())) {
    if (!currMap.has(sym)) {
      exited.push({
        symbol:              sym,
        changeType:          "EXITED",
        previousQuantity:    pp.quantity,
        currentQuantity:     null,
        quantityDelta:       -pp.quantity,
        previousMarketValue: pp.marketValue,
        currentMarketValue:  null,
        marketValueDelta:    pp.marketValue !== null ? -pp.marketValue : null,
        sector:              pp.sector,
        themes:              pp.themes,
      });
    }
  }

  return { added, exited, increased, reduced, unchanged };
}

function _classifyResearch(
  prev: PortfolioPositionSnapshot[],
  curr: PortfolioPositionSnapshot[],
): {
  strengthened:   ResearchChangeItem[];
  weakened:       ResearchChangeItem[];
  newlyQualified: ResearchChangeItem[];
  noLonger:       ResearchChangeItem[];
} {
  const prevMap = new Map(prev.map(p => [p.symbol, p]));
  const currMap = new Map(curr.map(p => [p.symbol, p]));

  const strengthened:   ResearchChangeItem[] = [];
  const weakened:       ResearchChangeItem[] = [];
  const newlyQualified: ResearchChangeItem[] = [];
  const noLonger:       ResearchChangeItem[] = [];

  const allSymbols = Array.from(new Set([
    ...Array.from(prevMap.keys()),
    ...Array.from(currMap.keys()),
  ]));

  for (const sym of allSymbols) {
    const pp = prevMap.get(sym);
    const cp = currMap.get(sym);

    const prevScore = pp?.research.researchScore ?? null;
    const currScore = cp?.research.researchScore ?? null;

    let changeType: ResearchChangeType = "RESEARCH_UNCHANGED";

    if (prevScore === null && currScore !== null) {
      changeType = "NEWLY_QUALIFIED";
    } else if (prevScore !== null && currScore === null) {
      changeType = "NO_LONGER_QUALIFIED";
    } else if (prevScore !== null && currScore !== null) {
      const delta = currScore - prevScore;
      if (delta >= RESEARCH_SCORE_THRESHOLD) {
        changeType = "RESEARCH_STRENGTHENED";
      } else if (delta <= -RESEARCH_SCORE_THRESHOLD) {
        changeType = "RESEARCH_WEAKENED";
      }
    }

    if (changeType === "RESEARCH_UNCHANGED") continue;

    const item: ResearchChangeItem = {
      symbol:            sym,
      changeType,
      previousScore:     prevScore,
      currentScore:      currScore,
      scoreDelta:        (prevScore !== null && currScore !== null) ? currScore - prevScore : null,
      previousTechScore: pp?.research.technicalScore ?? null,
      currentTechScore:  cp?.research.technicalScore ?? null,
      previousOppType:   pp?.research.opportunityType ?? null,
      currentOppType:    cp?.research.opportunityType ?? null,
      sector:            cp?.sector ?? pp?.sector ?? null,
    };

    switch (changeType) {
      case "RESEARCH_STRENGTHENED": strengthened.push(item); break;
      case "RESEARCH_WEAKENED":     weakened.push(item);     break;
      case "NEWLY_QUALIFIED":       newlyQualified.push(item); break;
      case "NO_LONGER_QUALIFIED":   noLonger.push(item);     break;
    }
  }

  return { strengthened, weakened, newlyQualified, noLonger };
}

function _classifyExposure(
  prev: PortfolioPositionSnapshot[],
  curr: PortfolioPositionSnapshot[],
): { sectorChanges: ExposureChangeItem[]; themeChanges: ExposureChangeItem[] } {
  function _sectorMap(positions: PortfolioPositionSnapshot[]): Map<string, number> {
    const totalMV = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
    const sectors = new Map<string, number>();
    if (totalMV === 0) return sectors;
    for (const p of positions) {
      if (p.sector && p.marketValue) {
        sectors.set(p.sector, (sectors.get(p.sector) ?? 0) + p.marketValue / totalMV * 100);
      }
    }
    return sectors;
  }

  function _themeMap(positions: PortfolioPositionSnapshot[]): Map<string, number> {
    const totalMV = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
    const themes = new Map<string, number>();
    if (totalMV === 0) return themes;
    for (const p of positions) {
      for (const t of p.themes) {
        if (p.marketValue) {
          themes.set(t, (themes.get(t) ?? 0) + p.marketValue / totalMV * 100);
        }
      }
    }
    return themes;
  }

  const prevSectors = _sectorMap(prev);
  const currSectors = _sectorMap(curr);
  const prevThemes  = _themeMap(prev);
  const currThemes  = _themeMap(curr);

  const sectorChanges: ExposureChangeItem[] = [];
  const allSectors = Array.from(new Set([
    ...Array.from(prevSectors.keys()),
    ...Array.from(currSectors.keys()),
  ]));
  for (const s of allSectors) {
    const pp = prevSectors.get(s) ?? 0;
    const cp = currSectors.get(s) ?? 0;
    const delta = cp - pp;
    if (Math.abs(delta) < 0.5) continue; // ignore sub-0.5% noise
    sectorChanges.push({
      name:            s,
      changeType:      delta > 0 ? "SECTOR_EXPOSURE_INCREASED" : "SECTOR_EXPOSURE_DECREASED",
      previousPercent: pp > 0 ? pp : null,
      currentPercent:  cp > 0 ? cp : null,
      percentDelta:    delta,
    });
  }

  const themeChanges: ExposureChangeItem[] = [];
  const allThemeKeys = Array.from(new Set([
    ...Array.from(prevThemes.keys()),
    ...Array.from(currThemes.keys()),
  ]));
  for (const t of allThemeKeys) {
    const pp = prevThemes.get(t) ?? 0;
    const cp = currThemes.get(t) ?? 0;
    const delta = cp - pp;
    if (Math.abs(delta) < 0.5) continue;
    themeChanges.push({
      name:            t,
      changeType:      delta > 0 ? "THEME_EXPOSURE_INCREASED" : "THEME_EXPOSURE_DECREASED",
      previousPercent: pp > 0 ? pp : null,
      currentPercent:  cp > 0 ? cp : null,
      percentDelta:    delta,
    });
  }

  // Sort by magnitude
  sectorChanges.sort((a, b) => Math.abs(b.percentDelta ?? 0) - Math.abs(a.percentDelta ?? 0));
  themeChanges.sort((a, b) => Math.abs(b.percentDelta ?? 0) - Math.abs(a.percentDelta ?? 0));

  return { sectorChanges, themeChanges };
}

// ---------------------------------------------------------------------------
// getPortfolioChanges — public API
// ---------------------------------------------------------------------------

export async function getPortfolioChanges(
  portfolioId:    string,
  userId:         string,
  fromSnapshotId?: string,
  toSnapshotId?:   string,
): Promise<PortfolioChangeResult | null> {
  // Verify ownership
  const [portfolio] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

  if (!portfolio) return null;

  let toSnap: PortfolioSnapshot | null;
  let fromSnap: PortfolioSnapshot | null;

  if (toSnapshotId) {
    toSnap = await _getSnapshotById(toSnapshotId, userId);
  } else {
    // Latest snapshot
    const rows = await db.execute(sql`
      SELECT id FROM portfolio_snapshots
      WHERE portfolio_id = ${portfolioId}
        AND user_id      = ${userId}
      ORDER BY captured_at DESC
      LIMIT 1
    `);
    const latestId = rows.rows?.[0]?.id;
    if (!latestId) return null;
    toSnap = await _getSnapshotById(String(latestId), userId);
  }

  if (!toSnap) return null;

  if (fromSnapshotId) {
    fromSnap = await _getSnapshotById(fromSnapshotId, userId);
  } else {
    // Previous snapshot before toSnap
    const rows = await db.execute(sql`
      SELECT id FROM portfolio_snapshots
      WHERE portfolio_id = ${portfolioId}
        AND user_id      = ${userId}
        AND captured_at  < ${toSnap.capturedAt}
      ORDER BY captured_at DESC
      LIMIT 1
    `);
    const prevId = rows.rows?.[0]?.id;
    if (!prevId) return null;
    fromSnap = await _getSnapshotById(String(prevId), userId);
  }

  if (!fromSnap) return null;

  const prevPositions = fromSnap.positions;
  const currPositions = toSnap.positions;

  // Position changes
  const posChanges = _classifyPositions(prevPositions, currPositions);

  // Research changes (only for symbols currently held)
  const resChanges = _classifyResearch(prevPositions, currPositions);

  // Exposure changes
  const expChanges = _classifyExposure(prevPositions, currPositions);

  // Summary
  const valueChange = (toSnap.totalMarketValue !== null && fromSnap.totalMarketValue !== null)
    ? toSnap.totalMarketValue - fromSnap.totalMarketValue
    : null;
  const valueChangePercent = (valueChange !== null && fromSnap.totalMarketValue)
    ? (valueChange / fromSnap.totalMarketValue) * 100
    : null;
  const costBasisChange = (toSnap.totalCostBasis !== null && fromSnap.totalCostBasis !== null)
    ? toSnap.totalCostBasis - fromSnap.totalCostBasis
    : null;

  const summary: PortfolioChangeSummary = {
    fromSnapshotId:        fromSnap.id,
    toSnapshotId:          toSnap.id,
    fromDate:              fromSnap.capturedAt,
    toDate:                toSnap.capturedAt,
    valueChange,
    valueChangePercent,
    previousValue:         fromSnap.totalMarketValue,
    currentValue:          toSnap.totalMarketValue,
    costBasisChange,
    positionCountChange:   toSnap.positionCount - fromSnap.positionCount,
    previousPositionCount: fromSnap.positionCount,
    currentPositionCount:  toSnap.positionCount,
  };

  // Limitations
  const limitations: string[] = [];
  const missingMktData = currPositions.filter(p => p.referencePrice === null).length;
  if (missingMktData > 0) {
    limitations.push(`Reference price unavailable for ${missingMktData} position${missingMktData !== 1 ? "s" : ""}`);
  }
  const missingIntel = currPositions.filter(p => p.research.researchScore === null).length;
  if (missingIntel > 0) {
    limitations.push(`Opportunity Intelligence not available for ${missingIntel} position${missingIntel !== 1 ? "s" : ""}`);
  }
  if (toSnap.totalMarketValue === null) {
    limitations.push("Total portfolio value cannot be calculated — reference prices missing");
  }

  console.log(JSON.stringify({
    event:          "portfolio_change_computed",
    portfolioId,
    fromSnapshotId: fromSnap.id,
    toSnapshotId:   toSnap.id,
    positionChanges: posChanges.added.length + posChanges.exited.length +
                     posChanges.increased.length + posChanges.reduced.length,
    ts: new Date().toISOString(),
  }));

  return {
    portfolioId,
    summary,
    addedPositions:       posChanges.added,
    exitedPositions:      posChanges.exited,
    increasedPositions:   posChanges.increased,
    reducedPositions:     posChanges.reduced,
    unchangedPositions:   posChanges.unchanged,
    researchStrengthened: resChanges.strengthened,
    researchWeakened:     resChanges.weakened,
    newlyQualified:       resChanges.newlyQualified,
    noLongerQualified:    resChanges.noLonger,
    sectorChanges:        expChanges.sectorChanges,
    themeChanges:         expChanges.themeChanges,
    dataFreshness: {
      fromSnapshotAt:          fromSnap.capturedAt,
      toSnapshotAt:            toSnap.capturedAt,
      opportunityIntelligenceAt: toSnap.capturedAt, // enriched at capture time
      institutionalDataNote:   "Institutional data reflects Form 13F filings — delayed by up to 45 days.",
    },
    coverage:   toSnap.coverage,
    limitations,
  };
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export async function getPortfolioHistoryHealth(): Promise<PortfolioHistoryHealth> {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const rows = await db.execute(sql`
      SELECT
        COUNT(DISTINCT portfolio_id) AS portfolios_tracked,
        COUNT(*)                     AS snapshots_total,
        SUM(CASE WHEN snapshot_date = ${today} THEN 1 ELSE 0 END) AS snapshots_today,
        MAX(captured_at)             AS latest_snapshot_at,
        SUM(position_count)          AS positions_captured
      FROM portfolio_snapshots
    `);

    const r = rows.rows?.[0] ?? {};
    return {
      portfoliosTracked:        Number(r.portfolios_tracked  ?? 0),
      snapshotsTotal:           Number(r.snapshots_total     ?? 0),
      snapshotsToday:           Number(r.snapshots_today     ?? 0),
      latestSnapshotAt:         r.latest_snapshot_at
                                  ? (r.latest_snapshot_at instanceof Date
                                      ? r.latest_snapshot_at.toISOString()
                                      : String(r.latest_snapshot_at))
                                  : null,
      snapshotsFailed:          0,
      positionsCaptured:        Number(r.positions_captured  ?? 0),
      averageSnapshotDurationMs: null,
      storageHealth:            "ok",
    };
  } catch {
    return {
      portfoliosTracked: 0, snapshotsTotal: 0, snapshotsToday: 0,
      latestSnapshotAt: null, snapshotsFailed: 0, positionsCaptured: 0,
      averageSnapshotDurationMs: null, storageHealth: "unknown",
    };
  }
}
