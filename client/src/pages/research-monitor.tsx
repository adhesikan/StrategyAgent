/**
 * Research Monitor Page — /research-monitor
 * Sprint 2.5.4 — Continuous Research Monitoring & Daily Intelligence Feed
 *
 * Sections:
 *   1. My Watches (create, view, manage)
 *   2. Daily Research Feed (deterministic, links to existing pages)
 *   3. Watch Creation drawer
 *   4. Watch Detail panel
 *
 * Compliance: no recommendation, prediction, or guarantee.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Bell, BellOff, Plus, Trash2, RefreshCw, Activity,
  TrendingUp, TrendingDown, ArrowRight, Eye, Clock,
  BarChart3, Layers, Globe, Star, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, Info, X, Rss, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type {
  ResearchWatch, DailyResearchFeed, FeedSection, FeedItem,
  ChangeDirection, WatchType,
} from "../../../shared/research-monitor-types";
import { WATCH_TYPES } from "../../../shared/research-monitor-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WatchesResponse { watches: ResearchWatch[]; total: number }
interface FeedResponse { feed: DailyResearchFeed }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WATCH_TYPE_LABELS: Record<WatchType, string> = {
  company: "Company / Ticker",
  theme: "Theme",
  sector: "Sector",
  collection: "Research Collection",
  opportunity_type: "Opportunity Type",
  market_regime: "Market Regime",
  institutional_activity: "Institutional Activity",
  growth_candidates: "Growth Candidates",
  income_candidates: "Income Candidates",
  momentum: "Momentum",
  etf_candidates: "ETF Candidates",
  dividend_candidates: "Dividend Candidates",
  custom_collection: "Custom Collection",
};

const WATCH_TYPE_ICONS: Record<WatchType, typeof Globe> = {
  company: BarChart3,
  theme: Layers,
  sector: Globe,
  collection: Star,
  opportunity_type: Search,
  market_regime: Globe,
  institutional_activity: Eye,
  growth_candidates: TrendingUp,
  income_candidates: Star,
  momentum: Activity,
  etf_candidates: Layers,
  dividend_candidates: Star,
  custom_collection: Layers,
};

function directionBadge(dir: ChangeDirection | null | undefined): { color: string; icon: typeof TrendingUp | null; label: string } {
  switch (dir) {
    case "improved":  return { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp,  label: "Improved" };
    case "new":       return { color: "text-blue-400 bg-blue-500/10 border-blue-500/20",         icon: Plus,        label: "New" };
    case "weakened":  return { color: "text-amber-400 bg-amber-500/10 border-amber-500/20",      icon: TrendingDown,label: "Weakened" };
    case "removed":   return { color: "text-red-400 bg-red-500/10 border-red-500/20",            icon: X,           label: "Removed" };
    case "attention": return { color: "text-orange-400 bg-orange-500/10 border-orange-500/20",   icon: AlertCircle, label: "Attention" };
    default:          return { color: "text-slate-400 bg-slate-500/10 border-slate-500/20",      icon: null,        label: "Stable" };
  }
}

function sectionChangeIcon(changeType: FeedSection["changeType"]) {
  switch (changeType) {
    case "new":       return <Plus className="h-4 w-4 text-blue-400" />;
    case "improved":  return <TrendingUp className="h-4 w-4 text-emerald-400" />;
    case "weakened":  return <TrendingDown className="h-4 w-4 text-amber-400" />;
    case "attention": return <AlertCircle className="h-4 w-4 text-orange-400" />;
    default:          return <CheckCircle2 className="h-4 w-4 text-slate-400" />;
  }
}

function timeAgo(dateStr: string | Date | null): string {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WatchCard({
  watch,
  onDelete,
  onEvaluate,
}: {
  watch: ResearchWatch;
  onDelete: (id: string) => void;
  onEvaluate: (id: string) => void;
}) {
  const Icon = WATCH_TYPE_ICONS[watch.watchType] ?? Globe;
  const { color, icon: DirIcon, label: dirLabel } = directionBadge(
    watch.lastChangeType?.includes("improved") || watch.lastChangeType?.includes("accumulation") ? "improved" :
    watch.lastChangeType?.includes("weakened") || watch.lastChangeType?.includes("distribution") ? "weakened" :
    watch.lastChangeType === "new_candidate" ? "new" :
    watch.lastChangeType === "candidate_removed" ? "removed" :
    watch.lastChangeType === "regime_change" ? "attention" : "stable"
  );

  return (
    <Card className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{watch.name}</p>
              {watch.entityLabel && (
                <p className="text-xs text-slate-500 truncate">{watch.entityLabel}</p>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0 border-slate-700 text-slate-400">
            {WATCH_TYPE_LABELS[watch.watchType]}
          </Badge>
        </div>

        {/* Last change */}
        {watch.lastChangeSummary && watch.lastChangeType !== "status_unchanged" ? (
          <div className={cn("flex items-start gap-1.5 text-xs border rounded px-2 py-1.5", color)}>
            {DirIcon && <DirIcon className="h-3 w-3 mt-0.5 shrink-0" />}
            <span className="leading-relaxed">{watch.lastChangeSummary}</span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-xs text-slate-600 border border-slate-800 rounded px-2 py-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>No changes detected yet</span>
          </div>
        )}

        {/* Freshness + actions */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {watch.lastEvaluatedAt ? `Evaluated ${timeAgo(watch.lastEvaluatedAt)}` : "Not yet evaluated"}
          </span>
          <div className="flex gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-blue-400"
                    onClick={() => onEvaluate(watch.id)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Re-evaluate this watch</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-red-400"
                    onClick={() => onDelete(watch.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Archive this watch</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedSectionCard({ section }: { section: FeedSection }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2 pt-4 px-4">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center justify-between w-full text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            {sectionChangeIcon(section.changeType)}
            <CardTitle className="text-sm text-slate-200">{section.title}</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{section.count}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {section.linkTo && !expanded && (
              <span className="text-[11px] text-blue-400">View all</span>
            )}
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          </div>
        </button>
        {expanded && (
          <p className="text-xs text-slate-500 mt-1">{section.description}</p>
        )}
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-4 space-y-2">
          {section.items.map(item => <FeedItemRow key={item.id} item={item} />)}
          {section.linkTo && (
            <Link href={section.linkTo}>
              <a className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 pt-1">
                <ArrowRight className="h-3 w-3" />
                View in full
              </a>
            </Link>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function FeedItemRow({ item }: { item: FeedItem }) {
  const { color, icon: DirIcon } = directionBadge(item.changeDirection);
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2 min-w-0">
        <div className={cn("mt-0.5 shrink-0 w-4 h-4 flex items-center justify-center rounded-full border", color)}>
          {DirIcon ? <DirIcon className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-300">
            {item.symbol ? <span className="font-mono mr-1">{item.symbol}</span> : null}
            {item.label}
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">{item.detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {item.score !== undefined && (
          <span className="text-[11px] font-mono text-slate-400">{item.score}</span>
        )}
        {item.delta !== undefined && Math.abs(item.delta) > 0 && (
          <span className={cn("text-[10px] font-mono", item.delta > 0 ? "text-emerald-400" : "text-amber-400")}>
            {item.delta > 0 ? "+" : ""}{item.delta}
          </span>
        )}
        <Link href={item.linkTo}>
          <a className="text-slate-600 hover:text-blue-400 transition-colors">
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Watch Modal
// ---------------------------------------------------------------------------

const ENTITY_REQUIRED: WatchType[] = ["company", "theme", "sector", "collection", "institutional_activity"];

function CreateWatchModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [watchType, setWatchType] = useState<WatchType>("company");
  const [entityId, setEntityId] = useState("");
  const [entityLabel, setEntityLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: any = { name, watchType };
      if (entityId) { body.entityId = entityId.toUpperCase(); body.entityLabel = entityLabel || entityId; }
      return apiRequest("POST", "/api/research-monitor/watches", body);
    },
    onSuccess: () => {
      setName(""); setWatchType("company"); setEntityId(""); setEntityLabel(""); setError(null);
      onCreated(); onClose();
    },
    onError: (e: any) => setError(e?.message ?? "Failed to create watch"),
  });

  const needsEntity = ENTITY_REQUIRED.includes(watchType);
  const entityPlaceholder =
    watchType === "company" || watchType === "institutional_activity" ? "e.g. NVDA" :
    watchType === "theme" ? "e.g. ai-infrastructure" :
    watchType === "sector" ? "e.g. Technology" :
    watchType === "collection" ? "Collection ID" : "";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md bg-slate-950 border-slate-800 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-slate-100">New Research Watch</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            Monitor research changes for a company, theme, sector, or market category.
            Research monitors detect changes using existing intelligence — no predictions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Watch Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. NVDA Research Monitor"
              className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Watch Type</Label>
            <Select value={watchType} onValueChange={v => { setWatchType(v as WatchType); setEntityId(""); setEntityLabel(""); }}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {WATCH_TYPES.filter(t => t !== "custom_collection").map(t => (
                  <SelectItem key={t} value={t} className="text-slate-200 focus:bg-slate-800">
                    {WATCH_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsEntity && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">
                {watchType === "company" || watchType === "institutional_activity" ? "Ticker Symbol" :
                 watchType === "theme" ? "Theme ID" :
                 watchType === "sector" ? "Sector Name" : "Entity ID"}
              </Label>
              <Input
                value={entityId}
                onChange={e => setEntityId(e.target.value.toUpperCase())}
                placeholder={entityPlaceholder}
                className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 font-mono"
              />
            </div>
          )}
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{error}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !name.trim() || (needsEntity && !entityId.trim())}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {mutation.isPending ? "Creating…" : "Create Research Watch"}
            </Button>
            <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-200">
              Cancel
            </Button>
          </div>
          <p className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
            Research watches detect changes using existing intelligence. They are not alerts, predictions, or investment advice.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ResearchMonitorPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const watchesQ = useQuery<WatchesResponse>({
    queryKey: ["/api/research-monitor/watches"],
    staleTime: 30_000,
  });
  const feedQ = useQuery<FeedResponse>({
    queryKey: ["/api/research-monitor/feed"],
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/research-monitor/watches/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/research-monitor/watches"] }),
  });

  const evaluateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/research-monitor/watches/${id}/evaluate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/research-monitor/watches"] }),
  });

  const watches = watchesQ.data?.watches ?? [];
  const feed = feedQ.data?.feed;
  const isLoading = watchesQ.isLoading;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Rss className="h-5 w-5 text-blue-400" />
                Research Monitor
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Track research changes across companies, themes, and sectors.
                Deterministic intelligence — no predictions.
              </p>
            </div>
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-sm"
            >
              <Plus className="h-4 w-4" />
              New Watch
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

        {/* ── My Watches ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-slate-400" />
                My Research Watches
                {watches.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-1">{watches.length}</Badge>
                )}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Research changes detected using existing intelligence — no alerts, no execution.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-36 bg-slate-800 rounded-lg" />)}
            </div>
          ) : watches.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800 border-dashed">
              <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
                <BellOff className="h-8 w-8 text-slate-600" />
                <div>
                  <p className="text-sm text-slate-400">No research watches yet</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Create a watch to track research changes for companies, themes, or sectors.
                  </p>
                </div>
                <Button
                  onClick={() => setShowCreate(true)}
                  variant="outline"
                  className="mt-1 border-slate-700 text-slate-300 hover:bg-slate-800 gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create Your First Watch
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {watches.map(w => (
                <WatchCard
                  key={w.id}
                  watch={w}
                  onDelete={id => deleteMutation.mutate(id)}
                  onEvaluate={id => evaluateMutation.mutate(id)}
                />
              ))}
              <Card
                className="bg-slate-900 border-slate-800 border-dashed hover:border-slate-700 cursor-pointer transition-colors"
                onClick={() => setShowCreate(true)}
              >
                <CardContent className="py-8 flex flex-col items-center gap-2 text-center">
                  <Plus className="h-5 w-5 text-slate-600" />
                  <p className="text-xs text-slate-600">Add Research Watch</p>
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        {/* ── Daily Research Feed ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-slate-400" />
                Daily Research Feed
                {feed?.isPersonalized && (
                  <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 ml-1">
                    Personalized
                  </Badge>
                )}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Deterministic changes from existing research intelligence. Not investment advice.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-500 hover:text-slate-300 gap-1 text-xs h-7"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/research-monitor/feed"] })}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>

          {feedQ.isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-24 bg-slate-800 rounded-lg" />)}
            </div>
          ) : !feed ? (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="py-8 text-center">
                <Info className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Feed not available — research intelligence loading</p>
              </CardContent>
            </Card>
          ) : feed.sections.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="py-8 text-center space-y-2">
                <CheckCircle2 className="h-6 w-6 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">No significant research changes observed</p>
                <p className="text-xs text-slate-600">The feed updates when precomputed intelligence detects meaningful changes.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Feed summary */}
              {feed.summary.highlights.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {feed.summary.highlights.map((h, i) => (
                    <span key={i} className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded px-2 py-0.5">
                      {h}
                    </span>
                  ))}
                </div>
              )}

              {/* Feed sections */}
              <div className="space-y-3">
                {feed.sections.map(section => (
                  <FeedSectionCard key={section.id} section={section} />
                ))}
              </div>

              {/* Generated at */}
              <p className="text-[10px] text-slate-700 mt-3 text-right">
                Feed generated {timeAgo(feed.generatedAt)} ·{" "}
                <span className="text-[10px]">Research changes only. Not a recommendation to buy or sell.</span>
              </p>
            </>
          )}
        </section>

        {/* ── Quick links ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5" />
            Related Research
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Dashboard", href: "/dashboard", icon: BarChart3 },
              { label: "Intelligence", href: "/intelligence", icon: Layers },
              { label: "Research Hub", href: "/research", icon: Search },
              { label: "Command Center", href: "/market-research-command-center", icon: Globe },
            ].map(({ label, href, icon: Icon }) => (
              <Link key={href} href={href}>
                <a className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded px-3 py-2 transition-colors">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </a>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <CreateWatchModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["/api/research-monitor/watches"] });
          qc.invalidateQueries({ queryKey: ["/api/research-monitor/feed"] });
        }}
      />
    </div>
  );
}
