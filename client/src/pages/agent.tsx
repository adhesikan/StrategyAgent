import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Zap,
  Link2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SlidersHorizontal,
  Plus,
  Trash2,
  ChevronDown,
  Filter,
  ShieldCheck,
  TrendingUp,
  Activity,
  Gauge,
  Layers,
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

interface BuiltInCondition {
  id: string;
  label: string;
  category: string;
  conditionType: string;
  operator: string;
  defaultValue: string;
  description: string;
}

interface UserCondition {
  id: string;
  userId: string;
  label: string;
  category: string;
  conditionType: string;
  operator: string;
  value: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  createdAt: string;
}

interface ActiveCondition {
  conditionType: string;
  operator: string;
  value: string;
  label: string;
  source: "built-in" | "custom";
}

const CATEGORY_META: Record<string, { label: string; icon: any; color: string }> = {
  volume: { label: "Volume", icon: Activity, color: "text-blue-400" },
  trend: { label: "Trend", icon: TrendingUp, color: "text-green-400" },
  momentum: { label: "Momentum", icon: Zap, color: "text-amber-400" },
  pattern: { label: "Pattern", icon: Layers, color: "text-purple-400" },
  risk: { label: "Risk", icon: ShieldCheck, color: "text-red-400" },
  price_level: { label: "Price Level", icon: Target, color: "text-cyan-400" },
  volatility: { label: "Volatility", icon: Gauge, color: "text-orange-400" },
  custom: { label: "Custom", icon: SlidersHorizontal, color: "text-muted-foreground" },
};

const OPERATOR_LABELS: Record<string, string> = {
  gte: "\u2265",
  lte: "\u2264",
  gt: ">",
  lt: "<",
  eq: "=",
};

