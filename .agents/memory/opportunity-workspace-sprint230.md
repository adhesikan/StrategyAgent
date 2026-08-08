---
name: Opportunity Research Workspace — Sprint 2.3.0
description: New /opportunities/:symbol page with 5 tabs, compare mode, related opportunities, deterministic explanations. Exactly 2 API calls.
---

## Route

`/opportunities/:symbol` → `OpportunityWorkspacePage` (distinct from existing `/opportunity/:symbol` → Research Package)

## Two-call contract

- Call 1: `GET /api/opportunities/today` — full ranking (in-memory, instant; shared with dashboard cache)
- Call 2: `GET /api/opportunities/workspace/:symbol` — history + institutional signal (both precomputed)

## New server route

`server/routes/opportunity-workspace.ts` → registered as `registerOpportunityWorkspaceRoute`
- Returns `{ symbol, companyName, history[], institutional: InstitutionalSignal | null }`
- Runs `getSymbolHistory` + `getInstitutionalSignal` in parallel
- Includes expanded COMPANY_NAMES map (40+ tickers)
- institutional is non-fatal: `.catch(() => null)`

## Pure helpers module

`client/src/lib/opportunity-workspace-helpers.ts` — exports:
- `getScoreColor(score)` / `getScoreBarBg(score)` — same thresholds as ranking helpers
- `getConfidenceBadge(confidence)` / `getCategoryBadge(category)` — Tailwind classes
- `buildRankedExplanation(score, candidate?, regime?)` → `{ bullets, summary }` — deterministic, no LLM
- `buildRiskExplanation(score, candidate?)` → `{ rewardRisk, gapRisk, liquidity, volatility, earningsNote, riskBudget }`
- `findRelated(symbol, ranking, limit=4)` → `RelatedOpportunity[]` — prefers same_strategy then same_category
- `analyzeHistoryTrend(history)` → `{ direction, deltaScore, sessions }` — latest vs oldest score
- `getAllRankedSymbols(ranking)` — all unique symbols from ranking (for compare datalist)
- `findScoredCandidate(symbol, ranking)` — searches topGrowth → topIncome → watchlist → approaching

## Page structure

Header (sticky): ticker, companyName, category badge, confidence badge, regime badge, overall score, age
Score pills row: Tech / Inst / Fund / Risk / Regime
Compare controls: text input with `<datalist>` of all ranked symbols — no new API call needed
ComparePanel: side-by-side score comparison, rendered from cached today data
Tabs: Overview | Technical | Institutional | Risk | History
RelatedSection: max 4 cards from cached ranking data
Footer disclaimer

## Compare mode

No new API call. Both symbols looked up from `ranking` already in memory.
If compared symbol is not in ranking, shows "not in current ranking" message.

**Why:** the ranking already contains all scored candidates; a third call for compare would violate the 2-call budget.

## Tests

49 pure-function tests in `client/src/lib/__tests__/opportunity-workspace-helpers.test.ts`
All pass with zero DOM dependencies.
