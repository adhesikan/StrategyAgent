---
name: Sprint 2.8.2 — Equity Order Preview
description: Non-executable equity order preview engine — key invariants, TS fixes, and architecture decisions
---

# Sprint 2.8.2 — Equity Order Preview

## Status
COMPLETE. 773 tests / 14 suites passing.

## Permanent Invariants
- `executable: false as const` — type-level; impossible to override
- `expressionType === "STOCK"` enforced before any computation; `WRONG_EXPRESSION_TYPE` blocker otherwise
- `expressionSelectedBy === "USER"` — always read from trade plan, never from client
- Draft values (limitPrice, quantity, sideIntent, orderType, TIF) NEVER mutated by preview
- No broker mutation: `placeOrder`, `submitOrder`, `replaceOrder`, `cancelOrder` never called
- Client injection blocked: 18 forbidden fields rejected at route layer before any service call
- No confirmation/submission CTA: Sprint 2.8.5 only

## Key Decisions

### `buildUnavailablePreview` status override
`buildUnavailablePreview` accepts `ctx?: { tradePlanId?: string; status?: EquityPreviewStatus }`.
Expired drafts pass `status: "EXPIRED"` explicitly — otherwise the function defaults to `"UNAVAILABLE"`.
**Why:** Tests (and spec) distinguish EXPIRED (draft found but past expiresAt) from UNAVAILABLE (draft not found at all).

### QUOTE_MOVED does NOT promote to REQUIRES_REVIEW
`QUOTE_MOVED` is a warning only. It does NOT trigger status promotion.
Only `PREFLIGHT_EXPIRY_APPROACHING` promotes VALID → REQUIRES_REVIEW via warnings.
**Why:** A moved quote should be surfaced to the trader but doesn't block review; the warning panel already shows it prominently. Keeping VALID enables clean happy-path tests without matching draft/current midpoints.

### Preview is ephemeral — no new DB table
Computed on demand per request. Audit events use existing `execution_audit_events` table.

### activeDraftId in trade-planning.tsx
Sourced from `?draftId=` URL query param via `useMemo + window.location.search`.
Panel shown when `selectedFamily === "equity" || "equity_scaled"` AND `activeDraftId` is set.

## File Map
- `shared/equity-order-preview-types.ts` — types, constants, forbidden labels
- `server/services/equity-preview-service.ts` — pure computation engine
- `server/routes/equity-preview.ts` — 4 read-only routes
- `server/routes/__tests__/equity-preview.test.ts` — 136 tests
- `client/src/components/execution/EquityOrderPreviewPanel.tsx` — full UI
- `docs/operations/40-equity-order-preview.md` — architecture doc

## Test Count History
Sprint 2.8.0: 401 | 2.8.1: 536 | 2.8.1A: 637 | 2.8.2: 773
