import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Database, RefreshCw, Play, Pause, Plus, CheckCircle2, XCircle, ListChecks } from "lucide-react";

interface MarketDataStatus {
  provider: string;
  planName: string;
  licenseMode: string;
  externalDisplayEnabled: boolean;
  apiKeyConfigured: boolean;
  enabled: boolean;
  attributionEnabled: boolean;
  environment: string;
  ingestionPaused: boolean;
  credits: {
    minuteUsed: number;
    minuteSafetyLimit: number;
    minuteProviderLimit: number;
    dayUsed: number;
    dailySafetyLimit: number;
    dailyProviderLimit: number;
  };
  lastRun: any;
  lastBackfill: any;
  symbols: Array<{
    id: string;
    symbol: string;
    companyName: string | null;
    assetType: string;
    enabled: boolean;
    internalAnalysisEnabled: boolean;
    futureTrialEnabled: boolean;
    backfillYears: number;
    latestAvailableTradeDate: string | null;
    lastSuccessfulIngestionAt: string | null;
  }>;
}

export default function AdminMarketDataPage() {
  const { toast } = useToast();
  const [newSymbol, setNewSymbol] = useState("");

  const { data: status, isLoading } = useQuery<MarketDataStatus>({
    queryKey: ["/api/admin/market-data/status"],
  });
  const { data: license } = useQuery<any>({ queryKey: ["/api/admin/market-data/license"] });
  const { data: runs } = useQuery<any[]>({ queryKey: ["/api/admin/market-data/runs"] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/runs"] });
  };

  const testMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/market-data/test")).json(),
    onSuccess: (r: any) =>
      toast({
        title: r.ok ? "Connection OK" : "Connection failed",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      }),
  });
  const backfillMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/market-data/backfill", {})).json(),
    onSuccess: (r: any) => {
      toast({ title: "Backfill finished", description: `Status: ${r.status}` });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Backfill failed", description: String(e), variant: "destructive" }),
  });
  const ingestMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/market-data/ingest-daily", {})).json(),
    onSuccess: (r: any) => {
      toast({ title: "Daily ingestion finished", description: `Status: ${r.status}` });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Ingestion failed", description: String(e), variant: "destructive" }),
  });
  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) =>
      (await apiRequest("POST", "/api/admin/market-data/pause", { paused })).json(),
    onSuccess: invalidate,
  });
  const refreshSymbolMutation = useMutation({
    mutationFn: async (symbol: string) =>
      (await apiRequest("POST", `/api/admin/market-data/refresh/${symbol}`)).json(),
    onSuccess: (r: any) => {
      toast({ title: "Symbol refreshed", description: `Status: ${r.status}` });
      invalidate();
    },
  });
  const addSymbolMutation = useMutation({
    mutationFn: async (symbol: string) =>
      (await apiRequest("POST", "/api/admin/market-data/symbols", { symbol })).json(),
    onSuccess: () => {
      setNewSymbol("");
      toast({ title: "Symbol added" });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Failed to add symbol", description: String(e), variant: "destructive" }),
  });
  const patchSymbolMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) =>
      (await apiRequest("PATCH", `/api/admin/market-data/symbols/${id}`, patch)).json(),
    onSuccess: invalidate,
  });

  if (isLoading || !status) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = status.credits;
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-market-data-title">
            <Database className="h-6 w-6" /> Market Data
          </h1>
          <p className="text-sm text-muted-foreground">
            Twelve Data historical daily ingestion, credits, symbols, and licensing.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} data-testid="button-test-connection">
            <RefreshCw className="h-4 w-4 mr-1" /> Test Connection
          </Button>
          <Button variant="outline" onClick={() => ingestMutation.mutate()} disabled={ingestMutation.isPending} data-testid="button-run-daily">
            <Play className="h-4 w-4 mr-1" /> Run Daily Ingestion
          </Button>
          <Button variant="outline" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} data-testid="button-run-backfill">
            <Play className="h-4 w-4 mr-1" /> Start Backfill
          </Button>
          <Button
            variant={status.ingestionPaused ? "default" : "outline"}
            onClick={() => pauseMutation.mutate(!status.ingestionPaused)}
            data-testid="button-pause-ingestion"
          >
            <Pause className="h-4 w-4 mr-1" /> {status.ingestionPaused ? "Resume Ingestion" : "Pause Ingestion"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">License</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span data-testid="text-provider">Twelve Data</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span data-testid="text-plan">{status.planName}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">License mode</span><Badge variant={status.licenseMode === "external" ? "default" : "secondary"} data-testid="badge-license-mode">{status.licenseMode}</Badge></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">External display</span>{status.externalDisplayEnabled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">API key configured</span>{status.apiKeyConfigured ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}</div>
            <div className="flex justify-between"><span className="text-muted-foreground">Environment</span><span>{status.environment}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Attribution</span>{status.attributionEnabled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">API Credits</CardTitle>
            <CardDescription className="text-xs">Safety limits sit below provider limits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">This minute</span><span data-testid="text-credits-minute">{c.minuteUsed} / {c.minuteSafetyLimit} (cap {c.minuteProviderLimit})</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Today</span><span data-testid="text-credits-day">{c.dayUsed} / {c.dailySafetyLimit} (cap {c.dailyProviderLimit})</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last run</span><span>{status.lastRun ? `${status.lastRun.runType} — ${status.lastRun.status}` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last backfill</span><span>{status.lastBackfill ? status.lastBackfill.status : "—"}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><ListChecks className="h-4 w-4" /> External Launch Readiness</CardTitle>
            <CardDescription className="text-xs">
              External display requires deployment env vars — it cannot be enabled from this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1 max-h-44 overflow-y-auto list-disc pl-4">
              {(license?.readinessChecklist ?? []).map((item: string) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">Symbol Universe</CardTitle>
              <CardDescription>Curated symbols for daily ingestion and internal analysis.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Add symbol"
                className="w-32 uppercase"
                maxLength={8}
                data-testid="input-add-symbol"
              />
              <Button
                size="sm"
                onClick={() => newSymbol.trim() && addSymbolMutation.mutate(newSymbol.trim())}
                disabled={!newSymbol.trim() || addSymbolMutation.isPending}
                data-testid="button-add-symbol"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3">Symbol</th>
                <th className="py-2 pr-3">Enabled</th>
                <th className="py-2 pr-3">Internal Analysis</th>
                <th className="py-2 pr-3">Future Trial</th>
                <th className="py-2 pr-3">Backfill (yrs)</th>
                <th className="py-2 pr-3">Latest Data</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {status.symbols.map((s) => (
                <tr key={s.id} className="border-b last:border-0" data-testid={`row-symbol-${s.symbol}`}>
                  <td className="py-2 pr-3 font-medium">{s.symbol}<div className="text-xs text-muted-foreground font-normal">{s.companyName}</div></td>
                  <td className="py-2 pr-3"><Switch checked={s.enabled} onCheckedChange={(v) => patchSymbolMutation.mutate({ id: s.id, patch: { enabled: v } })} data-testid={`switch-enabled-${s.symbol}`} /></td>
                  <td className="py-2 pr-3"><Switch checked={s.internalAnalysisEnabled} onCheckedChange={(v) => patchSymbolMutation.mutate({ id: s.id, patch: { internalAnalysisEnabled: v } })} /></td>
                  <td className="py-2 pr-3"><Switch checked={s.futureTrialEnabled} onCheckedChange={(v) => patchSymbolMutation.mutate({ id: s.id, patch: { futureTrialEnabled: v } })} /></td>
                  <td className="py-2 pr-3">{s.backfillYears}</td>
                  <td className="py-2 pr-3">{s.latestAvailableTradeDate ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <Button size="sm" variant="ghost" onClick={() => refreshSymbolMutation.mutate(s.symbol)} disabled={refreshSymbolMutation.isPending} data-testid={`button-refresh-${s.symbol}`}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Ingestion Runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Symbols</th>
                <th className="py-2 pr-3">Inserted</th>
                <th className="py-2 pr-3">Updated</th>
                <th className="py-2 pr-3">Credits</th>
                <th className="py-2 pr-3">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-0" data-testid={`row-run-${r.id}`}>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-3">{r.runType}</td>
                  <td className="py-2 pr-3"><Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge></td>
                  <td className="py-2 pr-3">{r.symbolsSucceeded}/{r.symbolsRequested}</td>
                  <td className="py-2 pr-3">{r.recordsInserted}</td>
                  <td className="py-2 pr-3">{r.recordsUpdated}</td>
                  <td className="py-2 pr-3">{r.creditsUsed}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground max-w-[240px] truncate">{r.errorSummary ?? ""}</td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-muted-foreground text-sm">No ingestion runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
