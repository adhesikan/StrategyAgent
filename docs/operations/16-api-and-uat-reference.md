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
- Broker "Connect" navigates to `/settings?tab=broker`; only Tradier and TradeStation are functional
- Screenshot and PDF import (Sprint 2.4.1) are now functional — see section below

---

## Sprint 2.4.1 — Screenshot & PDF Portfolio Intake

### New Routes

#### `POST /api/portfolio/import/image`

**Auth:** Required (session cookie)  
**Content-Type:** `multipart/form-data` — field name: `file`  
**Accepted:** `image/png`, `image/jpg`, `image/jpeg`, `image/webp`  
**Max size:** 10 MB  

**Success response (200):**
```json
{
  "previewId": "uuid",
  "parsedRows": 5,
  "validRows": 4,
  "invalidRows": [],
  "warnings": [],
  "normalizedPositions": [
    { "symbol": "NVDA", "quantity": 100, "averageCost": 132.50, "costBasis": 13250, "currency": "USD", "warnings": [], "confidence": "high", "marketValue": 18000 }
  ],
  "metadata": {
    "detectedInstitution": "Fidelity",
    "detectedPeriod": null,
    "extractionWarnings": [],
    "lowConfidenceCount": 0
  },
  "telemetry": {
    "sourceType": "image",
    "processingDurationMs": 3200,
    "rowsDetected": 5,
    "rowsValid": 4,
    "rowsInvalid": 1,
    "lowConfidenceCount": 0,
    "resultStatus": "success"
  },
  "expiresInSeconds": 1800
}
```

**Error responses:**
| Code | Meaning |
|------|---------|
| 400 | No file / empty file / unsupported MIME |
| 422 | No holdings detected |
| 503 | AI service unavailable (OPENAI_API_KEY missing or quota) |
| 502 | AI service call failed (timeout) |
| 500 | Internal error |

---

#### `POST /api/portfolio/import/pdf`

**Auth:** Required  
**Content-Type:** `multipart/form-data` — field name: `file`  
**Accepted:** `application/pdf`  
**Max size:** 15 MB · Max pages: 50  

**Success response (200):** Same shape as image endpoint with `"sourceType": "pdf"`.

**Additional 422 causes:**
- PDF is a scanned image (no embedded text → less than 100 chars extracted)
- Corrupt or encrypted PDF

---

#### `POST /api/portfolio/import/confirm`

**Unchanged from Sprint 2.4.0.** Reused for image and PDF imports.

```json
{
  "previewId": "uuid",
  "portfolioName": "My Fidelity Portfolio",
  "editedPositions": [
    { "symbol": "NVDA", "quantity": 100, "averageCost": 132.50 }
  ]
}
```

---

### Client Pages

| Path | Purpose |
|------|---------|
| `/portfolio/import/document?type=image` | Screenshot import — 3-step: Upload → Review → Complete |
| `/portfolio/import/document?type=pdf` | PDF statement import — same 3-step flow |

---

### UAT Sequence — Screenshot Import

```
1. Navigate to /portfolio
2. Click "Upload Screenshot" (btn-screenshot)
3. Confirm navigation to /portfolio/import/document?type=image
4. Select a PNG/JPG/WEBP screenshot (max 10 MB)
5. Click "Extract Holdings"
6. Observe "Analyzing screenshot with AI…" loading state
7. Preview screen: Extraction Summary card shows detected institution if any
8. Positions table shows Symbol / Quantity / Avg Cost / Cost Basis / Confidence
9. "Needs review" badge visible on low-confidence fields
10. Remove a row → row disappears from table
11. Enter new portfolio name → confirm
12. Success screen: "Import complete. Your screenshot was processed in memory and is no longer retained."
13. Navigate to /portfolio → new portfolio visible with imported holdings
```

### UAT Sequence — PDF Import

```
1. Navigate to /portfolio
2. Click "Upload PDF Statement" (btn-pdf)
3. Confirm navigation to /portfolio/import/document?type=pdf
4. Select a native PDF (not scanned) — max 15 MB, 50 pages
5. Click "Extract Holdings"
6. Observe "Extracting holdings from PDF…" loading state
7. Preview screen: shows detected institution and period (if found)
8. Review all positions — verify quantities and costs match the PDF
9. Edit any "Needs review" fields manually
10. Confirm import
11. Success screen confirms file not retained
```

