import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ViewToggle, useViewMode } from "@/components/view-toggle";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Radar,
  Filter,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Send,
  Link2,
  ListChecks,
  ChevronDown,
  X,
  RefreshCw,
  Newspaper,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  ArrowUpDown,
  Landmark,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ComplianceFooter } from "@/components/trading-shell";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { HelpLink } from "@/components/help-link";
import { CongressFlowEmbed } from "@/components/congressflow-embed";
import {
  ScenarioCard as CandidateCard,
  ExplanationDrawer,
  Mini,
  SentimentChip,
  NewsContextDrawer,
  CongressActivityDrawer,
  OrderReviewDialog,
  logScenarioAction,
  tradeUrlForScenario,
} from "@/components/radar-scenario-card";

type Bias = "any" | "bullish" | "bearish" | "neutral";
type StrategyType =
  | "any"
  | "stock_swing"
  | "long_call"
  | "long_put"
  | "debit_spread"
  | "covered_call"
  | "cash_secured_put";
type Grade = "A+" | "A" | "B" | "C";
type TimeHorizon = "intraday" | "1_5d" | "1_4w" | "30_60d";
type UniverseId = "watchlist" | "large_cap" | "high_volume" | "options_liquid" | "custom";

interface CandidateScenario {
  id: string;
  rank: number;
  symbol: string;
  companyName?: string;
  strategyType: Exclude<StrategyType, "any">;
  bias: Exclude<Bias, "any">;
  finalGrade: Grade;
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
  timeHorizon: TimeHorizon;
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
  sentiment?: SentimentBlock;
}

