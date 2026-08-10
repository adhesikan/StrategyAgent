# 30 — Options Strategy Matching Engine

**Sprint:** 2.7.2  
**Status:** Production  
**Scope:** Options strategy FAMILY matching — no contract selection

---

## Overview

Options Strategy Matching (Sprint 2.7.2) is the options layer of the Trade Planning pipeline. It evaluates 17 strategy families against an existing research thesis and user-selected planning constraints to produce a structured `OptionsStrategyMatchResult`.

It does **not** select: expiration, strike, contract, premium, spread width, quantity, or broker order. Those belong to later sprints.

---

## Architecture Position

```
Research → Goals → Portfolio Intelligence → Trade Planning Foundation → Equity Planning → OPTIONS STRATEGY MATCHING → Contract Research (2.7.3) → Risk Analysis (2.7.4) → Trade Plan Workspace (2.7.5) → Execution
```

| Layer | Answers |
|-------|---------|
| Research | Is this qualified? |
| Trade Planning Foundation (2.7.0) | How could the thesis be expressed? |
| Equity Planning (2.7.1) | How could equity expression be structured? |
| **Options Strategy Matching (2.7.2)** | **Which options strategy FAMILIES are structurally compatible?** |
| Contract Research (2.7.3) | Which contracts/expirations/strikes to research? |
| Risk Analysis (2.7.4) | What are the risk/scenario profiles? |
| Trade Plan Workspace (2.7.5) | Full review before order prep |
| Execution | User submits explicit order |

### Permanent Architecture Rule

Options Strategy Matching may narrow or reject strategy families based on research evidence, user-selected planning constraints, portfolio requirements, volatility/event context, or missing data.

It may **NEVER**:
- Promote an unqualified security into an opportunity
- Rewrite the upstream research thesis to justify an options strategy
- Invent volatility/event data
- Select an actual contract
- Rank strategies as personalized recommendations

### Isolation

This service does NOT import or reference:
- `best-trade-finder.ts` (BestTradePick / recommendation orchestration)
- `options-evaluator.ts` (suitabilityScore / synthetic IV)
- `opportunity-radar` (scanner / radar scoring)
- `live-contract-resolver.ts` (contract selection — belongs to 2.7.3)

---

## Strategy Family Registry

17 supported families:

| Family | Label | Category | Defined Risk | Requires Ownership |
|--------|-------|----------|--------------|-------------------|
| `long_call` | Long Call | Directional Bullish | ✓ | ✗ |
| `long_put` | Long Put | Directional Bearish | ✓ | ✗ |
| `bull_call_spread` | Bull Call Spread | Directional Bullish | ✓ | ✗ |
| `bear_put_spread` | Bear Put Spread | Directional Bearish | ✓ | ✗ |
| `bull_put_spread` | Bull Put Spread | Directional Bullish | ✓ | ✗ |
| `bear_call_spread` | Bear Call Spread | Directional Bearish | ✓ | ✗ |
| `covered_call` | Covered Call | Income | ✗ | ✓ |
| `cash_secured_put` | Cash-Secured Put | Income | ✗ | ✗ |
| `protective_put` | Protective Put | Protective | ✓ | ✓ |
| `collar` | Collar | Protective | ✓ | ✓ |
| `iron_condor` | Iron Condor | Neutral / Range-Bound | ✓ | ✗ |
| `iron_butterfly` | Iron Butterfly | Neutral / Range-Bound | ✓ | ✗ |
| `long_straddle` | Long Straddle | Volatility | ✓ | ✗ |
| `long_strangle` | Long Strangle | Volatility | ✓ | ✗ |
| `calendar_spread` | Calendar Spread | Neutral / Range-Bound | ✓ | ✗ |
| `diagonal_spread` | Diagonal Spread | Directional Bullish | ✓ | ✗ |
| `monitor_only` | Monitor Only | Monitor Only | ✓ | ✗ |

---

## Thesis Direction Derivation

