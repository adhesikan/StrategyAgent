# Operations Handbook — Sprint 2.7.3: Options Contract Research Engine

## Overview

The Options Contract Research Engine (`server/services/contract-research-service.ts`) surfaces live option contract candidates for a trader-selected strategy family. It is the third stage in the Trade Planning pipeline:

```
2.7.0 Trade Planning Foundation
2.7.1 Equity Planning Engine
2.7.2 Options Strategy Matching
2.7.3 Options Contract Research  ← this sprint
2.7.4 Risk Scenario Engine       ← next
```

No contract is recommended. No order is submitted. No broker account is touched beyond read-only chain retrieval. Results are research inputs for the trader's own decision-making process.

---

## Architecture

### Pipeline (per request)

1. Validate selected strategy family (never auto-substitute)
2. Check broker connection (`getBrokerConnection`)
3. Check options-chain capability (`getBrokerCapabilities`)
4. Load expirations — **1 broker call** (`getOptionExpirations`)
5. Filter expirations by DTE + event rules
6. Load normalized chains per candidate expiration — **1 broker call per expiration, no N+1**
7. Apply liquidity filter (OI / volume / spread%)
8. Apply delta/moneyness rules
9. Construct multi-leg strategy structures
10. Validate structure consistency (ordering, same expiration, strike ordering)
11. Compute structure metrics (debit/credit, width, Greeks, midpoint)
12. Sort by `ContractQualityCategory` (EXCELLENT → STRONG → ACCEPTABLE → LIMITED)
13. Cap at 5 candidates per request
14. Return with full rejection transparency

### Injectable Dependencies (for testing)

```typescript
interface ContractResearchDeps {
  getBrokerConnection:   (userId) => Promise<{ provider; isConnected } | null>
  getBrokerCapabilities: (userId) => Promise<{ optionsChain? } | null>
  getOptionExpirations:  (userId, symbol) => Promise<string[]>
  getOptionChain:        (userId, symbol, expiration) => Promise<OptionChainContract[]>
}
```

### Chain Cache

A 2-minute in-memory cache prevents duplicate chain fetches within a single research session. Keys are `cr:userId:symbol:expiration` — never shared across users. Cache eviction is TTL-based.

---

## API Endpoints

All three are **static** routes registered **before** dynamic `/:symbol` routes.

### `POST /api/trade-planning/session/:id/options/contracts`

Build live contract research for a planning session.

**Client sends:** `strategyFamily` (required), `filtersOverride` (optional)

**Server derives (never trusted from client):**
- `thesisDirection` — from `buildOptionsStrategyMatchResult(context, constraints)`
- `volatilityContext` — from options strategy matching
- `eventContext` — from options strategy matching
- `ownsSymbol` — from `context.portfolioContext.ownsSymbol`
- `underlyingPrice` — from `getReferenceSnapshot(symbol)` stored bars

**Response:**
```json
{
  "result": { /* OptionsContractResearchResult */ },
  "contractResearchVersion": "contract-research-v1"
}
```

### `GET /api/trade-planning/session/:id/options/contracts`

Returns eligible strategy families for live contract research (APPLICABLE + POTENTIALLY_APPLICABLE, excluding monitor_only / calendar / diagonal).

### `GET /api/trade-planning/session/:id/options/contracts/:candidateId`

Individual candidate detail — returns 404 with guidance for Sprint 2.7.4+ (persistence required).

---

## Supported Strategy Families

| Family | Legs | Notes |
|--------|------|-------|
| `long_call` | 1 | Bullish directional; delta 0.40–0.70 |
| `long_put` | 1 | Bearish directional; delta 0.35–0.65 |
| `bull_call_spread` | 2 | Long lower-strike call / short higher-strike call |
| `bear_put_spread` | 2 | Long higher-strike put / short lower-strike put |
| `bull_put_spread` | 2 | Short higher-strike put / long lower-strike put |
| `bear_call_spread` | 2 | Short lower-strike call / long higher-strike call |
| `covered_call` | 1 (short call) | Requires confirmed 100+ shares |
| `cash_secured_put` | 1 (short put) | Includes estimated capital note |
| `protective_put` | 1 (long put) | Requires confirmed ownership |
| `collar` | 2 | Requires confirmed ownership |
| `iron_condor` | 4 | Wing ordering validated: LP < SP < SC < LC |
| `iron_butterfly` | 4 | ATM short strikes must match |
| `long_straddle` | 2 | Same ATM strike for call and put |
| `long_strangle` | 2 | OTM call + OTM put |
| `calendar_spread` | — | UNSUPPORTED — multi-expiry required |
| `diagonal_spread` | — | UNSUPPORTED — multi-expiry required |
| `monitor_only` | — | UNSUPPORTED — no contract research |

---

