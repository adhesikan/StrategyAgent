// Institutional Intelligence — Catalog Utility Functions
//
// Pure helpers for working with SEC catalog entries and converting
// them to DatasetDescriptors. No I/O, no logging, no config imports.
// Kept in the service layer so scripts and tests can import without
// pulling in the logger or other server-side dependencies.

import {
  toDatasetDescriptor,
  type InstitutionalDatasetCatalogEntry,
  type DatasetDescriptor,
} from "./sec-dataset-catalog";

/**
 * Find the DatasetDescriptor for a given quarter label (e.g. "2026-Q1")
 * from the fetched catalog entries. Returns null if not found.
 *
 * Matching is done by normalising canonicalPeriodLabel ("2026Q1" → "2026-Q1").
 *
 * When this returns null the caller MUST NOT fall back to legacy URL
 * construction for post-2023 quarters — instead it should log a
 * retriable catalog-miss and defer to the next scheduled run.
 *
 * @param quarter       Quarter label to look up, e.g. "2026-Q1"
 * @param entries       Catalog entries from fetchDatasetCatalog()
 * @returns             DatasetDescriptor ready for runInstitutionalIngestion(),
 *                      or null when the quarter is not in the catalog.
 */
export function findDescriptorForQuarter(
  quarter: string,
  entries: InstitutionalDatasetCatalogEntry[],
): DatasetDescriptor | null {
  for (const entry of entries) {
    // canonicalPeriodLabel is e.g. "2026Q1"; normalize to "2026-Q1"
    const normalized = entry.canonicalPeriodLabel.replace(/Q(\d)$/, "-Q$1");
    if (normalized !== quarter) continue;

    return toDatasetDescriptor({
      entry,
      expectedPeriodOfReport: entry.expectedPeriodOfReport,
      canonicalPeriodLabel: entry.canonicalPeriodLabel,
    });
  }
  return null;
}
