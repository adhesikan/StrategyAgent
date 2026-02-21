import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  BarChart3,
  ScanLine,
  Activity,
  Bell,
  Handshake,
  Bot,
  Wifi,
  Shield,
  Rocket,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  DollarSign,
  Hash,
  Percent,
} from "lucide-react";

interface SavedSettings {
  traderType?: string;
  automationMode?: string;
  safetyLimits?: {
    maxTradesPerDay?: number;
    maxPositions?: number;
    riskPerTradeUsd?: number;
    maxDailyLossUsd?: number;
  };
  positionSizingMethod?: string;
  positionSizingValue?: number;
}

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  onClose: () => void;
  isEditing?: boolean;
  savedSettings?: SavedSettings;
}

const TRADER_TYPES = [
  {
    id: "day",
    label: "Day Trader",
    description: "Fast-paced intraday trades with quick entries and exits",
    icon: TrendingUp,
  },
  {
    id: "swing",
    label: "Swing Trader",
    description: "Multi-day positions capturing intermediate price moves",
    icon: BarChart3,
  },
  {
    id: "options",
    label: "Options Trader",
    description: "Strategy-driven options plays with defined risk",
    icon: ScanLine,
  },
  {
    id: "futures",
    label: "Futures Trader",
    description: "Leverage-based futures contracts across markets",
    icon: Activity,
  },
];

const AUTOMATION_MODES = [
  {
    id: "ALERTS",
    label: "Alerts Only",
    description: "Receive notifications when opportunities match your criteria. You review and act manually.",
    icon: Bell,
    recommended: true,
  },
  {
    id: "ASSISTED",
    label: "Assisted",
    description: "Opportunities are prepared with pre-filled order details. Review and approve each trade.",
    icon: Handshake,
  },
  {
    id: "AUTONOMOUS",
    label: "Autonomous",
    description: "User-configured automation executes trades within your defined limits and rules.",
    icon: Bot,
  },
];

const RISK_PRESETS = [
  {
    id: "conservative",
    label: "Conservative",
    limits: { maxTradesPerDay: 1, maxPositions: 2, riskPerTradeUsd: 250, maxDailyLossUsd: 500 },
  },
  {
    id: "balanced",
    label: "Balanced",
    limits: { maxTradesPerDay: 2, maxPositions: 3, riskPerTradeUsd: 500, maxDailyLossUsd: 1000 },
  },
  {
    id: "aggressive",
    label: "Aggressive",
    limits: { maxTradesPerDay: 5, maxPositions: 5, riskPerTradeUsd: 1000, maxDailyLossUsd: 2500 },
  },
];

const POSITION_SIZING_METHODS = [
  {
    id: "fixed_dollar",
    label: "Fixed Dollar Amount",
    description: "Trade a specific dollar amount per position (e.g. $1,000)",
    icon: DollarSign,
    placeholder: "1000",
    suffix: "USD per trade",
    recommended: true,
  },
  {
    id: "fixed_shares",
    label: "Fixed Number of Shares",
    description: "Trade a set number of shares or contracts each time",
    icon: Hash,
    placeholder: "100",
    suffix: "shares per trade",
  },
  {
    id: "percent_account",
    label: "Percentage of Account",
    description: "Allocate a percentage of your account balance per trade",
    icon: Percent,
    placeholder: "5",
    suffix: "% of account",
  },
];

const TOTAL_STEPS = 6;

function matchRiskPreset(limits?: SavedSettings["safetyLimits"]): string {
  if (!limits) return "balanced";
  for (const preset of RISK_PRESETS) {
    if (
      preset.limits.maxTradesPerDay === limits.maxTradesPerDay &&
      preset.limits.maxPositions === limits.maxPositions &&
      preset.limits.riskPerTradeUsd === limits.riskPerTradeUsd &&
      preset.limits.maxDailyLossUsd === limits.maxDailyLossUsd
    ) {
      return preset.id;
    }
  }
  return "balanced";
}

