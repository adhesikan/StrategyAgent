// Shared Opportunity Radar scenario card + explanation drawer.
// Extracted from pages/opportunity-radar.tsx so the home page renders the
// exact same detailed card (scores, levels, sentiment, why/risk) as the
// Radar page — one source of truth, no drift.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Eye,
  ListChecks,
  Send,
  Newspaper,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Landmark,
  CheckCircle2,
  ExternalLink,
  X,
  Link2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CongressFlowEmbed } from "@/components/congressflow-embed";
import { STRATEGY_KEY_TO_SLUG } from "@shared/strategy-catalog";

// ---------------------------------------------------------------------------
// Types (shared shape of /api/radar/scenarios candidates)
// ---------------------------------------------------------------------------
export type RadarBias = "bullish" | "bearish" | "neutral";
export type RadarStrategyType =
  | "stock_swing"
  | "long_call"
  | "long_put"
  | "debit_spread"
  | "covered_call"
  | "cash_secured_put";
export type RadarGrade = "A+" | "A" | "B" | "C";
export type RadarTimeHorizon = "intraday" | "1_5d" | "1_4w" | "30_60d";

export interface RadarSentimentBlock {
  available: boolean;
  label: "bullish" | "bearish" | "neutral" | "mixed";
  rawScore: number;
  normalizedScore: number;
  confidence: number;
  impactLevel: "low" | "medium" | "high";
  buzzScore: number;
  articleCount: number;
  topThemes: string[];
  whyItMatters: string;
  biasAlignment: "aligned" | "opposed" | "neutral";
  miniReason: string;
  source: "live" | "stale" | "missing";
}

export interface RadarCandidateScenario {
  id: string;
  rank: number;
  symbol: string;
  companyName?: string;
  strategyType: RadarStrategyType;
  bias: RadarBias;
  finalGrade: RadarGrade;
  finalScore: number;
  technicalScore: number;
  sentimentScore: number;
  momentumScore: number;
  liquidityScore: number;
  riskScore: number;
  thesis: string;
  mainReason: string;
  mainRisk: string;
  entry: number;
  stop: number;
  target: number;
  maxLoss: number;
  maxGain: number | null;
  breakeven: number | null;
  capitalRequired: number;
  expiration: string | null;
  strikes: string | null;
  rewardRisk: number;
  timeHorizon: RadarTimeHorizon;
  factors: {
    technical: string[];
    sentiment: string[];
    liquidity: string[];
    risk: string[];
    invalidators: string[];
  };
  dataMode: "live" | "simulated" | "mixed";
  isOptions: boolean;
  liquidityMetrics?: {
    stockVolume: number;
    optionOpenInterest: number | null;
    optionVolume: number | null;
    bidAskSpreadPct: number | null;
  };
  currentlyHeld?: boolean;
  earningsInDays?: number | null;
  sentiment?: RadarSentimentBlock;
}

// ---------------------------------------------------------------------------
// Labels & badge tones
// ---------------------------------------------------------------------------
export const RADAR_STRATEGY_LABEL: Record<RadarStrategyType, string> = {
  stock_swing: "Stock Swing",
  long_call: "Long Call",
  long_put: "Long Put",
  debit_spread: "Debit Spread",
  covered_call: "Covered Call",
  cash_secured_put: "Cash-Secured Put",
};

export const RADAR_BIAS_BADGE: Record<RadarBias, string> = {
  bullish: "border-emerald-500/40 text-emerald-400",
  bearish: "border-rose-500/40 text-rose-400",
  neutral: "border-sky-500/40 text-sky-400",
};

