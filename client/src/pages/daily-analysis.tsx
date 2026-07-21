// Daily Analysis Mode (internal pre-launch testers only). Server enforces
// access via the central license gate — this page simply renders whatever the
// gated endpoints return, or a safe unavailable state on 403.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataAttribution } from "@/components/data-attribution";
import { Link } from "wouter";
import { CalendarDays, Info, LineChart } from "lucide-react";
import { ViewToggle, useViewMode } from "@/components/view-toggle";

interface DailyAnalysisAccess {
  allowed: boolean;
  accessLevel: string;
  dataMode: string;
  trialRestricted: boolean;
  limits?: { maxWatchlists: number; maxSymbolsPerWatchlist: number; radarResultLimit: number };
}

interface CoverageResponse {
  title: string;
  description: string;
  disclosure: string;
  attribution: string | null;
  etfs: Array<{ symbol: string; companyName: string; latestAvailableTradeDate: string | null }>;
  stocks: Array<{ symbol: string; companyName: string; latestAvailableTradeDate: string | null }>;
  deniedSymbolMessage: string;
}

interface DailyOpportunitiesResponse {
  mode?: string;
  modeLabel?: string;
  disclosure: string;
  attribution: string | null;
  dataSourceType: string;
  opportunities: Array<{
    id: string;
    symbol: string;
    setupType: string | null;
    compositeScore: number;
    compositeGrade: string;
    marketDataAsOf: string;
    conditionsPassed: string[];
    conditionsFailed: string[];
    technicalScore: number | null;
    momentumScore: number | null;
    volumeScore: number | null;
    riskScore: number | null;
    strengths: string[];
    risks: string[];
    candidateDisclosure: string;
  }>;
}

interface SymbolDetailResponse {
  disclosure: string;
  attribution: string | null;
  marketDataThrough: string;
  latestCompletedSessionClose: number | null;
  snapshot: any;
  indicators: any;
  unavailableFactors: Array<{ factor: string; status: string }>;
}

function gradeColor(grade: string) {
  if (grade === "A+" || grade === "A") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (grade === "B") return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}

