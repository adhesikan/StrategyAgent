import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { 
  Search, Loader2, RefreshCw, List, Info, ChevronDown, ChevronRight, 
  TrendingUp, Layers, Activity, Zap, Target, X, LayoutGrid, LayoutList,
  AlertTriangle, Clock, CheckCircle2, Flame, TrendingDown, BookOpen, ExternalLink,
  ArrowUpDown, Filter, SlidersHorizontal, Sparkles, Circle
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScannerTable } from "@/components/scanner-table";
import { StrategySelector } from "@/components/strategy-selector";
import { TutorialTrigger } from "@/components/interactive-tutorial";
import { WelcomeTutorial } from "@/components/welcome-tutorial";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { ScanResult, ScannerFilters, Watchlist, StrategyInfo, OpportunityDefaults, UserSettings, AutomationEndpoint, SnaptradeConnection } from "@shared/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STRATEGY_CONFIGS, getStrategyDisplayName, FUSION_ENGINE_CONFIG } from "@shared/strategies";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { cn } from "@/lib/utils";
import { Save } from "lucide-react";

type EngineMode = "single" | "fusion";
type TargetType = "watchlist" | "symbol" | "universe";
type MarketSession = "PRE_MARKET" | "REGULAR" | "AFTER_HOURS" | "CLOSED";

function getMarketSession(): { session: MarketSession; label: string; color: string } {
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  
  const parts = etFormatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  
  // Check if weekend
  if (weekday === 'Sat' || weekday === 'Sun') {
    return { session: "CLOSED", label: "Market Closed", color: "text-muted-foreground" };
  }
  
  const timeInMinutes = hour * 60 + minute;
  const preMarketOpen = 4 * 60;     // 4:00 AM
  const marketOpen = 9 * 60 + 30;   // 9:30 AM
  const marketClose = 16 * 60;      // 4:00 PM
  const afterHoursClose = 20 * 60;  // 8:00 PM
  
  if (timeInMinutes >= preMarketOpen && timeInMinutes < marketOpen) {
    return { session: "PRE_MARKET", label: "Pre-Market", color: "text-blue-500" };
  } else if (timeInMinutes >= marketOpen && timeInMinutes < marketClose) {
    return { session: "REGULAR", label: "Market Open", color: "text-chart-2" };
  } else if (timeInMinutes >= marketClose && timeInMinutes < afterHoursClose) {
    return { session: "AFTER_HOURS", label: "After-Hours", color: "text-orange-500" };
  }
  
  return { session: "CLOSED", label: "Market Closed", color: "text-muted-foreground" };
}

interface MarketRegime {
  regime: "TRENDING" | "CHOPPY" | "RISK_OFF";
  slope: number;
  priceAboveEMA: boolean;
  crossFrequency: number;
}

interface ConfluenceResult {
  symbol: string;
  name: string;
  price: number;
  matchedStrategies: string[];
  confluenceScore: number;
  adjustedScore: number;
  primaryStage: string;
  keyLevels: {
    resistance?: number;
    support?: number;
    stop?: number;
  };
  explanation: string;
}

const SCAN_PRESETS = [
  { id: "balanced", name: "Balanced", description: "Default settings for most traders" },
  { id: "conservative", name: "Conservative", description: "Higher liquidity, lower risk" },
  { id: "aggressive", name: "Aggressive", description: "More opportunities, higher risk" },
  { id: "scalp", name: "Scalp", description: "Quick trades, high volume" },
  { id: "swing", name: "Swing", description: "Multi-day holds" },
];

const PRESET_FILTERS: Record<string, Partial<ScannerFilters>> = {
  balanced: { minPrice: 5, maxPrice: 500, minVolume: 500000, minRvol: 1.2, excludeEtfs: true, excludeOtc: true },
  conservative: { minPrice: 10, maxPrice: 500, minVolume: 1000000, minRvol: 1.5, excludeEtfs: true, excludeOtc: true },
  aggressive: { minPrice: 2, maxPrice: 500, minVolume: 200000, minRvol: 1.0, excludeEtfs: true, excludeOtc: true },
  scalp: { minPrice: 5, maxPrice: 200, minVolume: 1000000, minRvol: 1.8, excludeEtfs: true, excludeOtc: true },
  swing: { minPrice: 10, maxPrice: 500, minVolume: 300000, minRvol: 1.0, excludeEtfs: true, excludeOtc: true },
};

interface UniverseData {
  symbols: string[];
  count: number;
}

interface UniverseInfo extends UniverseData {
  name?: string;
  description?: string;
}

interface UniversesResponse {
  dow30: UniverseInfo;
  nasdaq100: UniverseInfo;
  sp500: UniverseInfo;
  all: UniverseInfo;
  options?: Array<{ id: string; name: string; description: string; count: number }>;
}

