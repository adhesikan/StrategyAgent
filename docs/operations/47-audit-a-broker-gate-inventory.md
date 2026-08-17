# Doc 47 — Audit A: Broker Gate-Site Inventory

**Sprint 2.8.7 Architecture Audit — Read-Only**  
**Date:** 2026-08-16  
**Status:** COMPLETE — No application code changed  
**Scope:** `server/`, `client/`, `shared/`

---

## 1. Summary Counts

| Metric | Count |
|---|---|
| Total broker gate sites identified | 25 |
| BROKER_INDEPENDENT (currently gated unnecessarily) | 6 |
| BROKER_ENHANCED (works without; richer with) | 10 |
| BROKER_REQUIRED (correctly gated) | 9 |
| **P0** — Blocks core research/planning | **4** |
| **P1** — Materially degrades brokerless UX | **6** |
| **P2** — Works; could be improved | **7** |
| **P3** — Correctly BROKER_REQUIRED | **8** |

---

## 2. Gate-Site Inventory

### Client-Side Gates

| ID | File | Function / Component | Gate Condition | Gated Feature | Classification | Priority |
|---|---|---|---|---|---|---|
| BI-GATE-001 | `client/src/components/execution/ExecutionPreflightPanel.tsx:219` | "Run Preflight" button | `disabled={!brokerConnected}` | Preflight dims 1–3 (plan/lifecycle/freshness) | BROKER_INDEPENDENT | **P0** |
| BI-GATE-002 | `client/src/pages/trade-plan-detail.tsx:241` | Preflight query | `enabled: !!plan && brokerConnected` | Execution Preflight (all dims) | BROKER_INDEPENDENT (dims 1–3) | **P0** |
| BI-GATE-003 | `client/src/pages/trade-plan-detail.tsx:1326` | Execute tab / section | `showExecution && brokerConnected` | Execution section visibility (includes planning sections) | BROKER_ENHANCED | **P1** |
| BI-GATE-004 | `client/src/components/research/structure/live-contract-resolver.tsx:611` | Options contract query | `enabled: pkg.brokerConnected` | Options contract research (live chain) | BROKER_ENHANCED | **P1** |
| BI-GATE-005 | `client/src/components/research/structure/live-contract-resolver.tsx:673` | Contract resolver render | `!pkg.brokerConnected → "broker_not_connected"` | Options contract selection | BROKER_ENHANCED | **P1** |
| BI-GATE-006 | `client/src/components/research/workspace/workspace-simplified.tsx:444` | Workspace Execute tab | `isBrokerConnected ? <ExecuteMode> : <ConnectPrompt>` | InstaTrade order planning intro | BROKER_REQUIRED (for execution); planning intro = BROKER_ENHANCED | **P2** |
| BI-GATE-007 | `client/src/components/research/workspace/workspace-sections.tsx:408` | `deriveInstaTradePrepState` | `!brokerConnected → "no_broker"` | InstaTrade section state | BROKER_REQUIRED (execution path) | **P2** |
| BI-GATE-008 | `client/src/components/research/structure/trade-structure-engine.tsx:55` | Structure engine | `connected = pkg.brokerConnected` | Contract selection section visibility | BROKER_ENHANCED | **P1** |
| BI-GATE-009 | `client/src/components/research/action-card.tsx:183` | Action CTA | `pkg.brokerConnected ? <OrderPrepCTA> : <ConnectPrompt>` | Order preparation entry point | BROKER_REQUIRED (correctly gated) | **P3** |
| BI-GATE-010 | `client/src/pages/opportunity-research.tsx:1445` | Research Package page | `pkg.brokerConnected ? <InstaTradeBtn> : <ConnectPrompt>` | InstaTrade CTA on research page | BROKER_REQUIRED (execution); label = **P2** (graceful msg) | **P2** |
| BI-GATE-011 | `client/src/pages/dashboard.tsx:2507` | Portfolio section | `!brokerConnected → "Connect broker" prompt` | Portfolio context on dashboard | BROKER_ENHANCED (manual portfolio exists) | **P1** |
| BI-GATE-012 | `client/src/pages/dashboard.tsx:683` | MarketCommandBar | `brokerConnected ? "Connected" : "Not Connected"` | Status indicator (informational) | BROKER_ENHANCED (informational, not a gate) | **P2** |
| BI-GATE-013 | `client/src/components/home/home-sections.tsx:231` | Connection-lost banner | `connectionLost → banner` | Connection loss warning | BROKER_ENHANCED (correct behavior) | **P3** |
| BI-GATE-014 | `client/src/components/live-positions-panel.tsx:34` | Live Positions Panel | `isConnected` required | Live broker positions | BROKER_REQUIRED (correctly gated) | **P3** |
| BI-GATE-015 | `client/src/components/execution/OrderPreparationPanel.tsx:156` | Order Preparation | `!brokerConnected → message` | Order draft preparation | BROKER_REQUIRED (correctly gated) | **P3** |
| BI-GATE-016 | `client/src/pages/home-v2.tsx:334` `client/src/pages/command-center.tsx:322` | OrderReviewDialog | `brokerConnected={isConnected}` | Order review dialog | BROKER_REQUIRED (correctly gated) | **P3** |

