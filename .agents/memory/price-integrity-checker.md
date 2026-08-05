---
name: Price Integrity Checker
description: Ratio-based independent cross-check of MCP setup prices against VCP Trader's own live quote. Gates researchSave and GPT prompt on failure.
---

## The rule
`server/services/price-integrity-checker.ts` — `checkPriceIntegrity(setupPrice, referencePrice, source)`.

## Ratio bands
- ok: 0.85–1.15 (±15%)
- 10x: setup/ref 8–12
- 100x: setup/ref 80–120
- 0.1x: ref/setup 8–12 (inverse)
- 0.01x: ref/setup 80–120 (inverse)
- divergent: outside tolerance, not a clean decimal order

## Reference price
`ctx.tickers[0].last` — the live quote from the broker/market-snapshot route. Fetched independently of the MCP call.

**Why:** MCP fetches history from our own endpoint; comparing its output price back to our live quote is the independent cross-check.

## Safety contract
- `safeIntegrityResult()` MUST be called before attaching to any response — strips `setupPrice` and `referencePrice` fields (server-log only, never client).
- Raw prices are logged under event `multi_strategy_price_integrity_failed`.

## Gating in ask.ts
1. `multiStrategy.priceIntegrity` is set after `runMultiStrategyAnalysis` (before GPT prompt).
2. `_priceIntegrityBlocked = multiStrategy?.priceIntegrity?.valid === false` gates researchSave handle minting.
3. GPT `mcpSystemRules` gets `PRICE INTEGRITY OVERRIDE` instruction appended when integrity fails.

## Known limitation
Disconnected users have `ctx.tickers[0].last === null` → code `PRICE_REFERENCE_UNAVAILABLE` → valid:false → save always blocked. A history-close fallback would fix this but is not yet implemented.

**How to apply:** Any new flow that uses MCP setup prices as trusted values should run `checkPriceIntegrity` before persisting or displaying those values.
