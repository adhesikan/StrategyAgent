# Sprint Change Log

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
