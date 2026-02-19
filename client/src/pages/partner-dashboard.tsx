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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Info,
  AlertTriangle,
  Scale,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

function FieldTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help inline-block ml-1 shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const AUTO_MODE_CONSENT_TEXT = "I understand that enabling Auto mode will allow the trading agent to automatically execute trades in my brokerage account without manual review. I accept full responsibility for all trades placed by the agent and acknowledge that automated trading involves significant risk, including the potential for substantial financial losses. I have reviewed and configured the risk limits, and I agree that VCP Trader and its partners are not liable for any trading losses incurred while Auto mode is active.";

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

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

function BrokerTab() {
  const { toast } = useToast();
  const { data: broker, isLoading } = useQuery<BrokerStatus>({
    queryKey: ["/api/partner/broker"],
  });

  const [connectingBroker, setConnectingBroker] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);
  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [tradeSymbol, setTradeSymbol] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const isConnected = broker?.isConnected || broker?.connected;

  const { data: brokerAccounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    enabled: isConnected === true,
  });

  useEffect(() => {
    if (brokerAccounts.length > 0 && !selectedAccount) {
      if (broker?.preferredAccountId) {
        const preferred = brokerAccounts.find(a => a.id === broker.preferredAccountId);
        if (preferred) { setSelectedAccount(preferred); return; }
      }
      setSelectedAccount(brokerAccounts[0]);
    }
  }, [brokerAccounts, broker?.preferredAccountId]);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/broker/test");
      return res.json();
    },
    onSuccess: (data: any) => {
      setTestResult(data);
      if (data.success) {
        toast({ title: "Connection test passed" });
      } else {
        toast({ title: data.message || "Connection test failed", variant: "destructive" });
      }
    },
    onError: (error: any) => {
      setTestResult({ success: false, message: error?.message || "Test failed" });
      toast({ title: "Connection test failed", variant: "destructive" });
    },
  });

  async function handleBrokerConnect(providerId: string) {
    try {
      setConnectingBroker(providerId);
      const res = await fetch(`/api/${providerId}/oauth`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start broker connection");
      }
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err: any) {
      toast({ title: err.message || "Failed to connect broker", variant: "destructive" });
      setConnectingBroker(null);
    }
  }

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      {isConnected && (
        <Card data-testid="card-broker-status">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2" data-testid="text-broker-status">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="font-medium">Connected</span>
                <Badge variant="outline">{broker?.provider}</Badge>
              </div>
              <Button
                variant="outline"
                onClick={() => { setTestResult(null); testMutation.mutate(); }}
                disabled={testMutation.isPending}
                data-testid="button-test-connection"
              >
                {testMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Zap className="w-4 h-4 mr-1" />
                )}
                Test Connection
              </Button>
            </div>
            {broker?.preferredAccountId && (
              <p className="text-sm text-muted-foreground mt-2" data-testid="text-broker-account">
                Account: {broker.preferredAccountId}
              </p>
            )}
            {testResult && (
              <div className={`mt-3 flex items-center gap-2 text-sm ${testResult.success ? "text-green-500" : "text-destructive"}`} data-testid="text-test-result">
                {testResult.success ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{testResult.message}</span>
                {testResult.data?.accounts != null && (
                  <span className="text-muted-foreground">({testResult.data.accounts} account{testResult.data.accounts !== 1 ? "s" : ""} found)</span>
                )}
              </div>
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
            const isConnecting = connectingBroker === bp.id;
            return (
              <Card
                key={bp.id}
                className={`cursor-pointer hover-elevate ${isBrokerConnected ? "border-primary" : ""}`}
                onClick={() => !isBrokerConnected && !isConnecting && bp.supportsOAuth && handleBrokerConnect(bp.id)}
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
                    {isConnecting && (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
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

      {isConnected && (
        <Card data-testid="card-instatrade">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Zap className="w-5 h-5 text-chart-2" />
              <h3 className="text-base font-medium">InstaTrade&trade;</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Send trades directly to your brokerage with one click. Enter a stock symbol and configure your order.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Input
                value={tradeSymbol}
                onChange={(e) => setTradeSymbol(e.target.value.toUpperCase())}
                placeholder="Enter symbol (e.g. AAPL)"
                className="max-w-[200px]"
                data-testid="input-trade-symbol"
              />
              <Button
                onClick={() => {
                  if (!tradeSymbol.trim()) {
                    toast({ title: "Enter a stock symbol", variant: "destructive" });
                    return;
                  }
                  setShowTradeTicket(true);
                }}
                disabled={!tradeSymbol.trim()}
                data-testid="button-instatrade"
              >
                <Zap className="w-4 h-4 mr-1" />
                InstaTrade&trade;
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <StockTradeTicket
        open={showTradeTicket}
        onOpenChange={(open) => {
          setShowTradeTicket(open);
          if (!open) setTradeSymbol("");
        }}
        scanResult={tradeSymbol.trim() ? {
          ticker: tradeSymbol.trim(),
          price: 0,
          resistance: null,
          stopLoss: null,
          stage: "MANUAL",
          patternScore: 0,
        } : null}
        brokerAccounts={brokerAccounts}
        selectedAccount={selectedAccount}
        onAccountChange={setSelectedAccount}
      />
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
  bracketStopMethod?: string;
  bracketStopValue?: number | null;
  bracketTargetMethod?: string;
  bracketTargetValue?: number | null;
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
      toast({ title: "Settings saved successfully" });
    },
    onError: (error: any) => {
      let msg = "Failed to save settings";
      try {
        const raw = error?.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          msg = parsed.error || msg;
        }
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const consentMutation = useMutation({
    mutationFn: async (consentText: string) => {
      const res = await apiRequest("POST", "/api/partner/auto-mode-consent", { consentText });
      return res.json();
    },
  });

  const [formData, setFormData] = useState<Partial<AgentSettingsData>>({});
  const [allowlistText, setAllowlistText] = useState("");
  const [blocklistText, setBlocklistText] = useState("");
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [autoConsentChecked, setAutoConsentChecked] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const handleModeChange = (val: string) => {
    if (val === "auto" && current.mode !== "auto") {
      setShowAutoConfirm(true);
      setAutoConsentChecked(false);
    } else {
      updateField("mode", val);
    }
  };

  const confirmAutoMode = async () => {
    try {
      await consentMutation.mutateAsync(AUTO_MODE_CONSENT_TEXT);
      const saveData = { ...formData, mode: "auto" };
      await updateMutation.mutateAsync(saveData);
      setFormData({});
      setShowAutoConfirm(false);
      setAutoConsentChecked(false);
    } catch {
      toast({ title: "Failed to enable auto mode", variant: "destructive" });
    }
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
      {showAutoConfirm && (
        <Card className="border-destructive" data-testid="card-auto-mode-confirm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Confirm Auto Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-destructive/10 p-3 text-sm" data-testid="text-auto-consent">
              {AUTO_MODE_CONSENT_TEXT}
            </div>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="consent-check"
                checked={autoConsentChecked}
                onChange={(e) => setAutoConsentChecked(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input"
                data-testid="checkbox-auto-consent"
              />
              <label htmlFor="consent-check" className="text-sm cursor-pointer">
                I have read and agree to the above terms
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={confirmAutoMode}
                disabled={!autoConsentChecked || consentMutation.isPending}
                data-testid="button-confirm-auto-mode"
              >
                {consentMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Enable Auto Mode
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowAutoConfirm(false); setAutoConsentChecked(false); }}
                data-testid="button-cancel-auto-mode"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── ESSENTIALS: Quick Setup ─── */}
      <Card data-testid="card-agent-essentials">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Quick Setup
          </CardTitle>
          <CardDescription>
            Just these few settings to get started. Everything else has sensible defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-md border p-4">
            <div>
              <Label className="font-medium text-base">Enable Agent</Label>
              <p className="text-sm text-muted-foreground mt-0.5">Start receiving and processing trade signals</p>
            </div>
            <Switch
              checked={current.enabled ?? false}
              onCheckedChange={(val) => updateField("enabled", val)}
              data-testid="switch-agent-enabled"
            />
          </div>

          <div className="space-y-2">
            <Label className="inline-flex items-center">Agent Mode <FieldTip text="Suggest mode queues signals for your review. Auto mode executes trades immediately without confirmation." /></Label>
            <Select
              value={current.mode || "suggest"}
              onValueChange={handleModeChange}
            >
              <SelectTrigger data-testid="select-agent-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suggest">Suggest (Review before executing)</SelectItem>
                <SelectItem value="auto">Auto (Execute automatically)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {current.mode === "auto"
                ? "Trades will be placed automatically when signals arrive."
                : "Signals will appear in your Trades tab for you to review first."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="inline-flex items-center">Risk Per Trade ($) <FieldTip text="Maximum dollar amount at risk on any single trade. Used for position sizing." /></Label>
              <Input
                type="number"
                value={current.riskPerTradeUsd ?? 100}
                onChange={(e) => updateField("riskPerTradeUsd", Number(e.target.value))}
                data-testid="input-risk-per-trade"
              />
              <p className="text-xs text-muted-foreground">Most you can lose on a single trade</p>
            </div>
            <div className="space-y-1">
              <Label className="inline-flex items-center">Max Daily Loss ($) <FieldTip text="When total losses exceed this amount, the agent stops trading for the day." /></Label>
              <Input
                type="number"
                value={current.maxDailyLossUsd ?? 200}
                onChange={(e) => updateField("maxDailyLossUsd", Number(e.target.value))}
                data-testid="input-max-daily-loss"
              />
              <p className="text-xs text-muted-foreground">Agent pauses if daily losses hit this limit</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="inline-flex items-center">Max Open Positions <FieldTip text="Maximum number of open positions allowed at the same time." /></Label>
              <Input
                type="number"
                value={current.maxConcurrentPositions ?? 2}
                onChange={(e) => updateField("maxConcurrentPositions", Number(e.target.value))}
                data-testid="input-max-positions"
              />
            </div>
            <div className="space-y-1">
              <Label className="inline-flex items-center">Max Trades Per Day <FieldTip text="Maximum total number of new entries per day." /></Label>
              <Input
                type="number"
                value={current.maxTradesPerDay ?? 2}
                onChange={(e) => updateField("maxTradesPerDay", Number(e.target.value))}
                data-testid="input-max-trades-day"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button - always visible */}
      <Button
        onClick={handleSave}
        disabled={!hasChanges || updateMutation.isPending}
        className="w-full"
        data-testid="button-save-agent"
      >
        {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
        Save Settings
      </Button>

      {/* ─── ADVANCED: Collapsible ─── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-muted-foreground shrink-0"
          data-testid="button-toggle-advanced"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
          {showAdvanced ? "Hide" : "Show"} Advanced Settings
          <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
        </Button>
        <div className="h-px flex-1 bg-border" />
      </div>

      {showAdvanced && (
        <>
          {/* Trading Window */}
          <Card data-testid="card-trading-window">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Trading Window
              </CardTitle>
              <CardDescription className="text-xs">When the agent is allowed to place orders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="inline-flex items-center text-xs">Start Time <FieldTip text="The earliest time the agent will place orders (24-hour format)." /></Label>
                  <Input
                    type="text"
                    placeholder="09:35"
                    value={current.tradingWindowStart || "09:35:00"}
                    onChange={(e) => updateField("tradingWindowStart", e.target.value)}
                    data-testid="input-window-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="inline-flex items-center text-xs">End Time <FieldTip text="The latest time the agent will place new orders." /></Label>
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
                <Label className="inline-flex items-center text-xs">Timezone <FieldTip text="The timezone used for interpreting trading window times." /></Label>
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

          {/* Price Filters */}
          <Card data-testid="card-price-filters">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Price & Quality Filters
              </CardTitle>
              <CardDescription className="text-xs">Reject signals that don't meet these criteria</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="inline-flex items-center text-xs">Min Price ($) <FieldTip text="Skip stocks priced below this. Avoids penny stocks." /></Label>
                  <Input
                    type="number"
                    value={current.minPrice ?? 5}
                    onChange={(e) => updateField("minPrice", Number(e.target.value))}
                    data-testid="input-min-price"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="inline-flex items-center text-xs">Max Price ($) <FieldTip text="Skip stocks priced above this. Keeps positions manageable." /></Label>
                  <Input
                    type="number"
                    value={current.maxPrice ?? 500}
                    onChange={(e) => updateField("maxPrice", Number(e.target.value))}
                    data-testid="input-max-price"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="inline-flex items-center text-xs">Min R:R <FieldTip text="Minimum reward-to-risk ratio. 2.0 means potential gain must be 2x the risk." /></Label>
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

          {/* Execution Settings */}
          <Card data-testid="card-execution">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Crosshair className="w-4 h-4" />
                Order Execution
              </CardTitle>
              <CardDescription className="text-xs">How orders are placed when signals arrive</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="inline-flex items-center text-xs">Entry Order Type <FieldTip text="Market fills immediately. Limit fills at your price or better." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Time in Force <FieldTip text="Day orders cancel at close. GTC stays until filled." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Limit Offset (%) <FieldTip text="How far from signal price to set the limit. E.g., 0.05 means 0.05%." /></Label>
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
                <Label className="inline-flex items-center text-xs">Missing Stops Policy <FieldTip text="What happens when a signal arrives without a stop-loss price." /></Label>
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
                  <Label className="font-medium inline-flex items-center text-xs">Bracket Orders <FieldTip text="Automatically attach a stop-loss and profit-target to every entry." /></Label>
                  <p className="text-xs text-muted-foreground">Auto-attach stop + target to entries</p>
                </div>
                <Switch
                  checked={current.bracketEnabled ?? true}
                  onCheckedChange={(val) => updateField("bracketEnabled", val)}
                  data-testid="switch-bracket-enabled"
                />
              </div>

              {(current.bracketEnabled ?? true) && (
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Bracket Order Pricing</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs inline-flex items-center">Stop Method <FieldTip text="How to set the stop-loss price. 'From Signal' uses the stop provided by the alert." /></Label>
                      <Select
                        value={current.bracketStopMethod || "signal"}
                        onValueChange={(val) => {
                          updateField("bracketStopMethod", val);
                          if (val === "signal") updateField("bracketStopValue", null);
                        }}
                      >
                        <SelectTrigger data-testid="select-bracket-stop-method">
                          <SelectValue placeholder="From Signal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="signal">From Signal</SelectItem>
                          <SelectItem value="percent">% from Entry</SelectItem>
                          <SelectItem value="dollar">$ from Entry</SelectItem>
                        </SelectContent>
                      </Select>
                      {current.bracketStopMethod && current.bracketStopMethod !== "signal" && (
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={current.bracketStopMethod === "percent" ? "e.g. 2.0" : "e.g. 1.50"}
                          value={current.bracketStopValue ?? ""}
                          onChange={(e) => updateField("bracketStopValue", e.target.value ? Number(e.target.value) : null)}
                          data-testid="input-bracket-stop-value"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs inline-flex items-center">Target Method <FieldTip text="How to set the profit target. 'R:R Ratio' sets target as a multiple of the stop distance." /></Label>
                      <Select
                        value={current.bracketTargetMethod || "signal"}
                        onValueChange={(val) => {
                          updateField("bracketTargetMethod", val);
                          if (val === "signal") updateField("bracketTargetValue", null);
                        }}
                      >
                        <SelectTrigger data-testid="select-bracket-target-method">
                          <SelectValue placeholder="From Signal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="signal">From Signal</SelectItem>
                          <SelectItem value="percent">% from Entry</SelectItem>
                          <SelectItem value="dollar">$ from Entry</SelectItem>
                          <SelectItem value="rr">Risk:Reward Ratio</SelectItem>
                        </SelectContent>
                      </Select>
                      {current.bracketTargetMethod && current.bracketTargetMethod !== "signal" && (
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={current.bracketTargetMethod === "rr" ? "e.g. 2.0" : current.bracketTargetMethod === "percent" ? "e.g. 4.0" : "e.g. 3.00"}
                          value={current.bracketTargetValue ?? ""}
                          onChange={(e) => updateField("bracketTargetValue", e.target.value ? Number(e.target.value) : null)}
                          data-testid="input-bracket-target-value"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label className="font-medium inline-flex items-center text-xs">Require Stops <FieldTip text="Only execute trades that have a defined stop-loss price." /></Label>
                  <p className="text-xs text-muted-foreground">Extra safety: skip trades without a stop loss</p>
                </div>
                <Switch
                  checked={current.requireStops ?? true}
                  onCheckedChange={(val) => updateField("requireStops", val)}
                  data-testid="switch-require-stops"
                />
              </div>
            </CardContent>
          </Card>

          {/* Sizing & Filters */}
          <Card data-testid="card-filters-sizing">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="w-4 h-4" />
                Position Sizing & Filters
              </CardTitle>
              <CardDescription className="text-xs">Control how positions are sized and which symbols to trade</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="inline-flex items-center text-xs">Direction <FieldTip text="Restrict to long trades, short trades, or both." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Sizing Method <FieldTip text="Risk-Based sizes from your risk-per-trade. Fixed uses a set share count or dollar amount." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Shares Per Trade <FieldTip text="Exact number of shares for every signal." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Dollar Amount Per Trade <FieldTip text="Total dollar amount per trade. Shares calculated from entry price." /></Label>
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
                  <Label className="inline-flex items-center text-xs">Dup Window (min) <FieldTip text="Ignore duplicate signals for the same symbol within this time." /></Label>
                  <Input
                    type="number"
                    value={current.duplicateSignalWindowMinutes ?? 10}
                    onChange={(e) => updateField("duplicateSignalWindowMinutes", Number(e.target.value))}
                    data-testid="input-dup-window"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="inline-flex items-center text-xs">Cooldown (min) <FieldTip text="Wait time before re-entering the same symbol after exit." /></Label>
                  <Input
                    type="number"
                    value={current.cooldownMinutesAfterExit ?? 15}
                    onChange={(e) => updateField("cooldownMinutesAfterExit", Number(e.target.value))}
                    data-testid="input-cooldown"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="inline-flex items-center text-xs">Max Per Symbol <FieldTip text="Max open positions in a single symbol." /></Label>
                  <Input
                    type="number"
                    value={current.maxPositionsPerSymbol ?? 1}
                    onChange={(e) => updateField("maxPositionsPerSymbol", Number(e.target.value))}
                    data-testid="input-max-per-symbol"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="inline-flex items-center text-xs">Symbol Allowlist <FieldTip text="Only trade these symbols. Leave blank for all." /></Label>
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
                <Label className="inline-flex items-center text-xs">Symbol Blocklist <FieldTip text="Never trade these symbols." /></Label>
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

          {/* Expert Settings */}
          <Card data-testid="card-advanced">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                Expert Settings
              </CardTitle>
              <CardDescription className="text-xs">Options, futures, and retry configuration</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="options" className="border-none">
                  <AccordionTrigger className="text-sm py-3" data-testid="accordion-options">Options Constraints</AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">Leave blank to use defaults.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center">Max Delta <FieldTip text="Maximum option delta allowed." /></Label>
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
                        <Label className="text-xs inline-flex items-center">Min DTE <FieldTip text="Minimum days to expiration." /></Label>
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
                        <Label className="text-xs inline-flex items-center">Max Premium ($) <FieldTip text="Max price per contract." /></Label>
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
                        <Label className="text-xs inline-flex items-center">Min Open Interest <FieldTip text="Minimum open interest for liquidity." /></Label>
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
                    <p className="text-xs text-muted-foreground">Leave blank to use defaults.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center">Max Contracts <FieldTip text="Max futures contracts per trade." /></Label>
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
                        <Label className="text-xs inline-flex items-center">Allowed Products <FieldTip text="Comma-separated futures products (e.g., ES, NQ)." /></Label>
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
                    <p className="text-xs text-muted-foreground">How the agent handles failed order submissions.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center">Max Retries <FieldTip text="Retry attempts for failed orders." /></Label>
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
                        <Label className="text-xs inline-flex items-center">Retry Delay (ms) <FieldTip text="Wait time between retries." /></Label>
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

          {/* Second Save Button at bottom of advanced */}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="w-full"
            data-testid="button-save-agent-bottom"
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
            Save Settings
          </Button>
        </>
      )}
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
              <p className="text-sm font-medium text-primary mt-1" data-testid="text-trial-badge">14-day free trial</p>
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
              Start Free Trial
            </Button>

            <p className="text-xs text-center text-muted-foreground" data-testid="text-trial-disclaimer">
              Your 14-day free trial begins at signup. After the trial ends, you will be automatically charged at the standard monthly rate unless you cancel before the trial period ends. This is a recurring monthly subscription. You can cancel anytime from your account settings or Stripe billing portal.
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

        <div className="mt-8 border-t pt-6 pb-8" data-testid="section-legal-disclaimer">
          <div className="flex items-start gap-3">
            <Scale className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-sm">Important Disclosures & Legal Disclaimer</p>
              <p>
                VCP Trader provides automated trade execution software as a technology service only.
                VCP Trader is not a registered broker-dealer, investment adviser, or financial planner.
                Nothing on this platform constitutes investment advice, a recommendation, or a solicitation
                to buy or sell any security.
              </p>
              <p>
                <span className="font-medium">Risk Warning:</span> Trading stocks, options, and futures
                involves substantial risk of loss and is not suitable for every investor. You could lose
                more than your initial investment. Past performance of any trading strategy or signal
                provider does not guarantee future results. Automated trading systems carry additional
                risks, including but not limited to software errors, connectivity failures, and execution
                delays.
              </p>
              <p>
                <span className="font-medium">No Guarantee of Profits:</span> There is no guarantee
                that the use of this platform or any signal provider will result in profits. All trading
                decisions executed by the Auto Agent are based on configurations set by you. You are
                solely responsible for reviewing and adjusting your risk parameters.
              </p>
              <p>
                <span className="font-medium">Your Responsibility:</span> By using this platform, you
                acknowledge that you understand the risks of automated trading and accept full
                responsibility for all trades placed through your connected brokerage account. VCP Trader,
                its affiliates, and partner signal providers shall not be held liable for any trading
                losses, damages, or other costs resulting from the use of this service.
              </p>
              <p>
                <span className="font-medium">Regulatory Notice:</span> This platform does not provide
                tax, legal, or accounting advice. Consult a qualified professional regarding your
                individual financial situation before making trading decisions.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
