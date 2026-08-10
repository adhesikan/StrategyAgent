# Doc 33 — Trade Plan Workspace

Sprint 2.7.5 · Trade Plan Workspace

---

## Architecture

The Trade Plan Workspace is the system of record for a USER-SAVED RESEARCH PLAN.

It preserves:
- Research evidence (immutable snapshot at creation)
- Planning assumptions (immutable snapshot at creation)
- Selected research structure — equity scenario OR options contract candidate
- Risk analysis (immutable snapshot at creation)
- Monitoring conditions (mutable)
- User notes (mutable, private)

It compares saved research with current research (non-destructively).

It NEVER silently:
- Rewrites the original research snapshot
- Replaces a user-selected strategy
- Replaces a selected contract candidate
- Changes risk-analysis results
- Turns a research plan into an executable broker order
- Represents the saved plan as a system recommendation

**Roadmap discipline:** No execution CTA. No broker order. No probability of profit. No expected return. No suitability scoring. No "approved trade" language.

---

## Architecture Flow

```
Research (Opp Intelligence)
    ↓
Goals & Portfolio Context (optional)
    ↓
Trade Planning Foundation (Session + Constraints)
    ↓
Equity Planning OR Options Strategy Matching
    ↓
Options Contract Research (options path)
    ↓
Risk & Scenario Analysis (options path)
    ↓
Trade Plan Workspace (2.7.5) ← THIS SPRINT
    ↓
Trade Monitoring & Lifecycle (2.7.6 — future)
```

---

## TradePlan Model

```typescript
TradePlan {
  id                     // UUID
  userId                 // strict ownership
  symbol                 // trading symbol
  companyName            // nullable
  planType               // EQUITY | OPTIONS
  status                 // TradePlanStatus
  planHealth             // TradePlanHealth (research state)
  planningContextId      // reference to planning session
  researchGoalId         // optional
  portfolioId            // optional
  selectedExpressionFamily
  researchSnapshot       // JSONB — immutable at creation
  planningSnapshot       // JSONB — immutable at creation
  structureSnapshot      // JSONB — equity or options, immutable
  riskSnapshot           // JSONB — options only, immutable
  monitoringSnapshot     // JSONB — mutable
  userNotes              // TEXT — private, never logged
  reviewChecklist        // JSONB — mutable
  version                // integer, starts at 1
  createdAt / updatedAt / archivedAt / completedResearchAt / monitoringStartedAt
  freshnessAtCreation    // research freshness at save time
  limitations            // string[]
}
```

---

## Status Model

| Status             | Meaning |
|--------------------|---------|
| DRAFT              | User is still assembling/reviewing the research plan |
| RESEARCH_COMPLETE  | User has reviewed research and saved the plan |
| MONITORING         | User wants to monitor research conditions over time |
| ARCHIVED           | No longer active |
| INVALIDATED        | A canonical thesis invalidation condition was observed |

**INVALIDATED** does not mean "exit the trade" — it is a research observation only.

**Forbidden statuses (never use):** RECOMMENDED, APPROVED, READY_TO_BUY, TRADE_NOW, EXECUTABLE, AUTHORIZED, FILLED.

---

## Plan Health Model

Plan Health is a deterministic, non-prescriptive research state — NOT a trade status.

| State              | Trigger |
|--------------------|---------|
| CURRENT            | Research consistent with plan creation |
| CHANGED            | Minor evidence change (score delta < 5 pts, regime changed) |
| REQUIRES_REVIEW    | Material change: ≥5 pt score change, qualification lost, or material risk level / regime shift |
| THESIS_INVALIDATED | A new canonical invalidation condition fired |
| DATA_STALE         | Research freshness = "stale" or "unavailable" |
| UNKNOWN            | Current research unavailable |

**Rule:** THESIS_INVALIDATED is triggered only if a *new* invalidation condition appears (not one that existed at plan creation). It does not imply exit advice.

---

## Research Snapshots

Snapshots are immutable — once saved, they are never automatically updated.

### TradePlanResearchSnapshot
Captures at plan creation: researchScore, technicalScore, fundamentalScore, institutionalScore, evidenceConfidence, riskLevel, marketRegime, sector, themes, primaryEvidence, secondaryEvidence, riskFactors, invalidatesThesis, generatedAt.

### TradePlanPlanningSnapshot
Captures: planningContextId, symbol, researchHorizon, selectedExpressionFamily, constraintsFingerprint, goalContextSummary, portfolioContextSummary, limitations, generatedAt.

