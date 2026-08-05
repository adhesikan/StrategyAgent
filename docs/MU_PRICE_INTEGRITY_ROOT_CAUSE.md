# Production Root Cause Diagnostic — MU Price Integrity Investigation

**Type:** Architecture trace — no code changes, no commits, no pushes, no deployments  
**Scope:** VCP Trader / StrategyAgent repository only  
**Date:** 2026-08-05

---

## 1. Deployment Verification

### What can be verified from this repository

| Item | Verified from repo |
|---|---|
| VCP Trader routes MCP calls through `MCP_BASE_URL` (env secret) | ✓ — `server/mcp/config.ts:47` |
| MCP bearer token is `MCP_SERVICE_TOKEN` (env secret) | ✓ — `server/mcp/config.ts:48` |
| Internal market API protected by `VCP_INTERNAL_API_KEY` (env secret) | ✓ — `server/routes/internal-market.ts:71` |
| One singleton `mcpClient` (no duplicate transports) | ✓ — `server/mcp/client.ts:221` |

### What CANNOT be verified from this repository

| Item | Why |
|---|---|
| Current MCP deployment SHA | MCP is an external service; its source is not in this repo |
| URL the MCP service uses when calling back to `/api/internal/market/history` | Configured in the MCP service environment, not here |
| Whether MCP is calling a stale/legacy VCP Trader URL | Cannot inspect from here |
| Railway / Render / Railway deployment SHA for either service | Infrastructure outside this repo |

**→ These items require a follow-up MCP-side investigation (§16).**

---

## 2. Provider Trace

**Provider:** `TwelveDataDailyProvider` (`server/services/daily-market-data/twelve-data-client.ts`)  
**Called by:** `/api/internal/market/history` → `fetchDailyBars({ symbol: "MU", outputSize: 120, caller: "internal_market_api" })`

### Number parsing

```ts
// twelve-data-client.ts:17–24
function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
```

**Finding:** `parseNum` is a straight numeric parse — no unit conversion, no scale factor.

### Bar assembly

```ts
bars.push({
  symbol,
  tradeDate: dt,
  open,    // parseNum(v.open)
  high,    // parseNum(v.high)
  low,     // parseNum(v.low)
  close,   // parseNum(v.close)  ← direct, no transform
  ...
});
```

**Finding:** No scale factor applied to `close`. Twelve Data returns MU at ~89.xx; if the provider is functioning correctly, `close` contains 89.xx at this stage.

**Provider verdict: Correct prices leave the provider layer.**

---

## 3. Internal Endpoint Trace

**Endpoint:** `GET /api/internal/market/history?symbol=MU&interval=1day&outputSize=120`  
**File:** `server/routes/internal-market.ts:112–181`

### Candle mapping

```ts
const candles: InternalMarketCandle[] = bars
  .slice()
  .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  .slice(-outputSize)
  .map((b) => ({
    timestamp: b.tradeDate,
    open:   b.open,
    high:   b.high,
    low:    b.low,
    close:  b.close,   // ← direct field copy, no transform
    volume: b.volume,
  }));

return res.json({ symbol, interval, candles });
```

**Finding:** Direct field copy — no unit conversion, no scale factor, no rounding to a different order.

**Response format confirmed:**
```json
{
  "symbol": "MU",
  "interval": "1day",
  "candles": [
    { "timestamp": "YYYY-MM-DD", "open": 88.x, "high": 91.x, "low": 87.x, "close": 89.x, "volume": ... },
    ...
  ]
}
```

**Internal endpoint verdict: Correct prices (~89.xx) are returned to any caller including the MCP service.**

---

## 4. Cross-Service HTTP Boundary

### VCP Trader → MCP service (outbound)

When `runMultiStrategyAnalysis("MU", ...)` is called from `server/routes/ask.ts:939`, it calls `scanStrategy` for each strategy:

```ts
// server/mcp/tools.ts:179–194
export async function scanStrategy(symbol, strategy, timeframe?) {
  const args = {
    symbol: cleanSymbol(symbol),        // "MU"
    strategy: toMcpStrategyId(strategy), // e.g. "vcp"
  };
  if (timeframe !== undefined) args.timeframe = toMcpTimeframe(timeframe);
  return callAllowedTool("scan_strategy", args);
}
```

**What VCP Trader sends to MCP:** `{ symbol: "MU", strategy: "vcp" }` (plus timeframe when applicable). No price data is sent outbound — the MCP service fetches its own market data.

