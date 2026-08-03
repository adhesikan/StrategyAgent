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
  /** analytics event name (existing track() helper) */
  event: string;
  /** navigation target; intents route into Ask AI, Scan goes straight to Scanner */
  href: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "analyze", label: "Analyze a Stock", event: "home_analyze_stock", href: "" }, // prefills the command bar with "Analyze " — user supplies the ticker (no hardcoded tickers)
  { id: "find-trades", label: "Find Trades", event: "home_find_trades", href: askRoute("Find high-quality trade opportunities") },
  { id: "income", label: "Generate Income", event: "home_generate_income", href: askRoute("Find income opportunities") },
  { id: "scan", label: "Scan the Market", event: "home_scan_market", href: "/scanner" },
];

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