### TradePlanEquitySnapshot
Captures: equityScenarioId, referencePrice, referencePriceSource, entryFramework, invalidationFramework, hypotheticalSizing (labeled as scenario quantity — not order quantity), scenarioSummary, monitoringPlan, marketDataAsOf, methodologyVersion.

### TradePlanOptionsSnapshot
Captures: candidateId, strategyFamily, strategyLabel, expiration, expirationLabel, dte, legs (RESEARCH STRUCTURE LEGS — not order legs), estimatedMidpoint, liquidityQuality, greeks, eventContext, riskAnalysisSummary, methodologyVersion.

### TradePlanRiskSnapshot
Captures: analysisId, maxLoss, maxGain, breakevens, capitalProfile, netGreeks, riskFlags, eventExposure, liquidityRisk, constraintStatus, scenarioConfig, generatedAt, methodologyVersion.
Full scenario grids are NOT persisted.

---

## User Notes

- Stored in `user_notes TEXT`
- Private — never logged, never included in admin views
- Mutable (can be updated via PATCH)
- Never exported to platform telemetry

---

## Research Review Checklist

The checklist is a personal research aid. Fields:
- reviewedResearchEvidence
- reviewedRiskFactors
- reviewedThesisInvalidation
- reviewedDataFreshness
- reviewedEventExposure
- reviewedLiquidity
- reviewedPlanningConstraints

**Disclaimer (mandatory in UI):** "This checklist helps you track which research areas you have reviewed. It is not an approval, compliance certification, or determination that a trade is appropriate."

---

## Versioning

- `version` integer starts at 1
- When user explicitly updates core plan components: version += 1
- Previous version preserved in `trade_plan_versions` table
- Table: id, tradePlanId, userId, version, changeReason, researchSnapshot, planningSnapshot, structureSnapshot, riskSnapshot, createdAt

---

## Saved vs Current Research

The `GET /api/trade-plans/:id/changes` endpoint:
1. Fetches saved `researchSnapshot` from the plan
2. Fetches current opportunity from `getOpportunityIntelligence()`
3. Computes deterministic `TradePlanResearchChange` — no new formulas
4. Updates stored `planHealth` if it changed
5. Returns: savedSnapshot, change, planHealth, healthReason

Material change thresholds:
- Research score delta ≥ 5 points → MATERIAL
- Qualification lost → MATERIAL
- New invalidation condition → THESIS_INVALIDATED
- Market regime change → CHANGED (minor)
- Score delta < 5 → CHANGED (minor)

---

## Plan Creation Flow (Server-Authoritative)

Client submits only:
- `planningSessionId` (reference)
- `planType` (EQUITY or OPTIONS)
- `equityPlanningScenarioId` (equity path)
- `contractResearchCandidateId` (options path)
- `riskScenarioAnalysisId` (options path)
- Optional: `researchGoalId`, `portfolioId`, `userNotes`, `reviewChecklist`, `monitoringPlan`

Client may NOT submit: researchScore, technicalScore, fundamentalScore, institutionalScore, marketPrice, optionQuote, greeks, riskAnalysisValues.

Server reconstructs:
1. Validates session belongs to user
2. Rebuilds planning context server-side
3. Fetches current opportunity for research snapshot
4. Rebuilds equity scenario or resolves options candidate from cache
5. Reads cached risk analysis
6. Builds all snapshots
7. Persists plan

---

## API

| Method | Path | Description |
|--------|------|-------------|
| GET  | /api/trade-plans/health | Platform health metrics (admin aggregate) |
| GET  | /api/trade-plans | List/search plans |
| POST | /api/trade-plans | Create plan (server-authoritative) |
| GET  | /api/trade-plans/:id | Get plan detail |
| PATCH | /api/trade-plans/:id | Update mutable fields (notes, checklist, status) |
| POST | /api/trade-plans/:id/archive | Archive plan |
| POST | /api/trade-plans/:id/duplicate | Duplicate plan (fresh notes, reset checklist) |
| GET  | /api/trade-plans/:id/changes | Saved vs Current research comparison |
| GET  | /api/trade-plans/:id/versions | Version history |
| POST | /api/trade-plans/:id/version | Create new version |
| GET  | /api/trade-plans/:id/monitoring-context | 2.7.6 handoff |

**Route regression rule:** `/api/trade-plans/health` (static) MUST be registered BEFORE `/api/trade-plans/:id` (dynamic).

---

## Database Schema

