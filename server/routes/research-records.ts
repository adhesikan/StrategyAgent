// Research Records API — Sprint 5.4C
//
// Authenticated endpoints for persisting and managing ResearchEvidenceRecords
// and Decision Journal entries.
//
// Trust model:
//   - userId comes ONLY from req.session.userId (set by isAuthenticated middleware).
//   - Client supplies only: handleId, metadata patches, journal text.
//   - Evidence content comes from the server-held save handle — never from request body.
//   - Returns 404 (not 403) when a resource is not found or not owned, to avoid
//     revealing existence of other users' records (spec §4).
//
// Endpoints:
//   POST   /api/research-records                — create from save handle
//   GET    /api/research-records                — list (authenticated user's records)
//   GET    /api/research-records/:id            — fetch one
//   PATCH  /api/research-records/:id/metadata   — update user metadata
//   POST   /api/research-records/:id/archive    — archive
//   DELETE /api/research-records/:id            — hard delete
//
//   POST   /api/research-records/:id/journal    — create/get journal entry
//   GET    /api/research-records/:id/journal    — fetch journal
//   PATCH  /api/research-records/:id/journal    — update journal fields
//   DELETE /api/research-records/:id/journal    — delete journal

import type { Express, RequestHandler, Request, Response } from "express";
import { resolveResearchSaveHandle } from "../services/research-save-handle";
import { ResearchRecordService, ResearchRecordError } from "../services/research-record-service";
import { DecisionJournalService, JournalError, USER_DECISIONS } from "../services/decision-journal-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function getUserId(req: Request): string {
  return (req.session as { userId?: string }).userId!;
}

function sanitizeString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.slice(0, maxLen);
}

