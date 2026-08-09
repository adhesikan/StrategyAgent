# 23 — Platform Operations Center

**Sprint:** 2.5.3B — Platform Health & Operations Center Enhancement

**Purpose:** Transform the admin-only Platform Health page into a true Operations Center. An operator can answer within seconds: Is the platform ready? Which subsystem needs attention? What diagnostic or runbook should I use?

---

## Overview

The Platform Operations Center is the authoritative operational view for VCP Trader AI administrators.

It is:
- **Admin-only** — never exposed to normal users
- **Read-only** — no business logic changes, no scanner/ranking execution, no AI calls
- **Security-hardened** — never exposes API keys, tokens, secrets, credentials, or user financial data
- **Failure-isolated** — one subsystem failure never causes the entire endpoint to return 500

---

## Architecture

### Server

**Endpoint:** `GET /api/admin/platform-health` (admin + authenticated)

**Response shape:**
```json
{
  "health": { ... },          // individual subsystem health cards
  "operationsSummary": { ... }, // 7-dimension readiness overview
  "researchPipeline": [ ... ], // 10-stage pipeline flow
  "dataFreshness": [ ... ],    // 14-dataset freshness assessments
  "endpointLatencyMs": 120,
  "cachedAt": "ISO",
  "cached": false
}
```

**Cache:** 30-second in-memory TTL. Invalidated by `POST /api/admin/platform-health/refresh`.

**Pure computation:** `server/lib/health-freshness.ts` and `server/routes/platform-health-internals.ts` are pure — no DB, no network, no AI.

### Client

**Page:** `client/src/pages/admin-platform-health.tsx`

**Route:** `/admin/platform-health`

**Layout (per spec §32):**
1. Operations Summary banner
2. Research Pipeline (horizontal flow, vertical on mobile)
3. Data Freshness table
4. Infrastructure (Application, Database)
5. Market Data & MCP
6. Scanner & Intelligence
7. Research Services
8. Portfolio Services
9. Broker Services
10. Institutional Services
11. Admin Operations
12. Background Jobs

---

## Health vs Readiness Distinction (spec §22)

**Health** = "Can the subsystem operate?"
**Readiness** = "Is today's data/results ready?"

Example:
- Scanner **health** = HEALTHY (it can run)
- Research **readiness** = WAITING (today's scan hasn't produced a ranking yet)

The Operations Summary uses readiness. Individual subsystem cards use health.

---

## Operations Summary — 7 Dimensions

| Dimension | Source Cards | READY when… |
|-----------|-------------|-------------|
| Platform Status | application, database | Both HEALTHY |
| Research Readiness | ranking, opportunityIntelligence, intelligence | All three HEALTHY |
| Market Data Readiness | marketData | HEALTHY |
| AI Readiness | researchWorkspace | HEALTHY |
| Reports Readiness | researchReports | HEALTHY |
| Portfolio Services Readiness | portfolioHistory | HEALTHY |
| Broker Services Readiness | brokerSync | HEALTHY (DISABLED when no portfolios) |

**Important:** DISABLED never triggers `requiresAttention`. Broker sync DISABLED is correct when no portfolios are linked.

### Operational Status Vocabulary

| Status | Meaning |
|--------|---------|
| READY | Subsystem is operational and data is current |
| DEGRADED | Subsystem operational but data is stale or partial |
| WAITING | Subsystem healthy but waiting for first run/data |
| FAILED | Subsystem is down or in a failure state |
| UNKNOWN | Status cannot be determined |
| DISABLED | Intentionally not configured |

---

## Research Pipeline — 10 Stages

```
Market Data → Universe Ready → Scanner → Opportunity Ranking → Opportunity Intelligence
             → Sector/Theme Intelligence → Research Collections → Research Monitoring
             → Market Research Command Center → Research Reports
```

Each stage shows: status, last updated, primary metric, optional warning, runbook link, diagnostics link.

**Stage Status Vocabulary:** HEALTHY | RUNNING | WAITING | DEGRADED | FAILED | UNKNOWN | DISABLED

**Key behavioral rules:**
- Scanner never-run → WAITING (not UNKNOWN)
- Command Center no snapshot → WAITING (not UNKNOWN)
- Research Reports no reports → WAITING (not UNKNOWN)
- Market Data DISABLED → Universe Ready also reflects no-data state

---

## Data Freshness Dashboard — 14 Datasets

