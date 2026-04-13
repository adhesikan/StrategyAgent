import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useLocation } from "wouter";
import {
  Link2,
  CheckCircle2,
  XCircle,
  Wifi,
  BarChart3,
  ShoppingCart,
  Zap,
  Settings,
  RefreshCw,
} from "lucide-react";

export default function BrokerConnectionsPage() {
  const { isConnected, providerName, status } = useBrokerStatus();
  const [, navigate] = useLocation();
  const isPaper = status?.preferredAccountId?.startsWith("sandbox:");

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Link2 className="h-6 w-6 text-primary" />
          Broker Connections
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
          Connect your broker for live market data and order placement
        </p>
      </div>

      <Card className="bg-card/80 backdrop-blur" data-testid="card-broker-status">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Connection Status</CardTitle>
              <CardDescription>Your current broker connection</CardDescription>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              isConnected
                ? isPaper
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                  : "border-green-500/40 bg-green-500/10 text-green-400"
                : "border-border bg-muted/30 text-muted-foreground"
            }`} data-testid="badge-connection-status">
              {isConnected ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">
                {isConnected
                  ? isPaper
                    ? `Paper: ${providerName}`
                    : `Live: ${providerName}`
                  : "Not Connected"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/30 border border-border/40">
                <Wifi className="h-5 w-5 text-green-400" />
                <div>
                  <p className="text-sm font-medium">Market Data</p>
                  <p className="text-xs text-muted-foreground">Live quotes available</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/30 border border-border/40">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                <div>
                  <p className="text-sm font-medium">Positions</p>
                  <p className="text-xs text-muted-foreground">View current holdings</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/30 border border-border/40">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Order Placement</p>
                  <p className="text-xs text-muted-foreground">Via InstaTrade™</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/settings")}
              data-testid="button-manage-connections"
            >
              <Settings className="h-4 w-4 mr-2" />
              {isConnected ? "Manage Connection" : "Connect Broker"}
            </Button>
            {isConnected && (
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                data-testid="button-refresh-connection"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!isConnected && (
        <Card className="border-dashed border-primary/30 bg-primary/5" data-testid="card-connect-cta">
          <CardContent className="py-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Zap className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Connect Your Broker</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Connect your broker account to unlock live market data for strategy analysis
                and enable order execution through InstaTrade™.
              </p>
            </div>
            <Button onClick={() => navigate("/settings")} data-testid="button-connect-broker">
              Connect Broker
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center" data-testid="text-disclaimer">
        Software-generated setup for informational purposes only. Not investment advice or a recommendation. Execution available through InstaTrade™.
      </p>
    </div>
  );
}
