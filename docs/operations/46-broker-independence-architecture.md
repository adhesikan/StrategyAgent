# Doc 46 — Broker-Independent-First Architecture Principle

**Recorded:** 2026-08-16  
**Applies from:** Sprint 2.8.7 forward  
**Status:** ACTIVE — enforced at design review

---

## 1. The Principle

> "All VCP Trader AI research, intelligence, opportunity discovery, analysis,
> Trade Plan creation, lifecycle monitoring, risk modeling, and other
> non-execution capabilities shall operate independently of a brokerage
> connection wherever technically feasible.
>
> Broker-independent market-data providers such as Twelve Data shall be used
> for research/planning market data where appropriate.
>
> Broker connections shall primarily provide account-specific information
> and execution capabilities rather than gate core product functionality."

A supported brokerage connection must NOT be an onboarding requirement or a
prerequisite for core research/planning functionality.

---

## 2. Classification Taxonomy

Every capability is classified as one of:

| Class | Definition |
|---|---|
| **BROKER_INDEPENDENT** | Works fully without a brokerage connection. Independent market data providers (Twelve Data, SEC EDGAR, MCP service) and any user-supplied data are sufficient. |
| **BROKER_ENHANCED** | Works without a broker but is richer when one is connected (e.g. live positions improve sizing; live options chain improves contract selection). Graceful degradation is required — the feature must be usable in broker-absent state. |
| **BROKER_REQUIRED** | Genuinely requires account-specific or execution-specific data that cannot be replicated from independent sources. |

**Design goal:** Maximize the surface area of BROKER_INDEPENDENT and BROKER_ENHANCED. Push BROKER_REQUIRED as narrow as technically feasible.

---

## 3. Feature Classification

### 3.1 BROKER_INDEPENDENT

Features that are fully operational with no broker connection:

| Feature | Notes |
|---|---|
| VCP Opportunity Discovery (scanner + ranking) | Twelve Data + MCP service |
| Dashboard Opportunity Feed | Precomputed from scanner |
| Research Package (`/opportunities/:symbol`) | Twelve Data + 13F + MCP |
| AI Research Workspace | Stored market data + OppIntel |
| Research Goals & Planning | Plan creation, goal matching |
| Trade Plan creation (equity and options strategy selection) | Scenario + risk modeling with hypothetical constraints |
| Trade Plan detail page (research/planning sections) | Lifecycle, AI workspace, risk |
| Trade Plan Lifecycle Monitoring | OppIntel + Twelve Data |
| Opportunity Lifecycle Intelligence | Change history, research timeline |
| Research Collections | Symbol-ref based |
| Research Monitor & Alerts | Precomputed OppIntel watches |
| Research Reports | Precomputed |
| Market Research Hub | Precomputed snapshots |
| Sector & Theme Intelligence | Precomputed snapshots |
| Institutional 13F Analysis | SEC data — no broker needed |
| Institutional Fund Explorer | SEC data — no broker needed |
| Options Strategy Matching | Strategy selection logic — no live chain needed |
| Scenario Analysis / Risk Modeling | With hypothetical position constraints |
| Position Sizing | With user-entered hypothetical entry/stop/size |
| Portfolio Intelligence (manual/imported) | CSV/XLSX import path |
| Portfolio Analytics (manual/imported) | History, change classification |
| Trade Risk & Scenario Analysis | Deterministic, hypothetical inputs |
| Trade Plan Workspace (Understand/Plan/Verify tabs) | Planning sections; Execute tab = BROKER_ENHANCED |

### 3.2 BROKER_ENHANCED

Features that degrade gracefully but improve with a broker connection:

| Feature | Without Broker | With Broker |
|---|---|---|
| Options Contract Research | Research structure, strategy framing | Live chain with greeks, real spreads |
| Execution Preflight (lifecycle + freshness dims) | Plan validity / lifecycle checks pass | Full 12-dimension check including account |
| Position Sizing | Hypothetical constraints | Actual account buying power |
| Portfolio sync | Manual CSV/XLSX import | Real-time broker position sync |
| Risk guardrails | Model-based risk sizing | Actual buying power + position concentration |
| Trade Plan Workspace — Execute tab | Shows what execution would look like | Full preflight + order prep |

### 3.3 BROKER_REQUIRED

Features that genuinely require account-specific or execution-specific data:

| Feature | Why Broker is Required |
|---|---|
| Actual order submission | Cannot place orders without a connected account |
| Live buying power | Account-specific — no independent source |
| Actual broker positions | Account-specific — unless manually supplied |
| Broker trading permissions | Equity/options/margin — account-specific |
| Broker-specific order validation | Provider-specific pre-submission checks |
| Order status / fills / cancellations | Live brokerage account state |
| Broker position linking | Requires authenticated account context |
| Execution Preflight dims 4–12 | Account, permissions, positions, buying power |

