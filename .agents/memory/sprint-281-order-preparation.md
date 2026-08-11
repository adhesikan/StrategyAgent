---
name: Sprint 2.8.1 — Order Preparation Engine
description: Key decisions and invariants for the non-executable OrderDraft builder.
---

## Core Invariant

`OrderDraft.executable` is **always `false`** at the TypeScript type level.
`OrderDraft` cannot satisfy future `BrokerSubmissionRequest` — three permanently separate types.

**Why:** Prevents accidental "is this ready to submit?" logic and keeps non-execution guarantee type-checked.

## Type Hierarchy

`OrderDraft` → `ConfirmedOrderIntent` (2.8.5) → `BrokerSubmissionRequest` (2.8.5) — never collapse.

## Preflight Gating

Only `PASS` preflight proceeds. `REQUIRES_REVIEW`, `FAIL`, `UNAVAILABLE`, `EXECUTION_DISABLED` → `PREFLIGHT_NOT_PASSING` blocker.

**Why:** Spec §7 chose strict gating over allowing REQUIRES_REVIEW through.

## Plan Version Binding

`plan.updatedAt > preflight.evaluatedAt` → `TRADE_PLAN_VERSION_CHANGED` blocker (no schema change needed — computed at runtime).

## Lifecycle Blockers

`THESIS_INVALIDATED` and `DATA_STALE` → `LIFECYCLE_CHANGED` blocker. Others proceed (may add warnings).

## Quantity Rule

`hypotheticalSizing.effectiveScenarioShares` is **reference only** — never auto-used as order quantity.
`confirmedQuantity` is always explicit user input. Enforced at type level.

## Leg Intent Mapping

- `long_leg` / `wing_long` → `OPEN_LONG`
- `short_leg` + covered_call/collar → `OPEN_SHORT_COVERED`
- `short_leg` + cash_secured_put → `OPEN_SHORT_SECURED`
- `short_leg` (other spreads) → `OPEN_SHORT_COVERED`
- `wing_short` → `OPEN_SHORT_COVERED`

Provider vocabulary (BUY_TO_OPEN, etc.) deferred to Sprint 2.8.2/2.8.3.

## Feature Flags

`ORDER_PREPARATION_ENABLED` defaults **true** — independent of `BROKER_EXECUTION_ENABLED`.
Draft creation is safe while submission is disabled because drafts are non-executable.

## Idempotency

SHA-256 fingerprint of normalized inputs. DB UNIQUE (fingerprint, user_id) with ON CONFLICT DO UPDATE for safe concurrent access. Non-expired identical-fingerprint draft → return existing (`wasExisting: true`).

## Quote Snapshot

Sprint 2.8.1: live quote fetch stubbed, returns UNAVAILABLE. Full implementation Sprint 2.8.2.
`isStale: true` always set on snapshot quotes in this sprint.

## Cross-User Security

Cross-user draft GET → 404 (not 403) to prevent enumeration.
Cross-user trade plan → `TRADE_PLAN_NOT_FOUND`.
Cross-user preflight → `PREFLIGHT_MISSING`.

## Draft Expiry

15 minutes (900s). `ORDER_DRAFT_EXPIRY_SECONDS = 900`. No silent refresh — user must regenerate.

## Audit Events

ORDER_DRAFT_STARTED, ORDER_DRAFT_CREATED, ORDER_DRAFT_UPDATED, ORDER_DRAFT_INVALIDATED, ORDER_DRAFT_EXPIRED, ORDER_DRAFT_ABANDONED. Never ORDER_SUBMITTED.

## Methodology Version

`"2.8.1"` on all drafts.

## req.user Pattern

All order-preparation route handlers use `(req as any).session?.userId as string` — same as execution-preflight. Not `req.user.id` (no Express user augmentation in this project).

## `limitPriceReference` vs `limitPricePreference`

The preferences interface field is `limitPricePreference` — not `limitPriceReference`. Use the correct name in service code.

## How to Apply

- Sprint 2.8.2: consume `OrderDraft` where `instrumentType = EQUITY` for equity preview. Handoff: `OrderPreviewInput { orderDraftId, tradePlanId, preflightId }`.
- Sprint 2.8.3: consume `instrumentType = OPTION | MULTI_LEG_OPTION` for options/multi-leg preview.
- Sprint 2.8.4: lifecycle scheduler (Task #131), buying power revalidation, draft hardening.
- Sprint 2.8.5: explicit confirmation + broker submission. `OrderDraft` alone is NEVER sufficient.
