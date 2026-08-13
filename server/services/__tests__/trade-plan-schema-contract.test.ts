/**
 * server/services/__tests__/trade-plan-schema-contract.test.ts
 *
 * §15 — DB Schema Contract Test (from Defect-10 bug report)
 * §16 — Migration upgrade test (old schema → new schema)
 * §17 — Idempotency test
 *
 * These tests assert that every column queried by trade-plan-service
 * exists in the ensureTradePlanTables() startup contract AND in the
 * Drizzle schema, preventing a repeat of the Railway schema-drift failure.
 *
 * Tests are DETERMINISTIC — they inspect source code only, never the live DB.
 * They will catch schema drift at test time (before Railway deployment).
 *
 * Columns that caused Defect-10:
 *   last_reviewed_at — added to Drizzle schema in Sprint 2.8.6A Defect-9
 *                      but NOT added to ensureTradePlanTables() ALTER block
 *                      → Railway production missing column → 500 on GET /api/trade-plans
 *
 * §SC1  ensureTradePlanTables() ALTER block includes all newer columns
 * §SC2  Drizzle schema includes all newer columns (source of truth)
 * §SC3  last_reviewed_at is correctly typed as TIMESTAMPTZ (nullable)
 * §SC4  All 4 newer columns are covered by the additive ALTER (not just CREATE)
 * §SC5  Standalone migration file is idempotent (ADD COLUMN IF NOT EXISTS)
 * §SC6  ensureTradePlanTables() comment documents column history
 * §SC7  Drizzle schema lastReviewedAt has no NOT NULL constraint (nullable)
 * §SC8  trade-plan-service does not hard-code a NOT NULL for last_reviewed_at
 * §SC9  ensureTradePlanTables exports successfully (importable)
 * §SC10 The ALTER block in ensureTradePlanTables is for trade_plans (not sessions)
 * §MIG1 Standalone migration file uses ADD COLUMN IF NOT EXISTS (idempotent)
 * §MIG2 Standalone migration file verifies column exists after ALTER
 * §MIG3 Standalone migration file does not DROP anything
 * §MIG4 Standalone migration file does not TRUNCATE or DELETE
 * §MIG5 Migration strategy comment in ensureTradePlanTables explains Railway contract
 * §MIG6 Running ALTER twice on same column is safe (IF NOT EXISTS guard)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Source files under inspection
// ─────────────────────────────────────────────────────────────────────────────

const SVC = path.resolve(__dirname, "../trade-plan-service.ts");
const SCHEMA = path.resolve(__dirname, "../../../shared/schema.ts");
const MIGRATION = path.resolve(
  __dirname,
  "../../migrations/add-trade-plan-last-reviewed-at.sql"
);

function read(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

const svcSrc = read(SVC);
const schemaSrc = read(SCHEMA);
const migrationSrc = read(MIGRATION);

// ─────────────────────────────────────────────────────────────────────────────
// §SC1  ensureTradePlanTables ALTER block covers all newer columns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical list of columns added after the original Sprint 2.7.5 CREATE TABLE.
 * Each entry must appear in the ALTER TABLE ... ADD COLUMN IF NOT EXISTS block
 * inside ensureTradePlanTables(). Update this list when new columns are added.
 */
const NEWER_COLUMNS = [
  "broad_expression_type",
  "expression_selected_by",
  "expression_selected_at",
  "last_reviewed_at",
] as const;

