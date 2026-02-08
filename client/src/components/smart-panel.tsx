import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  Shield,
  Zap,
  Target,
  TrendingUp,
  ArrowRight,
  Pause,
  Play,
  Search,
  Settings,
  Lightbulb,
  CheckCircle2,
} from "lucide-react";
import type {
  AgentState,
  Opportunity,
  RiskProfile,
} from "@shared/schema";

interface TickerUniverse {
  id: string;
  name: string;
  description?: string;
}

const STORAGE_KEY = "vcp_smart_panel_collapsed";

export function SmartPanel() {
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isConnected, providerName } = useBrokerStatus();

  const [userPreference, setUserPreference] = useState<boolean | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== null ? stored === "true" : null;
  });

  const [isSmallScreen, setIsSmallScreen] = useState(() => window.innerWidth < 1280);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 1280);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const collapsed = isSmallScreen ? true : (userPreference ?? false);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setUserPreference(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  const { data: riskProfile } = useQuery<RiskProfile>({
    queryKey: ["/api/platform/risk-profile"],
    staleTime: 60000,
  });

  const { data: universes } = useQuery<TickerUniverse[]>({
    queryKey: ["/api/platform/universes"],
    staleTime: 60000,
  });

  const { data: opportunities } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities", { status: "ACTIVE" }],
    staleTime: 30000,
  });

  const { data: agentState } = useQuery<AgentState | null>({
    queryKey: ["/api/agent/state"],
    staleTime: 30000,
  });

  const pauseAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Agent Paused" });
    },
  });

  const resumeAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent/state/resume"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/state"] });
      toast({ title: "Agent Resumed" });
    },
  });

  const topPick = opportunities
    ?.filter((o) => o.status === "ACTIVE")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;

  const hasRiskProfile = !!riskProfile;
  const hasUniverses = (universes?.length ?? 0) > 0;
  const agentEnabled = agentState?.enabled ?? false;
  const agentPaused = agentState?.paused ?? false;

  type NextAction = {
    label: string;
    description: string;
    href: string;
    icon: typeof Wifi;
    variant: "default" | "secondary";
  };

  let nextAction: NextAction;
  if (!isConnected) {
    nextAction = {
      label: "Connect Broker",
      description: "Link your brokerage to enable live data",
      href: "/settings",
      icon: Wifi,
      variant: "default",
    };
  } else if (!hasRiskProfile || !riskProfile?.riskMode) {
    nextAction = {
      label: "Set Risk Profile",
      description: "Define your risk tolerance and limits",
      href: "/settings/risk-profile",
      icon: Shield,
      variant: "default",
    };
  } else if (!hasUniverses) {
    nextAction = {
      label: "Create Universe",
      description: "Build a custom watchlist to scan",
      href: "/settings/universes",
      icon: Target,
      variant: "default",
    };
  } else {
    nextAction = {
      label: "Run Scan",
      description: "You're all set up",
      href: "/discover",
      icon: CheckCircle2,
      variant: "secondary",
    };
  }

  if (collapsed) {
    return (
      <div className="relative flex-shrink-0 w-10 border-r bg-muted/20 hidden md:block">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          className="absolute top-3 left-1/2 -translate-x-1/2"
          data-testid="button-expand-smart-panel"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0 w-[280px] border-r bg-muted/20 hidden md:flex flex-col overflow-hidden" data-testid="smart-panel">
      <div className="flex items-center justify-between p-3 pb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Smart Panel</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          className="h-7 w-7"
          data-testid="button-collapse-smart-panel"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <div className="rounded-md bg-primary/10 p-1.5 mt-0.5">
                <Lightbulb className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-xs font-medium leading-tight">Next Step</p>
                <p className="text-xs text-muted-foreground leading-snug">{nextAction.description}</p>
                <Link href={nextAction.href}>
                  <Button size="sm" variant={nextAction.variant} className="w-full gap-1.5 text-xs" data-testid="button-next-action">
                    <nextAction.icon className="h-3.5 w-3.5" />
                    {nextAction.label}
                    <ArrowRight className="h-3 w-3 ml-auto" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Top Pick</p>
          {topPick ? (
            <Card className="hover-elevate">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm" data-testid="text-top-pick-symbol">{topPick.symbol}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {topPick.score ?? 0}%
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {topPick.detectedPrice && <span>${Number(topPick.detectedPrice).toFixed(2)}</span>}
                  {topPick.pnlPercent != null && (
                    <span className={cn(
                      Number(topPick.pnlPercent) >= 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {Number(topPick.pnlPercent) >= 0 ? "+" : ""}{Number(topPick.pnlPercent).toFixed(1)}%
                    </span>
                  )}
                </div>
                {topPick.strategyName && (
                  <Badge variant="outline" className="text-[10px]">{topPick.strategyName}</Badge>
                )}
                <Link href={`/discover?tab=stocks&ticker=${topPick.symbol}`}>
                  <Button variant="ghost" size="sm" className="w-full text-xs gap-1" data-testid="button-view-top-pick">
                    View Plan <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">No top pick yet — run a scan when market opens.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Broker</p>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <Wifi className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : (
                  <WifiOff className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" data-testid="text-broker-status">
                    {isConnected ? "Connected" : "Disconnected"}
                  </p>
                  {isConnected && providerName && (
                    <p className="text-[10px] text-muted-foreground">{providerName}</p>
                  )}
                </div>
                {!isConnected && (
                  <Link href="/settings">
                    <Button variant="outline" size="sm" className="text-xs h-7" data-testid="button-connect-broker">
                      Connect
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Risk Profile</p>
          <Card>
            <CardContent className="p-3 space-y-1.5">
              {riskProfile?.riskMode ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium capitalize" data-testid="text-risk-mode">
                      {riskProfile.riskMode}
                    </span>
                    <Badge variant={riskProfile.protectionsEnabled ? "default" : "outline"} className="text-[10px]">
                      {riskProfile.protectionsEnabled ? "Protected" : "No Guard"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span>Risk/Trade</span>
                    <span className="text-right font-mono">{riskProfile.riskPerTrade}%</span>
                    <span>Max Deploy</span>
                    <span className="text-right font-mono">{riskProfile.maxDeploy}%</span>
                  </div>
                  <Link href="/settings/risk-profile">
                    <Button variant="ghost" size="sm" className="w-full text-xs gap-1 mt-1" data-testid="button-edit-risk">
                      <Settings className="h-3 w-3" /> Edit
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">No risk profile configured.</p>
                  <Link href="/settings/risk-profile">
                    <Button variant="outline" size="sm" className="w-full text-xs" data-testid="button-setup-risk">
                      Set Up
                    </Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Quick Actions</p>
          <div className="space-y-1.5">
            {agentEnabled && !agentPaused && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
                onClick={() => pauseAgent.mutate()}
                disabled={pauseAgent.isPending}
                data-testid="button-pause-agent"
              >
                <Pause className="h-3.5 w-3.5" /> Pause Agent
              </Button>
            )}
            {agentEnabled && agentPaused && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
                onClick={() => resumeAgent.mutate()}
                disabled={resumeAgent.isPending}
                data-testid="button-resume-agent"
              >
                <Play className="h-3.5 w-3.5" /> Resume Agent
              </Button>
            )}
            {location !== "/discover" && (
              <Link href="/discover">
                <Button variant="ghost" size="sm" className="w-full text-xs gap-1.5" data-testid="button-quick-scan">
                  <Search className="h-3.5 w-3.5" /> Go to Scanner
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
