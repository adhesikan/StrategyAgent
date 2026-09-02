# Doc 50 — Audit D: Brokerless UX, Onboarding & Graceful Degradation

**Sprint 2.8.7 Architecture Audit — Read-Only**  
**Date:** 2026-08-17  
**Status:** COMPLETE — No application code changed  
**Depends on:** [Doc 47 — Audit A](47-audit-a-broker-gate-inventory.md), [Doc 48 — Audit B](48-audit-b-preflight-layering.md), [Doc 49 — Audit C](49-audit-c-broker-independent-options.md)

---

## 1. Current Brokerless Journey — Audit Findings

### 1.1 Complete Gate Inventory (Current State)

Tracing a brand-new user with no broker through every surface:

| Stage | Surface | Current Behavior (No Broker) | Type | Priority |
|---|---|---|---|---|
| Login | `auth.tsx` | Full access | ✓ — OK | — |
| Dashboard | `dashboard.tsx` | Portfolio Intelligence section replaced by "Connect a supported broker to view portfolio context" + CTA | Soft gate | P1 |
| Dashboard | `smart-panel.tsx:125` | Next-action card becomes "Connect Broker — Link your brokerage to enable live data" | Soft but misdirected | P2 |
| Dashboard | `status-banner.tsx` | Broker status shown; not-connected styled as an actionable warning | Soft | P2 |
| Opportunity discovery | `dashboard.tsx` (opportunities section) | Opportunities surface independently — no broker required | ✓ — OK | — |
| Options scanner | `options-scanner.tsx:420` | "Connect your broker to scan / Link your brokerage account to start finding trade ideas" + Connect Broker CTA; Find Trades button disabled | Hard blocker (misclassified — scan should not require broker) | **P0** |
| Strategy scanner | `strategy-scanner.tsx:651` | Falls back to "illustrative examples" with "Connect Tradier or TradeStation for live scan results" | Soft but misleading framing | P1 |
| Futures scanner | `futures-scanner.tsx:710` | Delayed reference data; "Connect a brokerage that supports futures to enable live data" | Soft — acceptable | P2 |
| Opportunity Workspace | Various research components | Research surfaces accessible; InstaTrade® CTA becomes "Connect Broker to Verify Live Contracts" | Soft — broker CTA is premature | P1 |
| Trade structure engine | `trade-structure-engine.tsx:55` | Live contract resolution message; "Connect Broker to Verify Live Contracts" CTA | Soft but placed mid-research | P1 |
| Research action card | `action-card.tsx:183` | CTA changes from "Review with InstaTrade®" to "Connect Broker" | Soft — replaces wrong CTA | P1 |
| Trade Planning | `trade-plan-detail.tsx` | Plan creation/edit available; execution section shows broker CTA but plan save works | Mostly OK — execution panel framing needs improvement | P1 |
| Execution Preflight panel | `ExecutionPreflightPanel.tsx:217` | "Check Execution Preconditions" button disabled; helper text "Connect a broker to run execution preflight" | **CORRECT blocker** (Audit B will split into two layers) | — |
| Order Preparation panel | `OrderPreparationPanel.tsx:156` | Panel visible; content replaced by "Connect a broker to use Order Preparation" | **CORRECT blocker** | — |
| Execution Readiness panel | `ExecutionReadinessPanel.tsx` | Broker-gated | **CORRECT blocker** | — |
| Stock trade ticket | `stock-trade-ticket.tsx:925` | Submit button disabled; "Connect Broker to Use InstaTrade®" | **CORRECT blocker** | — |
| Options trade ticket | `option-trade-ticket.tsx:220` | Submit disabled; account selector "No broker connected" | **CORRECT blocker** | — |
| Workspace risk section | `workspace-sections.tsx:1257` | "No Broker Connected" risk added; lists 4 unavailable capabilities + Connect Broker CTA | Incorrect framing — most are data/provider issues not broker | **P0** |
| Risk/scenario analysis | `goal-mode.tsx`, `income-mode.tsx` | Analysis available; save toast changes to "connect a broker to place orders" | Mostly OK — toast framing could improve | P2 |
| Portfolio page | `portfolio.tsx:211` | Broker sync CTA alongside import/manual options | Acceptable — broker is one of three paths | P2 |
| Portfolio Intelligence | `dashboard.tsx:2475` | Replaced by connect panel | Soft — should show manual/import path too | P1 |
| Settings | `settings.tsx:309` | Connected/Not Connected status; no content blocked | ✓ — OK | — |
| Automation | `automation.tsx:566` | Always-visible card; "Not Connected" badge; "Connect one to enable live data" | Soft | P2 |
| News | `news.tsx:100` | Broker-dependent quote query silently disabled — no user message | Silent degradation | P2 |
| Options contract research | `internal-options.ts` (server) | HTTP 409 `NO_BROKER_CONNECTION` (BI-GATE-017/018) | Hard blocker (Audit C resolves) | P0 |
| Onboarding wizard | `onboarding-wizard.tsx` | Broker connection step present — timing TBD | Premature | P1 |
| Interactive tutorial | `interactive-tutorial.tsx`, `trading-readiness-wizard.tsx` | Broker references present | P1 | — |

### 1.2 Critical Misclassifications

**These are currently HARD BLOCKERs but should NOT be:**

1. **Options scanner (`options-scanner.tsx:420`)** — scan results come from stored market data and opportunity engine, not from live broker calls. The gate is incorrect.
2. **Options contract research (HTTP 409)** — needs an independent data provider, not a broker. (Audit C addresses.)
3. **Workspace "No Broker Connected" risk (`workspace-sections.tsx:1257`)** — lists four unavailable capabilities, most of which are data-provider issues (`live quotes`, `options chain`) rather than broker account requirements.
4. **Portfolio Intelligence "Connect broker" panel** — should equally offer manual entry and import as paths to portfolio data.

**These are CORRECT blockers and must remain:**

- Execution Preflight (full) — CORRECT; Audit B splits into two layers, not removes
- Order Preparation — CORRECT
- Order Preview — CORRECT
- Stock/Options trade ticket submit — CORRECT
- Final Order Confirmation — CORRECT
- Broker Submission — CORRECT