Source: `TradePlanningContext` only — never client-submitted.

| Direction | Primary Signal |
|-----------|---------------|
| BULLISH | VCP, BREAKOUT, GAP_AND_GO, POWER_BREAKOUT, INSTITUTIONAL_ACCUMULATION, VOLUME_SURGE, VWAP_RECLAIM in opportunityType; strong technicalScore |
| BEARISH | BREAKDOWN, DISTRIBUTION, BEARISH_REVERSAL in opportunityType |
| RANGE_BOUND | CONSOLIDATION, RANGE_BOUND, LOW_VOLATILITY in opportunityType |
| VOLATILITY_EXPANSION | marketRegime contains "volatile"/"expansion" |
| VOLATILITY_CONTRACTION | marketRegime contains "contraction"/"low vol" |
| MIXED | Bullish opportunity type + multiple high-severity risk factors |
| UNKNOWN | Insufficient directional signals |
| NEUTRAL | marketRegime contains "neutral"/"range" |

**Rules:**
- Does NOT introduce a new ranking score
- Uses existing opportunityType, technicalScore, riskFactors, marketRegime
- Multiple high-severity risk factors reduce confidence → MIXED

---

## Strategy Match Status Values

| Status | Meaning |
|--------|---------|
| `APPLICABLE` | Structurally compatible with thesis + constraints |
| `POTENTIALLY_APPLICABLE` | Partially compatible; limitations noted |
| `NOT_APPLICABLE` | Structurally incompatible with current thesis |
| `UNAVAILABLE` | Cannot be evaluated (e.g., options disabled) |

No numeric score. Ordering is by status category, then stable strategy label.

---

## Volatility Context

No authoritative IV source exists in 2.7.2.

- Always returns `UNKNOWN`
- Strategy matching continues with noted limitation
- Volatility-sensitive explanations include caveat

**Future (not implemented):** IV percentile / rank from provider data (contract-level IV from 2.7.3 chain data).

---

## Liquidity Context

No chain inspection in 2.7.2. Contract-level liquidity belongs to 2.7.3.

- Always returns `UNKNOWN`
- Limitation noted in result

---

## Event Context

Derived from risk factors and evidence text analysis:
- Scans `riskFactors[].label+detail` for earnings/report keywords
- Scans `primaryEvidence` + `secondaryEvidence` for earnings mentions
- If found: `hasUpcomingEvent: true`, `insideEventWindow: true` (conservative), `daysUntilEvent: null`
- If not found: `hasUpcomingEvent: false`

**Future:** exact event dates from external data source.

---

## Portfolio Requirements

Three families require confirmed underlying ownership:

| Family | Requirement |
|--------|------------|
| `covered_call` | `portfolioContext.ownsSymbol = true` |
| `protective_put` | `portfolioContext.ownsSymbol = true` |
| `collar` | `portfolioContext.ownsSymbol = true` |

If ownership not confirmed → `NOT_APPLICABLE` with explicit ownership requirement reason.

**Critical rule:** Covered calls are NEVER presented as covered without confirmed shares. No hypothetical naked call is classified as covered.

---

## Planning Constraints Applied

| Constraint | Effect |
|-----------|--------|
| `optionsAllowed = false` | All families except `monitor_only` → `UNAVAILABLE` |
| `definedRiskPreferred = true` | Defined-risk families note preference satisfied |
| `incomeFocus = true` | Income families note income context; merged with goalContext.incomeFocused |
| `directionalFocus = true` | Directional families note directional preference |
| `avoidEarningsWindow = true` | Families affected by event risk downgraded to POTENTIALLY_APPLICABLE if inside event window |

---

## No-Portfolio Mode

Without portfolio context:
- Ownership-requiring families (covered_call, protective_put, collar) → NOT_APPLICABLE
- All other families evaluated normally
- Limitation listed in result

---

## No-Goal Mode

Normal flow. Goal context optionally enriches income/directional focus merge.

---

## Explanation Contract

