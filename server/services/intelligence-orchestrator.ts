// Intelligence Orchestrator — Sprint 2.3.3 / updated 2.3.6
//
// Fetches all required data from the DB and in-memory ranking, then invokes
// sector and theme intelligence engines, and persists the results.
//
// Called fire-and-forget from opportunity-engine.ts after ranking completes.
// Never throws — failures are logged and skipped.
//
// Sprint 2.3.6 fix: loadSymbolSectors() now reads from market_data_symbols
// (the active-symbol source of truth) joined with symbols for sector/industry,
// replacing the old query that only read from symbols WHERE sector IS NOT NULL
// (which returned 0 rows when the symbols table was empty).

import { db } from "../db";
import { sql } from "drizzle-orm";
import { institutionalSymbolSignals } from "../../shared/schema";
import {
  computeRankingForSnapshot,
  getLatestRanking,
} from "./opportunity-ranking-engine";
import { getLatestValidSnapshot } from "./opportunity-snapshot-store";
import { getAllThemes } from "../config/theme-registry";
import {
  computeSectorSnapshot,
  type RankedSymbolSummary,
  type InstitutionalSignalSummary,
  type SymbolSectorInfo,
} from "./sector-intelligence-engine";
import { computeThemeSnapshot } from "./theme-intelligence-engine";
import {
  saveSectorSnapshot,
  saveThemeSnapshot,
  getPreviousSectorScores,
  getPreviousThemeScores,
} from "./intelligence-snapshot-store";

