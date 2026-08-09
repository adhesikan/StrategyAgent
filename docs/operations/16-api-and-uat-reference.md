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

## Sprint 2.5.2 — AI Research Workspace

### Routes (7)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/research/ask` | ✅ | Main AI research endpoint |
| GET | `/api/research/conversations` | ✅ | List pinned + recent conversations |
| GET | `/api/research/conversations/:id` | ✅ | Conversation with full message history |
| DELETE | `/api/research/conversations/:id` | ✅ | Delete conversation + all messages |
| PATCH | `/api/research/conversations/:id/pin` | ✅ | Pin / unpin toggle |
| GET | `/api/research/templates` | ✅ | 10 built-in prompt templates |

---

### POST /api/research/ask

**Body:**
```json
{
  "question": "string (min 3 chars)",
  "researchMode": "opportunity | company | theme | sector | institutional | market | collection | comparison",
  "contextScope": "entire_market | ai-infrastructure | growth | ...",
  "tickers": ["NVDA", "AMD"],
  "conversationId": "uuid (optional — omit to create new conversation)"
}
```

**Success (200):**
```json
{
  "conversationId": "uuid",
  "messageId": "uuid",
  "userMessageId": "uuid",
  "response": {
    "headline": "string",
    "answer": "string",
    "keyPoints": ["string"],
    "riskNote": "string",
    "confidence": "low | medium | high",
    "evidencePanel": {
      "summary": "string",
      "supportingEvidence": [{"label":"string","value":"string","strength":"strong|moderate|weak","source":"string"}],
      "technicalEvidence": [...],
      "fundamentalEvidence": [...],
      "institutionalEvidence": [...],
      "riskFactors": ["string"],
      "thesisInvalidators": ["string"],
      "researchSourcesUsed": ["string"]
    },
    "followUpActions": [
      {
        "label": "string",
        "description": "string",
        "action": {"type":"ask","question":"string","mode":"opportunity","scope":"entire_market"}
      }
    ],
    "diagnostics": null,
    "referencedTickers": ["NVDA"],
    "researchMode": "opportunity",
    "contextScope": "entire_market",
    "source": "openai | rule_based",
    "disclaimer": "string"
  },
  "disclaimer": "string"
}
```

**Errors:**
- `400`: question too short or invalid researchMode
- `404`: conversationId not found or not owned by user
- `500`: server error

---

### Research Modes

| Mode | Context |
|------|---------|
| `opportunity` | Ranked research candidates + evidence |
| `company` | Specific ticker profile (use `tickers[]`) |
| `theme` | Theme dynamics, leading themes |
| `sector` | Sector intelligence, leading sectors |
| `institutional` | 13F positioning signals |
| `market` | Market regime, health, cross-asset |
| `collection` | Candidates in a specific scope/collection |
| `comparison` | Side-by-side ticker comparison (use `tickers[]`) |

---

### Context Scopes

| Scope | Description |
|-------|-------------|
| `entire_market` | All ranked candidates |
| `my_collections` | User's followed collections |
| `ai-infrastructure`, `semiconductors`, `memory`, `networking`, `cybersecurity`, `cloud` | Theme-scoped |
| `energy`, `healthcare`, `financials`, `consumer`, `industrials` | Sector-scoped |
| `dividend`, `income`, `growth`, `momentum`, `value`, `etf`, `long-term-investments`, `swing-trading`, `covered-calls`, `cash-secured-puts` | Strategy-scoped |
| `market-leaders` | Top 25 by research score |
| `recently-improved` | Top 25 by lastUpdated desc |
| `institutional-activity` | Top 25 by institutionalScore |
| `new-opportunities` | Top 20 by lastUpdated desc |
| `future_portfolio` | Placeholder — not yet wired |

---

### GET /api/research/templates

Returns 10 built-in prompt templates.

```json
{
  "templates": [
    {
      "id": "qualify-explain",
      "label": "Explain Why This Qualified",
      "description": "Walk through the evidence that put this candidate on the radar",
      "mode": "company",
      "defaultScope": "entire_market",
      "promptText": "Explain why {TICKER} qualified as a research candidate...",
      "requiresTicker": true
    }
  ]
}
```

---

### GET /api/research/conversations

Returns pinned + recent conversations.

```json
{
  "pinned": [{ "id": "uuid", "title": "string", "researchMode": "company", "contextScope": "ai-infrastructure", "tickers": ["NVDA"], "isPinned": true, "pinnedAt": "...", "lastMessageAt": "...", "createdAt": "..." }],
  "recent": [...],
  "all": [...]
}
```

---

### GET /api/research/conversations/:id

Returns conversation with full message history.

```json
{
  "conversation": {
    "id": "uuid",
    "title": "string",
    "messages": [
      { "id": "uuid", "role": "user",      "plainText": "Why did NVDA qualify?", "createdAt": "..." },
      { "id": "uuid", "role": "assistant", "response": { ...WorkspaceAIResponse... }, "createdAt": "..." }
    ]
  }
}
```

---

### PATCH /api/research/conversations/:id/pin

**Body:** `{ "pinned": true }` (default `true`; send `false` to unpin)  
**Response:** `{ "success": true, "isPinned": true }`

---

### Platform Health — Research Workspace Card

```json
{
  "status": "HEALTHY | DEGRADED",
  "summary": "42 conversations, 3 pinned; context assembly ok",
  "details": {
    "conversationCount": 42,
    "pinnedConversations": 3,
    "contextAssemblyOk": true,
    "openAiConfigured": true
  }
}
```

Status: `DEGRADED` if OpenAI key not configured or context assembly unavailable.

---

### UAT Checklist — Research Workspace

**Templates:**
```
□ GET /api/research/templates → 10 templates returned
□ "qualify-explain" template has requiresTicker: true
□ "market-summary" template has mode: "market"
□ "ai-infra-leaders" has defaultScope: "ai-infrastructure"
```

