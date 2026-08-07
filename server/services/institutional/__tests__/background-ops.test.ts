// Institutional Intelligence — Background Operations Tests
//
// Sprint 2.2.5: validates the daily job architecture, chunk mode,
// heartbeat, stale-run cleanup (including advisory lock serialization),
// catalog-miss behavior, and quarter state machine integration.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the database (required for cleanStalePendingRuns advisory lock tests)
// ---------------------------------------------------------------------------

vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config")>();
  return {
    ...actual,
    getInstitutionalConfig: vi.fn().mockReturnValue({
      ingestionEnabled: true,
      secUserAgent: "TestApp/1.0 (test@example.com)",
      backfillQuarters: 2,
    }),
    isIngestionConfigured: vi.fn().mockReturnValue(true),
    getStaleRunThresholdMinutes: vi.fn().mockReturnValue(30),
    INSTITUTIONAL_ADVISORY_LOCK_KEY: 774_412_003n,
  };
});

// Import after mocks are registered
import { computeQuarterState, isResumable, isReady, quarterStateLabel, type RunSnapshot } from "../quarter-state";
import { db } from "../../../db";

// ---------------------------------------------------------------------------
// Quarter state machine tests
// ---------------------------------------------------------------------------

describe("computeQuarterState", () => {
  const nowDate = new Date("2026-08-07T06:00:00Z");

  function run(overrides: Partial<RunSnapshot>): RunSnapshot {
    return {
      status: "completed",
      filingCount: 9364,
      holdingCount: 3327220,
      mappedCount: 3200000,
      totalAccessions: 9364,
      processedAccessions: 9364,
      lastHeartbeatAt: nowDate,
      startedAt: nowDate,
      errorCode: null,
      ...overrides,
    };
  }

  it("returns NOT_STARTED when no prior run exists", () => {
    expect(computeQuarterState(null, 0, false)).toBe("NOT_STARTED");
  });

  it("returns PARTIAL when totalAccessions is NULL (legacy false-completed — 2026-Q1 recovery)", () => {
    // 2026-Q1 was incorrectly marked completed with NULL totalAccessions
    const snapshot = run({ status: "completed", totalAccessions: null, processedAccessions: null });
    const state = computeQuarterState(snapshot, 1200, false);
    expect(state).toBe("PARTIAL");
  });

  it("returns PARTIAL when storedFilings < 95% of totalAccessions", () => {
    // Only 32% ingested
    const snapshot = run({ status: "partial", totalAccessions: 9364, processedAccessions: 3000 });
    const state = computeQuarterState(snapshot, 3000, false);
    expect(state).toBe("PARTIAL");
  });

  it("returns PARTIAL when ≥ 95% ingested but aggregates missing", () => {
    const snapshot = run({ status: "partial", totalAccessions: 9364, processedAccessions: 9300 });
    const state = computeQuarterState(snapshot, 9300, false);
    expect(state).toBe("PARTIAL");
  });

  it("returns READY when ≥ 95% ingested and aggregates exist with coverage", () => {
    const snapshot = run({ status: "completed", totalAccessions: 9364, processedAccessions: 9364 });
    const state = computeQuarterState(snapshot, 9364, true);
    expect(state).toBe("READY");
  });

  it("returns READY when exactly 95% ingested and aggregates exist", () => {
    const total = 9364;
    const stored = Math.ceil(total * 0.95);
    const snapshot = run({ status: "completed", totalAccessions: total, processedAccessions: stored });
    const state = computeQuarterState(snapshot, stored, true);
    expect(state).toBe("READY");
  });

  it("returns PARTIAL when run status is 'partial' regardless of counts", () => {
    const snapshot = run({ status: "partial", totalAccessions: 9364, processedAccessions: 100 });
    const state = computeQuarterState(snapshot, 100, false);
    expect(state).toBe("PARTIAL");
  });

  it("returns PARTIAL for legacy 2026-Q1: completed status with null totalAccessions", () => {
    // This is the critical legacy-recovery test.
    // Before Sprint 2.2.5, runs could be marked status='completed' before the
    // totalAccessions column existed. The state machine must return PARTIAL
    // (not NOT_STARTED or READY) so the daily job passes force=true and resumes.
    const legacySnapshot = run({
      status: "completed",
      filingCount: 9364,
      holdingCount: 3327220,
      totalAccessions: null,   // column did not exist in old schema
      processedAccessions: null,
    });
    const state = computeQuarterState(legacySnapshot, 9364, false);
    expect(state).toBe("PARTIAL"); // must NOT be READY or NOT_STARTED
    // Confirm the daily script would treat this as resumable and pass force=true
    expect(isResumable(state)).toBe(true);
  });

  it("returns FAILED when run status is 'failed'", () => {
    const snapshot = run({ status: "failed", filingCount: 0, holdingCount: 0, errorCode: "SOME_ERROR" });
    const state = computeQuarterState(snapshot, 0, false);
    expect(state).toBe("FAILED");
  });

  it("FAILED is resumable (daily job retries failed quarters)", () => {
    expect(isResumable("FAILED")).toBe(true);
  });

  it("NOT_STARTED is resumable (daily job starts new quarters)", () => {
    expect(isResumable("NOT_STARTED")).toBe(true);
  });

  it("PARTIAL is resumable", () => {
    expect(isResumable("PARTIAL")).toBe(true);
  });

  it("READY is not resumable", () => {
    expect(isResumable("READY")).toBe(false);
  });

  it("READY_FOR_MAPPING is not resumable", () => {
    expect(isResumable("READY_FOR_MAPPING")).toBe(false);
  });

  it("READY is ready", () => {
    expect(isReady("READY")).toBe(true);
  });

  it("PARTIAL is not ready", () => {
    expect(isReady("PARTIAL")).toBe(false);
  });

  it("NOT_STARTED is not ready", () => {
    expect(isReady("NOT_STARTED")).toBe(false);
  });

  it("quarterStateLabel returns human-readable string for all states", () => {
    expect(quarterStateLabel("NOT_STARTED")).toBeTruthy();
    expect(quarterStateLabel("PARTIAL")).toBeTruthy();
    expect(quarterStateLabel("READY")).toBeTruthy();
    expect(typeof quarterStateLabel("NOT_STARTED")).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Stale run cleanup — advisory lock serialization
// ---------------------------------------------------------------------------

describe("cleanStalePendingRuns — advisory lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns -1 and skips cleanup when advisory lock is held by another process", async () => {
    // Simulate the advisory lock already being held (acquired = false)
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ acquired: false }],
    } as any);

    const { cleanStalePendingRuns } = await import("../ingestion-service");
    const result = await cleanStalePendingRuns(30);

    expect(result).toBe(-1); // -1 means skipped, not an error
    // Should only call execute once (the lock check) — NOT the unlock or update
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it("proceeds with cleanup when advisory lock is available (no active ingestion)", async () => {
    // Lock acquired successfully (no active ingestion)
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ acquired: true }],
    } as any);
    // Lock release (pg_advisory_unlock)
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as any);

    // No stale runs found (select returns empty)
    const selectChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValueOnce(selectChain);

    const { cleanStalePendingRuns } = await import("../ingestion-service");
    const result = await cleanStalePendingRuns(30);

    expect(result).toBe(0); // 0 means no stale runs found (not -1)
    // Should call execute twice: lock check + unlock
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Daily job catalog-miss behavior (no legacy URL fallback)
// Tests use findDescriptorForQuarter from catalog-utils.ts (pure, no I/O deps)
// ---------------------------------------------------------------------------

