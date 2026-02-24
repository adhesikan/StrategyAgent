import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { AutoAgentPanel } from "@/components/auto-agent-panel";
import { TradeActivityPanel } from "@/components/trade-activity-panel";
import { cn } from "@/lib/utils";
import { Switch as SwitchInput } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Bot, Shield, Settings,
  RefreshCw, CheckCircle2, Link2,
  Power, Pause, Play, AlertTriangle,
  Info,
  ChevronDown, Scan, Filter, BarChart3, Crosshair,
  XCircle, Clock,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { UserSettings } from "@shared/schema";

interface AgentState {
  userId: string;
  enabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  lastRunAt: string | null;
  tradesTodayCount: number | null;
  dailyPnlEstimate: number | null;
}

const DISCLAIMER_TEXT = "All metrics, scores, levels, and calculated values shown are for informational purposes only and do not constitute investment advice. Always rely on and act according to your own trading plan.";


export default function AutomationPage() {
  const { toast } = useToast();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const viewParam = params.get("view");
  const qc = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ["/api/user/settings"],
  });

  const { data: agentState } = useQuery<AgentState>({
    queryKey: ["/api/agent/state"],
  });


  useEffect(() => {
    if (viewParam === "activity") {
      setTimeout(() => {
        document.getElementById("trade-activity")?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, [viewParam]);

  const { isConnected, providerName, status: brokerStatus } = useBrokerStatus();


  if (settingsLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-64" />
            <div className="h-4 bg-muted rounded w-96" />
            <div className="h-48 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto" data-testid="trade-autopilot-page">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Shield className="h-6 w-6" />
            Trade Autopilot
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure how VCP Trader acts on opportunities. Connect your broker and set your limits.
          </p>
        </div>

        <AutoAgentConfig />

        <BrokerConnectionSection
          isConnected={isConnected}
          providerName={providerName}
          isPaper={brokerStatus?.preferredAccountId?.startsWith("sandbox:") ?? false}
        />

        <ScanScheduleSection />

        <HowScanningWorksInfo />

        <SafetyControlsSection
          agentState={agentState}
          settings={settings}
        />

        <SkippedTradesPanel />

        <div id="trade-activity">
          <TradeActivityPanel />
        </div>

        <div className="text-xs text-muted-foreground text-center py-4 border-t" data-testid="text-disclaimer">
          {DISCLAIMER_TEXT}
        </div>
      </div>
    </div>
  );
}


function HowAutonomousTradingWorks() {
  const [isOpen, setIsOpen] = useState(false);

  const steps = [
    {
      icon: Scan,
      title: "Setups are discovered",
      description: "The scanner runs at scheduled times throughout the trading day, detecting patterns across multiple strategies (VCP, pullbacks, momentum, etc.). Options scans from the Scanner page are also picked up automatically.",
    },
    {
      icon: Filter,
      title: "Your policy filters are applied",
      description: "Every candidate is checked against your Auto Agent settings — option type (calls/puts), delta range, DTE, open interest, volume, premium limits, and maximum risk per trade. Only opportunities that pass all your criteria move forward.",
    },
    {
      icon: BarChart3,
      title: "Candidates are ranked by score",
      description: "Qualifying opportunities are sorted by pattern score (highest first) and capped at your daily trade limit. Only the top-scoring setups that fit your rules are considered.",
    },
    {
      icon: Crosshair,
      title: "Action is taken automatically",
      description: "When armed, the Auto Agent builds orders with proper position sizing based on your max risk setting, sets limit prices, and records every decision for your review. All trades respect your daily trade limit and safety controls.",
    },
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} data-testid="section-how-it-works">
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center flex-wrap gap-2 w-full text-left text-sm font-medium text-muted-foreground py-1"
          data-testid="button-how-it-works-toggle"
        >
          <Info className="h-4 w-4" />
          How Autonomous Trading Works
          <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", isOpen && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex flex-wrap gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <step.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                {step.description && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.description}</p>
                )}
              </div>
            </div>
          ))}

          <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground flex gap-2">
            <Shield className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
            <div>
              <span className="font-medium text-foreground">Safety first:</span> The agent only runs during market hours, respects your daily trade limit and loss limits, and can be stopped instantly with the Emergency Stop button.
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const SCAN_WINDOWS = [
  {
    id: "premarket",
    label: "Premarket",
    time: "8:00 AM ET",
    description: "Gap analysis, overnight setups",
    defaultStrategies: ["GAP_AND_GO", "VCP", "VCP_MULTIDAY"],
  },
  {
    id: "vcp",
    label: "VCP Patterns",
    time: "9:45 AM ET",
    description: "Swing and position strategies",
    defaultStrategies: ["VCP", "VCP_MULTIDAY"],
  },
  {
    id: "early_momentum",
    label: "Early Momentum",
    time: "10:00 AM ET",
    description: "Opening range breakouts, gap plays",
    defaultStrategies: ["ORB5", "ORB15", "GAP_AND_GO"],
  },
  {
    id: "mid_morning",
    label: "Mid-Morning",
    time: "11:00 AM ET",
    description: "VWAP reclaims, volume surges",
    defaultStrategies: ["VWAP_RECLAIM", "HIGH_RVOL"],
  },
  {
    id: "extended_hours",
    label: "Extended Hours",
    time: "4:15 PM ET",
    description: "Post-close review for next day",
    defaultStrategies: ["VCP", "VCP_MULTIDAY", "VWAP_RECLAIM", "HIGH_RVOL"],
  },
];

