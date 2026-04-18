import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Eye,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  LineChart,
  Layers,
  Award,
  Repeat,
} from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface OptionPlanLite {
  type: string;
  legs: Array<{
    side: "buy" | "sell";
    optionType: "call" | "put";
    strike: number;
    expiration: string;
    estimatedPremium?: number;
  }>;
  dte: number;
  netDebit?: number;
  maxProfit?: number | null;
  maxLoss?: number;
  breakeven?: number;
  suitabilityScore: number;
}

interface InstrumentRec {
  recommended: string;
  alternative: string | null;
  recommendedPlan?: OptionPlanLite;
  alternativePlan?: OptionPlanLite;
  vehicleScore: number;
  reasons: string[];
  tradeoffs: string[];
}

interface ProbabilityResult {
  finalScore: number;
  grade: "A+" | "A" | "B" | "C";
  breakdown: Record<string, number>;
  reasons: string[];
  warnings: string[];
}

interface TradeSetup {
  id: string;
  symbol: string;
  assetType: "stock" | "option" | "future";
  strategyName: string;
  timeframe: string;
  setupType: string;
  bias: "bullish" | "bearish" | "neutral";
  entry: number;
  stop: number;
  targets: number[];
  rewardRisk: number | null;
  modelScore: number | null;
  reasoning: string[];
  invalidation: string[];
  metrics: {
    trend?: string;
    volume?: string;
    volatility?: string;
    openingRangeHigh?: number;
    openingRangeLow?: number;
    currentPrice?: number;
    rvol?: number;
    ema9?: number;
    ema21?: number;
    vwap?: number;
  };
  dataSource: string;
  generatedAt: string;
  probability?: ProbabilityResult;
  instrument?: InstrumentRec;
}

interface TradeSetupCardProps {
  setup: TradeSetup;
  onOpenChart?: (symbol: string) => void;
  onSendToInstatrade?: (setup: TradeSetup, useAlternative?: boolean) => void;
  onReviewSetup?: (setup: TradeSetup) => void;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  "A": "bg-green-500/15 text-green-400 border-green-500/30",
  "B": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "C": "bg-red-500/15 text-red-400 border-red-500/30",
};

const INSTRUMENT_LABELS: Record<string, string> = {
  stock: "Stock",
  long_call: "Long Call",
  long_put: "Long Put",
  bull_call_spread: "Bull Call Spread",
  bear_put_spread: "Bear Put Spread",
};

function GradeBadge({ probability }: { probability?: ProbabilityResult }) {
  if (!probability) return null;
  const cls = GRADE_COLORS[probability.grade] || GRADE_COLORS.C;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold cursor-help ${cls}`} data-testid="badge-grade">
          <Award className="h-3.5 w-3.5" />
          Grade {probability.grade} · {probability.finalScore}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[280px] text-[11px] leading-snug">
        <p className="font-medium mb-1">Probability Grade</p>
        <p>Weighted score from technical, real-time, news, analyst and risk factors.</p>
        <p className="mt-1 text-muted-foreground">A+ ≥ 85 · A ≥ 75 · B ≥ 65 · C &lt; 65</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 80
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : score >= 60
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-red-500/15 text-red-400 border-red-500/30";

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${color}`} data-testid="badge-model-score">
      <BarChart3 className="h-3.5 w-3.5" />
      Model Score: {score}
    </div>
  );
}