**Research modes:**
```
□ POST /api/research/ask { question: "What are the top AI candidates?", researchMode: "opportunity", contextScope: "ai-infrastructure" } → 200, response.source present
□ response.evidencePanel has supportingEvidence, riskFactors, researchSourcesUsed
□ response.followUpActions is array with label + action
□ response.confidence is "low", "medium", or "high"
□ response.referencedTickers is array
□ POST with researchMode: "company", tickers: ["NVDA"] → response answers about NVDA
□ POST with researchMode: "market" → response includes leading themes/sectors
□ POST with researchMode: "institutional" → response focuses on 13F signals
□ POST with researchMode: "comparison", tickers: ["NVDA","AMD"] → side-by-side answer
```

**Diagnostics (empty state):**
```
□ POST with contextScope: "future_portfolio" → response has diagnostics object (scope not wired)
□ diagnostics.universeSearched populated
□ diagnostics.rejectionReasons populated
□ response does NOT say simply "No opportunities"
```

**Conversations:**
```
□ First POST creates a new conversationId
□ Second POST with same conversationId appends to conversation
□ GET /api/research/conversations → pinned and recent arrays
□ GET /api/research/conversations/:id → messages array with role: "user" and role: "assistant"
□ PATCH /api/research/conversations/:id/pin { pinned: true } → isPinned: true
□ PATCH ... { pinned: false } → isPinned: false (unpin)
□ DELETE /api/research/conversations/:id → 200; conversation gone
□ GET /:id after delete → 404
```

**Compliance:**
```
□ response never contains key "recommendation"
□ response never contains key "buy" or "sell" as action directive
□ response.disclaimer present on every response
□ followUpActions never have label "Buy" or "Sell"
```

**Platform Health:**
```
□ GET /api/admin/platform-health → researchWorkspace key present
□ researchWorkspace.details.openAiConfigured present
□ researchWorkspace.details.contextAssemblyOk present
```

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

---

## Portfolio Intelligence (Sprint 2.6.1)

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/portfolio/:id/intelligence` | ✓ | Full portfolio intelligence result |
| GET | `/api/portfolio/:id/intelligence/:symbol` | ✓ | Single holding context |
| GET | `/api/platform-health` | Admin | Includes `portfolioIntelligence` health card |

### GET /api/portfolio/:id/intelligence

**Query params:**
```
?snapshotId=<uuid>   (optional — pins analysis to a specific portfolio snapshot)
```

**Response shape:**
```json
{
  "available": true,
  "portfolioId": "...",
  "generatedAt": "ISO",
  "intelligence": {
    "coverage": { "overallCoveragePercent": 78, ... },
    "concentration": { "concentrationLabel": "Moderate", ... },
    "sectorExposure": [{ "sector": "Technology", "portfolioPercent": 42.1, ... }],
    "themeExposure": [{ "themeId": "ai-infra", "portfolioPercent": 55.2, ... }],
    "opportunityOverlap": [{ "symbol": "NVDA", "overlapCategory": "CURRENTLY_QUALIFIED", ... }],
    "strengthenedHoldings": [...],
    "weakenedHoldings": [...],
    "institutionalSummary": { "coveragePercent": 60, "disclosure": "..." },
    "riskObservations": [...],
    "researchObservations": [...],
    "furtherResearchAreas": [...],
    "disclaimer": "This analysis is research information only...",
    "limitations": [],
    "freshness": { ... }
  }
}
```

**When `available: false`:** Portfolio not found, not owned, has no positions, or subsystem failure.

### UAT Checklist — Portfolio Intelligence (Sprint 2.6.1)

| # | Step | Expected |
|---|------|----------|
| 1 | Open `/portfolio` with a portfolio that has positions | Three tabs visible: Holdings, History, Intelligence |
| 2 | Click Intelligence tab | Tab activates; loading spinner appears then resolves |
| 3 | No positions portfolio | Intelligence tab shows "Add positions" prompt, not error |
| 4 | Check Coverage section | Shows overall % progress bar + 6 breakdown counts |
| 5 | Check Opportunity Overlap | Cards list symbols with Qualified/Approaching/Not Ranked badges |
| 6 | Click an overlap card | Navigates to `/opportunities/:symbol` |
| 7 | Check Sector Exposure | Bars showing sector %, sum ≤ 100% |
| 8 | Check Theme Exposure | "May exceed 100% due to overlap" disclosure visible |
| 9 | Check Concentration section | Shows Low/Moderate/High labels with color coding |
| 10 | Check Institutional Context | Coverage bar + 13F disclosure footer |
| 11 | Check compliance disclaimer | Research-only disclaimer visible at page bottom |
| 12 | Inspect GET /api/portfolio/:id/intelligence | No `portfolioScore`, `portfolioGrade`, `portfolioRating` fields in response |
| 13 | Inspect platform health | `portfolioIntelligence` card present |
| 14 | Cross-user test | User B cannot fetch User A's intelligence (401 or 404) |
| 15 | 10-min re-request | Response is identical (cache hit); check `generatedAt` unchanged |
| 16 | Position mutation | After add/edit/delete, cache invalidated; fresh request recomputes |

---

## Portfolio History & Change Intelligence (Sprint 2.6.0)

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/portfolio/:id/history` | ✓ | Portfolio snapshot timeline |
| GET | `/api/portfolio/:id/changes` | ✓ | Deterministic change classification |
| POST | `/api/portfolio/:id/snapshot` | ✓ | Manually capture a snapshot |

### GET /api/portfolio/:id/history

**Query params:**
```
?period=7D|30D|90D|YTD|1Y|ALL   (default: 30D)
```

**Response:**
```json
{
  "portfolioId": "port-uuid",
  "period": "30D",
  "snapshots": [
    {
      "id": "snap-...",
      "snapshotDate": "2026-08-09",
      "capturedAt": "2026-08-09T10:00:00.000Z",
      "sourceType": "broker_sync",
      "totalMarketValue": 127400.00,
      "totalCostBasis": 118200.00,
      "positionCount": 8,
      "coverage": { "positionsTotal": 8, "positionsWithMarketData": 7, "coveragePercent": 87 }
    }
  ],
  "count": 4,
  "disclaimer": "Portfolio history is provided for research and analytics purposes and does not constitute investment advice."
}
```

