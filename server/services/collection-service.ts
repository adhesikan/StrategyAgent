/**
 * Research Collections Service — Sprint 2.5.1
 *
 * Personalization layer built on top of the Opportunity Intelligence Engine.
 * Collections store only symbol references — they never duplicate opportunity data.
 *
 * System collections: auto-populated from Opportunity Intelligence using
 *   filter specs defined in server/config/collection-registry.ts.
 * User collections:   store explicit symbol lists in collection_symbols table.
 *
 * ARCHITECTURE
 *   - getOpportunityIntelligence() is called ONCE per request; results are
 *     shared across all collection filter/sort operations (no N+1 queries).
 *   - All DB mutations return the updated entity for optimistic UI support.
 *   - Seeding is idempotent — safe to call on every startup.
 *
 * COMPLIANCE
 *   Never uses "recommendation", "buy", "sell", "target price".
 */

import { db } from "../db";
import { eq, and, inArray, sql, count } from "drizzle-orm";
import {
  researchCollections,
  collectionSymbols,
  userCollectionFollows,
  userCollectionFavorites,
  userCollectionPins,
} from "../../shared/schema";
import {
  SYSTEM_COLLECTIONS,
  getSystemCollection,
  filterSpecToOptions,
  filterSpecToSort,
  filterSpecLimit,
} from "../config/collection-registry";
import {
  getOpportunityIntelligence,
  filterOpportunities,
  sortOpportunities,
} from "./opportunity-intelligence-service";
import type {
  CollectionSummary,
  CollectionDetail,
  CreateCollectionInput,
  UpdateCollectionInput,
  CollectionListOptions,
  SymbolCollectionMembership,
  CollectionHealthSnapshot,
} from "../../shared/collection-types";
import type { CanonicalOpportunity } from "../../shared/opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