const ALL_STRATEGIES: { id: string; label: string }[] = [
  { id: "VCP", label: "Momentum Breakout" },
  { id: "VCP_MULTIDAY", label: "Power Breakout" },
  { id: "CLASSIC_PULLBACK", label: "Trend Pilot" },
  { id: "VWAP_RECLAIM", label: "Institutional Reclaim" },
  { id: "ORB5", label: "Open Drive (5m)" },
  { id: "ORB15", label: "Open Drive (15m)" },
  { id: "HIGH_RVOL", label: "Volume Surge" },
  { id: "GAP_AND_GO", label: "Gap Force" },
  { id: "TREND_CONTINUATION", label: "Trend Continuation" },
  { id: "VOLATILITY_SQUEEZE", label: "Volatility Squeeze" },
];

interface ScanWindowConfig {
  enabled: boolean;
  strategies: string[];
}

type ScanScheduleData = Record<string, ScanWindowConfig>;

function getDefaultSchedule(): ScanScheduleData {
  const schedule: ScanScheduleData = {};
  for (const win of SCAN_WINDOWS) {
    schedule[win.id] = { enabled: true, strategies: [...win.defaultStrategies] };
  }
  return schedule;
}

function buildScheduleFromServer(serverData: any): ScanScheduleData {
  const saved: ScanScheduleData = serverData?.scanSchedule?.windows || {};
  const schedule: ScanScheduleData = {};
  for (const win of SCAN_WINDOWS) {
    schedule[win.id] = saved[win.id] || { enabled: true, strategies: [...win.defaultStrategies] };
  }
  return schedule;
}

