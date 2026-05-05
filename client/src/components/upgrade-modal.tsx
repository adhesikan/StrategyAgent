import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Loader2, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";
import { PLANS, type PlanId } from "@shared/plans";

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: ["5 AI analyses / day", "Paper trading", "Educational content"],
  pro: ["50 AI analyses / day", "Live data", "1 broker connection", "Smart alerts + scanner"],
  edge: ["Unlimited analyses", "Up to 5 brokers", "Automation", "Options flow & multi-leg", "Trade journal"],
  team: ["Everything in Active Trader", "5 team seats", "Team sharing", "Partner signals", "Priority support"],
};

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlightPlan?: PlanId;
  reason?: string;
  feature?: string;
}

export function UpgradeModal({
  open,
  onOpenChange,
  highlightPlan,
  reason,
  feature,
}: UpgradeModalProps) {
  const { plan: currentPlan } = usePlan();
  const [annual, setAnnual] = useState(false);
  const { toast } = useToast();

  const checkout = useMutation({
    mutationFn: async (vars: { planId: PlanId; cycle: "monthly" | "annual" }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", vars);
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast({
        title: "Checkout unavailable",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const planEntries: PlanId[] = ["pro", "edge", "team"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-upgrade-modal-title">
            {feature ? `Upgrade to unlock ${feature}` : "Upgrade your plan"}
          </DialogTitle>
          <DialogDescription>
            {reason || "Unlock more analyses, live data, and pro features. Cancel anytime."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2 my-2">
          <span className={`text-sm ${annual ? "text-muted-foreground" : "font-medium"}`}>Monthly</span>
          <Switch checked={annual} onCheckedChange={setAnnual} data-testid="switch-upgrade-cycle" />
          <span className={`text-sm ${annual ? "font-medium" : "text-muted-foreground"}`}>
            Annual <Badge variant="secondary" className="ml-1 text-[10px]">Save 20%</Badge>
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {planEntries.map((id) => {
            const plan = PLANS[id];
            const price = annual ? plan.priceAnnual : plan.price;
            const isHighlight = id === highlightPlan;
            const isCurrent = id === currentPlan;
            return (
              <div
                key={id}
                className={`rounded-lg border p-4 flex flex-col gap-2 ${isHighlight ? "border-primary ring-2 ring-primary" : ""}`}
                data-testid={`card-upgrade-${id}`}
              >
                {isHighlight && <Badge className="self-start">Recommended</Badge>}
                <div>
                  <h3 className="font-semibold">{plan.name}</h3>
                  <div className="mt-1">
                    <span className="text-2xl font-bold">${price}</span>
                    <span className="text-xs text-muted-foreground">/{annual ? "yr" : "mo"}</span>
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground flex-1">
                  {PLAN_FEATURES[id].map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant={isHighlight ? "default" : "outline"}
                  disabled={isCurrent || checkout.isPending}
                  onClick={() => checkout.mutate({ planId: id, cycle: annual ? "annual" : "monthly" })}
                  data-testid={`button-upgrade-to-${id}`}
                >
                  {isCurrent ? "Current plan" : checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upgrade"}
                </Button>
              </div>
            );
          })}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" asChild data-testid="link-view-pricing">
            <a href="/pricing" target="_blank" rel="noreferrer">
              See full pricing <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} data-testid="button-upgrade-close">
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
