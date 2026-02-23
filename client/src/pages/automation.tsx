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
import { Slider } from "@/components/ui/slider";
import {
  Bell, Handshake, Bot, Shield, Settings,
  RefreshCw, CheckCircle2, Link2,
  Power, Pause, Play, AlertTriangle,
  ArrowRight, Info, Zap, Volume2,
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

type AutomationMode = "ALERTS" | "ASSISTED" | "AUTONOMOUS";

const MODE_CARDS: { mode: AutomationMode; title: string; subtitle: string; description: string; icon: typeof Bell; recommended?: string }[] = [
  {
    mode: "ALERTS",
    title: "Alerts Only",
    subtitle: "Get notified. You decide.",
    description: "Receive real-time notifications when opportunities match your criteria. You review and act on each one manually.",
    icon: Bell,
    recommended: "Recommended for new users",
  },
  {
    mode: "ASSISTED",
    title: "Assisted Execution",
    subtitle: "One-click execution with your approval.",
    description: "Opportunities are prepared for you with pre-filled order details. Review, adjust, and approve each trade with a single click.",
    icon: Handshake,
    recommended: "Recommended for most users",
  },
  {
    mode: "AUTONOMOUS",
    title: "Autonomous Trading",
    subtitle: "User-configured automation executes within your limits.",
    description: "Automation evaluates and executes trades based on rules you define. You set the criteria, risk limits, and can pause or stop at any time.",
    icon: Bot,
    recommended: "Advanced",
  },
];

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

  const currentMode: AutomationMode = settings?.automationMode || "ALERTS";
  const currentStatus: string = settings?.automationStatus || "DISABLED";

  const updateSettings = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      return apiRequest("PUT", "/api/user/settings", updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user/settings"] });
    },
  });

  const handleModeChange = (mode: AutomationMode) => {
    updateSettings.mutate({ automationMode: mode });
    toast({ title: `Mode set to ${MODE_CARDS.find(m => m.mode === mode)?.title}` });
  };

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
            Configure how VCP Trader acts on opportunities. Choose your mode, connect your broker, and set your limits.
          </p>
        </div>

        <ModeSelector
          currentMode={currentMode}
          onSelect={handleModeChange}
          isPending={updateSettings.isPending}
        />

        <ModeGuidance
          currentMode={currentMode}
          isConnected={isConnected}
          agentState={agentState}
          settings={settings}
        />

        {currentMode === "AUTONOMOUS" && (
          <AutoAgentConfig />
        )}

        <BrokerConnectionSection
          isConnected={isConnected}
          providerName={providerName}
          isPaper={brokerStatus?.preferredAccountId?.startsWith("sandbox:") ?? false}
        />

        <SafetyControlsSection
          currentMode={currentMode}
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

