import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { cn } from "@/lib/utils";
import type { PlatformUniverse, PlatformRiskProfile } from "@shared/platform-types";
import {
  Loader2,
  Lock,
  ScanLine,
  Play,
  History,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Shield,
  AlertTriangle,
  Unplug,
  Pencil,
  Globe,
  Plus,
  LayoutGrid,
  List,
  ChevronDown,
  Settings2,
  Target,
  DollarSign,
  Percent,
  ArrowUpDown,
  Calendar,
  Activity,
  HelpCircle,
} from "lucide-react";

interface MeResponse {
  user: { id: string; email: string; role: string };
  entitlements: {
    stockScanner: boolean;
    optionsScanner: boolean;
    automation: boolean;
    plan: string;
  };
  broker: { connected: boolean; provider: string | null };
}

interface OptionLeg {
  side: "buy" | "sell";
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  theta: number;
  impliedVol: number;
  openInterest: number;
  volume: number;
}

interface OptionCandidate {
  rank: number;
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  strategyVariant: string;
  strategy: string;
  bid: number;
  ask: number;
  mid: number;
  impliedVol: number;
  delta: number;
  theta: number;
  openInterest: number;
  volume: number;
  score: number;
  rationale: string;
  dte: number;
  premiumPct: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  legs: OptionLeg[];
  pop: number;
  stockPrice: number;
}

interface ScanResult {
  strategyKey: string;
  universeId: string;
  scannedAt: string;
  candidateCount: number;
  candidates: OptionCandidate[];
}

interface StrategyDef {
  key: string;
  label: string;
  description: string;
}

interface ScanHistoryItem {
  id: string;
  createdAt: string;
  universeId: string;
  strategyKey: string;
  resultJson: ScanResult;
}

interface ScanPreferences {
  dteMin: number;
  dteMax: number;
  deltaMin: number;
  deltaMax: number;
  minPremiumPct: number;
}

const MODE_LABELS: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

const BUILTIN_UNIVERSES = [
  { id: "sp500", name: "S&P 500", description: "500 largest US companies", count: 503 },
  { id: "nasdaq100", name: "Nasdaq 100", description: "100 largest tech & growth stocks", count: 101 },
  { id: "dow30", name: "Dow Jones 30", description: "30 blue-chip stocks", count: 30 },
];

const STRATEGY_TIPS: Record<string, { difficulty: string; tip: string; howItWorks: string; pickCriteria: string[] }> = {
  "long-options": {
    difficulty: "Beginner Friendly",
    tip: "Great starting point. You buy an option and your maximum loss is what you paid for it.",
    howItWorks: "Buys a call (bullish) or put (bearish) option on a stock. You profit when the stock moves in your predicted direction beyond the breakeven price before expiration.",
    pickCriteria: [
      "Ranks by implied volatility vs. historical range to find undervalued options",
      "Filters for your preferred delta range to balance cost vs. probability",
      "Requires minimum premium % relative to stock price for adequate reward",
      "Selects strikes slightly out-of-the-money for optimal risk/reward",
      "Prioritizes contracts with strong open interest and volume for liquidity",
    ],
  },
  "wheel": {
    difficulty: "Intermediate",
    tip: "Best for stocks you'd want to own anyway. You earn income while waiting.",
    howItWorks: "Generates either a Cash-Secured Put (sell puts to get paid while waiting to buy) or a Covered Call (sell calls on stock you own to earn income). Both strategies collect premium as income.",
    pickCriteria: [
      "Selects high-quality stocks suitable for long-term ownership",
      "Cash-Secured Put: finds puts with premium income above your minimum threshold",
      "Covered Call: finds calls above the stock price to earn income while holding",
      "Targets delta range that balances premium income with assignment probability",
      "Scores higher when annualized return from premium is attractive vs. capital required",
    ],
  },
  "credit-spreads": {
    difficulty: "Intermediate",
    tip: "Lower risk than selling naked options. Your max loss and max gain are both defined upfront.",
    howItWorks: "Sells a Bull Put Spread (bullish: sell higher put, buy lower put) or Bear Call Spread (bearish: sell lower call, buy higher call). You keep the credit if the stock stays in your range.",
    pickCriteria: [
      "Finds spread widths that offer favorable risk/reward ratios",
      "Bull Put Spread: places short strike below current price in a support zone",
      "Bear Call Spread: places short strike above current price near resistance",
      "Ranks by probability of profit (PoP) combined with premium collected",
      "Requires both legs to have adequate liquidity for clean fills",
    ],
  },
};

