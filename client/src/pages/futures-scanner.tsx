import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTheme } from "@/lib/theme-provider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  Activity,
  Zap,
  TrendingUp,
  TrendingDown,
  Search,
  Bot,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Radio,
} from "lucide-react";

interface FuturesSymbolInfo {
  symbol: string;
  name: string;
  tickSize: number;
  pointValue: number;
}

interface FuturesStatus {
  enabled: boolean;
  workerRunning: boolean;
  subscribedSymbols: string[];
  availableSymbols: FuturesSymbolInfo[];
  agent: {
    enabled: boolean;
    symbol: string;
    minScore: number;
    maxTradesPerDay: number;
    maxPosition: number;
    tradesToday: number;
  } | null;
}

interface FuturesBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

interface FuturesTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

interface BarsResponse {
  bars: FuturesBar[];
  lastTick: FuturesTick | null;
}

interface FuturesOpportunity {
  symbol: string;
  setup: string;
  score: number;
  entry: number;
  stop: number;
  target: number;
  side: "buy" | "sell";
  timeframe: string;
  reason: string;
}

interface AgentAuditEntry {
  id: number;
  createdAt: string;
  action: string;
  symbol: string;
  details: any;
}

export default function FuturesScanner() {
  const { theme } = useTheme();
  const { toast } = useToast();
  const [selectedSymbol, setSelectedSymbol] = useState("MES");
  const [streamStatus, setStreamStatus] = useState<"disconnected" | "connected" | "streaming">("disconnected");
  const [lastTick, setLastTick] = useState<FuturesTick | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentMinScore, setAgentMinScore] = useState(70);
  const [agentMaxTrades, setAgentMaxTrades] = useState(5);
  const [agentMaxPosition, setAgentMaxPosition] = useState(2);

  const [instaTradeOpp, setInstaTradeOpp] = useState<FuturesOpportunity | null>(null);
  const [instaTradeOpen, setInstaTradeOpen] = useState(false);
  const [instaQty, setInstaQty] = useState(1);
  const [instaOrderType, setInstaOrderType] = useState<"market" | "limit">("market");
  const [instaLimitPrice, setInstaLimitPrice] = useState("");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<FuturesStatus>({
    queryKey: ["/api/futures/status"],
  });

  const { data: barsData, isLoading: barsLoading } = useQuery<BarsResponse>({
    queryKey: ["/api/futures/bars", selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/futures/bars?symbol=${selectedSymbol}&limit=300`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch bars");
      return res.json();
    },
  });

  const [opportunities, setOpportunities] = useState<FuturesOpportunity[]>([]);
  const [scanLoading, setScanLoading] = useState(false);

  const handleScan = useCallback(async () => {
    setScanLoading(true);
    try {
      const res = await fetch(`/api/futures/scan?symbol=${selectedSymbol}`, { credentials: "include" });
      if (!res.ok) throw new Error("Scan failed");
      const data = await res.json();
      setOpportunities(data);
      toast({ title: "Scan Complete", description: `Found ${data.length} opportunities` });
    } catch {
      toast({ title: "Scan Failed", description: "Could not scan for opportunities", variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  }, [selectedSymbol, toast]);

  const { data: auditLog } = useQuery<AgentAuditEntry[]>({
    queryKey: ["/api/futures/agent/audit"],
    queryFn: async () => {
      const res = await fetch("/api/futures/agent/audit?limit=20", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: agentOpen,
  });

  const subscribeMutation = useMutation({
    mutationFn: async (action: "subscribe" | "unsubscribe") => {
      await apiRequest("POST", "/api/futures/command", {
        commandType: action,
        symbol: selectedSymbol,
      });
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/futures/status"] });
      toast({ title: action === "subscribe" ? "Subscribed" : "Unsubscribed", description: `${selectedSymbol} market data ${action === "subscribe" ? "started" : "stopped"}` });
    },
    onError: (err: any) => {
      toast({ title: "Command Failed", description: err.message, variant: "destructive" });
    },
  });

  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      if (!instaTradeOpp) throw new Error("No opportunity selected");
      const payload: any = {
        commandType: "placeOrder",
        symbol: instaTradeOpp.symbol,
        side: instaTradeOpp.side,
        qty: instaQty,
        orderType: instaOrderType,
      };
      if (instaOrderType === "limit") {
        payload.limitPrice = parseFloat(instaLimitPrice) || instaTradeOpp.entry;
      }
      await apiRequest("POST", "/api/futures/command", payload);
    },
    onSuccess: () => {
      toast({ title: "Order Placed", description: `${instaTradeOpp?.side.toUpperCase()} ${instaQty} ${instaTradeOpp?.symbol}` });
      setInstaTradeOpen(false);
      setInstaTradeOpp(null);
      queryClient.invalidateQueries({ queryKey: ["/api/futures/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/positions"] });
    },
    onError: (err: any) => {
      toast({ title: "Order Failed", description: err.message, variant: "destructive" });
    },
  });

  const agentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/futures/command", {
        commandType: "toggleAgent",
        enabled: agentEnabled,
        symbol: selectedSymbol,
        minScore: agentMinScore,
        maxTradesPerDay: agentMaxTrades,
        maxPosition: agentMaxPosition,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/futures/status"] });
      toast({ title: "Agent Updated", description: agentEnabled ? "Auto agent enabled" : "Auto agent disabled" });
    },
    onError: (err: any) => {
      toast({ title: "Agent Update Failed", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (status?.agent) {
      setAgentEnabled(status.agent.enabled);
      setAgentMinScore(status.agent.minScore);
      setAgentMaxTrades(status.agent.maxTradesPerDay);
      setAgentMaxPosition(status.agent.maxPosition);
    }
  }, [status?.agent]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isDark = theme === "dark";

    if (chartApiRef.current) {
      chartApiRef.current.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#1a1a2e" : "#ffffff" },
        textColor: isDark ? "#d1d5db" : "#333333",
      },
      grid: {
        vertLines: { color: isDark ? "#2a2a4a" : "#e5e7eb" },
        horzLines: { color: isDark ? "#2a2a4a" : "#e5e7eb" },
      },
      rightPriceScale: {
        borderColor: isDark ? "#2a2a4a" : "#e5e7eb",
      },
      timeScale: {
        borderColor: isDark ? "#2a2a4a" : "#e5e7eb",
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
      },
      crosshair: {
        mode: 0,
      },
    });

    chartApiRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    seriesRef.current = series;

    if (barsData?.bars && barsData.bars.length > 0) {
      const chartBars = barsData.bars.map((b) => ({
        time: b.time as any,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      series.setData(chartBars);
      chart.timeScale().scrollToRealTime();
    }

    if (barsData?.lastTick) {
      setLastTick(barsData.lastTick);
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
    };
  }, [theme, barsData, selectedSymbol]);

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const isSubscribed = status?.subscribedSymbols?.includes(selectedSymbol);
    if (!isSubscribed) {
      setStreamStatus("disconnected");
      return;
    }

    try {
      const es = new EventSource(`/api/futures/stream?symbol=${selectedSymbol}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStreamStatus("connected");
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "connected") {
            setStreamStatus("connected");
          } else if (msg.type === "tick") {
            setStreamStatus("streaming");
            setLastTick(msg.data);
          } else if (msg.type === "bar") {
            setStreamStatus("streaming");
            if (seriesRef.current) {
              seriesRef.current.update({
                time: msg.data.time as any,
                open: msg.data.open,
                high: msg.data.high,
                low: msg.data.low,
                close: msg.data.close,
              });
            }
          }
        } catch {}
      };

      es.onerror = () => {
        setStreamStatus("disconnected");
      };
    } catch {
      setStreamStatus("disconnected");
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [selectedSymbol, status?.subscribedSymbols]);

  useEffect(() => {
    if (streamStatus === "streaming") return;

    const isSubscribed = status?.subscribedSymbols?.includes(selectedSymbol);
    if (!isSubscribed) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/futures/bars?symbol=${selectedSymbol}&limit=5`, { credentials: "include" });
        if (!res.ok) return;
        const data: BarsResponse = await res.json();
        if (data.lastTick) setLastTick(data.lastTick);
        if (seriesRef.current && data.bars.length > 0) {
          const latest = data.bars[data.bars.length - 1];
          seriesRef.current.update({
            time: latest.time as any,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
          });
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [streamStatus, selectedSymbol, status?.subscribedSymbols]);

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-futures">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div className="flex items-center justify-center h-full p-6" data-testid="futures-disabled">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <WifiOff className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle data-testid="text-futures-disabled">Futures Trading Disabled</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground" data-testid="text-futures-disabled-message">
              Futures trading is not currently enabled. Contact support or enable it in your settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSubscribed = status.subscribedSymbols?.includes(selectedSymbol);
  const availableSymbols = status.availableSymbols || [];

  const openInstaTrade = (opp: FuturesOpportunity) => {
    setInstaTradeOpp(opp);
    setInstaQty(1);
    setInstaOrderType("market");
    setInstaLimitPrice(opp.entry.toFixed(2));
    setInstaTradeOpen(true);
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "outline";
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4" data-testid="futures-scanner-container">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-[200px]" data-testid="select-symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableSymbols.map((s) => (
                <SelectItem key={s.symbol} value={s.symbol} data-testid={`option-symbol-${s.symbol}`}>
                  {s.symbol} - {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={isSubscribed ? "destructive" : "default"}
            onClick={() => subscribeMutation.mutate(isSubscribed ? "unsubscribe" : "subscribe")}
            disabled={subscribeMutation.isPending}
            data-testid="button-subscribe"
          >
            {subscribeMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isSubscribed ? "Unsubscribe" : "Subscribe"}
          </Button>

          <Badge
            variant={streamStatus === "streaming" ? "default" : streamStatus === "connected" ? "secondary" : "outline"}
            data-testid="badge-stream-status"
          >
            {streamStatus === "streaming" && <Radio className="h-3 w-3 mr-1" />}
            {streamStatus === "connected" && <Wifi className="h-3 w-3 mr-1" />}
            {streamStatus === "disconnected" && <WifiOff className="h-3 w-3 mr-1" />}
            {streamStatus === "streaming" ? "Streaming" : streamStatus === "connected" ? "Connected" : "Disconnected"}
          </Badge>
        </div>

        {lastTick && (
          <div className="flex items-center gap-4 text-sm font-mono flex-wrap" data-testid="last-tick-display">
            <span className="text-lg font-bold" data-testid="text-last-price">
              {lastTick.price.toFixed(2)}
            </span>
            <span className="text-muted-foreground">
              Bid: <span className="text-foreground" data-testid="text-bid">{lastTick.bid.toFixed(2)}</span>
            </span>
            <span className="text-muted-foreground">
              Ask: <span className="text-foreground" data-testid="text-ask">{lastTick.ask.toFixed(2)}</span>
            </span>
          </div>
        )}
      </div>

      <Card data-testid="card-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            {selectedSymbol} - 1s Chart
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {barsLoading ? (
            <Skeleton className="w-full h-[400px]" data-testid="skeleton-chart" />
          ) : (
            <div
              ref={chartContainerRef}
              className="w-full h-[400px]"
              data-testid="futures-chart"
            />
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-opportunities">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              Opportunities
            </CardTitle>
            <Button
              size="sm"
              onClick={handleScan}
              disabled={scanLoading}
              data-testid="button-scan"
            >
              {scanLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              Scan Now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-opportunities">
              No opportunities found. Click "Scan Now" to search for trade setups.
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <Table data-testid="table-opportunities">
                <TableHeader>
                  <TableRow>
                    <TableHead>Setup</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Stop</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opportunities.map((opp, i) => (
                    <TableRow key={`${opp.setup}-${i}`} data-testid={`row-opportunity-${i}`}>
                      <TableCell className="font-medium text-sm">{opp.setup}</TableCell>
                      <TableCell>
                        <Badge variant={scoreColor(opp.score)} data-testid={`badge-score-${i}`}>
                          {opp.score}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn("flex items-center gap-1 text-sm", opp.side === "buy" ? "text-green-500" : "text-red-500")}>
                          {opp.side === "buy" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {opp.side.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{opp.entry.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-sm text-red-500">{opp.stop.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-sm text-green-500">{opp.target.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{opp.reason}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openInstaTrade(opp)}
                          data-testid={`button-instatrade-${i}`}
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          InstaTrade
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={instaTradeOpen} onOpenChange={setInstaTradeOpen}>
        <DialogContent data-testid="dialog-instatrade">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              InstaTrade
            </DialogTitle>
            <DialogDescription>
              {instaTradeOpp && `${instaTradeOpp.side.toUpperCase()} ${instaTradeOpp.symbol} @ ${instaTradeOpp.entry.toFixed(2)}`}
            </DialogDescription>
          </DialogHeader>
          {instaTradeOpp && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <Label className="text-muted-foreground text-xs">Symbol</Label>
                  <p className="font-mono font-medium" data-testid="text-insta-symbol">{instaTradeOpp.symbol}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Side</Label>
                  <p className={cn("font-medium", instaTradeOpp.side === "buy" ? "text-green-500" : "text-red-500")} data-testid="text-insta-side">
                    {instaTradeOpp.side.toUpperCase()}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Entry</Label>
                  <p className="font-mono" data-testid="text-insta-entry">{instaTradeOpp.entry.toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="insta-qty">Quantity</Label>
                <Input
                  id="insta-qty"
                  type="number"
                  min={1}
                  value={instaQty}
                  onChange={(e) => setInstaQty(Math.max(1, parseInt(e.target.value) || 1))}
                  data-testid="input-insta-qty"
                />
              </div>

              <div className="space-y-2">
                <Label>Order Type</Label>
                <Select value={instaOrderType} onValueChange={(v) => setInstaOrderType(v as "market" | "limit")}>
                  <SelectTrigger data-testid="select-order-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {instaOrderType === "limit" && (
                <div className="space-y-2">
                  <Label htmlFor="insta-limit-price">Limit Price</Label>
                  <Input
                    id="insta-limit-price"
                    type="number"
                    step="0.25"
                    value={instaLimitPrice}
                    onChange={(e) => setInstaLimitPrice(e.target.value)}
                    data-testid="input-limit-price"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstaTradeOpen(false)} data-testid="button-insta-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => placeOrderMutation.mutate()}
              disabled={placeOrderMutation.isPending}
              data-testid="button-insta-confirm"
            >
              {placeOrderMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card data-testid="card-agent">
        <CardHeader
          className="cursor-pointer"
          onClick={() => setAgentOpen(!agentOpen)}
          data-testid="button-toggle-agent"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              Auto Agent
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={agentEnabled ? "default" : "outline"} data-testid="badge-agent-status">
                {agentEnabled ? "Active" : "Inactive"}
              </Badge>
              {agentOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {agentOpen && (
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={agentEnabled}
                onCheckedChange={setAgentEnabled}
                data-testid="switch-agent-enabled"
              />
              <Label>Enable Auto Agent</Label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agent-min-score">Min Score (0-100)</Label>
                <Input
                  id="agent-min-score"
                  type="number"
                  min={0}
                  max={100}
                  value={agentMinScore}
                  onChange={(e) => setAgentMinScore(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  data-testid="input-agent-min-score"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-max-trades">Max Trades/Day (1-50)</Label>
                <Input
                  id="agent-max-trades"
                  type="number"
                  min={1}
                  max={50}
                  value={agentMaxTrades}
                  onChange={(e) => setAgentMaxTrades(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                  data-testid="input-agent-max-trades"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-max-position">Max Position (1-20)</Label>
                <Input
                  id="agent-max-position"
                  type="number"
                  min={1}
                  max={20}
                  value={agentMaxPosition}
                  onChange={(e) => setAgentMaxPosition(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                  data-testid="input-agent-max-position"
                />
              </div>
            </div>

            <Button
              onClick={() => agentMutation.mutate()}
              disabled={agentMutation.isPending}
              data-testid="button-apply-agent"
            >
              {agentMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Apply Rules
            </Button>

            {auditLog && auditLog.length > 0 && (
              <div className="text-xs text-muted-foreground border-t pt-3 mt-3" data-testid="agent-last-action">
                <p className="font-medium text-foreground mb-1">Last Agent Action</p>
                <p>{auditLog[0].action} - {auditLog[0].symbol} - {new Date(auditLog[0].createdAt).toLocaleString()}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