---

## 4. Conflicts with Current Architecture

The following patterns conflict with the principle and must be addressed in Sprint 2.8.7+:

### CON-001: Execution Preflight hard-fails on broker disconnect (ALL dimensions)

**Current behavior:** When no broker is connected, `runExecutionPreflight` returns overall
`FAIL` on the "Broker Connection" dimension (dim 4). This also blocks plan-structure dims 1–3
(Trade Plan validity, Lifecycle, Freshness) from being visible/useful.

**Principle violation:** Lifecycle monitoring and plan-freshness checks are BROKER_INDEPENDENT.
A user without a broker should be able to confirm their plan is `CURRENT` and their research
is fresh — they just can't go further than that.

**Proposed resolution:** The preflight engine should bifurcate into an "Independent Layer"
(dims 1–3: plan, lifecycle, freshness) and a "Broker Layer" (dims 4–12). Independent dims
should always evaluate; broker dims return `UNAVAILABLE` when no broker is connected.
Overall status: `PASS_INDEPENDENT` / `FAIL` / `BROKER_REQUIRED_FOR_EXECUTION`.

### CON-002: Options Contract Research requires a live broker connection

**Current behavior:** `GET /api/options/contracts/:symbol` resolves contracts exclusively
from the broker's live options chain. No broker = no contract candidates.

**Principle violation:** Options research is classified BROKER_ENHANCED (not BROKER_REQUIRED).
An independent fallback (Twelve Data options endpoint, stored reference data) should be
investigated for the research/planning path.

**Proposed resolution (Sprint 2.8.7 audit):** Investigate Twelve Data options chain availability.
If available, use as the independent-mode source. Mark the live-chain path as "Enhanced with
connected broker" in the UI.

### CON-003: `brokerConnected` client-side gates block planning-level features

**Current behavior:** Multiple `useIsBrokerConnected()` check sites in the client suppress
planning UI (e.g. options strategy sections, contract research) when no broker is connected.

**Principle violation:** Planning-level features (strategy matching, scenario analysis,
hypothetical sizing) are BROKER_INDEPENDENT.

**Proposed resolution (Sprint 2.8.7 audit):** Audit every `brokerConnected` check site.
Replace planning-level gates with graceful-degradation states ("Enhanced with broker connection")
rather than hard suppression.

### CON-004: Risk guardrails buying-power check blocks when unavailable

**Current behavior:** When no broker is connected, the buying power guardrail dimension
returns `UNAVAILABLE` — which counts against overall readiness. Hypothetical buying power
(user-entered) is not an accepted substitute.

**Principle violation:** Risk modeling with user-entered hypothetical constraints is
BROKER_INDEPENDENT.

**Proposed resolution (Sprint 2.8.7 audit):** Allow a user-entered buying-power budget
as an independent-mode substitute for live buying power in risk guardrail evaluation.

---

## 4d. Audit D — Brokerless UX & Onboarding

[Doc 50 — Audit D](50-audit-d-brokerless-ux.md) completes the Sprint 2.8.7 audit series with a full UX/product architecture design. Key decisions:

**Three P0 UX misclassifications corrected:**
1. Options scanner (`options-scanner.tsx`) hard-blocked on broker — scan uses stored data; broker not required
2. Workspace risk card lists four gaps as broker-caused; most are data-provider limitations
3. Trade Plan execution section — Audit B two-layer split must be applied (Plan Readiness vs Direct Execution)

**Canonical product journey:** FIND → RESEARCH → PLAN → MONITOR → [EXECUTE — optional]. All four pre-execution stages are fully broker-independent.

**Broker CTA rules:**
- Research/planning context: secondary, labeled "optional"
- Execution intent explicitly requested: primary (broker is now genuinely required)
- Never shown as the dashboard primary CTA for users who have not expressed execution intent

**Correct blockers remain untouched:** Order Preparation, Order Preview, trade ticket submit, Broker Submission, Final Confirmation — all preserved.

**Error/limitation taxonomy:** `ERROR | BLOCKER | LIMITATION | ENHANCEMENT_AVAILABLE | INFORMATION`. Broker absence during research = `ENHANCEMENT_AVAILABLE`. Broker absence during execution = `BLOCKER`.

**Implementation groups A–I** with a screen-by-screen change manifest and 17-item end-to-end acceptance criteria.

## 4c. Amendment C1 — Underlying-Only Theoretical Mode

