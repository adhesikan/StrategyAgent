/**
 * Trade Planning Page — /trade-planning/:symbol
 *
 * Sprint 2.7.0: Research → Trade Planning bridge.
 *
 * Shows how a qualified research candidate could potentially be expressed.
 * Does NOT show: order tickets, contract selectors, strikes, expirations,
 * recommendations, "best trade" language, or suitability assessments.
 *
 * COMPLIANCE:
 *   "Trade Planning provides research scenarios showing how an existing research
 *   thesis could potentially be expressed. It does not constitute investment
 *   advice, a personalized recommendation, a suitability determination, or an
 *   instruction to buy, sell, hold, or enter any security or strategy."
 */

import { useState, useEffect } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, BarChart2, BookOpen,
  Check, ChevronDown, ChevronRight, Clock, ExternalLink, HelpCircle,
  Info, Loader2, Lock, RefreshCw, Shield, Target, TrendingUp, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  TradePlanningContext, TradePlanningConstraints, ExpressionFamilyResult,
  ExpressionStatus, TradePlanningSession, ExpressionFamily,
} from "@shared/trade-planning-types";
import {
  TRADE_PLANNING_DISCLAIMER, CONSTRAINTS_DISCLAIMER, NO_RANKING_DISCLAIMER,
  DEFAULT_CONSTRAINTS, validateConstraints, EXPRESSION_STATUS_LABELS,
  EXPRESSION_STATUS_DESCRIPTIONS, validateExpressionFamily,
} from "@shared/trade-planning-types";

