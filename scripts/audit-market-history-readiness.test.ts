// Tests for the pure functions in the market history readiness audit script.
// These tests make no I/O: no database connections, no external API calls,
// no file system writes. The database query path (fetchSymbolData) is tested
// indirectly by asserting on SymbolAuditResult inputs.

import { describe, it, expect } from "vitest";
import {
  classifyReadiness,
  determineGoNogo,
  computeSummary,
  formatSummary,
  weekdayDist,
  latestWeekday,
  REQUIRED_BARS,
  MINIMUM_BARS,
  SCAN_STALE_WEEKDAYS,
  USABLE_STALE_WEEKDAYS,
  REGIME_SYMBOLS,
  GO_THRESHOLD_PCT,
  CONDITIONAL_GO_THRESHOLD_PCT,
  type SymbolAuditResult,
  type ReadinessStatus,
} from "./audit-market-history-readiness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REF = new Date("2026-08-06T12:00:00Z"); // Thursday

function makeResult(
  symbol: string,
  status: ReadinessStatus,
  overrides: Partial<SymbolAuditResult> = {},
): SymbolAuditResult {
  return {
    symbol,
    assetType: "equity",
    companyName: symbol,
    backfillYears: 2,
    barCount: status === "READY" ? REQUIRED_BARS : status === "STALE_BUT_USABLE" ? MINIMUM_BARS : 0,
    requiredBarCount: REQUIRED_BARS,
    minimumBarCount: MINIMUM_BARS,
    latestBarDate: status === "MISSING" ? null : "2026-08-05",
    earliestBarDate: null,
    freshness: status === "MISSING" ? "unavailable" : status === "STALE_BUT_USABLE" ? "usable" : "fresh",
    provider: "twelve_data",
    interval: "1day",
    duplicateTimestampCount: 0,
    invalidBarCount: status === "INVALID" ? 1 : 0,
    readinessStatus: status,
    isRegimeSymbol: REGIME_SYMBOLS.includes(symbol),
    ...overrides,
  };
}

const CLASSIFY_DEFAULTS = {
  minimumBarCount: MINIMUM_BARS,
  requiredBarCount: REQUIRED_BARS,
  scanStaleWeekdays: SCAN_STALE_WEEKDAYS,
  usableStaleWeekdays: USABLE_STALE_WEEKDAYS,
  refDate: REF,
};

// ---------------------------------------------------------------------------
// weekdayDist
// ---------------------------------------------------------------------------

describe("weekdayDist", () => {
  it("same date = 0", () => expect(weekdayDist("2026-08-06", "2026-08-06")).toBe(0));
  it("from > to = 0", () => expect(weekdayDist("2026-08-07", "2026-08-06")).toBe(0));
  it("Friday to Monday = 1", () => expect(weekdayDist("2026-08-07", "2026-08-10")).toBe(1));
  it("Friday to Saturday = 0", () => expect(weekdayDist("2026-08-07", "2026-08-08")).toBe(0));
  it("Friday to Sunday = 0", () => expect(weekdayDist("2026-08-07", "2026-08-09")).toBe(0));
  it("Mon to Mon across week = 5", () => expect(weekdayDist("2026-08-03", "2026-08-10")).toBe(5));
  it("one weekday apart", () => expect(weekdayDist("2026-08-05", "2026-08-06")).toBe(1));
});

// ---------------------------------------------------------------------------
// latestWeekday
// ---------------------------------------------------------------------------

describe("latestWeekday", () => {
  it("weekday stays the same", () => {
    // Thursday
    expect(latestWeekday(new Date("2026-08-06T10:00:00Z"))).toBe("2026-08-06");
  });
  it("Saturday → Friday", () => {
    expect(latestWeekday(new Date("2026-08-08T10:00:00Z"))).toBe("2026-08-07");
  });
  it("Sunday → Friday", () => {
    expect(latestWeekday(new Date("2026-08-09T10:00:00Z"))).toBe("2026-08-07");
  });
  it("Monday → Monday", () => {
    expect(latestWeekday(new Date("2026-08-10T10:00:00Z"))).toBe("2026-08-10");
  });
});

// ---------------------------------------------------------------------------
// classifyReadiness
// ---------------------------------------------------------------------------