### MCP service → VCP Trader (inbound callback)

Because the MCP service has no `TWELVE_DATA_API_KEY`, it **must** call back to VCP Trader's `/api/internal/market/history` using `VCP_INTERNAL_API_KEY`. The URL it uses for this callback is configured in the MCP service environment.

**What VCP Trader's endpoint returns:** Correct candles (~89.xx close) as confirmed in §3.

**What the MCP service returns to VCP Trader:** Setup with `currentPrice ≈ 893.5` — approximately 10× the actual price.

**The price inflation occurs inside the MCP service.** The exact boundary (HTTP adapter vs candle parsing vs scanner) cannot be determined from this repository alone.

---

## 5. MCP Boundary Trace (as far as observable from this repo)

VCP Trader receives the MCP `scan_strategy` result via `mcpClient.callTool`:

```ts
// server/mcp/client.ts:162–172
if (result.structuredContent !== undefined) return result.structuredContent;
const text = extractText(result.content);
if (text) {
  try { return JSON.parse(text); } catch { return text; }
}
return result.content ?? null;
```

VCP Trader does not transform price values from MCP responses. It passes them directly into the `MultiStrategyAnalysis` structure in `runMultiStrategyAnalysis`.

**What cannot be determined from this repo:**
1. Whether the MCP service received the correct candle values from our endpoint
2. Whether the inflation occurred in: HTTP response parsing, candle-to-market-structure conversion, scanner price computation, or setup serialization
3. Whether the MCP service is calling the correct VCP Trader production URL (vs a stale/legacy URL)

**→ §16 MCP Follow-Up Prompt covers these items.**

---

## 6. Price Integrity Trace

**Code:** `server/routes/ask.ts:956–1044`

### Execution path

After `runMultiStrategyAnalysis` returns `multiStrategy`:

```
multiStrategy.marketContext?.price          = 893.5  (from MCP)
ctx.tickers.find(sym)?.last                 = 89.35  (live broker quote, when connected)
  OR TwelveDataDailyProvider latest close   = 89.35  (history fallback, when disconnected)

resolveReferencePrice("MU", 89.35, { fetchHistory: ... })
  → { source: "broker_quote", referencePrice: 89.35, conflict: false }

checkPriceIntegrity(893.5, 89.35, "broker_quote")
  → ratio = 893.5 / 89.35 = 10.0
  → 8 ≤ 10.0 ≤ 12  →  ratioCategory: "10x"
  → { valid: false, code: "PRICE_REFERENCE_MISMATCH", ratioCategory: "10x" }
```

**Log emitted (server-side only):**
```json
{
  "event": "multi_strategy_price_integrity_failed",
  "symbol": "MU",
  "code": "PRICE_REFERENCE_MISMATCH",
  "ratioCategory": "10x",
  "setupPrice": 893.5,
  "referencePrice": 89.35
}
```

**Observability log:**
```json
{
  "event": "price_reference_resolved",
  "symbol": "MU",
  "source": "broker_quote",
  "freshness": "fresh",
  "validationResult": "PRICE_REFERENCE_MISMATCH",
  "ratioCategory": "10x",
  "durationMs": ...
}
```

### Attachment (line 1041)

```ts
multiStrategy = { ...multiStrategy, priceIntegrity: safeIntegrityResult(rawResult) };
//                                   ^--- spread reassigns the local `multiStrategy` variable
//                                        safe result: setupPrice and referencePrice stripped
```

**Result attached to `multiStrategy`:**
```json
{
  "valid": false,
  "code": "PRICE_REFERENCE_MISMATCH",
  "ratioCategory": "10x",
  "referenceSource": "broker_quote",
  "affectedFields": ["currentPrice", "trigger", "invalidation", "technicalObjective", "resistance", "majorHigh"]
}
```

**Price integrity verdict: Executes correctly. `priceIntegrity` is correctly computed and attached.**

---

## 7. GPT Payload Trace

### "Analyze MU" intent classification

`classifyBrainIntent("Analyze MU", ["MU"])` → `"ANALYZE_SYMBOL"` (line 150, intent-classifier.ts)

`"ANALYZE_SYMBOL"` is **NOT** in `BRAIN_AUTHORITATIVE_INTENTS` (which contains only: RANK_MARKET_TRADES, PLAN_PORTFOLIO_TRADE, RECOMMEND_SYMBOL_TRADE, COMBINED_ANALYSIS_RECOMMENDATION, EDUCATION_PLUS_ACTION).