function log(level: "info" | "warn" | "error", obj: Record<string, unknown>): void {
  const line = JSON.stringify({ ...obj, timestamp: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// System collection seeding (idempotent)
// ---------------------------------------------------------------------------

let _seedComplete = false;

/**
 * Ensure all system collections exist in the DB.
 * Safe to call on every startup — uses upsert pattern.
 */
export async function seedSystemCollections(): Promise<void> {
  if (_seedComplete) return;

  log("info", { event: "collection_seed_started", count: SYSTEM_COLLECTIONS.length });

  for (const def of SYSTEM_COLLECTIONS) {
    try {
      const existing = await db
        .select({ id: researchCollections.id })
        .from(researchCollections)
        .where(eq(researchCollections.systemKey, def.systemKey))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(researchCollections).values({
          userId:         null,
          name:           def.name,
          description:    def.description,
          collectionType: "system",
          systemKey:      def.systemKey,
          isArchived:     false,
        });
      }
    } catch (err) {
      log("warn", { event: "collection_seed_error", systemKey: def.systemKey, error: (err as Error).message });
    }
  }

  _seedComplete = true;
  log("info", { event: "collection_seed_complete" });
}

export function isSeedComplete(): boolean {
  return _seedComplete;
}

// ---------------------------------------------------------------------------
// Opportunity resolution — shared computation
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical opportunities for a collection.
 * Called with a pre-loaded opportunity set to avoid N+1 DB queries.
 */
function resolveSystemOpportunities(
  allOpportunities: CanonicalOpportunity[],
  systemKey: string,
): CanonicalOpportunity[] {
  const def = getSystemCollection(systemKey);
  if (!def) return [];

  const spec    = def.filterSpec;
  const filters = filterSpecToOptions(spec);
  const sort    = filterSpecToSort(spec);
  const limit   = filterSpecLimit(spec);

  let opps = Object.keys(filters).length > 0
    ? filterOpportunities(allOpportunities, filters)
    : [...allOpportunities];

  if (sort) {
    opps = sortOpportunities(opps, sort);
  }

  if (limit !== undefined) {
    opps = opps.slice(0, limit);
  }

  return opps;
}

function resolveUserOpportunities(
  allOpportunities: CanonicalOpportunity[],
  symbols: string[],
): CanonicalOpportunity[] {
  const symSet = new Set(symbols.map(s => s.toUpperCase()));
  return allOpportunities.filter(o => symSet.has(o.symbol.toUpperCase()));
}

// ---------------------------------------------------------------------------
// Per-user state helpers
// ---------------------------------------------------------------------------

async function getUserState(
  userId: string,
  collectionIds: string[],
): Promise<{
  follows:   Set<string>;
  favorites: Set<string>;
  pins:      Set<string>;
}> {
  if (collectionIds.length === 0) {
    return { follows: new Set(), favorites: new Set(), pins: new Set() };
  }

  const [follows, favorites, pins] = await Promise.all([
    db.select({ collectionId: userCollectionFollows.collectionId })
      .from(userCollectionFollows)
      .where(and(
        eq(userCollectionFollows.userId, userId),
        inArray(userCollectionFollows.collectionId, collectionIds),
      )),
    db.select({ collectionId: userCollectionFavorites.collectionId })
      .from(userCollectionFavorites)
      .where(and(
        eq(userCollectionFavorites.userId, userId),
        inArray(userCollectionFavorites.collectionId, collectionIds),
      )),
    db.select({ collectionId: userCollectionPins.collectionId })
      .from(userCollectionPins)
      .where(and(
        eq(userCollectionPins.userId, userId),
        inArray(userCollectionPins.collectionId, collectionIds),
      )),
  ]);

  return {
    follows:   new Set(follows.map(r => r.collectionId)),
    favorites: new Set(favorites.map(r => r.collectionId)),
    pins:      new Set(pins.map(r => r.collectionId)),
  };
}

async function getFollowCounts(collectionIds: string[]): Promise<Map<string, number>> {
  if (collectionIds.length === 0) return new Map();

  const rows = await db
    .select({
      collectionId: userCollectionFollows.collectionId,
      cnt:          count(userCollectionFollows.userId),
    })
    .from(userCollectionFollows)
    .where(inArray(userCollectionFollows.collectionId, collectionIds))
    .groupBy(userCollectionFollows.collectionId);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.collectionId, Number(r.cnt));
  return map;
}

// ---------------------------------------------------------------------------
// List collections
// ---------------------------------------------------------------------------

export async function listCollections(
  userId: string,
  options: CollectionListOptions = {},
): Promise<CollectionSummary[]> {
  const excludeArchived = options.excludeArchived !== false;

  // 1. Load all collections visible to this user
  let allCollections = await db
    .select()
    .from(researchCollections)
    .where(
      // System collections OR user's own collections
      sql`(${researchCollections.userId} IS NULL OR ${researchCollections.userId} = ${userId})`,
    );

  if (excludeArchived) {
    allCollections = allCollections.filter(c => !c.isArchived);
  }

  if (options.collectionType) {
    allCollections = allCollections.filter(c => c.collectionType === options.collectionType);
  }

  // Text search
  if (options.search) {
    const q = options.search.toLowerCase();
    allCollections = allCollections.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q),
    );
  }

  const collectionIds = allCollections.map(c => c.id);

  // 2. Per-user state + follow counts (parallel)
  const [userState, followCounts, symbolRows] = await Promise.all([
    getUserState(userId, collectionIds),
    getFollowCounts(collectionIds),
    db.select({ collectionId: collectionSymbols.collectionId, symbol: collectionSymbols.symbol })
      .from(collectionSymbols)
      .where(inArray(collectionSymbols.collectionId, collectionIds)),
  ]);

  // 3. Build symbol map for user collections
  const symbolMap = new Map<string, string[]>();
  for (const row of symbolRows) {
    if (!symbolMap.has(row.collectionId)) symbolMap.set(row.collectionId, []);
    symbolMap.get(row.collectionId)!.push(row.symbol);
  }

  // 4. Load opportunities ONCE for system collection counts
  const oppResult = await getOpportunityIntelligence().catch(() => null);
  const allOpps   = oppResult?.opportunities ?? [];

  // 5. Build summaries
  let summaries: CollectionSummary[] = allCollections.map(c => {
    const syms       = symbolMap.get(c.id) ?? [];
    const isFollowing = userState.follows.has(c.id);
    const isFavorite  = userState.favorites.has(c.id);
    const isPinned    = userState.pins.has(c.id);
    const followCount = followCounts.get(c.id) ?? 0;

    let opportunityCount: number;
    if (c.collectionType === "system" && c.systemKey) {
      opportunityCount = resolveSystemOpportunities(allOpps, c.systemKey).length;
    } else {
      opportunityCount = resolveUserOpportunities(allOpps, syms).length;
    }

    return {
      id:               c.id,
      name:             c.name,
      description:      c.description ?? null,
      collectionType:   c.collectionType as "system" | "user",
      systemKey:        c.systemKey ?? null,
      opportunityCount,
      symbolCount:      syms.length,
      isArchived:       c.isArchived,
      isFollowing,
      isFavorite,
      isPinned,
      followCount,
      createdAt:        c.createdAt.toISOString(),
      updatedAt:        c.updatedAt.toISOString(),
    };
  });

  // 6. Apply follow/favorite/pin filters
  if (options.followedOnly)  summaries = summaries.filter(s => s.isFollowing);
  if (options.favoriteOnly)  summaries = summaries.filter(s => s.isFavorite);
  if (options.pinnedOnly)    summaries = summaries.filter(s => s.isPinned);

  // 7. Sort
  const field     = options.sortBy     ?? "name";
  const direction = options.sortDirection ?? "asc";
  const mult      = direction === "asc" ? 1 : -1;

  summaries.sort((a, b) => {
    switch (field) {
      case "opportunityCount": return mult * (a.opportunityCount - b.opportunityCount);
      case "followCount":      return mult * (a.followCount      - b.followCount);
      case "createdAt":        return mult * a.createdAt.localeCompare(b.createdAt);
      case "updatedAt":        return mult * a.updatedAt.localeCompare(b.updatedAt);
      default:                 return mult * a.name.localeCompare(b.name);
    }
  });

  return summaries;
}