export default function DailyAnalysisPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode("daily-analysis");

  const { data, isLoading, error } = useQuery<DailyOpportunitiesResponse>({
    queryKey: ["/api/daily-analysis/opportunities"],
    retry: false,
  });

  const { data: access } = useQuery<DailyAnalysisAccess>({
    queryKey: ["/api/daily-analysis/access"],
    retry: false,
  });

  const { data: coverage } = useQuery<CoverageResponse>({
    queryKey: ["/api/daily-analysis/coverage"],
    retry: false,
    enabled: !!access?.allowed,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<SymbolDetailResponse>({
    queryKey: ["/api/daily-analysis/symbol", selected],
    enabled: !!selected,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Info className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-medium" data-testid="text-daily-analysis-unavailable">
              Daily market analysis is not currently available for this account.
            </p>
            <p className="text-sm text-muted-foreground">
              This feature is in pre-launch testing.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-daily-analysis-title">
          <LineChart className="h-6 w-6" /> Daily Analysis Mode
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.modeLabel ?? `Data source: ${data.dataSourceType}`}
        </p>
      </div>

      {access?.trialRestricted && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm flex items-start justify-between gap-3 flex-wrap" data-testid="banner-daily-analysis-mode">
          <div className="space-y-1">
            <p className="font-medium">You're in Daily Analysis Mode</p>
            <p className="text-xs text-muted-foreground">
              Analysis uses historical daily data through the previous completed trading session, limited to the Trial Market Coverage below. Connect a broker for live data and the full experience.
            </p>
          </div>
          <Link href="/settings/broker">
            <Button size="sm" data-testid="button-trial-connect-broker">Connect Broker</Button>
          </Link>
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2" data-testid="text-daily-disclosure">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        {data.disclosure}
      </div>

      {data.opportunities.length > 0 && (
        <div className="flex justify-end">
          <ViewToggle value={viewMode} onChange={setViewMode} testId="view-toggle-daily" />
        </div>
      )}

      {data.opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No daily analysis snapshots yet. Snapshots are generated after historical data ingestion.
          </CardContent>
        </Card>
      ) : (
        <div className={viewMode === "card" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "flex flex-col gap-3"}>
          {data.opportunities.map((o) => (
            <Card
              key={o.id}
              className={`cursor-pointer transition-colors ${selected === o.symbol ? "border-primary" : ""}`}
              onClick={() => setSelected(o.symbol)}
              data-testid={`card-daily-opportunity-${o.symbol}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{o.symbol}</CardTitle>
                  <Badge className={gradeColor(o.compositeGrade)} data-testid={`badge-grade-${o.symbol}`}>
                    {o.compositeGrade} · {o.compositeScore}
                  </Badge>
                </div>
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  <CalendarDays className="h-3.5 w-3.5" /> Historical data through {o.marketDataAsOf}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {o.setupType && <Badge variant="outline">{o.setupType}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {o.conditionsPassed.length}/{o.conditionsPassed.length + o.conditionsFailed.length} conditions passed
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <div><div className="text-muted-foreground">Tech</div><div className="font-medium">{o.technicalScore ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">Mom</div><div className="font-medium">{o.momentumScore ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">Vol</div><div className="font-medium">{o.volumeScore ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">Risk</div><div className="font-medium">{o.riskScore ?? "—"}</div></div>
                </div>
                {o.strengths[0] && <p className="text-xs text-emerald-600 dark:text-emerald-400">+ {o.strengths[0]}</p>}
                {o.risks[0] && <p className="text-xs text-amber-600 dark:text-amber-400">! {o.risks[0]}</p>}
                <p className="text-[11px] text-muted-foreground">{o.candidateDisclosure}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Card data-testid="card-daily-detail">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{selected} — Detail</CardTitle>
            {detail && (
              <CardDescription className="text-xs">
                Latest available completed-session close:{" "}
                {detail.latestCompletedSessionClose != null ? `$${detail.latestCompletedSessionClose.toFixed(2)}` : "—"} · Historical data through {detail.marketDataThrough}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detailLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : detail ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(detail.snapshot?.conditionsPassed ?? []).map((cnd: string) => (
                    <Badge key={cnd} variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">{cnd}</Badge>
                  ))}
                  {(detail.snapshot?.conditionsFailed ?? []).map((cnd: string) => (
                    <Badge key={cnd} variant="outline" className="text-muted-foreground">{cnd}</Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {detail.unavailableFactors.map((f) => (
                    <div key={f.factor}>{f.factor}: {f.status}</div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Link href="/settings/broker">
                    <Button size="sm" variant="outline" data-testid="button-connect-broker">Connect Broker</Button>
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No detail available.</p>
            )}
          </CardContent>
        </Card>
      )}

      {coverage && (
        <Card data-testid="card-trial-coverage">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{coverage.title}</CardTitle>
            <CardDescription className="text-xs">{coverage.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {coverage.etfs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">ETFs</p>
                <div className="flex flex-wrap gap-1.5">
                  {coverage.etfs.map((s) => (
                    <Badge key={s.symbol} variant="outline" data-testid={`badge-coverage-${s.symbol}`}>
                      {s.symbol}
                      <span className="ml-1 text-muted-foreground font-normal hidden sm:inline">{s.companyName}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {coverage.stocks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Stocks</p>
                <div className="flex flex-wrap gap-1.5">
                  {coverage.stocks.map((s) => (
                    <Badge key={s.symbol} variant="outline" data-testid={`badge-coverage-${s.symbol}`}>
                      {s.symbol}
                      <span className="ml-1 text-muted-foreground font-normal hidden sm:inline">{s.companyName}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{coverage.deniedSymbolMessage}</p>
          </CardContent>
        </Card>
      )}

      <DataAttribution />
    </div>
  );
}
