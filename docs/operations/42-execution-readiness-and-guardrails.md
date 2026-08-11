# 42 — Execution Readiness & Guardrails

**Sprint:** 2.8.4  
**Status:** ACTIVE  
**Category:** Execution Architecture — Deterministic Pre-Trade Guardrails  
**Prerequisite:** Sprint 2.8.3 (Options / Multi-Leg Order Preview)

---

## 1. Purpose

Execution Readiness is a deterministic pre-trade layer that answers:

**Can this order safely proceed to user review and confirmation?**

Possible states: `READY`, `READY_WITH_WARNINGS`, `BLOCKED`.

It sits immediately after Options Order Preview in the workflow:

```
Trade Plan
→ Options Order Preview  (2.8.3)
→ Execution Readiness    (2.8.4) ← this module
→ Review & Confirm       (2.8.5, future)
→ Broker Submission      (future, requires 2.8.5 GO)
```

---

## 2. Architecture Invariants

```
DETERMINISTIC — no LLM, ever.
   AI may EXPLAIN findings later (in the Workspace).
   AI may NEVER:
     - convert BLOCKED to READY
     - ignore stale quotes
     - override missing buying power
     - override missing positions
     - override broker restrictions

executable is always absent from readiness output (preview owns that).
brokerSubmissionEnabled: false — type-level literal constant in output.
engineVersion: "2.8.4" — always present, never changeable from output.

No order submission, modification, or cancellation.
No live broker mutation methods called anywhere.
Client-supplied account balances, positions, broker permissions → always rejected (HTTP 400 FORBIDDEN_FIELD).
```

---

## 3. Readiness Status Model

| Status | Meaning | CTA |
|---|---|---|
| `READY` | All checks pass | "Continue to Review" (disabled until 2.8.5) |
| `READY_WITH_WARNINGS` | Non-blocking issues present | "Review Warnings & Continue" |
| `BLOCKED` | One or more blockers | "Resolve blockers before continuing." |

**Forbidden status labels:** TRADE_APPROVED, GO, EXECUTION_APPROVED, RECOMMENDED, PASS_THROUGH, ALL_CLEAR, APPROVED_TO_TRADE, GUARANTEED, PASS.

---

## 4. Finding Structure

```typescript
{
  code: string;                          // machine-readable stable code
  severity: "INFO" | "WARNING" | "BLOCKER";
  category: "MARKET_DATA" | "ACCOUNT" | "POSITION" | "CAPITAL" | "STRUCTURE"
           | "RISK" | "EXPIRATION" | "LIQUIDITY" | "PRICING";
  title: string;                         // short human label
  message: string;                       // plain-language explanation
  source?: string;
  legIndex?: number;                     // if leg-specific
}
```

Status aggregation:
- Any `BLOCKER` → `BLOCKED`
- Any `WARNING` (no BLOCKER) → `READY_WITH_WARNINGS`
- All `INFO` only → `READY`

---

## 5. Nine Evaluation Categories

### A. Market Data

| Finding | Severity | Trigger |
|---|---|---|
| `ALL_QUOTES_UNAVAILABLE` | BLOCKER | `aggregateFreshnessCategory === "UNAVAILABLE"` |
| `QUOTE_STALE` | BLOCKER | `anyStale === true` or individual leg has no current quote |
| `OPTION_MARKET_INVALID` | BLOCKER | `bid > ask` on any leg (crossed market) |
| `ZERO_BID` | WARNING | `bid === 0` on short leg |
| `PARTIAL_GREEKS` | WARNING | Any Greek (delta/gamma/theta/vega) null on any leg |

Reuses Sprint 2.8.3 quote freshness data — does not recompute quotes.

### B. Account

| Finding | Severity | Trigger |
|---|---|---|
| `BROKER_NOT_CONNECTED` | BLOCKER | No active broker connection |
| `OPTIONS_NOT_SUPPORTED` | BLOCKER | `supportsOptions === false` |
| `MULTILEG_NOT_SUPPORTED` | BLOCKER | `supportsMultileg === false` + `MULTI_LEG_OPTION` |
| `OPTIONS_PERMISSION_UNCONFIRMED` | WARNING | `supportsOptions === null` (broker has no permissions API) |
| `MULTILEG_NOT_SUPPORTED` | WARNING | `supportsMultileg === null` + `MULTI_LEG_OPTION` |
| `ACCOUNT_UNAVAILABLE` | WARNING | Account status not "active" |

