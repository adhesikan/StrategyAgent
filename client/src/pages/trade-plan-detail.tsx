/**
 * client/src/pages/trade-plan-detail.tsx — Trade Plan Detail (Sprint 2.7.5)
 *
 * Sections: Plan Header · Research Thesis · What Changed · Goal/Portfolio Context ·
 * Planning Structure · Equity/Options Snapshot · Risk Summary · Invalidation ·
 * Monitoring Plan · Research Review Checklist · User Notes · Data Freshness ·
 * Plan Timeline · Related Research · Compliance Disclaimer
 *
 * No execution CTA. No broker order. No "approved trade".
 */

import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TRADE_PLAN_STATUS_LABELS,
  TRADE_PLAN_TYPE_LABELS,
  TRADE_PLAN_HEALTH_LABELS,
  TRADE_PLAN_DISCLAIMER,
  RESEARCH_REVIEW_CHECKLIST_DISCLAIMER,
  DEFAULT_TRADE_PLAN_CHECKLIST,
} from "../../../shared/trade-plan-types";
import type {
  TradePlan,
  TradePlanStatus,
  TradePlanHealth,
  TradePlanChecklist,
  TradePlanChangesResponse,
} from "../../../shared/trade-plan-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle, Archive, CheckSquare, ChevronLeft, Clock, Copy,
  ExternalLink, Info, RefreshCw, ShieldAlert, TrendingDown, TrendingUp
} from "lucide-react";

