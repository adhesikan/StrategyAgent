/**
 * Radar Universe Service — resolves the symbol set used by Opportunity Radar.
 *
 * Sources, in priority order:
 *  1. Explicit `customSymbols` filter
 *  2. User's watchlist (when universe = "watchlist")
 *  3. Predefined universes (large_cap, high_volume, options_liquid)
 *  4. Fallback demo symbols
 */

import { storage } from "../../storage";
import { DOW_30 } from "../../symbol-universes";

export const FALLBACK_DEMO_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMD",
  "TSLA",
  "META",
  "AMZN",
  "GOOGL",
  "MU",
  "PLTR",
];

const HIGH_VOLUME = ["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "META", "AMZN", "GOOGL", "SPY", "QQQ", "PLTR", "MU", "INTC", "F", "BAC"];
const OPTIONS_LIQUID = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL", "IWM", "DIA", "BAC", "F", "INTC"];

export type RadarUniverseId = "watchlist" | "large_cap" | "high_volume" | "options_liquid" | "custom";

export interface UniverseRequest {
  universe: RadarUniverseId;
  customSymbols?: string[];
  userId: string;
}

export async function resolveUniverse(req: UniverseRequest): Promise<string[]> {
  if (req.customSymbols && req.customSymbols.length > 0) {
    return normalize(req.customSymbols);
  }

  switch (req.universe) {
    case "watchlist": {
      try {
        const watchlists = await storage.getWatchlists(req.userId);
        const symbols = new Set<string>();
        for (const wl of watchlists) {
          for (const s of wl.symbols ?? []) symbols.add(s);
        }
        const arr = Array.from(symbols);
        return arr.length > 0 ? normalize(arr) : normalize(FALLBACK_DEMO_SYMBOLS);
      } catch {
        return normalize(FALLBACK_DEMO_SYMBOLS);
      }
    }
    case "large_cap":
      return normalize(DOW_30);
    case "high_volume":
      return normalize(HIGH_VOLUME);
    case "options_liquid":
      return normalize(OPTIONS_LIQUID);
    case "custom":
    default:
      return normalize(FALLBACK_DEMO_SYMBOLS);
  }
}

function normalize(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).slice(0, 30);
}
