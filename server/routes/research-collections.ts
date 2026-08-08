/**
 * Research Collections Routes — Sprint 2.5.1
 *
 * GET    /api/collections                          — list (system + user + followed)
 * POST   /api/collections                          — create user collection
 * GET    /api/collections/symbol/:symbol           — collections for a symbol
 * GET    /api/collections/:id                      — collection detail + opportunities
 * PATCH  /api/collections/:id                      — rename / archive / description
 * DELETE /api/collections/:id                      — delete user collection
 * POST   /api/collections/:id/follow               — follow
 * DELETE /api/collections/:id/follow               — unfollow
 * POST   /api/collections/:id/favorite             — favorite
 * DELETE /api/collections/:id/favorite             — unfavorite
 * POST   /api/collections/:id/pin                  — pin
 * DELETE /api/collections/:id/pin                  — unpin
 * POST   /api/collections/:id/duplicate            — duplicate (user collections)
 * POST   /api/collections/:id/symbols              — add symbol to user collection
 * DELETE /api/collections/:id/symbols/:symbol      — remove symbol from user collection
 *
 * AUTH: all routes require isAuthenticated.
 * COMPLIANCE: never uses "recommendation", "buy", "sell", "target price".
 */

import type { Express, Request, Response, RequestHandler } from "express";
import {
  listCollections,
  getCollectionDetail,
  createUserCollection,
  updateUserCollection,
  deleteUserCollection,
  duplicateCollection,
  addSymbolToCollection,
  removeSymbolFromCollection,
  followCollection,
  unfollowCollection,
  favoriteCollection,
  unfavoriteCollection,
  pinCollection,
  unpinCollection,
  getCollectionsForSymbol,
} from "../services/collection-service";
import type { CollectionListOptions } from "../../shared/collection-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userId(req: Request): string {
  return (req.session as any).userId as string;
}

