# 06 — Institutional 13F Pipeline

## Overview

SEC Form 13F is a quarterly filing required of institutional investment managers with ≥$100M AUM. The pipeline downloads, parses, and persists these filings to power the Institutional Intelligence features.

---

## SEC Dataset Catalog

Post-2023, the SEC provides bulk 13F data as date-range ZIP files:

```
https://efts.sec.gov/LATEST/search-index?q=%2213F%22&dateRange=custom&startdt=YYYY-MM-DD&enddt=YYYY-MM-DD&...
```

The catalog fetches the official SEC EDGAR search index to find the current ZIP URL. **The old `YYYYqN` URL scheme returns 404 for 2023+ data.**

### Files Inside Each ZIP
| File | Purpose |
|------|---------|
| `SUBMISSION.tsv` | Filing metadata (accession number, type, period) |
| `COVERPAGE.tsv` | Manager name, voting authority |
| `INFOTABLE.tsv` | Holdings: issuer, CUSIP, value, shares |

---

## Field Formats (Current as of 2025–2026)

### SUBMISSION.tsv key fields
| Field | Format | Notes |
|-------|--------|-------|
| `ACCESSION_NUMBER` | `0001234567-23-000001` | Filing identifier |
| `SUBMISSIONTYPE` | `13F-HR`, `13F-HR/A`, `13F-NT`, `13F-NT/A` | HR = holdings report |
| `PERIODOFREPORT` | `DD-MMM-YYYY` e.g. `31-MAR-2026` | End of reporting quarter |

### COVERPAGE.tsv key fields (three-table join required)
| Field | Notes |
|-------|-------|
| `FILINGMANAGER_NAME` | Manager name — NOT in SUBMISSION.tsv |
| `VOTING_AUTH_SOLE` | Sole voting authority shares |
| `VOTING_AUTH_SHARED` | Shared voting authority shares |
| `VOTING_AUTH_NONE` | No voting authority shares |

### INFOTABLE.tsv key fields
| Field | Notes |
|-------|-------|
| `NAMEOFISSUER` | Company name |
| `CUSIP` | 9-digit security identifier |
| `VALUE` | **Post-2023: US dollars** (not thousands) |
| `SSHPRNAMT` | Shares count |
| `SSHPRNAMTTYPE` | Share type (SH = shares, PRN = principal) |

---

## VALUE Unit Policy

> **Post-2023 SEC INFOTABLE VALUE = US dollars**

The canonical internal unit for `reported_value` in `institutional_holdings` is **USD dollars**. The fund-service layer must **NOT** multiply by 1000.

Pre-2023 data used thousands. If pre-2023 data is ever imported, a separate migration path with explicit unit conversion is required. Never apply a blanket ×1000 multiplier.

---

## Amendment Handling

| Type | Behavior |
|------|---------|
| `13F-HR` | Original filing |
| `13F-HR/A` | Amendment — supersedes original for same period |
| `13F-NT` | Notice (no holdings required) |
| `13F-NT/A` | Amended notice |

"Effective filings" = most recent HR or HR/A per manager per period.

---

## Ingestion Process

1. Fetch catalog → discover current quarter ZIP URL
2. Download ZIP
3. Parse SUBMISSION.tsv, COVERPAGE.tsv, INFOTABLE.tsv (three-table join)
4. Persist to `institutional_filings` + `institutional_holdings`
5. Advisory lock key 774_412_003 — prevents concurrent ingestion runs

### Resumability
- Progress stored in `institutional_ingestion_runs` table
- `abort` → status `"partial"` — run is resumable
- Next trigger with same quarter skips already-processed filings
- `--force` flag re-processes all (use sparingly)

### Timeout Behavior
- Long-running ingestion (thousands of filings) may hit Railway request timeouts
- The process is designed to be resumed; re-trigger after partial completion
- Stale "running" state after process crash: check `institutional_ingestion_runs` and reset status if needed

### Scheduled Ingestion
- `INSTITUTIONAL_13F_INGESTION_ENABLED=true` enables background scheduling
- Schedule: quarterly (after SEC filing deadline, ~45 days after period end)

---

## 13F Delay Limitations

13F data is inherently lagged:
- Filings due 45 days after quarter end
- Most filed in the first 30–45 days
- Do not mark 13F data as "stale" simply because it is weeks or months old
- Use quarter/reporting semantics, not daily freshness

---

## Diagnostics

```bash
GET /api/admin/platform-health         # institutional card
GET /api/institutional/funds           # fund explorer (if enabled)
GET /api/admin/intelligence/diagnostics # signal row count
```
