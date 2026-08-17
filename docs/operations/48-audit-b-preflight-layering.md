# Doc 48 — Audit B: Execution Preflight Independent Layer Design

**Sprint 2.8.7 Architecture Audit — Read-Only**  
**Date:** 2026-08-17  
**Status:** COMPLETE — No application code changed  
**Depends on:** [Doc 47 — Audit A](47-audit-a-broker-gate-inventory.md)

---

## 1. Current Preflight Type System

### 1.1 Status Enumerations

**Overall preflight status** (`shared/execution-types.ts:56`):
```
ExecutionPreflightStatus =
  | "PASS"               // All dims pass; execution path available
  | "FAIL"               // One or more blockers
  | "REQUIRES_REVIEW"    // Warning-level items need attention
  | "UNAVAILABLE"        // Broker absent — currently masks independent dims
  | "EXECUTION_DISABLED" // Kill switch active
```

**Per-dimension status** (`shared/execution-types.ts:67`):
```
ValidationStatus =
  | "PASS"
  | "FAIL"
  | "REQUIRES_REVIEW"
  | "UNAVAILABLE"
  | "SKIPPED"
```

### 1.2 Where `determineOverallStatus()` Lives

`server/services/execution-preflight-service.ts:733` — returns:
```
if (blockers.length > 0)     → "FAIL"
if (!brokerConnected)        → "UNAVAILABLE"   ← THE ROOT PROBLEM
if (hasReviewWarnings)       → "REQUIRES_REVIEW"
                             → "PASS"
```

This is the gate that masks valid independent dims. When no broker, it short-circuits to `UNAVAILABLE` regardless of how dims 1–3, 11–12 evaluated.

### 1.3 DB Storage

`execution_preflights` table (`shared/schema.ts:3874`):
- `status` — text column, stores the `overallStatus` value
- `result_json` — jsonb, stores the full `ExecutionPreflightResult`
- `valid_until` — preflight expiry (5-minute window)

### 1.4 Client Assumptions About `overallStatus`

| Location | Assertion | Purpose |
|---|---|---|
| `trade-plan-detail.tsx:250` | `overallStatus === "PASS"` | Gates order-draft query `enabled` flag |
| `trade-plan-detail.tsx:1335` | `overallStatus === "PASS" && !isExpired` | Gates OrderPreparationPanel render |
| `trade-plan-detail.tsx:1346,1359` | same | Gates Equity/Options Preview render |
| `ExecutionPreflightPanel.tsx:187` | `result.overallStatus` → badge render | Display |
| `ExecutionPreflightPanel.tsx:241` | `=== "EXECUTION_DISABLED"` | Kill-switch message |

### 1.5 Downstream Services Relying on `"PASS"`

| Service / Route | Check | Gate |
|---|---|---|
| `order-preparation-service.ts:367` | `preflightRow.status !== "PASS"` | **ORDER PREPARATION GATE** — reads DB `status` column |
| `equity-preview-service.ts:316` | `preflight.status !== "PASS"` | Equity preview blocked |
| `options-preview-service.ts:805` | `preflight.status !== "PASS"` | Options preview blocked |
| `order-confirmation.ts:123` | `validateSnapshotEligibility(readiness)` | Readiness-based (not preflight direct) |
| `execution-preflight.ts:243` | `result.overallStatus === "PASS"` | Platform health counter |
| `BROKER_EXECUTION_ENABLED` env | Kill switch | **SUBMISSION GATE** — independent of preflight status |

**Critical observation:** The order-preparation service reads the DB `status` column directly. The DB `status` column is written from `overallStatus`. Therefore: the order-preparation gate is satisfied if and only if `overallStatus === "PASS"` was stored in the DB. Any new status value (e.g. `"PASS_INDEPENDENT"`) would NOT satisfy this gate — execution safety is structurally preserved.

---

## 2. Current 12-Dimension Contract (Verified)

| # | Dimension Field | Build Function | Broker Calls | Independent Fallback Today | Independent Fallback Possible |
|---|---|---|---|---|---|
| 1 | `tradePlanValidation` | `buildTradePlanDimension()` | None | **Yes — plan DB** | ✓ Already independent |
| 2 | `lifecycleValidation` | `buildLifecycleDimension()` | None | **Yes — lifecycle DB** | ✓ Already independent |
| 3 | `freshnessValidation` | `buildFreshnessDimension()` | None | **Yes — plan.updatedAt** | ✓ Already independent |
| 4 | `brokerValidation` | `buildBrokerDimension()` | `getConnectionStatus()` | None — is the broker check | — |
| 5 | `accountValidation` | `buildAccountDimension()` | `listAccounts()` | None — account-specific | — |
| 6 | `permissionsValidation` | `buildPermissionsDimension()` | `getAccountCapabilities()` | None — account-specific | — |
| 7 | `buyingPowerValidation` | `buildBuyingPowerDimension()` | `getBuyingPower()` | None today | ✓ User-entered budget (CON-004) |
| 8 | `positionValidation` | `buildPositionDimension()` | `getPositions()` | None today | ✓ Equity simple long = NOT_APPLICABLE |
| 9 | `quoteValidation` | `buildQuoteDimension()` | `getQuoteValidation()` / `validateOptionsContract()` | None today | ✓ Equity: Twelve Data daily bar viable |
| 10 | `structureValidation` | `buildStructureDimension()` | Derived from dim 9 | None today | ✓ Equity: plan DB structure; options: depends on dim 9 |
| 11 | `riskValidation` | `buildRiskDimension()` | None | **Yes — plan.riskSnapshot** | ✓ Already independent |
| 12 | (planning constraints) | `checkPlanningConstraints()` | None | **Yes — plan.planningSnapshot** | ✓ Already independent |

