import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { HelpLink } from "@/components/help-link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  Layers,
  Compass,
  Gauge,
  Info,
  Check,
  AlertTriangle,
} from "lucide-react";

type StrategyCategory = "Momentum" | "Trend" | "Volatility" | "Intraday" | "Options";

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
  category: StrategyCategory;
  desc: string;
  conditions: string;
  timeframe: string;
  winRate: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  supports: TradeType[];
  guide: {
    whatItLooksFor: string;
    howItWorks: string[];
    triggers: string[];
    riskExit: string[];
    bestFor: string;
  };
}

const STRATEGIES: Strategy[] = [
  // Momentum Engine — from shared/strategies.ts
  {
    id: "momentum-breakout",
    name: "Momentum Breakout",
    category: "Momentum",
    desc: "Intraday contraction breakouts with trend and volume confirmation.",
    conditions: "EMA9 > EMA21 · ATR contracting",
    timeframe: "Intraday",
    winRate: 68,
    icon: Zap,
    color: "bg-violet-100 text-violet-700",
    supports: ["stock", "long-call", "vertical"],
    guide: {
      whatItLooksFor: "Same-day volatility contraction patterns (a tightening price coil) that often precede a momentum breakout.",
      howItWorks: [
        "Price trades above both the 9 and 21 EMA on the intraday chart",
        "Volatility contracts — ATR steadily decreasing while volume dries up",
        "A clear horizontal resistance forms near recent intraday highs",
        "Pattern stage progresses through ACCUMULATION → READY → BREAKOUT",
      ],
      triggers: [
        "Price breaks above the intraday resistance with conviction",
        "Volume surges 50%+ above the rolling average on the breakout candle",
        "Stage flips to BREAKOUT in the live scanner",
      ],
      riskExit: [
        "Stop just below the last consolidation low",
        "Exit when price closes back below the 9 EMA",
        "Typical risk: 3–5% from entry",
      ],
      bestFor: "Active day-trading sessions with a clear market trend.",
    },
  },
  {
    id: "power-breakout",
    name: "Power Breakout",
    category: "Momentum",
    desc: "Multi-day VCP bases (T1/T2/T3) breaking out for swing & position trades.",
    conditions: "Multi-day VCP · 30+ days history",
    timeframe: "Daily",
    winRate: 72,
    icon: Layers,
    color: "bg-violet-100 text-violet-700",
    supports: ["stock", "long-call", "vertical"],
    guide: {
      whatItLooksFor: "A multi-week 'volatility contraction pattern' — each base tighter than the last — building energy for an explosive breakout.",
      howItWorks: [
        "30+ trading days of historical context analyzed",
        "Multiple contracting bases stack on top of each other",
        "EMA 9 confirms uptrend by sitting above EMA 21",
        "A pivot point is set at the high of the most recent contraction",
      ],
      triggers: [
        "A daily close above the pivot level",
        "Volume expands 1.5×+ average on the breakout day",
        "Pattern is confirmed with at least a +1% daily gain",
      ],
      riskExit: [
        "Stop just below the last contraction low",
        "Exit if daily close goes below the 21 EMA",
        "Typical risk: 5–10% from entry",
      ],
      bestFor: "Swing and position traders willing to hold for days/weeks.",
    },
  },
  {
    id: "open-drive-5m",
    name: "Open Drive (5m)",
    category: "Intraday",
    desc: "Five-minute opening range breakouts with volume expansion.",
    conditions: "ORB 5m + volume",
    timeframe: "5-min",
    winRate: 62,
    icon: Sun,
    color: "bg-sky-100 text-sky-700",
    supports: ["stock", "long-call", "long-put"],
    guide: {
      whatItLooksFor: "A breakout from the very first 5 minutes of the trading day, when fast money commits direction.",
      howItWorks: [
        "Wait for the first 5 minutes to set the opening range high/low",
        "Watch price coil near the upper or lower edge",
        "Confirm above-average pre-market or opening volume",
      ],
      triggers: [
        "Price breaks above the 5m opening range high",
        "Volume confirms with a 1.5×+ expansion",
        "Breakout sustains for at least 1 minute past the trigger",
      ],
      riskExit: [
        "Stop below the 5m range low",
        "Exit on the first sign of momentum failure or VWAP loss",
        "Typical risk: 1–2% from entry",
      ],
      bestFor: "First-30-minute day traders.",
    },
  },
  {
    id: "open-drive-15m",
    name: "Open Drive (15m)",
    category: "Intraday",
    desc: "Fifteen-minute opening range breakouts — slower, more reliable.",
    conditions: "ORB 15m + volume",
    timeframe: "15-min",
    winRate: 66,
    icon: Compass,
    color: "bg-sky-100 text-sky-700",
    supports: ["stock", "long-call", "long-put"],
    guide: {
      whatItLooksFor: "A more deliberate breakout once the first 15 minutes have established a true range.",
      howItWorks: [
        "Opening range is set after the first 15 minutes",
        "Greater reliability than the 5-minute ORB",
        "Volume accumulates during the opening period",
        "Trend should align with the daily-chart direction",
      ],
      triggers: [
        "Price clears the 15m opening range high",
        "Volume confirms with sustained expansion",
        "Price holds above the breakout level for confirmation",
      ],
      riskExit: [
        "Stop below the 15m range low or midpoint",
        "Exit on a VWAP break or close below range midpoint",
        "Typical risk: 1–3% from entry",
      ],
      bestFor: "Day traders who prefer a calmer, higher-conviction entry.",
    },
  },
  {
    id: "volume-surge",
    name: "Volume Surge",
    category: "Momentum",
    desc: "High relative-volume breakouts from tight consolidations.",
    conditions: "RVOL > 2× · Tight base",
    timeframe: "Daily",
    winRate: 70,
    icon: Activity,
    color: "bg-violet-100 text-violet-700",
    supports: ["stock", "long-call", "vertical"],
    guide: {
      whatItLooksFor: "Stocks suddenly trading on unusual volume while breaking out of a quiet base.",
      howItWorks: [
        "Relative volume sits at 2×+ normal levels",
        "Price was in a tight consolidation just before the volume spike",
        "No negative news catalyst (e.g. earnings miss)",
        "Sector / market backdrop is supportive",
      ],
      triggers: [
        "RVOL crosses the threshold while price breaks out",
        "Price clears the consolidation resistance",
        "Volume keeps accelerating after the breakout",
      ],
      riskExit: [
        "Stop below the consolidation range low",
        "Exit when volume fades and price stalls",
        "Typical risk: 3–5% from entry",
      ],
      bestFor: "Catching catalyst-driven moves early.",
    },
  },
  {
    id: "gap-force",
    name: "Gap Force",
    category: "Momentum",
    desc: "Pre-market gap-up names that hold their open and continue trending.",
    conditions: "Gap > 3% · Holds VWAP",
    timeframe: "Intraday",
    winRate: 64,
    icon: Gauge,
    color: "bg-violet-100 text-violet-700",
    supports: ["stock", "long-call"],
    guide: {
      whatItLooksFor: "Stocks gapping up on real catalysts that have the momentum to continue rather than fade.",
      howItWorks: [
        "Gap of 3%+ from the previous close",
        "Heavy pre-market volume showing real interest",
        "A positive catalyst (earnings, news, sector lift)",
        "Price holds above VWAP in the early session",
      ],
      triggers: [
        "Gap holds and price clears the pre-market high",
        "First pullback to VWAP is bought",
        "Volume stays elevated above average",
      ],
      riskExit: [
        "Stop below VWAP or the gap-fill level",
        "Exit on a failed breakout or VWAP loss",
        "Typical risk: 2–4% from entry",
      ],
      bestFor: "Open-bell momentum traders.",
    },
  },
  // Trend Engine
  {
    id: "precision-pullback",
    name: "Precision Pullback",
    category: "Trend",
    desc: "Shallow pullbacks in an uptrend offering tight-risk re-entries.",
    conditions: "Pullback to EMA 9/21",
    timeframe: "Daily",
    winRate: 71,
    icon: TrendingUp,
    color: "bg-emerald-100 text-emerald-700",
    supports: ["stock", "long-call", "vertical"],
    guide: {
      whatItLooksFor: "A strong uptrend that's pulling back to a moving-average support — a clean spot to re-enter the trend.",
      howItWorks: [
        "Strong uptrend with EMA 9 above EMA 21",
        "Price retraces to or near EMA 9 / EMA 21 support",
        "Pullback is shallow (typically under 10% from recent high)",
        "Volume declines while price pulls back",
      ],
      triggers: [
        "Bounce off EMA support with volume confirmation",
        "Breakout above a short-term consolidation inside the pullback",
        "Momentum oscillators turning back up",
      ],
      riskExit: [
        "Stop below the pullback low or EMA 21",
        "Exit when EMA 9 crosses below EMA 21 (trend break)",
        "Typical risk: 3–6% from entry",
      ],
      bestFor: "Swing traders looking for low-risk entries in established trends.",
    },
  },
  {
    id: "trend-pilot",
    name: "Trend Pilot",
    category: "Trend",
    desc: "Long-term uptrends with orderly pullbacks to MA structure.",
    conditions: "EMAs stacked 9>21>50",
    timeframe: "Weekly",
    winRate: 73,
    icon: LineChart,
    color: "bg-emerald-100 text-emerald-700",
    supports: ["stock", "long-call", "short-premium"],
    guide: {
      whatItLooksFor: "Established trends across multiple timeframes pulling back to a major MA — a high-conviction continuation entry.",
      howItWorks: [
        "Clear uptrend on multiple timeframes",
        "Moving averages stacked bullishly: EMA 9 > 21 > 50",
        "Recent pullback into the 21 or 50 EMA",
        "RSI not overbought at the entry zone",
      ],
      triggers: [
        "Price reclaims the short-term MA after testing it",
        "A higher low forms during the pullback",
        "Volume picks up on the resumption candle",
      ],
      riskExit: [
        "Stop below the 50 EMA or the recent swing low",
        "Exit on a trendline break or MA crossover",
        "Typical risk: 4–8% from entry",
      ],
      bestFor: "Position traders riding multi-week trends.",
    },
  },
  {
    id: "institutional-reclaim",
    name: "Institutional Reclaim",
    category: "Trend",
    desc: "Intraday VWAP reclaims signaling pro accumulation.",
    conditions: "Reclaim VWAP + volume",
    timeframe: "15-min",
    winRate: 65,
    icon: Crosshair,
    color: "bg-emerald-100 text-emerald-700",
    supports: ["stock", "long-call"],
    guide: {
      whatItLooksFor: "Intraday VWAP reclaims that often signal real institutional buying interest stepping in.",
      howItWorks: [
        "Price was trading below VWAP earlier in the session",
        "A strong reversal candle reclaims VWAP",
        "Volume increases on the reclaim move",
        "The daily chart is in an uptrend or at support",
      ],
      triggers: [
        "Price closes above VWAP after being below",
        "VWAP holds as support on the retest",
        "Continuation higher on sustained volume",
      ],
      riskExit: [
        "Stop below the low of the reclaim candle",
        "Exit if VWAP is lost again with volume",
        "Typical risk: 1–3% from entry",
      ],
      bestFor: "Intraday trend traders.",
    },
  },
  // Volatility Engine
  {
    id: "pressure-break",
    name: "Pressure Break",
    category: "Volatility",
    desc: "Bollinger/Keltner squeeze setups — catching the expansion.",
    conditions: "BB inside Keltner",
    timeframe: "Daily",
    winRate: 67,
    icon: Sparkles,
    color: "bg-amber-100 text-amber-700",
    supports: ["stock", "long-call", "long-put", "vertical"],
    guide: {
      whatItLooksFor: "Extreme volatility compression (a Bollinger-Band squeeze) that historically precedes a sharp expansion move.",
      howItWorks: [
        "Bollinger Bands narrow to a multi-period low",
        "Keltner Channel sits *inside* the Bollinger Bands — the squeeze signal",
        "ATR keeps decreasing, confirming compression",
        "Price coils near a key level",
      ],
      triggers: [
        "The squeeze fires and price breaks directionally",
        "Price clears the compression range high or low",
        "Volume expansion confirms direction",
      ],
      riskExit: [
        "Stop on the opposite side of the compression range",
        "Exit when volatility contracts again or trend fails",
        "Typical risk: 2–5% from entry",
      ],
      bestFor: "Swing traders patient enough to wait for the squeeze to fire.",
    },
  },
  // Options-focused (newly added)
  {
    id: "iv-crush",
    name: "IV Crush Play",
    category: "Options",
    desc: "Sell premium when implied vol is rich and likely to fall.",
    conditions: "IV rank > 70",
    timeframe: "Weekly",
    winRate: 76,
    icon: Sparkles,
    color: "bg-amber-100 text-amber-700",
    supports: ["short-premium", "vertical", "complex"],
    guide: {
      whatItLooksFor: "Names where implied volatility is unusually elevated (often around earnings or events) and statistically likely to revert lower.",
      howItWorks: [
        "Implied-volatility rank sits above the 70th percentile",
        "Underlying isn't trending hard against the position",
        "Liquid options chain with reasonable bid/ask spreads",
        "Defined-risk structures preferred to cap losses",
      ],
      triggers: [
        "Open the position when IV is elevated and trend is sideways",
        "Look for earnings or event catalysts that often cause IV crush",
      ],
      riskExit: [
        "Take profit at 50% of max credit",
        "Cut losses at 2× credit received",
        "Manage at 21 days to expiration to avoid gamma risk",
      ],
      bestFor: "Premium sellers comfortable managing options positions.",
    },
  },
  {
    id: "iron-condor",
    name: "Iron Condor Hunter",
    category: "Options",
    desc: "Range-bound names with elevated IV — defined-risk credit setup.",
    conditions: "Range-bound · IV rank > 60",
    timeframe: "Monthly",
    winRate: 78,
    icon: Target,
    color: "bg-amber-100 text-amber-700",
    supports: ["complex", "vertical"],
    guide: {
      whatItLooksFor: "Tickers stuck in a clean trading range with rich premium — perfect candidates for a defined-risk neutral options position.",
      howItWorks: [
        "Underlying has been range-bound the past 30 days",
        "IV rank is above 60 (premiums are juicy)",
        "Both shorts placed at ~16-delta (1 standard deviation)",
        "Long wings 3–5 strikes away cap the risk",
      ],
      triggers: [
        "Open 30–45 days to expiration",
        "Target net credit equal to ~⅓ of the wing width",
      ],
      riskExit: [
        "Take profit at 50% of max credit",
        "Defend the tested side if a short strike's delta exceeds 0.30",
        "Exit by 21 days to expiration",
      ],
      bestFor: "Income-focused options traders in choppy markets.",
    },
  },
  {
    id: "downtrend-reversal",
    name: "Downtrend Reversal",
    category: "Trend",
    desc: "Weakening downtrends with bearish momentum cooling — long-put setups.",
    conditions: "Below 50MA · RSI < 40",
    timeframe: "Daily",
    winRate: 62,
    icon: CandlestickChart,
    color: "bg-rose-100 text-rose-700",
    supports: ["long-put", "vertical"],
    guide: {
      whatItLooksFor: "Names breaking down through key support where put premiums are reasonable and risk:reward favors a directional bearish play.",
      howItWorks: [
        "Price breaks below the 50-day moving average",
        "RSI rolls under 40 confirming bearish momentum",
        "Volume expands on the breakdown",
        "Sector / market backdrop is also weak",
      ],
      triggers: [
        "Failed retest of the broken support zone",
        "Lower-high pattern forms after the breakdown",
      ],
      riskExit: [
        "Stop above the failed retest high",
        "Take profit at the next major support level",
        "Typical risk: 3–6% from entry",
      ],
      bestFor: "Bearish traders preferring defined-risk put structures.",
    },
  },
];

