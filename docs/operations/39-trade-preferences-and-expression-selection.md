# Doc 39 — Trade Preferences & User-Directed Expression Selection (Sprint 2.8.1A)

## Permanent Architecture Rule

**User Trading Preferences determine which research structures are shown first.**

They do NOT:
- qualify securities
- determine suitability
- authorize strategies
- override broker permissions
- override risk controls
- or authorize execution

The user explicitly chooses the broad expression type for each Trade Planning workflow.
VCP Trader AI may then evaluate compatible structures INSIDE that user-selected category.
The specific structure and contract remain user-selected before execution planning proceeds.

## Why This Layer Exists

Before Sprint 2.8.1A, the Trade Planning page showed 10 low-level research expression families directly. Users had to choose from technical labels like "defined_risk_directional" or "vertical_spread" without first establishing what kind of investment approach they wanted to explore.

This sprint adds a THIN PREFERENCE + SELECTION LAYER:

```
Qualified Research Candidate
        ↓
USER chooses broad expression category   ← Sprint 2.8.1A
        ↓
VCP evaluates compatible structures INSIDE that category
        ↓
USER chooses specific structure
        ↓
Contract Research where applicable
        ↓
Risk Analysis → Trade Plan → Execution Preflight → Order Preparation
```

## Five Permanently Separate Concepts

**Never merge these into one object:**

| Concept | What it controls |
|---------|-----------------|
| `UserTradingPreferences` | Presentation ordering only |
| `OpportunityExpressionSelection` | Explicit per-opportunity user choice |
| `OptionsStrategyMatch` | Structural compatibility per thesis |
| `BrokerPermissions` | What the broker account allows |
| `ExecutionPreflightResult` | Safety/execution readiness |

**Preference ≠ Compatibility ≠ Broker Permission ≠ Suitability ≠ Execution Authorization**

## Canonical Broad Expression Types

| Type | Label | Engine |
|------|-------|--------|
| `STOCK` | Stock | Equity Planning Engine |
| `LONG_OPTIONS` | Long Options | Options Matching → long_option |
| `COVERED_CALL` | Covered Calls | Options Matching → covered_call |
| `CASH_SECURED_PUT` | Cash-Secured Puts | Options Matching → cash_secured_put |
| `DEFINED_RISK_OPTIONS` | Defined-Risk Options | Options Matching → defined_risk_directional, vertical_spread |
| `INCOME_OPTIONS` | Income / Premium Strategies | Options Matching → income, covered_call, cash_secured_put |
| `NEUTRAL_OPTIONS` | Neutral / Range Strategies | Options Matching → neutral_options |
| `ADVANCED_OPTIONS` | Advanced Options | Options Matching (opt-in) |
| `EXPLORE_COMPATIBLE_STRUCTURES` | Explore Compatible Structures | All compatible families |

## Compliance Constraints

**Do NOT say:**
- "Recommended for You"
- "Best Strategy for You"
- "Your Risk Profile"
- "Suitable Strategy"
- "AI Chose"
- "AI Selected"
- "Based on your profile"
- "Optimal Trade Type"

**Do NOT derive preferences from:**
- income, net worth, age, tax bracket, employment, dependents, liabilities, risk capacity

**Do NOT create:**
- Trader Type (Aggressive/Conservative)
- Risk Score / Suitability Score
- Options Sophistication Score
- Suitability Profile

**Settings disclaimer (canonical):**
> "These preferences control which research structures VCP Trader AI shows first. They do not determine whether any investment or strategy is appropriate for you and are not a suitability assessment or investment recommendation."

**Selection disclaimer (canonical):**
> "You choose the type of research structure you want to explore. VCP Trader AI then analyzes structures within that category using the current research thesis and available data. This does not constitute investment advice, a recommendation, or a suitability determination."

## Global User Trading Preferences

### Model

