# 29 — Equity Trade Planning Engine

**Sprint:** 2.7.1  
**Status:** Production  
**Scope:** Equity research scenario construction

---

## Overview

Equity Trade Planning (Sprint 2.7.1) is the HOW layer for equity expression research. It converts a qualified `TradePlanningContext` plus user-selected planning constraints into a deterministic `EquityPlanningScenario` — a structured view of how an equity research thesis could be expressed as a research scenario.

It does **not** produce orders, select contracts, or perform suitability assessments.

---

## Architecture

```
Research → Goals → Portfolio Intelligence → Trade Planning Foundation → EQUITY TRADE PLANNING → Trade Construction (2.7.2+) → Execution
```

| Layer | Answers |
|-------|---------|
| Research | Is this qualified? |
| Trade Planning Foundation (2.7.0) | How could it be expressed? |
| **Equity Trade Planning (2.7.1)** | **How could the equity expression be structured as a scenario?** |
| Options Strategy Matching (2.7.2) | What options structure fits? |
| Execution | Did user explicitly submit an order? |

### Permanent Architecture Rule

No Trade Planning service may promote an unqualified security into a research opportunity. Downstream planning services consume the canonical research thesis. They may reject or limit a scenario because data/risk constraints are insufficient. They may **never** rewrite upstream research evidence to justify a trade structure.

---

## What This Sprint Builds

| Component | Description |
|-----------|-------------|
| `shared/equity-planning-types.ts` | Canonical types: `EquityPlanningScenario`, `EntryFramework`, `InvalidationFramework`, `SizingFramework`, `ScenarioGrid`, `MonitoringPlan`, `CapitalContext`, `EquityPlanningFreshness` |
| `server/services/equity-planning-service.ts` | Engine: `buildEquityPlanningScenario()`, `recalculateEquityScenario()`, `getEquityPlanningHealth()` |
| `server/routes/trade-planning.ts` | 4 new endpoints (all static session routes before dynamic `:symbol`) |
| `client/src/pages/trade-planning.tsx` | EquityPlanningPanel shown when equity/equity_scaled family is selected |
| `shared/research-glossary.ts` | 10 new terms |
| `server/routes/platform-health.ts` | Equity health metrics added to `tradePlanning` card |

---

## EquityPlanningScenario

The canonical scenario object, reusable by:
- Trade Plan Workspace (2.7.5)
- Research Reports
- Position Monitoring
- RIA workflows
- Institutional workflows

Key fields:
```typescript
{
  id, planningContextId, planningSessionId, symbol,
  generatedAt, marketDataAsOf,
  researchSummary,         // from canonical TradePlanningContext — never re-scored
  referencePrice,          // from stored daily bars
  referencePriceSource,    // "Stored daily close — [date]"
  entryFramework,          // available | unavailable with reason
  invalidationFramework,   // from canonical research evidence
  sizingFramework,         // deterministic from user constraints
  scenarioGrid,            // null when no reference price
  monitoringPlan,          // deterministic, no automated alerts
  capitalContext,          // scenario display values
  limitations[],           // partial data notes
  freshness,               // 7-dimension freshness
  methodologyVersion,      // "equity-planning-v1"
  planningConstraintsFingerprint
}
```

---

## Entry Framework

### Architecture
- Uses only technical levels from canonical research services (stored EMA bars)
- EMA 9, EMA 21, EMA 50 from stored daily bars serve as reference levels
- If no validated level exists → `entryFramework.available = false` with `unavailableReason`
- Entry zones are research zones, NOT buy instructions

### Entry Condition Types
| Type | Label |
|------|-------|
| `CURRENT_STRUCTURE` | Current Research Structure |
| `BREAKOUT_CONFIRMATION` | Breakout Confirmation |
| `PULLBACK_TO_SUPPORT` | Pullback to Research Support |
| `RECLAIM` | Level Reclaim |
| `TREND_CONTINUATION` | Trend Continuation |
| `MONITOR_ONLY` | Monitor Only |

### Entry Zone Construction
- Only EMA levels **below** the reference price are used for entry zones
- Zone = ±2% around the nearest EMA
- Label: "Research Scenario Entry Zone" (never "Buy Zone")

---

## Invalidation Framework

Sources (canonical only — never fabricated):
- `invalidatesThesis[]` from `CanonicalOpportunity`
- `riskFactors[]` from `CanonicalOpportunity`
- EMA reference levels from stored bars

The invalidation framework does not trigger automated actions. It is a research reference.

---

## Position Sizing Methodology

All inputs are from **user-selected planning constraints only**. No financial capacity is inferred.

### Formulas

```
riskPerShare         = referencePrice − invalidationPrice
sharesByCapitalLimit = floor(maxCapitalAtRisk / referencePrice)
sharesByRiskLimit    = floor(maxLossPerPosition / riskPerShare)
effectiveShares      = min(sharesByCapitalLimit, sharesByRiskLimit)
capitalRequired      = effectiveShares × referencePrice
estimatedLoss        = effectiveShares × riskPerShare
```

