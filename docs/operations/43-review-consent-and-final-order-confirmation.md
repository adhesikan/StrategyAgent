# 43 — Review, Consent & Final Order Confirmation

**Sprint:** 2.8.5  
**Status:** ACTIVE  
**Category:** Execution Architecture — Human Review & Explicit Consent Layer  
**Prerequisite:** Sprint 2.8.4 (Execution Readiness & Guardrails)

---

## 1. Purpose

Sprint 2.8.5 builds the human review and explicit consent layer between Execution Readiness and future broker submission.

**Workflow:**
```
Trade Plan
→ Options Order Preview  (2.8.3)
→ Execution Readiness    (2.8.4)
→ Final Review & Confirm (2.8.5) ← this module
→ Broker Submission      (2.8.6, future — not yet implemented)
```

Sprint 2.8.5 must NOT submit anything to a broker. `brokerSubmissionEnabled: false` is a compile-time literal constant.

---

## 2. Core Concept

The user must confirm a **specific immutable order snapshot**.

The confirmation answers:
> "Did this authenticated user explicitly review and confirm this exact proposed order, with this exact pricing snapshot, readiness state, and risk context?"

A confirmation is **cryptographically bound** to its snapshot hash. The hash includes: `tradePlanId`, `orderPreviewId`, `executionReadinessId`, `userId`, `strategyFamily`, `symbol`, `legs`, `quantity`, `pricing`, `economics`, `readiness`, `marketDataObservedAt`, `reviewedDataVersion`.

---

## 3. Architecture Invariants

```
DETERMINISTIC — no LLM, ever.
   AI may EXPLAIN findings, warnings, or economics.
   AI may NEVER:
     - waive acknowledgements
     - confirm for the user
     - alter the snapshot
     - alter readiness status
     - approve broker submission

brokerSubmissionEnabled: false — literal type constant.
Confirmation is cryptographically bound to its exact snapshot hash.
A changed preview or changed readiness ALWAYS invalidates the snapshot.
BLOCKED readiness → no snapshot created.
Client-injected userId, snapshotHash, broker state → always rejected (HTTP 400).
Snapshot is immutable once created.
```

---

## 4. Snapshot Model

```typescript
FinalOrderReviewSnapshot {
  id: string                     // UUID, auto-generated
  tradePlanId: string
  orderPreviewId: string         // bound to specific preview
  executionReadinessId: string   // bound to specific readiness result
  userId: string                 // server-derived
  strategyFamily: string
  strategyLabel: string
  symbol: string
  companyName: string | null

  legs: FinalOrderReviewLeg[]    // immutable copy of preview legs
  quantity: number

  pricing: {
    pricingType: "DEBIT" | "CREDIT" | "EVEN" | "UNKNOWN"
    netPrice: number | null
    limitPrice: number | null
    estimatedNotional: number | null
    multiplier: number
  }

  economics: {
    estimatedMaxProfit: number | null   // null = not calculable
    estimatedMaxLoss: number | null     // null = not calculable
    estimatedCapitalRequired: number | null
    breakEvenPoints: number[]
    capitalSource: "calculated" | "readiness_estimate" | "unavailable"
    profitSource: "calculated" | "unavailable"
    lossSource: "calculated" | "unavailable"
    feesDisclaimer: string
  }

  readiness: {
    status: "READY" | "READY_WITH_WARNINGS"
    blockerCount: number
    warningCount: number
    findingCodes: string[]
  }

  acknowledgements: OrderAcknowledgement[]

  marketDataObservedAt: string | null
  reviewedDataVersion: string          // "1" in v1

  snapshotHash: string                 // SHA-256 of canonical payload
  state: "CREATED" | "VIEWED" | "CONFIRMED" | "EXPIRED" | "INVALIDATED"
  createdAt: string
  expiresAt: string                    // createdAt + snapshotTtlSeconds
  invalidatedAt: string | null
  invalidationReason: string | null
}
```

---

## 5. Canonical Hashing

The `snapshotHash` is computed as:

```
SHA-256( JSON.stringify( sortObjectKeys( canonicalPayload ) ) )
```

The canonical payload includes:
```
{ tradePlanId, orderPreviewId, executionReadinessId, userId,
  strategyFamily, symbol, legs, quantity, pricing, economics,
  readiness, marketDataObservedAt, reviewedDataVersion }
```

**Excluded from hash** (volatile fields):
- `id`, `createdAt`, `expiresAt`, `invalidatedAt`, `invalidationReason`, `state`

**Hash properties:**
- Deterministic: same business state → same hash
- Any business-state change → different hash
- Object keys sorted alphabetically at all nesting levels
- Arrays preserve order

**Tests:** scenarios §7–11 verify determinism and field sensitivity.

---

## 6. Snapshot Eligibility

