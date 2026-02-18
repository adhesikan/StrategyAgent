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

interface AgentPolicy {
  id?: string;
  exists?: boolean;
  mode?: string;
  enabled?: boolean;
  riskPerTradeUsd?: number;
  maxDailyLossUsd?: number;
  maxConcurrentPositions?: number;
  maxTradesPerDay?: number;
  priceMin?: number;
  priceMax?: number;
  minRewardRisk?: number;
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
      <Card data-testid="card-broker-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Brokerage Connection
          </CardTitle>
          <CardDescription>Connect your brokerage account to enable automated trading</CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="font-medium">Connected</span>
                <Badge variant="outline">{broker?.provider}</Badge>
              </div>
              {broker?.preferredAccountId && (
                <p className="text-sm text-muted-foreground">
                  Account: {broker.preferredAccountId}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="w-5 h-5" />
                <span>No brokerage connected</span>
              </div>
              <div className="grid gap-2">
                <Button
                  onClick={() => window.location.href = "/api/broker/connect/tradier"}
                  variant="outline"
                  className="justify-start gap-2"
                  data-testid="button-connect-tradier"
                >
                  <Link2 className="w-4 h-4" />
                  Connect Tradier
                </Button>
                <Button
                  onClick={() => window.location.href = "/api/broker/connect/tradestation"}
                  variant="outline"
                  className="justify-start gap-2"
                  data-testid="button-connect-tradestation"
                >
                  <Link2 className="w-4 h-4" />
                  Connect TradeStation
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                You will be redirected to your broker to authorize the connection.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentTab() {
  const { toast } = useToast();
  const { data: policy, isLoading } = useQuery<AgentPolicy>({
    queryKey: ["/api/partner/agent-policy"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<AgentPolicy>) => {
      const res = await apiRequest("PUT", "/api/partner/agent-policy", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/agent-policy"] });
      toast({ title: "Agent settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const [formData, setFormData] = useState<Partial<AgentPolicy>>({});

  const currentPolicy = { ...policy, ...formData };
  const hasChanges = Object.keys(formData).length > 0;

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card data-testid="card-agent-config">
        <CardHeader>
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
              checked={currentPolicy.enabled ?? true}
              onCheckedChange={(val) => setFormData(prev => ({ ...prev, enabled: val }))}
              data-testid="switch-agent-enabled"
            />
          </div>

          <div className="space-y-2">
            <Label>Agent Mode</Label>
            <Select
              value={currentPolicy.mode || "SUGGEST"}
              onValueChange={(val) => setFormData(prev => ({ ...prev, mode: val }))}
            >
              <SelectTrigger data-testid="select-agent-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUGGEST">Suggest (Review before executing)</SelectItem>
                <SelectItem value="AUTO">Auto (Execute automatically)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-risk-limits">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Risk Limits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Risk Per Trade ($)</Label>
              <Input
                type="number"
                value={currentPolicy.riskPerTradeUsd || 500}
                onChange={(e) => setFormData(prev => ({ ...prev, riskPerTradeUsd: Number(e.target.value) }))}
                data-testid="input-risk-per-trade"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Daily Loss ($)</Label>
              <Input
                type="number"
                value={currentPolicy.maxDailyLossUsd || 1000}
                onChange={(e) => setFormData(prev => ({ ...prev, maxDailyLossUsd: Number(e.target.value) }))}
                data-testid="input-max-daily-loss"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Concurrent Positions</Label>
              <Input
                type="number"
                value={currentPolicy.maxConcurrentPositions || 3}
                onChange={(e) => setFormData(prev => ({ ...prev, maxConcurrentPositions: Number(e.target.value) }))}
                data-testid="input-max-positions"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Trades Per Day</Label>
              <Input
                type="number"
                value={currentPolicy.maxTradesPerDay || 2}
                onChange={(e) => setFormData(prev => ({ ...prev, maxTradesPerDay: Number(e.target.value) }))}
                data-testid="input-max-trades-day"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Min Price ($)</Label>
              <Input
                type="number"
                value={currentPolicy.priceMin || 5}
                onChange={(e) => setFormData(prev => ({ ...prev, priceMin: Number(e.target.value) }))}
                data-testid="input-price-min"
              />
            </div>
            <div className="space-y-1">
              <Label>Max Price ($)</Label>
              <Input
                type="number"
                value={currentPolicy.priceMax || 500}
                onChange={(e) => setFormData(prev => ({ ...prev, priceMax: Number(e.target.value) }))}
                data-testid="input-price-max"
              />
            </div>
            <div className="space-y-1">
              <Label>Min R:R</Label>
              <Input
                type="number"
                step="0.1"
                value={currentPolicy.minRewardRisk || 2}
                onChange={(e) => setFormData(prev => ({ ...prev, minRewardRisk: Number(e.target.value) }))}
                data-testid="input-min-rr"
              />
            </div>
          </div>

          <Button
            onClick={() => {
              updateMutation.mutate(formData);
              setFormData({});
            }}
            disabled={!hasChanges || updateMutation.isPending}
            className="w-full"
            data-testid="button-save-agent"
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Settings className="w-4 h-4 mr-1" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>
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
            <DollarSign className="w-5 h-5 text-green-500" />
            <span className="font-semibold text-sm">{profile.partnerName}</span>
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
            <DollarSign className="w-5 h-5 text-green-500" />
            <span className="font-semibold text-sm">{profile.partnerName}</span>
            <Badge variant="secondary">Auto Trading</Badge>
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
