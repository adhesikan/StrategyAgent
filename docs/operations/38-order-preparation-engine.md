# Doc 38 — Order Preparation Engine (Sprint 2.8.1)

## Overview

The Order Preparation Engine converts a user-selected Saved Trade Plan + a passing
Execution Preflight into a canonical **non-executable OrderDraft** for review.

It answers: *"If this research plan were later converted into a broker order, what
would the structured order draft contain?"*

It does NOT:
- Submit an order
- Place an order
- Call any broker order endpoint
- Create an executable broker payload
- Guarantee execution

## Architecture Position

```
Saved Trade Plan
      ↓
Current Lifecycle Validation
      ↓
Execution Preflight (Sprint 2.8.0)
      ↓
Order Preparation ← Sprint 2.8.1
      ↓
Future Equity Order Preview (Sprint 2.8.2)
      ↓
Future Options/Multi-Leg Preview (Sprint 2.8.3)
      ↓
Future Validation Hardening (Sprint 2.8.4)
      ↓
Future Explicit Confirmation & Broker Submission (Sprint 2.8.5)
```

## Non-Executable Boundary

**OrderDraft** is permanently separated from future submission types:

| Type | Sprint | Purpose |
|------|--------|---------|
| `OrderDraft` | 2.8.1 | Non-executable research-derived draft |
| `ConfirmedOrderIntent` | 2.8.5 (future) | Explicit user confirmation |
| `BrokerSubmissionRequest` | 2.8.5 (future) | Broker-specific executable payload |

These three types are **never the same type**. `OrderDraft.executable` is always
`false` at the TypeScript type level. This cannot be changed to `true`.

## OrderDraft Model

```typescript
OrderDraft {
  readonly executable: false   // type-level guard — always false
  id, userId, tradePlanId, tradePlanVersion, preflightId
  brokerProvider, brokerAccountRef (server-side only), brokerAccountMasked
  brokerAccountType, instrumentType, structureType, sideIntent?
  status: "DRAFT" | "VALID" | "REQUIRES_REVIEW" | "EXPIRED" | "INVALID" | "ABANDONED"
  executionMode  // "disabled" | "sandbox" | "production"
  legs: OrderDraftLeg[]
  quantityContext   // confirmedQuantity, unit, hypotheticalPlanQuantity (reference only)
  pricingContext    // orderType, limitPriceReference, limitPriceSource
  timeInForceContext
  capitalContext    // Estimated only — broker buying power is authoritative
  riskContext       // From saved riskSnapshot — not recalculated
  quoteSnapshot     // Reference quotes at draft creation time
  freshness, marketHoursContext
  validation: OrderDraftValidation
  warnings: OrderDraftWarning[]
  blockers: OrderDraftBlocker[]
  preparationFingerprint  // SHA-256, deterministic
  version  // increments on preference updates
  createdAt, updatedAt, expiresAt  // 15-minute expiry
  methodologyVersion: "2.8.1"
}
```

Status values — never SUBMITTED, FILLED, APPROVED, READY_TO_TRADE:
- `DRAFT` — initial creation
- `VALID` — passes all validation with no blockers
- `REQUIRES_REVIEW` — blockers present (quote unavailable, account unresolved)
- `EXPIRED` — past expiresAt; user must regenerate
- `INVALID` — structural error
- `ABANDONED` — user discarded

## Type-Level Safety

`OrderDraft` cannot satisfy `BrokerSubmissionRequest` (future).

```typescript
// CORRECT — always false:
const d: OrderDraft = { executable: false, ... };

// IMPOSSIBLE at type level — catches future mistakes:
// const d: OrderDraft = { executable: true, ... };  // TypeScript error
```

## OrderDraft Source Requirements

Every OrderDraft requires:

1. **Saved Trade Plan** — must belong to authenticated user
2. **Current Execution Preflight** — must belong to same user, same Trade Plan, not expired, status = PASS
3. **Quantity** — explicit user input; hypothetical plan sizes are never auto-used
4. **Account** — from server preflight result, not client input

## Source Validation Chain

