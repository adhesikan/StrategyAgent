---
name: Quote timestamp contract
description: Execution preflight quote freshness — never substitute fetch time for a missing market timestamp; fail closed on absent/invalid timestamps.
---

## Rule
When the broker returns a quote with no trade timestamp (`asOf` is absent/null/NaN):
- Pass `asOf: null` into `validateQuoteForPreflight` — never `|| new Date().toISOString()`
- `freshnessSec` becomes `Infinity` → `isStale = true` → `isFresh = false` → QUOTE_STALE blocker
- UI note must say "Quote timestamp unavailable." — never "0s old."

**Why:** Substituting fetch time (`new Date()`) when the provider gives no timestamp makes a stale market quote appear fresh (age ≈ 0). After hours, Tradier returns the last trade time (~16:00 ET), making the quote correctly ~2h+ old. The "0s old" bug was caused by `getBrokerQuote` being absent from `broker/index.ts`, making `quote = null`, then the adapter silently substituting fetch time.

## How to apply
- `getBrokerQuote(userId, symbol)` in `server/broker/index.ts` is the canonical entry point (calls `tradierGetBatchQuotes`/`tsGetBatchQuotes` per provider).
- Tradier: extract `q.trade_date` (ms) or `q.tradetime` (s); add to `StockQuote.asOf`.
- TradeStation: extract `q.TradeTime`/`q.LastTradedTime`; add to `StockQuote.asOf`.
- `validateQuoteForPreflight`: guard `NaN` dates — `isFinite(rawMs)` check required; empty strings treated as null.
- `BrokerQuoteValidation.asOf` is `string | null` — callers must handle null.
- `formatPreflightQuoteAge(freshnessSec)`: Infinity/NaN/negative → "Quote timestamp unavailable."; ≥3600s → "Last market quote is Xh Ym old."; <3600s → "Quote is Xs old."
- 39 deterministic tests in `server/services/__tests__/quote-freshness.test.ts` (§6 A–H plus §I–§P).
- Regular-session UAT still required: quote should PASS when freshly fetched during market hours.
