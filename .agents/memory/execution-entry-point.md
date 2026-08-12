---
name: Execution entry point — trade-plan-detail.tsx
description: How the "Prepare for Execution" CTA and downstream execution panels are wired into the Trade Plan Detail page for EQUITY plans.
---

## The rule

`trade-plan-detail.tsx` is the canonical execution entry point for saved Equity Trade Plans. The full 4-step pipeline (Preflight → Order Prep → Equity Preview → Final Review) must all be present in this file. Any new execution step added to `trade-planning.tsx` must also be added here if it belongs in the equity pipeline.

## Why

During Defect-8 (Sprint 2.8.6A), `EquityOrderPreviewPanel` and `FinalOrderReviewPanel` were only mounted in `trade-planning.tsx` gated on a `?draftId=` URL search param. The equity pipeline silently terminated at `OrderPreparationPanel` in the detail page with no forward path.

## How to apply

- CTA gate: `brokerConnected && plan.planType === "EQUITY" && plan.status !== "ARCHIVED"` → toggle `showExecution`
- `activeDraft` query key `["order-draft", id]` is shared with `OrderPreparationPanel` — cache propagates automatically
- Downstream panels gate: `activeDraftId && preflightData?.overallStatus === "PASS" && !preflightData.isExpired`
- `FinalOrderReviewPanel.onConfirmed` shows a toast — Sprint 2.8.6 execution creation via `POST /api/executions/from-confirmation/:cid` is a separate user step
- TEST_LIVE allowlisting is a submission gate only — it must NOT block the CTA or any research display step
- `showExecution` is a `useState(false)` toggle; AI/agents cannot set it (verified by §EP19a regression test)

## Regression test

`server/routes/__tests__/execution-entry-point.test.ts` — §EP1–§EP25 (38 tests). In `test:release`. Run whenever `trade-plan-detail.tsx` or any execution panel is changed.
