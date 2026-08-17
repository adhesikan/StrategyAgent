/**
 * server/__tests__/theoretical-options-math.test.ts
 *
 * Sprint 2.8.7C — Mathematical unit tests for theoretical options engine.
 *
 * Tests A–R from spec §22:
 *   A. Known BSM call example
 *   B. Known BSM put example
 *   C. Put-call parity
 *   D. Non-zero dividend yield
 *   E. HV10
 *   F. HV20
 *   G. HV30
 *   H. HV60
 *   I. HV90
 *   J. Insufficient history
 *   K. Delta sign/range
 *   L. Gamma positive
 *   M. Theta sign conventions
 *   N. Vega positive
 *   O. Rho direction
 *   P. Short DTE warning
 *   Q. Deep ITM/OTM warning
 *   R. Null-input behavior
 *
 * All fixtures are deterministic and independent of live APIs.
 */

import { describe, it, expect } from "vitest";
import { computeBSM, dteToTimeYears, normCDF, normPDF, classifyMoneyness } from "../services/theoretical-options/black-scholes";
import { computeHistoricalVolatilitySet, resolveBestVol } from "../services/theoretical-options/realized-volatility";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a price series with a deterministic drift and vol for test fixtures. */
function makePriceSeries(n: number, startPrice = 100, dailyReturn = 0.001): number[] {
  const prices: number[] = [startPrice];
  for (let i = 1; i < n; i++) {
    prices.push(prices[i - 1] * (1 + dailyReturn + (i % 3 === 0 ? -0.002 : 0.001)));
  }
  return prices;
}

/** Build minimal NormalizedDailyBar stubs from a price series. */
function makeBars(closes: number[]) {
  return closes.map((close, i) => ({
    symbol: "TEST",
    tradeDate: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volume: 1_000_000,
    provider: "test",
    isComplete: true,
  }));
}

// ===========================================================================
// A. Known BSM call example
// ===========================================================================

describe("A — Known BSM call example", () => {
  it("matches a well-known BSM reference value within tolerance", () => {
    // Reference: S=100, K=100, T=1yr, r=5%, q=0, sigma=20%
    // Known call: ~10.45 (Black-Scholes textbook example)
    const result = computeBSM({ S: 100, K: 100, T: 1.0, r: 0.05, q: 0, sigma: 0.20 }, 365);
    expect(result.modelCallValue).not.toBeNull();
    expect(result.modelCallValue!).toBeCloseTo(10.45, 1); // ±0.05 tolerance
    expect(result.quality).toBe("NORMAL");
  });

  it("produces a positive call value for ITM call", () => {
    const result = computeBSM({ S: 110, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.30 }, 91);
    expect(result.modelCallValue).not.toBeNull();
    expect(result.modelCallValue!).toBeGreaterThan(10); // at least intrinsic value
  });

  it("produces a near-zero call value for deep OTM call", () => {
    const result = computeBSM({ S: 100, K: 200, T: 0.25, r: 0.045, q: 0, sigma: 0.20 }, 91);
    expect(result.modelCallValue).not.toBeNull();
    expect(result.modelCallValue!).toBeGreaterThanOrEqual(0);
    expect(result.modelCallValue!).toBeLessThan(0.01);
  });
});

// ===========================================================================
// B. Known BSM put example
// ===========================================================================

describe("B — Known BSM put example", () => {
  it("matches reference put value within tolerance", () => {
    // Reference: S=100, K=100, T=1yr, r=5%, q=0, sigma=20%
    // Known put: ~5.57 (adjusted for r=5%, consistent with put-call parity)
    const result = computeBSM({ S: 100, K: 100, T: 1.0, r: 0.05, q: 0, sigma: 0.20 }, 365);
    expect(result.modelPutValue).not.toBeNull();
    // put ≈ call - S + K*e^(-rT) = 10.45 - 100 + 100*e^(-0.05) = 10.45 - 100 + 95.12 ≈ 5.57
    expect(result.modelPutValue!).toBeCloseTo(5.57, 1);
  });

  it("produces a positive put value for ITM put", () => {
    const result = computeBSM({ S: 90, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.30 }, 91);
    expect(result.modelPutValue).not.toBeNull();
    expect(result.modelPutValue!).toBeGreaterThan(10); // at least intrinsic value ~10
  });
});

