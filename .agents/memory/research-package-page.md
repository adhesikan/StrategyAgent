---
name: Research Package page
description: Sprint 2.1 — /opportunity/:symbol page architecture, data contract, and compliance constraints.
---

## Route
- Client: `/opportunity/:symbol` (wouter) — avoids collision with existing `/research/:id` saved-research detail page
- Server: `GET /api/opportunities/research/:symbol` (authenticated)

## Server assembly
- One endpoint fans out: `getLatestValidSnapshot`, `getPreviousValidSnapshot`, `storage.getBrokerConnection(userId)`, `getSymbolHistory(sym, 10)` all in parallel via `Promise.all`
- `findCandidateInSnapshot` checks `topGrowth` + `topIncome`; prefers lowest rank when symbol appears in both
- Lifecycle diff uses the same `compareSnapshots` path as `/api/opportunities/changes`; `lifecycleItem` is null when no previous scan
- Freshness uses same 1.5× threshold as `opportunity-latest` route; imports `getIntervalMs` from `opportunity-engine`
- Returns 404 with `code: "NO_SNAPSHOT"` or `code: "SYMBOL_NOT_FOUND"` for graceful client handling

## Client data flow
- Two `useQuery` calls: `/api/opportunities/research/:symbol` + `/api/dashboard` (market context reuse)
- `retry` callback skips retries on 404 (symbol genuinely absent from scan)
- 404 renders `SymbolNotFound` component, not an error state

## Compliance invariants
- No "buy", "sell", "recommendation", "expected profit", "target return" anywhere in the file
- Price/level fields are labeled "educational planning" or "not a trade recommendation"
- InstaTrade™ section is read-only planning display; `brokerConnected === false` → shows "Connect Brokerage" prompt
- `InstaTradePanel` navigates to `/instatrade` — never submits an order

## Entry points
- `StockOpportunityCard` in dashboard.tsx: "Research" button → `/opportunity/:symbol`
- data-testid: `btn-research-{symbol}`

## Trade Structure Engine (Sprint 2.2)
- 7 components in `client/src/components/research/structure/`: StockStructureCard, OptionsStructureCard, TradeComparisonCard, TradeStructureReasonCard, TradeStructureRiskCard, TradeStructureCard (orchestrator), TradeStructureEngine (tab)
- New "Trade Planning" tab added (3rd tab, after Decision)
- deriveStockStructure() → 5 types: breakout-entry, pullback-entry, swing-position, position-trade, long-stock; prioritizes VCP+HIGH=breakout, VCP+MEDIUM=pullback, PULLBACK, SWING, GAP/ORB=long-stock, TRENDING+HIGH+trend-text=position-trade
- deriveOptionsStructures(pkg, thesis) → thesis=bearish | regime=RISK_OFF | intraday strategy → empty array; bullish+TRENDING+HIGH → [bull-call-spread(best-overall), long-call, cash-secured-put(income), bull-put-spread(income+conservative)]; neutral → [iron-condor, covered-call]
- deriveDTE() → 30 DTE for ORB/GAP, 60-90 DTE for month/position/trend, 45-60 DTE for VCP/BREAKOUT, 30-45 DTE default
- buildStructureComparisons() → up to 4 categories: best-overall, best-stock, income-alternative, conservative; confidence = techBase±regimeMod±thesisMod (0-100)
- OptionsStructureCard explicitly shows NEVER-list: no premiums, Greeks, OI, bid/ask, expiration dates (Sprint 2.2.1 placeholder)
- InstaTradePanel: brokerConnected=true → "Prepare Broker Review" (disabled); false → "Connect Broker to Verify Live Contracts"
- Sections are collapsible (Illustrative Trade Structures + Structure Comparison)
- 84 new tests in `client/src/components/research/structure/trade-structure-engine.test.tsx`
- All compliance language used: never "Buy/Sell/Recommended Trade/Expected Profit/Guaranteed/Target Return"

