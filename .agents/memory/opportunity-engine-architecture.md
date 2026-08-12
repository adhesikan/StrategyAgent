---
name: Opportunity Engine architecture
description: Why stock opportunities were decoupled from GET /api/dashboard, and how the engine + route are wired.
---

## Rule
Stock opportunities are NOT served by `GET /api/dashboard`. They live at `GET /api/opportunities/latest` (pre-computed background engine). The dashboard response no longer contains a `stockOpportunities` field.

**Why:** The MCP `rank_market_trade_candidates` call can take several seconds. Blocking the dashboard route on it caused the whole page to stall whenever MCP was slow or recovering from a session drop. Decoupling lets the dashboard render instantly while the client fetches opportunities independently.

## Multi-Instance Ranking Consistency — Self-Healing Lazy Hydration (critical)

**The canonical rule:** `getLatestRanking()` is pure in-memory. `getOpportunityIntelligence()` now calls `ensureRankingHydrated()` before reading it — if the ranking is null, it loads the latest persisted DB snapshot, computes the ranking, and calls `setLatestRanking()`. Stampede protection via a shared `rankingHydrationPromise`.

**Why:** `scheduleOpportunityEngine()` is fire-and-forget (returns void immediately). The HTTP server accepts requests BEFORE async `initOpportunityEngine()` (and its `computeRankingForSnapshot`) completes. Defect-2 tried to fix this at startup but the window still existed. Defect-3 fix: make the read-path self-healing so every instance can recover regardless of startup timing or lock ownership.

**Error codes:** `OPPORTUNITY_DATA_UNAVAILABLE` (503) = ranking could not be hydrated (infra issue, retriable). `NOT_IN_CURRENT_SNAPSHOT` (404) = ranking hydrated, symbol genuinely absent (not retriable). Never conflate these two conditions.

**How to apply:** 
- Never add logic to `getOpportunityIntelligence()` that returns null before calling `ensureRankingHydrated()`.
- Advisory lock controls the expensive scan only — never gate read eligibility on lock ownership.
- Both `initOpportunityEngine()` (startup hydration) AND `ensureRankingHydrated()` (lazy hydration) must remain present. They are complementary — startup minimizes the window, lazy hydration eliminates it.
- `candidate-consistency.test.ts` and `candidate-consistency-v2.test.ts` contain structural source audits that will fail if the hydration wiring is removed.

**How to apply:**
- `server/services/opportunity-engine.ts` — singleton module: `scheduleOpportunityEngine()` (called from `server/index.ts` after `registerRoutes`), `runOpportunityEngine()`, `getLatestSnapshot()`.
- `server/routes/opportunity-latest.ts` — `GET /api/opportunities/latest` (authenticated). Returns `{ snapshot: OpportunitySnapshot | null }`.
- Route registered in `server/routes.ts` via `registerOpportunityLatestRoute`.
- Client: `OpportunityEngineSection` in `dashboard.tsx` uses a separate `useQuery` for `/api/opportunities/latest` (staleTime 5 min, refetchInterval 10 min). When `snapshot === null` it shows "Opportunity Engine has not completed its first scan."
- `OpportunitySnapshot` shape: `generatedAt`, `scannerVersion`, `marketRegime`, `dataSource`, `topGrowth[]`, `topIncome[]`, `topWatchlist[]`, `approachingQualification[]`, `reviewedCount`, `qualifiedCount`, `warnings[]`.
- Growth/income partition: INCOME_RE = `/income|covered|put|call|credit|spread|dividend|yield/i` on `candidate.strategy`. All others → growth. Income is typically empty for stock-only scans.
- Engine skips gracefully when `MCP_ENABLED` is not set (dev environment).