Therefore: `generateAiAnswer` is called directly (not through the brain builder path).

### userContent (line 1080–1099)

`userContent` is built **after** priceIntegrity is attached at line 1041. The `multiStrategy` variable used at line 1087 is the post-integrity version.

```ts
const userContent = JSON.stringify({
  question,
  context: compact,
  ...(multiStrategy ? { multiStrategyAnalysis: multiStrategy } : {}),
  //                                            ^--- post-integrity multiStrategy
});
```

**Critical finding: The inflated prices (893.5, 1255.00, 737.88) ARE present in `userContent` sent to GPT**, embedded inside `multiStrategyAnalysis.marketContext.price`, `primarySetup.setup.trigger.price`, etc. The `priceIntegrity: { valid: false, ... }` is also present in the payload.

### GPT system rules (lines 1135–1144)

```ts
mcpTools = [];   // ← no live tool calls allowed
mcpSystemRules += `\n- The "multiStrategyAnalysis" field ... do not call any tools.`;

if (multiStrategy.priceIntegrity?.valid === false) {
  mcpSystemRules += ` PRICE INTEGRITY OVERRIDE (code: PRICE_REFERENCE_MISMATCH, category: 10x):
    YOU MUST NOT mention, repeat, reconstruct, approximate, or infer any trigger,
    invalidation, objective, resistance, major-high, or price-level value from the payload.
    ...
    Instead state exactly: "Price-level evidence could not be independently validated..."`;
}
```

**Finding:** The PRICE INTEGRITY OVERRIDE instruction is appended to the system prompt. It correctly fires when `priceIntegrity.valid === false`. The instruction prohibits GPT from repeating price levels.

**Secondary vulnerability:** The inflated prices are still IN the user content. GPT suppression relies on LLM compliance with the system instruction, not on data stripping. A model that partially complies or mishandles the instruction could still surface inflated values in its prose output. The system instruction is the only guard between the inflated payload and the user's screen on the GPT side.

---

## 8. Attachment Preservation Trace

Tracing the `multiStrategy` variable from attachment through to the final response:

| Line | Action | priceIntegrity present? |
|---|---|---|
| 939 | `multiStrategy = await msa.runMultiStrategyAnalysis(...)` | No — just returned from MCP |
| 1041 | `multiStrategy = { ...multiStrategy, priceIntegrity: safeIntegrityResult(rawResult) }` | **Yes — attached here** |
| 1087 | `userContent = JSON.stringify({ ..., multiStrategyAnalysis: multiStrategy })` | ✓ Yes |
| 1142 | `if (multiStrategy.priceIntegrity?.valid === false)` — integrity rule fires | ✓ Yes |
| 1252–1253 | `confidence = multiStrategyConfidence(multiStrategy)` | ✓ Yes — confidence is "low" (priceIntegrity guard) |
| 1327 | `return { ..., multiStrategyAnalysis: multiStrategy }` | ✓ Yes |

**Verdict: No object boundary drops `priceIntegrity`. The variable is correctly reassigned at line 1041 and the same post-integrity object is used at every subsequent point. Integrity result is NOT lost.**

No intermediate clone, serialization, or partial-object construction loses the field.

---

## 9. React Rendering Trace

**Component:** `client/src/components/multi-strategy-analysis-cards.tsx`

```ts
// line 163
const integrityFailed = a.priceIntegrity?.valid === false;

// line 167
{integrityFailed && <IntegrityWarning symbol={a.symbol} />}

// line 207–217
{integrityFailed ? (
  <div data-testid="section-msa-price-suppressed">
    Price-level analysis unavailable
  </div>
) : (
  // trigger / invalidation / objective grid
)}
```

**Verdict:** React rendering correctly checks `priceIntegrity.valid === false` before displaying price-derived levels. The integrity banner and field suppression are correctly implemented.

---

## 10. ResearchSave Verification

### For "Analyze MU" (ANALYZE_SYMBOL intent)

`ANALYZE_SYMBOL` is not in `BRAIN_AUTHORITATIVE_INTENTS`. The ResearchSave minting code at lines 1730–1763 is inside the brain-authoritative path and is never reached for ANALYZE_SYMBOL.