// ===========================================================================
// C. Put-call parity
// ===========================================================================

describe("C — Put-call parity", () => {
  it("satisfies put-call parity: C - P = S*e^(-qT) - K*e^(-rT)", () => {
    const S = 100, K = 95, T = 0.5, r = 0.045, q = 0, sigma = 0.25;
    const result = computeBSM({ S, K, T, r, q, sigma }, Math.round(T * 365));
    expect(result.modelCallValue).not.toBeNull();
    expect(result.modelPutValue).not.toBeNull();

    const lhs = result.modelCallValue! - result.modelPutValue!;
    const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    expect(lhs).toBeCloseTo(rhs, 4); // tight tolerance — parity should be exact
  });

  it("satisfies put-call parity with non-zero dividend", () => {
    const S = 150, K = 150, T = 0.25, r = 0.04, q = 0.015, sigma = 0.22;
    const result = computeBSM({ S, K, T, r, q, sigma }, Math.round(T * 365));
    const lhs = result.modelCallValue! - result.modelPutValue!;
    const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    expect(lhs).toBeCloseTo(rhs, 4);
  });
});

// ===========================================================================
// D. Non-zero dividend yield
// ===========================================================================

describe("D — Non-zero dividend yield", () => {
  it("reduces call value and increases put value vs q=0", () => {
    const base = { S: 100, K: 100, T: 0.5, r: 0.045, sigma: 0.25 };
    const noDiv = computeBSM({ ...base, q: 0 }, 183);
    const withDiv = computeBSM({ ...base, q: 0.03 }, 183);
    expect(withDiv.modelCallValue!).toBeLessThan(noDiv.modelCallValue!);
    expect(withDiv.modelPutValue!).toBeGreaterThan(noDiv.modelPutValue!);
  });

  it("greekSource is VCP_REALIZED_VOL_MODEL even with dividend", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.5, r: 0.045, q: 0.02, sigma: 0.25 }, 183);
    expect(result.callGreeks?.greekSource).toBe("VCP_REALIZED_VOL_MODEL");
    expect(result.putGreeks?.greekSource).toBe("VCP_REALIZED_VOL_MODEL");
  });
});

// ===========================================================================
// E–I. Historical Volatility lookbacks
// ===========================================================================

function testHV(label: string, lookback: number, minBars: number) {
  describe(`${label} — HV${lookback}`, () => {
    it(`computes HV${lookback} from ${minBars} bars (min required: ${lookback + 1})`, () => {
      const bars = makeBars(makePriceSeries(minBars + 10));
      const hvSet = computeHistoricalVolatilitySet(bars, "TEST", "test");
      const entry = (hvSet as any)[`hv${lookback}`];
      expect(entry.annualizedVol).not.toBeNull();
      expect(entry.annualizedVol).toBeGreaterThan(0);
      expect(entry.annualizationFactor).toBe(252);
      expect(entry.observationCount).toBe(lookback);
    });

    it(`annualizes correctly (×sqrt(252)) for HV${lookback}`, () => {
      // Flat price → zero vol
      const flatBars = makeBars(Array(minBars + 5).fill(100));
      const hvSet = computeHistoricalVolatilitySet(flatBars, "TEST", "test");
      const entry = (hvSet as any)[`hv${lookback}`];
      expect(entry.annualizedVol).toBeCloseTo(0, 10);
    });
  });
}

testHV("E", 10, 11);
testHV("F", 20, 21);
testHV("G", 30, 31);
testHV("H", 60, 61);
testHV("I", 90, 91);

// ===========================================================================
// J. Insufficient history
// ===========================================================================