// ---------------------------------------------------------------------------
// Get collection detail
// ---------------------------------------------------------------------------

export async function getCollectionDetail(
  collectionId: string,
  userId: string,
): Promise<CollectionDetail | null> {
  const [row] = await db
    .select()
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);

  if (!row) return null;

  // Ownership check: system collections are visible to everyone;
  // user collections only to their owner.
  if (row.collectionType === "user" && row.userId !== userId) return null;

  const [userState, followCounts, symbolRows, oppResult] = await Promise.all([
    getUserState(userId, [collectionId]),
    getFollowCounts([collectionId]),
    db.select({ symbol: collectionSymbols.symbol })
      .from(collectionSymbols)
      .where(eq(collectionSymbols.collectionId, collectionId)),
    getOpportunityIntelligence().catch(() => null),
  ]);

  const allOpps = oppResult?.opportunities ?? [];
  const syms    = symbolRows.map(r => r.symbol);

  let opportunities: CanonicalOpportunity[];
  if (row.collectionType === "system" && row.systemKey) {
    opportunities = resolveSystemOpportunities(allOpps, row.systemKey);
  } else {
    opportunities = resolveUserOpportunities(allOpps, syms);
  }

  return {
    id:               row.id,
    name:             row.name,
    description:      row.description ?? null,
    collectionType:   row.collectionType as "system" | "user",
    systemKey:        row.systemKey ?? null,
    opportunityCount: opportunities.length,
    symbolCount:      syms.length,
    isArchived:       row.isArchived,
    isFollowing:      userState.follows.has(collectionId),
    isFavorite:       userState.favorites.has(collectionId),
    isPinned:         userState.pins.has(collectionId),
    followCount:      followCounts.get(collectionId) ?? 0,
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
    opportunities,
    symbols:          syms,
  };
}

// ---------------------------------------------------------------------------
// Create user collection
// ---------------------------------------------------------------------------

