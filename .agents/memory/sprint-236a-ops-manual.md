---
name: Sprint 2.3.6A — Operations Manual Completion
description: Admin ops manual page with search, enhanced intelligence diagnostics, precomputation tracking, per-symbol breakdown, docs 16/17, DoD checker script.
---

## Admin Operations Manual

`/admin/operations-manual` → `client/src/pages/admin-operations-manual.tsx`
Server: `server/routes/operations-manual.ts` — `registerOperationsManualRoutes()`
Routes: GET /api/admin/operations-manual/docs, /docs/:id, /search?q=, POST /refresh
- Doc index cached 60s in memory; POST /refresh invalidates
- Full-text search across all docs/operations/*.md (no LLM)
- Admin-only (`isAuthenticated` + `isAdmin`)
- Security: doc id validated `/^[\w-]+$/` — no path traversal possible
- docs/ files never served at a public path

**Why:** Admins need searchable runbooks without leaving the app. No external hosting.

## Enhanced Intelligence Diagnostics

`GET /api/admin/intelligence/diagnostics` now returns:
- `precomputation` — from `getPrecomputationStatus()` in `intelligence-orchestrator.ts`
  - `hookPresent: true` (static fact), `lastAttemptAt`, `lastSuccessAt`, `lastErrorMessage`, `lastSectorCount`, `lastThemeCount`, `lastRankedCount`, `running`
- `symbolBreakdown` — per-symbol sector/industry/themes for all ranked symbols
  - `rankedTotal`, `rankedWithSector`, `rankedWithoutSector`, `rankedInAnyTheme`, `rankedInNoTheme`, `symbols[]`
  - Uses LEFT JOIN market_data_symbols + symbols + `getThemesForSymbol()` from theme-registry
  - Falls back gracefully if ranking is null (returns zeros)

## Precomputation Status Tracking

`server/services/intelligence-orchestrator.ts` — `_precomputeStatus` singleton + `getPrecomputationStatus()` exported getter.
Tracks: lastAttemptAt, lastSuccessAt, lastErrorMessage, lastSectorCount, lastThemeCount, lastRankedCount, running.
Updated in the finally block; running=false always cleaned up.

## Documentation Update Checker

`scripts/check-operations-docs.ts` — advisory only (exits 0 always).
Checks git staged or last-commit diff. If operational code changed (server/routes/, server/services/, shared/schema.ts, script/, scripts/) but no docs/operations/ file changed → prints warning.
Self-excluded (checking the checker itself does not require docs update).

## DoD Policy

All future sprints must include: `Operations Manual Updated: YES / NO` in completion report.
`docs/operations/README.md` now has the full Definition of Done section.
`docs/operations/17-sprint-change-log.md` must always be updated.

## Test Gotcha: Vitest Picks Up .cache Files

Running `npx vitest run --root .` without a testMatch filter picks up bun's package cache at `.cache/.bun/install/cache/`. This shows as many "failed files" but 0 failed tests. Pre-existing issue, not caused by sprint changes. Target specific files or use --exclude when running full suite.

## Case-Sensitive String Tests in Runbook

When writing tests that check `toContain(string)` against doc files, ensure the exact case matches what's in the doc. Fixed by adding lowercase classification labels to the runbook incident body text (not just headings which use Title Case).