---

## 2. Primary Brokerless Journey Design

### 2.1 Canonical User Journey

```
FIND → RESEARCH → PLAN → MONITOR → [EXECUTE — optional]
```

Every stage 1–4 must work without a broker connection.

### 2.2 Stage Definitions

**FIND**
Discover research candidates from the opportunity engine.
- Source: VCP scan, opportunity ranking, watchlists, collections, search
- Broker: NOT required
- Data: stored OHLCV bars, opportunity scan snapshots, market regime
- Current status: ✓ works without broker

**RESEARCH**
Understand technical structure, fundamental/institutional context, risk, catalysts, evidence, limitations.
- Surfaces: Research Package, Opportunity Workspace, AI Research Workspace, Company Research, Sector/Theme Research
- Broker: NOT required
- Data: stored bars, 13F institutional data, VCP analytics, Twelve Data
- Current status: ✓ mostly works; options chain is the gap (Audit C addresses)

**PLAN**
Create a Trade Plan: expression selection, entry framework, risk framework, position assumptions, scenario analysis, monitoring conditions.
- Surfaces: Trade Planning Foundation, Equity Planning, Options Strategy Matching, Contract Research (if chain available), Risk & Scenario Analysis, Trade Plan Workspace
- Broker: NOT required for plan creation and save
- Data: planning context from research; hypothetical capital inputs
- Current status: ✓ plan creation works; some framing issues in execution panel

**MONITOR**
Track research lifecycle, material changes, plan freshness, thesis state, market movement.
- Surfaces: Trade Plan Lifecycle, Research Monitoring, Platform Health, Research Monitor
- Broker: NOT required
- Data: stored snapshots, lifecycle change engine, research watches
- Current status: ✓ works without broker

**EXECUTE — Optional**
Connect a supported broker → account-aware preflight → order preparation → preview → confirmation → submission.
- Broker: REQUIRED — this is the correct and only remaining hard gate
- Must be framed as an option, not a default expected step

---

## 3. Onboarding Design

### 3.1 Current Problem

The current onboarding wizard (`onboarding-wizard.tsx`, `trading-readiness-wizard.tsx`) includes broker connection as an early step, implying it is required to use the product.

### 3.2 Redesigned Onboarding Sequence

```
Screen 1 — Welcome
──────────────────
Welcome to VCP Trader AI

Powerful research and trade planning for equity traders.
No brokerage connection required to get started.

[Start Exploring]
──────────────────

Screen 2 — Choose your starting point
──────────────────────────────────────
What would you like to do?

[Find Opportunities]        [Research a Stock]
  Discover patterns and        Deep-dive into technical,
  ranked candidates            fundamental & institutional data

[Build a Trade Plan]        [Review My Portfolio]
  Plan your entry, risk,       Add holdings to see portfolio
  and exit framework           context in your research

──────────────────────────────────────

Screen 3 — Quick orientation (optional / skippable)
────────────────────────────────────────────────────
VCP Trader AI gives you:

✓ Ranked opportunity scanning
✓ Research packages with evidence
✓ Trade plan creation & monitoring
✓ Risk & scenario analysis
✓ Options strategy research

When you're ready to place orders:
Connect a supported broker to enable
account-aware checks and direct submission.

[Get Started]  [Learn More]
```

### 3.3 Where Broker Connection First Naturally Appears

| Moment | Trigger | Placement | Framing |
|---|---|---|---|
| First time user opens a Trade Plan's execution section | User explicitly navigates to "Direct Execution" | Within that section only | "Connect a broker to enable account-aware execution checks and order submission." |
| First time user reaches Trade Plan Readiness PASS | After plan is saved and readiness runs | Informational callout below PASS status | "Your plan is ready. Connect a broker when you want to place the order directly." |
| Options chain unavailable | Entering Contract Research with no chain data | Within the options section | "Live option data not available. You can still explore theoretical values. Connect a broker to use their live chain." |
| Portfolio sync prompt | After manually entering holdings | Below import/manual entry | "You can also sync holdings automatically with a connected broker." |

Broker is NEVER the primary onboarding step. It is contextually introduced when its value is immediately relevant.

---

## 4. Dashboard Design (Brokerless)

### 4.1 Section Inventory and Brokerless Treatment

| Section | Current (No Broker) | Redesigned (No Broker) |
|---|---|---|
| Market Signals / VIX / Regime | ✓ Shows | ✓ Unchanged |
| Ranked Opportunities | ✓ Shows | ✓ Unchanged |
| Trade Plans | ✓ Shows | ✓ Unchanged |
| Research Monitoring / Watches | ✓ Shows | ✓ Unchanged |
| Portfolio Intelligence | ❌ "Connect broker" panel | Add Holdings / Import Portfolio / Connect Broker as equal-weight paths |
| Smart Panel (next action) | ❌ "Connect Broker" as primary CTA | Context-aware CTA: "Continue Research" or "Open Trade Plan" |
| Status banner | Broker "Not Connected" warning | Informational; not a warning unless user has expressed execution intent |

### 4.2 Portfolio Empty State (No Broker, No Portfolio)

```
Your Portfolio
──────────────────────────────────
No holdings added yet.

Add holdings to see portfolio context
in your research and planning.

[Add Holdings Manually]   [Import CSV / XLSX]   [Sync with Broker]
──────────────────────────────────
```

Three equal-weight paths. Broker is the third option, not the default.

### 4.3 Smart Panel Priority (No Broker)

```
PRIMARY CTA:   Continue Research / Open Opportunity / Build Trade Plan
SECONDARY CTA: Connect Broker — Optional (shown only when plan exists and execution is next logical step)
```

"Link your brokerage to enable live data" is NOT shown as the dashboard primary CTA for users who haven't expressed execution intent.

---

## 5. Trade Planning Design (Brokerless)

### 5.1 Equity Planning — Brokerless Capabilities

All of the following work without a broker:

