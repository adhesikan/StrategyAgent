import { useState } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePlan } from "@/context/PlanContext";
import { UpgradeModal } from "@/components/upgrade-modal";

interface QuotaBannerProps {
  threshold?: number;
  dismissible?: boolean;
  className?: string;
}

/**
 * Shows when daily AI analysis usage crosses `threshold` (default 80%).
 * Hides for unlimited plans.
 */
export function QuotaBanner({ threshold = 80, dismissible = true, className }: QuotaBannerProps) {
  const { dailyAnalysesUsed, dailyAnalysesLimit, quotaPercent, upgradeTo, isLoading } = usePlan();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  if (isLoading) return null;
  if (dailyAnalysesLimit === -1) return null;
  if (quotaPercent < threshold) return null;
  if (dismissed) return null;

  const isAtLimit = dailyAnalysesUsed >= dailyAnalysesLimit;

  return (
    <>
      <div
        className={`rounded-lg border ${isAtLimit ? "border-destructive/50 bg-destructive/5" : "border-amber-500/50 bg-amber-500/5"} p-3 flex items-center gap-3 ${className ?? ""}`}
        data-testid="banner-quota"
      >
        <AlertTriangle className={`h-4 w-4 shrink-0 ${isAtLimit ? "text-destructive" : "text-amber-600"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium" data-testid="text-quota-headline">
              {isAtLimit
                ? "Daily AI analysis limit reached"
                : `${dailyAnalysesUsed} of ${dailyAnalysesLimit} daily analyses used`}
            </p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {dailyAnalysesUsed}/{dailyAnalysesLimit}
            </span>
          </div>
          <Progress value={quotaPercent} className="h-1.5 mt-1.5" />
          {isAtLimit && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Resets at midnight UTC. Upgrade for more daily analyses.
            </p>
          )}
        </div>
        {upgradeTo && (
          <Button size="sm" onClick={() => setOpen(true)} data-testid="button-quota-upgrade">
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Upgrade
          </Button>
        )}
        {dismissible && !isAtLimit && (
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            data-testid="button-quota-dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <UpgradeModal
        open={open}
        onOpenChange={setOpen}
        highlightPlan={upgradeTo ?? undefined}
        reason="Get more (or unlimited) AI analyses each day."
      />
    </>
  );
}
