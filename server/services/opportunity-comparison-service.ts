// Opportunity Comparison Service — Sprint 2.0
//
// Deterministic lifecycle state computation by comparing two consecutive
// Opportunity Engine snapshots. No AI, no subjective logic.
//
// Lifecycle rules (pure, tested independently):
//
//   NEWLY_QUALIFIED   — In latest qualified; absent from ALL previous buckets
//   STILL_QUALIFIED   — In latest qualified AND previous qualified, |rank delta| ≤ 1
//   STRENGTHENING     — In latest qualified AND previous qualified, rank improved ≥ 2
//   WEAKENING         — In latest qualified AND previous qualified, rank worsened ≥ 2
//   APPROACHING       — In latest watch bucket (regardless of previous)
//   TRIGGERED         — In previous qualified; absent from ALL latest buckets
//   DROPPED           — In previous watch (NOT qualified); absent from ALL latest buckets
//   UNAVAILABLE       — Absent from ALL latest buckets AND latest unavailableCount > 0
//
// Score derivation:
//   score = max(0, 100 - (rank - 1) * 5)  for qualified candidates
//   score = 0                               for watch/approaching
//
// Trust rules:
//   - Pure functions: no DB calls, no HTTP, no side effects
//   - Accepts PersistedOpportunitySnapshot | null for previous
//   - Returns honest "no previous scan" when previous is null

import type { PersistedOpportunitySnapshot } from "./opportunity-snapshot-store";
import type { RankedWatchCandidate } from "../routes/ranked-trade-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LifecycleState =
  | "NEWLY_QUALIFIED"
  | "STILL_QUALIFIED"
  | "STRENGTHENING"
  | "WEAKENING"
  | "APPROACHING"
  | "TRIGGERED"
  | "DROPPED"
  | "UNAVAILABLE";

export type QualificationStatus = "QUALIFIED" | "WATCHING" | "ABSENT";

export interface LifecycleItem {
  symbol: string;
  lifecycleState: LifecycleState;
  qualificationStatus: QualificationStatus;
  strategy?: string;
  rankCurrent: number | null;
  rankPrev: number | null;
  scoreCurrent: number;
  scorePrev: number;
  scoreDelta: number;
  firstSeen: string | null; // ISO — populated from history table when available
  lastUpdated: string;      // ISO — completedAt of latest scan
}

export interface ComparisonStatistics {
  avgRankDelta: number;
  topMover: string | null;    // symbol with largest rank improvement
  mostStable: string | null;  // first STILL_QUALIFIED symbol
}

export interface SnapshotComparison {
  hasPreviousScan: boolean;
  summary: {
    newCount: number;
    triggeredCount: number;
    improvingCount: number;
    weakeningCount: number;
    removedCount: number;
    approachingCount: number;
    stillQualifiedCount: number;
    latestScanTime: string | null;
    previousScanTime: string | null;
  };
  newOpportunities: LifecycleItem[];
  triggered: LifecycleItem[];
  improving: LifecycleItem[];
  weakening: LifecycleItem[];
  removed: LifecycleItem[];
  approaching: LifecycleItem[];
  stillQualified: LifecycleItem[];
  all: LifecycleItem[];
  statistics: ComparisonStatistics;
}

// ---------------------------------------------------------------------------
// Score derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 0–100 score from rank position.
 *   Qualified: rank 1 = 100, rank 2 = 95, rank 3 = 90, …, rank 21+ = 0
 *   Watch/approaching: always 0
 */
export function deriveScore(rank: number, isQualified: boolean): number {
  if (!isQualified) return 0;
  return Math.max(0, 100 - (rank - 1) * 5);
}

// ---------------------------------------------------------------------------
// Bucket maps — internal helper
// ---------------------------------------------------------------------------

interface BucketMaps {
  qualifiedBySymbol: Map<string, { rank: number; strategy?: string }>;
  watchBySymbol: Map<string, { strategy?: string }>;
}

function buildBucketMaps(snap: PersistedOpportunitySnapshot | null): BucketMaps {
  const qualifiedBySymbol = new Map<string, { rank: number; strategy?: string }>();
  const watchBySymbol = new Map<string, { strategy?: string }>();

  if (!snap) return { qualifiedBySymbol, watchBySymbol };

  for (const c of [...snap.topGrowth, ...snap.topIncome]) {
    const sym = c.symbol.toUpperCase();
    const existing = qualifiedBySymbol.get(sym);
    // Keep lowest rank when symbol appears in both buckets
    if (!existing || c.rank < existing.rank) {
      qualifiedBySymbol.set(sym, { rank: c.rank, strategy: c.strategy });
    }
  }

  for (const w of [...snap.topWatchlist, ...snap.approachingQualification]) {
    const sym = w.symbol.toUpperCase();
    if (!qualifiedBySymbol.has(sym)) {
      watchBySymbol.set(sym, { strategy: w.strategy });
    }
  }

  return { qualifiedBySymbol, watchBySymbol };
}