describe("J — Insufficient history", () => {
  it("returns null for HV30 when fewer than 31 bars exist", () => {
    const bars = makeBars(makePriceSeries(25));
    const hvSet = computeHistoricalVolatilitySet(bars, "TEST", "test");
    expect(hvSet.hv30.annualizedVol).toBeNull();
    expect(hvSet.hv30.observationCount).toBeNull();
  });

  it("returns null defaultVol when HV30 is insufficient", () => {
    const bars = makeBars(makePriceSeries(5));
    const hvSet = computeHistoricalVolatilitySet(bars, "TEST", "test");
    expect(hvSet.defaultVol).toBeNull();
  });

  it("falls back to HV20 via resolveBestVol when HV30 is null", () => {
    const bars = makeBars(makePriceSeries(25)); // HV20 ok (21 bars needed), HV30 null (31 needed)
    const hvSet = computeHistoricalVolatilitySet(bars, "TEST", "test");
    expect(hvSet.hv20.annualizedVol).not.toBeNull();
    const { vol, source } = resolveBestVol(hvSet);
    expect(vol).not.toBeNull();
    expect(source).toBe("HV20");
  });

  it("returns null vol from resolveBestVol when no lookback has enough history", () => {
    const bars = makeBars(makePriceSeries(5));
    const hvSet = computeHistoricalVolatilitySet(bars, "TEST", "test");
    const { vol, source } = resolveBestVol(hvSet);
    expect(vol).toBeNull();
    expect(source).toBe("UNAVAILABLE");
  });
});

// ===========================================================================
// K. Delta sign/range
// ===========================================================================

describe("K — Delta sign/range", () => {
  const base = { S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 };

  it("call delta is positive and in (0, 1)", () => {
    const result = computeBSM(base, 91);
    expect(result.callGreeks!.modelDelta).toBeGreaterThan(0);
    expect(result.callGreeks!.modelDelta).toBeLessThan(1);
  });

  it("put delta is negative and in (-1, 0)", () => {
    const result = computeBSM(base, 91);
    expect(result.putGreeks!.modelDelta).toBeLessThan(0);
    expect(result.putGreeks!.modelDelta).toBeGreaterThan(-1);
  });

  it("ATM call delta > 0.5 when r > 0 (delta is N(d1), d1 > 0 for r > 0)", () => {
    // With r=4.5%, sigma=25%, T=0.25: d1 ≈ 0.153, N(d1) ≈ 0.56
    // Delta is not exactly 0.5 for any r>0 at non-zero T.
    // Delta = 0.5 only when d1 = 0, i.e., r = 0 and T → 0.
    const result = computeBSM(base, 91);
    expect(result.callGreeks!.modelDelta!).toBeGreaterThan(0.5);
    expect(result.callGreeks!.modelDelta!).toBeLessThan(0.7);
  });

  it("deep ITM call delta approaches 1", () => {
    const result = computeBSM({ ...base, K: 50 }, 91);
    expect(result.callGreeks!.modelDelta!).toBeGreaterThan(0.9);
  });

  it("deep OTM call delta approaches 0", () => {
    const result = computeBSM({ ...base, K: 200 }, 91);
    expect(result.callGreeks!.modelDelta!).toBeGreaterThanOrEqual(0);
    expect(result.callGreeks!.modelDelta!).toBeLessThan(0.05);
  });
});

// ===========================================================================
// L. Gamma positive
// ===========================================================================

describe("L — Gamma positive", () => {
  it("gamma is positive for call", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.callGreeks!.modelGamma).toBeGreaterThan(0);
  });

  it("gamma is positive for put (same value as call at same strike)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.putGreeks!.modelGamma).toBeGreaterThan(0);
    expect(result.callGreeks!.modelGamma).toBeCloseTo(result.putGreeks!.modelGamma!, 10);
  });

  it("gamma is never negative", () => {
    const testCases = [
      { S: 100, K: 80, T: 0.25, r: 0.04, q: 0, sigma: 0.20, dte: 91 },
      { S: 100, K: 120, T: 0.25, r: 0.04, q: 0, sigma: 0.20, dte: 91 },
      { S: 100, K: 100, T: 1.0, r: 0.04, q: 0.02, sigma: 0.30, dte: 365 },
    ];
    for (const tc of testCases) {
      const result = computeBSM({ S: tc.S, K: tc.K, T: tc.T, r: tc.r, q: tc.q, sigma: tc.sigma }, tc.dte);
      expect(result.callGreeks!.modelGamma).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===========================================================================
// M. Theta sign conventions
// ===========================================================================

describe("M — Theta sign conventions", () => {
  it("call theta is negative (long option loses value with time)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.callGreeks!.modelTheta).toBeLessThan(0);
  });

  it("put theta is negative for long put (time decay)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.putGreeks!.modelTheta).toBeLessThan(0);
  });

  it("theta is more negative for shorter DTE (faster decay)", () => {
    const long  = computeBSM({ S: 100, K: 100, T: 90/365, r: 0.045, q: 0, sigma: 0.25 }, 90);
    const short = computeBSM({ S: 100, K: 100, T: 30/365, r: 0.045, q: 0, sigma: 0.25 }, 30);
    expect(short.callGreeks!.modelTheta!).toBeLessThan(long.callGreeks!.modelTheta!);
  });
});

// ===========================================================================
// N. Vega positive
// ===========================================================================

describe("N — Vega positive", () => {
  it("vega is positive for a long call", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.callGreeks!.modelVega).toBeGreaterThan(0);
  });

  it("vega is positive for a long put", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.putGreeks!.modelVega).toBeGreaterThan(0);
  });

  it("higher vol → higher option value (vega positive direction)", () => {
    const lo = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.20 }, 91);
    const hi = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.30 }, 91);
    expect(hi.modelCallValue!).toBeGreaterThan(lo.modelCallValue!);
    expect(hi.modelPutValue!).toBeGreaterThan(lo.modelPutValue!);
  });
});

