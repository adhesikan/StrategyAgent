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

type TradeType =
  | "stock"
  | "long-call"
  | "long-put"
  | "short-premium"
  | "vertical"
  | "complex";

interface TradePlan {
  name: string;
  legs: Leg[];
  netLabel: string;
  netValue: number;
  netPerShare: number;
  winProb: string;
  maxProfit: string;
  maxLoss: string;
  breakEven: string;
  payoff: { breakeven: [number, number]; maxUp: number; maxDown: number };
  reasons: string[];
  cautions: string[];
  exitPlan: string[];
  steps: string[];
}

function buildPlan(type: TradeType, ticker: string, strategy: string): TradePlan {
  const expiry = "Jun 6";
  switch (type) {
    case "stock":
      return {
        name: "Long Stock",
        legs: [
          { side: "BUY", qty: 100, desc: `${ticker} shares @ $90.00`, delta: 1, price: -90 },
        ],
        netLabel: "Total cost",
        netValue: 9000,
        netPerShare: -90,
        winProb: "62%",
        maxProfit: "Unlimited",
        maxLoss: "$1,500",
        breakEven: "$90.00",
        payoff: { breakeven: [90, 200], maxUp: 1500, maxDown: -1500 },
        reasons: [
          "Strong relative strength vs sector",
          "Volume 2.4× average — institutional interest",
          "Holding above the 20-day moving average",
        ],
        cautions: ["Capital at risk = full position size minus stop"],
        exitPlan: [
          "Take profit at +15% ($103.50)",
          "Stop loss at -5% ($85.50)",
          "Trail stop to break-even after +5%",
        ],
        steps: [
          `Open broker order ticket for ${ticker}`,
          "Choose: Buy 100 shares",
          "Order type: Limit at $90.00",
          "Set stop at $85.50, target at $103.50 (bracket)",
          "Submit",
        ],
      };
    case "long-call":
      return {
        name: "Long Call",
        legs: [
          { side: "BUY", qty: 1, desc: `$92 call · ${expiry}`, delta: 0.45, price: -2.10 },
        ],
        netLabel: "Net debit paid",
        netValue: -210,
        netPerShare: -2.10,
        winProb: "48%",
        maxProfit: "Unlimited",
        maxLoss: "$210",
        breakEven: "$94.10",
        payoff: { breakeven: [94, 200], maxUp: 600, maxDown: -210 },
        reasons: [
          "Bullish bias from price action + volume",
          "IV rank below 50 — premium isn't expensive",
          "Defined risk = full premium paid",
        ],
        cautions: ["Theta decay accelerates inside 21 DTE"],
        exitPlan: [
          "Take profit at +75% (~$3.70)",
          "Stop loss at -50% of premium (~$1.05)",
          "Close 21 days before expiry to avoid gamma risk",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          "Buy 1 call at strike $92",
          "Order type: Limit at $2.10 debit",
          "Submit single-leg order",
        ],
      };
    case "long-put":
      return {
        name: "Long Put",
        legs: [
          { side: "BUY", qty: 1, desc: `$88 put · ${expiry}`, delta: -0.42, price: -1.95 },
        ],
        netLabel: "Net debit paid",
        netValue: -195,
        netPerShare: -1.95,
        winProb: "46%",
        maxProfit: "$8,605 (if → $0)",
        maxLoss: "$195",
        breakEven: "$86.05",
        payoff: { breakeven: [80, 86], maxUp: 600, maxDown: -195 },
        reasons: [
          "Bearish bias — broke key support",
          "IV rank moderate — premium reasonable",
          "Defined risk = full premium paid",
        ],
        cautions: ["Theta decay accelerates inside 21 DTE"],
        exitPlan: [
          "Take profit at +75% (~$3.40)",
          "Stop loss at -50% of premium (~$0.97)",
          "Close 21 days before expiry to avoid gamma risk",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          "Buy 1 put at strike $88",
          "Order type: Limit at $1.95 debit",
          "Submit single-leg order",
        ],
      };
    case "short-premium":
      return {
        name: "Cash-Secured Put",
        legs: [
          { side: "SELL", qty: 1, desc: `$85 put · ${expiry}`, delta: -0.30, price: 1.10 },
        ],
        netLabel: "Net credit received",
        netValue: 110,
        netPerShare: 1.10,
        winProb: "70%",
        maxProfit: "$110",
        maxLoss: "$8,390 (assignment to $0)",
        breakEven: "$83.90",
        payoff: { breakeven: [83.9, 200], maxUp: 110, maxDown: -8390 },
        reasons: [
          "Selling premium when IV is elevated",
          "Strike below key support — comfortable assignment level",
          "Probability of profit ~70%",
        ],
        cautions: [
          "Requires cash to back the put ($8,500 buying power)",
          "Assignment risk if price falls below strike",
        ],
        exitPlan: [
          "Take profit at 50% of max credit ($0.55)",
          "Roll down/out if tested at short strike",
          "Accept assignment if you'd own the stock at $83.90",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          "Sell 1 put at strike $85",
          "Order type: Limit at $1.10 credit",
          "Confirm cash collateral and submit",
        ],
      };
    case "vertical":
      return {
        name: "Bull Call Spread",
        legs: [
          { side: "BUY",  qty: 1, desc: `$90 call · ${expiry}`, delta: 0.52, price: -2.80 },
          { side: "SELL", qty: 1, desc: `$95 call · ${expiry}`, delta: 0.28, price: 1.20 },
        ],
        netLabel: "Net debit paid",
        netValue: -160,
        netPerShare: -1.60,
        winProb: "58%",
        maxProfit: "$340",
        maxLoss: "$160",
        breakEven: "$91.60",
        payoff: { breakeven: [91.6, 95], maxUp: 340, maxDown: -160 },
        reasons: [
          "Defined risk and defined reward",
          "Cheaper than buying the call outright",
          "Good R:R of ~2:1",
        ],
        cautions: ["Caps upside at the short strike"],
        exitPlan: [
          "Take profit at 75% of max ($2.55 spread value)",
          "Stop loss at 50% of debit (~$0.80)",
          "Close 14-21 days before expiry",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          "Buy 1 call at $90",
          "Sell 1 call at $95",
          "Order type: Limit at $1.60 debit",
          "Submit as a single multi-leg combo order",
        ],
      };
    case "complex":
    default:
      return {
        name: "Iron Condor",
        legs: [
          { side: "SELL", qty: 1, desc: `$94 call · ${expiry}`, delta: 0.16, price: 1.20 },
          { side: "BUY",  qty: 1, desc: `$97 call · ${expiry}`, delta: 0.07, price: -0.45 },
          { side: "SELL", qty: 1, desc: `$84 put · ${expiry}`,  delta: -0.16, price: 1.05 },
          { side: "BUY",  qty: 1, desc: `$81 put · ${expiry}`,  delta: -0.07, price: -0.40 },
        ],
        netLabel: "Net credit received",
        netValue: 140,
        netPerShare: 1.40,
        winProb: "71%",
        maxProfit: "$140",
        maxLoss: "$160",
        breakEven: "$82.60 / $95.40",
        payoff: { breakeven: [84, 94], maxUp: 140, maxDown: -160 },
        reasons: [
          "IV rank at 78th percentile — premiums elevated",
          "Tight trading range past 30 days",
          "Risk fully defined — max loss is $160",
        ],
        cautions: ["No earnings in next 30 days — clean window"],
        exitPlan: [
          "Take profit at 50% of max credit ($0.70)",
          "Stop loss if debit hits $2.80 (2× credit)",
          "Manage if any short strike delta exceeds 0.30",
          "Close 21 days before expiry",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          "Sell 1 call at $94, Buy 1 call at $97",
          "Sell 1 put at $84, Buy 1 put at $81",
          "Order type: Limit at $1.40 credit",
          "Submit as a single multi-leg combo order",
        ],
      };
  }
}