Every strategy family match provides:
- `reasons[]` — Why applicable/not applicable
- `constraintsSatisfied[]` — Which constraints support this match
- `constraintsMissing[]` — Which information is missing
- `riskCharacteristics[]` — Educational broad risk description
- `incomeCharacteristics[]` — Income-oriented characteristics
- `directionalCharacteristics[]` — Directional characteristics
- `eventConsiderations[]` — How events affect this family
- `portfolioRequirements[]` — Ownership/position requirements
- `limitations[]` — Partial data notes
- `nextStageRequirements[]` — What 2.7.3 needs
- `structure` — Generic structural description (no actual contracts)

---

## Capital Constraints

Capital values from planning constraints are **not** used to calculate exact capital requirements (no strike exists yet).

Example for cash_secured_put:
- `limitations[]` includes: "Exact capital requirement requires strike selection (2.7.3)"

Contract Research (2.7.3) calculates actual capital requirement after strike selection.

---

## Defined-Risk Handling

If `definedRiskPreferred = true`:
- Defined-risk families note preference satisfied in `constraintsSatisfied`
- Undefined-risk families still shown (suppressing relevant information artificially is prohibited)
- No ranking as "best" — grouping only

---

## Income Focus Handling

Merged from: `constraints.incomeFocus || goalContext?.incomeFocused`

Income-focused strategies (covered_call, cash_secured_put, bull_put_spread, bear_call_spread, iron_condor, iron_butterfly, collar) note income context when income focus is active.

---

## Data Freshness

5-dimension freshness model:

| Dimension | Source |
|-----------|--------|
| Opportunity Intelligence | `ctx.generatedAt` |
| Portfolio Context | `portfolioContext.freshness.updatedAt` |
| Goal Context | `goalContext.freshness.updatedAt` |
| Volatility Data | Always `unavailable` in 2.7.2 |
| Event Data | Always `unavailable` in 2.7.2 |

`hasStaleCriticalData = true` when Opportunity Intelligence is stale/unavailable.

---

## Partial Data Resilience

| Missing Data | Impact |
|-------------|--------|
| No IV data | volatilityContext = UNKNOWN; limitation listed; matching continues |
| No earnings data | eventContext = null or no event; event considerations reduced |
| No portfolio | ownership-requiring families NOT_APPLICABLE; others continue |
| No goal | normal flow |
| No options chain | family matching works; contract research deferred to 2.7.3 |

---

## API Endpoints

### Route Order (static before dynamic)

```
GET  /api/trade-planning/session/:id/options/matches              ← static
GET  /api/trade-planning/session/:id/options/matches/:family      ← static
POST /api/trade-planning/:symbol/options/match                    ← dynamic (last)
```

### POST /api/trade-planning/:symbol/options/match

Build options strategy match for a symbol.

**Body:** `{ constraints?, planningSessionId? }`

**Response:** `{ result: OptionsStrategyMatchResult, disclaimer, optionsRiskDisclosure }`

### GET /api/trade-planning/session/:id/options/matches

Retrieve full match result for a saved session.

**Response:** `{ result: OptionsStrategyMatchResult, disclaimer, optionsRiskDisclosure }`

### GET /api/trade-planning/session/:id/options/matches/:strategyFamily

Detail view for one strategy family.

**Response:** `{ match: OptionsStrategyMatch, thesisDirection, volatilityContext, eventContext, disclaimer, optionsRiskDisclosure }`

---

## Security

- All endpoints authenticated
- Planning session ownership enforced — cross-user → 404
- Client cannot inject: thesisDirection, researchScore, marketRegime, IV, portfolio ownership, qualification state, event date
- Server reconstructs all authoritative context

---

## Cache

Recomputed on-demand from current authoritative context.
No cross-user sharing.
If caching added in future: key on `userId + planningContextId + constraintsFingerprint + volatilityTimestamp + eventTimestamp`.

---

## Performance