```
1. ORDER_PREPARATION_ENABLED flag check
2. Trade Plan ownership check
3. Trade Plan status check (not ARCHIVED)
4. Preflight ownership check (cross-user → PREFLIGHT_MISSING, not 403)
5. Preflight expiry check (validUntil)
6. Preflight status check (PASS only for 2.8.1)
7. Trade Plan version check (plan.updatedAt > preflight.evaluatedAt → VERSION_CHANGED)
8. Lifecycle state check (THESIS_INVALIDATED, DATA_STALE → LIFECYCLE_CHANGED)
9. Quantity validation
10. Order type validation (MARKET or LIMIT only)
11. TIF validation (DAY or GTC only)
12. Limit price validation (required for LIMIT)
13. Leg construction from structure snapshot
14. Quote snapshot (injectable, defaults UNAVAILABLE in Sprint 2.8.1)
15. Fingerprint computation
16. Idempotency check (existing non-expired draft with same fingerprint → return existing)
17. Persist + audit
```

## Preflight Requirements

| Preflight Status | Order Preparation Result |
|-----------------|--------------------------|
| PASS | Proceeds normally |
| REQUIRES_REVIEW | PREFLIGHT_NOT_PASSING blocker (user must resolve and rerun) |
| FAIL | PREFLIGHT_NOT_PASSING |
| UNAVAILABLE | PREFLIGHT_NOT_PASSING |
| EXECUTION_DISABLED | PREFLIGHT_NOT_PASSING |
| Expired (validUntil < now) | PREFLIGHT_EXPIRED |

## Trade Plan Version Binding

If `plan.updatedAt > preflight.evaluatedAt`:
→ `TRADE_PLAN_VERSION_CHANGED` — preflight is stale relative to plan version.

User must rerun preflight for the current plan version.

## Lifecycle Validation

| Plan Health | Order Preparation |
|-------------|-------------------|
| CURRENT | Proceeds |
| CHANGED | Proceeds |
| REQUIRES_REVIEW | Proceeds (user warned) |
| THESIS_INVALIDATED | LIFECYCLE_CHANGED blocker |
| DATA_STALE | LIFECYCLE_CHANGED blocker |
| UNKNOWN | Proceeds |

## Instrument Types

- `EQUITY` — from Trade Plan planType = EQUITY
- `OPTION` — options plan with single leg
- `MULTI_LEG_OPTION` — options plan with 2+ legs (spread)

Future: futures, crypto are not supported.

## Canonical Leg Intent (not broker-specific BUY/SELL)

Research → Draft mapping:

| Research Role | Strategy Family | Draft Leg Intent |
|---------------|----------------|------------------|
| long_leg | any | OPEN_LONG |
| wing_long | any | OPEN_LONG |
| short_leg | covered_call, collar | OPEN_SHORT_COVERED |
| short_leg | cash_secured_put | OPEN_SHORT_SECURED |
| short_leg | other (spreads) | OPEN_SHORT_COVERED |
| wing_short | any | OPEN_SHORT_COVERED |

Provider-specific vocabulary (BUY_TO_OPEN, SELL_TO_OPEN, etc.) is deferred to Sprint 2.8.2/2.8.3 provider translation.

## No Naked Short Creation

Order Preparation never downgrades:
- Covered Call → uncovered short call
- Cash-Secured Put → naked put

If coverage/cash validation is missing from preflight → `COVERAGE_NO_LONGER_VALID` blocker.

## Quantity

**Hypothetical plan sizes are NOT automatically used as order quantities.**

`quantityContext.hypotheticalPlanQuantity` carries the plan's research sizing for reference.
`quantityContext.confirmedQuantity` is the user's explicit input.

These two values are intentionally separate. The distinction is enforced at the type level.

## Order Types Supported

| Type | Sprint 2.8.1 |
|------|-------------|
| MARKET | Supported (with mandatory warning) |
| LIMIT | Supported |
| STOP | Future |
| STOP_LIMIT | Future |

Market order mandatory warning:
> "Market orders do not guarantee an execution price. The final execution price may differ from currently displayed quotes."

## Time in Force

| TIF | Sprint 2.8.1 |
|-----|-------------|
| DAY | Supported |
| GTC | Supported (options: provider-dependent note) |
| IOC/FOK/GTD | Future |

## Extended Hours

`extendedHoursRequested` defaults `false`.
`extendedHoursSupported` is `false` for Sprint 2.8.1 (neither Tradier nor TradeStation validated for extended hours in this sprint).

## Quote Snapshot

