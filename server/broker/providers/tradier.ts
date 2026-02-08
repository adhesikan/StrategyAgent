import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus } from "../types";

const BASE_URL = "https://api.tradier.com/v1";

function tradierHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function tradierFetch(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, { headers: tradierHeaders(accessToken) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tradier API error ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

export const tradierProvider: BrokerProvider = {
  async getStatus(accessToken: string): Promise<BrokerStatus> {
    const data = await tradierFetch(`${BASE_URL}/user/profile`, accessToken);
    const account = data?.profile?.account;
    const firstAccount = Array.isArray(account) ? account[0] : account;
    return {
      connected: true,
      provider: "tradier",
      accountId: firstAccount?.account_number ?? undefined,
    };
  },

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const data = await tradierFetch(`${BASE_URL}/user/profile`, accessToken);
    const accounts = data?.profile?.account;
    if (!accounts) return [];

    const accountArray = Array.isArray(accounts) ? accounts : [accounts];

    const results: NormalizedAccount[] = [];
    for (const acct of accountArray) {
      let balances: any = null;
      try {
        const balData = await tradierFetch(
          `${BASE_URL}/accounts/${acct.account_number}/balances`,
          accessToken,
        );
        balances = balData?.balances;
      } catch {
      }

      results.push({
        id: acct.account_number ?? acct.id ?? "",
        name: acct.name || acct.account_number || "Tradier Account",
        type: acct.type || acct.classification || "unknown",
        buyingPower: balances?.margin?.option_buying_power ?? balances?.cash?.cash_available ?? balances?.buying_power ?? 0,
        equity: balances?.total_equity ?? balances?.equity ?? 0,
        currency: "USD",
      });
    }

    return results;
  },

  async getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]> {
    if (!accountId) {
      const status = await this.getStatus(accessToken);
      accountId = status.accountId;
    }
    if (!accountId) return [];

    const data = await tradierFetch(
      `${BASE_URL}/accounts/${accountId}/positions`,
      accessToken,
    );

    const positions = data?.positions?.position;
    if (!positions) return [];

    const posArray = Array.isArray(positions) ? positions : [positions];

    return posArray.map((p: any) => ({
      symbol: p.symbol,
      qty: p.quantity ?? 0,
      avgPrice: p.cost_basis ? p.cost_basis / (p.quantity || 1) : 0,
      marketPrice: p.last ?? 0,
      unrealizedPnl: (p.last ?? 0) * (p.quantity ?? 0) - (p.cost_basis ?? 0),
    }));
  },

  async getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]> {
    if (!accountId) {
      const status = await this.getStatus(accessToken);
      accountId = status.accountId;
    }
    if (!accountId) return [];

    const data = await tradierFetch(
      `${BASE_URL}/accounts/${accountId}/orders`,
      accessToken,
    );

    const orders = data?.orders?.order;
    if (!orders) return [];

    const orderArray = Array.isArray(orders) ? orders : [orders];

    return orderArray.slice(0, 50).map((o: any) => ({
      id: String(o.id),
      symbol: o.symbol || (o.leg?.[0]?.symbol) || "UNKNOWN",
      side: (o.side === "sell" || o.side === "sell_short") ? "sell" as const : "buy" as const,
      qty: o.quantity ?? 0,
      status: o.status ?? "unknown",
      createdAt: o.create_date ?? o.transaction_date ?? "",
    }));
  },
};
