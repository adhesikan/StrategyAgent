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

## PORTFOLIO DOCUMENT INTAKE

### "No holdings detected in the screenshot"

**Symptom:** `POST /api/portfolio/import/image` returns HTTP 422 with `"No holdings detected in the screenshot."`

**Diagnostic:**
1. Was the screenshot of the holdings/positions table?
2. Does the screenshot include column headers (Symbol, Quantity, etc.)?
3. Is the image resolution sufficient (≥800px wide)?

**Likely causes:**
- Screenshot only shows charts, account summary, or cash balance (no positions table)
- Very low resolution or heavy compression artifacts
- Screenshot shows a loading state or empty portfolio

**Remediation:**
1. Re-capture the screenshot showing the full holdings table
2. Ensure column headers are visible in the screenshot
3. Try a higher resolution PNG instead of compressed JPEG

**Verification:** Re-upload; response should include `validRows ≥ 1` and `normalizedPositions` with at least one entry.

---

### "No holdings detected in the PDF" / "Could not parse this PDF"

**Symptom:** `POST /api/portfolio/import/pdf` returns HTTP 422.

**Diagnostic:**
1. Is the PDF a native/text-based PDF (vs. a scanned image PDF)?
2. Does the PDF contain embedded text? Open in a text editor and copy-paste — if no text copies, it is a scanned PDF.
3. Does the PDF exceed 50 pages or 15 MB?

**Likely causes:**
- **Scanned PDF** (image-only, no embedded text) — `pdf-parse` returns <100 characters of text
- Corrupted PDF or encrypted PDF with access restrictions
- File exceeds size/page limits

**Remediation for scanned PDFs:**
1. Take a screenshot of the holdings table from the PDF viewer
2. Upload the screenshot via the Screenshot Import path instead

**Remediation for text PDFs with no detection:**
1. Check the extracted text: enable debug logging temporarily to see what text was passed to AI
2. Verify the PDF has a recognizable holdings table section with ticker symbols and quantities

**Verification:** Re-upload a native PDF; response should include detected positions.

---

### Low-confidence extraction — fields showing "Needs review"

**Symptom:** Preview shows yellow "Needs review" badges on many fields.

**Diagnostic:** Check the `metadata.lowConfidenceCount` field in the API response.

**Likely causes:**
- Poor screenshot quality (low resolution, glare, partial crop)
- Non-standard broker UI that AI has not seen before
- Column headers not visible in the image

**Remediation:**
1. User reviews and corrects all medium/low confidence values before confirming
2. Or: re-upload a higher quality screenshot
3. Or: export from broker as CSV/XLSX instead

**Verification:** User manually edits questionable values in the preview table and confirms.

---

### AI extraction failure / "Extraction failed"

**Symptom:** `POST /api/portfolio/import/image` or `/pdf` returns HTTP 502 or 503.

**Diagnostic:**
1. Is `OPENAI_API_KEY` set in the environment?
2. Is the OpenAI API returning errors? Check platform health dashboard.

**Likely causes:**
- `OPENAI_API_KEY` not configured → 503 "provider unavailable"
- OpenAI API quota exhausted → 503
- Network timeout to OpenAI API → 502

**Remediation:**
1. Verify `OPENAI_API_KEY` in Railway variables (production) or Replit Secrets (dev)
2. Check OpenAI API status at status.openai.com
3. If quota, check OpenAI usage dashboard

**Verification:** Platform Health dashboard → "Portfolio Document Extraction" shows Healthy after key is restored.

---

### Preview expired or "belongs to a different user"

**Symptom:** `POST /api/portfolio/import/confirm` returns 400 "Preview not found, expired, or belongs to a different user."

**Likely causes:**
- Preview TTL (30 minutes) elapsed between extraction and confirm
- User tried to confirm from a different session/tab
- Preview already consumed (single-use — can only be confirmed once)

