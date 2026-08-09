# 20 — Research Reports & Publishing

Sprint: 2.5.5 — Research Reports & Publishing

---

## Overview

The Research Report Engine converts existing deterministic intelligence into professional, reusable research reports.

**Design rules:**
- NO rescanning. NO reranking. NO new market-data fetches.
- All data sourced from precomputed stores (opportunity ranking, sector/theme intelligence, institutional intelligence, research collections, research monitoring).
- Exports to HTML, Markdown, JSON, PDF-ready structure, PowerPoint-ready structure.
- No PDF/PPT rendering libraries. Structured output only.

**Compliance:** All reports use "Research Report", "Research Candidate", "Observed Change", "Research Summary", "Market Intelligence". Never "recommendation", "buy", "sell", "strong buy", "top pick", "target price", "price target", "guarantee".

---

## Architecture

```
User requests report (reportType)
        ↓
generateReport() — parallel fetch from precomputed stores:
  getLatestRanking()          → ranking, regime, changes
  getLatestThemeSnapshots()   → theme intelligence
  getLatestSectorSnapshots()  → sector intelligence
  getOpportunityIntelligence() → opportunity candidates
  listCollections(userId)     → research collections
  buildMyWatchChangesSection() → watch activity (optional)
        ↓
_buildContent(reportType, data)
  → executiveSummary + keyFindings + evidence + riskFactors
  → 3–9 ReportSection objects based on type
        ↓
INSERT into research_reports (PostgreSQL)
        ↓
Return ResearchReport domain object
```

---

## Database Schema

### research_reports

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR(128) PK | `rpt-{timestamp}-{random}` |
| `user_id` | VARCHAR(128) NOT NULL | Report owner |
| `title` | TEXT NOT NULL | |
| `subtitle` | TEXT | |
| `report_type` | TEXT NOT NULL | ReportType enum |
| `status` | TEXT NOT NULL | `published` \| `archived` |
| `is_pinned` | BOOLEAN | Default false |
| `generated_at` | TIMESTAMP NOT NULL | |
| `data_freshness` | TEXT | Human-readable label |
| `market_regime` | TEXT | From ranking/intel |
| `author` | TEXT | "VCP Trader AI Research Engine" |
| `version` | INTEGER | Default 1 |
| `disclaimer` | TEXT NOT NULL | RESEARCH_DISCLAIMER |
| `content` | JSONB NOT NULL | ReportContent |
| `exports` | JSONB | Cached export strings |
| `tags` | TEXT[] | |
| `summary` | TEXT | ≤300 chars for search display |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

**Indexes:** `idx_rr_user_id`, `idx_rr_status(user_id, status)`, `idx_rr_type(user_id, report_type)`, `idx_rr_pinned(user_id, is_pinned)`, `idx_rr_generated_at(user_id, generated_at)`

**Soft delete:** Reports are archived (`status='archived'`), never hard-deleted.

---

## Report Types (16)

| Value | Label |
|-------|-------|
| `morning_brief` | Morning Research Brief |
| `evening_summary` | Evening Research Summary |
| `market_changes` | Today's Market Changes |
| `weekly_market_intel` | Weekly Market Intelligence |
| `weekly_ai_infrastructure` | Weekly AI Infrastructure Intelligence |
| `weekly_semiconductor` | Weekly Semiconductor Intelligence |
| `weekly_memory` | Weekly Memory Intelligence |
| `weekly_cloud` | Weekly Cloud Intelligence |
| `weekly_cybersecurity` | Weekly Cybersecurity Intelligence |
| `weekly_institutional` | Weekly Institutional Activity |
| `weekly_sector_leadership` | Weekly Sector Leadership |
| `weekly_theme_leadership` | Weekly Theme Leadership |
| `collection_summary` | Research Collection Summary |
| `research_monitoring_summary` | Research Monitoring Summary |
| `opportunity_intel_summary` | Opportunity Intelligence Summary |
| `workspace_summary` | Research Workspace Summary |

---

## Template Section Types (11)

