import type {
  FuturesTick,
  FuturesBar,
  FuturesOrderUpdate,
  FuturesPositionUpdate,
} from "../futures/types";

export function normalizeLastTrade(data: Record<string, unknown>): Partial<FuturesTick> | null {
  const symbol = data.symbol as string | undefined;
  const price = data.tradePrice as number | undefined;
  const volume = data.tradeSize as number | undefined;

  if (!symbol || price === undefined) return null;

  return {
    symbol: normalizeSymbol(symbol),
    price,
    volume: volume ?? 0,
    timestamp: Date.now(),
  };
}

export function normalizeBbo(data: Record<string, unknown>): Partial<FuturesTick> | null {
  const symbol = data.symbol as string | undefined;
  if (!symbol) return null;

  const result: Partial<FuturesTick> = {
    symbol: normalizeSymbol(symbol),
    timestamp: Date.now(),
  };

  const bid = data.bidPrice as number | undefined;
  const ask = data.askPrice as number | undefined;
  if (bid !== undefined) result.bid = bid;
  if (ask !== undefined) result.ask = ask;

  return result;
}

export function normalizeTimeBar(data: Record<string, unknown>): FuturesBar | null {
  const symbol = data.symbol as string | undefined;
  const open = (data.openPrice as number | undefined) ?? (data.open_price as number | undefined);
  const high = (data.highPrice as number | undefined) ?? (data.high_price as number | undefined);
  const low = (data.lowPrice as number | undefined) ?? (data.low_price as number | undefined);
  const close = (data.closePrice as number | undefined) ?? (data.close_price as number | undefined);

  if (!symbol || open === undefined || high === undefined || low === undefined || close === undefined) {
    return null;
  }

  const ssboe = (data.barClosingSsboe as number | undefined) ?? (data.ssboe as number | undefined);
  const time = ssboe ? ssboe : Math.floor(Date.now() / 1000);

  return {
    symbol: normalizeSymbol(symbol),
    time,
    open,
    high,
    low,
    close,
    volume: (data.volume as number) ?? 0,
  };
}

export function normalizeOrderNotification(data: Record<string, unknown>): FuturesOrderUpdate | null {
  const orderId = (data.basketId as string | undefined) ?? (data.orderId as string | undefined);
  const symbol = data.symbol as string | undefined;

  if (!orderId || !symbol) return null;

  const status = mapOrderStatus(data.notifyType as number | string | undefined);

  return {
    brokerOrderId: String(orderId),
    symbol: normalizeSymbol(symbol),
    side: (data.transactionType as number) === 1 ? "buy" : "sell",
    qty: (data.quantity as number) ?? (data.fillSize as number) ?? 0,
    status,
    fillPrice: data.avgFillPrice as number | undefined,
    filledAt: status === "filled" ? Date.now() : undefined,
  };
}

export function normalizePositionUpdate(data: Record<string, unknown>): FuturesPositionUpdate | null {
  const symbol = data.symbol as string | undefined;
  if (!symbol) return null;

  return {
    symbol: normalizeSymbol(symbol),
    qty: (data.buyQty as number ?? 0) - (data.sellQty as number ?? 0),
    avgPrice: (data.avgOpenFillPrice as number) ?? 0,
    unrealizedPnl: (data.openPnl as number) ?? 0,
  };
}

function normalizeSymbol(raw: string): string {
  const knownRoots = [
    "MES", "MNQ", "MYM", "M2K", "MGC", "MCL",
    "ES", "NQ", "YM", "RTY",
    "GC", "SI", "CL", "NG",
    "ZB", "ZN", "ZC", "ZS", "ZW", "ZF", "ZT",
    "HE", "LE",
    "6E", "6J", "6B", "6A", "6C", "6S",
  ];
  for (const root of knownRoots) {
    if (raw.toUpperCase().startsWith(root) && raw.length > root.length) {
      return root;
    }
  }
  return raw;
}

function mapOrderStatus(notifyType: number | string | undefined): "accepted" | "filled" | "rejected" | "canceled" {
  if (notifyType === undefined) return "accepted";
  const nt = typeof notifyType === "string" ? parseInt(notifyType) : notifyType;

  switch (nt) {
    case 1:
      return "accepted";
    case 2:
      return "filled";
    case 3:
      return "rejected";
    case 4:
    case 5:
      return "canceled";
    default:
      return "accepted";
  }
}