No leg decomposition for multi-leg orders — permanent policy.

### C. Position

| Finding | Severity | Trigger |
|---|---|---|
| `INSUFFICIENT_COVERED_SHARES` | BLOCKER | `covered_call`/`collar`/`protective_put` with insufficient shares |
| `POSITION_NOT_FOUND` | BLOCKER | Close intent with no matching position |
| `INSUFFICIENT_OPTION_POSITION` | BLOCKER | Close intent quantity > position quantity |
| `POSITION_DATA_UNAVAILABLE` | WARNING | Positions null (broker disconnected) — never assumes zero |
| `COVERAGE_CONFIRMED` | INFO | Coverage verified for covered structures |

**Missing positions ≠ zero holdings.** Unavailable position data generates a warning, not a blocker that assumes empty account.

### D. Capital

| Finding | Severity | Trigger |
|---|---|---|
| `BUYING_POWER_INSUFFICIENT` | BLOCKER | Buying power < estimated capital requirement |
| `BUYING_POWER_UNCONFIRMED` | WARNING | Broker buying power unavailable |
| `BROKER_MARGIN_CALCULATION_REQUIRED` | WARNING | Undefined-risk strategy |

**Missing buying power ≠ $0.** Unavailable buying power generates a warning, not a blocker.

#### Capital Estimation Rules

| Strategy | Calculation |
|---|---|
| Long call / put | Net debit × multiplier × qty |
| Protective put | Net debit × multiplier × qty |
| Debit spreads (bull call, bear put) | Net debit × multiplier × qty |
| Bull put spread / bear call spread | (spread_width - credit_per_unit) × multiplier × qty |
| Iron condor / butterfly | (max_wing_width - credit_per_unit) × multiplier × qty |
| Covered call | $0 new capital (shares already owned); net credit shown |
| Cash-secured put | (strike × 100 × qty) - net_credit |
| Collar | Net debit (or credit) × multiplier × qty |
| Straddle / strangle | Net debit × multiplier × qty |
| Calendar / diagonal | Net debit × multiplier × qty |
| Naked short / undefined risk | `BROKER_MARGIN_CALCULATION_REQUIRED` |

All capital estimates: `isEstimate: true`. Never "broker approval".

### E. Structure

| Finding | Severity | Trigger |
|---|---|---|
| `INVALID_QUANTITY` | BLOCKER | `quantity ≤ 0` |
| `INVALID_LEG_STRUCTURE` | BLOCKER | Actual leg count ≠ expected for strategy family |
| `MIXED_UNDERLYING` | BLOCKER | Legs reference different underlying symbols |
| `INVALID_STRIKE_ORDER` | BLOCKER | Strike ordering violated for spread |
| `INVALID_EXPIRATION_STRUCTURE` | BLOCKER | Calendar/diagonal lacks multiple expirations |

Strike ordering rules:
- `bull_call_spread`: long_strike < short_strike (both calls)
- `bear_put_spread`: long_strike > short_strike (both puts)
- `bull_put_spread`: short_strike > long_strike (both puts)
- `bear_call_spread`: short_strike < long_strike (both calls)

### F. Assignment & Risk

| Finding | Severity | Trigger |
|---|---|---|
| `SHORT_OPTION_ASSIGNMENT_RISK` | WARNING | `isShortIntent(intent)` — any intent containing "SHORT" |
| `EARLY_EXERCISE_RISK` | WARNING | Short call legs |

Assignment risk is a warning only (not a blocker). Assignment is inherent to short options. Uses `isShortIntent()` from Sprint 2.8.3 — matches any intent containing "SHORT", covering future intent additions.

### G. Expiration

| Finding | Severity | Trigger |
|---|---|---|
| `OPTION_EXPIRED` | BLOCKER | `leg.isExpired === true` or `leg.dte < 0` |
| `ZERO_DTE` | WARNING | `leg.dte === 0` (configurable) |
| `NEAR_EXPIRATION` | WARNING | `leg.dte ≤ nearExpirationDays` (default: 2) |

### H. Liquidity

