// WorkspaceAssistant — Contextual AI Research Assistant for the AI Trading Workspace.
//
// Sprint 2.2.3: Collapsible panel that reuses POST /api/ask.
// - Desktop: right-side drawer (collapsible, docked when open)
// - Tablet/Mobile: slide-over bottom sheet
// - Context-aware starter prompts derived from loaded workspace data
// - NEVER auto-calls the AI endpoint on page load
// - NEVER sends prices, evidence values, broker tokens, or account IDs
// - NEVER submits orders
// - Sanitizes selectedContractId (opaque string only, max 100 chars)
// - Fails in isolation — workspace remains fully usable if AI is unavailable
//
// Compliance:
// - Uses deterministic workspace facts as primary source description
// - Clearly distinguishes factual values from explanation in prompts
// - Preserves existing disclaimers
// - No personalized investment advice

import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare,
  X,
  ChevronRight,
  Send,
  RefreshCcw,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { buildAssistantPrompts } from "./workspace-sections";
import type { ResearchPackage, EvidenceStars } from "@/components/research/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssistantAskPayload {
  question: string;
  symbol: string;
  contextMode: "trading_workspace";
  selectedContractId?: string;
}

export interface AssistantResponse {
  headline?: string;
  answer?: string;
  keyPoints?: string[];
  riskNote?: string;
  disclaimer?: string;
  source?: string;
  suggestions?: Array<{ label: string; href: string }>;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

/**
 * Sanitize the assistant payload — ensures no sensitive data is sent.
 * The only client-supplied fields are: question, symbol (ticker), contextMode (enum),
 * and optionally selectedContractId (opaque string, stripped to max 100 chars).
 */
export function buildSafeAssistantPayload(
  question: string,
  symbol: string,
  selectedContractId: string | null,
): AssistantAskPayload {
  const trimmed = question.trim().slice(0, 500);
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
  const payload: AssistantAskPayload = {
    question: trimmed,
    symbol: cleanSymbol,
    contextMode: "trading_workspace",
  };
  if (selectedContractId) {
    // Opaque pass-through — strip to ASCII printable only, max 100 chars
    const cleanId = selectedContractId
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, 100);
    if (cleanId.length > 0) {
      payload.selectedContractId = cleanId;
    }
  }
  return payload;
}

/**
 * Whether a suggested prompt is relevant given the available context.
 * Prompts mentioning selected contract require hasSelectedContract.
 * Prompts mentioning news require hasNewsData.
 */
export function isPromptRelevant(
  prompt: string,
  hasSelectedContract: boolean,
  hasNewsData: boolean,
): boolean {
  const lower = prompt.toLowerCase();
  if (lower.includes("selected contract") || lower.includes("selected live")) {
    return hasSelectedContract;
  }
  if (lower.includes("latest news") || lower.includes("summarize the latest news")) {
    return hasNewsData;
  }
  return true;
}

// ---------------------------------------------------------------------------
// AssistantResponseDisplay — renders the server response
// ---------------------------------------------------------------------------

