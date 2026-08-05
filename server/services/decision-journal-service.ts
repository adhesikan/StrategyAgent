// Decision Journal Service — Sprint 5.4C
//
// CRUD for user-authored Decision Journal entries linked to research records.
//
// Contract:
//   - Journal content is 100% user-authored — never inferred or auto-populated.
//   - entered_manually and closed_manually require explicit user action via
//     recordExplicitManualDecision(). They may NOT be set via updateUserAuthoredFields().
//   - No brokerage reconciliation or execution inference in this sprint.
//   - The journal entry belongs to the same user as its research record.

import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  decisionJournalEntries,
  researchRecords,
  type InsertDecisionJournalEntry,
  type DecisionJournalEntry,
} from "../../shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const USER_DECISIONS = [
  "researching",
  "watching",
  "passed",
  "prepared_trade",
  "entered_manually",
  "closed_manually",
] as const;

export type UserDecision = typeof USER_DECISIONS[number];

/** Fields the user may set freely (non-execution state). */
export interface JournalAuthoredFields {
  thesis?: string | null;
  entryPlan?: string | null;
  riskPlan?: string | null;
  exitPlan?: string | null;
  notes?: string | null;
  expectedConditions?: string | null;
  invalidationConditions?: string | null;
  userDecision?: Exclude<UserDecision, "entered_manually" | "closed_manually">;
  outcomeReview?: string | null;
  lessonsLearned?: string | null;
}

/** Explicit manual execution state — requires its own method call. */
export interface ManualExecutionState {
  state: "entered_manually" | "closed_manually";
  userRecordedEntryPrice?: number | null;
  userRecordedExitPrice?: number | null;
  userRecordedQuantity?: number | null;
  openedAt?: Date | null;
  closedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Service errors
// ---------------------------------------------------------------------------

export class JournalError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CROSS_USER"
      | "INVALID_DECISION"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "JournalError";
  }
}

// ---------------------------------------------------------------------------
// DecisionJournalService
// ---------------------------------------------------------------------------

