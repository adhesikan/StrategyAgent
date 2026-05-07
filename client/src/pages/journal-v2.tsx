import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
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

interface Position {
  id: string;
  ticker: string;
  name: string;
  strategy: string;
  status: "Open" | "Win" | "Loss";
  pl: number;
  pctOfMax: number;
  daysLeft: number;
}

const POSITIONS: Position[] = [
  { id: "1", ticker: "XLE", name: "SPDR Energy", strategy: "Iron condor", status: "Open", pl: 92, pctOfMax: 34, daysLeft: 18 },
  { id: "2", ticker: "MU",  name: "Micron",      strategy: "Bear call spread", status: "Open", pl: 48, pctOfMax: 22, daysLeft: 11 },
  { id: "3", ticker: "AAPL",name: "Apple",       strategy: "Covered call", status: "Open", pl: -12, pctOfMax: -5, daysLeft: 7 },
];

const CLOSED: Position[] = [
  { id: "c1", ticker: "TSLA", name: "Tesla",  strategy: "Iron condor", status: "Win",  pl: 220, pctOfMax: 61, daysLeft: 0 },
  { id: "c2", ticker: "NVDA", name: "Nvidia", strategy: "Long call",   status: "Loss", pl: -180, pctOfMax: -100, daysLeft: 0 },
  { id: "c3", ticker: "META", name: "Meta",   strategy: "Put credit spread", status: "Win", pl: 140, pctOfMax: 50, daysLeft: 0 },
];

const MONTHLY = [
  { month: "Dec", pl: 320 }, { month: "Jan", pl: -120 }, { month: "Feb", pl: 480 },
  { month: "Mar", pl: 210 }, { month: "Apr", pl: -80 },  { month: "May", pl: 540 },
];

export default function JournalV2() {
  const [view, setView] = useState<View>("open");
  const [ticketOpen, setTicketOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);
  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });
  const visible = view === "open" ? POSITIONS : view === "closed" ? CLOSED : [...POSITIONS, ...CLOSED];

  const totalPl = [...POSITIONS, ...CLOSED].reduce((s, p) => s + p.pl, 0);
  const wins = CLOSED.filter((p) => p.status === "Win").length;
  const winRate = CLOSED.length ? Math.round((wins / CLOSED.length) * 100) : 0;
  const avgWin = Math.round(CLOSED.filter(p => p.pl > 0).reduce((s, p) => s + p.pl, 0) / Math.max(1, wins));
  const avgLoss = Math.round(CLOSED.filter(p => p.pl < 0).reduce((s, p) => s + p.pl, 0) / Math.max(1, CLOSED.length - wins));

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
                {v} ({v === "open" ? POSITIONS.length : v === "closed" ? CLOSED.length : POSITIONS.length + CLOSED.length})
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricTile label="Total P&L" value={`$${totalPl}`} tone={totalPl >= 0 ? "green" : "red"} />
          <MetricTile label="Win rate" value={`${winRate}%`} />
          <MetricTile label="Avg winner" value={`$${avgWin}`} tone="green" />
          <MetricTile label="Avg loser" value={`$${avgLoss}`} tone="red" />
          <MetricTile label="Open theta" value="+$24/d" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-5 bg-violet-50/60 border-violet-200" data-testid="card-ai-insight">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-violet-700 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-violet-900">AI insight</div>
                  <p className="text-sm text-violet-900/80 mt-1">
                    Your iron condors are winning at 83% — your best strategy. Your directional calls are only 40%.
                  </p>
                  <Button variant="ghost" size="sm" className="text-violet-900 hover:text-violet-900 px-0 h-auto mt-1 hover:bg-transparent">
                    Ask AI why <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-3">{view === "open" ? "Open positions" : view === "closed" ? "Closed positions" : "All positions"}</div>
              <div className="divide-y">
                {visible.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-3" data-testid={`row-position-${p.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-md bg-muted text-foreground/80 flex items-center justify-center text-xs font-medium">
                        {p.ticker.slice(0, 4)}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{p.ticker} · {p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.strategy}</div>
                      </div>
                      <StatusPill status={p.status} />
                    </div>
                    <div className="text-right">
                      <div className={"text-sm font-medium " + (p.pl >= 0 ? "text-emerald-700" : "text-rose-700")}>
                        {p.pl >= 0 ? "+" : ""}${p.pl}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.pctOfMax}% of max{p.daysLeft > 0 ? ` · ${p.daysLeft}d left` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-5">
              <div className="text-sm font-medium mb-3">Monthly P&L</div>
              <div className="flex items-end gap-2 h-32">
                {MONTHLY.map((m) => {
                  const max = Math.max(...MONTHLY.map((x) => Math.abs(x.pl)));
                  const h = Math.max(8, (Math.abs(m.pl) / max) * 100);
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={"w-full rounded-t " + (m.pl >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                        style={{ height: `${h}%` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{m.month}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-3">Recent closed</div>
              <div className="divide-y">
                {CLOSED.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="text-sm font-medium">{p.ticker}</div>
                      <div className="text-xs text-muted-foreground">{p.strategy}</div>
                    </div>
                    <div className={"text-sm font-medium " + (p.pl >= 0 ? "text-emerald-700" : "text-rose-700")}>
                      {p.pl >= 0 ? "+" : ""}${p.pl}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <Card className="p-5 border-dashed">
          <div className="flex items-center justify-between">
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

function MetricTile({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : "text-foreground";
  return (
    <div className="bg-muted/40 rounded-lg p-4">
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-xl font-medium mt-2 ${color}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: "Open" | "Win" | "Loss" }) {
  const cls =
    status === "Open"
      ? "bg-sky-50 text-sky-800 border-sky-200"
      : status === "Win"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-rose-50 text-rose-800 border-rose-200";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}
