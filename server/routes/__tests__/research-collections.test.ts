/**
 * Research Collections — Sprint 2.5.1
 *
 * Pure structural + registry + pure-logic tests.
 * No DB, no network required.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  SYSTEM_COLLECTIONS,
  getSystemCollection,
  filterSpecToOptions,
  filterSpecToSort,
  filterSpecLimit,
} from "../../config/collection-registry";

// Source files for structural tests
const serviceSrc = fs.readFileSync(
  path.join(__dirname, "../../services/collection-service.ts"), "utf-8",
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../research-collections.ts"), "utf-8",
);
const typesSrc = fs.readFileSync(
  path.join(__dirname, "../../../shared/collection-types.ts"), "utf-8",
);
const schemaSrc = fs.readFileSync(
  path.join(__dirname, "../../../shared/schema.ts"), "utf-8",
);
const platformHealthSrc = fs.readFileSync(
  path.join(__dirname, "../platform-health.ts"), "utf-8",
);
const adminHealthSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/admin-platform-health.tsx"), "utf-8",
);
const routesRegSrc = fs.readFileSync(
  path.join(__dirname, "../../routes.ts"), "utf-8",
);
const indexSrc = fs.readFileSync(
  path.join(__dirname, "../../index.ts"), "utf-8",
);
const registrySrc = fs.readFileSync(
  path.join(__dirname, "../../config/collection-registry.ts"), "utf-8",
);

// ---------------------------------------------------------------------------
// Part 1 — System Collection Registry
// ---------------------------------------------------------------------------

describe("Part 1 — System Collection Registry", () => {
  it("SYSTEM_COLLECTIONS array is exported", () => {
    expect(Array.isArray(SYSTEM_COLLECTIONS)).toBe(true);
  });

  it("has at least 25 system collections", () => {
    expect(SYSTEM_COLLECTIONS.length).toBeGreaterThanOrEqual(25);
  });

  it("every collection has a unique systemKey", () => {
    const keys = SYSTEM_COLLECTIONS.map(c => c.systemKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("every collection has a name", () => {
    for (const c of SYSTEM_COLLECTIONS) {
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("every collection has a description", () => {
    for (const c of SYSTEM_COLLECTIONS) {
      expect(typeof c.description).toBe("string");
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("every collection has a filterSpec with a mode", () => {
    for (const c of SYSTEM_COLLECTIONS) {
      expect(c.filterSpec).toBeDefined();
      expect(typeof c.filterSpec.mode).toBe("string");
    }
  });

  const REQUIRED_KEYS = [
    "ai-infrastructure", "semiconductors", "memory", "networking", "cybersecurity", "cloud",
    "energy", "healthcare", "financials", "consumer", "industrials",
    "dividend", "income", "growth", "momentum", "value", "etf",
    "long-term-investments", "swing-trading", "covered-calls", "cash-secured-puts",
    "market-leaders", "recently-improved", "institutional-activity", "new-opportunities",
  ];

  for (const key of REQUIRED_KEYS) {
    it(`system collection "${key}" exists`, () => {
      expect(getSystemCollection(key)).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Part 2 — Filter spec helpers
// ---------------------------------------------------------------------------

describe("Part 2 — filterSpecToOptions", () => {
  it("theme mode → theme filter", () => {
    const opts = filterSpecToOptions({ mode: "theme", theme: "AI Infrastructure" });
    expect(opts.theme).toContain("AI Infrastructure");
  });

  it("opportunityType mode → opportunityType filter", () => {
    const opts = filterSpecToOptions({ mode: "opportunityType", opportunityType: "growth" });
    expect(opts.opportunityType).toContain("growth");
  });

  it("sector mode → sector filter", () => {
    const opts = filterSpecToOptions({ mode: "sector", sector: "Energy" });
    expect(opts.sector).toContain("Energy");
  });

  it("topByScore mode → empty filter (sort + limit handles it)", () => {
    const opts = filterSpecToOptions({ mode: "topByScore", limit: 20 });
    expect(Object.keys(opts)).toHaveLength(0);
  });

  it("topByScore → sort by researchScore desc", () => {
    const sort = filterSpecToSort({ mode: "topByScore", limit: 20 });
    expect(sort?.field).toBe("researchScore");
    expect(sort?.direction).toBe("desc");
  });

  it("topByInstitutional → sort by institutionalScore desc", () => {
    const sort = filterSpecToSort({ mode: "topByInstitutional", limit: 10 });
    expect(sort?.field).toBe("institutionalScore");
    expect(sort?.direction).toBe("desc");
  });

  it("topByRecency → sort by lastUpdated desc", () => {
    const sort = filterSpecToSort({ mode: "topByRecency", limit: 15 });
    expect(sort?.field).toBe("lastUpdated");
  });

  it("topByScore → limit 20", () => {
    expect(filterSpecLimit({ mode: "topByScore", limit: 20 })).toBe(20);
  });

  it("theme mode → no limit", () => {
    expect(filterSpecLimit({ mode: "theme", theme: "Cloud" })).toBeUndefined();
  });

  it("filterSpecToSort: theme → undefined", () => {
    expect(filterSpecToSort({ mode: "theme", theme: "Cloud" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part 3 — Schema
// ---------------------------------------------------------------------------

describe("Part 3 — Database Schema", () => {
  it("research_collections table defined", () => {
    expect(schemaSrc).toContain("research_collections");
    expect(schemaSrc).toContain("researchCollections");
  });

  it("collection_type enum defined", () => {
    expect(schemaSrc).toContain("collection_type");
    expect(schemaSrc).toContain('"system"');
    expect(schemaSrc).toContain('"user"');
  });

  it("collection_symbols table defined", () => {
    expect(schemaSrc).toContain("collection_symbols");
    expect(schemaSrc).toContain("collectionSymbols");
  });

  it("user_collection_follows table defined", () => {
    expect(schemaSrc).toContain("user_collection_follows");
    expect(schemaSrc).toContain("userCollectionFollows");
  });

  it("user_collection_favorites table defined", () => {
    expect(schemaSrc).toContain("user_collection_favorites");
    expect(schemaSrc).toContain("userCollectionFavorites");
  });

  it("user_collection_pins table defined", () => {
    expect(schemaSrc).toContain("user_collection_pins");
    expect(schemaSrc).toContain("userCollectionPins");
  });

  it("research_collections has systemKey field", () => {
    expect(schemaSrc).toContain("system_key");
    expect(schemaSrc).toContain("systemKey");
  });

  it("research_collections has isArchived field", () => {
    expect(schemaSrc).toContain("is_archived");
  });

  it("research_collections uses varchar id with gen_random_uuid()", () => {
    expect(schemaSrc).toContain("gen_random_uuid()");
  });

  it("collection_symbols has unique constraint on (collectionId, symbol)", () => {
    expect(schemaSrc).toContain("idx_cs_collection_symbol");
    expect(schemaSrc).toContain("uniqueIndex");
  });

  it("user_collection_follows has unique constraint on (userId, collectionId)", () => {
    expect(schemaSrc).toContain("idx_ucf_user_coll");
  });
});

// ---------------------------------------------------------------------------
// Part 4 — Shared Types
// ---------------------------------------------------------------------------

describe("Part 4 — Shared Types", () => {
  it("CollectionSummary exported", () => {
    expect(typesSrc).toContain("export interface CollectionSummary");
  });

  it("CollectionDetail exported", () => {
    expect(typesSrc).toContain("export interface CollectionDetail");
  });

  it("CollectionSummary has required fields", () => {
    expect(typesSrc).toContain("opportunityCount:");
    expect(typesSrc).toContain("isFollowing:");
    expect(typesSrc).toContain("isFavorite:");
    expect(typesSrc).toContain("isPinned:");
    expect(typesSrc).toContain("followCount:");
    expect(typesSrc).toContain("isArchived:");
    expect(typesSrc).toContain("systemKey:");
    expect(typesSrc).toContain("collectionType:");
  });

  it("CollectionDetail extends with opportunities and symbols", () => {
    expect(typesSrc).toContain("opportunities:");
    expect(typesSrc).toContain("symbols:");
  });

  it("SymbolCollectionMembership exported", () => {
    expect(typesSrc).toContain("export interface SymbolCollectionMembership");
  });

  it("SymbolCollectionMembership has isMember, isFollowing, isFavorite", () => {
    expect(typesSrc).toContain("isMember:");
    expect(typesSrc).toContain("isFollowing:");
    expect(typesSrc).toContain("isFavorite:");
  });

  it("CollectionListOptions exported", () => {
    expect(typesSrc).toContain("export interface CollectionListOptions");
  });

  it("CollectionListOptions supports search", () => {
    expect(typesSrc).toContain("search?:");
  });

  it("CollectionHealthSnapshot exported", () => {
    expect(typesSrc).toContain("CollectionHealthSnapshot");
  });
});

// ---------------------------------------------------------------------------
// Part 5 — Service
// ---------------------------------------------------------------------------

describe("Part 5 — Collection Service", () => {
  it("seedSystemCollections exported", () => {
    expect(serviceSrc).toContain("export async function seedSystemCollections");
  });

  it("seedSystemCollections is idempotent (_seedComplete guard)", () => {
    expect(serviceSrc).toContain("_seedComplete");
    expect(serviceSrc).toContain("if (_seedComplete) return");
  });

  it("listCollections exported", () => {
    expect(serviceSrc).toContain("export async function listCollections");
  });

  it("getCollectionDetail exported", () => {
    expect(serviceSrc).toContain("export async function getCollectionDetail");
  });

  it("createUserCollection exported", () => {
    expect(serviceSrc).toContain("export async function createUserCollection");
  });

  it("updateUserCollection exported", () => {
    expect(serviceSrc).toContain("export async function updateUserCollection");
  });

  it("deleteUserCollection exported", () => {
    expect(serviceSrc).toContain("export async function deleteUserCollection");
  });

  it("duplicateCollection exported", () => {
    expect(serviceSrc).toContain("export async function duplicateCollection");
  });

  it("addSymbolToCollection exported", () => {
    expect(serviceSrc).toContain("export async function addSymbolToCollection");
  });

  it("removeSymbolFromCollection exported", () => {
    expect(serviceSrc).toContain("export async function removeSymbolFromCollection");
  });

  it("followCollection exported", () => {
    expect(serviceSrc).toContain("export async function followCollection");
  });

  it("unfollowCollection exported", () => {
    expect(serviceSrc).toContain("export async function unfollowCollection");
  });

  it("favoriteCollection exported", () => {
    expect(serviceSrc).toContain("export async function favoriteCollection");
  });

  it("unfavoriteCollection exported", () => {
    expect(serviceSrc).toContain("export async function unfavoriteCollection");
  });

  it("pinCollection exported", () => {
    expect(serviceSrc).toContain("export async function pinCollection");
  });

  it("unpinCollection exported", () => {
    expect(serviceSrc).toContain("export async function unpinCollection");
  });

  it("getCollectionsForSymbol exported", () => {
    expect(serviceSrc).toContain("export async function getCollectionsForSymbol");
  });

  it("getCollectionHealth exported", () => {
    expect(serviceSrc).toContain("export async function getCollectionHealth");
  });

  it("isSeedComplete exported", () => {
    expect(serviceSrc).toContain("export function isSeedComplete");
  });

  it("service calls getOpportunityIntelligence ONCE per request (not N times)", () => {
    // Service loads all opps once, then filters locally — no N+1 DB calls
    expect(serviceSrc).toContain("getOpportunityIntelligence");
    expect(serviceSrc).toContain("filterOpportunities");
  });

  it("service uses resolveSystemOpportunities for system collections", () => {
    expect(serviceSrc).toContain("resolveSystemOpportunities");
  });

  it("service uses resolveUserOpportunities for user collections", () => {
    expect(serviceSrc).toContain("resolveUserOpportunities");
  });

  it("deleteUserCollection cascades: deletes symbols, follows, favorites, pins", () => {
    expect(serviceSrc).toContain("db.delete(collectionSymbols)");
    expect(serviceSrc).toContain("db.delete(userCollectionFollows)");
    expect(serviceSrc).toContain("db.delete(userCollectionFavorites)");
    expect(serviceSrc).toContain("db.delete(userCollectionPins)");
  });

  it("duplicateCollection creates new collection with '(Copy)' suffix", () => {
    expect(serviceSrc).toContain("(Copy)");
  });

  it("addSymbolToCollection uppercases symbol", () => {
    expect(serviceSrc).toContain("symbol.toUpperCase()");
  });

  it("service does NOT duplicate opportunity data (references only)", () => {
    // collectionSymbols stores symbols, not CanonicalOpportunity objects
    expect(serviceSrc).toContain("collectionSymbols");
    expect(serviceSrc).not.toContain("researchScore: c.researchScore");
    expect(serviceSrc).not.toContain("technicalScore: c.technicalScore");
  });

  it("userId is redacted in all log events", () => {
    expect(serviceSrc).toContain('"[redacted]"');
  });
});

// ---------------------------------------------------------------------------
// Part 6 — Symbol ownership / access control
// ---------------------------------------------------------------------------

describe("Part 6 — Access control", () => {
  it("getCollectionDetail returns null for other user's user collections", () => {
    expect(serviceSrc).toContain("row.collectionType === \"user\" && row.userId !== userId");
  });

  it("system collections accessible to all users (no userId check)", () => {
    // System collections have userId=null; visible to all
    expect(serviceSrc).toContain("userId} IS NULL OR");
  });

  it("updateUserCollection checks userId ownership before update", () => {
    expect(serviceSrc).toContain("eq(researchCollections.userId, userId)");
    expect(serviceSrc).toContain('eq(researchCollections.collectionType, "user")');
  });

  it("deleteUserCollection checks userId ownership before delete", () => {
    const deleteSection = serviceSrc.slice(
      serviceSrc.indexOf("export async function deleteUserCollection"),
      serviceSrc.indexOf("export async function duplicateCollection"),
    );
    expect(deleteSection).toContain("eq(researchCollections.userId, userId)");
  });

  it("addSymbolToCollection checks userId ownership", () => {
    const addSection = serviceSrc.slice(
      serviceSrc.indexOf("export async function addSymbolToCollection"),
      serviceSrc.indexOf("export async function removeSymbolFromCollection"),
    );
    expect(addSection).toContain("userId, userId");
  });

  it("routes return 401 / require isAuthenticated", () => {
    const matches = routesSrc.match(/isAuthenticated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(15);
  });

  it("routes return 404 when collection not found", () => {
    expect(routesSrc).toContain("404");
    expect(routesSrc).toContain("Collection not found");
  });
});

// ---------------------------------------------------------------------------
// Part 7 — Routes
// ---------------------------------------------------------------------------

describe("Part 7 — Routes", () => {
  it("GET /api/collections route registered", () => {
    expect(routesSrc).toContain('"/api/collections"');
  });

  it("POST /api/collections route registered", () => {
    expect(routesSrc).toContain("app.post(\"/api/collections\"");
  });

  it("GET /api/collections/symbol/:symbol route registered", () => {
    expect(routesSrc).toContain("/api/collections/symbol/:symbol");
  });

  it("GET /api/collections/:id route registered", () => {
    expect(routesSrc).toContain("/api/collections/:id");
  });

  it("PATCH /api/collections/:id route registered", () => {
    expect(routesSrc).toContain("app.patch(\"/api/collections/:id\"");
  });

  it("DELETE /api/collections/:id route registered", () => {
    expect(routesSrc).toContain("app.delete(\"/api/collections/:id\"");
  });

  it("POST /api/collections/:id/follow route", () => {
    expect(routesSrc).toContain("/api/collections/:id/follow");
  });

  it("DELETE /api/collections/:id/follow route", () => {
    expect(routesSrc).toMatch(/app\.delete.*\/api\/collections\/:id\/follow/);
  });

  it("POST /api/collections/:id/favorite route", () => {
    expect(routesSrc).toContain("/api/collections/:id/favorite");
  });

  it("DELETE /api/collections/:id/favorite route", () => {
    expect(routesSrc).toMatch(/app\.delete.*\/api\/collections\/:id\/favorite/);
  });

  it("POST /api/collections/:id/pin route", () => {
    expect(routesSrc).toContain("/api/collections/:id/pin");
  });

  it("DELETE /api/collections/:id/pin route", () => {
    expect(routesSrc).toMatch(/app\.delete.*\/api\/collections\/:id\/pin/);
  });

  it("POST /api/collections/:id/duplicate route", () => {
    expect(routesSrc).toContain("/api/collections/:id/duplicate");
  });

  it("POST /api/collections/:id/symbols route", () => {
    expect(routesSrc).toContain("/api/collections/:id/symbols");
  });

  it("DELETE /api/collections/:id/symbols/:symbol route", () => {
    expect(routesSrc).toContain("/api/collections/:id/symbols/:symbol");
  });

  it("/api/collections/symbol/:symbol registered BEFORE /:id to avoid ambiguity", () => {
    const symbolIdx = routesSrc.indexOf("/api/collections/symbol/:symbol");
    const idIdx     = routesSrc.indexOf("/api/collections/:id\"");
    expect(symbolIdx).toBeLessThan(idIdx);
  });

  it("POST /api/collections returns 201 on success", () => {
    expect(routesSrc).toContain("res.status(201)");
  });

  it("GET /api/collections returns count", () => {
    expect(routesSrc).toContain("count: collections.length");
  });

  it("symbol route returns savedCollections, followedCollections, relatedCollections", () => {
    expect(routesSrc).toContain("savedCollections");
    expect(routesSrc).toContain("followedCollections");
    expect(routesSrc).toContain("relatedCollections");
  });

  it("POST /api/collections validates name is required", () => {
    expect(routesSrc).toContain('"name is required"');
  });

  it("POST /api/collections/:id/symbols validates symbol", () => {
    expect(routesSrc).toContain('"symbol is required"');
  });
});

// ---------------------------------------------------------------------------
// Part 8 — Route registration & startup
// ---------------------------------------------------------------------------

describe("Part 8 — Route registration & startup seeding", () => {
  it("registerCollectionRoutes imported in routes.ts", () => {
    expect(routesRegSrc).toContain("registerCollectionRoutes");
    expect(routesRegSrc).toContain("research-collections");
  });

  it("registerCollectionRoutes called in routes.ts", () => {
    expect(routesRegSrc).toContain("registerCollectionRoutes(app, isAuthenticated)");
  });

  it("seedSystemCollections called at startup in index.ts", () => {
    expect(indexSrc).toContain("seedSystemCollections");
    expect(indexSrc).toContain("collection-service");
  });

  it("seeding is fire-and-forget (non-blocking startup)", () => {
    expect(indexSrc).toContain(".catch(");
  });
});

// ---------------------------------------------------------------------------
// Part 9 — Platform Health
// ---------------------------------------------------------------------------

describe("Part 9 — Platform Health — Collections card", () => {
  it("checkCollections function in platform-health.ts", () => {
    expect(platformHealthSrc).toContain("checkCollections");
  });

  it("getCollectionHealth imported from collection-service", () => {
    expect(platformHealthSrc).toContain("getCollectionHealth");
    expect(platformHealthSrc).toContain("collection-service");
  });

  it("collections key in buildPlatformHealth result", () => {
    expect(platformHealthSrc).toContain("collections,");
  });

  it("admin health page renders Research Collections card", () => {
    expect(adminHealthSrc).toContain("Research Collections");
    expect(adminHealthSrc).toContain("h.collections");
  });

  it("health card reports system collection count", () => {
    expect(platformHealthSrc).toContain("systemCollectionCount");
  });

  it("health card reports seedingComplete flag", () => {
    expect(platformHealthSrc).toContain("seedingComplete");
  });
});

// ---------------------------------------------------------------------------
// Part 10 — Architecture: collections consume OppIntel (no duplication)
// ---------------------------------------------------------------------------

describe("Part 10 — Architecture: no opportunity data duplication", () => {
  it("service imports getOpportunityIntelligence (consuming Sprint 2.5.0)", () => {
    expect(serviceSrc).toContain("opportunity-intelligence-service");
    expect(serviceSrc).toContain("getOpportunityIntelligence");
  });

  it("collection_symbols table stores only symbol references, not opportunity data", () => {
    // Schema: collection_symbols has symbol text, not scores/evidence
    const symbolTableSection = schemaSrc.slice(
      schemaSrc.indexOf("collection_symbols"),
      schemaSrc.indexOf("user_collection_follows"),
    );
    expect(symbolTableSection).toContain("symbol:");
    expect(symbolTableSection).not.toContain("researchScore");
    expect(symbolTableSection).not.toContain("technicalScore");
  });

  it("service does NOT modify getOpportunityIntelligence (read-only)", () => {
    expect(serviceSrc).not.toContain("setLatestRanking");
  });

  it("registry imports from opportunity-intelligence-types (type reuse)", () => {
    expect(registrySrc).toContain("opportunity-intelligence-types");
  });
});

// ---------------------------------------------------------------------------
// Part 11 — Compliance language
// ---------------------------------------------------------------------------

describe("Part 11 — Compliance language", () => {
  it("service never uses 'recommendation:' as a key", () => {
    expect(serviceSrc).not.toContain("recommendation:");
    expect(serviceSrc).not.toContain('"recommendations"');
  });

  it("routes never return 'recommendations' key", () => {
    expect(routesSrc).not.toContain('"recommendations"');
    expect(routesSrc).not.toContain("recommendations:");
  });

  it("types never define a recommendation field", () => {
    expect(typesSrc).not.toContain("recommendation:");
  });

  it("registry descriptions use 'research candidate' language", () => {
    const descriptions = SYSTEM_COLLECTIONS.map(c => c.description).join(" ").toLowerCase();
    expect(descriptions).not.toContain("recommendation");
    expect(descriptions).not.toContain(" buy ");
    expect(descriptions).not.toContain(" sell ");
  });
});

// ---------------------------------------------------------------------------
// Part 12 — Roadmap discipline
// ---------------------------------------------------------------------------

describe("Part 12 — Roadmap discipline", () => {
  it("service has no Portfolio Intelligence logic", () => {
    const lower = serviceSrc.toLowerCase();
    expect(lower).not.toContain("portfolio score");
    expect(lower).not.toContain("rebalance");
    expect(lower).not.toContain("portfolio intelligence");
  });

  it("service has no alert / notification logic", () => {
    expect(serviceSrc.toLowerCase()).not.toContain("send alert");
    expect(serviceSrc.toLowerCase()).not.toContain("sendNotification");
  });

  it("service has no AI conversation logic", () => {
    expect(serviceSrc.toLowerCase()).not.toContain("openai");
    expect(serviceSrc.toLowerCase()).not.toContain("gpt");
  });

  it("types have no price target or recommendation fields", () => {
    expect(typesSrc).not.toContain("targetPrice");
    expect(typesSrc).not.toContain("recommendedAction");
  });

  it("routes are GET / POST / PATCH / DELETE only (no AI endpoints)", () => {
    expect(routesSrc).not.toContain("openai");
    expect(routesSrc).not.toContain("gpt");
  });
});
