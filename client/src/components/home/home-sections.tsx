import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Link2,
  Wallet,
} from "lucide-react";
import type { PositionProtectionPlan, UserTradePreferences } from "@shared/schema";

interface RadarCandidate {
  id: string;
  symbol: string;
  companyName?: string;
  strategyType: string;
  finalGrade: string;
  finalScore: number;
  thesis: string;
  mainRisk: string;
  capitalRequired: number;
  maxLoss: number;
  timeHorizon: string;
  isOptions: boolean;
}

interface RadarResult {
  candidates: RadarCandidate[];
  brokerConnected: boolean;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  A: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  B: "border-blue-500/40 text-blue-400 bg-blue-500/5",
  C: "border-border/60 text-muted-foreground",
};

const HORIZON_LABEL: Record<string, string> = {
  intraday: "Intraday",
  swing: "Swing (days–weeks)",
  position: "Position (weeks–months)",
};

function formatStrategy(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TodaysOpportunities() {
  const [, navigate] = useLocation();
  const { isConnected } = useBrokerStatus();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<RadarResult>({
    queryKey: ["/api/radar/scenarios"],
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (c: RadarCandidate) => {
      await apiRequest("POST", "/api/saved-candidates", {
        candidateId: c.id,
        symbol: c.symbol,
        strategy: c.strategyType,
        grade: c.finalGrade,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-candidates"] });
      toast({ title: "Candidate saved", description: "Find it later under My Activity." });
    },
    onError: () => {
      toast({ title: "Could not save candidate", variant: "destructive" });
    },
  });

  const candidates = (data?.candidates ?? []).slice(0, 4);

  return (
    <section className="space-y-3" data-testid="section-todays-opportunities">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg md:text-xl font-semibold">Today's Opportunities</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/opportunity-radar")}
          data-testid="button-view-all-opportunities"
        >
          View all
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        AI-generated candidate scenarios ranked by composite score. Not investment advice.
      </p>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground" data-testid="text-no-opportunities">
            No high-grade candidates right now. Check Opportunity Radar for the full universe.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {candidates.map((c) => (
            <Card key={c.id} data-testid={`card-opportunity-${c.symbol}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span data-testid={`text-opp-symbol-${c.symbol}`}>{c.symbol}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {c.isOptions ? "Options" : "Stock"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {formatStrategy(c.strategyType)}
                    </Badge>
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={GRADE_COLORS[c.finalGrade] ?? GRADE_COLORS.C}
                    data-testid={`badge-opp-grade-${c.symbol}`}
                  >
                    {c.finalGrade}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-xs text-muted-foreground line-clamp-2">{c.thesis}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {c.capitalRequired > 0 && (
                    <span className="text-muted-foreground">
                      Est. capital: <span className="text-foreground">${Math.round(c.capitalRequired).toLocaleString()}</span>
                    </span>
                  )}
                  {c.maxLoss > 0 && (
                    <span className="text-muted-foreground">
                      Max theoretical risk: <span className="text-foreground">${Math.round(c.maxLoss).toLocaleString()}</span>
                    </span>
                  )}
                  <span className="text-muted-foreground">{HORIZON_LABEL[c.timeHorizon] ?? c.timeHorizon}</span>
                </div>
                {c.mainRisk && (
                  <p className="text-[11px] text-amber-500/90 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {c.mainRisk}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/opportunity-radar?symbol=${c.symbol}`)}
                    data-testid={`button-opp-view-${c.symbol}`}
                  >
                    View Analysis
                  </Button>
                  {isConnected ? (
                    <Button
                      size="sm"
                      onClick={() => navigate(`/opportunity-radar?symbol=${c.symbol}&review=1`)}
                      data-testid={`button-opp-review-${c.symbol}`}
                    >
                      Review Order
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveMutation.mutate(c)}
                        disabled={saveMutation.isPending}
                        data-testid={`button-opp-save-${c.symbol}`}
                      >
                        <Bookmark className="h-3.5 w-3.5 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => navigate("/settings")}
                        data-testid={`button-opp-connect-${c.symbol}`}
                      >
                        Connect Broker
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

interface AttentionItem {
  id: string;
  message: string;
  action: string;
  href: string;
}

export function NeedsAttention() {
  const [, navigate] = useLocation();
  const { isConnected, connectionLost, connectionLostProvider } = useBrokerStatus();

  const { data: plans = [] } = useQuery<PositionProtectionPlan[]>({
    queryKey: ["/api/position-protection/plans"],
  });
  const { data: prefs } = useQuery<Partial<UserTradePreferences>>({
    queryKey: ["/api/user/trade-preferences"],
  });

  const items: AttentionItem[] = [];

  if (connectionLost) {
    items.push({
      id: "broker-lost",
      message: `Your ${connectionLostProvider ?? "broker"} connection has expired. Reconnect to restore live data and order review.`,
      action: "Reconnect",
      href: "/settings",
    });
  }
  const triggered = plans.filter((p) => p.status === "triggered").length;
  if (triggered > 0) {
    items.push({
      id: "pp-triggered",
      message: `${triggered} Exit Protection rule${triggered === 1 ? "" : "s"} triggered. Review the resulting orders.`,
      action: "Review",
      href: "/history",
    });
  }
  const failed = plans.filter((p) => p.status === "error").length;
  if (failed > 0) {
    items.push({
      id: "pp-failed",
      message: `${failed} Exit Protection rule${failed === 1 ? "" : "s"} need attention — monitoring reported a problem.`,
      action: "Review",
      href: "/history",
    });
  }
  if (isConnected && prefs && !prefs.liveSetupCompleted) {
    items.push({
      id: "live-setup",
      message: "Required trading settings are incomplete. Finish Live Trading Setup before sending orders.",
      action: "Complete Setup",
      href: "/settings/risk-profile",
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="section-needs-attention">
      <h2 className="text-lg font-semibold">Needs Your Attention</h2>
      {items.map((item) => (
        <Card key={item.id} className="border-amber-500/30 bg-amber-500/5" data-testid={`card-attention-${item.id}`}>
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-sm flex-1 min-w-0">{item.message}</p>
            <Button size="sm" variant="outline" onClick={() => navigate(item.href)} data-testid={`button-attention-${item.id}`}>
              {item.action}
            </Button>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export function PositionsSummaryOrConnect() {
  const [, navigate] = useLocation();
  const { isConnected } = useBrokerStatus();

  if (isConnected) return null;

  return (
    <Card data-testid="card-connect-broker-cta">
      <CardContent className="p-4 flex items-center gap-3">
        <Wallet className="h-5 w-5 text-muted-foreground shrink-0" />
        <p className="text-sm text-muted-foreground flex-1 min-w-0">
          Connect a brokerage account to view positions, balances, and buying power.
        </p>
        <Button size="sm" onClick={() => navigate("/settings")} data-testid="button-connect-broker-cta">
          <Link2 className="h-3.5 w-3.5 mr-1" />
          Connect Broker
        </Button>
      </CardContent>
    </Card>
  );
}
