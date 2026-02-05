import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Bot, Power, Pause, Play, AlertTriangle, Shield, Settings2, Activity, Info, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface AgentPolicy {
  id: string;
  userId: string;
  mode: string;
  enabled: boolean;
  allowedStages: string[] | null;
  minConfidencePct: number | null;
  minUpsidePct: number | null;
  minRvol: number | null;
  minRewardRisk: number | null;
  priceMin: number | null;
  priceMax: number | null;
  maxTradesPerDay: number | null;
  maxConcurrentPositions: number | null;
  riskPerTradeUsd: number | null;
  maxDailyLossUsd: number | null;
  avoidFirstMinutes: number | null;
  cooldownMinutes: number | null;
}

const STAGE_OPTIONS = [
  { value: "FORMING", label: "Forming", description: "Pattern is developing" },
  { value: "READY", label: "Ready", description: "Near breakout level" },
  { value: "BREAKOUT", label: "Breakout", description: "Breaking resistance" },
];

interface AgentState {
  userId: string;
  enabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  lastRunAt: string | null;
  tradesTodayCount: number | null;
  dailyPnlEstimate: number | null;
}

export function AutoAgentPanel() {
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: policy, isLoading: policyLoading } = useQuery<AgentPolicy>({
    queryKey: ["/api/agent/policy"],
  });

  const { data: state, isLoading: stateLoading } = useQuery<AgentState>({
    queryKey: ["/api/agent/state"],
  });

  const updatePolicy = useMutation({
    mutationFn: async (updates: Partial<AgentPolicy>) => {
      return apiRequest("PUT", "/api/agent/policy", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/policy"] });
      toast({ title: "Policy updated" });
    },
  });

  const enableAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/enable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Auto Agent enabled" });
    },
  });

  const disableAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/disable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Auto Agent disabled" });
    },
  });

  const pauseAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Auto Agent paused" });
    },
  });

  const resumeAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/resume"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Auto Agent resumed" });
    },
  });

  const emergencyStop = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/emergency-stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "EMERGENCY STOP ACTIVATED", variant: "destructive" });
    },
  });

  const clearEmergencyStop = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/clear-emergency-stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Emergency stop cleared" });
    },
  });

  if (policyLoading || stateLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Auto Agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-32 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = () => {
    if (state?.emergencyStop) {
      return <Badge variant="destructive" data-testid="badge-agent-status">EMERGENCY STOP</Badge>;
    }
    if (!state?.enabled) {
      return <Badge variant="secondary" data-testid="badge-agent-status">OFF</Badge>;
    }
    if (state?.paused) {
      return <Badge variant="outline" className="border-yellow-500 text-yellow-500" data-testid="badge-agent-status">PAUSED</Badge>;
    }
    return <Badge variant="default" className="bg-green-600" data-testid="badge-agent-status">ARMED</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle className="text-base font-medium">Auto Agent</CardTitle>
          </div>
          {getStatusBadge()}
        </div>
        <CardDescription>
          Automatically evaluate opportunities against your trading criteria
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4 p-4 bg-muted rounded-lg">
          <div className="space-y-1">
            <p className="text-sm font-medium">Agent Status</p>
            <p className="text-xs text-muted-foreground">
              {state?.lastRunAt
                ? `Last run: ${new Date(state.lastRunAt).toLocaleString()}`
                : "Never run"}
            </p>
            {state && state.tradesTodayCount !== null && state.tradesTodayCount !== undefined && state.tradesTodayCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Trades today: {state.tradesTodayCount}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {state?.emergencyStop ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearEmergencyStop.mutate()}
                disabled={clearEmergencyStop.isPending}
                data-testid="button-clear-emergency"
              >
                <Shield className="h-4 w-4 mr-1" />
                Clear Stop
              </Button>
            ) : (
              <>
                {!state?.enabled ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => enableAgent.mutate()}
                    disabled={enableAgent.isPending}
                    data-testid="button-enable-agent"
                  >
                    <Power className="h-4 w-4 mr-1" />
                    Enable
                  </Button>
                ) : (
                  <>
                    {state?.paused ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resumeAgent.mutate()}
                        disabled={resumeAgent.isPending}
                        data-testid="button-resume-agent"
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => pauseAgent.mutate()}
                        disabled={pauseAgent.isPending}
                        data-testid="button-pause-agent"
                      >
                        <Pause className="h-4 w-4 mr-1" />
                        Pause
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disableAgent.mutate()}
                      disabled={disableAgent.isPending}
                      data-testid="button-disable-agent"
                    >
                      <Power className="h-4 w-4 mr-1" />
                      Disable
                    </Button>
                  </>
                )}
              </>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => emergencyStop.mutate()}
              disabled={emergencyStop.isPending || state?.emergencyStop}
              data-testid="button-emergency-stop"
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Emergency Stop
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1">
                <Label>Mode</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p><strong>Suggest:</strong> Agent evaluates opportunities and shows recommendations without taking action.</p>
                    <p className="mt-1"><strong>Auto:</strong> Agent automatically executes trades when criteria are met.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                Suggest shows recommendations, Auto executes trades
              </p>
            </div>
            <Select
              value={policy?.mode || "SUGGEST"}
              onValueChange={(value) => updatePolicy.mutate({ mode: value })}
              data-testid="select-agent-mode"
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUGGEST">Suggest</SelectItem>
                <SelectItem value="AUTO">Auto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label>Trade Only These Stages</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p><strong>Forming:</strong> Pattern is still developing, higher risk.</p>
                  <p className="mt-1"><strong>Ready:</strong> Near breakout level, watching for confirmation.</p>
                  <p className="mt-1"><strong>Breakout:</strong> Actively breaking resistance, most common for entries.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Agent will only act on opportunities in selected stages
            </p>
            <div className="flex flex-wrap gap-3">
              {STAGE_OPTIONS.map((stage) => {
                const currentStages = policy?.allowedStages || ["BREAKOUT"];
                const isChecked = currentStages.includes(stage.value);
                
                return (
                  <label
                    key={stage.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        let newStages: string[];
                        if (checked) {
                          newStages = [...currentStages, stage.value];
                        } else {
                          newStages = currentStages.filter(s => s !== stage.value);
                          if (newStages.length === 0) {
                            newStages = ["BREAKOUT"];
                          }
                        }
                        updatePolicy.mutate({ allowedStages: newStages });
                      }}
                      data-testid={`checkbox-stage-${stage.value.toLowerCase()}`}
                    />
                    <span className="text-sm">{stage.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="minConfidence">Min Confidence %</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Minimum pattern quality score required. Higher values filter for stronger setups but may reduce opportunities.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="minConfidence"
                type="number"
                value={policy?.minConfidencePct ?? 85}
                onChange={(e) => updatePolicy.mutate({ minConfidencePct: parseInt(e.target.value) || 85 })}
                data-testid="input-min-confidence"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="minUpside">Min Upside %</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Minimum expected profit percentage from entry to target. Filters out setups with limited profit potential.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="minUpside"
                type="number"
                step="0.5"
                value={policy?.minUpsidePct ?? 5}
                onChange={(e) => updatePolicy.mutate({ minUpsidePct: parseFloat(e.target.value) || 5 })}
                data-testid="input-min-upside"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="minRvol">Min RVOL</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Relative Volume - compares current volume to average. 1.5 means 50% more volume than usual. Higher values indicate stronger institutional interest.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="minRvol"
                type="number"
                step="0.1"
                value={policy?.minRvol ?? 1.5}
                onChange={(e) => updatePolicy.mutate({ minRvol: parseFloat(e.target.value) || 1.5 })}
                data-testid="input-min-rvol"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="minRR">Min Reward:Risk</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Minimum reward-to-risk ratio. 2:1 means potential profit is twice the potential loss. Higher ratios mean better risk-adjusted opportunities.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="minRR"
                type="number"
                step="0.1"
                value={policy?.minRewardRisk ?? 1}
                onChange={(e) => updatePolicy.mutate({ minRewardRisk: parseFloat(e.target.value) || 1 })}
                data-testid="input-min-rr"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="maxTrades">Max Trades/Day</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Maximum number of trades the agent can execute in a single day. Helps control overtrading and risk exposure.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="maxTrades"
                type="number"
                value={policy?.maxTradesPerDay ?? 2}
                onChange={(e) => updatePolicy.mutate({ maxTradesPerDay: parseInt(e.target.value) || 2 })}
                data-testid="input-max-trades"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="maxPositions">Max Positions</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Maximum number of open positions allowed at the same time. Prevents over-concentration and manages portfolio risk.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="maxPositions"
                type="number"
                value={policy?.maxConcurrentPositions ?? 3}
                onChange={(e) => updatePolicy.mutate({ maxConcurrentPositions: parseInt(e.target.value) || 3 })}
                data-testid="input-max-positions"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="riskPerTrade">Risk/Trade ($)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Maximum dollar amount you're willing to lose on a single trade. Used to calculate position size based on stop loss distance.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="riskPerTrade"
                type="number"
                value={policy?.riskPerTradeUsd ?? 500}
                onChange={(e) => updatePolicy.mutate({ riskPerTradeUsd: parseFloat(e.target.value) || 500 })}
                data-testid="input-risk-per-trade"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="maxDailyLoss">Max Daily Loss ($)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Daily loss limit that triggers an automatic pause. Protects your account from excessive losses during volatile markets.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="maxDailyLoss"
                type="number"
                value={policy?.maxDailyLossUsd ?? 1000}
                onChange={(e) => updatePolicy.mutate({ maxDailyLossUsd: parseFloat(e.target.value) || 1000 })}
                data-testid="input-max-daily-loss"
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full"
            data-testid="button-toggle-advanced"
          >
            <Settings2 className="h-4 w-4 mr-2" />
            {showAdvanced ? "Hide" : "Show"} Advanced Settings
          </Button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="priceMin">Min Price ($)</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Only consider stocks priced above this amount. Filters out low-priced stocks that may have higher volatility or liquidity issues.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="priceMin"
                  type="number"
                  step="0.01"
                  value={policy?.priceMin ?? ""}
                  placeholder="No minimum"
                  onChange={(e) => updatePolicy.mutate({ priceMin: e.target.value ? parseFloat(e.target.value) : null })}
                  data-testid="input-price-min"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="priceMax">Max Price ($)</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Only consider stocks priced below this amount. Helps limit position sizes and focus on stocks within your trading range.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="priceMax"
                  type="number"
                  step="0.01"
                  value={policy?.priceMax ?? ""}
                  placeholder="No maximum"
                  onChange={(e) => updatePolicy.mutate({ priceMax: e.target.value ? parseFloat(e.target.value) : null })}
                  data-testid="input-price-max"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="avoidFirst">Avoid First Minutes</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Minutes after market open to skip trading. The first 15-30 minutes often have erratic price action and wider spreads.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="avoidFirst"
                  type="number"
                  value={policy?.avoidFirstMinutes ?? 15}
                  onChange={(e) => updatePolicy.mutate({ avoidFirstMinutes: parseInt(e.target.value) || 15 })}
                  data-testid="input-avoid-first"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="cooldown">Cooldown Minutes</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Minimum time to wait between trades on the same symbol. Prevents over-trading a single stock and allows time for price action to develop.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="cooldown"
                  type="number"
                  value={policy?.cooldownMinutes ?? 60}
                  onChange={(e) => updatePolicy.mutate({ cooldownMinutes: parseInt(e.target.value) || 60 })}
                  data-testid="input-cooldown"
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
