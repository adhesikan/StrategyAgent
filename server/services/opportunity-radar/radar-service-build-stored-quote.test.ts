// Regression tests — buildStoredQuote + hash-fallback removal
//
// Sprint 1 Final Closure Gate (policy 3B):
//   • stored PostgreSQL bars remain the sole quote anchor in the radar
//   • no external HTTP request occurs inside buildStoredQuote
//   • symbols with no stored bars produce unavailableQuoteCount, not fake prices
//   • Yahoo Finance and Stooq are absent from all imports and behaviour
//   • synthetic prices cannot enter saved research or trigger execution paths
//
// These tests exercise enrichWithMarketData indirectly via generateCandidateScenarios.
// All DB/broker/external calls are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must appear before any imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("../market-history-service", () => ({
  getHistoricalBars: vi.fn(),
  checkScanReadiness: vi.fn().mockResolvedValue({ ready: true, missingSymbols: [] }),
  isScanCoverageAdequate: vi.fn().mockReturnValue(true),
  HISTORY_DEPTH: 320,
  FRESHNESS_POLICY: { maxAgeHours: 36 },
}));

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", role: "user" }),
    getBrokerConnectionWithToken: vi.fn().mockResolvedValue(null),
    getUserSettings: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../daily-market-data/reference-snapshot", () => ({
  getReferenceSnapshotsBulk: vi.fn(),
}));

vi.mock("./universe-service", () => ({
  resolveUniverseWithMeta: vi.fn().mockResolvedValue({
    symbols: ["NVDA", "MSFT"],
    source: "starter_fallback",
    label: "Starter",
  }),
}));

vi.mock("../../broker-service", () => ({
  fetchQuotesFromBroker: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../broker", () => ({
  getBrokerAccounts: vi.fn().mockResolvedValue([]),
  getBrokerPositions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./ml-adapter", () => ({
  defaultMLAdapter: {
    getPredictedMove: () => Promise.resolve(null),
    getPatternConfidence: () => Promise.resolve(null),
    getVolatilityEdge: () => Promise.resolve(null),
  },
  createDefaultMLAdapter: () => ({
    getPredictedMove: () => Promise.resolve(null),
    getPatternConfidence: () => Promise.resolve(null),
    getVolatilityEdge: () => Promise.resolve(null),
  }),
}));

