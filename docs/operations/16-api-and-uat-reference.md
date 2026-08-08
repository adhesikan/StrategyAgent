# 16 — API & UAT Reference

**Production domain:** `https://vcptrader.com`

---

## ⚠️ Important: POST Endpoints Cannot Be Tested in Chrome Address Bar

Typing a URL into Chrome always sends a GET request. Therefore:

```
GET /api/admin/intelligence/rebuild
→ 404 (correct — the route only accepts POST)
```

**Correct invocation:**
- Use the button on `/admin/platform-health`
- Use `curl -X POST -b "session=..." https://vcptrader.com/api/admin/intelligence/rebuild`
- Use a REST client (Insomnia, Postman)

This applies to: `POST /api/admin/intelligence/rebuild`, `POST /api/admin/symbols/enrich`, `POST /api/admin/platform-health/refresh`, `POST /api/admin/intelligence/rebuild`.

---

## User Routes

### `GET https://vcptrader.com/`
**Purpose:** Dashboard — ranked opportunities, command bar, lifecycle summary  
**Auth:** None (public)  
**Expected status:** 200  
**Healthy data response:** Ranked opportunity cards visible  
**Healthy empty response:** "No opportunities available yet" placeholder  
**Common failures:** Blank page → check `/api/opportunities/today` returns 200  
**Runbook:** [05-scanner-and-ranking.md](05-scanner-and-ranking.md)

---

### `GET https://vcptrader.com/research`
**Purpose:** Market Research Hub — aggregates Opportunities, Changes, Intelligence, Institutional, Themes, Sectors  
**Auth:** None (public)  
**Expected status:** 200  
**Healthy data response:** All 6 module cards populated  
**Healthy empty response:** Individual modules show "Not available yet" — the hub itself loads  
**Common failures:** Permanent skeleton (not "not available yet") → skeleton guard must check `isPending` not `!data`; error card must show on `isError`  
**Runbook:** [10-monitoring-and-platform-health.md](10-monitoring-and-platform-health.md)

---

### `GET https://vcptrader.com/research/library`
**Purpose:** Research package library — saved analyses  
**Auth:** Authenticated user  
**Expected status:** 200  
**Common failures:** 401 → user not logged in

---

### `GET https://vcptrader.com/intelligence`
**Purpose:** Market Intelligence Dashboard — sector + theme snapshots, briefing  
**Auth:** None (public)  
**Expected status:** 200  
**Healthy data response:** Sector tiles, theme tiles, regime badge populated  
**Healthy empty response:** "Intelligence data not yet available" — generated after first scan + enrichment  
**Common failures:** Empty → run symbol enrichment + rebuild; see [08-sector-theme-intelligence.md](08-sector-theme-intelligence.md)

---

### `GET https://vcptrader.com/intelligence/themes/:themeId`
**Purpose:** Theme detail — ranked symbols in that theme  
**Auth:** None (public)  
**Expected status:** 200 if theme exists, 404 if unknown themeId  
**Common failures:** Theme not found → themeId must match registry slug

---

### `GET https://vcptrader.com/intelligence/sectors/:sector`
**Purpose:** Sector detail — ranked symbols in that sector  
**Auth:** None (public)  
**Expected status:** 200  
**Common failures:** Empty → no symbols classified in that sector

---

### `GET https://vcptrader.com/opportunities/:symbol`
**Purpose:** Opportunity Research Workspace — 5-tab workspace for a specific symbol  
**Auth:** None (public)  
**Expected status:** 200  
**Common failures:** Symbol not in ranking → workspace shows limited data state (not error)  
**Runbook:** [research-package-page.md in memory]

---

### `GET https://vcptrader.com/institutional/funds`
**Purpose:** Institutional Fund Explorer — all managers with 13F filings  
**Auth:** None (public)  
**Expected status:** 200  
**Healthy data response:** Manager cards with fund names, AUM, top holdings  
**Healthy empty response:** "No institutional data yet" — requires 13F ingestion  
**Important:** Values display in correct USD (not ×1000). If values look 1000× too large, the VALUE unit bug has re-appeared.  
**Runbook:** [06-institutional-13f-pipeline.md](06-institutional-13f-pipeline.md), [14-disaster-recovery.md](14-disaster-recovery.md)