function PayoffDiagram({ payoff }: { payoff: TradePlan["payoff"] }) {
  const { breakeven, maxUp, maxDown } = payoff;
  const w = 100;
  const h = 160;
  const max = Math.max(Math.abs(maxUp), Math.abs(maxDown), 100);
  const yScale = (v: number) => h / 2 - (v / max) * (h / 2);
  const lo = Math.max(0, breakeven[0] - 10);
  const hi = breakeven[1] + 10;

  const bars = useMemo(() => {
    const points: { x: number; y: number }[] = [];
    const range = hi - lo;
    for (let i = 0; i <= 40; i++) {
      const p = lo + (range * i) / 40;
      let profit: number;
      if (p < breakeven[0]) profit = maxDown;
      else if (p < breakeven[1]) profit = maxUp;
      else profit = maxDown;
      points.push({ x: p, y: profit });
    }
    return points;
  }, [lo, hi, breakeven, maxUp, maxDown]);

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
      <text x="2" y="10" fontSize="6" fill="hsl(var(--muted-foreground))">+${maxUp}</text>
      <text x="2" y={h - 4} fontSize="6" fill="hsl(var(--muted-foreground))">-${Math.abs(maxDown)}</text>
    </svg>
  );
}

const TYPE_LABELS: Record<TradeType, string> = {
  "stock": "Stock",
  "long-call": "Long call",
  "long-put": "Long put",
  "short-premium": "Short premium",
  "vertical": "Vertical spread",
  "complex": "Complex (multi-leg)",
};

