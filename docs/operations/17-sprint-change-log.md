# Sprint Change Log

## Sprint 2.8.6A-defect-1 — TEST_LIVE Admin Authorization Mismatch (hotfix)
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 19 suites / 1,504 tests

### Production Defect
`GET /api/admin/test-live/config-audit` returned 403 for a valid admin session. Root cause: `registerTestLiveCertificationRoutes` defined an inline `requireAdmin` using `storage.getUser` (the in-memory stub) instead of `authStorage.getUser` (real DB rows), and compared `user.role !== "admin"` instead of `UserRole.ADMIN`. `isAdmin` was also not passed to the function, so the inline logic ran instead.

### Fix
- `registerTestLiveCertificationRoutes` now accepts `isAdmin` as 3rd parameter (canonical middleware from `routes.ts`)
- Inline `requireAdmin` removed — all 5 routes use `isAuthenticated, isAdmin`
- `server/routes.ts` updated to pass `isAdmin`
- Frontend: 401/403/500 error states added to config audit, market, and account panels
- **62 new tests**: §11 admin consistency, §12 security negatives, §17 admin-safety-bypass prevention

### Invariant Added
`registerTestLiveCertificationRoutes.length === 3` — enforces that `isAdmin` is always passed; any regression immediately fails.

---

## Sprint 2.8.6A — Controlled TEST_LIVE Execution Certification
**Date:** 2026-08-11  
**Status:** COMPLETE (infrastructure built; live test pending env config)  
**Tests:** 19 suites (1,317 + certification tests)

### What Was Built
Certification infrastructure for the Sprint 2.8.6 broker-submission pipeline. Validates ALL safety gates before permitting a live test order. No order is placed automatically — explicit operator action at each step is required.

**Admin UI:** `/admin/test-live-certification` — 10-panel step-by-step wizard covering all 33 certification sections.

**API (5 endpoints):**
- `GET /api/admin/test-live/config-audit` — 10 config gates (safe status only, never values)
- `GET /api/admin/test-live/market-status` — NYSE session check with DST-aware ET conversion
- `GET /api/admin/test-live/account-status` — broker account + allowlist verification (masked refs only)
- `POST /api/admin/test-live/disarm` — post-certification disarm instructions
- `GET /api/admin/test-live/completion-report` — 48-item completion report (Section 34)

**Pure certification engines:**
- `computeConfigAudit(deps)` — injectable, all 10 required gates, fail-closed semantics documented
- `computeMarketStatus(now?)` — DST-aware ET conversion, holiday list, injectable time for tests
- `computeDisarmResult(wasArmed)` — operator guidance without exposing values
- `buildCompletionReport(audit, market, liveTestResult?)` — 48-item report, verdict, decision

**Documentation:**
- `docs/operations/45-test-live-execution-certification.md` — full certification guide (env config, workflow, defect policy, disarm, record template)

### Key Invariants Enforced
- Config audit never exposes raw account IDs or env var values
- `productionBlocked: true` is a literal type constant — cannot be overridden
- Empty allowlists → all accounts/symbols blocked (fail-closed, documented in audit)
- Null caps → all orders blocked (required for TEST_LIVE)
- Market order / multi-leg bans documented in audit response
- Disarm API cannot modify env vars (documents what operator must do in Replit Secrets)

### Current Status
`CONDITIONAL_GO` — certification infrastructure complete; live test blocked until operator sets required env vars (BROKER_EXECUTION_MODE=test_live, EXECUTION_TEST_LIVE_ARMED=true, allowlists, caps) and market is open.

### New Files
- `server/routes/test-live-certification.ts` — certification API + pure engines
- `server/routes/__tests__/test-live-certification.test.ts` — pure tests
- `client/src/pages/admin-test-live-certification.tsx` — admin certification UI
- `docs/operations/45-test-live-execution-certification.md` — ops guide

### Modified Files
- `server/routes.ts` — registered `registerTestLiveCertificationRoutes`
- `client/src/App.tsx` — added `/admin/test-live-certification` route (AdminOnly)
- `package.json` — added `test:certification`; updated `test:release` (19 suites) + `test:release:full`

---

## Sprint 2.8.6 — Sandbox/Test-Account Broker Submission
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 1,090 (17 suites, all passing)