---

### `GET https://vcptrader.com/institutional/funds/:managerId`
**Purpose:** Fund detail — positions for a specific manager  
**Auth:** None (public)  
**Expected status:** 200; 404 if managerId (CIK) not found  
**Note:** managerId = SEC CIK number

---

## Admin Routes

### `GET https://vcptrader.com/admin/platform-health`
**Purpose:** System health dashboard — 11 health cards + admin operations  
**Auth:** Admin only  
**Expected status:** 200 (redirect to login if unauthenticated)  
**Common failures:** 403 → not admin role  
**See:** [10-monitoring-and-platform-health.md](10-monitoring-and-platform-health.md)

---

### `GET https://vcptrader.com/admin/operations-manual`
**Purpose:** This operations manual — searchable admin-only documentation  
**Auth:** Admin only  
**Expected status:** 200  
**Security:** Must never be accessible at a public `/docs` path  
**Runbook:** This document

---

### `GET https://vcptrader.com/api/admin/intelligence/diagnostics`
**Purpose:** Raw JSON intelligence diagnostics — ranking state, snapshot counts, classification coverage  
**Auth:** Admin only  
**Expected status:** 200  
**Response shape:**
```json
{
  "ranking": { "exists": true, "generatedAt": "...", "rankedSymbolCount": 5 },
  "sectorSnapshots": { "tableExists": true, "rowCount": 8, "latestGeneratedAt": "..." },
  "themeSnapshots": { "tableExists": true, "rowCount": 12, "latestGeneratedAt": "..." },
  "institutionalSignals": { "rowCount": 0 },
  "classificationCoverage": { "total": 20, "withSector": 5, "pct": 25 },
  "precomputation": { "lastAttemptAt": "...", "lastSuccessAt": "...", "lastErrorMessage": null },
  "briefing": { "canBuild": true, "failureStage": null }
}
```
**Common failures:** `sectorSnapshots.rowCount == 0` with `themeSnapshots.rowCount > 0` → sector classification missing; run enrichment + rebuild

---

## Admin Action Endpoints (POST only)

### `POST /api/admin/intelligence/rebuild`
**Purpose:** Rebuild sector + theme snapshots from latest in-memory ranking  
**Auth:** Admin only  
**Idempotent:** Yes  
**Does NOT re-run scanner**  
**Prerequisites:** A completed ranking must exist (dashboard shows opportunities)  
**Response:** `{ ok: true, sectorCount: N, themeCount: M }`  
**Failure:** 409 if rebuild already running or no ranking available  
**Invocation:** Platform Health page → "Rebuild Intelligence" button

---

### `POST /api/admin/symbols/enrich`
**Purpose:** Populate `market_data_symbols.sector` + `symbols.sector` via Twelve Data `/profile`  
**Auth:** Admin only  
**Idempotent:** Yes (skips already-classified)  
**Cost:** 1 Twelve Data credit per symbol enriched  
**Invocation:** Platform Health page → "Run Enrichment" button  
**Follow-up:** After enrichment completes, run `POST /api/admin/intelligence/rebuild`

---

## API Smoke Tests

Run these after every production deployment. All require the server to be running.

### `GET /api/intelligence/briefing`
**Purpose:** Summary used by dashboard command bar + research hub  
**Healthy data:** `{ "hasData": true, "regime": "...", "leadingThemes": [...], "leadingSectors": [...] }`  
**Healthy empty:** `{ "hasData": false }` — generated after first scan  
**Infrastructure failure:** HTTP 500 → check server logs for `intelligence_briefing_failed`  
**Runbook:** [08-sector-theme-intelligence.md](08-sector-theme-intelligence.md), [11-troubleshooting-runbook.md](11-troubleshooting-runbook.md)

---

