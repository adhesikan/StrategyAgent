import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTooltipVisibility } from "@/hooks/use-tooltips";

export const institutionalMetricDescriptions = {
  accumulationScore:
    "Composite score derived from reported institutional activity, breadth, concentration, entrants versus exits, and data quality. It describes reported filing activity and is not a buy or sell recommendation.",
  reportedHolders:
    "Number of tracked reporting managers that reported holding the security in the selected quarter.",
  reportedShares:
    "Total shares reported by tracked managers in the selected quarter.",
  mappingCoverage:
    "Percentage of eligible common-equity holdings that can be reliably linked to the researched security.",
  trendClassification:
    "Classification of the direction and persistence of reported institutional activity across comparable quarters.",
  breadthDirection:
    "Measures how broadly reported institutional participation is distributed across comparable managers.",
  newlyReported:
    "Managers reporting a position in the selected quarter that did not report one in the comparable prior quarter.",
  increased:
    "Managers whose reported share count increased versus the comparable prior quarter.",
  reduced:
    "Managers whose reported share count decreased versus the comparable prior quarter.",
  noLongerReported:
    "Managers that reported a position in the prior quarter but no longer report one in the selected quarter.",
  unchanged:
    "Managers whose reported share count did not change versus the comparable prior quarter.",
  concentration:
    "How much of the reported share total is held by the largest reported positions.",
  qoqShares:
    "Change in reported shares versus the comparable prior quarter.",
  breadth:
    "Measures how broadly reported institutional participation is distributed across comparable managers.",
  dataQuality:
    "Reflects the completeness and reliability of the institutional data used to calculate this analysis.",
  entrantsVsExits:
    "Compares managers newly reporting a position with managers that no longer report the position in the comparable quarter.",
  signalConfidence:
    "Indicates how much comparable reported-manager history supports the deterministic signal classification.",
  comparableManagers:
    "Number of tracked managers present in both quarters used for the quarter-over-quarter comparison.",
  dataAsOf:
    "The quarter-end date represented by the institutional data, not the filing or transaction date.",
  signal:
    "Deterministic classification derived from reported institutional activity. It describes the filing pattern and is not investment advice.",
} as const;

export type InstitutionalMetricName =
  keyof typeof institutionalMetricDescriptions;

interface InstitutionalMetricTooltipProps {
  metric: InstitutionalMetricName;
  label?: string;
  className?: string;
}

export function InstitutionalMetricTooltip({
  metric,
  label,
  className = "",
}: InstitutionalMetricTooltipProps) {
  const { tooltipsEnabled } = useTooltipVisibility();
  if (!tooltipsEnabled) return null;

  const accessibleLabel = label ?? metric.replace(/([A-Z])/g, " $1");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${className}`}
          aria-label={`Explain ${accessibleLabel}`}
        >
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug" side="top">
        <p>{institutionalMetricDescriptions[metric]}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function InstitutionalMetricLabel({
  label,
  metric,
  children,
}: {
  label: string;
  metric: InstitutionalMetricName;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      {label}
      <InstitutionalMetricTooltip metric={metric} label={label} />
    </span>
  );
}