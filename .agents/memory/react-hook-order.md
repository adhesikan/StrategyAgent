---
name: React hook order rule
description: React Error #310 root cause and prevention — hooks in page components must all precede early returns; use `enabled:` to gate queries, never conditional hook calls.
---

## The rule

Every React hook call in a component must execute on every render in the same order. An early return (`if (isLoading) return ...`, `if (!plan) return ...`) before a hook declaration causes the hook count to differ between renders. React detects this and throws Error #310 ("Rendered more hooks than expected").

**Why:** React tracks hooks by call order, not by name. If render 1 exits early and render 2 doesn't, the number of hooks called differs — React throws invariant violation #310.

## How to apply

- All `useState`, `useEffect`, `useQuery`, `useMutation`, `useCallback`, `useMemo`, `useRef`, and custom hooks (`useBrokerStatus`, etc.) must appear **before** any early return in the component function.
- To gate a query that should not run during loading, use `enabled: !!plan` or `enabled: !!id && !!plan` — not a conditional hook call.
- If a hook truly only makes sense for a specific plan type (e.g. equity vs options), extract it into a child component and conditionally render that component. Do NOT conditionally call the hook in the parent.
- When adding new hooks to `trade-plan-detail.tsx`, insert them **before** the `if (isLoading)` guard (currently around line 276).

## Where it happened (Defect-7)

`client/src/pages/trade-plan-detail.tsx` — 6 hooks added incrementally across Sprints 2.7.6, 2.8.0, 2.8.1 were placed after the two early returns:
- `useState("all")` — activityCategory
- `useState(false)` — isEvaluating
- `useBrokerStatus()` — brokerConnected
- `useQuery(preflight)` — execution preflight
- `useQuery(lifecycle)` — lifecycle data
- `useQuery(activity)` — activity feed

Fix: all 6 moved before `if (isLoading)`. Queries already had correct `enabled:` guards so no logic change was needed.

## Permanent regression test

`server/routes/__tests__/trade-plan-detail-hook-order.test.ts` — §HK1–§HK25 (37 tests). Added to `test:release`. Run it whenever `trade-plan-detail.tsx` changes.
