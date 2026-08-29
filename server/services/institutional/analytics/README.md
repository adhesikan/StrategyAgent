# Institutional Analytics Domain

This directory is the server-side domain boundary for future institutional
analytics. It is deliberately separate from the existing Fund Explorer
service, which remains responsible for its current endpoints and response
contracts.

## Dependency flow

```text
routes/controllers
        ↓
analytics domain services
        ↓
InstitutionalAnalyticsRepository
        ↓
database / persisted institutional aggregates
```

The domain owns analytical vocabulary and result contracts. Repository
implementations own data access. React components consume results; they do not
calculate institutional analytics.

The foundation defines analytics ports and types. The security enrichment
repository is the first concrete database adapter:

- CUSIP trust is resolved before any symbol metadata is attached.
- Company metadata is reused from `symbols` and `security_master`.
- Proprietary themes live in normalized definition and membership tables.
- Unmapped and ambiguous holdings remain in the result as unclassified.
- Coverage is calculated with a set-based database aggregate.

## Fund portfolio X-ray

`getFundPortfolioAnalytics(managerId, quarter, options)` builds reusable
manager-level analytics from persisted effective 13F filings. It defaults to
the latest effective filing and `COMMON_EQUITY`; puts and calls remain separate
and must be explicitly selected. PRN rows are not treated as common equity.

The X-ray includes reported portfolio totals, top-5/top-10/top-20
concentration, sector and industry allocation, overlapping theme exposure,
quarter-over-quarter reported change categories, largest reported share and
weight changes, and mapping/classification coverage. Reported changes are
filing comparisons, not inferred transactions.

Allocation weights use the full reported portfolio value as their denominator,
including unmapped holdings:

- Sector and industry allocations are mutually exclusive classification
  buckets. Unclassified holdings remain in the denominator but not in a
  guessed bucket.
- Theme allocations are exposure views. A security contributes its full
  reported value to every normalized theme membership, so theme percentages
  may sum above 100%.
- Canonical reported values are already US dollars.

The concrete repository reads `is_effective = true` filings and their stored
holdings only. It never calls the SEC at request time.

Route integration, StockMetrics migration, external APIs, and dashboards
remain outside this layer.