**Remediation:**
1. Re-upload the file to generate a fresh preview
2. Complete the confirm step within 30 minutes of extraction

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

---

## PORTFOLIO IMPORT

### CSV import fails with "CSV parse error"

**Classification:** csv parse error — file encoding or delimiter issue.

**Symptom:** `POST /api/portfolio/import/csv` returns 400 with `"CSV parse error: ..."`.

**Diagnostic:** Check file encoding (must be UTF-8). Check that the file has a header row as row 1.

**Likely cause:** File is UTF-16/BOM-encoded, uses semicolons (European CSV), or has no header row.

**Remediation:**
1. Ask user to open in Excel and re-save as "CSV UTF-8 (comma delimited)"
2. Verify the file has a first row with column names (Ticker, Symbol, Shares, etc.)
3. Check that the file is under 5 MB

**Verification:** `POST /api/portfolio/import/csv` returns `previewId` and `normalizedPositions`.

---

### XLSX import fails with "XLSX parse error"

**Classification:** xlsx parse error — corrupted or password-protected file.

**Symptom:** `POST /api/portfolio/import/xlsx` returns 400 with `"XLSX parse error: ..."`.

**Diagnostic:** Try opening the file in Excel. Check if password-protected.

**Likely cause:** File is corrupt, password-protected, or is an XLSb/XLSM macro file.

**Remediation:**
1. Ask user to re-save as `.xlsx` (not `.xlsm`, `.xlsb`, or `.xls` macro format)
2. Remove password protection before uploading
3. If only one sheet is needed, export that sheet as CSV

**Verification:** `POST /api/portfolio/import/xlsx` returns `previewId` and `sheetInfo`.

---

### CSV headers not recognized — all rows invalid

**Classification:** invalid headers — no column matched any known synonym.

**Symptom:** Import preview returns `validRows: 0`, `invalidRows: N` with reason "Missing or invalid ticker symbol".

**Diagnostic:** Check the header row. Log `parsedRows` vs `invalidRows`.

**Likely cause:** Broker export uses proprietary column names not in the synonym list.

**Remediation:**
1. User should rename columns in the file before upload: `Symbol` (or `Ticker`), `Shares` (or `Quantity`), `Average Cost` (or `Avg Cost`)
2. Supported headers are documented at `/portfolio/import` UI
3. If a new synonym is needed permanently, add it to `SYMBOL_HEADERS` / `QUANTITY_HEADERS` / `AVG_COST_HEADERS` in `server/services/portfolio-normalization.ts`

**Verification:** Re-upload with corrected headers. `validRows > 0`.

---

### Partial import — some rows skipped

**Classification:** partial import — mixed valid/invalid rows.

**Symptom:** `invalidRows` count > 0. Some symbols appear in the rejected list.

**Diagnostic:** Inspect `invalidRows[].reason` in the preview response.

**Likely cause:**
- Row has quantity = 0 or negative (short position not yet supported)
- Symbol field blank or contains non-symbol characters
- Numeric field has text like "N/A" or "—"

**Remediation:** User can remove or fix the offending rows in the preview UI before confirming.

**Verification:** Preview shows `invalidRows: []` after user edits.

---

### Cross-user access denial — 400 "Preview not found"

**Classification:** cross-user access denial — correct behavior, not a bug.

**Symptom:** `POST /api/portfolio/import/confirm` returns 400 "Preview not found, expired, or belongs to a different user".

**Likely cause:**
1. User session changed between upload and confirm (re-login, different browser tab)
2. Preview expired (TTL = 30 minutes)
3. Confirm was called twice (preview is single-use)

**Remediation:** User must re-upload the file to get a fresh preview ID.

**Verification:** Upload again, confirm within 30 minutes using the same session.

---

### Railway build: tsx not found after npm ci

**Classification:** production build failure — dependency misconfiguration.

**Symptom:** Railway/Nixpacks build log shows `npm ci` failing with a 403 blocked-by-security-policy error, followed by `sh: 1: tsx: not found` and build exit code 127.