export const DecisionJournalService = {
  /**
   * Get or create the journal entry for a research record.
   * Creates a default entry with userDecision: "researching" on first call.
   * Verifies the research record belongs to authenticatedUserId.
   */
  async createOrGetForResearchRecord(
    authenticatedUserId: string,
    researchRecordId: string,
  ): Promise<DecisionJournalEntry> {
    // Verify research record ownership
    const record = await db
      .select({ id: researchRecords.id, userId: researchRecords.userId })
      .from(researchRecords)
      .where(
        and(
          eq(researchRecords.id, researchRecordId),
          eq(researchRecords.userId, authenticatedUserId),
        ),
      )
      .limit(1);

    if (record.length === 0) {
      throw new JournalError("NOT_FOUND", "Research record not found or not owned");
    }

    // Check for existing entry
    const existing = await db
      .select()
      .from(decisionJournalEntries)
      .where(
        and(
          eq(decisionJournalEntries.researchRecordId, researchRecordId),
          eq(decisionJournalEntries.userId, authenticatedUserId),
        ),
      )
      .limit(1);

    if (existing[0]) return existing[0];

    // Create default entry
    const row: InsertDecisionJournalEntry = {
      userId: authenticatedUserId,
      researchRecordId,
      userDecision: "researching",
    };
    const [created] = await db.insert(decisionJournalEntries).values(row).returning();
    return created;
  },

  /**
   * Get the journal entry for a research record — null if not found or not owned.
   */
  async getForUser(
    authenticatedUserId: string,
    researchRecordId: string,
  ): Promise<DecisionJournalEntry | null> {
    const rows = await db
      .select()
      .from(decisionJournalEntries)
      .where(
        and(
          eq(decisionJournalEntries.researchRecordId, researchRecordId),
          eq(decisionJournalEntries.userId, authenticatedUserId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Update user-authored fields.
   * Does NOT allow setting entered_manually or closed_manually —
   * those require recordExplicitManualDecision().
   */
  async updateUserAuthoredFields(
    authenticatedUserId: string,
    researchRecordId: string,
    patch: JournalAuthoredFields,
  ): Promise<DecisionJournalEntry | null> {
    // Guard: disallow execution states via this path
    if (
      patch.userDecision === ("entered_manually" as string) ||
      patch.userDecision === ("closed_manually" as string)
    ) {
      throw new JournalError(
        "INVALID_DECISION",
        "Use recordExplicitManualDecision() to set entered_manually or closed_manually",
      );
    }

    const existing = await DecisionJournalService.getForUser(authenticatedUserId, researchRecordId);
    if (!existing) return null;

    const update: Partial<InsertDecisionJournalEntry> = { updatedAt: new Date() };
    if (patch.thesis !== undefined) update.thesis = patch.thesis ? patch.thesis.slice(0, 5_000) : null;
    if (patch.entryPlan !== undefined) update.entryPlan = patch.entryPlan ? patch.entryPlan.slice(0, 5_000) : null;
    if (patch.riskPlan !== undefined) update.riskPlan = patch.riskPlan ? patch.riskPlan.slice(0, 5_000) : null;
    if (patch.exitPlan !== undefined) update.exitPlan = patch.exitPlan ? patch.exitPlan.slice(0, 5_000) : null;
    if (patch.notes !== undefined) update.notes = patch.notes ? patch.notes.slice(0, 10_000) : null;
    if (patch.expectedConditions !== undefined) update.expectedConditions = patch.expectedConditions ? patch.expectedConditions.slice(0, 3_000) : null;
    if (patch.invalidationConditions !== undefined) update.invalidationConditions = patch.invalidationConditions ? patch.invalidationConditions.slice(0, 3_000) : null;
    if (patch.userDecision !== undefined) update.userDecision = patch.userDecision;
    if (patch.outcomeReview !== undefined) update.outcomeReview = patch.outcomeReview ? patch.outcomeReview.slice(0, 5_000) : null;
    if (patch.lessonsLearned !== undefined) update.lessonsLearned = patch.lessonsLearned ? patch.lessonsLearned.slice(0, 5_000) : null;

    const [updated] = await db
      .update(decisionJournalEntries)
      .set(update)
      .where(
        and(
          eq(decisionJournalEntries.researchRecordId, researchRecordId),
          eq(decisionJournalEntries.userId, authenticatedUserId),
        ),
      )
      .returning();
    return updated ?? null;
  },

  /**
   * Record an explicit manual execution decision.
   * This is the ONLY way to set entered_manually or closed_manually.
   * Never infers execution from Trade Builder clicks.
   * No brokerage API calls — purely user-recorded.
   */
  async recordExplicitManualDecision(
    authenticatedUserId: string,
    researchRecordId: string,
    state: ManualExecutionState,
  ): Promise<DecisionJournalEntry | null> {
    const existing = await DecisionJournalService.getForUser(authenticatedUserId, researchRecordId);
    if (!existing) return null;

    const update: Partial<InsertDecisionJournalEntry> = {
      userDecision: state.state,
      updatedAt: new Date(),
    };
    if (state.userRecordedEntryPrice !== undefined) {
      update.userRecordedEntryPrice = state.userRecordedEntryPrice;
    }
    if (state.userRecordedExitPrice !== undefined) {
      update.userRecordedExitPrice = state.userRecordedExitPrice;
    }
    if (state.userRecordedQuantity !== undefined) {
      update.userRecordedQuantity = state.userRecordedQuantity;
    }
    if (state.openedAt !== undefined) update.openedAt = state.openedAt;
    if (state.closedAt !== undefined) update.closedAt = state.closedAt;

    const [updated] = await db
      .update(decisionJournalEntries)
      .set(update)
      .where(
        and(
          eq(decisionJournalEntries.researchRecordId, researchRecordId),
          eq(decisionJournalEntries.userId, authenticatedUserId),
        ),
      )
      .returning();
    return updated ?? null;
  },

  /**
   * Delete the journal entry for a research record.
   */
  async deleteForUser(
    authenticatedUserId: string,
    researchRecordId: string,
  ): Promise<boolean> {
    const existing = await DecisionJournalService.getForUser(authenticatedUserId, researchRecordId);
    if (!existing) return false;

    await db
      .delete(decisionJournalEntries)
      .where(
        and(
          eq(decisionJournalEntries.researchRecordId, researchRecordId),
          eq(decisionJournalEntries.userId, authenticatedUserId),
        ),
      );
    return true;
  },
};