A snapshot may only be created when:
- Execution readiness exists
- Readiness status is **not BLOCKED**
- User owns the trade plan (session-scoped)

BLOCKED readiness → `CR_BLOCKED_NOT_ELIGIBLE` (HTTP 422).

No readiness → `CR_NO_READINESS` (HTTP 422).

---

## 7. Snapshot Immutability

Once created, a snapshot is immutable. Fields never mutated:
- legs, quantity, pricing, account context
- readiness result, capital estimate, risk metrics

If any of these change: create a **new snapshot**. Never update the old one.

When a new snapshot is created for the same user+trade plan, all previous non-confirmed snapshots are marked `INVALIDATED`.

---

## 8. Snapshot Expiration

Default TTL: **120 seconds** (configurable via `FinalReviewConfig.snapshotTtlSeconds`).

This is intentionally short because options quotes move quickly.

State transition: `CREATED`/`VIEWED` + TTL exceeded → `EXPIRED` on next GET or confirm attempt.

If expired: return `CR_SNAPSHOT_EXPIRED`. User must create a new review.

---

## 9. Snapshot Invalidation

A snapshot is invalidated when:
- New preview is generated (preview ID changes)
- New readiness result is computed (readiness ID changes)
- Pricing changes beyond tolerance (v1: any change)
- Market data becomes stale
- Trade plan is changed
- User triggers "new review"

Invalidation is recorded as `INVALIDATED` state with `invalidationReason`.

**The key invariant:** Confirmation cannot survive a changed preview or changed readiness result.

---

## 10. Confirmation State Model

```
CREATED     → snapshot created, not yet viewed
VIEWED      → user has loaded the review panel
CONFIRMED   → user explicitly confirmed all required acknowledgements
EXPIRED     → TTL exceeded before confirmation
INVALIDATED → order data changed, new review required
```

**Forbidden state names:** APPROVED, AUTHORIZED, RECOMMENDED, CLEARED, TRADE_APPROVED, AI_CONFIRMED.

---

## 11. Acknowledgements

Generated deterministically from order structure — no LLM involvement.

| Code | Required | Trigger |
|---|---|---|
| `ACK_REVIEWED_ORDER` | ✅ | Always (all options orders) |
| `ACK_OPTIONS_RISK` | ✅ | Always (all options orders) |
| `ACK_SHORT_ASSIGNMENT` | ✅ | Any leg with `isShortIntent(intent)` |
| `ACK_ZERO_DTE` | ✅ | Any leg with `dte === 0` |
| `ACK_DEFINED_RISK_ESTIMATE` | ✅ | `bull_call_spread`, `bear_put_spread`, `bull_put_spread`, `bear_call_spread`, `iron_condor`, `iron_butterfly`, `collar` |
| `ACK_BUYING_POWER_ESTIMATE` | ✅ | Capital estimate present in readiness result |
| `ACK_MULTI_LEG` | ⬜ | `MULTI_LEG_OPTION` instrument type |
| `ACK_NEAR_EXPIRATION` | ⬜ | Any leg with `dte > 0 && dte <= 2` |
| `ACK_MARKET_CLOSED` | ⬜ | `MARKET_CLOSED_WARNING` finding in readiness |

**Server-side validation:** client sends acknowledgement codes; server validates all required ones are present. Extra codes are accepted but do not bypass missing required ones.

---

## 12. Server-Side Revalidation at Confirm Time

Before accepting confirmation, the server revalidates:

1. Snapshot not expired
2. Snapshot not invalidated
3. Current readiness not BLOCKED
4. Readiness ID unchanged (`executionReadinessId` matches)
5. Preview ID unchanged (if preview loadable)
6. Pricing unchanged (v1: any net price change invalidates)
7. Quote freshness still acceptable

If any check fails: return appropriate error code. Never silently regenerate and confirm.

Error codes:
- `CR_SNAPSHOT_EXPIRED` → create new review
- `CR_SNAPSHOT_INVALIDATED` → create new review
- `CR_READINESS_NOW_BLOCKED` → resolve blockers, re-check readiness, create new review
- `CR_CONFIRMATION_REVIEW_REQUIRED` → readiness result changed, create new review
- `CR_PREVIEW_CHANGED` → preview regenerated, create new review
- `CR_PRICING_CHANGED` → price moved, create new review
- `CR_MARKET_DATA_STALE` → refresh quotes, create new review

---

## 13. Idempotency

Confirmation is idempotent: same `(snapshotId, userId)` → return existing confirmation.

DB uniqueness constraint: `UNIQUE(snapshot_id, user_id)` on `order_confirmations`.

Double-click or concurrent tab → same confirmation record returned, not duplicated.

---

## 14. Economics Displayed