### GET /api/portfolio/:id/changes

**Query params:**
```
?from=<snapshotId>   (optional — defaults to snapshot before latest)
?to=<snapshotId>     (optional — defaults to latest snapshot)
```

**Response key structure:**
```json
{
  "changes": {
    "portfolioId": "...",
    "summary": { "fromSnapshotId", "toSnapshotId", "fromDate", "toDate", "valueChange", "valueChangePercent", "previousValue", "currentValue", "costBasisChange", "positionCountChange", "previousPositionCount", "currentPositionCount" },
    "addedPositions": [{ "symbol", "changeType": "NEW", "previousQuantity": null, "currentQuantity", "quantityDelta", "previousMarketValue", "currentMarketValue", "marketValueDelta", "sector", "themes" }],
    "exitedPositions": [...],
    "increasedPositions": [...],
    "reducedPositions": [...],
    "unchangedPositions": [...],
    "researchStrengthened": [{ "symbol", "changeType": "RESEARCH_STRENGTHENED", "previousScore", "currentScore", "scoreDelta", "previousTechScore", "currentTechScore", "sector" }],
    "researchWeakened": [...],
    "newlyQualified": [...],
    "noLongerQualified": [...],
    "sectorChanges": [{ "name", "changeType": "SECTOR_EXPOSURE_INCREASED", "previousPercent", "currentPercent", "percentDelta" }],
    "themeChanges": [...],
    "dataFreshness": { "fromSnapshotAt", "toSnapshotAt", "institutionalDataNote" },
    "coverage": { "positionsTotal", "positionsWithMarketData", "positionsWithOpportunityIntelligence", "coveragePercent" },
    "limitations": []
  },
  "disclaimer": "Portfolio change information is provided for research and analytics purposes and does not constitute investment advice."
}
```

**Errors:**
- `404` — Portfolio not found, or fewer than 2 snapshots exist

### POST /api/portfolio/:id/snapshot

**Response (201 — new):**
```json
{ "ok": true, "snapshotId": "snap-...", "skipped": false, "message": "...", "durationMs": 85 }
```

**Response (200 — deduplicated):**
```json
{ "ok": true, "snapshotId": null, "skipped": true, "message": "Identical snapshot captured in last 30 minutes...", "durationMs": 12 }
```

### UAT Checklist — Portfolio History (Sprint 2.6.0)

**Snapshot capture:**
```
□ Import portfolio (CSV/XLSX) → server log shows portfolio_snapshot_completed
□ Broker sync completes → server log shows portfolio_snapshot_completed
□ Add a position manually → server log shows portfolio_snapshot_completed
□ Edit a position manually → server log shows portfolio_snapshot_completed
□ Delete a position manually → server log shows portfolio_snapshot_completed
□ POST /api/portfolio/:id/snapshot → returns 201 with snapshotId
□ POST again immediately → returns 200 with skipped=true (deduplication)
□ Wait 30 min → POST again → returns 201 (new snapshot)
```

**History tab:**
```
□ /portfolio shows "History" tab after at least 1 snapshot
□ History tab loads without error
□ Snapshots listed in reverse chronological order
□ Each card shows: date, source type badge, total market value, position count, coverage
□ "Capture Snapshot" button appears in History tab
□ Period selector changes the list (7D, 30D, 90D, ALL)
□ Empty state shown when no snapshots exist yet
```

**Changes view:**
```
□ At least 2 snapshots → "View Changes" button appears
□ GET /api/portfolio/:id/changes returns 200
□ "What Changed?" summary shows value change and position count change
□ Added positions (NEW) are listed with current quantity
□ Exited positions (EXITED) are listed with previous quantity
□ Increased positions (INCREASED) show quantity delta
□ Reduced positions (REDUCED) show quantity delta (negative)
□ Unchanged positions (UNCHANGED) show quantity delta = 0
□ Market value change for UNCHANGED position is tracked separately from quantity change
□ Research Strengthened section shows symbols with score increase ≥ 2
□ Research Weakened section shows symbols with score decrease ≥ 2
□ Newly Qualified shows symbols that appeared in Opportunity Intelligence
□ No Longer Qualified shows symbols that left Opportunity Intelligence
□ Sector exposure changes listed (Technology +2.8%, etc.)
□ Theme exposure changes listed (ai-infrastructure +3.1%, etc.)
□ Data freshness shown (fromSnapshot date, toSnapshot date)
□ 13F institutional data delay note visible
□ Limitations listed when market data is unavailable
□ Compliance disclaimer visible at bottom
```

**Missing data handling:**
```
□ Position with no reference price shows market value as "—" (not $0)
□ Position with no Opportunity Intelligence shows research score as "—" (not 0)
□ Total portfolio value shows "—" when all reference prices unavailable
□ Coverage section shows correct counts (positionsWithMarketData, etc.)
```

**User isolation:**
```
□ User A cannot access User B's portfolio history (404 returned)
□ User A cannot access User B's snapshots via ?from=&to= params (404 returned)
□ No error message reveals whether portfolio ID exists for another user
```

**Platform health:**
```
□ GET /api/admin/platform-health includes portfolioHistory key
□ portfolioHistory.status = "HEALTHY"
□ portfolioHistory.details.portfoliosTracked is numeric
□ portfolioHistory.details.snapshotsTotal is numeric
□ portfolioHistory.details.storageHealth = "ok"
□ action field suggests /portfolio when snapshotsTotal = 0
□ No portfolio holdings or symbols appear in health response
```

**Compliance:**
```
□ No "you bought" in any API response
□ No "you sold" in any API response
□ No "recommendation" in any response
□ No "strong buy" in any response
□ "Position Increased" language used (not "You bought more")
□ "Position Reduced" language used (not "You sold some")
□ Disclaimer present on /api/portfolio/:id/history response
□ Disclaimer present on /api/portfolio/:id/changes response
□ 13F disclosure present in dataFreshness when changes include institutional evidence
```

