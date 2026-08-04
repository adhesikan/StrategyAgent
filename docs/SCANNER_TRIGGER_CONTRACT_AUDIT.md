# Scanner Trigger Contract Audit

**Date:** 2026-08-04  
**Scope:** Read-only audit of trigger persistence and mapping in the VCP Trader scanner opportunity pipeline.  
**Trigger:** Production condition — `rank_market_trade_candidates` reviewed 50 stored opportunities and excluded all 50 as `NOT_ACTIONABLE_NO_TRIGGER`.

---

## Executive Summary

The root cause is a single hardcoded `null` assignment on one line of the scheduled-scan ingestion function. All nine local strategies produce a breakout trigger level (stored in `resistance` on the `ScanResult` shape). That value is available at ingestion time but is never written to `entry_trigger_price`. The MCP ranker correctly rejects rows with a null trigger. No data fabrication occurred; the ranker is behaving correctly. The fix requires changing one field assignment and verifying the semantic mapping in the API adapter.

---

## 1. Full Data Path Trace

```
Scanner strategy (server/strategies/*.ts)
    → ScanResultOutput { levels: { entryTrigger, stopLevel, exitRule, resistance } }
    ↓ classifyQuote (server/strategies/index.ts)
    ↓ quotesToScanResults (server/scheduled-scan-service.ts:103–135)
        Maps: resistance = classified.resistance
              stopLoss   = classified.stopLevel
              [entryTrigger FIELD DOES NOT EXIST ON ScanResult — dropped here]
    ↓ ScanResult[] (shared/schema.ts:98 — scanResults table shape)
    ↓ ingestOpportunitiesFromScan (server/opportunity-service.ts:26–87)
        Writes: resistancePrice    = result.resistance  ✓
                stopReferencePrice = result.stopLoss     ✓
                entryTriggerPrice  = null               ← HARDCODED (line 57)
    ↓ opportunities table (entry_trigger_price column exists, is real/nullable)
    ↓ toInternalSetup (server/routes/internal-scanner.ts:194–231)
        Maps: trigger            = level(row.entryTriggerPrice, …)  → always null
              invalidation       = level(row.stopReferencePrice, …) → populated
              technicalObjective = level(row.resistancePrice, …)    → populated (wrong semantic label)
    ↓ InternalSetup { trigger: null, technicalObjective: <resistance price> }
    ↓ GET /api/internal/scanner/opportunities (server/routes/internal-scanner.ts:405–508)
        Returns InternalSetup[] to the deployed MCP service
    ↓ MCP SetupCandidate adapter (external vcp-trader-mcp service)
        Reads: candidate.trigger → null
        Excludes candidate as NOT_ACTIONABLE_NO_TRIGGER
    ↓ rank_market_trade_candidates response
        excludedCount: 50, groupedCandidateCount: 0
        exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 50 }]
```

### Field name mapping at each stage

| Stage | Field name | Value source | Nullable? |
|---|---|---|---|
| `ScanResultOutput` | `levels.entryTrigger` | Strategy computation | No (when qualifying) |
| `ScanResult` (DB row) | `resistance` | `classified.resistance` | Yes |
| `ScanResult` (DB row) | `entryTrigger` | **does not exist** | N/A |
| `opportunities` table | `resistance_price` | `result.resistance` | Yes |
| `opportunities` table | `entry_trigger_price` | hardcoded `null` | **Always null** |
| `InternalSetup` API | `trigger` | `entryTriggerPrice` | **Always null** |
| `InternalSetup` API | `technicalObjective` | `resistancePrice` | Yes |
| MCP `SetupCandidate` | `trigger` | `InternalSetup.trigger` | **Always null** |

---

## 2. Database Schema Audit

