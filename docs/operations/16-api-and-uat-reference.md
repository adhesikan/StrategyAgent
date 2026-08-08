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