function sanitizeStringArray(v: unknown, maxItems: number, maxItemLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((x): x is string => typeof x === "string")
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxItemLen));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerResearchRecordRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // ---------------------------------------------------------------------------
  // POST /api/research-records
  // Create a research record from a save handle minted server-side.
  // Client sends only: { handleId, title?, userLabel?, tags?, conversationId? }
  // ---------------------------------------------------------------------------
  app.post("/api/research-records", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { handleId, title, userLabel, tags, conversationId } = req.body ?? {};

    if (!handleId || typeof handleId !== "string") {
      return err(res, 400, "MISSING_HANDLE", "handleId is required");
    }

    const resolved = resolveResearchSaveHandle(handleId, userId);
    if (!resolved.ok) {
      const status = resolved.error === "WRONG_USER" ? 404 : 410; // 410 Gone for expired/consumed
      return err(res, status, resolved.error, `Save handle ${resolved.error.toLowerCase().replace("_", " ")}`);
    }

    const { handle } = resolved;

    try {
      const record = await ResearchRecordService.createFromEvidence(
        userId,
        handle.evidence,
        {
          title: sanitizeString(title, 500) ?? handle.titleSuggestion,
          userLabel: sanitizeString(userLabel, 200),
          tags: sanitizeStringArray(tags, 20, 50) ?? handle.tagSuggestions,
          conversationId: sanitizeString(conversationId, 128),
        },
      );
      return res.status(201).json({ record });
    } catch (e) {
      if (e instanceof ResearchRecordError) {
        if (e.code === "VALIDATION_FAILED" || e.code === "FORBIDDEN_FIELD") {
          return err(res, 422, e.code, e.message);
        }
        if (e.code === "CROSS_USER_PARENT") {
          return err(res, 404, "NOT_FOUND", "Parent record not found");
        }
        if (e.code === "NOT_FOUND") {
          return err(res, 404, "NOT_FOUND", "Resource not found");
        }
      }
      console.error("[research-records] create error:", (e as Error).message);
      return err(res, 500, "INTERNAL", "Failed to save research record");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/research-records
  // List the authenticated user's research records.
  // Query: domain?, symbol?, archived?, limit?, offset?
  // ---------------------------------------------------------------------------
  app.get("/api/research-records", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { domain, symbol, archived, limit, offset } = req.query;

    const filters = {
      domain: typeof domain === "string" ? domain : undefined,
      symbol: typeof symbol === "string" ? symbol.toUpperCase() : undefined,
      archived: archived === "true" ? true : archived === "false" ? false : undefined,
      limit: limit ? Math.min(parseInt(String(limit), 10) || 50, 100) : 50,
      offset: offset ? Math.max(parseInt(String(offset), 10) || 0, 0) : 0,
    };

    try {
      const records = await ResearchRecordService.listForUser(userId, filters);
      return res.json({ records, count: records.length });
    } catch (e) {
      console.error("[research-records] list error:", (e as Error).message);
      return err(res, 500, "INTERNAL", "Failed to list research records");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/research-records/:id
  // ---------------------------------------------------------------------------
  app.get("/api/research-records/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const record = await ResearchRecordService.getForUser(userId, req.params.id);
    if (!record) return err(res, 404, "NOT_FOUND", "Research record not found");
    return res.json({ record });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/research-records/:id/metadata
  // User-owned metadata only: title, userLabel, tags, archived.
  // Evidence fields are silently ignored.
  // ---------------------------------------------------------------------------
  app.patch("/api/research-records/:id/metadata", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { title, userLabel, tags, archived } = req.body ?? {};

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = sanitizeString(title, 500) ?? "";
    if (userLabel !== undefined) patch.userLabel = sanitizeString(userLabel, 200) ?? null;
    if (tags !== undefined) patch.tags = sanitizeStringArray(tags, 20, 50) ?? [];
    if (archived !== undefined) patch.archived = Boolean(archived);

    try {
      const updated = await ResearchRecordService.updateUserMetadata(userId, req.params.id, patch);
      if (!updated) return err(res, 404, "NOT_FOUND", "Research record not found");
      return res.json({ record: updated });
    } catch (e) {
      console.error("[research-records] metadata update error:", (e as Error).message);
      return err(res, 500, "INTERNAL", "Failed to update metadata");
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/research-records/:id/archive
  // ---------------------------------------------------------------------------
  app.post("/api/research-records/:id/archive", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const archived = await ResearchRecordService.archiveForUser(userId, req.params.id);
    if (!archived) return err(res, 404, "NOT_FOUND", "Research record not found");
    return res.json({ record: archived });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/research-records/:id
  // Hard delete + cascade journal entry handled at DB level.
  // ---------------------------------------------------------------------------
  app.delete("/api/research-records/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const deleted = await ResearchRecordService.deleteForUser(userId, req.params.id);
    if (!deleted) return err(res, 404, "NOT_FOUND", "Research record not found");
    return res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  // POST /api/research-records/:id/journal
  // Create or get the journal entry for a research record.
  // ---------------------------------------------------------------------------
  app.post("/api/research-records/:id/journal", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    try {
      const entry = await DecisionJournalService.createOrGetForResearchRecord(userId, req.params.id);
      return res.status(201).json({ entry });
    } catch (e) {
      if (e instanceof JournalError && e.code === "NOT_FOUND") {
        return err(res, 404, "NOT_FOUND", "Research record not found");
      }
      console.error("[research-records] journal create error:", (e as Error).message);
      return err(res, 500, "INTERNAL", "Failed to create journal entry");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/research-records/:id/journal
  // ---------------------------------------------------------------------------
  app.get("/api/research-records/:id/journal", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const entry = await DecisionJournalService.getForUser(userId, req.params.id);
    if (!entry) return err(res, 404, "NOT_FOUND", "Journal entry not found");
    return res.json({ entry });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/research-records/:id/journal
  // Update user-authored text fields or user decision state.
  // Use ?manual=true to set entered_manually/closed_manually.
  // ---------------------------------------------------------------------------
  app.patch("/api/research-records/:id/journal", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const body = req.body ?? {};
    const isManual = req.query.manual === "true";

    try {
      let updated: import("../../shared/schema").DecisionJournalEntry | null;

      if (isManual) {
        // Explicit manual execution state
        const state = body.state as string;
        if (state !== "entered_manually" && state !== "closed_manually") {
          return err(res, 400, "INVALID_STATE", "state must be entered_manually or closed_manually");
        }
        updated = await DecisionJournalService.recordExplicitManualDecision(userId, req.params.id, {
          state,
          userRecordedEntryPrice: typeof body.entryPrice === "number" ? body.entryPrice : undefined,
          userRecordedExitPrice: typeof body.exitPrice === "number" ? body.exitPrice : undefined,
          userRecordedQuantity: typeof body.quantity === "number" ? body.quantity : undefined,
          openedAt: body.openedAt ? new Date(body.openedAt) : undefined,
          closedAt: body.closedAt ? new Date(body.closedAt) : undefined,
        });
      } else {
        // Regular authored field update
        const patch: Record<string, unknown> = {};
        const textFields = ["thesis", "entryPlan", "riskPlan", "exitPlan", "notes", "expectedConditions", "invalidationConditions", "outcomeReview", "lessonsLearned"] as const;
        for (const f of textFields) {
          if (body[f] !== undefined) patch[f] = sanitizeString(body[f], 10_000) ?? null;
        }
        if (body.userDecision !== undefined) {
          const dec = body.userDecision;
          if (!USER_DECISIONS.includes(dec) || dec === "entered_manually" || dec === "closed_manually") {
            return err(res, 400, "INVALID_DECISION", `Invalid userDecision; use manual=true for execution states`);
          }
          patch.userDecision = dec;
        }
        updated = await DecisionJournalService.updateUserAuthoredFields(userId, req.params.id, patch as Parameters<typeof DecisionJournalService.updateUserAuthoredFields>[2]);
      }

      if (!updated) return err(res, 404, "NOT_FOUND", "Journal entry not found");
      return res.json({ entry: updated });
    } catch (e) {
      if (e instanceof JournalError) {
        if (e.code === "INVALID_DECISION") return err(res, 400, "INVALID_DECISION", e.message);
        if (e.code === "NOT_FOUND") return err(res, 404, "NOT_FOUND", "Not found");
      }
      console.error("[research-records] journal update error:", (e as Error).message);
      return err(res, 500, "INTERNAL", "Failed to update journal entry");
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/research-records/:id/journal
  // ---------------------------------------------------------------------------
  app.delete("/api/research-records/:id/journal", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const deleted = await DecisionJournalService.deleteForUser(userId, req.params.id);
    if (!deleted) return err(res, 404, "NOT_FOUND", "Journal entry not found");
    return res.status(204).end();
  });
}
