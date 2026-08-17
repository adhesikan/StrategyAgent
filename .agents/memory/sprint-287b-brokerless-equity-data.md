---
name: Brokerless Equity Market Data (Sprint 2.8.7B)
description: PlanningQuoteData type, planning-quote adapter, preflight enrichment for brokerless EQUITY plans.
---

## The Rule

`PlanningQuoteData.source = "PLANNING_MARKET_DATA"` — permanently distinct from broker execution quotes. Never satisfies the execution gate. EQUITY-only enrichment; OPTIONS is unchanged.

## Architecture

- `shared/execution-types.ts` — `PlanningQuoteData` interface + optional `planningQuote?` on `ValidationDimension`
- `server/services/daily-market-data/planning-quote.ts` — thin adapter: `getPlanningQuoteData(userId, symbol, now?)` → wraps `getRealtimeQuoteForUser`, never throws, returns null on any error
- `PreflightDependencies.getPlanningQuote?` — **optional** `(userId, symbol) => Promise<PlanningQuoteData | null>`. Optional so legacy/test callers don't break
- Fetch lives in parallel block 5b (after broker block), guarded by `!brokerConnected && plan.planType === "EQUITY" && deps.getPlanningQuote`
- `buildPlanningModeQuoteDimension(pq)` — formats note with price + session label; attaches `planningQuote` to dim
- `createDbPreflightDeps` — wires `getPlanningQuote` via dynamic import of `planning-quote.ts`

## Data Quality

| `dataQuality` | Condition | Semantics |
|---|---|---|
| `"fresh"` | `isMarketOpen && freshnessSec < 300` | Actively trading |
| `"last_close"` | `freshnessSec < 90_000` | Normal overnight/weekend |
| `"stale"` | `freshnessSec >= 90_000` | Anomalous — never an execution failure |

Market-closed quotes are always `"last_close"`, never stale.

## Safety Invariants (Permanent Tests — Suite 13)

- `overallStatus` never `"PASS"` from planning quote alone (INV-B)
- `executionAvailable` never `true` when brokerless (INV-C)
- `getPlanningQuote` not called when broker connected (Suite 13D)
- Planning quote never produces `QUOTE_STALE` or `QUOTE_INVALID` blockers
- OPTIONS plan: `planningQuote` never attached (contract validation requires broker)

**Why:** Planning data cannot substitute for real-time broker execution data; mixing the two would create false execution confidence.

## How to Apply

- When adding a new broker-independent quote surface: reuse `getPlanningQuoteData()` — do not call `getTwelveDataRealTimeQuote` directly (ungated)
- When writing tests: inject `getPlanningQuote: vi.fn().mockResolvedValue(pq)` into deps — no real Twelve Data calls needed
- When broker IS connected: the dep is still wired but never called — the guard `!brokerStatus?.connected` prevents it

## Gotchas

- `getPlanningQuote` is `?:` optional in `PreflightDependencies` — existing tests that don't set it get the 2.8.7A PLANNING_MODE fallback note
- `getPlanningQuote` throwing is caught with `.catch(() => null)` — never propagates to the preflight result
- Staleness (`dataQuality === "stale"`) is informational only — it NEVER creates a blocker or FAIL dim for brokerless plans
