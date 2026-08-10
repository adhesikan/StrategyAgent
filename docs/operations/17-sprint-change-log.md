# Sprint Change Log

## Sprint 2.7.4 — Trade Risk & Scenario Analysis (2026-08-10)

### Summary
Builds the deterministic Trade Risk & Scenario Analysis engine — the risk characterization layer of Trade Planning. Given a selected Contract Research candidate (Sprint 2.7.3), it computes maximum loss/gain, breakeven prices, payoff under hypothetical price/IV/time scenarios, Greek profile, liquidity/quote risk, constraint check, and thesis risk overlay. No recommendation, no POP, no probability language.

### Key Architecture Decisions
- **Probability metrics: OFF** — `probabilityMetricsEnabled: false` always; existing scorer is a heuristic, not a statistical model
- **No Black-Scholes repricing** — price scenarios use expiration intrinsic payoff (exact) + delta approximation (labeled ≈); two separate values per row
- **Server authoritative** — client sends only `contractResearchCandidateId`; server reconstructs all candidate/leg/quote/Greek data from 30-min session cache
- **Missing Greeks → null, never zero** — `greeksCoveragePercent` tracks partial coverage
- **No auto-substitution** — `EXCEEDS_CONSTRAINT` shown; user navigates back to contract research

### New Features
- **Payoff profile** — max loss, max gain, breakevens for all 15 families (calendar/diagonal → PATH_DEPENDENT)
- **Price scenarios** — 11 default points (−40% to +40%); expiration intrinsic + delta approx per point
- **IV sensitivity** — vega approximation across 5 relative IV change points
- **Time decay checkpoints** — 6 points (1 day → 100% DTE elapsed); linear theta approx
- **Event scenarios** — earnings / event window gaps, IV uncertainty, assignment risk notes
- **Greek profile** — net delta/gamma/theta/vega/rho; coverage %; plain-language delta interpretation
- **Capital profile** — net debit/credit, cash-secured capital, contract multiplier
- **Liquidity & quote risk** — worst-leg bid-ask spread %, lowest OI, quote freshness
- **Constraint check** — defined max loss vs user planning constraint (`WITHIN_CONSTRAINT` / `EXCEEDS_CONSTRAINT` / `NO_CONSTRAINT_SET` / `UNDEFINED_RISK`)
- **Thesis risk** — invalidation note overlay from research context
- **11 risk flag codes** — MAX_LOSS_EXCEEDS_CONSTRAINT, EVENT_WINDOW, STALE_QUOTE, WIDE_BID_ASK, LOW_OPEN_INTEREST, PARTIAL_GREEKS, PATH_DEPENDENT_PAYOFF, ASSIGNMENT_RISK, EARLY_EXERCISE_RISK, UNLIMITED_GAIN, SUBSTANTIAL_UNDERLYING_DOWNSIDE
- **4 new static API routes** — POST/GET/GET+analysisId/POST-recalculate `/session/:id/risk-analysis/*`
- **8 platform health metrics** — riskAnalysesRequested/Completed/partial/failed, avg latency, staleCount, probabilityMetricsEnabled, lastSuccessful
- **17 glossary terms** added (`RISK_SCENARIO_ENTRIES` merged into `ALL_GLOSSARY_ENTRIES`)
- **`RiskAnalysisPanel`** — full client panel with structure summary, payoff profile, price table, Greeks, IV table, time decay, event scenarios, risk flags, thesis risk, liquidity/quote risk, constraint check, freshness warning
- **`ContractResearchAndRiskSection`** — state-machine wrapper toggling between ContractResearch and RiskAnalysis panels
- **`storeSessionContractResearch`** called in POST `/options/contracts` so risk routes can look up candidates
- **2.7.5 handoff** — `TradePlanInput` in every `TradeRiskScenarioResult.tradePlanHandoff`