| Value | Title | Used In |
|-------|-------|---------|
| `executive_summary` | Executive Summary | All reports |
| `market_overview` | Market Overview | morning_brief, evening_summary, market_changes, weekly_market_intel, opportunity_intel_summary |
| `sector_summary` | Sector Research Summary | morning_brief, weekly_market_intel, weekly_sector_leadership, opportunity_intel_summary, weekly_institutional |
| `theme_summary` | Investment Theme Summary | morning_brief, weekly_market_intel, weekly_theme_leadership, opportunity_intel_summary, weekly_ai_infrastructure, weekly_semiconductor, weekly_memory, weekly_cloud, weekly_cybersecurity |
| `institutional_summary` | Institutional Research Summary | weekly_institutional, opportunity_intel_summary, weekly_market_intel |
| `research_candidate_summary` | Research Candidate Summary | Most reports except collection_summary, research_monitoring_summary, workspace_summary |
| `research_monitoring_summary` | Research Monitoring Summary | research_monitoring_summary, morning_brief, evening_summary |
| `collection_summary` | Research Collection Summary | collection_summary, morning_brief, opportunity_intel_summary |
| `risk_summary` | Risk Factors | All reports |
| `methodology` | Research Methodology | All reports |
| `appendix` | Data Sources & Freshness | All reports |

---

## Export Formats (5)

| Format | Output | MIME |
|--------|--------|------|
| `html` | Complete HTML document | `text/html` |
| `markdown` | Markdown document with headings | `text/markdown` |
| `json` | Raw `ReportContent` JSON | `application/json` |
| `pdf_ready` | Structured JSON with `pages[]` + page-break hints | `application/json` |
| `ppt_ready` | Structured JSON with `slides[]` | `application/json` |

**No PDF rendering libraries.** PDF-ready and PPT-ready produce structured JSON that a downstream tool (e.g. python-pptx, wkhtmltopdf) can consume.

**PDF-ready structure:**
```json
{
  "format": "pdf_ready",
  "version": "1.0",
  "metadata": { "title", "subtitle", "author", "generatedAt", "marketRegime" },
  "pages": [
    { "pageType": "cover", "content": { ... } },
    { "pageType": "summary", "content": { "heading", "body", "keyFindings" } },
    { "pageType": "section", "pageNumber": 3, "content": { "heading", "body", "bullets", "sectionType" } },
    { "pageType": "evidence", "content": { "heading", "items": [...] } },
    { "pageType": "risk", "content": { "heading", "items": [...] } },
    { "pageType": "disclaimer", "content": { "body" } }
  ],
  "pageBreakHints": [3, 4, 5, ...],
  "totalPages": 8
}
```

**PPT-ready structure:**
```json
{
  "format": "ppt_ready",
  "version": "1.0",
  "slides": [
    { "slideType": "title",   "content": { "title", "subtitle", "date" } },
    { "slideType": "agenda",  "content": { "title", "bullets": ["Section 1", ...] } },
    { "slideType": "summary", "content": { "title", "body", "bullets": [...max 6] } },
    { "slideType": "section", "content": { "title", "body", "bullets": [...max 8], "data": {} } },
    { "slideType": "risk",    "content": { "title", "bullets": [...] } },
    { "slideType": "disclaimer", "content": { "title", "body", "fontSizePt": 8 } }
  ],
  "totalSlides": 7
}
```

---

## ReportContent Structure

```typescript
interface ReportContent {
  executiveSummary:   string;           // 1–3 paragraph summary
  keyFindings:        string[];         // 3–8 bullet-point findings
  supportingEvidence: EvidenceItem[];   // Data sources with labels/values
  riskFactors:        string[];         // 2–6 risk statements
  methodology:        string;           // Paragraph describing generation method
  dataFreshness:      DataFreshnessInfo; // ISO timestamps per data source
  disclaimer:         string;           // RESEARCH_DISCLAIMER
  sections:           ReportSection[];  // 3–9 typed sections, sorted by sortOrder
}
```

---

## Service Functions

All in `server/services/research-report-service.ts`:

