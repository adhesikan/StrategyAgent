// Research Record Service — Sprint 5.4C
//
// Persistent CRUD for ResearchEvidenceRecords.
// All methods accept authenticatedUserId from the server session — never from
// an untrusted request body.
//
// Immutable fields (spec §2): verdict, reasons, warnings, confidence,
// sourceTools, sourceTimestamps, domainSnapshot, generatedAt.
// Mutable user metadata: title, userLabel, tags, archived.

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  researchRecords,
  type InsertResearchRecord,
  type ResearchRecord,
} from "../../shared/schema";
import { validateResearchEvidence, scanForForbiddenKeys } from "./research-evidence-validator";
import type { ResearchEvidenceRecord } from "./research-save-handle";
import { generateTitleSuggestion, generateTagSuggestions } from "./research-title-generator";

// ---------------------------------------------------------------------------
// Filters and pagination
// ---------------------------------------------------------------------------

export interface ResearchRecordFilters {
  domain?: string;
  symbol?: string;
  archived?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface UserMetadataPatch {
  title?: string;
  userLabel?: string;
  tags?: string[];
  archived?: boolean;
}

// ---------------------------------------------------------------------------
// Service errors
// ---------------------------------------------------------------------------

export class ResearchRecordError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION_FAILED"
      | "FORBIDDEN_FIELD"
      | "IMMUTABLE_FIELD"
      | "CROSS_USER_PARENT"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "ResearchRecordError";
  }
}

// ---------------------------------------------------------------------------
// Pre-persistence safety check
// ---------------------------------------------------------------------------

function assertNoForbiddenFields(evidence: ResearchEvidenceRecord): void {
  const result = scanForForbiddenKeys(evidence.domainSnapshot, "domainSnapshot");
  if (result.found) {
    throw new ResearchRecordError(
      "FORBIDDEN_FIELD",
      `Persistence rejected: forbidden sensitive field detected in evidence`,
    );
  }
  // Also scan the full evidence except the domainSnapshot (already checked above)
  const topLevelSafe = { ...evidence, domainSnapshot: {} };
  const topResult = scanForForbiddenKeys(topLevelSafe, "evidence");
  if (topResult.found) {
    throw new ResearchRecordError(
      "FORBIDDEN_FIELD",
      `Persistence rejected: forbidden sensitive field detected in evidence top-level`,
    );
  }
}

// ---------------------------------------------------------------------------
// ResearchRecordService
// ---------------------------------------------------------------------------

