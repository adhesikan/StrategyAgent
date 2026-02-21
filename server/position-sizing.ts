import { storage } from "./storage";
import { getBrokerAccounts } from "./broker/index";
import type { UserSettings } from "@shared/schema";

export interface PositionSizeResult {
  quantity: number;
  method: string;
  notionalValue: number;
  details: string;
}

export async function resolvePositionSize(
  userId: string,
  price: number,
  riskPerShare?: number,
): Promise<PositionSizeResult> {
  const userSettings = await storage.getUserSettings(userId);

  const method = userSettings?.positionSizingMethod || "fixed_dollar";
  const value = userSettings?.positionSizingValue || 1000;

  if (price <= 0) {
    return { quantity: 1, method, notionalValue: price, details: "Price invalid, defaulting to 1 share" };
  }

  let quantity = 0;
  let details = "";

  switch (method) {
    case "fixed_dollar": {
      quantity = Math.floor(value / price);
      details = `Fixed $${value} / $${price.toFixed(2)} per share`;
      break;
    }

    case "fixed_shares": {
      quantity = value;
      details = `Fixed ${value} shares`;
      break;
    }

    case "percent_account": {
      const accountBalance = await getAccountBalance(userId);
      if (accountBalance > 0) {
        const allocation = accountBalance * (value / 100);
        quantity = Math.floor(allocation / price);
        details = `${value}% of $${accountBalance.toFixed(0)} account = $${allocation.toFixed(0)}`;
      } else {
        quantity = Math.floor(1000 / price);
        details = `Account balance unavailable, fallback to $1,000`;
      }
      break;
    }

    default: {
      quantity = Math.floor(1000 / price);
      details = `Fallback: $1,000 / $${price.toFixed(2)} per share`;
    }
  }

  if (quantity <= 0) quantity = 1;

  const notionalValue = quantity * price;

  return { quantity, method, notionalValue, details };
}

async function getAccountBalance(userId: string): Promise<number> {
  try {
    const connection = await storage.getBrokerConnection(userId);
    if (!connection || !connection.isConnected || !connection.preferredAccountId) {
      return 0;
    }

    const accounts = await getBrokerAccounts(userId);
    const preferred = accounts.find(a => a.id === connection.preferredAccountId);
    if (preferred) {
      return preferred.equity || preferred.buyingPower || 0;
    }

    if (accounts.length > 0) {
      return accounts[0].equity || accounts[0].buyingPower || 0;
    }

    return 0;
  } catch (error: any) {
    console.error(`[PositionSizing] Failed to get account balance for user ${userId}: ${error.message}`);
    return 0;
  }
}

export function getTraderTypeConfig(traderType: string | null | undefined) {
  switch (traderType) {
    case "day":
      return {
        allowEquities: true,
        allowOptions: false,
        allowFutures: false,
        autoCloseEOD: true,
        holdDuration: "intraday" as const,
        label: "Day Trader",
      };
    case "options":
      return {
        allowEquities: false,
        allowOptions: true,
        allowFutures: false,
        autoCloseEOD: false,
        holdDuration: "multi-day" as const,
        label: "Options Trader",
      };
    case "futures":
      return {
        allowEquities: false,
        allowOptions: false,
        allowFutures: true,
        autoCloseEOD: false,
        holdDuration: "multi-day" as const,
        label: "Futures Trader",
      };
    case "swing":
    default:
      return {
        allowEquities: true,
        allowOptions: false,
        allowFutures: false,
        autoCloseEOD: false,
        holdDuration: "multi-day" as const,
        label: "Swing Trader",
      };
  }
}