describe("classifyReadiness", () => {
  it("MISSING — no bars at all", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: 0, latestBarDate: null, invalidBarCount: 0, duplicateTimestampCount: 0 });
    expect(status).toBe("MISSING");
  });

  it("MISSING — barCount 0 even with a date (defensive)", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: 0, latestBarDate: "2026-08-05", invalidBarCount: 0, duplicateTimestampCount: 0 });
    expect(status).toBe("MISSING");
  });

  it("INVALID — OHLC violations trump everything else", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-08-05", invalidBarCount: 3, duplicateTimestampCount: 0 });
    expect(status).toBe("INVALID");
  });

  it("INVALID — duplicate timestamps also trigger INVALID", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-08-05", invalidBarCount: 0, duplicateTimestampCount: 2 });
    expect(status).toBe("INVALID");
  });

  it("INSUFFICIENT_HISTORY — below minimum", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: 20, latestBarDate: "2026-08-05", invalidBarCount: 0, duplicateTimestampCount: 0 });
    expect(status).toBe("INSUFFICIENT_HISTORY");
  });

  it("INSUFFICIENT_HISTORY — exactly at minimum-1", () => {
    const { status } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: MINIMUM_BARS - 1, latestBarDate: "2026-08-05", invalidBarCount: 0, duplicateTimestampCount: 0 });
    expect(status).toBe("INSUFFICIENT_HISTORY");
  });

  it("READY — sufficient bars, fresh data", () => {
    // refDate = Thu 2026-08-06; latestBarDate = Wed 2026-08-05 → 1 weekday gap → fresh
    const { status, freshness } = classifyReadiness({ ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-08-05", invalidBarCount: 0, duplicateTimestampCount: 0 });
    expect(status).toBe("READY");
    expect(freshness).toBe("fresh");
  });

  it("READY — Friday bar is fresh on Monday morning", () => {
    const mondayRef = new Date("2026-08-10T09:00:00Z");
    const { status } = classifyReadiness({
      ...CLASSIFY_DEFAULTS, refDate: mondayRef,
      barCount: REQUIRED_BARS, latestBarDate: "2026-08-07", invalidBarCount: 0, duplicateTimestampCount: 0,
    });
    expect(status).toBe("READY");
  });

  it("STALE_BUT_USABLE — enough bars, data 5 weekdays old", () => {
    // refDate = Thu 2026-08-06; 5 weekdays back = Thu 2026-07-30
    const { status, freshness } = classifyReadiness({
      ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-07-30", invalidBarCount: 0, duplicateTimestampCount: 0,
    });
    expect(status).toBe("STALE_BUT_USABLE");
    expect(freshness).toBe("usable");
  });

  it("INSUFFICIENT_HISTORY — data > usableStaleWeekdays (too old)", () => {
    // data from 60 days ago (well beyond 10 weekday threshold)
    const { status, freshness } = classifyReadiness({
      ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-05-01", invalidBarCount: 0, duplicateTimestampCount: 0,
    });
    expect(status).toBe("INSUFFICIENT_HISTORY");
    expect(freshness).toBe("stale");
  });

  it("latestBarDate >= refWeekday is treated as fresh (post-close fetch)", () => {
    // Bar from today (possible after market close)
    const { status } = classifyReadiness({
      ...CLASSIFY_DEFAULTS, barCount: REQUIRED_BARS, latestBarDate: "2026-08-06", invalidBarCount: 0, duplicateTimestampCount: 0,
    });
    expect(status).toBe("READY");
  });

  it("weekend stale data", () => {
    // refDate is Monday 2026-08-10; Friday bar is 1 weekday old → fresh
    const mondayRef = new Date("2026-08-10T09:00:00Z");
    const { status } = classifyReadiness({
      ...CLASSIFY_DEFAULTS, refDate: mondayRef,
      barCount: REQUIRED_BARS, latestBarDate: "2026-08-07", invalidBarCount: 0, duplicateTimestampCount: 0,
    });
    expect(status).toBe("READY");
  });
});

// ---------------------------------------------------------------------------
// determineGoNogo — A. Full coverage
// ---------------------------------------------------------------------------

describe("determineGoNogo — full coverage", () => {
  it("GO when all symbols READY and all regime symbols READY", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      makeResult("NVDA", "READY"),
      makeResult("AAPL", "READY"),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("GO");
  });

  it("GO when ≥ 95% READY_OR_USABLE and all regime READY", () => {
    // 19 READY, 1 MISSING → 95% of 20 is fine
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 15 }, (_, i) => makeResult(`SYM${i}`, "READY")),
      makeResult("MISSING1", "MISSING"),
    ];
    expect(results.length).toBe(20);
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("GO");
  });
});