function parseBool(v: unknown): boolean | undefined {
  if (v === "true")  return true;
  if (v === "false") return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerCollectionRoutes(
  app:             Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/collections ──────────────────────────────────────────────────
  app.get("/api/collections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const options: CollectionListOptions = {
        collectionType:  req.query.type as any,
        followedOnly:    parseBool(req.query.followedOnly),
        favoriteOnly:    parseBool(req.query.favoriteOnly),
        pinnedOnly:      parseBool(req.query.pinnedOnly),
        excludeArchived: req.query.includeArchived === "true" ? false : true,
        search:          typeof req.query.search === "string" ? req.query.search : undefined,
        sortBy:          req.query.sortBy as any,
        sortDirection:   req.query.sortDirection as any,
      };

      const collections = await listCollections(userId(req), options);
      return res.json({ collections, count: collections.length });
    } catch (err) {
      console.error("[Collections] GET /collections error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list collections" });
    }
  });

  // ── POST /api/collections ─────────────────────────────────────────────────
  app.post("/api/collections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body ?? {};
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
      }

      const collection = await createUserCollection(userId(req), { name, description });
      return res.status(201).json({ collection });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("required") || msg.includes("characters")) {
        return res.status(400).json({ error: msg });
      }
      console.error("[Collections] POST /collections error:", msg);
      return res.status(500).json({ error: "Failed to create collection" });
    }
  });

  // ── GET /api/collections/symbol/:symbol ────────────────────────────────────
  // Must be registered BEFORE /:id to avoid ambiguity.
  app.get("/api/collections/symbol/:symbol", isAuthenticated, async (req: Request, res: Response) => {
    const { symbol } = req.params;
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });

    try {
      const memberships = await getCollectionsForSymbol(userId(req), symbol.toUpperCase());
      const savedCollections    = memberships.filter(m => m.isMember);
      const followedCollections = memberships.filter(m => m.isFollowing);
      const relatedCollections  = memberships.filter(m => !m.isMember && !m.isFollowing).slice(0, 6);

      return res.json({
        symbol:             symbol.toUpperCase(),
        savedCollections,
        followedCollections,
        relatedCollections,
        allMemberships: memberships,
      });
    } catch (err) {
      console.error("[Collections] GET /collections/symbol/:symbol error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to get symbol collections" });
    }
  });

  // ── GET /api/collections/:id ──────────────────────────────────────────────
  app.get("/api/collections/:id", isAuthenticated, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const collection = await getCollectionDetail(id, userId(req));
      if (!collection) return res.status(404).json({ error: "Collection not found" });
      return res.json({ collection });
    } catch (err) {
      console.error("[Collections] GET /collections/:id error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to get collection" });
    }
  });

  // ── PATCH /api/collections/:id ────────────────────────────────────────────
  app.patch("/api/collections/:id", isAuthenticated, async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description, isArchived } = req.body ?? {};

    try {
      const updated = await updateUserCollection(userId(req), id, { name, description, isArchived });
      if (!updated) return res.status(404).json({ error: "Collection not found or not owned by user" });
      return res.json({ collection: updated });
    } catch (err) {
      console.error("[Collections] PATCH /collections/:id error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to update collection" });
    }
  });

  // ── DELETE /api/collections/:id ───────────────────────────────────────────
  app.delete("/api/collections/:id", isAuthenticated, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await deleteUserCollection(userId(req), id);
      if (!deleted) return res.status(404).json({ error: "Collection not found or not owned by user" });
      return res.json({ success: true, message: "Collection deleted" });
    } catch (err) {
      console.error("[Collections] DELETE /collections/:id error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete collection" });
    }
  });

  // ── POST /api/collections/:id/follow ─────────────────────────────────────
  app.post("/api/collections/:id/follow", isAuthenticated, async (req: Request, res: Response) => {
    const ok = await followCollection(userId(req), req.params.id).catch(() => false);
    if (!ok) return res.status(404).json({ error: "Collection not found" });
    return res.json({ success: true, following: true });
  });

  // ── DELETE /api/collections/:id/follow ───────────────────────────────────
  app.delete("/api/collections/:id/follow", isAuthenticated, async (req: Request, res: Response) => {
    await unfollowCollection(userId(req), req.params.id).catch(() => null);
    return res.json({ success: true, following: false });
  });

  // ── POST /api/collections/:id/favorite ───────────────────────────────────
  app.post("/api/collections/:id/favorite", isAuthenticated, async (req: Request, res: Response) => {
    const ok = await favoriteCollection(userId(req), req.params.id).catch(() => false);
    if (!ok) return res.status(404).json({ error: "Collection not found" });
    return res.json({ success: true, favorite: true });
  });

  // ── DELETE /api/collections/:id/favorite ─────────────────────────────────
  app.delete("/api/collections/:id/favorite", isAuthenticated, async (req: Request, res: Response) => {
    await unfavoriteCollection(userId(req), req.params.id).catch(() => null);
    return res.json({ success: true, favorite: false });
  });

  // ── POST /api/collections/:id/pin ────────────────────────────────────────
  app.post("/api/collections/:id/pin", isAuthenticated, async (req: Request, res: Response) => {
    const ok = await pinCollection(userId(req), req.params.id).catch(() => false);
    if (!ok) return res.status(404).json({ error: "Collection not found" });
    return res.json({ success: true, pinned: true });
  });

  // ── DELETE /api/collections/:id/pin ──────────────────────────────────────
  app.delete("/api/collections/:id/pin", isAuthenticated, async (req: Request, res: Response) => {
    await unpinCollection(userId(req), req.params.id).catch(() => null);
    return res.json({ success: true, pinned: false });
  });

  // ── POST /api/collections/:id/duplicate ──────────────────────────────────
  app.post("/api/collections/:id/duplicate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const copy = await duplicateCollection(userId(req), req.params.id);
      if (!copy) return res.status(404).json({ error: "Collection not found" });
      return res.status(201).json({ collection: copy });
    } catch (err) {
      console.error("[Collections] POST /:id/duplicate error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to duplicate collection" });
    }
  });

  // ── POST /api/collections/:id/symbols ────────────────────────────────────
  app.post("/api/collections/:id/symbols", isAuthenticated, async (req: Request, res: Response) => {
    const { symbol } = req.body ?? {};
    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ error: "symbol is required" });
    }

    try {
      const result = await addSymbolToCollection(userId(req), req.params.id, symbol);
      if (!result.success && !result.alreadyExists) {
        return res.status(404).json({ error: "Collection not found or not a user collection" });
      }
      return res.json({ success: true, symbol: symbol.toUpperCase(), alreadyExists: result.alreadyExists });
    } catch (err) {
      console.error("[Collections] POST /:id/symbols error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to add symbol" });
    }
  });

  // ── DELETE /api/collections/:id/symbols/:symbol ──────────────────────────
  app.delete("/api/collections/:id/symbols/:symbol", isAuthenticated, async (req: Request, res: Response) => {
    const { id, symbol } = req.params;
    try {
      const ok = await removeSymbolFromCollection(userId(req), id, symbol);
      if (!ok) return res.status(404).json({ error: "Collection not found or not a user collection" });
      return res.json({ success: true, symbol: symbol.toUpperCase() });
    } catch (err) {
      console.error("[Collections] DELETE /:id/symbols/:symbol error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to remove symbol" });
    }
  });
}
