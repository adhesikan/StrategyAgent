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

The foundation currently defines ports and types only. Full calculations,
route integration, StockMetrics migration, and database changes belong to later
tasks.