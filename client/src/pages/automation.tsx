import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { AutoAgentPanel } from "@/components/auto-agent-panel";
import { cn } from "@/lib/utils";
import {
  Bell, Handshake, Bot, Shield, Settings, Zap, ChevronRight,
  ExternalLink, Plus, RefreshCw, CheckCircle2, XCircle, Link2,
  Power, Pause, Play, AlertTriangle, Radio, Copy, Trash2,
  MoreVertical, History, ArrowRight, Info,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { UserSettings } from "@shared/schema";
import { format } from "date-fns";

interface AutomationEndpoint {
  id: string;
  userId: string;
  name: string;
  webhookUrl: string;
  isActive: boolean;
  lastTestedAt?: string;
  lastTestSuccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AgentState {
  userId: string;
  enabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  lastRunAt: string | null;
  tradesTodayCount: number | null;
  dailyPnlEstimate: number | null;
}

const ALGOPILOTX_URL = "https://app.algopilotx.com";

const DISCLAIMER_TEXT = "VCP Trader and AlgoPilotX are software tools for self-directed traders. Educational and informational use only. Not investment advice. No guarantees. Users control all trading decisions and automation.";

type AutomationMode = "ALERTS" | "ASSISTED" | "AUTONOMOUS";
type AutomationEngine = "BUILT_IN" | "ALGOPILOTX";

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

const ENGINE_CARDS: { engine: AutomationEngine; title: string; description: string; icon: typeof Bot }[] = [
  {
    engine: "BUILT_IN",
    title: "Built-in Auto Agent",
    description: "VCP Trader's integrated automation engine. Simpler setup, runs within the platform using your connected broker.",
    icon: Bot,
  },
  {
    engine: "ALGOPILOTX",
    title: "Advanced Automation (AlgoPilotX)",
    description: "Dedicated execution platform with advanced automation rules, position management, and multi-strategy support.",
    icon: Zap,
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

  const { data: endpoints, isLoading: endpointsLoading } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  const { isConnected, providerName, status: brokerStatus } = useBrokerStatus();

  const currentMode: AutomationMode = settings?.automationMode || "ALERTS";
  const currentEngine: AutomationEngine = settings?.automationEngine || "BUILT_IN";
  const currentStatus: string = settings?.automationStatus || "DISABLED";
  const selectedEndpointId: string | null = settings?.selectedAlgopilotxEndpointId || null;

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

  const handleEngineChange = (engine: AutomationEngine) => {
    updateSettings.mutate({ automationEngine: engine });
    toast({ title: `Engine set to ${ENGINE_CARDS.find(e => e.engine === engine)?.title}` });
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
    <div className="flex-1 overflow-auto" data-testid="automation-center-page">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Shield className="h-6 w-6" />
            Automation Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure how VCP Trader acts on opportunities. Choose your mode, connect your tools, and set your limits.
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
          endpoints={endpoints}
          settings={settings}
        />

        {(currentMode === "ASSISTED" || currentMode === "AUTONOMOUS") && (
          <EngineSelector
            currentEngine={currentEngine}
            onSelect={handleEngineChange}
            isPending={updateSettings.isPending}
          />
        )}

        <BrokerConnectionSection
          isConnected={isConnected}
          providerName={providerName}
          isPaper={brokerStatus?.preferredAccountId?.startsWith("sandbox:") ?? false}
        />

        <SafetyControlsSection
          currentMode={currentMode}
          currentEngine={currentEngine}
          agentState={agentState}
          settings={settings}
          endpoints={endpoints}
          endpointsLoading={endpointsLoading}
          selectedEndpointId={selectedEndpointId}
        />

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
              <button
                key={mode}
                onClick={() => onSelect(mode)}
                disabled={isPending}
                className={cn(
                  "relative flex flex-col items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate",
                )}
                data-testid={`button-mode-${mode.toLowerCase()}`}
              >
                {recommended && (
                  <Badge
                    variant={isSelected ? "default" : "secondary"}
                    className="text-[10px] absolute top-2 right-2"
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
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ModeGuidance({ currentMode, isConnected, agentState, endpoints, settings }: {
  currentMode: AutomationMode;
  isConnected: boolean;
  agentState?: AgentState;
  endpoints?: AutomationEndpoint[];
  settings?: any;
}) {
  const steps: { label: string; done: boolean; action?: { label: string; href: string } }[] = [];

  if (currentMode === "ALERTS") {
    steps.push(
      { label: "Connect your brokerage for live data", done: isConnected, action: !isConnected ? { label: "Connect", href: "/settings" } : undefined },
      { label: "Configure your alert preferences in Settings", done: !!settings?.pushEnabled, action: { label: "Settings", href: "/settings" } },
      { label: "View opportunities on the Discover page", done: true, action: { label: "Go to Discover", href: "/discover" } },
    );
  } else if (currentMode === "ASSISTED") {
    steps.push(
      { label: "Connect your brokerage for live data and execution", done: isConnected, action: !isConnected ? { label: "Connect", href: "/settings" } : undefined },
      { label: "Choose an execution engine below", done: true },
      { label: "When opportunities appear, use InstaTrade to execute with one click", done: true, action: { label: "Go to Discover", href: "/discover" } },
    );
  } else if (currentMode === "AUTONOMOUS") {
    const engineType = settings?.automationEngine || "BUILT_IN";
    const hasEndpoints = endpoints && endpoints.length > 0;
    steps.push(
      { label: "Connect your brokerage", done: isConnected, action: !isConnected ? { label: "Connect", href: "/settings" } : undefined },
      { label: "Choose an execution engine below", done: true },
    );
    if (engineType === "ALGOPILOTX") {
      steps.push({ label: "Set up an Automation Profile (webhook)", done: !!hasEndpoints, action: { label: "Manage Profiles", href: "/execution" } });
    }
    steps.push(
      { label: "Configure safety limits in the controls below", done: true },
      { label: "Arm the Auto Agent to begin", done: !!agentState?.enabled, action: !agentState?.enabled ? { label: "Scroll to Controls", href: "#safety" } : undefined },
    );
  }

  const completedCount = steps.filter(s => s.done).length;
  const allDone = completedCount === steps.length;

  return (
    <Card className={cn(allDone ? "border-green-500/30" : "border-primary/30")} data-testid="section-mode-guidance">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
            allDone ? "bg-green-500/10 text-green-600" : "bg-primary/10 text-primary"
          )}>
            {allDone ? <CheckCircle2 className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <p className="font-medium text-sm">
                {allDone
                  ? `${MODE_CARDS.find(m => m.mode === currentMode)?.title} is active and ready.`
                  : `Set up ${MODE_CARDS.find(m => m.mode === currentMode)?.title}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {completedCount} of {steps.length} steps complete
              </p>
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                  )}
                  <span className={cn(step.done && "text-muted-foreground")}>{step.label}</span>
                  {step.action && !step.done && (
                    <Button variant="ghost" size="sm" className="h-6 ml-auto text-xs" asChild>
                      <Link href={step.action.href}>
                        {step.action.label}
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EngineSelector({ currentEngine, onSelect, isPending }: {
  currentEngine: AutomationEngine;
  onSelect: (engine: AutomationEngine) => void;
  isPending: boolean;
}) {
  return (
    <Card data-testid="section-engine-selector">
      <CardHeader>
        <CardTitle className="text-lg">2. Automation Engine</CardTitle>
        <CardDescription>
          Choose which system handles autonomous execution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ENGINE_CARDS.map(({ engine, title, description, icon: Icon }) => {
            const isSelected = currentEngine === engine;
            return (
              <button
                key={engine}
                onClick={() => onSelect(engine)}
                disabled={isPending}
                className={cn(
                  "flex flex-col items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate",
                )}
                data-testid={`button-engine-${engine.toLowerCase()}`}
              >
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">{title}</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
                </div>
                {isSelected && (
                  <div className="flex items-center gap-1 text-xs text-primary font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Selected
                  </div>
                )}
              </button>
            );
          })}
        </div>
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

function SafetyControlsSection({ currentMode, currentEngine, agentState, settings, endpoints, endpointsLoading, selectedEndpointId }: {
  currentMode: AutomationMode;
  currentEngine: AutomationEngine;
  agentState: AgentState | undefined;
  settings: any;
  endpoints: AutomationEndpoint[] | undefined;
  endpointsLoading: boolean;
  selectedEndpointId: string | null;
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

              {currentEngine === "ALGOPILOTX" && (
                <p className="text-xs text-muted-foreground">
                  Emergency Stop disables signal forwarding from VCP Trader. To stop running automations inside AlgoPilotX,{" "}
                  <a href={ALGOPILOTX_URL} target="_blank" rel="noopener noreferrer" className="underline">
                    visit your AlgoPilotX dashboard
                  </a>.
                </p>
              )}

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="advanced">
                  <AccordionTrigger data-testid="button-advanced-settings">
                    <span className="flex items-center gap-2 text-sm">
                      <Settings className="h-4 w-4" />
                      Advanced Settings
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4">
                    {currentEngine === "BUILT_IN" ? (
                      <AutoAgentPanel />
                    ) : (
                      <AlgoPilotXProfilesPanel
                        endpoints={endpoints}
                        endpointsLoading={endpointsLoading}
                        selectedEndpointId={selectedEndpointId}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
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

function AlgoPilotXProfilesPanel({ endpoints, endpointsLoading, selectedEndpointId }: {
  endpoints: AutomationEndpoint[] | undefined;
  endpointsLoading: boolean;
  selectedEndpointId: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState("https://app.algopilotx.com/webhook/");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/automation-endpoints", {
        name: formName,
        webhookUrl: formWebhookUrl,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Automation Profile Created" });
      setDialogOpen(false);
      setFormName("");
      setFormWebhookUrl("https://app.algopilotx.com/webhook/");
      qc.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create profile", description: error.message, variant: "destructive" });
    },
  });

  const selectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PUT", `/api/automation-endpoints/${id}/select`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Profile selected" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/automation-endpoints/${id}/test`);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Connection verified" : "Connection failed",
        description: data.success ? "Webhook is responding" : data.error || "Could not reach endpoint",
        variant: data.success ? "default" : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/automation-endpoints/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Profile removed" });
      setDeleteConfirmId(null);
      qc.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
  });

  const hasEndpoints = endpoints && endpoints.length > 0;

  const wizardSteps = [
    { number: 1, title: "Open AlgoPilotX Dashboard", completed: false },
    { number: 2, title: "Create an automation in AlgoPilotX", completed: false },
    { number: 3, title: "Add profile to VCP Trader", completed: hasEndpoints },
    { number: 4, title: "Select your active profile", completed: !!selectedEndpointId },
  ];

  return (
    <div className="space-y-6" data-testid="algopilotx-profiles">
      <div className="space-y-3">
        <div className="text-sm font-medium">Setup Guide</div>
        <div className="space-y-2">
          {wizardSteps.map((step) => (
            <div key={step.number} className="flex items-center gap-3 text-sm">
              <div className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0",
                step.completed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {step.completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.number}
              </div>
              <span className={step.completed ? "text-muted-foreground line-through" : ""}>{step.title}</span>
              {step.number === 1 && !step.completed && (
                <Button variant="outline" size="sm" onClick={() => window.open(ALGOPILOTX_URL, "_blank")} data-testid="button-open-algopilotx">
                  Open <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Automation Profiles</div>
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} className="gap-1" data-testid="button-add-profile">
            <Plus className="h-3.5 w-3.5" /> Add Profile
          </Button>
        </div>

        {endpointsLoading ? (
          <div className="text-center py-6 text-sm text-muted-foreground">Loading profiles...</div>
        ) : !hasEndpoints ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-muted-foreground">No automation profiles yet.</p>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} data-testid="button-add-first-profile">
              <Plus className="h-4 w-4 mr-1" /> Add Your First Profile
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {endpoints?.map((ep) => {
              const isSelected = selectedEndpointId === ep.id;
              return (
                <div
                  key={ep.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border",
                    isSelected ? "border-primary bg-primary/5" : "border-border"
                  )}
                  data-testid={`profile-card-${ep.id}`}
                >
                  <div className={cn(
                    "h-2.5 w-2.5 rounded-full flex-shrink-0",
                    ep.lastTestSuccess === true ? "bg-green-500" :
                    ep.lastTestSuccess === false ? "bg-red-500" :
                    "bg-muted-foreground"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {ep.name}
                      {isSelected && <Badge variant="default" className="text-[10px]">Active</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{ep.webhookUrl}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isSelected && (
                      <Button size="sm" variant="outline" onClick={() => selectMutation.mutate(ep.id)} disabled={selectMutation.isPending} data-testid={`button-select-${ep.id}`}>
                        Select
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-profile-menu-${ep.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => testMutation.mutate(ep.id)}>
                          <RefreshCw className="h-4 w-4 mr-2" /> Test Connection
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteConfirmId(ep.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!showManualSetup && hasEndpoints && (
        <button
          onClick={() => setShowManualSetup(!showManualSetup)}
          className="text-xs text-muted-foreground underline"
          data-testid="button-toggle-manual-setup"
        >
          Manual Setup (Advanced)
        </button>
      )}

      {showManualSetup && (
        <div className="text-xs text-muted-foreground space-y-2 p-3 bg-muted/50 rounded-lg">
          <p className="font-medium">Manual Webhook Setup</p>
          <p>If you need to manually configure a webhook URL, click "Add Profile" above and paste your AlgoPilotX webhook URL.</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Automation Profile</DialogTitle>
            <DialogDescription>
              Connect an AlgoPilotX automation by pasting its webhook URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input
                id="profile-name"
                placeholder="My Trading Strategy"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://app.algopilotx.com/webhook/..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
                data-testid="input-webhook-url"
              />
              <p className="text-xs text-muted-foreground">
                Find this in your AlgoPilotX automation settings.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formName || !formWebhookUrl || createMutation.isPending}
              data-testid="button-save-profile"
            >
              {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the automation profile and its webhook connection. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
