import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  TrendingUp,
  Zap,
  Sun,
  Target,
  Sparkles,
  Crosshair,
  LineChart,
  ArrowRight,
  Loader2,
  CandlestickChart,
} from "lucide-react";

type StrategyType = "Momentum" | "Trend" | "Volatility" | "Intraday";

export type TradeType =
  | "stock"
  | "long-call"
  | "long-put"
  | "short-premium"
  | "vertical"
  | "complex";

interface TradeTypeOption {
  id: TradeType;
  label: string;
  short: string;
  desc: string;
}

const TRADE_TYPES: TradeTypeOption[] = [
  { id: "stock", label: "Stocks", short: "Stocks", desc: "Long or short shares — simplest." },
  { id: "long-call", label: "Long calls", short: "Long calls", desc: "Bullish single-leg, defined risk = premium." },
  { id: "long-put", label: "Long puts", short: "Long puts", desc: "Bearish single-leg, defined risk = premium." },
  { id: "short-premium", label: "Short premium", short: "Short premium", desc: "Sell single-leg calls/puts (CSP, covered call)." },
  { id: "vertical", label: "Vertical spreads", short: "Verticals", desc: "Two-leg debit or credit spreads." },
  { id: "complex", label: "Complex (condors, butterflies)", short: "Complex", desc: "Multi-leg, defined risk." },
];

interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  desc: string;
  conditions: string;
  timeframe: string;
  winRate: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  supports: TradeType[];
}

const STRATEGIES: Strategy[] = [
  { id: "volume-surge", name: "Volume Surge", type: "Momentum", desc: "Find tickers trading on unusual volume with breaking price levels.", conditions: "Volume > 2× avg", timeframe: "Daily", winRate: 68, icon: Activity, color: "bg-violet-100 text-violet-700", supports: ["stock", "long-call", "vertical"] },
  { id: "gap-force", name: "Gap Force", type: "Momentum", desc: "Pre-market gap-up names that hold their open and continue trending.", conditions: "Gap > 2%", timeframe: "Intraday", winRate: 64, icon: Zap, color: "bg-violet-100 text-violet-700", supports: ["stock", "long-call"] },
  { id: "precision-pullback", name: "Precision Pullback", type: "Trend", desc: "Strong trend pulling back to a key moving average — clean re-entry.", conditions: "Pullback to 20MA", timeframe: "Daily", winRate: 71, icon: TrendingUp, color: "bg-emerald-100 text-emerald-700", supports: ["stock", "long-call", "vertical"] },
  { id: "trend-pilot", name: "Trend Pilot", type: "Trend", desc: "Long-term uptrends with rising volume confirmation.", conditions: "Above 50/200MA", timeframe: "Weekly", winRate: 73, icon: LineChart, color: "bg-emerald-100 text-emerald-700", supports: ["stock", "long-call", "short-premium"] },
  { id: "iv-crush", name: "IV Crush Play", type: "Volatility", desc: "Short premium when implied vol is rich and likely to fall.", conditions: "IV rank > 70", timeframe: "Weekly", winRate: 76, icon: Sparkles, color: "bg-amber-100 text-amber-700", supports: ["short-premium", "vertical", "complex"] },
  { id: "iron-condor", name: "Iron Condor Hunter", type: "Volatility", desc: "Range-bound names with elevated IV — defined-risk credit setup.", conditions: "Range-bound · IV rank > 60", timeframe: "Monthly", winRate: 78, icon: Target, color: "bg-amber-100 text-amber-700", supports: ["complex", "vertical"] },
  { id: "downtrend-reversal", name: "Downtrend Reversal", type: "Trend", desc: "Weakening downtrends with bearish momentum cooling.", conditions: "Below 50MA · RSI < 40", timeframe: "Daily", winRate: 62, icon: CandlestickChart, color: "bg-rose-100 text-rose-700", supports: ["long-put", "vertical"] },
  { id: "opening-range", name: "Opening Range", type: "Intraday", desc: "Breakout above the first 30 minutes of the trading day.", conditions: "ORB break + volume", timeframe: "5-min", winRate: 62, icon: Sun, color: "bg-sky-100 text-sky-700", supports: ["stock", "long-call", "long-put"] },
  { id: "vwap-reclaim", name: "VWAP Reclaim", type: "Intraday", desc: "Oversold names reclaiming VWAP with strong order flow.", conditions: "Reclaim VWAP", timeframe: "15-min", winRate: 65, icon: Crosshair, color: "bg-sky-100 text-sky-700", supports: ["stock", "long-call"] },
];

interface ScanResult {
  ticker: string;
  name: string;
  score: number;
  winProb: number;
  reason: string;
}

const MOCK_RESULTS: ScanResult[] = [
  { ticker: "NVDA", name: "Nvidia Corp", score: 96, winProb: 74, reason: "Vol 3.8× avg · Breaking resistance" },
  { ticker: "META", name: "Meta Platforms", score: 89, winProb: 69, reason: "Vol 2.9× avg · News catalyst" },
  { ticker: "AMD",  name: "Advanced Micro Devices", score: 85, winProb: 67, reason: "Sector momentum · Holds key MA" },
  { ticker: "MU",   name: "Micron Technology", score: 82, winProb: 65, reason: "Earnings tailwind · Above 50MA" },
  { ticker: "TSLA", name: "Tesla", score: 78, winProb: 62, reason: "Vol 2.1× avg · Breaking range" },
  { ticker: "GOOGL", name: "Alphabet", score: 76, winProb: 61, reason: "Strong relative strength" },
  { ticker: "MSFT", name: "Microsoft", score: 74, winProb: 60, reason: "Tight base · Holds 20MA" },
  { ticker: "PLTR", name: "Palantir", score: 71, winProb: 59, reason: "Trending up · Volume confirms" },
  { ticker: "AAPL", name: "Apple", score: 68, winProb: 57, reason: "Range break · Volume stable" },
  { ticker: "CRWD", name: "CrowdStrike", score: 65, winProb: 55, reason: "Holding key support" },
];

