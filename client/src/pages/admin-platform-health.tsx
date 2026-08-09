// ---------------------------------------------------------------------------
// Platform Operations Center — Sprint 2.5.3B
//
// Layout order (spec §32):
//   1. Operations Summary
//   2. Research Pipeline
//   3. Data Freshness
//   4. Infrastructure (Application, Database, MCP)
//   5. Market Data & MCP
//   6. Scanner & Intelligence
//   7. Research Services
//   8. Portfolio Services
//   9. Broker Services
//   10. Institutional Services
//   11. Admin Operations
//   12. Background Jobs
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Activity, Database, Server, Globe, BarChart2, Brain,
  Building2, ShieldCheck, Link2, RefreshCw, Wrench, CheckCircle2,
  AlertTriangle, XCircle, MinusCircle, HelpCircle, ExternalLink, Loader2,
  BookOpen, Layers, ArrowDown, Clock, FileText, Briefcase, TrendingUp,
  AlertCircle, ChevronRight, Shield, Zap,
} from "lucide-react";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Types (mirror server types)
// ---------------------------------------------------------------------------

type HealthStatus      = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";
type OperationalStatus = "READY"   | "DEGRADED" | "WAITING"     | "FAILED"   | "UNKNOWN" | "DISABLED";
type FreshnessStatus   = "FRESH"   | "RECENT"   | "DELAYED"     | "STALE"    | "UNKNOWN" | "NOT_APPLICABLE";
type PipelineStatus    = "HEALTHY" | "RUNNING"  | "WAITING"     | "DEGRADED" | "FAILED"  | "UNKNOWN" | "DISABLED";

interface HealthCard {
  status:          HealthStatus;
  summary:         string;
  lastSuccessAt?:  string | null;
  freshnessSec?:   number | null;
  action?:         string | null;
  details:         Record<string, unknown>;
}

interface OperationsDimension {
  dimension:    string;
  status:       OperationalStatus;
  reason:       string | null;
  runbookQuery: string;
}

interface OperationsSummary {
  overallStatus:     OperationalStatus;
  headline:          string;
  requiresAttention: boolean;
  reasons:           string[];
  dimensions:        OperationsDimension[];
  generatedAt:       string;
}

interface PipelineStage {
  name:           string;
  status:         PipelineStatus;
  lastUpdated:    string | null;
  freshnessSec:   number | null;
  primaryMetric:  string;
  warning:        string | null;
  runbookQuery:   string;
  diagnosticPath: string | null;
}

interface FreshnessItem {
  dataset:         string;
  lastUpdated:     string | null;
  ageSec:          number | null;
  ageLabel:        string;
  expectedCadence: string | null;
  freshnessStatus: FreshnessStatus;
  freshnessLabel:  string;
  note?:           string;
}

interface PlatformHealthResponse {
  health:            Record<string, HealthCard>;
  operationsSummary: OperationsSummary;
  researchPipeline:  PipelineStage[];
  dataFreshness:     FreshnessItem[];
  endpointLatencyMs: number;
  cachedAt:          string;
  cached:            boolean;
}

// ---------------------------------------------------------------------------
// Status helpers — canonical vocabulary
// ---------------------------------------------------------------------------

const HEALTH_META: Record<HealthStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  HEALTHY:     { label: "Healthy",     color: "text-green-600",   bg: "bg-green-500/10 border-green-500/20",   Icon: CheckCircle2  },
  DEGRADED:    { label: "Degraded",    color: "text-yellow-600",  bg: "bg-yellow-500/10 border-yellow-500/20", Icon: AlertTriangle },
  UNAVAILABLE: { label: "Unavailable", color: "text-red-600",     bg: "bg-red-500/10 border-red-500/20",       Icon: XCircle       },
  DISABLED:    { label: "Disabled",    color: "text-slate-500",   bg: "bg-slate-500/10 border-slate-500/20",   Icon: MinusCircle   },
  UNKNOWN:     { label: "Unknown",     color: "text-slate-400",   bg: "bg-slate-400/10 border-slate-400/20",   Icon: HelpCircle    },
};