**Mode-aware insight (§4 challenge):** Dims 7–10 are not binary BROKER_REQUIRED/INDEPENDENT. They have a planning-readiness mode and an execution-readiness mode:

| Dim | Planning-Readiness Mode (Independent) | Execution-Readiness Mode (Broker) |
|---|---|---|
| 7 | NOT_CONNECTED or user-entered budget | Live `getBuyingPower()` |
| 8 | NOT_APPLICABLE (equity long); NOT_CONFIRMED (options with shares required) | `getPositions()` live confirmation |
| 9 | Twelve Data daily bar (equity); NOT_CONFIRMED (options contracts) | Live `getQuoteValidation()` / `validateOptionsContract()` |
| 10 | Plan DB structure (equity); NOT_CONFIRMED (options legs) | Contract validity from dim 9 |

---

## 3. Two-Layer Architecture

### 3.1 Canonical Layer Names

Inspecting existing naming in the codebase: the existing dimension fields use `tradePlanValidation`, `lifecycleValidation`, `brokerValidation`, `accountValidation`. The prefix convention is clear.

**Chosen canonical names** (consistent with existing style):

```
TRADE_PLAN_READINESS       — "tradePlanReadiness"
BROKER_EXECUTION_READINESS — "brokerExecutionReadiness"
```

These align with:
- Existing field `tradePlanValidation` (already scoped to plan)
- Existing field `brokerValidation` (already scoped to broker)

### 3.2 What Each Layer Answers

**Trade Plan Readiness:**
> "Is this saved research/planning artifact internally ready and current?"
> Evaluates independently of any broker connection.
> A PASS here means the plan is well-formed, lifecycle is current, research is fresh, and risk/planning constraints are in order.
> It does NOT mean execution is authorized.

**Broker Execution Readiness:**
> "Can this specific plan be prepared for execution using the connected broker/account right now?"
> Requires an active broker connection.
> Evaluates account, permissions, buying power, position confirmation, live quote, and contract validity.
> A READY here, combined with Trade Plan Readiness PASS, means order preparation is permitted.

---

## 4. Final Canonical Dimension Classification

### 4.1 TRADE_PLAN_READINESS Dimensions (always evaluate)

| Dim | Name | Status Logic | Mode |
|---|---|---|---|
| 1 | Trade Plan | Plan exists, has structure + planning snapshot | INDEPENDENT |
| 2 | Research Lifecycle | `CURRENT` → PASS; `REQUIRES_REVIEW` → REQUIRES_REVIEW; `THESIS_INVALIDATED`/`DATA_STALE`/`UNKNOWN` → FAIL | INDEPENDENT |
| 3 | Plan Freshness | Age of plan + lifecycle evaluation | INDEPENDENT |
| 9a | Quote (equity) | Twelve Data daily bar — is the symbol still tradeable? | INDEPENDENT (equity only; planning-grade, not execution-grade) |
| 10a | Structure (equity) | Plan has a valid equity structure from plan DB | INDEPENDENT (equity only) |
| 11 | Risk Analysis | `plan.riskSnapshot` present and not stale (24h) | INDEPENDENT |
| 12 | Planning Constraints | `plan.planningSnapshot` scenario loss vs max risk | INDEPENDENT |

Note: dims 9a and 10a are the **planning-readiness mode** of dims 9 and 10 for equity plans. They do not require broker data. For options plans in readiness-only mode, dims 9 and 10 show `NOT_CONFIRMED` (not FAIL — plan hasn't been invalidated; contract hasn't been checked).

### 4.2 BROKER_EXECUTION_READINESS Dimensions (evaluate when broker connected)

| Dim | Name | Status Logic | Mode |
|---|---|---|---|
| 4 | Broker Connection | Connected + valid session | BROKER_REQUIRED |
| 5 | Broker Account | Account resolved, owned | BROKER_REQUIRED |
| 6 | Broker Permissions | Equity/options/multi-leg trading permission | BROKER_REQUIRED |
| 7 | Buying Power | Live buying power vs estimated capital requirement | BROKER_ENHANCED (CON-004: accept user-entered budget as planning hint only) |
| 8 | Position Requirements | Equity long: NOT_APPLICABLE; covered call/protective put: live position confirmation | BROKER_ENHANCED |
| 9b | Quote Validation | Live broker quote freshness (≤60s equity, ≤120s options); contract expiry/validity | BROKER_ENHANCED |
| 10b | Structure Validation | Contract legs valid and available per dim 9b | BROKER_ENHANCED |

### 4.3 Dimension Behavior Summary When Broker Absent

| Dim | No-Broker Behavior | Label |
|---|---|---|
| 1 | Evaluates normally | Trade Plan |
| 2 | Evaluates normally | Research Lifecycle |
| 3 | Evaluates normally | Plan Freshness |
| 4 | NOT_CONNECTED | Broker Connection |
| 5 | NOT_APPLICABLE | Broker Account |
| 6 | NOT_APPLICABLE | Broker Permissions |
| 7 | NOT_CONNECTED (no live data) or PLANNING_MODE if budget hint present | Buying Power |
| 8 | NOT_APPLICABLE (equity long); NOT_CONFIRMED (options with share requirement) | Position Requirements |
| 9 | Equity: PLANNING_MODE (Twelve Data bar); Options: NOT_CONFIRMED | Quote Validation |
| 10 | Equity: PLANNING_MODE (from plan DB); Options: NOT_CONFIRMED | Structure |
| 11 | Evaluates normally | Risk Analysis |
| 12 | Evaluates normally | Planning Constraints |

