import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Zap,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
  Info,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { RISK_PRESETS, type RiskPreset } from "@shared/risk-presets";
import type { PlatformRiskProfile } from "@shared/platform-types";

const STEPS = [
  { id: 1, label: "Risk Style" },
  { id: 2, label: "Guardrails" },
  { id: 3, label: "Protections" },
] as const;

const MODE_ICONS: Record<string, typeof Shield> = {
  conservative: Shield,
  balanced: ShieldCheck,
  aggressive: Zap,
};

export default function RiskProfilePage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [selectedMode, setSelectedMode] = useState<string>("balanced");
  const [riskPerTrade, setRiskPerTrade] = useState(2.0);
  const [maxDeploy, setMaxDeploy] = useState(50);
  const [protectionsEnabled, setProtectionsEnabled] = useState(true);
  const [guardrails, setGuardrails] = useState<Record<string, unknown>>({});
  const [protections, setProtections] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  const { data: profile, isLoading } = useQuery<PlatformRiskProfile>({
    queryKey: ["/api/platform/risk-profile"],
  });

  useEffect(() => {
    if (profile) {
      setSelectedMode(profile.risk_mode);
      setRiskPerTrade(profile.risk_per_trade);
      setMaxDeploy(profile.max_deploy);
      setProtectionsEnabled(profile.protections_enabled);
      setGuardrails((profile.guardrails_json as Record<string, unknown>) ?? {});
      setProtections((profile.protections_json as Record<string, unknown>) ?? {});
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("PUT", "/api/platform/risk-profile", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/risk-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/context"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  function applyPreset(preset: RiskPreset) {
    setSelectedMode(preset.key);
    setRiskPerTrade(preset.riskPerTrade);
    setMaxDeploy(preset.maxDeploy);
    setDirty(true);
  }

  function handleReset() {
    if (profile) {
      setSelectedMode(profile.risk_mode);
      setRiskPerTrade(profile.risk_per_trade);
      setMaxDeploy(profile.max_deploy);
      setProtectionsEnabled(profile.protections_enabled);
      setGuardrails((profile.guardrails_json as Record<string, unknown>) ?? {});
      setProtections((profile.protections_json as Record<string, unknown>) ?? {});
      setDirty(false);
      toast({ title: "Reset", description: "Changes reverted to saved values." });
    }
  }

  async function handleSaveAndAdvance() {
    const preset = RISK_PRESETS.find(p => p.key === selectedMode);
    const body: Record<string, unknown> = {
      risk_mode: selectedMode,
      risk_per_trade: riskPerTrade,
      max_deploy: maxDeploy,
      protections_enabled: protectionsEnabled,
      guardrails_json: guardrails,
      protections_json: protections,
    };

    if (preset) {
      body.delta_min = preset.deltaMin;
      body.delta_max = preset.deltaMax;
      body.loss_cutoff_mult = preset.lossCutoffMult;
      body.min_premium_pct = preset.minPremiumPct;
      body.vix_pause = preset.vixPause;
    }

    await updateMutation.mutateAsync(body);
    setDirty(false);

    if (step < 3) {
      setStep(step + 1);
    } else {
      toast({ title: "Profile saved", description: "Your risk profile has been updated." });
    }
  }

  const currentPreset = RISK_PRESETS.find(p => p.key === selectedMode);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/settings")}
          data-testid="button-back-settings"
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Global Risk Profile</h1>
          <p className="text-sm text-muted-foreground">Configure how the platform manages your trading risk</p>
        </div>
      </div>

      <SummaryBar
        mode={selectedMode}
        riskPerTrade={riskPerTrade}
        maxDeploy={maxDeploy}
        protectionsEnabled={protectionsEnabled}
      />

      <StepperNav currentStep={step} onStepClick={setStep} />

      {step === 1 && (
        <StepRiskStyle
          selectedMode={selectedMode}
          riskPerTrade={riskPerTrade}
          maxDeploy={maxDeploy}
          onSelectPreset={applyPreset}
          onRiskPerTradeChange={(v) => { setRiskPerTrade(v); setDirty(true); }}
          onMaxDeployChange={(v) => { setMaxDeploy(v); setDirty(true); }}
        />
      )}
      {step === 2 && (
        <StepGuardrails
          mode={selectedMode}
          preset={currentPreset}
          guardrails={guardrails}
          onGuardrailsChange={(g) => { setGuardrails(g); setDirty(true); }}
        />
      )}
      {step === 3 && (
        <StepProtections
          protectionsEnabled={protectionsEnabled}
          onToggle={(v) => { setProtectionsEnabled(v); setDirty(true); }}
          protections={protections}
          onProtectionsChange={(p) => { setProtections(p); setDirty(true); }}
          preset={currentPreset}
        />
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} data-testid="button-prev-step">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={handleReset} disabled={!dirty} data-testid="button-reset">
            <RotateCcw className="mr-1 h-4 w-4" />
            Reset
          </Button>
        </div>
        <Button
          onClick={handleSaveAndAdvance}
          disabled={updateMutation.isPending}
          data-testid="button-save-advance"
        >
          {updateMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {step < 3 ? "Save & Continue" : "Save Profile"}
          {step < 3 && <ChevronRight className="ml-1 h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function SummaryBar({
  mode,
  riskPerTrade,
  maxDeploy,
  protectionsEnabled,
}: {
  mode: string;
  riskPerTrade: number;
  maxDeploy: number;
  protectionsEnabled: boolean;
}) {
  const Icon = MODE_ICONS[mode] ?? ShieldCheck;
  return (
    <Card data-testid="card-summary-bar">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium capitalize" data-testid="text-summary-mode">{mode}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Risk/Trade</span>
            <Badge variant="secondary" data-testid="text-summary-rpt">{riskPerTrade}%</Badge>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Max Deploy</span>
            <Badge variant="secondary" data-testid="text-summary-deploy">{maxDeploy}%</Badge>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Protections</span>
            <Badge variant={protectionsEnabled ? "default" : "outline"} data-testid="text-summary-prot">
              {protectionsEnabled ? "ON" : "OFF"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StepperNav({
  currentStep,
  onStepClick,
}: {
  currentStep: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="stepper-nav">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <button
            onClick={() => onStepClick(s.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors hover-elevate",
              currentStep === s.id
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground"
            )}
            data-testid={`button-step-${s.id}`}
          >
            <span className={cn(
              "inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-medium",
              currentStep === s.id
                ? "bg-primary-foreground text-primary"
                : currentStep > s.id
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
            )}>
              {currentStep > s.id ? <Check className="h-3 w-3" /> : s.id}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
          {i < STEPS.length - 1 && <div className="w-6 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}

function StepRiskStyle({
  selectedMode,
  riskPerTrade,
  maxDeploy,
  onSelectPreset,
  onRiskPerTradeChange,
  onMaxDeployChange,
}: {
  selectedMode: string;
  riskPerTrade: number;
  maxDeploy: number;
  onSelectPreset: (preset: RiskPreset) => void;
  onRiskPerTradeChange: (v: number) => void;
  onMaxDeployChange: (v: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {RISK_PRESETS.map((preset) => {
          const isActive = selectedMode === preset.key;
          const Icon = MODE_ICONS[preset.key] ?? ShieldCheck;
          return (
            <Card
              key={preset.key}
              className={cn(
                "cursor-pointer transition-colors",
                isActive
                  ? "ring-2 ring-primary"
                  : "hover-elevate"
              )}
              onClick={() => onSelectPreset(preset)}
              data-testid={`card-preset-${preset.key}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    <CardTitle className="text-base">{preset.label}</CardTitle>
                  </div>
                  {preset.recommended && (
                    <Badge variant="secondary" className="text-xs">Recommended</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription className="text-xs">{preset.description}</CardDescription>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Delta</span>
                    <p className="font-medium">{preset.deltaMin} - {preset.deltaMax}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Loss Cutoff</span>
                    <p className="font-medium">{preset.lossCutoffMult}x</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Min Premium</span>
                    <p className="font-medium">{preset.minPremiumPct}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">VIX Pause</span>
                    <p className="font-medium">{preset.vixPause}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fine-tune Risk Parameters</CardTitle>
          <CardDescription className="text-xs">Adjust these values independently of the preset mode</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm">Risk per Trade</Label>
              <span className="text-sm font-medium" data-testid="text-rpt-value">{riskPerTrade}%</span>
            </div>
            <Slider
              value={[riskPerTrade]}
              onValueChange={([v]) => onRiskPerTradeChange(v)}
              min={0.5}
              max={5}
              step={0.25}
              data-testid="slider-rpt"
            />
            <p className="text-xs text-muted-foreground">Percentage of account risked on each trade</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm">Max Capital Deployed</Label>
              <span className="text-sm font-medium" data-testid="text-deploy-value">{maxDeploy}%</span>
            </div>
            <Slider
              value={[maxDeploy]}
              onValueChange={([v]) => onMaxDeployChange(v)}
              min={10}
              max={100}
              step={5}
              data-testid="slider-deploy"
            />
            <p className="text-xs text-muted-foreground">Maximum percentage of buying power that can be deployed at once</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepGuardrails({
  mode,
  preset,
  guardrails,
  onGuardrailsChange,
}: {
  mode: string;
  preset?: RiskPreset;
  guardrails: Record<string, unknown>;
  onGuardrailsChange: (g: Record<string, unknown>) => void;
}) {
  const maxDailyLoss = (guardrails.maxDailyLossPercent as number) ?? 5;
  const maxOpenPositions = (guardrails.maxOpenPositions as number) ?? 10;
  const cooldownMinutes = (guardrails.cooldownMinutes as number) ?? 0;

  function update(key: string, value: unknown) {
    onGuardrailsChange({ ...guardrails, [key]: value });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Guardrails</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Circuit breakers that pause trading when limits are hit. Based on your <span className="capitalize font-medium">{mode}</span> profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Label className="text-sm">Max Daily Loss</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Trading pauses if daily losses exceed this percentage of account value.
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm font-medium" data-testid="text-max-daily-loss">{maxDailyLoss}%</span>
            </div>
            <Slider
              value={[maxDailyLoss]}
              onValueChange={([v]) => update("maxDailyLossPercent", v)}
              min={1}
              max={15}
              step={0.5}
              data-testid="slider-max-daily-loss"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm">Max Open Positions</Label>
              <span className="text-sm font-medium" data-testid="text-max-positions">{maxOpenPositions}</span>
            </div>
            <Slider
              value={[maxOpenPositions]}
              onValueChange={([v]) => update("maxOpenPositions", v)}
              min={1}
              max={30}
              step={1}
              data-testid="slider-max-positions"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm">Cooldown after Loss (minutes)</Label>
              <span className="text-sm font-medium" data-testid="text-cooldown">{cooldownMinutes}m</span>
            </div>
            <Slider
              value={[cooldownMinutes]}
              onValueChange={([v]) => update("cooldownMinutes", v)}
              min={0}
              max={120}
              step={5}
              data-testid="slider-cooldown"
            />
            <p className="text-xs text-muted-foreground">Wait time before new entries after a losing trade (0 = disabled)</p>
          </div>

          {preset && (
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <p className="font-medium">Preset parameters for {preset.label}:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <span>Delta range: {preset.deltaMin} - {preset.deltaMax}</span>
                <span>Loss cutoff: {preset.lossCutoffMult}x</span>
                <span>Min premium: {preset.minPremiumPct}%</span>
                <span>VIX pause: {preset.vixPause}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StepProtections({
  protectionsEnabled,
  onToggle,
  protections,
  onProtectionsChange,
  preset,
}: {
  protectionsEnabled: boolean;
  onToggle: (v: boolean) => void;
  protections: Record<string, unknown>;
  onProtectionsChange: (p: Record<string, unknown>) => void;
  preset?: RiskPreset;
}) {
  const autoStopLoss = (protections.autoStopLoss as boolean) ?? true;
  const trailingStop = (protections.trailingStop as boolean) ?? false;
  const hedgeMode = (protections.hedgeMode as boolean) ?? false;

  function update(key: string, value: unknown) {
    onProtectionsChange({ ...protections, [key]: value });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Protections</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="prot-toggle" className="text-sm">
                {protectionsEnabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id="prot-toggle"
                checked={protectionsEnabled}
                onCheckedChange={onToggle}
                data-testid="switch-protections"
              />
            </div>
          </div>
          <CardDescription className="text-xs">
            Automatic safety mechanisms applied to every trade
          </CardDescription>
        </CardHeader>
        <CardContent className={cn("space-y-4", !protectionsEnabled && "opacity-50 pointer-events-none")}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-sm">Auto Stop-Loss</Label>
              <p className="text-xs text-muted-foreground">
                Automatically place stop-loss orders based on your loss cutoff multiplier
                {preset && ` (${preset.lossCutoffMult}x)`}
              </p>
            </div>
            <Switch
              checked={autoStopLoss}
              onCheckedChange={(v) => update("autoStopLoss", v)}
              data-testid="switch-auto-stop"
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-sm">Trailing Stop</Label>
              <p className="text-xs text-muted-foreground">
                Adjust stop-loss upward as position moves in your favor
              </p>
            </div>
            <Switch
              checked={trailingStop}
              onCheckedChange={(v) => update("trailingStop", v)}
              data-testid="switch-trailing"
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-sm">Hedge Mode</Label>
              <p className="text-xs text-muted-foreground">
                Suggest protective puts when VIX exceeds pause threshold
                {preset && ` (VIX > ${preset.vixPause})`}
              </p>
            </div>
            <Switch
              checked={hedgeMode}
              onCheckedChange={(v) => update("hedgeMode", v)}
              data-testid="switch-hedge"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
