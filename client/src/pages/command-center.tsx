import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { TradingReadinessWizard } from "@/components/trading-readiness-wizard";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Pause,
  Play,
  Radio,
  Rocket,
  Settings,
  Shield,
  Square,
  Target,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import type { 
  UserSettings, 
  BrokerConnection, 
  AgentState, 
  AgentPolicy, 
  Opportunity, 
  Trade,
  ScanResult 
} from "@shared/schema";

function isMarketOpen(): boolean {
  const now = new Date();
  const etOffset = -5;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const et = new Date(utc + 3600000 * etOffset);
  const hour = et.getHours();
  const minute = et.getMinutes();
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const timeInMinutes = hour * 60 + minute;
  return timeInMinutes >= 570 && timeInMinutes <= 960;
}

function StatusCard({ 
  status, 
  label, 
  icon: Icon 
}: { 
  status: "online" | "offline" | "warning"; 
  label: string;
  icon: typeof Wifi;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border",
        status === "online" && "border-green-500/30 bg-green-500/10",
        status === "offline" && "border-muted-foreground/30 bg-muted/50",
        status === "warning" && "border-yellow-500/30 bg-yellow-500/10"
      )}
    >
      <Icon className={cn(
        "h-4 w-4",
        status === "online" && "text-green-500",
        status === "offline" && "text-muted-foreground",
        status === "warning" && "text-yellow-500"
      )} />
      <span className={cn(
        "text-sm font-medium",
        status === "online" && "text-green-600 dark:text-green-400",
        status === "offline" && "text-muted-foreground",
        status === "warning" && "text-yellow-600 dark:text-yellow-400"
      )}>
        {label}
      </span>
    </div>
  );
}

