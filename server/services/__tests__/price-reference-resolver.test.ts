// Tests for price-reference-resolver (Task #40 + false-positive resolution).
// All groups: A (precedence), B (freshness), C (integrity), D (ResearchSave gating), E (regression).
import { describe, test, expect } from "vitest";
import { resolveReferencePrice, type ReferenceResolverDeps } from "../price-reference-resolver";
import { checkPriceIntegrityFromResolved } from "../price-integrity-checker";
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

// Synthetic fixtures: deliberately invented values for ratio-behavior testing.
// These are NOT assertions about any real symbol's market price.
// Named explicitly to make the synthetic nature clear at every call site.
const syntheticDecimalOrderMismatchFixture = {
  /** A synthetic reference price used as the "correct" scale baseline. */
  referenceClose: 100,
  /** A synthetic setup price exactly 10× larger — a decimal-order error. */
  setupPriceTenX: 1000,
};

// ---------------------------------------------------------------------------
// A. Reference precedence
// ---------------------------------------------------------------------------

describe("A: reference precedence", () => {
  test("A01: fresh broker quote used when available (no history needed)", async () => {
    const r = await resolveReferencePrice("SYN", 90, deps(BARS_YESTERDAY));
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(90);
    expect(r.conflict).toBe(false);
    expect(r.canCompareRatio).toBe(true);
  });

  test("A02: no broker quote falls back to internal history close", async () => {
    const r = await resolveReferencePrice("SYN", null, deps(BARS_YESTERDAY));
    expect(r.source).toBe("internal_history_close");
    expect(r.referencePrice).toBe(100);
    expect(r.conflict).toBe(false);
    expect(r.canCompareRatio).toBe(true);
  });

  test("A03: both missing → unavailable", async () => {
    const r = await resolveReferencePrice("SYN", null, brokenHistoryDeps());
    expect(r.source).toBe("unavailable");
    expect(r.referencePrice).toBeNull();
    expect(r.conflict).toBe(false);
    expect(r.canCompareRatio).toBe(false);
  });

  test("A04: non-finite broker quote treated as absent → falls back to history", async () => {
    expect((await resolveReferencePrice("SYN", NaN, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("SYN", Infinity, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("SYN", -10, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
    expect((await resolveReferencePrice("SYN", 0, deps(BARS_YESTERDAY))).source).toBe("internal_history_close");
  });

  test("A05: broker quote and history agree → broker quote wins (case A)", async () => {
    // broker=95 vs history=100 → 0.95 ratio → within ±40% → broker preferred
    const r = await resolveReferencePrice("SYN", 95, deps(BARS_YESTERDAY));
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(95);
    expect(r.canCompareRatio).toBe(true);
  });

  test("A06: broker/history conflict (>40% apart) → unavailable, conflict flagged", async () => {
    // broker=200 vs history=100 → 2× → conflict
    const r = await resolveReferencePrice("SYN", 200, deps(BARS_YESTERDAY));
    expect(r.source).toBe("unavailable");
    expect(r.conflict).toBe(true);
    expect(r.referencePrice).toBeNull();
    expect(r.canCompareRatio).toBe(false);
  });

  test("A07: broker below history by >40% → conflict flagged", async () => {
    // broker=50 vs history=100 → 0.50 → conflict
    const r = await resolveReferencePrice("SYN", 50, deps(BARS_YESTERDAY));
    expect(r.source).toBe("unavailable");
    expect(r.conflict).toBe(true);
    expect(r.canCompareRatio).toBe(false);
  });

  test("A08: history fetch error with valid broker quote → broker quote used", async () => {
    const r = await resolveReferencePrice("SYN", 90, brokenHistoryDeps());
    expect(r.source).toBe("broker_quote");
    expect(r.referencePrice).toBe(90);
    expect(r.conflict).toBe(false);
    expect(r.canCompareRatio).toBe(true);
  });

  test("A09: exactly at conflict boundary — 1.40× is conflict, 1.39× is not", async () => {
    // 140/100 = 1.40 → conflict
    const conflict = await resolveReferencePrice("SYN", 140, deps([bar("2026-08-04", 100)]));
    expect(conflict.conflict).toBe(true);
    expect(conflict.canCompareRatio).toBe(false);
    // 139/100 = 1.39 → not conflict (broker preferred)
    const ok = await resolveReferencePrice("SYN", 139, deps([bar("2026-08-04", 100)]));
    expect(ok.conflict).toBe(false);
    expect(ok.source).toBe("broker_quote");
    expect(ok.canCompareRatio).toBe(true);
  });

  test("A10: exactly at lower conflict boundary — 0.60× is conflict, 0.61× is not", async () => {
    const conflict = await resolveReferencePrice("SYN", 60, deps([bar("2026-08-04", 100)]));
    expect(conflict.conflict).toBe(true);
    const ok = await resolveReferencePrice("SYN", 61, deps([bar("2026-08-04", 100)]));
    expect(ok.conflict).toBe(false);
  });

  test("A11: undefined quote treated same as null (absent)", async () => {
    const r = await resolveReferencePrice("SYN", undefined, deps(BARS_YESTERDAY));
    expect(r.source).toBe("internal_history_close");
  });
});

// ---------------------------------------------------------------------------
// B. Freshness policy
// ---------------------------------------------------------------------------

describe("B: freshness policy", () => {
  test("B01: same-day candle → fresh, canCompareRatio=true", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-05", 100)]));
    expect(r.freshness).toBe("fresh");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B02: yesterday's candle → fresh, canCompareRatio=true", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    expect(r.freshness).toBe("fresh");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B03: Friday close on Sunday → acceptable, canCompareRatio=true", async () => {
    // now = Sunday 2026-08-09, tradeDate = Friday 2026-08-07 → 2 days → acceptable
    const sun = new Date("2026-08-09T12:00:00Z");
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-07", 100)], sun));
    expect(r.freshness).toBe("acceptable");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B04: multi-day gap within 5 days → acceptable, canCompareRatio=true", async () => {
    // now = 2026-08-05, tradeDate = 2026-07-31 → 5 days → acceptable boundary
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-07-31", 100)]));
    expect(r.freshness).toBe("acceptable");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B05: stale close (>5 calendar days) → stale, canCompareRatio=false", async () => {
    // 10 days old — stale reference must NOT be used for ratio classification
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-07-26", 100)]));
    expect(r.source).toBe("internal_history_close");
    expect(r.freshness).toBe("stale");
    expect(r.referencePrice).toBe(100);  // price is still returned for diagnostics
    expect(r.canCompareRatio).toBe(false); // but ratio comparison is blocked
  });

  test("B06: future-dated candle rejected, previous valid candle used", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([
      bar("2026-08-10", 999),  // future → rejected
      bar("2026-08-04", 100),  // valid
    ]));
    expect(r.referencePrice).toBe(100);
    expect(r.freshness).toBe("fresh");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B07: only a future candle → unavailable", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-10", 999)]));
    expect(r.source).toBe("unavailable");
    expect(r.referencePrice).toBeNull();
    expect(r.canCompareRatio).toBe(false);
  });

  test("B08: malformed candle (close=0) skipped, valid candle used", async () => {
    const broken = { ...bar("2026-08-04", 0), close: 0 };
    const r = await resolveReferencePrice("SYN", null, deps([broken, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B09: malformed candle (close=NaN) skipped", async () => {
    const brokenNaN = { ...bar("2026-08-04", 100), close: NaN };
    const r = await resolveReferencePrice("SYN", null, deps([brokenNaN, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B10: malformed candle (close=-5) skipped", async () => {
    const brokenNeg = { ...bar("2026-08-04", 100), close: -5 };
    const r = await resolveReferencePrice("SYN", null, deps([brokenNeg, bar("2026-08-03", 100)]));
    expect(r.referencePrice).toBe(100);
  });

  test("B11: multiple bars → latest non-future valid close used", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([
      bar("2026-07-30", 95),
      bar("2026-08-01", 98),
      bar("2026-08-04", 101),
      bar("2026-08-10", 200),  // future → skip
    ]));
    expect(r.referencePrice).toBe(101);
    expect(r.freshness).toBe("fresh"); // 1 day old
    expect(r.canCompareRatio).toBe(true);
  });

  test("B12: live broker quote is always 'fresh' with canCompareRatio=true", async () => {
    const r = await resolveReferencePrice("SYN", 90, deps([]));
    expect(r.source).toBe("broker_quote");
    expect(r.freshness).toBe("fresh");
    expect(r.canCompareRatio).toBe(true);
  });

  test("B13: stale broker fallback to fresh history — stale reference is never preferred over fresh history", async () => {
    // Scenario: no broker quote; history is stale (10 days old).
    // canCompareRatio must be false — a stale reference must not be used
    // to classify a ratio that could reflect legitimate price appreciation.
    const staleRef = await resolveReferencePrice("SYN", null, deps([bar("2026-07-26", 89)]));
    expect(staleRef.canCompareRatio).toBe(false);
    // A ratio comparison using this stale reference must return PRICE_REFERENCE_STALE,
    // not PRICE_REFERENCE_MISMATCH, even when the ratio would be ~10×.
    const result = checkPriceIntegrityFromResolved(893, staleRef);
    expect(result.code).toBe("PRICE_REFERENCE_STALE");
    expect(result.ratioCategory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C. Integrity (resolver result feeding into checkPriceIntegrityFromResolved)
// ---------------------------------------------------------------------------

describe("C: integrity via resolved reference", () => {
  test("C01: fresh history close matches setup → integrity ok", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrityFromResolved(101, r);
    expect(result.valid).toBe(true);
  });

  test("C02: synthetic 10× mismatch with fresh reference → integrity fails (ratioCategory=10x)", async () => {
    // Both setup price and reference are fresh; the 10× gap is a genuine error.
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", syntheticDecimalOrderMismatchFixture.referenceClose)]));
    const result = checkPriceIntegrityFromResolved(syntheticDecimalOrderMismatchFixture.setupPriceTenX, r);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("10x");
  });

  test("C03: 100× mismatch with fresh reference → integrity fails", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 90)]));
    const result = checkPriceIntegrityFromResolved(9000, r);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("100x");
  });

  test("C04: legitimate intraday gap within ±15% → valid", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrityFromResolved(112, r);
    expect(result.valid).toBe(true);
  });

  test("C05: large overnight gap outside ±15% → divergent (documented limitation)", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrityFromResolved(125, r);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("divergent");
  });

  test("C06: referenceSource is propagated from resolver to checker result", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const result = checkPriceIntegrityFromResolved(100, r);
    expect(result.referenceSource).toBe("internal_history_close");
  });

  test("C07: stale history reference → PRICE_REFERENCE_STALE (not a ratio result)", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-07-20", 100)]));
    expect(r.freshness).toBe("stale");
    const result = checkPriceIntegrityFromResolved(105, r);
    expect(result.code).toBe("PRICE_REFERENCE_STALE");
    expect(result.ratioCategory).toBeUndefined();
  });

  test("C08: both sources consistent → broker_quote used, ratio runs normally", async () => {
    const r = await resolveReferencePrice("SYN", 95, deps([bar("2026-08-04", 100)]));
    expect(r.source).toBe("broker_quote");
    const result = checkPriceIntegrityFromResolved(96, r);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. ResearchSave gating (via resolver output)
// ---------------------------------------------------------------------------

describe("D: ResearchSave gating behavior", () => {
  test("D01: disconnected user with fresh history and matching setup → save allowed", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrityFromResolved(102, r);
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(true);
  });

  test("D02: disconnected user with synthetic mismatched setup → save blocked", async () => {
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrityFromResolved(1000, r);
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(false);
  });

  test("D03: no reference at all → save blocked (PRICE_REFERENCE_UNAVAILABLE)", async () => {
    const r = await resolveReferencePrice("SYN", null, brokenHistoryDeps());
    const integrity = checkPriceIntegrityFromResolved(100, r);
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(false);
    expect(integrity.code).toBe("PRICE_REFERENCE_UNAVAILABLE");
  });

  test("D04: conflict detected → save blocked (conflict flag)", async () => {
    // broker=200 vs history=100 → conflict
    const r = await resolveReferencePrice("SYN", 200, deps([bar("2026-08-04", 100)]));
    expect(r.conflict).toBe(true);
    const integrity = checkPriceIntegrityFromResolved(195, r);
    expect(integrity.code).toBe("PRICE_REFERENCE_CONFLICT");
    expect(integrity.valid).toBe(false);
  });

  test("D05: connected user with valid quote and matching setup → save allowed", async () => {
    const r = await resolveReferencePrice("SYN", 95, deps([bar("2026-08-04", 100)]));
    const integrity = checkPriceIntegrityFromResolved(97, r);
    expect(r.source).toBe("broker_quote");
    expect(r.conflict).toBe(false);
    expect(integrity.valid).toBe(true);
  });

  test("D06: stale reference → save blocked with PRICE_REFERENCE_STALE (not a mismatch)", async () => {
    // Stale reference blocks save without claiming 10× corruption.
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-07-20", 89)]));
    const integrity = checkPriceIntegrityFromResolved(893, r);
    // Save should be blocked (valid=false), but the reason is staleness, not mismatch.
    expect(integrity.valid).toBe(false);
    expect(integrity.code).toBe("PRICE_REFERENCE_STALE");
    // Price suppression in the UI should NOT trigger — stale ≠ corrupt.
    expect(integrity.ratioCategory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E. Regression
// ---------------------------------------------------------------------------

describe("E: regression", () => {
  test("E01: synthetic same-scale fixture — correct setup passes with fresh history", async () => {
    // Synthetic fixture: both setup and reference on the same scale (~89).
    // This is NOT an assertion about MU's current market price.
    // It verifies that same-scale fresh references produce valid=true.
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 89.35)]));
    const result = checkPriceIntegrityFromResolved(88.5, r);
    expect(result.valid).toBe(true);
  });

  test("E02: synthetic decimal-order mismatch fixture — 10× inflated setup blocked with fresh history", async () => {
    // Synthetic fixture using the named mismatch values (1000 setup, 100 reference).
    // Both are fresh — the 10× gap is a genuine error, not a long-term price move.
    // This is NOT an assertion about MU or any real symbol's market price.
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", syntheticDecimalOrderMismatchFixture.referenceClose)]));
    const result = checkPriceIntegrityFromResolved(syntheticDecimalOrderMismatchFixture.setupPriceTenX, r);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("10x");
  });

  test("E03: resolver is stateless — same symbol called twice gives same result", async () => {
    const d = deps([bar("2026-08-04", 100)]);
    const r1 = await resolveReferencePrice("SYN", null, d);
    const r2 = await resolveReferencePrice("SYN", null, d);
    expect(r1.referencePrice).toBe(r2.referencePrice);
    expect(r1.source).toBe(r2.source);
    expect(r1.canCompareRatio).toBe(r2.canCompareRatio);
  });

  test("E04: current-scale setup and reference both near 893 → valid (no false positive)", async () => {
    // Verifies that a stock trading at ~$893 with a fresh reference also near $893
    // passes integrity without triggering any mismatch code.
    // This represents the resolved MU false-positive scenario.
    const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", 892)]));
    const result = checkPriceIntegrityFromResolved(893, r);
    expect(result.valid).toBe(true);
    expect(result.ratioCategory).toBe("ok");
  });

  test("E05: stale ~89 reference vs ~893 setup → STALE, not a 10× mismatch", async () => {
    // This is the exact false-positive scenario that was resolved:
    // - A stale reference price from an earlier period (~$89)
    // - A setup price from the current period (~$893, legitimate appreciation)
    // Must NOT be classified as a 10× decimal error.
    const staleDate = "2026-07-20"; // 16 days before NOW
    const r = await resolveReferencePrice("SYN", null, deps([bar(staleDate, 89)]));
    expect(r.freshness).toBe("stale");
    expect(r.canCompareRatio).toBe(false);
    const result = checkPriceIntegrityFromResolved(893, r);
    expect(result.code).toBe("PRICE_REFERENCE_STALE");
    expect(result.ratioCategory).toBeUndefined(); // no ratio classification ran
  });

  test("E06: both sources fresh and consistent → valid regardless of price scale", async () => {
    // High-price stock (e.g. NVDA ~$900): both broker and history agree → valid.
    const r = await resolveReferencePrice("SYN", 905, deps([bar("2026-08-04", 898)]));
    expect(r.source).toBe("broker_quote");
    expect(r.canCompareRatio).toBe(true);
    const result = checkPriceIntegrityFromResolved(903, r);
    expect(result.valid).toBe(true);
  });

  test("E07: genuine integrity failure still suppresses prices and blocks save", async () => {
    // Even with fresh references, a genuine 10× mismatch must still be caught.
    const r = await resolveReferencePrice("SYN", 892, deps([bar("2026-08-04", 890)]));
    expect(r.canCompareRatio).toBe(true);
    // Setup is 10× the broker/history reference — a real scale error.
    const result = checkPriceIntegrityFromResolved(8920, r);
    expect(result.valid).toBe(false);
    expect(result.ratioCategory).toBe("10x");
  });

  test("E08: no symbol-specific price expectations — any positive finite price is accepted as reference", async () => {
    // The resolver makes no assumptions about what any symbol's price "should" be.
    // A close of $0.50, $89, $893, or $3000 are all equally valid.
    const prices = [0.50, 10, 89, 893, 3000];
    for (const price of prices) {
      const r = await resolveReferencePrice("SYN", null, deps([bar("2026-08-04", price)]));
      expect(r.source).toBe("internal_history_close");
      expect(r.referencePrice).toBe(price);
      expect(r.canCompareRatio).toBe(true);
    }
  });
});
