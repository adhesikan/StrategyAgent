# Sprint Change Log

## Sprint 2.8.6A-defect-QUOTE_STALE — Quote Timestamp Truthfulness (NVDA UAT)
**Date:** 2026-08-12
**Status:** COMPLETE
**Tests:** 9 suites / 1,001 tests (Sprint 2.8 scope); +39 new quote-freshness tests

### Production Symptom (Railway UAT — TEST_LIVE)
After Defect-8 rev2 allowed execution preflight to be reached, the NVDA preflight showed:

```
[QUOTE_STALE] Underlying quote is stale. Refresh market data before proceeding.
Quote is 0s old.
```

UAT occurred after 16:00 ET. The stale classification was correct (after-hours). The **"0s old"** note was wrong — it implied the quote was freshly fetched, not that the timestamp was missing.

### Root Causes

| # | Cause | Detail |
|---|-------|--------|
| 1 | `getBrokerQuote` missing from broker index | `(broker as any).getBrokerQuote?.()` returned `undefined` → `quote = null` |
| 2 | Fetch-time substituted for missing market timestamp | `asOf: quote?.asOf \|\| new Date().toISOString()` → `freshnessSec ≈ 0` even when quote was null |
| 3 | `isFresh = false` due to null bid/ask | With `quote = null`, `hasBid = false` → `isFresh = false` → QUOTE_STALE blocker |
| 4 | Note displayed `freshnessSec = 0` | `"Quote is 0s old."` — truthfully the timestamp was missing, not that it was 0 seconds old |
| 5 | Invalid date string → NaN not Infinity | `new Date("bad").getTime() = NaN`; `asOfMs != null` was `true` for `NaN` |

### Fix

| File | Change |
|------|--------|
| `server/broker/providers/tradier.ts` | Added `asOf?: string` to `StockQuote`; extracts `trade_date` (ms) or `tradetime` (s) from raw Tradier response |
| `server/broker/providers/tradestation.ts` | Added `asOf?: string` extraction from `TradeTime`/`LastTradedTime`/`LastTradeTime` |
| `server/broker/index.ts` | Added `getBrokerQuote(userId, symbol)` — calls `tradierGetBatchQuotes` / `tsGetBatchQuotes` per provider |
| `server/services/broker-execution-adapter.ts` | Fixed fallback: `asOf: quote?.asOf ?? null` (never `\|\| new Date().toISOString()`); NaN guard on date parse; `asOf` return field is `string \| null` |
| `shared/execution-types.ts` | `BrokerQuoteValidation.asOf` changed to `string \| null`; `freshnessSec` documented as `Infinity` when no timestamp |
| `server/services/execution-preflight-service.ts` | Added `formatPreflightQuoteAge()` helper; `buildQuoteDimension` note uses helper: `Infinity` → "Quote timestamp unavailable.", ≥3600s → "Last market quote is Xh Ym old.", <3600s → "Quote is Xs old." |
| `server/services/__tests__/quote-freshness.test.ts` | 39 new deterministic tests covering §6 A–H from UAT brief plus §I–§P |

### Safety Invariants Preserved
- Stale threshold unchanged (60 s)
- `null` timestamp → `freshnessSec = Infinity` → `isStale = true` → QUOTE_STALE blocker (fail closed)
- `getBrokerQuote` asOf is the market trade timestamp from provider — never substituted with fetch time
- After-hours UAT: correct behavior — last regular-session quote is ~2h old → stale → QUOTE_STALE with "Last market quote is 2h Xm old."
- No order submitted at any step

### After-Hours Behavior
Correct: `tradetime` / `trade_date` from Tradier reflects the actual last trade time (≈16:00 ET). After hours this is hours old → correctly stale. UI now displays "Last market quote is 2h 21m old." instead of the misleading "0s old."

---

## Sprint 2.8.6A-defect-8 rev2 — Execution Preparation Section Always Visible (§10 UX Invariant)
**Date:** 2026-08-12
**Status:** COMPLETE
**Tests:** 26 suites / 1,730 tests

### Production Symptom (Railway UAT — second report)
After the rev1 fix was deployed to Railway, the NVDA Equity Trade Plan still showed **no visible entry point** to execution. Broker was confirmed connected ("Live: Tradier" visible in header), plan status was Research Complete, TEST_LIVE gates were valid. The "Prepare for Execution" button from rev1 was not visible.

### Root Cause (rev2)
The rev1 CTA was gated on `brokerConnected && plan.planType === "EQUITY" && plan.status !== "ARCHIVED"`. `brokerConnected` is derived from `useBrokerStatus().isConnected`, which is `!!status?.isConnected` from `GET /api/broker/status`. The status banner ("Live: Tradier") uses `dataStatus?.isLive` from `GET /api/data-source/status` — a **different endpoint**. Although both ultimately read `connection.isConnected` from the database, they can diverge under:

- A null `isConnected` column value (`!!null === false` silently kills the CTA)
- A context race condition on first render (context returns `isConnected: false` before query resolves; the component renders once and the user sees nothing)
- Any transient `/api/broker/status` network failure while the data-source banner remained cached

**Core UX violation**: when `brokerConnected` is false, the entire Execution Preparation entry point disappeared with **zero explanation** — violating §10 "UI MUST NEVER SILENTLY HIDE REQUIRED WORKFLOW."

### Fix (rev2)

| Change | Description |
|--------|-------------|
| Removed CTA from Plan Header action bar | The previous `brokerConnected`-gated button inside the header action bar is removed. |
| New permanent "Execution Preparation" section | Added between Plan Header and Research Thesis. Renders for **all** `plan.planType === "EQUITY" && plan.status !== "ARCHIVED"` plans — not gated on `brokerConnected` at the section level. |
| BLOCKED state (§10) | When `!brokerConnected`: the section renders a yellow BLOCKED card: `data-testid="execution-preparation-blocked"`. Text: "Connect a broker account to run execution preflight…". Never silently hidden. |
| CTA renamed | Button text changed from "Prepare for Execution" to **"Check Execution Preconditions"** (§14 DOM requirement). aria-label matches. |
| Broker-connected path | When `brokerConnected`: the section renders description text + "Check Execution Preconditions" button → `setShowExecution` → scrolls to `#execution-workflow-section`. |
| Execution workflow section | Unchanged (`showExecution && brokerConnected && id` gate). All 4 steps preserved. |
| TEST_LIVE gate unchanged | Submission gate only — does not suppress the Execution Preparation section or preflight. |

### §10 UX Invariant (permanent rule)
The "Execution Preparation" section must always be visible for eligible EQUITY non-ARCHIVED plans. If execution is unavailable for any reason, the section renders a BLOCKED state with a human-readable explanation. **It must never silently disappear.**

### Exact UI Flow After Fix
1. User opens `/trade-plans/:id` for any EQUITY non-ARCHIVED plan
2. **"Execution Preparation" section** is always visible — with broker disconnected it shows BLOCKED state with reason
3. When broker is connected: "Check Execution Preconditions" button appears
4. Click → `showExecution = true` → page scrolls to execution workflow section
5. **Step 1: Execution Preflight** renders (Sprint 2.8.0)
6. Preflight PASS → **Step 2: Order Preparation** (Sprint 2.8.1)
7. Draft created → **Step 3: Equity Order Preview** (Sprint 2.8.2) — preview-only
8. **Step 4: Final Order Review** (Sprint 2.8.5) — acknowledgements + confirmation toast
9. Sprint 2.8.6 broker submission remains separate via `POST /api/executions/from-confirmation/:cid`

### Safety Invariants Verified (unchanged from rev1)
- ✅ AI cannot initiate execution (`setShowExecution` absent from all other client pages, §VD7c)
- ✅ No automatic submission (user must click CTA then complete all 4 steps)
- ✅ Preflight must PASS before Order Preparation renders
- ✅ Equity Preview is preview-only — no broker call in route
- ✅ TEST_LIVE gates fail-closed (EI_MARKET_ORDER_BANNED_IN_TEST_LIVE)
- ✅ TEST_LIVE allowlist is a submission gate, NOT a display gate (§EP20d, §VD7b)

### Files Changed
- `client/src/pages/trade-plan-detail.tsx` — new permanent Execution Preparation section; CTA removed from header; BLOCKED state added; CardDescription imported
- `server/routes/__tests__/execution-entry-point.test.ts` — §EP1–§EP4 updated for new structure; §VD1–§VD10 added (14 new test cases)
- `docs/operations/17-sprint-change-log.md` — this entry
- `docs/operations/45-test-live-execution-certification.md` — §8D updated with rev2 UAT protocol
- `docs/operations/33-trade-plan-workspace.md` — Defect-8 rev2 history

### Test Results
26 suites / 1,730 tests passing. TypeScript clean. READY_FOR_RAILWAY_REDEPLOY.

---

## Sprint 2.8.6A-defect-10c — Preflight ignores research review acknowledgement
**Date:** 2026-08-14
**Status:** COMPLETE
**Tests:** 29 suites / 1,906 tests

### Production Symptom
After a user successfully reviewed their NVDA Trade Plan (lifecycle UI showed "Research Current"), clicking "Check Execution Preconditions" returned:

```
Research Lifecycle: REQUIRES_REVIEW
Plan Freshness: REQUIRES_REVIEW
blocker: [PLAN_REQUIRES_REVIEW]
```

### Root Cause

`getLifecycleResult()` in `createDbPreflightDeps()` read from `tradePlanActivity` (an event-log table) rather than calling `evaluateTradePlanLifecycle()` — the authoritative function used by the lifecycle UI endpoint. Two independent bugs:

**Bug 1 — Wrong data source:** `tradePlanActivity` stores activity events; `lastReviewedAt` (set by the review acknowledgement) lives in `trade_plans`. The activity log never surfaces the review window computation.

**Bug 2 — Wrong sort order:** The query used `.orderBy(tradePlanActivity.observedAt)` (ascending) with `.limit(1)` — returning the **oldest** activity row, not the current state.

Result: the preflight and the lifecycle UI used completely independent data sources and could never agree.

### Fix

`server/services/execution-preflight-service.ts` — `createDbPreflightDeps.getLifecycleResult()`:

```typescript
// BEFORE (broken):
const rows = await db.select().from(tradePlanActivity)
  .where(and(eq(tradePlanActivity.tradePlanId, planId), ...))
  .orderBy(tradePlanActivity.observedAt)   // ← ascending (oldest first)
  .limit(1);
return { lifecycleState: rows[0].currentState ?? "UNKNOWN" };

// AFTER (fixed):
const { evaluateTradePlanLifecycle } = await import("./trade-plan-lifecycle-service");
const result = await evaluateTradePlanLifecycle(userId, planId);
return { planId, lifecycleState: result.lifecycleState, evaluatedAt: ... };
```

`evaluateTradePlanLifecycle()` reads `lastReviewedAt` from `trade_plans`, applies the 7-day review window in `computeLifecycleState()`, and is backed by an in-process cache — so if the lifecycle was recently evaluated (e.g. from the UI), the cache hit is free.

### Invariants Preserved
- ✅ `THESIS_INVALIDATED` → FAIL regardless of review (cannot be cleared by acknowledgement)
- ✅ `DATA_STALE` → FAIL regardless of review
- ✅ `QUALIFICATION_LOST` (symbolNotQualified) → REQUIRES_REVIEW regardless of review
- ✅ `UNKNOWN` → FAIL (system error — not a review event)
- ✅ Null lifecycle result → UNAVAILABLE (no crash)
- ✅ Review window expiry (> 7 days) → REQUIRES_REVIEW again

### New Test File
`server/routes/__tests__/preflight-lifecycle-consistency.test.ts` — 55 tests (§PLC1–§PLC15 + bonus)

### Files Changed
- `server/services/execution-preflight-service.ts` — `createDbPreflightDeps.getLifecycleResult` (one function replaced)
- `server/routes/__tests__/preflight-lifecycle-consistency.test.ts` — 55 new tests

---

## Sprint 2.8.6A-defect-10c-prod — Preflight still blocks after review (production follow-up)
**Date:** 2026-08-16
**Status:** COMPLETE
**Tests:** 30 suites / 1,955 tests (24 new integration tests + 3 test updates)

### Production Symptom
After the Defect-10c server fix was deployed, production UAT still showed:
```
Research Lifecycle: REQUIRES_REVIEW
Plan Freshness: REQUIRES_REVIEW
blocker: [PLAN_REQUIRES_REVIEW]
```
even when the lifecycle UI showed "Research Current" (review was persisted).

### Root Cause Analysis — Three Independent Issues

**Issue 1 (primary — data display):** The review success handler in `trade-plan-detail.tsx` invalidated query key `["/api/trade-plans", id, "execution", "preflight"]` but the `ExecutionPreflightPanel` registers under `["execution-preflight", tradePlanId]` — a complete mismatch. After a review, the panel kept displaying the OLD STORED preflight result (from before the review), which had:
- `lifecycleState = "REQUIRES_REVIEW"` (computed pre-review)
- `evaluatedAt = T_old` (2+ hours ago → Plan Freshness also fails)

**Issue 2 (server — evaluation cache):** `getLifecycleResult` in preflight called `evaluateTradePlanLifecycle` without `force: true`, so it could hit an in-process lifecycle cache entry that pre-dated the review. Fixed to always use `force: true` — preflight is an explicit user action and must always compute authoritative state.

**Issue 3 (semantic — review validity):** The 7-day time window compared `lastReviewedAt` against `Date.now()`. The correct semantic is: review is valid until *new research data* arrives. Using `lastReviewedAt >= researchDataTimestamp` (currentSummary.asOf) means re-running lifecycle evaluation against the **same** OppIntel snapshot never expires the review. The 7-day window remains as a fallback when no research data timestamp is available.

### Fixes

**`server/services/trade-plan-lifecycle-service.ts` — `computeLifecycleState`:**
- Added `researchDataTimestamp?: Date | null` parameter (currentSummary.asOf)
- Primary check: `lastReviewedAt >= researchDataTimestamp` → CURRENT
- Fallback: 7-day wall-clock window (when no timestamp available)
- Diagnostic logging when material changes exist (logs planId, lastReviewedAt, researchDataTimestamp, reviewCoversData, lifecycleState)

**`server/services/execution-preflight-service.ts` — `getLifecycleResult`:**
- Added `{ force: true }` to `evaluateTradePlanLifecycle` call — always fresh, never stale cache
- Added diagnostic logging: `[preflight:lifecycle-diagnostic]` with state, evaluatedAt, reviewReasonsCount

**`server/routes/trade-plans.ts` — `POST .../lifecycle/review`:**
- Added step 6: delete stored preflight rows from `execution_preflights` for this plan/user after review — forces the panel GET to return 404, so the user must re-run preflight against fresh state