### Files Changed
- `shared/trade-risk-scenario-types.ts` — canonical types (new file)
- `server/services/trade-risk-scenario-service.ts` — pure deterministic engine, 5-min cache, 30-min session cache (new file)
- `server/routes/trade-planning.ts` — 4 new static risk-analysis routes; `storeSessionContractResearch` call; route comment updated
- `server/routes/platform-health.ts` — 8 risk analysis health metrics + `getRiskAnalysisHealth` import
- `client/src/pages/trade-planning.tsx` — `RiskAnalysisPanel` + `ContractResearchAndRiskSection`; CTA button activated; 17 glossary imports
- `shared/research-glossary.ts` — 17 new terms (`RISK_SCENARIO_ENTRIES`); merged into `ALL_GLOSSARY_ENTRIES`
- `docs/operations/32-trade-risk-scenario-analysis.md` — new ops doc

### Schema
No new database tables. Risk analysis results are in-memory (5-min per-user cache). Session contract research is 30-min in-memory session cache. Persistence planned for a future sprint.

### Tests
`server/routes/__tests__/risk-scenario.test.ts` — 151 tests across 37 sections covering payoff math, Greek profiles, scenario tables, risk flags, constraint checks, caching, and health metrics.

---

## Sprint 2.7.3 — Options Contract Research Engine (2026-08-10)

### Summary
Builds the Options Contract Research Engine — the live broker chain layer of Trade Planning. Given a trader-selected strategy family, it loads live option expirations and chains, applies DTE / event / liquidity / moneyness filters, constructs valid multi-leg structures for all 17 families, and returns bounded research candidates sorted by data quality. No recommendation, no order construction, no POP.

### New Features
- **Live chain pipeline** — 1 `getOptionExpirations` call + 1 `getOptionChain` per expiration (no N+1)
- **DTE range classification** — family-specific defaults (e.g. income families 20–45, directional 30–90); user override via filtersOverride
- **Event window** — `before_event / contains_event / after_event / no_event_detected`; `avoidEarningsWindow` filter excludes event expirations
- **Liquidity 4-tier** — STRONG / ACCEPTABLE / LIMITED / POOR; POOR leg excludes candidate; thresholds documented in `LIQUIDITY_THRESHOLDS`
- **Moneyness classification** — ITM / ATM (±2%) / OTM per option type
- **Multi-leg builders** — all 17 families; iron condor 4-leg validated; iron butterfly ATM-pin validated; same-expiration enforced
- **Greek null safety** — null for missing Greeks; never zero-fill; net Greeks null when any leg missing
- **Midpoint** — (bid + ask) / 2 with `MIDPOINT_DISCLAIMER` on every result
- **Rejection transparency** — `contractsEvaluated`, `contractsRejected`, `topRejectionReasons[]`
- **ContractQualityCategory** — EXCELLENT_DATA_QUALITY → STRONG → ACCEPTABLE → LIMITED_DATA ordering
- **2.7.4 handoff** — `TradeRiskScenarioInput` in every candidate with planning context fingerprint
- **Covered call safety** — NEVER constructs naked call; requires `ownsSymbol=true`
- **3 new static API endpoints** — POST/GET `/session/:id/options/contracts`, GET `/session/:id/options/contracts/:id`
- **9 platform health metrics** added to tradePlanning card
- **16 glossary terms** added (`CONTRACT_RESEARCH_ENTRIES`)
- **`ContractResearchPanel`** client panel shown after Options Strategy Panel when options family selected
- **2-minute chain cache** per userId:symbol:expiration; never shared across users

### Files Changed
- `shared/contract-research-types.ts` — canonical types (new file)
- `server/services/contract-research-service.ts` — pure deterministic engine (new file)
- `server/routes/trade-planning.ts` — 3 new static session endpoints before dynamic routes
- `server/routes/platform-health.ts` — 9 contract research metrics
- `client/src/pages/trade-planning.tsx` — ContractResearchPanel
- `shared/research-glossary.ts` — 16 new terms (CONTRACT_RESEARCH_ENTRIES)
- `docs/operations/31-options-contract-research.md` — new ops doc

### Schema
No new database tables. Research results are in-memory / per-request. Persistence planned for Sprint 2.7.4.

### Tests
`server/routes/__tests__/contract-research.test.ts` — 200+ assertions across 27 sections