interface SentimentBlock {
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

interface NewsArticleContext {
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

interface AggregatedSnapshotResponse {
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

interface SymbolSentimentResponse {
  symbol: string;
  snapshot: AggregatedSnapshotResponse | null;
  articles: NewsArticleContext[];
  stale: boolean;
  sources: { news: "live" | "mock"; sentiment: "openai" | "rule_based" };
  disclaimer: string;
}

type SortOption = "score_desc" | "sentiment_desc" | "sentiment_asc" | "buzz_desc";
type SentimentFilter = "any" | "bullish" | "bearish" | "neutral_or_mixed" | "available";

interface RadarResult {
  candidates: CandidateScenario[];
  hiddenByGuardrails: number;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  buyingPower: number | null;
  positionsCount: number | null;
  lastRefresh: string;
  universeSize: number;
  universeSource?: "custom" | "watchlist" | "starter_fallback" | "large_cap" | "high_volume" | "options_liquid";
  universeLabel?: string;
  liveQuoteCount?: number;
  quoteFetchError?: string | null;
  notes: string[];
}

const STRATEGY_LABEL: Record<Exclude<StrategyType, "any">, string> = {
  stock_swing: "Stock Swing",
  long_call: "Long Call",
  long_put: "Long Put",
  debit_spread: "Debit Spread",
  covered_call: "Covered Call",
  cash_secured_put: "Cash-Secured Put",
};

const BIAS_BADGE: Record<Exclude<Bias, "any">, string> = {
  bullish: "border-emerald-500/40 text-emerald-400",
  bearish: "border-rose-500/40 text-rose-400",
  neutral: "border-sky-500/40 text-sky-400",
};

const GRADE_BADGE: Record<Grade, string> = {
  "A+": "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  "A": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "B": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "C": "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

interface RadarFilters {
  strategyType: StrategyType;
  bias: Bias;
  maxLoss: number;
  minGrade: Grade;
  timeHorizon: TimeHorizon;
  universe: UniverseId;
  customSymbols: string;
  minStockVolume: string;
  minOptionOpenInterest: string;
  minOptionVolume: string;
  maxBidAskSpreadPct: string;
  avoidEarningsDays: string;
  minRewardRisk: string;
  excludeCurrentHoldings: boolean;
  includeOnlyCurrentHoldings: boolean;
}

const DEFAULT_FILTERS: RadarFilters = {
  strategyType: "any",
  bias: "any",
  maxLoss: 2000,
  minGrade: "C",
  timeHorizon: "1_4w",
  universe: "watchlist",
  customSymbols: "",
  minStockVolume: "",
  minOptionOpenInterest: "",
  minOptionVolume: "",
  maxBidAskSpreadPct: "",
  avoidEarningsDays: "7",
  minRewardRisk: "",
  excludeCurrentHoldings: false,
  includeOnlyCurrentHoldings: false,
};

// Scan-shaping params are sent to the server — changing these triggers a rescan because they
// affect which symbols are scanned, how scenarios are constructed (incl. position sizing via
// maxLoss), and which strategy is applied per symbol. All other filters
// (minGrade, liquidity floors, R/R, holdings, earnings) are PURE display filters applied
// client-side after the scan returns, so users can retune them without rescanning.
function buildQueryParams(f: RadarFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.strategyType !== "any") params.set("strategyType", f.strategyType);
  if (f.bias !== "any") params.set("bias", f.bias);
  params.set("timeHorizon", f.timeHorizon);
  params.set("universe", f.universe);
  // maxLoss is sent because the server uses it for position sizing, not just filtering.
  // The server no longer hides candidates by maxLoss — the client post-filter does that below.
  params.set("maxLoss", String(f.maxLoss));
  if (f.customSymbols.trim()) params.set("customSymbols", f.customSymbols.trim());
  return params;
}

const GRADE_RANK: Record<Grade, number> = { "A+": 4, "A": 3, "B": 2, "C": 1 };

function applyClientFilters(candidates: CandidateScenario[], f: RadarFilters): CandidateScenario[] {
  const minStockVol = Number(f.minStockVolume) || 0;
  const minOI = Number(f.minOptionOpenInterest) || 0;
  const minOptVol = Number(f.minOptionVolume) || 0;
  const maxSpread = Number(f.maxBidAskSpreadPct) || 0;
  const avoidEarn = Number(f.avoidEarningsDays) || 0;
  const minRR = Number(f.minRewardRisk) || 0;

  return candidates.filter((c) => {
    if (c.maxLoss > f.maxLoss) return false;
    if (GRADE_RANK[c.finalGrade] < GRADE_RANK[f.minGrade]) return false;
    if (minRR > 0 && c.rewardRisk > 0 && c.rewardRisk < minRR) return false;
    if (minStockVol > 0 && c.liquidityMetrics && c.liquidityMetrics.stockVolume < minStockVol) return false;
    if (c.isOptions && c.liquidityMetrics) {
      const lm = c.liquidityMetrics;
      if (minOI > 0 && lm.optionOpenInterest != null && lm.optionOpenInterest < minOI) return false;
      if (minOptVol > 0 && lm.optionVolume != null && lm.optionVolume < minOptVol) return false;
      if (maxSpread > 0 && lm.bidAskSpreadPct != null && lm.bidAskSpreadPct > maxSpread) return false;
    }
    if (avoidEarn > 0 && c.earningsInDays != null && c.earningsInDays >= 0 && c.earningsInDays <= avoidEarn) {
      return false;
    }
    if (f.excludeCurrentHoldings && c.currentlyHeld) return false;
    if (f.includeOnlyCurrentHoldings && !c.currentlyHeld) return false;
    return true;
  });
}

export default function OpportunityRadarPage() {
  const [, navigate] = useLocation();
  const [filters, setFilters] = useState<RadarFilters>(DEFAULT_FILTERS);
  const [explainScenario, setExplainScenario] = useState<CandidateScenario | null>(null);
  const [reviewScenario, setReviewScenario] = useState<CandidateScenario | null>(null);
  const [newsScenario, setNewsScenario] = useState<CandidateScenario | null>(null);
  const [congressSymbol, setCongressSymbol] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("score_desc");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("any");
  const { isConnected } = useBrokerStatus();

  const queryString = useMemo(() => buildQueryParams(filters).toString(), [filters]);
  const queryUrl = `/api/radar/scenarios?${queryString}`;

  const { data, isLoading, isFetching, refetch } = useQuery<RadarResult>({
    queryKey: ["/api/radar/scenarios", queryString],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load scenarios");
      return res.json();
    },
  });