### UAT Sequence — Scanned PDF (Expected Failure)

```
1. Upload a scanned (image-only) PDF
2. Expect HTTP 422 with message: "No holdings detected in the PDF. The document may not contain a readable holdings table, or it may be a scanned PDF without embedded text."
3. User directed to use Screenshot Import instead
```

### Privacy Verification

- After import confirmation, no uploaded file persists anywhere in the system
- Network tab should show file upload only to `/api/portfolio/import/image` or `/api/portfolio/import/pdf` (not stored)
- Server logs show only: sourceType, processingDurationMs, rowsDetected, rowsValid, rowsInvalid, lowConfidenceCount, resultStatus, detectedInstitution

### Known Limitations (Sprint 2.4.1)

- Scanned PDFs (image-only, no embedded text) are not supported → use Screenshot Import instead
- AI extraction accuracy depends on screenshot quality and PDF readability
- GPT-4o must be available (`OPENAI_API_KEY` set); otherwise 503
- Confidence is AI self-reported; always review before confirming

---

## Sprint 2.5.1 — Research Collections & Watchlists

### New Routes (15)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/collections` | ✅ | List system + user collections with state |
| POST | `/api/collections` | ✅ | Create user collection |
| GET | `/api/collections/symbol/:symbol` | ✅ | Saved/followed/related collections for symbol |
| GET | `/api/collections/:id` | ✅ | Collection detail with canonical opportunities |
| PATCH | `/api/collections/:id` | ✅ | Rename / archive user collection |
| DELETE | `/api/collections/:id` | ✅ | Delete user collection (cascades symbols/follows) |
| POST | `/api/collections/:id/follow` | ✅ | Follow a collection |
| DELETE | `/api/collections/:id/follow` | ✅ | Unfollow |
| POST | `/api/collections/:id/favorite` | ✅ | Favorite |
| DELETE | `/api/collections/:id/favorite` | ✅ | Unfavorite |
| POST | `/api/collections/:id/pin` | ✅ | Pin |
| DELETE | `/api/collections/:id/pin` | ✅ | Unpin |
| POST | `/api/collections/:id/duplicate` | ✅ | Duplicate (creates new user collection) |
| POST | `/api/collections/:id/symbols` | ✅ | Add symbol to user collection |
| DELETE | `/api/collections/:id/symbols/:symbol` | ✅ | Remove symbol from user collection |

---

### GET /api/collections

**Query params (all optional):**

| Param | Type | Notes |
|-------|------|-------|
| `type` | `system` \| `user` | Filter by collection type |
| `followedOnly` | `true` \| `false` | Only followed collections |
| `favoriteOnly` | `true` \| `false` | Only favorited collections |
| `pinnedOnly` | `true` \| `false` | Only pinned collections |
| `includeArchived` | `true` | Include archived (excluded by default) |
| `search` | string | Text search across name/description |
| `sortBy` | `name` \| `opportunityCount` \| `followCount` \| `createdAt` \| `updatedAt` | Sort field |
| `sortDirection` | `asc` \| `desc` | Sort direction |

**Response:**
```json
{
  "collections": [
    {
      "id": "uuid",
      "name": "AI Infrastructure",
      "description": "...",
      "collectionType": "system",
      "systemKey": "ai-infrastructure",
      "opportunityCount": 8,
      "symbolCount": 0,
      "isArchived": false,
      "isFollowing": true,
      "isFavorite": false,
      "isPinned": false,
      "followCount": 42,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "count": 27
}
```

---

### GET /api/collections/:id

Returns full collection detail including canonical opportunities.

```json
{
  "collection": {
    "id": "uuid",
    "name": "My AI Stocks",
    "collectionType": "user",
    "systemKey": null,
    "opportunities": [ { ... CanonicalOpportunity ... } ],
    "symbols": ["NVDA", "AMD", "AVGO"],
    "opportunityCount": 3,
    "symbolCount": 3,
    ...
  }
}
```

