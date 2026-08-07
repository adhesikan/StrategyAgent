---
name: Institutional Intelligence MVP
description: Sprint 2.2.5 — SEC 13F ingestion, aggregation, trend classification, and Research Package tab integration.
---

## Architecture

- **Feature flag:** `INSTITUTIONAL_INTELLIGENCE_ENABLED=false` (default). All ingestion and UI data calls are no-ops when false.
- **Advisory lock key:** `774_412_003` (distinct from Opportunity Engine `774_412_002`).
- **SEC User-Agent env var:** `SEC_USER_AGENT` — ingestion is disabled unless this is set (EDGAR rate-limit compliance).
- **Ingestion schedule:** weekly, Sunday nights, via `scheduleInstitutionalIngestion()` in `server/services/institutional/ingestion-service.ts`.
- **API route:** `GET /api/institutional/:symbol` — registered via `registerInstitutionalRoute` from `server/routes/institutional.ts`.

## Database tables (5 new, in shared/schema.ts)

1. `institutional_13f_filings` — one row per accession number
2. `institutional_13f_holdings` — one row per InfoTable holding line; unique on `(accessionNumber, cusip, classTitle, putCall)`
3. `institutional_security_mappings` — CUSIP→ticker; statuses: exact|reviewed|probable|ambiguous|unmapped|rejected
4. `institutional_quarterly_aggregates` — pre-computed per `(symbol, periodOfReport)` — trend, concentration, activity counts
5. `institutional_ingestion_runs` — run tracking with status/counts/error_code

Migration SQL: `scripts/migrate-institutional.sql`

## Key rules

- **No "Institutional Ownership %" label** — denominator (total float shares) is not validated.
- **No predictive terminology** — "accumulation/distribution" must not appear in UI copy.
- **"Reported Holder Concentration"** — not "Total Ownership Concentration".
- **Put/call rows excluded from aggregate shares** — stored for completeness but not counted in totals.
- **PRN rows excluded from aggregate** — same.
- **Unmapped holdings excluded** in production mode (only exact + reviewed mapping statuses count).
- **Single-use `maxHolders` param** capped at 50 in the API route.

## TypeScript gotchas

- All `Map.values()`, `Map.keys()`, `Set` iteration must use `Array.from()` — the server tsconfig targets an older iteration protocol.
- `EvidenceStars.institutional` widened from literal `0` to `0 | 1 | 2 | 3 | 4 | 5`; existing tests that assert `institutional: 0` still pass (0 is valid in the union).
- Trend classifier: after the early-return guard for `coverageStatus === "insufficient"`, TS narrows the type — do NOT re-check `current.coverageStatus === "insufficient"` again in the same function body.
- Config quarter decrement: `q = (q - 1) as ... ` followed by `if (q === 0)` is flagged by TS; use `if (q === 1) { q = 4; year -= 1; } else { q = (q-1) as ... }` instead.

## Test counts (Sprint 2.2.5)

- Server new: 77 (parser.test.ts: 30, aggregation.test.ts: 47)
- Client new: 44 (InstitutionalIntelligence.test.tsx)
- Total project: 3,234 (client 1,546 + server 1,688), 0 failures

## Readiness script

`scripts/audit-institutional-readiness.ts` — run with `npx tsx scripts/audit-institutional-readiness.ts`.
Verdicts: GO | CONDITIONAL_GO | NO_GO based on quarters available, mapping coverage, and ingestion failures.

**Why:**
Without fully validated share count denominators, we cannot report "% ownership". The component deliberately omits ownership percentage and uses "Reported Holder Concentration" language to avoid misleading traders.
