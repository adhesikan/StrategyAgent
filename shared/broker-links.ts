export type BrokerProviderName = "tradier" | "tradestation" | string;
export type BrokerPortalView = "dashboard" | "positions" | "orders" | "history";

const TRADIER_BASE = "https://dash.tradier.com";
const TRADESTATION_BASE = "https://my.tradestation.com";

export function getBrokerPortalUrl(
  provider: BrokerProviderName | null | undefined,
  view: BrokerPortalView = "dashboard",
): string | null {
  if (!provider) return null;
  const p = provider.toLowerCase();

  if (p === "tradier") {
    switch (view) {
      case "positions":
        return `${TRADIER_BASE}/positions`;
      case "orders":
        return `${TRADIER_BASE}/orders`;
      case "history":
        return `${TRADIER_BASE}/history`;
      default:
        return TRADIER_BASE;
    }
  }

  if (p === "tradestation") {
    return `${TRADESTATION_BASE}/dashboard`;
  }

  return null;
}

export function getBrokerDisplayName(provider: BrokerProviderName | null | undefined): string | null {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p === "tradier") return "Tradier";
  if (p === "tradestation") return "TradeStation";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
