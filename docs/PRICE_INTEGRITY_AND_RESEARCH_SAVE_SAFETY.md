# Price Integrity and Research-Save Safety

**Sprint:** Production Safety Fix  
**Status:** Implemented  
**Scope:** Multi-strategy analysis only (VCP explicit path unchanged)

---

## 1. Source Authority

| Data | Authoritative Source | Used For |
|---|---|---|
| Latest OHLCV history | `TwelveDataDailyProvider` via `/api/internal/market/history` | Historical analysis, VCP structure |
| Live quote (current price) | `ctx.tickers[0].last` — broker/market-snapshot quote | **Reference price for integrity check** |
| MCP setup currentPrice | `scan_strategy` response field | Setup display (gated by integrity check) |
| MCP trigger / invalidation / objective | `scan_strategy` response fields | Level display (suppressed when integrity fails) |
| MCP major high | `scan_strategy` response field | Historical context only — never an entry level |

**Rule:** The MCP setup price is NOT independently authoritative when it originated from VCP Trader market-history data. The live quote from `ctx.tickers[0].last` (fetched independently from the broker/market-snapshot route) is the reference.

---

## 2. Independent Reference Policy

After `runMultiStrategyAnalysis` completes, `ask.ts` runs an independent price cross-check:

```
referencePrice = ctx.tickers[0].last        (VCP Trader live quote)
setupPrice     = multiStrategy.marketContext?.price
              ?? multiStrategy.primarySetup?.setup.currentPrice
              ?? null

result = checkPriceIntegrity(setupPrice, referencePrice, "live_quote")
```

The result (`PriceIntegrityResult`) is stripped of raw price values via `safeIntegrityResult()` and attached to `multiStrategy.priceIntegrity` before the payload is used anywhere (GPT prompt, response serialization, researchSave gating).

When reference price is unavailable (no live quote for disconnected users), `code: "PRICE_REFERENCE_UNAVAILABLE"` — valid:false. In that case the save is blocked but no false "10x" alarm is raised.

---

## 3. Ratio Thresholds

| Category | Ratio range | Direction |
|---|---|---|
| `ok` | 0.85 – 1.15 | setup ≈ reference (±15%) |
| `10x` | 8 – 12 | setup >> reference |
| `100x` | 80 – 120 | setup >> reference |
| `0.1x` | inverse 8 – 12 | setup << reference |
| `0.01x` | inverse 80 – 120 | setup << reference |
| `divergent` | outside tolerance, not a clean decimal order | either direction |
| `unknown` | reserved | — |

±15% tolerance accounts for intraday movement, bid/ask spread, rounding differences, and brief delayed-data lag between the quote source and the history close.

Raw `setupPrice` and `referencePrice` are logged server-side only (event: `multi_strategy_price_integrity_failed`). They are NEVER forwarded to the client.

---

## 4. Save-Handle Gating

A ResearchSave handle is NOT minted when:

| Condition | Code | Action |
|---|---|---|
| `multiStrategy.priceIntegrity?.valid === false` | any | Gate fires — handle omitted from response |
| Structural validation fails | VALIDATION_ERROR | Already blocked by `validateResearchEvidence` |
| `brainInt` is education-only | — | Handle omitted (existing rule) |

When the gate fires, `researchSave` is omitted from the response entirely. The integrity warning in the analysis card explains to the user why saving is not available. No partial snapshot containing suspect price levels is persisted.

**Frontend behaviour:** `SaveResearchButton` only renders when `data.researchSave?.available === true`. When the field is absent, the button is hidden — no client override is possible.

---

## 5. Field Suppression

When `priceIntegrity.valid === false`:

**Server-side (GPT prompt):** A `PRICE INTEGRITY OVERRIDE` instruction is appended to `mcpSystemRules`. GPT is explicitly prohibited from:
- Repeating, approximating, or inferring any numeric price level
- Describing the setup as if price levels were evaluated
- Overriding or softening the deterministic verdict

GPT must state verbatim: *"Price-level evidence could not be independently validated, so the platform withheld trigger, invalidation and objective levels."*

