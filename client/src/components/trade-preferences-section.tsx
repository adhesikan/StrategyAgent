import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, ShieldAlert, HelpCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function InfoTip({ text, testId }: { text: string; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground" data-testid={testId}>
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const HELP: Record<string, string> = {
  allowStocks: "Allow the agent to recommend buying shares of stock outright.",
  allowLongCalls: "Allow buying call options to express bullish bias with leverage and capped downside (premium).",
  allowLongPuts: "Allow buying put options to express bearish bias with capped downside (premium).",
  allowDebitSpreads: "Allow bull-call or bear-put debit spreads — defined risk and defined reward.",
  allowCreditSpreads: "Credit spreads (selling premium) — disabled until full margin/risk support is added.",
  definedRiskOnly: "When on, the agent will not recommend naked long calls/puts. Spreads and stocks remain available.",
  minProbabilityScore: "Setups with a probability score below this number will be blocked at the Send step.",
  minRewardRisk: "Minimum reward-to-risk ratio (e.g. 1.5 means target distance must be at least 1.5× the stop distance).",
  preferredDteMin: "Minimum days-to-expiration the agent will pick when selecting an option contract.",
  preferredDteMax: "Maximum days-to-expiration the agent will pick when selecting an option contract.",
  minOpenInterest: "Minimum open interest required on a contract to be considered tradable.",
  minOptionVolume: "Minimum daily volume required on a contract to be considered tradable.",
  maxBidAskSpreadPct: "Maximum bid/ask spread (as a percentage of mid) before the option is flagged as illiquid.",
  defaultOrderType: "Default order type the InstaTrade ticket will pre-fill (limit is safer; market fills faster).",
  requireConfirmation: "When on, the InstaTrade ticket will require an explicit confirmation tap before sending.",
};

interface Prefs {
  allowStocks?: boolean;
  allowLongCalls?: boolean;
  allowLongPuts?: boolean;
  allowDebitSpreads?: boolean;
  allowCreditSpreads?: boolean;
  definedRiskOnly?: boolean;
  preferredDteMin?: number;
  preferredDteMax?: number;
  minOpenInterest?: number;
  minOptionVolume?: number;
  maxBidAskSpreadPct?: number;
  minRewardRisk?: number;
  minProbabilityScore?: number;
  defaultOrderType?: "market" | "limit";
  requireConfirmation?: boolean;
}

const DEFAULTS: Prefs = {
  allowStocks: true,
  allowLongCalls: true,
  allowLongPuts: true,
  allowDebitSpreads: true,
  allowCreditSpreads: false,
  definedRiskOnly: false,
  preferredDteMin: 7,
  preferredDteMax: 45,
  minOpenInterest: 100,
  minOptionVolume: 50,
  maxBidAskSpreadPct: 10,
  minRewardRisk: 1.5,
  minProbabilityScore: 65,
  defaultOrderType: "limit",
  requireConfirmation: true,
};

export function TradePreferencesSection() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Prefs>({ queryKey: ["/api/user/trade-preferences"] });
  const [form, setForm] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    if (data) setForm({ ...DEFAULTS, ...data });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Prefs) => {
      const res = await apiRequest("PUT", "/api/user/trade-preferences", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/trade-preferences"] });
      toast({ title: "Trade Preferences Saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const num = (v: any, fallback = 0) => {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Allowed Instruments</CardTitle>
          <CardDescription>Control which trade vehicles the agent can recommend and execute.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ["allowStocks", "Stocks (long shares)"],
            ["allowLongCalls", "Long Calls"],
            ["allowLongPuts", "Long Puts"],
            ["allowDebitSpreads", "Debit Spreads (bull call / bear put)"],
            ["allowCreditSpreads", "Credit Spreads (advanced — coming soon)"],
          ].map(([key, label]) => (
            <div key={key as string} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`pref-${key}`} className="text-sm">{label}</Label>
                <InfoTip text={HELP[key as string]} testId={`tip-${key}`} />
              </div>
              <Switch
                id={`pref-${key}`}
                checked={!!form[key as keyof Prefs]}
                onCheckedChange={(v) => update(key as keyof Prefs, v as any)}
                data-testid={`switch-${key}`}
              />
            </div>
          ))}
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="pref-definedRiskOnly" className="text-sm flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                  Defined-Risk Only
                </Label>
                <InfoTip text={HELP.definedRiskOnly} testId="tip-definedRiskOnly" />
              </div>
              <p className="text-[11px] text-muted-foreground">Blocks naked long calls/puts; allows spreads &amp; stock.</p>
            </div>
            <Switch
              id="pref-definedRiskOnly"
              checked={!!form.definedRiskOnly}
              onCheckedChange={(v) => update("definedRiskOnly", v)}
              data-testid="switch-definedRiskOnly"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Quality Thresholds</CardTitle>
          <CardDescription>Setups that miss these bars will be blocked at the Send step.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="pref-minScore" className="text-xs">Minimum Probability Score (0-100)</Label>
              <InfoTip text={HELP.minProbabilityScore} testId="tip-minProbabilityScore" />
            </div>
            <Input
              id="pref-minScore" type="number" min={0} max={100}
              value={form.minProbabilityScore ?? ""}
              onChange={(e) => update("minProbabilityScore", num(e.target.value, 65))}
              data-testid="input-minProbabilityScore"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="pref-minRR" className="text-xs">Minimum Reward/Risk</Label>
              <InfoTip text={HELP.minRewardRisk} testId="tip-minRewardRisk" />
            </div>
            <Input
              id="pref-minRR" type="number" step="0.1" min={0}
              value={form.minRewardRisk ?? ""}
              onChange={(e) => update("minRewardRisk", num(e.target.value, 1.5))}
              data-testid="input-minRewardRisk"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Options Filters</CardTitle>
          <CardDescription>Liquidity and expiry preferences applied to options recommendations.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Preferred DTE Min</Label>
              <InfoTip text={HELP.preferredDteMin} testId="tip-dteMin" />
            </div>
            <Input
              type="number" min={0}
              value={form.preferredDteMin ?? ""}
              onChange={(e) => update("preferredDteMin", num(e.target.value, 7))}
              data-testid="input-dteMin"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Preferred DTE Max</Label>
              <InfoTip text={HELP.preferredDteMax} testId="tip-dteMax" />
            </div>
            <Input
              type="number" min={0}
              value={form.preferredDteMax ?? ""}
              onChange={(e) => update("preferredDteMax", num(e.target.value, 45))}
              data-testid="input-dteMax"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Min Open Interest</Label>
              <InfoTip text={HELP.minOpenInterest} testId="tip-minOI" />
            </div>
            <Input
              type="number" min={0}
              value={form.minOpenInterest ?? ""}
              onChange={(e) => update("minOpenInterest", num(e.target.value, 100))}
              data-testid="input-minOI"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Min Option Volume</Label>
              <InfoTip text={HELP.minOptionVolume} testId="tip-minVol" />
            </div>
            <Input
              type="number" min={0}
              value={form.minOptionVolume ?? ""}
              onChange={(e) => update("minOptionVolume", num(e.target.value, 50))}
              data-testid="input-minVol"
            />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Max Bid/Ask Spread (%)</Label>
              <InfoTip text={HELP.maxBidAskSpreadPct} testId="tip-maxSpread" />
            </div>
            <Input
              type="number" step="0.1" min={0}
              value={form.maxBidAskSpreadPct ?? ""}
              onChange={(e) => update("maxBidAskSpreadPct", num(e.target.value, 10))}
              data-testid="input-maxSpread"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Execution Defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Default Order Type</Label>
              <InfoTip text={HELP.defaultOrderType} testId="tip-defaultOrderType" />
            </div>
            <select
              value={form.defaultOrderType ?? "limit"}
              onChange={(e) => update("defaultOrderType", e.target.value as any)}
              className="bg-background border rounded px-2 py-1 text-xs"
              data-testid="select-defaultOrderType"
            >
              <option value="limit">Limit</option>
              <option value="market">Market</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Require confirmation before sending</Label>
              <InfoTip text={HELP.requireConfirmation} testId="tip-requireConfirmation" />
            </div>
            <Switch
              checked={!!form.requireConfirmation}
              onCheckedChange={(v) => update("requireConfirmation", v)}
              data-testid="switch-requireConfirmation"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} data-testid="button-save-prefs">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Preferences
        </Button>
      </div>
    </div>
  );
}