export async function createUserCollection(
  userId: string,
  input: CreateCollectionInput,
): Promise<CollectionSummary> {
  if (!input.name?.trim()) throw new Error("Collection name is required");
  if (input.name.length > 100) throw new Error("Collection name must be 100 characters or fewer");

  const [row] = await db.insert(researchCollections).values({
    userId,
    name:           input.name.trim(),
    description:    input.description?.trim() ?? null,
    collectionType: "user",
    systemKey:      null,
    isArchived:     false,
  }).returning();

  log("info", { event: "collection_created", collectionId: row.id, userId: "[redacted]" });

  return {
    id:               row.id,
    name:             row.name,
    description:      row.description ?? null,
    collectionType:   "user",
    systemKey:        null,
    opportunityCount: 0,
    symbolCount:      0,
    isArchived:       false,
    isFollowing:      false,
    isFavorite:       false,
    isPinned:         false,
    followCount:      0,
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Update user collection (rename / archive / unarchive)
// ---------------------------------------------------------------------------

export async function updateUserCollection(
  userId: string,
  collectionId: string,
  input: UpdateCollectionInput,
): Promise<CollectionSummary | null> {
  const [existing] = await db
    .select()
    .from(researchCollections)
    .where(and(
      eq(researchCollections.id, collectionId),
      eq(researchCollections.userId, userId),
      eq(researchCollections.collectionType, "user"),
    ))
    .limit(1);

  if (!existing) return null;

  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (input.name       !== undefined) updates.name       = input.name.trim();
  if (input.description !== undefined) updates.description = input.description?.trim() ?? null;
  if (input.isArchived  !== undefined) updates.isArchived  = input.isArchived;

  await db.update(researchCollections)
    .set(updates)
    .where(eq(researchCollections.id, collectionId));

  return getCollectionDetail(collectionId, userId) as Promise<CollectionSummary>;
}

// ---------------------------------------------------------------------------
// Delete user collection
// ---------------------------------------------------------------------------

export async function deleteUserCollection(
  userId: string,
  collectionId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(and(
      eq(researchCollections.id, collectionId),
      eq(researchCollections.userId, userId),
      eq(researchCollections.collectionType, "user"),
    ))
    .limit(1);

  if (!existing) return false;

  // Delete symbols and collection (cascade)
  await db.delete(collectionSymbols).where(eq(collectionSymbols.collectionId, collectionId));
  await db.delete(userCollectionFollows).where(eq(userCollectionFollows.collectionId, collectionId));
  await db.delete(userCollectionFavorites).where(eq(userCollectionFavorites.collectionId, collectionId));
  await db.delete(userCollectionPins).where(eq(userCollectionPins.collectionId, collectionId));
  await db.delete(researchCollections).where(eq(researchCollections.id, collectionId));

  log("info", { event: "collection_deleted", collectionId, userId: "[redacted]" });
  return true;
}

// ---------------------------------------------------------------------------
// Duplicate user collection
// ---------------------------------------------------------------------------

export async function duplicateCollection(
  userId: string,
  collectionId: string,
): Promise<CollectionSummary | null> {
  const detail = await getCollectionDetail(collectionId, userId);
  if (!detail) return null;

  // Create new collection
  const newColl = await createUserCollection(userId, {
    name:        `${detail.name} (Copy)`,
    description: detail.description ?? undefined,
  });

  // Copy symbols (user collections only)
  if (detail.symbols.length > 0) {
    await db.insert(collectionSymbols).values(
      detail.symbols.map(sym => ({
        collectionId: newColl.id,
        symbol:       sym,
        addedBy:      userId,
      })),
    );
  }

  log("info", { event: "collection_duplicated", sourceId: collectionId, newId: newColl.id, userId: "[redacted]" });
  return getCollectionDetail(newColl.id, userId) as Promise<CollectionSummary>;
}

// ---------------------------------------------------------------------------
// Symbol management (user collections only)
// ---------------------------------------------------------------------------

export async function addSymbolToCollection(
  userId: string,
  collectionId: string,
  symbol: string,
): Promise<{ success: boolean; alreadyExists: boolean }> {
  const [existing] = await db
    .select({ id: researchCollections.id, collectionType: researchCollections.collectionType })
    .from(researchCollections)
    .where(and(
      eq(researchCollections.id, collectionId),
      eq(researchCollections.userId, userId),
    ))
    .limit(1);

  if (!existing || existing.collectionType !== "user") {
    return { success: false, alreadyExists: false };
  }

  try {
    await db.insert(collectionSymbols).values({
      collectionId,
      symbol:  symbol.toUpperCase(),
      addedBy: userId,
    });
    return { success: true, alreadyExists: false };
  } catch {
    // Unique constraint violation — already exists
    return { success: false, alreadyExists: true };
  }
}

export async function removeSymbolFromCollection(
  userId: string,
  collectionId: string,
  symbol: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(and(
      eq(researchCollections.id, collectionId),
      eq(researchCollections.userId, userId),
      eq(researchCollections.collectionType, "user"),
    ))
    .limit(1);

  if (!existing) return false;

  await db.delete(collectionSymbols).where(and(
    eq(collectionSymbols.collectionId, collectionId),
    eq(collectionSymbols.symbol, symbol.toUpperCase()),
  ));

  return true;
}

// ---------------------------------------------------------------------------
// Follow / Unfollow
// ---------------------------------------------------------------------------

export async function followCollection(userId: string, collectionId: string): Promise<boolean> {
  const [exists] = await db
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);

  if (!exists) return false;

  try {
    await db.insert(userCollectionFollows).values({ userId, collectionId });
  } catch { /* already following */ }

  return true;
}

export async function unfollowCollection(userId: string, collectionId: string): Promise<boolean> {
  await db.delete(userCollectionFollows).where(and(
    eq(userCollectionFollows.userId, userId),
    eq(userCollectionFollows.collectionId, collectionId),
  ));
  return true;
}

// ---------------------------------------------------------------------------
// Favorite / Unfavorite
// ---------------------------------------------------------------------------

export async function favoriteCollection(userId: string, collectionId: string): Promise<boolean> {
  const [exists] = await db
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);

  if (!exists) return false;

  try {
    await db.insert(userCollectionFavorites).values({ userId, collectionId });
  } catch { /* already favorited */ }

  return true;
}