// ---------------------------------------------------------------------------
// Reserved route segments (defense-in-depth)
// ---------------------------------------------------------------------------
const RESERVED_SEGMENTS = new Set(["health", "session", "history", "templates", "metadata"]);

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function ExpressionStatusBadge({ status }: { status: ExpressionStatus }) {
  const styles: Record<ExpressionStatus, string> = {
    applicable:             "bg-green-500/20 text-green-400 border-green-500/30",
    potentially_applicable: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    unavailable:            "bg-muted text-muted-foreground",
  };
  const label = EXPRESSION_STATUS_LABELS[status];
  return (
    <Badge className={`text-xs ${styles[status]}`} aria-label={`Status: ${label}`}>
      {status === "applicable"             && <Check className="h-3 w-3 mr-1" aria-hidden="true" />}
      {status === "potentially_applicable" && <Clock className="h-3 w-3 mr-1" aria-hidden="true" />}
      {status === "unavailable"            && <XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Freshness indicator
// ---------------------------------------------------------------------------

function FreshnessTag({ status, label }: { status: string; label: string }) {
  if (status === "fresh")       return <span className="text-xs text-green-400">{label}</span>;
  if (status === "aging")       return <span className="text-xs text-yellow-400">{label}</span>;
  if (status === "stale")       return <span className="text-xs text-red-400">{label} — may be stale</span>;
  return <span className="text-xs text-muted-foreground">Not available</span>;
}

// ---------------------------------------------------------------------------
// Expression family card
// ---------------------------------------------------------------------------

function ExpressionCard({
  result,
  selected,
  onSelect,
}: {
  result:   ExpressionFamilyResult;
  selected: boolean;
  onSelect: (f: ExpressionFamily) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isUnavailable = result.status === "unavailable";

  return (
    <Card
      className={`border transition-colors cursor-pointer ${
        selected
          ? "border-primary/70 bg-primary/5"
          : isUnavailable
            ? "border-border/30 opacity-60"
            : "border-border/50 hover:border-border"
      }`}
      onClick={() => !isUnavailable && onSelect(result.family)}
      role="radio"
      aria-checked={selected}
      aria-disabled={isUnavailable}
      tabIndex={isUnavailable ? -1 : 0}
      onKeyDown={e => { if (!isUnavailable && (e.key === " " || e.key === "Enter")) onSelect(result.family); }}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{result.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-primary" aria-label="Selected" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{result.description}</p>
          </div>
          <ExpressionStatusBadge status={result.status} />
        </div>

        {/* Reasons */}
        {result.reasons.length > 0 && (
          <div className="space-y-1">
            {result.reasons.slice(0, expanded ? undefined : 2).map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Missing constraints */}
        {result.constraintsMissing.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-yellow-400">Missing Constraints:</p>
            {result.constraintsMissing.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-yellow-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{m}</span>
              </div>
            ))}
          </div>
        )}

        {/* Limitations */}
        {result.limitations.length > 0 && (
          <div className="space-y-1">
            {result.limitations.map((l, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{l}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expand/collapse for long reason lists */}
        {result.reasons.length > 2 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? "Show less" : `Show ${result.reasons.length - 2} more reasons`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Planning constraints form
// ---------------------------------------------------------------------------

interface ConstraintsFormProps {
  constraints: TradePlanningConstraints;
  onChange:    (c: TradePlanningConstraints) => void;
}

function ConstraintsForm({ constraints, onChange }: ConstraintsFormProps) {
  const update = <K extends keyof TradePlanningConstraints>(key: K, value: TradePlanningConstraints[K]) =>
    onChange({ ...constraints, [key]: value });

  return (
    <div className="space-y-5" role="group" aria-label="Planning Constraints">
      {/* Disclaimer */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 inline mr-1 text-blue-400" aria-hidden="true" />
        {CONSTRAINTS_DISCLAIMER}
      </div>

      {/* Capital scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="capital-available" className="text-xs">
            Capital Available for Scenario
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 inline ml-1 text-muted-foreground" aria-label="Help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px] text-xs">
                  Optional. Used to model scaling and cost scenarios only.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            id="capital-available"
            type="number"
            min={0}
            step={1000}
            placeholder="e.g. 10000"
            value={constraints.capitalAvailable ?? ""}
            onChange={e => update("capitalAvailable", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
            aria-describedby="capital-available-hint"
          />
          <span id="capital-available-hint" className="sr-only">Dollar amount for scenario modeling only</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-capital-at-risk" className="text-xs">Maximum Capital at Risk</Label>
          <Input
            id="max-capital-at-risk"
            type="number"
            min={0}
            step={500}
            placeholder="e.g. 2000"
            value={constraints.maxCapitalAtRisk ?? ""}
            onChange={e => update("maxCapitalAtRisk", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-loss" className="text-xs">Maximum Loss per Position</Label>
          <Input
            id="max-loss"
            type="number"
            min={0}
            step={100}
            placeholder="e.g. 500"
            value={constraints.maxLossPerPosition ?? ""}
            onChange={e => update("maxLossPerPosition", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Horizon */}
      <div className="space-y-1">
        <Label htmlFor="horizon" className="text-xs">Planning Horizon</Label>
        <Select
          value={constraints.preferredHoldingPeriod ?? ""}
          onValueChange={v => update("preferredHoldingPeriod", v as TradePlanningConstraints["preferredHoldingPeriod"])}
        >
          <SelectTrigger id="horizon" className="h-8 text-sm w-[220px]" aria-label="Select planning horizon">
            <SelectValue placeholder="Not selected" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">Short (days to weeks)</SelectItem>
            <SelectItem value="medium">Medium (weeks to months)</SelectItem>
            <SelectItem value="long">Long (months+)</SelectItem>
            <SelectItem value="multi_year">Multi-Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Switch
            id="equity-allowed"
            checked={constraints.equityAllowed}
            onCheckedChange={v => update("equityAllowed", v)}
            aria-label="Equity research allowed"
          />
          <Label htmlFor="equity-allowed" className="text-xs cursor-pointer">Equity Research Allowed</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Switch
            id="options-allowed"
            checked={constraints.optionsAllowed}
            onCheckedChange={v => update("optionsAllowed", v)}
            aria-label="Options research allowed"
          />
          <Label htmlFor="options-allowed" className="text-xs cursor-pointer">Options Research Allowed</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="defined-risk"
            checked={constraints.definedRiskPreferred ?? false}
            onCheckedChange={v => update("definedRiskPreferred", !!v)}
            aria-label="Prefer defined-risk structures"
          />
          <Label htmlFor="defined-risk" className="text-xs cursor-pointer">Defined-Risk Preferred</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="income-focus"
            checked={constraints.incomeFocus ?? false}
            onCheckedChange={v => update("incomeFocus", !!v)}
            aria-label="Income-focused expressions"
          />
          <Label htmlFor="income-focus" className="text-xs cursor-pointer">Income Focus</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="directional-focus"
            checked={constraints.directionalFocus ?? false}
            onCheckedChange={v => update("directionalFocus", !!v)}
            aria-label="Directional focus"
          />
          <Label htmlFor="directional-focus" className="text-xs cursor-pointer">Directional Focus</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="avoid-earnings"
            checked={constraints.avoidEarningsWindow ?? false}
            onCheckedChange={v => update("avoidEarningsWindow", !!v)}
            aria-label="Note earnings windows"
          />
          <Label htmlFor="avoid-earnings" className="text-xs cursor-pointer">Note Earnings / Event Windows</Label>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research context card
// ---------------------------------------------------------------------------

function ResearchContextCard({ ctx }: { ctx: TradePlanningContext }) {
  const scores = [
    { label: "Research", value: ctx.researchScore },
    { label: "Technical", value: ctx.technicalScore },
    { label: "Fundamental", value: ctx.fundamentalScore },
    { label: "Institutional", value: ctx.institutionalScore },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Research Context</CardTitle>
          <FreshnessTag
            status={ctx.freshness.opportunityIntelligence.status}
            label={ctx.freshness.opportunityIntelligence.label}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">{ctx.opportunityLabel}</Badge>
          <Badge variant="outline" className="text-xs">{ctx.researchHorizon}</Badge>
          <Badge variant="outline" className={`text-xs ${
            ctx.riskLevel === "high" ? "text-red-400 border-red-400/30" :
            ctx.riskLevel === "low"  ? "text-green-400 border-green-400/30" :
                                       "text-yellow-400 border-yellow-400/30"
          }`}>
            {ctx.riskLevel} risk
          </Badge>
          {ctx.marketRegime && <Badge variant="outline" className="text-xs">{ctx.marketRegime}</Badge>}
        </div>

        {/* Scores */}
        <div className="grid grid-cols-4 gap-2">
          {scores.map(s => (
            <div key={s.label} className="text-center p-2 rounded-lg bg-muted/30">
              <div className="text-base font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Themes */}
        {ctx.themes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ctx.themes.slice(0, 5).map(t => (
              <Badge key={t} variant="outline" className="text-xs px-1.5">{t}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Why qualified card
// ---------------------------------------------------------------------------

function WhyQualifiedCard({ ctx }: { ctx: TradePlanningContext }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Why This Candidate Qualified</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ctx.primaryEvidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Primary Evidence</p>
            {ctx.primaryEvidence.slice(0, 4).map((e, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <Check className="h-3 w-3 text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-medium">{e.label}</span>
                  {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.secondaryEvidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Supporting Context</p>
            {ctx.secondaryEvidence.slice(0, 3).map((e, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{e.label}{e.detail && ` — ${e.detail}`}</span>
              </div>
            ))}
          </div>
        )}
        {ctx.primaryEvidence.length === 0 && ctx.secondaryEvidence.length === 0 && (
          <p className="text-xs text-muted-foreground">Evidence details not available for this candidate.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Risk card
// ---------------------------------------------------------------------------

function RiskCard({ ctx }: { ctx: TradePlanningContext }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-yellow-400" aria-hidden="true" />
          Risk & Thesis Invalidation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ctx.riskFactors.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Risk Factors</p>
            {ctx.riskFactors.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <AlertTriangle className={`h-3 w-3 shrink-0 mt-0.5 ${
                  r.severity === "high" ? "text-red-400" : r.severity === "medium" ? "text-yellow-400" : "text-muted-foreground"
                }`} aria-label={`${r.severity} severity`} />
                <div>
                  <span className="font-medium">{r.label}</span>
                  {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.invalidatesThesis.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Thesis Invalidation Signals</p>
            {ctx.invalidatesThesis.slice(0, 4).map((inv, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-medium">{inv.condition}</span>
                  {inv.detail && <span className="text-muted-foreground"> — {inv.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.riskFactors.length === 0 && ctx.invalidatesThesis.length === 0 && (
          <p className="text-xs text-muted-foreground">No specific risk factors or invalidation conditions recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data freshness card
// ---------------------------------------------------------------------------

function DataFreshnessCard({ ctx }: { ctx: TradePlanningContext }) {
  const items = [
    { label: "Opportunity Intelligence", freshness: ctx.freshness.opportunityIntelligence },
    { label: "Technical Evidence",       freshness: ctx.freshness.technicalEvidence },
    { label: "Fundamental Evidence",     freshness: ctx.freshness.fundamentalEvidence },
    { label: "Institutional Evidence",   freshness: ctx.freshness.institutionalEvidence },
    { label: "Portfolio Context",        freshness: ctx.freshness.portfolioContext },
    { label: "Goal Context",             freshness: ctx.freshness.goalContext },
  ];

  const hasStale = items.some(i => i.freshness.status === "stale");

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Data Freshness
          </CardTitle>
          {hasStale && (
            <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
              <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
              Refresh Suggested
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {items.map(item => (
            <div key={item.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <FreshnessTag status={item.freshness.status} label={item.freshness.label} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// Reserved segments that must not be treated as ticker symbols
const RESERVED = new Set(["health", "session", "history", "templates", "metadata"]);

export default function TradePlanningPage() {
  const [, params] = useRoute("/trade-planning/:symbol");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const rawSymbol = params?.symbol ?? "";
  const symbol    = rawSymbol.toUpperCase();

  const [constraints, setConstraints] = useState<TradePlanningConstraints>(DEFAULT_CONSTRAINTS);
  const [selectedFamily, setSelectedFamily] = useState<ExpressionFamily | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);

  // Validate symbol
  const isReserved = RESERVED.has(symbol);
  if (!symbol || isReserved) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="text-muted-foreground">Invalid trade planning target: {symbol || "(none)"}</p>
        <Link href="/dashboard"><Button variant="outline" size="sm">← Dashboard</Button></Link>
      </div>
    );
  }

  // Build context query (include constraints as query param)
  const contextQuery = useQuery<{
    context: TradePlanningContext;
    existingSession: { id: string } | null;
    disclaimer: string;
  }>({
    queryKey: [`/api/trade-planning/${symbol}/context`, sessionId],
    queryFn: async () => {
      const url = `/api/trade-planning/${symbol}/context`;
      const r = await apiRequest("GET", url);
      return r.json();
    },
  });

  const ctx = contextQuery.data?.context;

  // Seed constraints + session from first load
  useEffect(() => {
    if (contextQuery.data) {
      if (contextQuery.data.existingSession?.id && !sessionId) {
        setSessionId(contextQuery.data.existingSession.id);
      }
    }
  }, [contextQuery.data]);

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/trade-planning/session", {
        symbol,
        constraints,
        goalId:      ctx?.researchGoalId ?? null,
        portfolioId: ctx?.portfolioId ?? null,
      }).then(r => r.json()),
    onSuccess: (data) => {
      setSessionId(data.session.id);
      queryClient.invalidateQueries({ queryKey: [`/api/trade-planning/${symbol}/context`] });
      toast({ title: "Planning session saved" });
    },
    onError: () => toast({ title: "Failed to save session", variant: "destructive" }),
  });

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: (patch: { constraints?: TradePlanningConstraints; selectedExpressionFamily?: ExpressionFamily | null }) =>
      apiRequest("PATCH", `/api/trade-planning/session/${sessionId}`, patch).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/trade-planning/${symbol}/context`] });
    },
    onError: () => toast({ title: "Failed to update session", variant: "destructive" }),
  });

  function handleSaveConstraints() {
    if (sessionId) {
      updateSessionMutation.mutate({ constraints });
    } else {
      createSessionMutation.mutate();
    }
  }

  function handleSelectFamily(f: ExpressionFamily) {
    setSelectedFamily(f === selectedFamily ? null : f);
    if (sessionId) {
      updateSessionMutation.mutate({ selectedExpressionFamily: f === selectedFamily ? null : f });
    }
  }

  const expressions = ctx?.eligibleExpressionFamilies ?? [];
  const applicable  = expressions.filter(e => e.status === "applicable");
  const potential   = expressions.filter(e => e.status === "potentially_applicable");
  const unavailable = expressions.filter(e => e.status === "unavailable");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/opportunities/${symbol}`}>
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" aria-label="Back to opportunity workspace">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {symbol}
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" aria-hidden="true" />
            Trade Planning Research
          </h1>
          <p className="text-sm text-muted-foreground">
            Explore how a qualified research thesis could potentially be expressed through different investment structures.
          </p>
        </div>

        {/* Loading */}
        {contextQuery.isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-label="Loading trade planning context" />
          </div>
        )}

        {/* 404 — no qualified candidate */}
        {contextQuery.isError && (
          <Card className="border-border/50">
            <CardContent className="p-8 text-center space-y-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
              <div>
                <p className="font-semibold">{symbol} is not a current research candidate</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Trade Planning requires a qualified research candidate from the Opportunity Engine.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <Link href="/opportunities">
                  <Button size="sm" variant="outline">View Opportunities</Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="sm" variant="outline">Dashboard</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        {ctx && (
          <div className="space-y-6">
            {/* Limitations banner */}
            {ctx.limitations.length > 0 && (
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 space-y-1">
                {ctx.limitations.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-yellow-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {l}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left column */}
              <div className="space-y-4">
                <ResearchContextCard ctx={ctx} />
                <WhyQualifiedCard ctx={ctx} />
              </div>

              {/* Right column */}
              <div className="space-y-4">
                {/* Goal context */}
                {ctx.goalContext && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Research Goal</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{ctx.goalContext.goalName}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {ctx.goalContext.matchState.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">
                        {ctx.goalContext.goalType.replace(/_/g, " ")} · {ctx.goalContext.horizon.replace(/_/g, " ")}
                      </div>
                      {ctx.goalContext.preferredThemes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ctx.goalContext.preferredThemes.slice(0, 3).map(t => (
                            <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Portfolio context */}
                {ctx.portfolioContext && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Portfolio Context</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span>{ctx.portfolioContext.portfolioName}</span>
                        <Badge variant="outline" className={`text-xs ${ctx.portfolioContext.ownsSymbol ? "text-green-400 border-green-400/30" : ""}`}>
                          {ctx.portfolioContext.ownsSymbol ? "Position Exists" : "Not Held"}
                        </Badge>
                      </div>
                      {ctx.portfolioContext.ownsSymbol && (
                        <div className="grid grid-cols-2 gap-2">
                          {ctx.portfolioContext.positionSize != null && (
                            <div><span className="text-muted-foreground">Size:</span> {ctx.portfolioContext.positionSize} shares</div>
                          )}
                          {ctx.portfolioContext.portfolioWeight != null && (
                            <div><span className="text-muted-foreground">Weight:</span> {ctx.portfolioContext.portfolioWeight.toFixed(1)}%</div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <RiskCard ctx={ctx} />
                <DataFreshnessCard ctx={ctx} />
              </div>
            </div>

            {/* Planning Constraints */}
            <Card className="border-border/50">
              <CardHeader
                className="pb-2 cursor-pointer"
                onClick={() => setConstraintsOpen(x => !x)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Planning Constraints</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Optional</span>
                    {constraintsOpen
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  </div>
                </div>
                <CardDescription className="text-xs">
                  Optional parameters used only to shape which research expressions are explored
                </CardDescription>
              </CardHeader>
              {constraintsOpen && (
                <CardContent className="space-y-4">
                  <ConstraintsForm constraints={constraints} onChange={setConstraints} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveConstraints}
                      disabled={createSessionMutation.isPending || updateSessionMutation.isPending}
                      className="gap-1.5"
                    >
                      {(createSessionMutation.isPending || updateSessionMutation.isPending)
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      Save &amp; Apply Constraints
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConstraints(DEFAULT_CONSTRAINTS)}
                    >
                      Reset
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Expression Families */}
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">Potential Research Expressions</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{NO_RANKING_DISCLAIMER}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 shrink-0"
                  onClick={() => contextQuery.refetch()}
                  aria-label="Refresh expressions"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>

              {/* Applicable */}
              {applicable.length > 0 && (
                <div className="space-y-2" role="radiogroup" aria-label="Applicable research expressions">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Applicable
                  </p>
                  {applicable.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={selectedFamily === e.family}
                      onSelect={handleSelectFamily}
                    />
                  ))}
                </div>
              )}

              {/* Potentially applicable */}
              {potential.length > 0 && (
                <div className="space-y-2" role="radiogroup" aria-label="Potentially applicable research expressions">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Potentially Applicable
                  </p>
                  {potential.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={selectedFamily === e.family}
                      onSelect={handleSelectFamily}
                    />
                  ))}
                </div>
              )}

              {/* Unavailable */}
              {unavailable.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Unavailable
                  </p>
                  {unavailable.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={false}
                      onSelect={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Research Workspace CTA */}
            {selectedFamily && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Explain This Research Expression</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Open Research Workspace to explore the context of this expression approach.
                        AI can explain — but cannot construct a trade or select a contract.
                      </p>
                    </div>
                    <Link href={`/research-workspace?symbol=${symbol}&mode=company&action=explain_concept`}>
                      <Button size="sm" className="gap-2 shrink-0" aria-label="Open Research Workspace for explanation">
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        Research Workspace
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Future Planning Steps */}
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Future Planning Steps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p className="text-foreground font-medium">Coming in future sprints:</p>
                <p>• <strong className="text-foreground">Equity Planning Engine (2.7.1)</strong> — Explore entry approaches, position sizing methods, and phased entry structures.</p>
                <p>• <strong className="text-foreground">Options Strategy Matching (2.7.2)</strong> — Match applicable options structures to the research thesis and planning constraints.</p>
                <p>• <strong className="text-foreground">Contract &amp; Strike Research (2.7.3)</strong> — Research specific contracts for a matched strategy structure.</p>
                <p>• <strong className="text-foreground">Risk &amp; Scenario Analysis (2.7.4)</strong> — Model scenarios for the selected structure.</p>
                <p>• <strong className="text-foreground">Trade Plan Workspace (2.7.5)</strong> — Full trade plan review before any order preparation.</p>
              </CardContent>
            </Card>

            {/* Compliance */}
            <div className="p-4 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 inline mr-1" aria-hidden="true" />
              {TRADE_PLANNING_DISCLAIMER}
            </div>

            {/* Session indicator */}
            {sessionId && (
              <p className="text-xs text-muted-foreground text-center">
                Session saved · Constraints preserved for this symbol
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