System collections: `opportunities[]` is populated from Opportunity Intelligence Engine filter.  
User collections: `opportunities[]` = canonical opportunities for symbols in `symbols[]`.

---

### GET /api/collections/symbol/:symbol

Returns collection membership for a specific symbol. Used by opportunity pages to show "Saved Collections / Followed Collections / Related Collections".

```json
{
  "symbol": "NVDA",
  "savedCollections": [ { "collectionId": "...", "collectionName": "My AI Stocks", ... } ],
  "followedCollections": [ { "collectionId": "...", "collectionName": "AI Infrastructure", ... } ],
  "relatedCollections": [ { "collectionId": "...", "collectionName": "Semiconductors", ... } ],
  "allMemberships": [ ... ]
}
```

---

### POST /api/collections

Create a user collection.

**Body:** `{ "name": "My Research", "description": "Optional" }`  
**Success (201):** `{ "collection": { ... CollectionSummary ... } }`  
**Error (400):** `{ "error": "name is required" }` or `{ "error": "Collection name must be 100 characters or fewer" }`

---

### PATCH /api/collections/:id

Update name, description, or archived state. User collections only.

**Body:** `{ "name": "New Name", "isArchived": true }`  
**Success (200):** `{ "collection": { ... } }`  
**Error (404):** `{ "error": "Collection not found or not owned by user" }`

---

### DELETE /api/collections/:id

Delete a user collection. Cascades: removes all symbols, follows, favorites, pins.

**Success (200):** `{ "success": true, "message": "Collection deleted" }`

---

### POST /api/collections/:id/follow

**Response:** `{ "success": true, "following": true }`

### DELETE /api/collections/:id/follow

**Response:** `{ "success": true, "following": false }`

### POST / DELETE /api/collections/:id/favorite, /pin

Same pattern: `{ "success": true, "favorite": true/false }` or `{ "success": true, "pinned": true/false }`

---

### POST /api/collections/:id/symbols

Add a symbol to a user collection.

**Body:** `{ "symbol": "NVDA" }`  
**Response:** `{ "success": true, "symbol": "NVDA", "alreadyExists": false }`

### DELETE /api/collections/:id/symbols/:symbol

**Response:** `{ "success": true, "symbol": "NVDA" }`

---

### Platform Health — Collections Card

```json
{
  "status": "HEALTHY | DEGRADED | UNKNOWN",
  "summary": "25 system, 3 user, 12 follows",
  "details": {
    "systemCollectionCount": 25,
    "userCollectionCount": 3,
    "totalFollows": 12,
    "totalFavorites": 5,
    "totalPins": 2,
    "totalUserSymbols": 18,
    "seedingComplete": true
  }
}
```

Status rules: `DEGRADED` if seeding not complete OR system collection count < 25; `HEALTHY` otherwise.

---

### UAT Checklist — Research Collections

**System collections (first login):**
```
□ GET /api/collections → 25 system collections present
□ "AI Infrastructure" collection visible with collectionType: "system"
□ "Growth" collection visible with collectionType: "system"
□ "Market Leaders" collection visible
□ GET /api/collections?type=system → only system collections returned
□ GET /api/collections/:id for AI Infrastructure → opportunities[] populated (when scanner has run)
□ AI Infrastructure opportunities all have "AI Infrastructure" in themes[]
□ Growth collection opportunities all have opportunityType: "growth"
□ Market Leaders sorted by researchScore desc, max 20
```

**Follow / Favorite / Pin:**
```
□ POST /api/collections/:id/follow → isFollowing: true
□ DELETE /api/collections/:id/follow → isFollowing: false
□ GET /api/collections?followedOnly=true → only followed collections returned
□ POST /api/collections/:id/favorite → isFavorite: true
□ POST /api/collections/:id/pin → isPinned: true
□ GET /api/collections?pinnedOnly=true → only pinned collections
```

