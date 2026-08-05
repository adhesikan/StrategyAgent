// Tests for the independent price integrity checker (Production Safety Fix).
import { describe, test, expect } from "vitest";
import {
  checkPriceIntegrity,
  safeIntegrityResult,
  AFFECTED_PRICE_FIELDS,
} from "../price-integrity-checker";

// ---------------------------------------------------------------------------
// A. Independent reference validation
// ---------------------------------------------------------------------------

describe("A: independent reference validation", () => {
  test("A01: matching setup and history close — valid", () => {
    const r = checkPriceIntegrity(100, 100);
    expect(r.valid).toBe(true);
    expect(r.ratioCategory).toBe("ok");
    expect(r.code).toBeUndefined();
  });

  test("A02: legitimate small quote/history variance (±14%) — valid", () => {
    expect(checkPriceIntegrity(110, 100).valid).toBe(true);   // +10%
    expect(checkPriceIntegrity(90, 100).valid).toBe(true);    // -10%
    expect(checkPriceIntegrity(114, 100).valid).toBe(true);   // +14%
    expect(checkPriceIntegrity(86, 100).valid).toBe(true);    // -14%
  });

  test("A03: exactly at tolerance boundary — edge cases", () => {
    // 0.85× boundary
    expect(checkPriceIntegrity(85, 100).valid).toBe(true);    // 0.85 — valid
    expect(checkPriceIntegrity(84, 100).valid).toBe(false);   // 0.84 — divergent
    // 1.15× boundary
    expect(checkPriceIntegrity(115, 100).valid).toBe(true);   // 1.15 — valid
    expect(checkPriceIntegrity(116, 100).valid).toBe(false);  // 1.16 — divergent
  });

  test("A04: approximately 10× mismatch detected (setup >> reference)", () => {
    const r = checkPriceIntegrity(893.5, 89.35);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_MISMATCH");
    expect(r.ratioCategory).toBe("10x");
    expect(r.affectedFields).toEqual(expect.arrayContaining(["currentPrice", "trigger", "invalidation"]));
    expect(r.setupPrice).toBe(893.5);
    expect(r.referencePrice).toBe(89.35);
  });

  test("A05: approximately 0.1× mismatch detected (setup << reference)", () => {
    const r = checkPriceIntegrity(9.5, 95);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_MISMATCH");
    expect(r.ratioCategory).toBe("0.1x");
  });

  test("A06: approximately 100× mismatch detected", () => {
    const r = checkPriceIntegrity(9500, 95);
    expect(r.valid).toBe(false);
    expect(r.ratioCategory).toBe("100x");
  });

  test("A07: approximately 0.01× mismatch detected", () => {
    const r = checkPriceIntegrity(0.95, 95);
    expect(r.valid).toBe(false);
    expect(r.ratioCategory).toBe("0.01x");
  });

  test("A08: material unexplained divergence (not a clean decimal order)", () => {
    // 3× divergence — not 10× or 100×
    const r = checkPriceIntegrity(300, 100);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_MISMATCH");
    expect(r.ratioCategory).toBe("divergent");
  });

  test("A09: missing setup price — unavailable", () => {
    const r = checkPriceIntegrity(null, 100);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_UNAVAILABLE");
    expect(r.ratioCategory).toBeUndefined();
  });

  test("A10: missing reference price — unavailable", () => {
    const r = checkPriceIntegrity(100, null);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_UNAVAILABLE");
  });

  test("A11: non-finite setup price — PRICE_NON_FINITE", () => {
    expect(checkPriceIntegrity(NaN, 100).code).toBe("PRICE_NON_FINITE");
    expect(checkPriceIntegrity(Infinity, 100).code).toBe("PRICE_NON_FINITE");
    expect(checkPriceIntegrity(-100, 100).code).toBe("PRICE_NON_FINITE");
    expect(checkPriceIntegrity(0, 100).code).toBe("PRICE_NON_FINITE");
  });

  test("A12: non-finite reference price — PRICE_REFERENCE_UNAVAILABLE", () => {
    expect(checkPriceIntegrity(100, NaN).code).toBe("PRICE_REFERENCE_UNAVAILABLE");
    expect(checkPriceIntegrity(100, -5).code).toBe("PRICE_REFERENCE_UNAVAILABLE");
    expect(checkPriceIntegrity(100, 0).code).toBe("PRICE_REFERENCE_UNAVAILABLE");
  });

  test("A13: both undefined — unavailable (not a crash)", () => {
    const r = checkPriceIntegrity(undefined, undefined);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PRICE_REFERENCE_UNAVAILABLE");
  });

  test("A14: all affected price fields listed on mismatch", () => {
    const r = checkPriceIntegrity(1000, 100);
    expect(r.affectedFields).toEqual(expect.arrayContaining(AFFECTED_PRICE_FIELDS as string[]));
  });

  test("A15: referenceSource is included in the result", () => {
    const r1 = checkPriceIntegrity(100, 100, "live_quote");
    expect(r1.referenceSource).toBe("live_quote");
    const r2 = checkPriceIntegrity(100, 100, "market_history");
    expect(r2.referenceSource).toBe("market_history");
  });

  test("A16: stale reference with fresh history — treated same as any reference", () => {
    // The integrity checker treats all numeric references the same;
    // staleness is a caller-level concern, not a checker concern.
    const r = checkPriceIntegrity(100, 101, "stale_history");
    expect(r.valid).toBe(true);
    expect(r.referenceSource).toBe("stale_history");
  });

  test("A17: band boundary — 8× is 10x, 12× is 10x, 7× is divergent", () => {
    expect(checkPriceIntegrity(800, 100).ratioCategory).toBe("10x");   // 8×
    expect(checkPriceIntegrity(1200, 100).ratioCategory).toBe("10x");  // 12×
    expect(checkPriceIntegrity(700, 100).ratioCategory).toBe("divergent"); // 7×
    expect(checkPriceIntegrity(1300, 100).ratioCategory).toBe("divergent"); // 13×
  });
});

// ---------------------------------------------------------------------------
// B. safeIntegrityResult — no raw prices forwarded to client
// ---------------------------------------------------------------------------

describe("B: safeIntegrityResult strips raw prices", () => {
  test("B01: strips setupPrice and referencePrice from mismatch result", () => {
    const r = checkPriceIntegrity(1000, 100);
    expect(r.setupPrice).toBeDefined();
    expect(r.referencePrice).toBeDefined();
    const safe = safeIntegrityResult(r);
    expect((safe as any).setupPrice).toBeUndefined();
    expect((safe as any).referencePrice).toBeUndefined();
  });

  test("B02: preserves all non-price fields", () => {
    const r = checkPriceIntegrity(1000, 100, "live_quote");
    const safe = safeIntegrityResult(r);
    expect(safe.valid).toBe(false);
    expect(safe.code).toBe("PRICE_REFERENCE_MISMATCH");
    expect(safe.ratioCategory).toBe("10x");
    expect(safe.referenceSource).toBe("live_quote");
    expect(safe.affectedFields).toBeDefined();
  });

  test("B03: valid result has no raw prices to strip (no-op)", () => {
    const r = checkPriceIntegrity(100, 102);
    const safe = safeIntegrityResult(r);
    expect(safe.valid).toBe(true);
    expect((safe as any).setupPrice).toBeUndefined();
    expect((safe as any).referencePrice).toBeUndefined();
  });
});
