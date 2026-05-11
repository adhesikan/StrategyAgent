import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Radar,
  Filter,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Send,
  Link2,
  TestTube2,
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
  dataMode: "live" | "simulated";
  isOptions: boolean;
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
  dataMode: "live" | "simulated";
  buyingPower: number | null;
  positionsCount: number | null;
  lastRefresh: string;
  universeSize: number;
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
  maxLoss: 200,
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

function buildQueryParams(f: RadarFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.strategyType !== "any") params.set("strategyType", f.strategyType);
  if (f.bias !== "any") params.set("bias", f.bias);
  params.set("maxLoss", String(f.maxLoss));
  params.set("minGrade", f.minGrade);
  params.set("timeHorizon", f.timeHorizon);
  params.set("universe", f.universe);
  if (f.customSymbols.trim()) params.set("customSymbols", f.customSymbols.trim());
  if (f.minStockVolume) params.set("minStockVolume", f.minStockVolume);
  if (f.minOptionOpenInterest) params.set("minOptionOpenInterest", f.minOptionOpenInterest);
  if (f.minOptionVolume) params.set("minOptionVolume", f.minOptionVolume);
  if (f.maxBidAskSpreadPct) params.set("maxBidAskSpreadPct", f.maxBidAskSpreadPct);
  if (f.avoidEarningsDays) params.set("avoidEarningsDays", f.avoidEarningsDays);
  if (f.minRewardRisk) params.set("minRewardRisk", f.minRewardRisk);
  if (f.excludeCurrentHoldings) params.set("excludeCurrentHoldings", "true");
  if (f.includeOnlyCurrentHoldings) params.set("includeOnlyCurrentHoldings", "true");
  return params;
}

export default function OpportunityRadarPage() {
  const [filters, setFilters] = useState<RadarFilters>(DEFAULT_FILTERS);
  const [explainScenario, setExplainScenario] = useState<CandidateScenario | null>(null);
  const [reviewScenario, setReviewScenario] = useState<CandidateScenario | null>(null);
  const [newsScenario, setNewsScenario] = useState<CandidateScenario | null>(null);
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
          Scenarios are software-generated for informational and educational purposes only. They are not
          investment advice or recommendations. You decide whether to place any order.
        </p>
      </header>

      <BrokerStatusCard data={data} isLoading={isLoading} onRefresh={() => refetch()} isFetching={isFetching} />

      <FilterPanel filters={filters} onChange={updateFilter} onApply={() => refetch()} />

      <SentimentSortBar
        sortBy={sortBy}
        onSortChange={setSortBy}
        sentimentFilter={sentimentFilter}
        onSentimentChange={setSentimentFilter}
      />

      <RankedList
        data={applySentimentSort(data, sortBy, sentimentFilter)}
        isLoading={isLoading}
        onExplain={(s) => {
          setExplainScenario(s);
          logScenarioAction(s, "reviewed");
        }}
        onReview={(s) => {
          setReviewScenario(s);
          logScenarioAction(s, "reviewed");
        }}
        onPaperTrade={(s) => logScenarioAction(s, "paper_traded")}
        onPrepareOrder={(s) => {
          setReviewScenario(s);
          logScenarioAction(s, "prepared_order");
        }}
        onViewNews={(s) => setNewsScenario(s)}
      />

      <ExplanationDrawer scenario={explainScenario} onClose={() => setExplainScenario(null)} />
      <NewsContextDrawer scenario={newsScenario} onClose={() => setNewsScenario(null)} />

      <OrderReviewDialog
        scenario={reviewScenario}
        brokerConnected={isConnected}
        onClose={() => setReviewScenario(null)}
      />

      <ComplianceFooter />
    </div>
  );
}

