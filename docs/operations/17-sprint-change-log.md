# 17 — Sprint Change Log

**Format:** Most-recent sprint first. Each entry captures purpose, key services, routes, tables, jobs, env/config impact, UAT additions, troubleshooting additions, and known limitations.

---

## Sprint 2.5.4 — Continuous Research Monitoring & Daily Intelligence Feed (2026-08-09)

**Purpose:** Create a Continuous Research Monitoring system that automatically tracks meaningful changes across research entities. Users define watches; the platform detects changes using existing precomputed intelligence only.

### DB Schema (2 new tables)

| Table | Purpose |
|-------|---------|
| `research_watches` | One row per watch per user |
| `watch_activity_log` | One row per detected change per evaluation |

Both created via `CREATE TABLE IF NOT EXISTS` in `ensureResearchMonitorTables()` — idempotent, safe on every startup.

### New Key Files

| Type | Path |
|------|------|
| Shared types | `shared/research-monitor-types.ts` |
| Service | `server/services/research-monitor-service.ts` |
| Routes | `server/routes/research-monitor.ts` |
| Client page | `client/src/pages/research-monitor.tsx` |
| Tests | `server/routes/__tests__/research-monitor.test.ts` |
| Ops doc | `docs/operations/19-research-monitor.md` |

### Watch Types (13)

company, theme, sector, collection, opportunity_type, market_regime, institutional_activity, growth_candidates, income_candidates, momentum, etf_candidates, dividend_candidates, custom_collection

### Watch Activity Types (16)

new_candidate, candidate_removed, score_improved, score_weakened, confidence_changed, regime_change, theme_improved, theme_weakened, sector_improved, sector_weakened, collection_added, collection_removed, institutional_accumulation, institutional_distribution, member_count_changed, status_unchanged

### Daily Research Feed

Deterministic feed from precomputed stores. Sections:
1. New Qualified Candidates (from ranking.changes)
2. Improved Research Scores (from ranking.changes — upgraded)
3. Weakened Research Scores (from ranking.changes — downgraded)
4. Market Regime (from ranking.regime)
5. Theme Changes (scoreDelta ≥ 3)
6. Sector Changes (scoreDelta ≥ 3)
7. My Watch Changes (personalized — last 24h)

### API Endpoints (8)

- `GET  /api/research-monitor/watches`
- `POST /api/research-monitor/watches`
- `GET  /api/research-monitor/watches/:id`
- `PATCH /api/research-monitor/watches/:id`
- `DELETE /api/research-monitor/watches/:id`
- `POST /api/research-monitor/watches/:id/evaluate`
- `GET  /api/research-monitor/feed`
- `GET  /api/research-monitor/health`

### Integrations

| Integration | Change |
|-------------|--------|
| Command Center | Added `myWatchChanges: MyWatchChangesSection` to `CommandCenterDailySnapshot` |
| Platform Health | Added `researchMonitoring` health card |
| App routing | `/research-monitor` → `ResearchMonitorPage` |

### Future Notification Targets (Interfaces Only — NOT Implemented)

`NotificationTarget` interface defines: email, push, slack, teams, webhook. `notifyEmail` and `notifyPush` columns reserved in `research_watches`. Sprint 2.6+ roadmap item.

### Performance

All evaluation reads from existing in-memory stores. No new background jobs. No LLM calls. No new scanner/ranking computation.

### Env / Config Impact
None. Read-only intelligence reads only.

---

## Sprint 2.5.3A — Research Transparency, Explainability & Central Research Glossary (2026-08-09)

**Purpose:** Refinement sprint — make existing research scores understandable, standardize terminology, create one canonical Research Glossary, improve compliance clarity, and add accessibility to all score surfaces. Zero business-logic changes.

### No DB Schema Changes. No New Background Jobs. No Scoring Logic Changes.

### New Key Files

| Type | Path |
|------|------|
| Shared glossary | `shared/research-glossary.ts` |
| Tooltip component | `client/src/components/research-definition-tooltip.tsx` |
| Score modal | `client/src/components/score-explanation-modal.tsx` |
| Tests | `server/routes/__tests__/research-glossary.test.ts` |
| Operations doc | `docs/operations/18-research-glossary.md` |

### Central Research Glossary

Single source of truth for all research terminology. 30+ entries covering scores, confidence, evidence, market context, candidate types, data quality, and institutional activity. All definitions comply with the "never overstate methodology" rule. 13F delay disclosure required on all institutional entries.

### UI Surfaces Updated

| Surface | Changes |
|---------|---------|
| Dashboard | ScorePill labels (Tech/Inst/Fund/Risk) get glossary tooltips; confidence badge gets help icon; overall score gets help icon; "Why This Qualified" expandable panel added to every card; "How are scores calculated?" modal link in section header |
| Opportunity Workspace | ScoreBar labels (Overall/Technical/Institutional/Fundamental/Risk/Regime) get glossary tooltips; "Understanding research scores" modal link in Score card header |
| Scanner | "Top Picks" heading renamed to "High-Scoring Setups" |
| Options Scanner | Both "Top Picks" headings renamed to "High-Confidence Results" |
| Smart Panel | "Top Pick" label renamed to "Highest Score" |

### Risk Score Semantics Verified & Documented

`riskScore` on `OpportunityScore` (from the Opportunity Ranking Engine) is "higher = better risk profile" — verified from `computeRiskScore()` in `server/services/opportunity-ranking-engine.ts`. This semantic is now documented in the glossary, pinned by a failing test if changed, and displayed in the tooltip with "↑ Higher is better."

### Compliance Audit

- "Top Picks" → "High-Scoring Setups" / "High-Confidence Results" (scanner / options scanner)
- "Top Pick" → "Highest Score" (smart panel)
- No "Strong Buy", "Buy Now", "Recommended Trade", "Buy Candidate" found in research surfaces
- Evidence Confidence badges no longer imply probability of success
- All score tooltips include caution text: "not a prediction of future performance"
- 13F disclosure mandatory on institutional score and institutional activity entries

### Accessibility

- `ResearchDefinitionTooltip` trigger is a `<button>` (keyboard-focusable by default)
- Enter/Space activates via button default behavior + Radix tooltip
- Escape closes via Radix TooltipPrimitive
- `aria-label="What is {term}?"` on every trigger
- `aria-expanded` on "Why This Qualified" toggle button
- `aria-controls` links toggle to panel
- Modal: Radix Dialog provides focus trap, Escape close, restore focus, semantic headings
- Touch: onClick state toggling for mobile tap support
- No horizontal overflow: `max-w-xs` with word-wrap on tooltip content

