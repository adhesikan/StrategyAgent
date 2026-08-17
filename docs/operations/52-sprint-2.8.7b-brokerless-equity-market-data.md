# Doc 52 — Sprint 2.8.7B: Broker-Independent Equity Market Data & Planning Validation

**Recorded:** 2026-08-17  
**Status:** COMPLETE  
**Sprint:** 2.8.7B  
**Prerequisite:** Sprint 2.8.7A (Doc 51) — production UAT PASS

---

## 1. Objective

Enable equity market data to be used for Trade Plan planning validation without a
brokerage connection, using the existing Twelve Data integration.

A user with no connected brokerage should be able to:
- Run Trade Plan Readiness
- See a meaningful Quote Validation dimension (not just "broker required")
- View the underlying price, source, session, and freshness in PLANNING_MODE

This sprint does NOT implement options-chain sourcing, HV30/HV calculations,
theoretical options pricing, or order execution changes.

---

## 2. Architecture

### 2.1 Data Flow

```
BROKERLESS EQUITY PLAN
  Twelve Data /quote endpoint
      ↓  (gated: canAccessTwelveDataBackedAnalysis + credit management)
  RealTimeQuote { last, asOf, session, extendedHours, isMarketOpen }
      ↓  (getPlanningQuoteData adapter)
  PlanningQuoteData { source:"PLANNING_MARKET_DATA", price, asOf, session, ... }
      ↓  (injected via PreflightDependencies.getPlanningQuote)
  buildQuoteDimension (brokerConnected=false, planType=EQUITY)
      ↓
  ValidationDimension { status:"PLANNING_MODE", note:"...", planningQuote:{...} }

BROKER CONNECTED
  brokerAdapter.getQuoteValidation()  →  BrokerQuoteValidation
      ↓  (unchanged execution path)
  ValidationDimension { status:"PASS"/"FAIL"/... }
```

### 2.2 Safety Boundary

| Property | Value | Effect |
|---|---|---|
| `PlanningQuoteData.source` | `"PLANNING_MARKET_DATA"` | Never satisfies execution gate |
| `overallStatus = "PASS"` | Requires broker connected | Unchanged |
| `executionAvailable = true` | Requires `overallStatus = "PASS"` | Unchanged |
| Order Preparation | Requires execution-grade broker data | Unchanged |
| Broker Submission | Broker-required | Unchanged |

These invariants are tested permanently in Suite 13F/G/J of
`server/__tests__/execution-preflight-brokerless.test.ts`.

### 2.3 Data Quality Classification

| `dataQuality` | Condition | Semantics |
|---|---|---|
| `"fresh"` | `isMarketOpen=true` AND `freshnessSec < 300` | Actively trading market, quote ≤5 min old |
| `"last_close"` | `freshnessSec < 90_000` (not fresh) | Normal overnight/weekend state; last session close |
| `"stale"` | `freshnessSec ≥ 90_000` | Anomalous — missed a trading session |

`isStale = dataQuality === "stale"`. Market-closed quotes are always `"last_close"`,
not stale — this correctly represents overnight and weekend state.

---

## 3. New Types

### 3.1 `PlanningQuoteData` (shared/execution-types.ts)

```typescript
interface PlanningQuoteData {
  source: "PLANNING_MARKET_DATA";   // never satisfies execution gate
  provider: "twelve_data";
  symbol: string;
  price: number;                    // last traded / extended-hours price
  asOf: string;                     // ISO-8601 from provider
  session: "pre" | "regular" | "after" | "closed";
  extendedHours: boolean;
  isMarketOpen: boolean;
  freshnessSec: number;             // seconds since asOf at eval time
  dataQuality: "fresh" | "last_close" | "stale";
  isStale: boolean;                 // dataQuality === "stale"
}
```

### 3.2 `ValidationDimension` extended (shared/execution-types.ts)

```typescript
interface ValidationDimension {
  status: ValidationStatus;
  label: string;
  note?: string;
  planningQuote?: PlanningQuoteData;  // NEW — only on quote dim, PLANNING_MODE only
}
```

---

## 4. New File

### `server/services/daily-market-data/planning-quote.ts`

Thin adapter. Calls `getRealtimeQuoteForUser(userId, symbol, "equity_plan_readiness")`
(gated + cached) and maps `RealTimeQuote → PlanningQuoteData`.

- Returns `null` on any error (provider down, access denied, rate limit)
- Never throws
- Never fabricates a price
- `now` parameter injectable for test determinism

---

## 5. Changed Files

| File | Change |
|---|---|
| `shared/execution-types.ts` | Added `PlanningQuoteData` interface; added `planningQuote?` to `ValidationDimension` |
| `server/services/daily-market-data/planning-quote.ts` | **NEW** — thin adapter |
| `server/services/execution-preflight-service.ts` | Added `getPlanningQuote?` to `PreflightDependencies`; parallel fetch block 5b; `buildPlanningModeQuoteDimension()`; `buildQuoteDimension` extended; `getPlanningQuote` wired in `createDbPreflightDeps` |
| `client/src/pages/trade-plan-detail.tsx` | `BrokerExecutionReadinessPanel`: quote dim row renders `planningQuote` detail block when present (`data-testid="planning-quote-detail"`) |
| `server/__tests__/execution-preflight-brokerless.test.ts` | **Suite 13A–J** (34 tests) covering all Phase 8 scenarios A–L |