async function logScenarioAction(scenario: CandidateScenario, action: string, complianceAcknowledged = false) {
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
              value={dataMode === "live" ? "Live" : "Simulated"}
              tone={dataMode === "live" ? "green" : "amber"}
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
              <StatusChip label="Data mode" value="Simulated" tone="amber" testId="chip-data-mode" />
              <StatusChip
                label="Last refresh"
                value={data?.lastRefresh ? new Date(data.lastRefresh).toLocaleTimeString() : "—"}
                tone="neutral"
                testId="chip-last-refresh"
              />
            </div>
            <p className="text-sm text-muted-foreground" data-testid="text-no-broker-msg">
              You can explore simulated scenarios now. Connect your broker for live market data, account-aware
              risk checks, and self-directed order previews.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" data-testid="button-continue-simulated">
                Continue Simulated
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
  onApply,
}: {
  filters: RadarFilters;
  onChange: <K extends keyof RadarFilters>(key: K, value: RadarFilters[K]) => void;
  onApply: () => void;
}) {
  return (
    <Card data-testid="card-filters">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="h-4 w-4" />
          Filters
        </CardTitle>
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

          <FilterField label="Universe">
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
          <Button size="sm" onClick={onApply} data-testid="button-apply-filters">
            <Filter className="h-4 w-4 mr-1" />
            Apply Filters
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
  onPaperTrade,
  onPrepareOrder,
  onViewNews,
}: {
  data?: RadarResult;
  isLoading: boolean;
  onExplain: (s: CandidateScenario) => void;
  onReview: (s: CandidateScenario) => void;
  onPaperTrade: (s: CandidateScenario) => void;
  onPrepareOrder: (s: CandidateScenario) => void;
  onViewNews: (s: CandidateScenario) => void;
}) {
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
    return (
      <Card data-testid="card-empty-state">
        <CardContent className="p-8 text-center space-y-2">
          <ListChecks className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Nothing passed your filters right now.</p>
          <p className="text-xs text-muted-foreground">
            Try lowering the minimum grade, expanding the universe, or increasing max risk.
          </p>
          {data?.hiddenByGuardrails ? (
            <p className="text-xs text-muted-foreground" data-testid="text-hidden-count">
              {data.hiddenByGuardrails} scenarios hidden because they did not meet your limits.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="text-results-heading">
          Ranked candidate scenarios
        </h2>
        {data.hiddenByGuardrails > 0 && (
          <Badge variant="outline" data-testid="badge-hidden-count">
            {data.hiddenByGuardrails} hidden by your limits
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.candidates.map((c) => (
          <CandidateCard
            key={c.id}
            scenario={c}
            onExplain={() => onExplain(c)}
            onReview={() => onReview(c)}
            onPaperTrade={() => onPaperTrade(c)}
            onPrepareOrder={() => onPrepareOrder(c)}
            onViewNews={() => onViewNews(c)}
          />
        ))}
      </div>
    </div>
  );
}

function CandidateCard({
  scenario,
  onExplain,
  onReview,
  onPaperTrade,
  onPrepareOrder,
  onViewNews,
}: {
  scenario: CandidateScenario;
  onExplain: () => void;
  onReview: () => void;
  onPaperTrade: () => void;
  onPrepareOrder: () => void;
  onViewNews: () => void;
}) {
  return (
    <Card className="hover-elevate" data-testid={`card-scenario-${scenario.symbol}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground" data-testid={`text-rank-${scenario.symbol}`}>#{scenario.rank}</span>
              <span className="font-bold text-lg" data-testid={`text-symbol-${scenario.symbol}`}>{scenario.symbol}</span>
              <Badge variant="outline" className={GRADE_BADGE[scenario.finalGrade]} data-testid={`badge-grade-${scenario.symbol}`}>
                {scenario.finalGrade}
              </Badge>
              <Badge variant="outline" className={BIAS_BADGE[scenario.bias]} data-testid={`badge-bias-${scenario.symbol}`}>
                {scenario.bias}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground" data-testid={`text-company-${scenario.symbol}`}>
              {scenario.companyName ?? ""}
            </p>
            <p className="text-xs mt-1" data-testid={`text-strategy-${scenario.symbol}`}>
              {STRATEGY_LABEL[scenario.strategyType]}
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
          <Button size="sm" variant="outline" onClick={onPaperTrade} data-testid={`button-paper-${scenario.symbol}`}>
            <TestTube2 className="h-4 w-4 mr-1" />
            Paper Trade
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

function SubScore({ label, value }: { label: string; value: number }) {
  const tone = value >= 80 ? "bg-emerald-500/15 text-emerald-300" : value >= 60 ? "bg-amber-500/10 text-amber-300" : "bg-zinc-500/10 text-zinc-300";
  return (
    <div className={`rounded px-1.5 py-0.5 text-center ${tone}`}>
      <div className="opacity-70">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Mini({ label, value, className, testId }: { label: string; value: string; className?: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className={`font-medium ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function ExplanationDrawer({ scenario, onClose }: { scenario: CandidateScenario | null; onClose: () => void }) {
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
                These factors describe how the scenario was generated by the software. They are not a recommendation
                or a prediction. Past behavior of similar setups does not guarantee future results.
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

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

function OrderReviewDialog({
  scenario,
  brokerConnected,
  onClose,
}: {
  scenario: CandidateScenario | null;
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

  const paperMutation = useMutation({
    mutationFn: async () => {
      if (!scenario) return null;
      await logScenarioAction(scenario, "paper_traded");
    },
    onSuccess: () => {
      toast({ title: "Paper trade logged", description: "Recorded in your scenario history." });
      handleClose();
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
              <Badge variant="outline">{STRATEGY_LABEL[scenario.strategyType]}</Badge>
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
              I understand this is a self-directed order. Strategy Agent is not providing investment advice,
              and I am responsible for this order.
            </span>
          </label>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={handleClose} data-testid="button-radar-cancel">
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => paperMutation.mutate()}
            disabled={paperMutation.isPending}
            data-testid="button-radar-paper"
          >
            <TestTube2 className="h-4 w-4 mr-1" />
            Paper Trade
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

function SentimentChip({
  scenario,
  onViewNews,
}: {
  scenario: CandidateScenario;
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

function NewsContextDrawer({
  scenario,
  onClose,
}: {
  scenario: CandidateScenario | null;
  onClose: () => void;
}) {
  const open = !!scenario;
  const symbol = scenario?.symbol;
  const { data, isLoading } = useQuery<SymbolSentimentResponse>({
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
