# 21 — Portfolio History & Change Intelligence

Sprint: 2.6.0 — Portfolio History & Change Intelligence

Phase: 3 — Portfolio Intelligence (foundation)

---

## Overview

Sprint 2.6.0 establishes deterministic portfolio history and change classification.

**User question answered:** "What changed in my portfolio?"

**NOT answered by this sprint:** "What should I buy or sell?"

### What this sprint does

- Captures point-in-time portfolio snapshots after meaningful state changes
- Classifies position changes: NEW, EXITED, INCREASED, REDUCED, UNCHANGED
- Classifies research evidence changes using existing Opportunity Intelligence
- Computes sector and theme exposure shifts
- Provides timeline API and change comparison API
- Integrates into Platform Health

### What this sprint does NOT do (explicitly excluded)

| Excluded | Planned sprint |
|----------|----------------|
| Portfolio Intelligence scoring | 2.6.1 |
| Rebalancing | 2.6.3+ |
| Goal planning | 2.6.4 |
| Trade recommendations | Post-2.6.x |
| Automated execution | Post-2.6.x |
| Portfolio AI conversations | Post-2.6.x |
| Portfolio report types | Post-2.6.x |
| New broker integrations | Separate track |
| Scheduled snapshots | 2.6.x+ |

---

## Architecture

```
Opportunity Intelligence (existing canonical research)
        ↓
Portfolio History (Sprint 2.6.0)
  capturePortfolioSnapshot()   ← triggered by portfolio state changes
  getPortfolioChanges()        ← deterministic classification
  getPortfolioSnapshots()      ← timeline retrieval
        ↓
Portfolio Change Intelligence (Sprint 2.6.0)
  Position changes classified
  Research evidence changes classified
  Sector / theme exposure changes classified
        ↓
Future: Portfolio Intelligence (Sprint 2.6.1)
Future: Portfolio Analytics (Sprint 2.6.2)
Future: Portfolio Research Workspace (Sprint 2.6.3)
Future: Trade Planning (Post-2.6.x)
```

### Research-First Architecture Contract

Research scores (`researchScore`, `technicalScore`, `institutionalScore`, `fundamentalScore`, `riskScore`) are **owned by Opportunity Intelligence** and only READ here — never redefined.

---

## DB Schema (2 new tables)

### portfolio_snapshots

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR(128) PK | `snap-{timestamp}-{random}` |
| `portfolio_id` | VARCHAR(128) NOT NULL | References portfolios.id |
| `user_id` | VARCHAR(128) NOT NULL | Redundant but enables fast ownership checks |
| `snapshot_date` | DATE NOT NULL | YYYY-MM-DD (for period grouping) |
| `captured_at` | TIMESTAMP NOT NULL | Precise capture time |
| `source_type` | TEXT NOT NULL | SnapshotSourceType enum |
| `total_market_value` | NUMERIC(20,4) | Nullable — null when reference prices unavailable |
| `total_cost_basis` | NUMERIC(20,4) | Nullable |
| `position_count` | INTEGER NOT NULL | Count of positions in snapshot |
| `cash_value` | NUMERIC(20,4) | Nullable (future) |
| `fingerprint` | TEXT NOT NULL | SHA256 of sorted symbol:qty pairs (dedup key) |
| `coverage` | JSONB NOT NULL | SnapshotCoverage metrics |
| `metadata` | JSONB NOT NULL | Trigger metadata, warnings |
| `created_at` | TIMESTAMP NOT NULL | |

**Indexes:**
- `idx_ps_portfolio_id` — all snapshots for a portfolio
- `idx_ps_user_id` — user isolation
- `idx_ps_portfolio_date` — date-range timeline queries
- `idx_ps_captured_at` — most-recent snapshot lookup

### portfolio_position_snapshots

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR(128) PK | `psnap-{timestamp}-{random}` |
| `snapshot_id` | VARCHAR(128) NOT NULL | References portfolio_snapshots.id |
| `portfolio_id` | VARCHAR(128) NOT NULL | Denormalized for direct lookup |
| `symbol` | TEXT NOT NULL | Uppercase ticker |
| `quantity` | NUMERIC(18,8) NOT NULL | |
| `average_cost` | NUMERIC(18,8) | Nullable |
| `cost_basis` | NUMERIC(18,8) | Nullable |
| `reference_price` | NUMERIC(18,8) | Nullable — stored null when unavailable |
| `market_value` | NUMERIC(18,8) | Nullable — reference_price × quantity |
| `sector` | TEXT | Nullable — from Opportunity Intelligence |
| `industry` | TEXT | Nullable |
| `themes` | TEXT[] | Theme IDs from theme registry |
| `research_score` | INTEGER | Nullable — 0-100, NULL ≠ 0 |
| `technical_score` | INTEGER | Nullable |
| `fundamental_score` | INTEGER | Nullable |
| `institutional_score` | INTEGER | Nullable |
| `risk_score` | INTEGER | Nullable |
| `evidence_confidence` | TEXT | Nullable — "high"/"medium"/"low"/"insufficient" |
| `opportunity_type` | TEXT | Nullable — "growth"/"income"/"watch" |
| `captured_at` | TIMESTAMP NOT NULL | |

