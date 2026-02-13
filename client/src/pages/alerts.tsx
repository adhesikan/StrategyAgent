import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Bot, Plus, Check, Trash2, List, Power, PowerOff, Clock, AlertCircle, TrendingUp, ExternalLink, HelpCircle, ArrowUpDown } from "lucide-react";
import { Link, useSearch } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AlertRule, AlertEvent, Watchlist, InsertAlertRule, RuleConditionTypeValue, AutomationEndpoint } from "@shared/schema";
import { RuleConditionType, PatternStage, StrategyType, ScanInterval } from "@shared/schema";
import { STRATEGY_CONFIGS } from "@shared/strategies";
import { Zap } from "lucide-react";

function getStageBadgeVariant(stage: string): "default" | "secondary" | "destructive" | "outline" {
  switch (stage) {
    case "BREAKOUT":
      return "default";
    case "READY":
      return "secondary";
    case "FORMING":
      return "outline";
    default:
      return "outline";
  }
}

function AlertRuleCard({ 
  rule, 
  onToggle, 
  onDelete,
  endpoints,
  onUpdateEndpoint,
  watchlists,
}: { 
  rule: AlertRule; 
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  endpoints?: AutomationEndpoint[];
  onUpdateEndpoint?: (id: string, endpointId: string | null) => void;
  watchlists?: Watchlist[];
}) {
  const payload = rule.conditionPayload as { 
    targetStage?: string; 
    minPatternScore?: number;
    minResistancePercent?: number;
    maxResistancePercent?: number;
  } | null;
  const targetStage = payload?.targetStage || "BREAKOUT";
  const lastState = rule.lastState as { stage?: string; price?: number } | null;
  const assignedEndpoint = endpoints?.find(e => e.id === rule.automationEndpointId);
  const strategyConfig = STRATEGY_CONFIGS.find(s => s.id === rule.strategy);
  const watchlistName = rule.watchlistId 
    ? watchlists?.find(w => w.id === rule.watchlistId)?.name 
    : null;
  
  return (
    <Card 
      className={`relative overflow-visible ${rule.isEnabled ? "" : "opacity-60"}`}
      data-testid={`rule-card-${rule.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {rule.isGlobal ? (
              <Badge variant="outline" className="gap-1 text-sm font-semibold">
                <Bell className="h-3 w-3" />
                Any Symbol
              </Badge>
            ) : watchlistName ? (
              <Badge variant="outline" className="gap-1 text-sm font-semibold">
                <List className="h-3 w-3" />
                {watchlistName}
              </Badge>
            ) : (
              <span className="text-lg font-semibold font-mono">{rule.symbol}</span>
            )}
            {strategyConfig && (
              <Badge variant="outline" className="gap-1 text-xs">
                {strategyConfig.displayName}
              </Badge>
            )}
            <Badge variant={getStageBadgeVariant(targetStage)} className="gap-1">
              <TrendingUp className="h-3 w-3" />
              {targetStage}
            </Badge>
            {payload?.minPatternScore && (
              <Badge variant="outline" className="gap-1 text-xs">
                Score ≥ {payload.minPatternScore}
              </Badge>
            )}
            {payload?.minResistancePercent && (
              <Badge variant="outline" className="gap-1 text-xs">
                ≥ {payload.minResistancePercent}% to R
              </Badge>
            )}
            {payload?.maxResistancePercent && (
              <Badge variant="outline" className="gap-1 text-xs">
                ≤ {payload.maxResistancePercent}% to R
              </Badge>
            )}
            {rule.sendWebhook && assignedEndpoint && (
              <Badge variant="secondary" className="gap-1">
                <Zap className="h-3 w-3" />
                {assignedEndpoint.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={rule.isEnabled ?? true}
              onCheckedChange={(checked) => onToggle(rule.id, checked)}
              data-testid={`switch-rule-${rule.id}`}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(rule.id)}
              data-testid={`button-delete-rule-${rule.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2 text-sm text-muted-foreground">
          {rule.isGlobal 
            ? `Alert when any symbol enters ${targetStage} stage`
            : watchlistName
              ? `Alert when any symbol in ${watchlistName} enters ${targetStage} stage`
              : `Alert when ${rule.symbol} enters ${targetStage} stage`}
        </div>

        {endpoints && endpoints.length > 0 && onUpdateEndpoint && (
          <div className="mt-3">
            <Select
              value={rule.automationEndpointId || "none"}
              onValueChange={(value) => onUpdateEndpoint(rule.id, value === "none" ? null : value)}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-endpoint-${rule.id}`}>
                <Zap className="h-3 w-3 mr-1" />
                <SelectValue placeholder="No automation endpoint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No automation endpoint</SelectItem>
                {endpoints.filter(e => e.isActive).map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {lastState?.stage && (
              <span className="flex items-center gap-1">
                Current: <Badge variant="outline" className="h-5 text-xs">{lastState.stage}</Badge>
              </span>
            )}
            {lastState?.price && (
              <span className="font-mono">${lastState.price.toFixed(2)}</span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {rule.scanInterval || "5m"}
            </span>
          </div>
          {rule.lastEvaluatedAt && (
            <span className="flex items-center gap-1">
              Checked {formatDistanceToNow(new Date(rule.lastEvaluatedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertEventCard({ 
  event, 
  onMarkRead,
  onInstaTrade,
  endpoints,
  isTrading
}: { 
  event: AlertEvent; 
  onMarkRead?: (id: string) => void;
  onInstaTrade?: (event: AlertEvent, endpointId: string) => void;
  endpoints?: AutomationEndpoint[];
  isTrading?: boolean;
}) {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("");
  const payload = event.payload as { message?: string; resistance?: number; stopLoss?: number; patternScore?: number } | null;
  const deliveryStatus = event.deliveryStatus as { 
    push?: boolean; 
    pushSentAt?: string; 
    webhook?: boolean; 
    webhookSentAt?: string;
    endpointName?: string;
  } | null;
  const timeAgo = event.triggeredAt
    ? formatDistanceToNow(new Date(event.triggeredAt), { addSuffix: true })
    : "";
  
  const formatDeliveryTime = (isoString?: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };
  
  return (
    <Card 
      className={`relative overflow-visible ${!event.isRead ? "border-primary/30" : "bg-muted/50 opacity-75"}`}
      data-testid={`event-card-${event.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={getStageBadgeVariant(event.toState)} className="gap-1">
              <TrendingUp className="h-3 w-3" />
              {event.toState}
            </Badge>
            {!event.isRead && (
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            )}
          </div>
          {onMarkRead && !event.isRead && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onMarkRead(event.id)}
              data-testid={`button-mark-read-${event.id}`}
            >
              <Check className="h-3 w-3 mr-1" />
              Mark Read
            </Button>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-lg font-semibold font-mono">{event.symbol}</span>
          {event.price != null && (
            <span className="text-lg font-mono font-semibold text-chart-2">
              ${event.price.toFixed(2)}
            </span>
          )}
        </div>

        {event.fromState && (
          <div className="mt-1 text-sm text-muted-foreground">
            Transitioned from {event.fromState} to {event.toState}
          </div>
        )}

        {payload?.message && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
            {payload.message}
          </p>
        )}

        {/* Delivery Status */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {deliveryStatus?.push && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Bell className="h-3 w-3" />
              Push {deliveryStatus.pushSentAt && `@ ${formatDeliveryTime(deliveryStatus.pushSentAt)}`}
            </Badge>
          )}
          {deliveryStatus?.webhook && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Zap className="h-3 w-3" />
              {deliveryStatus.endpointName || "Webhook"} {deliveryStatus.webhookSentAt && `@ ${formatDeliveryTime(deliveryStatus.webhookSentAt)}`}
            </Badge>
          )}
          {!deliveryStatus?.push && !deliveryStatus?.webhook && (
            <span className="text-xs text-muted-foreground">No delivery configured</span>
          )}
        </div>

        {/* InstaTrade Action */}
        {endpoints && endpoints.length > 0 && onInstaTrade && (
          <div className="mt-3 pt-3 border-t flex items-center gap-2">
            <Select 
              value={selectedEndpoint} 
              onValueChange={setSelectedEndpoint}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <Zap className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Select endpoint" />
              </SelectTrigger>
              <SelectContent>
                {endpoints.filter(e => e.isActive).map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!selectedEndpoint || isTrading || !event.price || event.price <= 0}
              onClick={() => selectedEndpoint && onInstaTrade(event, selectedEndpoint)}
              data-testid={`button-instatrade-${event.id}`}
              title={!event.price || event.price <= 0 ? "Price data required for trade" : ""}
            >
              <Zap className="h-3 w-3" />
              {isTrading ? "Sending..." : "Trade Now"}
            </Button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
          <Link href={`/charts/${event.symbol}`}>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <ExternalLink className="h-3 w-3" />
              View Chart
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const tabParam = urlParams.get("tab");
  const initialTab = tabParam === "history" ? "history" : tabParam === "trades" ? "trades" : "rules";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedWatchlist, setSelectedWatchlist] = useState<string>("none");
  const [alertType, setAlertType] = useState<"global" | "single" | "watchlist">("global");
  const [newRule, setNewRule] = useState({
    symbol: "",
    targetStage: "BREAKOUT" as string,
    automationEndpointId: "none" as string,
    isGlobal: true,
    sendPushNotification: true,
    sendWebhook: false,
    strategy: "VCP" as string,
    minPatternScore: null as number | null,
    minResistancePercent: null as number | null,
    maxResistancePercent: null as number | null,
    scanInterval: "5m" as string,
    watchlistId: null as string | null,
  });
  const { toast } = useToast();

  const { data: rules, isLoading: rulesLoading } = useQuery<AlertRule[]>({
    queryKey: ["/api/alert-rules"],
  });

  const { data: events, isLoading: eventsLoading } = useQuery<AlertEvent[]>({
    queryKey: ["/api/alert-events"],
  });

  const { data: watchlists } = useQuery<Watchlist[]>({
    queryKey: ["/api/watchlists"],
  });

  const { data: automationEndpoints = [] } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  interface ExecutedTrade {
    id: string;
    symbol: string;
    source: "auto_agent" | "instatrade";
    action?: string;
    side: string;
    quantity: number;
    orderType: string;
    price: number | null;
    status: string;
    brokerOrderId: string | null;
    isOptions: boolean;
    optionDetails: {
      optionType: string;
      strike: number;
      expiration: string;
    } | null;
    reasons: string[] | null;
    createdAt: string;
  }

  const { data: allTrades, isLoading: tradesLoading } = useQuery<ExecutedTrade[]>({
    queryKey: ["/api/all-trades"],
  });

  const selectedWatchlistData = watchlists?.find(w => w.id === selectedWatchlist);

  useEffect(() => {
    if (selectedWatchlistData?.symbols && selectedWatchlistData.symbols.length > 0) {
      setNewRule(prev => ({ ...prev, symbol: selectedWatchlistData.symbols![0] }));
    }
  }, [selectedWatchlistData]);

  const createRuleMutation = useMutation({
    mutationFn: async (data: Partial<InsertAlertRule>) => {
      const response = await apiRequest("POST", "/api/alert-rules", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] });
      setIsCreateOpen(false);
      setNewRule({ symbol: "", targetStage: "BREAKOUT", automationEndpointId: "none", isGlobal: true, sendPushNotification: true, sendWebhook: false, strategy: "VCP", minPatternScore: null, minResistancePercent: null, maxResistancePercent: null, scanInterval: "5m", watchlistId: null });
      setSelectedWatchlist("none");
      setAlertType("global");
      toast({
        title: "Alert Rule Created",
        description: "You'll be notified when conditions are met",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/alert-rules/${id}`, { isEnabled: enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/alert-rules/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] });
      toast({ title: "Alert rule deleted" });
    },
  });

  const updateRuleEndpointMutation = useMutation({
    mutationFn: async ({ id, endpointId }: { id: string; endpointId: string | null }) => {
      await apiRequest("PATCH", `/api/alert-rules/${id}`, { automationEndpointId: endpointId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-rules"] });
      toast({ title: "Automation endpoint updated" });
    },
  });

  const markEventReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/alert-events/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-events"] });
    },
  });

  const markAllEventsReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/alert-events/mark-all-read", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-events"] });
      toast({ title: "All events marked as read" });
    },
  });

  const instatradeMutation = useMutation({
    mutationFn: async ({ event, endpointId }: { event: AlertEvent; endpointId: string }) => {
      if (!event.price || event.price <= 0) {
        throw new Error("Valid price required to execute trade");
      }
      
      const payload = event.payload as { resistance?: number; stopLoss?: number; patternScore?: number } | null;
      const price = event.price;
      const resistance = payload?.resistance || price * 1.02;
      const stopLoss = payload?.stopLoss || price * 0.93;
      
      const response = await apiRequest("POST", "/api/instatrade/entry", {
        endpointId,
        symbol: event.symbol,
        strategyId: "VCP",
        alertEventId: event.id,
        setupPayload: {
          price,
          resistance,
          stopLoss,
          patternScore: payload?.patternScore || 75,
          stage: event.toState,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Trade Sent",
        description: "Entry signal sent to endpoint",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
    },
    onError: (error: any) => {
      toast({
        title: "Trade Failed",
        description: error.message || "Could not send entry signal",
        variant: "destructive",
      });
    },
  });

  const handleInstaTrade = (event: AlertEvent, endpointId: string) => {
    instatradeMutation.mutate({ event, endpointId });
  };

  const handleCreateRule = () => {
    // Allow global alerts, watchlist alerts, or single symbol alerts
    if (newRule.isGlobal || newRule.watchlistId || newRule.symbol) {
      const conditionPayload: Record<string, unknown> = { 
        targetStage: newRule.targetStage,
      };
      if (newRule.minPatternScore !== null) {
        conditionPayload.minPatternScore = newRule.minPatternScore;
      }
      if (newRule.minResistancePercent !== null) {
        conditionPayload.minResistancePercent = newRule.minResistancePercent;
      }
      if (newRule.maxResistancePercent !== null) {
        conditionPayload.maxResistancePercent = newRule.maxResistancePercent;
      }
      
      createRuleMutation.mutate({
        symbol: newRule.isGlobal || newRule.watchlistId ? null : newRule.symbol.toUpperCase(),
        isGlobal: newRule.isGlobal,
        conditionType: RuleConditionType.STAGE_ENTERED,
        conditionPayload,
        strategy: newRule.strategy,
        timeframe: "1d",
        scanInterval: newRule.scanInterval,
        isEnabled: true,
        sendPushNotification: newRule.sendPushNotification,
        sendWebhook: newRule.sendWebhook,
        automationEndpointId: newRule.automationEndpointId === "none" || !newRule.automationEndpointId ? null : newRule.automationEndpointId,
        watchlistId: newRule.watchlistId || null,
      });
    }
  };

  // Sort rules and events by stage: BREAKOUT first, then READY, then FORMING
  const stageOrder: Record<string, number> = { BREAKOUT: 0, READY: 1, FORMING: 2 };
  
  const sortedRules = [...(rules || [])].sort((a, b) => {
    const payloadA = a.conditionPayload as { targetStage?: string } | null;
    const payloadB = b.conditionPayload as { targetStage?: string } | null;
    const orderA = stageOrder[payloadA?.targetStage || "BREAKOUT"] ?? 3;
    const orderB = stageOrder[payloadB?.targetStage || "BREAKOUT"] ?? 3;
    return orderA - orderB;
  });
  
  const enabledRules = sortedRules.filter(r => r.isEnabled);
  const disabledRules = sortedRules.filter(r => !r.isEnabled);
  const sortedEvents = [...(events || [])].sort((a, b) => {
    const orderA = stageOrder[a.toState] ?? 3;
    const orderB = stageOrder[b.toState] ?? 3;
    return orderA - orderB;
  });
  
  const unreadEvents = sortedEvents.filter(e => !e.isRead);
  const readEvents = sortedEvents.filter(e => e.isRead);

  return (
    <div className="p-6 space-y-6" data-testid="alerts-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure notifications and routing
          </p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-rule">
              <Plus className="h-4 w-4" />
              New Alert Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create VCP Stage Alert</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label className="font-medium">Alert Scope</Label>
                <div className="space-y-2">
                  <div 
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${alertType === "global" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                    onClick={() => {
                      setAlertType("global");
                      setNewRule(prev => ({ ...prev, isGlobal: true, watchlistId: null, symbol: "" }));
                    }}
                    data-testid="option-alert-global"
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Bell className="h-4 w-4" />
                        Any Symbol
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Alert on any symbol in scan results that matches stage
                      </p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${alertType === "global" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                  </div>

                  {watchlists && watchlists.length > 0 && (
                    <div 
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${alertType === "watchlist" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                      onClick={() => {
                        setAlertType("watchlist");
                        setNewRule(prev => ({ ...prev, isGlobal: false, symbol: "" }));
                      }}
                      data-testid="option-alert-watchlist"
                    >
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <List className="h-4 w-4" />
                          Entire Watchlist
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Alert on any symbol from a watchlist that matches stage
                        </p>
                      </div>
                      <div className={`w-4 h-4 rounded-full border-2 ${alertType === "watchlist" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                    </div>
                  )}

                  <div 
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${alertType === "single" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                    onClick={() => {
                      setAlertType("single");
                      setNewRule(prev => ({ ...prev, isGlobal: false, watchlistId: null }));
                    }}
                    data-testid="option-alert-single"
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Single Symbol
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Alert on a specific stock ticker only
                      </p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${alertType === "single" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                  </div>
                </div>
              </div>

              {alertType === "watchlist" && watchlists && watchlists.length > 0 && (
                <div className="space-y-2">
                  <Label>Select Watchlist</Label>
                  <Select 
                    value={newRule.watchlistId || ""} 
                    onValueChange={(value) => setNewRule(prev => ({ ...prev, watchlistId: value }))}
                  >
                    <SelectTrigger data-testid="select-rule-watchlist">
                      <List className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Choose a watchlist" />
                    </SelectTrigger>
                    <SelectContent>
                      {watchlists.map((wl) => (
                        <SelectItem key={wl.id} value={wl.id}>
                          {wl.name} ({wl.symbols?.length || 0} symbols)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {alertType === "single" && (
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol</Label>
                  <Input
                    id="symbol"
                    placeholder="AAPL"
                    value={newRule.symbol}
                    onChange={(e) => setNewRule(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                    className="font-mono uppercase"
                    data-testid="input-rule-symbol"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="strategy">Strategy</Label>
                <Select
                  value={newRule.strategy}
                  onValueChange={(value) => setNewRule(prev => ({ ...prev, strategy: value }))}
                >
                  <SelectTrigger id="strategy" data-testid="select-rule-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGY_CONFIGS.map((strategy) => (
                      <SelectItem key={strategy.id} value={strategy.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{strategy.displayName}</span>
                          <span className="text-xs text-muted-foreground">({strategy.category})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="stage">Target Stage</Label>
                <Select
                  value={newRule.targetStage}
                  onValueChange={(value) => setNewRule(prev => ({ ...prev, targetStage: value }))}
                >
                  <SelectTrigger id="stage" data-testid="select-rule-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BREAKOUT">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Breakout</span>
                        <span className="text-xs text-muted-foreground">Alert when price breaks above resistance</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="READY">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Ready</span>
                        <span className="text-xs text-muted-foreground">Alert when pattern is ready for breakout</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="FORMING">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Forming</span>
                        <span className="text-xs text-muted-foreground">Alert when pattern starts forming</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  You'll be notified when the stock enters this stage
                </p>
              </div>

              <div className="space-y-3 p-3 rounded-lg border">
                <Label className="font-medium">Optional Filters</Label>
                <p className="text-xs text-muted-foreground">
                  Only trigger alert when these conditions are met
                </p>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="minScore" className="text-xs">Min Pattern Score</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[250px]">
                          <p>Only alert for stocks with pattern score at or above this value. Higher scores indicate stronger pattern quality.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="minScore"
                      type="number"
                      placeholder="Any"
                      value={newRule.minPatternScore ?? ""}
                      onChange={(e) => setNewRule(prev => ({ 
                        ...prev, 
                        minPatternScore: e.target.value ? parseInt(e.target.value) : null 
                      }))}
                      min={0}
                      max={100}
                      className="h-8"
                      data-testid="input-min-score"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="minResist" className="text-xs">Min % to R</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p>Only alert for stocks that are at least this far from resistance. Use this to find stocks with more upside potential.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="minResist"
                        type="number"
                        placeholder="Any"
                        value={newRule.minResistancePercent ?? ""}
                        onChange={(e) => setNewRule(prev => ({ 
                          ...prev, 
                          minResistancePercent: e.target.value ? parseFloat(e.target.value) : null 
                        }))}
                        min={0}
                        step={0.5}
                        className="h-8"
                        data-testid="input-min-resistance"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="maxResist" className="text-xs">Max % to R</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p>Only alert for stocks within this distance of resistance. Use this to catch stocks near breakout points.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="maxResist"
                        type="number"
                        placeholder="Any"
                        value={newRule.maxResistancePercent ?? ""}
                        onChange={(e) => setNewRule(prev => ({ 
                          ...prev, 
                          maxResistancePercent: e.target.value ? parseFloat(e.target.value) : null 
                        }))}
                        min={0}
                        step={0.5}
                        className="h-8"
                        data-testid="input-max-resistance"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Scan Interval</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[250px]">
                      <p>How often to check for pattern changes and evaluate this alert rule during market hours.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select
                  value={newRule.scanInterval}
                  onValueChange={(value) => setNewRule(prev => ({ ...prev, scanInterval: value }))}
                >
                  <SelectTrigger data-testid="select-scan-interval">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">Every 1 minute</SelectItem>
                    <SelectItem value="5m">Every 5 minutes (default)</SelectItem>
                    <SelectItem value="15m">Every 15 minutes</SelectItem>
                    <SelectItem value="30m">Every 30 minutes</SelectItem>
                    <SelectItem value="1h">Every hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3 p-3 rounded-lg border">
                <Label className="font-medium">Notification Settings</Label>
                
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm">Push Notification</span>
                    <p className="text-xs text-muted-foreground">Send to browser/mobile</p>
                  </div>
                  <Switch
                    checked={newRule.sendPushNotification}
                    onCheckedChange={(checked) => setNewRule(prev => ({ ...prev, sendPushNotification: checked }))}
                    data-testid="switch-push-notification"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm">Send Webhook</span>
                    <p className="text-xs text-muted-foreground">Execute InstaTrade™ entry</p>
                  </div>
                  <Switch
                    checked={newRule.sendWebhook}
                    onCheckedChange={(checked) => setNewRule(prev => ({ ...prev, sendWebhook: checked }))}
                    data-testid="switch-send-webhook"
                  />
                </div>

                {newRule.sendWebhook && (
                  <Select
                    value={newRule.automationEndpointId}
                    onValueChange={(value) => setNewRule(prev => ({ ...prev, automationEndpointId: value }))}
                  >
                    <SelectTrigger data-testid="select-rule-automation-endpoint">
                      <Zap className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Select automation endpoint" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {automationEndpoints.filter(e => e.isActive).map((endpoint) => (
                        <SelectItem key={endpoint.id} value={endpoint.id}>
                          <span className="font-medium">{endpoint.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Button
                onClick={handleCreateRule}
                disabled={(!newRule.isGlobal && !newRule.watchlistId && !newRule.symbol) || createRuleMutation.isPending}
                className="w-full"
                data-testid="button-submit-rule"
              >
                {createRuleMutation.isPending ? "Creating..." : "Create Alert Rule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="default" className="gap-1">
          <Power className="h-3 w-3" />
          Active Rules <span className="font-mono">{enabledRules.length}</span>
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <Bell className="h-3 w-3" />
          Unread <span className="font-mono">{unreadEvents.length}</span>
        </Badge>
        <Badge variant="outline" className="gap-1">
          Total Events <span className="font-mono">{events?.length || 0}</span>
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="rules" data-testid="tab-rules">
            Rules ({rules?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            History ({events?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="trades" data-testid="tab-trades">
            Trades ({allTrades?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-6">
          {rulesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : sortedRules && sortedRules.length > 0 ? (
            <div className="flex flex-col gap-3">
              {sortedRules.map((rule) => (
                <AlertRuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(id, enabled) => toggleRuleMutation.mutate({ id, enabled })}
                  onDelete={(id) => deleteRuleMutation.mutate(id)}
                  endpoints={automationEndpoints}
                  onUpdateEndpoint={(id, endpointId) => updateRuleEndpointMutation.mutate({ id, endpointId })}
                  watchlists={watchlists}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No alert rules</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a rule to monitor VCP stage transitions
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-6 space-y-4">
          {unreadEvents.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllEventsReadMutation.mutate()}
                className="gap-1"
                data-testid="button-mark-all-read"
              >
                <Check className="h-4 w-4" />
                Mark All Read
              </Button>
            </div>
          )}

          {eventsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : sortedEvents && sortedEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {sortedEvents.map((event) => (
                <AlertEventCard
                  key={event.id}
                  event={event}
                  onMarkRead={(id) => markEventReadMutation.mutate(id)}
                  onInstaTrade={handleInstaTrade}
                  endpoints={automationEndpoints}
                  isTrading={instatradeMutation.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No alert events</p>
              <p className="text-xs text-muted-foreground mt-1">
                Events will appear here when your rules are triggered
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="trades" className="mt-6 space-y-4">
          {tradesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : allTrades && allTrades.length > 0 ? (
            <div className="flex flex-col gap-3">
              {allTrades.map((trade) => (
                <Card key={trade.id} data-testid={`trade-card-${trade.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge
                          variant={trade.status === "rejected" ? "destructive" : trade.source === "auto_agent" ? "default" : "secondary"}
                          className="text-xs shrink-0"
                          data-testid={`badge-trade-source-${trade.id}`}
                        >
                          {trade.source === "auto_agent" ? (
                            <><Bot className="h-3 w-3 mr-1" />{trade.status === "rejected" ? "Rejected" : "Auto Agent"}</>
                          ) : (
                            <><Zap className="h-3 w-3 mr-1" />InstaTrade™</>
                          )}
                        </Badge>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm" data-testid={`text-trade-sym-${trade.id}`}>
                              {trade.symbol}
                            </span>
                            {trade.status !== "rejected" && (
                              <Badge variant="outline" className="text-xs uppercase">
                                {trade.side}
                              </Badge>
                            )}
                            {trade.isOptions && trade.optionDetails && (
                              <span className="text-xs text-muted-foreground">
                                {trade.optionDetails.optionType?.toUpperCase()} ${trade.optionDetails.strike} exp {trade.optionDetails.expiration}
                              </span>
                            )}
                          </div>
                          {trade.status !== "rejected" && (
                            <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-muted-foreground">
                              <span>Qty: {trade.quantity}</span>
                              {trade.price && <span>@ ${trade.price.toFixed(2)}</span>}
                              <span>{trade.orderType}</span>
                              {trade.brokerOrderId && (
                                <span className="font-mono">#{trade.brokerOrderId}</span>
                              )}
                            </div>
                          )}
                          {trade.reasons && trade.reasons.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {(trade.reasons as string[]).map((reason, i) => (
                                <p key={i} className={`text-xs ${trade.status === "rejected" ? "text-destructive/80" : "text-muted-foreground"}`}>
                                  {trade.status === "rejected" && <AlertCircle className="h-3 w-3 inline mr-1 -mt-0.5" />}
                                  {reason}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge
                          variant={
                            trade.status === "filled" || trade.status === "executed" ? "default" :
                            trade.status === "pending" ? "outline" :
                            trade.status === "rejected" || trade.status === "cancelled" ? "destructive" : "secondary"
                          }
                          className="text-xs"
                          data-testid={`badge-trade-status-${trade.id}`}
                        >
                          {trade.status}
                        </Badge>
                        <div className="flex flex-col items-end gap-0.5" data-testid={`text-trade-time-${trade.id}`}>
                          {trade.createdAt && (
                            <>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(trade.createdAt), "MMM d, yyyy h:mm a")}
                              </span>
                              <span className="text-[11px] text-muted-foreground/70">
                                {formatDistanceToNow(new Date(trade.createdAt), { addSuffix: true })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ArrowUpDown className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No trade activity</p>
              <p className="text-xs text-muted-foreground mt-1">
                Executed and rejected trades from Auto Agent and InstaTrade™ will appear here
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