---

## 5. Independent Mode Behavior (No Broker)

### 5.1 Conceptual Result — Equity Long Plan, No Broker

```
TRADE PLAN READINESS
  Trade Plan              PASS
  Research Lifecycle      PASS
  Plan Freshness          PASS
  Risk Analysis           PASS
  Planning Constraints    PASS

  tradePlanReadiness.status = "PASS"

BROKER EXECUTION READINESS
  Broker Connection       NOT_CONNECTED
  (remaining dims skipped — NOT_APPLICABLE)

  brokerExecutionReadiness.status = "NOT_CONNECTED"

overallStatus = "UNAVAILABLE"   ← preserved; "PASS" only when both pass
executionAvailable = false
```

### 5.2 Conceptual Result — Options Plan (Covered Call), No Broker

```
TRADE PLAN READINESS
  Trade Plan              PASS
  Research Lifecycle      PASS
  Plan Freshness          PASS
  Quote Validation        NOT_CONFIRMED (contracts not verified — broker needed)
  Structure               NOT_CONFIRMED
  Risk Analysis           PASS
  Planning Constraints    PASS

  tradePlanReadiness.status = "PASS" (NOT_CONFIRMED dims don't block)
  limitations: ["Options contract validity requires a connected broker for live chain verification"]

BROKER EXECUTION READINESS
  Broker Connection       NOT_CONNECTED

  brokerExecutionReadiness.status = "NOT_CONNECTED"

overallStatus = "UNAVAILABLE"
executionAvailable = false
```

`NOT_CONFIRMED` is not a failure — the plan hasn't been invalidated. It means that dimension cannot be verified in the current mode.

---

## 6. Status Vocabulary

### 6.1 Current Statuses — Assessment

| Status | Planning use | Execution use | Verdict |
|---|---|---|---|
| `PASS` | ✓ Correct | ✓ Correct | Keep |
| `FAIL` | ✓ Correct (plan invalidated) | ✓ Correct (blocker) | Keep |
| `REQUIRES_REVIEW` | ✓ Correct (lifecycle review) | ✓ Correct | Keep |
| `UNAVAILABLE` | ✗ Misleading — "no broker" is not "unavailable" | ✓ Acceptable | Repurpose / split |
| `EXECUTION_DISABLED` | n/a | ✓ Correct | Keep |
| `SKIPPED` | (unused in practice) | (unused in practice) | Keep (future use) |

### 6.2 New Statuses Required

Adding to `ValidationStatus` for per-dimension use:

| New Status | When Used | Why Needed |
|---|---|---|
| `NOT_CONNECTED` | Broker dims when no broker | Distinguishes "broker absent" from platform failure |
| `NOT_APPLICABLE` | Dim 8 for equity long; account/permissions when dim 4 NOT_CONNECTED | Reduces noise on irrelevant dims |
| `NOT_CONFIRMED` | Options dims 9/10 in planning mode | "Can't verify, not failed" — honest intermediate state |
| `PLANNING_MODE` | Dims 9/10 equity in planning mode | "Using independent data, not execution-grade" |

**Total ValidationStatus after change:**
```
| "PASS" | "FAIL" | "REQUIRES_REVIEW" | "UNAVAILABLE"
| "SKIPPED" | "NOT_CONNECTED" | "NOT_APPLICABLE" | "NOT_CONFIRMED" | "PLANNING_MODE"
```

No new values added to `ExecutionPreflightStatus` (overall). The two-layer design replaces the need for `PASS_INDEPENDENT` as a top-level status.

### 6.3 Statuses Explicitly Rejected

| Considered | Rejected Because |
|---|---|
| `PASS_INDEPENDENT` | Creates backward compatibility risk on `overallStatus`; the two-layer model removes the need for it |
| `CONNECT_TO_ENHANCE` | Redundant — reason codes in `limitations[]` are sufficient |
| `OPTIONAL` | Too vague — NOT_CONNECTED is more precise |
| `BROKER_REQUIRED` | Confusing as a per-dim status — `NOT_CONNECTED` covers this for the user |
| `READY_TO_TRADE` | **Forbidden** by existing compliance vocabulary |
| `APPROVED` | **Forbidden** |

---

## 7. Overall Readiness Model

### 7.1 Structure

The `ExecutionPreflightResult` gains two new top-level sections. The existing `overallStatus` field is preserved with identical semantics — `"PASS"` is emitted only when BOTH layers fully pass.

