import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface DailyIdea {
  id: string;
  symbol: string;
  companyName?: string;
  category: "growth" | "income" | "trade" | "market_alert";
  instrumentType: "stock" | "long_call" | "long_put" | "spread" | "covered_call" | "cash_secured_put";
  title: string;
  simpleSummary: string;
  whyItAppeared: string;
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
  potentialReward: number | null;
  timeHorizon: string;
  sentimentLabel: string | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
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

const RISK_TIP: Record<DailyIdea["riskLevel"], string> = {
  low: "Lower historical volatility, defined-risk structure, or a small dollar exposure relative to your account size.",
  medium: "Moderate volatility or partial capital exposure. Typical swing-trade risk profile.",
  high: "Elevated volatility, undefined risk, or large notional exposure. Size carefully and consider defined-risk alternatives.",
};

// Weights mirror computeFinalScore() in server/services/opportunity-radar/scoring.ts
const GRADE_WEIGHTS = {
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

  const handleReview = () => {
    const typeMap: Record<DailyIdea["instrumentType"], string> = {
      stock: "stock",
      long_call: "long-call",
      long_put: "long-put",
      spread: "vertical",
      covered_call: "short-premium",
      cash_secured_put: "short-premium",
    };
    navigate(`/trade/${idea.symbol}?type=${typeMap[idea.instrumentType]}`);
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
            label="Max risk"
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
    navigate(`/trade/${idea.symbol}?type=${typeMap[idea.instrumentType]}`);
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