export default function AgentPage() {
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [prompt, setPrompt] = useState("");
  const [symbol, setSymbol] = useState("");
  const [strategy, setStrategy] = useState(urlParams.get("strategy") || "");
  const [assetType, setAssetType] = useState("stock");
  const [timeframe, setTimeframe] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isConnected } = useBrokerStatus();

  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketScanResult, setTicketScanResult] = useState<any>(null);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [activeConditions, setActiveConditions] = useState<Map<string, ActiveCondition>>(new Map());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCondition, setNewCondition] = useState({
    label: "",
    conditionType: "",
    operator: "gte",
    value: "",
    category: "custom",
  });

  const { data: strategies } = useQuery<BuiltInStrategy[]>({
    queryKey: ["/api/agent/strategies"],
  });

  const { data: builtInConditions } = useQuery<BuiltInCondition[]>({
    queryKey: ["/api/agent/built-in-conditions"],
  });

  const { data: userConditions, refetch: refetchUserConditions } = useQuery<UserCondition[]>({
    queryKey: ["/api/agent/conditions"],
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

  const userConditionsLoaded = useRef(false);
  useEffect(() => {
    if (userConditions && !userConditionsLoaded.current) {
      userConditionsLoaded.current = true;
      const map = new Map(activeConditions);
      for (const uc of userConditions) {
        if (uc.isEnabled) {
          map.set(uc.conditionType, {
            conditionType: uc.conditionType,
            operator: uc.operator,
            value: uc.value,
            label: uc.label,
            source: "custom",
          });
        }
      }
      setActiveConditions(map);
    }

    if (userConditions) {
      const customTypeIds = new Set(userConditions.map((uc) => uc.conditionType));
      const map = new Map(activeConditions);
      let changed = false;
      for (const [key, val] of map) {
        if (val.source === "custom" && !customTypeIds.has(key)) {
          map.delete(key);
          changed = true;
        }
      }
      if (changed) setActiveConditions(map);
    }
  }, [userConditions]);

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

  const createConditionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/agent/conditions", data);
      return res.json();
    },
    onSuccess: () => {
      refetchUserConditions();
      setCreateDialogOpen(false);
      setNewCondition({ label: "", conditionType: "", operator: "gte", value: "", category: "custom" });
      toast({ title: "Condition Created", description: "Your custom condition has been saved." });
    },
  });

  const deleteConditionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/agent/conditions/${id}`);
    },
    onSuccess: () => {
      refetchUserConditions();
      toast({ title: "Condition Deleted" });
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

    if (activeConditions.size > 0) {
      data.conditions = Array.from(activeConditions.values()).map((c) => ({
        conditionType: c.conditionType,
        operator: c.operator,
        value: c.value,
      }));
    }

    generateMutation.mutate(data);
  };

  const handleSendToInstatrade = (setup: any) => {
    if (!isConnected) {
      toast({
        title: "Broker Not Connected",
        description: "Connect your broker in Settings to use InstaTrade\u2122.",
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

  const toggleBuiltInCondition = (condition: BuiltInCondition) => {
    const map = new Map(activeConditions);
    if (map.has(condition.conditionType)) {
      map.delete(condition.conditionType);
    } else {
      map.set(condition.conditionType, {
        conditionType: condition.conditionType,
        operator: condition.operator,
        value: condition.defaultValue,
        label: condition.label,
        source: "built-in",
      });
    }
    setActiveConditions(map);
  };

  const updateConditionValue = (conditionType: string, value: string) => {
    const map = new Map(activeConditions);
    const existing = map.get(conditionType);
    if (existing) {
      map.set(conditionType, { ...existing, value });
      setActiveConditions(map);
    }
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

  const groupedBuiltInConditions = (builtInConditions || []).reduce<Record<string, BuiltInCondition[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  return (
    <div className="flex-1 p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Bot className="h-6 w-6 text-primary" />
            Strategy Agent
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
            Describe a setup, apply conditions, and execute
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

          <Collapsible open={conditionsOpen} onOpenChange={setConditionsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between h-9 text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-conditions"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Filter className="h-3.5 w-3.5" />
                  Analysis Conditions
                  {activeConditions.size > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">
                      {activeConditions.size} active
                    </Badge>
                  )}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${conditionsOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-4">
              {Object.entries(groupedBuiltInConditions).map(([category, conditions]) => {
                const meta = CATEGORY_META[category] || CATEGORY_META.custom;
                const Icon = meta.icon;
                return (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {meta.label}
                      </span>
                    </div>
                    <div className="grid gap-2">
                      {conditions.map((condition) => {
                        const isActive = activeConditions.has(condition.conditionType);
                        const activeVal = activeConditions.get(condition.conditionType);
                        return (
                          <div
                            key={condition.id}
                            className={`flex items-center justify-between gap-3 p-2.5 rounded-md border transition-colors ${
                              isActive
                                ? "border-primary/30 bg-primary/5"
                                : "border-border/40 bg-accent/20 hover:border-border/60"
                            }`}
                            data-testid={`condition-${condition.id}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <Switch
                                checked={isActive}
                                onCheckedChange={() => toggleBuiltInCondition(condition)}
                                className="shrink-0"
                                data-testid={`switch-condition-${condition.id}`}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{condition.label}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{condition.description}</p>
                              </div>
                            </div>
                            {isActive && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] text-muted-foreground">
                                  {OPERATOR_LABELS[activeVal?.operator || condition.operator] || condition.operator}
                                </span>
                                <Input
                                  value={activeVal?.value || condition.defaultValue}
                                  onChange={(e) => updateConditionValue(condition.conditionType, e.target.value)}
                                  className="h-7 w-16 text-xs text-center"
                                  data-testid={`input-condition-value-${condition.id}`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {userConditions && userConditions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Your Custom Rules
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {userConditions.map((uc) => {
                      const isActive = activeConditions.has(uc.conditionType);
                      return (
                        <div
                          key={uc.id}
                          className={`flex items-center justify-between gap-3 p-2.5 rounded-md border transition-colors ${
                            isActive
                              ? "border-primary/30 bg-primary/5"
                              : "border-border/40 bg-accent/20 hover:border-border/60"
                          }`}
                          data-testid={`condition-custom-${uc.id}`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <Switch
                              checked={isActive}
                              onCheckedChange={() => {
                                const map = new Map(activeConditions);
                                if (map.has(uc.conditionType)) {
                                  map.delete(uc.conditionType);
                                } else {
                                  map.set(uc.conditionType, {
                                    conditionType: uc.conditionType,
                                    operator: uc.operator,
                                    value: uc.value,
                                    label: uc.label,
                                    source: "custom",
                                  });
                                }
                                setActiveConditions(map);
                              }}
                              className="shrink-0"
                              data-testid={`switch-custom-condition-${uc.id}`}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{uc.label}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {uc.conditionType} {OPERATOR_LABELS[uc.operator] || uc.operator} {uc.value}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteConditionMutation.mutate(uc.id)}
                            data-testid={`button-delete-condition-${uc.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setCreateDialogOpen(true)}
                data-testid="button-create-condition"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create Custom Condition
              </Button>
            </CollapsibleContent>
          </Collapsible>

          {activeConditions.size > 0 && !conditionsOpen && (
            <div className="flex flex-wrap gap-1.5" data-testid="active-conditions-pills">
              {Array.from(activeConditions.values()).map((c) => (
                <Badge
                  key={c.conditionType}
                  variant="secondary"
                  className="text-[10px] cursor-pointer hover:bg-destructive/20"
                  onClick={() => {
                    const map = new Map(activeConditions);
                    map.delete(c.conditionType);
                    setActiveConditions(map);
                  }}
                  data-testid={`pill-condition-${c.conditionType}`}
                >
                  {c.label} {OPERATOR_LABELS[c.operator]} {c.value}
                  <XCircle className="h-2.5 w-2.5 ml-1" />
                </Badge>
              ))}
            </div>
          )}

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
                {activeConditions.size > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    {activeConditions.size} conditions
                  </Badge>
                )}
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
          {generateMutation.data.setup.conditionWarnings?.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-condition-warnings">
              <CardContent className="py-3 space-y-1.5">
                <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Some conditions were not met
                </p>
                {generateMutation.data.setup.conditionWarnings.map((w: string, i: number) => (
                  <p key={i} className="text-[11px] text-muted-foreground pl-5">
                    {w}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          {generateMutation.data.setup.appliedConditions?.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="condition-results">
              {generateMutation.data.setup.appliedConditions.map((c: any, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-[10px] ${
                    c.passed
                      ? "bg-green-500/10 text-green-400 border-green-500/30"
                      : "bg-red-500/10 text-red-400 border-red-500/30"
                  }`}
                  data-testid={`result-condition-${c.type}`}
                >
                  {c.passed ? <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> : <XCircle className="h-2.5 w-2.5 mr-1" />}
                  {c.type} {OPERATOR_LABELS[c.operator]} {c.value}
                </Badge>
              ))}
            </div>
          )}

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

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              Create Custom Condition
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="e.g., High Volume Filter"
                value={newCondition.label}
                onChange={(e) => setNewCondition({ ...newCondition, label: e.target.value })}
                data-testid="input-new-condition-label"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Condition Type</Label>
                <Select value={newCondition.conditionType} onValueChange={(v) => setNewCondition({ ...newCondition, conditionType: v })}>
                  <SelectTrigger data-testid="select-new-condition-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rvol">Relative Volume</SelectItem>
                    <SelectItem value="volume_ratio">Volume Ratio</SelectItem>
                    <SelectItem value="price_change_pct">Price Change %</SelectItem>
                    <SelectItem value="gap_pct">Gap %</SelectItem>
                    <SelectItem value="pattern_score">Pattern Score</SelectItem>
                    <SelectItem value="reward_risk">Reward/Risk</SelectItem>
                    <SelectItem value="risk_pct">Risk %</SelectItem>
                    <SelectItem value="pullback_depth">Pullback Depth %</SelectItem>
                    <SelectItem value="consolidation_tightness">Consolidation %</SelectItem>
                    <SelectItem value="custom_numeric">Custom Numeric</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={newCondition.category} onValueChange={(v) => setNewCondition({ ...newCondition, category: v })}>
                  <SelectTrigger data-testid="select-new-condition-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="volume">Volume</SelectItem>
                    <SelectItem value="trend">Trend</SelectItem>
                    <SelectItem value="momentum">Momentum</SelectItem>
                    <SelectItem value="pattern">Pattern</SelectItem>
                    <SelectItem value="risk">Risk</SelectItem>
                    <SelectItem value="volatility">Volatility</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Operator</Label>
                <Select value={newCondition.operator} onValueChange={(v) => setNewCondition({ ...newCondition, operator: v })}>
                  <SelectTrigger data-testid="select-new-condition-operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gte">{"\u2265"} Greater or equal</SelectItem>
                    <SelectItem value="lte">{"\u2264"} Less or equal</SelectItem>
                    <SelectItem value="gt">&gt; Greater than</SelectItem>
                    <SelectItem value="lt">&lt; Less than</SelectItem>
                    <SelectItem value="eq">= Equal to</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Value</Label>
                <Input
                  placeholder="e.g., 2.0"
                  value={newCondition.value}
                  onChange={(e) => setNewCondition({ ...newCondition, value: e.target.value })}
                  data-testid="input-new-condition-value"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-condition">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newCondition.label || !newCondition.conditionType || !newCondition.value) {
                  toast({ title: "Missing fields", description: "Fill in name, type, and value.", variant: "destructive" });
                  return;
                }
                createConditionMutation.mutate(newCondition);
              }}
              disabled={createConditionMutation.isPending}
              data-testid="button-save-condition"
            >
              {createConditionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Condition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
