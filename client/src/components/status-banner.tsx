import { Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { useBrokerStatus } from "@/hooks/use-broker-status";

export function StatusBanner() {
  const { isLoading, dataStatus, dataSourceStatus } = useBrokerStatus();

  if (isLoading) {
    return null;
  }

  if (dataStatus?.isLive) {
    const providerName = dataSourceStatus?.activeProvider || 
      (dataSourceStatus?.activeSource === "brokerage" ? dataSourceStatus?.brokerProvider || "Brokerage" : 
       "Live Data");
    
    return (
      <div 
        className="bg-green-500/10 border-b border-green-500/20 px-4 py-1.5 flex items-center justify-center gap-2"
        data-testid="banner-live-data"
      >
        <Wifi className="h-3.5 w-3.5 text-green-500" />
        <span className="text-xs text-green-600 dark:text-green-400">
          Live: {providerName}
        </span>
      </div>
    );
  }

  if (dataStatus?.error) {
    return (
      <div 
        className="bg-orange-500/10 border-b border-orange-500/20 px-4 py-1.5 flex items-center justify-center gap-2"
        data-testid="banner-broker-error"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        <span className="text-xs text-orange-600 dark:text-orange-400">
          Data fetch failed - showing cached data
        </span>
      </div>
    );
  }

  return (
    <div 
      className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-1.5 flex items-center justify-center gap-2"
      data-testid="banner-mock-data"
    >
      <WifiOff className="h-3.5 w-3.5 text-yellow-500" />
      <span className="text-xs text-yellow-600 dark:text-yellow-400">
        Mock Data
      </span>
    </div>
  );
}
