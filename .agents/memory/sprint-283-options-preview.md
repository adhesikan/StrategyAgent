---
name: Sprint 2.8.3 — Options / Multi-Leg Order Preview
description: Key design decisions and invariants for the options order preview engine and types.
---

## Non-Executable Boundary

`OptionsOrderPreview.executable` is `false as const` — type-level invariant that cannot be overridden. Same pattern as `EquityOrderPreview`.

**Why:** Prevents type-system collisions with a future `ConfirmedOrderIntent` or `BrokerSubmissionRequest`. The types must never be assignable to each other.

**How to apply:** Every code path that creates an `OptionsOrderPreview` must set `executable: false as const`. No conditional assignment.

## selectedBy Always USER

The `selectedBy` field is always `"USER"` — read from the Trade Plan, never accepted from the client. This is enforced at the type level: `selectedBy: "USER"` (literal type) in `OptionsOrderPreview`.

## Options Instrument Type Gate

Instrument type must be OPTION or MULTI_LEG_OPTION. If the draft instrument type is EQUITY → `WRONG_INSTRUMENT_TYPE` blocker. Use Equity Order Preview for EQUITY drafts.

## Options Broad Expression Gate

broadExpressionType must be one of: LONG_OPTIONS, COVERED_CALL, CASH_SECURED_PUT, DEFINED_RISK_OPTIONS, INCOME_OPTIONS, NEUTRAL_OPTIONS, ADVANCED_OPTIONS, EXPLORE_COMPATIBLE_STRUCTURES. If STOCK → `WRONG_EXPRESSION_TYPE` blocker.

## Net Debit/Credit Sign Convention

```
Long legs  → pay premium (DEBIT direction)
Short legs → receive premium (CREDIT direction)
net = Σ(short midpoints × ratio) - Σ(long midpoints × ratio)
if net >= 0 → CREDIT; if net < 0 → DEBIT
amount = |net| — always positive
amountPerContract = amount × multiplier (100 default)
totalAmount = amountPerContract × quantity
```

**Why:** Options pricing sign convention varies across providers; canonical model uses economic direction (DEBIT/CREDIT + positive amount) to avoid sign confusion in UI and downstream code.

## Multiplier

Always 100 for standard US equity options. Stored as `leg.multiplier` in `OptionsPreviewLeg`. Do not use any other value unless the contract metadata explicitly provides a different multiplier.

## No Leg Decomposition

Multi-leg structures (MULTI_LEG_OPTION) must NEVER be decomposed into separately submitted legs even when the provider lacks native multi-leg support. In that case: generate `MULTI_LEG_NOT_SUPPORTED` warning (not blocker), show read-only preview, block future execution progression. No `MULTI_LEG_NOT_SUPPORTED` blocker — only a warning.

**Why:** Legging multi-leg structures introduces execution risk, slippage, and partial-fill risk. The architecture explicitly prohibits it until Sprint 2.8.5 native multi-leg confirmation.

## EXPIRED vs UNAVAILABLE (same as equity preview)

Expired draft → `status: "EXPIRED"`, not "UNAVAILABLE". Pass `status: "EXPIRED"` explicitly to `buildUnavailablePreview`. EXPIRED and UNAVAILABLE have different remediation paths (regenerate vs investigate).

## Route Order: Static Before Dynamic

`GET /api/execution/options-preview/health` must be registered BEFORE `GET /api/execution/order-drafts/:draftId/options-preview` to prevent Express treating "health" as a draftId. This is already done in `options-preview.ts` by placing the health route first.

## Test File Location

`server/routes/__tests__/options-preview.test.ts` — run with:
```
npx vitest run --root . server/routes/__tests__/options-preview.test.ts
```
Or via: `npm run test:options-preview`

## DB Impact

No new tables. Preview is ephemeral. Audit events reuse `execution_audit_events`. `ensureOptionsPreviewTables()` is a no-op.

## Quote Freshness Threshold

Material quote change threshold for options: ≥2% (`OPTIONS_QUOTE_MATERIAL_THRESHOLD_PCT`). Wide spread threshold: >15% bid/ask spread relative to midpoint (`OPTIONS_WIDE_SPREAD_THRESHOLD_PCT`). Near-expiration warning: ≤7 DTE (`OPTIONS_DTE_NEAR_EXPIRATION`).

## Methodology Version

`"2.8.3"` — required in every `OptionsOrderPreview` response. Tested in compliance suite.
