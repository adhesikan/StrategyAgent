/**
 * Research Workspace Routes — Sprint 2.5.2
 *
 * POST /api/research/ask                           — main AI research endpoint
 * GET  /api/research/conversations                 — list saved conversations
 * POST /api/research/conversations                 — create conversation + first message
 * GET  /api/research/conversations/:id             — get conversation with messages
 * DELETE /api/research/conversations/:id           — delete conversation
 * PATCH /api/research/conversations/:id/pin        — pin / unpin
 * GET  /api/research/templates                     — prompt templates
 *
 * AUTH: all routes require isAuthenticated.
 * COMPLIANCE: never uses "recommendation", "buy", "sell", "target price".
 */

import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "../db";
import { eq, and, desc, count } from "drizzle-orm";
import { workspaceConversations, workspaceMessages } from "../../shared/schema";
import {
  assembleResearchContext,
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  buildRuleBasedWorkspaceResponse,
  parseAIWorkspaceResponse,
} from "../services/research-workspace-service";
import {
  RESEARCH_TEMPLATES,
  RESEARCH_MODE_LABELS,
} from "../../shared/research-workspace-types";
import type {
  ResearchMode,
  ContextScope,
  WorkspaceAskRequest,
  ConversationListResponse,
} from "../../shared/research-workspace-types";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userId(req: Request): string {
  return (req.session as any).userId as string;
}

const VALID_MODES: ResearchMode[] = [
  "opportunity", "company", "theme", "sector",
  "institutional", "market", "collection", "comparison",
];

const DISCLAIMER = "This analysis summarizes deterministic research generated from market data and predefined qualification rules. It is not personalized investment advice.";

// ---------------------------------------------------------------------------
// OpenAI call (re-uses project pattern from ask.ts)
// ---------------------------------------------------------------------------

