---
name: Market Research Command Center
description: Sprint 2.5.3 — aggregated daily intelligence snapshot; architecture, section contracts, and operational rules.
---

## Purpose
Primary daily destination answering "What changed today?" — 10 sections, all from precomputed stores, never recomputing.

## Route
`GET /api/command-center/daily` (auth required) — returns `CommandCenterDailySnapshot`
`GET /api/command-center/health` (auth required) — in-memory health, zero DB reads

## 10 Sections and Sources
1. **Market Overview** — `getLatestSectorSnapshots()` + `getLatestThemeSnapshots()` + `getLatestRanking().regime`
2. **Opportunity Changes** — `buildChangeIntelligenceReport()` + `opportunityHistory` DB
3. **Theme Changes** — theme snapshots
4. **Sector Changes** — sector snapshots
5. **Institutional Changes** — `institutional_symbol_signals` table (raw SQL, not service import, to avoid circular deps)
6. **Collection Changes** — `listCollections(undefined, { collectionType: "system" })`
7. **My Collections** — `listCollections(userId, { excludeArchived: true })`
8. **AI Research Summary** — `workspaceConversations` DB
9. **Research Timeline** — `workspaceConversations` DB
10. **Explain Why** — static cross-navigation links (always available)

## Key Decisions
- Each section wrapped in `try/catch`; failure → `available: false`, never leaks error to client.
- Health snapshot (`getCommandCenterHealth()`) is in-memory: resets on server restart, populated on first page visit. UNKNOWN status until visited is expected.
- `topOpportunities` in `CollectionChangeSummary` intentionally empty (avoids N+1 collection detail calls).
- All `buildChangeIntelligenceReport` imports from `opportunity-change-engine` — same engine as `/api/opportunities/changes/explained` route; not duplicated.

**Why:** Institutional signals read via raw SQL (not institutional-signals service) to avoid import cycles with route-level module.

**How to apply:** If adding new intelligence surfaces, follow the same parallel-fetch + section-builder pattern. Each builder should be a pure `async function` returning the section shape with `available: boolean`.

## Client Page
`/market-research-command-center` — `client/src/pages/market-research-command-center.tsx`
- Single `useQuery(["/api/command-center/daily"])`, refetchInterval 5min, staleTime 2min
- 10 section components, each with `data-testid="cmd-*"` for testing
- Cross-navigation: `useLocation()` navigate, Link for theme/sector detail routes

## Free vs Premium
Documented in `shared/command-center-types.ts` JSDoc only. No code restrictions. Tests verify documentation is present.

## Platform Health
New `commandCenter` key in `/api/admin/platform-health`. Wired in `server/routes/platform-health.ts` → `checkCommandCenter()` → `getCommandCenterHealth()`.
