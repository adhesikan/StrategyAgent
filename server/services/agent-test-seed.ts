// Idempotent seeder for the admin AI Agent Test Suite question bank.
// Runs at admin request (POST /api/admin/agent-tests/seed) and upserts the
// canonical 160 questions by exact question text. Existing rows have their
// concepts/rules refreshed; missing rows are inserted.

import { db } from "../db";
import { agentTestQuestions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SEED_AGENT_TEST_QUESTIONS } from "../data/agent-test-questions";

export async function seedAgentTestQuestions(): Promise<{ inserted: number; updated: number; total: number }> {
  let inserted = 0;
  let updated = 0;
  for (const q of SEED_AGENT_TEST_QUESTIONS) {
    const existing = await db
      .select({ id: agentTestQuestions.id })
      .from(agentTestQuestions)
      .where(eq(agentTestQuestions.question, q.question))
      .limit(1);
    if (existing.length > 0) {
      // jsonb array columns with sql defaults get inferred as `string[] |
      // SQL | undefined` by drizzle-zod, so cast to the insert shape.
      await db
        .update(agentTestQuestions)
        .set({
          category: q.category,
          difficulty: q.difficulty,
          expectedAnswerGuidelines: q.expectedAnswerGuidelines,
          requiredConcepts: q.requiredConcepts as string[],
          forbiddenClaims: q.forbiddenClaims as string[],
          complianceRules: q.complianceRules as string[],
          scoringRubric: q.scoringRubric,
        })
        .where(eq(agentTestQuestions.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(agentTestQuestions).values(q as any);
      inserted += 1;
    }
  }
  return { inserted, updated, total: SEED_AGENT_TEST_QUESTIONS.length };
}