**User collections:**
```
□ POST /api/collections { name: "My AI Stocks" } → 201, collectionType: "user"
□ GET /api/collections → new collection appears in list
□ POST /api/collections/:id/symbols { symbol: "NVDA" } → success: true
□ GET /api/collections/:id → symbols: ["NVDA"], opportunityCount: 1 (if NVDA ranked)
□ PATCH /api/collections/:id { name: "Renamed" } → name updated
□ POST /api/collections/:id/duplicate → new collection with "(Copy)" suffix, same symbols
□ PATCH /api/collections/:id { isArchived: true } → collection archived
□ GET /api/collections (default) → archived collection excluded
□ GET /api/collections?includeArchived=true → archived included
□ DELETE /api/collections/:id → 200 success; collection gone from list
```

**Symbol membership:**
```
□ GET /api/collections/symbol/NVDA → savedCollections / followedCollections / relatedCollections
□ savedCollections shows user collections where NVDA was added
□ relatedCollections shows system collections where NVDA appears (AI Infrastructure, Semiconductors)
```

**Access control:**
```
□ Unauthenticated request → 401
□ PATCH system collection → 404 (system = no userId match)
□ DELETE system collection → 404
□ GET another user's user collection → 404
```

---

## Sprint 2.5.0 — Opportunity Intelligence Engine