### What Was Built
Human review and explicit consent layer between Execution Readiness (2.8.4) and future broker submission. Creates an immutable `FinalOrderReviewSnapshot` cryptographically hashed with SHA-256. Generates deterministic required acknowledgements from order structure. Server-side revalidation before accepting confirmation. Confirmation is idempotent (unique constraint on snapshot_id + user_id). No broker order submission.

**Key invariant (user-stated):** Confirmation cannot survive a changed preview or changed readiness result.

### New Files
- `shared/order-confirmation-types.ts` — all canonical types, acknowledgement definitions and codes, lifecycle states, compliance constants, forbidden label list, `BROKER_SUBMISSION_ENABLED: false` compile-time literal
- `server/services/order-confirmation-service.ts` — pure engine: `buildFinalOrderReviewSnapshot`, `computeSnapshotHash`, `determineRequiredAcknowledgements`, `revalidateBeforeConfirm`, `checkAllRequiredAcknowledgementsPresent`, DB helpers, audit logging
- `server/routes/order-confirmation.ts` — 3 routes (static `/health` before dynamic); forbidden-field guard; idempotency; server-side revalidation before confirm
- `server/routes/__tests__/order-confirmation.test.ts` — 72 scenarios covering all spec requirements
- `client/src/components/execution/FinalOrderReviewPanel.tsx` — order summary, legs table, economics, readiness summary, acknowledgement checkboxes, confirm button, confirmed banner
- `docs/operations/43-review-consent-and-final-order-confirmation.md` — full architecture doc

### Modified Files
- `server/routes.ts` — registered `registerOrderConfirmationRoutes` + `ensureOrderConfirmationTables`
- `package.json` — added `test:order-confirmation`; updated `test:release` + `test:release:full` (17 suites)
- `client/src/pages/trade-planning.tsx` — `FinalOrderReviewPanel` wired below `ExecutionReadinessPanel` for all options families

### DB Changes
3 new raw-SQL tables (no Drizzle schema change):
- `final_order_review_snapshots` — immutable snapshot store
- `order_confirmations` — confirmation records, UNIQUE(snapshot_id, user_id)
- `order_confirmation_audit_events` — full audit trail

### Key Invariants Introduced
- Confirmation cannot survive a changed preview or changed readiness result
- `BROKER_SUBMISSION_ENABLED: false` — literal type constant (compile-time)
- Snapshot hash = SHA-256(sortObjectKeys(canonicalPayload)) — deterministic, field-sensitive
- BLOCKED readiness → no snapshot created
- Missing max profit/loss → null, never fabricated
- Idempotent confirm endpoint (same snapshot + user → same confirmation)
- Forbidden labels enforced: APPROVED, AUTHORIZED, RECOMMENDED, GUARANTEED, etc.

### Snapshot Hash Design
SHA-256 of canonical payload with sorted keys. Includes: tradePlanId, orderPreviewId, executionReadinessId, userId, strategyFamily, symbol, legs, quantity, pricing, economics, readiness, marketDataObservedAt, reviewedDataVersion. Excludes volatile fields (id, createdAt, expiresAt).

### Expiry Policy
Default 120s TTL (intentionally short for options). Configurable via `FinalReviewConfig.snapshotTtlSeconds`.

### Acknowledgements (deterministic, no LLM)
- `ACK_REVIEWED_ORDER` — always required
- `ACK_OPTIONS_RISK` — always required
- `ACK_SHORT_ASSIGNMENT` — any short intent leg
- `ACK_ZERO_DTE` — any 0DTE leg
- `ACK_DEFINED_RISK_ESTIMATE` — spreads/condors/collar
- `ACK_BUYING_POWER_ESTIMATE` — capital estimate present
- `ACK_MULTI_LEG` — MULTI_LEG_OPTION
- `ACK_NEAR_EXPIRATION`, `ACK_MARKET_CLOSED` — conditional

### 2.8.6 Handoff
Next: Sprint 2.8.6 — Broker Submission Orchestration (major safety boundary requiring all guards listed in §26 of doc 43).

---

## Sprint 2.8.4 — Execution Readiness & Guardrails
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 1100+ (16 suites, all passing)

