# 34 — Trade Monitoring & Lifecycle Intelligence

**Sprint:** 2.7.6  
**Capability:** Deterministic lifecycle evaluation for saved trade plans  
**Status:** Production (Sprint 2.7.6)

---

## Overview

Trade Monitoring & Lifecycle Intelligence observes whether the research assumptions underlying a saved trade plan remain valid over time. It compares saved research snapshots to current opportunity intelligence and surfaces material changes through a deterministic lifecycle state.

**This system is observation-only:**
- No execution instructions
- No exit signals
- No broker orders
- No automatic plan mutation
- No suitability scoring

---

## Architecture

### Services

| Service | File | Purpose |
|---------|------|---------|
| `evaluateTradePlanLifecycle` | `server/services/trade-plan-lifecycle-service.ts` | Single-plan lifecycle evaluation |
| `evaluateUserTradePlans` | same | Batch evaluation for one user |
| `evaluateAllActiveTradePlans` | same | Scheduler-ready aggregate (not wired to cron) |
| `persistLifecycleActivity` | same | Deduplicated activity persistence |
| `getTradePlanActivities` | same | Paginated activity timeline retrieval |
| `getLifecycleHealth` | same | Platform health metrics |
| `ensureTradePlanActivityTable` | same | Idempotent table initialization |

### Database Tables

| Table | Purpose |
|-------|---------|
| `trade_plan_activity` | Lifecycle event log (user-owned, per-plan) |
| `trade_plans` | Source of truth for research snapshots and plan status |

### Cache

- **In-process 5-minute cache**: `userId:planId` → `TradePlanLifecycleResult`
- **No shared cross-user cache**: each user's cache entry is isolated

### Concurrency

- **Evaluation guard**: in-flight evaluations tracked in a `Set<string>` keyed by `userId:planId`
- **Manual trigger**: if evaluation already in flight, waits up to 6 seconds before proceeding
- **Deduplication window**: 24-hour fingerprint window for activity events

---

## Lifecycle States

| State | Description |
|-------|-------------|
| `CURRENT` | Research matches saved snapshot within non-material thresholds |
| `CHANGED` | Non-material research changes detected |
| `REQUIRES_REVIEW` | Material research changes warrant manual review |
| `THESIS_INVALIDATED` | One or more invalidation conditions observed |
| `DATA_STALE` | Research data unavailable or older than 48h |
| `ARCHIVED` | Plan is archived or invalidated (inactive) |
| `UNKNOWN` | Current research data unavailable |

**Priority order** (highest to lowest):
`ARCHIVED` > `UNKNOWN` > `DATA_STALE` > `THESIS_INVALIDATED` > `REQUIRES_REVIEW` > `CHANGED` > `CURRENT`

---

## Expiration States (Options Plans)

| State | DTE Range |
|-------|-----------|
| `FAR_FROM_EXPIRATION` | > 45 DTE |
| `APPROACHING_EXPIRATION` | 21–45 DTE |
| `NEAR_EXPIRATION` | 1–20 DTE |
| `EXPIRED` | ≤ 0 DTE |
| `UNKNOWN` | Expiration date unavailable |

---

## API Routes

### GET `/api/trade-plans/:id/lifecycle`

Returns cached lifecycle result if available; evaluates fresh if cache miss.

**Response:**
```json
{
  "tradePlanId": "string",
  "cached": true,
  "lifecycleResult": { ... }
}
```

### POST `/api/trade-plans/:id/lifecycle/evaluate`

Manual re-evaluation. Respects concurrency guard. Persists new activity events.

**Request body:**
```json
{ "force": true }
```

**Response:**
```json
{
  "tradePlanId": "string",
  "lifecycleResult": { ... },
  "newActivities": [ ... ],
  "durationMs": 123
}
```

### GET `/api/trade-plans/:id/activity`

Paginated activity timeline. Optional filter: `?category=research|risk|events|freshness|user_action`.

**Query params:**
- `limit` (1–200, default 50)
- `offset` (default 0)
- `category` (optional filter)

**Response:**
```json
{
  "tradePlanId": "string",
  "activities": [ ... ],
  "total": 12,
  "hasMore": false
}
```

### GET `/api/trade-plans/lifecycle/health`

Admin aggregate health metrics. No user-identifying data.

---

## Activity Event Types