```typescript
interface ExecutionPreflightResult {
  // === EXISTING — preserved, semantics unchanged ===
  overallStatus: ExecutionPreflightStatus;  // "PASS" only when both layers pass
  tradePlanValidation: ValidationDimension;
  lifecycleValidation: ValidationDimension;
  freshnessValidation: ValidationDimension;
  brokerValidation: ValidationDimension;
  accountValidation: ValidationDimension;
  permissionsValidation: ValidationDimension;
  buyingPowerValidation: ValidationDimension;
  positionValidation: ValidationDimension;
  quoteValidation: ValidationDimension;
  structureValidation: ValidationDimension;
  riskValidation: ValidationDimension;
  blockers: PreflightBlocker[];
  warnings: PreflightWarning[];
  limitations: string[];

  // === NEW — additive; no existing consumers read these ===
  tradePlanReadiness: TradePlanReadinessResult;
  brokerExecutionReadiness: BrokerExecutionReadinessResult | null;  // null = no broker
  executionAvailable: boolean;  // true ONLY when both layers pass

  // (all other existing fields: id, tradePlanId, userId, evaluatedAt, etc.)
}

type TradePlanReadinessStatus = "PASS" | "FAIL" | "REQUIRES_REVIEW";

interface TradePlanReadinessResult {
  status: TradePlanReadinessStatus;
  label: "Trade Plan Readiness";
  dimensions: {
    tradePlan: ValidationDimension;
    lifecycle: ValidationDimension;
    freshness: ValidationDimension;
    riskAnalysis: ValidationDimension;
    planningConstraints: ValidationDimension;
    // equity plan independent mode only:
    quoteReadiness?: ValidationDimension;   // Twelve Data
    structureReadiness?: ValidationDimension; // plan DB
  };
  limitations: string[];  // e.g. "Options contract validity requires connected broker"
}

type BrokerExecutionReadinessStatus =
  | "READY"
  | "NOT_CONNECTED"
  | "REQUIRES_REVIEW"
  | "BLOCKED";

interface BrokerExecutionReadinessResult {
  status: BrokerExecutionReadinessStatus;
  label: "Broker Execution Readiness";
  brokerConnected: boolean;
  provider?: string;
  dimensions: {
    broker: ValidationDimension;
    account: ValidationDimension;
    permissions: ValidationDimension;
    buyingPower: ValidationDimension;
    positionRequirements: ValidationDimension;
    quoteValidation: ValidationDimension;
    structureValidation: ValidationDimension;
  };
}
```

### 7.2 `overallStatus` Derivation (Updated Logic)

```
determineOverallStatus(blockers, warnings, brokerConnected):
  if EXECUTION_DISABLED flag         → "EXECUTION_DISABLED"
  if any independent-dim blocker     → "FAIL"
  if !brokerConnected                → "UNAVAILABLE"  (preserved — execution not possible)
  if any broker-dim blocker          → "FAIL"
  if hasReviewWarnings               → "REQUIRES_REVIEW"
  → "PASS"
```

`executionAvailable = (tradePlanReadiness.status === "PASS" && brokerExecutionReadiness?.status === "READY")`

### 7.3 Critical Safety Invariant

> `tradePlanReadiness.status === "PASS"` alone NEVER emits `overallStatus = "PASS"`.
>
> `overallStatus = "PASS"` requires the existing full 12-dimension logic to produce no blockers AND broker to be connected.
>
> Order preparation checks `preflightRow.status` (DB column = `overallStatus`). This gate is unbreakable by the new architecture.

---

## 8. Downstream Safety Contract

### 8.1 Gate Chain (Current → Preserved)

```
User clicks "Prepare for Execution"
  │
  ├── Client guard: brokerConnected (BI-GATE-002 — to be relaxed only for TPR query, not order prep)
  │
  ├── POST /api/trade-plans/:id/order-preparation
  │     └── order-preparation-service.ts:367
  │           preflightRow.status !== "PASS" → PREFLIGHT_NOT_PASSING
  │           ← reads DB status column = overallStatus
  │           ← "PASS" only when BOTH layers pass
  │
  ├── equity-preview-service.ts:316 / options-preview-service.ts:805
  │     preflight.status !== "PASS" → preflightNotPassing flag
  │
  ├── validateSnapshotEligibility(readiness)
  │     readiness.status === "BLOCKED" → 422
  │
  └── BROKER_EXECUTION_ENABLED env var
        kill switch — final gate before submission
```

**ORDER PREPARATION gate:** `preflightRow.status !== "PASS"` — checks DB column. Must remain literal `"PASS"`. ✓

**BROKER SUBMISSION gate:** `BROKER_EXECUTION_ENABLED` env var. Independent of preflight. ✓

### 8.2 What Must Gate Order Preparation

The order-preparation gate must check `brokerExecutionReadiness.status === "READY"` (implicitly via `overallStatus === "PASS"`). The TPR-only path (`tradePlanReadiness.status === "PASS"`) MUST NOT satisfy this gate.

**Implementation:** The DB `status` column continues to store `overallStatus`. Since `overallStatus` = `"PASS"` only when broker is connected + all 12 dims pass, the gate is automatically satisfied.

No separate `brokerExecutionReadiness` field needs to be stored in the DB for the gate. It is computed and returned in `result_json` for UI display.

### 8.3 What Must Gate Broker Submission

`BROKER_EXECUTION_ENABLED === "true"` (env var kill switch). This is checked independently at the submission endpoint and in preview/readiness services. Preflight status does not gate submission directly — only the kill switch and the execution-readiness/confirmation chain do.

---

## 9. Order Preparation Without Broker

### 9.1 Analysis

"Order Preparation" in the Sprint 2.8.1 sense requires:
1. A live broker account reference (from preflight accountValidation)
2. A live quote (from preflight quoteValidation — ≤60s)
3. Live buying power confirmation
4. Broker-validated instrument

None of these are available without a broker. **Order Preparation remains BROKER_REQUIRED.**

### 9.2 Brokerless Plan Preview (Conceptual — Not Order Preparation)

A separate concept — `BROKERLESS_PLAN_PREVIEW` — is viable as a read-only planning display. It would show:

| Field | Source |
|---|---|
| Symbol | Trade Plan |
| Expression / strategy family | Trade Plan structureSnapshot |
| Hypothetical quantity | planningSnapshot |
| Limit-price framework | planningSnapshot (entry/stop/target) |
| Estimated notional | planningSnapshot |
| Risk scenarios (P/L table) | plan.riskSnapshot |
| Max loss / max gain | plan.riskSnapshot |

