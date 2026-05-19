import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  Coins,
  Target,
  AlertTriangle,
  Info,
  ShieldCheck,
  ArrowRight,
  Percent,
  TrendingDown,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getStrategyByInstrumentType, getStrategyKeyByInstrumentType, STRATEGY_KEY_TO_SLUG } from "@shared/strategy-catalog";

export interface DailyIdeaAdvancedMetrics {
  squeezeStatus?: string;
  bandWidthPercentile?: number;
  rvol?: number;
  trendAlignment?: string;
  timeframeConfirmation?: string[];
  liquidityStatus?: string;
  riskReward?: string;
  falseBreakoutRisk?: string;
  stopArea?: string;
  targetArea?: string;
}

export interface DailyIdea {
  id: string;
  symbol: string;
  companyName?: string;
  category: "growth" | "income" | "trade" | "market_alert";
  instrumentType: "stock" | "long_call" | "long_put" | "spread" | "covered_call" | "cash_secured_put";
  title: string;
  simpleSummary: string;
  whyItAppeared: string;
  // AI Volatility Intelligence — optional so legacy callers/tests don't break.
  setupCategory?: string;
  confidenceReason?: string;
  signalPills?: string[];
  aiRead?: string;
  advancedMetrics?: DailyIdeaAdvancedMetrics;
  riskLevel: "low" | "medium" | "high";
  grade: string;
  score: number;
  gradeFactors?: {
    technical: number;
    momentum: number;
    sentiment: number;
    liquidity: number;
    risk: number;
  };
  maxRisk: number;
  capitalNeeded: number;
  // Spot price used by the scan when sizing capitalNeeded. Lets the card
  // compute the real share count (capitalNeeded / underlyingPrice) instead
  // of showing a hardcoded "100 shares" that disagrees with the dollar cost.
  underlyingPrice?: number;
  potentialReward: number | null;
  timeHorizon: string;
  sentimentLabel: string | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  bias?: "bullish" | "bearish" | "neutral";
  // Real broker option-chain strikes attached server-side. Present only when a
  // broker connection is available and the chain returned data — when absent,
  // the card falls back to the generic "ATM/slight-OTM · 30–45 DTE" copy.
  entryStrikes?: {
    expiration: string;
    source: "broker";
    legs: Array<{
      optionType: "call" | "put";
      strike: number;
      label: "ATM" | "OTM" | "ITM";
    }>;
  };
}

const CATEGORY_LABEL: Record<DailyIdea["category"], string> = {
  growth: "Growth",
  income: "Income",
  trade: "Trade",
  market_alert: "Market Alert",
};

