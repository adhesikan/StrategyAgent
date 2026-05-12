import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, ArrowLeft, AlertTriangle, Target, ShieldCheck, TrendingUp, Activity, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ComplianceFooter } from "@/components/trading-shell";

type UniverseId = "watchlist" | "large_cap" | "high_volume" | "options_liquid" | "nasdaq_100" | "sp_100" | "sp_500" | "custom";

interface UniverseOption {
  id: UniverseId;
  label: string;
  description: string;
}

interface BestTradePick {
  id: string;
  rank: number;
  symbol: string;
  companyName?: string;
  strategyType: string;
  strategyLabel: string;
  bias: string;
  confidence: number;
  grade: "A+" | "A" | "B" | "C";
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
  rewardRisk: number;
  expiration: string | null;
  strikes: string | null;
  isOptions: boolean;
  liquidity: "High" | "Medium" | "Low";
  dataMode: "live" | "simulated" | "mixed";
  riskLabel: "Low" | "Medium" | "High";
}

interface BestTradeResult {
  picks: BestTradePick[];
  scanned: number;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  universeLabel: string;
  universeSize: number;
  asOf: string;
  notes: string[];
  disclaimer: string;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  A: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  B: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  C: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const RISK_COLORS: Record<string, string> = {
  Low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  High: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function BestTradePage() {
  const [, navigate] = useLocation();
  const [universe, setUniverse] = useState<UniverseId>("watchlist");
  const [customSymbols, setCustomSymbols] = useState("");
  const [minConfidence, setMinConfidence] = useState(65);
  const [maxLoss, setMaxLoss] = useState<string>("500");

  const universesQuery = useQuery<UniverseOption[]>({
    queryKey: ["/api/best-trade/universes"],
  });

  const findMutation = useMutation<BestTradeResult, Error, void>({
    mutationFn: async () => {
      const body: any = {
        universe,
        minConfidence,
        limit: 3,
      };
      const parsedMaxLoss = Number(maxLoss);
      if (!Number.isNaN(parsedMaxLoss) && parsedMaxLoss > 0) {
        body.maxLoss = parsedMaxLoss;
      }
      if (universe === "custom") {
        const syms = customSymbols
          .split(/[\s,]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        body.customSymbols = syms;
      }
      const res = await apiRequest("POST", "/api/best-trade/find", body);
      return (await res.json()) as BestTradeResult;
    },
  });

  const data = findMutation.data;
  const isLoading = findMutation.isPending;
  const universeDisabledReason = useMemo(() => {
    if (universe === "custom") {
      const syms = customSymbols.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (syms.length === 0) return "Add at least one symbol";
    }
    return null;
  }, [universe, customSymbols]);

  return (
    <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")} data-testid="button-best-trade-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Find My Best Trade</span>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Scan settings
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            We scan live broker quotes, indicators, and news sentiment, then rank defined-risk candidates only — no naked long calls or puts.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Universe</Label>
              <Select value={universe} onValueChange={(v) => setUniverse(v as UniverseId)}>
                <SelectTrigger data-testid="select-universe">
                  <SelectValue placeholder="Pick a universe" />
                </SelectTrigger>
                <SelectContent>
                  {(universesQuery.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id} data-testid={`option-universe-${u.id}`}>
                      <div className="flex flex-col">
                        <span className="font-medium">{u.label}</span>
                        <span className="text-[11px] text-muted-foreground">{u.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-loss" className="text-xs uppercase tracking-wide text-muted-foreground">
                Max loss per trade ($)
              </Label>
              <Input
                id="max-loss"
                inputMode="numeric"
                value={maxLoss}
                onChange={(e) => setMaxLoss(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 500"
                data-testid="input-max-loss"
              />
            </div>
          </div>

          {universe === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-symbols" className="text-xs uppercase tracking-wide text-muted-foreground">
                Custom symbols (comma or space separated)
              </Label>
              <Input
                id="custom-symbols"
                value={customSymbols}
                onChange={(e) => setCustomSymbols(e.target.value.toUpperCase())}
                placeholder="AAPL, MSFT, NVDA"
                data-testid="input-custom-symbols"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Minimum confidence
              </Label>
              <span className="text-sm font-semibold tabular-nums" data-testid="text-min-confidence">{minConfidence}%</span>
            </div>
            <Slider
              value={[minConfidence]}
              min={50}
              max={90}
              step={1}
              onValueChange={(v) => setMinConfidence(v[0] ?? 65)}
              data-testid="slider-min-confidence"
            />
            <p className="text-[11px] text-muted-foreground">
              Lower = more results, higher = fewer but stronger signals.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => findMutation.mutate()}
              disabled={isLoading || !!universeDisabledReason}
              className="gap-2"
              data-testid="button-find-best-trade"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Find My Best Trade
            </Button>
            {universeDisabledReason && (
              <span className="text-xs text-amber-300">{universeDisabledReason}</span>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Defined-risk only
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-3" data-testid="state-best-trade-loading">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-1/3" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-9/12" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {findMutation.error && !isLoading && (
        <Card className="border-rose-500/40 bg-rose-500/5" data-testid="card-best-trade-error">
          <CardContent className="p-4 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5" />
            <div>
              <div className="font-medium text-rose-200">Couldn't run the scan.</div>
              <div className="text-muted-foreground mt-1">{findMutation.error.message}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground" data-testid="text-best-trade-meta">
            <Badge variant="outline" className="text-[10px]">
              <Activity className="h-3 w-3 mr-1" />
              {data.dataMode === "live" ? "Live broker data" : data.dataMode === "mixed" ? "Mixed data" : "Simulated examples"}
            </Badge>
            <span>· Scanned {data.universeSize} symbols in {data.universeLabel}</span>
            <span>· {data.picks.length} pick{data.picks.length === 1 ? "" : "s"}</span>
          </div>

          {data.notes.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-best-trade-notes">
              <CardContent className="p-3 text-xs space-y-1">
                {data.notes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span>{n}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.picks.length === 0 && (
            <Card data-testid="card-best-trade-empty">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No defined-risk candidates met your thresholds. Try a broader universe or lower the minimum confidence.
              </CardContent>
            </Card>
          )}

          <div className="space-y-3" data-testid="list-best-trade-picks">
            {data.picks.map((pick) => (
              <PickCard key={pick.id} pick={pick} />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground" data-testid="text-best-trade-disclaimer">
            {data.disclaimer}
          </p>
        </>
      )}

      <ComplianceFooter />
    </div>
  );
}

function PickCard({ pick }: { pick: BestTradePick }) {
  return (
    <Card className="hover-elevate transition-all" data-testid={`card-pick-${pick.symbol}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold" data-testid={`text-pick-symbol-${pick.symbol}`}>
                {pick.symbol}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {pick.strategyLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                <TrendingUp className="h-3 w-3 mr-1" />
                {pick.bias}
              </Badge>
            </div>
            {pick.companyName && (
              <div className="text-xs text-muted-foreground">{pick.companyName}</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <Badge className={`text-xs font-semibold ${GRADE_COLORS[pick.grade]}`} data-testid={`badge-pick-grade-${pick.symbol}`}>
                Grade {pick.grade}
              </Badge>
              <Badge variant="outline" className="text-xs font-semibold tabular-nums" data-testid={`badge-pick-confidence-${pick.symbol}`}>
                {pick.confidence}% confidence
              </Badge>
            </div>
            <Badge variant="outline" className={`text-[10px] ${RISK_COLORS[pick.riskLabel]}`}>
              {pick.riskLabel} risk
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Mini label="Entry" value={`$${pick.entry.toFixed(2)}`} />
          <Mini label="Stop" value={`$${pick.stop.toFixed(2)}`} valueClass="text-rose-300" />
          <Mini label="Target" value={`$${pick.target.toFixed(2)}`} valueClass="text-emerald-300" />
          <Mini label="Reward / Risk" value={`${pick.rewardRisk.toFixed(2)}:1`} />
          <Mini label="Max loss" value={`$${pick.maxLoss.toLocaleString()}`} valueClass="text-rose-300" />
          <Mini label="Max gain" value={pick.maxGain != null ? `$${pick.maxGain.toLocaleString()}` : "Open"} valueClass="text-emerald-300" />
          <Mini label="Capital" value={`$${pick.capitalRequired.toLocaleString()}`} />
          <Mini label="Liquidity" value={pick.liquidity} />
        </div>

        {(pick.expiration || pick.strikes) && (
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {pick.expiration && <Badge variant="outline" className="text-[10px]">Expires {pick.expiration}</Badge>}
            {pick.strikes && <Badge variant="outline" className="text-[10px]">Strikes {pick.strikes}</Badge>}
          </div>
        )}

        <div className="space-y-1.5 text-xs">
          <div>
            <span className="text-muted-foreground">Why this trade: </span>
            <span>{pick.thesis} {pick.mainReason}</span>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-amber-100/90">{pick.mainRisk}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/trade/${pick.symbol}`}>
            <Button size="sm" variant="outline" data-testid={`button-pick-detail-${pick.symbol}`}>
              View {pick.symbol} detail
            </Button>
          </Link>
          <Link href={`/trade-finder?symbol=${pick.symbol}`}>
            <Button size="sm" data-testid={`button-pick-build-${pick.symbol}`}>
              Build order ticket
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}