| Capability | Source | Status |
|---|---|---|
| Reference market data (current price) | Twelve Data daily bar | ✓ Available |
| Entry framework | Deterministic from research context | ✓ Available |
| Risk/invalidation level | Deterministic | ✓ Available |
| Scenario analysis | `trade-risk-scenario-service.ts` | ✓ Available |
| Hypothetical quantity / allocation | User input | ✓ Available |
| Estimated notional | quantity × reference price | ✓ Available |
| Trade Plan save | DB persist | ✓ Available |
| Planning Constraints | Deterministic | ✓ Available |
| Lifecycle monitoring | DB snapshots | ✓ Available |

**Execution-specific items (require broker):**
Live buying power, actual account positions, order construction, order submission.

### 5.2 Options Planning — Brokerless Capabilities

| Capability | Mode | Source | Status |
|---|---|---|---|
| Strategy family matching | All | `options-strategy-matching-service.ts` | ✓ Available |
| Theoretical option values (HV model) | `UNDERLYING_ONLY_THEORETICAL_MODE` | VCP Black-Scholes + HV | ✓ Available (Group B+C) |
| Theoretical strike grid | Same | VCP model | ✓ Available (Group B+C) |
| Contract research | `MODE_A` when independent chain available | Independent provider | ✓ Available after BI-007+Group A |
| Risk & scenario analysis | All | `trade-risk-scenario-service.ts` | ✓ Available |
| Capital requirement calculations | All | Deterministic | ✓ Available |
| Trade Plan save | All | DB persist | ✓ Available |

### 5.3 Execution Warnings — What NOT to Show During Planning

During ordinary trade planning, do NOT show:
- ❌ "Connect broker to run preflight" — this belongs in the execution section, not the plan editor
- ❌ "No live broker quote available" as a plan-blocking message (use `END_OF_DAY` data label instead)
- ❌ "Live contracts unavailable" in the strategy matching section (wrong stage — strategy matching is pre-contract)

---

## 6. Trade Plan Workspace Design (Brokerless)

### 6.1 Two-Section Layout

```
┌─────────────────────────────────────────────────┐
│  TRADE PLAN READINESS                           │
│  ─────────────────────────────────────────      │
│  ✓  Research Current                           │
│  ✓  Plan Current                               │
│  ✓  Risk Framework Available                   │
│  ✓  Market Data Current                        │
│  ✓  Planning Constraints Available             │
│                                                 │
│  ✅  PLAN READY                                │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  DIRECT EXECUTION                               │
│  ─────────────────────────────────────────      │
│  Brokerage not connected.                      │
│                                                 │
│  Connect a supported broker to enable           │
│  account-aware execution checks and direct      │
│  order submission.                              │
│                                                 │
│  [Connect Broker — Optional]                   │
└─────────────────────────────────────────────────┘
```

**Visual design rules:**
- Trade Plan Readiness section: prominent, green-accented when PASS
- Direct Execution section: neutral/muted styling — NOT red, NOT error treatment
- "PLAN READY" is the headline state, not the broker absence
- "Connect Broker — Optional" is a secondary button, not primary

---

## 7. Preflight UX Design (Applies Audit B)

### 7.1 Two-Layer Visual Design

```
TRADE PLAN READINESS            BROKER EXECUTION READINESS
───────────────────────         ──────────────────────────
✓ Trade Plan           PASS     ○ Broker Connection   NOT CONNECTED
✓ Research Lifecycle   PASS
✓ Plan Freshness       PASS     Connect a supported broker to enable
✓ Risk Analysis        PASS     account-aware execution checks.
✓ Planning Constraints PASS
✓ Quote Validation     PLANNING MODE   [Connect Broker]

PLAN READY ✅                   (neutral • not an error)
```

### 7.2 Visual State Rules

| State | Color/Icon | Label |
|---|---|---|
| PASS | Green ✓ | "Pass" or "Current" |
| PLANNING_MODE | Blue ○ | "Planning Mode" (not a failure) |
| NOT_CONNECTED | Gray ○ | "Not Connected" (not an error) |
| NOT_CONFIRMED | Amber ○ | "Unconfirmed — see details" |
| FAIL | Red ✗ | "Action required" |
| NOT_APPLICABLE | Gray — | "N/A" |

**Color-only communication is forbidden.** Every state uses a text label AND an icon. ARIA roles applied per state.

### 7.3 Execution Intent Transition

When user clicks "Connect Broker for Direct Execution" from this panel:
- Broker CTA becomes PRIMARY
- Language shifts: "A connected broker account is required to run execution checks and submit orders."
- Navigation: to broker connection flow or settings

---

## 8. Options Three-Mode UX

### 8.1 Mode A — Independent Option Market Data Available

```
OPTIONS CONTRACT RESEARCH
AAPL — Long Call
────────────────────────────────────────────
Source: [Independent Options Feed] [Delayed 15min]

EXPIRATIONS                    CHAIN (Oct 18, 2026)
Oct 18, 2026  ✓               Strike  Bid    Ask    IV      Δ
Nov 21, 2026                  $145    $8.20  $8.40  38.2%   0.68
Dec 19, 2026                  $150    $4.90  $5.10  36.5%   0.55 ←
                              $155    $2.50  $2.70  34.8%   0.40

Liquidity: Acceptable  |  Spread: 4.1%  |  OI: 842

[Select for Research]    Data: Independent provider  |  Observed: 10:32 ET
────────────────────────────────────────────
```

### 8.2 Mode B — Underlying-Only Theoretical Mode

```
THEORETICAL OPTIONS RESEARCH
AAPL — Long Call
────────────────────────────────────────────
⚠ Theoretical values — not live option quotes.

Volatility: 30-day Historical (28.4%)  |  Model: Black-Scholes

HYPOTHETICAL SCENARIOS

DTE        Strike    Theoretical    Delta       Theta
                     Value          (model)     (model)
30 DTE     $145      ~$5.40         ~0.62       ~-0.08
30 DTE     $150      ~$3.20         ~0.48       ~-0.09  ← ATM
30 DTE     $155      ~$1.70         ~0.33       ~-0.07
45 DTE     $150      ~$4.10         ~0.50       ~-0.07
60 DTE     $150      ~$4.90         ~0.51       ~-0.06

"~" indicates model estimate. Actual market prices will differ.

[Methodology ▼]
  Black-Scholes model with continuous dividends
  Volatility: 30-day historical (28.4% annualized, 63 observations)
  Rate: ~5.0% (approximate)
  Dividend yield: 0% assumed

[Explore Theoretical Options]
────────────────────────────────────────────
```

