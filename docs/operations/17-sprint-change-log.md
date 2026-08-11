# Sprint Change Log

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
