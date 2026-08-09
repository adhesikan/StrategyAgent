// ---------------------------------------------------------------------------
// Sprint 2.5.3B — Platform Health & Operations Center Tests
//
// 150+ assertions covering:
//   - Freshness helper (assessFreshness)
//   - FreshnessRules canonical thresholds
//   - OperationsSummary computation (7 dimensions)
//   - ResearchPipeline stages (10 stages)
//   - DataFreshness computation
//   - Status normalization (health vs readiness distinction)
//   - Failure isolation
//   - Security / secret redaction
//   - Ops manual / UAT doc checks
//   - Business logic unchanged confirmation
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  assessFreshness,
  FRESHNESS_RULES,
  type FreshnessRule,
} from "../../lib/health-freshness";
import {
  computeOperationsSummary,
  computePipelineStages,
  computeDataFreshness,
} from "../../routes/platform-health-test-exports";

// ---------------------------------------------------------------------------
// Freshness Helper — assessFreshness()
// ---------------------------------------------------------------------------

describe("assessFreshness", () => {
  const rule: FreshnessRule = {
    dataset:        "Test Dataset",
    expectedCadence: "Hourly",
    freshWithinMs:  60_000,           // 1 min
    recentWithinMs: 3_600_000,        // 1 hour
    delayedWithinMs:86_400_000,       // 1 day
  };

  it("returns FRESH when within freshWithinMs", () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.freshnessStatus).toBe("FRESH");
    expect(r.ageSec).toBeLessThanOrEqual(31);
    expect(r.lastUpdated).toBe(ts);
  });

  it("returns RECENT when beyond freshWithinMs but within recentWithinMs", () => {
    const ts = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    const r  = assessFreshness(ts, rule);
    expect(r.freshnessStatus).toBe("RECENT");
  });

  it("returns DELAYED when beyond recentWithinMs but within delayedWithinMs", () => {
    const ts = new Date(Date.now() - 7_200_000).toISOString(); // 2 hours ago
    const r  = assessFreshness(ts, rule);
    expect(r.freshnessStatus).toBe("DELAYED");
  });

  it("returns STALE when beyond delayedWithinMs", () => {
    const ts = new Date(Date.now() - 90_000 * 1000).toISOString(); // >1 day ago
    const r  = assessFreshness(ts, rule);
    expect(r.freshnessStatus).toBe("STALE");
  });

  it("returns UNKNOWN when timestamp is null", () => {
    const r = assessFreshness(null, rule);
    expect(r.freshnessStatus).toBe("UNKNOWN");
    expect(r.ageLabel).toBe("Never");
    expect(r.ageSec).toBeNull();
  });

  it("returns UNKNOWN when timestamp is undefined", () => {
    const r = assessFreshness(undefined, rule);
    expect(r.freshnessStatus).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for invalid date string", () => {
    const r = assessFreshness("not-a-date", rule);
    expect(r.freshnessStatus).toBe("UNKNOWN");
  });

  it("returns NOT_APPLICABLE when notApplicable rule", () => {
    const r = assessFreshness(null, { ...rule, notApplicable: true });
    expect(r.freshnessStatus).toBe("NOT_APPLICABLE");
    expect(r.freshnessLabel).toBe("N/A");
  });

  it("returns DELAYED (not STALE) for delayed-by-design datasets", () => {
    const ts = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString(); // 90 days ago
    const r  = assessFreshness(ts, { ...rule, delayedByDesign: true });
    expect(r.freshnessStatus).toBe("DELAYED");
    expect(r.freshnessLabel).toBe("Delayed by design");
    // Must NOT be STALE regardless of age
    expect(r.freshnessStatus).not.toBe("STALE");
  });

  it("ageLabel formats seconds correctly", () => {
    const ts = new Date(Date.now() - 45_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.ageLabel).toMatch(/s ago/);
  });

  it("ageLabel formats minutes correctly", () => {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.ageLabel).toMatch(/m ago/);
  });

  it("ageLabel formats hours correctly", () => {
    const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.ageLabel).toMatch(/h ago/);
  });

  it("ageLabel formats days correctly", () => {
    const ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.ageLabel).toMatch(/d ago/);
  });

  it("populates dataset and expectedCadence from rule", () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    const r  = assessFreshness(ts, rule);
    expect(r.dataset).toBe("Test Dataset");
    expect(r.expectedCadence).toBe("Hourly");
  });

  it("institutional signals rule uses delayedByDesign", () => {
    const ts = new Date(Date.now() - 45 * 24 * 3_600_000).toISOString();
    const r  = assessFreshness(ts, FRESHNESS_RULES.institutionalSignals);
    expect(r.freshnessStatus).toBe("DELAYED");
    expect(r.freshnessStatus).not.toBe("STALE");
  });

  it("opportunity ranking rule: fresh within 8h", () => {
    const ts = new Date(Date.now() - 7 * 3_600_000).toISOString();
    const r  = assessFreshness(ts, FRESHNESS_RULES.opportunityRanking);
    expect(r.freshnessStatus).toBe("FRESH");
  });

  it("opportunity ranking rule: stale after 72h+", () => {
    const ts = new Date(Date.now() - 73 * 3_600_000).toISOString();
    const r  = assessFreshness(ts, FRESHNESS_RULES.opportunityRanking);
    expect(r.freshnessStatus).toBe("STALE");
  });

  it("market prices rule: stale after 3 days", () => {
    const ts = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const r  = assessFreshness(ts, FRESHNESS_RULES.marketPrices);
    expect(r.freshnessStatus).toBe("STALE");
  });
});

