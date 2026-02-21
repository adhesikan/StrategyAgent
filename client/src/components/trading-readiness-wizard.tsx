import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Bell,
  Rocket,
  Bot,
  Check,
  ChevronRight,
  ChevronLeft,
  Wifi,
  AlertTriangle,
  Shield,
  Target,
  TrendingUp,
  BarChart3,
  Zap,
  Eye,
  Sparkles,
  DollarSign,
  Gauge,
  Settings2,
  BadgeCheck,
  Clock,
  Brain,
  LineChart,
} from "lucide-react";
import type { BrokerConnection } from "@shared/schema";

const TRADING_STYLES = [
  {
    id: "DAY",
    label: "Day Trader",
    description: "Fast intraday setups. In and out same day.",
    icon: Zap,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    id: "SWING",
    label: "Swing Trader",
    description: "Multi-day holds. Catch bigger moves.",
    icon: LineChart,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    id: "AUTO",
    label: "Let the System Decide",
    description: "Auto-select the best strategies based on conditions.",
    icon: Brain,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
];

const MARKET_SCOPES = [
  {
    id: "STOCKS",
    label: "Stocks Only",
    description: "Equities across major US exchanges",
    icon: BarChart3,
  },
  {
    id: "OPTIONS",
    label: "Options",
    description: "Options strategies on equity underlyings",
    icon: Target,
    badge: "Coming Soon",
  },
  {
    id: "BOTH",
    label: "Stocks + Options",
    description: "Full coverage across equities and options",
    icon: TrendingUp,
    badge: "Coming Soon",
  },
];

const PERSONA_GOALS = [
  {
    id: "CONSISTENCY",
    label: "Stay Consistent",
    description: "Follow my rules without getting emotional",
    icon: Shield,
  },
  {
    id: "SAVE_TIME",
    label: "Save Time",
    description: "Let the system work while I do other things",
    icon: Clock,
  },
  {
    id: "OPPORTUNITIES",
    label: "Never Miss a Setup",
    description: "Scan more tickers than I ever could manually",
    icon: Eye,
  },
  {
    id: "REDUCE_EMOTION",
    label: "Remove Emotion",
    description: "Take the human error out of my execution",
    icon: Brain,
  },
];

const RISK_LEVELS = [
  {
    id: "CONSERVATIVE",
    label: "Conservative",
    description: "Smaller positions, fewer trades, higher bar",
    icon: Shield,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    details: "$250/trade max, 1 trade/day",
  },
  {
    id: "BALANCED",
    label: "Balanced",
    description: "Moderate risk with steady opportunity flow",
    icon: Gauge,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    details: "$500/trade max, 2 trades/day",
  },
  {
    id: "AGGRESSIVE",
    label: "Aggressive",
    description: "Larger size, more signals, faster pace",
    icon: Zap,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    details: "$1,000/trade max, 5 trades/day",
  },
];

const AUTOMATION_MODES = [
  {
    id: "ALERTS_ONLY",
    label: "Alerts Only",
    description: "Get notified when setups appear. You decide what to do.",
    icon: Bell,
    iconColor: "text-blue-500",
    iconBg: "bg-blue-500/10",
    badge: "Default",
  },
  {
    id: "ASSISTED",
    label: "Assisted",
    description: "Orders are pre-filled and ready. You approve each one.",
    icon: Rocket,
    iconColor: "text-green-500",
    iconBg: "bg-green-500/10",
    badge: "Recommended",
    badgeVariant: "outline" as const,
  },
  {
    id: "AUTO",
    label: "Autopilot",
    description: "Trades execute automatically within your limits.",
    icon: Bot,
    iconColor: "text-orange-500",
    iconBg: "bg-orange-500/10",
    requiresDisclaimer: true,
  },
];

interface PersonaPreview {
  personaLabel: string;
  strategyBundleId: string;
  riskPerTradeUsd: number;
  maxTradesPerDay: number;
  minConfidenceThreshold: number;
  strategies: string[];
  tip: string;
}

interface TradingReadinessWizardProps {
  open: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function TradingReadinessWizard({ open, onComplete, onClose }: TradingReadinessWizardProps) {
  const [step, setStep] = useState(1);
  const { toast } = useToast();

  const [tradingStyle, setTradingStyle] = useState("AUTO");
  const [marketScope, setMarketScope] = useState("STOCKS");
  const [personaGoal, setPersonaGoal] = useState("");
  const [personaRisk, setPersonaRisk] = useState("");
  const [automationMode, setAutomationMode] = useState("ALERTS_ONLY");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  const [riskPerTradeUsd, setRiskPerTradeUsd] = useState<number | null>(null);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState<number | null>(null);
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState<number | null>(null);

  const [personaPreview, setPersonaPreview] = useState<PersonaPreview | null>(null);

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/system-profile/preview", {
        tradingStyle,
        marketScope,
        personaGoal,
        personaRisk,
      });
      return res.json();
    },
    onSuccess: (data: PersonaPreview) => {
      setPersonaPreview(data);
      if (riskPerTradeUsd === null) setRiskPerTradeUsd(data.riskPerTradeUsd);
      if (maxTradesPerDay === null) setMaxTradesPerDay(data.maxTradesPerDay);
      if (minConfidenceThreshold === null) setMinConfidenceThreshold(data.minConfidenceThreshold);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (automationMode === "AUTO" && disclaimerAccepted) {
        await apiRequest("POST", "/api/disclaimer/accept", {
          acceptanceType: "WIZARD_AUTOPILOT_ENABLE",
          metadata: { automationMode, tradingStyle, personaRisk },
        });
      }

      const res = await apiRequest("POST", "/api/system-profile/apply", {
        tradingStyle,
        marketScope,
        personaGoal,
        personaRisk,
        riskPerTradeUsd: riskPerTradeUsd ?? personaPreview?.riskPerTradeUsd ?? 500,
        maxTradesPerDay: maxTradesPerDay ?? personaPreview?.maxTradesPerDay ?? 2,
        minConfidenceThreshold: minConfidenceThreshold ?? personaPreview?.minConfidenceThreshold ?? 90,
        automationEnabled: automationMode === "AUTO",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-state"] });
      toast({ title: "Trading System Active", description: "Your personalized system is ready to go." });
      onComplete();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  const totalSteps = 7;
  const progress = (step / totalSteps) * 100;

  const canProceed = () => {
    switch (step) {
      case 1: return true;
      case 2: return !!tradingStyle;
      case 3: return !!personaGoal;
      case 4: return !!personaRisk;
      case 5: return !!personaPreview;
      case 6: return !!automationMode && (automationMode !== "AUTO" || disclaimerAccepted);
      case 7: return true;
      default: return true;
    }
  };

  const handleNext = () => {
    if (step === 4) {
      previewMutation.mutate(undefined, {
        onSuccess: () => setStep(5),
      });
      return;
    }
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      applyMutation.mutate();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  useEffect(() => {
    if (step === 5 && !personaPreview && !previewMutation.isPending && !previewMutation.isError) {
      previewMutation.mutate();
    }
  }, [step]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Trading System Setup
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Set up your personalized trading system in a few quick steps"
              : `Step ${step} of ${totalSteps}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Progress value={progress} className="h-2" data-testid="progress-wizard" />

          {step === 1 && (
            <div className="space-y-5" data-testid="step-welcome">
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Welcome to VCP Trader</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Answer a few questions about your trading style and we'll configure everything
                  automatically. You can always adjust settings later.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Target className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-xs font-medium">Strategy Matching</div>
                  <div className="text-[10px] text-muted-foreground">Auto-configured for you</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Shield className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-xs font-medium">Risk Controls</div>
                  <div className="text-[10px] text-muted-foreground">Built-in safety limits</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Zap className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-xs font-medium">Ready in Minutes</div>
                  <div className="text-[10px] text-muted-foreground">Start scanning immediately</div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4" data-testid="step-trading-style">
              <div>
                <h3 className="text-lg font-semibold mb-1">How Do You Trade?</h3>
                <p className="text-sm text-muted-foreground">
                  This determines which strategies and timeframes we prioritize.
                </p>
              </div>

              <div className="space-y-3">
                {TRADING_STYLES.map((style) => {
                  const Icon = style.icon;
                  return (
                    <Card
                      key={style.id}
                      className={cn(
                        "cursor-pointer transition-all",
                        tradingStyle === style.id
                          ? "border-primary ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/30"
                      )}
                      onClick={() => setTradingStyle(style.id)}
                      data-testid={`card-style-${style.id}`}
                    >
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", style.bgColor)}>
                            <Icon className={cn("h-5 w-5", style.color)} />
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-base">{style.label}</CardTitle>
                            <CardDescription className="text-xs">{style.description}</CardDescription>
                          </div>
                          {tradingStyle === style.id && (
                            <BadgeCheck className="h-5 w-5 text-primary" />
                          )}
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4" data-testid="step-persona-goal">
              <div>
                <h3 className="text-lg font-semibold mb-1">What's Your Main Goal?</h3>
                <p className="text-sm text-muted-foreground">
                  This helps us tailor the experience and default settings.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {PERSONA_GOALS.map((goal) => {
                  const Icon = goal.icon;
                  return (
                    <Card
                      key={goal.id}
                      className={cn(
                        "cursor-pointer transition-all",
                        personaGoal === goal.id
                          ? "border-primary ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/30"
                      )}
                      onClick={() => setPersonaGoal(goal.id)}
                      data-testid={`card-goal-${goal.id}`}
                    >
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-start gap-2">
                          <Icon className="h-5 w-5 text-primary mt-0.5" />
                          <div>
                            <CardTitle className="text-sm">{goal.label}</CardTitle>
                            <CardDescription className="text-xs">{goal.description}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4" data-testid="step-risk-level">
              <div>
                <h3 className="text-lg font-semibold mb-1">Risk Tolerance</h3>
                <p className="text-sm text-muted-foreground">
                  How much risk are you comfortable with per trade?
                </p>
              </div>

              <div className="space-y-3">
                {RISK_LEVELS.map((risk) => {
                  const Icon = risk.icon;
                  return (
                    <Card
                      key={risk.id}
                      className={cn(
                        "cursor-pointer transition-all",
                        personaRisk === risk.id
                          ? "border-primary ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/30"
                      )}
                      onClick={() => {
                        setPersonaRisk(risk.id);
                        setRiskPerTradeUsd(null);
                        setMaxTradesPerDay(null);
                        setMinConfidenceThreshold(null);
                        setPersonaPreview(null);
                      }}
                      data-testid={`card-risk-${risk.id}`}
                    >
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", risk.bgColor)}>
                            <Icon className={cn("h-5 w-5", risk.color)} />
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-base">{risk.label}</CardTitle>
                            <CardDescription className="text-xs">{risk.description}</CardDescription>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-muted-foreground">{risk.details}</div>
                            {personaRisk === risk.id && (
                              <BadgeCheck className="h-5 w-5 text-primary ml-auto mt-1" />
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4" data-testid="step-persona-preview">
              <div>
                <h3 className="text-lg font-semibold mb-1">Your Trading Profile</h3>
                <p className="text-sm text-muted-foreground">
                  Based on your answers, here's your personalized configuration.
                </p>
              </div>

              {previewMutation.isPending ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Computing your profile...
                </div>
              ) : personaPreview ? (
                <div className="space-y-4">
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/20">
                          <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base" data-testid="text-persona-label">
                            {personaPreview.personaLabel}
                          </CardTitle>
                          <CardDescription className="text-xs">Your trader persona</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">Strategies</div>
                      <div className="flex flex-wrap gap-1">
                        {personaPreview.strategies.map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">Risk per Trade</div>
                      <div className="text-lg font-semibold" data-testid="text-risk-default">
                        ${personaPreview.riskPerTradeUsd}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">Trades per Day</div>
                      <div className="text-lg font-semibold" data-testid="text-trades-default">
                        {personaPreview.maxTradesPerDay}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">Min. Confidence</div>
                      <div className="text-lg font-semibold" data-testid="text-confidence-default">
                        {personaPreview.minConfidenceThreshold}%
                      </div>
                    </div>
                  </div>

                  <Card className="bg-muted/50">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-muted-foreground" data-testid="text-persona-tip">
                          {personaPreview.tip}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4" data-testid="step-automation-mode">
              <div>
                <h3 className="text-lg font-semibold mb-1">Automation Level</h3>
                <p className="text-sm text-muted-foreground">
                  How much control do you want the system to have?
                </p>
              </div>

              <div className="space-y-3">
                {AUTOMATION_MODES.map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <Card
                      key={mode.id}
                      className={cn(
                        "cursor-pointer transition-all",
                        automationMode === mode.id
                          ? "border-primary ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/30"
                      )}
                      onClick={() => {
                        setAutomationMode(mode.id);
                        if (mode.id !== "AUTO") setDisclaimerAccepted(false);
                      }}
                      data-testid={`card-automation-${mode.id}`}
                    >
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", mode.iconBg)}>
                            <Icon className={cn("h-5 w-5", mode.iconColor)} />
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-base">{mode.label}</CardTitle>
                            <CardDescription className="text-xs">{mode.description}</CardDescription>
                          </div>
                          {mode.badge && (
                            <Badge variant={mode.badgeVariant || "secondary"} className="text-[10px]">
                              {mode.badge}
                            </Badge>
                          )}
                          {automationMode === mode.id && (
                            <BadgeCheck className="h-5 w-5 text-primary" />
                          )}
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>

              {automationMode === "AUTO" && (
                <Card className="border-orange-500/30 bg-orange-500/5">
                  <CardContent className="py-3 px-4">
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p className="font-medium text-orange-700 dark:text-orange-400">Important Acknowledgment</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            <li>VCP Trader automates order placement based on your rules.</li>
                            <li>It does not provide investment advice or guarantee outcomes.</li>
                            <li>You are solely responsible for all trades, settings, and risk.</li>
                            <li>Trading involves risk, including loss of principal.</li>
                          </ul>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-orange-500/20">
                        <Checkbox
                          id="disclaimer-check"
                          checked={disclaimerAccepted}
                          onCheckedChange={(checked) => setDisclaimerAccepted(checked === true)}
                          data-testid="checkbox-disclaimer"
                        />
                        <Label htmlFor="disclaimer-check" className="text-xs cursor-pointer">
                          I understand and accept these terms
                        </Label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4" data-testid="step-review">
              <div>
                <h3 className="text-lg font-semibold mb-1">Review & Activate</h3>
                <p className="text-sm text-muted-foreground">
                  Here's a summary of your trading system configuration.
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-1">Persona</div>
                    <div className="text-sm font-medium" data-testid="review-persona">
                      {personaPreview?.personaLabel || "Custom"}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-1">Trading Style</div>
                    <div className="text-sm font-medium" data-testid="review-style">
                      {TRADING_STYLES.find((s) => s.id === tradingStyle)?.label || tradingStyle}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-1">Automation</div>
                    <div className="text-sm font-medium" data-testid="review-automation">
                      {AUTOMATION_MODES.find((m) => m.id === automationMode)?.label || automationMode}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-1">Risk Level</div>
                    <div className="text-sm font-medium" data-testid="review-risk">
                      {RISK_LEVELS.find((r) => r.id === personaRisk)?.label || personaRisk}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border text-center">
                    <DollarSign className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-xs text-muted-foreground">Risk/Trade</div>
                    <div className="text-sm font-semibold" data-testid="review-risk-amount">
                      ${riskPerTradeUsd ?? personaPreview?.riskPerTradeUsd ?? 500}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-xs text-muted-foreground">Trades/Day</div>
                    <div className="text-sm font-semibold" data-testid="review-trades">
                      {maxTradesPerDay ?? personaPreview?.maxTradesPerDay ?? 2}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border text-center">
                    <Gauge className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-xs text-muted-foreground">Min Confidence</div>
                    <div className="text-sm font-semibold" data-testid="review-confidence">
                      {minConfidenceThreshold ?? personaPreview?.minConfidenceThreshold ?? 90}%
                    </div>
                  </div>
                </div>

                {personaPreview && (
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-2">Active Strategies</div>
                    <div className="flex flex-wrap gap-1">
                      {personaPreview.strategies.map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {brokerStatus?.isConnected ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-green-700 dark:text-green-400">
                      Broker connected ({brokerStatus.provider})
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                    <Wifi className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      No broker connected — you can connect one later from Settings.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={step === 1}
              data-testid="button-wizard-back"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>

            <Button
              onClick={handleNext}
              disabled={!canProceed() || applyMutation.isPending || (step === 4 && previewMutation.isPending)}
              data-testid="button-wizard-next"
            >
              {applyMutation.isPending ? (
                "Activating..."
              ) : step === 4 && previewMutation.isPending ? (
                "Computing..."
              ) : step === totalSteps ? (
                <>
                  Activate System
                  <Check className="h-4 w-4 ml-1" />
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
