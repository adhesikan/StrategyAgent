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

## 6. Gate-Site Manifest (Populated by Sprint 2.8.7 Audit)

_This section is populated by Audit A above. Pending Sprint 2.8.7._

| File | Line | Gated Feature | Current Class | Correct Class | Action |
|---|---|---|---|---|---|
| (pending audit) | | | | | |

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

1. **Now (this document):** Principle recorded. No code changes.
2. **Sprint 2.8.7 (Audit):** Complete Audits A–D above. Produce gate-site manifest (section 6).
   Update this document with findings.
3. **Sprint 2.8.7 (Implementation):** Resolve CON-001 (preflight split). Resolve CON-003 (gate
   site audit). CON-002 and CON-004 may be deferred to 2.8.8 depending on scope.
4. **Sprint 2.8.8+:** Options chain independent mode (CON-002), buying-power hypothetical
   substitution (CON-004).

---

## 9. Definition of Done for Compliance

A feature is compliant with this principle when:

- [ ] Classified as BROKER_INDEPENDENT, BROKER_ENHANCED, or BROKER_REQUIRED in this document
- [ ] BROKER_INDEPENDENT features have no `brokerConnected` hard gates (tests cover broker-absent state)
- [ ] BROKER_ENHANCED features show a graceful degradation state (not a hard error) when no broker
- [ ] BROKER_REQUIRED features are limited to the categories in section 3.3
- [ ] Any new capability proposed as BROKER_REQUIRED is reviewed against this principle before acceptance
