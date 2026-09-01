/**
 * Batched downstream reads bound to canonical runtime contexts.  Symbol is
 * used only as the final symbol already selected by the canonical context;
 * these loaders never resolve identity.
 */
import { desc, inArray } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  institutionalQuarterlyAggregates,
  institutionalSymbolSignals,
} from "@shared/schema";
import type { CanonicalInstitutionalSecurityContext } from "./canonical-institutional-security-context";
import { canonicalStockIdentityCte } from "./canonical-security-state";

export interface CanonicalHoldingSupport {
  eligibleHoldingCount: number;
  latestPeriod: string | null;
}

export interface CanonicalRuntimeSupport {
  holdingsBySymbol: Map<string, CanonicalHoldingSupport>;
  aggregatesBySymbol: Map<string, typeof institutionalQuarterlyAggregates.$inferSelect[]>;
  signalsBySymbol: Map<string, typeof institutionalSymbolSignals.$inferSelect>;
}

export async function loadCanonicalRuntimeSupport(
  contexts: readonly CanonicalInstitutionalSecurityContext[],
): Promise<CanonicalRuntimeSupport> {
  const symbols = Array.from(new Set(contexts.map((context) => context.normalizedSymbol)));
  const holdingsBySymbol = new Map<string, CanonicalHoldingSupport>();
  const aggregatesBySymbol = new Map<string, typeof institutionalQuarterlyAggregates.$inferSelect[]>();
  const signalsBySymbol = new Map<string, typeof institutionalSymbolSignals.$inferSelect>();
  if (symbols.length === 0) {
    return { holdingsBySymbol, aggregatesBySymbol, signalsBySymbol };
  }
  const [holdingResult, aggregates, signals] = await Promise.all([
    pool.query<{
      symbol: string;
      eligibleHoldingCount: number | string;
      latestPeriod: string | Date | null;
    }>(`
      ${canonicalStockIdentityCte}
      SELECT
        canonical.symbol,
        COUNT(*)::int AS "eligibleHoldingCount",
        MAX(holdings.canonical_period_of_report) AS "latestPeriod"
      FROM canonical
      JOIN canonical_effective_holdings holdings
        ON holdings.cusip = canonical.cusip
      WHERE canonical.symbol = ANY($1::text[])
        AND canonical.asset_type IN ('common_stock', 'reit')
      GROUP BY canonical.symbol
    `, [symbols]),
    db.select().from(institutionalQuarterlyAggregates)
      .where(inArray(institutionalQuarterlyAggregates.symbol, symbols))
      .orderBy(desc(institutionalQuarterlyAggregates.periodOfReport)),
    db.select().from(institutionalSymbolSignals)
      .where(inArray(institutionalSymbolSignals.symbol, symbols)),
  ]);
  for (const row of holdingResult.rows) {
    holdingsBySymbol.set(row.symbol.trim().toUpperCase(), {
      eligibleHoldingCount: Number(row.eligibleHoldingCount) || 0,
      latestPeriod:
        row.latestPeriod instanceof Date
          ? row.latestPeriod.toISOString().slice(0, 10)
          : row.latestPeriod
            ? String(row.latestPeriod).slice(0, 10)
            : null,
    });
  }
  for (const aggregate of aggregates) {
    const symbol = aggregate.symbol.trim().toUpperCase();
    const rows = aggregatesBySymbol.get(symbol) ?? [];
    rows.push(aggregate);
    aggregatesBySymbol.set(symbol, rows);
  }
  for (const signal of signals) signalsBySymbol.set(signal.symbol.trim().toUpperCase(), signal);
  return { holdingsBySymbol, aggregatesBySymbol, signalsBySymbol };
}