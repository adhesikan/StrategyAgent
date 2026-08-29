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

## Stock institutional intelligence

`getStockInstitutionalAnalytics(symbol, quarter, options)` calculates
stock-level analytics across tracked managers from persisted effective
filings. It defaults to the latest quarter and `COMMON_EQUITY`; puts and calls
remain independently selectable, and PRN rows never enter common-equity share
totals.

Current holdings are aggregated by manager while retaining their contributing
CUSIPs. Quarter-over-quarter classifications are emitted only when the manager
has effective filings for both adjacent calendar quarters. A current holder
whose manager lacks the prior filing remains visible but is not mislabeled as
new; aggregate and holder-count changes fail closed to `null` when the current
holder set is not fully comparable.

The result includes holder counts, reported share/value totals, average and
median manager portfolio weights, bounded holder/change lists, and mapping/data
quality. These metrics describe delayed holdings reported by tracked Form 13F
managers. They do not establish total institutional ownership and reported
differences are not exact trading activity.

Route integration, StockMetrics migration, external APIs, and dashboards
remain outside this layer.