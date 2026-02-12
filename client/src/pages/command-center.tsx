import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { TradingReadinessWizard } from "@/components/trading-readiness-wizard";
import { PriceChart } from "@/components/price-chart";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  LayoutGrid,
  List,
  Newspaper,
  Pause,
  Play,
  Radio,
  Rocket,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Target,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
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

interface NewsArticle {
  title: string;
  source: string;
  date: string;
  url: string;
  imageUrl?: string;
}

interface NewsResponse {
  ok: boolean;
  ticker?: string;
  items?: number;
  articles?: NewsArticle[];
  error?: string;
}

interface ChartData {
  candles: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>;
  ema9?: number[];
  ema21?: number[];
  ema50?: number[];
  resistance?: number;
  stopLevel?: number;
}

type OpportunitySortField = "ticker" | "stage" | "price" | "patternScore";
type OpportunitySortDirection = "asc" | "desc";
type OpportunityViewMode = "card" | "list";

function isMarketOpen(): boolean {
  const now = new Date();
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const hour = parseInt(etParts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(etParts.find((p) => p.type === "minute")?.value || "0");
  const weekday = etParts.find((p) => p.type === "weekday")?.value || "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const timeInMinutes = hour * 60 + minute;
  return timeInMinutes >= 480 && timeInMinutes <= 990;
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
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [scoreFilter, setScoreFilter] = useState<string>("all");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<OpportunitySortField>("patternScore");
  const [sortDirection, setSortDirection] = useState<OpportunitySortDirection>("desc");
  const [viewMode, setViewMode] = useState<OpportunityViewMode>(() => {
    try {
      const stored = localStorage.getItem("opportunities-view-mode");
      return stored === "list" ? "list" : "card";
    } catch { return "card"; }
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
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
    queryKey: ["/api/scan/results"],
  });

  const { data: chartData, isLoading: chartLoading } = useQuery<ChartData>({
    queryKey: ["/api/charts", selectedTicker, "3M"],
    enabled: !!selectedTicker,
  });

  const { data: trades } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
  });

  const { data: newsData } = useQuery<NewsResponse>({
    queryKey: ["/api/news", { ticker: "SPY", items: "5" }],
    queryFn: async () => {
      const response = await fetch(`/api/news?ticker=SPY&items=5`);
      return response.json();
    },
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

  useEffect(() => {
    try { localStorage.setItem("opportunities-view-mode", viewMode); } catch {}
  }, [viewMode]);

  const availableStrategies = useMemo(() => {
    if (!scanResults) return [];
    const strategies = new Set<string>();
    scanResults.forEach(r => { if (r.strategy) strategies.add(r.strategy); });
    return Array.from(strategies).sort();
  }, [scanResults]);

  const handleSortToggle = (field: OpportunitySortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getSortIcon = (field: OpportunitySortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const deduplicatedResults = useMemo(() => {
    if (!scanResults) return [];
    const best = new Map<string, ScanResult>();
    for (const r of scanResults) {
      if ((r.changePercent ?? 0) < -2) continue;
      const e9 = r.ema9 ?? 0;
      const e21 = r.ema21 ?? 0;
      if (e9 > 0 && e21 > 0 && e9 < e21 * 0.98) continue;
      const key = r.ticker;
      const existing = best.get(key);
      if (!existing || (r.patternScore ?? 0) > (existing.patternScore ?? 0)) {
        best.set(key, r);
      }
    }
    return Array.from(best.values());
  }, [scanResults]);

  const filteredSortedResults = useMemo(() => {
    if (!deduplicatedResults.length) return [];
    let filtered = [...deduplicatedResults];

    if (stageFilter !== "all") {
      filtered = filtered.filter(r => r.stage === stageFilter);
    }
    if (scoreFilter === "60") {
      filtered = filtered.filter(r => (r.patternScore ?? 0) >= 60);
    } else if (scoreFilter === "80") {
      filtered = filtered.filter(r => (r.patternScore ?? 0) >= 80);
    }
    if (strategyFilter !== "all") {
      filtered = filtered.filter(r => r.strategy === strategyFilter);
    }

    const stageOrder: Record<string, number> = { BREAKOUT: 0, READY: 1, FORMING: 2 };
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "ticker":
          comparison = (a.ticker || "").localeCompare(b.ticker || "");
          break;
        case "stage":
          comparison = (stageOrder[a.stage] ?? 3) - (stageOrder[b.stage] ?? 3);
          break;
        case "price":
          comparison = (a.price || 0) - (b.price || 0);
          break;
        case "patternScore":
          comparison = (a.patternScore ?? 0) - (b.patternScore ?? 0);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered.slice(0, 10);
  }, [scanResults, stageFilter, scoreFilter, strategyFilter, sortField, sortDirection]);

  const totalFilteredCount = useMemo(() => {
    if (!deduplicatedResults.length) return 0;
    let filtered = [...deduplicatedResults];
    if (stageFilter !== "all") filtered = filtered.filter(r => r.stage === stageFilter);
    if (scoreFilter === "60") filtered = filtered.filter(r => (r.patternScore ?? 0) >= 60);
    else if (scoreFilter === "80") filtered = filtered.filter(r => (r.patternScore ?? 0) >= 80);
    if (strategyFilter !== "all") filtered = filtered.filter(r => r.strategy === strategyFilter);
    return filtered.length;
  }, [deduplicatedResults, stageFilter, scoreFilter, strategyFilter]);

  const selectedResult = useMemo(() => {
    if (!selectedTicker) return null;
    return deduplicatedResults.find(r => r.ticker === selectedTicker) || null;
  }, [selectedTicker, deduplicatedResults]);

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
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle>Today's Top Picks</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode("card")}
                    className={cn("toggle-elevate", viewMode === "card" && "toggle-elevated")}
                    data-testid="button-view-card"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode("list")}
                    className={cn("toggle-elevate", viewMode === "list" && "toggle-elevated")}
                    data-testid="button-view-list"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/discover" data-testid="link-view-all-opportunities">
                      View All
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
              <CardDescription className="flex items-center gap-1">
                <Radio className={cn("h-3 w-3", marketOpen && "text-green-500")} />
                {marketOpen ? "Scanning active" : "Scan paused - Market closed"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2" data-testid="filter-bar-opportunities">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <Select value={stageFilter} onValueChange={setStageFilter}>
                  <SelectTrigger className="w-[120px]" data-testid="select-stage-filter">
                    <SelectValue placeholder="Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    <SelectItem value="FORMING">Forming</SelectItem>
                    <SelectItem value="READY">Ready</SelectItem>
                    <SelectItem value="BREAKOUT">Breakout</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={scoreFilter} onValueChange={setScoreFilter}>
                  <SelectTrigger className="w-[110px]" data-testid="select-score-filter">
                    <SelectValue placeholder="Score" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Scores</SelectItem>
                    <SelectItem value="60">60%+</SelectItem>
                    <SelectItem value="80">80%+</SelectItem>
                  </SelectContent>
                </Select>
                {availableStrategies.length > 0 && (
                  <Select value={strategyFilter} onValueChange={setStrategyFilter}>
                    <SelectTrigger className="w-[130px]" data-testid="select-strategy-filter">
                      <SelectValue placeholder="Strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Strategies</SelectItem>
                      {availableStrategies.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(stageFilter !== "all" || scoreFilter !== "all" || strategyFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setStageFilter("all"); setScoreFilter("all"); setStrategyFilter("all"); }}
                    data-testid="button-clear-filters"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
                <Badge variant="secondary" className="ml-auto text-xs" data-testid="text-results-count">
                  {totalFilteredCount > filteredSortedResults.length
                    ? `Top ${filteredSortedResults.length} of ${totalFilteredCount}`
                    : `${filteredSortedResults.length} result${filteredSortedResults.length !== 1 ? "s" : ""}`}
                </Badge>
              </div>

              {filteredSortedResults.length > 0 ? (
                <ScrollArea className="max-h-[340px]">
                  {viewMode === "list" ? (
                    <Table data-testid="table-opportunities">
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Button variant="ghost" size="sm" onClick={() => handleSortToggle("ticker")} data-testid="button-sort-ticker">
                              Ticker {getSortIcon("ticker")}
                            </Button>
                          </TableHead>
                          <TableHead>
                            <Button variant="ghost" size="sm" onClick={() => handleSortToggle("stage")} data-testid="button-sort-stage">
                              Stage {getSortIcon("stage")}
                            </Button>
                          </TableHead>
                          <TableHead>
                            <Button variant="ghost" size="sm" onClick={() => handleSortToggle("price")} data-testid="button-sort-price">
                              Price {getSortIcon("price")}
                            </Button>
                          </TableHead>
                          <TableHead>
                            <Button variant="ghost" size="sm" onClick={() => handleSortToggle("patternScore")} data-testid="button-sort-score">
                              Score {getSortIcon("patternScore")}
                            </Button>
                          </TableHead>
                          <TableHead className="text-right">Strategy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSortedResults.map((result, idx) => (
                          <TableRow
                            key={result.id || idx}
                            className="cursor-pointer hover-elevate"
                            onClick={() => setSelectedTicker(result.ticker)}
                            data-testid={`row-opportunity-${result.ticker}`}
                          >
                            <TableCell className="font-semibold font-mono">{result.ticker}</TableCell>
                            <TableCell>
                              <Badge
                                variant={result.stage === "BREAKOUT" ? "default" : result.stage === "READY" ? "secondary" : "outline"}
                                className="text-xs"
                              >
                                {result.stage}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono">${result.price?.toFixed(2)}</TableCell>
                            <TableCell>
                              {result.patternScore != null && (
                                <Badge variant="secondary" className="text-xs font-mono">{result.patternScore}%</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {result.strategy && (
                                <Badge variant="outline" className="text-xs">{result.strategy}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1 mb-2">
                        <Button variant="ghost" size="sm" onClick={() => handleSortToggle("ticker")} data-testid="button-sort-ticker-card">
                          Ticker {getSortIcon("ticker")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleSortToggle("stage")} data-testid="button-sort-stage-card">
                          Stage {getSortIcon("stage")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleSortToggle("price")} data-testid="button-sort-price-card">
                          Price {getSortIcon("price")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleSortToggle("patternScore")} data-testid="button-sort-score-card">
                          Score {getSortIcon("patternScore")}
                        </Button>
                      </div>
                      {filteredSortedResults.map((result, idx) => (
                        <div
                          key={result.id || idx}
                          className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                          onClick={() => setSelectedTicker(result.ticker)}
                          data-testid={`card-opportunity-${result.ticker}`}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="font-semibold font-mono">{result.ticker}</div>
                            <Badge
                              variant={result.stage === "BREAKOUT" ? "default" : result.stage === "READY" ? "secondary" : "outline"}
                              className="text-xs"
                            >
                              {result.stage}
                            </Badge>
                            <span className="text-sm text-muted-foreground font-mono">
                              ${result.price?.toFixed(2)}
                            </span>
                            {result.strategy && (
                              <Badge variant="outline" className="text-xs">{result.strategy}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {result.patternScore != null && (
                              <Badge variant="secondary" className="text-xs font-mono">
                                {result.patternScore}%
                              </Badge>
                            )}
                            {actionMode === "ALERTS_ONLY" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} data-testid={`button-alert-${result.ticker}`}>
                                    <Bell className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Set Alert</TooltipContent>
                              </Tooltip>
                            )}
                            {actionMode === "ASSISTED" && (
                              <Button variant="ghost" size="sm" asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                <Link href={`/execution?symbol=${result.ticker}`} data-testid={`link-review-${result.ticker}`}>
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
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
            <CardFooter className="border-t pt-3 flex-col items-start gap-1">
              {totalFilteredCount > filteredSortedResults.length && (
                <p className="text-xs text-muted-foreground">
                  Showing top {filteredSortedResults.length} of {totalFilteredCount} opportunities.{" "}
                  <Link href="/discover" className="text-primary underline underline-offset-2" data-testid="link-discover-footer">
                    View all opportunities on the Discover page
                  </Link>
                </p>
              )}
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Newspaper className="h-5 w-5 text-primary" />
                  <CardTitle>Top Headlines</CardTitle>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/news" data-testid="link-view-all-news">
                    View all
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {newsData?.ok && newsData.articles && newsData.articles.length > 0 ? (
                <div className="space-y-2">
                  {newsData.articles.slice(0, 3).map((article, idx) => (
                    <a
                      key={idx}
                      href={article.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block group"
                      data-testid={`link-headline-${idx}`}
                    >
                      <div className="p-2 rounded-md hover-elevate">
                        <p className="text-sm font-medium line-clamp-2 group-hover:underline">{article.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{article.source}</p>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No headlines available</p>
              )}
            </CardContent>
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

      <Sheet open={!!selectedTicker} onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-chart-drawer">
          <SheetHeader className="pb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <SheetTitle className="font-mono text-xl" data-testid="text-sheet-ticker">
                {selectedTicker}
              </SheetTitle>
              {selectedResult?.stage && (
                <Badge
                  variant={selectedResult.stage === "BREAKOUT" ? "default" : selectedResult.stage === "READY" ? "secondary" : "outline"}
                  data-testid="badge-sheet-stage"
                >
                  {selectedResult.stage}
                </Badge>
              )}
            </div>
            <SheetDescription>
              <span className="flex items-center gap-3 flex-wrap">
                {selectedResult?.price != null && (
                  <span className="font-mono font-semibold text-foreground" data-testid="text-sheet-price">
                    ${selectedResult.price.toFixed(2)}
                  </span>
                )}
                {selectedResult?.patternScore != null && (
                  <Badge variant="secondary" className="text-xs font-mono" data-testid="badge-sheet-score">
                    Score: {selectedResult.patternScore}%
                  </Badge>
                )}
                {selectedResult?.strategy && (
                  <Badge variant="outline" className="text-xs" data-testid="badge-sheet-strategy">
                    {selectedResult.strategy}
                  </Badge>
                )}
              </span>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            {chartLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-[300px] w-full rounded-md" />
                <div className="flex gap-3">
                  <Skeleton className="h-16 flex-1 rounded-md" />
                  <Skeleton className="h-16 flex-1 rounded-md" />
                </div>
              </div>
            ) : chartData?.candles && chartData.candles.length > 0 ? (
              <>
                <PriceChart
                  data={chartData.candles}
                  ema9={chartData.ema9}
                  ema21={chartData.ema21}
                  ema50={chartData.ema50}
                  resistanceLevel={chartData.resistance ?? selectedResult?.resistance ?? undefined}
                  stopLevel={chartData.stopLevel ?? selectedResult?.stopLoss ?? undefined}
                  ticker={selectedTicker || undefined}
                  className="h-[300px]"
                  data-testid="chart-opportunity"
                />
                <div className="grid grid-cols-2 gap-3">
                  {(chartData.resistance ?? selectedResult?.resistance) != null && (
                    <div className="p-3 rounded-lg border">
                      <p className="text-xs text-muted-foreground mb-1">Resistance</p>
                      <p className="font-mono font-semibold text-chart-2" data-testid="text-chart-resistance">
                        ${(chartData.resistance ?? selectedResult?.resistance)?.toFixed(2)}
                      </p>
                    </div>
                  )}
                  {(chartData.stopLevel ?? selectedResult?.stopLoss) != null && (
                    <div className="p-3 rounded-lg border">
                      <p className="text-xs text-muted-foreground mb-1">Stop Level</p>
                      <p className="font-mono font-semibold text-destructive" data-testid="text-chart-stop">
                        ${(chartData.stopLevel ?? selectedResult?.stopLoss)?.toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-[300px] text-center rounded-md border border-dashed bg-muted/20">
                <BarChart3 className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No chart data available</p>
                <p className="text-xs text-muted-foreground mt-1">Chart data could not be loaded for {selectedTicker}</p>
              </div>
            )}

            {selectedResult && (
              <div className="grid grid-cols-3 gap-3 text-sm">
                {selectedResult.rvol != null && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">RVOL</p>
                    <p className={cn("font-mono font-medium", (selectedResult.rvol ?? 0) >= 1.5 && "text-chart-2")} data-testid="text-rvol">
                      {selectedResult.rvol?.toFixed(2)}x
                    </p>
                  </div>
                )}
                {selectedResult.atr != null && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">ATR</p>
                    <p className="font-mono font-medium" data-testid="text-atr">${selectedResult.atr?.toFixed(2)}</p>
                  </div>
                )}
                {selectedResult.changePercent != null && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Change</p>
                    <p className={cn("font-mono font-medium", (selectedResult.changePercent ?? 0) >= 0 ? "text-chart-2" : "text-destructive")} data-testid="text-change">
                      {(selectedResult.changePercent ?? 0) >= 0 ? "+" : ""}{selectedResult.changePercent?.toFixed(2)}%
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2">
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href={`/execution?symbol=${selectedTicker}`} data-testid="link-go-to-execution">
                  <Rocket className="h-4 w-4 mr-1" />
                  Open in Execution Cockpit
                </Link>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <TradingReadinessWizard
        open={showWizard}
        onComplete={() => {
          setShowWizard(false);
          queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
        }}
        onClose={() => setShowWizard(false)}
      />
    </div>
  );
}
