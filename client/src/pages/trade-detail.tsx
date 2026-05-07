import { useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Bookmark, Send, Sparkles, Check, AlertTriangle } from "lucide-react";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface Leg {
  side: "BUY" | "SELL";
  qty: number;
  desc: string;
  delta: number;
  price: number;
}

const sampleLegs: Leg[] = [
  { side: "SELL", qty: 1, desc: "$94 call · Jun 6", delta: 0.16, price: 1.20 },
  { side: "BUY",  qty: 1, desc: "$97 call · Jun 6", delta: 0.07, price: -0.45 },
];

const reasonsHigh = [
  "IV rank at 78th percentile — premiums are elevated",
  "Tight trading range past 30 days",
  "Risk is fully defined — max loss is $160",
];
const reasonsCaution = [
  "No earnings in next 30 days — clean window",
];

function PayoffDiagram({ breakeven }: { breakeven: [number, number] }) {
  const bars = useMemo(() => {
    const points: { x: number; y: number }[] = [];
    for (let p = 80; p <= 100; p += 1) {
      const profit = p < breakeven[0] ? -160 : p < breakeven[1] ? 140 : -160 + (breakeven[1] - p) * 30;
      points.push({ x: p, y: Math.max(-160, Math.min(140, profit)) });
    }
    return points;
  }, [breakeven]);

  const w = 100;
  const h = 160;
  const max = 200;
  const yScale = (v: number) => h / 2 - (v / max) * (h / 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" data-testid="payoff-diagram">
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="hsl(var(--border))" strokeWidth="0.5" />
      {bars.map((pt, i) => {
        const barW = w / bars.length;
        const isProfit = pt.y > 0;
        const barH = Math.abs(yScale(pt.y) - h / 2);
        const yStart = isProfit ? yScale(pt.y) : h / 2;
        return (
          <rect
            key={i}
            x={i * barW + 0.4}
            y={yStart}
            width={barW - 0.8}
            height={barH}
            fill={isProfit ? "rgb(34 197 94)" : "rgb(239 68 68)"}
            opacity={0.85}
          />
        );
      })}
      <text x="2" y="10" fontSize="6" fill="hsl(var(--muted-foreground))">+$140</text>
      <text x="2" y={h - 4} fontSize="6" fill="hsl(var(--muted-foreground))">-$160</text>
    </svg>
  );
}

export default function TradeDetailPage() {
  const params = useParams<{ ticker: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const sp = new URLSearchParams(search);
  const strategy = sp.get("strategy") || "iron-condor";
  const ticker = (params.ticker || "XLE").toUpperCase();

  const tradeName = "Bear Call Spread";
  const score = 94;
  const breakeven: [number, number] = [86, 94];
  const entryPrice = 90;
  const stopLoss = 97;
  const target = 84;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  const scanResult = {
    ticker,
    price: entryPrice,
    resistance: stopLoss,
    stopLoss: target,
    stage: "BREAKOUT",
    patternScore: score,
    rvol: 1.4,
    prefillTarget: target,
    prefillQuantity: 1,
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button
          onClick={() => navigate("/scanner")}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" /> Back to scanner
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium" data-testid="badge-ticker">
              {ticker.slice(0, 4)}
            </div>
            <div>
              <h1 className="text-[22px] font-medium" data-testid="text-trade-name">{tradeName}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {ticker} · Jun 6 · 4 days · {strategy}
              </p>
            </div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-base px-3 py-1">
            Score: {score}/100
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile label="Win probability" value="71%" testId="metric-win-prob" />
          <MetricTile label="Max profit" value="$340" tone="green" testId="metric-max-profit" />
          <MetricTile label="Max loss" value="$160" tone="red" testId="metric-max-loss" />
          <MetricTile label="Break even" value="$84–$94" testId="metric-break-even" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3">Trade legs</h2>
            <div className="space-y-2">
              {sampleLegs.map((leg, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-2 border-b last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        leg.side === "SELL"
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-emerald-50 text-emerald-800 border-emerald-200"
                      }
                    >
                      {leg.side}
                    </Badge>
                    <span>{leg.desc}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Δ {leg.delta.toFixed(2)}</span>
                    <span className={leg.price >= 0 ? "text-emerald-700" : "text-rose-700"}>
                      {leg.price >= 0 ? "+" : ""}${leg.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
              Net credit received: <span className="text-emerald-700 font-medium">+$1.40</span> per share · $140 total
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3">Payoff diagram</h2>
            <PayoffDiagram breakeven={breakeven} />
            <div className="text-xs text-muted-foreground mt-2 text-center">
              Profit zone (green) between ${breakeven[0]} and ${breakeven[1]}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" /> Why this scores high
            </h2>
            <ul className="space-y-2 text-sm">
              {reasonsHigh.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
              {reasonsCaution.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3">Exit plan</h2>
            <ol className="space-y-2 text-sm list-decimal list-inside text-foreground/90">
              <li>Take profit at <code className="bg-muted px-1.5 py-0.5 rounded text-xs">50%</code> of max credit ($0.70)</li>
              <li>Stop loss if debit hits <code className="bg-muted px-1.5 py-0.5 rounded text-xs">$2.80</code> (2× credit)</li>
              <li>Manage if short strike delta exceeds <code className="bg-muted px-1.5 py-0.5 rounded text-xs">0.30</code></li>
              <li>Close 21 days before expiry to avoid gamma risk</li>
            </ol>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-medium mb-3">Step-by-step placement guide</h2>
          <ol className="space-y-2 text-sm list-decimal list-inside text-foreground/90">
            <li>Open your broker's options chain for <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{ticker}</code></li>
            <li>Select expiry: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Jun 6</code></li>
            <li>Sell 1 call at strike <code className="bg-muted px-1.5 py-0.5 rounded text-xs">$94</code></li>
            <li>Buy 1 call at strike <code className="bg-muted px-1.5 py-0.5 rounded text-xs">$97</code></li>
            <li>Set order type to limit at credit <code className="bg-muted px-1.5 py-0.5 rounded text-xs">$1.40</code></li>
            <li>Submit as a single multi-leg combo order</li>
          </ol>
        </Card>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button
            className="gap-2"
            onClick={() => setTicketOpen(true)}
            data-testid="button-send-instatrade"
          >
            <Send className="h-4 w-4" /> Send to InstaTrade™
          </Button>
          <Button variant="outline" className="gap-2" data-testid="button-save-watchlist">
            <Bookmark className="h-4 w-4" /> Save to watchlist
          </Button>
          <Button variant="outline" onClick={() => navigate("/scanner")} data-testid="button-find-similar">
            Find similar setups
          </Button>
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          For informational purposes only — not financial advice.
        </p>
      </div>

      <StockTradeTicket
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        scanResult={scanResult}
        brokerAccounts={brokerAccounts || []}
        selectedAccount={selectedAccount}
        onAccountChange={setSelectedAccount}
      />
    </div>
  );
}

function MetricTile({ label, value, tone, testId }: { label: string; value: string; tone?: "green" | "red"; testId: string }) {
  const color =
    tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : "text-foreground";
  return (
    <div className="bg-muted/40 rounded-lg p-4" data-testid={testId}>
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-xl font-medium mt-2 ${color}`}>{value}</div>
    </div>
  );
}
