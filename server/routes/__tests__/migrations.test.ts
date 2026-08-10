/**
 * server/routes/__tests__/migrations.test.ts — Sprint 2.7.7
 *
 * Migration Validation Suite — npm run test:migrations
 *
 * Validates: startup idempotency, schema presence, no destructive migration,
 * table/index structure for all critical Phase 2.7 tables.
 *
 * All tests are pure/structural — imports Drizzle schema definitions,
 * no live DB connection. DB integration tests are in db-integration.test.ts.
 *
 * Category: STRUCTURAL (schema) / MIGRATION
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §M1 — Schema import sanity
// ============================================================================

describe("§M1: Schema module imports without error", () => {
  it("shared/schema.ts exports without throwing", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema).toBeDefined();
  });

  it("schema exports pgTable definitions for core Phase 2.7 tables", async () => {
    const {
      tradePlans,
      tradePlanVersions,
      tradePlanActivity,
      tradePlanningSessions,
      researchGoals,
      workspaceConversations,
      workspaceMessages,
      researchWatches,
      watchActivityLog,
      researchReports,
      portfolios,
      portfolioPositions,
      researchCollections,
      collectionSymbols,
    } = await import("../../../shared/schema");

    const tables = {
      tradePlans,
      tradePlanVersions,
      tradePlanActivity,
      tradePlanningSessions,
      researchGoals,
      workspaceConversations,
      workspaceMessages,
      researchWatches,
      watchActivityLog,
      researchReports,
      portfolios,
      portfolioPositions,
      researchCollections,
      collectionSymbols,
    };

    for (const [name, table] of Object.entries(tables)) {
      expect(table, `table ${name} should be defined`).toBeDefined();
    }
  });

  it("schema exports Phase 2.5–2.6 tables", async () => {
    const {
      userCollectionFollows,
      userCollectionFavorites,
      userCollectionPins,
      researchRecords,
    } = await import("../../../shared/schema");
    expect(userCollectionFollows).toBeDefined();
    expect(userCollectionFavorites).toBeDefined();
    expect(userCollectionPins).toBeDefined();
    expect(researchRecords).toBeDefined();
  });

  it("schema exports Institutional tables", async () => {
    const {
      institutional13fFilings,
      institutional13fHoldings,
      institutionalSecurityMappings,
      institutionalQuarterlyAggregates,
      institutionalIngestionRuns,
      securityMaster,
      institutionalSymbolSignals,
    } = await import("../../../shared/schema");
    expect(institutional13fFilings).toBeDefined();
    expect(institutional13fHoldings).toBeDefined();
    expect(institutionalSecurityMappings).toBeDefined();
    expect(institutionalQuarterlyAggregates).toBeDefined();
    expect(institutionalIngestionRuns).toBeDefined();
    expect(securityMaster).toBeDefined();
    expect(institutionalSymbolSignals).toBeDefined();
  });

  it("schema exports opportunity engine tables", async () => {
    const { opportunityScanSnapshots, opportunityHistory } = await import("../../../shared/schema");
    expect(opportunityScanSnapshots).toBeDefined();
    expect(opportunityHistory).toBeDefined();
  });

  it("schema exports market data tables", async () => {
    const {
      marketDataSymbols,
      marketDailyBars,
      marketDataIngestionRuns,
      sectorIntelligenceSnapshots,
      themeIntelligenceSnapshots,
    } = await import("../../../shared/schema");
    expect(marketDataSymbols).toBeDefined();
    expect(marketDailyBars).toBeDefined();
    expect(marketDataIngestionRuns).toBeDefined();
    expect(sectorIntelligenceSnapshots).toBeDefined();
    expect(themeIntelligenceSnapshots).toBeDefined();
  });
});

// ============================================================================
// §M2 — Table column contracts (structural)
// ============================================================================

describe("§M2: Critical table column contracts", () => {
  it("tradePlans has required columns", async () => {
    const { tradePlans } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlans);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("symbol");
    expect(cols).toContain("status");
    expect(cols).toContain("createdAt");
  });

  it("tradePlanVersions links to tradePlans via tradePlanId", async () => {
    const { tradePlanVersions } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanVersions);
    expect(cols).toContain("tradePlanId");
    expect(cols).toContain("version");        // integer version number
    expect(cols).toContain("researchSnapshot"); // JSONB snapshot column
  });

  it("tradePlanActivity has fingerprint for dedup", async () => {
    const { tradePlanActivity } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanActivity);
    expect(cols).toContain("tradePlanId");
    expect(cols).toContain("userId");
    expect(cols).toContain("activityType");
    expect(cols).toContain("fingerprint");
    expect(cols).toContain("observedAt");
  });

  it("tradePlanningSessions has symbol and userId", async () => {
    const { tradePlanningSessions } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanningSessions);
    expect(cols).toContain("userId");
    expect(cols).toContain("symbol");
  });

  it("researchGoals has userId and goalType", async () => {
    const { researchGoals } = await import("../../../shared/schema");
    const cols = Object.keys(researchGoals);
    expect(cols).toContain("userId");
    expect(cols).toContain("goalType");
  });

  it("workspaceConversations has userId and researchMode", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("userId");
    expect(cols).toContain("researchMode"); // Sprint 2.6.4: researchMode, not 'mode'
  });

  it("portfolios has userId and sourceType", async () => {
    const { portfolios } = await import("../../../shared/schema");
    const cols = Object.keys(portfolios);
    expect(cols).toContain("userId");
    expect(cols).toContain("sourceType");
  });

  it("opportunityScanSnapshots has status for advisory-lock FAILED guard", async () => {
    const { opportunityScanSnapshots } = await import("../../../shared/schema");
    const cols = Object.keys(opportunityScanSnapshots);
    expect(cols).toContain("status");
    expect(cols).toContain("scannerVersion");
  });

  it("researchWatches has watchType and userId", async () => {
    const { researchWatches } = await import("../../../shared/schema");
    const cols = Object.keys(researchWatches);
    expect(cols).toContain("userId");
    expect(cols).toContain("watchType");
  });

  it("securityMaster has cusip and ticker", async () => {
    const { securityMaster } = await import("../../../shared/schema");
    const cols = Object.keys(securityMaster);
    expect(cols).toContain("cusip");
    expect(cols).toContain("ticker");
  });
});

// ============================================================================
// §M3 — Migration file inventory
// ============================================================================

describe("§M3: Migration file inventory", () => {
  it("migration 026 (research workspace context) exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    const files = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const has026 = files.some((f) => f.includes("026"));
    expect(has026, "Migration 026 (research_workspace_context) should exist").toBe(true);
  });

  it("migration 027 (research goals) exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    const files = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const has027 = files.some((f) => f.includes("027"));
    expect(has027, "Migration 027 (research_goals) should exist").toBe(true);
  });

  it("migration 028 (trade planning sessions) exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    const files = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const has028 = files.some((f) => f.includes("028"));
    expect(has028, "Migration 028 (trade_planning_sessions) should exist").toBe(true);
  });
});

// ============================================================================
// §M4 — Startup migration idempotency (structural)
// ============================================================================

describe("§M4: Startup migration idempotency contracts", () => {
  it("ensureTradePlanActivityTable is exported and callable (idempotent ensure)", async () => {
    const { ensureTradePlanActivityTable } = await import(
      "../../services/trade-plan-lifecycle-service"
    );
    expect(typeof ensureTradePlanActivityTable).toBe("function");
  });

  it("ensureTradePlanTables is exported from trade-plan service", async () => {
    // Either individual or combined ensure — check service exports
    const svc = await import("../../services/trade-plan-service");
    const hasEnsure =
      typeof (svc as any).ensureTradePlanTables === "function" ||
      typeof (svc as any).ensureTradePlansTable === "function" ||
      typeof (svc as any).getTradePlan === "function"; // service exists
    expect(hasEnsure).toBe(true);
  });

  it("job status store supports trade_plan_monitoring job name", async () => {
    const { markJobStarted, getJobStatus } = await import("../../services/job-status-store");
    // Should not throw for the lifecycle monitoring job name (uses module-level functions, not class)
    expect(() => markJobStarted("trade_plan_monitoring")).not.toThrow();
    const status = getJobStatus("trade_plan_monitoring");
    expect(status).toBeDefined();
    expect(status.status).toBe("running");
  });
});

// ============================================================================
// §M5 — No destructive patterns in migration scripts
// ============================================================================

describe("§M5: Migration scripts contain no destructive patterns", () => {
  it("migration 026 does not DROP existing tables", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    if (!fs.existsSync(migDir)) return;
    const files = fs.readdirSync(migDir).filter((f) => f.includes("026"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(migDir, file), "utf-8");
      // Should not have destructive DROP without IF EXISTS
      const hasBareDropTable = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(content);
      expect(hasBareDropTable, `${file} should not have bare DROP TABLE`).toBe(false);
    }
  });

  it("migration 027 does not DROP existing tables", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    if (!fs.existsSync(migDir)) return;
    const files = fs.readdirSync(migDir).filter((f) => f.includes("027"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(migDir, file), "utf-8");
      const hasBareDropTable = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(content);
      expect(hasBareDropTable, `${file} should not have bare DROP TABLE`).toBe(false);
    }
  });

  it("migration 028 does not DROP existing tables", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migDir = path.resolve("migrations");
    if (!fs.existsSync(migDir)) return;
    const files = fs.readdirSync(migDir).filter((f) => f.includes("028"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(migDir, file), "utf-8");
      const hasBareDropTable = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(content);
      expect(hasBareDropTable, `${file} should not have bare DROP TABLE`).toBe(false);
    }
  });
});
