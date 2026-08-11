# Operations Document 40 — Equity Order Preview

**Sprint:** 2.8.2  
**Status:** ACTIVE  
**Methodology Version:** 2.8.2  
**Classification:** Non-Executable Preview Engine

---

## 1. What Is the Equity Order Preview?

The Equity Order Preview is a **read-only, ephemeral validation surface** that lets a trader review all material facts about a pending equity order draft before any submission pathway exists.

It is:
- A synthesis view: Trade Plan + Execution Preflight + Order Draft + Current Market Data
- Deterministic: all values computed from server-stored sources only
- Non-executable: no order is or can be sent to a broker at this stage
- Ephemeral: not persisted in a separate DB table; regenerated on each request

It is NOT:
- An order ticket
- A submission form
- A confirmation step (that is Sprint 2.8.5)
- An investment recommendation or suitability assessment

---

## 2. Permanent Architecture Invariants

These invariants are enforced at type level and runtime, and MUST NEVER be removed:

| Invariant | Enforcement |
|---|---|
| `executable: false` | `as const` on `EquityOrderPreview` — type-level impossible to set true |
| `expressionType === "STOCK"` | Enforced before any other computation; `WRONG_EXPRESSION_TYPE` blocker otherwise |
| `expressionSelectedBy === "USER"` | Always "USER" — read from trade plan; never from client |
| No broker mutation | `placeOrder`, `submitOrder`, `replaceOrder`, `cancelOrder` NEVER called |
| Draft values immutable | `draftLimitPrice`, `quantity`, `sideIntent`, `orderType`, `TIF` — NEVER changed by preview |
| Client injection rejected | Forbidden fields list enforced in route handler before any service call |
| No confirmation CTA | Sprint 2.8.5 only — no "Confirm", "Place Order", or "Submit" in this sprint |

---

## 3. Routes

