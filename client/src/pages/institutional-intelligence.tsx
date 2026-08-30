import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Info,
  Layers3,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { apiErrorCode, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type HubTab = "stock" | "trends" | "rotation" | "discovery" | "multibagger";
type TrendMode = "accumulation" | "reduction" | "new-positions" | "exits";
type RotationKind = "sectors" | "industries" | "themes";

interface ApiEnvelope<T> {
  data: T;
  meta?: {
    quarter?: string | null;
    dataAsOf?: string | null;
    source?: string;
    limitations?: string[];
  };
}

interface StockAnalytics {
  symbol: string;
  quarter?: { label: string; periodEndDate: string };
  dataAsOf?: string | null;
  reportingManagerCount: number;
  reportedHolderCount: number;
  previousReportedHolderCount: number | null;
  holderCountChange: number | null;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  unchangedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  aggregateReportedShares: number | null;
  previousAggregateReportedShares: number | null;
  aggregateReportedShareChange: number | null;
  aggregateReportedShareChangePct: number | null;
  aggregateReportedValueDollars: number | null;
  topReportedHolders: Array<{
    managerId: string;
    managerName: string;
    reportedShares: number | null;
    previousReportedShares: number | null;
    reportedShareChange: number | null;
    reportedShareChangePct: number | null;
    reportedValueDollars: number | null;
    portfolioWeight: number | null;
    changeType: string | null;
  }>;
  largestReportedShareIncreases: Array<{
    managerId: string;
    managerName: string;
    reportedShares: number | null;
    previousReportedShares: number | null;
    reportedShareChange: number | null;
    reportedShareChangePct: number | null;
    reportedValueDollars: number | null;
    portfolioWeight: number | null;
    changeType: string | null;
  }>;
  largestReportedShareReductions: Array<{
    managerId: string;
    managerName: string;
    reportedShares: number | null;
    previousReportedShares: number | null;
    reportedShareChange: number | null;
    reportedShareChangePct: number | null;
    reportedValueDollars: number | null;
    portfolioWeight: number | null;
    changeType: string | null;
  }>;
  mappingCoverage?: { coveragePercent: number };
  breadth?: {
    increasingEntityCount: number;
    decreasingEntityCount: number;
    newEntityCount: number;
    exitedEntityCount: number;
    breadthRatio: number | null;
    direction: string;
  } | null;
  trend?: { direction: string; confidence: string; observations: number } | null;
  dataQuality?: { status: string; coveragePercent: number | null; warnings: string[] };
  modelVersion?: { name: string; version: string };
}

interface TrendQuarter {
  quarter: { label: string; periodEndDate: string };
  reportedHolderCount: number;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  aggregateReportedShares: number | null;
  aggregateReportedValue: number | null;
  breadthChange: number | null;
  shareTrend: number | null;
  persistence: number | null;
  increaseReductionBalance: number | null;
  hasComparablePriorQuarter: boolean;
}

interface StockTrend {
  symbol: string;
  quarters: TrendQuarter[];
  classification: string;
  dataQuality?: { status: string; coveragePercent: number | null; warnings: string[] };
}

interface LegacyStockData {
  status: string;
  symbol: string;
  periodOfReport: string | null;
  latestFilingDate: string | null;
  freshness: {
    status: string;
    daysSincePeriodEnd: number;
    daysSinceLatestFiling: number;
  } | null;
  coverage: {
    mappingStatus: string;
    eligibleHoldingCount: number;
    excludedHoldingCount: number;
    warnings: string[];
  } | null;
  summary: {
    reportingManagerCount: number;
    aggregateReportedShares: number | null;
    aggregateReportedValue: number | null;
    reportedSharesChange: number | null;
    reportedSharesChangePercent: number | null;
    trend: string;
    trendLabel: string;
  } | null;
  managerActivity: {
    new: number;
    increased: number;
    reduced: number;
    exited: number;
    unchanged: number;
  } | null;
  concentration: {
    topHolderPercentOfReportedShares: number | null;
    top5PercentOfReportedShares: number | null;
    top10PercentOfReportedShares: number | null;
    classification: string;
  } | null;
  historicalQuarters: Array<{
    periodLabel: string;
    aggregateReportedShares: number | null;
    reportingManagerCount: number;
    trend: string;
  }>;
  limitations: string[];
}

interface SignalData {
  status: string;
  score: number | null;
  label: string | null;
  latestQuarter: string | null;
  summary: string | null;
  scoreComponents?: Record<string, number | null>;
  dataQuality?: {
    mappingCoverage: number | null;
    comparableManagerCount: number;
    confidence: string;
  };
  freshness?: { delayed: boolean; periodEndDate: string | null };
}

interface RankingItem {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  currentReportedHolderCount: number;
  holderCountChange: number | null;
  newlyReportedHolderCount: number;
  increasedReportedHolderCount: number;
  reducedReportedHolderCount: number;
  noLongerReportedHolderCount: number;
  netHolderIncrease: number | null;
  aggregateReportedShareChangePct: number | null;
  aggregateReportedValue: number | null;
}

interface RankingResult {
  mode: string;
  quarter: { label: string; periodEndDate: string };
  previousQuarter: { label: string } | null;
  items: RankingItem[];
  totalCount: number;
  limit: number;
  offset: number;
  trackedManagerCount: number;
  dataQuality: { status: string; coveragePercent: number | null; warnings: string[] };
}

interface RotationRow {
  classification: string;
  classificationId?: string;
  currentReportedValue: number | null;
  previousReportedValue: number | null;
  reportedValueChange: number | null;
  reportedValueChangePct: number | null;
  managerCount: number;
  previousManagerCount: number | null;
  managerCountChange: number | null;
  newlyReportedPositionCount: number;
  increasedReportedPositionCount: number;
  reducedReportedPositionCount: number;
  noLongerReportedPositionCount: number;
}

interface RotationResult {
  kind: string;
  quarter: { label: string; periodEndDate: string };
  previousQuarter: { label: string } | null;
  classifications: RotationRow[];
  dataQuality: { status: string; coveragePercent: number | null; warnings: string[] };
}

interface DiscoveryResult {
  symbol: string;
  stage: string | null;
  score: number | null;
  availability: string;
  signals: Record<string, unknown>;
  evidence: Array<{
    label: string;
    normalizedScore: number | null;
    direction: string;
    explanation: string;
  }>;
  reasons: Array<{ summary: string; direction: string }>;
  context?: {
    dataQuarter: string | null;
    dataAsOf: string | null;
    reportingManagerCount: number | null;
    mappingCoveragePercent: number | null;
    warnings: string[];
  };
}

interface MultibaggerResult {
  symbol: string;
  modelVersion: string;
  overall: {
    score: number | null;
    availability: string;
    confidence: string;
  };
  dimensions: Record<string, {
    score: number | null;
    availability: string;
    evidence: Array<{ label: string; value: number | string | null; available: boolean; explanation: string }>;
    unavailableSignals: string[];
  }>;
  institutionalDiscovery: DiscoveryResult;
  optionalUpsideProfiles: Record<string, {
    multiple: number;
    classification: string;
    score: number | null;
    supportingFactors: Array<{ label: string; value: number | string | null; explanation: string }>;
    limitingFactors: Array<{ label: string; value: number | string | null; explanation: string }>;
  }>;
  profiles: Record<string, { score: number | null; availability: string; eligible: boolean; rationale: string }>;
  availableDimensionCount: number;
  unavailableDimensionCount: number;
  limitations: string[];
  disclaimer: string;
}

const TAB_ITEMS: Array<{ key: HubTab; label: string; icon: typeof Activity }> = [
  { key: "stock", label: "Stock view", icon: Building2 },
  { key: "trends", label: "Trends", icon: Activity },
  { key: "rotation", label: "Rotation", icon: Layers3 },
  { key: "discovery", label: "Institutional discovery", icon: Users },
  { key: "multibagger", label: "Multibagger discovery", icon: Sparkles },
];

const TREND_ITEMS: Array<{ key: TrendMode; label: string }> = [
  { key: "accumulation", label: "Accumulation" },
  { key: "reduction", label: "Reduction" },
  { key: "new-positions", label: "Newly reported" },
  { key: "exits", label: "No longer reported" },
];

const ROTATION_ITEMS: Array<{ key: RotationKind; label: string }> = [
  { key: "sectors", label: "Sectors" },
  { key: "industries", label: "Industries" },
  { key: "themes", label: "Themes" },
];

function fetchJson<T>(path: string): Promise<T> {
  return apiRequest("GET", path).then((response) => response.json());
}

function fetchV1<T>(path: string): Promise<T> {
  return fetchJson<ApiEnvelope<T>>(path).then((body) => body.data);
}

function isDataUnavailable(error: unknown): boolean {
  return apiErrorCode(error) === "DATA_UNAVAILABLE";
}

function symbolFromSearch(search: string): string | null {
  const raw = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("symbol");
  const normalized = raw?.trim().toUpperCase() ?? "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

export function symbolQueryOpensStock(querySymbol: string | null): boolean {
  return querySymbol !== null;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatUSD(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${formatNumber(value)}`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function toneForDirection(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  return value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-sky-600 dark:text-sky-400";
  return "text-amber-600 dark:text-amber-400";
}

function Disclosure() {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <Clock3 className="h-4 w-4 text-amber-500" />
      <AlertDescription className="text-xs text-muted-foreground">
        Form 13F disclosures are periodic and delayed. They reflect quarter-end reported holdings,
        may be filed up to 45 days after quarter-end, and cover tracked reporting managers—not all
        institutional activity or current positions.
      </AlertDescription>
    </Alert>
  );
}

function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

function EmptyState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center">
        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">{detail}</p>
        {onRetry && <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>}
      </CardContent>
    </Card>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-3 text-sm">
        <span>That research view could not be loaded. The data pipeline may be unavailable or have no completed snapshot.</span>
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </AlertDescription>
    </Alert>
  );
}

function Metric({ label, value, detail, valueClass }: { label: string; value: React.ReactNode; detail?: string; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", valueClass)}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function ReportedChangeCard({
  title,
  rows,
  emptyMessage,
  valueClass,
}: {
  title: string;
  rows: StockAnalytics["largestReportedShareIncreases"];
  emptyMessage: string;
  valueClass: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2">Manager</th>
                  <th className="pb-2 text-right">Reported shares</th>
                  <th className="pb-2 text-right">Previous shares</th>
                  <th className="pb-2 text-right">Share change</th>
                  <th className="pb-2 text-right">Change %</th>
                  <th className="pb-2 text-right">Portfolio weight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((holder) => (
                  <tr
                    key={`${holder.managerId}-${holder.managerName}`}
                    className="border-b last:border-0"
                  >
                    <td className="max-w-[220px] truncate py-2 pr-3 font-medium">
                      {holder.managerName}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatNumber(holder.reportedShares)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatNumber(holder.previousReportedShares)}
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", valueClass)}>
                      {formatNumber(holder.reportedShareChange)}
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", valueClass)}>
                      {formatPct(holder.reportedShareChangePct)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPct(holder.portfolioWeight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StockView({
  symbol,
  onOpenMultibagger,
}: {
  symbol: string;
  onOpenMultibagger: () => void;
}) {
  const analyticsQuery = useQuery<StockAnalytics>({
    queryKey: [`/api/institutional/v1/stocks/${symbol}?topN=20`],
    queryFn: () => fetchV1(`/api/institutional/v1/stocks/${symbol}?topN=20`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
  const trendQuery = useQuery<StockTrend>({
    queryKey: [`/api/institutional/v1/stocks/${symbol}/trend?historyQuarters=8`],
    queryFn: () => fetchV1(`/api/institutional/v1/stocks/${symbol}/trend?historyQuarters=8`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
  const legacyQuery = useQuery<LegacyStockData>({
    queryKey: [`/api/institutional/${symbol}`],
    queryFn: () => fetchJson(`/api/institutional/${symbol}?maxHolders=20`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
  const signalQuery = useQuery<SignalData>({
    queryKey: [`/api/institutional/signals/${symbol}`],
    queryFn: () => fetchJson(`/api/institutional/signals/${symbol}`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });

  if (
    analyticsQuery.isLoading ||
    trendQuery.isLoading ||
    (!analyticsQuery.data && !legacyQuery.data && legacyQuery.isLoading)
  ) {
    return <LoadingCards count={4} />;
  }
  const analyticsUnavailable = isDataUnavailable(analyticsQuery.error);
  const trendUnavailable = isDataUnavailable(trendQuery.error);
  const primaryHardError =
    (analyticsQuery.isError && !analyticsUnavailable) ||
    (trendQuery.isError && !trendUnavailable);
  if (
    !analyticsQuery.data &&
    !trendQuery.data &&
    !legacyQuery.data &&
    primaryHardError &&
    legacyQuery.isError
  ) {
    return <ErrorState onRetry={() => { void analyticsQuery.refetch(); void trendQuery.refetch(); void legacyQuery.refetch(); }} />;
  }

  const data = analyticsQuery.data;
  const trend = trendQuery.data;
  const legacy = legacyQuery.data?.summary ? legacyQuery.data : undefined;
  if (!data && !legacy) {
    return <EmptyState title={`No reported 13F data for ${symbol}`} detail="A completed institutional snapshot is required before this stock can be analyzed." />;
  }

  const score = signalQuery.data?.score ?? null;
  const quarters = trend?.quarters ?? legacy?.historicalQuarters ?? [];
  const quality = data?.dataQuality?.status ?? legacy?.status ?? "unavailable";
  const reportedShareChangePercent =
    data?.aggregateReportedShareChangePct ??
    (legacy?.summary?.reportedSharesChangePercent == null
      ? null
      : legacy.summary.reportedSharesChangePercent * 100);
  const warnings = [
    ...(data?.dataQuality?.warnings ?? []),
    ...(legacy?.limitations ?? []).slice(0, 3),
  ];

  return (
    <div className="space-y-5" data-testid="institutional-stock-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{symbol}</h2>
            <Badge variant="outline">Reported 13F evidence</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Holder breadth, quarter-over-quarter changes, and multi-quarter participation context.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenMultibagger}>
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Open deterministic discovery
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Accumulation score" value={score == null ? "Unavailable" : score} detail={signalQuery.data?.label ?? "Requires sufficient history"} valueClass={scoreColor(score)} />
        <Metric
          label="Reported holders"
          value={data?.reportedHolderCount ?? "—"}
          detail={
            data?.holderCountChange == null
              ? `Tracked 13F managers: ${data?.reportingManagerCount ?? "—"}`
              : `${data.holderCountChange >= 0 ? "+" : ""}${data.holderCountChange} QoQ · ${data.reportingManagerCount} tracked managers`
          }
        />
        <Metric label="Reported shares" value={formatNumber(data?.aggregateReportedShares ?? legacy?.summary?.aggregateReportedShares)} detail={formatPct(reportedShareChangePercent)} valueClass={toneForDirection(reportedShareChangePercent)} />
        <Metric label="Mapping coverage" value={data?.mappingCoverage?.coveragePercent == null ? "—" : `${data.mappingCoverage.coveragePercent.toFixed(0)}%`} detail={`Quality: ${quality}`} />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span><strong className="text-foreground">Data as of:</strong> {data?.dataAsOf ? formatDate(data.dataAsOf) : "Unavailable"}</span>
        {legacy?.freshness && <><span><strong className="text-foreground">Period:</strong> {formatDate(legacy.periodOfReport)}</span><span><strong className="text-foreground">Latest filing:</strong> {formatDate(legacy.latestFilingDate)}</span><span><strong className="text-foreground">Freshness:</strong> {legacy.freshness.status.replace("_", " ")}</span></>}
        <span><strong className="text-foreground">Signal:</strong> {signalQuery.data?.status ?? "Unavailable"}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Share trend and breadth</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Trend classification" value={trend?.classification ?? legacy?.summary?.trendLabel ?? "Unavailable"} valueClass="text-base capitalize" />
              <Metric label="Breadth direction" value={data?.breadth?.direction ?? "Unavailable"} detail={data?.breadth?.breadthRatio == null ? "No comparable denominator" : `${data.breadth.breadthRatio.toFixed(1)} ratio`} valueClass="text-base capitalize" />
            </div>
            {trend?.quarters && trend.quarters.length > 0 ? (
              <div className="space-y-2">
                {trend.quarters.slice(-6).map((quarter) => (
                  <div key={quarter.quarter.label} className="flex items-center gap-3 text-xs">
                    <span className="w-16 shrink-0 font-mono text-muted-foreground">{quarter.quarter.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(2, (quarter.reportedHolderCount / Math.max(1, data?.reportingManagerCount ?? quarter.reportedHolderCount)) * 100))}%` }} />
                    </div>
                    <span className="w-20 text-right tabular-nums">{quarter.reportedHolderCount} holders</span>
                    <span className={cn("w-16 text-right tabular-nums", toneForDirection(quarter.shareTrend))}>{formatPct(quarter.shareTrend)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">A minimum of two comparable quarters is required for the multi-quarter trend.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Quarterly reported activity</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Newly reported" value={data?.newlyReportedHolderCount ?? legacy?.managerActivity?.new ?? "—"} valueClass="text-emerald-600 dark:text-emerald-400" />
              <Metric label="Increased" value={data?.increasedReportedHolderCount ?? legacy?.managerActivity?.increased ?? "—"} valueClass="text-sky-600 dark:text-sky-400" />
              <Metric label="Reduced" value={data?.reducedReportedHolderCount ?? legacy?.managerActivity?.reduced ?? "—"} valueClass="text-amber-600 dark:text-amber-400" />
              <Metric label="No longer reported" value={data?.noLongerReportedHolderCount ?? legacy?.managerActivity?.exited ?? "—"} valueClass="text-rose-600 dark:text-rose-400" />
              <Metric label="Unchanged" value={data?.unchangedReportedHolderCount ?? legacy?.managerActivity?.unchanged ?? "—"} />
              <Metric label="Concentration" value={legacy?.concentration?.classification ?? "Unavailable"} valueClass="text-base capitalize" />
            </div>
            {legacy?.concentration && (
              <p className="mt-4 text-xs text-muted-foreground">
                Top reported holder: {legacy.concentration.topHolderPercentOfReportedShares == null ? "—" : `${(legacy.concentration.topHolderPercentOfReportedShares * 100).toFixed(1)}%`}
                {" · "}Top five: {legacy.concentration.top5PercentOfReportedShares == null ? "—" : `${(legacy.concentration.top5PercentOfReportedShares * 100).toFixed(1)}%`}
                {" · "}denominator is reported shares in the selected quarter.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Largest reported holders</CardTitle></CardHeader>
        <CardContent>
          {(data?.topReportedHolders ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No holder rows are available for this symbol.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Manager</th><th className="pb-2 text-right">Reported shares</th><th className="pb-2 text-right">Reported value</th><th className="pb-2 text-right">QoQ shares</th><th className="pb-2 text-right">Status</th></tr></thead>
                <tbody>
                  {(data?.topReportedHolders ?? []).map((holder) => (
                    <tr key={`${holder.managerId}-${holder.managerName}`} className="border-b last:border-0">
                      <td className="py-2 pr-3"><div className="max-w-[240px] truncate font-medium">{holder.managerName}</div><div className="text-[10px] text-muted-foreground">CIK {holder.managerId}</div></td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(holder.reportedShares)}</td>
                      <td className="py-2 text-right tabular-nums">{formatUSD(holder.reportedValueDollars)}</td>
                      <td className={cn("py-2 text-right tabular-nums", toneForDirection(holder.reportedShareChange))}>{formatNumber(holder.reportedShareChange)}</td>
                      <td className="py-2 text-right"><Badge variant="outline" className="text-[10px]">{holder.changeType?.replace("_", " ") ?? "Unavailable"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportedChangeCard
          title="Largest Reported Increases"
          rows={data?.largestReportedShareIncreases ?? []}
          emptyMessage="No reported increases are available for this symbol."
          valueClass="text-emerald-600 dark:text-emerald-400"
        />
        <ReportedChangeCard
          title="Largest Reported Reductions"
          rows={data?.largestReportedShareReductions ?? []}
          emptyMessage="No reported reductions are available for this symbol."
          valueClass="text-rose-600 dark:text-rose-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Accumulation components</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(signalQuery.data?.scoreComponents ?? {}).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between rounded bg-muted/30 px-3 py-2 text-xs">
                <span className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</span>
                <span className={cn("font-semibold tabular-nums", scoreColor(value))}>{value == null ? "Unavailable" : value}</span>
              </div>
            ))}
            {!signalQuery.data?.scoreComponents && <p className="text-xs text-muted-foreground">Component scores are unavailable until the signal has sufficient comparable data.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Data quality and limitations</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />This view describes reported Form 13F activity; it does not infer transaction dates or current positions.</p>
            {warnings.slice(0, 4).map((warning, index) => <p key={`${warning}-${index}`} className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{warning}</p>)}
            {signalQuery.data?.dataQuality && <p>Signal confidence: <strong className="text-foreground capitalize">{signalQuery.data.dataQuality.confidence}</strong>; comparable managers: {signalQuery.data.dataQuality.comparableManagerCount}.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrendsView() {
  const [mode, setMode] = useState<TrendMode>("accumulation");
  const [page, setPage] = useState(0);
  const limit = 20;
  const query = useQuery<RankingResult>({
    queryKey: [`/api/institutional/v1/trends/${mode}`, page],
    queryFn: () => fetchV1(`/api/institutional/v1/trends/${mode}?limit=${limit}&offset=${page * limit}`),
    staleTime: 5 * 60_000,
  });
  const total = query.data?.totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const unavailable = isDataUnavailable(query.error);

  return (
    <div className="space-y-5" data-testid="institutional-trends-view">
      <div><h2 className="text-xl font-semibold">Institutional activity trends</h2><p className="mt-1 text-sm text-muted-foreground">Server-ranked symbols using the selected quarter and tracked reporting-manager universe.</p></div>
      <div className="flex flex-wrap gap-2">
        {TREND_ITEMS.map((item) => <Button key={item.key} variant={mode === item.key ? "default" : "outline"} size="sm" onClick={() => { setMode(item.key); setPage(0); }}>{item.label}</Button>)}
      </div>
      {query.isLoading && <LoadingCards count={4} />}
      {query.isError && !unavailable && <ErrorState onRetry={() => void query.refetch()} />}
      {!query.isLoading && (unavailable || (query.data && query.data.items.length === 0)) && <EmptyState title="No ranked symbols in this view" detail="The selected activity category has no completed results for the current delayed Form 13F snapshot." onRetry={() => void query.refetch()} />}
      {query.data && query.data.items.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm">{TREND_ITEMS.find((item) => item.key === mode)?.label} · {query.data.quarter.label}</CardTitle><span className="text-xs text-muted-foreground">{total} symbols</span></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Symbol</th><th className="pb-2">Company</th><th className="pb-2">Sector</th><th className="pb-2 text-right">Reported holders</th><th className="pb-2 text-right">Holder change</th><th className="pb-2 text-right">Share trend</th><th className="pb-2 text-right">Reported value</th></tr></thead>
                <tbody>
                  {query.data.items.map((item) => <tr key={item.symbol} className="border-b last:border-0">
                    <td className="py-2 pr-3"><Link className="font-mono font-semibold text-primary hover:underline" href={`/institutional?symbol=${item.symbol}`}>{item.symbol}</Link></td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-muted-foreground">{item.companyName ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{item.sector ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{item.currentReportedHolderCount}</td>
                    <td className={cn("py-2 text-right tabular-nums", toneForDirection(item.holderCountChange))}>{item.holderCountChange == null ? "—" : `${item.holderCountChange >= 0 ? "+" : ""}${item.holderCountChange}`}</td>
                    <td className={cn("py-2 text-right tabular-nums", toneForDirection(item.aggregateReportedShareChangePct))}>{formatPct(item.aggregateReportedShareChangePct)}</td>
                    <td className="py-2 text-right tabular-nums">{formatUSD(item.aggregateReportedValue)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={pages} onChange={setPage} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RotationView() {
  const [kind, setKind] = useState<RotationKind>("sectors");
  const query = useQuery<RotationResult>({
    queryKey: [`/api/institutional/v1/rotation/${kind}`],
    queryFn: () => fetchV1(`/api/institutional/v1/rotation/${kind}`),
    staleTime: 5 * 60_000,
  });
  const unavailable = isDataUnavailable(query.error);

  return (
    <div className="space-y-5" data-testid="institutional-rotation-view">
      <div><h2 className="text-xl font-semibold">Institutional rotation</h2><p className="mt-1 text-sm text-muted-foreground">Quarter-over-quarter reported value, manager breadth, and directional activity by classification.</p></div>
      <div className="flex flex-wrap gap-2">{ROTATION_ITEMS.map((item) => <Button key={item.key} variant={kind === item.key ? "default" : "outline"} size="sm" onClick={() => setKind(item.key)}>{item.label}</Button>)}</div>
      {query.isLoading && <LoadingCards count={4} />}
      {query.isError && !unavailable && <ErrorState onRetry={() => void query.refetch()} />}
      {(unavailable || (query.data && query.data.classifications.length === 0)) && <EmptyState title={`No ${kind} rotation snapshot`} detail="Rotation appears after the institutional analytics pipeline produces a completed delayed Form 13F quarter." onRetry={() => void query.refetch()} />}
      {query.data && query.data.classifications.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm">{query.data.kind} · {query.data.quarter.label}</CardTitle><span className="text-xs text-muted-foreground">{query.data.classifications.length} classifications</span></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Classification</th><th className="pb-2 text-right">Reported value</th><th className="pb-2 text-right">QoQ value</th><th className="pb-2 text-right">Managers</th><th className="pb-2 text-right">Manager change</th><th className="pb-2 text-right">New</th><th className="pb-2 text-right">Reduced</th></tr></thead>
                <tbody>{query.data.classifications.map((row) => <tr key={row.classificationId ?? row.classification} className="border-b last:border-0">
                  <td className="py-2 font-medium">{row.classification}</td>
                  <td className="py-2 text-right tabular-nums">{formatUSD(row.currentReportedValue)}</td>
                  <td className={cn("py-2 text-right tabular-nums", toneForDirection(row.reportedValueChangePct))}>{formatPct(row.reportedValueChangePct)}</td>
                  <td className="py-2 text-right tabular-nums">{row.managerCount}</td>
                  <td className={cn("py-2 text-right tabular-nums", toneForDirection(row.managerCountChange))}>{row.managerCountChange == null ? "—" : `${row.managerCountChange >= 0 ? "+" : ""}${row.managerCountChange}`}</td>
                  <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{row.newlyReportedPositionCount}</td>
                  <td className="py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{row.reducedReportedPositionCount}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DiscoveryView({ symbol }: { symbol: string }) {
  const query = useQuery<MultibaggerResult>({
    queryKey: [`/api/institutional/multibagger/${symbol}`],
    queryFn: () => fetchJson(`/api/institutional/multibagger/${symbol}`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
  const discovery = query.data?.institutionalDiscovery;

  if (query.isLoading) return <LoadingCards count={4} />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (!query.data || !discovery) return <EmptyState title={`No institutional discovery data for ${symbol}`} detail="The discovery stage remains unavailable until the required reported-holder inputs are complete." />;

  return (
    <div className="space-y-5" data-testid="institutional-discovery-view">
      <div><h2 className="text-xl font-semibold">Institutional discovery · {symbol}</h2><p className="mt-1 text-sm text-muted-foreground">A deterministic stage describing participation among tracked reporting managers. It is not a prediction or a trade instruction.</p></div>
      <Card className="border-primary/20 bg-primary/5"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Discovery stage</p><p className="mt-1 text-2xl font-semibold">{discovery.stage?.replaceAll("_", " ") ?? "Unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">{discovery.context?.dataQuarter ?? "Quarter unavailable"} · {discovery.context?.reportingManagerCount ?? "—"} tracked managers</p></div>
        <div className="text-right"><p className={cn("text-4xl font-bold tabular-nums", scoreColor(discovery.score))}>{discovery.score ?? "—"}</p><p className="text-xs text-muted-foreground">{discovery.availability}</p></div>
      </CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Evidence signals</CardTitle></CardHeader><CardContent className="space-y-2">
          {discovery.evidence.map((item) => <div key={item.label} className="rounded-lg border bg-muted/20 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{item.label}</span><span className={cn("text-sm font-semibold", item.direction === "positive" ? "text-emerald-600 dark:text-emerald-400" : item.direction === "caution" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{item.normalizedScore ?? "Unavailable"}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.explanation}</p></div>)}
          {discovery.evidence.length === 0 && <p className="text-sm text-muted-foreground">No usable institutional evidence is available.</p>}
        </CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Why the stage is shown</CardTitle></CardHeader><CardContent className="space-y-2">
          {discovery.reasons.map((reason, index) => <div key={`${reason.summary}-${index}`} className="flex items-start gap-2 text-sm"><CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", reason.direction === "positive" ? "text-emerald-500" : "text-amber-500")} /><span>{reason.summary}</span></div>)}
          {discovery.reasons.length === 0 && <p className="text-sm text-muted-foreground">No stage rationale is available for this snapshot.</p>}
          <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">Data quality: {discovery.context?.mappingCoveragePercent == null ? "Unavailable" : `${discovery.context.mappingCoveragePercent.toFixed(0)}% mapped`} · as of {formatDate(discovery.context?.dataAsOf)}</div>
        </CardContent></Card>
      </div>
      {(discovery.context?.warnings ?? []).length > 0 && <Alert><ShieldAlert className="h-4 w-4" /><AlertDescription className="text-xs">{discovery.context?.warnings?.join(" ")}</AlertDescription></Alert>}
    </div>
  );
}

function MultibaggerView({ symbol }: { symbol: string }) {
  const query = useQuery<MultibaggerResult>({
    queryKey: [`/api/institutional/multibagger/${symbol}`],
    queryFn: () => fetchJson(`/api/institutional/multibagger/${symbol}`),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
  const result = query.data;
  if (query.isLoading) return <LoadingCards count={4} />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (!result) return <EmptyState title={`No deterministic discovery profile for ${symbol}`} detail="Profiles remain unavailable when required inputs are missing or insufficient." />;

  const profileEntries = Object.entries(result.optionalUpsideProfiles);
  return (
    <div className="space-y-5" data-testid="multibagger-view">
      <div><h2 className="text-xl font-semibold">Multibagger Discovery · {symbol}</h2><p className="mt-1 text-sm text-muted-foreground">Versioned candidate/profile research using deterministic component evidence. This screen does not express certainty, expected outcomes, or investment advice.</p></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Overall evidence score" value={result.overall.score ?? "Unavailable"} detail={`${result.overall.availability} · ${result.overall.confidence} confidence`} valueClass={scoreColor(result.overall.score)} />
        <Metric label="Available dimensions" value={`${result.availableDimensionCount} / ${result.availableDimensionCount + result.unavailableDimensionCount}`} detail={`Model ${result.modelVersion}`} />
        <Metric label="Institutional stage" value={result.institutionalDiscovery.stage?.replaceAll("_", " ") ?? "Unavailable"} detail={result.institutionalDiscovery.score == null ? "Institutional input unavailable" : `Institutional score ${result.institutionalDiscovery.score}`} valueClass="text-base" />
      </div>
      <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Profile screens</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {profileEntries.map(([key, profile]) => <div key={key} className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{key.replace("X", "x")} profile</p><p className={cn("mt-1 text-2xl font-semibold", scoreColor(profile.score))}>{profile.score ?? "—"}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{profile.classification.replaceAll("_", " ").toLowerCase()}</p><p className="mt-2 text-xs text-muted-foreground">{profile.limitingFactors.length > 0 ? profile.limitingFactors[0].explanation : "No limiting factor recorded."}</p></div>)}
      </div></CardContent></Card>
      <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Component scores and data availability</CardTitle></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(result.dimensions).map(([key, dimension]) => <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2"><span className="capitalize text-sm">{key}</span><span className={cn("font-semibold tabular-nums", scoreColor(dimension.score))}>{dimension.score ?? "Unavailable"}</span><Badge variant="outline" className="ml-2 text-[10px]">{dimension.availability}</Badge></div>)}
      </div></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Supporting factors</CardTitle></CardHeader><CardContent className="space-y-2">{Object.entries(result.dimensions).flatMap(([key, dimension]) => dimension.evidence.filter((e) => e.available).slice(0, 2).map((e) => <div key={`${key}-${e.label}`} className="text-xs"><span className="font-medium capitalize">{key} · {e.label}</span><p className="text-muted-foreground">{e.explanation}</p></div>))}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Limitations and data quality</CardTitle></CardHeader><CardContent className="space-y-2 text-xs text-muted-foreground">{result.limitations.slice(0, 6).map((limitation, index) => <p key={`${limitation}-${index}`} className="flex gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{limitation}</p>)}<p className="border-t pt-2">{result.disclaimer}</p></CardContent></Card>
      </div>
    </div>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground"><span>Page {page + 1} of {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}><ArrowLeft className="mr-1 h-3.5 w-3.5" />Previous</Button><Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>Next<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></div></div>;
}

export default function InstitutionalIntelligencePage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const querySymbol = symbolFromSearch(search);
  const [activeTab, setActiveTab] = useState<HubTab>("stock");
  const [inputSymbol, setInputSymbol] = useState(querySymbol ?? "AAPL");
  const [symbol, setSymbol] = useState(querySymbol ?? "AAPL");

  useEffect(() => {
    if (!symbolQueryOpensStock(querySymbol)) return;
    if (querySymbol === null) return;
    setActiveTab("stock");
    if (querySymbol === symbol) return;
    setInputSymbol(querySymbol);
    setSymbol(querySymbol);
  }, [querySymbol, symbol]);

  function submitSymbol(event: React.FormEvent) {
    event.preventDefault();
    const normalized = inputSymbol.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
      setSymbol(normalized);
      setActiveTab("stock");
      navigate(`/institutional?symbol=${encodeURIComponent(normalized)}`);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">Institutional Intelligence</h1></div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Public filing research across reported holders, fund portfolios, rotation, and deterministic discovery profiles.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/institutional/funds"><Button variant="outline" size="sm"><Building2 className="mr-2 h-3.5 w-3.5" />Fund Explorer</Button></Link>
            <Link href="/intelligence"><Button variant="outline" size="sm"><BarChart3 className="mr-2 h-3.5 w-3.5" />Sector & theme intelligence</Button></Link>
          </div>
        </div>

        <Disclosure />

        <form onSubmit={submitSymbol} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={inputSymbol} onChange={(event) => setInputSymbol(event.target.value)} className="pl-9 uppercase" placeholder="Search a symbol, e.g. AAPL" aria-label="Search a stock symbol" /></div>
          <Button type="submit">Research symbol</Button>
        </form>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as HubTab)}
        >
          <TabsList
            className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0"
            aria-label="Institutional intelligence views"
          >
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  className="shrink-0 gap-2 rounded-t-md rounded-b-none px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                  data-testid={`institutional-tab-${item.key}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <TabsContent value="stock" className="mt-6">
            <StockView
              symbol={symbol}
              onOpenMultibagger={() => setActiveTab("multibagger")}
            />
          </TabsContent>
          <TabsContent value="trends" className="mt-6">
            <TrendsView />
          </TabsContent>
          <TabsContent value="rotation" className="mt-6">
            <RotationView />
          </TabsContent>
          <TabsContent value="discovery" className="mt-6">
            <DiscoveryView symbol={symbol} />
          </TabsContent>
          <TabsContent value="multibagger" className="mt-6">
            <MultibaggerView symbol={symbol} />
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />Delayed SEC Form 13F data · reported holdings only</span>
          <span className="flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" />Research context, not investment advice</span>
        </div>
      </div>
    </div>
  );
}