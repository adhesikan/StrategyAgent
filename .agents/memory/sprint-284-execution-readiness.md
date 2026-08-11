---
name: Sprint 2.8.4 — Execution Readiness & Guardrails
description: Architecture decisions and invariants for the deterministic execution readiness engine.
---

## Workflow Position

```
Trade Plan → Options Order Preview (2.8.3) → Execution Readiness (2.8.4) → Review & Confirm (2.8.5) → Broker Submission
```

Readiness sits immediately after Options Preview. It consumes the preview as-is — never reopens the pricing/leg-construction engine.

## Core Invariant

**Readiness is DETERMINISTIC — no LLM involvement, ever.** The AI assistant may explain findings in the Workspace. It may NEVER: convert BLOCKED to READY, ignore stale quotes, override missing buying power, override missing positions, override broker restrictions.

`brokerSubmissionEnabled: false` is a literal type constant in the result type — cannot be overridden without a TypeScript error.

**Why:** Execution decisions must be based on application/broker/account/market data. AI suitability assessment is a different concern from execution feasibility.

## Status Aggregation

- Any `BLOCKER` severity → BLOCKED
- Any `WARNING` severity (no BLOCKER) → READY_WITH_WARNINGS
- All INFO/empty → READY

## isShortIntent (re-defined in readiness service)

The function is defined independently in `execution-readiness-service.ts` (not imported from options-preview-service.ts). Uses `.includes("SHORT")` — matches OPEN_SHORT_COVERED, OPEN_SHORT_SECURED, OPEN_SHORT_DEFINED_RISK, CLOSE_SHORT, and all future SHORT-bearing intents.

**Why:** Keeping it in the service avoids a server→server circular dependency. It's a 1-line function.

## Capital Estimate Rules

- Debit strategies: max loss = `netStructurePricing.totalAmount`
- Credit spreads (bull_put_spread, bear_call_spread): `(strike_high - strike_low - credit_per_unit) × 100 × qty`
- Iron condor/butterfly: `(max_wing_width - credit_per_unit) × 100 × qty`
- Covered call: `SHARES_ONLY`, `estimatedRequirementUsd = 0` (shares already owned)
- Cash-secured put: `(strike × 100 × qty) - (credit × 100 × qty)`
- Unknown strategy family: `BROKER_MARGIN_REQUIRED`

**How to apply:** `isEstimate: true` is always present. Never say "broker approval" in disclaimer.

## Missing Data Rules

- `positions === null` → `POSITION_DATA_UNAVAILABLE` WARNING (never assumes zero holdings)
- `buyingPowerUsd === null` → `BUYING_POWER_UNCONFIRMED` WARNING (never assumes $0)
- `brokerCap === null` → `BROKER_NOT_CONNECTED` BLOCKER

## DB Table

New table: `execution_readiness_results` — created via raw SQL in `ensureExecutionReadinessTables()`.
Never persists: raw account balances, full account IDs, broker tokens, full position lists.

## Routes

- `GET /api/execution/execution-readiness/health` — static, must be registered BEFORE dynamic route
- `POST /api/trade-plans/:id/execution-readiness` — runs evaluation
- `GET /api/trade-plans/:id/execution-readiness/latest` — latest persisted result

## Forbidden Client Fields

Any of: `positions`, `buyingPower`, `accountBalance`, `balance`, `cashBalance`, `brokerCapabilities`, `optionsPermission`, `forceReady`, `overrideStatus`, `bypassChecks`, etc. → HTTP 400 FORBIDDEN_FIELD.

## Test File

`server/routes/__tests__/execution-readiness.test.ts` — run with `npm run test:execution-readiness`. Uses wrapper `evaluateExecutionReadiness(input) → { readiness: result }` to match `{ readiness }` destructuring shape in all tests.

## Multi-Leg Capability

Provider matrix as of 2026: Tradier multiLeg=UNKNOWN, TradeStation multiLeg=UNKNOWN, SnapTrade multiLeg=UNKNOWN. `MULTILEG_NOT_SUPPORTED` WARNING (not BLOCKER) when `supportsMultileg === null`. BLOCKER only when `supportsMultileg === false`.

## 2.8.5 Block

No broker submission until 2.8.5 GO. The `brokerSubmissionEnabled: false` literal enforces this at the type level.
