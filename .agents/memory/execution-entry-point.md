---
name: Execution entry point — trade-plan-detail.tsx
description: §10 UX invariant for the Execution Preparation section; broker-status divergence root cause; CTA visibility rules.
---

## Rule (§10 UX invariant — permanent)
The "Execution Preparation" section in `trade-plan-detail.tsx` must **always** be visible for `plan.planType === "EQUITY" && plan.status !== "ARCHIVED"` plans. It must never be silently absent.

- **Broker connected** → "Check Execution Preconditions" button (data-testid="prepare-for-execution-cta")
- **Broker disconnected** → yellow BLOCKED card (data-testid="execution-preparation-blocked") with reason: "Connect a broker account to run execution preflight…"
- **Section gate must NOT include brokerConnected** — only planType + status control whether the section renders.

**Why:** `useBrokerStatus().isConnected` (from `/api/broker/status`) and the status banner (from `/api/data-source/status`) use different API endpoints. They diverge when `isConnected` is null in the DB or on first-render context race. Gating the section on `brokerConnected` caused silent absence in production even when the header showed "Live: Tradier". This violated §10 and broke the entire execution pipeline discovery.

## Execution workflow section (inside)
`showExecution && brokerConnected && id` gate wraps the 4-step workflow:
1. ExecutionPreflightPanel (Sprint 2.8.0)
2. OrderPreparationPanel — only after preflight PASS (Sprint 2.8.1)
3. EquityOrderPreviewPanel — only when draft exists + preflight PASS (Sprint 2.8.2)
4. FinalOrderReviewPanel — same gate (Sprint 2.8.5)

`activeDraft` query shares `["order-draft", id]` cache key with OrderPreparationPanel.

## How to apply
- Any future section added to this page that has a broker-dependency must render a BLOCKED state — never silently hide.
- Never add `brokerConnected` to a section-level JSX gate — only to the inner CTA vs BLOCKED ternary.
- New hooks must be added BEFORE the `if (isLoading)` early return (React error #310 invariant).
- TEST_LIVE allowlist is a submission gate only — must never suppress the Execution Preparation section or preflight UI.

## Tests
`server/routes/__tests__/execution-entry-point.test.ts` — 52 tests (§EP1–§EP25 + §VD1–§VD10).
- §VD2 specifically asserts `brokerConnected` is absent from the 280-char window before the section heading.
- §EP2 uses a 2200-char lookback window from the CTA data-testid (BLOCKED state is ~2100 chars before).
