---
name: Research Package page
description: Sprint 2.1 — /opportunity/:symbol page architecture, data contract, and compliance constraints.
---

## Route
- Client: `/opportunity/:symbol` (wouter) — avoids collision with existing `/research/:id` saved-research detail page
- Server: `GET /api/opportunities/research/:symbol` (authenticated)

## Server assembly
- One endpoint fans out: `getLatestValidSnapshot`, `getPreviousValidSnapshot`, `storage.getBrokerConnection(userId)`, `getSymbolHistory(sym, 10)` all in parallel via `Promise.all`
- `findCandidateInSnapshot` checks `topGrowth` + `topIncome`; prefers lowest rank when symbol appears in both
- Lifecycle diff uses the same `compareSnapshots` path as `/api/opportunities/changes`; `lifecycleItem` is null when no previous scan
- Freshness uses same 1.5× threshold as `opportunity-latest` route; imports `getIntervalMs` from `opportunity-engine`
- Returns 404 with `code: "NO_SNAPSHOT"` or `code: "SYMBOL_NOT_FOUND"` for graceful client handling

## Client data flow
- Two `useQuery` calls: `/api/opportunities/research/:symbol` + `/api/dashboard` (market context reuse)
- `retry` callback skips retries on 404 (symbol genuinely absent from scan)
- 404 renders `SymbolNotFound` component, not an error state

## Compliance invariants
- No "buy", "sell", "recommendation", "expected profit", "target return" anywhere in the file
- Price/level fields are labeled "educational planning" or "not a trade recommendation"
- InstaTrade™ section is read-only planning display; `brokerConnected === false` → shows "Connect Brokerage" prompt
- `InstaTradePanel` navigates to `/instatrade` — never submits an order

## Entry points
- `StockOpportunityCard` in dashboard.tsx: "Research" button → `/opportunity/:symbol`
- data-testid: `btn-research-{symbol}`

## Test file
- `server/routes/opportunity-research.test.ts` — 22 tests; mocks storage, snapshot-store, opportunity-engine

**Why:** The page has strict compliance requirements that must not be broken by future edits. Any change adding financial outcome language, fabricated prices, or direct execution capability violates the educational-only constraint.

**How to apply:** Before editing opportunity-research.tsx or the server route, re-read the compliance invariants above and verify the modified text doesn't introduce prohibited language.
