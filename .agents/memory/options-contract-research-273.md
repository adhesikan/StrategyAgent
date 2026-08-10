---
name: Options Contract Research (Sprint 2.7.3)
description: Live option contract pipeline — broker chain → DTE filter → liquidity → multi-leg structures → quality ordering. Sprint 2.7.3 details and critical rules.
---

## Key files
- `shared/contract-research-types.ts` — canonical types
- `server/services/contract-research-service.ts` — pure engine
- `server/routes/trade-planning.ts` — 3 new static session routes (before dynamic)
- `shared/research-glossary.ts` — CONTRACT_RESEARCH_ENTRIES (16 terms)
- `server/routes/platform-health.ts` — 9 metrics added to tradePlanning card
- `client/src/pages/trade-planning.tsx` — ContractResearchPanel

## Architecture rules (permanent)

**Why:** Any violation breaks compliance or trust boundaries.

- Selected strategy family is required — engine never auto-substitutes a different family
- No N+1: 1 `getOptionExpirations` + 1 `getOptionChain` per expiration
- Static routes registered before `/:symbol` dynamic routes (POST/GET `/session/:id/options/contracts` and `/session/:id/options/contracts/:id`)
- MIDPOINT_DISCLAIMER on every result (midpoint ≠ fill price)
- No POP: probability-engine and estimatePop() are off-limits in 2.7.3
- Missing Greeks → null; never zero-fill
- Covered call: NOT_APPLICABLE without confirmed 100 shares; never construct naked call exposure
- Calendar/diagonal → UNSUPPORTED_FAMILY (multi-expiry, future sprint)
- monitor_only → UNSUPPORTED_FAMILY

## Provider chain normalization quirk
`normalizeOptionChainContract` reads `impliedVolatility` from `raw.greeks.mid_iv`, NOT `raw.impliedVolatility`. Test mocks must include `greeks: { ..., mid_iv: 0.45 }` or IV will be null.

## Test cache
`_chainCache` is module-level — tests must call `clearContractResearchCache()` in `beforeEach`. Exported from the service for this purpose.

## 2.7.4 Handoff
Each candidate includes `riskScenarioInput: TradeRiskScenarioInput` — the input contract for the Risk Scenario Engine. Contains: planningContextId, contractResearchCandidateId, strategyFamily, legs[], currentStructureMetrics, researchThesisSummary, invalidationNote, planningConstraintsFingerprint.

## ContractResearchFilters
Includes `minDeltaLong` / `maxDeltaLong` fields (null by default). Route filter override must include these fields to match `ContractResearchFilters` type.

## getReferenceSnapshot signature
Requires `(userId, symbol)` — not just `(symbol)`. The route calls it with both args.

## TradePlanningContext field
`invalidatesThesis[]` not `invalidationEvidence[]` — the field is `context.invalidatesThesis`.