| Field | Source | If Unavailable |
|---|---|---|
| Max Profit | `riskContext.maxGain` | "Not available" |
| Max Loss | `riskContext.maxLoss` → debit total | "Not available" |
| Capital Required | `capitalEstimate.estimatedRequirementUsd` | "Not available" |
| Break-even | `riskContext.breakevens` | "Not available" |

Fees disclaimer: "Broker fees, commissions, exchange fees, and regulatory fees may not be included."

Never fabricate a metric that cannot be calculated.

---

## 15. Database

### `final_order_review_snapshots`

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR | PK |
| trade_plan_id | VARCHAR | Indexed |
| order_preview_id | VARCHAR | Bound to specific preview |
| execution_readiness_id | VARCHAR | Bound to specific readiness |
| user_id | VARCHAR | Owner |
| snapshot_json | JSONB | Full immutable snapshot |
| snapshot_hash | VARCHAR | SHA-256 |
| state | VARCHAR | CREATED/VIEWED/CONFIRMED/EXPIRED/INVALIDATED |
| created_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | created_at + TTL |
| invalidated_at | TIMESTAMPTZ | Nullable |
| invalidation_reason | TEXT | Nullable |

### `order_confirmations`

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR | PK |
| snapshot_id | VARCHAR | FK to snapshot |
| user_id | VARCHAR | |
| snapshot_hash | VARCHAR | Hash at time of confirmation |
| acknowledgement_codes | JSONB | Array of strings |
| confirmed_at | TIMESTAMPTZ | |
| ip_metadata | VARCHAR | Not collected in v1 |
| user_agent_metadata | VARCHAR | Not collected in v1 |
| UNIQUE | (snapshot_id, user_id) | Idempotency constraint |

### `order_confirmation_audit_events`

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR | PK |
| trade_plan_id | VARCHAR | |
| snapshot_id | VARCHAR | |
| user_id | VARCHAR | |
| event_type | VARCHAR | See audit events below |
| event_at | TIMESTAMPTZ | |
| snapshot_hash | VARCHAR | |
| metadata | JSONB | Non-sensitive only |

All three tables created via raw SQL in `ensureOrderConfirmationTables()`. No Drizzle schema change.

---

## 16. API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/execution/order-confirmation/health` | Health (static — before dynamic) |
| `POST` | `/api/trade-plans/:id/final-review` | Create snapshot |
| `GET` | `/api/trade-plans/:id/final-review` | Get latest snapshot |
| `POST` | `/api/trade-plans/:id/final-review/:sid/confirm` | Confirm |

### POST Create Snapshot

Body: `{}` (no fields required from client)

Forbidden client fields rejected (HTTP 400): `userId`, `snapshotHash`, `readinessStatus`, `brokerCapabilities`, `buyingPower`, `positions`, `forceConfirm`, `approved`, etc.

Returns: `{ snapshot, acknowledgements, expiresAt, brokerSubmissionEnabled: false }`

### GET Latest Snapshot

Updates state: CREATED → VIEWED; expired → EXPIRED.

Returns: `{ snapshot, confirmation | null, brokerSubmissionEnabled: false }`

### POST Confirm

Body: `{ acknowledgementCodes: string[] }` — only field accepted from client.

Revalidates server-side before accepting.

Returns: `{ confirmation, message: "Order Confirmed", nextStep: "Ready for the next submission step.", brokerSubmissionEnabled: false }`

---

## 17. Audit Events

| Event | Trigger |
|---|---|
| `FINAL_REVIEW_CREATED` | Snapshot persisted |
| `FINAL_REVIEW_VIEWED` | GET updates state CREATED → VIEWED |
| `FINAL_REVIEW_CONFIRMED` | Confirmation accepted |
| `FINAL_REVIEW_EXPIRED` | State updated to EXPIRED |
| `FINAL_REVIEW_INVALIDATED` | State updated to INVALIDATED |
| `ORDER_CONFIRMED` | Confirmation record persisted |

**Never logged:** raw broker credentials, full account IDs, session tokens, buying power values, position details.

Audit logging is fire-and-forget — never blocks the response.

---

## 18. Security Controls

Server derives — never accepts from client:
- User identity (always from session)
- Trade plan ownership (DB query scoped to userId)
- Snapshot ownership (DB query scoped to userId)
- Snapshot hash (always server-computed SHA-256)
- Readiness status (loaded from DB, not client)
- Broker/account context (loaded via server-side adapter)

Forbidden client fields → immediate HTTP 400 `CR_FORBIDDEN_FIELD`.

Ownership check (belt-and-suspenders): DB query scoped to userId + explicit `snapshot.userId !== userId` check.

---

## 19. Compliance Controls

**Forbidden labels (never appear in UI or responses):**
- Approved, Authorized, Recommended, Guaranteed
- Safe Trade, Best Trade, AI Approved, Trade Approved
- AI Authorized, Auto Confirmed, Execution Authorized