This is NOT order preparation. It lives in the Trade Plan Workspace (Plan/Understand/Verify sections), not the Execute section. The existing risk scenario analysis already provides this functionality — it is already BROKER_INDEPENDENT.

**Conclusion:** Order Preparation stays BROKER_REQUIRED. Brokerless plan preview = the existing risk/planning workspace, not a new feature.

---

## 10. Equity-Specific Independent Mode

For simple **EQUITY LONG** plans, without a broker:

| Dim | Independent Mode Behavior | Status |
|---|---|---|
| 1 (Trade Plan) | Has structure (equity type) + planning snapshot | PASS |
| 2 (Lifecycle) | Evaluates from DB lifecycle result | PASS / REQUIRES_REVIEW / FAIL |
| 3 (Freshness) | Plan age + lifecycle age | PASS / REQUIRES_REVIEW |
| 7 (Buying Power) | NOT_CONNECTED | NOT_CONNECTED |
| 8 (Position Requirements) | NOT_APPLICABLE — simple long equity needs no existing position | NOT_APPLICABLE |
| 9 (Quote) | PLANNING_MODE — Twelve Data daily bar confirms symbol is active | PLANNING_MODE |
| 10 (Structure) | PLANNING_MODE — equity structure is just a symbol from plan DB | PLANNING_MODE |
| 11 (Risk) | Evaluates from plan.riskSnapshot | PASS / UNAVAILABLE |
| 12 (Planning Constraints) | Evaluates from plan.planningSnapshot | PASS / FAIL |

**TPR for equity long, no broker:** Can reach full PASS on dims 1,2,3,11,12; dims 9 and 10 in PLANNING_MODE (informational, not blocking); dim 8 NOT_APPLICABLE (not blocking).

**Result:** A user with an equity long trade plan and no broker sees "Plan Ready" — the plan is internally valid, research is current, risk is documented. Connect a broker to proceed to execution.

---

## 11. Options-Specific Independent Mode

For OPTIONS plans, without a broker:

| Dim | Independent Mode Behavior | Status |
|---|---|---|
| 7 (Buying Power) | NOT_CONNECTED | NOT_CONNECTED |
| 8 (Position Requirements) | Depends on structure type: |  |
| ↳ Long call / long put | No position required | NOT_APPLICABLE |
| ↳ Covered call | Requires 100 shares — cannot confirm without broker | NOT_CONFIRMED |
| ↳ Protective put | Requires underlying shares | NOT_CONFIRMED |
| ↳ Cash-secured put | Requires cash/buying power | NOT_CONFIRMED (broker needed for amount) |
| ↳ Collar | Requires underlying shares | NOT_CONFIRMED |
| 9 (Quote Validation) | Contract expiry unknown without chain | NOT_CONFIRMED |
| 10 (Structure Validation) | Contract legs not verified | NOT_CONFIRMED |

**NOT_CONFIRMED for options dims 8–10 is NOT a blocker for TPR PASS.** It is an honest limitation:
> "This dimension cannot be verified without a connected broker. Your plan is still valid — connect a broker to verify contract availability and account requirements."

**Blockers that DO prevent TPR PASS for options plans:**
- Dim 2 FAIL (lifecycle invalidated)
- Dim 11 FAIL (risk analysis stale)
- Dim 12 FAIL (planning constraint exceeded)
- Dim 1 FAIL (no structure snapshot)

Options contract validity (dim 9/10) is NOT a TPR blocker — it is an execution blocker.

---

## 12. Brokerless UI Design

```
┌─────────────────────────────────────────────────────────┐
│  TRADE PLAN READINESS                                   │
│                                                         │
│  ✓  Trade Plan              Current                     │
│  ✓  Research Lifecycle      Current                     │
│  ✓  Plan Freshness          Current                     │
│  ✓  Risk Analysis           Available                   │
│  ✓  Planning Constraints    Within limits               │
│                                                         │
│  Plan Ready                                             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  BROKER EXECUTION                                       │
│                                                         │
│     Brokerage not connected                             │
│                                                         │
│     Connect a supported broker to run account-aware    │
│     execution checks and direct order submission.       │
│                                                         │
│     [Connect Broker — Optional]                        │
└─────────────────────────────────────────────────────────┘
```

**Design rules:**
- Broker absence is NEVER shown as a red failure indicator
- "Trade Plan Readiness" and "Broker Execution" are visually distinct sections
- The broker section uses muted/informational styling (not error styling) when NOT_CONNECTED
- "Connect Broker — Optional" phrasing reinforces the principle: broker connection is optional for research
- If TPR has a FAIL (e.g. stale lifecycle), that section shows in amber/red; broker section stays informational
- `NOT_APPLICABLE` and `NOT_CONFIRMED` dims are hidden by default (collapsed) to avoid noise

---

## 13. Broker-Connected UI Design

```
┌──────────────────────────┬──────────────────────────────┐
│  TRADE PLAN READINESS    │  BROKER EXECUTION READINESS  │
│                          │                              │
│  ✓ Trade Plan            │  ✓ Broker: Tradier           │
│  ✓ Research Lifecycle    │  ✓ Account: Resolved         │
│  ✓ Plan Freshness        │  ✓ Permissions: Verified     │
│  ✓ Risk Analysis         │  ✓ Buying Power: Available   │
│  ✓ Planning Constraints  │  ✓ Position: N/A (equity)    │
│                          │  ✓ Quote: Current            │
│  Plan Ready              │  ✓ Structure: Verified       │
│                          │                              │
│                          │  Execution Preconditions Passed │
└──────────────────────────┴──────────────────────────────┘

         [Prepare for Execution]
```

