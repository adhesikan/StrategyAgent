---
name: Trade Planning Foundation (Sprint 2.7.0)
description: Architecture decisions, type contract, and cross-cutting constraints for the research-to-trade-planning bridge
---

## Rule: No uuid() column helper in shared/schema.ts

All UUID primary keys use `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` — the `uuid()` column type is NOT imported or available. Using it breaks test imports at the schema level.

**Why:** The schema never imported `uuid` from `drizzle-orm/pg-core`; all other tables use the varchar pattern.

**How to apply:** Whenever adding a new pgTable to shared/schema.ts, use `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` not `uuid("id").primaryKey().defaultRandom()`.

---

## Rule: research_goals.id is varchar, not UUID

The `research_goals` table uses `varchar` for its PK. Any FK or reference column must use `text(...)` not `uuid(...)`.

---

## Architecture Contract (6 layers)

```
Research → Goals → Portfolio Intelligence → Trade Planning → Trade Construction → Execution
```

Trade Planning (2.7.0) answers **HOW** a thesis could be expressed.
Trade Construction (2.7.1+) answers WHAT structure/strike/expiration.
Execution answers whether the user explicitly submits an order.

---

## Expression Families (10, deterministic)

`equity | equity_scaled | income | defined_risk_directional | covered_call | cash_secured_put | vertical_spread | long_option | neutral_options | monitor_only`

- `monitor_only` is ALWAYS `applicable`
- `neutral_options` is ALWAYS `unavailable` when `directionalFocus=true`
- `vertical_spread` requires `optionsAllowed=true` AND `definedRiskPreferred=true`
- `equity_scaled` requires `equityAllowed=true` AND `capitalAvailable` present

**Why:** Pure deterministic evaluation — no AI, no randomness, no ranking language ("recommended"/"best" must never appear).

---

## Constraints validation — forbidden fields

`validateConstraints()` strips: `income`, `netWorth`, `age`, `taxBracket`, `employment`, `dependents`, `householdAssets`, `liabilities`.

These are suitability fields and must never be stored or used.

---

## Route ordering contract (static before dynamic)

```
GET  /api/trade-planning/health            ← 1st (static)
GET  /api/trade-planning/session/:id       ← 2nd
PATCH /api/trade-planning/session/:id      ← 3rd
GET  /api/trade-planning/session/:id/expressions ← 4th
POST /api/trade-planning/session           ← 5th
GET  /api/trade-planning/:symbol/context   ← 6th (dynamic, last)
```

**Why:** `/api/trade-planning/health` and `/session/:id` would otherwise be captured by `/:symbol/context`.

---

## Key file locations

- `shared/trade-planning-types.ts` — canonical types + 3 compliance constants + ARCHITECTURE_CONTRACT
- `server/services/trade-planning-service.ts` — `buildTradePlanningContext()`, `evaluateExpressionFamilies()`, `getTradePlanningHealth()`, session CRUD
- `server/routes/trade-planning.ts` — 6 endpoints
- `client/src/pages/trade-planning.tsx` — `/trade-planning/:symbol`
- `migrations/028_trade_planning_sessions.sql` — applied 2026-08-10

---

## Roadmap — NOT in 2.7.0

- Strike / expiration / contract selection
- Order tickets or broker submission
- Iron condor, butterfly, straddle, strangle families
- Equity planning engine (2.7.1)
- Options strategy matching (2.7.2)
- RIA extension (future)
