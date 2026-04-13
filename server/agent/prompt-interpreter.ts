import { StrategyId, type StrategyIdType } from "../strategies/types";

export interface ParsedRequest {
  intent: "generate_trade_setup" | "unknown";
  strategy: StrategyIdType | null;
  symbol: string | null;
  assetType: "stock" | "option" | "future";
  timeframe: string | null;
  bias: "bullish" | "bearish" | "neutral" | null;
  rewardRiskMin: number | null;
  customStrategyId: string | null;
  raw: string;
}

const SYMBOL_PATTERN = /\b([A-Z]{1,5})\b/g;

const COMMON_WORDS = new Set([
  "THE", "FOR", "AND", "USE", "GET", "SET", "RUN", "BUY", "PUT",
  "CALL", "SELL", "STOP", "HIGH", "LOW", "DAY", "MIN", "ORB",
  "EMA", "ATR", "VWAP", "VCP", "GIVE", "FIND", "SHOW", "WITH",
  "THAT", "THIS", "FROM", "HAVE", "WILL", "CAN", "NOT", "ARE",
  "WAS", "HAS", "HAD", "HIS", "HER", "ITS", "OUR", "ALL",
  "ANY", "BUT", "FEW", "HAS", "HOW", "ITS", "MAY", "NEW",
  "NOW", "OLD", "OUR", "OUT", "OWN", "SAY", "TOO", "TRY",
  "TWO", "WAY", "WHO", "WHY", "YET", "RISK", "SETUP",
  "TRADE", "BASED", "USING", "ABOVE", "BELOW", "RANGE",
  "BREAK", "PRICE", "ENTRY", "EXIT", "LONG", "SHORT",
  "IDEA", "STOCK", "FIRST", "MARKET", "OPEN",
]);

const STRATEGY_MAP: Record<string, StrategyIdType> = {
  "15 orb": StrategyId.ORB15,
  "15-min orb": StrategyId.ORB15,
  "15 min orb": StrategyId.ORB15,
  "15-minute orb": StrategyId.ORB15,
  "15 minute orb": StrategyId.ORB15,
  "opening range breakout 15": StrategyId.ORB15,
  "opening range breakout": StrategyId.ORB15,
  "opening range": StrategyId.ORB15,
  "orb 15": StrategyId.ORB15,
  "orb15": StrategyId.ORB15,
  "5 orb": StrategyId.ORB5,
  "5-min orb": StrategyId.ORB5,
  "5 min orb": StrategyId.ORB5,
  "5-minute orb": StrategyId.ORB5,
  "5 minute orb": StrategyId.ORB5,
  "orb 5": StrategyId.ORB5,
  "orb5": StrategyId.ORB5,
  "vwap reclaim": StrategyId.VWAP_RECLAIM,
  "vwap": StrategyId.VWAP_RECLAIM,
  "ema pullback": StrategyId.CLASSIC_PULLBACK,
  "pullback": StrategyId.CLASSIC_PULLBACK,
  "classic pullback": StrategyId.CLASSIC_PULLBACK,
  "volatility breakout": StrategyId.VOLATILITY_SQUEEZE,
  "volatility squeeze": StrategyId.VOLATILITY_SQUEEZE,
  "vol squeeze": StrategyId.VOLATILITY_SQUEEZE,
  "vcp": StrategyId.VCP,
  "vcp breakout": StrategyId.VCP,
  "vcp-style breakout": StrategyId.VCP,
  "vcp style breakout": StrategyId.VCP,
  "gap and go": StrategyId.GAP_AND_GO,
  "gap & go": StrategyId.GAP_AND_GO,
  "high rvol": StrategyId.HIGH_RVOL,
  "high relative volume": StrategyId.HIGH_RVOL,
  "trend continuation": StrategyId.TREND_CONTINUATION,
};

const TIMEFRAME_MAP: Record<string, string> = {
  "1m": "1m",
  "1 min": "1m",
  "1-min": "1m",
  "1 minute": "1m",
  "5m": "5m",
  "5 min": "5m",
  "5-min": "5m",
  "5 minute": "5m",
  "15m": "15m",
  "15 min": "15m",
  "15-min": "15m",
  "15 minute": "15m",
  "15-minute": "15m",
  "30m": "30m",
  "30 min": "30m",
  "1h": "1h",
  "1 hour": "1h",
  "daily": "1D",
  "1d": "1D",
  "weekly": "1W",
};

const ASSET_TYPE_MAP: Record<string, "stock" | "option" | "future"> = {
  stock: "stock",
  stocks: "stock",
  equity: "stock",
  equities: "stock",
  option: "option",
  options: "option",
  future: "future",
  futures: "future",
  es: "future",
  nq: "future",
  ym: "future",
  cl: "future",
  gc: "future",
};

const FUTURES_SYMBOLS = new Set(["ES", "NQ", "YM", "CL", "GC", "SI", "ZB", "ZN", "RTY", "MES", "MNQ"]);

export function parsePrompt(prompt: string): ParsedRequest {
  const lower = prompt.toLowerCase().trim();
  const upper = prompt.toUpperCase().trim();

  const result: ParsedRequest = {
    intent: "generate_trade_setup",
    strategy: null,
    symbol: null,
    assetType: "stock",
    timeframe: null,
    bias: null,
    rewardRiskMin: null,
    customStrategyId: null,
    raw: prompt,
  };

  const sortedKeys = Object.keys(STRATEGY_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      result.strategy = STRATEGY_MAP[key];
      break;
    }
  }

  const sortedTfKeys = Object.keys(TIMEFRAME_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedTfKeys) {
    if (lower.includes(key)) {
      result.timeframe = TIMEFRAME_MAP[key];
      break;
    }
  }

  for (const [key, type] of Object.entries(ASSET_TYPE_MAP)) {
    if (lower.includes(key)) {
      result.assetType = type;
      break;
    }
  }

  const symbolMatches = upper.match(SYMBOL_PATTERN);
  if (symbolMatches) {
    for (const match of symbolMatches) {
      if (!COMMON_WORDS.has(match) && match.length >= 1) {
        if (FUTURES_SYMBOLS.has(match)) {
          result.assetType = "future";
        }
        result.symbol = match;
        break;
      }
    }
  }

  if (lower.includes("bullish") || lower.includes("long") || lower.includes("buy")) {
    result.bias = "bullish";
  } else if (lower.includes("bearish") || lower.includes("short") || lower.includes("sell")) {
    result.bias = "bearish";
  }

  const rrMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?::|to)\s*1\s*(?:reward|r\/r|rr|risk)/);
  if (rrMatch) {
    result.rewardRiskMin = parseFloat(rrMatch[1]);
  }
  const rrMatch2 = lower.match(/(?:reward|r\/r|rr).*?(\d+(?:\.\d+)?)\s*(?::|to)\s*1/);
  if (!result.rewardRiskMin && rrMatch2) {
    result.rewardRiskMin = parseFloat(rrMatch2[1]);
  }

  if (result.strategy && !result.timeframe) {
    if (result.strategy === StrategyId.ORB15) result.timeframe = "15m";
    else if (result.strategy === StrategyId.ORB5) result.timeframe = "5m";
    else if (result.strategy === StrategyId.VWAP_RECLAIM) result.timeframe = "5m";
    else if (result.strategy === StrategyId.GAP_AND_GO) result.timeframe = "5m";
  }

  return result;
}
