/**
 * Cohort analytics domain contract.
 *
 * Cohorts may later represent manager groups, sectors, themes, or other
 * explicitly defined universes. Cohort membership and aggregation remain
 * repository-backed; no client-side inference belongs here.
 */

import type {
  CohortAnalyticsQuery,
  CohortInstitutionalAnalytics,
  ModelVersion,
} from "./types";
import type { CohortInstitutionalSourceSnapshot } from "./repository";

export interface CohortAnalyticsService {
  getCohortAnalytics(
    query: CohortAnalyticsQuery,
  ): Promise<CohortInstitutionalAnalytics | null>;
}

/** Attach the calculation version without coercing a cohort into a stock. */
export function createCohortInstitutionalAnalytics(
  snapshot: CohortInstitutionalSourceSnapshot,
  modelVersion: ModelVersion,
): CohortInstitutionalAnalytics {
  return { ...snapshot, modelVersion };
}