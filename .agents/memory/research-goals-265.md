---
name: Research Goals & Planning (Sprint 2.6.5)
description: Goals architecture, matching contract, compliance rules, and routing conventions for the Research Goals feature.
---

## Architecture

- **Table**: `research_goals` (migration `027_research_goals.sql`) — 15 columns, no financial questionnaire fields
- **Service**: `server/services/research-goal-service.ts` — CRUD, primary goal logic, `matchOpportunityToGoal()`, activity, plan, health
- **Routes**: `server/routes/research-goals.ts` — 12 endpoints; static routes (`/primary`, `/health`, `/metadata`) registered BEFORE dynamic `/:id`
- **Client**: `/goals` (`goals.tsx`), `/goals/:id` (`goal-detail.tsx`); `/goals/new` is a static route pointing to `GoalsPage`
- **Shared types**: `shared/research-goal-types.ts`

## Matching Contract

- `matchOpportunityToGoal(opp, goal)` is **deterministic and pure** — no AI inference
- Returns `matchState: "strong_match" | "match" | "partial_match" | "outside_filters"` — **categorical only**
- **No numeric suitability score** — `suitabilityScore` / `suitabilityRating` must never appear in return type
- Internal scoring (not exposed): theme +3, sector +2, opp type +2, horizon +1, volatility +1, options interest +1; thresholds: ≥5=strong, ≥2=match, ≥1=partial
- Cache key: `userId:goalId:opportunitySnapshotId` (5-min TTL, in-memory Map)
- Cache invalidated on goal update or delete via `invalidateGoalMatchCache(userId, goalId)`
- **Never cross-user cache** — cache key always includes userId

**Why:** Suitability language triggers compliance review. Categorical states preserve research-context framing.

## Compliance Rules (enforced)

1. No `income`, `netWorth`, `age`, `taxBracket`, `dependents`, `employment` fields anywhere in goal schema
2. No "suitability score" or "recommended for you" language in any label, disclaimer, or match reason
3. Volatility preference = research filter only; disclaimer must say "does not represent a suitability assessment"
4. `GOAL_COMPLIANCE_DISCLAIMER` must include "suitability" and "investment recommendation" in negating context
5. `GOAL_MATCH_DISCLAIMER` must mention "suitable" and "buy" in negating context

## Primary Goal Logic

- One primary goal per user, enforced in service layer (not DB constraint)
- `setPrimaryGoal(userId, goalId)`: `UPDATE SET is_primary = false WHERE user_id = ?` → then `UPDATE SET is_primary = true WHERE id = ?`

## MapIterator TS Quirk

`for (const key of mapInstance.keys())` fails with TS target < ES2015.
**Fix:** `for (const key of Array.from(mapInstance.keys()))` — applied in `invalidateGoalMatchCache`.

**Why:** The server tsconfig targets an older ES level; `.keys()` returns a MapIterator which is not iterable at that target without `--downlevelIteration`.

## TradePlanningContextShape

Documented in `shared/research-goal-types.ts` as a Phase 2.7 future interface only. Not implemented. Do not wire it to any route or service in Sprint 2.6.x.

## Routing Convention

App.tsx goal route order (required):
```
/goals/new    ← static (must be first)
/goals/:id    ← dynamic
/goals        ← list (registered last)
```
Matches standard routing regression rule: static before dynamic.
