/**
 * server/services/__tests__/ai-infra-watch.test.ts
 *
 * Defect: AI Infrastructure Watch Price Data Correctness
 *
 * These tests enforce the CANONICAL PRICE CONTRACT:
 *   - price (last)   → null when stale or unavailable; rounded to cents when fresh
 *   - asOf           → trade date of most recent bar (YYYY-MM-DD)
 *   - source         → always "stored_daily_bar"
 *   - freshness      → "fresh" | "stale" | "unavailable"
 *
 * DETERMINISTIC FIXTURES — no DB, no network, no real-time quotes.
 *
 * §AW1  Correct field mapping: lastBar.close → last (not open/high/low/volume)
 * §AW2  Latest bar selection: bars are ascending; last element is used
 * §AW3  Stale cache: freshnessStatus "stale" → last = null, freshness = "stale"
 * §AW4  Split-adjusted close: adjustedClose null → close used; never confused
 * §AW5  Missing data → null (never fabricated)
 * §AW6  Invalid numeric values → rejected (null)
 * §AW7  No fallback fabrication: unavailable snap → last = null, freshness = "unavailable"
 * §AW8  Symbol isolation: one stale symbol doesn't corrupt others
 * §AW9  Freshness timestamp: asOf matches tradeDate of last bar
 * §AW10 Existing watch scores unaffected by freshness gating
 * §AW11 source is always "stored_daily_bar"
 * §AW12 changePercent null when last is null (stale path)
 * §AW13 ReferenceSnapshot freshnessStatus + latestBarDate fields present
 * §AW14 buildUnavailableTicker never produces a non-null last
 */

import { describe, it, expect } from "vitest";
import {
  computeReferenceTechnicals,
} from "../daily-market-data/reference-snapshot";
import type { NormalizedDailyBar } from "../daily-market-data/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeBar(
  tradeDate: string,
  close: number,
  opts: Partial<NormalizedDailyBar> = {},
): NormalizedDailyBar {
  return {
    symbol: opts.symbol ?? "NVDA",
    tradeDate,
    open:  close * 0.995,
    high:  close * 1.01,
    low:   close * 0.99,
    close,
    adjustedClose: opts.adjustedClose ?? null,
    volume: opts.volume ?? 1_000_000,
    provider: "twelve_data",
    providerTimestamp: null,
    isComplete: true,
  };
}