- No scanner, no ranking, no AI, no option-chain contract scan
- No per-strategy provider calls
- Pure deterministic computation
- Target: < 100ms after context assembly
- `generationLatencyMs` always reported in result

---

## Platform Health

`tradePlanning` health card in `/api/admin/platform-health` extended with 6 options metrics:

| Metric | Description |
|--------|-------------|
| `optionsMatchRequests` | Total match requests received |
| `optionsMatchesCompleted` | Successfully completed matches |
| `partialOptionsMatches` | Matches with limitations (partial data) |
| `failedOptionsMatches` | Failed match attempts |
| `averageOptionsMatchLatencyMs` | Average latency |
| `lastSuccessfulOptionsMatchAt` | Timestamp of last success |

No symbol, strategy selection, capital, portfolio, or user identity in health metrics.

---

## Structured Logging

Safe log events:
- `options_strategy_match_completed`
- (future) `options_strategy_match_partial`, `options_strategy_match_failed`, `options_strategy_selected`

Safe metadata: `durationMs`, `strategyFamilyCount`, `applicableCount`, `potentialCount`, `unavailableCount`, `hasVolatilityContext`, `hasEventContext`, `hasPortfolioContext`

Never logged: symbol, capital, strategy selection by user, portfolio values, user identity.

---

## Compliance

### Required Vocabulary
- Options Strategy Research
- Potentially Applicable Strategy Family
- Strategy Match
- Research Structure
- Strategy Family
- Thesis Direction

### Forbidden Vocabulary
- Recommended Strategy / Best Strategy
- Best Option Trade / Best Trade
- Highest Probability / Winning Trade
- Income Guarantee / Safe Options Trade
- Expected Return / Target Price

### Canonical Disclaimer
> "Options Strategy Matching identifies strategy families that are structurally consistent with the current research thesis and planning constraints. It does not recommend a specific strategy, contract, expiration, strike, or trade and does not constitute investment advice or a suitability determination."

---

## Options Risk Disclosure

> "Options involve risk and are not suitable for everyone. Options may lose their entire value rapidly. Some options strategies can involve substantial or theoretically unlimited loss unless defined-risk protections are used. Not every strategy described here is a defined-risk structure. Verify the broad loss characteristics of any strategy family before pursuing contract research."

---

## Naked / Undefined-Risk Policy

- No naked short call / naked short put families introduced in 2.7.2
- Covered Call and Cash-Secured Put are explicitly distinct structures
- Covered Call NEVER shown as covered without confirmed underlying shares

---

## 2.7.3 Handoff Contract

`OptionsContractResearchInput` — canonical handoff type:

```typescript
{
  planningContextId:              string;
  strategyFamily:                 OptionsStrategyFamily;
  researchHorizon:                string | null;
  thesisDirection:                ThesisDirection;
  volatilityContext:              VolatilityContext;
  liquidityContext:               LiquidityContext;
  eventContext:                   EventContext | null;
  planningConstraintsFingerprint: string;
}
```

**Rules:**
- 2.7.3 must consume this input — it must NOT re-run strategy-family selection from scratch
- No strikes/DTE/premium in this handoff
- `contractResearchInput` is `null` for NOT_APPLICABLE / UNAVAILABLE families

---

## 2.7.4 Handoff (documented, not implemented)

Risk & Scenario Analysis (2.7.4) calculates per actual structure:
- Max gain, max loss, breakeven
- Greeks approximations
- Probability estimates
- Scenario P/L grid

These are **not implemented** in 2.7.2. Generic strategy risk descriptions are in scope for 2.7.2.

---

## Glossary Terms Added (11)

`options_strategy_matching`, `strategy_family`, `thesis_direction`, `volatility_context`, `event_risk`, `defined_risk_strategy`, `income_strategy`, `directional_strategy`, `neutral_strategy`, `protective_strategy`, `options_liquidity`

---

## Test Coverage

`server/routes/__tests__/options-strategy-matching.test.ts` — 129 assertions across 50 sections