const FILTERS: ("All" | StrategyCategory)[] = ["All", "Momentum", "Trend", "Volatility", "Intraday", "Options"];
const TYPE_KEY = "scanner_trade_types";

interface ScanResult {
  ticker: string;
  name: string;
  score: number;
  winProb: number;
  reason: string;
  rvol?: number | null;
  changePercent?: number | null;
  stage?: string | null;
  price?: number | null;
}

type SortKey = "score" | "winProb" | "ticker" | "rvol";

function buildLiveReason(r: any, fallback: string): string {
  const parts: string[] = [];
  if (typeof r.rvol === "number" && r.rvol > 0) parts.push(`RVOL ${r.rvol.toFixed(1)}×`);
  if (typeof r.changePercent === "number") {
    const sign = r.changePercent >= 0 ? "+" : "";
    parts.push(`${sign}${r.changePercent.toFixed(2)}%`);
  }
  if (r.stage && typeof r.stage === "string") {
    const pretty = r.stage.replace(/_/g, " ").toLowerCase();
    parts.push(pretty);
  }
  return parts.length ? parts.join(" · ") : fallback;
}

// Maps the UI strategy card → the backend StrategyType the live scan accepts.
const STRATEGY_BACKEND_MAP: Record<string, string> = {
  "momentum-breakout": "VCP",
  "power-breakout": "VCP_MULTIDAY",
  "open-drive-5m": "ORB5",
  "open-drive-15m": "ORB15",
  "volume-surge": "HIGH_RVOL",
  "gap-force": "GAP_AND_GO",
  "precision-pullback": "CLASSIC_PULLBACK",
  "trend-pilot": "TREND_CONTINUATION",
  "institutional-reclaim": "VWAP_RECLAIM",
  "pressure-break": "VOLATILITY_SQUEEZE",
  "iv-crush": "VOLATILITY_SQUEEZE",
  "iron-condor": "VOLATILITY_SQUEEZE",
  "downtrend-reversal": "CLASSIC_PULLBACK",
};