- "Prepare for Execution" CTA appears only when `executionAvailable = true`
- Both sections use consistent green/amber/red dimension indicators
- When TPR FAIL: left section shows the issue; CTA stays hidden
- When BER BLOCKED: right section shows the blocker; CTA stays hidden
- When BER NOT_CONNECTED: right section shows informational state; CTA stays hidden
- When TPR PASS + BER REQUIRES_REVIEW: CTA still hidden (user must resolve)

**Compliance:** CTA label "Prepare for Execution" (not "Place Order", not "Trade Now"). After preparation: "Review Order Draft". Never "Ready to Trade" or "Trade Approved".

---

## 14. Broker Disconnection After Plan Creation

**Scenario:** User created plan while broker connected. Broker disconnects.

**Behavior:**
1. `tradePlanReadiness` continues to evaluate (independent dims unaffected by disconnect)
2. `brokerExecutionReadiness.status` → `NOT_CONNECTED`
3. `overallStatus` → `UNAVAILABLE` (preserved — execution not possible without broker)
4. Any existing unexpired preflight in DB becomes stale (TTL expires naturally)
5. Research lifecycle continues: the lifecycle service, opportunity engine, and risk monitoring all continue independently

**User experience:** "Your plan is still ready. Reconnect your broker to proceed with execution." No data loss, no plan recreation needed.

---

## 15. Broker Connection After Plan Creation

**Scenario:** User created plan without a broker. Later connects Tradier or TradeStation.

**Behavior:**
1. Existing Trade Plan remains unchanged — no recreation
2. When user runs preflight after broker connects, `brokerExecutionReadiness` now evaluates fully
3. If broker layer passes: `overallStatus` = `"PASS"` → `executionAvailable = true`
4. All existing plan data (riskSnapshot, planningSnapshot, lifecycle history) carries forward

**Implementation:** No new state needed. The preflight is always computed fresh on demand. The broker layer simply runs when `brokerConnected = true`.

---

## 16. Data Model Impact

### 16.1 DB Schema Changes

**`execution_preflights` table:** No changes required for Phase 1.
- `status` column: continues to store `overallStatus` — same semantics
- `result_json` column: will contain new `tradePlanReadiness` + `brokerExecutionReadiness` fields — backward compatible (additive)

**Optional Phase 2 enhancement:** Add `plan_readiness_status` text column to `execution_preflights` for efficient platform health queries without parsing `result_json`. Not required for correctness.

### 16.2 New Types Required

```typescript
// New in shared/execution-types.ts
type TradePlanReadinessStatus = "PASS" | "FAIL" | "REQUIRES_REVIEW";
type BrokerExecutionReadinessStatus = "READY" | "NOT_CONNECTED" | "REQUIRES_REVIEW" | "BLOCKED";

// Updated in shared/execution-types.ts
type ValidationStatus =
  | "PASS" | "FAIL" | "REQUIRES_REVIEW" | "UNAVAILABLE" | "SKIPPED"
  | "NOT_CONNECTED" | "NOT_APPLICABLE" | "NOT_CONFIRMED" | "PLANNING_MODE";  // NEW

// New interfaces (see §7.1)
interface TradePlanReadinessResult { ... }
interface BrokerExecutionReadinessResult { ... }

// Updated ExecutionPreflightResult (additive)
interface ExecutionPreflightResult {
  // ... all existing fields unchanged ...
  tradePlanReadiness: TradePlanReadinessResult;       // NEW
  brokerExecutionReadiness: BrokerExecutionReadinessResult | null;  // NEW
  executionAvailable: boolean;                        // NEW
}
```

### 16.3 No Schema Migration Required for Phase 1

All new fields are computed at evaluation time and stored in `result_json`. The `status` column semantics are unchanged. Phase 1 can ship without any ALTER TABLE.

---

## 17. API Contract

### 17.1 Endpoint

`POST /api/trade-plans/:id/preflight` — unchanged route.

### 17.2 Response Shape (Future)

```typescript
{
  // === EXISTING FIELDS (preserved) ===
  id: string;
  tradePlanId: string;
  userId: string;
  evaluatedAt: string;
  overallStatus: ExecutionPreflightStatus;  // "PASS" only when both layers pass
  tradePlanValidation: ValidationDimension;
  lifecycleValidation: ValidationDimension;
  freshnessValidation: ValidationDimension;
  brokerValidation: ValidationDimension;
  accountValidation: ValidationDimension;
  permissionsValidation: ValidationDimension;
  buyingPowerValidation: ValidationDimension;
  positionValidation: ValidationDimension;
  quoteValidation: ValidationDimension;
  structureValidation: ValidationDimension;
  riskValidation: ValidationDimension;
  blockers: PreflightBlocker[];
  warnings: PreflightWarning[];
  limitations: string[];
  validUntil?: string;
  executionMode: ExecutionMode;
  provider?: string;
  methodologyVersion: string;
  isExpired: boolean;

  // === NEW FIELDS (additive) ===
  tradePlanReadiness: TradePlanReadinessResult;
  brokerExecutionReadiness: BrokerExecutionReadinessResult | null;
  executionAvailable: boolean;
}
```

**Omitted unnecessary fields:** No `displayStatus`, no `summary` string, no `nextAction` — reason codes and layer statuses are sufficient for the client to derive display state.

---

