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

## Reference resolution (`server/services/price-reference-resolver.ts`)
Deterministic precedence: broker quote → internal history close → unavailable.
Conflict tolerance ±40% between broker and history (catches 2×/10× but not normal intraday gaps).
Boundary is inclusive (`<=`/`>=`): ratio exactly 0.60 or 1.40 IS a conflict.

**Why:** Disconnected users had `PRICE_REFERENCE_UNAVAILABLE` always blocking saves, even when history was clean.

## Safety contract
- `safeIntegrityResult()` MUST be called before attaching to any response — strips `setupPrice` and `referencePrice` fields (server-log only, never client).
- Raw prices are logged under event `multi_strategy_price_integrity_failed`.
- Resolver `_brokerPrice` / `_historyClose` fields are server-only — never forward to client.

## Gating in ask.ts
1. `resolveReferencePrice()` called after `runMultiStrategyAnalysis`.
2. Conflict → `code: "PRICE_REFERENCE_CONFLICT"`, valid:false, save blocked.
3. `_priceIntegrityBlocked = multiStrategy?.priceIntegrity?.valid === false` gates researchSave handle minting.
4. GPT `mcpSystemRules` gets `PRICE INTEGRITY OVERRIDE` when integrity fails.
5. Observability: `event: price_reference_resolved` logged on every check (safe fields only).

## Source independence caveat
Both MCP and the history fallback may use Twelve Data. This is a cross-SERVICE consistency check, not a fully independent vendor check. Document this — do not claim vendor independence.

**How to apply:** Any new flow that uses MCP setup prices as trusted values should run `checkPriceIntegrity` before persisting or displaying those values.
