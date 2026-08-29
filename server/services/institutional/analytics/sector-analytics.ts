/**
 * Sector and industry analytics domain contract.
 *
 * Allocation calculations belong in this server-side domain, not in React.
 * Theme mapping remains a separate concern so sector, industry, and curated
 * theme definitions can evolve independently.
 */

import type {
  ModelVersion,
  SectorAnalyticsQuery,
  SectorInstitutionalAnalytics,
} from "./types";
import type { SectorInstitutionalSourceSnapshot } from "./repository";

export interface SectorAnalyticsService {
  getSectorAnalytics(
    query: SectorAnalyticsQuery,
  ): Promise<SectorInstitutionalAnalytics | null>;
}

/** Attach the calculation version while preserving explicit null allocations. */
export function createSectorInstitutionalAnalytics(
  snapshot: SectorInstitutionalSourceSnapshot,
  modelVersion: ModelVersion,
): SectorInstitutionalAnalytics {
  return { ...snapshot, modelVersion };
}