### Why This Qualified Panel

Every dashboard opportunity card now has a collapsible "Why this qualified" panel:
- Expanded: shows all `score.reasons` (emerald checkmarks) + `score.warnings` (amber triangles)
- Collapsed by default (tap/click to reveal)
- Uses ONLY deterministic evidence already in `OpportunityScore.reasons` / `OpportunityScore.warnings`
- No LLM invocation
- Footer: "Deterministic evidence only. Not a recommendation."

### Env / Config Impact
None. Read-only UI changes only.

### Known Limitations
- Research Hub and Research Workspace pages have modal available via exported components but not yet wired (follow-up sprint opportunity)
- AI system prompts not yet updated to reference canonical glossary definitions (follow-up sprint)

---

## Sprint 2.5.3 — Market Research Command Center (2026-08-09)

**Purpose:** Build the primary daily destination for users. Answers "What changed today?" without requiring search. Aggregates all intelligence surfaces — Opportunity Intelligence, Research Collections, AI Research Workspace, Market/Theme/Sector Intelligence, and Institutional Intelligence — into a single unified snapshot.

### Design Goals
- One aggregated endpoint reads from all precomputed stores in parallel (zero recomputation)
- Each of 10 sections degrades independently — one failure never blocks others
- Every section shows: What's New, What's Changed, Evidence, Confidence, Freshness, Related Research
- Every card links into: Opportunity Workspace · AI Research Workspace · Theme/Sector Research · Collections · Institutional
- Free vs Premium tiers documented in types (no artificial restrictions in code)
- Platform Health card added for admin monitoring

### New Key Files

| Type | Path |
|------|------|
| Shared types | `shared/command-center-types.ts` |
| Server route | `server/routes/market-research-command-center.ts` |
| Client page | `client/src/pages/market-research-command-center.tsx` |
| Tests | `server/routes/__tests__/market-research-command-center.test.ts` |

### No New DB Tables
All data is read from existing precomputed stores. No schema migrations required.

### New Routes (2)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/command-center/daily` | User | Aggregated daily snapshot (all 10 sections) |
| GET | `/api/command-center/health` | User | Lightweight in-memory health (no DB read) |

### New Client Route
`/market-research-command-center` — Market Research Command Center page

### 10 Sections

| Section | Source | What's Available When |
|---------|--------|----------------------|
| Market Overview | Theme + Sector snapshots + Ranking regime | Intelligence rebuild has run |
| Opportunity Changes | Change Engine + opportunity_history DB | Ranking exists |
| Theme Changes | Theme snapshots | Intelligence rebuild has run |
| Sector Changes | Sector snapshots | Intelligence rebuild has run |
| Institutional Changes | institutional_symbol_signals | INSTITUTIONAL_INTELLIGENCE_ENABLED=true + 13F ingested |
| Collection Changes | Collection service (system collections) | System collections seeded |
| My Collections | Collection service (user collections) | User has followed/pinned/favorited collections |
| AI Research Summary | workspace_conversations DB | User has started research conversations |
| Research Timeline | workspace_conversations DB | User has started research conversations |
| Explain Why | Static cross-navigation links | Always available |

### Cross Navigation
Every card navigates to: `/opportunities/:symbol` · `/research-workspace` · `/intelligence/themes/:themeId` · `/intelligence/sectors/:sector` · `/research?collection=:id` · `/institutional/funds`

### Free vs Premium (documented — no code restrictions)
- **Registered**: Market Overview, top-5 Theme/Sector changes, Opportunity Changes (5 movers), system collection highlights, Research Timeline (last 5)
- **Subscribers**: Full Opportunity Changes, all Theme/Sector, Institutional Changes, AI Research Summary
- **Professional**: Evidence citations per section, cross-collection analysis, institutional fund detail
- **Enterprise**: Custom collection monitoring, institutional portfolio matching

### Platform Health
New `commandCenter` key in `/api/admin/platform-health` response — tracks `sectionsAvailable`, `opportunityChangesAvailable`, `themeDataAvailable`, `sectorDataAvailable`, `collectionsSeeded`, `institutionalDataAvailable`.

### Env / Config Impact
None. Reads `INSTITUTIONAL_INTELLIGENCE_ENABLED` (already used by institutional routes).

### Known Limitations
- `topOpportunities` field in `CollectionChangeSummary` is intentionally empty for lightweight collection listing (would require N+1 detail calls to populate)
- Health snapshot is in-memory only — resets on server restart until a user visits `/market-research-command-center`
- Institutional signals section reads raw DB (not pre-aggregated signals service) to avoid import cycle with route-level module

---

## Sprint 2.5.2 — AI Research Workspace (2026-08-08)

**Purpose:** Transform Ask AI into a dedicated Research Workspace that consumes the full intelligence stack — Opportunity Intelligence Engine, Research Collections, Sector Intelligence, and Theme Intelligence. The AI explains evidence; it never invents opportunities.

### Design Goals
- 8 deterministic research modes, each with a mode-specific system prompt
- 10 built-in research templates covering every core research workflow
- Structured evidence panels in every AI response (7 sections)
- Honest diagnostics when no candidates qualify (never "No opportunities.")
- Contextual follow-up actions (never generic buttons)
- Saved conversations with pin/unpin and history
- Compliance-first: zero "recommendation", "buy", "sell", "target price"

### New Key Files

| Type | Path |
|------|------|
| Shared types | `shared/research-workspace-types.ts` |
| Service | `server/services/research-workspace-service.ts` |
| Routes | `server/routes/research-workspace.ts` |
| Client page | `client/src/pages/research-workspace.tsx` |
| Tests | `server/routes/__tests__/research-workspace.test.ts` |

### New DB Tables (2)
`workspace_conversations`, `workspace_messages`

### Research Modes (8)
Opportunity · Company · Theme · Sector · Institutional · Market · Collection · Comparison

### Context Scopes (28)
Entire Market · My Collections · 6 AI/Tech themes · 5 Sectors · 10 Strategy types · 4 Dynamic · Future Portfolio (placeholder)

