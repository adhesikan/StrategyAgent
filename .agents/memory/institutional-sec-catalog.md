---
name: Institutional SEC Dataset Catalog
description: Post-2023 SEC Form 13F datasets use date-range filenames, not YYYYqN. Catalog fetch is authoritative.
---

## The rule

Never construct `YYYYqN_form13f.zip` URLs for datasets after 2023Q4.
Post-2023 SEC datasets use three-month date-range filenames:
  - `01mar2026-31may2026_form13f.zip` (Q1)
  - `01jun2025-31aug2025_form13f.zip` (Q2)
  - `01sep2025-30nov2025_form13f.zip` (Q3)
  - `01dec2025-28feb2026_form13f.zip` (Q4, cross-year)

**Why:** All post-2023 HEAD probes against constructed `2026q1_form13f.zip` URLs returned HTTP 404, causing every post-2023 quarter to be labeled "dataset not yet published."

**How to apply:** Use `getCachedCatalog(userAgent)` from `sec-dataset-catalog.ts` to fetch the official index page and get authoritative URLs. Pass a `DatasetDescriptor` (which carries `downloadUrl` directly) to `parseBulkFromDescriptor()`. Never let the ingestion layer reconstruct a URL.

## Window-to-holdings period mapping

| Window start month | Holdings quarter | Example |
|---|---|---|
| March (3) | Q1 of window start year | Mar-May 2026 → 2026Q1 |
| June (6) | Q2 of window start year | Jun-Aug 2025 → 2025Q2 |
| September (9) | Q3 of window start year | Sep-Nov 2025 → 2025Q3 |
| December (12) | Q4 of window start year | Dec 2025-Feb 2026 → 2025Q4 |

## --quarters N semantics

"Cover N distinct holdings periods" not "download N ZIPs".
`selectDatasetWindows(n, catalog)` deduplicates by `expectedPeriodOfReport`.

## ZIP entry prefix resolution

ZIP entries inside post-2023 archives are expected to use the holdings quarter prefix (e.g. `2026Q1_SUBMISSION.TSV`).
`parseBulkQuarterFromBuffer` now tries: override prefix → derived (year+q) prefix → auto-detect from archive entries.

## Files

- `server/services/institutional/sec-dataset-catalog.ts` — catalog fetch, HTML parse, selection
- `server/services/institutional/sec-13f-bulk-parser.ts` — `parseBulkFromDescriptor`, `probeDescriptorAvailability`, `detectEntryPrefix`
- `server/services/institutional/ingestion-service.ts` — `ingestFromDescriptor`, `specificDescriptors` option
- `scripts/run-institutional-backfill.ts` — catalog-driven `--quarters N`, legacy `--quarter YYYYQN`
- `server/services/institutional/__tests__/sec-dataset-catalog.test.ts` — 63 tests