**Structured logging:**
```
□ Server logs show portfolio_snapshot_completed with aggregate counts
□ portfolio_snapshot_completed log does NOT contain symbols array
□ portfolio_snapshot_completed log does NOT contain quantities
□ portfolio_snapshot_completed log does NOT contain cost basis
□ portfolio_change_computed log shows only aggregate counts
```

---

## Research Reports & Publishing (Sprint 2.5.5)

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/research-reports` | ✓ | Generate report |
| GET | `/api/research-reports` | ✓ | List / search reports |
| GET | `/api/research-reports/health` | ✓ | Health stats |
| GET | `/api/research-reports/:id` | ✓ | Single report |
| PATCH | `/api/research-reports/:id` | ✓ | Update (pin/rename/archive) |
| DELETE | `/api/research-reports/:id` | ✓ | Archive report |
| GET | `/api/research-reports/:id/export` | ✓ | Export in format |

### POST /api/research-reports — Request Body

```json
{
  "reportType": "morning_brief",
  "title": "My Morning Brief",
  "subtitle": "For internal review",
  "tags": ["daily"]
}
```

Valid reportType values: morning_brief, evening_summary, market_changes, weekly_market_intel, weekly_ai_infrastructure, weekly_semiconductor, weekly_memory, weekly_cloud, weekly_cybersecurity, weekly_institutional, weekly_sector_leadership, weekly_theme_leadership, collection_summary, research_monitoring_summary, opportunity_intel_summary, workspace_summary

### GET /api/research-reports/:id/export — Format Param

```
GET /api/research-reports/:id/export?format=html
GET /api/research-reports/:id/export?format=markdown
GET /api/research-reports/:id/export?format=json
GET /api/research-reports/:id/export?format=pdf_ready
GET /api/research-reports/:id/export?format=ppt_ready
```

HTML/Markdown return the raw string with Content-Type header. JSON/pdf_ready/ppt_ready return `{ format, content }`.

### GET /api/research-reports/health — Response

```json
{
  "health": {
    "reportsGenerated": 5,
    "reportsToday": 2,
    "latestReport": "2026-08-09T10:00:00.000Z",
    "generationTimeMs": 45,
    "storageHealth": "ok",
    "reportTypeBreakdown": {
      "morning_brief": 3,
      "weekly_market_intel": 2
    }
  }
}
```

### Command Center Integration

`GET /api/command-center/daily` now includes `latestReport: LatestReportSection`:

```json
{
  "latestReport": {
    "available": true,
    "latestReport": {
      "reportId": "rpt-1786269099146-abc123",
      "title": "Morning Research Brief",
      "reportType": "morning_brief",
      "typeLabel": "Morning Research Brief",
      "generatedAt": "2026-08-09T10:00:00.000Z",
      "marketRegime": "Bullish",
      "summary": "5 research candidates tracked in Bullish regime.",
      "isPinned": false,
      "status": "published",
      "linkTo": "/research-reports/rpt-1786269099146-abc123"
    },
    "recentReports": [],
    "reportsToday": 1,
    "lastGeneratedAt": "2026-08-09T10:00:00.000Z",
    "generateShortcut": "/research-reports",
    "viewAllShortcut": "/research-reports"
  }
}
```

### UAT Checklist — Research Reports (Sprint 2.5.5)

**Page: /research-reports**
```
□ Page loads without error
□ "Research Reports" heading with FileText icon visible
□ Report count shown in subtitle
□ "Generate Report" button visible in top right
□ Empty state visible on first visit: "No research reports yet"
□ Empty state has "Generate Your First Report" button
□ Clicking "Generate Report" or empty-state button opens Generate Report modal
□ Modal: Report Type dropdown shows all 16 types
□ Modal: Custom Title field optional
□ Modal: Subtitle field optional
□ Modal: "Generated from existing intelligence — no new scans performed" note visible
□ Modal: Compliance note visible
□ Modal: "Generate Report" button disabled when mutation is in progress (shows spinner)
□ After generation: new report card appears in grid
□ Report card shows: type badge, title, summary excerpt, meta (time ago, regime, freshness)
□ Report card has: export menu, pin button, archive button
□ Clicking anywhere on card (except buttons) opens Report Viewer
```

**Report Viewer:**
```
□ "← Back to reports" link visible
□ Report title and subtitle visible
□ Meta strip shows: type badge, generated time, data freshness, market regime, author
□ "Pinned" badge shown when isPinned=true
□ Export menu visible (Downloads dropdown)
□ Pin/Unpin button toggles correctly
□ Archive (trash) button with confirmation dialog
□ "Key Findings" panel with blue left border
□ Key findings listed as bullets
□ Section cards are collapsible (first 2 open by default)
□ Each section shows: icon, title, content text, bullets (if any)
□ Clicking section header toggles open/closed
□ Supporting Evidence grid visible with source labels
□ Related research links: Command Center, Research Workspace, Collections, Research Monitor, Opportunity Intel
□ "How are scores calculated? View Research Glossary" link
□ Compliance disclaimer at bottom
```

**Generate each report type:**
```
□ morning_brief       → generates without error
□ evening_summary     → generates without error
□ market_changes      → generates without error
□ weekly_market_intel → generates without error
□ collection_summary  → generates without error
□ research_monitoring_summary → generates without error
□ opportunity_intel_summary   → generates without error
□ (Verify: all 16 types generate successfully)
```

**Report Library features:**
```
□ Search bar filters reports by title/summary in real time
□ Clear (×) button appears when search has text
□ Type filter dropdown filters by report type
□ "Pinned" toggle shows only pinned reports
□ Pinned reports always appear first in grid
□ Clearing filters restores full list
```

**Pin/Unpin:**
```
□ Clicking Pin button on card sends PATCH with isPinned=true
□ Report card shows yellow Pin icon when pinned
□ Pinned reports move to top of grid
□ Clicking Unpin removes pin and card returns to chrono order
□ PATCH /api/research-reports/:id returns 200 with updated report
```

**Archive/Delete:**
```
□ Clicking Trash button shows confirmation dialog
□ Confirming sends DELETE /api/research-reports/:id
□ DELETE returns { ok: true, archived: true }
□ Report disappears from library (status=archived, excluded from default list)
□ Archived reports retrievable via ?status=archived query param
```

**Export:**
```
□ Export menu opens on click
□ HTML option opens new browser tab with formatted HTML
□ Markdown option opens new browser tab with markdown text
□ JSON option downloads .json file
□ PDF-ready option downloads .pdf-ready.json file
□ PPT-ready option downloads .ppt-ready.json file
□ HTML export starts with <!DOCTYPE html>
□ HTML export contains report title in <h1>
□ HTML export contains key findings in <ul>
□ Markdown export starts with # heading
□ PDF-ready export has pages[] array
□ PDF-ready export has metadata.title
□ PPT-ready export has slides[] array
□ PPT-ready first slide is slideType: "title"
□ PPT-ready last slide is slideType: "disclaimer"
```

**Platform Health:**
```
□ GET /api/admin/platform-health includes researchReports key
□ researchReports.status = "HEALTHY" (or "UNKNOWN" if DB issue)
□ researchReports.details.reportsGenerated is numeric
□ researchReports.details.storageHealth = "ok"
□ action field suggests /research-reports when reportsGenerated=0
```

**Command Center integration:**
```
□ GET /api/command-center/daily includes latestReport field
□ latestReport.available=false when user has no reports
□ latestReport.available=true after generating a report
□ latestReport.latestReport has reportId, title, reportType, linkTo
□ latestReport.linkTo starts with /research-reports/
□ latestReport section does not block other sections (degrades independently)
□ latestReport.generateShortcut = "/research-reports"
□ latestReport.viewAllShortcut = "/research-reports"
```

**Compliance:**
```
□ No "recommendation to buy" in any generated report
□ No "strong buy" in any generated report
□ No "top pick" in any generated report
□ No "price target" or "target price" in any generated report
□ No "guarantee" in any generated report
□ Disclaimer present in report viewer
□ Compliance footer present on /research-reports page
□ Compliance note present in Generate Report modal
□ Report type labels do not contain "buy", "sell", or "guarantee"
□ Section titles do not contain "buy", "sell", or "guarantee"
```

**Error handling:**
```
□ POST with invalid reportType returns 400 with validTypes list
□ GET /reports/:id for non-existent returns 404
□ GET /reports/:id/export with invalid format returns 400 with validFormats list
□ All routes return 401 when not authenticated
□ All routes return 500 with error detail on unexpected failure
```

---

## Research Monitor & Daily Intelligence Feed (Sprint 2.5.4)

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/research-monitor/watches` | ✓ | List active watches |
| POST | `/api/research-monitor/watches` | ✓ | Create watch |
| GET | `/api/research-monitor/watches/:id` | ✓ | Watch detail |
| PATCH | `/api/research-monitor/watches/:id` | ✓ | Update watch |
| DELETE | `/api/research-monitor/watches/:id` | ✓ | Archive watch |
| POST | `/api/research-monitor/watches/:id/evaluate` | ✓ | Trigger evaluation |
| GET | `/api/research-monitor/feed` | ✓ | Daily research feed |
| GET | `/api/research-monitor/health` | ✓ | Monitoring health |