## Liquidity Classification

| Tier | OI | Volume | Spread % | Quality Category |
|------|----|--------|----------|-----------------|
| STRONG | ≥500 | ≥50 | <5% | EXCELLENT (if Greeks available + fresh) |
| ACCEPTABLE | ≥100 | any | <15% | STRONG |
| LIMITED | ≥10 | any | <30% | ACCEPTABLE |
| POOR | below all | | | Excluded from candidates |

Structure overall liquidity = worst-leg classification.

---

## DTE Defaults by Family

| Family | DTE Range | Rationale |
|--------|-----------|-----------|
| `long_call` / `long_put` | 30–90 | Medium-term: enough time value, manageable theta |
| `bull_call_spread` / `bear_put_spread` | 30–60 | Defined-risk medium DTE |
| Income spreads (bull_put / bear_call / covered_call / CSP) | 20–45 | Monthly cycle, theta acceleration |
| `iron_condor` / `iron_butterfly` | 20–60 | Neutral theta collection |
| `long_straddle` / `long_strangle` | 20–45 | Volatility play window |
| `protective_put` / `collar` | 30–90 | Longer protection window |

User-supplied `filtersOverride.dteMin` / `dteMax` override family defaults.

---

## Compliance Rules (permanent)

1. **No recommendation language** — "best contract", "recommended strike", "top trade" are forbidden in all output fields, reasons, and warnings.
2. **No probability of profit (POP)** — `probability-engine.ts` and `estimatePop()` are permanently off-limits in this module.
3. **No order submission** — no order ticket, broker submit, or execution instruction fields in any response.
4. **No auto-substitution** — selected strategy family is never replaced by a different family, even if pricing appears better.
5. **Null for missing Greeks** — delta, gamma, theta, vega, rho missing from provider = null in result, never 0.
6. **Midpoint ≠ fill price** — `MIDPOINT_DISCLAIMER` appears on every result.
7. **Covered call safety** — never construct a naked call; requires confirmed portfolio ownership.
8. **Cross-user isolation** — chain cache keys include userId; no cross-user leakage.

---

## In-Memory Health Metrics

Exposed via `getContractResearchHealth()` and integrated into `GET /api/admin/platform-health` under `tradePlanning.details`:

| Metric | Description |
|--------|-------------|
| `contractResearchRequests` | Total requests to `buildContractResearchResult` |
| `successfulContractResearch` | Results with COMPLETE status |
| `partialContractResearch` | Results with PARTIAL status |
| `failedContractResearch` | Failed / no-candidates / requires-broker |
| `noValidCandidates` | Specifically NO_VALID status |
| `requiresBrokerCount` | Broker not connected hits |
| `staleChainCount` | Chains older than 15 minutes |
| `emptyChainCount` | Chains returning zero contracts |
| `averageContractResearchLatencyMs` | Rolling 100-sample average |
| `lastSuccessfulContractResearchAt` | ISO timestamp |
| `optionChainProviderStatus` | HEALTHY / DEGRADED / UNKNOWN |

---

## Sprint 2.7.4 Handoff (`TradeRiskScenarioInput`)

Each candidate includes a `riskScenarioInput` field (type: `TradeRiskScenarioInput`) that is the handoff contract for Sprint 2.7.4 Risk Scenario Engine. It contains:

- `planningContextId`
- `contractResearchCandidateId`
- `strategyFamily`
- `legs[]` (full leg data)
- `currentStructureMetrics`
- `researchThesisSummary`
- `invalidationNote`
- `planningConstraintsFingerprint`

The risk scenario engine will accept this as input to compute scenario payoff diagrams, max loss, max gain, and breakeven analysis. No POP or win probability is computed.

---

## Glossary Integration

16 new terms added to `CONTRACT_RESEARCH_ENTRIES` in `shared/research-glossary.ts`:

`contract_research_candidate`, `expiration_research`, `strike_research`, `moneyness`, `open_interest`, `bid_ask_spread`, `implied_volatility`, `delta`, `gamma`, `theta`, `vega`, `net_debit`, `net_credit`, `estimated_midpoint`, `liquidity_quality`, `event_window`

All terms use correct `ResearchGlossaryEntry` fields: `key`, `label`, `shortDefinition`, `fullDefinition`, `category`, `userFacing`.

---

## Known Limitations

- Calendar spread and diagonal spread require two different expirations — not supported in 2.7.3; multi-expiry research is planned.
- Individual candidate persistence (`GET /contracts/:candidateId`) requires Sprint 2.7.4 infrastructure.
- Covered call: covered status determined by portfolio context `ownsSymbol` — does not verify exact share count.
- Chain cache TTL is 2 minutes (in-memory only); resets on server restart.
- Stale chain threshold is 15 minutes; warning added to result but research proceeds.
