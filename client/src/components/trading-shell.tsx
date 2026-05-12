import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { ShieldCheck, FlaskConical, Activity, Plug, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { getMarketSessionInfo } from "@shared/market-session";

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
  const isLiveMode = isConnected && !isPaper;
  const isPaperMode = isConnected && isPaper;
  const sessionInfo = getMarketSessionInfo();
  const sessionPillClass: Record<string, string> = {
    regular: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5 gap-1.5",
    pre: "border-blue-500/40 text-blue-400 bg-blue-500/5 gap-1.5",
    after: "border-orange-500/40 text-orange-400 bg-orange-500/5 gap-1.5",
    closed: "border-border/60 text-muted-foreground gap-1.5",
  };
  const sessionTooltip: Record<string, string> = {
    regular: "Regular trading hours: 9:30 AM – 4:00 PM ET.",
    pre: "Pre-market session: 4:00 AM – 9:30 AM ET. Limit orders only via your broker.",
    after: "After-hours session: 4:00 PM – 8:00 PM ET. Limit orders only via your broker.",
    closed: "Market is closed (outside 4:00 AM – 8:00 PM ET, weekends, or holidays).",
  };

  const modeLabel = isLiveMode
    ? "Live Broker Mode"
    : isPaperMode
    ? "Paper Mode"
    : "Simulated Examples";
  const modeTitle = isLiveMode
    ? "Using your connected brokerage account for live or broker-provided market data and order submission."
    : isPaperMode
    ? "Practicing with simulated trades using delayed/snapshot market context from your broker sandbox."
    : "Examples for learning the workflow only — connect a broker for live market data.";

  return (
    <Card data-testid="card-broker-status-strip" className="bg-card/40 backdrop-blur border-border/60 shadow-sm">
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs md:text-sm">
          <Badge
            variant="outline"
            title={modeTitle}
            className={
              isLiveMode
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5 gap-1.5"
                : "border-amber-500/40 text-amber-400 bg-amber-500/5 gap-1.5"
            }
            data-testid="pill-mode"
          >
            <FlaskConical className="h-3 w-3" />
            {modeLabel}
          </Badge>

          {isConnected ? (
            <Badge
              variant="outline"
              className="border-emerald-500/40 text-emerald-400 bg-emerald-500/5 gap-1.5"
              data-testid="pill-broker"
            >
              <CheckCircle2 className="h-3 w-3" />
              {providerName ? `${providerName} Connected` : "Broker Connected"}
            </Badge>
          ) : (
            <Link
              href="/settings"
              className="inline-flex"
              data-testid="link-connect-broker"
            >
              <Badge
                variant="outline"
                className="border-border/60 text-muted-foreground hover:text-foreground hover:border-border gap-1.5 cursor-pointer transition-colors"
              >
                <Plug className="h-3 w-3" />
                Connect broker for live data
              </Badge>
            </Link>
          )}

          <Badge
            variant="outline"
            title={sessionTooltip[sessionInfo.session]}
            className={sessionPillClass[sessionInfo.session]}
            data-testid="pill-market"
          >
            <Activity className="h-3 w-3" />
            {sessionInfo.label}
          </Badge>
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
          <span className="font-medium text-foreground">Not investment advice.</span>{" "}
          VCP Trader AI provides software-generated trading scenarios, market context,
          paper trading workflows, and order preparation tools for educational and
          informational purposes only. VCP Trader AI is not a broker-dealer, investment
          adviser, fiduciary, or data vendor and does not provide personalized investment
          advice. Trading stocks and options involves risk, including loss of principal.
          Paper Mode uses simulated execution and delayed, snapshot, sandbox, or
          estimated market context. Live market data, options chains, account balances,
          positions, and order submission are available only through your supported
          connected brokerage account, subject to your broker's entitlements. Past
          performance and back-tested results do not guarantee future outcomes. You are
          solely responsible for every trading decision and order.
        </p>
      </div>
    </div>
  );
}