**Actual npm ci root cause:** Two compounding issues:
1. `package-lock.json` entries for recently-installed packages (`multer`, `xlsx`, `@types/multer`) resolved to `http://package-firewall.replit.local/npm/...` — the Replit-internal npm proxy, which is unreachable from Railway's build environment.
2. A stale `protobufjs@8.0.0` entry remained in the lockfile root (not in `package.json`). That version is blocked by Replit's socket security policy (Critical CVE). Railway's Nixpacks routes all npm downloads through the Replit firewall proxy, so even a correctly-resolved `registry.npmjs.org` URL is checked against the policy.

**Why tsx was missing:** `tsx` was declared in `devDependencies`, not `dependencies`. The Railway start command (`npx tsx script/migrate.ts && npm run start`) runs at container startup, where devDependencies may not be present in all deployment configurations.

**Remediation:**
1. Rewrite all `http://package-firewall.replit.local/npm/` URLs in `package-lock.json` to `https://registry.npmjs.org/` using sed.
2. Upgrade the blocked `protobufjs` entry in the lockfile from `8.0.0` to `8.7.2` (latest, no CVE) — update `version`, `resolved`, and `integrity` fields directly in `packages["node_modules/protobufjs"]`.
3. Remove `protobufjs` from `packages[""].dependencies` in the lockfile (it is a stale artifact; it is not listed in `package.json`).
4. Move `tsx` from `devDependencies` to `dependencies` in `package.json`. Remove the `"dev": true` flag from `packages["node_modules/tsx"]` in the lockfile.

**Validation:**
```bash
rm -rf node_modules
npm ci            # must exit 0
npm run build     # must exit 0, "built in Xs"
ls node_modules/.bin/tsx  # must exist (production dep)
```

**Railway startup verification:** `startCommand = "npx tsx script/migrate.ts && npm run start"` is viable once tsx is in `dependencies`.

**Prevention:** After any `npm install` inside the Replit workspace, scan `package-lock.json` for `package-firewall.replit.local` entries before committing:
```bash
grep -c "package-firewall.replit.local" package-lock.json
# must be 0
```

---

### Portfolio positions return stale market prices

**Classification:** stale stored bars — no realtime data available.

**Symptom:** `currentPrice` in position list shows a price that is days old.

**Likely cause:** `getReferenceSnapshotsBulk` uses stored daily bars (`allowExternalRefresh: false`). Prices update via the nightly market data ingestion job, not on-demand.

**Remediation:** This is expected behavior. Prices are updated nightly. If the daily ingestion job is failing, check `/admin/platform-health` → Market Data card.

**Note:** Portfolio does NOT call Twelve Data on-demand — this is by design (data policy).


---

## BROKER SYNCHRONIZATION (Sprint 2.4.2)

### BROKER_SYNC_OAUTH_NOT_CONNECTED

**Symptom:** `POST /api/portfolio/broker/connect` returns 400 with `requiresAuth: true`.

**Cause:** User has not completed OAuth for the requested broker, or the connection was revoked.

**Fix:** Navigate user to `/settings?tab=broker` to complete the OAuth flow, then retry connect.

---

### BROKER_SYNC_DUPLICATE_PORTFOLIO

**Symptom:** `POST /api/portfolio/broker/connect` returns 409 `"A portfolio linked to tradier already exists"`.

**Fix:** Use the existing portfolio shown on `/portfolio/connect`. Disconnect first if re-linking is required.

---

### BROKER_SYNC_RUNNING_409

**Symptom:** `POST /api/portfolio/broker/sync/:portfolioId` returns 409.

**Cause:** Concurrent sync already running. Expected behavior — poll status and retry.

---

### BROKER_SYNC_FAILED

**Symptom:** Sync state `status: "failed"`. Structured log shows `broker_sync_failed` event.