---

## 6. Behavior Before / After

| Scenario | Before | After |
|---|---|---|
| Brokerless EQUITY, Twelve Data available | PLANNING_MODE — "broker connection required" | PLANNING_MODE — "Planning data — Twelve Data · $185.42 · Market Open" + structured planningQuote detail |
| Brokerless EQUITY, market closed | PLANNING_MODE — "broker connection required" | PLANNING_MODE — "Planning data — Twelve Data · $185.42 · Market Closed" |
| Brokerless EQUITY, Twelve Data unavailable | PLANNING_MODE — "broker connection required" | PLANNING_MODE — "Planning mode — live quote validation requires broker connection" (unchanged fallback) |
| Brokerless EQUITY, stale quote (>25h) | PLANNING_MODE — "broker connection required" | PLANNING_MODE — "Planning data — Twelve Data · $185.42 · Stale (28h old)" |
| Broker connected, any plan | PASS/FAIL (broker quote) | Unchanged — planning quote dep not called |
| OPTIONS plan, no broker | PLANNING_MODE (unchanged) | Unchanged — planning quote enrichment is EQUITY-only |

---

## 7. Market Session Behavior

| Session | `dataQuality` | `isStale` | Note in dim |
|---|---|---|---|
| Regular (open, <5 min) | `"fresh"` | false | "Market Open" |
| Pre-market | `"last_close"` | false | "Pre-Market" |
| After-hours | `"last_close"` | false | "After-Hours" |
| Closed (overnight) | `"last_close"` | false | "Market Closed" |
| Weekend | `"last_close"` | false | "Market Closed" |
| Any (>25h old) | `"stale"` | true | "Stale (Nh old)" |

Planning data staleness is **never** converted to an execution failure.

---

## 8. Safety Invariants (Permanent Tests — Suite 13F/G/J)

| Invariant | Test | Status |
|---|---|---|
| overallStatus never PASS from planning quote alone | Suite 13F/G | ✅ |
| executionAvailable never true when brokerless | Suite 13G/I | ✅ |
| planningQuote.source = PLANNING_MARKET_DATA | Suite 13F | ✅ |
| BER status NOT_CONNECTED with planning quote | Suite 13F | ✅ |
| QUOTE_STALE blocker not produced by planning quote | Suite 13G | ✅ |
| OPTIONS plan: planning quote not used | Suite 13J | ✅ |
| INV-A/B/C from Sprint 2.8.7A intact | Suite 13J | ✅ |
| Broker connected: getPlanningQuote not called | Suite 13D | ✅ |
| No fabricated prices | Suite 13I | ✅ |

---

## 9. Test Results

| Suite | Tests |
|---|---|
| `execution-preflight-brokerless.test.ts` (all suites) | **100 / 100** |
| `execution-preflight.test.ts` | **88 / 88** |
| `execution-entry-point.test.ts` | **23 / 23** |
| `trade-plan-detail-hook-order.test.ts` | **66 / 66** |
| Full suite | **9823 pass** (29 pre-existing failures unchanged) |

---

## 10. Scope Boundaries (Not Implemented)

Per spec — out of scope for this sprint:
- Theoretical Black-Scholes options pricing
- HV30/HV calculations
- Theoretical strike grids
- Options provider fallback
- Options chain sourcing
- Buying-power hypothetical substitution (CON-004)
- Order execution changes
- Portfolio changes

Options provider hierarchy is defined in Doc 49 (Audit C/C1).

---

## 11. Production UAT Steps

1. Open a saved EQUITY Trade Plan (e.g. NVDA) — broker disconnected.
2. Click "Check Plan Readiness" → Trade Plan Readiness card expands.
3. Under Direct Execution → Quote Validation row:
   - Status: `PLANNING_MODE`
   - Note should contain "Planning data — Twelve Data · $xxx.xx · [market status]"
   - If market is open: "Market Open"; if closed: "Market Closed" / "Pre-Market" / "After-Hours"
4. Expand Quote Validation row → planning-quote-detail block should show:
   - Underlying: NVDA
   - Planning Price: $xxx.xx
   - Source: Twelve Data
   - As of: [timestamp]
   - Market status: [session label]
5. Confirm overallStatus is NOT "PASS" (execution still unavailable without broker).
6. Connect broker → re-run readiness → Quote Validation should now use broker quote (no planningQuote block).
7. Confirm execution becomes available when broker connected + all other dims PASS.

**Expected:** Steps 3–4 show Twelve Data data. Steps 5–7 confirm all safety invariants.

---

## 12. Limitations

- Planning quote requires Twelve Data access (`TWELVE_DATA_ENABLED=true`, correct license mode).
  If unavailable, falls back to unstructured PLANNING_MODE note (2.8.7A behavior).
- OPTIONS plans do not receive planning quote enrichment (contract validation requires broker).
- Planning quote cannot satisfy the execution-grade quote gate under any circumstances.
- In prelaunch mode, only internal/admin users have Twelve Data access; external users see the fallback.
