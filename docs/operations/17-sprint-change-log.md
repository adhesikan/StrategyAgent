# Sprint Change Log

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