### Research Templates (10)
Explain Why This Qualified · Compare Two Companies · Strongest AI Infrastructure Candidates · Summarize Today's Market Intelligence · Explain Institutional Activity · Explain Theme Leadership · Explain Sector Leadership · Find Similar Opportunities · Show Recent Changes · Challenge This Investment Thesis

### New Routes (7)

| Method | Path |
|--------|------|
| POST | `/api/research/ask` |
| GET | `/api/research/conversations` |
| GET | `/api/research/conversations/:id` |
| DELETE | `/api/research/conversations/:id` |
| PATCH | `/api/research/conversations/:id/pin` |
| GET | `/api/research/templates` |

### Architecture
`assembleResearchContext()` calls `getOpportunityIntelligence()` ONCE, `getLatestSectorSnapshots()` and `getLatestThemeSnapshots()` in parallel. AI response is parsed into `WorkspaceAIResponse` with all 7 evidence sections. `buildRuleBasedWorkspaceResponse()` used as deterministic fallback. Conversations persist as `workspace_conversations` + `workspace_messages` (jsonb for AI responses). AI never re-invents data; all evidence sourced from deterministic engines.

### Platform Health
`checkResearchWorkspace()` → `DEGRADED` if OpenAI key missing or context assembly fails. `researchWorkspace` key in `buildPlatformHealth()`. Admin health page "Research Workspace" card added.

### Client Route
`/research-workspace` → `ResearchWorkspacePage` added to App.tsx

### Tests
151 structural assertions across 13 categories: modes, scopes, types, templates, schema, service, routes, registration, platform health, client page, compliance, architecture, roadmap discipline.

### Compliance
System prompt explicitly lists "Never: recommendation / buy / sell / target price". All evidence items use "research candidate" vocabulary. Disclaimer on every response. Tests verify absence of buy/sell labels in rendered JSX.

### Deferred (per roadmap)
Portfolio Intelligence context, Alert triggers, Automated follow-up agents, Goal Planning, Tax Planning.

---

## Sprint 2.5.1 — Personalized Research Collections & Watchlists (2026-08-08)

**Purpose:** Create the personalization layer for VCP Trader AI. Research Collections allow users to follow system-curated collections and build their own custom collections of research candidates, consuming the Opportunity Intelligence Engine from Sprint 2.5.0.

### Design Goals
- Every user receives value immediately — 25 system collections available on first login.
- No broker, portfolio, or uploaded files required.
- Collections store only symbol references — never duplicate opportunity data.
- Compliance-first: all language uses "research candidate" vocabulary.

### Key Files

| Type | Path |
|------|------|
| Types | `shared/collection-types.ts` |
| Registry | `server/config/collection-registry.ts` |
| Service | `server/services/collection-service.ts` |
| Routes | `server/routes/research-collections.ts` |
| Tests | `server/routes/__tests__/research-collections.test.ts` |

### New DB Tables (5)
`research_collections`, `collection_symbols`, `user_collection_follows`, `user_collection_favorites`, `user_collection_pins`

### System Collections (25)
**Theme:** AI Infrastructure, Semiconductors, Memory, Networking, Cybersecurity, Cloud  
**Sector:** Energy, Healthcare, Financials, Consumer, Industrials  
**Strategy:** Dividend, Income, Growth, Momentum, Value, ETF, Long-Term Investments, Swing Trading, Covered Calls, Cash Secured Puts  
**Dynamic:** Market Leaders, Recently Improved, Institutional Activity, New Opportunities

### New Routes (15)

| Method | Path |
|--------|------|
| GET | `/api/collections` |
| POST | `/api/collections` |
| GET | `/api/collections/symbol/:symbol` |
| GET | `/api/collections/:id` |
| PATCH | `/api/collections/:id` |
| DELETE | `/api/collections/:id` |
| POST | `/api/collections/:id/follow` |
| DELETE | `/api/collections/:id/follow` |
| POST | `/api/collections/:id/favorite` |
| DELETE | `/api/collections/:id/favorite` |
| POST | `/api/collections/:id/pin` |
| DELETE | `/api/collections/:id/pin` |
| POST | `/api/collections/:id/duplicate` |
| POST | `/api/collections/:id/symbols` |
| DELETE | `/api/collections/:id/symbols/:symbol` |

### Architecture
Collections consume `getOpportunityIntelligence()` from Sprint 2.5.0 — called ONCE per request, filtered locally (no N+1 DB queries). System collections are filter-driven (no stored symbol lists). User collections store explicit symbol references in `collection_symbols`.

### Startup
`seedSystemCollections()` runs fire-and-forget on startup to ensure all 25 system collections exist in DB. Idempotent — safe to call on every restart.

### Platform Health
`checkCollections()` added. `collections` key in `buildPlatformHealth()`. Reports system/user count, follows, favorites, pins, seeding status.

### Compliance
All routes, services, registry descriptions use "research candidate" language. Zero uses of "recommendation", "buy", "sell", "target price" as values/keys.

### Tests
120+ structural assertions covering registry (25 system collections), filter spec helpers, schema tables, shared types, service functions (18 exports), access control, routes (15), registration, platform health, architecture, compliance, roadmap discipline.

### Deferred (per roadmap)
Portfolio Intelligence, Alerts, AI Conversations, automated collection population (user-side rule-based filtering), collection sharing between users.

---

## Sprint 2.5.0 — Opportunity Intelligence Engine (2026-08-08)

**Purpose:** Build a reusable Opportunity Intelligence Engine that produces a normalized `CanonicalOpportunity` model consumed by Dashboard, Research, Ask AI, Intelligence, and future Portfolio/Watchlist/Alert features. Eliminates logic duplication across consumer pages.

### Design Goals
- Every user receives value immediately. No broker, portfolio, or uploaded files required.
- Research-first. Evidence-first. Compliance-first.
- LLM explanations summarize evidence; they never invent evidence.

### Key Files

| Type | Path |
|------|------|
| Types | `shared/opportunity-intelligence-types.ts` |
| Service | `server/services/opportunity-intelligence-service.ts` |
| Routes | `server/routes/opportunity-intelligence.ts` |
| Tests | `server/routes/__tests__/opportunity-intelligence.test.ts` |

### New Routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/intelligence/opportunities` | Filtered & sorted canonical list |
| GET | `/api/intelligence/opportunities/meta` | Available filter options (lightweight) |
| GET | `/api/intelligence/opportunities/:symbol` | Single canonical opportunity |