const CATEGORY_TONE: Record<DailyIdea["category"], string> = {
  growth: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  income: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  trade: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  market_alert: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const RISK_TONE: Record<DailyIdea["riskLevel"], string> = {
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  high: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const INSTRUMENT_LABEL: Record<DailyIdea["instrumentType"], string> = {
  stock: "Stock",
  long_call: "Long Call",
  long_put: "Long Put",
  spread: "Vertical Spread",
  covered_call: "Covered Call",
  cash_secured_put: "Cash-Secured Put",
};

const CATEGORY_TIP: Record<DailyIdea["category"], string> = {
  growth: "Bias toward stock-style swing setups (trend, breakout, momentum). Driven by the strategy that produced the idea.",
  income: "Premium-collection style (covered calls, cash-secured puts, credit spreads). You collect premium and accept defined risk.",
  trade: "General directional trade idea — could be stock or option, depending on the instrument selector.",
  market_alert: "A heads-up about a market-wide event (volatility spike, sector move, news catalyst), not an entry signal.",
};

const INSTRUMENT_TIP: Record<DailyIdea["instrumentType"], string> = {
  stock: "Buy the underlying shares. Risk = entry minus stop times shares.",
  long_call: "Buy a call option. Defined risk = the premium paid. Profits if the stock rises before expiry.",
  long_put: "Buy a put option. Defined risk = the premium paid. Profits if the stock falls before expiry.",
  spread: "Vertical spread: buy one option and sell another at a different strike. Caps both risk and reward.",
  covered_call: "Sell a call against shares you own. Collects premium; upside capped above the strike.",
  cash_secured_put: "Sell a put while holding cash to buy the shares if assigned. Collects premium; obligated to buy at the strike.",
};

// Qualitative trade-plan preview keyed by instrument. These mirror the
// per-type bands in client/src/pages/trade-detail.tsx → buildPlan(). They
// are price-independent on purpose so the card doesn't have to invent a
// fake live quote — full $-precise estimates appear on the detail page.
interface EntryLeg {
  side: "BUY" | "SELL";
  qty: string;
  desc: string;
}

const PLAN_PREVIEW: Record<
  DailyIdea["instrumentType"],
  {
    winProb: string;
    maxProfit: string;
    exitPlan: string[];
    entryLegs: EntryLeg[];
    netLabel: string;
  }
> = {
  stock: {
    winProb: "—",
    maxProfit: "Open-ended",
    entryLegs: [{ side: "BUY", qty: "100", desc: "shares · limit near current price" }],
    netLabel: "Total cost ≈ price × shares",
    exitPlan: [
      "Take profit near +15%",
      "Stop loss near -5%",
      "Trail stop to break-even after +5%",
    ],
  },
  long_call: {
    winProb: "≈45–50%",
    maxProfit: "Open-ended",
    entryLegs: [{ side: "BUY", qty: "1", desc: "ATM/slight-OTM call · 30–45 DTE" }],
    netLabel: "Net debit (premium paid)",
    exitPlan: [
      "Take profit at +75% of premium",
      "Stop loss at -50% of premium",
      "Close 21 days before expiry",
    ],
  },
  long_put: {
    winProb: "≈42–48%",
    maxProfit: "Large if stock falls sharply",
    entryLegs: [{ side: "BUY", qty: "1", desc: "ATM/slight-OTM put · 30–45 DTE" }],
    netLabel: "Net debit (premium paid)",
    exitPlan: [
      "Take profit at +75% of premium",
      "Stop loss at -50% of premium",
      "Close 21 days before expiry",
    ],
  },
  spread: {
    winProb: "≈55–60%",
    maxProfit: "Capped (defined)",
    entryLegs: [
      { side: "BUY", qty: "1", desc: "long leg · ATM strike · 30–45 DTE" },
      { side: "SELL", qty: "1", desc: "short leg · 1 strike OTM · same expiry" },
    ],
    netLabel: "Net debit (long premium − short premium)",
    exitPlan: [
      "Take profit at 75% of max gain",
      "Stop loss at 50% of debit",
      "Close 14–21 days before expiry",
    ],
  },
  covered_call: {
    winProb: "≈65–70%",
    maxProfit: "Premium + (strike − cost basis)",
    entryLegs: [
      { side: "BUY", qty: "100", desc: "shares (or use existing lot)" },
      { side: "SELL", qty: "1", desc: "OTM call against shares · 30–45 DTE" },
    ],
    netLabel: "Net credit (premium received)",
    exitPlan: [
      "Let it expire if OTM",
      "Buy to close at 50% of premium collected",
      "Roll up/out if challenged near expiry",
    ],
  },
  cash_secured_put: {
    winProb: "≈65–70%",
    maxProfit: "Net credit collected",
    entryLegs: [
      { side: "SELL", qty: "1", desc: "OTM put · 30–45 DTE · cash collateral set aside" },
    ],
    netLabel: "Net credit (premium received)",
    exitPlan: [
      "Buy to close at 50% of premium collected",
      "Roll out if challenged",
      "Accept assignment if you'd own at strike",
    ],
  },
};

const RISK_TIP: Record<DailyIdea["riskLevel"], string> = {
  low: "Lower historical volatility, defined-risk structure, or a small dollar exposure relative to your account size.",
  medium: "Moderate volatility or partial capital exposure. Typical swing-trade risk profile.",
  high: "Elevated volatility, undefined risk, or large notional exposure. Size carefully and consider defined-risk alternatives.",
};

// Friendlier risk wording for the simple-mode card. We avoid "High Risk" as a
// dominant red label; the same data is shown inside Advanced details as a
// risk *profile* instead.
export const RISK_PROFILE_LABEL: Record<DailyIdea["riskLevel"], string> = {
  low: "Conservative",
  medium: "Balanced",
  high: "Aggressive",
};

// Plain-English setup-type headline shown in simple mode. Mirrors instrument
// type but reads like a trader-friendly description rather than the formal
// option-structure name used in the badge.
export function setupTypeLabel(idea: Pick<DailyIdea, "instrumentType">): string {
  switch (idea.instrumentType) {
    case "stock":
      return "Stock Breakout Setup";
    case "long_call":
      return "Bullish Call Opportunity";
    case "long_put":
      return "Bearish Put Opportunity";
    case "spread":
      return "Defined-Risk Options Setup";
    case "covered_call":
      return "Covered Call Income Setup";
    case "cash_secured_put":
      return "Cash-Secured Put Income Setup";
  }
}

// Tiny qualitative sizing hint so the estimated cost reads with context
// ("~$351 · 1 contract") instead of as a bare number. Mirrors the entry-leg
// shape in PLAN_PREVIEW but as a single user-facing string. For stock setups
// we compute the actual share count from capitalNeeded / underlyingPrice so
// the line agrees with the dollar figure shown above (e.g. $11k of GOOGL at
// ~$400/share is ~28 shares, not "100 shares").
export function sizingHint(idea: Pick<DailyIdea, "instrumentType" | "capitalNeeded" | "underlyingPrice">): string {
  switch (idea.instrumentType) {
    case "stock": {
      const price = idea.underlyingPrice ?? 0;
      if (price > 0 && idea.capitalNeeded > 0) {
        const shares = Math.max(1, Math.floor(idea.capitalNeeded / price));
        // Show the per-share basis price so the dollar cost is transparent
        // — e.g. "≈ 27 shares @ $411.52" makes it obvious why ~$11k is
        // needed, and surfaces stale quotes if the price drifts from live.
        return `≈ ${shares.toLocaleString()} share${shares === 1 ? "" : "s"} @ $${price.toFixed(2)}`;
      }
      return "≈ position sized to your limits";
    }
    case "long_call":
    case "long_put":
      return "≈ 1 option contract";
    case "spread":
      return "≈ 1 spread (2 legs)";
    case "covered_call":
      return "≈ 100 shares + 1 short call";
    case "cash_secured_put":
      return "≈ 1 short put (cash held)";
  }
}

interface Conviction {
  label: string;
  tone: string;
}

// Maps the 0–100 composite score onto a qualitative conviction tier used for
// the simple-mode badge. We use the same thresholds as the existing letter
// grades so simple and advanced views agree on which setups are strongest.
export function convictionFromScore(score: number): Conviction {
  if (score >= 85) {
    return {
      label: "High Conviction",
      tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    };
  }
  if (score >= 70) {
    return {
      label: "Moderate Conviction",
      tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40",
    };
  }
  return {
    label: "Exploratory",
    tone: "bg-muted text-muted-foreground border-border",
  };
}

interface WatchlistSummary {
  id: string;
  name: string;
  symbols?: string[];
}

// Shared mutation hook for the "Add to Watchlist" button. Uses the user's
// first existing watchlist, creating one named "My Watchlist" if none exist.
// Symbols already present are treated as success (server is idempotent in
// practice; we also guard locally to avoid noisy toasts).
export function useAddToWatchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (symbol: string) => {
      const upper = symbol.toUpperCase();
      const listsRes = await fetch("/api/watchlists", { credentials: "include" });
      if (!listsRes.ok) throw new Error("Couldn't load your watchlists.");
      const lists: WatchlistSummary[] = await listsRes.json();
      let target = lists[0];
      if (!target) {
        const created = await apiRequest("POST", "/api/watchlists", { name: "My Watchlist" });
        target = await created.json();
      }
      if (target.symbols?.includes(upper)) {
        return { alreadyPresent: true, name: target.name };
      }
      await apiRequest("POST", `/api/watchlists/${target.id}/symbols`, { symbol: upper });
      return { alreadyPresent: false, name: target.name };
    },
    onSuccess: (result, symbol) => {
      qc.invalidateQueries({ queryKey: ["/api/watchlists"] });
      toast({
        title: result.alreadyPresent ? `${symbol} is already on ${result.name}` : `Added ${symbol} to ${result.name}`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't add to watchlist",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}

// Weights mirror computeFinalScore() in server/services/opportunity-radar/scoring.ts
export const GRADE_WEIGHTS = {
  technical: 28,
  momentum: 20,
  sentiment: 22,
  liquidity: 15,
  risk: 15,
} as const;

const GRADE_BAND_LABEL = (grade: string): string => {
  switch (grade) {
    case "A+":
      return "A+ (composite ≥ 90 — strongest agreement across factors)";
    case "A":
      return "A (composite 80–89 — strong agreement)";
    case "B":
      return "B (composite 70–79 — moderate agreement, watch the weaker factors)";
    case "C":
      return "C (composite 50–69 — mixed signals; one or more factors are weak)";
    default:
      return `${grade} (below the standard quality bands)`;
  }
};

function GradeExplainer({ idea }: { idea: DailyIdea }) {
  const f = idea.gradeFactors;
  return (
    <div className="space-y-1.5">
      <div className="font-semibold">
        Grade {idea.grade} · score {idea.score}
      </div>
      <div className="text-muted-foreground">{GRADE_BAND_LABEL(idea.grade)}</div>
      {f ? (
        <>
          <div className="text-muted-foreground pt-1">
            How this idea's composite was built (each factor 0–100, then weighted):
          </div>
          <ul className="space-y-0.5">
            <li>Technical {f.technical} × {GRADE_WEIGHTS.technical}%</li>
            <li>Momentum {f.momentum} × {GRADE_WEIGHTS.momentum}%</li>
            <li>News sentiment {f.sentiment} × {GRADE_WEIGHTS.sentiment}%</li>
            <li>Liquidity {f.liquidity} × {GRADE_WEIGHTS.liquidity}%</li>
            <li>Risk fit {f.risk} × {GRADE_WEIGHTS.risk}%</li>
          </ul>
          <div className="text-muted-foreground pt-1">
            Higher = more factors agree. Not a price target — review before acting.
          </div>
        </>
      ) : (
        <div className="text-muted-foreground">
          Composite of technical, momentum, news sentiment, liquidity and risk-fit.
          Higher grades mean more factors agree — not a price target.
        </div>
      )}
    </div>
  );
}

interface Props {
  idea: DailyIdea;
}

export function DailyIdeaCard({ idea }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [learnOpen, setLearnOpen] = useState(false);
  // Plan details (Win prob / Max profit / R:R, Entry plan, Exit plan) start
  // collapsed so the card stays scannable. Users expand only when they want
  // the deeper view.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleReview = () => {
    const typeMap: Record<DailyIdea["instrumentType"], string> = {
      stock: "stock",
      long_call: "long-call",
      long_put: "long-put",
      spread: "vertical",
      covered_call: "short-premium",
      cash_secured_put: "short-premium",
    };
    const slug = STRATEGY_KEY_TO_SLUG[getStrategyKeyByInstrumentType(idea.instrumentType)];
    navigate(`/trade/${idea.symbol}?type=${typeMap[idea.instrumentType]}&strategy=${slug}`);
  };

  const capitalTip =
    idea.capitalNeeded > 0
      ? "Approximate cash you need to set aside to enter this idea — share price × shares for stocks, or premium × contracts × 100 for options. Doesn't include commissions."
      : "No upfront capital estimate — typically a defined-risk options structure where the max loss equals the debit shown.";

  return (
    <>
      <TooltipProvider delayDuration={200}>
      <Card
        className="p-4 flex flex-col gap-3 hover-elevate"
        data-testid={`card-daily-idea-${idea.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className={`cursor-help ${CATEGORY_TONE[idea.category]}`} data-testid={`badge-category-${idea.id}`}>
                  {CATEGORY_LABEL[idea.category]}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                <strong>{CATEGORY_LABEL[idea.category]}.</strong> {CATEGORY_TIP[idea.category]}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help">
                  {INSTRUMENT_LABEL[idea.instrumentType]}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                <strong>{INSTRUMENT_LABEL[idea.instrumentType]}.</strong> {INSTRUMENT_TIP[idea.instrumentType]}
              </TooltipContent>
            </Tooltip>
            {idea.dataMode === "simulated" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] cursor-help border-muted-foreground/40 text-muted-foreground">
                    Simulated
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                  No broker is connected, so prices and sizing are example values for learning. Connect a broker for live quotes.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[11px] font-semibold cursor-help" data-testid={`badge-grade-${idea.id}`}>
                {idea.grade}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[300px] text-xs leading-snug">
              <GradeExplainer idea={idea} />
            </TooltipContent>
          </Tooltip>
        </div>

        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold" data-testid={`text-symbol-${idea.id}`}>
              {idea.symbol}
            </span>
            {idea.companyName && (
              <span className="text-xs text-muted-foreground truncate">{idea.companyName}</span>
            )}
          </div>
          <p className="text-sm font-medium mt-1 leading-snug">{idea.title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">{idea.simpleSummary}</p>
          {(() => {
            const strat = getStrategyByInstrumentType(idea.instrumentType);
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300 hover:underline cursor-help"
                    data-testid={`strategy-name-${idea.id}`}
                  >
                    <Sparkles className="h-3 w-3" />
                    Strategy: <span className="font-semibold normal-case tracking-normal">{strat.name}</span>
                    <Info className="h-3 w-3 opacity-70" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[320px] text-xs leading-snug space-y-1.5">
                  <div className="font-semibold text-foreground">{strat.name}</div>
                  <div className="text-muted-foreground italic">{strat.tagline}</div>
                  <div><span className="font-medium">How it works: </span>{strat.howItWorks}</div>
                  <div><span className="font-medium">Best when: </span>{strat.whenItWorks}</div>
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <Stat
            icon={ShieldCheck}
            label="Risk"
            value={idea.riskLevel}
            tone={RISK_TONE[idea.riskLevel]}
            tip={`${idea.riskLevel.charAt(0).toUpperCase() + idea.riskLevel.slice(1)} risk. ${RISK_TIP[idea.riskLevel]}`}
          />
          <Stat
            icon={AlertTriangle}
            label="Max loss"
            value={`$${idea.maxRisk.toLocaleString()}`}
            tip="The most you can lose on this single position if the stop is hit (stock) or the option expires worthless (defined-risk option). Capped by your per-trade max-risk limit in My Limits."
          />
          <Stat
            icon={Coins}
            label="Capital"
            value={idea.capitalNeeded > 0 ? `$${idea.capitalNeeded.toLocaleString()}` : "—"}
            tip={capitalTip}
          />
        </div>

        {(() => {
          const plan = PLAN_PREVIEW[idea.instrumentType];
          const rr =
            idea.potentialReward != null && idea.maxRisk > 0
              ? `${(idea.potentialReward / idea.maxRisk).toFixed(1)}:1`
              : null;
          const maxProfitDisplay =
            idea.potentialReward != null
              ? `$${idea.potentialReward.toLocaleString()}`
              : plan.maxProfit;
          return (
            <div className="rounded-md border bg-muted/20" data-testid={`plan-preview-${idea.id}`}>
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center justify-between w-full px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`button-toggle-plan-${idea.id}`}
                aria-expanded={detailsOpen}
              >
                <span className="flex items-center gap-1.5">
                  <ArrowRight className="h-3 w-3" />
                  {detailsOpen ? "Hide plan details" : "Show entry & exit plan"}
                </span>
                {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {detailsOpen && (
              <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t">
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <Stat
                  icon={Percent}
                  label="Win prob"
                  value={plan.winProb}
                  tip={
                    plan.winProb === "—"
                      ? "Stocks don't carry a built-in win-probability estimate the way defined-risk option structures do — the exit plan and stop define the trade math instead."
                      : `Reference probability band for ${INSTRUMENT_LABEL[idea.instrumentType]} structures based on typical strike/expiry choices. Estimate only — actual fill depends on the live option chain (bid/ask, IV, delta, OI).`
                  }
                />
                <Stat
                  icon={TrendingUp}
                  label="Max profit"
                  value={maxProfitDisplay}
                  tip={
                    idea.potentialReward != null
                      ? "Estimated max gain for this idea using the strategy's default targets. Confirm in your broker before placing the order."
                      : `Profit shape for ${INSTRUMENT_LABEL[idea.instrumentType]} positions. Defined-risk structures cap gains at the spread width minus cost; long-premium positions are open-ended.`
                  }
                />
                <Stat
                  icon={Target}
                  label="R : R"
                  value={rr ?? "—"}
                  tip={
                    rr
                      ? "Reward-to-risk ratio = max profit ÷ max loss. A 2:1 means the target gain is twice the planned loss."
                      : "Reward-to-risk needs both a target and a stop. Open the detail page for the full payoff diagram and break-even prices."
                  }
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  <ArrowRight className="h-3 w-3" />
                  Entry plan
                </div>
                <ul className="space-y-0.5 text-[11px] leading-snug" data-testid={`entry-legs-${idea.id}`}>
                  {plan.entryLegs.map((leg, i) => {
                    // When real broker chain strikes are attached, prefer them
                    // over the generic "ATM/slight-OTM · 30–45 DTE" copy.
                    // Stocks have no chain leg; spreads/CC/CSP have multiple
                    // option legs whose order matches PLAN_PREVIEW.entryLegs.
                    const chainLegs = idea.entryStrikes?.legs ?? [];
                    let chainLeg: { optionType: "call" | "put"; strike: number; label: string } | undefined;
                    if (idea.instrumentType === "covered_call") {
                      // PLAN_PREVIEW has 2 legs (BUY shares, SELL OTM call); chain has 1 (the call).
                      if (leg.side === "SELL") chainLeg = chainLegs[0];
                    } else if (idea.instrumentType === "stock") {
                      // No chain leg.
                    } else {
                      // Long call/put = 1 leg. Spread = 2 legs same order.
                      chainLeg = chainLegs[i] ?? chainLegs[0];
                    }
                    return (
                      <li key={i} className="flex items-start gap-2" data-testid={`entry-leg-${idea.id}-${i}`}>
                        <Badge
                          variant="outline"
                          className={
                            "text-[9px] font-bold px-1.5 py-0 leading-tight shrink-0 " +
                            (leg.side === "BUY"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
                              : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40")
                          }
                        >
                          {leg.side} {leg.qty}
                        </Badge>
                        <span className="text-muted-foreground">
                          {chainLeg ? (
                            <>
                              <span className="text-foreground font-medium">
                                ${chainLeg.strike} {chainLeg.optionType}
                              </span>
                              <span className="ml-1 text-[10px] text-muted-foreground/80">
                                ({chainLeg.label}) · {idea.entryStrikes!.expiration}
                              </span>
                            </>
                          ) : (
                            leg.desc
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="text-[10px] text-muted-foreground/80">
                    {plan.netLabel}
                  </div>
                  {idea.entryStrikes && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 leading-tight bg-primary/10 text-primary border-primary/30"
                          data-testid={`badge-broker-chain-${idea.id}`}
                        >
                          Live chain
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[240px] text-xs leading-snug">
                        Strikes and expiration above are pulled from your connected broker's live option chain — not derived from a generic 30–45 DTE estimate. Confirm bid/ask, IV, delta, and OI in your broker before submitting.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Exit plan
                </div>
                <ol className="space-y-0.5 text-[11px] text-muted-foreground leading-snug list-decimal list-inside marker:text-primary/60">
                  {plan.exitPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground/80 leading-snug border-t pt-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Estimates only — strikes, premiums, and break-evens shown on the detail page are derived from the current price. Always confirm the live option chain (bid/ask, IV, delta, OI) in your broker before submitting.
                </span>
              </div>
              </div>
              )}
            </div>
          );
        })()}

        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-[11px] text-muted-foreground border-t pt-2 leading-snug cursor-help" data-testid={`text-why-${idea.id}`}>
              <span className="font-medium text-foreground">Why it appeared: </span>
              {idea.whyItAppeared}
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[300px] text-xs leading-snug">
            Plain-English summary of which technical, sentiment, and risk filters this idea passed for the bucket you're viewing. Tap "Learn more" for the full breakdown.
          </TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setLearnOpen(true)}
            data-testid={`button-learn-${idea.id}`}
          >
            <Info className="h-3.5 w-3.5 mr-1" />
            Learn more
          </Button>
          <Button size="sm" onClick={handleReview} data-testid={`button-review-${idea.id}`}>
            Review <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </Card>
      </TooltipProvider>

      <Sheet open={learnOpen} onOpenChange={setLearnOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {idea.symbol} — {INSTRUMENT_LABEL[idea.instrumentType]}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Software-generated context for your review. Not investment advice.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4 text-sm">
            <Section title="What this means">
              <p className="text-muted-foreground leading-snug">{idea.simpleSummary}</p>
            </Section>

            <Section title="Why it appeared">
              <p className="text-muted-foreground leading-snug">{idea.whyItAppeared}</p>
            </Section>

            <Section title="What could go wrong">
              <ul className="list-disc list-inside text-muted-foreground space-y-1 leading-snug">
                {idea.riskLevel === "high" && <li>Long premium can decay quickly if the move doesn't happen.</li>}
                {idea.instrumentType === "covered_call" && <li>Upside is capped above the strike.</li>}
                {idea.instrumentType === "cash_secured_put" && <li>You may be assigned the stock at the strike price.</li>}
                <li>Broad market reversal or unexpected news on the underlying.</li>
                <li>Past performance does not guarantee future results.</li>
              </ul>
            </Section>

            <Section title="What to review before trading">
              <ul className="list-disc list-inside text-muted-foreground space-y-1 leading-snug">
                <li>Confirm the position size fits your max-risk-per-trade limit.</li>
                <li>Check upcoming earnings or major catalysts on {idea.symbol}.</li>
                <li>Verify your broker's commissions and assignment rules.</li>
                <li>Decide your exit plan before placing the order.</li>
              </ul>
            </Section>

            <Section title="Advanced details">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Detail label="Grade" value={idea.grade} />
                <Detail label="Score" value={String(idea.score)} />
                <Detail label="Time horizon" value={idea.timeHorizon} />
                <Detail label="Risk" value={idea.riskLevel} />
                <Detail label="Max risk" value={`$${idea.maxRisk.toLocaleString()}`} />
                <Detail label="Capital" value={`$${idea.capitalNeeded.toLocaleString()}`} />
                <Detail label="Potential reward" value={idea.potentialReward != null ? `$${idea.potentialReward.toLocaleString()}` : "n/a"} />
                <Detail label="Sentiment" value={idea.sentimentLabel ?? "neutral"} />
              </div>
            </Section>

            <div className="flex gap-2 pt-2 border-t">
              <Button className="flex-1" onClick={handleReview}>
                Review setup
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Simple-mode card. Shows only ticker, setup type, conviction, one-line
// reason, estimated cost, and primary/secondary CTAs. Risk, max loss, capital,
// strategy metadata, and entry/exit plan all live inside a collapsible
// "Advanced details" section so the surface stays scannable.
export function SimpleIdeaCard({ idea }: Props) {
  const [, navigate] = useLocation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const addToWatchlist = useAddToWatchlist();

  const handleReview = () => {
    const typeMap: Record<DailyIdea["instrumentType"], string> = {
      stock: "stock",
      long_call: "long-call",
      long_put: "long-put",
      spread: "vertical",
      covered_call: "short-premium",
      cash_secured_put: "short-premium",
    };
    const slug = STRATEGY_KEY_TO_SLUG[getStrategyKeyByInstrumentType(idea.instrumentType)];
    navigate(`/trade/${idea.symbol}?type=${typeMap[idea.instrumentType]}&strategy=${slug}`);
  };

  const conviction = convictionFromScore(idea.score);
  const setup = setupTypeLabel(idea);
  const estimatedCost = idea.capitalNeeded > 0 ? idea.capitalNeeded : idea.maxRisk;
  const sizing = sizingHint(idea);
  const strategy = getStrategyByInstrumentType(idea.instrumentType);

  return (
    <TooltipProvider delayDuration={200}>
    <Card
      className="p-5 hover-elevate border-border/60 bg-card/60 flex flex-col gap-4"
      data-testid={`card-simple-idea-${idea.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight" data-testid={`simple-symbol-${idea.id}`}>
            {idea.symbol}
          </div>
          {idea.companyName && (
            <div className="text-xs text-muted-foreground truncate mt-0.5">{idea.companyName}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="cursor-help inline-flex" data-testid={`simple-confidence-${idea.id}`}>
                <Badge
                  variant="outline"
                  className={`text-[11px] font-semibold whitespace-nowrap ${conviction.tone}`}
                >
                  {idea.score}% Setup Match
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[320px] text-xs leading-snug">
              <div className="font-semibold mb-1">
                {idea.score}% Setup Match · {conviction.label}
              </div>
              {idea.confidenceReason && (
                <div className="text-muted-foreground italic mb-2">
                  {idea.confidenceReason}
                </div>
              )}
              {idea.gradeFactors ? (
                <>
                  <div className="text-muted-foreground">
                    Why {idea.score}? Each factor is scored 0–100, then weighted into the composite:
                  </div>
                  <ul className="space-y-0.5 mt-1">
                    <li>Technical {idea.gradeFactors.technical} × {GRADE_WEIGHTS.technical}%</li>
                    <li>Momentum {idea.gradeFactors.momentum} × {GRADE_WEIGHTS.momentum}%</li>
                    <li>News sentiment {idea.gradeFactors.sentiment} × {GRADE_WEIGHTS.sentiment}%</li>
                    <li>Liquidity {idea.gradeFactors.liquidity} × {GRADE_WEIGHTS.liquidity}%</li>
                    <li>Risk fit {idea.gradeFactors.risk} × {GRADE_WEIGHTS.risk}%</li>
                  </ul>
                  <div className="text-muted-foreground mt-2">
                    Higher = more factors agree. Not a price target or a prediction of profit.
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  Composite of technical (28%), momentum (20%), news sentiment (22%), liquidity
                  (15%), and risk fit (15%). Higher = more factors agree — not a price target.
                </div>
              )}
            </TooltipContent>
          </Tooltip>
          {idea.confidenceReason && (
            <span
              className="text-[10px] text-muted-foreground text-right max-w-[140px] leading-tight"
              data-testid={`simple-confidence-reason-${idea.id}`}
            >
              {idea.confidenceReason}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold" data-testid={`simple-setup-${idea.id}`}>
            {setup}
          </div>
          {idea.setupCategory && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal bg-muted/40 border-border/60"
              data-testid={`simple-category-${idea.id}`}
            >
              {idea.setupCategory}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
          {idea.simpleSummary}
        </p>
        {idea.signalPills && idea.signalPills.length > 0 && (
          <div
            className="mt-2 flex flex-wrap gap-1"
            data-testid={`simple-pills-${idea.id}`}
          >
            {idea.signalPills.map((pill) => (
              <span
                key={pill}
                className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-muted-foreground"
                data-testid={`simple-pill-${idea.id}-${pill.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {pill}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">Estimated cost: </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-semibold cursor-help" data-testid={`simple-cost-${idea.id}`}>
                ~${estimatedCost.toLocaleString()}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
              {idea.capitalNeeded > 0
                ? "Approximate cash to set aside for this position — share price × shares for stocks, or premium × contracts × 100 for options. Excludes commissions."
                : "Defined-risk options idea: max loss equals the debit shown. No separate capital figure."}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5" data-testid={`simple-sizing-${idea.id}`}>
          {sizing}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={handleReview}
          className="flex-1 w-full"
          data-testid={`button-simple-review-${idea.id}`}
        >
          Review Setup <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
        <Button
          variant="outline"
          onClick={() => addToWatchlist.mutate(idea.symbol)}
          disabled={addToWatchlist.isPending}
          className="w-full sm:w-auto"
          data-testid={`button-simple-watchlist-${idea.id}`}
        >
          {addToWatchlist.isSuccess ? (
            <Check className="h-3.5 w-3.5 mr-1" />
          ) : (
            <Plus className="h-3.5 w-3.5 mr-1" />
          )}
          Add to Watchlist
        </Button>
      </div>

      <div className="border-t pt-2 -mx-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center justify-between w-full px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={advancedOpen}
          data-testid={`button-simple-advanced-${idea.id}`}
        >
          <span>Advanced details</span>
          {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-3 px-1 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Detail label="Risk profile" value={RISK_PROFILE_LABEL[idea.riskLevel]} />
              <Detail label="Max loss" value={`$${idea.maxRisk.toLocaleString()}`} />
              <Detail label="Capital required" value={idea.capitalNeeded > 0 ? `$${idea.capitalNeeded.toLocaleString()}` : "—"} />
              <Detail label="Time horizon" value={idea.timeHorizon} />
              <Detail label="Strategy" value={strategy.name} />
              <Detail label="Instrument" value={INSTRUMENT_LABEL[idea.instrumentType]} />
              <Detail label="Data mode" value={idea.dataMode === "simulated" ? "Simulated" : "Live"} />
              <Detail label="AI score" value={`${idea.score} / 100`} />
            </div>
            {idea.advancedMetrics && (
              <div className="border-t pt-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  Estimated volatility & trend signals
                </div>
                <p className="text-[10px] text-muted-foreground/80 italic mb-1.5">
                  Derived from the scan's composite factors — not real-time indicator readings. Confirm on a live chart.
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1" data-testid={`simple-metrics-${idea.id}`}>
                  {idea.advancedMetrics.squeezeStatus && (
                    <Detail label="Volatility squeeze (est.)" value={idea.advancedMetrics.squeezeStatus} />
                  )}
                  {typeof idea.advancedMetrics.bandWidthPercentile === "number" && (
                    <Detail
                      label="Range tightness (est.)"
                      value={`${idea.advancedMetrics.bandWidthPercentile} / 100`}
                    />
                  )}
                  {typeof idea.advancedMetrics.rvol === "number" && (
                    <Detail label="Relative volume (est.)" value={`${idea.advancedMetrics.rvol.toFixed(2)}×`} />
                  )}
                  {idea.advancedMetrics.trendAlignment && (
                    <Detail label="Trend alignment" value={idea.advancedMetrics.trendAlignment} />
                  )}
                  {idea.advancedMetrics.timeframeConfirmation && (
                    <Detail
                      label="Confirmed on"
                      value={idea.advancedMetrics.timeframeConfirmation.join(" · ")}
                    />
                  )}
                  {idea.advancedMetrics.liquidityStatus && (
                    <Detail label="Liquidity" value={idea.advancedMetrics.liquidityStatus} />
                  )}
                  {idea.advancedMetrics.riskReward && (
                    <Detail label="Risk / reward" value={idea.advancedMetrics.riskReward} />
                  )}
                  {idea.advancedMetrics.falseBreakoutRisk && (
                    <Detail label="False-breakout risk" value={idea.advancedMetrics.falseBreakoutRisk} />
                  )}
                  {idea.advancedMetrics.stopArea && (
                    <Detail label="Suggested stop area" value={idea.advancedMetrics.stopArea} />
                  )}
                  {idea.advancedMetrics.targetArea && (
                    <Detail label="Suggested target area" value={idea.advancedMetrics.targetArea} />
                  )}
                </div>
              </div>
            )}
            {idea.aiRead && (
              <div className="border-t pt-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" />
                  AI read
                </div>
                <p
                  className="text-muted-foreground leading-snug"
                  data-testid={`simple-ai-read-${idea.id}`}
                >
                  {idea.aiRead}
                </p>
              </div>
            )}
            <div className="border-t pt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Why it appeared
              </div>
              <p className="text-muted-foreground leading-snug">{idea.whyItAppeared}</p>
            </div>
            <div className="border-t pt-2 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Entry plan
                </div>
                <ul className="space-y-0.5 leading-snug">
                  {PLAN_PREVIEW[idea.instrumentType].entryLegs.map((leg, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={
                        "text-[9px] font-bold px-1.5 py-0 leading-tight shrink-0 rounded border " +
                        (leg.side === "BUY"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40")
                      }>
                        {leg.side} {leg.qty}
                      </span>
                      <span className="text-muted-foreground">{leg.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Exit plan
                </div>
                <ol className="space-y-0.5 leading-snug list-decimal list-inside text-muted-foreground marker:text-primary/60">
                  {PLAN_PREVIEW[idea.instrumentType].exitPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/80 italic border-t pt-2">
              Estimates only — confirm in your broker before submitting any order.
            </p>
          </div>
        )}
      </div>
    </Card>
    </TooltipProvider>
  );
}

export function DailyIdeaRow({ idea }: Props) {
  const [, navigate] = useLocation();

  const handleReview = () => {
    const typeMap: Record<DailyIdea["instrumentType"], string> = {
      stock: "stock",
      long_call: "long-call",
      long_put: "long-put",
      spread: "vertical",
      covered_call: "short-premium",
      cash_secured_put: "short-premium",
    };
    const slug = STRATEGY_KEY_TO_SLUG[getStrategyKeyByInstrumentType(idea.instrumentType)];
    navigate(`/trade/${idea.symbol}?type=${typeMap[idea.instrumentType]}&strategy=${slug}`);
  };

  const capitalTip =
    idea.capitalNeeded > 0
      ? "Approximate cash to set aside: share price × shares for stocks, or premium × contracts × 100 for options."
      : "Defined-risk options idea — max loss equals the debit. No separate capital figure.";

  return (
    <TooltipProvider delayDuration={200}>
    <div
      data-testid={`row-daily-idea-${idea.id}`}
      className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2.5 hover-elevate"
    >
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="text-base font-bold" data-testid={`row-symbol-${idea.id}`}>{idea.symbol}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] font-semibold cursor-help" data-testid={`row-grade-${idea.id}`}>
              {idea.grade}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[300px] text-xs leading-snug">
            <GradeExplainer idea={idea} />
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`text-[10px] cursor-help ${CATEGORY_TONE[idea.category]}`}>
            {CATEGORY_LABEL[idea.category]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          <strong>{CATEGORY_LABEL[idea.category]}.</strong> {CATEGORY_TIP[idea.category]}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px] cursor-help">
            {INSTRUMENT_LABEL[idea.instrumentType]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          <strong>{INSTRUMENT_LABEL[idea.instrumentType]}.</strong> {INSTRUMENT_TIP[idea.instrumentType]}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`text-[10px] capitalize cursor-help ${RISK_TONE[idea.riskLevel]}`}>
            {idea.riskLevel} risk
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          {RISK_TIP[idea.riskLevel]}
        </TooltipContent>
      </Tooltip>
      <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-[260px]">{idea.title}</span>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground">Max risk: </span>
              <span className="font-semibold">${idea.maxRisk.toLocaleString()}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
            The most you can lose on this single position if the stop hits (stock) or the option expires worthless. Capped by your per-trade max-risk limit in My Limits.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground">Cap: </span>
              <span className="font-semibold">{idea.capitalNeeded > 0 ? `$${idea.capitalNeeded.toLocaleString()}` : "—"}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            {capitalTip}
          </TooltipContent>
        </Tooltip>
      </div>
      <Button size="sm" onClick={handleReview} data-testid={`row-review-${idea.id}`}>
        Review <ArrowRight className="h-3.5 w-3.5 ml-1" />
      </Button>
    </div>
    </TooltipProvider>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  tip,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
  tip?: string;
}) {
  const inner = (
    <div className={`rounded-md border px-2 py-1.5 ${tip ? "cursor-help" : ""} ${tone ?? ""}`}>
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="uppercase tracking-wide text-[9px]">{label}</span>
      </div>
      <div className="font-medium capitalize mt-0.5">{value}</div>
    </div>
  );
  if (!tip) return inner;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-snug">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm capitalize">{value}</div>
    </div>
  );
}
