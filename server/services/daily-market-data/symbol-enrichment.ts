// Symbol Enrichment — Sprint 2.3.6
//
// Populates sector and industry metadata for active market_data_symbols rows
// that are missing classifications.
//
// Uses the Twelve Data /profile endpoint (1 credit/request) to fetch sector,
// industry, company name, and exchange. Only fills missing values; never
// overwrites non-empty sector classifications without explicit forceAll flag.
//
// Idempotent, batch-safe, rate-limit-aware, and retry-safe.
//
// POST /api/admin/symbols/enrich  — triggers enrichment (admin only)

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getTwelveDataConfig, redactApiKey } from "./config";
import { reserveCreditsBlocking, logProviderRequest } from "./credit-manager";

const BASE_URL = "https://api.twelvedata.com";
const PROFILE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolEnrichmentResult {
  requested:   number;
  enriched:    number;
  skipped:     number;
  failed:      number;
  noop:        number;   // already had sector — skipped per policy
  symbols:     Array<{ symbol: string; sector: string | null; industry: string | null; status: "enriched" | "failed" | "noop" }>;
  coverageBefore: { total: number; withSector: number; pct: number };
  coverageAfter:  { total: number; withSector: number; pct: number };
}

interface TwelveDataProfile {
  symbol?:   string;
  name?:     string;
  sector?:   string;
  industry?: string;
  exchange?: string;
  type?:     string;
  status?:   string;
  message?:  string;
}

// ---------------------------------------------------------------------------
// Coverage helper
// ---------------------------------------------------------------------------