**Allowed labels:**
- Ready for Review, Ready with Warnings, Blocked
- Confirmed, Order Confirmed, Ready for the next submission step.

Compliance disclaimer: "This is not investment advice. Options involve risk and are not appropriate for all investors."

Button label: "Confirm Order for Submission" — note text: "Confirmation does not send the order to your broker."

---

## 20. AI Boundary

```
AI     ← snapshot + economics → UI
         DETERMINISTIC
          confirmation engine
              ↑
         Server-side only
         No LLM call
```

The LLM (AI assistant) may:
- Explain what a warning means
- Explain assignment risk
- Explain what max loss means

The LLM may NEVER:
- Waive acknowledgements
- Confirm for the user
- Alter the snapshot
- Alter readiness status
- Change BLOCKED to READY
- Approve broker submission

This boundary is enforced at the service level: `buildFinalOrderReviewSnapshot`, `determineRequiredAcknowledgements`, and `revalidateBeforeConfirm` are all pure functions with no LLM calls.

---

## 21. UI

Component: `client/src/components/execution/FinalOrderReviewPanel`

Sections:
1. Order Summary (strategy, symbol, quantity, net price, order type)
2. Legs (per-leg table: direction, contract, type, strike, expiration, DTE)
3. Estimated Economics (max profit/loss, capital, break-even)
4. Execution Readiness status summary
5. Snapshot expiry display
6. Acknowledgement checkboxes
7. Confirm button + "Confirmation does not send the order to your broker."

State-based rendering:
- No snapshot → "Generate Review Snapshot" button
- Loading → spinner
- EXPIRED/INVALIDATED → error banner + "New Review" button
- CONFIRMED → green banner with hash display
- Active (CREATED/VIEWED) → full review UI

Shown below `ExecutionReadinessPanel` for all options families.

---

## 22. Snapshot Configuration

```typescript
DEFAULT_FINAL_REVIEW_CONFIG = {
  snapshotTtlSeconds: 120,     // 2 minutes — intentionally short
  reviewedDataVersion: "1",    // bump when snapshot schema changes
  netPriceTolerance: 0,        // v1: any price change invalidates
};
```

---

## 23. Review Schema Versioning

`reviewedDataVersion` is included in the canonical hash. Any schema change that affects business meaning must bump this version. This ensures old audit records remain valid and readable even after schema evolution.

---

## 24. Test Coverage

Test file: `server/routes/__tests__/order-confirmation.test.ts`

72+ test scenarios covering all 44 spec requirements plus additional invariants:
- All 9 snapshot lifecycle states
- SHA-256 hash determinism and field sensitivity  
- All acknowledgement code triggers
- All revalidation failure scenarios
- Capital estimate and economics calculations
- Compliance labels
- Security (no forbidden labels, no broker credentials in snapshot)
- Idempotency semantics
- No LLM dependency
- No broker submission

Run: `npm run test:order-confirmation`

---

## 25. Limitations (v1)

- `netPriceTolerance: 0` — any price change invalidates. Future sprint may add user-configurable limit flexibility.
- `ipMetadata` and `userAgentMetadata` not collected (v1). May be added if legal/compliance requires it.
- Preview revalidation at confirm time is best-effort — if preview cannot be loaded, pricing change check is skipped. A future sprint should make this more robust.
- Fees not estimated — always disclaimed.
- Trade plan lifecycle state (`AWAITING_CONFIRMATION`, `CONFIRMED`) not yet wired to existing `trade_plan_activity` table — deferred to 2.8.6 integration.

---

## 26. 2.8.6 Handoff — Broker Submission Orchestration

The next sprint after this is the major safety boundary:

```
Before any live broker submission:
✅ Explicit feature flag (EXECUTION_ENABLED or equivalent)
✅ Broker adapter isolation (per-provider)
✅ Idempotency keys (broker-side)
✅ Broker timeout handling (Task #138)
✅ Live quote integration tests (Task #139)
✅ Dry-run/paper environment where available
✅ Immutable confirmed snapshot from 2.8.5
✅ Final server-side stale-data check
✅ Strict account ownership verification
✅ Broker response persistence
✅ Zero autonomous execution
✅ Full audit trail from 2.8.3–2.8.5
```

Do NOT implement 2.8.6 until all of the above are in place.

---

## 27. Key Confirmation Invariant

**Confirmation cannot survive a changed preview or changed readiness result.**

This invariant is what makes Sprint 2.8.6 safe:
- The confirmed snapshot hash binds exactly the preview and readiness used
- At submission time, 2.8.6 will verify the snapshot hash matches the stored confirmation
- Any change between confirmation and submission → immediate rejection
- No replay attacks possible
