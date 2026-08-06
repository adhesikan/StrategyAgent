---
name: Radar hash-fallback removal
description: Policy 3B enforcement — deterministic hash prices removed from the Opportunity Radar; unavailableQuoteCount tracks excluded symbols.
---

## Rule
`buildStoredQuote` (formerly `buildMockQuote`) returns `QuoteData | null`. When no stored bars exist for a symbol (EMPTY error or empty array), it returns null — the symbol is excluded from candidates entirely. No hash-derived fake prices are ever substituted.

## Why
The hash fallback was reachable via normal authenticated production workflows (`/api/radar/scenarios`, `/api/daily-ideas`, Ask AI best-trades). Policy 3B: if reachable in production, remove the fallback and return an honest unavailable result.

## How to apply
- `UserContext` and `RadarResult` both have `unavailableQuoteCount: number`
- The "simulated" dataMode note is now supplemented by an "excluded" note when unavailableQuoteCount > 0
- `getHistoricalBars` must always be called with `purpose:"scan"` and `allowExternalRefresh:false` from the radar path
- Regression tests: `server/services/opportunity-radar/radar-service-build-stored-quote.test.ts` (13 tests)
