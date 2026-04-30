import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { ShieldCheck, Wifi, WifiOff, FlaskConical, Activity, Gauge } from "lucide-react";
import { Link } from "wouter";

interface HomeActionCardProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  testId: string;
  accent?: "blue" | "emerald" | "amber" | "violet";
}

const ACCENTS: Record<string, string> = {
  blue: "from-blue-500/15 to-transparent border-blue-500/20 hover:border-blue-500/40",
  emerald: "from-emerald-500/15 to-transparent border-emerald-500/20 hover:border-emerald-500/40",
  amber: "from-amber-500/15 to-transparent border-amber-500/20 hover:border-amber-500/40",
  violet: "from-violet-500/15 to-transparent border-violet-500/20 hover:border-violet-500/40",
};
const ACCENT_ICON: Record<string, string> = {
  blue: "bg-blue-500/20 text-blue-400",
  emerald: "bg-emerald-500/20 text-emerald-400",
  amber: "bg-amber-500/20 text-amber-400",
  violet: "bg-violet-500/20 text-violet-400",
};

export function HomeActionCard({ title, subtitle, icon: Icon, onClick, testId, accent = "blue" }: HomeActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`group text-left w-full rounded-xl border bg-gradient-to-br ${ACCENTS[accent]} p-5 md:p-6 transition-all hover-elevate active-elevate-2`}
    >
      <div className="flex items-start gap-4">
        <div className={`h-12 w-12 shrink-0 rounded-lg flex items-center justify-center ${ACCENT_ICON[accent]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="space-y-1 min-w-0">
          <h3 className="font-semibold text-lg leading-tight">{title}</h3>
          <p className="text-sm text-muted-foreground leading-snug">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

export function BrokerStatusStrip() {
  const { isConnected, providerName, status } = useBrokerStatus();
  const isPaper = status?.preferredAccountId?.startsWith("sandbox:");
  const dataMode = isConnected && !isPaper ? "Live" : "Mock";

  return (
    <Card data-testid="card-broker-status-strip" className="bg-card/60 backdrop-blur">
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3 md:gap-6 text-xs md:text-sm">
          <div className="flex items-center gap-2" data-testid="strip-broker">
            {isConnected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">Broker:</span>
            <Badge variant={isConnected ? "default" : "outline"} className="font-medium">
              {isConnected ? `${providerName ?? "Connected"}${isPaper ? " · Paper" : ""}` : "Not Connected"}
            </Badge>
          </div>

          <div className="flex items-center gap-2" data-testid="strip-data-mode">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Data:</span>
            <Badge variant="outline" className={dataMode === "Live" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}>
              {dataMode}
            </Badge>
          </div>

          <div className="flex items-center gap-2" data-testid="strip-market">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Market:</span>
            <Badge variant="outline">Regular Hours</Badge>
          </div>

          <div className="flex items-center gap-2" data-testid="strip-risk">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Risk profile:</span>
            <Link
              href="/settings/risk-profile"
              className="text-primary hover:underline font-medium"
              data-testid="link-strip-risk"
            >
              Review
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ComplianceFooter() {
  return (
    <div
      className="mt-8 rounded-lg border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed"
      data-testid="compliance-footer"
    >
      <div className="flex gap-2 items-start">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p>
          Strategy Agent provides software-generated trading scenarios for educational and informational
          purposes only. It does not provide investment advice or guarantee results. You are responsible
          for every trade decision and order submitted.
        </p>
      </div>
    </div>
  );
}