### New Routes

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/intelligence/opportunities` | ✅ | Filtered & sorted canonical opportunity list |
| GET | `/api/intelligence/opportunities/meta` | ✅ | Available filter options (lightweight) |
| GET | `/api/intelligence/opportunities/:symbol` | ✅ | Single canonical opportunity by symbol |

---

### GET /api/intelligence/opportunities

Returns filtered, sorted list of `CanonicalOpportunity` objects.

**Query parameters (all optional):**

| Param | Type | Example | Notes |
|-------|------|---------|-------|
| `sector` | string (comma-sep) | `Technology,Energy` | Filter by sector |
| `industry` | string (comma-sep) | `Semiconductors` | Filter by industry |
| `theme` | string (comma-sep) | `AI Infrastructure,Cloud` | Filter by theme name |
| `opportunityType` | string (comma-sep) | `growth,income` | Filter by type |
| `riskLevel` | string (comma-sep) | `low,medium` | `low` / `medium` / `high` |
| `timeHorizon` | string (comma-sep) | `short,medium` | `short` / `medium` / `long` |
| `minResearchScore` | integer 0–100 | `70` | Minimum research score |
| `minTechnicalScore` | integer 0–100 | `65` | Minimum technical score |
| `minInstitutionalScore` | integer 0–100 | `50` | Minimum institutional score |
| `marketRegime` | string | `bull` | Filter by market regime |
| `sortBy` | string | `researchScore` | Field to sort by |
| `sortDirection` | `asc` \| `desc` | `desc` | Sort direction |

**Valid `sortBy` values:** `researchScore`, `technicalScore`, `institutionalScore`, `symbol`, `lastUpdated`, `opportunityType`

**Success (200) — snapshot available:**
```json
{
  "available": true,
  "generatedAt": "2026-08-08T12:00:00.000Z",
  "marketRegime": "bull",
  "totalCount": 24,
  "filteredCount": 8,
  "opportunities": [
    {
      "id": "NVDA-topGrowth",
      "symbol": "NVDA",
      "companyName": "NVIDIA Corporation",
      "sector": "Technology",
      "industry": "Semiconductors",
      "themes": ["AI Infrastructure", "Semiconductors"],
      "opportunityType": "growth",
      "opportunityTypeLabel": "Growth Candidate",
      "researchScore": 88,
      "technicalScore": 85,
      "fundamentalScore": 75,
      "institutionalScore": 80,
      "sentimentScore": 74,
      "confidence": "high",
      "marketRegime": "bull",
      "timeHorizon": "medium",
      "riskLevel": "low",
      "lastUpdated": "2026-08-08T12:00:00.000Z",
      "primaryEvidence": [
        { "type": "technical", "label": "Technical Signal", "detail": "VCP breakout with volume confirmation", "strength": "strong" },
        { "type": "institutional", "label": "Institutional Interest", "detail": "Strong institutional accumulation signal detected from 13F filings.", "strength": "strong" }
      ],
      "secondaryEvidence": [
        { "type": "sector", "label": "Sector Context", "detail": "Operates in the Technology sector.", "strength": "moderate" },
        { "type": "theme", "label": "Theme Membership", "detail": "Classified as a AI Infrastructure candidate.", "strength": "moderate" }
      ],
      "riskFactors": [],
      "invalidatesThesis": [],
      "_sourceCategory": "topGrowth",
      "_rank": 1
    }
  ],
  "meta": {
    "sectors": ["Energy", "Healthcare", "Technology"],
    "industries": ["Semiconductors", "Software"],
    "themes": ["AI Infrastructure", "Cloud", "Cybersecurity"],
    "opportunityTypes": ["growth", "income", "swing"],
    "riskLevels": ["low", "medium", "high"],
    "timeHorizons": ["short", "medium", "long"]
  }
}
```

**Success (200) — no snapshot yet:**
```json
{ "available": false, "message": "No opportunity snapshot is available yet. The scanner runs periodically — check back shortly.", "generatedAt": null }
```

---

### GET /api/intelligence/opportunities/meta

Lightweight endpoint for populating filter dropdowns. Returns filter options without the full opportunity list.

```json
{
  "available": true,
  "generatedAt": "2026-08-08T12:00:00.000Z",
  "totalCount": 24,
  "meta": {
    "sectors": [...],
    "industries": [...],
    "themes": [...],
    "opportunityTypes": [...],
    "riskLevels": ["low", "medium", "high"],
    "timeHorizons": ["short", "medium", "long"]
  }
}
```

---

### GET /api/intelligence/opportunities/:symbol

Returns a single canonical opportunity for the given symbol.

**Success (200) — found:**
```json
{ "available": true, "found": true, "opportunity": { ... } }
```

**Not in current snapshot (200):**
```json
{ "available": true, "found": false, "symbol": "XYZ", "message": "XYZ is not a current research candidate in the active snapshot." }
```

**No snapshot yet (200):**
```json
{ "available": false, "message": "No opportunity snapshot available yet.", "symbol": "XYZ" }
```

**Invalid symbol (400):**
```json
{ "error": "Invalid symbol" }
```

---

### Canonical Opportunity Type Reference

| Type | Label | Time Horizon |
|------|-------|-------------|
| `growth` | Growth Candidate | Medium |
| `long_term_investment` | Long-Term Investment Candidate | Long |
| `income` | Income Candidate | Medium |
| `covered_call` | Covered Call Candidate | Short |
| `cash_secured_put` | Cash-Secured Put Candidate | Short |
| `etf` | ETF Candidate | Medium |
| `dividend` | Dividend Candidate | Medium |
| `momentum` | Momentum Candidate | Short |
| `value` | Value Candidate | Medium |
| `swing` | Swing Candidate | Short |
| `ai_infrastructure` | AI Infrastructure Candidate | Medium |
| `semiconductors` | Semiconductors Candidate | Medium |
| `memory` | Memory Candidate | Medium |
| `networking` | Networking Candidate | Medium |
| `cybersecurity` | Cybersecurity Candidate | Medium |
| `cloud` | Cloud Candidate | Medium |
| `energy` | Energy Candidate | Medium |
| `healthcare` | Healthcare Candidate | Medium |
| `financials` | Financials Candidate | Medium |
| `consumer` | Consumer Candidate | Medium |
| `industrials` | Industrials Candidate | Medium |
| `custom_theme` | Custom Theme Candidate | Medium |

---

### Platform Health — Opportunity Intelligence Card

Available at `GET /api/admin/platform-health` → `health.opportunityIntelligence`:

```json
{
  "status": "HEALTHY | DEGRADED | UNKNOWN",
  "summary": "24 opportunities — 10 growth, 6 income, 8 watch",
  "lastSuccessAt": "2026-08-08T12:00:00.000Z",
  "details": {
    "hasSnapshot": true,
    "totalOpportunities": 24,
    "growthCount": 10,
    "incomeCount": 6,
    "watchlistCount": 6,
    "approachingCount": 2,
    "lastGeneratedAt": "2026-08-08T12:00:00.000Z",
    "marketRegime": "bull"
  }
}
```

Status rules: `UNKNOWN` if no snapshot; `DEGRADED` if snapshot has 0 opportunities; `HEALTHY` otherwise.

---

### UAT Checklist — Opportunity Intelligence API

```
□ GET /api/intelligence/opportunities → 200 with available: true (after scanner runs)
□ opportunities[] contains all canonical fields (id, symbol, companyName, sector, etc.)
□ GET /api/intelligence/opportunities?sector=Technology → filteredCount < totalCount
□ GET /api/intelligence/opportunities?minResearchScore=80 → all returned opps have researchScore ≥ 80
□ GET /api/intelligence/opportunities?sortBy=symbol&sortDirection=asc → alphabetical order
□ GET /api/intelligence/opportunities/meta → meta.sectors and meta.themes populated
□ GET /api/intelligence/opportunities/NVDA → found: true (when NVDA is ranked)
□ GET /api/intelligence/opportunities/FAKESYMBOL → found: false (symbol not in snapshot)
□ opportunityTypeLabel uses "Candidate" language, never "recommendation"
□ Platform Health → Opportunity Intelligence card shows HEALTHY with correct counts
□ No companyName/sector/industry null if market_data_symbols has been populated
□ primaryEvidence[] has ≤ 4 items; riskFactors[] has ≤ 3 items
□ themes[] populated for NVDA (AI Infrastructure, Semiconductors)
□ Unauthenticated request → 401
```

---

## Sprint 2.4.2 — Broker Synchronization

### New Routes

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/portfolio/broker/connections` | ✅ | OAuth + linked portfolio status per broker |
| POST | `/api/portfolio/broker/connect` | ✅ | Create broker-linked portfolio, trigger initial sync |
| POST | `/api/portfolio/broker/sync/:portfolioId` | ✅ | Manual sync; 409 if already running |
| GET | `/api/portfolio/broker/sync/:portfolioId/status` | ✅ | Per-portfolio sync state |
| DELETE | `/api/portfolio/broker/disconnect/:portfolioId` | ✅ | Convert to manual, keep positions |

