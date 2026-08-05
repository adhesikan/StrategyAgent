# MU Price and Analysis Consistency Diagnostic

**Generated:** 2026-08-05  
**Scope:** Focused production diagnostic — "Analyze MU" via Ask AI  
**Status:** Diagnostic only. No fixes implemented. No commits or pushes.

---

## Observed Symptoms

| Field | Observed Value | Expected Range (MU) |
|---|---|---|
| Current price | ~893.5 | ~$90–$130 |
| Major high | 1,255.00 | ~$120–$160 |
| Invalidation | 737.88 | ~$70–$100 |
| Overall verdict | No trade | — |
| Strategies checked | 10 | — |
| Strategies matched | 10 | — |
| Strategy status labels | mostly "Unknown" | Forming / Triggered / Ready |
| Page confidence | high | medium or low |
| Rejection reasons | "Requested direction 'either' conflicts with setup direction 'neutral'" | not applicable for an "Analyze" ask |

---

## Section 1 — Price Data Trace

### Layer-by-layer data path

```
User prompt "Analyze MU"
  → ask.ts: classifyAnalysisIntent → GENERIC_MULTI_STRATEGY
  → runMultiStrategyAnalysis (server/mcp/multi-strategy-analysis.ts)
    → per-strategy: deps.scanStrategy(sym, meta.id, timeframe)
      → server/mcp/tools.ts: tools.scanStrategy(s, st, tf)
        → MCP HTTP call: vcp-trader-mcp /mcp  (external service)
          → vcp-trader-mcp internally calls:
              GET /api/internal/market/history?symbol=MU&interval=1day&outputSize=120
                → TwelveDataDailyProvider.getDailyBars()
                  → Twelve Data API (raw OHLCV, adjustedClose: null)
```

### What the internal market endpoint returns

**`server/routes/internal-market.ts` line 172–179:**
```ts
.map((b) => ({
  timestamp: b.tradeDate,
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
  volume: b.volume,
}))
```

- No multiplier, no scaling, no adjustment applied server-side.
- `adjustedClose` is explicitly `null` in `TwelveDataDailyProvider` — raw prices passed through.
- The endpoint is correct for MU's actual price (~$90–$130).

### Where the scaling diverges

**The internal market endpoint is not the first component producing incorrect values.**

The external vcp-trader-mcp service receives correct candles from `/api/internal/market/history` and performs its own analysis. The displayed price (~893.5), major high (1,255.00), and invalidation (737.88) are the values returned by the MCP service inside `scan_strategy` or `build_trade_candidate` responses — **not** values our server computes.

Evidence:
- `marketContext.price` (line 569): `primary?.setup.currentPrice ?? null` — taken verbatim from the MCP scan_strategy setup object.
- `trigger`, `invalidation`, `technicalObjective` (lines 121–129 of multi-strategy-analysis-cards.tsx): rendered directly from `ps.trigger?.price`, `ps.invalidation?.price`, `ps.technicalObjective?.price` — all MCP-supplied, not computed here.

**First component producing incorrect values: the vcp-trader-mcp external service** — in its scan_strategy or build_trade_candidate response for MU.

### Root-cause hypotheses (cannot eliminate without vcp-trader-mcp source access)

| Hypothesis | Evidence for | Evidence against |
|---|---|---|
| 10× multiplier inside MCP price extraction | 893.5 ÷ 10 = 89.35 (plausible MU price) | Cannot confirm without MCP source |
| Cents instead of dollars | 89350¢ → $893.50 would require further investigation | MCP returns float, not integer |
| Double split-adjustment | TwelveData returns raw (adjustedClose: null); MCP may apply its own adjustment on top | Only one split layer is visible on our side |
| Wrong historical series | MCP could be fetching a different ticker's history | Symbol is passed as "MU" from our code |
| Stale mock fixture | `isMockSource()` checks for "mock/synthetic/sample/fake" in source string; if vcp-trader-mcp returns `source: "mock"`, `realMarketData` would be false — but observed confidence is "high" (requires `realMarketData: true`), so fixture is less likely unless the source string doesn't contain those keywords | See above |

### What our server does NOT do to the prices

