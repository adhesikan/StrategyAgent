// Tests for price-reference-resolver (Task #40).
// All groups: A (precedence), B (freshness), C (integrity), D (ResearchSave gating).
import { describe, test, expect } from "vitest";
import { resolveReferencePrice, type ReferenceResolverDeps } from "../price-reference-resolver";
import type { NormalizedDailyBar } from "../daily-market-data/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tuesday 5 Aug 2026 at noon UTC — used as "now" throughout. */
const NOW = new Date("2026-08-05T12:00:00Z");

function bar(tradeDate: string, close: number): NormalizedDailyBar {
  return { tradeDate, open: close, high: close, low: close, close, volume: 1_000_000 };
}

/** Deps that returns the supplied bars and uses the fixed NOW clock. */
function deps(bars: NormalizedDailyBar[], now = NOW): ReferenceResolverDeps {
  return { fetchHistory: async () => bars, now };
}

/** Deps where history fetch throws. */
function brokenHistoryDeps(now = NOW): ReferenceResolverDeps {
  return {
    fetchHistory: async () => { throw new Error("provider error"); },
    now,
  };
}

/** Recent bars representing a healthy history (yesterday's close = 100). */
const BARS_YESTERDAY = [bar("2026-08-04", 100)];
const BARS_TODAY     = [bar("2026-08-05", 100)];

// ---------------------------------------------------------------------------
// A. Reference precedence
// ---------------------------------------------------------------------------