**Diagnostic steps:**
1. `GET /api/portfolio/broker/sync/:portfolioId/status` → `sync.lastError`
2. Check logs for `broker_sync_failed` JSON event
3. `GET /api/broker/ping` to verify broker connectivity
4. If `needsReauth: true` → see BROKER_SYNC_NEEDS_REAUTH

---

### BROKER_SYNC_NEEDS_REAUTH

**Symptom:** Sync state `status: "needs_reauth"`. Client shows "Reconnection required" banner.

**Fix:** User re-authenticates via `/settings?tab=broker`, then retries sync.

---

### BROKER_SYNC_EMPTY_HOLDINGS

**Symptom:** Sync completes with `importedCount: 0`.

**Causes:** Account has no open positions; wrong account selected; broker API returned empty array.

**Diagnostic:** Check `GET /api/broker/status` for accountId; verify positions in broker's UI.

---

### BROKER_SYNC_HEALTH_DEGRADED

**Symptom:** Platform Health `Broker Sync` card shows `DEGRADED`.

**Fix:** Expand details on `/admin/platform-health`; check `failedCount`/`needsReauthCount`; resolve affected portfolios.

---

## OPPORTUNITY INTELLIGENCE ENGINE (Sprint 2.5.0)

### OPP_INTEL_NO_SNAPSHOT

**Symptom:** `GET /api/intelligence/opportunities` returns `{ "available": false }`. Platform Health shows Opportunity Intelligence as `UNKNOWN`.

**Cause:** No ranking snapshot has been generated yet (scanner has not run).

**Fix:** Wait for the opportunity scanner to complete its first cycle. Check `/admin/platform-health` → Scanner card. If the scanner is not running, check the `Start application` workflow logs.

---

### OPP_INTEL_EMPTY_AFTER_FILTER

**Symptom:** `GET /api/intelligence/opportunities?sector=Energy` returns `filteredCount: 0` even though opportunities exist.

**Cause:** No opportunities in the current snapshot match the applied filter.

**Fix:** Check `GET /api/intelligence/opportunities/meta` to see the available filter values for the current snapshot. Remove or adjust filters.

---

### OPP_INTEL_SYMBOL_NOT_FOUND

**Symptom:** `GET /api/intelligence/opportunities/:symbol` returns 404 with message "not a current research candidate".

**Cause:** Symbol is not in the current ranking snapshot (may have been excluded by scanner, or not scanned yet).

**Fix:** Check `GET /api/intelligence/opportunities` (no filters) to see what symbols are currently ranked. The snapshot refreshes on the scanner's schedule (default every 240 minutes).

---

### OPP_INTEL_COMPANY_META_NULL

**Symptom:** `companyName`, `sector`, `industry` are `null` for a symbol.

**Cause:** Symbol is not yet in the `market_data_symbols` table (not yet ingested by the daily market data pipeline).

**Fix:** Wait for the next daily ingestion run. Check Platform Health → Market Data card. The enrichment is non-fatal — opportunities are still returned without metadata.

---

### OPP_INTEL_HEALTH_DEGRADED

**Symptom:** Platform Health shows Opportunity Intelligence as `DEGRADED`.

**Cause:** Snapshot exists but contains zero opportunities.

**Fix:** Check the scanner and ranking engine. Verify `GET /api/opportunities/latest` has a valid snapshot with qualified candidates.

---

## RESEARCH COLLECTIONS (Sprint 2.5.1)

### COLL_SEED_NOT_COMPLETE

**Symptom:** Platform Health → Research Collections card shows `DEGRADED` with "System collections not yet seeded". `systemCollectionCount < 25`.

**Cause:** `seedSystemCollections()` has not run yet or failed silently.

**Fix:** Check server startup logs for `collection_seed_started` and `collection_seed_complete` events. If absent, restart the application — seeding runs automatically on startup. Check for DB connectivity issues if seeding fails repeatedly.

---

### COLL_NOT_FOUND

**Symptom:** `GET /api/collections/:id` returns 404.

