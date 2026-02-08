import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus, OrderRequest, OrderResponse } from "../types";

export const tradestationProvider: BrokerProvider = {
  async getStatus(_accessToken: string): Promise<BrokerStatus> {
    throw new Error("TradeStation provider not yet implemented");
  },

  async getAccounts(_accessToken: string): Promise<NormalizedAccount[]> {
    throw new Error("TradeStation provider not yet implemented");
  },

  async getPositions(_accessToken: string, _accountId?: string): Promise<NormalizedPosition[]> {
    throw new Error("TradeStation provider not yet implemented");
  },

  async getOrders(_accessToken: string, _accountId?: string): Promise<NormalizedOrder[]> {
    throw new Error("TradeStation provider not yet implemented");
  },

  async placeOrder(_accessToken: string, _order: OrderRequest): Promise<OrderResponse> {
    throw new Error("TradeStation provider not yet implemented");
  },
};