### Constraints
- `capitalRequired ≤ capitalAvailable` (ceiling enforced)
- All results floor-rounded to whole shares
- No income, net worth, age, or tax bracket fields

### Partial States
| Missing Input | Impact |
|--------------|--------|
| No reference price | All sizing unavailable |
| No invalidationPrice | riskPerShare null; sharesByRiskLimit null; capital sizing still works |
| No maxCapitalAtRisk | sharesByCapitalLimit null |
| No maxLossPerPosition | sharesByRiskLimit null |

### Compliance Label
- "Hypothetical Scenario Size" — never "Recommended Position Size"

---

## Scenario Analysis

- 7 default percentage points: −20%, −10%, −5%, 0%, +5%, +10%, +20%
- User can customize downside (max −50%) and upside (max +100%)
- Each point shows: hypotheticalPrice, hypotheticalMarketValue, hypotheticalPL, hypotheticalPLPct
- No probability implied for any scenario point

**Forbidden language:** Expected Return, Projected Return, Forecast Return, Price Target, Profit Target

---

## Reward/Risk Ratio

Only computed when:
- Upside reference level exists (resistance or prior high in canonical data)
- Downside reference level exists (invalidation or support in canonical data)
- Both are on opposite sides of the reference price

Formula: `upsideDistance / downsideDistance`

If either reference is unavailable → `rewardRiskRatio: null`

---

## Monitoring Plan

8 monitoring categories — deterministic, no automated alerts:

| Category | Monitored |
|----------|-----------|
| `technical` | EMA levels, stage, volume |
| `fundamental` | Fundamental score trend |
| `institutional` | Institutional score trend |
| `sector` | Sector relative strength |
| `theme` | Theme momentum |
| `market_regime` | Regime classification |
| `portfolio_exposure` | Position weight (if held) |
| `events` | Earnings / event windows |

Alert implementation deferred to future sprint.

---

## Portfolio Context Modes

### New Position Research Scenario
- No owned position detected
- Full sizing and scenario analysis available
- No "Buy X shares" language

### Existing Position Research Scenario
- Owned position detected from Portfolio Intelligence
- Shows current shares, weight, estimated market value, cost basis if available
- Scenario phrased as "If this hypothetical scenario were added..."
- No rebalancing recommendation

### No-Portfolio Mode
- Full functionality without portfolio connection, broker, or uploaded holdings
- Portfolio context fields are optional throughout

---

## Reference Price Source

Reference price is sourced from **stored daily bars** via `getReferenceSnapshot()`:
- Zero provider credits consumed by default
- `lastPrice = realtime?.last ?? lastBar?.close ?? null`
- Data freshness is always disclosed
- If data > 3 days old → `STALE INPUT WARNING`

Client **cannot** inject reference price, technical levels, or research scores.

---

## Data Freshness

7-dimension freshness model:

| Dimension | Source |
|-----------|--------|
| Reference Price | Stored bar timestamp |
| Technical Levels | Stored bar timestamp |
| Opportunity Intelligence | Context generatedAt |
| Fundamental Evidence | Context generatedAt |
| Institutional Evidence | Context generatedAt |
| Portfolio Context | Portfolio snapshot timestamp |
| Goal Context | Goal freshness label |

**Status thresholds:**
- `fresh`: < 1 day
- `aging`: 1–3 days
- `stale`: > 3 days → STALE INPUT WARNING shown

---

## API Endpoints

### Route Order (static before dynamic)
```
GET  /api/trade-planning/health                          ← 1st (static)
GET  /api/trade-planning/session/:id                     ← 2nd (static)
PATCH /api/trade-planning/session/:id                   ← 3rd
GET  /api/trade-planning/session/:id/expressions         ← 4th
GET  /api/trade-planning/session/:id/equity              ← 5th (NEW)
PATCH /api/trade-planning/session/:id/equity             ← 6th (NEW)
GET  /api/trade-planning/session/:id/equity/scenarios    ← 7th (NEW)
POST /api/trade-planning/session                         ← 8th
POST /api/trade-planning/:symbol/equity                  ← 9th (dynamic, NEW)
GET  /api/trade-planning/:symbol/context                 ← 10th (dynamic, last)
```

### POST /api/trade-planning/:symbol/equity

Build equity scenario without a saved session.

**Body:** `{ constraints?, planningSessionId?, downsidePct?, upsidePct? }`

**Response:** `{ scenario: EquityPlanningScenario, disclaimer, sizingNote }`

### GET /api/trade-planning/session/:id/equity

Retrieve equity scenario for a saved session.

**Response:** `{ scenario: EquityPlanningScenario, disclaimer, sizingNote }`

### PATCH /api/trade-planning/session/:id/equity