| Dataset | Freshness Rule | Expected Cadence |
|---------|---------------|-----------------|
| Market Prices | FRESH <6h, RECENT <30h, DELAYED <72h | Daily close |
| Historical Bars | FRESH <6h, RECENT <30h, DELAYED <72h | Daily ingestion |
| Market Symbol Metadata | FRESH <24h, RECENT <72h | Ad-hoc enrichment |
| Opportunity Ranking | FRESH <8h, RECENT <24h, DELAYED <72h | ~4h scan cycle |
| Opportunity Intelligence | FRESH <8h, RECENT <24h | ~4h scan cycle |
| Sector Intelligence | FRESH <24h, RECENT <72h | After each scan |
| Theme Intelligence | FRESH <24h, RECENT <72h | After each scan |
| Institutional Signals (13F) | Delayed by design (quarterly) | Quarterly / 45-day SEC delay |
| Research Collections | FRESH <24h, RECENT <72h | On demand |
| Research Monitor | FRESH <24h, RECENT <72h | Daily evaluation |
| Command Center Snapshot | FRESH <12h, RECENT <24h | On first page visit |
| Research Reports | FRESH <24h, RECENT <72h | On demand |
| Portfolio History | FRESH <24h, RECENT <72h | Manual/scheduled snapshot |
| Broker Sync | FRESH <4h, RECENT <24h | Manual/scheduled sync |

### Freshness Status Vocabulary

| Status | Meaning |
|--------|---------|
| FRESH | Within normal operating cadence |
| RECENT | Slightly older but acceptable |
| DELAYED | Overdue or delayed by design |
| STALE | Significantly overdue |
| UNKNOWN | No timestamp available |
| NOT_APPLICABLE | Disabled or not applicable |

### Freshness Rules

**Key rules:**
- `delayedByDesign: true` → always DELAYED regardless of age (e.g., 13F quarterly data)
- `notApplicable: true` → always NOT_APPLICABLE (e.g., broker sync when not configured)
- No universal threshold — each dataset has its own cadence-based thresholds
- Market data: relative to latest trading day, not wall-clock time

---

## Subsystem Cards

Every health card provides:
- Status badge (HEALTHY/DEGRADED/UNAVAILABLE/DISABLED/UNKNOWN)
- Summary text
- Last success timestamp
- Action message when action is needed
- Diagnostics link (where available)
- Runbook link (shown when DEGRADED or UNAVAILABLE)
- Expandable raw details (JSON)

### Diagnostics Links

| Card | Endpoint |
|------|---------|
| Market Data | `/api/admin/market-data/status` |
| MCP | `/api/internal/mcp/status` |
| Opportunity Intelligence | `/api/admin/intelligence/diagnostics` |
| Sector/Theme Intelligence | `/api/admin/intelligence/diagnostics` |
| Security Master | `/api/admin/institutional/mapping-diagnostics` |
| Research Monitoring | `/api/research-monitor/health` |
| Command Center | `/api/command-center/health` |
| Research Reports | `/api/research-reports/health` |

---

## Admin Operations

Three operations are available:

### Enrich Symbol Classifications
- **Action:** `POST /api/admin/symbols/enrich`
- **Purpose:** Fetch sector + industry from Twelve Data /profile for symbols missing classification
- **Cost:** 1 credit per symbol
- **Confirmation:** Required before execution

### Rebuild Intelligence Snapshots
- **Action:** `POST /api/admin/intelligence/rebuild`
- **Purpose:** Recompute sector + theme intelligence snapshots from current in-memory ranking
- **Does NOT:** Re-run the scanner; safe to call repeatedly

### Raw Diagnostics
- **Link:** `/api/admin/intelligence/diagnostics`
- **Purpose:** Raw JSON for engineering investigation

---

## Performance Requirements

- Single aggregated endpoint
- Parallel subsystem checks via `Promise.all` / `Promise.allSettled`
- 30-second cache (short enough for real-time ops, long enough to protect downstream services)
- **No scanner execution**
- **No ranking execution**
- **No AI invocation**
- **No live market-data-provider calls**
- Measured endpoint latency reported in response (`endpointLatencyMs`)

---

## Failure Isolation (spec §30)

Each check function catches its own errors independently:
- Individual check fails → that card returns UNKNOWN/status with safeError
- All other cards still render
- The endpoint never returns 500 due to a single subsystem failure

Implementation: `Promise.allSettled` / independent `try/catch` in each `check*()` function.

---

## Security / DevSecOps (spec §31)

**Never display:**
- API keys, tokens, JWT secrets
- Session secrets, broker tokens
- Account numbers, portfolio holdings or values
- Email addresses, PII
- DATABASE_URL, authorization headers
- Raw prompts containing user data

**Enforced by:**
- `checkBrokers()` only shows boolean `configured` flags, never credentials
- `checkBrokerSync()` uses aggregated counts, never account IDs
- All `check*()` functions use safe slicing for error messages (`.slice(0, 200)`)
- Structured-log redaction remains active

---

## Runbook Integration

For DEGRADED / FAILED / WAITING states, each card shows relevant runbook links into `/admin/operations-manual`.

| State | Action |
|-------|--------|
| DEGRADED | Show runbook link for that subsystem |
| UNAVAILABLE | Show runbook link + diagnostic endpoint |
| UNKNOWN | Show runbook link |
| HEALTHY / DISABLED | No runbook link (not needed) |

---

## Mobile / Responsive Behavior

