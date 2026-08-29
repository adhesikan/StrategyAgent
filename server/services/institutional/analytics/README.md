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

## Cross-fund institutional activity rankings

The four server-side ranking entry points report accumulation, reduction,
newly reported, and no-longer-reported activity across tracked managers. They
reuse persisted effective filings and compare only adjacent calendar quarters.
When duplicate effective rows exist defensively, the later filing
date/accession wins for that manager and quarter.

Holdings are loaded in bounded, deterministic pages for all selected accessions
rather than queried manager by manager. Calculations aggregate by trusted
canonical symbol while retaining contributing CUSIPs internally. Filters cover
quarter, sector, industry, normalized theme id/name, market-cap range, minimum
managers in the selected activity category, minimum current reported value, and independently selectable
common-equity, put, or call rows. PRN rows never enter common-equity rankings.

Multiple deterministic sort metrics are available; no composite score is
created. Missing adjacent manager history is never labeled as a new report or
exit and causes affected aggregate comparison fields to fail closed to `null`.
An increase-to-reduction ratio is also `null` when its reduction denominator is
zero. These rankings describe delayed filing changes among tracked managers,
not exact trades, total institutional ownership, recommendations, or trading
conclusions.

### Performance observation

A read-only `EXPLAIN (ANALYZE, BUFFERS)` on the two-quarter accessions/holdings
shape used existing indexes for effective filings, filing periods, accession
holdings, CUSIP mappings, and security-master joins. The development database
had no matching filing rows at measurement time, so the observed 1.34 ms
execution is useful only for confirming plan shape, not production-volume
latency. The repository therefore keeps deterministic 5,000-row paging to
exhaustion and performs two all-manager holdings loads (current/prior), with no
per-manager or per-symbol queries. No new index or precomputed table is
justified by the available evidence.

## Classification rotation

`getSectorRotation()`, `getIndustryRotation()`, and `getThemeRotation()` reuse
the persisted cross-fund current/prior-quarter source. They report filing-time
value exposure, manager breadth, and share-based position activity separately.
Reported value changes are never treated as buying or selling because security
price changes also affect reported value.

Sector and industry groups are exclusive for each reliably mapped security.
Theme groups are intentionally non-exclusive: a security contributes its full
reported exposure to every normalized theme membership, so thematic values may
sum above total portfolio exposure. Unmapped and ambiguous securities are not
guessed into a classification. Common equity is the default; PRN, put, and call
rows are excluded unless an option position type is selected explicitly.

## Multi-quarter stock trend

`getStockInstitutionalTrend(symbol, options)` loads up to eight consecutive
effective filing quarters by default and returns chronological holder, share,
value, breadth, persistence, and increase/reduction-balance observations.
Missing adjacent manager filings are never interpreted as new or exited
positions, and acceleration never bridges a missing quarter comparison.

All classification boundaries live in the versioned
`INSTITUTIONAL_TREND_MODEL_CONFIG` (`institutional_trend_v1`). Classification
uses reported-share activity and manager breadth only. Reported market value is
returned as context but cannot change an accumulation/distribution label because
security price movement also affects filing-time value. No AI or LLM
interpretation is involved.

Route integration, StockMetrics migration, external APIs, and dashboards
remain outside this layer.