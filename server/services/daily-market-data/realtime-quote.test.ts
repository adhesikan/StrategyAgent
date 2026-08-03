// Tests for the Twelve Data real-time quote fallback (no-broker users).
// Run: npx vitest run --root . server/services/daily-market-data/realtime-quote.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { normalizeQuotePayload, _clearRealtimeQuoteCache } from "./realtime-quote";
import { MarketDataProviderError } from "./types";

// Deterministic timestamps (ET sessions): 2026-08-03 is a Monday.
const REGULAR = new Date("2026-08-03T18:00:00Z"); // 2:00 PM ET → regular
const PRE = new Date("2026-08-03T12:00:00Z"); // 8:00 AM ET → pre
const AFTER = new Date("2026-08-03T22:00:00Z"); // 6:00 PM ET → after

function payload(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "NVDA",
    close: "360.10",
    previous_close: "355.00",
    change: "5.10",
    percent_change: "1.4366",
    volume: "12345678",
    is_market_open: true,
    ...overrides,
  };
}

beforeEach(() => _clearRealtimeQuoteCache());

describe("normalizeQuotePayload", () => {
  it("regular hours: uses live close as last", () => {
    const q = normalizeQuotePayload(payload(), "NVDA", REGULAR);
    expect(q.last).toBe(360.1);
    expect(q.change).toBe(5.1);
    expect(q.changePercent).toBeCloseTo(1.4366);
    expect(q.volume).toBe(12345678);
    expect(q.session).toBe("regular");
    expect(q.extendedHours).toBe(false);
    expect(q.source).toBe("twelve_data_quote");
  });

  it("pre-market: prefers extended_price when market closed", () => {
    const q = normalizeQuotePayload(
      payload({
        is_market_open: false,
        extended_price: "362.40",
        extended_change: "2.30",
        extended_percent_change: "0.6387",
      }),
      "NVDA",
      PRE,
    );
    expect(q.last).toBe(362.4);
    expect(q.change).toBe(2.3);
    expect(q.changePercent).toBeCloseTo(0.6387);
    expect(q.session).toBe("pre");
    expect(q.extendedHours).toBe(true);
  });

  it("after-hours: extended price wins; derives change vs previous close when provider omits it", () => {
    const q = normalizeQuotePayload(
      payload({ is_market_open: false, extended_price: "358.00" }),
      "NVDA",
      AFTER,
    );
    expect(q.last).toBe(358);
    expect(q.session).toBe("after");
    expect(q.extendedHours).toBe(true);
    expect(q.change).toBeCloseTo(3.0); // 358 - 355 previous close
  });

  it("extended fields absent outside RTH: falls back to regular close honestly", () => {
    const q = normalizeQuotePayload(payload({ is_market_open: false }), "NVDA", AFTER);
    expect(q.last).toBe(360.1);
    expect(q.extendedHours).toBe(false);
    expect(q.session).toBe("after");
  });

  it("never uses extended price during the regular session while market is open", () => {
    const q = normalizeQuotePayload(
      payload({ is_market_open: true, extended_price: "999.99" }),
      "NVDA",
      REGULAR,
    );
    expect(q.last).toBe(360.1);
    expect(q.extendedHours).toBe(false);
  });

  it("throws EMPTY on a priceless payload (never fabricates)", () => {
    expect(() => normalizeQuotePayload({ symbol: "NVDA" }, "NVDA", REGULAR)).toThrow(MarketDataProviderError);
    expect(() => normalizeQuotePayload({ close: "not-a-number" }, "NVDA", REGULAR)).toThrow();
  });

  it("handles string booleans and missing volume", () => {
    const q = normalizeQuotePayload(payload({ is_market_open: "true", volume: undefined }), "NVDA", REGULAR);
    expect(q.isMarketOpen).toBe(true);
    expect(q.volume).toBe(0);
  });
});

describe("source-level safety", () => {
  it("requests prepost data and reserves credits; key redacted on errors; user gate enforced", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./realtime-quote.ts", import.meta.url), "utf8");
    expect(src).toContain('prepost: "true"');
    expect(src).toContain("reserveCreditsBlocking(1)");
    expect(src).toContain("redactApiKey");
    expect(src).toContain("canAccessTwelveDataBackedAnalysis");
    // gated helper returns null (fall through to daily close), never throws to callers
    expect(src).toMatch(/if \(!decision\.allowed\) return null/);
  });
});
