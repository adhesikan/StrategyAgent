---
name: Institutional Intelligence MVP
description: Sprint 2.2.5 + activation tooling — 5 DB tables, SEC 13F ingestion, aggregation/trend/evidence, Research Package tab + workspace compact; lock key 774_412_003; INSTITUTIONAL_INTELLIGENCE_ENABLED=false default; ingestion gate is independent of UI gate.
---

## Architecture

- **Feature flag (UI):** `INSTITUTIONAL_INTELLIGENCE_ENABLED=false` (default). Controls only the public API/tab. Does NOT gate ingestion.
- **Ingestion gate (separate):** `INSTITUTIONAL_13F_INGESTION_ENABLED=true` (default) + `SEC_USER_AGENT` set. Ingestion runs when both are true regardless of the UI flag.
- **isIngestionConfigured():** `ingestionEnabled && secUserAgent !== null` — no UI flag dependency.
- **Advisory lock key:** `774_412_003` (distinct from Opportunity Engine `774_412_002`).
- **SEC User-Agent env var:** `SEC_USER_AGENT` — ingestion is hard-blocked unless this is set (EDGAR fair-access).
- **Ingestion schedule:** weekly, via `scheduleInstitutionalIngestion()` in `server/services/institutional/ingestion-service.ts`.
- **API route:** `GET /api/institutional/:symbol` — `registerInstitutionalRoute` from `server/routes/institutional.ts`.
- **Admin routes:** `POST /api/admin/institutional/run` + `GET /api/admin/institutional/status` — `registerInstitutionalAdminRoutes` in `server/routes/institutional-admin.ts`.

## Database tables (5 new, in shared/schema.ts)

1. `institutional_13f_filings` — one row per accession number
2. `institutional_13f_holdings` — one row per InfoTable holding line; unique on `(accessionNumber, cusip, classTitle, putCall)`
3. `institutional_security_mappings` — CUSIP→ticker; statuses: exact|reviewed|probable|ambiguous|unmapped|rejected
4. `institutional_quarterly_aggregates` — pre-computed per `(symbol, periodOfReport)` — trend, concentration, activity counts
5. `institutional_ingestion_runs` — run tracking with status/counts/error_code

Migration SQL: `scripts/migrate-institutional.sql` (idempotent, `IF NOT EXISTS`)

## Key rules

- **No "Institutional Ownership %" label** — denominator (total float shares) is not validated.
- **No predictive terminology** — "accumulation/distribution" must not appear in UI copy.
- **"Reported Holder Concentration"** — not "Total Ownership Concentration".
- **Put/call rows excluded from aggregate shares** — stored for completeness but not counted in totals.
- **PRN rows excluded from aggregate** — same.
- **Unmapped holdings excluded** in production mode (only exact + reviewed mapping statuses count).
- **COST CUSIP:** `22160K105` — must be seeded as a manual_reviewed mapping before COST analytics display.
- **ambiguous/probable mappings are rejected** by the seed script — they must not feed production aggregates.

## TypeScript gotchas

- All `Map.values()`, `Map.keys()`, `Set` iteration must use `Array.from()` — the server tsconfig targets an older iteration protocol.
- `EvidenceStars.institutional` widened from literal `0` to `0 | 2 | 3 | 4 | 5`; 0 is valid in the union.
- Trend classifier: after the early-return guard for `coverageStatus === "insufficient"`, TS narrows the type — do NOT re-check it again.
- Config quarter decrement: use `if (q === 1) { q = 4; year -= 1; } else { q = (q-1) as ... }` pattern.
- Script files imported by tests must guard `main()` with `if (!process.env.VITEST)` to prevent auto-execution.

## Operational scripts

- `scripts/run-institutional-backfill.ts` — CLI backfill; supports `--quarters N`, `--quarter YYYYQN`, `--dry-run`
- `scripts/seed-institutional-mappings.ts` — reviewed mapping seed; supports `--file` or `--cusip/--ticker/--issuer`; rejects probable/ambiguous
- `scripts/audit-institutional-readiness.ts` — full readiness audit; works while UI disabled; schema preflight; GO/CONDITIONAL_GO/NO_GO
- `parseQuarterLabel()` in `config.ts` — parses "2026-Q2" or "2026Q2" CLI shorthands; returns null for invalid input.
- `runInstitutionalIngestion()` accepts `specificQuarterLabels?: string[]` to target exact quarters.

## Correct activation sequence

1. Deploy (SEC link fix + script additions)
2. Keep `INSTITUTIONAL_INTELLIGENCE_ENABLED=false`
3. `psql "$DATABASE_URL" -f scripts/migrate-institutional.sql`
4. Set `SEC_USER_AGENT="VCP Trader AI <owned-contact-email>"` on Railway
5. Set `INSTITUTIONAL_13F_INGESTION_ENABLED=true` on Railway
6. `npx tsx scripts/run-institutional-backfill.ts --quarters 2`
7. `npx tsx scripts/seed-institutional-mappings.ts --cusip 22160K105 --ticker COST --issuer "Costco Wholesale Corporation"`
8. `npx tsx scripts/audit-institutional-readiness.ts`
9. When GO or CONDITIONAL_GO: set `INSTITUTIONAL_INTELLIGENCE_ENABLED=true`, restart
10. Run production UAT

## Rollback

Set `INSTITUTIONAL_INTELLIGENCE_ENABLED=false` on Railway — takes effect on next request with no code deploy.

**Why:**
The original `isIngestionConfigured()` required `cfg.enabled`, creating a contradiction: data couldn't be prepared before the UI was enabled, but the UI shouldn't be enabled before data is ready. Separating the gates resolves this cleanly.
