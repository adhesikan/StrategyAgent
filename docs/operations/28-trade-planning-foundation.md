# 28 — Trade Planning Foundation

**Sprint:** 2.7.0  
**Status:** Production  
**Scope:** Research → Trade Planning bridge

---

## Overview

Trade Planning Foundation (Sprint 2.7.0) is the canonical bridge between the Research layer and future Trade Construction layers.

It shows traders how a qualified research candidate **could potentially be expressed** through different investment structures (equity, defined-risk options, income, etc.). It does **not** produce orders, select strikes or expirations, or constitute a recommendation.

---

## What This Sprint Builds

| Component | Description |
|-----------|-------------|
| `shared/trade-planning-types.ts` | Canonical types: `ExpressionFamily`, `TradePlanningConstraints`, `TradePlanningContext`, `TradePlanningSession`, and documented-only future types |
| `migrations/028_trade_planning_sessions.sql` | `trade_planning_sessions` table |
| `server/services/trade-planning-service.ts` | Context builder, expression evaluator, session CRUD, health metrics |
| `server/routes/trade-planning.ts` | 6 endpoints (static `/health`, `/session/*` before dynamic `/:symbol`) |
| `client/src/pages/trade-planning.tsx` | `/trade-planning/:symbol` page |
| `client/src/pages/opportunity-workspace.tsx` | Upgraded `TradePlanningHandoff` component (live CTA) |
| `shared/research-glossary.ts` | 9 new terms: `trade_planning`, `research_expression`, `expression_family`, `planning_constraints`, `capital_at_risk`, `defined_risk`, `income_research`, `directional_research`, `trade_thesis`, `planning_horizon` |
| `shared/schema.ts` | `tradePlanningSessions` Drizzle table |
| Platform health | `tradePlanning` health card in `/api/platform-health` |

---

## Architecture Contract

```
Research → Goals → Portfolio Intelligence → TRADE PLANNING → Trade Construction → Execution
```

| Layer | Answers |
|-------|---------|
| Research | Is this a qualified candidate? |
| Goals | Does it fit my research focus? |
| Portfolio Intelligence | How does it relate to what I hold? |
| **Trade Planning** | **How could this be expressed?** |
| Trade Construction | What structure, strike, expiration? (2.7.1–2.7.3) |
| Execution | Does the user explicitly choose to submit an order? |

---

## Expression Families

10 expression families evaluated deterministically:

| Family | Label | Availability |
|--------|-------|--------------|
| `equity` | Equity Research | Requires `equityAllowed=true` |
| `equity_scaled` | Scaled Equity Research | Requires `equityAllowed=true` + `capitalAvailable` |
| `income` | Income Research | Always evaluated |
| `defined_risk_directional` | Defined-Risk Directional Research | Requires `optionsAllowed=true` |
| `covered_call` | Covered Call Research | Requires `optionsAllowed=true` |
| `cash_secured_put` | Cash-Secured Put Research | Requires `optionsAllowed=true` |
| `vertical_spread` | Vertical Spread Research | Requires `optionsAllowed=true` + `definedRiskPreferred=true` |
| `long_option` | Long Option Research | Requires `optionsAllowed=true` + directional context |
| `neutral_options` | Neutral Options Research | Requires `optionsAllowed=true`, unavailable when `directionalFocus=true` |
| `monitor_only` | Monitor & Observe | Always applicable |

**No family is labeled "recommended", "best", or "optimal."**

---

## Expression Status Values

| Status | Meaning |
|--------|---------|
| `applicable` | The candidate's profile and user constraints support this approach |
| `potentially_applicable` | Constraints partially met; missing factors noted |
| `unavailable` | One or more required conditions not met |

---

## Planning Constraints

User-selected parameters that shape expression evaluation:

| Field | Type | Description |
|-------|------|-------------|
| `equityAllowed` | boolean | Whether equity research is explored |
| `optionsAllowed` | boolean | Whether options research is explored |
| `capitalAvailable` | number (optional) | Scenario capital for sizing models |
| `maxCapitalAtRisk` | number (optional) | Maximum capital at risk for scenarios |
| `maxLossPerPosition` | number (optional) | Maximum per-position loss for scenarios |
| `preferredHoldingPeriod` | `short` \| `medium` \| `long` \| `multi_year` (optional) | Planning horizon |
| `definedRiskPreferred` | boolean (optional) | Whether defined-risk structures are preferred |
| `incomeFocus` | boolean (optional) | Whether income-oriented approaches are prioritized |
| `directionalFocus` | boolean (optional) | Whether directional focus is active |
| `avoidEarningsWindow` | boolean (optional) | Whether earnings periods should be noted |