### Compliance
- `CONTRACT_RESEARCH_DISCLAIMER` — research only; not a recommendation
- `MIDPOINT_DISCLAIMER` — midpoint ≠ guaranteed fill on every result
- `OPTIONS_RISK_DISCLOSURE_EXTENDED` — full risk disclosure
- No POP, no "best contract", no recommendation language, no order fields

---

## Sprint 2.7.2 — Options Strategy Matching Engine (2026-08-10)

### Summary
Builds the deterministic Options Strategy Matching Engine — the options layer of Trade Planning. Evaluates 17 strategy families against a qualified TradePlanningContext and user-selected planning constraints. Returns an `OptionsStrategyMatchResult` with APPLICABLE / POTENTIALLY_APPLICABLE / NOT_APPLICABLE / UNAVAILABLE status for each family, full explanation, risk characteristics, portfolio requirements, and 2.7.3 handoff input. No contract selection, no strike, no expiration, no premium, no recommendation.

### New Features
- **17 strategy families** evaluated deterministically: long_call, long_put, bull_call_spread, bear_put_spread, bull_put_spread, bear_call_spread, covered_call, cash_secured_put, protective_put, collar, iron_condor, iron_butterfly, long_straddle, long_strangle, calendar_spread, diagonal_spread, monitor_only
- **Thesis direction derivation** — 8 directions from opportunityType, technicalScore, riskFactors, marketRegime; no new ranking score
- **Portfolio ownership enforcement** — covered_call/protective_put/collar require confirmed shares; NEVER presented as covered without shares
- **Volatility context** — UNKNOWN by default; honest limitation; no IV fabrication
- **Liquidity context** — UNKNOWN; deferred to 2.7.3
- **Event context** — derived from risk factor text analysis; conservative handling
- **Constraint gates** — optionsAllowed, definedRiskPreferred, incomeFocus, directionalFocus, avoidEarningsWindow all applied
- **No-portfolio mode** — full functionality; ownership-requiring families NOT_APPLICABLE
- **2.7.3 handoff type** — `OptionsContractResearchInput` documented and populated for applicable families
- **3 new API endpoints** — POST `/:symbol/options/match`, GET/GET `/session/:id/options/matches[/:family]`
- **6 platform health metrics** added to tradePlanning card
- **11 glossary terms** added
- **`OptionsStrategyPanel`** client panel shown in Trade Planning when options family selected

### Files Changed
- `shared/options-strategy-types.ts` — canonical types
- `server/services/options-strategy-matching-service.ts` — matching engine
- `server/routes/trade-planning.ts` — 3 new endpoints
- `server/routes/platform-health.ts` — 6 options metrics
- `client/src/pages/trade-planning.tsx` — OptionsStrategyPanel
- `shared/research-glossary.ts` — 11 new terms
- `docs/operations/30-options-strategy-matching.md` — new ops doc

### Schema
No new database tables. Match results computed on-demand from existing `trade_planning_sessions` + Opportunity Intelligence.

### Tests
`server/routes/__tests__/options-strategy-matching.test.ts` — 129 assertions across 50 sections

### Compliance
- `OPTIONS_STRATEGY_DISCLAIMER` — not investment advice, not recommendation, not suitability
- `OPTIONS_RISK_DISCLOSURE` — unlimited loss possibility disclosed
- `NO_RECOMMENDATION_NOTE` — confirms no ranking

---

## Sprint 2.7.1 — Equity Trade Planning Engine (2026-08-10)

### Summary
Builds the deterministic Equity Trade Planning Engine — the HOW layer for equity expression research. Converts a qualified TradePlanningContext plus user-selected planning constraints into a structured EquityPlanningScenario: entry framework (from canonical EMA levels), invalidation framework (from canonical research evidence), hypothetical position sizing (deterministic, no financial questionnaire), scenario analysis (7 percentage moves, not a price forecast), and a monitoring plan. No orders, no strikes, no expirations, no recommendations.