### trade_plans
```sql
id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()
user_id                 TEXT NOT NULL
symbol                  VARCHAR(20) NOT NULL
company_name            TEXT
plan_type               TEXT NOT NULL          -- EQUITY | OPTIONS
status                  TEXT NOT NULL DEFAULT 'DRAFT'
plan_health             TEXT NOT NULL DEFAULT 'UNKNOWN'
planning_context_id     TEXT NOT NULL
research_goal_id        TEXT
portfolio_id            TEXT
selected_expression_family TEXT NOT NULL
research_snapshot       JSONB NOT NULL
planning_snapshot       JSONB NOT NULL
structure_snapshot      JSONB
risk_snapshot           JSONB
monitoring_snapshot     JSONB NOT NULL DEFAULT '{}'
user_notes              TEXT
review_checklist        JSONB NOT NULL DEFAULT '{}'
version                 INTEGER NOT NULL DEFAULT 1
freshness_at_creation   TEXT NOT NULL DEFAULT 'unknown'
limitations             JSONB NOT NULL DEFAULT '[]'
created_at              TIMESTAMPTZ DEFAULT NOW()
updated_at              TIMESTAMPTZ DEFAULT NOW()
archived_at             TIMESTAMPTZ
completed_research_at   TIMESTAMPTZ
monitoring_started_at   TIMESTAMPTZ
```

Indexes: user_id, (user_id, status), (user_id, symbol), created_at.

### trade_plan_versions
```sql
id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()
trade_plan_id           VARCHAR NOT NULL
user_id                 TEXT NOT NULL
version                 INTEGER NOT NULL
change_reason           TEXT
research_snapshot       JSONB NOT NULL
planning_snapshot       JSONB NOT NULL
structure_snapshot      JSONB
risk_snapshot           JSONB
created_at              TIMESTAMPTZ DEFAULT NOW()
```

Indexes: trade_plan_id, user_id.

---

## Migration

Tables are created via `shared/schema.ts` Drizzle definitions, which are applied at startup through the standard `db push` / `migrate` workflow.

For production: run `npx drizzle-kit push` or equivalent migration from the deploy pipeline.

**Migration safety:** Additive only. No DROP. No TRUNCATE. Idempotent.