### `GET /api/intelligence/themes`
**Healthy data:** `{ "count": N, "themes": [...] }` where `count > 0`  
**Healthy empty:** `{ "count": 0, "themes": [] }` — before first scan  
**Common failures:** count=0 after ranking exists → theme precomputation failed (check `precomputation.lastErrorMessage` in diagnostics)

---

### `GET /api/intelligence/sectors`
**Healthy data:** `{ "count": N, "sectors": [...] }` where `count > 0`  
**Healthy empty:** `{ "count": 0 }` — before enrichment  
**Common failures:** count=0 while theme count > 0 → sector classification missing; run enrichment  
**Runbook:** [08-sector-theme-intelligence.md](08-sector-theme-intelligence.md)

---

### `GET /api/opportunities/today`
**Healthy data:** `{ "count": N, "topGrowth": [...], "generatedAt": "..." }` where `count > 0`  
**Healthy empty:** `{ "count": 0 }` or `null` — before first scan  
**Common failures:** Always empty → MCP not configured; check `MCP_ENABLED=true`

---

### `GET /api/opportunities/changes/explained`
**Healthy data:** Array of change objects with `direction`, `symbol`, `explanation`  
**Healthy empty:** Empty array — before second scan cycle  
**Common failures:** 404 → route not registered; 500 → ranking error

---

### `GET /api/institutional/funds`
**Healthy data:** Array of fund managers with positions  
**Healthy empty:** `{ "funds": [], "count": 0 }` — before 13F ingestion  
**Common failures:** Values 1000× too large → VALUE unit bug; `reported_value` must be USD not thousands  
**Runbook:** [06-institutional-13f-pipeline.md](06-institutional-13f-pipeline.md)

---

## Release Smoke Test Sequence

Use after every production deploy. Takes ~2 minutes.

```
1. Navigate to https://vcptrader.com/           → no 500, no crash, no blank page
2. Navigate to https://vcptrader.com/research    → no 500, no permanent skeleton
3. Navigate to https://vcptrader.com/intelligence → no 500, at minimum "not yet available"
4. Navigate to https://vcptrader.com/opportunities/NVDA → loads workspace (may show limited data)
5. Navigate to https://vcptrader.com/institutional/funds → no 500
6. Navigate to https://vcptrader.com/research/library   → login redirect or library page

Validate for each:
  ✓ No unexpected HTTP 500
  ✓ No React crash ("Something went wrong" boundary)
  ✓ No blank white page
  ✓ No permanent skeleton (skeleton must resolve within 10s)
  ✓ Freshness labels present where applicable
  ✓ Links work (no 404 on nav items)
  ✓ 13F data shows "delayed disclosure" notice where appropriate
```

---

## Intelligence UAT Sequence

```
GET /api/admin/intelligence/diagnostics
→ inspect:
  ranking.exists          (must be true for intelligence to work)
  ranking.rankedSymbolCount
  sectorSnapshots.rowCount
  themeSnapshots.rowCount
  classificationCoverage.pct
  institutionalSignals.rowCount
  briefing.canBuild

If sectorSnapshots.rowCount == 0 AND themeSnapshots.rowCount > 0:
  → Symbol classification missing → run enrichment:
  POST /api/admin/symbols/enrich
  POST /api/admin/intelligence/rebuild

After rebuild:
GET /api/admin/intelligence/diagnostics
→ sectorSnapshots.rowCount > 0
→ themeSnapshots.rowCount > 0

GET /api/intelligence/briefing
→ hasData: true
→ regime present
→ leadingThemes array populated
→ leadingSectors array populated
```

---

## Portfolio API (Sprint 2.4.0)

> All portfolio routes require an authenticated user session.
> Portfolio data is private — no cross-user access.

### Portfolio CRUD

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/portfolio` | List user's portfolios |
| POST | `/api/portfolio` | Create portfolio; body: `{name, sourceType}` |
| PATCH | `/api/portfolio/:id` | Rename; body: `{name}` |
| DELETE | `/api/portfolio/:id` | Delete portfolio + all positions (cascade) |

### Position CRUD

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/portfolio/:id/positions` | Returns positions + `currentPrice/marketValue/gainLoss` from stored bars |
| POST | `/api/portfolio/:id/positions` | Add manual position; body: `{symbol, quantity, averageCost?}` |
| PATCH | `/api/portfolio/:id/positions/:positionId` | Edit; body: `{quantity?, averageCost?}` |
| DELETE | `/api/portfolio/:id/positions/:positionId` | Remove single position |

