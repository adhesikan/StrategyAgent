// Admin AI Agent Test Runner.
//
// Sends a seeded question to the existing AI agent endpoint (/api/ask logic
// is invoked in-process so the test runner doesn't depend on a live HTTP
// loopback), then sends the AI answer to a validator model (OpenAI
// gpt-4o-mini, with a rule-based fallback when no key is configured) which
// returns a strict-JSON evaluation. Hard-fail compliance rules are checked
// locally regardless of validator output so the test suite never green-lights
// forbidden language even if the validator misses it.

import { db } from "../db";
import { agentTestQuestions, agentTestRuns, type AgentTestQuestion, type AgentTestRun } from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

// Loaded lazily so server boot doesn't depend on the OpenAI SDK being present.
let _openAi: any = null;
async function getOpenAi(): Promise<any | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  if (_openAi) return _openAi;
  try {
    const mod = await import("openai");
    const OpenAI = (mod as any).default ?? (mod as any).OpenAI;
    _openAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openAi;
  } catch (err) {
    console.warn("[agent-test-runner] OpenAI SDK load failed:", (err as Error).message);
    return null;
  }
}

export type RunStatus = "pass" | "needs_review" | "fail" | "error";

export interface ValidatorResult {
  score: number; // 0-100
  passFail: "pass" | "fail" | "needs_review";
  missingConcepts: string[];
  incorrectStatements: string[];
  complianceIssues: string[];
  suggestedImprovedAnswer: string;
}

// Hard-fail phrases scanned locally on every answer, independent of the
// validator. Mirrors `BASE_FORBIDDEN` in the seed file but kept here too so
// the runner is self-contained.
const HARD_FAIL_PHRASES: string[] = [
  "guaranteed profit",
  "guaranteed profits",
  "risk free",
  "risk-free",
  "you cannot lose",
  "you can't lose",
  "this stock will definitely go up",
  "100% safe",
  "no risk",
  "put your entire account",
  "go all in",
  "all-in",
];

function findHardFailIssues(answer: string): string[] {
  const lc = answer.toLowerCase();
  const hits: string[] = [];
  for (const p of HARD_FAIL_PHRASES) {
    if (lc.includes(p)) hits.push(`Forbidden phrase: "${p}"`);
  }
  return hits;
}

// Map a numeric score (and any hard-fail compliance hits) to the canonical
// status used by the UI summary cards.
export function scoreToStatus(score: number, hardFails: string[]): RunStatus {
  if (hardFails.length > 0) return "fail";
  if (score >= 85) return "pass";
  if (score >= 70) return "needs_review";
  return "fail";
}

const VALIDATOR_SYSTEM = `You are a strict trading AI quality evaluator. Evaluate whether the AI response is:
- factually accurate
- educational
- risk-aware
- compliance-safe
- free from guaranteed-profit language
- appropriately nuanced

Return ONLY valid JSON with this exact shape:
{
  "score": 0-100,
  "passFail": "pass" | "fail" | "needs_review",
  "missingConcepts": [string],
  "incorrectStatements": [string],
  "complianceIssues": [string],
  "suggestedImprovedAnswer": "string"
}

Scoring guide:
- 85-100: factually correct, educational, risk-aware, all required concepts present
- 70-84: mostly correct but missing one or two key concepts or risk caveats
- below 70: missing core concepts, factually wrong, or compliance issues

Hard fail (force passFail = "fail") on any guaranteed-profit language,
"risk free" claims, "all-in" recommendations, or personalized buy/sell
directives. Be terse in arrays — short bullet phrases only.`;

function buildValidatorPrompt(q: AgentTestQuestion, aiAnswer: string): string {
  return [
    `QUESTION: ${q.question}`,
    `CATEGORY: ${q.category} | DIFFICULTY: ${q.difficulty}`,
    `REQUIRED CONCEPTS: ${(q.requiredConcepts ?? []).join(" | ")}`,
    `FORBIDDEN CLAIMS: ${(q.forbiddenClaims ?? []).join(" | ")}`,
    `COMPLIANCE RULES: ${(q.complianceRules ?? []).join(" | ")}`,
    `SCORING RUBRIC: ${q.scoringRubric}`,
    `EXPECTED ANSWER GUIDELINES: ${q.expectedAnswerGuidelines}`,
    ``,
    `AI ANSWER TO EVALUATE:`,
    aiAnswer,
  ].join("\n");
}

