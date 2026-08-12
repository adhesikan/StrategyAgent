# Doc 45 — TEST_LIVE Execution Certification

**Sprint:** 2.8.6A / 2.8.6A-defect-1  
**Classification:** Controlled Certification  
**Purpose:** Record and guide the controlled TEST_LIVE certification of the Sprint 2.8.6 broker-submission pipeline.

---

## Production Defect Record — Self-Healing Ranking Hydration (Defect-3)

**Defect ID:** 2.8.6A-defect-3  
**Severity:** Critical (BLOCKING — same symptom as Defect-2 after deploy)  
**Status:** FIXED

### Symptom
After Defect-2 fix was deployed to Railway: WMT still rejected with "WMT is not a current research candidate" from Trade Planning.

### Why Defect-2 Was Insufficient
`scheduleOpportunityEngine()` is fire-and-forget (returns void immediately). The HTTP server was accepting requests while `initOpportunityEngine()` (and its new `computeRankingForSnapshot`) was still running async. Requests in this startup window saw `getLatestRanking() === null`. Additionally `getOpportunityIntelligence()` had no DB fallback — null ranking = null result, immediately.

### Root Cause
- **Startup ordering gap**: async init vs synchronous server-ready state
- **No lazy hydration**: `getOpportunityIntelligence()` had zero fallback when ranking was null
- **Error conflation**: 503 (infra down) and 404 (symbol absent) produced identical user messages

### Architecture Fix
`getOpportunityIntelligence()` now calls `ensureRankingHydrated()` before reading the ranking:
1. Fast path: ranking non-null → proceed immediately (no DB overhead)
2. Ranking is null → load persisted snapshot from DB, compute ranking, set it
3. Stampede protection: shared `rankingHydrationPromise` prevents concurrent DB floods
4. After hydration (success or failure), proceed with whatever ranking state is available

### Error Distinction
- `503 OPPORTUNITY_DATA_UNAVAILABLE` — ranking could not be hydrated (infrastructure)
- `404 NOT_IN_CURRENT_SNAPSHOT` — ranking hydrated, symbol genuinely absent

### New Client Behavior
Trade Planning shows "Try Again" button for 503. Shows "not a candidate" only for 404. Opportunity Workspace shows degraded notice when `opportunityEngineAvailable: false`.

### Railway UAT Protocol (Post-Deploy)
1. Open `/trade-planning/WMT` — should load (not reject)
2. Refresh 10 times — every request must consistently load Trade Planning
3. Navigate `/opportunities/WMT` → "Open Trade Planning" → `/trade-planning/WMT` — repeat 5 times, no intermittent rejection
4. Restart a Railway replica — immediately after healthy startup, Trade Planning should work without winning advisory scan lock
5. Check Platform Health `/admin/platform-health` — Opportunity Intelligence card should show `rankingAvailable: true` and `hydrationFailureCount: 0` after successful startup

### Permanent Invariant
Advisory lock controls expensive scan only. Read eligibility (ranking access) is independent of lock ownership. Every instance self-heals from the persisted DB snapshot.

### Test Coverage  
Comprehensive tests in `candidate-consistency-v2.test.ts` covering §13–§18, §26, §29.

---

## Production Defect Record — Trade Planning Candidate Consistency Mismatch

**Defect ID:** 2.8.6A-defect-2  
**Severity:** High (BLOCKING — end-to-end certification flow broken)  
**Status:** FIXED

### Symptom
During TEST_LIVE UAT: WMT shown as #1 Top Growth (score 66) → Opportunity Workspace showed "Open Trade Planning" CTA → `/trade-planning/WMT` returned "WMT is not a current research candidate."

### Root Cause
`initOpportunityEngine()` loaded the DB snapshot into `latestSnapshot` but did NOT compute the in-memory ranking or call `setLatestRanking()`. Only the Railway instance that won the PostgreSQL advisory lock during `runOpportunityEngine()` got `setLatestRanking()` called. Other instances served `getLatestRanking() === null`, causing `getCanonicalOpportunity()` to return null for all symbols including WMT.

### Canonical Opportunity Source
The persisted `opportunity_scan_snapshots` DB table is the authoritative source. `getLatestRanking()` is the in-memory view, now always computed from the DB snapshot during `initOpportunityEngine()` on every instance.

### Fix
1. `initOpportunityEngine()` calls `computeRankingForSnapshot` + `setLatestRanking` after loading the DB snapshot — all instances converge on startup.
2. `WorkspaceV2Response.tradePlanningEligible` added — server-authoritative boolean.
3. Client CTA gated on `tradePlanningEligible`, not re-derived client-side.
4. Trade Planning 404 response includes `code: "NOT_IN_CURRENT_SNAPSHOT"`.

