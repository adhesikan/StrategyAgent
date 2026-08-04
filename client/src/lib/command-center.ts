// Pure helpers for the /home AI Command Center. Presentation and navigation
// only — no trading logic, no fabricated data. Kept DOM-free so the behavior
// (quick-action intents, stage-aware CTAs, portfolio math) is unit-testable.

import { stageLabel, stageTone, type VcpStage } from "@/lib/vcp-analysis";

export { stageLabel, stageTone };

/** Route into the existing Ask AI page carrying the query (auto-executes there). */
export function askRoute(q: string): string {
  const trimmed = q.trim();
  return trimmed ? `/ask?q=${encodeURIComponent(trimmed)}` : "/ask";
}

export interface QuickAction {
  id: string;
  label: string;
  /** one-line research-oriented description shown under the title */
  description: string;
  /** analytics event name (existing track() helper) */
  event: string;
  /** navigation target; intents route into Ask AI, Scan goes straight to Scanner */
  href: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "analyze", label: "Analyze a Stock", description: "Review technicals, fundamentals, news, and market context.", event: "home_analyze_stock", href: "" }, // prefills the command bar with "Analyze " — user supplies the ticker (no hardcoded tickers)
  { id: "find-trades", label: "Find Trades", description: "Explore trade candidates matching selected criteria.", event: "home_find_trades", href: askRoute("Find high-quality trade opportunities") },
  { id: "income", label: "Generate Income", description: "Research covered calls, cash-secured puts, and income strategies.", event: "home_generate_income", href: askRoute("Find income opportunities") },
  // Recommendation-engine intents — each routes into Ask AI where the
  // deterministic recommend_trade_strategy flow answers. No hardcoded tickers.
  { id: "find-trade", label: "Find a Trade", description: "Research the single strongest setup available right now.", event: "home_find_trade", href: askRoute("Find a trade") },
  { id: "find-bullish", label: "Find a Bullish Trade", description: "Research the strongest bullish setup available today.", event: "home_find_bullish_trade", href: askRoute("Find a bullish trade") },
  { id: "find-options", label: "Find an Options Trade", description: "Research an options structure matched to current setups.", event: "home_find_options_trade", href: askRoute("Find an options trade") },
  { id: "find-credit-spread", label: "Find a Credit Spread", description: "Evaluate defined-risk credit-spread candidates.", event: "home_find_credit_spread", href: askRoute("Find a credit spread") },
  { id: "find-small-risk", label: "Trade Under $500 Risk", description: "Research a defined-risk idea capped at $500 of risk.", event: "home_find_small_risk_trade", href: askRoute("Find a trade under $500 max loss") },
  { id: "scan", label: "Scan the Market", description: "Search for emerging technical and options setups.", event: "home_scan_market", href: "/scanner" },
];

/** Time-of-day greeting for the hero ("Good morning" / "afternoon" / "evening").
 *  Uses the user's local hour (0–23). */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Normalize a stored opportunity stage to the standard VCP stages (or null). */
export function normalizeOppStage(raw: string | null | undefined): VcpStage | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
  if (s === "base-building") return "developing";
  const known: VcpStage[] = ["no-setup", "early", "developing", "contraction", "pivot-ready"];
  return known.includes(s as VcpStage) ? (s as VcpStage) : null;
}

