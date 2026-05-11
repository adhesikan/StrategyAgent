import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  Layers,
  Repeat,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Award,
  ShieldCheck,
  Zap,
  Activity,
  DollarSign,
  Target,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import {
  track,
  saveMarketingOnboarding,
  type MarketingOnboardingPrefs,
} from "@/lib/analytics";

interface MarketingOnboardingWizardProps {
  open: boolean;
  onClose: () => void;
}

const TRADES_OPTIONS = [
  { id: "stocks", label: "Stocks", icon: TrendingUp, description: "Shares only" },
  { id: "options", label: "Options", icon: Layers, description: "Calls, puts, spreads" },
  { id: "both", label: "Both", icon: Repeat, description: "Stocks and options" },
] as const;

const STYLE_OPTIONS = [
  { id: "options_income", label: "Options Income", description: "Premium-selling and defined-risk plays" },
  { id: "swing", label: "Swing Trading", description: "Multi-day moves with structured setups" },
  { id: "momentum", label: "Momentum", description: "Riding strong trends and breakouts" },
  { id: "day", label: "Day Trading", description: "Intraday entries and exits" },
] as const;

const RISK_OPTIONS = [
  { id: "conservative", label: "Conservative", description: "Smaller positions, A+ setups only" },
  { id: "moderate", label: "Moderate", description: "Balanced quality bar and position size" },
  { id: "aggressive", label: "Aggressive", description: "More opportunities, higher variance" },
] as const;

const INSTRUMENT_OPTIONS = [
  { id: "shares", label: "Shares", icon: TrendingUp },
  { id: "long_options", label: "Long Calls / Puts", icon: Zap },
  { id: "debit_spreads", label: "Debit Spreads", icon: Layers },
  { id: "covered_calls", label: "Covered Calls", icon: ShieldCheck },
  { id: "csp", label: "Cash-Secured Puts", icon: DollarSign },
] as const;

const TOTAL_STEPS = 5;

