---
name: AI Infra Watch price correctness
description: Root cause and fix for stale/wrong prices in the Dashboard AI Infrastructure Watch widget. freshnessStatus contract.
---

## Root Cause

`getReferenceSnapshotsBulk` called `getHistoricalBars` with `allowExternalRefresh: false`. `getHistoricalBars` Phase 4 returns stale stored bars with `freshnessStatus: "stale"`, but `getReferenceSnapshotsBulk` **ignored** `freshnessStatus` entirely — stale bars flowed into `lastPrice: lastBar.close` and were served with a hardcoded "Latest daily close" badge.

## Fix

1. `ReferenceSnapshot` interface now carries `freshnessStatus: FreshnessStatus` and `latestBarDate: string | null`.
2. `getReferenceSnapshotsBulk` propagates `freshnessStatus` from `getHistoricalBars` result (or recomputes with `checkFreshness`).
3. `ai-infra-watch.ts`: stale → `last: null`, `freshness: "stale"`; unavailable → `last: null`, `freshness: "unavailable"`. Fresh data only enters `last`.
4. `AiInfraTicker` gained `asOf`, `freshness`, `source` fields.
5. Dashboard: `AiInfraFreshnessBadge` component replaces hardcoded badge; price cell shows `asOf` in tooltip; "—" shown for stale/unavailable.
6. 37 deterministic pure-function tests in `server/services/__tests__/ai-infra-watch.test.ts`.

## Canonical Price Contract

```
price  → AiInfraTicker.last  (null when stale or unavailable)
asOf   → AiInfraTicker.asOf  (YYYY-MM-DD of most recent stored bar)
source → AiInfraTicker.source ("stored_daily_bar" always)
freshness → AiInfraTicker.freshness ("fresh" | "stale" | "unavailable")
```

## Key Facts

- Twelve Data client sets `adjustedClose: null` for every bar — `adjustedClose` is always null in this path.
- `isAdjusted: false` by default in the DB schema.
- `close` from Twelve Data is the raw OHLCV daily close (no explicit `adjust` param in the URL).
- `FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS = 3` — bars older than 3 weekdays are stale.
- Watchlist customization backlog item added to Doc 15 (BI-MarketWatchlist).

**Why:** Without freshnessStatus flowing through, any consumer of `ReferenceSnapshot` can silently display stale prices with a misleading freshness label.

**How to apply:** Any future caller of `getReferenceSnapshotsBulk` must check `snap.freshnessStatus` before trusting `snap.lastPrice`. Never display a stale `lastPrice` as if it were current.
