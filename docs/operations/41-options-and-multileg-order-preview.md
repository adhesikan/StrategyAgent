# 41 — Options & Multi-Leg Order Preview

**Sprint:** 2.8.3  
**Status:** ACTIVE  
**Category:** Execution Architecture — Read-Only Preview  
**Prerequisite:** Sprint 2.8.2 (Equity Order Preview)

---

## 1. Purpose

Options Order Preview is a **read-only representation** of the exact option structure the user selected upstream and prepared as a non-executable OrderDraft. It assembles current market context — quotes, liquidity, Greeks, freshness, risk context, lifecycle state — alongside the immutable user-selected parameters.

**Options Order Preview may NEVER:**
- Change the user's broad expression
- Change the selected strategy family
- Change the selected contract candidate
- Replace a contract, change expiration, strike, ratio, or quantity
- Change broker account or draft pricing preference
- Decompose a multi-leg structure into separately submitted legs
- Submit an order

Any such change requires explicit upstream user action and revalidation.

---

## 2. Permanent Architecture Invariant

```
executable: false — type-level guard, always false, never removable.
selectedBy: "USER" — always read from Trade Plan, never from client.

Pipeline:
  Trade Plan → Execution Preflight → Order Draft → Options Preview
                                                    ^^^^^^^^^^^
                                              This service (2.8.3)

Next (2.8.4): Execution Validation Hardening
Then (2.8.5): Explicit Confirmation + Broker Submission (BLOCKED until 2.8.4 GO)
```

---

## 3. Supported Strategies

| Family | Category | Legs | Notes |
|---|---|---|---|
| `long_call` | Directional Bullish | 1 | Long call premium paid |
| `long_put` | Directional Bearish | 1 | Long put premium paid |
| `covered_call` | Income | 1 | Share coverage required |
| `cash_secured_put` | Income | 1 | Cash-secured capital context |
| `protective_put` | Protective | 1 | Long put on existing shares |
| `collar` | Protective | 2 | Long put + short covered call |
| `bull_call_spread` | Directional Bullish | 2 | Long low-strike + short high-strike call |
| `bear_put_spread` | Directional Bearish | 2 | Long high-strike + short low-strike put |
| `bull_put_spread` | Income | 2 | Short high-strike + long low-strike put |
| `bear_call_spread` | Income | 2 | Short low-strike + long high-strike call |
| `iron_condor` | Neutral / Range-Bound | 4 | 2 puts + 2 calls; 4-leg |
| `iron_butterfly` | Neutral / Range-Bound | 4 | Short ATM straddle + long wings |
| `long_straddle` | Volatility | 2 | Long ATM call + put |
| `long_strangle` | Volatility | 2 | Long OTM call + put |
| `calendar_spread` | Neutral | 2 | Multiple expirations; path-dependent |
| `diagonal_spread` | Directional | 2 | Different strikes + expirations; path-dependent |

---

## 4. Canonical Model — `OptionsOrderPreview`

```typescript
interface OptionsOrderPreview {
  readonly executable: false;          // ALWAYS false — type-level guard
  id: string;
  userId: string;
  tradePlanId: string;
  tradePlanVersion: number;
  preflightId: string;
  orderDraftId: string;
  orderDraftVersion: number;
  broadExpressionType: string;         // from Trade Plan — never changed
  selectedBy: "USER";                  // always USER
  strategyFamily: OptionsStrategyFamily; // from OrderDraft — never changed
  strategyLabel: string;
  instrumentType: "OPTION" | "MULTI_LEG_OPTION";
  symbol: string;
  generatedAt: string;
  validUntil: string;
  status: OptionsPreviewStatus;
  broker: OptionsPreviewBrokerContext;
  expirationContext: ExpirationContext;
  legs: OptionsPreviewLeg[];           // immutable from OrderDraft
  quantityContext: { confirmedQuantity: number; unit: "contracts"; ... };
  orderType: string;
  timeInForce: string;
  netStructurePricing: NetStructurePricing;
  quoteFreshness: OptionsQuoteFreshness;
  liquidityContext: OptionsLiquidityContext;
  riskContext: OptionsPreviewRiskContext;
  assignmentExerciseContext: AssignmentExerciseContext;
  eventContext: OptionsEventContext;
  blockers: OptionsPreviewBlocker[];
  warnings: OptionsPreviewWarning[];
  sourceIntegrity: OptionsPreviewSourceIntegrity;
  disclaimer: string;                  // mandatory
  executionPriceDisclaimer: string;    // mandatory
  optionsRiskDisclosure: string;       // mandatory
  midpointDisclaimer: string;          // mandatory
  methodologyVersion: "2.8.3";
}
```