function ScanScheduleSection() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [localSchedule, setLocalSchedule] = useState<ScanScheduleData | null>(null);

  const { data: agentSettings, isLoading } = useQuery<any>({
    queryKey: ["/api/agent-settings"],
  });

  useEffect(() => {
    if (agentSettings && !localSchedule) {
      setLocalSchedule(buildScheduleFromServer(agentSettings));
    }
  }, [agentSettings]);

  const schedule = localSchedule || buildScheduleFromServer(agentSettings);

  const updateSchedule = useMutation({
    mutationFn: async (newSchedule: ScanScheduleData) => {
      const res = await apiRequest("PUT", "/api/agent-settings", {
        scanSchedule: { windows: newSchedule },
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-settings"] });
    },
    onError: (error: any) => {
      console.error("[ScanSchedule] Save error:", error?.message || error);
      setLocalSchedule(buildScheduleFromServer(agentSettings));
      toast({ title: "Failed to save scan schedule", description: error?.message || "Unknown error", variant: "destructive" });
    },
  });

  const applyUpdate = (newSchedule: ScanScheduleData) => {
    setLocalSchedule(newSchedule);
    updateSchedule.mutate(newSchedule);
  };

  const toggleWindow = (windowId: string) => {
    const updated = { ...schedule };
    updated[windowId] = { ...updated[windowId], enabled: !updated[windowId].enabled };
    applyUpdate(updated);
  };

  const toggleStrategy = (windowId: string, strategyId: string) => {
    const updated = { ...schedule };
    const win = { ...updated[windowId] };
    if (win.strategies.includes(strategyId)) {
      if (win.strategies.length <= 1) return;
      win.strategies = win.strategies.filter(s => s !== strategyId);
    } else {
      win.strategies = [...win.strategies, strategyId];
    }
    updated[windowId] = win;
    applyUpdate(updated);
  };

  const resetToDefaults = () => {
    const defaults = getDefaultSchedule();
    applyUpdate(defaults);
  };

  const enabledCount = Object.values(schedule).filter(w => w.enabled).length;

  return (
    <Card data-testid="section-scan-schedule">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="cursor-pointer" onClick={() => setIsOpen(!isOpen)} data-testid="button-toggle-scan-schedule">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Scan Schedule
            </span>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="badge-scan-windows-count">
                {enabledCount}/{SCAN_WINDOWS.length} active
              </Badge>
              <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
            </div>
          </CardTitle>
          <CardDescription>
            Choose when the autopilot scans for setups and which strategies to use at each time.
          </CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded" />)}
              </div>
            ) : (
              <>
                {SCAN_WINDOWS.map(win => {
                  const config = schedule[win.id];
                  return (
                    <div
                      key={win.id}
                      className={cn(
                        "border rounded-lg p-4 transition-colors",
                        config.enabled ? "bg-card" : "bg-muted/30 opacity-60"
                      )}
                      data-testid={`scan-window-${win.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={config.enabled}
                            onCheckedChange={() => toggleWindow(win.id)}
                            disabled={updateSchedule.isPending}
                            data-testid={`switch-window-${win.id}`}
                          />
                          <div>
                            <div className="font-medium text-sm flex items-center gap-2">
                              {win.label}
                              <Badge variant="outline" className="text-xs font-normal" data-testid={`badge-time-${win.id}`}>
                                {win.time}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{win.description}</p>
                          </div>
                        </div>
                      </div>
                      {config.enabled && (
                        <div className="ml-12 mt-2 flex flex-wrap gap-2" data-testid={`strategies-${win.id}`}>
                          {ALL_STRATEGIES.map(strat => {
                            const isActive = config.strategies.includes(strat.id);
                            const isOnly = isActive && config.strategies.length === 1;
                            return (
                              <button
                                key={strat.id}
                                onClick={() => toggleStrategy(win.id, strat.id)}
                                disabled={updateSchedule.isPending || isOnly}
                                className={cn(
                                  "px-2.5 py-1 text-xs rounded-full border transition-colors",
                                  isActive
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-muted/50 border-transparent text-muted-foreground hover:border-muted-foreground/30"
                                )}
                                title={isOnly ? "At least one strategy required" : undefined}
                                data-testid={`strategy-chip-${win.id}-${strat.id}`}
                              >
                                {strat.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetToDefaults}
                    disabled={updateSchedule.isPending}
                    data-testid="button-reset-schedule"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Reset to Defaults
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function HowScanningWorksInfo() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card data-testid="section-how-scanning-works">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="cursor-pointer" onClick={() => setIsOpen(!isOpen)} data-testid="button-toggle-scanning-info">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              How Autopilot Scanning Works
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="space-y-4 text-sm">
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Scheduled scans run throughout the trading day</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Five scan windows cover the full session: premarket gap analysis (8 AM), swing pattern detection (9:45 AM),
                    opening range breakouts (10 AM), mid-morning momentum (11 AM), and post-close review (4:15 PM). Each window
                    targets strategies best suited for that time of day.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Scan className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <p className="font-medium">Uses the same Scanner engine as the manual Scanner page</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The autopilot runs the exact same pattern detection code as when you manually scan. Results go through
                    the same bullish trend verification. The only difference is it runs automatically on a timer instead of
                    you clicking "Scan Now."
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Settings className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <p className="font-medium">You control which scans run and which strategies are used</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the Scan Schedule section above to enable or disable specific time windows and pick exactly which
                    strategies should be active during each window. Disabled windows are skipped entirely.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Filter className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="font-medium">Results feed into your policy filters before any action</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Scan results are checked against your Auto Agent rules (price range, risk/reward, position limits).
                    In Alerts mode you get notified. In Assisted mode you review and approve. In Autonomous mode,
                    qualifying setups are executed automatically.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground flex gap-2">
              <Shield className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                Scans only run on trading days (Mon-Fri, excluding market holidays) and require an active broker connection for live market data.
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function AutoAgentConfig() {
  return (
    <Card data-testid="section-auto-agent-config">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Auto Agent Setup
        </CardTitle>
        <CardDescription>
          Configure your Auto Agent's trading rules, entry criteria, and position sizing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AutoAgentPanel />
      </CardContent>
    </Card>
  );
}

function BrokerConnectionSection({ isConnected, providerName, isPaper }: {
  isConnected: boolean;
  providerName: string | null;
  isPaper: boolean;
}) {
  return (
    <Card data-testid="section-broker-connection">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-lg">
              {/* Dynamic section number based on context */}
              Broker & Data Connection
            </CardTitle>
            <CardDescription>
              Connect your brokerage for live market data and trade execution.
            </CardDescription>
          </div>
          {isConnected ? (
            <Badge
              variant="outline"
              className={cn(
                isPaper
                  ? "border-amber-500/40 text-amber-500"
                  : "border-green-500/40 text-green-500"
              )}
              data-testid="badge-broker-connected"
            >
              <span className={cn(
                "h-2 w-2 rounded-full mr-1.5",
                isPaper ? "bg-amber-500" : "bg-green-500"
              )} />
              {isPaper ? `Paper: ${providerName}` : `Live: ${providerName}`}
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-broker-disconnected">
              <span className="h-2 w-2 rounded-full bg-muted-foreground mr-1.5" />
              Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {isConnected ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Brokerage connected via OAuth. Your credentials are handled securely by your broker.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              No broker connected. Connect one to enable live data and trade execution.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings">
            <Button variant={isConnected ? "outline" : "default"} className="gap-2" data-testid="button-connect-broker">
              <Link2 className="h-4 w-4" />
              {isConnected ? "Manage Connection" : "Connect Brokerage"}
            </Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Broker credentials are handled via OAuth on the broker's site. VCP Trader never sees your login details.
        </p>
      </CardContent>
    </Card>
  );
}

function SafetyControlsSection({ agentState, settings }: {
  agentState: AgentState | undefined;
  settings: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAckModal, setShowAckModal] = useState(false);

  const enableAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/enable"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      qc.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Automation armed" });
    },
  });

  const disableAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/disable"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Automation disabled" });
    },
  });

  const pauseAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/pause"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Automation paused" });
    },
  });

  const resumeAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/resume"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Automation resumed" });
    },
  });

  const emergencyStop = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/emergency-stop"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "EMERGENCY STOP ACTIVATED", variant: "destructive" });
    },
  });

  const clearEmergencyStop = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/clear-emergency-stop"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Emergency stop cleared" });
    },
  });

  const getStatusBadge = () => {
    if (agentState?.emergencyStop) {
      return <Badge variant="destructive" data-testid="badge-safety-status">EMERGENCY STOP</Badge>;
    }
    if (!agentState?.enabled) {
      return <Badge variant="secondary" data-testid="badge-safety-status">Disabled</Badge>;
    }
    if (agentState?.paused) {
      return <Badge variant="outline" className="border-amber-500 text-amber-500" data-testid="badge-safety-status">Paused</Badge>;
    }
    return <Badge variant="default" className="bg-green-600" data-testid="badge-safety-status">Armed</Badge>;
  };

  const handleArmAttempt = () => {
    if (!settings?.autoAgentAcknowledged) {
      setShowAckModal(true);
    } else {
      enableAgent.mutate();
    }
  };

  return (
    <>
      <Card data-testid="section-safety-controls">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg">Safety & Controls</CardTitle>
              <CardDescription>
                Manage your automation state and safety limits.
              </CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center gap-2 p-4 bg-muted/50 rounded-lg">
                <span className="text-sm font-medium mr-auto">Automation Status</span>
                {agentState?.emergencyStop ? (
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
                ) : !agentState?.enabled ? (
                  <Button
                    size="sm"
                    onClick={handleArmAttempt}
                    disabled={enableAgent.isPending}
                    data-testid="button-arm-automation"
                  >
                    <Power className="h-4 w-4 mr-1" />
                    Arm
                  </Button>
                ) : (
                  <>
                    {agentState?.paused ? (
                      <Button variant="outline" size="sm" onClick={() => resumeAgent.mutate()} disabled={resumeAgent.isPending} data-testid="button-resume">
                        <Play className="h-4 w-4 mr-1" /> Resume
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => pauseAgent.mutate()} disabled={pauseAgent.isPending} data-testid="button-pause">
                        <Pause className="h-4 w-4 mr-1" /> Pause
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => disableAgent.mutate()} disabled={disableAgent.isPending} data-testid="button-disable">
                      <Power className="h-4 w-4 mr-1" /> Disable
                    </Button>
                  </>
                )}
              </div>

              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => emergencyStop.mutate()}
                disabled={emergencyStop.isPending || agentState?.emergencyStop}
                data-testid="button-emergency-stop"
              >
                <AlertTriangle className="h-4 w-4" />
                Emergency Stop
              </Button>

              <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg flex items-center gap-2">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Configure entry criteria, trade sizing, and position limits in the Auto Agent Setup section above.</span>
              </div>
        </CardContent>
      </Card>

      <AcknowledgementGateModal
        open={showAckModal}
        onClose={() => setShowAckModal(false)}
        onConfirm={() => {
          setShowAckModal(false);
          enableAgent.mutate();
        }}
      />
    </>
  );
}

function AcknowledgementGateModal({ open, onClose, onConfirm }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/user/settings", {
        autoAgentAcknowledged: true,
        autoAgentAcknowledgedAt: new Date().toISOString(),
        autoAgentAckVersion: "v2-automation-center",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Automation Armed", description: "Acknowledged and enabled." });
      onConfirm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save acknowledgement.", variant: "destructive" });
    },
  });

  const canConfirm = ack1 && ack2;

  const handleConfirm = () => {
    if (canConfirm) saveMutation.mutate();
  };

  const handleClose = () => {
    setAck1(false);
    setAck2(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Arm Automation
          </DialogTitle>
          <DialogDescription>
            Before enabling automated execution, please review and acknowledge the following.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    User-Controlled Automation
                  </p>
                  <p className="text-muted-foreground">
                    Automation executes based on rules you configure and approve. You maintain full control and responsibility for all activity.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
              onClick={() => setAck1(!ack1)}
              data-testid="checkbox-ack-rules"
            >
              <Checkbox checked={ack1} onCheckedChange={(v) => setAck1(!!v)} />
              <span className="text-sm leading-relaxed">
                I understand automation follows rules I configured and approved.
              </span>
            </div>
            <div
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
              onClick={() => setAck2(!ack2)}
              data-testid="checkbox-ack-monitoring"
            >
              <Checkbox checked={ack2} onCheckedChange={(v) => setAck2(!!v)} />
              <span className="text-sm leading-relaxed">
                I understand I can pause/disable automation at any time and I am responsible for monitoring.
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm || saveMutation.isPending}
            data-testid="button-confirm-arm"
          >
            {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Shield className="h-4 w-4 mr-1" />}
            Arm Automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SkippedTrade {
  id: string;
  userId: string;
  symbol: string;
  skipReason: string;
  source: string;
  price: number | null;
  strategyId: string | null;
  assetType: string | null;
  createdAt: string | null;
}

function SkippedTradesPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { data: skippedTrades, isLoading } = useQuery<SkippedTrade[]>({
    queryKey: ["/api/agent/skipped-trades"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card data-testid="section-skipped-trades">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Recently Skipped Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!skippedTrades || skippedTrades.length === 0) {
    return (
      <Card data-testid="section-skipped-trades">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Recently Skipped Trades
          </CardTitle>
          <CardDescription>
            Trades filtered out by your rules in the last 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-skipped-trades">
            No trades have been skipped in the last 24 hours.
          </div>
        </CardContent>
      </Card>
    );
  }

  const sourceLabel = (source: string) => {
    switch (source) {
      case "eligibility": return "Policy Filter";
      case "authorization": return "Safety Limit";
      case "options_authorization": return "Options Limit";
      case "external_alert": return "Alert Filter";
      default: return source;
    }
  };

  const formatStrategy = (strategyId: string) => {
    const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
      VCP: "Momentum Breakout",
      VCP_MULTIDAY: "Power Breakout",
      CLASSIC_PULLBACK: "Trend Pilot",
      VWAP_RECLAIM: "Institutional Reclaim",
      ORB5: "Open Drive (5m)",
      ORB15: "Open Drive (15m)",
      HIGH_RVOL: "Volume Surge",
      GAP_AND_GO: "Gap Force",
      TREND_CONTINUATION: "Trend Continuation",
      VOLATILITY_SQUEEZE: "Volatility Squeeze",
      "long-options": "Long Options",
      "wheel-strategy": "Wheel Strategy",
      "credit-spreads": "Credit Spreads",
    };
    return STRATEGY_DISPLAY_NAMES[strategyId] || strategyId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <Card data-testid="section-skipped-trades">
      <CardHeader className="cursor-pointer" onClick={() => setIsOpen(!isOpen)} data-testid="button-toggle-skipped-trades">
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Recently Skipped Trades ({skippedTrades.length})
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        </CardTitle>
        <CardDescription>
          Trades filtered out by your rules (last 24h).
        </CardDescription>
      </CardHeader>
      {isOpen && (
        <CardContent>
          <div className="space-y-3">
            {skippedTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                data-testid={`skipped-trade-${trade.id}`}
              >
                <div className="mt-0.5">
                  <XCircle className="h-4 w-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" data-testid={`text-skipped-symbol-${trade.id}`}>
                      {trade.symbol}
                    </span>
                    {trade.assetType && trade.assetType !== "equity" && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-asset-type-${trade.id}`}>
                        {trade.assetType === "option" ? "Option" : trade.assetType === "future" ? "Future" : trade.assetType}
                      </Badge>
                    )}
                    {trade.price != null && (
                      <span className="text-xs text-muted-foreground">
                        ${trade.price.toFixed(2)}
                      </span>
                    )}
                    {trade.strategyId && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-strategy-${trade.id}`}>
                        {formatStrategy(trade.strategyId)}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                      {sourceLabel(trade.source)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed" data-testid={`text-skipped-reason-${trade.id}`}>
                    {trade.skipReason}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  <Clock className="h-3 w-3" />
                  {trade.createdAt ? new Date(trade.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
