import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function BillingSection() {
  const {
    plan,
    planName,
    status,
    billingCycle,
    isTrialing,
    trialDaysLeft,
    trialEndsAt,
    currentPeriodEndsAt,
    dailyAnalysesUsed,
    dailyAnalysesLimit,
    quotaPercent,
    isLoading,
    hasStripeSubscription,
  } = usePlan();
  const { toast } = useToast();

  const portal = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't open billing portal",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const checkout = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/checkout", { planId: "pro", cycle: "monthly" });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't start checkout",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const limitLabel = dailyAnalysesLimit === -1 ? "Unlimited" : String(dailyAnalysesLimit);

  // Paid = a real Stripe subscription on a non-free plan (app-managed trial
  // users have no Stripe records, so the billing portal would fail for them).
  const isPaidSubscriber =
    hasStripeSubscription && !isTrialing && plan !== "free" && status !== "trial_expired";
  const displayPlanName = isTrialing
    ? "14-Day Free Trial"
    : isPaidSubscriber
    ? "VCP Trader AI Pro"
    : planName;
  const planSubtitle = isTrialing
    ? `${trialDaysLeft ?? 0} day${(trialDaysLeft ?? 0) === 1 ? "" : "s"} remaining — trial ends ${formatDate(trialEndsAt)}. Subscribe to VCP Trader AI Pro ($99/month) to continue after your trial.`
    : isPaidSubscriber
    ? `Monthly plan — renews ${formatDate(currentPeriodEndsAt)}`
    : status === "trial_expired"
    ? "Your free trial has ended. Subscribe to VCP Trader AI Pro ($99/month) to regain full access."
    : "Subscribe to VCP Trader AI Pro ($99/month) to unlock full access.";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">Plan & Billing</CardTitle>
              <CardDescription>
                Manage your subscription, payment method, and invoices.
              </CardDescription>
            </div>
            {plan !== "free" && (
              <Badge variant="secondary" data-testid="badge-billing-cycle">
                {billingCycle === "annual" ? "Annual" : "Monthly"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Current plan</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xl font-semibold" data-testid="text-current-plan-name">
                  {displayPlanName}
                </p>
                {isTrialing && (
                  <Badge className="text-[10px]" data-testid="badge-trial">
                    {trialDaysLeft ?? 0}d left
                  </Badge>
                )}
                {status === "past_due" && (
                  <Badge variant="destructive" className="text-[10px]">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Past due
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-md" data-testid="text-plan-subtitle">
                {planSubtitle}
              </p>
            </div>
            <div className="flex gap-2">
              {isPaidSubscriber ? (
                <Button
                  onClick={() => portal.mutate()}
                  disabled={portal.isPending}
                  data-testid="button-open-portal"
                >
                  {portal.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4 mr-1" />
                  )}
                  Manage in Stripe
                </Button>
              ) : (
                <Button
                  onClick={() => checkout.mutate()}
                  disabled={checkout.isPending}
                  data-testid="button-upgrade-from-settings"
                >
                  {checkout.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  Upgrade
                </Button>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Daily AI analyses</span>
              <span className="text-muted-foreground tabular-nums" data-testid="text-quota-usage">
                {dailyAnalysesUsed} / {limitLabel}
              </span>
            </div>
            {dailyAnalysesLimit !== -1 && (
              <Progress value={quotaPercent} className="h-2 mt-2" />
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              Quota resets daily at 00:00 UTC. {dailyAnalysesLimit === -1 ? "Your plan includes unlimited AI analyses." : "Upgrade for higher limits or unlimited usage."}
            </p>
          </div>

          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>
    </div>
  );
}
