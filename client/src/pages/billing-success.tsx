import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { usePlan } from "@/context/PlanContext";

export default function BillingSuccessPage() {
  const [, navigate] = useLocation();
  const { plan, planName } = usePlan();

  useEffect(() => {
    document.title = "Subscription confirmed — Strategy Agent";
    // Refresh billing + auth so the rest of the app picks up the new plan.
    queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-5 rounded-xl border bg-card/40 backdrop-blur p-8">
        <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold" data-testid="text-success-title">
            You're all set!
          </h1>
          <p className="text-sm text-muted-foreground">
            Your <span className="font-semibold text-foreground">{planName}</span> plan is active. Your 14-day
            trial has started — we won't charge anything until it ends, and you can cancel any time.
          </p>
        </div>

        <div className="grid gap-2 pt-2">
          <Button onClick={() => navigate("/home")} data-testid="button-go-home">
            Go to Home <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <Button variant="outline" onClick={() => navigate("/settings?tab=billing")} data-testid="button-manage-plan">
            Manage plan & billing
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground pt-2">
          Plan: {plan} · Need help? Email support@strategyagent.com
        </p>
      </div>
    </div>
  );
}
