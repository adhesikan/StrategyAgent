/**
 * Portfolio Broker Connection Center — Sprint 2.4.2
 *
 * /portfolio/connect
 *
 * Shows Tradier and TradeStation broker cards.
 * Each card displays: status, last sync, holdings imported, connect/disconnect,
 * and a "Refresh Portfolio" button.
 *
 * No API credentials, tokens, or account numbers are displayed.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Link2, Link2Off, ChevronRight, CheckCircle2,
  AlertTriangle, XCircle, Clock, Shield, Info, Activity,
  ChevronLeft, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrokerConnectionInfo {
  connected:   boolean;
  provider?:   string;
  accountId?:  string | null;
  connectedAt?: string | null;
}

interface PortfolioSyncState {
  portfolioId:    string;
  provider:       string | null;
  status:         "idle" | "running" | "completed" | "failed" | "needs_reauth";
  startedAt:      string | null;
  completedAt:    string | null;
  durationMs:     number | null;
  importedCount:  number;
  updatedCount:   number;
  deletedCount:   number;
  lastError:      string | null;
  nextScheduledAt: string | null;
}

interface BrokerPortfolio {
  id:        string;
  name:      string;
  provider:  string | null;
  updatedAt: string;
  syncState: PortfolioSyncState;
}

interface ConnectionsResponse {
  connections: {
    tradier:     BrokerConnectionInfo;
    tradestation: BrokerConnectionInfo;
  };
  portfolios: BrokerPortfolio[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(status: PortfolioSyncState["status"]) {
  const config = {
    idle:         { label: "Idle",              variant: "outline" as const,      className: "" },
    running:      { label: "Synchronizing…",    variant: "default" as const,      className: "bg-blue-500" },
    completed:    { label: "Synced",            variant: "default" as const,      className: "bg-green-500" },
    failed:       { label: "Failed",            variant: "destructive" as const,  className: "" },
    needs_reauth: { label: "Needs Reconnection",variant: "outline" as const,      className: "border-amber-500 text-amber-600" },
  }[status];
  return (
    <Badge variant={config.variant} className={`text-xs ${config.className}`}>
      {config.label}
    </Badge>
  );
}

function connectionStatusIcon(connected: boolean) {
  return connected
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : <XCircle className="h-4 w-4 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Broker definition
// ---------------------------------------------------------------------------

const BROKER_DEFS = [
  {
    provider:     "tradier" as const,
    label:        "Tradier",
    description:  "Connect your Tradier brokerage account to import holdings.",
    oauthPath:    "/api/tradier/oauth",
    settingsPath: "/settings?tab=broker",
    accentColor:  "text-green-600 dark:text-green-400",
  },
  {
    provider:     "tradestation" as const,
    label:        "TradeStation",
    description:  "Connect your TradeStation account to import holdings.",
    oauthPath:    "/api/tradestation/oauth",
    settingsPath: "/settings?tab=broker",
    accentColor:  "text-blue-600 dark:text-blue-400",
  },
];

// ---------------------------------------------------------------------------
// Broker Card
// ---------------------------------------------------------------------------

function BrokerCard({
  def,
  connectionInfo,
  portfolio,
  onConnect,
  onDisconnect,
  onSync,
  syncingId,
}: {
  def:            (typeof BROKER_DEFS)[number];
  connectionInfo: BrokerConnectionInfo;
  portfolio:      BrokerPortfolio | undefined;
  onConnect:      (provider: string) => void;
  onDisconnect:   (portfolioId: string) => void;
  onSync:         (portfolioId: string) => void;
  syncingId:      string | null;
}) {
  const { label, description, settingsPath, accentColor } = def;
  const isOAuthConnected = connectionInfo.connected;
  const linkedPortfolio  = portfolio;
  const syncState        = linkedPortfolio?.syncState;
  const isSyncing        = syncingId === linkedPortfolio?.id || syncState?.status === "running";

  return (
    <Card className="overflow-hidden" data-testid={`broker-card-${def.provider}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {connectionStatusIcon(isOAuthConnected)}
            <div>
              <CardTitle className={`text-base ${accentColor}`}>{label}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
            </div>
          </div>
          <Badge
            variant={isOAuthConnected ? "default" : "outline"}
            className={isOAuthConnected ? "bg-green-500 shrink-0" : "shrink-0"}
          >
            {isOAuthConnected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isOAuthConnected && (
          <div
            className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2"
            role="note"
          >
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              You must connect your {label} account via OAuth before importing holdings.{" "}
              <a href={settingsPath} className="text-primary hover:underline">
                Go to Broker Settings
              </a>
            </span>
          </div>
        )}

        {isOAuthConnected && !linkedPortfolio && (
          <div
            className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2"
            role="note"
          >
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>No portfolio linked yet. Click <strong>Import Holdings</strong> to create one.</span>
          </div>
        )}

        {linkedPortfolio && syncState && (
          <div className="space-y-3">
            {/* Sync status */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Sync Status</span>
              {statusBadge(syncState.status)}
            </div>

            {/* Sync metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Last Sync</p>
                <p className="font-medium mt-0.5">{formatRelativeTime(syncState.completedAt)}</p>
              </div>
              <div className="rounded-md bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Duration</p>
                <p className="font-medium mt-0.5">{formatDuration(syncState.durationMs)}</p>
              </div>
              <div className="rounded-md bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Holdings Imported</p>
                <p className="font-medium mt-0.5">{syncState.importedCount}</p>
              </div>
              <div className="rounded-md bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Next Sync</p>
                <p className="font-medium mt-0.5">On demand</p>
              </div>
            </div>

            {syncState.status === "needs_reauth" && (
              <div
                className="flex items-start gap-2 text-xs rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2"
                role="alert"
                data-testid="needs-reauth-warning"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Reconnection required. </strong>
                  Your session has expired. Re-authenticate via Broker Settings to resume sync.
                </span>
              </div>
            )}

            {syncState.status === "failed" && syncState.lastError && (
              <div
                className="flex items-start gap-2 text-xs rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2"
                role="alert"
              >
                <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="text-muted-foreground">Last sync failed. Check broker connection.</span>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {isOAuthConnected && !linkedPortfolio && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => onConnect(def.provider)}
              data-testid={`btn-connect-${def.provider}`}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Import Holdings
            </Button>
          )}

          {linkedPortfolio && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onSync(linkedPortfolio.id)}
                disabled={isSyncing}
                data-testid={`btn-sync-${def.provider}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} aria-hidden="true" />
                {isSyncing ? "Syncing…" : "Refresh Portfolio"}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => onDisconnect(linkedPortfolio.id)}
                data-testid={`btn-disconnect-${def.provider}`}
              >
                <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
                Disconnect
              </Button>
            </>
          )}

          {!isOAuthConnected && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              asChild
            >
              <a href={settingsPath}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Go to Broker Settings
              </a>
            </Button>
          )}
        </div>

        {linkedPortfolio && (
          <p className="text-xs text-muted-foreground">
            Portfolio: <strong>{linkedPortfolio.name}</strong>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Coming-soon cards for future brokers
// ---------------------------------------------------------------------------

const FUTURE_BROKERS = [
  { label: "Charles Schwab",   description: "Coming soon" },
  { label: "Fidelity",         description: "Coming soon" },
  { label: "IBKR",             description: "Coming soon" },
  { label: "Robinhood",        description: "Coming soon" },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PortfolioConnectPage() {
  const [, setLocation] = useLocation();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ConnectionsResponse>({
    queryKey:        ["/api/portfolio/broker/connections"],
    refetchInterval: 5000, // poll while syncs are running
  });

  // Connect a broker → create portfolio
  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      const r = await fetch("/api/portfolio/broker/connect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Failed to connect");
      return body;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/broker/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Portfolio linked", description: `${data.portfolioName} — syncing holdings now.` });
    },
    onError: (err: Error) => toast({ title: "Connect failed", description: err.message, variant: "destructive" }),
  });

  // Disconnect broker from portfolio
  const disconnectMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      const r = await fetch(`/api/portfolio/broker/disconnect/${portfolioId}`, { method: "DELETE" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Failed to disconnect");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/broker/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Disconnected", description: "Portfolio converted to manual. Existing holdings retained." });
    },
    onError: (err: Error) => toast({ title: "Disconnect failed", description: err.message, variant: "destructive" }),
  });

  // Manual sync trigger
  const syncMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      setSyncingId(portfolioId);
      const r = await fetch(`/api/portfolio/broker/sync/${portfolioId}`, { method: "POST" });
      const body = await r.json();
      if (!r.ok && r.status !== 409) throw new Error(body.error ?? "Sync failed");
      return body;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/broker/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      if (data.status === "running") {
        toast({ title: "Sync started", description: "Holdings are being refreshed." });
      }
    },
    onError: (err: Error) => {
      setSyncingId(null);
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSyncingId(null),
  });

  const connections   = data?.connections;
  const brokerPortfolios = data?.portfolios ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap" role="list">
            <li role="listitem">
              <button onClick={() => setLocation("/")} className="hover:text-foreground focus-visible:outline-none focus-visible:underline">Home</button>
            </li>
            <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem">
              <button onClick={() => setLocation("/portfolio")} className="hover:text-foreground focus-visible:outline-none focus-visible:underline">Portfolio</button>
            </li>
            <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem" className="text-foreground font-medium">Connect Broker</li>
          </ol>
        </nav>

        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/portfolio")}
            className="gap-1 mb-3"
            aria-label="Back to Portfolio"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Broker Connection Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Import portfolio holdings directly from your brokerage account.
          </p>
        </div>

        {/* §10 — Compliance disclosure */}
        <div
          className="rounded-lg border border-muted bg-muted/20 px-4 py-3 space-y-1.5 text-xs text-muted-foreground mb-6"
          role="note"
          aria-label="Broker synchronization disclosure"
          data-testid="broker-sync-compliance-disclosure"
        >
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-green-500 shrink-0" aria-hidden="true" />
            About Broker Synchronization
          </p>
          <p data-testid="sync-purpose-statement">Broker synchronization imports portfolio holdings for research purposes.</p>
          <p data-testid="no-trading-authorization-statement">It does not authorize trading.</p>
          <p data-testid="disconnect-anytime-statement">You may disconnect your broker at any time.</p>
          <p data-testid="data-use-statement">Broker data is used only for portfolio research features.</p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center" role="status" aria-live="polite">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading broker connections…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3" role="alert">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <span>Failed to load broker connections. Please refresh the page.</span>
          </div>
        )}

        {connections && (
          <div className="space-y-4">
            {/* Supported brokers */}
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Supported Brokers</h2>
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
              {BROKER_DEFS.map(def => (
                <BrokerCard
                  key={def.provider}
                  def={def}
                  connectionInfo={connections[def.provider]}
                  portfolio={brokerPortfolios.find(p => p.provider === def.provider)}
                  onConnect={(provider) => connectMutation.mutate(provider)}
                  onDisconnect={(id) => disconnectMutation.mutate(id)}
                  onSync={(id) => syncMutation.mutate(id)}
                  syncingId={syncingId}
                />
              ))}
            </div>

            {/* Future brokers — coming soon */}
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide pt-4">Coming Soon</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FUTURE_BROKERS.map(b => (
                <Card key={b.label} className="opacity-60" aria-disabled="true" data-testid={`broker-card-future-${b.label.toLowerCase().replace(/\s/g, "-")}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">{b.label}</CardTitle>
                    <CardDescription className="text-xs">{b.description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>

            {/* Connection health overview */}
            {brokerPortfolios.length > 0 && (
              <div
                className="rounded-lg border bg-muted/10 px-4 py-3 mt-4"
                data-testid="connection-health-panel"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">Connection Health</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Linked Portfolios</p>
                    <p className="font-semibold text-base">{brokerPortfolios.length}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Sync</p>
                    <p className="font-semibold">
                      {formatRelativeTime(
                        brokerPortfolios
                          .map(p => p.syncState.completedAt)
                          .filter(Boolean)
                          .sort()
                          .reverse()[0] ?? null
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-semibold flex items-center gap-1">
                      {brokerPortfolios.some(p => p.syncState.status === "failed" || p.syncState.status === "needs_reauth")
                        ? <><AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" /> Attention</>
                        : <><CheckCircle2 className="h-3 w-3 text-green-500" aria-hidden="true" /> Healthy</>
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Privacy note */}
        <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Broker connections are managed via OAuth. No passwords or API keys are stored.{" "}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
          </span>
        </div>

      </div>
    </div>
  );
}