| Finding | Severity | Trigger |
|---|---|---|
| `WIDE_BID_ASK_SPREAD` | WARNING | `spreadPct > wideBidAskWarningPct` (default: 10%) |
| `SEVERE_WIDE_SPREAD` | WARNING | `spreadPct > wideBidAskSevereWarningPct` (default: 20%) |
| `LOW_OPEN_INTEREST` | WARNING | `openInterest < lowOpenInterestThreshold` (default: 100) |
| `LOW_VOLUME` | WARNING | `volume < lowVolumeThreshold` (default: 10) |

No BLOCKER from wide spreads — consistent with VCP execution policy.

### I. Pricing

| Finding | Severity | Trigger |
|---|---|---|
| `INVALID_NET_PRICE` | BLOCKER | `amountPerUnit < 0` |
| `PRICING_DIRECTION_MISMATCH` | WARNING | Debit strategy shows credit or vice versa |
| `PRICING_UNAVAILABLE` | WARNING | `allQuotesAvailable === false` |

Uses Sprint 2.8.3 `netStructurePricing` — never recomputes pricing.

---

## 6. Guardrail Configuration

```typescript
const DEFAULT_EXECUTION_GUARDRAIL_CONFIG = {
  quoteStaleSeconds:          900,  // 15 min underlying
  optionQuoteStaleSeconds:    300,  // 5 min options
  zeroDteWarning:             true,
  nearExpirationDays:         2,
  wideBidAskWarningPct:       10,
  wideBidAskSevereWarningPct: 20,
  lowOpenInterestThreshold:   100,
  lowVolumeThreshold:         10,
};
```

All thresholds are injectable for tests via `config` parameter.

---

## 7. Broker Capability Abstraction

```typescript
interface BrokerReadinessCapabilities {
  connected: boolean;
  provider: string;
  supportsOptions: boolean | null;   // null = UNKNOWN
  supportsMultileg: boolean | null;  // null = UNKNOWN
  optionsLevel: string | null;       // null = not reported
  accountStatus: string | null;
  buyingPowerUsd: number | null;     // null = unavailable
  buyingPowerSource: "broker" | "unavailable";
}
```

**Unknown must remain unknown** — never fabricate capability confirmations.

Current provider matrix (2026-08-11):
- Tradier: options=SUPPORTED, multiLeg=UNKNOWN, permissionsApi=UNKNOWN
- TradeStation: options=SUPPORTED, multiLeg=UNKNOWN, permissionsApi=UNKNOWN
- SnapTrade: options=UNKNOWN

---

## 8. Persistence

Table: `execution_readiness_results`

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR | UUID primary key |
| user_id | VARCHAR | Owner |
| trade_plan_id | VARCHAR | Indexed |
| order_draft_id | VARCHAR | Nullable |
| order_preview_id | VARCHAR | Nullable |
| provider | VARCHAR | Broker name |
| account_ref_masked | VARCHAR | Never full account ID |
| status | VARCHAR | READY / READY_WITH_WARNINGS / BLOCKED |
| findings | JSONB | Full findings array |
| capital_estimate | JSONB | Capital estimate object |
| blocker_count | INTEGER | |
| warning_count | INTEGER | |
| evaluated_at | TIMESTAMPTZ | |
| pricing_snapshot | JSONB | Methodology reference only |
| rule_engine_version | VARCHAR | "2.8.4" |
| created_at | TIMESTAMPTZ | |

**Never persisted:** raw account balances, full account IDs, broker tokens, full position lists, sensitive broker data.

---

## 9. API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/execution/execution-readiness/health` | Health metrics (static route — registered before dynamic) |
| `POST` | `/api/trade-plans/:id/execution-readiness` | Run readiness evaluation |
| `GET` | `/api/trade-plans/:id/execution-readiness/latest` | Get latest result |

**Forbidden client fields (HTTP 400 FORBIDDEN_FIELD if present in body):**
`positions`, `buyingPower`, `accountBalance`, `balance`, `cashBalance`, `brokerCapabilities`, `optionsPermission`, `optionsLevel`, `accountStatus`, `connected`, `sessionToken`, `accessToken`, `brokerToken`, `forceReady`, `overrideStatus`, `bypassChecks`, `skipValidation`, `forceExecute`, `approved`, `readyToTrade`, `executionApproved`

