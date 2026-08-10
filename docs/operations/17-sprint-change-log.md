# Sprint Change Log

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
