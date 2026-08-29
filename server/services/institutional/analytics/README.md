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

Full sector/theme calculations, route integration, StockMetrics migration, and
dashboards remain outside this layer.