function structuredLog(level: "info" | "warn" | "error", obj: Record<string, unknown>): void {
  const line = JSON.stringify(obj);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// Build ranked symbol summaries from the latest ranking
// ---------------------------------------------------------------------------

function buildRankedSummaries(ranking: ReturnType<typeof getLatestRanking>): RankedSymbolSummary[] {
  if (!ranking) return [];

  const result: RankedSymbolSummary[] = [];

  const addCandidate = (
    c: { symbol: string; opportunityScore: { overallScore: number; technicalScore: number; institutionalScore: number; fundamentalScore: number; riskScore: number; confidence: string; category: string }; changeDirection?: string },
    changeDirection: RankedSymbolSummary["changeDirection"],
  ) => {
    result.push({
      symbol:            c.symbol,
      overallScore:      c.opportunityScore.overallScore,
      technicalScore:    c.opportunityScore.technicalScore,
      institutionalScore: c.opportunityScore.institutionalScore,
      fundamentalScore:  c.opportunityScore.fundamentalScore,
      riskScore:         c.opportunityScore.riskScore,
      confidence:        c.opportunityScore.confidence,
      category:          c.opportunityScore.category,
      changeDirection,
    });
  };

  // Derive change direction from the changes array
  const changeMap = new Map<string, "upgraded" | "downgraded" | "new" | "moved">();
  if (ranking.changes) {
    for (const ch of ranking.changes) {
      if (ch.direction === "new") changeMap.set(ch.symbol, "new");
      else if (ch.direction === "upgraded") changeMap.set(ch.symbol, "upgraded");
      else if (ch.direction === "downgraded") changeMap.set(ch.symbol, "downgraded");
      else if (ch.direction === "moved") changeMap.set(ch.symbol, "moved");
    }
  }

  for (const c of [...(ranking.topGrowth ?? []), ...(ranking.topIncome ?? [])]) {
    const dir = changeMap.get(c.symbol) ?? null;
    addCandidate(c as any, dir);
  }

  // Watchlist members — include without change direction
  for (const c of [...(ranking.watchlist ?? []), ...(ranking.approaching ?? [])]) {
    if (!result.find(r => r.symbol === c.symbol)) {
      result.push({
        symbol:            c.symbol,
        overallScore:      (c as any).opportunityScore?.overallScore ?? 0,
        technicalScore:    (c as any).opportunityScore?.technicalScore ?? 0,
        institutionalScore: (c as any).opportunityScore?.institutionalScore ?? 0,
        fundamentalScore:  (c as any).opportunityScore?.fundamentalScore ?? 0,
        riskScore:         (c as any).opportunityScore?.riskScore ?? 0,
        confidence:        (c as any).opportunityScore?.confidence ?? "low",
        category:          (c as any).opportunityScore?.category ?? "Watch",
        changeDirection:   null,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Load sector classification from DB
// ---------------------------------------------------------------------------

async function loadSymbolSectors(): Promise<SymbolSectorInfo[]> {
  // Sprint 2.3.6: read from market_data_symbols (active-symbol source of truth)
  // and LEFT JOIN symbols for sector/industry metadata.
  // Also accepts sector directly on market_data_symbols (populated by symbol enrichment).
  const rows = await db.execute<{ symbol: string; sector: string | null; industry: string | null }>(sql`
    SELECT
      m.symbol,
      COALESCE(NULLIF(m.sector, ''), NULLIF(s.sector, ''))       AS sector,
      COALESCE(NULLIF(s.industry, ''), NULL)                      AS industry
    FROM market_data_symbols m
    LEFT JOIN symbols s ON s.ticker = m.symbol
    WHERE m.enabled = true
      AND COALESCE(NULLIF(m.sector, ''), NULLIF(s.sector, '')) IS NOT NULL
    ORDER BY m.symbol
  `);

  const result = rows.rows
    .filter(r => r.sector && r.sector.trim() !== "")
    .map(r => ({
      symbol:   r.symbol,
      sector:   r.sector!,
      industry: r.industry ?? null,
    }));

  structuredLog("info", {
    event:             "symbol_sectors_loaded",
    count:             result.length,
    withSector:        result.length,
    withIndustry:      result.filter(r => r.industry).length,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Load institutional signals from DB
// ---------------------------------------------------------------------------

async function loadInstitutionalSignals(): Promise<InstitutionalSignalSummary[]> {
  const rows = await db.execute<{ symbol: string; label: string; score: number | null }>(
    sql`
      SELECT DISTINCT ON (symbol) symbol, label, score
      FROM institutional_symbol_signals
      WHERE status = 'available'
      ORDER BY symbol, calculated_at DESC
    `,
  );
  return rows.rows.map(r => ({
    symbol: r.symbol,
    label:  r.label,
    score:  r.score,
  }));
}

// ---------------------------------------------------------------------------
// In-memory precomputation status — exported for diagnostics
// ---------------------------------------------------------------------------

interface PrecomputationStatus {
  lastAttemptAt:    string | null;
  lastSuccessAt:    string | null;
  lastErrorMessage: string | null;
  lastSectorCount:  number | null;
  lastThemeCount:   number | null;
  lastRankedCount:  number | null;
  running:          boolean;
}

export type IntelligencePrecomputationResult =
  | { status: "completed"; sectorCount: number; themeCount: number; rankedCount: number; persisted: boolean; durationMs: number }
  | { status: "blocked"; reason: "no_ranking_available"; durationMs: number }
  | { status: "failed"; error: string; durationMs: number };

const _precomputeStatus: PrecomputationStatus = {
  lastAttemptAt:    null,
  lastSuccessAt:    null,
  lastErrorMessage: null,
  lastSectorCount:  null,
  lastThemeCount:   null,
  lastRankedCount:  null,
  running:          false,
};

/** Read-only snapshot of precomputation status — safe to expose in admin diagnostics. */
export function getPrecomputationStatus(): Readonly<PrecomputationStatus> {
  return { ..._precomputeStatus };
}

// ---------------------------------------------------------------------------
// Main orchestration entry point
// ---------------------------------------------------------------------------

export async function runIntelligencePrecomputation(
  options: { persist?: boolean } = {},
): Promise<IntelligencePrecomputationResult> {
  const persist = options.persist !== false;
  const startedAt = Date.now();
  _precomputeStatus.lastAttemptAt = new Date().toISOString();
  _precomputeStatus.running       = true;
  _precomputeStatus.lastErrorMessage = null;

  structuredLog("info", { event: "intelligence_precomputation_started" });

  try {
    let ranking = getLatestRanking();
    if (!ranking) {
      const persistedSnapshot = await getLatestValidSnapshot();
      if (persistedSnapshot) {
        ranking = await computeRankingForSnapshot(persistedSnapshot, null);
        structuredLog("info", {
          event: "intelligence_precomputation_ranking_restored",
          snapshotId: persistedSnapshot.id,
          completedAt: persistedSnapshot.completedAt,
        });
      }
    }
    if (!ranking) {
      structuredLog("info", {
        event: "intelligence_precomputation_skipped",
        reason: "no_ranking_available",
      });
      _precomputeStatus.running = false;
      return {
        status: "blocked",
        reason: "no_ranking_available",
        durationMs: Date.now() - startedAt,
      };
    }

    const [symbolSectors, institutionalSignals, prevSectorMap, prevThemeMap] = await Promise.all([
      loadSymbolSectors(),
      loadInstitutionalSignals(),
      getPreviousSectorScores(),
      getPreviousThemeScores(),
    ]);

    const rankedSymbols = buildRankedSummaries(ranking);
    const generatedAt   = new Date().toISOString();
    const regime        = ranking.regime ?? null;
    const themes        = getAllThemes();

    // Compute sector intelligence
    const sectorSnapshot = computeSectorSnapshot({
      rankedSymbols,
      symbolSectors,
      institutionalSignals,
      prevSectorSnapshot: prevSectorMap,
      regime,
      generatedAt,
    });

    // Compute theme intelligence
    const themeSnapshot = computeThemeSnapshot({
      themes,
      rankedSymbols,
      institutionalSignals,
      prevThemeSnapshot: prevThemeMap,
      regime,
      generatedAt,
    });

    if (persist) {
      await Promise.all([
        saveSectorSnapshot(sectorSnapshot),
        saveThemeSnapshot(themeSnapshot),
      ]);
    }

    _precomputeStatus.lastSuccessAt   = new Date().toISOString();
    _precomputeStatus.lastSectorCount = sectorSnapshot.sectors.length;
    _precomputeStatus.lastThemeCount  = themeSnapshot.themes.length;
    _precomputeStatus.lastRankedCount = rankedSymbols.length;

    structuredLog("info", {
      event:        "intelligence_precomputation_completed",
      sectorCount:  sectorSnapshot.sectors.length,
      themeCount:   themeSnapshot.themes.length,
      rankedCount:  rankedSymbols.length,
      durationMs:   Date.now() - startedAt,
    });
    return {
      status: "completed",
      sectorCount: sectorSnapshot.sectors.length,
      themeCount: themeSnapshot.themes.length,
      rankedCount: rankedSymbols.length,
      persisted: persist,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 300);
    _precomputeStatus.lastErrorMessage = msg;
    structuredLog("warn", {
      event:      "intelligence_precomputation_failed",
      error:      msg,
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "failed",
      error: msg,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    _precomputeStatus.running = false;
  }
}
