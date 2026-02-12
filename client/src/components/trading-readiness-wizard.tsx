import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
  TrendingUp
} from "lucide-react";
import type { UserSettings, BrokerConnection } from "@shared/schema";

const STRATEGIES = [
  { id: "VCP", name: "VCP (Volatility Contraction)", category: "Swing" },
  { id: "VCP_MULTIDAY", name: "VCP Multi-Day", category: "Swing" },
  { id: "CLASSIC_PULLBACK", name: "Classic Pullback", category: "Swing" },
  { id: "ORB5", name: "Opening Range Breakout (5m)", category: "Intraday" },
  { id: "ORB15", name: "Opening Range Breakout (15m)", category: "Intraday" },
  { id: "GAP_AND_GO", name: "Gap and Go", category: "Intraday" },
  { id: "HIGH_RVOL", name: "High Relative Volume", category: "Intraday" },
  { id: "VWAP_RECLAIM", name: "VWAP Reclaim", category: "Intraday" },
];

const CONFIDENCE_PRESETS = [
  { id: "conservative", label: "Conservative", value: 85, description: "Higher confidence, fewer signals" },
  { id: "balanced", label: "Balanced", value: 75, description: "Balanced approach" },
  { id: "aggressive", label: "Aggressive", value: 65, description: "More signals, lower threshold" },
];

const SAFETY_PRESETS = [
  { 
    id: "conservative", 
    label: "Conservative", 
    limits: { maxTradesPerDay: 1, maxPositions: 2, riskPerTradeUsd: 250, maxDailyLossUsd: 500 }
  },
  { 
    id: "balanced", 
    label: "Balanced", 
    limits: { maxTradesPerDay: 2, maxPositions: 3, riskPerTradeUsd: 500, maxDailyLossUsd: 1000 }
  },
  { 
    id: "aggressive", 
    label: "Aggressive", 
    limits: { maxTradesPerDay: 5, maxPositions: 5, riskPerTradeUsd: 1000, maxDailyLossUsd: 2500 }
  },
];

interface WizardData {
  preferredStrategies: string[];
  scanUniverse: string;
  scanTimeframe: string;
  scanConfidenceMin: number;
  actionMode: "ALERTS_ONLY" | "ASSISTED" | "AUTO";
  safetyLimits: {
    maxTradesPerDay: number;
    maxPositions: number;
    riskPerTradeUsd: number;
    maxDailyLossUsd: number;
  };
}

