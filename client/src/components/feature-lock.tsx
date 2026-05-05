import { useState, type ReactNode } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlan } from "@/context/PlanContext";
import { UpgradeModal } from "@/components/upgrade-modal";
import { canAccessFeature, getRequiredPlan, getPlan, type FeatureKey } from "@shared/plans";

interface FeatureLockProps {
  feature: FeatureKey | string;
  children: ReactNode;
  /**
   * "blur" → render content with blur + overlay CTA (default)
   * "banner" → render an inline upgrade banner instead of children
   * "hide" → render nothing
   */
  variant?: "blur" | "banner" | "hide";
  title?: string;
  description?: string;
  className?: string;
}

export function FeatureLock({
  feature,
  children,
  variant = "blur",
  title,
  description,
  className,
}: FeatureLockProps) {
  const { plan, isLoading } = usePlan();
  const [open, setOpen] = useState(false);

  if (isLoading) return <>{children}</>;
  if (canAccessFeature(plan, feature)) return <>{children}</>;

  const requiredPlanId = getRequiredPlan(feature);
  const requiredPlan = getPlan(requiredPlanId);
  const heading = title || `${requiredPlan.name} feature`;
  const body = description || `Upgrade to ${requiredPlan.name} to unlock ${feature}.`;

  if (variant === "hide") return null;

  if (variant === "banner") {
    return (
      <>
        <div
          className={`rounded-lg border bg-muted/30 p-4 flex items-center gap-3 ${className ?? ""}`}
          data-testid={`banner-locked-${feature}`}
        >
          <div className="rounded-md bg-primary/10 p-2 shrink-0">
            <Lock className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">{heading}</h4>
              <Badge variant="secondary" className="text-[10px]">
                <Sparkles className="h-2.5 w-2.5 mr-1" />
                {requiredPlan.name}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} data-testid={`button-unlock-${feature}`}>
            Upgrade
          </Button>
        </div>
        <UpgradeModal
          open={open}
          onOpenChange={setOpen}
          highlightPlan={requiredPlanId}
          feature={String(feature)}
          reason={body}
        />
      </>
    );
  }

  // blur variant
  return (
    <>
      <div className={`relative ${className ?? ""}`} data-testid={`lock-${feature}`}>
        <div className="pointer-events-none select-none blur-sm opacity-60" aria-hidden>
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-background/95 border rounded-lg shadow-sm p-4 max-w-sm text-center">
            <div className="mx-auto rounded-full bg-primary/10 p-2 w-fit mb-2">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <h4 className="font-semibold text-sm">{heading}</h4>
            <p className="text-xs text-muted-foreground mt-1 mb-3">{body}</p>
            <Button size="sm" onClick={() => setOpen(true)} data-testid={`button-unlock-${feature}`}>
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Upgrade to {requiredPlan.name}
            </Button>
          </div>
        </div>
      </div>
      <UpgradeModal
        open={open}
        onOpenChange={setOpen}
        highlightPlan={requiredPlanId}
        feature={String(feature)}
        reason={body}
      />
    </>
  );
}
