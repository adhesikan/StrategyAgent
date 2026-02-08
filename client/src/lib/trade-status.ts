import type { ScanResult } from "@shared/schema";

export type TradeStatus = "AWAITING_BREAKOUT" | "IN_ENTRY_ZONE" | "EXTENDED";

export function getTradeStatus(result: ScanResult): TradeStatus {
  if (!result.resistance || !result.price) return "AWAITING_BREAKOUT";
  const entry = result.resistance;
  if (result.price < entry) return "AWAITING_BREAKOUT";

  const entryBandPercent = 3;
  const upperBand = entry * (1 + entryBandPercent / 100);
  if (result.price <= upperBand) return "IN_ENTRY_ZONE";

  return "EXTENDED";
}

export function getDistanceToEntry(result: ScanResult): number | null {
  if (!result.resistance || !result.price) return null;
  return ((result.resistance - result.price) / result.price) * 100;
}

export function getDistanceAboveEntry(result: ScanResult): number | null {
  if (!result.resistance || !result.price) return null;
  if (result.price <= result.resistance) return null;
  return ((result.price - result.resistance) / result.resistance) * 100;
}

export function getTradeStatusDisplay(status: TradeStatus) {
  switch (status) {
    case "AWAITING_BREAKOUT":
      return { label: "Awaiting Breakout", shortLabel: "Awaiting", variant: "outline" as const, className: "border-yellow-500/50 text-yellow-600 dark:text-yellow-400" };
    case "IN_ENTRY_ZONE":
      return { label: "In Entry Zone", shortLabel: "Actionable", variant: "default" as const, className: "bg-green-600 dark:bg-green-700 text-white" };
    case "EXTENDED":
      return { label: "Extended", shortLabel: "Extended", variant: "destructive" as const, className: "" };
  }
}

export function isActionable(result: ScanResult): boolean {
  return getTradeStatus(result) === "IN_ENTRY_ZONE";
}