**NEVER visually imitate an actual option chain.** No OCC symbols. No bid/ask columns. No open interest column. "~" prefix on all values.

### 8.3 Mode C — Broker Connected

```
OPTIONS CONTRACT RESEARCH
AAPL — Long Call
────────────────────────────────────────────
Source: Tradier (live)  |  Account: ●  Connected  |  ⚡ Real-time

[Full chain display with live bid/ask, OI, IV, Greeks]

Account context:
Buying power: available  |  Options permission: Level 2 ✓

[Select for Research]   [Prepare for Execution]
────────────────────────────────────────────
```

Independent research data is preserved alongside. Broker data enriches — it does not replace.

---

## 9. Theoretical Options UX Language

### 9.1 Field Labels (Novice-Friendly)

| Internal Name | Display Label | Inline Tooltip / Subtitle |
|---|---|---|
| `MODEL_CALL_VALUE` | Theoretical Value (Call) | Model estimate — not the current option market price |
| `MODEL_PUT_VALUE` | Theoretical Value (Put) | Same |
| `MODEL_DELTA` | Delta | Model estimate based on historical volatility |
| `MODEL_GAMMA` | Gamma | Same |
| `MODEL_THETA` | Theta (per day) | Same |
| `MODEL_VEGA` | Vega | Same |
| `HYPOTHETICAL_EXPIRATION` | N DTE (hypothetical) | Not a listed expiration date |
| `THEORETICAL_STRIKE_GRID` | Theoretical Strike Grid | Not an option chain — model values only |
| `HV30` | 30-day Historical Volatility | Annualized from underlying price history |

### 9.2 Expandable Methodology Pattern

```
Delta   0.42   [Model estimate]
                ↕ Expand: Methodology
                  Black-Scholes model
                  Volatility input: 30-day historical (28.4%)
                  This is not market-observed delta.
```

The "Model estimate" badge is always visible without expanding. The full methodology is one click away, never buried.

### 9.3 When Actual Chain Becomes Available (Mode Transition Message)

```
Theoretical values were shown while live option data was unavailable.
Now showing live market data from [Provider].

[View Comparison]  — shows theoretical vs market side-by-side
```

---

## 10. Portfolio UX Design

### 10.1 Three Equal-Weight Entry Paths

```
YOUR PORTFOLIO
──────────────────────────────────────────────
No holdings added yet.

Choose how to add your holdings:

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  + Add Manually │  │  ↑ Import File  │  │  ⟳ Sync Broker  │
│                 │  │                 │  │                 │
│  Enter positions│  │  Upload CSV or  │  │  Connect Tradier│
│  one at a time  │  │  XLSX file      │  │  or TradeStation│
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 10.2 Portfolio Provenance Badge

| Source | Badge | Confidence for Covered-Call Research |
|---|---|---|
| Manual entry | `[Manual • User Supplied]` | `OWNERSHIP_NOT_CONFIRMED` |
| CSV/XLSX import | `[Imported • User Supplied]` | `OWNERSHIP_CONFIRMED_PORTFOLIO` |
| Broker sync | `[Tradier • Broker Synced]` | `OWNERSHIP_CONFIRMED_BROKER` |

Research intelligence works across all three. Execution confirmation only with `OWNERSHIP_CONFIRMED_BROKER`.

### 10.3 Manual/Imported Portfolio in Options Research

```
COVERED CALL RESEARCH — AAPL
────────────────────────────────────────────
Portfolio: 200 shares (Imported)
[Imported • User Supplied]

⚠ Portfolio data indicates 200 shares.
  Execution of a covered call requires 100 shares per contract.
  Broker verification required before placing an order.

[Full covered call research available]
────────────────────────────────────────────
```

NEVER says "Broker verified" when source is imported. NEVER blocks research when source is `OWNERSHIP_CONFIRMED_PORTFOLIO`.

---

## 11. Risk Analysis & Position Sizing UX (Brokerless)

### 11.1 Hypothetical Capital Input Panel

```
PLANNING ASSUMPTIONS
────────────────────────────────────────────
Planning Capital          $25,000
                          [Edit]

Max Planned Allocation    5%
                          [Edit]

Calculated Planning Amount  $1,250

This is a planning assumption.
Actual buying power is verified when you connect a broker.
────────────────────────────────────────────
```

Label: `[Planning Assumption]` distinguishes from `[Broker Verified]`.

### 11.2 Enrichment When Broker Connected

```
PLANNING ASSUMPTIONS
────────────────────────────────────────────
Planning Capital          $25,000    [Edit]
Broker Buying Power       $31,420    [Tradier • Live]

Max Planned Allocation    5%         [Edit]
Planned Amount            $1,250     [Planning Assumption]

Note: Broker buying power shown for reference.
Planning amount is your manual input.
────────────────────────────────────────────
```

Broker enrichment is additive. User's planning assumption is never silently overwritten.

---

## 12. Data Provenance Badge System

### 12.1 Badge Vocabulary (Concise)

| Badge | Meaning |
|---|---|
| `Twelve Data • End-of-Day` | Daily close bar from Twelve Data |
| `Twelve Data • Real-time` | Real-time quote from Twelve Data |
| `VCP Model • HV30` | VCP Black-Scholes with 30-day historical volatility |
| `VCP Model • IV Solved` | VCP Black-Scholes with IV solved from market mid |
| `Independent Options Feed • Delayed 15m` | Options chain from independent provider, 15-min delayed |
| `[Provider] • Real-time` | Live broker chain |
| `Imported Portfolio • User Supplied` | From CSV/XLSX import |
| `Broker Synced • [Provider]` | From connected broker positions API |
| `Manual • User Supplied` | User-entered value |
| `Stored • [N days ago]` | From stored opportunity snapshot |

### 12.2 Display Pattern

```
[Badge]                     (always visible inline, concise)
  ↕ Details                (expandable: observed timestamp, quality, method)