### Cross-Surface Invariant
Symbol in any ranking bucket → `tradePlanningEligible: true` → Trade Planning accepts it.  
Symbol absent from ranking → `tradePlanningEligible: false` → CTA hidden.

### Test Coverage
34 new pure tests in `server/routes/__tests__/candidate-consistency.test.ts` (20 suites total).

---

## Production Defect Record — TEST_LIVE Admin Authorization Mismatch

**Defect ID:** 2.8.6A-defect-1  
**Severity:** High (certification page returns 403 for valid admin session)  
**Status:** FIXED

### Symptom
`GET /api/admin/test-live/config-audit` returned `{"error":"Admin access required for TEST_LIVE certification."}` for a logged-in administrator who could access all other admin surfaces (Platform Health, Operations Manual, etc.).

### Root Cause
`registerTestLiveCertificationRoutes` only accepted `isAuthenticated` — `isAdmin` was not passed to it. Instead, the function contained an inline `requireAdmin` middleware that had two bugs:

1. **Wrong storage**: Used `storage.getUser()` (the in-memory stub, always returns undefined for real users) instead of `authStorage.getUser()` (the real PostgreSQL user rows). This is the established footgun documented in [User lookup — authStorage vs storage](../agents/memory/user-lookup-storage.md).
2. **Role string mismatch**: Compared `user.role !== "admin"` (string literal) instead of `user.role !== UserRole.ADMIN` (canonical enum used by all other admin guards).

### Canonical Admin Authorization Mechanism
The application defines **one** `isAdmin` middleware in `server/routes.ts`:
```typescript
const isAdmin: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  const user = await authStorage.getUser(req.session.userId);  // real DB rows
  if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ message: "Forbidden: Admin access required" });
  next();
};
```
This is passed as a parameter to all admin route registration functions (Platform Health, Operations Manual, News Sentiment, MCP Status, etc.).

### Fix
1. Updated `registerTestLiveCertificationRoutes(app, isAuthenticated, isAdmin)` to accept `isAdmin` as a 3rd parameter.
2. Removed the inline `requireAdmin` — all 5 routes now use `isAuthenticated, isAdmin` (identical to Platform Health).
3. Passed `isAdmin` in the call site (`server/routes.ts`).

### Behavior After Fix
| Caller | Status |
|---|---|
| Unauthenticated | 401 (from `isAuthenticated`) |
| Authenticated non-admin | 403 (from `isAdmin`) |
| Authenticated admin | 200 |

### Invariant Added
`registerTestLiveCertificationRoutes.length === 3` — tested in `§11 Admin consistency` suite. Any future change that removes `isAdmin` from the signature will fail this test.

### Files Changed
- `server/routes/test-live-certification.ts` — removed inline `requireAdmin`, added `isAdmin` param, all 5 routes updated
- `server/routes.ts` — passes `isAdmin` to `registerTestLiveCertificationRoutes`
- `client/src/pages/admin-test-live-certification.tsx` — added 401/403/500 error states to config audit, market status, and account panels
- `server/routes/__tests__/test-live-certification.test.ts` — added §11 (admin consistency), §12 (security negative tests), §17 (admin does not bypass safety gates)

---

---

## 1. Overview

Sprint 2.8.6 delivered the full execution pipeline:
- 15-state ExecutionIntent state machine (atomic DB transitions)
- Persist-before-send submission architecture
- Fail-closed TEST_LIVE safety gates (account/symbol allowlists, all caps required)
- PRODUCTION mode permanently blocked (compile-time constant)
- SANDBOX Tradier routing (`sandbox:` prefix → paper token)
- Multi-leg orders rejected (no partial-submit risk)

Sprint 2.8.6A certifies this pipeline by running exactly **one** deliberately controlled live equity order through the complete workflow using the dedicated test brokerage account.

---

## 2. Certification Infrastructure

**Admin UI:** `/admin/test-live-certification`  
**API base:** `/api/admin/test-live/`

| Endpoint | Purpose |
|---|---|
| `GET /config-audit` | Section 1–2: all 10 config gates, safe status only |
| `GET /market-status` | Section 6: NYSE session check |
| `GET /account-status` | Section 2: broker account + allowlist verification |
| `POST /disarm` | Section 30: post-certification disarm instructions |
| `GET /completion-report` | Section 34: 48-item completion report |

---

## 3. Required Environment Configuration

All variables must be set in Replit Secrets before certification. Set them in the correct order to avoid premature execution.