// Universe used to seed per-strategy fallback results when no broker is connected.
const UNIVERSE: { ticker: string; name: string }[] = [
  { ticker: "NVDA", name: "Nvidia Corp" },
  { ticker: "META", name: "Meta Platforms" },
  { ticker: "AMD", name: "Advanced Micro Devices" },
  { ticker: "MU", name: "Micron Technology" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "GOOGL", name: "Alphabet" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "PLTR", name: "Palantir" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "CRWD", name: "CrowdStrike" },
  { ticker: "AVGO", name: "Broadcom" },
  { ticker: "AMZN", name: "Amazon" },
  { ticker: "NFLX", name: "Netflix" },
  { ticker: "SHOP", name: "Shopify" },
  { ticker: "SMCI", name: "Super Micro Computer" },
  { ticker: "COIN", name: "Coinbase" },
  { ticker: "UBER", name: "Uber" },
  { ticker: "ARM", name: "Arm Holdings" },
  { ticker: "ORCL", name: "Oracle" },
  { ticker: "QCOM", name: "Qualcomm" },
  { ticker: "MRVL", name: "Marvell Technology" },
  { ticker: "ADBE", name: "Adobe" },
  { ticker: "DIS", name: "Disney" },
  { ticker: "BA", name: "Boeing" },
  { ticker: "XOM", name: "Exxon Mobil" },
  { ticker: "JPM", name: "JPMorgan Chase" },
];

