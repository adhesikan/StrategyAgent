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
} from "lucide-react";
import { useState } from "react";

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
}

interface TradeSetupCardProps {
  setup: TradeSetup;
  onOpenChart?: (symbol: string) => void;
  onSendToInstatrade?: (setup: TradeSetup) => void;
  onReviewSetup?: (setup: TradeSetup) => void;
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

export function TradeSetupCard({ setup, onOpenChart, onSendToInstatrade, onReviewSetup }: TradeSetupCardProps) {
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const [expandedInvalidation, setExpandedInvalidation] = useState(false);

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
              <div className="flex items-center gap-2 mt-0.5">
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
          <ScoreBadge score={setup.modelScore} />
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
            onClick={() => onSendToInstatrade?.(setup)}
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
