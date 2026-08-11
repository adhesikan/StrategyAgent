/**
 * client/src/components/settings/ResearchTradingPreferencesSection.tsx — Sprint 2.8.1A
 *
 * Settings card: Research & Trading Preferences
 *
 * COMPLIANCE:
 * - Preferences control presentation only — NOT suitability assessment
 * - No financial questionnaire (no income, net worth, age, etc.)
 * - No "Recommended", "Best Strategy", "Risk Profile"
 * - All selections are USER preferences, not AI recommendations
 */

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Save, Loader2, Info } from "lucide-react";
import {
  BROAD_EXPRESSION_TYPES,
  BROAD_EXPRESSION_LABELS,
  BROAD_EXPRESSION_EDUCATIONAL,
  TRADE_PREFERENCES_SETTINGS_DISCLAIMER,
} from "../../../../shared/trade-preference-types";
import type { BroadExpressionType, UserTradingPreferences } from "../../../../shared/trade-preference-types";

interface PrefsResponse {
  preferences: UserTradingPreferences;
  disclaimer: string;
}

export function ResearchTradingPreferencesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<PrefsResponse>({
    queryKey: ["/api/user/trading-preferences"],
    queryFn: () => apiRequest("GET", "/api/user/trading-preferences").then(r => r.json()),
  });

  const [selected, setSelected] = useState<Set<BroadExpressionType>>(new Set());
  const [showOther, setShowOther] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data?.preferences && !initialized) {
      setSelected(new Set(data.preferences.preferredExpressionTypes));
      setShowOther(data.preferences.showOtherCompatibleStructures);
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/user/trading-preferences", {
        preferredExpressionTypes: Array.from(selected),
        showOtherCompatibleStructures: showOther,
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user/trading-preferences"] });
      toast({ title: "Research preferences saved" });
    },
    onError: () => toast({ title: "Failed to save preferences", variant: "destructive" }),
  });

  const toggle = (type: BroadExpressionType) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Display types — exclude EXPLORE_COMPATIBLE_STRUCTURES from checkbox list (it's always available via showOther)
  const displayTypes = BROAD_EXPRESSION_TYPES.filter(t => t !== "EXPLORE_COMPATIBLE_STRUCTURES");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading preferences…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Research &amp; Trading Preferences</CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Choose the types of investment structures you typically want VCP Trader AI to show first
          when researching qualified opportunities. These preferences control presentation only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3" role="group" aria-label="Research structure preferences">
          {displayTypes.map(type => (
            <div
              key={type}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                selected.has(type) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
              onClick={() => toggle(type)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(type); } }}
              tabIndex={0}
              role="checkbox"
              aria-checked={selected.has(type)}
              aria-label={BROAD_EXPRESSION_LABELS[type]}
              data-testid={`pref-${type}`}
            >
              <Checkbox
                id={`pref-${type}`}
                checked={selected.has(type)}
                onCheckedChange={() => toggle(type)}
                aria-hidden="true"
                tabIndex={-1}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0">
                <Label htmlFor={`pref-${type}`} className="text-sm font-medium cursor-pointer" onClick={e => e.stopPropagation()}>
                  {BROAD_EXPRESSION_LABELS[type]}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {BROAD_EXPRESSION_EDUCATIONAL[type]}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div>
            <Label htmlFor="show-other" className="text-sm font-medium">
              Show other compatible structures
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Always show &ldquo;Explore Compatible Structures&rdquo; option in Trade Planning.
            </p>
          </div>
          <Switch
            id="show-other"
            checked={showOther}
            onCheckedChange={setShowOther}
            aria-label="Show other compatible structures"
            data-testid="switch-showOther"
          />
        </div>

        <div className="rounded-md bg-muted/50 p-3 flex gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>{TRADE_PREFERENCES_SETTINGS_DISCLAIMER}</p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            size="sm"
            data-testid="button-save-research-prefs"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
            ) : (
              <><Save className="h-3.5 w-3.5 mr-1.5" />Save Preferences</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
