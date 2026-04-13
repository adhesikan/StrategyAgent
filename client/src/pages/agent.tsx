import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TradeSetupCard } from "@/components/trade-setup-card";
import { StockTradeTicket } from "@/components/stock-trade-ticket";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useLocation } from "wouter";
import {
  Sparkles,
  Send,
  Loader2,
  Bot,
  Target,
  Clock,
  BarChart3,
  Lightbulb,
  Zap,
  Link2,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface BuiltInStrategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  timeframes: string[];
}

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface BrokerOrder {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  orderType?: string;
  status: string;
  price?: number | null;
  filledQty?: number;
  createdAt?: string;
}

export default function AgentPage() {
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [prompt, setPrompt] = useState("");
  const [symbol, setSymbol] = useState("");
  const [strategy, setStrategy] = useState(urlParams.get("strategy") || "");
  const [assetType, setAssetType] = useState("stock");
  const [timeframe, setTimeframe] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isConnected, providerName } = useBrokerStatus();

  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketScanResult, setTicketScanResult] = useState<any>(null);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const { data: strategies } = useQuery<BuiltInStrategy[]>({
    queryKey: ["/api/agent/strategies"],
  });

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    enabled: isConnected,
  });

  const { data: recentOrders, refetch: refetchOrders } = useQuery<BrokerOrder[]>({
    queryKey: ["/api/broker/orders"],
    enabled: isConnected,
    refetchInterval: 5000,
  });

  const orderStreamRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isConnected) return;

    let retryDelay = 2000;
    let closed = false;

    function connect() {
      if (closed) return;
      const es = new EventSource("/api/broker/order-updates");
      orderStreamRef.current = es;

      es.onmessage = (event) => {
        try {
          retryDelay = 2000;
          const data = JSON.parse(event.data);
          if (data.type === "order_update") {
            queryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/broker/accounts"] });

            toast({
              title: `Order ${data.status === "filled" ? "Filled" : data.status === "canceled" ? "Canceled" : data.status}`,
              description: `${data.side?.toUpperCase()} ${data.qty} ${data.symbol} — ${data.status}`,
            });
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        orderStreamRef.current = null;
        refetchOrders();
        if (!closed) {
          retryTimeoutRef.current = setTimeout(() => {
            connect();
            retryDelay = Math.min(retryDelay * 1.5, 30000);
          }, retryDelay);
        }
      };
    }

    connect();

    return () => {
      closed = true;
      orderStreamRef.current?.close();
      orderStreamRef.current = null;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [isConnected]);

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/agent/generate", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/setups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/activity"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Generation Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    const data: any = {};
    if (prompt.trim()) data.prompt = prompt.trim();
    if (symbol.trim()) data.symbol = symbol.trim().toUpperCase();
    if (strategy && strategy !== "auto") data.strategy = strategy;
    if (assetType) data.assetType = assetType;
    if (timeframe && timeframe !== "auto") data.timeframe = timeframe;

    if (!data.prompt && !data.symbol) {
      toast({
        title: "Missing Input",
        description: "Enter a prompt or symbol to generate a setup.",
        variant: "destructive",
      });
      return;
    }

    generateMutation.mutate(data);
  };

  const handleSendToInstatrade = (setup: any) => {
    if (!isConnected) {
      toast({
        title: "Broker Not Connected",
        description: "Connect your broker in Settings to use InstaTrade™.",
        variant: "destructive",
      });
      return;
    }

    setTicketScanResult({
      ticker: setup.symbol,
      price: setup.metrics?.currentPrice || setup.entry,
      resistance: setup.entry,
      stopLoss: setup.stop,
      stage: setup.bias?.toUpperCase() || "READY",
      patternScore: setup.modelScore || 70,
      prefillTarget: setup.targets?.[0] || null,
      prefillQuantity: 1,
    });
    setTicketOpen(true);
  };

  const examplePrompts = [
    "Give me a 15-minute ORB setup on TSLA",
    "Find a bullish pullback setup on NVDA",
    "Show a VWAP reclaim setup on AAPL",
    "Volatility breakout on AMD",
  ];

  const activeOrders = recentOrders?.filter(
    (o) => o.status === "pending" || o.status === "open" || o.status === "partially_filled"
  ) || [];

  const recentFilled = recentOrders?.filter(
    (o) => o.status === "filled"
  )?.slice(0, 5) || [];

  const orderStatusIcon = (status: string) => {
    switch (status) {
      case "filled": return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
      case "canceled": case "rejected": return <XCircle className="h-3.5 w-3.5 text-red-400" />;
      case "pending": case "open": return <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />;
      default: return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const orderStatusColor = (status: string) => {
    switch (status) {
      case "filled": return "bg-green-500/15 text-green-400 border-green-500/30";
      case "canceled": case "rejected": return "bg-red-500/15 text-red-400 border-red-500/30";
      case "pending": case "open": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Bot className="h-6 w-6 text-primary" />
            Strategy Agent
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
            Describe a setup, get structured analysis, and execute
          </p>
        </div>
        {!isConnected && (
          <Button variant="outline" size="sm" onClick={() => navigate("/settings")} data-testid="button-connect-broker">
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Connect Broker
          </Button>
        )}
      </div>

      <Card className="border-primary/20 bg-card/80" data-testid="card-agent-input">
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Describe your setup
            </Label>
            <Textarea
              id="prompt"
              placeholder='e.g., "Give me a 15-minute ORB setup on TSLA"'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[70px] resize-none"
              data-testid="input-prompt"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" />
                Symbol
              </Label>
              <Input
                placeholder="TSLA"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="h-9"
                data-testid="input-symbol"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Asset Type</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger className="h-9" data-testid="select-asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="option">Option</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Strategy
              </Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-9" data-testid="select-strategy">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {strategies?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Timeframe
              </Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="h-9" data-testid="select-timeframe">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="1m">1 Min</SelectItem>
                  <SelectItem value="5m">5 Min</SelectItem>
                  <SelectItem value="15m">15 Min</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                  <SelectItem value="1D">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full h-11"
            data-testid="button-generate-setup"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate Setup
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {!generateMutation.data && !generateMutation.isPending && (
        <div className="flex flex-wrap gap-2" data-testid="card-examples">
          {examplePrompts.map((example, i) => (
            <button
              key={i}
              onClick={() => setPrompt(example)}
              className="text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-primary/30 rounded-full px-3 py-1.5 transition-colors"
              data-testid={`button-example-${i}`}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {generateMutation.data?.setup && (
        <div className="space-y-3">
          <TradeSetupCard
            setup={generateMutation.data.setup}
            onOpenChart={(sym) => navigate(`/charts/${sym}`)}
            onSendToInstatrade={handleSendToInstatrade}
            onReviewSetup={(setup) => {
              toast({
                title: "Setup Reviewed",
                description: `${setup.strategyName} setup for ${setup.symbol} marked as reviewed.`,
              });
            }}
          />
        </div>
      )}

      {generateMutation.data && !generateMutation.data.setup && (
        <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-no-setup">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No valid setup matches the selected strategy conditions. Try a different symbol or strategy.
            </p>
          </CardContent>
        </Card>
      )}

      {isConnected && (activeOrders.length > 0 || recentFilled.length > 0) && (
        <Card className="bg-card/80" data-testid="card-live-orders">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Live Orders
                {activeOrders.length > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30 animate-pulse">
                    {activeOrders.length} active
                  </Badge>
                )}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchOrders()} data-testid="button-refresh-orders">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...activeOrders, ...recentFilled].map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-accent/30 border border-border/40"
                data-testid={`order-${order.id}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {orderStatusIcon(order.status)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold">{order.symbol}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{order.side}</span>
                      <span className="text-[10px] text-muted-foreground">{order.qty} shares</span>
                    </div>
                    {order.filledQty && order.filledQty > 0 && (
                      <span className="text-[10px] text-muted-foreground">Filled {order.filledQty}/{order.qty}</span>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${orderStatusColor(order.status)}`}>
                  {order.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center" data-testid="text-disclaimer">
        Software-generated setup for informational purposes only. Not investment advice or a recommendation.
      </p>

      <StockTradeTicket
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        scanResult={ticketScanResult}
        brokerAccounts={brokerAccounts || []}
        selectedAccount={selectedAccount}
        onAccountChange={setSelectedAccount}
      />
    </div>
  );
}