### `opportunities` table — full column list (`shared/schema.ts:127–166`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | varchar | NO | PK |
| `user_id` | varchar | NO | |
| `symbol` | text | NO | |
| `strategy_id` | text | NO | Internal strategy ID (e.g. `VCP`, `ORB5`) |
| `strategy_name` | text | NO | Display name |
| `timeframe` | text | NO | Default `1d` |
| `stage_at_detection` | text | NO | Raw scanner stage: `FORMING/READY/BREAKOUT` |
| `detected_at` | timestamp | NO | |
| `detected_price` | real | YES | Price at detection |
| `resistance_price` | real | YES | Resistance/breakout level from scanner |
| `stop_reference_price` | real | YES | Stop-loss reference from scanner |
| **`entry_trigger_price`** | real | YES | **Always null — never written by ingestion** |
| `rvol` | real | YES | |
| `score` | integer | YES | Pattern score |
| `status` | text | NO | `ACTIVE` or `RESOLVED` |
| `resolved_at` | timestamp | YES | |
| `resolution_outcome` | text | YES | `BROKE_RESISTANCE / INVALIDATED / EXPIRED` |
| `last_price` | real | YES | Updated from subsequent scans |
| `bars_tracked` | integer | NO | Default 0 |
| `dedupe_key` | text | YES | UNIQUE |

**Key absence:** There are no columns named `trigger`, `triggerLevel`, `actionablePivot`, `invalidation`, `objective`, `target`, or `lifecycle`. The columns closest to these concepts are `resistance_price` (breakout level), `stop_reference_price` (invalidation reference), and `entry_trigger_price` (intended trigger — always null).

### `scan_results` table — relevant columns (`shared/schema.ts:70–98`)

| Column | Present | Notes |
|---|---|---|
| `resistance` | YES | Breakout level from strategy |
| `stop_loss` | YES | Stop reference |
| `entry_trigger` | **NO** | Field does not exist in this table |

The `ScanResult` TypeScript type (`typeof scanResults.$inferSelect`) therefore has no `entryTrigger` property. The ingestion function receives `ScanResult[]` and correctly has no `result.entryTrigger` to read — which is why the hardcoded `null` fallback exists.

### Strategy-level audit

The dev database has no stored rows (empty `opportunities` table). The findings below are derived from code inspection. Representative production behaviour can be inferred from the confirmed pattern: all 50 production rows had `entry_trigger_price = null`.

| Strategy ID | MCP Slug | Stored trigger field | `entry_trigger_price` populated? | `resistance_price` populated? |
|---|---|---|---|---|
| `VCP` | `vcp` | `entryTriggerPrice` | **Never** | Yes — pivot level |
| `VCP_MULTIDAY` | `power_breakout` | `entryTriggerPrice` | **Never** | Yes |
| `ORB5` | `open_drive_5m` | `entryTriggerPrice` | **Never** | Yes — OR high |
| `ORB15` | `open_drive_15m` | `entryTriggerPrice` | **Never** | Yes — OR high |
| `HIGH_RVOL` | `volume_surge` | `entryTriggerPrice` | **Never** | Yes — consolidation high |
| `GAP_AND_GO` | `gap_force` | `entryTriggerPrice` | **Never** | Yes — OR high |
| `CLASSIC_PULLBACK` | `precision_pullback` | `entryTriggerPrice` | **Never** | Yes |
| `TREND_CONTINUATION` | `trend_pilot` | `entryTriggerPrice` | **Never** | Yes — pullback high |
| `VWAP_RECLAIM` | `institutional_reclaim` | `entryTriggerPrice` | **Never** | Yes — VWAP level |
| `VOLATILITY_SQUEEZE` | `pressure_break` | `entryTriggerPrice` | **Never** | Yes — squeeze range high |

Note: `momentum_breakout` (MCP slug) is accepted by the strategy-contract adapter (`server/mcp/strategy-contract-adapter.ts:23–35`) but has no corresponding local strategy registration. Any row stored under this ID would also have `entry_trigger_price = null`.

---

## 3. Trigger Semantic Categories

All nine local strategies produce an explicit price as their entry trigger. No strategy uses an event-only or time-only trigger in isolation. However, the semantics differ in one important dimension: whether the trigger is valid outside a specific session window.