function BiasIcon({ bias }: { bias: string }) {
  if (bias === "bullish") return <TrendingUp className="h-4 w-4 text-green-400" />;
  if (bias === "bearish") return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function InstrumentBlock({
  rec,
  showingAlt,
  onToggleAlt,
}: {
  rec: InstrumentRec;
  showingAlt: boolean;
  onToggleAlt: () => void;
}) {
  const activeType = showingAlt && rec.alternative ? rec.alternative : rec.recommended;
  const activePlan = showingAlt ? rec.alternativePlan : rec.recommendedPlan;
  const label = INSTRUMENT_LABELS[activeType] || activeType;

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2" data-testid="block-instrument">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {showingAlt ? "Alternative" : "Recommended"}
          </span>
          <Badge variant="outline" className="text-[11px] font-semibold" data-testid="badge-instrument-type">
            {label}
          </Badge>
          {!showingAlt && (
            <span className="text-[10px] text-muted-foreground">vehicle score {rec.vehicleScore}</span>
          )}
        </div>
        {rec.alternative && (
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onToggleAlt} data-testid="button-toggle-alternative">
            <Repeat className="h-3 w-3 mr-1" />
            {showingAlt ? "Show recommended" : `Show ${INSTRUMENT_LABELS[rec.alternative] || rec.alternative}`}
          </Button>
        )}
      </div>

      {activePlan && activeType !== "stock" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">DTE</p>
            <p className="font-medium" data-testid="text-option-dte">{activePlan.dte}d</p>
          </div>
          {typeof activePlan.netDebit === "number" && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Net Debit</p>
              <p className="font-medium" data-testid="text-option-debit">${activePlan.netDebit.toFixed(2)}</p>
            </div>
          )}
          {typeof activePlan.breakeven === "number" && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Breakeven</p>
              <p className="font-medium" data-testid="text-option-breakeven">${activePlan.breakeven.toFixed(2)}</p>
            </div>
          )}
          {typeof activePlan.maxLoss === "number" && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Max Loss</p>
              <p className="font-medium text-red-400" data-testid="text-option-maxloss">${activePlan.maxLoss.toFixed(2)}</p>
            </div>
          )}
          {activePlan.maxProfit !== null && typeof activePlan.maxProfit === "number" && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Max Profit</p>
              <p className="font-medium text-green-400" data-testid="text-option-maxprofit">${activePlan.maxProfit.toFixed(2)}</p>
            </div>
          )}
          {activePlan.maxProfit === null && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Max Profit</p>
              <p className="font-medium text-green-400">Unlimited</p>
            </div>
          )}
        </div>
      )}

      {activePlan && activePlan.legs && activePlan.legs.length > 0 && activeType !== "stock" && (
        <div className="space-y-1">
          {activePlan.legs.map((leg, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground" data-testid={`leg-${i}`}>
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                {leg.side === "buy" ? "BUY" : "SELL"}
              </Badge>
              <span>
                {leg.optionType.toUpperCase()} ${leg.strike} · exp {leg.expiration}
              </span>
              {typeof leg.estimatedPremium === "number" && (
                <span className="ml-auto">~${leg.estimatedPremium.toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {!showingAlt && rec.reasons?.length > 0 && (
        <ul className="pl-4 space-y-0.5">
          {rec.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[11px] text-muted-foreground list-disc" data-testid={`text-instrument-reason-${i}`}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TradeSetupCard({ setup, onOpenChart, onSendToInstatrade, onReviewSetup }: TradeSetupCardProps) {
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const [expandedInvalidation, setExpandedInvalidation] = useState(false);
  const [expandedScore, setExpandedScore] = useState(false);
  const [showAlt, setShowAlt] = useState(false);

  const biasColor =
    setup.bias === "bullish"
      ? "text-green-400"
      : setup.bias === "bearish"
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur" data-testid={`card-setup-${setup.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <span className="text-lg font-bold text-primary" data-testid="text-setup-symbol">{setup.symbol}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base" data-testid="text-strategy-name">{setup.strategyName}</h3>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="badge-asset-type">
                  {setup.assetType.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="badge-timeframe">
                  {setup.timeframe}
                </Badge>
                <span className={`flex items-center gap-1 text-xs font-medium ${biasColor}`} data-testid="text-bias">
                  <BiasIcon bias={setup.bias} />
                  {setup.bias.charAt(0).toUpperCase() + setup.bias.slice(1)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <GradeBadge probability={setup.probability} />
            {!setup.probability && <ScoreBadge score={setup.modelScore} />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry</p>
            <p className="text-sm font-semibold text-green-400" data-testid="text-entry">${setup.entry.toFixed(2)}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop</p>
            <p className="text-sm font-semibold text-red-400" data-testid="text-stop">${setup.stop.toFixed(2)}</p>
          </div>
          {setup.targets.map((target, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Target {i + 1}</p>
              <p className="text-sm font-semibold text-blue-400" data-testid={`text-target-${i}`}>${target.toFixed(2)}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {setup.rewardRisk && (
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reward/Risk</p>
              <p className="text-sm font-medium" data-testid="text-rr">{setup.rewardRisk}:1</p>
            </div>
          )}
          {setup.metrics.currentPrice && (
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Price</p>
              <p className="text-sm font-medium" data-testid="text-current-price">${setup.metrics.currentPrice.toFixed(2)}</p>
            </div>
          )}
          {setup.metrics.rvol && (
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">RVOL</p>
              <p className="text-sm font-medium" data-testid="text-rvol">{setup.metrics.rvol.toFixed(1)}x</p>
            </div>
          )}
          {setup.metrics.volume && (
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Volume</p>
              <p className="text-sm font-medium" data-testid="text-volume">{setup.metrics.volume}</p>
            </div>
          )}
        </div>

        {setup.metrics.trend && (
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trend</p>
            <p className="text-sm font-medium" data-testid="text-trend">{setup.metrics.trend}</p>
          </div>
        )}

        {setup.instrument && (
          <>
            <Separator className="opacity-50" />
            <InstrumentBlock
              rec={setup.instrument}
              showingAlt={showAlt}
              onToggleAlt={() => setShowAlt((s) => !s)}
            />
          </>
        )}

        {setup.probability && (
          <div>
            <button
              onClick={() => setExpandedScore(!expandedScore)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              data-testid="button-toggle-score"
            >
              <Award className="h-3.5 w-3.5 text-primary" />
              Probability Score Breakdown
              {expandedScore ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {expandedScore && (
              <div className="mt-2 pl-5 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {Object.entries(setup.probability.breakdown).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-[11px] text-muted-foreground" data-testid={`score-${k}`}>
                      <span className="capitalize">{k}</span>
                      <span className="font-mono">{Math.round(v as number)}</span>
                    </div>
                  ))}
                </div>
                {setup.probability.reasons?.length > 0 && (
                  <ul className="space-y-0.5 pl-3">
                    {setup.probability.reasons.map((r, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground list-disc" data-testid={`text-prob-reason-${i}`}>{r}</li>
                    ))}
                  </ul>
                )}
                {setup.probability.warnings?.length > 0 && (
                  <ul className="space-y-0.5 pl-3">
                    {setup.probability.warnings.map((w, i) => (
                      <li key={i} className="text-[11px] text-amber-400 list-disc" data-testid={`text-prob-warn-${i}`}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <Separator className="opacity-50" />

        <div>
          <button
            onClick={() => setExpandedReasoning(!expandedReasoning)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            data-testid="button-toggle-reasoning"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            Why This Setup Qualifies
            {expandedReasoning ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {expandedReasoning && (
            <ul className="mt-2 space-y-1 pl-5">
              {setup.reasoning.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground list-disc" data-testid={`text-reasoning-${i}`}>{r}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <button
            onClick={() => setExpandedInvalidation(!expandedInvalidation)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            data-testid="button-toggle-invalidation"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            Invalidation Conditions
            {expandedInvalidation ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {expandedInvalidation && (
            <ul className="mt-2 space-y-1 pl-5">
              {setup.invalidation.map((inv, i) => (
                <li key={i} className="text-xs text-muted-foreground list-disc" data-testid={`text-invalidation-${i}`}>{inv}</li>
              ))}
            </ul>
          )}
        </div>

        <Separator className="opacity-50" />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReviewSetup?.(setup)}
            data-testid="button-review-setup"
          >
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Review Setup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChart?.(setup.symbol)}
            data-testid="button-open-chart"
          >
            <LineChart className="h-3.5 w-3.5 mr-1.5" />
            Open Chart
          </Button>
          <Button
            size="sm"
            onClick={() => onSendToInstatrade?.(setup, showAlt)}
            className="bg-primary hover:bg-primary/90"
            data-testid="button-send-instatrade"
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            Send to InstaTrade™
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground/60 leading-tight" data-testid="text-disclaimer">
          Software-generated setup for informational purposes only. Not investment advice or a recommendation.
        </p>
        {setup.dataSource && (
          <p className="text-[10px] text-muted-foreground/40" data-testid="text-data-source">
            Data source: {setup.dataSource}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