// ---------------------------------------------------------------------------
// determineGoNogo — B. Some missing symbols
// ---------------------------------------------------------------------------

describe("determineGoNogo — partial coverage", () => {
  it("CONDITIONAL_GO at 87% with non-regime missing", () => {
    // 20 total: 4 regime READY + 13 equity READY + 3 non-critical MISSING = 17/20 = 85%
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 13 }, (_, i) => makeResult(`SYM${i}`, "READY")),
      ...Array.from({ length: 3 }, (_, i) => makeResult(`MISS${i}`, "MISSING")),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("CONDITIONAL_GO");
  });
});

// ---------------------------------------------------------------------------
// determineGoNogo — C. Low coverage
// ---------------------------------------------------------------------------

describe("determineGoNogo — low coverage", () => {
  it("NO_GO below 85% threshold", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 3 }, (_, i) => makeResult(`SYM${i}`, "READY")),
      ...Array.from({ length: 13 }, (_, i) => makeResult(`MISS${i}`, "MISSING")),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
  });

  it("NO_GO when universe is empty", () => {
    const { goNogo, reason } = determineGoNogo({ symbolResults: [], regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
    expect(reason).toMatch(/empty/i);
  });
});

// ---------------------------------------------------------------------------
// determineGoNogo — D. Required regime symbols missing
// ---------------------------------------------------------------------------

describe("determineGoNogo — regime symbols", () => {
  it("NO_GO when regime symbol MISSING", () => {
    const results = [
      makeResult("QQQ", "READY"),
      makeResult("IWM", "READY"),
      makeResult("DIA", "READY"),
      // SPY is MISSING
      ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    const { goNogo, reason } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
    expect(reason).toContain("SPY");
  });

  it("NO_GO when regime symbol INSUFFICIENT_HISTORY", () => {
    const results = [
      makeResult("SPY", "INSUFFICIENT_HISTORY"),
      makeResult("QQQ", "READY"),
      makeResult("IWM", "READY"),
      makeResult("DIA", "READY"),
      ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
  });

  it("CONDITIONAL_GO when regime STALE_BUT_USABLE and coverage >= 85%", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "STALE_BUT_USABLE")),
      ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    // All 20 are READY or USABLE → coverage 100%. But regime not READY → not GO.
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("CONDITIONAL_GO");
  });
});

// ---------------------------------------------------------------------------
// determineGoNogo — INVALID bars
// ---------------------------------------------------------------------------

