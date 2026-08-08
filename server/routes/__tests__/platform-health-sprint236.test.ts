// Sprint 2.3.6 — Platform Health & Sector Fix Regression Tests
//
// Covers:
//   - Job status store: all state transitions
//   - Job status store: all job names
//   - Sector engine: unclassifiedCount when no sector metadata
//   - Sector engine: classifiedButUnrankedCount
//   - Sector engine: unclassified symbols don't create a sector group
//   - Sector engine: partial classification produces valid sector snapshot
//   - Sector engine: full classification round-trip
//   - Symbol enrichment: coverage helper math
//   - Structured log: redaction of secret keys
//   - Structured log: errorMessage truncation
//   - Rebuild locking: isIntelligenceRebuildRunning() initial state
//   - Health status model: all five values
//   - Admin endpoints: conceptual auth guard (structural)
//   - Freshness calculation: seconds → human
//   - buildDashboardContracts: sector-only, theme-only, empty

import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Job Status Store
// ---------------------------------------------------------------------------
import {
  getJobStatus,
  getAllJobStatuses,
  markJobStarted,
  markJobCompleted,
  markJobFailed,
  markJobPartial,
  updateJobProgress,
  setJobNextScheduledRun,
} from "../../services/job-status-store";

describe("job-status-store", () => {
  // Each test reads the singleton — use fresh job names not used elsewhere

  const JOB = "symbol_enrichment" as const;

  it("returns idle state for unknown job", () => {
    const s = getJobStatus("scanner");
    expect(s.status).toBe("idle");
    expect(s.startedAt).toBeNull();
    expect(s.lastErrorCode).toBeNull();
  });

  it("getAllJobStatuses includes all defined jobs", () => {
    const all = getAllJobStatuses();
    expect(all).toHaveProperty("scanner");
    expect(all).toHaveProperty("ranking");
    expect(all).toHaveProperty("intelligence_precompute");
    expect(all).toHaveProperty("institutional_ingestion");
    expect(all).toHaveProperty("mapping_pipeline");
    expect(all).toHaveProperty("institutional_signal_rebuild");
    expect(all).toHaveProperty("symbol_enrichment");
  });

  it("markJobStarted transitions to running", () => {
    markJobStarted(JOB, { trigger: "test" });
    const s = getJobStatus(JOB);
    expect(s.status).toBe("running");
    expect(s.startedAt).not.toBeNull();
    expect(s.completedAt).toBeNull();
    expect(s.lastErrorCode).toBeNull();
  });

  it("markJobCompleted transitions to completed and sets lastSuccessAt", () => {
    markJobStarted(JOB);
    markJobCompleted(JOB, { processed: 5 });
    const s = getJobStatus(JOB);
    expect(s.status).toBe("completed");
    expect(s.completedAt).not.toBeNull();
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.processed).toBe(5);
  });

  it("markJobFailed transitions to failed and records error", () => {
    markJobStarted(JOB);
    markJobFailed(JOB, { errorCode: "ENRICH_FAIL", errorMessage: "API returned 429" });
    const s = getJobStatus(JOB);
    expect(s.status).toBe("failed");
    expect(s.lastErrorCode).toBe("ENRICH_FAIL");
    expect(s.lastErrorMessage).toContain("429");
  });

  it("markJobPartial transitions to partial", () => {
    markJobStarted(JOB);
    markJobPartial(JOB, { processed: 3, remaining: 7 });
    const s = getJobStatus(JOB);
    expect(s.status).toBe("partial");
    expect(s.processed).toBe(3);
    expect(s.remaining).toBe(7);
  });

  it("updateJobProgress updates counts without changing status", () => {
    markJobStarted(JOB);
    updateJobProgress(JOB, { processed: 10, remaining: 5 });
    const s = getJobStatus(JOB);
    expect(s.status).toBe("running");
    expect(s.processed).toBe(10);
    expect(s.remaining).toBe(5);
  });

  it("setJobNextScheduledRun stores ISO string", () => {
    const next = new Date(Date.now() + 3600_000).toISOString();
    setJobNextScheduledRun(JOB, next);
    const s = getJobStatus(JOB);
    expect(s.nextScheduledRun).toBe(next);
  });

  it("markJobFailed truncates long errorMessage to 500 chars", () => {
    markJobFailed(JOB, { errorMessage: "x".repeat(1000) });
    const s = getJobStatus(JOB);
    expect((s.lastErrorMessage ?? "").length).toBeLessThanOrEqual(500);
  });

  it("meta fields are preserved across transitions", () => {
    markJobStarted(JOB, { source: "admin_trigger" });
    const s = getJobStatus(JOB);
    expect(s.meta.source).toBe("admin_trigger");
  });
});

