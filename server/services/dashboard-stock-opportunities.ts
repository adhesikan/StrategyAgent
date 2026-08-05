// Dashboard Stock Opportunities Service — Sprint 5.5 / Step 1 (Real Pipeline)
//
// Provides real Twelve Data-backed stock opportunities to the dashboard by
// calling rank_market_trade_candidates through the existing validated MCP
// abstraction (ranked-trade-search.ts).
//
// Design constraints (from spec):
//   - NEVER calls OpenAI — deterministic pipeline only.
//   - NEVER uses generateCandidateScenarios (radar-service) — that produces
//     simulated/mock data when no broker is connected.
//   - A disconnected broker must NOT prevent real stock opportunities.
//   - MCP failure → status "unavailable"; no fabricated candidates.
//   - Options data boundary: no live chain without a supported broker, ever.

import { isMcpEnabled } from "../mcp/config";
import {
  runRankedTradeSearch,
  type RankedTradeSearch,
  type RankedTradeCandidate,
  type RankedWatchCandidate,
  type RankedExclusionGroup,
} from "../routes/ranked-trade-search";
import type { RankMarketTradeCandidatesArgs } from "../mcp/tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockOpportunitiesOk {
  status: "ok";
  /** Always "mcp" — MCP rank_market_trade_candidates is the sole source. */
  dataSource: "mcp";
  /** Human-readable freshness label for the badge. */
  dataQuality: "Latest daily market data";
  generatedAt: string;
  sourceTimestamp: string;
  /** RAW stored opportunities reviewed — not post-confluence population. */
  reviewedCount: number;
  qualifiedCount: number;
  watchCount: number;
  excludedCount?: number;
  unavailableCount: number;
  /** Up to 5 qualified stock candidates in backend ranking order. No reordering. */
  candidates: RankedTradeCandidate[];
  /** Approaching-qualification watch candidates. */
  watchCandidates: RankedWatchCandidate[];
  /** Why opportunities were excluded BEFORE qualification (distinct from rejection). */
  exclusionSummary?: RankedExclusionGroup[];
  warnings: string[];
}

export interface StockOpportunitiesUnavailable {
  status: "unavailable";
  /** Internal machine-readable reason (not user-facing). */
  reason: "mcp_disabled" | "mcp_unavailable" | "mcp_invalid_response";
}

export type StockOpportunitiesResult = StockOpportunitiesOk | StockOpportunitiesUnavailable;

export interface OptionsAvailability {
  /** True ONLY when a live options chain has been confirmed from a real broker. */
  liveChainAvailable: false;
  /** "broker" when connected, null otherwise. */
  source: "broker" | null;
  brokerRequired: true;
  /** True when broad estimated strategy concepts may be shown in an "estimated" section. */
  estimatedStructuresAvailable: boolean;
  /** User-facing boundary explanation. */
  message: string;
}

// ---------------------------------------------------------------------------
// Fixed dashboard request (no user-chosen filters; MCP chooses the universe)
// ---------------------------------------------------------------------------

const DASHBOARD_RANK_ARGS: RankMarketTradeCandidatesArgs = {
  direction: "either",
  instrumentPreference: "stock",
  numberOfIdeas: 5,
};

// ---------------------------------------------------------------------------
// buildDashboardStockOpportunities
// ---------------------------------------------------------------------------

/**
 * Fetches real stock opportunities for the dashboard using the MCP
 * rank_market_trade_candidates tool.
 *
 * Called from the dashboard orchestration route. Never uses OpenAI.
 * On any MCP failure, returns {status:"unavailable"} — never fabricated data.
 */
export async function buildDashboardStockOpportunities(): Promise<StockOpportunitiesResult> {
  if (!isMcpEnabled()) {
    return { status: "unavailable", reason: "mcp_disabled" };
  }

  try {
    const { rankMarketTradeCandidates } = await import("../mcp/tools");

    const search: RankedTradeSearch = await runRankedTradeSearch(
      // Minimal goal object — no symbol, stock-only, no risk budget filter,
      // let MCP choose the full ranked universe.
      { numberOfIdeas: 5, instrumentPreference: "stock", direction: "either" },
      {
        rank: (args: RankMarketTradeCandidatesArgs) =>
          rankMarketTradeCandidates({ ...DASHBOARD_RANK_ARGS, ...args }),
      },
    );

    return {
      status: "ok",
      dataSource: "mcp",
      dataQuality: "Latest daily market data",
      generatedAt: search.generatedAt,
      sourceTimestamp: search.generatedAt,
      reviewedCount: search.reviewedCount,
      qualifiedCount: search.qualifiedCount,
      watchCount: search.watchCount,
      ...(search.excludedCount != null ? { excludedCount: search.excludedCount } : {}),
      unavailableCount: search.unavailableCount,
      candidates: search.candidates.slice(0, 5),
      watchCandidates: search.watchCandidates.slice(0, 5),
      ...(search.exclusionSummary ? { exclusionSummary: search.exclusionSummary } : {}),
      warnings: search.warnings,
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? "");
    const reason: StockOpportunitiesUnavailable["reason"] =
      msg.includes("invalid") || msg.includes("missing required")
        ? "mcp_invalid_response"
        : "mcp_unavailable";
    console.warn(`[dashboard-stock-opportunities] MCP ranking failed (${reason}):`, msg);
    return { status: "unavailable", reason };
  }
}

// ---------------------------------------------------------------------------
// buildOptionsAvailability
// ---------------------------------------------------------------------------

/**
 * Returns the options-data boundary descriptor for the dashboard.
 *
 * Without a supported live options chain provider:
 *   - liveChainAvailable: false (always)
 *   - brokerRequired: true
 *   - estimated structures may be shown in a clearly labeled section
 *
 * The dashboard must NEVER show invented contract details.
 * Estimated options sections must be labeled "Estimated structure — no live options chain used".
 */
export function buildOptionsAvailability(hasBroker: boolean): OptionsAvailability {
  if (hasBroker) {
    return {
      liveChainAvailable: false,
      source: "broker",
      brokerRequired: true,
      estimatedStructuresAvailable: true,
      message:
        "Broker connected. For live options contracts with real premiums, Greeks and fills, your broker must support a full options chain feed. Estimated strategy concepts are based on setup analysis only — no live contract data.",
    };
  }
  return {
    liveChainAvailable: false,
    source: null,
    brokerRequired: true,
    estimatedStructuresAvailable: true,
    message:
      "Live options chain unavailable. Connect a supported broker for current contracts, premiums, Greeks, liquidity and broker-ready order review.",
  };
}