### GET /api/portfolio/broker/connections

Returns broker OAuth status and linked portfolios. No tokens exposed.

```json
{
  "connections": {
    "tradier": { "connected": true, "provider": "tradier", "accountId": "DISP-ONLY", "connectedAt": null },
    "tradestation": { "connected": false }
  },
  "portfolios": [
    {
      "id": "uuid",
      "name": "Tradier Portfolio",
      "provider": "tradier",
      "updatedAt": "2026-08-08T...",
      "syncState": {
        "portfolioId": "uuid",
        "status": "completed",
        "startedAt": "...",
        "completedAt": "...",
        "durationMs": 1800,
        "importedCount": 12,
        "updatedCount": 8,
        "deletedCount": 2,
        "lastError": null,
        "nextScheduledAt": null
      }
    }
  ]
}
```

### POST /api/portfolio/broker/connect

**Body:** `{ "provider": "tradier" | "tradestation", "portfolioName"?: string }`

**Success (201):**
```json
{ "portfolioId": "uuid", "portfolioName": "Tradier Portfolio", "provider": "tradier", "syncing": true }
```

**Error responses:**
| Code | Cause |
|------|-------|
| 400 | Provider not supported |
| 400 + `requiresAuth: true` | OAuth not completed for this broker |
| 409 | Portfolio for this broker already exists |

### POST /api/portfolio/broker/sync/:portfolioId

Triggers immediate sync. Returns immediately; client polls status.

**Success (200):** `{ "portfolioId": "uuid", "status": "running" }`  
**409:** `{ "error": "Synchronization already in progress.", "status": "running" }`

### GET /api/portfolio/broker/sync/:portfolioId/status

```json
{
  "portfolioId": "uuid",
  "portfolioName": "Tradier Portfolio",
  "provider": "tradier",
  "lastUpdatedAt": "2026-08-08T...",
  "currentPositionCount": 12,
  "sync": { "status": "completed", "importedCount": 12, "durationMs": 1800, ... }
}
```

### DELETE /api/portfolio/broker/disconnect/:portfolioId

Converts portfolio `sourceType` from `"broker"` to `"manual"`, clears `sourceAccountId`. Positions are **retained**. Does not revoke OAuth token.

**Success (200):** `{ "portfolioId": "uuid", "message": "Broker disconnected. Portfolio converted to manual. Existing positions retained." }`

