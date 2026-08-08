// Intelligence Orchestrator — Sprint 2.3.3
//
// Fetches all required data from the DB and in-memory ranking, then invokes
// sector and theme intelligence engines, and persists the results.
//
// Called fire-and-forget from opportunity-engine.ts after ranking completes.
// Never throws — failures are logged and skipped.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { symbols as symbolsTable, institutionalSymbolSignals } from "../../shared/schema";
import { getLatestRanking } from "./opportunity-ranking-engine";
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
  const rows = await db.execute<{ ticker: string; sector: string | null; industry: string | null }>(
    sql`SELECT ticker, sector, industry FROM symbols WHERE sector IS NOT NULL AND is_active = true`,
  );
  return rows.rows
    .filter(r => r.sector)
    .map(r => ({ symbol: r.ticker, sector: r.sector!, industry: r.industry ?? null }));
}

// ---------------------------------------------------------------------------
// Load institutional signals from DB
// ---------------------------------------------------------------------------

async function loadInstitutionalSignals(): Promise<InstitutionalSignalSummary[]> {
  const rows = await db.execute<{ symbol: string; label: string; score: number | null }>(
    sql`
      SELECT DISTINCT ON (symbol) symbol, label, score
      FROM institutional_symbol_signals
      WHERE status = 'active'
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
// Main orchestration entry point
// ---------------------------------------------------------------------------

export async function runIntelligencePrecomputation(): Promise<void> {
  const startedAt = Date.now();

  structuredLog("info", { event: "intelligence_precomputation_started" });

  try {
    const ranking = getLatestRanking();
    if (!ranking) {
      structuredLog("info", {
        event: "intelligence_precomputation_skipped",
        reason: "no_ranking_available",
      });
      return;
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

    // Persist both (non-blocking — failures are caught below)
    await Promise.all([
      saveSectorSnapshot(sectorSnapshot),
      saveThemeSnapshot(themeSnapshot),
    ]);

    structuredLog("info", {
      event:        "intelligence_precomputation_completed",
      sectorCount:  sectorSnapshot.sectors.length,
      themeCount:   themeSnapshot.themes.length,
      rankedCount:  rankedSymbols.length,
      durationMs:   Date.now() - startedAt,
    });
  } catch (err: any) {
    structuredLog("warn", {
      event:   "intelligence_precomputation_failed",
      error:   String(err?.message ?? err).slice(0, 300),
      durationMs: Date.now() - startedAt,
    });
  }
}
