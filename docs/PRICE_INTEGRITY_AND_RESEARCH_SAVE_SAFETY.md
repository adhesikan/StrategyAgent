# Price Integrity and Research-Save Safety

**Status:** Implemented (Task #40 — Broker-Independent Reference)  
**Scope:** Multi-strategy analysis only (VCP explicit path unchanged)

---

## 1. Source Authority

| Data | Authoritative Source | Used For |
|---|---|---|
| Latest OHLCV history | `TwelveDataDailyProvider` via `/api/internal/market/history` | Historical analysis, VCP structure |
| Live quote (current price) | `ctx.tickers[n].last` — broker/market-snapshot quote | **Primary reference for integrity check** |
| Internal history close | `TwelveDataDailyProvider.getDailyBars` (direct, no HTTP hop) | **Fallback reference for disconnected users** |
| MCP setup currentPrice | `scan_strategy` response field | Setup display (gated by integrity check) |
| MCP trigger / invalidation / objective | `scan_strategy` response fields | Level display (suppressed when integrity fails) |
| MCP major high | `scan_strategy` response field | Historical context only — never an entry level |

---

## 2. Source Precedence

After `runMultiStrategyAnalysis` completes, `ask.ts` calls `resolveReferencePrice()` which implements deterministic precedence:

```
Priority 1: Connected-broker / market-snapshot live quote  (source: "broker_quote")
Priority 2: Latest valid close from TwelveDataDailyProvider (source: "internal_history_close")
Priority 3: No reference available                          (source: "unavailable")
```

### Source Independence Caveat

Both the MCP scanner and the VCP Trader internal history may ultimately use **Twelve Data** as the underlying market-data vendor. This check is therefore a **cross-SERVICE consistency check** (MCP pipeline vs VCP Trader pipeline), **not** a fully independent vendor check. It still catches:

- MCP-side decimal scaling bugs
- Serialization or transformation errors between provider and MCP
- Stale setup-cache values in the MCP service

Do not claim full vendor independence — the same raw data may flow through both sides.

---

## 3. Reference Resolution Logic

```
resolveReferencePrice(symbol, quotePrice, { fetchHistory }) → ResolvedReference
```

### Decision matrix

| quotePrice valid? | historyClose valid? | Result |
|---|---|---|
| ✓ | ✓ (ratio ≤ ±40%) | `source: "broker_quote"` — broker preferred (more current) |
| ✓ | ✓ (ratio > ±40%) | `conflict: true, source: "unavailable"` → PRICE_REFERENCE_CONFLICT |
| ✓ | ✗ | `source: "broker_quote"` |
| ✗ | ✓ | `source: "internal_history_close"` |
| ✗ | ✗ | `source: "unavailable"` |

"Valid" for the broker quote: non-null, finite, positive.  
"Valid" for a history bar: finite close > 0, not future-dated.

---

## 4. Freshness Policy

Used for `source: "internal_history_close"` only. Calendar-day based (no market calendar lookup required).

| Category | Age of latest valid close | Notes |
|---|---|---|
| `fresh` | 0–1 calendar days | Same or previous trading day |
| `acceptable` | 2–5 calendar days | Covers weekends and short holidays |
| `stale` | > 5 calendar days | Still used as reference — not an automatic block |
| `unknown` | Could not parse date | Treated as unavailable |

**Weekend handling:** A Friday close is `acceptable` on Saturday or Sunday. The resolver does not require a market calendar.

**Stale close:** A close older than 5 calendar days is still returned as the reference price with `freshness: "stale"`. The save-gating decision is based on the ratio check, not freshness alone. Staleness is surfaced via the `price_reference_resolved` log event.

### Known limitations

- **Large overnight gaps:** A legitimate >15% gap between today's quote and yesterday's close will fail the setup-vs-reference check even when both prices are correct. This is a documented false-positive risk for highly volatile stocks.
- **Corporate actions:** Splits and dividend adjustments may cause a temporary ratio anomaly between live quote and adjusted historical close.
- **Intraday setup:** The history close is a completed-day value. An MCP setup priced at the intraday level may legitimately differ from the prior close by >15% on gap days.

---

## 5. Conflict Handling

When both broker quote and internal history close are available but their ratio exceeds ±40%:

```
code: "PRICE_REFERENCE_CONFLICT"
```

**Actions:**
- `priceIntegrity.valid = false`
- ResearchSave handle is NOT minted
- Price-derived levels suppressed in the analysis card
- GPT receives `PRICE INTEGRITY OVERRIDE` instruction
- Confidence capped at `"low"`
- Server log: `event: multi_strategy_price_integrity_failed, code: PRICE_REFERENCE_CONFLICT`

The ±40% conflict threshold is intentionally wider than the setup ±15% tolerance to avoid false conflicts from large-gap days while still catching decimal-order broker/history discrepancies (2×, 10×).

---

## 6. Ratio Thresholds (Setup vs Reference)

These apply after the reference is resolved:

| Category | Ratio range (setup/ref) | Direction |
|---|---|---|
| `ok` | 0.85–1.15 | setup ≈ reference (±15%) |
| `10x` | 8–12 | setup >> reference |
| `100x` | 80–120 | setup >> reference |
| `0.1x` | inverse 8–12 | setup << reference |
| `0.01x` | inverse 80–120 | setup << reference |
| `divergent` | outside tolerance, not a clean decimal order | either direction |

Raw `setupPrice` and `referencePrice` are logged server-side only (event: `multi_strategy_price_integrity_failed`). They are **never** forwarded to the client.

---

## 7. Save-Handle Gating

A ResearchSave handle is **NOT** minted when:

| Condition | Code | Action |
|---|---|---|
| `resolved.conflict === true` | `PRICE_REFERENCE_CONFLICT` | Gate fires — handle omitted |
| `priceIntegrity.valid === false` | any | Gate fires — handle omitted |
| Structural validation fails | `VALIDATION_ERROR` | Already blocked by `validateResearchEvidence` |
| `brainInt` is education-only | — | Handle omitted (existing rule) |

When the gate fires, `researchSave` is omitted from the response entirely. The integrity warning in the analysis card explains why saving is not available. No partial snapshot containing suspect price levels is persisted.

**Frontend behaviour:** `SaveResearchButton` only renders when `data.researchSave?.available === true`. When the field is absent, the button is hidden — no client override is possible.

---

## 8. Field Suppression

When `priceIntegrity.valid === false` (any code):

**Server-side (GPT prompt):** A `PRICE INTEGRITY OVERRIDE` instruction is appended to `mcpSystemRules`. GPT is explicitly prohibited from:
- Repeating, approximating, or inferring any numeric price level
- Using "approximately" with any price
- Overriding or softening the deterministic verdict

GPT must state verbatim: *"Price-level evidence could not be independently validated, so the platform withheld trigger, invalidation and objective levels."*

**Client-side (analysis card):** When `analysis.priceIntegrity?.valid === false`:
- The `IntegrityWarning` banner is shown above the card
- Count breakdown is still shown (non-price evidence)
- Primary setup's trigger / invalidation / objective grid → "Price-level analysis unavailable"
- `SaveResearchButton` not rendered (no `researchSave` in response)
- Trade Builder CTA suppressed by NO_TRADE / WATCH verdict

---

## 9. Confidence Policy

`multiStrategyConfidence(a)` returns `"low" | "medium" | "high"`.

### LOW when any of:
- `strategiesChecked === 0` or all scans failed
- `overallVerdict === "INSUFFICIENT_DATA"`
- `!dataQuality.realMarketData` (mock/synthetic source)
- `strategiesFailed > succeeded` (most strategies failed)
- `priceIntegrity.valid === false` ← blocks high confidence on failed integrity

### HIGH requires ALL of:
- `succeeded >= 3`
- `dataQuality.fresh === true`
- `dataQuality.complete === true`
- `(confirmingCount + formingCount) > 0` — at least one setup with a real status
- `unavailableCount <= strategiesMatched / 2` — majority must not be Unknown-status

### MEDIUM: everything else.

---

## 10. Strategy-Count Semantics

| Field | Meaning |
|---|---|
| `strategiesChecked` | Number of eligible strategies attempted |
| `strategiesFailed` | Tool call failed or timed out |
| `confirmingCount` | Setups with `status = triggered / breakout / ready` |
| `formingCount` | Setups with `status = forming` |
| `rejectedCount` | Setups where `candidateCheck.status === "NO_TRADE"` |
| `unavailableCount` | Setups with `status = null / empty / unknown` |

The old "X matches" / "X strategies checked" badges are replaced by the `CountBreakdown` component.

---

## 11. Observability

### Resolved reference log (`price_reference_resolved`)

Emitted on every multi-strategy analysis with integrity check enabled.

```json
{
  "event": "price_reference_resolved",
  "symbol": "MU",
  "source": "internal_history_close",
  "freshness": "fresh",
  "validationResult": "ok",
  "ratioCategory": null,
  "durationMs": 142
}
```

Safe fields only. No raw prices, no account identifiers, no full history.

### Integrity failure log (`multi_strategy_price_integrity_failed`)

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

For `PRICE_REFERENCE_CONFLICT`:
```json
{
  "event": "multi_strategy_price_integrity_failed",
  "symbol": "MU",
  "code": "PRICE_REFERENCE_CONFLICT",
  "brokerPrice": 200.0,
  "historyClose": 100.0,
  "historyTimestamp": "2026-08-04"
}
```

Alert on:
- Repeated `ratioCategory: "10x"` or `"100x"` for the same symbol → likely MCP scaling regression
- `PRICE_REFERENCE_CONFLICT` — broker and history disagree materially
- `PRICE_REFERENCE_UNAVAILABLE` spike → market snapshot route may be failing
- `source: "internal_history_close"` for many users → possible broker disconnection event

---

## 12. Performance and Caching

Within one Ask AI request:
- `fetchHistory` is called at most once per symbol (the resolver is called once; its `fetchHistory` dep is called once)
- `TwelveDataDailyProvider` has its own in-flight deduplication (`inFlight` Map in twelve-data-client.ts) — repeated calls for the same symbol within the same event loop are deduplicated automatically
- `outputSize: 5` — minimum needed to reliably identify the latest completed bar

No long-lived price cache is introduced.

---

## 13. Disconnected-User Before / After

| Scenario | Before (Task #40 absent) | After (Task #40) |
|---|---|---|
| No broker, no market snapshot | `PRICE_REFERENCE_UNAVAILABLE` → save blocked always | History close fetched → save allowed when prices consistent |
| No broker, history matches setup (±15%) | Blocked | **Allowed** — `source: "internal_history_close"` |
| No broker, setup 10× inflated | Blocked | **Still blocked** — history detects 10× mismatch |
| Broker connected | No change | Broker quote used (same as before) |
| Broker + history conflict | Not checked | **New** — `PRICE_REFERENCE_CONFLICT` detected |