### What Was Built
Deterministic execution readiness layer immediately after Options Order Preview. Evaluates 9 categories: Market Data, Account, Position, Capital, Structure, Assignment Risk, Expiration, Liquidity, Pricing. Returns READY / READY_WITH_WARNINGS / BLOCKED. No LLM involvement. Capital estimates for all defined-risk strategies. Missing positions / buying power never assumed zero. `brokerSubmissionEnabled: false` is a literal type constant.

### New Files
- `shared/execution-readiness-types.ts` — canonical types, all finding codes, guardrail config, status labels, compliance constants
- `server/services/execution-readiness-service.ts` — pure deterministic engine; 9 category evaluators; capital estimation; persistence helpers; in-memory health metrics
- `server/routes/execution-readiness.ts` — 3 routes; static `/health` before dynamic `/:id`; FORBIDDEN_FIELD injection guard
- `server/routes/__tests__/execution-readiness.test.ts` — 40 test scenarios covering all spec requirements
- `client/src/components/execution/ExecutionReadinessPanel.tsx` — status banner (READY/READY_WITH_WARNINGS/BLOCKED); findings grouped by category; capital estimate card; no submission CTA
- `docs/operations/42-execution-readiness-and-guardrails.md` — full architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerExecutionReadinessRoutes` + `ensureExecutionReadinessTables`
- `package.json` — Added `test:execution-readiness`; updated `test:release` + `test:release:full` (16 suites)
- `client/src/pages/trade-planning.tsx` — `ExecutionReadinessPanel` wired below `OptionsOrderPreviewPanel` for all options families

### DB Changes
- New table: `execution_readiness_results` (raw SQL, minimal schema). Created via `ensureExecutionReadinessTables()` at startup. No new Drizzle schema entry.

### Key Invariants Introduced
- Readiness is DETERMINISTIC — no LLM; status cannot be overridden by AI
- `brokerSubmissionEnabled: false` — literal type constant in output
- `engineVersion: "2.8.4"` — always present
- Missing positions ≠ zero holdings; missing buying power ≠ $0
- No leg decomposition for multi-leg orders (inherits from 2.8.3)
- No order submission, modification, or cancellation

### Capital Estimation
- Debit strategies: `totalAmount` from preview (max loss = debit paid)
- Credit spreads: `(spread_width - credit) × 100 × qty`
- Iron condor/butterfly: `(max_wing_width - credit) × 100 × qty`
- Cash-secured put: `(strike × 100 × qty) - credit`
- Covered call: SHARES_ONLY (0 new capital)
- Unknown/undefined risk: BROKER_MARGIN_REQUIRED

### 2.8.5 Handoff
Next: Sprint 2.8.5 — Review, Consent & Final Order Confirmation
- Immutable final order snapshot
- Clear debit/credit display + max gain/loss
- Account + buying-power impact
- Assignment/exercise disclosure
- Explicit user acknowledgement + confirmation
- No broker submission until separately approved

---

## Sprint 2.8.3 — Options / Multi-Leg Order Preview
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 948+ (15 suites, all passing)

### What Was Built
Non-executable options and multi-leg order preview engine. Supports all 16 options strategy families (single-leg through iron condor). Preview is ephemeral (no new DB table), computed from Trade Plan + Execution Preflight + Order Draft + current leg quotes. Net debit/credit computed with canonical long/short sign convention. All contracts, strikes, expirations, ratios, and quantities are immutable from the OrderDraft. Multi-leg structures are never decomposed.

### New Files
- `shared/options-order-preview-types.ts` — Canonical `OptionsOrderPreview`, `OptionsPreviewLeg`, `NetStructurePricing`, all blocker/warning codes, compliance constants, health metrics type, display labels
- `server/services/options-preview-service.ts` — Pure 25-stage computation engine; injectable `OptionsPreviewDeps`; ephemeral health metrics; `createDbOptionsPreviewDeps`; `ensureOptionsPreviewTables` (no-op)
- `server/routes/options-preview.ts` — 4 read-only routes; static `/health` before dynamic `/:draftId`; forbidden-field injection guard
- `server/routes/__tests__/options-preview.test.ts` — 175+ assertions covering all spec invariants
- `client/src/components/execution/OptionsOrderPreviewPanel.tsx` — Full preview UI; non-execution banner always visible; leg cards with draft vs current quote comparison; Greeks expandable; no Confirm/Submit CTA
- `docs/operations/41-options-and-multileg-order-preview.md` — Full architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerOptionsPreviewRoutes` + `ensureOptionsPreviewTables`
- `package.json` — Added `test:options-preview`; updated `test:release` + `test:release:full` (15 suites)
- `client/src/pages/trade-planning.tsx` — `OptionsOrderPreviewPanel` wired when options-family expression + valid draftId

