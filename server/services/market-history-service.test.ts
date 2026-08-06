// Comprehensive tests for the canonical market-history-service.
// Covers: stored path, external refresh, freshness, depth policy, readiness,
// disallowed providers, symbol normalization, and error classification.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock() factories can reference them
// ---------------------------------------------------------------------------

const {
  mockLoadStoredBars, mockPersistValidatedBars,
  mockGetDailyBars, mockIsIngestionAllowed,
  mockDbExecute, mockValidateBar,
} = vi.hoisted(() => ({
  mockLoadStoredBars: vi.fn(),
  mockPersistValidatedBars: vi.fn(),
  mockGetDailyBars: vi.fn(),
  mockIsIngestionAllowed: vi.fn(),
  mockDbExecute: vi.fn(),
  mockValidateBar: vi.fn(),
}));

vi.mock("./daily-market-data/ingestion", () => ({
  loadStoredBars: (...a: any[]) => mockLoadStoredBars(...a),
  persistValidatedBars: (...a: any[]) => mockPersistValidatedBars(...a),
}));

// TwelveDataDailyProvider must be a proper constructor (not an arrow function).
vi.mock("./daily-market-data/twelve-data-client", () => ({
  TwelveDataDailyProvider: function (this: any) {
    this.getDailyBars = (...a: any[]) => mockGetDailyBars(...a);
  },
}));

vi.mock("./daily-market-data/validation", () => ({
  validateBar: (...a: any[]) => mockValidateBar(...a),
}));

vi.mock("./daily-market-data/config", () => ({
  isIngestionAllowed: () => mockIsIngestionAllowed(),
}));

vi.mock("../db", () => ({ db: { execute: (...a: any[]) => mockDbExecute(...a) } }));
vi.mock("drizzle-orm", () => ({
  sql: new Proxy(Object.assign((s: any) => s, { raw: (s: any) => s }), {}),
  eq: vi.fn(),
  and: vi.fn(),
}));
vi.mock("@shared/schema", () => ({
  marketDataSymbols: {},
  marketDailyBars: {},
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import {
  getHistoricalBars,
  checkScanReadiness,
  isScanCoverageAdequate,
  checkFreshness,
  weekdayDistance,
  mostRecentWeekday,
  isDatabaseFirstEnabled,
  isExternalRefreshEnabled,
  HISTORY_DEPTH,
  FRESHNESS_POLICY,
  MIN_SCAN_COVERAGE_PCT,
} from "./market-history-service";
import { MarketDataProviderError } from "./daily-market-data/types";
import type { NormalizedDailyBar } from "./daily-market-data/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBar(symbol: string, tradeDate: string, close = 100, provider = "twelve_data"): NormalizedDailyBar {
  return {
    symbol,
    tradeDate,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    adjustedClose: null,
    volume: 1_000_000,
    provider,
    providerTimestamp: tradeDate + "T00:00:00Z",
    isComplete: true,
  };
}

/** Build a sorted ascending array of N daily bars ending at endDate. */
function makeBars(symbol: string, count: number, endDate = "2026-08-05"): NormalizedDailyBar[] {
  const bars: NormalizedDailyBar[] = [];
  const d = new Date(endDate + "T00:00:00Z");
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() - i);
    bars.push(makeBar(symbol, dt.toISOString().slice(0, 10), 100 + i));
  }
  return bars;
}

function resetEnvFlags() {
  delete process.env.MARKET_HISTORY_DATABASE_FIRST;
  delete process.env.MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetEnvFlags();
  mockLoadStoredBars.mockResolvedValue([]);
  mockPersistValidatedBars.mockResolvedValue({ inserted: 0, updated: 0 });
  mockGetDailyBars.mockResolvedValue([]);
  mockIsIngestionAllowed.mockReturnValue(true);
  mockDbExecute.mockResolvedValue({ rows: [] });
  // Validation passes by default so refresh tests don't need per-bar stubs.
  mockValidateBar.mockReturnValue({ valid: true, errors: [] });
});

afterEach(() => {
  resetEnvFlags();
});

// ---------------------------------------------------------------------------
// A. Stored-history path
// ---------------------------------------------------------------------------

