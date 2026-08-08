# 11 — Troubleshooting Runbook

Format: **Symptom → Diagnostic → Likely Cause → Safe Remediation → Verification → Escalation**

---

## RAILWAY BUILD

### "No matching export getLatestRanking" (or similar import mismatch)

**Symptom:** Railway build fails with `SyntaxError: The requested module does not provide an export named 'X'`

**Diagnostic:** Check the import line in the failing file. Check what the module actually exports.

**Likely cause:** Import was pointing to wrong module (e.g., `opportunity-engine.ts` instead of `opportunity-ranking-engine.ts`).

**Remediation:**
1. Find the file with the broken import (check Railway build logs for the file path)
2. grep the actual export: `grep -n "export.*getLatestRanking" server/services/*.ts`
3. Fix import path
4. `npm run build` locally to verify

**Verification:** Railway build passes. No TS errors in changed file.

**Escalation:** If import path is ambiguous, check memory file for `[MCP Sprint-2 tools]` and `[Dashboard real-data API shape]` notes.

---

## RESEARCH HUB

### Permanent skeleton after failed API request

**Classification:** permanent skeleton — UI stuck in loading state, does not transition to error or empty.

**Symptom:** `/research` page shows loading skeleton indefinitely after page load. Network tab shows the API returned an error.

**Diagnostic:** Check browser network tab. Check server logs for the failing API route.

**Likely cause:** Module used `if (!data)` as skeleton guard — this also fires on query error, so the skeleton never transitions to an error state.

**Remediation:** Thread `isPending` and `isError` from the query into the module component. Show skeleton only on `isPending`. Show error card on `isError`. Show "no data" card on settled empty.

**Verification:** Disconnect from DB briefly in dev and confirm error card appears within 10s.

---

## INTELLIGENCE

### "Failed to load intelligence briefing" (HTTP 500)

**Symptom:** `GET /api/intelligence/briefing` returns `{ "error": "Failed to load intelligence briefing" }` — HTTP 500.

**Diagnostic:**
```bash
GET /api/admin/intelligence/diagnostics
```
Check `sectorSnapshots.tableExists`, `themeSnapshots.tableExists`, and `briefing.failureStage`.

**Likely causes:**
1. Tables don't exist (deployment issue) → `tableExists: false`
2. `toISOString()` called on string (production PG driver) → patched in Sprint 2.3.5
3. Query error

**Remediation:**
- Tables missing: run `npx tsx script/migrate.ts` then restart
- toISOString: update to `toIso()` helper (already patched)
- Query error: check server logs for `intelligence_briefing_failed` event with `phase` field

**Verification:** `GET /api/intelligence/briefing` returns HTTP 200 with `hasData: true/false`.

---

## TIMESTAMPS

### `toISOString is not a function`

**Symptom:** Server 500 with error mentioning `toISOString`. Typically in intelligence or opportunity routes.

**Diagnostic:** Check which module the stack trace points to. Look for raw `db.execute()` result being `.toISOString()`-called.

**Likely cause:** `db.execute()` with raw `sql` template returns `TIMESTAMP` columns as strings in production PostgreSQL, not `Date` objects.

**Remediation:** Use the `toIso(v: Date | string | null | undefined)` helper defined in `intelligence-snapshot-store.ts`. Never call `.toISOString()` directly on `db.execute()` result fields.

**Verification:** Test with a row in the DB and confirm the endpoint returns 200.

---

## SECTOR INTELLIGENCE

### Theme snapshots exist but sector snapshots = 0

**Symptom:** `GET /api/intelligence/sectors` returns `count: 0`. `GET /api/intelligence/themes` returns data. Intelligence briefing shows `leadingSectors: []`.

**Diagnostic:**
```
GET /api/admin/intelligence/diagnostics
→ sectorSnapshots.rowCount == 0
→ themeSnapshots.rowCount > 0

GET /api/admin/platform-health
→ health.marketData.details.withSector == 0
```

**Likely cause:** The symbols table (`market_data_symbols`) has no sector classification. The orchestrator reads `WHERE COALESCE(m.sector, s.sector) IS NOT NULL` and gets 0 rows → `symbolSectors = []` → no sector groups → `sectors = []` → no rows written to `sector_intelligence_snapshots`.

Theme intelligence uses `config/theme-registry.ts` (hardcoded) — unaffected.

**Root cause detail:** The `symbols table` (legacy `symbols`) was empty; the orchestrator was previously querying only that table. Fixed in Sprint 2.3.6 to LEFT JOIN `market_data_symbols` (active symbol universe). If the `symbols table` and `market_data_symbols` both lack sector data, enrichment must be run.

**Remediation:**
1. `POST /api/admin/symbols/enrich` — populates `market_data_symbols.sector` via Twelve Data `/profile`
2. `POST /api/admin/intelligence/rebuild` — recomputes snapshots from latest ranking

**Verification:**
```
GET /api/admin/intelligence/diagnostics
→ sectorSnapshots.rowCount > 0
```

**Escalation:** If Twelve Data is not configured, sector enrichment will be skipped. A manual sector classification may be needed.

---

## 13F PIPELINE

### Required headers missing

**Symptom:** Parser fails with "Required headers missing" or similar column error.

**Diagnostic:** Check server logs. Print the first line of the TSV being parsed.

**Likely cause:** SEC field names changed (historical: `VOTINGAUTHORITY_*` → `VOTING_AUTH_*`). Or parser is reading wrong file (company.idx instead of SUBMISSION.tsv).