### Key Invariants Introduced
- `executable: false` — type-level constant, impossible to override
- `selectedBy: "USER"` — always read from Trade Plan; never from client
- Instrument type must be OPTION or MULTI_LEG_OPTION — `WRONG_INSTRUMENT_TYPE` blocker for EQUITY
- Options broad expression required — `WRONG_EXPRESSION_TYPE` blocker for STOCK
- All leg parameters immutable — preview never changes contract, strike, expiration, ratio, quantity
- No leg decomposition — multi-leg structures never split into individual legs
- Net debit/credit sign convention canonical: long=debit, short=credit; amount always positive
- Multiplier always 100 (standard US equity options)
- Forbidden labels enforced — no "Probability of Profit", "Roll Now", "Ready to Trade", "Place Order", etc.
- EXPIRED ≠ UNAVAILABLE — expired draft returns status EXPIRED explicitly
- No broker mutation methods called anywhere

### 2.8.4 Handoff
Next: Sprint 2.8.4 — Execution Validation Hardening
- Task #131 lifecycle scheduler auto-wiring
- Final validation chain: lifecycle → preflight → draft → preview → account → permissions → buying power → positions → quotes → market state

### 2.8.5 Absolute Block
No broker submission until 2.8.4 GO + full validation chain passing. No exception.

---

## Sprint 2.8.2 — Equity Order Preview
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 773 (14 suites, all passing)

### What Was Built
Non-executable equity order preview engine. Traders can review all material order facts before any submission pathway exists. Preview is ephemeral (no new DB table), computed on demand from Trade Plan + Execution Preflight + Order Draft + current reference quote.

### New Files
- `shared/equity-order-preview-types.ts` — Canonical types, status codes, blocker/warning enums, compliance constants, audit event types, health metrics
- `server/services/equity-preview-service.ts` — Pure computation engine with injectable deps; 16-stage pipeline; health metrics
- `server/routes/equity-preview.ts` — 4 read-only routes; forbidden-field injection guard
- `server/routes/__tests__/equity-preview.test.ts` — 136 tests covering all invariants
- `client/src/components/execution/EquityOrderPreviewPanel.tsx` — Full preview UI; no submission CTA; "Preview Only" banner always visible
- `docs/operations/40-equity-order-preview.md` — Architecture doc

### Modified Files
- `server/routes.ts` — Registered `registerEquityPreviewRoutes` + `ensureEquityPreviewTables`
- `package.json` — Added `test:equity-preview`; updated `test:release` + `test:release:full` (14 suites, 773 tests)
- `client/src/pages/trade-planning.tsx` — `EquityOrderPreviewPanel` wired when STOCK expression + valid draft

### Key Invariants Introduced
- `executable: false` — type-level constant, impossible to override
- `expressionType === "STOCK"` — enforced before any computation; `WRONG_EXPRESSION_TYPE` blocker otherwise
- `expressionSelectedBy === "USER"` — always read from trade plan; never from client
- Draft values immutable — preview never changes limit price, quantity, side, orderType, or TIF
- Forbidden labels enforced — no "Ready to Trade", "Approved", "Guaranteed Fill", etc.
- No broker mutation — `placeOrder`/`submitOrder`/`replaceOrder`/`cancelOrder` never called
- Client injection blocked — 18 forbidden fields rejected at route layer

### Methodology Version
`2.8.2`

### Next Sprint
2.8.3 — Options/Multi-Leg Preview

---

## Sprint 2.8.1A — Trade Preferences & User-Directed Expression Selection
**Date:** 2026-08-11  
**Status:** COMPLETE  
**Tests:** 637 (13 suites, all passing)

### What Was Built
Full trade preference system and user-directed expression selection step for Trade Planning.