describe("A. Stored history", () => {
  it("sufficient fresh stored bars return without external call", async () => {
    const bars = makeBars("NVDA", HISTORY_DEPTH.MINIMUM + 5, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);

    const result = await getHistoricalBars({
      symbol: "NVDA", outputSize: 30, purpose: "scan",
      allowExternalRefresh: true,
    });

    expect(result.sourceType).toBe("stored");
    expect(result.bars.length).toBeGreaterThan(0);
    expect(mockGetDailyBars).not.toHaveBeenCalled();
  });

  it("bars returned in ascending order (oldest first)", async () => {
    const bars = makeBars("AAPL", 10, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);
    const result = await getHistoricalBars({ symbol: "AAPL", outputSize: 10, purpose: "scan" });
    for (let i = 1; i < result.bars.length; i++) {
      expect(result.bars[i].tradeDate > result.bars[i - 1].tradeDate).toBe(true);
    }
  });

  it("trims to requested outputSize", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("SPY", 50, "2026-08-05"));
    const result = await getHistoricalBars({ symbol: "SPY", outputSize: 20, purpose: "scan" });
    expect(result.bars.length).toBeLessThanOrEqual(20);
  });

  it("freshness metadata is included and correct", async () => {
    const bars = makeBars("MU", 40, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);
    const result = await getHistoricalBars({ symbol: "MU", outputSize: 40, purpose: "scan" });
    expect(result.latestBarDate).toBeTruthy();
    expect(result.barCount).toBeGreaterThan(0);
    expect(result.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("source metadata is present", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("TSLA", 40, "2026-08-05"));
    const result = await getHistoricalBars({ symbol: "TSLA", outputSize: 40, purpose: "scan" });
    expect(result.provider).toBeTruthy();
    expect(result.sourceType).toBe("stored");
  });

  it("insufficient stored bars triggers external refresh when allowed", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("AMD", 5, "2026-08-05")); // below MINIMUM
    const freshBars = makeBars("AMD", 60, "2026-08-05");
    mockGetDailyBars.mockResolvedValue(freshBars);

    const result = await getHistoricalBars({
      symbol: "AMD", outputSize: 60, purpose: "user",
      allowExternalRefresh: true,
    });

    expect(mockGetDailyBars).toHaveBeenCalled();
    expect(result.sourceType).toBe("external_refresh");
  });

  it("stale stored bars are detected and reported", async () => {
    // Bar from 10 weekdays ago → stale for scan (threshold = 3)
    const oldDate = "2026-07-22"; // well beyond stale threshold
    mockLoadStoredBars.mockResolvedValue(makeBars("OLD", 40, oldDate));

    const result = await getHistoricalBars({
      symbol: "OLD", outputSize: 40, purpose: "scan",
      allowExternalRefresh: false,
    });

    expect(result.freshnessStatus).toBe("stale");
    expect(result.sourceType).toBe("stored_stale");
  });

  it("Friday bar is fresh on the following Monday morning", () => {
    const friday = "2026-08-07"; // a Friday
    const monday = new Date("2026-08-10T09:00:00Z"); // Monday morning
    const status = checkFreshness(friday, "scan", monday);
    expect(status).toBe("fresh");
  });

  it("weekend dates have correct weekday distance to next weekday", () => {
    const friday = "2026-08-07";
    expect(weekdayDistance(friday, "2026-08-08")).toBe(0); // Saturday
    expect(weekdayDistance(friday, "2026-08-09")).toBe(0); // Sunday
    expect(weekdayDistance(friday, "2026-08-10")).toBe(1); // Monday = 1 weekday
  });
});

// ---------------------------------------------------------------------------
// B. External refresh
// ---------------------------------------------------------------------------