**INVARIANT C1 — THEORETICAL/MODELED OPTION VALUES ARE NEVER EXECUTION-GRADE DATA.**

Theoretical values (`MODEL_CALL_VALUE`, `MODEL_PUT_VALUE`, and any Greek derived from `VCP_REALIZED_VOL_MODEL` or `VCP_IV_MODEL` when no market mid is observed) cannot satisfy:

1. Execution Preflight dim-9 broker quote validation
2. Order Preparation execution quote requirement
3. Order Preview executable price validation
4. Final Revalidation before submission
5. Broker Submission price parameter

Only execution-approved broker data (live quote, ≤ 60s freshness, from a connected and permissioned broker account) may satisfy those gates. A modeled premium is not upgraded to execution-grade by the presence of a broker connection.

This invariant is structurally enforced at the TypeScript type level: `TheoreticalOptionValue` is incompatible with `NormalizedOptionContract` and `ExecutionQuote` by design.

See Doc 49 §C1 for the full underlying-only theoretical mode design.

---

## 4b. Audit C Findings — Broker-Independent Options

[Doc 49 — Audit C](49-audit-c-broker-independent-options.md) provides the full options architecture. Key decisions:

- **Options Strategy Matching and Trade Risk & Scenario Analysis are already BROKER_INDEPENDENT.** No changes needed.
- **Twelve Data does not currently provide options data.** OHLCV bars only. Licensing verification required before any independent options integration.
- **Minimum external dependency:** `expiration, strike, type, bid, ask, volume, openInterest, quoteTimestamp` — all IV and Greeks are derivable internally via Newton-Raphson IV solver + Black-Scholes.
- **POP / probability of profit remains permanently off** (`probabilityMetricsEnabled: false` literal type). N(d2) flagged for compliance review before any surfacing.
- **Ownership model:** `OWNERSHIP_CONFIRMED_BROKER` | `OWNERSHIP_CONFIRMED_PORTFOLIO` | `OWNERSHIP_NOT_CONFIRMED` — research unlocked with disclosure; execution blocked without broker confirmation.
- **7 implementation groups (A–G)** — Group A (provider interface) requires licensing gate first.
- **Long options + all vertical spreads + all non-ownership strategies:** fully researchable brokerless once an independent chain is available.

## 4a. Audit B Findings — Preflight Layer Design

[Doc 48 — Audit B](48-audit-b-preflight-layering.md) provides the full architecture. Key decisions:

- **Two canonical layers:** `TRADE_PLAN_READINESS` (dims 1,2,3,11,12 — always evaluates) and `BROKER_EXECUTION_READINESS` (dims 4–10 — evaluates only when broker connected)
- **`overallStatus = "PASS"` semantics unchanged** — only emitted when both layers pass; order-preparation and all downstream gates are preserved exactly
- **New per-dimension statuses:** `NOT_CONNECTED`, `NOT_APPLICABLE`, `NOT_CONFIRMED`, `PLANNING_MODE`
- **Equity dim 8 (Position Requirements):** `NOT_APPLICABLE` for simple long equity (no existing position needed)
- **Options dims 9/10 without broker:** `NOT_CONFIRMED` — plan not invalidated; contract not yet verified
- **Order Preparation remains BROKER_REQUIRED** — no brokerless order-prep path; existing Sprint 2.8.1 gate unchanged
- **No DB schema migration required** for Phase 1 — new fields are additive in `result_json`
- **Test plan:** 8 required suites covering all failure matrix scenarios, broker transitions, and backward compatibility

## 5A. Sprint 2.8.7A — Implementation Complete

**BI-001 / BI-002 / BI-014 RESOLVED** — See [Doc 51](51-sprint-2.8.7a-brokerless-readiness.md) for full implementation record.

**Implemented:**
- Two-layer preflight model: `TradePlanReadiness` (dims 1–3, 11, 12) + `BrokerExecutionReadiness` (dims 4–10)
- 4 new `ValidationStatus` values: `NOT_CONNECTED`, `NOT_APPLICABLE`, `NOT_CONFIRMED`, `PLANNING_MODE`
- Trade Plan detail: two-card layout — TPR always visible, Direct Execution neutral when broker absent
- Broker absence removed as a plan-level blocker; `overallStatus` is UNAVAILABLE (not FAIL) when no broker and no plan problems
- `methodologyVersion` → `"2.8.7a"`, 57 permanent invariant tests
- `BROKER_EXECUTION_ENABLED=false` (kill switch) does NOT suppress TPR computation

---

## 5. Proposed Next Architecture Audit (Sprint 2.8.7)

