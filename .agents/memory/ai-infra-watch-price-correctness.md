---
name: AI Infra Watch price correctness
description: Root cause (two-layer) and fix for stale/wrong prices in the Dashboard AI Infrastructure Watch widget. freshnessStatus contract and session-aware freshness.
---

## Root Cause (two-layer defect)

**Layer 1 (original fix):** `getReferenceSnapshotsBulk` called `getHistoricalBars` with
`allowExternalRefresh: false`. `getHistoricalBars` Phase 4 returns stale stored bars with
`freshnessStatus: "stale"`, but `getReferenceSnapshotsBulk` **ignored** `freshnessStatus`
entirely — stale bars flowed into `lastPrice: lastBar.close` with a hardcoded badge.

**Layer 2 (confirmed from live payload — production evidence):**
Even after enabling `allowExternalRefresh: true`, `checkFreshness("2026-08-14","scan")` at
11 PM ET Monday Aug 17 returns **"fresh"** because
`weekdayDistance("2026-08-14","2026-08-17") = 1 ≤ SCAN_STALE_WEEKDAYS(3)`. Phase 2 fires and
swallows Phase 3 entirely — the refresh never runs. AMD showed $514.39, MU showed $971.66,
both with `asOf:"2026-08-14"`, `freshness:"fresh"` — the wrong bar date AND wrong freshness.

**Fix (Layer 2):** Session-aware freshness via `checkSessionFreshness()` and
`mostRecentExpectedTradingSession()`. After 4:30 PM ET on a trading weekday, that day's bar is
"expected"; any bar from an older session is stale. `expectedSessionDate` param in
`getHistoricalBars` gates Phase 2 to require the bar meets the expected session, not just
weekday-distance tolerance.

## Fix Summary

1. `ReferenceSnapshot` interface carries `freshnessStatus`, `latestBarDate`, `sourceType`.
2. `getReferenceSnapshotsBulk`: added `allowExternalRefresh?` (default false), `sessionAware?`
   (default false). When `sessionAware: true`, computes `expectedSessionDate` once for the
   batch and passes it to `getHistoricalBars`; overrides result `freshnessStatus` with
   `checkSessionFreshness()` for defense in depth.
3. `getHistoricalBars`: added `expectedSessionDate?` param. Phase 2 requires
   `latestStored >= expectedSessionDate` (when set) in addition to `storedFreshness === "fresh"`.
4. `ai-infra-watch.ts`: passes `{ allowExternalRefresh: true, sessionAware: true }`.
   Staleness gate: `freshness !== "fresh"` → `last: null`.
5. Dashboard: `AiInfraFreshnessBadge` derives from actual freshness; "—" for stale/unavailable.
6. 92 tests total in `server/services/__tests__/ai-infra-watch.test.ts`
   (66 original + 26 new session-scenario tests §AW-S1–§AW-S8).

## Session-Aware Freshness Functions (new exports in market-history-service.ts)

- `SESSION_POLICY` — `{ MARKET_CLOSE_HOUR_ET: 16, POST_CLOSE_GRACE_MINUTES: 30 }`
- `mostRecentExpectedTradingSession(refDate?, opts?)` — YYYY-MM-DD of most recently EXPECTED
  completed session. After 4:30 PM ET weekday → today; before → previous weekday.
  Uses `Intl.DateTimeFormat("America/New_York")` — handles DST automatically.
- `checkSessionFreshness(barDate, refDate?, opts?)` — "fresh" iff barDate >= expectedSession.

**When to use:** Surfaces displaying canonical daily close (≤10 symbols).
**When NOT to use:** Broad scans (100+ symbols) — use `checkFreshness()` with weekday-distance,
which conservatively absorbs holiday/weekend gaps. Session-aware mode would misclassify a
Monday holiday as "expected Monday bar absent → stale" — the correct scan behavior is to use
the most recent available bar within the weekday threshold.

## Canonical Price Contract

```
price     → AiInfraTicker.last     (null when stale or unavailable)
asOf      → AiInfraTicker.asOf     (YYYY-MM-DD of most recent stored bar)
source    → AiInfraTicker.source   ("stored_daily_bar" always)
freshness → AiInfraTicker.freshness ("fresh" | "stale" | "unavailable")
```

## Refresh Architecture

`getReferenceSnapshotsBulk` accepts `allowExternalRefresh?: boolean` (default false) and
`sessionAware?: boolean` (default false). AI Infra Watch passes both `true`.
Safety stack: `inFlight` Map dedup → credit manager (7/min, 750/day) → `persistValidatedBars`.
Daily ingestion scheduler runs at 7:15 PM ET weekdays (confirmed in logs). `allowExternalRefresh`
is a complementary safety net for pre-scheduler renders, scheduler failures, and non-ingested symbols.

## Key Facts

- Twelve Data client sets `adjustedClose: null` — always null in this path.
- `FRESHNESS_POLICY.SCAN_STALE_WEEKDAYS = 3` — weekday-distance policy.
- `allowExternalRefresh: false` was intentional for large scans; AI Infra Watch (8 symbols) was
  an unintended inheritor.
- Observability: `ai_infra_watch_symbol` events with STORED_FRESH | REFRESH_SUCCESS |
  STALE_FALLBACK_SUPPRESSED | NO_DATA states.

**Why:** Without session-aware freshness, a Friday bar is incorrectly "fresh" on Monday
post-close because weekday distance = 1 ≤ 3. The staleness gate fires only when `freshnessStatus`
is correctly "stale" — so the gate never helped if freshness was misclassified upstream.

**How to apply:** For any small fixed-symbol widget displaying the canonical daily close, use
`getReferenceSnapshotsBulk` with `{ allowExternalRefresh: true, sessionAware: true }`. For
large scans or regime detection, use the default (both false) — weekday distance is intentional.
Any consumer of `ReferenceSnapshot` must check `snap.freshnessStatus` before trusting `snap.lastPrice`.
