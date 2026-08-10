---
name: Trade Monitoring & Lifecycle Intelligence (Sprint 2.7.6)
description: Lifecycle evaluation engine for saved trade plans — key decisions, type contracts, test patterns, and bugs fixed.
---

## Core Architecture

- **New table**: `trade_plan_activity` (id, trade_plan_id, user_id, activity_type, observed_at, previous_state, current_state, summary, metadata JSONB, fingerprint TEXT)
- **Service**: `server/services/trade-plan-lifecycle-service.ts` — pure helpers + DB persistence
- **Types**: `shared/trade-plan-lifecycle-types.ts` — canonical source for all lifecycle types

## Lifecycle State Priority Order

```
ARCHIVED > UNKNOWN > DATA_STALE > THESIS_INVALIDATED > REQUIRES_REVIEW > CHANGED > CURRENT
```

## DTE Thresholds

| State | DTE |
|-------|-----|
| FAR_FROM_EXPIRATION | > 45 |
| APPROACHING_EXPIRATION | 21–45 |
| NEAR_EXPIRATION | 1–20 |
| EXPIRED | ≤ 0 |

Canonical: `DTE_THRESHOLDS.FAR_MIN = 46`, `APPROACHING_MIN = 21`, `NEAR_MIN = 1`

## Deduplication

Fingerprint = `SHA256(planId | activityType | currentState | methodologyVersion).slice(0, 32)`
Window: `DEDUP_WINDOW_HOURS = 24`

## Critical Bug Patterns Fixed

**1. `qualified` field in saved snapshots must be explicit**  
`computeResearchChanges` reads `(saved as any).qualified ?? false`. If the saved snapshot doesn't include `qualified: true`, a `NEWLY_QUALIFIED` change (material) is spuriously emitted when current is qualified — causing CURRENT plans to appear as REQUIRES_REVIEW.  
**Fix**: Always include `qualified: true` in saved research snapshot fixtures.

**2. `computeInvalidationChanges(saved, null)` must not return empty**  
When current data is unavailable, each condition should be returned with `observationState: "unknown"` — not silently dropped. Returning empty hides real invalidation conditions from the UI.  
**Fix**: Changed from `if (!current) return []` to returning each condition with `observationState: "unknown"`.

**Why**: Partial failure must degrade gracefully, not silently.

## Compliance Rules

- No "exit", "sell", "close", "roll", "take profit", "stop loss triggered" anywhere in output
- `LIFECYCLE_DISCLAIMER` required on all lifecycle UI surfaces
- Permitted review CTAs: "Review Research", "Open Research Workspace", "Compare Saved vs Current Research"
- Forbidden CTAs: "Close Position", "Sell", "Roll", "Exit Trade"

## Scheduler Status

`evaluateAllActiveTradePlans()` is scheduler-ready but NOT wired to cron. Wire in 2.7.7 after:
- Batch performance validation
- Dedup holding correctly across automated vs manual runs
- Failure rate acceptable in platform health metrics

## Quality Gate Framework (Mandatory from 2.7.6)

Every sprint must pass:
- `npm run test:smoke` — service exports, schema tables, pure helpers callable
- `npm run test:regression` — route ordering, compliance language, type contracts
- `npm run test:integration` — layer boundary chains (pure, no DB/network)
- `npm run test:security` — cross-user isolation, no PII in output, no tokens in responses
- Full test suite + `tsc --noEmit` + `npm run build`

## Routes Added

| Route | Method | Notes |
|-------|--------|-------|
| `/api/trade-plans/:id/lifecycle` | GET | Returns cached or fresh lifecycle result |
| `/api/trade-plans/:id/lifecycle/evaluate` | POST | Manual re-evaluation; force=true bypasses cache |
| `/api/trade-plans/:id/activity` | GET | Paginated; category filter param |
| `/api/trade-plans/lifecycle/health` | GET | Admin aggregate; no user data |

**Route ordering**: `/lifecycle/evaluate` (deeper) registered BEFORE `/:id/lifecycle`; both after `/:id/monitoring-context`.

## Platform Health

`getLifecycleHealth()` imported in `platform-health.ts`; 9 metrics added to trade plan health card. All aggregate — no userId/symbol/email exposed.

## Structured Logging Safe Fields

`event`, `durationMs`, `planType`, `lifecycleState`, `changeCount`, `riskFlagCount`, `hasEventChange`, `hasLiquidityChange`, `ts`

Never log: `userId`, `email`, `symbol`, `capital`, `pnl`, `notes`, `position`, `accountId`