| Strategy | Trigger type | Basis | Session constraint |
|---|---|---|---|
| VCP | **A — explicit price** | `actionablePivot.level` (pivot high) | None — valid any day |
| VCP_MULTIDAY | **A — explicit price** | `computeLevels` pivot | None |
| CLASSIC_PULLBACK | **A — explicit price** | Pullback high / prior swing | None |
| TREND_CONTINUATION | **A — explicit price** | `pullbackHigh` | None |
| HIGH_RVOL | **A — explicit price** | `consolidation.high` | None |
| VOLATILITY_SQUEEZE | **A — explicit price** | `squeezeRangeHigh` | None |
| VWAP_RECLAIM | **B — price-zone** | Current VWAP level | Intraday — VWAP resets daily |
| ORB5 / ORB15 | **C+A — event+price** | Opening range high | Intraday — requires session-open event |
| GAP_AND_GO | **C+A — event+price** | Opening range high at gap | Intraday — requires gap event at open |

Classification key:  
A = explicit price trigger · B = price-zone trigger · C = event trigger · D = time/session trigger · E = no deterministic trigger

**Important implication for ORB and GAP_AND_GO:** These strategies require an intraday opening-range event. A stored row for ORB5 with `stage_at_detection = READY` was valid when detected (within the opening window) but has no actionable intraday trigger after that session ends. Serving these rows as READY the next day misrepresents their actionability even if the trigger price were populated.

---

## 4. First Loss Point by Strategy

All nine local strategies share the same root cause. The per-strategy classification is therefore uniform:

| Strategy | Classification | File | Line |
|---|---|---|---|
| All 9 local strategies | **`INGESTION_DROPPED_TRIGGER`** | `server/opportunity-service.ts` | 57 |

**Exact mechanism:**  
`ingestOpportunitiesFromScan` receives `ScanResult[]`. The `ScanResult` type has a `resistance` field (the breakout level produced by each strategy) but no `entryTrigger` field. The function explicitly writes `entryTriggerPrice: null` on line 57 without using `result.resistance`.

**Secondary loss point (API layer):**

| Strategy | Classification | File | Lines |
|---|---|---|---|
| All 9 local strategies | **`API_MAPPING_DROPPED_TRIGGER`** | `server/routes/internal-scanner.ts` | 213–214 |

Even if `entryTriggerPrice` were populated, the API adapter `toInternalSetup` maps:
- `resistancePrice` → `technicalObjective` (labeled as objective, not trigger)
- `entryTriggerPrice` → `trigger` (correct field, but always null)

So even the `resistance_price` (which IS the breakout level for all strategies) is not surfaced as `trigger` in the API. It appears only as `technicalObjective`.

**Inconsistency within the same codebase:**  
`server/routes.ts:6021` in the webhook/automation entry path already correctly treats `scanResult.resistance` as the trigger:
```typescript
entryTrigger: scanResult.resistance,  // routes.ts:6021 — automation path
```
The scheduled scanner path (`ingestOpportunitiesFromScan`) does the equivalent of ignoring this mapping entirely.

---

## 5. Status Consistency Audit

**Confirmed: READY / TRIGGERED / BREAKOUT can coexist with `trigger: null`.**

`normalizeStatus` (`server/routes/internal-scanner.ts:122–141`) derives the API status from `status` (ACTIVE/RESOLVED) and `stage_at_detection` (FORMING/READY/BREAKOUT), never from whether `entry_trigger_price` is populated:

```
ACTIVE + FORMING          → forming
ACTIVE + READY            → ready       ← trigger may be null
ACTIVE + BREAKOUT         → triggered   ← trigger may be null
RESOLVED + BROKE_RESISTANCE → triggered ← trigger may be null
RESOLVED + INVALIDATED    → invalid
RESOLVED + EXPIRED        → invalid
```

The status therefore communicates pattern maturity, not actionability. A row with `status=ready` and `trigger=null` tells MCP "this setup has matured to the breakout stage" but gives no price to act on. The MCP ranker correctly treats this as non-actionable.

This is not a bug in `normalizeStatus` per se — the problem is that `trigger` is always null regardless of stage. If `entry_trigger_price` were populated correctly, READY and TRIGGERED statuses would be truthful.

**However, one genuine semantic mismatch exists for ORB/GAP_AND_GO:** A stored row for these strategies with `stage_at_detection = READY` was detected during the opening session. After that session ends the setup has no actionable intraday trigger. Serving it as `ready` on subsequent days implies readiness that no longer exists.

---

## 6. Sample Rows (BA, DIS, AMGN)

