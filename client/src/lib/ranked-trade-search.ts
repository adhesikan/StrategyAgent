// Types + pure presentation helpers for the deterministic ranked market
// trade search (MCP rank_market_trade_candidates). Presentation and
// navigation only — the frontend never generates, reorders, or promotes
// candidates, and never opens the Trade Builder automatically.

import { askRoute } from "@/lib/command-center";

export interface RankedTradeCandidate {
  rank: number;
  symbol: string;
  strategy?: string;
  setupStatus?: string;
  instrument?: string;
  structure?: string;
  trigger?: string;
  invalidation?: string;
  objective?: string;
  rewardRisk?: number;
  maxRisk?: number;
  /** true only when maxRisk derives from live, real contract/stop data. */
  maxRiskIsExact?: boolean;
  quantity?: number;
  confidence?: string;
  dataQuality?: string;
  fitsRiskBudget?: boolean;
  whySelected: string[];
  warnings: string[];
}

export interface RankedWatchCandidate {
  symbol: string;
  strategy?: string;
  currentStage?: string;
  missingConfirmation?: string;
  watchConditions: string[];
}

export interface RankedRejectionGroup {
  reason: string;
  count: number;
  symbols: string[];
}

export interface RankedTradeSearch {
  request: Record<string, unknown>;
  /** RAW stored opportunities reviewed — NOT the post-confluence population. */
  reviewedCount: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  unavailableCount: number;
  candidates: RankedTradeCandidate[];
  watchCandidates: RankedWatchCandidate[];
  rejectionSummary: RankedRejectionGroup[];
  generatedAt: string;
  warnings: string[];
  maxRiskDollars?: number;
}

export interface RankedCta {
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * Trade Builder is offered ONLY for a qualified candidate that is
 * actionable, fresh, real-data, and complete (spec §9). Missing or unknown
 * information disables it — never the other way around.
 */
export function tradeBuilderEligible(c: RankedTradeCandidate): boolean {
  if (!c.symbol) return false;
  // Complete: entry/exit framing plus sizing must all be present.
  if (!c.trigger || !c.invalidation || c.maxRisk == null || c.quantity == null) return false;
  // Real data: an explicit dataQuality that is estimated/partial/stale/mock
  // disqualifies; absent dataQuality is UNKNOWN → not eligible.
  if (!c.dataQuality || /estimat|partial|mock|stale|unavailable/i.test(c.dataQuality)) return false;
  // Fresh/actionable: an explicit stale or non-actionable status disqualifies.
  if (c.setupStatus && /stale|expired|invalid|rejected|watch/i.test(c.setupStatus)) return false;
  // A stated risk-budget miss disqualifies.
  if (c.fitsRiskBudget === false) return false;
  return true;
}

/** CTAs for a qualified candidate. Never auto-navigates anywhere. */
export function qualifiedCtas(c: RankedTradeCandidate): RankedCta[] {
  const sym = c.symbol.toUpperCase();
  const out: RankedCta[] = [
    { label: "Analyze", href: askRoute(`Analyze ${sym}`), primary: true },
    { label: "Review Trade", href: `/market-intel?symbol=${sym}` },
    { label: "Risk Details", href: askRoute(`What is the risk on the ${sym} setup?`) },
  ];
  if (tradeBuilderEligible(c)) out.push({ label: "Open Trade Builder", href: `/trade/${sym}` });
  return out;
}

/** CTAs for a watch candidate — never the Trade Builder. */
export function watchCtas(w: RankedWatchCandidate): RankedCta[] {
  const sym = w.symbol.toUpperCase();
  return [
    { label: "Analyze", href: askRoute(`Analyze ${sym}`), primary: true },
    { label: "Add to Watchlist", href: `/watchlist?add=${sym}` },
    { label: "View Setup", href: `/market-intel?symbol=${sym}` },
    { label: "Open Scanner", href: "/scanner" },
  ];
}

/** CTAs when ranking is limited by unavailable data. */
export function unavailableCtas(question: string): RankedCta[] {
  return [
    { label: "Retry", href: askRoute(question), primary: true },
    { label: "Open Scanner", href: "/scanner" },
  ];
}

/** Honest counts line. reviewedCount is labeled as raw stored opportunities
 *  reviewed and is never implied to equal the bucket population. */
export function rankedCountsLine(s: RankedTradeSearch): string {
  const parts = [
    `${s.reviewedCount} stored ${s.reviewedCount === 1 ? "opportunity" : "opportunities"} reviewed`,
    `${s.qualifiedCount} qualified`,
    ...(s.watchCount > 0 ? [`${s.watchCount} worth watching`] : []),
    ...(s.rejectedCount > 0 ? [`${s.rejectedCount} rejected`] : []),
    ...(s.unavailableCount > 0 ? [`${s.unavailableCount} unavailable`] : []),
  ];
  return parts.join(" · ");
}

/** Risk-fit line for a candidate under a requested budget (spec §8).
 *  Options candidates without exact (live) risk never claim an exact max
 *  loss — returns an "estimated" phrasing instead. */
export function riskFitLine(c: RankedTradeCandidate, requestedMax?: number): string | null {
  if (c.maxRisk == null) return null;
  const amount = `$${c.maxRisk.toLocaleString("en-US")}`;
  const label = c.maxRiskIsExact ? `Max risk ${amount}` : `Estimated max risk ${amount} (not an exact figure)`;
  if (requestedMax == null) return label;
  const fits = c.fitsRiskBudget ?? (c.maxRiskIsExact ? c.maxRisk <= requestedMax : undefined);
  const fitText = fits === true ? "fits" : fits === false ? "exceeds" : "compare against";
  return `${label} — ${fitText} the requested $${requestedMax.toLocaleString("en-US")} limit${c.quantity != null ? ` at ${c.quantity} ${c.quantity === 1 ? "unit" : "units"}` : ""}`;
}