- Cards stack in single column on mobile
- Pipeline renders horizontal scroll on desktop, vertical stack on mobile (CSS: `hidden sm:block` / `sm:hidden`)
- Data Freshness table scrolls horizontally on small screens
- No clipped actions — all buttons remain tappable

---

## Commercial Readiness

| Tier | Benefit |
|------|---------|
| Retail | Reliable production research platform — ops center confirms daily readiness |
| Professional | Operational reliability monitoring for heavier usage patterns |
| RIA (future) | Firm-level operational monitoring per workspace |
| Institutional (future) | SLA/readiness visibility, uptime reporting |
| Enterprise (future) | Organization-specific health views, governance dashboards |

Platform Operations Center is designed to support all tiers without redesign. Cards and dimensions can be extended per-organization in future editions.

---

## Platform Reusability

The Operations Center architecture supports future additions:

| Future Module | Required Health Card | Already Designed |
|--------------|---------------------|-----------------|
| Portfolio Intelligence | `portfolioIntelligence` | ✅ Sprint 2.6.1 |
| Trade Construction Engine | `tradeConstruction` | Card slot available |
| Execution | `orderExecution` | Card slot available |
| AI Agents | `agentRuntime` | Card slot available |
| RIA Edition | `riaWorkspace` | Card slot available |

---

## UAT Checklist

| # | Step | Expected |
|---|------|---------|
| 1 | Open `/admin/platform-health` | Page loads — title shows "Platform Operations Center" |
| 2 | Verify Operations Summary | 7 dimension tiles visible; headline present |
| 3 | Verify Research Pipeline | 10 stages visible with status indicators |
| 4 | Verify Data Freshness table | 14 rows; each has dataset/age/status |
| 5 | Verify Market Data card | Shows symbol count and sector coverage % |
| 6 | Verify Scanner card | Shows "Not run yet" when no scan, or candidate counts |
| 7 | Verify Ranking card | Shows symbol count and regime, or "No ranking in memory" |
| 8 | Verify Opportunity Intelligence card | Shows opportunity counts or "No snapshot" |
| 9 | Verify Sector/Theme card | Shows snapshot row counts |
| 10 | Verify Research Workspace card | Shows conversation count and AI status |
| 11 | Verify Collections card | Shows system/user collection counts |
| 12 | Verify Research Monitoring card | Shows watch count |
| 13 | Verify Command Center card | Shows sections available or "No snapshot" |
| 14 | Verify Reports card | Shows report counts or "No reports yet" |
| 15 | Verify Portfolio History card | Shows portfolio/snapshot counts |
| 16 | Verify Broker Sync DISABLED when no portfolios connected | Shows DISABLED badge |
| 17 | Verify MCP card | Shows DISABLED (dev) or reachable (prod) |
| 18 | Verify Background Jobs table | Shows all registered jobs |
| 19 | Verify degraded state shows runbook link | Runbook link appears for DEGRADED cards |
| 20 | Simulate subsystem failure (kill one check) | Other cards still render; page does not 500 |
| 21 | Verify no secrets in response | Inspect JSON — no token/key/secret values |
| 22 | Verify no user portfolio data | No symbols, values, or user identities |
| 23 | Refresh button clears cache | Fresh data loaded; `cached: false` in response |
| 24 | Check `endpointLatencyMs` | Reasonable value (<5000ms typically) |
| 25 | Verify admin authorization | Non-admin user receives 403 |

---

## Troubleshooting

### Operations Summary shows WAITING for Research Readiness

Cause: Ranking not yet computed or lost after restart.
Action: Wait for next scan cycle, or trigger scan manually. Check background jobs table for scanner status.

### Data Freshness shows STALE for Market Prices

Cause: Twelve Data ingestion has not run recently.
Action: Check `TWELVE_DATA_ENABLED` and `TWELVE_DATA_API_KEY`. Check ingestion job in Background Jobs table. POST `/api/admin/market-data/force-ingest` if needed.

### Platform Operations Center returns 500

Cause: Rare — indicates a fatal error in `buildPlatformHealth()` itself.
Action: Check server logs for `[platform-health] failed:`. This is the outer catch; individual card failures should never propagate here.

### Command Center Snapshot missing

Cause: `/market-research-command-center` page not yet visited since last restart.
Action: Visit the Market Research Command Center page to generate the snapshot. Do NOT trigger it automatically from admin.

---

## No Business Logic Change Confirmation

Sprint 2.5.3B made **zero changes** to:
- Scanner scoring or execution logic
- Opportunity Ranking formulas
- Opportunity Intelligence scoring
- Portfolio History calculations
- Research Monitoring logic
- Research Reports logic
- Market Intelligence formulas
- Any product-facing scoring or analysis

All changes are limited to:
- Reading existing health cards and metrics
- Computing derived summaries (pure, no DB calls)
- Updating the admin UI layout
- Adding the freshness helper (`server/lib/health-freshness.ts`)
- Adding pure compute functions (`server/routes/platform-health-internals.ts`)