**Cause:** Collection ID does not exist, or user is attempting to access another user's private collection.

**Fix:** Verify the collection ID via `GET /api/collections`. User collections are only visible to their owner. System collections are visible to all authenticated users.

---

### COLL_SYMBOL_DUPLICATE

**Symptom:** `POST /api/collections/:id/symbols` returns `{ alreadyExists: true }`.

**Cause:** The symbol is already in the collection. Expected behavior — not an error.

**Fix:** No action needed. The response includes `alreadyExists: true` as an informational signal for the client.

---

### COLL_SYSTEM_EMPTY

**Symptom:** `GET /api/collections/:id` for a system collection returns `opportunityCount: 0` and empty `opportunities[]`.

**Cause:** The Opportunity Intelligence Engine has no snapshot yet, OR no ranked candidates match the system collection's filter (e.g., no energy sector stocks currently ranked).

**Fix:** Check Platform Health → Opportunity Intelligence card. If no snapshot is available, wait for the next scanner cycle. If snapshot exists but the collection is empty, the current ranked candidates simply don't match the collection's filter criteria.

---

### COLL_ACCESS_DENIED

**Symptom:** `PATCH /api/collections/:id` or `DELETE /api/collections/:id` returns 404 for a collection the user owns.

**Cause:** System collections cannot be updated or deleted (they are read-only). Only user collections support mutations.

**Fix:** Only apply PATCH/DELETE to user-created collections (those with `collectionType: "user"`).

---

## AI RESEARCH WORKSPACE (Sprint 2.5.2)

### WS_OPENAI_NOT_CONFIGURED

**Symptom:** Platform Health → Research Workspace shows `DEGRADED` with "OpenAI key not configured". All `/api/research/ask` responses return `source: "rule_based"`.

**Cause:** `OPENAI_API_KEY` environment secret is not set.

**Fix:** Set the `OPENAI_API_KEY` secret via the Replit Secrets manager. No restart required — the key is read per-request.

---

### WS_CONTEXT_ASSEMBLY_FAILED

**Symptom:** Platform Health → Research Workspace shows `DEGRADED` with "context assembly unavailable". AI responses are rule-based only.

**Cause:** `getOpportunityIntelligence()` returned null — either no scanner snapshot exists yet, or the Opportunity Engine had an error.

**Fix:** Check Platform Health → Opportunity Engine card. If the scanner has never run, wait for the first scheduled cycle. Check logs for `opportunity_engine` errors.

---

### WS_CONVERSATION_NOT_FOUND

**Symptom:** `POST /api/research/ask` returns 404 when `conversationId` is supplied.

**Cause:** The conversationId does not belong to the current user, or was deleted.

**Fix:** Omit `conversationId` to start a new conversation. If the conversation was deleted, it cannot be recovered.

---

### WS_EMPTY_SCOPE

**Symptom:** Research response includes `diagnostics` object with `candidatesQualified: 0`. User sees "No qualifying candidates in [scope]" response.

**Cause:** The selected context scope (e.g. "AI Infrastructure") has no ranked candidates matching the filter in the current Opportunity Engine snapshot.

**Fix:** This is expected behavior when the scope filter is too narrow or the scanner has not yet produced candidates in that theme/sector/type. Suggest user: 1) Switch scope to "Entire Market", 2) Wait for next scanner cycle, 3) Check Platform Health → Opportunity Engine for snapshot age.

---

### WS_PARSE_FAILURE

**Symptom:** AI response is clearly not well-structured — missing key fields, generic content.

**Cause:** OpenAI returned a response that could not be parsed as valid JSON matching the WorkspaceAIResponse schema. The system fell back to `buildRuleBasedWorkspaceResponse()`.

**Fix:** This is a graceful fallback — no data is lost or invented. The rule-based response is deterministic. If recurring, check OpenAI API logs for response quality issues. Consider increasing `temperature: 0` for stricter JSON compliance.
