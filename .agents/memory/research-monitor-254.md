---
name: Research Monitor (Sprint 2.5.4)
description: Continuous research monitoring architecture, watch types, evaluation strategy, and integration contracts.
---

## Core Rules
- ALL evaluation reads from existing precomputed stores only (getLatestRanking, getLatestThemeSnapshots, getLatestSectorSnapshots, getCanonicalOpportunity, getOpportunityIntelligence).
- No LLM, no recomputation, no market data fetches.
- NO `userId` in `OpportunityFilterOptions` — call `getOpportunityIntelligence()` with no args.
- `getOpportunityIntelligence()` returns `Promise<OpportunityIntelligenceResult | null>` — always null-check.
- `generatedAt` is on `OpportunityIntelligenceResult` directly, not on `.meta`. `meta` has sectors/industries/themes/types.

## DB Tables
`research_watches` + `watch_activity_log` — created by `ensureResearchMonitorTables()` (CREATE TABLE IF NOT EXISTS, called on startup in registerRoutes).

## Watch Evaluation
- Change thresholds: score ±5 points (company/theme/sector), institutional ±8 (more lag), member count any delta.
- `status_unchanged` activity entries written on every evaluation for freshness tracking.
- `activityType` is on WatchActivityEntry; `changeType`/`changeSummary`/`changed` are on WatchEvaluation (different types).
- Change summary stored in `changeData.summary` JSONB — read as `(a.changeData as any)?.summary`.

## Integration Points
- Command center: `myWatchChanges: MyWatchChangesSection` added to CommandCenterDailySnapshot; built by `buildMyWatchChangesSection(userId)` which degrades independently.
- Platform health: `researchMonitoring` card via `checkResearchMonitoring()` → `getResearchMonitoringHealth()`.
- App routing: `/research-monitor` → `ResearchMonitorPage`.

**Why:** Sprint 2.5.4 design constraint — monitoring only, no notification infrastructure until 2.6+.
