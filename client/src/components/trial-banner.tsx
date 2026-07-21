import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sparkles, Clock, ArrowRight } from "lucide-react";
import { usePlan } from "@/context/PlanContext";

function formatRemaining(msLeft: number): string {
  if (msLeft <= 0) return "Trial ended";
  const days = Math.floor(msLeft / 86_400_000);
  const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hours} hr${hours === 1 ? "" : "s"} left`;
  if (hours > 0) return `${hours} hr${hours === 1 ? "" : "s"} ${minutes} min left`;
  return `${minutes} min left`;
}

export function TrialBanner() {
  const [, navigate] = useLocation();
  const { isTrialing, trialEndsAt, status } = usePlan();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const expired = status === "trial_expired";
  if (!isTrialing && !expired) return null;

  const msLeft = trialEndsAt ? new Date(trialEndsAt).getTime() - now : 0;
  const endingSoon = isTrialing && msLeft <= 3 * 86_400_000;

  return (
    <div
      className={`rounded-lg border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
        expired || endingSoon ? "border-primary/60 bg-primary/10" : "border-border bg-muted/40"
      }`}
      role="status"
      data-testid="banner-trial"
    >
      <div className="flex items-start gap-2 flex-1 min-w-0">
        {expired ? (
          <Clock className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <div className="text-sm">
          {expired ? (
            <p data-testid="text-trial-status">
              <span className="font-medium">Your free trial has ended.</span>{" "}
              Subscribe to keep full access to AI-ranked candidates, options strategy insights, and InstaTrade order review.
            </p>
          ) : (
            <p data-testid="text-trial-status">
              <span className="font-medium">Free trial active</span>
              {" — "}
              <span className="text-primary font-semibold" data-testid="text-trial-countdown">
                {formatRemaining(msLeft)}
              </span>
              . Subscribe any time to keep full access after your trial.
            </p>
          )}
        </div>
      </div>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => navigate("/pricing")}
        data-testid="button-trial-subscribe"
      >
        Subscribe to Pro <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}
