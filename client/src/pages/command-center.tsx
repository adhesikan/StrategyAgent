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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { TradingReadinessWizard } from "@/components/trading-readiness-wizard";
import { PriceChart } from "@/components/price-chart";
import { StockTradeTicket } from "@/components/stock-trade-ticket";
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
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Filter,
  History,
  LayoutGrid,
  List,
  Newspaper,
  Pause,
  Play,
  Radio,
  Rocket,
  Save,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Target,
  Trash2,
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
import { STRATEGY_CONFIGS, getStrategyDisplayName } from "@shared/strategies";

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

interface CCFilterConfig {
  riskReward: string;
  tradeStatus: string;
  priceMin: string;
  priceMax: string;
  rvolMin: string;
  changeMin: string;
  changeMax: string;
  showCount: string;
}

interface CCFilterPreset {
  id: string;
  name: string;
  filters: CCFilterConfig;
  isDefault: boolean;
}

const DEFAULT_FILTERS: CCFilterConfig = {
  riskReward: "all",
  tradeStatus: "all",
  priceMin: "",
  priceMax: "",
  rvolMin: "",
  changeMin: "",
  changeMax: "",
  showCount: "10",
};

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

  const { data: tokenHealth } = useQuery<{ status: string; expiresAt: string | null; provider: string | null }>({
    queryKey: ["/api/broker/token-health"],
    refetchInterval: 5 * 60 * 1000,
  });

  interface BrokerAccount {
    id: string;
    name: string;
    type: string;
    buyingPower: number;
    equity: number;
    currency: string;
  }

  const { data: brokerAccounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    enabled: brokerStatus?.isConnected === true,
  });

  const selectedBrokerAccount = useMemo(() => {
    if (brokerAccounts.length === 0) return null;
    if (brokerStatus?.preferredAccountId) {
      const preferred = brokerAccounts.find(a => a.id === brokerStatus.preferredAccountId);
      if (preferred) return preferred;
    }
    return brokerAccounts[0];
  }, [brokerAccounts, brokerStatus?.preferredAccountId]);

  const [showTradeTicket, setShowTradeTicket] = useState(false);

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
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const [lastAutoScanTime, setLastAutoScanTime] = useState<Date | null>(null);
  const [autoScanRunning, setAutoScanRunning] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<CCFilterConfig>(DEFAULT_FILTERS);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);

  const autoScanMutation = useMutation({
    mutationFn: async (strategy: string) => {
      setAutoScanRunning(true);
      const response = await apiRequest("POST", "/api/scan/live", {
        strategy: strategy === "all" ? "VCP" : strategy,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scan/results"] });
      setLastAutoScanTime(new Date());
      setAutoScanRunning(false);
    },
    onError: () => {
      setAutoScanRunning(false);
    },
  });

  useEffect(() => {
    if (!brokerStatus?.isConnected) return;

    autoScanMutation.mutate(strategyFilter);

    const interval = setInterval(() => {
      if (!autoScanMutation.isPending) {
        autoScanMutation.mutate(strategyFilter);
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [brokerStatus?.isConnected, strategyFilter]);

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
    return STRATEGY_CONFIGS.map(s => ({ id: s.id, displayName: s.displayName }));
  }, []);

  const savedPresets = useMemo<CCFilterPreset[]>(() => {
    const raw = (userSettings as any)?.ccFilterPresets;
    if (Array.isArray(raw)) return raw;
    return [];
  }, [userSettings]);

  const defaultPresetId = useMemo(() => {
    const def = savedPresets.find(p => p.isDefault);
    return def?.id ?? null;
  }, [savedPresets]);

  useEffect(() => {
    const defaultPreset = savedPresets.find(p => p.isDefault);
    if (defaultPreset) {
      const filters = { ...DEFAULT_FILTERS, ...defaultPreset.filters };
      setAdvancedFilters(filters);
      if (filters.riskReward !== "all" || filters.tradeStatus !== "all" ||
          filters.priceMin || filters.priceMax ||
          filters.rvolMin || filters.changeMin || filters.changeMax ||
          filters.showCount !== "10") {
        setShowAdvancedFilters(true);
      }
    }
  }, [defaultPresetId]);

  const savePresetMutation = useMutation({
    mutationFn: async (presets: CCFilterPreset[]) => {
      const response = await apiRequest("PATCH", "/api/user/settings", {
        ccFilterPresets: presets,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Preset saved", description: "Your filter configuration has been saved." });
    },
  });

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    const newPreset: CCFilterPreset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      filters: { ...advancedFilters },
      isDefault: savedPresets.length === 0,
    };
    savePresetMutation.mutate([...savedPresets, newPreset]);
    setPresetName("");
    setShowSavePreset(false);
  };

  const handleSetDefaultPreset = (presetId: string) => {
    const updated = savedPresets.map(p => ({ ...p, isDefault: p.id === presetId }));
    savePresetMutation.mutate(updated);
  };

  const handleDeletePreset = (presetId: string) => {
    const updated = savedPresets.filter(p => p.id !== presetId);
    savePresetMutation.mutate(updated);
  };

  const handleLoadPreset = (preset: CCFilterPreset) => {
    setAdvancedFilters(preset.filters);
  };

  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (advancedFilters.riskReward !== "all") count++;
    if (advancedFilters.tradeStatus !== "all") count++;
    if (advancedFilters.priceMin) count++;
    if (advancedFilters.priceMax) count++;
    if (advancedFilters.rvolMin) count++;
    if (advancedFilters.changeMin) count++;
    if (advancedFilters.changeMax) count++;
    if (advancedFilters.showCount !== "10") count++;
    return count;
  }, [advancedFilters]);

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

  const getTargetPrice = (result: ScanResult): number | null => {
    if (!result.resistance || !result.stopLoss) return null;
    const baseDepth = result.resistance - result.stopLoss;
    return result.resistance + baseDepth;
  };

  const getRiskReward = (result: ScanResult): number | null => {
    if (!result.resistance || !result.stopLoss || !result.price) return null;
    const target = getTargetPrice(result);
    if (!target) return null;
    const reward = target - result.price;
    const risk = result.price - result.stopLoss;
    if (risk <= 0) return null;
    return reward / risk;
  };

  const getDistanceToEntry = (result: ScanResult): number | null => {
    if (!result.resistance || !result.price) return null;
    return ((result.resistance - result.price) / result.price) * 100;
  };

  const getTradeStatus = (result: ScanResult): string => {
    const distance = getDistanceToEntry(result);
    if (distance === null) return "AWAITING_BREAKOUT";
    if (distance <= 0) return "EXTENDED";
    if (distance <= 1.5) return "IN_ENTRY_ZONE";
    return "AWAITING_BREAKOUT";
  };

  const deduplicatedResults = useMemo(() => {
    if (!scanResults) return [];
    const best = new Map<string, ScanResult>();
    for (const r of scanResults) {
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

    if (advancedFilters.riskReward !== "all") {
      filtered = filtered.filter(r => {
        const rr = getRiskReward(r);
        if (rr === null) return false;
        switch (advancedFilters.riskReward) {
          case "3plus": return rr >= 3;
          case "2plus": return rr >= 2;
          case "1plus": return rr >= 1;
          case "below1": return rr < 1;
          default: return true;
        }
      });
    }

    if (advancedFilters.tradeStatus !== "all") {
      filtered = filtered.filter(r => getTradeStatus(r) === advancedFilters.tradeStatus);
    }

    const priceMin = advancedFilters.priceMin ? parseFloat(advancedFilters.priceMin) : null;
    const priceMax = advancedFilters.priceMax ? parseFloat(advancedFilters.priceMax) : null;
    if (priceMin !== null && !isNaN(priceMin)) {
      filtered = filtered.filter(r => (r.price ?? 0) >= priceMin);
    }
    if (priceMax !== null && !isNaN(priceMax)) {
      filtered = filtered.filter(r => (r.price ?? 0) <= priceMax);
    }

    const rvolMin = advancedFilters.rvolMin ? parseFloat(advancedFilters.rvolMin) : null;
    if (rvolMin !== null && !isNaN(rvolMin)) {
      filtered = filtered.filter(r => (r.rvol ?? 0) >= rvolMin);
    }

    const changeMin = advancedFilters.changeMin ? parseFloat(advancedFilters.changeMin) : null;
    const changeMax = advancedFilters.changeMax ? parseFloat(advancedFilters.changeMax) : null;
    if (changeMin !== null && !isNaN(changeMin)) {
      filtered = filtered.filter(r => (r.changePercent ?? 0) >= changeMin);
    }
    if (changeMax !== null && !isNaN(changeMax)) {
      filtered = filtered.filter(r => (r.changePercent ?? 0) <= changeMax);
    }

    const stageBonus: Record<string, number> = { BREAKOUT: 0.2, READY: 0.1, FORMING: 0 };
    const scored = filtered.map(r => {
      const confidence = (r.patternScore || 0) / 100;
      const rr = getRiskReward(r);
      const rrScore = rr ? Math.min(rr / 3, 1) : 0;
      const volScore = Math.min((r.rvol || 0) / 3, 1);
      let composite = confidence * 0.4 + rrScore * 0.3 + volScore * 0.2 + (stageBonus[r.stage || "FORMING"] || 0);

      const distance = getDistanceToEntry(r);
      const status = getTradeStatus(r);

      if (status === "IN_ENTRY_ZONE") composite += 0.15;
      if (distance !== null && distance > 0 && distance <= 2) composite += 0.1;
      if (rr !== null && rr >= 2) composite += 0.05;

      if (rr !== null && rr < 1) composite *= 0.5;
      if (distance !== null && distance > 5) composite *= 0.4;
      if (status === "EXTENDED") composite *= 0.3;
      if (status === "AWAITING_BREAKOUT" && distance !== null && distance > 3) composite *= 0.6;

      const e9 = r.ema9 ?? 0;
      const e21 = r.ema21 ?? 0;
      if (e9 > 0 && e21 > 0) {
        const emaRatio = e9 / e21;
        if (emaRatio < 0.97) composite *= 0.15;
        else if (emaRatio < 0.99) composite *= 0.5;
        else if (emaRatio < 1.0) composite *= 0.8;
      }
      const chg = r.changePercent ?? 0;
      if (chg < -5) composite *= 0.1;
      else if (chg < -3) composite *= 0.3;
      else if (chg < -1) composite *= 0.7;

      return { result: r, composite };
    });

    if (sortField === "patternScore" || sortField === "stage") {
      scored.sort((a, b) => b.composite - a.composite);
    } else {
      scored.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case "ticker":
            comparison = (a.result.ticker || "").localeCompare(b.result.ticker || "");
            break;
          case "price":
            comparison = (a.result.price || 0) - (b.result.price || 0);
            break;
        }
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    const maxResults = parseInt(advancedFilters.showCount) || 10;
    return scored.slice(0, maxResults).map(s => s.result);
  }, [deduplicatedResults, stageFilter, scoreFilter, strategyFilter, sortField, sortDirection, advancedFilters]);

  const totalFilteredCount = useMemo(() => {
    if (!deduplicatedResults.length) return 0;
    let filtered = [...deduplicatedResults];
    if (stageFilter !== "all") filtered = filtered.filter(r => r.stage === stageFilter);
    if (scoreFilter === "60") filtered = filtered.filter(r => (r.patternScore ?? 0) >= 60);
    else if (scoreFilter === "80") filtered = filtered.filter(r => (r.patternScore ?? 0) >= 80);
    if (strategyFilter !== "all") filtered = filtered.filter(r => r.strategy === strategyFilter);
    if (advancedFilters.riskReward !== "all") {
      filtered = filtered.filter(r => {
        const rr = getRiskReward(r);
        if (rr === null) return false;
        switch (advancedFilters.riskReward) {
          case "3plus": return rr >= 3;
          case "2plus": return rr >= 2;
          case "1plus": return rr >= 1;
          case "below1": return rr < 1;
          default: return true;
        }
      });
    }
    if (advancedFilters.tradeStatus !== "all") {
      filtered = filtered.filter(r => getTradeStatus(r) === advancedFilters.tradeStatus);
    }
    const pMin = advancedFilters.priceMin ? parseFloat(advancedFilters.priceMin) : null;
    const pMax = advancedFilters.priceMax ? parseFloat(advancedFilters.priceMax) : null;
    if (pMin !== null && !isNaN(pMin)) filtered = filtered.filter(r => (r.price ?? 0) >= pMin);
    if (pMax !== null && !isNaN(pMax)) filtered = filtered.filter(r => (r.price ?? 0) <= pMax);
    const rvMin = advancedFilters.rvolMin ? parseFloat(advancedFilters.rvolMin) : null;
    if (rvMin !== null && !isNaN(rvMin)) filtered = filtered.filter(r => (r.rvol ?? 0) >= rvMin);
    const chgMin = advancedFilters.changeMin ? parseFloat(advancedFilters.changeMin) : null;
    const chgMax = advancedFilters.changeMax ? parseFloat(advancedFilters.changeMax) : null;
    if (chgMin !== null && !isNaN(chgMin)) filtered = filtered.filter(r => (r.changePercent ?? 0) >= chgMin);
    if (chgMax !== null && !isNaN(chgMax)) filtered = filtered.filter(r => (r.changePercent ?? 0) <= chgMax);
    return filtered.length;
  }, [deduplicatedResults, stageFilter, scoreFilter, strategyFilter, advancedFilters]);

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
  const automationMode = (userSettings as any)?.automationMode || "ALERTS";
  const automationEngine = (userSettings as any)?.automationEngine || "BUILT_IN";
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
            status={brokerConnected && tokenHealth?.status === "expired" ? "offline" : brokerConnected && tokenHealth?.status === "expiring" ? "warning" : brokerConnected ? "online" : "offline"} 
            label={brokerConnected && tokenHealth?.status === "expired" ? "Token Expired" : brokerConnected && tokenHealth?.status === "expiring" ? "Token Expiring" : brokerConnected ? `${brokerStatus?.provider}` : "No Broker"} 
            icon={brokerConnected && tokenHealth?.status === "expired" ? WifiOff : Wifi}
          />
          <StatusCard 
            status={automationMode === "AUTONOMOUS" ? (agentStatus.status) : "offline"} 
            label={automationMode === "ALERTS" ? "Alerts" : automationMode === "ASSISTED" ? "Assisted" : `Auto: ${agentStatus.label}`}
            icon={automationMode === "AUTONOMOUS" ? Bot : Bell}
          />
        </div>
      </div>

      {brokerConnected && (tokenHealth?.status === "expired" || tokenHealth?.status === "expiring") && (
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-lg border",
          tokenHealth.status === "expired"
            ? "bg-destructive/10 border-destructive/30 text-destructive"
            : "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
        )} data-testid="banner-token-health">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="flex-1 text-sm">
            {tokenHealth.status === "expired" ? (
              <span>Your {tokenHealth.provider} access token has expired. Reconnect in Settings to restore live data.</span>
            ) : (
              <span>Your {tokenHealth.provider} access token expires soon{tokenHealth.expiresAt ? ` (${new Date(tokenHealth.expiresAt).toLocaleTimeString()})` : ""}. Reconnect in Settings to avoid disruption.</span>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings" data-testid="link-reconnect-broker">Reconnect</Link>
          </Button>
        </div>
      )}

      {(() => {
        const modeLabel = automationMode === "ALERTS" ? "Alerts" : automationMode === "ASSISTED" ? "Assisted" : "Autonomous";
        const engineLabel = automationEngine === "BUILT_IN" ? "Built-in" : "AlgoPilotX";
        const needsBroker = automationMode !== "ALERTS";
        const needsAutoCfg = automationMode === "AUTONOMOUS";
        const checklistItems = [
          { label: "Choose automation mode", done: true, link: "/automation" },
          ...(needsBroker ? [{ label: "Connect brokerage", done: brokerConnected, link: "/settings" }] : []),
          ...(needsAutoCfg ? [{ label: "Configure safety limits", done: agentEnabled || (userSettings as any)?.autoAgentAcknowledged, link: "/automation" }] : []),
        ];
        const allDone = checklistItems.every(c => c.done);

        return !allDone ? (
          <Card className="border-primary/50 bg-primary/5" data-testid="card-setup-checklist">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Settings className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Finish Your Setup</CardTitle>
                    <CardDescription>Complete these steps to start using VCP Trader</CardDescription>
                  </div>
                </div>
                <Button asChild data-testid="button-finish-setup">
                  <Link href="/automation">
                    Finish Setup
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {checklistItems.map((item, i) => (
                  <Link href={item.link} key={i}>
                    <div className="flex items-center gap-3 text-sm hover-elevate p-2 rounded-md" data-testid={`checklist-item-${i}`}>
                      {item.done ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/50 flex-shrink-0" />
                      )}
                      <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
                      {!item.done && <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-muted" data-testid="card-status-strip">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Trading Configuration</CardTitle>
                    <CardDescription>Your current automation mode and connections</CardDescription>
                  </div>
                </div>
                <Button variant="outline" asChild data-testid="button-edit-config">
                  <Link href="/automation">
                    <Settings className="h-4 w-4 mr-1" />
                    Automation Center
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border" data-testid="badge-mode">
                  <span className="text-xs text-muted-foreground">Mode:</span>
                  <span className="text-sm font-medium">{modeLabel}</span>
                </div>
                {automationMode === "AUTONOMOUS" && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border" data-testid="badge-engine">
                    <span className="text-xs text-muted-foreground">Engine:</span>
                    <span className="text-sm font-medium">{engineLabel}</span>
                  </div>
                )}
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
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50 border">
        <span className="text-sm font-medium mr-2">Quick Actions:</span>
        
        <Button variant="outline" size="sm" asChild>
          <Link href="/automation" data-testid="link-automation-center">
            <Shield className="h-4 w-4 mr-1" />
            Automation Center
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
                  {autoScanRunning && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Activity className="h-3 w-3 animate-pulse" />
                      Scanning
                    </Badge>
                  )}
                  {!autoScanRunning && lastAutoScanTime && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs gap-1 cursor-help">
                          <Clock className="h-3 w-3" />
                          Live
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Auto-scans every 5 min. Last: {lastAutoScanTime.toLocaleTimeString()}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
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
                <Select value={strategyFilter} onValueChange={setStrategyFilter}>
                  <SelectTrigger className="w-[170px]" data-testid="select-strategy-filter">
                    <SelectValue placeholder="Strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Strategies</SelectItem>
                    {availableStrategies.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Button
                  variant={showAdvancedFilters ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="gap-1"
                  data-testid="button-toggle-advanced-filters"
                >
                  <Filter className="h-3 w-3" />
                  Filters
                  {advancedFilterCount > 0 && (
                    <Badge variant="default" className="text-xs px-1.5 py-0">
                      {advancedFilterCount}
                    </Badge>
                  )}
                </Button>
                <Badge variant="secondary" className="ml-auto text-xs" data-testid="text-results-count">
                  {totalFilteredCount > filteredSortedResults.length
                    ? `Top ${filteredSortedResults.length} of ${totalFilteredCount}`
                    : `${filteredSortedResults.length} result${filteredSortedResults.length !== 1 ? "s" : ""}`}
                </Badge>
              </div>

              {showAdvancedFilters && (
                <div className="border rounded-md p-3 space-y-3" data-testid="panel-advanced-filters">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-medium">Advanced Filters</span>
                    <div className="flex items-center gap-1">
                      {savedPresets.length > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1" data-testid="button-load-preset">
                              <Bookmark className="h-3 w-3" />
                              Presets
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64" align="end">
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Saved Presets</p>
                              <Separator />
                              {savedPresets.map(preset => (
                                <div key={preset.id} className="flex items-center justify-between gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex-1 justify-start gap-1 text-left"
                                    onClick={() => handleLoadPreset(preset)}
                                    data-testid={`button-preset-${preset.id}`}
                                  >
                                    {preset.isDefault && <Check className="h-3 w-3 text-green-500 shrink-0" />}
                                    <span className="truncate">{preset.name}</span>
                                  </Button>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className={cn("h-7 w-7", preset.isDefault && "text-green-500")}
                                          onClick={() => handleSetDefaultPreset(preset.id)}
                                          data-testid={`button-preset-default-${preset.id}`}
                                        >
                                          <Bookmark className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{preset.isDefault ? "Default preset" : "Set as default"}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive"
                                      onClick={() => handleDeletePreset(preset.id)}
                                      data-testid={`button-preset-delete-${preset.id}`}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {showSavePreset ? (
                        <div className="flex items-center gap-1">
                          <Input
                            placeholder="Preset name"
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
                            className="h-8 w-32 text-sm"
                            data-testid="input-preset-name"
                          />
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleSavePreset}
                            disabled={!presetName.trim() || savePresetMutation.isPending}
                            data-testid="button-confirm-save-preset"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowSavePreset(false); setPresetName(""); }}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setShowSavePreset(true)} data-testid="button-save-preset">
                          <Save className="h-3 w-3" />
                          Save
                        </Button>
                      )}
                      {advancedFilterCount > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAdvancedFilters(DEFAULT_FILTERS)}
                          data-testid="button-reset-advanced-filters"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Risk/Reward</Label>
                      <Select value={advancedFilters.riskReward} onValueChange={(v) => setAdvancedFilters(f => ({ ...f, riskReward: v }))}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-rr-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any R:R</SelectItem>
                          <SelectItem value="3plus">3:1+</SelectItem>
                          <SelectItem value="2plus">2:1+</SelectItem>
                          <SelectItem value="1plus">1:1+</SelectItem>
                          <SelectItem value="below1">Below 1:1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Trade Status</Label>
                      <Select value={advancedFilters.tradeStatus} onValueChange={(v) => setAdvancedFilters(f => ({ ...f, tradeStatus: v }))}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-status-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any Status</SelectItem>
                          <SelectItem value="IN_ENTRY_ZONE">In Entry Zone</SelectItem>
                          <SelectItem value="AWAITING_BREAKOUT">Awaiting Breakout</SelectItem>
                          <SelectItem value="EXTENDED">Extended</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Price Range ($)</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="Min"
                          value={advancedFilters.priceMin}
                          onChange={(e) => setAdvancedFilters(f => ({ ...f, priceMin: e.target.value }))}
                          className="h-8 text-sm"
                          data-testid="input-price-min"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          placeholder="Max"
                          value={advancedFilters.priceMax}
                          onChange={(e) => setAdvancedFilters(f => ({ ...f, priceMax: e.target.value }))}
                          className="h-8 text-sm"
                          data-testid="input-price-max"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Show Results</Label>
                      <Select value={advancedFilters.showCount} onValueChange={(v) => setAdvancedFilters(f => ({ ...f, showCount: v }))}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-show-count">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">Top 5</SelectItem>
                          <SelectItem value="10">Top 10</SelectItem>
                          <SelectItem value="15">Top 15</SelectItem>
                          <SelectItem value="25">Top 25</SelectItem>
                          <SelectItem value="50">All (50)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min RVOL</Label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="e.g. 1.5"
                        value={advancedFilters.rvolMin}
                        onChange={(e) => setAdvancedFilters(f => ({ ...f, rvolMin: e.target.value }))}
                        className="h-8 text-sm"
                        data-testid="input-rvol-min"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Change % Range</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="Min %"
                          value={advancedFilters.changeMin}
                          onChange={(e) => setAdvancedFilters(f => ({ ...f, changeMin: e.target.value }))}
                          className="h-8 text-sm"
                          data-testid="input-change-min"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="Max %"
                          value={advancedFilters.changeMax}
                          onChange={(e) => setAdvancedFilters(f => ({ ...f, changeMax: e.target.value }))}
                          className="h-8 text-sm"
                          data-testid="input-change-max"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
                                <Badge variant="outline" className="text-xs">{getStrategyDisplayName(result.strategy)}</Badge>
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
                              <Badge variant="outline" className="text-xs">{getStrategyDisplayName(result.strategy)}</Badge>
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
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-chart-drawer">
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
              {selectedResult?.patternScore != null && (
                <Badge variant="secondary" className="text-xs font-mono" data-testid="badge-sheet-score">
                  Score: {selectedResult.patternScore}
                </Badge>
              )}
            </div>
            <SheetDescription>
              <span className="flex items-center gap-3 flex-wrap">
                {selectedResult?.price != null && (
                  <span className="font-mono font-semibold text-foreground text-lg" data-testid="text-sheet-price">
                    ${selectedResult.price.toFixed(2)}
                  </span>
                )}
                {selectedResult?.changePercent != null && (
                  <span className={cn("font-mono text-sm font-medium", (selectedResult.changePercent ?? 0) >= 0 ? "text-green-500" : "text-destructive")}>
                    {(selectedResult.changePercent ?? 0) >= 0 ? "+" : ""}{selectedResult.changePercent?.toFixed(2)}%
                  </span>
                )}
                {selectedResult?.strategy && (
                  <Badge variant="outline" className="text-xs" data-testid="badge-sheet-strategy">
                    {getStrategyDisplayName(selectedResult.strategy)}
                  </Badge>
                )}
              </span>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            {chartLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-[400px] w-full rounded-md" />
                <div className="flex gap-3">
                  <Skeleton className="h-16 flex-1 rounded-md" />
                  <Skeleton className="h-16 flex-1 rounded-md" />
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
                  className="h-[400px]"
                  data-testid="chart-opportunity"
                />
                <div className="grid grid-cols-4 gap-3">
                  {(chartData.resistance ?? selectedResult?.resistance) != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="p-3 rounded-lg border cursor-help">
                          <p className="text-xs text-muted-foreground mb-1">Resistance</p>
                          <p className="font-mono font-semibold text-chart-2" data-testid="text-chart-resistance">
                            ${(chartData.resistance ?? selectedResult?.resistance)?.toFixed(2)}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Price level where selling pressure has historically prevented further upside. A breakout above this level signals potential continuation.</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {(chartData.stopLevel ?? selectedResult?.stopLoss) != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="p-3 rounded-lg border cursor-help">
                          <p className="text-xs text-muted-foreground mb-1">Stop Loss</p>
                          <p className="font-mono font-semibold text-destructive" data-testid="text-chart-stop">
                            ${(chartData.stopLevel ?? selectedResult?.stopLoss)?.toFixed(2)}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Suggested exit price to limit downside risk. Placed below a key support level to protect against adverse moves.</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {selectedResult?.rvol != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="p-3 rounded-lg border cursor-help">
                          <p className="text-xs text-muted-foreground mb-1">RVOL</p>
                          <p className={cn("font-mono font-semibold", (selectedResult.rvol ?? 0) >= 1.5 && "text-chart-2")} data-testid="text-rvol">
                            {selectedResult.rvol?.toFixed(2)}x
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Relative Volume compared to average. Above 1.5x indicates unusual activity and stronger conviction behind the move.</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {selectedResult?.atr != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="p-3 rounded-lg border cursor-help">
                          <p className="text-xs text-muted-foreground mb-1">ATR (14)</p>
                          <p className="font-mono font-semibold" data-testid="text-atr">${selectedResult.atr?.toFixed(2)}</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Average True Range over 14 periods. Measures daily price volatility to help size positions and set realistic stop distances.</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-center rounded-md border border-dashed bg-muted/20">
                <BarChart3 className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No chart data available</p>
                <p className="text-xs text-muted-foreground mt-1">Chart data could not be loaded for {selectedTicker}</p>
              </div>
            )}

            {selectedResult && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Technical Analysis</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between cursor-help">
                          <span className="text-muted-foreground">Trend</span>
                          <span className={cn("font-medium", (() => {
                            const e9 = selectedResult.ema9 ?? 0;
                            const e21 = selectedResult.ema21 ?? 0;
                            if (e9 > 0 && e21 > 0) return e9 > e21 ? "text-green-500" : "text-destructive";
                            return "";
                          })())}>
                            {(() => {
                              const e9 = selectedResult.ema9 ?? 0;
                              const e21 = selectedResult.ema21 ?? 0;
                              if (e9 > 0 && e21 > 0) return e9 > e21 ? "Bullish" : "Bearish";
                              return "N/A";
                            })()}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Overall trend direction based on EMA crossover. Bullish when the 9-day EMA is above the 21-day EMA.</p>
                      </TooltipContent>
                    </Tooltip>
                    {selectedResult.ema9 != null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex justify-between cursor-help">
                            <span className="text-muted-foreground">EMA 9</span>
                            <span className="font-mono">${selectedResult.ema9.toFixed(2)}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px]">
                          <p>9-period Exponential Moving Average. A fast-moving trend indicator that tracks short-term momentum.</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {selectedResult.ema21 != null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex justify-between cursor-help">
                            <span className="text-muted-foreground">EMA 21</span>
                            <span className="font-mono">${selectedResult.ema21.toFixed(2)}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px]">
                          <p>21-period Exponential Moving Average. An intermediate trend indicator. Price holding above this level confirms a healthy uptrend.</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {(() => {
                      const rr = getRiskReward(selectedResult);
                      return rr != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex justify-between cursor-help">
                              <span className="text-muted-foreground">Risk/Reward</span>
                              <span className={cn("font-mono font-medium", rr >= 2 ? "text-green-500" : rr >= 1 ? "text-foreground" : "text-destructive")}>
                                {rr.toFixed(2)}:1
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[220px]">
                            <p>Ratio of potential profit to potential loss. A ratio of 2:1 or higher means the reward is at least double the risk, which is generally favorable.</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null;
                    })()}
                    {(() => {
                      const dist = getDistanceToEntry(selectedResult);
                      return dist != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex justify-between cursor-help">
                              <span className="text-muted-foreground">To Resistance</span>
                              <span className="font-mono">{dist >= 0 ? "+" : ""}{dist.toFixed(1)}%</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[220px]">
                            <p>How far the current price is from the resistance level. A small positive percentage means the stock is approaching breakout territory.</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null;
                    })()}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between cursor-help">
                          <span className="text-muted-foreground">Status</span>
                          <Badge variant={(() => {
                            const s = getTradeStatus(selectedResult);
                            return s === "IN_ENTRY_ZONE" ? "default" : s === "EXTENDED" ? "destructive" : "secondary";
                          })()} className="text-[10px]">
                            {getTradeStatus(selectedResult).replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        <p>Trade actionability. "Awaiting Breakout" means price hasn't reached resistance yet. "In Entry Zone" means it's at or near the entry. "Extended" means it has moved too far past the entry.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button 
                variant="default" 
                size="sm" 
                className="flex-1" 
                data-testid="button-instatrade-chart"
                disabled={!brokerConnected}
                onClick={() => setShowTradeTicket(true)}
              >
                <Zap className="h-4 w-4 mr-1" />
                InstaTrade™
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <StockTradeTicket
        open={showTradeTicket}
        onOpenChange={setShowTradeTicket}
        scanResult={selectedResult ? {
          ticker: selectedResult.ticker,
          price: selectedResult.price ?? 0,
          resistance: selectedResult.resistance ?? null,
          stopLoss: selectedResult.stopLoss ?? null,
          stage: selectedResult.stage ?? "",
          patternScore: selectedResult.patternScore ?? 0,
          rvol: selectedResult.rvol ?? undefined,
        } : null}
        brokerAccounts={brokerAccounts}
        selectedAccount={selectedBrokerAccount}
        onAccountChange={() => {}}
      />

      <TradingReadinessWizard
        open={showWizard}
        onComplete={() => {
          setShowWizard(false);
          queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
        }}
        onClose={() => setShowWizard(false)}
      />

      <div className="text-xs text-muted-foreground text-center py-4 border-t" data-testid="text-disclaimer">
        VCP Trader and AlgoPilotX are software tools for self-directed traders. Educational and informational use only. Not investment advice. No guarantees. Users control all trading decisions and automation.
      </div>
    </div>
  );
}