---

## 5. Leg Model — `OptionsPreviewLeg`

Each `OptionsPreviewLeg` contains:
- **Immutable from OrderDraft:** `contractSymbol`, `optionType`, `expiration`, `strike`, `ratio`, `quantity`, `multiplier`, `canonicalIntent`
- **Computed at preview time:** `dte`, `isExpired`, `expirationLabel`
- **Draft quote:** captured at Order Draft creation — labeled "Draft Reference"
- **Current quote:** fetched at preview generation — labeled "Current Mid"
- **Quote change:** `quoteMidpointChangePct`, `quoteChangeCategory`
- **Liquidity:** OI, volume, bid/ask spread, category
- **Greeks:** delta, gamma, theta, vega, rho, IV — all may be null
- **Status:** AVAILABLE / STALE_QUOTE / UNAVAILABLE / EXPIRED
- **Role:** long_leg / short_leg / wing_long / wing_short (from research)

---

## 6. Contract Immutability Rule

The preview engine **never**:
- Substitutes a contract with a "better" one
- Optimizes expiration or strike
- Adjusts quantity
- Decomposes a multi-leg structure

If a contract is unavailable → `CONTRACT_UNAVAILABLE` blocker. The user must return to Contract Research.

---

## 7. Net Debit/Credit Sign Convention

```
Long legs  → DEBIT  (buyer pays premium — positive contribution)
Short legs → CREDIT (seller receives premium — positive contribution)

net = Σ(short_leg_midpoints) - Σ(long_leg_midpoints)

if net >= 0 → CREDIT strategy; pricingType = CREDIT
if net <  0 → DEBIT  strategy; pricingType = DEBIT
amount = |net| — always positive

Multiplier: × 100 (standard US equity options)
amountPerContract = amount × 100
totalAmount = amountPerContract × quantity
```

**All pricing is midpoint estimates.** Midpoint disclaimer: "Net debit/credit values are calculated from current quote references. Actual execution prices may differ materially."

---

## 8. Multi-Leg Capability

Current broker matrix (2026-08-11):
- **Tradier:** `multiLeg = "UNKNOWN"` — no verified native multi-leg spread endpoint
- **TradeStation:** `multiLeg = "UNKNOWN"` — adapter TBD
- **SnapTrade:** `multiLeg = "UNKNOWN"`

When multi-leg capability is not SUPPORTED:
- `MULTI_LEG_NOT_SUPPORTED` warning generated
- **No leg decomposition** — the structure is never split into individual legs
- Read-only preview remains available
- Future execution progression is blocked

**No legging rule:** If a provider cannot submit natively as multi-leg, the structure is not decomposed. This is a permanent policy and is not overridable by any configuration.

---

## 9. API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/execution/order-drafts/:draftId/options-preview` | Generate options preview |
| `GET`  | `/api/execution/order-drafts/:draftId/options-preview` | Get current preview (regenerated ephemerally) |
| `POST` | `/api/execution/order-drafts/:draftId/options-preview/refresh` | Refresh quote context without mutating draft |
| `GET`  | `/api/execution/options-preview/health` | Platform health metrics |

**No /confirm, /submit, /execute, /place, /cancel endpoints exist or will exist before Sprint 2.8.5.**

---

## 10. Client-Injection Block

The following fields may **never** be submitted by the client:

