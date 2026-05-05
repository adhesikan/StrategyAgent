import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
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

  const limitLabel = dailyAnalysesLimit === -1 ? "Unlimited" : String(dailyAnalysesLimit);

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
                  {planName}
                </p>
                {isTrialing && (
                  <Badge className="text-[10px]" data-testid="badge-trial">
                    Trial — {trialDaysLeft ?? 0}d left
                  </Badge>
                )}
                {status === "past_due" && (
                  <Badge variant="destructive" className="text-[10px]">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Past due
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isTrialing
                  ? `Trial ends ${formatDate(trialEndsAt)}`
                  : plan === "free"
                  ? "Free forever — no card on file"
                  : `Renews ${formatDate(currentPeriodEndsAt)}`}
              </p>
            </div>
            <div className="flex gap-2">
              {plan === "free" ? (
                <Button asChild data-testid="button-upgrade-from-settings">
                  <Link href="/pricing">
                    <Sparkles className="h-4 w-4 mr-1" /> Upgrade
                  </Link>
                </Button>
              ) : (
                <>
                  <Button variant="outline" asChild data-testid="button-change-plan">
                    <Link href="/pricing">Change plan</Link>
                  </Button>
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
                </>
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