### POST /api/research-monitor/watches — Request Body

```json
{
  "name": "NVDA Research Monitor",
  "watchType": "company",
  "entityId": "NVDA",
  "entityLabel": "NVIDIA Corporation"
}
```

Entity-required types: `company`, `theme`, `sector`, `collection`, `institutional_activity`
Market-wide types (no entityId): `market_regime`, `growth_candidates`, `income_candidates`, `momentum`, `etf_candidates`, `dividend_candidates`

### GET /api/research-monitor/feed — Response Shape

```json
{
  "feed": {
    "feedId": "feed-2026-08-09",
    "generatedAt": "2026-08-09T10:00:00.000Z",
    "feedDate": "2026-08-09",
    "summary": {
      "totalChanges": 7,
      "highlights": ["3 new candidates", "2 theme changes"],
      "newCandidates": 3,
      "improvedCandidates": 2,
      "weakenedCandidates": 1,
      "themeChanges": 2,
      "sectorChanges": 1,
      "regimeChanged": false
    },
    "sections": [
      {
        "id": "new-candidates",
        "title": "3 New Qualified Candidates",
        "description": "...",
        "changeType": "new",
        "count": 3,
        "items": [
          { "id": "new-NVDA", "symbol": "NVDA", "label": "NVDA", "detail": "...", "changeDirection": "new", "linkTo": "/opportunities/NVDA", "score": 88 }
        ],
        "linkTo": "/dashboard"
      }
    ],
    "isPersonalized": true,
    "watchCount": 2
  }
}
```

### Command Center Integration

`GET /api/command-center/daily` now includes `myWatchChanges: MyWatchChangesSection`:

```json
{
  "myWatchChanges": {
    "available": true,
    "watchCount": 3,
    "activeWatchCount": 2,
    "recentChanges": [
      {
        "watchId": "...", "watchName": "NVDA Watch", "watchType": "company",
        "entityLabel": "NVIDIA", "changeType": "score_improved",
        "changeDirection": "improved", "changeSummary": "Score improved by 8 points (now 85)",
        "changedAt": "2026-08-09T10:00:00.000Z", "linkTo": "/opportunities/NVDA"
      }
    ],
    "lastEvaluatedAt": "2026-08-09T10:00:00.000Z",
    "feedSummary": "1 research watch update"
  }
}
```

### UAT Checklist — Research Monitor (Sprint 2.5.4)

