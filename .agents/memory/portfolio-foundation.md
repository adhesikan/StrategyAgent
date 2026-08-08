---
name: Portfolio Foundation
description: Sprint 2.4.0 — two new tables, normalization service, CSV/XLSX import, preview-confirm flow, packages multer+xlsx.
---

## Tables

`portfolios` — id, userId, name, sourceType (enum), sourceAccountId, createdAt, updatedAt
`portfolio_positions` — id, portfolioId, symbol, quantity (NUMERIC 18,8), averageCost, costBasis, marketValue, currency, sourceType, sourceReference, importedAt, updatedAt
Enum: `portfolio_source_type` → manual | csv | xlsx | broker (no screenshot/pdf yet)

**Why:** No existing portfolio storage existed. position_protection_plans and futures_positions were not appropriate to repurpose.

## Key Patterns

- `pgEnum` is now imported in `shared/schema.ts` (was missing before this sprint; adding a new pgEnum requires adding to that import line)
- `EnrichedPosition` uses `Omit<PortfolioPosition, "marketValue">` + computed fields — cannot `extend` because `marketValue` type (number|null) conflicts with stored type (string|null)
- Market data: `getReferenceSnapshotsBulk(userId, symbols)` returns an array (not a Map or plain object) — iterate with Array.from and map by `.symbol`
- User isolation: `req.session.userId!` only — never `req.body.userId`; ownership at query level: `WHERE id=? AND user_id=?` returns 404 for foreign

## Normalization Service

`server/services/portfolio-normalization.ts` — pure, no LLM
- 500-row cap (warns on excess)
- Formula cells stripped (strings starting with = + - @)
- Duplicate symbols: sum qty, weighted-average cost (deterministic)
- Derives costBasis from averageCost×qty and vice versa

## Import Flow

Preview store: in-memory Map, 30-min TTL, single-use, userId-bound
`multer({ storage: memoryStorage(), limits: { fileSize: 5*1024*1024 } })`
`xlsx` package: `cellFormula: false, cellHTML: false` (no formula execution)

## File Safety

No disk writes (multer memoryStorage). MIME checked before parse. Formula cells returned as empty string by sanitizeCellValue().

## Market Data

`getReferenceSnapshotsBulk` — stored bars, no Twelve Data on-demand. Graceful degradation: if call throws, positions returned with currentPrice=null.