### Canonical Opportunity Model Fields
`id`, `symbol`, `companyName`, `sector`, `industry`, `themes[]`, `opportunityType`, `opportunityTypeLabel`, `researchScore`, `technicalScore`, `fundamentalScore`, `institutionalScore`, `sentimentScore`, `confidence`, `marketRegime`, `timeHorizon`, `riskLevel`, `lastUpdated`, `primaryEvidence[]`, `secondaryEvidence[]`, `riskFactors[]`, `invalidatesThesis[]`

### Supported Opportunity Types (22)
growth, long_term_investment, income, covered_call, cash_secured_put, etf, dividend, momentum, value, swing, ai_infrastructure, semiconductors, memory, networking, cybersecurity, cloud, energy, healthcare, financials, consumer, industrials, custom_theme

### Architecture
Pure enrichment layer. Reads `getLatestRanking()` (in-memory, no new scanner). Single batch DB query for company metadata from `market_data_symbols`. Theme memberships from curated registry (no DB). No logic duplication.

### Filtering
Sector, industry, theme, opportunityType, riskLevel, timeHorizon, minResearchScore, minTechnicalScore, minInstitutionalScore, marketRegime

### Sorting
researchScore, technicalScore, institutionalScore, symbol, lastUpdated, opportunityType

### Platform Health
`checkOpportunityIntelligence()` added. `opportunityIntelligence` key in `buildPlatformHealth()`. Admin health page renders new "Opportunity Intelligence" card.

### Compliance
All language uses "Research Candidate" / "Investment Candidate" / "Trade Candidate". Never "recommendation", "buy", "sell", "target price", "strong buy".

### Tests
156 new structural + logic assertions covering: canonical model (21), opportunity types (24), score mapping (7), evidence panels (11), filtering (13), sorting (6), meta extraction (6), platform health (5), route registration (9), compliance (8), architecture (8), roadmap discipline (5).

### No schema changes
Engine is a pure enrichment layer. No new DB tables. Uses existing `market_data_symbols`, `getLatestRanking()`, and curated theme registry.

### Deferred
Ask AI deep integration (uses existing opportunitySearch path), Portfolio Intelligence, Watchlists, Alerts, AI Agents.

---

## Sprint 2.4.2 — Broker Synchronization (2026-08-08)

**Purpose:** Allow users to synchronize portfolio holdings directly from Tradier and TradeStation. Architecture supports adding Schwab, Fidelity, IBKR, Robinhood, Webull, E*Trade without schema redesign.

### Key Services & Routes

| Type | Path / Name |
|------|-------------|
| Service | `server/services/broker-sync-service.ts` |
| Routes | `server/routes/broker-sync.ts` |
| Page | `client/src/pages/portfolio-connect.tsx` |
| GET | `/api/portfolio/broker/connections` |
| POST | `/api/portfolio/broker/connect` |
| POST | `/api/portfolio/broker/sync/:portfolioId` (409 if running) |
| GET | `/api/portfolio/broker/sync/:portfolioId/status` |
| DELETE | `/api/portfolio/broker/disconnect/:portfolioId` |

### Schema Changes

No new tables. `portfolios.sourceAccountId` stores the broker provider name ("tradier"/"tradestation"). `portfolioSourceTypeEnum` already included `"broker"`.

### Jobs

`"broker_sync"` added to `JobName` union in `job-status-store.ts`. Emits `markJobStarted / markJobCompleted / markJobFailed`.

### Platform Health

New `checkBrokerSync()` function + `brokerSync` key added to `buildPlatformHealth()`. Admin health page renders new "Broker Sync" card.

### Structured Logging (Part 9)

Every sync emits `broker_sync_started`, `broker_sync_completed`, `broker_sync_failed`. UserId redacted. No tokens, credentials, account numbers, or PII logged.

### Compliance Disclosures (Part 10)

Shown before connecting:
- "Broker synchronization imports portfolio holdings for research purposes."
- "It does not authorize trading."
- "You may disconnect your broker at any time."
- "Broker data is used only for portfolio research features."

### Tests

110 new structural assertions in `server/routes/__tests__/broker-sync.test.ts`.

### Deferred

Background sync scheduling (cron not yet wired — `runBrokerSync()` interface ready). Portfolio Intelligence, scoring, recommendations, rebalancing, tax, goals, alerts, research workspace.

### Next Sprint

2.4.3 — Portfolio History / Change Intelligence

---

## Sprint 2.3.6 — Production Hardening (2026-08-08)

**Purpose:** Close the gap between working scanner/ranking and working intelligence. Fix sector snapshot root cause, add ops tooling.

### Root Cause Fixed
`intelligence-orchestrator.ts` queried `symbols WHERE sector IS NOT NULL` — the `symbols` table was always empty. Fixed to `LEFT JOIN market_data_symbols` (the actual active-symbol universe). Theme intelligence was unaffected because it uses hardcoded `config/theme-registry.ts`.

### Services / Files
- `server/services/intelligence-orchestrator.ts` — `loadSymbolSectors()` LEFT JOIN fix; precomputation status tracking
- `server/services/daily-market-data/symbol-enrichment.ts` — NEW: `enrichMissingSymbolClassifications()` (Twelve Data /profile)
- `server/services/job-status-store.ts` — NEW: in-memory job status model
- `server/lib/structured-log.ts` — NEW: JSON event logging + secret redaction
- `server/services/sector-intelligence-engine.ts` — `unclassifiedCount` + `classifiedButUnrankedCount` fields
- `server/routes/intelligence.ts` — rebuild lock, classification coverage in diagnostics, precomputation status in diagnostics
- `server/routes/platform-health.ts` — NEW: 11-card health dashboard
- `docs/operations/` — NEW: 15 docs + system-manifest.yaml

