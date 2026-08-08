# 07 — Security Master & Mappings

## Purpose

The Security Master maps CUSIP (SEC identifier) to ticker symbols used by market data providers. This mapping is required to join 13F holdings with opportunity rankings.

---

## Tables

### `security_master`
| Column | Description |
|--------|-------------|
| `cusip` | 9-digit CUSIP |
| `ticker` | Exchange ticker symbol |
| `company_name` | Full company name |
| `confidence_score` | 0–100 (100 = reviewed/confirmed) |
| `source` | How the mapping was derived |

### `institutional_symbol_mappings` (review layer)
Overlay table for operator-reviewed mappings.

---

## Confidence Levels

| Score | Meaning |
|-------|---------|
| 100 | Reviewed and confirmed by operator |
| 70–99 | Probable match (auto-derived) |
| <70 | Low confidence — needs review |

A mapping with `confidence_score = 100` is **never overwritten** by the auto-mapping pipeline.

---

## Five-Level Priority

The mapping engine uses a priority cascade:
1. Operator-approved mapping (score = 100)
2. FIGI match
3. Exact name match
4. Fuzzy name match
5. CUSIP prefix heuristic

---

## Review Workflow

1. Navigate to `/admin/institutional-mappings`
2. Review the "Unmapped" queue (low-confidence mappings)
3. Approve correct matches → `confidence_score = 100`
4. Approved mappings sync to `institutional_symbol_mappings` ingestion table

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Mapping page 404 | Route collision | Ensure static routes before dynamic `:symbol` |
| Pipeline returns empty | No holdings ingested | Run 13F ingestion first |
| FIGI missing | OpenFIGI lookup failed | Manual mapping review |
| Large unmapped queue | New quarter's filings | Run mapping pipeline after ingestion |

---

## Diagnostics

```bash
GET /api/admin/platform-health         # security master card
GET /api/admin/intelligence/diagnostics # signal row count
```