| Type | Category |
|------|----------|
| `PLAN_CREATED` | user_action |
| `PLAN_UPDATED` | user_action |
| `RESEARCH_SNAPSHOT_SAVED` | research |
| `MONITORING_STARTED` | user_action |
| `LIFECYCLE_EVALUATED` | research |
| `RESEARCH_STRENGTHENED` | research |
| `RESEARCH_WEAKENED` | research |
| `QUALIFICATION_CHANGED` | research |
| `REGIME_CHANGED` | research |
| `SECTOR_CHANGED` | research |
| `THESIS_INVALIDATION_OBSERVED` | research |
| `REVIEW_REQUIRED` | research |
| `DATA_STALE` | freshness |
| `EXPIRATION_APPROACHING` | events |
| `LIQUIDITY_CHANGED` | risk |
| `STRUCTURAL_CHANGE` | risk |
| `ARCHIVE_REQUESTED` | user_action |

---

## Review Reason Types

| Reason | Trigger |
|--------|---------|
| `QUALIFICATION_LOST` | NO_LONGER_QUALIFIED research change |
| `RESEARCH_SCORE_MATERIALLY_WEAKENED` | Research score dropped ≥ 5 pts |
| `TECHNICAL_INVALIDATION_OBSERVED` | Technical score dropped ≥ 5 pts |
| `THESIS_INVALIDATION_OBSERVED` | Saved invalidation condition observed |
| `CRITICAL_DATA_STALE` | DATA_BECAME_STALE or DATA_UNAVAILABLE |
| `EARNINGS_INSIDE_STRUCTURE_LIFETIME` | EVENT_ENTERED_LIFETIME change |
| `LIQUIDITY_DEGRADED` | LIQUIDITY_WEAKENED or QUOTE_STALE change |
| `EXPIRATION_APPROACHING` | EXPIRATION_APPROACHING or EXPIRATION_NEAR structure change |
| `MARKET_REGIME_CHANGED` | REGIME_CHANGED research change |
| `INSTITUTIONAL_SIGNAL_CHANGED` | Institutional score materially changed |

---

## Deduplication

Activity events are fingerprinted using:
```
SHA256(tradePlanId | activityType | currentState | methodologyVersion).slice(0, 32)
```

Events with a matching fingerprint within the **24-hour** dedup window are not re-recorded.

---

## Material vs. Non-Material Changes

| Threshold | Classification |
|-----------|---------------|
| Score delta ≥ 5 | Material |
| Score delta < 5 | Non-material |
| Qualification change | Always material |
| Regime change | Non-material (surfaced as review reason) |
| Sector / theme change | Non-material (informational) |

---

## Research Score Comparison

Scores compared per dimension: research, technical, fundamental, institutional.

Deltas:
- Positive delta with research = STRENGTHENED
- Negative delta = WEAKENED
- INSTITUTIONAL_CHANGED / FUNDAMENTAL_CHANGED are directional but labeled as "changed"

---

## Freshness Evaluation

| Age | Freshness Label |
|-----|----------------|
| < 4h | fresh |
| 4–24h | recent |
| > 24h | stale |
| unavailable | unknown |

Data stale threshold for lifecycle state: **48 hours**

---

## Platform Health Metrics

Available at `/api/trade-plans/lifecycle/health`. No user-identifying data. Aggregates since process start.

| Metric | Description |
|--------|-------------|
| `plansEvaluated` | Total evaluations since process start |
| `currentPlans` | Plans in CURRENT state (since start) |
| `changedPlans` | Plans in CHANGED state |
| `reviewRequiredPlans` | Plans in REQUIRES_REVIEW state |
| `invalidatedPlans` | Plans in THESIS_INVALIDATED state |
| `stalePlans` | Plans in DATA_STALE state |
| `failedEvaluations` | Failed evaluations (exceptions) |
| `averageEvaluationDurationMs` | Rolling average (last 500 evaluations) |
| `lastEvaluationAt` | ISO timestamp of last completed evaluation |

---

## Structured Logging

Safe event fields (no PII, no capital, no P/L):

```json
{
  "event": "trade_plan_lifecycle_completed",
  "durationMs": 123,
  "planType": "EQUITY",
  "lifecycleState": "CURRENT",
  "changeCount": 2,
  "riskFlagCount": 0,
  "hasEventChange": false,
  "hasLiquidityChange": false,
  "ts": "2026-08-10T12:00:00.000Z"
}
```

