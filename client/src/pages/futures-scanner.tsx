import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTheme } from "@/lib/theme-provider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createChart, CandlestickSeries, LineSeries, ColorType } from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FuturesTradeTicket } from "@/components/futures-trade-ticket";
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
  Plus,
  X,
  AlertTriangle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import rithmicLogoWhite from "@assets/market_data_by_rithmic-white_1771689702166.png";
import rithmicLogoSlate from "@assets/market_data_by_rithmic-slategrey_1771689702167.png";

interface FuturesSymbolInfo {
  symbol: string;
  name: string;
  tickSize: number;
  pointValue: number;
}

interface FuturesStatus {
  enabled: boolean;
  tradingEnabled: boolean;
  userFuturesAccess: boolean;
  dataMode: boolean;
  selectedFeed: string;
  workerRunning: boolean;
  subscribedSymbols: string[];
  availableSymbols: FuturesSymbolInfo[];
  feedType?: "mock" | "rithmic";
  feedDetail?: string;
  adapterActive?: "mock" | "rithmic";
  rithmicModeDetected?: "protocol" | "plant" | null;
  missingEnvVars?: string[];
  lastInitError?: string | null;
  agent: {
    enabled: boolean;
    symbol: string;
    minScore: number;
    maxTradesPerDay: number;
    maxPosition: number;
    sizeMode: "contracts" | "dollars";
    tradeSize: number;
    entryTimeStart: string;
    entryTimeEnd: string;
    exitTime: string;
    takeProfit: number;
    stopLoss: number;
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

const EMA_COLORS = [
  "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48", "#6366f1",
];

function computeEMA(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      sum += closes[i];
      if (i === period - 1) {
        result.push(sum / period);
      } else {
        result.push(NaN);
      }
    } else {
      const ema = closes[i] * k + result[result.length - 1] * (1 - k);
      result.push(ema);
    }
  }
  return result;
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
  const [agentSizeMode, setAgentSizeMode] = useState<"contracts" | "dollars">("contracts");
  const [agentTradeSize, setAgentTradeSize] = useState(1);
  const [agentEntryStart, setAgentEntryStart] = useState("09:30");
  const [agentEntryEnd, setAgentEntryEnd] = useState("15:30");
  const [agentExitTime, setAgentExitTime] = useState("15:55");
  const [agentTakeProfit, setAgentTakeProfit] = useState(0);
  const [agentStopLoss, setAgentStopLoss] = useState(0);

  const [instaTradeOpp, setInstaTradeOpp] = useState<FuturesOpportunity | null>(null);
  const [instaTradeOpen, setInstaTradeOpen] = useState(false);
  const [strategiesOpen, setStrategiesOpen] = useState(false);