**Indexes:**
- `idx_pps_snapshot_id` — all positions for a snapshot
- `idx_pps_portfolio_id` — all positions for a portfolio
- `idx_pps_symbol` — symbol lookup within portfolio

**Important:** `research_score = NULL` means "Opportunity Intelligence data unavailable for this symbol." It is never coerced to 0.

---

## Startup Migration

`ensurePortfolioHistoryTables()` runs on every server startup (registered in `server/routes.ts`).

Uses `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` — safe to run multiple times. No `DROP`, no `TRUNCATE`, no modifications to existing `portfolios` or `portfolio_positions` tables.

**Production impact:** Additive only. Existing portfolio data is unaffected.

---

## Snapshot Triggers (automatic)

Snapshots are captured automatically via fire-and-forget `triggerSnapshotAsync()` — failures never block the triggering operation.

| Event | Source type |
|-------|-------------|
| CSV import confirmed | `manual_import` |
| XLSX import confirmed | `xlsx_import` |
| Image import confirmed | `image_import` |
| PDF import confirmed | `pdf_import` |
| Broker sync completed | `broker_sync` |
| Position added manually | `position_change` |
| Position edited manually | `position_change` |
| Position deleted manually | `position_change` |
| User clicks "Capture Snapshot" | `manual_snapshot` |

### Deduplication

Before inserting a new snapshot:
1. Compute fingerprint = SHA256(sorted "SYMBOL:QUANTITY.00000000" pairs).slice(0, 32)
2. Check for same portfolio + same fingerprint in the last 30 minutes
3. If duplicate found → return `{ ok: true, skipped: true }` — no duplicate row inserted

This prevents cluttering the timeline with identical snapshots when the user imports the same file twice or the broker sync returns unchanged data.

---

## SnapshotSourceType values

| Value | Trigger |
|-------|---------|
| `manual_import` | CSV import confirmed |
| `xlsx_import` | XLSX import confirmed |
| `image_import` | Screenshot/image import confirmed |
| `pdf_import` | PDF import confirmed |
| `broker_sync` | `syncPortfolioFromBroker()` completed |
| `manual_snapshot` | POST /api/portfolio/:id/snapshot |
| `position_change` | Manual position add/edit/delete |

---

## Enrichment (per snapshot, bulk)

All enrichment is done in one snapshot capture. No N+1 queries.

```
1. Load positions from portfolio_positions (1 DB query)
2. Bulk reference prices: getReferenceSnapshotsBulk(symbols) (1 call)
3. Opportunity Intelligence: getOpportunityIntelligence() (1 in-memory read)
4. Theme membership: getAllThemes() (no DB — config registry)
5. Build lookup maps (symbol → refPrice, symbol → intelligence)
6. Enrich each position from maps (O(N))
7. Compute coverage + fingerprint
8. INSERT portfolio_snapshots (1 insert)
9. INSERT portfolio_position_snapshots (1 per position)
```

**Market data policy:** DATABASE FIRST. Uses `getReferenceSnapshotsBulk` (stored daily bars / reference snapshots). Never calls Twelve Data directly. If reference price is unavailable → `reference_price = NULL`, `market_value = NULL`.

---

## PositionChangeType definitions

All deterministic quantity-based comparisons:

| Type | Rule |
|------|------|
| `NEW` | `current.quantity > 0` AND `previous` was absent |
| `EXITED` | `previous.quantity > 0` AND `current` is absent |
| `INCREASED` | `current.quantity > previous.quantity` |
| `REDUCED` | `current.quantity < previous.quantity` AND `current.quantity > 0` |
| `UNCHANGED` | Same quantity |

**Important compliance rule:** The service describes changes as observations, not actions.

✅ "NVDA position increased by 20 shares since the previous snapshot"

