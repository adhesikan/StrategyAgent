import { sql } from "drizzle-orm";
import {
  GLOBAL_COVERAGE_ADVISORY_LOCK,
  type CoverageApplyDatabase,
  type CoverageApplyTransaction,
  type CoveragePlan,
  type CoveragePlanOperation,
} from "./institutional-coverage-analyzer";
import { CANONICAL_EFFECTIVE_HOLDINGS_CTE } from "./institutional-effective-holdings";

type Executor = { execute(query: unknown): Promise<any> };
type Database = Executor & { transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> };
const rows = (value: any): any[] => value?.rows ?? (Array.isArray(value) ? value : []);

/**
 * Concrete PostgreSQL adapter. The supplied loader is the same loader used to
 * create the reviewed artifact, preventing drift between dry-run and APPLY.
 */
export function createCoveragePostgresAdapter(
  database: Database,
  loadPlan: (executor: Executor) => Promise<CoveragePlan>,
): CoverageApplyDatabase {
  let lockRequested = false;
  return {
    async identity() {
      const result = rows(await database.execute(sql`SELECT current_database() database,current_schema() schema`))[0] ?? {};
      return { database: String(result.database), schema: String(result.schema) };
    },
    async withAdvisoryLock<T>(key: number, fn: () => Promise<T>) {
      if (key !== GLOBAL_COVERAGE_ADVISORY_LOCK) throw new Error("INVALID_COVERAGE_LOCK_KEY");
      lockRequested = true;
      try { return await fn(); } finally { lockRequested = false; }
    },
    async transaction<T>(fn: (tx: CoverageApplyTransaction) => Promise<T>) {
      if (!lockRequested) throw new Error("COVERAGE_ADVISORY_LOCK_REQUIRED");
      return database.transaction(async executor => {
        await executor.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        await executor.execute(sql`SELECT pg_advisory_xact_lock(${GLOBAL_COVERAGE_ADVISORY_LOCK})`);
        const adapter: CoverageApplyTransaction = {
          loadPlan: () => loadPlan(executor),
          async validateHoldingCount(operation) {
            const result = await executor.execute(sql`
              ${sql.raw(CANONICAL_EFFECTIVE_HOLDINGS_CTE)}
              SELECT COUNT(*)::int AS holding_count
              FROM canonical_effective_holdings h
              WHERE h.cusip=${operation.cusip}
                AND (h.mapped_symbol IS NULL OR h.mapping_status NOT IN ('exact','reviewed'))
            `);
            const holdingCount = Number(rows(result)[0]?.holding_count ?? 0);
            if (holdingCount !== operation.holdingUpdateRows) {
              throw new Error(`HOLDING_ROW_COUNT_MISMATCH:${operation.cusip}`);
            }
          },
          async promoteMapping(operation) {
            const result = await executor.execute(sql`
              INSERT INTO institutional_security_mappings
                (cusip,mapped_symbol,mapping_status,mapping_method,last_verified_at)
              VALUES (${operation.cusip},${operation.symbol},${operation.mappingStatus},${operation.mappingMethod},NOW())
              ON CONFLICT (cusip) DO UPDATE SET
                mapped_symbol=EXCLUDED.mapped_symbol,mapping_status=EXCLUDED.mapping_status,
                mapping_method=EXCLUDED.mapping_method,last_verified_at=NOW()
              WHERE institutional_security_mappings.mapped_symbol IS NULL
                 OR institutional_security_mappings.mapped_symbol=EXCLUDED.mapped_symbol
              RETURNING cusip
            `);
            if (rows(result).length !== 1) throw new Error(`MAPPING_ROW_COUNT_MISMATCH:${operation.cusip}`);
          },
          async updateHoldings(operation) {
            const result = await executor.execute(sql`
              ${sql.raw(CANONICAL_EFFECTIVE_HOLDINGS_CTE)}
              UPDATE institutional_13f_holdings h SET
                mapped_symbol=${operation.symbol},mapping_status=${operation.mappingStatus}
              FROM canonical_effective_holdings effective
              WHERE effective.id=h.id
                AND effective.cusip=${operation.cusip}
                AND (effective.mapped_symbol IS NULL OR effective.mapping_status NOT IN ('exact','reviewed'))
              RETURNING h.id
            `);
            if (rows(result).length !== operation.holdingUpdateRows) {
              throw new Error(`HOLDING_ROW_COUNT_MISMATCH:${operation.cusip}`);
            }
          },
          // Derived rows are rebuilt through existing services after commit.
          async upsertAggregate(_target) {},
          async upsertSignal(_target) {},
        };
        return fn(adapter);
      });
    },
  };
}