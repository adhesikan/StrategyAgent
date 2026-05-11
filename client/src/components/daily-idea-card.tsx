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
  maxRisk: number;
  capitalNeeded: number;
  potentialReward: number | null;
  timeHorizon: string;
  sentimentLabel: string | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated";
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

interface Props {
  idea: DailyIdea;
}

export function DailyIdeaCard({ idea }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [learnOpen, setLearnOpen] = useState(false);

  const handlePaper = () => {
    toast({
      title: "Paper trade queued",
      description: `${idea.symbol} ${INSTRUMENT_LABEL[idea.instrumentType]} added to your simulated account for review.`,
    });
  };

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

  return (
    <>
      <Card
        className="p-4 flex flex-col gap-3 hover-elevate"
        data-testid={`card-daily-idea-${idea.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={CATEGORY_TONE[idea.category]} data-testid={`badge-category-${idea.id}`}>
              {CATEGORY_LABEL[idea.category]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {INSTRUMENT_LABEL[idea.instrumentType]}
            </Badge>
            {idea.dataMode === "simulated" && (
              <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground">
                Simulated
              </Badge>
            )}
          </div>
          <Badge variant="outline" className="text-[11px] font-semibold" data-testid={`badge-grade-${idea.id}`}>
            {idea.grade}
          </Badge>
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
          <Stat icon={ShieldCheck} label="Risk" value={idea.riskLevel} tone={RISK_TONE[idea.riskLevel]} />
          <Stat icon={AlertTriangle} label="Max risk" value={`$${idea.maxRisk.toLocaleString()}`} />
          <Stat
            icon={Coins}
            label="Capital"
            value={idea.capitalNeeded > 0 ? `$${idea.capitalNeeded.toLocaleString()}` : "—"}
          />
        </div>

        <p className="text-[11px] text-muted-foreground border-t pt-2 leading-snug" data-testid={`text-why-${idea.id}`}>
          <span className="font-medium text-foreground">Why it appeared: </span>
          {idea.whyItAppeared}
        </p>

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
          <Button
            variant="outline"
            size="sm"
            onClick={handlePaper}
            data-testid={`button-paper-${idea.id}`}
          >
            Paper
          </Button>
          <Button size="sm" onClick={handleReview} data-testid={`button-review-${idea.id}`}>
            Review <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </Card>

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
              <Button variant="outline" className="flex-1" onClick={handlePaper}>
                Paper trade
              </Button>
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

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone ?? ""}`}>
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="uppercase tracking-wide text-[9px]">{label}</span>
      </div>
      <div className="font-medium capitalize mt-0.5">{value}</div>
    </div>
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