```typescript
UserTradingPreferences {
  userId: string
  preferredExpressionTypes: BroadExpressionType[]  // multiple allowed
  showOtherCompatibleStructures: boolean            // default true
  updatedAt: string
}
```

### Behavior

- Multiple preferred categories supported (e.g., STOCK + LONG_OPTIONS + COVERED_CALL)
- Empty preferences → show all categories without hard filtering
- Preferences affect **ordering** and **highlighting** only
- Preferences do NOT filter out categories from view
- Global preference update does **NOT** modify existing Trade Plans, Planning Sessions, Order Drafts, or Execution Preflights
- No forced onboarding — preferences are optional

### Persistence

Column additions to `user_settings` table:
- `preferred_expression_types JSONB DEFAULT '[]'`
- `show_other_compatible_structures BOOLEAN DEFAULT true`

## Per-Opportunity Expression Selection

### Model

```typescript
OpportunityExpressionSelection {
  id: string
  userId: string
  symbol: string
  planningSessionId: string
  selectedExpressionType: BroadExpressionType
  selectedBy: "USER"   // ALWAYS USER — AI cannot set this
  selectedAt: string
  updatedAt?: string
}
```

### Selection Rules

- User must **explicitly select** before category-specific planning begins
- Preferences may pre-highlight or order, but do NOT auto-select
- `selectedBy` is always `"USER"` — the server enforces this, client cannot override
- Cross-user session access → 404 (prevents enumeration)

### Persistence

Column additions to `trade_planning_sessions`:
- `broad_expression_type TEXT DEFAULT NULL`
- `expression_selected_by TEXT DEFAULT NULL`

Column additions to `trade_plans`:
- `broad_expression_type TEXT DEFAULT NULL`
- `expression_selected_by TEXT DEFAULT NULL`
- `expression_selected_at TIMESTAMPTZ DEFAULT NULL`

These fields are **additive only** — existing sessions and plans are unchanged.

## Expression Compatibility States

| Status | Meaning |
|--------|---------|
| `AVAILABLE` | Research conditions support this category |
| `AVAILABLE_WITH_REQUIREMENTS` | Partially supported — requirements shown |
| `NOT_ALIGNED_WITH_CURRENT_RESEARCH` | Thesis direction does not align |
| `UNAVAILABLE` | Not supported in current context |

**Never say:** "Bad Strategy", "Not Recommended"

## Category-Specific Rules

### STOCK
- Always AVAILABLE for qualified candidates (equity is the default path)
- Routes to Equity Planning Engine

### LONG_OPTIONS
- AVAILABLE when `long_option` ExpressionFamily is `applicable`
- AVAILABLE_WITH_REQUIREMENTS when `potentially_applicable`
- UNAVAILABLE when options not supported in context

### COVERED_CALL — Ownership Handling

**Never converted to naked short call.**

| Portfolio Context | Status |
|-------------------|--------|
| Shares confirmed sufficient | AVAILABLE |
| Portfolio exists, coverage not confirmed | AVAILABLE_WITH_REQUIREMENTS |
| Confirmed insufficient shares | UNAVAILABLE |
| No portfolio context | AVAILABLE_WITH_REQUIREMENTS |

Coverage note always displayed:
> "Covered call research requires sufficient underlying shares. Coverage is confirmed during contract research and execution preflight."

### CASH_SECURED_PUT — Capital Handling

- Broad category can be selected without an exact strike
- Exact cash-secured capital requirement is determined during contract research
- Buying power is validated by Execution Preflight — not here
- Capital note always displayed:
  > "Exact cash-secured capital requirement is determined during contract research."
- Returns NOT_ALIGNED_WITH_CURRENT_RESEARCH when thesis is strongly directional

### DEFINED_RISK_OPTIONS
- Maps to `defined_risk_directional` and `vertical_spread` ExpressionFamilies
- AVAILABLE when either family is `applicable`
- After selection → Strategy Matching constrained to defined-risk families

