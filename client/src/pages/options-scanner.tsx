import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { cn } from "@/lib/utils";
import type { PlatformUniverse, PlatformRiskProfile } from "@shared/platform-types";
import type { AutomationEndpoint } from "@shared/schema";
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
  Star,
  ChevronRight,
  ChevronUp,
  Zap,
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

  interface BrokerAccount {
    id: string;
    name: string;
    type: string;
    buyingPower: number;
    equity: number;
    currency: string;
  }

  const { data: brokerStatus } = useQuery<{ id: string; provider: string; isConnected: boolean } | null>({
    queryKey: ["/api/broker/status"],
  });

  const { data: brokerAccounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    enabled: !!brokerStatus?.isConnected,
  });

  const { data: automationEndpoints } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  const [instaTradeCandidate, setInstaTradeCandidate] = useState<OptionCandidate | null>(null);
  const [showInstaTradeDialog, setShowInstaTradeDialog] = useState(false);
  const [executionMethod, setExecutionMethod] = useState<"algopilotx" | "broker">("algopilotx");
  const [selectedEndpoint, setSelectedEndpoint] = useState<AutomationEndpoint | null>(null);
  const [selectedBrokerAccount, setSelectedBrokerAccount] = useState<BrokerAccount | null>(null);
  const [orderQuantity, setOrderQuantity] = useState<number>(1);

  const hasEndpoints = automationEndpoints && automationEndpoints.length > 0;
  const hasBrokerAccounts = brokerStatus?.isConnected && brokerAccounts.length > 0;

  const optionsInstatradeMutation = useMutation({
    mutationFn: async ({ endpointId, candidate }: { endpointId: string; candidate: OptionCandidate }) => {
      const response = await apiRequest("POST", "/api/instatrade/entry", {
        endpointId,
        symbol: candidate.underlying,
        strategyId: `options-${candidate.strategy}`,
        setupPayload: {
          price: candidate.stockPrice,
          optionSymbol: candidate.symbol,
          strike: candidate.strike,
          expiration: candidate.expiration,
          optionType: candidate.optionType,
          strategyVariant: candidate.strategyVariant,
          premium: candidate.mid,
          legs: candidate.legs,
          maxProfit: candidate.maxProfit,
          maxLoss: candidate.maxLoss,
          breakeven: candidate.breakeven,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "InstaTrade Sent",
        description: `Options entry signal sent for ${instaTradeCandidate?.underlying}`,
      });
      setShowInstaTradeDialog(false);
      setInstaTradeCandidate(null);
    },
    onError: (error: any) => {
      toast({
        title: "InstaTrade Failed",
        description: error.message || "Could not send entry signal",
        variant: "destructive",
      });
    },
  });

  const optionsBrokerOrderMutation = useMutation({
    mutationFn: async ({ accountId, candidate, quantity }: { accountId: string; candidate: OptionCandidate; quantity: number }) => {
      const response = await apiRequest("POST", "/api/broker/orders", {
        accountId,
        symbol: candidate.symbol,
        side: candidate.legs.length > 0 && candidate.legs[0].side === "sell" ? "sell" : "buy",
        quantity,
        orderType: "limit",
        price: candidate.mid,
        duration: "day",
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Order Placed",
        description: `Options order for ${instaTradeCandidate?.underlying} submitted`,
      });
      setShowInstaTradeDialog(false);
      setInstaTradeCandidate(null);
      globalQueryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
    },
    onError: (error: any) => {
      let description = "Could not place order";
      try {
        const jsonMatch = error.message?.match(/\{.*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          description = parsed.error || description;
        } else {
          description = error.message || description;
        }
      } catch {
        description = error.message || description;
      }
      toast({
        title: "Order Failed",
        description,
        variant: "destructive",
      });
    },
  });

  const handleOptionInstaTrade = (candidate: OptionCandidate) => {
    setInstaTradeCandidate(candidate);
    if (hasEndpoints) {
      setSelectedEndpoint(automationEndpoints![0]);
      setExecutionMethod("algopilotx");
    }
    if (hasBrokerAccounts && !hasEndpoints) {
      setExecutionMethod("broker");
      if (brokerAccounts.length > 0) setSelectedBrokerAccount(brokerAccounts[0]);
    } else if (hasBrokerAccounts) {
      if (brokerAccounts.length > 0) setSelectedBrokerAccount(brokerAccounts[0]);
    }
    setShowInstaTradeDialog(true);
  };

  const handleConfirmOptionInstaTrade = () => {
    if (executionMethod === "algopilotx" && selectedEndpoint && instaTradeCandidate) {
      optionsInstatradeMutation.mutate({ endpointId: selectedEndpoint.id, candidate: instaTradeCandidate });
    } else if (executionMethod === "broker" && selectedBrokerAccount && instaTradeCandidate) {
      optionsBrokerOrderMutation.mutate({
        accountId: selectedBrokerAccount.id,
        candidate: instaTradeCandidate,
        quantity: orderQuantity,
      });
    }
  };

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
                  <CandidatesCardView candidates={scanResult.candidates} onInstaTrade={handleOptionInstaTrade} canInstaTrade={!!(hasEndpoints || hasBrokerAccounts)} />
                ) : (
                  <CandidatesListView candidates={scanResult.candidates} onInstaTrade={handleOptionInstaTrade} canInstaTrade={!!(hasEndpoints || hasBrokerAccounts)} />
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

      <Dialog open={showInstaTradeDialog} onOpenChange={setShowInstaTradeDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-options-instatrade">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              InstaTrade - Options
            </DialogTitle>
            <DialogDescription>
              {instaTradeCandidate && (
                <span>
                  {instaTradeCandidate.strategyVariant} on {instaTradeCandidate.underlying} — ${instaTradeCandidate.strike} {instaTradeCandidate.optionType} exp {instaTradeCandidate.expiration}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {instaTradeCandidate && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Premium:</span>
                  <span className="ml-1 font-mono font-medium">${instaTradeCandidate.mid.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Max Loss:</span>
                  <span className="ml-1 font-mono font-medium text-destructive">${instaTradeCandidate.maxLoss.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Max Profit:</span>
                  <span className="ml-1 font-mono font-medium text-chart-2">
                    {instaTradeCandidate.maxProfit === -1 ? "Unlimited" : `$${instaTradeCandidate.maxProfit.toLocaleString()}`}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">PoP:</span>
                  <span className="ml-1 font-mono font-medium">{instaTradeCandidate.pop}%</span>
                </div>
              </div>

              {instaTradeCandidate.legs.length > 1 && (
                <div className="space-y-1 p-2 rounded-md bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground">Legs:</p>
                  {instaTradeCandidate.legs.map((leg, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-xs capitalize">{leg.side}</Badge>
                      <span className="font-mono">${leg.strike} {leg.optionType}</span>
                      <span className="text-muted-foreground">{leg.expiration}</span>
                    </div>
                  ))}
                </div>
              )}

              <RadioGroup
                value={executionMethod}
                onValueChange={(v) => setExecutionMethod(v as "algopilotx" | "broker")}
                className="space-y-2"
                data-testid="radio-execution-method"
              >
                {hasEndpoints && (
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <RadioGroupItem value="algopilotx" id="opt-algopilotx" />
                    <Label htmlFor="opt-algopilotx" className="flex-1 cursor-pointer">
                      <div className="font-medium text-sm">AlgoPilotX (Automation)</div>
                      <div className="text-xs text-muted-foreground">Send signal to your automation endpoint</div>
                    </Label>
                  </div>
                )}
                {hasBrokerAccounts && (
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <RadioGroupItem value="broker" id="opt-broker" />
                    <Label htmlFor="opt-broker" className="flex-1 cursor-pointer">
                      <div className="font-medium text-sm">Direct Broker Order</div>
                      <div className="text-xs text-muted-foreground">Place limit order via {brokerStatus?.provider}</div>
                    </Label>
                  </div>
                )}
              </RadioGroup>

              {executionMethod === "algopilotx" && hasEndpoints && (
                <div className="space-y-2">
                  <Label className="text-xs">Automation Endpoint</Label>
                  <Select
                    value={selectedEndpoint?.id || ""}
                    onValueChange={(v) => setSelectedEndpoint(automationEndpoints!.find(e => e.id === v) || null)}
                  >
                    <SelectTrigger data-testid="select-endpoint">
                      <SelectValue placeholder="Select endpoint" />
                    </SelectTrigger>
                    <SelectContent>
                      {automationEndpoints!.map((ep) => (
                        <SelectItem key={ep.id} value={ep.id}>{ep.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {executionMethod === "broker" && hasBrokerAccounts && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Account</Label>
                    <Select
                      value={selectedBrokerAccount?.id || ""}
                      onValueChange={(v) => setSelectedBrokerAccount(brokerAccounts.find(a => a.id === v) || null)}
                    >
                      <SelectTrigger data-testid="select-broker-account">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {brokerAccounts.map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            {acc.name} (${acc.buyingPower.toLocaleString()} BP)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Contracts</Label>
                    <Input
                      type="number"
                      min={1}
                      value={orderQuantity}
                      onChange={(e) => setOrderQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInstaTradeDialog(false)} data-testid="button-cancel-instatrade">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmOptionInstaTrade}
              disabled={
                optionsInstatradeMutation.isPending ||
                optionsBrokerOrderMutation.isPending ||
                (executionMethod === "algopilotx" && !selectedEndpoint) ||
                (executionMethod === "broker" && !selectedBrokerAccount)
              }
              data-testid="button-confirm-instatrade"
            >
              {(optionsInstatradeMutation.isPending || optionsBrokerOrderMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Zap className="h-4 w-4 mr-1" />
              )}
              {executionMethod === "broker" ? "Place Order" : "Send Signal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function splitTopPicks(candidates: OptionCandidate[]): { topPicks: OptionCandidate[]; others: OptionCandidate[] } {
  if (candidates.length <= 6) {
    return { topPicks: candidates, others: [] };
  }
  const TOP_SCORE_THRESHOLD = 95;
  const MIN_POP_THRESHOLD = 60;
  const MIN_TOP_PICKS = 3;
  const MAX_TOP_PICKS = 12;

  const topPicks = candidates.filter(
    (c) => c.score >= TOP_SCORE_THRESHOLD && c.pop >= MIN_POP_THRESHOLD
  );

  if (topPicks.length >= MIN_TOP_PICKS && topPicks.length <= MAX_TOP_PICKS) {
    const topSet = new Set(topPicks.map(c => `${c.symbol}-${c.strike}-${c.expiration}`));
    return {
      topPicks,
      others: candidates.filter(c => !topSet.has(`${c.symbol}-${c.strike}-${c.expiration}`)),
    };
  }

  const sorted = [...candidates].sort((a, b) => {
    const scoreA = a.score * 0.4 + a.pop * 0.3 + a.premiumPct * 20 * 0.3;
    const scoreB = b.score * 0.4 + b.pop * 0.3 + b.premiumPct * 20 * 0.3;
    return scoreB - scoreA;
  });

  const count = Math.min(MAX_TOP_PICKS, Math.max(MIN_TOP_PICKS, Math.ceil(candidates.length * 0.05)));
  const topSet = new Set(sorted.slice(0, count).map(c => `${c.symbol}-${c.strike}-${c.expiration}`));

  return {
    topPicks: candidates.filter(c => topSet.has(`${c.symbol}-${c.strike}-${c.expiration}`)),
    others: candidates.filter(c => !topSet.has(`${c.symbol}-${c.strike}-${c.expiration}`)),
  };
}

function CandidateCard({ c, isTopPick, onInstaTrade, canInstaTrade }: { c: OptionCandidate; isTopPick?: boolean; onInstaTrade?: (c: OptionCandidate) => void; canInstaTrade?: boolean }) {
  return (
    <Card
      className={cn("overflow-visible", isTopPick && "border-primary/30 bg-primary/[0.02]")}
      data-testid={`candidate-card-${c.rank}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {isTopPick && <Star className="h-3.5 w-3.5 text-primary fill-primary shrink-0" />}
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

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">B/E:</span>
            <span className="font-mono font-medium" data-testid={`text-breakeven-${c.rank}`}>${c.breakeven.toFixed(2)}</span>
          </div>
          {onInstaTrade && canInstaTrade && (
            <Button
              size="sm"
              onClick={() => onInstaTrade(c)}
              data-testid={`button-instatrade-option-${c.rank}`}
            >
              <Zap className="h-3.5 w-3.5 mr-1" />
              InstaTrade
            </Button>
          )}
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
  );
}

function CandidatesCardView({ candidates, onInstaTrade, canInstaTrade }: { candidates: OptionCandidate[]; onInstaTrade?: (c: OptionCandidate) => void; canInstaTrade?: boolean }) {
  const [showOthers, setShowOthers] = useState(false);

  if (candidates.length === 0) {
    return <EmptyState message="No trade ideas found for this scan" />;
  }

  const { topPicks, others } = splitTopPicks(candidates);

  return (
    <div className="space-y-4" data-testid="candidates-card-container">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-primary fill-primary" />
          <h3 className="text-sm font-semibold">Top Picks</h3>
          <Badge variant="secondary" className="text-xs" data-testid="badge-top-picks-count">
            {topPicks.length}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-options-top-picks-info-card" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Top Picks are selected using a composite score: overall score (&ge;95) combined with probability of profit (&ge;60%), or the top 5% of all results. Higher premium and better risk/reward boost rankings.
            </TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground">Highest confidence based on score, probability, and premium</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {topPicks.map((c) => (
            <CandidateCard key={`${c.symbol}-${c.strike}-${c.expiration}`} c={c} isTopPick onInstaTrade={onInstaTrade} canInstaTrade={canInstaTrade} />
          ))}
        </div>
      </div>

      {others.length > 0 && (
        <Collapsible open={showOthers} onOpenChange={setShowOthers}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between gap-2"
              data-testid="button-toggle-others"
            >
              <span className="flex items-center gap-2 text-sm">
                More Results
                <Badge variant="outline" className="text-xs">{others.length}</Badge>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showOthers && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
              {others.map((c) => (
                <CandidateCard key={`${c.symbol}-${c.strike}-${c.expiration}`} c={c} onInstaTrade={onInstaTrade} canInstaTrade={canInstaTrade} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function CandidateTableRows({ candidates, isTopPick, onInstaTrade, canInstaTrade }: { candidates: OptionCandidate[]; isTopPick?: boolean; onInstaTrade?: (c: OptionCandidate) => void; canInstaTrade?: boolean }) {
  return (
    <>
      {candidates.map((c) => (
        <TableRow
          key={`${c.symbol}-${c.strike}-${c.expiration}`}
          className={cn(isTopPick && "bg-primary/[0.02]")}
          data-testid={`candidate-row-${c.rank}`}
        >
          <TableCell className="font-medium text-muted-foreground">
            <div className="flex items-center gap-1">
              {isTopPick && <Star className="h-3 w-3 text-primary fill-primary shrink-0" />}
              {c.rank}
            </div>
          </TableCell>
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
          <TableCell>
            {onInstaTrade && canInstaTrade && (
              <Button
                size="icon"
                onClick={() => onInstaTrade(c)}
                data-testid={`button-instatrade-option-row-${c.rank}`}
              >
                <Zap className="h-3.5 w-3.5" />
              </Button>
            )}
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
    </>
  );
}

type OptionSortField = "rank" | "underlying" | "strategyVariant" | "strike" | "expiration" | "dte" | "mid" | "impliedVol" | "delta" | "pop" | "maxProfit" | "maxLoss" | "score";
type OptionSortDirection = "asc" | "desc";

function CandidatesListView({ candidates, onInstaTrade, canInstaTrade }: { candidates: OptionCandidate[]; onInstaTrade?: (c: OptionCandidate) => void; canInstaTrade?: boolean }) {
  const [showOthers, setShowOthers] = useState(false);
  const [sortField, setSortField] = useState<OptionSortField>("score");
  const [sortDirection, setSortDirection] = useState<OptionSortDirection>("desc");

  const handleSort = (field: OptionSortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const sortCandidates = (items: OptionCandidate[]) => {
    return [...items].sort((a, b) => {
      const modifier = sortDirection === "asc" ? 1 : -1;
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return aVal.localeCompare(bVal) * modifier;
      }
      return ((aVal as number) - (bVal as number)) * modifier;
    });
  };

  const OptionSortHeader = ({ field, children, className }: { field: OptionSortField; children: React.ReactNode; className?: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-3 gap-1 font-medium", className)}
      onClick={() => handleSort(field)}
      data-testid={`sort-option-${field}`}
    >
      {children}
      {sortField === field ? (
        sortDirection === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </Button>
  );

  if (candidates.length === 0) {
    return <EmptyState message="No trade ideas found for this scan" />;
  }

  const { topPicks, others } = splitTopPicks(candidates);
  const sortedTopPicks = sortCandidates(topPicks);
  const sortedOthers = sortCandidates(others);

  const listHeader = (
    <TableHeader className="sticky top-0 z-10 bg-card">
      <TableRow>
        <TableHead className="w-12">
          <OptionSortHeader field="rank">#</OptionSortHeader>
        </TableHead>
        <TableHead>
          <OptionSortHeader field="underlying">Stock</OptionSortHeader>
        </TableHead>
        <TableHead>
          <OptionSortHeader field="strategyVariant">Strategy</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="strike">Strike</OptionSortHeader>
        </TableHead>
        <TableHead>
          <OptionSortHeader field="expiration">Expires</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="dte">DTE</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="mid">Premium</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="impliedVol">IV</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="delta">Delta</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="pop">PoP</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="maxProfit">Max Profit</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="maxLoss">Max Loss</OptionSortHeader>
        </TableHead>
        <TableHead className="text-right">
          <OptionSortHeader field="score">Score</OptionSortHeader>
        </TableHead>
        {canInstaTrade && <TableHead className="w-[50px]"></TableHead>}
        <TableHead className="hidden xl:table-cell">Why</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="space-y-4" data-testid="candidates-list-container">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-primary fill-primary" />
          <h3 className="text-sm font-semibold">Top Picks</h3>
          <Badge variant="secondary" className="text-xs" data-testid="badge-top-picks-count-list">
            {sortedTopPicks.length}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-options-top-picks-info-list" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Top Picks are selected using a composite score: overall score (&ge;95) combined with probability of profit (&ge;60%), or the top 5% of all results. Higher premium and better risk/reward boost rankings.
            </TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground">Highest confidence based on score, probability, and premium</span>
        </div>
        <Table>
          {listHeader}
          <TableBody>
            <CandidateTableRows candidates={sortedTopPicks} isTopPick onInstaTrade={onInstaTrade} canInstaTrade={canInstaTrade} />
          </TableBody>
        </Table>
      </div>

      {sortedOthers.length > 0 && (
        <Collapsible open={showOthers} onOpenChange={setShowOthers}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between gap-2"
              data-testid="button-toggle-others-list"
            >
              <span className="flex items-center gap-2 text-sm">
                More Results
                <Badge variant="outline" className="text-xs">{sortedOthers.length}</Badge>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showOthers && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-md border mt-3">
              <Table>
                {listHeader}
                <TableBody>
                  <CandidateTableRows candidates={sortedOthers} onInstaTrade={onInstaTrade} canInstaTrade={canInstaTrade} />
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