**Page: /research-monitor**
```
□ Page loads without error
□ "My Research Watches" section visible
□ Empty state shows "No research watches yet" with "Create Your First Watch" button
□ "+ New Watch" button opens Create Watch modal
□ Modal: Watch Name field required
□ Modal: Watch Type dropdown shows all 12 types (excluding custom_collection)
□ Modal: Entity ID field appears for company, theme, sector, collection, institutional_activity
□ Modal: Entity ID hidden for market_regime, growth_candidates, etc.
□ Modal: Submit disabled when name is empty
□ Modal: Submit disabled when entity-required type chosen but entityId is empty
□ After creation: new watch card appears in grid
□ Watch card shows: name, type badge, last change status, evaluate/delete buttons
□ Evaluate button (↻) triggers manual evaluation and refreshes card
□ Delete button (🗑) archives watch and removes from list
□ "Daily Research Feed" section shows below watches
□ Feed sections are collapsible (click header to toggle)
□ Feed items show change direction indicator (green/amber/red)
□ Feed items have clickable links to existing pages
□ "How are scores calculated?" link visible (from Sprint 2.5.3A integration)
□ "Not investment advice" disclaimer visible
□ Footer: "Research changes only. Not a recommendation to buy or sell."
```

**Create watch — company type:**
```
□ Enter ticker "NVDA", name "NVDA Watch"
□ Created → card shows "NVDA Research Monitor" type badge
□ Entity ID stored as uppercase "NVDA"
□ POST /api/research-monitor/watches returns 201 with watch object
```

**Create watch — growth_candidates type:**
```
□ Select "Growth Candidates" type
□ No entityId field shown
□ Created → card shows "Growth Candidates" type badge
□ POST /api/research-monitor/watches returns 201
```

**Watch evaluation:**
```
□ POST /api/research-monitor/watches/:id/evaluate returns evaluation object
□ Evaluation includes changed: boolean, changeType, changeSummary
□ After evaluation: watch card shows last_change_summary if changed
□ last_evaluated_at updated on watch record
□ watch_activity_log has new row (including status_unchanged entries)
```

**Daily Feed:**
```
□ GET /api/research-monitor/feed returns feed object
□ feed.feedId starts with "feed-"
□ feed.sections is an array (may be empty if no intelligence loaded)
□ feed.isPersonalized=true when user has active watches
□ feed.summary.highlights is an array
□ Each section has: id, title, description, changeType, count, items, linkTo?
□ Each item has: id, label, detail, changeDirection, linkTo
□ All item linkTo values start with "/" (internal pages only)
```

**Command Center integration:**
```
□ GET /api/command-center/daily includes myWatchChanges field
□ myWatchChanges.available=false when user has no watches
□ myWatchChanges.available=true after creating a watch with changes
□ myWatchChanges.recentChanges is an array
□ myWatchChanges.lastEvaluatedAt is string or null
□ myWatchChanges section does not block other sections (degrades independently)
```

**Platform Health:**
```
□ GET /api/admin/platform-health includes researchMonitoring key
□ researchMonitoring.status = "UNKNOWN" when no watches exist
□ researchMonitoring.status = "HEALTHY" when active watches exist
□ researchMonitoring.details.watchCount is numeric
□ researchMonitoring.details.evaluationsToday is numeric
□ action field suggests /research-monitor when watchCount=0
```

**Error handling:**
```
□ POST with invalid watchType returns 400 with error message listing valid types
□ POST company type without entityId returns 400 "entityId is required"
□ GET /watches/:id for non-existent ID returns 404
□ All routes return 401 when not authenticated
□ All routes return 500 with error message on unexpected failure (not blank)
```

**Compliance:**
```
□ No "alert" or "notification" language on /research-monitor page
□ No "recommend", "buy", "sell", "predict" in any feed or watch copy
□ "Research Monitor" used (not "Alert System" or "Signal Monitor")
□ "Observed Change" / "Research Change" / "Qualified Candidate" language only
□ Disclaimer present on watch creation modal
□ Disclaimer present in daily feed footer
□ notifyEmail and notifyPush always false (notification infrastructure not built)
```

---

## Research Glossary & Score Transparency (Sprint 2.5.3A)

### Central Research Glossary

**Source:** `shared/research-glossary.ts`

The Research Glossary is the single canonical source for all score definitions, candidate types, evidence terminology, and compliance cautions. No definitions are duplicated inside React components — all surfaces consume the glossary via `getGlossaryEntry(key)`.

**Components consuming the glossary:**
- `ResearchDefinitionTooltip` — wraps any label/text to show a tooltip with `shortDefinition` + optional caution
- `ResearchHelpIcon` — standalone `?` icon with glossary tooltip (no children required)
- `ScoreExplanationModal` / `UnderstandingScoresLink` — full "Understanding Research Scores" modal populated from glossary sections

**SCORE_LABEL_TO_GLOSSARY_KEY:** Auto-maps display labels (`"Tech"`, `"Inst"`, `"Fund"`, `"Risk"`, `"Overall"`, `"Regime"`, `"Confidence"`) to glossary keys. Used by `ScorePill` and `ScoreBar` to auto-derive tooltip without changing call signatures.

**Risk Score special note:** `riskScore` in the UI (OpportunityScore from ranking engine) is "higher = better risk profile" — verified from `computeRiskScore()`. Higher does NOT mean more risk; it means better risk/reward quality.

---

### UAT Checklist — Research Glossary & Score Transparency (Sprint 2.5.3A)

**Dashboard (`/dashboard`) — Opportunity Cards:**
```
□ Hover/tap "Tech" label on any opportunity card → tooltip shows "Technical Score" + short definition
□ Hover/tap "Inst" label → tooltip shows "Institutional Score" + definition
□ Hover/tap "Fund" label → tooltip shows "Fundamental Score" + definition
□ Hover/tap "Risk" label → tooltip shows "Risk Score" + "↑ Higher is better" + definition
□ "?" icon next to confidence badge → tooltip shows "Evidence Confidence" definition
□ Caution text visible below definition in tooltip (amber color)
□ "?" icon next to overall score bar → tooltip shows "Research Score" definition
□ "How are scores calculated?" button visible below section subtitle
□ Clicking "How are scores calculated?" opens "Understanding Research Scores" modal
□ Modal sections: Research Scores · Evidence Confidence · Research Evidence · Market Context · Data Quality · Research Candidate Types
□ Modal footer: "Research scores organize available evidence. They are not predictions..."
□ Modal closes on Escape key
□ Modal focus trapped while open
□ "Why this qualified" toggle visible on each opportunity card
□ Clicking toggle expands: shows green checkmarks for reasons, amber triangles for warnings
□ Toggle is keyboard accessible (Tab + Enter)
□ Expanded panel shows "Deterministic evidence only. Not a recommendation."
□ "Highest Score" (not "Top Pick") shown in Smart Panel if applicable
```