**Client-side (analysis card):** When `analysis.priceIntegrity?.valid === false`:
- The `IntegrityWarning` banner is shown above the card
- The `CountBreakdown` is still shown (non-price evidence)
- The primary setup's trigger / invalidation / objective grid is replaced with a `"Price-level analysis unavailable"` notice
- The `SaveResearchButton` is not rendered (no `researchSave` in the response)
- Trade Builder CTA is suppressed by the NO_TRADE / WATCH verdict in `suggestionsForMultiStrategy`

---

## 6. Confidence Policy

`multiStrategyConfidence(a)` returns `"low" | "medium" | "high"`.

### LOW when any of:
- `strategiesChecked === 0` or all scans failed
- `overallVerdict === "INSUFFICIENT_DATA"`
- `!dataQuality.realMarketData` (mock/synthetic source)
- `strategiesFailed > succeeded` (most strategies failed)
- `priceIntegrity.valid === false` ← **new**

### HIGH requires ALL of:
- `succeeded >= 3` (at least 3 strategies returned results)
- `dataQuality.fresh === true` (at least one setup within 10-day window)
- `dataQuality.complete === true` (primary has trigger+invalidation or qualified candidate)
- `(confirmingCount + formingCount) > 0` ← **new: at least one setup with a real status**
- `unavailableCount <= strategiesMatched / 2` ← **new: majority must not be Unknown-status**

### MEDIUM: everything else.

**Rationale:** The previous policy allowed HIGH when all 10 strategies returned setups with `status: null` ("Unknown"). Receiving setup objects from the scanner is not the same as having meaningful confirmed or forming setups. HIGH confidence now requires at least one setup with an actionable status.

---

## 7. Strategy-Count Semantics

Previous label "X matches" meant "responses that returned a non-null setup object." This conflated receipt of a response with confirmation of a meaningful setup.

### New fields on `MultiStrategyAnalysis`:

| Field | Meaning |
|---|---|
| `strategiesChecked` | Number of eligible strategies attempted |
| `strategiesFailed` | Tool call failed or timed out |
| `confirmingCount` | Setups with `status = triggered / breakout / ready` |
| `formingCount` | Setups with `status = forming` |
| `rejectedCount` | Setups where `candidateCheck.status === "NO_TRADE"` |
| `unavailableCount` | Setups with `status = null / empty / unknown` |

These counts are independent — a setup can appear in multiple buckets (e.g., a "triggered" setup with a NO_TRADE candidate contributes to both `confirmingCount` and `rejectedCount`).

### UI display (analysis card):

```
10 strategies evaluated  |  0 confirming  ·  0 forming  ·  2 rejected  ·  8 unavailable
```

The old "X matches" / "X strategies checked" badges are replaced by the `CountBreakdown` component.

---

## 8. GPT Safety

### When integrity passes:
Existing rules apply. GPT explains the deterministic payload only; it may not invent levels, scores, or strategy matches not in the payload.

### When integrity fails (`priceIntegrity.valid === false`):
The `PRICE INTEGRITY OVERRIDE` instruction is appended:
- GPT is prohibited from mentioning any price level by name or approximation
- GPT is prohibited from suggesting levels can be inferred
- GPT must state the withheld-levels explanation verbatim
- GPT may not override, soften, or re-classify the `overallVerdict`

---

## 9. Known Limitations

| Limitation | Impact |
|---|---|
| Reference price requires a live quote (`ctx.tickers[0].last`). Disconnected users have no quote → `PRICE_REFERENCE_UNAVAILABLE` → save blocked | Disconnected users cannot save multi-strategy research even when prices are correct |
| The integrity check detects decimal-order mismatches and ±15% divergence, but cannot distinguish a legitimate volatility gap from a data error | A large intraday gap (>15%) for a volatile stock would be flagged as `divergent` |
| The check compares only `marketContext.price` or `primarySetup.currentPrice` — not every supporting setup's price | Supporting setups with incorrect prices (but primary correct) would pass |
| Integrity result is point-in-time — if the quote changes between check and client render, the flag may be stale | 10-minute TTL on ResearchSave handles mitigates stale-integrity saves |

---

## 10. Production Monitoring

Log event: `multi_strategy_price_integrity_failed`

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

Alert on:
- Repeated `ratioCategory: "10x"` or `"100x"` for the same symbol → likely MCP scaling regression
- `ratioCategory: "divergent"` spikes → investigate market data provider outage
- `code: "PRICE_REFERENCE_UNAVAILABLE"` for symbols with active quotes → market snapshot route may be failing