async function callWorkspaceAI(systemPrompt: string, userMessage: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.error("[ResearchWorkspace] OpenAI error:", (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-generate conversation title
// ---------------------------------------------------------------------------

function generateTitle(question: string, mode: ResearchMode, scope: string): string {
  const modeLabel = RESEARCH_MODE_LABELS[mode] ?? mode;
  const q = question.slice(0, 60).trim();
  return q.length > 20 ? q : `${modeLabel} — ${scope}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerResearchWorkspaceRoutes(
  app:             Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/research/templates ───────────────────────────────────────────
  app.get("/api/research/templates", isAuthenticated, (_req: Request, res: Response) => {
    return res.json({ templates: RESEARCH_TEMPLATES });
  });

  // ── POST /api/research/ask ────────────────────────────────────────────────
  app.post("/api/research/ask", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const body: WorkspaceAskRequest = req.body ?? {};

    // Validate
    const question    = (body.question ?? "").trim();
    const mode        = body.researchMode ?? "opportunity";
    const scope       = body.contextScope ?? "entire_market";
    const tickers     = Array.isArray(body.tickers) ? body.tickers.slice(0, 4).map(t => String(t).toUpperCase()) : [];
    const convId      = body.conversationId;

    if (!question || question.length < 3) {
      return res.status(400).json({ error: "question is required (min 3 characters)" });
    }
    if (!VALID_MODES.includes(mode as ResearchMode)) {
      return res.status(400).json({ error: `Invalid researchMode. Valid values: ${VALID_MODES.join(", ")}` });
    }

    try {
      // 1. Assemble context
      const ctx = await assembleResearchContext(uid, mode as ResearchMode, scope as ContextScope, tickers);

      // 2. Build prompts
      const systemPrompt = buildResearchSystemPrompt(mode as ResearchMode, ctx);
      const userMessage  = buildResearchUserMessage(question, ctx);

      // 3. Call AI or rule-based fallback
      let aiResponse = await callWorkspaceAI(systemPrompt, userMessage);
      let workspaceResponse = aiResponse
        ? parseAIWorkspaceResponse(aiResponse, mode as ResearchMode, scope as ContextScope, ctx)
        : buildRuleBasedWorkspaceResponse(question, ctx, mode as ResearchMode, scope as ContextScope);

      // 4. Persist conversation + messages
      let conversationId = convId;

      if (!conversationId) {
        // Create new conversation
        const [conv] = await db.insert(workspaceConversations).values({
          userId:       uid,
          title:        generateTitle(question, mode as ResearchMode, ctx.scopeLabel),
          researchMode: mode,
          contextScope: scope,
          tickers:      tickers.length > 0 ? tickers : workspaceResponse.referencedTickers.slice(0, 4),
          isPinned:     false,
          lastMessageAt: new Date(),
        }).returning();
        conversationId = conv.id;
      } else {
        // Verify ownership + update lastMessageAt
        const [existing] = await db.select({ id: workspaceConversations.id })
          .from(workspaceConversations)
          .where(and(
            eq(workspaceConversations.id, conversationId),
            eq(workspaceConversations.userId, uid),
          ))
          .limit(1);
        if (!existing) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        await db.update(workspaceConversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(workspaceConversations.id, conversationId));
      }

      // Persist user message
      const [userMsg] = await db.insert(workspaceMessages).values({
        conversationId,
        role:      "user",
        plainText: question,
      }).returning();

      // Persist assistant message (strip large arrays to keep DB lean)
      const [assistantMsg] = await db.insert(workspaceMessages).values({
        conversationId,
        role:              "assistant",
        structuredContent: {
          ...workspaceResponse,
          referencedOpportunities: workspaceResponse.referencedOpportunities?.slice(0, 5).map(o => ({
            symbol: o.symbol, companyName: o.companyName, researchScore: o.researchScore,
          })),
        },
      }).returning();

      return res.json({
        conversationId,
        messageId: assistantMsg.id,
        userMessageId: userMsg.id,
        response: workspaceResponse,
        disclaimer: DISCLAIMER,
      });

    } catch (err) {
      console.error("[ResearchWorkspace] POST /api/research/ask error:", (err as Error).message);
      return res.status(500).json({ error: "Research request failed" });
    }
  });

  // ── GET /api/research/conversations ──────────────────────────────────────
  app.get("/api/research/conversations", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    try {
      const all = await db.select()
        .from(workspaceConversations)
        .where(eq(workspaceConversations.userId, uid))
        .orderBy(desc(workspaceConversations.lastMessageAt));

      const pinned = all.filter(c => c.isPinned);
      const recent = all.filter(c => !c.isPinned).slice(0, 20);

      const toSummary = (c: typeof all[0]) => ({
        id:            c.id,
        title:         c.title,
        researchMode:  c.researchMode as ResearchMode,
        contextScope:  c.contextScope as ContextScope,
        tickers:       c.tickers ?? [],
        isPinned:      c.isPinned,
        pinnedAt:      c.pinnedAt?.toISOString(),
        lastMessageAt: c.lastMessageAt.toISOString(),
        createdAt:     c.createdAt.toISOString(),
      });

      const result: ConversationListResponse = {
        pinned: pinned.map(toSummary),
        recent: recent.map(toSummary),
        all:    all.map(toSummary),
      };

      return res.json(result);
    } catch (err) {
      console.error("[ResearchWorkspace] GET /api/research/conversations error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to list conversations" });
    }
  });

  // ── GET /api/research/conversations/:id ──────────────────────────────────
  app.get("/api/research/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const { id } = req.params;

    try {
      const [conv] = await db.select()
        .from(workspaceConversations)
        .where(and(
          eq(workspaceConversations.id, id),
          eq(workspaceConversations.userId, uid),
        ))
        .limit(1);

      if (!conv) return res.status(404).json({ error: "Conversation not found" });

      const messages = await db.select()
        .from(workspaceMessages)
        .where(eq(workspaceMessages.conversationId, id))
        .orderBy(workspaceMessages.createdAt);

      return res.json({
        conversation: {
          id:            conv.id,
          title:         conv.title,
          researchMode:  conv.researchMode,
          contextScope:  conv.contextScope,
          tickers:       conv.tickers ?? [],
          isPinned:      conv.isPinned,
          pinnedAt:      conv.pinnedAt?.toISOString(),
          lastMessageAt: conv.lastMessageAt.toISOString(),
          createdAt:     conv.createdAt.toISOString(),
          messages: messages.map(m => ({
            id:        m.id,
            role:      m.role,
            plainText: m.plainText,
            response:  m.structuredContent,
            createdAt: m.createdAt.toISOString(),
          })),
        },
      });
    } catch (err) {
      console.error("[ResearchWorkspace] GET /api/research/conversations/:id error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to get conversation" });
    }
  });

  // ── DELETE /api/research/conversations/:id ────────────────────────────────
  app.delete("/api/research/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const { id } = req.params;

    try {
      const [existing] = await db.select({ id: workspaceConversations.id })
        .from(workspaceConversations)
        .where(and(
          eq(workspaceConversations.id, id),
          eq(workspaceConversations.userId, uid),
        ))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Conversation not found" });

      await db.delete(workspaceMessages).where(eq(workspaceMessages.conversationId, id));
      await db.delete(workspaceConversations).where(eq(workspaceConversations.id, id));

      return res.json({ success: true, message: "Conversation deleted" });
    } catch (err) {
      console.error("[ResearchWorkspace] DELETE /:id error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // ── PATCH /api/research/conversations/:id/pin ────────────────────────────
  app.patch("/api/research/conversations/:id/pin", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const { id } = req.params;
    const pinned: boolean = req.body?.pinned !== false;

    try {
      const [existing] = await db.select({ id: workspaceConversations.id })
        .from(workspaceConversations)
        .where(and(
          eq(workspaceConversations.id, id),
          eq(workspaceConversations.userId, uid),
        ))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Conversation not found" });

      await db.update(workspaceConversations)
        .set({
          isPinned:  pinned,
          pinnedAt:  pinned ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(workspaceConversations.id, id));

      return res.json({ success: true, isPinned: pinned });
    } catch (err) {
      console.error("[ResearchWorkspace] PATCH /:id/pin error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to update pin state" });
    }
  });
}