### New Features
- **EquityPlanningScenario** — canonical model reusable by Trade Plan Workspace (2.7.5), Research Reports, Position Monitoring, RIA/Institutional workflows
- **Entry Framework** — deterministic from EMA 9/21/50 stored bars; entry zones labeled "Research Scenario Entry Zone" (never "Buy Zone"); `available=false` when no data
- **Invalidation Framework** — from canonical `invalidatesThesis[]` and `riskFactors[]`; no fabricated levels
- **Hypothetical Position Sizing** — `floor(maxAtRisk/price)` by capital; `floor(maxLoss/riskPerShare)` by risk; `effectiveShares = min(...)` with capital ceiling
- **Scenario Analysis** — 7 default points (−20%/−10%/−5%/0%/+5%/+10%/+20%); user-configurable range; P/L per point; not a forecast
- **Monitoring Plan** — 8 categories (technical/fundamental/institutional/sector/theme/regime/portfolio/events); deterministic; no automated alerts
- **Data Freshness** — 7-dimension freshness; STALE INPUT WARNING when critical data > 3 days old
- **Equity endpoints** — 4 new: POST `/:symbol/equity`, GET/PATCH `/session/:id/equity`, GET `/session/:id/equity/scenarios`
- **UI integration** — EquityPlanningPanel shown in Trade Planning page when equity/equity_scaled expression selected
- **Platform Health** — 5 equity metrics added to `tradePlanning` health card
- **10 glossary terms** added to `shared/research-glossary.ts`

### Schema
No new database tables (scenarios are computed on-demand from existing `trade_planning_sessions` + Opportunity Intelligence + stored bars).

### Tests
`server/routes/__tests__/equity-planning.test.ts` — 28 sections, 180+ assertions

### Compliance
- `EQUITY_PLANNING_DISCLAIMER` — not investment advice, not suitability, not buy/sell/hold
- `SIZING_DISCLAIMER` — scenario values, not recommendations
- `SCENARIO_DISCLAIMER` — hypothetical, not a price forecast or expected return

---

## Sprint 2.7.0 — Trade Planning Foundation (2026-08-10)

### Summary
Builds the canonical bridge between Research and Trade Planning. Converts a qualified research candidate into a structured planning context and identifies 10 expression families (equity, income, defined-risk, covered call, cash-secured put, vertical spread, long option, neutral options, monitor-only). Fully deterministic — no AI, no recommendations, no ranking language, no strike/expiration/contract selection. Does NOT implement order tickets or broker submission.

### New Features
- **Trade Planning Context**: `GET /api/trade-planning/:symbol/context` — authoritative `TradePlanningContext` built from Opportunity Intelligence + Goals + Portfolio Intelligence
- **Expression Family Evaluation**: 10 families, 3 statuses (`applicable / potentially_applicable / unavailable`), fully deterministic, no "recommended" or "best" labels
- **Planning Sessions**: `POST /api/trade-planning/session` + `GET/PATCH /api/trade-planning/session/:id` — per-user, per-symbol sessions with constraint persistence
- **Expression Re-evaluation**: `GET /api/trade-planning/session/:id/expressions` — re-evaluate with current constraints
- **Planning Constraints**: `TradePlanningConstraints` — no income/netWorth/age/taxBracket; scenario parameters only
- **Trade Planning Page**: `/trade-planning/:symbol` — 8 sections: research context, evidence, goal, portfolio context, constraints form, expression cards, risk/invalidation, freshness, future steps, compliance
- **Opportunity Workspace upgrade**: `TradePlanningHandoff` component upgraded from "future workflow" placeholder to live CTA linking to `/trade-planning/:symbol`
- **Glossary**: 9 new terms in `shared/research-glossary.ts`
- **Platform health**: `tradePlanning` health card in `/api/admin/platform-health`