### Import (Preview → Confirm)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/portfolio/import/csv` | Multipart `file` field; returns `previewId + normalizedPositions` (no DB write) |
| POST | `/api/portfolio/import/xlsx` | Multipart `file` field; optional body `sheetIndex`; returns same + `sheetInfo` |
| POST | `/api/portfolio/import/confirm` | Body: `{previewId, portfolioName?, portfolioId?, editedPositions?}`; single-use |

**⚠️ POST-only warning:** `/api/portfolio/import/*` endpoints are POST only — navigating to them in Chrome sends GET and returns 404. Use curl or the `/portfolio/import` UI.

### Client Pages

| URL | Page |
|-----|------|
| `https://vcptrader.com/portfolio` | Portfolio overview — onboarding or holdings |
| `https://vcptrader.com/portfolio/import` | 3-step import wizard (upload → preview → confirm) |

### Portfolio UAT Sequence

```bash
# 1. Create portfolio manually
curl -s -b "$COOKIE" -X POST /api/portfolio \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Portfolio","sourceType":"manual"}' | jq .id

# 2. Add a position
curl -s -b "$COOKIE" -X POST /api/portfolio/$PID/positions \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","quantity":100,"averageCost":150}' | jq .id

# 3. Read enriched positions (currentPrice from stored bars)
curl -s -b "$COOKIE" /api/portfolio/$PID/positions | jq '.positions[0].currentPrice'

# 4. CSV import preview (no DB write)
curl -s -b "$COOKIE" -X POST /api/portfolio/import/csv \
  -F "file=@my_holdings.csv" | jq '{previewId, validRows, invalidRows: (.invalidRows|length)}'

# 5. Confirm import
curl -s -b "$COOKIE" -X POST /api/portfolio/import/confirm \
  -H "Content-Type: application/json" \
  -d '{"previewId":"<id from step 4>","portfolioName":"CSV Portfolio"}' | jq .importedCount
```

### File Safety Constraints

| Constraint | Value |
|-----------|-------|
| Max file size | 5 MB |
| Max rows processed | 500 |
| Allowed CSV MIME | text/csv, text/plain, application/csv |
| Allowed XLSX MIME | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| Formula cells | Stripped (cells starting with = + - @) |
| Macros | Not executed (cellFormula: false) |
| Disk writes | None (multer memoryStorage) |
| Preview TTL | 30 minutes, single-use |

---

## Sprint 2.4.0A — Portfolio UX Walkthrough

### Client Pages

| URL | Page | Description |
|-----|------|-------------|
| `/portfolio` | Portfolio Landing / Overview | Onboarding (no portfolios) or holdings detail (portfolio exists) |
| `/portfolio/import` | Portfolio Import | 3-step wizard: Upload → Review → Complete |

### User Flow — First Import

```
/portfolio  (onboarding state)
  → click "Upload Portfolio"
  → /portfolio/import  [Step 1: Upload]
      drop / click / keyboard (Enter or Space) to select file
      "Preview Import" → POST /api/portfolio/import/csv or /xlsx
  → [Step 2: Review]
      Portfolio Summary card (7 fields)
      Editable holdings table (remove rows before confirming)
      Select or name the target portfolio
      "Confirm Import" → POST /api/portfolio/import/confirm
  → [Step 3: Complete]
      "View Portfolio" → /portfolio  (portfolio detail state)
```

### User Flow — Manual Entry

```
/portfolio  (onboarding state)
  → click "Enter Holdings Manually"
  → dialog: name the portfolio → POST /api/portfolio
  → /portfolio  (portfolio detail state)
      click "Add Position" → dialog
      symbol + quantity (+ optional avg cost) → POST /api/portfolio/:id/positions
```

### Portfolio Overview State