### New Files
- `shared/trade-preference-types.ts` — `BroadExpressionType`, `UserTradingPreferences`, `ExpressionOption`, `BROAD_TO_FAMILIES`, compliance constants
- `server/services/trade-preferences-service.ts` — `computeBroadCompatibility`, `computeExpressionOptions`, CRUD for preferences and expression selections
- `server/routes/trade-preferences.ts` — 5 REST routes
- `server/routes/__tests__/trade-preferences.test.ts` — 101 tests
- `client/src/components/settings/ResearchTradingPreferencesSection.tsx` — Settings card for global research preferences
- `client/src/components/execution/BroadExpressionSelectionStep.tsx` — First step of Trade Planning for selecting broad expression type
- `migrations/029_trade_preferences.sql` — Additive migration
- `docs/operations/39-trade-preferences-and-expression-selection.md` — Architecture doc

### Modified Files
- `shared/schema.ts` — Added `preferredExpressionTypes`/`showOtherCompatibleStructures` to `userSettings`; `broadExpressionType`/`expressionSelectedBy` to `tradePlanningSessions`; `broadExpressionType`/`expressionSelectedBy`/`expressionSelectedAt` to `tradePlans`
- `server/routes.ts` — Registered `registerTradePreferencesRoutes` + `ensureTradePreferencesTables`
- `client/src/pages/settings.tsx` — Added `ResearchTradingPreferencesSection` to Trade Preferences tab
- `package.json` — Added `test:trade-preferences`; updated `test:release` + `test:release:full`
- `docs/operations/17-sprint-change-log.md` — This entry

---

## Sprint 2.8.1 — Order Preparation Engine
**Status:** COMPLETE

Non-executable `OrderDraft` computation. `executable: false` is type-level constant. Only PASS preflight drafts proceed. `limitPricePreference` not `limitPriceReference` (see memory). 536 tests.

---

## Sprint 2.8.0 — Execution Architecture
**Status:** COMPLETE

Kill switch (`BROKER_EXECUTION_ENABLED`), 12-dim preflight, broker adapter, audit tables, 5 legacy route guards. 401 tests.

---

## Sprint 2.7.7A — Certification Closure
**Status:** COMPLETE

6 dep upgrades (HIGH 17→10); canonical E2E creds; `PLAYWRIGHT_RELEASE_CERT=1`; CONDITIONAL_GO upgraded to GO; Phase 2.8 APPROVED.

---

## Sprint 2.7.7 — Release Gate
**Status:** CONDITIONAL_GO → GO

10-suite test:release gate (313 tests); schema column fixes; job store API; compliance "guaranteed" context pattern.

---

## Sprint 2.7.6 — Trade Monitoring & Lifecycle Intelligence
**Status:** COMPLETE

`trade_plan_activity` table; 7 lifecycle states; 24h dedup fingerprint; scheduler-ready; smoke/regression/integration/security suites mandatory.

---

## Sprint 2.7.5 — Trade Plan Workspace
**Status:** COMPLETE

Persistent plan DB (`trade_plans` + `trade_plan_versions`); server-authoritative creation; `getCachedRiskAnalysis` 3-arg signature.

---

## Sprint 2.7.4 — Trade Risk & Scenario Analysis
**Status:** COMPLETE

Deterministic scenario engine; `probabilityMetricsEnabled` always false; `crypto.randomUUID()` not `uuid()`.

---

## Sprint 2.7.3 — Options Contract Research
**Status:** COMPLETE

Live broker chain; `normalizeOptionChainContract` reads `greeks.mid_iv`; `clearContractResearchCache()` in tests.

---

## Sprint 2.7.2 — Options Strategy Matching
**Status:** COMPLETE

17 families; covered_call/protective_put/collar NOT_APPLICABLE without shares; liquidity note contains "2.7.3" literally.

---

## Sprint 2.7.1 — Equity Planning Engine
**Status:** COMPLETE

`EvidenceItem` has no severity; `PlanningFreshness` uses `updatedAt`; `ResearchGlossaryEntry` uses `label/shortDefinition/fullDefinition/caution`.

---

## Sprint 2.7.0 — Trade Planning Foundation
**Status:** COMPLETE

`uuid()` unavailable in schema (use `varchar+gen_random_uuid`); research_goals.id is varchar; 10 expression families; static routes before `/:symbol`.

---

## Sprint 2.6.5 — Research Goals & Planning
**Status:** COMPLETE

Categorical match states only; `MapIterator` needs `Array.from()`; static routes before `/:id`; TradePlanningContextShape is Phase 2.7 doc only.