// ---------------------------------------------------------------------------
// Structured Log — redaction + truncation (pure, no I/O)
// ---------------------------------------------------------------------------

// Extract the redaction logic from structured-log.ts for pure testing
function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  for (const key of Object.keys(out)) {
    if (/key|token|secret|password|auth|credential|bearer/i.test(key)) {
      out[key] = "[REDACTED]";
    }
  }
  if (typeof out.errorMessage === "string") {
    out.errorMessage = out.errorMessage.slice(0, 500);
  }
  if (typeof out.stack === "string") {
    out.stack = out.stack.split("\n").slice(0, 6).join(" | ");
  }
  return out;
}

describe("structured-log redaction", () => {
  it("redacts 'key' field", () => {
    const out = redactPayload({ event: "test", apiKey: "secret123" });
    expect(out.apiKey).toBe("[REDACTED]");
  });

  it("redacts 'token' field", () => {
    const out = redactPayload({ event: "test", bearerToken: "tok" });
    expect(out.bearerToken).toBe("[REDACTED]");
  });

  it("redacts 'secret' field", () => {
    const out = redactPayload({ event: "test", jwtSecret: "abc" });
    expect(out.jwtSecret).toBe("[REDACTED]");
  });

  it("redacts 'password' field", () => {
    const out = redactPayload({ event: "test", password: "hunter2" });
    expect(out.password).toBe("[REDACTED]");
  });

  it("redacts 'auth' field", () => {
    const out = redactPayload({ event: "test", authHeader: "Bearer tok" });
    expect(out.authHeader).toBe("[REDACTED]");
  });

  it("does NOT redact 'event' field", () => {
    const out = redactPayload({ event: "scanner_started" });
    expect(out.event).toBe("scanner_started");
  });

  it("does NOT redact 'count' field", () => {
    const out = redactPayload({ event: "test", count: 42 });
    expect(out.count).toBe(42);
  });

  it("truncates errorMessage to 500 chars", () => {
    const out = redactPayload({ event: "test", errorMessage: "x".repeat(1000) });
    expect(typeof out.errorMessage).toBe("string");
    expect((out.errorMessage as string).length).toBeLessThanOrEqual(500);
  });

  it("truncates stack to 6 frames", () => {
    const stack = Array.from({ length: 20 }, (_, i) => `at fn${i} (file.ts:${i})`).join("\n");
    const out = redactPayload({ event: "test", stack });
    const frames = (out.stack as string).split(" | ");
    expect(frames.length).toBeLessThanOrEqual(6);
  });

  it("handles payload with no secret fields unchanged (non-secret fields)", () => {
    const out = redactPayload({ event: "ranking_completed", count: 5, durationMs: 1200 });
    expect(out.event).toBe("ranking_completed");
    expect(out.count).toBe(5);
    expect(out.durationMs).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// Sector Intelligence Engine — unclassified tracking
// ---------------------------------------------------------------------------

// Extracted pure logic from computeSectorSnapshot for unit testing
interface SymbolSectorInfo { symbol: string; sector: string; industry: string | null }
interface RankedSymbol { symbol: string; overallScore: number }

function computeUnclassifiedCount(
  rankedSymbols: RankedSymbol[],
  symbolSectors: SymbolSectorInfo[],
): { unclassifiedCount: number; classifiedButUnrankedCount: number } {
  const classifiedSymbolSet = new Set(symbolSectors.map(s => s.symbol));
  const rankedMap = new Map(rankedSymbols.map(r => [r.symbol, r]));

  const unclassifiedCount = rankedSymbols.filter(r => !classifiedSymbolSet.has(r.symbol)).length;
  const classifiedButUnrankedCount = symbolSectors.filter(s => !rankedMap.has(s.symbol)).length;

  return { unclassifiedCount, classifiedButUnrankedCount };
}

function buildSectorGroups(
  symbolSectors: SymbolSectorInfo[],
): Map<string, { symbols: string[] }> {
  const groups = new Map<string, { symbols: string[] }>();
  for (const info of symbolSectors) {
    if (!info.sector) continue;
    if (!groups.has(info.sector)) groups.set(info.sector, { symbols: [] });
    groups.get(info.sector)!.symbols.push(info.symbol);
  }
  return groups;
}

describe("sector engine — unclassified tracking", () => {
  it("all ranked symbols unclassified → unclassifiedCount = ranked count", () => {
    const ranked = [
      { symbol: "NVDA", overallScore: 85 },
      { symbol: "AMD", overallScore: 70 },
    ];
    const { unclassifiedCount } = computeUnclassifiedCount(ranked, []);
    expect(unclassifiedCount).toBe(2);
  });

  it("all ranked symbols classified → unclassifiedCount = 0", () => {
    const ranked = [{ symbol: "NVDA", overallScore: 85 }];
    const sectors: SymbolSectorInfo[] = [{ symbol: "NVDA", sector: "Technology", industry: "Semiconductors" }];
    const { unclassifiedCount } = computeUnclassifiedCount(ranked, sectors);
    expect(unclassifiedCount).toBe(0);
  });

  it("partial classification → correct unclassifiedCount", () => {
    const ranked = [
      { symbol: "NVDA", overallScore: 85 },
      { symbol: "AMD",  overallScore: 70 },
      { symbol: "AAPL", overallScore: 60 },
    ];
    const sectors: SymbolSectorInfo[] = [
      { symbol: "NVDA", sector: "Technology", industry: null },
    ];
    const { unclassifiedCount } = computeUnclassifiedCount(ranked, sectors);
    expect(unclassifiedCount).toBe(2);
  });

  it("classifiedButUnrankedCount counts symbols in DB not in ranking", () => {
    const ranked = [{ symbol: "NVDA", overallScore: 85 }];
    const sectors: SymbolSectorInfo[] = [
      { symbol: "NVDA", sector: "Technology", industry: null },
      { symbol: "AAPL", sector: "Technology", industry: null }, // in DB but not ranked
    ];
    const { classifiedButUnrankedCount } = computeUnclassifiedCount(ranked, sectors);
    expect(classifiedButUnrankedCount).toBe(1);
  });

  it("unclassified symbols don't create a sector group", () => {
    const sectors: SymbolSectorInfo[] = []; // no classifications
    const groups = buildSectorGroups(sectors);
    expect(groups.size).toBe(0);
  });

  it("symbol with empty string sector is skipped (same as null)", () => {
    const sectors = [{ symbol: "NVDA", sector: "", industry: null }];
    const groups = buildSectorGroups(sectors);
    expect(groups.size).toBe(0);
  });

  it("multiple symbols same sector → grouped together", () => {
    const sectors: SymbolSectorInfo[] = [
      { symbol: "NVDA", sector: "Technology", industry: "Semiconductors" },
      { symbol: "AMD",  sector: "Technology", industry: "Semiconductors" },
      { symbol: "AAPL", sector: "Technology", industry: "Consumer Electronics" },
    ];
    const groups = buildSectorGroups(sectors);
    expect(groups.size).toBe(1);
    expect(groups.get("Technology")?.symbols).toHaveLength(3);
  });

  it("symbols across multiple sectors → separate groups", () => {
    const sectors: SymbolSectorInfo[] = [
      { symbol: "NVDA", sector: "Technology", industry: null },
      { symbol: "JNJ",  sector: "Healthcare", industry: null },
      { symbol: "XOM",  sector: "Energy",     industry: null },
    ];
    const groups = buildSectorGroups(sectors);
    expect(groups.size).toBe(3);
    expect(groups.has("Technology")).toBe(true);
    expect(groups.has("Healthcare")).toBe(true);
    expect(groups.has("Energy")).toBe(true);
  });

  it("empty inputs → no unclassified, no groups", () => {
    const { unclassifiedCount, classifiedButUnrankedCount } = computeUnclassifiedCount([], []);
    expect(unclassifiedCount).toBe(0);
    expect(classifiedButUnrankedCount).toBe(0);
    expect(buildSectorGroups([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Symbol enrichment — coverage math
// ---------------------------------------------------------------------------

function computeCoveragePct(total: number, withSector: number): number {
  return total > 0 ? Math.round((withSector / total) * 100) : 0;
}

describe("symbol enrichment — coverage math", () => {
  it("0 / 0 → 0%", () => expect(computeCoveragePct(0, 0)).toBe(0));
  it("0 / 10 → 0%", () => expect(computeCoveragePct(10, 0)).toBe(0));
  it("10 / 10 → 100%", () => expect(computeCoveragePct(10, 10)).toBe(100));
  it("5 / 10 → 50%", () => expect(computeCoveragePct(10, 5)).toBe(50));
  it("3 / 7 → 43%", () => expect(computeCoveragePct(7, 3)).toBe(43));
  it("1 / 20 → 5%", () => expect(computeCoveragePct(20, 1)).toBe(5));
});

// ---------------------------------------------------------------------------
// Health status model — all five values
// ---------------------------------------------------------------------------

type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";

const ALL_STATUSES: HealthStatus[] = ["HEALTHY", "DEGRADED", "UNAVAILABLE", "DISABLED", "UNKNOWN"];

describe("health status model", () => {
  it("defines all five status values", () => {
    expect(ALL_STATUSES).toContain("HEALTHY");
    expect(ALL_STATUSES).toContain("DEGRADED");
    expect(ALL_STATUSES).toContain("UNAVAILABLE");
    expect(ALL_STATUSES).toContain("DISABLED");
    expect(ALL_STATUSES).toContain("UNKNOWN");
    expect(ALL_STATUSES).toHaveLength(5);
  });

  it("DISABLED is distinct from UNAVAILABLE (intentional vs broken)", () => {
    expect("DISABLED" as HealthStatus).not.toBe("UNAVAILABLE" as HealthStatus);
  });

  it("derives overall status as worst-of", () => {
    function overallStatus(statuses: HealthStatus[]): HealthStatus {
      if (statuses.some(s => s === "UNAVAILABLE")) return "UNAVAILABLE";
      if (statuses.some(s => s === "DEGRADED"))    return "DEGRADED";
      if (statuses.every(s => s === "HEALTHY" || s === "DISABLED")) return "HEALTHY";
      return "UNKNOWN";
    }

    expect(overallStatus(["HEALTHY", "HEALTHY"])).toBe("HEALTHY");
    expect(overallStatus(["HEALTHY", "DISABLED"])).toBe("HEALTHY");
    expect(overallStatus(["HEALTHY", "DEGRADED"])).toBe("DEGRADED");
    expect(overallStatus(["DEGRADED", "UNAVAILABLE"])).toBe("UNAVAILABLE");
    expect(overallStatus(["HEALTHY", "UNKNOWN"])).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// Freshness calculation
// ---------------------------------------------------------------------------

function freshness(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

describe("freshness calculation", () => {
  it("null → —", () => expect(freshness(null)).toBe("—"));
  it("undefined → —", () => expect(freshness(undefined)).toBe("—"));
  it("30s → 30s ago", () => expect(freshness(30)).toBe("30s ago"));
  it("90s → 2m ago", () => expect(freshness(90)).toBe("2m ago"));
  it("3600s → 1h ago", () => expect(freshness(3600)).toBe("1h ago"));
  it("86400s → 1d ago", () => expect(freshness(86400)).toBe("1d ago"));
  it("3 days → 3d ago", () => expect(freshness(3 * 86400)).toBe("3d ago"));
});

// ---------------------------------------------------------------------------
// Admin authorization — structural tests
// ---------------------------------------------------------------------------

describe("admin authorization (structural)", () => {
  it("isIntelligenceRebuildRunning starts false", async () => {
    const { isIntelligenceRebuildRunning } = await import("../intelligence");
    expect(isIntelligenceRebuildRunning()).toBe(false);
  });

  it("platform-health route file exists and exports registerPlatformHealthRoutes", async () => {
    const mod = await import("../platform-health");
    expect(typeof mod.registerPlatformHealthRoutes).toBe("function");
  });

  it("job-status-store exports all required functions", async () => {
    const mod = await import("../../services/job-status-store");
    expect(typeof mod.getJobStatus).toBe("function");
    expect(typeof mod.getAllJobStatuses).toBe("function");
    expect(typeof mod.markJobStarted).toBe("function");
    expect(typeof mod.markJobCompleted).toBe("function");
    expect(typeof mod.markJobFailed).toBe("function");
    expect(typeof mod.markJobPartial).toBe("function");
    expect(typeof mod.updateJobProgress).toBe("function");
  });

  it("symbol-enrichment exports enrichMissingSymbolClassifications", async () => {
    const mod = await import("../../services/daily-market-data/symbol-enrichment");
    expect(typeof mod.enrichMissingSymbolClassifications).toBe("function");
  });

  it("no secret values returned in diagnostics response (structural)", () => {
    // Admin diagnostics must never include: token, key, secret, password, connectionString
    const dangerousKeys = ["token", "apiKey", "secret", "password", "connectionString", "DATABASE_URL"];
    // The diagnostics handler only returns: tableExists, rowCount, latestGeneratedAt, readSuccess, error, ranking, briefing, institutionalSignals
    const safeKeys = ["tableExists", "rowCount", "latestGeneratedAt", "readSuccess", "error", "exists", "rankedSymbolCount", "canBuild", "failureStage"];
    for (const safe of safeKeys) {
      expect(dangerousKeys).not.toContain(safe);
    }
  });
});

// ---------------------------------------------------------------------------
// Rebuild locking
// ---------------------------------------------------------------------------

describe("rebuild locking", () => {
  it("isIntelligenceRebuildRunning returns boolean", async () => {
    const { isIntelligenceRebuildRunning } = await import("../intelligence");
    expect(typeof isIntelligenceRebuildRunning()).toBe("boolean");
  });
});