Coverage includes:
- All 17 strategy families
- All 8 thesis directions
- Options disabled → all UNAVAILABLE
- Defined-risk preference
- Income focus
- Portfolio ownership (covered_call/protective_put/collar)
- Cash-secured put
- Event context (earnings risk)
- Volatility UNKNOWN
- No portfolio mode
- No goal mode
- Strategy risk characteristics
- No numeric ranking
- No contract/strike/expiration/premium
- 2.7.3 handoff contract
- Structure descriptions
- Freshness
- Platform health metrics
- Partial data resilience
- Route regression
- Roadmap discipline
- Risk disclosure
- Security

---

## UAT

1. Open qualified opportunity
2. Open Trade Planning → Enable Options Research
3. Open Options Strategy Research panel
4. Verify thesis direction shown
5. Verify applicable group
6. Verify potentially applicable group
7. Verify not-applicable group
8. Open Long Call detail → verify no strike/expiration
9. Open Bull Call Spread → verify defined-risk noted
10. Open Covered Call without shares → verify NOT_APPLICABLE
11. Connect portfolio with shares → verify Covered Call context changes
12. Verify Cash-Secured Put capital note references contract research
13. Verify neutral strategy handling (iron condor, iron butterfly)
14. Verify volatility context shows UNKNOWN with explanation
15. Verify event context when earnings risk in evidence
16. Enable Avoid Earnings Window → verify event-affected families downgraded
17. Verify no strike/expiration/contract/premium in any match
18. Verify no broker call triggered
19. No-portfolio user → verify ownership-requiring NOT_APPLICABLE
20. No-goal user → verify normal flow
21. Cross-user session → 404
22. Platform Health → verify 6 options metrics present

---

## Troubleshooting

### All families show UNAVAILABLE
- Check: `constraints.optionsAllowed` — must be `true`
- Fix: user must enable options research in planning constraints

### Covered Call shows NOT_APPLICABLE unexpectedly
- Check: `portfolioContext.ownsSymbol` — must be `true`
- Fix: connect portfolio or upload holdings with this symbol

### Vol context always UNKNOWN
- Expected in 2.7.2 — no IV source connected yet
- Future: 2.7.3 will access option chain IV data

### Thesis direction UNKNOWN despite clear opportunity type
- Check: opportunityType string matches one of the bullish/bearish/neutral type sets
- New opportunity types must be added to the relevant set in the engine

---

## Future Roadmap

| Sprint | Scope |
|--------|-------|
| 2.7.3 | Contract Research — expiration, strike, contract selection |
| 2.7.4 | Risk & Scenario Analysis — max gain/loss, Greeks, breakeven |
| 2.7.5 | Trade Plan Workspace — full review before order prep |
| 2.7.6 | Trade Monitoring & Lifecycle Intelligence |

### Future Volatility Context (documented, not implemented)
- IV percentile, IV rank from option chain data
- LOW / NORMAL / ELEVATED / HIGH tiers
- Volatility-sensitive strategy rules

### Future Organization Policy (documented, not implemented)
```typescript
interface OptionsPlanningPolicy {
  allowedStrategies?:    OptionsStrategyFamily[];
  prohibitedStrategies?: OptionsStrategyFamily[];
  optionsLevel?:         "level_1" | "level_2" | "level_3" | "level_4";
  requireDefinedRisk?:   boolean;
  minLiquidityRules?:    string;
  maxEventExposure?:     number;
  customDisclosures?:    string[];
}
```

### Commercial Model (documented, no enforcement)

| Tier | Features |
|------|---------|
| FREE | Basic strategy family explanation |
| RETAIL | Full 17-family matching, goal + portfolio context, Research Workspace |
| PROFESSIONAL | Advanced filters, comparison, historical context |
| RIA | Approved strategy universe, firm policy, compliance workflow |
| INSTITUTIONAL | Custom strategy library, liquidity policy, approval workflows |
| ENTERPRISE | Custom engines, APIs, white-label |
