---
name: Opportunity Engine architecture
description: Why stock opportunities were decoupled from GET /api/dashboard, and how the engine + route are wired.
---

## Rule
Stock opportunities are NOT served by `GET /api/dashboard`. They live at `GET /api/opportunities/latest` (pre-computed background engine). The dashboard response no longer contains a `stockOpportunities` field.

**Why:** The MCP `rank_market_trade_candidates` call can take several seconds. Blocking the dashboard route on it caused the whole page to stall whenever MCP was slow or recovering from a session drop. Decoupling lets the dashboard render instantly while the client fetches opportunities independently.

**How to apply:**
- `server/services/opportunity-engine.ts` — singleton module: `scheduleOpportunityEngine()` (called from `server/index.ts` after `registerRoutes`), `runOpportunityEngine()`, `getLatestSnapshot()`.
- `server/routes/opportunity-latest.ts` — `GET /api/opportunities/latest` (authenticated). Returns `{ snapshot: OpportunitySnapshot | null }`.
- Route registered in `server/routes.ts` via `registerOpportunityLatestRoute`.
- Client: `OpportunityEngineSection` in `dashboard.tsx` uses a separate `useQuery` for `/api/opportunities/latest` (staleTime 5 min, refetchInterval 10 min). When `snapshot === null` it shows "Opportunity Engine has not completed its first scan."
- `OpportunitySnapshot` shape: `generatedAt`, `scannerVersion`, `marketRegime`, `dataSource`, `topGrowth[]`, `topIncome[]`, `topWatchlist[]`, `approachingQualification[]`, `reviewedCount`, `qualifiedCount`, `warnings[]`.
- Growth/income partition: INCOME_RE = `/income|covered|put|call|credit|spread|dividend|yield/i` on `candidate.strategy`. All others → growth. Income is typically empty for stock-only scans.
- Engine skips gracefully when `MCP_ENABLED` is not set (dev environment).