### Schema Changes
```sql
-- migrations/028_trade_planning_sessions.sql
CREATE TABLE trade_planning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  opportunity_id TEXT,
  research_goal_id TEXT,  -- TEXT to match research_goals.id (varchar)
  portfolio_id UUID,
  constraints JSONB NOT NULL DEFAULT '{"equityAllowed":true,"optionsAllowed":false}',
  selected_expression_family TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Compliance
- **`TRADE_PLANNING_DISCLAIMER`** — not investment advice, not suitability, not buy/sell/hold instruction
- **`CONSTRAINTS_DISCLAIMER`** — constraints are not a suitability questionnaire
- **`NO_RANKING_DISCLAIMER`** — no expression is labeled recommended, best, or optimal

### Tests
`server/routes/__tests__/trade-planning.test.ts` — 26 sections, 175+ assertions

---

## Sprint 2.6.5 — Goals & Research Planning (2026-08-10)

### Summary
Introduces Research Goals — personal research filters that let traders express what they want to research (themes, sectors, opportunity types, horizon) without any financial questionnaire, suitability assessment, or portfolio-personal data. Goals drive context entry in the Research Workspace, surface matching candidates, generate deterministic research plans, and feed the dashboard "Research For Your Goals" section.

### New Features
- **Research Goals CRUD**: Create, read, update, archive goals with 12 goal types, 4 horizons, 10 research styles, 3 volatility preferences
- **First-time experience**: Quick-start goal cards (8 presets) + 5-step inline wizard on `/goals`
- **Goal matching**: Deterministic `matchOpportunityToGoal()` — categorical states only (`strong_match / match / partial_match / outside_filters`); no numeric suitability score
- **Goal Match Summary**: `GET /api/research-goals/:id/matches` — top 25 matches against current opportunity snapshot
- **Goal Activity Summary**: `GET /api/research-goals/:id/activity` — highlights from current snapshot for goal filters
- **Research Plan**: `GET /api/research-goals/:id/plan` — deterministic workflow with suggested actions, monitor items, research candidates
- **Research Workspace integration**: `?goalId=X` URL param → context entry with goal filters pre-applied
- **Primary goal**: One primary goal per user (service-layer enforcement); drives dashboard and workspace defaults
- **Platform health**: `GET /api/research-goals/health` — active goals, users with goals, primary goal set rate
- **Match cache**: Per-user/goal/snapshotId cache (5-min TTL), invalidated on goal change; never cross-user

### Schema Changes
```sql
-- migrations/027_research_goals.sql
CREATE TABLE research_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  description TEXT,
  horizon TEXT NOT NULL DEFAULT 'long_term',
  research_style TEXT NOT NULL DEFAULT 'balanced',
  focus_areas JSONB NOT NULL DEFAULT '[]',
  preferred_sectors JSONB NOT NULL DEFAULT '[]',
  preferred_themes JSONB NOT NULL DEFAULT '[]',
  preferred_opportunity_types JSONB NOT NULL DEFAULT '[]',
  volatility_preference TEXT NOT NULL DEFAULT 'balanced',
  options_interest BOOLEAN NOT NULL DEFAULT false,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Files Changed
| File | Change |
|------|--------|
| `shared/research-goal-types.ts` | New — GoalType (12), ResearchHorizon (4), ResearchStyle (10), VolatilityPreference (3), compliance constants, TradePlanningContextShape (future Phase 2.7 doc only) |
| `shared/schema.ts` | Added `researchGoals` pgTable |
| `shared/research-workspace-types.ts` | Added `"goal"` to ResearchContextType |
| `server/services/research-goal-service.ts` | New — CRUD, primary goal, deterministic matching, activity, goal context, research plan, platform health |
| `server/routes/research-goals.ts` | New — 12 endpoints (static routes before dynamic /:id) |
| `server/routes.ts` | Added `registerResearchGoalRoutes` |
| `client/src/pages/goals.tsx` | New — first-time experience, 5-step wizard, goal list, primary goal card |
| `client/src/pages/goal-detail.tsx` | New — Matches, Activity, Plan tabs |
| `client/src/App.tsx` | Added `/goals/new`, `/goals/:id`, `/goals` routes |
| `migrations/027_research_goals.sql` | New migration (applied) |
| `docs/operations/27-research-goals-and-planning.md` | New ops doc |
| `server/routes/__tests__/research-goals.test.ts` | 68 tests across 20 sections |

### Breaking Changes
None — new table, new routes, new pages only.