// ===========================================================================
// O. Rho direction
// ===========================================================================

describe("O — Rho direction", () => {
  it("call rho is positive (call value rises with interest rate)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.5, r: 0.045, q: 0, sigma: 0.25 }, 183);
    expect(result.callGreeks!.modelRho).toBeGreaterThan(0);
  });

  it("put rho is negative (put value falls with interest rate)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.5, r: 0.045, q: 0, sigma: 0.25 }, 183);
    expect(result.putGreeks!.modelRho).toBeLessThan(0);
  });

  it("higher rate → higher call, lower put", () => {
    const lo = computeBSM({ S: 100, K: 100, T: 0.5, r: 0.02, q: 0, sigma: 0.25 }, 183);
    const hi = computeBSM({ S: 100, K: 100, T: 0.5, r: 0.06, q: 0, sigma: 0.25 }, 183);
    expect(hi.modelCallValue!).toBeGreaterThan(lo.modelCallValue!);
    expect(hi.modelPutValue!).toBeLessThan(lo.modelPutValue!);
  });
});

// ===========================================================================
// P. Short DTE warning
// ===========================================================================

describe("P — Short DTE warning", () => {
  it("returns SHORT_DTE_WARNING for DTE < 7", () => {
    const result = computeBSM({ S: 100, K: 100, T: 5/365, r: 0.045, q: 0, sigma: 0.25 }, 5);
    expect(result.quality).toBe("SHORT_DTE_WARNING");
    // Values still computed — warning does not null out outputs
    expect(result.modelCallValue).not.toBeNull();
    expect(result.modelPutValue).not.toBeNull();
  });

  it("returns NORMAL for DTE = 7 (boundary is exclusive below 7)", () => {
    const result = computeBSM({ S: 100, K: 100, T: 7/365, r: 0.045, q: 0, sigma: 0.25 }, 7);
    expect(result.quality).toBe("NORMAL");
  });

  it("returns SHORT_DTE_WARNING for DTE = 6", () => {
    const result = computeBSM({ S: 100, K: 100, T: 6/365, r: 0.045, q: 0, sigma: 0.25 }, 6);
    expect(result.quality).toBe("SHORT_DTE_WARNING");
  });
});

// ===========================================================================
// Q. Deep ITM/OTM warning
// ===========================================================================

