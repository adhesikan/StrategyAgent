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
import { Bot, Power, Pause, Play, AlertTriangle, Shield, Settings2, Activity, Info, Check, ArrowRight, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { AutoAgentAcknowledgementModal } from "./auto-agent-acknowledgement-modal";
import type { UserSettings } from "@shared/schema";
import { getStrategyDisplayName } from "@shared/strategies";

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
  scanIntervalMinutes: number | null;
  optionsEnabled: boolean | null;
  optionType: string | null;
  optionsStrategy: string | null;
  optionsDeltaMin: number | null;
  optionsDeltaMax: number | null;
  optionsDteMin: number | null;
  optionsDteMax: number | null;
  optionsPremiumMin: number | null;
  optionsPremiumMax: number | null;
  optionsMinOpenInterest: number | null;
  optionsMinVolume: number | null;
  optionsMaxRiskUsd: number | null;
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
  const [showAckModal, setShowAckModal] = useState(false);
  const [todayTradesOpen, setTodayTradesOpen] = useState(false);

  const { data: policy, isLoading: policyLoading } = useQuery<AgentPolicy>({
    queryKey: ["/api/agent/policy"],
  });

  const { data: state, isLoading: stateLoading } = useQuery<AgentState>({
    queryKey: ["/api/agent/state"],
  });

  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
  });

  interface AgentSettings {
    bracketEnabled?: boolean;
    bracketStopMethod?: string;
    bracketStopValue?: number | null;
    bracketTargetMethod?: string;
    bracketTargetValue?: number | null;
    optionsBracketEnabled?: boolean;
    optionsBracketStopMethod?: string;
    optionsBracketStopValue?: number | null;
    optionsBracketTargetMethod?: string;
    optionsBracketTargetValue?: number | null;
  }

  const { data: agentSettings } = useQuery<AgentSettings>({
    queryKey: ["/api/agent-settings"],
  });

  const updateAgentSettings = useMutation({
    mutationFn: async (updates: Partial<AgentSettings>) => {
      return apiRequest("PUT", "/api/agent-settings", updates);
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ["/api/agent-settings"] });
      const prev = queryClient.getQueryData<AgentSettings>(["/api/agent-settings"]);
      queryClient.setQueryData(["/api/agent-settings"], (old: any) => ({ ...old, ...updates }));
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-settings"] });
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/agent-settings"], context.prev);
      toast({ title: "Failed to update settings", variant: "destructive" });
    },
  });

  interface TodayTrade {
    id: string;
    symbol: string;
    source: string;
    action: string;
    side: string;
    quantity: number;
    orderType: string;
    price: number | null;
    status: string;
    strategy: string | null;
    reasons: string[] | null;
    createdAt: string;
  }

  const { data: todayTrades } = useQuery<TodayTrade[]>({
    queryKey: ["/api/today-trades"],
    refetchInterval: 30000,
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
                    onClick={() => {
                      if (!userSettings?.autoAgentAcknowledged) {
                        setShowAckModal(true);
                      } else {
                        enableAgent.mutate();
                      }
                    }}
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

        {(() => {
          const agentTrades = (todayTrades || []).filter(t => t.source === "auto_agent");
          if (agentTrades.length === 0) return null;
          return (
            <div className="space-y-2" data-testid="section-today-agent-trades">
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setTodayTradesOpen(!todayTradesOpen)}
                data-testid="button-toggle-today-trades"
              >
                <p className="text-sm font-medium">Today's Trades ({agentTrades.length})</p>
                {todayTradesOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {todayTradesOpen && (
                <>
                  <div className="space-y-1.5">
                    {agentTrades.map((trade) => {
                      const statusColor = trade.status === "sent_to_broker" || trade.status === "filled"
                        ? "text-green-500"
                        : trade.status === "rejected" || trade.status === "error"
                          ? "text-red-500"
                          : "text-muted-foreground";
                      return (
                        <div
                          key={trade.id}
                          className="px-3 py-2 rounded-md bg-muted/50 text-sm"
                          data-testid={`trade-row-${trade.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {trade.side === "buy" ? (
                                <TrendingUp className="h-3.5 w-3.5 text-green-500 shrink-0" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              )}
                              <span className="font-medium">{trade.symbol}</span>
                              <span className="text-xs text-muted-foreground">
                                {trade.quantity} @ ${trade.price?.toFixed(2) ?? "MKT"}
                              </span>
                              {trade.strategy && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {getStrategyDisplayName(trade.strategy)}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs font-medium ${statusColor}`}>
                                {trade.status === "sent_to_broker" ? "Sent" : trade.status}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(trade.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                          {(trade.status === "rejected" || trade.status === "error") && trade.reasons && trade.reasons.length > 0 && (
                            <p className="text-[11px] text-red-400 mt-1 ml-5.5 leading-snug" data-testid={`text-rejection-reason-${trade.id}`}>
                              {trade.reasons.join("; ")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}

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

          <div className="grid grid-cols-2 gap-4">
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

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <Label>Bracket Orders (OCO)</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Automatically attach a stop-loss and profit-target to every entry order as an OCO (One-Cancels-Other) bracket. When one exit leg fills, the other is cancelled.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground">
                  Protect every trade with automatic stop-loss and take-profit exits
                </p>
              </div>
              <Switch
                checked={agentSettings?.bracketEnabled ?? true}
                onCheckedChange={(checked) => updateAgentSettings.mutate({ bracketEnabled: checked })}
                data-testid="switch-bracket-enabled"
              />
            </div>

            {(agentSettings?.bracketEnabled ?? true) && (
              <div className="space-y-4 pl-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label>Stop-Loss Method</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p><strong>From Signal:</strong> Uses the stop price from the scan/alert data.</p>
                          <p className="mt-1"><strong>% from Entry:</strong> Sets stop as a percentage below your entry price.</p>
                          <p className="mt-1"><strong>$ from Entry:</strong> Sets stop a fixed dollar amount below entry.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={agentSettings?.bracketStopMethod || "signal"}
                      onValueChange={(val) => {
                        const updates: Partial<AgentSettings> = { bracketStopMethod: val };
                        if (val === "signal") updates.bracketStopValue = null;
                        updateAgentSettings.mutate(updates);
                      }}
                    >
                      <SelectTrigger data-testid="select-bracket-stop-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signal">From Signal</SelectItem>
                        <SelectItem value="pct">% from Entry</SelectItem>
                        <SelectItem value="dollar">$ from Entry</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {agentSettings?.bracketStopMethod && agentSettings.bracketStopMethod !== "signal" && (
                    <div className="space-y-2">
                      <Label>{agentSettings.bracketStopMethod === "pct" ? "Stop Distance (%)" : "Stop Distance ($)"}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder={agentSettings.bracketStopMethod === "pct" ? "e.g. 2.0" : "e.g. 1.50"}
                        value={agentSettings?.bracketStopValue ?? ""}
                        onChange={(e) => updateAgentSettings.mutate({ bracketStopValue: e.target.value ? Number(e.target.value) : null })}
                        data-testid="input-bracket-stop-value"
                      />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label>Take-Profit Method</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p><strong>From Signal:</strong> Uses the target price from the scan/alert data.</p>
                          <p className="mt-1"><strong>% from Entry:</strong> Sets target as a percentage above your entry price.</p>
                          <p className="mt-1"><strong>$ from Entry:</strong> Sets target a fixed dollar amount above entry.</p>
                          <p className="mt-1"><strong>R:R Ratio:</strong> Sets target as a multiple of the stop distance. E.g. 2.0 means target is 2x the risk.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={agentSettings?.bracketTargetMethod || "signal"}
                      onValueChange={(val) => {
                        const updates: Partial<AgentSettings> = { bracketTargetMethod: val };
                        if (val === "signal") updates.bracketTargetValue = null;
                        updateAgentSettings.mutate(updates);
                      }}
                    >
                      <SelectTrigger data-testid="select-bracket-target-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signal">From Signal</SelectItem>
                        <SelectItem value="pct">% from Entry</SelectItem>
                        <SelectItem value="dollar">$ from Entry</SelectItem>
                        <SelectItem value="rr">R:R Ratio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {agentSettings?.bracketTargetMethod && agentSettings.bracketTargetMethod !== "signal" && (
                    <div className="space-y-2">
                      <Label>
                        {agentSettings.bracketTargetMethod === "pct" ? "Target Distance (%)" : agentSettings.bracketTargetMethod === "rr" ? "Risk:Reward Ratio" : "Target Distance ($)"}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder={agentSettings.bracketTargetMethod === "rr" ? "e.g. 2.0" : agentSettings.bracketTargetMethod === "pct" ? "e.g. 4.0" : "e.g. 3.00"}
                        value={agentSettings?.bracketTargetValue ?? ""}
                        onChange={(e) => updateAgentSettings.mutate({ bracketTargetValue: e.target.value ? Number(e.target.value) : null })}
                        data-testid="input-bracket-target-value"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <Label>Options Trading</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>When enabled, the agent will also evaluate and trade options contracts based on your criteria.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enable automated options contract selection and execution
                </p>
              </div>
              <Switch
                checked={policy?.optionsEnabled ?? false}
                onCheckedChange={(checked) => updatePolicy.mutate({ optionsEnabled: checked })}
                data-testid="switch-options-enabled"
              />
            </div>

            {policy?.optionsEnabled && (
              <div className="space-y-4 pl-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label>Option Type</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p><strong>Calls:</strong> Bullish bets on price going up.</p>
                          <p className="mt-1"><strong>Puts:</strong> Bearish bets on price going down.</p>
                          <p className="mt-1"><strong>Both:</strong> Agent selects based on signal direction.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={policy?.optionType ?? "calls"}
                      onValueChange={(value) => updatePolicy.mutate({ optionType: value })}
                      data-testid="select-option-type"
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="calls">Calls Only</SelectItem>
                        <SelectItem value="puts">Puts Only</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label>Strategy</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p><strong>Long Calls/Puts:</strong> Buy options for directional moves.</p>
                          <p className="mt-1"><strong>Covered Calls:</strong> Sell calls against owned shares.</p>
                          <p className="mt-1"><strong>Credit Spreads:</strong> Sell spreads to collect premium.</p>
                          <p className="mt-1"><strong>Cash-Secured Puts:</strong> Sell puts to buy at lower prices.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={policy?.optionsStrategy ?? "long_calls"}
                      onValueChange={(value) => updatePolicy.mutate({ optionsStrategy: value })}
                      data-testid="select-options-strategy"
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long_calls">Long Calls</SelectItem>
                        <SelectItem value="long_puts">Long Puts</SelectItem>
                        <SelectItem value="covered_calls">Covered Calls</SelectItem>
                        <SelectItem value="credit_spreads">Credit Spreads</SelectItem>
                        <SelectItem value="cash_secured_puts">Cash-Secured Puts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsDeltaMin">Min Delta</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Minimum delta (sensitivity to price). Lower delta = cheaper, more speculative. Typical range: 0.20 - 0.50.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsDeltaMin"
                      type="number"
                      step="0.05"
                      min="0.05"
                      max="0.95"
                      value={policy?.optionsDeltaMin ?? 0.30}
                      onChange={(e) => updatePolicy.mutate({ optionsDeltaMin: parseFloat(e.target.value) || 0.30 })}
                      data-testid="input-options-delta-min"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsDeltaMax">Max Delta</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Maximum delta. Higher delta = more expensive, moves more with stock. Typical range: 0.50 - 0.80.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsDeltaMax"
                      type="number"
                      step="0.05"
                      min="0.05"
                      max="0.95"
                      value={policy?.optionsDeltaMax ?? 0.70}
                      onChange={(e) => updatePolicy.mutate({ optionsDeltaMax: parseFloat(e.target.value) || 0.70 })}
                      data-testid="input-options-delta-max"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsDteMin">Min DTE</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Minimum days to expiration. Short DTE = faster decay, higher risk. Typical minimum: 7-14 days.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsDteMin"
                      type="number"
                      min="1"
                      value={policy?.optionsDteMin ?? 14}
                      onChange={(e) => updatePolicy.mutate({ optionsDteMin: parseInt(e.target.value) || 14 })}
                      data-testid="input-options-dte-min"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsDteMax">Max DTE</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Maximum days to expiration. Longer DTE = more expensive, less time decay risk. Typical max: 45-60 days.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsDteMax"
                      type="number"
                      min="1"
                      value={policy?.optionsDteMax ?? 45}
                      onChange={(e) => updatePolicy.mutate({ optionsDteMax: parseInt(e.target.value) || 45 })}
                      data-testid="input-options-dte-max"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsMinOI">Min Open Interest</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Minimum open interest for liquidity. Higher values mean tighter spreads and easier fills.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsMinOI"
                      type="number"
                      min="0"
                      value={policy?.optionsMinOpenInterest ?? 100}
                      onChange={(e) => updatePolicy.mutate({ optionsMinOpenInterest: parseInt(e.target.value) || 100 })}
                      data-testid="input-options-min-oi"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsMinVol">Min Volume</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Minimum daily trading volume. Ensures the contract is actively traded for better fills.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsMinVol"
                      type="number"
                      min="0"
                      value={policy?.optionsMinVolume ?? 10}
                      onChange={(e) => updatePolicy.mutate({ optionsMinVolume: parseInt(e.target.value) || 10 })}
                      data-testid="input-options-min-volume"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsPremiumMin">Min Premium ($)</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Minimum contract premium. Avoids very cheap options that may have poor liquidity.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsPremiumMin"
                      type="number"
                      step="0.10"
                      min="0"
                      value={policy?.optionsPremiumMin ?? ""}
                      placeholder="No minimum"
                      onChange={(e) => updatePolicy.mutate({ optionsPremiumMin: e.target.value ? parseFloat(e.target.value) : null })}
                      data-testid="input-options-premium-min"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="optionsPremiumMax">Max Premium ($)</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Maximum contract premium. Caps the cost per contract to control risk.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="optionsPremiumMax"
                      type="number"
                      step="0.10"
                      min="0"
                      value={policy?.optionsPremiumMax ?? ""}
                      placeholder="No maximum"
                      onChange={(e) => updatePolicy.mutate({ optionsPremiumMax: e.target.value ? parseFloat(e.target.value) : null })}
                      data-testid="input-options-premium-max"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="optionsMaxRisk">Max Risk per Options Trade ($)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Maximum dollar amount at risk per options trade. For buying options, this is the total premium paid. For credit spreads, this is the max loss on the spread.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id="optionsMaxRisk"
                    type="number"
                    min="0"
                    value={policy?.optionsMaxRiskUsd ?? 500}
                    onChange={(e) => updatePolicy.mutate({ optionsMaxRiskUsd: parseFloat(e.target.value) || 500 })}
                    data-testid="input-options-max-risk"
                  />
                </div>

                <div className="border-t pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Label>Options Exit Brackets</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Automatically set stop-loss and take-profit levels on options positions. TradeGuard monitors these levels and closes the position when triggered.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Auto-close options at stop or target levels via TradeGuard
                      </p>
                    </div>
                    <Switch
                      checked={agentSettings?.optionsBracketEnabled ?? false}
                      onCheckedChange={(checked) => updateAgentSettings.mutate({ optionsBracketEnabled: checked })}
                      data-testid="switch-options-bracket-enabled"
                    />
                  </div>

                  {agentSettings?.optionsBracketEnabled && (
                    <div className="space-y-4 pl-1">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-1">
                            <Label>Stop-Loss Method</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p><strong>% of Premium:</strong> Close if option loses this % of its entry premium (e.g. 50% = close at half your entry price).</p>
                                <p className="mt-1"><strong>$ per Contract:</strong> Close if the option drops by this dollar amount per contract.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={agentSettings?.optionsBracketStopMethod || "pct"}
                            onValueChange={(val) => updateAgentSettings.mutate({ optionsBracketStopMethod: val })}
                          >
                            <SelectTrigger data-testid="select-options-bracket-stop-method">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pct">% of Premium</SelectItem>
                              <SelectItem value="dollar">$ per Contract</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{(agentSettings?.optionsBracketStopMethod || "pct") === "pct" ? "Stop Loss (%)" : "Stop Loss ($)"}</Label>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            placeholder={(agentSettings?.optionsBracketStopMethod || "pct") === "pct" ? "e.g. 50" : "e.g. 0.50"}
                            value={agentSettings?.optionsBracketStopValue ?? ""}
                            onChange={(e) => updateAgentSettings.mutate({ optionsBracketStopValue: e.target.value ? Number(e.target.value) : null })}
                            data-testid="input-options-bracket-stop-value"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-1">
                            <Label>Take-Profit Method</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p><strong>% of Premium:</strong> Close when option gains this % above entry premium (e.g. 100% = double your money).</p>
                                <p className="mt-1"><strong>$ per Contract:</strong> Close when the option gains by this dollar amount.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={agentSettings?.optionsBracketTargetMethod || "pct"}
                            onValueChange={(val) => updateAgentSettings.mutate({ optionsBracketTargetMethod: val })}
                          >
                            <SelectTrigger data-testid="select-options-bracket-target-method">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pct">% of Premium</SelectItem>
                              <SelectItem value="dollar">$ per Contract</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{(agentSettings?.optionsBracketTargetMethod || "pct") === "pct" ? "Take Profit (%)" : "Take Profit ($)"}</Label>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            placeholder={(agentSettings?.optionsBracketTargetMethod || "pct") === "pct" ? "e.g. 100" : "e.g. 1.00"}
                            value={agentSettings?.optionsBracketTargetValue ?? ""}
                            onChange={(e) => updateAgentSettings.mutate({ optionsBracketTargetValue: e.target.value ? Number(e.target.value) : null })}
                            data-testid="input-options-bracket-target-value"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
            <div className="space-y-4 pt-2 border-t">

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1">
                <Label>Scan Frequency</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>How often the agent scans for new opportunities during market hours.</p>
                    <p className="mt-1">Shorter intervals catch opportunities faster but use more resources.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                How often to check for new opportunities
              </p>
            </div>
            <Select
              value={String(policy?.scanIntervalMinutes ?? 5)}
              onValueChange={(value) => updatePolicy.mutate({ scanIntervalMinutes: parseInt(value) })}
              data-testid="select-scan-interval"
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every 1 min</SelectItem>
                <SelectItem value="2">Every 2 mins</SelectItem>
                <SelectItem value="5">Every 5 mins</SelectItem>
                <SelectItem value="10">Every 10 mins</SelectItem>
                <SelectItem value="15">Every 15 mins</SelectItem>
                <SelectItem value="30">Every 30 mins</SelectItem>
                <SelectItem value="60">Every hour</SelectItem>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
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
          </div>
          )}
        </div>
      </CardContent>

      <AutoAgentAcknowledgementModal
        open={showAckModal}
        onClose={() => setShowAckModal(false)}
        onConfirm={() => {
          setShowAckModal(false);
          enableAgent.mutate();
        }}
      />
    </Card>
  );
}