function AssistantResponseDisplay({
  response,
  onDismiss,
}: {
  response: AssistantResponse;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="assistant-response">
      {response.headline && (
        <p className="text-[13px] font-semibold leading-snug">
          {response.headline}
        </p>
      )}
      {response.answer && (
        <p className="text-[12px] leading-relaxed text-foreground/90">
          {response.answer}
        </p>
      )}
      {(response.keyPoints ?? []).length > 0 && (
        <ul className="space-y-1.5" data-testid="assistant-key-points">
          {(response.keyPoints ?? []).map((pt, i) => (
            <li key={i} className="flex items-start gap-2">
              <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
              <span className="text-[11px] leading-relaxed">{pt}</span>
            </li>
          ))}
        </ul>
      )}
      {response.riskNote && (
        <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300 leading-relaxed">{response.riskNote}</p>
        </div>
      )}
      {response.source && (
        <p className="text-[10px] text-muted-foreground">
          Source: {response.source}
        </p>
      )}
      {response.disclaimer && (
        <p className="text-[10px] text-muted-foreground italic leading-relaxed">
          {response.disclaimer}
        </p>
      )}
      {(response.suggestions ?? []).length > 0 && (
        <div className="pt-1 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Related
          </p>
          {(response.suggestions ?? []).map((s, i) => (
            <a
              key={i}
              href={s.href}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {s.label} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2 -ml-2"
        onClick={onDismiss}
        data-testid="assistant-dismiss-response"
      >
        Ask another question
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceAssistantPanel — the main panel component
// ---------------------------------------------------------------------------

interface WorkspaceAssistantPanelProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  selectedContractId: string | null;
  hasNewsData: boolean;
  onClose: () => void;
}

export function WorkspaceAssistantPanel({
  pkg,
  stars,
  selectedContractId,
  hasNewsData,
  onClose,
}: WorkspaceAssistantPanelProps) {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const prompts = buildAssistantPrompts(pkg, stars, !!selectedContractId, hasNewsData);

  // Focus trap: Escape closes the panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus textarea on open
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const submitQuestion = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || isLoading) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);

      try {
        const payload = buildSafeAssistantPayload(trimmed, pkg.symbol, selectedContractId);
        const res = await apiRequest("POST", "/api/ask", payload);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }

        const data: AssistantResponse = await res.json();
        setResponse(data);
        setQuestion("");
      } catch (err: any) {
        setError(
          err?.message?.includes("fetch") || err?.message?.includes("network")
            ? "The AI assistant is temporarily unavailable. The workspace continues to work normally."
            : err?.message ?? "Unable to get a response. Please try again.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [pkg.symbol, selectedContractId, isLoading],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion(question);
  };

  const handlePromptClick = (prompt: string) => {
    setQuestion(prompt);
    submitQuestion(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitQuestion(question);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="VCP AI Research Assistant"
      className="flex flex-col h-full"
      data-testid="workspace-assistant-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[13px] font-semibold">Ask VCP AI</span>
          <Badge
            variant="outline"
            className="text-[9px] border-border/40 text-muted-foreground"
          >
            {pkg.symbol}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onClose}
          aria-label="Close AI assistant panel"
          data-testid="assistant-close-btn"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Starter prompts — only before a response */}
        {!response && !isLoading && !error && (
          <div data-testid="assistant-starter-prompts">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Research questions for {pkg.symbol}
            </p>
            <div className="space-y-1">
              {prompts.map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  className={cn(
                    "w-full text-left text-[11px] px-3 py-2 rounded border border-border/40",
                    "hover:bg-accent/40 hover:border-border/60 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  onClick={() => handlePromptClick(prompt)}
                  data-testid={`assistant-prompt-${i}`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2" data-testid="assistant-loading">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
              Analyzing {pkg.symbol}…
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="rounded border border-rose-500/20 bg-rose-500/5 px-3 py-3 space-y-2"
            role="alert"
            data-testid="assistant-error"
          >
            <p className="text-[11px] text-rose-300 leading-relaxed">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Response */}
        {response && !isLoading && (
          <AssistantResponseDisplay
            response={response}
            onDismiss={() => {
              setResponse(null);
              setError(null);
              setTimeout(() => textareaRef.current?.focus(), 50);
            }}
          />
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 px-4 py-3 border-t border-border/30 space-y-2">
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this candidate…"
              rows={2}
              disabled={isLoading}
              aria-label="Research question input"
              className={cn(
                "w-full resize-none rounded border border-border/40 bg-background",
                "px-3 py-2 text-[12px] placeholder:text-muted-foreground/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              data-testid="assistant-question-input"
            />
            <div className="absolute bottom-1.5 right-2 text-[9px] text-muted-foreground/50">
              {question.length}/500
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              AI responses are educational only — not investment advice
            </p>
            <Button
              type="submit"
              size="sm"
              className="h-7 px-3 gap-1.5 text-[11px] shrink-0"
              disabled={!question.trim() || isLoading}
              data-testid="assistant-submit-btn"
              aria-label="Submit research question"
            >
              <Send className="h-3 w-3" />
              Ask
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceAssistantDrawer — layout wrapper (desktop drawer + mobile sheet)
// ---------------------------------------------------------------------------

interface WorkspaceAssistantDrawerProps {
  open: boolean;
  pkg: ResearchPackage;
  stars: EvidenceStars;
  selectedContractId: string | null;
  hasNewsData: boolean;
  onClose: () => void;
}

/**
 * Pure helper — determines whether body scroll should be locked.
 * Lock applies only for mobile bottom sheet (viewport width < lg = 1024px).
 * Exported for testing without DOM dependency.
 */
export function shouldLockScroll(open: boolean, viewportWidth: number): boolean {
  return open && viewportWidth < 1024;
}

export function WorkspaceAssistantDrawer({
  open,
  pkg,
  stars,
  selectedContractId,
  hasNewsData,
  onClose,
}: WorkspaceAssistantDrawerProps) {
  // Scroll lock for mobile bottom sheet.
  // Must be declared BEFORE any conditional return (React hooks rule).
  // Stores previous overflow value and restores it on close, unmount, or
  // route change — never leaves body.style.overflow = "hidden" behind.
  useEffect(() => {
    const width = typeof window !== "undefined" ? window.innerWidth : 1280;
    if (!shouldLockScroll(open, width)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Desktop: fixed right panel */}
      <div
        className={cn(
          "hidden lg:flex flex-col",
          "fixed right-0 top-0 bottom-0 z-40",
          "w-[380px] border-l border-border/40 bg-background shadow-xl",
          "animate-in slide-in-from-right-5 duration-200",
        )}
        data-testid="assistant-drawer-desktop"
      >
        <WorkspaceAssistantPanel
          pkg={pkg}
          stars={stars}
          selectedContractId={selectedContractId}
          hasNewsData={hasNewsData}
          onClose={onClose}
        />
      </div>

      {/* Mobile/tablet: bottom sheet with backdrop */}
      <div className="lg:hidden" data-testid="assistant-drawer-mobile">
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Sheet */}
        <div
          className={cn(
            "fixed bottom-0 left-0 right-0 z-50",
            "bg-background border-t border-border/40 rounded-t-xl shadow-xl",
            "max-h-[80vh] flex flex-col",
            "animate-in slide-in-from-bottom-5 duration-200",
          )}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-8 h-1 rounded-full bg-border/60" />
          </div>
          <WorkspaceAssistantPanel
            pkg={pkg}
            stars={stars}
            selectedContractId={selectedContractId}
            hasNewsData={hasNewsData}
            onClose={onClose}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceAssistantTrigger — floating button to open the assistant
// ---------------------------------------------------------------------------

interface WorkspaceAssistantTriggerProps {
  symbol: string;
  onClick: () => void;
}

export function WorkspaceAssistantTrigger({
  symbol,
  onClick,
}: WorkspaceAssistantTriggerProps) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 text-[11px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
      onClick={onClick}
      data-testid="assistant-trigger-btn"
      aria-label={`Open AI research assistant for ${symbol}`}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Ask VCP AI
    </Button>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceAssistantInlineSection — in-page section (links to drawer)
// ---------------------------------------------------------------------------

interface WorkspaceAssistantInlineSectionProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  selectedContractId: string | null;
  hasNewsData: boolean;
  onOpen: () => void;
}

export function WorkspaceAssistantInlineSection({
  pkg,
  stars,
  selectedContractId,
  hasNewsData,
  onOpen,
}: WorkspaceAssistantInlineSectionProps) {
  const prompts = buildAssistantPrompts(pkg, stars, !!selectedContractId, hasNewsData);
  const previewPrompts = prompts.slice(0, 4);

  return (
    <Card
      className="border-violet-500/20 bg-violet-500/5"
      id="ws-ask-ai"
      data-testid="ws-ask-ai-section"
    >
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            Contextual AI Research Assistant
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10 shrink-0"
            onClick={onOpen}
            data-testid="ws-ask-ai-open-btn"
            aria-label={`Open AI research assistant for ${pkg.symbol}`}
          >
            <Sparkles className="h-3 w-3" />
            Open
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Ask research questions about this candidate — context-aware, educational only
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {previewPrompts.map((prompt, i) => (
            <button
              key={i}
              type="button"
              onClick={onOpen}
              className={cn(
                "text-left text-[11px] px-3 py-2 rounded border border-violet-500/20",
                "hover:bg-violet-500/10 hover:border-violet-500/30 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              data-testid={`ws-ask-preview-prompt-${i}`}
            >
              {prompt}
            </button>
          ))}
        </div>
        {prompts.length > 4 && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-2 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            +{prompts.length - 4} more questions
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          Responses are educational analysis based on deterministic workspace facts. Not
          investment advice. AI responses use the existing VCP AI pipeline with trading-workspace
          context.
        </p>
      </CardContent>
    </Card>
  );
}