describe("A: reference precedence", () => {
  test("A01: fresh broker quote used when available (no history needed)", async () => {
    const r = await resolveReferencePrice("MU", 90, deps(BARS_YESTERDAY));
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(90);
    expect(r.conflict).toBe(false);
  });

  test("A02: no broker quote falls back to internal history close", async () => {
    const r = await resolveReferencePrice("MU", null, deps(BARS_YESTERDAY));
    expect(r.source).toBe("internal_history_close");
    expect(r.referencePrice).toBe(100);
    expect(r.conflict).toBe(false);
  });

  test("A03: both missing → unavailable", async () => {
    const r = await resolveReferencePrice("MU", null, brokenHistoryDeps());
    expect(r.source).toBe("unavailable");
    expect(r.referencePrice).toBeNull();
    expect(r.conflict).toBe(false);
  });

  test("A04: non-finite broker quote treated as absent → falls back to history", async () => {
    expect((await resolveReferencePrice("MU", NaN, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("MU", Infinity, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("MU", -10, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("MU", 0, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
  });

  test("A05: broker quote and history agree → broker quote wins (case A)", async () => {
    // broker=95 vs history=100 → 0.95 ratio → within ±40% → broker preferred
    const r = await resolveReferencePrice("MU", 95, deps(BARS_YESTERDAY));
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(95);
  });

  test("A06: broker/history conflict (>40% apart) → unavailable, conflict flagged", async () => {
    // broker=200 vs history=100 → 2× → conflict
    const r = await resolveReferencePrice("MU", 200, deps(BARS_YESTERDAY));
    expect(r.source).toBe("unavailable");
    expect(r.conflict).toBe(true);
    expect(r.referencePrice).toBeNull();
  });

  test("A07: broker below history by >40% → conflict flagged", async () => {
    // broker=50 vs history=100 → 0.50 → conflict
    const r = await resolveReferencePrice("MU", 50, deps(BARS_YESTERDAY));
    expect(r.source).toBe("unavailable");
    expect(r.conflict).toBe(true);
  });

  test("A08: history fetch error with valid broker quote → broker quote used", async () => {
    const r = await resolveReferencePrice("MU", 90, brokenHistoryDeps());
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(90);
    expect(r.conflict).toBe(false);
  });

  test("A09: exactly at conflict boundary — 1.40× is conflict, 1.39× is not", async () => {
    // 140/100 = 1.40 → conflict
    const conflict = await resolveReferencePrice("MU", 140, deps([bar("2026-08-04", 100)]));
    expect(conflict.conflict).toBe(true);
    // 139/100 = 1.39 → not conflict (broker preferred)
    const ok = await resolveReferencePrice("MU", 139, deps([bar("2026-08-04", 100)]));
    expect(ok.conflict).toBe(false);
    expect(ok.source).toBe("broker_quote");
  });

  test("A10: exactly at lower conflict boundary — 0.60× is conflict, 0.61× is not", async () => {
    const conflict = await resolveReferencePrice("MU", 60, deps([bar("2026-08-04", 100)]));
    expect(conflict.conflict).toBe(true);
    const ok = await resolveReferencePrice("MU", 61, deps([bar("2026-08-04", 100)]));
    expect(ok.conflict).toBe(false);
  });

  test("A11: undefined quote treated same as null (absent)", async () => {
    const r = await resolveReferencePrice("MU", undefined, deps(BARS_YESTERDAY));
    expect(r.source).toBe("internal_history_close");
  });
});

// ---------------------------------------------------------------------------
// B. Freshness policy
// ---------------------------------------------------------------------------

describe("B: freshness policy", () => {
  test("B01: same-day candle → fresh", async () => {
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-05", 100)]));
    expect(r.freshness).toBe("fresh");
  });

  test("B02: yesterday's candle → fresh", async () => {
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    expect(r.freshness).toBe("fresh");
  });

  test("B03: Friday close on Sunday → acceptable (≤5 calendar days)", async () => {
    // now = Sunday 2026-08-09, tradeDate = Friday 2026-08-07 → 2 days → acceptable
    const sun = new Date("2026-08-09T12:00:00Z");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-07", 100)], sun));
    expect(r.freshness).toBe("acceptable");
  });

  test("B04: multi-day gap within 5 days → acceptable", async () => {
    // now = 2026-08-05, tradeDate = 2026-07-31 → 5 days → acceptable boundary
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-07-31", 100)]));
    expect(r.freshness).toBe("acceptable");
  });

  test("B05: stale close (>5 calendar days) → stale but still returned as reference", async () => {
    // 10 days old
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-07-26", 100)]));
    expect(r.source).toBe("internal_history_close");
    expect(r.freshness).toBe("stale");
    expect(r.referencePrice).toBe(100);  // still used as reference — caller decides
  });

  test("B06: future-dated candle rejected, previous valid candle used", async () => {
    const r = await resolveReferencePrice("MU", null, deps([
      bar("2026-08-10", 999),  // future → rejected
      bar("2026-08-04", 100),  // valid
    ]));
    expect(r.referencePrice).toBe(100);
    expect(r.freshness).toBe("fresh");
  });

  test("B07: only a future candle → unavailable", async () => {
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-10", 999)]));
    expect(r.source).toBe("unavailable");
    expect(r.referencePrice).toBeNull();
  });

  test("B08: malformed candle (close=0) skipped, valid candle used", async () => {
    const broken = { ...bar("2026-08-04", 0), close: 0 };
    const r = await resolveReferencePrice("MU", null, deps([broken, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B09: malformed candle (close=NaN) skipped", async () => {
    const brokenNaN = { ...bar("2026-08-04", 100), close: NaN };
    const r = await resolveReferencePrice("MU", null, deps([brokenNaN, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B10: malformed candle (close=-5) skipped", async () => {
    const brokenNeg = { ...bar("2026-08-04", 100), close: -5 };
    const r = await resolveReferencePrice("MU", null, deps([brokenNeg, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B11: multiple bars → latest non-future valid close used", async () => {
    // Bars in oldest-to-newest order; resolver should pick newest valid non-future
    const r = await resolveReferencePrice("MU", null, deps([
      bar("2026-07-30", 95),
      bar("2026-08-01", 98),
      bar("2026-08-04", 101),
      bar("2026-08-10", 200),  // future → skip
    ]));
    expect(r.referencePrice).toBe(101);
    expect(r.freshness).toBe("fresh"); // 1 day old
  });

  test("B12: live broker quote is always 'fresh'", async () => {
    const r = await resolveReferencePrice("MU", 90, deps([]));
    expect(r.source).toBe("broker_quote");
    expect(r.freshness).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// C. Integrity (resolver result feeding into checkPriceIntegrity)
// ---------------------------------------------------------------------------

describe("C: integrity via resolved reference", () => {
  // These tests verify that the resolver's output feeds correctly into
  // the integrity checker (not testing the checker's own ratio logic,
  // but rather the end-to-end path for disconnected users).

  test("C01: history close matches setup → integrity ok (setup ≈ reference)", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrity(101, r.referencePrice, r.source);
    expect(result.valid).toBe(true);
  });

  test("C02: 10× setup mismatch against history → integrity fails", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 90)]));
    const result = checkPriceIntegrity(900, r.referencePrice, r.source);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("10x");
  });

  test("C03: 100× mismatch against history → integrity fails", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 90)]));
    const result = checkPriceIntegrity(9000, r.referencePrice, r.source);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("100x");
  });

  test("C04: legitimate intraday gap within ±15% → valid", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrity(112, r.referencePrice, r.source);
    expect(result.valid).toBe(true);
  });

  test("C05: large overnight gap outside ±15% → divergent (expected limitation)", async () => {
    // A 25% gap is legitimate but exceeds the ±15% tolerance.
    // This is a documented limitation of the cross-check.
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrity(125, r.referencePrice, r.source);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("divergent");
  });

  test("C06: referenceSource is propagated from resolver to checker result", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrity(100, r.referencePrice, r.source);
    expect(result.referenceSource).toBe("internal_history_close");
  });
});

// ---------------------------------------------------------------------------
// D. ResearchSave gating (via resolver output)
// ---------------------------------------------------------------------------

describe("D: ResearchSave gating behavior", () => {
  test("D01: disconnected user with valid history and matching setup → save allowed", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrity(102, r.referencePrice, r.source);
    // save allowed when: no conflict AND integrity.valid === true
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(true);
  });

  test("D02: disconnected user with mismatched setup → save blocked", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrity(1000, r.referencePrice, r.source);
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(false);
  });

  test("D03: no reference at all → save blocked (PRICE_REFERENCE_UNAVAILABLE)", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", null, brokenHistoryDeps());
    const integrity = checkPriceIntegrity(100, r.referencePrice, r.source);
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(false);
    expect(integrity.code).toBe("PRICE_REFERENCE_UNAVAILABLE");
  });

  test("D04: conflict detected → save blocked (conflict flag)", async () => {
    // broker=200 vs history=100 → conflict
    const r = await resolveReferencePrice("MU", 200, deps([bar("2026-08-04", 100)]));
    expect(r.conflict).toBe(true);
    // Caller should not attempt checkPriceIntegrity; conflict alone blocks save.
  });

  test("D05: connected user with valid quote and matching setup → save allowed (unchanged)", async () => {
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const r = await resolveReferencePrice("MU", 95, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrity(97, r.referencePrice, r.source);
    expect(r.source).toBe("broker_quote");
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. Regression
// ---------------------------------------------------------------------------

describe("E: regression", () => {
  test("E01: MU scenario — correctly scaled setup passes with history", async () => {
    // Real MU price ~89; setup price correctly at ~89
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 89.35)]));
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const result = checkPriceIntegrity(88.5, r.referencePrice, r.source);
    expect(result.valid).toBe(true);
  });

  test("E02: MU scenario — 10× inflated setup blocked with history", async () => {
    // MCP returns 893.5, history shows 89.35
    const r = await resolveReferencePrice("MU", null, deps([bar("2026-08-04", 89.35)]));
    const { checkPriceIntegrity } = await import("../price-integrity-checker");
    const result = checkPriceIntegrity(893.5, r.referencePrice, r.source);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("10x");
  });

  test("E03: resolver is stateless — same symbol called twice gives same result", async () => {
    const d = deps([bar("2026-08-04", 100)]);
    const r1 = await resolveReferencePrice("MU", null, d);
    const r2 = await resolveReferencePrice("MU", null, d);
    expect(r1.referencePrice).toBe(r2.referencePrice);
    expect(r1.source).toBe(r2.source);
  });
});
