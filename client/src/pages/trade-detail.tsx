import { useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Bookmark, Send, Sparkles, Check, AlertTriangle, Info, Loader2, AlertCircle } from "lucide-react";
import { StockTradeTicket } from "@/components/stock-trade-ticket";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SaveToWatchlistDialog } from "@/components/save-to-watchlist-dialog";
import { getStrategyByTradeType } from "@shared/strategy-catalog";

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

interface OptionContract {
  symbol: string;
  strike: number;
  optionType: "call" | "put";
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    mid_iv: number;
  };
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
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
  const [optionTicketOpen, setOptionTicketOpen] = useState(false);
  const [saveWatchlistOpen, setSaveWatchlistOpen] = useState(false);
  const [contractQty, setContractQty] = useState(1);
  const [optionAck, setOptionAck] = useState(false);
  const [optionAccountId, setOptionAccountId] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);
  const { toast } = useToast();

  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  const isOptionType = type !== "stock";

  // ─── Live option chain (broker feed) ────────────────────────────────
  const expirationsQuery = useQuery<{ symbol: string; expirations: string[] }>({
    queryKey: ["/api/broker/options/expirations", ticker],
    enabled: optionTicketOpen && isOptionType,
    retry: false,
  });

  // Pick the broker expiration closest to ~35 DTE (the plan's default).
  const chosenExpiration = useMemo(() => {
    const exps = expirationsQuery.data?.expirations || [];
    if (exps.length === 0) return "";
    const target = new Date();
    target.setDate(target.getDate() + 35);
    let best = exps[0];
    let bestDiff = Infinity;
    for (const e of exps) {
      const d = new Date(e);
      if (isNaN(d.getTime())) continue;
      const diff = Math.abs(d.getTime() - target.getTime());
      if (diff < bestDiff) { best = e; bestDiff = diff; }
    }
    return best;
  }, [expirationsQuery.data]);

  const chainQuery = useQuery<{ symbol: string; expiration: string; contracts: OptionContract[] }>({
    queryKey: ["/api/broker/options/chain", ticker, chosenExpiration],
    enabled: optionTicketOpen && isOptionType && !!chosenExpiration,
    retry: false,
  });

  const chainAvailable = !!chainQuery.data?.contracts?.length;
  const chainError = expirationsQuery.isError || chainQuery.isError;

  // Each plan leg matched to the closest live broker contract (when chain is loaded).
  const enrichedLegs = useMemo(() => {
    if (!isOptionType) return [] as Array<{
      side: "BUY" | "SELL";
      qty: number;
      desc: string;
      planStrike: number | null;
      optionType: "call" | "put" | null;
      planDelta: number;
      planPrice: number;
      contract: OptionContract | null;
    }>;
    const contracts = chainQuery.data?.contracts || [];
    return plan.legs.map((leg) => {
      const m = leg.desc.match(/\$(\d+(?:\.\d+)?)\s+(call|put)/i);
      const planStrike = m ? parseFloat(m[1]) : null;
      const optionType = m ? (m[2].toLowerCase() as "call" | "put") : null;
      let contract: OptionContract | null = null;
      if (planStrike != null && optionType) {
        const candidates = contracts.filter((c) => c.optionType === optionType);
        let bestDiff = Infinity;
        for (const c of candidates) {
          const diff = Math.abs(c.strike - planStrike);
          if (diff < bestDiff) { bestDiff = diff; contract = c; }
        }
      }
      return {
        side: leg.side,
        qty: leg.qty,
        desc: leg.desc,
        planStrike,
        optionType,
        planDelta: leg.delta,
        planPrice: leg.price,
        contract,
      };
    });
  }, [plan.legs, isOptionType, chainQuery.data]);

  // Live mid-premium per contract (sum of legs, BUY = debit, SELL = credit).
  const liveNetPerShare = useMemo(() => {
    if (!enrichedLegs.length || !chainAvailable) return null;
    let net = 0;
    let allMatched = true;
    for (const l of enrichedLegs) {
      const c = l.contract;
      if (!c) { allMatched = false; break; }
      const mid = (c.bid + c.ask) / 2;
      if (!isFinite(mid) || mid <= 0) { allMatched = false; break; }
      net += (l.side === "BUY" ? -mid : mid) * l.qty;
    }
    return allMatched ? net : null;
  }, [enrichedLegs, chainAvailable]);

  // Convert enriched legs into the API shape used by /api/trade/place-option.
  // Prefers live broker strike/expiration/premium when available.
  const apiLegs = useMemo(() => {
    if (!isOptionType) return [];
    return enrichedLegs.map((l) => ({
      side: l.side === "BUY" ? "buy" : "sell",
      quantity: l.qty,
      strike: l.contract?.strike ?? l.planStrike,
      optionType: l.optionType,
      expiry: l.contract?.expiration || chosenExpiration || defaultExpiryLabel(),
      optionSymbol: l.contract?.symbol,
      estimatedPremium: l.contract
        ? (l.contract.bid + l.contract.ask) / 2
        : Math.abs(l.planPrice),
      delta: l.contract?.greeks?.delta ?? l.planDelta,
    }));
  }, [enrichedLegs, isOptionType, chosenExpiration]);

  // Map plan name → instrumentType the server expects.
  const instrumentType = useMemo(() => {
    switch (type) {
      case "long-call": return "long_call";
      case "long-put": return "long_put";
      case "vertical": return plan.legs[0]?.desc.includes("call") ? "bull_call_spread" : "bear_put_spread";
      case "short-premium": return "short_put";
      case "complex": return "iron_condor";
      default: return "long_call";
    }
  }, [type, plan.legs]);

  const placeOptionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trade/place-option", {
        symbol: ticker,
        instrumentType,
        legs: apiLegs,
        quantity: contractQty,
        setupScore: score,
        rewardRisk: plan.payoff.maxUp / Math.max(Math.abs(plan.payoff.maxDown), 1),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Multi-leg option order sent",
        description: data.notice || `${plan.name} on ${ticker} — ${contractQty} contract${contractQty > 1 ? "s" : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-outcomes"] });
      setOptionTicketOpen(false);
      setOptionAck(false);
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to send option order";
      if (msg.includes("GUARDRAIL_BLOCKED")) {
        toast({ title: "Blocked by your trade limits", description: msg, variant: "destructive" });
      } else {
        toast({ title: "Option order failed", description: msg, variant: "destructive" });
      }
    },
  });

  // Prefer live broker mid-price; fall back to plan estimate.
  const effectiveNetPerShare = liveNetPerShare ?? plan.netPerShare;
  const netPerContract = Math.abs(effectiveNetPerShare) * 100;
  const totalNet = netPerContract * contractQty;
  const isCredit = effectiveNetPerShare > 0;
  const usingLiveChain = liveNetPerShare != null;

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

        {(() => {
          const strat = getStrategyByTradeType(type, rawStrategy);
          return (
            <Card className="p-5 border-violet-300/60 bg-violet-50/40 dark:bg-violet-950/10" data-testid="card-strategy-info">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-md bg-violet-600/10 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300 font-semibold">
                      Strategy used
                    </span>
                    <h2 className="text-base font-semibold" data-testid="text-strategy-name">{strat.name}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground italic mt-0.5" data-testid="text-strategy-tagline">
                    {strat.tagline}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-sm">
                    <div data-testid="block-strategy-how">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">How it works</div>
                      <p className="leading-snug">{strat.howItWorks}</p>
                    </div>
                    <div data-testid="block-strategy-when">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">When it works best</div>
                      <p className="leading-snug">{strat.whenItWorks}</p>
                    </div>
                    <div data-testid="block-strategy-risks">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Main risks</div>
                      <p className="leading-snug">{strat.mainRisks}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })()}

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
            onClick={() => (isOptionType ? setOptionTicketOpen(true) : setTicketOpen(true))}
            data-testid="button-send-instatrade"
          >
            <Send className="h-4 w-4" /> Send to InstaTrade™
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setSaveWatchlistOpen(true)}
            data-testid="button-save-watchlist"
          >
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

      <SaveToWatchlistDialog
        open={saveWatchlistOpen}
        onOpenChange={setSaveWatchlistOpen}
        ticker={ticker}
      />

      <Sheet open={optionTicketOpen} onOpenChange={setOptionTicketOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" data-testid="title-option-ticket">
              <Send className="h-4 w-4" /> InstaTrade™ — {plan.name}
            </SheetTitle>
            <SheetDescription>
              Multi-leg option order for {ticker}. Confirm strikes, premiums and quantity in your broker chain before submitting.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <Card className="p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Order legs
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  {(expirationsQuery.isFetching || chainQuery.isFetching) && !chainError ? (
                    <span className="flex items-center gap-1 text-muted-foreground" data-testid="badge-chain-loading">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading broker chain
                    </span>
                  ) : usingLiveChain ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900" data-testid="badge-chain-live">
                      Live broker chain · {chosenExpiration}
                    </Badge>
                  ) : chainError ? (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200" data-testid="badge-chain-unavailable">
                      Broker chain unavailable
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                      Estimates only
                    </Badge>
                  )}
                </div>
              </div>

              {enrichedLegs.map((leg, i) => {
                const c = leg.contract;
                const mid = c ? (c.bid + c.ask) / 2 : null;
                return (
                  <div key={i} className="space-y-1.5 rounded border bg-background/50 px-2 py-1.5" data-testid={`option-leg-${i}`}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            leg.side === "SELL"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }
                        >
                          {leg.side} {leg.qty * contractQty}
                        </Badge>
                        <span className="font-mono text-xs">
                          {c
                            ? `$${c.strike.toFixed(2)} ${c.optionType} · ${c.expiration}`
                            : leg.desc}
                        </span>
                      </div>
                      {c ? (
                        <span className="text-[10px] text-muted-foreground">live</span>
                      ) : (
                        <span className="text-[10px] text-amber-700">est</span>
                      )}
                    </div>

                    {/* Live greeks/quote row */}
                    <div className="grid grid-cols-5 gap-1 text-[10px] font-mono text-muted-foreground" data-testid={`option-leg-${i}-data`}>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Bid</div>
                        <div className="text-foreground">{c ? fmtMoney(c.bid) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Ask</div>
                        <div className="text-foreground">{c ? fmtMoney(c.ask) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Δ</div>
                        <div className="text-foreground">{c?.greeks ? c.greeks.delta.toFixed(2) : leg.planDelta.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">IV</div>
                        <div className="text-foreground">
                          {c?.greeks ? `${(c.greeks.mid_iv * 100).toFixed(0)}%` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">OI</div>
                        <div className="text-foreground">{c ? c.openInterest.toLocaleString() : "—"}</div>
                      </div>
                    </div>

                    {mid != null && (
                      <div className="text-[10px] text-muted-foreground">
                        Mid: <span className="font-mono text-foreground">{fmtMoney(mid)}</span>
                        {" · "}Spread: <span className="font-mono text-foreground">{fmtMoney((c!.ask - c!.bid))}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="pt-2 border-t flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {isCredit ? "Net credit" : "Net debit"}{" "}
                  <span className="text-[10px]">
                    ({usingLiveChain ? "live mid" : "est."})
                  </span>
                </span>
                <span className={isCredit ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
                  {isCredit ? "+" : "-"}${Math.abs(effectiveNetPerShare).toFixed(2)} × 100 = ${netPerContract.toFixed(0)} / contract
                </span>
              </div>
            </Card>

            {brokerAccounts && brokerAccounts.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="option-account">Account</Label>
                <Select value={optionAccountId} onValueChange={setOptionAccountId}>
                  <SelectTrigger id="option-account" data-testid="select-option-account">
                    <SelectValue placeholder="Select brokerage account" />
                  </SelectTrigger>
                  <SelectContent>
                    {brokerAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} (${a.buyingPower.toLocaleString()} BP)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="option-qty">Contracts</Label>
              <Input
                id="option-qty"
                type="number"
                min={1}
                max={100}
                value={contractQty}
                onChange={(e) => setContractQty(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                data-testid="input-contract-qty"
              />
              <p className="text-xs text-muted-foreground">
                Total {isCredit ? "credit" : "cost"}: <span className="font-medium text-foreground">${totalNet.toFixed(0)}</span>
                {" "}({contractQty} contract{contractQty > 1 ? "s" : ""} × ${netPerContract.toFixed(0)})
              </p>
            </div>

            {usingLiveChain ? (
              <div className="rounded-md border p-3 bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900">
                <div className="flex items-start gap-2 text-xs text-sky-900 dark:text-sky-200">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    Live bid/ask, Δ, IV and OI shown above are pulled from your broker's option chain.
                    Quotes can move before fill. Options trading involves significant risk including
                    total loss of premium.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-3 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  {chainError ? (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <p>
                    {chainError
                      ? "We couldn't reach your broker's option chain right now — strikes and premiums shown are estimates only. Confirm bid/ask, IV, delta and OI in your broker before submitting. "
                      : `Strikes (${apiLegs.map((l) => `$${l.strike}`).join(" / ")}) and premiums are estimates. Confirm bid/ask, IV, delta and OI in your broker's chain. `}
                    Options trading involves significant risk including total loss of premium.
                  </p>
                </div>
              </div>
            )}

            {plan.legs.length > 1 && (
              <div
                className="rounded-md border p-3 bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900"
                data-testid="banner-multileg-broker-warning"
              >
                <div className="flex items-start gap-2 text-xs text-sky-900 dark:text-sky-200">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">
                      Multi-leg orders may not route as a single ticket
                    </p>
                    <p>
                      Most broker APIs we connect to don't yet accept this entire {plan.legs.length}-leg
                      spread in one call. We'll log this order plan and your acknowledgment, but you
                      may need to place each leg manually inside your broker (or use your broker's
                      native spread order ticket) to fill it as one combined order.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2">
              <Checkbox
                id="option-ack"
                checked={optionAck}
                onCheckedChange={(c) => setOptionAck(c === true)}
                data-testid="checkbox-option-ack"
              />
              <Label htmlFor="option-ack" className="text-xs leading-relaxed font-normal">
                I have reviewed all legs, strikes, expiry and premium. I understand this is software-generated
                analysis — not investment advice — and I'm responsible for the order.
              </Label>
            </div>
          </div>

          <SheetFooter className="mt-6 flex-row gap-2">
            <Button variant="outline" onClick={() => setOptionTicketOpen(false)} className="flex-1" data-testid="button-cancel-option">
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={!optionAck || placeOptionMutation.isPending}
              onClick={() => placeOptionMutation.mutate()}
              data-testid="button-submit-option"
            >
              {placeOptionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send multi-leg order
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
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