export function OnboardingWizard({ open, onComplete, onClose, isEditing, savedSettings }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [traderType, setTraderType] = useState("swing");
  const [automationMode, setAutomationMode] = useState("ALERTS");
  const [riskPreset, setRiskPreset] = useState("balanced");
  const [sizingMethod, setSizingMethod] = useState("fixed_dollar");
  const [sizingValue, setSizingValue] = useState("1000");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { isConnected, providerName } = useBrokerStatus();

  useEffect(() => {
    if (open && isEditing && savedSettings) {
      setTraderType(savedSettings.traderType || "swing");
      setAutomationMode(savedSettings.automationMode || "ALERTS");
      setRiskPreset(matchRiskPreset(savedSettings.safetyLimits));
      setSizingMethod(savedSettings.positionSizingMethod || "fixed_dollar");
      setSizingValue(String(savedSettings.positionSizingValue ?? 1000));
    }
    if (!open) {
      setStep(0);
      setTraderType("swing");
      setAutomationMode("ALERTS");
      setRiskPreset("balanced");
      setSizingMethod("fixed_dollar");
      setSizingValue("1000");
    }
  }, [open, isEditing, savedSettings]);

  const selectedLimits = RISK_PRESETS.find(p => p.id === riskPreset)?.limits ?? RISK_PRESETS[1].limits;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/user/settings", {
        traderType,
        automationMode,
        safetyLimits: selectedLimits,
        positionSizingMethod: sizingMethod,
        positionSizingValue: parseInt(sizingValue, 10) || 1000,
        setupCompleted: true,
        onboardingStep: TOTAL_STEPS - 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Setup Complete", description: "Your preferences have been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings. Please try again.", variant: "destructive" });
    },
  });

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const handleNext = () => {
    if (step < TOTAL_STEPS - 2) {
      setStep(step + 1);
    } else if (step === TOTAL_STEPS - 2) {
      saveMutation.mutate(undefined, {
        onSuccess: () => setStep(TOTAL_STEPS - 1),
      });
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = () => {
    onComplete();
    if (!isEditing) {
      navigate("/discover");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-onboarding-wizard">
        <DialogHeader>
          <DialogTitle data-testid="text-wizard-title">
            {step === TOTAL_STEPS - 1
              ? (isEditing ? "Configuration Updated" : "You're All Set")
              : (isEditing ? "Edit Configuration" : "Welcome to VCP Trader")}
          </DialogTitle>
          <DialogDescription data-testid="text-wizard-description">
            {step === TOTAL_STEPS - 1
              ? (isEditing ? "Your updated preferences have been saved." : "Your workspace is configured and ready to go.")
              : `Step ${step + 1} of ${TOTAL_STEPS - 1} — ${isEditing ? "Update your preferences" : "Let's personalize your experience"}`}
          </DialogDescription>
        </DialogHeader>

        <Progress value={progress} className="h-1.5" data-testid="progress-onboarding" />

        <div className="py-2">
          {step === 0 && (
            <div className="space-y-3" data-testid="step-trader-type">
              <p className="text-sm font-medium">Choose your trading style</p>
              <div className="grid grid-cols-2 gap-3">
                {TRADER_TYPES.map(({ id, label, description, icon: Icon }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      traderType === id
                        ? "border-primary bg-primary/5"
                        : "border-border hover-elevate"
                    )}
                    onClick={() => setTraderType(id)}
                    data-testid={`card-trader-${id}`}
                  >
                    <CardHeader className="p-3 pb-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <CardTitle className="text-sm">{label}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <CardDescription className="text-xs">{description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3" data-testid="step-automation-mode">
              <p className="text-sm font-medium">How should the platform act on opportunities?</p>
              <div className="space-y-2">
                {AUTOMATION_MODES.map(({ id, label, description, icon: Icon, recommended }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      automationMode === id
                        ? "border-primary bg-primary/5"
                        : "border-border hover-elevate"
                    )}
                    onClick={() => setAutomationMode(id)}
                    data-testid={`card-mode-${id.toLowerCase()}`}
                  >
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                        automationMode === id ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{label}</span>
                          {recommended && (
                            <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                              Recommended
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      {automationMode === id && (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3" data-testid="step-market-data">
              <p className="text-sm font-medium">Connect your market data source</p>
              {isConnected ? (
                <Card className="border-green-500/50 bg-green-500/5">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        {providerName || "Broker"} Connected
                      </p>
                      <p className="text-xs text-muted-foreground">Live market data is active</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 no-default-hover-elevate no-default-active-elevate">
                      Active
                    </Badge>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <Card className="border-border">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Wifi className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">Connect Brokerage</p>
                        <p className="text-xs text-muted-foreground">Get live market data and enable execution</p>
                      </div>
                      <Button variant="outline" size="sm" asChild data-testid="button-connect-brokerage">
                        <a href="/settings">Connect</a>
                      </Button>
                    </CardContent>
                  </Card>
                  <Card className="border-border hover-elevate cursor-pointer" data-testid="card-demo-data">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">Use Demo Data</p>
                        <p className="text-xs text-muted-foreground">Explore with simulated market data</p>
                      </div>
                      <Check className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                {isConnected
                  ? "You can manage your broker connection in Settings."
                  : "You can connect a broker later from Settings."}
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="step-risk-preset">
              <p className="text-sm font-medium">Choose your risk profile</p>
              <div className="space-y-2">
                {RISK_PRESETS.map(({ id, label, limits }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      riskPreset === id
                        ? "border-primary bg-primary/5"
                        : "border-border hover-elevate"
                    )}
                    onClick={() => setRiskPreset(id)}
                    data-testid={`card-risk-${id}`}
                  >
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                        riskPreset === id ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Shield className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{label}</span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                          <span className="text-xs text-muted-foreground">{limits.maxTradesPerDay} trades/day</span>
                          <span className="text-xs text-muted-foreground">{limits.maxPositions} positions</span>
                          <span className="text-xs text-muted-foreground">${limits.riskPerTradeUsd} risk/trade</span>
                          <span className="text-xs text-muted-foreground">${limits.maxDailyLossUsd} max loss/day</span>
                        </div>
                      </div>
                      {riskPreset === id && (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3" data-testid="step-position-sizing">
              <p className="text-sm font-medium">How do you want to size your trades?</p>
              <div className="space-y-2">
                {POSITION_SIZING_METHODS.map(({ id, label, description, icon: Icon, recommended }) => (
                  <Card
                    key={id}
                    className={cn(
                      "cursor-pointer",
                      sizingMethod === id
                        ? "border-primary bg-primary/5"
                        : "border-border hover-elevate"
                    )}
                    onClick={() => setSizingMethod(id)}
                    data-testid={`card-sizing-${id}`}
                  >
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                        sizingMethod === id ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{label}</span>
                          {recommended && (
                            <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                              Default
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      {sizingMethod === id && (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="pt-2 space-y-2">
                <Label htmlFor="sizing-value" className="text-sm font-medium">
                  Default {POSITION_SIZING_METHODS.find(m => m.id === sizingMethod)?.suffix || "value"}
                </Label>
                <div className="flex items-center gap-2">
                  {sizingMethod === "fixed_dollar" && (
                    <span className="text-sm text-muted-foreground">$</span>
                  )}
                  <Input
                    id="sizing-value"
                    type="number"
                    min="1"
                    value={sizingValue}
                    onChange={(e) => setSizingValue(e.target.value)}
                    placeholder={POSITION_SIZING_METHODS.find(m => m.id === sizingMethod)?.placeholder}
                    className="max-w-[200px]"
                    data-testid="input-sizing-value"
                  />
                  {sizingMethod === "percent_account" && (
                    <span className="text-sm text-muted-foreground">%</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  You can adjust this anytime from Settings.
                </p>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col items-center text-center py-6 space-y-4" data-testid="step-complete">
              <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <Rocket className="h-7 w-7 text-green-500" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{isEditing ? "Configuration Updated" : "Setup Complete"}</h3>
                <p className="text-sm text-muted-foreground">
                  {isEditing
                    ? "Your preferences have been updated. Changes take effect immediately."
                    : "Your workspace is personalized and ready. Start exploring opportunities now."}
                </p>
              </div>
              <Button onClick={handleFinish} className="gap-2" data-testid="button-start-exploring">
                <Rocket className="h-4 w-4" />
                {isEditing ? "Done" : "Start Exploring"}
              </Button>
            </div>
          )}
        </div>

        {step < TOTAL_STEPS - 1 && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            {step > 0 ? (
              <Button variant="ghost" onClick={handleBack} data-testid="button-back">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            ) : (
              <div />
            )}
            <Button
              onClick={handleNext}
              disabled={saveMutation.isPending}
              data-testid={step === TOTAL_STEPS - 2 ? "button-complete-setup" : "button-next"}
            >
              {step === TOTAL_STEPS - 2 ? (
                saveMutation.isPending ? "Saving..." : (isEditing ? "Save Changes" : "Complete Setup")
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