## 18. Backward Compatibility

### 18.1 Compatibility Risk Inventory

| Location | Current Pattern | Risk After Change | Mitigation |
|---|---|---|---|
| `order-preparation-service.ts:367` | `preflightRow.status !== "PASS"` | **None** — `"PASS"` only when both layers pass | Architecture preserves this |
| `equity-preview-service.ts:316` | `preflight.status !== "PASS"` | **None** — same | Preserved |
| `options-preview-service.ts:805` | `preflight.status !== "PASS"` | **None** — same | Preserved |
| `trade-plan-detail.tsx:250` | `overallStatus === "PASS"` (order draft query guard) | **None** — semantic unchanged | Preserved |
| `trade-plan-detail.tsx:1335` | `overallStatus === "PASS"` (OrderPreparationPanel guard) | **None** — same | Preserved |
| `execution-preflight.test.ts:947` | `result.overallStatus === "PASS"` | **None** — test still valid | No test change needed |
| `order-preparation.test.ts:249` | mock `overallStatus: "PASS"` | **None** — mock still works | No test change needed |
| `preflight-lifecycle-consistency.test.ts:166` | `.not.toBe("PASS")` | **None** — still fails if both layers don't pass | Preserved |

### 18.2 New Fields Are Additive

`tradePlanReadiness`, `brokerExecutionReadiness`, `executionAvailable` are new fields in the response. No existing client or server code reads them — they cannot break anything. Clients reading only `overallStatus` continue to work correctly.

### 18.3 `ValidationStatus` Extension

New values (`NOT_CONNECTED`, `NOT_APPLICABLE`, `NOT_CONFIRMED`, `PLANNING_MODE`) are added to the union type. No existing code pattern-matches exhaustively on `ValidationStatus` in a way that would break — the UI renders `status.label` and uses `status.status` for color coding. All existing status values render correctly; new values need UI color assignments only.

### 18.4 Migration Strategy

**Phase 1 (no breaking change):**
- Add new types to `shared/execution-types.ts`
- Update `execution-preflight-service.ts` to compute and attach `tradePlanReadiness` + `brokerExecutionReadiness` to the result
- Fix `determineOverallStatus()` — no semantic change, adds a computation step
- Update `ExecutionPreflightPanel.tsx` to display two-section UI when `tradePlanReadiness` present
- Update `trade-plan-detail.tsx` to remove `enabled: brokerConnected` from the preflight query (BI-GATE-002)

**Phase 2 (optional — platform health optimization):**
- Add `plan_readiness_status` column to `execution_preflights` for efficient health queries

No deprecation needed. No breaking version bump needed.

---

## 19. Platform Health Implications

**Current:** Broker disconnected → preflight `UNAVAILABLE` → health subsystem shows Trade Planning degraded.

**Future:** Broker disconnected → `tradePlanReadiness.status` = PASS (if plan healthy) → Trade Planning subsystem is healthy. Broker layer shows "not connected" — a capability gap, not a system failure.

**Platform Health display (proposed):**
```
Trade Plan Readiness:        ✓ Operational
Broker Execution Readiness:  ○ Broker Not Connected (not a failure)
```

vs current:

```
Execution Preflight:  ⚠ UNAVAILABLE (misleading)
```

The platform health endpoint should read `tradePlanReadiness.status` separately from `brokerExecutionReadiness.status` and report them as two distinct health dimensions.

---

## 20. Compliance / Language

**Confirmed forbidden vocabulary** (from `shared/execution-types.ts:7`):
> READY_TO_TRADE, APPROVED, RECOMMENDED — must never appear.

**Forbidden in this design:**
- "recommended" — ✗
- "best trade" — ✗
- "suitable" — ✗
- "approved" — ✗
- "ready to trade" — ✗

**Approved vocabulary for the new architecture:**

| Concept | Approved Label |
|---|---|
| TPR passes | "Plan Ready" |
| BER passes | "Execution Preconditions Passed" |
| Broker absent | "Broker Connection Required for Execution" |
| CTA label | "Prepare for Execution" |
| Post-prep | "Review Order Draft" |
| Plan has issues | "Plan Requires Attention" |
| Execution blocked | "Execution Precondition Not Met" |

---

## 21. Failure Matrix

| Scenario | Trade Plan Readiness | Broker Execution Readiness | User-Visible Status | Allowed Next Action |
|---|---|---|---|---|
| **A.** No broker + independent plan PASS | **PASS** | NOT_CONNECTED | "Plan Ready / Connect Broker for Execution" | View plan, research, lifecycle check, scenario review |
| **B.** No broker + lifecycle requires review | **REQUIRES_REVIEW** | NOT_CONNECTED | "Plan Requires Review / Broker Not Connected" | Mark Research Reviewed; lifecycle re-evaluate |
| **C.** No broker + stale research | **FAIL** | NOT_CONNECTED | "Research Stale — Plan Needs Attention" | Lifecycle evaluation; update research |
| **D.** Broker connected + all dims pass | **PASS** | **READY** | "Plan Ready / Execution Preconditions Passed" | Prepare for Execution |
| **E.** Broker connected + quote stale | **PASS** | **BLOCKED** (dim 9 FAIL) | "Plan Ready / Quote Validation Failed" | Retry preflight; cannot prepare order |
| **F.** Broker connected + buying power insufficient | **PASS** | **BLOCKED** (dim 7 FAIL) | "Plan Ready / Insufficient Buying Power" | Adjust quantity or add funds; retry |
| **G.** Broker disconnected after prior preflight | **PASS** | NOT_CONNECTED | "Plan still Ready / Reconnect Broker for Execution" | View plan; research; reconnect broker |
| **H.** Broker reconnects | **PASS** | **READY** (if all pass) | "Plan Ready / Execution Preconditions Passed" | Prepare for Execution (no plan recreation) |
| **I.** Equity simple long, broker connected | **PASS** | **READY** (dim 8 = NOT_APPLICABLE) | "Plan Ready / Execution Preconditions Passed" | Full execution path |
| **J.** Covered call, shares not confirmed | **PASS** | **BLOCKED** (dim 8 FAIL — INSUFFICIENT_COVERED_SHARES) | "Plan Ready / Position Not Confirmed" | Verify 100 shares held; retry |
| **K.** CSP, buying power confirmed | **PASS** | **READY** (dim 7 PASS, dim 8 NOT_APPLICABLE for CSP cash) | "Plan Ready / Execution Preconditions Passed" | Full execution path |
| **L.** Multi-leg options, permissions lacking | **PASS** | **BLOCKED** (dim 6 FAIL — MULTILEG_NOT_SUPPORTED) | "Plan Ready / Multi-leg Permission Not Granted" | Cannot proceed; broker upgrade needed |