### Key Decisions
- Categorical match states only — no numeric suitability score exposed to client or AI
- No financial questionnaire fields — income, net worth, age, tax bracket explicitly excluded
- Primary goal enforced in service layer (not DB constraint) — single `UPDATE SET is_primary = false WHERE user_id = ?` before setting new primary
- Static goal sub-routes (`/primary`, `/health`, `/metadata`) registered before dynamic `/:id` route to prevent routing regression
- AI receives goal context but cannot invent matches — matching runs deterministically before AI explanation
- TradePlanningContextShape documented as Phase 2.7 interface only — not yet implemented
- Volatility preference is a research filter, not a risk tolerance assessment

---

## Sprint 2.6.4 — Research Workspace v2 (2026-08-10)

### Summary
Upgrades `/research-workspace` into the canonical cross-platform AI research environment. All other surfaces (Opportunity Workspace, Collections, Theme/Sector pages, Monitor, Reports, Portfolio Intelligence, and Command Center) now enter the workspace with full context, prefilled questions, and evidence-based AI responses.

### New Features
- **Context entry contract**: All 13 `ResearchContextType` values supported — symbol, theme, sector, collection, portfolio, monitor, report, comparison, institutional, market, etc.
- **`GET /api/research-workspace/context`**: New endpoint — assembles canonical `ResearchContext` from URL params (symbol, themeId, sector, collectionId, portfolioId, watchId, reportId).
- **Context banner**: Client shows context banner ("Researching: NVDA", "Theme: AI Infrastructure") when navigated from another surface with params.
- **Evidence sidebar**: Desktop-only collapsible right panel with top evidence items from latest AI response.
- **Comparison matrix v2**: Side-by-side table (researchScore, technicalScore, institutionalScore, riskLevel, themes) when mode=comparison with ≥2 tickers.
- **Challenge thesis workflow**: Template + `action=challenge` param — prefills bear-case question for any symbol.
- **`relax_filter` handler**: Follow-up actions with `type=relax_filter` now update the scope selector instead of doing nothing.
- **Conversation loading**: `?conversation=UUID` in URL restores message history from saved conversation.
- **Source attribution**: Every AI response labeled green (OpenAI) or yellow (rule-based fallback).
- **12 templates**: 3 new — "Challenge This Investment Thesis", "Explain What Changed", "Explain Risk Profile".
- **Conversation persistence v2**: `workspace_conversations` now stores `contextType`, `contextLabel`, `primarySymbol`, `comparisonSymbols`, `sourceRoute`.
- **Platform health v2**: 7 new health metrics surfaced in `/admin/platform-health` card.
- **OW handoff fix**: Opportunity Workspace action buttons now use `mode=company&action=explain_concept` (valid mode + action), not `mode=explain_concept` (invalid).

### Schema Changes
```sql
-- migrations/026_research_workspace_context.sql
ALTER TABLE workspace_conversations
  ADD COLUMN IF NOT EXISTS context_type       TEXT,
  ADD COLUMN IF NOT EXISTS context_label      TEXT,
  ADD COLUMN IF NOT EXISTS primary_symbol     VARCHAR,
  ADD COLUMN IF NOT EXISTS comparison_symbols TEXT[],
  ADD COLUMN IF NOT EXISTS source_route       VARCHAR;
```

### Files Changed
| File | Change |
|------|--------|
| `shared/schema.ts` | Added 5 nullable columns to `workspaceConversations` |
| `shared/research-workspace-types.ts` | Added ResearchContextType, WorkspaceAction, ResearchContext, ACTION_QUESTIONS, ACTION_MODE_MAP; 12 templates; extended ConversationSummary + WorkspaceAskRequest |
| `shared/research-workspace-helpers.ts` | New — pure URL param parsing + context derivation helpers |
| `server/services/research-workspace-service.ts` | Rewrote — assembleCanonicalContext, recordContextRequest/Ask/Partial, scope-based filtering, RiskFactor/EvidenceItem model fixes |
| `server/routes/research-workspace.ts` | Added GET /api/research-workspace/context; updated POST /api/research/ask to persist context metadata |
| `client/src/pages/research-workspace.tsx` | Full rewrite — all URL params, context banner, evidence sidebar, comparison matrix v2, relax_filter, conversation loading, source attribution, 12 templates |
| `client/src/pages/opportunity-workspace.tsx` | Fixed AIResearchSection action URLs (mode + action params) |
| `server/routes/platform-health.ts` | Added 7 new workspace health metrics to the research workspace health card |
| `migrations/026_research_workspace_context.sql` | New migration |
| `docs/operations/26-research-workspace-v2.md` | New ops doc |
| `server/routes/__tests__/research-workspace-v2.test.ts` | 175+ assertions across 20 sections |