function ModeSelector({ currentMode, onSelect, isPending }: {
  currentMode: AutomationMode;
  onSelect: (mode: AutomationMode) => void;
  isPending: boolean;
}) {
  return (
    <Card data-testid="section-mode-selector">
      <CardHeader>
        <CardTitle className="text-lg">1. Automation Mode</CardTitle>
        <CardDescription>
          Choose how VCP Trader responds when it finds opportunities that match your criteria.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODE_CARDS.map(({ mode, title, subtitle, description, icon: Icon, recommended }) => {
            const isSelected = currentMode === mode;
            return (
              <div
                key={mode}
                role="button"
                tabIndex={0}
                onClick={() => !isPending && onSelect(mode)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); !isPending && onSelect(mode); }}}
                className={cn(
                  "relative flex flex-col items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors cursor-pointer",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate",
                  isPending && "opacity-50 pointer-events-none",
                )}
                data-testid={`button-mode-${mode.toLowerCase()}`}
              >
                {recommended && (
                  <Badge
                    variant={isSelected ? "default" : "secondary"}
                    className="text-[10px] absolute top-2 right-2 no-default-hover-elevate no-default-active-elevate"
                  >
                    {recommended}
                  </Badge>
                )}
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                {isSelected && (
                  <div className="flex items-center gap-1 text-xs text-primary font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ModeGuidance({ currentMode, isConnected, agentState, settings }: {
  currentMode: AutomationMode;
  isConnected: boolean;
  agentState?: AgentState;
  settings?: any;
}) {
  if (currentMode === "ALERTS") {
    return <AlertsConfigSection isConnected={isConnected} settings={settings} />;
  }
  if (currentMode === "ASSISTED") {
    return <AssistedGuidance isConnected={isConnected} />;
  }
  if (currentMode === "AUTONOMOUS") {
    return <AutonomousGuidance isConnected={isConnected} agentState={agentState} />;
  }
  return null;
}

function AlertsConfigSection({ isConnected, settings }: { isConnected: boolean; settings?: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const pushEnabled = settings?.pushNotificationsEnabled === "true" || settings?.pushNotificationsEnabled === true;
  const breakoutEnabled = settings?.breakoutAlertsEnabled !== "false";
  const stopEnabled = settings?.stopAlertsEnabled !== "false";
  const emaEnabled = settings?.emaAlertsEnabled !== "false";
  const approachingEnabled = settings?.approachingAlertsEnabled !== "false";
  const confidenceMin = settings?.scanConfidenceMin ?? 75;

  const updateSetting = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      return apiRequest("PUT", "/api/user/settings", updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user/settings"] });
    },
  });

  const handleToggle = (key: string, value: boolean) => {
    updateSetting.mutate({ [key]: value });
  };

  const handleEnablePush = async () => {
    try {
      if (!("Notification" in window)) {
        toast({ title: "Not Supported", description: "Push notifications are not supported in this browser.", variant: "destructive" });
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        updateSetting.mutate({ pushNotificationsEnabled: true });
        toast({ title: "Push notifications enabled" });
      } else {
        toast({ title: "Permission Denied", description: "Please allow notifications in your browser settings.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not enable push notifications.", variant: "destructive" });
    }
  };

  return (
    <Card data-testid="section-alerts-config">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Volume2 className="h-5 w-5" />
          2. Alert Preferences
        </CardTitle>
        <CardDescription>
          Choose which alerts you want to receive and how they're delivered.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="p-4 rounded-lg border space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium text-sm">Push Notifications</Label>
            </div>
            {pushEnabled ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-green-500/40 text-green-600 no-default-hover-elevate no-default-active-elevate" data-testid="badge-push-enabled">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Enabled
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => handleToggle("pushNotificationsEnabled", false)} disabled={updateSetting.isPending} data-testid="button-disable-push">
                  Disable
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={handleEnablePush} disabled={updateSetting.isPending} data-testid="button-enable-push">
                Enable
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {pushEnabled
              ? "You'll receive browser notifications when opportunities are detected."
              : "Enable push notifications to get instant alerts when patterns are detected."}
          </p>
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium">Alert Types</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: "breakoutAlertsEnabled", label: "Breakout Alerts", desc: "Price breaks above resistance", enabled: breakoutEnabled },
              { key: "approachingAlertsEnabled", label: "Approaching Entry", desc: "Price nearing entry zone", enabled: approachingEnabled },
              { key: "stopAlertsEnabled", label: "Stop Level Alerts", desc: "Price near stop loss level", enabled: stopEnabled },
              { key: "emaAlertsEnabled", label: "EMA Alerts", desc: "EMA crossover signals", enabled: emaEnabled },
            ].map(({ key, label, desc, enabled }) => (
              <div key={key} className="flex items-center justify-between gap-2 p-3 rounded-lg border">
                <div>
                  <Label className="text-sm">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <SwitchInput
                  checked={enabled}
                  onCheckedChange={(v) => handleToggle(key, v)}
                  disabled={updateSetting.isPending}
                  data-testid={`switch-${key}`}
                />
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-medium">Minimum Confidence</p>
              <p className="text-xs text-muted-foreground">Only alert when pattern score meets this threshold</p>
            </div>
            <Badge variant="secondary" className="font-mono" data-testid="badge-confidence-value">{confidenceMin}%</Badge>
          </div>
          <Slider
            value={[confidenceMin]}
            min={50}
            max={95}
            step={5}
            onValueCommit={([v]) => updateSetting.mutate({ scanConfidenceMin: v })}
            data-testid="slider-confidence"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>More alerts (50%)</span>
            <span>Higher quality (95%)</span>
          </div>
        </div>

        {!isConnected && (
          <>
            <Separator />
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">No broker connected</p>
                <p className="text-xs text-muted-foreground">Connect a brokerage for live price data and faster alerts.</p>
              </div>
              <Button variant="outline" size="sm" asChild data-testid="button-connect-broker-alerts">
                <Link href="/settings">Connect</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssistedGuidance({ isConnected }: { isConnected: boolean }) {
  return (
    <Card data-testid="section-assisted-guidance">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="h-5 w-5" />
          2. How Assisted Execution Works
        </CardTitle>
        <CardDescription>
          Opportunities are prepared for you. Review and execute with InstaTrade™.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {[
            { step: "1", label: "Scans detect opportunities matching your criteria", done: true },
            { step: "2", label: "Connect brokerage for live data and order execution", done: isConnected },
            { step: "3", label: "Review each opportunity on the Discover page", done: true },
            { step: "4", label: "Execute with one click via InstaTrade™", done: true },
          ].map(({ step, label, done }) => (
            <div key={step} className="flex items-center gap-3 text-sm">
              <div className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                done ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"
              )}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : step}
              </div>
              <span className={cn(!done && "text-muted-foreground")}>{label}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {!isConnected && (
            <Button size="sm" asChild data-testid="button-connect-broker-assisted">
              <Link href="/settings">
                <Link2 className="h-4 w-4 mr-1" />
                Connect Brokerage
              </Link>
            </Button>
          )}
          <Button variant={isConnected ? "default" : "outline"} size="sm" asChild data-testid="button-goto-discover">
            <Link href="/discover">
              <ArrowRight className="h-4 w-4 mr-1" />
              Go to Discover
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AutonomousGuidance({ isConnected, agentState }: { isConnected: boolean; agentState?: AgentState }) {
  return (
    <Card data-testid="section-autonomous-guidance">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" />
          2. Autonomous Setup Checklist
        </CardTitle>
        <CardDescription>
          Complete these steps to enable fully automated execution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[
            { label: "Connect your brokerage for execution", done: isConnected, action: !isConnected ? { label: "Connect", href: "/settings" } : undefined },
            { label: "Configure the Auto Agent (entry criteria, sizing, timing)", done: true, note: "See section below" },
            { label: "Set safety limits (daily loss, max positions)", done: true, note: "See Safety & Controls below" },
            { label: "Arm the Auto Agent to begin automated trading", done: !!agentState?.enabled, note: !agentState?.enabled ? "Use the Arm button in Safety & Controls" : undefined },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
              )}
              <span className={cn("flex-1", step.done && "text-muted-foreground")}>{step.label}</span>
              {step.action && !step.done && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" asChild>
                  <Link href={step.action.href}>
                    {step.action.label}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              )}
              {step.note && !step.done && (
                <span className="text-xs text-muted-foreground hidden sm:inline">{step.note}</span>
              )}
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        <HowAutonomousTradingWorks />
      </CardContent>
    </Card>
  );
}

function HowAutonomousTradingWorks() {
  const [isOpen, setIsOpen] = useState(false);

  const steps = [
    {
      icon: Scan,
      title: "Opportunities are discovered",
      description: "The scanner runs at scheduled times throughout the trading day, detecting patterns across multiple strategies (VCP, pullbacks, momentum, etc.). Options scans from the Discover page are also picked up automatically.",
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

function AutoAgentConfig() {
  return (
    <Card data-testid="section-auto-agent-config">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" />
          2. Auto Agent Setup
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

function SafetyControlsSection({ currentMode, agentState, settings }: {
  currentMode: AutomationMode;
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

  const isAutonomous = currentMode === "AUTONOMOUS";

  const getStatusBadge = () => {
    if (!isAutonomous) {
      return <Badge variant="secondary" data-testid="badge-safety-status">N/A</Badge>;
    }
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
                {isAutonomous
                  ? "Manage your automation state and safety limits."
                  : "Safety controls are available in Autonomous mode."}
              </CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isAutonomous ? (
            <>
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
            </>
          ) : (
            <div className="text-center py-8 space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center">
                <Shield className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-sm text-muted-foreground">
                Safety controls are not applicable in <span className="font-medium">{currentMode === "ALERTS" ? "Alerts" : "Assisted"}</span> mode.
              </div>
              <p className="text-xs text-muted-foreground">
                Switch to Autonomous mode to configure automated execution and safety limits.
              </p>
            </div>
          )}
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
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Recently Skipped Trades
        </CardTitle>
        <CardDescription>
          Last {skippedTrades.length} trade{skippedTrades.length !== 1 ? "s" : ""} filtered out by your rules (last 24h).
        </CardDescription>
      </CardHeader>
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
    </Card>
  );
}