| Variable | Required | Purpose | Safe value for certification |
|---|---|---|---|
| `BROKER_EXECUTION_ENABLED` | Yes | Global kill switch | `true` |
| `BROKER_EXECUTION_MODE` | Yes | Must be exactly `test_live` | `test_live` |
| `TRADIER_EXECUTION_ENABLED` or `TRADESTATION_EXECUTION_ENABLED` | Yes (one) | Provider flag | `true` for your provider |
| `EXECUTION_TEST_LIVE_ARMED` | Yes | Arms TEST_LIVE | `true` |
| `EXECUTION_TEST_LIVE_ARMED_UNTIL` | Recommended | Auto-expiry ISO timestamp | e.g. `2026-08-11T22:00:00Z` |
| `EXECUTION_TEST_ACCOUNT_ALLOWLIST` | Yes | Comma-sep account IDs | Your test account ID |
| `EXECUTION_TEST_SYMBOL_ALLOWLIST` | Yes | Comma-sep symbols | e.g. `AAPL,MSFT` |
| `EXECUTION_TEST_MAX_NOTIONAL` | Yes | Max USD per order | e.g. `250` |
| `EXECUTION_TEST_MAX_EQUITY_QTY` | Yes | Max shares per order | `1` |
| `EXECUTION_TEST_MAX_OPTION_CONTRACTS` | No | Max option contracts | Not required for equity cert |

**NEVER set `BROKER_EXECUTION_MODE=production`**. The PRODUCTION block is a compile-time constant; this env var has no effect, but setting it documents intent and is prohibited.

---

## 4. Fail-Closed Safety Summary

| Gate | Behavior when unconfigured |
|---|---|
| Account allowlist | Empty → ALL accounts blocked |
| Symbol allowlist | Empty → ALL symbols blocked |
| Notional cap | Null → ALL orders blocked (required) |
| Equity qty cap | Null → ALL equity orders blocked (required) |
| Option contracts cap | Null → ALL option orders blocked (required for options) |
| Market orders | Always banned in TEST_LIVE |
| Multi-leg orders | Always banned (no partial-fill risk) |
| PRODUCTION mode | Permanently blocked (compile-time constant) |

---

## 5. Certification Workflow

### Step 1: Config Audit (§1–2)
Navigate to `/admin/test-live-certification` → Panel 1.  
All 10 required gates must show **PASS**. Fix any **FAIL** or **NOT_CONFIGURED** gates before proceeding.

### Step 2: Market Status (§6)
Panel 2 must show **OPEN** (NYSE regular session, 9:30–16:00 ET, Mon–Fri).  
If closed → return `READY_BUT_MARKET_CLOSED`. Do not proceed.

### Step 3: Account Verification (§2)
Panel 3 must show:
- Connected: Yes
- Masked account ref: displayed (`***XXXX`)
- In allowlist: Yes
- Requires reauth: No

### Step 4: Full Workflow (§7–13)
Use the standard execution pipeline pages:
1. Create/open a dedicated equity test Trade Plan (`broadExpressionType=STOCK`, `selectedBy=USER`)
2. Run Execution Preflight → must pass all 12 dimensions
3. Create OrderDraft: 1 share, LIMIT, user-selected price, TIF=day
4. Generate Equity Order Preview → confirm current bid/ask, estimated notional
5. Build Final Order Review → record snapshot hash prefix
6. Obtain all 5 required TEST_LIVE acknowledgements (none pre-checked)
7. Final revalidation runs automatically on submit

### Step 5: Acknowledgements (§12)
Panel 5 on the certification page. All five checkboxes must be manually checked:
- This is a LIVE test order
- Real money may be affected
- Real position may result
- Quotes may change
- Limit order may not execute

### Step 6: Submission (§14)
Navigate to `/executions/:id` for your confirmed ExecutionIntent.  
Verify the pre-submit summary (mode, account, symbol, qty, limit, notional, snapshot hash prefix).  
Click **Submit Live Test Order** — exactly one broker mutation occurs.

### Step 7: Post-Submission (§15–29)
On the Execution Detail page verify:
- State: `BROKER_ACCEPTED`, `FILLED`, or `SUBMISSION_UNKNOWN`
- Broker order reference received (or UNKNOWN noted)
- If SUBMISSION_UNKNOWN: use "Check Broker Status" → reconcile
- Fill record persisted (if filled)
- Position link verified (if filled and broker confirms)
- Duplicate protection: reload confirmation path → zero additional mutations
- Audit trail: events present for all lifecycle stages

### Step 8: Platform Health (§26)
Navigate to `/admin/platform-health` → Execution section.  
Verify no stuck `SUBMISSION_IN_PROGRESS`, fill metrics accurate, production mode still disabled.

### Step 9: Disarm (§30)
On Panel 9 of the certification page, click **Generate Disarm Instructions**.  
Then: remove `EXECUTION_TEST_LIVE_ARMED` from Replit Secrets (or set to `false`) and restart.

---

## 6. Defect Policy

If any of the following occur, **STOP IMMEDIATELY** and classify as P0 / NO_GO:

- Duplicate broker order
- Account mismatch (wrong account received order)
- Quantity mismatch (more than 1 share submitted)
- Price mismatch (different from user-selected limit)
- Wrong symbol submitted
- Unexpected market order (should always be LIMIT)
- Blind retry (second broker mutation after UNKNOWN)
- Ambiguous response resubmission
- Confirmation replay resulted in new order
- Security boundary failure (credentials in logs, etc.)

**Response:** Disable execution (set `BROKER_EXECUTION_ENABLED=false`), document findings, open P0 incident.

---

## 7. Completion Report Template

The 48-item completion report is generated automatically at `/api/admin/test-live/completion-report`.  
Update the live test fields (`liveTestResult`) after the test run by passing them to `buildCompletionReport()`.

Key items that require a live run to complete (items 17–44):
- Items 17–25: Preflight → ExecutionIntent creation
- Items 26–29: Broker mutation and acknowledgement
- Items 30–31: Ambiguous response handling (if applicable)
- Items 32–33: Fill result
- Items 34–35: Position link
- Items 36–37: Replay and duplicate protection tests
- Items 38–41: Audit trail, log review, Platform Health
- Items 42–44: Defects, regression tests, disarm confirmation

---

## 8. Certification Record

*(Fill in after live test run)*

| Field | Value |
|---|---|
| Release SHA | — |
| Provider | — |
| Execution mode | test_live |
| Test account (masked) | — |
| Test symbol | — |
| Quantity | 1 share |
| Order type | LIMIT |
| Notional (class) | < configured cap |
| Preflight result | — |
| Confirmation hash prefix | — |
| ExecutionIntent ID (masked) | — |
| Broker order ref (masked) | — |
| Final state | — |
| Fill result | — |
| Position link | — |
| Duplicate protection | — |
| Log review | — |
| Platform Health | — |
| TEST_LIVE disarmed | — |
| Defects found | — |
| Decision | CONDITIONAL_GO (pending live run) |
| Certified by | — |
| Certification date | — |

---

## Defect-4 Record — Authentication 401 on /api/trade-planning/:symbol/context

| Field | Value |
|---|---|
| Defect | GET /api/trade-planning/WMT/context → 401 for authenticated user |
| Discovered | Railway UAT — browser Network tab |
| Confirmed concurrently working | GET /api/auth/user → 200, GET /api/opportunities/workspace/WMT → 200 |
| Root cause | 19 route handlers in trade-planning.ts used `(req as any).user?.id` (always undefined — no Passport in this app) instead of `req.session.userId!` |
| Secondary bug | getPlanningSession args were swapped (sessionId, userId) in 9 call sites |
| Auth contract | `req.session.userId!` — populated by express-session, declared in SessionData interface, guaranteed non-null after isAuthenticated middleware |
| isAuthenticated middleware | Checks `req.session.userId` in `server/replit_integrations/auth/sessionAuth.ts:52` — calls next() only when set |
| Gap | isAuthenticated passed (session.userId present) but the handler immediately returned 401 because req.user was never set |
| Fix files | server/routes/trade-planning.ts, client/src/pages/trade-planning.tsx |
| Client fix | 401 now shows "Your session could not be verified. Please sign in again." instead of "not a current research candidate" |
| Regression test | server/routes/__tests__/trade-planning-auth.test.ts — §AUTH1–§AUTH20 (44 tests) |
| Release gate | 22 suites / 1,524 tests passing |
| Status | READY_FOR_RAILWAY_REDEPLOY |

**Railway UAT after redeploy (Defect-4)**:

A. Login normally → `/api/auth/user` → 200 ✓

B. Open WMT Opportunity Workspace → `tradePlanningEligible: true` ✓

C. Click "Open Trade Planning" → `/api/trade-planning/WMT/context` → **MUST return 200** (was 401)

D. Trade Planning UI renders fully ✓

E. Refresh `/trade-planning/WMT` at least 5 times → every context request returns 200 ✓

F. Log out → directly request `/api/trade-planning/WMT/context` → **MUST return 401** ✓

---

## 9. Post-Certification Actions

1. **Disarm**: Remove/set `EXECUTION_TEST_LIVE_ARMED=false` in Replit Secrets
2. **Restart**: Redeploy to pick up disarmed config
3. **Verify**: `/admin/test-live-certification` Panel 9 shows "not armed"
4. **Platform Health**: Confirm execution section shows UNARMED
5. **Document**: Update the Certification Record table above
6. **Sprint 2.8.7**: After LIVE_TEST_CERTIFIED, proceed to next sprint

---

## 10. Related Documents

- [Doc 13](./13-production-release-checklist.md) — Production release checklist
- [Doc 17](./17-sprint-change-log.md) — Sprint change log
- [Doc 44](./44-broker-submission-execution-status-and-fills.md) — Broker submission architecture
