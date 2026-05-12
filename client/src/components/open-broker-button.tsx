import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import {
  getBrokerPortalUrl,
  getBrokerDisplayName,
  type BrokerPortalView,
} from "@shared/broker-links";

interface OpenBrokerButtonProps {
  view?: BrokerPortalView;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  label?: string;
  className?: string;
  testId?: string;
  showProviderName?: boolean;
}

export function OpenBrokerButton({
  view = "dashboard",
  size = "sm",
  variant = "outline",
  label,
  className,
  testId = "link-open-broker",
  showProviderName = true,
}: OpenBrokerButtonProps) {
  const { isConnected, providerName } = useBrokerStatus();
  if (!isConnected || !providerName) return null;

  const url = getBrokerPortalUrl(providerName, view);
  if (!url) return null;

  const display = getBrokerDisplayName(providerName) ?? providerName;
  const viewLabel: Record<BrokerPortalView, string> = {
    dashboard: "Open in Broker",
    positions: "View Positions in Broker",
    orders: "View Orders in Broker",
    history: "View History in Broker",
  };
  const text = label ?? (showProviderName ? `Open ${display}` : viewLabel[view]);

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId}>
      <Button variant={variant} size={size} className="gap-1.5 text-xs">
        <ExternalLink className="h-3.5 w-3.5" />
        {text}
      </Button>
    </a>
  );
}
