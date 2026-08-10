/**
 * server/routes/__tests__/db-schema.test.ts — Sprint 2.7.7
 *
 * Database Schema Integration Tests
 *
 * Validates all critical table definitions, column presence, and structural
 * invariants. Pure structural tests — no live DB connection.
 *
 * For live DB integration (table exists, index exists, basic CRUD), see
 * the DATABASE INTEGRATION section in the release certification doc.
 * Those require a live DATABASE_URL and are NOT run in CI by default.
 *
 * Category: STRUCTURAL (DB schema)
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// §DB1 — All Phase 2 tables are exported from schema
// ============================================================================

describe("§DB1: All Phase 2 critical tables exist in schema", () => {
  const CRITICAL_TABLES = [
    // Core
    "users",
    "userSettings",
    // Market data
    "marketDataSymbols",
    "marketDailyBars",
    "marketDataIngestionRuns",
    // Opportunity pipeline
    "opportunityScanSnapshots",
    "opportunityHistory",
    // Intelligence
    "sectorIntelligenceSnapshots",
    "themeIntelligenceSnapshots",
    // Institutional
    "institutional13fFilings",
    "institutional13fHoldings",
    "institutionalSecurityMappings",
    "institutionalQuarterlyAggregates",
    "institutionalIngestionRuns",
    "securityMaster",
    "institutionalSymbolSignals",
    // Portfolio
    "portfolios",
    "portfolioPositions",
    // Research
    "researchCollections",
    "collectionSymbols",
    "userCollectionFollows",
    "userCollectionFavorites",
    "userCollectionPins",
    "workspaceConversations",
    "workspaceMessages",
    "researchWatches",
    "watchActivityLog",
    "researchReports",
    "researchGoals",
    // Trade planning
    "tradePlanningSessions",
    "tradePlans",
    "tradePlanVersions",
    "tradePlanActivity",
  ] as const;

  it("all critical tables are exported from shared/schema", async () => {
    const schema = await import("../../../shared/schema") as Record<string, unknown>;
    for (const tableName of CRITICAL_TABLES) {
      expect(schema[tableName], `Table "${tableName}" should be exported`).toBeDefined();
    }
  });
});

// ============================================================================
// §DB2 — Ownership column presence (user data isolation)
// ============================================================================

describe("§DB2: User-owned tables have userId column", () => {
  const USER_OWNED_TABLES = [
    "portfolios",
    // portfolioPositions links via portfolioId (no direct userId — ownership via portfolios table)
    "researchCollections",
    "researchGoals",
    "workspaceConversations",
    "researchWatches",
    "researchReports",
    "tradePlans",
    "tradePlanVersions",
    "tradePlanActivity",
    "tradePlanningSessions",
  ] as const;

  it("all user-owned tables have userId column", async () => {
    const schema = await import("../../../shared/schema") as Record<string, any>;
    for (const tableName of USER_OWNED_TABLES) {
      const table = schema[tableName];
      expect(table, `Table "${tableName}" should be defined`).toBeDefined();
      const cols = Object.keys(table);
      // Some tables use 'userId', some use 'user_id' as the JS key — check both
      const hasUserId = cols.includes("userId") || cols.includes("user_id");
      expect(hasUserId, `Table "${tableName}" should have userId (or user_id)`).toBe(true);
    }
  });
});

// ============================================================================
// §DB3 — Timestamp columns (audit trail)
// ============================================================================

describe("§DB3: Critical tables have createdAt timestamps", () => {
  const TIMESTAMPED_TABLES = [
    "tradePlans",
    "tradePlanVersions",
    "tradePlanActivity",
    "researchGoals",
    "workspaceConversations",
    "portfolios",
    "researchReports",
    "researchWatches",
  ] as const;

  it("all timestamped tables have createdAt or equivalent", async () => {
    const schema = await import("../../../shared/schema") as Record<string, any>;
    for (const tableName of TIMESTAMPED_TABLES) {
      const table = schema[tableName];
      if (!table) continue;
      const cols = Object.keys(table);
      const hasTimestamp = cols.includes("createdAt") || cols.includes("created_at") || cols.includes("observedAt");
      expect(hasTimestamp, `Table "${tableName}" should have a created timestamp`).toBe(true);
    }
  });
});

// ============================================================================
// §DB4 — Snapshot/versioning columns (immutability)
// ============================================================================

describe("§DB4: Trade plan snapshot and versioning columns", () => {
  it("tradePlanVersions has researchSnapshot JSONB column", async () => {
    const { tradePlanVersions } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanVersions);
    expect(cols).toContain("researchSnapshot");
  });

  it("tradePlanVersions has version for ordering", async () => {
    const { tradePlanVersions } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanVersions);
    expect(cols).toContain("version");
  });

  it("opportunityScanSnapshots has status field (VALID/FAILED guard)", async () => {
    const { opportunityScanSnapshots } = await import("../../../shared/schema");
    const cols = Object.keys(opportunityScanSnapshots);
    expect(cols).toContain("status");
  });
});

// ============================================================================
// §DB5 — Deduplication columns
// ============================================================================

describe("§DB5: Deduplication and idempotency columns", () => {
  it("tradePlanActivity has fingerprint column (24h dedup)", async () => {
    const { tradePlanActivity } = await import("../../../shared/schema");
    const cols = Object.keys(tradePlanActivity);
    expect(cols).toContain("fingerprint");
  });

  it("opportunityScanSnapshots has requestFingerprint column (run dedup)", async () => {
    const { opportunityScanSnapshots } = await import("../../../shared/schema");
    const cols = Object.keys(opportunityScanSnapshots);
    expect(cols).toContain("requestFingerprint");
  });
});

// ============================================================================
// §DB6 — Research collections multi-table structure
// ============================================================================

describe("§DB6: Research collections have complete multi-table structure", () => {
  it("researchCollections has collectionType (system vs user)", async () => {
    const { researchCollections } = await import("../../../shared/schema");
    const cols = Object.keys(researchCollections);
    expect(cols).toContain("collectionType");
  });

  it("collectionSymbols links collections to symbols", async () => {
    const { collectionSymbols } = await import("../../../shared/schema");
    const cols = Object.keys(collectionSymbols);
    expect(cols).toContain("collectionId");
    expect(cols).toContain("symbol");
  });

  it("userCollectionFollows links users to collections", async () => {
    const { userCollectionFollows } = await import("../../../shared/schema");
    const cols = Object.keys(userCollectionFollows);
    expect(cols).toContain("userId");
    expect(cols).toContain("collectionId");
  });
});

// ============================================================================
// §DB7 — Broker connection tables
// ============================================================================

describe("§DB7: Broker connection tables", () => {
  it("brokerConnections table is exported", async () => {
    const { brokerConnections } = await import("../../../shared/schema");
    expect(brokerConnections).toBeDefined();
    const cols = Object.keys(brokerConnections);
    expect(cols).toContain("userId");
    expect(cols).toContain("provider");
  });

  it("brokerConnections does not store raw secrets in visible column names", async () => {
    const { brokerConnections } = await import("../../../shared/schema");
    const cols = Object.keys(brokerConnections).map((c) => c.toLowerCase());
    // Verify that raw token storage follows expected encrypted pattern
    // Column names like 'encryptedToken' or 'tokenKey' are ok; bare 'apiKey' is suspicious
    const dangerousCols = cols.filter((c) =>
      c === "apikey" || c === "secretkey" || c === "privatekey" || c === "password"
    );
    expect(dangerousCols.length).toBe(0);
  });
});

// ============================================================================
// §DB8 — Institutional 3-table join structure (COVERPAGE join fix)
// ============================================================================

describe("§DB8: Institutional 13F schema post-COVERPAGE fix", () => {
  it("institutional13fFilings has filerName and filerCik (COVERPAGE data joined at parse time)", async () => {
    const { institutional13fFilings } = await import("../../../shared/schema");
    const cols = Object.keys(institutional13fFilings);
    // After COVERPAGE join fix, manager name (filerName) is on the filing row
    expect(cols).toContain("filerName");
    expect(cols).toContain("filerCik");
  });

  it("institutionalQuarterlyAggregates links to security via cusip or ticker", async () => {
    const { institutionalQuarterlyAggregates } = await import("../../../shared/schema");
    const cols = Object.keys(institutionalQuarterlyAggregates);
    const hasSecurityLink = cols.includes("cusip") || cols.includes("ticker") || cols.includes("symbol");
    expect(hasSecurityLink).toBe(true);
  });
});