const OPS_META: Record<OperationalStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  READY:    { label: "Ready",    color: "text-green-600",   bg: "bg-green-500/10 border-green-500/20",   Icon: CheckCircle2 },
  DEGRADED: { label: "Degraded", color: "text-yellow-600",  bg: "bg-yellow-500/10 border-yellow-500/20", Icon: AlertTriangle },
  WAITING:  { label: "Waiting",  color: "text-blue-500",    bg: "bg-blue-500/10 border-blue-500/20",     Icon: Clock        },
  FAILED:   { label: "Failed",   color: "text-red-600",     bg: "bg-red-500/10 border-red-500/20",       Icon: XCircle      },
  UNKNOWN:  { label: "Unknown",  color: "text-slate-400",   bg: "bg-slate-400/10 border-slate-400/20",   Icon: HelpCircle   },
  DISABLED: { label: "Disabled", color: "text-slate-500",   bg: "bg-slate-500/10 border-slate-500/20",   Icon: MinusCircle  },
};

const PIPELINE_META: Record<PipelineStatus, { color: string; Icon: React.ElementType }> = {
  HEALTHY:  { color: "text-green-500",  Icon: CheckCircle2  },
  RUNNING:  { color: "text-blue-500",   Icon: RefreshCw     },
  WAITING:  { color: "text-blue-400",   Icon: Clock         },
  DEGRADED: { color: "text-yellow-500", Icon: AlertTriangle },
  FAILED:   { color: "text-red-500",    Icon: XCircle       },
  UNKNOWN:  { color: "text-slate-400",  Icon: HelpCircle    },
  DISABLED: { color: "text-slate-500",  Icon: MinusCircle   },
};