### Routes Added
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/platform-health` | Admin | System health JSON |
| POST | `/api/admin/platform-health/refresh` | Admin | Force health cache refresh |
| POST | `/api/admin/symbols/enrich` | Admin | Trigger sector enrichment |
| POST | `/api/admin/intelligence/rebuild` | Admin | Rebuild sector+theme snapshots |
| GET | `/api/admin/intelligence/diagnostics` | Admin | Extended diagnostics |
| GET | `/admin/platform-health` | Admin | Platform Health UI page |

### Tables
No new tables. `unclassifiedCount` field added to `SectorSnapshot` interface (in-memory only).

### Jobs
7 jobs now tracked in `job-status-store.ts`: `scanner`, `ranking`, `intelligence_precompute`, `institutional_ingestion`, `mapping_pipeline`, `institutional_signal_rebuild`, `symbol_enrichment`.

### Env / Config
`TWELVE_DATA_API_KEY` required for symbol enrichment (already required for market data).

### UAT Additions
- Platform Health UI at `/admin/platform-health`
- `GET /api/admin/intelligence/diagnostics` — extended fields
- Two-step recovery: enrich → rebuild → verify

### Troubleshooting Additions
- Sector snapshots = 0 while theme snapshots > 0 → root cause documented
- `symbols` table empty → use `market_data_symbols` — documented in runbook
- Rebuild lock 409 response — documented

### Known Limitations
- Sector enrichment requires one-time admin trigger after fresh deploy (KI-001)
- Ranking lost on restart (KI-002)
- psql not available in Railway shell (KI-003)

---

## Sprint 2.3.5 — Market Research Hub (2026-07)

**Purpose:** `/research` hub aggregating 6 intelligence modules over 4 parallel precomputed APIs.

### Services
- `server/routes/research.ts` — NEW: research hub API
- `client/src/pages/research-hub.tsx` — NEW

### Routes Added
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/research/hub` | None | Aggregated hub response |
| GET | `/research` | None | Research Hub UI |
| GET | `/research/library` | Auth | Saved research packages |

### Known Limitations
- Hub renders "not available yet" for Intelligence and Institutional when snapshots are empty — fixed by Sprint 2.3.6

---

## Sprint 2.3.4 — Market Intelligence

**Purpose:** Intelligence Dashboard — sector + theme snapshot viewer with briefing.

### Services
- `server/routes/intelligence.ts` — `/api/intelligence/briefing`, `/api/intelligence/sectors`, `/api/intelligence/themes`
- `client/src/pages/intelligence-dashboard.tsx` — NEW

### Routes Added
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/intelligence/briefing` | None |
| GET | `/api/intelligence/sectors` | None |
| GET | `/api/intelligence/themes` | None |
| GET | `/api/intelligence/sectors/:sector` | None |
| GET | `/api/intelligence/themes/:themeId` | None |
| GET | `/intelligence` | None |

### Known Bug (fixed in 2.3.6)
`toISOString is not a function` — production PG driver returns TIMESTAMP as string; fixed by `toIso()` helper.

---

## Sprint 2.3.3 — Sector & Theme Intelligence

**Purpose:** Precomputed sector and theme intelligence snapshots powering the intelligence dashboard.

### Services
- `server/services/sector-intelligence-engine.ts` — NEW
- `server/services/theme-intelligence-engine.ts` — NEW
- `server/services/intelligence-orchestrator.ts` — NEW
- `server/services/intelligence-snapshot-store.ts` — NEW
- `server/config/theme-registry.ts` — NEW (12 themes, hardcoded symbol lists)

### Tables
- `sector_intelligence_snapshots` — created in `runStartupMigrations()`
- `theme_intelligence_snapshots` — created in `runStartupMigrations()`

### Jobs
`intelligence_precompute` — fire-and-forget after each ranking cycle.

### Important Facts
- Theme registry is hardcoded — themes work even when `market_data_symbols.sector` is null
- Sector snapshots require both ranking + sector classification to produce data
- `unclassifiedCount` counts ranked symbols not in any sector (diagnostic only)

---

## Sprint 2.3.2 — Institutional Fund Explorer

**Purpose:** Manager-level 13F Fund Explorer — browse funds, see positions, track accumulation.

### Services
- `server/routes/institutional-funds.ts` — NEW
- `client/src/pages/institutional-funds.tsx` — NEW
- `client/src/pages/institutional-fund-detail.tsx` — NEW

### Routes Added
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/institutional/funds` | None |
| GET | `/api/institutional/funds/:managerId` | None |
| GET | `/institutional/funds` | None |
| GET | `/institutional/funds/:managerId` | None |

### Important Facts
- `managerId` = SEC CIK number (not EDGAR accession)
- `reported_value` canonical unit = USD dollars (post-2023 SEC VALUE already in dollars — no ×1000)
- `formatPortfolioValue` has trillion tier

---

## Sprint 2.3.1 — Opportunity Change Intelligence

**Purpose:** Deterministic engine explaining WHY ranked opportunities changed between cycles.

### Services
- `server/services/opportunity-change-intelligence.ts` — NEW
- Dashboard `EnrichedRankingChangesPanel`
- Workspace `WhyItChangedPanel`

### Routes Added
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/opportunities/changes/explained` | None |

### Change States
8 deterministic states: `new`, `upgraded`, `downgraded`, `moved`, `graduated`, `lost`, `unchanged`, `returning`

---

## Sprint 2.3.0 — Opportunity Research Workspace

**Purpose:** `/opportunities/:symbol` — 5-tab workspace for deep symbol research.

### Services
- `server/routes/opportunity-workspace.ts` — NEW
- `client/src/pages/opportunity-workspace.tsx` — NEW

### Routes
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/opportunities/workspace/:symbol` | None |
| GET | `/opportunities/:symbol` | None |

### Important Facts
- 2-call contract: `GET /api/opportunities/today` (ranking) + `GET /api/opportunities/workspace/:symbol`
- `brokerConnected` gates InstaTrade™ tab

---

## Sprint 2.2.x — Institutional Pipeline & Mapping

**Purpose:** Full SEC 13F ingestion, aggregation, signals, and CUSIP→ticker mapping.

### Key Incidents Resolved
| Symptom | Fix |
|---------|-----|
| `company.idx` fixed-width parsing failure | Switched to SEC bulk ZIP (SUBMISSION.tsv + INFOTABLE.tsv) |
| VALUE 1000× too large | Post-2023 VALUE is USD not thousands; removed ×1000 |
| `FILINGMANAGER_NAME` missing | In COVERPAGE.tsv — requires three-table join |
| `VOTING_AUTH_*` field name changes | Normalized in parser |
| Partial ingestion on timeout | Advisory lock + resumable skip logic |
| Route collision `:symbol` | Static routes must precede dynamic institutional route |

