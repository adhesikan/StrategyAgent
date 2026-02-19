import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Copy,
  Key,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Webhook,
  Send,
  ArrowUpRight,
  ShieldAlert,
  Radio,
} from "lucide-react";
import type { ExternalAlert, ExternalAlertApiKey } from "@shared/schema";

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return <Badge variant="outline" data-testid={`badge-status-${status}`}><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "EVALUATING":
      return <Badge variant="secondary" data-testid={`badge-status-${status}`}><Loader2 className="w-3 h-3 mr-1 animate-spin" />Evaluating</Badge>;
    case "EXECUTED":
      return <Badge variant="default" className="bg-green-600 border-green-700" data-testid={`badge-status-${status}`}><CheckCircle className="w-3 h-3 mr-1" />Executed</Badge>;
    case "SKIPPED":
      return <Badge variant="destructive" data-testid={`badge-status-${status}`}><AlertCircle className="w-3 h-3 mr-1" />Skipped</Badge>;
    case "EXPIRED":
      return <Badge variant="secondary" data-testid={`badge-status-${status}`}><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
    case "ERROR":
      return <Badge variant="destructive" data-testid={`badge-status-${status}`}><ShieldAlert className="w-3 h-3 mr-1" />Error</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-status-${status}`}>{status}</Badge>;
  }
}

function AlertCard({ alert }: { alert: ExternalAlert }) {
  const isLong = alert.direction === "Long";
  const isExit = alert.alertType === "exit";
  const riskReward = alert.targetPrice && alert.riskPrice && alert.entryPrice
    ? ((alert.targetPrice - alert.entryPrice) / (alert.entryPrice - alert.riskPrice)).toFixed(1)
    : null;

  return (
    <Card className="overflow-visible" data-testid={`card-alert-${alert.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            {isExit ? (
              <TrendingDown className="w-5 h-5 text-orange-500" />
            ) : (
              <ArrowUpRight className={cn("w-5 h-5", isLong ? "text-green-500" : "text-red-500")} />
            )}
            <span className="font-bold text-lg" data-testid={`text-symbol-${alert.id}`}>{alert.symbol}</span>
            <Badge
              variant={isExit ? "secondary" : "outline"}
              className={isExit ? "" : isLong ? "border-green-500 text-green-600" : "border-red-500 text-red-600"}
              data-testid={`badge-direction-${alert.id}`}
            >
              {isExit ? "EXIT" : alert.direction}
            </Badge>
          </div>
          {getStatusBadge(alert.status)}
        </div>

        <div className="text-sm text-muted-foreground mb-1" data-testid={`text-strategy-${alert.id}`}>
          {alert.strategyName}
          {alert.strategyGroup && <span> - {alert.strategyGroup}</span>}
        </div>

        {alert.exitReason && (
          <div className="text-sm font-medium text-orange-500 mb-1" data-testid={`text-exit-reason-${alert.id}`}>
            {alert.exitReason}
          </div>
        )}

        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
          <Clock className="w-3 h-3" />
          <span data-testid={`text-timestamp-${alert.id}`}>{formatDate(alert.alertTimestamp)}</span>
        </div>

        {isExit ? (
          <div className="grid grid-cols-2 gap-2">
            {alert.targetPrice != null && (
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs text-muted-foreground mb-1">Target Price</div>
                <div className="font-semibold text-sm text-green-500" data-testid={`text-target-${alert.id}`}>
                  {formatPrice(alert.targetPrice)}
                </div>
              </div>
            )}
            {alert.riskPrice != null && (
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs text-muted-foreground mb-1">Stop Level</div>
                <div className="font-semibold text-sm text-red-500" data-testid={`text-risk-${alert.id}`}>
                  {formatPrice(alert.riskPrice)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={cn("grid gap-2", alert.riskPrice != null && alert.targetPrice != null ? "grid-cols-3" : "grid-cols-1")}>
            <div className="rounded-md border p-2 text-center">
              <div className="text-xs text-muted-foreground mb-1">Entry Level</div>
              <div className="font-semibold text-sm" data-testid={`text-entry-${alert.id}`}>
                {formatPrice(alert.entryPrice)}
              </div>
            </div>
            {alert.riskPrice != null && (
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs text-muted-foreground mb-1">Risk Level</div>
                <div className="font-semibold text-sm text-red-500" data-testid={`text-risk-${alert.id}`}>
                  {formatPrice(alert.riskPrice)}
                </div>
              </div>
            )}
            {alert.targetPrice != null && (
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs text-muted-foreground mb-1">Target Level</div>
                <div className="font-semibold text-sm text-green-500" data-testid={`text-target-${alert.id}`}>
                  {formatPrice(alert.targetPrice)}
                </div>
              </div>
            )}
          </div>
        )}

        {riskReward && (
          <div className="mt-2 text-xs text-muted-foreground text-right">
            R:R {riskReward}:1
          </div>
        )}

        {alert.skipReason && (
          <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {alert.skipReason}
          </div>
        )}

        {alert.executedPrice && (
          <div className="mt-2 text-xs text-green-500 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Filled at {formatPrice(alert.executedPrice)}
            {alert.executedAt && ` on ${formatDate(alert.executedAt)}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

interface ApiKeyDisplay {
  id: string;
  prefix: string;
  label: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function ApiKeysSection() {
  const { toast } = useToast();
  const [newKeyLabel, setNewKeyLabel] = useState("Default");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const { data: keys = [], isLoading } = useQuery<ApiKeyDisplay[]>({
    queryKey: ["/api/external-alerts/api-keys/list"],
  });

  const createKeyMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await apiRequest("POST", "/api/external-alerts/api-keys", { label });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedKey(data.key);
      queryClient.invalidateQueries({ queryKey: ["/api/external-alerts/api-keys/list"] });
    },
    onError: () => {
      toast({ title: "Failed to create API key", variant: "destructive" });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/external-alerts/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-alerts/api-keys/list"] });
      toast({ title: "API key deleted" });
    },
  });

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            Webhook API Keys
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Generate API keys to authenticate incoming webhook alerts to your account
          </p>
        </div>
        <Dialog open={showDialog} onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) {
            setGeneratedKey(null);
            setNewKeyLabel("Default");
          }
        }}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-api-key">
              <Plus className="w-4 h-4 mr-1" />
              New Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                This key authenticates incoming webhook requests from external alert sources.
              </DialogDescription>
            </DialogHeader>
            {generatedKey ? (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted p-3">
                  <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs break-all flex-1" data-testid="text-webhook-full-url">https://www.vcptrader.com/api/external-alerts/webhook</code>
                    <Button size="icon" variant="ghost" onClick={() => copyKey("https://www.vcptrader.com/api/external-alerts/webhook")} data-testid="button-copy-url">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-md border bg-muted p-3">
                  <Label className="text-xs text-muted-foreground">API Key (X-API-Key header)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs break-all flex-1" data-testid="text-generated-key">{generatedKey}</code>
                    <Button size="icon" variant="ghost" onClick={() => copyKey(generatedKey)} data-testid="button-copy-key">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Save both values now. The API key will not be shown again.
                </p>
                <Button onClick={() => { setShowDialog(false); setGeneratedKey(null); }} className="w-full" data-testid="button-done-key">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="key-label">Label</Label>
                  <Input
                    id="key-label"
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                    placeholder="e.g. TradingView Alerts"
                    data-testid="input-key-label"
                  />
                </div>
                <Button
                  onClick={() => createKeyMutation.mutate(newKeyLabel)}
                  disabled={createKeyMutation.isPending}
                  className="w-full"
                  data-testid="button-generate-key"
                >
                  {createKeyMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Key className="w-4 h-4 mr-1" />}
                  Generate Key
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No API keys yet. Create one to start receiving alerts.
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-2 rounded-md border p-3" data-testid={`row-api-key-${key.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm">{key.prefix}</span>
                    <Badge variant="outline">{key.label}</Badge>
                  </div>
                  {key.lastUsedAt && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Last used: {formatDate(key.lastUsedAt)}
                    </div>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteKeyMutation.mutate(key.id)}
                  disabled={deleteKeyMutation.isPending}
                  data-testid={`button-delete-key-${key.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-md border bg-muted/50 p-3">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
            <Webhook className="w-4 h-4" />
            Webhook Integration
          </h4>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium">Endpoint:</span>
              <code className="ml-1 bg-muted px-1 py-0.5 rounded" data-testid="text-webhook-url">
                POST https://www.vcptrader.com/api/external-alerts/webhook
              </code>
            </div>
            <div>
              <span className="font-medium">Headers:</span>
              <code className="ml-1 bg-muted px-1 py-0.5 rounded">X-API-Key: your_api_key</code>
            </div>
            <div>
              <span className="font-medium">Entry Signal (JSON body):</span>
              <pre className="mt-1 bg-muted p-2 rounded text-xs overflow-x-auto">{JSON.stringify({
                rawText: 'enter sym=AAPL lp=195.50 tp=210.00 sl=188.00',
              }, null, 2)}</pre>
            </div>
            <div className="pt-1">
              <span className="font-medium">Exit Signal (JSON body):</span>
              <pre className="mt-1 bg-muted p-2 rounded text-xs overflow-x-auto">{JSON.stringify({
                rawText: 'exit sym=AAPL reason="Profit Target" tp=210.00',
              }, null, 2)}</pre>
            </div>
            <div className="pt-1 text-muted-foreground/80">
              Send your TradingView alerts or any external signal source via this webhook to execute trades automatically through the Auto Agent with your connected brokerage.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TradeAlertsPage() {
  const { toast } = useToast();

  const { data: alerts = [], isLoading } = useQuery<ExternalAlert[]>({
    queryKey: ["/api/external-alerts"],
    refetchInterval: 10000,
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/external-alerts/test");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-alerts"] });
      toast({ title: "Test alert created" });
    },
    onError: () => {
      toast({ title: "Failed to create test alert", variant: "destructive" });
    },
  });

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Radio className="w-5 h-5" />
            Trade Alerts
          </h1>
          <p className="text-sm text-muted-foreground">
            Incoming webhook signals for autonomous trade execution via Auto Agent
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
          data-testid="button-test-alert"
        >
          <Send className="w-4 h-4 mr-1" />
          Send Test Alert
        </Button>
      </div>

      <ApiKeysSection />

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-alerts-heading">Recent Alerts</h2>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : alerts.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Radio className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No alerts received yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Set up your API key above and configure your alert source (e.g. TradingView) to send webhooks here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
