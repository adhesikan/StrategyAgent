import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";
import { type PlanId } from "@shared/plans";

const PRO_FEATURES = [
  "Daily AI-ranked stock & options ideas",
  "Live broker-connected market data",
  "InstaTrade™ one-click order review",
  "Built-in risk checks & exit protection",
  "Smart alerts, scanner, and trade journal",
  "Cancel anytime",
];

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
  reason,
  feature,
}: UpgradeModalProps) {
  const { plan: currentPlan } = usePlan();
  const { toast } = useToast();
  const isCurrent = currentPlan === "pro";

  const checkout = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/checkout", {
        planId: "pro" as PlanId,
        cycle: "monthly" as const,
      });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-upgrade-modal-title">
            {feature ? `Upgrade to unlock ${feature}` : "Start your 14-day free trial"}
          </DialogTitle>
          <DialogDescription>
            {reason || "Get the full VCP Trader AI Pro experience. No charge during your trial — cancel anytime."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary ring-2 ring-primary/40 p-5 flex flex-col gap-3" data-testid="card-upgrade-pro">
          <Badge className="self-start gap-1">
            <Sparkles className="h-3 w-3" />
            Recommended
          </Badge>
          <div>
            <h3 className="font-semibold text-lg">VCP Trader AI Pro</h3>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-3xl font-bold">$99</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">14-day free trial · cancel anytime</p>
          </div>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Button
            size="lg"
            disabled={isCurrent || checkout.isPending}
            onClick={() => checkout.mutate()}
            data-testid="button-upgrade-to-pro"
          >
            {isCurrent ? (
              "You're on Pro"
            ) : checkout.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Start 14-Day Free Trial"
            )}
          </Button>
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