export default function TradeDetailPage() {
  const params = useParams<{ ticker: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const sp = new URLSearchParams(search);
  const strategy = sp.get("strategy") || "iron-condor";
  const type = (sp.get("type") || "complex") as TradeType;
  const ticker = (params.ticker || "XLE").toUpperCase();

  const plan = useMemo(() => buildPlan(type, ticker, strategy), [type, ticker, strategy]);
  const score = 94;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  const scanResult = {
    ticker,
    price: 90,
    resistance: 97,
    stopLoss: 84,
    stage: "BREAKOUT",
    patternScore: score,
    rvol: 1.4,
    prefillTarget: 84,
    prefillQuantity: type === "stock" ? 100 : 1,
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
              <h1 className="text-[22px] font-medium" data-testid="text-trade-name">{plan.name}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <p className="text-sm text-muted-foreground">
                  {ticker} · {strategy}
                </p>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {TYPE_LABELS[type]}
                </Badge>
              </div>
            </div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-base px-3 py-1">
            Score: {score}/100
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile label="Win probability" value={plan.winProb} testId="metric-win-prob" />
          <MetricTile label="Max profit" value={plan.maxProfit} tone="green" testId="metric-max-profit" />
          <MetricTile label="Max loss" value={plan.maxLoss} tone="red" testId="metric-max-loss" />
          <MetricTile label="Break even" value={plan.breakEven} testId="metric-break-even" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3">Trade legs</h2>
            <div className="space-y-2">
              {plan.legs.map((leg, i) => (
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
                      {leg.side} {leg.qty}
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
              {plan.netLabel}: <span className={plan.netValue >= 0 ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
                {plan.netValue >= 0 ? "+" : ""}${Math.abs(plan.netPerShare).toFixed(2)}
              </span> per share · ${Math.abs(plan.netValue).toLocaleString()} total
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3">Payoff diagram</h2>
            <PayoffDiagram payoff={plan.payoff} />
            <div className="text-xs text-muted-foreground mt-2 text-center">
              {type === "stock" || type === "long-call"
                ? `Profitable above $${plan.payoff.breakeven[0]}`
                : type === "long-put"
                ? `Profitable below $${plan.payoff.breakeven[1]}`
                : `Profit zone (green) between $${plan.payoff.breakeven[0]} and $${plan.payoff.breakeven[1]}`}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" /> Why this scores high
            </h2>
            <ul className="space-y-2 text-sm">
              {plan.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
              {plan.cautions.map((r) => (
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
              {plan.exitPlan.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-medium mb-3">Step-by-step placement guide</h2>
          <ol className="space-y-2 text-sm list-decimal list-inside text-foreground/90">
            {plan.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
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