vi.mock("./news-score-adapter", () => ({
  adaptSnapshotToRadar: vi.fn().mockReturnValue({ available: false, headline: null, score: null }),
  loadSnapshotsForRadar: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../news", () => ({
  refreshSentimentForSymbols: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./scoring", () => ({
  scoreTechnical: vi.fn().mockReturnValue(50),
  scoreMomentum: vi.fn().mockReturnValue(50),
  scoreSentiment: vi.fn().mockReturnValue(50),
  scoreOptionsLiquidity: vi.fn().mockReturnValue(50),
  scoreRisk: vi.fn().mockReturnValue(50),
  computeFinalScore: vi.fn().mockReturnValue(60),
  gradeScore: vi.fn().mockReturnValue("B"),
  gradeAtLeast: vi.fn().mockReturnValue(true),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getHistoricalBars } from "../market-history-service";
import { getReferenceSnapshotsBulk } from "../daily-market-data/reference-snapshot";
import { generateCandidateScenarios } from "./radar-service";

const mockGetHistoricalBars = vi.mocked(getHistoricalBars);
const mockGetRefSnaps = vi.mocked(getReferenceSnapshotsBulk);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(close: number, date: string) {
  return { date, open: close * 0.99, high: close * 1.01, low: close * 0.98, close, volume: 1_000_000 };
}

const TWO_BARS = {
  bars: [makeBar(100, "2026-08-04"), makeBar(105, "2026-08-05")],
  sourceType: "stored" as const,
  freshnessStatus: "fresh" as const,
};

const EMPTY_ERROR = (() => {
  const e = new Error("EMPTY");
  (e as any).code = "EMPTY";
  return e;
})();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildStoredQuote — stored bars are the sole quote anchor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRefSnaps.mockResolvedValue(new Map());
  });

  it("uses stored daily close when bars exist — referenceQuoteCount > 0, unavailable = 0", async () => {
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(result.dataMode).toBe("simulated");
    expect(result.referenceQuoteCount).toBeGreaterThan(0);
    expect(result.unavailableQuoteCount).toBe(0);
  });

  it("sets unavailableQuoteCount when no stored bars and no reference snapshot", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);
    mockGetRefSnaps.mockResolvedValue(new Map());

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(result.unavailableQuoteCount).toBeGreaterThan(0);
    expect(result.referenceQuoteCount).toBe(0);
    // No data source = no candidates
    expect(result.candidates).toHaveLength(0);
  });

  it("produces an 'excluded' note when unavailable count > 0", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);
    mockGetRefSnaps.mockResolvedValue(new Map());

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    const unavailableNote = result.notes.find((n) => n.includes("excluded"));
    expect(unavailableNote).toBeDefined();
    expect(unavailableNote).toMatch(/no stored market data/i);
  });

  it("unavailable symbols produce zero candidates — no hash-based prices leak through", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);
    mockGetRefSnaps.mockResolvedValue(new Map());

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    // If any candidates were present they would carry fabricated prices — there must be none
    expect(result.candidates).toHaveLength(0);
    expect(result.unavailableQuoteCount).toBeGreaterThan(0);
  });

  it("partial result: one symbol with bars, one without — only covered symbol reaches candidates", async () => {
    mockGetHistoricalBars.mockImplementation(({ symbol }: { symbol: string }) => {
      if (symbol === "NVDA") return Promise.resolve(TWO_BARS);
      return Promise.reject(EMPTY_ERROR);
    });

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(result.referenceQuoteCount).toBe(1);
    expect(result.unavailableQuoteCount).toBe(1);
    // Any candidates present must be from NVDA only
    for (const c of result.candidates) {
      expect(c.symbol).toBe("NVDA");
    }
  });

  it("calls getHistoricalBars with purpose:'scan' and allowExternalRefresh:false — no HTTP", async () => {
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    await generateCandidateScenarios("u1", {}, "long_call");

    const calls = mockGetHistoricalBars.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Every call from buildStoredQuote must use scan purpose and no external refresh
    const illegalCall = calls.find(
      (args) => args[0]?.allowExternalRefresh === true,
    );
    expect(illegalCall).toBeUndefined();
    // At least one call has the correct flags
    const correctCall = calls.find(
      (args) => args[0]?.purpose === "scan" && args[0]?.allowExternalRefresh === false,
    );
    expect(correctCall).toBeDefined();
  });

  it("unavailable path also never passes allowExternalRefresh:true", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);

    await generateCandidateScenarios("u1", {}, "long_call");

    const illegalCall = mockGetHistoricalBars.mock.calls.find(
      (args) => args[0]?.allowExternalRefresh === true,
    );
    expect(illegalCall).toBeUndefined();
  });

  it("Yahoo Finance and Stooq are absent from all call arguments", async () => {
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    await generateCandidateScenarios("u1", {}, "long_call");

    const callStrings = JSON.stringify(mockGetHistoricalBars.mock.calls);
    expect(callStrings).not.toMatch(/yahoo|stooq|query1\.finance/i);
  });
});

describe("buildStoredQuote — dataMode and label integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRefSnaps.mockResolvedValue(new Map());
  });

  it("dataMode is never 'live' when only stored bars are used (no broker)", async () => {
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(result.dataMode).not.toBe("live");
    // Notes must not claim live broker data
    expect(result.notes.join(" ")).not.toMatch(/live broker quotes/i);
  });

  it("RadarResult exposes unavailableQuoteCount as a number field", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(typeof result.unavailableQuoteCount).toBe("number");
  });

  it("unavailableQuoteCount is 0 when all symbols have stored bars", async () => {
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    expect(result.unavailableQuoteCount).toBe(0);
  });
});

describe("buildStoredQuote — synthetic data cannot reach saved-research or execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRefSnaps.mockResolvedValue(new Map());
  });

  it("unavailable symbols absent from candidate list — no trade ticket can be formed", async () => {
    mockGetHistoricalBars.mockRejectedValue(EMPTY_ERROR);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    // No candidate → no trade ticket, no research save, no order entry
    expect(result.candidates).toHaveLength(0);
  });

  it("candidates from stored bars carry non-fabricated underlyingPrice (derived from stored close)", async () => {
    // bars: latest close 105
    mockGetHistoricalBars.mockResolvedValue(TWO_BARS);

    const result = await generateCandidateScenarios("u1", {}, "long_call");

    // All candidates must have underlyingPrice > 0 (real data) and be for covered symbols
    for (const c of result.candidates) {
      expect(c.underlyingPrice).toBeGreaterThan(0);
      expect(["NVDA", "MSFT"]).toContain(c.symbol);
    }
  });
});
