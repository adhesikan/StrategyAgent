import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface PositionUpdate {
  type: "position_update" | "position_removed" | "snapshot" | "connected";
  symbol?: string;
  qty?: number;
  avgPrice?: number;
  marketPrice?: number;
  unrealizedPnl?: number;
  positions?: Array<{
    symbol: string;
    qty: number;
    avgPrice: number;
    marketPrice: number;
    unrealizedPnl: number;
  }>;
}

interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}

export function usePositionUpdates(enabled: boolean = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let stopped = false;

    const open = () => {
      if (stopped) return;
      es = new EventSource("/api/broker/position-updates", { withCredentials: true });

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as PositionUpdate;
          if (data.type === "snapshot" && Array.isArray(data.positions)) {
            queryClient.setQueryData<BrokerPosition[]>(
              ["/api/broker/positions"],
              data.positions,
            );
            return;
          }
          if (data.type === "position_update" && data.symbol) {
            queryClient.setQueryData<BrokerPosition[]>(
              ["/api/broker/positions"],
              (prev) => {
                const next = Array.isArray(prev) ? [...prev] : [];
                const idx = next.findIndex((p) => p.symbol === data.symbol);
                const updated: BrokerPosition = {
                  symbol: data.symbol!,
                  qty: data.qty ?? 0,
                  avgPrice: data.avgPrice ?? 0,
                  marketPrice: data.marketPrice ?? 0,
                  unrealizedPnl: data.unrealizedPnl ?? 0,
                };
                if (idx >= 0) next[idx] = updated;
                else next.push(updated);
                return next;
              },
            );
            return;
          }
          if (data.type === "position_removed" && data.symbol) {
            queryClient.setQueryData<BrokerPosition[]>(
              ["/api/broker/positions"],
              (prev) => (Array.isArray(prev) ? prev.filter((p) => p.symbol !== data.symbol) : []),
            );
          }
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) setTimeout(open, 5000);
      };
    };

    open();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [enabled, queryClient]);
}
