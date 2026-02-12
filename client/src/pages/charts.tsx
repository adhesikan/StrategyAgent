import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, ExternalLink, Plug, Settings, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  PriceChart, 
  ChartPlaceholder, 
  TechnicalAnalysisWidget,
  VolumeProfileWidget,
  ChartControlsWidget,
} from "@/components/price-chart";
import type { ScanResult } from "@shared/schema";

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
  requiresBroker?: boolean;
  error?: string;
  isLive?: boolean;
}

export default function Charts() {
  const [, params] = useRoute("/charts/:ticker");
  const [, navigate] = useLocation();
  const initialTicker = params?.ticker || "";
  
  const [searchInput, setSearchInput] = useState(initialTicker);
  const [selectedTicker, setSelectedTicker] = useState(initialTicker);
  const timeframe = "3M";
  
  const [showEMA9, setShowEMA9] = useState(true);
  const [showEMA21, setShowEMA21] = useState(true);
  const [showEMA50, setShowEMA50] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [showVCPOverlay, setShowVCPOverlay] = useState(true);

  useEffect(() => {
    if (params?.ticker) {
      setSelectedTicker(params.ticker);
      setSearchInput(params.ticker);
    }
  }, [params?.ticker]);

  const { data: chartData, isLoading: chartLoading, isFetching: chartFetching } = useQuery<ChartData>({
    queryKey: ["/api/charts", selectedTicker, timeframe],
    enabled: !!selectedTicker,
    refetchInterval: 30000, // Refresh every 30 seconds for live data
    staleTime: 10000, // Consider data stale after 10 seconds
  });

  const { data: scanResult } = useQuery<ScanResult | null>({
    queryKey: ["/api/scan/result", selectedTicker],
    enabled: !!selectedTicker,
  });

  const handleSearch = () => {
    if (searchInput.trim()) {
      setSelectedTicker(searchInput.trim().toUpperCase());
    }
  };

  const formatVolume = (vol: number | undefined) => {
    if (!vol) return "-";
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toFixed(0);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="charts-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/scanner")}
            data-testid="button-close-chart"
          >
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold tracking-tight">Charts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Review price action and levels for context
            </p>
          </div>
        </div>

        <div className="relative flex-1 min-w-[180px] lg:w-64 lg:flex-none">
          <Input
            placeholder="Enter symbol..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="font-mono pr-10"
            data-testid="input-ticker-search"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full"
            onClick={handleSearch}
            data-testid="button-search"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {selectedTicker && chartData && chartData.requiresBroker && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2">
          <Plug className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
            Showing sample data. Connect your broker for live market data.
          </p>
          <Link href="/settings">
            <Button variant="outline" size="sm" className="gap-1">
              <Settings className="h-3 w-3" />
              Connect
            </Button>
          </Link>
        </div>
      )}

      {selectedTicker && chartData && (
        <div className="flex flex-wrap items-center gap-3 bg-card border rounded-lg px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl lg:text-2xl font-bold font-mono">{selectedTicker}</span>
            {chartData?.name && (
              <span className="text-sm text-muted-foreground hidden sm:inline">{chartData.name}</span>
            )}
            {chartData?.isLive && (
              <Badge variant="outline" className="text-xs text-status-online border-status-online/30 gap-1">
                {chartFetching && <span className="h-1.5 w-1.5 rounded-full bg-status-online animate-pulse" />}
                Live
              </Badge>
            )}
          </div>

          {chartData?.price && (
            <div className="flex items-center gap-2">
              <span className="text-lg lg:text-xl font-mono font-semibold">
                ${chartData.price.toFixed(2)}
              </span>
              {chartData.changePercent !== undefined && (
                <Badge
                  variant={chartData.changePercent >= 0 ? "default" : "destructive"}
                  className="font-mono text-xs"
                >
                  {chartData.changePercent >= 0 ? "+" : ""}
                  {chartData.changePercent.toFixed(2)}%
                </Badge>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {scanResult?.stage && (
              <Badge 
                variant={
                  scanResult.stage === "BREAKOUT" ? "default" :
                  scanResult.stage === "READY" ? "secondary" : "outline"
                }
                className="text-xs"
              >
                {scanResult.stage}
              </Badge>
            )}
            {(scanResult?.patternScore ?? chartData?.patternScore) != null && (
              <Badge variant="outline" className="font-mono text-xs">
                Score: {scanResult?.patternScore ?? chartData?.patternScore}
              </Badge>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              {chartLoading ? (
                <div className="h-[450px] lg:h-[550px] flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Loading chart data...</p>
                  </div>
                </div>
              ) : chartData?.candles && chartData.candles.length > 0 ? (
                <PriceChart
                  data={chartData.candles}
                  ema9={showEMA9 ? chartData.ema9 : undefined}
                  ema21={showEMA21 ? chartData.ema21 : undefined}
                  ema50={showEMA50 ? chartData.ema50 : undefined}
                  resistanceLevel={showLevels ? (scanResult?.resistance || chartData.resistance) : undefined}
                  stopLevel={showLevels ? (scanResult?.stopLoss || chartData.stopLoss) : undefined}
                  ticker={selectedTicker}
                  showVCPOverlay={showVCPOverlay}
                  showVolume={showVolume}
                  vcpAnnotations={chartData.vcpAnnotations}
                  contractionZones={chartData.contractionZones}
                  atr={chartData.atr}
                  className="h-[450px] lg:h-[550px]"
                />
              ) : (
                <ChartPlaceholder />
              )}
            </CardContent>
          </Card>

          {chartData?.candles && chartData.candles.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Resistance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-lg font-mono font-semibold text-chart-2">
                    ${(scanResult?.resistance || chartData.resistance)?.toFixed(2) || "-"}
                  </span>
                  {(scanResult?.resistance || chartData.resistance) && chartData.price && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(((scanResult?.resistance || chartData.resistance)! - chartData.price) / chartData.price * 100).toFixed(1)}% upside
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Stop Loss
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-lg font-mono font-semibold text-destructive">
                    ${(scanResult?.stopLoss || chartData.stopLoss)?.toFixed(2) || "-"}
                  </span>
                  {(scanResult?.stopLoss || chartData.stopLoss) && chartData.price && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {((chartData.price - (scanResult?.stopLoss || chartData.stopLoss)!) / chartData.price * 100).toFixed(1)}% risk
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    RVOL
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className={`text-lg font-mono font-semibold ${(chartData.rvol || scanResult?.rvol || 0) >= 1.5 ? "text-chart-2" : ""}`}>
                    {chartData.rvol?.toFixed(2) || scanResult?.rvol?.toFixed(2) || "-"}x
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    vs 20-day avg
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    ATR (14)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-lg font-mono font-semibold">
                    ${chartData.atr?.toFixed(2) || scanResult?.atr?.toFixed(2) || "-"}
                  </span>
                  {chartData.atr && chartData.price && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {((chartData.atr / chartData.price) * 100).toFixed(1)}% of price
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card data-testid="chart-controls-widget">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Chart Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="ema9" className="text-sm flex items-center gap-2">
                  <span className="w-2.5 h-0.5 rounded-full bg-amber-500" />
                  EMA 9
                </Label>
                <Switch id="ema9" checked={showEMA9} onCheckedChange={setShowEMA9} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ema21" className="text-sm flex items-center gap-2">
                  <span className="w-2.5 h-0.5 rounded-full bg-blue-500" />
                  EMA 21
                </Label>
                <Switch id="ema21" checked={showEMA21} onCheckedChange={setShowEMA21} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ema50" className="text-sm flex items-center gap-2">
                  <span className="w-2.5 h-0.5 rounded-full bg-violet-500" />
                  EMA 50
                </Label>
                <Switch id="ema50" checked={showEMA50} onCheckedChange={setShowEMA50} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <Label htmlFor="volume" className="text-sm">Volume Bars</Label>
                <Switch id="volume" checked={showVolume} onCheckedChange={setShowVolume} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="levels" className="text-sm">Support/Resistance</Label>
                <Switch id="levels" checked={showLevels} onCheckedChange={setShowLevels} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="vcp" className="text-sm">VCP Overlays</Label>
                <Switch id="vcp" checked={showVCPOverlay} onCheckedChange={setShowVCPOverlay} />
              </div>
            </CardContent>
          </Card>

          {chartData && chartData.price && (
            <TechnicalAnalysisWidget
              ticker={selectedTicker}
              price={chartData.price}
              change={chartData.change || 0}
              changePercent={chartData.changePercent || 0}
              ema9={chartData.ema9?.[chartData.ema9.length - 1]}
              ema21={chartData.ema21?.[chartData.ema21.length - 1]}
              ema50={chartData.ema50?.[chartData.ema50?.length - 1]}
              resistance={scanResult?.resistance || chartData.resistance}
              stopLoss={scanResult?.stopLoss || chartData.stopLoss}
              atr={chartData.atr}
              rvol={scanResult?.rvol || chartData.rvol}
              patternScore={scanResult?.patternScore || chartData.patternScore}
              stage={scanResult?.stage || chartData.stage}
              volume={chartData.volume}
              avgVolume={chartData.avgVolume}
            />
          )}

          {chartData?.candles && chartData.candles.length > 0 && (
            <VolumeProfileWidget data={chartData.candles} levels={12} />
          )}
        </div>
      </div>
    </div>
  );
}