```
strategyFamily, legs, contractSymbol, contracts, strike, strikes,
expiration, expirations, ratio, quantity, account, accountRef,
quote, quotes, bid, ask, netDebit, netCredit, debit, credit,
riskValues, riskData, brokerCapability, broadExpressionType,
selectedBy, tradePlanVersion, preflight, symbol,
forceExecute, skipValidation, bypassPreflight, forceValid, overrideStatus
```

Any request body containing these fields is rejected with HTTP 400 + `code: "FORBIDDEN_FIELD"`.

---

## 11. Preview Status

| Status | Meaning |
|---|---|
| `VALID` | All checks pass; preview is displayable |
| `REQUIRES_REVIEW` | Non-critical blockers — user should review warnings |
| `EXPIRED` | Draft has expired; regenerate |
| `INVALID` | Critical blocker — missing draft, wrong instrument type, contract expired |
| `UNAVAILABLE` | Server-side error or critical dependency missing |

**Forbidden status values:** READY_TO_TRADE, APPROVED, EXECUTION_READY, RECOMMENDED, BEST_STRUCTURE.

---

## 12. Blocker Codes

| Code | Trigger |
|---|---|
| `ORDER_DRAFT_NOT_FOUND` | Draft not found or wrong user |
| `ORDER_DRAFT_EXPIRED` | Draft past expiresAt |
| `ORDER_DRAFT_ABANDONED` | Draft status = ABANDONED |
| `WRONG_INSTRUMENT_TYPE` | Instrument type is EQUITY |
| `WRONG_EXPRESSION_TYPE` | broadExpressionType is STOCK |
| `TRADE_PLAN_NOT_FOUND` | Trade plan missing or wrong user |
| `TRADE_PLAN_VERSION_CHANGED` | Plan version differs from draft |
| `PREFLIGHT_MISSING` | Preflight not found |
| `PREFLIGHT_EXPIRED` | Preflight validUntil in the past |
| `PREFLIGHT_NOT_PASSING` | Preflight status ≠ PASS |
| `LIFECYCLE_THESIS_INVALIDATED` | Lifecycle state = THESIS_INVALIDATED |
| `LIFECYCLE_CHANGED` | Lifecycle state = REQUIRES_REVIEW / CHANGED |
| `CONTRACT_EXPIRED` | Any leg contract is past expiration |
| `CONTRACT_UNAVAILABLE` | Leg contract not resolvable |
| `QUOTE_STALE` | All quotes stale or unavailable |
| `BROKER_DISCONNECTED` | Broker connection unavailable |
| `OPTIONS_PERMISSION_INSUFFICIENT` | Account lacks options permission |
| `INSUFFICIENT_BUYING_POWER` | Buying power check failed |
| `COVERAGE_NOT_CONFIRMED` | Coverage required but unconfirmed |
| `TIF_UNSUPPORTED` | Time-in-force unsupported by provider |

---

## 13. Warning Codes

| Code | Meaning |
|---|---|
| `EXECUTION_DISABLED` | Broker submission disabled globally |
| `QUOTE_MOVED` | Current quote differs materially from draft (≥2%) |
| `QUOTE_STALE_PARTIAL` | Some leg quotes stale |
| `MARKET_CLOSED` | Exchange closed |
| `PRE_MARKET` | Pre-market session |
| `AFTER_HOURS` | After-hours session |
| `PREFLIGHT_EXPIRY_APPROACHING` | Preflight will expire within 5 min |
| `RISK_ANALYSIS_STALE` | Saved risk analysis may be outdated |
| `NEAR_EXPIRATION` | Any leg ≤7 DTE |
| `MARKET_ORDER_OPTIONS_WARNING` | Market order on options — price uncertainty |
| `MULTI_LEG_NOT_SUPPORTED` | Provider cannot do native multi-leg |
| `WIDE_SPREAD` | Bid/ask spread >15% on any leg |
| `LOW_OPEN_INTEREST` | Poor/Limited liquidity |
| `EVENT_INSIDE_STRUCTURE` | Earnings/event within structure life |
| `ASSIGNMENT_RISK` | Short leg(s) carry assignment risk |
| `EARLY_EXERCISE_RISK` | Early exercise possible on short legs |
| `TIME_DECAY_ACCELERATING` | Theta warning near expiration |
| `PATH_DEPENDENT` | Calendar/diagonal payoff is path-dependent |
| `PARTIAL_GREEKS` | Some Greeks unavailable |