Before starting Sprint 2.8.7 implementation, the following audit tasks must be completed:

### Audit A — Broker Gate Site Inventory

Enumerate every location where broker connectivity gates a feature:

1. Grep all `useIsBrokerConnected()` and `brokerConnected` call sites in `client/src/`
2. For each: classify the gated feature as BROKER_INDEPENDENT / BROKER_ENHANCED / BROKER_REQUIRED
3. Produce a gate-site manifest in this doc (section 6)

### Audit B — Execution Preflight Dimension Split

1. Review `server/services/execution-preflight-service.ts` — 12 dimensions
2. Propose the exact split between Independent Layer (dims 1–3) and Broker Layer (dims 4–12)
3. Define the new `overallStatus` vocabulary for the independent-mode result
4. Ensure existing BROKER_REQUIRED semantics (order submission, account checks) are preserved

### Audit C — Options Chain Independent Mode

1. Evaluate Twelve Data options chain endpoint availability and licensing
2. If available: design the data model for storing reference options data
3. Define the fallback behavior and UI disclosure for independent-mode options research
4. Confirm the live-broker-chain path remains available as the BROKER_ENHANCED upgrade

### Audit D — Preflight UI — Broker-Absent Mode

1. Review `client/src/components/ExecutionPreflightPanel.tsx` (or equivalent)
2. Design the broker-absent state: show independent dims, indicate broker dims as "requires connection"
3. Preserve all existing compliance disclosures

---

## 6. Gate-Site Manifest

_Populated by Audit A (2026-08-16). Full details in [Doc 47 — Audit A Report](47-audit-a-broker-gate-inventory.md)._

| ID | Surface / File | Current Gate | Classification | P | Future Behavior |
|---|---|---|---|---|---|
| BI-GATE-001 | `ExecutionPreflightPanel.tsx:219` — "Run Preflight" button | `disabled={!brokerConnected}` | BROKER_INDEPENDENT | **P0** | Enable button; show independent dims 1–3 without broker |
| BI-GATE-002 | `trade-plan-detail.tsx:241` — preflight query | `enabled: brokerConnected` | BROKER_INDEPENDENT (dims 1–3) | **P0** | Remove broker guard; dims 4–10 skip gracefully when no broker |
| BI-GATE-003 | `trade-plan-detail.tsx:1326` — execution section | `showExecution && brokerConnected` | BROKER_ENHANCED | **P1** | Show planning/lifecycle sections; hide order-submission UI only |
| BI-GATE-004 | `live-contract-resolver.tsx:611` — contract query | `enabled: pkg.brokerConnected` | BROKER_ENHANCED | **P1** | Allow independent-mode fallback (Audit C); show NOT_CONNECTED state |
| BI-GATE-005 | `live-contract-resolver.tsx:673` — render | `"broker_not_connected"` state | BROKER_ENHANCED | **P1** | Replace hard block with `"Connect broker for live contracts"` |
| BI-GATE-006 | `workspace-simplified.tsx:444` — Execute tab | `isBrokerConnected` | BROKER_REQUIRED (execution) | **P2** | Planning intro visible; execution path stays broker-gated |
| BI-GATE-007 | `workspace-sections.tsx:408` — InstaTrade state | `"no_broker"` | BROKER_REQUIRED | **P2** | `BROKER_REQUIRED_FOR_EXECUTION` label; no UX change needed |
| BI-GATE-008 | `trade-structure-engine.tsx:55` — contract section | `connected = pkg.brokerConnected` | BROKER_ENHANCED | **P1** | Show strategy structure; gate contract data fetch only |
| BI-GATE-009 | `action-card.tsx:183` — order prep CTA | `pkg.brokerConnected` | BROKER_REQUIRED ✓ | **P3** | No change |
| BI-GATE-010 | `opportunity-research.tsx:1445` — InstaTrade CTA | `pkg.brokerConnected` | BROKER_REQUIRED ✓ | **P2** | Softer message: `"Requires broker connection"` |
| BI-GATE-011 | `dashboard.tsx:2507` — portfolio section | `!brokerConnected → connect prompt` | BROKER_ENHANCED | **P1** | Fall back to manual/imported portfolio if available |
| BI-GATE-012 | `dashboard.tsx:683` — MarketCommandBar | Status indicator | BROKER_ENHANCED | **P2** | Informational — no change needed |
| BI-GATE-013 | `home-sections.tsx:231` — connection-lost banner | `connectionLost` | BROKER_ENHANCED ✓ | **P3** | No change — correct behavior |
| BI-GATE-014 | `live-positions-panel.tsx:34` — positions | `isConnected` | BROKER_REQUIRED ✓ | **P3** | No change |
| BI-GATE-015 | `OrderPreparationPanel.tsx:156` — no broker | `!brokerConnected` | BROKER_REQUIRED ✓ | **P3** | No change |
| BI-GATE-016 | `home-v2.tsx:334`, `command-center.tsx:322` — OrderReviewDialog | `brokerConnected={isConnected}` | BROKER_REQUIRED ✓ | **P3** | No change |
| BI-GATE-017 | `server/routes/internal-options.ts:165` — expirations | **409 NO_BROKER** | BROKER_ENHANCED (CON-002) | **P0** | Independent fallback when Audit C complete |
| BI-GATE-018 | `server/routes/internal-options.ts:186` — chain | **409 NO_BROKER** | BROKER_ENHANCED (CON-002) | **P0** | Independent fallback when Audit C complete |
| BI-GATE-019 | `server/routes/futures.ts:96,100` — futures | 400 broker required | BROKER_REQUIRED ✓ | **P3** | No change |
| BI-GATE-020 | `execution-preflight-service.ts:440` — broker dim | BROKER_NOT_CONNECTED → overall FAIL | BROKER_REQUIRED (dims 4+) | **P0** | Only blocks dims 4–10; dims 1–3 independent |
| BI-GATE-021 | `execution-preflight-service.ts:733` — `determineOverallStatus` | `UNAVAILABLE` when `!brokerConnected` | BROKER_INDEPENDENT masked | **P0** | `PASS_INDEPENDENT` when dims 1–3 pass, no broker |
| BI-GATE-022 | `execution-preflight-service.ts:542` — position dim | `UNAVAILABLE` all plan types | BROKER_ENHANCED | **P1** | Equity: PASS without broker; options covered/protective: BROKER_ENHANCED |
| BI-GATE-023 | `execution-preflight-service.ts:518` — buying power | `UNAVAILABLE` | BROKER_ENHANCED | **P1** | Accept user-entered budget (CON-004) |
| BI-GATE-024 | `server/routes/dashboard.ts:56–101` — portfolio | Positions from broker only | BROKER_ENHANCED | **P1** | Fall back to stored portfolio when no broker |
| BI-GATE-025 | `server/routes/opportunity-search.ts:462` — income | `brokerConnected` param | BROKER_ENHANCED | **P2** | Expected; lower priority |