**ResearchSave is never minted for a pure "Analyze MU" request** — regardless of integrity. The integrity gate at line 1738 (`!_priceIntegrityBlocked && brainInt !== "MARKET_RESEARCH" && ...`) only applies to brain-authoritative intents.

### For "Analyze MU and recommend a trade" (COMBINED_ANALYSIS_RECOMMENDATION intent)

This intent IS in `BRAIN_AUTHORITATIVE_INTENTS`. For this flow:

```ts
const _priceIntegrityBlocked = multiStrategy?.priceIntegrity?.valid === false;
if (!_priceIntegrityBlocked && brainInt !== "EDUCATION_PLUS_ACTION" && ...) {
  // mint handle
}
```

When integrity fails (`priceIntegrity.valid === false`): `_priceIntegrityBlocked = true` → handle NOT minted → `researchSave` absent from response → Save button does not render.

**ResearchSave gating verdict: Correct for combined-analysis-recommendation requests. Not reached for pure "Analyze MU" requests (which is fine — no save is minted either way).**

---

## 11. First Failure Identification

**Answer: D — MCP HTTP adapter or scanner transforms values**

Evidence chain:

| Stage | Price value | Source of truth |
|---|---|---|
| Twelve Data API | ~89.xx | Provider — `parseNum` is a raw parse, no scale |
| VCP Trader provider (`TwelveDataDailyProvider`) | ~89.xx | Confirmed: `close: b.close`, direct field copy |
| `/api/internal/market/history` response body | ~89.xx | Confirmed: `close: b.close`, direct field copy |
| MCP service receives from VCP Trader | ~89.xx (asserted) | Cannot inspect; requires MCP-side verification |
| MCP `scan_strategy` response to VCP Trader | ~893.5 | Confirmed: `multiStrategy.marketContext.price ≈ 893.5` |

The inflation is 10× and consistent with a decimal-point error in the MCP service — likely: the MCP's candle parser, internal market-structure builder, or setup price computation multiplies by 10 or misinterprets a field unit. The exact sub-stage (HTTP adapter parsing vs market-structure derivation vs scanner output) requires inspection of the MCP service code.

**The VCP Trader stack is correct at every stage we can verify.** The failure is owned by the vcp-trader-mcp service.

**Secondary vulnerability confirmed (not a first failure, but a gap):** When integrity fails, inflated prices are still in the GPT user content. The PRICE INTEGRITY OVERRIDE rule is the only guard — if GPT mishandles it, inflated values reach the user's prose. This is a defense-in-depth gap, not the root cause.

---

## 12. Smallest Fix

### Primary fix (in MCP service — not this repo)

Locate where the MCP service parses VCP Trader's `/api/internal/market/history` candle JSON and computes `currentPrice`. Compare the computed value to the raw close. The 10× error is most likely one of:

- Multiplying by 10 (e.g., converting "cents to dollars" when VCP Trader already sends dollars)
- Using the wrong field (e.g., reading `volume` or a different field instead of `close`)
- Applying an internal "pence to pounds" or "basis points" conversion not appropriate for equities
- Incorrectly applying a percentage-return field as an absolute price

**No code change required in VCP Trader for the primary fix.**

### Secondary fix (in VCP Trader — this repo)

Strip the affected price fields from the `multiStrategyAnalysis` payload sent in `userContent` to GPT when `priceIntegrity.valid === false`, rather than relying solely on a GPT instruction to ignore them. Currently the inflated prices are in the payload and GPT compliance is the only guard.

Minimum change: in `ask.ts` around line 1087, when `multiStrategy.priceIntegrity?.valid === false`, create a sanitized copy before including it in `userContent`:

```ts
// Pseudocode — not to be implemented without approval
const multiStrategyForGpt = multiStrategy.priceIntegrity?.valid === false
  ? stripPriceFields(multiStrategy)   // remove trigger/invalidation/objective/currentPrice from setup objects
  : multiStrategy;
```

This is defense-in-depth: the PRICE INTEGRITY OVERRIDE instruction stays, but the prices being instructed away no longer exist in the payload.

---

## 13. Regression Tests Required Before Production

Before deploying any MCP fix to production, confirm these pass end-to-end:

1. **Correct-scale round-trip:** A `scan_strategy` call for MU (or any symbol) with a known close of `C` returns `currentPrice` within ±15% of `C`. Verify at the MCP `scan_strategy` output level.

