import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, ShieldAlert } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
              <Label htmlFor={`pref-${key}`} className="text-sm">{label}</Label>
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
              <Label htmlFor="pref-definedRiskOnly" className="text-sm flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                Defined-Risk Only
              </Label>
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
            <Label htmlFor="pref-minScore" className="text-xs">Minimum Probability Score (0-100)</Label>
            <Input
              id="pref-minScore" type="number" min={0} max={100}
              value={form.minProbabilityScore ?? ""}
              onChange={(e) => update("minProbabilityScore", num(e.target.value, 65))}
              data-testid="input-minProbabilityScore"
            />
          </div>
          <div>
            <Label htmlFor="pref-minRR" className="text-xs">Minimum Reward/Risk</Label>
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
            <Label className="text-xs">Preferred DTE Min</Label>
            <Input
              type="number" min={0}
              value={form.preferredDteMin ?? ""}
              onChange={(e) => update("preferredDteMin", num(e.target.value, 7))}
              data-testid="input-dteMin"
            />
          </div>
          <div>
            <Label className="text-xs">Preferred DTE Max</Label>
            <Input
              type="number" min={0}
              value={form.preferredDteMax ?? ""}
              onChange={(e) => update("preferredDteMax", num(e.target.value, 45))}
              data-testid="input-dteMax"
            />
          </div>
          <div>
            <Label className="text-xs">Min Open Interest</Label>
            <Input
              type="number" min={0}
              value={form.minOpenInterest ?? ""}
              onChange={(e) => update("minOpenInterest", num(e.target.value, 100))}
              data-testid="input-minOI"
            />
          </div>
          <div>
            <Label className="text-xs">Min Option Volume</Label>
            <Input
              type="number" min={0}
              value={form.minOptionVolume ?? ""}
              onChange={(e) => update("minOptionVolume", num(e.target.value, 50))}
              data-testid="input-minVol"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Max Bid/Ask Spread (%)</Label>
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
            <Label className="text-sm">Default Order Type</Label>
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
            <Label className="text-sm">Require confirmation before sending</Label>
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