❌ "User bought NVDA" — never infer trades from snapshots

---

## ResearchChangeType definitions

Compares `researchScore` between two snapshots. Threshold: ±2 points.

| Type | Rule |
|------|------|
| `RESEARCH_STRENGTHENED` | `currScore - prevScore >= 2` |
| `RESEARCH_WEAKENED` | `prevScore - currScore >= 2` |
| `RESEARCH_UNCHANGED` | Delta < 2 points |
| `NEWLY_QUALIFIED` | `prevScore = null` AND `currScore ≠ null` |
| `NO_LONGER_QUALIFIED` | `prevScore ≠ null` AND `currScore = null` |

Research scores are READ from Opportunity Intelligence snapshot — never recomputed here.

---

## ExposureChangeType definitions

Based on market-value-weighted portfolio composition:

| Type | Rule |
|------|------|
| `SECTOR_EXPOSURE_INCREASED` | Sector's % of total market value increased |
| `SECTOR_EXPOSURE_DECREASED` | Sector's % of total market value decreased |
| `THEME_EXPOSURE_INCREASED` | Theme's % of total market value increased |
| `THEME_EXPOSURE_DECREASED` | Theme's % of total market value decreased |

Exposure changes below 0.5% are filtered (noise threshold).

---

## Market Value vs Position Change Separation

A key compliance and accuracy principle:

```
Portfolio value change = price movement × existing quantities
                       + new positions
                       + exited positions
                       + increased/reduced quantities

An UNCHANGED position can have non-zero marketValueDelta.
```

The service clearly separates:
- **Position changes** (quantity-based): what holdings changed
- **Market value changes** (price-based): how portfolio value changed
- **Research evidence changes**: what Opportunity Intelligence says about holdings

Never implies the user "traded" because market value changed.

---

## Coverage model

Every snapshot includes a `SnapshotCoverage` object:

```typescript
{
  positionsTotal:                       number;
  positionsWithMarketData:              number;
  positionsWithOpportunityIntelligence: number;
  positionsWithSector:                  number;
  positionsWithTheme:                   number;
  coveragePercent:                      number; // positionsWithMarketData / total × 100
}
```

Missing data is tracked and reported — never silently treated as zero.

---

## Data Freshness

Every `PortfolioChangeResult` includes:

```typescript
{
  fromSnapshotAt:           ISO datetime of the baseline snapshot
  toSnapshotAt:             ISO datetime of the comparison snapshot
  opportunityIntelligenceAt: ISO datetime — intelligence was current at capture
  institutionalDataNote:    "Institutional data reflects Form 13F filings — delayed by up to 45 days."
}
```

**Institutional data disclosure:** Always present in data freshness. Form 13F filings are reported quarterly with up to 45-day delay.

---

## API Endpoints (3 routes)

All routes require authentication. Cross-user portfolio IDs return 404 — no data leakage through counts or error messages.

### GET /api/portfolio/:id/history

Returns the portfolio's snapshot timeline.

**Query params:**

| Param | Values | Default |
|-------|--------|---------|
| `period` | `7D` \| `30D` \| `90D` \| `YTD` \| `1Y` \| `ALL` | `30D` |

**Response:**
```json
{
  "portfolioId": "port-uuid",
  "period": "30D",
  "snapshots": [
    {
      "id": "snap-...",
      "portfolioId": "port-uuid",
      "snapshotDate": "2026-08-09",
      "capturedAt": "2026-08-09T10:00:00.000Z",
      "sourceType": "broker_sync",
      "totalMarketValue": 127400.00,
      "totalCostBasis": 118200.00,
      "positionCount": 8,
      "coverage": { "positionsTotal": 8, "positionsWithMarketData": 7, ... }
    }
  ],
  "count": 4,
  "disclaimer": "Portfolio history is provided for research and analytics purposes and does not constitute investment advice."
}
```

**Errors:**
- `400` — Invalid period (returns `validPeriods`)
- `500` — Internal error

### GET /api/portfolio/:id/changes

Returns a deterministic comparison between two snapshots.

**Query params:**

| Param | Notes |
|-------|-------|
| `from` | Snapshot ID — defaults to the snapshot before the latest |
| `to` | Snapshot ID — defaults to the latest snapshot |