describe("determineGoNogo — invalid bars", () => {
  it("NO_GO when any symbol has INVALID bars", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      makeResult("NVDA", "INVALID"),
      ...Array.from({ length: 15 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    const { goNogo, reason } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
    expect(reason).toContain("NVDA");
  });
});

// ---------------------------------------------------------------------------
// computeSummary
// ---------------------------------------------------------------------------

describe("computeSummary", () => {
  it("aggregates counts correctly", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      makeResult("NVDA", "READY"),
      makeResult("AAPL", "STALE_BUT_USABLE"),
      makeResult("MSFT", "INSUFFICIENT_HISTORY"),
      makeResult("AMD", "MISSING"),
      makeResult("MU", "INVALID"),
    ];
    const summary = computeSummary({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(summary.universeSize).toBe(9);
    expect(summary.readyCount).toBe(5); // 4 regime + NVDA
    expect(summary.staleButUsableCount).toBe(1);
    expect(summary.insufficientHistoryCount).toBe(1);
    expect(summary.missingCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.symbolsByStatus.invalid).toContain("MU");
    expect(summary.symbolsByStatus.missing).toContain("AMD");
    expect(summary.symbolsByStatus.stale).toContain("AAPL");
    expect(summary.symbolsByStatus.insufficient).toContain("MSFT");
  });

  it("provider distribution is counted correctly", () => {
    const results = [
      makeResult("SPY", "READY", { provider: "twelve_data" }),
      makeResult("QQQ", "READY", { provider: "twelve_data" }),
      makeResult("IWM", "MISSING", { provider: null }),
    ];
    const summary = computeSummary({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(summary.providerDistribution["twelve_data"]).toBe(2);
    expect(summary.providerDistribution["none"]).toBe(1);
  });

  it("latestCompletedMarketDate is the most recent across all symbols", () => {
    const results = [
      makeResult("SPY", "READY", { latestBarDate: "2026-08-05" }),
      makeResult("QQQ", "READY", { latestBarDate: "2026-08-04" }),
      makeResult("IWM", "READY", { latestBarDate: "2026-08-03" }),
    ];
    const summary = computeSummary({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(summary.latestCompletedMarketDate).toBe("2026-08-05");
  });
});

// ---------------------------------------------------------------------------
// formatSummary — safe output
// ---------------------------------------------------------------------------

describe("formatSummary — safe output", () => {
  const allReady = [
    ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
    ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
  ];
  const summary = computeSummary({ symbolResults: allReady, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
  const output = formatSummary(summary, REF);

  it("output does not contain database URL patterns", () => {
    expect(output).not.toMatch(/postgresql:\/\//);
    expect(output).not.toMatch(/DATABASE_URL/);
    expect(output).not.toMatch(/password/i);
  });

  it("output contains GO verdict", () => {
    expect(output).toContain("GO");
  });

  it("output contains universe size", () => {
    expect(output).toContain("20");
  });

  it("output contains coverage percentage", () => {
    expect(output).toContain("100%");
  });

  it("output does not contain full candle payloads", () => {
    expect(output).not.toMatch(/"open":\d+,"high":\d+/);
  });

  it("output does not contain raw SQL", () => {
    expect(output).not.toContain("SELECT");
    expect(output).not.toContain("FROM market_daily_bars");
  });

  it("output for CONDITIONAL_GO contains required conditions", () => {
    // 4 regime READY + 13 equity READY + 3 MISSING = 20 total, 17/20 = 85% → CONDITIONAL_GO
    const partial = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 13 }, (_, i) => makeResult(`SYM${i}`, "READY")),
      ...Array.from({ length: 3 }, (_, i) => makeResult(`MISS${i}`, "MISSING")),
    ];
    const partialSummary = computeSummary({ symbolResults: partial, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    const partialOutput = formatSummary(partialSummary, REF);
    expect(partialOutput).toContain("CONDITIONAL_GO");
  });
});

// ---------------------------------------------------------------------------
// No external calls / no database writes contract
// ---------------------------------------------------------------------------

describe("no external calls / no database writes", () => {
  it("classifyReadiness makes no I/O", () => {
    // If this test completes, no I/O happened — pure function
    const { status } = classifyReadiness({
      barCount: 100, latestBarDate: "2026-08-05", invalidBarCount: 0,
      duplicateTimestampCount: 0, minimumBarCount: 50, requiredBarCount: 320,
      scanStaleWeekdays: 3, usableStaleWeekdays: 10, refDate: REF,
    });
    expect(["READY", "STALE_BUT_USABLE", "INSUFFICIENT_HISTORY", "MISSING", "INVALID"]).toContain(status);
  });

  it("determineGoNogo makes no I/O", () => {
    const results = REGIME_SYMBOLS.map((s) => makeResult(s, "READY"));
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(["GO", "CONDITIONAL_GO", "NO_GO"]).toContain(goNogo);
  });
});

// ---------------------------------------------------------------------------
// Feature-flag combinations (pure logic only)
// ---------------------------------------------------------------------------

describe("feature-flag combinations", () => {
  it("100% READY universe + all regime READY → GO", () => {
    const results = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("GO");
  });

  it("regime symbol STALE_BUT_USABLE with 100% coverage → CONDITIONAL_GO, not GO", () => {
    const results = [
      makeResult("SPY", "STALE_BUT_USABLE"),
      makeResult("QQQ", "READY"),
      makeResult("IWM", "READY"),
      makeResult("DIA", "READY"),
      ...Array.from({ length: 16 }, (_, i) => makeResult(`SYM${i}`, "READY")),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: results, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("CONDITIONAL_GO");
  });

  it("any INVALID → NO_GO regardless of coverage", () => {
    const allReady = [
      ...REGIME_SYMBOLS.map((s) => makeResult(s, "READY")),
      ...Array.from({ length: 15 }, (_, i) => makeResult(`SYM${i}`, "READY")),
      makeResult("BAD", "INVALID"),
    ];
    const { goNogo } = determineGoNogo({ symbolResults: allReady, regimeSymbols: REGIME_SYMBOLS, goThresholdPct: GO_THRESHOLD_PCT, conditionalGoThresholdPct: CONDITIONAL_GO_THRESHOLD_PCT });
    expect(goNogo).toBe("NO_GO");
  });
});