## Research Decision Engine (Sprint 2.1.3)
- 6 components in `client/src/components/research/decision/`: ResearchDecisionCard, QualificationSummaryCard, ScoreBreakdownCard, SupportingEvidenceCard, InvalidationCard, CatalystTimelineCard + ResearchDecisionEngine orchestrator
- Answers 6 research questions: why qualify, why rank, what supports, what weakens, what invalidates, what would improve
- deriveThesis() → "bullish"|"neutral"|"bearish" — fully deterministic (no AI), based on techScore+regime+riskScore thresholds
- ScoreBreakdown: 11 components (Technical, Momentum, Volume, RS, Regime, News, Congress, Institutional, Fundamentals, Liquidity, Risk), each 0-100, shown as contribution bars; institutional always score=0+available=false
- SupportingEvidenceCard: 7 sections each classified supports/neutral/weakens/unavailable via classifyEvidenceAlignment(score, available)
- InvalidationCard: 6 types (price, technical, fundamental, earnings, macro, sector); price item uses candidate.invalidation; honest "Not available." when absent
- CatalystTimelineCard: buildImprovementItems() (up to 5) + buildWarningItems() (up to 6, deduplicated by id)
- QualificationSummaryCard: buildQualificationConfirmations() → 4 items (regime, volume, trend, momentum), each confirmed/partial/missing/unavailable
- ResearchDecisionCard also placed at TOP of Overview tab (thesis summary) + full ResearchDecisionEngine in new "Decision" tab (8th tab, index 1)
- 74 new tests in `client/src/components/research/decision/research-decision-engine.test.tsx`
- All pure functions exported from each component file for testability; no new API calls; no server changes

## Professional Trade Cards (Sprint 2.1.2)
- 6 reusable components in `client/src/components/research/`: StockTradeCard, OptionsTradeCard, EvidenceCard, RiskCard, ActionCard, ResearchTradeCard (orchestrator)
- Shared types extracted to `client/src/components/research/types.ts`; opportunity-research.tsx imports from there + re-exports EvidenceStars for backward compat tests
- ResearchTradeCard replaces the Overview tab stacked layout: 2/3+1/3 grid (StockTradeCard + EvidenceCard), optional OptionsTradeCard (gated by shouldShowOptionsCard()), 1/2+1/2 (RiskCard + ActionCard)
- OptionsTradeCard renders only when candidate.instrument==="options" or structure contains option keywords; all fields are deterministic estimates, clearly labeled
- ActionCard: 5 secondary buttons (View Why, View Evidence, Congress Activity, Related Research, Save Research) + primary CTA (Prepare InstaTrade™ or Connect Broker)
- 57 new component unit tests in `client/src/components/research/research-trade-card.test.tsx`; all pure functions exported for testability
- MarketContextSection + ScanHistorySection remain below ResearchTradeCard in Overview tab

## Evidence Engine (Sprint 2.1.1)
- 7 tabs: Overview | Technical | Congress | News | Institutional | Catalysts | AI Summary
- Tab lazy-load via `visitedTabs: Set<TabValue>` — Congress mount gated on set membership; News query `enabled` gated on set membership
- `computeEvidenceStars()` and `buildAiSummaryBullets()` are exported pure functions — testable without DOM
- 50 client-side unit tests in `client/src/pages/opportunity-research.test.tsx`
- Congress tab: `CongressFlowEmbed view="ticker"` with disclaimer card above; no server API
- Institutional tab: static unavailable state — no data source exists yet
- AI Summary: 5 deterministic bullets (technical, regime, news, risk, lifecycle) — no LLM call
- `EvidenceStars.institutional` is typed as `0` (not 1–5) to enforce unavailable state

## Test file
- `server/routes/opportunity-research.test.ts` — 22 tests; mocks storage, snapshot-store, opportunity-engine

**Why:** The page has strict compliance requirements that must not be broken by future edits. Any change adding financial outcome language, fabricated prices, or direct execution capability violates the educational-only constraint.

**How to apply:** Before editing opportunity-research.tsx or the server route, re-read the compliance invariants above and verify the modified text doesn't introduce prohibited language.
