/**
 * Research Goal Detail — /goals/:id
 *
 * Sprint 2.6.5: Goal detail, match results, activity, plan, and handoffs.
 *
 * COMPLIANCE: No suitability language, no recommendation language.
 * Match states are categorical research filters only.
 */

import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle, ArrowLeft, ArrowRight, BarChart2, BookOpen, Check,
  Clock, Info, Loader2, Star, Target, TrendingDown, TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  ResearchGoal, GoalMatchSummary, GoalMatchResult, GoalActivitySummary, ResearchPlan,
} from "@shared/research-goal-types";
import {
  GOAL_TYPE_LABELS, RESEARCH_HORIZON_LABELS, RESEARCH_STYLE_LABELS,
  VOLATILITY_PREFERENCE_LABELS, GOAL_MATCH_STATE_LABELS, GOAL_MATCH_DISCLAIMER,
  GOAL_COMPLIANCE_DISCLAIMER,
} from "@shared/research-goal-types";

// ---------------------------------------------------------------------------
// Match state badge
// ---------------------------------------------------------------------------

function MatchStateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    strong_match:    "bg-green-500/20 text-green-400 border-green-500/30",
    match:           "bg-blue-500/20 text-blue-400 border-blue-500/30",
    partial_match:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    outside_filters: "bg-muted text-muted-foreground",
  };
  const label = GOAL_MATCH_STATE_LABELS[state as keyof typeof GOAL_MATCH_STATE_LABELS] ?? state;
  return (
    <Badge className={`text-xs ${styles[state] ?? ""}`}>{label}</Badge>
  );
}

// ---------------------------------------------------------------------------
// Match results tab
// ---------------------------------------------------------------------------