async function getCoverage(): Promise<{ total: number; withSector: number; pct: number }> {
  const row = await db.execute<{ total: string; with_sector: string }>(sql`
    SELECT
      COUNT(*)::text                                                     AS total,
      COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::text AS with_sector
    FROM market_data_symbols
    WHERE enabled = true
  `);
  const total      = parseInt(row.rows[0]?.total ?? "0", 10);
  const withSector = parseInt(row.rows[0]?.with_sector ?? "0", 10);
  return { total, withSector, pct: total > 0 ? Math.round((withSector / total) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Twelve Data /profile fetch
// ---------------------------------------------------------------------------

async function fetchProfile(symbol: string, apiKey: string): Promise<TwelveDataProfile | null> {
  const qs = new URLSearchParams({ symbol: symbol.toUpperCase(), apikey: apiKey });
  const url = `${BASE_URL}/profile?${qs.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);

  const started = Date.now();
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const durationMs = Date.now() - started;
    const text = await resp.text();
    let data: TwelveDataProfile;
    try { data = JSON.parse(text); } catch { data = {}; }

    const ok = resp.ok && data.status !== "error" && !data.message?.includes("error");
    await logProviderRequest({
      endpoint:         "/profile",
      symbolsRequested: [symbol],
      creditsUsed:      1,
      status:           ok ? "success" : "error",
      durationMs,
      caller:           "symbol-enrichment",
      errorCode:        ok ? null : (data.message?.slice(0, 80) ?? null),
    });
    return ok ? data : null;
  } catch (err: any) {
    clearTimeout(timer);
    await logProviderRequest({
      endpoint: "/profile", symbolsRequested: [symbol], creditsUsed: 1,
      status: "error", caller: "symbol-enrichment", errorCode: err?.name ?? "FETCH_ERROR",
    }).catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main enrichment function
// ---------------------------------------------------------------------------

export async function enrichMissingSymbolClassifications(options?: {
  forceAll?: boolean;
  symbols?:  string[];
}): Promise<SymbolEnrichmentResult> {
  const cfg = getTwelveDataConfig();
  if (!cfg.enabled || !cfg.apiKey) {
    console.warn("[symbol-enrichment] Twelve Data not configured — skipping enrichment");
    const cv = await getCoverage();
    return { requested: 0, enriched: 0, skipped: 0, failed: 0, noop: 0, symbols: [], coverageBefore: cv, coverageAfter: cv };
  }

  const coverageBefore = await getCoverage();
  console.log(`[symbol-enrichment] coverage_before total=${coverageBefore.total} withSector=${coverageBefore.withSector} pct=${coverageBefore.pct}%`);

  // Determine candidate symbols
  let candidates: Array<{ symbol: string; currentSector: string | null }>;

  if (options?.symbols?.length) {
    // Explicit list
    const rows = await db.execute<{ symbol: string; sector: string | null }>(sql`
      SELECT symbol, sector FROM market_data_symbols
      WHERE symbol = ANY(ARRAY[${sql.raw(options.symbols.map(s => `'${s.replace(/'/g, "''")}'`).join(","))}])
      AND enabled = true
    `);
    candidates = rows.rows.map(r => ({ symbol: r.symbol, currentSector: r.sector ?? null }));
  } else if (options?.forceAll) {
    const rows = await db.execute<{ symbol: string; sector: string | null }>(sql`
      SELECT symbol, sector FROM market_data_symbols WHERE enabled = true ORDER BY symbol
    `);
    candidates = rows.rows.map(r => ({ symbol: r.symbol, currentSector: r.sector ?? null }));
  } else {
    // Only symbols with null/empty sector
    const rows = await db.execute<{ symbol: string }>(sql`
      SELECT symbol FROM market_data_symbols
      WHERE enabled = true AND (sector IS NULL OR sector = '')
      ORDER BY symbol
    `);
    candidates = rows.rows.map(r => ({ symbol: r.symbol, currentSector: null }));
  }

  console.log(`[symbol-enrichment] enriching ${candidates.length} symbols (forceAll=${options?.forceAll ?? false})`);

  const results: SymbolEnrichmentResult["symbols"] = [];
  let enriched = 0, skipped = 0, failed = 0, noop = 0;

  for (const { symbol, currentSector } of candidates) {
    // Skip if already classified (unless forceAll)
    if (!options?.forceAll && currentSector && currentSector.trim() !== "") {
      noop++;
      results.push({ symbol, sector: currentSector, industry: null, status: "noop" });
      continue;
    }

    try {
      await reserveCreditsBlocking(1);
      const profile = await fetchProfile(symbol, cfg.apiKey);

      if (!profile?.sector || profile.sector.trim() === "") {
        console.warn(`[symbol-enrichment] no sector from Twelve Data for ${symbol}`);
        skipped++;
        results.push({ symbol, sector: null, industry: null, status: "failed" });
        continue;
      }

      const sector   = profile.sector.trim();
      const industry = profile.industry?.trim() ?? null;
      const name     = profile.name?.trim()     ?? null;

      // Upsert into market_data_symbols
      await db.execute(sql`
        UPDATE market_data_symbols
        SET sector = ${sector}
        WHERE symbol = ${symbol}
      `);

      // Also upsert/insert into symbols table for backward compatibility
      if (name) {
        await db.execute(sql`
          INSERT INTO symbols (ticker, name, sector, industry, is_active)
          VALUES (${symbol}, ${name}, ${sector}, ${industry}, true)
          ON CONFLICT (ticker) DO UPDATE
            SET sector   = EXCLUDED.sector,
                industry = EXCLUDED.industry,
                name     = COALESCE(NULLIF(symbols.name, ''), EXCLUDED.name)
        `);
      } else {
        await db.execute(sql`
          INSERT INTO symbols (ticker, name, sector, industry, is_active)
          VALUES (${symbol}, ${symbol}, ${sector}, ${industry}, true)
          ON CONFLICT (ticker) DO UPDATE
            SET sector   = EXCLUDED.sector,
                industry = EXCLUDED.industry
        `);
      }

      console.log(`[symbol-enrichment] enriched ${symbol} → sector="${sector}" industry="${industry ?? "n/a"}"`);
      enriched++;
      results.push({ symbol, sector, industry, status: "enriched" });

    } catch (err: any) {
      console.error(`[symbol-enrichment] failed for ${symbol}: ${err?.message}`);
      failed++;
      results.push({ symbol, sector: null, industry: null, status: "failed" });
    }
  }

  const coverageAfter = await getCoverage();
  console.log(`[symbol-enrichment] done enriched=${enriched} skipped=${skipped} failed=${failed} noop=${noop} coverage_after=${coverageAfter.pct}%`);

  return {
    requested: candidates.length,
    enriched,
    skipped,
    failed,
    noop,
    symbols: results,
    coverageBefore,
    coverageAfter,
  };
}