interface TradingReadinessWizardProps {
  open: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function TradingReadinessWizard({ open, onComplete, onClose }: TradingReadinessWizardProps) {
  const [step, setStep] = useState(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [data, setData] = useState<WizardData>({
    preferredStrategies: ["VCP", "VCP_MULTIDAY"],
    scanUniverse: "all",
    scanTimeframe: "1d",
    scanConfidenceMin: 75,
    actionMode: "ALERTS_ONLY",
    safetyLimits: {
      maxTradesPerDay: 2,
      maxPositions: 3,
      riskPerTradeUsd: 500,
      maxDailyLossUsd: 1000,
    },
  });

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const saveMutation = useMutation({
    mutationFn: async (wizardData: WizardData) => {
      await apiRequest("PUT", "/api/user/settings", {
        ...wizardData,
        setupCompleted: true,
        setupCompletedAt: new Date().toISOString(),
      });
      
      await apiRequest("POST", "/api/audit-events", {
        eventType: "WIZARD_COMPLETED",
        metadata: {
          actionMode: wizardData.actionMode,
          strategiesCount: wizardData.preferredStrategies.length,
          brokerConnected: brokerStatus?.isConnected || false,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Setup Complete", description: "Your trading preferences have been saved." });
      onComplete();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings. Please try again.", variant: "destructive" });
    },
  });

  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;

  const canProceed = () => {
    switch (step) {
      case 1:
        return data.preferredStrategies.length > 0;
      case 2:
        return !!data.actionMode;
      case 3:
        return true;
      case 4:
        return data.safetyLimits.maxTradesPerDay > 0;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      saveMutation.mutate(data);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const toggleStrategy = (strategyId: string) => {
    setData(prev => ({
      ...prev,
      preferredStrategies: prev.preferredStrategies.includes(strategyId)
        ? prev.preferredStrategies.filter(s => s !== strategyId)
        : [...prev.preferredStrategies, strategyId],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Trading Readiness Setup
          </DialogTitle>
          <DialogDescription>
            Configure your trading preferences in a few simple steps
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Step {step} of {totalSteps}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Choose What to Scan</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  These settings configure how the platform surfaces opportunities. They are not investment recommendations.
                </p>
              </div>

              <div className="space-y-3">
                <Label>Strategies</Label>
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map(strategy => (
                    <div
                      key={strategy.id}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-md border cursor-pointer hover-elevate",
                        data.preferredStrategies.includes(strategy.id) && "border-primary bg-primary/5"
                      )}
                      onClick={() => toggleStrategy(strategy.id)}
                      data-testid={`checkbox-strategy-${strategy.id}`}
                    >
                      <Checkbox
                        checked={data.preferredStrategies.includes(strategy.id)}
                        onCheckedChange={() => toggleStrategy(strategy.id)}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{strategy.name}</div>
                        <Badge variant="outline" className="text-[10px]">{strategy.category}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Universe</Label>
                  <Select
                    value={data.scanUniverse}
                    onValueChange={v => setData(prev => ({ ...prev, scanUniverse: v }))}
                  >
                    <SelectTrigger data-testid="select-universe">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All US Equities</SelectItem>
                      <SelectItem value="sp500">S&P 500</SelectItem>
                      <SelectItem value="nasdaq100">NASDAQ 100</SelectItem>
                      <SelectItem value="watchlist">My Watchlists</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Timeframe</Label>
                  <Select
                    value={data.scanTimeframe}
                    onValueChange={v => setData(prev => ({ ...prev, scanTimeframe: v }))}
                  >
                    <SelectTrigger data-testid="select-timeframe">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5m">5 Minute</SelectItem>
                      <SelectItem value="15m">15 Minute</SelectItem>
                      <SelectItem value="1h">1 Hour</SelectItem>
                      <SelectItem value="1d">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Confidence Threshold</Label>
                <RadioGroup
                  value={CONFIDENCE_PRESETS.find(p => p.value === data.scanConfidenceMin)?.id || "balanced"}
                  onValueChange={id => {
                    const preset = CONFIDENCE_PRESETS.find(p => p.id === id);
                    if (preset) {
                      setData(prev => ({ ...prev, scanConfidenceMin: preset.value }));
                    }
                  }}
                  className="grid grid-cols-3 gap-2"
                >
                  {CONFIDENCE_PRESETS.map(preset => (
                    <div key={preset.id} className="relative">
                      <RadioGroupItem value={preset.id} id={`confidence-${preset.id}`} className="peer sr-only" />
                      <Label
                        htmlFor={`confidence-${preset.id}`}
                        className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                        data-testid={`radio-confidence-${preset.id}`}
                      >
                        <span className="font-medium">{preset.label}</span>
                        <span className="text-xs text-muted-foreground">{preset.value}%+</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">How Should the System Act?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Choose how you want to interact with detected opportunities
                </p>
              </div>

              <RadioGroup
                value={data.actionMode}
                onValueChange={v => setData(prev => ({ ...prev, actionMode: v as typeof data.actionMode }))}
                className="space-y-3"
              >
                <Card 
                  className={cn(
                    "cursor-pointer hover-elevate",
                    data.actionMode === "ALERTS_ONLY" && "border-primary"
                  )}
                  onClick={() => setData(prev => ({ ...prev, actionMode: "ALERTS_ONLY" }))}
                  data-testid="card-mode-alerts"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="ALERTS_ONLY" id="alerts-only" />
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Bell className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Alerts Only</CardTitle>
                        <CardDescription>Receive notifications when patterns are detected</CardDescription>
                      </div>
                      <Badge variant="secondary" className="ml-auto">Default</Badge>
                    </div>
                  </CardHeader>
                </Card>

                <Card 
                  className={cn(
                    "cursor-pointer hover-elevate",
                    data.actionMode === "ASSISTED" && "border-primary"
                  )}
                  onClick={() => setData(prev => ({ ...prev, actionMode: "ASSISTED" }))}
                  data-testid="card-mode-assisted"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="ASSISTED" id="assisted" />
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <Rocket className="h-5 w-5 text-green-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Assisted Trading</CardTitle>
                        <CardDescription>Review in Execution Cockpit with 1-click execution</CardDescription>
                      </div>
                      <Badge variant="outline" className="ml-auto text-green-600">Recommended</Badge>
                    </div>
                  </CardHeader>
                </Card>

                <Card 
                  className={cn(
                    "cursor-pointer hover-elevate",
                    data.actionMode === "AUTO" && "border-primary"
                  )}
                  onClick={() => setData(prev => ({ ...prev, actionMode: "AUTO" }))}
                  data-testid="card-mode-auto"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="AUTO" id="auto" />
                      <div className="p-2 rounded-lg bg-orange-500/10">
                        <Bot className="h-5 w-5 text-orange-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Auto Agent</CardTitle>
                        <CardDescription>User-configured automation with safety controls</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      You control limits and can pause anytime
                    </p>
                  </CardContent>
                </Card>
              </RadioGroup>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Connect Brokerage</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {data.actionMode === "ALERTS_ONLY" 
                    ? "Optional for Alerts Only mode. Connect to access live market data."
                    : "Recommended for execution features. Connect to enable trading capabilities."}
                </p>
              </div>

              {brokerStatus?.isConnected ? (
                <Card className="border-green-500/50 bg-green-500/5">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-green-500/20">
                        <Check className="h-5 w-5 text-green-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base text-green-700 dark:text-green-400">
                          Broker Connected
                        </CardTitle>
                        <CardDescription>
                          {brokerStatus.provider} • Ready for market data
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <Wifi className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-base">No Broker Connected</CardTitle>
                        <CardDescription>
                          Connect a brokerage for live market data and execution
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <Button variant="outline" className="w-full" asChild>
                      <a href="/settings?tab=brokerage" data-testid="link-connect-broker">
                        Connect Brokerage
                      </a>
                    </Button>
                    
                    {data.actionMode !== "ALERTS_ONLY" && (
                      <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                        <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-yellow-700 dark:text-yellow-400">
                          Execution features require a broker connection. You can still proceed and connect later.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <p className="text-xs text-muted-foreground text-center">
                {data.actionMode === "ALERTS_ONLY" 
                  ? "You can skip this step and connect later from Settings."
                  : "We recommend connecting a broker for the best experience."}
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Set Safety Limits</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure risk controls to protect your account. These limits apply to all automated actions.
                </p>
              </div>

              <div className="space-y-3">
                <Label>Quick Preset</Label>
                <RadioGroup
                  value={SAFETY_PRESETS.find(p => 
                    p.limits.maxTradesPerDay === data.safetyLimits.maxTradesPerDay &&
                    p.limits.maxPositions === data.safetyLimits.maxPositions
                  )?.id || "custom"}
                  onValueChange={id => {
                    const preset = SAFETY_PRESETS.find(p => p.id === id);
                    if (preset) {
                      setData(prev => ({ ...prev, safetyLimits: preset.limits }));
                    }
                  }}
                  className="grid grid-cols-3 gap-2"
                >
                  {SAFETY_PRESETS.map(preset => (
                    <div key={preset.id} className="relative">
                      <RadioGroupItem value={preset.id} id={`safety-${preset.id}`} className="peer sr-only" />
                      <Label
                        htmlFor={`safety-${preset.id}`}
                        className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                        data-testid={`radio-safety-${preset.id}`}
                      >
                        <span className="font-medium">{preset.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {preset.limits.maxTradesPerDay} trades/day
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxTrades">Max Trades per Day</Label>
                  <Input
                    id="maxTrades"
                    type="number"
                    min={1}
                    max={20}
                    value={data.safetyLimits.maxTradesPerDay}
                    onChange={e => setData(prev => ({
                      ...prev,
                      safetyLimits: { ...prev.safetyLimits, maxTradesPerDay: parseInt(e.target.value) || 1 }
                    }))}
                    data-testid="input-max-trades"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxPositions">Max Open Positions</Label>
                  <Input
                    id="maxPositions"
                    type="number"
                    min={1}
                    max={10}
                    value={data.safetyLimits.maxPositions}
                    onChange={e => setData(prev => ({
                      ...prev,
                      safetyLimits: { ...prev.safetyLimits, maxPositions: parseInt(e.target.value) || 1 }
                    }))}
                    data-testid="input-max-positions"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="riskPerTrade">Risk per Trade ($)</Label>
                  <Input
                    id="riskPerTrade"
                    type="number"
                    min={50}
                    max={10000}
                    value={data.safetyLimits.riskPerTradeUsd}
                    onChange={e => setData(prev => ({
                      ...prev,
                      safetyLimits: { ...prev.safetyLimits, riskPerTradeUsd: parseInt(e.target.value) || 50 }
                    }))}
                    data-testid="input-risk-per-trade"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxDailyLoss">Max Daily Loss ($)</Label>
                  <Input
                    id="maxDailyLoss"
                    type="number"
                    min={100}
                    max={50000}
                    value={data.safetyLimits.maxDailyLossUsd}
                    onChange={e => setData(prev => ({
                      ...prev,
                      safetyLimits: { ...prev.safetyLimits, maxDailyLossUsd: parseInt(e.target.value) || 100 }
                    }))}
                    data-testid="input-max-daily-loss"
                  />
                </div>
              </div>

              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <Shield className="h-4 w-4 text-primary mt-0.5" />
                    <div className="text-xs text-muted-foreground">
                      <strong>Emergency Stop:</strong> You can instantly halt all automated activity 
                      at any time from the Command Center or Auto Agent panel.
                    </div>
                  </div>
                </CardContent>
              </Card>
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
              disabled={!canProceed() || saveMutation.isPending}
              data-testid="button-wizard-next"
            >
              {saveMutation.isPending ? (
                "Saving..."
              ) : step === totalSteps ? (
                <>
                  Complete Setup
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

        <div className="mt-4 pt-4 border-t">
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            VCP Trader provides educational and informational market scanning tools. 
            Not investment advice. No guarantees. Users control all trading decisions and automation.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