function MatchResultCard({ match }: { match: GoalMatchResult }) {
  return (
    <Card className="border-border/50 hover:border-border transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/opportunities/${match.symbol}`}>
                <span className="font-mono font-semibold text-sm hover:text-primary cursor-pointer">{match.symbol}</span>
              </Link>
              {match.companyName && (
                <span className="text-xs text-muted-foreground truncate">{match.companyName}</span>
              )}
              <MatchStateBadge state={match.matchState} />
            </div>
            {match.matchReasons.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {match.matchReasons.map((r, i) => (
                  <span key={i} className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5 text-green-400 shrink-0" />{r}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Link href={`/opportunities/${match.symbol}`}>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label={`View ${match.symbol}`}>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MatchesTab({ goalId }: { goalId: string }) {
  const { data, isLoading, error } = useQuery<GoalMatchSummary & { disclaimer: string; complianceNote: string }>({
    queryKey: [`/api/research-goals/${goalId}/matches`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <AlertCircle className="h-4 w-4 text-red-400" />
        Failed to load matches. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary counts */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{data.strongMatches}</div>
            <div className="text-xs text-muted-foreground">Strong Matches</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{data.matches}</div>
            <div className="text-xs text-muted-foreground">Matches</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{data.partialMatches}</div>
            <div className="text-xs text-muted-foreground">Partial</div>
          </CardContent>
        </Card>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
        <span>{data.disclaimer}</span>
      </div>

      {/* Match list */}
      {data.topMatches.length > 0 ? (
        <div className="space-y-2">
          {data.topMatches.map(match => (
            <MatchResultCard key={match.symbol} match={match} />
          ))}
        </div>
      ) : (
        <div className="py-10 text-center space-y-2">
          <BarChart2 className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No matching candidates in the current snapshot.</p>
          <p className="text-xs text-muted-foreground">
            This may mean no candidates have cleared all qualification thresholds, or the snapshot is not yet available.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityTab({ goalId }: { goalId: string }) {
  const { data, isLoading } = useQuery<GoalActivitySummary>({
    queryKey: [`/api/research-goals/${goalId}/activity`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const directionIcon = (dir: string) => {
    if (dir === "positive") return <TrendingUp className="h-3.5 w-3.5 text-green-400 shrink-0" />;
    if (dir === "negative") return <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{data.newCandidates}</div>
            <div className="text-xs text-muted-foreground">New Matches</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{data.strengthened}</div>
            <div className="text-xs text-muted-foreground">Regular Matches</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{data.weakened}</div>
            <div className="text-xs text-muted-foreground">Weakened</div>
          </CardContent>
        </Card>
      </div>
      {data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-border/50 text-sm">
              {directionIcon(item.direction)}
              <div className="flex-1">
                <div className="font-medium text-xs">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No recent activity for this goal.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research Plan tab
// ---------------------------------------------------------------------------

function PlanTab({ goalId }: { goalId: string }) {
  const { data, isLoading } = useQuery<{ plan: ResearchPlan; disclaimer: string }>({
    queryKey: [`/api/research-goals/${goalId}/plan`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.plan) return null;

  const { plan } = data;

  return (
    <div className="space-y-5">
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">Research Plan</span>
            <Badge variant="outline" className="text-xs">Active</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Objective:</span> <span className="font-medium">{plan.objective}</span></div>
            <div><span className="text-muted-foreground">Horizon:</span> <span className="font-medium">{plan.horizon}</span></div>
          </div>
          {plan.monitorItems.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Monitor:</p>
              <div className="flex flex-wrap gap-1">
                {plan.monitorItems.map(m => (
                  <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                ))}
              </div>
            </div>
          )}
          {plan.researchCandidates.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Research Candidates:</p>
              <div className="flex flex-wrap gap-1">
                {plan.researchCandidates.map(s => (
                  <Link key={s} href={`/opportunities/${s}`}>
                    <Badge variant="outline" className="text-xs font-mono cursor-pointer hover:bg-muted">{s}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Suggested Research Actions</p>
        <div className="space-y-2">
          {plan.suggestedActions.map((action, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border transition-colors">
              <div className="flex-1">
                <div className="text-sm font-medium">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.description}</div>
              </div>
              {action.url && (
                <Link href={action.url}>
                  <Button size="sm" variant="outline" className="h-7 shrink-0">
                    Open <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-yellow-400" />
        This is a research workflow, not an investment plan. {data.disclaimer}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GoalDetailPage() {
  const [, params] = useRoute("/goals/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const goalId = params?.id ?? "";

  const { data: goalData, isLoading } = useQuery<{ goal: ResearchGoal }>({
    queryKey: [`/api/research-goals/${goalId}`],
    enabled:  !!goalId,
  });

  const goal = goalData?.goal;

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/research-goals/${goalId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-goals"] });
      toast({ title: "Goal archived" });
      navigate("/goals");
    },
    onError: () => toast({ title: "Failed to archive goal", variant: "destructive" }),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/research-goals/${goalId}/primary`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-goals"] });
      queryClient.invalidateQueries({ queryKey: [`/api/research-goals/${goalId}`] });
      toast({ title: "Set as primary research goal" });
    },
    onError: () => toast({ title: "Failed to set as primary", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">Research goal not found.</p>
        <Link href="/goals">
          <Button variant="outline" size="sm">← Back to Goals</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Back */}
        <Link href="/goals">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" />Goals
          </Button>
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{goal.name}</h1>
              {goal.isPrimary && (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                  <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />Primary
                </Badge>
              )}
              {goal.status === "paused" && <Badge variant="outline" className="text-yellow-400">Paused</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {GOAL_TYPE_LABELS[goal.goalType]} · {RESEARCH_HORIZON_LABELS[goal.horizon]} · {RESEARCH_STYLE_LABELS[goal.researchStyle]}
            </p>
            {(goal.preferredThemes.length > 0 || goal.preferredSectors.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[...goal.preferredThemes, ...goal.preferredSectors].slice(0, 6).map(t => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
                {goal.preferredOpportunityTypes.map(t => (
                  <Badge key={t} variant="outline" className="text-xs border-primary/30 text-primary">{t.replace(/_/g, " ")}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!goal.isPrimary && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setPrimaryMutation.mutate()}
                disabled={setPrimaryMutation.isPending}
              >
                Set Primary
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
            >
              Archive
            </Button>
          </div>
        </div>

        {/* Volatility preference */}
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Volatility Focus: <strong className="text-foreground">{VOLATILITY_PREFERENCE_LABELS[goal.volatilityPreference]}</strong>
          {goal.optionsInterest && <> · <strong className="text-foreground">Options Interest</strong></>}
          {goal.monitoringEnabled && <> · <strong className="text-foreground">Monitoring Enabled</strong></>}
        </div>

        {/* CTA row */}
        <div className="flex flex-wrap gap-2">
          <Link href={`/research-workspace?goalId=${goal.id}&mode=opportunity`}>
            <Button size="sm" className="gap-2">
              <BookOpen className="h-3.5 w-3.5" />Research Workspace
            </Button>
          </Link>
          <Link href={`/research-workspace?goalId=${goal.id}&mode=comparison`}>
            <Button size="sm" variant="outline" className="gap-2">
              <BarChart2 className="h-3.5 w-3.5" />Compare Candidates
            </Button>
          </Link>
          <Link href="/research-reports">
            <Button size="sm" variant="outline">Generate Report</Button>
          </Link>
          <Link href="/research-monitor">
            <Button size="sm" variant="outline">Monitor Goal</Button>
          </Link>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="matches">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="matches">Research Matches</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="plan">Research Plan</TabsTrigger>
          </TabsList>

          <TabsContent value="matches" className="mt-4">
            <MatchesTab goalId={goalId} />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <ActivityTab goalId={goalId} />
          </TabsContent>

          <TabsContent value="plan" className="mt-4">
            <PlanTab goalId={goalId} />
          </TabsContent>
        </Tabs>

        {/* Compliance */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 inline mr-1" />
          {GOAL_COMPLIANCE_DISCLAIMER}
        </div>
      </div>
    </div>
  );
}
