# 17 — Sprint Change Log

**Format:** Most-recent sprint first. Each entry captures purpose, key services, routes, tables, jobs, env/config impact, UAT additions, troubleshooting additions, and known limitations.

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