2. **Integrity check fires on 10× setup:** `checkPriceIntegrity(10 * C, C)` → `{ valid: false, ratioCategory: "10x" }`. (Already covered in price-integrity-checker.test.ts suite A.)

3. **Integrity check passes on correct setup:** `checkPriceIntegrity(C * 1.05, C)` → `{ valid: true, ratioCategory: "ok" }`.

4. **priceIntegrity preserved to response:** When `scan_strategy` returns inflated prices AND integrity check fires, the final HTTP response from `/api/ask` includes `multiStrategyAnalysis.priceIntegrity.valid === false`.

5. **Price levels suppressed in React:** When `priceIntegrity.valid === false`, the trigger/invalidation/objective grid is NOT rendered; the integrity warning banner IS rendered.

6. **GPT PRICE INTEGRITY OVERRIDE rule fires:** When `priceIntegrity.valid === false`, the `mcpSystemRules` string contains "PRICE INTEGRITY OVERRIDE" and does NOT contain any of the inflated price values.

7. **No researchSave when integrity fails (COMBINED_ANALYSIS_RECOMMENDATION):** For "Analyze MU and recommend a trade" with inflated MCP prices, the response does not contain `researchSave`.

8. **Disconnected user — history fallback fires:** When `ctx.tickers[0].last` is null but TwelveDataDailyProvider returns a valid close, `resolved.source === "internal_history_close"` and the integrity check runs against the history close.

9. **MCP not called extra times:** Verify no additional `scan_strategy` calls are made during integrity checking (the reference price comes from TwelveDataDailyProvider directly, not a re-scan).

10. **Confidence is low when integrity fails:** `multiStrategyConfidence({ ..., priceIntegrity: { valid: false } })` → `"low"`. (Already covered in multi-strategy-analysis.test.ts suite D03.)

---

## 16. MCP Follow-Up Prompt

The following items cannot be determined from the VCP Trader repository and require inspection of the `vcp-trader-mcp` service:

```
Verify these 5 items in the vcp-trader-mcp service for the "scan_strategy" tool
when called with symbol=MU:

1. HTTP RESPONSE RECEIVED FROM VCP TRADER
   Call GET <VCP_TRADER_INTERNAL_URL>/api/internal/market/history?symbol=MU&interval=1day&outputSize=120
   Capture the raw JSON body. Confirm whether the latest candle close is ~89.xx or ~893.xx.

2. PARSED CANDLE VALUES
   After the HTTP response is parsed into internal candle objects, capture:
   - close value of the latest completed candle
   - field name used as the close (confirm it maps to the "close" JSON key, not "open" or "volume")

3. MARKET STRUCTURE DERIVATION
   After candles are converted to the internal market structure representation,
   capture the "current price" or equivalent field. Confirm whether it equals
   the parsed close (89.xx) or has been transformed.

4. SCANNER INPUT
   Capture the price values passed INTO the VCP/strategy scanner.
   Confirm whether 89.xx or 893.xx enters the scanner.

5. SETUP SERIALIZATION
   Capture the currentPrice, trigger.price, invalidation.price, and objective.price
   in the scan_strategy tool output BEFORE it is serialized for the MCP response.

For each stage, state whether the price is ~89.xx (correct) or ~893.xx (10×).
Identify the FIRST stage where 893.xx appears.
Do NOT fix anything — diagnostic only.
```

---

## Verdict

**CONDITIONAL_GO**

**Rationale:**

- VCP Trader's internal pipeline is architecturally correct. Every stage we can inspect from this repo handles MU prices correctly. The price integrity check fires, attaches correctly, propagates to the response, gates the React display, and gates the GPT system rules.

- The primary failure is in the MCP service. VCP Trader cannot fix it — the MCP service must be diagnosed and patched.

- A secondary defense-in-depth gap exists: inflated prices are still in the GPT user content even when integrity fails. The PRICE INTEGRITY OVERRIDE instruction is the only guard. This should be addressed (strip affected fields from the GPT payload) independently of the MCP fix.

- Until the MCP fix is deployed and verified by the regression tests in §13, production analysis for MU (and any symbol the MCP inflates) will: show the integrity warning banner, suppress price levels in the React card, serve medium/low confidence, and block GPT from repeating the inflated values — but the inflated values will still be in the payload sent to GPT.

**GO** condition: MCP fixes the inflation AND VCP Trader's secondary fix (strip price fields from GPT payload) is implemented and all regression tests pass.
