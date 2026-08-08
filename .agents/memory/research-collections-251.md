---
name: Research Collections (Sprint 2.5.1)
description: Personalization layer over Opportunity Intelligence — 25 system collections, user collections, follow/favorite/pin, symbol references only.
---

## Architecture

Collections are a personalization layer. They NEVER store opportunity data — only symbol references.

- System collections → driven by filter specs in `server/config/collection-registry.ts`; resolved via `filterOpportunities()` on the pre-loaded OppIntel snapshot
- User collections → store explicit symbols in `collection_symbols` table
- `getOpportunityIntelligence()` called ONCE per list/detail request; filtered locally (no N+1)

## Key files

- `shared/collection-types.ts` — CollectionSummary, CollectionDetail, CollectionListOptions, SymbolCollectionMembership
- `server/config/collection-registry.ts` — SYSTEM_COLLECTIONS (25 entries), filterSpecToOptions/Sort/Limit helpers
- `server/services/collection-service.ts` — all CRUD + follow/fav/pin + seeding + health
- `server/routes/research-collections.ts` — 15 routes under /api/collections
- `server/routes/__tests__/research-collections.test.ts` — 139 structural tests

## DB tables (5 new)

`research_collections`, `collection_symbols`, `user_collection_follows`, `user_collection_favorites`, `user_collection_pins`

All use `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` pattern.

## Route ordering: /symbol/:symbol before /:id

`/api/collections/symbol/:symbol` MUST be registered before `/api/collections/:id` to avoid Express treating "symbol" as an `:id` param. Tests verify this with index comparison.

## Seeding

`seedSystemCollections()` runs fire-and-forget on startup (in `server/index.ts`). Guarded by `_seedComplete` flag — safe to call multiple times. Uses per-key existence check (not upsert) to avoid constraint violations.

## Access control patterns

- System collections: visible to all authenticated users (`userId IS NULL` check in SQL)
- User collections: `userId` match required for all mutations (return 404, not 403, to avoid leakage)
- `deleteUserCollection` cascades: symbols → follows → favorites → pins → collection

## System collection filter modes

| Mode | Filter | Sort | Limit |
|------|--------|------|-------|
| theme | theme[] | none | none |
| opportunityType | opportunityType[] | none | none |
| sector | sector[] | none | none |
| topByScore | none | researchScore desc | 20 |
| topByInstitutional | none | institutionalScore desc | 20 |
| topByRecency | none | lastUpdated desc | 20 |
| newOpportunities | none | lastUpdated desc | 20 |

## Compliance test pattern

Tests check service/types do NOT contain `recommendation:`, `"recommendations"`, `targetPrice` as patterns. Registry description text checked for absence of "recommendation", " buy ", " sell ". Bare-word checks avoided (would flag compliance notes in comments).

## Platform health

`checkCollections()` → HEALTHY if seeding complete and systemCollectionCount ≥ 25; DEGRADED otherwise. `collections` key in buildPlatformHealth().