### Tables
- `institutional_filings`
- `institutional_holdings`
- `security_master`
- `institutional_symbol_mappings`
- `institutional_symbol_signals`
- `institutional_ingestion_runs`

### Jobs
- `institutional_ingestion` (advisory lock 774_412_003, quarterly)
- `mapping_pipeline`
- `institutional_signal_rebuild`

### Env Required
- `INSTITUTIONAL_13F_INGESTION_ENABLED=true`
- `INSTITUTIONAL_INTELLIGENCE_ENABLED=true`
- `SEC_USER_AGENT=<org name email>` (required by SEC EDGAR)

---

## Operations Manual Definition of Done

> Starting Sprint 2.3.7, every sprint affecting production behavior MUST update the Operations Manual as part of its Definition of Done.

**Always update:**
- `17-sprint-change-log.md`

**If routes changed:**
- `16-api-and-uat-reference.md`

**If new failure/recovery paths:**
- `11-troubleshooting-runbook.md`

**If schema/migrations changed:**
- `03-database-and-migrations.md`

**If deployment/env changed:**
- `02-environments-and-deployment.md`

**If security/auth changed:**
- `12-security-and-devsecops.md`

**If scheduled/background jobs changed:**
- `09-background-jobs-and-scheduling.md`

**If architecture changed:**
- `01-system-architecture.md`

A sprint completion report must include:
```
Operations Manual Updated: YES / NO
Operations Manual Files Updated: [list]
```

A sprint requiring documentation CANNOT be GO when `Operations Manual Updated = NO`.

---

## Sprint 2.4.0 — Portfolio Foundation & Flexible Intake

**Date:** August 2026  
**Phase:** Portfolio Research Intelligence (Phase 1 of N)

### New Tables

| Table | Purpose |
|-------|---------|
| `portfolios` | User portfolio container (id, userId, name, sourceType, sourceAccountId) |
| `portfolio_positions` | Per-position rows (symbol, quantity, averageCost, costBasis, currency, sourceType) |

New enum: `portfolio_source_type` → `manual | csv | xlsx | broker`

### New Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/portfolio` | List user portfolios |
| POST | `/api/portfolio` | Create portfolio |
| PATCH | `/api/portfolio/:id` | Rename portfolio |
| DELETE | `/api/portfolio/:id` | Delete portfolio + cascade positions |
| GET | `/api/portfolio/:id/positions` | List positions (enriched with stored market data) |
| POST | `/api/portfolio/:id/positions` | Add manual position |
| PATCH | `/api/portfolio/:id/positions/:positionId` | Edit position |
| DELETE | `/api/portfolio/:id/positions/:positionId` | Remove position |
| POST | `/api/portfolio/import/csv` | Parse CSV → preview (no write) |
| POST | `/api/portfolio/import/xlsx` | Parse XLSX → preview (no write) |
| POST | `/api/portfolio/import/confirm` | Confirm preview → write to DB |

### New Services

- `server/services/portfolio-normalization.ts` — pure, no-LLM normalization; flexible header synonyms; duplicate consolidation; 500-row cap
- `server/services/portfolio-import.ts` — CSV and XLSX parsing via xlsx package; formula cell stripping; MIME guards; 5 MB limit

### New Client Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/portfolio` | `portfolio.tsx` | Onboarding → holdings overview |
| `/portfolio/import` | `portfolio-import.tsx` | 3-step upload → preview → confirm |

### Security Notes

- All portfolio routes: `isAuthenticated` middleware required
- User isolation: `userId` always from `req.session.userId!`, never from request body
- Ownership enforced at query level: `WHERE id = ? AND user_id = ?` (returns 404 for foreign resources)
- Preview store: session-bound Map, single-use, 30-minute TTL
- File upload: multer memoryStorage (no disk writes), 5 MB limit, MIME check, formula cells stripped
- No broker credentials returned in any position response

### Architecture Decisions

- Market data: `getReferenceSnapshotsBulk(userId, symbols, {realtime:false})` — stored bars only; no new Twelve Data calls
- No recommendations, no buy/sell advice, no AI commentary (deferred to future sprints)
- Broker positions can be imported manually via CSV export from the broker's own download feature

### Operations Manual Updated

- `docs/operations/17-sprint-change-log.md` ← this file
- `docs/operations/16-api-and-uat-reference.md` ← portfolio routes added
- `docs/operations/11-troubleshooting-runbook.md` ← CSV/XLSX import incidents added
- `docs/operations/12-security-and-devsecops.md` ← file upload and portfolio isolation section added

---

## Sprint 2.4.1A — Portfolio Upload Privacy & Compliance Disclosures

**Date:** 2026-08-08
**Type:** UX/compliance refinement only — zero backend, schema, extraction, or architecture changes.

### Objective

Add clear privacy and compliance disclosures to all portfolio upload flows before production deployment. Affects CSV, XLSX, Screenshot, and PDF import pages.

### Files Changed

| File | Change |
|------|--------|
| `client/src/pages/portfolio-import.tsx` | Added privacy disclosure, consent notice, review warning, confirm disclaimer + research disclaimer |
| `client/src/pages/portfolio-import-document.tsx` | Added full privacy disclosure, AI extraction disclosure, file-retention notice, PII warning, consent notice, review warning, confirm disclaimer + research disclaimer |
| `server/routes/__tests__/portfolio-privacy-disclosures.test.ts` | **NEW** — 48 pure structural disclosure tests |
| `docs/operations/17-sprint-change-log.md` | This entry |
| `docs/operations/16-api-and-uat-reference.md` | Disclosure UAT items added |
| `docs/operations/12-security-and-devsecops.md` | User-facing disclosure inventory |

### Disclosures Added

| § | Location | Disclosure |
|---|----------|-----------|
| §1 | CSV/XLSX upload — before button | Privacy & Data Use: file used only to import holdings, not retained, stored after confirm, privacy link |
| §1 | Image/PDF upload — before button | Full Privacy & Data Use: sensitive info, AI extraction, review required, data minimization |
| §3 | Image/PDF upload — dedicated block | AI-assisted extraction: AI service for data extraction only, always verify values, "Learn how your data is handled" → /privacy |
| §4 | Image/PDF upload — dedicated block | File retention: file discarded after extraction, only confirmed data stored |
| §5 | Image/PDF upload — dedicated block | PII minimization: account numbers, addresses, tax IDs may be in statements; upload minimum necessary |
| §6 | Adjacent to Upload/Extract button (both pages) | Consent notice: "By continuing, you acknowledge that the file will be processed as described above" |
| §7 | CSV/XLSX only | Lighter disclosure, no AI mention (AI not used for spreadsheets) |
| §8 | Preview step (both pages) | "Review carefully before importing. AI-extracted fields may be inaccurate." |
| §9 | Above Confirm button (both pages) | Confirm acknowledgement + research disclaimer: not investment advice, no buy/sell/hold |
| §10 | All upload pages | Privacy Policy link → /privacy (never to /admin or ops manual) |