**`client/src/pages/trade-plan-detail.tsx` — `handleMarkReviewed`:**
- Fixed query key to `["execution-preflight", id]` (matching the panel's actual key)
- Also invalidates the legacy key shape for belt-and-suspenders

### New Test File
`server/routes/__tests__/preflight-review-lifecycle-integration.test.ts` — 24 pure-computation tests covering:
- §PRLCI-1: Full review sequence (pre-review REQUIRES_REVIEW → review → CURRENT → new data → REQUIRES_REVIEW)
- §PRLCI-2: Preflight integration sequence (4-step UAT scenario)
- §PRLCI-3: Plan Freshness passes with recent evaluatedAt, fails with 3h-old evaluatedAt
- §PRLCI-4: researchDataTimestamp validity semantics (boundary conditions)
- §PRLCI-5: Non-clearable states (THESIS_INVALIDATED, DATA_STALE, QUALIFICATION_LOST) unaffected
- §PRLCI-6: No material changes → always CURRENT

### Test Updates
- `preflight-lifecycle-consistency.test.ts`: Updated "6 days ago" test to use data-anchored `researchDataTimestamp` (fixed pre-existing clock-drift failure — `daysAgo()` uses a fixed NOW constant but `Date.now()` in the window check uses real time)
- `trade-plan-lifecycle-review.test.ts`: Updated two source-inspection tests to search for `if (lastReviewedAt)` (function body) instead of `lastReviewedAt` (which now also appears in the parameter JSDoc)

### Invariants Preserved
- ✅ `THESIS_INVALIDATED` → FAIL regardless of review
- ✅ `DATA_STALE` → FAIL regardless of review
- ✅ `QUALIFICATION_LOST` → REQUIRES_REVIEW regardless of review
- ✅ Second preflight run after review (no new change) → same PASS result
- ✅ New OppIntel data after review (researchDataTimestamp > lastReviewedAt) → REQUIRES_REVIEW (user re-reviews latest data)
- ✅ No researchDataTimestamp available → falls back to 7-day window (backwards compatible)

### Files Changed
- `server/services/trade-plan-lifecycle-service.ts` — `computeLifecycleState`: added `researchDataTimestamp` param + diagnostic logging
- `server/services/execution-preflight-service.ts` — `getLifecycleResult`: `force: true` + diagnostic logging
- `server/routes/trade-plans.ts` — review route: delete stored preflight on review
- `client/src/pages/trade-plan-detail.tsx` — `handleMarkReviewed`: fix query key invalidation
- `server/routes/__tests__/preflight-review-lifecycle-integration.test.ts` — 24 new tests
- `server/routes/__tests__/preflight-lifecycle-consistency.test.ts` — 1 test updated (clock-drift fix)
- `server/routes/__tests__/trade-plan-lifecycle-review.test.ts` — 2 tests updated (source-inspection anchor)

---

## Sprint 2.8.6A-defect-10b — Trade Plans List 500: schema drift (last_reviewed_at missing)
**Date:** 2026-08-13
**Status:** COMPLETE
**Tests:** 28 suites / 1,851 tests

### Production Symptom
After deploying the Defect-9 lifecycle-review fix, production returned HTTP 500 on `GET /api/trade-plans`:

```
[trade-plans] list failed: Failed query:
  select ... "last_reviewed_at" from "trade_plans" ...
```

**Exact PostgreSQL error (reproduced locally):** `column "last_reviewed_at" does not exist` (SQLSTATE 42703 — undefined_column)

### Root Cause

**R1 — Deployment contract mismatch: Drizzle schema vs `ensureTradePlanTables()`**

The project has two parallel schema paths:
1. `shared/schema.ts` (Drizzle ORM) — source of truth for query types; updated when columns are added
2. `ensureTradePlanTables()` in `trade-plan-service.ts` — the canonical idempotent table creator; Railway startup applies this; standalone `.sql` migration files in `server/migrations/` are NOT auto-executed on Railway

When `lastReviewedAt` was added to the Drizzle schema (Sprint 2.8.6A Defect-9), only the standalone `add-trade-plan-last-reviewed-at.sql` migration was created. The `ensureTradePlanTables()` `ALTER TABLE` block for `trade_plans` was never updated. On Railway, `ensureTradePlanTables()` ran but did not add the column → Drizzle queried a missing column → 500.

**R2 — No schema contract test**
No test existed to assert that every column in the Drizzle schema for `trade_plans` is covered by `ensureTradePlanTables()`. The gap was invisible until production.

### Column Gap Audit (`trade_plans`)

| Column | CREATE TABLE (original) | ensureTradePlanTables ALTER | Drizzle schema | Production before fix |
|---|---|---|---|---|
| `broad_expression_type` | ❌ | ✅ (sessions ALTER only — was already in prod via prior migration) | ✅ | ✅ already present |
| `expression_selected_by` | ❌ | ✅ (sessions ALTER only) | ✅ | ✅ already present |
| `expression_selected_at` | ❌ | ✅ (sessions ALTER only) | ✅ | ✅ already present |
| **`last_reviewed_at`** | ❌ | ❌ **MISSING** | ✅ | ❌ **MISSING — caused 500** |

### Fix

**`server/services/trade-plan-service.ts`** — `ensureTradePlanTables()`:
Added an `ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS` block immediately after `CREATE TABLE IF NOT EXISTS trade_plans`, covering all 4 post-Sprint-2.7.5 columns:
```sql
ALTER TABLE trade_plans
  ADD COLUMN IF NOT EXISTS broad_expression_type   TEXT,
  ADD COLUMN IF NOT EXISTS expression_selected_by  TEXT,
  ADD COLUMN IF NOT EXISTS expression_selected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reviewed_at        TIMESTAMPTZ
```
Each column:
- Uses `ADD COLUMN IF NOT EXISTS` — safe to run on fresh tables (no-op) and existing tables (adds column without touching data)
- `last_reviewed_at`: `TIMESTAMPTZ`, nullable, no default — existing plans that have never been reviewed remain `NULL`
- Accompanied by a comment documenting column history, sprint attribution, and the Railway deployment contract

**`server/services/__tests__/trade-plan-schema-contract.test.ts`** — 42 new deterministic source-inspection tests:
- §SC1–§SC10: schema contract assertions (every newer column in Drizzle has a matching `ADD COLUMN IF NOT EXISTS` in `ensureTradePlanTables`)
- §MIG1–§MIG6: migration file safety (idempotency, no DROP/TRUNCATE/DELETE, verification DO block)
- Bonus: client null-safety for `lastReviewedAt` and `symbolQualificationStatus`

### Safety Invariants
- ✅ `ADD COLUMN IF NOT EXISTS` — idempotent; running twice does not error or modify data
- ✅ Existing plans retain all data; `last_reviewed_at = NULL` for never-reviewed plans
- ✅ Client review panel already handles `lastReviewedAt = null` gracefully (optional chaining)
- ✅ `computeLifecycleState` accepts `lastReviewedAt?: Date | null` (optional parameter)
- ✅ No destructive operations; no data loss

### Files Changed
- `server/services/trade-plan-service.ts` — `ensureTradePlanTables()` ALTER block for `trade_plans` (4 columns)
- `server/services/__tests__/trade-plan-schema-contract.test.ts` — 42 new schema contract tests
- `docs/operations/17-sprint-change-log.md` — this entry

### Test Results
28 suites / 1,851 tests passing. READY_FOR_RAILWAY_REDEPLOY.

### Deployment Notes
On the next Railway redeploy:
1. `ensureTradePlanTables()` runs at startup — adds `last_reviewed_at` (and idempotently re-applies the other 3 columns)
2. `GET /api/trade-plans` returns 200; existing NVDA plan appears
3. `GET /api/trade-plans/:id` returns 200; plan data intact (same ID, symbol, snapshots, status)
4. `lastReviewedAt` is `NULL` for all existing plans — no fake timestamps backfilled
5. Lifecycle review workflow works: explicit "Mark Research Reviewed" populates `lastReviewedAt`

### Prevention
The new `trade-plan-schema-contract.test.ts` will catch any future column added to the Drizzle schema without a corresponding `ADD COLUMN IF NOT EXISTS` in `ensureTradePlanTables()`. Update `NEWER_COLUMNS` in that file whenever a new column is added to `trade_plans`.

---

## Sprint 2.8.6A-defect-10 — Lifecycle Qualification Loss (symbol drops from OppIntel)
**Date:** 2026-08-13
**Status:** COMPLETE
**Tests:** 28 suites / 1,818 tests

### Production Symptom (Railway UAT)
NVDA dropped out of the latest Opportunity Intelligence qualified-candidate snapshot. Two downstream failures observed:

**Failure 1 — "Research Not Available":** Clicking "Open Research Workspace" from the NVDA Trade Plan showed:
> "NVDA — Research Not Available. This symbol is not present in the latest Opportunity Intelligence snapshot."

Expected: historical saved research remains accessible; current status clearly labeled "No Longer Qualified."

**Failure 2 — "Trade plan not found" (pre-Defect-9 path):** A separate navigation path showed "Trade plan not found." because the route depended on the symbol existing in the current OppIntel snapshot.

**Failure 3 — Lifecycle UNKNOWN instead of REQUIRES_REVIEW:** When `getCanonicalOpportunity()` returned `null` (symbol not in OppIntel), `computeLifecycleState` returned `UNKNOWN` (generic error) instead of a meaningful `REQUIRES_REVIEW` with `QUALIFICATION_LOST` reason. Preflight blocked with `UNKNOWN_CRITICAL_STATE` ("Lifecycle state is unknown. Re-evaluate…") — not helpful to the user.

### Root Causes

**R1 — No distinction between "symbol dropped from OppIntel" and "OppIntel system error"**
`getCanonicalOpportunity()` returning `null` (intentional exclusion) was treated identically to throwing an exception (transient system error). Both led to `currentAvailable = false` → `computeLifecycleState` returned `UNKNOWN`.

**R2 — `QUALIFICATION_LOST` review reason type was never wired**
`QUALIFICATION_LOST` exists in `REVIEW_REASON_TYPES` since Sprint 2.7.6 but `computeReviewReasons()` never emitted it. The reason was designed for exactly this case.

**R3 — Review acknowledgement incorrectly designed to clear qualification loss**
`lastReviewedAt` window cleared ANY `REQUIRES_REVIEW` including for unqualified symbols. After Defect-10, it only clears score-based `REQUIRES_REVIEW` — qualification loss requires the symbol to re-qualify in OppIntel, not just a user acknowledgement.

**R4 — `TradePlanLifecycleResult` had no `symbolQualificationStatus` field**
Clients and preflight could not distinguish "symbol specifically dropped" from "data temporarily unavailable."

### Core Domain Rule (now enforced)
There are three distinct objects:
1. **Saved Trade Plan** — persistent user-owned record; survives symbol leaving OppIntel
2. **Research Snapshot at Creation** — immutable historical evidence; remains viewable
3. **Current Opportunity Intelligence State** — dynamic; symbol may be qualified, changed, removed, or unavailable

These must never be conflated. A Trade Plan is NOT invalidated or made inaccessible when its symbol drops from the current OppIntel qualified-candidate list.

### Fix

**Lifecycle Engine** (`server/services/trade-plan-lifecycle-service.ts`)

New distinction in `evaluateTradePlanLifecycle`:
```
null returned from getCanonicalOpportunity (no exception)
  → symbolNotQualified = true
  → symbolQualificationStatus = "NOT_QUALIFIED"
  → lifecycle = REQUIRES_REVIEW  (reason: QUALIFICATION_LOST)
  → review acknowledgement does NOT clear this

exception thrown from getCanonicalOpportunity
  → opportunityFetchError = true
  → symbolQualificationStatus = "UNKNOWN"
  → lifecycle = UNKNOWN (system error — unchanged)
```

`computeLifecycleState()` changes:
- New `symbolNotQualified?: boolean` parameter
- `symbolNotQualified = true` → returns `REQUIRES_REVIEW` immediately (before `UNKNOWN` early-return and before `DATA_STALE` check)
- `lastReviewedAt` window only clears score-based `REQUIRES_REVIEW`; `symbolNotQualified = true` routes to `REQUIRES_REVIEW` before the `lastReviewedAt` branch

`computeReviewReasons()` changes:
- New `symbolNotQualified?: boolean` parameter
- When `symbolNotQualified = true` → emits `QUALIFICATION_LOST` as the first (and only) reason, then returns early to prevent spurious `CRITICAL_DATA_STALE` from freshnessChanges

Limitations text:
- `symbolNotQualified = true` → `"${symbol} is not present in the latest qualified-candidate snapshot. Historical saved research is available. Current comparison data is unavailable."`
- System error → `"Current research data is temporarily unavailable for this symbol."` (distinct wording)

**Shared Types** (`shared/trade-plan-lifecycle-types.ts`)
- Added `SymbolQualificationStatus = "QUALIFIED" | "NOT_QUALIFIED" | "UNKNOWN"` type
- Added `symbolQualificationStatus: SymbolQualificationStatus` to `TradePlanLifecycleResult`

**Client UI** (`client/src/pages/trade-plan-detail.tsx`)
- Derived `isNotQualified = lifecycle?.symbolQualificationStatus === "NOT_QUALIFIED"`
- REQUIRES_REVIEW panel header: `"${symbol} — No Longer Qualified"` when `isNotQualified` (vs generic "Research Review Required")
- Added explicit paragraph: `"${plan.symbol} no longer qualifies in the latest Opportunity Intelligence snapshot. Review the original research thesis against current conditions before continuing."`
- Review panel ("Review Saved Research" / "Review Current Research" button toggle) now has two modes:
  - **NOT_QUALIFIED**: shows "Research at Plan Creation" saved scores + "Current Opportunity Status: No Longer Qualified" card with limitation text
  - **Score-based**: shows Saved vs Now score comparison (existing behavior)
- Acknowledgement disclaimer for NOT_QUALIFIED: `"Acknowledging this review records your awareness of current conditions. It does not restore qualification or make the plan executable."` (compliant language — no buy/sell advice)
- "Open Research Workspace" always routes to `/research-workspace?symbol=${symbol}` (AI Research Workspace, works without OppIntel)

**Tests** (`server/services/__tests__/lifecycle-qualification-state.test.ts`)
- 51 new deterministic tests covering spec cases A–I plus §QS1–§QS15

### Safety Invariants
- ✅ Symbol dropping from OppIntel NEVER deletes or archives the Trade Plan
- ✅ Historical saved research (savedResearchSummary) always accessible
- ✅ REQUIRES_REVIEW (QUALIFICATION_LOST) is NOT clearable by `lastReviewedAt` review window
- ✅ User can acknowledge the review — but preflight continues to block (lifecycle remains REQUIRES_REVIEW)
- ✅ "No Longer Qualified" language — no buy/sell/exit instructions
- ✅ System error (OppIntel down) → UNKNOWN (distinct from qualification loss → REQUIRES_REVIEW)
- ✅ Plan ownership enforced; plan DB query does NOT join on OppIntel tables

### Files Changed
- `shared/trade-plan-lifecycle-types.ts` — `SymbolQualificationStatus` type; `symbolQualificationStatus` field on `TradePlanLifecycleResult`
- `server/services/trade-plan-lifecycle-service.ts` — `computeLifecycleState` with `symbolNotQualified`; `computeReviewReasons` with early-return for qualification loss; `evaluateTradePlanLifecycle` tracking `symbolNotQualified` vs `opportunityFetchError`; `symbolQualificationStatus` in result; limitations text
- `client/src/pages/trade-plan-detail.tsx` — `isNotQualified` derived state; review panel two-mode display; "No Longer Qualified" language; acknowledgement disclaimer
- `server/services/__tests__/lifecycle-qualification-state.test.ts` — 51 new tests (spec A–I + §QS1–§QS15)
- `docs/operations/17-sprint-change-log.md` — this entry

### Test Results
28 suites / 1,818 tests passing. READY_FOR_RAILWAY_REDEPLOY.

### Production Verification Steps
1. Using the existing saved NVDA Trade Plan:
   - Navigate Trade Plans → NVDA → Open: plan opens (never "Trade plan not found")
   - Lifecycle panel: shows "NVDA — No Longer Qualified" in orange (REQUIRES_REVIEW)
   - Lifecycle reason: "This symbol no longer qualifies in the latest Opportunity Intelligence snapshot"
   - Click "Open Research Workspace": opens `/research-workspace?symbol=NVDA` (AI Workspace — no NOT_FOUND)
   - Click "Review Saved Research" → panel opens showing "Research at Plan Creation" saved scores + "No Longer Qualified" current status
   - Click "Mark Research Reviewed": review recorded; lifecycle re-evaluated — still REQUIRES_REVIEW (not CURRENT)
   - Run preflight: Research Lifecycle = REQUIRES_REVIEW → PLAN_REQUIRES_REVIEW blocker (execution blocked)
2. No historical snapshot overwritten. No fake current NVDA candidate created.

---

## Sprint 2.8.6A-defect-9 — Lifecycle Review Dead-End / Broken Research Link
**Date:** 2026-08-13
**Status:** COMPLETE
**Tests:** 27 suites / 1,767 tests

### Production Symptom (Railway UAT)
NVDA trade plan showed `PLAN_REQUIRES_REVIEW`. The lifecycle panel offered "Open Research Workspace" and "Review Research." Clicking "Open Research Workspace" returned `{"error":{"code":"NOT_FOUND","message":"Research record not found"}}`. "Review Research" navigated to `/opportunities/NVDA` which is unrelated. No mechanism existed to acknowledge the review and clear the REQUIRES_REVIEW state — TEST_LIVE was therefore blocked on the lifecycle review workflow.

### Root Causes

**R1 — Broken navigation route (link to wrong page)**
Both "Open Research Workspace" buttons (THESIS_INVALIDATED banner and REQUIRES_REVIEW block) navigated to `/research/${plan.symbol}` → `ResearchDetailPage` which expects a Sprint 5.4D research-record UUID, not a symbol ticker. `"NVDA"` is not a valid UUID → `NOT_FOUND`.

**R2 — No review acknowledgement mechanism**
`REQUIRES_REVIEW` was only cleared by underlying data changes (score delta < 5). No `lastReviewedAt` field, no `RESEARCH_REVIEWED` activity type, no review endpoint. The user could not explicitly accept current conditions to unblock execution.

**R3 — "Review Research" CTA had no lifecycle effect**
The button navigated to `/opportunities/${plan.symbol}` — page navigation alone never triggered any server-side lifecycle update.

### Fix

**Schema** (`shared/schema.ts`)
- Added `lastReviewedAt` nullable timestamp column (`last_reviewed_at`) to `tradePlans` table

**Lifecycle Engine** (`server/services/trade-plan-lifecycle-service.ts`)
- Added `REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS = 7` constant
- `computeLifecycleState()` accepts new optional `lastReviewedAt?: Date | null` param
- If lifecycle would be `REQUIRES_REVIEW` but `lastReviewedAt` is set and ≤ 7 days old → returns `"CURRENT"` (user explicitly acknowledged)
- `THESIS_INVALIDATED` and `DATA_STALE` always take priority — cannot be cleared by review
- `evaluateTradePlanLifecycle` reads `lastReviewedAt` from plan row and passes it through

**Review Endpoint** (`server/routes/trade-plans.ts`)
- Added `POST /api/trade-plans/:id/lifecycle/review` (placed before `/lifecycle/evaluate`, which is the deeper static route)
- Validates plan ownership: cross-user → 404 (not 403, to prevent ID enumeration)
- Sets `lastReviewedAt = now` in DB
- Records `RESEARCH_REVIEWED` activity event
- Forces lifecycle re-evaluation with `force: true`
- Returns `{ reviewedAt, lifecycleResult, newActivities, durationMs }`

**Activity Types** (`shared/trade-plan-lifecycle-types.ts`)
- Added `"RESEARCH_REVIEWED"` to `ACTIVITY_EVENT_TYPES`, `ACTIVITY_EVENT_LABELS` (`"Research Reviewed"`), `ACTIVITY_CATEGORY_MAP` (`"user_action"`)

**Client UI** (`client/src/pages/trade-plan-detail.tsx`)
- Fixed both "Open Research Workspace" links: `/research/${plan.symbol}` → `/research-workspace?symbol=${plan.symbol}` (canonical AI Research Workspace route)
- Added `isReviewing` / `reviewPanelOpen` state; `handleMarkReviewed()` function
- "Review Research" replaced by "Review Current Research" toggle button that opens an inline panel
- Inline panel: score comparison (Saved vs Now for Research/Technical/Fundamental/Institutional), review reasons list, compliance note, "Mark Research Reviewed" button
- "Mark Research Reviewed" POSTs to `/lifecycle/review`, invalidates preflight cache, and collapses panel on success
- Opening the workspace alone does NOT record a review — explicit button click required (§6 invariant)

**Tests** (`server/routes/__tests__/trade-plan-lifecycle-review.test.ts`)
- 37 new deterministic tests (§RR1–§RR20) covering: computeLifecycleState with lastReviewedAt, window boundary precision, priority ordering (THESIS_INVALIDATED > DATA_STALE > review), broken-link regression, activity type/label/category, schema column, service signature, route contract

### Safety Invariants
- ✅ Opening Research Workspace does NOT auto-clear REQUIRES_REVIEW
- ✅ THESIS_INVALIDATED cannot be cleared by user review
- ✅ DATA_STALE cannot be cleared by user review
- ✅ Review window expires after 7 days — user must review again if scores still diverge
- ✅ Only plan owner can acknowledge (userId guard → 404 on mismatch)
- ✅ No broker order at any step

### Files Changed
- `shared/schema.ts` — `lastReviewedAt` column in `tradePlans`
- `shared/trade-plan-lifecycle-types.ts` — `RESEARCH_REVIEWED` activity type/label/category
- `server/services/trade-plan-lifecycle-service.ts` — `computeLifecycleState` review param; `evaluateTradePlanLifecycle` wired
- `server/routes/trade-plans.ts` — `POST /api/trade-plans/:id/lifecycle/review`
- `client/src/pages/trade-plan-detail.tsx` — route fix + review panel
- `server/routes/__tests__/trade-plan-lifecycle-review.test.ts` — 37 new tests
- `docs/operations/17-sprint-change-log.md` — this entry

### Test Results
27 suites / 1,767 tests passing. READY_FOR_RAILWAY_REDEPLOY.

---

## Sprint 2.8.6A-defect-8 rev1 — Restore End-to-End Manual Execution Entry Point (initial fix — superseded)
**Date:** 2026-08-12
**Status:** SUPERSEDED by rev2

### Root Cause (rev1)
Two problems: (1) `ExecutionPreflightPanel` and `OrderPreparationPanel` were silently rendered at bottom of page with no CTA. (2) `EquityOrderPreviewPanel` and `FinalOrderReviewPanel` absent from `trade-plan-detail.tsx` entirely.

### Fix (rev1)
Added "Prepare for Execution" CTA gated on `brokerConnected && plan.planType === "EQUITY" && plan.status !== "ARCHIVED"`. Added missing downstream panels. 26 suites / 1,716 tests.

### Why superseded
The `brokerConnected` gate at the section level caused silent absence in production — see rev2 above for root cause and permanent fix.

---

## Sprint 2.8.6A-defect-7 — Trade Plan Detail React Hook Ordering Failure
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 25 suites / 1,678 tests

### Production Symptom (Railway UAT)
Navigating to a Trade Plan Detail page (`/trade-plans/:id`) for the NVDA equity plan crashed the page with **Minified React error #310** — "Rendered more hooks than expected." The error boundary displayed "Something went wrong rendering this page." Execution Preflight was unreachable.

### Decoded React Error #310
Full error: `React Hook "useState" is called conditionally. React Hooks must be called in the exact same order in every component render. Did you accidentally call a React Hook after an early return?`

| Field | Value |
|-------|-------|
| Error code | #310 — Rendered more hooks than expected |
| Component | `TradePlanDetailPage` |
| Source file | `client/src/pages/trade-plan-detail.tsx` |
| Offending hooks | `useState("all")`, `useState(false)`, `useBrokerStatus()`, `useQuery(preflight)`, `useQuery(lifecycle)`, `useQuery(activity)` — 6 hooks total |
| Why hook count changed | Render 1 (loading): 12 hooks run → early return at line 223. Render 2 (plan loaded): 18 hooks run → no early return. React detected hook count mismatch. |

### Root Cause
During Sprint 2.7.6 (Lifecycle Intelligence), 2 `useState` hooks and `useBrokerStatus()` were added below the `if (isLoading) return` and `if (error || !plan) return` guards. During Sprint 2.8.0/2.8.1, 3 `useQuery` hooks (preflight, lifecycle, activity) were also placed below the guards. React's rules of hooks require every hook to execute on every render in the same order. An early return before a hook causes the hook count to vary.

### Fix
Moved all 6 offending hook declarations (plus `handleRefreshLifecycle`, which depends on them) to **before** the `if (isLoading)` guard at line 207 of `trade-plan-detail.tsx`. No logic changes — the queries already had `enabled: !!id && !!plan` which correctly prevents requests during loading. Derived variable assignments (`lifecycle`, `lifecycleState`, `isReviewRequired`, `isInvalidated`, `isDataStale`) are not hooks and remain after the guards.

#### Final hook order (all 18 hooks before any early return)
1. `useLocation()` — navigation
2. `useToast()` — toasts
3. `useQueryClient()` — query invalidation
4. `useState("")` — notes
5. `useState({...})` — checklist
6. `useState(false)` — notesInitialized
7. `useQuery(plan)` — main plan fetch
8. `useEffect(...)` — initialize local state from plan
9. `useQuery(changes)` — changes comparison
10. `useMutation(update)` — plan update
11. `useMutation(archive)` — plan archive
12. `useMutation(duplicate)` — plan duplicate
13. ✅ **`useState("all")`** — activityCategory (was after guard)
14. ✅ **`useState(false)`** — isEvaluating (was after guard)
15. ✅ **`useBrokerStatus()`** — brokerConnected (was after guard)
16. ✅ **`useQuery(preflight)`** — enabled: !!id && !!plan && brokerConnected (was after guard)
17. ✅ **`useQuery(lifecycle)`** — enabled: !!id && !!plan (was after guard)
18. ✅ **`useQuery(activity)`** — enabled: !!id && !!plan (was after guard)

### Regression Tests
`server/routes/__tests__/trade-plan-detail-hook-order.test.ts` — §HK1–§HK25 (37 tests):
- §HK1–§HK3: hooks before early returns, no hook after isLoading, no hook after error guard
- §HK4: no conditional hook by plan type
- §HK5–§HK11: all 6 previously misplaced hooks are now before early returns
- §HK12–§HK17: execution child components have no top-level conditional hooks
- §HK18: broker mutation count = 0
- §HK19–§HK22: queries use `enabled` guard, not conditional calls
- §HK23–§HK25: handleRefreshLifecycle is a function; no if-gated hook patterns

### Results
- NVDA Trade Plan Detail: ✅ renders without React #310
- Loading → loaded render: ✅ stable hook count (18 hooks both renders)
- Equity plan: ✅
- Null/optional data (goalId=null, portfolioId=null, no preflight): ✅
- Execution Preflight visible: ✅ (after plan loads)
- Execution gates unchanged: ✅
- Broker mutations: 0
- TEST_LIVE settings: unchanged

**Test results**: 25 suites / 1,678 tests passing. Build clean. Production bundle: `/trade-plans` → `ROUTE_STATUS=200`, `PROCESS_ALIVE=true`.

---

## Sprint 2.8.6A-defect-6B — POST /session Process-Crash (Railway UAT)
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 24 suites / 1,641 tests

### Production Symptom (Railway UAT)
`POST /api/trade-planning/session` with exact WMT payload `{ symbol:"WMT", constraints:{equityAllowed:true,optionsAllowed:false}, goalId:null, portfolioId:null }` returned **HTTP 502** and immediately crashed the Railway Node.js process. Subsequent healthy requests (`GET /api/broker/ping`) also 502'd until Railway auto-restarted. Crash occurred ~60–70ms after the request hit the handler. Production bundle log showed `/app/dist/index.cjs:71` (minified — insufficient for diagnosis).

### Root Causes (three layers)

1. **Missing table on Railway** — `trade_planning_sessions` was only ever created by `migrations/028_trade_planning_sessions.sql`, a file that is **never executed automatically**. `ensureTradePlanTables()` (which runs on every startup and logs `trade_plan_tables_ready`) only created `trade_plans` and `trade_plan_versions`. Any fresh Railway deployment has no `trade_planning_sessions` table; the INSERT throws `relation "trade_planning_sessions" does not exist`.

2. **No try/catch in the POST handler** — The `createPlanningSession` call in the `POST /api/trade-planning/session` handler (line 194–228 of `server/routes/trade-planning.ts`) had no try/catch. In Express 4 + Node.js 15+, an unhandled async rejection terminates the process. There was no global `unhandledRejection` handler to keep the process alive.

3. **No global process survival handler** — `server/index.ts` had no `process.on("unhandledRejection", ...)` handler, so any floating async rejection anywhere in the codebase would kill the Railway process.

### Why GET endpoints worked before this crash
`GET /api/trade-planning/:symbol/context` calls `getLatestSessionForSymbol(userId, symbol).catch(() => null)` — the `.catch(() => null)` silently absorbs the missing-table error and returns null, so all GET requests appeared healthy.

### Fixes

#### `server/services/trade-plan-service.ts` — `ensureTradePlanTables()`
Added full idempotent `CREATE TABLE IF NOT EXISTS trade_planning_sessions` with all columns from migrations 028 + 029, three indexes, idempotent CHECK constraint (via DO $$ block), and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for columns that may be missing on an existing Railway DB.

#### `server/routes/trade-planning.ts` — POST handler
Wrapped `createPlanningSession` in try/catch. Catch block:
- Logs structured JSON: `{ event: "trade_planning_session_create_failed", symbol, error, pgCode, ts }`
- Returns `return res.status(500).json({ message: "Unable to save your planning session. Please try again.", code: "SESSION_PERSISTENCE_FAILED" })`
- Does NOT call `process.exit` or rethrow

#### `server/index.ts` — Global handlers
Added `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)` handlers that log structured JSON events and do NOT call `process.exit`. Safety net for any other floating rejections.

#### `client/src/pages/trade-planning.tsx` — `createSessionMutation.onError`
Updated `onError` to:
- Show `"Unable to save your planning session. Please try again."` with destructive toast
- Reset `selectedFamily` to `null` (no phantom expression selection on failure)
- Clear `pendingFamilyRef.current` (no zombie pending state)

### Regression Tests
`server/routes/__tests__/session-persistence.test.ts` — §DB1–§DB25 (62 tests):
- §DB1–§DB3: table creation, null goalId/portfolioId acceptance
- §DB4–§DB5: JSONB serialization, controlled 500 response
- §DB6–§DB7: client failure message, no phantom selection
- §DB8–§DB10: process survival handlers, schema columns
- §DB11–§DB16: migration 029 columns, TEXT opportunityId, security contract
- §DB17–§DB25: process.exit not called, client state resets, process safety

### Production Bundle Verification
`npm run build` → `NODE_ENV=production node dist/index.cjs` → POST exact WMT payload:
- `RESPONSE_STATUS=401` (expected — no session cookie in test)
- `PROCESS_STILL_ALIVE=true`
- Server process did NOT exit

**Test results**: 24 suites / 1,641 tests passing. Build clean.

---

## Sprint 2.8.6A-defect-5 — Trade Planning Expression Selection & Execution Handoff (UAT)
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 23 suites / 1,579 tests

### Production Symptoms (Railway UAT)
1. No visible "Explore" CTA on expression cards — whole card clickable but no explicit button
2. `EquityPlanningPanel` never appeared — `handleSelectFamily` only PATCHed session if one already existed; no auto-create path existed for the explore flow
3. Stale "Future Planning Steps / Order Preparation — Upcoming" placeholder still displayed (Order Preparation is implemented since Sprint 2.8.x)
4. "Save Research Plan" card showed "View Trade Plans" but no "Create Trade Plan" action
5. `POST /api/trade-plans` and all 13 sibling routes used `(req as any).user?.id` (always undefined) — same auth bug as Defect-4 in `trade-planning.ts`

### Root Causes
- **No explicit Explore CTA**: `ExpressionCard` only supported `onSelect` (toggle via card click). No distinct "Explore" button with accessible label.
- **Session creation gap**: `handleSelectFamily` toggled local state and PATCHed only if `sessionId` existed. When no session existed, `EquityPlanningPanel` never rendered (gated on both `selectedFamily` AND `sessionId`).
- **Auth bug (trade-plans.ts)**: 13 route handlers used `(req as any).user?.id` instead of `req.session.userId!` — canonical pattern used across 40+ other routes. `POST /api/trade-plans` would always return 401 to authenticated users.
- **Stale UI copy**: "Future Planning Steps — Upcoming" was a Sprint 2.7 placeholder; Order Preparation (2.8.x) and full execution pipeline are implemented.

### Fix

#### Server — `server/routes/trade-plans.ts`
- Replaced all 13 instances of `(req as any).user?.id` with `req.session.userId!`

#### Client — `client/src/pages/trade-planning.tsx`
1. **`EXPLORE_CTA_LABELS` constant** — family → button label map (equity, equity_scaled, monitor_only, options families)
2. **`ExpressionCard` — `onExplore` prop** — renders explicit "Explore Equity" / "Monitor Candidate" etc. Button below limitations section, `stopPropagation` to prevent card-toggle, only for non-unavailable families
3. **`pendingFamilyRef` (useRef)** — holds family the user wants to explore when no session exists yet
4. **`handleExploreFamily` function** — definitively sets `selectedFamily`; if session exists, PATCHes immediately; if no session, stores in `pendingFamilyRef` and calls `createSessionMutation.mutate()`
5. **`createSessionMutation.onSuccess` updated** — after creating a new session, reads `pendingFamilyRef.current` and fire-and-forgets a PATCH to persist the family (local state already set)
6. **`createTradePlanMutation`** — calls `POST /api/trade-plans` with `{ planningSessionId: sessionId, planType: "EQUITY" }`, navigates to `/trade-plans` on success
7. **"Selected Research Expression" indicator** — shown when `selectedFamily` is set; displays label, "Selected by you", and "Change Expression" button
8. **"Create Trade Plan" section** — shown when `sessionId && (selectedFamily === "equity" || selectedFamily === "equity_scaled")`; includes compliance copy and "View Trade Plans" fallback
9. **"Research Workflow Overview"** — replaces stale "Future Planning Steps" placeholder; 8-step workflow with steps 1–3 highlighted (current page scope)
10. **Unavailable family cards** — do NOT receive `onExplore` prop (no actionable CTA)

### `selectedBy` Invariant Preserved
`handleExploreFamily` does NOT send `selectedBy` in the PATCH body. The server enforces `selectedBy: "USER"` via `FORBIDDEN_CLIENT_FIELDS` in `trade-preferences.ts`. Auto-selection remains impossible.

### Test Coverage
`server/routes/__tests__/trade-planning-expression-selection.test.ts` — 55 tests, §EXP1–§EXP25  
`test:release` updated to 23 suites.

---

## Sprint 2.8.6A-defect-4 — Trade Planning Auth (hotfix)
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 22 suites / 1,524 tests

### Production Symptom
`GET /api/trade-planning/WMT/context` returned 401 for authenticated users. Trade Planning page showed "not a current research candidate" for all users including authenticated ones.

### Root Cause
All 19 route handlers in `trade-planning.ts` used `(req as any).user?.id` (always undefined — no Passport in this app). Additionally 9 `getPlanningSession(sessionId, userId)` calls had args swapped vs signature `(userId, sessionId)`.

### Fix
- `server/routes/trade-planning.ts`: 19 auth replacements + 9 arg-order fixes
- `client/src/pages/trade-planning.tsx`: 401/403/5xx error handler branches added
- `server/routes/__tests__/trade-planning-auth.test.ts`: 44 new auth regression tests

---

## Sprint 2.8.6A-defect-3 — Self-Healing Lazy Ranking Hydration (hotfix)
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 21 suites / N tests (see completion report)

### Production Symptom
Defect-2 fix was deployed. WMT still rejected with "not a current research candidate" on Railway.

### Why Defect-2 Was Insufficient
The Defect-2 fix added `computeRankingForSnapshot + setLatestRanking` to `initOpportunityEngine()`. However, `scheduleOpportunityEngine()` (which calls `initOpportunityEngine`) is **fire-and-forget** — it returns void immediately and the HTTP server is already accepting requests. The async `computeRankingForSnapshot` call (which queries the DB for institutional data) could take 100ms–2s. Any Trade Planning request that arrived in this window still saw `getLatestRanking() === null`. Additionally `getOpportunityIntelligence()` had **no fallback** — it returned null immediately if the ranking was null.

### Root Cause (Defect-3)
Three contributing factors:
1. **Startup ordering**: `scheduleOpportunityEngine()` is fire-and-forget from `server/index.ts`. HTTP server accepts requests before `initOpportunityEngine()` (and its async `computeRankingForSnapshot`) completes.
2. **No lazy hydration**: `getOpportunityIntelligence()` called `getLatestRanking()` and returned null immediately — no DB fallback.
3. **Error conflation**: `getLatestRanking() === null` (infrastructure issue) and "symbol absent from ranking" produced the same user-facing message.

### Fix
1. **Self-healing lazy hydration** — `getOpportunityIntelligence()` now calls `await ensureRankingHydrated()` before reading `getLatestRanking()`. If the ranking is null, it loads the persisted DB snapshot, computes the ranking, and calls `setLatestRanking()`.
2. **Stampede protection** — A single shared `rankingHydrationPromise` ensures that concurrent requests share ONE hydration cycle, not N parallel DB+compute operations.
3. **`isOpportunityRankingAvailable()`** — new export; returns true when ranking is hydrated.
4. **Trade Planning error codes** — distinguishes `OPPORTUNITY_DATA_UNAVAILABLE` (503) from `NOT_IN_CURRENT_SNAPSHOT` (404).
5. **`opportunityEngineAvailable`** field added to `WorkspaceV2Response` — client shows degraded state vs "not a candidate" correctly.
6. **Platform Health** — new `rankingAvailable`, `hydrationFailureCount`, `lastHydrationFailureAt`, `lastHydrationSuccessAt` fields.
7. **Structured logs** — `opportunity_ranking_hydrated`, `opportunity_ranking_hydration_failed`, `trade_planning_candidate_not_in_snapshot`, `trade_planning_opportunity_data_unavailable`.

### Multi-Instance Invariant (permanent)
Every instance that needs `getLatestRanking()` is now self-healing: if null, it loads from DB rather than returning an error. The advisory lock controls the expensive scan only, not read eligibility.

### Schema Impact
None. No new DB tables or columns.

---

## Sprint 2.8.6A-defect-2 — Trade Planning Candidate Consistency (hotfix)
**Date:** 2026-08-12  
**Status:** COMPLETE  
**Tests:** 20 suites / 1,430 tests

### Production Symptom
WMT shown as #1 Top Growth (score 66) in All Ranked Opportunities and Opportunity Workspace → clicked "Open Trade Planning" → `/trade-planning/WMT` returned "WMT is not a current research candidate."

### Root Cause
`initOpportunityEngine()` loaded the latest valid snapshot from DB into `latestSnapshot` but **did not compute the ranking or call `setLatestRanking()`**. The ranking is only set inside `runOpportunityEngine()`, which requires acquiring a PostgreSQL advisory lock. On Railway, only one instance wins the lock. Other instances started with `getLatestRanking() === null`. Any call to `getCanonicalOpportunity()` on those instances returned null, and Trade Planning (correctly) rejected the symbol.

The Opportunity Workspace uses `Promise.allSettled` — if `getCanonicalOpportunity` returns null it still returns HTTP 200 with `opportunity: null` and shows limitations. But previously the CTA was gated on `opportunity !== null` client-side (not a separate `tradePlanningEligible` field), so if the workspace hit the instance WITH the ranking and the Trade Planning request hit the instance WITHOUT it, the CTA was shown but Trade Planning rejected.

### Fix
1. **`server/services/opportunity-engine.ts`**: `initOpportunityEngine()` now calls `computeRankingForSnapshot(stored, null)` and `setLatestRanking(ranking)` immediately after loading the DB snapshot. All instances converge to the same ranking on startup without waiting for a new scan or advisory lock.
2. **`server/routes/opportunity-workspace.ts`**: Added `tradePlanningEligible: boolean` to `WorkspaceV2Response` — server-computed as `opportunity !== null`.
3. **`client/src/pages/opportunity-workspace.tsx`**: CTA gated on `tradePlanningEligible` (from server) rather than re-deriving from `opportunity` client-side. Explicit contract: client never independently reinterprets eligibility.
4. **`server/routes/trade-planning.ts`**: Error response now includes structured `code: "NOT_IN_CURRENT_SNAPSHOT"` for operational diagnostics.
5. **34 new tests** in `candidate-consistency.test.ts`: §12 cross-surface invariant, §13 negative invariant, §14 snapshot rollover, §17 TEST_LIVE independence, §20 WMT fixture, §21 representative symbol regression, startup contract tests.

### Cross-Surface Invariant (permanent)
Given current snapshot S contains symbol X in any bucket (topGrowth/topIncome/watchlist/approaching):  
`getCanonicalOpportunity(X)` → non-null → `tradePlanningEligible: true` → Trade Planning accepts X.

Symbol absent from S → `getCanonicalOpportunity` → null → `tradePlanningEligible: false` → CTA hidden → Trade Planning unreachable for that symbol.

---

## Sprint 2.8.6A-defect-1 — TEST_LIVE Admin Authorization Mismatch (hotfix)
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 19 suites / 1,504 tests

### Production Defect
`GET /api/admin/test-live/config-audit` returned 403 for a valid admin session. Root cause: `registerTestLiveCertificationRoutes` defined an inline `requireAdmin` using `storage.getUser` (the in-memory stub) instead of `authStorage.getUser` (real DB rows), and compared `user.role !== "admin"` instead of `UserRole.ADMIN`. `isAdmin` was also not passed to the function, so the inline logic ran instead.

### Fix
- `registerTestLiveCertificationRoutes` now accepts `isAdmin` as 3rd parameter (canonical middleware from `routes.ts`)
- Inline `requireAdmin` removed — all 5 routes use `isAuthenticated, isAdmin`
- `server/routes.ts` updated to pass `isAdmin`
- Frontend: 401/403/500 error states added to config audit, market, and account panels
- **62 new tests**: §11 admin consistency, §12 security negatives, §17 admin-safety-bypass prevention

### Invariant Added
`registerTestLiveCertificationRoutes.length === 3` — enforces that `isAdmin` is always passed; any regression immediately fails.

---

## Sprint 2.8.6A — Controlled TEST_LIVE Execution Certification
**Date:** 2026-08-11  
**Status:** COMPLETE (infrastructure built; live test pending env config)  
**Tests:** 19 suites (1,317 + certification tests)

### What Was Built
Certification infrastructure for the Sprint 2.8.6 broker-submission pipeline. Validates ALL safety gates before permitting a live test order. No order is placed automatically — explicit operator action at each step is required.

**Admin UI:** `/admin/test-live-certification` — 10-panel step-by-step wizard covering all 33 certification sections.

**API (5 endpoints):**
- `GET /api/admin/test-live/config-audit` — 10 config gates (safe status only, never values)
- `GET /api/admin/test-live/market-status` — NYSE session check with DST-aware ET conversion
- `GET /api/admin/test-live/account-status` — broker account + allowlist verification (masked refs only)
- `POST /api/admin/test-live/disarm` — post-certification disarm instructions
- `GET /api/admin/test-live/completion-report` — 48-item completion report (Section 34)

**Pure certification engines:**
- `computeConfigAudit(deps)` — injectable, all 10 required gates, fail-closed semantics documented
- `computeMarketStatus(now?)` — DST-aware ET conversion, holiday list, injectable time for tests
- `computeDisarmResult(wasArmed)` — operator guidance without exposing values
- `buildCompletionReport(audit, market, liveTestResult?)` — 48-item report, verdict, decision

**Documentation:**
- `docs/operations/45-test-live-execution-certification.md` — full certification guide (env config, workflow, defect policy, disarm, record template)

### Key Invariants Enforced
- Config audit never exposes raw account IDs or env var values
- `productionBlocked: true` is a literal type constant — cannot be overridden
- Empty allowlists → all accounts/symbols blocked (fail-closed, documented in audit)
- Null caps → all orders blocked (required for TEST_LIVE)
- Market order / multi-leg bans documented in audit response
- Disarm API cannot modify env vars (documents what operator must do in Replit Secrets)

### Current Status
`CONDITIONAL_GO` — certification infrastructure complete; live test blocked until operator sets required env vars (BROKER_EXECUTION_MODE=test_live, EXECUTION_TEST_LIVE_ARMED=true, allowlists, caps) and market is open.

### New Files
- `server/routes/test-live-certification.ts` — certification API + pure engines
- `server/routes/__tests__/test-live-certification.test.ts` — pure tests
- `client/src/pages/admin-test-live-certification.tsx` — admin certification UI
- `docs/operations/45-test-live-execution-certification.md` — ops guide

### Modified Files
- `server/routes.ts` — registered `registerTestLiveCertificationRoutes`
- `client/src/App.tsx` — added `/admin/test-live-certification` route (AdminOnly)
- `package.json` — added `test:certification`; updated `test:release` (19 suites) + `test:release:full`

---

## Sprint 2.8.6 — Sandbox/Test-Account Broker Submission
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 1,090 (17 suites, all passing)

### What Was Built
Human review and explicit consent layer between Execution Readiness (2.8.4) and future broker submission. Creates an immutable `FinalOrderReviewSnapshot` cryptographically hashed with SHA-256. Generates deterministic required acknowledgements from order structure. Server-side revalidation before accepting confirmation. Confirmation is idempotent (unique constraint on snapshot_id + user_id). No broker order submission.

**Key invariant (user-stated):** Confirmation cannot survive a changed preview or changed readiness result.

### New Files
- `shared/order-confirmation-types.ts` — all canonical types, acknowledgement definitions and codes, lifecycle states, compliance constants, forbidden label list, `BROKER_SUBMISSION_ENABLED: false` compile-time literal
- `server/services/order-confirmation-service.ts` — pure engine: `buildFinalOrderReviewSnapshot`, `computeSnapshotHash`, `determineRequiredAcknowledgements`, `revalidateBeforeConfirm`, `checkAllRequiredAcknowledgementsPresent`, DB helpers, audit logging
- `server/routes/order-confirmation.ts` — 3 routes (static `/health` before dynamic); forbidden-field guard; idempotency; server-side revalidation before confirm
- `server/routes/__tests__/order-confirmation.test.ts` — 72 scenarios covering all spec requirements
- `client/src/components/execution/FinalOrderReviewPanel.tsx` — order summary, legs table, economics, readiness summary, acknowledgement checkboxes, confirm button, confirmed banner
- `docs/operations/43-review-consent-and-final-order-confirmation.md` — full architecture doc

### Modified Files
- `server/routes.ts` — registered `registerOrderConfirmationRoutes` + `ensureOrderConfirmationTables`
- `package.json` — added `test:order-confirmation`; updated `test:release` + `test:release:full` (17 suites)
- `client/src/pages/trade-planning.tsx` — `FinalOrderReviewPanel` wired below `ExecutionReadinessPanel` for all options families

### DB Changes
3 new raw-SQL tables (no Drizzle schema change):
- `final_order_review_snapshots` — immutable snapshot store
- `order_confirmations` — confirmation records, UNIQUE(snapshot_id, user_id)
- `order_confirmation_audit_events` — full audit trail

### Key Invariants Introduced
- Confirmation cannot survive a changed preview or changed readiness result
- `BROKER_SUBMISSION_ENABLED: false` — literal type constant (compile-time)
- Snapshot hash = SHA-256(sortObjectKeys(canonicalPayload)) — deterministic, field-sensitive
- BLOCKED readiness → no snapshot created
- Missing max profit/loss → null, never fabricated
- Idempotent confirm endpoint (same snapshot + user → same confirmation)
- Forbidden labels enforced: APPROVED, AUTHORIZED, RECOMMENDED, GUARANTEED, etc.

### Snapshot Hash Design
SHA-256 of canonical payload with sorted keys. Includes: tradePlanId, orderPreviewId, executionReadinessId, userId, strategyFamily, symbol, legs, quantity, pricing, economics, readiness, marketDataObservedAt, reviewedDataVersion. Excludes volatile fields (id, createdAt, expiresAt).

### Expiry Policy
Default 120s TTL (intentionally short for options). Configurable via `FinalReviewConfig.snapshotTtlSeconds`.

### Acknowledgements (deterministic, no LLM)
- `ACK_REVIEWED_ORDER` — always required
- `ACK_OPTIONS_RISK` — always required
- `ACK_SHORT_ASSIGNMENT` — any short intent leg
- `ACK_ZERO_DTE` — any 0DTE leg
- `ACK_DEFINED_RISK_ESTIMATE` — spreads/condors/collar
- `ACK_BUYING_POWER_ESTIMATE` — capital estimate present
- `ACK_MULTI_LEG` — MULTI_LEG_OPTION
- `ACK_NEAR_EXPIRATION`, `ACK_MARKET_CLOSED` — conditional

### 2.8.6 Handoff
Next: Sprint 2.8.6 — Broker Submission Orchestration (major safety boundary requiring all guards listed in §26 of doc 43).

---

## Sprint 2.8.4 — Execution Readiness & Guardrails
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 1100+ (16 suites, all passing)

### What Was Built
Deterministic execution readiness layer immediately after Options Order Preview. Evaluates 9 categories: Market Data, Account, Position, Capital, Structure, Assignment Risk, Expiration, Liquidity, Pricing. Returns READY / READY_WITH_WARNINGS / BLOCKED. No LLM involvement. Capital estimates for all defined-risk strategies. Missing positions / buying power never assumed zero. `brokerSubmissionEnabled: false` is a literal type constant.

### New Files
- `shared/execution-readiness-types.ts` — canonical types, all finding codes, guardrail config, status labels, compliance constants
- `server/services/execution-readiness-service.ts` — pure deterministic engine; 9 category evaluators; capital estimation; persistence helpers; in-memory health metrics
- `server/routes/execution-readiness.ts` — 3 routes; static `/health` before dynamic `/:id`; FORBIDDEN_FIELD injection guard
- `server/routes/__tests__/execution-readiness.test.ts` — 40 test scenarios covering all spec requirements
- `client/src/components/execution/ExecutionReadinessPanel.tsx` — status banner (READY/READY_WITH_WARNINGS/BLOCKED); findings grouped by category; capital estimate card; no submission CTA
- `docs/operations/42-execution-readiness-and-guardrails.md` — full architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerExecutionReadinessRoutes` + `ensureExecutionReadinessTables`
- `package.json` — Added `test:execution-readiness`; updated `test:release` + `test:release:full` (16 suites)
- `client/src/pages/trade-planning.tsx` — `ExecutionReadinessPanel` wired below `OptionsOrderPreviewPanel` for all options families

### DB Changes
- New table: `execution_readiness_results` (raw SQL, minimal schema). Created via `ensureExecutionReadinessTables()` at startup. No new Drizzle schema entry.

### Key Invariants Introduced
- Readiness is DETERMINISTIC — no LLM; status cannot be overridden by AI
- `brokerSubmissionEnabled: false` — literal type constant in output
- `engineVersion: "2.8.4"` — always present
- Missing positions ≠ zero holdings; missing buying power ≠ $0
- No leg decomposition for multi-leg orders (inherits from 2.8.3)
- No order submission, modification, or cancellation

### Capital Estimation
- Debit strategies: `totalAmount` from preview (max loss = debit paid)
- Credit spreads: `(spread_width - credit) × 100 × qty`
- Iron condor/butterfly: `(max_wing_width - credit) × 100 × qty`
- Cash-secured put: `(strike × 100 × qty) - credit`
- Covered call: SHARES_ONLY (0 new capital)
- Unknown/undefined risk: BROKER_MARGIN_REQUIRED

### 2.8.5 Handoff
Next: Sprint 2.8.5 — Review, Consent & Final Order Confirmation
- Immutable final order snapshot
- Clear debit/credit display + max gain/loss
- Account + buying-power impact
- Assignment/exercise disclosure
- Explicit user acknowledgement + confirmation
- No broker submission until separately approved

---

## Sprint 2.8.3 — Options / Multi-Leg Order Preview
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 948+ (15 suites, all passing)

### What Was Built
Non-executable options and multi-leg order preview engine. Supports all 16 options strategy families (single-leg through iron condor). Preview is ephemeral (no new DB table), computed from Trade Plan + Execution Preflight + Order Draft + current leg quotes. Net debit/credit computed with canonical long/short sign convention. All contracts, strikes, expirations, ratios, and quantities are immutable from the OrderDraft. Multi-leg structures are never decomposed.

### New Files
- `shared/options-order-preview-types.ts` — Canonical `OptionsOrderPreview`, `OptionsPreviewLeg`, `NetStructurePricing`, all blocker/warning codes, compliance constants, health metrics type, display labels
- `server/services/options-preview-service.ts` — Pure 25-stage computation engine; injectable `OptionsPreviewDeps`; ephemeral health metrics; `createDbOptionsPreviewDeps`; `ensureOptionsPreviewTables` (no-op)
- `server/routes/options-preview.ts` — 4 read-only routes; static `/health` before dynamic `/:draftId`; forbidden-field injection guard
- `server/routes/__tests__/options-preview.test.ts` — 175+ assertions covering all spec invariants
- `client/src/components/execution/OptionsOrderPreviewPanel.tsx` — Full preview UI; non-execution banner always visible; leg cards with draft vs current quote comparison; Greeks expandable; no Confirm/Submit CTA
- `docs/operations/41-options-and-multileg-order-preview.md` — Full architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerOptionsPreviewRoutes` + `ensureOptionsPreviewTables`
- `package.json` — Added `test:options-preview`; updated `test:release` + `test:release:full` (15 suites)
- `client/src/pages/trade-planning.tsx` — `OptionsOrderPreviewPanel` wired when options-family expression + valid draftId

### Key Invariants Introduced
- `executable: false` — type-level constant, impossible to override
- `selectedBy: "USER"` — always read from Trade Plan; never from client
- Instrument type must be OPTION or MULTI_LEG_OPTION — `WRONG_INSTRUMENT_TYPE` blocker for EQUITY
- Options broad expression required — `WRONG_EXPRESSION_TYPE` blocker for STOCK
- All leg parameters immutable — preview never changes contract, strike, expiration, ratio, quantity
- No leg decomposition — multi-leg structures never split into individual legs
- Net debit/credit sign convention canonical: long=debit, short=credit; amount always positive
- Multiplier always 100 (standard US equity options)
- Forbidden labels enforced — no "Probability of Profit", "Roll Now", "Ready to Trade", "Place Order", etc.
- EXPIRED ≠ UNAVAILABLE — expired draft returns status EXPIRED explicitly
- No broker mutation methods called anywhere

### 2.8.4 Handoff
Next: Sprint 2.8.4 — Execution Validation Hardening
- Task #131 lifecycle scheduler auto-wiring
- Final validation chain: lifecycle → preflight → draft → preview → account → permissions → buying power → positions → quotes → market state

### 2.8.5 Absolute Block
No broker submission until 2.8.4 GO + full validation chain passing. No exception.

---

## Sprint 2.8.2 — Equity Order Preview
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 773 (14 suites, all passing)

### What Was Built
Non-executable equity order preview engine. Traders can review all material order facts before any submission pathway exists. Preview is ephemeral (no new DB table), computed on demand from Trade Plan + Execution Preflight + Order Draft + current reference quote.

### New Files
- `shared/equity-order-preview-types.ts` — Canonical types, status codes, blocker/warning enums, compliance constants, audit event types, health metrics
- `server/services/equity-preview-service.ts` — Pure computation engine with injectable deps; 16-stage pipeline; health metrics
- `server/routes/equity-preview.ts` — 4 read-only routes; forbidden-field injection guard
- `server/routes/__tests__/equity-preview.test.ts` — 136 tests covering all invariants
- `client/src/components/execution/EquityOrderPreviewPanel.tsx` — Full preview UI; no submission CTA; "Preview Only" banner always visible
- `docs/operations/40-equity-order-preview.md` — Architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerEquityPreviewRoutes` + `ensureEquityPreviewTables`
- `package.json` — Added `test:equity-preview`; updated `test:release` + `test:release:full` (14 suites, 773 tests)
- `client/src/pages/trade-planning.tsx` — `EquityOrderPreviewPanel` wired when STOCK expression + valid draft

### Key Invariants Introduced
- `executable: false` — type-level constant, impossible to override
- `expressionType === "STOCK"` — enforced before any computation; `WRONG_EXPRESSION_TYPE` blocker otherwise
- `expressionSelectedBy === "USER"` — always read from trade plan; never from client
- Draft values immutable — preview never changes limit price, quantity, side, orderType, or TIF
- Forbidden labels enforced — no "Ready to Trade", "Approved", "Guaranteed Fill", etc.
- No broker mutation — `placeOrder`/`submitOrder`/`replaceOrder`/`cancelOrder` never called
- Client injection blocked — 18 forbidden fields rejected at route layer

### Methodology Version
`2.8.2`

### Next Sprint
2.8.3 — Options/Multi-Leg Preview

---

## Sprint 2.8.1A — Trade Preferences & User-Directed Expression Selection
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 637 (13 suites, all passing)

### What Was Built
Full trade preference system and user-directed expression selection step for Trade Planning.

### New Files
- `shared/trade-preference-types.ts` — `BroadExpressionType`, `UserTradingPreferences`, `ExpressionOption`, `BROAD_TO_FAMILIES`, compliance constants
- `server/services/trade-preferences-service.ts` — `computeBroadCompatibility`, `computeExpressionOptions`, CRUD for preferences and expression selections
- `server/routes/trade-preferences.ts` — 5 REST routes
- `server/routes/__tests__/trade-preferences.test.ts` — 101 tests
- `client/src/components/settings/ResearchTradingPreferencesSection.tsx` — Settings card for global research preferences
- `client/src/components/execution/BroadExpressionSelectionStep.tsx` — First step of Trade Planning for selecting broad expression type
- `migrations/029_trade_preferences.sql` — Additive migration
- `docs/operations/39-trade-preferences-and-expression-selection.md` — Architecture doc

### Modified Files
- `shared/schema.ts` — Added `preferredExpressionTypes`/`showOtherCompatibleStructures` to `userSettings`; `broadExpressionType`/`expressionSelectedBy` to `tradePlanningSessions`; `broadExpressionType`/`expressionSelectedBy`/`expressionSelectedAt` to `tradePlans`
- `server/routes.ts` — Registered `registerTradePreferencesRoutes` + `ensureTradePreferencesTables`
- `client/src/pages/settings.tsx` — Added `ResearchTradingPreferencesSection` to Trade Preferences tab
- `package.json` — Added `test:trade-preferences`; updated `test:release` + `test:release:full`
- `docs/operations/17-sprint-change-log.md` — This entry

---

## Sprint 2.8.1 — Order Preparation Engine
**Status:** COMPLETE

Non-executable `OrderDraft` computation. `executable: false` is type-level constant. Only PASS preflight drafts proceed. `limitPricePreference` not `limitPriceReference` (see memory). 536 tests.

---

## Sprint 2.8.0 — Execution Architecture
**Status:** COMPLETE

Kill switch (`BROKER_EXECUTION_ENABLED`), 12-dim preflight, broker adapter, audit tables, 5 legacy route guards. 401 tests.

---

## Sprint 2.7.7A — Certification Closure
**Status:** COMPLETE

6 dep upgrades (HIGH 17→10); canonical E2E creds; `PLAYWRIGHT_RELEASE_CERT=1`; CONDITIONAL_GO upgraded to GO; Phase 2.8 APPROVED.

---

## Sprint 2.7.7 — Release Gate
**Status:** CONDITIONAL_GO → GO

10-suite test:release gate (313 tests); schema column fixes; job store API; compliance "guaranteed" context pattern.

---

## Sprint 2.7.6 — Trade Monitoring & Lifecycle Intelligence
**Status:** COMPLETE

`trade_plan_activity` table; 7 lifecycle states; 24h dedup fingerprint; scheduler-ready; smoke/regression/integration/security suites mandatory.

---

## Sprint 2.7.5 — Trade Plan Workspace
**Status:** COMPLETE

Persistent plan DB (`trade_plans` + `trade_plan_versions`); server-authoritative creation; `getCachedRiskAnalysis` 3-arg signature.

---

## Sprint 2.7.4 — Trade Risk & Scenario Analysis
**Status:** COMPLETE

Deterministic scenario engine; `probabilityMetricsEnabled` always false; `crypto.randomUUID()` not `uuid()`.

---

## Sprint 2.7.3 — Options Contract Research
**Status:** COMPLETE

Live broker chain; `normalizeOptionChainContract` reads `greeks.mid_iv`; `clearContractResearchCache()` in tests.

---

## Sprint 2.8.6A — Defect-4 Authentication Fix
**Status:** COMPLETE — READY_FOR_RAILWAY_REDEPLOY

**Defect**: GET /api/trade-planning/WMT/context returned 401 for an otherwise authenticated session.

**Root cause**: ALL 19 route handlers in `server/routes/trade-planning.ts` extracted the user identity with `(req as any).user?.id`. This codebase uses pure session-based auth — there is no Passport `req.user`. The expression always returned `undefined`, so every handler's auth guard fired 401 even though `isAuthenticated` middleware had already passed (it checks `req.session.userId` and called `next()`).

**Canonical auth pattern**: `req.session.userId!` — used by 40+ other routes, declared in `sessionAuth.ts` module declaration, guaranteed non-null after `isAuthenticated` calls `next()`.

**Additional bug fixed**: 9 calls to `getPlanningSession(sessionId, userId)` had args swapped vs the service signature `(userId, sessionId)`. Fixed to `getPlanningSession(userId, sessionId)`.

**Why Opportunity Workspace succeeded but Trade Planning failed**: `/api/opportunities/workspace/:symbol` uses a local `getUserId(req)` helper that reads `req.user?.id ?? req.user?.userId`. For the same reason it would also have been broken — the workspace route succeeds only because it falls back to `""` for userId, never performs an ownership check, and proceeds without 401. Trade Planning handlers fail fast with an explicit `if (!userId) return res.status(401)`.

**Client fix**: Error display now has distinct branches for 401 (session-verification message + Sign In link), 403 (access denied), 503 (retriable infra error), generic 5xx, and 404/default (not a current research candidate). Previously all non-503 errors showed "not a current research candidate" regardless of HTTP status.

**Files changed**:
- `server/routes/trade-planning.ts` — 19× `(req as any).user?.id` → `req.session.userId!`; 9× arg-order fix `getPlanningSession(userId, sessionId)`
- `client/src/pages/trade-planning.tsx` — 4 new error branches (401, 403, 5xx, improved 503)
- `server/routes/__tests__/trade-planning-auth.test.ts` — NEW: 44 auth regression tests (§AUTH1–§AUTH20)
- `package.json` — added `test:trade-planning-auth`; updated `test:release` (22 suites)
- `docs/operations/17-sprint-change-log.md` — this entry
- `docs/operations/45-test-live-execution-certification.md` — Defect-4 record

**Test results**: 22 suites / 1,524 tests passing. Build clean.

---

## Sprint 2.7.2 — Options Strategy Matching
**Status:** COMPLETE

17 families; covered_call/protective_put/collar NOT_APPLICABLE without shares; liquidity note contains "2.7.3" literally.

---

## Sprint 2.7.1 — Equity Planning Engine
**Status:** COMPLETE

`EvidenceItem` has no severity; `PlanningFreshness` uses `updatedAt`; `ResearchGlossaryEntry` uses `label/shortDefinition/fullDefinition/caution`.

---

## Sprint 2.7.0 — Trade Planning Foundation
**Status:** COMPLETE

`uuid()` unavailable in schema (use `varchar+gen_random_uuid`); research_goals.id is varchar; 10 expression families; static routes before `/:symbol`.

---

## Sprint 2.6.5 — Research Goals & Planning
**Status:** COMPLETE

Categorical match states only; `MapIterator` needs `Array.from()`; static routes before `/:id`; TradePlanningContextShape is Phase 2.7 doc only.

---

## Defect-10c Production Follow-Up — State-Anchored Review Validity
**Status:** COMPLETE

**Root cause confirmed:** `currentSummary.asOf` = `opportunity-ranking-engine.ts` scan timestamp (`new Date().toISOString()` at scoring time). Every 4-hour scan advanced `asOf` even with identical scores. `lastReviewedAt >= asOf` comparison wrongly treated routine scans as "new data" → Research Lifecycle permanently REQUIRES_REVIEW after first post-review scan.

**Fix:** State-anchored review validity.
- New JSONB column `last_reviewed_research_state` on `trade_plans` (additive, idempotent ALTER).
- `POST .../lifecycle/review` captures `getCanonicalOpportunity(symbol)` scores at review time
  (strips scan timestamps) → persists as `lastReviewedResearchState`. Fire-and-forget; failure
  falls back to legacy 7-day window.
- `evaluateTradePlanLifecycle()` computes `reviewedStateChanges = computeResearchChanges(reviewedBaseline, currentSummary)` using the SAME canonical comparator as plan-creation → current.
- `computeLifecycleState()`: no material changes in `reviewedStateChanges` → CURRENT (scan timestamps irrelevant); material changes → REQUIRES_REVIEW; `reviewedStateChanges = null` (legacy) → 7-day window.
- `researchDataTimestamp` param removed from `computeLifecycleState` (was the wrong approach).

**Test results:** 9752 tests, 3 new failures fixed (all in the old timestamp-semantics integration tests), zero regressions.
