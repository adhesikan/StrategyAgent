/**
 * Research Goals — /goals
 *
 * Sprint 2.6.5: Goals & Research Planning
 *
 * Shows:
 *   - First-time experience for users with no goals (selectable cards + wizard)
 *   - Goal list for returning users
 *   - Create goal wizard (multi-step, inline)
 *
 * COMPLIANCE: No suitability language, no financial questionnaire,
 * no recommendation language. Goals are research preferences only.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle, ArrowRight, Check, ChevronLeft, ChevronRight,
  HelpCircle, Info, Plus, Star, Target, TrendingUp, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  ResearchGoal, GoalType, ResearchHorizon, ResearchStyle, VolatilityPreference,
} from "@shared/research-goal-types";
import {
  GOAL_TYPE_LABELS, GOAL_TYPE_DESCRIPTIONS,
  RESEARCH_HORIZON_LABELS, RESEARCH_HORIZON_DESCRIPTIONS,
  RESEARCH_STYLE_LABELS, RESEARCH_STYLE_DESCRIPTIONS,
  VOLATILITY_PREFERENCE_LABELS, VOLATILITY_PREFERENCE_DESCRIPTIONS, VOLATILITY_DISCLAIMER,
  GOAL_COMPLIANCE_DISCLAIMER, GOAL_PRIVACY_DISCLOSURE,
  GOAL_STATUSES, GOAL_TYPES, RESEARCH_HORIZONS, RESEARCH_STYLES, VOLATILITY_PREFERENCES,
} from "@shared/research-goal-types";

// ---------------------------------------------------------------------------
// Quick-start goal presets (first-time experience)
// ---------------------------------------------------------------------------

const QUICK_GOALS: Array<{
  goalType: GoalType;
  icon: string;
  color: string;
}> = [
  { goalType: "long_term_growth",  icon: "📈", color: "border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10" },
  { goalType: "income",            icon: "💰", color: "border-green-500/40 bg-green-500/5 hover:bg-green-500/10" },
  { goalType: "ai_infrastructure", icon: "🤖", color: "border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10" },
  { goalType: "semiconductors",    icon: "💻", color: "border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10" },
  { goalType: "lower_volatility",  icon: "🛡️", color: "border-yellow-500/40 bg-yellow-500/5 hover:bg-yellow-500/10" },
  { goalType: "dividend_income",   icon: "📊", color: "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10" },
  { goalType: "options_income",    icon: "🎯", color: "border-orange-500/40 bg-orange-500/5 hover:bg-orange-500/10" },
  { goalType: "long_term_compounding", icon: "🔄", color: "border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/10" },
];

// Quick-start theme presets per goal type
const GOAL_THEME_PRESETS: Partial<Record<GoalType, { themes: string[]; sectors: string[] }>> = {
  ai_infrastructure: { themes: ["AI Infrastructure", "Artificial Intelligence"], sectors: ["Technology"] },
  semiconductors:    { themes: ["Semiconductors", "Chips"], sectors: ["Technology"] },
  income:            { themes: [], sectors: [] },
  dividend_income:   { themes: [], sectors: [] },
  options_income:    { themes: [], sectors: [] },
  lower_volatility:  { themes: [], sectors: [] },
  long_term_growth:  { themes: [], sectors: [] },
  long_term_compounding: { themes: [], sectors: [] },
};

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

interface WizardState {
  name:                      string;
  goalType:                  GoalType;
  horizon:                   ResearchHorizon;
  researchStyle:             ResearchStyle;
  preferredThemes:           string[];
  preferredSectors:          string[];
  preferredOpportunityTypes: string[];
  volatilityPreference:      VolatilityPreference;
  optionsInterest:           boolean;
  monitoringEnabled:         boolean;
  description:               string;
}

function defaultWizard(goalType: GoalType = "long_term_growth"): WizardState {
  const preset = GOAL_THEME_PRESETS[goalType];
  return {
    name:                      GOAL_TYPE_LABELS[goalType],
    goalType,
    horizon:                   "long_term",
    researchStyle:             "balanced",
    preferredThemes:           preset?.themes ?? [],
    preferredSectors:          preset?.sectors ?? [],
    preferredOpportunityTypes: [],
    volatilityPreference:      "balanced",
    optionsInterest:           goalType === "options_income",
    monitoringEnabled:         false,
    description:               "",
  };
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function GoalStatusBadge({ goal }: { goal: ResearchGoal }) {
  if (goal.isPrimary && goal.status === "active") {
    return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Primary</Badge>;
  }
  if (goal.status === "paused") {
    return <Badge variant="outline" className="text-yellow-400">Paused</Badge>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Goal card (list)
// ---------------------------------------------------------------------------

function GoalCard({ goal, onSetPrimary }: { goal: ResearchGoal; onSetPrimary: (id: string) => void }) {
  return (
    <Card className="border-border/50 hover:border-border transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link href={`/goals/${goal.id}`}>
                <span className="font-semibold text-sm hover:text-primary cursor-pointer">{goal.name}</span>
              </Link>
              <GoalStatusBadge goal={goal} />
            </div>
            <p className="text-xs text-muted-foreground">
              {GOAL_TYPE_LABELS[goal.goalType]} · {RESEARCH_HORIZON_LABELS[goal.horizon]} · {RESEARCH_STYLE_LABELS[goal.researchStyle]}
            </p>
            {(goal.preferredThemes.length > 0 || goal.preferredSectors.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-2">
                {[...goal.preferredThemes, ...goal.preferredSectors].slice(0, 4).map(t => (
                  <Badge key={t} variant="outline" className="text-xs px-1.5 py-0">{t}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!goal.isPrimary && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onSetPrimary(goal.id)}
                aria-label={`Set ${goal.name} as primary`}
              >
                Set Primary
              </Button>
            )}
            <Link href={`/goals/${goal.id}`}>
              <Button size="sm" variant="outline" className="h-7 text-xs" aria-label={`View ${goal.name}`}>
                View <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

const SECTOR_OPTIONS = [
  "Technology", "Healthcare", "Financials", "Energy",
  "Consumer Discretionary", "Consumer Staples", "Industrials",
  "Materials", "Real Estate", "Utilities", "Communication Services",
];

const THEME_OPTIONS = [
  "AI Infrastructure", "Semiconductors", "Memory", "Networking",
  "Cybersecurity", "Cloud Computing", "Healthcare Technology",
  "Green Energy", "Biotechnology", "Defense", "Dividend Leaders",
];

const OPP_TYPE_OPTIONS = [
  { value: "growth",          label: "Growth Candidate" },
  { value: "long_term",       label: "Long-Term Candidate" },
  { value: "income",          label: "Income Candidate" },
  { value: "covered_call",    label: "Covered Call Research" },
  { value: "cash_secured_put",label: "Cash-Secured Put Research" },
];

function FieldHelp({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground inline ml-1 cursor-help" aria-label="Help" />
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ToggleChip({
  label, selected, onToggle, className = "",
}: { label: string; selected: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      className={`px-3 py-1.5 rounded-full text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
        selected
          ? "bg-primary/20 border-primary/60 text-primary"
          : "bg-transparent border-border text-muted-foreground hover:border-muted-foreground"
      } ${className}`}
    >
      {selected && <Check className="h-3 w-3 inline mr-1" />}{label}
    </button>
  );
}

interface WizardProps {
  initial?: Partial<WizardState>;
  onSave: (state: WizardState) => void;
  onCancel: () => void;
  saving: boolean;
}

function GoalWizard({ initial, onSave, onCancel, saving }: WizardProps) {
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const [state, setState] = useState<WizardState>(
    () => initial ? { ...defaultWizard(), ...initial } : defaultWizard(),
  );

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(prev => ({ ...prev, [key]: value }));

  const toggleArray = (arr: string[], item: string): string[] =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];

  function canAdvance(): boolean {
    if (step === 1) return state.goalType.length > 0 && state.name.trim().length > 0;
    if (step === 2) return state.horizon.length > 0;
    return true;
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i + 1 <= step ? "bg-primary" : "bg-muted"}`}
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
          />
        ))}
        <span className="text-xs text-muted-foreground whitespace-nowrap">Step {step} of {totalSteps}</span>
      </div>

      {/* Step 1: Objective */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-base">Choose Research Objective</h3>
            <p className="text-sm text-muted-foreground mt-0.5">What type of research do you want to focus on?</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(GOAL_TYPES as readonly GoalType[]).map(gt => (
              <button
                key={gt}
                type="button"
                onClick={() => {
                  update("goalType", gt);
                  if (state.name === GOAL_TYPE_LABELS[state.goalType] || !state.name) {
                    update("name", GOAL_TYPE_LABELS[gt]);
                  }
                  const preset = GOAL_THEME_PRESETS[gt];
                  if (preset) {
                    if (state.preferredThemes.length === 0) update("preferredThemes", preset.themes);
                    if (state.preferredSectors.length === 0) update("preferredSectors", preset.sectors);
                  }
                }}
                aria-pressed={state.goalType === gt}
                className={`text-left p-3 rounded-lg border text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  state.goalType === gt
                    ? "border-primary/70 bg-primary/10 text-foreground"
                    : "border-border bg-card hover:border-muted-foreground"
                }`}
              >
                <div className="font-medium">{GOAL_TYPE_LABELS[gt]}</div>
                <div className="text-muted-foreground mt-0.5 text-[11px] leading-snug line-clamp-2">
                  {GOAL_TYPE_DESCRIPTIONS[gt]}
                </div>
                {state.goalType === gt && <Check className="h-3.5 w-3.5 text-primary mt-1" />}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-name" className="text-xs">
              Goal Name
              <FieldHelp text="A short name for this research goal." />
            </Label>
            <Input
              id="goal-name"
              value={state.name}
              onChange={e => update("name", e.target.value)}
              maxLength={120}
              placeholder="e.g. Long-Term AI Research"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 2: Horizon */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-base">Research Horizon</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              What time frame do you want your research to emphasize?
              <FieldHelp text="What time frame you want the research process to emphasize. This does not imply an expected holding period." />
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(RESEARCH_HORIZONS as readonly ResearchHorizon[]).map(h => (
              <button
                key={h}
                type="button"
                onClick={() => update("horizon", h)}
                aria-pressed={state.horizon === h}
                className={`text-left p-3 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  state.horizon === h
                    ? "border-primary/70 bg-primary/10"
                    : "border-border bg-card hover:border-muted-foreground"
                }`}
              >
                <div className="font-medium">{RESEARCH_HORIZON_LABELS[h]}</div>
                <div className="text-xs text-muted-foreground mt-1">{RESEARCH_HORIZON_DESCRIPTIONS[h]}</div>
                {state.horizon === h && <Check className="h-3.5 w-3.5 text-primary mt-1" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Focus Areas */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-base">Research Focus</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Optionally select themes, sectors, or opportunity types to focus on. Leave blank for broad coverage.
            </p>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">Themes</Label>
            <div className="flex flex-wrap gap-1.5">
              {THEME_OPTIONS.map(t => (
                <ToggleChip
                  key={t}
                  label={t}
                  selected={state.preferredThemes.includes(t)}
                  onToggle={() => update("preferredThemes", toggleArray(state.preferredThemes, t))}
                />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">Sectors</Label>
            <div className="flex flex-wrap gap-1.5">
              {SECTOR_OPTIONS.map(s => (
                <ToggleChip
                  key={s}
                  label={s}
                  selected={state.preferredSectors.includes(s)}
                  onToggle={() => update("preferredSectors", toggleArray(state.preferredSectors, s))}
                />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">
              Opportunity Types
              <FieldHelp text="The category of research candidate you want to explore." />
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {OPP_TYPE_OPTIONS.map(o => (
                <ToggleChip
                  key={o.value}
                  label={o.label}
                  selected={state.preferredOpportunityTypes.includes(o.value)}
                  onToggle={() => update("preferredOpportunityTypes", toggleArray(state.preferredOpportunityTypes, o.value))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Preferences */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-base">Optional Research Preferences</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Fine-tune how research is organized.</p>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">
              Research Style
              <FieldHelp text="The types of evidence you want emphasized when exploring candidates." />
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(RESEARCH_STYLES as readonly ResearchStyle[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update("researchStyle", s)}
                  aria-pressed={state.researchStyle === s}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    state.researchStyle === s
                      ? "border-primary/70 bg-primary/10"
                      : "border-border bg-card hover:border-muted-foreground"
                  }`}
                >
                  {RESEARCH_STYLE_LABELS[s]}
                  {state.researchStyle === s && <Check className="h-3 w-3 text-primary inline ml-1" />}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">
              Volatility Focus
              <FieldHelp text={VOLATILITY_DISCLAIMER} />
            </Label>
            <p className="text-xs text-muted-foreground">{VOLATILITY_DISCLAIMER}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(VOLATILITY_PREFERENCES as readonly VolatilityPreference[]).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update("volatilityPreference", v)}
                  aria-pressed={state.volatilityPreference === v}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    state.volatilityPreference === v
                      ? "border-primary/70 bg-primary/10"
                      : "border-border bg-card hover:border-muted-foreground"
                  }`}
                >
                  <div className="font-medium">{VOLATILITY_PREFERENCE_LABELS[v]}</div>
                  <div className="text-muted-foreground text-[11px] mt-0.5">{VOLATILITY_PREFERENCE_DESCRIPTIONS[v]}</div>
                  {state.volatilityPreference === v && <Check className="h-3 w-3 text-primary mt-1" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="options-interest"
              checked={state.optionsInterest}
              onCheckedChange={v => update("optionsInterest", !!v)}
            />
            <Label htmlFor="options-interest" className="text-xs cursor-pointer">
              Include options-income research (covered calls, cash-secured puts)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="monitoring-enabled"
              checked={state.monitoringEnabled}
              onCheckedChange={v => update("monitoringEnabled", !!v)}
            />
            <Label htmlFor="monitoring-enabled" className="text-xs cursor-pointer">
              Monitor this goal for research changes
            </Label>
          </div>
        </div>
      )}

      {/* Step 5: Review */}
      {step === 5 && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-base">Review Research Goal</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Confirm your goal before saving.</p>
          </div>
          <Card className="border-border/50">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{state.name}</span>
                <Badge variant="outline">{GOAL_TYPE_LABELS[state.goalType]}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><span className="text-foreground font-medium">Horizon:</span> {RESEARCH_HORIZON_LABELS[state.horizon]}</div>
                <div><span className="text-foreground font-medium">Style:</span> {RESEARCH_STYLE_LABELS[state.researchStyle]}</div>
                <div><span className="text-foreground font-medium">Volatility:</span> {VOLATILITY_PREFERENCE_LABELS[state.volatilityPreference]}</div>
                <div><span className="text-foreground font-medium">Monitoring:</span> {state.monitoringEnabled ? "Enabled" : "Disabled"}</div>
              </div>
              {state.preferredThemes.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-foreground font-medium">Themes:</span>
                  <div className="flex flex-wrap gap-1">
                    {state.preferredThemes.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                  </div>
                </div>
              )}
              {state.preferredSectors.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-foreground font-medium">Sectors:</span>
                  <div className="flex flex-wrap gap-1">
                    {state.preferredSectors.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 inline mr-1 text-blue-400" />
            {GOAL_COMPLIANCE_DISCLAIMER}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50">
        <div className="flex items-center gap-2">
          {step > 1 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep(s => s - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" />Back
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step < totalSteps ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onSave(state)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-1" />}
              Save Research Goal
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GoalsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [quickGoalType, setQuickGoalType] = useState<GoalType | null>(null);

  const { data: goalsData, isLoading } = useQuery<{ goals: ResearchGoal[]; total: number }>({
    queryKey: ["/api/research-goals"],
  });

  const goals = goalsData?.goals ?? [];
  const hasGoals = goals.length > 0;

  const createMutation = useMutation({
    mutationFn: (state: WizardState) =>
      apiRequest("POST", "/api/research-goals", state).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-goals"] });
      toast({ title: "Research goal created", description: `"${data.goal.name}" is ready.` });
      setShowWizard(false);
      setQuickGoalType(null);
      navigate(`/goals/${data.goal.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create goal", variant: "destructive" });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/research-goals/${id}/primary`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-goals"] });
      toast({ title: "Primary goal updated" });
    },
    onError: () => {
      toast({ title: "Failed to update primary goal", variant: "destructive" });
    },
  });

  const primaryGoal = goals.find(g => g.isPrimary && g.status === "active");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Research Goals
          </h1>
          <p className="text-muted-foreground mt-1">
            Tell VCP Trader AI what you want to focus your research on.
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Wizard (inline) */}
        {!isLoading && showWizard && (
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Create Research Goal</CardTitle>
            </CardHeader>
            <CardContent>
              <GoalWizard
                initial={quickGoalType ? defaultWizard(quickGoalType) : undefined}
                onSave={state => createMutation.mutate(state)}
                onCancel={() => { setShowWizard(false); setQuickGoalType(null); }}
                saving={createMutation.isPending}
              />
            </CardContent>
          </Card>
        )}

        {/* First-time experience */}
        {!isLoading && !hasGoals && !showWizard && (
          <div className="space-y-6">
            <Card className="border-border/50">
              <CardContent className="p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">What are you researching?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose a quick-start goal or create your own. Goals are optional — VCP Trader AI works without them.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {QUICK_GOALS.map(qg => (
                    <button
                      key={qg.goalType}
                      type="button"
                      onClick={() => {
                        setQuickGoalType(qg.goalType);
                        setShowWizard(true);
                      }}
                      className={`flex flex-col items-center gap-2 p-4 rounded-lg border text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${qg.color}`}
                      aria-label={`Create ${GOAL_TYPE_LABELS[qg.goalType]} goal`}
                    >
                      <span className="text-2xl" role="img" aria-hidden="true">{qg.icon}</span>
                      <span className="text-center leading-tight">{GOAL_TYPE_LABELS[qg.goalType]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => { setQuickGoalType(null); setShowWizard(true); }}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />Create My Own Goal
                  </Button>
                  <Link href="/dashboard">
                    <Button variant="ghost" size="sm">Skip for now</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Privacy disclosure */}
            <p className="text-xs text-muted-foreground px-1">
              <Info className="h-3.5 w-3.5 inline mr-1" />
              {GOAL_PRIVACY_DISCLOSURE}{" "}
              <Link href="/privacy"><span className="underline cursor-pointer hover:text-foreground">Privacy Policy</span></Link>
            </p>
          </div>
        )}

        {/* Goal list */}
        {!isLoading && hasGoals && !showWizard && (
          <div className="space-y-6">
            {/* Primary Goal */}
            {primaryGoal && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Primary Research Goal</h2>
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                          <span className="font-semibold">{primaryGoal.name}</span>
                          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Primary</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {GOAL_TYPE_LABELS[primaryGoal.goalType]} · {RESEARCH_HORIZON_LABELS[primaryGoal.horizon]}
                        </p>
                        {(primaryGoal.preferredThemes.length > 0 || primaryGoal.preferredSectors.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {[...primaryGoal.preferredThemes, ...primaryGoal.preferredSectors].slice(0, 5).map(t => (
                              <Badge key={t} variant="outline" className="text-xs px-1.5">{t}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Link href={`/research-workspace?goalId=${primaryGoal.id}&mode=opportunity`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs">Research Workspace</Button>
                        </Link>
                        <Link href={`/goals/${primaryGoal.id}`}>
                          <Button size="sm" className="h-7 text-xs">View Goal</Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* My Goals */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Goals</h2>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => { setQuickGoalType(null); setShowWizard(true); }}
                >
                  <Plus className="h-3.5 w-3.5" />New Goal
                </Button>
              </div>
              <div className="space-y-2">
                {goals.map(goal => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onSetPrimary={id => setPrimaryMutation.mutate(id)}
                  />
                ))}
              </div>
            </div>

            {/* How Goals Affect Research */}
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />How Goals Affect Your Research
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>• <strong className="text-foreground">Research Workspace</strong> — Workspace opens with your goal context and filters pre-applied.</p>
                <p>• <strong className="text-foreground">Opportunity Discovery</strong> — Candidates are matched to your goal filters (theme, sector, type, horizon).</p>
                <p>• <strong className="text-foreground">Dashboard</strong> — Your primary goal surfaces relevant candidates on the dashboard.</p>
                <p>• <strong className="text-foreground">Reports</strong> — Generate research reports focused on your goal.</p>
                <p>• <strong className="text-foreground">Monitor</strong> — Track research changes that affect your goal's candidates.</p>
              </CardContent>
            </Card>

            {/* Privacy & Compliance */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/40 space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Privacy & Research Disclaimer</p>
              <p className="text-xs text-muted-foreground">{GOAL_PRIVACY_DISCLOSURE}</p>
              <p className="text-xs text-muted-foreground">{GOAL_COMPLIANCE_DISCLAIMER}</p>
              <Link href="/privacy">
                <span className="text-xs underline text-muted-foreground hover:text-foreground cursor-pointer">Privacy Policy</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