The development database has no stored rows in the `opportunities` table. No sample rows are available for BA, DIS, or AMGN in the dev environment.

**Production inference from the observed MCP result:**
- `reviewedCount: 50` — 50 stored rows were read and sent to MCP
- `excludedCount: 50` — all 50 rows had `trigger: null`
- `exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 50 }]`

**Trigger coverage by strategy (dev DB):**

| Strategy | Rows | With trigger | Without trigger | % missing |
|---|---|---|---|---|
| (all strategies) | 0 | 0 | 0 | 100% (no data) |

Production data confirms the 100% missing rate for `entry_trigger_price`. No actionable rows exist in the stored opportunity set.

---

## 7. Recommended Fix Options

Ordered by invasiveness and risk.

### Fix A — Smallest truthful fix (recommended first step)
**Populate `entryTriggerPrice` from `resistance` in `ingestOpportunitiesFromScan`**

File: `server/opportunity-service.ts`, line 57  
Change: `entryTriggerPrice: null` → `entryTriggerPrice: result.resistance || null`

This is semantically validated by the existing webhook/automation path (`server/routes.ts:6021`) which already maps `scanResult.resistance` to `entryTrigger`. The two paths would then be consistent.

Risk: Low. `resistance_price` is already written and is redundant with the new `entry_trigger_price` — no data loss.

### Fix B — Correct the API semantic label
**Map `resistancePrice` as trigger fallback in `toInternalSetup` when `entryTriggerPrice` is null**

File: `server/routes/internal-scanner.ts`, lines 213–214  
Change: 
```typescript
trigger: level(row.entryTriggerPrice ?? row.resistancePrice, "breakout level"),
```

This ensures the resistance level (which IS the breakout trigger for all strategies) reaches the MCP `trigger` field even for rows stored before Fix A is applied. Should be done alongside Fix A.

Risk: Low. Adds a fallback; does not alter behaviour when `entryTriggerPrice` is populated.

### Fix C — Introduce typed trigger variants for intraday strategies
**Classify ORB / GAP_AND_GO stored rows as WATCH when served outside their detection session**

File: `server/routes/internal-scanner.ts`, `normalizeStatus` function  
Logic: If `strategy_id` is `ORB5/ORB15/GAP_AND_GO` and `detected_at` is from a prior trading day, override status to `forming` or omit from actionable feeds.

Risk: Medium. Requires a concept of "same trading session." Avoids serving stale intraday setups as ready.

### Fix D — Stop publishing non-actionable rows into actionable feeds
**Add a separate watch/setup feed for rows without a trigger price**

Split the `/api/internal/scanner/opportunities` response so that:
- Rows with `entry_trigger_price` populated → actionable feed (sent to MCP ranker)
- Rows with `entry_trigger_price = null` → watch feed (not sent to MCP, shown separately in UI)

Risk: Medium. Requires MCP service to know about the split, or VCP Trader to filter before the MCP call.

### Fix E — Correct misleading lifecycle/status labels
**Derive status not from `stage_at_detection` alone but from whether a trigger price is present**

Change `normalizeStatus` to return `forming` instead of `ready` when `entry_trigger_price` is null, regardless of `stage_at_detection`. This makes the status truthful about actionability, not just pattern maturity.

Risk: Low-medium. Changes the set of rows returned by the `status=ready` filter.

---

## 8. Smallest Implementation Sequence

1. **Apply Fix A** (`server/opportunity-service.ts:57`): `entryTriggerPrice: result.resistance || null`  
   — Immediately populates trigger for all new scan ingestions.

2. **Apply Fix B** (`server/routes/internal-scanner.ts:213`): fallback trigger from `resistancePrice`  
   — Covers existing rows in the DB that have `resistance_price` but `entry_trigger_price = null`.

3. **Apply Fix C** (after validating A+B): mark ORB/GAP_AND_GO rows as non-actionable after their detection session expires  
   — Prevents valid-at-detection rows from being served as ready on subsequent days.

4. **Apply Fix E** (optional hardening): tie `normalizeStatus` to trigger presence  
   — Makes the API honest about actionability independent of the trigger field value.

