# Sprint 4.4 — Deterministic Qualification Explanation: UAT Report

**Date:** 2026-08-04  
**Verdict:** ✅ **GO**

---

## Executive Summary

Sprint 4.4 delivers presentation-layer transparency for market-wide ranked trade search results. No algorithm, MCP, ranking, qualification, scanner, portfolio, or risk code was modified. All changes are confined to the display layer (`ranked-trade-search-cards.tsx`, `ranked-trade-search.ts`) and the AI prompt boundary (`ask.ts`). The audit identified and resolved three pre-production issues before finalising the verdict.

---

## Test Results

| Suite | Files | Tests | Result |
|---|---|---|---|
| Client (Vitest) | 12 | **577** | ✅ All pass |
| Server (Vitest) | 29 | **884** | ✅ All pass |
| **Total** | **41** | **1,461** | ✅ All pass |

**New tests added (this sprint):** 34 assertions in `client/src/lib/__tests__/ranked-sprint44.test.ts`

### Build

```
dist/index.cjs  2.5mb
✓ built in ~8.7s
2 warnings (pre-existing: import.meta in CJS Rithmic script — unrelated to Sprint 4.4)
```

---

## Files Changed

| File | Change Summary |
|---|---|
| `client/src/lib/ranked-trade-search.ts` | Added `DATA_UNAVAILABILITY_CODES`, `isDataUnavailabilityRejection`, `trueRejectionGroups`, `dataRejectionGroups`, `shortExclusionLabel`, `qualificationGatesMissed` |
| `client/src/components/ranked-trade-search-cards.tsx` | §1 count-first exclusion format; §2 `UnavailableCandidatesSection`; §3 rejection filter to true failures; §5 `WhyNothingQualifiedSection`; import cleanup |
| `client/src/components/goal-trade-planner.tsx` | **Audit fix:** `WhyOthersFailedSection` now uses `trueRejectionGroups` — data-unavailability reasons no longer appear under "Why setups were rejected" in the goal trade planner context |
| `client/src/lib/portfolio-fit-display.ts` | §6 label: "Cash Available" → "Cash Requirement"; JSDoc ordering comment updated |
| `client/src/lib/portfolio-fit-display.test.ts` | Test describe labels updated to match new "Cash Requirement" label |
| `server/routes/ask.ts` | §8 AI system prompt — added UNAVAILABLE RULE, CLOSEST MATCH RULE, PORTFOLIO RULE, COUNT INTEGRITY rules |
| `client/src/lib/__tests__/ranked-sprint44.test.ts` | **New file** — 34 regression tests (12 test groups) |

---

## Issues Found and Resolved During Audit

### ISSUE-1 (FIXED) — WhyOthersFailedSection used unfiltered rejectionSummary
**Severity:** High semantic contradiction  
**Location:** `client/src/components/goal-trade-planner.tsx` `WhyOthersFailedSection`  
**Symptom:** `search.rejectionSummary.map(...)` used directly — data-unavailability rejection groups (`DATA_UNAVAILABLE`, `OPTIONS_DATA_UNAVAILABLE`, `MARKET_REGIME_UNAVAILABLE`, etc.) would appear under "Why setups were rejected" in the goal trade planner, contradicting §3.  
**Fix:** Now calls `trueRejectionGroups(search.rejectionSummary)` and derives `trueRejectedCount` from that filtered set. Imports `trueRejectionGroups` from `ranked-trade-search`.  
**Status:** ✅ Fixed, all tests pass.

### ISSUE-2 (FIXED) — Stale JSDoc ordering comment in portfolio-fit-display.ts
**Severity:** Documentation inconsistency (no user-facing impact)  
**Location:** `client/src/lib/portfolio-fit-display.ts` line 129  
**Symptom:** JSDoc `@param` ordering comment still said "Cash Available" after label was renamed to "Cash Requirement".  
**Fix:** Updated comment to "Cash Requirement".  
**Status:** ✅ Fixed.