Once at least one portfolio exists:
- Breadcrumb: Home → Portfolio Overview → [Portfolio Name]
- Holdings table: Symbol / Quantity / Avg Cost / Price / Market Value / G/L (all enriched from stored bars)
- Summary bar: Positions / Market Value / Cost Basis / Unrealized G/L
- Intelligence Placeholders section (7 cards, all "Upcoming")
- Sidebar shown when >1 portfolio

### Coming-Soon Features (UI display only — no routes, no APIs)

| Label | Status |
|-------|--------|
| Import from Screenshot | Coming soon — disabled card, no implementation |
| Import from PDF Statement | Coming soon — disabled card, no implementation |
| Schwab broker connect | Coming soon — display only |
| Interactive Brokers connect | Coming soon — display only |
| Fidelity broker connect | Coming soon — display only |
| Robinhood broker connect | Coming soon — display only |

### Intelligence Placeholder Cards

Shown in portfolio detail view when positions exist. Each card displays "Available in an upcoming release".

| Card | Future Sprint |
|------|---------------|
| Portfolio Health | TBD |
| AI Research | TBD |
| Sector Exposure | TBD |
| Institutional Activity | TBD |
| Technical Strength | TBD |
| Portfolio Risk | TBD |
| Opportunities | Task #110 (partial) |

### UAT Sequence — Sprint 2.4.0A

```bash
# 1. Onboarding title
open /portfolio  (no portfolios)
→ heading "Import Your Investment Portfolio" visible
→ trust banner (4 bullets) visible
→ buttons in order: Upload Portfolio / Connect Broker / Enter Holdings Manually
→ coming-soon cards (Screenshot, PDF) present and non-clickable

# 2. Supported imports card visible
→ CSV, Excel, Fidelity, Schwab, Robinhood, Interactive Brokers, TradeStation, Tradier

# 3. Broker card visible
→ "Available Today": Tradier, TradeStation
→ "Coming Soon": Schwab, Interactive Brokers, Fidelity, Robinhood

# 4. What happens card visible
→ 8 feature tiles: Track holdings / Portfolio performance / Sector exposure /
  Institutional ownership / Technical strength / Portfolio concentration /
  AI research / Covered call candidates

# 5. Import flow
open /portfolio/import
→ breadcrumb: Home > Portfolio > Portfolio Import
→ step indicator: Upload (active) → Review → Complete
→ drop zone: click works, keyboard Enter/Space opens file picker
→ file safety block visible (6 bullets)
→ recognized headers block visible

# 6. Preview (after upload)
→ Portfolio Summary card shows: Detected Holdings / Unique Symbols /
  Duplicate Symbols / Missing Average Cost / Missing Cost Basis /
  Estimated Cost Basis / Est. Market Value
→ tooltips on Avg Cost and Cost Basis column headers (hover to verify)
→ invalid rows displayed with row numbers and reasons
→ rows can be removed before confirming

# 7. Success state
→ "Import complete" confirmation
→ "View Portfolio" navigates to /portfolio

# 8. Portfolio overview (with holdings)
→ breadcrumb: Home > Portfolio Overview > [Portfolio Name]
→ holdings table scrolls horizontally on mobile
→ tooltips on Avg Cost / Price / Market Value / G/L column headers
→ intelligence placeholder section visible (7 Upcoming cards)
→ Portfolio Source badge has tooltip

# 9. Empty holdings state
→ "No Holdings Yet" heading
→ 3 action buttons: Import a Spreadsheet / Connect a Broker / Enter Holdings Manually

# 10. Accessibility
→ drop zone focusable via Tab, activates on Enter
→ all icon-only buttons have aria-label
→ remove buttons in preview have aria-label with symbol name
```

### Known Limitations (Sprint 2.4.0A)

- Market value in preview summary always shows "—" (not available until after import and nightly bar refresh)
- Intelligence placeholder cards are static; no computation occurs
- Screenshot and PDF import are UI stubs only — no backend capability
- Broker "Connect" navigates to `/settings?tab=broker`; only Tradier and TradeStation are functional