- No multiplication, scaling, or unit conversion in `internal-market.ts`, `multi-strategy-analysis.ts`, or `ask.ts`.
- No normalization transforms; bars are sorted ascending and sliced by `outputSize`.
- `resistance` and `invalidation` for the multi-strategy path are **not computed by our server** — they come from the MCP scan_strategy setup fields directly.

> **Diagnostic boundary:** We can confirm our server hands correct raw prices to the MCP. We cannot trace what the MCP does internally without its source code. The incorrect values are first visible in the `scan_strategy` response objects that our code receives and relays.

---

## Section 2 — Match-Count Semantics

### Root cause

**`strategiesMatched` counts responses-containing-a-setup, not qualified or actionable setups.**

**`server/mcp/multi-strategy-analysis.ts` lines 490–496:**
```ts
const matched = outcomes.filter((o): o is Extract<ScanOutcome, { kind: "match" }> => o.kind === "match");
// ...
base.strategiesMatched = matched.length;
```

`kind === "match"` is assigned at line 456: `if (setup) { return { kind: "match", ... } }` — i.e., any scan_strategy response where `extractSetup()` finds a non-null setup object.

A setup qualifies as "matched" the instant `extractSetup()` returns non-null, regardless of:
- `setup.status` (null/undefined → renders as "Unknown")
- Whether the candidate was evaluated at all (only top 3 get `buildTradeCandidate` called — capped at `MAX_CANDIDATE_BUILDS = 3`)
- Whether the candidate verdict was QUALIFIED or NO_TRADE
- Whether the setup is stale (older than 10-day freshness window)

**Observed result for MU:**
- 10 strategies returned non-null setup objects → `strategiesMatched = 10`
- Overall verdict = NO_TRADE because no candidate was QUALIFIED and the fresh-evidence test failed
- Supporting strategies all show "Unknown" status because all `setup.status` fields are null/empty

### Actual state distribution (inferred)

| State label | Correct name | How to identify |
|---|---|---|
| Matched (our current label) | "Returned a setup" | `scan_strategy` returned non-null setup |
| Confirming | Setup status = triggered / breakout / ready | `statusRank >= 2` |
| Forming | Setup status = forming | `statusRank === 1` |
| Unavailable/Unknown | Setup status = null/empty | `msaSupportGroup` → "unavailable" |
| Rejected | `candidateCheck.status === "NO_TRADE"` | from `deriveCandidateCheck` |
| Failed | `scan_strategy` threw or timed out | `kind === "failed"` |

For MU: all 10 matched setups fall into "Unavailable/Unknown" because `setup.status` is null. They are NOT confirming or forming — they are setups returned by the scanner with no valid status.

**The displayed badge "10 matches" is misleading.** It should read "10 responses" or "10 setups returned", with a separate count for confirmed or forming setups.

---

## Section 3 — Confidence Semantics

### Root cause

**`multiStrategyConfidence` returns "high" because `succeeded ≥ 3`, `dataQuality.complete`, and `dataQuality.fresh` are all true — but none of these conditions verify that the setups are actionable or have valid status fields.**

**`server/mcp/multi-strategy-analysis.ts` lines 600–611:**
```ts
export function multiStrategyConfidence(a: MultiStrategyAnalysis): "low" | "medium" | "high" {
  const succeeded = a.strategiesChecked - a.strategiesFailed;
  if (a.strategiesChecked === 0 || succeeded === 0) return "low";
  if (a.overallVerdict === "INSUFFICIENT_DATA") return "low";
  if (!a.dataQuality.realMarketData) return "low";          // mock/synthetic anywhere
  if (a.strategiesFailed > succeeded) return "low";         // most strategies failed
  if (a.dataQuality.fresh !== true) return "medium";        // unknown/stale caps at medium
  if (succeeded >= 3 && a.dataQuality.complete) return "high";
  return "medium";
}
```