---

### Sync Status Values

| Status | Meaning |
|--------|---------|
| `idle` | No sync has run this session |
| `running` | Sync in progress |
| `completed` | Last sync succeeded |
| `failed` | Last sync failed — see `lastError` |
| `needs_reauth` | Token expired; user must re-authenticate |

---

### UAT Checklist — Broker Connection Center (`/portfolio/connect`)

**Pre-connect flow:**
```
□ Navigate to /portfolio → click "Connect Broker" → lands on /portfolio/connect
□ Compliance disclosures visible before any broker card
□ "imports portfolio holdings for research purposes" — visible
□ "does not authorize trading" — visible
□ "You may disconnect your broker at any time" — visible
□ "Broker data is used only for portfolio research features" — visible
```

**Tradier connect flow:**
```
□ Tradier card shows "Disconnected" badge before OAuth
□ "Go to Broker Settings" link present when not OAuth-connected
□ After completing Tradier OAuth: card shows "Connected" badge
□ "Import Holdings" button appears
□ Click "Import Holdings" → POST /api/portfolio/broker/connect body: { provider: "tradier" }
□ Response: 201, portfolioName set, syncing: true
□ Card switches to show sync metrics (Last Sync, Holdings Imported, Duration)
□ Sync status badge shows "Synchronizing…" during active sync
□ After sync: badge shows "Synced", importedCount displayed
□ Navigate to /portfolio → new "Tradier Portfolio" visible with "Broker" source badge
```

**Manual sync:**
```
□ Click "Refresh Portfolio" → POST /api/portfolio/broker/sync/:portfolioId
□ While syncing: button shows "Syncing…" with spinner
□ If second click during sync → 409 returned, no duplicate sync started
□ After sync completes: counts update
```

**Disconnect flow:**
```
□ Click "Disconnect" → DELETE /api/portfolio/broker/disconnect/:portfolioId
□ Toast: "Portfolio converted to manual. Existing holdings retained."
□ Card reverts to "Import Holdings" state
□ Navigate to /portfolio → portfolio still exists with all positions, now shows "Manual" source badge
□ Positions are not deleted
```

**TradeStation connect flow:**
```
□ Same as Tradier — uses /api/tradestation/oauth for OAuth
□ Duplicate-broker guard: attempting to connect a second Tradier portfolio returns 409
```

**Needs-reauth state:**
```
□ When sync returns needsReauth: true → card shows amber "Reconnection required" banner
□ Banner instructs user to go to Broker Settings
□ After re-auth: sync can be retried
```

**Coming-soon brokers:**
```
□ Charles Schwab card visible but aria-disabled
□ Fidelity, IBKR, Robinhood cards visible but aria-disabled
□ No connect/import buttons on coming-soon cards
```

---

### Structured Logs (Part 9)

Every sync emits JSON events to stdout:

```json
{ "event": "broker_sync_started",   "portfolioId": "...", "provider": "tradier",  "userId": "[redacted]", "timestamp": "..." }
{ "event": "broker_sync_completed", "portfolioId": "...", "provider": "tradier",  "importedCount": 12, "durationMs": 1800, "timestamp": "..." }
{ "event": "broker_sync_failed",    "portfolioId": "...", "provider": "tradier",  "errorCode": "SYNC_ERROR", "durationMs": 300, "timestamp": "..." }
```

Fields **never** present in logs: `accessToken`, `refreshToken`, `accountId` (account number), raw `userId`.

---

### Platform Health — Broker Sync Card

Available at `GET /api/admin/platform-health` → `health.brokerSync`:

```json
{
  "status": "HEALTHY | DEGRADED | DISABLED | UNKNOWN",
  "summary": "2 healthy, 0 failed, 0 needs reauth",
  "lastSuccessAt": "2026-08-08T...",
  "details": {
    "connections": 2,
    "healthy": 2,
    "failed": 0,
    "needsReauth": 0,
    "running": 0,
    "lastSyncAt": "2026-08-08T...",
    "avgDurationMs": 1800,
    "pendingJobs": 0,
    "lastError": null
  }
}
```