**No income, net worth, age, tax bracket, or household fields.** Constraints are NOT a suitability questionnaire.

---

## API Endpoints

### `GET /api/trade-planning/health` — Platform health (static)

Returns aggregate health metrics. No symbol, capital, or user identity in response.

**Response shape:**
```json
{
  "status": "HEALTHY",
  "metrics": {
    "contextsBuilt": 0,
    "sessionsCreated": 0,
    "expressionEvaluations": 0,
    "partialContexts": 0,
    "failedContexts": 0,
    "averageContextLatencyMs": "N/A",
    "lastSuccessfulContextAt": "Never"
  },
  "disclaimer": "..."
}
```

### `GET /api/trade-planning/:symbol/context` — Build planning context

Query params: `goalId`, `portfolioId`, `constraints` (JSON-encoded)

Server reconstructs authoritative context from Opportunity Intelligence, Goals, Portfolio Intelligence. Client cannot inject scores.

**Response:** `TradePlanningContext` + `existingSession` + disclaimers

### `POST /api/trade-planning/session` — Create planning session

Body: `{ symbol, constraints?, goalId?, portfolioId? }`

Only valid qualified research candidates can be used. Returns `TradePlanningSession`.

### `GET /api/trade-planning/session/:id` — Get session (user-scoped)

Cross-user returns 404.

### `PATCH /api/trade-planning/session/:id` — Update session

Body: `{ constraints?, goalId?, portfolioId?, selectedExpressionFamily? }`

### `GET /api/trade-planning/session/:id/expressions` — Re-evaluate expressions

Returns `ExpressionFamilyResult[]` with latest constraints applied.

---

## Route Ordering

Static routes registered **before** dynamic `/:symbol` route to prevent path collisions:

```
GET  /api/trade-planning/health          ← 1st (static)
GET  /api/trade-planning/session/:id     ← 2nd (static prefix)
PATCH /api/trade-planning/session/:id   ← 3rd
GET  /api/trade-planning/session/:id/expressions ← 4th
POST /api/trade-planning/session        ← 5th
GET  /api/trade-planning/:symbol/context ← 6th (dynamic, last)
```

---

## Database Schema

```sql
CREATE TABLE trade_planning_sessions (
  id                        UUID PRIMARY KEY,
  user_id                   TEXT NOT NULL,
  symbol                    VARCHAR(20) NOT NULL,
  opportunity_id            TEXT,
  research_goal_id          TEXT,    -- references research_goals.id (varchar)
  portfolio_id              UUID,
  constraints               JSONB NOT NULL,
  selected_expression_family TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
```

**Indices:** `(user_id)`, `(user_id, symbol)`, `(updated_at DESC)`

---

## Compliance Disclaimers

Three compliance constants in `shared/trade-planning-types.ts`:

- **`TRADE_PLANNING_DISCLAIMER`** — Full disclaimer: research only, not investment advice, not suitability
- **`CONSTRAINTS_DISCLAIMER`** — Planning constraints are not a suitability questionnaire
- **`NO_RANKING_DISCLAIMER`** — No expression family is labeled recommended, best, or optimal

---

## Future Roadmap (NOT in this sprint)

| Sprint | Scope |
|--------|-------|
| 2.7.1 | Equity Planning Engine — sizing methods, phased entry |
| 2.7.2 | Options Strategy Matching — match structure to thesis |
| 2.7.3 | Contract & Strike Research — specific contract exploration |
| 2.7.4 | Risk & Scenario Analysis — structure modeling |
| 2.7.5 | Trade Plan Workspace — full review before order prep |

---

## Health Monitoring

`getTradePlanningHealth()` exposes:
- `contextsBuilt`, `sessionsCreated`, `expressionEvaluations`
- `partialContexts`, `failedContexts`
- `averageContextLatencyMs`, `lastSuccessfulContextAt`

Available in `/api/platform-health` → `tradePlanning` health card.

---

## Test Coverage

`server/routes/__tests__/trade-planning.test.ts` — 26 sections, 175+ assertions

Key coverage areas:
- Expression family vocabulary (10 families, 3 statuses)
- Constraints validation (no financial questionnaire fields)
- Eligibility determinism and purity
- No recommendation/ranking language
- No strike/expiration/contract in 2.7.0 scope
- Compliance disclaimers
- Privacy (no income/netWorth/age)
- Route ordering
- AI grounding (determinism, no AI fields)
- Platform health metrics shape
- Partial-data resilience
- Future handoff type documentation