Recalculate equity scenario with updated constraints.

**Body:** `{ constraints?, downsidePct?, upsidePct? }`

### GET /api/trade-planning/session/:id/equity/scenarios

Return just the scenario grid (fast recalculation).

**Query:** `?downsidePct=-0.20&upsidePct=0.20`

---

## Compliance

### Required Vocabulary
- Equity Research Scenario
- Research Entry Framework
- Hypothetical Position Size / Hypothetical Scenario Size
- Scenario Capital
- Research Invalidation
- Scenario Analysis
- Monitoring Plan
- Research Consideration
- Hypothetical Scenario P/L

### Forbidden Vocabulary
- Recommended Entry / Buy Zone / Best Entry / Strong Buy
- Recommended Position Size
- Target Price / Price Target / Profit Target
- Expected Return / Projected Return / Forecast Return
- Safe Trade / Low Risk for You / Appropriate Risk
- Guaranteed Upside

### Canonical Disclaimer
> "Equity Trade Planning provides hypothetical research scenarios based on existing research evidence and planning constraints you select. It does not constitute investment advice, a personalized recommendation, suitability determination, or instruction to buy, sell, hold, or size a position."

---

## Privacy

Planning constraints collect only:
- capitalAvailable, maxCapitalAtRisk, maxLossPerPosition (scenario parameters)
- preferredHoldingPeriod, equityAllowed, optionsAllowed (planning preferences)

**No income, net worth, age, tax bracket, employment, or household data.**

---

## Security

- All equity scenarios are user-owned (cross-user → 404)
- Client cannot inject: referencePrice, support, resistance, pivot, scores, qualification
- Server always fetches reference price from stored bars
- Server always builds TradePlanningContext from Opportunity Intelligence

---

## Platform Health

`tradePlanning` health card in `/api/admin/platform-health` extended with:
- `equityScenariosGenerated`
- `partialEquityScenarios`
- `failedEquityScenarios`
- `averageEquityScenarioLatencyMs`
- `lastSuccessfulEquityScenarioAt`

No symbols, capital values, share counts, or user identity in health metrics.

---

## Structured Logging

Safe log fields:
- `event` (`equity_planning_started/completed/partial/failed/scenario_recalculated`)
- `durationMs`
- `hasEntryFramework`
- `hasInvalidation`
- `hasPortfolioContext`
- `hasGoalContext`
- `scenarioPointCount`

Never logged: share count, capital, max loss, portfolio values, cost basis, raw thesis, user identity.

---

## Glossary Terms Added (10)

`equity_planning`, `entry_framework`, `research_entry_zone`, `hypothetical_position_size`, `scenario_capital`, `scenario_loss`, `invalidation_level`, `scenario_analysis`, `monitoring_plan`, `reference_price`

---

## Test Coverage

`server/routes/__tests__/equity-planning.test.ts` — 28 sections, 180+ assertions

Coverage includes:
- Entry condition types, scenario percentages, compliance disclaimers
- Platform health metrics shape
- Sizing: capital limit, risk limit, effective shares, ceiling enforcement
- Scenario P/L math (all 7 default points)
- No forecast / no expected return language
- Monitoring plan categories
- No options/contract/order fields
- No-portfolio and no-goal flows
- Partial-data resilience (null price, null invalidation, stale data)
- Security (no client price injection)
- Route ordering integrity
- Architecture contract (no raw scanner)
- Commercial model (no tier entitlements)
- Future roadmap discipline

---

## Future Roadmap

| Sprint | Scope |
|--------|-------|
| 2.7.2 | Options Strategy Matching — match structures to thesis |
| 2.7.3 | Contract & Strike Research |
| 2.7.4 | Trade Risk & Scenario Analysis |
| 2.7.5 | Trade Plan Workspace — full review before order prep |
| 2.7.6 | Trade Monitoring & Lifecycle Intelligence |

### Future Execution Handoff (documented, not implemented)

`EquityPlanningScenario` is NOT an order. Future Order Preparation (2.7.5+) will require:
- Fresh market data validation
- Buying power confirmation
- Broker availability check
- Explicit user action

### Future Cross-Instrument Comparison (documented, not implemented)

- Equity vs Covered Call
- Equity vs Cash-Secured Put
- Equity vs Defined-Risk Spread

### Future Scenario Versioning (documented, not implemented)

If user changes constraints → new version created (not silent overwrite).

### Commercial Model (documented, not implemented)

| Tier | Features |
|------|---------|
| FREE | Basic equity scenario preview |
| RETAIL | Full equity planning, sizing, monitoring |
| PROFESSIONAL | Multi-scenario comparison, extended history |
| RIA | Advisor scenarios, firm methodology, audit history |
| INSTITUTIONAL | Custom sizing, liquidity constraints, approval workflows |
| ENTERPRISE | Custom engines, APIs, white-label |

No entitlement enforcement in 2.7.1.