| Function | Description |
|----------|-------------|
| `generateReport(userId, reportType, options?)` | Fetch precomputed data in parallel, build content, INSERT into DB |
| `listReports(userId, options?)` | Search/filter/sort reports (excludes archived by default) |
| `getReport(reportId, userId)` | Single report lookup |
| `updateReport(reportId, userId, updates)` | Pin/rename/archive |
| `deleteReport(reportId, userId)` | Soft-delete: sets status=archived |
| `exportReport(reportId, userId, format)` | HTML / Markdown / JSON / PDF-ready / PPT-ready |
| `buildLatestReportSection(userId)` | Build command-center `LatestReportSection` |
| `getResearchReportsHealth()` | Platform health stats |
| `ensureResearchReportsTables()` | CREATE TABLE IF NOT EXISTS on startup |
| `RESEARCH_DISCLAIMER` | Exported constant — shared compliance disclaimer |

---

## RESEARCH_DISCLAIMER

```
This research report summarises deterministic intelligence generated from market data and
predefined qualification rules. It is provided for informational purposes only and does not
constitute personalised investment advice, a recommendation to buy or sell any security,
or a guarantee of future performance. Past research patterns do not predict future results.
All scores and observations reflect data available at report generation time and may not
reflect subsequent market developments.
```

**Every generated report stores this disclaimer verbatim in the `disclaimer` column and in `content.disclaimer`.**

---

## API Routes

