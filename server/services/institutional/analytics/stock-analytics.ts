/**
 * Stock-level institutional analytics domain contract.
 *
 * StockMetrics and future API routes should depend on this boundary rather
 * than reaching into Fund Explorer SQL or calculating holder metrics in UI.
 */

import type {
  ModelVersion,
  StockAnalyticsQuery,
  StockInstitutionalAnalytics,
} from "./types";
import type { StockInstitutionalSourceSnapshot } from "./repository";

export interface StockAnalyticsService {
  getStockAnalytics(
    query: StockAnalyticsQuery,
  ): Promise<StockInstitutionalAnalytics | null>;
}

/** Attach the calculation version without inventing unavailable source data. */
export function createStockInstitutionalAnalytics(
  snapshot: StockInstitutionalSourceSnapshot,
  modelVersion: ModelVersion,
): StockInstitutionalAnalytics {
  return { ...snapshot, modelVersion };
}