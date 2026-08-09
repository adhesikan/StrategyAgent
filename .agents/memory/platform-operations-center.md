---
name: Platform Operations Center
description: Sprint 2.5.3B — enriched platform health endpoint with Operations Summary, Research Pipeline, and Data Freshness; architecture decisions and key rules.
---

## What changed in Sprint 2.5.3B

GET `/api/admin/platform-health` now returns `PlatformHealthEnriched`:
```
{ health, operationsSummary, researchPipeline, dataFreshness, endpointLatencyMs, cachedAt, cached }
```

## Architecture

- `server/lib/health-freshness.ts` — pure freshness helper; `assessFreshness()`, `FRESHNESS_RULES` (14 datasets)
- `server/routes/platform-health-internals.ts` — pure compute functions (3): `computeOperationsSummary`, `computePipelineStages`, `computeDataFreshness`. No DB, no network, importable in tests.
- `server/routes/platform-health-test-exports.ts` — re-exports from internals for tests
- `server/routes/platform-health.ts` — imports from internals (not inlined); route handlers spread enriched response

## Key rules

- **Broker Sync DISABLED** when no portfolios connected — correct, never triggers requiresAttention
- **Institutional 13F DELAYED by design** (quarterly) — `delayedByDesign:true` in FRESHNESS_RULES → never STALE
- **DISABLED** status never triggers `requiresAttention`
- **Health vs Readiness** distinction: scanner HEALTHY but research can be WAITING (ranking not yet computed)
- **7 Operations Summary dimensions:** Platform Status / Research Readiness / Market Data / AI / Reports / Portfolio Services / Broker Services
- **10 Pipeline stages:** Market Data → Universe Ready → Scanner → Ranking → OppIntel → Sector/Theme → Collections → Monitoring → Command Center → Reports
- **14 Freshness datasets:** per-dataset thresholds (not universal)
- **NOT_APPLICABLE label** must be "N/A" (not "Not applicable") — test enforces this

## Test coverage

- `server/routes/__tests__/platform-health-operations.test.ts` — 85 tests
- Run with: `npx vitest run --root . server/routes/__tests__/platform-health-operations.test.ts`

## No business logic changed

Zero changes to scanner scoring, ranking formulas, opportunity intelligence, portfolio history, or any product-facing analysis logic.