All routes are read-only with respect to the OrderDraft, TradePlan, and Preflight.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/execution/order-drafts/:draftId/equity-preview` | Generate preview (ephemeral) |
| `GET` | `/api/execution/order-drafts/:draftId/equity-preview` | Get latest preview (regenerates) |
| `POST` | `/api/execution/order-drafts/:draftId/equity-preview/refresh` | Refresh with current quote |
| `GET` | `/api/execution/equity-preview/health` | Platform health metrics |

**No `/confirm`, `/submit`, `/place` routes exist.** They will be created in Sprint 2.8.5.

### Forbidden Client-Submitted Fields

The route handler rejects any request body containing:

```
symbol, quantity, side, sideIntent, orderType, timeInForce, limitPrice, quote,
bid, ask, account, accountRef, tradePlanVersion, riskContext, preflight,
broadExpressionType, selectedBy, selectedExpressionType
```

All these values are derived exclusively from server-stored sources.

---

## 4. Preview Status Lifecycle

| Status | Meaning |
|---|---|
| `VALID` | All checks pass; no blockers; no critical warnings |
| `REQUIRES_REVIEW` | Preflight expiry approaching; no critical blockers |
| `EXPIRED` | Order draft has expired; must return to Order Preparation |
| `INVALID` | Critical blockers (wrong expression type, plan not found, etc.) |
| `UNAVAILABLE` | Draft not found or cross-user access blocked |

### Status Promotion Rules

- Any blocker → REQUIRES_REVIEW (or INVALID for critical codes)
- `PREFLIGHT_EXPIRY_APPROACHING` warning → REQUIRES_REVIEW
- `QUOTE_MOVED` → warning only, does NOT affect status
- Expired draft → EXPIRED (not UNAVAILABLE)

---

## 5. Blocker Codes

| Code | When |
|---|---|
| `ORDER_DRAFT_NOT_FOUND` | Draft not found or cross-user |
| `ORDER_DRAFT_EXPIRED` | Draft `expiresAt` is in the past |
| `ORDER_DRAFT_ABANDONED` | Draft `status === "ABANDONED"` |
| `WRONG_EXPRESSION_TYPE` | `broadExpressionType ≠ "STOCK"` |
| `TRADE_PLAN_NOT_FOUND` | Trade plan not found or cross-user |
| `TRADE_PLAN_VERSION_CHANGED` | Plan version > draft's `tradePlanVersion` |
| `PREFLIGHT_MISSING` | Preflight result not found |
| `PREFLIGHT_EXPIRED` | Preflight `validUntil` is in the past |
| `PREFLIGHT_NOT_PASSING` | Preflight `status ≠ "PASS"` |
| `LIFECYCLE_THESIS_INVALIDATED` | Lifecycle state = `THESIS_INVALIDATED` |
| `LIFECYCLE_CHANGED` | Lifecycle state = `REQUIRES_REVIEW` or `DATA_STALE` |
| `QUOTE_STALE` | Fresh quote is null or `isStale = true` |
| `BROKER_DISCONNECTED` | Broker context shows `connected = false` |
| `INSUFFICIENT_BUYING_POWER` | Buying power check returns `FAIL` |
| `ORDER_TYPE_UNSUPPORTED` | Market order unsupported by broker config |
| `TIF_UNSUPPORTED` | TIF not in `supportedTimeInForce` |
| `EXECUTION_DISABLED` | Broker submission is disabled (warning only in runtime) |

---

## 6. Warning Codes

| Code | When |
|---|---|
| `EXECUTION_DISABLED` | `isExecutionEnabled() = false` |
| `MARKET_ORDER_PRICE_UNCERTAINTY` | Order type is MARKET |
| `MARKET_CLOSED` | Session state is CLOSED |
| `PRE_MARKET` | Session state is PRE_MARKET |
| `AFTER_HOURS` | Session state is AFTER_HOURS |
| `PREFLIGHT_EXPIRY_APPROACHING` | Preflight expiry < 5 min away |
| `QUOTE_MOVED` | Current mid differs from draft mid by ≥ 0.5% |
| `LIMIT_ABOVE_ASK` | Draft limit price ≥ current ask (LIMIT orders) |
| `LIMIT_BELOW_BID` | Draft limit price ≤ current bid (LIMIT orders) |

---

## 7. Service Architecture

### `generateEquityPreview` (pure computation)

Entry point in `server/services/equity-preview-service.ts`.

**Computation stages:**
1. Load OrderDraft (user-scoped via `getDraftById`)
2. Check draft status (ABANDONED) and expiry
3. Load TradePlan; enforce STOCK expression invariant
4. Load ExecutionPreflight; check expiry and status
5. Check plan version mismatch
6. Load lifecycle state (fire-and-forget, defaults to "UNKNOWN")
7. Load fresh quote (`getReferenceSnapshot` via daily-market-data module)
8. Load broker context (read-only adapter only)
9. Get buying power status (read-only)
10. Accumulate blockers (deterministic order)
11. Accumulate warnings (deterministic order)
12. Compute pricing context (MARKET vs LIMIT, estimated notional, limit relation)
13. Compute source integrity
14. Determine preview status
15. Compute `validUntil` = min(draft.expiresAt, preflight.validUntil, now + 10 min)
16. Build and return `EquityOrderPreview`
17. Append audit event (fire-and-forget)
18. Record health metrics

### Injectable Deps Pattern (`EquityPreviewDeps`)

All external I/O is injectable for test isolation:
- `getDraftById` — DB query, user-scoped
- `getTradePlan` — DB query, user-scoped
- `getPreflightResult` — DB query, plan-scoped
- `getCurrentLifecycleState` — lifecycle store
- `getQuoteForPreview` — reference snapshot module (read-only, never broker live)
- `getBuyingPowerStatus` — read-only broker adapter
- `getBrokerContext` — read-only broker adapter
- `appendAuditEvent` — fire-and-forget audit writer
- `isExecutionEnabled` — env flag reader

Production deps are wired via `createDbEquityPreviewDeps(userId)`.

---

## 8. Preview TTL

`validUntil = min(draft.expiresAt, preflight.validUntil, now + 10 min)`

- The 10-minute default (`EQUITY_PREVIEW_DEFAULT_TTL_MS = 600_000`) is a floor.
- If the preflight or draft expires sooner, the preview inherits the tighter bound.
- Preview is ephemeral — there is no DB row to "expire". TTL is informational.

---

## 9. Data Separation Principle

The preview always shows **two distinct value sets**:

| Context | Source | Mutability |
|---|---|---|
| Draft values (limit price, qty, side, TIF) | `OrderDraft.draftJson` | NEVER changed by preview |
| Current market data (bid, ask, midpoint, last) | `getReferenceSnapshot` | Fresh per-request |

These are labeled separately in the UI:
- "Draft Limit Price (Selected in Order Preparation)"
- "Current Market Data — Bid / Ask / Midpoint / Last"

---

## 10. Account Masking

The full account ref (`brokerAccountRef`) is NEVER returned to the client. The masked form uses `••••` + last 4 chars (e.g., `••••5678`).

The `maskAccountRef` helper in the service enforces this. The `FORBIDDEN_FIELDS` check in the route handler prevents the client from submitting an account ref directly.

---

## 11. Audit Events

Every preview generation writes one `EQUITY_PREVIEW_GENERATED` event to `execution_audit_events`.

**Allowed audit metadata fields:**
- `orderType`, `tif`, `status`, `blockerCount`, `warningCount`, `durationMs`, `quoteFreshnessCategory`

**Never included in audit metadata:**
- quantity, price, notional, limit price, account ID, symbol, userId (userId is the row-level column)

---

## 12. No New DB Tables

Sprint 2.8.2 introduces no new database tables. Audit events use the existing `execution_audit_events` table from Sprint 2.8.0.

---

## 13. Health Endpoint

`GET /api/execution/equity-preview/health` returns in-memory metrics (reset on restart):

```json
{
  "status": "ACTIVE",
  "feature": "equity-order-preview",
  "brokerSubmissionEnabled": false,
  "executionEnabled": false,
  "methodologyVersion": "2.8.2",
  "metrics": {
    "previewRequests": 0,
    "previewPasses": 0,
    "previewRequiresReview": 0,
    "previewExpired": 0,
    "previewFailures": 0,
    "averagePreviewLatencyMs": 0,
    "lastPreviewAt": null
  }
}
```

`brokerSubmissionEnabled` is always `false` in Sprint 2.8.2.

---

## 14. Compliance Constraints

### Forbidden Labels (never appear in any UI or response)

```
Ready to Trade, READY_TO_TRADE, Trade Approved, APPROVED, Execution Ready,
EXECUTION_READY, Good to Go, GOOD_TO_GO, Confirm & Submit, Place Order,
Submit Order, Buy Now, Sell Now, Execute, Send to Broker, Recommended Limit,
Recommended Quantity, Best Price, Guaranteed Fill, Expected Fill, Guaranteed Cost
```

### Required Disclaimers (always present)

1. **Non-execution banner**: "Preview Only — Nothing has been submitted to your broker."
2. **Equity preview disclaimer**: "This preview does not submit an order to your broker…"
3. **Execution price disclaimer**: "Prices shown are reference values only…"

### Side Intent Labels

| Code | Display |
|---|---|
| `OPEN_LONG` | Open Long Position |
| `CLOSE_LONG` | Close Long Position |
| `OPEN_SHORT` | Open Short Position (future) |
| `CLOSE_SHORT` | Close Short Position (future) |

---

## 15. Roadmap

| Sprint | Deliverable |
|---|---|
| **2.8.2** (current) | Equity Order Preview — read-only, non-executable |
| 2.8.3 | Options/Multi-Leg Preview |
| 2.8.4 | Cross-Leg Preview (Calendar/Diagonal) |
| **2.8.5** | Final Execution Validation + Broker Submission |

The "Continue to Final Execution Validation" CTA is visible but permanently disabled until Sprint 2.8.5.

---

## 16. Test Coverage

**`test:equity-preview`** — `server/routes/__tests__/equity-preview.test.ts`

136 tests covering:
- Compliance constants and forbidden labels
- `executable = false` invariant (all paths)
- STOCK expression invariant (LONG_OPTIONS, COVERED_CALL, null)
- `selectedBy = USER` invariant (all paths)
- Valid preview (happy path)
- Draft required / abandoned
- Draft expiry (EXPIRED status, refresh discipline)
- Trade plan version check
- Preflight expiry / missing / failing / approaching
- Lifecycle states (CURRENT, THESIS_INVALIDATED, REQUIRES_REVIEW)
- Broker / account masking
- Side intent labels
- User-selected quantity (not hypothetical)
- MARKET order (warning, notional at ask, no limit price)
- LIMIT order (draft price immutable, notional, limit relation, no MARKET warning)
- Quote data (bid/ask/midpoint/last, freshness)
- Draft vs current data separation (price movement)
- Market hours (OPEN/CLOSED/PRE_MARKET)
- Time in force (supported / unsupported)
- Estimated notional labels
- Source integrity
- Validity window
- Refresh does not mutate draft
- No submission / no confirmation
- Cross-user access blocked
- Client injection rejected
- Audit events
- Platform health metrics
- Roadmap discipline (no future-sprint fields)