---

## 22. Test Plan

### 22.1 Required Test Suites for Implementation

**Suite 1: Brokerless Independent Preflight** (`brokerless-independent-preflight.test.ts`)
- [ ] `tradePlanReadiness.status` = PASS when dims 1,2,3,11,12 all pass; no broker
- [ ] `brokerExecutionReadiness` = null or `{ status: "NOT_CONNECTED" }` when no broker
- [ ] `overallStatus` = `"UNAVAILABLE"` (not FAIL) when no broker + plan healthy
- [ ] `executionAvailable` = false when no broker
- [ ] Lifecycle REQUIRES_REVIEW → `tradePlanReadiness.status` = REQUIRES_REVIEW (not FAIL)
- [ ] Lifecycle THESIS_INVALIDATED → `tradePlanReadiness.status` = FAIL

**Suite 2: TPR Never Authorizes Execution** (`preflight-layer-safety.test.ts`)
- [ ] `tradePlanReadiness.status === "PASS"` with no broker → `overallStatus !== "PASS"`
- [ ] `overallStatus !== "PASS"` → order-preparation-service returns PREFLIGHT_NOT_PASSING
- [ ] Both layers PASS → `overallStatus === "PASS"` → order-preparation accepts
- [ ] `executionAvailable = false` whenever `overallStatus !== "PASS"`

**Suite 3: Broker Transition** (`preflight-broker-transition.test.ts`)
- [ ] Plan created brokerless → broker connected → BER evaluates on next preflight run
- [ ] Plan created with broker → broker disconnected → TPR preserved; BER = NOT_CONNECTED
- [ ] No plan recreation needed in either direction

**Suite 4: Equity Independent Mode** (`preflight-equity-independent.test.ts`)
- [ ] Equity long plan, no broker: dim 8 = NOT_APPLICABLE (not UNAVAILABLE)
- [ ] Equity long plan, broker connected: dim 8 = PASS (no shares required)
- [ ] `tradePlanReadiness` PASS for healthy equity plan without broker

**Suite 5: Options Ownership** (`preflight-options-ownership.test.ts`)
- [ ] Covered call, no broker: dim 8 = NOT_CONFIRMED (not FAIL)
- [ ] Covered call, broker connected, shares confirmed: dim 8 = PASS
- [ ] Covered call, broker connected, shares missing: dim 8 = FAIL (INSUFFICIENT_COVERED_SHARES)
- [ ] CSP, no broker: dim 7 = NOT_CONNECTED, dim 8 = NOT_APPLICABLE
- [ ] CSP, broker connected, buying power confirmed: dim 7 = PASS

**Suite 6: Status Vocabulary** (`preflight-status-vocabulary.test.ts`)
- [ ] `NOT_CONNECTED` only appears in broker-layer dims (4–10), never in independent dims (1–3, 11–12)
- [ ] `NOT_APPLICABLE` only appears in dims where it is semantically correct (dim 8 for equity long)
- [ ] `NOT_CONFIRMED` only appears in options-specific dims without broker
- [ ] `PLANNING_MODE` only appears in equity dims 9/10 without broker
- [ ] Forbidden statuses (`READY_TO_TRADE`, `APPROVED`) never appear

**Suite 7: Backward Compatibility** (`preflight-backward-compatibility.test.ts`)
- [ ] `overallStatus` field still present in all responses
- [ ] `overallStatus === "PASS"` only when broker connected + all 12 dims pass
- [ ] Existing mocks with `overallStatus: "PASS"` still produce valid order-prep acceptance
- [ ] New fields are additive (existing fields not removed)

**Suite 8: Failure Matrix Scenarios** (`preflight-failure-matrix.test.ts`)
- [ ] All 12 scenarios from §21 produce the expected TPR + BER status combination

---

## 23. Documentation Updated

| File | Change |
|---|---|
| `docs/operations/48-audit-b-preflight-layering.md` | **NEW** — this document |
| `docs/operations/46-broker-independence-architecture.md` | References updated (see §24 below) |
| `docs/operations/47-audit-a-broker-gate-inventory.md` | Audit B reference added |
| `docs/operations/15-known-issues-and-backlog.md` | BI-001 through BI-003 scoping updated |
| `docs/operations/README.md` | Doc 48 entry added |
| `docs/operations/17-sprint-change-log.md` | Audit B entry added |

**Application code changed: NO**