### Server-Side Gates

| ID | File | Route / Function | Gate Condition | Behavior When Absent | Classification | Priority |
|---|---|---|---|---|---|---|
| BI-GATE-017 | `server/routes/internal-options.ts:165` | `GET .../options/expirations` | No connected options-capable broker | **409 NO_BROKER** | BROKER_ENHANCED (CON-002 candidate) | **P0** |
| BI-GATE-018 | `server/routes/internal-options.ts:186` | `GET .../options/chain` | No connected options-capable broker | **409 NO_BROKER** | BROKER_ENHANCED (CON-002 candidate) | **P0** |
| BI-GATE-019 | `server/routes/futures.ts:96,100` | `POST /api/futures/activate-tradestation` | TradeStation not connected | **400** | BROKER_REQUIRED (futures = execution-adjacent) | **P3** |
| BI-GATE-020 | `server/services/execution-preflight-service.ts:440–441` | `buildBrokerDimension` | No broker connection | BROKER_NOT_CONNECTED blocker → overall FAIL | BROKER_REQUIRED (for dims 4–10) | **P0** (dims 1–3 still blocked) |
| BI-GATE-021 | `server/services/execution-preflight-service.ts:733` | `determineOverallStatus` | `!brokerConnected && no blockers` | Returns **UNAVAILABLE** even if dims 1–3 PASS | BROKER_INDEPENDENT result masked | **P0** |
| BI-GATE-022 | `server/services/execution-preflight-service.ts:542–545` | `buildPositionDimension` | No broker | Returns **UNAVAILABLE** (all plan types) | BROKER_ENHANCED (equity plans don't need position check) | **P1** |
| BI-GATE-023 | `server/services/execution-preflight-service.ts:518` | `buildBuyingPowerDimension` | No broker | BUYING_POWER_UNAVAILABLE blocker | BROKER_ENHANCED (hypothetical budget possible — CON-004) | **P1** |
| BI-GATE-024 | `server/routes/dashboard.ts:56–101` | Dashboard API | `brokerConnected` for positions | `positions: undefined` when no broker | BROKER_ENHANCED (manual portfolio not surfaced) | **P1** |
| BI-GATE-025 | `server/routes/opportunity-search.ts:245,462` | `buildIncomeCandidates` | `brokerConnected` param | Income candidates limited without positions | BROKER_ENHANCED (expected; lower priority) | **P2** |

---

## 3. Execution Preflight — 12-Dimension Classification

Derived from `server/services/execution-preflight-service.ts`.

| # | Dimension | Data Source | Broker Required? | Independent Alternative | Recommended Layer |
|---|---|---|---|---|---|
| 1 | **Trade Plan** | DB — plan row (`structureSnapshot`, `planningSnapshot`) | **No** | Plan DB already used | **INDEPENDENT** |
| 2 | **Research Lifecycle** | DB — `execution_preflights` / lifecycle service | **No** | OppIntel + lifecycle service | **INDEPENDENT** |
| 3 | **Plan Freshness** | `plan.updatedAt`, `lifecycle.evaluatedAt` | **No** | Plan DB + lifecycle | **INDEPENDENT** |
| 4 | **Broker Connection** | `brokerAdapter.getConnectionStatus()` | **Yes** | None | **BROKER_REQUIRED** |
| 5 | **Broker Account** | `brokerAdapter.listAccounts()` | **Yes** | None | **BROKER_REQUIRED** |
| 6 | **Broker Permissions** | `brokerAdapter.getAccountCapabilities()` | **Yes** | None | **BROKER_REQUIRED** |
| 7 | **Buying Power** | `brokerAdapter.getBuyingPower()` | **Partially** | User-entered budget hint (CON-004) | **BROKER_ENHANCED** |
| 8 | **Position Requirements** | `brokerAdapter.getPositions()` | **Partially** | Equity plans: always PASS; covered/protective options: broker needed | **BROKER_ENHANCED** |
| 9 | **Quote Validation** | `brokerAdapter.getQuoteValidation()` / `validateOptionsContract()` | **Partially** | Equity quote: Twelve Data (planning path); options contracts: broker | **BROKER_ENHANCED** |
| 10 | **Structure Validation** | Derived from dim 9 option-contract results | **Partially** | Equity structure: PASS from plan DB; options legs: need dim 9 | **BROKER_ENHANCED** |
| 11 | **Risk Analysis** | `plan.riskSnapshot` (stored at plan creation) | **No** | Stored plan data — no live source needed | **INDEPENDENT** |
| 12 | **Planning Constraints** | `plan.planningSnapshot` (stored at plan creation) | **No** | Stored plan data — no live source needed | **INDEPENDENT** |

**Critical architectural finding (BI-GATE-021):** `determineOverallStatus()` returns `UNAVAILABLE` when `!brokerConnected && blockers.length === 0`. This means dims 1–3 and 11–12 could all PASS, but the overall result is still `UNAVAILABLE` — masking valid independent-layer results from the user. This is the root cause of the P0 bug reported in CON-001.

**Proposed independent layer split:**
- **INDEPENDENT PREFLIGHT** — dims 1, 2, 3, 11, 12: always evaluate; return `PASS_INDEPENDENT` or `FAIL`
- **BROKER EXECUTION PREFLIGHT** — dims 4–10: skip when no broker; return `BROKER_REQUIRED_FOR_EXECUTION`
- **Overall semantics:** `PASS_INDEPENDENT` + broker dims skipped → "Plan ready; connect broker to proceed to execution." `FAIL` on any independent dim → plan has a fundamental issue regardless of broker.

---

## 4. Options Research Broker Dependency Trace

### Current State

| Component | What Is Fetched | Provider | Broker Required? |
|---|---|---|---|
| `server/routes/internal-options.ts` | Option expirations | Tradier / TradeStation | **Yes — 409 NO_BROKER** |
| `server/routes/internal-options.ts` | Full option chain with greeks | Tradier / TradeStation | **Yes — 409 NO_BROKER** |
| `client/src/components/research/structure/live-contract-resolver.tsx` | Expirations + chain | Via internal-options | **Yes** |
| `client/src/pages/trade-plan-detail.tsx` (old flow) | Chain + account | Tradier / TradeStation | **Yes** |
| Options Strategy Matching (server) | **Nothing from broker** | Purely deterministic | **No** ✓ |
| Trade Risk & Scenario Analysis (server) | **Nothing from broker** | Stored plan data | **No** ✓ |

### Data Type Decomposition

| Data Type | Current Source | Independent Alternative | Notes |
|---|---|---|---|
| Underlying price (for option pricing context) | Broker quote | Twelve Data daily bar | Stale by 1 day; acceptable for planning research |
| Option expirations list | Broker chain | **None identified** | Twelve Data options endpoint TBD — Audit C |
| Option chain contracts + strikes | Broker chain | **None identified** | Requires Audit C evaluation |
| Option greeks (delta, gamma, IV) | Broker chain | **None identified** | Real-time greeks need live chain |
| Contract availability/validity | Broker chain | **None identified** | Could use exchange calendar for basic expiry check |
| Strategy structure (families, legs) | Deterministic | Already independent ✓ | |
| Risk scenario (P/L at various prices) | Deterministic | Already independent ✓ | |

### Finding

Options expirations and chain contracts are the only data entirely broker-gated in the options research path. Strategy matching, risk scenarios, and the structure logic are all BROKER_INDEPENDENT. The gate is at contract-data resolution, not at strategy selection.

**CON-002 impact scope:** Removing this dependency requires either (a) integrating a Twelve Data options endpoint (Audit C), or (b) allowing users to manually specify strikes/expirations for the research path. The live broker chain remains the BROKER_ENHANCED source for precise greeks.

---

## 5. Portfolio Broker Dependency Audit

| Feature | Broker Required? | Current Path | Notes |
|---|---|---|---|
| Manual CSV/XLSX portfolio import | **No** | `server/services/portfolio-service.ts` (multer + xlsx) | Fully independent ✓ |
| Portfolio Intelligence (on manual data) | **No** | `server/services/portfolio-intelligence-engine.ts` | Pure computation ✓ |
| Portfolio Analytics (on manual data) | **No** | `server/services/portfolio-analytics-service.ts` | Pure computation ✓ |
| Portfolio History / Snapshots | **No** | DB snapshots | Stored data ✓ |
| Broker sync — connect | **Yes** | `POST /api/portfolio/broker/connect` | Correctly BROKER_REQUIRED |
| Broker sync — sync positions | **Yes** | `POST /api/portfolio/broker/sync/:id` | Correctly BROKER_ENHANCED |
| Dashboard portfolio section | **Partially** | `server/routes/dashboard.ts:56–101` | Manual portfolio not surfaced on dashboard → P1 |
| Position data in income candidates | **Partially** | `server/routes/opportunity-search.ts:462` | Empty positions without broker → income candidates limited |

**Finding:** The manual/import portfolio path is fully independent. The gap is that the dashboard currently only pulls broker positions for the portfolio section — it does not fall back to the user's stored manual/imported portfolio. This is a surfacing issue, not a missing capability.

---

## 6. Market Data Provider Dependencies

| Data Type | Class | Current Provider | Provider Independence |
|---|---|---|---|
| Historical daily OHLCV bars | MARKET DATA | **Twelve Data** → `market_history_bars` DB | BROKER_INDEPENDENT ✓ |
| Stored quotes for scanning | MARKET DATA | Twelve Data (via daily bars) | BROKER_INDEPENDENT ✓ |
| MCP scan signals (VCP pattern) | MARKET DATA | MCP service | BROKER_INDEPENDENT ✓ |
| SEC 13F institutional data | MARKET DATA | SEC EDGAR bulk | BROKER_INDEPENDENT ✓ |
| Equity quote for preflight (dim 9) | MARKET DATA | Broker (`getQuoteValidation`) | **Should be BROKER_ENHANCED** — Twelve Data quote available |
| Options expirations + chain | MARKET DATA | Broker only (Tradier/TradeStation) | **BROKER_REQUIRED currently** — CON-002 candidate |
| Live positions | ACCOUNT DATA | Broker only | BROKER_REQUIRED ✓ |
| Live buying power | ACCOUNT DATA | Broker only | BROKER_REQUIRED (hypothetical substitute: CON-004) |
| Account capabilities/permissions | ACCOUNT DATA | Broker only | BROKER_REQUIRED ✓ |
| Order status / fills | EXECUTION DATA | Broker only | BROKER_REQUIRED ✓ |

**Key finding:** The equity quote used in execution preflight (dim 9 `getQuoteValidation`) fetches from the broker. For the PLANNING path (research, lifecycle), Twelve Data provides a daily bar that is already in the DB. The planning-path preflight (independent layer) could use the stored Twelve Data bar for basic quote context.

---

## 7. UI Language Audit — Broker-Absence Vocabulary

Current surfaces that show failure/block language when broker is absent but the feature is BROKER_INDEPENDENT or BROKER_ENHANCED:

| Location | Current Language | Proposed Future Semantic |
|---|---|---|
| ExecutionPreflightPanel — Run Preflight button | `disabled` (no explanation) | `"Run Plan Check"` (dims 1–3 available without broker) |
| ExecutionPreflightPanel — no broker state | Dims 1–3 not shown at all | `PASS_INDEPENDENT` + `BROKER_REQUIRED_FOR_EXECUTION` badge |
| trade-plan-detail.tsx — execution section | Hidden when `!brokerConnected` | Show planning/lifecycle sections; hide order submission only |
| live-contract-resolver.tsx — broker_not_connected | Hard empty state | `"Connect broker for live contracts — or enter strikes manually"` |
| Dashboard portfolio section | `"Connect broker to view portfolio context"` | `"Import or sync a portfolio to see context"` |
| internal-options.ts — 409 NO_BROKER | `NO_BROKER` error code | `BROKER_REQUIRED` or `INDEPENDENT_MODE_AVAILABLE` (once Audit C complete) |
| Opportunity Research — InstaTrade CTA | `"Connect brokerage to use InstaTrade™ order planning"` | `"InstaTrade™ requires a connected broker"` (subtle difference — broker optional, not mandatory for research) |

---

## 8. Implementation Group Proposals

Not sprints — candidate work packages for sequencing in Sprint 2.8.7+.

### Group A — Independent Execution Readiness

**Scope:** Split preflight into Independent Layer and Broker Layer. Fix `determineOverallStatus`.

**Files:** `server/services/execution-preflight-service.ts`, `client/src/components/execution/ExecutionPreflightPanel.tsx`, `client/src/pages/trade-plan-detail.tsx`

**Resolves:** CON-001, BI-GATE-001, BI-GATE-002, BI-GATE-020, BI-GATE-021

**New status vocabulary:** `PASS_INDEPENDENT` / `FAIL` / `BROKER_REQUIRED_FOR_EXECUTION`

**Safety invariants preserved:**
- Dims 4–10 (broker/account/buying-power/position/quote/structure) only run when broker connected — execution submission cannot bypass them
- `BROKER_EXECUTION_ENABLED` kill switch unaffected
- A `PASS_INDEPENDENT` result does NOT authorize order submission

### Group B — Brokerless Trade Planning

**Scope:** Remove `brokerConnected` guard from Execution Preflight query in trade-plan-detail; show independent dims on preflight panel; show planning/lifecycle sections when no broker; remove execution-only sections from the broker gate.

**Files:** `client/src/pages/trade-plan-detail.tsx`, `client/src/components/execution/ExecutionPreflightPanel.tsx`

**Resolves:** BI-GATE-002, BI-GATE-003

**Safety:** Execution section (order prep, confirmation, submission) stays broker-gated.

### Group C — Market Data Abstraction

**Scope:** For equity quote in preflight dim 9 (planning path), use stored Twelve Data bar as the independent-mode source. Planning surfaces never need a real-time broker quote — that is an execution concern.

**Files:** `server/services/execution-preflight-service.ts`, `server/routes/internal-options.ts`

**Resolves:** BI-GATE-023 (equity quote), partial CON-002

**External:** Investigate Twelve Data options chain availability (see Audit C).

### Group D — Brokerless Options Research

**Scope:** Investigate Twelve Data options chain endpoint. If available: ingest reference expirations + strike grid for research path. Remove 409 NO_BROKER from options expirations/chain endpoints on the research path (not the execution path).

**Files:** `server/routes/internal-options.ts`, new `server/services/options-reference-data-service.ts`

**Resolves:** CON-002, BI-GATE-017, BI-GATE-018

**Dependency:** Requires Audit C external evaluation before scoping.

### Group E — Manual/Imported Portfolio Context

**Scope:** Surface manual/imported portfolio in the dashboard portfolio section when no broker is connected. `server/routes/dashboard.ts` should fall back to the user's stored portfolios (already in DB) when `brokerConnected = false`.

**Files:** `server/routes/dashboard.ts`, `client/src/pages/dashboard.tsx`

**Resolves:** BI-GATE-011, BI-GATE-024

### Group F — UX Graceful Degradation

**Scope:** Replace FAIL/BLOCKED/UNAVAILABLE language on BROKER_ENHANCED surfaces with NOT_CONNECTED / OPTIONAL / CONNECT_TO_ENHANCE. Audit all broker-absent UI states for tone and clarity.

**Files:** Multiple — see UI Language Audit (§7)

**Resolves:** BI-GATE-005, BI-GATE-010, BI-GATE-012; aligns with §7

---

## 9. Conflict Check — Roadmap Safety

| Finding | Execution Safety Impact | Research Qualification Impact | Broker Submission Gate Impact | Schema Migration Required | New External API Contract |
|---|---|---|---|---|---|
| Preflight dim split (Group A) | **None** — dims 4–10 still required for any submission | None | None — kill switch intact | No | No |
| Remove `brokerConnected` guard from preflight query (Group B) | **None** — dims 4–10 block if no broker | None | None | No | No |
| Equity quote via Twelve Data (Group C) | **None** — planning path only; execution quote still from broker | None | None | No | No |
| Options chain via independent source (Group D) | **None** — planning/research path only | None | None | Possible (reference data table) | **Yes — Twelve Data options** |
| Dashboard manual portfolio (Group E) | None | None | None | No | No |
| UX language (Group F) | None | None | None | No | No |
| Hypothetical buying power (CON-004) | **None** — user-entered value flagged as hypothetical; real broker buying power still dims 7 | None | None | Possible (budget hint on plan) | No |

**No findings weaken broker submission gates. No findings bypass the BROKER_EXECUTION_ENABLED kill switch. No findings change research qualification logic.**

---

## 9a. Audit B Reference

**[Doc 48 — Audit B: Execution Preflight Layer Design](48-audit-b-preflight-layering.md)** provides the complete implementation design for the two-layer preflight split:

- Final `TradePlanReadinessStatus` + `BrokerExecutionReadinessStatus` type definitions
- Full API response shape proposal (additive, backward-compatible)
- Failure matrix for 12 scenarios (A through L)
- 8-suite test plan
- Platform health and compliance implications

The gate-site findings in §2 above (particularly BI-GATE-001, -002, -020, -021) are addressed by the Audit B implementation design.

---

## 10. Completion Report

1. **Total broker gate sites found:** 25
2. **BROKER_INDEPENDENT (unnecessarily gated):** 6
3. **BROKER_ENHANCED (works without; richer with):** 10
4. **BROKER_REQUIRED (correctly gated):** 9
5. **P0 count:** 4 (BI-GATE-001, -002, -017, -018, -020/021 cluster)
6. **P1 count:** 6 (BI-GATE-003, -004, -005, -008, -011, -022, -023)
7. **P2 count:** 7 (BI-GATE-006, -007, -010, -012, -024, -025, and CON-004)
8. **P3 count:** 8 (BI-GATE-009, -013, -014, -015, -016, -019, and futures gate)
9. **Top unnecessary broker dependencies:** BI-GATE-001/002 (preflight blocked), BI-GATE-017/018 (options 409), BI-GATE-020/021 (dim split + UNAVAILABLE masking), BI-GATE-003 (execution section hidden), BI-GATE-004/005 (contract resolver disabled), BI-GATE-008 (structure engine gated), BI-GATE-011 (dashboard portfolio)
10. **Preflight dimension classification:** See §3 above — dims 1,2,3,11,12 = INDEPENDENT; dim 7,8,9,10 = BROKER_ENHANCED; dim 4,5,6 = BROKER_REQUIRED
11. **Options research broker dependencies:** Expirations + chain = broker-only today; strategy matching + risk scenarios = BROKER_INDEPENDENT already; underlying price = Twelve Data viable
12. **Portfolio broker dependencies:** Manual/import path fully independent; sync path correctly BROKER_ENHANCED; dashboard gap (manual portfolio not surfaced)
13. **Market-data provider dependencies:** Historical bars and MCP = BROKER_INDEPENDENT; equity quote for preflight = broker (should use Twelve Data on planning path); options chain = broker only (Audit C needed)
14. **Client hard gates:** 16 gate sites (see §2 Client table)
15. **Server hard gates:** 9 gate sites (see §2 Server table)
16. **UI broker-absence issues:** 7 surfaces with failure-tone language on non-required broker features (see §7)
17. **Proposed implementation groups:** A (Independent Preflight), B (Brokerless Trade Planning), C (Market Data Abstraction), D (Brokerless Options Research), E (Manual Portfolio Context), F (UX Graceful Degradation) — see §8
18. **Schema implications:** Groups A–C and F: no schema changes; Group D: possible options reference data table; CON-004: possible budget hint field
19. **External provider implications:** Group D only — Twelve Data options chain endpoint requires evaluation (Audit C)
20. **Doc 46 Gate-Site Manifest updated:** YES (§6)
21. **Files changed:** `docs/operations/46-broker-independence-architecture.md`, `docs/operations/47-audit-a-broker-gate-inventory.md` (new), `docs/operations/15-known-issues-and-backlog.md`, `docs/operations/17-sprint-change-log.md`, `docs/operations/README.md`
22. **Application code changed:** **NO**
