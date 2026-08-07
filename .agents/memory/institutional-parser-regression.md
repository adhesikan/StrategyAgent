---
name: Institutional 13F Parser Regression Fix
description: Root cause and fix for zero-filing ingestion bug — company.idx is fixed-width, not pipe-delimited; replaced with SEC bulk ZIP dataset (SUBMISSION.tsv + INFOTABLE.tsv).
---

## Root Cause

`parseQuarterlyIndex()` in `sec-client.ts` checks:
```ts
const parts = line.includes("|") ? line.split("|") : null;
if (!parts || parts.length < 5) continue;
```

The SEC EDGAR `company.idx` file is **fixed-width text** (not pipe-delimited). Every line returns `parts = null` → `entries = []` → `totalFilings = 0`. The ~5.5 MB download was the real company.idx file — the data was present, the delimiter assumption was wrong.

## Fix

Replaced the per-filing XML approach (company.idx → individual XML fetch per filer) with the SEC Form 13F **bulk dataset ZIP**:

URL: `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/{YYYY}q{N}_form13f.zip`

Archive structure (uppercase .TSV entries):
- `{YYYY}Q{N}_SUBMISSION.TSV` — one row per 13F-HR / 13F-HR/A filer
- `{YYYY}Q{N}_INFOTABLE.TSV` — one row per InfoTable holding
- `adm-zip` (already in package.json) is used to extract

## Key format facts (actual SEC archive)
- Tab-delimited (not comma-separated)
- May begin with UTF-8 BOM (0xEF 0xBB 0xBF)
- CRLF or LF line endings
- Entry names are UPPERCASE (e.g. `2026Q1_SUBMISSION.TSV`) — matching is case-insensitive
- Accession numbers in SUBMISSION and INFOTABLE are dashed format: `XXXXXXXXXX-YY-ZZZZZZ`
- SUBMISSION column `CONFORMED-PERIOD-OF-REPORT` → period of report (YYYY-MM-DD)
- SUBMISSION column `FORM-TYPE` → "13F-HR" or "13F-HR/A"
- INFOTABLE `PUTCALL` → empty string (common stock), "Call", "Put"
- INFOTABLE `SSHPRNAMTTYPE` → "SH" (shares) or "PRN" (principal amount)

## Empty-quarter result states (new)
- `success` — filingCount > 0, holdingCount > 0
- `partial_success` — some rows rejected
- `empty_not_published` — HTTP 404 from SEC (quarter not yet released)
- `empty_parse_failure` — archive downloaded but 0 13F-HR filings parsed
- `failed` — network/ZIP error

**Why:** `EMPTY_NOT_PUBLISHED` is NOT a failure — retry later. `EMPTY_PARSE_FAILURE` IS a failure — must exit CLI non-zero.

## Quarter selection fix (backfill CLI)
`--quarters N` now probes SEC availability and skips unpublished quarters before selecting N. Uses `selectAvailableQuarters(n, today, probe)` which is injectable for testing.

## Key files
- `server/services/institutional/sec-13f-bulk-parser.ts` — NEW: bulk ZIP/TSV parser, all exported for testing
- `server/services/institutional/ingestion-service.ts` — ingestOneFiling removed, ingestQuarter replaced
- `scripts/run-institutional-backfill.ts` — quarter selection probes availability, "partial" exits non-zero

## Database remediation for prior empty runs

Prior failed runs were marked status="partial" with filing_count=0. Safe remediation SQL:
```sql
-- Inspect
SELECT id, quarter, status, filing_count, holding_count, created_at
FROM institutional_ingestion_runs
WHERE status = 'partial' AND filing_count = 0 AND holding_count = 0;

-- Reclassify (adjust WHERE as needed)
UPDATE institutional_ingestion_runs
SET status = 'empty_parse_failure',
    error_code = 'EMPTY_PARSE_FAILURE_RETROACTIVE',
    error_summary = 'Retroactively reclassified: zero filings parsed due to fixed-width parser bug'
WHERE status = 'partial' AND filing_count = 0 AND holding_count = 0;
```

The uniqueness constraint on institutional_ingestion_runs does NOT block a new corrected run — it creates a new row for the same quarter (multiple run history is preserved).

**Why:** The original code reported "Quarters succeeded: 2" with filingCount=0 and holdingCount=0 for both quarters. This was silently wrong. New policy: EMPTY_PARSE_FAILURE exits non-zero and marks the run status="failed".
