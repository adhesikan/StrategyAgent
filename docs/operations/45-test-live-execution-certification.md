# Doc 45 — TEST_LIVE Execution Certification

**Sprint:** 2.8.6A  
**Classification:** Controlled Certification  
**Purpose:** Record and guide the controlled TEST_LIVE certification of the Sprint 2.8.6 broker-submission pipeline.

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