describe("§SC1  ensureTradePlanTables: ALTER block covers all newer columns", () => {
  for (const col of NEWER_COLUMNS) {
    it(`ADD COLUMN IF NOT EXISTS ${col} is in ensureTradePlanTables`, () => {
      // The alter must use IF NOT EXISTS — plain ADD COLUMN without IF NOT EXISTS
      // would crash on an existing column.
      expect(svcSrc).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC2  Drizzle schema includes all newer columns
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC2  Drizzle schema includes all newer columns", () => {
  it('Drizzle has broadExpressionType → text("broad_expression_type")', () => {
    expect(schemaSrc).toContain('"broad_expression_type"');
  });

  it('Drizzle has expressionSelectedBy → text("expression_selected_by")', () => {
    expect(schemaSrc).toContain('"expression_selected_by"');
  });

  it('Drizzle has expressionSelectedAt → timestamp("expression_selected_at")', () => {
    expect(schemaSrc).toContain('"expression_selected_at"');
  });

  it('Drizzle has lastReviewedAt → timestamp("last_reviewed_at")', () => {
    expect(schemaSrc).toContain('"last_reviewed_at"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC3  last_reviewed_at typed as TIMESTAMPTZ / nullable
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC3  last_reviewed_at is TIMESTAMPTZ and nullable in the ensure block", () => {
  it("ALTER block uses TIMESTAMPTZ (not TIMESTAMP WITHOUT TIME ZONE)", () => {
    // Grab the block after the Additive column migrations comment
    const alterBlock = svcSrc.slice(
      svcSrc.indexOf("Additive column migrations for trade_plans"),
      svcSrc.indexOf("CREATE TABLE IF NOT EXISTS trade_plan_versions")
    );
    expect(alterBlock).toContain("last_reviewed_at        TIMESTAMPTZ");
  });

  it("ALTER block does NOT add NOT NULL constraint on last_reviewed_at", () => {
    const alterBlock = svcSrc.slice(
      svcSrc.indexOf("Additive column migrations for trade_plans"),
      svcSrc.indexOf("CREATE TABLE IF NOT EXISTS trade_plan_versions")
    );
    // Extract just the last_reviewed_at line
    const lines = alterBlock.split("\n");
    const line = lines.find((l) => l.includes("last_reviewed_at"));
    expect(line).toBeDefined();
    expect(line!.toUpperCase()).not.toContain("NOT NULL");
  });

  it("Drizzle schema does not add .notNull() to lastReviewedAt", () => {
    // Find the lastReviewedAt declaration in Drizzle schema
    const idx = schemaSrc.indexOf('"last_reviewed_at"');
    const excerpt = schemaSrc.slice(idx, idx + 120);
    expect(excerpt).not.toContain(".notNull()");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC4  ALTER block is additive — all 4 newer columns in a single ALTER
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC4  Single ALTER block covers all 4 newer trade_plans columns", () => {
  it("ALTER block mentions trade_plans (not trade_planning_sessions)", () => {
    const alterBlock = svcSrc.slice(
      svcSrc.indexOf("Additive column migrations for trade_plans"),
      svcSrc.indexOf("CREATE TABLE IF NOT EXISTS trade_plan_versions")
    );
    expect(alterBlock).toContain("ALTER TABLE trade_plans");
    expect(alterBlock).not.toContain("ALTER TABLE trade_planning_sessions");
  });

  it("all 4 newer columns appear in the same ALTER block", () => {
    const alterBlock = svcSrc.slice(
      svcSrc.indexOf("Additive column migrations for trade_plans"),
      svcSrc.indexOf("CREATE TABLE IF NOT EXISTS trade_plan_versions")
    );
    for (const col of NEWER_COLUMNS) {
      expect(alterBlock).toContain(col);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC5  Standalone migration file is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC5  Standalone migration file is idempotent (ADD COLUMN IF NOT EXISTS)", () => {
  it("migration file exists", () => {
    expect(migrationSrc.length).toBeGreaterThan(50);
  });

  it("uses ADD COLUMN IF NOT EXISTS (not plain ADD COLUMN)", () => {
    expect(migrationSrc).toContain("ADD COLUMN IF NOT EXISTS last_reviewed_at");
  });

  it("uses TIMESTAMPTZ as the column type", () => {
    expect(migrationSrc).toContain("TIMESTAMPTZ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC6  ensureTradePlanTables documents column history in comment
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC6  ensureTradePlanTables documents column history", () => {
  it("comment mentions last_reviewed_at and its sprint", () => {
    expect(svcSrc).toContain("last_reviewed_at");
    // Sprint attribution
    expect(svcSrc).toContain("2.8.6A");
  });

  it("comment explains Railway deployment contract", () => {
    expect(svcSrc).toContain("canonical deployment path");
  });

  it("comment explains standalone .sql files are NOT auto-executed on Railway", () => {
    expect(svcSrc).toContain("NOT auto-executed on Railway");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC7  Drizzle schema lastReviewedAt is optional (no .notNull())
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC7  Drizzle schema lastReviewedAt is nullable (no .notNull())", () => {
  it("lastReviewedAt declaration does not end with .notNull()", () => {
    const idx = schemaSrc.indexOf("lastReviewedAt");
    const excerpt = schemaSrc.slice(idx, idx + 120);
    expect(excerpt).not.toContain(".notNull()");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC8  trade-plan-service handles null lastReviewedAt gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC8  Service handles null lastReviewedAt gracefully", () => {
  it("lifecycle evaluate passes lastReviewedAt with nullish coalesce", () => {
    // The lifecycle service call must use ?? null (not just read the field directly)
    const lifecycleSvc = read(
      path.resolve(__dirname, "../trade-plan-lifecycle-service.ts")
    );
    expect(lifecycleSvc).toContain("lastReviewedAt");
    // Either nullish coalesce or optional chaining
    const hasNullGuard =
      lifecycleSvc.includes("lastReviewedAt ?? null") ||
      lifecycleSvc.includes("?.lastReviewedAt");
    expect(hasNullGuard).toBe(true);
  });

  it("computeLifecycleState accepts lastReviewedAt as optional (? in signature)", () => {
    const lifecycleSvc = read(
      path.resolve(__dirname, "../trade-plan-lifecycle-service.ts")
    );
    // Parameter is optional
    expect(lifecycleSvc).toContain("lastReviewedAt?:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC9  ensureTradePlanTables is exported (importable)
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC9  ensureTradePlanTables is exported", () => {
  it("service exports ensureTradePlanTables", () => {
    expect(svcSrc).toContain("export async function ensureTradePlanTables");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §SC10  The trade_plans ALTER is separate from the trade_planning_sessions ALTER
// ─────────────────────────────────────────────────────────────────────────────

describe("§SC10  Trade plans ALTER and sessions ALTER are distinct blocks", () => {
  it("sessions ALTER block adds broad_expression_type and expression_selected_by for sessions", () => {
    const sessionsAlterBlock = svcSrc.slice(
      svcSrc.indexOf("Additive column migration for existing Railway tables"),
      svcSrc.indexOf("trade_plans ──")
    );
    expect(sessionsAlterBlock).toContain("ALTER TABLE trade_planning_sessions");
    expect(sessionsAlterBlock).toContain("broad_expression_type");
  });

  it("trade_plans ALTER block is separate (comes after the trade_plans CREATE TABLE)", () => {
    const tradePlansSection = svcSrc.slice(
      svcSrc.indexOf("── trade_plans ──"),
      svcSrc.indexOf("── trade_plan_versions ──")
    );
    expect(tradePlansSection).toContain("ALTER TABLE trade_plans");
    expect(tradePlansSection).toContain("last_reviewed_at");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §MIG1-4  Standalone migration safety
// ─────────────────────────────────────────────────────────────────────────────

describe("§MIG1-4  Standalone migration file safety guarantees", () => {
  it("§MIG1  uses IF NOT EXISTS (idempotent)", () => {
    expect(migrationSrc).toContain("IF NOT EXISTS");
  });

  it("§MIG2  verifies column exists after ALTER (DO $$ block)", () => {
    expect(migrationSrc).toContain("information_schema.columns");
    expect(migrationSrc).toContain("last_reviewed_at");
  });

  it("§MIG3  does NOT DROP any column or table", () => {
    expect(migrationSrc.toUpperCase()).not.toContain("DROP COLUMN");
    expect(migrationSrc.toUpperCase()).not.toContain("DROP TABLE");
  });

  it("§MIG4  does NOT TRUNCATE or DELETE data", () => {
    expect(migrationSrc.toUpperCase()).not.toContain("TRUNCATE");
    expect(migrationSrc.toUpperCase()).not.toContain("DELETE FROM");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §MIG5  Migration strategy comment in ensureTradePlanTables
// ─────────────────────────────────────────────────────────────────────────────

describe("§MIG5  ensureTradePlanTables migration strategy is documented", () => {
  it("comment says standalone .sql files are supplemental", () => {
    expect(svcSrc).toContain("supplemental");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §MIG6  Idempotency — running ALTER twice is safe (IF NOT EXISTS)
// ─────────────────────────────────────────────────────────────────────────────

describe("§MIG6  Idempotency: ADD COLUMN IF NOT EXISTS used in all positions", () => {
  it("every ADD COLUMN in the trade_plans alter block uses IF NOT EXISTS", () => {
    const tradePlansSection = svcSrc.slice(
      svcSrc.indexOf("Additive column migrations for trade_plans"),
      svcSrc.indexOf("CREATE TABLE IF NOT EXISTS trade_plan_versions")
    );
    // Find all ADD COLUMN occurrences in this section
    const addColumnMatches = tradePlansSection.match(/ADD COLUMN/g) ?? [];
    const addColumnIfNotExistsMatches =
      tradePlansSection.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
    // Every ADD COLUMN must be ADD COLUMN IF NOT EXISTS
    expect(addColumnMatches.length).toBeGreaterThan(0);
    expect(addColumnMatches.length).toBe(addColumnIfNotExistsMatches.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: client handles null lastReviewedAt (no crash on undefined)
// ─────────────────────────────────────────────────────────────────────────────

describe("Client handles null lastReviewedAt (no serialization crash)", () => {
  it("client trade-plan-detail uses optional chaining on symbolQualificationStatus", () => {
    const clientSrc = read(
      path.resolve(
        __dirname,
        "../../../client/src/pages/trade-plan-detail.tsx"
      )
    );
    // The isNotQualified derivation must not crash when lifecycle is null
    expect(clientSrc).toContain('lifecycle?.symbolQualificationStatus === "NOT_QUALIFIED"');
  });

  it("lifecycle query result is used with ?? null guard", () => {
    const clientSrc = read(
      path.resolve(
        __dirname,
        "../../../client/src/pages/trade-plan-detail.tsx"
      )
    );
    // lifecycle is derived as: lifecycleData?.lifecycleResult ?? null
    expect(clientSrc).toContain("lifecycleData?.lifecycleResult ?? null");
  });
});