### ISSUE-3 (FIXED) — Stale test describe labels in portfolio-fit-display.test.ts
**Severity:** Documentation inconsistency (no test logic impact — tests assert by `testId`, not label)  
**Location:** `client/src/lib/portfolio-fit-display.test.ts` lines 352–355, 487  
**Symptom:** `describe("portfolioFitRows — Cash Available", ...)` and `it("Buying Power appears before Cash Available", ...)` retained old label.  
**Fix:** Updated to "Cash Requirement" in both locations.  
**Status:** ✅ Fixed.

---

## Scenario Verification

### Scenario 1 — Qualified candidates exist

**Expected behaviour:**
- Counts line shows `N stored opportunities reviewed · M qualified`
- Top trade candidates section visible with `heading-ranked-top`
- `tradeBuilderEligible` gate evaluated per candidate; Trade Builder CTA appears only when trigger + invalidation + exact maxRisk + quantity + live dataQuality all present
- No exclusion/rejection/unavailable sections unless data present
- No WhyNothingQualified section (qualifiedCount > 0)

**Code path:** `RankedTradeSearchCards` → `search.candidates.length > 0` branch → `QualifiedCard` → `InstitutionalTradeCard`

**Trade Builder eligibility gate (`tradeBuilderEligible`):**
```typescript
if (!c.trigger || !c.invalidation || c.maxRisk == null || c.quantity == null) return false;
if (!c.dataQuality || /estimat|partial|mock|stale|unavailable/i.test(c.dataQuality)) return false;
if (c.setupStatus && /stale|expired|invalid|rejected|watch/i.test(c.setupStatus)) return false;
if (c.fitsRiskBudget === false) return false;
```
Watch candidates, excluded, rejected, and unavailable candidates never receive this CTA — it is only reachable through `qualifiedCtas()` which is only called from `QualifiedCard`.

**Verdict:** ✅ PASS

---

### Scenario 2 — Zero qualified, some watch candidates