---

## 7. Compliance Preservation

The Broker Independence Principle does NOT change:

- **Order submission safety** — `BROKER_EXECUTION_ENABLED` kill switch, all order guards, the
  12-step preflight requirement before any order preparation. These remain as-is.
- **Compliance disclosures** — "not an investment recommendation" language on all research
  surfaces stays unchanged.
- **Two-mode customer vocabulary** — "Analysis Mode" / "Connected Broker Mode" — this principle
  reinforces that framing and does not introduce new public vocabulary.
- **Paper trading prohibition** — no simulated fills, no virtual account balances.

---

## 8. Implementation Sequencing

1. **Principle recorded** (this document). No code changes.
2. **Sprint 2.8.7 (Audit):** Audits A–D complete. Gate-site manifest in section 6.
3. **Sprint 2.8.7A (COMPLETE):** CON-001 resolved — two-layer preflight split (`TradePlanReadiness` + `BrokerExecutionReadiness`); BI-001/002/014 RESOLVED. Production UAT: **PASS**.
4. **Sprint 2.8.7B (COMPLETE):** Equity planning quote enrichment — `PlanningQuoteData`, `getPlanningQuote?` dep, `buildPlanningModeQuoteDimension`. Quote Validation PLANNING_MODE dim now shows Twelve Data price/session/freshness for brokerless EQUITY plans. See [Doc 52](52-sprint-2.8.7b-brokerless-equity-market-data.md).
5. **Next:** Options chain independent mode (CON-002 — Audit C/C1), buying-power hypothetical substitution (CON-004), remaining Audit D UX items (BI-012/013/015–020).

---

## 9. Definition of Done for Compliance

A feature is compliant with this principle when:

- [ ] Classified as BROKER_INDEPENDENT, BROKER_ENHANCED, or BROKER_REQUIRED in this document
- [ ] BROKER_INDEPENDENT features have no `brokerConnected` hard gates (tests cover broker-absent state)
- [ ] BROKER_ENHANCED features show a graceful degradation state (not a hard error) when no broker
- [ ] BROKER_REQUIRED features are limited to the categories in section 3.3
- [ ] Any new capability proposed as BROKER_REQUIRED is reviewed against this principle before acceptance
