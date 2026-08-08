---
name: Opportunity Change Intelligence
description: Sprint 2.3.1 — deterministic engine explaining WHY ranked opportunities changed; endpoint + dashboard + workspace panels.
---

## Architecture

- **Engine:** `server/services/opportunity-change-engine.ts` — pure, zero DB deps.
  - `inferDrivers()` — adds category-change and regime-change drivers in slots 1 & 2 (guaranteed within the 5-driver cap); remaining slots filled by Technical/Institutional/Risk signals.
  - `buildSummary()` — treats `scoreDelta === 0` as null (falls through to direction-based sentence).
  - `inferWarnings()` — deduplicates via `Array.from(new Set(...))` to avoid TS2802.
  - `explainSymbolChange()` — assembles one full explanation from a ranked candidate + history rows + change event.
  - `buildChangeIntelligenceReport()` — fan-out over full ranking, plus removed-symbol detection from history.

- **Endpoint:** `GET /api/opportunities/changes/explained`
  - Registered in `server/routes.ts` BEFORE the existing `/api/opportunities/changes` route.
  - Batch-fetches last 2 history rows per symbol; resolves removed symbols from 48h history.
  - Returns `{ generatedAt, majorMovers[], upgrades[], downgrades[], newEntries[], removed[], available }`.

- **Dashboard panel:** `EnrichedRankingChangesPanel` in `dashboard.tsx`.
  - Receives `explainedChanges` from a new `explainedChangesQuery` (stale 5min, refetch 12min).
  - Falls back to the simple chip view (`fallbackChanges`) while loading or unavailable.
  - Each card is expand/collapse with driver bullets.

- **Workspace panel:** `WhyItChangedPanel` in `opportunity-workspace.tsx`.
  - `changeExplanation` is computed server-side in the workspace route (zero extra API call — uses in-memory ranking).
  - Renders only when `direction !== "unchanged"`.

## Key constraints

- Do NOT expose `scoreDelta` computation details to client; engine runs server-side.
- `Map` and `Set` iteration must use `Array.from(...)` — project tsconfig targets pre-ES2015.
- Previous ranking is never stored in memory — history table provides the previous snapshot.

**Why:** Deterministic explanations prevent hallucinated LLM reasoning about price movement; all driver text is produced from dimension scores and signal text.