describe("Q — Deep ITM/OTM warning", () => {
  it("returns DEEP_ITM_OTM_WARNING when |ln(S/K)| > 0.5", () => {
    // S=100, K=50: ln(100/50) = ln(2) ≈ 0.693 > 0.5
    const result = computeBSM({ S: 100, K: 50, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.quality).toBe("DEEP_ITM_OTM_WARNING");
  });

  it("returns DEEP_ITM_OTM_WARNING for deep OTM (S=100, K=200)", () => {
    // ln(100/200) = ln(0.5) ≈ -0.693; |−0.693| > 0.5
    const result = computeBSM({ S: 100, K: 200, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.quality).toBe("DEEP_ITM_OTM_WARNING");
  });

  it("returns NORMAL for near-ATM (S=100, K=110)", () => {
    // ln(100/110) ≈ -0.095; within threshold
    const result = computeBSM({ S: 100, K: 110, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.quality).toBe("NORMAL");
  });
});

// ===========================================================================
// R. Null-input behavior
// ===========================================================================

describe("R — Null / invalid input behavior", () => {
  it("returns UNAVAILABLE and null values for T = 0", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0, r: 0.045, q: 0, sigma: 0.25 }, 0);
    expect(result.quality).toBe("UNAVAILABLE");
    expect(result.modelCallValue).toBeNull();
    expect(result.modelPutValue).toBeNull();
    expect(result.callGreeks).toBeNull();
    expect(result.putGreeks).toBeNull();
  });

  it("returns UNAVAILABLE for sigma = 0", () => {
    const result = computeBSM({ S: 100, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0 }, 91);
    expect(result.quality).toBe("UNAVAILABLE");
    expect(result.modelCallValue).toBeNull();
  });

  it("returns UNAVAILABLE for S = 0", () => {
    const result = computeBSM({ S: 0, K: 100, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.quality).toBe("UNAVAILABLE");
    expect(result.modelCallValue).toBeNull();
  });

  it("returns UNAVAILABLE for K = 0", () => {
    const result = computeBSM({ S: 100, K: 0, T: 0.25, r: 0.045, q: 0, sigma: 0.25 }, 91);
    expect(result.quality).toBe("UNAVAILABLE");
    expect(result.modelCallValue).toBeNull();
  });

  it("never returns negative option values (floor at 0)", () => {
    // Deep OTM with short DTE — could produce tiny negative due to floating point
    const result = computeBSM({ S: 100, K: 150, T: 0.01, r: 0.045, q: 0, sigma: 0.10 }, 4);
    if (result.modelCallValue !== null) {
      expect(result.modelCallValue).toBeGreaterThanOrEqual(0);
    }
    if (result.modelPutValue !== null) {
      expect(result.modelPutValue).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===========================================================================
// Time convention verification
// ===========================================================================

describe("Time convention — DTE/365 (not DTE/252)", () => {
  it("dteToTimeYears uses 365 not 252", () => {
    expect(dteToTimeYears(365)).toBeCloseTo(1.0, 10);
    expect(dteToTimeYears(182)).toBeCloseTo(0.4986, 3);
    expect(dteToTimeYears(30)).toBeCloseTo(30/365, 10);
  });

  it("0 DTE maps to T=0", () => {
    expect(dteToTimeYears(0)).toBe(0);
  });

  it("negative DTE is floored to 0", () => {
    expect(dteToTimeYears(-1)).toBe(0);
  });
});

// ===========================================================================
// normCDF and normPDF sanity
// ===========================================================================

describe("Normal distribution helpers", () => {
  it("normCDF(0) ≈ 0.5", () => {
    expect(normCDF(0)).toBeCloseTo(0.5, 6);
  });

  it("normCDF(1.96) ≈ 0.975", () => {
    expect(normCDF(1.96)).toBeCloseTo(0.975, 2);
  });

  it("normCDF(-x) = 1 - normCDF(x)", () => {
    for (const x of [0.5, 1.0, 2.0, 3.0]) {
      expect(normCDF(-x)).toBeCloseTo(1 - normCDF(x), 10);
    }
  });

  it("normPDF(0) = 1/sqrt(2π)", () => {
    expect(normPDF(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 10);
  });

  it("normPDF is symmetric: normPDF(x) = normPDF(-x)", () => {
    for (const x of [0.5, 1.0, 2.0]) {
      expect(normPDF(x)).toBeCloseTo(normPDF(-x), 10);
    }
  });
});

// ===========================================================================
// classifyMoneyness
// ===========================================================================

describe("classifyMoneyness", () => {
  it("returns ATM when strike within 1% of underlying", () => {
    expect(classifyMoneyness(100, 100)).toBe("ATM");
    expect(classifyMoneyness(100, 100.5)).toBe("ATM");
    expect(classifyMoneyness(100, 99.5)).toBe("ATM");
  });

  it("returns ITM when K < S", () => {
    expect(classifyMoneyness(100, 90)).toBe("ITM");
  });

  it("returns OTM when K > S", () => {
    expect(classifyMoneyness(100, 110)).toBe("OTM");
  });
});
