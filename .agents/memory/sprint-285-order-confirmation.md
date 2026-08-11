---
name: Sprint 2.8.5 — Review, Consent & Final Order Confirmation
description: Architecture decisions and invariants for the final order review and confirmation layer.
---

## Workflow Position

```
Options Preview (2.8.3) → Execution Readiness (2.8.4) → Final Review (2.8.5) → Broker Submission (2.8.6)
```

## Core Invariant (user-stated)

**Confirmation cannot survive a changed preview or changed readiness result.**

This is enforced by: `revalidateBeforeConfirm()` checks `executionReadinessId` and `orderPreviewId` before accepting any confirmation. Any mismatch → `CR_CONFIRMATION_REVIEW_REQUIRED` or `CR_PREVIEW_CHANGED`.

## Snapshot Hash

SHA-256 of `sortObjectKeys(canonicalPayload)` where payload = `{tradePlanId, orderPreviewId, executionReadinessId, userId, strategyFamily, symbol, legs, quantity, pricing, economics, readiness, marketDataObservedAt, reviewedDataVersion}`.

Excluded (volatile): id, createdAt, expiresAt, invalidatedAt, invalidationReason, state.

## TTL Policy

Default 120s (`DEFAULT_FINAL_REVIEW_CONFIG.snapshotTtlSeconds`). This is intentionally short — options quotes move fast.

**Why:** v1 is conservative. Any price change at confirm time invalidates. netPriceTolerance=0.

## makeSnapshot() in Tests

`makeSnapshot()` must use `new Date()` (current time), NOT a fixed past date. Using a fixed past date causes snapshots to be expired when tests run. Tests needing a fixed time for hash determinism call `buildFinalOrderReviewSnapshot()` directly with explicit `now`.

## Acknowledgements

Determined from order structure only (no LLM). All codes in `ACKNOWLEDGEMENT_DEFINITIONS` in `shared/order-confirmation-types.ts`. ACK_SHORT_ASSIGNMENT triggered by `isShortIntent(intent)` (contains "SHORT").

## Client Field Guard

Forbidden fields → HTTP 400 `CR_FORBIDDEN_FIELD`. Same pattern as 2.8.4. Client sends ONLY `acknowledgementCodes: string[]` to the confirm route.

## DB Tables

3 new raw-SQL tables: `final_order_review_snapshots`, `order_confirmations` (UNIQUE on snapshot_id+user_id), `order_confirmation_audit_events`. Created via `ensureOrderConfirmationTables()` at startup.

## Options Preview Import

The routes file imports `generateOptionsPreview` (not `generateOptionsOrderPreview`) from `../services/options-preview-service`. Dynamic import used to avoid circular dependency.

## Compliance Labels

Forbidden: APPROVED, AUTHORIZED, RECOMMENDED, GUARANTEED, SAFE TRADE, AI APPROVED, TRADE APPROVED.
Allowed: Ready for Review, Ready with Warnings, Blocked, Confirmed, Order Confirmed, Ready for the next submission step.

Button: "Confirm Order for Submission" (means future submission step, not current execution).
Note: "Confirmation does not send the order to your broker."