```

Do not show all provenance fields inline. Badge + expandable = correct balance for novice users.

---

## 13. Error / Limitation Taxonomy

### 13.1 Five States

```
ERROR
  Something failed unexpectedly.
  Example: API timeout, server error, unexpected null
  Treatment: Red; "Something went wrong — try again"

BLOCKER
  User cannot complete the intended action.
  Example: Execution without broker; plan save failed
  Treatment: Amber/red depending on severity; clear explanation + action

LIMITATION
  Feature available with reduced data or capability.
  Example: Options theoretical mode instead of live chain
  Treatment: Informational/blue; explains what's available and why

ENHANCEMENT_AVAILABLE
  Optional connection or data can enrich the result.
  Example: Broker connected adds live quote; import adds portfolio context
  Treatment: Neutral/subtle; secondary CTA; never visually dominant

INFORMATION
  Neutral context the user should know.
  Example: Data is end-of-day; volatility is 30-day historical
  Treatment: Gray/subtle inline badge or tooltip
```

### 13.2 Broker Absence Classification

| Context | Classification | Treatment |
|---|---|---|
| Broker absent during research | `ENHANCEMENT_AVAILABLE` | Neutral badge; secondary CTA |
| Broker absent during trade planning | `ENHANCEMENT_AVAILABLE` | Informational; secondary CTA below plan save |
| Broker absent when Trade Plan Readiness runs | `INFORMATION` (for broker layer) | "NOT CONNECTED" neutral state |
| Broker absent when user requests order submission | `BLOCKER` | "A connected broker account is required to submit orders." |
| Options chain absent (no provider) | `LIMITATION` | "Theoretical mode available" |
| Options chain absent (broker only available) | `ENHANCEMENT_AVAILABLE` | Offer theoretical mode; broker as secondary |

---

## 14. Call-to-Action Hierarchy

### 14.1 CTA Priority by Context

| Surface | Primary CTA | Secondary CTA |
|---|---|---|
| Research / Opportunity Workspace | Continue Research / Build Trade Plan | Connect Broker — Optional |
| Trade Planning | Save Plan / Continue Planning | Connect Broker for Direct Execution |
| Completed Trade Plan (no execution intent) | Review Plan / Monitor Plan | Connect Broker for Direct Execution |
| Trade Plan Readiness (PASS, no broker) | "Plan is ready" (informational) | Connect Broker |
| Explicit execution intent | **Connect Broker** (primary — broker is now genuinely required) | Cancel |
| Options (no chain) | Explore Theoretical Options | Connect Broker or [Provider] for live chain |
| Portfolio (empty) | Add Holdings Manually | Import File / Sync Broker |

### 14.2 Broker CTA Becomes Primary ONLY When

1. User explicitly navigates to "Direct Execution" section of a Trade Plan
2. User clicks "Prepare for Execution" — which requires broker by design
3. User attempts to submit an order from a trade ticket
4. User explicitly selects "Connect Broker" from secondary CTA

In all other contexts, broker CTA is secondary, unobtrusive, and clearly labeled "Optional" or "for Direct Execution."

---

## 15. Guided Novice Journey

### 15.1 Five-Step Visual Guide

```
Step 1 of 5  —  Find an Opportunity
     │
     │    Discover ranked candidates from the scanner or watchlist.
     │    [Browse Opportunities]
     ↓
Step 2 of 5  —  Review the Research
     │
     │    Explore technical patterns, institutional activity, and evidence.
     │    [Open Research]
     ↓
Step 3 of 5  —  Build Your Trade Plan
     │
     │    Define your entry idea, risk framework, and position size.
     │    [Create Trade Plan]
     ↓
Step 4 of 5  —  Review Risk & Scenarios
     │
     │    Understand maximum loss, breakeven, and scenario outcomes.
     │    [View Scenarios]
     ↓
Step 5 of 5  —  Monitor or Execute

     ┌──────────────────────────┐   ┌──────────────────────────┐
     │  Monitor Your Plan       │   │  Execute Directly        │
     │  No broker required      │   │  Requires a connected    │
     │                          │   │  broker account          │
     │  [Set Up Monitoring]     │   │  [Connect Broker]        │
     └──────────────────────────┘   └──────────────────────────┘
```

**The guide must never imply that direct execution is required.** Monitoring is presented as a complete outcome.

### 15.2 Accessibility of the Guide

- Skippable at any step
- Resumable from dashboard
- Never shown again once all 5 steps are completed
- Broker CTA at step 5 is one of two equal-weight options — not the only completion path

---

## 16. Terminology Recommendations

No code changes — these are display/copy recommendations:

| Internal / Technical Term | Current Display | Recommended Novice Label | Notes |
|---|---|---|---|
| `EXECUTION_PREFLIGHT` | "Execution Preflight" | "Execution Checks" | More intuitive; preserve internal name |
| `RESEARCH_LIFECYCLE` | "Research Lifecycle" | "Research Status" | Clearer for novices |
| `PLANNING_CONSTRAINTS` | "Planning Constraints" | "Plan Limits" | Shorter and less jargon |
| `STRUCTURE_VALIDATION` | "Structure Validation" | "Plan Structure Check" | — |
| `POSITION_REQUIREMENTS` | "Position Requirements" | "Ownership Requirements" | More descriptive |
| `QUOTE_VALIDATION` | "Quote Validation" | "Price Check" | — |
| `TRADE_PLAN_READINESS` | "Trade Plan Readiness" | "Plan Readiness" | Acceptable as-is for intermediate users |
| `BROKER_EXECUTION_READINESS` | — (new) | "Execution Checks" | Plain language in UI |
| `UNDERLYING_ONLY_THEORETICAL_MODE` | — (internal) | "Theoretical Options Research" | Never surface internal mode name |
| `THEORETICAL_STRIKE_GRID` | — (internal) | "Theoretical Strike Grid" | Keep "theoretical" — is clearly labeled |
| `OWNERSHIP_CONFIRMED_PORTFOLIO` | — (internal) | "Shares indicated by your imported portfolio" | Always explicit about source |

---

## 17. Empty-State Design

Every empty state answers: **What is this? Why isn't data available? Can I continue without it? What can I do next?**

### 17.1 Portfolio (No Holdings)

```
Your Portfolio
────────────────────────────────────────────
Your portfolio will show concentration, risk context,
and ownership for strategy research.