### Language Compliance

- Research disclaimer: "does not constitute investment advice or a recommendation to buy, sell, hold, or rebalance any security"
- No guarantee of accuracy: "Automated extraction may contain errors" / "AI-extracted fields may be inaccurate"
- No admin details exposed to users

### Tests

| File | Count |
|------|-------|
| `portfolio-privacy-disclosures.test.ts` | **48 new** |

---

## Sprint 2.4.1 — Screenshot & PDF Portfolio Intake

**Date:** 2026-08-08
**Type:** New feature — portfolio intake from images and PDF brokerage statements.

### Objective

Enable authenticated users to import portfolio holdings from:
- **A. Screenshot / Image** — PNG, JPG, JPEG, WEBP (max 10 MB)
- **B. PDF Brokerage Statement** — application/pdf (max 15 MB, max 50 pages)

All extracted holdings flow through the **same canonical `normalizePortfolioPositions()` pipeline** as CSV, XLSX, and manual entry. No separate business rules.

### Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Image extraction | GPT-4o vision | Base64 buffer → structured JSON → normalization |
| PDF extraction | `pdf-parse` (text) → GPT-4o | Text extracted first; AI parses the text into JSON |
| Normalization | `normalizePortfolioPositions()` | Unchanged; `"image"` and `"pdf"` added as valid sourceTypes |
| File handling | multer memoryStorage | Never written to disk |
| Preview store | Existing in-memory UUID/TTL store | Unchanged; TTL=30min, single-use, user-bound |
| Confirm | `POST /api/portfolio/import/confirm` | Unchanged; reused as-is |

### Schema Changes

| Object | Change | Type |
|--------|--------|------|
| `portfolioSourceTypeEnum` | Added `"image"`, `"pdf"` | Additive only — no destructive change |
| `PortfolioSourceType` (TypeScript) | Extended with `"image" \| "pdf"` | Type-only |

**Migration:** `drizzle-kit push` on next startup adds the two enum values via `ALTER TYPE ... ADD VALUE`. Fully idempotent; no data loss risk.

### New Service: `server/services/portfolio-document-extractor.ts`

| Export | Purpose |
|--------|---------|
| `extractFromImage(buffer, mime)` | GPT-4o vision → candidate rows → `normalizePortfolioPositions("image")` |
| `extractFromPdf(buffer)` | `pdf-parse` text → GPT-4o text → `normalizePortfolioPositions("pdf")` |
| `annotateWithConfidence(normalized, aiPositions)` | Attaches confidence + marketValue for preview UI (not persisted) |
| `classifyConfidence(0–1)` | `≥0.8 → high`, `0.5–0.79 → medium`, `<0.5 → low` |
| `redactSensitiveText(text)` | Redacts account#, SSN, email, IP before any logging |

### Routes Added

| Method | Path | Auth | Limit | Purpose |
|--------|------|------|-------|---------|
| POST | `/api/portfolio/import/image` | ✅ Required | 10 MB | Image extraction preview |
| POST | `/api/portfolio/import/pdf` | ✅ Required | 15 MB | PDF extraction preview |
| POST | `/api/portfolio/import/confirm` | ✅ Required | — | **Reused unchanged** |

### Client Changes

| File | Change |
|------|--------|
| `client/src/pages/portfolio.tsx` | Activated the two coming-soon cards as real buttons navigating to `/portfolio/import/document?type=image` and `?type=pdf` |
| `client/src/pages/portfolio-import-document.tsx` | **NEW** — 3-step flow: Upload → Review → Complete. Handles both `?type=image` and `?type=pdf`. Confidence badges, extraction summary, position editing, portfolio targeting. |
| `client/src/App.tsx` | Added `/portfolio/import/document` route |

### Privacy / Security

| Rule | Implementation |
|------|--------------|
| No disk writes | multer memoryStorage; buffer discarded after extraction |
| No raw content logged | Only telemetry counters (rowsDetected, processingDurationMs, resultStatus) |
| PII redaction | `redactSensitiveText()` strips account#/SSN/email/IP before any log statement |
| User isolation | Same preview store: userId check + single-use + TTL expiry |
| No raw file stored | Original file buffer cleared (`Buffer.alloc(0)`) after extraction |

### Tests Added

| File | Count |
|------|-------|
| `server/routes/__tests__/portfolio-document-intake.test.ts` | **74 new tests** |

Updated stale tests:
- `portfolio-ux-sprint240a.test.ts` — 7 coming-soon assertions updated to reflect activated buttons (Sprint 2.4.1 activation)
- `portfolio.test.ts` — schema enum test updated to include `"image"` and `"pdf"`

### Operations Manual Updated

- `docs/operations/17-sprint-change-log.md` ← this entry
- `docs/operations/16-api-and-uat-reference.md` ← image/PDF workflow + API reference
- `docs/operations/12-security-and-devsecops.md` ← document intake privacy section
- `docs/operations/11-troubleshooting-runbook.md` ← extraction failure runbook entries

### Known Limitations

1. **Scanned PDFs** (image-only, no embedded text) are not supported. pdf-parse extracts only embedded text; a scanned PDF will return "no holdings detected". Users should use the screenshot import path instead.
2. **AI extraction accuracy** varies by screenshot quality and PDF layout. Always review before confirming.
3. **Confidence is advisory** — it reflects AI self-reported certainty, not validation against a security master.
4. **GPT-4o dependency** — extraction unavailable if `OPENAI_API_KEY` is not set.

### Roadmap Alignment

This sprint implements ONLY what was specified. The following future items were **NOT** pulled forward:
- 2.4.2 Broker Synchronization
- 2.4.3 Portfolio History / Change Intelligence
- Portfolio Intelligence Engine
- Portfolio scoring, recommendations, rebalancing, goal planning, tax lots, options intelligence

---