const FRESHNESS_META: Record<FreshnessStatus, { label: string; color: string }> = {
  FRESH:          { label: "Fresh",        color: "text-green-600"  },
  RECENT:         { label: "Recent",       color: "text-blue-500"   },
  DELAYED:        { label: "Delayed",      color: "text-amber-500"  },
  STALE:          { label: "Stale",        color: "text-red-500"    },
  UNKNOWN:        { label: "Unknown",      color: "text-slate-400"  },
  NOT_APPLICABLE: { label: "N/A",          color: "text-slate-400"  },
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const m = HEALTH_META[status] ?? HEALTH_META.UNKNOWN;
  return (
    <Badge variant="outline" className={`text-xs font-semibold border ${m.bg} ${m.color}`}>
      <m.Icon className="h-3 w-3 mr-1" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

function OpsBadge({ status }: { status: OperationalStatus }) {
  const m = OPS_META[status] ?? OPS_META.UNKNOWN;
  return (
    <Badge variant="outline" className={`text-xs font-semibold border ${m.bg} ${m.color}`}>
      <m.Icon className="h-3 w-3 mr-1" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

function ageLabel(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3_600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3_600)}h ago`;
  return `${Math.round(sec / 86_400)}d ago`;
}

// ---------------------------------------------------------------------------
// Section card (individual subsystem)
// ---------------------------------------------------------------------------

interface ManualLink { label: string; docId: string; }

interface SectionCardProps {
  title:        string;
  icon:         React.ElementType;
  card?:        HealthCard;
  manualLinks?: ManualLink[];
  diagnosticHref?: string;
}

function SectionCard({ title, icon: Icon, card, manualLinks, diagnosticHref }: SectionCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (!card) return null;
  const m = HEALTH_META[card.status] ?? HEALTH_META.UNKNOWN;
  const showLinks = manualLinks && manualLinks.length > 0 &&
    (card.status === "DEGRADED" || card.status === "UNAVAILABLE" || card.status === "UNKNOWN");

  return (
    <Card className={`border ${card.status === "DEGRADED" ? "border-yellow-500/30" : card.status === "UNAVAILABLE" ? "border-red-500/30" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <CardTitle className="text-sm font-semibold truncate">{title}</CardTitle>
          </div>
          <StatusBadge status={card.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground">{card.summary}</p>

        {card.freshnessSec != null && (
          <p className="text-xs text-muted-foreground">Updated {ageLabel(card.freshnessSec)}</p>
        )}

        {card.lastSuccessAt && !card.freshnessSec && (
          <p className="text-xs text-muted-foreground">
            Last success: {new Date(card.lastSuccessAt).toLocaleString()}
          </p>
        )}

        {card.action && (
          <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-2 py-1.5">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">{card.action}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {diagnosticHref && (
            <a href={diagnosticHref} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Diagnostics
            </a>
          )}

          {showLinks && manualLinks!.map(link => (
            <Link key={link.docId} href="/admin/operations-manual">
              <span className="flex items-center gap-1 text-xs text-primary underline underline-offset-2 cursor-pointer">
                <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                {link.label}
              </span>
            </Link>
          ))}

          {Object.keys(card.details).length > 0 && (
            <button
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? "Hide" : "Show"} details
            </button>
          )}
        </div>

        {expanded && (
          <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
            {JSON.stringify(card.details, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 1. Operations Summary Banner
// ---------------------------------------------------------------------------

function OperationsSummaryBanner({ summary }: { summary: OperationsSummary }) {
  const m = OPS_META[summary.overallStatus] ?? OPS_META.UNKNOWN;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${m.bg}`}>
      {/* Headline */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <m.Icon className={`h-5 w-5 ${m.color}`} aria-hidden="true" />
          <h2 className={`text-base font-bold ${m.color}`}>{summary.headline}</h2>
        </div>
        <OpsBadge status={summary.overallStatus} />
      </div>

      {/* Attention reasons */}
      {summary.requiresAttention && summary.reasons.length > 0 && (
        <div className="rounded bg-background/60 px-3 py-2 space-y-1">
          {summary.reasons.map(r => (
            <p key={r} className="text-xs flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
              {r}
            </p>
          ))}
        </div>
      )}

      {/* 7 Dimensions grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {summary.dimensions.map(dim => {
          const dm = OPS_META[dim.status] ?? OPS_META.UNKNOWN;
          return (
            <div key={dim.dimension} className="flex flex-col items-center gap-1 rounded bg-background/50 px-2 py-2 text-center min-w-0">
              <dm.Icon className={`h-4 w-4 ${dm.color}`} aria-hidden="true" />
              <p className="text-[10px] font-medium text-foreground leading-tight">{dim.dimension}</p>
              <span className={`text-[9px] font-bold uppercase tracking-wide ${dm.color}`}>{dim.status}</span>
            </div>
          );
        })}
      </div>

      {/* Timestamp */}
      <p className="text-[10px] text-muted-foreground/60 text-right">
        Generated: {new Date(summary.generatedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Research Pipeline
// ---------------------------------------------------------------------------

function ResearchPipelineSection({ stages }: { stages: PipelineStage[] }) {
  return (
    <section aria-labelledby="pipeline-heading">
      <h2 id="pipeline-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Research Pipeline
      </h2>
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-0 min-w-max">
          {stages.map((stage, idx) => {
            const pm = PIPELINE_META[stage.status] ?? PIPELINE_META.UNKNOWN;
            const isLast = idx === stages.length - 1;
            return (
              <div key={stage.name} className="flex items-center gap-0">
                {/* Stage card */}
                <div className={`rounded-lg border bg-card px-3 py-2.5 space-y-1 w-36 ${
                  stage.status === "DEGRADED" || stage.status === "FAILED" ? "border-yellow-500/30" : ""
                }`}>
                  <div className="flex items-center gap-1.5">
                    <pm.Icon className={`h-3.5 w-3.5 shrink-0 ${pm.color} ${stage.status === "RUNNING" ? "animate-spin" : ""}`} aria-hidden="true" />
                    <p className="text-[10px] font-semibold truncate">{stage.name}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">{stage.primaryMetric}</p>
                  {stage.freshnessSec != null && (
                    <p className="text-[9px] text-muted-foreground/70">{ageLabel(stage.freshnessSec)}</p>
                  )}
                  {stage.warning && (
                    <p className="text-[9px] text-amber-600 dark:text-amber-400 line-clamp-1">{stage.warning}</p>
                  )}
                  <div className="flex items-center gap-1">
                    <span className={`text-[9px] font-bold uppercase ${pm.color}`}>{stage.status}</span>
                    {stage.diagnosticPath && (
                      <a href={stage.diagnosticPath} target="_blank" rel="noopener noreferrer"
                         className="text-muted-foreground/60 hover:text-muted-foreground" aria-label="Diagnostics">
                        <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
                {/* Arrow connector */}
                {!isLast && (
                  <div className="flex items-center justify-center w-6 shrink-0">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Mobile: vertical stack */}
      <div className="sm:hidden space-y-1 mt-2">
        {stages.map((stage, idx) => {
          const pm = PIPELINE_META[stage.status] ?? PIPELINE_META.UNKNOWN;
          return (
            <div key={stage.name} className="flex items-start gap-2">
              {/* Left: connector line */}
              <div className="flex flex-col items-center w-4 shrink-0 mt-0.5">
                <pm.Icon className={`h-3 w-3 ${pm.color}`} aria-hidden="true" />
                {idx < stages.length - 1 && <div className="w-px flex-1 bg-border mt-0.5" />}
              </div>
              <div className="pb-1">
                <p className="text-xs font-medium">{stage.name}</p>
                <p className="text-[10px] text-muted-foreground">{stage.primaryMetric}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Data Freshness Dashboard
// ---------------------------------------------------------------------------

function DataFreshnessSection({ items }: { items: FreshnessItem[] }) {
  return (
    <section aria-labelledby="freshness-heading">
      <h2 id="freshness-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Data Freshness
      </h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium">Dataset</th>
                  <th className="text-left px-3 py-2 font-medium">Last Updated</th>
                  <th className="text-left px-3 py-2 font-medium">Age</th>
                  <th className="text-left px-3 py-2 font-medium">Cadence</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const fm = FRESHNESS_META[item.freshnessStatus] ?? FRESHNESS_META.UNKNOWN;
                  return (
                    <tr key={item.dataset} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 font-medium">{item.dataset}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {item.lastUpdated
                          ? new Date(item.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "Never"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{item.ageLabel}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.expectedCadence ?? "—"}</td>
                      <td className={`px-3 py-2 font-semibold ${fm.color}`}>
                        {item.freshnessLabel}
                        {item.note && <span className="ml-1 text-[10px] font-normal text-muted-foreground">({item.note})</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminPlatformHealthPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<PlatformHealthResponse>({
    queryKey: ["/api/admin/platform-health"],
    refetchInterval: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/platform-health/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/platform-health"] }),
  });

  const enrich = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/symbols/enrich"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/platform-health"] }),
  });

  const rebuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/intelligence/rebuild"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/platform-health"] }),
  });

  const h   = data?.health;
  const ops = data?.operationsSummary;

  // Overall health status for header badge
  const allStatuses = h ? Object.values(h).map(c => (c as HealthCard).status) : [];
  const overallStatus: HealthStatus =
    allStatuses.some(s => s === "UNAVAILABLE") ? "UNAVAILABLE" :
    allStatuses.some(s => s === "DEGRADED")    ? "DEGRADED"    :
    allStatuses.every(s => s === "HEALTHY" || s === "DISABLED") ? "HEALTHY" :
    "UNKNOWN";

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Platform Operations Center</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Real-time operational status — no secrets exposed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {h && <StatusBadge status={overallStatus} />}
          <Button
            variant="outline" size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Cache / latency info */}
      {data?.cachedAt && (
        <p className="text-xs text-muted-foreground">
          {data.cached ? "Cached" : "Fresh"} snapshot — {new Date(data.cachedAt).toLocaleTimeString()}
          {data.endpointLatencyMs > 0 && !data.cached && ` (${data.endpointLatencyMs}ms)`}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading platform health…</span>
        </div>
      )}

      {isError && (
        <Card className="border-red-500/30">
          <CardContent className="p-4 text-sm text-red-600">
            Failed to load platform health. Make sure you are signed in as admin.
          </CardContent>
        </Card>
      )}

      {h && ops && data && (
        <>
          {/* ── 1. Operations Summary ────────────────────────────────────── */}
          <OperationsSummaryBanner summary={ops} />

          {/* ── 2. Research Pipeline ─────────────────────────────────────── */}
          {data.researchPipeline && data.researchPipeline.length > 0 && (
            <>
              <Separator />
              <ResearchPipelineSection stages={data.researchPipeline} />
            </>
          )}

          {/* ── 3. Data Freshness ─────────────────────────────────────────── */}
          {data.dataFreshness && data.dataFreshness.length > 0 && (
            <>
              <Separator />
              <DataFreshnessSection items={data.dataFreshness} />
            </>
          )}

          <Separator />

          {/* ── 4. Infrastructure ─────────────────────────────────────────── */}
          <section aria-labelledby="infra-heading" className="space-y-3">
            <h2 id="infra-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Infrastructure
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <SectionCard title="Application" icon={Server} card={h.application as HealthCard} />
              <SectionCard title="Database"    icon={Database} card={h.database as HealthCard}
                manualLinks={[{ label: "Database Runbook", docId: "11-troubleshooting-runbook" }]} />
            </div>
          </section>

          <Separator />

          {/* ── 5. Market Data & MCP ──────────────────────────────────────── */}
          <section aria-labelledby="market-heading" className="space-y-3">
            <h2 id="market-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Market Data & MCP
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="Market Data (Twelve Data)" icon={BarChart2}
                card={h.marketData as HealthCard}
                diagnosticHref="/api/admin/market-data/status"
                manualLinks={[
                  { label: "Market Data Runbook", docId: "03-market-data-ingestion" },
                  { label: "Troubleshooting",     docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="MCP Service" icon={Globe}
                card={h.mcp as HealthCard}
                diagnosticHref="/api/internal/mcp/status"
                manualLinks={[{ label: "MCP Runbook", docId: "04-mcp-service" }]} />
            </div>
          </section>

          <Separator />

          {/* ── 6. Scanner & Intelligence ─────────────────────────────────── */}
          <section aria-labelledby="scanner-heading" className="space-y-3">
            <h2 id="scanner-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Scanner & Intelligence
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <SectionCard title="Scanner" icon={Activity}
                card={h.scanner as HealthCard}
                manualLinks={[
                  { label: "Scanner Runbook",  docId: "05-scanner-and-ranking" },
                  { label: "Troubleshooting",  docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Opportunity Ranking" icon={TrendingUp}
                card={h.ranking as HealthCard}
                manualLinks={[
                  { label: "Ranking Runbook",   docId: "05-scanner-and-ranking" },
                  { label: "Disaster Recovery", docId: "14-disaster-recovery" },
                ]} />
              <SectionCard title="Opportunity Intelligence" icon={Zap}
                card={h.opportunityIntelligence as HealthCard}
                diagnosticHref="/api/admin/intelligence/diagnostics"
                manualLinks={[
                  { label: "OppIntel API/UAT",  docId: "16-api-and-uat-reference" },
                  { label: "OppIntel Runbook",  docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Sector / Theme Intelligence" icon={Brain}
                card={h.intelligence as HealthCard}
                diagnosticHref="/api/admin/intelligence/diagnostics"
                manualLinks={[
                  { label: "Sector Intelligence Runbook", docId: "08-sector-theme-intelligence" },
                  { label: "Intelligence API/UAT",        docId: "16-api-and-uat-reference" },
                ]} />
            </div>
          </section>

          <Separator />

          {/* ── 7. Research Services ──────────────────────────────────────── */}
          <section aria-labelledby="research-heading" className="space-y-3">
            <h2 id="research-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Research Services
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <SectionCard title="Research Workspace" icon={Brain}
                card={h.researchWorkspace as HealthCard}
                manualLinks={[
                  { label: "Workspace API/UAT", docId: "16-api-and-uat-reference" },
                  { label: "Workspace Runbook", docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Research Collections" icon={Layers}
                card={h.collections as HealthCard}
                manualLinks={[
                  { label: "Collections API/UAT", docId: "16-api-and-uat-reference" },
                  { label: "Collections Runbook", docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Research Monitoring" icon={Activity}
                card={h.researchMonitoring as HealthCard}
                diagnosticHref="/api/research-monitor/health"
                manualLinks={[
                  { label: "Monitoring API/UAT", docId: "16-api-and-uat-reference" },
                ]} />
              <SectionCard title="Market Research Command Center" icon={Layers}
                card={h.commandCenter as HealthCard}
                diagnosticHref="/api/command-center/health"
                manualLinks={[
                  { label: "Command Center API/UAT", docId: "16-api-and-uat-reference" },
                  { label: "Command Center Runbook", docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Research Reports" icon={FileText}
                card={h.researchReports as HealthCard}
                diagnosticHref="/api/research-reports/health"
                manualLinks={[
                  { label: "Reports API/UAT", docId: "16-api-and-uat-reference" },
                ]} />
            </div>
          </section>

          <Separator />

          {/* ── 8. Portfolio Services ─────────────────────────────────────── */}
          <section aria-labelledby="portfolio-heading" className="space-y-3">
            <h2 id="portfolio-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Portfolio Services
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="Portfolio History" icon={Briefcase}
                card={h.portfolioHistory as HealthCard}
                manualLinks={[
                  { label: "Portfolio History API/UAT", docId: "16-api-and-uat-reference" },
                ]} />
              <SectionCard title="Portfolio Intelligence" icon={BarChart2}
                card={h.portfolioIntelligence as HealthCard}
                manualLinks={[
                  { label: "Portfolio Intelligence API/UAT", docId: "16-api-and-uat-reference" },
                ]} />
            </div>
          </section>

          <Separator />

          {/* ── 9. Broker Services ────────────────────────────────────────── */}
          <section aria-labelledby="broker-heading" className="space-y-3">
            <h2 id="broker-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Broker Services
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="Broker Configuration" icon={Link2}
                card={h.brokers as HealthCard} />
              <SectionCard title="Broker Sync" icon={Activity}
                card={h.brokerSync as HealthCard}
                manualLinks={[
                  { label: "Broker Sync Runbook", docId: "11-troubleshooting-runbook" },
                  { label: "Broker Sync API/UAT", docId: "16-api-and-uat-reference" },
                ]} />
            </div>
          </section>

          <Separator />

          {/* ── 10. Institutional Services ────────────────────────────────── */}
          <section aria-labelledby="institutional-heading" className="space-y-3">
            <h2 id="institutional-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Institutional Services
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="13F Ingestion & Signals" icon={Building2}
                card={h.institutional as HealthCard}
                manualLinks={[
                  { label: "13F Pipeline Runbook", docId: "06-institutional-13f-pipeline" },
                  { label: "Troubleshooting",       docId: "11-troubleshooting-runbook" },
                ]} />
              <SectionCard title="Security Master" icon={ShieldCheck}
                card={h.securityMaster as HealthCard}
                diagnosticHref="/api/admin/institutional/mapping-diagnostics"
                manualLinks={[
                  { label: "Security Master Runbook", docId: "07-security-master-and-mappings" },
                ]} />
            </div>
          </section>

          <Separator />

          {/* ── 11. Admin Operations ──────────────────────────────────────── */}
          <section aria-labelledby="admin-ops-heading" className="space-y-3">
            <h2 id="admin-ops-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Admin Operations
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

              {/* Enrich Symbols */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Enrich Symbol Classifications</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Fetch sector &amp; industry from Twelve Data /profile for symbols missing classification.
                    Uses 1 credit per symbol.
                  </p>
                  <Button size="sm" variant="outline" disabled={enrich.isPending}
                    onClick={() => { if (confirm("Run symbol enrichment? This will use Twelve Data credits.")) enrich.mutate(); }}
                    className="w-full">
                    {enrich.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />}
                    {enrich.isPending ? "Enriching…" : "Run Enrichment"}
                  </Button>
                  {enrich.isSuccess && <p className="text-xs text-green-600">Enrichment complete. Refresh to see updated coverage.</p>}
                  {enrich.isError   && <p className="text-xs text-red-600">Enrichment failed — check server logs.</p>}
                </CardContent>
              </Card>

              {/* Rebuild Intelligence */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Rebuild Intelligence Snapshots</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Recomputes sector &amp; theme snapshots from the current in-memory ranking.
                    Does not re-run the scanner. Idempotent.
                  </p>
                  <Button size="sm" variant="outline" disabled={rebuild.isPending}
                    onClick={() => { if (confirm("Rebuild intelligence snapshots from current ranking?")) rebuild.mutate(); }}
                    className="w-full">
                    {rebuild.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />}
                    {rebuild.isPending ? "Rebuilding…" : "Rebuild Intelligence"}
                  </Button>
                  {rebuild.isSuccess && <p className="text-xs text-green-600">Rebuild complete. Refresh to see updated counts.</p>}
                  {rebuild.isError   && <p className="text-xs text-red-600">Rebuild failed — may need a scan cycle first.</p>}
                </CardContent>
              </Card>

              {/* Diagnostics & Manual */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Diagnostics & Manual</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <a href="/api/admin/intelligence/diagnostics" target="_blank" rel="noopener noreferrer" className="block">
                    <Button size="sm" variant="outline" className="w-full">
                      Raw Intelligence Diagnostics
                      <ExternalLink className="h-3 w-3 ml-1.5" aria-hidden="true" />
                    </Button>
                  </a>
                  <Link href="/admin/operations-manual">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer pt-1">
                      <BookOpen className="h-3 w-3" aria-hidden="true" />
                      Operations Manual
                    </span>
                  </Link>
                  <Link href="/admin/operations-manual">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" />
                      Troubleshooting Runbook
                    </span>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* ── 12. Background Jobs ───────────────────────────────────────── */}
          {h.jobs && (
            <>
              <Separator />
              <section aria-labelledby="jobs-heading" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 id="jobs-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Background Jobs
                  </h2>
                  <p className="text-xs text-muted-foreground">{(h.jobs as HealthCard).summary}</p>
                </div>
                <JobStatusPanel jobs={(h.jobs as HealthCard).details as Record<string, unknown>} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Background Job Status Panel
// ---------------------------------------------------------------------------

interface JobRow {
  jobName:          string;
  status:           string;
  startedAt:        string | null;
  completedAt:      string | null;
  durationMs:       number | null;
  lastSuccessAt:    string | null;
  lastErrorMessage: string | null;
  nextScheduledRun: string | null;
}

function JobStatusPanel({ jobs }: { jobs: Record<string, unknown> }) {
  const rows = Object.values(jobs) as JobRow[];
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No background jobs registered.</p>;

  const statusColor = (s: string) =>
    s === "completed" ? "text-green-600"  :
    s === "running"   ? "text-blue-500"   :
    s === "failed"    ? "text-red-600"    :
    s === "partial"   ? "text-yellow-600" :
    "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium">Job</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Started</th>
                <th className="text-left px-3 py-2 font-medium">Duration</th>
                <th className="text-left px-3 py-2 font-medium">Last Success</th>
                <th className="text-left px-3 py-2 font-medium">Last Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(j => (
                <tr key={j.jobName} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono">{j.jobName}</td>
                  <td className={`px-3 py-2 font-semibold ${statusColor(j.status)}`}>{j.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {j.startedAt ? new Date(j.startedAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {j.durationMs != null ? `${(j.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {j.lastSuccessAt ? new Date(j.lastSuccessAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-red-600 max-w-[180px] truncate">
                    {j.lastErrorMessage ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
