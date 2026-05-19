// Admin AI Agent Test Suite routes. Mounted from server/routes.ts as
//   app.use("/api/admin/agent-tests", isAuthenticated, isAdmin, router)
// so every endpoint is admin-gated.

import { Router } from "express";
import {
  applySuggestionAndRevalidate,
  getJob,
  listQuestions,
  listRecentRuns,
  runSingleTest,
  startBatchJob,
} from "../services/agent-test-runner";
import {
  deleteReferenceAnswer,
  listReferenceAnswers,
  promoteRunToReference,
  promoteRunsBulk,
  PromoteValidationError,
} from "../services/agent-reference-answers";
import { seedAgentTestQuestions } from "../services/agent-test-seed";
import { db } from "../db";
import { agentTestQuestions } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/questions", async (_req, res) => {
  try {
    const rows = await listQuestions();
    res.json({ questions: rows });
  } catch (err: any) {
    console.error("[admin-agent-tests] list questions failed:", err);
    res.status(500).json({ error: "Failed to load questions" });
  }
});

router.get("/runs", async (_req, res) => {
  try {
    const rows = await listRecentRuns(1000);
    res.json({ runs: rows });
  } catch (err: any) {
    console.error("[admin-agent-tests] list runs failed:", err);
    res.status(500).json({ error: "Failed to load runs" });
  }
});

router.post("/seed", async (_req, res) => {
  try {
    const result = await seedAgentTestQuestions();
    res.json(result);
  } catch (err: any) {
    console.error("[admin-agent-tests] seed failed:", err);
    res.status(500).json({ error: "Seed failed: " + err.message });
  }
});

router.post("/run", async (req: any, res) => {
  const userId = req.session?.userId as string;
  const { questionId } = req.body ?? {};
  if (!questionId || typeof questionId !== "string") {
    return res.status(400).json({ error: "questionId required" });
  }
  try {
    const [q] = await db.select().from(agentTestQuestions).where(eq(agentTestQuestions.id, questionId)).limit(1);
    if (!q) return res.status(404).json({ error: "Question not found" });
    const result = await runSingleTest(q, userId);
    res.json(result);
  } catch (err: any) {
    console.error("[admin-agent-tests] run single failed:", err);
    res.status(500).json({ error: "Run failed: " + err.message });
  }
});

router.post("/run-batch", async (req: any, res) => {
  const userId = req.session?.userId as string;
  const { category, questionIds } = req.body ?? {};
  try {
    const jobId = startBatchJob(
      {
        category: typeof category === "string" && category ? category : undefined,
        questionIds: Array.isArray(questionIds) ? questionIds.filter((x) => typeof x === "string") : undefined,
      },
      userId,
    );
    res.json({ jobId });
  } catch (err: any) {
    console.error("[admin-agent-tests] start batch failed:", err);
    res.status(500).json({ error: "Batch start failed: " + err.message });
  }
});

router.post("/runs/:id/apply-suggestion", async (req, res) => {
  try {
    const result = await applySuggestionAndRevalidate(req.params.id);
    if (!result) return res.status(404).json({ error: "Run, question, or suggestion missing" });
    res.json(result);
  } catch (err: any) {
    console.error("[admin-agent-tests] apply-suggestion failed:", err);
    res.status(500).json({ error: "Apply failed: " + err.message });
  }
});

router.get("/reference-answers", async (_req, res) => {
  try {
    const refs = await listReferenceAnswers();
    res.json({ references: refs });
  } catch (err: any) {
    console.error("[admin-agent-tests] list refs failed:", err);
    res.status(500).json({ error: "Failed to load references" });
  }
});

router.post("/runs/:id/promote-to-reference", async (req, res) => {
  try {
    const ref = await promoteRunToReference(req.params.id);
    if (!ref) return res.status(404).json({ error: "Run or question not found" });
    res.json({ reference: ref });
  } catch (err: any) {
    if (err instanceof PromoteValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[admin-agent-tests] promote failed:", err);
    res.status(500).json({ error: "Promote failed: " + err.message });
  }
});

// Bulk-promote a batch of runs into the reference library. Body shape:
//   { runIds: string[] }   — promote exactly these runs
//   { all: true }          — promote every run currently shown by listRecentRuns
// Returns per-run results so the UI can show "X published, Y skipped".
router.post("/promote-bulk", async (req, res) => {
  try {
    const body = req.body ?? {};
    let runIds: string[] = [];
    if (Array.isArray(body.runIds) && body.runIds.length > 0) {
      runIds = body.runIds.filter((x: any) => typeof x === "string");
    } else if (body.all === true) {
      // Match the limit used by GET /runs (which feeds the admin UI) so
      // "Publish All" can never silently miss a row the user can see.
      const runs = await listRecentRuns(5000);
      runIds = runs.map((r) => r.id);
    } else {
      return res.status(400).json({ error: "Provide runIds[] or all: true" });
    }
    if (runIds.length === 0) {
      return res.json({ promoted: [], skipped: [], summary: { requested: 0, promoted: 0, skipped: 0 } });
    }
    const { promoted, skipped } = await promoteRunsBulk(runIds);
    res.json({
      promoted,
      skipped,
      summary: { requested: runIds.length, promoted: promoted.length, skipped: skipped.length },
    });
  } catch (err: any) {
    console.error("[admin-agent-tests] bulk promote failed:", err);
    res.status(500).json({ error: "Bulk promote failed: " + err.message });
  }
});

router.delete("/reference-answers/:id", async (req, res) => {
  try {
    const ok = await deleteReferenceAnswer(req.params.id);
    if (!ok) return res.status(404).json({ error: "Reference not found" });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[admin-agent-tests] delete ref failed:", err);
    res.status(500).json({ error: "Delete failed: " + err.message });
  }
});

router.get("/job/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

router.get("/export.json", async (_req, res) => {
  try {
    const runs = await listRecentRuns(5000);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="agent-test-runs-${Date.now()}.json"`);
    res.json({ exportedAt: new Date().toISOString(), count: runs.length, runs });
  } catch (err: any) {
    res.status(500).json({ error: "Export failed" });
  }
});

router.get("/export.csv", async (_req, res) => {
  try {
    const runs = await listRecentRuns(5000);
    // CSV with the most useful columns. Escape quotes, drop newlines from
    // long-form fields, and defuse CSV-injection vectors by prefixing any
    // value starting with =, +, -, @, tab, or CR with a single quote so
    // Excel/Sheets render it as text rather than executing a formula.
    const esc = (v: unknown): string => {
      let s = v == null ? "" : String(v).replace(/[\r\n]+/g, " ").replace(/"/g, '""');
      if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s}"`;
    };
    const header = [
      "id",
      "createdAt",
      "category",
      "difficulty",
      "question",
      "score",
      "status",
      "aiAnswer",
      "complianceIssues",
      "missingConcepts",
    ].join(",");
    const lines = [header];
    for (const r of runs) {
      const v = (r.validationJson ?? {}) as Record<string, unknown>;
      lines.push(
        [
          esc(r.id),
          esc(r.createdAt),
          esc(r.category),
          esc(r.difficulty),
          esc(r.question),
          esc(r.score),
          esc(r.status),
          esc(r.aiAnswer),
          esc((v.complianceIssues as string[] | undefined)?.join(" | ") ?? ""),
          esc((v.missingConcepts as string[] | undefined)?.join(" | ") ?? ""),
        ].join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="agent-test-runs-${Date.now()}.csv"`);
    res.send(lines.join("\n"));
  } catch (err: any) {
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
