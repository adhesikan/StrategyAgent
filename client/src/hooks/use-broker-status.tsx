import { createContext, useContext, useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

interface BrokerStatus {
  id: string;
  userId: string;
  provider: string;
  isConnected: boolean;
  lastSync: string | null;
  preferredAccountId: string | null;
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
  connectionLost: boolean;
  connectionLostProvider: string | null;
  dismissConnectionLost: () => void;
}

const BrokerStatusContext = createContext<BrokerStatusContextValue | null>(null);

const providerNames: Record<string, string> = {
  tradier: "Tradier",
  alpaca: "Alpaca",
  polygon: "Polygon.io",
  schwab: "Charles Schwab",
  ibkr: "Interactive Brokers",
};

const HEARTBEAT_INTERVAL_MS = 1000;
const FAILURE_THRESHOLD = 3;

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
  
  const hasDataSource = isConnected || false;

  const [connectionLost, setConnectionLost] = useState(false);
  const [connectionLostProvider, setConnectionLostProvider] = useState<string | null>(null);
  const failCountRef = useRef(0);
  const dismissedRef = useRef(false);

  const dismissConnectionLost = useCallback(() => {
    dismissedRef.current = true;
    setConnectionLost(false);
  }, []);

  useEffect(() => {
    if (!user || !isConnected) {
      failCountRef.current = 0;
      setConnectionLost(false);
      return;
    }

    dismissedRef.current = false;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/broker/ping", { credentials: "include" });
        if (!res.ok) {
          failCountRef.current++;
        } else {
          const data = await res.json();
          if (data.ok) {
            failCountRef.current = 0;
            if (!dismissedRef.current) {
              setConnectionLost(false);
              setConnectionLostProvider(null);
            }
          } else {
            failCountRef.current++;
            if (failCountRef.current >= FAILURE_THRESHOLD && !dismissedRef.current) {
              setConnectionLost(true);
              setConnectionLostProvider(
                data.provider ? (providerNames[data.provider] || data.provider) : providerName
              );
            }
          }
        }
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= FAILURE_THRESHOLD && !dismissedRef.current) {
          setConnectionLost(true);
          setConnectionLostProvider(providerName);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user, isConnected, providerName]);

  return (
    <BrokerStatusContext.Provider value={{
      status: status ?? null,
      isConnected,
      isLoading,
      providerName,
      dataStatus,
      dataSourceStatus: dataSourceStatus ?? null,
      hasDataSource,
      connectionLost,
      connectionLostProvider,
      dismissConnectionLost,
    }}>
      {children}
    </BrokerStatusContext.Provider>
  );
}

export function useBrokerStatus() {
  const context = useContext(BrokerStatusContext);
  if (!context) {
    return {
      status: null,
      isConnected: false,
      isLoading: false,
      providerName: null,
      dataStatus: null,
      dataSourceStatus: null,
      hasDataSource: false,
      connectionLost: false,
      connectionLostProvider: null,
      dismissConnectionLost: () => {},
    };
  }
  return context;
}