export function MarketingOnboardingWizard({ open, onClose }: MarketingOnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [trades, setTrades] = useState<MarketingOnboardingPrefs["trades"]>("both");
  const [style, setStyle] = useState<MarketingOnboardingPrefs["style"]>("swing");
  const [risk, setRisk] = useState<MarketingOnboardingPrefs["riskComfort"]>("moderate");
  const [instruments, setInstruments] = useState<string[]>(["shares", "debit_spreads"]);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!open) {
      setStep(0);
      setTrades("both");
      setStyle("swing");
      setRisk("moderate");
      setInstruments(["shares", "debit_spreads"]);
    }
  }, [open]);

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const toggleInstrument = (id: string) => {
    setInstruments((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = () => {
    const prefs: MarketingOnboardingPrefs = {
      trades,
      style,
      riskComfort: risk,
      instruments,
      completedAt: new Date().toISOString(),
    };
    saveMarketingOnboarding(prefs);
    track("onboarding_completed", { ...prefs });
    onClose();
    // Route to signup; the post-signup wizard (in App.tsx) will pick up
    // saved prefs from sessionStorage in a future enhancement.
    navigate("/auth?intent=trial");
  };

  const canAdvance =
    (step === 0 && !!trades) ||
    (step === 1 && !!style) ||
    (step === 2 && !!risk) ||
    (step === 3 && instruments.length > 0) ||
    step === 4;

  // Build a tiny preview setup based on the choices for step 5
  const previewSymbol = "AMD";
  const previewVehicle =
    trades === "stocks"
      ? "Long shares"
      : instruments.includes("debit_spreads")
        ? "Bull Call Spread"
        : instruments.includes("long_options")
          ? "Long Call"
          : "Long shares";
  const previewGrade = risk === "aggressive" ? "B" : risk === "conservative" ? "A+" : "A";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-marketing-onboarding">
        <DialogHeader>
          <DialogTitle data-testid="text-mw-title">
            {step === TOTAL_STEPS - 1 ? "Your first AI setup" : "Personalize your trial"}
          </DialogTitle>
          <DialogDescription data-testid="text-mw-description">
            {step === TOTAL_STEPS - 1
              ? `Step ${TOTAL_STEPS} of ${TOTAL_STEPS} — here's an example of what Strategy Agent will build for you.`
              : `Step ${step + 1} of ${TOTAL_STEPS} — takes under 60 seconds.`}
          </DialogDescription>
        </DialogHeader>

        <Progress value={progress} className="h-1.5" data-testid="progress-mw" />

        <div className="py-2">
          {step === 0 && (
            <div className="space-y-3" data-testid="step-trades">
              <p className="text-sm font-medium">What do you trade?</p>
              <div className="grid grid-cols-3 gap-2">
                {TRADES_OPTIONS.map(({ id, label, icon: Icon, description }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer text-center",
                      trades === id ? "border-primary bg-primary/5" : "border-border hover-elevate"
                    )}
                    onClick={() => setTrades(id)}
                    data-testid={`card-trades-${id}`}
                  >
                    <CardContent className="p-3 flex flex-col items-center gap-1.5">
                      <Icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[11px] text-muted-foreground">{description}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3" data-testid="step-style">
              <p className="text-sm font-medium">What's your trading style?</p>
              <div className="grid grid-cols-1 gap-2">
                {STYLE_OPTIONS.map(({ id, label, description }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      style === id ? "border-primary bg-primary/5" : "border-border hover-elevate"
                    )}
                    onClick={() => setStyle(id)}
                    data-testid={`card-style-${id}`}
                  >
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                      {style === id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3" data-testid="step-risk">
              <p className="text-sm font-medium">What's your risk comfort?</p>
              <div className="grid grid-cols-1 gap-2">
                {RISK_OPTIONS.map(({ id, label, description }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      risk === id ? "border-primary bg-primary/5" : "border-border hover-elevate"
                    )}
                    onClick={() => setRisk(id)}
                    data-testid={`card-risk-${id}`}
                  >
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                      {risk === id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="step-instruments">
              <p className="text-sm font-medium">Which instruments are allowed?</p>
              <p className="text-xs text-muted-foreground">Pick any combination — you can change this later in Settings.</p>
              <div className="grid grid-cols-1 gap-2">
                {INSTRUMENT_OPTIONS.map(({ id, label, icon: Icon }) => {
                  const selected = instruments.includes(id);
                  return (
                    <Card
                      key={id}
                      className={cn(
                        "cursor-pointer",
                        selected ? "border-primary bg-primary/5" : "border-border hover-elevate"
                      )}
                      onClick={() => toggleInstrument(id)}
                      data-testid={`card-instrument-${id}`}
                    >
                      <CardContent className="p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="text-sm font-medium">{label}</span>
                        </div>
                        {selected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3" data-testid="step-preview">
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="bg-background">
                      <Sparkles className="h-3 w-3 mr-1" />
                      Sample setup
                    </Badge>
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                      <Award className="h-3 w-3" />
                      Grade {previewGrade}
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{previewSymbol} · Bullish Pullback</p>
                    <p className="text-xs text-muted-foreground">Recommended: {previewVehicle}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md bg-background border p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
                      <p className="font-semibold">$152.40</p>
                    </div>
                    <div className="rounded-md bg-background border p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Stop</p>
                      <p className="font-semibold">$149.80</p>
                    </div>
                    <div className="rounded-md bg-background border p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Target</p>
                      <p className="font-semibold">$158.10</p>
                    </div>
                  </div>
                  {previewVehicle !== "Long shares" && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-background border p-2">
                        <p className="text-[10px] text-muted-foreground uppercase">Max Loss</p>
                        <p className="font-semibold">$185</p>
                      </div>
                      <div className="rounded-md bg-background border p-2">
                        <p className="text-[10px] text-muted-foreground uppercase">Max Profit</p>
                        <p className="font-semibold">$315</p>
                      </div>
                      <div className="rounded-md bg-background border p-2">
                        <p className="text-[10px] text-muted-foreground uppercase">Breakeven</p>
                        <p className="font-semibold">$153.85</p>
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground border-t pt-2 flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    Software-generated, not investment advice.
                  </div>
                </CardContent>
              </Card>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Target className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                <span>
                  Create your account to unlock live setups, probability grades, and InstaTrade™ execution.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={step === 0}
            data-testid="button-mw-back"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          {step < TOTAL_STEPS - 1 ? (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={!canAdvance}
              data-testid="button-mw-next"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleFinish} data-testid="button-mw-finish">
              Start 14-Day Trial
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
