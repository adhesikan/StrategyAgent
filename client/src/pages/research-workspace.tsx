/**
 * Research Workspace — Sprint 2.5.2
 *
 * AI-powered research environment consuming Opportunity Intelligence,
 * Collections, Sector Intelligence, and Theme Intelligence.
 *
 * COMPLIANCE: No "recommendation", "buy", "sell", "target price" language.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  Brain, BookOpen, Layers, BarChart2, Building2,
  Globe, Bookmark, GitCompare, Send, ChevronDown, ChevronRight,
  Pin, PinOff, Trash2, Plus, Sparkles, AlertTriangle,
  TrendingUp, Shield, FlaskConical, Search, Clock, Star,
  ArrowRight, RefreshCw, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import type {
  ResearchMode,
  ContextScope,
  WorkspaceAIResponse,
  ResearchTemplate,
  ConversationSummary,
  EvidencePanel,
  FollowUpAction,
  ResearchDiagnostics,
} from "@shared/research-workspace-types";
import {
  RESEARCH_MODE_LABELS,
  RESEARCH_MODE_DESCRIPTIONS,
  CONTEXT_SCOPE_LABELS,
  SYSTEM_SCOPE_KEYS,
} from "@shared/research-workspace-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AskResponse {
  conversationId: string;
  messageId: string;
  response: WorkspaceAIResponse;
  disclaimer: string;
}

interface ConversationListResponse {
  pinned: ConversationSummary[];
  recent: ConversationSummary[];
  all: ConversationSummary[];
}

// ---------------------------------------------------------------------------
// Mode icon map
// ---------------------------------------------------------------------------

const MODE_ICONS: Record<ResearchMode, React.ReactNode> = {
  opportunity:   <TrendingUp className="h-4 w-4" />,
  company:       <Building2  className="h-4 w-4" />,
  theme:         <Layers     className="h-4 w-4" />,
  sector:        <Globe      className="h-4 w-4" />,
  institutional: <BookOpen   className="h-4 w-4" />,
  market:        <BarChart2  className="h-4 w-4" />,
  collection:    <Bookmark   className="h-4 w-4" />,
  comparison:    <GitCompare className="h-4 w-4" />,
};

const MODES: ResearchMode[] = [
  "opportunity", "company", "theme", "sector",
  "institutional", "market", "collection", "comparison",
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeSelector({
  selected, onChange,
}: {
  selected: ResearchMode;
  onChange: (m: ResearchMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODES.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            selected === m
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {MODE_ICONS[m]}
          {RESEARCH_MODE_LABELS[m].replace(" Research", "")}
        </button>
      ))}
    </div>
  );
}

function ScopeSelector({
  selected, onChange,
}: {
  selected: ContextScope;
  onChange: (s: ContextScope) => void;
}) {
  const [open, setOpen] = useState(false);

  const groups: { label: string; scopes: ContextScope[] }[] = [
    { label: "Market", scopes: ["entire_market"] },
    { label: "My Collections", scopes: ["my_collections"] },
    { label: "AI & Tech Themes", scopes: ["ai-infrastructure", "semiconductors", "memory", "networking", "cybersecurity", "cloud"] },
    { label: "Sectors", scopes: ["energy", "healthcare", "financials", "consumer", "industrials"] },
    { label: "Strategy", scopes: ["dividend", "income", "growth", "momentum", "value", "etf", "long-term-investments", "swing-trading", "covered-calls", "cash-secured-puts"] },
    { label: "Dynamic", scopes: ["market-leaders", "recently-improved", "institutional-activity", "new-opportunities"] },
    { label: "Coming Soon", scopes: ["future_portfolio"] },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm bg-background hover:bg-muted transition-colors"
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{CONTEXT_SCOPE_LABELS[selected]}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border rounded-lg shadow-lg w-72 max-h-80 overflow-y-auto">
          {groups.map(g => (
            <div key={g.label}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/50">
                {g.label}
              </div>
              {g.scopes.map(s => (
                <button
                  key={s}
                  disabled={s === "future_portfolio"}
                  onClick={() => { onChange(s); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    selected === s ? "text-primary font-medium bg-primary/5" : ""
                  } ${s === "future_portfolio" ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {CONTEXT_SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidencePanelView({ panel }: { panel: EvidencePanel }) {
  const sections = [
    { label: "Supporting Evidence", items: panel.supportingEvidence, icon: <Star className="h-3.5 w-3.5" /> },
    { label: "Technical Evidence", items: panel.technicalEvidence, icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { label: "Fundamental Evidence", items: panel.fundamentalEvidence, icon: <BarChart2 className="h-3.5 w-3.5" /> },
    { label: "Institutional Evidence", items: panel.institutionalEvidence, icon: <Building2 className="h-3.5 w-3.5" /> },
  ].filter(s => s.items.length > 0);

  const STRENGTH_COLORS = {
    strong:   "text-green-600 dark:text-green-400",
    moderate: "text-yellow-600 dark:text-yellow-400",
    weak:     "text-orange-600 dark:text-orange-400",
  };

  return (
    <div className="space-y-4 mt-4 border-t pt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Evidence Panel</p>

      {panel.summary && (
        <p className="text-sm text-muted-foreground">{panel.summary}</p>
      )}

      {sections.map(s => (
        <div key={s.label}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-muted-foreground">{s.icon}</span>
            <span className="text-xs font-semibold text-muted-foreground">{s.label}</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {s.items.map((item, i) => (
              <div key={i} className="flex items-start gap-2 bg-muted/30 rounded-md px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{item.label}:</span>
                  <span className="text-xs text-muted-foreground ml-1">{item.value}</span>
                </div>
                <span className={`text-[10px] font-semibold uppercase shrink-0 ${STRENGTH_COLORS[item.strength] ?? ""}`}>
                  {item.strength}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {panel.riskFactors.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs font-semibold text-muted-foreground">Risk Factors</span>
          </div>
          <ul className="space-y-1">
            {panel.riskFactors.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-orange-400 mt-0.5">•</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel.thesisInvalidators.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="h-3.5 w-3.5 text-red-500" />
            <span className="text-xs font-semibold text-muted-foreground">What Would Invalidate This Thesis</span>
          </div>
          <ul className="space-y-1">
            {panel.thesisInvalidators.map((inv, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-red-400 mt-0.5">•</span>{inv}
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel.researchSourcesUsed.length > 0 && (
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium">Sources:</span> {panel.researchSourcesUsed.join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}

function DiagnosticsPanel({ diag }: { diag: ResearchDiagnostics }) {
  return (
    <div className="mt-4 border border-orange-200 dark:border-orange-900/40 rounded-lg p-4 bg-orange-50/50 dark:bg-orange-950/20">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-4 w-4 text-orange-500" />
        <span className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-widest">Research Diagnostics</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Universe searched:</span>
          <p className="font-medium mt-0.5">{diag.universeSearched}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Candidates evaluated:</span>
          <p className="font-medium mt-0.5">{diag.candidatesEvaluated}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Qualified:</span>
          <p className="font-medium mt-0.5">{diag.candidatesQualified}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Data freshness:</span>
          <p className="font-medium mt-0.5">{diag.dataFreshness}</p>
        </div>
      </div>
      {diag.filtersApplied.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-muted-foreground">Filters applied:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {diag.filtersApplied.map((f, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{f}</Badge>
            ))}
          </div>
        </div>
      )}
      {diag.rejectionReasons.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-muted-foreground">Why candidates were excluded:</span>
          <ul className="mt-1 space-y-0.5">
            {diag.rejectionReasons.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground">• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FollowUpActions({
  actions, onAction,
}: {
  actions: FollowUpAction[];
  onAction: (a: FollowUpAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onAction(action)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border hover:bg-muted transition-colors"
        >
          <ArrowRight className="h-3 w-3" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

function ResponseCard({ response, onFollowUp }: {
  response: WorkspaceAIResponse;
  onFollowUp: (a: FollowUpAction) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  const CONF_COLOR = {
    high:   "text-green-600 dark:text-green-400",
    medium: "text-yellow-600 dark:text-yellow-400",
    low:    "text-orange-600 dark:text-orange-400",
  };

  return (
    <div className="bg-muted/20 border rounded-xl p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {RESEARCH_MODE_LABELS[response.researchMode]}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-[10px]">
            {CONTEXT_SCOPE_LABELS[response.contextScope]}
          </Badge>
          <span className={`text-[10px] font-semibold uppercase ${CONF_COLOR[response.confidence]}`}>
            {response.confidence} confidence
          </span>
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-base font-semibold leading-snug">{response.headline}</h3>

      {/* Answer */}
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{response.answer}</p>

      {/* Key Points */}
      {response.keyPoints.length > 0 && (
        <ul className="space-y-1">
          {response.keyPoints.map((kp, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="text-primary mt-0.5 shrink-0">•</span>
              <span>{kp}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Risk note */}
      {response.riskNote && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-orange-400" />
          <span>{response.riskNote}</span>
        </div>
      )}

      {/* Referenced tickers */}
      {response.referencedTickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {response.referencedTickers.map(t => (
            <Link key={t} href={`/opportunity/${t}`}>
              <Badge variant="secondary" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs">
                {t}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {/* Evidence panel toggle */}
      <button
        onClick={() => setShowEvidence(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showEvidence ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {showEvidence ? "Hide" : "Show"} Evidence Panel
      </button>

      {showEvidence && <EvidencePanelView panel={response.evidencePanel} />}

      {/* Diagnostics (empty state) */}
      {response.diagnostics && <DiagnosticsPanel diag={response.diagnostics} />}

      {/* Follow-up actions */}
      <FollowUpActions actions={response.followUpActions} onFollowUp={onFollowUp} />

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground border-t pt-2 mt-2 leading-relaxed">
        {response.disclaimer}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResearchWorkspacePage() {
  const [, navigate] = useLocation();
  const queryClient  = useQueryClient();
  const search       = useSearch();

  const [mode, setMode]           = useState<ResearchMode>("opportunity");
  const [scope, setScope]         = useState<ContextScope>("entire_market");
  const [question, setQuestion]   = useState("");
  const [tickers, setTickers]     = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [responses, setResponses] = useState<WorkspaceAIResponse[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSidebar, setShowSidebar]     = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pre-fill from URL params
  useEffect(() => {
    if (!search) return;
    const params = new URLSearchParams(search);
    const q = params.get("q");
    const m = params.get("mode") as ResearchMode;
    const s = params.get("scope") as ContextScope;
    if (q) setQuestion(q);
    if (m && MODES.includes(m)) setMode(m);
    if (s) setScope(s);
  }, [search]);

  // Scroll to bottom on new response
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses]);

  // Templates
  const { data: templatesData } = useQuery<{ templates: ResearchTemplate[] }>({
    queryKey: ["/api/research/templates"],
    staleTime: Infinity,
  });

  // Conversations
  const { data: convsData, refetch: refetchConvs } = useQuery<ConversationListResponse>({
    queryKey: ["/api/research/conversations"],
    staleTime: 30_000,
  });

  // Ask mutation
  const askMutation = useMutation({
    mutationFn: async (payload: { question: string; mode: ResearchMode; scope: ContextScope; tickers: string[]; conversationId: string | null }) => {
      const res = await apiRequest("POST", "/api/research/ask", {
        question:       payload.question,
        researchMode:   payload.mode,
        contextScope:   payload.scope,
        tickers:        payload.tickers,
        conversationId: payload.conversationId ?? undefined,
      });
      return res.json() as Promise<AskResponse>;
    },
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setResponses(prev => [...prev, data.response]);
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["/api/research/conversations"] });
    },
  });

  // Pin / delete mutations
  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const res = await apiRequest("PATCH", `/api/research/conversations/${id}/pin`, { pinned });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/research/conversations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/research/conversations/${id}`);
      return res.json();
    },
    onSuccess: (_, id) => {
      if (conversationId === id) {
        setConversationId(null);
        setResponses([]);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/research/conversations"] });
    },
  });

  const handleSubmit = () => {
    if (!question.trim() || askMutation.isPending) return;
    askMutation.mutate({ question: question.trim(), mode, scope, tickers, conversationId });
  };

  const handleTemplateSelect = (t: ResearchTemplate) => {
    setMode(t.mode);
    setScope(t.defaultScope);
    setQuestion(t.promptText.replace(/{TICKER[12]?}/g, tickers[0] ?? "{TICKER}"));
    setShowTemplates(false);
  };

  const handleFollowUp = (action: FollowUpAction) => {
    if (action.action.type === "ask") {
      if (action.action.mode)  setMode(action.action.mode);
      if (action.action.scope) setScope(action.action.scope);
      setQuestion(action.action.question);
    } else if (action.action.type === "navigate") {
      window.location.href = action.action.path;
    } else if (action.action.type === "set_scope") {
      setScope(action.action.scope);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const handleTickerAdd = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !tickers.includes(t) && tickers.length < 4) {
      setTickers(prev => [...prev, t]);
    }
    setTickerInput("");
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex">
        {/* Sidebar */}
        {showSidebar && (
          <aside className="w-64 border-r flex flex-col bg-muted/10 shrink-0">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <span className="font-semibold text-sm">Research Workspace</span>
              </div>
              <button
                onClick={() => { setConversationId(null); setResponses([]); }}
                className="p-1.5 rounded hover:bg-muted transition-colors"
                title="New conversation"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <ScrollArea className="flex-1 p-3">
              {convsData?.pinned && convsData.pinned.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">Pinned</p>
                  {convsData.pinned.map(c => (
                    <ConversationItem
                      key={c.id} conv={c}
                      isActive={conversationId === c.id}
                      onSelect={() => { setConversationId(c.id); setResponses([]); }}
                      onPin={() => pinMutation.mutate({ id: c.id, pinned: !c.isPinned })}
                      onDelete={() => deleteMutation.mutate(c.id)}
                    />
                  ))}
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">Recent</p>
                {(!convsData?.recent || convsData.recent.length === 0) && (
                  <p className="text-xs text-muted-foreground px-2 py-3 text-center">No conversations yet</p>
                )}
                {convsData?.recent?.map(c => (
                  <ConversationItem
                    key={c.id} conv={c}
                    isActive={conversationId === c.id}
                    onSelect={() => { setConversationId(c.id); setResponses([]); }}
                    onPin={() => pinMutation.mutate({ id: c.id, pinned: !c.isPinned })}
                    onDelete={() => deleteMutation.mutate(c.id)}
                  />
                ))}
              </div>
            </ScrollArea>

            {/* Template button at bottom of sidebar */}
            <div className="p-3 border-t">
              <button
                onClick={() => setShowTemplates(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Research Templates
              </button>
            </div>
          </aside>
        )}

        {/* Main panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="border-b px-6 py-3 flex items-center gap-4 bg-background shrink-0">
            <button
              onClick={() => setShowSidebar(v => !v)}
              className="p-1.5 rounded hover:bg-muted transition-colors"
            >
              <Layers className="h-4 w-4" />
            </button>
            <ModeSelector selected={mode} onChange={setMode} />
            <div className="ml-auto">
              <ScopeSelector selected={scope} onChange={setScope} />
            </div>
          </header>

          {/* Conversation area */}
          <ScrollArea className="flex-1 px-6 py-6">
            {/* Templates */}
            {showTemplates && (
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="col-span-full">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Research Templates</p>
                </div>
                {(templatesData?.templates ?? []).map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleTemplateSelect(t)}
                    className="text-left p-4 border rounded-xl hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium group-hover:text-primary transition-colors">{t.label}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {RESEARCH_MODE_LABELS[t.mode].replace(" Research", "")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {responses.length === 0 && !showTemplates && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Brain className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h2 className="text-lg font-semibold mb-2">Research Workspace</h2>
                <p className="text-sm text-muted-foreground max-w-md mb-6">
                  {RESEARCH_MODE_DESCRIPTIONS[mode]}. Scope: {CONTEXT_SCOPE_LABELS[scope]}.
                </p>
                <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                  {(templatesData?.templates ?? []).slice(0, 4).map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleTemplateSelect(t)}
                      className="px-4 py-2 text-xs border rounded-full hover:bg-muted transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Response history */}
            <div className="space-y-6 max-w-3xl mx-auto">
              {responses.map((r, i) => (
                <ResponseCard key={i} response={r} onFollowUp={handleFollowUp} />
              ))}

              {askMutation.isPending && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Assembling research context and analyzing evidence…
                </div>
              )}

              {askMutation.isError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  Research request failed. Please try again.
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="border-t px-6 py-4 bg-background shrink-0">
            {/* Ticker pills */}
            {tickers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {tickers.map(t => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => setTickers(prev => prev.filter(x => x !== t))}
                  >
                    {t} ×
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-3 items-end max-w-3xl mx-auto">
              <div className="flex-1 space-y-2">
                <Textarea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask a ${RESEARCH_MODE_LABELS[mode].toLowerCase()} question… (⌘↵ to send)`}
                  rows={2}
                  className="resize-none text-sm"
                  disabled={askMutation.isPending}
                />

                {/* Ticker input */}
                <div className="flex gap-2 items-center">
                  <input
                    value={tickerInput}
                    onChange={e => setTickerInput(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleTickerAdd(); } }}
                    placeholder="Add ticker (e.g. NVDA)"
                    className="flex-1 text-xs px-3 py-1.5 rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    maxLength={10}
                  />
                  <button
                    onClick={handleTickerAdd}
                    className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                  >
                    Add
                  </button>
                  <span className="text-[10px] text-muted-foreground">Optional — pin a ticker for company / comparison research</span>
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={!question.trim() || askMutation.isPending}
                size="icon"
                className="h-10 w-10 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Conversation item (sidebar)
// ---------------------------------------------------------------------------

function ConversationItem({
  conv, isActive, onSelect, onPin, onDelete,
}: {
  conv: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      className={`group relative flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors mb-0.5 ${
        isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
    >
      <div className="shrink-0 mt-0.5 text-muted-foreground">
        {MODE_ICONS[conv.researchMode] ?? <Brain className="h-3.5 w-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-snug">{conv.title}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {new Date(conv.lastMessageAt).toLocaleDateString()}
        </p>
      </div>
      {hover && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onPin(); }}
            className="p-1 rounded hover:bg-muted"
            title={conv.isPinned ? "Unpin" : "Pin"}
          >
            {conv.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-muted text-red-500"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