## Sprint 2.4.0A — Portfolio UX Polish

**Date:** 2026-08-08
**Type:** UI/UX refinement only — no backend changes, no schema changes, no API changes.

### Objective

Polish the Portfolio onboarding experience introduced in Sprint 2.4.0. All backend services, APIs, database schema, import engine, normalization engine, and security model are **unchanged**.

### Files Changed

| File | Change |
|------|--------|
| `client/src/pages/portfolio.tsx` | Full onboarding redesign; button reorder; trust banner; supported-imports card; broker card; "What happens" card; empty-state upgrade; intelligence placeholder cards; tooltips on column headers and form fields; ARIA labels; breadcrumbs; mobile scrollable tables |
| `client/src/pages/portfolio-import.tsx` | File safety info block below drop zone; preview summary card (7 fields); tooltips on Avg Cost / Cost Basis columns; keyboard support for drop zone (Enter + Space); ARIA labels; step progress indicator; breadcrumbs |
| `server/routes/__tests__/portfolio-ux-sprint240a.test.ts` | 124 new pure structural tests covering all 14 spec sections |
| `docs/operations/17-sprint-change-log.md` | This entry |
| `docs/operations/16-api-and-uat-reference.md` | Sprint 2.4.0A UI walkthrough section |

### UI Changes by Section

| § | Feature | Detail |
|---|---------|--------|
| 1 | Landing page title | "Import Your Investment Portfolio" + VCP Trader AI subtitle |
| 1 | Trust banner | 4 bullets: No broker required · Import in minutes · Private · Secure |
| 2 | Button order | PRIMARY Upload Portfolio → SECONDARY Connect Broker → TERTIARY Enter Manually |
| 2 | Coming-soon cards | Screenshot Import + PDF Statement Import — disabled, informational only, no routes |
| 3 | Supported imports | CSV, Excel, Fidelity, Schwab, Robinhood, IBKR, TradeStation, Tradier |
| 4 | Broker card | Available Today: Tradier/TradeStation · Coming Soon: Schwab/IBKR/Fidelity/Robinhood |
| 5 | What happens card | 8 feature tiles — Research/Analysis/Opportunities/Intelligence language only |
| 6 | Import page safety | File safety bullets below drop zone; CSV/Excel badges |
| 7 | Preview summary | 7-field summary card: Holdings/Unique/Duplicates/MissingCost/CostBasis/EstMV |
| 8 | Empty state | "No Holdings Yet" + Import Spreadsheet / Connect Broker / Enter Manually |
| 9 | Intelligence placeholders | 7 Upcoming cards: Health/AI Research/Sector/Institutional/Technical/Risk/Opportunities |
| 10 | Breadcrumbs | Home → Portfolio Overview → [name] on portfolio page; Home → Portfolio → Portfolio Import on import page |
| 11 | Tooltips | Avg Cost, Cost Basis, Market Value, G/L, Portfolio Source — all wired with HelpCircle triggers |
| 12 | Accessibility | role=button+tabIndex on drop zone; Enter+Space keyboard; ARIA labels on all actions; role=progressbar; role=alert; aria-live; sr-only for hidden column headers |
| 13 | Mobile | overflow-x-auto + min-w on both tables; responsive grid cols; sm: breakpoints throughout |
| 14 | No new APIs | Zero new endpoints; zero new packages; all existing endpoints unchanged |

### Language Compliance

- Never: "Recommendation", "Recommended Trade", "Buy", "Sell"
- Always: "Research", "Analysis", "Opportunities", "Intelligence"
- Verified by tests §5.

### Architecture Impact

None. This sprint is pure UI polish. Zero backend, schema, or API modifications.

### Tests

| Metric | Value |
|--------|-------|
| New tests | 124 (portfolio-ux-sprint240a.test.ts) |
| Total suite | 5,235 passing |
| Failures | 0 |

### Operations Manual Updated

- `docs/operations/17-sprint-change-log.md` ← this entry
- `docs/operations/16-api-and-uat-reference.md` ← UAT walkthrough added

---

## Production Deployment Fix — Railway npm ci / tsx Missing

**Date:** 2026-08-08

### Problem

Railway/Nixpacks builds failed with two compounding errors:
1. `npm ci` → 403 Forbidden from Replit's security firewall, blocking `protobufjs@8.0.0` (Critical CVE)
2. `npm run build` → `tsx: not found` (exit 127)

Root causes:
- `package-lock.json` entries for Sprint 2.4.0 packages (`multer`, `xlsx`, `@types/multer`) resolved to `http://package-firewall.replit.local/npm/...` — unreachable from Railway
- Stale `protobufjs@8.0.0` in lockfile root (not in `package.json`), blocked by CVE policy
- `tsx` was in `devDependencies` but required at production startup by `npx tsx script/migrate.ts`

### Changes

**`package.json`**
- Moved `tsx` from `devDependencies` → `dependencies` (required at production startup)

**`package-lock.json`**
- Rewrote all 19 `http://package-firewall.replit.local/npm/` resolved URLs → `https://registry.npmjs.org/`
- Upgraded `protobufjs` entry from `8.0.0` → `8.7.2` (no CVE; updated `resolved` + `integrity`)
- Removed stale `protobufjs: ^8.0.0` from root `packages[""].dependencies` (not in `package.json`)
- Removed `"dev": true` from `node_modules/tsx` entry (now a production dependency)

### Validation

| Check | Result |
|-------|--------|
| `npm ci` (clean) | ✅ Pass |
| `npm run build` | ✅ Pass (`built in 12.86s`) |
| `npx tsx script/migrate.ts` startup viability | ✅ tsx in `node_modules/.bin/tsx` |
| 5111 tests | ✅ Pass |
| Firewall URLs remaining | 0 |

### Security Warning Note

Railway/Nixpacks reported Docker ARG/ENV warnings for sensitive variable names (`AUTH_JWT_SECRET`, `SESSION_SECRET`, etc.). These are Nixpacks-generated warnings about build-arg naming — secret **values** are not written into source or the Dockerfile. All secrets are injected at runtime via Railway environment variables. No secrets are in source. This is a cosmetic Nixpacks warning; no code change required.

### Operations Manual Updated

- `docs/operations/11-troubleshooting-runbook.md` ← "Railway build: tsx not found after npm ci" incident added
- `docs/operations/17-sprint-change-log.md` ← this entry