**Remediation:** The parser normalizes headers. If a new field name appears, add it to the normalizer map in `sec-13f-bulk-parser.ts`.

---

### Manager name missing from SUBMISSION

**Symptom:** `FILINGMANAGER_NAME` is blank/null in ingested filings.

**Likely cause:** `FILINGMANAGER_NAME` is in `COVERPAGE.tsv`, not `SUBMISSION.tsv`. The parser must do a three-table join.

**Remediation:** Ensure the parser reads and joins `COVERPAGE.tsv`. See `institutional-coverpage-join.md` in memory.

---

### NO_HOLDINGS_BEARING_SUBMISSIONS

**Symptom:** Ingestion completes with 0 holdings despite filing count > 0.

**Likely cause:** All filings are `13F-NT` (notice type) — these don't include holdings. Or holdings are in an amendment (`13F-HR/A`) that wasn't matched to an original.

**Remediation:** Check filing submission types in ingested data. Verify amendment logic correctly links HR/A to HR.

---

### PERIODOFREPORT unsupported / DD-MMM-YYYY format

**Symptom:** Date parsing fails for period-of-report field.

**Likely cause:** SEC uses `DD-MMM-YYYY` format (e.g., `31-MAR-2026`) — not ISO 8601.

**Remediation:** The parser uses a date normalizer that handles `DD-MMM-YYYY`. If a new format appears, add it to the normalizer.

---

### Long-running persistence / timeout

**Symptom:** Ingestion job runs for many minutes/hours and may be terminated by Railway.

**Likely cause:** Large number of filings (thousands). Each filing writes to PostgreSQL.

**Remediation:** Ingestion is designed to be resumed. After Railway terminates the job:
1. Status shows `partial` or `running` (stale)
2. Re-trigger ingestion
3. Already-processed filings are skipped (idempotent)
4. Use `--force` flag only if full re-ingest is explicitly required

---

### Stale "running" run after process dies

**Symptom:** `institutional_ingestion_runs` shows `status = 'running'` but no job is active.

**Diagnosis:** Process was killed without cleanup (e.g., Railway restart during ingestion).

**Remediation:** Use admin API to mark the run as partial:
```sql
-- Via admin endpoint or Railway SQL tool:
UPDATE institutional_ingestion_runs SET status = 'partial' WHERE status = 'running';
```
Then re-trigger ingestion.

---

### Railway shell closure terminates interactive job

**Symptom:** Started 13F ingestion via Railway shell. Shell session closed. Job stopped.

**Likely cause:** The Railway application shell is interactive — it's not `nohup`. When the shell closes, the process terminates.

**Remediation:** Use the admin API endpoint instead of the shell. The server's background job scheduler runs independently of any shell session.

---

## MAPPINGS

### Mapping page 404

**Symptom:** `/admin/institutional-mappings` returns 404.

**Likely cause:** Route registered incorrectly or not registered at all.

**Verification:** Check `registerInstitutionalMappingRoutes` is called in `routes.ts`.

---

### Route collision: `/api/institutional/:symbol`

**Classification:** route collision — dynamic Express route shadows a static route registered after it.

**Symptom:** Static routes like `/api/institutional/mappings` or `/api/institutional/signals` return data for the dynamic `:symbol` handler instead of the intended route.

**Likely cause:** Dynamic `:symbol` route registered before static routes.

**Remediation:** In `routes.ts`, static institutional routes MUST be registered before `registerInstitutionalRoute(app, ...)` (the dynamic one). This order is enforced by comments in the file.

---

### Pipeline returns empty / FIGI missing

**Symptom:** Mapping pipeline runs but produces no matches. FIGI field is null.

**Likely cause:** OpenFIGI lookup failed or rate-limited. Or no holdings ingested yet.

**Remediation:** Run 13F ingestion first. Check OpenFIGI API availability.

---

## VALUE

### Fund portfolio values 1000× too large

**Symptom:** Institutional fund holdings show values like "$2.4 billion" when actual position is "$2.4 million".

**Likely cause:** Code multiplying SEC VALUE by 1000. Post-2023 SEC VALUE is already in USD dollars.

**Remediation:** Remove `* 1000` from fund-service. DO NOT re-add it. See [06-institutional-13f-pipeline.md](06-institutional-13f-pipeline.md) VALUE Unit Policy.

**Verification:** Compare displayed value against SEC EDGAR filing directly.

---

## MCP

### 401 Missing bearer token

**Symptom:** MCP returns HTTP 401. Server logs show `401` from MCP endpoint.

**Likely cause:** `MCP_SERVICE_TOKEN` not set or wrong.

**Remediation:** Set correct `MCP_SERVICE_TOKEN` environment variable.

---

### Mock provider unexpectedly active

**Classification:** mock provider active when live data is expected.

**Symptom:** Market data responses include `source: "mock"`. Prices are clearly not real.

**Likely cause:** `MCP_ENABLED` is not `true`, or MCP is enabled but provider falls back to mock (e.g., Twelve Data quota exhausted).

**Remediation:**
1. Set `MCP_ENABLED=true`
2. Check Twelve Data credit balance
3. Check MCP logs for provider fallback events

---

## DATABASE

### psql not found in Railway shell

**Symptom:** `psql $DATABASE_URL` in Railway shell returns `command not found`.

**Likely cause:** Railway's application runtime does not include `psql`.

**Remediation:** Use a PostgreSQL client on your local machine. Connect using the `DATABASE_URL` from Railway environment variables. Or use the Railway "Query" tab if available.