export default function CommandCenter() {
  const [showWizard, setShowWizard] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user-settings"],
  });

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const { data: agentState } = useQuery<AgentState | null>({
    queryKey: ["/api/agent/state"],
  });

  const { data: agentPolicy } = useQuery<AgentPolicy | null>({
    queryKey: ["/api/agent/policy"],
  });

  const { data: opportunities } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities", { status: "ACTIVE" }],
  });

  const { data: scanResults } = useQuery<ScanResult[]>({
    queryKey: ["/api/scan"],
  });

  const { data: trades } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
  });

  const pauseAgentMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      apiRequest("POST", "/api/audit-events", { eventType: "AUTO_AGENT_PAUSED", metadata: {} });
      toast({ title: "Agent Paused", description: "Auto Agent has been paused." });
    },
  });

  const resumeAgentMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/resume"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Agent Resumed", description: "Auto Agent is now active." });
    },
  });

  const emergencyStopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/emergency-stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      apiRequest("POST", "/api/audit-events", { eventType: "EMERGENCY_STOP_TRIGGERED", metadata: {} });
      toast({ 
        title: "Emergency Stop Activated", 
        description: "All automated activity has been halted.",
        variant: "destructive"
      });
    },
  });

  const marketOpen = isMarketOpen();
  const brokerConnected = brokerStatus?.isConnected ?? false;
  const agentEnabled = agentState?.enabled ?? false;
  const agentPaused = agentState?.paused ?? false;
  const emergencyStop = agentState?.emergencyStop ?? false;
  const actionMode = userSettings?.actionMode || "ALERTS_ONLY";
  const setupComplete = userSettings?.setupCompleted ?? false;

  const todaysTrades = trades?.filter(t => {
    const today = new Date().toDateString();
    return new Date(t.createdAt || "").toDateString() === today;
  }) || [];

  const openPositions = trades?.filter(t => t.status === "OPEN") || [];

  const getAgentStatus = () => {
    if (emergencyStop) return { label: "Emergency Stop", status: "offline" as const };
    if (!agentEnabled) return { label: "Disabled", status: "offline" as const };
    if (agentPaused) return { label: "Paused", status: "warning" as const };
    return { label: "Armed", status: "online" as const };
  };

  const agentStatus = getAgentStatus();

  useEffect(() => {
    if (userSettings && !userSettings.setupCompleted) {
      setShowWizard(true);
    }
  }, [userSettings]);

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Trading Command Center
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Your hub for opportunities, execution, and automation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusCard 
            status={marketOpen ? "online" : "offline"} 
            label={marketOpen ? "Market Open" : "Market Closed"} 
            icon={Activity}
          />
          <StatusCard 
            status={brokerConnected ? "online" : "offline"} 
            label={brokerConnected ? `${brokerStatus?.provider}` : "No Broker"} 
            icon={Wifi}
          />
          <StatusCard 
            status={agentStatus.status} 
            label={`Agent: ${agentStatus.label}`} 
            icon={Bot}
          />
        </div>
      </div>

      {!setupComplete ? (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Settings className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Complete Your Setup</CardTitle>
                  <CardDescription>Configure your trading preferences to get started</CardDescription>
                </div>
              </div>
              <Button onClick={() => setShowWizard(true)} data-testid="button-finish-setup">
                Finish Setup
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <Card className="border-muted">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Trading Configuration</CardTitle>
                  <CardDescription>Your current trading preferences and mode</CardDescription>
                </div>
              </div>
              <Button variant="outline" onClick={() => setShowWizard(true)} data-testid="button-edit-setup">
                <Settings className="h-4 w-4 mr-1" />
                Edit Configuration
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border">
                <span className="text-xs text-muted-foreground">Mode:</span>
                <span className="text-sm font-medium">
                  {actionMode === "ALERTS_ONLY" ? "Alerts Only" : 
                   actionMode === "ASSISTED" ? "Assisted Trading" : "Auto Trading"}
                </span>
              </div>
              {brokerConnected && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/10 border border-green-500/20">
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-sm font-medium text-green-600 dark:text-green-400">
                    {brokerStatus?.provider}
                  </span>
                </div>
              )}
              {agentEnabled && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium">Auto Agent {agentPaused ? "Paused" : "Active"}</span>
                </div>
              )}
              {userSettings?.pushNotificationsEnabled === "true" && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border">
                  <Bell className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">Push Alerts</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50 border">
        <span className="text-sm font-medium mr-2">Quick Actions:</span>
        
        <Button variant="outline" size="sm" asChild>
          <Link href="/execution" data-testid="link-execution-cockpit">
            <Rocket className="h-4 w-4 mr-1" />
            Execution Cockpit
          </Link>
        </Button>

        {agentEnabled && !emergencyStop && (
          agentPaused ? (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => resumeAgentMutation.mutate()}
              disabled={resumeAgentMutation.isPending}
              data-testid="button-resume-agent"
            >
              <Play className="h-4 w-4 mr-1" />
              Resume Agent
            </Button>
          ) : (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => pauseAgentMutation.mutate()}
              disabled={pauseAgentMutation.isPending}
              data-testid="button-pause-agent"
            >
              <Pause className="h-4 w-4 mr-1" />
              Pause Agent
            </Button>
          )
        )}

        <Button 
          variant="destructive" 
          size="sm"
          onClick={() => emergencyStopMutation.mutate()}
          disabled={emergencyStopMutation.isPending || emergencyStop}
          data-testid="button-emergency-stop"
        >
          <Square className="h-4 w-4 mr-1" />
          Emergency Stop
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle>Today's Opportunities</CardTitle>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/" data-testid="link-view-all-opportunities">
                    View All
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
              <CardDescription className="flex items-center gap-1">
                <Radio className={cn("h-3 w-3", marketOpen && "text-green-500")} />
                {marketOpen ? "Live scan active" : "Scan paused - Market closed"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {scanResults && scanResults.length > 0 ? (
                <ScrollArea className="h-[280px]">
                  <div className="space-y-2">
                    {scanResults.slice(0, 8).map((result, idx) => (
                      <div 
                        key={result.id || idx}
                        className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                        data-testid={`card-opportunity-${result.ticker}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="font-semibold">{result.ticker}</div>
                          <Badge variant="outline" className="text-xs">
                            {result.stage}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            ${result.price?.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {result.patternScore && (
                            <Badge variant="secondary" className="text-xs">
                              {result.patternScore}%
                            </Badge>
                          )}
                          {actionMode === "ALERTS_ONLY" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Bell className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Set Alert</TooltipContent>
                            </Tooltip>
                          )}
                          {actionMode === "ASSISTED" && (
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/execution?symbol=${result.ticker}`}>
                                Review
                                <ArrowRight className="h-3 w-3 ml-1" />
                              </Link>
                            </Button>
                          )}
                          {actionMode === "AUTO" && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="text-xs">
                                  <Bot className="h-3 w-3 mr-1" />
                                  Auto
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Managed by Auto Agent</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center h-[200px] text-center">
                  <Target className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No opportunities detected</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {marketOpen 
                      ? "Scanning for patterns... Check back soon."
                      : "Scan will resume when market opens."}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Reference levels are informational only. Not investment advice.
              </p>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle>Auto Agent</CardTitle>
                <Badge 
                  variant={agentStatus.status === "online" ? "default" : "secondary"}
                  className="ml-auto"
                >
                  {agentStatus.label}
                </Badge>
              </div>
              <CardDescription>
                Automation follows your rules. You are responsible for configuration and monitoring.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {emergencyStop ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <div>
                    <p className="font-medium text-destructive">Emergency Stop Active</p>
                    <p className="text-sm text-muted-foreground">
                      All automated activity is halted. Clear from settings to resume.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Mode</p>
                    <p className="font-medium">{agentPolicy?.mode || "SUGGEST"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Max Trades/Day</p>
                    <p className="font-medium">{agentPolicy?.maxTradesPerDay || 2}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Max Positions</p>
                    <p className="font-medium">{agentPolicy?.maxConcurrentPositions || 3}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Risk/Trade</p>
                    <p className="font-medium">${agentPolicy?.riskPerTradeUsd || 500}</p>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-3 gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/execution?tab=agent" data-testid="link-modify-rules">
                  Modify Rules
                </Link>
              </Button>
              {!emergencyStop && agentEnabled && (
                agentPaused ? (
                  <Button 
                    size="sm" 
                    onClick={() => resumeAgentMutation.mutate()}
                    disabled={resumeAgentMutation.isPending}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Resume
                  </Button>
                ) : (
                  <Button 
                    variant="outline"
                    size="sm" 
                    onClick={() => pauseAgentMutation.mutate()}
                    disabled={pauseAgentMutation.isPending}
                  >
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </Button>
                )
              )}
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <CardTitle>Execution Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{openPositions.length}</p>
                  <p className="text-xs text-muted-foreground">Open Positions</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{todaysTrades.length}</p>
                  <p className="text-xs text-muted-foreground">Trades Today</p>
                </div>
              </div>

              {agentState?.lastRunAt && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Last scan: {new Date(agentState.lastRunAt).toLocaleTimeString()}
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-3 flex-col gap-2">
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/execution" data-testid="link-open-cockpit">
                  <Rocket className="h-4 w-4 mr-1" />
                  Open Execution Cockpit
                </Link>
              </Button>
              <Button variant="ghost" size="sm" className="w-full" asChild>
                <Link href="/opportunities" data-testid="link-view-history">
                  <History className="h-4 w-4 mr-1" />
                  View Trade History
                </Link>
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Wifi className="h-5 w-5 text-primary" />
                <CardTitle>Broker Connection</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {brokerConnected ? (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-green-600 dark:text-green-400">Connected</p>
                    <p className="text-sm text-muted-foreground">{brokerStatus?.provider}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-muted">
                    <WifiOff className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Not Connected</p>
                    <p className="text-sm text-muted-foreground">Connect for live data</p>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-3">
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/settings?tab=brokerage" data-testid="link-manage-broker">
                  {brokerConnected ? "Manage Connection" : "Connect Broker"}
                </Link>
              </Button>
            </CardFooter>
          </Card>

          <Card className="bg-muted/30">
            <CardContent className="pt-4">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  VCP Trader and AlgoPilotX are software tools for self-directed traders. 
                  Educational and informational use only. Not investment advice. No guarantees. 
                  Users control all trading decisions and automation.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <TradingReadinessWizard
        open={showWizard}
        onComplete={() => {
          setShowWizard(false);
          queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
        }}
        onClose={() => setShowWizard(false)}
      />
    </div>
  );
}
