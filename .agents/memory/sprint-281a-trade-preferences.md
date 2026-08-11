---
name: Sprint 2.8.1A — Trade Preferences & User-Directed Expression Selection
description: Key decisions, invariants, and footguns for the preference + expression selection layer.
---

## Core Invariant

Preferences affect presentation ordering only. They NEVER change compatibility status, qualify candidates, override strategy matching, override broker permissions, or determine suitability.

**Why:** Regulatory/compliance separation. These are user presentation preferences, not suitability assessments.

## selectedBy Always USER

`selectedBy` is always `"USER"` — the server enforces this. Client cannot submit it. AI cannot set it.

## Five Permanently Separate Concepts

UserTradingPreferences / OpportunityExpressionSelection / OptionsStrategyMatch / BrokerPermissions / ExecutionPreflightResult — never merge.

## ExpressionFamily vs BroadExpressionType

- `ExpressionFamily` (10 values from `shared/trade-planning-types.ts`): equity, equity_scaled, income, defined_risk_directional, covered_call, cash_secured_put, vertical_spread, long_option, neutral_options, monitor_only
- `BroadExpressionType` (9 values from `shared/trade-preference-types.ts`): STOCK, LONG_OPTIONS, COVERED_CALL, CASH_SECURED_PUT, DEFINED_RISK_OPTIONS, INCOME_OPTIONS, NEUTRAL_OPTIONS, ADVANCED_OPTIONS, EXPLORE_COMPATIBLE_STRUCTURES

**Do NOT confuse** these two type systems. `BROAD_TO_FAMILIES` maps broad → ExpressionFamily.

## evaluateExpressionFamilies Signature

`evaluateExpressionFamilies(opp, constraints, goalContext?, portfolioContext?)` — **synchronous**, not async. Takes a `CanonicalOpportunity` + `TradePlanningConstraints`. Not exported from the service as a validated helper — cast sessionConstraints as `TradePlanningConstraints` directly.

## @db Import Alias

Use `import { db } from "../db"` (relative) in service files, not `import { db } from "@db"` (alias). The `@db` alias doesn't resolve in the vitest test environment.

## Set Iteration TS Error

`for (const key of mySet)` → TS2802. Use `for (const key of Array.from(mySet))` in route files.

## validateConstraints

`validateConstraints` is NOT exported from `trade-planning-service.ts` (it's imported in the routes file but defined and used internally). Use `(sessionConstraints ?? {}) as TradePlanningConstraints` cast instead.

## CSP NOT_ALIGNED vs UNAVAILABLE

CSP is NOT_ALIGNED_WITH_CURRENT_RESEARCH (not UNAVAILABLE) when the family's unavailability reasons contain "directional", "thesis", "neutral", or "not aligned". Check `unavailReasons.toLowerCase()` for these keywords.

## Global Preference → No Plan Mutation

`saveUserTradingPreferences` only writes to user_settings. It must NEVER call `updateTradePlan` or `updatePlanningSession`. Tests verify this with spy mocks.

## Covered Call Never Naked

COVERED_CALL returns AVAILABLE_WITH_REQUIREMENTS (not AVAILABLE) when ownership cannot be confirmed. Never downgrade to a naked short position. The service checks `portfolioContext.hasSharesOf(symbol)`.

## Advanced Options Always Opt-In

ADVANCED_OPTIONS always returns AVAILABLE_WITH_REQUIREMENTS minimum — never AVAILABLE — even when underlying families are applicable. This is intentional: opt-in category for extended research.

## How to Apply

- When adding new broad expression type: add to BROAD_EXPRESSION_TYPES const, add label/educational/BROAD_TO_FAMILIES entries, add compatibility logic in computeBroadCompatibility, update tests.
- 2.8.2: consume `broadExpressionType` from OrderDraft (= STOCK); do not re-ask expression type.
- 2.8.3: consume per-leg expression selection.
- 2.8.5: audit trail must show full user-agency chain including broad expression selection.
