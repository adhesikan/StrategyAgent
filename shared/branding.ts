export type TrademarkStatus = "pending_registration" | "registered";

export const DEFAULT_TRADEMARK_STATUS: TrademarkStatus = "registered";

export function normalizeTrademarkStatus(value: string | undefined | null): TrademarkStatus {
  return value === "registered" ? "registered" : DEFAULT_TRADEMARK_STATUS;
}

export function getInstaTradeName(status: TrademarkStatus = DEFAULT_TRADEMARK_STATUS): string {
  void status;
  return "InstaTrade®";
}

export function getInstaTradeFooterNotice(status: TrademarkStatus = DEFAULT_TRADEMARK_STATUS): string {
  void status;
  return "InstaTrade® is a registered trademark of Sunfish Technologies LLC.";
}

export interface BrandingInfo {
  instaTradeStatus: TrademarkStatus;
  instaTradeName: string;
  instaTradeFooterNotice: string;
}

export function buildBrandingInfo(status: TrademarkStatus): BrandingInfo {
  return {
    instaTradeStatus: status,
    instaTradeName: getInstaTradeName(status),
    instaTradeFooterNotice: getInstaTradeFooterNotice(status),
  };
}