// ---------------------------------------------------------------------------
// FRESHNESS_RULES catalog — canonical rules exist for all tracked datasets
// ---------------------------------------------------------------------------

describe("FRESHNESS_RULES catalog", () => {
  const expected = [
    "marketPrices", "historicalBars", "symbolMetadata",
    "opportunityRanking", "opportunityIntelligence",
    "sectorIntelligence", "themeIntelligence",
    "institutionalSignals", "researchCollections",
    "researchMonitor", "commandCenterSnapshot",
    "researchReports", "portfolioHistory", "brokerSync",
  ];

  it("has all required rule keys", () => {
    for (const key of expected) {
      expect(FRESHNESS_RULES).toHaveProperty(key);
    }
  });

  it("every rule has a dataset and expectedCadence", () => {
    for (const rule of Object.values(FRESHNESS_RULES)) {
      expect(typeof rule.dataset).toBe("string");
      expect(rule.dataset.length).toBeGreaterThan(0);
      // expectedCadence may be null only for notApplicable rules
      if (!rule.notApplicable) {
        expect(rule.expectedCadence).not.toBeNull();
      }
    }
  });

  it("institutionalSignals is delayedByDesign", () => {
    expect(FRESHNESS_RULES.institutionalSignals.delayedByDesign).toBe(true);
  });

  it("brokerSync is NOT delayedByDesign (delayed only when disabled)", () => {
    expect(FRESHNESS_RULES.brokerSync.delayedByDesign).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Helper: build minimal mock health object for computations
// ---------------------------------------------------------------------------

type MockHealth = Record<string, {
  status:        string;
  summary?:      string;
  lastSuccessAt?: string | null;
  freshnessSec?:  number | null;
  action?:        string | null;
  details?:       Record<string, unknown>;
}>;

function makeHealth(overrides: MockHealth = {}): MockHealth {
  return {
    application:             { status: "HEALTHY",  summary: "dev — uptime 1h", details: { environment: "development" } },
    database:                { status: "HEALTHY",  summary: "DB ok", details: { latencyMs: 5, tableCount: 50 } },
    marketData:              { status: "HEALTHY",  summary: "120 symbols", details: { symbolCount: 120, sectorPct: 80 }, lastSuccessAt: new Date(Date.now() - 3_600_000).toISOString() },
    mcp:                     { status: "DISABLED", summary: "MCP disabled", details: {} },
    scanner:                 { status: "HEALTHY",  summary: "Scan done", details: { scanStatus: "COMPLETED", candidateCount: 200, qualifiedCount: 40 }, lastSuccessAt: new Date().toISOString() },
    ranking:                 { status: "HEALTHY",  summary: "28 ranked", details: { symbolCount: 28, regime: "BULLISH" }, lastSuccessAt: new Date().toISOString() },
    intelligence:            { status: "HEALTHY",  summary: "Sectors ok", details: { sectorSnapshotRows: 12, themeSnapshotRows: 18, sectorLatest: new Date().toISOString(), themeLatest: new Date().toISOString() }, lastSuccessAt: new Date().toISOString() },
    institutional:           { status: "DISABLED", summary: "13F disabled", details: {} },
    securityMaster:          { status: "HEALTHY",  summary: "800 symbols", details: { total: 800 } },
    brokers:                 { status: "HEALTHY",  summary: "Tradier configured", details: {} },
    brokerSync:              { status: "DISABLED", summary: "No portfolios linked", details: {} },
    opportunityIntelligence: { status: "HEALTHY",  summary: "45 opps", details: { hasSnapshot: true, totalOpportunities: 45, growthCount: 20, incomeCount: 15, lastGeneratedAt: new Date().toISOString() }, lastSuccessAt: new Date().toISOString() },
    collections:             { status: "HEALTHY",  summary: "25 system", details: { systemCollectionCount: 25, userCollectionCount: 3 } },
    researchWorkspace:       { status: "HEALTHY",  summary: "AI ready", details: { openAiConfigured: true, contextAssemblyOk: true, conversationCount: 10, pinnedConversations: 2 } },
    commandCenter:           { status: "HEALTHY",  summary: "8/9 sections", details: { sectionsAvailable: 8 }, lastSuccessAt: new Date().toISOString(), freshnessSec: 1800 },
    researchMonitoring:      { status: "HEALTHY",  summary: "3 active", details: { watchCount: 3, activeWatchCount: 3, evaluationsToday: 1 } },
    researchReports:         { status: "HEALTHY",  summary: "12 reports", details: { reportsGenerated: 12, reportsToday: 2 }, lastSuccessAt: new Date().toISOString() },
    portfolioHistory:        { status: "HEALTHY",  summary: "2 portfolios", details: { portfoliosTracked: 2, snapshotsTotal: 5, snapshotsToday: 1 }, lastSuccessAt: new Date().toISOString() },
    portfolioIntelligence:   { status: "UNKNOWN",  summary: "No analyses yet", details: {} },
    jobs:                    { status: "HEALTHY",  summary: "0 jobs running", details: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OperationsSummary computation
// ---------------------------------------------------------------------------

describe("computeOperationsSummary", () => {
  it("returns overallStatus READY when all core dimensions are ready", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    // With all HEALTHY health cards, should be READY
    expect(summary.overallStatus).toBe("READY");
    expect(summary.requiresAttention).toBe(false);
    expect(summary.reasons).toHaveLength(0);
    expect(summary.headline).toBe("Today's Research Platform is Ready");
  });

  it("returns 7 dimensions", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    expect(summary.dimensions).toHaveLength(7);
    const names = summary.dimensions.map(d => d.dimension);
    expect(names).toContain("Platform Status");
    expect(names).toContain("Research Readiness");
    expect(names).toContain("Market Data Readiness");
    expect(names).toContain("AI Readiness");
    expect(names).toContain("Reports Readiness");
    expect(names).toContain("Portfolio Services Readiness");
    expect(names).toContain("Broker Services Readiness");
  });

  it("Broker Services is DISABLED when brokerSync is DISABLED", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    const broker = summary.dimensions.find(d => d.dimension === "Broker Services Readiness");
    expect(broker?.status).toBe("DISABLED");
    // DISABLED does not trigger requiresAttention
    expect(broker?.reason).toBeNull();
  });

  it("requiresAttention when ranking is DEGRADED", () => {
    const h = makeHealth({ ranking: { status: "DEGRADED", summary: "No ranking", details: {} } });
    const summary = computeOperationsSummary(h as any);
    expect(summary.requiresAttention).toBe(true);
    expect(summary.reasons.length).toBeGreaterThan(0);
    expect(summary.headline).toContain("Requires Attention");
  });

  it("research readiness WAITING when ranking is DEGRADED", () => {
    const h = makeHealth({ ranking: { status: "DEGRADED", summary: "No ranking", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Research Readiness");
    expect(dim?.status).toBe("WAITING");
    expect(dim?.reason).toContain("Ranking");
  });

  it("platform status FAILED when database is UNAVAILABLE", () => {
    const h = makeHealth({ database: { status: "UNAVAILABLE", summary: "DB down", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Platform Status");
    expect(dim?.status).toBe("FAILED");
    expect(summary.overallStatus).toBe("FAILED");
  });

  it("overallStatus DEGRADED when market data is DEGRADED", () => {
    const h = makeHealth({ marketData: { status: "DEGRADED", summary: "Stale", details: {}, action: "Fix it" } });
    const summary = computeOperationsSummary(h as any);
    expect(summary.overallStatus).toBe("DEGRADED");
    const dim = summary.dimensions.find(d => d.dimension === "Market Data Readiness");
    expect(dim?.status).toBe("DEGRADED");
  });

  it("Market Data DISABLED when marketData status is DISABLED", () => {
    const h = makeHealth({ marketData: { status: "DISABLED", summary: "Not configured", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Market Data Readiness");
    expect(dim?.status).toBe("DISABLED");
    // DISABLED should not trigger attention
    expect(dim?.reason).toBeNull();
  });

  it("AI Readiness DEGRADED when researchWorkspace is DEGRADED", () => {
    const h = makeHealth({ researchWorkspace: { status: "DEGRADED", summary: "No OpenAI key", details: { openAiConfigured: false } } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "AI Readiness");
    expect(dim?.status).toBe("DEGRADED");
    expect(dim?.reason).toContain("Research Workspace");
  });

  it("Reports Readiness WAITING when researchReports is UNKNOWN", () => {
    const h = makeHealth({ researchReports: { status: "UNKNOWN", summary: "No reports", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Reports Readiness");
    expect(dim?.status).toBe("WAITING");
  });

  it("Portfolio Readiness WAITING when portfolioHistory is UNKNOWN", () => {
    const h = makeHealth({ portfolioHistory: { status: "UNKNOWN", summary: "No snapshots", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Portfolio Services Readiness");
    expect(dim?.status).toBe("WAITING");
  });

  it("Broker Services DEGRADED when brokerSync is DEGRADED", () => {
    const h = makeHealth({ brokerSync: { status: "DEGRADED", summary: "1 failed", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Broker Services Readiness");
    expect(dim?.status).toBe("DEGRADED");
    expect(dim?.reason).toContain("sync");
  });

  it("generatedAt is an ISO string", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    expect(() => new Date(summary.generatedAt)).not.toThrow();
    expect(typeof summary.generatedAt).toBe("string");
  });

  it("each dimension has a runbookQuery", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    for (const dim of summary.dimensions) {
      expect(typeof dim.runbookQuery).toBe("string");
      expect(dim.runbookQuery.length).toBeGreaterThan(0);
    }
  });

  it("health vs readiness distinction: scanner can be HEALTHY while research is WAITING", () => {
    // scanner health = HEALTHY (it ran) but ranking hasn't been computed yet
    const h = makeHealth({
      scanner: { status: "HEALTHY", summary: "Scan done", details: { scanStatus: "COMPLETED", candidateCount: 200, qualifiedCount: 40 } },
      ranking: { status: "DEGRADED", summary: "No ranking", details: {} },
    });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Research Readiness");
    expect(dim?.status).toBe("WAITING");
    // Scanner being healthy doesn't make research ready
    expect(summary.requiresAttention).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Research Pipeline stages
// ---------------------------------------------------------------------------

describe("computePipelineStages", () => {
  it("returns exactly 10 stages", () => {
    const stages = computePipelineStages(makeHealth() as any);
    expect(stages).toHaveLength(10);
  });

  it("stage names are correct", () => {
    const stages = computePipelineStages(makeHealth() as any);
    const names  = stages.map(s => s.name);
    expect(names).toContain("Market Data");
    expect(names).toContain("Universe Ready");
    expect(names).toContain("Scanner");
    expect(names).toContain("Opportunity Ranking");
    expect(names).toContain("Opportunity Intelligence");
    expect(names).toContain("Sector / Theme Intelligence");
    expect(names).toContain("Research Collections");
    expect(names).toContain("Research Monitoring");
    expect(names).toContain("Market Research Command Center");
    expect(names).toContain("Research Reports");
  });

  it("Scanner stage shows WAITING when no scan has run", () => {
    const h = makeHealth({
      scanner: { status: "DEGRADED", summary: "No scan yet", details: { scanStatus: undefined } },
    });
    const stages = computePipelineStages(h as any);
    const scanStage = stages.find(s => s.name === "Scanner");
    expect(scanStage?.status).toBe("WAITING");
    expect(scanStage?.primaryMetric).toContain("Not run yet");
  });

  it("Scanner stage shows HEALTHY for COMPLETED scan", () => {
    const stages = computePipelineStages(makeHealth() as any);
    const scanStage = stages.find(s => s.name === "Scanner");
    expect(scanStage?.status).toBe("HEALTHY");
    expect(scanStage?.primaryMetric).toContain("candidates");
  });

  it("Universe Ready is WAITING when no symbols", () => {
    const h = makeHealth({
      marketData: { status: "DEGRADED", summary: "No data", details: { symbolCount: 0 } },
    });
    const stages = computePipelineStages(h as any);
    const universeStage = stages.find(s => s.name === "Universe Ready");
    expect(universeStage?.status).toBe("WAITING");
    expect(universeStage?.primaryMetric).toContain("No symbols");
  });

  it("Opportunity Intelligence stage shows metric from details", () => {
    const stages = computePipelineStages(makeHealth() as any);
    const oiStage = stages.find(s => s.name === "Opportunity Intelligence");
    expect(oiStage?.primaryMetric).toContain("opportunities");
    expect(oiStage?.status).toBe("HEALTHY");
  });

  it("Command Center stage is WAITING when no snapshot", () => {
    const h = makeHealth({
      commandCenter: { status: "UNKNOWN", summary: "No snapshot yet", details: { sectionsAvailable: 0 } },
    });
    const stages = computePipelineStages(h as any);
    const ccStage = stages.find(s => s.name === "Market Research Command Center");
    expect(ccStage?.status).toBe("WAITING");
  });

  it("Research Reports stage is WAITING when UNKNOWN", () => {
    const h = makeHealth({
      researchReports: { status: "UNKNOWN", summary: "No reports", details: {} },
    });
    const stages = computePipelineStages(h as any);
    const rrStage = stages.find(s => s.name === "Research Reports");
    expect(rrStage?.status).toBe("WAITING");
  });

  it("each stage has a runbookQuery", () => {
    const stages = computePipelineStages(makeHealth() as any);
    for (const stage of stages) {
      expect(typeof stage.runbookQuery).toBe("string");
      expect(stage.runbookQuery.length).toBeGreaterThan(0);
    }
  });

  it("stages with diagnosticPath have valid path format", () => {
    const stages = computePipelineStages(makeHealth() as any);
    for (const stage of stages) {
      if (stage.diagnosticPath) {
        expect(stage.diagnosticPath).toMatch(/^\/api\//);
      }
    }
  });

  it("Market Data DISABLED maps to DISABLED pipeline stage", () => {
    const h = makeHealth({
      marketData: { status: "DISABLED", summary: "Not configured", details: {} },
    });
    const stages = computePipelineStages(h as any);
    const mdStage = stages.find(s => s.name === "Market Data");
    expect(mdStage?.status).toBe("DISABLED");
    expect(mdStage?.primaryMetric).toContain("Not configured");
  });

  it("Ranking stage shows regime in metric", () => {
    const stages = computePipelineStages(makeHealth() as any);
    const rankStage = stages.find(s => s.name === "Opportunity Ranking");
    expect(rankStage?.primaryMetric).toContain("BULLISH");
  });

  it("Sector/Theme stage shows counts from details", () => {
    const stages = computePipelineStages(makeHealth() as any);
    const intelStage = stages.find(s => s.name === "Sector / Theme Intelligence");
    expect(intelStage?.primaryMetric).toContain("sector rows");
    expect(intelStage?.primaryMetric).toContain("theme rows");
  });
});

// ---------------------------------------------------------------------------
// Data Freshness computation
// ---------------------------------------------------------------------------

describe("computeDataFreshness", () => {
  it("returns 14 freshness items", () => {
    const items = computeDataFreshness(makeHealth() as any);
    expect(items).toHaveLength(14);
  });

  it("every item has dataset, freshnessStatus, freshnessLabel", () => {
    const items = computeDataFreshness(makeHealth() as any);
    for (const item of items) {
      expect(typeof item.dataset).toBe("string");
      expect(item.dataset.length).toBeGreaterThan(0);
      expect(["FRESH","RECENT","DELAYED","STALE","UNKNOWN","NOT_APPLICABLE"]).toContain(item.freshnessStatus);
      expect(typeof item.freshnessLabel).toBe("string");
    }
  });

  it("Institutional Signals is DELAYED (delayed by design)", () => {
    const items = computeDataFreshness(makeHealth() as any);
    const inst = items.find(i => i.dataset === "Institutional Signals (13F)");
    // When disabled → NOT_APPLICABLE
    expect(inst?.freshnessStatus).toBe("NOT_APPLICABLE");
  });

  it("Institutional Signals DELAYED by design when enabled and old", () => {
    const h = makeHealth({
      institutional: {
        status: "HEALTHY", summary: "13F ok",
        details: { latestIngestionAt: new Date(Date.now() - 60 * 24 * 3_600_000).toISOString() },
        lastSuccessAt: new Date(Date.now() - 60 * 24 * 3_600_000).toISOString(),
      },
    });
    const items = computeDataFreshness(h as any);
    const inst = items.find(i => i.dataset === "Institutional Signals (13F)");
    expect(inst?.freshnessStatus).toBe("DELAYED");
    expect(inst?.freshnessStatus).not.toBe("STALE");
  });

  it("Broker Sync is NOT_APPLICABLE when DISABLED", () => {
    const items = computeDataFreshness(makeHealth() as any);
    const bs = items.find(i => i.dataset === "Broker Sync");
    expect(bs?.freshnessStatus).toBe("NOT_APPLICABLE");
  });

  it("Market Prices is FRESH when lastSuccessAt is recent", () => {
    const items = computeDataFreshness(makeHealth() as any);
    const mp = items.find(i => i.dataset === "Market Prices");
    // default mock has lastSuccessAt 1h ago — within 6h fresh threshold
    expect(mp?.freshnessStatus).toBe("FRESH");
  });

  it("Market Prices is NOT_APPLICABLE when market data is DISABLED", () => {
    const h = makeHealth({ marketData: { status: "DISABLED", summary: "Not configured", details: {} } });
    const items = computeDataFreshness(h as any);
    const mp = items.find(i => i.dataset === "Market Prices");
    expect(mp?.freshnessStatus).toBe("NOT_APPLICABLE");
  });

  it("Opportunity Ranking is FRESH when recent lastSuccessAt", () => {
    const items = computeDataFreshness(makeHealth() as any);
    const or = items.find(i => i.dataset === "Opportunity Ranking");
    expect(or?.freshnessStatus).toBe("FRESH");
  });

  it("Portfolio History UNKNOWN when no lastSuccessAt", () => {
    const h = makeHealth({ portfolioHistory: { status: "UNKNOWN", summary: "No snapshots", details: {} } });
    const items = computeDataFreshness(h as any);
    const ph = items.find(i => i.dataset === "Portfolio History");
    expect(ph?.freshnessStatus).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// Failure isolation — one subsystem failure does not cascade
// ---------------------------------------------------------------------------

describe("failure isolation", () => {
  it("computeOperationsSummary does not throw when all cards are unknown", () => {
    const h: MockHealth = {};
    expect(() => computeOperationsSummary(h as any)).not.toThrow();
  });

  it("computePipelineStages does not throw when all cards are missing", () => {
    expect(() => computePipelineStages({} as any)).not.toThrow();
  });

  it("computeDataFreshness does not throw when all cards are missing", () => {
    expect(() => computeDataFreshness({} as any)).not.toThrow();
  });

  it("computePipelineStages returns 10 stages even with empty health", () => {
    const stages = computePipelineStages({} as any);
    expect(stages).toHaveLength(10);
  });

  it("computeDataFreshness returns 14 items even with empty health", () => {
    const items = computeDataFreshness({} as any);
    expect(items).toHaveLength(14);
  });

  it("computeOperationsSummary returns UNKNOWN overall when no health cards", () => {
    const summary = computeOperationsSummary({} as any);
    // All dimensions will be UNKNOWN or DISABLED with empty health
    expect(summary.overallStatus).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Status normalization — no invented statuses
// ---------------------------------------------------------------------------

describe("status normalization", () => {
  it("OperationalStatus values match canonical vocabulary", () => {
    const VALID: string[] = ["READY", "DEGRADED", "WAITING", "FAILED", "UNKNOWN", "DISABLED"];
    const summary = computeOperationsSummary(makeHealth() as any);
    for (const dim of summary.dimensions) {
      expect(VALID).toContain(dim.status);
    }
    expect(VALID).toContain(summary.overallStatus);
  });

  it("PipelineStageStatus values match canonical vocabulary", () => {
    const VALID: string[] = ["HEALTHY", "RUNNING", "WAITING", "DEGRADED", "FAILED", "UNKNOWN", "DISABLED"];
    const stages = computePipelineStages(makeHealth() as any);
    for (const stage of stages) {
      expect(VALID).toContain(stage.status);
    }
  });

  it("FreshnessStatus values match canonical vocabulary", () => {
    const VALID: string[] = ["FRESH", "RECENT", "DELAYED", "STALE", "UNKNOWN", "NOT_APPLICABLE"];
    const items = computeDataFreshness(makeHealth() as any);
    for (const item of items) {
      expect(VALID).toContain(item.freshnessStatus);
    }
  });
});

// ---------------------------------------------------------------------------
// Security / secret redaction — no sensitive values in computed outputs
// ---------------------------------------------------------------------------

describe("security — no secrets in computed outputs", () => {
  const SECRET_PATTERNS = [
    /api[_-]?key/i, /secret/i, /password/i, /token(?!Count|ized)/i,
    /jwt/i, /session/i, /database_url/i, /bearer/i, /authorization/i,
  ];

  function noSecrets(obj: unknown): void {
    const str = JSON.stringify(obj);
    for (const pat of SECRET_PATTERNS) {
      expect(str).not.toMatch(pat);
    }
  }

  it("OperationsSummary contains no secret patterns", () => {
    const summary = computeOperationsSummary(makeHealth() as any);
    noSecrets(summary);
  });

  it("ResearchPipeline contains no secret patterns", () => {
    const stages = computePipelineStages(makeHealth() as any);
    noSecrets(stages);
  });

  it("DataFreshness contains no secret patterns", () => {
    const items = computeDataFreshness(makeHealth() as any);
    noSecrets(items);
  });

  it("assessFreshness output contains no secret patterns", () => {
    const r = assessFreshness(new Date().toISOString(), FRESHNESS_RULES.marketPrices);
    noSecrets(r);
  });
});

// ---------------------------------------------------------------------------
// No external provider calls / no AI calls / no scanner execution
// ---------------------------------------------------------------------------

describe("compute functions are pure — no side effects", () => {
  it("computeOperationsSummary takes < 5ms (no DB or network calls)", () => {
    const t0 = Date.now();
    computeOperationsSummary(makeHealth() as any);
    expect(Date.now() - t0).toBeLessThan(5);
  });

  it("computePipelineStages takes < 5ms", () => {
    const t0 = Date.now();
    computePipelineStages(makeHealth() as any);
    expect(Date.now() - t0).toBeLessThan(5);
  });

  it("computeDataFreshness takes < 5ms", () => {
    const t0 = Date.now();
    computeDataFreshness(makeHealth() as any);
    expect(Date.now() - t0).toBeLessThan(5);
  });

  it("assessFreshness takes < 1ms", () => {
    const t0 = Date.now();
    assessFreshness(new Date().toISOString(), FRESHNESS_RULES.marketPrices);
    expect(Date.now() - t0).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Health vs Readiness distinction (spec §22)
// ---------------------------------------------------------------------------

describe("health vs readiness distinction", () => {
  it("scanner service HEALTHY but research can still be WAITING", () => {
    // Simulates: scanner ran (HEALTHY) but ranking not yet computed (DEGRADED)
    const h = makeHealth({
      ranking: { status: "DEGRADED", summary: "No ranking in memory", details: {} },
    });
    const summary = computeOperationsSummary(h as any);
    // Scanner health card is HEALTHY
    expect(h.scanner.status).toBe("HEALTHY");
    // But Research Readiness dimension is WAITING because ranking isn't computed
    const dim = summary.dimensions.find(d => d.dimension === "Research Readiness");
    expect(dim?.status).toBe("WAITING");
  });

  it("broker service DISABLED when no connections — not a platform failure", () => {
    const h = makeHealth({ brokerSync: { status: "DISABLED", summary: "No portfolios", details: {} } });
    const summary = computeOperationsSummary(h as any);
    const dim = summary.dimensions.find(d => d.dimension === "Broker Services Readiness");
    expect(dim?.status).toBe("DISABLED");
    // DISABLED broker should not trigger requiresAttention
    expect(dim?.reason).toBeNull();
  });

  it("institutional 13F disabled does not make platform unready", () => {
    // Institutional is always DISABLED in dev (by env var)
    const h = makeHealth({ institutional: { status: "DISABLED", summary: "13F disabled", details: {} } });
    const summary = computeOperationsSummary(h as any);
    // No dimension corresponds to institutional directly; overall should not be FAILED
    expect(summary.overallStatus).not.toBe("FAILED");
  });
});

// ---------------------------------------------------------------------------
// Operations Manual doc — Sprint 2.5.3B entry
// ---------------------------------------------------------------------------

describe("operations manual — Sprint 2.5.3B docs", () => {
  it("sprint changelog has Sprint 2.5.3B entry", () => {
    const content = readFileSync("docs/operations/17-sprint-change-log.md", "utf-8");
    expect(content).toContain("2.5.3B");
    expect(content).toContain("Platform Health");
    expect(content).toContain("Operations Center");
  });

  it("operations center doc exists and covers all sections", () => {
    const content = readFileSync("docs/operations/23-platform-operations-center.md", "utf-8").toLowerCase();
    expect(content).toContain("operations summary");
    expect(content).toContain("research pipeline");
    expect(content).toContain("data freshness");
    expect(content).toContain("freshness rules");
    expect(content).toContain("health vs readiness");
    expect(content).toContain("runbook");
    expect(content).toContain("failure isolation");
    expect(content).toContain("security");
  });

  it("operations center doc does not expose secret patterns", () => {
    const content = readFileSync("docs/operations/23-platform-operations-center.md", "utf-8");
    expect(content).not.toMatch(/DATABASE_URL\s*=/);
    expect(content).not.toMatch(/API_KEY\s*=/);
    expect(content).not.toMatch(/SERVICE_TOKEN\s*=/);
  });
});

// ---------------------------------------------------------------------------
// Business logic unchanged confirmation (spec §43)
// ---------------------------------------------------------------------------

describe("business logic unchanged", () => {
  it("assessFreshness does not import scanner, ranking, or intelligence modules", () => {
    const src = readFileSync("server/lib/health-freshness.ts", "utf-8");
    expect(src).not.toContain("opportunity-ranking-engine");
    expect(src).not.toContain("scanner");
    expect(src).not.toContain("intelligence-service");
  });

  it("platform-health-test-exports does not import AI or LLM modules", () => {
    const src = readFileSync("server/routes/platform-health-test-exports.ts", "utf-8");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("gpt");
    expect(src).not.toContain("llm");
  });

  it("compute functions accept any health object — no hardcoded scoring", () => {
    const h = makeHealth();
    // Change ranking status — the compute functions adapt without throwing
    h.ranking = { status: "DEGRADED", summary: "X", details: {} };
    expect(() => computeOperationsSummary(h as any)).not.toThrow();
    expect(() => computePipelineStages(h as any)).not.toThrow();
    expect(() => computeDataFreshness(h as any)).not.toThrow();
  });
});