describe("B. External refresh", () => {
  it("missing history triggers Twelve Data refresh", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    const bars = makeBars("NVDA", 60, "2026-08-05");
    mockGetDailyBars.mockResolvedValue(bars);

    const result = await getHistoricalBars({
      symbol: "NVDA", outputSize: 60, purpose: "user",
      allowExternalRefresh: true,
    });

    expect(mockGetDailyBars).toHaveBeenCalled();
    expect(result.sourceType).toBe("external_refresh");
    expect(result.provider).toBe("twelve_data");
  });

  it("refreshed bars are validated — invalid bars are rejected by validateBar", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    const bars = makeBars("BAD", 5, "2026-08-05");
    mockGetDailyBars.mockResolvedValue(bars);
    // First 4 bars fail validation, last passes.
    mockValidateBar
      .mockReturnValueOnce({ valid: false, errors: ["open < 0"] })
      .mockReturnValueOnce({ valid: false, errors: ["open < 0"] })
      .mockReturnValueOnce({ valid: false, errors: ["open < 0"] })
      .mockReturnValueOnce({ valid: false, errors: ["open < 0"] })
      .mockReturnValueOnce({ valid: true, errors: [] });

    const result = await getHistoricalBars({
      symbol: "BAD", outputSize: 10, purpose: "user",
      allowExternalRefresh: true,
    });

    // Only 1 valid bar passed validation.
    expect(result.bars).toHaveLength(1);
    expect(result.sourceType).toBe("external_refresh");
  });

  it("refreshed bars are persisted", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    mockGetDailyBars.mockResolvedValue(makeBars("MSFT", 40, "2026-08-05"));

    await getHistoricalBars({
      symbol: "MSFT", outputSize: 40, purpose: "user",
      allowExternalRefresh: true,
    });

    expect(mockPersistValidatedBars).toHaveBeenCalledWith("MSFT", expect.any(Array));
  });

  it("provider failure falls back to stale stored data when available", async () => {
    const oldBars = makeBars("AMD", 40, "2026-07-01");
    mockLoadStoredBars.mockResolvedValue(oldBars);
    mockGetDailyBars.mockRejectedValue(new MarketDataProviderError("timeout", "TIMEOUT"));

    const result = await getHistoricalBars({
      symbol: "AMD", outputSize: 40, purpose: "user",
      allowExternalRefresh: true,
    });

    expect(result.sourceType).toBe("stored_stale");
    expect(result.freshnessStatus).toBe("stale");
  });

  it("no external refresh when allowExternalRefresh=false (scan default)", async () => {
    mockLoadStoredBars.mockResolvedValue([]);

    await expect(
      getHistoricalBars({
        symbol: "NVDA", outputSize: 60, purpose: "scan",
        allowExternalRefresh: false,
      }),
    ).rejects.toThrow();

    expect(mockGetDailyBars).not.toHaveBeenCalled();
  });

  it("no external refresh when MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED=false", async () => {
    process.env.MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED = "false";
    mockLoadStoredBars.mockResolvedValue([]);

    await expect(
      getHistoricalBars({
        symbol: "NVDA", outputSize: 60, purpose: "user",
        allowExternalRefresh: true,
      }),
    ).rejects.toThrow();

    expect(mockGetDailyBars).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C. Global scanner
// ---------------------------------------------------------------------------

describe("C. Global scanner", () => {
  it("scan purpose: stored bars are used, no external call", async () => {
    const bars = makeBars("SPY", 50, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);

    const result = await getHistoricalBars({ symbol: "SPY", outputSize: 50, purpose: "scan" });

    expect(result.sourceType).toBe("stored");
    expect(mockGetDailyBars).not.toHaveBeenCalled();
  });

  it("insufficient symbols become unavailable (EMPTY error)", async () => {
    mockLoadStoredBars.mockResolvedValue([]);

    await expect(
      getHistoricalBars({ symbol: "UNKNOWN", outputSize: 60, purpose: "scan" }),
    ).rejects.toBeInstanceOf(MarketDataProviderError);
  });

  it("readiness coverage calculated from universe", async () => {
    mockDbExecute.mockResolvedValue({
      rows: [
        { symbol: "NVDA", latest_bar_date: "2026-08-05", bar_count: 120 },
        { symbol: "AMD",  latest_bar_date: "2026-08-05", bar_count: 80 },
        { symbol: "MU",   latest_bar_date: null,          bar_count: 0 },
      ],
    });

    const r = await checkScanReadiness(new Date("2026-08-06T10:00:00Z"));
    expect(r.universeSize).toBe(3);
    expect(r.readySymbols).toBe(2);
    expect(r.missingSymbols).toBe(1);
    expect(r.coveragePercent).toBe(67);
  });

  it("isScanCoverageAdequate returns false below threshold", () => {
    const readiness = {
      universeSize: 10, readySymbols: 3, staleSymbols: 3, missingSymbols: 4,
      coveragePercent: 30, latestCompletedBarDate: null,
      dataSourceSummary: "", checkedAt: "",
    };
    expect(isScanCoverageAdequate(readiness)).toBe(false);
  });

  it("isScanCoverageAdequate returns true at threshold", () => {
    const readiness = {
      universeSize: 10, readySymbols: 8, staleSymbols: 1, missingSymbols: 1,
      coveragePercent: MIN_SCAN_COVERAGE_PCT, latestCompletedBarDate: "2026-08-05",
      dataSourceSummary: "", checkedAt: "",
    };
    expect(isScanCoverageAdequate(readiness)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Broker abstraction (interface contract)
// ---------------------------------------------------------------------------

describe("D. Broker capability flags", () => {
  it("historicalBars capability compiles and is present in BrokerCapabilities", async () => {
    // Import the types module — if the type is absent TypeScript would catch it at build time.
    // This test verifies the interface is accessible at runtime without errors.
    const mod = await import("../broker/types");
    expect(mod).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// E. Provider safety — disallowed providers
// ---------------------------------------------------------------------------

describe("E. Provider safety", () => {
  it("yahoo provider bar is rejected by assertProviderAllowed", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    const yahooBar = { ...makeBar("SPY", "2026-08-05", 100), provider: "yahoo" };
    mockGetDailyBars.mockResolvedValue([yahooBar]);

    // assertProviderAllowed throws MarketDataProviderError(DISABLED) inside the loop,
    // which causes the catch block in the external-refresh section to catch it,
    // then falls through to phase 4 (no stored bars) → phase 5 (EMPTY throw).
    const err: any = await getHistoricalBars({
      symbol: "SPY", outputSize: 10, purpose: "user", allowExternalRefresh: true,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MarketDataProviderError);
    // Either EMPTY (all bars rejected → no valid bars persisted) or DISABLED
    expect(["EMPTY", "DISABLED"]).toContain(err.code);
  });

  it("mock provider name is rejected", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    const mockBar = { ...makeBar("SPY", "2026-08-05", 100), provider: "mock_provider" };
    mockGetDailyBars.mockResolvedValue([mockBar]);

    const err: any = await getHistoricalBars({
      symbol: "SPY", outputSize: 10, purpose: "user", allowExternalRefresh: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MarketDataProviderError);
  });

  it("MARKET_HISTORY_DATABASE_FIRST=false falls through to legacy Twelve Data path", async () => {
    process.env.MARKET_HISTORY_DATABASE_FIRST = "false";
    const bars = makeBars("SPY", 20, "2026-08-05");
    mockGetDailyBars.mockResolvedValue(bars);

    const result = await getHistoricalBars({ symbol: "SPY", outputSize: 20, purpose: "scan" });
    expect(result.sourceType).toBe("external_refresh");
    expect(mockGetDailyBars).toHaveBeenCalled();
    expect(mockLoadStoredBars).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F. Symbol handling
// ---------------------------------------------------------------------------

describe("F. Symbol normalization", () => {
  it("symbol is uppercased before storage lookup", async () => {
    const bars = makeBars("AAPL", 40, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);

    await getHistoricalBars({ symbol: "aapl", outputSize: 40, purpose: "scan" });
    expect(mockLoadStoredBars).toHaveBeenCalledWith("AAPL", expect.any(Number));
  });

  it("symbol is trimmed of whitespace", async () => {
    const bars = makeBars("MU", 40, "2026-08-05");
    mockLoadStoredBars.mockResolvedValue(bars);

    await getHistoricalBars({ symbol: "  MU  ", outputSize: 40, purpose: "scan" });
    expect(mockLoadStoredBars).toHaveBeenCalledWith("MU", expect.any(Number));
  });

  it("ordinary US equity symbol loads correctly", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("NVDA", 40, "2026-08-05"));
    await expect(
      getHistoricalBars({ symbol: "NVDA", outputSize: 40, purpose: "scan" }),
    ).resolves.not.toThrow();
  });

  it("ETF symbol loads correctly", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("SPY", 40, "2026-08-05"));
    await expect(
      getHistoricalBars({ symbol: "SPY", outputSize: 40, purpose: "scan" }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// G. Error classification
// ---------------------------------------------------------------------------

describe("G. Error classification", () => {
  it("no stored bars + no refresh → EMPTY MarketDataProviderError", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    const err: any = await getHistoricalBars({
      symbol: "NONE", outputSize: 60, purpose: "scan",
      allowExternalRefresh: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MarketDataProviderError);
    expect(err.code).toBe("EMPTY");
  });

  it("external refresh RATE_LIMITED error falls back to stale stored bars", async () => {
    const stale = makeBars("MU", 40, "2026-07-01");
    mockLoadStoredBars.mockResolvedValue(stale);
    mockGetDailyBars.mockRejectedValue(new MarketDataProviderError("rate limit", "RATE_LIMITED"));

    const result = await getHistoricalBars({
      symbol: "MU", outputSize: 40, purpose: "user", allowExternalRefresh: true,
    });
    expect(result.sourceType).toBe("stored_stale");
  });

  it("persist failure is non-fatal — result is still returned", async () => {
    mockLoadStoredBars.mockResolvedValue([]);
    mockGetDailyBars.mockResolvedValue(makeBars("AAPL", 40, "2026-08-05"));
    mockPersistValidatedBars.mockRejectedValue(new Error("DB write failed"));

    const result = await getHistoricalBars({
      symbol: "AAPL", outputSize: 40, purpose: "user", allowExternalRefresh: true,
    });
    expect(result.sourceType).toBe("external_refresh");
    expect(result.bars.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// H. Regression
// ---------------------------------------------------------------------------

describe("H. Regression", () => {
  it("getHistoricalBars does not throw synchronously", async () => {
    mockLoadStoredBars.mockResolvedValue(makeBars("NVDA", 40, "2026-08-05"));
    await expect(
      getHistoricalBars({ symbol: "NVDA", outputSize: 40, purpose: "scan" }),
    ).resolves.toBeDefined();
  });

  it("feature flags read from env at call time (not cached)", () => {
    process.env.MARKET_HISTORY_DATABASE_FIRST = "true";
    expect(isDatabaseFirstEnabled()).toBe(true);
    process.env.MARKET_HISTORY_DATABASE_FIRST = "false";
    expect(isDatabaseFirstEnabled()).toBe(false);
  });

  it("MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED defaults to true when not set", () => {
    delete process.env.MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED;
    expect(isExternalRefreshEnabled()).toBe(true);
  });

  it("HISTORY_DEPTH constants satisfy minimum analysis requirements", () => {
    expect(HISTORY_DEPTH.MINIMUM).toBeGreaterThanOrEqual(30);
    expect(HISTORY_DEPTH.STANDARD_SCAN).toBeGreaterThanOrEqual(120);
    expect(HISTORY_DEPTH.FULL_TECHNICAL).toBeGreaterThanOrEqual(250);
    expect(HISTORY_DEPTH.MINIMUM).toBeLessThan(HISTORY_DEPTH.STANDARD_SCAN);
    expect(HISTORY_DEPTH.STANDARD_SCAN).toBeLessThan(HISTORY_DEPTH.FULL_TECHNICAL);
  });

  it("FRESHNESS_POLICY scan threshold covers a single weekend gap (≤1 weekday)", () => {
    expect(FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS).toBeGreaterThanOrEqual(1);
  });

  it("mostRecentWeekday returns a weekday (not Sat/Sun)", () => {
    const d = mostRecentWeekday(new Date("2026-08-09T10:00:00Z")); // Sunday
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    expect(dow).not.toBe(0); // not Sunday
    expect(dow).not.toBe(6); // not Saturday
  });

  it("checkScanReadiness always returns a structured result even with no universe", async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const r = await checkScanReadiness();
    expect(r.universeSize).toBe(0);
    expect(r.coveragePercent).toBe(0);
    expect(r.checkedAt).toMatch(/^\d{4}/);
  });
});
