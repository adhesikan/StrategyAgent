// Shared strategy catalog used by the Daily Idea card and the Trade Detail
// review page so both surfaces describe the strategy used to find / structure
// each idea in the same words. Keyed by a small set of canonical strategy
// slugs that map cleanly from both `DailyIdea.instrumentType` and the
// trade-detail `TradeType` URL param.

export type StrategyKey =
  | "stock_swing"
  | "long_call"
  | "long_put"
  | "debit_spread"
  | "covered_call"
  | "cash_secured_put"
  | "short_premium"
  | "complex";

export interface StrategyInfo {
  /** Short human-readable name shown on cards and headings. */
  name: string;
  /** One-line tagline used in tooltips and subtitles. */
  tagline: string;
  /** A few sentences explaining the mechanics in plain language. */
  howItWorks: string;
  /** Market conditions the strategy is suited to. */
  whenItWorks: string;
  /** Main risks / things that go wrong. */
  mainRisks: string;
}

export const STRATEGY_CATALOG: Record<StrategyKey, StrategyInfo> = {
  stock_swing: {
    name: "Swing Momentum",
    tagline: "Multi-day to multi-week directional move in the underlying stock.",
    howItWorks:
      "Buys (or shorts) the underlying shares with a defined entry pivot and stop. Position sizing is computed from your stated max risk per trade so the dollar loss at the stop matches your risk budget.",
    whenItWorks:
      "Trending markets with healthy relative strength, expanding volume on the breakout bar, and no major event risk inside the planned hold window.",
    mainRisks:
      "Whipsaws on failed breakouts, gaps through the stop on overnight news, and broad-market reversals that drag the position even if the setup was clean.",
  },
  long_call: {
    name: "Directional Call Buy",
    tagline: "Defined-risk bullish bet using a single at-the-money call.",
    howItWorks:
      "Buys one ATM (or slightly OTM) call with ~30-45 days to expiration. Maximum loss is the premium paid; profits scale with the underlying moving above the break-even (strike + premium) before expiration.",
    whenItWorks:
      "Strong bullish technical structure with rising momentum and acceptable implied-volatility levels. Best when you expect the move to play out in days to a few weeks, not months.",
    mainRisks:
      "Theta decay erodes the premium each day, and a quick IV crush after a catalyst can hurt even when direction is right. A flat or slow move loses money.",
  },
  long_put: {
    name: "Directional Put Buy",
    tagline: "Defined-risk bearish bet using a single at-the-money put.",
    howItWorks:
      "Buys one ATM (or slightly OTM) put with ~30-45 days to expiration. Maximum loss is the premium paid; profits scale as the underlying moves below the break-even (strike − premium) before expiration.",
    whenItWorks:
      "Bearish technical structure, breakdowns from distribution, or hedging long stock exposure into a known event window.",
    mainRisks:
      "Theta decay, IV crush after the catalyst resolves, and short-squeeze rallies that push the underlying back through the strike.",
  },
  debit_spread: {
    name: "Vertical Debit Spread",
    tagline: "Two-leg defined-risk options structure that caps both sides.",
    howItWorks:
      "Buys an at-the-money option and sells one further out-of-the-money in the same expiration (calls when bullish, puts when bearish). The short leg subsidises the long leg, so the net debit is smaller than a naked long option — but the max profit is also capped at the spread width minus the debit.",
    whenItWorks:
      "Moderate directional convictions where you want a defined risk:reward and lower premium outlay than a naked long option, especially in elevated implied-volatility environments.",
    mainRisks:
      "Limited upside vs. a naked long option, and pin risk near the short strike around expiration. Early assignment on the short leg is rare but possible on American-style options near a dividend.",
  },
  covered_call: {
    name: "Covered Call Income",
    tagline: "Sell upside in shares you already own to collect premium today.",
    howItWorks:
      "Holds 100 shares of the underlying and sells one out-of-the-money call against them. Collects the premium up-front; if the stock closes above the strike at expiration, the shares are called away at that strike (and you keep the premium plus the move up to the strike).",
    whenItWorks:
      "Neutral to mildly bullish outlook on a stock you would be comfortable holding or letting go at the chosen strike. Higher implied volatility = richer premium.",
    mainRisks:
      "Caps your upside above the strike and does not protect against a meaningful drop in the shares — premium collected only offsets a small portion of a real decline.",
  },
  cash_secured_put: {
    name: "Cash-Secured Put",
    tagline: "Get paid to set a limit price on a stock you want to own.",
    howItWorks:
      "Sells one out-of-the-money put and reserves enough cash to buy 100 shares at the strike if assigned. Collects the premium up-front; if the stock stays above the strike, you keep the premium and the put expires worthless.",
    whenItWorks:
      "Neutral-to-bullish view on a stock you are willing to own at a discount to the current price, on names with healthy implied volatility so the premium is worth the obligation.",
    mainRisks:
      "Obligated to buy the shares at the strike even if the stock has fallen well below it. Effectively long stock with a cushion equal to the premium collected.",
  },
  short_premium: {
    name: "Short Premium",
    tagline: "Sell options to collect premium with defined cash backing.",
    howItWorks:
      "Sells out-of-the-money options (covered calls or cash-secured puts) and collects premium that decays in your favour over time. Risk is defined by cash collateral or share holdings.",
    whenItWorks:
      "Range-bound or mildly directional markets with elevated implied volatility, where time decay works in your favour and large surprise moves are unlikely.",
    mainRisks:
      "A sharp move against the short strike can quickly exceed the premium collected. Earnings or unscheduled catalysts inside the window are the main hazards.",
  },
  complex: {
    name: "Multi-Leg Structure",
    tagline: "Three- or four-leg options structure (iron condor, butterfly, calendar, etc.).",
    howItWorks:
      "Combines multiple options legs to shape a specific payoff — capped on both sides, profitable inside a range, or built around a specific event. Net debit/credit and max risk depend on the chosen legs and widths.",
    whenItWorks:
      "When you have a precise view on direction AND magnitude (or lack of magnitude), and want a payoff that matches that view rather than a simple long or short option.",
    mainRisks:
      "Multiple legs mean multiple bid/ask spreads and assignment risks. Pin risk near short strikes, and a strong trending move can take the structure outside its profitable range fast.",
  },
};

