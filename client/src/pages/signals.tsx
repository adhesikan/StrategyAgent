import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, Target, AlertTriangle, Activity, X, ChevronRight, Plug, Settings, List, LayoutGrid, Search, ArrowUpDown, Zap, Clock } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PriceChart, TechnicalAnalysisWidget, VolumeProfileWidget } from "@/components/price-chart";
import { useBrokerStatus } from "@/hooks/use-broker-status";

interface ChartData {
  candles: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  ema9?: number[];
  ema21?: number[];
  ema50?: number[];
  resistance?: number;
  stopLoss?: number;
  ticker: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  avgVolume?: number;
  atr?: number;
  rvol?: number;
  patternScore?: number;
  stage?: string;
  contractionZones?: Array<{ start: string; end: string; highLevel: number; lowLevel: number }>;
  vcpAnnotations?: Array<{
    time: string;
    price: number;
    type: "pivot_high" | "pivot_low" | "contraction_start" | "breakout";
    label?: string;
  }>;
}

interface SignalCardProps {
  ticker: string;
  type: string;
  price: number;
  resistance: number;
  stopLoss: number;
  rvol: number;
  atr: number;
  strategy?: string;
  onClick: () => void;
}

function SignalCard({ ticker, type, price, resistance, stopLoss, rvol, atr, strategy, onClick }: SignalCardProps) {
  const upside = ((resistance - price) / price * 100).toFixed(1);
  const risk = ((price - stopLoss) / price * 100).toFixed(1);

  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer transition-all"
      onClick={onClick}
      data-testid={`signal-card-${ticker}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold font-mono">{ticker}</span>
            <Badge 
              variant={type === "BREAKOUT" ? "default" : type === "READY" ? "secondary" : "outline"}
              className="text-xs"
            >
              {type}
            </Badge>
          </div>
          <div className="text-right">
            <p className="font-mono font-bold">${price.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Current</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <Target className="h-3 w-3 text-chart-2" />
              Resistance
              <InfoTooltip term="resistance" />
            </p>
            <p className="font-mono font-medium text-chart-2">${resistance.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{upside}% upside</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              Stop Loss
              <InfoTooltip term="stopLoss" />
            </p>
            <p className="font-mono font-medium text-destructive">${stopLoss.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{risk}% risk</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">RVOL <InfoTooltip term="rvol" /></p>
            <p className={`font-mono font-medium ${rvol >= 1.5 ? "text-chart-2" : ""}`}>{rvol.toFixed(2)}x</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">ATR (14) <InfoTooltip term="atr" /></p>
            <p className="font-mono font-medium">${atr.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface SignalDetailDialogProps {
  open: boolean;
  onClose: () => void;
  ticker: string;
  patternScore?: number | null;
}

function SignalDetailDialog({ open, onClose, ticker, patternScore: propScore }: SignalDetailDialogProps) {
  const [showEMA9, setShowEMA9] = useState(true);
  const [showEMA21, setShowEMA21] = useState(true);
  const [showEMA50, setShowEMA50] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [showVCPOverlay, setShowVCPOverlay] = useState(true);

  const { data: chartData, isLoading } = useQuery<ChartData>({
    queryKey: ["/api/charts", ticker, "3M"],
    enabled: open && !!ticker,
  });

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-3 sticky top-0 bg-background z-10 border-b">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <DialogTitle className="flex items-center gap-2">
                <span className="text-xl font-bold font-mono">{ticker}</span>
                {chartData?.name && <span className="text-muted-foreground font-normal">{chartData.name}</span>}
              </DialogTitle>
              {chartData?.price && (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono font-semibold">${chartData.price.toFixed(2)}</span>
                  {chartData.changePercent !== undefined && (
                    <Badge
                      variant={chartData.changePercent >= 0 ? "default" : "destructive"}
                      className="font-mono text-xs"
                    >
                      {chartData.changePercent >= 0 ? "+" : ""}{chartData.changePercent.toFixed(2)}%
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {chartData?.stage && (
                <Badge variant={chartData.stage === "BREAKOUT" ? "default" : chartData.stage === "READY" ? "secondary" : "outline"}>
                  {chartData.stage}
                </Badge>
              )}
              {(propScore ?? chartData?.patternScore) != null && (
                <Badge variant="outline" className="font-mono">Score: {propScore ?? chartData?.patternScore}</Badge>
              )}
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onClose}
                data-testid="button-close-chart-dialog"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4">
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading chart...</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-0">
                    {chartData?.candles && chartData.candles.length > 0 ? (
                      <PriceChart
                        data={chartData.candles}
                        ema9={showEMA9 ? chartData.ema9 : undefined}
                        ema21={showEMA21 ? chartData.ema21 : undefined}
                        ema50={showEMA50 ? chartData.ema50 : undefined}
                        resistanceLevel={showLevels ? chartData.resistance : undefined}
                        stopLevel={showLevels ? chartData.stopLoss : undefined}
                        ticker={ticker}
                        showVCPOverlay={showVCPOverlay}
                        vcpAnnotations={chartData.vcpAnnotations}
                        contractionZones={chartData.contractionZones}
                        atr={chartData.atr}
                        className="h-[380px]"
                      />
                    ) : (
                      <div className="h-[380px] flex items-center justify-center text-muted-foreground">
                        No chart data available
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                  <Card>
                    <CardHeader className="pb-1 pt-3 px-3">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Resistance</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <span className="text-base font-mono font-semibold text-chart-2">
                        ${chartData?.resistance?.toFixed(2) || "-"}
                      </span>
                      {chartData?.resistance && chartData?.price && (
                        <p className="text-xs text-muted-foreground">
                          {((chartData.resistance - chartData.price) / chartData.price * 100).toFixed(1)}% upside
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 pt-3 px-3">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Stop Loss</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <span className="text-base font-mono font-semibold text-destructive">
                        ${chartData?.stopLoss?.toFixed(2) || "-"}
                      </span>
                      {chartData?.stopLoss && chartData?.price && (
                        <p className="text-xs text-muted-foreground">
                          {((chartData.price - chartData.stopLoss) / chartData.price * 100).toFixed(1)}% risk
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 pt-3 px-3">
                      <CardTitle className="text-xs font-medium text-muted-foreground">RVOL</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <span className={`text-base font-mono font-semibold ${(chartData?.rvol || 0) >= 1.5 ? "text-chart-2" : ""}`}>
                        {chartData?.rvol?.toFixed(2) || "-"}x
                      </span>
                      <p className="text-xs text-muted-foreground">vs 20-day avg</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 pt-3 px-3">
                      <CardTitle className="text-xs font-medium text-muted-foreground">ATR (14)</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <span className="text-base font-mono font-semibold">
                        ${chartData?.atr?.toFixed(2) || "-"}
                      </span>
                      {chartData?.atr && chartData?.price && (
                        <p className="text-xs text-muted-foreground">
                          {((chartData.atr / chartData.price) * 100).toFixed(1)}% of price
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Chart Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="ema9-d" className="text-sm flex items-center gap-2">
                        <span className="w-2.5 h-0.5 rounded-full bg-amber-500" />
                        EMA 9
                      </Label>
                      <Switch id="ema9-d" checked={showEMA9} onCheckedChange={setShowEMA9} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="ema21-d" className="text-sm flex items-center gap-2">
                        <span className="w-2.5 h-0.5 rounded-full bg-blue-500" />
                        EMA 21
                      </Label>
                      <Switch id="ema21-d" checked={showEMA21} onCheckedChange={setShowEMA21} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="ema50-d" className="text-sm flex items-center gap-2">
                        <span className="w-2.5 h-0.5 rounded-full bg-violet-500" />
                        EMA 50
                      </Label>
                      <Switch id="ema50-d" checked={showEMA50} onCheckedChange={setShowEMA50} />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label htmlFor="volume-d" className="text-sm">Volume Bars</Label>
                      <Switch id="volume-d" checked={showVolume} onCheckedChange={setShowVolume} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="levels-d" className="text-sm">Support/Resistance</Label>
                      <Switch id="levels-d" checked={showLevels} onCheckedChange={setShowLevels} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="vcp-d" className="text-sm">VCP Overlays</Label>
                      <Switch id="vcp-d" checked={showVCPOverlay} onCheckedChange={setShowVCPOverlay} />
                    </div>
                  </CardContent>
                </Card>

                {chartData && chartData.price && (
                  <TechnicalAnalysisWidget
                    ticker={ticker}
                    price={chartData.price}
                    change={chartData.change || 0}
                    changePercent={chartData.changePercent || 0}
                    ema9={chartData.ema9?.[chartData.ema9.length - 1]}
                    ema21={chartData.ema21?.[chartData.ema21.length - 1]}
                    ema50={chartData.ema50?.[chartData.ema50?.length - 1]}
                    resistance={chartData.resistance}
                    stopLoss={chartData.stopLoss}
                    atr={chartData.atr}
                    rvol={chartData.rvol}
                    patternScore={propScore ?? chartData.patternScore}
                    stage={chartData.stage}
                    volume={chartData.volume}
                    avgVolume={chartData.avgVolume}
                  />
                )}

                {chartData?.candles && chartData.candles.length > 0 && (
                  <VolumeProfileWidget data={chartData.candles} levels={10} />
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SortField = "ticker" | "type" | "price" | "rvol";
type SortDirection = "asc" | "desc";

type VCPTimeframe = "intraday" | "multiday";

const vcpDescriptions: Record<VCPTimeframe, { label: string; description: string }> = {
  intraday: {
    label: "Intraday VCP",
    description: "Same-day VCP detection using real-time quote data - identifies momentum breakouts with volume confirmation for day trading.",
  },
  multiday: {
    label: "Multiday VCP",
    description: "Multi-day VCP patterns using daily charts - identifies swing trade setups with volatility contraction over multiple sessions.",
  },
};

type StageFilter = "BREAKOUT" | "READY" | "FORMING";

export default function Signals() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "card">("card");
  const [vcpTimeframe, setVcpTimeframe] = useState<VCPTimeframe>("intraday");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("type");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [stageFilters, setStageFilters] = useState<Set<StageFilter>>(new Set<StageFilter>(["BREAKOUT", "READY", "FORMING"]));
  const { isConnected } = useBrokerStatus();

  const toggleStageFilter = (stage: StageFilter) => {
    setStageFilters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stage)) {
        if (newSet.size > 1) {
          newSet.delete(stage);
        }
      } else {
        newSet.add(stage);
      }
      return newSet;
    });
  };

  const { data: scanResults, isLoading } = useQuery<any[]>({
    queryKey: ["/api/scan/results"],
  });

  const signalData = useMemo(() => {
    // Filter by strategy based on timeframe selection
    const strategyFilter = vcpTimeframe === "intraday" ? "VCP" : "VCP_MULTIDAY";
    
    const mapped = (scanResults ?? []).filter(result => {
      const resultStrategy = result.strategy || "VCP";
      if (resultStrategy !== strategyFilter) return false;
      if ((result.changePercent ?? 0) < -2) return false;
      const e9 = result.ema9 ?? 0;
      const e21 = result.ema21 ?? 0;
      if (e9 > 0 && e21 > 0 && e9 < e21 * 0.98) return false;
      return true;
    }).map(result => ({
      id: result.ticker,
      ticker: result.ticker,
      type: result.stage,
      price: result.price,
      resistance: result.resistance,
      stopLoss: result.stopLoss,
      rvol: result.rvol || 1.0,
      atr: result.atr || result.price * 0.02,
      strategy: result.strategy || "VCP",
      patternScore: result.patternScore as number | null,
    }));

    // Filter by stage
    const stageFiltered = mapped.filter(s => stageFilters.has(s.type as StageFilter));

    // Filter by search query
    const filtered = searchQuery
      ? stageFiltered.filter(s => s.ticker.toLowerCase().includes(searchQuery.toLowerCase()))
      : stageFiltered;

    // Sort - custom order for stage: BREAKOUT first, then READY, then FORMING
    const stageOrder: Record<string, number> = { BREAKOUT: 0, READY: 1, FORMING: 2 };
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "ticker":
          comparison = a.ticker.localeCompare(b.ticker);
          break;
        case "type":
          // Use custom stage order instead of alphabetical
          comparison = (stageOrder[a.type] ?? 3) - (stageOrder[b.type] ?? 3);
          break;
        case "price":
          comparison = (a.price || 0) - (b.price || 0);
          break;
        case "rvol":
          comparison = (a.rvol || 0) - (b.rvol || 0);
          break;
      }
      // For stage sorting, always show BREAKOUT first (don't reverse)
      if (sortField === "type") {
        return comparison;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [scanResults, searchQuery, sortField, sortDirection, vcpTimeframe, stageFilters]);

  return (
    <div className="p-4 lg:p-6 space-y-6" data-testid="signals-page">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold tracking-tight">Breakout Alerts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time alerts when price and volume conditions trigger
            </p>
          </div>
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={vcpTimeframe === "intraday" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVcpTimeframe("intraday")}
              data-testid="button-vcp-intraday"
            >
              Intraday
            </Button>
            <Button
              variant={vcpTimeframe === "multiday" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVcpTimeframe("multiday")}
              data-testid="button-vcp-multiday"
            >
              Multiday
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="font-medium">{vcpDescriptions[vcpTimeframe].label}</Badge>
          <span className="text-muted-foreground">
            {vcpDescriptions[vcpTimeframe].description}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ticker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-48"
              data-testid="input-signals-search"
            />
          </div>
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={stageFilters.has("BREAKOUT") ? "default" : "ghost"}
              size="sm"
              onClick={() => toggleStageFilter("BREAKOUT")}
              className="gap-1"
              data-testid="button-filter-breakout"
            >
              <Zap className="h-3 w-3" />
              Breakout
            </Button>
            <Button
              variant={stageFilters.has("READY") ? "secondary" : "ghost"}
              size="sm"
              onClick={() => toggleStageFilter("READY")}
              className="gap-1"
              data-testid="button-filter-ready"
            >
              <Target className="h-3 w-3" />
              Ready
            </Button>
            <Button
              variant={stageFilters.has("FORMING") ? "outline" : "ghost"}
              size="sm"
              onClick={() => toggleStageFilter("FORMING")}
              className="gap-1"
              data-testid="button-filter-forming"
            >
              <Clock className="h-3 w-3" />
              Forming
            </Button>
          </div>
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger className="w-32" data-testid="select-signals-sort-field">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ticker">Ticker</SelectItem>
              <SelectItem value="type">Stage</SelectItem>
              <SelectItem value="price">Price</SelectItem>
              <SelectItem value="rvol">RVOL</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            data-testid="button-signals-sort-direction"
          >
            <ArrowUpDown className={`h-4 w-4 ${sortDirection === "desc" ? "rotate-180" : ""}`} />
          </Button>
        </div>
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="gap-1"
            data-testid="button-signals-view-list"
          >
            <List className="h-4 w-4" />
            List
          </Button>
          <Button
            variant={viewMode === "card" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("card")}
            className="gap-1"
            data-testid="button-signals-view-card"
          >
            <LayoutGrid className="h-4 w-4" />
            Cards
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-6 w-24" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : signalData.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            {!isConnected ? (
              <>
                <Plug className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-muted-foreground font-medium">No broker connected</p>
                <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                  Connect your brokerage account to see live trade signals
                </p>
                <Link href="/settings">
                  <Button variant="outline" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Connect Broker
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-muted-foreground">No active signals at this time</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Check back later for new trade opportunities</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "card" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {signalData.map((signal) => (
            <SignalCard
              key={signal.id}
              ticker={signal.ticker}
              type={signal.type}
              price={signal.price}
              resistance={signal.resistance}
              stopLoss={signal.stopLoss}
              rvol={signal.rvol}
              atr={signal.atr}
              strategy={signal.strategy}
              onClick={() => setSelectedTicker(signal.ticker)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Ticker</th>
                    <th className="text-left p-3 font-medium">Stage</th>
                    <th className="text-right p-3 font-medium">Price</th>
                    <th className="text-right p-3 font-medium">Resistance</th>
                    <th className="text-right p-3 font-medium">Stop Loss</th>
                    <th className="text-right p-3 font-medium">RVOL</th>
                  </tr>
                </thead>
                <tbody>
                  {signalData.map((signal) => (
                    <tr 
                      key={signal.id}
                      className="border-b hover-elevate active-elevate-2 cursor-pointer"
                      onClick={() => setSelectedTicker(signal.ticker)}
                      data-testid={`signal-row-${signal.ticker}`}
                    >
                      <td className="p-3">
                        <span className="font-bold font-mono">{signal.ticker}</span>
                      </td>
                      <td className="p-3">
                        <Badge 
                          variant={signal.type === "BREAKOUT" ? "default" : signal.type === "READY" ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {signal.type}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-mono">${signal.price?.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-chart-2">${signal.resistance?.toFixed(2) || "-"}</td>
                      <td className="p-3 text-right font-mono text-destructive">${signal.stopLoss?.toFixed(2) || "-"}</td>
                      <td className={`p-3 text-right font-mono ${signal.rvol >= 1.5 ? "text-chart-2" : ""}`}>
                        {signal.rvol?.toFixed(2)}x
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <SignalDetailDialog
        open={!!selectedTicker}
        onClose={() => setSelectedTicker(null)}
        ticker={selectedTicker || ""}
        patternScore={signalData.find(s => s.ticker === selectedTicker)?.patternScore}
      />

    </div>
  );
}
