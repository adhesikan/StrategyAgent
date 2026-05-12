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
import { DOW_30, NASDAQ_100, SP_100, SP_500 } from "../../symbol-universes";

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

export type RadarUniverseId =
  | "watchlist"
  | "large_cap"
  | "high_volume"
  | "options_liquid"
  | "nasdaq_100"
  | "sp_100"
  | "sp_500"
  | "custom";

export type UniverseSource =
  | "custom"
  | "watchlist"
  | "starter_fallback"
  | "large_cap"
  | "high_volume"
  | "options_liquid"
  | "nasdaq_100"
  | "sp_100"
  | "sp_500";

export interface UniverseRequest {
  universe: RadarUniverseId;
  customSymbols?: string[];
  userId: string;
}

export interface ResolvedUniverse {
  symbols: string[];
  source: UniverseSource;
  label: string;
}

const SOURCE_LABELS: Record<UniverseSource, string> = {
  custom: "Custom symbols",
  watchlist: "My Watchlist",
  starter_fallback: "Starter List (10 popular symbols)",
  large_cap: "Large Cap (Dow 30)",
  high_volume: "High Volume",
  options_liquid: "Options Liquid",
  nasdaq_100: "Nasdaq 100",
  sp_100: "S&P 100",
  sp_500: "S&P 500",
};

export async function resolveUniverseWithMeta(req: UniverseRequest): Promise<ResolvedUniverse> {
  if (req.customSymbols && req.customSymbols.length > 0) {
    return { symbols: normalize(req.customSymbols), source: "custom", label: SOURCE_LABELS.custom };
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
        if (arr.length > 0) {
          return { symbols: normalize(arr), source: "watchlist", label: SOURCE_LABELS.watchlist };
        }
        return { symbols: normalize(FALLBACK_DEMO_SYMBOLS), source: "starter_fallback", label: SOURCE_LABELS.starter_fallback };
      } catch {
        return { symbols: normalize(FALLBACK_DEMO_SYMBOLS), source: "starter_fallback", label: SOURCE_LABELS.starter_fallback };
      }
    }
    case "large_cap":
      return { symbols: normalize(DOW_30), source: "large_cap", label: SOURCE_LABELS.large_cap };
    case "high_volume":
      return { symbols: normalize(HIGH_VOLUME), source: "high_volume", label: SOURCE_LABELS.high_volume };
    case "options_liquid":
      return { symbols: normalize(OPTIONS_LIQUID), source: "options_liquid", label: SOURCE_LABELS.options_liquid };
    case "nasdaq_100":
      return { symbols: normalize(NASDAQ_100), source: "nasdaq_100", label: SOURCE_LABELS.nasdaq_100 };
    case "sp_100":
      return { symbols: normalize(SP_100), source: "sp_100", label: SOURCE_LABELS.sp_100 };
    case "sp_500":
      return { symbols: normalize(SP_500), source: "sp_500", label: SOURCE_LABELS.sp_500 };
    case "custom":
    default:
      return { symbols: normalize(FALLBACK_DEMO_SYMBOLS), source: "starter_fallback", label: SOURCE_LABELS.starter_fallback };
  }
}

export async function resolveUniverse(req: UniverseRequest): Promise<string[]> {
  return (await resolveUniverseWithMeta(req)).symbols;
}

function normalize(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).slice(0, 30);
}