**Response:**
```json
{
  "changes": {
    "portfolioId": "port-uuid",
    "summary": {
      "fromSnapshotId": "snap-A",
      "toSnapshotId": "snap-B",
      "fromDate": "2026-08-05T10:00:00.000Z",
      "toDate": "2026-08-09T10:00:00.000Z",
      "valueChange": 2400.00,
      "valueChangePercent": 1.89,
      "previousValue": 125000.00,
      "currentValue": 127400.00,
      "costBasisChange": 0,
      "positionCountChange": 1,
      "previousPositionCount": 7,
      "currentPositionCount": 8
    },
    "addedPositions": [...],
    "exitedPositions": [...],
    "increasedPositions": [...],
    "reducedPositions": [...],
    "unchangedPositions": [...],
    "researchStrengthened": [...],
    "researchWeakened": [...],
    "newlyQualified": [...],
    "noLongerQualified": [...],
    "sectorChanges": [...],
    "themeChanges": [...],
    "dataFreshness": {
      "fromSnapshotAt": "...",
      "toSnapshotAt": "...",
      "institutionalDataNote": "Institutional data reflects Form 13F filings — delayed by up to 45 days."
    },
    "coverage": { ... },
    "limitations": []
  },
  "disclaimer": "Portfolio change information is provided for research and analytics purposes and does not constitute investment advice."
}
```

**Errors:**
- `404` — Portfolio not found, or insufficient snapshot history (< 2 snapshots)
- `500` — Internal error

### POST /api/portfolio/:id/snapshot

Manually capture a portfolio snapshot.

**Response (201 — new snapshot):**
```json
{
  "ok": true,
  "snapshotId": "snap-...",
  "skipped": false,
  "message": "Portfolio snapshot captured successfully",
  "durationMs": 85
}
```

**Response (200 — duplicate):**
```json
{
  "ok": true,
  "snapshotId": null,
  "skipped": true,
  "message": "Identical snapshot captured in last 30 minutes — no duplicate created",
  "durationMs": 12
}
```

**Errors:**
- `404` — Portfolio not found or not owned by user
- `400` — No positions to snapshot
- `500` — Snapshot capture failed

---

## User Isolation

Every endpoint:
1. Extracts `userId` from `req.session.userId` only — never from request body or query params
2. Verifies portfolio ownership: `WHERE portfolio_id = ? AND user_id = ?`
3. Cross-user portfolio IDs return empty results or 404 — no distinction exposed
4. Snapshot IDs are also user-bound — a snapshot from another user's portfolio returns 404
5. Snapshot logs never include userId in plain form

---

## Compliance

Use: Portfolio Change, Observed Change, Research Evidence Improved, Research Evidence Weakened, Position Increased, Position Reduced, Research Candidate

**Avoid:** Action-implying language ("bought", "sold"), directional instructions ("add more", "close position"), rebalancing directives, recommendation labels, strong-buy/sell labels, hold-reduction prompts.

Every API response includes a `disclaimer` field:
> "Portfolio history is provided for research and analytics purposes and does not constitute investment advice."
> or
> "Portfolio change information is provided for research and analytics purposes and does not constitute investment advice."

The UI shows this disclaimer once per section — not repeated on every card.

---

## Source Transparency

Snapshots preserve source context:

| sourceType | Meaning |
|------------|---------|
| `manual_import` | Positions imported from CSV |
| `xlsx_import` | Positions imported from Excel |
| `image_import` | Positions extracted from screenshot/photo |
| `pdf_import` | Positions extracted from PDF statement |
| `broker_sync` | Positions synced from connected broker |
| `manual_snapshot` | User clicked "Capture Snapshot" |
| `position_change` | User added/edited/deleted a position |

**Note:** Imported portfolios are never displayed as "live" — they reflect data at the time of import.

---

## Platform Health

`portfolioHistory` health card in `GET /api/admin/platform-health`:

```json
{
  "status": "HEALTHY",
  "summary": "3 portfolios tracked — 2 snapshots today",
  "lastSuccessAt": "2026-08-09T10:00:00.000Z",
  "details": {
    "portfoliosTracked": 3,
    "snapshotsTotal": 15,
    "snapshotsToday": 2,
    "latestSnapshotAt": "2026-08-09T10:00:00.000Z",
    "positionsCaptured": 45,
    "averageSnapshotDurationMs": "N/A",
    "storageHealth": "ok",
    "scheduledSnapshots": "Not implemented (Sprint 2.6.0 — future scheduler)"
  },
  "action": null
}
```

| Condition | Status |
|-----------|--------|
| DB error on health query | UNKNOWN |
| storageHealth = degraded | DEGRADED |
| Otherwise (including 0 snapshots) | HEALTHY |