### INCOME_OPTIONS
- Maps to `income`, `covered_call`, `cash_secured_put` ExpressionFamilies
- NOT_ALIGNED when thesis is strongly directional (income families unavailable with directional reasons)

### NEUTRAL_OPTIONS
- Maps to `neutral_options` ExpressionFamily
- NOT_ALIGNED_WITH_CURRENT_RESEARCH for strongly directional theses
- Returns AVAILABLE_WITH_REQUIREMENTS minimum even when applicable (range-bound context note)

### ADVANCED_OPTIONS — Opt-In

- Always AVAILABLE_WITH_REQUIREMENTS minimum (opt-in category)
- Never automatically prioritized for normal retail users
- Note always displayed:
  > "Advanced options structures are an opt-in research category. Availability depends on options permissions confirmed during execution preflight."

### EXPLORE_COMPATIBLE_STRUCTURES
- Always AVAILABLE
- Shows all research structure categories compatible with the current opportunity
- User still explicitly selects a specific structure — no auto-selection

## Presentation Ordering

Sort priority within `computeExpressionOptions`:

1. AVAILABLE (preferred first, then non-preferred by canonical order)
2. AVAILABLE_WITH_REQUIREMENTS (preferred first)
3. NOT_ALIGNED_WITH_CURRENT_RESEARCH (preferred first)
4. UNAVAILABLE (preferred first)

## Strategy Matching Integration

**The Options Strategy Matching engine is NOT duplicated.**

`computeExpressionOptions` reads `ExpressionFamilyResult[]` from `evaluateExpressionFamilies()` (existing engine) and maps them to broad categories. The mapping:

```
ExpressionFamily → BroadExpressionType:
  equity, equity_scaled  → STOCK
  long_option            → LONG_OPTIONS
  covered_call           → COVERED_CALL
  cash_secured_put       → CASH_SECURED_PUT
  defined_risk_directional, vertical_spread → DEFINED_RISK_OPTIONS
  income, covered_call, cash_secured_put    → INCOME_OPTIONS
  neutral_options        → NEUTRAL_OPTIONS
  neutral_options, defined_risk_directional → ADVANCED_OPTIONS
  all                    → EXPLORE_COMPATIBLE_STRUCTURES
```

After user selects a broad category, the routing descriptor (`ExpressionRouting`) narrows which families are passed to Strategy Matching in the next step. This does not change the methodology — only the universe of families evaluated.

## Trade Plan Integration

When a Trade Plan is saved, `broadExpressionType`, `expressionSelectedBy`, `expressionSelectedAt` are persisted in the plan row. This allows future audit to show:

1. USER selected broad expression type (STOCK / LONG_OPTIONS / etc.)
2. USER selected specific structure (long_call / bull_call_spread / etc.)
3. USER selected contract candidate
4. USER saved Trade Plan
5. USER selected order quantity/preferences
6. USER reviewed Order Preview
7. USER explicitly confirmed submission (Sprint 2.8.5)

**Existing plan snapshots are never mutated.** Only the new nullable columns are set on new plans or new plan versions.

## OrderDraft Integration

- `OrderDraft` consumes the final selected structure from the upstream Trade Plan
- `OrderDraft` cannot change the broad expression type
- This is enforced by the fact that `OrderDraft` is built from a saved `TradePlan` — it does not re-run expression selection

## Downstream Invalidation

If user changes broad expression type in a session **before** saving a Trade Plan:
- `broadExpressionType` in session is updated (new explicit selection)
- Previous session-level work (strategy matches, contract candidates) from old expression type is treated as stale

If user wants a different broad expression after saving a Trade Plan:
- Preferred: Create New Trade Plan
- Do NOT mutate the original plan's immutable snapshots

## Execution Preflight Integration

Preflight validates requirements for the selected expression:
- Covered Call → checks share coverage
- CSP → checks buying power / cash requirement
- Options → checks options permissions
- Multi-leg → checks multi-leg permission

