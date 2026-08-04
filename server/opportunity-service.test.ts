/**
 * Tests for server/opportunity-service.ts — trigger contract regression suite.
 * Covers the trigger-persistence fix, session-expiry handling, and backfill safety.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanResult, Opportunity, InsertOpportunity } from "@shared/schema";
import {
  sanitizeTriggerPrice,
  isSessionExpired,
  INTRADAY_SESSION_STRATEGIES,
} from "./opportunity-service";
import {
  STRATEGY_ELIGIBILITY,
  runBackfill,
  type BackfillDeps,
} from "./scripts/backfill-trigger-prices";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: "sr-id",
    scanRunId: null,
    ticker: "BA",
    name: "Boeing",
    price: 220.5,
    change: 1.2,
    changePercent: 0.55,
    volume: 2_000_000,
    avgVolume: 1_800_000,
    rvol: 1.1,
    stage: "READY",
    resistance: 225.0,
    stopLoss: 215.0,
    patternScore: 75,
    ema9: 219.0,
    ema21: 215.0,
    atr: 3.5,
    strategy: "VCP",
    createdAt: new Date("2026-07-30T14:00:00Z"),
    ...overrides,
  } as ScanResult;
}

function oppRow(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-id",
    userId: "user-id",
    symbol: "BA",
    strategyId: "VCP",
    strategyName: "Momentum Breakout",
    timeframe: "1d",
    stageAtDetection: "READY",
    detectedAt: new Date("2026-07-30T14:00:00Z"),
    detectedPrice: 220.5,
    resistancePrice: 225.0,
    stopReferencePrice: 215.0,
    entryTriggerPrice: null,
    rvol: 1.1,
    score: 75,
    status: "ACTIVE",
    resolvedAt: null,
    resolutionOutcome: null,
    resolutionReason: null,
    resolutionPrice: null,
    pnlPercent: null,
    maxPriceAfter: null,
    minPriceAfter: null,
    lastPrice: 221.0,
    maxFavorableMovePercent: null,
    maxAdverseMovePercent: null,
    barsTracked: 1,
    activeDurationMinutes: null,
    dedupeKey: "user-id:BA:VCP:1d:20666",
    createdAt: new Date("2026-07-30T14:00:00Z"),
    updatedAt: new Date("2026-07-30T14:00:00Z"),
    ...overrides,
  } as Opportunity;
}

// ---------------------------------------------------------------------------
// Test 1: sanitizeTriggerPrice — ingestion validates resistance correctly
// ---------------------------------------------------------------------------

describe("sanitizeTriggerPrice (ingestion guard)", () => {
  it("1. accepts a valid positive finite number", () => {
    expect(sanitizeTriggerPrice(225.0)).toBe(225.0);
    expect(sanitizeTriggerPrice(0.01)).toBe(0.01);
  });

  it("2. returns null when resistance is null or undefined", () => {
    expect(sanitizeTriggerPrice(null)).toBeNull();
    expect(sanitizeTriggerPrice(undefined)).toBeNull();
  });

  it("3. rejects NaN, Infinity, zero, and negative values", () => {
    expect(sanitizeTriggerPrice(NaN)).toBeNull();
    expect(sanitizeTriggerPrice(Infinity)).toBeNull();
    expect(sanitizeTriggerPrice(-Infinity)).toBeNull();
    expect(sanitizeTriggerPrice(0)).toBeNull();
    expect(sanitizeTriggerPrice(-5)).toBeNull();
  });

  it("4. does not derive a trigger from price percentage or arbitrary offset", () => {
    // sanitizeTriggerPrice is a pure validator — it never computes a derived value
    // from currentPrice or other fields. This test guards against that regression.
    const rawResistance = 225.0;
    const currentPrice = 220.0;
    const result = sanitizeTriggerPrice(rawResistance);
    // Result must equal the input verbatim
    expect(result).toBe(rawResistance);
    expect(result).not.toBe(currentPrice * 1.02);
  });
});

// ---------------------------------------------------------------------------
// Test 4: webhook vs scheduled ingestion equivalence (source-level guard)
// ---------------------------------------------------------------------------

describe("webhook vs scheduled ingestion equivalence", () => {
  it("4. both paths map scanResult.resistance to the same trigger value", async () => {
    // Webhook path (server/routes.ts ~6021) uses: entryTrigger: scanResult.resistance
    const webhookTrigger = scanResult().resistance; // 225.0

    // Scheduled path after the fix: sanitizeTriggerPrice(result.resistance)
    const scheduledTrigger = sanitizeTriggerPrice(scanResult().resistance);

    expect(scheduledTrigger).toBe(webhookTrigger);
  });
});

// ---------------------------------------------------------------------------
// Session expiry (tests 17–19)
// ---------------------------------------------------------------------------

describe("isSessionExpired — intraday session expiry", () => {
  // Use a fixed "now" in ET: 2026-08-04 09:30 ET = 2026-08-04T13:30:00Z
  const NOW_UTC = new Date("2026-08-04T13:30:00Z"); // Tuesday 9:30 AM ET

  it("17. ORB5 setup detected prior ET day is session-expired", () => {
    // Detected 2026-08-03 (Monday ET)
    const row = oppRow({ strategyId: "ORB5", detectedAt: new Date("2026-08-03T14:00:00Z") });
    expect(isSessionExpired(row, NOW_UTC)).toBe(true);
  });

  it("18. ORB15 setup detected same ET day is NOT session-expired", () => {
    // Detected 2026-08-04 at 09:31 ET = 13:31Z
    const row = oppRow({ strategyId: "ORB15", detectedAt: new Date("2026-08-04T13:31:00Z") });
    expect(isSessionExpired(row, NOW_UTC)).toBe(false);
  });

  it("19. GAP_AND_GO setup detected prior day is session-expired", () => {
    const row = oppRow({ strategyId: "GAP_AND_GO", detectedAt: new Date("2026-08-03T14:30:00Z") });
    expect(isSessionExpired(row, NOW_UTC)).toBe(true);
  });

  it("non-intraday strategy (VCP) is never session-expired", () => {
    const row = oppRow({ strategyId: "VCP", detectedAt: new Date("2026-07-01T14:00:00Z") });
    expect(isSessionExpired(row, NOW_UTC)).toBe(false);
  });

  it("RESOLVED row is never session-expired (already lifecycle-resolved)", () => {
    const row = oppRow({
      strategyId: "ORB5",
      status: "RESOLVED",
      detectedAt: new Date("2026-08-03T14:00:00Z"),
    });
    expect(isSessionExpired(row, NOW_UTC)).toBe(false);
  });

  it("INTRADAY_SESSION_STRATEGIES set contains the three expected strategies", () => {
    expect(INTRADAY_SESSION_STRATEGIES.has("ORB5")).toBe(true);
    expect(INTRADAY_SESSION_STRATEGIES.has("ORB15")).toBe(true);
    expect(INTRADAY_SESSION_STRATEGIES.has("GAP_AND_GO")).toBe(true);
    expect(INTRADAY_SESSION_STRATEGIES.has("VCP")).toBe(false);
    expect(INTRADAY_SESSION_STRATEGIES.has("VWAP_RECLAIM")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Backfill tests (tests 14–16)
// ---------------------------------------------------------------------------

describe("backfill-trigger-prices — strategy eligibility and dry-run", () => {
  it("strategy eligibility classifications are correct for all 10 strategies", () => {
    expect(STRATEGY_ELIGIBILITY["VCP"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["VCP_MULTIDAY"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["CLASSIC_PULLBACK"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["TREND_CONTINUATION"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["HIGH_RVOL"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["VOLATILITY_SQUEEZE"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["VWAP_RECLAIM"]).toBe("PRICE_TRIGGER_SAFE_TO_BACKFILL");
    expect(STRATEGY_ELIGIBILITY["GAP_AND_GO"]).toBe("SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW");
    expect(STRATEGY_ELIGIBILITY["ORB5"]).toBe("SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW");
    expect(STRATEGY_ELIGIBILITY["ORB15"]).toBe("SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW");
  });

  it("14. dry-run is idempotent — reports but does not write", async () => {
    const applyUpdate = vi.fn();
    const deps: BackfillDeps = {
      fetchRows: async () => [
        { id: "r1", symbol: "BA",  strategyId: "VCP",       status: "ACTIVE", resistancePrice: 225.0, entryTriggerPrice: null },
        { id: "r2", symbol: "DIS", strategyId: "VCP_MULTIDAY", status: "ACTIVE", resistancePrice: 105.0, entryTriggerPrice: null },
      ],
      applyUpdate,
    };
    const report = await runBackfill("dry-run", deps);
    expect(report.dryRun).toBe(true);
    expect(report.rowsInspected).toBe(2);
    expect(report.rowsEligible).toBe(2);
    expect(report.rowsSkipped).toBe(0);
    expect(applyUpdate).not.toHaveBeenCalled(); // no writes in dry-run
    // Idempotent: running again produces the same report
    const report2 = await runBackfill("dry-run", deps);
    expect(report2.rowsEligible).toBe(report.rowsEligible);
  });

  it("15. backfill skips rows with null, zero, NaN, or negative resistancePrice", async () => {
    const applyUpdate = vi.fn();
    const deps: BackfillDeps = {
      fetchRows: async () => [
        { id: "r1", symbol: "A", strategyId: "VCP", status: "ACTIVE", resistancePrice: null,     entryTriggerPrice: null },
        { id: "r2", symbol: "B", strategyId: "VCP", status: "ACTIVE", resistancePrice: 0,         entryTriggerPrice: null },
        { id: "r3", symbol: "C", strategyId: "VCP", status: "ACTIVE", resistancePrice: -5,        entryTriggerPrice: null },
        { id: "r4", symbol: "D", strategyId: "VCP", status: "ACTIVE", resistancePrice: Infinity,  entryTriggerPrice: null },
        { id: "r5", symbol: "E", strategyId: "VCP", status: "ACTIVE", resistancePrice: 225.0,     entryTriggerPrice: null }, // only this one eligible
      ],
      applyUpdate,
    };
    const report = await runBackfill("dry-run", deps);
    expect(report.rowsEligible).toBe(1);
    expect(report.rowsSkipped).toBe(4);
    expect(report.skipReasonSummary["INVALID_RESISTANCE_PRICE"]).toBe(4);
  });

  it("16. backfill skips ORB5, ORB15, GAP_AND_GO (session/event strategies)", async () => {
    const applyUpdate = vi.fn();
    const deps: BackfillDeps = {
      fetchRows: async () => [
        { id: "r1", symbol: "SPY",  strategyId: "ORB5",      status: "ACTIVE", resistancePrice: 530.0, entryTriggerPrice: null },
        { id: "r2", symbol: "QQQ",  strategyId: "ORB15",     status: "ACTIVE", resistancePrice: 450.0, entryTriggerPrice: null },
        { id: "r3", symbol: "NVDA", strategyId: "GAP_AND_GO",status: "ACTIVE", resistancePrice: 900.0, entryTriggerPrice: null },
      ],
      applyUpdate,
    };
    const report = await runBackfill("apply", deps);
    expect(report.rowsEligible).toBe(0);
    expect(report.rowsSkipped).toBe(3);
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(
      report.skipReasonSummary["SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW"],
    ).toBe(3);
  });

  it("backfill apply mode writes entryTriggerPrice for eligible rows", async () => {
    const applyUpdate = vi.fn();
    const deps: BackfillDeps = {
      fetchRows: async () => [
        { id: "r1", symbol: "BA", strategyId: "VCP", status: "ACTIVE", resistancePrice: 225.0, entryTriggerPrice: null },
      ],
      applyUpdate,
    };
    const report = await runBackfill("apply", deps);
    expect(report.rowsEligible).toBe(1);
    expect(applyUpdate).toHaveBeenCalledOnce();
    expect(applyUpdate).toHaveBeenCalledWith("r1", 225.0);
  });

  it("24. backfill script contains no execution behavior (no order placement)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./scripts/backfill-trigger-prices.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/placeOrder|submitOrder|executeOrder|createOrder|orderRoute/i);
  });

  it("25. backfill dry-run does not log sensitive fields (no secret leakage)", async () => {
    // The report's sampleChanges only contains symbol, strategyId, from:null, and to (price).
    const deps: BackfillDeps = {
      fetchRows: async () => [
        { id: "secret-internal-id", symbol: "BA", strategyId: "VCP", status: "ACTIVE", resistancePrice: 225.0, entryTriggerPrice: null },
      ],
      applyUpdate: vi.fn(),
    };
    const report = await runBackfill("dry-run", deps);
    const reportText = JSON.stringify(report);
    expect(reportText).not.toContain("secret-internal-id"); // internal id not in report
    for (const sample of report.sampleChanges) {
      expect(Object.keys(sample)).toEqual(["symbol", "strategyId", "from", "to"]);
    }
  });
});