const INSTRUMENT_TYPE_TO_KEY: Record<string, StrategyKey> = {
  stock: "stock_swing",
  long_call: "long_call",
  long_put: "long_put",
  spread: "debit_spread",
  covered_call: "covered_call",
  cash_secured_put: "cash_secured_put",
};

const TRADE_TYPE_TO_KEY: Record<string, StrategyKey> = {
  stock: "stock_swing",
  "long-call": "long_call",
  "long-put": "long_put",
  vertical: "debit_spread",
  "short-premium": "short_premium",
  complex: "complex",
};

// URL-friendly slugs for each canonical strategy key. These are written into
// the `strategy` query param when navigating from a card to the trade detail
// page so the review page can recover the *exact* strategy used (e.g.
// covered-call vs cash-secured-put — both share `type=short-premium`).
export const STRATEGY_KEY_TO_SLUG: Record<StrategyKey, string> = {
  stock_swing: "stock-swing",
  long_call: "long-call",
  long_put: "long-put",
  debit_spread: "debit-spread",
  covered_call: "covered-call",
  cash_secured_put: "cash-secured-put",
  short_premium: "short-premium",
  complex: "complex",
};

const SLUG_TO_STRATEGY_KEY: Record<string, StrategyKey> = Object.fromEntries(
  (Object.entries(STRATEGY_KEY_TO_SLUG) as Array<[StrategyKey, string]>).map(
    ([k, v]) => [v, k],
  ),
);

export function getStrategyKeyByInstrumentType(instrumentType: string): StrategyKey {
  return INSTRUMENT_TYPE_TO_KEY[instrumentType] ?? "stock_swing";
}

export function getStrategyByInstrumentType(instrumentType: string): StrategyInfo {
  return STRATEGY_CATALOG[getStrategyKeyByInstrumentType(instrumentType)];
}

/**
 * Resolve the strategy info to display on the trade-detail page. Prefers the
 * explicit `strategySlug` (forwarded from the originating card) so we do not
 * lose information when multiple instruments share a single TradeType bucket
 * (e.g. covered_call and cash_secured_put both use `type=short-premium`).
 */
export function getStrategyByTradeType(
  tradeType: string,
  strategySlug?: string | null,
): StrategyInfo {
  if (strategySlug) {
    const fromSlug = SLUG_TO_STRATEGY_KEY[strategySlug];
    if (fromSlug) return STRATEGY_CATALOG[fromSlug];
  }
  const key = TRADE_TYPE_TO_KEY[tradeType] ?? "stock_swing";
  return STRATEGY_CATALOG[key];
}