For MU:
- `succeeded` = 10 (all 10 strategies returned setup objects; none failed)
- `realMarketData` = `true` (because `sources.length > 0 && !anyMock` — setup source strings don't contain "mock/synthetic/sample/fake")
- `fresh` = `true` (at least one setup has `detectedAt` within 10 days with non-zero statusRank — or all have `freshnessRank === 1` → `null`, but `null !== true` would cap at medium)
- `complete` = `true` because:

```ts
const complete =
  !!primary &&
  (isQualifiedVerdict(candidateVerdict(primary.candidate ?? null)) ||
    candidateVerdict(primary.candidate ?? null) === "NO_TRADE" ||   // ← this path
    (hasValidTrigger(primary.setup) && typeof primary.setup.invalidation?.price === "number"));
```

A NO_TRADE candidate verdict makes `complete = true`. The primary setup has a NO_TRADE candidate → `complete = true` → `high` confidence.

**Missing guards:** `multiStrategyConfidence` does not penalize for:
- All supporting setups being in the "unavailable/unknown" group (status = null)
- The primary setup itself having `status = null` ("Unknown")
- Zero confirming or forming setups across all 10 matched strategies
- `overallVerdict === "NO_TRADE"` with no WATCH setups

HIGH confidence is meant to reflect data completeness and analytical agreement — but here it misrepresents the analysis quality because "data was received" is being conflated with "data is meaningful".

---

## Section 4 — Direction Filter Root Cause

### The rejection message source

**The text "Requested direction 'either' conflicts with setup direction 'neutral'" originates inside the vcp-trader-mcp external service** and is returned in the `build_trade_candidate` response's `noTradeReasons` array.

Our server relays it verbatim:

**`server/mcp/multi-strategy-analysis.ts` lines 323–328:**
```ts
const reasons = [
  ...(Array.isArray(c.noTradeReasons) ? c.noTradeReasons : []),
  ...(Array.isArray(raw.reasons) ? (raw.reasons as unknown[]) : []),
].map((r) => String(r)).filter(Boolean);
// ...
reason: reasons[0] ?? null,
```

Our `buildTradeCandidate` call (ask.ts line 943): `(s, st) => tools.buildTradeCandidate(s, st)` — passes **only symbol and strategy**, not direction.

**But the MCP service generates a direction-conflict rejection anyway.** Possible cause: the vcp-trader-mcp service has its own internal default direction ("either" or inherited from a prior request context), and its candidate engine incorrectly treats "either" as a specific direction that must match the setup's "neutral" direction, rather than as "no restriction".

### Intended semantics (per spec §4)

| Requested direction | Expected behavior |
|---|---|
| `bullish` | Reject bearish-only setups |
| `bearish` | Reject bullish-only setups |
| `either` | **No directional restriction — accept all setup directions** |
| `neutral` | Accept neutral setups |

"Either" must not conflict with any setup direction including "neutral". The MCP service's candidate engine is violating this contract.

### Whether our code contributes

Our `buildTradeCandidate` call passes no direction argument. If the MCP service defaults to "either" internally for directionless calls, and then incorrectly rejects "neutral" setups on that basis, the bug is entirely inside the MCP service. Our server does not inject "either" into this call path.

---

## Section 5 — Research-Save Exposure

**Current gate:** `server/services/research-evidence-validator.ts` validates:
- Schema version (1.0)
- Known domain names
- Field types and lengths (strings, arrays, booleans)
- Forbidden sensitive keys recursively (accountId, apiKey, accessToken, etc.)
- `isFiniteNumber` for numeric fields (rejects Infinity, NaN)
- Domain-specific snapshot structure presence

**What the validator does NOT check:**
- Whether numeric price values are plausible in absolute terms
- Cross-field consistency (e.g., invalidation > currentPrice for a bullish setup)
- Whether `currentPrice` in the evidence matches the latest close from market history
- Whether trigger/invalidation/objective are on the same order of magnitude as currentPrice
- Whether `dataQuality.realMarketData === true` before allowing a save
- Whether `overallVerdict === "NO_TRADE"` with all strategies "Unknown" should block the save

**For MU specifically:**
- `currentPrice ≈ 893.5` with `invalidation ≈ 737.88` would pass the validator (both are finite numbers)
- These values would be written as immutable saved research
- The GPT explanation would include these price levels in its prose (the system prompt does not suppress levels when strategy statuses are all "Unknown")

**Research-save verdict: NO_GO**

Saving MU research records is not safe until:
1. The price scaling discrepancy in the MCP service is identified and resolved, OR
2. Cross-field consistency validation is added to the evidence validator that blocks implausible price ratios, OR
3. The gate checks `dataQuality.realMarketData && overallVerdict !== "INSUFFICIENT_DATA"` and all strategy statuses are not universally null/unknown

---

## Section 6 — UI Terminology

### Current behavior

`MSA_VERDICT_LABELS["NO_TRADE"]` in `client/src/lib/multi-strategy-analysis.ts` line 92:
```ts
NO_TRADE: "No trade",
```

The badge renders `Overall: No trade` — the raw enum text "NO_TRADE" does **not** appear in the UI. The mapping already exists. However, the spec requests rendering as **"No qualifying setup"** or **"No actionable setup"** to be more explicit about what NO_TRADE means in the context of a scan (as distinct from a trade request that was actively rejected).

Current label "No trade" is ambiguous — it could mean "we checked and there's no trade" or "you didn't ask for a trade". "No qualifying setup" is unambiguous.

---

## Section 7 — AI Explanation

### Current behavior

The system prompt for multi-strategy asks (`server/routes/ask.ts` line 1048):
> "The 'multiStrategyAnalysis' field in the user content is the DETERMINISTIC result… (6) NEVER invent triggers, stops, targets, scores, or strategy matches that are not in the payload; if a level is missing, say it is not available."

The model is constrained to not invent values, but it is **not constrained to suppress the existing values** when the data is suspect. If `currentPrice: 893.5`, `invalidation: 737.88` appear in the payload, the model will relay them.

There is no guard in the prompt-building logic that:
- Detects "all strategy statuses are Unknown"
- Detects "primary setup has a suspect price scale"  
- Instructs the model to explain price data could not be validated

---

## Section 8 — Smallest Correct Fixes

Listed in priority order. None implemented here.

### Fix 1 — Match-count label (UI only, no logic change)

**File:** `client/src/components/multi-strategy-analysis-cards.tsx` line 98  
**Change:** Rename the badge from `{a.strategiesMatched} matches` to a breakdown:
- `{confirming} confirming` / `{forming} forming` / `{a.strategiesChecked - a.strategiesFailed} responded`

Or at minimum: rename the existing badge from "matches" to "setups returned".

**No server changes required.** The supporting setup grouper (`msaSupportGroup`) already correctly classifies them — the display just doesn't summarize the group counts.

### Fix 2 — Confidence guard: penalize all-unknown-status results

**File:** `server/mcp/multi-strategy-analysis.ts` — `multiStrategyConfidence()`  
**Change:** Before returning "high", check that at least one setup has a non-null, non-empty status:
```ts
const hasKnownStatus = a.supportingSetups.concat(a.primarySetup ? [a.primarySetup] : [])
  .some(e => !!e.setup.status);
if (!hasKnownStatus) return "medium";
```
This prevents "high" confidence when every matched strategy returned an Unknown-status setup.

### Fix 3 — Direction-filter contract: fix "either" semantics

**Upstream fix (vcp-trader-mcp):** The MCP candidate engine must treat `direction === "either"` as "no directional restriction" and never conflict-reject any setup direction for it.

**Server-side mitigation (if MCP is not immediately fixable):** In `runMultiStrategyAnalysis`, strip the rejection reason when it matches the "conflicts with setup direction" pattern and the requested direction was not set by the user (since the multi-strategy path never passes direction to `buildTradeCandidate`):
```ts
// Filter out direction-conflict rejections when we didn't request a direction
if (!userRequestedDirection && reason?.includes("conflicts with setup direction")) {
  reason = null;
}
```

### Fix 4 — Research-save cross-field consistency gate

**File:** `server/services/research-evidence-validator.ts`  
**Change:** Before minting a handle, add a consistency check:
```ts
// If currentPrice and invalidation are both present, invalidation must be
// within a reasonable band of currentPrice (e.g. 0.5× to 2.0× for any direction).
const priceRatioOk = (a: number, b: number) => {
  const ratio = a / b;
  return ratio >= 0.5 && ratio <= 2.0;
};
```
Also gate on `dataQuality.realMarketData === true` and `overallVerdict !== "INSUFFICIENT_DATA"` before minting.

### Fix 5 — NO_TRADE verdict label

**File:** `client/src/lib/multi-strategy-analysis.ts` line 92  
**Change:** `NO_TRADE: "No qualifying setup"` (keep enum unchanged, change display string only)

### Fix 6 — GPT price-suppression rule

**File:** `server/routes/ask.ts` — in the multi-strategy `mcpSystemRules` block  
**Change:** Add after existing rule 6:
> "(7) If all strategy setups in the payload have null or unknown status, do not repeat the price levels as if they are confirmed. Instead write: 'Price-level analysis could not be validated because no strategy returned a confirmed status, so no research conclusion was generated from those levels.'"

---

## Section 9 — Tests Required

| Test | What to verify |
|---|---|
| `multiStrategyConfidence` — all-unknown-status setups | Returns "medium" not "high" when every matched setup has `status: null` |
| `multiStrategyConfidence` — NO_TRADE verdict with fresh + complete data | Still returns "high" **only** if at least one setup has a non-null status |
| `strategiesMatched` label | Matched count = 10 where 0 are confirming, 0 forming, all unknown-status is correctly described in UI groupings |
| Evidence validator cross-field price ratio | `validateResearchEvidence` returns invalid when `invalidation` is 0.3× or 3× of `currentPrice` |
| Evidence validator `realMarketData` gate | No save handle when `dataQuality.realMarketData === false` |
| Direction-filter "either" | `deriveCandidateCheck` with a rejection reason matching "conflicts with setup direction" where user direction was not set — ensure it does not surface as the primary actionable reason |
| `msaSupportGroup` — null status | Returns "unavailable" for a setup with `status: null`, `status: ""`, `status: undefined` |
| NO_TRADE label mapping | `MSA_VERDICT_LABELS["NO_TRADE"]` renders "No qualifying setup" not raw enum |

---

## Summary Table

| Issue | Root component | Severity |
|---|---|---|
| Price scaling (~10× off) | vcp-trader-mcp external service (scan_strategy response) | **Critical** |
| "10 matches" misrepresents state | `strategiesMatched` counts setup responses, not qualified setups | **High** |
| All strategies show "Unknown" | MCP scan_strategy returns setups without `status` field | **High** |
| HIGH confidence despite NO_TRADE + all-unknown-status | `multiStrategyConfidence` — no guard for zero known-status setups | **High** |
| "either conflicts with neutral" direction rejection | vcp-trader-mcp `build_trade_candidate` — "either" not treated as no-restriction | **Medium** |
| No price-consistency gate on research-save | `research-evidence-validator.ts` — structural-only, no ratio check | **Medium** |
| "No trade" label instead of "No qualifying setup" | `MSA_VERDICT_LABELS` — easy 1-line fix | **Low** |
| GPT relays suspect price levels without caveat | `mcpSystemRules` — missing all-unknown-status suppression rule | **Low** |

---

## GO / CONDITIONAL_GO / NO_GO

**NO_GO — do not allow MU research records to be saved.**

Rationale:
1. The price levels in the evidence (~893.5 current, ~1,255 major high, ~737.88 invalidation) are approximately 10× plausible MU values and do not agree with the internal market endpoint's output.
2. The current `research-evidence-validator.ts` has no cross-field price consistency check and would pass these values as structurally valid.
3. Once saved, the evidence is immutable. Incorrect prices would persist in the user's research library and in any downstream journal entries.
4. The direction-filter rejections are generated by the MCP service on a directionless analysis ask — the fundamental analysis input is contaminated.
5. Confidence "high" misleads the user into trusting data where zero strategies returned a confirmed status.

**Conditions that would upgrade to CONDITIONAL_GO:**
- The vcp-trader-mcp price-scaling bug is identified and the MCP service returns plausible MU prices, AND
- A cross-field ratio consistency check is added to `research-evidence-validator.ts`, AND
- `dataQuality.realMarketData` is confirmed true and sources are non-mock

**Conditions that would upgrade to GO:**
- All of the above, PLUS `multiStrategyConfidence` returns "medium" or higher only when at least one setup has a confirmed non-null status, AND the direction-filter rejections are suppressed for directionless analysis asks.
