// Reference snapshot technicals — real-data replacement for hash-based mocks.
import { describe, expect, it } from "vitest";

import { computeReferenceTechnicals } from "./reference-snapshot";
import type { NormalizedDailyBar } from "./types";

function bars(closes: number[], volume = 1_000_000): NormalizedDailyBar[] {
  return closes.map((close, i) => ({
    symbol: "TEST",
    tradeDate: `2026-07-${String(i + 1).padStart(2, "0")}`,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    adjustedClose: close,
    volume: i === closes.length - 1 ? volume * 2 : volume, // last day 2x volume
    provider: "twelve_data",
    providerTimestamp: null,
    isComplete: true,
  }));
}

describe("computeReferenceTechnicals", () => {
  it("returns null with insufficient history (never fabricates)", () => {
    expect(computeReferenceTechnicals([])).toBeNull();
    expect(computeReferenceTechnicals(bars([100, 101, 102]))).toBeNull();
  });

  it("computes real EMA/RSI/ATR/RVOL from actual bars", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i); // steady uptrend
    const t = computeReferenceTechnicals(bars(closes))!;
    expect(t.ema9).toBeGreaterThan(t.ema21!); // uptrend: fast EMA above slow
    expect(t.rsi14).toBeGreaterThan(70); // relentless uptrend → high RSI
    expect(t.atr14).toBeGreaterThan(0);
    expect(t.rvol).toBeCloseTo(2 / (1 + 1 / 20), 0); // last-day 2x volume vs avg
    expect(t.high20).toBe(129 * 1.01);
    expect(t.low20).toBe(110 * 0.99);
    expect(t.changePct5d).toBeCloseTo(((129 - 124) / 124) * 100, 5);
  });

  it("downtrend flips the EMA relationship", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
    const t = computeReferenceTechnicals(bars(closes))!;
    expect(t.ema9).toBeLessThan(t.ema21!);
  });
});