const FILTERS: ("All" | StrategyType)[] = ["All", "Momentum", "Trend", "Volatility", "Intraday"];
const TYPE_KEY = "scanner_trade_types";

export default function StrategyScannerPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"All" | StrategyType>("All");
  const [tradeTypes, setTradeTypes] = useState<TradeType[]>(TRADE_TYPES.map((t) => t.id));
  const [selected, setSelected] = useState<Strategy>(STRATEGIES[0]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TYPE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr) && arr.length > 0) setTradeTypes(arr);
      }
    } catch {}
  }, []);

  const toggleType = (id: TradeType) => {
    setTradeTypes((prev) => {
      const next = prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      const safe = next.length === 0 ? [id] : next;
      try { localStorage.setItem(TYPE_KEY, JSON.stringify(safe)); } catch {}
      return safe;
    });
  };

  const filtered = useMemo(() => {
    return STRATEGIES.filter((s) => {
      const cat = filter === "All" || s.type === filter;
      const type = s.supports.some((t) => tradeTypes.includes(t));
      return cat && type;
    });
  }, [filter, tradeTypes]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.find((s) => s.id === selected.id)) {
      setSelected(filtered[0]);
    }
  }, [filtered, selected.id]);

  const select = (s: Strategy) => {
    setSelected(s);
    setRunning(true);
    setTimeout(() => setRunning(false), 700);
  };

  const preferredType = (s: Strategy): TradeType => {
    return s.supports.find((t) => tradeTypes.includes(t)) || s.supports[0];
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-medium" data-testid="text-scanner-title">Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick what you want to trade and a strategy. Run a scan. See ranked candidates instantly.
          </p>
        </div>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium">What do you want to trade?</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick one or more. Strategies that don't fit are hidden.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const all = TRADE_TYPES.map((t) => t.id);
                setTradeTypes(all);
                try { localStorage.setItem(TYPE_KEY, JSON.stringify(all)); } catch {}
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-reset-types"
            >
              Show all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRADE_TYPES.map((t) => {
              const active = tradeTypes.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  data-testid={`type-${t.id}`}
                  title={t.desc}
                  className={
                    "px-3 py-1.5 rounded-full text-xs transition-colors border " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted text-foreground/80 border-border")
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-testid={`filter-${f.toLowerCase()}`}
              className={
                "px-4 py-2 rounded-full text-sm transition-colors " +
                (filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 hover:bg-muted text-foreground/80 border border-border")
              }
            >
              {f === "All" ? "All strategies" : f}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No strategies match. Try selecting more trade types above.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((s) => {
              const isSelected = selected.id === s.id;
              return (
                <Card
                  key={s.id}
                  onClick={() => select(s)}
                  className={
                    "p-5 cursor-pointer transition-all hover-elevate " +
                    (isSelected ? "ring-2 ring-primary" : "")
                  }
                  data-testid={`card-strategy-${s.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center ${s.color}`}>
                      <s.icon className="h-4 w-4" />
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{s.type}</Badge>
                  </div>
                  <div className="mt-4 text-sm font-medium">{s.name}</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{s.desc}</p>
                  <div className="text-[11px] text-muted-foreground mt-3">
                    {s.conditions} · {s.timeframe}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.supports.map((t) => {
                      const meta = TRADE_TYPES.find((tt) => tt.id === t)!;
                      const active = tradeTypes.includes(t);
                      return (
                        <span
                          key={t}
                          className={
                            "text-[10px] px-1.5 py-0.5 rounded " +
                            (active
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {meta.short}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <span className="text-[11px] text-muted-foreground">{s.winRate}% hist. win rate</span>
                    <Button size="sm" variant={isSelected ? "default" : "outline"} className="h-7 text-xs">
                      {isSelected && running ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</>
                      ) : (
                        "Run scan"
                      )}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-medium" data-testid="text-results-strategy">
                {selected.name} results · as <span className="text-muted-foreground">{TRADE_TYPES.find((t) => t.id === preferredType(selected))?.short}</span>
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {MOCK_RESULTS.length} matches · updated 12s ago
            </span>
          </div>
          <div className="divide-y">
            {MOCK_RESULTS.map((r) => (
              <div
                key={r.ticker}
                className="grid grid-cols-12 items-center gap-3 py-3"
                data-testid={`row-result-${r.ticker}`}
              >
                <div className="col-span-3 md:col-span-3">
                  <div className="text-sm font-medium">{r.ticker}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                </div>
                <div className="hidden md:block md:col-span-4 text-xs text-muted-foreground">{r.reason}</div>
                <div className="col-span-3 md:col-span-2 text-right md:text-left">
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="text-sm font-medium">{r.score}</div>
                </div>
                <div className="col-span-3 md:col-span-2">
                  <div className="text-xs text-muted-foreground">Win prob</div>
                  <div className="text-sm font-medium">{r.winProb}%</div>
                </div>
                <div className="col-span-3 md:col-span-1 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => navigate(`/trade/${r.ticker}?strategy=${selected.id}&type=${preferredType(selected)}`)}
                    data-testid={`button-view-${r.ticker}`}
                  >
                    View <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