**Prohibited log fields:** userId, email, capital, pnl, notes, position, accountId, symbol, ticker.

---

## Compliance Requirements

### Forbidden Language

Never appear in lifecycle output, labels, or UI copy:

- "exit now" / "exit the position"
- "sell" / "sell now"
- "close the position"
- "take profit"
- "stop loss triggered"
- "roll" / "roll recommended"
- "adjustment recommended"
- "probability of profit"
- "expected return"
- "chance of winning"

### Required UI Disclosures

The lifecycle disclaimer must appear on all lifecycle surfaces:
```
This lifecycle analysis contains research observations only. It is not instructions to buy, sell, 
or otherwise manage any position. Changes in research signals do not constitute trading advice. 
All trading decisions require independent evaluation and involve substantial risk.
```

### UX CTA Restrictions for REQUIRES_REVIEW / THESIS_INVALIDATED

**Permitted CTAs:**
- "Review Research"
- "Open Research Workspace"
- "Re-run Risk Analysis"
- "Return to Contract Research"
- "View Invalidation Evidence"
- "Compare Saved vs Current Research"

**Prohibited CTAs:**
- "Close Position"
- "Sell"
- "Roll"
- "Exit Trade"
- "Take Profit"

---

## Scheduler

The lifecycle evaluation is **not wired to a cron job in Sprint 2.7.6**.

`evaluateAllActiveTradePlans()` is scheduler-ready and can be wired in Sprint 2.7.7 after:
- Validation that batch evaluation performance meets latency SLOs
- Confirmation that deduplication correctly handles automated batch vs. manual trigger runs
- Platform health metrics show acceptable failure rates

---

## Limitations (Sprint 2.7.6)

1. **Event calendar not evaluated** — earnings/macro event detection requires an event feed integration (Sprint 2.7.7)
2. **Live liquidity comparison not evaluated** — requires current options chain (broker connection required)
3. **Greeks monitoring not implemented** — partial Greeks logging available; full monitoring in Sprint 2.7.7+
4. **No automated scheduling** — manual trigger only

---

## UAT Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | View lifecycle for CURRENT plan | lifecycleState = CURRENT, no review reasons |
| 2 | View lifecycle for plan with -15 research score drop | lifecycleState = REQUIRES_REVIEW |
| 3 | View lifecycle for plan with qualification loss | lifecycleState = THESIS_INVALIDATED |
| 4 | View lifecycle for plan with stale data (>48h) | lifecycleState = DATA_STALE |
| 5 | View lifecycle for archived plan | lifecycleState = ARCHIVED |
| 6 | View lifecycle for options plan with DTE 15 | expirationState = NEAR_EXPIRATION |
| 7 | View lifecycle for options plan with DTE 30 | expirationState = APPROACHING_EXPIRATION |
| 8 | View lifecycle for options plan with DTE 90 | expirationState = FAR_FROM_EXPIRATION |
| 9 | POST /lifecycle/evaluate twice in quick succession | Second returns cached result or waits |
| 10 | GET /activity for plan with events | Returns paginated activity list |
| 11 | GET /activity with category=research filter | Returns only research events |
| 12 | Verify THESIS_INVALIDATED lifecycle shows no exit CTAs | No "Sell" / "Close" / "Roll" buttons |
| 13 | Verify REQUIRES_REVIEW shows only research CTAs | "Review Research" / "Open Workspace" |
| 14 | Verify DATA_STALE shows limitations disclosure | Stale sources listed explicitly |
| 15 | Cross-user plan ID → 404 | Cannot access other users' plans |
| 16 | GET /lifecycle/health returns aggregate counts | No userId / email / symbol in response |
| 17 | Activity deduplication: same event within 24h | Second event not recorded |
| 18 | Activity deduplication: same event after 24h | Second event IS recorded |
| 19 | View lifecycle for plan with non-material change | lifecycleState = CHANGED (not REQUIRES_REVIEW) |
| 20 | Verify lifecycle disclaimer present on detail page | Disclaimer visible |

---

## Related Operations Documents

- `16-api-and-uat-reference.md` — full UAT reference
- `17-sprint-change-log.md` — Sprint 2.7.6 entry
- `32-equity-planning.md` — Sprint 2.7.1 equity planning context
- `33-trade-plan-workspace.md` — Sprint 2.7.5 workspace architecture
