/**
 * Trend analytics domain contract.
 *
 * Trend interpretation must be deterministic and evidence-backed. This
 * contract deliberately does not prescribe thresholds or a scoring model yet.
 */

import type { TrendAnalyticsQuery, InstitutionalTrend } from "./types";
import type { TrendInstitutionalSourceSnapshot } from "./repository";

export interface TrendAnalyticsService {
  getTrend(query: TrendAnalyticsQuery): Promise<InstitutionalTrend | null>;
}

/** Preserve a repository-backed trend without applying undeclared thresholds. */
export function createInstitutionalTrend(
  snapshot: TrendInstitutionalSourceSnapshot,
): InstitutionalTrend {
  return { ...snapshot };
}