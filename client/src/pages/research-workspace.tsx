/**
 * Research Workspace — Sprint 2.6.4
 *
 * Canonical cross-platform AI research environment.
 * Supports all context entry points: opportunity, company, theme, sector,
 * collection, comparison, monitor, report, portfolio, market.
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
  TrendingUp, Shield, FlaskConical, Search, Star,
  ArrowRight, RefreshCw, Info, X, PanelRight, PanelRightClose,
  ExternalLink, ChevronLeft,
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
  ResearchContextType,
  WorkspaceAction,
  ContextScope,
  WorkspaceAIResponse,
  ResearchTemplate,
  ConversationSummary,
  EvidencePanel,
  EvidenceItem,
  FollowUpAction,
  ResearchDiagnostics,
  ResearchContext,
} from "@shared/research-workspace-types";
import {
  RESEARCH_MODE_LABELS,
  RESEARCH_MODE_DESCRIPTIONS,
  CONTEXT_SCOPE_LABELS,
  SYSTEM_SCOPE_KEYS,
  ACTION_QUESTIONS,
  ACTION_MODE_MAP,
} from "@shared/research-workspace-types";
import {
  parseWorkspaceParams,
  deriveContextLabel,
  deriveContextType,
  deriveInitialMode,
  derivePrefillQuestion,
} from "@shared/research-workspace-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AskResponse {
  conversationId: string;
  messageId:      string;
  response:       WorkspaceAIResponse;
  disclaimer:     string;
}

interface ConversationListResponse {
  pinned: ConversationSummary[];
  recent: ConversationSummary[];
  all:    ConversationSummary[];
}

interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    id:        string;
    role:      "user" | "assistant";
    plainText?: string;
    response?:  WorkspaceAIResponse;
    createdAt:  string;
  }>;
}

interface ContextMeta {
  contextType?:      string;
  contextLabel?:     string;
  primarySymbol?:    string;
  comparisonSymbols?: string[];
  sourceRoute?:      string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODES: ResearchMode[] = [
  "opportunity", "company", "theme", "sector",
  "institutional", "market", "collection", "comparison",
];

const VALID_ACTIONS: WorkspaceAction[] = [
  "explain_concept", "challenge", "explain_change", "risk", "institutional", "compare",
];

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

// Pure helpers are imported from @shared/research-workspace-helpers above.

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeSelector({ selected, onChange }: { selected: ResearchMode; onChange: (m: ResearchMode) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {MODES.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            selected === m
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {MODE_ICONS[m]}
          <span className="hidden sm:inline">{RESEARCH_MODE_LABELS[m].replace(" Research", "")}</span>
        </button>
      ))}
    </div>
  );
}

function ScopeSelector({ selected, onChange }: { selected: ContextScope; onChange: (s: ContextScope) => void }) {
  const [open, setOpen] = useState(false);

  const groups: { label: string; scopes: ContextScope[] }[] = [
    { label: "Market", scopes: ["entire_market"] },
    { label: "My Collections", scopes: ["my_collections"] },
    { label: "AI & Tech Themes", scopes: ["ai-infrastructure", "semiconductors", "memory", "networking", "cybersecurity", "cloud"] },
    { label: "Sectors", scopes: ["energy", "healthcare", "financials", "consumer", "industrials"] },
    { label: "Strategy", scopes: ["dividend", "income", "growth", "momentum", "value", "etf", "long-term-investments", "swing-trading", "covered-calls", "cash-secured-puts"] },
    { label: "Dynamic", scopes: ["market-leaders", "recently-improved", "institutional-activity", "new-opportunities"] },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs bg-background hover:bg-muted transition-colors"
      >
        <Search className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium max-w-[120px] truncate">{CONTEXT_SCOPE_LABELS[selected]}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-background border rounded-lg shadow-lg w-64 max-h-80 overflow-y-auto">
            {groups.map(g => (
              <div key={g.label}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/50 sticky top-0">
                  {g.label}
                </div>
                {g.scopes.map(s => (
                  <button
                    key={s}
                    onClick={() => { onChange(s); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${
                      selected === s ? "text-primary font-medium bg-primary/5" : ""
                    }`}
                  >
                    {CONTEXT_SCOPE_LABELS[s]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ContextBanner({
  label, sourceRoute, onDismiss,
}: { label: string; sourceRoute?: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b text-xs">
      <Brain className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="font-medium text-primary">{label}</span>
      <span className="text-muted-foreground">· AI workspace context loaded</span>
      {sourceRoute && (
        <Link href={sourceRoute} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-3 w-3" />
          Back
        </Link>
      )}
      {!sourceRoute && (
        <button onClick={onDismiss} className="ml-auto p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function ComparisonMatrix({ opportunities, symbols }: {
  opportunities: WorkspaceAIResponse["referencedOpportunities"];
  symbols: string[];
}) {
  const targets = (opportunities ?? []).filter(o => symbols.includes(o.symbol));
  if (targets.length < 2) return null;

  return (
    <div className="mt-4 border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b flex items-center gap-2">
        <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Comparison Matrix</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Metric</th>
              {targets.map(o => (
                <th key={o.symbol} className="px-3 py-2 text-center font-semibold">
                  <Link href={`/opportunities/${o.symbol}`} className="hover:text-primary transition-colors">
                    {o.symbol}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">Research Score</td>
              {targets.map(o => (
                <td key={o.symbol} className="px-3 py-1.5 text-center font-semibold">
                  <span className={o.researchScore >= 70 ? "text-green-600 dark:text-green-400" : o.researchScore >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}>
                    {o.researchScore}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">Technical Score</td>
              {targets.map(o => (
                <td key={o.symbol} className="px-3 py-1.5 text-center">{o.technicalScore ?? "—"}</td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">Inst. Score</td>
              {targets.map(o => (
                <td key={o.symbol} className="px-3 py-1.5 text-center">{o.institutionalScore ?? "—"}</td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">Risk Level</td>
              {targets.map(o => (
                <td key={o.symbol} className="px-3 py-1.5 text-center">
                  <Badge variant="outline" className="text-[10px]">{o.riskLevel ?? "—"}</Badge>
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">Themes</td>
              {targets.map(o => (
                <td key={o.symbol} className="px-3 py-1.5 text-center text-muted-foreground">
                  {(o.themes as string[] | undefined)?.slice(0, 2).join(", ") ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EvidencePanelView({ panel }: { panel: EvidencePanel }) {
  const sections = [
    { label: "Supporting Evidence", items: panel.supportingEvidence, icon: <Star className="h-3.5 w-3.5" /> },
    { label: "Technical Evidence",  items: panel.technicalEvidence,  icon: <TrendingUp className="h-3.5 w-3.5" /> },
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
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className={`text-[10px] font-semibold uppercase ${STRENGTH_COLORS[item.strength] ?? ""}`}>
                    {item.strength}
                  </span>
                  {item.source && (
                    <span className="text-[9px] text-muted-foreground">{item.source}</span>
                  )}
                </div>
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
                <span className="text-orange-400 mt-0.5 shrink-0">•</span>{r}
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
                <span className="text-red-400 mt-0.5 shrink-0">•</span>{inv}
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

function FollowUpActions({ actions, onFollowUp }: {
  actions:    FollowUpAction[];
  onFollowUp: (a: FollowUpAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onFollowUp(action)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border hover:bg-muted transition-colors"
          title={action.description}
        >
          <ArrowRight className="h-3 w-3" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

function RelatedResearchPanel({ tickers, mode }: { tickers: string[]; mode: ResearchMode }) {
  if (tickers.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Referenced Candidates</p>
      <div className="flex flex-wrap gap-2">
        {tickers.map(t => (
          <div key={t} className="flex items-center gap-1">
            <Link href={`/opportunities/${t}`}>
              <Badge variant="secondary" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs">
                {t}
              </Badge>
            </Link>
            <button
              onClick={() => window.open(`/research-workspace?symbol=${t}&mode=company`, "_self")}
              className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
              title={`Research ${t} in AI Workspace`}
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceAttribution({ source, mode }: { source: "openai" | "rule_based"; mode: ResearchMode }) {
  return (
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${source === "openai" ? "bg-green-500" : "bg-yellow-500"}`} />
      <span className="text-[10px] text-muted-foreground">
        {source === "openai" ? "AI-generated analysis" : "Deterministic fallback analysis"} · {RESEARCH_MODE_LABELS[mode]}
      </span>
    </div>
  );
}

function ResponseCard({ response, comparisonSymbols, onFollowUp }: {
  response:          WorkspaceAIResponse;
  comparisonSymbols: string[];
  onFollowUp:        (a: FollowUpAction) => void;
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
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Badge variant="outline" className="text-[10px]">
            {CONTEXT_SCOPE_LABELS[response.contextScope] ?? response.contextScope}
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

      {/* Comparison matrix (comparison mode) */}
      {response.researchMode === "comparison" && comparisonSymbols.length >= 2 && (
        <ComparisonMatrix
          opportunities={response.referencedOpportunities}
          symbols={comparisonSymbols}
        />
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

      {/* Related Research */}
      <RelatedResearchPanel tickers={response.referencedTickers} mode={response.researchMode} />

      {/* Source attribution */}
      <SourceAttribution source={response.source} mode={response.researchMode} />

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground border-t pt-2 mt-2 leading-relaxed">
        {response.disclaimer}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence sidebar (desktop right panel)
// ---------------------------------------------------------------------------

function EvidenceSidebar({ panel, contextLabel, onClose }: {
  panel:        EvidencePanel | null;
  contextLabel: string;
  onClose:      () => void;
}) {
  const allEvidence = [
    ...(panel?.supportingEvidence ?? []),
    ...(panel?.technicalEvidence ?? []),
    ...(panel?.institutionalEvidence ?? []),
  ].slice(0, 8);

  return (
    <aside className="w-64 border-l flex flex-col bg-muted/5 shrink-0 hidden lg:flex">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Evidence Sidebar</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
          <PanelRightClose className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {contextLabel && (
        <div className="px-3 py-2 border-b">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Context</p>
          <p className="text-xs font-medium mt-0.5 leading-snug">{contextLabel}</p>
        </div>
      )}

      <ScrollArea className="flex-1 p-3">
        {allEvidence.length === 0 ? (
          <div className="text-center py-8">
            <Star className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Evidence appears here after each AI response</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top Evidence</p>
            {allEvidence.map((item, i) => (
              <div key={i} className="bg-muted/30 rounded-md p-2">
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[11px] font-medium leading-snug">{item.label}</span>
                  <span className={`text-[9px] font-semibold uppercase shrink-0 ${
                    item.strength === "strong" ? "text-green-600 dark:text-green-400" :
                    item.strength === "moderate" ? "text-yellow-600 dark:text-yellow-400" : "text-orange-600 dark:text-orange-400"
                  }`}>
                    {item.strength}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.value}</p>
                {item.source && (
                  <p className="text-[9px] text-muted-foreground/70 mt-0.5">{item.source}</p>
                )}
              </div>
            ))}

            {panel?.riskFactors && panel.riskFactors.length > 0 && (
              <>
                <Separator className="my-2" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Risk Factors</p>
                {panel.riskFactors.slice(0, 3).map((r, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
                    <span className="text-orange-400 shrink-0">•</span>
                    <span>{r}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResearchWorkspacePage() {
  const [, navigate] = useLocation();
  const queryClient  = useQueryClient();
  const search       = useSearch();

  const [mode, setMode]                     = useState<ResearchMode>("opportunity");
  const [scope, setScope]                   = useState<ContextScope>("entire_market");
  const [question, setQuestion]             = useState("");
  const [tickers, setTickers]               = useState<string[]>([]);
  const [tickerInput, setTickerInput]       = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [responses, setResponses]           = useState<WorkspaceAIResponse[]>([]);
  const [showTemplates, setShowTemplates]   = useState(false);
  const [showSidebar, setShowSidebar]       = useState(true);
  const [showEvidenceSidebar, setShowEvidenceSidebar] = useState(false);
  const [contextLabel, setContextLabel]     = useState("");
  const [contextMeta, setContextMeta]       = useState<ContextMeta>({});
  const [paramsApplied, setParamsApplied]   = useState(false);
  const [loadConvId, setLoadConvId]         = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Latest evidence panel (for sidebar)
  const latestEvidence = responses.length > 0
    ? responses[responses.length - 1].evidencePanel
    : null;

  // Comparison symbols (from tickers when mode=comparison)
  const comparisonSymbols = mode === "comparison" ? tickers : [];

  // ── Parse URL params on mount / search change ──────────────────────────────
  useEffect(() => {
    if (!search || paramsApplied) return;

    const parsed = parseWorkspaceParams(search);

    // Set mode
    const initialMode = deriveInitialMode(parsed);
    setMode(initialMode);

    // Set scope
    if (parsed.scope) setScope(parsed.scope as ContextScope);

    // Set tickers
    if (parsed.symbols.length >= 2) {
      setTickers(parsed.symbols.slice(0, 5));
    } else if (parsed.symbol) {
      setTickers([parsed.symbol]);
    }

    // Set prefilled question
    const prefill = derivePrefillQuestion(parsed);
    if (prefill) setQuestion(prefill);

    // Set context label
    const label = deriveContextLabel(parsed);
    if (label) {
      setContextLabel(label);
      setShowEvidenceSidebar(true);
    }

    // Build context metadata
    const ctxType = deriveContextType(parsed);
    setContextMeta({
      contextType:       ctxType,
      contextLabel:      label || undefined,
      primarySymbol:     parsed.symbol ?? undefined,
      comparisonSymbols: parsed.symbols.length >= 2 ? parsed.symbols : undefined,
      sourceRoute:       parsed.sourceRoute ?? undefined,
    });

    // Load conversation
    if (parsed.conversation) {
      setLoadConvId(parsed.conversation);
    }

    setParamsApplied(true);
  }, [search, paramsApplied]);

  // ── Load conversation from URL ─────────────────────────────────────────────
  const { data: loadedConv } = useQuery<{ conversation: ConversationDetail }>({
    queryKey: ["/api/research/conversations", loadConvId],
    enabled:  !!loadConvId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!loadedConv?.conversation) return;
    const conv = loadedConv.conversation;
    setConversationId(conv.id);
    setMode(conv.researchMode);
    setScope(conv.contextScope);
    if (conv.tickers?.length) setTickers(conv.tickers);
    if (conv.contextLabel) setContextLabel(conv.contextLabel);

    // Restore messages
    const restored = conv.messages
      .filter(m => m.role === "assistant" && m.response)
      .map(m => m.response as WorkspaceAIResponse);
    if (restored.length > 0) {
      setResponses(restored);
    }
    setLoadConvId(null);
  }, [loadedConv]);

  // Scroll to bottom on new response
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses]);

  // ── Templates ──────────────────────────────────────────────────────────────
  const { data: templatesData } = useQuery<{ templates: ResearchTemplate[] }>({
    queryKey: ["/api/research/templates"],
    staleTime: Infinity,
  });

  // ── Conversations ──────────────────────────────────────────────────────────
  const { data: convsData } = useQuery<ConversationListResponse>({
    queryKey: ["/api/research/conversations"],
    staleTime: 30_000,
  });

  // ── Ask mutation ───────────────────────────────────────────────────────────
  const askMutation = useMutation({
    mutationFn: async (payload: {
      question: string; mode: ResearchMode; scope: ContextScope;
      tickers: string[]; conversationId: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/research/ask", {
        question:        payload.question,
        researchMode:    payload.mode,
        contextScope:    payload.scope,
        tickers:         payload.tickers,
        conversationId:  payload.conversationId ?? undefined,
        researchContext: Object.keys(contextMeta).length > 0 ? contextMeta : undefined,
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

  // ── Pin / delete ───────────────────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    if (!question.trim() || askMutation.isPending) return;
    askMutation.mutate({ question: question.trim(), mode, scope, tickers, conversationId });
  }, [question, askMutation, mode, scope, tickers, conversationId]);

  const handleTemplateSelect = useCallback((t: ResearchTemplate) => {
    setMode(t.mode);
    setScope(t.defaultScope);
    const filled = t.promptText
      .replace(/{TICKER1?}/g, tickers[0] ?? "{TICKER}")
      .replace(/{TICKER2}/g, tickers[1] ?? "{TICKER2}");
    setQuestion(filled);
    setShowTemplates(false);
  }, [tickers]);

  const handleFollowUp = useCallback((action: FollowUpAction) => {
    if (action.action.type === "ask") {
      if (action.action.mode)  setMode(action.action.mode);
      if (action.action.scope) setScope(action.action.scope);
      setQuestion(action.action.question);
    } else if (action.action.type === "navigate") {
      navigate(action.action.path);
    } else if (action.action.type === "set_scope") {
      setScope(action.action.scope);
    } else if (action.action.type === "relax_filter") {
      // Sprint 2.6.4: handle relax_filter by applying suggested scope
      const suggested = (action.action as any).suggestedScope as ContextScope | undefined;
      if (suggested) {
        setScope(suggested);
      } else {
        setScope("entire_market");
      }
    }
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const handleTickerAdd = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !tickers.includes(t) && tickers.length < 5) {
      setTickers(prev => [...prev, t]);
    }
    setTickerInput("");
  };

  const startNewConversation = () => {
    setConversationId(null);
    setResponses([]);
    setContextLabel("");
    setContextMeta({});
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex flex-col">

        {/* Context banner */}
        {contextLabel && (
          <ContextBanner
            label={contextLabel}
            sourceRoute={contextMeta.sourceRoute}
            onDismiss={() => { setContextLabel(""); setContextMeta({}); }}
          />
        )}

        <div className="flex flex-1 min-h-0">
          {/* Left sidebar — conversations */}
          {showSidebar && (
            <aside className="w-56 border-r flex flex-col bg-muted/10 shrink-0">
              <div className="p-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Brain className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-xs">Research Workspace</span>
                </div>
                <button
                  onClick={startNewConversation}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title="New conversation"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <ScrollArea className="flex-1 p-2">
                {convsData?.pinned && convsData.pinned.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">Pinned</p>
                    {convsData.pinned.map(c => (
                      <ConversationItem
                        key={c.id} conv={c}
                        isActive={conversationId === c.id}
                        onSelect={() => { setConversationId(c.id); setResponses([]); setLoadConvId(c.id); }}
                        onPin={() => pinMutation.mutate({ id: c.id, pinned: !c.isPinned })}
                        onDelete={() => deleteMutation.mutate(c.id)}
                      />
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">Recent</p>
                  {(!convsData?.recent || convsData.recent.length === 0) && (
                    <p className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet</p>
                  )}
                  {convsData?.recent?.map(c => (
                    <ConversationItem
                      key={c.id} conv={c}
                      isActive={conversationId === c.id}
                      onSelect={() => { setConversationId(c.id); setResponses([]); setLoadConvId(c.id); }}
                      onPin={() => pinMutation.mutate({ id: c.id, pinned: !c.isPinned })}
                      onDelete={() => deleteMutation.mutate(c.id)}
                    />
                  ))}
                </div>
              </ScrollArea>

              <div className="p-2 border-t">
                <button
                  onClick={() => setShowTemplates(v => !v)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Templates ({templatesData?.templates.length ?? 0})
                </button>
              </div>
            </aside>
          )}

          {/* Main panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top bar */}
            <header className="border-b px-4 py-2 flex items-center gap-3 bg-background shrink-0 flex-wrap gap-y-2">
              <button
                onClick={() => setShowSidebar(v => !v)}
                className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
                title="Toggle sidebar"
              >
                <Layers className="h-4 w-4" />
              </button>

              <ModeSelector selected={mode} onChange={setMode} />

              <div className="ml-auto flex items-center gap-2">
                <ScopeSelector selected={scope} onChange={setScope} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowEvidenceSidebar(v => !v)}
                      className={`p-1.5 rounded transition-colors hidden lg:flex ${showEvidenceSidebar ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
                    >
                      {showEvidenceSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Evidence Sidebar</TooltipContent>
                </Tooltip>
              </div>
            </header>

            {/* Conversation area */}
            <ScrollArea className="flex-1 px-4 py-4">
              {/* Templates grid */}
              {showTemplates && (
                <div className="mb-6 max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Research Templates</p>
                    <button onClick={() => setShowTemplates(false)} className="text-xs text-muted-foreground hover:text-foreground">
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(templatesData?.templates ?? []).map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleTemplateSelect(t)}
                        className="text-left p-3 border rounded-xl hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium group-hover:text-primary transition-colors">{t.label}</p>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {RESEARCH_MODE_LABELS[t.mode].replace(" Research", "")}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                        {t.requiresTicker && tickers.length === 0 && (
                          <p className="text-[10px] text-orange-500 mt-1">⚠ Add a ticker first</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {responses.length === 0 && !showTemplates && (
                <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
                  <Brain className="h-10 w-10 text-muted-foreground/30 mb-4" />
                  <h2 className="text-base font-semibold mb-1">Research Workspace</h2>
                  <p className="text-sm text-muted-foreground mb-1">
                    {RESEARCH_MODE_DESCRIPTIONS[mode]}
                  </p>
                  <p className="text-xs text-muted-foreground mb-5">
                    Scope: {CONTEXT_SCOPE_LABELS[scope]}
                    {tickers.length > 0 && ` · Tickers: ${tickers.join(", ")}`}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {(templatesData?.templates ?? []).slice(0, 6).map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleTemplateSelect(t)}
                        className="px-3 py-1.5 text-xs border rounded-full hover:bg-muted transition-colors"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Response history */}
              <div className="space-y-5 max-w-3xl mx-auto">
                {responses.map((r, i) => (
                  <ResponseCard
                    key={i}
                    response={r}
                    comparisonSymbols={comparisonSymbols}
                    onFollowUp={handleFollowUp}
                  />
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
            <div className="border-t px-4 py-3 bg-background shrink-0">
              {/* Ticker pills */}
              {tickers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tickers.map(t => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="cursor-pointer text-xs"
                      onClick={() => setTickers(prev => prev.filter(x => x !== t))}
                    >
                      {t} ×
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end max-w-3xl mx-auto">
                <div className="flex-1 space-y-1.5">
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
                      placeholder="Pin a ticker (e.g. NVDA)"
                      className="flex-1 text-xs px-3 py-1 rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      maxLength={10}
                    />
                    <button
                      onClick={handleTickerAdd}
                      className="text-xs px-2.5 py-1 rounded-md border hover:bg-muted transition-colors shrink-0"
                    >
                      Add
                    </button>
                    <span className="text-[10px] text-muted-foreground hidden sm:block">
                      {mode === "comparison" ? "Add 2–5 symbols for comparison" : "Optional — pin for company research"}
                    </span>
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

          {/* Evidence sidebar (desktop right panel) */}
          {showEvidenceSidebar && (
            <EvidenceSidebar
              panel={latestEvidence}
              contextLabel={contextLabel}
              onClose={() => setShowEvidenceSidebar(false)}
            />
          )}
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
  conv:     ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onPin:    () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      className={`group relative flex items-start gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors mb-0.5 ${
        isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
    >
      <div className="shrink-0 mt-0.5 text-muted-foreground">
        {MODE_ICONS[conv.researchMode] ?? <Brain className="h-3 w-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate leading-snug">
          {conv.contextLabel ?? conv.title}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {new Date(conv.lastMessageAt).toLocaleDateString()}
        </p>
      </div>
      {hover && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onPin(); }}
            className="p-0.5 rounded hover:bg-muted"
            title={conv.isPinned ? "Unpin" : "Pin"}
          >
            {conv.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-0.5 rounded hover:bg-muted text-red-500"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