Quotes are stored as references at draft creation time:
- `quoteSnapshot.underlying` — underlying equity quote (if available)
- `quoteSnapshot.optionLegs` — per-leg quotes (if available)
- `quoteSnapshot.freshnessStatus` — FRESH / AGING / STALE / UNAVAILABLE

Quote disclaimer (always displayed):
> "Quotes shown are references used to prepare this draft. Quotes can change before any future order is submitted."

In Sprint 2.8.1, live quote retrieval is stubbed (returns UNAVAILABLE) — full implementation in Sprint 2.8.2.

## Draft Expiry

`expiresAt = createdAt + ORDER_DRAFT_EXPIRY_SECONDS (900s = 15 minutes)`

After expiry, user must create a new draft. No silent refresh allowed (no economic changes without user action).

## Preparation Fingerprint

SHA-256 of normalized: userId + tradePlanId + tradePlanVersion + preflightId + provider + accountRef + instrumentType + structureType + legSymbols + quantity + orderType + TIF + limitPrice + limitPriceSource.

Fingerprint changes when any user-editable order parameter changes.

**The fingerprint is NOT a broker client order ID.** This distinction is documented for Sprint 2.8.5.

## Idempotency (Current Sprint)

If a non-expired draft with the same fingerprint exists:
- Return existing draft (wasExisting=true)
- Do not create duplicate row

Concurrent identical POST requests use a DB UNIQUE constraint on (fingerprint, user_id) with ON CONFLICT DO UPDATE for safe concurrent access.

## Persistence

Table: `order_drafts`

```sql
id            VARCHAR PRIMARY KEY
user_id       TEXT NOT NULL
trade_plan_id VARCHAR NOT NULL
trade_plan_version INTEGER NOT NULL
preflight_id  VARCHAR NOT NULL
provider      TEXT NOT NULL
account_ref   TEXT NOT NULL  -- server-side only, not client-exposed
instrument_type TEXT NOT NULL
structure_type TEXT NOT NULL
draft_json    JSONB NOT NULL  -- full OrderDraft
fingerprint   TEXT NOT NULL
status        TEXT NOT NULL
version       INTEGER NOT NULL DEFAULT 1
created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
expires_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (fingerprint, user_id)
```

No broker order ID. No execution status. No fill data.

## Audit Events

Events (append-only, safe metadata only):

| Event | Trigger |
|-------|---------|
| ORDER_DRAFT_STARTED | Start of preparation request |
| ORDER_DRAFT_CREATED | Draft persisted successfully |
| ORDER_DRAFT_UPDATED | Preferences changed via PATCH |
| ORDER_DRAFT_INVALIDATED | Draft invalidated |
| ORDER_DRAFT_EXPIRED | Draft marked expired |
| ORDER_DRAFT_ABANDONED | User deleted draft |

Never: ORDER_SUBMITTED (Sprint 2.8.5).

Safe metadata: provider, instrumentType, structureType, status, blockerCount, warningCount, durationMs, executionMode.
Never: token, balance, full account ID, position, P/L, quantity, limit price, userId beyond event-level field.

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/trade-plans/:id/execution/order-draft | Create or return existing draft |
| GET | /api/trade-plans/:id/execution/order-draft | Latest draft for Trade Plan |
| GET | /api/execution/order-drafts/:draftId | Get draft by ID |
| PATCH | /api/execution/order-drafts/:draftId | Update preferences |
| DELETE | /api/execution/order-drafts/:draftId | Abandon draft |
| GET | /api/execution/order-preparation/health | Platform health |

No `/submit`, `/place`, `/execute` endpoints exist or will be added in this sprint.

## Server-Authoritative Inputs

Client may submit:
- tradePlanId, preflightId
- quantity, orderTypePreference, timeInForcePreference
- limitPricePreference, limitPriceSource, allowExtendedHours

Client MUST NOT submit (rejected server-side):
- symbol, legs, strike, expiration, quote, bid, ask
- marketPrice, researchScore, riskAnalysis, buyingPower
- accountId, forceExecute, skipQuoteValidation, submit, execute

## Security

- Cross-user trade plan → `TRADE_PLAN_NOT_FOUND` (not 403 — prevents enumeration)
- Cross-user preflight → `PREFLIGHT_MISSING`
- Cross-user draft GET → `404`
- Forged preflight ID → `PREFLIGHT_MISSING`
- Wrong trade plan version → `TRADE_PLAN_VERSION_CHANGED`
- Client field injection → 400 (forbidden fields list enforced)

