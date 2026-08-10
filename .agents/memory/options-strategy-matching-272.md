---
name: Options Strategy Matching — Sprint 2.7.2
description: Architecture rules, isolation contract, and critical type lessons for the 17-family options strategy matching engine.
---

# Options Strategy Matching — Sprint 2.7.2

## Core Rule: Isolation
This service is isolated. It must NOT import:
- `best-trade-finder.ts` (BestTradePick / recommendation)
- `options-evaluator.ts` (suitabilityScore / synthetic IV)
- `opportunity-radar` (scanner / radar scoring)
- `live-contract-resolver.ts` (contract selection — 2.7.3)

**Why:** Prevents recommendation language, synthetic IV fabrication, and unauthorized contract resolution from leaking into the pure matching layer.

## 17 Strategy Families
long_call, long_put, bull_call_spread, bear_put_spread, bull_put_spread, bear_call_spread, covered_call, cash_secured_put, protective_put, collar, iron_condor, iron_butterfly, long_straddle, long_strangle, calendar_spread, diagonal_spread, monitor_only

## Critical Status Rules
- covered_call / protective_put / collar → NOT_APPLICABLE (not UNAVAILABLE) when no portfolio shares
- UNAVAILABLE only when `optionsAllowed = false`
- monitor_only → always APPLICABLE regardless of optionsAllowed
- No numeric score, no "best strategy", no recommendation language

**Why:** Covered calls without shares would be naked calls. Never present them as covered.

## Volatility / Liquidity Context
Both always UNKNOWN in 2.7.2 — no IV source, no chain data. Matching continues with limitations disclosed. Contract-level data deferred to 2.7.3.

## Route Order (static before dynamic)
```
GET  /api/trade-planning/session/:id/options/matches         ← static
GET  /api/trade-planning/session/:id/options/matches/:fam    ← static
POST /api/trade-planning/:symbol/options/match               ← dynamic (last)
```

## Client Panel Expression Family Gates
OptionsStrategyPanel shown when selectedFamily is one of:
income, defined_risk_directional, covered_call, cash_secured_put, vertical_spread, long_option, neutral_options

## Test File Location
`server/routes/__tests__/options-strategy-matching.test.ts` — 129 assertions, 50 sections

## Liquidity Note Literal Requirement
`deriveLiquidityContext()` note MUST contain "2.7.3" literally — test `"note references Contract Research 2.7.3"` checks for it.

## 2.7.3 Handoff Type
`OptionsContractResearchInput` — populated for APPLICABLE/POTENTIALLY_APPLICABLE; null for NOT_APPLICABLE/UNAVAILABLE.
2.7.3 must consume this — must NOT re-run strategy-family selection.

## Glossary Fields (correct pattern)
`key`, `label`, `shortDefinition`, `fullDefinition`, `methodologySummary`, `caution`, `category`, `userFacing`
11 new entries in OPTIONS_STRATEGY_ENTRIES, declared AFTER _extendedGlossary — so included via ALL_GLOSSARY_ENTRIES spread `[..._extendedGlossary, ...OPTIONS_STRATEGY_ENTRIES]`, NOT inside _extendedGlossary.

**Why:** Declaration order — _extendedGlossary is const at line ~1385; OPTIONS_STRATEGY_ENTRIES is const at line ~1409. Spreading it inside _extendedGlossary would be a ReferenceError. Fix: rebuild ALL_GLOSSARY_ENTRIES explicitly.

## Platform Health
6 options metrics added to tradePlanning card via `getOptionsMatchingHealth()` spread into details. Import added to platform-health.ts.

## Pre-existing TS Errors (not 2.7.2)
Errors in: institutional-trade-card.tsx, research-domain-summary.tsx, workspace-simplified.test.tsx, trade-goal-parser.ts, agent.tsx, scanner.tsx, agent-worker.ts, algopilotx.ts, server/index.ts, server/routes.ts, server/routes/agent.ts — all pre-existing, not introduced by 2.7.x.