---

## 14. Compliance

**Forbidden labels (must never appear in UI or API responses):**
Best Options Trade, Recommended Spread, Recommended Contract, Best Strike, Best Expiration, Ready to Trade, Submit Now, Guaranteed Fill, Expected Profit, Probability of Profit, Chance of Winning, POP, Roll Now, Close Now, Place Order, Confirm & Submit, Execute, Send to Broker, Trade Approved, Execution Ready, Good to Go, Buy to Open, Sell to Open.

**Mandatory disclosures:**
1. Non-execution banner: "Preview Only — Nothing has been submitted to your broker."
2. Options preview disclaimer: Full disclaimer text from `OPTIONS_PREVIEW_DISCLAIMER`
3. Price disclaimer: "Displayed contract quotes and net debit/credit references are current research/preview values. Actual execution prices may differ materially."
4. Midpoint disclaimer: "Net debit/credit values are calculated from current quote references. Actual execution prices may differ materially."
5. Options risk disclosure: "Options trading involves significant risk. Losses can exceed the amount invested for certain strategies..."

---

## 15. Audit Events

Events logged to `execution_audit_events`:
- `OPTIONS_PREVIEW_STARTED`
- `OPTIONS_PREVIEW_GENERATED`
- `OPTIONS_PREVIEW_REFRESHED`
- `OPTIONS_PREVIEW_REQUIRES_REVIEW`
- `OPTIONS_PREVIEW_EXPIRED`
- `OPTIONS_PREVIEW_INVALID`

**Safe audit metadata (logged):** provider, strategyFamily, legCount, instrumentType, status, warningCount, blockerCount, durationMs, hasEventRisk, hasAssignmentRisk

**Never logged:** contract symbols, strike prices, quantity, full account ID, net debit/credit, capital, P/L

---

## 16. Platform Health

`GET /api/execution/options-preview/health` returns:
```json
{
  "brokerSubmissionEnabled": false,
  "metrics": {
    "previewRequests": 0,
    "singleLegPreviews": 0,
    "multiLegPreviews": 0,
    "previewPasses": 0,
    "previewRequiresReview": 0,
    "previewInvalid": 0,
    "previewExpired": 0,
    "previewFailures": 0,
    "averagePreviewLatencyMs": 0,
    "lastPreviewAt": null
  }
}
```

Metrics are in-memory and reset on restart.

---

## 17. Database

No new tables. Preview is ephemeral.  
Audit events reuse `execution_audit_events`.  
Schema unchanged.

---

## 18. Security

- All routes require authentication
- Draft scoped to `userId` — cross-user access returns `ORDER_DRAFT_NOT_FOUND`
- Trade plan scoped to `userId`
- Account ID never exposed (masked only)
- Contract symbols, strikes, quantities never in audit logs
- No broker mutation methods called anywhere in the service
- Client injection blocked for all authoritative fields (HTTP 400)

---

## 19. 2.8.4 Handoff

Sprint 2.8.4 — Execution Validation Hardening:
- Task #131 lifecycle scheduler auto-wiring
- Final/current lifecycle enforcement  
- Fresh preflight + fresh OrderDraft + fresh Preview validation chain
- Broker connection freshness
- Account validation, permissions, buying power, live positions
- Covered/share checks and cash-secured capital
- Fresh quotes and contracts
- Market/tradability state
- Sandbox certification
- Persistent idempotency infrastructure
- Duplicate-submit architecture
- Final pre-confirmation validation

---

## 20. 2.8.5 Absolute Block

No broker submission before:
- 2.8.4 GO
- Task #131 complete
- Authenticated browser E2E PASS
- Broker sandbox validation PASS
- Fresh lifecycle, quotes, account, permissions, buying power/positions
- Current risk analysis, OrderDraft, Preview
- Short-lived explicit user confirmation
- Persistent idempotency + duplicate-submit protection
- Global kill switch, provider execution mode, full audit trail, security gates

No exception.