// ---------------------------------------------------------------------------
// computeLifecycleState — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Compute the lifecycle state for a single symbol.
 * Pure function — safe for unit testing without DB.
 *
 * @param sym                    Uppercase symbol
 * @param latestMaps             Bucket maps built from latest snapshot
 * @param prevMaps               Bucket maps built from previous snapshot
 * @param latestUnavailableCount snapshot.unavailableCount from latest scan
 */
export function computeLifecycleState(
  sym: string,
  latestMaps: BucketMaps,
  prevMaps: BucketMaps,
  latestUnavailableCount: number,
): LifecycleState {
  const inLatestQualified = latestMaps.qualifiedBySymbol.has(sym);
  const inLatestWatch = latestMaps.watchBySymbol.has(sym);
  const inPrevQualified = prevMaps.qualifiedBySymbol.has(sym);
  const inPrevWatch = prevMaps.watchBySymbol.has(sym);
  const inPrevAny = inPrevQualified || inPrevWatch;
  const inLatestAny = inLatestQualified || inLatestWatch;

  // UNAVAILABLE overrides TRIGGERED/DROPPED when data is missing
  if (!inLatestAny && inPrevAny && latestUnavailableCount > 0) {
    return "UNAVAILABLE";
  }

  if (inLatestQualified) {
    if (!inPrevAny) return "NEWLY_QUALIFIED";

    if (inPrevQualified) {
      const latestRank = latestMaps.qualifiedBySymbol.get(sym)!.rank;
      const prevRank = prevMaps.qualifiedBySymbol.get(sym)!.rank;
      const delta = latestRank - prevRank; // negative = improved (lower rank = better)
      if (delta <= -2) return "STRENGTHENING";
      if (delta >= 2)  return "WEAKENING";
      return "STILL_QUALIFIED";
    }

    // Was in watch before, now in qualified → NEWLY_QUALIFIED
    return "NEWLY_QUALIFIED";
  }

  if (inLatestWatch) {
    return "APPROACHING";
  }

  // Symbol is absent from latest
  if (inPrevQualified) return "TRIGGERED";
  if (inPrevWatch)     return "DROPPED";

  // Shouldn't reach here in normal usage
  return "UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// compareSnapshots — main exported function
// ---------------------------------------------------------------------------

/**
 * Compare the latest snapshot against the previous one.
 * Returns a full structured comparison.
 * When previous is null, all current symbols are treated as NEWLY_QUALIFIED.
 *
 * @param firstSeenMap  Optional map from uppercase symbol → ISO string (first seen date)
 */
export function compareSnapshots(
  latest: PersistedOpportunitySnapshot,
  previous: PersistedOpportunitySnapshot | null,
  firstSeenMap: Map<string, string> = new Map(),
): SnapshotComparison {
  const latestMaps = buildBucketMaps(latest);
  const prevMaps   = buildBucketMaps(previous);
  const lastUpdated = latest.completedAt;

  const allItems: LifecycleItem[] = [];
  const processedSyms = new Set<string>();

  // ── Process symbols present in the latest snapshot ─────────────────────

  const processQualified = (c: { symbol: string; rank: number; strategy?: string }) => {
    const sym = c.symbol.toUpperCase();
    if (processedSyms.has(sym)) return;
    processedSyms.add(sym);

    const state        = computeLifecycleState(sym, latestMaps, prevMaps, latest.unavailableCount);
    const scoreCurrent = deriveScore(c.rank, true);
    const prevEntry    = prevMaps.qualifiedBySymbol.get(sym);
    const scorePrev    = prevEntry ? deriveScore(prevEntry.rank, true) : 0;

    allItems.push({
      symbol: c.symbol,
      lifecycleState: state,
      qualificationStatus: "QUALIFIED",
      strategy: c.strategy,
      rankCurrent: c.rank,
      rankPrev: prevEntry?.rank ?? null,
      scoreCurrent,
      scorePrev,
      scoreDelta: scoreCurrent - scorePrev,
      firstSeen: firstSeenMap.get(sym) ?? null,
      lastUpdated,
    });
  };

  const processWatch = (w: RankedWatchCandidate) => {
    const sym = w.symbol.toUpperCase();
    if (processedSyms.has(sym)) return;
    processedSyms.add(sym);

    const state = computeLifecycleState(sym, latestMaps, prevMaps, latest.unavailableCount);
    allItems.push({
      symbol: w.symbol,
      lifecycleState: state,
      qualificationStatus: "WATCHING",
      strategy: w.strategy,
      rankCurrent: null,
      rankPrev: null,
      scoreCurrent: 0,
      scorePrev: 0,
      scoreDelta: 0,
      firstSeen: firstSeenMap.get(sym) ?? null,
      lastUpdated,
    });
  };

  for (const c of latest.topGrowth)             processQualified(c);
  for (const c of latest.topIncome)             processQualified(c);
  for (const w of latest.topWatchlist)          processWatch(w);
  for (const w of latest.approachingQualification) processWatch(w);

  // ── Process symbols that were in previous but absent from latest ────────
  if (previous) {
    const allPrevSymbols = new Set([
      ...Array.from(prevMaps.qualifiedBySymbol.keys()),
      ...Array.from(prevMaps.watchBySymbol.keys()),
    ]);

    for (const sym of Array.from(allPrevSymbols)) {
      if (processedSyms.has(sym)) continue;
      processedSyms.add(sym);

      const state      = computeLifecycleState(sym, latestMaps, prevMaps, latest.unavailableCount);
      const prevEntry  = prevMaps.qualifiedBySymbol.get(sym);
      const prevWatch  = prevMaps.watchBySymbol.get(sym);
      const scorePrev  = prevEntry ? deriveScore(prevEntry.rank, true) : 0;

      // Recover display symbol + strategy from previous snapshot
      const displaySym =
        prevEntry
          ? (previous.topGrowth.find(c => c.symbol.toUpperCase() === sym)?.symbol
            ?? previous.topIncome.find(c => c.symbol.toUpperCase() === sym)?.symbol
            ?? sym)
          : (previous.topWatchlist.find(w => w.symbol.toUpperCase() === sym)?.symbol
            ?? previous.approachingQualification.find(w => w.symbol.toUpperCase() === sym)?.symbol
            ?? sym);

      const displayStrategy = prevEntry
        ? (previous.topGrowth.find(c => c.symbol.toUpperCase() === sym)?.strategy
          ?? previous.topIncome.find(c => c.symbol.toUpperCase() === sym)?.strategy)
        : prevWatch?.strategy;

      allItems.push({
        symbol: displaySym,
        lifecycleState: state,
        qualificationStatus: "ABSENT",
        strategy: displayStrategy,
        rankCurrent: null,
        rankPrev: prevEntry?.rank ?? null,
        scoreCurrent: 0,
        scorePrev,
        scoreDelta: -scorePrev,
        firstSeen: firstSeenMap.get(sym) ?? null,
        lastUpdated,
      });
    }
  }

  // ── Bucket into lifecycle sections ──────────────────────────────────────
  const newOpportunities = allItems.filter(i => i.lifecycleState === "NEWLY_QUALIFIED");
  const triggered        = allItems.filter(i => i.lifecycleState === "TRIGGERED");
  const improving        = allItems.filter(i => i.lifecycleState === "STRENGTHENING");
  const weakening        = allItems.filter(i => i.lifecycleState === "WEAKENING");
  const removed          = allItems.filter(i => i.lifecycleState === "DROPPED" || i.lifecycleState === "UNAVAILABLE");
  const approaching      = allItems.filter(i => i.lifecycleState === "APPROACHING");
  const stillQualified   = allItems.filter(i => i.lifecycleState === "STILL_QUALIFIED");

  // ── Statistics ──────────────────────────────────────────────────────────
  const withRankDelta  = allItems.filter(i => i.rankCurrent !== null && i.rankPrev !== null);
  const rankDeltas     = withRankDelta.map(i => i.rankPrev! - i.rankCurrent!); // positive = improved
  const avgRankDelta   = rankDeltas.length > 0
    ? Math.round((rankDeltas.reduce((a, b) => a + b, 0) / rankDeltas.length) * 10) / 10
    : 0;

  // Top mover = largest rank improvement
  const topMover = improving.length > 0
    ? improving.reduce((best, cur) =>
        (cur.rankPrev! - cur.rankCurrent!) > (best.rankPrev! - best.rankCurrent!) ? cur : best,
      improving[0]).symbol
    : null;

  const mostStable = stillQualified[0]?.symbol ?? null;

  return {
    hasPreviousScan: previous !== null,
    summary: {
      newCount: newOpportunities.length,
      triggeredCount: triggered.length,
      improvingCount: improving.length,
      weakeningCount: weakening.length,
      removedCount: removed.length,
      approachingCount: approaching.length,
      stillQualifiedCount: stillQualified.length,
      latestScanTime: latest.completedAt,
      previousScanTime: previous?.completedAt ?? null,
    },
    newOpportunities,
    triggered,
    improving,
    weakening,
    removed,
    approaching,
    stillQualified,
    all: allItems,
    statistics: { avgRankDelta, topMover, mostStable },
  };
}

// ---------------------------------------------------------------------------
// Re-export BucketMaps for use by history writer
// ---------------------------------------------------------------------------
export type { BucketMaps };
export { buildBucketMaps };