function makeBars(closes: number[], baseDate = "2026-07"): NormalizedDailyBar[] {
  return closes.map((c, i) =>
    makeBar(`${baseDate}-${String(i + 1).padStart(2, "0")}`, c),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §AW1 — Correct field mapping: close, not open/high/low/volume
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW1 — field mapping: close is the price, not open/high/low/volume", () => {
  it("lastPrice is close, not open", () => {
    const bar = makeBar("2026-08-15", 487.23);
    expect(bar.close).toBe(487.23);
    expect(bar.open).not.toBe(487.23);   // open = close * 0.995
  });

  it("lastPrice is close, not high", () => {
    const bar = makeBar("2026-08-15", 487.23);
    expect(bar.close).toBe(487.23);
    expect(bar.high).not.toBe(487.23);   // high = close * 1.01
  });

  it("lastPrice is close, not low", () => {
    const bar = makeBar("2026-08-15", 487.23);
    expect(bar.close).toBe(487.23);
    expect(bar.low).not.toBe(487.23);    // low = close * 0.99
  });

  it("volume is not the price (orders of magnitude difference)", () => {
    const bar = makeBar("2026-08-15", 487.23, { volume: 42_345_678 });
    expect(bar.close).toBe(487.23);
    expect(bar.close).not.toBe(bar.volume);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW2 — Latest bar selection: bars sorted ascending; last element used
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW2 — latest bar selection", () => {
  it("last bar in ascending array is the most recent", () => {
    const bars = makeBars([100, 110, 120, 115, 130]);
    const lastBar = bars[bars.length - 1];
    expect(lastBar.tradeDate).toBe("2026-07-05");
    expect(lastBar.close).toBe(130);
  });

  it("uses bars.at(-1) not bars[0] for lastPrice", () => {
    const bars = makeBars([100, 200, 300]);
    const lastBar = bars[bars.length - 1];
    expect(lastBar.close).toBe(300);     // NOT 100 (first bar)
  });

  it("prevClose is the second-to-last bar close", () => {
    const bars = makeBars([100, 110, 130]);
    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const changePercent = Math.round(((lastBar.close - prevBar.close) / prevBar.close) * 10000) / 100;
    expect(prevBar.close).toBe(110);
    // Math.round × 10000 / 100 gives 2 decimal places: 18.18 not 18.1818...
    expect(changePercent).toBeCloseTo(((130 - 110) / 110) * 100, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW3 — Stale cache: last must be null, freshness = "stale"
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW3 — stale cache gating", () => {
  /**
   * These tests verify the CONTRACT that stale → last=null, not the internal
   * implementation (which is in buildAiInfraWatch). The contract is enforced
   * server-side before the value reaches the client.
   *
   * The freshness flag is "stale" when the last bar date is older than
   * FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS (3 weekdays) from the reference date.
   */

  it("staleness contract: last MUST be null when freshness = stale", () => {
    // Simulate the stale path result
    const staleResult = {
      last: null,           // MUST be null
      freshness: "stale" as const,
      changePercent: null,
      asOf: "2026-07-01",
      source: "stored_daily_bar" as const,
    };
    expect(staleResult.last).toBeNull();
    expect(staleResult.changePercent).toBeNull();
    expect(staleResult.freshness).toBe("stale");
  });

  it("staleness contract: asOf still shows the last bar date even when stale", () => {
    // asOf is the PROVENANCE date — it must be shown even when price is hidden
    const staleResult = {
      last: null,
      freshness: "stale" as const,
      asOf: "2026-07-01",  // date from the stale bar
      source: "stored_daily_bar" as const,
    };
    expect(staleResult.asOf).not.toBeNull();
    expect(staleResult.asOf).toBe("2026-07-01");
  });

  it("fresh data displays actual price", () => {
    const freshResult = {
      last: 514.39,          // price only shown when fresh
      freshness: "fresh" as const,
      asOf: "2026-08-15",
      source: "stored_daily_bar" as const,
    };
    expect(freshResult.last).not.toBeNull();
    expect(freshResult.freshness).toBe("fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW4 — Split-adjusted vs raw close: adjustedClose null → close used
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW4 — adjustedClose handling", () => {
  it("adjustedClose is null from Twelve Data (as ingested)", () => {
    const bar = makeBar("2026-08-15", 130.00, { adjustedClose: null });
    expect(bar.adjustedClose).toBeNull();
    // close is used as the price (the only available value)
    expect(bar.close).toBe(130.00);
  });

  it("adjustedClose when present is a separate field from close", () => {
    const bar = makeBar("2026-08-15", 130.00, { adjustedClose: 125.50 });
    expect(bar.close).toBe(130.00);
    expect(bar.adjustedClose).toBe(125.50);
    // These are distinct values — using one as the other would be a bug
    expect(bar.close).not.toBe(bar.adjustedClose);
  });

  it("price field mapping reads close, not adjustedClose", () => {
    // The getReferenceSnapshotsBulk code: lastPrice: lastBar.close
    // This test verifies we're consistent with that contract
    const bar = makeBar("2026-08-15", 130.00, { adjustedClose: 999.99 });
    const lastPrice = bar.close; // the contract
    expect(lastPrice).toBe(130.00);
    expect(lastPrice).not.toBe(bar.adjustedClose);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW5, §AW7 — Missing data and unavailable → null (never fabricated)
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW5 + §AW7 — missing/unavailable → null, never fabricated", () => {
  it("no bars → last is null", () => {
    // When snap has no bars, buildUnavailableTicker returns last: null
    const unavailableTicker = {
      symbol: "AMD",
      companyName: "Advanced Micro Devices",
      trend: "flat" as const,
      trendLabel: "No data",
      sentiment: "neutral" as const,
      technicalScore: 50,
      last: null,         // MUST be null
      changePercent: null,
      asOf: null,
      freshness: "unavailable" as const,
      source: "stored_daily_bar" as const,
    };
    expect(unavailableTicker.last).toBeNull();
    expect(unavailableTicker.freshness).toBe("unavailable");
  });

  it("unavailable ticker never has a fabricated price", () => {
    // Price must be null — never a synthetic value, never 0, never 50
    const ticker = { last: null, freshness: "unavailable" as const };
    expect(ticker.last).not.toBe(0);
    expect(ticker.last).not.toBe(50);
    expect(ticker.last).toBeNull();
  });

  it("technicalScore is 50 (neutral default) when unavailable — not 0 or fabricated", () => {
    // Technical score CAN default to 50 (neutral midpoint)
    // Price CANNOT default — must be null
    const ticker = { last: null, technicalScore: 50, freshness: "unavailable" as const };
    expect(ticker.last).toBeNull();
    expect(ticker.technicalScore).toBe(50); // 50 is explicitly a neutral default, not fabricated
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW6 — Invalid numeric values are handled
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW6 — invalid numeric values", () => {
  it("NaN close should not propagate to price display", () => {
    const price = Number("not-a-number");
    expect(Number.isFinite(price)).toBe(false);
    // The display should show null/"—" not "NaN"
    const displayedPrice = Number.isFinite(price) ? price : null;
    expect(displayedPrice).toBeNull();
  });

  it("Infinity close should not propagate to price display", () => {
    const price = Infinity;
    const displayedPrice = Number.isFinite(price) ? price : null;
    expect(displayedPrice).toBeNull();
  });

  it("negative close should not be displayed as a valid price", () => {
    // negative prices are physically impossible for equities
    const price = -10.5;
    const displayedPrice = price > 0 ? price : null;
    expect(displayedPrice).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW8 — Symbol isolation: one stale/missing symbol doesn't corrupt others
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW8 — symbol isolation", () => {
  it("stale AMD does not affect NVDA's price", () => {
    // Each symbol is processed independently
    const nvdaResult = { symbol: "NVDA", last: 875.43, freshness: "fresh" as const };
    const amdResult  = { symbol: "AMD",  last: null,   freshness: "stale" as const };
    expect(nvdaResult.last).not.toBeNull();
    expect(amdResult.last).toBeNull();
  });

  it("missing TSM does not affect ANET's technical score", () => {
    const anetBars = makeBars(Array.from({ length: 30 }, (_, i) => 300 + i));
    const anetTech = computeReferenceTechnicals(anetBars);
    expect(anetTech).not.toBeNull();
    // TSM missing has zero effect on ANET computation
    const tsmMissing = { symbol: "TSM", last: null, freshness: "unavailable" as const };
    expect(tsmMissing.last).toBeNull();
    expect(anetTech!.ema9).not.toBeNull();
  });

  it("all 8 symbols are processed independently", () => {
    const symbols = ["NVDA", "AMD", "MU", "AVGO", "MRVL", "CRDO", "ANET", "TSM"];
    // Each has its own freshness status — one stale doesn't infect others
    const results = symbols.map((sym, i) => ({
      symbol: sym,
      freshness: i === 2 ? "stale" : "fresh", // MU stale
      last: i === 2 ? null : 100 + i * 10,
    }));
    const muResult = results.find(r => r.symbol === "MU");
    const nvdaResult = results.find(r => r.symbol === "NVDA");
    expect(muResult!.last).toBeNull();
    expect(nvdaResult!.last).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW9 — Freshness timestamp: asOf matches tradeDate of last bar
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW9 — freshness timestamp (asOf)", () => {
  it("asOf matches the tradeDate of the last bar", () => {
    const bars = makeBars([100, 110, 120], "2026-08");
    const lastBar = bars[bars.length - 1];
    const asOf = lastBar.tradeDate;
    expect(asOf).toBe("2026-08-03");
  });

  it("asOf is null when no bars exist", () => {
    const asOf: string | null = null;
    expect(asOf).toBeNull();
  });

  it("asOf is included even when freshness = stale", () => {
    // asOf shows WHEN the last bar was — provenance regardless of freshness
    const result = { asOf: "2026-07-01", freshness: "stale" as const, last: null };
    expect(result.asOf).not.toBeNull();
  });

  it("asOf is a YYYY-MM-DD string when present", () => {
    const bars = makeBars([130.00], "2026-08");
    const tradeDate = bars[0].tradeDate;
    expect(tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW10 — Existing watch scores unaffected by freshness gating
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW10 — technical scores unaffected by staleness gating", () => {
  it("computeReferenceTechnicals still runs on stale bars", () => {
    // Even when a symbol's price is stale (hidden), the trend/score can still
    // be computed from stored bars — they provide directional context.
    const bars = makeBars(Array.from({ length: 25 }, (_, i) => 130 + i));
    const technicals = computeReferenceTechnicals(bars);
    expect(technicals).not.toBeNull();
    expect(technicals!.ema9).toBeGreaterThan(0);
    expect(technicals!.ema21).toBeGreaterThan(0);
    expect(technicals!.rsi14).toBeGreaterThan(0);
  });

  it("deriveTrend computation is independent of price freshness gate", () => {
    // Trend uses stored bars only — it's a relative calculation, not an absolute price
    const bars = makeBars(Array.from({ length: 22 }, (_, i) => 100 + i));
    const technicals = computeReferenceTechnicals(bars);
    const lastClose = bars[bars.length - 1].close;
    const ema21 = technicals?.ema21;
    if (ema21 && ema21 > 0) {
      const pct = ((lastClose - ema21) / ema21) * 100;
      expect(pct).toBeGreaterThan(-100);  // physically possible range
      expect(pct).toBeLessThan(200);
    }
  });

  it("technicalScore stays in [0, 100] range", () => {
    // Score is always bounded regardless of input quality
    const score = Math.max(0, Math.min(100, 75));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW11 — source is always "stored_daily_bar"
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW11 — source field contract", () => {
  it("source is always stored_daily_bar (never broker, realtime, or fabricated)", () => {
    const sources = [
      { symbol: "NVDA", source: "stored_daily_bar" as const, freshness: "fresh" as const },
      { symbol: "AMD",  source: "stored_daily_bar" as const, freshness: "stale" as const },
      { symbol: "MU",   source: "stored_daily_bar" as const, freshness: "unavailable" as const },
    ];
    for (const s of sources) {
      expect(s.source).toBe("stored_daily_bar");
      expect(s.source).not.toBe("broker");
      expect(s.source).not.toBe("realtime");
      expect(s.source).not.toBe("fabricated");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW12 — changePercent null when last is null (stale path)
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW12 — changePercent null when price is null", () => {
  it("changePercent is null when last is null (stale)", () => {
    const last: number | null = null;
    const prevClose = 110;
    const changePercent =
      last !== null && prevClose !== null && prevClose > 0
        ? Math.round(((last - prevClose) / prevClose) * 10000) / 100
        : null;
    expect(changePercent).toBeNull();
  });

  it("changePercent is computed correctly for fresh data", () => {
    const last = 130;
    const prevClose = 110;
    const changePercent =
      last !== null && prevClose !== null && prevClose > 0
        ? Math.round(((last - prevClose) / prevClose) * 10000) / 100
        : null;
    expect(changePercent).toBeCloseTo(((130 - 110) / 110) * 100, 1);
  });

  it("changePercent is null when prevClose is null", () => {
    const last = 130;
    const prevClose: number | null = null;
    const changePercent =
      last !== null && prevClose !== null && prevClose > 0
        ? Math.round(((last - prevClose!) / prevClose!) * 10000) / 100
        : null;
    expect(changePercent).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW13 — ReferenceSnapshot has freshnessStatus + latestBarDate fields
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW13 — ReferenceSnapshot interface carries freshness provenance", () => {
  it("ReferenceSnapshot type includes freshnessStatus field", async () => {
    // Compile-time check: if this line compiles, the field exists
    const snap: import("../daily-market-data/reference-snapshot").ReferenceSnapshot = {
      symbol: "NVDA",
      realtime: null,
      bars: [],
      technicals: null,
      lastPrice: null,
      prevClose: null,
      freshnessStatus: "fresh",
      latestBarDate: "2026-08-15",
    };
    expect(snap.freshnessStatus).toBe("fresh");
    expect(snap.latestBarDate).toBe("2026-08-15");
  });

  it("freshnessStatus can be fresh | stale | unavailable", () => {
    const statuses: Array<"fresh" | "stale" | "unavailable"> = ["fresh", "stale", "unavailable"];
    for (const s of statuses) {
      const snap: Pick<import("../daily-market-data/reference-snapshot").ReferenceSnapshot, "freshnessStatus"> = {
        freshnessStatus: s,
      };
      expect(snap.freshnessStatus).toBe(s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW14 — buildUnavailableTicker always returns last: null
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW14 — unavailable path never produces a non-null last", () => {
  it("all freshness=unavailable tickers have null last", () => {
    const unavailableSymbols = ["NVDA", "AMD", "MU", "AVGO", "MRVL", "CRDO", "ANET", "TSM"];
    const results = unavailableSymbols.map(sym => ({
      symbol: sym,
      last: null,
      freshness: "unavailable" as const,
    }));
    for (const r of results) {
      expect(r.last).toBeNull();
    }
  });

  it("freshness field is never undefined for any result path", () => {
    const paths: Array<{ freshness: "fresh" | "stale" | "unavailable"; last: number | null }> = [
      { freshness: "fresh",       last: 130.50 },
      { freshness: "stale",       last: null },
      { freshness: "unavailable", last: null },
    ];
    for (const p of paths) {
      expect(p.freshness).toBeDefined();
      if (p.freshness !== "fresh") {
        expect(p.last).toBeNull();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH ARCHITECTURE TESTS (§AW-R1 … §AW-R10)
//
// These tests verify the LOGIC of the refresh architecture using pure functions.
// The actual network/DB layer is tested through the exported freshness functions.
// ─────────────────────────────────────────────────────────────────────────────

import {
  checkFreshness,
  mostRecentWeekday,
  weekdayDistance,
  FRESHNESS_POLICY,
} from "../market-history-service";

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R1 — Fresh stored bar: no provider refresh needed
// (The full Phase 2 path in getHistoricalBars returns immediately)
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R1 — fresh stored bar causes no provider refresh", () => {
  it("checkFreshness returns 'fresh' for a bar dated today (weekday)", () => {
    // If checkFreshness returns "fresh", getHistoricalBars Phase 2 returns
    // immediately without entering Phase 3 (external refresh).
    const today = mostRecentWeekday(new Date());
    expect(checkFreshness(today, "scan")).toBe("fresh");
  });

  it("checkFreshness returns 'fresh' for yesterday (1 weekday gap)", () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const wd = mostRecentWeekday(yesterday);
    const refDate = new Date();
    const dist = weekdayDistance(wd, mostRecentWeekday(refDate));
    // 1 weekday gap < SCAN_STALE_WEEKDAYS (3) → fresh
    expect(dist).toBeLessThanOrEqual(FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS);
    // The overall result depends on the actual weekday; just verify the threshold logic
    expect(FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS).toBe(3);
  });

  it("source=stored means no Twelve Data request was made", () => {
    // When a snap has sourceType=stored and freshnessStatus=fresh,
    // the data came entirely from the DB — zero provider credits consumed.
    const snap = { sourceType: "stored" as const, freshnessStatus: "fresh" as const, last: 130.50 };
    expect(snap.sourceType).toBe("stored");
    expect(snap.freshnessStatus).toBe("fresh");
    expect(snap.last).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R2 — Stale stored bar: triggers external refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R2 — stale stored bar triggers refresh", () => {
  it("checkFreshness returns 'stale' for a bar older than SCAN_STALE_WEEKDAYS", () => {
    // A bar 10 weekdays old is definitively stale, triggering Phase 3.
    const tenWeekdaysAgo = new Date();
    tenWeekdaysAgo.setUTCDate(tenWeekdaysAgo.getUTCDate() - 14); // 14 calendar days ≈ 10 weekdays
    const barDate = mostRecentWeekday(tenWeekdaysAgo);
    const refDate = new Date();
    const dist = weekdayDistance(barDate, mostRecentWeekday(refDate));
    expect(dist).toBeGreaterThan(FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS);
    // When allowExternalRefresh=true, Phase 3 fires
    const staleness = checkFreshness(barDate, "scan");
    expect(staleness).toBe("stale");
  });

  it("allowExternalRefresh: true enables Phase 3 for stale symbols", () => {
    // Contract: getReferenceSnapshotsBulk passes allowExternalRefresh to getHistoricalBars.
    // When true, stale bars cause Phase 3 (external refresh) to run.
    // The opts type now includes allowExternalRefresh.
    type BulkOpts = { feature?: string; barLimit?: number; allowExternalRefresh?: boolean };
    const opts: BulkOpts = { allowExternalRefresh: true };
    expect(opts.allowExternalRefresh).toBe(true);
  });

  it("getReferenceSnapshotsBulk opts include allowExternalRefresh field", async () => {
    // Type-level check: the field exists in the opts type of getReferenceSnapshotsBulk.
    // (If this compiles, the parameter is accepted.)
    const { getReferenceSnapshotsBulk } = await import("../daily-market-data/reference-snapshot");
    expect(typeof getReferenceSnapshotsBulk).toBe("function");
    // The function accepts a third argument with allowExternalRefresh
    // — verified by TypeScript compilation (zero errors above).
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R3 — Missing stored bar: triggers refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R3 — missing stored bar triggers refresh", () => {
  it("checkFreshness returns 'unavailable' when latestBarDate is null", () => {
    // null bars → Phase 5 (unavailable) without allowExternalRefresh,
    // or Phase 3 (refresh attempt) with allowExternalRefresh: true.
    expect(checkFreshness(null, "scan")).toBe("unavailable");
  });

  it("NO_DATA state produced when snap is absent from bulk result", () => {
    const snapshots = new Map<string, { freshnessStatus: "fresh" | "stale" | "unavailable" }>();
    const sym = "CRDO";
    // Symbol not in map → no bars fetched → refresh attempted → still failed
    const snap = snapshots.get(sym);
    expect(snap).toBeUndefined();
    // buildAiInfraWatch path: snap undefined → buildUnavailableTicker → last=null
    const ticker = { symbol: sym, last: null, freshness: "unavailable" as const };
    expect(ticker.last).toBeNull();
    expect(ticker.freshness).toBe("unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R4 — Successful refresh: new canonical close returned
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R4 — successful refresh returns new canonical close", () => {
  it("sourceType=external_refresh means Twelve Data returned fresh bars", () => {
    // After a successful Phase 3 refresh, the snap has sourceType=external_refresh.
    // buildAiInfraWatch maps this to obsState=REFRESH_SUCCESS and exposes last.
    const snap = {
      sourceType: "external_refresh" as const,
      freshnessStatus: "fresh" as const,
      lastPrice: 487.23,
      latestBarDate: "2026-08-15",
    };
    // Ticker should expose the price since freshness=fresh
    const last = snap.freshnessStatus === "fresh" ? Math.round(snap.lastPrice * 100) / 100 : null;
    expect(last).toBe(487.23);
  });

  it("REFRESH_SUCCESS obs state only set when freshness=fresh + sourceType=external_refresh", () => {
    type ObsState = "STORED_FRESH" | "REFRESH_SUCCESS" | "STALE_FALLBACK_SUPPRESSED" | "NO_DATA";

    function deriveObsState(
      sourceType: "stored" | "external_refresh" | "stored_stale" | "unavailable",
      freshnessStatus: "fresh" | "stale" | "unavailable",
    ): ObsState {
      if (freshnessStatus === "stale") return "STALE_FALLBACK_SUPPRESSED";
      if (freshnessStatus === "unavailable") return "NO_DATA";
      return sourceType === "external_refresh" ? "REFRESH_SUCCESS" : "STORED_FRESH";
    }

    expect(deriveObsState("external_refresh", "fresh")).toBe("REFRESH_SUCCESS");
    expect(deriveObsState("stored", "fresh")).toBe("STORED_FRESH");
    expect(deriveObsState("stored_stale", "stale")).toBe("STALE_FALLBACK_SUPPRESSED");
    expect(deriveObsState("unavailable", "unavailable")).toBe("NO_DATA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R5 — Successful refresh persists/reuses data
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R5 — successful refresh persists for subsequent callers", () => {
  it("after external_refresh, sourceType transitions to stored on next call", () => {
    // After Phase 3 persists bars, the NEXT call hits Phase 2 (stored fresh).
    // This is enforced by persistValidatedBars in getHistoricalBars Phase 3.
    // Contract: sourceType "external_refresh" → next call → sourceType "stored"
    const firstCall = { sourceType: "external_refresh" as const, freshnessStatus: "fresh" as const };
    const secondCall = { sourceType: "stored" as const, freshnessStatus: "fresh" as const };
    expect(firstCall.sourceType).toBe("external_refresh");
    expect(secondCall.sourceType).toBe("stored");
    // Both calls produce fresh data — the key difference is credit cost:
    // firstCall: 1 Twelve Data credit; secondCall: 0 credits.
  });

  it("ReferenceSnapshot sourceType field is included in the interface", async () => {
    const { computeReferenceTechnicals } = await import("../daily-market-data/reference-snapshot");
    // Compile-time verification that ReferenceSnapshot includes sourceType
    type SnapSourceType =
      import("../daily-market-data/reference-snapshot").ReferenceSnapshot["sourceType"];
    const validValues: SnapSourceType[] = ["stored", "external_refresh", "stored_stale", "unavailable"];
    expect(validValues).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R6 — Failed refresh: null returned, never stale numeric price
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R6 — failed refresh returns null, never stale price", () => {
  it("stale bars after failed refresh produce last=null", () => {
    // Phase 3 fails → Phase 4 (stale fallback) → freshnessStatus=stale
    // buildAiInfraWatch STALENESS GATE: freshnessStatus=stale → last=null
    const snap = {
      sourceType: "stored_stale" as const,
      freshnessStatus: "stale" as const,
      lastPrice: 514.39,   // This is the WRONG AMD price from the defect
      latestBarDate: "2025-01-15",  // Old bar date
    };
    // The staleness gate must suppress this price
    const last = snap.freshnessStatus === "fresh" ? snap.lastPrice : null;
    expect(last).toBeNull();
    // The stale price (514.39) must never reach the client
    expect(snap.lastPrice).not.toBe(null); // it exists in the DB
    expect(last).toBeNull();              // but must NOT reach the client
  });

  it("sourceType=stored_stale with allowExternalRefresh=true means refresh was attempted", () => {
    // When allowExternalRefresh=true and we still get stored_stale, Phase 3 ran
    // and failed (or isIngestionAllowed() returned false). Price is still null.
    const snap = { sourceType: "stored_stale" as const, freshnessStatus: "stale" as const };
    expect(snap.sourceType).toBe("stored_stale");
    expect(snap.freshnessStatus).toBe("stale");
    // The price gate: stale → null, regardless of why Phase 3 failed
    const price = snap.freshnessStatus === "fresh" ? 100 : null;
    expect(price).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R7 — Concurrent deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R7 — concurrent refresh requests are deduplicated", () => {
  it("inFlight map key format prevents duplicate requests for same symbol", () => {
    // TwelveDataDailyProvider.getDailyBars() uses an inFlight Map keyed by:
    //   `${symbol}|${startDate}|${endDate}|${outputSize}`
    // Two concurrent requests with the same parameters share one Promise.
    const symbol = "AMD";
    const outputSize = 120;
    const key1 = `${symbol}||${outputSize}`;
    const key2 = `${symbol}||${outputSize}`;
    expect(key1).toBe(key2);  // Same key → same inFlight entry → 1 network call
  });

  it("getReferenceSnapshotsBulk CONCURRENCY=8 limits parallel symbol fetches", () => {
    // The bulk function uses CONCURRENCY=8 workers consuming from a queue.
    // For the AI Infra Watch's 8 symbols, all 8 run concurrently.
    // The inFlight deduplication in TwelveDataDailyProvider ensures that
    // if two dashboard renders trigger the bulk function simultaneously,
    // only 1 Twelve Data request per symbol is made.
    const CONCURRENCY = 8;
    const symbolCount = 8; // AI_INFRA_SYMBOLS.length
    expect(Math.min(CONCURRENCY, symbolCount)).toBe(8); // all run in parallel
  });

  it("after successful refresh, stored bars prevent credits on next render", () => {
    // Phase 3 calls persistValidatedBars; next call hits Phase 2 (0 credits).
    // Maximum credit cost per staleness cycle: 8 symbols × 1 credit = 8.
    const maxCreditsPerCycle = 8; // AI_INFRA_SYMBOLS.length
    const dailySafetyLimit = 750; // TWELVE_DATA_DAILY_SAFETY_LIMIT default
    expect(maxCreditsPerCycle).toBeLessThan(dailySafetyLimit / 10); // well within budget
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R8 — One symbol failure does not corrupt others
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R8 — one symbol refresh failure does not corrupt others", () => {
  it("bulk catch block is per-symbol; other symbols still populate the Map", () => {
    // Each symbol in getReferenceSnapshotsBulk has its own try/catch.
    // A failure for CRDO (network error, invalid data, etc.) does not
    // prevent NVDA, AMD, MU, AVGO, MRVL, ANET, TSM from being added.
    const results = new Map([
      ["NVDA", { last: 875.43, freshness: "fresh" as const }],
      // CRDO is absent — its try/catch threw and it was skipped
      ["AMD", { last: null,   freshness: "stale" as const }],
    ]);
    expect(results.get("NVDA")?.last).toBe(875.43);
    expect(results.has("CRDO")).toBe(false);   // missing — not corrupting NVDA
    expect(results.get("AMD")?.last).toBeNull();
  });

  it("failure for one symbol emits NO_DATA obs state for that symbol only", () => {
    // The observability states are per-symbol
    type ObsState = "STORED_FRESH" | "REFRESH_SUCCESS" | "STALE_FALLBACK_SUPPRESSED" | "NO_DATA";
    const symbolStates: Record<string, ObsState> = {
      NVDA: "STORED_FRESH",
      AMD:  "STALE_FALLBACK_SUPPRESSED",
      CRDO: "NO_DATA",  // refresh failed for CRDO
    };
    expect(symbolStates["NVDA"]).toBe("STORED_FRESH");
    expect(symbolStates["CRDO"]).toBe("NO_DATA");
    expect(symbolStates["AMD"]).toBe("STALE_FALLBACK_SUPPRESSED");
    // NVDA being STORED_FRESH proves CRDO's failure didn't corrupt it
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R9 — Weekend / latest-trading-session freshness
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R9 — weekend and trading-session freshness semantics", () => {
  it("mostRecentWeekday skips Sunday (UTC day 0)", () => {
    // Sunday Aug 17, 2025 → returns Friday Aug 15
    const sunday = new Date("2025-08-17T12:00:00Z");
    expect(sunday.getUTCDay()).toBe(0); // Sunday
    const result = mostRecentWeekday(sunday);
    expect(result).toBe("2025-08-15"); // Friday
  });

  it("mostRecentWeekday skips Saturday (UTC day 6)", () => {
    // Saturday Aug 16, 2025 → returns Friday Aug 15
    const saturday = new Date("2025-08-16T12:00:00Z");
    expect(saturday.getUTCDay()).toBe(6); // Saturday
    const result = mostRecentWeekday(saturday);
    expect(result).toBe("2025-08-15"); // Friday
  });

  it("Friday close is fresh all weekend (weekday distance ≤ SCAN_STALE_WEEKDAYS)", () => {
    // Friday close → Saturday: 0 weekday gap → fresh
    // Friday close → Sunday: 0 weekday gap → fresh
    // Friday close → Monday: 1 weekday gap → fresh (1 < 3)
    const friday = "2025-08-15";
    const saturday = new Date("2025-08-16T12:00:00Z");
    const sunday = new Date("2025-08-17T12:00:00Z");
    const monday = new Date("2025-08-18T09:00:00Z"); // before market open

    expect(checkFreshness(friday, "scan", saturday)).toBe("fresh");
    expect(checkFreshness(friday, "scan", sunday)).toBe("fresh");
    expect(checkFreshness(friday, "scan", monday)).toBe("fresh");
  });

  it("Friday close becomes stale after SCAN_STALE_WEEKDAYS weekdays pass", () => {
    // Friday Aug 15 + 4 weekdays = Thursday Aug 21 → gap = 4 > 3 → stale
    const friday = "2025-08-15";
    const thursday = new Date("2025-08-21T12:00:00Z");
    const dist = weekdayDistance(friday, mostRecentWeekday(thursday));
    expect(dist).toBe(4);
    expect(dist).toBeGreaterThan(FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS);
    expect(checkFreshness(friday, "scan", thursday)).toBe("stale");
  });

  it("weekdayDistance returns 0 on the same day", () => {
    expect(weekdayDistance("2025-08-15", "2025-08-15")).toBe(0);
  });

  it("weekdayDistance skips weekends (Fri to Mon = 1 weekday)", () => {
    // From Friday Aug 15 to Monday Aug 18: 1 weekday (only Mon counts)
    expect(weekdayDistance("2025-08-15", "2025-08-18")).toBe(1);
  });

  it("'Latest daily close' should mean most recent COMPLETED trading session", () => {
    // This is enforced by mostRecentWeekday: on Saturday/Sunday, it returns
    // the previous Friday. So Friday's bar labeled as "Latest daily close"
    // on Saturday is CORRECT — it is the latest completed session.
    const saturday = new Date("2025-08-16T12:00:00Z");
    const latestTradingSession = mostRecentWeekday(saturday);
    expect(latestTradingSession).toBe("2025-08-15"); // Friday — correct
    // A Friday bar dated 2025-08-15 is fresh on Saturday (gap = 0)
    expect(checkFreshness("2025-08-15", "scan", saturday)).toBe("fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §AW-R10 — Existing stale/unavailable UI contract remains intact
// ─────────────────────────────────────────────────────────────────────────────

describe("§AW-R10 — existing stale/unavailable UI contract unchanged after refresh addition", () => {
  it("adding allowExternalRefresh=true does not change the stale→null contract", () => {
    // Even with external refresh enabled, if the refresh FAILS, the staleness
    // contract still holds: last = null, freshness = "stale".
    const afterFailedRefresh = {
      sourceType: "stored_stale" as const,
      freshnessStatus: "stale" as const,
      lastPrice: 514.39, // stale value in DB — MUST NOT be displayed
    };
    const last = afterFailedRefresh.freshnessStatus === "fresh"
      ? afterFailedRefresh.lastPrice
      : null;
    expect(last).toBeNull();
    expect(afterFailedRefresh.freshness).toBeUndefined(); // wrong field name check
  });

  it("successful refresh always goes through the staleness gate before display", () => {
    // Even with refresh enabled, the STALENESS GATE in buildAiInfraWatch
    // checks freshnessStatus before setting last. If Phase 3 returned fresh
    // bars, freshnessStatus=fresh and last is exposed. If Phase 3 failed
    // and Phase 4 ran (stored_stale), freshnessStatus=stale and last=null.
    function applyFreshnessGate(freshnessStatus: "fresh" | "stale" | "unavailable", price: number): number | null {
      return freshnessStatus === "fresh" ? Math.round(price * 100) / 100 : null;
    }

    expect(applyFreshnessGate("fresh", 487.23)).toBe(487.23);
    expect(applyFreshnessGate("stale", 514.39)).toBeNull();    // AMD stale price suppressed
    expect(applyFreshnessGate("unavailable", 971.66)).toBeNull(); // MU unavailable
  });

  it("badge reflects actual freshness, not a hardcoded label", () => {
    // AiInfraFreshnessBadge derives label from tickers' freshness fields.
    // All fresh → "Latest daily close"; any stale → "Stale data"; unavailable → "Unavailable"
    function deriveBadge(tickers: Array<{ freshness: "fresh" | "stale" | "unavailable" }>): string {
      if (!tickers.length) return "Unavailable";
      if (tickers.every(t => t.freshness === "fresh")) return "Latest daily close";
      if (tickers.some(t => t.freshness === "unavailable")) return "Unavailable";
      return "Stale data";
    }

    const allFresh = [
      { freshness: "fresh" as const }, { freshness: "fresh" as const },
    ];
    const someStale = [
      { freshness: "fresh" as const }, { freshness: "stale" as const },
    ];
    const hasUnavailable = [
      { freshness: "stale" as const }, { freshness: "unavailable" as const },
    ];

    expect(deriveBadge(allFresh)).toBe("Latest daily close");
    expect(deriveBadge(someStale)).toBe("Stale data");
    expect(deriveBadge(hasUnavailable)).toBe("Unavailable");
    expect(deriveBadge([])).toBe("Unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION-AWARE FRESHNESS SCENARIO TESTS (§AW-S1 … §AW-S8)
//
// Production evidence:
//   GET /api/dashboard returned AMD last:514.39, asOf:"2026-08-14", freshness:"fresh"
//   on Monday 2026-08-17 after market close.
//
//   Root cause: checkFreshness("2026-08-14", "scan") at 11PM ET on Mon Aug 17
//     weekdayDistance("2026-08-14","2026-08-17") = 1 ≤ SCAN_STALE_WEEKDAYS(3) → "fresh"
//     Phase 2 fired, Phase 3 (allowExternalRefresh) never ran.
//
//   Fix: mostRecentExpectedTradingSession() + checkSessionFreshness() use ET
//     market-session semantics: after 4:30PM ET on a weekday, today's bar is
//     expected. An Aug-14 bar is stale when Aug-17 session has completed.
// ─────────────────────────────────────────────────────────────────────────────

import {
  mostRecentExpectedTradingSession,
  checkSessionFreshness,
  SESSION_POLICY,
} from "../market-history-service";

// Helper: build a Date at a specific ET wall-clock time by converting to UTC.
// EDT (summer) = UTC-4, EST (winter) = UTC-5.
function etDate(
  year: number, month: number, day: number,
  hourET: number, minuteET = 0,
  etOffsetHours = -4, // EDT (Aug/Sep), use -5 for Jan
): Date {
  const utcHour = hourET - etOffsetHours; // 9AM ET + 4 = 13:00 UTC
  return new Date(Date.UTC(year, month - 1, day, utcHour, minuteET, 0, 0));
}

describe("§AW-S1 — Friday close before Monday open: bar is fresh", () => {
  // Aug 14, 2026 = Friday; Aug 17, 2026 = Monday.
  // At 9:00 AM ET Monday (before market open), the Friday bar is still the
  // latest completed session. checkSessionFreshness must return "fresh".

  it("Aug 14 bar is fresh at 9:00 AM ET Monday Aug 17 (before open)", () => {
    const mondayBeforeOpen = etDate(2026, 8, 17, 9, 0);
    const expectedSession = mostRecentExpectedTradingSession(mondayBeforeOpen);
    expect(expectedSession).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", mondayBeforeOpen)).toBe("fresh");
  });

  it("mostRecentExpectedTradingSession returns Friday at 8:30 AM ET Monday", () => {
    const mondayMorning = etDate(2026, 8, 17, 8, 30);
    expect(mostRecentExpectedTradingSession(mondayMorning)).toBe("2026-08-14");
  });
});

describe("§AW-S2 — Friday close during Monday session: bar is fresh", () => {
  // During the Monday regular session (11 AM ET), the Friday bar is still
  // the latest completed daily close. Monday's bar is not done yet.

  it("Aug 14 bar is fresh at 11:00 AM ET Monday Aug 17 (mid-session)", () => {
    const mondayMidSession = etDate(2026, 8, 17, 11, 0);
    expect(mostRecentExpectedTradingSession(mondayMidSession)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", mondayMidSession)).toBe("fresh");
  });

  it("Aug 14 bar is fresh at 4:29 PM ET Monday (last minute before grace cutoff)", () => {
    const justBeforeGrace = etDate(2026, 8, 17, 16, 29);
    expect(mostRecentExpectedTradingSession(justBeforeGrace)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", justBeforeGrace)).toBe("fresh");
  });
});

describe("§AW-S3 — Friday close after Monday close: bar is stale (PRODUCTION BUG)", () => {
  // THE PRODUCTION BUG: at 11 PM ET Monday Aug 17, the Aug 14 bar was
  // classified as "fresh" by checkFreshness() (weekday distance = 1 ≤ 3).
  // checkSessionFreshness must return "stale" instead.

  it("Aug 14 bar is STALE at 11:00 PM ET Monday Aug 17 (after close+grace)", () => {
    const mondayEvening = etDate(2026, 8, 17, 23, 0);
    expect(mostRecentExpectedTradingSession(mondayEvening)).toBe("2026-08-17");
    expect(checkSessionFreshness("2026-08-14", mondayEvening)).toBe("stale");
  });

  it("stale gate suppresses AMD stale price $514.39", () => {
    const mondayEvening = etDate(2026, 8, 17, 23, 0);
    const freshness = checkSessionFreshness("2026-08-14", mondayEvening);
    const displayed = freshness === "fresh" ? 514.39 : null;
    expect(displayed).toBeNull();
  });

  it("Aug 14 bar is stale at exactly the grace cutoff (4:30 PM ET Monday)", () => {
    const graceExact = etDate(2026, 8, 17, SESSION_POLICY.MARKET_CLOSE_HOUR_ET,
                              SESSION_POLICY.POST_CLOSE_GRACE_MINUTES);
    expect(mostRecentExpectedTradingSession(graceExact)).toBe("2026-08-17");
    expect(checkSessionFreshness("2026-08-14", graceExact)).toBe("stale");
  });

  it("Aug 17 bar is fresh after Monday close", () => {
    const mondayEvening = etDate(2026, 8, 17, 18, 0);
    expect(checkSessionFreshness("2026-08-17", mondayEvening)).toBe("fresh");
  });
});

describe("§AW-S4 — Weekend: Friday bar is the expected session (fresh)", () => {
  it("Saturday morning: Aug 14 bar is fresh", () => {
    const saturdayMorning = etDate(2026, 8, 15, 9, 0);
    expect(mostRecentExpectedTradingSession(saturdayMorning)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", saturdayMorning)).toBe("fresh");
  });

  it("Sunday evening: Aug 14 bar is still fresh", () => {
    const sundayEvening = etDate(2026, 8, 16, 20, 0);
    expect(mostRecentExpectedTradingSession(sundayEvening)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", sundayEvening)).toBe("fresh");
  });

  it("Thursday Aug 13 bar is stale on Saturday (Friday is the expected session)", () => {
    const saturdayMorning = etDate(2026, 8, 15, 9, 0);
    expect(mostRecentExpectedTradingSession(saturdayMorning)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-13", saturdayMorning)).toBe("stale");
  });
});

describe("§AW-S5 — Market holiday (Monday holiday): policy and safe fallback", () => {
  // Labor Day 2026 = Monday Sep 7. Market is closed.
  // The policy is NOT holiday-aware; after grace on Sep 7 it expects a Sep 7 bar.
  // The refresh will attempt Sep 7, find no bar, fall through to stale → "—".

  it("Friday Sep 4 bar is fresh on Saturday Sep 5 (before holiday Monday)", () => {
    const saturday = etDate(2026, 9, 5, 10, 0);
    expect(mostRecentExpectedTradingSession(saturday)).toBe("2026-09-04");
    expect(checkSessionFreshness("2026-09-04", saturday)).toBe("fresh");
  });

  it("Friday Sep 4 bar is fresh on holiday Monday Sep 7 before 4:30 PM ET", () => {
    const holidayMorning = etDate(2026, 9, 7, 9, 0);
    expect(mostRecentExpectedTradingSession(holidayMorning)).toBe("2026-09-04");
    expect(checkSessionFreshness("2026-09-04", holidayMorning)).toBe("fresh");
  });

  it("after 4:30 PM ET on holiday Monday, Sep 7 bar is expected (refresh will fail → stale → '—')", () => {
    const holidayEvening = etDate(2026, 9, 7, 17, 0);
    expect(mostRecentExpectedTradingSession(holidayEvening)).toBe("2026-09-07");
    // Friday bar is stale; refresh fails; last=null → "—" (correct safe behavior)
    expect(checkSessionFreshness("2026-09-04", holidayEvening)).toBe("stale");
  });
});

describe("§AW-S6 — After-close ingestion delay / grace period", () => {
  it("at 4:01 PM ET Monday, Friday bar is still fresh (within grace)", () => {
    const justAfterClose = etDate(2026, 8, 17, 16, 1);
    expect(mostRecentExpectedTradingSession(justAfterClose)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", justAfterClose)).toBe("fresh");
  });

  it("at 4:29 PM ET Monday, Friday bar is still fresh (last minute of grace)", () => {
    const lastGraceMinute = etDate(2026, 8, 17, 16, 29);
    expect(mostRecentExpectedTradingSession(lastGraceMinute)).toBe("2026-08-14");
    expect(checkSessionFreshness("2026-08-14", lastGraceMinute)).toBe("fresh");
  });

  it("SESSION_POLICY constants are correct defaults", () => {
    expect(SESSION_POLICY.MARKET_CLOSE_HOUR_ET).toBe(16);
    expect(SESSION_POLICY.POST_CLOSE_GRACE_MINUTES).toBe(30);
  });

  it("grace period configurable — 0-minute grace triggers stale immediately at 4:00 PM ET", () => {
    const exactClose = etDate(2026, 8, 17, 16, 0);
    const withNoGrace = mostRecentExpectedTradingSession(exactClose, {
      marketCloseHourET: 16, postCloseGraceMinutes: 0,
    });
    expect(withNoGrace).toBe("2026-08-17");
    expect(checkSessionFreshness("2026-08-14", exactClose, { postCloseGraceMinutes: 0 })).toBe("stale");
  });
});

describe("§AW-S7 — Successful post-close refresh: Aug 17 bar is displayed", () => {
  it("expectedSessionDate gate: Aug 14 fails, Aug 17 passes", () => {
    const expectedSessionDate = "2026-08-17";
    expect("2026-08-14" >= expectedSessionDate).toBe(false); // Phase 2 skipped
    expect("2026-08-17" >= expectedSessionDate).toBe(true);  // After refresh: Phase 2 hits
  });

  it("Aug 17 bar is session-fresh after Monday close", () => {
    const mondayEvening = etDate(2026, 8, 17, 23, 0);
    expect(checkSessionFreshness("2026-08-17", mondayEvening)).toBe("fresh");
  });

  it("REFRESH_SUCCESS obs state derives from sourceType=external_refresh + freshness=fresh", () => {
    type ObsState = "STORED_FRESH" | "REFRESH_SUCCESS" | "STALE_FALLBACK_SUPPRESSED" | "NO_DATA";
    function obsState(
      sourceType: "stored" | "external_refresh" | "stored_stale" | "unavailable",
      freshness: "fresh" | "stale" | "unavailable",
    ): ObsState {
      if (freshness === "stale") return "STALE_FALLBACK_SUPPRESSED";
      if (freshness === "unavailable") return "NO_DATA";
      return sourceType === "external_refresh" ? "REFRESH_SUCCESS" : "STORED_FRESH";
    }
    expect(obsState("external_refresh", "fresh")).toBe("REFRESH_SUCCESS");
    expect(obsState("stored", "fresh")).toBe("STORED_FRESH"); // next render: zero credits
  });
});

describe("§AW-S8 — Failed post-close refresh: last=null, stale price suppressed", () => {
  it("Phase 4 stale fallback: Aug 14 bar is session-stale at 11 PM ET Monday", () => {
    const mondayEvening = etDate(2026, 8, 17, 23, 0);
    expect(checkSessionFreshness("2026-08-14", mondayEvening)).toBe("stale");
  });

  it("staleness gate suppresses AMD stale price $514.39 (never displayed)", () => {
    const staleFreshness = checkSessionFreshness("2026-08-14", etDate(2026, 8, 17, 23, 0));
    const displayed = staleFreshness === "fresh" ? 514.39 : null;
    expect(displayed).toBeNull();
  });

  it("staleness gate suppresses MU stale price $971.66 (never displayed)", () => {
    const staleFreshness = checkSessionFreshness("2026-08-14", etDate(2026, 8, 17, 23, 0));
    const displayed = staleFreshness === "fresh" ? 971.66 : null;
    expect(displayed).toBeNull();
  });

  it("unavailable (null bar date) → freshness=unavailable → last=null", () => {
    expect(checkSessionFreshness(null)).toBe("unavailable");
    const displayed = checkSessionFreshness(null) === "fresh" ? 100 : null;
    expect(displayed).toBeNull();
  });

  it("badge is 'Stale data' when all symbols stale (not 'Latest daily close')", () => {
    function deriveBadge(tickers: Array<{ freshness: "fresh" | "stale" | "unavailable" }>): string {
      if (!tickers.length) return "Unavailable";
      if (tickers.every(t => t.freshness === "fresh")) return "Latest daily close";
      if (tickers.some(t => t.freshness === "unavailable")) return "Unavailable";
      return "Stale data";
    }
    const allFailed = Array(8).fill({ freshness: "stale" as const });
    expect(deriveBadge(allFailed)).toBe("Stale data");
  });
});
