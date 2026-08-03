import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { UserTradePreferences } from "@shared/schema";

const PREFS_KEY = ["/api/user/trade-preferences"];

export function useLiveSetupStatus() {
  const { user } = useAuth();
  const { data: prefs, isLoading } = useQuery<Partial<UserTradePreferences>>({
    queryKey: PREFS_KEY,
    enabled: !!user,
  });
  return {
    isLoading,
    liveSetupCompleted: !!prefs?.liveSetupCompleted,
    prefs,
  };
}

export function LiveTradingSetupDialog({
  open,
  onClose,
  onCompleted,
  involvesOptions = false,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
  involvesOptions?: boolean;
}) {
  const { prefs } = useLiveSetupStatus();
  const { toast } = useToast();
  const [maxRisk, setMaxRisk] = useState(String(prefs?.maxDollarRisk ?? 500));
  const [allowStocks, setAllowStocks] = useState(prefs?.allowStocks ?? true);
  const [allowOptions, setAllowOptions] = useState(
    (prefs?.allowLongCalls ?? true) || (prefs?.allowLongPuts ?? true),
  );
  const [definedRiskOnly, setDefinedRiskOnly] = useState(prefs?.definedRiskOnly ?? true);
  const [optionsAck, setOptionsAck] = useState(false);
  const [disclosureAck, setDisclosureAck] = useState(false);

  // Re-sync form state from saved preferences each time the dialog opens,
  // so late-loading prefs are never clobbered by stale defaults.
  useEffect(() => {
    if (open) {
      setMaxRisk(String(prefs?.maxDollarRisk ?? 500));
      setAllowStocks(prefs?.allowStocks ?? true);
      setAllowOptions((prefs?.allowLongCalls ?? true) || (prefs?.allowLongPuts ?? true));
      setDefinedRiskOnly(prefs?.definedRiskOnly ?? true);
      setOptionsAck(false);
      setDisclosureAck(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefs]);

  const needsOptionsAck = allowOptions && !prefs?.optionsAcknowledgedAt;

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/user/trade-preferences", {
        liveSetupCompleted: true,
        maxDollarRisk: Math.max(0, parseFloat(maxRisk) || 0),
        allowStocks,
        allowLongCalls: allowOptions,
        allowLongPuts: allowOptions,
        definedRiskOnly,
        ...(needsOptionsAck && optionsAck ? { optionsAcknowledged: true } : {}),
        executionDisclosureAccepted: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFS_KEY });
      toast({ title: "Live trading settings saved" });
      onCompleted();
    },
    onError: () => {
      toast({ title: "Could not save settings", variant: "destructive" });
    },
  });

  const riskValue = parseFloat(maxRisk);
  const canSave =
    !save.isPending &&
    Number.isFinite(riskValue) &&
    riskValue > 0 &&
    (allowStocks || allowOptions) &&
    (!needsOptionsAck || optionsAck) &&
    disclosureAck;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-live-trading-setup">
        <DialogHeader>
          <DialogTitle>Live Trading Setup</DialogTitle>
          <DialogDescription>
            A few required settings before sending live orders. You'll return to your order when done.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="lts-max-risk">Maximum dollar risk per trade ($)</Label>
            <Input
              id="lts-max-risk"
              type="number"
              min="1"
              value={maxRisk}
              onChange={(e) => setMaxRisk(e.target.value)}
              data-testid="input-lts-max-risk"
            />
          </div>
          <div className="space-y-2">
            <Label>Allowed instruments</Label>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">Stocks</span>
              <Switch checked={allowStocks} onCheckedChange={setAllowStocks} data-testid="switch-lts-stocks" />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm">Options</span>
              <Switch checked={allowOptions} onCheckedChange={setAllowOptions} data-testid="switch-lts-options" />
            </div>
            {!allowStocks && !allowOptions && (
              <p className="text-xs text-destructive">Enable at least one instrument type.</p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm">Defined-risk strategies only</p>
              <p className="text-xs text-muted-foreground">Blocks undefined-risk option strategies.</p>
            </div>
            <Switch checked={definedRiskOnly} onCheckedChange={setDefinedRiskOnly} data-testid="switch-lts-defined-risk" />
          </div>
          {needsOptionsAck && (
            <label className="flex items-start gap-2 text-xs cursor-pointer" data-testid="label-lts-options-ack">
              <Checkbox
                checked={optionsAck}
                onCheckedChange={(v) => setOptionsAck(v === true)}
                className="mt-0.5"
                data-testid="checkbox-lts-options-ack"
              />
              <span>
                I understand options involve substantial risk, can expire worthless, and that I am responsible
                for confirming my broker has approved my account for options trading.
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs cursor-pointer" data-testid="label-lts-disclosure">
            <Checkbox
              checked={disclosureAck}
              onCheckedChange={(v) => setDisclosureAck(v === true)}
              className="mt-0.5"
              data-testid="checkbox-lts-disclosure"
            />
            <span>
              I understand all candidates are AI-generated analysis, not investment advice. Every order
              is reviewed and submitted by me through my connected broker, and fills, prices, and outcomes are
              not guaranteed.
            </span>
          </label>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-lts-cancel">
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => save.mutate()} disabled={!canSave} data-testid="button-lts-save">
            {save.isPending ? "Saving…" : "Save & Continue"}
          </Button>
        </div>
        {involvesOptions && !allowOptions && (
          <p className="text-xs text-amber-500">
            This order involves options — enable Options above to continue with it.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