Status rules: `DEGRADED` if `failedCount > 0` or `needsReauthCount > 0`; `DISABLED` if no portfolios linked; `HEALTHY` otherwise.

---

## Sprint 2.4.1A — Portfolio Upload Privacy & Compliance Disclosures

### Disclosure Inventory

All portfolio upload flows display the following disclosures. UAT must verify each is visible to the user **before upload** and **before confirmation**.

| § | Page | Test ID | Disclosure summary |
|---|------|---------|-------------------|
| §1 | CSV/XLSX upload | `csv-privacy-disclosure` | Privacy & Data Use — file processed for holdings import, not retained, stored after confirm, privacy link |
| §1 | Image/PDF upload | `doc-privacy-disclosure` | Full Privacy & Data Use — sensitive info, AI use, review required, data minimization, privacy link |
| §3 | Image/PDF upload | `ai-extraction-disclosure` | AI-assisted extraction — AI service for data only, always verify, "Learn how your data is handled" → /privacy |
| §4 | Image/PDF upload | `file-retention-notice` | File discarded after extraction, only confirmed data stored |
| §5 | Image/PDF upload | `pii-warning` | Account numbers/addresses/tax IDs may be present; upload minimum necessary |
| §6 | CSV/XLSX — near button | `csv-consent-notice` | "By continuing, you acknowledge that the file will be processed as described above." |
| §6 | Image/PDF — near button | `doc-consent-notice` | Same consent notice |
| §8 | CSV/XLSX preview | `csv-review-warning` | "Review carefully before importing. Automated parsing may not detect every column correctly." |
| §8 | Image/PDF preview | `doc-review-warning` | "Review carefully before importing. AI-extracted fields may be inaccurate." |
| §9 | CSV/XLSX confirm | `csv-confirm-disclaimer` | Confirm acknowledgement + research disclaimer |
| §9 | Image/PDF confirm | `doc-confirm-disclaimer` | Confirm acknowledgement + research disclaimer |
| §10 | All pages | `privacy-link` | Links to `/privacy` — never to `/admin` or ops manual |

### Research Disclaimer (§9)

Appears immediately above the Confirm Import button on all import flows:

> "Portfolio information is used for research and analytics purposes. VCP Trader AI does not make investment decisions for you, and imported portfolio data does not constitute investment advice or a recommendation to buy, sell, hold, or rebalance any security."

### UAT Checklist — Disclosures (Sprint 2.4.1A)

**CSV/XLSX import (`/portfolio/import`):**
```
□ Before selecting a file: "Privacy & Data Use" disclosure visible (csv-privacy-disclosure)
□ "not retained after processing" text visible
□ Privacy Policy link present → navigates to /privacy
□ "By continuing, you acknowledge..." notice visible near Upload button
□ After upload: "Review carefully before importing" warning visible
□ Above Confirm button: confirm acknowledgement visible
□ Above Confirm button: research / not-investment-advice disclaimer visible
□ No AI disclosure present (AI not used for CSV/XLSX)
□ No admin links or operational details exposed
```

**Screenshot import (`/portfolio/import/document?type=image`):**
```
□ Privacy & Data Use disclosure visible (doc-privacy-disclosure)
□ "sensitive financial information" mentioned
□ "not retained after processing" visible
□ Privacy Policy link present → /privacy
□ AI-assisted extraction disclosure visible (ai-extraction-disclosure)
□ "AI service solely to extract portfolio information" text visible
□ "Learn how your data is handled" link → /privacy
□ "original uploaded file is discarded after extraction" notice visible (file-retention-notice)
□ PII warning visible (pii-warning): "account numbers, addresses, tax IDs"
□ "Whenever possible, upload only the page or screenshot containing your holdings" visible
□ "By continuing, you acknowledge..." consent notice visible near Extract button
□ After extraction: "Review carefully before importing" warning visible
□ "AI-extracted fields may be inaccurate" visible
□ Above Confirm button: confirm acknowledgement visible
□ Research disclaimer visible
□ No guarantee of accuracy claimed
□ No admin-only details exposed
```

**PDF import (`/portfolio/import/document?type=pdf`):**
```
□ Same as Screenshot import (same component, same disclosures)
□ Extracting holdings from PDF… shown during processing
```