No holdings added yet.

[Add Holdings Manually]   [Import CSV / XLSX]   [Sync with Broker]
────────────────────────────────────────────
```

### 17.2 Options Chain (No Provider)

```
Live Option Data Unavailable
────────────────────────────────────────────
Live option contract data isn't currently available.

You can still explore theoretical option values and strategy
scenarios using the underlying stock data.

[Explore Theoretical Options]

────────── Optional ──────────
Connect a broker or independent option feed to access live chains.
[Connect Broker]
────────────────────────────────────────────
```

### 17.3 Broker Execution (No Broker)

```
Direct Execution
────────────────────────────────────────────
Your trade plan is ready for research and monitoring.

To place orders directly, connect a supported brokerage account.
This will enable account-aware execution checks and order submission.

[Connect Broker]

Your plan is saved and fully accessible without a broker.
────────────────────────────────────────────
```

### 17.4 Positions (No Broker, No Portfolio)

```
Positions
────────────────────────────────────────────
No positions on file.

For covered strategies (covered call, protective put, collar),
ownership of the underlying shares is required for execution.

Add your holdings to proceed with covered-strategy research:

[Import Portfolio]   [Add Manually]   [Sync Broker]
────────────────────────────────────────────
```

### 17.5 Buying Power (No Broker)

```
Buying Power
────────────────────────────────────────────
Actual buying power is verified through a connected brokerage.

For planning purposes, enter your planning capital above.
This is used for position sizing estimates only.

[Add Planning Capital]
────────────────────────────────────────────
```

### 17.6 Options Permissions (No Broker)

```
Options Permissions
────────────────────────────────────────────
Your options permission level is verified through your broker.

Without a connected broker, you can still:
• Research any options strategy
• Build a trade plan
• Analyze risk and scenarios

Execution requires a connected broker with the appropriate permission level.
────────────────────────────────────────────
```

---

## 18. Mobile / Responsive UX

### 18.1 Two-Layer Readiness on Narrow Screens

On screens < 768px, the two-layer readiness panel stacks vertically:

```
┌──────────────────────────────┐
│  TRADE PLAN READINESS        │
│  ✓ Research Current          │
│  ✓ Plan Current              │
│  ✓ Risk Framework            │
│  ✓ Market Data               │
│  ✓ Planning Constraints      │
│  ✅ PLAN READY               │
└──────────────────────────────┘

┌──────────────────────────────┐
│  DIRECT EXECUTION            │
│  ○ Not Connected             │
│                              │
│  [Connect Broker — Optional] │
└──────────────────────────────┘
```

### 18.2 Options Mode Cards on Narrow Screens

Show mode selector as a tab bar (not side-by-side columns):

```
[Market Data]  [Theoretical]  [Broker]
─────────────────────────────────────
(selected mode content below)
```

### 18.3 Data Provenance on Narrow Screens

Badge shows abbreviation: `[TD • EOD]` → expandable to full label. Never truncate critical disclosure (model estimates must remain visible).

---

## 19. Accessibility

### 19.1 State Communication Rules

Every state communicates via at minimum two of: color, text label, icon.

| State | Color | Icon | Text Label | ARIA |
|---|---|---|---|---|
| PASS / Ready | Green | ✓ checkmark | "Pass" | `aria-label="Status: Pass"` |
| NOT_CONNECTED | Gray | ○ circle | "Not Connected" | `aria-label="Status: Not Connected"` |
| PLANNING_MODE | Blue | ○ circle | "Planning Mode" | `aria-label="Status: Planning Mode"` |
| FAIL | Red | ✗ x-mark | "Action required" | `aria-label="Status: Action required"` |
| LIMITATION | Blue | ⚠ triangle | "Limited data available" | `aria-label="Status: Limited data"` |
| ENHANCEMENT | Neutral | + plus | "Optional enhancement" | `aria-label="Optional: enhance with [x]"` |

"NOT_CONNECTED" for broker absence: **gray, not red**. Never uses error/failure semantics.

### 19.2 Interactive Disclosures

All expandable methodology sections must be keyboard-accessible. `aria-expanded` on the toggle button. Focus trap not used — disclosure is additive content.

---

## 20. Marketing Alignment

### 20.1 Positioning Statement

> "Start researching immediately — no brokerage connection required."

### 20.2 Product Copy Framework

```
Find opportunities.
Research the evidence.
Build a Trade Plan.
Monitor what changes.