export interface StageCta {
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * Setup-aware opportunity CTAs (spec: navigation/presentation only).
 * - no-setup / early / unknown: Analyze, Watch, Open Scanner — never Trade Builder
 * - developing: Analyze, View Chart, Open Scanner
 * - contraction: Analyze, View Setup, View Chart
 * - pivot-ready: Analyze, View Setup, Open Trade Builder
 */
export function stageCtas(stage: VcpStage | null, symbol: string): StageCta[] {
  const sym = symbol.toUpperCase();
  const analyze: StageCta = { label: "Analyze", href: askRoute(`Analyze ${sym}`), primary: true };
  switch (stage) {
    case "pivot-ready":
      return [analyze, { label: "View Setup", href: `/market-intel?symbol=${sym}` }, { label: "Open Trade Builder", href: `/trade/${sym}` }];
    case "contraction":
      return [analyze, { label: "View Setup", href: `/market-intel?symbol=${sym}` }, { label: "View Chart", href: `/market-intel?symbol=${sym}` }];
    case "developing":
      return [analyze, { label: "View Chart", href: `/market-intel?symbol=${sym}` }, { label: "Open Scanner", href: "/scanner" }];
    default:
      // no-setup / early / unknown — watch & scan, no Trade Builder emphasis
      return [analyze, { label: "Watch", href: `/market-intel?symbol=${sym}` }, { label: "Open Scanner", href: "/scanner" }];
  }
}

export interface BrokerPositionLike {
  symbol?: string;
  quantity?: number | null;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
}

export interface PortfolioSummary {
  positionCount: number;
  /** null when the broker payload doesn't expose market values (never fabricated) */
  totalMarketValue: number | null;
  totalUnrealizedPnl: number | null;
}

/** Defensive rollup of existing broker positions — only sums fields actually present. */
export function summarizePositions(positions: BrokerPositionLike[] | undefined | null): PortfolioSummary {
  const list = Array.isArray(positions) ? positions : [];
  let mv = 0;
  let mvCount = 0;
  let pnl = 0;
  let pnlCount = 0;
  for (const p of list) {
    if (typeof p.marketValue === "number" && Number.isFinite(p.marketValue)) {
      mv += p.marketValue;
      mvCount++;
    }
    if (typeof p.unrealizedPnl === "number" && Number.isFinite(p.unrealizedPnl)) {
      pnl += p.unrealizedPnl;
      pnlCount++;
    }
  }
  return {
    positionCount: list.length,
    totalMarketValue: mvCount === list.length && list.length > 0 ? mv : null,
    totalUnrealizedPnl: pnlCount === list.length && list.length > 0 ? pnl : null,
  };
}

// ---------------------------------------------------------------------------
// Future trade-candidate readiness (spec §7): the opportunity card model below
// accepts an optional candidateState so a future Trade Candidate Engine API
// can light up "Stock Candidate" / "Options Candidate" / "No Trade" states
// without a UI rework. Current data never sets it — the frontend must not
// generate trade candidates.
// ---------------------------------------------------------------------------
export type CandidateState = "stockCandidate" | "optionsCandidate" | "noTrade";

export const CANDIDATE_LABELS: Record<CandidateState, string> = {
  stockCandidate: "Stock Candidate",
  optionsCandidate: "Options Candidate",
  noTrade: "No Trade",
};

export interface HomeOpportunity {
  symbol: string;
  stage: VcpStage | null;
  price: number | null;
  /** true when `price` is a live/current quote; false when it is the
   *  detection-time price (stale — label accordingly). */
  priceIsCurrent: boolean;
  note: string | null;
  detectedAt: string | null;
  candidateState?: CandidateState; // reserved for the future engine — never set client-side
}

/** Map raw /api/opportunities rows (active scanner detections) to home cards.
 *  Prefers the server-enriched `currentPrice` (broker or Twelve Data
 *  real-time) over the stale detection-time price. */
export function toHomeOpportunities(rows: any[] | undefined | null, max = 5): HomeOpportunity[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.symbol === "string")
    .slice(0, max)
    .map((r) => {
      const current = typeof r.currentPrice === "number" && Number.isFinite(r.currentPrice) && r.currentPrice > 0 ? r.currentPrice : null;
      const detected = typeof r.detectedPrice === "number" && Number.isFinite(r.detectedPrice) ? r.detectedPrice : null;
      return {
        symbol: String(r.symbol).toUpperCase(),
        stage: normalizeOppStage(r.stageAtDetection),
        price: current ?? detected,
        priceIsCurrent: current !== null,
        note: typeof r.strategyName === "string" && r.strategyName ? r.strategyName : null,
        detectedAt: typeof r.detectedAt === "string" ? r.detectedAt : null,
      };
    });
}

// -- Home Opportunity Radar controls -----------------------------------------
// The home radar section reuses the Radar page's scan (shared cache key) but
// lets the user change the symbol source and filter/sort the ranked results
// without leaving the home page.

/** Symbol sources the backend radar scan accepts (subset shown on home —
 *  "custom" needs a symbol input and stays on the full Radar page). */
export type RadarUniverse = "watchlist" | "large_cap" | "high_volume" | "options_liquid";

export const RADAR_UNIVERSE_OPTIONS: Array<{ value: RadarUniverse; label: string }> = [
  { value: "watchlist", label: "My Watchlist" },
  { value: "large_cap", label: "Large Cap" },
  { value: "high_volume", label: "High Volume" },
  { value: "options_liquid", label: "Options Liquid" },
];

export type RadarTypeFilter = "all" | "stock" | "options" | "spreads";

export const RADAR_TYPE_OPTIONS: Array<{ value: RadarTypeFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "stock", label: "Stocks" },
  { value: "options", label: "Options" },
  { value: "spreads", label: "Spreads" },
];

export type RadarSort = "rank" | "price_asc" | "price_desc" | "name";

export const RADAR_SORT_OPTIONS: Array<{ value: RadarSort; label: string }> = [
  { value: "rank", label: "Top ranked" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name", label: "Name (A–Z)" },
];

/** Minimal candidate shape the filter/sort helpers rely on. */
export interface RadarFilterableCandidate {
  symbol: string;
  companyName?: string;
  strategyType: string;
  rank: number;
  entry: number;
}

/** Instrument bucket from the scan's strategyType. Spreads are their own
 *  bucket (multi-leg); "options" covers all remaining option strategies. */
export function radarInstrumentType(strategyType: unknown): "stock" | "options" | "spreads" {
  const s = typeof strategyType === "string" ? strategyType : "";
  if (s === "stock_swing" || s === "") return "stock"; // unknown/missing → safest bucket
  if (s.includes("spread")) return "spreads";
  return "options";
}

export function filterRadarCandidates<T extends RadarFilterableCandidate>(
  candidates: T[],
  type: RadarTypeFilter,
): T[] {
  if (type === "all") return candidates;
  return candidates.filter((c) => radarInstrumentType(c.strategyType) === type);
}

/** Stable sort; "rank" preserves the server's ranking order. Price sorts use
 *  the entry price; candidates without a finite entry sink to the end. */
export function sortRadarCandidates<T extends RadarFilterableCandidate>(
  candidates: T[],
  sort: RadarSort,
): T[] {
  const list = [...candidates];
  const price = (c: T) => (Number.isFinite(c.entry) ? c.entry : null);
  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity) || a.rank - b.rank);
    case "price_desc":
      return list.sort((a, b) => (price(b) ?? -Infinity) - (price(a) ?? -Infinity) || a.rank - b.rank);
    case "name":
      return list.sort(
        (a, b) =>
          (a.companyName ?? a.symbol).localeCompare(b.companyName ?? b.symbol) ||
          a.symbol.localeCompare(b.symbol),
      );
    default:
      return list.sort((a, b) => a.rank - b.rank);
  }
}
