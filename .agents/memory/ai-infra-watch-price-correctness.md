---
name: AI Infra Watch price correctness
description: Root cause (two-layer) and fix for stale/wrong prices in the Dashboard AI Infrastructure Watch widget. Session-aware freshness, holiday calendar integration.
---

## Root Cause (two-layer defect)

**Layer 1:** `getReferenceSnapshotsBulk` ignored `freshnessStatus` from `getHistoricalBars` — stale
bars flowed into `lastPrice` with a hardcoded "Latest daily close" badge.

**Layer 2 (from live payload — AMD $514.39, MU $971.66 at 11 PM ET Monday Aug 17):**
Even after enabling `allowExternalRefresh: true`, `checkFreshness("2026-08-14","scan")` at 11 PM ET
Monday Aug 17 returns "fresh" (weekdayDistance=1 ≤ SCAN_STALE_WEEKDAYS=3). Phase 2 fires and
swallows Phase 3 entirely — the refresh never ran.

**Fix:** Session-aware freshness via `checkSessionFreshness()` + `mostRecentExpectedTradingSession()`.
After 4:30 PM ET on a confirmed trading weekday, that day's bar is "expected"; any older bar is stale.
`expectedSessionDate` param in `getHistoricalBars` gates Phase 2 to require session coverage.

## Session-Aware Freshness Functions (new exports in market-history-service.ts)

- `SESSION_POLICY` — `{ MARKET_CLOSE_HOUR_ET: 16, POST_CLOSE_GRACE_MINUTES: 30 }`
- `mostRecentExpectedTradingSession(refDate?, opts?)` — holiday-aware via `isExpectedTradingDay()`
  from `ingestion.ts` (full NYSE algorithmic calendar). After 4:30 PM ET on a confirmed trading
  weekday → today. On a market holiday or before grace → most recent prior actual trading session.
  Labor Day Monday at 5 PM ET → Friday. Thanksgiving at 5 PM ET → Wednesday.
  Uses noon-UTC ("T12:00:00Z") to call isExpectedTradingDay without timezone ambiguity.
- `checkSessionFreshness(barDate, refDate?, opts?)` — "fresh" iff barDate >= expectedSession.

**When to use:** Small fixed-symbol widgets displaying canonical daily close (≤10 symbols).
**When NOT to use:** Broad scans (100+ symbols) — keep `checkFreshness()` weekday-distance,
which intentionally tolerates single-day holiday gaps conservatively.

## getHistoricalBars param added

`expectedSessionDate?: string` — Phase 2 requires `latestStored >= expectedSessionDate` (when set)
in addition to weekday-fresh. Compute via `mostRecentExpectedTradingSession()`, never hardcoded.

## getReferenceSnapshotsBulk opts added

`sessionAware?: boolean` — computes `expectedSessionDate` once for the batch, passes to
`getHistoricalBars`, and applies `checkSessionFreshness` to override result `freshnessStatus`.
AI Infra Watch passes `{ allowExternalRefresh: true, sessionAware: true }`.

## Canonical Price Contract

```
freshness !== "fresh" → last = null  (unconditional staleness gate in buildAiInfraWatch)
freshness === "fresh" → last = lastBar.close  (canonical daily close)
```

## Import chain

`market-history-service.ts` imports `isExpectedTradingDay` from `./daily-market-data/ingestion`.
No circular risk — `ingestion.ts` only imports db, twelve-data-client, validation, indicators, config.

## Refresh Architecture

Safety stack for AI Infra Watch (8 symbols): `inFlight` Map dedup → credit manager (7/min, 750/day)
→ `persistValidatedBars` (subsequent renders hit Phase 2 = 0 credits). Max cost per cycle = 8 credits.
Daily ingestion scheduler runs at 7:15 PM ET weekdays. `allowExternalRefresh` is a complementary
safety net for pre-scheduler renders, scheduler failures, non-ingested symbols.

## Tests

100 tests in `server/services/__tests__/ai-infra-watch.test.ts`:
- §AW-S1–S8: session-aware scenarios (production bug, weekend, holiday, grace, refresh)
- §AW-S9: Thanksgiving — Wednesday stays expected all of Thanksgiving day
- §AW-S10: first trading day after holiday + spec case 6 (Aug 17 production regression)

**Why:** weekday-distance policy cannot distinguish "Friday bar during Monday session" (correct: fresh)
from "Friday bar after Monday close" (wrong: should be stale). Session-aware mode is unconditionally
correct for canonical-close surfaces; holiday awareness prevents a holiday day from ever becoming
an "expected session" that triggers unnecessary refresh-then-stale fallback.

**How to apply:** Any new small-symbol widget showing the canonical daily close should use
`getReferenceSnapshotsBulk` with `{ allowExternalRefresh: true, sessionAware: true }`.
All consumers of `ReferenceSnapshot` must check `snap.freshnessStatus` before trusting `snap.lastPrice`.