**Scanner (`/scanner`) — Compliance:**
```
□ High-Scoring Setups section heading visible (NOT "Top Picks")
□ Tooltip explanation still present next to section heading
□ Score methodology description unchanged
```

**Options Scanner (`/options-scanner`) — Compliance:**
```
□ "High-Confidence Results" heading visible in card view (NOT "Top Picks")
□ "High-Confidence Results" heading visible in list view (NOT "Top Picks")
□ Tooltip explanation still present next to heading
□ Score methodology description unchanged
```

**Opportunity Workspace (`/opportunities/:symbol`) — Score Breakdown:**
```
□ Score card title reads "Research Score" (previously "Score Breakdown")
□ "Understanding research scores" link visible in score card header
□ Clicking link opens the full score explanation modal
□ Hover/tap "Overall" label → tooltip shows Research Score definition
□ Hover/tap "Technical" label → tooltip shows Technical Score definition
□ Hover/tap "Institutional" label → tooltip shows Institutional Score + 13F delay caution
□ Hover/tap "Fundamental" label → tooltip shows Fundamental Score definition
□ Hover/tap "Risk" label → tooltip shows Risk Score + "Higher is better" indicator
□ Hover/tap "Regime" label → tooltip shows Regime Alignment Score definition
□ "Why This Ranked" section still present with deterministic bullet points
```

**Compliance Audit:**
```
□ No "Strong Buy", "Buy Now", "Top Pick", "Recommended Trade", "Buy Candidate" visible on research pages
□ Confidence badges do NOT say "Probability of winning" or "Chance of success"
□ All score tooltips include amber caution text
□ Institutional score tooltip includes "13F data is delayed" language
□ No LLM invoked for "Why This Qualified" panel (all deterministic)
```

**Accessibility:**
```
□ All tooltip triggers focusable via Tab key
□ Tooltip opens on Enter/Space for keyboard users
□ Tooltip closes on Escape
□ "Why this qualified" button has aria-expanded attribute
□ Score modal has focus trap — Tab stays within modal while open
□ Escape closes score modal and restores focus to trigger
□ Screen reader: tooltip trigger has aria-label="What is [Term]?"
```

**Mobile:**
```
□ Tap on "Tech"/"Inst"/"Fund"/"Risk" label opens tooltip (no hover needed)
□ Tap on "?" icon opens tooltip
□ Score explanation modal is scrollable on small screens
□ "Why this qualified" panel expands correctly at mobile width
□ No horizontal overflow caused by tooltip triggers
```

---

## Market Research Command Center (Sprint 2.5.3)

### `GET /api/command-center/daily`

**Purpose:** Aggregated daily snapshot answering "What changed today?" — reads from all precomputed intelligence stores in parallel. Never recomputes anything.

**Auth:** Authenticated user (session required)

**Expected status:** 200

**Response shape:**
```json
{
  "generatedAt": "2026-08-09T12:00:00.000Z",
  "marketOverview": {
    "regime": "bull | bear | sideways | null",
    "marketHealth": 72,
    "marketHealthLabel": "Strong | Moderate | Weak | Unknown",
    "leadingThemes": [{ "themeId": "...", "themeName": "...", "score": 82, "direction": "up|down|stable", "scoreDelta": 5.2, "topSymbols": ["NVDA"], "relatedResearch": [{ "label": "...", "path": "..." }] }],
    "leadingSectors": [{ "sector": "Technology", "label": "Technology", "score": 75, "direction": "stable", "scoreDelta": null, "topSymbols": [], "relatedResearch": [] }],
    "mostImprovedThemes": [],
    "weakeningThemes": [],
    "whatsNew": ["AI Infrastructure momentum building (+5.2 pts)"],
    "whatsChanged": ["Energy showing weakness (-3.1 pts)"],
    "evidence": ["12 theme snapshots analyzed"],
    "confidence": { "level": "high", "basis": "12 themes and 5 sectors" },
    "freshness": "2026-08-09T10:00:00.000Z",
    "hasData": true,
    "relatedResearch": [{ "label": "Intelligence Hub", "path": "/intelligence" }]
  },
  "opportunityChanges": {
    "available": true,
    "majorMovers": [{ "symbol": "NVDA", "companyName": null, "previousScore": 70, "currentScore": 85, "scoreDelta": 15, "changeType": "major_mover", "importance": "Critical", "explanation": "...", "drivers": ["..."], "warnings": [], "previousState": "QUALIFIED", "currentState": "QUALIFIED", "relatedResearch": [] }],
    "upgrades": [],
    "downgrades": [],
    "newEntries": [],
    "removed": [],
    "totalChanged": 1,
    "whatsNew": ["1 new candidate(s) entered the ranking"],
    "whatsChanged": ["1 major move(s) detected — review drivers"],
    "evidence": ["50 symbols in current ranking"],
    "confidence": { "level": "high", "basis": "50 ranked symbols, 1 changes detected" },
    "freshness": "2026-08-09T10:00:00.000Z",
    "relatedResearch": []
  },
  "themeChanges": { "themes": [], "whatsNew": [], "whatsChanged": [], "evidence": [], "confidence": { "level": "low", "basis": "..." }, "freshness": null, "hasData": false, "relatedResearch": [] },
  "sectorChanges": { "sectors": [], "whatsNew": [], "whatsChanged": [], "evidence": [], "confidence": { "level": "low", "basis": "..." }, "freshness": null, "hasData": false, "relatedResearch": [] },
  "institutionalChanges": { "available": false, "recentSignals": [], "whatsNew": [], "whatsChanged": [], "evidence": [], "confidence": { "level": "low", "basis": "..." }, "freshness": null, "relatedResearch": [] },
  "collectionChanges": { "collections": [], "whatsNew": [], "whatsChanged": [], "evidence": [], "confidence": { "level": "low", "basis": "..." }, "freshness": null, "relatedResearch": [] },
  "myCollections": { "pinned": [], "favorites": [], "followed": [], "systemHighlights": [], "total": 0, "relatedResearch": [] },
  "aiResearchSummary": { "available": false, "recentConversationCount": 0, "pinnedConversationCount": 0, "topModes": [], "suggestedQueries": [{ "label": "What changed today?", "description": "...", "mode": "market", "scope": "entire_market", "promptText": "..." }], "whatsNew": [], "evidence": [], "confidence": { "level": "low", "basis": "..." }, "relatedResearch": [] },
  "researchTimeline": { "items": [], "totalConversations": 0, "available": false, "relatedResearch": [] }
}
```

