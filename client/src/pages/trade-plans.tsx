/**
 * client/src/pages/trade-plans.tsx — Trade Plan Library (Sprint 2.7.5)
 *
 * Lists all user-saved trade plans with search, filter, and sort.
 * No execution CTA. No "best plan" ranking. No P/L performance ranking.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  TRADE_PLAN_STATUSES,
  TRADE_PLAN_TYPES,
  TRADE_PLAN_STATUS_LABELS,
  TRADE_PLAN_TYPE_LABELS,
  TRADE_PLAN_HEALTH_LABELS,
  TRADE_PLAN_DISCLAIMER,
} from "../../../shared/trade-plan-types";
import type {
  TradePlanSummary,
  TradePlanListResponse,
  TradePlanStatus,
  TradePlanType,
  TradePlanHealth,
} from "../../../shared/trade-plan-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Archive, BookOpen, Copy, ExternalLink, Filter, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Plan Health Badge
// ============================================================================

function PlanHealthBadge({ health }: { health: TradePlanHealth }) {
  const colorMap: Record<TradePlanHealth, string> = {
    CURRENT:            "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30",
    CHANGED:            "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
    REQUIRES_REVIEW:    "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30",
    THESIS_INVALIDATED: "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30",
    DATA_STALE:         "bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30",
    UNKNOWN:            "bg-gray-500/20 text-gray-600 dark:text-gray-500 border-gray-500/30",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[health]}`}
      aria-label={`Plan health: ${TRADE_PLAN_HEALTH_LABELS[health]}`}
    >
      {TRADE_PLAN_HEALTH_LABELS[health]}
    </span>
  );
}

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }: { status: TradePlanStatus }) {
  const variantMap: Record<TradePlanStatus, "secondary" | "default" | "outline" | "destructive"> = {
    DRAFT:             "secondary",
    RESEARCH_COMPLETE: "default",
    MONITORING:        "default",
    ARCHIVED:          "outline",
    INVALIDATED:       "destructive",
  };
  return <Badge variant={variantMap[status]}>{TRADE_PLAN_STATUS_LABELS[status]}</Badge>;
}

// ============================================================================
// Score Change Indicator
// ============================================================================

function ScoreChange({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (change === 0)    return <span className="text-muted-foreground text-xs">±0</span>;
  const positive = change > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}{change.toFixed(1)}
    </span>
  );
}

// ============================================================================
// Plan Card
// ============================================================================

function TradePlanCard({ plan, onArchive, onDuplicate }: {
  plan: TradePlanSummary;
  onArchive: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [, navigate] = useLocation();
  const isArchived = plan.status === "ARCHIVED";

  return (
    <Card className={`transition-shadow hover:shadow-md ${isArchived ? "opacity-60" : ""}`}>
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          {/* Left: Symbol + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-bold text-lg tracking-tight">{plan.symbol}</span>
              {plan.companyName && (
                <span className="text-sm text-muted-foreground truncate max-w-[200px]">{plan.companyName}</span>
              )}
              <Badge variant="outline" className="text-xs shrink-0">
                {TRADE_PLAN_TYPE_LABELS[plan.planType]}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <StatusBadge status={plan.status} />
              <PlanHealthBadge health={plan.planHealth} />
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Expression: </span>
                <span className="font-medium capitalize">{plan.selectedExpressionFamily.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Score at creation: </span>
                <span className="font-medium">{plan.researchScoreAtCreation.toFixed(1)}</span>
              </div>
              {plan.currentResearchScore !== null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Current: </span>
                  <span className="font-medium">{plan.currentResearchScore.toFixed(1)}</span>
                  <ScoreChange change={plan.researchScoreChange} />
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Risk: </span>
                <span className="font-medium">{plan.riskLevelAtCreation}</span>
              </div>
            </div>
          </div>

          {/* Right: Timestamps + actions */}
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">
              v{plan.version} · {new Date(plan.createdAt).toLocaleDateString()}
            </span>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => navigate(`/trade-plans/${plan.id}`)}
                aria-label={`Open plan for ${plan.symbol}`}
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                Open
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/opportunities/${plan.symbol}`)}
                aria-label={`Continue research on ${plan.symbol}`}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Research
              </Button>
              {!isArchived && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDuplicate(plan.id)}
                    aria-label={`Duplicate plan for ${plan.symbol}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onArchive(plan.id)}
                    aria-label={`Archive plan for ${plan.symbol}`}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function TradePlansPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [symbol, setSymbol]     = useState("");
  const [status, setStatus]     = useState<string>("all");
  const [planType, setPlanType] = useState<string>("all");
  const [sort, setSort]         = useState<string>("newest");

  // Build query params
  const queryParams = new URLSearchParams();
  if (symbol)               queryParams.set("symbol", symbol);
  if (status !== "all")     queryParams.set("status", status);
  if (planType !== "all")   queryParams.set("planType", planType);
  if (sort)                 queryParams.set("sort", sort);
  queryParams.set("limit", "50");

  const { data, isLoading, error } = useQuery<TradePlanListResponse>({
    queryKey: ["/api/trade-plans", symbol, status, planType, sort],
    queryFn:  () => apiRequest("GET", `/api/trade-plans?${queryParams.toString()}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const archiveMutation = useMutation({
    mutationFn: (planId: string) =>
      apiRequest("POST", `/api/trade-plans/${planId}/archive`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan archived" });
    },
    onError: () => toast({ title: "Failed to archive plan", variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (planId: string) =>
      apiRequest("POST", `/api/trade-plans/${planId}/duplicate`).then(r => r.json()),
    onSuccess: (newPlan: any) => {
      qc.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan duplicated" });
      if (newPlan?.id) navigate(`/trade-plans/${newPlan.id}`);
    },
    onError: () => toast({ title: "Failed to duplicate plan", variant: "destructive" }),
  });

  const plans = data?.plans ?? [];
  const total = data?.total ?? 0;

  // Grouped by status for display
  const active     = plans.filter(p => p.status === "DRAFT" || p.status === "RESEARCH_COMPLETE");
  const monitoring = plans.filter(p => p.status === "MONITORING");
  const archived   = plans.filter(p => p.status === "ARCHIVED");
  const invalid    = plans.filter(p => p.status === "INVALIDATED");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trade Plans</h1>
          <p className="text-muted-foreground mt-1">
            Your saved research plans — combining thesis, planning structure, risk analysis, and monitoring conditions.
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by symbol…"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  className="pl-9 uppercase"
                  aria-label="Filter by symbol"
                  maxLength={10}
                />
              </div>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]" aria-label="Filter by status">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {TRADE_PLAN_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{TRADE_PLAN_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger className="w-[160px]" aria-label="Filter by plan type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TRADE_PLAN_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{TRADE_PLAN_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[170px]" aria-label="Sort plans">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="updated">Recently updated</SelectItem>
                  <SelectItem value="symbol">Symbol A–Z</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">Loading trade plans…</div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load trade plans. Try refreshing.
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!isLoading && !error && plans.length === 0 && (
          <div className="text-center py-16 space-y-4">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <p className="font-medium">No trade plans yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Save a research plan from the Trade Planning page to get started.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              Browse Opportunities
            </Button>
          </div>
        )}

        {/* Plan groups */}
        {!isLoading && plans.length > 0 && (
          <div className="space-y-8">
            {/* Stats bar */}
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>{total}</strong> total plan{total !== 1 ? "s" : ""}</span>
              {active.length > 0     && <span><strong>{active.length}</strong> active</span>}
              {monitoring.length > 0 && <span><strong>{monitoring.length}</strong> monitoring</span>}
              {archived.length > 0   && <span className="text-muted-foreground"><strong>{archived.length}</strong> archived</span>}
            </div>

            {/* Active Plans */}
            {active.length > 0 && (
              <section aria-labelledby="active-plans-heading">
                <h2 id="active-plans-heading" className="text-lg font-semibold mb-3">Active</h2>
                <div className="space-y-3">
                  {active.map(p => (
                    <TradePlanCard key={p.id} plan={p} onArchive={id => archiveMutation.mutate(id)} onDuplicate={id => duplicateMutation.mutate(id)} />
                  ))}
                </div>
              </section>
            )}

            {/* Monitoring */}
            {monitoring.length > 0 && (
              <section aria-labelledby="monitoring-plans-heading">
                <h2 id="monitoring-plans-heading" className="text-lg font-semibold mb-3">Monitoring</h2>
                <div className="space-y-3">
                  {monitoring.map(p => (
                    <TradePlanCard key={p.id} plan={p} onArchive={id => archiveMutation.mutate(id)} onDuplicate={id => duplicateMutation.mutate(id)} />
                  ))}
                </div>
              </section>
            )}

            {/* Invalidated */}
            {invalid.length > 0 && (
              <section aria-labelledby="invalidated-plans-heading">
                <h2 id="invalidated-plans-heading" className="text-lg font-semibold mb-3 text-destructive">
                  Thesis Invalidation Observed
                </h2>
                <div className="space-y-3">
                  {invalid.map(p => (
                    <TradePlanCard key={p.id} plan={p} onArchive={id => archiveMutation.mutate(id)} onDuplicate={id => duplicateMutation.mutate(id)} />
                  ))}
                </div>
              </section>
            )}

            {/* Archived */}
            {archived.length > 0 && (
              <section aria-labelledby="archived-plans-heading">
                <h2 id="archived-plans-heading" className="text-lg font-semibold mb-3 text-muted-foreground">Archived</h2>
                <div className="space-y-3">
                  {archived.map(p => (
                    <TradePlanCard key={p.id} plan={p} onArchive={id => archiveMutation.mutate(id)} onDuplicate={id => duplicateMutation.mutate(id)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Compliance disclaimer */}
        <Separator />
        <p className="text-xs text-muted-foreground leading-relaxed" role="note">
          {TRADE_PLAN_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
