// Curated reference-answer library. Admins promote graded test runs into
// this table, and the live AI agent (server/routes/ask.ts) injects the most
// relevant references as few-shot examples in its system prompt so it
// actually learns from validator-corrected answers.
//
// Matching is keyword-based (no embeddings): we tokenize the user's question
// into informative words and pick reference answers whose questions share
// the most tokens. Simple, deterministic, and good enough for the small
// hand-curated corpus this feature targets.

import { db } from "../db";
import {
  agentReferenceAnswers,
  agentTestQuestions,
  agentTestRuns,
  type AgentReferenceAnswer,
} from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";

// Common English / trading-jargon stopwords removed before token matching.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "for", "with", "and", "or", "but", "if", "then",
  "this", "that", "these", "those", "it", "its", "as", "at", "by", "from",
  "my", "your", "our", "i", "you", "we", "they", "he", "she", "him", "her",
  "do", "does", "did", "doing", "should", "would", "could", "can", "will",
  "what", "why", "how", "when", "where", "which", "who",
  "about", "into", "out", "up", "down", "off", "over", "under",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])
    .filter((t) => !STOPWORDS.has(t));
}

// Promote a test run into the reference library. Upserts by questionId so
// re-promoting the same question replaces the previous reference.
export class PromoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoteValidationError";
  }
}

export async function promoteRunToReference(runId: string): Promise<AgentReferenceAnswer | null> {
  const [run] = await db.select().from(agentTestRuns).where(eq(agentTestRuns.id, runId)).limit(1);
  if (!run) return null;
  const [q] = await db.select().from(agentTestQuestions).where(eq(agentTestQuestions.id, run.questionId)).limit(1);
  if (!q) return null;
  // Guardrails: only promote high-quality, non-empty answers so the few-shot
  // library doesn't poison live answers with weak or failing responses.
  if (!run.aiAnswer || run.aiAnswer.trim().length < 40) {
    throw new PromoteValidationError("Answer is empty or too short to use as a reference.");
  }
  if (run.status === "fail" || run.status === "hard_fail" || run.status === "error") {
    throw new PromoteValidationError(`Cannot promote a ${run.status} run — re-run or apply suggestion first.`);
  }
  const existing = await db
    .select()
    .from(agentReferenceAnswers)
    .where(eq(agentReferenceAnswers.questionId, run.questionId))
    .limit(1);
  const now = new Date();
  if (existing.length > 0) {
    const [updated] = await db
      .update(agentReferenceAnswers)
      .set({
        question: q.question,
        category: q.category,
        referenceAnswer: run.aiAnswer,
        score: run.score,
        sourceRunId: run.id,
        updatedAt: now,
      })
      .where(eq(agentReferenceAnswers.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(agentReferenceAnswers)
    .values({
      questionId: run.questionId,
      question: q.question,
      category: q.category,
      referenceAnswer: run.aiAnswer,
      score: run.score,
      sourceRunId: run.id,
    })
    .returning();
  return created;
}

export async function listReferenceAnswers(): Promise<AgentReferenceAnswer[]> {
  return db.select().from(agentReferenceAnswers).orderBy(desc(agentReferenceAnswers.updatedAt));
}

export async function deleteReferenceAnswer(id: string): Promise<boolean> {
  const result = await db.delete(agentReferenceAnswers).where(eq(agentReferenceAnswers.id, id)).returning();
  return result.length > 0;
}

// Look up the top-N reference answers most relevant to the user's question.
// Returns at most `limit` rows, only when keyword overlap is non-trivial
// (≥2 shared tokens) so irrelevant examples don't dilute the prompt.
export async function findRelevantReferences(question: string, limit = 3): Promise<AgentReferenceAnswer[]> {
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];
  const all = await db.select().from(agentReferenceAnswers);
  if (all.length === 0) return [];
  const scored = all
    .map((ref) => {
      const refTokens = new Set(tokenize(ref.question));
      let overlap = 0;
      for (const t of tokens) if (refTokens.has(t)) overlap += 1;
      return { ref, overlap };
    })
    .filter((r) => r.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map((r) => r.ref);
  return scored;
}

// Compact, user-safe summary of a matched reference. We deliberately omit
// `referenceAnswer` so the API contract stays small and doesn't leak the
// raw curated text into the client.
export interface ReferenceUsedSummary {
  id: string;
  questionId: string;
  question: string;
  category: string;
}

// Format the top references as a compact prompt block the agent can consume.
// Also returns the list of which references were injected so the API layer
// can surface them to users as a transparency footer.
export async function buildReferencePromptBlock(
  question: string,
  limit = 3,
): Promise<{ block: string; used: ReferenceUsedSummary[] }> {
  const refs = await findRelevantReferences(question, limit);
  if (refs.length === 0) return { block: "", used: [] };
  const lines: string[] = [
    "REFERENCE ANSWERS (curated by admins — match the structure, depth, and risk framing of these examples when the user's question is similar):",
  ];
  for (const r of refs) {
    lines.push("");
    lines.push(`Q (${r.category}): ${r.question}`);
    lines.push(`Reference A: ${r.referenceAnswer}`);
  }
  return {
    block: lines.join("\n"),
    used: refs.map((r) => ({ id: r.id, questionId: r.questionId, question: r.question, category: r.category })),
  };
}

// Bulk promote multiple runs. Skips any run that fails the
// PromoteValidationError guardrails (empty / failed / errored), collecting
// per-run results so the caller can show the user what was published vs
// skipped.
export async function promoteRunsBulk(runIds: string[]): Promise<{
  promoted: AgentReferenceAnswer[];
  skipped: { runId: string; reason: string }[];
}> {
  const promoted: AgentReferenceAnswer[] = [];
  const skipped: { runId: string; reason: string }[] = [];
  for (const id of runIds) {
    try {
      const ref = await promoteRunToReference(id);
      if (!ref) {
        skipped.push({ runId: id, reason: "Run or question not found" });
      } else {
        promoted.push(ref);
      }
    } catch (err: any) {
      skipped.push({ runId: id, reason: err.message ?? "Unknown error" });
    }
  }
  return { promoted, skipped };
}

// Best-effort accessor used by the bumping trigger; ensures touching a
// reference also bumps `updatedAt` for the simple recency ordering above.
export async function touchReferenceUpdatedAt(id: string): Promise<void> {
  await db
    .update(agentReferenceAnswers)
    .set({ updatedAt: sql`now()` })
    .where(eq(agentReferenceAnswers.id, id));
}
