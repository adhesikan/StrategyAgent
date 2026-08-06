---
name: Live Contract Resolver
description: Sprint 2.2.2 — architecture, constraints, and integration points for the live options contract resolution feature.
---

# Live Contract Resolver

## What it does
Converts illustrative options structures (from TradeStructureEngine) into verified, currently-listed option-contract candidates using the user's connected broker. Explicit user action only — never auto-fetches on page load.

## Key files
- `server/services/live-contract-resolver.ts` — all pure computation + orchestrator
- `server/routes/live-contract-resolver.ts` — API routes + Zod validation
- `client/src/components/research/structure/live-contract-resolver.tsx` — UI component
- `server/routes/live-contract-resolver.test.ts` — 79 server tests (A–K)
- `client/src/components/research/structure/live-contract-resolver.test.tsx` — 25 client tests (L–N)

## API
- `GET /api/options/broker-capability` — lightweight capability check, no chain fetch
- `POST /api/options/resolve-contracts` — full resolution; accepts snake_case structure name, targetDte, strikeGuidance, referenceLevels

## Supported structures
`long_call`, `bull_call_spread`, `bull_put_spread`, `cash_secured_put`, `covered_call`, `protective_put`.
All others return `status: "unsupported_structure"` — never 500.

## Status codes
`resolved | partial | broker_not_connected | capability_unavailable | unsupported_structure | chain_unavailable | no_matching_expiration | no_matching_strike | pricing_unavailable | error`

## Broker capability flags added
`optionQuotes?`, `multiLegOptions?`, `execution?` added to `BrokerCapabilities`.
Tradier + TradeStation: `optionsChain: true, optionQuotes: true, greeks: true, multiLegOptions: false, execution: true`.
Schwab: all false (options unsupported).

## Strike guidance strings (API)
`near_atm | one_strike_itm | otm_2_5 | near_support | near_resistance | near_breakout | near_technical_objective | near_objective | short_strike_near_objective | below_short_put`

## Chain cache
In-memory Map keyed by `userId:symbol:expiration`, TTL 2 min. Evicted lazily.

## Client integration point
`LiveContractResolver` sits below `TradeStructureEngine` in the Trade Planning tab of `opportunity-research.tsx`. It derives structures by calling `deriveOptionsStructures(pkg, deriveThesis(pkg, stars))` inline.

**Why:** Deriving structures inline avoids prop-threading through TradeStructureEngine; the derivation is pure and fast.

## Compliance invariants
- No "Recommended Contract", "Buy this", "Expected profit" language anywhere in responses or UI
- All pricing labeled with basis: "Calculated midpoint (bid + ask) / 2" or "Ask price (midpoint unavailable)"
- "Estimated from displayed quotes. Actual execution price may differ."
- `maxGain` for long_call = "Theoretically unlimited (benefit from unlimited price appreciation)"
- No order submission from this component
- Stale reference never causes ratio misclassification

## Test patterns
- Server tests: injectable deps pattern (same as internal-options.test.ts)
- Client tests: pure helper functions only (no @testing-library/react — not installed)
- `FRESH_TS = new Date(Date.now() - 5 * 60 * 1000).toISOString()` in server fixture to avoid stale-quote test flakiness
