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
  BookOpen,
} from "lucide-react";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";

interface HealthCard {
  status:          HealthStatus;
  summary:         string;
  lastSuccessAt?:  string | null;
  freshnessSec?:   number | null;
  action?:         string | null;
  details:         Record<string, unknown>;
}

interface PlatformHealthResponse {
  health:    Record<string, HealthCard>;
  cachedAt:  string;
  cached:    boolean;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_META: Record<HealthStatus, { label: string; color: string; Icon: React.ElementType }> = {
  HEALTHY:     { label: "Healthy",     color: "bg-green-500/10 text-green-600 border-green-500/20",     Icon: CheckCircle2  },
  DEGRADED:    { label: "Degraded",    color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",   Icon: AlertTriangle },
  UNAVAILABLE: { label: "Unavailable", color: "bg-red-500/10 text-red-600 border-red-500/20",            Icon: XCircle       },
  DISABLED:    { label: "Disabled",    color: "bg-slate-500/10 text-slate-500 border-slate-500/20",      Icon: MinusCircle   },
  UNKNOWN:     { label: "Unknown",     color: "bg-slate-400/10 text-slate-400 border-slate-400/20",      Icon: HelpCircle    },
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.UNKNOWN;
  return (
    <Badge variant="outline" className={`text-xs font-semibold ${m.color}`}>
      <m.Icon className="h-3 w-3 mr-1" />
      {m.label}
    </Badge>
  );
}

function freshness(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Health section card
// ---------------------------------------------------------------------------

interface ManualLink {
  label:  string;
  docId:  string;
  anchor?: string;
}

interface SectionCardProps {
  title:        string;
  icon:         React.ElementType;
  card:         HealthCard | undefined;
  manualLinks?: ManualLink[];
}

function SectionCard({ title, icon: Icon, card, manualLinks }: SectionCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (!card) return null;
  const m = STATUS_META[card.status] ?? STATUS_META.UNKNOWN;
  const showLinks = manualLinks && manualLinks.length > 0 && (card.status === "DEGRADED" || card.status === "UNAVAILABLE");

  return (
    <Card className={`border ${card.status === "HEALTHY" ? "" : card.status === "DEGRADED" ? "border-yellow-500/30" : card.status === "UNAVAILABLE" ? "border-red-500/30" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
          <StatusBadge status={card.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground">{card.summary}</p>

        {card.freshnessSec != null && (
          <p className="text-xs text-muted-foreground">Updated {freshness(card.freshnessSec)}</p>
        )}

        {card.action && (
          <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-2 py-1">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">{card.action}</p>
          </div>
        )}

        {showLinks && (
          <div className="flex flex-wrap gap-2 pt-1">
            {manualLinks!.map(link => (
              <Link
                key={link.docId + (link.anchor ?? "")}
                href={`/admin/operations-manual`}
              >
                <a className="flex items-center gap-1 text-xs text-primary underline underline-offset-2">
                  <BookOpen className="h-2.5 w-2.5" />
                  {link.label}
                </a>
              </Link>
            ))}
          </div>
        )}

        {Object.keys(card.details).length > 0 && (
          <button
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? "Hide" : "Show"} details
          </button>
        )}

        {expanded && (
          <pre className="text-xs bg-muted/50 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">
            {JSON.stringify(card.details, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/platform-health"] });
    },
  });

  const h = data?.health;

  // Overall system status
  const allStatuses = h ? Object.values(h).map(c => (c as HealthCard).status) : [];
  const overallStatus: HealthStatus =
    allStatuses.some(s => s === "UNAVAILABLE") ? "UNAVAILABLE" :
    allStatuses.some(s => s === "DEGRADED")    ? "DEGRADED"    :
    allStatuses.every(s => s === "HEALTHY" || s === "DISABLED") ? "HEALTHY" :
    "UNKNOWN";

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Platform Health</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Operational status and control center — no secrets are exposed here.
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
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {data?.cachedAt && (
        <p className="text-xs text-muted-foreground">
          {data.cached ? "Cached" : "Fresh"} snapshot — {new Date(data.cachedAt).toLocaleTimeString()}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
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

      {h && (
        <>
          {/* Infrastructure */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Infrastructure</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <SectionCard title="Application"    icon={Server}     card={h.application as HealthCard} />
              <SectionCard title="Database"       icon={Database}   card={h.database    as HealthCard} />
              <SectionCard title="Brokers"        icon={Link2}      card={h.brokers     as HealthCard} />
              <SectionCard title="Opportunity Intelligence" icon={BarChart2} card={h.opportunityIntelligence as HealthCard}
                manualLinks={[
                  { label: "Opportunity Intelligence API", docId: "16-api-and-uat-reference" },
                  { label: "Opportunity Intelligence Runbook", docId: "11-troubleshooting-runbook" },
                ]}
              />
              <SectionCard title="Research Workspace" icon={Brain} card={h.researchWorkspace as HealthCard}
                manualLinks={[
                  { label: "Research Workspace API/UAT", docId: "16-api-and-uat-reference" },
                  { label: "Research Workspace Runbook", docId: "11-troubleshooting-runbook" },
                ]}
              />
              <SectionCard title="Research Collections" icon={Database} card={h.collections as HealthCard}
                manualLinks={[
                  { label: "Collections API/UAT",    docId: "16-api-and-uat-reference" },
                  { label: "Collections Runbook",    docId: "11-troubleshooting-runbook" },
                ]}
              />
              <SectionCard title="Broker Sync"   icon={Activity}   card={h.brokerSync  as HealthCard}
                manualLinks={[
                  { label: "Broker Sync Runbook",  docId: "11-troubleshooting-runbook" },
                  { label: "Broker Sync API/UAT",  docId: "16-api-and-uat-reference" },
                ]}
              />
            </div>
          </section>

          <Separator />

          {/* Market Data & MCP */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Market Data & MCP</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="Market Data (Twelve Data)" icon={BarChart2} card={h.marketData as HealthCard} />
              <SectionCard title="MCP Service"               icon={Globe}     card={h.mcp       as HealthCard} />
            </div>
          </section>

          <Separator />

          {/* Scanner & Intelligence */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Scanner & Intelligence</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <SectionCard title="Scanner"             icon={Activity}  card={h.scanner     as HealthCard}
                manualLinks={[
                  { label: "Scanner Runbook", docId: "05-scanner-and-ranking" },
                  { label: "Troubleshooting", docId: "11-troubleshooting-runbook" },
                ]}
              />
              <SectionCard title="Opportunity Ranking" icon={BarChart2} card={h.ranking      as HealthCard}
                manualLinks={[
                  { label: "Ranking Runbook", docId: "05-scanner-and-ranking" },
                  { label: "Disaster Recovery", docId: "14-disaster-recovery" },
                ]}
              />
              <SectionCard title="Intelligence"        icon={Brain}     card={h.intelligence as HealthCard}
                manualLinks={[
                  { label: "Troubleshoot Sector Intelligence", docId: "08-sector-theme-intelligence" },
                  { label: "Intelligence API/UAT", docId: "16-api-and-uat-reference" },
                  { label: "Open Intelligence Diagnostics", docId: "10-monitoring-and-platform-health" },
                ]}
              />
            </div>
          </section>

          <Separator />

          {/* Institutional */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Institutional 13F</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SectionCard title="13F Ingestion & Signals" icon={Building2}   card={h.institutional as HealthCard}
                manualLinks={[
                  { label: "13F Pipeline Runbook", docId: "06-institutional-13f-pipeline" },
                  { label: "Troubleshooting", docId: "11-troubleshooting-runbook" },
                ]}
              />
              <SectionCard title="Security Master"          icon={ShieldCheck} card={h.securityMaster as HealthCard}
                manualLinks={[
                  { label: "Security Master Runbook", docId: "07-security-master-and-mappings" },
                ]}
              />
            </div>
          </section>

          <Separator />

          {/* Admin Operations */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Admin Operations</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

              {/* Enrich Symbols */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <Wrench className="h-3.5 w-3.5" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Enrich Symbol Classifications</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Fetch sector &amp; industry from Twelve Data /profile for symbols missing classification.
                    Uses 1 credit per symbol.
                  </p>
                  <Button
                    size="sm" variant="outline"
                    disabled={enrich.isPending}
                    onClick={() => {
                      if (confirm("Run symbol enrichment? This will use Twelve Data credits.")) enrich.mutate();
                    }}
                    className="w-full"
                  >
                    {enrich.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    {enrich.isPending ? "Enriching…" : "Run Enrichment"}
                  </Button>
                  {enrich.isSuccess && (
                    <p className="text-xs text-green-600">Enrichment complete. Refresh page to see updated coverage.</p>
                  )}
                  {enrich.isError && (
                    <p className="text-xs text-red-600">Enrichment failed — check server logs.</p>
                  )}
                </CardContent>
              </Card>

              {/* Rebuild Intelligence */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <Brain className="h-3.5 w-3.5" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Rebuild Intelligence Snapshots</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Recomputes sector &amp; theme snapshots from the latest in-memory ranking.
                    Does not re-run the scanner. Idempotent.
                  </p>
                  <Button
                    size="sm" variant="outline"
                    disabled={rebuild.isPending}
                    onClick={() => {
                      if (confirm("Rebuild intelligence snapshots from current ranking?")) rebuild.mutate();
                    }}
                    className="w-full"
                  >
                    {rebuild.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    {rebuild.isPending ? "Rebuilding…" : "Rebuild Intelligence"}
                  </Button>
                  {rebuild.isSuccess && (
                    <p className="text-xs text-green-600">Rebuild complete. Refresh page to see updated counts.</p>
                  )}
                  {rebuild.isError && (
                    <p className="text-xs text-red-600">Rebuild failed — may need a scan cycle first.</p>
                  )}
                </CardContent>
              </Card>

              {/* Raw diagnostics link */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded bg-accent/50 flex items-center justify-center shrink-0">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                    <CardTitle className="text-sm font-semibold">Raw Diagnostics</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Raw JSON from the intelligence diagnostics endpoint — for engineers.
                  </p>
                  <a
                    href="/api/admin/intelligence/diagnostics"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button size="sm" variant="outline" className="w-full">
                      View Raw Diagnostics
                      <ExternalLink className="h-3 w-3 ml-1.5" />
                    </Button>
                  </a>
                  <Link href="/admin/operations-manual">
                    <a className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
                      <BookOpen className="h-3 w-3" />
                      Operations Manual
                    </a>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Job Status */}
          {h.jobs && (
            <>
              <Separator />
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Background Job Status</h2>
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
// Job status panel
// ---------------------------------------------------------------------------

interface JobRow {
  jobName: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  lastSuccessAt: string | null;
  lastErrorMessage: string | null;
}

function JobStatusPanel({ jobs }: { jobs: Record<string, unknown> }) {
  const rows = Object.values(jobs) as JobRow[];
  if (rows.length === 0) return null;

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
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Started</th>
                <th className="text-left px-4 py-2 font-medium">Duration</th>
                <th className="text-left px-4 py-2 font-medium">Last Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(j => (
                <tr key={j.jobName} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{j.jobName}</td>
                  <td className={`px-4 py-2 font-semibold ${statusColor(j.status)}`}>{j.status}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {j.startedAt ? new Date(j.startedAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {j.durationMs != null ? `${(j.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-4 py-2 text-red-600 max-w-[200px] truncate">
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
