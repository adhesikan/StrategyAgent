import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Link2,
  Bot,
  History,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  LogOut,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ShieldCheck,
  DollarSign,
  Settings,
  CreditCard,
  Zap,
  Shield,
  BarChart3,
  ExternalLink,
  Target,
  Filter,
  Wrench,
  Crosshair,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

interface PartnerProfile {
  id: string;
  email: string;
  name: string | null;
  partnerName: string;
  partnerLogo: string | null;
  partnerColor: string | null;
  linkedUserId: string;
  subscriptionActive?: boolean;
  subscriptionStatus?: string | null;
}

interface BrokerStatus {
  id?: string;
  provider?: string;
  isConnected?: boolean;
  connected?: boolean;
  preferredAccountId?: string;
}

interface TradeAlert {
  id: string;
  symbol: string;
  direction: string;
  alertType: string;
  strategyName: string;
  entryPrice: number;
  riskPrice: number | null;
  targetPrice: number | null;
  status: string;
  skipReason: string | null;
  exitReason: string | null;
  executedPrice: number | null;
  executedAt: string | null;
  alertTimestamp: string;
  createdAt: string;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const brokerProviders = [
  {
    id: "tradier",
    name: "Tradier",
    description: "Commission-free trading platform",
    supportsOAuth: true,
    signupUrl: "https://join.tradier.com/partner?platform=261",
  },
  {
    id: "tradestation",
    name: "TradeStation",
    description: "Professional trading platform",
    supportsOAuth: true,
    signupUrl: "https://getstarted2.tradestation.com/intro?offer=ALGOAGRB",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    description: "API-first stock trading",
    supportsOAuth: false,
    signupUrl: "https://app.alpaca.markets/signup",
  },
];

function BrokerTab() {
  const { data: broker, isLoading } = useQuery<BrokerStatus>({
    queryKey: ["/api/partner/broker"],
  });

  const isConnected = broker?.isConnected || broker?.connected;

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      {isConnected && (
        <Card data-testid="card-broker-status">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-medium">Connected</span>
              <Badge variant="outline">{broker?.provider}</Badge>
            </div>
            {broker?.preferredAccountId && (
              <p className="text-sm text-muted-foreground mt-2">
                Account: {broker.preferredAccountId}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="w-5 h-5" />
          <h3 className="text-base font-medium">Brokerage Connection</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Select a brokerage to connect for automated trading
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brokerProviders.map((bp) => {
            const isBrokerConnected = broker?.provider === bp.id && isConnected;
            return (
              <Card
                key={bp.id}
                className={`cursor-pointer hover-elevate ${isBrokerConnected ? "border-primary" : ""}`}
                onClick={() => !isBrokerConnected && bp.supportsOAuth && (window.location.href = `/api/${bp.id}/oauth`)}
                data-testid={`broker-${bp.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{bp.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {bp.description}
                      </p>
                    </div>
                    {isBrokerConnected && (
                      <Badge variant="default" className="text-xs">Active</Badge>
                    )}
                  </div>
                  {bp.signupUrl && !isBrokerConnected && (
                    <a
                      href={bp.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`link-${bp.id}-signup`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open a {bp.name} Account
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          You will be redirected to your broker to authorize the connection.
        </p>
      </div>
    </div>
  );
}

interface AgentSettingsData {
  id?: string;
  userId?: string;
  enabled?: boolean;
  mode?: string;
  assetTypes?: string[];
  timezone?: string;
  tradingWindowStart?: string;
  tradingWindowEnd?: string;
  riskPerTradeUsd?: number;
  maxDailyLossUsd?: number;
  maxTradesPerDay?: number;
  maxConcurrentPositions?: number;
  minPrice?: number;
  maxPrice?: number;
  minRr?: number;
  entryOrderType?: string;
  timeInForce?: string;
  limitOffsetPercent?: number;
  missingStopsPolicy?: string;
  bracketEnabled?: boolean;
  requireStops?: boolean;
  direction?: string;
  sizingMethod?: string;
  fixedQuantity?: number | null;
  fixedNotionalUsd?: number | null;
  symbolAllowlist?: string[] | null;
  symbolBlocklist?: string[] | null;
  duplicateSignalWindowMinutes?: number;
  cooldownMinutesAfterExit?: number;
  maxPositionsPerSymbol?: number;
  optionsConstraints?: Record<string, any>;
  futuresConstraints?: Record<string, any>;
  reliability?: Record<string, any>;
}

function AgentTab() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<AgentSettingsData>({
    queryKey: ["/api/partner/agent-settings"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<AgentSettingsData>) => {
      const res = await apiRequest("PUT", "/api/partner/agent-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/agent-settings"] });
      toast({ title: "Agent settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const [formData, setFormData] = useState<Partial<AgentSettingsData>>({});
  const [allowlistText, setAllowlistText] = useState("");
  const [blocklistText, setBlocklistText] = useState("");

  useEffect(() => {
    if (settings) {
      setAllowlistText((settings.symbolAllowlist || []).join(", "));
      setBlocklistText((settings.symbolBlocklist || []).join(", "));
    }
  }, [settings]);

  const current = { ...settings, ...formData };
  const hasChanges = Object.keys(formData).length > 0;

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
    setFormData({});
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Section 1: Auto Agent Configuration */}
      <Card data-testid="card-agent-config">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Auto Agent Configuration
          </CardTitle>
          <CardDescription>Configure how the trading agent handles incoming signals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="font-medium">Agent Enabled</Label>
              <p className="text-xs text-muted-foreground">Turn on/off automated signal processing</p>
            </div>
            <Switch
              checked={current.enabled ?? false}
              onCheckedChange={(val) => updateField("enabled", val)}
              data-testid="switch-agent-enabled"
            />
          </div>

          <div className="space-y-2">
            <Label>Agent Mode</Label>
            <Select
              value={current.mode || "suggest"}
              onValueChange={(val) => updateField("mode", val)}
            >
              <SelectTrigger data-testid="select-agent-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suggest">Suggest (Review before executing)</SelectItem>
                <SelectItem value="auto">Auto (Execute automatically)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Trading Window Start</Label>
              <Input
                type="text"
                placeholder="09:35"
                value={current.tradingWindowStart || "09:35:00"}
                onChange={(e) => updateField("tradingWindowStart", e.target.value)}
                data-testid="input-window-start"
              />
            </div>
            <div className="space-y-2">
              <Label>Trading Window End</Label>
              <Input
                type="text"
                placeholder="15:50"
                value={current.tradingWindowEnd || "15:50:00"}
                onChange={(e) => updateField("tradingWindowEnd", e.target.value)}
                data-testid="input-window-end"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={current.timezone || "America/New_York"}
              onValueChange={(val) => updateField("timezone", val)}
            >
              <SelectTrigger data-testid="select-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Risk Limits */}
      <Card data-testid="card-risk-limits">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Risk Limits
          </CardTitle>
          <CardDescription>Set guardrails for how much capital is at risk</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Risk Per Trade ($)</Label>
              <Input
                type="number"
                value={current.riskPerTradeUsd ?? 100}
                onChange={(e) => updateField("riskPerTradeUsd", Number(e.target.value))}
                data-testid="input-risk-per-trade"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Daily Loss ($)</Label>
              <Input
                type="number"
                value={current.maxDailyLossUsd ?? 200}
                onChange={(e) => updateField("maxDailyLossUsd", Number(e.target.value))}
                data-testid="input-max-daily-loss"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Concurrent Positions</Label>
              <Input
                type="number"
                value={current.maxConcurrentPositions ?? 2}
                onChange={(e) => updateField("maxConcurrentPositions", Number(e.target.value))}
                data-testid="input-max-positions"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Trades Per Day</Label>
              <Input
                type="number"
                value={current.maxTradesPerDay ?? 2}
                onChange={(e) => updateField("maxTradesPerDay", Number(e.target.value))}
                data-testid="input-max-trades-day"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Min Price ($)</Label>
              <Input
                type="number"
                value={current.minPrice ?? 5}
                onChange={(e) => updateField("minPrice", Number(e.target.value))}
                data-testid="input-min-price"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Price ($)</Label>
              <Input
                type="number"
                value={current.maxPrice ?? 500}
                onChange={(e) => updateField("maxPrice", Number(e.target.value))}
                data-testid="input-max-price"
              />
            </div>
            <div className="space-y-1">
              <Label>Min R:R</Label>
              <Input
                type="number"
                step="0.1"
                value={current.minRr ?? 2}
                onChange={(e) => updateField("minRr", Number(e.target.value))}
                data-testid="input-min-rr"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Execution */}
      <Card data-testid="card-execution">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="w-5 h-5" />
            Execution
          </CardTitle>
          <CardDescription>How orders are placed when signals are triggered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Entry Order Type</Label>
              <Select
                value={current.entryOrderType || "limit"}
                onValueChange={(val) => updateField("entryOrderType", val)}
              >
                <SelectTrigger data-testid="select-entry-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market</SelectItem>
                  <SelectItem value="limit">Limit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Time in Force</Label>
              <Select
                value={current.timeInForce || "day"}
                onValueChange={(val) => updateField("timeInForce", val)}
              >
                <SelectTrigger data-testid="select-time-in-force">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="gtc">GTC (Good Till Cancel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {current.entryOrderType === "limit" && (
            <div className="space-y-1">
              <Label>Limit Offset (%)</Label>
              <p className="text-xs text-muted-foreground">How far above/below signal price to place the limit</p>
              <Input
                type="number"
                step="0.01"
                value={current.limitOffsetPercent ?? 0.05}
                onChange={(e) => updateField("limitOffsetPercent", Number(e.target.value))}
                data-testid="input-limit-offset"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Missing Stops Policy</Label>
            <p className="text-xs text-muted-foreground">What to do when a signal has no stop price</p>
            <Select
              value={current.missingStopsPolicy || "skip"}
              onValueChange={(val) => updateField("missingStopsPolicy", val)}
            >
              <SelectTrigger data-testid="select-missing-stops">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip the trade</SelectItem>
                <SelectItem value="suggest">Suggest (manual review)</SelectItem>
                <SelectItem value="defaults">Use default stop distance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="font-medium">Bracket Orders</Label>
              <p className="text-xs text-muted-foreground">Automatically attach stop + target to entries</p>
            </div>
            <Switch
              checked={current.bracketEnabled ?? true}
              onCheckedChange={(val) => updateField("bracketEnabled", val)}
              data-testid="switch-bracket-enabled"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="font-medium">Require Stops</Label>
              <p className="text-xs text-muted-foreground">Only execute trades that have a defined stop loss</p>
            </div>
            <Switch
              checked={current.requireStops ?? true}
              onCheckedChange={(val) => updateField("requireStops", val)}
              data-testid="switch-require-stops"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Filters & Sizing */}
      <Card data-testid="card-filters-sizing">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters & Sizing
          </CardTitle>
          <CardDescription>Control which signals are accepted and how positions are sized</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select
                value={current.direction || "both"}
                onValueChange={(val) => updateField("direction", val)}
              >
                <SelectTrigger data-testid="select-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long Only</SelectItem>
                  <SelectItem value="short">Short Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sizing Method</Label>
              <Select
                value={current.sizingMethod || "riskBased"}
                onValueChange={(val) => updateField("sizingMethod", val)}
              >
                <SelectTrigger data-testid="select-sizing-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="riskBased">Risk-Based ($ at risk per trade)</SelectItem>
                  <SelectItem value="fixedQty">Fixed Quantity</SelectItem>
                  <SelectItem value="fixedNotional">Fixed Dollar Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {current.sizingMethod === "fixedQty" && (
            <div className="space-y-1">
              <Label>Fixed Quantity (shares)</Label>
              <Input
                type="number"
                value={current.fixedQuantity ?? ""}
                onChange={(e) => updateField("fixedQuantity", e.target.value ? Number(e.target.value) : null)}
                data-testid="input-fixed-quantity"
              />
            </div>
          )}

          {current.sizingMethod === "fixedNotional" && (
            <div className="space-y-1">
              <Label>Fixed Notional ($)</Label>
              <Input
                type="number"
                value={current.fixedNotionalUsd ?? ""}
                onChange={(e) => updateField("fixedNotionalUsd", e.target.value ? Number(e.target.value) : null)}
                data-testid="input-fixed-notional"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Duplicate Signal Window (min)</Label>
              <Input
                type="number"
                value={current.duplicateSignalWindowMinutes ?? 10}
                onChange={(e) => updateField("duplicateSignalWindowMinutes", Number(e.target.value))}
                data-testid="input-dup-window"
              />
            </div>
            <div className="space-y-1">
              <Label>Cooldown After Exit (min)</Label>
              <Input
                type="number"
                value={current.cooldownMinutesAfterExit ?? 15}
                onChange={(e) => updateField("cooldownMinutesAfterExit", Number(e.target.value))}
                data-testid="input-cooldown"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Per Symbol</Label>
              <Input
                type="number"
                value={current.maxPositionsPerSymbol ?? 1}
                onChange={(e) => updateField("maxPositionsPerSymbol", Number(e.target.value))}
                data-testid="input-max-per-symbol"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Symbol Allowlist</Label>
            <p className="text-xs text-muted-foreground">Comma-separated. Only these symbols will be traded (leave blank for all).</p>
            <Input
              type="text"
              placeholder="e.g. AAPL, TSLA, NVDA"
              value={allowlistText}
              onChange={(e) => {
                setAllowlistText(e.target.value);
                const arr = e.target.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
                updateField("symbolAllowlist", arr.length ? arr : null);
              }}
              data-testid="input-symbol-allowlist"
            />
          </div>

          <div className="space-y-1">
            <Label>Symbol Blocklist</Label>
            <p className="text-xs text-muted-foreground">Comma-separated. These symbols will never be traded.</p>
            <Input
              type="text"
              placeholder="e.g. GME, AMC"
              value={blocklistText}
              onChange={(e) => {
                setBlocklistText(e.target.value);
                const arr = e.target.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
                updateField("symbolBlocklist", arr.length ? arr : null);
              }}
              data-testid="input-symbol-blocklist"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Advanced (Accordion) */}
      <Card data-testid="card-advanced">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Advanced
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="options" className="border-none">
              <AccordionTrigger className="text-sm py-3" data-testid="accordion-options">Options Constraints</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Additional constraints when the agent trades options. Leave blank to use defaults.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Max Delta</Label>
                    <Input
                      type="number"
                      step="0.05"
                      placeholder="0.40"
                      value={(current.optionsConstraints as any)?.maxDelta ?? ""}
                      onChange={(e) => updateField("optionsConstraints", {
                        ...(current.optionsConstraints || {}),
                        maxDelta: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-options-max-delta"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Min DTE</Label>
                    <Input
                      type="number"
                      placeholder="7"
                      value={(current.optionsConstraints as any)?.minDte ?? ""}
                      onChange={(e) => updateField("optionsConstraints", {
                        ...(current.optionsConstraints || {}),
                        minDte: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-options-min-dte"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max Premium ($)</Label>
                    <Input
                      type="number"
                      placeholder="5.00"
                      value={(current.optionsConstraints as any)?.maxPremium ?? ""}
                      onChange={(e) => updateField("optionsConstraints", {
                        ...(current.optionsConstraints || {}),
                        maxPremium: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-options-max-premium"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Min Open Interest</Label>
                    <Input
                      type="number"
                      placeholder="100"
                      value={(current.optionsConstraints as any)?.minOi ?? ""}
                      onChange={(e) => updateField("optionsConstraints", {
                        ...(current.optionsConstraints || {}),
                        minOi: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-options-min-oi"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="futures" className="border-none">
              <AccordionTrigger className="text-sm py-3" data-testid="accordion-futures">Futures Constraints</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Additional constraints for futures trading. Leave blank to use defaults.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Max Contracts</Label>
                    <Input
                      type="number"
                      placeholder="2"
                      value={(current.futuresConstraints as any)?.maxContracts ?? ""}
                      onChange={(e) => updateField("futuresConstraints", {
                        ...(current.futuresConstraints || {}),
                        maxContracts: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-futures-max-contracts"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Allowed Products</Label>
                    <Input
                      type="text"
                      placeholder="ES, NQ, MES"
                      value={(current.futuresConstraints as any)?.allowedProducts ?? ""}
                      onChange={(e) => updateField("futuresConstraints", {
                        ...(current.futuresConstraints || {}),
                        allowedProducts: e.target.value,
                      })}
                      data-testid="input-futures-products"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="reliability" className="border-none">
              <AccordionTrigger className="text-sm py-3" data-testid="accordion-reliability">Reliability & Retries</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-xs text-muted-foreground">How the agent handles transient failures when placing orders.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Max Retries</Label>
                    <Input
                      type="number"
                      placeholder="2"
                      value={(current.reliability as any)?.maxRetries ?? ""}
                      onChange={(e) => updateField("reliability", {
                        ...(current.reliability || {}),
                        maxRetries: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-reliability-max-retries"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Retry Delay (ms)</Label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={(current.reliability as any)?.retryDelayMs ?? ""}
                      onChange={(e) => updateField("reliability", {
                        ...(current.reliability || {}),
                        retryDelayMs: e.target.value ? Number(e.target.value) : undefined,
                      })}
                      data-testid="input-reliability-retry-delay"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={!hasChanges || updateMutation.isPending}
        className="w-full"
        data-testid="button-save-agent"
      >
        {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Settings className="w-4 h-4 mr-1" />}
        Save Settings
      </Button>
    </div>
  );
}

function TradesTab() {
  const { data: trades = [], isLoading } = useQuery<TradeAlert[]>({
    queryKey: ["/api/partner/trades"],
    refetchInterval: 15000,
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (trades.length === 0) {
    return (
      <Card data-testid="card-trades-empty">
        <CardContent className="py-8 text-center">
          <History className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">No trade signals received yet</p>
          <p className="text-xs text-muted-foreground mt-1">Signals from your newsletter will appear here</p>
        </CardContent>
      </Card>
    );
  }

  const executedCount = trades.filter(t => t.status === "EXECUTED").length;
  const skippedCount = trades.filter(t => t.status === "SKIPPED").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-total-trades">{trades.length}</div>
            <div className="text-xs text-muted-foreground">Total Signals</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-500" data-testid="text-executed-trades">{executedCount}</div>
            <div className="text-xs text-muted-foreground">Executed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-muted-foreground" data-testid="text-skipped-trades">{skippedCount}</div>
            <div className="text-xs text-muted-foreground">Skipped</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        {trades.map((trade) => {
          const isExit = trade.alertType === "exit";
          const statusColor = trade.status === "EXECUTED" ? "text-green-500" : trade.status === "SKIPPED" ? "text-muted-foreground" : trade.status === "PENDING" ? "text-yellow-500" : "";

          return (
            <Card key={trade.id} className="overflow-visible" data-testid={`card-trade-${trade.id}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isExit ? (
                      <TrendingDown className="w-4 h-4 text-orange-500" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-green-500" />
                    )}
                    <span className="font-mono font-bold">{trade.symbol}</span>
                    <Badge variant={isExit ? "secondary" : "outline"} className={isExit ? "" : "border-green-500 text-green-600"}>
                      {isExit ? "EXIT" : trade.direction}
                    </Badge>
                  </div>
                  <Badge variant={trade.status === "EXECUTED" ? "default" : "outline"} className={trade.status === "EXECUTED" ? "bg-green-600 border-green-700" : ""}>
                    {trade.status}
                  </Badge>
                </div>

                <div className="text-xs text-muted-foreground mb-2">{trade.strategyName}</div>

                {!isExit && (
                  <div className="flex items-center gap-3 text-xs">
                    <span>Entry: {formatPrice(trade.entryPrice)}</span>
                    {trade.riskPrice != null && <span className="text-red-500">Risk: {formatPrice(trade.riskPrice)}</span>}
                    {trade.targetPrice != null && <span className="text-green-500">Target: {formatPrice(trade.targetPrice)}</span>}
                  </div>
                )}

                {trade.exitReason && (
                  <div className="text-xs text-orange-500 mt-1">{trade.exitReason}</div>
                )}

                {trade.executedPrice && (
                  <div className="text-xs text-green-500 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Filled at {formatPrice(trade.executedPrice)}
                  </div>
                )}

                {trade.skipReason && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {trade.skipReason}
                  </div>
                )}

                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(trade.alertTimestamp)}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SubscriptionPaywall({ profile, onLogout }: { profile: PartnerProfile; onLogout: () => void }) {
  const { toast } = useToast();

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/checkout");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Failed to start checkout", description: "Please try again or contact support.", variant: "destructive" });
    },
  });

  const features = [
    { icon: Zap, text: "Automated trade execution from signals" },
    { icon: Link2, text: "Direct brokerage connectivity" },
    { icon: Shield, text: "Configurable risk controls" },
    { icon: BarChart3, text: "Real-time trade history and tracking" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between gap-4 px-4 h-14 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm" data-testid="text-partner-branding">VCP Trader Autonomous Agent</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">| {profile.partnerName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-partner-email">{profile.email}</span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={onLogout} data-testid="button-partner-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 mt-8">
        <Card data-testid="card-subscription-paywall">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-xl">Activate Auto Trading</CardTitle>
            <CardDescription>
              Subscribe to start receiving and executing trade signals automatically from {profile.partnerName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold" data-testid="text-subscription-price">$39</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Cancel anytime</p>
            </div>

            <div className="space-y-3">
              {features.map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <feature.icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm">{feature.text}</span>
                </div>
              ))}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              data-testid="button-subscribe"
            >
              {checkoutMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              Subscribe Now
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Secure payment powered by Stripe. You can manage or cancel your subscription at any time.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function PartnerDashboard() {
  const { toast } = useToast();

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<PartnerProfile>({
    queryKey: ["/api/partner/me"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/partner/logout");
    },
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const billingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/billing-portal");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Failed to open billing portal", variant: "destructive" });
    },
  });

  const checkoutHandled = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutResult = params.get("checkout");
    if (checkoutResult === "success" && !checkoutHandled.current) {
      checkoutHandled.current = true;
      toast({ title: "Subscription activated!", description: "Welcome to Auto Trading." });
      window.history.replaceState({}, "", "/partner/dashboard");
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me"] });
    }
  }, [toast]);

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">Access Required</h2>
            <p className="text-sm text-muted-foreground mb-4">
              This dashboard requires a valid login link from your newsletter platform.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/"} data-testid="button-go-home">
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile.subscriptionActive) {
    return <SubscriptionPaywall profile={profile} onLogout={() => logoutMutation.mutate()} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between gap-4 px-4 h-14 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm" data-testid="text-partner-branding">VCP Trader Autonomous Agent</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">| {profile.partnerName}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-partner-email">{profile.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => billingMutation.mutate()}
              disabled={billingMutation.isPending}
              data-testid="button-manage-billing"
            >
              <CreditCard className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Billing</span>
            </Button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-partner-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <Tabs defaultValue="broker" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3" data-testid="tabs-partner-dashboard">
            <TabsTrigger value="broker" className="gap-1" data-testid="tab-broker">
              <Link2 className="w-4 h-4" />
              <span className="hidden sm:inline">Broker</span>
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1" data-testid="tab-agent">
              <Bot className="w-4 h-4" />
              <span className="hidden sm:inline">Agent</span>
            </TabsTrigger>
            <TabsTrigger value="trades" className="gap-1" data-testid="tab-trades">
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Trades</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="broker">
            <BrokerTab />
          </TabsContent>

          <TabsContent value="agent">
            <AgentTab />
          </TabsContent>

          <TabsContent value="trades">
            <TradesTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