All routes require authentication (`isAuthenticated`). Registered in `server/routes/research-reports.ts`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/research-reports` | Generate new report |
| GET | `/api/research-reports` | List / search reports |
| GET | `/api/research-reports/health` | Platform health stats |
| GET | `/api/research-reports/:id` | Single report |
| PATCH | `/api/research-reports/:id` | Update (pin / rename / archive) |
| DELETE | `/api/research-reports/:id` | Archive (soft delete) |
| GET | `/api/research-reports/:id/export` | Export in format |

### POST /api/research-reports — Body

```json
{
  "reportType": "morning_brief",
  "title": "Custom Morning Brief",      // optional, max 120 chars
  "subtitle": "For internal review",    // optional, max 200 chars
  "tags": ["weekly", "review"],         // optional, max 10 tags
  "themeId": "ai-infrastructure",       // optional — theme scoping
  "sector": "Technology",               // optional — sector scoping
  "collectionId": "col-uuid"            // optional — collection scoping
}
```

**Returns 201** with `{ report: ResearchReport }`.

### GET /api/research-reports — Query Params

| Param | Type | Notes |
|-------|------|-------|
| `reportType` | string (comma-separated) | Filter by type(s) |
| `status` | `published` \| `archived` | Default: published |
| `isPinned` | `true` \| `false` | Filter by pin status |
| `marketRegime` | string | Filter by regime |
| `keyword` | string | Search title + summary |
| `symbol` | string | Filter by symbol (stored in content tags) |
| `theme` | string | Filter by theme |
| `sector` | string | Filter by sector |
| `fromDate` | ISO date | From date filter |
| `toDate` | ISO date | To date filter |
| `sortBy` | `generatedAt` \| `title` \| `reportType` | Default: generatedAt |
| `sortDir` | `asc` \| `desc` | Default: desc |
| `limit` | integer | Max 100, default 50 |
| `offset` | integer | Pagination offset |

**Response:** `{ reports: ResearchReport[], count: number, limit: number, offset: number }`

**Pinned reports always sorted first** regardless of `sortBy`.

### GET /api/research-reports/:id/export — Query Params

| Param | Notes |
|-------|-------|
| `format` | `html` \| `markdown` \| `json` \| `pdf_ready` \| `ppt_ready` |

HTML and Markdown return the raw string with appropriate Content-Type. JSON, pdf_ready, ppt_ready return `{ format, content }`.

---

## Client Page: /research-reports

`client/src/pages/research-reports.tsx`

**Report Library view:**
- Header with report count + "Generate Report" button
- Search bar + type filter dropdown + "Pinned only" toggle
- Report cards grid (pinned first) — title, type badge, summary excerpt, meta strip, export menu, pin/archive buttons
- Empty state with "Generate Your First Report" CTA

**Report Viewer mode** (when a card is clicked):
- Back button
- Title + subtitle + meta strip
- Key Findings panel (blue left-border)
- Collapsible section cards (first 2 open by default)
- Supporting Evidence grid
- Related research quick links (Command Center, Research Workspace, Collections, Research Monitor, Opportunity Intel)
- Glossary link
- Compliance disclaimer

**Generate Report modal:**
- Report Type dropdown (all 16 types)
- Custom Title field (optional)
- Subtitle field (optional)
- Compliance note
- "Generate Report" CTA

---

## Command Center Integration

`latestReport: LatestReportSection` added to `CommandCenterDailySnapshot`.

Built by `buildLatestReportSection(userId)` — reads `research_reports` table and returns:
- `available: false` when user has no published reports
- `latestReport: ReportShortCard` — most recent published report
- `recentReports: ReportShortCard[]` — next 4 recent reports
- `reportsToday` — count of reports generated in last 24 hours
- `generateShortcut` / `viewAllShortcut` — `/research-reports`

Section included in command center parallel fetch and degrades independently.

---

## Platform Health

`researchReports` health card added to `buildPlatformHealth()`.

| Condition | Status |
|-----------|--------|
| storageHealth=unknown (DB error) | UNKNOWN |
| storageHealth=degraded | DEGRADED |
| Otherwise | HEALTHY |

**Note:** HEALTHY even with 0 reports — the system is functional; no reports have been generated yet. The `action` field suggests visiting `/research-reports` when count is 0.

---

## Startup Migration

`ensureResearchReportsTables()` is called during `registerRoutes()` in `server/routes.ts`.

Uses `CREATE TABLE IF NOT EXISTS` — safe to call multiple times on an existing database.

---

## AI Summarisation Rules

AI (via Research Workspace) may generate:
- Executive Summary
- Plain-English Summary
- Institutional Summary
- Risk Summary
- Technical Summary

**AI rules (enforced by prompt):**
- AI cannot invent research candidates (no fabricated symbols)
- AI cannot change research scores
- AI cannot alter supporting evidence
- AI summarises deterministic intelligence only

---

## Commercial Tiers (Documented Only — No Code Enforcement)

| Tier | Access |
|------|--------|
| Free | Limited report types, basic library |
| Subscriber | All report types, unlimited generation, historical library |
| Professional | Advanced reports, data freshness indicators, share links |
| RIA | Client-branded reports, firm-level library |
| Enterprise | Custom templates, API publishing, white-label |

---

## Future Roadmap (Do Not Implement — Sprint 2.5.5)

| Feature | Sprint |
|---------|--------|
| Scheduled reports (daily/weekly) | 2.6+ |
| Email delivery | 2.6+ |
| Newsletter generation | 2.6+ |
| Slack delivery | 2.6+ |
| Teams delivery | 2.6+ |
| Webhook publishing | 2.6+ |
| API publishing | 2.6+ |
| Client-branded templates | RIA/Enterprise phase |
| PDF rendering (wkhtmltopdf) | 2.6+ |
| PPT rendering (python-pptx) | 2.6+ |

`ScheduledReportConfig` and `DeliveryChannel` interfaces in `shared/research-report-types.ts` are reserved for this future work.

---

## Runbook

### No reports in library

1. Verify user is authenticated: check session
2. Click "Generate Report" → choose a type → confirm
3. POST /api/research-reports returns 201 → report appears in grid
4. Check server logs for `[research-reports] Generated` log line

### Report generation is slow

Report generation fetches all precomputed stores in parallel. If slow:
1. Check if all precomputed stores have data: `GET /api/admin/platform-health`
2. If ranking/theme/sector shows UNKNOWN → precomputed data not yet available; the report will still generate with available data
3. Generation time logged as `Generated "..." in Xms`

### Table missing after deployment

Run startup migration manually or restart the server — `ensureResearchReportsTables()` runs on every startup. Alternatively run the CREATE TABLE block from the service file directly.

### Platform Health shows UNKNOWN

DB connection failed for the reports health check. Check `database` health card first.

### Export returns 404

The report ID does not belong to the requesting user — each report is user-scoped. Confirm the reportId matches the authenticated user.

---

## Admin Search Terms

- research reports
- report engine
- report generation
- morning brief
- weekly report
- export report
- pdf ready
- ppt ready
- research_reports
- ReportType
- RESEARCH_DISCLAIMER
- report library
- report viewer
- command center latest report
- buildLatestReportSection