## Privacy / Logging

Logs include: provider, instrumentType, structureType, status, blockerCount, warningCount, durationMs.
Logs NEVER include: symbol (policy), account full ID, quantity, limit price, capital, P/L, option legs, user identity, tokens.

## Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| ORDER_PREPARATION_ENABLED | true | Controls draft creation (non-submission) |
| BROKER_EXECUTION_ENABLED | false | Controls actual broker submission (Sprint 2.8.5) |

**Key distinction:** Order Preparation can operate while Broker Submission is disabled,
because `OrderDraft` is non-executable. These flags are independent.

## Platform Health

Endpoint: `GET /api/execution/order-preparation/health`

Metrics: draftsCreated, activeDrafts, expiredDrafts, invalidDrafts, abandonedDrafts,
draftCreationFailures, averageDraftLatencyMs, lastDraftCreatedAt, orderPreparationEnabled,
brokerSubmissionEnabled.

No user PII, no balances, no positions, no account details.

## Compliance Disclaimer

All OrderDraft API responses include methodology version `"2.8.1"`.

Canonical disclaimer (displayed in UI):
> "Order Preparation converts a user-selected Trade Plan into a non-executable order draft for review. It does not submit an order, guarantee execution, or constitute investment advice, a recommendation, or a suitability determination."

Non-execution banner (always visible in UI):
> "Order Draft Only — Nothing has been submitted to your broker."

Forbidden UI phrases (never appear): "Confirm Order", "Confirm Trade", "Final Confirmation",
"Place Trade", "Submit Order", "Execute", "Execute Now", "Trade Approved", "Approved Trade",
"Ready to Trade", "Safe to Trade", "Recommended Order", "Guaranteed Fill", "Order Submitted",
"Buy Now", "Sell Now".

Allowed CTAs: "Save Draft", "Update Draft", "Continue to Preview — Upcoming", "Abandon Draft".

## 2.8.2 Handoff — Equity Order Preview

Sprint 2.8.2 consumes `OrderDraft` where `instrumentType = EQUITY` and displays a
broker-like preview representation. It still MUST NOT submit. Handoff type:
```typescript
OrderPreviewInput { orderDraftId, tradePlanId, preflightId }
```

## 2.8.3 Handoff — Options / Multi-Leg Preview

Sprint 2.8.3 consumes `OrderDraft` where `instrumentType = OPTION | MULTI_LEG_OPTION`.
It will show provider-aware preview semantics. Still no submission.

## 2.8.4 Hardening

Sprint 2.8.4 will add:
- Lifecycle scheduler (Task #131)
- Fresh buying power validation
- Broker permissions hardening
- Quote revalidation
- Position revalidation
- Market/tradability checks
- Draft/preflight expiration enforcement hardening
- Sandbox certification preparation

**Task #131 (lifecycle scheduler cron) is assigned to Sprint 2.8.4. Sprint 2.8.1 does not pull it in.**

## 2.8.5 Absolute Block

An `OrderDraft` alone is NEVER sufficient for broker submission. Sprint 2.8.5 requires:

- Current preflight (not Sprint 2.8.0/2.8.1 preflight)
- Validated draft
- Current validation hardening (Sprint 2.8.4 GO)
- Short-lived explicit confirmation
- Persistent idempotency
- Submission lock
- Broker translation
- Provider response handling
- Authenticated E2E PASS
- Broker sandbox submission testing

## Security Limitations (Unchanged)

- `xlsx` HIGH vulnerability: remains isolated from execution path (portfolio import only)
- SnapTrade SDK HIGH/transitive: remains isolated; SnapTrade execution is not expanded

## Operations

- Table auto-created at startup: `ensureOrderDraftTables()` runs in `registerRoutes()`
- Production migration: additive only — `CREATE TABLE IF NOT EXISTS order_drafts`
- Idempotent: safe to re-run on existing DB
- No destructive changes

## Test Coverage

- Test file: `server/routes/__tests__/order-preparation.test.ts`
- Test script: `npm run test:order-preparation`
- Target: 150+ assertions across 30 groups
- Mandatory: `brokerSpy.placeOrder = 0` asserted in every afterEach
- Included in: `npm run test:release`
