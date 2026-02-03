import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

interface BrokerStatus {
  id: string;
  userId: string;
  provider: string;
  isConnected: boolean;
  lastSync: string | null;
}

interface DataSourceStatus {
  activeSource: string;
  activeProvider: string | null;
  isLive: boolean;
  hasBrokerConnection: boolean;
  brokerProvider: string | null;
}

interface DataStatus {
  isLive: boolean;
  provider?: string;
  error?: string;
}

interface BrokerStatusContextValue {
  status: BrokerStatus | null;
  isConnected: boolean;
  isLoading: boolean;
  providerName: string | null;
  dataStatus: DataStatus | null;
  dataSourceStatus: DataSourceStatus | null;
  hasDataSource: boolean;
}

const BrokerStatusContext = createContext<BrokerStatusContextValue | null>(null);

const providerNames: Record<string, string> = {
  tradier: "Tradier",
  alpaca: "Alpaca",
  polygon: "Polygon.io",
  schwab: "Charles Schwab",
  ibkr: "Interactive Brokers",
};

export function BrokerStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { data: status, isLoading } = useQuery<BrokerStatus | null>({
    queryKey: ["/api/broker/status"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const { data: dataSourceStatus } = useQuery<DataSourceStatus>({
    queryKey: ["/api/data-source/status"],
    refetchInterval: 30000,
  });

  const isConnected = !!status?.isConnected;
  const providerName = status?.provider ? providerNames[status.provider] || status.provider : null;
  
  const dataStatus: DataStatus | null = dataSourceStatus ? {
    isLive: dataSourceStatus.isLive,
    provider: dataSourceStatus.activeProvider || undefined,
  } : null;
  
  // Has data source if broker is connected
  const hasDataSource = isConnected || false;

  return (
    <BrokerStatusContext.Provider value={{ status: status ?? null, isConnected, isLoading, providerName, dataStatus, dataSourceStatus: dataSourceStatus ?? null, hasDataSource }}>
      {children}
    </BrokerStatusContext.Provider>
  );
}

export function useBrokerStatus() {
  const context = useContext(BrokerStatusContext);
  if (!context) {
    return { status: null, isConnected: false, isLoading: false, providerName: null, dataStatus: null, dataSourceStatus: null, hasDataSource: false };
  }
  return context;
}
