// generateReferenceSetup — Trade Builder fallback anchored to REAL data.
import { describe, expect, it } from "vitest";

import { generateReferenceSetup, type ReferenceAnchor } from "./strategy-engine";

const anchor: ReferenceAnchor = {
  lastPrice: 342.09,
  prevClose: 347.15,
  realtime: false,
  ema9: 351.78,
  ema21: 355.97,
  rsi14: 41,
  atr14: 11.12,
  high20: 372.4,
  low20: 335.1,
  rvol: 0.95,
  changePct5d: -3.1,
};

describe("generateReferenceSetup", () => {
  it("anchors every number to the real quote/bars — no hardcoded default prices", () => {
    const s = generateReferenceSetup({ symbol: "GOOGL", assetType: "option" } as any, anchor);
    expect(s.metrics.currentPrice).toBe(342.09);
    expect(s.entry).toBe(342.09);
    expect(s.metrics.ema9).toBe(351.78);
    expect(s.metrics.ema21).toBe(355.97);
    expect(s.metrics.rvol).toBe(0.95);
    // ema9 < ema21 → bearish, honestly derived from real EMAs
    expect(s.bias).toBe("bearish");
    expect(s.metrics.trend).toBe("Bearish (EMA9 < EMA21)");
    // stop derived from real ATR on the bearish side (above price)
    expect(s.stop).toBeGreaterThan(s.entry);
    expect(s.targets[0]).toBeLessThan(s.entry);
    // never the old fabricated values
    expect(s.metrics.rvol).not.toBe(2.1);
    expect(s.modelScore).toBeNull(); // no invented score without an intraday signal
    expect(s.dataSource).toContain("delayed reference (real daily market data)");
  });

  it("uses real-time labeling when the price came from a live Twelve Data quote", () => {
    const s = generateReferenceSetup({ symbol: "GOOGL" } as any, { ...anchor, realtime: true, ema9: 356, ema21: 355 });
    expect(s.bias).toBe("bullish");
    expect(s.dataSource).toContain("twelve data (real-time quote + daily bars)");
    expect(s.reasoning[0]).toContain("live market price");
  });

  it("omits intraday-only fields and admits missing indicators instead of fabricating", () => {
    const s = generateReferenceSetup({ symbol: "XYZ" } as any, {
      ...anchor,
      ema9: null,
      ema21: null,
      rvol: null,
      rsi14: null,
    });
    expect(s.metrics.openingRangeHigh).toBeUndefined();
    expect(s.metrics.vwap).toBeUndefined();
    expect(s.metrics.trend).toBeUndefined();
    expect(s.metrics.rvol).toBeUndefined();
    expect(s.metrics.volume).toBe("N/A");
    expect(s.reasoning.join(" ")).toContain("Trend indicators unavailable");
  });

  it("falls back to a price-proportional ATR when ATR is unavailable, still real-price anchored", () => {
    // With no ATR the band is 1.5% of price; the real 20-day low (335.10) sits
    // inside the 1.5x band, so the structure stop wins: 335.10 * 0.995.
    const s = generateReferenceSetup({ symbol: "GOOGL" } as any, { ...anchor, atr14: null, ema9: 356, ema21: 355 });
    expect(s.stop).toBeLessThan(s.entry);
    expect(s.stop).toBeCloseTo(335.1 * 0.995, 1);
    // Without real structure inside the band, the pure volatility stop applies.
    const s2 = generateReferenceSetup({ symbol: "GOOGL" } as any, { ...anchor, atr14: null, low20: 200, ema9: 356, ema21: 355 });
    expect(s2.entry - s2.stop).toBeCloseTo(342.09 * 0.015, 1);
  });
});