  const [emaPeriods, setEmaPeriods] = useState<number[]>([9, 21]);
  const [newEmaPeriod, setNewEmaPeriod] = useState("");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const emaSeriesRefs = useRef<Map<number, any>>(new Map());
  const barsRef = useRef<FuturesBar[]>([]);
  const barsDataRef = useRef<BarsResponse | undefined>(undefined);
  const emaPeriodsRef = useRef<number[]>(emaPeriods);
  emaPeriodsRef.current = emaPeriods;
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
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || !data.bars || data.bars.length === 0) return 2000;
      if (!seriesRef.current) return 1000;
      return false;
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

  const subscribeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const subscribeMutation = useMutation({
    mutationFn: async (action: "subscribe" | "unsubscribe") => {
      await apiRequest("POST", "/api/futures/command", {
        commandType: action,
        symbol: selectedSymbol,
      });
      return { action, symbol: selectedSymbol };
    },
    onSuccess: (result) => {
      const { action, symbol } = result;
      queryClient.invalidateQueries({ queryKey: ["/api/futures/status"] });
      subscribeTimersRef.current.forEach(clearTimeout);
      subscribeTimersRef.current = [];
      if (action === "subscribe") {
        const t1 = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/futures/bars", symbol] });
        }, 1500);
        const t2 = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/futures/bars", symbol] });
        }, 3000);
        subscribeTimersRef.current.push(t1, t2);
      }
      toast({ title: action === "subscribe" ? "Subscribed" : "Unsubscribed", description: `${symbol} market data ${action === "subscribe" ? "started" : "stopped"}` });
    },
    onError: (err: any) => {
      toast({ title: "Command Failed", description: err.message, variant: "destructive" });
    },
  });

  const agentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/futures/command", {
        commandType: "toggleAgent",
        enabled: agentEnabled,
        symbol: selectedSymbol,
        rules: {
          minScore: agentMinScore,
          maxTradesPerDay: agentMaxTrades,
          maxPosition: agentMaxPosition,
          sizeMode: agentSizeMode,
          tradeSize: agentTradeSize,
          entryTimeStart: agentEntryStart,
          entryTimeEnd: agentEntryEnd,
          exitTime: agentExitTime,
          takeProfit: agentTakeProfit,
          stopLoss: agentStopLoss,
        },
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
      if (status.agent.sizeMode) setAgentSizeMode(status.agent.sizeMode);
      if (status.agent.tradeSize) setAgentTradeSize(status.agent.tradeSize);
      if (status.agent.entryTimeStart) setAgentEntryStart(status.agent.entryTimeStart);
      if (status.agent.entryTimeEnd) setAgentEntryEnd(status.agent.entryTimeEnd);
      if (status.agent.exitTime) setAgentExitTime(status.agent.exitTime);
      if (status.agent.takeProfit !== undefined) setAgentTakeProfit(status.agent.takeProfit);
      if (status.agent.stopLoss !== undefined) setAgentStopLoss(status.agent.stopLoss);
    }
  }, [status?.agent]);

  useEffect(() => {
    return () => {
      subscribeTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  const autoSubscribeAttemptRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (
      status?.enabled &&
      status?.workerRunning &&
      !status?.subscribedSymbols?.includes(selectedSymbol) &&
      !subscribeMutation.isPending
    ) {
      const attempts = autoSubscribeAttemptRef.current[selectedSymbol] ?? 0;
      if (attempts < 3) {
        autoSubscribeAttemptRef.current[selectedSymbol] = attempts + 1;
        subscribeMutation.mutate("subscribe");
      }
    }
    if (status?.subscribedSymbols?.includes(selectedSymbol)) {
      autoSubscribeAttemptRef.current[selectedSymbol] = 0;
    }
  }, [status?.enabled, status?.workerRunning, status?.subscribedSymbols, selectedSymbol]);

  const initChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    const isDark = theme === "dark";

    barsRef.current = [];

    if (chartApiRef.current) {
      chartApiRef.current.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      emaSeriesRefs.current.clear();
    }

    const container = chartContainerRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;

    const etFormatter = (ts: number) => {
      const d = new Date(ts * 1000);
      return d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    };

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
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
      localization: {
        timeFormatter: etFormatter,
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

    return chart;
  }, [theme]);

  const populateChart = useCallback((bars: FuturesBar[], periods: number[]) => {
    if (!seriesRef.current || !chartApiRef.current || bars.length === 0) return;

    const chartBars = bars.map((b) => ({
      time: b.time as any,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    seriesRef.current.setData(chartBars);

    const closes = bars.map((b) => b.close);
    const chart = chartApiRef.current;

    emaSeriesRefs.current.forEach((s) => {
      try { chart.removeSeries(s); } catch {}
    });
    emaSeriesRefs.current.clear();

    periods.forEach((period, idx) => {
      const emaValues = computeEMA(closes, period);
      const emaData = emaValues
        .map((v, i) => ({ time: bars[i]?.time as any, value: v }))
        .filter((d) => d.time && !isNaN(d.value));
      if (emaData.length > 0) {
        const emaSeries = chart.addSeries(LineSeries, {
          color: EMA_COLORS[idx % EMA_COLORS.length],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: `EMA${period}`,
        });
        emaSeries.setData(emaData);
        emaSeriesRefs.current.set(period, emaSeries);
      }
    });

    chart.timeScale().scrollToRealTime();
  }, []);

  useEffect(() => {
    const chart = initChart();
    if (!chart) return;

    if (barsDataRef.current?.bars && barsDataRef.current.bars.length > 0) {
      barsRef.current = barsDataRef.current.bars;
      populateChart(barsDataRef.current.bars, emaPeriodsRef.current);
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartApiRef.current) {
        chartApiRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(chartContainerRef.current!);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      emaSeriesRefs.current.clear();
    };
  }, [theme, selectedSymbol, initChart, populateChart]);

  useEffect(() => {
    barsDataRef.current = barsData;

    if (!seriesRef.current || !chartApiRef.current) return;
    if (!barsData?.bars || barsData.bars.length === 0) return;

    barsRef.current = barsData.bars;
    populateChart(barsData.bars, emaPeriods);

    if (barsData?.lastTick) {
      setLastTick(barsData.lastTick);
    }
  }, [barsData, emaPeriods, populateChart]);

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
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/futures/bars", selectedSymbol] });
        }, 500);
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
            const bar = msg.data;
            if (seriesRef.current) {
              seriesRef.current.update({
                time: bar.time as any,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
              });
            }
            const bars = barsRef.current;
            const lastIdx = bars.length - 1;
            if (lastIdx >= 0 && bars[lastIdx].time === bar.time) {
              bars[lastIdx] = bar;
            } else {
              bars.push(bar);
            }
            emaSeriesRefs.current.forEach((emaSeries, period) => {
              const closes = bars.map((b) => b.close);
              const emaValues = computeEMA(closes, period);
              const lastEma = emaValues[emaValues.length - 1];
              if (!isNaN(lastEma)) {
                emaSeries.update({ time: bar.time as any, value: lastEma });
              }
            });
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
          const bars = barsRef.current;
          const lastIdx = bars.length - 1;
          if (lastIdx >= 0 && bars[lastIdx].time === latest.time) {
            bars[lastIdx] = latest;
          } else if (bars.length > 0) {
            bars.push(latest);
          }
          emaSeriesRefs.current.forEach((emaSeries, period) => {
            const closes = bars.map((b) => b.close);
            const emaValues = computeEMA(closes, period);
            const lastEma = emaValues[emaValues.length - 1];
            if (!isNaN(lastEma)) {
              emaSeries.update({ time: latest.time as any, value: lastEma });
            }
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

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-futures">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dataMode = status.dataMode ?? true;

  const isSubscribed = status.subscribedSymbols?.includes(selectedSymbol);
  const availableSymbols = status.availableSymbols || [];

  const openInstaTrade = (opp: FuturesOpportunity) => {
    setInstaTradeOpp(opp);
    setInstaTradeOpen(true);
  };

  const openQuickTrade = () => {
    if (!lastTick) return;
    const price = lastTick.price;
    const info = availableSymbols.find((s) => s.symbol === selectedSymbol);
    const tickSize = info?.tickSize ?? 0.25;
    setInstaTradeOpp({
      symbol: selectedSymbol,
      setup: "Manual",
      score: 0,
      entry: price,
      stop: Math.round((price - tickSize * 20) * 100) / 100,
      target: Math.round((price + tickSize * 40) * 100) / 100,
      side: "buy",
      timeframe: "1s",
      reason: "Manual trade entry",
    });
    setInstaTradeOpen(true);
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "outline";
  };

  const feedType = status.feedType ?? "mock";
  const feedDetail = status.feedDetail;
  const rithmicMode = status.rithmicModeDetected;
  const missingVars = status.missingEnvVars ?? [];
  const lastInitError = status.lastInitError;
  const tradingEnabled = status.tradingEnabled ?? false;

  const buildMockBannerMessage = (): string => {
    if (missingVars.length > 0) {
      return "Rithmic credentials incomplete. Falling back to simulated data.";
    }
    if (lastInitError) {
      return "Rithmic connection failed. Falling back to simulated data.";
    }
    if (feedDetail && feedDetail !== "default" && feedDetail !== "FUTURES_FEED not set to rithmic") {
      return feedDetail;
    }
    return "Running with simulated data. To connect to Rithmic, set FUTURES_FEED=rithmic and provide credentials.";
  };

  const buildMissingVarsHint = (): string | null => {
    if (missingVars.length === 0) return null;
    if (rithmicMode === "protocol") {
      return `Protocol mode requires: RITHMIC_WS_URL, RITHMIC_SYSTEM_NAME, RITHMIC_USER_ID, RITHMIC_PASSWORD. Missing: ${missingVars.join(", ")}`;
    }
    if (rithmicMode === "plant") {
      return `Plant mode requires: RITHMIC_TICKER_PLANT_URI, RITHMIC_ORDER_PLANT_URI, RITHMIC_SYSTEM_NAME, RITHMIC_USER_ID, RITHMIC_PASSWORD. Missing: ${missingVars.join(", ")}`;
    }
    return `Set either (A) RITHMIC_WS_URL for Protocol mode, or (B) both RITHMIC_TICKER_PLANT_URI + RITHMIC_ORDER_PLANT_URI for Plant mode. Also required: RITHMIC_USER_ID, RITHMIC_PASSWORD. Missing: ${missingVars.join(", ")}`;
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4" data-testid="futures-scanner-container">
      {feedType === "rithmic" ? (
        <div
          className="bg-green-500/10 border border-green-500/20 rounded-md px-4 py-2 space-y-2"
          data-testid="banner-futures-feed-live"
        >
          <div className="flex items-center justify-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-green-500" />
            <span className="text-xs text-green-600 dark:text-green-400">
              Futures Feed: Rithmic Connected{rithmicMode ? ` (${rithmicMode === "protocol" ? "Protocol Server" : "Plant"} mode)` : ""}
              {feedDetail ? ` - ${feedDetail}` : ""}
            </span>
          </div>
          <div className="flex justify-center">
            <img
              src={rithmicLogoWhite}
              alt="Market Data by Rithmic"
              className="h-5 hidden dark:block"
              data-testid="img-rithmic-logo-dark"
            />
            <img
              src={rithmicLogoSlate}
              alt="Market Data by Rithmic"
              className="h-5 dark:hidden"
              data-testid="img-rithmic-logo-light"
            />
          </div>
        </div>
      ) : (
        <div
          className="bg-yellow-500/10 border border-yellow-500/20 rounded-md px-4 py-2 space-y-1"
          data-testid="banner-futures-feed-mock"
        >
          <div className="flex items-center justify-center gap-2">
            <WifiOff className="h-3.5 w-3.5 text-yellow-500" />
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              Futures Feed: Mock Data
            </span>
          </div>
          <p className="text-[10px] text-center text-yellow-600/70 dark:text-yellow-400/70" data-testid="text-mock-reason">
            {buildMockBannerMessage()}
          </p>
          {missingVars.length > 0 && (
            <p className="text-[10px] text-center text-yellow-600/60 dark:text-yellow-400/60" data-testid="text-missing-vars">
              {buildMissingVarsHint()}
            </p>
          )}
          {lastInitError && (
            <p className="text-[10px] text-center text-red-500/80" data-testid="text-init-error">
              Init error: {lastInitError}
            </p>
          )}
        </div>
      )}

      {dataMode && (
        <div
          className="bg-orange-500/10 border border-orange-500/20 rounded-md px-4 py-2 flex items-center justify-center gap-2"
          data-testid="banner-data-only-mode"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
          <span className="text-xs text-orange-600 dark:text-orange-400">
            Futures Trading is disabled. Market data is live, but order placement and automation are turned off.
          </span>
        </div>
      )}

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

          {isSubscribed && lastTick && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="default"
                    onClick={openQuickTrade}
                    disabled={dataMode}
                    data-testid="button-quick-trade"
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    InstaTrade™
                  </Button>
                </span>
              </TooltipTrigger>
              {dataMode && (
                <TooltipContent>
                  <p>Trading disabled (data-only mode)</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              {selectedSymbol} - 1s Chart
            </CardTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              {emaPeriods.map((period, idx) => (
                <Badge
                  key={period}
                  variant="outline"
                  className="text-xs font-mono gap-1"
                  data-testid={`badge-ema-${period}`}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: EMA_COLORS[idx % EMA_COLORS.length] }} />
                  EMA {period}
                  <button
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    onClick={() => setEmaPeriods((prev) => prev.filter((p) => p !== period))}
                    data-testid={`button-remove-ema-${period}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={2}
                  max={500}
                  placeholder="Period"
                  value={newEmaPeriod}
                  onChange={(e) => setNewEmaPeriod(e.target.value)}
                  className="w-16 h-7 text-xs"
                  data-testid="input-ema-period"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    const p = parseInt(newEmaPeriod);
                    if (p >= 2 && p <= 500 && !emaPeriods.includes(p)) {
                      setEmaPeriods((prev) => [...prev, p].sort((a, b) => a - b));
                      setNewEmaPeriod("");
                    }
                  }}
                  data-testid="button-add-ema"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 relative">
          {barsLoading && (
            <Skeleton className="w-full h-[400px] absolute inset-0 z-10" data-testid="skeleton-chart" />
          )}
          <div
            ref={chartContainerRef}
            className="w-full h-[400px]"
            data-testid="futures-chart"
          />
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
          <div className="mb-3">
            <button
              onClick={() => setStrategiesOpen(!strategiesOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1"
              data-testid="button-toggle-strategies"
            >
              {strategiesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Scan Strategies
            </button>
            {strategiesOpen && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs" data-testid="strategies-list">
                <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  <TrendingUp className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Range Breakout</p>
                    <p className="text-muted-foreground">Buy when price nears resistance with upward trend</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  <TrendingDown className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Range Breakdown</p>
                    <p className="text-muted-foreground">Sell when price nears support with downward trend</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  <TrendingUp className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Momentum Long</p>
                    <p className="text-muted-foreground">Buy on strong upward momentum above average price</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  <TrendingDown className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Momentum Short</p>
                    <p className="text-muted-foreground">Sell on strong downward momentum below average price</p>
                  </div>
                </div>
              </div>
            )}
          </div>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openInstaTrade(opp)}
                                disabled={dataMode}
                                data-testid={`button-instatrade-${i}`}
                              >
                                <Zap className="h-3 w-3 mr-1" />
                                InstaTrade™
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {dataMode && (
                            <TooltipContent>
                              <p>Trading disabled (data-only mode)</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <FuturesTradeTicket
        open={instaTradeOpen}
        onOpenChange={setInstaTradeOpen}
        opportunity={instaTradeOpp}
        lastPrice={lastTick?.price}
      />

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
              {status?.agent?.tradesToday !== undefined && (
                <span className="text-xs text-muted-foreground font-mono" data-testid="text-trades-today">
                  {status.agent.tradesToday}/{agentMaxTrades} trades
                </span>
              )}
              <Badge variant={dataMode ? "outline" : agentEnabled ? "default" : "outline"} data-testid="badge-agent-status">
                {dataMode ? "Disabled" : agentEnabled ? "Active" : "Inactive"}
              </Badge>
              {agentOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {agentOpen && (
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch
                      checked={dataMode ? false : agentEnabled}
                      onCheckedChange={setAgentEnabled}
                      disabled={dataMode}
                      data-testid="switch-agent-enabled"
                    />
                  </span>
                </TooltipTrigger>
                {dataMode && (
                  <TooltipContent>
                    <p>Trading disabled (data-only mode)</p>
                  </TooltipContent>
                )}
              </Tooltip>
              <Label className={dataMode ? "text-muted-foreground" : ""}>Enable Auto Agent</Label>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Trade Size</Label>
                <div className="flex items-center gap-2">
                  <Select value={agentSizeMode} onValueChange={(v) => setAgentSizeMode(v as "contracts" | "dollars")}>
                    <SelectTrigger className="w-[120px]" data-testid="select-size-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contracts">Contracts</SelectItem>
                      <SelectItem value="dollars">$ Amount</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={agentTradeSize}
                    onChange={(e) => setAgentTradeSize(Math.max(1, parseFloat(e.target.value) || 1))}
                    className="flex-1"
                    data-testid="input-trade-size"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {agentSizeMode === "contracts" ? "Number of contracts per trade" : "Dollar amount per trade (auto-calculates contracts)"}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Trading Hours (ET)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={agentEntryStart}
                    onChange={(e) => setAgentEntryStart(e.target.value)}
                    className="flex-1"
                    data-testid="input-entry-start"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input
                    type="time"
                    value={agentEntryEnd}
                    onChange={(e) => setAgentEntryEnd(e.target.value)}
                    className="flex-1"
                    data-testid="input-entry-end"
                  />
                </div>
                <p className="text-xs text-muted-foreground">New entries only placed during this window</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agent-exit-time">Exit Time (ET)</Label>
                <Input
                  id="agent-exit-time"
                  type="time"
                  value={agentExitTime}
                  onChange={(e) => setAgentExitTime(e.target.value)}
                  data-testid="input-exit-time"
                />
                <p className="text-xs text-muted-foreground">Close all positions at this time</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-take-profit">Take Profit (points)</Label>
                <Input
                  id="agent-take-profit"
                  type="number"
                  min={0}
                  step={0.25}
                  value={agentTakeProfit}
                  onChange={(e) => setAgentTakeProfit(Math.max(0, parseFloat(e.target.value) || 0))}
                  data-testid="input-take-profit"
                />
                <p className="text-xs text-muted-foreground">{agentTakeProfit > 0 ? `Limit order ${agentTakeProfit} pts from entry` : "No take profit"}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-stop-loss">Stop Loss (points)</Label>
                <Input
                  id="agent-stop-loss"
                  type="number"
                  min={0}
                  step={0.25}
                  value={agentStopLoss}
                  onChange={(e) => setAgentStopLoss(Math.max(0, parseFloat(e.target.value) || 0))}
                  data-testid="input-stop-loss"
                />
                <p className="text-xs text-muted-foreground">{agentStopLoss > 0 ? `Limit order ${agentStopLoss} pts from entry` : "No stop loss"}</p>
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
                {auditLog[0].details?.qty && (
                  <p className="mt-0.5">Qty: {auditLog[0].details.qty} | Side: {auditLog[0].details.side}</p>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