export const ResearchRecordService = {
  /**
   * Create a new research record from a validated evidence object.
   * The authenticatedUserId MUST come from req.session.userId.
   */
  async createFromEvidence(
    authenticatedUserId: string,
    evidence: ResearchEvidenceRecord,
    metadata: { title?: string; userLabel?: string; tags?: string[]; conversationId?: string } = {},
  ): Promise<ResearchRecord> {
    // Validate schema
    const validation = validateResearchEvidence(evidence);
    if (!validation.ok) {
      throw new ResearchRecordError("VALIDATION_FAILED", validation.error.reason);
    }

    // Defence-in-depth forbidden field scan
    assertNoForbiddenFields(evidence);

    // Validate parentRecordId ownership if provided
    if (evidence.parentRecordId) {
      const parent = await db
        .select({ id: researchRecords.id, userId: researchRecords.userId })
        .from(researchRecords)
        .where(and(eq(researchRecords.id, evidence.parentRecordId)))
        .limit(1);
      if (parent.length === 0) {
        throw new ResearchRecordError("NOT_FOUND", "Parent record not found");
      }
      if (parent[0].userId !== authenticatedUserId) {
        throw new ResearchRecordError("CROSS_USER_PARENT", "Cannot link to another user's record");
      }
    }

    const title = metadata.title ?? generateTitleSuggestion(evidence);
    const tags = metadata.tags ?? generateTagSuggestions(evidence);

    const row: InsertResearchRecord = {
      userId: authenticatedUserId,
      requestId: evidence.requestId,
      conversationId: metadata.conversationId ?? evidence.conversationId ?? null,
      parentRecordId: evidence.parentRecordId ?? null,
      domain: evidence.domain,
      schemaVersion: evidence.schemaVersion,
      symbol: evidence.symbol ?? null,
      symbols: evidence.symbols ?? [],
      normalizedRequestSummary: evidence.normalizedRequestSummary,
      verdict: evidence.verdict,
      status: evidence.status ?? null,
      strategy: evidence.strategy ?? null,
      strategyDisplayName: evidence.strategyDisplayName ?? null,
      direction: evidence.direction ?? null,
      instrument: evidence.instrument ?? null,
      qualificationStatus: evidence.qualificationStatus ?? null,
      confidence: evidence.confidence,
      dataQuality: evidence.dataQuality as Record<string, boolean>,
      reasons: evidence.reasons,
      warnings: evidence.warnings,
      watchConditions: evidence.watchConditions ?? [],
      sourceTools: evidence.sourceTools,
      sourceTimestamps: evidence.sourceTimestamps,
      limitations: evidence.limitations,
      domainSnapshot: evidence.domainSnapshot,
      title,
      userLabel: metadata.userLabel ?? null,
      tags,
      archived: false,
      generatedAt: new Date(evidence.generatedAt),
    };

    const [created] = await db.insert(researchRecords).values(row).returning();
    return created;
  },

  /**
   * List research records for the authenticated user.
   */
  async listForUser(
    authenticatedUserId: string,
    filters: ResearchRecordFilters = {},
  ): Promise<ResearchRecord[]> {
    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;

    let query = db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.userId, authenticatedUserId))
      .orderBy(desc(researchRecords.createdAt))
      .limit(limit)
      .offset(offset);

    // Apply filters — Drizzle requires re-assignment for chaining with .where
    const conditions = [eq(researchRecords.userId, authenticatedUserId)];
    if (filters.domain) conditions.push(eq(researchRecords.domain, filters.domain));
    if (filters.symbol) conditions.push(eq(researchRecords.symbol, filters.symbol));
    if (filters.archived !== undefined) conditions.push(eq(researchRecords.archived, filters.archived));

    const rows = await db
      .select()
      .from(researchRecords)
      .where(and(...conditions))
      .orderBy(desc(researchRecords.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  },

  /**
   * Fetch a single record — returns null (not 404) when not found or not owned.
   * Callers translate null → 404 to avoid revealing existence of other users' records.
   */
  async getForUser(
    authenticatedUserId: string,
    recordId: string,
  ): Promise<ResearchRecord | null> {
    const rows = await db
      .select()
      .from(researchRecords)
      .where(
        and(
          eq(researchRecords.id, recordId),
          eq(researchRecords.userId, authenticatedUserId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Update only user-owned metadata fields.
   * Evidence fields are immutable and silently ignored if present in patch.
   */
  async updateUserMetadata(
    authenticatedUserId: string,
    recordId: string,
    patch: UserMetadataPatch,
  ): Promise<ResearchRecord | null> {
    const existing = await ResearchRecordService.getForUser(authenticatedUserId, recordId);
    if (!existing) return null;

    const update: Partial<InsertResearchRecord> = {};
    if (patch.title !== undefined) update.title = patch.title.slice(0, 500);
    if (patch.userLabel !== undefined) update.userLabel = patch.userLabel.slice(0, 200);
    if (patch.tags !== undefined) update.tags = patch.tags.slice(0, 20).map((t) => t.slice(0, 50));
    if (patch.archived !== undefined) update.archived = patch.archived;
    update.updatedAt = new Date();

    const [updated] = await db
      .update(researchRecords)
      .set(update)
      .where(
        and(
          eq(researchRecords.id, recordId),
          eq(researchRecords.userId, authenticatedUserId),
        ),
      )
      .returning();
    return updated ?? null;
  },

  /**
   * Archive a record (soft-delete alternative — archived records are hidden but retained).
   */
  async archiveForUser(
    authenticatedUserId: string,
    recordId: string,
  ): Promise<ResearchRecord | null> {
    return ResearchRecordService.updateUserMetadata(authenticatedUserId, recordId, {
      archived: true,
    });
  },

  /**
   * Hard-delete a research record.
   * Linked journal entry must be deleted by the caller or cascaded at DB level.
   */
  async deleteForUser(
    authenticatedUserId: string,
    recordId: string,
  ): Promise<boolean> {
    const existing = await ResearchRecordService.getForUser(authenticatedUserId, recordId);
    if (!existing) return false;

    await db
      .delete(researchRecords)
      .where(
        and(
          eq(researchRecords.id, recordId),
          eq(researchRecords.userId, authenticatedUserId),
        ),
      );
    return true;
  },

  /**
   * Create a linked refresh record (child of a parent record).
   * Verifies cross-user safety.
   */
  async createLinkedRefresh(
    authenticatedUserId: string,
    parentRecordId: string,
    evidence: ResearchEvidenceRecord,
  ): Promise<ResearchRecord> {
    // Verify parent ownership
    const parent = await ResearchRecordService.getForUser(authenticatedUserId, parentRecordId);
    if (!parent) {
      throw new ResearchRecordError("NOT_FOUND", "Parent record not found or not owned");
    }
    return ResearchRecordService.createFromEvidence(
      authenticatedUserId,
      { ...evidence, parentRecordId },
    );
  },
};