### Breaking Changes
None — all schema changes are nullable, all URL params are additive.

### Key Decisions
- Separate `action` URL param (never overloads `mode`) — `?mode=company&action=challenge` avoids invalid mode values
- Pure helpers in `shared/research-workspace-helpers.ts` — importable by server tests without crossing client/server boundary
- `filterOpportunities` has no `scope` field — scope filtering implemented with a local `filterByScopeKey` function
- `RiskFactor` and `InvalidatesThesis` are objects, not strings — serialized to `.label` / `.condition` strings when sent to AI

---

## Sprint 2.6.3 — Opportunity Workspace v2 (2026-07-xx)

### Summary
Aggregated opportunity workspace with 15-section client, single batch endpoint, and 127 tests.

- Added `GET /api/opportunities/workspace/:symbol` (aggregated — 15 fields, Promise.allSettled)
- Fixed static route collision: `/opportunities/today` and `/opportunities/changes` registered before dynamic `:symbol` routes
- `WatchStatus` is lowercase; themes are name strings not IDs
- 127 pure tests

---

## Sprint 2.6.2 — Portfolio Analytics (2026-07-xx)

Analytics module (Phase 3 of Portfolio Intelligence). No new DB tables, 5-min cache. "Portfolio Value Change" not "Return". Theme overlap disclosure required. `sectorExposureHistory`/`themeExposureHistory` empty until capture stores breakdown.

---

## Sprint 2.6.1 — Portfolio Intelligence (2026-07-xx)

Pure computation engine, 15-min cache, 9 glossary terms, 2 routes, Intel tab. `EvidenceItem` from OppIntel types. Ops doc must avoid "portfolio score/grade/rating" literal phrases.

---

## Sprint 2.6.0 — Portfolio History & Change Intelligence (2026-07-xx)

Snapshot tables (raw SQL), bulk enrichment, SHA256 dedup, change classifier. `getReferenceSnapshotsBulk` needs `userId` first; `themeId` not `id`; no numeric `riskScore` in `CanonicalOpportunity`.

---

## Sprint 2.5.5 — Research Reports Engine (2026-06-xx)

1 new table (`research_reports`); 16 report types; 5 export formats. `OpportunityChange` uses `.direction` not `.changeType`. Test dynamic imports need `../../services/` from `__tests__/`.

---

## Sprint 2.5.4 — Research Monitor (2026-06-xx)

2 new tables (`research_watches`, `watch_activity_log`); 13 watch types; pure evaluation from precomputed stores; daily feed; command center + platform health integration; 113 tests.

---

## Sprint 2.5.3A — Research Glossary & Score Transparency (2026-06-xx)

`shared/research-glossary.ts` is sole source; `riskScore` higher=better profile (not more risk); 94 tests; no DB/logic changes.

---

## Sprint 2.5.3 — Market Research Command Center (2026-06-xx)

10 sections; 2 routes; 60 tests; health snapshot in-memory (resets on restart); no new DB tables; free/premium tiers documented only.

---

## Sprint 2.5.2 — AI Research Workspace v1 (2026-05-xx)

8-mode AI workspace; evidence panels; saved conversations; 10 templates; 7 routes; 151 tests. `wouter`: useLocation+useSearch only.

---

## Sprint 2.5.1 — Research Collections (2026-05-xx)

25 system collections + user collections; collections store symbol refs only; OppIntel loaded once per request; 5 new DB tables; 15 routes; 139 tests.

---

## Sprint 2.5.0 — Opportunity Intelligence Engine (2026-05-xx)

Canonical `CanonicalOpportunity` model; pure enrichment layer over `getLatestRanking()`; single batch DB query for company meta; theme map from registry; 3 GET routes; 156 tests.