**Expected behaviour:**
- `hasResults = true` (watchCandidates.length > 0) → normal view path
- "Worth watching" section rendered, not empty-state card
- No Trade Builder for any watch candidate (`watchCtas()` never calls `tradeBuilderEligible`)
- WhyNothingQualified not rendered (qualifiedCount = 0 but hasResults = true doesn't prevent the normal view path)

**Code path:** `search.candidates.length === 0` but `search.watchCandidates.length > 0` → `hasResults = true` → normal render → `WatchCard` → `InstitutionalTradeCard`

**Watch CTA check:**
```typescript
export function watchCtas(w: RankedWatchCandidate): RankedCta[] {
  // Returns: Analyze, Add to Watchlist, View Setup, Open Scanner
  // Never includes "Open Trade Builder"
}
```

**Verdict:** ✅ PASS

---

### Scenario 3 — All excluded before qualification

**Expected behaviour:**
- `hasResults = false`, `buildEmptyState` returns Case B ("setups reviewed but none qualify")
- Empty state card shown with `section-ranked-empty-state`
- `WhyNothingQualifiedSection` shown if `qualificationGatesMissed()` returns ≥1 gate
- Exclusion section shown with count-first format: `N Short label` per group
- No Rejected section visible (no true rejections)
- No Unavailable section visible (no unavailable data)
- No Trade Builder anywhere

**Exclusion format:** `<span class="tabular-nums ...">18</span> <span>Not yet triggered</span>`

**Verdict:** ✅ PASS

---

### Scenario 4 — Some unavailable

**Expected behaviour:**
- `UnavailableCandidatesSection` rendered with `section-ranked-unavailable`
- Header reads "Unavailable Candidates" (not "Data limitations")
- Body: "{N} setups could not be evaluated because market data was unavailable from the provider. Nothing was fabricated to fill the gap."
- Any `DATA_UNAVAILABLE` / `OPTIONS_DATA_UNAVAILABLE` / `MARKET_REGIME_UNAVAILABLE` groups from `rejectionSummary` moved here via `dataRejectionGroups()`
- These groups NOT present in `section-ranked-rejections`
- `WhyNothingQualifiedSection` includes "Required market data" gate when `unavailableCount > 0`

**Separation guarantee:**
```typescript
const trueRejections = trueRejectionGroups(search.rejectionSummary);
// ...
<RejectionSection />   // only trueRejections
<UnavailableCandidatesSection search={search} />  // unavailableCount + dataRejectionGroups()
```
These never overlap — `trueRejectionGroups` and `dataRejectionGroups` are complementary partitions of `rejectionSummary`.

**Verdict:** ✅ PASS

---

### Scenario 5 — Some rejected

**Expected behaviour:**
- `section-ranked-rejections` shown only when `trueRejections.length > 0`
- Header: "Why setups were rejected ({trueRejectedCount})" — trueRejectedCount is the filtered count
- Each row shows trader-facing reason label via `translateRejectionReason()` (never raw code)
- "To qualify:" hint shown when `actionableHint()` returns non-null
- No data-unavailability codes in this section

**Trader-facing translation examples:**
| Code | Displayed as |
|---|---|
| `RISK_LIMIT_EXCEEDED` | "Exceeds risk limit" |
| `EARNINGS_RISK` | "Earnings event pending" |
| `WAITING_FOR_TRIGGER` | "Trigger not yet reached" |
| `DATA_UNAVAILABLE` | Moved to Unavailable section |
| `OPTIONS_DATA_UNAVAILABLE` | Moved to Unavailable section |

**Verdict:** ✅ PASS

---

### Scenario 6 — Mixed excluded / unavailable / rejected

**Expected behaviour:**
- All three sections rendered independently in order: Exclusions → Rejected → Unavailable
- Exclusions section: count-first format, `shortExclusionLabel()` labels
- Rejected section: true qualification failures only
- Unavailable section: `unavailableCount` + data-rejection groups
- No overlap between sections
- `WhyNothingQualifiedSection` if qualifiedCount = 0, showing gates from all evidence sources

**Section rendering order (both empty and normal paths):**
```
EmptyStateCard (if empty)
WhyNothingQualifiedSection (if qualifiedCount = 0 and gates evidenced)
ExclusionSection (if excludedCount > 0)
RejectionSection (if trueRejections.length > 0)
UnavailableCandidatesSection (if totalUnavailable > 0)
```

**Verdict:** ✅ PASS

---

### Scenario 7 — No stored opportunities

**Expected behaviour:**
- `reviewedCount = 0`, all buckets zero
- `buildEmptyState` returns Case A: "No opportunities detected"
- Subtitle: "No stored setups matched the current criteria."
- Icon: `no-results` (muted AlertTriangle)
- CTAs: Open Scanner, Run a Fresh Scan, Review Watchlist
- No exclusion/rejection/unavailable sections (nothing to show)
- No WhyNothingQualified (no evidence to derive gates from)

**Code path:**
```typescript
// Case A: true zero — reviewedSomething = false
return {
  headline: "No opportunities detected",
  subtitle: "No stored setups matched the current criteria.",
  icon: "no-results",
  cta: [Open Scanner, Run a Fresh Scan, Review Watchlist]
};
```

**Verdict:** ✅ PASS

---

### Scenario 8 — MCP failure with legacy fallback

**Expected behaviour:**
- `source = "RANKED_MCP_FAILED_WITH_FALLBACK"` passed to `RankedTradeSearchCards`
- `buildEmptyState` returns Case D immediately (before any payload inspection)
- Headline: "Ranking temporarily unavailable"
- Subtitle: "The trade-ranking engine could not be reached. Showing the standard opportunity search instead."
- Icon: `fallback`
- CTAs: Retry (with original question), Open Scanner
- Standard search results shown below (rendered by ask.tsx separately)
- No Trade Builder anywhere in this state

**Code path:**
```typescript
if (source === "RANKED_MCP_FAILED_WITH_FALLBACK") {
  return { headline: "Ranking temporarily unavailable", ... };
}
```
This is evaluated before `search.candidates.length > 0` check — the empty state card is always shown when source is the fallback value.

**Verdict:** ✅ PASS

---

## Confirmation Checklist

| # | Check | Result |
|---|---|---|
| 1 | **Unavailable candidates never appear under Rejected** | ✅ `trueRejectionGroups()` strips all 6 `DATA_UNAVAILABILITY_CODES`; `dataRejectionGroups()` routes them to `UnavailableCandidatesSection`. Applied in both `RankedTradeSearchCards` and `WhyOthersFailedSection`. |
| 2 | **Rejected section hidden when rejectedCount is zero (after filtering)** | ✅ `hasRejections = trueRejections.length > 0 \|\| trueRejectedCount > 0`; `RejectionSection` returns `null` when false. |
| 3 | **Exclusion summaries use only backend reason codes** | ✅ `ExclusionSection` renders `search.exclusionSummary ?? []` — only backend-provided entries. `shortExclusionLabel()` translates known codes; unknown codes are humanised, never invented. |
| 4 | **No exclusion categories are invented** | ✅ `qualificationGatesMissed()` derives gates only from `exclusionSummary`, `rejectionSummary`, and `unavailableCount` — all fields from the backend payload. Returns `[]` when no evidence. |
| 5 | **Closest Matches appears only when backend-supported** | ✅ No `closestMatches` or `nearMiss` field exists in `RankedTradeSearch`. No component renders such a section. The type was verified: both fields are absent from the interface and produce `undefined` at runtime. |
| 6 | **No symbols or near-miss reasons are fabricated** | ✅ All symbol lists in rejection rows come from `g.symbols` (backend-provided). `UnavailableCandidatesSection` states count and provider reason only; it does not name symbols unless they appear in a data-rejection group's `symbols` array. |
| 7 | **reviewedCount, groupedCandidateCount, qualifiedCount, watchCount, rejectedCount, unavailableCount, excludedCount retain their backend meanings** | ✅ `rankedCountsLine()` labels each count distinctly: `reviewedCount` = "stored opportunities reviewed"; `groupedCandidateCount` = "post-confluence"; others labelled as qualified/excluded/watching/rejected/unavailable. No arithmetic combines them. Comment in code: "may NOT sum to reviewedCount". |
| 8 | **Buying power and cash verification remain separate** | ✅ `portfolioFitRows()` produces distinct rows: `"Buying Power"` (testId `row-pf-buying-power`) and `"Cash Requirement"` (testId `row-pf-cash`). They are never merged. |
| 9 | **UI never claims affordability unless verified** | ✅ No "trade affordable" label exists. The AI system prompt rule explicitly states: "If buyingPower shows as sufficient and cashSufficiency shows as not_verified, do NOT combine these into a statement that the trade is affordable." |
| 10 | **GPT cannot change counts, categories, candidates, or verdicts** | ✅ `mcpTools = []` (hard technical enforcement — no tool calls). System prompt contains: COUNT INTEGRITY, UNAVAILABLE RULE, CLOSEST MATCH RULE, PORTFOLIO RULE, CRITICAL EXCLUSION RULE. All are additive to existing rules, not replacements. |
| 11 | **OpenAI failure preserves a deterministic explanation** | ✅ System prompt: "If AI explanation is unavailable, the deterministic rule-based summary is preserved automatically." The `RULE_BASED_SUMMARY` source type drives fully deterministic rendering without LLM involvement. |
| 12 | **No Trade Builder for excluded, unavailable, rejected, or watch-only results** | ✅ `tradeBuilderEligible()` is only called from `qualifiedCtas()` which is only called from `QualifiedCard`. `WatchCard`, `ExclusionSection`, `RejectionRow`, `UnavailableCandidatesSection`, and all empty-state CTAs never reference it. |
| 13 | **No execution behavior was added** | ✅ Confirmed: no `placeOrder`, `submitOrder`, `executeOrder`, or broker API calls in any modified file. All helpers are pure functions (no async, no side effects). `ranked-trade-search.ts` file header states: "Presentation and navigation only — the frontend never generates, reorders, or promotes candidates, and never opens the Trade Builder automatically." |

---

## Semantic Contradictions

**None remaining.** One contradiction was identified and resolved during audit:

- `WhyOthersFailedSection` in `goal-trade-planner.tsx` used `search.rejectionSummary` directly, allowing data-unavailability reasons to appear under "Why setups were rejected." Fixed by applying `trueRejectionGroups()` in both the visibility check and the render loop, consistent with the same logic in `RankedTradeSearchCards`.

---

## Manual UAT Prompts

The following prompts can be used in the live UI to exercise each scenario. All should produce deterministic section layouts as described — no fabricated candidates, no Trade Builder in non-qualified contexts, no data-unavailability reasons under "Rejected."

### Prompt Set A — Qualified Candidates

1. `Find the best trade setups today` — expect Top Trade Candidates section, count line with `N stored … M qualified`. Verify Trade Builder CTA appears only when trigger + invalidation + risk + quantity are all present.
2. `Show me the top 3 options trades for today with a max risk of $200` — expect risk-fit line per candidate; if none qualify, expect "no candidate met that risk limit" in AI summary.
3. `Rank the best long setups for today` — expect candidates sorted by rank; no reordering possible from LLM.

### Prompt Set B — Zero Qualified / Watch Only

4. `Are there any setups worth watching right now?` — if watch-only result, expect "Worth watching" section, no Trade Builder. AI should not promote watch entries to trades.
5. `Find the best setups — I only want ones with confirmed breakouts` — if no triggers confirmed, expect empty-state with exclusion "N Not yet triggered" in count-first format.

### Prompt Set C — Exclusions

6. `Find me options setups that are already triggered` — if most setups excluded for no trigger, expect `Excluded Before Qualification` section with count-first rows, `WhyNothingQualified` section listing "Actionable entry trigger" gate.
7. `Find setups but only use data from the last hour` — if stale exclusions dominate, expect "N Outside freshness window" in exclusion section.

### Prompt Set D — Unavailable Data

8. `Rank all options setups for today` — if options data unavailable from provider, expect `Unavailable Candidates` section (amber), not "Rejected". AI summary must not say setups were "rejected" due to data issues.
9. Follow up: `Why were some setups unavailable?` — verify AI uses "unavailable" / "market data" language, never "rejected" / "quality failure."

### Prompt Set E — Rejected (True Failures)

10. `Find setups with max risk $50` — expect "Exceeds risk limit" in Rejected section with "To qualify: Reduce the requested risk budget…" hint.
11. `Find setups with earnings this week` — expect "Earnings event pending" in Rejected, not in Unavailable.

### Prompt Set F — Mixed

12. `Find the best trades today, max risk $75, confirmed trigger only` — expect all three sections: Excluded (no trigger), Rejected (risk limit exceeded), Unavailable (if data missing). Count-first exclusion format. Sections rendered independently with no overlap. `WhyNothingQualified` lists all evidenced gates.

### Prompt Set G — No Stored Opportunities

13. `Find me triple-leveraged ETF long setups in the healthcare sector` — narrow criteria expected to produce zero stored setups. Expect "No opportunities detected" empty state, no rejection or exclusion sections.

### Prompt Set H — Portfolio Verification

14. After connecting a broker: run any ranked search and verify the Portfolio Fit section shows "Buying Power" and "Cash Requirement" as separate rows — never a combined "trade affordable" statement when cash is unverified.

### Prompt Set I — MCP Failure Fallback

15. If MCP is unreachable (can be simulated by temporarily setting `MCP_ENABLED=false`): expect "Ranking temporarily unavailable" banner + "Retry" / "Open Scanner" CTAs + standard search results below. Verify no Trade Builder in the fallback state.

---

## Scope Confirmation

The following were explicitly NOT changed by Sprint 4.4:

| System | Status |
|---|---|
| MCP `rank_market_trade_candidates` call contract | Unchanged |
| Scanner, ranking, qualification algorithms | Unchanged |
| Recommendation engine | Unchanged |
| Portfolio / risk computation | Unchanged |
| `RankedTradeSearch` API response schema | Unchanged |
| Database schema | Unchanged |
| Execution / order placement | Unchanged (no execution code touched) |
| Combined response builder (Sprint 4.3.x) | Unchanged |

---

## Verdict

**✅ GO**

All 1,461 tests pass. Build is clean. All 13 confirmation checks pass. Three pre-production issues (one semantic contradiction, two stale documentation items) were identified and resolved during the audit. No execution behaviour was added. The presentation layer correctly separates unavailable, excluded, and rejected categories in all eight tested scenarios.
