import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createCoveragePostgresAdapter } from "../institutional-coverage-postgres-adapter";
import { GLOBAL_COVERAGE_ADVISORY_LOCK, type CoveragePlanOperation } from "../institutional-coverage-analyzer";

describe("coverage PostgreSQL adapter", () => {
  it("uses repeatable-read, xact lock, bounded upsert/update, and row assertions", async () => {
    const statements: string[] = [];
    const executor = {
      async execute(query: any) {
        const text = new PgDialect().sqlToQuery(query).sql.toLowerCase();
        statements.push(text);
        if (text.includes("current_database")) return [{ database: "prod", schema: "public" }];
        if (text.includes("returning cusip")) return [{ cusip: "123456789" }];
        if (text.includes("holding_count")) return [{ holding_count: 2 }];
        if (text.includes("returning h.id")) return [{ id: "1" }, { id: "2" }];
        return [];
      },
    };
    const database = { ...executor, async transaction<T>(fn: (tx: typeof executor) => Promise<T>) { return fn(executor); } };
    const adapter = createCoveragePostgresAdapter(database, async () => { throw new Error("unused"); });
    const operation: CoveragePlanOperation = {
      cusip: "123456789", symbol: "ABC", mappingAction: "PROMOTE_TRUSTED_REFERENCE",
      mappingStatus: "reviewed", mappingMethod: "coverage_resolver:security_master",
      holdingUpdateRows: 2, periods: ["2025-09-30"], aggregateTargets: [], signalTarget: null,
    };
    await adapter.withAdvisoryLock(GLOBAL_COVERAGE_ADVISORY_LOCK, () => adapter.transaction(async tx => {
      await tx.validateHoldingCount?.(operation);
      await tx.promoteMapping(operation);
      await tx.updateHoldings(operation);
    }));
    expect(statements.join("\n")).toContain("set transaction isolation level repeatable read");
    expect(statements.join("\n")).toContain("pg_advisory_xact_lock");
    expect(statements.join("\n")).toContain("on conflict (cusip) do update");
    expect(statements.join("\n")).toContain("f.is_effective = true");
    expect(statements.join("\n")).toContain("f.period_of_report as canonical_period_of_report");
    expect(statements.join("\n")).toContain("holding_count");
    expect(statements.join("\n")).toContain("coalesce(upper(h.shares_prn_type), 'sh') <> 'prn'");
  });

  it("rejects a live count mismatch before the mapping upsert", async () => {
    const statements: string[] = [];
    const executor = {
      async execute(query: any) {
        const text = new PgDialect().sqlToQuery(query).sql.toLowerCase();
        statements.push(text);
        if (text.includes("holding_count")) return [{ holding_count: 1 }];
        return [];
      },
    };
    const database = {
      ...executor,
      async transaction<T>(fn: (tx: typeof executor) => Promise<T>) { return fn(executor); },
    };
    const adapter = createCoveragePostgresAdapter(database, async () => { throw new Error("unused"); });
    const operation: CoveragePlanOperation = {
      cusip: "111111111", symbol: "ABC", mappingAction: "PROMOTE_TRUSTED_REFERENCE",
      mappingStatus: "reviewed", mappingMethod: "coverage_resolver:test",
      holdingUpdateRows: 2, periods: [], aggregateTargets: [], signalTarget: null,
    };
    await expect(adapter.withAdvisoryLock(
      GLOBAL_COVERAGE_ADVISORY_LOCK,
      () => adapter.transaction(async tx => {
        await tx.validateHoldingCount?.(operation);
        await tx.promoteMapping(operation);
      }),
    )).rejects.toThrow("HOLDING_ROW_COUNT_MISMATCH:111111111");
    expect(statements.some(statement => statement.includes("insert into institutional_security_mappings"))).toBe(false);
    expect(statements.some(statement => statement.includes("update institutional_13f_holdings"))).toBe(false);
  });
});