  const updateFilter = <K extends keyof RadarFilters>(key: K, value: RadarFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const filteredData = useMemo<RadarResult | undefined>(() => {
    if (!data) return data;
    const visible = applyClientFilters(data.candidates, filters);
    return { ...data, candidates: visible };
  }, [data, filters]);

  const totalScanned = data?.candidates.length ?? 0;
  const visibleCount = filteredData?.candidates.length ?? 0;
  const filteredOutCount = totalScanned - visibleCount;

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-6">
      <header className="space-y-2" data-testid="header-opportunity-radar">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
            <Radar className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-radar-title">
                Opportunity Radar
              </h1>
              <HelpLink section="radar" />
            </div>
            <p className="text-sm text-muted-foreground" data-testid="text-radar-subtitle">
              AI-ranked stock and options scenarios for review — based on market data, sentiment, liquidity,
              and your selected limits.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="text-radar-compliance-microcopy">
          Scenarios are AI-generated for informational and educational purposes only. They are not
          investment advice or recommendations. You decide whether to place any order.
        </p>
      </header>

      <BrokerStatusCard data={data} isLoading={isLoading} onRefresh={() => refetch()} isFetching={isFetching} />

      <FilterPanel
        filters={filters}
        onChange={updateFilter}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        totalScanned={totalScanned}
        visibleCount={visibleCount}
        filteredOutCount={filteredOutCount}
        serverHidden={data?.hiddenByGuardrails ?? 0}
      />

      <SentimentSortBar
        sortBy={sortBy}
        onSortChange={setSortBy}
        sentimentFilter={sentimentFilter}
        onSentimentChange={setSentimentFilter}
      />

      <RankedList
        data={applySentimentSort(filteredData, sortBy, sentimentFilter)}
        isLoading={isLoading}
        onExplain={(s) => {
          setExplainScenario(s);
          logScenarioAction(s, "reviewed");
        }}
        onReview={(s) => {
          logScenarioAction(s, "reviewed");
          navigate(tradeUrlForScenario(s));
        }}
        onPrepareOrder={(s) => {
          setReviewScenario(s);
          logScenarioAction(s, "prepared_order");
        }}
        onViewNews={(s) => setNewsScenario(s)}
        onViewCongress={(s) => setCongressSymbol(s.symbol)}
      />

      <ExplanationDrawer scenario={explainScenario} onClose={() => setExplainScenario(null)} />
      <NewsContextDrawer scenario={newsScenario} onClose={() => setNewsScenario(null)} />
      <CongressActivityDrawer symbol={congressSymbol} onClose={() => setCongressSymbol(null)} />

      <OrderReviewDialog
        scenario={reviewScenario}
        brokerConnected={isConnected}
        onClose={() => setReviewScenario(null)}
      />

      <ComplianceFooter />
    </div>
  );
}


function BrokerStatusCard({
  data,
  isLoading,
  onRefresh,
  isFetching,
}: {
  data?: RadarResult;
  isLoading: boolean;
  onRefresh: () => void;
  isFetching: boolean;
}) {
  const brokerConnected = data?.brokerConnected ?? false;
  const dataMode = data?.dataMode ?? "simulated";
  const universeLabel = data?.universeLabel
    ? `${data.universeLabel}${data?.universeSize ? ` · ${data.universeSize}` : ""}`
    : "—";
  const universeTone: "amber" | "neutral" =
    data?.universeSource === "starter_fallback" ? "amber" : "neutral";

  return (
    <Card data-testid="card-broker-status">
      <CardContent className="p-4 md:p-5">
        {brokerConnected ? (
          <div className="flex flex-wrap items-center gap-3 md:gap-6">
            <StatusChip
              label="Broker"
              value="Connected"
              tone="green"
              testId="chip-broker"
            />
            <StatusChip
              label="Data mode"
              value={
                dataMode === "live"
                  ? "Live"
                  : dataMode === "mixed"
                    ? `Partial Live${data?.liveQuoteCount != null && data?.universeSize ? ` (${data.liveQuoteCount}/${data.universeSize})` : ""}`
                    : "Delayed reference"
              }
              tone={dataMode === "live" ? "green" : dataMode === "mixed" ? "amber" : "amber"}
              testId="chip-data-mode"
            />
            <StatusChip
              label="Buying power"
              value={data?.buyingPower != null ? `$${data.buyingPower.toLocaleString()}` : "—"}
              tone="neutral"
              testId="chip-buying-power"
            />
            <StatusChip
              label="Positions"
              value={data?.positionsCount != null ? String(data.positionsCount) : "—"}
              tone="neutral"
              testId="chip-positions"
            />
            <StatusChip
              label="Stock list"
              value={universeLabel}
              tone={universeTone}
              testId="chip-universe"
            />
            <StatusChip
              label="Last refresh"
              value={data?.lastRefresh ? new Date(data.lastRefresh).toLocaleTimeString() : "—"}
              tone="neutral"
              testId="chip-last-refresh"
            />
            <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isFetching} data-testid="button-refresh-status">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip label="Broker" value="Not Connected" tone="amber" testId="chip-broker" />
              <StatusChip label="Data mode" value="Delayed reference" tone="amber" testId="chip-data-mode" />
              <StatusChip
                label="Stock list"
                value={universeLabel}
                tone={universeTone}
                testId="chip-universe"
              />
              <StatusChip
                label="Last refresh"
                value={data?.lastRefresh ? new Date(data.lastRefresh).toLocaleTimeString() : "—"}
                tone="neutral"
                testId="chip-last-refresh"
              />
            </div>
            <p className="text-sm text-muted-foreground" data-testid="text-no-broker-msg">
              You're in Analysis Mode — explore AI-ranked candidate scenarios with delayed reference data. Connect your broker for live market data, account-aware
              risk checks, and self-directed order previews.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" data-testid="button-continue-simulated">
                Continue in Analysis Mode
              </Button>
              <Button
                size="sm"
                onClick={() => (window.location.href = "/settings")}
                data-testid="button-connect-broker"
              >
                <Link2 className="h-4 w-4 mr-1" />
                Connect Broker
              </Button>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="text-xs text-muted-foreground mt-3" data-testid="text-status-loading">
            Scanning market data, sentiment, liquidity, and your limits…
          </div>
        )}
        {data?.notes && data.notes.length > 0 && (
          <div className="mt-3 space-y-1.5" data-testid="list-radar-notes">
            {data.notes.map((n, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-muted-foreground border border-border/60 rounded-md px-2 py-1.5"
                data-testid={`note-radar-${i}`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusChip({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "neutral";
  testId: string;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/40 text-emerald-300"
      : tone === "amber"
        ? "border-amber-500/40 text-amber-300"
        : "border-border text-foreground";
  return (
    <div className="flex flex-col" data-testid={testId}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${toneClass} mt-0.5 w-fit`}>
        {value}
      </span>
    </div>
  );
}

function FilterPanel({
  filters,
  onChange,
  onReset,
  totalScanned,
  visibleCount,
  filteredOutCount,
  serverHidden,
}: {
  filters: RadarFilters;
  onChange: <K extends keyof RadarFilters>(key: K, value: RadarFilters[K]) => void;
  onReset: () => void;
  totalScanned: number;
  visibleCount: number;
  filteredOutCount: number;
  serverHidden: number;
}) {
  return (
    <Card data-testid="card-filters">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-filter-help">
              Most filters update the visible results instantly. Strategy, Bias, Time horizon, Stock list and
              Max loss change how scenarios are built and will rerun the scan.
            </p>
          </div>
          {totalScanned > 0 && (
            <span className="text-xs text-muted-foreground" data-testid="text-filter-counts">
              Showing <span className="font-medium text-foreground">{visibleCount}</span> of {totalScanned} scanned
              {filteredOutCount > 0 ? ` · ${filteredOutCount} hidden by filters` : ""}
              {serverHidden > 0 ? ` · ${serverHidden} unaffordable / low quality` : ""}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <FilterField label="Strategy">
            <Select value={filters.strategyType} onValueChange={(v) => onChange("strategyType", v as StrategyType)}>
              <SelectTrigger data-testid="select-strategy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="stock_swing">Stock swing</SelectItem>
                <SelectItem value="long_call">Long call</SelectItem>
                <SelectItem value="long_put">Long put</SelectItem>
                <SelectItem value="debit_spread">Debit spread</SelectItem>
                <SelectItem value="covered_call">Covered call</SelectItem>
                <SelectItem value="cash_secured_put">Cash-secured put</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Bias">
            <Select value={filters.bias} onValueChange={(v) => onChange("bias", v as Bias)}>
              <SelectTrigger data-testid="select-bias"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="bullish">Bullish</SelectItem>
                <SelectItem value="bearish">Bearish</SelectItem>
                <SelectItem value="neutral">Neutral / income</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Max loss">
            <Select value={String(filters.maxLoss)} onValueChange={(v) => onChange("maxLoss", Number(v))}>
              <SelectTrigger data-testid="select-max-loss"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50">$50</SelectItem>
                <SelectItem value="100">$100</SelectItem>
                <SelectItem value="200">$200</SelectItem>
                <SelectItem value="500">$500</SelectItem>
                <SelectItem value="1000">$1,000</SelectItem>
                <SelectItem value="2500">$2,500</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Min grade">
            <Select value={filters.minGrade} onValueChange={(v) => onChange("minGrade", v as Grade)}>
              <SelectTrigger data-testid="select-min-grade"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A+">A+</SelectItem>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Time horizon">
            <Select value={filters.timeHorizon} onValueChange={(v) => onChange("timeHorizon", v as TimeHorizon)}>
              <SelectTrigger data-testid="select-time-horizon"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="intraday">Intraday</SelectItem>
                <SelectItem value="1_5d">1–5 days</SelectItem>
                <SelectItem value="1_4w">1–4 weeks</SelectItem>
                <SelectItem value="30_60d">30–60 days</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Stock list">
            <Select value={filters.universe} onValueChange={(v) => onChange("universe", v as UniverseId)}>
              <SelectTrigger data-testid="select-universe"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="watchlist">Watchlist</SelectItem>
                <SelectItem value="large_cap">Large cap</SelectItem>
                <SelectItem value="high_volume">High volume</SelectItem>
                <SelectItem value="options_liquid">Options liquid</SelectItem>
                <SelectItem value="custom">Custom symbols</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          {filters.universe === "custom" && (
            <FilterField label="Custom symbols (comma-separated)" wide>
              <Input
                value={filters.customSymbols}
                onChange={(e) => onChange("customSymbols", e.target.value)}
                placeholder="AAPL, MSFT, NVDA"
                data-testid="input-custom-symbols"
              />
            </FilterField>
          )}
        </div>

        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border rounded-md">
            <AccordionTrigger className="px-3 text-sm" data-testid="accordion-advanced">
              <span className="flex items-center gap-2"><ChevronDown className="h-4 w-4" /> Advanced filters</span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <FilterField label="Min stock volume">
                  <Input value={filters.minStockVolume} onChange={(e) => onChange("minStockVolume", e.target.value)} placeholder="e.g. 1000000" data-testid="input-min-stock-volume" />
                </FilterField>
                <FilterField label="Min option OI">
                  <Input value={filters.minOptionOpenInterest} onChange={(e) => onChange("minOptionOpenInterest", e.target.value)} placeholder="e.g. 500" data-testid="input-min-oi" />
                </FilterField>
                <FilterField label="Min option volume">
                  <Input value={filters.minOptionVolume} onChange={(e) => onChange("minOptionVolume", e.target.value)} placeholder="e.g. 100" data-testid="input-min-option-volume" />
                </FilterField>
                <FilterField label="Max bid/ask spread %">
                  <Input value={filters.maxBidAskSpreadPct} onChange={(e) => onChange("maxBidAskSpreadPct", e.target.value)} placeholder="e.g. 5" data-testid="input-max-spread" />
                </FilterField>
                <FilterField label="Avoid earnings within (days)">
                  <Input value={filters.avoidEarningsDays} onChange={(e) => onChange("avoidEarningsDays", e.target.value)} placeholder="7" data-testid="input-avoid-earnings" />
                </FilterField>
                <FilterField label="Min reward / risk">
                  <Input value={filters.minRewardRisk} onChange={(e) => onChange("minRewardRisk", e.target.value)} placeholder="e.g. 1.5" data-testid="input-min-rr" />
                </FilterField>
                <label className="flex items-center gap-2 text-sm md:col-span-1">
                  <Checkbox checked={filters.excludeCurrentHoldings} onCheckedChange={(v) => onChange("excludeCurrentHoldings", !!v)} data-testid="checkbox-exclude-holdings" />
                  Exclude current holdings
                </label>
                <label className="flex items-center gap-2 text-sm md:col-span-1">
                  <Checkbox checked={filters.includeOnlyCurrentHoldings} onCheckedChange={(v) => onChange("includeOnlyCurrentHoldings", !!v)} data-testid="checkbox-only-holdings" />
                  Include current holdings only
                </label>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onReset} data-testid="button-reset-filters">
            Reset filters
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? "md:col-span-3 lg:col-span-5" : ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RankedList({
  data,
  isLoading,
  onExplain,
  onReview,
  onPrepareOrder,
  onViewNews,
  onViewCongress,
}: {
  data?: RadarResult;
  isLoading: boolean;
  onExplain: (s: CandidateScenario) => void;
  onReview: (s: CandidateScenario) => void;
  onPrepareOrder: (s: CandidateScenario) => void;
  onViewNews: (s: CandidateScenario) => void;
  onViewCongress: (s: CandidateScenario) => void;
}) {
  const [viewMode, setViewMode] = useViewMode("opportunity-radar");
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="loading-radar">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-56 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (!data || data.candidates.length === 0) {
    // data.candidates here is the post-filter list. If raw scan returned nothing,
    // the empty state is "scan returned nothing". Otherwise filters hid everything.
    return (
      <Card data-testid="card-empty-state">
        <CardContent className="p-8 text-center space-y-2">
          <ListChecks className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium" data-testid="text-empty-title">
            Your filters hid every result.
          </p>
          <p className="text-xs text-muted-foreground">
            Loosen a filter above (or click Reset filters) to see scan results.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" data-testid="text-results-heading">
          Ranked candidate scenarios
        </h2>
        <div className="flex items-center gap-2">
          {data.hiddenByGuardrails > 0 && (
            <Badge variant="outline" data-testid="badge-hidden-count">
              {data.hiddenByGuardrails} hidden by your limits
            </Badge>
          )}
          <ViewToggle value={viewMode} onChange={setViewMode} testId="view-toggle-radar" />
        </div>
      </div>

      <div className={viewMode === "card" ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "flex flex-col gap-3 max-w-3xl"}>
        {data.candidates.map((c) => (
          <CandidateCard
            key={c.id}
            scenario={c}
            onExplain={() => onExplain(c)}
            onReview={() => onReview(c)}
            onPrepareOrder={() => onPrepareOrder(c)}
            onViewNews={() => onViewNews(c)}
            onViewCongress={() => onViewCongress(c)}
          />
        ))}
      </div>
    </div>
  );
}







// ---------- Sentiment helpers + components ----------

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

function applySentimentSort(
  data: RadarResult | undefined,
  sortBy: SortOption,
  sentimentFilter: SentimentFilter,
): RadarResult | undefined {
  if (!data) return data;
  let candidates = data.candidates.slice();

  if (sentimentFilter !== "any") {
    candidates = candidates.filter((c) => {
      const s = c.sentiment;
      if (sentimentFilter === "available") return !!s?.available;
      if (!s?.available) return false;
      if (sentimentFilter === "bullish") return s.label === "bullish";
      if (sentimentFilter === "bearish") return s.label === "bearish";
      if (sentimentFilter === "neutral_or_mixed") return s.label === "neutral" || s.label === "mixed";
      return true;
    });
  }

  switch (sortBy) {
    case "sentiment_desc":
      candidates.sort((a, b) => (b.sentiment?.rawScore ?? -101) - (a.sentiment?.rawScore ?? -101));
      break;
    case "sentiment_asc":
      candidates.sort((a, b) => (a.sentiment?.rawScore ?? 101) - (b.sentiment?.rawScore ?? 101));
      break;
    case "buzz_desc":
      candidates.sort((a, b) => (b.sentiment?.buzzScore ?? -1) - (a.sentiment?.buzzScore ?? -1));
      break;
    case "score_desc":
    default:
      candidates.sort((a, b) => b.finalScore - a.finalScore);
      break;
  }

  candidates = candidates.map((c, i) => ({ ...c, rank: i + 1 }));
  return { ...data, candidates };
}

function SentimentSortBar({
  sortBy,
  onSortChange,
  sentimentFilter,
  onSentimentChange,
}: {
  sortBy: SortOption;
  onSortChange: (v: SortOption) => void;
  sentimentFilter: SentimentFilter;
  onSentimentChange: (v: SentimentFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="bar-sentiment-sort">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <ArrowUpDown className="h-3 w-3" />
          Sort
        </Label>
        <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortOption)}>
          <SelectTrigger className="w-[200px]" data-testid="select-radar-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score_desc">Final score (high → low)</SelectItem>
            <SelectItem value="sentiment_desc">News sentiment (most positive)</SelectItem>
            <SelectItem value="sentiment_asc">News sentiment (most negative)</SelectItem>
            <SelectItem value="buzz_desc">News buzz (most coverage)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <Newspaper className="h-3 w-3" />
          Sentiment filter
        </Label>
        <Select value={sentimentFilter} onValueChange={(v) => onSentimentChange(v as SentimentFilter)}>
          <SelectTrigger className="w-[200px]" data-testid="select-sentiment-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any sentiment</SelectItem>
            <SelectItem value="available">Has news context</SelectItem>
            <SelectItem value="bullish">Bullish only</SelectItem>
            <SelectItem value="bearish">Bearish only</SelectItem>
            <SelectItem value="neutral_or_mixed">Neutral or mixed</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}