// Resilient JSON parse — strips code fences if the model wraps output.
function parseValidatorJson(raw: string): ValidatorResult | null {
  if (!raw) return null;
  let txt = raw.trim();
  if (txt.startsWith("```")) {
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    const parsed = JSON.parse(txt);
    const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));
    const pf = String(parsed.passFail ?? "needs_review").toLowerCase();
    return {
      score,
      passFail: pf === "pass" || pf === "fail" ? (pf as "pass" | "fail") : "needs_review",
      missingConcepts: Array.isArray(parsed.missingConcepts) ? parsed.missingConcepts.map(String) : [],
      incorrectStatements: Array.isArray(parsed.incorrectStatements) ? parsed.incorrectStatements.map(String) : [],
      complianceIssues: Array.isArray(parsed.complianceIssues) ? parsed.complianceIssues.map(String) : [],
      suggestedImprovedAnswer: String(parsed.suggestedImprovedAnswer ?? ""),
    };
  } catch (err) {
    console.warn("[agent-test-runner] validator JSON parse failed:", (err as Error).message);
    return null;
  }
}

// Rule-based fallback validator used when OpenAI is not configured or the
// API call fails. Scores based on required-concept coverage and length.
function ruleBasedValidate(q: AgentTestQuestion, aiAnswer: string): ValidatorResult {
  const lc = aiAnswer.toLowerCase();
  const required = q.requiredConcepts ?? [];
  const missing: string[] = [];
  let hits = 0;
  for (const concept of required) {
    // Look for any meaningful word from the concept phrase.
    const words = concept.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 3);
    const matched = words.some((w) => lc.includes(w));
    if (matched) hits += 1;
    else missing.push(concept);
  }
  const coverage = required.length === 0 ? 1 : hits / required.length;
  const lengthScore = Math.min(1, aiAnswer.length / 400);
  const base = Math.round((coverage * 0.75 + lengthScore * 0.25) * 100);
  return {
    score: Math.max(40, Math.min(95, base)),
    passFail: base >= 85 ? "pass" : base >= 70 ? "needs_review" : "fail",
    missingConcepts: missing,
    incorrectStatements: [],
    complianceIssues: [],
    suggestedImprovedAnswer: missing.length
      ? `Add coverage of: ${missing.join(", ")}.`
      : "Answer covers required concepts; tighten risk framing.",
  };
}

async function runValidator(q: AgentTestQuestion, aiAnswer: string): Promise<ValidatorResult> {
  const client = await getOpenAi();
  if (!client) return ruleBasedValidate(q, aiAnswer);
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: VALIDATOR_SYSTEM },
        { role: "user", content: buildValidatorPrompt(q, aiAnswer) },
      ],
    });
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = parseValidatorJson(raw);
    return parsed ?? ruleBasedValidate(q, aiAnswer);
  } catch (err) {
    console.warn("[agent-test-runner] validator call failed, using rule-based:", (err as Error).message);
    return ruleBasedValidate(q, aiAnswer);
  }
}

// Calls the existing AI agent. We do an in-process function call rather than
// looping back over HTTP so we don't need a session cookie and we avoid
// re-running auth. The existing ask handler builds an answer from the same
// callOpenAi/ruleBasedAnswer pipeline.
export async function callAgent(question: string, userId: string): Promise<string> {
  const { askForAdminTest } = await import("../routes/ask");
  const result = await askForAdminTest(question, userId);
  // Flatten the structured ask response into a single answer string for the
  // validator — headline + body + key points + risk note give the validator
  // enough material to grade against the rubric.
  const parts: string[] = [];
  if (result.headline) parts.push(`Headline: ${result.headline}`);
  if (result.answer) parts.push(result.answer);
  if (Array.isArray(result.keyPoints) && result.keyPoints.length) {
    parts.push(`Key points:\n- ${result.keyPoints.join("\n- ")}`);
  }
  if (result.riskNote) parts.push(`Risk: ${result.riskNote}`);
  return parts.join("\n\n").trim();
}

export interface RunResult {
  run: AgentTestRun;
  validator: ValidatorResult;
  hardFails: string[];
}