**Healthy data response:** All sections populated — marketOverview.hasData=true, opportunityChanges.available=true, themeChanges.hasData=true, sectorChanges.hasData=true, institutionalChanges.available depends on env config.

**Healthy empty response (fresh deployment):** `marketOverview.hasData=false`, all available=false, `opportunityChanges.available=false`. Sections show "Not available yet" placeholders. This is correct behavior before the first scan completes.

**Common failures:**
- All sections unavailable → No scan completed + no intelligence rebuild run
- Opportunity changes unavailable → Ranking lost after server restart; wait for next scan
- Institutional unavailable → Check `INSTITUTIONAL_INTELLIGENCE_ENABLED` and 13F ingestion status

**Runbook:** [11-troubleshooting-runbook.md](11-troubleshooting-runbook.md) → CMD_ALL_SECTIONS_UNAVAILABLE

---

### `GET /api/command-center/health`

**Purpose:** Lightweight in-memory health snapshot — reads zero DB rows. Populated on the first visit to `/market-research-command-center`.

**Auth:** Authenticated user

**Expected status:** 200

**Response shape:**
```json
{
  "lastGeneratedAt": "2026-08-09T12:00:00.000Z | null",
  "sectionsAvailable": 7,
  "opportunityChangesAvailable": true,
  "themeDataAvailable": true,
  "sectorDataAvailable": true,
  "collectionsSeeded": true,
  "institutionalDataAvailable": false
}
```

**Note:** Returns `lastGeneratedAt: null` and `sectionsAvailable: 0` on fresh deploy until a user visits the page. This is expected — not a health failure.

---

### UAT Checklist — Market Research Command Center (Sprint 2.5.3)

**Page: `/market-research-command-center`**
```
□ Page title "Market Research Command Center" visible (data-testid="cmd-center-title")
□ Three nav buttons visible: AI Workspace, Intelligence, Research Hub
□ Market Overview section visible (data-testid="cmd-market-overview")
  □ If data available: Market Health label (Strong/Moderate/Weak/Unknown) displayed
  □ Leading Themes badges link to /intelligence/themes/:themeId
  □ Leading Sectors badges link to /intelligence/sectors/:sector
  □ What's New and What's Changed lists populated when data available
  □ Confidence badge and freshness badge visible in section header
  □ Related Research links present at bottom of section
□ Opportunity Changes section visible (data-testid="cmd-opp-changes")
  □ If ranking available: change cards shown (major movers, new entries, upgrades, downgrades, removed)
  □ Clicking a change row navigates to /opportunities/:symbol
  □ Score delta shown in green (positive) or red (negative)
  □ If ranking not available: "Ranking not yet available" message shown
□ Theme Changes section visible (data-testid="cmd-theme-changes")
  □ Theme rows link to /intelligence/themes/:themeId
  □ Direction icons shown (up=green, down=red, stable=gray)
  □ Score delta shown with +/- prefix
□ Sector Changes section visible (data-testid="cmd-sector-changes")
  □ Sector rows link to /intelligence/sectors/:sector
  □ Direction icons correct
□ Institutional Changes section visible (data-testid="cmd-institutional-changes")
  □ If INSTITUTIONAL_INTELLIGENCE_ENABLED: signal cards shown with magnitude badges
  □ Clicking signal row navigates to /opportunities/:symbol
  □ If disabled: "Institutional data not available" message shown
□ Collection Changes section visible (data-testid="cmd-collection-changes")
  □ Collection cards shown with opportunity count badge
  □ Clicking card navigates to /research?collection=:id
□ My Collections section visible (data-testid="cmd-my-collections")
  □ Pinned / Favorites / Following / System Highlights groups shown
  □ Empty groups are not rendered (no blank headers)
□ AI Research Summary section visible (data-testid="cmd-ai-research-summary")
  □ Conversation count stats shown when user has conversations
  □ 3 Suggested Research Queries shown with mode/scope
  □ Clicking a query navigates to /research-workspace with mode+scope params
□ Research Timeline section visible (data-testid="cmd-research-timeline")
  □ Last 10 conversations listed with date
  □ Pinned conversations show star icon
  □ Clicking row navigates to /research-workspace?conversation=:id
  □ If no conversations: "Open AI Research Workspace" button shown
□ Explain Why section visible (data-testid="cmd-explain-why")
  □ 6 research query shortcuts shown
  □ Clicking any shortcut navigates to /research-workspace with mode+scope params
  □ "Open AI Research Workspace" button navigates to /research-workspace
□ Page auto-refreshes every 5 minutes (staleTime=2min, refetchInterval=5min)
□ No "recommendation", "buy", or "sell" language visible anywhere
□ On error: error card with AlertCircle icon shown, not a blank page
```

**Platform Health (`/admin/platform-health`):**
```
□ "Market Research Command Center" health card visible under Infrastructure section
□ Before first page visit: status=UNKNOWN, "No snapshot generated yet" message
□ After first page visit: status=HEALTHY, shows sectionsAvailable count
□ If <5 sections available: status=DEGRADED
□ Clicking "Command Center Runbook" links to troubleshooting doc
```