const DEFAULT_PREFS: ScanPreferences = {
  dteMin: 14,
  dteMax: 45,
  deltaMin: 0.15,
  deltaMax: 0.35,
  minPremiumPct: 0.5,
};

export default function OptionsScanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [universeId, setUniverseId] = useState("sp500");
  const [activeStrategy, setActiveStrategy] = useState("long-options");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<ScanPreferences>({ ...DEFAULT_PREFS });

  const { data: me, isLoading: meLoading } = useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
  });

  const { data: userUniverses, isLoading: universesLoading } = useQuery<PlatformUniverse[]>({
    queryKey: ["/api/platform/universes"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { data: riskProfile, isLoading: riskLoading } = useQuery<PlatformRiskProfile>({
    queryKey: ["/api/platform/risk-profile"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { isConnected: brokerConnected } = useBrokerStatus();

  const { data: rawStrategies } = useQuery<StrategyDef[]>({
    queryKey: ["/api/options/strategies"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const STRATEGY_ORDER = ["long-options", "wheel", "credit-spreads"];
  const strategies = rawStrategies
    ? STRATEGY_ORDER
        .map((key) => rawStrategies.find((s) => s.key === key))
        .filter((s): s is StrategyDef => !!s)
    : [];

  const { data: scanHistory } = useQuery<ScanHistoryItem[]>({
    queryKey: ["/api/options/scans"],
    enabled: !!me?.entitlements?.optionsScanner && showHistory,
  });

  const selectedUniverseId = universeId;

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/options/scan", {
        universeId: selectedUniverseId,
        strategyKey: activeStrategy,
        riskProfileId: riskProfile?.id,
        scanPreferences: prefs,
      });
      return res.json();
    },
    onSuccess: (data: ScanResult) => {
      setScanResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/options/scans"] });
      toast({
        title: "Scan complete",
        description: `Found ${data.candidateCount} trade ideas`,
      });
    },
    onError: () => {
      toast({
        title: "Scan failed",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (meLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-options">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me?.entitlements?.optionsScanner) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle data-testid="text-options-locked">Options Scanner</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground" data-testid="text-upgrade-message">
              Upgrade to Pro to access Options Scanner
            </p>
            <Link href="/pricing">
              <Button data-testid="button-upgrade-pricing">View Pricing</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDataLoading = universesLoading || riskLoading;
  const canScan = brokerConnected && !!selectedUniverseId && !scanMutation.isPending;
  const activeStrategyDef = strategies?.find((s) => s.key === activeStrategy);
  const activeTip = STRATEGY_TIPS[activeStrategy];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5" data-testid="options-scanner-container">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ScanLine className="h-6 w-6 text-primary" />
            Options Scanner
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Find options trade ideas across hundreds of stocks in seconds
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="button-toggle-history"
          >
            <History className="h-4 w-4 mr-1" />
            {showHistory ? "Hide History" : "Past Scans"}
          </Button>
        </div>
      </div>

      <div className="space-y-3" data-testid="section-scanning-modes">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Choose a Strategy
        </h2>
        <p className="text-xs text-muted-foreground">
          Pick how you want to trade. Each strategy has a different approach and risk level.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {strategies.map((s) => {
            const tip = STRATEGY_TIPS[s.key];
            const isActive = activeStrategy === s.key;
            return (
              <Card
                key={s.key}
                className={cn(
                  "cursor-pointer transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "hover-elevate"
                )}
                onClick={() => setActiveStrategy(s.key)}
                data-testid={`mode-card-${s.key}`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                    <div className="flex items-center gap-1.5">
                      <h3 className={cn("text-sm font-semibold", isActive ? "text-foreground" : "text-muted-foreground")}>
                        {s.label}
                      </h3>
                      {tip && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="cursor-help"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`tooltip-trigger-${s.key}`}
                            >
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="start" className="max-w-xs p-3 space-y-2" data-testid={`tooltip-content-${s.key}`}>
                            <p className="text-xs font-medium">{tip.howItWorks}</p>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">How picks are identified:</p>
                              <ul className="space-y-0.5">
                                {tip.pickCriteria.map((criterion, i) => (
                                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                    <span className="text-primary mt-0.5 shrink-0">-</span>
                                    {criterion}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {tip && (
                      <Badge variant={isActive ? "default" : "secondary"} className="text-xs" data-testid={`badge-difficulty-${s.key}`}>
                        {tip.difficulty}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {s.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {activeTip && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50" data-testid="strategy-tip">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Tip:</span> {activeTip.tip}
            </p>
          </div>
        )}
      </div>

      {isDataLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-universe-selector">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    Stocks to Scan
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/settings/universes")}
                    className="text-xs"
                    data-testid="link-manage-universes"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Custom List
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedUniverseId}
                  onValueChange={setUniverseId}
                >
                  <SelectTrigger data-testid="select-universe">
                    <SelectValue placeholder="Choose which stocks to scan" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Major Indices
                    </div>
                    {BUILTIN_UNIVERSES.map((u) => (
                      <SelectItem key={u.id} value={u.id} data-testid={`option-universe-${u.id}`}>
                        {u.name} ({u.count} stocks)
                      </SelectItem>
                    ))}
                    {userUniverses && userUniverses.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">
                          Your Custom Lists
                        </div>
                        {userUniverses.map((u) => (
                          <SelectItem key={u.id} value={u.id} data-testid={`option-universe-${u.id}`}>
                            {u.name} ({u.count} stocks)
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  Choose a group of stocks to search through for trade ideas
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-risk-profile">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Risk Settings
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/settings/risk-profile")}
                    className="text-xs"
                    data-testid="link-edit-risk-profile"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {riskProfile ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2" data-testid="risk-profile-summary">
                      <Badge variant="secondary" data-testid="text-risk-mode">
                        {MODE_LABELS[riskProfile.risk_mode] ?? riskProfile.risk_mode}
                      </Badge>
                      <span className="text-sm text-muted-foreground" data-testid="text-risk-deploy">
                        Deploy {riskProfile.max_deploy}%
                      </span>
                      <span className="text-sm text-muted-foreground" data-testid="text-risk-per-trade">
                        Risk {riskProfile.risk_per_trade}%/trade
                      </span>
                      <Badge
                        variant={riskProfile.protections_enabled ? "default" : "outline"}
                        className="text-xs"
                        data-testid="text-protections-status"
                      >
                        {riskProfile.protections_enabled ? "Safety ON" : "Safety OFF"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Controls how much of your account to use and how much risk per trade
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Using default risk settings</p>
                    <p className="text-xs text-muted-foreground">
                      Set up a risk profile to customize how much you want to risk per trade
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Collapsible open={prefsOpen} onOpenChange={setPrefsOpen}>
            <Card data-testid="card-scan-preferences">
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover-elevate rounded-md">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-muted-foreground" />
                      Scan Preferences
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {prefs.dteMin}-{prefs.dteMax} DTE, {(prefs.deltaMin * 100).toFixed(0)}-{(prefs.deltaMax * 100).toFixed(0)} Delta
                      </span>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", prefsOpen && "rotate-180")} />
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-3" data-testid="pref-dte">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          Days to Expiration (DTE)
                        </Label>
                        <span className="text-xs font-mono text-muted-foreground" data-testid="text-dte-value">
                          {prefs.dteMin} - {prefs.dteMax}
                        </span>
                      </div>
                      <Slider
                        value={[prefs.dteMin, prefs.dteMax]}
                        min={1}
                        max={120}
                        step={1}
                        onValueChange={([min, max]) => setPrefs(p => ({ ...p, dteMin: min, dteMax: max }))}
                        data-testid="slider-dte"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>1 day</span>
                        <span>120 days</span>
                      </div>
                    </div>

                    <div className="space-y-3" data-testid="pref-delta">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                          Delta Range
                        </Label>
                        <span className="text-xs font-mono text-muted-foreground" data-testid="text-delta-value">
                          {(prefs.deltaMin * 100).toFixed(0)} - {(prefs.deltaMax * 100).toFixed(0)}
                        </span>
                      </div>
                      <Slider
                        value={[prefs.deltaMin * 100, prefs.deltaMax * 100]}
                        min={5}
                        max={50}
                        step={1}
                        onValueChange={([min, max]) => setPrefs(p => ({ ...p, deltaMin: min / 100, deltaMax: max / 100 }))}
                        data-testid="slider-delta"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>5 (far OTM)</span>
                        <span>50 (near ATM)</span>
                      </div>
                    </div>

                    <div className="space-y-3" data-testid="pref-premium">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium flex items-center gap-1.5">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                          Min Premium %
                        </Label>
                        <span className="text-xs font-mono text-muted-foreground" data-testid="text-premium-value">
                          {prefs.minPremiumPct.toFixed(1)}%
                        </span>
                      </div>
                      <Slider
                        value={[prefs.minPremiumPct * 10]}
                        min={1}
                        max={50}
                        step={1}
                        onValueChange={([val]) => setPrefs(p => ({ ...p, minPremiumPct: val / 10 }))}
                        data-testid="slider-premium"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0.1%</span>
                        <span>5.0%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPrefs({ ...DEFAULT_PREFS })}
                      className="text-xs"
                      data-testid="button-reset-prefs"
                    >
                      Reset to defaults
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {!brokerConnected && (
            <Card className="border-yellow-500/30" data-testid="card-broker-warning">
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Unplug className="h-5 w-5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium" data-testid="text-broker-warning">
                        Connect your broker to scan
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Link your brokerage account to start finding trade ideas
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => navigate("/settings")}
                    data-testid="button-connect-broker"
                  >
                    Connect Broker
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-scan-panel">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          onClick={() => scanMutation.mutate()}
                          disabled={!canScan}
                          data-testid="button-run-scan"
                        >
                          {scanMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 mr-1" />
                          )}
                          {scanMutation.isPending ? "Scanning..." : "Find Trades"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canScan && !scanMutation.isPending && (
                      <TooltipContent data-testid="tooltip-scan-disabled">
                        {!brokerConnected
                          ? "Connect your broker first"
                          : !selectedUniverseId
                          ? "Pick which stocks to scan"
                          : ""}
                      </TooltipContent>
                    )}
                  </Tooltip>

                  {!brokerConnected && (
                    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" data-testid="text-scan-validation">
                      <AlertTriangle className="h-3 w-3" />
                      Connect broker to scan
                    </span>
                  )}
                  {brokerConnected && !selectedUniverseId && (
                    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" data-testid="text-scan-validation">
                      <AlertTriangle className="h-3 w-3" />
                      Pick stocks to scan
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {scanResult && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span data-testid="text-scan-time">
                        {new Date(scanResult.scannedAt).toLocaleTimeString()}
                      </span>
                      <Badge variant="secondary" data-testid="text-candidate-count">
                        {scanResult.candidateCount} ideas found
                      </Badge>
                    </div>
                  )}
                  {scanResult && scanResult.candidates.length > 0 && (
                    <div className="flex items-center border rounded-md" data-testid="view-toggle">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("rounded-r-none", viewMode === "card" && "bg-muted")}
                        onClick={() => setViewMode("card")}
                        data-testid="button-view-card"
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("rounded-l-none", viewMode === "list" && "bg-muted")}
                        onClick={() => setViewMode("list")}
                        data-testid="button-view-list"
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {activeStrategyDef && (
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="secondary" data-testid="badge-active-strategy">{activeStrategyDef.label}</Badge>
                  <p className="text-sm text-muted-foreground" data-testid="text-strategy-description">
                    {activeStrategyDef.description}
                  </p>
                </div>
              )}

              {scanResult && scanResult.strategyKey === activeStrategy ? (
                viewMode === "card" ? (
                  <CandidatesCardView candidates={scanResult.candidates} />
                ) : (
                  <CandidatesListView candidates={scanResult.candidates} />
                )
              ) : scanResult && scanResult.strategyKey !== activeStrategy ? (
                <EmptyState message={`Click "Find Trades" with "${activeStrategyDef?.label ?? activeStrategy}" selected to see results`} />
              ) : (
                <EmptyState message="Pick your strategy and stocks above, then click Find Trades" />
              )}
            </CardContent>
          </Card>

          {showHistory && (
            <Card data-testid="card-scan-history">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <CardTitle>Past Scans</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {!scanHistory || scanHistory.length === 0 ? (
                  <EmptyState message="No past scans yet. Run your first scan above." />
                ) : (
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-2">
                      {scanHistory.map((scan) => (
                        <div
                          key={scan.id}
                          className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border hover-elevate cursor-pointer"
                          onClick={() => {
                            setScanResult(scan.resultJson);
                            setActiveStrategy(scan.strategyKey);
                            setShowHistory(false);
                          }}
                          data-testid={`history-item-${scan.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{scan.strategyKey}</Badge>
                            <span className="text-sm text-muted-foreground">{scan.universeId}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {scan.resultJson?.candidateCount ?? 0} results
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(scan.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12" data-testid="empty-state">
      <div className="text-center space-y-2">
        <ScanLine className="h-10 w-10 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function VariantBadge({ variant, optionType }: { variant: string; optionType: "call" | "put" }) {
  const isCallish = optionType === "call" || variant.toLowerCase().includes("call") || variant.toLowerCase().includes("bull");
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-xs",
        isCallish
          ? "bg-chart-2/15 text-chart-2 border-chart-2/30"
          : "bg-destructive/15 text-destructive border-destructive/30"
      )}
      data-testid="badge-variant"
    >
      {variant}
    </Badge>
  );
}

function MetricPill({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Target }) {
  return (
    <div className="flex items-center gap-1.5 text-xs" data-testid={`metric-${label.toLowerCase().replace(/\s/g, "-")}`}>
      {Icon && <Icon className="h-3 w-3 text-muted-foreground shrink-0" />}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium font-mono">{value}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge
      variant={score >= 90 ? "default" : score >= 75 ? "secondary" : "outline"}
      className="text-xs font-mono"
      data-testid="badge-score"
    >
      {score}
    </Badge>
  );
}

function LegDisplay({ legs }: { legs: OptionLeg[] }) {
  if (legs.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="legs-display">
      {legs.map((leg, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="text-xs capitalize">
            {leg.side}
          </Badge>
          <span className="font-mono">${leg.strike}</span>
          <Badge
            variant="secondary"
            className={cn(
              "text-xs",
              leg.optionType === "call"
                ? "bg-chart-2/15 text-chart-2"
                : "bg-destructive/15 text-destructive"
            )}
          >
            {leg.optionType === "call" ? "Call" : "Put"}
          </Badge>
          <span className="text-muted-foreground">{leg.expiration}</span>
          <span className="text-muted-foreground font-mono">${leg.mid.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function CandidatesCardView({ candidates }: { candidates: OptionCandidate[] }) {
  if (candidates.length === 0) {
    return <EmptyState message="No trade ideas found for this scan" />;
  }

  return (
    <ScrollArea className="max-h-[600px]" data-testid="candidates-card-container">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {candidates.map((c) => (
          <Card key={`${c.symbol}-${c.strike}-${c.expiration}`} className="overflow-visible" data-testid={`candidate-card-${c.rank}`}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" data-testid={`text-underlying-card-${c.rank}`}>{c.underlying}</span>
                  <span className="text-xs text-muted-foreground font-mono">${c.stockPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ScoreBadge score={c.score} />
                  <VariantBadge variant={c.strategyVariant} optionType={c.optionType} />
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span className="font-mono" data-testid={`text-strike-card-${c.rank}`}>${c.strike}</span>
                <span>{c.expiration}</span>
                <Badge variant="outline" className="text-xs">{c.dte}d</Badge>
              </div>

              {c.legs.length > 1 && <LegDisplay legs={c.legs} />}

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <MetricPill label="Premium" value={`$${c.mid.toFixed(2)}`} icon={DollarSign} />
                <MetricPill label="IV" value={`${c.impliedVol}%`} icon={Activity} />
                <MetricPill label="Delta" value={`${c.delta}`} icon={ArrowUpDown} />
                <MetricPill label="Theta" value={`${c.theta}`} icon={Clock} />
                <MetricPill label="PoP" value={`${c.pop}%`} icon={Target} />
                <MetricPill label="Prem %" value={`${c.premiumPct}%`} icon={Percent} />
              </div>

              <div className="flex items-center gap-3 text-xs border-t pt-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-chart-2" />
                  <span className="text-muted-foreground">Max Profit:</span>
                  <span className="font-medium font-mono text-chart-2" data-testid={`text-maxprofit-${c.rank}`}>
                    {c.maxProfit === -1 ? "Unlimited" : `$${c.maxProfit.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" />
                  <span className="text-muted-foreground">Max Loss:</span>
                  <span className="font-medium font-mono text-destructive" data-testid={`text-maxloss-${c.rank}`}>
                    ${c.maxLoss.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">B/E:</span>
                <span className="font-mono font-medium" data-testid={`text-breakeven-${c.rank}`}>${c.breakeven.toFixed(2)}</span>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground truncate cursor-help" data-testid={`text-rationale-card-${c.rank}`}>
                    {c.rationale}
                  </p>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-xs">{c.rationale}</p>
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function CandidatesListView({ candidates }: { candidates: OptionCandidate[] }) {
  if (candidates.length === 0) {
    return <EmptyState message="No trade ideas found for this scan" />;
  }

  return (
    <ScrollArea className="max-h-[600px]" data-testid="candidates-list-container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Stock</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead className="text-right">Strike</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">DTE</TableHead>
            <TableHead className="text-right">Premium</TableHead>
            <TableHead className="text-right">IV</TableHead>
            <TableHead className="text-right">Delta</TableHead>
            <TableHead className="text-right">PoP</TableHead>
            <TableHead className="text-right">Max Profit</TableHead>
            <TableHead className="text-right">Max Loss</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="hidden xl:table-cell">Why</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow key={`${c.symbol}-${c.strike}-${c.expiration}`} data-testid={`candidate-row-${c.rank}`}>
              <TableCell className="font-medium text-muted-foreground">{c.rank}</TableCell>
              <TableCell>
                <div>
                  <span className="font-medium" data-testid={`text-underlying-list-${c.rank}`}>{c.underlying}</span>
                  <span className="text-xs text-muted-foreground ml-1">${c.stockPrice.toFixed(0)}</span>
                </div>
              </TableCell>
              <TableCell>
                <VariantBadge variant={c.strategyVariant} optionType={c.optionType} />
              </TableCell>
              <TableCell className="text-right font-mono text-sm" data-testid={`text-strike-list-${c.rank}`}>
                {c.legs.length > 1
                  ? `${c.legs.map(l => `$${l.strike}`).join("/")}`
                  : `$${c.strike}`
                }
              </TableCell>
              <TableCell className="text-sm" data-testid={`text-exp-list-${c.rank}`}>
                {c.expiration}
              </TableCell>
              <TableCell className="text-right text-sm font-mono">
                {c.dte}d
              </TableCell>
              <TableCell className="text-right font-mono text-sm" data-testid={`text-premium-list-${c.rank}`}>
                ${c.mid.toFixed(2)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {c.impliedVol}%
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {c.delta}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {c.pop}%
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-chart-2">
                {c.maxProfit === -1 ? "Unlim." : `$${c.maxProfit.toLocaleString()}`}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-destructive">
                ${c.maxLoss.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                <ScoreBadge score={c.score} />
              </TableCell>
              <TableCell className="hidden xl:table-cell max-w-[200px]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-xs text-muted-foreground truncate cursor-help" data-testid={`text-rationale-list-${c.rank}`}>
                      {c.rationale}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <p className="text-xs">{c.rationale}</p>
                  </TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