function strategyReason(strategyId: string): string {
  switch (strategyId) {
    case "momentum-breakout": return "EMA9 > EMA21 · ATR contracting";
    case "power-breakout": return "Multi-week VCP base · pivot reclaim";
    case "open-drive-5m": return "5m ORB break · vol 1.6× avg";
    case "open-drive-15m": return "15m ORB break · holding above";
    case "volume-surge": return "RVOL 2.4× · tight base";
    case "gap-force": return "Gap +3.2% · holding VWAP";
    case "precision-pullback": return "Pullback to EMA9 · bounce";
    case "trend-pilot": return "EMAs stacked 9>21>50 · weekly up";
    case "institutional-reclaim": return "VWAP reclaim on volume";
    case "pressure-break": return "BB inside Keltner · squeeze fired";
    case "iv-crush": return "IV rank 78 · earnings premium";
    case "iron-condor": return "Range-bound 30d · IV rank 64";
    case "downtrend-reversal": return "Below 50MA · RSI 36";
    default: return "Pattern conditions met";
  }
}

// Deterministic FNV-1a-ish hash, stable per strategyId.
function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function timeAgo(d: Date): string {
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `updated ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `updated ${min}m ago`;
  const hr = Math.floor(min / 60);
  return `updated ${hr}h ago`;
}

function generateFallbackResults(strategyId: string, count = 7): ScanResult[] {
  const rand = mulberry32(seedFromString(strategyId));
  const pool = UNIVERSE.slice();
  // Fisher-Yates shuffle with seeded RNG.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const reason = strategyReason(strategyId);
  return pool.slice(0, count).map((p, idx) => {
    const score = Math.round(95 - idx * 3 - rand() * 4);
    const winProb = Math.max(45, Math.min(80, Math.round(score * 0.72 + rand() * 6)));
    return { ticker: p.ticker, name: p.name, score, winProb, reason };
  });
}

interface ScanResponseMeta {
  isLive: boolean;
  provider?: string;
  symbolsRequested?: number;
  symbolsReturned?: number;
  scanTimeMs?: number;
  marketSession?: string;
  source: "live" | "fallback";
  error?: string;
}

export default function StrategyScannerPage() {
  const [, navigate] = useLocation();
  const { isConnected } = useBrokerStatus();
  const [filter, setFilter] = useState<"All" | StrategyCategory>("All");
  const [tradeTypes, setTradeTypes] = useState<TradeType[]>(TRADE_TYPES.map((t) => t.id));
  const [selected, setSelected] = useState<Strategy>(STRATEGIES[0]);
  const [results, setResults] = useState<ScanResult[]>(() => generateFallbackResults(STRATEGIES[0].id));
  const [meta, setMeta] = useState<ScanResponseMeta>({ isLive: false, source: "fallback" });
  const [lastScanAt, setLastScanAt] = useState<Date>(new Date());
  const [guideStrategy, setGuideStrategy] = useState<Strategy | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");

  const visibleResults = useMemo(() => {
    const q = search.trim().toUpperCase();
    const filtered = q
      ? results.filter(
          (r) => r.ticker.toUpperCase().includes(q) || r.name.toUpperCase().includes(q),
        )
      : results.slice();
    filtered.sort((a, b) => {
      switch (sortKey) {
        case "winProb":
          return b.winProb - a.winProb;
        case "ticker":
          return a.ticker.localeCompare(b.ticker);
        case "rvol":
          return (b.rvol ?? 0) - (a.rvol ?? 0);
        case "score":
        default:
          return b.score - a.score;
      }
    });
    return filtered.slice(0, 50);
  }, [results, search, sortKey]);

  const scanMutation = useMutation<{ results: ScanResult[]; meta: ScanResponseMeta }, Error, Strategy>({
    mutationFn: async (s: Strategy) => {
      const backendStrategy = STRATEGY_BACKEND_MAP[s.id] || "VCP";
      if (!isConnected) {
        return {
          results: generateFallbackResults(s.id),
          meta: { isLive: false, source: "fallback" },
        };
      }
      try {
        const res = await apiRequest("POST", "/api/scan/live", { strategy: backendStrategy });
        const data = await res.json();
        const mapped: ScanResult[] = (data.results || []).map((r: any) => {
          // Server (broker-service.quotesToScanResults) returns patternScore (0-100).
          // Older callers may send confidence (0-1) or score directly.
          const rawScore =
            typeof r.patternScore === "number"
              ? r.patternScore
              : typeof r.score === "number"
              ? r.score
              : typeof r.confidence === "number"
              ? r.confidence <= 1
                ? r.confidence * 100
                : r.confidence
              : 50;
          const score = Math.round(Math.max(0, Math.min(100, rawScore)));
          // Derive winProb from score if the server didn't supply one:
          // map 50→50, 75→65, 95→78 (capped 45..82).
          const winProb =
            typeof r.winProbability === "number"
              ? Math.round(r.winProbability * 100)
              : Math.round(Math.max(45, Math.min(82, 45 + (score - 50) * 0.7)));
          return {
            ticker: r.ticker,
            name: r.companyName || r.name || r.ticker,
            score,
            winProb,
            reason: r.reason || r.description || buildLiveReason(r, strategyReason(s.id)),
            rvol: typeof r.rvol === "number" ? r.rvol : null,
            changePercent: typeof r.changePercent === "number" ? r.changePercent : null,
            stage: typeof r.stage === "string" ? r.stage : null,
            price: typeof r.price === "number" ? r.price : null,
          };
        });
        if (mapped.length === 0) {
          return {
            results: generateFallbackResults(s.id),
            meta: { ...data.metadata, isLive: false, source: "fallback", error: "Live scan returned 0 matches — showing illustrative results." },
          };
        }
        return { results: mapped, meta: { ...data.metadata, source: "live" } };
      } catch (err: any) {
        return {
          results: generateFallbackResults(s.id),
          meta: { isLive: false, source: "fallback", error: err?.message || "Live scan failed — showing illustrative results." },
        };
      }
    },
    onSuccess: ({ results: r, meta: m }) => {
      setResults(r);
      setMeta(m);
      setLastScanAt(new Date());
    },
  });
  const running = scanMutation.isPending;

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
      const cat = filter === "All" || s.category === filter;
      const type = s.supports.some((t) => tradeTypes.includes(t));
      return cat && type;
    });
  }, [filter, tradeTypes]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.find((s) => s.id === selected.id)) {
      const first = filtered[0];
      setSelected(first);
      scanMutation.mutate(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selected.id]);

  const select = (s: Strategy) => {
    setSelected(s);
    scanMutation.mutate(s);
  };

  const preferredType = (s: Strategy): TradeType => {
    return s.supports.find((t) => tradeTypes.includes(t)) || s.supports[0];
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-medium flex items-center gap-2" data-testid="text-scanner-title">
              Scanner
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="What is the scanner?">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-snug">
                    Pick a trade type and strategy. Each card runs that strategy's pattern logic against live broker quotes (or illustrative data when no broker is connected) and ranks candidates by score.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pick what you want to trade and a strategy. Run a scan. See ranked candidates instantly.
            </p>
          </div>
          <HelpLink section="strategies" label="Scanner help" />
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

        <div className="flex flex-wrap items-center gap-2">
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
          <span className="ml-auto text-xs text-muted-foreground">
            Showing {filtered.length} of {STRATEGIES.length}
          </span>
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
                  className={
                    "p-5 transition-all hover-elevate flex flex-col " +
                    (isSelected ? "ring-2 ring-primary" : "")
                  }
                  data-testid={`card-strategy-${s.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center ${s.color}`}>
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{s.category}</Badge>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setGuideStrategy(s); }}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="How this strategy works"
                        data-testid={`button-guide-${s.id}`}
                        aria-label={`How ${s.name} works`}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => select(s)}
                    className="text-left mt-4 flex-1"
                    data-testid={`button-select-${s.id}`}
                  >
                    <div className="text-sm font-medium">{s.name}</div>
                    <p className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{s.desc}</p>
                    <div className="text-[11px] text-muted-foreground mt-3">
                      {s.conditions} · {s.timeframe}
                    </div>
                  </button>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="text-[11px] text-muted-foreground inline-flex items-center gap-1 cursor-help"
                          data-testid={`text-illustrative-winrate-${s.id}`}
                        >
                          <Info className="h-3 w-3" />
                          Illustrative · ~{s.winRate}%
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                        Reference number from the strategy's published research band — not a verified backtest of your account or current market conditions. A historical backtest engine isn't wired up yet, so treat this as illustrative only.
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => select(s)}
                    >
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
                {selected.name} results
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="text-[10px] gap-1 cursor-help"
                    data-testid="badge-results-vehicle"
                  >
                    <Info className="h-3 w-3" />
                    Underlying · vehicle: {TRADE_TYPES.find((t) => t.id === preferredType(selected))?.short}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs leading-snug">
                  The scan returns the underlying equities matching this pattern. Your selected trade type ({TRADE_TYPES.find((t) => t.id === preferredType(selected))?.short}) is the order vehicle that will be preselected when you click <span className="font-medium">View</span> — that's where the specific option contract or share order is built.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  meta.source === "live"
                    ? "text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                    : "text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10"
                }
                data-testid="badge-scan-source"
              >
                {meta.source === "live" ? `Live · ${meta.provider ?? "broker"}` : "Illustrative"}
              </Badge>
              <span className="text-xs text-muted-foreground" data-testid="text-scan-meta">
                {visibleResults.length}
                {visibleResults.length !== results.length ? ` of ${results.length}` : ""} matches · {timeAgo(lastScanAt)}
              </span>
            </div>
          </div>
          <div className="mb-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center" data-testid="bar-scan-controls">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticker or name…"
                className="h-8 pl-8 text-xs"
                data-testid="input-scan-search"
              />
            </div>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-8 w-full sm:w-[180px] text-xs" data-testid="select-scan-sort">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="score" data-testid="sort-option-score">Sort: Score (high → low)</SelectItem>
                <SelectItem value="winProb" data-testid="sort-option-winprob">Sort: Win prob (high → low)</SelectItem>
                <SelectItem value="rvol" data-testid="sort-option-rvol">Sort: RVOL (high → low)</SelectItem>
                <SelectItem value="ticker" data-testid="sort-option-ticker">Sort: Ticker (A → Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {meta.source === "fallback" && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100/90 flex items-start gap-2" data-testid="banner-scan-fallback">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                {meta.error
                  ? meta.error
                  : isConnected
                  ? "Live scan returned no matches for this strategy — showing illustrative examples seeded by strategy."
                  : "No broker connected. Showing illustrative examples that vary per strategy. Connect Tradier or TradeStation for live scan results."}
              </div>
            </div>
          )}
          <div className="divide-y">
            {running && results.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2" data-testid="state-scan-loading">
                <Loader2 className="h-4 w-4 animate-spin" /> Running {selected.name} scan…
              </div>
            ) : null}
            {!running && visibleResults.length === 0 && results.length > 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground" data-testid="state-scan-no-search-match">
                No matches for "{search}". Clear the search to see all {results.length} results.
              </div>
            ) : null}
            {visibleResults.map((r) => (
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

      <Sheet open={!!guideStrategy} onOpenChange={(o) => !o && setGuideStrategy(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {guideStrategy && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${guideStrategy.color}`}>
                    <guideStrategy.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle data-testid="text-guide-title">{guideStrategy.name}</SheetTitle>
                    <SheetDescription>
                      {guideStrategy.category} · {guideStrategy.timeframe} · {guideStrategy.winRate}% hist. win rate
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">What it looks for</h3>
                  <p className="text-sm">{guideStrategy.guide.whatItLooksFor}</p>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">How it works</h3>
                  <ul className="space-y-2">
                    {guideStrategy.guide.howItWorks.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Trigger signals</h3>
                  <ul className="space-y-2">
                    {guideStrategy.guide.triggers.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Risk & exit reference</h3>
                  <ul className="space-y-2">
                    {guideStrategy.guide.riskExit.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="bg-muted/40 rounded-lg p-4">
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Best for</h3>
                  <p className="text-sm">{guideStrategy.guide.bestFor}</p>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Compatible trade types</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {guideStrategy.supports.map((t) => {
                      const meta = TRADE_TYPES.find((tt) => tt.id === t)!;
                      return (
                        <Badge key={t} variant="outline" className="text-xs">
                          {meta.label}
                        </Badge>
                      );
                    })}
                  </div>
                </section>

                <p className="text-[11px] text-muted-foreground border-t pt-3">
                  Informational only — not investment advice. Strategy outputs are software-generated analysis to support self-directed research.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