**Required production migration** (Task #112 pattern): Ensure `trade_plans` and `trade_plan_versions` tables are created in production before the first plan is saved.

---

## Security & Privacy

- All routes: `isAuthenticated` required
- Strict user ownership: every query includes `userId` predicate
- Cross-user plan ID → 404 (no 403 — avoids existence leakage)
- `user_notes` never logged, never included in admin metrics
- Admin metrics contain only aggregates: counts, latency, no symbols, no capital, no user IDs
- Referenced resources (session, goal, portfolio, risk analysis, candidate) must belong to the requesting user

---

## Caching

- Trade plans are DB-persisted — no aggressive caching
- Current research comparison may use existing Opportunity Intelligence caches
- Plan health is recomputed on each `/changes` request and updated in DB if changed
- No plan-level in-memory cache (risk of stale ownership data)

---

## Performance

- Plan creation: < 500ms (excludes equity scenario rebuild)
- Plan detail: < 200ms warm (direct DB lookup)
- List (50 plans): < 300ms
- Equity scenario rebuild on creation: network-free (stored bars only)

---

## 2.7.6 Handoff

`GET /api/trade-plans/:id/monitoring-context` returns `TradePlanMonitoringInput`:
```typescript
{
  tradePlanId
  symbol
  researchSnapshot           // immutable creation snapshot
  invalidationConditions     // from researchSnapshot
  monitoringPlan             // from monitoringSnapshot
  structureSummary           // human summary of plan structure
  riskFlags                  // from riskSnapshot
  freshnessRequirements      // ["research_data", "market_data"]
}
```

2.7.6 will wire `researchWatchId` back into the monitoring snapshot.

---

## Research Workspace Integration

The plan detail page links to:
- Opportunity Workspace: `/opportunities/:symbol`
- Research Workspace: `/research-workspace?symbol=:symbol`
- Research Monitor, Research Reports, Goals, Portfolio Intelligence

AI context actions (Research Workspace):
- Explain This Plan
- Challenge the Thesis
- Explain What Changed
- Explain Risk Analysis

AI may explain. AI may NOT change plan data, select another contract, recommend execution, or generate broker orders.

---

## Opportunity Workspace Integration

For a symbol with active trade plans, `GET /api/opportunities/workspace/:symbol` (2.7.6 enhancement) will show plan summary links. In 2.7.5, the `/trade-plans` page shows plans per symbol via filtering.

---

## Platform Health Metrics (admin aggregate, no PII)

| Metric | Description |
|--------|-------------|
| tradePlansCreated | Session-lifetime plan creation count |
| activeTradePlans | DRAFT + RESEARCH_COMPLETE plans in DB |
| monitoringTradePlans | MONITORING plans in DB |
| archivedTradePlans | ARCHIVED plans in DB |
| plansRequiringReview | Plans with REQUIRES_REVIEW health |
| invalidatedPlans | Plans with THESIS_INVALIDATED health |
| planCreationFailures | Session-lifetime creation failures |
| averagePlanCreationLatencyMs | Session average |
| lastTradePlanCreatedAt | Timestamp of most recent plan |

No symbols, capital, P/L, strategy details by user, notes, or user IDs in health metrics.

---

## Compliance

**Canonical disclaimer (required on all plan-facing pages):**

> A Trade Plan is a user-saved research record that combines research evidence, planning assumptions, hypothetical structures, risk analysis, and monitoring conditions. It does not constitute investment advice, a personalized recommendation, suitability determination, or instruction to transact.

**Forbidden language:**
- "Approved Trade" / "Approved by system"
- "Recommended Trade"
- "Trade Ready" / "Execution Ready"
- "Buy Plan" / "Sell Plan"
- "Best Trade" / "High Conviction Trade"
- "Expected Return" / "Probability of Profit"
- "Guaranteed"

**User-initiated:** The plan explicitly reflects what the *user* selected — VCP Trader AI assembled supporting research. The system does not authorize or approve trades.

---

## Structured Logging

Safe events: `trade_plan_created`, `trade_plan_updated`, `trade_plan_archived`, `trade_plan_duplicated`, `trade_plan_version_created`, `trade_plan_health_changed`.

Safe metadata: `planType`, `status`, `version`, `hasGoalContext`, `hasPortfolioContext`, `hasRiskAnalysis`, `durationMs`.

Never log: user notes, symbol (if policy avoids), capital, P/L, portfolio values, option legs, private context.

---

## Client Routes

| Path | Component | Rule |
|------|-----------|------|
| /trade-plans | TradePlansPage | Static — registered BEFORE /:id |
| /trade-plans/:id | TradePlanDetailPage | Dynamic |

**Wouter routing rule:** `/trade-plans` must be registered before `/trade-plans/:id` to prevent `id="trade-plans"` misrouting.

---

## Troubleshooting

**Plan not found (404):** Verify planningSessionId belongs to the requesting user. Cross-user access returns 404.

**Research snapshot empty (all zeros):** Opportunity Intelligence may not have a cached scan for this symbol. Plan is still saved with zero-score snapshot — comparison will show UNKNOWN health until a scan completes.

**Equity snapshot null:** Equity scenario rebuild failed (market data unavailable). Plan is saved without equity structure snapshot. User can attempt a new version when data is available.

**Options snapshot null:** Contract research not cached for this session. The session-scoped cache expires after 30 minutes. If the user waits too long before saving, the snapshot will be null.

**Plan health shows UNKNOWN:** Current Opportunity Intelligence scan is unavailable. Retry via the Refresh button on the plan detail page.

**Migration needed in production:** If `trade_plans` table does not exist, the POST /api/trade-plans endpoint will return 500. Run `npx drizzle-kit push` or the equivalent migration command in the production environment.

---

## Future Directions

- **2.7.6:** Trade Monitoring & Lifecycle Intelligence (plan-linked research watches, lifecycle events)
- **Broker-Assisted Execution:** Order preparation handoff (separate future phase)
- **Professional/RIA Edition:** Multi-user review workflows, approval states, firm templates, audit history
- **Institutional Edition:** Team research plans, custom policy, shared research
- **Trade Plan Research Report:** Structured export (Report system integration)
- **Plan Comparisons:** Side-by-side plan comparison (Professional tier)

---

## Commercialization

| Tier | Capability |
|------|-----------|
| Free | Limited saved plans; basic research-plan summary |
| Retail | Multiple saved plans; full equity/options plan; risk snapshots; research-change comparison; monitoring handoff; user notes |
| Professional | More plan history; version comparison; advanced monitoring; plan comparisons |
| RIA | Advisor-authored research plans; firm templates; review workflow; audit history |
| Institutional | Team research plans; approval workflows; custom policy; shared research |
| Enterprise | Custom plan schemas; private methodology; API; white-label |

No entitlement enforcement in this sprint.

---

*Sprint 2.7.5 — Trade Plan Workspace*
