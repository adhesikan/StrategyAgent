import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { HELP_TOPICS, HELP_PAGES, rankHelpTopics, rankHelpPages, type HelpTopic } from "../services/help/help-knowledge";

const askSchema = z.object({
  question: z.string().trim().min(2).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(1000),
      }),
    )
    .max(8)
    .optional(),
});

export interface HelpAnswer {
  answer: string;
  relatedSections: { id: string; title: string }[];
  suggestedPages: { label: string; path: string }[];
  source: "ai" | "guide";
}

const VALID_SECTION_IDS = new Set(HELP_TOPICS.map((t) => t.id));
const PAGE_BY_PATH = new Map(HELP_PAGES.map((p) => [p.path, p]));

// In-memory per-user rate limits (single-instance). Protects the paid LLM
// endpoint from spam/cost abuse: 10 questions/minute and 100/day per user.
const RATE_PER_MIN = 10;
const RATE_PER_DAY = 100;
const rateBuckets = new Map<string, { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number }>();

function checkRateLimit(userId: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let b = rateBuckets.get(userId);
  if (!b) {
    b = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
    rateBuckets.set(userId, b);
  }
  if (now - b.minuteStart >= 60_000) {
    b.minuteStart = now;
    b.minuteCount = 0;
  }
  if (now - b.dayStart >= 86_400_000) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  if (b.minuteCount >= RATE_PER_MIN) {
    return { ok: false, retryAfterSec: Math.ceil((b.minuteStart + 60_000 - now) / 1000) };
  }
  if (b.dayCount >= RATE_PER_DAY) {
    return { ok: false, retryAfterSec: Math.ceil((b.dayStart + 86_400_000 - now) / 1000) };
  }
  b.minuteCount++;
  b.dayCount++;
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of Array.from(rateBuckets.entries())) {
      if (now - v.dayStart >= 86_400_000) rateBuckets.delete(k);
    }
  }
  return { ok: true };
}

// Circuit breaker: after an OpenAI failure (e.g. quota exhausted), skip the
// API entirely for a cooldown window and serve the guide-based fallback
// immediately — avoids per-request latency and log noise.
let openAiDisabledUntil = 0;
const OPENAI_COOLDOWN_MS = 5 * 60 * 1000;

function buildSystemPrompt(topics: HelpTopic[]): string {
  const kb = topics.map((t) => `## ${t.title} (section id: ${t.id})\n${t.text}`).join("\n\n");
  const pages = HELP_PAGES.map((p) => `- ${p.label} → ${p.path} (${p.hint})`).join("\n");
  return `You are the in-app Help Assistant for VCP Trader AI, an AI-powered stock and options analysis platform. Answer the user's question about how to use the app, concisely (2-5 short sentences), in simple everyday language.

Rules:
- Only answer using the knowledge below. If the question isn't covered, say you're not sure and point the user to the User Guide (/guide).
- Never give investment advice, price predictions, or trade recommendations. If asked, explain the app provides AI-generated analysis only and every order requires the user's own review.
- Do not mention automation or auto-trading as a feature; the app never auto-trades.
- Respond with strict JSON: {"answer": string, "relatedSectionIds": string[] (0-3 guide section ids from the knowledge), "suggestedPaths": string[] (0-2 app paths from the page list)}.

Knowledge:
${kb}

App pages:
${pages}`;
}

// Local search: User Guide topics first, then in-app pages. Returns null when
// neither produces a confident match (score >= 2 keyword/title threshold).
function localAnswer(question: string): HelpAnswer | null {
  const topics = rankHelpTopics(question, 3, 1.9);
  const pages = rankHelpPages(question, 2);

  if (topics.length > 0) {
    const top = topics[0];
    const suggestedPages = [
      { label: "User Guide", path: `/guide/${top.id}` },
      ...pages.filter((p) => p.path !== "/guide").map((p) => ({ label: p.label, path: p.path })),
    ].slice(0, 2);
    return {
      answer: `${top.text} You can read more in the "${top.title}" section of the User Guide.`,
      relatedSections: topics.map((t) => ({ id: t.id, title: t.title })),
      suggestedPages,
      source: "guide",
    };
  }

  if (pages.length > 0 && pages.some((p) => p.path !== "/guide")) {
    const list = pages.map((p) => `${p.label} (${p.hint})`).join(" and ");
    return {
      answer: `That sounds related to ${list}. Open the page below, or browse the User Guide for a full walkthrough.`,
      relatedSections: [],
      suggestedPages: pages.map((p) => ({ label: p.label, path: p.path })),
      source: "guide",
    };
  }

  return null;
}

function fallbackAnswer(question: string): HelpAnswer {
  return (
    localAnswer(question) ?? {
      answer:
        "I couldn't match that to a help topic. Try rephrasing, or browse the User Guide for a full walkthrough of every feature.",
      relatedSections: [],
      suggestedPages: [{ label: "User Guide", path: "/guide" }],
      source: "guide",
    }
  );
}

async function answerWithOpenAi(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<HelpAnswer | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  if (Date.now() < openAiDisabledUntil) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Give the model the most relevant topics plus core orientation topics so
    // cross-cutting questions still get grounded context.
    const ranked = rankHelpTopics(question, 5);
    const ids = new Set(ranked.map((t) => t.id));
    for (const coreId of ["getting-started", "compliance"]) {
      if (!ids.has(coreId)) {
        const core = HELP_TOPICS.find((t) => t.id === coreId);
        if (core) ranked.push(core);
      }
    }
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(ranked) },
        ...history.slice(-6),
        { role: "user", content: question },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      answer?: string;
      relatedSectionIds?: string[];
      suggestedPaths?: string[];
    };
    if (!parsed.answer || typeof parsed.answer !== "string") return null;

    const relatedSections = (parsed.relatedSectionIds ?? [])
      .filter((id): id is string => typeof id === "string" && VALID_SECTION_IDS.has(id))
      .slice(0, 3)
      .map((id) => {
        const t = HELP_TOPICS.find((x) => x.id === id)!;
        return { id, title: t.title };
      });
    const suggestedPages = (parsed.suggestedPaths ?? [])
      .filter((p): p is string => typeof p === "string" && PAGE_BY_PATH.has(p))
      .slice(0, 2)
      .map((p) => ({ label: PAGE_BY_PATH.get(p)!.label, path: p }));

    return { answer: parsed.answer.trim(), relatedSections, suggestedPages, source: "ai" };
  } catch (err) {
    openAiDisabledUntil = Date.now() + OPENAI_COOLDOWN_MS;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[help] OpenAI answer failed (cooling down ${OPENAI_COOLDOWN_MS / 60000}m): ${msg}`);
    return null;
  }
}

export function registerHelpRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.post("/api/help/ask", isAuthenticated, async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Please enter a question (2-500 characters)." });
    }
    const userId = req.session?.userId ?? req.ip ?? "anon";
    const limit = checkRateLimit(String(userId));
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSec ?? 60));
      return res.status(429).json({
        message: "You're asking questions a bit too fast. Please wait a moment and try again.",
      });
    }
    const { question, history = [] } = parsed.data;
    // Search order: 1) User Guide topics, 2) in-app pages, 3) OpenAI as a
    // last resort only when local search finds no confident match.
    const local = localAnswer(question);
    if (local) {
      return res.json(local);
    }
    const aiAnswer = await answerWithOpenAi(question, history);
    const result = aiAnswer ?? fallbackAnswer(question);
    res.json(result);
  });
}