Connect a broker only when you want direct execution.
```

### 20.3 Prohibited Copy Patterns

- ❌ "Connect your broker to continue" (implies broker required for research)
- ❌ "Link your brokerage to enable live data" as dashboard primary CTA
- ❌ "No broker connected" as an error or warning during research
- ❌ "Broker required" during options strategy matching or risk analysis
- ❌ Any investment-advice language ("best choice", "recommended action")

### 20.4 Approved Copy Patterns

- ✓ "Connect a broker if you'd like account-aware execution checks and direct order submission."
- ✓ "Theoretical values — not live option quotes."
- ✓ "Plan is ready. Connect a broker when you want to place the order directly."
- ✓ "Your plan is saved and fully accessible without a broker."
- ✓ "Live option data isn't currently available. You can still explore theoretical values."

---

## 21. Analytics Event Design

No implementation — design only. No sensitive financial payloads in any event.

| Event | Trigger | Properties (safe) |
|---|---|---|
| `brokerless_session_started` | User logs in with no broker configured | none |
| `brokerless_opportunity_opened` | User opens an opportunity with no broker | `{ symbolCategory: "equity" }` |
| `brokerless_trade_plan_created` | Trade plan saved with no broker | `{ planType: "equity" \| "options" }` |
| `brokerless_plan_readiness_run` | Trade Plan Readiness check run without broker | `{ result: "PASS" \| "FAIL" \| "REVIEW" }` |
| `theoretical_options_opened` | User enters theoretical options mode | none |
| `theoretical_options_dte_selected` | DTE scenario selected in theoretical mode | `{ dte: 30 }` |
| `portfolio_import_selected` | User clicks Import Portfolio | `{ source: "csv" \| "xlsx" }` |
| `portfolio_manual_add_started` | User clicks Add Holdings Manually | none |
| `broker_connect_cta_seen` | Broker CTA is visible on screen | `{ surface: "trade_plan" \| "preflight" \| "options" }` |
| `broker_connect_started` | User clicks any broker connect CTA | `{ surface: string }` |
| `execution_intent_selected` | User explicitly enters execution flow | none |
| `onboarding_step_completed` | Step 1–5 completed | `{ step: 1–5 }` |
| `onboarding_skipped` | User skips onboarding | `{ atStep: 1–5 }` |

---

## 22. Failure / UX Matrix

| Scenario | Primary Message | Status | Primary CTA | Secondary CTA | Available Functionality |
|---|---|---|---|---|---|
| New user / no broker | "Start researching — no broker required." | Normal | Find Opportunities | Connect Broker (optional) | Full FIND→RESEARCH→PLAN→MONITOR |
| Returning user / no broker | Dashboard shows opportunities + active plans | Normal | Open Plan / Browse | Connect Broker (optional) | Same as above |
| User with manual holdings | "Holdings added manually." | Normal | Research with Portfolio | Import File / Sync Broker | Full research; execution requires broker confirm |
| User with imported portfolio | "Portfolio imported." | Normal | Research with Portfolio | Sync Broker | Full research; covered-strategy research unlocked |
| User with independent option feed | "Options Research Available" | Normal | View Options Research | Connect Broker for execution | Full options contract research |
| Theoretical-only options mode | "Theoretical options available." | LIMITATION | Explore Theoretical Options | Connect Broker (optional) | Theoretical grid, strategy matching, scenarios |
| Broker-connected user | Full capability | Enhanced | Research / Execute | — | All capabilities |
| Broker disconnected (mid-session) | "Broker disconnected. Research and planning continue." | LIMITATION | Reconnect Broker | Continue Without | Full FIND→RESEARCH→PLAN→MONITOR |
| Broker unsupported (wrong provider) | "Broker not yet supported for direct execution." | LIMITATION | Browse Supported Brokers | Continue Without | Full FIND→RESEARCH→PLAN→MONITOR |
| Market data delayed | "[Source] • Delayed N min" badge | INFORMATION | Continue | — | All research; execution requires live quote |
| Market data unavailable | "Market data currently unavailable." | LIMITATION | Try Again | Use Stored Data | Limited to stored bar research |
| Execution requested without broker | "A connected broker account is required to submit orders." | BLOCKER | Connect Broker | Cancel | None for execution; plan remains accessible |

---

## 23. Screen-by-Screen Change Manifest

This is the implementation checklist for UX Group work.

| Screen / Component | Current Broker-Dependent Behavior | Future Behavior | Copy Change | CTA Change | Priority | Group |
|---|---|---|---|---|---|---|
| `onboarding-wizard.tsx` | Broker connection as early required step | Move broker to contextual step 5 (optional) | Remove "connect broker to start" | Step 5: "Monitor or Execute" with two equal paths | P0 | A |
| `trading-readiness-wizard.tsx` | Broker connection in readiness check | Broker is optional enhancement, not a readiness gate | Replace "you need a broker" with "to execute directly, add a broker" | Connect Broker → secondary | P1 | A |
| `options-scanner.tsx:420` | Hard blocker "Connect your broker to scan" | Scanner uses stored opportunity data; broker enriches with live fill | Remove hard block; show scan from stored data; broker adds execution context | "Find Trades" enabled; broker CTA secondary | **P0** | B |
| `strategy-scanner.tsx:651` | Falls back to "illustrative examples" with broker CTA | Use stored bars / reference data; label `END_OF_DAY` not "illustrative" | Remove "illustrative examples" framing; use "end-of-day reference data" | Remove "Connect for live results" as primary | P1 | B |
| `dashboard.tsx:2475` | Portfolio Intelligence → "Connect broker" panel | Show three equal-weight portfolio paths | "Add Holdings / Import / Sync Broker" | Three equal CTAs | P1 | B |
| `smart-panel.tsx:125` | "Connect Broker — Link your brokerage to enable live data" as primary | Context-aware: primary = Continue Research or Open Plan | Replace "Link your brokerage" as primary | Broker CTA → secondary | P1 | B |
| `workspace-sections.tsx:1257` | "No Broker Connected" risk listing 4 broker-attributed gaps | Reframe as data-provider limitations, not broker requirements | "Live data not connected" not "no broker" | Broker CTA → secondary; add "Theoretical Options" path | **P0** | E |
| `action-card.tsx:183` | CTA replaces to "Connect Broker" | "Continue Research" as primary; broker secondary | "Connect Broker to Verify Contracts" → "Research Available | Connect Broker for Live Contracts (optional)" | Primary CTA restored | P1 | E |
| `trade-structure-engine.tsx:55` | "Connect Broker to Verify Live Contracts" mid-research | Theoretical mode offered first; broker as secondary | "Live contracts unavailable. Explore theoretical values." | "Explore Theoretical" primary; broker secondary | P1 | E |
| `trade-plan-detail.tsx` (execution section) | Execution section shown; broker CTA inside | Redesign as two-section layout (Audit B) | "PLAN READY" headline; "Direct Execution: Not Connected" neutral | Broker → secondary, neutral styled | P0 | D |
| `ExecutionPreflightPanel.tsx:217` | Single panel; disabled when no broker | Two layers: Plan Readiness (runs) + Broker Execution (NOT CONNECTED neutral) | Two section labels; "Plan Ready" possible without broker | "Run Preflight" → enabled for plan readiness layer | P0 | D |
| `portfolio.tsx` | Import/sync/manual paths exist | Keep three paths; equalize visual weight | Ensure broker is not privileged | No change to CTAs; adjust visual weight if needed | P2 | F |
| `Portfolio Intelligence (dashboard)` | "Connect broker" panel replaces metrics | Show portfolio-source paths equally | "Add Holdings to see portfolio context" | Three paths | P1 | F |
| `goal-mode.tsx`, `income-mode.tsx` | Toast: "connect broker to place orders" | Toast: "Plan saved. Connect a broker when ready to execute." | Soften toast copy | No CTA change | P2 | C |
| `news.tsx` | Silent degradation of broker quote | Surface INFORMATION badge: `END_OF_DAY` data | Add badge; no error | No CTA needed | P2 | G |
| `status-banner.tsx` | Broker "Not Connected" as warning | INFORMATION level, not warning, unless execution pending | "Broker: Not Connected" → gray badge, not amber/red | Remove urgent styling | P1 | G |
| Options Contract Research (server 409) | HTTP 409 NO_BROKER_CONNECTION | Independent provider path (Audit C Group D); theoretical fallback | Remove 409 gate | "Options Research Available" | P0 | E |

---

## 24. Implementation Groups

### Group A — Navigation & Onboarding

**Scope:** Redesign onboarding wizard to remove broker as required step; update `trading-readiness-wizard.tsx`; introduce 5-step guided journey; contextual broker introduction.

**Files:** `client/src/components/onboarding-wizard.tsx`, `client/src/components/trading-readiness-wizard.tsx`, `client/src/components/welcome-tutorial.tsx`, new guided journey component.

### Group B — Dashboard Brokerless Experience

**Scope:** Portfolio Intelligence empty state (three paths); Smart Panel next-action logic; options scanner broker hard-block removal; strategy scanner framing; status banner downgrade.

**Files:** `client/src/pages/dashboard.tsx`, `client/src/components/smart-panel.tsx`, `client/src/pages/options-scanner.tsx`, `client/src/pages/strategy-scanner.tsx`, `client/src/components/status-banner.tsx`.

### Group C — Trade Planning

**Scope:** Execution warning removal from plan editor; toast copy adjustments; planning capital input panel; hypothetical position sizing.

**Files:** `client/src/pages/goal-mode.tsx`, `client/src/pages/income-mode.tsx`, trade planning form components.

### Group D — Trade Plan Readiness

**Scope:** Two-section layout in Trade Plan Workspace (Plan Readiness + Direct Execution); ExecutionPreflightPanel redesign per Audit B; neutral NOT_CONNECTED styling.

**Files:** `client/src/pages/trade-plan-detail.tsx`, `client/src/components/execution/ExecutionPreflightPanel.tsx`, `client/src/components/execution/ExecutionReadinessPanel.tsx`.

### Group E — Options Research Modes

**Scope:** Three-mode options UX (Market / Theoretical / Broker); Mode B theoretical grid UI; action-card CTA redesign; workspace-sections broker risk reframe; connect-broker→theoretical-options fallback copy.

**Files:** `client/src/components/research/action-card.tsx`, `client/src/components/research/structure/trade-structure-engine.tsx`, `client/src/components/research/workspace/workspace-sections.tsx`, new theoretical options UI components (depends on Audit C Group C+D implementation).

### Group F — Portfolio Entry

**Scope:** Three-path portfolio empty state; provenance badges (Manual / Imported / Broker Synced); Portfolio Intelligence three-path dashboard panel.

**Files:** `client/src/pages/portfolio.tsx`, `client/src/pages/dashboard.tsx` (portfolio section).

### Group G — Data Provenance

**Scope:** Global badge component (`ProvBadge`); freshness quality states; expandable methodology pattern; news silent-degradation fix.

**Files:** New `client/src/components/prov-badge.tsx`; `client/src/pages/news.tsx`.

### Group H — Guided Journey

**Scope:** Optional 5-step guided journey component; step tracker state; skippable/resumable; broker-optional at step 5.

**Files:** New `client/src/components/guided-journey.tsx` (or extension of `interactive-tutorial.tsx`).

### Group I — Broker Execution Transition

**Scope:** Execution-intent state management; language transition from "optional" to "required" when execution is explicitly requested; execution-specific entry points.

**Files:** `client/src/pages/trade-plan-detail.tsx` (execution section), `client/src/components/execution/*.tsx`.

---

## 25. End-to-End Acceptance Criteria

**A brand-new user with NO broker must be able to:**

1. ✅ Log in and arrive at a dashboard that does not present broker absence as a problem
2. ✅ Discover a ranked opportunity from the opportunity engine
3. ✅ Open the Research Package / Opportunity Workspace and view all research content
4. ✅ Build a Trade Plan (equity) — including entry framework, risk, and scenario analysis
5. ✅ Save the Trade Plan and reload it without data loss
6. ✅ Reopen the plan and review risk/scenario information
7. ✅ Run Trade Plan Readiness — Trade Plan Readiness layer reaches PASS; Broker layer shows NOT CONNECTED in neutral styling (not an error)
8. ✅ Monitor the plan — lifecycle state, research freshness, material changes tracked
9. ✅ Perform equity research using broker-independent market data (Twelve Data daily bars)
10. ✅ Perform options strategy matching (family selection — already independent)
11. ✅ Use theoretical options mode — strike grid, DTE scenarios, model Greeks with disclosure labels
12. ✅ Import or manually enter portfolio data and use it in covered-strategy research
13. ✅ At no point encounter a "Connect broker to continue" gate before expressing execution intent

**Then, when execution is requested:**

14. ✅ User selects "Connect Broker for Direct Execution"
15. ✅ Broker connection requirement becomes explicit, primary, and clearly explained
16. ✅ Execution workflow (Preflight → Order Prep → Preview → Confirm → Submit) remains impossible without a connected broker
17. ✅ Disconnecting the broker returns the user cleanly to the full brokerless research/planning state

---

## 26. Documentation Updates

| File | Change |
|---|---|
| `docs/operations/50-audit-d-brokerless-ux.md` | **NEW** — this document |
| `docs/operations/46-broker-independence-architecture.md` | §4d Audit D summary added |
| `docs/operations/47-audit-a-broker-gate-inventory.md` | §9c Audit D reference added |
| `docs/operations/48-audit-b-preflight-layering.md` | §Audit D reference added |
| `docs/operations/49-audit-c-broker-independent-options.md` | §Audit D reference added |
| `docs/operations/15-known-issues-and-backlog.md` | BI-012 through BI-020 added |
| `docs/operations/README.md` | Doc 50 entry |
| `docs/operations/17-sprint-change-log.md` | Audit D entry |

**Application code changed: NO**
