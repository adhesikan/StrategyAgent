/**
 * Fund portfolio analytics domain contract.
 *
 * Keep portfolio calculations here (or in pure helpers called here), not in
 * route handlers or React components. The first milestone defines the
 * contract; full portfolio analytics are intentionally deferred.
 */

import type {
  FundPortfolioAnalytics,
  FundPortfolioQuery,
  ModelVersion,
} from "./types";
import type { FundPortfolioSourceSnapshot } from "./repository";

export interface FundAnalyticsService {
  getPortfolioAnalytics(
    query: FundPortfolioQuery,
  ): Promise<FundPortfolioAnalytics | null>;
}

/** Attach the calculation version without inventing unavailable source data. */
export function createFundPortfolioAnalytics(
  snapshot: FundPortfolioSourceSnapshot,
  modelVersion: ModelVersion,
): FundPortfolioAnalytics {
  return { ...snapshot, modelVersion };
}