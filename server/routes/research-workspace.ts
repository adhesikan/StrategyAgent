/**
 * Research Workspace Routes — Sprint 2.6.4
 *
 * GET  /api/research-workspace/context             — assemble canonical ResearchContext
 * POST /api/research/ask                           — main AI research endpoint
 * GET  /api/research/conversations                 — list saved conversations
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
  assembleCanonicalContext,
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  buildRuleBasedWorkspaceResponse,
  parseAIWorkspaceResponse,
  recordContextRequest,
  recordAskRequest,
  recordPartialContext,
} from "../services/research-workspace-service";
import {
  RESEARCH_TEMPLATES,
  RESEARCH_MODE_LABELS,
} from "../../shared/research-workspace-types";
import type {
  ResearchMode,
  ResearchContextType,
  ContextScope,
  WorkspaceAskRequest,
  ConversationListResponse,
  ConversationSummary,
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

const VALID_CONTEXT_TYPES: ResearchContextType[] = [
  "market", "opportunity", "company", "theme", "sector",
  "institutional", "collection", "comparison", "monitor",
  "report", "portfolio", "portfolio_holding", "custom",
];

const DISCLAIMER = "This analysis summarizes deterministic research generated from market data and predefined qualification rules. It is not personalized investment advice.";

// ---------------------------------------------------------------------------
// OpenAI call
// ---------------------------------------------------------------------------

async function callWorkspaceAI(systemPrompt: string, userMessage: string): Promise<{ content: string | null; latencyMs: number }> {
  if (!process.env.OPENAI_API_KEY) return { content: null, latencyMs: 0 };

  const start = Date.now();
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
    return { content: response.choices[0]?.message?.content ?? null, latencyMs: Date.now() - start };
  } catch (err) {
    console.error("[ResearchWorkspace] OpenAI error:", (err as Error).message);
    return { content: null, latencyMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Auto-generate conversation title
// ---------------------------------------------------------------------------

function generateTitle(question: string, mode: ResearchMode, scopeLabel: string, contextLabel?: string): string {
  if (contextLabel && contextLabel !== "Market Intelligence") {
    const q = question.slice(0, 50).trim();
    return q.length > 15 ? `${contextLabel}: ${q}` : contextLabel;
  }
  const modeLabel = RESEARCH_MODE_LABELS[mode] ?? mode;
  const q = question.slice(0, 60).trim();
  return q.length > 20 ? q : `${modeLabel} — ${scopeLabel}`;
}

// ---------------------------------------------------------------------------
// Map conversation row → ConversationSummary
// ---------------------------------------------------------------------------

type ConvRow = {
  id: string; title: string; researchMode: string; contextScope: string;
  tickers: string[] | null; isPinned: boolean; pinnedAt: Date | null;
  lastMessageAt: Date; createdAt: Date; updatedAt?: Date;
  contextType?: string | null; contextLabel?: string | null;
  primarySymbol?: string | null; comparisonSymbols?: string[] | null;
  sourceRoute?: string | null; userId?: string;
};

function toSummary(c: ConvRow): ConversationSummary {
  return {
    id:                c.id,
    title:             c.title,
    researchMode:      c.researchMode as ResearchMode,
    contextScope:      c.contextScope as ContextScope,
    tickers:           c.tickers ?? [],
    isPinned:          c.isPinned,
    pinnedAt:          c.pinnedAt?.toISOString(),
    lastMessageAt:     c.lastMessageAt.toISOString(),
    createdAt:         c.createdAt.toISOString(),
    contextType:       c.contextType ?? undefined,
    contextLabel:      c.contextLabel ?? undefined,
    primarySymbol:     c.primarySymbol ?? undefined,
    comparisonSymbols: c.comparisonSymbols ?? undefined,
    sourceRoute:       c.sourceRoute ?? undefined,
  };
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

  // ── GET /api/research-workspace/context ───────────────────────────────────
  // Sprint 2.6.4 — canonical context assembly for context banner + evidence sidebar
  app.get("/api/research-workspace/context", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const type = (req.query.type as string ?? "market") as ResearchContextType;

    if (!VALID_CONTEXT_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid context type. Valid: ${VALID_CONTEXT_TYPES.join(", ")}` });
    }

    const params = {
      symbol:       req.query.symbol as string | undefined,
      symbols:      req.query.symbols
        ? String(req.query.symbols).split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
        : undefined,
      themeId:      req.query.themeId as string | undefined,
      sector:       req.query.sector as string | undefined,
      collectionId: req.query.collectionId as string | undefined,
      portfolioId:  req.query.portfolioId as string | undefined,
      watchId:      req.query.watchId as string | undefined,
      reportId:     req.query.reportId as string | undefined,
      sourceRoute:  req.query.sourceRoute as string | undefined,
    };

    try {
      const { context, limitations } = await assembleCanonicalContext(uid, type, params);
      if (limitations.length > 0) recordPartialContext();
      recordContextRequest(true);

      return res.json({
        context,
        limitations,
        assembledAt: new Date().toISOString(),
      });
    } catch (err) {
      recordContextRequest(false);
      console.error("[ResearchWorkspace] GET /api/research-workspace/context error:", (err as Error).message);
      return res.status(500).json({ error: "Context assembly failed" });
    }
  });

  // ── POST /api/research/ask ────────────────────────────────────────────────
  app.post("/api/research/ask", isAuthenticated, async (req: Request, res: Response) => {
    const uid = userId(req);
    const body: WorkspaceAskRequest = req.body ?? {};

    // Validate
    const question    = (body.question ?? "").trim();
    const mode        = body.researchMode ?? "opportunity";
    const scope       = body.contextScope ?? "entire_market";
    const tickers     = Array.isArray(body.tickers) ? body.tickers.slice(0, 5).map(t => String(t).toUpperCase()) : [];
    const convId      = body.conversationId;
    const ctxMeta     = body.researchContext ?? null;

    if (!question || question.length < 3) {
      return res.status(400).json({ error: "question is required (min 3 characters)" });
    }
    if (!VALID_MODES.includes(mode as ResearchMode)) {
      return res.status(400).json({ error: `Invalid researchMode. Valid values: ${VALID_MODES.join(", ")}` });
    }

    const askStart = Date.now();
    try {
      // 1. Assemble context
      const ctx = await assembleResearchContext(uid, mode as ResearchMode, scope as ContextScope, tickers);

      // 2. Build prompts
      const systemPrompt = buildResearchSystemPrompt(mode as ResearchMode, ctx);
      const userMessage  = buildResearchUserMessage(question, ctx);

      // 3. Call AI or rule-based fallback
      const { content: aiContent, latencyMs } = await callWorkspaceAI(systemPrompt, userMessage);
      const usedFallback = !aiContent;

      const workspaceResponse = aiContent
        ? parseAIWorkspaceResponse(aiContent, mode as ResearchMode, scope as ContextScope, ctx)
        : buildRuleBasedWorkspaceResponse(question, ctx, mode as ResearchMode, scope as ContextScope);

      recordAskRequest(true, usedFallback, latencyMs);

      // 4. Persist conversation + messages
      let conversationId = convId;

      if (!conversationId) {
        // Create new conversation
        const insertValues: Record<string, unknown> = {
          userId:       uid,
          title:        generateTitle(question, mode as ResearchMode, ctx.scopeLabel, ctxMeta?.contextLabel),
          researchMode: mode,
          contextScope: scope,
          tickers:      tickers.length > 0 ? tickers : workspaceResponse.referencedTickers.slice(0, 5),
          isPinned:     false,
          lastMessageAt: new Date(),
        };
        // Sprint 2.6.4 — persist context metadata
        if (ctxMeta) {
          if (ctxMeta.contextType)          insertValues.contextType  = ctxMeta.contextType;
          if (ctxMeta.contextLabel)         insertValues.contextLabel = ctxMeta.contextLabel;
          if (ctxMeta.primarySymbol)        insertValues.primarySymbol = ctxMeta.primarySymbol;
          if (ctxMeta.comparisonSymbols?.length) insertValues.comparisonSymbols = ctxMeta.comparisonSymbols;
          if (ctxMeta.sourceRoute)          insertValues.sourceRoute  = ctxMeta.sourceRoute;
        }
        const [conv] = await db.insert(workspaceConversations).values(insertValues as any).returning();
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

      const totalMs = Date.now() - askStart;
      console.info(`[ResearchWorkspace] ask completed mode=${mode} scope=${scope} tickers=${tickers.join(",")} fallback=${usedFallback} totalMs=${totalMs}`);

      return res.json({
        conversationId,
        messageId: assistantMsg.id,
        userMessageId: userMsg.id,
        response: workspaceResponse,
        disclaimer: DISCLAIMER,
      });

    } catch (err) {
      recordAskRequest(false, false);
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
          ...toSummary(conv as ConvRow),
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