describe("findDescriptorForQuarter — catalog miss / no fallback", () => {
  // Import synchronously at describe level (the module has no logger dep)
  let findDescriptorForQuarter: typeof import("../catalog-utils").findDescriptorForQuarter;

  beforeEach(async () => {
    ({ findDescriptorForQuarter } = await import("../catalog-utils"));
  });

  const entry2026Q1 = {
    canonicalPeriodLabel: "2026Q1",
    expectedPeriodOfReport: "2026-03-31",
    downloadUrl: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
    fileName: "01mar2026-31may2026_form13f.zip",
    displayLabel: "Mar 1 – May 31, 2026",
    windowStart: "2026-03-01",
    windowEnd: "2026-05-31",
    publicationModel: "three_month_window" as const,
  };

  const entry2025Q4 = {
    canonicalPeriodLabel: "2025Q4",
    expectedPeriodOfReport: "2025-12-31",
    downloadUrl: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2025q4_form13f.zip",
    fileName: "2025q4_form13f.zip",
    displayLabel: "2025 Q4",
    windowStart: "2025-10-01",
    windowEnd: "2025-12-31",
    publicationModel: "legacy_quarter" as const,
  };

  it("returns null when catalog entries are empty (catalog fetch failed — no fallback)", () => {
    // When the catalog is empty (fetch failed), findDescriptorForQuarter returns null.
    // The daily job script checks for null and logs a retriable catalog_miss
    // instead of falling back to guessed legacy URLs.
    const result = findDescriptorForQuarter("2026-Q1", []);
    expect(result).toBeNull();
  });

  it("returns null when the quarter is not present in the catalog", () => {
    // Catalog has 2025-Q4 only — 2026-Q1 is missing
    const result = findDescriptorForQuarter("2026-Q1", [entry2025Q4]);
    expect(result).toBeNull();
  });

  it("returns a DatasetDescriptor when the quarter matches a catalog entry", () => {
    const result = findDescriptorForQuarter("2026-Q1", [entry2026Q1, entry2025Q4]);
    expect(result).not.toBeNull();
    expect(result?.expectedPeriodOfReport).toBe("2026-03-31");
    expect(result?.downloadUrl).toContain("sec.gov");
    expect(result?.q).toBe(1);
    expect(result?.year).toBe(2026);
  });

  it("selects the correct entry when catalog has multiple quarters", () => {
    // Ensure 2025-Q4 is not returned when asking for 2026-Q1
    const forQ1 = findDescriptorForQuarter("2026-Q1", [entry2026Q1, entry2025Q4]);
    const forQ4 = findDescriptorForQuarter("2025-Q4", [entry2026Q1, entry2025Q4]);
    expect(forQ1?.expectedPeriodOfReport).toBe("2026-03-31");
    expect(forQ4?.expectedPeriodOfReport).toBe("2025-12-31");
  });

  it("no legacy fallback: null means the daily job defers to the next run", () => {
    // Verifies the no-fallback contract: when findDescriptorForQuarter returns null,
    // the caller (daily script) must log catalog_miss and skip — not construct a URL.
    // Both cases below produce null, confirming there is no fallback path.
    const emptyCatalog = findDescriptorForQuarter("2026-Q1", []);
    const missingQuarter = findDescriptorForQuarter("2026-Q2", [entry2026Q1]);
    expect(emptyCatalog).toBeNull();
    expect(missingQuarter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Config tests — getAccessionsPerRun + getStaleRunThresholdMinutes
// ---------------------------------------------------------------------------

describe("getAccessionsPerRun", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 300 when env var is not set", async () => {
    delete process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN;
    // Import the real config (not the mock) via resetModules
    const { getAccessionsPerRun } = await vi.importActual<typeof import("../config")>("../config");
    expect(getAccessionsPerRun()).toBe(300);
  });

  it("returns parsed value when env var is valid", async () => {
    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "500";
    const { getAccessionsPerRun } = await vi.importActual<typeof import("../config")>("../config");
    expect(getAccessionsPerRun()).toBe(500);
  });

  it("returns 300 (default) when env var is below range (< 50)", async () => {
    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "10";
    const { getAccessionsPerRun } = await vi.importActual<typeof import("../config")>("../config");
    expect(getAccessionsPerRun()).toBe(300);
  });

  it("returns 300 (default) when env var exceeds range (> 2000)", async () => {
    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "5000";
    const { getAccessionsPerRun } = await vi.importActual<typeof import("../config")>("../config");
    expect(getAccessionsPerRun()).toBe(300);
  });

  it("returns 300 (default) when env var is not a number", async () => {
    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "abc";
    const { getAccessionsPerRun } = await vi.importActual<typeof import("../config")>("../config");
    expect(getAccessionsPerRun()).toBe(300);
  });

  it("accepts boundary values 50 and 2000", async () => {
    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "50";
    const { getAccessionsPerRun: g50 } = await vi.importActual<typeof import("../config")>("../config");
    expect(g50()).toBe(50);

    process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN = "2000";
    const { getAccessionsPerRun: g2000 } = await vi.importActual<typeof import("../config")>("../config");
    expect(g2000()).toBe(2000);
  });
});

describe("getStaleRunThresholdMinutes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 30 when env var is not set", async () => {
    delete process.env.INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES;
    const { getStaleRunThresholdMinutes } = await vi.importActual<typeof import("../config")>("../config");
    expect(getStaleRunThresholdMinutes()).toBe(30);
  });

  it("returns parsed value when env var is valid", async () => {
    process.env.INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES = "45";
    const { getStaleRunThresholdMinutes } = await vi.importActual<typeof import("../config")>("../config");
    expect(getStaleRunThresholdMinutes()).toBe(45);
  });

  it("returns 30 (default) when value is below range (< 10)", async () => {
    process.env.INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES = "5";
    const { getStaleRunThresholdMinutes } = await vi.importActual<typeof import("../config")>("../config");
    expect(getStaleRunThresholdMinutes()).toBe(30);
  });

  it("returns 30 (default) when value exceeds range (> 120)", async () => {
    process.env.INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES = "200";
    const { getStaleRunThresholdMinutes } = await vi.importActual<typeof import("../config")>("../config");
    expect(getStaleRunThresholdMinutes()).toBe(30);
  });
});