// ============================================================================
// Health Badge
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
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${colorMap[health]}`}
      aria-label={`Plan research health: ${TRADE_PLAN_HEALTH_LABELS[health]}`}
    >
      {TRADE_PLAN_HEALTH_LABELS[health]}
    </span>
  );
}

// ============================================================================
// Score Row
// ============================================================================

function ScoreRow({
  label, saved, delta
}: { label: string; saved: number; delta: number | null }) {
  const current = delta !== null ? saved + delta : null;
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">Saved: {saved.toFixed(1)}</span>
        {current !== null && (
          <>
            <span className="font-mono text-xs">Now: {current.toFixed(1)}</span>
            {delta !== null && delta !== 0 && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${delta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {delta > 0 ? "+" : ""}{delta.toFixed(1)}
              </span>
            )}
          </>
        )}
        {current === null && <span className="text-xs text-muted-foreground">Unavailable</span>}
      </div>
    </div>
  );
}

// ============================================================================
// Checklist Item
// ============================================================================

function ChecklistItem({
  id, label, checked, onChange
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Checkbox
        id={`checklist-${id}`}
        checked={checked}
        onCheckedChange={v => onChange(v === true)}
        aria-label={label}
      />
      <Label htmlFor={`checklist-${id}`} className="text-sm leading-snug cursor-pointer">{label}</Label>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function TradePlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [notes, setNotes] = useState<string>("");
  const [checklist, setChecklist] = useState<TradePlanChecklist>({ ...DEFAULT_TRADE_PLAN_CHECKLIST });
  const [notesInitialized, setNotesInitialized] = useState(false);

  // Fetch plan
  const { data: plan, isLoading, error } = useQuery<TradePlan>({
    queryKey: ["/api/trade-plans", id],
    queryFn:  () => apiRequest("GET", `/api/trade-plans/${id}`).then(r => r.json()),
    enabled:  !!id,
  });

  // Initialize local state from plan data
  useEffect(() => {
    if (plan && !notesInitialized) {
      setNotes(plan.userNotes ?? "");
      setChecklist({ ...DEFAULT_TRADE_PLAN_CHECKLIST, ...(plan.reviewChecklist as Partial<TradePlanChecklist>) });
      setNotesInitialized(true);
    }
  }, [plan, notesInitialized]);

  // Fetch changes comparison
  const {
    data: changesData,
    refetch: refetchChanges,
    isFetching: fetchingChanges,
  } = useQuery<TradePlanChangesResponse>({
    queryKey: ["/api/trade-plans", id, "changes"],
    queryFn:  () => apiRequest("GET", `/api/trade-plans/${id}/changes`).then(r => r.json()),
    enabled:  !!id && !!plan,
    staleTime: 120_000,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/trade-plans/${id}`, patch).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/trade-plans", id] });
      qc.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/trade-plans/${id}/archive`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan archived" });
      navigate("/trade-plans");
    },
    onError: () => toast({ title: "Archive failed", variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/trade-plans/${id}/duplicate`).then(r => r.json()),
    onSuccess: (newPlan: any) => {
      qc.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan duplicated" });
      if (newPlan?.id) navigate(`/trade-plans/${newPlan.id}`);
    },
    onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
  });

  // Handlers
  const handleSaveNotes = () => {
    updateMutation.mutate({ userNotes: notes });
  };

  const handleChecklistChange = (key: keyof TradePlanChecklist, value: boolean) => {
    const updated = { ...checklist, [key]: value };
    setChecklist(updated);
    updateMutation.mutate({ reviewChecklist: updated });
  };

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ status: newStatus });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading trade plan…
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-destructive">Trade plan not found.</p>
        <Button variant="outline" onClick={() => navigate("/trade-plans")}>
          <ChevronLeft className="h-4 w-4 mr-1.5" /> Back to Plans
        </Button>
      </div>
    );
  }

  const change = changesData?.change ?? null;
  const displayHealth: TradePlanHealth = changesData?.planHealth ?? plan.planHealth;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Back nav */}
        <Button variant="ghost" size="sm" onClick={() => navigate("/trade-plans")} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Trade Plans
        </Button>

        {/* § Plan Header */}
        <section aria-labelledby="plan-header-heading">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h1 id="plan-header-heading" className="text-2xl font-bold tracking-tight">
                      {plan.symbol}
                    </h1>
                    {plan.companyName && (
                      <span className="text-muted-foreground">{plan.companyName}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Badge variant="outline">{TRADE_PLAN_TYPE_LABELS[plan.planType]}</Badge>
                    <Badge variant="secondary">{TRADE_PLAN_STATUS_LABELS[plan.status]}</Badge>
                    <PlanHealthBadge health={displayHealth} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    v{plan.version} · Created {new Date(plan.createdAt).toLocaleDateString()}
                    {plan.updatedAt !== plan.createdAt && (
                      ` · Updated ${new Date(plan.updatedAt).toLocaleDateString()}`
                    )}
                  </p>
                  {changesData?.healthReason && (
                    <p className="text-sm mt-1 text-muted-foreground">
                      <Info className="h-3.5 w-3.5 inline mr-1" />
                      {changesData.healthReason}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Select value={plan.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="w-[180px]" aria-label="Update plan status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="RESEARCH_COMPLETE">Research Complete</SelectItem>
                      <SelectItem value="MONITORING">Monitoring</SelectItem>
                      <SelectItem value="ARCHIVED">Archived</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => duplicateMutation.mutate()}
                    disabled={duplicateMutation.isPending}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicate
                  </Button>

                  {plan.status !== "ARCHIVED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archiveMutation.mutate()}
                      disabled={archiveMutation.isPending}
                    >
                      <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* § Research Thesis — Saved at Creation */}
        <section aria-labelledby="research-thesis-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="research-thesis-heading" className="text-base">
                Research Thesis — Saved at Creation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                  { label: "Research Score", value: plan.researchSnapshot.researchScore },
                  { label: "Technical",       value: plan.researchSnapshot.technicalScore },
                  { label: "Fundamental",     value: plan.researchSnapshot.fundamentalScore },
                  { label: "Institutional",   value: plan.researchSnapshot.institutionalScore },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-muted/40 p-3 text-center">
                    <div className="text-xl font-bold">{value.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 text-sm">
                <span><strong>Risk Level:</strong> {plan.researchSnapshot.riskLevel}</span>
                {plan.researchSnapshot.marketRegime && (
                  <span><strong>Market Regime:</strong> {plan.researchSnapshot.marketRegime}</span>
                )}
                {plan.researchSnapshot.sector && (
                  <span><strong>Sector:</strong> {plan.researchSnapshot.sector}</span>
                )}
              </div>

              {plan.researchSnapshot.primaryEvidence.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Primary Evidence at Creation</p>
                  <ul className="space-y-1">
                    {plan.researchSnapshot.primaryEvidence.map((ev, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-foreground font-medium shrink-0">{ev.label}:</span>
                        <span>{ev.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Snapshot as of {new Date(plan.researchSnapshot.generatedAt).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* § What Changed Since Plan Creation */}
        <section aria-labelledby="changes-heading">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle id="changes-heading" className="text-base">
                  What Changed Since Plan Creation
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => refetchChanges()}
                  disabled={fetchingChanges}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingChanges ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!change ? (
                <p className="text-sm text-muted-foreground">Loading current research comparison…</p>
              ) : (
                <div className="space-y-4">
                  {change.thesisInvalidationObserved && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">
                          Research Thesis Invalidation Condition Observed
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                          Conditions: {change.invalidationConditionsFired.join(", ")}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="divide-y">
                    <ScoreRow label="Research Score"  saved={plan.researchSnapshot.researchScore}   delta={change.researchScoreChange} />
                    <ScoreRow label="Technical Score" saved={plan.researchSnapshot.technicalScore}  delta={change.technicalScoreChange} />
                    <ScoreRow label="Fundamental"     saved={plan.researchSnapshot.fundamentalScore} delta={change.fundamentalScoreChange} />
                    <ScoreRow label="Institutional"   saved={plan.researchSnapshot.institutionalScore} delta={change.institutionalScoreChange} />
                  </div>

                  {change.riskLevelChange && (
                    <p className="text-sm"><strong>Risk Level:</strong> {change.riskLevelChange}</p>
                  )}
                  {change.marketRegimeChange && (
                    <p className="text-sm"><strong>Market Regime:</strong> {change.marketRegimeChange}</p>
                  )}
                  {change.qualificationChange && (
                    <p className="text-sm"><strong>Qualification:</strong> {change.qualificationChange}</p>
                  )}
                  {change.newRiskFactors.length > 0 && (
                    <p className="text-sm text-orange-600 dark:text-orange-400">
                      <strong>New risk factors:</strong> {change.newRiskFactors.join(", ")}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">{change.comparisonNote}</p>
                  <p className="text-xs text-muted-foreground">
                    Compared at {new Date(change.lastComparedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* § Planning Structure */}
        <section aria-labelledby="planning-structure-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="planning-structure-heading" className="text-base">Planning Structure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-4">
                <span><strong>Expression:</strong> {plan.selectedExpressionFamily.replace(/_/g, " ")}</span>
                {plan.planningSnapshot.researchHorizon && (
                  <span><strong>Horizon:</strong> {plan.planningSnapshot.researchHorizon}</span>
                )}
              </div>
              {plan.planningSnapshot.goalContextSummary && (
                <p><strong>Goal:</strong> {plan.planningSnapshot.goalContextSummary}</p>
              )}
              {plan.planningSnapshot.portfolioContextSummary && (
                <p><strong>Portfolio:</strong> {plan.planningSnapshot.portfolioContextSummary}</p>
              )}
              {plan.planningSnapshot.limitations.length > 0 && (
                <ul className="text-muted-foreground text-xs space-y-0.5">
                  {plan.planningSnapshot.limitations.map((l, i) => <li key={i}>• {l}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* § Equity Scenario OR Options Structure — Saved */}
        {plan.structureSnapshot && (
          <section aria-labelledby="structure-snapshot-heading">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle id="structure-snapshot-heading" className="text-base">
                  {plan.planType === "EQUITY" ? "Equity Scenario" : "Options Structure"} — Saved
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {plan.planType === "EQUITY" && (() => {
                  const s = plan.structureSnapshot as any;
                  return (
                    <div className="space-y-2">
                      {s.referencePrice != null && (
                        <p>
                          <strong>Reference Price:</strong> ${s.referencePrice.toFixed(2)}
                          {" "}<span className="text-xs text-muted-foreground">({s.referencePriceSource})</span>
                        </p>
                      )}
                      {s.marketDataAsOf && (
                        <p className="text-xs text-muted-foreground">Market data as of {s.marketDataAsOf}</p>
                      )}
                      <p className="text-xs text-muted-foreground italic">
                        Hypothetical scenario for research purposes — not an order quantity.
                      </p>
                    </div>
                  );
                })()}
                {plan.planType === "OPTIONS" && (() => {
                  const s = plan.structureSnapshot as any;
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3">
                        <span><strong>Strategy:</strong> {s.strategyLabel}</span>
                        <span><strong>Expiration:</strong> {s.expirationLabel} ({s.dte} DTE)</span>
                        <span><strong>Liquidity:</strong> {s.liquidityQuality}</span>
                      </div>
                      {s.estimatedMidpoint != null && (
                        <p>
                          <strong>Est. Midpoint:</strong> ${s.estimatedMidpoint.toFixed(2)}
                          {" "}<span className="text-xs text-muted-foreground">(research reference — not live)</span>
                        </p>
                      )}
                      {s.legs?.length > 0 && (
                        <div>
                          <p className="font-medium mb-1">
                            Research Structure Legs
                            {" "}<span className="text-xs font-normal text-muted-foreground">(not order legs)</span>
                          </p>
                          <div className="space-y-1">
                            {s.legs.map((leg: any, i: number) => (
                              <div key={i} className="flex gap-3 text-xs bg-muted/40 rounded px-3 py-2">
                                <span className="capitalize font-medium">{leg.role?.replace(/_/g, " ")}</span>
                                <span>${leg.strike}</span>
                                <span className="capitalize">{leg.optionType}</span>
                                {leg.delta != null && (
                                  <span className="text-muted-foreground">δ {Number(leg.delta).toFixed(2)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </section>
        )}

        {/* § Risk Summary — Saved */}
        {plan.riskSnapshot && (
          <section aria-labelledby="risk-summary-heading">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle id="risk-summary-heading" className="text-base">Risk Summary — Saved</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {plan.riskSnapshot.maxLoss && (
                    <div className="rounded-lg bg-red-500/10 p-3">
                      <div className="text-xs text-muted-foreground mb-0.5">Max Loss</div>
                      <div className="font-medium">{(plan.riskSnapshot.maxLoss as any).label ?? "—"}</div>
                    </div>
                  )}
                  {plan.riskSnapshot.maxGain && (
                    <div className="rounded-lg bg-green-500/10 p-3">
                      <div className="text-xs text-muted-foreground mb-0.5">Max Gain</div>
                      <div className="font-medium">{(plan.riskSnapshot.maxGain as any).label ?? "—"}</div>
                    </div>
                  )}
                  {plan.riskSnapshot.breakevens?.length > 0 && (
                    <div className="rounded-lg bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground mb-0.5">Breakeven</div>
                      <div className="font-medium">
                        {(plan.riskSnapshot.breakevens[0] as any).label ?? "—"}
                      </div>
                    </div>
                  )}
                </div>
                {plan.riskSnapshot.riskFlags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(plan.riskSnapshot.riskFlags as string[]).map((flag) => (
                      <Badge key={flag} variant="outline" className="text-xs">
                        {flag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Analysis saved {new Date(plan.riskSnapshot.generatedAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </section>
        )}

        {/* § Thesis Invalidation Conditions */}
        {plan.researchSnapshot.invalidatesThesis.length > 0 && (
          <section aria-labelledby="invalidation-heading">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle id="invalidation-heading" className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  Thesis Invalidation Conditions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.researchSnapshot.invalidatesThesis.map((cond, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="text-muted-foreground shrink-0">•</span>
                      <div>
                        <span className="font-medium">{cond.condition.replace(/_/g, " ")}: </span>
                        <span className="text-muted-foreground">{cond.description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-3">
                  If observed: review current research. This does not constitute exit advice.
                </p>
              </CardContent>
            </Card>
          </section>
        )}

        {/* § Monitoring Plan */}
        <section aria-labelledby="monitoring-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="monitoring-heading" className="text-base">Monitoring Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {plan.monitoringSnapshot.monitoringPlan ? (
                <p>{plan.monitoringSnapshot.monitoringPlan}</p>
              ) : (
                <p className="text-muted-foreground">No monitoring plan recorded yet.</p>
              )}
              {plan.monitoringSnapshot.watchCriteria.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {plan.monitoringSnapshot.watchCriteria.map(c => (
                    <Badge key={c} variant="secondary" className="text-xs">
                      {c.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={() => navigate("/research-monitor")}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open Research Monitor
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* § Research Review Checklist */}
        <section aria-labelledby="checklist-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="checklist-heading" className="text-base flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                Research Review Checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-xs text-muted-foreground mb-3">{RESEARCH_REVIEW_CHECKLIST_DISCLAIMER}</p>
              {([
                ["reviewedResearchEvidence",   "Reviewed research evidence"],
                ["reviewedRiskFactors",         "Reviewed risk factors"],
                ["reviewedThesisInvalidation",  "Reviewed thesis invalidation conditions"],
                ["reviewedDataFreshness",       "Reviewed data freshness"],
                ["reviewedEventExposure",       "Reviewed event/earnings exposure"],
                ["reviewedLiquidity",           "Reviewed liquidity"],
                ["reviewedPlanningConstraints", "Reviewed planning constraints"],
              ] as [keyof TradePlanChecklist, string][]).map(([key, label]) => (
                <ChecklistItem
                  key={key}
                  id={key}
                  label={label}
                  checked={checklist[key]}
                  onChange={v => handleChecklistChange(key, v)}
                />
              ))}
            </CardContent>
          </Card>
        </section>

        {/* § User Notes (private) */}
        <section aria-labelledby="notes-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="notes-heading" className="text-base">User Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Private notes — not shared or logged.</p>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={"Why I am researching this\nWhat I want to monitor\nQuestions to revisit\nPersonal observations…"}
                rows={5}
                aria-label="User notes"
              />
              <Button
                size="sm"
                onClick={handleSaveNotes}
                disabled={updateMutation.isPending}
              >
                Save Notes
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* § Data Freshness */}
        <section aria-labelledby="freshness-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="freshness-heading" className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Data Freshness
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Research at Creation</span>
                <span>{new Date(plan.researchSnapshot.generatedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Freshness at Creation</span>
                <span className="capitalize">{plan.freshnessAtCreation}</span>
              </div>
              {plan.riskSnapshot && (
                <div className="flex justify-between py-1 border-b">
                  <span className="text-muted-foreground">Risk Analysis</span>
                  <span>{new Date(plan.riskSnapshot.generatedAt).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Plan Created</span>
                <span>{new Date(plan.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Snapshot data reflects what was available at plan creation. Current market data may differ.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* § Plan Timeline */}
        <section aria-labelledby="timeline-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="timeline-heading" className="text-base">Plan Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative border-l border-border space-y-4 ml-2" role="list">
                {([
                  { ts: plan.createdAt,          label: "Plan created" },
                  { ts: plan.completedResearchAt, label: "Research marked complete" },
                  { ts: plan.monitoringStartedAt, label: "Monitoring started" },
                  { ts: plan.archivedAt,          label: "Archived" },
                ] as { ts: string | null; label: string }[])
                  .filter(e => !!e.ts)
                  .map(({ ts, label }) => (
                    <li key={label} className="ml-4">
                      <div className="absolute w-2.5 h-2.5 bg-primary rounded-full -left-[5px] border-2 border-background" />
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{new Date(ts!).toLocaleString()}</p>
                    </li>
                  ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        {/* § Related Research */}
        <section aria-labelledby="related-heading">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="related-heading" className="text-base">Related Research</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Opportunity Workspace", path: `/opportunities/${plan.symbol}` },
                  { label: "Research Workspace",    path: `/research-workspace?symbol=${plan.symbol}` },
                  { label: "Research Monitor",      path: "/research-monitor" },
                  { label: "Research Reports",      path: "/research-reports" },
                ].map(({ label, path }) => (
                  <Button key={label} size="sm" variant="outline" onClick={() => navigate(path)}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    {label}
                  </Button>
                ))}
                {plan.researchGoalId && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/goals/${plan.researchGoalId}`)}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Research Goal
                  </Button>
                )}
                {plan.portfolioId && (
                  <Button size="sm" variant="outline" onClick={() => navigate("/portfolio")}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Portfolio
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* § Future Step — no execution CTA */}
        <Card className="border-dashed opacity-60">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground text-center">
              <strong>Future Step:</strong> Order Preparation — Upcoming
            </p>
          </CardContent>
        </Card>

        {/* § Compliance Disclaimer */}
        <Separator />
        <p className="text-xs text-muted-foreground leading-relaxed" role="note">
          {TRADE_PLAN_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