**Server-side pipeline (POST):**
1. Load trade plan (scoped to userId)
2. Generate Options Order Preview for orderDraftId
3. Load broker capabilities server-side via `createLiveBrokerExecutionAdapter`
4. Load positions server-side
5. Run deterministic readiness engine
6. Persist result to `execution_readiness_results`
7. Return structured response

---

## 10. UI

Component: `client/src/components/execution/ExecutionReadinessPanel`

Displayed immediately below `OptionsOrderPreviewPanel` in `trade-planning.tsx`.

Features:
- Non-execution banner: "Execution Readiness Check — No order has been submitted to your broker."
- Status banner: READY (green) / READY_WITH_WARNINGS (amber) / BLOCKED (red)
- Capital estimate card with breakdown
- Findings grouped by category, collapsible
- Severity icons: ✓ (INFO), ⚠ (WARNING), ✗ (BLOCKER)
- "Re-check Readiness" button to re-evaluate
- "Continue to Review" / "Review Warnings & Continue" CTA: shown but disabled (Sprint 2.8.5 placeholder)
- BLOCKED state: "Resolve blockers before continuing." — no CTA shown
- Disclaimer: always visible

---

## 11. AI Boundary

```
AI     ← readiness result → UI
         DETERMINISTIC
          readiness engine
              ↑
         Server-side only
         No LLM call
```

The LLM may receive the readiness findings for explanation via the AI Workspace. It may NEVER:
- Set status to READY, READY_WITH_WARNINGS, or BLOCKED
- Override stale quote findings
- Confirm or deny buying power
- Confirm or deny positions
- Override broker restriction blockers
- Modify any field in `ExecutionReadinessResult`

This boundary is enforced at the service level: `evaluateExecutionReadiness` is a pure function with no LLM calls, and the result type contains `brokerSubmissionEnabled: false` as a literal-type constant.

---

## 12. Test Coverage

Test file: `server/routes/__tests__/execution-readiness.test.ts`

40 test scenarios covering all spec requirements including:
- All 9 evaluation categories
- All status transitions (READY, READY_WITH_WARNINGS, BLOCKED)
- All capital estimate types
- isShortIntent for current and future SHORT-bearing intents
- Missing positions ≠ zero holdings
- Missing buying power ≠ $0
- All configurable thresholds
- Compliance (no forbidden labels)
- Determinism (same input → same output)
- No LLM dependency

---

## 13. Limitations

- Options contract live quotes (`getLegQuotes`) currently return empty map — requires connected broker adapter with options chain support (Sprint 2.7.3+ adapter integration). This generates `ALL_QUOTES_UNAVAILABLE` BLOCKER in production until adapter is wired.
- Tradier/TradeStation permissions API returns UNAVAILABLE — `OPTIONS_PERMISSION_UNCONFIRMED` warning is always generated.
- Multi-leg capability is UNKNOWN for all current providers — `MULTILEG_NOT_SUPPORTED` warning always generated for MULTI_LEG_OPTION.
- Positions API integration is live via `getBrokerPositions` but does not distinguish option positions from equity positions by contract symbol.

---

## 14. 2.8.5 Handoff — Review, Consent & Final Order Confirmation

Next sprint:
- Immutable final order snapshot
- Clear debit/credit display with max gain/loss where calculable
- Account + buying-power impact shown
- Assignment/exercise disclosure
- User acknowledgement (explicit checkbox)
- Explicit final confirmation (not automatic)
- Audit event
- NO broker submission until separately approved

---

## 15. Deferred / MCP Dependency

No MCP modifications in this sprint.

Potential future MCP tools that would improve data quality:
- `get_options_contract_quote` — per-contract bid/ask/greeks with freshness timestamp
- `get_account_options_level` — returns account's approved options trading level
- `get_position_by_contract` — exact position lookup by OCC contract symbol

---

## 16. 2.8.5 Absolute Block

No broker submission before:
- 2.8.5 GO
- 2.8.4 results passing (READY or READY_WITH_WARNINGS)
- Fresh lifecycle, quotes, account, permissions, buying power, positions
- Short-lived explicit user confirmation
- Persistent idempotency + duplicate-submit protection
- Global kill switch and full audit trail

No exception.