Preflight does NOT change the broad expression category.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/user/trading-preferences | Get user's global preferences |
| PUT | /api/user/trading-preferences | Save user's global preferences |
| GET | /api/trade-planning/session/:id/expression-selection | Get session's current selection |
| POST | /api/trade-planning/session/:id/expression-selection | Save explicit selection |
| GET | /api/trade-planning/:symbol/expression-options | Compute expression option cards |

### Server-Authoritative Fields

Client may submit:
- `preferredExpressionTypes` (array of BroadExpressionType)
- `showOtherCompatibleStructures`
- `selectedExpressionType` (for POST selection)

Client MUST NOT submit (rejected 400):
- `compatibilityStatus`
- `strategyMatches`
- `portfolioOwnership`
- `brokerPermissions`
- `researchDirection`
- `suitability`
- `selectedBy` (always "USER" server-side)

## Database

Migration: `migrations/029_trade_preferences.sql` — additive only, idempotent.

`ensureTradePreferencesTables()` runs at startup (idempotent column additions).

## Routing Regression

- Static session routes (`/api/trade-planning/session/:id/*`) registered before dynamic symbol routes
- `/api/trade-planning/:symbol/expression-options` guards against reserved segment names (session, history, health, expressions)

## Security

- All endpoints require authentication
- userId derived from session — never from client body
- Cross-user preference access → user gets their own settings only (userId from session)
- Cross-user session → 404 (not 403) to prevent enumeration
- `selectedBy` is always "USER" server-side — client cannot override

## Privacy / Logging

Logs include: provider, expressionType, sourceSurface, durationMs.
Logs NEVER include: income, net worth, portfolio value, account balance, capital constraint, user notes.

## Feature Flags

No new feature flags — the preference/selection layer is always active. It is additive and non-breaking.

## UI Components

| Component | Purpose |
|-----------|---------|
| `ResearchTradingPreferencesSection` | Settings card for global preferences |
| `BroadExpressionSelectionStep` | "How would you like to explore?" step in Trade Planning |

UI CTA language:
- ✅ "Explore Stock" / "Explore Long Options"
- ✅ "Your Preferred Research Structures"
- ✅ "Other Compatible Structures"
- ✅ "Currently Unavailable / Not Aligned"
- ❌ "Trade Long Options" / "Best Strategy" / "AI Recommended"

## Monetization (Document Only)

| Tier | Expression Categories |
|------|----------------------|
| FREE | Stock, basic Long Options preview |
| RETAIL | All standard categories, saved preferences |
| PROFESSIONAL | Advanced Options, custom preference templates |
| RIA | Firm-approved expression universe (future) |
| INSTITUTIONAL | Custom strategy universe (future) |

No entitlement enforcement in this sprint.

## RIA / Institutional Future

```typescript
// Future Sprint (not implemented)
OrganizationExpressionPolicy {
  allowedExpressionTypes: BroadExpressionType[]
  prohibitedExpressionTypes: BroadExpressionType[]
  allowedStrategyFamilies: string[]
  requireDefinedRisk?: boolean
}
```

Keep distinct from UserTradingPreferences.

## Test Coverage

- Test file: `server/routes/__tests__/trade-preferences.test.ts`
- Test script: `npm run test:trade-preferences`
- 101 assertions across 25 groups
- Included in: `npm run test:release`

## Methodology Version

`"2.8.1A"` on all expression option results.

## Handoffs

### → 2.8.2 (Equity Order Preview)
OrderDraft receives `broadExpressionType = STOCK` and `selectedBy = USER`. Sprint 2.8.2 does not re-ask whether user wants Stock vs Options.

### → 2.8.3 (Options/Multi-Leg Preview)
OrderDraft receives: broad expression selected by user, specific strategy family selected through Strategy Matching/user choice, specific contract candidate selected by user. No downstream engine may change these silently.

### → 2.8.5 (Execution)
Audit trail must show the complete user-agency chain: broad expression selection → specific structure → contract → plan saved → order preferences → review → explicit confirmation → submission.
