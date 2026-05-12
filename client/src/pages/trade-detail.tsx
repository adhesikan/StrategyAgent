import { useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Bookmark, Send, Sparkles, Check, AlertTriangle, Info } from "lucide-react";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface QuoteResponse {
  symbol: string;
  last: number;
  volume: number;
  change: number;
  changePercent: number;
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

// Round a price to a sensible option-strike increment based on the underlying.
function roundStrike(price: number): number {
  if (price >= 200) return Math.round(price / 5) * 5;
  if (price >= 50) return Math.round(price);
  if (price >= 10) return Math.round(price * 2) / 2; // half-dollar
  return Math.round(price * 2) / 2;
}

// Pick a near-month expiry label ~30-45 days out.
function defaultExpiryLabel(now: Date = new Date()): string {
  const target = new Date(now);
  target.setDate(target.getDate() + 35);
  return target.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function buildPlan(type: TradeType, ticker: string, price: number): TradePlan {
  const expiry = defaultExpiryLabel();
  const p = Math.max(price, 1);

  switch (type) {
    case "stock": {
      const stop = +(p * 0.95).toFixed(2);
      const target = +(p * 1.15).toFixed(2);
      const positionSize = 100;
      const cost = +(p * positionSize).toFixed(2);
      const lossDollars = +((p - stop) * positionSize).toFixed(0);
      const gainDollars = +((target - p) * positionSize).toFixed(0);
      return {
        name: "Long Stock",
        legs: [
          { side: "BUY", qty: positionSize, desc: `${ticker} shares @ ~$${p.toFixed(2)}`, delta: 1, price: -p },
        ],
        netLabel: "Total cost (approx.)",
        netValue: cost,
        netPerShare: -p,
        winProb: "—",
        maxProfit: "Unlimited",
        maxLoss: `~$${lossDollars.toLocaleString()} (to stop)`,
        breakEven: `$${p.toFixed(2)}`,
        payoff: { breakeven: [p, p * 1.5], maxUp: gainDollars, maxDown: -lossDollars },
        reasons: [
          "Strong relative strength vs sector",
          "Volume above average — interest building",
          "Holding above the 20-day moving average",
        ],
        cautions: ["Capital at risk = full position size minus stop"],
        exitPlan: [
          `Take profit at +15% (~$${target.toFixed(2)})`,
          `Stop loss at -5% (~$${stop.toFixed(2)})`,
          "Trail stop to break-even after +5%",
        ],
        steps: [
          `Open broker order ticket for ${ticker}`,
          `Choose: Buy ${positionSize} shares`,
          `Order type: Limit near $${p.toFixed(2)}`,
          `Set stop at $${stop.toFixed(2)}, target at $${target.toFixed(2)} (bracket)`,
          "Submit",
        ],
      };
    }
    case "long-call": {
      const strike = roundStrike(p * 1.02); // slightly OTM
      const debit = +(p * 0.025).toFixed(2); // ~2.5% of underlying — rough placeholder
      const breakEven = +(strike + debit).toFixed(2);
      const cost = +(debit * 100).toFixed(0);
      return {
        name: "Long Call",
        legs: [
          { side: "BUY", qty: 1, desc: `$${strike} call · ${expiry}`, delta: 0.45, price: -debit },
        ],
        netLabel: "Net debit paid (estimate)",
        netValue: -cost,
        netPerShare: -debit,
        winProb: "≈45–50%",
        maxProfit: "Unlimited",
        maxLoss: `$${cost.toLocaleString()}`,
        breakEven: `$${breakEven.toFixed(2)}`,
        payoff: { breakeven: [breakEven, breakEven * 1.4], maxUp: cost * 3, maxDown: -cost },
        reasons: [
          "Bullish bias from price action + volume",
          "IV rank moderate — premium not extreme",
          "Defined risk = full premium paid",
        ],
        cautions: [
          "Theta decay accelerates inside 21 DTE",
          `Estimate only — confirm actual premium and Δ in your broker chain near $${strike}`,
        ],
        exitPlan: [
          "Take profit at +75% of premium",
          "Stop loss at -50% of premium",
          "Close 21 days before expiry to avoid gamma risk",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          `Buy 1 call near strike $${strike}`,
          `Order type: Limit near $${debit.toFixed(2)} debit`,
          "Submit single-leg order",
        ],
      };
    }
    case "long-put": {
      const strike = roundStrike(p * 0.98); // slightly OTM
      const debit = +(p * 0.024).toFixed(2);
      const breakEven = +(strike - debit).toFixed(2);
      const cost = +(debit * 100).toFixed(0);
      return {
        name: "Long Put",
        legs: [
          { side: "BUY", qty: 1, desc: `$${strike} put · ${expiry}`, delta: -0.42, price: -debit },
        ],
        netLabel: "Net debit paid (estimate)",
        netValue: -cost,
        netPerShare: -debit,
        winProb: "≈42–48%",
        maxProfit: `$${(strike * 100 - cost).toLocaleString()} (if → $0)`,
        maxLoss: `$${cost.toLocaleString()}`,
        breakEven: `$${breakEven.toFixed(2)}`,
        payoff: { breakeven: [breakEven * 0.6, breakEven], maxUp: cost * 3, maxDown: -cost },
        reasons: [
          "Bearish bias — broke key support",
          "IV rank moderate — premium reasonable",
          "Defined risk = full premium paid",
        ],
        cautions: [
          "Theta decay accelerates inside 21 DTE",
          `Estimate only — confirm actual premium and Δ in your broker chain near $${strike}`,
        ],
        exitPlan: [
          "Take profit at +75% of premium",
          "Stop loss at -50% of premium",
          "Close 21 days before expiry to avoid gamma risk",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          `Buy 1 put near strike $${strike}`,
          `Order type: Limit near $${debit.toFixed(2)} debit`,
          "Submit single-leg order",
        ],
      };
    }
    case "short-premium": {
      const strike = roundStrike(p * 0.93); // ~7% OTM put
      const credit = +(p * 0.012).toFixed(2);
      const breakEven = +(strike - credit).toFixed(2);
      const creditDollars = +(credit * 100).toFixed(0);
      const collateral = +(strike * 100).toFixed(0);
      return {
        name: "Cash-Secured Put",
        legs: [
          { side: "SELL", qty: 1, desc: `$${strike} put · ${expiry}`, delta: -0.30, price: credit },
        ],
        netLabel: "Net credit received (estimate)",
        netValue: creditDollars,
        netPerShare: credit,
        winProb: "≈70%",
        maxProfit: `$${creditDollars.toLocaleString()}`,
        maxLoss: `$${(collateral - creditDollars).toLocaleString()} (assignment to $0)`,
        breakEven: `$${breakEven.toFixed(2)}`,
        payoff: { breakeven: [breakEven, breakEven * 1.6], maxUp: creditDollars, maxDown: -(collateral - creditDollars) },
        reasons: [
          "Selling premium when IV is elevated",
          "Strike below key support — comfortable assignment level",
          "Probability of profit ~70%",
        ],
        cautions: [
          `Requires cash to back the put (~$${collateral.toLocaleString()} buying power)`,
          "Assignment risk if price falls below strike",
          `Estimate only — confirm actual credit in your broker chain near $${strike}`,
        ],
        exitPlan: [
          "Take profit at 50% of max credit",
          "Roll down/out if tested at short strike",
          `Accept assignment if you'd own the stock at $${breakEven.toFixed(2)}`,
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          `Sell 1 put near strike $${strike}`,
          `Order type: Limit near $${credit.toFixed(2)} credit`,
          "Confirm cash collateral and submit",
        ],
      };
    }
    case "vertical": {
      const longK = roundStrike(p);
      const shortK = roundStrike(p * 1.06);
      const debit = +(p * 0.018).toFixed(2);
      const width = shortK - longK;
      const maxGain = +((width - debit) * 100).toFixed(0);
      const maxLoss = +(debit * 100).toFixed(0);
      const breakEven = +(longK + debit).toFixed(2);
      return {
        name: "Bull Call Spread",
        legs: [
          { side: "BUY",  qty: 1, desc: `$${longK} call · ${expiry}`, delta: 0.52, price: -(debit + width * 0.4) },
          { side: "SELL", qty: 1, desc: `$${shortK} call · ${expiry}`, delta: 0.28, price: width * 0.4 },
        ],
        netLabel: "Net debit paid (estimate)",
        netValue: -maxLoss,
        netPerShare: -debit,
        winProb: "≈55–60%",
        maxProfit: `$${maxGain.toLocaleString()}`,
        maxLoss: `$${maxLoss.toLocaleString()}`,
        breakEven: `$${breakEven.toFixed(2)}`,
        payoff: { breakeven: [breakEven, shortK], maxUp: maxGain, maxDown: -maxLoss },
        reasons: [
          "Defined risk and defined reward",
          "Cheaper than buying the call outright",
          `R:R ≈ ${(maxGain / Math.max(maxLoss, 1)).toFixed(1)}:1`,
        ],
        cautions: [
          "Caps upside at the short strike",
          `Estimate only — confirm actual fill in your broker chain (${longK}/${shortK})`,
        ],
        exitPlan: [
          "Take profit at 75% of max",
          "Stop loss at 50% of debit",
          "Close 14-21 days before expiry",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          `Buy 1 call at $${longK}`,
          `Sell 1 call at $${shortK}`,
          `Order type: Limit near $${debit.toFixed(2)} debit`,
          "Submit as a single multi-leg combo order",
        ],
      };
    }
    case "complex":
    default: {
      const callShort = roundStrike(p * 1.05);
      const callLong = roundStrike(p * 1.10);
      const putShort = roundStrike(p * 0.95);
      const putLong = roundStrike(p * 0.90);
      const credit = +(p * 0.012).toFixed(2);
      const callWidth = callLong - callShort;
      const putWidth = putShort - putLong;
      const maxLossDollars = +((Math.max(callWidth, putWidth) - credit) * 100).toFixed(0);
      const creditDollars = +(credit * 100).toFixed(0);
      return {
        name: "Iron Condor",
        legs: [
          { side: "SELL", qty: 1, desc: `$${callShort} call · ${expiry}`, delta: 0.16, price: credit * 0.6 },
          { side: "BUY",  qty: 1, desc: `$${callLong} call · ${expiry}`, delta: 0.07, price: -credit * 0.25 },
          { side: "SELL", qty: 1, desc: `$${putShort} put · ${expiry}`,  delta: -0.16, price: credit * 0.6 },
          { side: "BUY",  qty: 1, desc: `$${putLong} put · ${expiry}`,  delta: -0.07, price: -credit * 0.25 },
        ],
        netLabel: "Net credit received (estimate)",
        netValue: creditDollars,
        netPerShare: credit,
        winProb: "≈70%",
        maxProfit: `$${creditDollars.toLocaleString()}`,
        maxLoss: `$${maxLossDollars.toLocaleString()}`,
        breakEven: `$${(putShort - credit).toFixed(2)} / $${(callShort + credit).toFixed(2)}`,
        payoff: { breakeven: [putShort, callShort], maxUp: creditDollars, maxDown: -maxLossDollars },
        reasons: [
          "IV rank elevated — premiums richer",
          "Tight trading range past 30 days",
          `Risk fully defined — max loss ~$${maxLossDollars.toLocaleString()}`,
        ],
        cautions: [
          "Verify no earnings inside expiry window",
          `Estimate only — confirm actual fills in your broker chain (${putLong}/${putShort}/${callShort}/${callLong})`,
        ],
        exitPlan: [
          "Take profit at 50% of max credit",
          "Stop loss if debit hits 2× credit",
          "Manage if any short-strike delta exceeds 0.30",
          "Close 21 days before expiry",
        ],
        steps: [
          `Open ${ticker} options chain`,
          `Select expiry: ${expiry}`,
          `Sell 1 call at $${callShort}, Buy 1 call at $${callLong}`,
          `Sell 1 put at $${putShort}, Buy 1 put at $${putLong}`,
          `Order type: Limit near $${credit.toFixed(2)} credit`,
          "Submit as a single multi-leg combo order",
        ],
      };
    }
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

// Map a TradeType to its strategy slug so the subtitle stays consistent.
const TYPE_TO_STRATEGY: Record<TradeType, string> = {
  "stock": "long-stock",
  "long-call": "long-call",
  "long-put": "long-put",
  "short-premium": "cash-secured-put",
  "vertical": "bull-call-spread",
  "complex": "iron-condor",
};

function normalizeStrategyForType(strategyParam: string | null, type: TradeType): string {
  const fallback = TYPE_TO_STRATEGY[type];
  if (!strategyParam) return fallback;
  // Strategies that match the trade type are fine — otherwise fall back so we
  // never show "long call" with an "iron-condor" subtitle.
  const compat: Record<TradeType, string[]> = {
    "stock": ["long-stock", "stock", "swing", "breakout", "momentum", "vcp"],
    "long-call": ["long-call", "bullish", "momentum", "breakout"],
    "long-put": ["long-put", "bearish"],
    "short-premium": ["cash-secured-put", "csp", "covered-call", "wheel"],
    "vertical": ["bull-call-spread", "bear-put-spread", "vertical", "debit-spread", "credit-spread"],
    "complex": ["iron-condor", "iron-butterfly", "strangle", "straddle", "calendar"],
  };
  const allowed = compat[type] ?? [];
  return allowed.some((a) => strategyParam.toLowerCase().includes(a)) ? strategyParam : fallback;
}

export default function TradeDetailPage() {
  const params = useParams<{ ticker: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const sp = new URLSearchParams(search);
  const rawStrategy = sp.get("strategy");
  const type = (sp.get("type") || "stock") as TradeType;
  const ticker = (params.ticker || "AAPL").toUpperCase();
  const strategy = normalizeStrategyForType(rawStrategy, type);

  const { data: quote, isLoading: quoteLoading, isError: quoteError } = useQuery<QuoteResponse>({
    queryKey: ["/api/broker/quote", ticker],
    queryFn: async () => {
      const res = await fetch(`/api/broker/quote/${ticker}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Quote ${res.status}`);
      return res.json();
    },
    retry: false,
  });

  const livePrice = quote?.last ?? null;
  const fallbackPrice = 100;
  const planPrice = livePrice ?? fallbackPrice;

  const plan = useMemo(() => buildPlan(type, ticker, planPrice), [type, ticker, planPrice]);
  const score = 94;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  const scanResult = {
    ticker,
    price: planPrice,
    resistance: +(planPrice * 1.08).toFixed(2),
    stopLoss: +(planPrice * 0.94).toFixed(2),
    stage: "BREAKOUT",
    patternScore: score,
    rvol: 1.4,
    prefillTarget: +(planPrice * 0.94).toFixed(2),
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
                {livePrice != null && (
                  <span className="text-xs text-muted-foreground" data-testid="text-live-price">
                    Last: <span className="text-foreground font-medium">${livePrice.toFixed(2)}</span>
                  </span>
                )}
                {quoteLoading && (
                  <span className="text-xs text-muted-foreground">Fetching live price…</span>
                )}
              </div>
            </div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-base px-3 py-1">
            Score: {score}/100
          </Badge>
        </div>

        {(quoteError || livePrice == null) && !quoteLoading && (
          <Card className="p-3 border-amber-300 bg-amber-50 dark:bg-amber-950/20" data-testid="banner-no-live-price">
            <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                No live broker quote available for {ticker}. Strikes and prices below are
                <strong> illustrative only</strong> — connect your broker (Tradier or TradeStation)
                to compute strikes from the current market price, and always confirm actual prices
                in your broker's option chain before placing any order.
              </p>
            </div>
          </Card>
        )}

        {livePrice != null && type !== "stock" && (
          <Card className="p-3 border-sky-300 bg-sky-50 dark:bg-sky-950/20" data-testid="banner-estimate-disclaimer">
            <div className="flex items-start gap-2 text-xs text-sky-900 dark:text-sky-200">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Strikes and premiums shown are <strong>estimates</strong> derived from the current
                price (${livePrice.toFixed(2)}). Always confirm the actual chain quotes (bid/ask, IV,
                delta, OI) in your broker before submitting.
              </p>
            </div>
          </Card>
        )}

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
                ? `Profitable above $${plan.payoff.breakeven[0].toFixed(2)}`
                : type === "long-put"
                ? `Profitable below $${plan.payoff.breakeven[1].toFixed(2)}`
                : `Profit zone (green) between $${plan.payoff.breakeven[0].toFixed(2)} and $${plan.payoff.breakeven[1].toFixed(2)}`}
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
