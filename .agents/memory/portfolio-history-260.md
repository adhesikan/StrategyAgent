---
name: Portfolio History & Change Intelligence (Sprint 2.6.0)
description: Architecture and gotchas for portfolio snapshot capture, deduplication, and change classification engine.
---

## Core rules

- Two new tables: `portfolio_snapshots` + `portfolio_position_snapshots`. Created via raw SQL in `ensurePortfolioHistoryTables()`, NOT Drizzle schema — consistent with research-monitor/research-reports pattern.
- All enrichment is bulk: one `getReferenceSnapshotsBulk(userId, symbols)` call + one `getOpportunityIntelligence()` + one `getAllThemes()`. No N+1.
- `getReferenceSnapshotsBulk` requires `userId` as the FIRST argument. Returns `Map<string, ReferenceSnapshot>`; extract `snap.lastPrice` for the numeric price.
- `ThemeDefinition` uses `themeId` (not `id`). Build a `Map<symbol, themeId[]>` once from `getAllThemes()` for O(1) lookups.
- `CanonicalOpportunity` has NO numeric `riskScore` field — it has `riskLevel` (string). Store `null` for `risk_score` in position snapshots.
- Missing data stored as `NULL`, never coerced to 0 — compliance requirement.
- Deduplication: SHA256 fingerprint of sorted `SYMBOL:QUANTITY` pairs; skip if same fingerprint within 30 minutes.
- Research score threshold: ±2 points to classify as STRENGTHENED/WEAKENED.

## Snapshot trigger contract

- `triggerSnapshotAsync` is fire-and-forget via `setImmediate`. Failures never block user operations.
- `broker-sync-service.ts` uses dynamic `import()` for `triggerSnapshotAsync` to avoid circular dependency (the path is `"./portfolio-history-service"` relative to `server/services/`).

## Map/Set iteration

- Project TS target requires `Array.from()` for all Map/Set iteration: `Array.from(map.entries())`, `Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys())]))`.

## Client History tab

- `PortfolioHistoryTab` component added to `client/src/pages/portfolio.tsx`.
- `PortfolioDetail` now has `activeTab: "holdings" | "history"` state; tab switcher at the top of the content area.
- History tab has period selector (7D/30D/90D/YTD/1Y/ALL), snapshot timeline, manual capture button, and "What Changed?" section that loads on demand.

## Ops doc compliance

- The ops doc (`docs/operations/21-portfolio-history.md`) must NOT contain: `"you should (buy|sell)"`, `"strong buy"`, `"rebalance now"`.
- The "Avoid" list in the doc must use generic descriptions instead of forbidden phrases verbatim.

**Why:** Sprint 2.6.0 spec prohibits advisory language; test regex `/\byou should (buy|sell)\b/` and `"rebalance now"` scan the ops doc.
**How to apply:** Always write Avoid lists using category descriptions, not example forbidden phrases.
