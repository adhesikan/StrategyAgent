---
name: Institutional Fund Explorer
description: Sprint 2.3.2 — manager-level SEC 13F Fund Explorer; 5 endpoints, 2 pages, 79 pure tests.
---

## Architecture

- **Service:** `server/services/institutional/fund-service.ts`
  - Pure helpers (exported for tests): `isValidManagerId`, `normalizeManagerId`, `dateToQuarterLabel`, `computePortfolioWeight`, `classifyChangeType`, `computeShareChange`, `isMappingReliable`, `computeFilingFreshnessDays`, `buildEdgarManagerUrl`, `buildEdgarFilingUrl`, `FILING_DELAY_DISCLAIMER`.
  - DB queries use raw SQL via `db.execute(sql`...`)` + `sql.raw()` for trusted sort expressions.
  - Amendment handling: filter `is_effective = true` only — no special logic needed; ingestion pipeline handles this upstream.
  - QoQ comparison: full OUTER JOIN between latest and previous effective-filing holdings, partitioned by `filer_cik`.
  - `managerId` = `filerCik` (10-digit zero-padded CIK string).
  - `reportedValue` in DB = USD thousands → multiply by 1000 for USD values in API responses.

- **Routes:** `server/routes/institutional-funds.ts` (5 endpoints)
  - `GET /api/institutional/funds` — paginated directory (search, sort, page)
  - `GET /api/institutional/funds/:managerId` — fund detail + top 20 holdings + QoQ buckets
  - `GET /api/institutional/funds/:managerId/holdings` — paginated holdings with search/sort
  - `GET /api/institutional/funds/:managerId/history` — last 12 quarters
  - `GET /api/institutional/symbols/:symbol/holders` — symbol → fund cross-link (future consumer contract)
  - Registered BEFORE dynamic `/api/institutional/:symbol` route in `server/routes.ts`.
  - `"funds"` and `"symbols"` added to `RESERVED_SEGMENTS` in `server/routes/institutional.ts`.

- **Client pages:**
  - `/institutional/funds` → `InstitutionalFundsPage` — search, sort pills, paginated fund cards, delayed-data banner
  - `/institutional/funds/:managerId` → `InstitutionalFundDetailPage` — sticky header, section nav pills (Overview/Top Holdings/Newly Reported/Increased/Reduced/No Longer Reported/History), holdings tables with inline search and QoQ columns

## Key constraints

- Never double-count superseded amendments — `is_effective = true` is the sole guard.
- `dateToQuarterLabel` must check `isNaN(date.getTime())` — `new Date("invalid")` returns Invalid Date, not an exception.
- `computeFilingFreshnessDays` requires the same NaN guard.
- Sort expressions in SQL use `sql.raw()` with a trusted enum map — never interpolate user input directly.
- `managerId` validation: `/^\d{1,10}$/` then `normalizeManagerId` to 10-digit padded form.

## Compliance vocabulary

- "Newly Reported Position" (not "New Buy")
- "Increased Reported Position" (not "Bought More")
- "Reduced Reported Position" (not "Sold")
- "No Longer Reported" / "Exited Reported Position" (not "Sold Out")
- "Reported Holdings" (not "Best Holdings")
- `FILING_DELAY_DISCLAIMER` must be visible on every page.

**Why:** SEC 13F is delayed public reporting, not real-time positioning data; recommendation language is prohibited.
