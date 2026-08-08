---
name: Institutional 13F value units (post-2023 fix)
description: Post-2023 SEC INFOTABLE VALUE is in dollars, not thousands. fund-service.ts had a ×1000 bug — removed. Canonical DB unit is now USD dollars for all post-2023 ingested data.
---

## Rule

Canonical internal unit = **US dollars** for all `reported_value` rows from post-2023 SEC bulk 13F datasets.

**Why:** SEC changed the INFOTABLE VALUE convention in 2023 from "thousands of USD" to "dollars as filed". The bulk parser stored raw VALUE in the DB. fund-service.ts was multiplying by 1000 assuming "thousands" → result was 1000× inflated.

## How to apply

- `fund-service.ts`: NEVER multiply `reported_value` or aggregated `portfolio_value` by 1000. The value from DB is already canonical dollars.
- `formatPortfolioValue()`: formatting only — adds T/B/M suffixes. Has a trillion tier (`v >= 1e12`). Never applies unit conversion.
- `sec-13f-bulk-parser.ts` / `sec-13f-parser.ts`: `reportedValue` field = raw SEC VALUE = dollars for post-2023 data. Parser stores as-is; no division needed for post-2023.

## Pre-2023 legacy note

Pre-2023 SEC 13F VALUE was in thousands. If pre-2023 data is ever ingested, the ingestion layer must divide by 1000 before storing so the DB remains canonically in dollars. **Do not add ×1000 back to fund-service** — fix it at ingestion instead.

## Existing DB rows

Rows ingested from post-2023 SEC bulk datasets are already correct (dollars). No backfill needed.

## Fixed locations in fund-service.ts (6 sites removed)

All `parseNum(...) * 1000` and `latValue * 1000` patterns for `reportedPortfolioValue` and `reportedValue` fields were removed. Ratio-based calculations (portfolioWeight) were unaffected since both numerator and denominator scale identically.