Health stats: aggregate counts only. No portfolio holdings, symbols, or financial values exposed.

---

## Structured Logging

Log events (safe aggregate counts only):

```json
{ "event": "portfolio_snapshot_completed", "portfolioId": "port-001", "snapshotId": "snap-001", "sourceType": "broker_sync", "positionCount": 8, "durationMs": 85, "ts": "..." }
{ "event": "portfolio_snapshot_failed", "portfolioId": "port-001", "sourceType": "broker_sync", "durationMs": 12, "ts": "..." }
{ "event": "portfolio_change_computed", "portfolioId": "port-001", "fromSnapshotId": "snap-A", "toSnapshotId": "snap-B", "positionChanges": 3, "ts": "..." }
```

**Never logged:**
- Portfolio holdings (symbols or quantities)
- Cost basis or market values
- Account IDs or broker account numbers
- PII

---

## Snapshot Retention

Current policy: no automatic deletion in Sprint 2.6.0.

- Daily snapshots: retained indefinitely in this sprint
- Event-driven snapshots: retained indefinitely
- Future compaction: planned for Sprint 2.6.x+ when retention tiers are defined

Document: The `portfolio_snapshots` table will grow over time. Plan for cleanup job in Sprint 2.6.x.

---

## Snapshot Performance

Typical performance on a portfolio of 10-20 positions:
- DB queries: 3 (ownership check + bulk positions + INSERT snapshot)
- External calls: 1 (getReferenceSnapshotsBulk — bulk)
- In-memory: 1 (getOpportunityIntelligence — already cached)
- Expected duration: 50-200ms

Large portfolios (50+ positions): each position row insert is individual in Sprint 2.6.0 (safe baseline). Future: batch INSERT for large portfolios.

---

## Commercial Tiers (Documented Only — No Code Enforcement)

| Tier | Access |
|------|--------|
| Free | Basic current holdings view |
| Retail | Portfolio history, recent changes, basic research evidence changes |
| Professional | Longer history, advanced exposure analysis, cross-portfolio history |
| RIA | Client portfolio history, client change review, advisor workflows |
| Institutional | Multi-portfolio/strategy history, team research workflows |
| Enterprise | Custom retention, API access, organization-specific history policies |

---

## Runbook

### No snapshots in history

1. Import/sync portfolio at `/portfolio`
2. Verify trigger fired: check server logs for `portfolio_snapshot_completed` or `portfolio_snapshot_failed`
3. If failed: check log for error message
4. Manually trigger: `POST /api/portfolio/:id/snapshot`
5. Check `GET /api/portfolio/:id/history` with `period=ALL`

### Changes API returns 404

Minimum requirement: 2 snapshots captured. If only 1 exists, changes cannot be computed.
1. Capture a second snapshot (add/edit a position or click "Capture Snapshot")
2. Retry `GET /api/portfolio/:id/changes`

### Snapshot deduplication firing unexpectedly

Identical position fingerprint was captured within last 30 minutes. Wait 30 minutes, or change a position to create a new fingerprint.

### Reference prices all null

1. Check `GET /api/admin/platform-health` → marketData card
2. If market data is UNKNOWN/DEGRADED, reference prices may be unavailable
3. Snapshots still captured with `reference_price = null` — not a failure

### Platform health shows UNKNOWN

DB error in `getPortfolioHistoryHealth()`. Check database health card first.

### Table missing after deployment

Run startup migration manually by restarting the server — `ensurePortfolioHistoryTables()` runs on every startup via `CREATE TABLE IF NOT EXISTS`.

---

## Recovery

### Re-snapshot after a missed trigger

If a position change occurred but the snapshot trigger failed silently:
```
POST /api/portfolio/:id/snapshot
```
This captures the current state of the portfolio manually.

### Stale snapshot history

Snapshots are immutable — they represent the portfolio at capture time. There is no "fix" for stale history; it correctly represents what the portfolio looked like then.

---

## Admin Search Terms

- portfolio history
- portfolio snapshots
- portfolio_snapshots
- portfolio_position_snapshots
- PositionChangeType
- ResearchChangeType
- ExposureChangeType
- NEWLY_QUALIFIED
- NO_LONGER_QUALIFIED
- RESEARCH_STRENGTHENED
- change classification
- snapshot deduplication
- fingerprint dedup
- capturePortfolioSnapshot
- triggerSnapshotAsync
- getPortfolioChanges
- /api/portfolio/:id/history
- /api/portfolio/:id/changes
- portfolio change intelligence
- research-first architecture