5. **Do not apply Fix D** immediately — the watch/actionable split is the correct long-term architecture but requires MCP contract changes and is out of scope for the immediate fix.

---

## 9. Tests Needed

### Unit tests

| Test | File | What to assert |
|---|---|---|
| `ingestOpportunitiesFromScan` writes `entryTriggerPrice = resistance` | `server/opportunity-service.test.ts` | When `ScanResult.resistance` is set, stored row has matching `entryTriggerPrice` |
| `ingestOpportunitiesFromScan` writes `entryTriggerPrice = null` when resistance is null | Same | `resistance: null` → `entryTriggerPrice: null` (no fabrication) |
| `toInternalSetup` sets `trigger` from `entryTriggerPrice` | `server/routes/internal-scanner.test.ts` | `entryTriggerPrice=150.5` → `trigger.price===150.5` |
| `toInternalSetup` falls back to `resistancePrice` for trigger when `entryTriggerPrice` is null | Same | `entryTriggerPrice=null, resistancePrice=150.5` → `trigger.price===150.5` |
| `toInternalSetup` trigger is null only when both fields are null | Same | `entryTriggerPrice=null, resistancePrice=null` → `trigger===null` |
| `normalizeStatus` emits `ready` only when trigger price is present (if Fix E is applied) | Same | ACTIVE+READY+null trigger → `forming` |
| ORB/GAP_AND_GO rows from prior session → not served as `ready` (if Fix C is applied) | Same | Prior-day ORB row → not `ready` |

### Integration / regression tests

| Test | What to assert |
|---|---|
| End-to-end: scan result → opportunity → `/opportunities` response → `trigger` populated | Full pipeline: resistance from scan reaches `trigger` in API response |
| Webhook automation path still populates `entryTrigger: scanResult.resistance` | `server/routes.ts:6021` regression guard |
| MCP exclusion count drops from 50 to ≤ expected after fix is applied | Against a real or stubbed MCP response |

---

## 10. Whether the Current Ranker Is Behaving Correctly

**Yes.** The deployed MCP ranker is behaving correctly.

Excluding a stored opportunity as `NOT_ACTIONABLE_NO_TRIGGER` when its `trigger` field is null is the correct, safe behavior. The ranker must not fabricate a price or use the `technicalObjective` (resistance label) as a substitute trigger without an explicit contract change. The 50 stored rows genuinely had no actionable trigger price — excluding them rather than promoting them to trade candidates is the right outcome.

The fault is entirely upstream: the ingestion function never writes `entry_trigger_price` even though the value exists in the `ScanResult`. The ranker, the API adapter, and the exclusion-accounting consumer in VCP Trader are all working correctly.

---

## Appendix — Key Files

| File | Role |
|---|---|
| `server/strategies/*.ts` | Strategy implementations — produce `ScanResultOutput.levels.entryTrigger` |
| `server/strategies/types.ts:105–118` | `ScanResultOutput` type |
| `shared/schema.ts:70–98` | `scanResults` table / `ScanResult` type — no `entryTrigger` column |
| `shared/schema.ts:127–166` | `opportunities` table — has `entry_trigger_price` column |
| `server/scheduled-scan-service.ts:103–135` | `quotesToScanResults` — drops `entryTrigger`, keeps `resistance` |
| `server/opportunity-service.ts:26–87` | `ingestOpportunitiesFromScan` — **line 57: root cause** |
| `server/routes/internal-scanner.ts:194–231` | `toInternalSetup` — maps `entryTriggerPrice→trigger`, `resistancePrice→technicalObjective` |
| `server/routes/internal-scanner.ts:122–141` | `normalizeStatus` — stage-based, trigger-price-agnostic |
| `server/routes/internal-scanner.ts:405–508` | `/api/internal/scanner/opportunities` — endpoint MCP ranker calls |
| `server/routes.ts:6013–6035` | Webhook automation path — correctly maps `scanResult.resistance` as `entryTrigger` |
| `server/mcp/strategy-contract-adapter.ts:23–68` | Internal strategy ID → MCP slug mapping |
| `server/routes/ranked-trade-search.ts` | Exclusion accounting — correctly surfaces `NOT_ACTIONABLE_NO_TRIGGER` |
