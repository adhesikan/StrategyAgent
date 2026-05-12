import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, Info } from "lucide-react";
import { Link } from "wouter";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

type View = "open" | "closed" | "all";

interface JournalPosition {
  id: string;
  ticker: string;
  name: string;
  strategy: string;
  status: "Open" | "Win" | "Loss";
  pl: number;
  pctOfMax: number | null;
  daysLeft: number | null;
  exitDate?: string;
}

interface PositionsResponse {
  positions: JournalPosition[];
  counts: { open: number; closed: number; all: number };
}

interface SummaryResponse {
  hasData: boolean;
  metrics: {
    totalPl: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    openPl: number;
    openCount: number;
    closedCount: number;
  };
  monthly: { month: string; pl: number }[];
  insight: { text: string; type: "neutral" | "positive" | "warning" };
  recentClosed: { id: string; ticker: string; strategy: string; pl: number }[];
}

function fmtMoney(n: number): string {
  const sign = n >= 0 ? "" : "-";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

export default function JournalV2() {
  const [view, setView] = useState<View>("open");
  const [ticketOpen, setTicketOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<SummaryResponse>({
    queryKey: ["/api/journal/summary"],
  });
  const { data: positionsResp, isLoading: posLoading } = useQuery<PositionsResponse>({
    queryKey: ["/api/journal/positions", { view }],
    queryFn: async () => {
      const r = await fetch(`/api/journal/positions?view=${view}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load positions");
      return r.json();
    },
  });

  const counts = positionsResp?.counts ?? { open: 0, closed: 0, all: 0 };
  const visible = positionsResp?.positions ?? [];
  const metrics = summary?.metrics;
  const hasData = summary?.hasData ?? false;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[22px] font-medium" data-testid="text-journal-title">Journal</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your trades, P&amp;L, and patterns over time.
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1 flex">
            {(["open", "closed", "all"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "px-3 py-1 text-xs rounded-md capitalize transition-colors " +
                  (view === v ? "bg-background shadow-sm" : "text-muted-foreground")
                }
                data-testid={`view-${v}`}
              >
                {v} ({counts[v]})
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {summaryLoading || !metrics ? (
            [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : (
            <>
              <MetricTile label="Total P&L" value={fmtMoney(metrics.totalPl)} tone={metrics.totalPl >= 0 ? "green" : "red"} testId="metric-total-pl" />
              <MetricTile label="Win rate" value={`${metrics.winRate}%`} testId="metric-win-rate" />
              <MetricTile label="Avg winner" value={fmtMoney(metrics.avgWin)} tone="green" testId="metric-avg-win" />
              <MetricTile label="Avg loser" value={fmtMoney(metrics.avgLoss)} tone="red" testId="metric-avg-loss" />
              <MetricTile label="Open P&L" value={fmtMoney(metrics.openPl)} tone={metrics.openPl >= 0 ? "green" : "red"} testId="metric-open-pl" />
            </>
          )}
        </div>

        {!summaryLoading && summaryError && (
          <Card className="p-6 border-dashed border-rose-300" data-testid="error-journal">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <div className="text-sm font-medium">We couldn't load your journal right now.</div>
                <p className="text-sm text-muted-foreground">Please refresh the page in a moment.</p>
              </div>
            </div>
          </Card>
        )}
        {!summaryLoading && !summaryError && !hasData && (
          <Card className="p-6 border-dashed" data-testid="empty-journal">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Your journal is empty.</div>
                <p className="text-sm text-muted-foreground">
                  Once you send orders through InstaTrade™ or close positions through your broker, your real
                  P&amp;L, win rate, and per-strategy patterns will show up here automatically.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/home">Find an idea</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/settings">Connect broker</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {summary?.insight && (
              <Card
                className={
                  "p-5 " +
                  (summary.insight.type === "positive"
                    ? "bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900"
                    : summary.insight.type === "warning"
                    ? "bg-amber-50/60 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900"
                    : "bg-violet-50/60 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900")
                }
                data-testid="card-ai-insight"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-violet-700 dark:text-violet-300 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">AI insight</div>
                    <p className="text-sm mt-1 opacity-90" data-testid="text-insight">
                      {summary.insight.text}
                    </p>
                    <Button asChild variant="ghost" size="sm" className="px-0 h-auto mt-1 hover:bg-transparent">
                      <Link href="/ask?q=Analyze%20my%20trade%20journal">
                        Ask AI why <ArrowRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <div className="text-sm font-medium mb-3">
                {view === "open" ? "Open positions" : view === "closed" ? "Closed positions" : "All positions"}
              </div>
              {posLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-md" />)}
                </div>
              ) : visible.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-no-positions">
                  {view === "open"
                    ? "No open positions in your connected account."
                    : view === "closed"
                    ? "No closed trades recorded yet."
                    : "Nothing to show yet."}
                </p>
              ) : (
                <div className="divide-y">
                  {visible.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-3" data-testid={`row-position-${p.id}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-md bg-muted text-foreground/80 flex items-center justify-center text-xs font-medium shrink-0">
                          {p.ticker.slice(0, 4)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{p.ticker}</div>
                          <div className="text-xs text-muted-foreground truncate">{p.strategy}</div>
                        </div>
                        <StatusPill status={p.status} />
                      </div>
                      <div className="text-right shrink-0">
                        <div className={"text-sm font-medium " + (p.pl >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                          {p.pl >= 0 ? "+" : ""}{fmtMoney(p.pl)}
                        </div>
                        {(p.pctOfMax != null || (p.daysLeft != null && p.daysLeft > 0)) && (
                          <div className="text-xs text-muted-foreground">
                            {p.pctOfMax != null ? `${p.pctOfMax}%` : ""}
                            {p.pctOfMax != null && p.daysLeft != null && p.daysLeft > 0 ? " · " : ""}
                            {p.daysLeft != null && p.daysLeft > 0 ? `${p.daysLeft}d left` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-5">
              <div className="text-sm font-medium mb-3">Monthly P&L (last 6)</div>
              {summaryLoading || !summary ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="flex items-end gap-2 h-32">
                  {summary.monthly.map((m) => {
                    const max = Math.max(1, ...summary.monthly.map((x) => Math.abs(x.pl)));
                    const h = Math.max(8, (Math.abs(m.pl) / max) * 100);
                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className={"w-full rounded-t " + (m.pl >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                          style={{ height: `${h}%` }}
                          title={`${m.month}: ${fmtMoney(m.pl)}`}
                        />
                        <span className="text-[10px] text-muted-foreground">{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-3">Recent closed</div>
              {summaryLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-md" />)}
                </div>
              ) : (summary?.recentClosed.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No closed trades yet.</p>
              ) : (
                <div className="divide-y">
                  {summary!.recentClosed.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="text-sm font-medium">{p.ticker}</div>
                        <div className="text-xs text-muted-foreground">{p.strategy}</div>
                      </div>
                      <div className={"text-sm font-medium " + (p.pl >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                        {p.pl >= 0 ? "+" : ""}{fmtMoney(p.pl)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <Card className="p-5 border-dashed">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-medium">Place a new trade without leaving</div>
              <p className="text-xs text-muted-foreground mt-0.5">Open the InstaTrade™ panel pre-filled to a fresh ticket.</p>
            </div>
            <Button onClick={() => setTicketOpen(true)} data-testid="button-open-instatrade">
              Open InstaTrade™
            </Button>
          </div>
        </Card>
      </div>

      <StockTradeTicket
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        scanResult={{
          ticker: "SPY",
          price: 0,
          resistance: null,
          stopLoss: null,
          stage: "WATCH",
          patternScore: 0,
        }}
        brokerAccounts={brokerAccounts || []}
        selectedAccount={selectedAccount}
        onAccountChange={setSelectedAccount}
      />
    </div>
  );
}

function MetricTile({ label, value, tone, testId }: { label: string; value: string; tone?: "green" | "red"; testId?: string }) {
  const color = tone === "green" ? "text-emerald-700 dark:text-emerald-400" : tone === "red" ? "text-rose-700 dark:text-rose-400" : "text-foreground";
  return (
    <div className="bg-muted/40 rounded-lg p-4" data-testid={testId}>
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-xl font-medium mt-2 ${color}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: "Open" | "Win" | "Loss" }) {
  const cls =
    status === "Open"
      ? "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900"
      : status === "Win"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
      : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}