export default function Scanner() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isConnected, hasDataSource } = useBrokerStatus();

  const [engineMode, setEngineMode] = useState<EngineMode>("single");
  const [selectedStrategy, setSelectedStrategy] = useState<string>("VCP");
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(STRATEGY_CONFIGS.map(s => s.id));
  const [targetType, setTargetType] = useState<TargetType>("watchlist");
  const [selectedWatchlist, setSelectedWatchlist] = useState<string>("default");
  const [symbolInput, setSymbolInput] = useState<string>("");
  const [selectedUniverse, setSelectedUniverse] = useState<string>("sp500");
  const [selectedPreset, setSelectedPreset] = useState<string>("balanced");
    const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStrategyInfo, setShowStrategyInfo] = useState(false);
  
  // Progressive disclosure & coach mark state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [coachDismissed, setCoachDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vcp_opportunity_engine_coach_dismissed') === 'true';
    }
    return false;
  });
  const [scanConfigCollapsed, setScanConfigCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vcp_scan_config_collapsed') !== 'false';
    }
    return true;
  });
  
  const dismissCoachMark = () => {
    setCoachDismissed(true);
    localStorage.setItem('vcp_opportunity_engine_coach_dismissed', 'true');
  };
  
  const toggleScanConfig = () => {
    const newState = !scanConfigCollapsed;
    setScanConfigCollapsed(newState);
    localStorage.setItem('vcp_scan_config_collapsed', String(newState));
  };
  
  const toggleCardExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  
  // Helper to get contextual micro-badge
  const getMicroBadge = (result: ScanResult) => {
    if (result.rvol && result.rvol >= 3) return { text: "Volume expanding", color: "text-chart-2" };
    if (result.changePercent && result.changePercent >= 5) return { text: "Momentum strong", color: "text-orange-500" };
    return { text: "Tight setup", color: "text-muted-foreground" };
  };
  
  // Find top setup (highest patternScore, then highest rvol as tiebreaker)
  const getTopSetup = (results: ScanResult[] | undefined): string | null => {
    if (!results || results.length === 0) return null;
    const breakouts = results.filter(r => r.stage === "BREAKOUT");
    if (breakouts.length === 0) return null;
    
    const sorted = [...breakouts].sort((a, b) => {
      const scoreDiff = (b.patternScore || 0) - (a.patternScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.rvol || 0) - (a.rvol || 0);
    });
    return sorted[0]?.id || null;
  };
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("patternScore");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [minPatternScore, setMinPatternScore] = useState<number | null>(null);
  const [maxResistancePercent, setMaxResistancePercent] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [featuredViewMode, setFeaturedViewMode] = useState<"cards" | "list">("cards");
  const [showFilters, setShowFilters] = useState(false);
  const [filterMinPrice, setFilterMinPrice] = useState<number | null>(null);
  const [filterMaxPrice, setFilterMaxPrice] = useState<number | null>(null);
  const [filterMinVolume, setFilterMinVolume] = useState<number | null>(null);
  const [filterMinRvol, setFilterMinRvol] = useState<number | null>(null);
  const [filterMinUpside, setFilterMinUpside] = useState<number | null>(null);
  const [filters, setFilters] = useState<ScannerFilters>({
    minPrice: 5,
    maxPrice: 500,
    minVolume: 500000,
    minRvol: 1.2,
    excludeEtfs: true,
    excludeOtc: true,
  });
  
  const [liveResults, setLiveResults] = useState<ScanResult[] | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [confluenceResults, setConfluenceResults] = useState<ConfluenceResult[] | null>(null);
  const [marketRegime, setMarketRegime] = useState<MarketRegime | null>(null);
  const [scanMetadata, setScanMetadata] = useState<{
    isLive: boolean;
    provider: string;
    symbolsRequested: number;
    symbolsReturned: number;
    scanTimeMs: number;
    batchCount?: number;
  } | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [autoRunOnLoad, setAutoRunOnLoad] = useState(false);
  const [shouldAutoRun, setShouldAutoRun] = useState(false);
  const [initialScanDone, setInitialScanDone] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // Default Off to prevent unwanted automation triggers

  const { data: strategies } = useQuery<StrategyInfo[]>({
    queryKey: ["/api/strategies"],
  });

  const { data: userDefaults, isLoading: defaultsLoading } = useQuery<OpportunityDefaults | null>({
    queryKey: ["/api/user/opportunity-defaults"],
  });

  const { data: watchlists, isLoading: watchlistsLoading } = useQuery<Watchlist[]>({
    queryKey: ["/api/watchlists"],
  });

  const { data: storedResults, isLoading, refetch, dataUpdatedAt } = useQuery<ScanResult[]>({
    queryKey: ["/api/scan/results"],
    refetchInterval: autoRefreshInterval > 0 ? autoRefreshInterval : false,
  });

  const { data: universes } = useQuery<UniversesResponse>({
    queryKey: ["/api/universes"],
  });

  const { data: automationEndpoints } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  const { data: snaptradeStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/snaptrade/status"],
  });

  const { data: snaptradeConnections = [] } = useQuery<SnaptradeConnection[]>({
    queryKey: ["/api/snaptrade/connections"],
    enabled: !!snaptradeStatus?.configured,
  });

  const [instaTradeResult, setInstaTradeResult] = useState<ScanResult | null>(null);
  const [showEndpointDialog, setShowEndpointDialog] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<AutomationEndpoint | null>(null);
  const [executionMethod, setExecutionMethod] = useState<"algopilotx" | "snaptrade">("algopilotx");
  const [selectedSnaptradeAccount, setSelectedSnaptradeAccount] = useState<SnaptradeConnection | null>(null);
  const [orderQuantity, setOrderQuantity] = useState<number>(1);

  const hasEndpoints = automationEndpoints && automationEndpoints.length > 0;
  const hasSnaptradeAccounts = snaptradeConnections.length > 0 && snaptradeConnections.some(c => c.isTradingEnabled);

  const instatradeMutation = useMutation({
    mutationFn: async ({ endpointId, result }: { endpointId: string; result: ScanResult }) => {
      const response = await apiRequest("POST", "/api/instatrade/entry", {
        endpointId,
        symbol: result.ticker,
        strategyId: selectedStrategy,
        setupPayload: {
          price: result.price,
          resistance: result.resistance,
          stopLoss: result.stopLoss,
          patternScore: result.patternScore,
          stage: result.stage,
          rvol: result.rvol,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "InstaTrade Sent",
        description: `Entry signal sent for ${instaTradeResult?.ticker}`,
      });
      setShowEndpointDialog(false);
      setInstaTradeResult(null);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
    },
    onError: (error: any) => {
      toast({
        title: "InstaTrade Failed",
        description: error.message || "Could not send entry signal",
        variant: "destructive",
      });
    },
  });

  const snaptradeTradeMutation = useMutation({
    mutationFn: async ({ accountId, result, quantity }: { accountId: string; result: ScanResult; quantity: number }) => {
      const response = await fetch("/api/snaptrade/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          symbol: result.ticker,
          action: "BUY",
          orderType: "Limit",
          quantity,
          price: result.resistance || result.price,
          timeInForce: "Day",
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Order failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Order Placed",
        description: `${data.action} order for ${data.quantity} shares of ${data.symbol} submitted`,
      });
      setShowEndpointDialog(false);
      setInstaTradeResult(null);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
    },
    onError: (error: any) => {
      toast({
        title: "Order Failed",
        description: error.message || "Could not place order",
        variant: "destructive",
      });
    },
  });

  const handleInstaTrade = (result: ScanResult, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setInstaTradeResult(result);
    if (hasEndpoints) {
      setSelectedEndpoint(automationEndpoints![0]);
    }
    if (hasSnaptradeAccounts && !hasEndpoints) {
      setExecutionMethod("snaptrade");
      const tradingAccount = snaptradeConnections.find(c => c.isTradingEnabled);
      if (tradingAccount) setSelectedSnaptradeAccount(tradingAccount);
    } else if (hasSnaptradeAccounts) {
      const tradingAccount = snaptradeConnections.find(c => c.isTradingEnabled);
      if (tradingAccount) setSelectedSnaptradeAccount(tradingAccount);
    }
    setShowEndpointDialog(true);
  };

  const handleConfirmInstaTrade = () => {
    if (executionMethod === "algopilotx" && selectedEndpoint && instaTradeResult) {
      instatradeMutation.mutate({ endpointId: selectedEndpoint.id, result: instaTradeResult });
    } else if (executionMethod === "snaptrade" && selectedSnaptradeAccount && instaTradeResult) {
      snaptradeTradeMutation.mutate({ 
        accountId: selectedSnaptradeAccount.accountId!, 
        result: instaTradeResult, 
        quantity: orderQuantity 
      });
    }
  };

  const UNIVERSE_OPTIONS = [
    { value: "sp500", label: universes?.sp500?.name || "S&P 500", count: universes?.sp500?.count || 500, description: universes?.sp500?.description },
    { value: "nasdaq100", label: universes?.nasdaq100?.name || "Nasdaq 100", count: universes?.nasdaq100?.count || 100, description: universes?.nasdaq100?.description },
    { value: "dow30", label: universes?.dow30?.name || "Dow 30", count: universes?.dow30?.count || 30, description: universes?.dow30?.description },
    { value: "all", label: universes?.all?.name || "All Major Indices", count: universes?.all?.count || 550, description: universes?.all?.description },
  ];

  useEffect(() => {
    if (dataUpdatedAt && storedResults && storedResults.length > 0 && !liveResults) {
      setLastScanTime(new Date(dataUpdatedAt));
    }
  }, [dataUpdatedAt, storedResults, liveResults]);

  useEffect(() => {
    if (userDefaults && !defaultsApplied && !defaultsLoading && !watchlistsLoading) {
      if (userDefaults.defaultMode) {
        setEngineMode(userDefaults.defaultMode as EngineMode);
      }
      if (userDefaults.defaultStrategyId) {
        setSelectedStrategy(userDefaults.defaultStrategyId);
      }
      if (userDefaults.defaultScanScope) {
        setTargetType(userDefaults.defaultScanScope as TargetType);
      }
      if (userDefaults.defaultWatchlistId) {
        const watchlistExists = watchlists?.some(w => w.id === userDefaults.defaultWatchlistId);
        if (watchlistExists) {
          setSelectedWatchlist(userDefaults.defaultWatchlistId);
        } else if (userDefaults.defaultWatchlistId !== "default") {
          toast({
            title: "Saved watchlist not found",
            description: "Using Default Watchlist instead",
          });
        }
      }
      if (userDefaults.defaultSymbol) {
        setSymbolInput(userDefaults.defaultSymbol);
      }
      if (userDefaults.defaultMarketIndex) {
        setSelectedUniverse(userDefaults.defaultMarketIndex);
      }
      if (userDefaults.defaultFilterPreset) {
        applyPreset(userDefaults.defaultFilterPreset);
      }
      if (userDefaults.autoRunOnLoad) {
        setAutoRunOnLoad(true);
        setShouldAutoRun(true);
      }
      setDefaultsApplied(true);
    }
  }, [userDefaults, defaultsApplied, defaultsLoading, watchlistsLoading, watchlists]);

  useEffect(() => {
    if (shouldAutoRun && defaultsApplied && hasDataSource && !runScanMutation.isPending && !confluenceMutation.isPending) {
      setShouldAutoRun(false);
      if (engineMode === "fusion") {
        confluenceMutation.mutate();
      } else {
        runScanMutation.mutate();
      }
    }
  }, [shouldAutoRun, defaultsApplied, hasDataSource, engineMode]);

  // Auto-run scan on page load ONLY if user has explicitly enabled autoRunOnLoad
  // This prevents unwanted automation triggers on every page refresh
  useEffect(() => {
    const shouldRun = !initialScanDone && 
                      hasDataSource && 
                      !defaultsLoading && 
                      !watchlistsLoading &&
                      !runScanMutation.isPending && 
                      !confluenceMutation.isPending;
    
    if (shouldRun) {
      setInitialScanDone(true);
      // Only auto-run if user has explicitly saved defaults with autoRunOnLoad enabled
      // This prevents unexpected automation triggers on page refresh
      const hasAutoRunDefaults = userDefaults?.autoRunOnLoad;
      if (hasAutoRunDefaults) {
        setTimeout(() => {
          if (engineMode === "fusion") {
            confluenceMutation.mutate();
          } else {
            runScanMutation.mutate();
          }
        }, 500);
      }
      // If autoRunOnLoad is not enabled, user must manually click "Run Scan"
    }
  }, [initialScanDone, isConnected, defaultsLoading, watchlistsLoading, userDefaults, engineMode]);

  const saveDefaultsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", "/api/user/opportunity-defaults", {
        defaultMode: engineMode,
        defaultStrategyId: selectedStrategy,
        defaultScanScope: targetType,
        defaultWatchlistId: targetType === "watchlist" ? selectedWatchlist : null,
        defaultSymbol: targetType === "symbol" ? symbolInput : null,
        defaultMarketIndex: targetType === "universe" ? selectedUniverse : null,
        defaultFilterPreset: selectedPreset,
        autoRunOnLoad,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/opportunity-defaults"] });
      toast({
        title: "Default scan saved",
        description: "Your settings will be applied when you return",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to save defaults",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRowClick = (result: ScanResult) => {
    navigate(`/charts/${result.ticker}`);
  };

  const getSymbolsForTarget = (): string[] | undefined => {
    if (targetType === "symbol" && symbolInput.trim()) {
      return symbolInput.toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
    }
    if (targetType === "watchlist") {
      if (selectedWatchlist === "default") return undefined;
      const wl = watchlists?.find(w => w.id === selectedWatchlist);
      return wl?.symbols || undefined;
    }
    if (targetType === "universe" && universes) {
      type UniverseKey = "dow30" | "nasdaq100" | "sp500" | "all";
      const universeKey = selectedUniverse as UniverseKey;
      return universes[universeKey]?.symbols || undefined;
    }
    return undefined;
  };

  const applyPreset = (presetId: string) => {
    const presetFilters = PRESET_FILTERS[presetId];
    if (presetFilters) {
      setFilters(prev => ({ ...prev, ...presetFilters }));
    }
    setSelectedPreset(presetId);
  };

  const runScanMutation = useMutation({
    mutationFn: async () => {
      const symbols = getSymbolsForTarget();
      
      const response = await apiRequest("POST", "/api/scan/live", { 
        symbols, 
        strategy: selectedStrategy,
        filters,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.results && Array.isArray(data.results)) {
        setLiveResults(data.results);
        setLastScanTime(new Date());
        setScanMetadata(data.metadata || null);
        toast({
          title: "Scan Complete",
          description: `Found ${data.results.length} opportunities from ${data.metadata?.provider || "broker"}`,
        });
      } else if (Array.isArray(data)) {
        setLiveResults(data);
        setLastScanTime(new Date());
        setScanMetadata(null);
        toast({
          title: "Scan Complete",
          description: `Found ${data.length} opportunities`,
        });
      } else {
        toast({
          title: "Scan Failed",
          description: data.error || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Scan Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const confluenceMutation = useMutation({
    mutationFn: async () => {
      const symbols = getSymbolsForTarget();
      
      const response = await apiRequest("POST", "/api/scan/confluence", {
        strategies: selectedStrategies,
        symbols,
        minMatches: 2,
        ...filters,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setConfluenceResults(data.results);
      setMarketRegime(data.marketRegime);
      toast({
        title: "Fusion Scan Complete",
        description: `Found ${data.results?.length || 0} confluence opportunities`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Fusion Scan Failed",
        description: error.message || "Failed to run multi-strategy scan",
        variant: "destructive",
      });
    },
  });

  // Auto-scan when filter/strategy selection changes (debounced)
  const autoScanTimeoutRef = useRef<number | null>(null);
  const lastScannedParamsRef = useRef<string | null>(null);
  const [needsRescanAfterPending, setNeedsRescanAfterPending] = useState(false);
  
  // Serialize scan parameters for comparison
  const scanParamsKey = JSON.stringify({
    engineMode,
    selectedStrategy,
    selectedStrategies,
    targetType,
    selectedWatchlist,
    symbolInput,
    selectedUniverse,
    filters,
    selectedPreset,
  });
  
  const isScanning = runScanMutation.isPending || confluenceMutation.isPending;
  
  // Execute scan with current live state
  const doScan = () => {
    lastScannedParamsRef.current = scanParamsKey;
    setNeedsRescanAfterPending(false);
    
    if (engineMode === "fusion") {
      if (selectedStrategies.length >= 2) {
        confluenceMutation.mutate();
      }
    } else {
      runScanMutation.mutate();
    }
  };
  
  // Effect 1: Debounce parameter changes
  useEffect(() => {
    // Skip if not ready or not connected
    if (!initialScanDone || !isConnected) return;
    
    // On first run, mark current params as "scanned" (initial scan already ran)
    if (lastScannedParamsRef.current === null) {
      lastScannedParamsRef.current = scanParamsKey;
      return;
    }
    
    // Skip if params haven't actually changed from last scan
    if (lastScannedParamsRef.current === scanParamsKey) {
      // If we were waiting for rescan but user reverted, cancel it
      setNeedsRescanAfterPending(false);
      return;
    }
    
    // Clear any pending debounce timer
    if (autoScanTimeoutRef.current !== null) {
      window.clearTimeout(autoScanTimeoutRef.current);
      autoScanTimeoutRef.current = null;
    }
    
    // Debounce: wait 600ms then execute or mark for later
    autoScanTimeoutRef.current = window.setTimeout(() => {
      autoScanTimeoutRef.current = null;
      
      if (runScanMutation.isPending || confluenceMutation.isPending) {
        // Scan in progress - mark that we need rescan when it settles
        setNeedsRescanAfterPending(true);
      } else {
        // Execute immediately with current live state
        doScan();
      }
    }, 600);
    
    return () => {
      if (autoScanTimeoutRef.current !== null) {
        window.clearTimeout(autoScanTimeoutRef.current);
        autoScanTimeoutRef.current = null;
      }
    };
  }, [scanParamsKey, initialScanDone, isConnected]);
  
  // Effect 2: Execute pending rescan when mutations settle (uses current live state)
  useEffect(() => {
    if (!needsRescanAfterPending) return;
    if (runScanMutation.isPending || confluenceMutation.isPending) return;
    
    // Mutations settled - check if current params differ from last scanned
    if (lastScannedParamsRef.current !== scanParamsKey) {
      // Execute scan with current live state
      doScan();
    } else {
      // Params same as last scan, no need to rescan
      setNeedsRescanAfterPending(false);
    }
  }, [needsRescanAfterPending, isScanning, scanParamsKey]);

  const handleRunScan = () => {
    if (!isConnected) {
      toast({
        title: "Not Connected",
        description: "Please connect your brokerage in Settings first",
        variant: "destructive",
      });
      return;
    }

    if (engineMode === "single") {
      runScanMutation.mutate();
    } else {
      if (selectedStrategies.length < 2) {
        toast({
          title: "Select More Strategies",
          description: "Fusion Engine requires at least 2 strategies",
          variant: "destructive",
        });
        return;
      }
      confluenceMutation.mutate();
    }
  };

  const rawResults = liveResults || storedResults;
  
  const getResistancePercent = (result: ScanResult) => {
    if (!result.resistance || !result.price) return null;
    return ((result.resistance - result.price) / result.price) * 100;
  };
  
  const filteredResults = rawResults?.filter(r => {
    // Text search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!r.ticker.toLowerCase().includes(query) && !r.name?.toLowerCase().includes(query)) {
        return false;
      }
    }
    // Stage filter
    if (stageFilter !== "all") {
      const stage = r.stage?.toUpperCase();
      if (stageFilter === "breakout" && stage !== "BREAKOUT") return false;
      if (stageFilter === "ready" && stage !== "READY") return false;
      if (stageFilter === "forming" && stage !== "FORMING") return false;
    }
    // Pattern score filter
    if (minPatternScore !== null && (r.patternScore ?? 0) < minPatternScore) {
      return false;
    }
    // Resistance % filter
    if (maxResistancePercent !== null) {
      const resistPct = getResistancePercent(r);
      if (resistPct === null || resistPct > maxResistancePercent) {
        return false;
      }
    }
    // Price range filter
    if (filterMinPrice !== null && (r.price ?? 0) < filterMinPrice) return false;
    if (filterMaxPrice !== null && (r.price ?? 0) > filterMaxPrice) return false;
    // Volume filter
    if (filterMinVolume !== null && (r.volume ?? 0) < filterMinVolume) return false;
    // RVOL filter
    if (filterMinRvol !== null && (r.rvol ?? 0) < filterMinRvol) return false;
    // Upside % filter
    if (filterMinUpside !== null) {
      const upside = getResistancePercent(r);
      if (upside === null || upside < filterMinUpside) return false;
    }
    return true;
  })?.sort((a, b) => {
    let aVal: number | null = 0;
    let bVal: number | null = 0;
    switch (sortBy) {
      case "patternScore":
        aVal = a.patternScore ?? null;
        bVal = b.patternScore ?? null;
        break;
      case "resistancePercent":
        aVal = getResistancePercent(a);
        bVal = getResistancePercent(b);
        break;
      case "price":
        aVal = a.price ?? null;
        bVal = b.price ?? null;
        break;
      case "volume":
        aVal = a.volume ?? null;
        bVal = b.volume ?? null;
        break;
      case "rvol":
        aVal = a.rvol ?? null;
        bVal = b.rvol ?? null;
        break;
      case "changePercent":
        aVal = a.changePercent ?? null;
        bVal = b.changePercent ?? null;
        break;
    }
    // Push nulls to the bottom regardless of sort order
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
  });

  const triggeredCount = filteredResults?.filter(r => {
    const stage = r.stage?.toUpperCase();
    return stage === "BREAKOUT";
  }).length || 0;
  const readyCount = filteredResults?.filter(r => r.stage?.toUpperCase() === "READY").length || 0;
  const formingCount = filteredResults?.filter(r => r.stage?.toUpperCase() === "FORMING").length || 0;

  const getRegimeColor = (regime?: string) => {
    switch (regime) {
      case "TRENDING": return "text-chart-2";
      case "CHOPPY": return "text-yellow-500";
      case "RISK_OFF": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  const currentStrategyConfig = STRATEGY_CONFIGS.find(s => s.id === selectedStrategy);

  return (
    <div className="p-6 space-y-6" data-testid="scanner-page">
      <WelcomeTutorial />
      
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Target className="h-6 w-6" />
                Opportunity Engine
              </h1>
              {(() => {
                const marketSession = getMarketSession();
                return (
                  <Badge 
                    variant="outline" 
                    className={cn("gap-1 text-xs", marketSession.color)}
                    data-testid="badge-market-session"
                  >
                    <Activity className="h-3 w-3" />
                    {marketSession.label}
                  </Badge>
                );
              })()}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Find trading setups that match your strategy
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Live breakout candidates from tight consolidations with volume expansion. Updates during market hours.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {lastScanTime && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Last Scan: {format(lastScanTime, "MMM d, h:mm a")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1.5 text-xs cursor-help" data-testid="badge-live-scan">
                      <Circle className="h-2 w-2 fill-green-500 text-green-500 animate-pulse" />
                      Live Scan
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Auto-updates during market hours. Click Scan Now to refresh instantly.
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runScanMutation.mutate()}
                  disabled={runScanMutation.isPending || !hasDataSource}
                  className="gap-1 h-7"
                  data-testid="button-scan-now-header"
                >
                  <RefreshCw className={`h-3 w-3 ${runScanMutation.isPending ? "animate-spin" : ""}`} />
                  {runScanMutation.isPending ? "Scanning..." : "Scan Now"}
                </Button>
                {scanMetadata && (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Activity className="h-3 w-3" />
                    {scanMetadata.provider.toUpperCase()}
                  </Badge>
                )}
              </div>
            )}
            <TutorialTrigger />
          </div>
        </div>
      </div>

      {/* First-time Coach Mark */}
      {!coachDismissed && liveResults && liveResults.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5" data-testid="coach-mark">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm">
              <span className="font-medium">New here?</span> Click any card to preview the trade plan. Use InstaTrade™ when you're ready.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissCoachMark}
            className="shrink-0"
            data-testid="button-dismiss-coach"
          >
            Got it
          </Button>
        </div>
      )}

      {/* Quick Filters Bar */}
      {liveResults && liveResults.length > 0 && (() => {
        const activeFilterCount = [
          minPatternScore !== null,
          filterMinPrice !== null,
          filterMaxPrice !== null,
          filterMinVolume !== null,
          filterMinRvol !== null,
          filterMinUpside !== null,
        ].filter(Boolean).length;
        
        const clearAllFilters = () => {
          setMinPatternScore(null);
          setFilterMinPrice(null);
          setFilterMaxPrice(null);
          setFilterMinVolume(null);
          setFilterMinRvol(null);
          setFilterMinUpside(null);
        };

        return (
          <div className="space-y-2" data-testid="filter-bar">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-1.5"
                data-testid="button-toggle-filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 min-w-0">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="gap-1 text-xs text-muted-foreground"
                  data-testid="button-clear-filters"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </Button>
              )}
              {activeFilterCount > 0 && (
                <span className="text-xs text-muted-foreground" data-testid="text-filter-count">
                  Showing {filteredResults?.filter(r => r.stage === "BREAKOUT").length || 0} of {liveResults.filter(r => r.stage === "BREAKOUT").length} breakouts
                </span>
              )}
            </div>
            {showFilters && (
              <Card data-testid="filter-panel">
                <CardContent className="p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min Score</Label>
                      <Select
                        value={minPatternScore !== null ? String(minPatternScore) : "any"}
                        onValueChange={(v) => setMinPatternScore(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-score">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="70">70%+</SelectItem>
                          <SelectItem value="80">80%+</SelectItem>
                          <SelectItem value="85">85%+</SelectItem>
                          <SelectItem value="90">90%+</SelectItem>
                          <SelectItem value="95">95%+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min Price</Label>
                      <Select
                        value={filterMinPrice !== null ? String(filterMinPrice) : "any"}
                        onValueChange={(v) => setFilterMinPrice(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-min-price">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="5">$5+</SelectItem>
                          <SelectItem value="10">$10+</SelectItem>
                          <SelectItem value="20">$20+</SelectItem>
                          <SelectItem value="50">$50+</SelectItem>
                          <SelectItem value="100">$100+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max Price</Label>
                      <Select
                        value={filterMaxPrice !== null ? String(filterMaxPrice) : "any"}
                        onValueChange={(v) => setFilterMaxPrice(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-max-price">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="25">Under $25</SelectItem>
                          <SelectItem value="50">Under $50</SelectItem>
                          <SelectItem value="100">Under $100</SelectItem>
                          <SelectItem value="200">Under $200</SelectItem>
                          <SelectItem value="500">Under $500</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min Volume</Label>
                      <Select
                        value={filterMinVolume !== null ? String(filterMinVolume) : "any"}
                        onValueChange={(v) => setFilterMinVolume(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-volume">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="500000">500K+</SelectItem>
                          <SelectItem value="1000000">1M+</SelectItem>
                          <SelectItem value="5000000">5M+</SelectItem>
                          <SelectItem value="10000000">10M+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min RVOL</Label>
                      <Select
                        value={filterMinRvol !== null ? String(filterMinRvol) : "any"}
                        onValueChange={(v) => setFilterMinRvol(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-rvol">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="1">1x+</SelectItem>
                          <SelectItem value="1.5">1.5x+</SelectItem>
                          <SelectItem value="2">2x+</SelectItem>
                          <SelectItem value="3">3x+</SelectItem>
                          <SelectItem value="5">5x+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min Upside %</Label>
                      <Select
                        value={filterMinUpside !== null ? String(filterMinUpside) : "any"}
                        onValueChange={(v) => setFilterMinUpside(v === "any" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-filter-upside">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="2">2%+</SelectItem>
                          <SelectItem value="3">3%+</SelectItem>
                          <SelectItem value="5">5%+</SelectItem>
                          <SelectItem value="8">8%+</SelectItem>
                          <SelectItem value="10">10%+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );
      })()}

      {/* Featured Opportunities - Breakout & Triggered Symbols */}
      {filteredResults && filteredResults.filter(r => r.stage === "BREAKOUT").length > 0 && (() => {
        const topSetupId = getTopSetup(filteredResults || []);
        const breakoutResults = filteredResults.filter(r => r.stage === "BREAKOUT");
        const totalBreakouts = liveResults?.filter(r => r.stage === "BREAKOUT").length || 0;
        return (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-lg">Active Opportunities</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {breakoutResults.length}{breakoutResults.length !== totalBreakouts ? ` of ${totalBreakouts}` : ""} signals
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant={featuredViewMode === "cards" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setFeaturedViewMode("cards")}
                  data-testid="button-view-cards"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={featuredViewMode === "list" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setFeaturedViewMode("list")}
                  data-testid="button-view-list"
                >
                  <LayoutList className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {featuredViewMode === "cards" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {breakoutResults
                  .map((result) => {
                    const isTopSetup = result.id === topSetupId;
                    const isExpanded = expandedCards.has(result.id);
                    const microBadge = getMicroBadge(result);
                    
                    return (
                    <Card 
                      key={result.id} 
                      className={cn(
                        "hover-elevate cursor-pointer transition-all",
                        isTopSetup && "ring-2 ring-primary/50 shadow-md shadow-primary/10"
                      )}
                      onClick={() => navigate(`/charts/${result.ticker}`)}
                      data-testid={`card-opportunity-${result.ticker}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <span className="font-semibold text-base shrink-0">{result.ticker}</span>
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "shrink-0 text-xs",
                                result.stage === "BREAKOUT" && "bg-green-500/10 text-green-600 dark:text-green-400",
                              )}
                            >
                              {result.stage}
                            </Badge>
                            {isTopSetup && (
                              <Badge variant="secondary" className="shrink-0 text-xs bg-primary/10 text-primary">
                                <Sparkles className="h-3 w-3 mr-1" />
                                Top Setup
                              </Badge>
                            )}
                          </div>
                          {result.patternScore && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="shrink-0 text-xs font-semibold cursor-help">
                                  {result.patternScore}%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                <span className="font-medium">Setup Strength:</span> A score based on historical quality of similar setups. Not investment advice.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">${result.price?.toFixed(2)}</span>
                          <span className={cn(
                            "text-xs",
                            (result.changePercent || 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                          )}>
                            {(result.changePercent || 0) >= 0 ? "+" : ""}{result.changePercent?.toFixed(2)}%
                          </span>
                        </div>
                        
                        {/* Contextual micro-badge */}
                        {microBadge && (
                          <p className={cn("text-xs", microBadge.color)}>{microBadge.text}</p>
                        )}
                        
                        {/* Details toggle */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); toggleCardExpand(result.id); }}
                          className="w-full gap-1 h-7 text-xs"
                          data-testid={`button-details-${result.ticker}`}
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} />
                          {isExpanded ? "Hide Details" : "Show Details"}
                        </Button>
                        
                        {/* Expandable details panel */}
                        {isExpanded && (
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">
                                  <span className="block text-muted-foreground/70 flex items-center gap-1">
                                    <Target className="h-3 w-3 text-chart-2" />
                                    Resistance
                                  </span>
                                  <span className="font-medium text-chart-2">${result.resistance?.toFixed(2) || "N/A"}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Price level where the stock has struggled to break above. A breakout happens when price pushes through this ceiling.
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">
                                  <span className="block text-muted-foreground/70 flex items-center gap-1">
                                    <TrendingDown className="h-3 w-3 text-destructive" />
                                    Stop
                                  </span>
                                  <span className="font-medium text-destructive">${result.stopLoss?.toFixed(2) || "N/A"}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Safety price level to exit a trade and limit losses. Placed below recent support to protect your capital.
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">
                                  <span className="block text-muted-foreground/70">Vol</span>
                                  <span className="font-medium text-foreground">{result.volume ? (result.volume / 1000000).toFixed(1) + "M" : "N/A"}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Number of shares traded. Higher volume confirms price moves and indicates stronger conviction.
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">
                                  <span className="block text-muted-foreground/70">RVOL</span>
                                  <span className={cn(
                                    "font-medium",
                                    (result.rvol || 0) >= 1.5 ? "text-chart-2" : "text-foreground"
                                  )}>
                                    {result.rvol?.toFixed(1) || "N/A"}x
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Relative Volume compares current volume to the 20-day average. Above 1.5x often signals strong interest.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                        
                        <Button
                          size="sm"
                          className="w-full gap-1 mt-2"
                          onClick={(e) => handleInstaTrade(result, e)}
                          disabled={instatradeMutation.isPending}
                          data-testid={`button-instatrade-card-${result.ticker}`}
                        >
                          <Zap className="h-3 w-3" />
                          InstaTrade™
                        </Button>
                      </CardContent>
                    </Card>
                  );
                  })}
              </div>
            ) : (
              <div className="space-y-1">
                {breakoutResults
                  .map((result) => {
                    const isTopSetup = result.id === topSetupId;
                    
                    return (
                    <div
                      key={result.id}
                      className={cn(
                        "flex items-center justify-between gap-4 p-2 rounded-md hover-elevate cursor-pointer",
                        isTopSetup && "ring-1 ring-primary/30 bg-primary/5"
                      )}
                      onClick={() => navigate(`/charts/${result.ticker}`)}
                      data-testid={`row-opportunity-${result.ticker}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "shrink-0 text-xs w-20 justify-center",
                            result.stage === "BREAKOUT" && "bg-green-500/10 text-green-600 dark:text-green-400",
                          )}
                        >
                          {result.stage}
                        </Badge>
                        <div className="min-w-0">
                          <span className="font-semibold">{result.ticker}</span>
                          <span className="text-muted-foreground text-sm ml-2 hidden sm:inline">{result.name}</span>
                        </div>
                        {isTopSetup && (
                          <Badge variant="secondary" className="shrink-0 text-xs bg-primary/10 text-primary hidden sm:flex">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Top
                          </Badge>
                        )}
                        {(result as any).firstSeenAt && (
                          <span className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground/70">
                            <Clock className="h-3 w-3" />
                            {format(new Date((result as any).firstSeenAt), "h:mm a")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm shrink-0">
                        <span className="font-medium w-16 text-right">${result.price?.toFixed(2)}</span>
                        <span className={cn(
                          "w-16 text-right",
                          (result.changePercent || 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {(result.changePercent || 0) >= 0 ? "+" : ""}{result.changePercent?.toFixed(2)}%
                        </span>
                        <span className="hidden md:block w-16 text-right text-chart-2">
                          R: ${result.resistance?.toFixed(0) || "N/A"}
                        </span>
                        <span className="hidden md:block w-16 text-right text-destructive">
                          S: ${result.stopLoss?.toFixed(0) || "N/A"}
                        </span>
                        <span className={cn(
                          "hidden lg:block w-12 text-right",
                          (result.rvol || 0) >= 1.5 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        )}>
                          {result.rvol?.toFixed(1)}x
                        </span>
                        {result.patternScore && (
                          <Badge variant="secondary" className="w-12 justify-center">{result.patternScore}%</Badge>
                        )}
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={(e) => handleInstaTrade(result, e)}
                          disabled={instatradeMutation.isPending}
                          data-testid={`button-instatrade-list-${result.ticker}`}
                        >
                          <Zap className="h-3 w-3" />
                          <span className="hidden sm:inline">InstaTrade™</span>
                        </Button>
                      </div>
                    </div>
                  );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
        );
      })()}

      {/* Empty State for No Opportunities */}
      {liveResults && liveResults.filter(r => r.stage === "BREAKOUT").length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Target className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">No active breakouts right now</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              We'll surface opportunities when volume expands from tight consolidations.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Try "Scan Now" or adjust filters in Customize Your Scan below.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Customize Your Scan - Collapsible */}
      <Card>
        <CardHeader 
          className="pb-3 cursor-pointer hover-elevate" 
          onClick={toggleScanConfig}
          data-testid="button-toggle-scan-config"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Customize Your Scan (Optional)
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Most users start with the default scan. Adjust anytime.
              </p>
            </div>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", !scanConfigCollapsed && "rotate-180")} />
          </div>
        </CardHeader>
        <Collapsible open={!scanConfigCollapsed} onOpenChange={(open) => setScanConfigCollapsed(!open)}>
          <CollapsibleContent>
        <CardContent className="pt-0 space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Step 1: Choose Mode</Label>
            <RadioGroup 
              value={engineMode} 
              onValueChange={(v) => setEngineMode(v as EngineMode)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="single" id="mode-single" data-testid="radio-single" />
                <Label htmlFor="mode-single" className="flex items-center gap-2 cursor-pointer">
                  <TrendingUp className="h-4 w-4" />
                  Single Strategy
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="fusion" id="mode-fusion" data-testid="radio-fusion" />
                <Label htmlFor="mode-fusion" className="flex items-center gap-2 cursor-pointer">
                  <Layers className="h-4 w-4" />
                  Fusion Engine
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {engineMode === "single" 
                ? `Scan for ${currentStrategyConfig?.displayName || "patterns"} - ${currentStrategyConfig?.shortDescription || ""}`
                : FUSION_ENGINE_CONFIG.shortDescription
              }
            </p>
          </div>

          {engineMode === "single" ? (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Step 2: Select Strategy</Label>
              <div className="flex flex-col lg:flex-row gap-4">
                <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                  <SelectTrigger className="w-full lg:w-64" data-testid="select-strategy">
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGY_CONFIGS.map((strategy) => (
                      <SelectItem key={strategy.id} value={strategy.id}>
                        <div className="flex items-center gap-2">
                          <span>{strategy.displayName}</span>
                          <span className="text-xs text-muted-foreground">({strategy.category})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentStrategyConfig && (
                  <div className="flex-1" data-testid="strategy-description">
                    <Collapsible open={showStrategyInfo} onOpenChange={setShowStrategyInfo}>
                      <button
                        onClick={() => setShowStrategyInfo(!showStrategyInfo)}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-toggle-strategy-info"
                      >
                        <Info className="h-4 w-4" />
                        <span>{showStrategyInfo ? "Hide" : "Show"} strategy details</span>
                        <ChevronDown className={cn("h-3 w-3 transition-transform", showStrategyInfo && "rotate-180")} />
                      </button>
                      <CollapsibleContent>
                        <div className="mt-3 p-4 rounded-md bg-muted/50 border space-y-3">
                          <div>
                            <p className="text-sm font-medium">{currentStrategyConfig.displayName}</p>
                            <p className="text-xs text-muted-foreground mt-1">{currentStrategyConfig.whatItLooksFor}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-1">Core Conditions:</p>
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {currentStrategyConfig.coreConditions.map((condition, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-primary mt-0.5">•</span>
                                  <span>{condition}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-1">Trigger Alerts:</p>
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {currentStrategyConfig.triggerAlerts.map((alert, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-chart-2 mt-0.5">•</span>
                                  <span>{alert}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-1">Risk/Exit Reference:</p>
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {currentStrategyConfig.riskExitReference.map((ref, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-destructive mt-0.5">•</span>
                                  <span>{ref}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Step 2: Select Strategies</Label>
              <StrategySelector
                selectedStrategies={selectedStrategies}
                onChange={setSelectedStrategies}
                mode="multi"
              />
              <p className="text-xs text-muted-foreground">
                {selectedStrategies.length} strategies selected. Stocks matching 2+ strategies will be highlighted.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-sm font-medium">Step 3: What to Scan</Label>
            <RadioGroup 
              value={targetType} 
              onValueChange={(v) => setTargetType(v as TargetType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="watchlist" id="target-watchlist" data-testid="radio-watchlist" />
                <Label htmlFor="target-watchlist" className="cursor-pointer">Watchlist</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="symbol" id="target-symbol" data-testid="radio-symbol" />
                <Label htmlFor="target-symbol" className="cursor-pointer">Single Stock</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="universe" id="target-universe" data-testid="radio-universe" />
                <Label htmlFor="target-universe" className="cursor-pointer">Market Index</Label>
              </div>
            </RadioGroup>

            <div className="max-w-md">
              {targetType === "watchlist" && (
                <Select value={selectedWatchlist} onValueChange={setSelectedWatchlist}>
                  <SelectTrigger data-testid="select-watchlist">
                    <SelectValue placeholder="Select watchlist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Watchlist</SelectItem>
                    {watchlists?.map((wl) => (
                      <SelectItem key={wl.id} value={wl.id}>
                        {wl.name} ({wl.symbols?.length || 0} stocks)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {targetType === "symbol" && (
                <Input
                  placeholder="Enter symbol (e.g., AAPL) or multiple (AAPL, MSFT)"
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                  className="font-mono"
                  data-testid="input-symbol"
                />
              )}

              {targetType === "universe" && (
                <>
                  <Select value={selectedUniverse} onValueChange={setSelectedUniverse}>
                    <SelectTrigger data-testid="select-universe">
                      <SelectValue placeholder="Select market" />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIVERSE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label} ({opt.count} stocks)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedUniverse === "all" && (
                    <div className="mt-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium text-yellow-700 dark:text-yellow-400">Large scan notice</p>
                          <p className="text-muted-foreground mt-1">
                            Scanning {universes?.all?.count || 550} stocks may take longer and use more API calls. 
                            Consider using price/volume filters to narrow results, or select a smaller index like S&P 500 or Nasdaq 100.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                    <div className="flex items-start gap-2">
                      <Target className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                      <div className="text-sm">
                        <p className="font-medium text-blue-700 dark:text-blue-400">Pro tip: Create a watchlist</p>
                        <p className="text-muted-foreground mt-1">
                          For faster, more focused scans, create a custom watchlist with your favorite stocks. 
                          Go to <Link href="/watchlists" className="text-primary hover:underline">Watchlists</Link> to add your own.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Step 4: Filter Preset</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs gap-1"
                data-testid="button-advanced-filters"
              >
                <Zap className="h-3 w-3" />
                Advanced
                <ChevronDown className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
              </Button>
            </div>
            <Select value={selectedPreset} onValueChange={applyPreset}>
              <SelectTrigger className="w-full max-w-md" data-testid="select-preset">
                <SelectValue placeholder="Select preset" />
              </SelectTrigger>
              <SelectContent>
                {SCAN_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div className="flex items-center gap-2">
                      <span>{preset.name}</span>
                      <span className="text-xs text-muted-foreground">- {preset.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleContent>
                <div className="space-y-4 pt-3 pb-2">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="minPrice" className="text-xs text-muted-foreground">Min Price</Label>
                      <Input
                        id="minPrice"
                        type="number"
                        placeholder="$5"
                        value={filters.minPrice ?? ""}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          minPrice: e.target.value ? Number(e.target.value) : PRESET_FILTERS[selectedPreset]?.minPrice 
                        }))}
                        className="font-mono h-8"
                        data-testid="input-min-price"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="maxPrice" className="text-xs text-muted-foreground">Max Price</Label>
                      <Input
                        id="maxPrice"
                        type="number"
                        placeholder="$500"
                        value={filters.maxPrice ?? ""}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          maxPrice: e.target.value ? Number(e.target.value) : PRESET_FILTERS[selectedPreset]?.maxPrice 
                        }))}
                        className="font-mono h-8"
                        data-testid="input-max-price"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="minVolume" className="text-xs text-muted-foreground">Min Volume</Label>
                      <Input
                        id="minVolume"
                        type="number"
                        placeholder="500K"
                        value={filters.minVolume ?? ""}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          minVolume: e.target.value ? Number(e.target.value) : PRESET_FILTERS[selectedPreset]?.minVolume 
                        }))}
                        className="font-mono h-8"
                        data-testid="input-min-volume"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="minRvol" className="text-xs text-muted-foreground">Min RVOL</Label>
                      <Input
                        id="minRvol"
                        type="number"
                        step="0.1"
                        placeholder="1.0x"
                        value={filters.minRvol ?? ""}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          minRvol: e.target.value ? Number(e.target.value) : PRESET_FILTERS[selectedPreset]?.minRvol 
                        }))}
                        className="font-mono h-8"
                        data-testid="input-min-rvol"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="excludeEtfs"
                        checked={filters.excludeEtfs ?? true}
                        onCheckedChange={(checked) => setFilters(prev => ({ ...prev, excludeEtfs: checked }))}
                        data-testid="switch-exclude-etfs"
                      />
                      <Label htmlFor="excludeEtfs" className="text-sm cursor-pointer">Exclude ETFs</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="excludeOtc"
                        checked={filters.excludeOtc ?? true}
                        onCheckedChange={(checked) => setFilters(prev => ({ ...prev, excludeOtc: checked }))}
                        data-testid="switch-exclude-otc"
                      />
                      <Label htmlFor="excludeOtc" className="text-sm cursor-pointer">Exclude OTC</Label>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <Button
              onClick={handleRunScan}
              disabled={isScanning || !hasDataSource}
              variant="outline"
              className="gap-2"
              data-testid="button-run-scan"
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {isScanning ? "Scanning..." : "Refresh"}
            </Button>

            <Button
              variant="outline"
              onClick={() => saveDefaultsMutation.mutate()}
              disabled={saveDefaultsMutation.isPending}
              className="gap-2"
              data-testid="button-save-defaults"
            >
              {saveDefaultsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save as Default
            </Button>

            <div className="flex items-center gap-2 ml-2">
              <Switch
                id="autoRunOnLoad"
                checked={autoRunOnLoad}
                onCheckedChange={setAutoRunOnLoad}
                data-testid="switch-auto-run"
              />
              <Label htmlFor="autoRunOnLoad" className="text-sm cursor-pointer whitespace-nowrap">Auto-run on load</Label>
            </div>

            <div className="flex items-center gap-2 ml-2">
              <Label htmlFor="autoRefresh" className="text-sm whitespace-nowrap">Auto-refresh:</Label>
              <Select
                value={autoRefreshInterval.toString()}
                onValueChange={(val) => setAutoRefreshInterval(Number(val))}
              >
                <SelectTrigger className="w-24 h-8" data-testid="select-auto-refresh">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Off</SelectItem>
                  <SelectItem value="60000">1 min</SelectItem>
                  <SelectItem value="120000">2 min</SelectItem>
                  <SelectItem value="300000">5 min</SelectItem>
                  <SelectItem value="600000">10 min</SelectItem>
                  <SelectItem value="1800000">30 min</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {userDefaults && defaultsApplied && (
              <span className="text-xs text-muted-foreground ml-2">Using saved defaults</span>
            )}

            {!hasDataSource && (
              <p className="text-sm text-muted-foreground">
                <Link href="/settings" className="text-primary underline">Configure a data source</Link> to run scans
              </p>
            )}

            {marketRegime && engineMode === "fusion" && (
              <div className="flex items-center gap-2 ml-auto">
                <Activity className={`h-4 w-4 ${getRegimeColor(marketRegime.regime)}`} />
                <span className="text-sm">Market:</span>
                <Badge variant="outline" className={getRegimeColor(marketRegime.regime)}>
                  {marketRegime.regime === "TRENDING" ? "Trending" : 
                   marketRegime.regime === "CHOPPY" ? "Choppy" : "Risk-Off"}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {filteredResults && filteredResults.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">{filteredResults.length} results</span>
              {scanMetadata && (
                <span className="text-xs text-muted-foreground">
                  ({scanMetadata.symbolsReturned}/{scanMetadata.symbolsRequested} symbols
                  {scanMetadata.batchCount && scanMetadata.batchCount > 1 && `, ${scanMetadata.batchCount} batches`}
                  {" "}in {(scanMetadata.scanTimeMs / 1000).toFixed(1)}s)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter results..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 h-9"
                  data-testid="input-search"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                    onClick={() => setSearchQuery("")}
                    data-testid="button-clear-search"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap p-3 rounded-md bg-muted/30 border">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Sort:</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40 h-8" data-testid="select-sort-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="patternScore">Pattern Score</SelectItem>
                  <SelectItem value="resistancePercent">% to Resistance</SelectItem>
                  <SelectItem value="price">Price</SelectItem>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="rvol">RVOL</SelectItem>
                  <SelectItem value="changePercent">% Change</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                data-testid="button-toggle-sort-order"
              >
                <ArrowUpDown className={cn("h-4 w-4", sortOrder === "asc" && "rotate-180")} />
              </Button>
              <span className="text-xs text-muted-foreground">{sortOrder === "desc" ? "High to Low" : "Low to High"}</span>
            </div>
            
            <div className="h-6 w-px bg-border" />
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter:</span>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-28 h-8" data-testid="select-stage-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  <SelectItem value="breakout">Breakout</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="forming">Forming</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Min Score:</span>
              <Input
                type="number"
                placeholder="0"
                value={minPatternScore ?? ""}
                onChange={(e) => setMinPatternScore(e.target.value ? parseInt(e.target.value) : null)}
                className="w-16 h-8 text-sm"
                min={0}
                max={100}
                data-testid="input-min-score"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Max % to Resist:</span>
              <Input
                type="number"
                placeholder="Any"
                value={maxResistancePercent ?? ""}
                onChange={(e) => setMaxResistancePercent(e.target.value ? parseFloat(e.target.value) : null)}
                className="w-16 h-8 text-sm"
                min={0}
                step={0.5}
                data-testid="input-max-resistance"
              />
            </div>
            
            {(stageFilter !== "all" || minPatternScore !== null || maxResistancePercent !== null) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStageFilter("all");
                  setMinPatternScore(null);
                  setMaxResistancePercent(null);
                }}
                className="h-8 text-xs"
                data-testid="button-clear-filters"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>
      )}

      {engineMode === "single" && filteredResults && filteredResults.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="default" className="gap-1">
              Breakout <span className="font-mono">{triggeredCount}</span>
            </Badge>
            <Badge variant="secondary" className="gap-1">
              Ready <span className="font-mono">{readyCount}</span>
            </Badge>
            <Badge variant="outline" className="gap-1">
              Forming <span className="font-mono">{formingCount}</span>
            </Badge>
          </div>
          <ScannerTable
            results={filteredResults}
            onRowClick={handleRowClick}
            onInstaTrade={handleInstaTrade}
            isInstaTrading={instatradeMutation.isPending}
            isLoading={isLoading}
          />
        </>
      )}

      {engineMode === "fusion" && confluenceResults && confluenceResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Confluence Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {confluenceResults.map((result) => (
                <div
                  key={result.symbol}
                  className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                  onClick={() => navigate(`/charts/${result.symbol}`)}
                  data-testid={`confluence-row-${result.symbol}`}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">{result.symbol}</p>
                      <p className="text-sm text-muted-foreground">{result.name}</p>
                    </div>
                    <Badge variant="outline">${result.price.toFixed(2)}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        {result.matchedStrategies.map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {getStrategyDisplayName(s)}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Score: {result.adjustedScore}/100
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {((engineMode === "single" && (!filteredResults || filteredResults.length === 0)) ||
        (engineMode === "fusion" && (!confluenceResults || confluenceResults.length === 0))) && 
        !isScanning && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <div className="rounded-full bg-muted p-4">
                  <Search className="h-8 w-8 text-muted-foreground" />
                </div>
              </div>
              <p className="text-lg font-medium">No results yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Select a strategy or adjust filters above to find trading opportunities. Results update automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showEndpointDialog} onOpenChange={setShowEndpointDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              InstaTrade™ {instaTradeResult?.ticker}
            </DialogTitle>
            <DialogDescription>
              {hasEndpoints 
                ? "Review trade details and select an endpoint to execute."
                : "Review trade details below. Connect an endpoint to execute trades."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {instaTradeResult && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium mb-2">Trade Details</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Symbol:</span>{" "}
                    <span className="font-medium">{instaTradeResult.ticker}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Stage:</span>{" "}
                    <span className="font-medium">{instaTradeResult.stage}</span>
                  </div>
                  {instaTradeResult.resistance && (
                    <div>
                      <span className="text-muted-foreground">Entry (Breakout):</span>{" "}
                      <span className="font-medium text-green-600">${instaTradeResult.resistance.toFixed(2)}</span>
                    </div>
                  )}
                  {instaTradeResult.price && (
                    <div>
                      <span className="text-muted-foreground">Current:</span>{" "}
                      <span className="font-medium">${instaTradeResult.price.toFixed(2)}</span>
                    </div>
                  )}
                  {instaTradeResult.stopLoss && (
                    <div>
                      <span className="text-muted-foreground">Stop:</span>{" "}
                      <span className="font-medium text-red-600">${instaTradeResult.stopLoss.toFixed(2)}</span>
                    </div>
                  )}
                  {instaTradeResult.resistance && instaTradeResult.stopLoss && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Risk/Share:</span>{" "}
                        <span className="font-medium">${(instaTradeResult.resistance - instaTradeResult.stopLoss).toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Target 1R:</span>{" "}
                        <span className="font-medium text-green-600">${(instaTradeResult.resistance + (instaTradeResult.resistance - instaTradeResult.stopLoss)).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {(hasEndpoints || hasSnaptradeAccounts) ? (
              <Tabs value={executionMethod} onValueChange={(v) => setExecutionMethod(v as "algopilotx" | "snaptrade")}>
                <TabsList className="w-full">
                  <TabsTrigger value="algopilotx" className="flex-1 gap-1" disabled={!hasEndpoints} data-testid="tab-algopilotx">
                    <Zap className="h-3 w-3" />
                    AlgoPilotX
                  </TabsTrigger>
                  <TabsTrigger value="snaptrade" className="flex-1 gap-1" disabled={!hasSnaptradeAccounts} data-testid="tab-snaptrade">
                    <ExternalLink className="h-3 w-3" />
                    SnapTrade
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="algopilotx" className="mt-3 space-y-3">
                  <Label className="text-sm font-medium">Select Endpoint</Label>
                  <Select
                    value={selectedEndpoint?.id || ""}
                    onValueChange={(value) => {
                      const endpoint = automationEndpoints?.find(e => e.id === value);
                      if (endpoint) setSelectedEndpoint(endpoint);
                    }}
                  >
                    <SelectTrigger data-testid="select-instatrade-endpoint">
                      <Zap className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Choose an endpoint" />
                    </SelectTrigger>
                    <SelectContent>
                      {automationEndpoints?.map((endpoint) => (
                        <SelectItem key={endpoint.id} value={endpoint.id}>
                          {endpoint.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Sends trade setup to AlgoPilotX for automated execution.
                  </p>
                </TabsContent>
                <TabsContent value="snaptrade" className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Select Account</Label>
                    <Select
                      value={selectedSnaptradeAccount?.id || ""}
                      onValueChange={(value) => {
                        const account = snaptradeConnections.find(c => c.id === value);
                        if (account) setSelectedSnaptradeAccount(account);
                      }}
                    >
                      <SelectTrigger data-testid="select-snaptrade-account">
                        <SelectValue placeholder="Choose a brokerage account" />
                      </SelectTrigger>
                      <SelectContent>
                        {snaptradeConnections.filter(c => c.isTradingEnabled).map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.brokerName} - {account.accountName || account.accountNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Quantity (Shares)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={orderQuantity}
                      onChange={(e) => setOrderQuantity(parseInt(e.target.value) || 1)}
                      data-testid="input-order-quantity"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Places a limit order directly with your broker at the breakout price.
                  </p>
                </TabsContent>
              </Tabs>
            ) : (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Zap className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">No Execution Methods Connected</p>
                      <p className="text-sm text-muted-foreground">
                        Connect AlgoPilotX endpoints or a brokerage account via SnapTrade in Settings to execute trades.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEndpointDialog(false)}>
              Close
            </Button>
            {(hasEndpoints || hasSnaptradeAccounts) ? (
              <Button
                onClick={handleConfirmInstaTrade}
                disabled={
                  (executionMethod === "algopilotx" && (!selectedEndpoint || instatradeMutation.isPending)) ||
                  (executionMethod === "snaptrade" && (!selectedSnaptradeAccount || !orderQuantity || snaptradeTradeMutation.isPending))
                }
                data-testid="button-confirm-instatrade"
              >
                {(instatradeMutation.isPending || snaptradeTradeMutation.isPending) 
                  ? "Sending..." 
                  : executionMethod === "algopilotx" 
                    ? "Send to AlgoPilotX" 
                    : "Place Order"}
              </Button>
            ) : (
              <Button
                onClick={() => window.location.href = "/settings"}
                data-testid="button-goto-settings"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Connect Execution
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