export async function unfavoriteCollection(userId: string, collectionId: string): Promise<boolean> {
  await db.delete(userCollectionFavorites).where(and(
    eq(userCollectionFavorites.userId, userId),
    eq(userCollectionFavorites.collectionId, collectionId),
  ));
  return true;
}

// ---------------------------------------------------------------------------
// Pin / Unpin
// ---------------------------------------------------------------------------

export async function pinCollection(userId: string, collectionId: string): Promise<boolean> {
  const [exists] = await db
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);

  if (!exists) return false;

  try {
    await db.insert(userCollectionPins).values({ userId, collectionId });
  } catch { /* already pinned */ }

  return true;
}

export async function unpinCollection(userId: string, collectionId: string): Promise<boolean> {
  await db.delete(userCollectionPins).where(and(
    eq(userCollectionPins.userId, userId),
    eq(userCollectionPins.collectionId, collectionId),
  ));
  return true;
}

// ---------------------------------------------------------------------------
// Symbol membership (for opportunity pages)
// ---------------------------------------------------------------------------

/**
 * Returns all collections (system + user) and their membership state for a symbol.
 * Used by opportunity pages to show "Saved Collections / Followed Collections / Related Collections".
 */
export async function getCollectionsForSymbol(
  userId: string,
  symbol: string,
): Promise<SymbolCollectionMembership[]> {
  const upperSym = symbol.toUpperCase();

  // Load all visible collections + user state
  const [allCollections, userSymbolRows, userState] = await Promise.all([
    db.select().from(researchCollections).where(
      sql`(${researchCollections.userId} IS NULL OR ${researchCollections.userId} = ${userId})`,
    ),
    db.select({ collectionId: collectionSymbols.collectionId })
      .from(collectionSymbols)
      .where(eq(collectionSymbols.symbol, upperSym)),
    // We need follow/fav state for all — load lazily after we have IDs
    Promise.resolve(null),
  ]);

  const collectionIds  = allCollections.map(c => c.id);
  const userMemberSet  = new Set(userSymbolRows.map(r => r.collectionId));
  const [state, oppResult] = await Promise.all([
    getUserState(userId, collectionIds),
    getOpportunityIntelligence().catch(() => null),
  ]);

  const allOpps = oppResult?.opportunities ?? [];

  return allCollections.map(c => {
    let isMember: boolean;
    if (c.collectionType === "system" && c.systemKey) {
      const opps = resolveSystemOpportunities(allOpps, c.systemKey);
      isMember = opps.some(o => o.symbol === upperSym);
    } else {
      isMember = userMemberSet.has(c.id);
    }

    return {
      collectionId:   c.id,
      collectionName: c.name,
      collectionType: c.collectionType as "system" | "user",
      systemKey:      c.systemKey ?? null,
      isMember,
      isFollowing:    state.follows.has(c.id),
      isFavorite:     state.favorites.has(c.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export async function getCollectionHealth(): Promise<CollectionHealthSnapshot> {
  try {
    const [systemCount, userCount, followCount, favoriteCount, pinCount, symbolCount] =
      await Promise.all([
        db.select({ cnt: count() }).from(researchCollections)
          .where(eq(researchCollections.collectionType, "system")),
        db.select({ cnt: count() }).from(researchCollections)
          .where(eq(researchCollections.collectionType, "user")),
        db.select({ cnt: count() }).from(userCollectionFollows),
        db.select({ cnt: count() }).from(userCollectionFavorites),
        db.select({ cnt: count() }).from(userCollectionPins),
        db.select({ cnt: count() }).from(collectionSymbols),
      ]);

    return {
      systemCollectionCount: Number(systemCount[0]?.cnt ?? 0),
      userCollectionCount:   Number(userCount[0]?.cnt   ?? 0),
      totalFollows:          Number(followCount[0]?.cnt  ?? 0),
      totalFavorites:        Number(favoriteCount[0]?.cnt ?? 0),
      totalPins:             Number(pinCount[0]?.cnt     ?? 0),
      totalUserSymbols:      Number(symbolCount[0]?.cnt  ?? 0),
      seedingComplete:       _seedComplete,
    };
  } catch {
    return {
      systemCollectionCount: 0,
      userCollectionCount:   0,
      totalFollows:          0,
      totalFavorites:        0,
      totalPins:             0,
      totalUserSymbols:      0,
      seedingComplete:       false,
    };
  }
}