export const RADAR_GRADE_BADGE: Record<RadarGrade, string> = {
  "A+": "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  "A": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "B": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "C": "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

const SENTIMENT_BADGE: Record<"bullish" | "bearish" | "neutral" | "mixed", string> = {
  bullish: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  bearish: "border-rose-500/40 text-rose-300 bg-rose-500/10",
  neutral: "border-zinc-500/30 text-zinc-300 bg-zinc-500/10",
  mixed: "border-amber-500/40 text-amber-300 bg-amber-500/10",
};

function sentimentIcon(label: "bullish" | "bearish" | "neutral" | "mixed") {
  if (label === "bullish") return <TrendingUp className="h-3.5 w-3.5" />;
  if (label === "bearish") return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

// ---------------------------------------------------------------------------
// Card internals
// ---------------------------------------------------------------------------
export function SentimentChip({
  scenario,
  onViewNews,
}: {
  scenario: RadarCandidateScenario;
  onViewNews: () => void;
}) {
  const s = scenario.sentiment;
  if (!s || !s.available) {
    return (
      <div
        className="flex items-center justify-between rounded border border-zinc-500/30 bg-zinc-500/5 px-2 py-1.5 text-xs"
        data-testid={`chip-sentiment-${scenario.symbol}`}
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <Newspaper className="h-3.5 w-3.5" />
          <span>No recent headline coverage</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={onViewNews}
          data-testid={`button-news-${scenario.symbol}`}
        >
          Refresh news
        </Button>
      </div>
    );
  }
  const tone = SENTIMENT_BADGE[s.label];
  return (
    <div
      className={`rounded border px-2 py-1.5 text-xs space-y-1 ${tone}`}
      data-testid={`chip-sentiment-${scenario.symbol}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {sentimentIcon(s.label)}
          <span className="font-semibold capitalize">{s.label}</span>
          <span className="opacity-80">
            {s.rawScore > 0 ? "+" : ""}
            {Math.round(s.rawScore)}
          </span>
          <span className="opacity-70">
            · {s.articleCount} article{s.articleCount === 1 ? "" : "s"}
          </span>
          <span className="opacity-70">· impact {s.impactLevel}</span>
          {s.biasAlignment === "opposed" && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px] py-0 h-4">
              caveat
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={onViewNews}
          data-testid={`button-news-${scenario.symbol}`}
        >
          <Newspaper className="h-3.5 w-3.5 mr-1" />
          View News Context
        </Button>
      </div>
      <p className="opacity-90 leading-snug" data-testid={`text-sentiment-reason-${scenario.symbol}`}>
        {s.miniReason}
      </p>
    </div>
  );
}

export function SubScore({ label, value }: { label: string; value: number }) {
  const tone = value >= 80 ? "bg-emerald-500/15 text-emerald-300" : value >= 60 ? "bg-amber-500/10 text-amber-300" : "bg-zinc-500/10 text-zinc-300";
  return (
    <div className={`rounded px-1.5 py-0.5 text-center ${tone}`}>
      <div className="opacity-70">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

export function Mini({ label, value, className, testId }: { label: string; value: string; className?: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className={`font-medium ${className ?? ""}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The detailed scenario card (identical on Radar page and home page)
// ---------------------------------------------------------------------------
export function ScenarioCard({
  scenario,
  onExplain,
  onReview,
  onPrepareOrder,
  onViewNews,
  onViewCongress,
}: {
  scenario: RadarCandidateScenario;
  onExplain: () => void;
  onReview: () => void;
  onPrepareOrder: () => void;
  onViewNews: () => void;
  onViewCongress: () => void;
}) {
  return (
    <Card className="hover-elevate" data-testid={`card-scenario-${scenario.symbol}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground" data-testid={`text-rank-${scenario.symbol}`}>#{scenario.rank}</span>
              <span className="font-bold text-lg" data-testid={`text-symbol-${scenario.symbol}`}>{scenario.symbol}</span>
              <Badge variant="outline" className={RADAR_GRADE_BADGE[scenario.finalGrade]} data-testid={`badge-grade-${scenario.symbol}`}>
                {scenario.finalGrade}
              </Badge>
              <Badge variant="outline" className={RADAR_BIAS_BADGE[scenario.bias]} data-testid={`badge-bias-${scenario.symbol}`}>
                {scenario.bias}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground" data-testid={`text-company-${scenario.symbol}`}>
              {scenario.companyName ?? ""}
            </p>
            <p className="text-xs mt-1" data-testid={`text-strategy-${scenario.symbol}`}>
              {RADAR_STRATEGY_LABEL[scenario.strategyType]}
              {scenario.strikes ? ` · ${scenario.strikes}` : ""}
              {scenario.expiration ? ` · ${scenario.expiration}` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Score</div>
            <div className="text-2xl font-bold" data-testid={`text-final-score-${scenario.symbol}`}>{scenario.finalScore}</div>
          </div>
        </div>

        <SentimentChip scenario={scenario} onViewNews={onViewNews} />

        <div className="grid grid-cols-5 gap-1 text-[10px]">
          <SubScore label="Tech" value={scenario.technicalScore} />
          <SubScore label="Senti" value={scenario.sentimentScore} />
          <SubScore label="Mom" value={scenario.momentumScore} />
          <SubScore label="Liq" value={scenario.liquidityScore} />
          <SubScore label="Risk" value={scenario.riskScore} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <Mini label="Capital" value={`$${Math.round(scenario.capitalRequired).toLocaleString()}`} testId={`mini-capital-${scenario.symbol}`} />
          <Mini label="Max loss" value={`$${Math.round(scenario.maxLoss).toLocaleString()}`} className="text-rose-300" testId={`mini-maxloss-${scenario.symbol}`} />
          <Mini label="Max gain" value={scenario.maxGain != null ? `$${Math.round(scenario.maxGain).toLocaleString()}` : "—"} className="text-emerald-300" testId={`mini-maxgain-${scenario.symbol}`} />
          <Mini label="Entry" value={`$${scenario.entry.toFixed(2)}`} testId={`mini-entry-${scenario.symbol}`} />
          <Mini label="Stop" value={`$${scenario.stop.toFixed(2)}`} testId={`mini-stop-${scenario.symbol}`} />
          <Mini label="Target" value={`$${scenario.target.toFixed(2)}`} testId={`mini-target-${scenario.symbol}`} />
          {scenario.breakeven != null && <Mini label="Breakeven" value={`$${scenario.breakeven.toFixed(2)}`} testId={`mini-breakeven-${scenario.symbol}`} />}
          <Mini label="R/R" value={scenario.rewardRisk > 0 ? `${scenario.rewardRisk.toFixed(2)}x` : "—"} testId={`mini-rr-${scenario.symbol}`} />
        </div>

        <div className="space-y-1 text-xs">
          <p data-testid={`text-main-reason-${scenario.symbol}`}><span className="text-muted-foreground">Why it ranked:</span> {scenario.mainReason}</p>
          <p className="text-amber-300/90 flex gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span data-testid={`text-main-risk-${scenario.symbol}`}>{scenario.mainRisk}</span></p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onExplain} data-testid={`button-view-why-${scenario.symbol}`}>
            <Eye className="h-4 w-4 mr-1" />
            View Why
          </Button>
          <Button size="sm" variant="outline" onClick={onReview} data-testid={`button-review-${scenario.symbol}`}>
            <ListChecks className="h-4 w-4 mr-1" />
            Review Scenario
          </Button>
          <Button size="sm" variant="outline" onClick={onViewCongress} data-testid={`button-congress-${scenario.symbol}`}>
            <Landmark className="h-4 w-4 mr-1" />
            Congress Activity
          </Button>
          <Button size="sm" onClick={onPrepareOrder} data-testid={`button-prepare-${scenario.symbol}`}>
            <Send className="h-4 w-4 mr-1" />
            Prepare Order
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// "View Why" explanation drawer (self-contained — usable from any page)
// ---------------------------------------------------------------------------
function FactorBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExplanationDrawer({ scenario, onClose }: { scenario: RadarCandidateScenario | null; onClose: () => void }) {
  const open = !!scenario;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-explanation">
        {scenario && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-explanation-title">
                Why {scenario.symbol} ranked {scenario.finalGrade} ({scenario.finalScore})
              </SheetTitle>
              <SheetDescription>{scenario.thesis}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 mt-4 text-sm">
              <FactorBlock title="Technical factors" items={scenario.factors.technical} />
              <FactorBlock title="Sentiment factors" items={scenario.factors.sentiment} />
              <FactorBlock title="Liquidity factors" items={scenario.factors.liquidity} />
              <FactorBlock title="Risk factors" items={scenario.factors.risk} />
              <FactorBlock title="What could invalidate this scenario" items={scenario.factors.invalidators} />
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200" data-testid="text-explanation-compliance">
                These factors describe how the scenario was generated by the software. They are not investment advice
                or a prediction. Past behavior of similar setups does not guarantee future results.
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// News-context & Congress-activity drawers (self-contained — usable anywhere)
// ---------------------------------------------------------------------------
export interface RadarNewsArticleContext {
  id: string;
  headline: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  summary: string | null;
  whyItMatters: string | null;
  sentimentLabel: "bullish" | "bearish" | "neutral" | "mixed" | null;
  sentimentScore: number | null;
  impactLevel: "low" | "medium" | "high" | null;
  bullishDrivers: string[];
  bearishDrivers: string[];
  riskWarnings: string[];
}

export interface RadarAggregatedSnapshotResponse {
  symbol: string;
  sentimentLabel: "bullish" | "bearish" | "neutral" | "mixed";
  sentimentScore: number;
  confidence: number;
  impactLevel: "low" | "medium" | "high";
  buzzScore: number;
  articleCount: number;
  topThemes: string[];
  whyItMatters: string;
}

export interface RadarSymbolSentimentResponse {
  symbol: string;
  snapshot: RadarAggregatedSnapshotResponse | null;
  articles: RadarNewsArticleContext[];
  stale: boolean;
  sources: { news: "live" | "mock"; sentiment: "openai" | "rule_based" };
  disclaimer: string;
}

export function CongressActivityDrawer({
  symbol,
  onClose,
}: {
  symbol: string | null;
  onClose: () => void;
}) {
  const open = !!symbol;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-congress-activity">
        {symbol && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-congress-drawer-title">
                <span className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" />
                  Congress Activity — {symbol}
                </span>
              </SheetTitle>
              <SheetDescription>
                Reported U.S. congressional transactions for {symbol} from public disclosures. Disclosures may be
                delayed, amended, incomplete, or reported as value ranges. Research context only — not a trading
                signal and not investment advice.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <CongressFlowEmbed view="ticker" ticker={symbol} minHeight={400} maxHeight={1600} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function NewsContextDrawer({
  scenario,
  onClose,
}: {
  scenario: RadarCandidateScenario | null;
  onClose: () => void;
}) {
  const open = !!scenario;
  const symbol = scenario?.symbol;
  const { data, isLoading } = useQuery<RadarSymbolSentimentResponse>({
    queryKey: ["/api/sentiment", symbol],
    enabled: open && !!symbol,
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-news-context">
        {scenario && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-news-title">
                News context — {scenario.symbol}
              </SheetTitle>
              <SheetDescription>
                Recent articles and software-generated sentiment summary. Informational only.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 mt-4 text-sm">
              {isLoading && <Skeleton className="h-32 w-full" />}
              {data?.snapshot && (
                <div className={`rounded border p-3 ${SENTIMENT_BADGE[data.snapshot.sentimentLabel]}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {sentimentIcon(data.snapshot.sentimentLabel)}
                    <span className="capitalize">{data.snapshot.sentimentLabel}</span>
                    <span>
                      {data.snapshot.sentimentScore > 0 ? "+" : ""}
                      {Math.round(data.snapshot.sentimentScore)}
                    </span>
                    <span className="opacity-80 text-xs">
                      · {data.snapshot.articleCount} articles · impact {data.snapshot.impactLevel} · buzz{" "}
                      {data.snapshot.buzzScore}
                    </span>
                  </div>
                  <p className="text-xs opacity-90 mt-1">{data.snapshot.whyItMatters}</p>
                  {data.snapshot.topThemes.length > 0 && (
                    <div className="mt-2 text-xs opacity-90">
                      <span className="font-semibold">Top themes: </span>
                      {data.snapshot.topThemes.join(" · ")}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                  Recent articles ({data?.articles.length ?? 0})
                </h4>
                {data?.articles.length === 0 && (
                  <p className="text-xs text-muted-foreground">No recent articles found in cache.</p>
                )}
                {data?.articles.map((a) => (
                  <div
                    key={a.id}
                    className="rounded border border-border p-3 space-y-1"
                    data-testid={`article-${a.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium leading-snug" data-testid={`text-article-headline-${a.id}`}>
                          {a.headline}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {a.source ?? "Unknown"}
                          {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleString()}` : ""}
                        </div>
                      </div>
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
                          data-testid={`link-article-${a.id}`}
                        >
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {a.sentimentLabel && (
                      <div className="flex items-center gap-2 text-[11px]">
                        <Badge variant="outline" className={SENTIMENT_BADGE[a.sentimentLabel]}>
                          {a.sentimentLabel}
                          {a.sentimentScore != null
                            ? ` ${a.sentimentScore > 0 ? "+" : ""}${Math.round(a.sentimentScore)}`
                            : ""}
                        </Badge>
                        {a.impactLevel && (
                          <span className="text-muted-foreground">impact {a.impactLevel}</span>
                        )}
                      </div>
                    )}
                    {a.summary && <p className="text-xs leading-snug">{a.summary}</p>}
                    {a.whyItMatters && (
                      <p className="text-xs italic text-muted-foreground">Why it matters: {a.whyItMatters}</p>
                    )}
                    {a.bullishDrivers.length > 0 && (
                      <div className="text-[11px]">
                        <span className="text-emerald-300 font-semibold">Bullish: </span>
                        {a.bullishDrivers.join(" · ")}
                      </div>
                    )}
                    {a.bearishDrivers.length > 0 && (
                      <div className="text-[11px]">
                        <span className="text-rose-300 font-semibold">Bearish: </span>
                        {a.bearishDrivers.join(" · ")}
                      </div>
                    )}
                    {a.riskWarnings.length > 0 && (
                      <div className="text-[11px] text-amber-300">
                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                        {a.riskWarnings.join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {data?.disclaimer && (
                <div
                  className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200"
                  data-testid="text-news-disclaimer"
                >
                  {data.disclaimer}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Scenario action logging + order review dialog (self-contained)
// ---------------------------------------------------------------------------
// Maps a radar scenario to the trade-setup page URL — the same destination the
// legacy daily-idea "Review setup" button used, so Review behaves uniformly on
// every page that renders these cards.
const SCENARIO_TRADE_TYPE: Record<RadarStrategyType, string> = {
  stock_swing: "stock",
  long_call: "long-call",
  long_put: "long-put",
  debit_spread: "vertical",
  covered_call: "short-premium",
  cash_secured_put: "short-premium",
};

export function tradeUrlForScenario(scenario: RadarCandidateScenario): string {
  const type = SCENARIO_TRADE_TYPE[scenario.strategyType] ?? "stock";
  const slug = STRATEGY_KEY_TO_SLUG[scenario.strategyType] ?? "stock-swing";
  return `/trade/${scenario.symbol}?type=${type}&strategy=${slug}`;
}

export async function logScenarioAction(scenario: RadarCandidateScenario, action: string, complianceAcknowledged = false) {
  try {
    await apiRequest("POST", "/api/radar/scenarios", {
      action,
      complianceAcknowledged,
      scenario: {
        symbol: scenario.symbol,
        companyName: scenario.companyName,
        strategyType: scenario.strategyType,
        bias: scenario.bias,
        finalGrade: scenario.finalGrade,
        finalScore: scenario.finalScore,
        technicalScore: scenario.technicalScore,
        sentimentScore: scenario.sentimentScore,
        momentumScore: scenario.momentumScore,
        liquidityScore: scenario.liquidityScore,
        riskScore: scenario.riskScore,
        thesis: scenario.thesis,
        mainReason: scenario.mainReason,
        mainRisk: scenario.mainRisk,
        entry: scenario.entry,
        stop: scenario.stop,
        target: scenario.target,
        maxLoss: scenario.maxLoss,
        maxGain: scenario.maxGain,
        breakeven: scenario.breakeven,
        capitalRequired: scenario.capitalRequired,
        expiration: scenario.expiration,
        strikes: scenario.strikes,
        dataMode: scenario.dataMode,
        brokerConnected: false,
      },
    });
    queryClient.invalidateQueries({ queryKey: ["/api/radar/scenarios/history"] });
    queryClient.invalidateQueries({ queryKey: ["/api/agent/trade-setups"] });
  } catch (err) {
    console.error("[Radar] log action failed", err);
  }
}

export function OrderReviewDialog({
  scenario,
  brokerConnected,
  onClose,
}: {
  scenario: RadarCandidateScenario | null;
  brokerConnected: boolean;
  onClose: () => void;
}) {
  const open = !!scenario;
  const [acknowledged, setAcknowledged] = useState(false);
  const { toast } = useToast();

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!scenario) return null;
      return apiRequest("POST", "/api/radar/scenarios", {
        action: "sent_order",
        complianceAcknowledged: true,
        scenario: {
          symbol: scenario.symbol,
          companyName: scenario.companyName,
          strategyType: scenario.strategyType,
          bias: scenario.bias,
          finalGrade: scenario.finalGrade,
          finalScore: scenario.finalScore,
          technicalScore: scenario.technicalScore,
          sentimentScore: scenario.sentimentScore,
          momentumScore: scenario.momentumScore,
          liquidityScore: scenario.liquidityScore,
          riskScore: scenario.riskScore,
          thesis: scenario.thesis,
          mainReason: scenario.mainReason,
          mainRisk: scenario.mainRisk,
          entry: scenario.entry,
          stop: scenario.stop,
          target: scenario.target,
          maxLoss: scenario.maxLoss,
          maxGain: scenario.maxGain,
          breakeven: scenario.breakeven,
          capitalRequired: scenario.capitalRequired,
          expiration: scenario.expiration,
          strikes: scenario.strikes,
          dataMode: scenario.dataMode,
          brokerConnected,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/radar/scenarios/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/trade-setups"] });
      toast({ title: "Self-directed order recorded", description: "Saved to your scenario history." });
      handleClose();
    },
    onError: (err: any) => {
      toast({
        title: "Could not send order",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setAcknowledged(false);
    onClose();
  };

  if (!scenario) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-radar-review">
        <DialogHeader>
          <DialogTitle data-testid="text-review-title">Review Scenario — {scenario.symbol}</DialogTitle>
          <DialogDescription>
            Confirm every detail. No order is sent until you click {brokerConnected ? "Send to Broker" : "Connect Broker"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-lg">{scenario.symbol}</span>
              <Badge variant="outline">{RADAR_STRATEGY_LABEL[scenario.strategyType]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-review-thesis">{scenario.thesis}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <Mini label="Bias" value={scenario.bias} />
            <Mini label="Grade" value={scenario.finalGrade} />
            <Mini label="Score" value={String(scenario.finalScore)} />
            <Mini label="Capital" value={`$${Math.round(scenario.capitalRequired).toLocaleString()}`} />
            <Mini label="Max loss" value={`$${Math.round(scenario.maxLoss).toLocaleString()}`} className="text-rose-300" />
            <Mini label="Max gain" value={scenario.maxGain != null ? `$${Math.round(scenario.maxGain).toLocaleString()}` : "—"} className="text-emerald-300" />
            <Mini label="Entry" value={`$${scenario.entry.toFixed(2)}`} />
            <Mini label="Stop" value={`$${scenario.stop.toFixed(2)}`} />
            <Mini label="Target" value={`$${scenario.target.toFixed(2)}`} />
            {scenario.breakeven != null && <Mini label="Breakeven" value={`$${scenario.breakeven.toFixed(2)}`} />}
            {scenario.expiration && <Mini label="Expiration" value={scenario.expiration} />}
            {scenario.strikes && <Mini label="Strikes" value={scenario.strikes} />}
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex gap-2" data-testid="text-review-warnings">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span>Main risk: {scenario.mainRisk}. Software-generated scenario for self-directed review.</span>
          </div>

          <label className="flex items-start gap-2 cursor-pointer" data-testid="label-radar-acknowledge">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(!!v)}
              data-testid="checkbox-radar-acknowledge"
            />
            <span className="leading-snug text-xs">
              I understand this is a self-directed order. VCP Trader AI is not providing investment advice,
              and I am responsible for this order.
            </span>
          </label>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={handleClose} data-testid="button-radar-cancel">
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          {brokerConnected ? (
            <Button
              disabled={!acknowledged || sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
              data-testid="button-radar-send"
            >
              <Send className="h-4 w-4 mr-1" />
              Send to Broker
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/settings")}
              data-testid="button-radar-connect"
            >
              <Link2 className="h-4 w-4 mr-1" />
              Connect Broker to use self-directed InstaTrade
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
