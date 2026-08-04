---
name: Scanner trigger contract fix
description: Root cause and fix for all 50 stored opportunities being excluded as NOT_ACTIONABLE_NO_TRIGGER by the MCP ranker.
---

# Scanner Trigger Contract Fix

## The Rule
`sanitizeTriggerPrice(result.resistance)` must be used for `entryTriggerPrice` in `ingestOpportunitiesFromScan` — not hardcoded null. The resistance level from the scanner IS the breakout trigger for all 9 local strategies.

**Why:** `ingestOpportunitiesFromScan` hardcoded `entryTriggerPrice: null` (opportunity-service.ts:57). MCP requires a non-null trigger to qualify a row. The webhook/automation path already mapped `scanResult.resistance → entryTrigger` correctly; the scheduled path did not.

## How to Apply
- `sanitizeTriggerPrice`: rejects NaN, Infinity, zero, negatives. Accepts only finite positive numbers.
- `toInternalSetup` fallback: `triggerPrice = num(entryTriggerPrice) ?? num(resistancePrice) ?? null` — covers legacy rows with null entryTriggerPrice.
- `resistancePrice` appears in BOTH `trigger` and `technicalObjective` on legacy rows — documented limitation, not a bug.
- `actionable: boolean` field added to `InternalSetup` — must be checked before treating a setup as tradeable. `true` only when trigger non-null, status ACTIVE, and not session-expired.

## Intraday Session Expiry
`INTRADAY_SESSION_STRATEGIES = { ORB5, ORB15, GAP_AND_GO }` — these strategies detect opening-range triggers valid only for the ET session of detection. After the session ends `isSessionExpired()` returns true; `resolveOpportunities()` marks them EXPIRED.

## Backfill
`server/scripts/backfill-trigger-prices.ts` — dry-run + apply mode. 7 strategies are `PRICE_TRIGGER_SAFE_TO_BACKFILL`; ORB5/ORB15/GAP_AND_GO are `SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW` (skipped). Never runs at startup.