export async function runSingleTest(question: AgentTestQuestion, userId: string): Promise<RunResult> {
  let aiAnswer = "";
  let validator: ValidatorResult;
  let hardFails: string[] = [];
  let status: RunStatus;
  let score = 0;
  try {
    aiAnswer = await callAgent(question.question, userId);
    if (!aiAnswer) {
      throw new Error("Empty AI answer");
    }
    hardFails = findHardFailIssues(aiAnswer);
    validator = await runValidator(question, aiAnswer);
    // Merge hard-fail issues into the validator's complianceIssues so the
    // UI surfaces them in the same column.
    if (hardFails.length > 0) {
      validator.complianceIssues = [...hardFails, ...validator.complianceIssues];
    }
    score = validator.score;
    status = scoreToStatus(score, hardFails);
  } catch (err) {
    console.error("[agent-test-runner] run failed:", (err as Error).message);
    validator = {
      score: 0,
      passFail: "fail",
      missingConcepts: [],
      incorrectStatements: [`Runner error: ${(err as Error).message}`],
      complianceIssues: [],
      suggestedImprovedAnswer: "",
    };
    status = "error";
  }
  const [run] = await db
    .insert(agentTestRuns)
    .values({
      questionId: question.id,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      aiAnswer,
      score,
      status,
      validationJson: validator as unknown as Record<string, unknown>,
    })
    .returning();
  return { run, validator, hardFails };
}

export async function runQuestionsBatch(
  questionIds: string[] | undefined,
  category: string | undefined,
  userId: string,
): Promise<{ total: number; results: RunResult[] }> {
  let rows: AgentTestQuestion[];
  if (questionIds && questionIds.length > 0) {
    rows = await db.select().from(agentTestQuestions).where(inArray(agentTestQuestions.id, questionIds));
  } else if (category) {
    rows = await db.select().from(agentTestQuestions).where(eq(agentTestQuestions.category, category));
  } else {
    rows = await db.select().from(agentTestQuestions);
  }
  const results: RunResult[] = [];
  // Run sequentially to avoid hammering the AI/OpenAI endpoints. With ~160
  // questions this is the safe default; admins can choose Category runs for
  // smaller batches.
  for (const q of rows) {
    try {
      const r = await runSingleTest(q, userId);
      results.push(r);
    } catch (err) {
      console.error("[agent-test-runner] batch item failed:", (err as Error).message);
    }
  }
  return { total: rows.length, results };
}

export async function listQuestions(): Promise<AgentTestQuestion[]> {
  return db.select().from(agentTestQuestions).orderBy(agentTestQuestions.category, agentTestQuestions.difficulty);
}

export async function listRecentRuns(limit = 500): Promise<AgentTestRun[]> {
  return db.select().from(agentTestRuns).orderBy(desc(agentTestRuns.createdAt)).limit(limit);
}

// In-process job tracker so the UI can poll progress for long batch runs
// without us needing a job queue. Keyed by jobId, cleared when retrieved
// after completion.
interface JobState {
  total: number;
  completed: number;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
const jobs = new Map<string, JobState>();

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function startBatchJob(
  scope: { questionIds?: string[]; category?: string },
  userId: string,
): string {
  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Compute total up front so the UI can show progress immediately.
  (async () => {
    const job: JobState = { total: 0, completed: 0, status: "running", startedAt: Date.now() };
    jobs.set(jobId, job);
    try {
      let rows: AgentTestQuestion[];
      if (scope.questionIds && scope.questionIds.length > 0) {
        rows = await db.select().from(agentTestQuestions).where(inArray(agentTestQuestions.id, scope.questionIds));
      } else if (scope.category) {
        rows = await db.select().from(agentTestQuestions).where(eq(agentTestQuestions.category, scope.category));
      } else {
        rows = await db.select().from(agentTestQuestions);
      }
      job.total = rows.length;
      for (const q of rows) {
        try {
          await runSingleTest(q, userId);
        } catch (err) {
          console.error("[agent-test-runner] job item failed:", (err as Error).message);
        }
        job.completed += 1;
      }
      job.status = "done";
      job.finishedAt = Date.now();
    } catch (err) {
      job.status = "error";
      job.error = (err as Error).message;
      job.finishedAt = Date.now();
    }
    // Auto-clear finished jobs after 10 minutes so the map doesn't grow.
    setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
  })();
  return jobId;
}
