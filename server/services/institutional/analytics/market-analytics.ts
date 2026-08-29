/**
 * Market-level institutional analytics domain contract.
 *
 * This layer will own cross-symbol breadth and market aggregation once those
 * calculations are implemented. It currently defines only the service port.
 */

import type {
  MarketAnalyticsQuery,
  MarketInstitutionalAnalytics,
  ModelVersion,
} from "./types";
import type { MarketInstitutionalSourceSnapshot } from "./repository";

export interface MarketAnalyticsService {
  getMarketAnalytics(
    query: MarketAnalyticsQuery,
  ): Promise<MarketInstitutionalAnalytics | null>;
}

/** Attach the calculation version without changing symbol-scoped breadth. */
export function createMarketInstitutionalAnalytics(
  snapshot: MarketInstitutionalSourceSnapshot,
  modelVersion: ModelVersion,
): MarketInstitutionalAnalytics {
  return { ...snapshot, modelVersion };
}